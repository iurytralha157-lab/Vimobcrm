package whatsapp

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	leadsrepo "github.com/vimob-crm/vimob-crm/apps/api/internal/leads"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestResolveNativeStatusTransportTargetsRejectsCrossColumnCollision(t *testing.T) {
	const identity = "provider-card-a"
	candidates := []nativeStatusTransportTarget{
		{
			MessageRowID:      "message-a",
			ConversationID:    "conversation",
			LeadID:            "lead-a",
			MessageID:         identity,
			ProviderMessageID: identity,
			MessageStatus:     "sent",
		},
		{
			MessageRowID:            "message-b",
			ConversationID:          "conversation",
			LeadID:                  "lead-b",
			MessageID:               "provider-card-b",
			ClientMessageID:         identity,
			MessageStatus:           "queued",
			OutboxID:                "outbox-b",
			OutboxMessageRowID:      "message-b",
			OutboxConversationID:    "conversation",
			OutboxProviderMessageID: "provider-card-b",
			OutboxClientMessageID:   identity,
			OutboxStatus:            "pending",
		},
	}

	if _, _, err := resolveNativeStatusTransportTargets([]string{identity}, candidates); !errors.Is(err, errNativeEvolutionTransportIdentityConflict) {
		t.Fatalf("cross-column status identity error = %v, want transport identity conflict", err)
	}
}

func TestResolveNativeStatusTransportTargetsReturnsCanonicalPair(t *testing.T) {
	const identity = "provider-canonical"
	candidate := nativeStatusTransportTarget{
		MessageRowID:            "message",
		ConversationID:          "conversation",
		LeadID:                  "lead",
		MessageID:               identity,
		ProviderMessageID:       identity,
		ClientMessageID:         "client",
		MessageStatus:           "sent",
		OutboxID:                "outbox",
		OutboxMessageRowID:      "message",
		OutboxConversationID:    "conversation",
		OutboxProviderMessageID: identity,
		OutboxClientMessageID:   "client",
		OutboxStatus:            "sent",
	}

	targets, matched, err := resolveNativeStatusTransportTargets([]string{identity}, []nativeStatusTransportTarget{candidate})
	if err != nil {
		t.Fatal(err)
	}
	if len(targets) != 1 || targets[0].MessageRowID != candidate.MessageRowID || !matched[identity] {
		t.Fatalf("canonical status resolution = targets:%#v matched:%#v", targets, matched)
	}
}

