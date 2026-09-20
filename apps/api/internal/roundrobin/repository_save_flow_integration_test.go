package roundrobin

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// CRM_SAVE_FLOW_TEST_DATABASE_URL must point to a disposable loopback database
// with the complete migration chain applied.
func TestQueueCreateUpdateRepeatSaveAndReloadWithMetaForm(t *testing.T) {
	databaseURL := localQueueSaveFlowDatabaseURL(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL:           databaseURL,
		MaxConns:      4,
		HealthTimeout: 5 * time.Second,
	})
	if err != nil {
		t.Fatalf("connect local PostgreSQL: %v", err)
	}
	t.Cleanup(postgres.Close)
	pool := postgres.Pool()

	var organizationID, userID string
	if err := pool.QueryRow(ctx, `
		insert into public.organizations (name, slug, is_active)
		values ('Queue save flow contract', 'queue-save-flow-' || gen_random_uuid()::text, true)
		returning id::text
	`).Scan(&organizationID); err != nil {
		t.Fatalf("insert organization: %v", err)
	}
	if err := pool.QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&userID); err != nil {
		t.Fatalf("generate user id: %v", err)
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		if _, err := pool.Exec(cleanupCtx, `
			update public.users set organization_id = null where id = $1::uuid;
			delete from public.organization_members where user_id = $1::uuid;
			delete from public.organizations where id = $2::uuid;
			delete from public.users where id = $1::uuid;
			delete from auth.users where id = $1::uuid
		`, userID, organizationID); err != nil {
			t.Errorf("cleanup queue save-flow fixture: %v", err)
		}
	})

	email := fmt.Sprintf("queue-save-flow-%s@example.test", strings.ReplaceAll(userID, "-", ""))
	if _, err := pool.Exec(ctx, `
		insert into auth.users (
			id, aud, role, email, encrypted_password, email_confirmed_at,
			raw_app_meta_data, raw_user_meta_data, created_at, updated_at
		) values (
			$1::uuid, 'authenticated', 'authenticated', $2, '', now(),
			'{}'::jsonb, '{}'::jsonb, now(), now()
		);
		insert into public.users (
			id, organization_id, name, email, role, is_active
		) values ($1::uuid, $3::uuid, 'Queue save-flow member', $2, 'admin', true)
		on conflict (id) do update
		set organization_id = excluded.organization_id,
		    name = excluded.name,
		    email = excluded.email,
		    role = excluded.role,
		    is_active = excluded.is_active;
		insert into public.organization_members (
			organization_id, user_id, role, is_active
		) values ($3::uuid, $1::uuid, 'admin', true)
		on conflict (user_id, organization_id) do update
		set role = excluded.role,
		    is_active = excluded.is_active,
		    deleted_at = null
	`, userID, email, organizationID); err != nil {
		t.Fatalf("insert queue save-flow user: %v", err)
	}

	var pipelineID, stageID string
	if err := pool.QueryRow(ctx, `
		insert into public.pipelines (organization_id, name, is_default, is_active, position)
		values ($1::uuid, 'Queue save-flow pipeline', true, true, 0)
		returning id::text
	`, organizationID).Scan(&pipelineID); err != nil {
		t.Fatalf("insert pipeline: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		insert into public.stages (organization_id, pipeline_id, name, stage_key, position, is_active)
		values ($1::uuid, $2::uuid, 'Queue save-flow stage', 'new', 0, true)
		returning id::text
	`, organizationID, pipelineID).Scan(&stageID); err != nil {
		t.Fatalf("insert stage: %v", err)
	}

	formID := "queue-save-flow-" + strings.ReplaceAll(userID, "-", "")
	var integrationID, formConfigID string
	if err := pool.QueryRow(ctx, `
		insert into public.meta_integrations (
			organization_id, page_id, page_name, access_token,
			is_connected, integration_type
		) values (
			$1::uuid, $2, 'Queue save-flow page', 'queue-save-flow-token',
			true, 'facebook'
		)
		returning id::text
	`, organizationID, formID+"-page").Scan(&integrationID); err != nil {
		t.Fatalf("insert Meta integration: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		insert into public.meta_form_configs (
			organization_id, integration_id, form_id, form_name,
			pipeline_id, stage_id, is_active
		) values (
			$1::uuid, $2::uuid, $3, 'Queue save-flow form',
			$4::uuid, $5::uuid, true
		)
		returning id::text
	`, organizationID, integrationID, formID, pipelineID, stageID).Scan(&formConfigID); err != nil {
		t.Fatalf("insert Meta form config: %v", err)
	}

	weight := 1
	createRequest := CreateRequest{
		Name:             "Fila Meta segura",
		Strategy:         "simple",
		TargetPipelineID: pipelineID,
		TargetStageID:    stageID,
		ReentryBehavior:  "keep_assignee",
		Conditions: []ConditionInput{{
			Type:   "meta_form",
			Values: []string{formID},
		}},
		Members: []MemberInput{{
			Type:     "user",
			EntityID: userID,
			UserID:   userID,
			Weight:   &weight,
		}},
	}
	createInput, err := createRequest.Validate()
	if err != nil {
		t.Fatalf("validate queue create request: %v", err)
	}
	admin := tenant.Context{
		OrganizationID: organizationID,
		UserID:         userID,
		MemberRole:     "admin",
	}
	repo := NewRepository(postgres)
	created, err := repo.Create(ctx, admin, createInput)
	if err != nil {
		t.Fatalf("create queue: %v", err)
	}
	if created.ID == "" || len(created.Rules) != 1 || len(created.Members) != 1 {
		t.Fatalf("created queue shape = id %q, rules %d, members %d", created.ID, len(created.Rules), len(created.Members))
	}
	ruleID := created.Rules[0].ID
	memberID := created.Members[0].ID
	assertIntegrationMetaFormLink(t, ctx, pool, formConfigID, created.ID)

	updatedName := "Fila Meta segura editada"
	buildUpdate := func(ruleID string, memberID string) UpdateRequest {
		return UpdateRequest{
			Name: patchString{Set: true, Value: &updatedName},
			Conditions: []ConditionInput{{
				ID:     ruleID,
				Type:   "meta_form",
				Values: []string{formID},
			}},
			ConditionsSet: true,
			Members: []MemberInput{{
				ID:       memberID,
				Type:     "user",
				EntityID: userID,
				UserID:   userID,
				Weight:   &weight,
			}},
			MembersSet: true,
		}
	}

	updateInput, err := buildUpdate(ruleID, memberID).Validate()
	if err != nil {
		t.Fatalf("validate queue update request: %v", err)
	}
	updated, err := repo.Update(ctx, admin, created.ID, updateInput)
	if err != nil {
		t.Fatalf("update queue: %v", err)
	}
	if updated.ID != created.ID || updated.Name != updatedName || len(updated.Rules) != 1 || len(updated.Members) != 1 {
		t.Fatalf("unexpected updated queue: %#v", updated)
	}
	if updated.Rules[0].ID != ruleID || updated.Members[0].ID != memberID {
		t.Fatalf("update changed rule/member identity: rule %q member %q", updated.Rules[0].ID, updated.Members[0].ID)
	}

	repeatInput, err := buildUpdate(updated.Rules[0].ID, updated.Members[0].ID).Validate()
	if err != nil {
		t.Fatalf("validate repeat queue update: %v", err)
	}
	repeated, err := repo.Update(ctx, admin, created.ID, repeatInput)
	if err != nil {
		t.Fatalf("repeat identical queue save: %v", err)
	}
	if repeated.ID != created.ID || len(repeated.Rules) != 1 || len(repeated.Members) != 1 ||
		repeated.Rules[0].ID != ruleID || repeated.Members[0].ID != memberID {
		t.Fatalf("repeat save changed queue/rule/member identity: %#v", repeated)
	}

	reloaded, err := repo.Get(ctx, admin, created.ID)
	if err != nil {
		t.Fatalf("reload queue: %v", err)
	}
	if reloaded.Name != updatedName || len(reloaded.Rules) != 1 || len(reloaded.Members) != 1 ||
		reloaded.Rules[0].ID != ruleID || reloaded.Members[0].ID != memberID {
		t.Fatalf("unexpected reloaded queue: %#v", reloaded)
	}
	assertIntegrationMetaFormLink(t, ctx, pool, formConfigID, created.ID)

	var queueCount, ruleCount, memberCount int
	if err := pool.QueryRow(ctx, `
		select
			(select count(*) from public.round_robins where organization_id = $1::uuid and id = $2::uuid),
			(select count(*) from public.round_robin_rules where organization_id = $1::uuid and round_robin_id = $2::uuid),
			(select count(*) from public.round_robin_members where organization_id = $1::uuid and round_robin_id = $2::uuid)
	`, organizationID, created.ID).Scan(&queueCount, &ruleCount, &memberCount); err != nil {
		t.Fatalf("count persisted queue rows: %v", err)
	}
	if queueCount != 1 || ruleCount != 1 || memberCount != 1 {
		t.Fatalf("persisted row counts = queues %d, rules %d, members %d; want 1, 1, 1", queueCount, ruleCount, memberCount)
	}
}

