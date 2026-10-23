package leads

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/distribution"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestContactsP1RepositoryLocalPostgres(t *testing.T) {
	if os.Getenv("VIMOB_RUN_CONTACTS_P1_REPOSITORY_TESTS") != "LOCAL_WRITE_TEST" {
		t.Skip("set VIMOB_RUN_CONTACTS_P1_REPOSITORY_TESTS=LOCAL_WRITE_TEST for a disposable schema-only local database")
	}
	connectionString := os.Getenv("CONTACTS_P1_REPOSITORY_DATABASE_URL")
	target, err := url.Parse(connectionString)
	if err != nil || (target.Scheme != "postgres" && target.Scheme != "postgresql") ||
		(target.Hostname() != "localhost" && target.Hostname() != "127.0.0.1") ||
		!strings.HasPrefix(strings.TrimPrefix(target.Path, "/"), "vimob_contacts_p1_full_") {
		t.Fatal("repository regression requires loopback and a disposable vimob_contacts_p1_full_ database")
	}
	config, err := pgx.ParseConfig(connectionString)
	if err != nil || (config.Host != "localhost" && config.Host != "127.0.0.1") || !strings.HasPrefix(config.Database, "vimob_contacts_p1_full_") {
		t.Fatal("resolved repository regression connection must remain on loopback in the disposable database")
	}
	for _, fallback := range config.Fallbacks {
		if fallback.Host != "localhost" && fallback.Host != "127.0.0.1" {
			t.Fatal("repository regression cannot fall back to a remote host")
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: connectionString, MaxConns: 4, HealthTimeout: 2 * time.Second})
	if err != nil {
		t.Fatalf("connect schema-only disposable repository database: %v", err)
	}
	defer postgres.Close()
	pool := postgres.Pool()
	var empty bool
	if err := pool.QueryRow(ctx, `select not exists (select 1 from public.organizations) and not exists (select 1 from public.leads) and not exists (select 1 from auth.users)`).Scan(&empty); err != nil || !empty {
		t.Fatal("repository regression requires an empty schema-only database")
	}

	suffix := fmt.Sprintf("contacts-p1-%d", time.Now().UnixNano())
	organizationID, actorID, _ := createLeadDeleteLockTenant(t, ctx, pool, suffix+"-a")
	foreignOrganizationID, foreignActorID, _ := createLeadDeleteLockTenant(t, ctx, pool, suffix+"-b")
	otherActorID := contactsP1CreateBroker(t, ctx, pool, organizationID, suffix+"-other")
	pipelineA, stageA := contactsP1CreateDestination(t, ctx, pool, organizationID, suffix+"-new")
	pipelineB, stageB := contactsP1CreateDestination(t, ctx, pool, organizationID, suffix+"-existing")
	var queueID string
	if err := pool.QueryRow(ctx, `insert into public.round_robins (organization_id, name, is_active, reentry_behavior, target_pipeline_id, target_stage_id) values ($1::uuid, $2, true, 'redistribute', $3::uuid, $4::uuid) returning id::text`, organizationID, suffix+"-queue", pipelineA, stageA).Scan(&queueID); err != nil {
		t.Fatalf("create synthetic redistributing queue: %v", err)
	}
	viewer := tenant.Context{OrganizationID: organizationID, UserID: actorID, MemberRole: "member", Permissions: []string{permissions.LeadViewOwn, permissions.LeadImport, permissions.LeadOperate, permissions.DistributionManage}}
	repository := NewRepository(postgres, nil)
	var existingLeadID, existingPhone string
	for index, status := range []string{"won", "lost"} {
		t.Run(status+"-import-preserves-business-and-restricted-property", func(t *testing.T) {
			phone := fmt.Sprintf("55119999000%02d", index)
			leadID, propertyID := contactsP1CreateExistingBusiness(t, ctx, pool, organizationID, actorID, pipelineB, stageB, queueID, suffix+"-"+status, phone, status)
			before := contactsP1Snapshot(t, ctx, pool, "leads", leadID)
			propertyBefore := contactsP1Snapshot(t, ctx, pool, "properties", propertyID)
			logsBefore := contactsP1CountDistributionLogs(t, ctx, pool, leadID)
			input, err := (CreateRequest{Name: "Imported synthetic name", Phone: phone, Source: "spreadsheet", PipelineID: pipelineA, StageID: stageA, ImportMode: true, AutoDistribute: boolPointer(true), RoundRobinID: queueID}).Validate()
			if err != nil {
				t.Fatalf("validate imported duplicate: %v", err)
			}
			result, err := repository.Create(ctx, viewer, input)
			if err != nil || !result.Reentry || result.Lead.ID != leadID || result.DistributionOutcome != CreateDistributionOutcomeReentryPreserved {
				t.Fatalf("preserved repository reentry: error=%v result=%#v", err, result)
			}
			after := contactsP1Snapshot(t, ctx, pool, "leads", leadID)
			if after["name"] != input.Name || after["reentry_count"] != float64(3) {
				t.Fatal("repository reentry did not apply explicit name/bookkeeping")
			}
			for _, field := range []string{"name", "last_entry_at", "reentry_count", "updated_at"} {
				delete(before, field)
				delete(after, field)
			}
			if !reflect.DeepEqual(before, after) {
				t.Fatal("repository import changed missing email/message or protected business fields")
			}
			if !reflect.DeepEqual(propertyBefore, contactsP1Snapshot(t, ctx, pool, "properties", propertyID)) || logsBefore != contactsP1CountDistributionLogs(t, ctx, pool, leadID) {
				t.Fatal("repository import changed property reservation or ran redistribution")
			}
			var entryPipeline, entryStage, entryProperty, entryStatus, requestedPipeline string
			var preserved bool
			if err := pool.QueryRow(ctx, `select pipeline_id::text, stage_id::text, property_id::text, metadata #>> '{new_data,deal_status}', (metadata->>'import_state_preserved')::boolean, metadata #>> '{requested_data,pipeline_id}' from public.lead_entry_events where lead_id = $1::uuid and entry_type = 'reentry' order by occurred_at desc limit 1`, leadID).Scan(&entryPipeline, &entryStage, &entryProperty, &entryStatus, &preserved, &requestedPipeline); err != nil {
				t.Fatalf("read effective reentry event: %v", err)
			}
			if entryPipeline != pipelineB || entryStage != stageB || entryProperty != propertyID || entryStatus != status || !preserved || requestedPipeline != pipelineA {
				t.Fatal("reentry event must use preserved destination/property and keep requested defaults separately")
			}
			response := createLeadResponse(viewer, result)
			if !response.LeadVisible || response.Data == nil || response.Data.PropertyID != "" || response.Data.InterestPropertyID != "" {
				t.Fatal("own lead response must remain visible without exposing its restricted property")
			}
			existingLeadID, existingPhone = leadID, phone
		})
	}

	t.Run("create-assigned-outside-own-scope-returns-receipt", func(t *testing.T) {
		name := suffix + "-assigned-other"
		input, err := (CreateRequest{Name: name, ImportMode: true, AssignedUserID: otherActorID, PipelineID: pipelineA, StageID: stageA, AutoDistribute: boolPointer(false)}).Validate()
		if err != nil {
			t.Fatal(err)
		}
		result, err := repository.Create(ctx, viewer, input)
		if err != nil || result.Lead.ID == "" || result.Lead.AssignedUserID != otherActorID {
			t.Fatalf("assigned creation must succeed: %v", err)
		}
		response := createLeadResponse(viewer, result)
		if response.Data != nil || response.LeadVisible || response.LeadID != result.Lead.ID || response.AssignedUserName != "" {
			t.Fatal("successful outside-scope creation must return receipt without leaking contact")
		}
		var count int
		if err := pool.QueryRow(ctx, `select count(*) from public.leads where organization_id = $1::uuid and name = $2 and assigned_user_id = $3::uuid`, organizationID, name, otherActorID).Scan(&count); err != nil || count != 1 {
			t.Fatalf("outside-scope created contacts count=%d error=%v", count, err)
		}
		if _, err := repository.Get(ctx, viewer, result.Lead.ID); !errors.Is(err, ErrLeadNotFound) {
			t.Fatalf("final read visibility should remain restricted: %v", err)
		}
	})
	t.Run("create-own-contact-keeps-data-response", func(t *testing.T) {
		input, err := (CreateRequest{Name: suffix + "-own", ImportMode: true, AssignedUserID: actorID, PipelineID: pipelineA, StageID: stageA, AutoDistribute: boolPointer(false)}).Validate()
		if err != nil {
			t.Fatal(err)
		}
		result, err := repository.Create(ctx, viewer, input)
		if err != nil {
			t.Fatal(err)
		}
		response := createLeadResponse(viewer, result)
		if !response.LeadVisible || response.Data == nil || response.Data.ID != result.Lead.ID {
			t.Fatal("own creation must retain its visible contact response")
		}
	})
	t.Run("duplicate-outside-own-scope-cannot-mutate", func(t *testing.T) {
		before := contactsP1Snapshot(t, ctx, pool, "leads", existingLeadID)
		otherViewer := viewer
		otherViewer.UserID = otherActorID
		input, err := (CreateRequest{Name: "Forbidden duplicate", Phone: existingPhone, ImportMode: true, AutoDistribute: boolPointer(true), RoundRobinID: queueID}).Validate()
		if err != nil {
			t.Fatal(err)
		}
		if _, err := repository.Create(ctx, otherViewer, input); !errors.Is(err, ErrLeadAlreadyExists) {
			t.Fatalf("out-of-scope duplicate should be rejected: %v", err)
		}
		if !reflect.DeepEqual(before, contactsP1Snapshot(t, ctx, pool, "leads", existingLeadID)) {
			t.Fatal("out-of-scope duplicate changed the existing contact")
		}
	})
	t.Run("same-phone-in-other-organization-cannot-reenter-foreign-contact", func(t *testing.T) {
		before := contactsP1Snapshot(t, ctx, pool, "leads", existingLeadID)
		otherContext := tenant.Context{OrganizationID: foreignOrganizationID, UserID: foreignActorID, MemberRole: "admin"}
		input, err := (CreateRequest{Name: "Other organization contact", Phone: existingPhone, ImportMode: true, AssignedUserID: foreignActorID, AutoDistribute: boolPointer(false)}).Validate()
		if err != nil {
			t.Fatal(err)
		}
		result, err := repository.Create(ctx, otherContext, input)
		if err != nil || result.Reentry || result.Lead.ID == existingLeadID || result.Lead.OrganizationID != foreignOrganizationID {
			t.Fatalf("cross-organization phone must create an isolated contact: error=%v result=%#v", err, result)
		}
		if !reflect.DeepEqual(before, contactsP1Snapshot(t, ctx, pool, "leads", existingLeadID)) {
			t.Fatal("other organization changed the existing contact")
		}
	})
}

