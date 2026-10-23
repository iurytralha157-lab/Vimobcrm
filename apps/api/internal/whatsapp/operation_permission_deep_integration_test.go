package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/settings"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	usersrepo "github.com/vimob-crm/vimob-crm/apps/api/internal/users"
)

func TestLocalDeepProviderStartSerializesWithCanonicalUserRemoval(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		_ = json.NewEncoder(w).Encode(map[string]string{"messageId": "SYNTHETIC-MUST-NOT-SEND"})
	}))
	defer server.Close()
	repo := NewRepository(db, nil, StorageConfig{EvolutionGo: EvolutionGoConfig{APIURL: server.URL, APIKey: "synthetic"}})
	f := createLocalSharedOutboundFixture(t, ctx, db.Pool(), "deep-worker-user-remove")
	if _, err := db.Pool().Exec(ctx, `update public.whatsapp_sessions set owner_user_id=$2::uuid where id=$1::uuid`, f.sessionID, f.tenant.UserID); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.JoinConversationAttendance(ctx, f.tenant, f.conversationID, attendanceInput{ExpectedLeadID: f.leadID, SendSessionID: f.sessionID}); err != nil {
		t.Fatal(err)
	}
	queueHardeningMessage(t, ctx, repo, f, sendMessageInput{Text: "Synthetic pending removal", ClientMessageID: f.suffix + "-intent"})
	item := leaseLocalOutbound(t, ctx, db.Pool(), f.organizationID, f.suffix+"-intent")
	blocker, err := db.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer blocker.Rollback(context.Background())
	var pid int
	if err := blocker.QueryRow(ctx, `select pg_backend_pid() from public.leads where id=$1::uuid for update`, f.leadID).Scan(&pid); err != nil {
		t.Fatal(err)
	}
	admin := tenant.Context{OrganizationID: f.organizationID, UserID: f.userID, MemberRole: "admin", UserRole: "admin", Permissions: []string{"*"}}
	removed := make(chan error, 1)
	go func() {
		_, err := usersrepo.NewRepository(db, usersrepo.AuthAdminConfig{}).DeleteOrganizationUser(ctx, admin, f.tenant.UserID, usersrepo.DeleteUserInput{TransferLeadsToUserID: &f.userID})
		removed <- err
	}()
	waitForSessionConversationBlockedQuery(t, ctx, db.Pool(), "update public.leads")
	worker := make(chan error, 1)
	go func() { worker <- repo.processClaimedWhatsAppOutbox(ctx, item, whatsappOutboxLaneFast) }()
	deadline := time.Now().Add(3 * time.Second)
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
		t.Fatal("removal and worker did not both reach actual row-lock waits")
	}
	if err := blocker.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-removed:
		if err != nil {
			t.Fatalf("canonical removal failed/deadlocked: %v", err)
		}
	case <-ctx.Done():
		t.Fatal("removal did not finish")
	}
	select {
	case err := <-worker:
		if err != nil {
			t.Fatalf("prestart worker failed/deadlocked: %v", err)
		}
	case <-ctx.Done():
		t.Fatal("worker did not finish")
	}
	assertLocalOutboundState(t, ctx, db.Pool(), item, "failed", 0)
	if calls.Load() != 0 {
		t.Fatalf("removed actor reached provider%d times", calls.Load())
	}
}

func deepReadRole(t *testing.T, ctx context.Context, pool *pgxpool.Pool, f sessionConversationLockFixture) string {
	t.Helper()
	var catalogID, roleID string
	inserted := true
	err := pool.QueryRow(ctx, `insert into public.available_permissions(key,name,category) values('lead_view_all','Synthetic read-all','leads') on conflict(key) do nothing returning id::text`).Scan(&catalogID)
	if errors.Is(err, pgx.ErrNoRows) {
		inserted = false
		err = pool.QueryRow(ctx, `select id::text from public.available_permissions where key='lead_view_all'`).Scan(&catalogID)
	}
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, err := pool.Exec(cleanupCtx, `delete from public.user_organization_roles where organization_id=$1::uuid;delete from public.organization_role_permissions where organization_id=$1::uuid;delete from public.organization_roles where organization_id=$1::uuid`, f.organizationID)
		if err != nil {
			t.Error(err)
		}
		if inserted {
			if _, err := pool.Exec(cleanupCtx, `delete from public.available_permissions where id=$1::uuid`, catalogID); err != nil {
				t.Error(err)
			}
		}
	})
	if err := pool.QueryRow(ctx, `insert into public.organization_roles(organization_id,name) values($1::uuid,'Synthetic read-all') returning id::text`, f.organizationID).Scan(&roleID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `insert into public.organization_role_permissions(organization_role_id,permission_key,organization_id,role_id,permission_id) values($1::uuid,'lead_view_all',$2::uuid,$1::uuid,$3::uuid);insert into public.user_organization_roles(user_id,organization_role_id,organization_id,role_id,is_active) values($4::uuid,$1::uuid,$2::uuid,$1::uuid,true)`, roleID, f.organizationID, catalogID, f.tenant.UserID); err != nil {
		t.Fatal(err)
	}
	return roleID
}

