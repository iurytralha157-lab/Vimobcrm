package whatsapp

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func waitDeepConversationLock(t *testing.T, ctx context.Context, pool *pgxpool.Pool, exceptPID int, counts ...int) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		var waiting int
		if err := pool.QueryRow(ctx, `select count(*) from pg_stat_activity where datname=current_database() and pid<>$1 and wait_event_type='Lock' and query like '%whatsapp_conversations%'`, exceptPID).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		want := 1
		if len(counts) > 0 {
			want = counts[0]
		}
		if waiting >= want {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("actual inbox statement did not wait on the conversation lock")
}

func TestLocalDeepTargetCapabilitiesDoNotRequireLeadMetadataWrite(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	repo := NewRepository(db, nil, StorageConfig{})
	f := createLocalSharedOutboundFixture(t, ctx, db.Pool(), "deep-cap-no-lead-edit")
	if _, err := db.Pool().Exec(ctx, `insert into public.user_permission_overrides(organization_id,user_id,permission_key,allowed) values($1::uuid,$2::uuid,'lead_operate',false)`, f.organizationID, f.tenant.UserID); err != nil {
		t.Fatal(err)
	}
	current, err := currentWhatsAppActor(ctx, db.Pool(), f.tenant)
	if err != nil {
		t.Fatal(err)
	}
	if current.HasPermission(permissions.LeadOperate) || !current.HasPermission(permissions.WhatsAppOperate) {
		t.Fatal("fixture must deny metadata writes while allowing WhatsApp operation")
	}
	f.tenant = current
	id := insertHardeningTarget(t, ctx, db.Pool(), f, "-received", "received", false)
	page, err := repo.ListMessages(ctx, f.tenant, f.conversationID, MessageFilter{Limit: 20, OrderingVersion: 2, ExpectedLeadID: f.leadID})
	if err != nil || len(page.Messages) != 1 || !page.Messages[0].CanQuote || !page.Messages[0].CanReact {
		t.Fatalf("metadata edit permission incorrectly gates reply/react: %+v %v", page, err)
	}
	if _, err := repo.JoinConversationAttendance(ctx, f.tenant, f.conversationID, attendanceInput{ExpectedLeadID: f.leadID, SendSessionID: f.sessionID}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SendMessage(ctx, f.tenant, f.conversationID, sendMessageInput{Text: "Synthetic quote without metadata edit", ExpectedLeadID: f.leadID, QuotedMessageID: id, ClientMessageID: f.suffix + "-quote"}); err != nil {
		t.Fatalf("quote write denied with whatsapp_operate: %v", err)
	}
	if _, err := repo.ReactToMessage(ctx, f.tenant, f.conversationID, id, reactToMessageInput{Emoji: "👍", ExpectedLeadID: f.leadID, ClientReactionID: f.suffix + "-reaction"}); err != nil {
		t.Fatalf("reaction write denied with whatsapp_operate: %v", err)
	}
}

func TestLocalDeepInboxMutationsRejectLateTransferAndPermissionChange(t *testing.T) {
	for _, operation := range []string{"read", "archive"} {
		for _, change := range []string{"transfer", "permission"} {
			t.Run(operation+"_"+change, func(t *testing.T) {
				ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
				defer cancel()
				db := openLocalOutboundDatabase(t, ctx)
				repo := NewRepository(db, nil, StorageConfig{})
				f := createLocalSharedOutboundFixture(t, ctx, db.Pool(), "deep-inbox-"+operation+change)
				if _, err := db.Pool().Exec(ctx, `update public.whatsapp_conversations set unread_count=7 where id=$1::uuid`, f.conversationID); err != nil {
					t.Fatal(err)
				}
				blocker, err := db.Pool().Begin(ctx)
				if err != nil {
					t.Fatal(err)
				}
				defer blocker.Rollback(context.Background())
				var pid int
				if err := blocker.QueryRow(ctx, `select pg_backend_pid() from public.whatsapp_conversations where id=$1::uuid for update`, f.conversationID).Scan(&pid); err != nil {
					t.Fatal(err)
				}
				done := make(chan error, 1)
				go func() {
					if operation == "read" {
						done <- repo.MarkConversationAsRead(ctx, f.tenant, f.conversationID, f.leadID)
					} else {
						done <- repo.ArchiveConversation(ctx, f.tenant, f.conversationID, true, f.leadID)
					}
				}()
				waitDeepConversationLock(t, ctx, db.Pool(), pid)
				if change == "transfer" {
					_, err = db.Pool().Exec(ctx, `update public.leads set assigned_user_id=$2::uuid where id=$1::uuid`, f.leadID, f.userID)
				} else {
					_, err = db.Pool().Exec(ctx, `insert into public.user_permission_overrides(organization_id,user_id,permission_key,allowed) values($1::uuid,$2::uuid,'whatsapp_operate',false),($1::uuid,$2::uuid,'whatsapp_manage',false)`, f.organizationID, f.tenant.UserID)
				}
				if err != nil {
					t.Fatal(err)
				}
				if err := blocker.Commit(ctx); err != nil {
					t.Fatal(err)
				}
				select {
				case err := <-done:
					if !errors.Is(err, ErrConversationNotFound) && !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
						t.Fatalf("late change did not deny %s: %v", operation, err)
					}
				case <-ctx.Done():
					t.Fatal("inbox mutation did not finish")
				}
				var unread int
				var archived bool
				if err := db.Pool().QueryRow(ctx, `select unread_count,archived_at is not null from public.whatsapp_conversations where id=$1::uuid`, f.conversationID).Scan(&unread, &archived); err != nil || unread != 7 || archived {
					t.Fatalf("denial changed inbox: unread%d archived%t %v", unread, archived, err)
				}
			})
		}
	}
}