func TestNativeTransportIdentityCollisionFailsClosedAcrossRebind(t *testing.T) {
	databaseURL := os.Getenv("WHATSAPP_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("WHATSAPP_TEST_DATABASE_URL is not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(postgres.Close)

	suffix := fmt.Sprintf("wa-transport-collision-%d", time.Now().UnixNano())
	remoteJID := "5511999910404@s.whatsapp.net"
	var organizationID, userID, leadAID, leadBID, sessionID, conversationID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.organizations (name, slug)
		values ($1, $1)
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
		_, _ = postgres.Pool().Exec(cleanupCtx, `delete from auth.users where id = $1::uuid`, userID)
	})

	if _, err := postgres.Pool().Exec(ctx, `
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
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.leads (organization_id, assigned_user_id, name, phone, source)
		values ($1::uuid, $2::uuid, $3, '5511999910404', 'whatsapp')
		returning id::text
	`, organizationID, userID, suffix+"-a").Scan(&leadAID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.leads (organization_id, assigned_user_id, name, phone, source)
		values ($1::uuid, $2::uuid, $3, '5511999910505', 'whatsapp')
		returning id::text
	`, organizationID, userID, suffix+"-b").Scan(&leadBID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_sessions (
		  organization_id, instance_name, instance_id, owner_user_id,
		  provider, status, is_active
		) values ($1::uuid, $2, $2, $3::uuid, 'evolution_go', 'connected', true)
		returning id::text
	`, organizationID, suffix, userID).Scan(&sessionID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_conversations (
		  organization_id, session_id, remote_jid, contact_phone,
		  contact_name, unread_count
		) values ($1::uuid, $2::uuid, $3, '5511999910404', $4, 0)
		returning id::text
	`, organizationID, sessionID, remoteJID, suffix).Scan(&conversationID); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		select public.activate_whatsapp_conversation_lead_binding(
		  $1::uuid, $2::uuid, $3::uuid, null
		)
	`, organizationID, conversationID, leadAID); err != nil {
		t.Fatal(err)
	}

	deleteIdentity := suffix + "-delete-x"
	reactionIdentity := suffix + "-reaction-x"
	statusIdentity := suffix + "-status-x"
	insertMessage := func(
		leadID string,
		messageID string,
		providerMessageID string,
		clientMessageID string,
		content string,
		status string,
		fromMe bool,
	) string {
		t.Helper()
		direction := "inbound"
		if fromMe {
			direction = "outbound"
		}
		var rowID string
		if err := postgres.Pool().QueryRow(ctx, `
			insert into public.whatsapp_messages (
			  organization_id, conversation_id, session_id, lead_id,
			  provider_message_id, message_id, client_message_id,
			  from_me, direction, message_type, content, remote_jid,
			  status, sent_at
			) values (
			  $1::uuid, $2::uuid, $3::uuid, $4::uuid,
			  nullif($5, ''), nullif($6, ''), nullif($7, ''),
			  $8, $9, 'text', $10, $11, $12, now()
			)
			returning id::text
		`, organizationID, conversationID, sessionID, leadID,
			providerMessageID, messageID, clientMessageID,
			fromMe, direction, content, remoteJID, status).Scan(&rowID); err != nil {
			t.Fatal(err)
		}
		return rowID
	}

	deleteARowID := insertMessage(leadAID, deleteIdentity, deleteIdentity, "", "delete-a", "received", false)
	reactionARowID := insertMessage(leadAID, reactionIdentity, reactionIdentity, "", "reaction-a", "received", false)
	statusARowID := insertMessage(leadAID, statusIdentity, statusIdentity, "", "status-a", "sent", true)

	if _, err := postgres.Pool().Exec(ctx, `
		select public.activate_whatsapp_conversation_lead_binding(
		  $1::uuid, $2::uuid, $3::uuid, null
		)
	`, organizationID, conversationID, leadBID); err != nil {
		t.Fatal(err)
	}

	deleteBProviderID := deterministicProviderMessageID(deleteIdentity)
	reactionBProviderID := deterministicProviderMessageID(reactionIdentity)
	statusBProviderID := deterministicProviderMessageID(statusIdentity)
	deleteBRowID := insertMessage(leadBID, deleteBProviderID, "", deleteIdentity, "delete-b", "queued", true)
	reactionBRowID := insertMessage(leadBID, reactionBProviderID, "", reactionIdentity, "reaction-b", "queued", true)
	statusBRowID := insertMessage(leadBID, statusBProviderID, "", statusIdentity, "status-b", "queued", true)

	var statusOutboxID, statusOutboxProviderID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_outbox (
		  organization_id, session_id, conversation_id, message_id,
		  client_message_id, recipient_jid, message_type, payload, status
		) values (
		  $1::uuid, $2::uuid, $3::uuid, $4::uuid,
		  $5, $6, 'text',
		  jsonb_build_object(
		    'action', 'send.text',
		    'body', jsonb_build_object('number', '5511999910404', 'text', 'status-b')
		  ),
		  'pending'
		)
		returning id::text, provider_message_id
	`, organizationID, sessionID, conversationID, statusBRowID, statusIdentity, remoteJID).Scan(
		&statusOutboxID,
		&statusOutboxProviderID,
	); err != nil {
		t.Fatal(err)
	}
	if statusOutboxProviderID != statusBProviderID {
		t.Fatalf("status outbox provider id = %q, want %q", statusOutboxProviderID, statusBProviderID)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_conversations
		set last_message = 'card-b-summary',
		    last_message_preview = 'card-b-summary',
		    last_message_at = now()
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, conversationID); err != nil {
		t.Fatal(err)
	}

	session := nativeEvolutionSession{ID: sessionID, OrganizationID: organizationID}
	deletionTx, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	deletionErr := processNativeEvolutionDeletion(ctx, deletionTx, session, nativeEvolutionMessage{
		ProviderMessageID: suffix + "-delete-event",
		DeletionTargetID:  deleteIdentity,
	})
	_ = deletionTx.Rollback(context.Background())
	if !errors.Is(deletionErr, errNativeEvolutionTransportIdentityConflict) {
		t.Fatalf("cross-card deletion error = %v, want transport identity conflict", deletionErr)
	}

	reactionTx, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	reactionErr := processNativeEvolutionReaction(ctx, reactionTx, session, nativeEvolutionMessage{
		ProviderMessageID: suffix + "-reaction-event",
		RemoteJID:         remoteJID,
		SenderJID:         remoteJID,
		ReactionTargetID:  reactionIdentity,
		ReactionEmoji:     "👍",
		SentAt:            time.Now().UTC(),
	})
	_ = reactionTx.Rollback(context.Background())
	if !errors.Is(reactionErr, errNativeEvolutionTransportIdentityConflict) {
		t.Fatalf("cross-card reaction error = %v, want transport identity conflict", reactionErr)
	}

	repo := NewRepository(postgres, nil, StorageConfig{})
	statusErr := repo.processNativeEvolutionStatuses(ctx, pendingEvolutionWebhook{
		OrganizationID: organizationID,
		SessionID:      sessionID,
	}, []nativeEvolutionStatus{{
		MessageIDs: []string{statusIdentity},
		Status:     "delivered",
		OccurredAt: time.Now().UTC(),
	}})
	if !errors.Is(statusErr, errNativeEvolutionTransportIdentityConflict) {
		t.Fatalf("cross-card status error = %v, want transport identity conflict", statusErr)
	}

	type messageSnapshot struct {
		content string
		kind    string
		status  string
		leadID  string
	}
	readMessage := func(rowID string) messageSnapshot {
		t.Helper()
		var snapshot messageSnapshot
		if err := postgres.Pool().QueryRow(ctx, `
			select coalesce(content, ''), message_type, status, coalesce(lead_id::text, '')
			from public.whatsapp_messages
			where organization_id = $1::uuid and id = $2::uuid
		`, organizationID, rowID).Scan(&snapshot.content, &snapshot.kind, &snapshot.status, &snapshot.leadID); err != nil {
			t.Fatal(err)
		}
		return snapshot
	}
	for label, assertion := range map[string]struct {
		rowID string
		want  messageSnapshot
	}{
		"delete A":   {deleteARowID, messageSnapshot{"delete-a", "text", "received", leadAID}},
		"delete B":   {deleteBRowID, messageSnapshot{"delete-b", "text", "queued", leadBID}},
		"reaction A": {reactionARowID, messageSnapshot{"reaction-a", "text", "received", leadAID}},
		"reaction B": {reactionBRowID, messageSnapshot{"reaction-b", "text", "queued", leadBID}},
		"status A":   {statusARowID, messageSnapshot{"status-a", "text", "sent", leadAID}},
		"status B":   {statusBRowID, messageSnapshot{"status-b", "text", "queued", leadBID}},
	} {
		if got := readMessage(assertion.rowID); got != assertion.want {
			t.Fatalf("%s snapshot = %#v, want %#v", label, got, assertion.want)
		}
	}

	var reactionCount int
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::integer
		from public.whatsapp_message_reactions
		where organization_id = $1::uuid
		  and provider_reaction_message_id = $2
	`, organizationID, suffix+"-reaction-event").Scan(&reactionCount); err != nil {
		t.Fatal(err)
	}
	var outboxStatus, conversationSummary, currentLeadID string
	if err := postgres.Pool().QueryRow(ctx, `
		select
		  (select status from public.whatsapp_outbox where id = $1::uuid),
		  conversation.last_message,
		  conversation.lead_id::text
		from public.whatsapp_conversations as conversation
		where conversation.organization_id = $2::uuid
		  and conversation.id = $3::uuid
	`, statusOutboxID, organizationID, conversationID).Scan(&outboxStatus, &conversationSummary, &currentLeadID); err != nil {
		t.Fatal(err)
	}
	if reactionCount != 0 || outboxStatus != "pending" || conversationSummary != "card-b-summary" || currentLeadID != leadBID {
		t.Fatalf(
			"fail-closed state = reactions:%d outbox:%q summary:%q lead:%q",
			reactionCount,
			outboxStatus,
			conversationSummary,
			currentLeadID,
		)
	}
}