func contactsP1CreateBroker(t *testing.T, ctx context.Context, pool *pgxpool.Pool, organizationID, suffix string) string {
	t.Helper()
	var userID string
	if err := pool.QueryRow(ctx, `insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values (gen_random_uuid(), 'authenticated', 'authenticated', $1, '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()) returning id::text`, suffix+"@example.invalid").Scan(&userID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `insert into public.users (id, organization_id, name, email, role, is_active) values ($1::uuid, $2::uuid, $3, $4, 'broker', true) on conflict (id) do update set organization_id=excluded.organization_id, name=excluded.name, email=excluded.email, is_active=true`, userID, organizationID, suffix, suffix+"@example.invalid"); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `insert into public.organization_members (organization_id, user_id, role, is_active) values ($1::uuid, $2::uuid, 'broker', true) on conflict (user_id, organization_id) do update set is_active=true`, organizationID, userID); err != nil {
		t.Fatal(err)
	}
	return userID
}

func contactsP1CreateDestination(t *testing.T, ctx context.Context, pool *pgxpool.Pool, organizationID, name string) (string, string) {
	t.Helper()
	var pipelineID, stageID string
	if err := pool.QueryRow(ctx, `insert into public.pipelines (organization_id, name, is_active) values ($1::uuid, $2, true) returning id::text`, organizationID, name).Scan(&pipelineID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `insert into public.stages (organization_id, pipeline_id, name, stage_key, position, is_active) values ($1::uuid, $2::uuid, $3, 'synthetic-p1-stage', 0, true) returning id::text`, organizationID, pipelineID, name).Scan(&stageID); err != nil {
		t.Fatal(err)
	}
	return pipelineID, stageID
}