func localQueueSaveFlowDatabaseURL(t *testing.T) string {
	t.Helper()
	databaseURL := strings.TrimSpace(os.Getenv("CRM_SAVE_FLOW_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("set CRM_SAVE_FLOW_TEST_DATABASE_URL to run local save-flow integration contracts")
	}
	target, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatalf("parse CRM_SAVE_FLOW_TEST_DATABASE_URL: %v", err)
	}
	switch strings.ToLower(target.Hostname()) {
	case "127.0.0.1", "localhost", "::1":
	default:
		t.Fatalf("CRM_SAVE_FLOW_TEST_DATABASE_URL must use a loopback host, got %q", target.Hostname())
	}
	return databaseURL
}

func assertIntegrationMetaFormLink(t *testing.T, ctx context.Context, q queryer, formConfigID string, queueID string) {
	t.Helper()
	var linkedQueueID string
	if err := q.QueryRow(ctx, `
		select round_robin_id::text
		from public.meta_form_configs
		where id = $1::uuid
	`, formConfigID).Scan(&linkedQueueID); err != nil {
		t.Fatalf("read Meta form queue link: %v", err)
	}
	if linkedQueueID != queueID {
		t.Fatalf("Meta form linked queue = %q, want %q", linkedQueueID, queueID)
	}
}