func TestNativeMessageMutationLockOrderWithRebindAndFinalizer(t *testing.T) {
	databaseURL := os.Getenv("WHATSAPP_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("WHATSAPP_TEST_DATABASE_URL is not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(postgres.Close)

	suffix := fmt.Sprintf("wa-native-lock-%d", time.Now().UnixNano())
	var organizationID, userID, leadAID, leadBID, sessionID, conversationID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.organizations (name, slug)
		values ($1, $1)
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
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.leads (organization_id, assigned_user_id, name, phone, source)
		values ($1::uuid, $2::uuid, $3, '5511999910101', 'whatsapp')
		returning id::text
	`, organizationID, userID, suffix+"-a").Scan(&leadAID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.leads (organization_id, assigned_user_id, name, phone, source)
		values ($1::uuid, $2::uuid, $3, '5511999910102', 'whatsapp')
		returning id::text
	`, organizationID, userID, suffix+"-b").Scan(&leadBID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_sessions (
			organization_id, instance_name, instance_id, owner_user_id,
			provider, status, is_active
		) values ($1::uuid, $2, $2, $3::uuid, 'evolution_go', 'connected', true)
		returning id::text
	`, organizationID, suffix, userID).Scan(&sessionID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_conversations (
			organization_id, session_id, remote_jid, contact_phone, contact_name
		) values (
			$1::uuid, $2::uuid, '5511999910101@s.whatsapp.net', '5511999910101', $3
		)
		returning id::text
	`, organizationID, sessionID, suffix).Scan(&conversationID); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		select public.activate_whatsapp_conversation_lead_binding(
			$1::uuid, $2::uuid, $3::uuid, null
		)
	`, organizationID, conversationID, leadAID); err != nil {
		t.Fatal(err)
	}

	session := nativeEvolutionSession{ID: sessionID, OrganizationID: organizationID}
	repo := NewRepository(postgres, nil, StorageConfig{})
	waitForBlockedQuery := func(fragment string) {
		t.Helper()
		deadline := time.Now().Add(5 * time.Second)
		for time.Now().Before(deadline) {
			var blocked bool
			if err := postgres.Pool().QueryRow(ctx, `
				select exists (
				  select 1
				  from pg_catalog.pg_stat_activity as activity
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
	waitResult := func(label string, result <-chan asyncResult) {
		t.Helper()
		select {
		case outcome := <-result:
			if outcome.err != nil {
				t.Fatalf("%s: %v", label, outcome.err)
			}
		case <-time.After(5 * time.Second):
			t.Fatalf("%s did not finish; possible lock-order regression", label)
		}
	}

	// Native-first order: deletion owns conversation then message; the rebind
	// waits for the conversation and proceeds after the deletion transaction.
	var deletionTargetID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_messages (
			organization_id, conversation_id, session_id, lead_id,
			provider_message_id, message_id, from_me, direction,
			message_type, content, remote_jid, status, sent_at
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid,
			$5, $5, false, 'inbound', 'text', 'delete target',
			'5511999910101@s.whatsapp.net', 'received', now()
		)
		returning id::text
	`, organizationID, conversationID, sessionID, leadAID, suffix+"-delete-target").Scan(&deletionTargetID); err != nil {
		t.Fatal(err)
	}
	deletionTx, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	deletionCommitted := false
	defer func() {
		if !deletionCommitted {
			_ = deletionTx.Rollback(context.Background())
		}
	}()
	if err := processNativeEvolutionDeletion(ctx, deletionTx, session, nativeEvolutionMessage{
		ProviderMessageID: suffix + "-delete-event",
		DeletionTargetID:  suffix + "-delete-target",
	}); err != nil {
		t.Fatal(err)
	}
	rebindDone := make(chan asyncResult, 1)
	go func() {
		_, rebindErr := postgres.Pool().Exec(ctx, `
			select public.activate_whatsapp_conversation_lead_binding(
				$1::uuid, $2::uuid, $3::uuid, null
			)
		`, organizationID, conversationID, leadBID)
		rebindDone <- asyncResult{err: rebindErr}
	}()
	waitForBlockedQuery("activate_whatsapp_conversation_lead_binding")
	if err := deletionTx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	deletionCommitted = true
	waitResult("rebind after native deletion", rebindDone)

	var deletedType, currentLeadID string
	if err := postgres.Pool().QueryRow(ctx, `
		select message.message_type, conversation.lead_id::text
		from public.whatsapp_messages as message
		join public.whatsapp_conversations as conversation
		  on conversation.id = message.conversation_id
		where message.id = $1::uuid
	`, deletionTargetID).Scan(&deletedType, &currentLeadID); err != nil {
		t.Fatal(err)
	}
	if deletedType != "deleted" || currentLeadID != leadBID {
		t.Fatalf("native-first state = message:%q lead:%q, want deleted/%s", deletedType, currentLeadID, leadBID)
	}

	// Finalizer-first order: an outbox-row blocker lets the real finalizer retain
	// its earlier conversation lock while the reaction reaches the same lock.
	// Releasing the blocker proves finalizer then reaction complete serially.
	var reactionTargetID, pendingMessageID, outboxID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_messages (
			organization_id, conversation_id, session_id, lead_id,
			provider_message_id, message_id, from_me, direction,
			message_type, content, remote_jid, status, sent_at
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid,
			$5, $5, false, 'inbound', 'text', 'reaction target',
			'5511999910101@s.whatsapp.net', 'received', now()
		)
		returning id::text
	`, organizationID, conversationID, sessionID, leadBID, suffix+"-reaction-target").Scan(&reactionTargetID); err != nil {
		t.Fatal(err)
	}
	clientMessageID := suffix + "-client"
	providerMessageID := ""
	leaseToken := suffix + "-lease"
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_messages (
			organization_id, conversation_id, session_id, lead_id,
			message_id, client_message_id, from_me, direction,
			message_type, content, remote_jid, status, sent_at
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid,
			$5, $5, true, 'outbound', 'text', 'pending outbound',
			'5511999910101@s.whatsapp.net', 'queued', now()
		)
		returning id::text
	`, organizationID, conversationID, sessionID, leadBID, clientMessageID).Scan(&pendingMessageID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_outbox (
			organization_id, session_id, conversation_id, message_id,
			client_message_id, recipient_jid, message_type, payload,
			status, locked_at, locked_by
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid,
			$5, '5511999910101@s.whatsapp.net', 'text',
			'{"action":"send.text","body":{"number":"5511999910101","text":"pending outbound"}}'::jsonb,
			'processing', now(), $6
		)
		returning id::text, provider_message_id
	`, organizationID, sessionID, conversationID, pendingMessageID, clientMessageID, leaseToken).Scan(&outboxID, &providerMessageID); err != nil {
		t.Fatal(err)
	}

	outboxBlocker, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	outboxBlockerCommitted := false
	defer func() {
		if !outboxBlockerCommitted {
			_ = outboxBlocker.Rollback(context.Background())
		}
	}()
	if _, err := outboxBlocker.Exec(ctx, `
		select id from public.whatsapp_outbox where id = $1::uuid for update
	`, outboxID); err != nil {
		t.Fatal(err)
	}

	finalizerDone := make(chan asyncResult, 1)
	go func() {
		finalizerDone <- asyncResult{err: repo.completeWhatsAppOutbox(ctx, pendingWhatsAppOutbox{
			ID:              outboxID,
			OrganizationID:  organizationID,
			SessionID:       sessionID,
			ConversationID:  conversationID,
			MessageRowID:    pendingMessageID,
			ClientMessageID: clientMessageID,
			LeaseToken:      leaseToken,
			Payload:         map[string]any{"action": "send.text"},
		}, providerMessageID)}
	}()
	waitForBlockedQuery("from public.whatsapp_outbox")

	reactionDone := make(chan asyncResult, 1)
	go func() {
		reactionTx, beginErr := postgres.Pool().Begin(ctx)
		if beginErr != nil {
			reactionDone <- asyncResult{err: beginErr}
			return
		}
		defer reactionTx.Rollback(context.Background())
		reactionErr := processNativeEvolutionReaction(ctx, reactionTx, session, nativeEvolutionMessage{
			ProviderMessageID: suffix + "-reaction-event",
			RemoteJID:         "5511999910101@s.whatsapp.net",
			SenderJID:         "5511999910101@s.whatsapp.net",
			ReactionTargetID:  suffix + "-reaction-target",
			ReactionEmoji:     "👍",
			SentAt:            time.Now().UTC(),
		})
		if reactionErr == nil {
			reactionErr = reactionTx.Commit(ctx)
		}
		reactionDone <- asyncResult{err: reactionErr}
	}()
	waitForBlockedQuery("with target_identity as materialized")
	if err := outboxBlocker.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	outboxBlockerCommitted = true
	waitResult("outbox finalizer before native reaction", finalizerDone)
	waitResult("native reaction after outbox finalizer", reactionDone)

	var outboxStatus string
	var reactionCount int
	if err := postgres.Pool().QueryRow(ctx, `
		select status from public.whatsapp_outbox where id = $1::uuid
	`, outboxID).Scan(&outboxStatus); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::integer
		from public.whatsapp_message_reactions
		where target_message_id = $1::uuid
		  and provider_reaction_message_id = $2
	`, reactionTargetID, suffix+"-reaction-event").Scan(&reactionCount); err != nil {
		t.Fatal(err)
	}
	if outboxStatus != "sent" || reactionCount != 1 {
		t.Fatalf("finalizer-first state = outbox:%q reactions:%d, want sent/1", outboxStatus, reactionCount)
	}
}

func TestNativeIdentityReconcileAndLeadDeleteUseCanonicalConversationOrder(t *testing.T) {
	databaseURL := os.Getenv("WHATSAPP_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("WHATSAPP_TEST_DATABASE_URL is not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(postgres.Close)

	suffix := fmt.Sprintf("wa-identity-delete-lock-%d", time.Now().UnixNano())
	const sourceJID = "987654321012345@lid"
	const targetJID = "5511999910202@s.whatsapp.net"

	var organizationID, userID, leadID, sessionID, sourceConversationID, targetConversationID string
	if err := postgres.Pool().QueryRow(ctx, `
		with ids as (select gen_random_uuid() as a, gen_random_uuid() as b)
		select least(a, b)::text, greatest(a, b)::text from ids
	`).Scan(&sourceConversationID, &targetConversationID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.organizations (name, slug)
		values ($1, $1)
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
		_, _ = postgres.Pool().Exec(cleanupCtx, `delete from auth.users where id = $1::uuid`, userID)
	})

	if _, err := postgres.Pool().Exec(ctx, `
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
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.leads (organization_id, assigned_user_id, name, phone, source)
		values ($1::uuid, $2::uuid, $3, '5511999910202', 'whatsapp')
		returning id::text
	`, organizationID, userID, suffix+"-lead").Scan(&leadID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_sessions (
		  organization_id, instance_name, instance_id, owner_user_id,
		  provider, status, is_active
		) values ($1::uuid, $2, $2, $3::uuid, 'evolution_go', 'connected', true)
		returning id::text
	`, organizationID, suffix, userID).Scan(&sessionID); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.whatsapp_conversations (
		  id, organization_id, session_id, assigned_user_id,
		  remote_jid, contact_phone, contact_name, unread_count
		) values
		  ($1::uuid, $3::uuid, $4::uuid, $6::uuid, $7, '5511999910202', $9, 0),
		  ($2::uuid, $3::uuid, $4::uuid, $6::uuid, $8, '5511999910202', $9, 0);

		update public.whatsapp_conversations
		set deleted_at = now()
		where organization_id = $3::uuid and id = $2::uuid;

		select public.activate_whatsapp_conversation_lead_binding(
		  $3::uuid, $1::uuid, $5::uuid, null
		);
		select public.activate_whatsapp_conversation_lead_binding(
		  $3::uuid, $2::uuid, $5::uuid, null
		)
	`, sourceConversationID, targetConversationID, organizationID, sessionID, leadID, userID, sourceJID, targetJID, suffix); err != nil {
		t.Fatal(err)
	}

	const restoredTargetJID = "5511999910303@s.whatsapp.net"
	var restoredTargetID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_conversations (
		  organization_id, session_id, remote_jid, contact_phone,
		  contact_name, unread_count, deleted_at
		) values ($1::uuid, $2::uuid, $3, '5511999910303', $4, 0, now())
		returning id::text
	`, organizationID, sessionID, restoredTargetJID, suffix+"-restored").Scan(&restoredTargetID); err != nil {
		t.Fatal(err)
	}
	restoreTx, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = reconcileNativeEvolutionConversationIdentity(
		ctx,
		restoreTx,
		nativeEvolutionSession{ID: sessionID, OrganizationID: organizationID},
		nativeEvolutionMessage{
			RemoteJID:    restoredTargetJID,
			ContactPhone: "5511999910303",
		},
		nativeEvolutionConversation{ID: restoredTargetID, RemoteJID: restoredTargetJID},
		false,
		nativeEvolutionLead{},
	)
	if err == nil {
		err = restoreTx.Commit(ctx)
	} else {
		_ = restoreTx.Rollback(context.Background())
	}
	if err != nil {
		t.Fatalf("restore deleted canonical route: %v", err)
	}
	var restored bool
	if err := postgres.Pool().QueryRow(ctx, `
		select deleted_at is null
		from public.whatsapp_conversations
		where id = $1::uuid
	`, restoredTargetID).Scan(&restored); err != nil {
		t.Fatal(err)
	}
	if !restored {
		t.Fatal("new canonical traffic left a soft-deleted conversation hidden")
	}

	waitForBlockedQuery := func(fragment string) {
		t.Helper()
		deadline := time.Now().Add(5 * time.Second)
		for time.Now().Before(deadline) {
			var blocked bool
			if err := postgres.Pool().QueryRow(ctx, `
				select exists (
				  select 1
				  from pg_catalog.pg_stat_activity as activity
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

	targetBlocker, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	targetBlockerReleased := false
	defer func() {
		if !targetBlockerReleased {
			_ = targetBlocker.Rollback(context.Background())
		}
	}()
	if _, err := targetBlocker.Exec(ctx, `
		select id from public.whatsapp_conversations
		where id = $1::uuid
		for update
	`, targetConversationID); err != nil {
		t.Fatal(err)
	}

	type asyncResult struct{ err error }
	reconcileDone := make(chan asyncResult, 1)
	go func() {
		tx, beginErr := postgres.Pool().Begin(ctx)
		if beginErr != nil {
			reconcileDone <- asyncResult{err: beginErr}
			return
		}
		defer tx.Rollback(context.Background())
		_, _, reconcileErr := reconcileNativeEvolutionConversationIdentity(
			ctx,
			tx,
			nativeEvolutionSession{ID: sessionID, OrganizationID: organizationID},
			nativeEvolutionMessage{
				RemoteJID:     targetJID,
				RemoteAliases: []string{sourceJID},
				ContactPhone:  "5511999910202",
			},
			nativeEvolutionConversation{ID: targetConversationID, LeadID: leadID, RemoteJID: targetJID},
			false,
			nativeEvolutionLead{ID: leadID, AssignedUserID: userID},
		)
		if reconcileErr == nil {
			reconcileErr = tx.Commit(ctx)
		}
		reconcileDone <- asyncResult{err: reconcileErr}
	}()
	waitForBlockedQuery("id = any")

	deleteDone := make(chan asyncResult, 1)
	go func() {
		deleteErr := leadsrepo.NewRepository(postgres, nil).Delete(ctx, tenant.Context{
			UserID:         userID,
			OrganizationID: organizationID,
			MemberRole:     "admin",
		}, leadID)
		deleteDone <- asyncResult{err: deleteErr}
	}()
	waitForBlockedQuery("from public.whatsapp_conversations wc")

	if err := targetBlocker.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	targetBlockerReleased = true
	for label, result := range map[string]<-chan asyncResult{
		"identity reconciliation": reconcileDone,
		"lead deletion":           deleteDone,
	} {
		select {
		case outcome := <-result:
			if outcome.err != nil {
				t.Fatalf("%s failed: %v", label, outcome.err)
			}
		case <-time.After(8 * time.Second):
			t.Fatalf("%s did not finish; possible conversation lock-order regression", label)
		}
	}

	var remainingLeadCount, linkedConversationCount int
	if err := postgres.Pool().QueryRow(ctx, `
		select
		  (select count(*)::integer from public.leads where id = $1::uuid),
		  (select count(*)::integer from public.whatsapp_conversations where lead_id = $1::uuid)
	`, leadID).Scan(&remainingLeadCount, &linkedConversationCount); err != nil {
		t.Fatal(err)
	}
	if remainingLeadCount != 0 || linkedConversationCount != 0 {
		t.Fatalf("post-lock-order state = leads:%d linked conversations:%d, want 0/0", remainingLeadCount, linkedConversationCount)
	}
}

func TestIngressSnapshotRevalidatesLIDAliasAfterConversationLock(t *testing.T) {
	databaseURL := os.Getenv("WHATSAPP_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("WHATSAPP_TEST_DATABASE_URL is not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(postgres.Close)

	suffix := fmt.Sprintf("wa-ingress-alias-race-%d", time.Now().UnixNano())
	const sourceJID = "987654321099999@lid"
	const targetJID = "5511999910999@s.whatsapp.net"
	const providerMessageID = "provider-ingress-alias-race"

	var organizationID, userID, sessionID, sourceConversationID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.organizations (name, slug)
		values ($1, $1)
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
		_, _ = postgres.Pool().Exec(cleanupCtx, `delete from auth.users where id = $1::uuid`, userID)
	})

	if _, err := postgres.Pool().Exec(ctx, `
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
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_sessions (
		  organization_id, instance_name, instance_id, owner_user_id,
		  provider, status, is_active
		) values ($1::uuid, $2, $2, $3::uuid, 'evolution_go', 'connected', true)
		returning id::text
	`, organizationID, suffix, userID).Scan(&sessionID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_conversations (
		  organization_id, session_id, remote_jid, contact_phone,
		  contact_name, unread_count
		) values ($1::uuid, $2::uuid, $3, '5511999910999', $4, 0)
		returning id::text;
	`, organizationID, sessionID, sourceJID, suffix+"-source").Scan(&sourceConversationID); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.whatsapp_conversations (
		  organization_id, session_id, remote_jid, contact_phone,
		  contact_name, unread_count
		) values ($1::uuid, $2::uuid, $4, '5511999910999', $5, 0);
		insert into public.whatsapp_contact_identity_aliases (
		  organization_id, session_id, alias_jid, canonical_jid,
		  contact_phone, is_group
		) values ($1::uuid, $2::uuid, $3, $3, '5511999910999', false)
	`, organizationID, sessionID, sourceJID, targetJID, suffix+"-target"); err != nil {
		t.Fatal(err)
	}

	mutator, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	mutatorFinished := false
	defer func() {
		if !mutatorFinished {
			_ = mutator.Rollback(context.Background())
		}
	}()
	var lockedConversationID string
	if err := mutator.QueryRow(ctx, `
		select id::text
		from public.whatsapp_conversations
		where organization_id = $1::uuid and id = $2::uuid
		for update
	`, organizationID, sourceConversationID).Scan(&lockedConversationID); err != nil {
		t.Fatal(err)
	}
	if _, err := mutator.Exec(ctx, `
		update public.whatsapp_contact_identity_aliases
		set canonical_jid = $4, last_seen_at = now()
		where organization_id = $1::uuid
		  and session_id = $2::uuid
		  and alias_jid = $3
	`, organizationID, sessionID, sourceJID, targetJID); err != nil {
		t.Fatal(err)
	}

	captureConn, err := postgres.Pool().Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer captureConn.Release()
	var capturePID int
	if err := captureConn.QueryRow(ctx, `select pg_backend_pid()`).Scan(&capturePID); err != nil {
		t.Fatal(err)
	}
	type captureResult struct {
		raw string
		err error
	}
	captureDone := make(chan captureResult, 1)
	go func() {
		var raw string
		err := captureConn.QueryRow(ctx, `
			select private.capture_whatsapp_webhook_routing_snapshot(
			  $1::uuid, $2::uuid, $3, $4, 'live', $5, true,
			  $6::text[], '5511999910999', 'organic', null,
			  false, false, false, null, null, null
			)::text
		`, organizationID, sessionID, providerMessageID, providerMessageID+"-event",
			"jid:"+sourceJID, []string{sourceJID}).Scan(&raw)
		captureDone <- captureResult{raw: raw, err: err}
	}()

	blockedDeadline := time.Now().Add(5 * time.Second)
	for {
		var waitEventType string
		err := postgres.Pool().QueryRow(ctx, `
			select coalesce(wait_event_type, '')
			from pg_catalog.pg_stat_activity
			where pid = $1
		`, capturePID).Scan(&waitEventType)
		if err != nil {
			t.Fatal(err)
		}
		if waitEventType == "Lock" {
			break
		}
		if time.Now().After(blockedDeadline) {
			t.Fatal("routing snapshot did not wait on the conversation lock")
		}
		time.Sleep(20 * time.Millisecond)
	}

	if err := mutator.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	mutatorFinished = true

	select {
	case result := <-captureDone:
		var pgErr *pgconn.PgError
		if !errors.As(result.err, &pgErr) || pgErr.Code != "40001" {
			t.Fatalf("routing snapshot after alias move = raw:%s error:%v, want SQLSTATE 40001", result.raw, result.err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("routing snapshot did not finish after releasing the conversation lock")
	}

	var snapshotCount int
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::integer
		from public.whatsapp_webhook_routing_snapshots
		where organization_id = $1::uuid
		  and session_id = $2::uuid
		  and provider_message_id = $3
	`, organizationID, sessionID, providerMessageID).Scan(&snapshotCount); err != nil {
		t.Fatal(err)
	}
	if snapshotCount != 0 {
		t.Fatalf("stale alias race committed %d routing snapshot rows, want 0", snapshotCount)
	}
}