func contactsP1CreateExistingBusiness(t *testing.T, ctx context.Context, pool *pgxpool.Pool, organizationID, actorID, pipelineID, stageID, queueID, name, phone, status string) (string, string) {
	t.Helper()
	var leadID, propertyID string
	if err := pool.QueryRow(ctx, `insert into public.properties (organization_id, code, title, status, preco, published_on_site, anunciar, created_by, metadata) values ($1::uuid, $2, $2, 'reserved', 750000, false, false, $3::uuid, '{"reservation_event_id":"synthetic-reservation"}'::jsonb) returning id::text`, organizationID, name, actorID).Scan(&propertyID); err != nil {
		t.Fatalf("create reserved synthetic property: %v", err)
	}
	if err := pool.QueryRow(ctx, `insert into public.leads (organization_id, assigned_user_id, assigned_at, name, phone, source, email, message, pipeline_id, stage_id, stage_entered_at, board_order_at, deal_status, lost_reason, lost_at, won_at, property_id, interest_property_id, property_code, valor_interesse, commission_percentage, metadata, intake_scope_key, origin_round_robin_id, last_entry_at, reentry_count) values ($1::uuid, $2::uuid, '2026-01-01T00:00:00Z', $3, $4, 'manual', 'original@example.test', 'Original message', $5::uuid, $6::uuid, '2026-01-02T00:00:00Z', '2026-01-03T00:00:00Z', $7, case when $7='lost' then 'Original lost reason' else null end, case when $7='lost' then '2026-01-04T00:00:00Z'::timestamptz else null end, case when $7='won' then '2026-01-05T00:00:00Z'::timestamptz else null end, $8::uuid, $8::uuid, $3, 750000, 5, '{"profile":{"cpf":"synthetic-profile"},"reservation_event_id":"synthetic-reservation"}'::jsonb, $9, $10::uuid, '2026-01-06T00:00:00Z', 2) returning id::text`, organizationID, actorID, name, phone, pipelineID, stageID, status, propertyID, distribution.IntakeScopeKey(&queueID), queueID).Scan(&leadID); err != nil {
		t.Fatalf("create existing synthetic business: %v", err)
	}
	return leadID, propertyID
}

func contactsP1Snapshot(t *testing.T, ctx context.Context, pool *pgxpool.Pool, table, id string) map[string]any {
	t.Helper()
	query := `select to_jsonb(l) from public.leads l where id=$1::uuid`
	if table == "properties" {
		query = `select to_jsonb(p) from public.properties p where id=$1::uuid`
	}
	var raw []byte
	if err := pool.QueryRow(ctx, query, id).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var result map[string]any
	if err := json.Unmarshal(raw, &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func contactsP1CountDistributionLogs(t *testing.T, ctx context.Context, pool *pgxpool.Pool, leadID string) int {
	t.Helper()
	var count int
	if err := pool.QueryRow(ctx, `select count(*) from public.round_robin_logs where lead_id=$1::uuid`, leadID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}
