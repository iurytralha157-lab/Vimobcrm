package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestNativeEvolutionWebhookCoreIntegration(t *testing.T) {
	databaseURL := os.Getenv("WHATSAPP_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("WHATSAPP_TEST_DATABASE_URL is not set")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(postgres.Close)

	suffix := fmt.Sprintf("wa-native-%d", time.Now().UnixNano())
	var organizationID, userID, leadID, sessionID, conversationID, outboundRowID string
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
		insert into public.users (id, organization_id, name, email, role, is_active)
		values ($1::uuid, $2::uuid, $3, $4, 'user', true)
	`, userID, organizationID, suffix, suffix+"@example.invalid"); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.organization_members (organization_id, user_id, role, is_active)
		values ($1::uuid, $2::uuid, 'user', true)
	`, organizationID, userID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.leads (organization_id, assigned_user_id, name, phone, source)
		values ($1::uuid, $2::uuid, $3, '5511999991111', 'meta_ads') returning id::text
	`, organizationID, userID, suffix).Scan(&leadID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_sessions (
			organization_id, instance_name, instance_id, owner_user_id,
			provider, status, is_active, advanced_settings
		) values (
			$1::uuid, $2, $2, $3::uuid,
			'evolution_go', 'connected', true, '{"webhook_token":"native-secret"}'::jsonb
		) returning id::text
	`, organizationID, suffix, userID).Scan(&sessionID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_conversations (
			organization_id, session_id, lead_id, assigned_user_id, remote_jid,
			contact_phone, contact_name, unread_count
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid,
			'5511999991111@s.whatsapp.net', '5511999991111', $5, 0
		) returning id::text
	`, organizationID, sessionID, leadID, userID, suffix).Scan(&conversationID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_messages (
			organization_id, conversation_id, session_id, lead_id,
			provider_message_id, message_id, client_message_id, from_me, direction,
			content, message_type, status, sent_at
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid,
			'provider-outbound-status', 'provider-outbound-status', 'client-native-status',
			true, 'outbound', 'Mensagem enviada', 'text', 'sent', now()
		) returning id::text
	`, organizationID, conversationID, sessionID, leadID).Scan(&outboundRowID); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.whatsapp_outbox (
			organization_id, session_id, conversation_id, message_id,
			client_message_id, recipient_jid, message_type, payload,
			provider_message_id, status, sent_at
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid,
			'client-native-status', '5511999991111@s.whatsapp.net', 'text', '{}'::jsonb,
			'provider-outbound-status', 'sent', now()
		)
	`, organizationID, sessionID, conversationID, outboundRowID); err != nil {
		t.Fatal(err)
	}

	repo := NewRepository(postgres, nil, StorageConfig{})
	item := func(event, fixture string) pendingEvolutionWebhook {
		return pendingEvolutionWebhook{
			OrganizationID: organizationID,
			SessionID:      sessionID,
			EventType:      event,
			Payload:        readNativeFixture(t, fixture),
		}
	}

	var unreadBefore int
	if err := postgres.Pool().QueryRow(ctx, `select unread_count from public.whatsapp_conversations where id = $1::uuid`, conversationID).Scan(&unreadBefore); err != nil {
		t.Fatal(err)
	}
	for attempt := 0; attempt < 2; attempt++ {
		handled, err := repo.processEvolutionWebhookNative(ctx, item("messages.upsert", "message_text.json"))
		if err != nil || !handled {
			t.Fatalf("native text attempt %d = handled:%v error:%v", attempt+1, handled, err)
		}
	}
	var messageCount, unreadAfter int
	var messageLeadID, direction string
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::integer, coalesce(max(lead_id::text), ''), coalesce(max(direction), '')
		from public.whatsapp_messages
		where organization_id = $1::uuid and session_id = $2::uuid and message_id = 'provider-inbound-text-1'
	`, organizationID, sessionID).Scan(&messageCount, &messageLeadID, &direction); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `select unread_count from public.whatsapp_conversations where id = $1::uuid`, conversationID).Scan(&unreadAfter); err != nil {
		t.Fatal(err)
	}
	if messageCount != 1 || messageLeadID != leadID || direction != "inbound" || unreadAfter != unreadBefore+1 {
		t.Fatalf("native replay state = count:%d lead:%s direction:%s unread:%d->%d", messageCount, messageLeadID, direction, unreadBefore, unreadAfter)
	}

	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_sessions set phone_number = 'André Rocha' where id = $1::uuid
	`, sessionID); err != nil {
		t.Fatal(err)
	}
	if handled, err := repo.processEvolutionWebhookNative(ctx, item("messages.upsert", "message_outbound_self_jid.json")); err != nil || !handled {
		t.Fatalf("outbound self JID repair = handled:%v error:%v", handled, err)
	}
	var repairedSessionPhone string
	if err := postgres.Pool().QueryRow(ctx, `select coalesce(phone_number, '') from public.whatsapp_sessions where id = $1::uuid`, sessionID).Scan(&repairedSessionPhone); err != nil {
		t.Fatal(err)
	}
	if repairedSessionPhone != "551188887777" {
		t.Fatalf("outbound self JID repaired session phone = %q", repairedSessionPhone)
	}

	if handled, err := repo.processEvolutionWebhookNative(ctx, item("messages.upsert", "message_media.json")); err == nil || !handled {
		t.Fatalf("media without durable Storage must stay retryable: handled:%v error:%v", handled, err)
	}
	var pendingMediaCount int
	var pendingMediaStatus, pendingMediaError string
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::integer, coalesce(max(media_status), ''), coalesce(max(media_error), '')
		from public.whatsapp_messages
		where organization_id = $1::uuid and session_id = $2::uuid and message_id = 'provider-inbound-image-1'
	`, organizationID, sessionID).Scan(&pendingMediaCount, &pendingMediaStatus, &pendingMediaError); err != nil {
		t.Fatal(err)
	}
	if pendingMediaCount != 1 || pendingMediaStatus != "pending" || pendingMediaError != "media_retained_in_webhook_inbox" {
		t.Fatalf("media placeholder state = rows:%d status:%q error:%q", pendingMediaCount, pendingMediaStatus, pendingMediaError)
	}
	var mediaUploads atomic.Int32
	storageServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost || !strings.HasPrefix(request.URL.Path, "/storage/v1/object/whatsapp-media/") {
			http.NotFound(w, request)
			return
		}
		if request.Header.Get("Authorization") != "Bearer service-key" {
			t.Errorf("storage upload is missing service authorization")
		}
		if strings.Contains(request.URL.Path, "provider-inbound-image-download-1") {
			var placeholderRows int
			var placeholderStatus string
			if err := postgres.Pool().QueryRow(request.Context(), `
				select count(*)::integer, coalesce(max(media_status), '') from public.whatsapp_messages
				where organization_id = $1::uuid and session_id = $2::uuid
				  and message_id = 'provider-inbound-image-download-1'
			`, organizationID, sessionID).Scan(&placeholderRows, &placeholderStatus); err != nil {
				t.Errorf("check media ordering: %v", err)
			} else if placeholderRows != 1 || placeholderStatus != "pending" {
				t.Errorf("durable placeholder before upload = rows:%d status:%q", placeholderRows, placeholderStatus)
			}
		}
		mediaUploads.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	defer storageServer.Close()
	storageRepo := NewRepository(postgres, nil, StorageConfig{ProjectURL: storageServer.URL, APIKey: "service-key"})
	if handled, err := storageRepo.processEvolutionWebhookNative(ctx, item("messages.upsert", "message_media.json")); err != nil || !handled {
		t.Fatalf("native media placeholder replay = handled:%v error:%v", handled, err)
	}
	var replayedMediaCount int
	var replayedMediaStatus, replayedMediaPath, replayedMediaError string
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::integer, coalesce(max(media_status), ''),
		       coalesce(max(media_storage_path), ''), coalesce(max(media_error), '')
		from public.whatsapp_messages
		where organization_id = $1::uuid and session_id = $2::uuid and message_id = 'provider-inbound-image-1'
	`, organizationID, sessionID).Scan(&replayedMediaCount, &replayedMediaStatus, &replayedMediaPath, &replayedMediaError); err != nil {
		t.Fatal(err)
	}
	if replayedMediaCount != 1 || replayedMediaStatus != "ready" || replayedMediaPath == "" || replayedMediaError != "" {
		t.Fatalf("replayed media state = rows:%d status:%q path:%q error:%q", replayedMediaCount, replayedMediaStatus, replayedMediaPath, replayedMediaError)
	}
	readyMedia := item("messages.upsert", "message_media.json")
	readyMedia.Payload = []byte(strings.ReplaceAll(string(readyMedia.Payload), "provider-inbound-image-1", "provider-inbound-image-ready"))
	if handled, err := storageRepo.processEvolutionWebhookNative(ctx, readyMedia); err != nil || !handled {
		t.Fatalf("native stored media = handled:%v error:%v", handled, err)
	}
	var readyMediaStatus, readyMediaPath string
	if err := postgres.Pool().QueryRow(ctx, `
		select coalesce(media_status, ''), coalesce(media_storage_path, '')
		from public.whatsapp_messages
		where organization_id = $1::uuid and session_id = $2::uuid and message_id = 'provider-inbound-image-ready'
	`, organizationID, sessionID).Scan(&readyMediaStatus, &readyMediaPath); err != nil {
		t.Fatal(err)
	}
	if readyMediaStatus != "ready" || readyMediaPath == "" || mediaUploads.Load() != 2 {
		t.Fatalf("native stored media state = status:%q path:%q uploads:%d", readyMediaStatus, readyMediaPath, mediaUploads.Load())
	}

	var providerDownloads atomic.Int32
	providerServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost {
			http.NotFound(w, request)
			return
		}
		if request.URL.Path == "/message/downloadmedia" {
			// The currently deployed Evolution Go build exposes the compatibility
			// route. A 404 is the only condition that permits this fixed fallback.
			http.NotFound(w, request)
			return
		}
		if request.URL.Path != "/message/downloadimage" {
			http.NotFound(w, request)
			return
		}
		providerDownloads.Add(1)
		if request.Header.Get("instanceId") != suffix || request.Header.Get("apikey") != "provider-key" {
			t.Errorf("provider recovery used the wrong session credentials")
		}
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Errorf("provider recovery body: %v", err)
		}
		messageBlock := mapFromAny(mapFromAny(body["message"])["imageMessage"])
		if messageBlock["directPath"] == nil || body["messageId"] != "provider-inbound-image-download-1" {
			t.Errorf("provider recovery did not receive the official media block: %#v", body)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"message":"success","data":{"base64":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB","timestamp":""}}`))
	}))
	defer providerServer.Close()
	providerRepo := NewRepository(postgres, nil, StorageConfig{
		ProjectURL: storageServer.URL,
		APIKey:     "service-key",
		EvolutionGo: EvolutionGoConfig{
			APIURL: providerServer.URL,
			APIKey: "provider-key",
		},
	})
	if handled, err := providerRepo.processEvolutionWebhookNative(ctx, item("messages.upsert", "message_media_provider.json")); err != nil || !handled {
		t.Fatalf("provider media recovery = handled:%v error:%v", handled, err)
	}
	var providerMediaStatus, providerMediaPath string
	if err := postgres.Pool().QueryRow(ctx, `
		select coalesce(media_status, ''), coalesce(media_storage_path, '')
		from public.whatsapp_messages
		where organization_id = $1::uuid and session_id = $2::uuid and message_id = 'provider-inbound-image-download-1'
	`, organizationID, sessionID).Scan(&providerMediaStatus, &providerMediaPath); err != nil {
		t.Fatal(err)
	}
	if providerMediaStatus != "ready" || providerMediaPath == "" || providerDownloads.Load() != 1 {
		t.Fatalf("provider media state = status:%q path:%q downloads:%d", providerMediaStatus, providerMediaPath, providerDownloads.Load())
	}

	failingProvider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "provider unavailable", http.StatusBadGateway)
	}))
	defer failingProvider.Close()
	failingProviderRepo := NewRepository(postgres, nil, StorageConfig{
		ProjectURL: storageServer.URL,
		APIKey:     "service-key",
		EvolutionGo: EvolutionGoConfig{
			APIURL: failingProvider.URL,
			APIKey: "provider-key",
		},
	})
	failedProviderItem := item("messages.upsert", "message_media_provider.json")
	failedProviderItem.Payload = []byte(strings.ReplaceAll(string(failedProviderItem.Payload), "provider-inbound-image-download-1", "provider-inbound-image-download-failed"))
	if handled, err := failingProviderRepo.processEvolutionWebhookNative(ctx, failedProviderItem); err == nil || !handled {
		t.Fatalf("provider failure must remain retryable: handled:%v error:%v", handled, err)
	}
	var failedProviderRows int
	var failedProviderStatus string
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::integer, coalesce(max(media_status), '') from public.whatsapp_messages
		where organization_id = $1::uuid and session_id = $2::uuid and message_id = 'provider-inbound-image-download-failed'
	`, organizationID, sessionID).Scan(&failedProviderRows, &failedProviderStatus); err != nil {
		t.Fatal(err)
	}
	if failedProviderRows != 1 || failedProviderStatus != "pending" {
		t.Fatalf("provider failure placeholder = rows:%d status:%q", failedProviderRows, failedProviderStatus)
	}

	reactionPayload := strings.ReplaceAll(string(readNativeFixture(t, "message_reaction.json")), "provider-outbound-for-reaction", "provider-outbound-status")
	reactionItem := pendingEvolutionWebhook{OrganizationID: organizationID, SessionID: sessionID, EventType: "messages.upsert", Payload: []byte(reactionPayload)}
	for attempt := 0; attempt < 2; attempt++ {
		if handled, err := repo.processEvolutionWebhookNative(ctx, reactionItem); err != nil || !handled {
			t.Fatalf("native reaction attempt %d = handled:%v error:%v", attempt+1, handled, err)
		}
	}
	var normalizedReactionCount, reactionMessageCount int
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::integer from public.whatsapp_message_reactions
		where organization_id = $1::uuid and session_id = $2::uuid
		  and target_provider_message_id = 'provider-outbound-status'
	`, organizationID, sessionID).Scan(&normalizedReactionCount); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::integer from public.whatsapp_messages
		where organization_id = $1::uuid and session_id = $2::uuid and message_id = 'provider-reaction-1'
	`, organizationID, sessionID).Scan(&reactionMessageCount); err != nil {
		t.Fatal(err)
	}
	if normalizedReactionCount != 1 || reactionMessageCount != 1 {
		t.Fatalf("reaction replay state = normalized:%d message:%d", normalizedReactionCount, reactionMessageCount)
	}

	if handled, err := repo.processEvolutionWebhookNative(ctx, item("messages.update", "message_status.json")); err != nil || !handled {
		t.Fatalf("native status = handled:%v error:%v", handled, err)
	}
	var messageStatus, outboxStatus string
	if err := postgres.Pool().QueryRow(ctx, `
		select wm.status, wo.status
		from public.whatsapp_messages wm join public.whatsapp_outbox wo on wo.message_id = wm.id
		where wm.id = $1::uuid
	`, outboundRowID).Scan(&messageStatus, &outboxStatus); err != nil {
		t.Fatal(err)
	}
	if messageStatus != "read" || outboxStatus != "read" {
		t.Fatalf("native receipt state = message:%s outbox:%s", messageStatus, outboxStatus)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_conversations conversation
		set last_message = 'Mensagem enviada', last_message_preview = 'Mensagem enviada', last_message_at = message.sent_at
		from public.whatsapp_messages message
		where conversation.id = $1::uuid and message.id = $2::uuid
	`, conversationID, outboundRowID); err != nil {
		t.Fatal(err)
	}
	deletionPayload := strings.ReplaceAll(string(readNativeFixture(t, "message_delete.json")), "provider-delete-target", "provider-outbound-status")
	deletionItem := pendingEvolutionWebhook{OrganizationID: organizationID, SessionID: sessionID, EventType: "messages.upsert", Payload: []byte(deletionPayload)}
	for attempt := 0; attempt < 2; attempt++ {
		if handled, err := repo.processEvolutionWebhookNative(ctx, deletionItem); err != nil || !handled {
			t.Fatalf("native deletion attempt %d = handled:%v error:%v", attempt+1, handled, err)
		}
	}
	var deletedType, deletedContent, deletedPreview string
	var deletionEventRows int
	if err := postgres.Pool().QueryRow(ctx, `
		select message_type, coalesce(content, ''), metadata->>'deletion_event_id'
		from public.whatsapp_messages where id = $1::uuid
	`, outboundRowID).Scan(&deletedType, &deletedContent, &messageStatus); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `select last_message_preview from public.whatsapp_conversations where id = $1::uuid`, conversationID).Scan(&deletedPreview); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::integer from public.whatsapp_messages
		where organization_id = $1::uuid and session_id = $2::uuid and message_id = 'provider-delete-event-1'
	`, organizationID, sessionID).Scan(&deletionEventRows); err != nil {
		t.Fatal(err)
	}
	if deletedType != "deleted" || deletedContent != "Esta mensagem foi apagada" || messageStatus != "provider-delete-event-1" || deletedPreview != "Esta mensagem foi apagada" || deletionEventRows != 0 {
		t.Fatalf("canonical deletion state = type:%s content:%s event:%s preview:%s extra:%d", deletedType, deletedContent, messageStatus, deletedPreview, deletionEventRows)
	}

	if handled, err := repo.processEvolutionWebhookNative(ctx, item("qrcode.updated", "qr.json")); err != nil || !handled {
		t.Fatalf("native QR = handled:%v error:%v", handled, err)
	}
	if handled, err := repo.processEvolutionWebhookNative(ctx, item("connection.update", "connection.json")); err != nil || !handled {
		t.Fatalf("native connection = handled:%v error:%v", handled, err)
	}
	var sessionStatus, sessionPhone string
	if err := postgres.Pool().QueryRow(ctx, `select status, coalesce(phone_number, '') from public.whatsapp_sessions where id = $1::uuid`, sessionID).Scan(&sessionStatus, &sessionPhone); err != nil {
		t.Fatal(err)
	}
	if sessionStatus != "connected" || sessionPhone != "5511988887777" {
		t.Fatalf("native connection state = %s / %s", sessionStatus, sessionPhone)
	}

	lidItem := item("messages.upsert", "message_lid_quarantine.json")
	for attempt := 0; attempt < 2; attempt++ {
		if handled, err := repo.processEvolutionWebhookNative(ctx, lidItem); err != nil || !handled {
			t.Fatalf("native LID quarantine attempt %d = handled:%v error:%v", attempt+1, handled, err)
		}
	}
	var lidConversationCount, lidMessageCount int
	var lidLeadID string
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::integer, coalesce(max(lead_id::text), '')
		from public.whatsapp_conversations
		where organization_id = $1::uuid and session_id = $2::uuid and remote_jid = '987654321012345@lid'
	`, organizationID, sessionID).Scan(&lidConversationCount, &lidLeadID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::integer from public.whatsapp_messages
		where organization_id = $1::uuid and session_id = $2::uuid and message_id = 'provider-lid-quarantine-1'
	`, organizationID, sessionID).Scan(&lidMessageCount); err != nil {
		t.Fatal(err)
	}
	if lidConversationCount != 1 || lidMessageCount != 1 || lidLeadID != "" {
		t.Fatalf("LID quarantine state = conversations:%d messages:%d lead:%q", lidConversationCount, lidMessageCount, lidLeadID)
	}
	var promotedLeadID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.leads (organization_id, assigned_user_id, name, phone, source)
		values ($1::uuid, $2::uuid, 'Contato LID promovido', '5511666665555', 'manual')
		returning id::text
	`, organizationID, userID).Scan(&promotedLeadID); err != nil {
		t.Fatal(err)
	}
	var preexistingCanonicalConversationID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_conversations (
		  organization_id, session_id, lead_id, assigned_user_id, remote_jid,
		  contact_phone, contact_name, unread_count
		) values (
		  $1::uuid, $2::uuid, $3::uuid, $4::uuid, '5511666665555@s.whatsapp.net',
		  '5511666665555', 'Contato LID promovido', 0
		) returning id::text
	`, organizationID, sessionID, promotedLeadID, userID).Scan(&preexistingCanonicalConversationID); err != nil {
		t.Fatal(err)
	}

	var lidForeignOrganizationID, lidForeignUserID, lidForeignSessionID, lidForeignConversationID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.organizations (name, slug) values ($1, $1) returning id::text
	`, suffix+"-lid-foreign").Scan(&lidForeignOrganizationID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		_, _ = postgres.Pool().Exec(cleanupCtx, `delete from public.organizations where id = $1::uuid`, lidForeignOrganizationID)
		_, _ = postgres.Pool().Exec(cleanupCtx, `delete from auth.users where id = $1::uuid`, lidForeignUserID)
	})
	if err := postgres.Pool().QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&lidForeignUserID); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into auth.users (
		  id, aud, role, email, encrypted_password, email_confirmed_at,
		  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
		) values ($1::uuid, 'authenticated', 'authenticated', $2, '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());
		insert into public.users (id, organization_id, name, email, role, is_active)
		values ($1::uuid, $3::uuid, $4, $2, 'user', true);
		insert into public.organization_members (organization_id, user_id, role, is_active)
		values ($3::uuid, $1::uuid, 'user', true)
	`, lidForeignUserID, suffix+"-lid-foreign@example.invalid", lidForeignOrganizationID, suffix+"-lid-foreign"); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_sessions (
		  organization_id, instance_name, instance_id, owner_user_id, provider, status, is_active
		) values ($1::uuid, $2, $2, $3::uuid, 'evolution_go', 'connected', true)
		returning id::text
	`, lidForeignOrganizationID, suffix+"-lid-foreign", lidForeignUserID).Scan(&lidForeignSessionID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_conversations (
		  organization_id, session_id, remote_jid, contact_name, unread_count
		) values ($1::uuid, $2::uuid, '987654321012345@lid', 'Outro tenant', 0)
		returning id::text
	`, lidForeignOrganizationID, lidForeignSessionID).Scan(&lidForeignConversationID); err != nil {
		t.Fatal(err)
	}

	lidPromotionItem := item("messages.upsert", "message_lid_promote.json")
	for attempt := 0; attempt < 2; attempt++ {
		if handled, err := repo.processEvolutionWebhookNative(ctx, lidPromotionItem); err != nil || !handled {
			t.Fatalf("native LID promotion attempt %d = handled:%v error:%v", attempt+1, handled, err)
		}
	}
	var activeCanonicalConversations, activeLIDConversations, promotedHistoryRows int
	var promotedConversationID, promotedHistoryLeadID, promotedAliasCanonical string
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::integer, coalesce(max(id::text), '')
		from public.whatsapp_conversations
		where organization_id = $1::uuid and session_id = $2::uuid
		  and remote_jid = '5511666665555@s.whatsapp.net' and deleted_at is null
	`, organizationID, sessionID).Scan(&activeCanonicalConversations, &promotedConversationID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::integer from public.whatsapp_conversations
		where organization_id = $1::uuid and session_id = $2::uuid
		  and remote_jid = '987654321012345@lid' and deleted_at is null
	`, organizationID, sessionID).Scan(&activeLIDConversations); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::integer, coalesce(max(lead_id::text), '')
		from public.whatsapp_messages
		where organization_id = $1::uuid and session_id = $2::uuid
		  and conversation_id = $3::uuid
		  and message_id in ('provider-lid-quarantine-1', 'provider-lid-promote-2')
	`, organizationID, sessionID, promotedConversationID).Scan(&promotedHistoryRows, &promotedHistoryLeadID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select canonical_jid from public.whatsapp_contact_identity_aliases
		where organization_id = $1::uuid and session_id = $2::uuid and alias_jid = '987654321012345@lid'
	`, organizationID, sessionID).Scan(&promotedAliasCanonical); err != nil {
		t.Fatal(err)
	}
	var foreignLIDActive bool
	if err := postgres.Pool().QueryRow(ctx, `
		select deleted_at is null from public.whatsapp_conversations
		where organization_id = $1::uuid and session_id = $2::uuid and id = $3::uuid
	`, lidForeignOrganizationID, lidForeignSessionID, lidForeignConversationID).Scan(&foreignLIDActive); err != nil {
		t.Fatal(err)
	}
	if activeCanonicalConversations != 1 || activeLIDConversations != 0 || promotedHistoryRows != 2 ||
		promotedConversationID != preexistingCanonicalConversationID || promotedHistoryLeadID != promotedLeadID ||
		promotedAliasCanonical != "5511666665555@s.whatsapp.net" || !foreignLIDActive {
		t.Fatalf("LID promotion state = canonical:%d lid:%d history:%d lead:%s alias:%s foreignActive:%v",
			activeCanonicalConversations, activeLIDConversations, promotedHistoryRows, promotedHistoryLeadID, promotedAliasCanonical, foreignLIDActive)
	}

	var wrongOrganizationID string
	if err := postgres.Pool().QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&wrongOrganizationID); err != nil {
		t.Fatal(err)
	}
	crossTenant := item("messages.upsert", "message_text.json")
	crossTenant.OrganizationID = wrongOrganizationID
	if handled, err := repo.processEvolutionWebhookNative(ctx, crossTenant); !handled || !errors.Is(err, ErrSessionNotFound) {
		t.Fatalf("cross-tenant event = handled:%v error:%v, want ErrSessionNotFound", handled, err)
	}

	if handled, err := repo.processEvolutionWebhookNative(ctx, item("messages.upsert", "meta_referral.json")); err != nil || !handled {
		t.Fatalf("unverified Meta referral must be quarantined natively: handled:%v error:%v", handled, err)
	}
	var invalidCampaignLeadCount int
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::integer from public.leads
		where organization_id = $1::uuid and normalize_phone(phone) = normalize_phone('5511777776666')
	`, organizationID).Scan(&invalidCampaignLeadCount); err != nil {
		t.Fatal(err)
	}
	if invalidCampaignLeadCount != 0 {
		t.Fatalf("unverified Meta referral created %d leads", invalidCampaignLeadCount)
	}

	var roundRobinUserID, roundRobinID, inboundRuleID string
	if err := postgres.Pool().QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&roundRobinUserID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		_, _ = postgres.Pool().Exec(cleanupCtx, `delete from auth.users where id = $1::uuid`, roundRobinUserID)
	})
	if _, err := postgres.Pool().Exec(ctx, `
		insert into auth.users (
		  id, aud, role, email, encrypted_password, email_confirmed_at,
		  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
		) values ($1::uuid, 'authenticated', 'authenticated', $2, '', now(), '{}'::jsonb, '{}'::jsonb, now(), now())
	`, roundRobinUserID, suffix+"-rr@example.invalid"); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.users (id, organization_id, name, email, role, is_active)
		values ($1::uuid, $2::uuid, 'Round Robin User', $3, 'user', true)
	`, roundRobinUserID, organizationID, suffix+"-rr@example.invalid"); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.organization_members (organization_id, user_id, role, is_active)
		values ($1::uuid, $2::uuid, 'user', true)
	`, organizationID, roundRobinUserID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.round_robins (organization_id, name, is_active, current_position, created_by)
		values ($1::uuid, $2, true, 0, $3::uuid) returning id::text
	`, organizationID, suffix+" RR", userID).Scan(&roundRobinID); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.round_robin_members (
		  organization_id, round_robin_id, user_id, position, is_active
		) values ($1::uuid, $2::uuid, $3::uuid, 0, true)
	`, organizationID, roundRobinID, roundRobinUserID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_inbound_rules (
		  organization_id, session_id, name, match_type, match_field, match_value,
		  priority, is_active, target_round_robin_id, campaign_label
		) values (
		  $1::uuid, $2::uuid, $3, 'exact', 'ad_id', '120249512922100328',
		  100, true, $4::uuid, 'Campanha roteada'
		) returning id::text
	`, organizationID, sessionID, suffix+" inbound", roundRobinID).Scan(&inboundRuleID); err != nil {
		t.Fatal(err)
	}

	verifiedCampaign := item("messages.upsert", "meta_ctwa_instagram.json")
	var verifiedLeadCount int
	for attempt := 0; attempt < 2; attempt++ {
		if handled, err := repo.processEvolutionWebhookNative(ctx, verifiedCampaign); err != nil || !handled {
			t.Fatalf("confirmed CTWA attempt %d = handled:%v error:%v", attempt+1, handled, err)
		}
	}
	var campaignConversationLeadID, campaignMessageLeadID string
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::integer from public.leads
		where organization_id = $1::uuid and normalize_phone(phone) = normalize_phone('559491298288')
	`, organizationID).Scan(&verifiedLeadCount); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select coalesce(lead_id::text, '') from public.whatsapp_conversations
		where organization_id = $1::uuid and session_id = $2::uuid and remote_jid = '559491298288@s.whatsapp.net'
	`, organizationID, sessionID).Scan(&campaignConversationLeadID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select coalesce(lead_id::text, '') from public.whatsapp_messages
		where organization_id = $1::uuid and session_id = $2::uuid and message_id = 'provider-meta-ctwa-instagram-1'
	`, organizationID, sessionID).Scan(&campaignMessageLeadID); err != nil {
		t.Fatal(err)
	}
	if verifiedLeadCount != 1 || campaignConversationLeadID == "" || campaignConversationLeadID != campaignMessageLeadID {
		t.Fatalf("confirmed CTWA state = leads:%d conversationLead:%s messageLead:%s", verifiedLeadCount, campaignConversationLeadID, campaignMessageLeadID)
	}
	var campaignAssignedUserID, campaignPropertyID, campaignInterestPropertyID string
	var roundRobinPosition int
	var roundRobinLogs, leadMetaRows, leadEntryRows, activityRows, inboundLogRows int
	var leadEntryProviderID, leadEntryMetadataProviderID, creativeInstagramURL, storedEntryPoint string
	if err := postgres.Pool().QueryRow(ctx, `
		select coalesce(assigned_user_id::text, ''), coalesce(property_id::text, ''), coalesce(interest_property_id::text, '')
		from public.leads where id = $1::uuid
	`, campaignConversationLeadID).Scan(&campaignAssignedUserID, &campaignPropertyID, &campaignInterestPropertyID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `select current_position from public.round_robins where id = $1::uuid`, roundRobinID).Scan(&roundRobinPosition); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::integer from public.round_robin_logs
		where organization_id = $1::uuid and round_robin_id = $2::uuid and lead_id = $3::uuid
	`, organizationID, roundRobinID, campaignConversationLeadID).Scan(&roundRobinLogs); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::integer, coalesce(max(creative_instagram_url), '')
		from public.lead_meta where organization_id = $1::uuid and lead_id = $2::uuid
	`, organizationID, campaignConversationLeadID).Scan(&leadMetaRows, &creativeInstagramURL); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::integer, coalesce(max(provider_event_id), ''), coalesce(max(metadata->>'provider_event_id'), '')
		from public.lead_entry_events
		where organization_id = $1::uuid and lead_id = $2::uuid and metadata->>'message_id' = 'provider-meta-ctwa-instagram-1'
	`, organizationID, campaignConversationLeadID).Scan(&leadEntryRows, &leadEntryProviderID, &leadEntryMetadataProviderID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::integer from public.activities
		where organization_id = $1::uuid and lead_id = $2::uuid and metadata->>'message_id' = 'provider-meta-ctwa-instagram-1'
	`, organizationID, campaignConversationLeadID).Scan(&activityRows); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::integer from public.whatsapp_inbound_logs
		where organization_id = $1::uuid and session_id = $2::uuid
		  and match_details->>'message_id' = 'provider-meta-ctwa-instagram-1'
		  and matched_rule_id = $3::uuid and lead_id = $4::uuid
	`, organizationID, sessionID, inboundRuleID, campaignConversationLeadID).Scan(&inboundLogRows); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select coalesce(metadata #>> '{whatsapp_referral,entry_point_conversion_source}', '')
		from public.whatsapp_messages
		where organization_id = $1::uuid and session_id = $2::uuid and message_id = 'provider-meta-ctwa-instagram-1'
	`, organizationID, sessionID).Scan(&storedEntryPoint); err != nil {
		t.Fatal(err)
	}
	expectedProviderID := sessionID + ":provider-meta-ctwa-instagram-1"
	if campaignAssignedUserID != userID || campaignPropertyID != "" || campaignInterestPropertyID != "" || roundRobinPosition != 0 || roundRobinLogs != 0 ||
		leadMetaRows != 1 || leadEntryRows != 1 || leadEntryProviderID != "nonmanaged:"+expectedProviderID || leadEntryMetadataProviderID != expectedProviderID ||
		activityRows != 1 || inboundLogRows != 1 || creativeInstagramURL != "https://www.instagram.com/p/Dcyi6FjgAeQ/" || storedEntryPoint != "ctwa_ad" {
		t.Fatalf("CTWA owner fallback parity = assignee:%s property:%s interest:%s rrPos:%d rrLogs:%d leadMeta:%d entries:%d provider:%s metadataProvider:%s activities:%d inbound:%d instagram:%s entry:%s",
			campaignAssignedUserID, campaignPropertyID, campaignInterestPropertyID, roundRobinPosition, roundRobinLogs, leadMetaRows, leadEntryRows,
			leadEntryProviderID, leadEntryMetadataProviderID, activityRows, inboundLogRows, creativeInstagramURL, storedEntryPoint)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.properties (organization_id, code, title) values
		  ($1::uuid, 'AMBIG-META-1', 'Ambiguo A'),
		  ($1::uuid, 'AMBIG-META-1', 'Ambiguo B')
	`, organizationID); err != nil {
		t.Fatal(err)
	}
	propertyTx, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	ambiguousPropertyID, propertyErr := resolveNativeCampaignProperty(ctx, propertyTx, organizationID, "AMBIG-META-1")
	_ = propertyTx.Rollback(ctx)
	if propertyErr != nil || ambiguousPropertyID != "" {
		t.Fatalf("ambiguous property must fail closed: id:%q error:%v", ambiguousPropertyID, propertyErr)
	}

	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_sessions
		set advanced_settings = coalesce(advanced_settings, '{}'::jsonb) || '{"ai_auto_reply_enabled":true}'::jsonb
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, sessionID); err != nil {
		t.Fatal(err)
	}
	autoReplyItem := item("messages.upsert", "message_text.json")
	autoReplyItem.Payload = []byte(strings.ReplaceAll(string(autoReplyItem.Payload), "provider-inbound-text-1", "provider-inbound-autoreply-1"))
	for attempt := 0; attempt < 2; attempt++ {
		if handled, err := repo.processEvolutionWebhookNative(ctx, autoReplyItem); err != nil || !handled {
			t.Fatalf("native auto-reply enqueue attempt %d = handled:%v error:%v", attempt+1, handled, err)
		}
	}
	var autoReplyMessageRowID string
	var autoReplyJobs, autoReplyInboundLogs int
	if err := postgres.Pool().QueryRow(ctx, `
		select id::text from public.whatsapp_messages
		where organization_id = $1::uuid and session_id = $2::uuid and message_id = 'provider-inbound-autoreply-1'
	`, organizationID, sessionID).Scan(&autoReplyMessageRowID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::integer from public.jobs
		where organization_id = $1::uuid and job_type = 'whatsapp_ai_autoreply'
		  and payload->>'messageId' = $2
	`, organizationID, autoReplyMessageRowID).Scan(&autoReplyJobs); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::integer from public.whatsapp_inbound_logs
		where organization_id = $1::uuid and session_id = $2::uuid
		  and match_details->>'message_id' = 'provider-inbound-autoreply-1'
	`, organizationID, sessionID).Scan(&autoReplyInboundLogs); err != nil {
		t.Fatal(err)
	}
	if autoReplyJobs != 1 || autoReplyInboundLogs != 1 {
		t.Fatalf("auto-reply idempotency = jobs:%d inboundLogs:%d", autoReplyJobs, autoReplyInboundLogs)
	}
}