func TestLocalDeepActorPermissionsMatchCanonicalTenantResolver(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	f := createLocalSharedOutboundFixture(t, ctx, db.Pool(), "deep-resolver")
	deepReadRole(t, ctx, db.Pool(), f)
	for _, s := range []struct {
		name, role  string
		overrides   map[string]bool
		wantOperate bool
	}{
		{"user custom read role", "user", nil, true}, {"manager", "manager", nil, true}, {"manage implies operate", "user", map[string]bool{"whatsapp_operate": false}, true}, {"both denied", "user", map[string]bool{"whatsapp_manage": false, "whatsapp_operate": false}, false}, {"no lead operate", "user", map[string]bool{"lead_operate": false}, true},
	} {
		t.Run(s.name, func(t *testing.T) {
			if _, err := db.Pool().Exec(ctx, `update public.organization_members set role=$3 where organization_id=$1::uuid and user_id=$2::uuid;delete from public.user_permission_overrides where organization_id=$1::uuid and user_id=$2::uuid`, f.organizationID, f.tenant.UserID, s.role); err != nil {
				t.Fatal(err)
			}
			for key, allowed := range s.overrides {
				if _, err := db.Pool().Exec(ctx, `insert into public.user_permission_overrides(organization_id,user_id,permission_key,allowed) values($1::uuid,$2::uuid,$3,$4)`, f.organizationID, f.tenant.UserID, key, allowed); err != nil {
					t.Fatal(err)
				}
			}
			actual, err := currentWhatsAppActor(ctx, db.Pool(), f.tenant)
			if err != nil {
				t.Fatal(err)
			}
			canonical, err := tenant.NewRepository(db).Resolve(ctx, f.tenant.UserID, f.organizationID)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(actual.Permissions, canonical.Permissions) || actual.HasPermission(permissions.WhatsAppOperate) != s.wantOperate {
				t.Fatalf("fresh permissions drift: actual%v canonical%v operate%t", actual.Permissions, canonical.Permissions, actual.HasPermission(permissions.WhatsAppOperate))
			}
		})
	}
}

func TestLocalDeepCustomRoleReadWithdrawalSerializesWithProviderStart(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	repo := NewRepository(db, nil, StorageConfig{})
	f := createLocalSharedOutboundFixture(t, ctx, db.Pool(), "deep-role-start")
	roleID := deepReadRole(t, ctx, db.Pool(), f)
	if _, err := db.Pool().Exec(ctx, `update public.whatsapp_sessions set owner_user_id=$2::uuid where id=$1::uuid;update public.leads set assigned_user_id=$4::uuid where id=$3::uuid`, f.sessionID, f.tenant.UserID, f.leadID, f.userID); err != nil {
		t.Fatal(err)
	}
	f.tenant.Permissions = append(f.tenant.Permissions, permissions.LeadViewAll)
	if _, err := repo.JoinConversationAttendance(ctx, f.tenant, f.conversationID, attendanceInput{ExpectedLeadID: f.leadID, SendSessionID: f.sessionID}); err != nil {
		t.Fatal(err)
	}
	queueHardeningMessage(t, ctx, repo, f, sendMessageInput{Text: "Synthetic role read", ClientMessageID: f.suffix + "-intent"})
	item := leaseLocalOutbound(t, ctx, db.Pool(), f.organizationID, f.suffix+"-intent")
	writer, err := db.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer writer.Rollback(context.Background())
	if _, err := writer.Exec(ctx, `select id from public.organization_roles where id=$1::uuid for update;delete from public.organization_role_permissions where role_id=$1::uuid`, roleID); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { _, err := repo.startWhatsAppOutboxProviderAttempt(ctx, item); done <- err }()
	select {
	case err := <-done:
		t.Fatalf("start ignored in-progress role writer: %v", err)
	case <-time.After(150 * time.Millisecond):
	}
	if err := writer.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if !errors.Is(err, ErrSessionAccessRevoked) {
			t.Fatalf("custom READ withdrawal did not fence start: %v", err)
		}
	case <-ctx.Done():
		t.Fatal("role/start lock did not settle")
	}
	var attempts int
	if err := db.Pool().QueryRow(ctx, `select attempts from public.whatsapp_outbox where id=$1::uuid`, item.ID).Scan(&attempts); err != nil || attempts != 0 {
		t.Fatalf("role denied start attempts%d %v", attempts, err)
	}
}

