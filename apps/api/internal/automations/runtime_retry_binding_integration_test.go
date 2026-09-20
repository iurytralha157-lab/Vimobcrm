package automations

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// AUTOMATIONS_TEST_DATABASE_URL must point to a disposable loopback database
// with the queue-scoped A1/B1 contracts installed. The explicit host check
// prevents this concurrency-sensitive fixture from ever targeting production.
func TestRetryRuntimeIssueFencesWhatsAppBindingEpoch(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("AUTOMATIONS_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("set AUTOMATIONS_TEST_DATABASE_URL to run the local binding-epoch retry contract")
	}
	parsedURL, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatalf("parse AUTOMATIONS_TEST_DATABASE_URL: %v", err)
	}
	switch strings.ToLower(parsedURL.Hostname()) {
	case "127.0.0.1", "localhost", "::1":
	default:
		t.Fatalf("AUTOMATIONS_TEST_DATABASE_URL must use a loopback host, got %q", parsedURL.Hostname())
	}

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(postgres.Close)

	suffix := fmt.Sprintf("automation-binding-retry-%d", time.Now().UnixNano())
	phone := fmt.Sprintf("55117%08d", time.Now().UnixNano()%100_000_000)
	var organizationID, userID, sessionID, conversationID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.organizations (name, slug, is_active)
		values ($1, $1, true)
		returning id::text
	`, suffix).Scan(&organizationID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		_, _ = postgres.Pool().Exec(cleanupCtx, `delete from public.organizations where id = $1::uuid`, organizationID)
		_, _ = postgres.Pool().Exec(cleanupCtx, `delete from public.users where id = $1::uuid`, userID)
		_, _ = postgres.Pool().Exec(cleanupCtx, `delete from auth.users where id = $1::uuid`, userID)
	})

	if _, err := postgres.Pool().Exec(ctx, `
		insert into auth.users (
			id, aud, role, email, encrypted_password, email_confirmed_at,
			raw_app_meta_data, raw_user_meta_data, created_at, updated_at
		) values (
			$1::uuid, 'authenticated', 'authenticated', $2, '', now(),
			'{}'::jsonb, '{}'::jsonb, now(), now()
		)
	`, userID, suffix+"@example.invalid"); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.users (id, organization_id, name, email, role, is_active)
		values ($1::uuid, $2::uuid, $3, $4, 'admin', true)
		on conflict (id) do update
		set organization_id = excluded.organization_id,
		    name = excluded.name,
		    email = excluded.email,
		    role = excluded.role,
		    is_active = excluded.is_active
	`, userID, organizationID, suffix, suffix+"@example.invalid"); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.organization_members (organization_id, user_id, role, is_active)
		values ($1::uuid, $2::uuid, 'admin', true)
		on conflict (user_id, organization_id) do update
		set role = excluded.role,
		    is_active = excluded.is_active,
		    deleted_at = null
	`, organizationID, userID); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.organization_modules (organization_id, module_name, is_enabled)
		values ($1::uuid, 'automations', true)
		on conflict (organization_id, module_name) do update set is_enabled = true
	`, organizationID); err != nil {
		t.Fatal(err)
	}

	leadIDs := make([]string, 2)
	for index := range leadIDs {
		if err := postgres.Pool().QueryRow(ctx, `
			insert into public.leads (
				organization_id, assigned_user_id, name, phone, source
			) values ($1::uuid, $2::uuid, $3, $4, 'whatsapp')
			returning id::text
		`, organizationID, userID, fmt.Sprintf("%s-lead-%d", suffix, index), fmt.Sprintf("%s%d", phone, index)).Scan(&leadIDs[index]); err != nil {
			t.Fatal(err)
		}
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_sessions (
			organization_id, instance_name, instance_id, owner_user_id,
			provider, status, is_active, advanced_settings
		) values (
			$1::uuid, $2, $2, $3::uuid,
			'evolution_go', 'connected', true, '{}'::jsonb
		)
		returning id::text
	`, organizationID, suffix+"-session", userID).Scan(&sessionID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_conversations (
			organization_id, session_id, remote_jid, contact_phone, contact_name
		) values ($1::uuid, $2::uuid, $3, $4, $5)
		returning id::text
	`, organizationID, sessionID, phone+"@s.whatsapp.net", phone, suffix+"-contact").Scan(&conversationID); err != nil {
		t.Fatal(err)
	}

	var firstBindingID string
	if err := postgres.Pool().QueryRow(ctx, `
		select result->>'binding_id'
		from (
			select public.activate_whatsapp_conversation_lead_binding(
				$1::uuid, $2::uuid, $3::uuid, null
			) as result
		) activation
	`, organizationID, conversationID, leadIDs[0]).Scan(&firstBindingID); err != nil {
		t.Fatal(err)
	}

	var messageID, eventID, capturedBindingID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_messages (
			organization_id, conversation_id, session_id, lead_id,
			provider_message_id, message_id, from_me, direction,
			message_type, content, status, metadata
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid,
			$5, $5, false, 'inbound', 'text', 'binding epoch retry',
			'received', '{"whatsapp_event_binding_is_current":true}'::jsonb
		)
		returning id::text
	`, organizationID, conversationID, sessionID, leadIDs[0], suffix+"-provider-message").Scan(&messageID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select id::text, payload->>'whatsapp_binding_id'
		from public.automation_event_outbox
		where organization_id = $1::uuid
		  and aggregate_type = 'whatsapp_message'
		  and aggregate_id = $2::uuid
	`, organizationID, messageID).Scan(&eventID, &capturedBindingID); err != nil {
		t.Fatal(err)
	}
	if capturedBindingID != firstBindingID {
		t.Fatalf("captured binding id = %q, want %q", capturedBindingID, firstBindingID)
	}

	repository := NewRepository(postgres, FunctionsConfig{}, StorageConfig{})
	manager := tenant.Context{
		OrganizationID: organizationID,
		UserID:         userID,
		MemberRole:     "admin",
	}
	setEventTerminal := func() {
		t.Helper()
		if _, err := postgres.Pool().Exec(ctx, `
			update public.automation_event_outbox
			set status = 'dead_letter',
			    dead_lettered_at = now(),
			    last_error = 'local_contract_failure',
			    locked_at = null,
			    locked_by = null
			where id = $1::uuid
		`, eventID); err != nil {
			t.Fatal(err)
		}
	}
	eventStatus := func() string {
		t.Helper()
		var status string
		if err := postgres.Pool().QueryRow(ctx, `
			select status from public.automation_event_outbox where id = $1::uuid
		`, eventID).Scan(&status); err != nil {
			t.Fatal(err)
		}
		return status
	}

	setEventTerminal()
	if err := repository.RetryRuntimeIssue(ctx, manager, "dead_letter", eventID); err != nil {
		t.Fatalf("retry current binding epoch: %v", err)
	}
	if got := eventStatus(); got != "pending" {
		t.Fatalf("current binding retry status = %q, want pending", got)
	}

	setEventTerminal()
	if _, err := postgres.Pool().Exec(ctx, `
		select public.activate_whatsapp_conversation_lead_binding(
			$1::uuid, $2::uuid, $3::uuid, null
		)
	`, organizationID, conversationID, leadIDs[1]); err != nil {
		t.Fatal(err)
	}
	if err := repository.RetryRuntimeIssue(ctx, manager, "dead_letter", eventID); !errors.Is(err, ErrRuntimeIssueNotRetryable) {
		t.Fatalf("retry after A->B = %v, want ErrRuntimeIssueNotRetryable", err)
	}
	if got := eventStatus(); got != "dead_letter" {
		t.Fatalf("stale A event status after A->B retry = %q, want dead_letter", got)
	}

	if _, err := postgres.Pool().Exec(ctx, `
		select public.activate_whatsapp_conversation_lead_binding(
			$1::uuid, $2::uuid, $3::uuid, null
		)
	`, organizationID, conversationID, leadIDs[0]); err != nil {
		t.Fatal(err)
	}
	if err := repository.RetryRuntimeIssue(ctx, manager, "dead_letter", eventID); !errors.Is(err, ErrRuntimeIssueNotRetryable) {
		t.Fatalf("retry after A->B->A = %v, want ErrRuntimeIssueNotRetryable", err)
	}
	if got := eventStatus(); got != "dead_letter" {
		t.Fatalf("old A epoch status after ABA retry = %q, want dead_letter", got)
	}

	var leadOnlyEventID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.automation_event_outbox (
			organization_id, event_type, aggregate_type, aggregate_id,
			lead_id, conversation_id, dedupe_key, payload, status,
			dead_lettered_at, last_error
		) values (
			$1::uuid, 'scheduled', 'lead', $2::uuid,
			$2::uuid, null, $3, jsonb_build_object('lead_id', $2::uuid),
			'dead_letter', now(), 'local_lead_only_failure'
		)
		returning id::text
	`, organizationID, leadIDs[0], suffix+"-lead-only-event").Scan(&leadOnlyEventID); err != nil {
		t.Fatal(err)
	}
	if err := repository.RetryRuntimeIssue(ctx, manager, "dead_letter", leadOnlyEventID); err != nil {
		t.Fatalf("retry lead-only event: %v", err)
	}

	insertCurrentMessageEvent := func(label string) string {
		t.Helper()
		var currentLeadID, currentBindingID, insertedMessageID, insertedEventID string
		if err := postgres.Pool().QueryRow(ctx, `
			select conversation.lead_id::text, binding.id::text
			from public.whatsapp_conversations conversation
			join public.whatsapp_conversation_lead_bindings binding
			  on binding.organization_id = conversation.organization_id
			 and binding.conversation_id = conversation.id
			 and binding.session_id = conversation.session_id
			 and binding.lead_id = conversation.lead_id
			 and binding.active_to is null
			where conversation.id = $1::uuid
		`, conversationID).Scan(&currentLeadID, &currentBindingID); err != nil {
			t.Fatal(err)
		}
		if err := postgres.Pool().QueryRow(ctx, `
			insert into public.whatsapp_messages (
				organization_id, conversation_id, session_id, lead_id,
				provider_message_id, message_id, from_me, direction,
				message_type, content, status, metadata
			) values (
				$1::uuid, $2::uuid, $3::uuid, $4::uuid,
				$5, $5, false, 'inbound', 'text', $5,
				'received', '{"whatsapp_event_binding_is_current":true}'::jsonb
			)
			returning id::text
		`, organizationID, conversationID, sessionID, currentLeadID, suffix+"-"+label).Scan(&insertedMessageID); err != nil {
			t.Fatal(err)
		}
		var eventBindingID string
		if err := postgres.Pool().QueryRow(ctx, `
			select id::text, payload->>'whatsapp_binding_id'
			from public.automation_event_outbox
			where organization_id = $1::uuid
			  and aggregate_id = $2::uuid
		`, organizationID, insertedMessageID).Scan(&insertedEventID, &eventBindingID); err != nil {
			t.Fatal(err)
		}
		if eventBindingID != currentBindingID {
			t.Fatalf("%s event binding = %q, want %q", label, eventBindingID, currentBindingID)
		}
		if _, err := postgres.Pool().Exec(ctx, `
			update public.automation_event_outbox
			set status = 'dead_letter', dead_lettered_at = now(),
			    last_error = 'local_concurrency_fixture'
			where id = $1::uuid
		`, insertedEventID); err != nil {
			t.Fatal(err)
		}
		return insertedEventID
	}
	waitForBlockedQuery := func(fragment string) {
		t.Helper()
		deadline := time.Now().Add(5 * time.Second)
		for time.Now().Before(deadline) {
			var blocked bool
			if err := postgres.Pool().QueryRow(ctx, `
				select exists (
				  select 1
				  from pg_catalog.pg_stat_activity activity
				  where activity.datname = pg_catalog.current_database()
				    and activity.pid <> pg_catalog.pg_backend_pid()
				    and activity.state = 'active'
				    and activity.wait_event_type = 'Lock'
				    and activity.query ilike '%' || $1 || '%'
				)
			`, fragment).Scan(&blocked); err != nil {
				t.Fatal(err)
			}
			if blocked {
				return
			}
			time.Sleep(20 * time.Millisecond)
		}
		t.Fatalf("query containing %q did not reach the expected lock wait", fragment)
	}
	type asyncResult struct{ err error }

	// ON DELETE SET NULL must never downgrade a WhatsApp event into the generic
	// lead-only retry branch. Its immutable payload still proves it originated
	// from a deleted conversation/binding epoch.
	var deletedConversationID, deletedMessageID, deletedEventID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_conversations (
			organization_id, session_id, remote_jid, contact_phone, contact_name
		) values ($1::uuid, $2::uuid, $3, $4, $5)
		returning id::text
	`, organizationID, sessionID, phone+"99@s.whatsapp.net", phone+"99", suffix+"-deleted-contact").Scan(&deletedConversationID); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		select public.activate_whatsapp_conversation_lead_binding(
			$1::uuid, $2::uuid, $3::uuid, null
		)
	`, organizationID, deletedConversationID, leadIDs[1]); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_messages (
			organization_id, conversation_id, session_id, lead_id,
			provider_message_id, message_id, from_me, direction,
			message_type, content, status, metadata
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid,
			$5, $5, false, 'inbound', 'text', 'deleted conversation event',
			'received', '{"whatsapp_event_binding_is_current":true}'::jsonb
		)
		returning id::text
	`, organizationID, deletedConversationID, sessionID, leadIDs[1], suffix+"-deleted-conversation-message").Scan(&deletedMessageID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select id::text
		from public.automation_event_outbox
		where aggregate_id = $1::uuid
	`, deletedMessageID).Scan(&deletedEventID); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.automation_event_outbox
		set status = 'dead_letter', dead_lettered_at = now(),
		    last_error = 'deleted_conversation_fixture'
		where id = $1::uuid
	`, deletedEventID); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		delete from public.whatsapp_conversations where id = $1::uuid
	`, deletedConversationID); err != nil {
		t.Fatal(err)
	}
	if err := repository.RetryRuntimeIssue(ctx, manager, "dead_letter", deletedEventID); !errors.Is(err, ErrRuntimeIssueNotRetryable) {
		t.Fatalf("retry after conversation deletion = %v, want ErrRuntimeIssueNotRetryable", err)
	}

	// retry -> rebind: hold only the event row, let retry acquire conversation
	// and wait on the event, then start the rebind behind the conversation lock.
	retryFirstEventID := insertCurrentMessageEvent("retry-first")
	eventBlocker, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := eventBlocker.Exec(ctx, `
		select id from public.automation_event_outbox where id = $1::uuid for update
	`, retryFirstEventID); err != nil {
		_ = eventBlocker.Rollback(ctx)
		t.Fatal(err)
	}
	retryDone := make(chan asyncResult, 1)
	go func() {
		retryDone <- asyncResult{err: repository.RetryRuntimeIssue(
			ctx, manager, "dead_letter", retryFirstEventID,
		)}
	}()
	waitForBlockedQuery("with event_route as materialized")
	rebindDone := make(chan asyncResult, 1)
	go func() {
		_, rebindErr := postgres.Pool().Exec(ctx, `
			select public.activate_whatsapp_conversation_lead_binding(
				$1::uuid, $2::uuid, $3::uuid, null
			)
		`, organizationID, conversationID, leadIDs[1])
		rebindDone <- asyncResult{err: rebindErr}
	}()
	if err := eventBlocker.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if result := <-retryDone; result.err != nil {
		t.Fatalf("retry-first retry: %v", result.err)
	}
	if result := <-rebindDone; result.err != nil {
		t.Fatalf("retry-first rebind: %v", result.err)
	}
	var retryFirstStatus string
	if err := postgres.Pool().QueryRow(ctx, `
		select status from public.automation_event_outbox where id = $1::uuid
	`, retryFirstEventID).Scan(&retryFirstStatus); err != nil {
		t.Fatal(err)
	}
	if retryFirstStatus != "dead_letter" {
		t.Fatalf("retry-first final status = %q, want dead_letter after rebind", retryFirstStatus)
	}

	// rebind -> retry: restore A, capture a fresh A epoch, perform A->B while
	// holding the transaction open, then prove the waiting retry rejects it.
	if _, err := postgres.Pool().Exec(ctx, `
		select public.activate_whatsapp_conversation_lead_binding(
			$1::uuid, $2::uuid, $3::uuid, null
		)
	`, organizationID, conversationID, leadIDs[0]); err != nil {
		t.Fatal(err)
	}
	rebindFirstEventID := insertCurrentMessageEvent("rebind-first")
	rebindTransaction, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := rebindTransaction.Exec(ctx, `
		select id
		from public.whatsapp_conversations
		where id = $1::uuid
		for no key update
	`, conversationID); err != nil {
		_ = rebindTransaction.Rollback(ctx)
		t.Fatal(err)
	}
	if _, err := rebindTransaction.Exec(ctx, `
		select public.activate_whatsapp_conversation_lead_binding(
			$1::uuid, $2::uuid, $3::uuid, null
		)
	`, organizationID, conversationID, leadIDs[1]); err != nil {
		_ = rebindTransaction.Rollback(ctx)
		t.Fatal(err)
	}
	rebindFirstRetryDone := make(chan asyncResult, 1)
	go func() {
		rebindFirstRetryDone <- asyncResult{err: repository.RetryRuntimeIssue(
			ctx, manager, "dead_letter", rebindFirstEventID,
		)}
	}()
	waitForBlockedQuery("with event_route as materialized")
	if err := rebindTransaction.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if result := <-rebindFirstRetryDone; !errors.Is(result.err, ErrRuntimeIssueNotRetryable) {
		t.Fatalf("rebind-first retry = %v, want ErrRuntimeIssueNotRetryable", result.err)
	}

	// claim(exhausted) -> retry: pause the exhaustion update after it owns the
	// event row. The hardened claim must already own the conversation at that
	// point, so RetryRuntimeIssue waits on the conversation instead of forming
	// the old event -> conversation / conversation -> event 40P01 cycle.
	exhaustedEventID := insertCurrentMessageEvent("claim-exhausted")
	pendingEventID := insertCurrentMessageEvent("claim-pending-same-conversation")
	retryTargetEventID := insertCurrentMessageEvent("claim-retry-target")
	if _, err := postgres.Pool().Exec(ctx, `
		update public.automation_event_outbox
		set status = 'processing',
		    attempts = max_attempts,
		    locked_at = now() - interval '10 minutes',
		    locked_by = 'automation-claim-fence-barrier',
		    dead_lettered_at = null,
		    last_error = null,
		    available_at = now()
		where id = $1::uuid;

		update public.automation_event_outbox
		set status = 'pending',
		    attempts = 0,
		    locked_at = null,
		    locked_by = null,
		    dead_lettered_at = null,
		    last_error = null,
		    available_at = now()
		where id = $2::uuid;

		update public.automation_event_outbox
		set last_error = 'automation-claim-retry-target'
		where id = $3::uuid
	`, exhaustedEventID, pendingEventID, retryTargetEventID); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		drop trigger if exists automation_claim_binding_fence_test_pause
		  on public.automation_event_outbox;
		drop function if exists public.automation_claim_binding_fence_test_pause();
		create function public.automation_claim_binding_fence_test_pause()
		returns trigger
		language plpgsql
		set search_path = ''
		as $trigger$
		begin
		  if old.status = 'processing'
		     and old.locked_by = 'automation-claim-fence-barrier'
		     and new.status = 'dead_letter' then
		    perform 1
		    from public.automation_event_outbox as retry_target
		    where retry_target.last_error = 'automation-claim-retry-target'
		    for update;
		    perform pg_catalog.pg_advisory_xact_lock(194919, 1);
		  end if;
		  return new;
		end;
		$trigger$;
		create trigger automation_claim_binding_fence_test_pause
		before update on public.automation_event_outbox
		for each row
		execute function public.automation_claim_binding_fence_test_pause()
	`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		_, _ = postgres.Pool().Exec(cleanupCtx, `
			drop trigger if exists automation_claim_binding_fence_test_pause
			  on public.automation_event_outbox;
			drop function if exists public.automation_claim_binding_fence_test_pause()
		`)
	})

	barrierConnection, err := postgres.Pool().Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer barrierConnection.Release()
	barrierHeld := true
	if _, err := barrierConnection.Exec(ctx, `select pg_catalog.pg_advisory_lock(194919, 1)`); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if barrierHeld {
			_, _ = barrierConnection.Exec(context.Background(), `select pg_catalog.pg_advisory_unlock(194919, 1)`)
		}
	}()

	type claimResult struct {
		claimed int
		err     error
	}
	claimDone := make(chan claimResult, 1)
	go func() {
		var claimed int
		err := postgres.Pool().QueryRow(ctx, `
			select count(*)::integer
			from public.claim_automation_events('automation-claim-fence-worker', 25)
		`).Scan(&claimed)
		claimDone <- claimResult{claimed: claimed, err: err}
	}()
	waitForBlockedQuery("claim_automation_events('automation-claim-fence-worker'")

	retryAgainstExhaustionDone := make(chan asyncResult, 1)
	go func() {
		retryAgainstExhaustionDone <- asyncResult{err: repository.RetryRuntimeIssue(
			ctx, manager, "dead_letter", retryTargetEventID,
		)}
	}()
	waitForBlockedQuery("with event_route as materialized")

	if _, err := barrierConnection.Exec(ctx, `select pg_catalog.pg_advisory_unlock(194919, 1)`); err != nil {
		t.Fatal(err)
	}
	barrierHeld = false
	if result := <-claimDone; result.err != nil {
		t.Fatalf("claim while retry waits on the canonical conversation lock: %v", result.err)
	}
	if result := <-retryAgainstExhaustionDone; result.err != nil {
		t.Fatalf("retry after exhaustion claim released its conversation lock: %v", result.err)
	}

	// Exercise both enqueue/rebind orders against the real RPCs. The fixtures
	// deliberately keep the two transactions open at the conversation fence so
	// success proves serialization rather than scheduler luck.
	var fenceAutomationID, fenceFlowVersionID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.automations (
			organization_id, name, is_active, trigger_type,
			trigger_config, flow_definition
		) values ($1::uuid, $2, false, 'manual', '{}'::jsonb, '{}'::jsonb)
		returning id::text
	`, organizationID, suffix+"-enqueue-fence").Scan(&fenceAutomationID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.automation_flow_versions (
			automation_id, organization_id, version, trigger_type,
			trigger_config, graph, graph_checksum, first_node_key,
			requires_review, created_by
		) values (
			$1::uuid, $2::uuid, 1, 'manual', '{}'::jsonb,
			jsonb_build_object(
				'nodes', jsonb_build_array(jsonb_build_object(
					'id', 'send', 'type', 'action',
					'action_type', 'send_whatsapp',
					'config', jsonb_build_object('session_id', $3::text)
				)),
				'connections', '[]'::jsonb,
				'settings', '{}'::jsonb
			),
			$4, 'send', false, $5::uuid
		)
		returning id::text
	`, fenceAutomationID, organizationID, sessionID, suffix+"-enqueue-fence-v1", userID).Scan(&fenceFlowVersionID); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.automations
		set active_flow_version_id = $2::uuid, is_active = true
		where id = $1::uuid
	`, fenceAutomationID, fenceFlowVersionID); err != nil {
		t.Fatal(err)
	}
	fenceLeadIDs := make([]string, 4)
	for index := range fenceLeadIDs {
		fenceLeadPhone := fmt.Sprintf(
			"55115%07d",
			(time.Now().UnixNano()+int64(index))%10_000_000,
		)
		if err := postgres.Pool().QueryRow(ctx, `
			insert into public.leads (
				organization_id, assigned_user_id, name, phone, source
			) values ($1::uuid, $2::uuid, $3, $4, 'manual')
			returning id::text
		`, organizationID, userID, fmt.Sprintf("%s-enqueue-lead-%d", suffix, index), fenceLeadPhone).Scan(&fenceLeadIDs[index]); err != nil {
			t.Fatal(err)
		}
	}

	conversationSequence := int64(0)
	createBoundConversation := func(leadID string) string {
		t.Helper()
		conversationSequence++
		conversationPhone := fmt.Sprintf(
			"55118%07d",
			(time.Now().UnixNano()+conversationSequence)%10_000_000,
		)
		var createdConversationID string
		if err := postgres.Pool().QueryRow(ctx, `
			insert into public.whatsapp_conversations (
				organization_id, session_id, remote_jid,
				contact_phone, contact_name, is_group
			) values ($1::uuid, $2::uuid, $3, $4, $5, false)
			returning id::text
		`, organizationID, sessionID, conversationPhone+"@s.whatsapp.net", conversationPhone, suffix+"-enqueue-contact").Scan(&createdConversationID); err != nil {
			t.Fatal(err)
		}
		if _, err := postgres.Pool().Exec(ctx, `
			select public.activate_whatsapp_conversation_lead_binding(
				$1::uuid, $2::uuid, $3::uuid, null
			)
		`, organizationID, createdConversationID, leadID); err != nil {
			t.Fatal(err)
		}
		return createdConversationID
	}
	type executionFixture struct {
		id        string
		lease     string
		effectKey string
	}
	createExecution := func(conversationID, leadID, label, executionStatus, dispatchStatus string) executionFixture {
		t.Helper()
		fixture := executionFixture{lease: suffix + "-" + label + "-lease"}
		if err := postgres.Pool().QueryRow(ctx, `
			insert into public.automation_executions (
				automation_id, flow_version_id, organization_id, lead_id,
				conversation_id, status, current_node_key, locked_by,
				locked_at, completed_at, attempt_count
			) values (
				$1::uuid, $2::uuid, $3::uuid, $4::uuid,
				$5::uuid, $6, 'send',
				case when $6 = 'running' then $7 else null end,
				case when $6 = 'running' then now() else null end,
				case when $6 = 'completed' then now() else null end,
				1
			)
			returning id::text
		`, fenceAutomationID, fenceFlowVersionID, organizationID, leadID, conversationID, executionStatus, fixture.lease).Scan(&fixture.id); err != nil {
			t.Fatal(err)
		}
		fixture.effectKey = "automation:" + fixture.id + ":send:send_whatsapp"
		if _, err := postgres.Pool().Exec(ctx, `
			insert into public.automation_effect_dispatches (
				organization_id, execution_id, node_key, effect_key,
				effect_type, status, request
			) values (
				$1::uuid, $2::uuid, 'send', $3,
				'send_whatsapp', $4,
				jsonb_build_object(
					'delivery_contract', 'canonical_whatsapp_outbox_v1',
					'session_id', $5::text
				)
			)
		`, organizationID, fixture.id, fixture.effectKey, dispatchStatus, sessionID); err != nil {
			t.Fatal(err)
		}
		return fixture
	}
	enqueueSQL := `
		select public.enqueue_automation_whatsapp_outbox(
			$1::uuid, $2::uuid, 'send', $3, $4,
			$5::uuid, $6::uuid, $4,
			'text', $7, null, null, null, null
		)
	`

	// enqueue-first: enqueue and terminalize the execution in one transaction,
	// then let the waiting rebind cancel the newly queued delivery.
	enqueueFirstConversationID := createBoundConversation(fenceLeadIDs[0])
	enqueueFirstExecution := createExecution(
		enqueueFirstConversationID,
		fenceLeadIDs[0],
		"enqueue-first",
		"running",
		"sending",
	)
	enqueueTransaction, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var enqueueFirstResponse []byte
	if err := enqueueTransaction.QueryRow(
		ctx,
		enqueueSQL,
		organizationID,
		enqueueFirstExecution.id,
		enqueueFirstExecution.lease,
		enqueueFirstExecution.effectKey,
		enqueueFirstConversationID,
		sessionID,
		"enqueue-first binding fence",
	).Scan(&enqueueFirstResponse); err != nil {
		_ = enqueueTransaction.Rollback(ctx)
		t.Fatal(err)
	}
	if _, err := enqueueTransaction.Exec(ctx, `
		update public.automation_executions
		set status = 'completed', completed_at = now(),
		    locked_at = null, locked_by = null
		where id = $1::uuid
	`, enqueueFirstExecution.id); err != nil {
		_ = enqueueTransaction.Rollback(ctx)
		t.Fatal(err)
	}
	enqueueFirstRebindDone := make(chan asyncResult, 1)
	go func() {
		_, rebindErr := postgres.Pool().Exec(ctx, `
			select public.activate_whatsapp_conversation_lead_binding(
				$1::uuid, $2::uuid, $3::uuid, null
			)
		`, organizationID, enqueueFirstConversationID, fenceLeadIDs[1])
		enqueueFirstRebindDone <- asyncResult{err: rebindErr}
	}()
	waitForBlockedQuery("activate_whatsapp_conversation_lead_binding")
	if err := enqueueTransaction.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if result := <-enqueueFirstRebindDone; result.err != nil {
		t.Fatalf("enqueue-first rebind: %v", result.err)
	}
	var enqueueFirstOutboxStatus string
	if err := postgres.Pool().QueryRow(ctx, `
		select status
		from public.whatsapp_outbox
		where organization_id = $1::uuid
		  and client_message_id = $2
	`, organizationID, enqueueFirstExecution.effectKey).Scan(&enqueueFirstOutboxStatus); err != nil {
		t.Fatal(err)
	}
	if enqueueFirstOutboxStatus != "dead" {
		t.Fatalf("enqueue-first outbox status = %q, want dead", enqueueFirstOutboxStatus)
	}

	// rebind-first: begin with terminal execution/effect rows so the switch can
	// pass, make them adversarially stale while its conversation lock is held,
	// and prove the waiting enqueue rolls back without an A message/outbox.
	rebindFirstConversationID := createBoundConversation(fenceLeadIDs[2])
	rebindFirstExecution := createExecution(
		rebindFirstConversationID,
		fenceLeadIDs[2],
		"rebind-first",
		"completed",
		"failed",
	)
	rebindFirstTransaction, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var rebindFirstResponse []byte
	if err := rebindFirstTransaction.QueryRow(ctx, `
		select public.activate_whatsapp_conversation_lead_binding(
			$1::uuid, $2::uuid, $3::uuid, null
		)
	`, organizationID, rebindFirstConversationID, fenceLeadIDs[3]).Scan(&rebindFirstResponse); err != nil {
		_ = rebindFirstTransaction.Rollback(ctx)
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.automation_executions
		set status = 'running', completed_at = null,
		    locked_by = $2, locked_at = now()
		where id = $1::uuid;

		update public.automation_effect_dispatches
		set status = 'sending', response = '{}'::jsonb,
		    completed_at = null, error_message = null
		where effect_key = $3
	`, rebindFirstExecution.id, rebindFirstExecution.lease, rebindFirstExecution.effectKey); err != nil {
		_ = rebindFirstTransaction.Rollback(ctx)
		t.Fatal(err)
	}
	rebindFirstEnqueueDone := make(chan asyncResult, 1)
	go func() {
		var response []byte
		enqueueErr := postgres.Pool().QueryRow(
			ctx,
			enqueueSQL,
			organizationID,
			rebindFirstExecution.id,
			rebindFirstExecution.lease,
			rebindFirstExecution.effectKey,
			rebindFirstConversationID,
			sessionID,
			"rebind-first must not enqueue",
		).Scan(&response)
		rebindFirstEnqueueDone <- asyncResult{err: enqueueErr}
	}()
	waitForBlockedQuery("enqueue_automation_whatsapp_outbox")
	if err := rebindFirstTransaction.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	rebindFirstEnqueueResult := <-rebindFirstEnqueueDone
	var rebindFirstPGError *pgconn.PgError
	if !errors.As(rebindFirstEnqueueResult.err, &rebindFirstPGError) || rebindFirstPGError.Code != "23514" {
		t.Fatalf("rebind-first enqueue = %v, want SQLSTATE 23514", rebindFirstEnqueueResult.err)
	}
	var rebindFirstMessageRows, rebindFirstOutboxRows int
	if err := postgres.Pool().QueryRow(ctx, `
		select
		  (select count(*)::integer
		   from public.whatsapp_messages
		   where organization_id = $1::uuid and client_message_id = $2),
		  (select count(*)::integer
		   from public.whatsapp_outbox
		   where organization_id = $1::uuid and client_message_id = $2)
	`, organizationID, rebindFirstExecution.effectKey).Scan(
		&rebindFirstMessageRows,
		&rebindFirstOutboxRows,
	); err != nil {
		t.Fatal(err)
	}
	if rebindFirstMessageRows != 0 || rebindFirstOutboxRows != 0 {
		t.Fatalf(
			"rebind-first stale A rows = messages:%d outbox:%d, want zero",
			rebindFirstMessageRows,
			rebindFirstOutboxRows,
		)
	}
}
