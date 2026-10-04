package whatsapp

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// A provider retry after the first lead binding must keep the original
// pre-lead message and log unattributed, while the new card can read history.
func TestNativeRecordedPreleadReplayKeepsHistory(t *testing.T) {
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

	suffix := fmt.Sprintf("wa-prelead-replay-%d", time.Now().UnixNano())
	const phone = "5511999988877"
	var organizationID, userID, sessionID, conversationID, leadID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.organizations (name, slug) values ($1, $1) returning id::text
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
		) values ($1::uuid, 'authenticated', 'authenticated', $2, '', now(), '{}'::jsonb, '{}'::jsonb, now(), now())
	`, userID, suffix+"@example.invalid"); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.users
		set organization_id = $2::uuid, name = $3, email = $4,
		    role = 'user', is_active = true
		where id = $1::uuid
	`, userID, organizationID, suffix, suffix+"@example.invalid"); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.organization_members (organization_id, user_id, role, is_active)
		values ($1::uuid, $2::uuid, 'user', true)
		on conflict (user_id, organization_id) do update
		set role = excluded.role, is_active = excluded.is_active, deleted_at = null
	`, organizationID, userID); err != nil {
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
	remoteJID := phone + "@s.whatsapp.net"
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_conversations (
			organization_id, session_id, assigned_user_id, remote_jid, contact_phone
		) values ($1::uuid, $2::uuid, $3::uuid, $4, $5)
		returning id::text
	`, organizationID, sessionID, userID, remoteJID, phone).Scan(&conversationID); err != nil {
		t.Fatal(err)
	}

	providerMessageID := suffix + "-provider"
	message := nativeEvolutionMessage{
		ProviderMessageID: providerMessageID,
		RemoteJID:         remoteJID,
		ContactPhone:      phone,
		Content:           "Histórico anterior ao cadastro",
		MessageType:       "text",
		SentAt:            time.Now().UTC().Add(-time.Minute),
	}
	session := nativeEvolutionSession{OrganizationID: organizationID, ID: sessionID}
	conversation := nativeEvolutionConversation{ID: conversationID, RemoteJID: remoteJID}
	firstTx, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	inserted, _, messageRowID, err := insertNativeEvolutionMessage(ctx, firstTx, session, conversation, message, "recorded", "")
	if err != nil || !inserted {
		_ = firstTx.Rollback(ctx)
		t.Fatalf("record original pre-lead message: inserted=%v err=%v", inserted, err)
	}
	if err := firstTx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.whatsapp_inbound_logs (
			organization_id, session_id, conversation_id, lead_id, match_details
		) values (
			$1::uuid, $2::uuid, $3::uuid, null,
			jsonb_build_object('message_id', $4, 'message_row_id', $5)
		)
	`, organizationID, sessionID, conversationID, providerMessageID, messageRowID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.leads (organization_id, assigned_user_id, name, phone, source)
		values ($1::uuid, $2::uuid, 'Contato registrado', $3, 'manual')
		returning id::text
	`, organizationID, userID, phone).Scan(&leadID); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		select public.activate_whatsapp_conversation_lead_binding($1::uuid, $2::uuid, $3::uuid, null)
	`, organizationID, conversationID, leadID); err != nil {
		t.Fatal(err)
	}

	// Exercise the database UPDATE that previously fired the context trigger
	// even though the SQL expression assigned lead_id back to itself.
	conversation.LeadID = leadID
	conversation.MessageLeadID = leadID
	replayTx, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	inserted, _, _, err = insertNativeEvolutionMessage(ctx, replayTx, session, conversation, message, "recorded", "")
	if err != nil || inserted {
		_ = replayTx.Rollback(ctx)
		t.Fatalf("direct replay after binding: inserted=%v err=%v", inserted, err)
	}
	if err := replayTx.Commit(ctx); err != nil {
		t.Fatal(err)
	}

	// Replay the same provider event through the actual native webhook path,
	// with an immutable unlinked routing snapshot from its original ingress.
	payload := []byte(strings.ReplaceAll(
		strings.ReplaceAll(
			strings.ReplaceAll(string(readNativeFixture(t, "message_text.json")),
				"provider-inbound-text-1", providerMessageID),
			"5511999991111", phone),
		"Mensagem recebida pelo backend", message.Content,
	))
	var decoded map[string]any
	if err := json.Unmarshal(payload, &decoded); err != nil {
		t.Fatal(err)
	}
	decoded[evolutionWebhookRoutingMetaKey] = map[string]any{
		"routing_key": "__session__",
		"routing_snapshot": map[string]any{
			"version": 1,
			"messages": []map[string]any{{
				"version":                      1,
				"organization_id":              organizationID,
				"session_id":                   sessionID,
				"provider_message_id":          providerMessageID,
				"inbox_event_key":              suffix + "-event",
				"processing_lane":              "live",
				"state":                        "unlinked",
				"conversation_id":              conversationID,
				"context_kind":                 "organic",
				"managed_message_distribution": false,
				"managed_event_pending":        false,
				"managed_event_handled":        false,
				"binding_eligible":             false,
				"routing_key":                  "__session__",
				"target_mode":                  "snapshot",
				"ingress_sequence":             1,
			}},
		},
	}
	payload, err = json.Marshal(decoded)
	if err != nil {
		t.Fatal(err)
	}
	repo := NewRepository(postgres, nil, StorageConfig{})
	repo.functions.inboundRecordingSessionIDs = []string{sessionID}
	item := pendingEvolutionWebhook{
		ID:             "99999999-9999-4999-8999-999999999999",
		OrganizationID: organizationID,
		SessionID:      sessionID,
		EventType:      "messages.upsert",
		Payload:        payload,
		ProcessingLane: evolutionWebhookLaneLive,
		CreatedAt:      time.Now().UTC(),
	}
	if handled, err := repo.processEvolutionWebhookNative(ctx, item); err != nil || !handled {
		t.Fatalf("native webhook replay: handled=%v err=%v", handled, err)
	}

	var rowCount, logCount, phoneLeadCount int
	var messageLeadID, logLeadID, captureState, content string
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::integer, coalesce(max(lead_id::text), ''),
		       coalesce(max(capture_state), ''), coalesce(max(content), '')
		from public.whatsapp_messages
		where organization_id = $1::uuid and session_id = $2::uuid and message_id = $3
	`, organizationID, sessionID, providerMessageID).Scan(&rowCount, &messageLeadID, &captureState, &content); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::integer, coalesce(max(lead_id::text), '')
		from public.whatsapp_inbound_logs
		where organization_id = $1::uuid and session_id = $2::uuid
		  and match_details->>'message_id' = $3
	`, organizationID, sessionID, providerMessageID).Scan(&logCount, &logLeadID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::integer from public.leads
		where organization_id = $1::uuid and phone = $2
	`, organizationID, phone).Scan(&phoneLeadCount); err != nil {
		t.Fatal(err)
	}
	if rowCount != 1 || messageLeadID != "" || logCount != 1 || logLeadID != "" ||
		phoneLeadCount != 1 || captureState != "recorded" || content != message.Content {
		t.Fatalf("provider replay changed attribution: rows=%d messageLead=%q logs=%d logLead=%q leads=%d capture=%q content=%q",
			rowCount, messageLeadID, logCount, logLeadID, phoneLeadCount, captureState, content)
	}
	viewer := tenant.Context{
		OrganizationID: organizationID,
		UserID:         userID,
		MemberRole:     "user",
		Permissions:    []string{permissions.LeadViewOwn},
	}
	history, err := repo.GetHistoryAccess(ctx, viewer, HistoryAccessFilter{
		LeadID:         leadID,
		ConversationID: conversationID,
		MessageFilter:  MessageFilter{Limit: 50},
	})
	if err != nil || len(history.Messages) != 1 || history.Messages[0].MessageID != providerMessageID {
		t.Fatalf("converted lead lost recorded pre-lead history: messages=%#v err=%v", history.Messages, err)
	}
	conversationMessages, err := repo.ListMessages(ctx, viewer, conversationID, MessageFilter{
		Limit:          50,
		ExpectedLeadID: leadID,
	})
	if err != nil || len(conversationMessages.Messages) != 1 || conversationMessages.Messages[0].MessageID != providerMessageID {
		t.Fatalf("converted conversation lost recorded pre-lead history: messages=%#v err=%v", conversationMessages.Messages, err)
	}
}
