package publications

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// This test writes only its own synthetic property in the explicitly named
// loopback database. It never accepts DATABASE_URL or a remote Supabase host.
func TestSnapshotRefreshTransactionKeepsBudgetLeaseAndWithdrawalFences(t *testing.T) {
	if os.Getenv("VIMOB_PROPERTY_HARDENING_WRITE_TEST") != "LOCAL_WRITE_TEST" {
		t.Skip("requires isolated synthetic property database")
	}
	connection := os.Getenv("VIMOB_PROPERTY_HARDENING_TEST_DATABASE_URL")
	parsed, err := url.Parse(connection)
	if err != nil || parsed.Path != "/vimob_properties_fixes_20261012_fb58fe98" || (parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "localhost") {
		t.Fatal("publication tests refuse any database except the explicitly named loopback fixture")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: connection, MaxConns: 4, HealthTimeout: 5 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(database.Close)
	var name string
	if err := database.Pool().QueryRow(ctx, `select current_database()`).Scan(&name); err != nil || name != "vimob_properties_fixes_20261012_fb58fe98" {
		t.Fatal("database identity did not match fixture")
	}
	actor := tenant.Context{MemberRole: "admin", EnabledModules: []string{"properties", "site"}}
	if err := database.Pool().QueryRow(ctx, `select member.organization_id::text, member.user_id::text from public.organization_members member join public.users actor on actor.id = member.user_id where member.is_active and member.deleted_at is null and actor.is_active order by member.organization_id, member.user_id limit 1`).Scan(&actor.OrganizationID, &actor.UserID); err != nil {
		t.Fatal("fixture needs an active synthetic actor")
	}
	repo := NewRepository(database, Config{PublicBaseURL: "https://fixture.example", Worker: WorkerConfig{Enabled: true, MaxAttempts: 3}})
	tx, err := database.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	var propertyID string
	var updated time.Time
	if err := tx.QueryRow(ctx, `insert into public.properties(organization_id,code,title,tipo,tipo_de_imovel,status,created_by,responsible_user_id) values($1::uuid,$2,'Synthetic publication fixture','Apartamento','Apartamento','active',$3::uuid,$3::uuid) returning id::text,updated_at`, actor.OrganizationID, fmt.Sprintf("PUB-%d", time.Now().UnixNano()), actor.UserID).Scan(&propertyID, &updated); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		if _, err := database.Pool().Exec(cleanupCtx, `delete from public.properties where organization_id=$1::uuid and id=$2::uuid`, actor.OrganizationID, propertyID); err != nil {
			t.Errorf("synthetic property cleanup failed: %v", err)
		}
	})
	source := readyPublicationSource()
	source.Property["id"] = propertyID
	source.UpdatedAt = updated
	publication, err := repo.createPublication(ctx, tx, actor, propertyID, sitePublicationScope(), nil)
	if err != nil {
		t.Fatal(err)
	}
	checks, _, _ := evaluateSiteReadiness(source)
	versionID, err := repo.createVersion(ctx, tx, actor, source, *publication, sitePublicationScope(), checks)
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.markPublicationRequested(ctx, tx, actor, publication.ID, DesiredPublished, ObservedQueued, ReadinessReady, 1, checks, nil); err != nil {
		t.Fatal(err)
	}
	if _, _, err := repo.enqueueJob(ctx, tx, actor, publication.ID, versionID, propertyID, sitePublicationScope(), ActionPublish, "synthetic-refresh-"+propertyID, canonicalRequestHash(sitePublicationScope(), ActionPublish, propertyID, formatTimestamp(updated))); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	version := int64(1)
	job := pendingJob{PublicationID: publication.ID, OrganizationID: actor.OrganizationID, PropertyID: propertyID,
		Channel: SiteChannel, ChannelAccountKey: DefaultChannelAccount, Action: ActionPublish, Version: &version, VersionID: versionID, RequestedBy: &actor.UserID, MaxAttempts: 3}
	claim := func(attempts int) {
		t.Helper()
		if err := database.Pool().QueryRow(ctx, `update public.property_channel_publication_jobs set status='processing',attempts=$3,locked_at=clock_timestamp(),locked_by='synthetic-worker',lease_token=gen_random_uuid() where organization_id=$1::uuid and publication_id=$2::uuid returning id::text,lease_token::text`, actor.OrganizationID, publication.ID, attempts).Scan(&job.ID, &job.LeaseToken); err != nil {
			t.Fatal(err)
		}
		job.Attempts = attempts
	}
	refresh := func() error {
		refreshTx, err := database.Pool().Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer refreshTx.Rollback(ctx)
		if valid, err := lockPublicationJobSource(ctx, refreshTx, job, "synthetic-worker", repo.config.Worker.Lease); err != nil || !valid {
			t.Fatal("fixture lease not current")
		}
		current, err := repo.getPublication(ctx, refreshTx, actor.OrganizationID, propertyID, sitePublicationScope(), true)
		if err != nil {
			t.Fatal(err)
		}
		return repo.refreshChangedSnapshot(ctx, refreshTx, "synthetic-worker", job, *current, actor, source, sitePublicationScope(), checks)
	}
	claim(1)
	source.Property["titulo"] = "Synthetic changed title"
	source.UpdatedAt = source.UpdatedAt.Add(time.Second)
	if err := refresh(); err != nil {
		t.Fatal(err)
	}
	var status, desired string
	var attempts, maxAttempts, currentVersion, versionCount int
	var unlocked bool
	if err := database.Pool().QueryRow(ctx, `select job.status,job.attempts,job.max_attempts,publication.current_version,publication.desired_state,(job.locked_by is null and job.lease_token is null),(select count(*) from public.property_channel_publication_versions where publication_id=publication.id) from public.property_channel_publication_jobs job join public.property_channel_publications publication on publication.id=job.publication_id where job.id=$1::uuid`, job.ID).Scan(&status, &attempts, &maxAttempts, &currentVersion, &desired, &unlocked, &versionCount); err != nil {
		t.Fatal(err)
	}
	if status != JobRetry || attempts != 1 || maxAttempts != 3 || currentVersion != 2 || desired != DesiredPublished || !unlocked || versionCount != 2 {
		t.Fatalf("unexpected refreshed job: %s attempts=%d/%d version=%d desired=%s unlocked=%t versions=%d", status, attempts, maxAttempts, currentVersion, desired, unlocked, versionCount)
	}
	fenceTx, err := database.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer fenceTx.Rollback(ctx)
	if valid, err := jobFenceValid(ctx, fenceTx, job, "synthetic-worker"); err != nil || valid {
		t.Fatal("old lease remained valid after requeue")
	}
	_ = fenceTx.Rollback(ctx)
	version = 2
	if err := database.Pool().QueryRow(ctx, `select version_id::text from public.property_channel_publication_jobs where id=$1::uuid`, job.ID).Scan(&job.VersionID); err != nil {
		t.Fatal(err)
	}
	claim(3)
	if err := refresh(); err == nil {
		t.Fatal("exhausted snapshot budget was accepted")
	}
	if err := database.Pool().QueryRow(ctx, `select job.status,publication.current_version from public.property_channel_publication_jobs job join public.property_channel_publications publication on publication.id=job.publication_id where job.id=$1::uuid`, job.ID).Scan(&status, &currentVersion); err != nil {
		t.Fatal(err)
	}
	if status != JobDead || currentVersion != 2 {
		t.Fatal("refresh exhaustion reset budget or created an extra version")
	}
	if _, err := database.Pool().Exec(ctx, `update public.property_channel_publications set desired_state='unpublished',observed_state='queued' where id=$1::uuid`, publication.ID); err != nil {
		t.Fatal(err)
	}
	claim(2)
	if err := refresh(); err != nil {
		t.Fatal(err)
	}
	if err := database.Pool().QueryRow(ctx, `select job.status,publication.desired_state,publication.current_version from public.property_channel_publication_jobs job join public.property_channel_publications publication on publication.id=job.publication_id where job.id=$1::uuid`, job.ID).Scan(&status, &desired, &currentVersion); err != nil {
		t.Fatal(err)
	}
	if status != JobSuperseded || desired != DesiredUnpublished || currentVersion != 2 {
		t.Fatal("refresh revived an explicit withdrawal")
	}
}
