package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	usersrepo "github.com/vimob-crm/vimob-crm/apps/api/internal/users"
)

// Exercise the public admission/grant paths against canonical Users deletion,
// not a synthetic equivalent of its lock order. A third transaction holds the
// lead until both operations reach real PostgreSQL row-lock waits.
func TestLocalFinalAdmissionAndGrantSerializeWithUsersDeletion(t *testing.T) {
	for _, operation := range []string{"send", "grant"} {
		t.Run(operation, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
			defer cancel()
			db := openLocalOutboundDatabase(t, ctx)
			repo := NewRepository(db, nil, StorageConfig{})
			f := createLocalSharedOutboundFixture(t, ctx, db.Pool(), "final-delete-"+operation)
			target := f.tenant
			remover := tenant.Context{OrganizationID: f.organizationID, UserID: f.userID, MemberRole: "admin", UserRole: "admin", Permissions: []string{"*"}}
			if operation == "send" {
				if _, err := db.Pool().Exec(ctx, `update public.whatsapp_sessions set owner_user_id=$2::uuid where id=$1::uuid`, f.sessionID, target.UserID); err != nil {
					t.Fatal(err)
				}
				if _, err := repo.JoinConversationAttendance(ctx, target, f.conversationID, attendanceInput{ExpectedLeadID: f.leadID, SendSessionID: f.sessionID}); err != nil {
					t.Fatal(err)
				}
			} else {
				// Remove the administrator owning the session, with another admin
				// as the canonical remover/transfer target. Grant's recipient remains.
				if _, err := db.Pool().Exec(ctx, `update public.organization_members set role='owner' where organization_id=$1::uuid and user_id=$2::uuid;update public.leads set assigned_user_id=$3::uuid where id=$4::uuid`, f.organizationID, f.tenant.UserID, f.userID, f.leadID); err != nil {
					t.Fatal(err)
				}
				target, remover = remover, tenant.Context{OrganizationID: f.organizationID, UserID: f.tenant.UserID, MemberRole: "owner", UserRole: "admin", Permissions: []string{"*"}}
			}
			blocker, err := db.Pool().Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer blocker.Rollback(context.Background())
			var pid int
			if err := blocker.QueryRow(ctx, `select pg_backend_pid() from public.leads where id=$1::uuid for update`, f.leadID).Scan(&pid); err != nil {
				t.Fatal(err)
			}
			removed := make(chan error, 1)
			go func() {
				_, err := usersrepo.NewRepository(db, usersrepo.AuthAdminConfig{}).DeleteOrganizationUser(ctx, remover, target.UserID, usersrepo.DeleteUserInput{TransferLeadsToUserID: &remover.UserID})
				removed <- err
			}()
			waitForSessionConversationBlockedQuery(t, ctx, db.Pool(), "update public.leads")
			done := make(chan error, 1)
			go func() {
				if operation == "send" {
					_, err := repo.SendMessage(ctx, target, f.conversationID, sendMessageInput{Text: "Synthetic admission during removal", ClientMessageID: f.suffix + "-send", ExpectedLeadID: f.leadID})
					done <- err
				} else {
					done <- repo.GrantSessionAccess(ctx, target, f.sessionID, grantAccessInput{UserID: remover.UserID, CanView: true, CanSend: true})
				}
			}()
			deadline := time.Now().Add(4 * time.Second)
			waiting := 0
			for time.Now().Before(deadline) {
				if err := db.Pool().QueryRow(ctx, `select count(*) from pg_stat_activity where datname=current_database() and pid<>$1 and wait_event_type='Lock'`, pid).Scan(&waiting); err != nil {
					t.Fatal(err)
				}
				if waiting >= 2 {
					break
				}
				time.Sleep(10 * time.Millisecond)
			}
			if waiting < 2 {
				t.Fatal("both canonical operations must reach actual lock waits")
			}
			if err := blocker.Commit(ctx); err != nil {
				t.Fatal(err)
			}
			if err := <-removed; err != nil {
				t.Fatalf("canonical deletion deadlocked or failed: %v", err)
			}
			if err := <-done; !errors.Is(err, tenant.ErrOrganizationAccessDenied) && !errors.Is(err, ErrSessionNotFound) && !errors.Is(err, ErrConversationNotFound) && !errors.Is(err, ErrInvalidReference) {
				t.Fatalf("removed actor admitted %s or deadlocked: %v", operation, err)
			}
			var queued, newGrants int
			if err := db.Pool().QueryRow(ctx, `select (select count(*) from public.whatsapp_outbox where organization_id=$1::uuid),(select count(*) from public.whatsapp_session_access where organization_id=$1::uuid and granted_by=$2::uuid)`, f.organizationID, target.UserID).Scan(&queued, &newGrants); err != nil {
				t.Fatal(err)
			}
			if queued != 0 || newGrants != 0 {
				t.Fatalf("removed actor left effects: outbox%d grants%d", queued, newGrants)
			}
			// A separate account/lead still admits an independent intent.
			other := createLocalSharedOutboundFixture(t, ctx, db.Pool(), "final-independent-"+operation)
			if _, err := repo.JoinConversationAttendance(ctx, other.tenant, other.conversationID, attendanceInput{ExpectedLeadID: other.leadID, SendSessionID: other.sessionID}); err != nil {
				t.Fatal(err)
			}
			if _, err := repo.SendMessage(ctx, other.tenant, other.conversationID, sendMessageInput{Text: "Synthetic independent chain", ExpectedLeadID: other.leadID, ClientMessageID: other.suffix + "-independent"}); err != nil {
				t.Fatalf("independent chain blocked: %v", err)
			}
		})
	}
}