func TestLocalDeepWhatsAppPermissionRevocationStopsUntouchedSend(t *testing.T) {
	for _, owner := range []bool{true, false} {
		name := "shared"
		if owner {
			name = "owner"
		}
		t.Run(name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
			defer cancel()
			db := openLocalOutboundDatabase(t, ctx)
			var calls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				var body map[string]any
				_ = json.NewDecoder(r.Body).Decode(&body)
				_ = json.NewEncoder(w).Encode(map[string]string{"messageId": stringFromAny(body["id"])})
			}))
			defer server.Close()
			repo := NewRepository(db, nil, StorageConfig{EvolutionGo: EvolutionGoConfig{APIURL: server.URL, APIKey: "synthetic"}})
			f := createLocalSharedOutboundFixture(t, ctx, db.Pool(), "deep-operation-"+name)
			if owner {
				if _, err := db.Pool().Exec(ctx, `update public.whatsapp_sessions set owner_user_id=$2::uuid where id=$1::uuid`, f.sessionID, f.tenant.UserID); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := repo.JoinConversationAttendance(ctx, f.tenant, f.conversationID, attendanceInput{ExpectedLeadID: f.leadID, SendSessionID: f.sessionID}); err != nil {
				t.Fatal(err)
			}
			queueHardeningMessage(t, ctx, repo, f, sendMessageInput{Text: "Synthetic denied pending", ClientMessageID: f.suffix + "-pending"})
			admin := tenant.Context{OrganizationID: f.organizationID, UserID: f.userID, MemberRole: "admin", UserRole: "admin", Permissions: []string{"*"}}
			profile, err := settings.NewRepository(db, settings.ExternalConfig{}).ReplaceUserPermissions(ctx, admin, f.tenant.UserID, map[string]bool{"whatsapp_operate": false, "whatsapp_manage": false})
			if err != nil {
				t.Fatal(err)
			}
			for _, p := range profile.Permissions {
				if p.Key == "whatsapp_operate" && p.Allowed {
					t.Fatal("fixture did not revoke effective operation")
				}
			}
			item := leaseLocalOutbound(t, ctx, db.Pool(), f.organizationID, f.suffix+"-pending")
			if err := repo.processClaimedWhatsAppOutbox(ctx, item, whatsappOutboxLaneFast); err != nil {
				t.Fatal(err)
			}
			assertLocalOutboundState(t, ctx, db.Pool(), item, "failed", 0)
			if calls.Load() != 0 {
				t.Fatalf("revoked operation reached provider %d times", calls.Load())
			}
		})
	}
}

