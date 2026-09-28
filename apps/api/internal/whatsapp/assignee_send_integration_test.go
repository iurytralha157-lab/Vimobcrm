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

// This exercises confirmation, durable enqueue and the final provider fence
// against a disposable loopback database. It never invokes the provider.
func TestAssignedLeadCanSendThroughExactExistingConversation(t *testing.T) {
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
	fixture := createSessionConversationLockFixture(t, ctx, pool, "assignee-send")
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
				t.Errorf("clean delegated send fixture: %v", cleanupErr)
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
	viewerID := createActor("visible-admin", "admin")
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
	viewer := tenant.Context{OrganizationID: fixture.organizationID, UserID: viewerID, MemberRole: "admin"}
	request := attendanceInput{ExpectedLeadID: fixture.leadID, SendSessionID: fixture.sessionID}

	before, err := repo.GetConversationAttendance(ctx, assignee, fixture.conversationID, request)
	if err != nil || !before.CanSend || before.Joined {
		t.Fatalf("assignee attendance before confirmation = canSend:%v joined:%v err:%v", before.CanSend, before.Joined, err)
	}
	if _, err := repo.SendMessage(ctx, assignee, fixture.conversationID, sendMessageInput{
		Text: "before confirmation", ExpectedLeadID: fixture.leadID, SendSessionID: fixture.sessionID,
	}); !errors.Is(err, ErrAttendanceRequired) {
		t.Fatalf("send before confirmation = %v, want ErrAttendanceRequired", err)
	}

	visible, err := repo.GetConversationAttendance(ctx, viewer, fixture.conversationID, request)
	if err != nil || visible.CanSend {
		t.Fatalf("non-assignee capability = canSend:%v err:%v, want false", visible.CanSend, err)
	}
	if _, err := repo.JoinConversationAttendance(ctx, viewer, fixture.conversationID, request); !errors.Is(err, ErrSessionNotFound) {
		t.Fatalf("non-assignee join = %v, want ErrSessionNotFound", err)
	}

	joined, err := repo.JoinConversationAttendance(ctx, assignee, fixture.conversationID, request)
	if err != nil || !joined.Created || !joined.Joined || !joined.CanSend || joined.CurrentEntry == nil {
		t.Fatalf("first assignee join = created:%v joined:%v canSend:%v err:%v", joined.Created, joined.Joined, joined.CanSend, err)
	}
	joinedAgain, err := repo.JoinConversationAttendance(ctx, assignee, fixture.conversationID, request)
	if err != nil || joinedAgain.Created || !joinedAgain.Joined {
		t.Fatalf("repeat join = created:%v joined:%v err:%v", joinedAgain.Created, joinedAgain.Joined, err)
	}

	clientID := fixture.suffix + "-delegated-send"
	if _, err := repo.SendMessage(ctx, assignee, fixture.conversationID, sendMessageInput{
		Text: "delegated outbound", ClientMessageID: clientID,
		ExpectedLeadID: fixture.leadID, SendSessionID: fixture.sessionID,
	}); err != nil {
		t.Fatalf("confirmed assignee send: %v", err)
	}
	var outboxID, messageID string
	if err := pool.QueryRow(ctx, `
		select outbox.id::text, outbox.message_id::text
		from public.whatsapp_outbox outbox
		where outbox.organization_id = $1::uuid and outbox.client_message_id = $2
	`, fixture.organizationID, clientID).Scan(&outboxID, &messageID); err != nil {
		t.Fatalf("delegated send did not create durable outbox: %v", err)
	}
	item := pendingWhatsAppOutbox{
		ID: outboxID, OrganizationID: fixture.organizationID, SessionID: fixture.sessionID,
		ConversationID: fixture.conversationID, MessageRowID: messageID,
	}
	if allowed, err := repo.whatsappOutboxAttendanceCurrent(ctx, item); err != nil || !allowed {
		t.Fatalf("confirmed delegated outbox gate = allowed:%v err:%v", allowed, err)
	}

	if _, err := pool.Exec(ctx, `update public.leads set assigned_user_id = $2::uuid where id = $1::uuid`, fixture.leadID, viewerID); err != nil {
		t.Fatal(err)
	}
	if allowed, err := repo.whatsappOutboxAttendanceCurrent(ctx, item); err != nil || allowed {
		t.Fatalf("transferred assignee outbox gate = allowed:%v err:%v, want false", allowed, err)
	}
	if _, err := repo.SendMessage(ctx, assignee, fixture.conversationID, sendMessageInput{
		Text: "after transfer", ExpectedLeadID: fixture.leadID, SendSessionID: fixture.sessionID,
	}); err == nil {
		t.Fatal("former assignee sent after assignment transfer")
	}
}