func TestLocalFinalDeleteConversationUsesOperationalAuthority(t *testing.T) {
	for _, scenario := range []string{"owner", "assigned_read_grant", "broad_admin", "default_manage_no_grant", "revoked_grant", "transfer", "shared_manager_other_lead", "owner_role_revoked", "custom_read_revoked", "operation_denied", "secondary_org"} {
		t.Run(scenario, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			db := openLocalOutboundDatabase(t, ctx)
			repo := NewRepository(db, nil, StorageConfig{})
			f := createLocalSharedOutboundFixture(t, ctx, db.Pool(), "final-delete-authority")
			// A real request carries canonical default permissions, including
			// WhatsAppManage. Do not let a reduced fixture mask the old bypass.
			actor, actorErr := currentWhatsAppActor(ctx, db.Pool(), f.tenant)
			if actorErr != nil {
				t.Fatal(actorErr)
			}
			want := scenario == "owner" || scenario == "assigned_read_grant"
			var err error
			switch scenario {
			case "owner":
				_, err = db.Pool().Exec(ctx, `update public.whatsapp_sessions set owner_user_id=$2::uuid where id=$1::uuid`, f.sessionID, actor.UserID)
			case "assigned_read_grant":
				_, err = db.Pool().Exec(ctx, `update public.whatsapp_session_access set can_send=false where session_id=$1::uuid`, f.sessionID)
			case "broad_admin":
				_, err = db.Pool().Exec(ctx, `update public.organization_members set role='admin' where organization_id=$1::uuid and user_id=$2::uuid;delete from public.whatsapp_session_access where session_id=$3::uuid`, f.organizationID, actor.UserID, f.sessionID)
				actor.MemberRole = "admin"
				actor.Permissions = []string{"*"}
			case "default_manage_no_grant":
				_, err = db.Pool().Exec(ctx, `delete from public.whatsapp_session_access where session_id=$1::uuid`, f.sessionID)
			case "revoked_grant":
				_, err = db.Pool().Exec(ctx, `update public.whatsapp_session_access set can_read=false,can_view=false,can_send=false where session_id=$1::uuid`, f.sessionID)
			case "transfer":
				_, err = db.Pool().Exec(ctx, `update public.leads set assigned_user_id=$2::uuid where id=$1::uuid`, f.leadID, f.userID)
			case "shared_manager_other_lead":
				_, err = db.Pool().Exec(ctx, `update public.organization_members set role='manager' where organization_id=$1::uuid and user_id=$2::uuid;update public.leads set assigned_user_id=$3::uuid where id=$4::uuid`, f.organizationID, actor.UserID, f.userID, f.leadID)
				actor.MemberRole = "manager"
				actor.Permissions = []string{"lead_view_all", "whatsapp_view", "whatsapp_operate", "whatsapp_manage"}
			case "owner_role_revoked":
				_, err = db.Pool().Exec(ctx, `update public.organization_members set role='manager' where organization_id=$1::uuid and user_id=$2::uuid`, f.organizationID, f.userID)
			case "custom_read_revoked":
				roleID := deepReadRole(t, ctx, db.Pool(), f)
				_, err = db.Pool().Exec(ctx, `update public.leads set assigned_user_id=$2::uuid where id=$1::uuid;update public.organization_roles set is_active=false where id=$3::uuid`, f.leadID, f.userID, roleID)
				actor.Permissions = []string{"lead_view_all", "whatsapp_view", "whatsapp_operate", "whatsapp_manage"}
			case "operation_denied":
				_, err = db.Pool().Exec(ctx, `insert into public.user_permission_overrides(organization_id,user_id,permission_key,allowed) values($1::uuid,$2::uuid,'whatsapp_operate',false),($1::uuid,$2::uuid,'whatsapp_manage',false)`, f.organizationID, actor.UserID)
			case "secondary_org":
				other := createLocalSharedOutboundFixture(t, ctx, db.Pool(), "final-secondary")
				_, err = db.Pool().Exec(ctx, `update public.users set organization_id=$2::uuid where id=$1::uuid`, actor.UserID, other.organizationID)
				t.Cleanup(func() {
					_, err := db.Pool().Exec(context.Background(), `update public.users set organization_id=$2::uuid where id=$1::uuid`, actor.UserID, f.organizationID)
					if err != nil {
						t.Error(err)
					}
				})
			}
			if err != nil {
				t.Fatal(err)
			}
			err = repo.DeleteConversation(ctx, actor, f.conversationID, f.leadID)
			if want && err != nil {
				t.Fatalf("allowed account could not delete inbox: %v", err)
			}
			if !want && !errors.Is(err, ErrConversationNotFound) && !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
				t.Fatalf("unauthorized account deleted inbox: %v", err)
			}
			var deleted bool
			if err := db.Pool().QueryRow(ctx, `select deleted_at is not null from public.whatsapp_conversations where id=$1::uuid`, f.conversationID).Scan(&deleted); err != nil || deleted != want {
				t.Fatalf("delete state%t want%t: %v", deleted, want, err)
			}
		})
	}
}

