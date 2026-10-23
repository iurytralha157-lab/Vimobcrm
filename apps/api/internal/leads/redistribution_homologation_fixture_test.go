package leads

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// Runs only against the disposable, sentinel-marked local substrate provisioned
// for main queue worker homologation. Credentials stay in memory, read only
// from the explicitly validated local QA manifest. Never reads application
// environment files or the normal DATABASE_URL; postgres is never the target DB.
func workerHomologationPostgres(t *testing.T) (context.Context, Repository) {
	t.Helper()
	configPath := os.Getenv("VIMOB_MAIN_QUEUE_WORKER_POSTGRES_CONFIG")
	if configPath == "" {
		t.Skip("VIMOB_MAIN_QUEUE_WORKER_POSTGRES_CONFIG is not set")
	}
	if !filepath.IsAbs(configPath) {
		t.Fatal("absolute disposable-target config required")
	}
	var config struct {
		Kind, Host, Database, User, Password, RunID, Sentinel, CredentialManifest string
		Port                                                                      int
	}
	raw, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &config); err != nil {
		t.Fatal(err)
	}
	if config.Kind != "vimob-main-queue-worker-postgres-v1" || config.Host != "127.0.0.1" || config.Port != 57422 ||
		!regexp.MustCompile(`^vimob_queue_worker_[a-f0-9]{12}$`).MatchString(config.Database) ||
		!regexp.MustCompile(`^[a-f0-9-]{36}$`).MatchString(config.RunID) || !regexp.MustCompile(`^[a-f0-9-]{36}$`).MatchString(config.Sentinel) {
		t.Fatal("refusing a target outside the disposable worker contract")
	}
	const localCredentialManifest = "C:/Users/andre/Documents/Codex/2026-10-14/c/work/queue-homologation/manifest.json"
	if config.CredentialManifest != localCredentialManifest {
		t.Fatal("refusing an unknown local credential source")
	}
	credentialRaw, err := os.ReadFile(localCredentialManifest)
	if err != nil {
		t.Fatal(err)
	}
	var credentials struct{ DatabaseURL string }
	if err := json.Unmarshal(credentialRaw, &credentials); err != nil {
		t.Fatal(err)
	}
	credentialURL, err := url.Parse(credentials.DatabaseURL)
	if err != nil || credentialURL.Host != "127.0.0.1:57422" || credentialURL.Path != "/postgres" || credentialURL.User == nil {
		t.Fatal("refusing an unknown local credential endpoint")
	}
	config.Password, _ = credentialURL.User.Password()
	if config.Password == "" {
		t.Fatal("missing explicit disposable cluster credential")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	t.Cleanup(cancel)
	connectionURL := &url.URL{Scheme: "postgres", Host: "127.0.0.1:57422", Path: config.Database,
		User: url.UserPassword(config.User, config.Password), RawQuery: "sslmode=disable&application_name=vimob-main-queue-worker-go&statement_timeout=10000&lock_timeout=8000"}
	db, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: connectionURL.String(), MaxConns: 12, HealthTimeout: 5 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	var database string
	var matches int
	err = db.Pool().QueryRow(ctx, `select current_database(), count(*) from public.queue_homologation_sentinel where marker=$1`, config.Sentinel).Scan(&database, &matches)
	if err != nil || database != config.Database || matches != 1 {
		t.Fatal("disposable database sentinel mismatch", err)
	}
	return ctx, NewRepository(db, nil)
}

type workerHomologationQueue struct {
	org, queue, lead, pipeline, stage string
	users                             []string
}

func workerHomologationUUID(t *testing.T) string {
	t.Helper()
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		t.Fatal(err)
	}
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", value[:4], value[4:6], value[6:8], value[8:10], value[10:])
}

func newHotfixQueue(t *testing.T, ctx context.Context, repo Repository, count int) workerHomologationQueue {
	t.Helper()
	q := workerHomologationQueue{org: workerHomologationUUID(t), queue: workerHomologationUUID(t), lead: workerHomologationUUID(t), pipeline: workerHomologationUUID(t), stage: workerHomologationUUID(t)}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `insert into public.organizations(id) values($1);
		insert into public.pipelines(id,organization_id) values($2,$1);
		insert into public.stages(id,organization_id,pipeline_id,position) values($3,$1,$2,0);
		insert into public.round_robins(id,organization_id,pipeline_id,target_pipeline_id,target_stage_id,settings)
		values($4,$1,$2,$2,$3,'{"timezone":"UTC","enable_redistribution":true,"redistribution_timeout_minutes":10,"redistribution_warning_minutes":2,"redistribution_max_attempts":4}');`, q.org, q.pipeline, q.stage, q.queue)
	if err != nil {
		t.Fatal(err)
	}
	for n := 0; n < count; n++ {
		user := workerHomologationUUID(t)
		q.users = append(q.users, user)
		_, err = tx.Exec(ctx, `insert into public.users(id,organization_id,name) values($1,$2,'Synthetic Go broker');
			insert into public.organization_members(organization_id,user_id) values($2,$1);
			insert into public.round_robin_members(id,organization_id,round_robin_id,user_id,position) values($3,$2,$4,$1,$5);`, user, q.org, workerHomologationUUID(t), q.queue, n)
		if err != nil {
			t.Fatal(err)
		}
	}
	_, err = tx.Exec(ctx, `insert into public.leads(id,organization_id,origin_round_robin_id,pipeline_id,stage_id,assigned_user_id,assigned_at)
		values($1,$2,$3,$4,$5,$6,now()-interval '1 day');
		select private.ensure_round_robin_ticket_sequence($3);`, q.lead, q.org, q.queue, q.pipeline, q.stage, q.users[0])
	if err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		for _, table := range []string{"lead_redistribution_jobs", "round_robin_logs", "notifications", "activities", "lead_action_facts"} {
			_, _ = repo.db.Pool().Exec(cleanup, "delete from public."+table+" where organization_id=$1", q.org)
		}
	})
	return q
}

func hotfixAdmin(q workerHomologationQueue) tenant.Context {
	return tenant.Context{OrganizationID: q.org, UserID: q.users[0], MemberRole: "admin"}
}

func workerHomologationReloadJob(ctx context.Context, repo Repository, id, org, lead string) (redistributionJob, error) {
	return scanRedistributionJob(repo.db.Pool().QueryRow(ctx, `select j.id::text,j.organization_id::text,j.lead_id::text,j.round_robin_id::text,
 coalesce(j.current_assigned_user_id::text,''),j.attempt_count,j.max_attempts,j.timeout_minutes,j.warning_minutes,j.enrolled_at,
 coalesce(l.name,''),coalesce(j.metadata,'{}'::jsonb)::text,j.xmin::text
 from public.lead_redistribution_jobs j join public.leads l on l.id=j.lead_id and l.organization_id=j.organization_id
 where j.id=$1 and j.organization_id=$2 and j.lead_id=$3`, id, org, lead))
}
