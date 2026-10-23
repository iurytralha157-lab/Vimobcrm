package whatsapp

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
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
	target, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	if host := strings.ToLower(target.Hostname()); host != "localhost" && host != "127.0.0.1" && host != "::1" {
		t.Fatal("authorization fixture requires a loopback database")
	}
	if name := strings.TrimPrefix(target.Path, "/"); name != "vimob_whatsapp_test" && name != "vimob_whatsapp_clone" {
		t.Fatal("authorization fixture requires disposable vimob_whatsapp_test")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(postgres.Close)

	var signingRequests atomic.Int32
	storage := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		signingRequests.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"signedURL":"/object/sign/whatsapp-media/authorized?token=test"}`))
	}))
	defer storage.Close()

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
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		if _, err := postgres.Pool().Exec(cleanupCtx, `
			update public.users set organization_id = null where organization_id = any($1::uuid[]);
			delete from public.organizations where id = any($1::uuid[]);
			delete from public.users where id = any($2::uuid[]);
			delete from auth.users where id = any($2::uuid[])
		`, []string{organizationID, foreignOrganizationID}, userIDs); err != nil {
			t.Errorf("cleanup authorization fixture: %v", err)
		}
	}()

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
		userIDs = append(userIDs, userID)
		if _, err := postgres.Pool().Exec(ctx, `
			insert into public.users (id, organization_id, name, email, role, is_active)
			values ($1::uuid, $2::uuid, $3, $4, 'user', true)
			on conflict (id) do update set organization_id = excluded.organization_id,
			  name = excluded.name, email = excluded.email, role = excluded.role, is_active = true
		`, userID, orgID, emailSuffix, email); err != nil {
			t.Fatal(err)
		}
		if _, err := postgres.Pool().Exec(ctx, `
			insert into public.organization_members (organization_id, user_id, role, is_active)
			values ($1::uuid, $2::uuid, $3, true)
			on conflict (user_id, organization_id) do update set role = excluded.role,
			  is_active = true, deleted_at = null
		`, orgID, userID, role); err != nil {
			t.Fatal(err)
		}
		return userID
	}
	brokerID := createUser(organizationID, "user", "broker")
	otherBrokerID := createUser(organizationID, "user", "other-broker")
	foreignBrokerID := createUser(foreignOrganizationID, "user", "foreign-broker")
	adminID := createUser(organizationID, "admin", "admin")

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
	// These rows represent historical pre-cutover evidence, including malformed
	// old bindings. Current admission must reject equivalent new inserts. Seed
	// only the isolated legacy rows without manufacturing capture receipts.
	insertLegacyMessage := func(query string, arguments []any, destination ...any) error {
		t.Helper()
		legacyTx, err := postgres.Pool().Begin(ctx)
		if err != nil {
			return err
		}
		defer legacyTx.Rollback(ctx)
		if _, err := legacyTx.Exec(ctx, `set local session_replication_role = replica`); err != nil {
			return err
		}
		if err := legacyTx.QueryRow(ctx, query, arguments...).Scan(destination...); err != nil {
			return err
		}
		legacyID, ok := destination[0].(*string)
		if !ok {
			return errors.New("legacy fixture requires a message ID destination")
		}
		if _, err := legacyTx.Exec(ctx, `
			update public.whatsapp_messages message
			set capture_state = 'legacy', remote_jid = coalesce(message.remote_jid, conversation.remote_jid)
			from public.whatsapp_conversations conversation
			where message.id = $1::uuid and conversation.id = message.conversation_id
			  and conversation.organization_id = message.organization_id
		`, *legacyID); err != nil {
			return err
		}
		return legacyTx.Commit(ctx)
	}

	// Canonical current rows must satisfy B1's deferred active-binding invariant.
	// Malformed pre-cutover messages remain isolated in insertLegacyMessage.
	activateFixtureBinding := func(orgID, conversationID, leadID string) {
		t.Helper()
		if _, err := postgres.Pool().Exec(ctx, `
			select public.activate_whatsapp_conversation_lead_binding($1::uuid, $2::uuid, $3::uuid, null)
		`, orgID, conversationID, leadID); err != nil {
			t.Fatalf("canonical fixture binding: %v", err)
		}
	}
	createConversation := func(leadID, remoteJID string) string {
		t.Helper()
		var conversationID string
		if err := postgres.Pool().QueryRow(ctx, `
			insert into public.whatsapp_conversations (
				organization_id, session_id, remote_jid, contact_name
			) values ($1::uuid, $2::uuid, $3, $3)
			returning id::text
		`, organizationID, sessionID, remoteJID).Scan(&conversationID); err != nil {
			t.Fatal(err)
		}
		activateFixtureBinding(organizationID, conversationID, leadID)
		var historicalMessageID string
		if err := insertLegacyMessage(`
			insert into public.whatsapp_messages (
				organization_id, conversation_id, session_id, lead_id,
				message_id, content, message_type, status
			) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $5, 'text', 'received')
			returning id::text
		`, []any{organizationID, conversationID, sessionID, leadID, fixtureSuffix + "-" + leadID}, &historicalMessageID); err != nil {
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
		if err := insertLegacyMessage(`
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
		`, []any{organizationID, conversationID, sessionID, leadID, providerMessageID, messageType}, &messageID); err != nil {
			t.Fatal(err)
		}
		return messageID
	}
	nullLeadMessageID := insertMessage(ownConversationID, nil, "text")
	mismatchedOwnConversationMessageID := insertMessage(ownConversationID, thirdLeadID, "text")
	mismatchedOtherConversationMediaID := insertMessage(otherConversationID, thirdLeadID, "image")

	var foreignConversationID, foreignMediaMessageID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_conversations (
			organization_id, session_id, remote_jid, contact_name
		) values ($1::uuid, $2::uuid, $3, $3)
		returning id::text
	`, foreignOrganizationID, foreignSessionID, fixtureSuffix+"-foreign@s.whatsapp.net").Scan(&foreignConversationID); err != nil {
		t.Fatal(err)
	}
	activateFixtureBinding(foreignOrganizationID, foreignConversationID, foreignLeadID)
	foreignMediaPath := fmt.Sprintf(
		"orgs/%s/sessions/%s/incoming/%s-foreign.jpg",
		foreignOrganizationID,
		foreignSessionID,
		fixtureSuffix,
	)
	if err := insertLegacyMessage(`
		insert into public.whatsapp_messages (
			organization_id, conversation_id, session_id, lead_id,
			message_id, content, message_type, media_status,
			media_storage_path, status
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid,
			$5, 'foreign media', 'image', 'ready', $6, 'received'
		)
		returning id::text
	`, []any{foreignOrganizationID, foreignConversationID, foreignSessionID, foreignLeadID,
		fixtureSuffix + "-foreign-media", foreignMediaPath}, &foreignMediaMessageID); err != nil {
		t.Fatal(err)
	}

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

	repo := NewRepository(postgres, nil, StorageConfig{
		ProjectURL: storage.URL,
		APIKey:     "service-role-test-key",
	})
	broker := tenant.Context{
		OrganizationID: organizationID,
		UserID:         brokerID,
		MemberRole:     "user",
		Permissions:    []string{permissions.LeadViewOwn},
	}
	otherBroker := tenant.Context{
		OrganizationID: organizationID,
		UserID:         otherBrokerID,
		MemberRole:     "user",
		Permissions:    []string{permissions.LeadViewOwn},
	}
	admin := tenant.Context{OrganizationID: organizationID, UserID: adminID, MemberRole: "admin"}

	t.Run("media rejects a cross-organization message id without signing", func(t *testing.T) {
		before := signingRequests.Load()
		if _, err := repo.GetMessageMediaURL(ctx, broker, foreignMediaMessageID); !errors.Is(err, ErrMessageNotFound) {
			t.Fatalf("cross-organization media error = %v, want message not found", err)
		}
		if got := signingRequests.Load(); got != before {
			t.Fatalf("cross-organization denial reached Storage signing: before=%d after=%d", before, got)
		}
	})

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
	if len(access.Messages) != 1 {
		t.Fatalf("own history = %#v, want only the explicitly attributed own-lead message", access.Messages)
	}
	for _, message := range access.Messages {
		if message.ConversationID != ownConversationID || message.ID == mismatchedOwnConversationMessageID || message.ID == nullLeadMessageID {
			t.Fatalf("own history leaked a mismatched lead message: %#v", access.Messages)
		}
	}
	conversationPage, err := repo.ListMessages(ctx, broker, ownConversationID, MessageFilter{Limit: 50})
	if err != nil {
		t.Fatalf("own conversation messages: %v", err)
	}
	if len(conversationPage.Messages) != 1 {
		t.Fatalf("own conversation messages = %#v, want only exact lead attribution", conversationPage.Messages)
	}
	for _, message := range conversationPage.Messages {
		if message.ID == mismatchedOwnConversationMessageID || message.ID == nullLeadMessageID {
			t.Fatalf("conversation history leaked unmatched lead message %s", message.ID)
		}
	}
	visibleConversations, err := repo.ListConversations(ctx, broker, ConversationListFilter{Limit: 50})
	if err != nil {
		t.Fatalf("lead-scoped conversations without an owned session: %v", err)
	}
	if len(visibleConversations) != 0 {
		t.Fatalf("operational inbox without access to the other owner's number = %#v, want no row", visibleConversations)
	}
	conversationSnapshot, err := repo.GetConversationSnapshot(ctx, broker, ownConversationID)
	if err != nil || conversationSnapshot.ID != ownConversationID || pointerValue(conversationSnapshot.LeadID) != ownLeadID {
		t.Fatalf("own conversation snapshot = %#v, %v", conversationSnapshot, err)
	}
	if _, err := repo.GetConversationSnapshot(ctx, broker, otherConversationID); !errors.Is(err, ErrConversationNotFound) {
		t.Fatalf("same-organization snapshot IDOR error = %v, want not found", err)
	}
	if _, err := repo.GetConversationSnapshot(ctx, broker, foreignConversationID); !errors.Is(err, ErrConversationNotFound) {
		t.Fatalf("cross-organization snapshot IDOR error = %v, want not found", err)
	}

	var relinkedConversationID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_conversations (
		  organization_id, session_id, remote_jid, contact_name
		) values ($1::uuid, $2::uuid, $3, 'CURRENT OTHER LEAD SECRET')
		returning id::text
	`, organizationID, sessionID, fixtureSuffix+"-relinked@s.whatsapp.net").Scan(&relinkedConversationID); err != nil {
		t.Fatal(err)
	}
	activateFixtureBinding(organizationID, relinkedConversationID, thirdLeadID)
	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_conversations
		set last_message = 'CURRENT OTHER MESSAGE SECRET', last_message_at = now(), unread_count = 99
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, relinkedConversationID); err != nil {
		t.Fatal(err)
	}
	var relinkedHistoricalMediaID string
	historicalMediaPath := fmt.Sprintf(
		"orgs/%s/sessions/%s/incoming/%s-historical-own.jpg",
		organizationID,
		sessionID,
		fixtureSuffix,
	)
	if err := insertLegacyMessage(`
		insert into public.whatsapp_messages (
		  organization_id, conversation_id, session_id, lead_id,
		  message_id, content, message_type, status, remote_jid, sent_at,
		  media_status, media_storage_path
		) values (
		  $1::uuid, $2::uuid, $3::uuid, $4::uuid,
		  $5, 'historical own lead message', 'image', 'received', $6, now(),
		  'ready', $7
		)
		returning id::text
	`, []any{organizationID, relinkedConversationID, sessionID, ownLeadID,
		fixtureSuffix + "-relinked-history", fixtureSuffix + "-historical-own@s.whatsapp.net",
		historicalMediaPath}, &relinkedHistoricalMediaID); err != nil {
		t.Fatal(err)
	}
	relinkedHistory, err := repo.GetHistoryAccess(ctx, broker, HistoryAccessFilter{
		ConversationID: relinkedConversationID,
		LeadID:         ownLeadID,
		MessageFilter:  MessageFilter{Limit: 50},
	})
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
		!safeHistoricalConversation.HistoricalLeadView ||
		pointerValue(safeHistoricalConversation.ContactName) != fixtureSuffix+"-own" ||
		pointerValue(safeHistoricalConversation.LastMessage) != "historical own lead message" ||
		safeHistoricalConversation.UnreadCount != 0 {
		t.Fatalf("relinked history exposed mutable current-lead DTO: %#v", safeHistoricalConversation)
	}
	serializedHistorical := fmt.Sprintf("%#v", safeHistoricalConversation)
	if strings.Contains(serializedHistorical, "CURRENT OTHER") || strings.Contains(serializedHistorical, thirdLeadID) {
		t.Fatalf("relinked history leaked current lead metadata: %s", serializedHistorical)
	}

	t.Run("media follows the immutable message lead after conversation relink", func(t *testing.T) {
		media, err := repo.GetMessageMediaURL(ctx, broker, relinkedHistoricalMediaID)
		if err != nil {
			t.Fatalf("historical message media: %v", err)
		}
		if media.MessageID != relinkedHistoricalMediaID || media.URL == "" {
			t.Fatalf("historical message media = %#v, want signed URL for %s", media, relinkedHistoricalMediaID)
		}
	})

	var formerlyThirdLeadMediaID string
	formerlyThirdLeadMediaPath := fmt.Sprintf(
		"orgs/%s/sessions/%s/incoming/%s-formerly-third.jpg",
		organizationID,
		sessionID,
		fixtureSuffix,
	)
	if err := insertLegacyMessage(`
		insert into public.whatsapp_messages (
		  organization_id, conversation_id, session_id, lead_id,
		  message_id, content, message_type, status,
		  media_status, media_storage_path, sent_at
		) values (
		  $1::uuid, $2::uuid, $3::uuid, $4::uuid,
		  $5, 'historical third lead media', 'image', 'received',
		  'ready', $6, now()
		)
		returning id::text
	`, []any{organizationID, relinkedConversationID, sessionID, thirdLeadID,
		fixtureSuffix + "-formerly-third-media", formerlyThirdLeadMediaPath}, &formerlyThirdLeadMediaID); err != nil {
		t.Fatal(err)
	}
	activateFixtureBinding(organizationID, relinkedConversationID,
		createLead(organizationID, brokerID, fixtureSuffix+"-current-relink"))

	t.Run("media relink cannot grant access to another leads historical message", func(t *testing.T) {
		before := signingRequests.Load()
		if _, err := repo.GetMessageMediaURL(ctx, broker, formerlyThirdLeadMediaID); !errors.Is(err, ErrMessageNotFound) {
			t.Fatalf("same-organization relink BOLA error = %v, want message not found", err)
		}
		if got := signingRequests.Load(); got != before {
			t.Fatalf("same-organization relink denial reached Storage signing: before=%d after=%d", before, got)
		}
	})

	t.Run("historical lead owner retains media after conversation relink", func(t *testing.T) {
		media, err := repo.GetMessageMediaURL(ctx, otherBroker, formerlyThirdLeadMediaID)
		if err != nil {
			t.Fatalf("former lead historical media: %v", err)
		}
		if media.MessageID != formerlyThirdLeadMediaID || media.URL == "" {
			t.Fatalf("former lead historical media = %#v, want signed URL for %s", media, formerlyThirdLeadMediaID)
		}
	})

	if _, err := repo.GetHistoryAccess(ctx, broker, HistoryAccessFilter{LeadID: otherLeadID}); !errors.Is(err, ErrInvalidReference) {
		t.Fatalf("same-organization BOLA error = %v, want invalid reference", err)
	}
	if _, err := repo.GetConversation(ctx, broker, otherConversationID); !errors.Is(err, ErrConversationNotFound) {
		t.Fatalf("same-organization conversation IDOR error = %v, want not found", err)
	}
	if _, err := repo.GetHistoryAccess(ctx, broker, HistoryAccessFilter{LeadID: foreignLeadID}); !errors.Is(err, ErrInvalidReference) {
		t.Fatalf("cross-organization BOLA error = %v, want invalid reference", err)
	}

	if _, err := repo.ReactToMessage(ctx, otherBroker, otherConversationID, mismatchedOtherConversationMediaID, reactToMessageInput{
		Emoji:            "👍",
		ClientReactionID: fixtureSuffix + "-mismatched-reaction",
		ExpectedLeadID:   otherLeadID,
	}); !errors.Is(err, ErrMessageNotFound) {
		t.Fatalf("reaction to mismatched lead message error = %v, want message not found", err)
	}
	if _, err := repo.RetryMediaDownload(ctx, otherBroker, mismatchedOtherConversationMediaID); !errors.Is(err, ErrMessageNotFound) {
		t.Fatalf("media retry for mismatched lead message error = %v, want message not found", err)
	}

	if err := repo.DeleteConversation(ctx, broker, ownConversationID, ownLeadID); !errors.Is(err, ErrConversationNotFound) {
		t.Fatalf("ordinary lead viewer delete error = %v, want conversation not found", err)
	}
	if err := repo.DeleteConversation(ctx, otherBroker, ownConversationID, ownLeadID); !errors.Is(err, ErrConversationNotFound) {
		t.Fatalf("session owner outside the lead's read scope delete = %v, want denied", err)
	}
	if err := repo.DeleteConversation(ctx, admin, ownConversationID, ownLeadID); !errors.Is(err, ErrConversationNotFound) {
		t.Fatalf("broad-history administrator operated another account without a grant: %v", err)
	}
	// An assigned recipient with an explicit grant may hide their operational
	// inbox entry. Broad CRM history alone does not confer this authority.
	if _, err := postgres.Pool().Exec(ctx, `update public.organization_members set role='admin' where organization_id=$1::uuid and user_id=$2::uuid`, organizationID, otherBrokerID); err != nil {
		t.Fatal(err)
	}
	ownerAdmin := tenant.Context{OrganizationID: organizationID, UserID: otherBrokerID, MemberRole: "admin", Permissions: []string{"*"}}
	if err := repo.GrantSessionAccess(ctx, ownerAdmin, sessionID, grantAccessInput{UserID: brokerID, CanView: true}); err != nil {
		t.Fatal(err)
	}
	if err := repo.DeleteConversation(ctx, broker, ownConversationID, ownLeadID); err != nil {
		t.Fatalf("assigned READ-grant recipient could not soft-delete conversation: %v", err)
	}
	if _, err := repo.ListMessages(ctx, broker, ownConversationID, MessageFilter{Limit: 50}); !errors.Is(err, ErrConversationNotFound) {
		t.Fatalf("soft-deleted conversation remained operational: %v", err)
	}
	deletedHistory, err := repo.GetHistoryAccess(ctx, broker, HistoryAccessFilter{LeadID: ownLeadID})
	if err != nil {
		t.Fatalf("immutable lead history after soft delete: %v", err)
	}
	if len(deletedHistory.Messages) != 2 || len(deletedHistory.Conversations) != 2 {
		t.Fatalf("soft delete hid or mixed immutable history: %#v", deletedHistory)
	}

	t.Run("explicit unlinked snapshot fails closed after null to lead binding", func(t *testing.T) {
		targetLeadID := createLead(organizationID, otherBrokerID, fixtureSuffix+"-unlinked-target")
		const phone = "5511888886666"
		if _, err := postgres.Pool().Exec(ctx, `
			update public.leads set phone = $2 where id = $1::uuid
		`, targetLeadID, phone); err != nil {
			t.Fatal(err)
		}

		var conversationID string
		if err := postgres.Pool().QueryRow(ctx, `
			insert into public.whatsapp_conversations (
			  organization_id, session_id, remote_jid, contact_phone, contact_name, unread_count
			) values ($1::uuid, $2::uuid, $3, $4, 'Unlinked snapshot', 2)
			returning id::text
		`, organizationID, sessionID, phone+"@s.whatsapp.net", phone).Scan(&conversationID); err != nil {
			t.Fatal(err)
		}
		var unlinkedMessageID string
		if err := insertLegacyMessage(`
			insert into public.whatsapp_messages (
			  organization_id, conversation_id, session_id, lead_id,
			  message_id, content, message_type, status
			) values ($1::uuid, $2::uuid, $3::uuid, null, $4, 'unlinked evidence', 'text', 'received')
			returning id::text
		`, []any{organizationID, conversationID, sessionID, fixtureSuffix + "-unlinked-snapshot"}, &unlinkedMessageID); err != nil {
			t.Fatal(err)
		}

		conversation, err := repo.GetConversationForExpectedLead(ctx, otherBroker, conversationID, unlinkedConversationLeadSnapshot)
		if err != nil || conversation.ID != conversationID || conversation.LeadID != nil {
			t.Fatalf("unlinked Show = %#v, %v", conversation, err)
		}
		page, err := repo.ListMessages(ctx, otherBroker, conversationID, MessageFilter{
			Limit:          50,
			ExpectedLeadID: unlinkedConversationLeadSnapshot,
		})
		if err != nil || len(page.Messages) != 1 || page.Messages[0].ID != unlinkedMessageID {
			t.Fatalf("unlinked ListMessages = %#v, %v", page, err)
		}
		if err := repo.MarkConversationAsRead(ctx, otherBroker, conversationID, unlinkedConversationLeadSnapshot); err != nil {
			t.Fatalf("unlinked MarkConversationAsRead: %v", err)
		}
		if err := repo.ArchiveConversation(ctx, otherBroker, conversationID, true, unlinkedConversationLeadSnapshot); err != nil {
			t.Fatalf("unlinked ArchiveConversation: %v", err)
		}
		if err := repo.ArchiveConversation(ctx, otherBroker, conversationID, false, unlinkedConversationLeadSnapshot); err != nil {
			t.Fatalf("unlinked restore: %v", err)
		}

		if err := repo.LinkConversationToLead(ctx, otherBroker, conversationID, targetLeadID, unlinkedConversationLeadSnapshot); !errors.Is(err, ErrInvalidReference) {
			t.Fatalf("legacy unlinked message without retention receipt was promoted: %v", err)
		}
		// Exercise a physical binding change without turning this legacy NULL
		// message into newly retained evidence. Genuine promotion is covered by
		// the prospective-retention fixtures.
		if _, err := postgres.Pool().Exec(ctx, `select public.activate_whatsapp_conversation_lead_binding($1::uuid, $2::uuid, $3::uuid, null)`,
			organizationID, conversationID, targetLeadID); err != nil {
			t.Fatalf("fixture binding change: %v", err)
		}
		insertMessage(conversationID, targetLeadID, "text")

		if _, err := repo.GetConversationForExpectedLead(ctx, otherBroker, conversationID, unlinkedConversationLeadSnapshot); !errors.Is(err, ErrConversationNotFound) {
			t.Fatalf("stale unlinked Show error = %v", err)
		}
		if _, err := repo.ListMessages(ctx, otherBroker, conversationID, MessageFilter{Limit: 50, ExpectedLeadID: unlinkedConversationLeadSnapshot}); !errors.Is(err, ErrConversationNotFound) {
			t.Fatalf("stale unlinked ListMessages error = %v", err)
		}
		if err := repo.MarkConversationAsRead(ctx, otherBroker, conversationID, unlinkedConversationLeadSnapshot); !errors.Is(err, ErrConversationNotFound) {
			t.Fatalf("stale unlinked MarkConversationAsRead error = %v", err)
		}
		if err := repo.ArchiveConversation(ctx, otherBroker, conversationID, true, unlinkedConversationLeadSnapshot); !errors.Is(err, ErrConversationNotFound) {
			t.Fatalf("stale unlinked ArchiveConversation error = %v", err)
		}
		if err := repo.DeleteConversation(ctx, otherBroker, conversationID, unlinkedConversationLeadSnapshot); !errors.Is(err, ErrConversationNotFound) {
			t.Fatalf("stale unlinked DeleteConversation error = %v", err)
		}
	})

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
	if err := insertLegacyMessage(`
		insert into public.whatsapp_messages (
		  organization_id, conversation_id, session_id, lead_id,
		  message_id, content, message_type, status
		) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, 'old evidence', 'text', 'received')
		returning id::text
	`, []any{organizationID, quarantineID, sessionID, otherLeadID, fixtureSuffix + "-explicit-old"}, &explicitOldMessageID); err != nil {
		t.Fatal(err)
	}
	if err := insertLegacyMessage(`
		insert into public.whatsapp_messages (
		  organization_id, conversation_id, session_id, lead_id,
		  message_id, content, message_type, status
		) values ($1::uuid, $2::uuid, $3::uuid, null, $4, 'legacy null evidence', 'text', 'received')
		returning id::text
	`, []any{organizationID, quarantineID, sessionID, fixtureSuffix + "-legacy-null"}, &legacyNullMessageID); err != nil {
		t.Fatal(err)
	}
	if err := repo.LinkConversationToLead(ctx, admin, quarantineID, claimLeadID, unlinkedConversationLeadSnapshot); !errors.Is(err, ErrConversationNotFound) {
		t.Fatalf("administrator attaching another owner's unlinked history = %v, want denied", err)
	}
	if err := repo.LinkConversationToLead(ctx, otherBroker, quarantineID, claimLeadID, unlinkedConversationLeadSnapshot); !errors.Is(err, ErrInvalidReference) {
		t.Fatalf("owner attaching legacy null history without a prospective retention receipt = %v, want denied", err)
	}
	var explicitLeadAfter string
	var legacyLeadAfter *string
	if err := postgres.Pool().QueryRow(ctx, `
		select
		  max(lead_id::text) filter (where id = $1::uuid),
		  max(lead_id::text) filter (where id = $2::uuid)
		from public.whatsapp_messages
	`, explicitOldMessageID, legacyNullMessageID).Scan(&explicitLeadAfter, &legacyLeadAfter); err != nil {
		t.Fatal(err)
	}
	if explicitLeadAfter != otherLeadID || legacyLeadAfter != nil {
		t.Fatalf("legacy link rewrote immutable evidence: explicit=%s legacy=%v", explicitLeadAfter, legacyLeadAfter)
	}
	if _, err := repo.GetHistoryAccess(ctx, admin, HistoryAccessFilter{LeadID: otherLeadID}); err != nil {
		t.Fatalf("admin should preserve organization-wide lead access: %v", err)
	}
}
