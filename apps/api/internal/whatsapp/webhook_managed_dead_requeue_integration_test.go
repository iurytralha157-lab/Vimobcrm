package whatsapp

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/roundrobin"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// This is the operational recovery contract documented in the queue-scoped
// rollout runbook: a managed inbox row can become dead without an outcome,
// remains a hard fence against deleting its queue, is requeued without changing
// its payload/provenance, and is released only after the real native worker has
// committed both the business effects and routing outcome.
func TestManagedDeadWebhookRequeuesThroughWorkerBeforeQueueDelete(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("WHATSAPP_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("set WHATSAPP_TEST_DATABASE_URL to run the managed dead-letter recovery contract")
	}
	target, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatalf("parse WHATSAPP_TEST_DATABASE_URL: %v", err)
	}
	switch strings.ToLower(target.Hostname()) {
	case "127.0.0.1", "localhost", "::1":
	default:
		t.Fatalf("WHATSAPP_TEST_DATABASE_URL must use a loopback host, got %q", target.Hostname())
	}

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL:           databaseURL,
		MaxConns:      8,
		HealthTimeout: 5 * time.Second,
	})
	if err != nil {
		t.Fatalf("connect local PostgreSQL: %v", err)
	}
	t.Cleanup(postgres.Close)
	pool := postgres.Pool()
	suffix := fmt.Sprintf("managed-dead-requeue-%d", time.Now().UnixNano())

	var organizationID, userID string
	if err := pool.QueryRow(ctx, `
		insert into public.organizations (name, slug, is_active)
		values ($1, $1, true)
		returning id::text
	`, suffix).Scan(&organizationID); err != nil {
		t.Fatalf("insert organization: %v", err)
	}
	if err := pool.QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&userID); err != nil {
		t.Fatalf("generate user id: %v", err)
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		if _, cleanupErr := pool.Exec(cleanupCtx, `
			update public.users
			set organization_id = null
			where id = $2::uuid and organization_id = $1::uuid;
			delete from public.organizations where id = $1::uuid;
			delete from public.users where id = $2::uuid;
			delete from auth.users where id = $2::uuid
		`, organizationID, userID); cleanupErr != nil {
			t.Errorf("cleanup managed dead-letter recovery fixture: %v", cleanupErr)
		}
	})
	if _, err := pool.Exec(ctx, `
		insert into auth.users (
		  id, aud, role, email, encrypted_password, email_confirmed_at,
		  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
		) values (
		  $1::uuid, 'authenticated', 'authenticated', $2, '', now(),
		  '{}'::jsonb, '{}'::jsonb, now(), now()
		);
		insert into public.users (id, organization_id, name, email, role, is_active)
		values ($1::uuid, $3::uuid, $4, $2, 'admin', true)
		on conflict (id) do update
		set organization_id = excluded.organization_id,
		    name = excluded.name,
		    email = excluded.email,
		    role = excluded.role,
		    is_active = excluded.is_active;
		insert into public.organization_members (organization_id, user_id, role, is_active)
		values ($3::uuid, $1::uuid, 'admin', true)
		on conflict (user_id, organization_id) do update
		set role = excluded.role,
		    is_active = excluded.is_active,
		    deleted_at = null
	`, userID, suffix+"@example.invalid", organizationID, suffix); err != nil {
		t.Fatalf("insert organization user: %v", err)
	}

	var pipelineID, stageID, queueID, sessionID, ruleID string
	if err := pool.QueryRow(ctx, `
		insert into public.pipelines (
		  organization_id, name, is_default, is_active, position
		) values ($1::uuid, $2, true, true, 0)
		returning id::text
	`, organizationID, suffix+" pipeline").Scan(&pipelineID); err != nil {
		t.Fatalf("insert pipeline: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		insert into public.stages (
		  organization_id, pipeline_id, name, stage_key, position, is_active
		) values ($1::uuid, $2::uuid, $3, 'new', 0, true)
		returning id::text
	`, organizationID, pipelineID, suffix+" stage").Scan(&stageID); err != nil {
		t.Fatalf("insert stage: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		insert into public.round_robins (
		  organization_id, name, is_active, created_by, pipeline_id,
		  target_pipeline_id, target_stage_id, reentry_behavior
		) values (
		  $1::uuid, $2, true, $3::uuid, $4::uuid,
		  $4::uuid, $5::uuid, 'keep_assignee'
		)
		returning id::text
	`, organizationID, suffix+" queue", userID, pipelineID, stageID).Scan(&queueID); err != nil {
		t.Fatalf("insert queue: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		insert into public.round_robin_members (
		  organization_id, round_robin_id, user_id, position, is_active
		) values ($1::uuid, $2::uuid, $3::uuid, 0, true)
	`, organizationID, queueID, userID); err != nil {
		t.Fatalf("insert queue member: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		insert into public.whatsapp_sessions (
		  organization_id, instance_name, instance_id, owner_user_id,
		  provider, status, is_active, advanced_settings
		) values (
		  $1::uuid, $2, $2, $3::uuid,
		  'evolution_go', 'connected', true,
		  jsonb_build_object('token', $4, 'webhook_token', $5)
		)
		returning id::text
	`, organizationID, suffix, userID, suffix+"-instance-token", suffix+"-webhook-token").Scan(&sessionID); err != nil {
		t.Fatalf("insert WhatsApp session: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		insert into public.round_robin_rules (
		  organization_id, round_robin_id, match_type, match_value,
		  match, conditions, is_active, priority
		) values (
		  $1::uuid, $2::uuid, 'whatsapp_message_contains', 'Lançamento Lumy',
		  jsonb_build_object('whatsapp_session_id', $3::uuid),
		  jsonb_build_object(
		    'match_type', 'whatsapp_message_contains',
		    'match_value', 'Lançamento Lumy',
		    'match', jsonb_build_object('whatsapp_session_id', $3::uuid)
		  ),
		  true, 100
		)
		returning id::text
	`, organizationID, queueID, sessionID).Scan(&ruleID); err != nil {
		t.Fatalf("insert managed rule: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		insert into public.whatsapp_inbound_rules (
		  id, organization_id, session_id, name, priority, is_active,
		  match_type, match_value, match_field, target_round_robin_id
		) values (
		  $1::uuid, $2::uuid, $3::uuid, $4, 100, true,
		  'contains', 'Lançamento Lumy', 'message', $5::uuid
		)
	`, ruleID, organizationID, sessionID, suffix+" managed mirror", queueID); err != nil {
		t.Fatalf("insert managed inbound mirror: %v", err)
	}

	providerMessageID := "provider-managed-dead-" + strings.ReplaceAll(ruleID, "-", "")
	contactPhone := "5511" + fmt.Sprintf("%08d", time.Now().UnixNano()%100000000)
	payload := strings.ReplaceAll(
		string(readNativeFixture(t, "meta_ctwa_instagram.json")),
		"provider-meta-ctwa-instagram-1",
		providerMessageID,
	)
	payload = strings.ReplaceAll(payload, "559491298288", contactPhone)

	nativeRepo := NewRepository(postgres, nil, StorageConfig{EvolutionGo: EvolutionGoConfig{
		WebhookProcessorMode:     webhookProcessorNative,
		WebhookRolloutSessionIDs: []string{"*"},
	}})
	receipt, err := nativeRepo.AcceptEvolutionWebhook(ctx, evolutionWebhookEnvelope{
		SessionID:           sessionID,
		InstanceID:          suffix,
		InstanceName:        suffix,
		InstanceToken:       suffix + "-instance-token",
		WebhookHeaderTokens: []string{suffix + "-webhook-token"},
		EventType:           "messages.upsert",
		Payload:             []byte(payload),
		ReceivedAt:          time.Now().UTC(),
	})
	if err != nil {
		t.Fatalf("accept managed webhook: %v", err)
	}
	if receipt.Duplicate || receipt.Inline || receipt.Status != "pending" {
		t.Fatalf("managed receipt = %#v, want new durable pending row", receipt)
	}
	var processingLane string
	if err := pool.QueryRow(ctx, `
		select processing_lane
		from public.whatsapp_webhook_inbox
		where id = $1::uuid
	`, receipt.ID).Scan(&processingLane); err != nil {
		t.Fatalf("read managed processing lane: %v", err)
	}

	var managedQueueID, managedRuleID string
	if err := pool.QueryRow(ctx, `
		select
		  coalesce(snapshot->>'origin_round_robin_id', ''),
		  coalesce(snapshot->>'rule_id', '')
		from public.whatsapp_webhook_routing_snapshots
		where organization_id = $1::uuid
		  and session_id = $2::uuid
		  and provider_message_id = $3
	`, organizationID, sessionID, providerMessageID).Scan(&managedQueueID, &managedRuleID); err != nil {
		t.Fatalf("read managed routing snapshot: %v", err)
	}
	if managedQueueID != queueID || managedRuleID != ruleID {
		t.Fatalf("managed snapshot queue/rule = %s/%s, want %s/%s", managedQueueID, managedRuleID, queueID, ruleID)
	}

	// Make a single failed delivery exhaust its retry budget. The row becomes
	// dead through the production claim/dispatch/failure path, not by inserting
	// a synthetic outcome or marking it processed in the fixture.
	if _, err := pool.Exec(ctx, `
		update public.whatsapp_webhook_inbox
		set max_attempts = 1, updated_at = now()
		where id = $1::uuid
	`, receipt.ID); err != nil {
		t.Fatalf("set one-attempt dead-letter fixture: %v", err)
	}
	edgeRepo := NewRepository(postgres, nil, StorageConfig{EvolutionGo: EvolutionGoConfig{
		WebhookProcessorMode: webhookProcessorEdge,
	}})
	claimed, _, err := edgeRepo.claimEvolutionWebhooksForLane(ctx, processingLane, 256, "")
	if err != nil {
		t.Fatalf("claim managed webhook for failing worker: %v", err)
	}
	deadItem, ok := findClaimedEvolutionWebhook(claimed, receipt.ID)
	if !ok {
		t.Fatalf("managed webhook %s was not claimed; claimed %d rows", receipt.ID, len(claimed))
	}
	if err := edgeRepo.processClaimedEvolutionWebhook(ctx, deadItem); err != nil {
		t.Fatalf("finish managed dead-letter attempt: %v", err)
	}

	var status, eventKey string
	var outcomeCount int
	if err := pool.QueryRow(ctx, `
		select status, event_key
		from public.whatsapp_webhook_inbox
		where id = $1::uuid
	`, receipt.ID).Scan(&status, &eventKey); err != nil {
		t.Fatalf("read dead inbox status: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		select count(*)::integer
		from public.whatsapp_webhook_routing_outcomes
		where organization_id = $1::uuid
		  and session_id = $2::uuid
		  and provider_message_id = $3
	`, organizationID, sessionID, providerMessageID).Scan(&outcomeCount); err != nil {
		t.Fatalf("count pre-requeue outcomes: %v", err)
	}
	if status != "dead" || outcomeCount != 0 {
		t.Fatalf("failed managed delivery = status:%s outcomes:%d, want dead/0", status, outcomeCount)
	}

	roundRobinRepo := roundrobin.NewRepository(postgres)
	admin := tenant.Context{OrganizationID: organizationID, UserID: userID, MemberRole: "admin"}
	if err := roundRobinRepo.Delete(ctx, admin, queueID); !errors.Is(err, roundrobin.ErrPendingWhatsAppIntake) {
		t.Fatalf("delete with unresolved dead delivery = %v, want ErrPendingWhatsAppIntake", err)
	}

	// This is intentionally the same narrow recovery mutation documented in the
	// runbook. It preserves the payload and immutable snapshot, and is permitted
	// only while the exact dead row still has no completion outcome.
	var requeued int
	if err := pool.QueryRow(ctx, `
		with recovered as (
		  update public.whatsapp_webhook_inbox as inbox
		  set status = 'retry',
		      attempts = 0,
		      next_attempt_at = now(),
		      dead_lettered_at = null,
		      locked_at = null,
		      locked_by = null,
		      last_error = null,
		      updated_at = now()
		  where inbox.id = $1::uuid
		    and inbox.organization_id = $2::uuid
		    and inbox.session_id = $3::uuid
		    and inbox.event_key = $4
		    and inbox.status = 'dead'
		    and not exists (
		      select 1
		      from public.whatsapp_webhook_routing_outcomes as outcome
		      where outcome.organization_id = inbox.organization_id
		        and outcome.session_id = inbox.session_id
		        and outcome.completed_inbox_event_key = inbox.event_key
		    )
		  returning 1
		)
		select count(*)::integer from recovered
	`, receipt.ID, organizationID, sessionID, eventKey).Scan(&requeued); err != nil {
		t.Fatalf("requeue dead managed delivery: %v", err)
	}
	if requeued != 1 {
		t.Fatalf("requeued rows = %d, want 1", requeued)
	}

	claimed, _, err = nativeRepo.claimEvolutionWebhooksForLane(ctx, processingLane, 256, "")
	if err != nil {
		t.Fatalf("claim requeued managed webhook: %v", err)
	}
	retryItem, ok := findClaimedEvolutionWebhook(claimed, receipt.ID)
	if !ok {
		t.Fatalf("requeued managed webhook %s was not claimed; claimed %d rows", receipt.ID, len(claimed))
	}
	if err := nativeRepo.processClaimedEvolutionWebhook(ctx, retryItem); err != nil {
		t.Fatalf("process requeued managed webhook: %v", err)
	}

	var leadEntryCount int
	if err := pool.QueryRow(ctx, `
		select
		  inbox.status,
		  (
		    select count(*)::integer
		    from public.whatsapp_webhook_routing_outcomes as outcome
		    where outcome.organization_id = inbox.organization_id
		      and outcome.session_id = inbox.session_id
		      and outcome.completed_inbox_event_key = inbox.event_key
		  ),
		  (
		    select count(*)::integer
		    from public.lead_entry_events as entry
		    where entry.organization_id = inbox.organization_id
		      and entry.provider = 'whatsapp'
		      and entry.provider_event_id = $2::uuid::text || ':' || $3
		      and entry.is_countable = true
		  )
		from public.whatsapp_webhook_inbox as inbox
		where inbox.id = $1::uuid
	`, receipt.ID, sessionID, providerMessageID).Scan(&status, &outcomeCount, &leadEntryCount); err != nil {
		t.Fatalf("read processed managed recovery: %v", err)
	}
	if status != "processed" || outcomeCount != 1 || leadEntryCount != 1 {
		t.Fatalf("processed managed recovery = status:%s outcomes:%d entries:%d, want processed/1/1", status, outcomeCount, leadEntryCount)
	}

	if err := roundRobinRepo.Delete(ctx, admin, queueID); err != nil {
		t.Fatalf("delete queue after real managed outcome: %v", err)
	}
	var tombstoned bool
	if err := pool.QueryRow(ctx, `
		select deleted_at is not null and is_active = false
		from public.round_robins
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, queueID).Scan(&tombstoned); err != nil {
		t.Fatalf("read queue tombstone: %v", err)
	}
	if !tombstoned {
		t.Fatal("queue was not tombstoned after the real managed outcome")
	}
}

func findClaimedEvolutionWebhook(items []pendingEvolutionWebhook, id string) (pendingEvolutionWebhook, bool) {
	for _, item := range items {
		if item.ID == id {
			return item, true
		}
	}
	return pendingEvolutionWebhook{}, false
}
