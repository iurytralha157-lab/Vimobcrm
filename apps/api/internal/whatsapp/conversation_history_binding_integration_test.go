package whatsapp

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// This opt-in test requires a disposable local database with the Part 2
// migrations. It exercises the API repository and SQL confirmation together.
func TestWhatsAppUnlinkedHistoryPreviewAndManualBinding(t *testing.T) {
	databaseURL := os.Getenv("WHATSAPP_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("WHATSAPP_TEST_DATABASE_URL is not set")
	}
	parsedURL, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatal("WhatsApp history integration test requires a loopback disposable database")
	}
	hostIP := net.ParseIP(parsedURL.Hostname())
	if parsedURL.Hostname() != "localhost" && (hostIP == nil || !hostIP.IsLoopback()) {
		t.Fatal("WhatsApp history integration test requires a loopback disposable database")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer postgres.Close()

	suffix := fmt.Sprintf("wa-history-%d", time.Now().UnixNano())
	phone := fmt.Sprintf("55119%08d", time.Now().UnixNano()%100_000_000)
	var organizationID, userID, brokerID, leadID, sessionID, conversationID, messageID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.organizations (name, slug)
		values ($1, $1) returning id::text
	`, suffix).Scan(&organizationID); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		for _, statement := range []string{
			`delete from private.whatsapp_unlinked_history_links where organization_id = $1::uuid`,
			`delete from public.whatsapp_messages where organization_id = $1::uuid`,
			`delete from public.whatsapp_conversations where organization_id = $1::uuid`,
			`delete from public.whatsapp_conversation_lead_bindings where organization_id = $1::uuid`,
			`delete from public.whatsapp_sessions where organization_id = $1::uuid`,
			`delete from public.leads where organization_id = $1::uuid`,
			`delete from public.organization_members where organization_id = $1::uuid`,
		} {
			if _, cleanupErr := postgres.Pool().Exec(cleanupCtx, statement, organizationID); cleanupErr != nil {
				t.Logf("synthetic fixture cleanup: %v", cleanupErr)
			}
		}
		for _, actorID := range []string{userID, brokerID} {
			if actorID == "" {
				continue
			}
			for _, statement := range []string{
				`delete from public.users where id = $1::uuid`,
				`delete from auth.users where id = $1::uuid`,
			} {
				if _, cleanupErr := postgres.Pool().Exec(cleanupCtx, statement, actorID); cleanupErr != nil {
					t.Logf("synthetic fixture cleanup: %v", cleanupErr)
				}
			}
		}
		if _, cleanupErr := postgres.Pool().Exec(cleanupCtx, `delete from public.organizations where id = $1::uuid`, organizationID); cleanupErr != nil {
			t.Logf("synthetic fixture cleanup: %v", cleanupErr)
		}
	}()
	if err := postgres.Pool().QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into auth.users (
		  id, aud, role, email, encrypted_password, email_confirmed_at,
		  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
		) values ($1::uuid, 'authenticated', 'authenticated', $2, '', now(),
		  '{}'::jsonb, '{}'::jsonb, now(), now())
	`, userID, suffix+"@example.invalid"); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.users (id, organization_id, name, email, role, is_active)
		values ($1::uuid, $2::uuid, $3, $4, 'admin', true)
		on conflict (id) do update
		set organization_id = excluded.organization_id,
		    name = excluded.name, email = excluded.email,
		    role = excluded.role, is_active = excluded.is_active
	`, userID, organizationID, suffix, suffix+"@example.invalid"); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.organization_members (organization_id, user_id, role, is_active)
		values ($1::uuid, $2::uuid, 'admin', true)
		on conflict (user_id, organization_id) do update
		set role = excluded.role, is_active = excluded.is_active
	`, organizationID, userID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.leads (organization_id, assigned_user_id, name, phone, source)
		values ($1::uuid, $2::uuid, $3, $4, 'manual')
		returning id::text
	`, organizationID, userID, suffix+"-lead", phone).Scan(&leadID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_sessions (
		  organization_id, instance_name, owner_user_id, provider, status, is_active
		) values ($1::uuid, $2, $3::uuid, 'evolution_go', 'connected', true)
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
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_messages (
		  organization_id, conversation_id, session_id, message_id,
		  content, message_type, status, capture_state
		) values ($1::uuid, $2::uuid, $3::uuid, $4,
		  'synthetic history', 'text', 'received', 'unlinked_ephemeral')
		returning id::text
	`, organizationID, conversationID, sessionID, suffix+"-provider-message").Scan(&messageID); err != nil {
		t.Fatal(err)
	}

	repo := NewRepository(postgres, nil, StorageConfig{})
	actor := tenant.Context{
		OrganizationID: organizationID,
		UserID:         userID,
		UserRole:       "admin",
		MemberRole:     "admin",
	}
	preview, err := repo.GetConversationLeadLinkPreview(ctx, actor, conversationID, leadID, unlinkedConversationLeadSnapshot)
	if err != nil || preview.EligibleMessageCount != 1 || preview.LeadID == nil ||
		*preview.LeadID != leadID || preview.BindingMode != "active" {
		t.Fatalf("preview = %#v / %v", preview, err)
	}
	otherActor := actor
	otherActor.UserID = "11111111-1111-4111-8111-111111111111"
	if _, err := repo.GetConversationLeadLinkPreview(ctx, otherActor, conversationID, leadID, unlinkedConversationLeadSnapshot); !errors.Is(err, ErrConversationNotFound) {
		t.Fatalf("foreign session preview = %v, want ErrConversationNotFound", err)
	}
	var result ConversationLeadLinkResult
	if err := repo.LinkConversationToLead(ctx, actor, conversationID, leadID, unlinkedConversationLeadSnapshot, &result); err != nil {
		t.Fatal(err)
	}
	if result.BindingMode != "active" || result.AttachedMessageCount != 1 {
		t.Fatalf("link result = %#v", result)
	}
	var attributedLeadID, captureState string
	if err := postgres.Pool().QueryRow(ctx, `
		select lead_id::text, capture_state
		from public.whatsapp_messages
		where id = $1::uuid
	`, messageID).Scan(&attributedLeadID, &captureState); err != nil {
		t.Fatal(err)
	}
	if attributedLeadID != leadID || captureState != "promoted_unlinked" {
		t.Fatalf("attribution = %s / %s", attributedLeadID, captureState)
	}
	linkedPreview, err := repo.GetConversationLeadLinkPreview(ctx, actor, conversationID, leadID, leadID)
	if err != nil || linkedPreview.ExpectedPreviousLeadID != leadID ||
		linkedPreview.EligibleMessageCount != 0 || linkedPreview.ExpiresAt != nil ||
		linkedPreview.BindingMode != "active" {
		t.Fatalf("linked reassignment preview = %#v / %v", linkedPreview, err)
	}
	// The negative actor must be a real active member of the original tenant;
	// otherwise the original-organization gate masks the lead-access assertion.
	if err := postgres.Pool().QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&brokerID); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
		values($1::uuid,'authenticated','authenticated',$2,'',now(),'{}','{}',now(),now());
		insert into public.users(id,organization_id,name,email,role,is_active)
		values($1::uuid,$3::uuid,'Synthetic restricted manager',$2,'user',true)
		on conflict(id) do update set organization_id=excluded.organization_id,role='user',is_active=true;
		insert into public.organization_members(organization_id,user_id,role,is_active)
		values($3::uuid,$1::uuid,'user',true)
		on conflict(user_id,organization_id) do update set role='user',is_active=true,deleted_at=null
	`, brokerID, suffix+"-restricted@example.invalid", organizationID); err != nil {
		t.Fatal(err)
	}
	whatsAppManagerWithoutLeadAccess := actor
	whatsAppManagerWithoutLeadAccess.UserID = brokerID
	whatsAppManagerWithoutLeadAccess.MemberRole = "user"
	whatsAppManagerWithoutLeadAccess.UserRole = "user"
	whatsAppManagerWithoutLeadAccess.Permissions = []string{permissions.WhatsAppManage, permissions.LeadOperate}
	if err := repo.LinkConversationToLead(
		ctx, whatsAppManagerWithoutLeadAccess, conversationID, leadID, leadID,
	); !errors.Is(err, ErrConversationNotFound) {
		t.Fatalf("WhatsApp manager without lead access linked conversation: %v", err)
	}
	if _, err := repo.GetConversationLeadLinkPreview(ctx, actor, conversationID, leadID, unlinkedConversationLeadSnapshot); !errors.Is(err, ErrConversationBindingChanged) {
		t.Fatalf("stale no-lead preview = %v, want ErrConversationBindingChanged", err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_sessions
		set status = 'disconnected', is_active = false
		where id = $1::uuid
	`, sessionID); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_conversations
		set unread_count = 1
		where id = $1::uuid
	`, conversationID); err != nil {
		t.Fatal(err)
	}
	conversations, err := repo.ListConversations(ctx, actor, ConversationListFilter{Limit: 10})
	if err != nil || len(conversations) != 1 || conversations[0].ID != conversationID {
		t.Fatalf("linked inbox after session disconnect = %#v / %v", conversations, err)
	}
	unread, err := repo.CountUnreadMessages(ctx, actor, ConversationListFilter{})
	if err != nil || unread != 1 {
		t.Fatalf("linked unread after session disconnect = %d / %v", unread, err)
	}
	if _, err := repo.GetConversationSnapshot(ctx, actor, conversationID); err != nil {
		t.Fatalf("linked conversation disappeared after session disconnect: %v", err)
	}
	page, err := repo.ListMessages(ctx, actor, conversationID, MessageFilter{
		Limit: 10, ExpectedLeadID: leadID,
	})
	if err != nil || len(page.Messages) != 1 || page.Messages[0].ID != messageID {
		t.Fatalf("linked history after session disconnect = %#v / %v", page, err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_sessions
		set status = 'deleted', is_active = false
		where id = $1::uuid
	`, sessionID); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.GetConversationSnapshot(ctx, actor, conversationID); err != nil {
		t.Fatalf("linked conversation disappeared after session soft delete: %v", err)
	}
	conversations, err = repo.ListConversations(ctx, actor, ConversationListFilter{Limit: 10})
	if err != nil || len(conversations) != 1 || conversations[0].ID != conversationID {
		t.Fatalf("linked inbox after session soft delete = %#v / %v", conversations, err)
	}
	page, err = repo.ListMessages(ctx, actor, conversationID, MessageFilter{
		Limit: 10, ExpectedLeadID: leadID,
	})
	if err != nil || len(page.Messages) != 1 || page.Messages[0].ID != messageID {
		t.Fatalf("linked history after session soft delete = %#v / %v", page, err)
	}
}
