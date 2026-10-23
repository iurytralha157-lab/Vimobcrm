package whatsapp

import (
	"context"
	"errors"
	"net/url"
	"os"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestWhatsAppMediaDurableCutoverDiscoveryAndClaimIntegration(t *testing.T) {
	if os.Getenv("VIMOB_RUN_WHATSAPP_MEDIA_SCOPE_DB_TESTS") != "LOCAL_WRITE_TEST" {
		t.Skip("set VIMOB_RUN_WHATSAPP_MEDIA_SCOPE_DB_TESTS=LOCAL_WRITE_TEST for the disposable fixture")
	}
	target, err := url.Parse(strings.TrimSpace(os.Getenv("WHATSAPP_MEDIA_SCOPE_TEST_DATABASE_URL")))
	if err != nil || target.User == nil || target.User.Username() != "postgres" ||
		(target.Hostname() != "127.0.0.1" && target.Hostname() != "localhost") ||
		(target.Path != "/vimob_whatsapp_clone" && target.Path != "/vimob_whatsapp_test") {
		t.Fatal("media scope fixture requires a disposable loopback vimob_whatsapp_clone/test database")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 40*time.Second)
	defer cancel()
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: target.String(), MaxConns: 2, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	pool := database.Pool()
	var organizationID, ownerID string
	if err := pool.QueryRow(ctx, `select gen_random_uuid()::text,gen_random_uuid()::text`).Scan(&organizationID, &ownerID); err != nil {
		t.Fatal(err)
	}
	var sessionIDs []string
	defer func() {
		cleanupContext, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		if _, err := pool.Exec(cleanupContext, `delete from private.whatsapp_webhook_session_cutovers where session_id=any($3::uuid[]);
			update public.users set organization_id=null where id=$2::uuid; delete from public.organizations where id=$1::uuid;
			delete from public.users where id=$2::uuid;delete from auth.users where id=$2::uuid`, organizationID, ownerID, sessionIDs); err != nil {
			t.Errorf("cleanup disposable media scope fixture: %v", err)
		}
	}()
	if _, err := pool.Exec(ctx, `insert into public.organizations(id,name,is_active) values($1::uuid,'Media cutover scope fixture',true);
		insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
		values($2::uuid,'authenticated','authenticated','media-scope-'||$2||'@example.test','',now(),'{}','{}',now(),now());
		insert into public.users(id,organization_id,name,email,role,is_active)
		values($2::uuid,$1::uuid,'Media scope owner','media-scope-'||$2||'@example.test','admin',true)
		on conflict(id) do update set organization_id=excluded.organization_id,role='admin',is_active=true;`, organizationID, ownerID); err != nil {
		t.Fatal(err)
	}
	var hasCutoff bool
	if err := pool.QueryRow(ctx, `select exists(select 1 from information_schema.columns where table_schema='private'
		and table_name='whatsapp_webhook_session_cutovers' and column_name='cutoff_at')`).Scan(&hasCutoff); err != nil {
		t.Fatal(err)
	}
	for index := 0; index < 3; index++ {
		var sessionID, conversationID, messageID string
		if err := pool.QueryRow(ctx, `insert into public.whatsapp_sessions(organization_id,owner_user_id,instance_name,provider,status,is_active)
			values($1::uuid,$2::uuid,'media-scope-'||gen_random_uuid()::text,'evolution_go',case when $3 then 'disabled' else 'connected' end,not $3)
			returning id::text`, organizationID, ownerID, index == 2).Scan(&sessionID); err != nil {
			t.Fatal(err)
		}
		sessionIDs = append(sessionIDs, sessionID)
		if err := pool.QueryRow(ctx, `insert into public.whatsapp_conversations(organization_id,session_id,remote_jid,is_group)
			values($1::uuid,$2::uuid,'5511998880001@s.whatsapp.net',false) returning id::text`, organizationID, sessionID).Scan(&conversationID); err != nil {
			t.Fatal(err)
		}
		if err := pool.QueryRow(ctx, `insert into public.whatsapp_messages(organization_id,session_id,conversation_id,provider_message_id,message_id,
			from_me,direction,message_type,media_mime_type,media_status,media_size,status,capture_state,sent_at)
			values($1::uuid,$2::uuid,$3::uuid,'media-scope-message','media-scope-message',false,'inbound','image','image/png','pending',64,'received','unlinked_ephemeral',now())
			returning id::text`, organizationID, sessionID, conversationID).Scan(&messageID); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, `insert into public.media_jobs(organization_id,session_id,conversation_id,message_id,provider_message_id,message_key,
			media_type,media_mime_type,status,attempts,max_attempts,next_retry_at,dedupe_key,asset_key,declared_size)
			values($1::uuid,$2::uuid,$3::uuid,$4::uuid,'media-scope-message','{}','image','image/png','pending',0,3,now(),$4::text,$4::text,64)`, organizationID, sessionID, conversationID, messageID); err != nil {
			t.Fatal(err)
		}
		if index > 0 {
			cutoverSQL := `insert into private.whatsapp_webhook_session_cutovers(session_id,active_epoch,cutover_at,activated_at) values($1::uuid,1,now(),now())`
			if hasCutoff {
				cutoverSQL = `insert into private.whatsapp_webhook_session_cutovers(session_id,active_epoch,cutover_at,activated_at,cutoff_at) values($1::uuid,1,now(),now(),now())`
			}
			if _, err := pool.Exec(ctx, cutoverSQL, sessionID); err != nil {
				t.Fatal(err)
			}
		}
	}
	repo := Repository{db: database, functions: functionsClient{webhookProcessorMode: webhookProcessorEdge, webhookRolloutSessionIDs: []string{"*"}}}
	scope, err := repo.whatsappMediaWorkerSessionScope(ctx)
	if err != nil || !slices.Contains(scope, sessionIDs[1]) || slices.Contains(scope, sessionIDs[0]) || slices.Contains(scope, sessionIDs[2]) || slices.Contains(scope, "*") {
		t.Fatalf("global Edge discovery broadened ownership: %v %v", scope, err)
	}
	job, err := repo.claimWhatsAppMediaJobForSessions(ctx, time.Minute, 4, scope)
	if err != nil || job.SessionID != sessionIDs[1] {
		t.Fatalf("claim did not select only the active native cutover: %q %v", job.SessionID, err)
	}
	if _, err := repo.claimWhatsAppMediaJobForSessions(ctx, time.Minute, 4, scope); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("second claim selected an epoch-zero or inactive session: %v", err)
	}
}