func TestLocalFinalDeleteAndReceiptRejectLateRevocation(t *testing.T) {
	for _, operation := range []string{"delete", "receipt"} {
		changes := []string{"permission", "grant", "transfer"}
		if operation == "receipt" {
			changes = []string{"permission", "read_permission", "transfer"}
		}
		for _, change := range changes {
			t.Run(operation+"_"+change, func(t *testing.T) {
				ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
				defer cancel()
				db := openLocalOutboundDatabase(t, ctx)
				var calls atomic.Int32
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					calls.Add(1)
					_ = json.NewEncoder(w).Encode(map[string]bool{"success": true})
				}))
				defer server.Close()
				repo := NewRepository(db, nil, StorageConfig{EvolutionGo: EvolutionGoConfig{APIURL: server.URL, APIKey: "synthetic"}})
				f := createLocalSharedOutboundFixture(t, ctx, db.Pool(), "final-late-"+operation+change)
				current, err := currentWhatsAppActor(ctx, db.Pool(), f.tenant)
				if err != nil {
					t.Fatal(err)
				}
				f.tenant = current
				if operation == "receipt" {
					if _, err := db.Pool().Exec(ctx, `update public.whatsapp_sessions set owner_user_id=$2::uuid where id=$1::uuid`, f.sessionID, f.tenant.UserID); err != nil {
						t.Fatal(err)
					}
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
					if operation == "receipt" {
						done <- repo.MarkAsSeenOnWhatsApp(ctx, f.tenant, f.conversationID, f.leadID)
					} else {
						done <- repo.DeleteConversation(ctx, f.tenant, f.conversationID, f.leadID)
					}
				}()
				waitDeepConversationLock(t, ctx, db.Pool(), pid)
				switch change {
				case "permission":
					_, err = db.Pool().Exec(ctx, `insert into public.user_permission_overrides(organization_id,user_id,permission_key,allowed) values($1::uuid,$2::uuid,'whatsapp_operate',false),($1::uuid,$2::uuid,'whatsapp_manage',false)`, f.organizationID, f.tenant.UserID)
				case "grant":
					_, err = db.Pool().Exec(ctx, `delete from public.whatsapp_session_access where session_id=$1::uuid`, f.sessionID)
				case "read_permission":
					_, err = db.Pool().Exec(ctx, `insert into public.user_permission_overrides(organization_id,user_id,permission_key,allowed) values($1::uuid,$2::uuid,'lead_view_own',false)`, f.organizationID, f.tenant.UserID)
				case "transfer":
					_, err = db.Pool().Exec(ctx, `update public.leads set assigned_user_id=$2::uuid where id=$1::uuid`, f.leadID, f.userID)
				}
				if err != nil {
					t.Fatal(err)
				}
				if err := blocker.Commit(ctx); err != nil {
					t.Fatal(err)
				}
				err = <-done
				if !errors.Is(err, ErrConversationNotFound) && !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
					t.Fatalf("late %s did not deny %s: %v", change, operation, err)
				}
				var deleted bool
				if err := db.Pool().QueryRow(ctx, `select deleted_at is not null from public.whatsapp_conversations where id=$1::uuid`, f.conversationID).Scan(&deleted); err != nil || deleted || calls.Load() != 0 {
					t.Fatalf("denied operation left effects: deleted%t provider%d %v", deleted, calls.Load(), err)
				}
			})
		}
	}
}
