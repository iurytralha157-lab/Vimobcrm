package whatsapp

import (
	"context"
	"errors"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// This fixture never invokes a provider or accepts a remote/tunneled database.
func TestOwnerQueuedSendAndDeletionFollowCurrentLeadAccess(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("WHATSAPP_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("WHATSAPP_TEST_DATABASE_URL is not set")
	}
	target, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	if host := strings.ToLower(target.Hostname()); host != "localhost" && host != "127.0.0.1" && host != "::1" {
		t.Fatal("owner access fixture requires a loopback database")
	}
	if name := strings.TrimPrefix(target.Path, "/"); name != "vimob_whatsapp_test" && name != "vimob_whatsapp_clone" {
		t.Fatal("owner access fixture requires disposable vimob_whatsapp_test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer postgres.Close()
	pool := postgres.Pool()
	fixture := createSessionConversationLockFixture(t, ctx, pool, "owner-access")
	foreign := createSessionConversationLockFixture(t, ctx, pool, "owner-access-foreign")
	defer cleanupSessionConversationLockFixture(t, pool, foreign)
	var recipientID string
	if err := pool.QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&recipientID); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		if _, err := pool.Exec(cleanupCtx, `
			update public.users set organization_id = null where organization_id = $1::uuid;
			delete from public.organizations where id = $1::uuid;
			delete from public.users where id = any($2::uuid[]);
			delete from auth.users where id = any($2::uuid[])
		`, fixture.organizationID, []string{fixture.userID, recipientID}); err != nil {
			t.Errorf("cleanup owner access fixture: %v", err)
		}
	}()
	if _, err := pool.Exec(ctx, `
		insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
			raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
		values ($1::uuid, 'authenticated', 'authenticated', $2, '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());
		insert into public.users (id, organization_id, name, email, role, is_active)
		values ($1::uuid, $3::uuid, 'New lead assignee', $2, 'user', true)
		on conflict (id) do update set organization_id = excluded.organization_id,
			name = excluded.name, email = excluded.email, role = excluded.role, is_active = true;
		insert into public.organization_members (organization_id, user_id, role, is_active)
		values ($3::uuid, $1::uuid, 'user', true)
		on conflict (user_id, organization_id) do update set role = 'user', is_active = true, deleted_at = null;
		update public.organization_members set role = 'user'
		where organization_id = $3::uuid and user_id = $4::uuid
	`, recipientID, fixture.suffix+"-recipient@example.invalid", fixture.organizationID, fixture.userID); err != nil {
		t.Fatal(err)
	}
	owner := tenant.Context{OrganizationID: fixture.organizationID, UserID: fixture.userID,
		MemberRole: "user", UserRole: "user",
		Permissions: []string{"lead_view_own", "whatsapp_view", "whatsapp_operate", "whatsapp_manage"}}
	recipient := owner
	recipient.UserID = recipientID
	repo := NewRepository(postgres, nil, StorageConfig{})
	attendance := attendanceInput{SendSessionID: fixture.sessionID, ExpectedLeadID: fixture.leadID}
	if _, err := repo.JoinConversationAttendance(ctx, owner, fixture.conversationID, attendance); err != nil {
		t.Fatalf("ordinary owner joining own lead: %v", err)
	}
	send, err := repo.SendMessage(ctx, owner, fixture.conversationID, sendMessageInput{
		Text: "queued before lead transfer", SendSessionID: fixture.sessionID,
		ExpectedLeadID: fixture.leadID, ClientMessageID: fixture.suffix + "-owner-pending",
	})
	if err != nil || send.Message == nil {
		t.Fatalf("owner enqueue: %+v, %v", send, err)
	}
	item := pendingWhatsAppOutbox{OrganizationID: fixture.organizationID, SessionID: fixture.sessionID,
		ConversationID: fixture.conversationID, MessageRowID: send.Message.ID, LeaseToken: fixture.suffix + "-owner-lease"}
	if err := pool.QueryRow(ctx, `update public.whatsapp_outbox
		set status = 'processing', locked_by = $2, locked_at = now()
		where message_id = $1::uuid returning id::text`, item.MessageRowID, item.LeaseToken).Scan(&item.ID); err != nil {
		t.Fatal(err)
	}
	if allowed, err := repo.whatsappOutboxAttendanceCurrent(ctx, item); err != nil || !allowed {
		t.Fatalf("owner current attendance = %t, %v", allowed, err)
	}
	foreignItem := item
	foreignItem.OrganizationID = foreign.organizationID
	if allowed, err := repo.whatsappOutboxAttendanceCurrent(ctx, foreignItem); err != nil || allowed {
		t.Fatalf("cross-tenant queued item = %t, %v", allowed, err)
	}
	if err := repo.DeleteConversation(ctx, owner, foreign.conversationID, foreign.leadID); !errors.Is(err, ErrConversationNotFound) {
		t.Fatalf("cross-tenant deletion = %v, want hidden", err)
	}

	// A transfer that is already in progress must finish before the queued
	// owner's start marker can be written. No provider call is made here.
	transferTx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer transferTx.Rollback(ctx)
	if _, err := transferTx.Exec(ctx, `update public.leads set assigned_user_id = $3::uuid
		where organization_id = $1::uuid and id = $2::uuid`, fixture.organizationID, fixture.leadID, recipientID); err != nil {
		t.Fatal(err)
	}
	type result struct {
		attempts int
		err      error
	}
	started := make(chan result, 1)
	go func() {
		attempts, err := repo.startWhatsAppOutboxProviderAttempt(ctx, item)
		started <- result{attempts, err}
	}()
	for deadline := time.Now().Add(5 * time.Second); ; {
		var waiting bool
		if err := pool.QueryRow(ctx, `select exists (
			select 1 from pg_catalog.pg_stat_activity where pid <> pg_backend_pid()
			and wait_event_type = 'Lock' and query like '%from public.leads%for share%'
		)`).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting {
			break
		}
		select {
		case got := <-started:
			t.Fatalf("owner start escaped pending transfer: %+v", got)
		default:
		}
		if time.Now().After(deadline) {
			t.Fatal("owner provider-start fence did not wait for transfer")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err := transferTx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case got := <-started:
		if got.attempts != 0 || !errors.Is(got.err, ErrSessionAccessRevoked) {
			t.Fatalf("transferred owner's provider start: %+v", got)
		}
	case <-ctx.Done():
		t.Fatal("owner provider start stayed blocked after transfer")
	}
	if allowed, err := repo.whatsappOutboxAttendanceCurrent(ctx, item); err != nil || allowed {
		t.Fatalf("transferred owner attendance = %t, %v", allowed, err)
	}
	if err := repo.DeleteConversation(ctx, owner, fixture.conversationID, fixture.leadID); !errors.Is(err, ErrConversationNotFound) {
		t.Fatalf("owner deleting lead outside current scope = %v", err)
	}
	if _, err := repo.GetHistoryAccess(ctx, owner, HistoryAccessFilter{LeadID: fixture.leadID}); !errors.Is(err, ErrInvalidReference) {
		t.Fatalf("old owner retained transferred lead history: %v", err)
	}
	if history, err := repo.GetHistoryAccess(ctx, recipient, HistoryAccessFilter{LeadID: fixture.leadID}); err != nil || len(history.Messages) != 1 || history.Messages[0].ID != item.MessageRowID {
		t.Fatalf("new assignee did not inherit full lead history: %+v, %v", history, err)
	}
	if snapshot, err := repo.GetConversationSnapshot(ctx, recipient, fixture.conversationID); err != nil || snapshot.ID != fixture.conversationID {
		t.Fatalf("new assignee lost canonical conversation snapshot: %+v, %v", snapshot, err)
	}
	if inbox, err := repo.ListConversations(ctx, recipient, ConversationListFilter{Limit: 10}); err != nil || len(inbox) != 0 {
		t.Fatalf("lead transfer implicitly added old owner's number to inbox: %+v, %v", inbox, err)
	}
	if unread, err := repo.CountUnreadMessages(ctx, recipient, ConversationListFilter{}); err != nil || unread != 0 {
		t.Fatalf("unshared number contributed operational unread messages: %d, %v", unread, err)
	}
	if _, err := repo.JoinConversationAttendance(ctx, recipient, fixture.conversationID, attendance); err == nil {
		t.Fatal("lead transfer implicitly shared the old owner's number")
	}
	var unlinkedID string
	if err := pool.QueryRow(ctx, `insert into public.whatsapp_conversations
		(organization_id, session_id, remote_jid, contact_name)
		values ($1::uuid, $2::uuid, '5511988777777@s.whatsapp.net', 'Unlinked private contact')
		returning id::text`, fixture.organizationID, fixture.sessionID).Scan(&unlinkedID); err != nil {
		t.Fatal(err)
	}
	if err := repo.DeleteConversation(ctx, recipient, unlinkedID, unlinkedConversationLeadSnapshot); !errors.Is(err, ErrConversationNotFound) {
		t.Fatalf("recipient deleting unlinked private owner conversation = %v", err)
	}
	if err := repo.DeleteConversation(ctx, owner, unlinkedID, unlinkedConversationLeadSnapshot); err != nil {
		t.Fatalf("owner deleting own unlinked conversation = %v", err)
	}
	// An actual administrator still has the CRM's broader current permission.
	// This permits the queued owner's intent without resetting its attendance.
	if _, err := pool.Exec(ctx, `update public.organization_members set role = 'admin'
		where organization_id = $1::uuid and user_id = $2::uuid`, fixture.organizationID, fixture.userID); err != nil {
		t.Fatal(err)
	}
	if attempts, err := repo.startWhatsAppOutboxProviderAttempt(ctx, item); err != nil || attempts != 1 {
		t.Fatalf("current administrator's provider-start authorization = %d, %v", attempts, err)
	}
	// Stale tenant permissions must not permit deletion after demotion.
	if _, err := pool.Exec(ctx, `update public.organization_members set role = 'user'
		where organization_id = $1::uuid and user_id = $2::uuid`, fixture.organizationID, fixture.userID); err != nil {
		t.Fatal(err)
	}
	if err := repo.DeleteConversation(ctx, fixture.tenant, fixture.conversationID, fixture.leadID); !errors.Is(err, ErrConversationNotFound) {
		t.Fatalf("stale administrator context deleting transferred lead = %v", err)
	}
}