func TestLocalDeepPermissionRevocationPreservesAcceptedAndUnknown(t *testing.T) {
	for _, marker := range []string{whatsappOutboxProviderAcceptedMarker, whatsappOutboxProviderStartedMarker, whatsappOutboxProviderUnknownMarker} {
		t.Run(marker, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
			defer cancel()
			db := openLocalOutboundDatabase(t, ctx)
			var calls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				http.Error(w, "provider must not be called", 500)
			}))
			defer server.Close()
			repo := NewRepository(db, nil, StorageConfig{EvolutionGo: EvolutionGoConfig{APIURL: server.URL, APIKey: "synthetic"}})
			f := createLocalSharedOutboundFixture(t, ctx, db.Pool(), "deep-boundary-"+marker)
			if _, err := repo.JoinConversationAttendance(ctx, f.tenant, f.conversationID, attendanceInput{ExpectedLeadID: f.leadID, SendSessionID: f.sessionID}); err != nil {
				t.Fatal(err)
			}
			queueHardeningMessage(t, ctx, repo, f, sendMessageInput{Text: "Synthetic existing provider boundary", ClientMessageID: f.suffix + "-pending"})
			// Keep the immutable provider reference already admitted by the
			// canonical outbox; the fixture changes only its durable boundary.
			if _, err := db.Pool().Exec(ctx, `update public.whatsapp_outbox set attempts=1,last_error=$3 where organization_id=$1::uuid and client_message_id=$2;
			 insert into public.user_permission_overrides(organization_id,user_id,permission_key,allowed) values($1::uuid,$4::uuid,'whatsapp_operate',false),($1::uuid,$4::uuid,'whatsapp_manage',false)`, f.organizationID, f.suffix+"-pending", marker, f.tenant.UserID); err != nil {
				t.Fatal(err)
			}
			item := leaseLocalOutbound(t, ctx, db.Pool(), f.organizationID, f.suffix+"-pending")
			if err := repo.processClaimedWhatsAppOutbox(ctx, item, whatsappOutboxLaneFast); err != nil {
				t.Fatal(err)
			}
			var outbox, message string
			var attempts int
			if err := db.Pool().QueryRow(ctx, `select queued.status,wm.status,queued.attempts from public.whatsapp_outbox queued join public.whatsapp_messages wm on wm.id=queued.message_id where queued.id=$1::uuid`, item.ID).Scan(&outbox, &message, &attempts); err != nil {
				t.Fatal(err)
			}
			wantOutbox, wantMessage := "dead", "failed"
			if marker == whatsappOutboxProviderAcceptedMarker {
				wantOutbox, wantMessage = "sent", "sent"
			}
			if outbox != wantOutbox || message != wantMessage || attempts != 1 || calls.Load() != 0 {
				t.Fatalf("revocation changed provider boundary: %s/%s/%d calls%d", outbox, message, attempts, calls.Load())
			}
		})
	}
}

func TestLocalDeepWhatsAppPermissionChangeSerializesWithProviderStart(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	repo := NewRepository(db, nil, StorageConfig{})
	f := createLocalSharedOutboundFixture(t, ctx, db.Pool(), "deep-permission-lock")
	if _, err := repo.JoinConversationAttendance(ctx, f.tenant, f.conversationID, attendanceInput{ExpectedLeadID: f.leadID, SendSessionID: f.sessionID}); err != nil {
		t.Fatal(err)
	}
	queueHardeningMessage(t, ctx, repo, f, sendMessageInput{Text: "Synthetic serialized", ClientMessageID: f.suffix + "-pending"})
	item := leaseLocalOutbound(t, ctx, db.Pool(), f.organizationID, f.suffix+"-pending")
	writer, err := db.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer writer.Rollback(context.Background())
	// This is the actual settings writer's serialization row. No network is
	// involved; the pending start must observe the committed denial afterward.
	if _, err := writer.Exec(ctx, `select user_id from public.organization_members where organization_id=$1::uuid and user_id=$2::uuid for update;
	 insert into public.user_permission_overrides(organization_id,user_id,permission_key,allowed) values($1::uuid,$2::uuid,'whatsapp_operate',false),($1::uuid,$2::uuid,'whatsapp_manage',false)`, f.organizationID, f.tenant.UserID); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { _, err := repo.startWhatsAppOutboxProviderAttempt(ctx, item); done <- err }()
	select {
	case err := <-done:
		t.Fatalf("provider start passed an uncommitted permission writer: %v", err)
	case <-time.After(150 * time.Millisecond):
	}
	if err := writer.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if !errors.Is(err, ErrSessionAccessRevoked) {
			t.Fatalf("committed permission denial did not fence start: %v", err)
		}
	case <-ctx.Done():
		t.Fatal("serialized start did not finish")
	}
	var attempts int
	if err := db.Pool().QueryRow(ctx, `select attempts from public.whatsapp_outbox where id=$1::uuid`, item.ID).Scan(&attempts); err != nil || attempts != 0 {
		t.Fatalf("denied start attempted provider: %d %v", attempts, err)
	}
}