func TestLocalDeepInboxOperationalScopeAndReadOnlyGrant(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	repo := NewRepository(db, nil, StorageConfig{})
	f := createLocalSharedOutboundFixture(t, ctx, db.Pool(), "deep-inbox-scope")
	admin := tenant.Context{OrganizationID: f.organizationID, UserID: f.userID, MemberRole: "admin", UserRole: "admin", Permissions: []string{"*"}}
	if _, err := db.Pool().Exec(ctx, `update public.whatsapp_session_access set can_send=false where organization_id=$1::uuid and user_id=$2::uuid; update public.whatsapp_conversations set unread_count=7 where id=$3::uuid`, f.organizationID, f.tenant.UserID, f.conversationID); err != nil {
		t.Fatal(err)
	}
	if err := repo.MarkConversationAsRead(ctx, f.tenant, f.conversationID, f.leadID); err != nil {
		t.Fatalf("effective assigned READ grant cannot organize inbox: %v", err)
	}
	if err := repo.ArchiveConversation(ctx, f.tenant, f.conversationID, true, f.leadID); err != nil {
		t.Fatal(err)
	}
	if err := repo.ArchiveConversation(ctx, f.tenant, f.conversationID, false, f.leadID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool().Exec(ctx, `update public.whatsapp_sessions set owner_user_id=$2::uuid where id=$1::uuid; delete from public.whatsapp_session_access where session_id=$1::uuid`, f.sessionID, f.tenant.UserID); err != nil {
		t.Fatal(err)
	}
	if err := repo.ArchiveConversation(ctx, admin, f.conversationID, true, f.leadID); !errors.Is(err, ErrConversationNotFound) {
		t.Fatalf("broad history admin organized somebody else's inbox: %v", err)
	}
	if err := repo.ensureCanViewConversationForLead(ctx, admin, f.conversationID, f.leadID); err != nil {
		t.Fatalf("broad historical read unexpectedly lost: %v", err)
	}
	var unknown string
	if err := db.Pool().QueryRow(ctx, `insert into public.whatsapp_conversations(organization_id,session_id,remote_jid,contact_phone,unread_count) values($1::uuid,$2::uuid,'5511777766666@s.whatsapp.net','5511777766666',3) returning id::text`, f.organizationID, f.sessionID).Scan(&unknown); err != nil {
		t.Fatal(err)
	}
	if err := repo.MarkConversationAsRead(ctx, f.tenant, unknown, unlinkedConversationLeadSnapshot); err != nil {
		t.Fatalf("owner cannot organize its retained unknown inbox: %v", err)
	}
	if err := repo.MarkConversationAsRead(ctx, admin, unknown, unlinkedConversationLeadSnapshot); !errors.Is(err, ErrConversationNotFound) {
		t.Fatalf("nonowner unknown inbox mutation: %v", err)
	}
}

func TestLocalDeepSecondaryOrganizationHistoryDoesNotGrantInboxMutation(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	repo := NewRepository(db, nil, StorageConfig{})
	f := createLocalSharedOutboundFixture(t, ctx, db.Pool(), "deep-inbox-secondary")
	other := createSessionConversationLockFixture(t, ctx, db.Pool(), "deep-original-org")
	t.Cleanup(func() { cleanupSessionConversationLockFixture(t, db.Pool(), other) })
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, err := db.Pool().Exec(cleanupCtx, `update public.users set organization_id=$2::uuid where id=$1::uuid`, f.tenant.UserID, f.organizationID); err != nil {
			t.Error(err)
		}
	})
	if _, err := db.Pool().Exec(ctx, `update public.users set organization_id=$2::uuid where id=$1::uuid;update public.organization_members set role='manager' where organization_id=$3::uuid and user_id=$1::uuid`, f.tenant.UserID, other.organizationID, f.organizationID); err != nil {
		t.Fatal(err)
	}
	reader := f.tenant
	reader.MemberRole = "manager"
	reader.Permissions = []string{"lead_view_all", "whatsapp_view", "whatsapp_operate"}
	if err := repo.ensureCanViewConversationForLead(ctx, reader, f.conversationID, f.leadID); err != nil {
		t.Fatal(err)
	}
	for _, run := range []func() error{func() error { return repo.MarkConversationAsRead(ctx, reader, f.conversationID, f.leadID) }, func() error { return repo.ArchiveConversation(ctx, reader, f.conversationID, true, f.leadID) }} {
		if err := run(); !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
			t.Fatalf("secondary membership organized inbox: %v", err)
		}
	}
}
