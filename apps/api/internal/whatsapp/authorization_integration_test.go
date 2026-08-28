package whatsapp

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// TestWhatsAppHistoryRejectsBOLA exercises the real repository SQL. It is
// intentionally opt-in so the regular unit suite never mutates a developer or
// production database. Point WHATSAPP_TEST_DATABASE_URL at an isolated test DB.
func TestWhatsAppHistoryRejectsBOLA(t *testing.T) {
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

	fixtureSuffix := fmt.Sprintf("authz-%d", time.Now().UnixNano())
	var organizationID, foreignOrganizationID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.organizations (name, slug)
		values ($1, $2)
		returning id::text
	`, fixtureSuffix, fixtureSuffix).Scan(&organizationID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.organizations (name, slug)
		values ($1, $2)
		returning id::text
	`, fixtureSuffix+"-foreign", fixtureSuffix+"-foreign").Scan(&foreignOrganizationID); err != nil {
		t.Fatal(err)
	}

	userIDs := make([]string, 0, 3)
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		_, _ = postgres.Pool().Exec(cleanupCtx, `delete from public.organizations where id = any($1::uuid[])`, []string{organizationID, foreignOrganizationID})
		_, _ = postgres.Pool().Exec(cleanupCtx, `delete from auth.users where id = any($1::uuid[])`, userIDs)
	})

	createUser := func(orgID, role, emailSuffix string) string {
		t.Helper()
		var userID string
		if err := postgres.Pool().QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&userID); err != nil {
			t.Fatal(err)
		}
		email := fixtureSuffix + "-" + emailSuffix + "@example.invalid"
		if _, err := postgres.Pool().Exec(ctx, `
			insert into auth.users (
				id, aud, role, email, encrypted_password, email_confirmed_at,
				raw_app_meta_data, raw_user_meta_data, created_at, updated_at
			) values (
				$1::uuid, 'authenticated', 'authenticated', $2, '', now(),
				'{}'::jsonb, '{}'::jsonb, now(), now()
			)
		`, userID, email); err != nil {
			t.Fatal(err)
		}
		if _, err := postgres.Pool().Exec(ctx, `
			insert into public.users (id, organization_id, name, email, role, is_active)
			values ($1::uuid, $2::uuid, $3, $4, 'user', true)
		`, userID, orgID, emailSuffix, email); err != nil {
			t.Fatal(err)
		}
		if _, err := postgres.Pool().Exec(ctx, `
			insert into public.organization_members (organization_id, user_id, role, is_active)
			values ($1::uuid, $2::uuid, $3, true)
		`, orgID, userID, role); err != nil {
			t.Fatal(err)
		}
		userIDs = append(userIDs, userID)
		return userID
	}
	brokerID := createUser(organizationID, "user", "broker")
	otherBrokerID := createUser(organizationID, "user", "other-broker")
	foreignBrokerID := createUser(foreignOrganizationID, "user", "foreign-broker")

	var sessionID, foreignSessionID, ownLeadID, otherLeadID, thirdLeadID, claimLeadID, sessionMismatchLeadID, foreignLeadID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_sessions (
			organization_id, instance_name, owner_user_id,
			provider, status, is_active
		) values ($1::uuid, $2, $3::uuid, 'evolution_go', 'connected', true)
		returning id::text
	`, organizationID, fixtureSuffix, otherBrokerID).Scan(&sessionID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_sessions (
			organization_id, instance_name, owner_user_id,
			provider, status, phone_number, is_active
		) values ($1::uuid, $2, $3::uuid, 'evolution_go', 'connected', '5511999990000', true)
		returning id::text
	`, foreignOrganizationID, fixtureSuffix+"-foreign-session-secret", foreignBrokerID).Scan(&foreignSessionID); err != nil {
		t.Fatal(err)
	}
	createLead := func(orgID, assigneeID, name string) string {
		t.Helper()
		var leadID string
		if err := postgres.Pool().QueryRow(ctx, `
			insert into public.leads (organization_id, assigned_user_id, name, source)
			values ($1::uuid, $2::uuid, $3, 'manual')
			returning id::text
		`, orgID, assigneeID, name).Scan(&leadID); err != nil {
			t.Fatal(err)
		}
		return leadID
	}
	ownLeadID = createLead(organizationID, brokerID, fixtureSuffix+"-own")
	otherLeadID = createLead(organizationID, otherBrokerID, fixtureSuffix+"-other")
	thirdLeadID = createLead(organizationID, otherBrokerID, fixtureSuffix+"-third")
	claimLeadID = createLead(organizationID, otherBrokerID, fixtureSuffix+"-claim")
	sessionMismatchLeadID = createLead(organizationID, brokerID, fixtureSuffix+"-session-mismatch")
	foreignLeadID = createLead(foreignOrganizationID, foreignBrokerID, fixtureSuffix+"-foreign")

	createConversation := func(leadID, remoteJID string) string {
		t.Helper()
		var conversationID string
		if err := postgres.Pool().QueryRow(ctx, `
			insert into public.whatsapp_conversations (
				organization_id, session_id, lead_id, remote_jid, contact_name
			) values ($1::uuid, $2::uuid, $3::uuid, $4, $4)
			returning id::text
		`, organizationID, sessionID, leadID, remoteJID).Scan(&conversationID); err != nil {
			t.Fatal(err)
		}
		if _, err := postgres.Pool().Exec(ctx, `
			insert into public.whatsapp_messages (
				organization_id, conversation_id, session_id, lead_id,
				message_id, content, message_type, status
			) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $5, 'text', 'received')
		`, organizationID, conversationID, sessionID, leadID, fixtureSuffix+"-"+leadID); err != nil {
			t.Fatal(err)
		}
		return conversationID
	}
	ownConversationID := createConversation(ownLeadID, fixtureSuffix+"-own@s.whatsapp.net")
	otherConversationID := createConversation(otherLeadID, fixtureSuffix+"-other@s.whatsapp.net")
	messageSequence := 0
	insertMessage := func(conversationID string, leadID any, messageType string) string {
		t.Helper()
		messageSequence++
		providerMessageID := fmt.Sprintf("%s-extra-%d", fixtureSuffix, messageSequence)
		var messageID string
		if err := postgres.Pool().QueryRow(ctx, `
			insert into public.whatsapp_messages (
				organization_id, conversation_id, session_id, lead_id,
				message_id, provider_message_id, content, message_type,
				media_url, status
			) values (
				$1::uuid, $2::uuid, $3::uuid, $4::uuid,
				$5, $5, $5, $6,
				case when $6 = 'image' then 'https://mmg.whatsapp.net/media/test' else null end,
				'received'
			)
			returning id::text
		`, organizationID, conversationID, sessionID, leadID, providerMessageID, messageType).Scan(&messageID); err != nil {
			t.Fatal(err)
		}
		return messageID
	}
	nullLeadMessageID := insertMessage(ownConversationID, nil, "text")
	mismatchedOwnConversationMessageID := insertMessage(ownConversationID, thirdLeadID, "text")
	mismatchedOtherConversationMediaID := insertMessage(otherConversationID, thirdLeadID, "image")

	var crossOrganizationSessionConversationID string
	legacyFixtureTx, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := legacyFixtureTx.Exec(ctx, `set local session_replication_role = replica`); err != nil {
		_ = legacyFixtureTx.Rollback(ctx)
		t.Fatal(err)
	}
	if err := legacyFixtureTx.QueryRow(ctx, `
		insert into public.whatsapp_conversations (
			organization_id, session_id, lead_id, remote_jid, contact_name
		) values ($1::uuid, $2::uuid, $3::uuid, $4, $4)
		returning id::text
	`, organizationID, foreignSessionID, sessionMismatchLeadID, fixtureSuffix+"-session-mismatch@s.whatsapp.net").Scan(&crossOrganizationSessionConversationID); err != nil {
		_ = legacyFixtureTx.Rollback(ctx)
		t.Fatal(err)
	}
	if err := legacyFixtureTx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	insertMessage(crossOrganizationSessionConversationID, sessionMismatchLeadID, "text")

	repo := NewRepository(postgres, nil, StorageConfig{})
	broker := tenant.Context{OrganizationID: organizationID, UserID: brokerID, MemberRole: "user"}

	sessionMismatchHistory, err := repo.GetHistoryAccess(ctx, broker, HistoryAccessFilter{LeadID: sessionMismatchLeadID})
	if err != nil {
		t.Fatalf("cross-organization historical session: %v", err)
	}
	if len(sessionMismatchHistory.Conversations) != 1 {
		t.Fatalf("cross-organization historical session conversations = %#v, want one", sessionMismatchHistory.Conversations)
	}
	safeSessionMismatchConversation := sessionMismatchHistory.Conversations[0]
	if safeSessionMismatchConversation.ID != crossOrganizationSessionConversationID ||
		safeSessionMismatchConversation.SessionID != "" ||
		safeSessionMismatchConversation.Session != nil {
		t.Fatalf("history exposed a cross-organization session reference: %#v", safeSessionMismatchConversation)
	}
	serializedSessionMismatch := fmt.Sprintf("%#v", safeSessionMismatchConversation)
	if strings.Contains(serializedSessionMismatch, foreignSessionID) ||
		strings.Contains(serializedSessionMismatch, fixtureSuffix+"-foreign-session-secret") ||
		strings.Contains(serializedSessionMismatch, "5511999990000") {
		t.Fatalf("history leaked cross-organization session metadata: %s", serializedSessionMismatch)
	}

	access, err := repo.GetHistoryAccess(ctx, broker, HistoryAccessFilter{LeadID: ownLeadID})
	if err != nil {
		t.Fatalf("own lead history: %v", err)
	}
	if len(access.Messages) != 2 {
		t.Fatalf("own history = %#v, want the explicit own-lead and legacy null-lead messages", access.Messages)
	}
	for _, message := range access.Messages {
		if message.ConversationID != ownConversationID || message.ID == mismatchedOwnConversationMessageID {
			t.Fatalf("own history leaked a mismatched lead message: %#v", access.Messages)
		}
	}
	conversationPage, err := repo.ListMessages(ctx, broker, ownConversationID, MessageFilter{Limit: 50})
	if err != nil {
		t.Fatalf("own conversation messages: %v", err)
	}
	if len(conversationPage.Messages) != 2 {
		t.Fatalf("own conversation messages = %#v, want own/null lead rows only", conversationPage.Messages)
	}
	seenNullLeadMessage := false
	for _, message := range conversationPage.Messages {
		if message.ID == mismatchedOwnConversationMessageID {
			t.Fatalf("conversation history leaked mismatched lead message %s", message.ID)
		}
		if message.ID == nullLeadMessageID {
			seenNullLeadMessage = true
		}
	}
	if !seenNullLeadMessage {
		t.Fatal("conversation history lost its legacy null-lead message")
	}
	visibleConversations, err := repo.ListConversations(ctx, broker, ConversationListFilter{Limit: 50})
	if err != nil {
		t.Fatalf("lead-scoped conversations without an owned session: %v", err)
	}
	if len(visibleConversations) != 1 || visibleConversations[0].ID != ownConversationID {
		t.Fatalf("lead-scoped conversations = %#v, want assigned lead on another owner's session", visibleConversations)
	}

	var relinkedConversationID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_conversations (
		  organization_id, session_id, lead_id, remote_jid, contact_name,
		  last_message, last_message_at, unread_count
		) values (
		  $1::uuid, $2::uuid, $3::uuid, $4, 'CURRENT OTHER LEAD SECRET',
		  'CURRENT OTHER MESSAGE SECRET', now(), 99
		) returning id::text
	`, organizationID, sessionID, thirdLeadID, fixtureSuffix+"-relinked@s.whatsapp.net").Scan(&relinkedConversationID); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.whatsapp_messages (
		  organization_id, conversation_id, session_id, lead_id,
		  message_id, content, message_type, status, remote_jid, sent_at
		) values (
		  $1::uuid, $2::uuid, $3::uuid, $4::uuid,
		  $5, 'historical own lead message', 'text', 'received', $6, now()
		)
	`, organizationID, relinkedConversationID, sessionID, ownLeadID,
		fixtureSuffix+"-relinked-history", fixtureSuffix+"-historical-own@s.whatsapp.net"); err != nil {
		t.Fatal(err)
	}
	relinkedHistory, err := repo.GetHistoryAccess(ctx, broker, HistoryAccessFilter{LeadID: ownLeadID, MessageFilter: MessageFilter{Limit: 50}})
	if err != nil {
		t.Fatalf("relinked immutable lead history: %v", err)
	}
	var safeHistoricalConversation *Conversation
	for index := range relinkedHistory.Conversations {
		if relinkedHistory.Conversations[index].ID == relinkedConversationID {
			safeHistoricalConversation = &relinkedHistory.Conversations[index]
			break
		}
	}
	if safeHistoricalConversation == nil {
		t.Fatalf("relinked immutable conversation missing: %#v", relinkedHistory.Conversations)
	}
	if pointerValue(safeHistoricalConversation.LeadID) != ownLeadID ||
		safeHistoricalConversation.Lead == nil || safeHistoricalConversation.Lead.ID != ownLeadID ||
		pointerValue(safeHistoricalConversation.ContactName) != fixtureSuffix+"-own" ||
		pointerValue(safeHistoricalConversation.LastMessage) != "historical own lead message" ||
		safeHistoricalConversation.UnreadCount != 0 {
		t.Fatalf("relinked history exposed mutable current-lead DTO: %#v", safeHistoricalConversation)
	}
	serializedHistorical := fmt.Sprintf("%#v", safeHistoricalConversation)
	if strings.Contains(serializedHistorical, "CURRENT OTHER") || strings.Contains(serializedHistorical, thirdLeadID) {
		t.Fatalf("relinked history leaked current lead metadata: %s", serializedHistorical)
	}

	if _, err := repo.GetHistoryAccess(ctx, broker, HistoryAccessFilter{LeadID: otherLeadID}); !errors.Is(err, ErrInvalidReference) {
		t.Fatalf("same-organization BOLA error = %v, want invalid reference", err)
	}
	if _, err := repo.GetConversation(ctx, broker, otherConversationID); !errors.Is(err, ErrConversationNotFound) {
		t.Fatalf("same-organization conversation IDOR error = %v, want not found", err)
	}
	if _, err := repo.GetHistoryAccess(ctx, broker, HistoryAccessFilter{LeadID: foreignLeadID}); !errors.Is(err, ErrInvalidReference) {
		t.Fatalf("cross-organization BOLA error = %v, want invalid reference", err)
	}

	otherBroker := tenant.Context{OrganizationID: organizationID, UserID: otherBrokerID, MemberRole: "user"}
	if _, err := repo.ReactToMessage(ctx, otherBroker, otherConversationID, mismatchedOtherConversationMediaID, reactToMessageInput{
		Emoji:            "👍",
		ClientReactionID: fixtureSuffix + "-mismatched-reaction",
	}); !errors.Is(err, ErrMessageNotFound) {
		t.Fatalf("reaction to mismatched lead message error = %v, want message not found", err)
	}
	if _, err := repo.RetryMediaDownload(ctx, otherBroker, mismatchedOtherConversationMediaID); !errors.Is(err, ErrMessageNotFound) {
		t.Fatalf("media retry for mismatched lead message error = %v, want message not found", err)
	}

	if err := repo.DeleteConversation(ctx, broker, ownConversationID); !errors.Is(err, ErrConversationNotFound) {
		t.Fatalf("ordinary lead viewer delete error = %v, want conversation not found", err)
	}
	if err := repo.DeleteConversation(ctx, otherBroker, ownConversationID); err != nil {
		t.Fatalf("session owner could not soft-delete conversation: %v", err)
	}
	if _, err := repo.ListMessages(ctx, broker, ownConversationID, MessageFilter{Limit: 50}); !errors.Is(err, ErrConversationNotFound) {
		t.Fatalf("soft-deleted conversation remained operational: %v", err)
	}
	deletedHistory, err := repo.GetHistoryAccess(ctx, broker, HistoryAccessFilter{LeadID: ownLeadID})
	if err != nil {
		t.Fatalf("immutable lead history after soft delete: %v", err)
	}
	if len(deletedHistory.Messages) != 3 || len(deletedHistory.Conversations) != 2 {
		t.Fatalf("soft delete hid or mixed immutable history: %#v", deletedHistory)
	}

	admin := broker
	admin.MemberRole = "admin"
	if _, err := postgres.Pool().Exec(ctx, `
		update public.leads set phone = '5511777774444' where id = $1::uuid
	`, claimLeadID); err != nil {
		t.Fatal(err)
	}
	var quarantineID, explicitOldMessageID, legacyNullMessageID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_conversations (
		  organization_id, session_id, remote_jid, contact_phone, contact_name
		) values ($1::uuid, $2::uuid, '5511777774444@s.whatsapp.net', '5511777774444', 'Quarantine')
		returning id::text
	`, organizationID, sessionID).Scan(&quarantineID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_messages (
		  organization_id, conversation_id, session_id, lead_id,
		  message_id, content, message_type, status
		) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, 'old evidence', 'text', 'received')
		returning id::text
	`, organizationID, quarantineID, sessionID, otherLeadID, fixtureSuffix+"-explicit-old").Scan(&explicitOldMessageID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_messages (
		  organization_id, conversation_id, session_id, lead_id,
		  message_id, content, message_type, status
		) values ($1::uuid, $2::uuid, $3::uuid, null, $4, 'legacy null evidence', 'text', 'received')
		returning id::text
	`, organizationID, quarantineID, sessionID, fixtureSuffix+"-legacy-null").Scan(&legacyNullMessageID); err != nil {
		t.Fatal(err)
	}
	if err := repo.LinkConversationToLead(ctx, admin, quarantineID, claimLeadID); err != nil {
		t.Fatalf("admin quarantine claim: %v", err)
	}
	var explicitLeadAfter, legacyLeadAfter string
	if err := postgres.Pool().QueryRow(ctx, `
		select
		  max(lead_id::text) filter (where id = $1::uuid),
		  max(lead_id::text) filter (where id = $2::uuid)
		from public.whatsapp_messages
	`, explicitOldMessageID, legacyNullMessageID).Scan(&explicitLeadAfter, &legacyLeadAfter); err != nil {
		t.Fatal(err)
	}
	if explicitLeadAfter != otherLeadID || legacyLeadAfter != claimLeadID {
		t.Fatalf("quarantine claim rewrote immutable evidence: explicit=%s legacy=%s", explicitLeadAfter, legacyLeadAfter)
	}
	if _, err := repo.GetHistoryAccess(ctx, admin, HistoryAccessFilter{LeadID: otherLeadID}); err != nil {
		t.Fatalf("admin should preserve organization-wide lead access: %v", err)
	}
}
