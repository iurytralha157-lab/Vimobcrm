package meta

import (
	"context"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/roundrobin"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestPendingMetaReplayKeepsTombstonedQueueIdentityAndDestination(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("META_INTAKE_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("set META_INTAKE_TEST_DATABASE_URL to run the Meta tombstone intake contract")
	}
	target, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatalf("parse META_INTAKE_TEST_DATABASE_URL: %v", err)
	}
	switch strings.ToLower(target.Hostname()) {
	case "127.0.0.1", "localhost", "::1":
	default:
		t.Fatalf("META_INTAKE_TEST_DATABASE_URL must use a loopback host, got %q", target.Hostname())
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL:           databaseURL,
		MaxConns:      6,
		HealthTimeout: 5 * time.Second,
	})
	if err != nil {
		t.Fatalf("connect local PostgreSQL: %v", err)
	}
	t.Cleanup(postgres.Close)
	pool := postgres.Pool()

	var organizationID string
	if err := pool.QueryRow(ctx, `
		insert into public.organizations (name, slug, is_active)
		values (
		  'Meta tombstone intake contract',
		  'meta-tombstone-' || gen_random_uuid()::text,
		  true
		)
		returning id::text
	`).Scan(&organizationID); err != nil {
		t.Fatalf("insert organization: %v", err)
	}

	insertPipeline := func(name string, isDefault bool, position int) (string, string) {
		t.Helper()
		var pipelineID string
		if err := pool.QueryRow(ctx, `
			insert into public.pipelines (
			  organization_id, name, is_default, is_active, position
			) values ($1::uuid, $2, $3, true, $4)
			returning id::text
		`, organizationID, name, isDefault, position).Scan(&pipelineID); err != nil {
			t.Fatalf("insert pipeline %s: %v", name, err)
		}
		var stageID string
		if err := pool.QueryRow(ctx, `
			insert into public.stages (
			  organization_id, pipeline_id, name, stage_key, position, is_active
			) values ($1::uuid, $2::uuid, $3, 'new', 0, true)
			returning id::text
		`, organizationID, pipelineID, name+" stage").Scan(&stageID); err != nil {
			t.Fatalf("insert stage %s: %v", name, err)
		}
		return pipelineID, stageID
	}
	originalPipelineID, originalStageID := insertPipeline("Frozen Meta destination", true, 0)
	currentPipelineID, currentStageID := insertPipeline("Current Meta destination", false, 1)

	insertUser := func(label string) string {
		t.Helper()
		var userID string
		if err := pool.QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&userID); err != nil {
			t.Fatalf("generate %s user: %v", label, err)
		}
		email := "meta-tombstone-" + label + "-" + strings.ReplaceAll(userID, "-", "") + "@example.test"
		if _, err := pool.Exec(ctx, `
			insert into auth.users (
			  id, aud, role, email, encrypted_password, email_confirmed_at,
			  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
			) values (
			  $1::uuid, 'authenticated', 'authenticated', $2, '', now(),
			  '{}'::jsonb, '{}'::jsonb, now(), now()
			)
		`, userID, email); err != nil {
			t.Fatalf("insert %s auth user: %v", label, err)
		}
		if _, err := pool.Exec(ctx, `
			insert into public.users (
			  id, organization_id, name, email, role, is_active
			) values ($1::uuid, $2::uuid, $3, $4, 'admin', true)
			on conflict (id) do update
			set organization_id = excluded.organization_id,
			    name = excluded.name,
			    email = excluded.email,
			    role = excluded.role,
			    is_active = excluded.is_active
		`, userID, organizationID, "Meta "+label, email); err != nil {
			t.Fatalf("insert %s public user: %v", label, err)
		}
		if _, err := pool.Exec(ctx, `
			insert into public.organization_members (
			  organization_id, user_id, role, is_active
			) values ($1::uuid, $2::uuid, 'admin', true)
			on conflict (user_id, organization_id) do update
			set role = excluded.role, is_active = true, deleted_at = null
		`, organizationID, userID); err != nil {
			t.Fatalf("insert %s membership: %v", label, err)
		}
		return userID
	}
	originalAssigneeID := insertUser("original")
	currentAssigneeID := insertUser("current")

	var queueID string
	if err := pool.QueryRow(ctx, `
		insert into public.round_robins (
		  organization_id, name, is_active, pipeline_id,
		  target_pipeline_id, target_stage_id, reentry_behavior
		) values (
		  $1::uuid, 'Frozen Meta queue', true, $2::uuid,
		  $2::uuid, $3::uuid, 'keep_assignee'
		)
		returning id::text
	`, organizationID, originalPipelineID, originalStageID).Scan(&queueID); err != nil {
		t.Fatalf("insert queue: %v", err)
	}

	var integrationID string
	pageID := "page-" + strings.ReplaceAll(queueID, "-", "")
	if err := pool.QueryRow(ctx, `
		insert into public.meta_integrations (
		  organization_id, page_id, page_name, is_connected,
		  pipeline_id, stage_id, assigned_user_id
		) values (
		  $1::uuid, $2, 'Meta tombstone page', false,
		  $3::uuid, $4::uuid, $5::uuid
		)
		returning id::text
	`, organizationID, pageID, currentPipelineID, currentStageID, currentAssigneeID).Scan(&integrationID); err != nil {
		t.Fatalf("insert Meta integration: %v", err)
	}
	var formConfigID string
	formID := "form-" + strings.ReplaceAll(queueID, "-", "")
	if err := pool.QueryRow(ctx, `
		insert into public.meta_form_configs (
		  organization_id, integration_id, form_id, form_name,
		  pipeline_id, stage_id, assigned_user_id, round_robin_id,
		  is_active, source
		) values (
		  $1::uuid, $2::uuid, $3, 'Meta tombstone form',
		  $4::uuid, $5::uuid, $6::uuid, $7::uuid,
		  true, 'meta'
		)
		returning id::text
	`, organizationID, integrationID, formID, currentPipelineID,
		currentStageID, currentAssigneeID, queueID).Scan(&formConfigID); err != nil {
		t.Fatalf("insert Meta form config: %v", err)
	}

	phone := "551199998877"
	var existingLeadID string
	if err := pool.QueryRow(ctx, `
		insert into public.leads (
		  organization_id, pipeline_id, stage_id, assigned_user_id,
		  name, phone, source, intake_scope_key, origin_round_robin_id,
		  metadata
		) values (
		  $1::uuid, $2::uuid, $3::uuid, $4::uuid,
		  'Existing queue-scoped Meta lead', $5, 'meta',
		  'queue:' || $6::text, $6::uuid,
		  jsonb_build_object('intake_scope_key', 'queue:' || $6::text,
		                     'origin_round_robin_id', $6::text)
		)
		returning id::text
	`, organizationID, originalPipelineID, originalStageID,
		originalAssigneeID, phone, queueID).Scan(&existingLeadID); err != nil {
		t.Fatalf("insert existing lead: %v", err)
	}

	leadgenID := "leadgen-" + strings.ReplaceAll(queueID, "-", "")
	var placeholderLeadID string
	if err := pool.QueryRow(ctx, `
		insert into public.leads (
		  organization_id, pipeline_id, stage_id, name, source,
		  meta_lead_id, intake_scope_key, origin_round_robin_id, metadata
		) values (
		  $1::uuid, $2::uuid, $3::uuid, 'Pending Meta placeholder', 'meta',
		  $4, 'queue:' || $5::text, $5::uuid,
		  jsonb_build_object(
		    'meta_details_status', 'pending',
		    'intake_scope_key', 'queue:' || $5::text,
		    'origin_round_robin_id', $5::text
		  )
		)
		returning id::text
	`, organizationID, originalPipelineID, originalStageID,
		leadgenID, queueID).Scan(&placeholderLeadID); err != nil {
		t.Fatalf("insert pending placeholder: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		insert into public.lead_entry_events (
		  organization_id, lead_id, entry_type, source, provider,
		  provider_event_id, occurred_at, is_countable, metadata
		) values (
		  $1::uuid, $2::uuid, 'initial', 'meta', 'meta',
		  $3, now(), true, '{"meta_details_status":"pending"}'::jsonb
		)
	`, organizationID, placeholderLeadID, leadgenID); err != nil {
		t.Fatalf("insert pending provider ledger: %v", err)
	}

	queueRepo := roundrobin.NewRepository(postgres)
	if err := queueRepo.Delete(ctx, tenant.Context{
		OrganizationID: organizationID,
		MemberRole:     "admin",
	}, queueID); err != nil {
		t.Fatalf("tombstone queue after Meta ACK: %v", err)
	}

	repo := NewRepository(postgres, Config{})
	integration := metaIntegration{
		ID:             integrationID,
		OrganizationID: organizationID,
		PageID:         &pageID,
		PageName:       stringPointerForMetaTombstone("Current Meta page"),
		PipelineID:     &currentPipelineID,
		StageID:        &currentStageID,
		AssignedUserID: &currentAssigneeID,
		DefaultStatus:  stringPointerForMetaTombstone("new"),
	}
	formConfig := metaFormConfig{
		ID:             formConfigID,
		OrganizationID: organizationID,
		IntegrationID:  integrationID,
		PageID:         &pageID,
		FormID:         formID,
		FormName:       stringPointerForMetaTombstone("Current Meta form"),
		PipelineID:     &currentPipelineID,
		StageID:        &currentStageID,
		AssignedUserID: &currentAssigneeID,
		Source:         stringPointerForMetaTombstone("meta"),
		DefaultValues:  map[string]any{},
	}
	pendingReentry, err := repo.prepareUntouchedPendingMetaLeadForReentry(
		ctx,
		integration,
		leadgenID,
		placeholderLeadID,
		&phone,
	)
	if err != nil {
		t.Fatalf("prepare tombstoned pending Meta replay: %v", err)
	}
	if pendingReentry == nil {
		t.Fatal("pending Meta replay did not retain its queue-scoped identity")
	}

	change := leadgenChange{
		LeadgenID:   leadgenID,
		FormID:      formID,
		PageID:      pageID,
		CreatedTime: time.Now().UTC().Format(time.RFC3339),
		Raw:         map[string]any{"id": leadgenID},
	}
	lead := leadData{
		Name:      "Enriched Meta lead",
		Phone:     &phone,
		RawFields: map[string]any{},
		Meta:      map[string]any{},
	}
	leadID, reentry, err := repo.persistLead(
		ctx,
		map[string]any{"object": "page"},
		map[string]any{"id": leadgenID},
		change,
		integration,
		formConfig,
		lead,
		"",
		pendingReentry,
	)
	if err != nil {
		t.Fatalf("persist tombstoned pending Meta replay: %v", err)
	}
	if !reentry || leadID != existingLeadID {
		t.Fatalf("Meta replay result = lead:%s reentry:%t, want %s/true", leadID, reentry, existingLeadID)
	}

	var assignedUserID, pipelineID, stageID, scopeKey, originQueueID string
	var reentryCount int
	if err := pool.QueryRow(ctx, `
		select
		  coalesce(assigned_user_id::text, ''),
		  coalesce(pipeline_id::text, ''),
		  coalesce(stage_id::text, ''),
		  intake_scope_key,
		  coalesce(origin_round_robin_id::text, ''),
		  coalesce(reentry_count, 0)
		from public.leads
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, existingLeadID).Scan(
		&assignedUserID,
		&pipelineID,
		&stageID,
		&scopeKey,
		&originQueueID,
		&reentryCount,
	); err != nil {
		t.Fatalf("read replayed Meta lead: %v", err)
	}
	if assignedUserID != originalAssigneeID || pipelineID != originalPipelineID ||
		stageID != originalStageID || scopeKey != "queue:"+queueID ||
		originQueueID != queueID || reentryCount != 1 {
		t.Fatalf(
			"replayed Meta lead = assignee:%s pipeline:%s stage:%s scope:%s origin:%s reentries:%d",
			assignedUserID, pipelineID, stageID, scopeKey, originQueueID, reentryCount,
		)
	}

	var placeholderCount, providerEntryCount int
	if err := pool.QueryRow(ctx, `
		select
		  (select count(*)::int from public.leads
		   where organization_id = $1::uuid and id = $2::uuid),
		  (select count(*)::int from public.lead_entry_events
		   where organization_id = $1::uuid
		     and lead_id = $3::uuid
		     and provider = 'meta'
		     and provider_event_id = $4
		     and entry_type = 'reentry'
		     and is_countable = true)
	`, organizationID, placeholderLeadID, existingLeadID, leadgenID).Scan(
		&placeholderCount,
		&providerEntryCount,
	); err != nil {
		t.Fatalf("read Meta replay ledger: %v", err)
	}
	if placeholderCount != 0 || providerEntryCount != 1 {
		t.Fatalf("Meta replay ledger = placeholder:%d providerEntries:%d, want 0/1", placeholderCount, providerEntryCount)
	}
}

func stringPointerForMetaTombstone(value string) *string {
	return &value
}
