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

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// Only the current session owner may join or send on its physical conversation.
// The opt-in fixture uses a disposable loopback database and never calls the provider.
func TestOnlySessionOwnerCanSendThroughLeadConversation(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("WHATSAPP_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("WHATSAPP_TEST_DATABASE_URL is not set")
	}
	target, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	if host := strings.ToLower(target.Hostname()); host != "localhost" && host != "127.0.0.1" && host != "::1" {
		t.Fatalf("WHATSAPP_TEST_DATABASE_URL must be loopback, got %q", host)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer postgres.Close()
	pool := postgres.Pool()
	fixture := createSessionConversationLockFixture(t, ctx, pool, "owner-only-send")
	var additionalUsers []string
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		if len(additionalUsers) > 0 {
			if _, cleanupErr := pool.Exec(cleanupCtx, `
				delete from public.whatsapp_outbox where organization_id = $1::uuid;
				delete from public.whatsapp_messages where organization_id = $1::uuid;
				delete from public.whatsapp_attendance_entries where organization_id = $1::uuid;
				delete from public.lead_timeline_events where organization_id = $1::uuid;
				update public.leads set assigned_user_id = $2::uuid where organization_id = $1::uuid;
				delete from public.organization_members where organization_id = $1::uuid and user_id = any($3::uuid[]);
				delete from public.users where id = any($3::uuid[]);
				delete from auth.users where id = any($3::uuid[])
			`, fixture.organizationID, fixture.userID, additionalUsers); cleanupErr != nil {
				t.Errorf("clean owner-only fixture: %v", cleanupErr)
			}
		}
		cleanupSessionConversationLockFixture(t, pool, fixture)
	}()

	createActor := func(label, role string) string {
		t.Helper()
		var userID string
		if err := pool.QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&userID); err != nil {
			t.Fatal(err)
		}
		email := fmt.Sprintf("%s-%s@example.invalid", fixture.suffix, label)
		if _, err := pool.Exec(ctx, `
			insert into auth.users (
			  id, aud, role, email, encrypted_password, email_confirmed_at,
			  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
			) values ($1::uuid, 'authenticated', 'authenticated', $2, '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());
			insert into public.users (id, organization_id, name, email, role, is_active)
			values ($1::uuid, $3::uuid, $4, $2, $5, true);
			insert into public.organization_members (organization_id, user_id, role, is_active)
			values ($3::uuid, $1::uuid, $5, true)
		`, userID, email, fixture.organizationID, label, role); err != nil {
			t.Fatal(err)
		}
		additionalUsers = append(additionalUsers, userID)
		return userID
	}
	assigneeID := createActor("assignee", "user")
	adminID := createActor("org-admin", "admin")
	if _, err := pool.Exec(ctx, `
		update public.leads set assigned_user_id = $2::uuid
		where id = $1::uuid and organization_id = $3::uuid
	`, fixture.leadID, assigneeID, fixture.organizationID); err != nil {
		t.Fatal(err)
	}

	repo := NewRepository(postgres, nil, StorageConfig{})
	assignee := tenant.Context{
		OrganizationID: fixture.organizationID,
		UserID:         assigneeID,
		MemberRole:     "user",
		Permissions:    []string{permissions.LeadViewOwn, permissions.WhatsAppOperate},
	}
	admin := tenant.Context{OrganizationID: fixture.organizationID, UserID: adminID, MemberRole: "admin"}
	request := attendanceInput{ExpectedLeadID: fixture.leadID, SendSessionID: fixture.sessionID}

	for _, actor := range []struct {
		name    string
		context tenant.Context
	}{
		{"assigned lead user", assignee},
		{"organization admin", admin},
	} {
		t.Run(actor.name, func(t *testing.T) {
			state, err := repo.GetConversationAttendance(ctx, actor.context, fixture.conversationID, request)
			if err != nil || state.CanSend || state.Joined {
				t.Fatalf("attendance = canSend:%v joined:%v err:%v, want read-only", state.CanSend, state.Joined, err)
			}
			if _, err := repo.JoinConversationAttendance(ctx, actor.context, fixture.conversationID, request); !errors.Is(err, ErrSessionNotFound) {
				t.Fatalf("join = %v, want ErrSessionNotFound", err)
			}
			clientID := fixture.suffix + "-blocked-" + actor.name
			if _, err := repo.SendMessage(ctx, actor.context, fixture.conversationID, sendMessageInput{
				Text: "must not leave the wrong line", ClientMessageID: clientID,
				ExpectedLeadID: fixture.leadID, SendSessionID: fixture.sessionID,
			}); !errors.Is(err, ErrSessionNotFound) {
				t.Fatalf("send = %v, want ErrSessionNotFound", err)
			}
			var messages, outbox int
			if err := pool.QueryRow(ctx, `
				select count(*)::integer from public.whatsapp_messages
				where organization_id = $1::uuid and client_message_id = $2
			`, fixture.organizationID, clientID).Scan(&messages); err != nil {
				t.Fatal(err)
			}
			if err := pool.QueryRow(ctx, `
				select count(*)::integer from public.whatsapp_outbox
				where organization_id = $1::uuid and client_message_id = $2
			`, fixture.organizationID, clientID).Scan(&outbox); err != nil {
				t.Fatal(err)
			}
			if messages != 0 || outbox != 0 {
				t.Fatalf("blocked send persisted message:%d outbox:%d", messages, outbox)
			}
		})
	}

	owner := fixture.tenant
	owner.Permissions = []string{permissions.WhatsAppOperate}
	before, err := repo.GetConversationAttendance(ctx, owner, fixture.conversationID, request)
	if err != nil || !before.CanSend || before.Joined {
		t.Fatalf("owner attendance before confirmation = canSend:%v joined:%v err:%v", before.CanSend, before.Joined, err)
	}
	if _, err := repo.SendMessage(ctx, owner, fixture.conversationID, sendMessageInput{
		Text: "before confirmation", ExpectedLeadID: fixture.leadID, SendSessionID: fixture.sessionID,
	}); !errors.Is(err, ErrAttendanceRequired) {
		t.Fatalf("owner send before confirmation = %v, want ErrAttendanceRequired", err)
	}
	joined, err := repo.JoinConversationAttendance(ctx, owner, fixture.conversationID, request)
	if err != nil || !joined.Created || !joined.Joined || !joined.CanSend || joined.CurrentEntry == nil {
		t.Fatalf("owner join = created:%v joined:%v canSend:%v err:%v", joined.Created, joined.Joined, joined.CanSend, err)
	}
	clientID := fixture.suffix + "-owner-send"
	if _, err := repo.SendMessage(ctx, owner, fixture.conversationID, sendMessageInput{
		Text: "owner outbound", ClientMessageID: clientID,
		ExpectedLeadID: fixture.leadID, SendSessionID: fixture.sessionID,
	}); err != nil {
		t.Fatalf("confirmed owner send: %v", err)
	}
	var outboxID, messageID string
	if err := pool.QueryRow(ctx, `
		select outbox.id::text, outbox.message_id::text
		from public.whatsapp_outbox outbox
		where outbox.organization_id = $1::uuid and outbox.client_message_id = $2
	`, fixture.organizationID, clientID).Scan(&outboxID, &messageID); err != nil {
		t.Fatalf("owner send did not create durable outbox: %v", err)
	}
	item := pendingWhatsAppOutbox{
		ID: outboxID, OrganizationID: fixture.organizationID, SessionID: fixture.sessionID,
		ConversationID: fixture.conversationID, MessageRowID: messageID,
	}
	if allowed, err := repo.whatsappOutboxAttendanceCurrent(ctx, item); err != nil || !allowed {
		t.Fatalf("owner outbox gate = allowed:%v err:%v", allowed, err)
	}
	// Simulate a row queued by the old delegated-send rule. The assignee had
	// joined this exact card, but did not own its WhatsApp session.
	var legacyEntryID string
	if err := pool.QueryRow(ctx, `
		insert into public.whatsapp_attendance_entries (
			organization_id, conversation_id, session_id, lead_id,
			binding_id, user_id, actor_name_snapshot, ingress_sequence_cutoff
		) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid,
		          $5::uuid, $6::uuid, 'assignee', 0)
		returning id::text
	`, fixture.organizationID, fixture.conversationID, fixture.sessionID,
		fixture.leadID, joined.CurrentEntry.BindingID, assigneeID).Scan(&legacyEntryID); err != nil {
		t.Fatal(err)
	}
	legacyClientID := fixture.suffix + "-legacy-assignee-send"
	legacyProviderID := deterministicProviderMessageID(legacyClientID)
	var legacyMessageID string
	if err := pool.QueryRow(ctx, `
		insert into public.whatsapp_messages (
			organization_id, conversation_id, session_id, lead_id,
			sender_user_id, message_id, client_message_id, from_me,
			direction, content, message_type, remote_jid, status,
			sent_at, metadata, capture_state
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid,
			$5::uuid, $6, $7, true, 'outbound', 'legacy delegated send',
			'text', $8, 'queued', now(),
			jsonb_build_object('delivery', 'outbox', 'attendance_entry_id', $9::uuid),
			'captured'
		)
		returning id::text
	`, fixture.organizationID, fixture.conversationID, fixture.sessionID,
		fixture.leadID, assigneeID, legacyProviderID, legacyClientID,
		fixture.remoteJID, legacyEntryID).Scan(&legacyMessageID); err != nil {
		t.Fatal(err)
	}
	legacyLease := fixture.suffix + "-legacy-lease"
	var legacyOutboxID string
	if err := pool.QueryRow(ctx, `
		insert into public.whatsapp_outbox (
			organization_id, session_id, conversation_id, message_id,
			client_message_id, recipient_jid, message_type, payload,
			provider_message_id, status, next_attempt_at, locked_at, locked_by
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid,
			$5, $6, 'text',
			jsonb_build_object('action', 'send.text', 'body',
			  jsonb_build_object('id', $7, 'number', $8, 'text', 'legacy delegated send')),
			$7, 'processing', now(), now(), $9
		)
		returning id::text
	`, fixture.organizationID, fixture.sessionID, fixture.conversationID,
		legacyMessageID, legacyClientID, fixture.remoteJID,
		legacyProviderID, fixture.phone, legacyLease).Scan(&legacyOutboxID); err != nil {
		t.Fatal(err)
	}
	legacyItem := pendingWhatsAppOutbox{
		ID: legacyOutboxID, OrganizationID: fixture.organizationID,
		SessionID: fixture.sessionID, ConversationID: fixture.conversationID,
		MessageRowID: legacyMessageID, LeaseToken: legacyLease,
	}
	if allowed, err := repo.whatsappOutboxAttendanceCurrent(ctx, legacyItem); err != nil || allowed {
		t.Fatalf("legacy cross-owner outbox gate = allowed:%v err:%v, want false", allowed, err)
	}
	if _, err := repo.startWhatsAppOutboxProviderAttempt(ctx, legacyItem); !errors.Is(err, ErrAttendanceRequired) {
		t.Fatalf("legacy cross-owner provider-start fence = %v, want ErrAttendanceRequired", err)
	}
	var legacyAttempts int
	if err := pool.QueryRow(ctx, `select attempts from public.whatsapp_outbox where id = $1::uuid`, legacyOutboxID).Scan(&legacyAttempts); err != nil {
		t.Fatal(err)
	}
	if legacyAttempts != 0 {
		t.Fatalf("legacy cross-owner row started %d provider attempts, want 0", legacyAttempts)
	}
	// A system-origin row with no human sender remains eligible only while
	// the session owner has an active attendance entry and membership.
	if _, err := pool.Exec(ctx, `
		update public.whatsapp_messages
		set sender_user_id = null,
		    metadata = jsonb_build_object('delivery', 'outbox', 'origin', 'automation')
		where id = $1::uuid
	`, legacyMessageID); err != nil {
		t.Fatal(err)
	}
	if allowed, err := repo.whatsappOutboxAttendanceCurrent(ctx, legacyItem); err != nil || !allowed {
		t.Fatalf("owner-attended system outbox gate = allowed:%v err:%v, want true", allowed, err)
	}
	if _, err := pool.Exec(ctx, `
		update public.organization_members set is_active = false
		where organization_id = $1::uuid and user_id = $2::uuid
	`, fixture.organizationID, fixture.userID); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.startWhatsAppOutboxProviderAttempt(ctx, legacyItem); !errors.Is(err, ErrAttendanceRequired) {
		t.Fatalf("inactive owner provider-start fence = %v, want ErrAttendanceRequired", err)
	}
	if _, err := pool.Exec(ctx, `
		update public.organization_members set is_active = true
		where organization_id = $1::uuid and user_id = $2::uuid
	`, fixture.organizationID, fixture.userID); err != nil {
		t.Fatal(err)
	}
	if attempts, err := repo.startWhatsAppOutboxProviderAttempt(ctx, legacyItem); err != nil || attempts != 1 {
		t.Fatalf("owner-attended system provider-start = attempts:%d err:%v, want 1", attempts, err)
	}
	// A queued message must be rejected if ownership changes after enqueue.
	if _, err := pool.Exec(ctx, `
		update public.whatsapp_sessions set owner_user_id = $2::uuid
		where organization_id = $1::uuid and id = $3::uuid
	`, fixture.organizationID, adminID, fixture.sessionID); err != nil {
		t.Fatal(err)
	}
	if allowed, err := repo.whatsappOutboxAttendanceCurrent(ctx, item); err != nil || allowed {
		t.Fatalf("transferred session outbox gate = allowed:%v err:%v, want false", allowed, err)
	}
	item.LeaseToken = fixture.suffix + "-provider-lease"
	if _, err := pool.Exec(ctx, `
		update public.whatsapp_outbox
		set status = 'processing', locked_by = $2, locked_at = now()
		where id = $1::uuid
	`, outboxID, item.LeaseToken); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.startWhatsAppOutboxProviderAttempt(ctx, item); !errors.Is(err, ErrAttendanceRequired) {
		t.Fatalf("provider-start fence after owner transfer = %v, want ErrAttendanceRequired", err)
	}
	var attempts int
	if err := pool.QueryRow(ctx, `select attempts from public.whatsapp_outbox where id = $1::uuid`, outboxID).Scan(&attempts); err != nil {
		t.Fatal(err)
	}
	if attempts != 0 {
		t.Fatalf("owner-transferred message started %d provider attempts, want 0", attempts)
	}
	if _, err := repo.SendMessage(ctx, owner, fixture.conversationID, sendMessageInput{
		Text: "after transfer", ExpectedLeadID: fixture.leadID, SendSessionID: fixture.sessionID,
	}); !errors.Is(err, ErrSessionNotFound) {
		t.Fatalf("former session owner send = %v, want ErrSessionNotFound", err)
	}
}
