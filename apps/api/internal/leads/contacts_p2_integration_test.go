package leads

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// Prepared for a separately authorized disposable database. This test neither
// applies migrations nor starts a service, and is skipped by the ordinary suite.
func TestContactsP2LocalPostgres(t *testing.T) {
	if os.Getenv("VIMOB_RUN_CONTACTS_P2_DB_TESTS") != "LOCAL_WRITE_TEST" {
		t.Skip("set VIMOB_RUN_CONTACTS_P2_DB_TESTS=LOCAL_WRITE_TEST only for a disposable, migrated local contacts P2 database")
	}
	databaseURL := os.Getenv("CONTACTS_P2_TEST_DATABASE_URL")
	target, err := url.Parse(databaseURL)
	if err != nil || (target.Scheme != "postgres" && target.Scheme != "postgresql") || (target.Hostname() != "127.0.0.1" && target.Hostname() != "localhost") || !strings.HasPrefix(strings.TrimPrefix(target.Path, "/"), "vimob_contacts_p2_") {
		t.Fatal("contacts P2 test requires a loopback disposable vimob_contacts_p2_ database")
	}
	config, err := pgx.ParseConfig(databaseURL)
	if err != nil || (config.Host != "127.0.0.1" && config.Host != "localhost") || !strings.HasPrefix(config.Database, "vimob_contacts_p2_") {
		t.Fatal("effective test target must remain on loopback and use the disposable prefix")
	}
	for _, fallback := range config.Fallbacks {
		if fallback.Host != "127.0.0.1" && fallback.Host != "localhost" {
			t.Fatal("test connection cannot fall back to a remote database")
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, MaxConns: 1, HealthTimeout: 2 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer postgres.Close()
	pool := postgres.Pool()
	var empty, ready bool
	if err := pool.QueryRow(ctx, `select not exists(select 1 from public.organizations) and not exists(select 1 from public.leads) and not exists(select 1 from auth.users),to_regclass('private.contact_import_request_receipts') is not null`).Scan(&empty, &ready); err != nil || !empty || !ready {
		t.Fatal("test requires schema-only disposable database with receipt migration already applied separately")
	}
	marker := fmt.Sprintf("contacts-p2-%d", time.Now().UnixNano())
	organizationID, actorID, _ := createLeadDeleteLockTenant(t, ctx, pool, marker+"-a")
	foreignOrganizationID, foreignActorID, _ := createLeadDeleteLockTenant(t, ctx, pool, marker+"-b")
	otherActorID := contactsP1CreateBroker(t, ctx, pool, organizationID, marker+"-other")
	pipelineID, stageID := contactsP1CreateDestination(t, ctx, pool, organizationID, marker+"-pipeline")
	viewer := tenant.Context{OrganizationID: organizationID, UserID: actorID, MemberRole: "admin"}
	repository := NewRepository(postgres, nil)
	key := "99999999-9999-4999-8999-999999999999"
	request := CreateRequest{Name: marker + "-keyed-no-phone", ImportMode: true, ImportRequestKey: key, AutoDistribute: boolPointer(false), AssignedUserID: actorID, PipelineID: pipelineID, StageID: stageID}
	input, err := request.Validate()
	if err != nil {
		t.Fatal(err)
	}
	firstContext, firstCancel := context.WithTimeout(ctx, 5*time.Second)
	defer firstCancel()
	first, err := repository.Create(firstContext, viewer, input)
	if err != nil {
		t.Fatalf("first keyed import: %v", err)
	}
	t.Run("one-connection-concurrent-requests-do-not-starve-their-own-preflight", func(t *testing.T) {
		for _, sameKey := range []bool{false, true} {
			concurrentContext, concurrentCancel := context.WithTimeout(ctx, 10*time.Second)
			type completed struct {
				result CreateResult
				err    error
			}
			done := make(chan completed, 8)
			for index := 0; index < 8; index++ {
				pending := input
				pending.Name = marker + "-concurrent"
				keyIndex := index + 1
				if sameKey {
					keyIndex = 99
				}
				pending.ImportRequestKey = stringPointer(fmt.Sprintf("88888888-8888-4888-8888-%012d", keyIndex))
				go func(row createInput) {
					result, err := repository.Create(concurrentContext, viewer, row)
					done <- completed{result: result, err: err}
				}(pending)
			}
			ids := map[string]bool{}
			for index := 0; index < 8; index++ {
				entry := <-done
				if entry.err != nil {
					concurrentCancel()
					t.Fatalf("one-connection concurrent create/replay failed: %v", entry.err)
				}
				ids[entry.result.Lead.ID] = true
			}
			concurrentCancel()
			if (sameKey && len(ids) != 1) || (!sameKey && len(ids) != 8) {
				t.Fatalf("concurrent request identity failed: same_key=%v leads=%d", sameKey, len(ids))
			}
		}
	})
	t.Run("lost-response-retry-does-not-create-another-phone-less-contact", func(t *testing.T) {
		second, err := repository.Create(ctx, viewer, input)
		if err != nil || !second.Replayed || second.Lead.ID != first.Lead.ID {
			t.Fatalf("durable replay failed: %v %#v", err, second)
		}
		var count int
		if err := pool.QueryRow(ctx, `select count(*) from public.leads where organization_id=$1::uuid and name=$2`, organizationID, request.Name).Scan(&count); err != nil || count != 1 {
			t.Fatalf("retry created duplicates: count=%d error=%v", count, err)
		}
		changed := input
		changed.Name += " changed"
		if _, err := repository.Create(ctx, viewer, changed); !errors.Is(err, ErrLeadImportRequestConflict) {
			t.Fatalf("same key accepted changed payload: %v", err)
		}
	})
	t.Run("request-namespace-does-not-cross-actor-or-organization", func(t *testing.T) {
		other := viewer
		other.UserID = otherActorID
		otherResult, err := repository.Create(ctx, other, input)
		if err != nil || otherResult.Replayed || otherResult.Lead.ID == first.Lead.ID {
			t.Fatalf("request crossed actors: %v", err)
		}
		foreign := tenant.Context{OrganizationID: foreignOrganizationID, UserID: foreignActorID, MemberRole: "admin"}
		foreignInput, err := (CreateRequest{Name: request.Name, ImportMode: true, ImportRequestKey: key, AutoDistribute: boolPointer(false), AssignedUserID: foreignActorID}).Validate()
		if err != nil {
			t.Fatal(err)
		}
		foreignResult, err := repository.Create(ctx, foreign, foreignInput)
		if err != nil || foreignResult.Replayed || foreignResult.Lead.OrganizationID != foreignOrganizationID {
			t.Fatalf("request crossed organizations: %v", err)
		}
	})
	t.Run("export-detects-deletion-and-reference-name-changes-with-equal-count", func(t *testing.T) {
		filter := ContactListFilter{Mode: "full", ResponseMode: "page", Page: 1, Limit: 1, SortBy: "created_at", SortDir: "desc"}
		page, err := repository.ListContactsPage(ctx, viewer, filter)
		if err != nil || !validContactExportVersion(page.ExportVersion) {
			t.Fatalf("actual export signature: %v", err)
		}
		if _, err := pool.Exec(ctx, `update public.pipelines set name=name||'-renamed' where id=$1::uuid`, pipelineID); err != nil {
			t.Fatal(err)
		}
		filter.Page = 2
		filter.ExpectedExportVersion = page.ExportVersion
		if _, err := repository.ListContactsPage(ctx, viewer, filter); !errors.Is(err, ErrContactsExportChanged) {
			t.Fatalf("pipeline name drift was missed: %v", err)
		}
		filter.ExpectedExportVersion = ""
		beforeDelete, err := repository.ListContactsPage(ctx, viewer, filter)
		if err != nil {
			t.Fatal(err)
		}
		if err := repository.Delete(ctx, viewer, first.Lead.ID); err != nil {
			t.Fatal(err)
		}
		filter.ExpectedExportVersion = beforeDelete.ExportVersion
		if _, err := repository.ListContactsPage(ctx, viewer, filter); !errors.Is(err, ErrContactsExportChanged) {
			t.Fatalf("deletion drift was missed: %v", err)
		}
		filter.Mode = "compact"
		filter.ExpectedExportVersion = ""
		filter.Page = 999
		emptyPage, err := repository.ListContactsPage(ctx, viewer, filter)
		if err != nil || len(emptyPage.Data) != 0 || emptyPage.Total == 0 {
			t.Fatalf("empty page lost total: %#v %v", emptyPage, err)
		}
	})
	t.Run("deleted-completed-contact-is-not-recreated", func(t *testing.T) {
		result, err := repository.Create(ctx, viewer, input)
		if err != nil || !result.Replayed || !result.ReceiptOnly || createLeadResponse(viewer, result).Data != nil {
			t.Fatalf("deleted lead replay was unsafe: %v %#v", err, result)
		}
	})
	t.Run("reentry-tags-append-and-stale-revision-never-overwrites", func(t *testing.T) {
		var tagA, tagB string
		if err := pool.QueryRow(ctx, `insert into public.tags(organization_id,name,color) values($1::uuid,$2,'#123456') returning id::text`, organizationID, marker+"-tag-a").Scan(&tagA); err != nil {
			t.Fatal(err)
		}
		if err := pool.QueryRow(ctx, `insert into public.tags(organization_id,name,color) values($1::uuid,$2,'#123456') returning id::text`, organizationID, marker+"-tag-b").Scan(&tagB); err != nil {
			t.Fatal(err)
		}
		baseRequest := CreateRequest{Name: marker + "-tags", Phone: "5511999912345", ImportMode: true, ImportRequestKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", AutoDistribute: boolPointer(true), AssignedUserID: actorID, TagIDs: []string{tagA}}
		baseInput, err := baseRequest.Validate()
		if err != nil {
			t.Fatal(err)
		}
		created, err := repository.Create(ctx, viewer, baseInput)
		if err != nil {
			t.Fatal(err)
		}
		baseRequest.TagIDs = []string{tagB}
		baseRequest.ImportRequestKey = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2"
		reentryInput, err := baseRequest.Validate()
		if err != nil {
			t.Fatal(err)
		}
		reentry, err := repository.Create(ctx, viewer, reentryInput)
		if err != nil || !reentry.Reentry {
			t.Fatalf("tag reentry failed: %v", err)
		}
		var tagCount int
		if err := pool.QueryRow(ctx, `select count(*) from public.lead_tags where lead_id=$1::uuid and tag_id=any($2::uuid[])`, created.Lead.ID, []string{tagA, tagB}).Scan(&tagCount); err != nil || tagCount != 2 {
			t.Fatalf("reentry replaced/lost tags: %d %v", tagCount, err)
		}
		oldRevision := reentry.Lead.UpdatedAt
		if _, err := pool.Exec(ctx, `update public.leads set name=name||'-other-session',updated_at=clock_timestamp() where id=$1::uuid`, created.Lead.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := repository.Update(ctx, viewer, created.Lead.ID, updateInput{ExpectedUpdatedAt: &oldRevision, Name: patchString{Set: true, Value: stringPointer("Stale editor")}}); !errors.Is(err, ErrLeadChanged) {
			t.Fatalf("stale editor overwrote newer contact: %v", err)
		}
	})
}
