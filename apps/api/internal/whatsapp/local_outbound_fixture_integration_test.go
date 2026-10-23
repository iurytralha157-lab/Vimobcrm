package whatsapp

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// A wrapper must verify the disposable Docker label or dedicated native
// cluster identity and exact port before setting the marker.
func localOutboundTestDatabaseURL(t *testing.T) string {
	t.Helper()
	if os.Getenv("VIMOB_RUN_WHATSAPP_SEND_DB_TESTS") != "LOCAL_WRITE_TEST" {
		t.Skip("set VIMOB_RUN_WHATSAPP_SEND_DB_TESTS=LOCAL_WRITE_TEST through the disposable label guard")
	}
	databaseURL := localVerifiedOutboundCloneURL()
	if databaseURL == "" {
		t.Fatal("send fixtures require the verified disposable loopback clone guard")
	}
	return databaseURL
}

// The old integration harness may accept this additional database only with
// the same exact external runtime/loopback verification as new fixtures.
func localVerifiedOutboundCloneURL() string {
	return verifiedLocalOutboundTargetURL()
}

func openLocalOutboundDatabase(t *testing.T, ctx context.Context) *dbpkg.Postgres {
	t.Helper()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL: localOutboundTestDatabaseURL(t), MaxConns: 4, HealthTimeout: 3 * time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(postgres.Close)
	var databaseName string
	if err := postgres.Pool().QueryRow(ctx, `select current_database()`).Scan(&databaseName); err != nil || databaseName != "vimob_whatsapp_clone" {
		t.Fatalf("send fixture connected to %q: %v", databaseName, err)
	}
	verifyNativeOutboundCluster(t, ctx, postgres.Pool())
	return postgres
}

func createLocalSharedOutboundFixture(t *testing.T, ctx context.Context, pool *pgxpool.Pool, label string) sessionConversationLockFixture {
	t.Helper()
	fixture := createSessionConversationLockFixture(t, ctx, pool, label)
	var brokerID string
	if err := pool.QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&brokerID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, err := pool.Exec(cleanupCtx, `
			delete from public.whatsapp_attendance_marker_confirmations where organization_id=$1::uuid;
			delete from public.lead_timeline_events where organization_id=$1::uuid;
			delete from public.whatsapp_outbox where organization_id=$1::uuid;
			delete from public.whatsapp_messages where organization_id=$1::uuid;
			delete from public.whatsapp_attendance_entries where organization_id=$1::uuid;
			update public.users set organization_id=null where organization_id=$1::uuid;
			delete from public.organizations where id=$1::uuid;
			delete from public.users where id=any($2::uuid[]);
			delete from auth.users where id=any($2::uuid[])
		`, fixture.organizationID, []string{fixture.userID, brokerID}); err != nil {
			t.Errorf("cleanup shared outbound fixture: %v", err)
		}
	})
	if _, err := pool.Exec(ctx, `
		insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
		values($1::uuid,'authenticated','authenticated',$2,'',now(),'{}','{}',now(),now());
		insert into public.users(id,organization_id,name,email,role,is_active)
		values($1::uuid,$3::uuid,'Synthetic shared broker',$2,'user',true)
		on conflict(id) do update set organization_id=excluded.organization_id,role='user',is_active=true;
		insert into public.organization_members(organization_id,user_id,role,is_active)
		values($3::uuid,$1::uuid,'user',true)
		on conflict(user_id,organization_id) do update set role='user',is_active=true,deleted_at=null;
		update public.leads set assigned_user_id=$1::uuid where id=$4::uuid;
		update public.whatsapp_sessions set phone_number='5511888877777' where id=$5::uuid;
		insert into public.whatsapp_session_access(organization_id,session_id,user_id,granted_by,can_view,can_read,can_send,only_leads_access,access_mode,grant_scope)
		values($3::uuid,$5::uuid,$1::uuid,$6::uuid,true,true,true,true,'assigned_leads_only','organization')
	`, brokerID, fixture.suffix+"-broker@example.invalid", fixture.organizationID, fixture.leadID, fixture.sessionID, fixture.userID); err != nil {
		t.Fatal(err)
	}
	fixture.tenant = tenant.Context{OrganizationID: fixture.organizationID, UserID: brokerID,
		UserRole: "user", MemberRole: "user", Permissions: []string{"lead_view_own", "whatsapp_view", "whatsapp_operate"}}
	return fixture
}

// Claim only the exact synthetic row, never another fixture's queued send.
func leaseLocalOutbound(t *testing.T, ctx context.Context, pool *pgxpool.Pool, organizationID, clientID string) pendingWhatsAppOutbox {
	t.Helper()
	var item pendingWhatsAppOutbox
	var rawPayload string
	if err := pool.QueryRow(ctx, `update public.whatsapp_outbox
		set status='processing',locked_at=now(),locked_by=$3,updated_at=now()
		where organization_id=$1::uuid and client_message_id=$2 and status='pending'
		returning id::text,organization_id::text,session_id::text,conversation_id::text,
		message_id::text,client_message_id,coalesce(provider_message_id,''),payload::text,
		attempts,max_attempts,locked_by,coalesce(last_error,''),created_at
	`, organizationID, clientID, "synthetic-local-send-"+clientID).Scan(
		&item.ID, &item.OrganizationID, &item.SessionID, &item.ConversationID,
		&item.MessageRowID, &item.ClientMessageID, &item.ProviderMessageID, &rawPayload,
		&item.Attempts, &item.MaxAttempts, &item.LeaseToken, &item.LastError, &item.CreatedAt); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(rawPayload), &item.Payload); err != nil {
		t.Fatal(err)
	}
	return item
}

func assertLocalOutboundState(t *testing.T, ctx context.Context, pool *pgxpool.Pool, item pendingWhatsAppOutbox, wantStatus string, wantAttempts int) {
	t.Helper()
	var messageStatus, outboxStatus string
	var attempts, messages, outbox int
	if err := pool.QueryRow(ctx, `select message.status,queued.status,queued.attempts,
		(select count(*)::int from public.whatsapp_messages where organization_id=$2::uuid and client_message_id=$3),
		(select count(*)::int from public.whatsapp_outbox where organization_id=$2::uuid and client_message_id=$3)
		from public.whatsapp_outbox queued join public.whatsapp_messages message on message.id=queued.message_id
		where queued.id=$1::uuid and queued.organization_id=$2::uuid
	`, item.ID, item.OrganizationID, item.ClientMessageID).Scan(&messageStatus, &outboxStatus, &attempts, &messages, &outbox); err != nil {
		t.Fatal(err)
	}
	if messageStatus != wantStatus || outboxStatus != wantStatus || attempts != wantAttempts || messages != 1 || outbox != 1 {
		t.Fatalf("outbound state message=%s outbox=%s attempts=%d rows=%d/%d, want %s/%d/1/1", messageStatus, outboxStatus, attempts, messages, outbox, wantStatus, wantAttempts)
	}
}
