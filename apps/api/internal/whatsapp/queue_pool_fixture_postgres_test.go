package whatsapp

import (
	"context"
	"fmt"
	"net"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func openWhatsAppQueuePoolDatabase(t *testing.T, ctx context.Context) *dbpkg.Postgres {
	t.Helper()
	raw := strings.TrimSpace(os.Getenv("QUEUE_POOL_TEST_DATABASE_URL"))
	if raw == "" || os.Getenv("VIMOB_RUN_QUEUE_POOL_DB_TESTS") != "LOCAL_WRITE_TEST" {
		t.Skip("requires verified disposable QUEUE_POOL_TEST_DATABASE_URL and VIMOB_RUN_QUEUE_POOL_DB_TESTS=LOCAL_WRITE_TEST")
	}
	target, err := url.Parse(raw)
	if err != nil || (target.Scheme != "postgres" && target.Scheme != "postgresql") || !strings.HasPrefix(target.Path, "/vimob_") {
		t.Fatal("WhatsApp pool tests require a disposable vimob_ PostgreSQL database")
	}
	ip := net.ParseIP(target.Hostname())
	if target.Hostname() != "localhost" && (ip == nil || !ip.IsLoopback()) {
		t.Fatal("WhatsApp pool tests require a loopback database")
	}
	db, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: raw, MaxConns: 6, HealthTimeout: 10 * time.Second})
	if err != nil {
		t.Fatal("connect to explicitly selected disposable WhatsApp pool database")
	}
	t.Cleanup(db.Close)
	var actual string
	if err := db.Pool().QueryRow(ctx, `select current_database()`).Scan(&actual); err != nil || actual != strings.TrimPrefix(target.Path, "/") {
		t.Fatal("WhatsApp pool database differs from the selected target")
	}
	return db
}

type whatsAppPoolFixture struct {
	sessionConversationLockFixture
	queueID string
}

func newWhatsAppPoolFixture(t *testing.T, ctx context.Context, pool *pgxpool.Pool, label, actorKind string) whatsAppPoolFixture {
	t.Helper()
	f := whatsAppPoolFixture{sessionConversationLockFixture: createSessionConversationLockFixture(t, ctx, pool, "pool-"+label)}
	t.Cleanup(func() { cleanupSessionConversationLockFixture(t, pool, f.sessionConversationLockFixture) })
	// Queue private history has no cascading FK; remove only this fixture's
	// rows. Retention/history links precede message and conversation deletion.
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		for _, table := range []string{
			"private.whatsapp_unlinked_history_links", "private.whatsapp_unlinked_promotion_authorizations",
			"public.whatsapp_attendance_marker_confirmations", "public.lead_timeline_events", "public.whatsapp_outbox", "public.whatsapp_messages", "public.whatsapp_attendance_entries",
			"private.queue_pool_claim_receipts", "private.queue_runtime_events", "private.queue_runtime_commands", "private.realtime_events",
		} {
			if _, err := pool.Exec(cleanup, "delete from "+table+" where organization_id=$1::uuid", f.organizationID); err != nil {
				t.Errorf("cleanup WhatsApp pool %s: %v", table, err)
			}
		}
	})
	var pipelineID, stageID string
	if err := pool.QueryRow(ctx, `select gen_random_uuid()::text,gen_random_uuid()::text`).Scan(&pipelineID, &stageID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `insert into public.pipelines(id,organization_id,name,is_active) values($1::uuid,$2::uuid,$3,true);
	 insert into public.stages(id,organization_id,pipeline_id,name,stage_key,position,is_active) values($4::uuid,$2::uuid,$1::uuid,$3,$3,1,true)`,
		pipelineID, f.organizationID, f.suffix, stageID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `insert into public.round_robins(organization_id,name,strategy,is_active,pipeline_id,target_pipeline_id,target_stage_id,settings)
	 select $1::uuid,$2,'simple',true,$3::uuid,$3::uuid,$4::uuid,jsonb_build_object('enable_redistribution',true,'redistribution_timeout_minutes',10,
	 'redistribution_warning_minutes',0,'pool_notifications',jsonb_build_object('enabled',false),
	 'operating_schedule',jsonb_build_object('version',1,'timezone','UTC','days',
	 (select jsonb_agg(jsonb_build_object('day_of_week',d,'is_active',true,'is_all_day',true,'start_time',null,'end_time',null)) from generate_series(0,6)d)))
	 returning id::text`, f.organizationID, f.suffix, pipelineID, stageID).Scan(&f.queueID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `insert into public.round_robin_members(organization_id,round_robin_id,user_id,position,is_active) values($1::uuid,$2::uuid,$3::uuid,1,true)`, f.organizationID, f.queueID, f.userID); err != nil {
		t.Fatal(err)
	}
	// Intake identity is immutable. Keep the legacy helper's own lead for its
	// ordinary organization cleanup and create the managed card in its queue
	// scope from the outset, without disabling any trigger or rewriting origin.
	// The full schema intentionally retains UNIQUE(org, normalize_phone(phone))
	// until its separate cutover. Release only this fixture's legacy contact
	// phone; org/origin/scope stay unchanged and the physical chat keeps its PN.
	var legacyContactReleased bool
	if err := pool.QueryRow(ctx, `update public.leads set phone=null where organization_id=$1::uuid and id=$2::uuid
	 and origin_round_robin_id is null and intake_scope_key='unscoped'
	 returning phone is null and origin_round_robin_id is null and intake_scope_key='unscoped'`, f.organizationID, f.leadID).Scan(&legacyContactReleased); err != nil || !legacyContactReleased {
		t.Fatalf("release only the own legacy contact phone without changing intake identity: released=%t error=%v", legacyContactReleased, err)
	}
	if err := pool.QueryRow(ctx, `insert into public.leads(organization_id,name,phone,source,origin_round_robin_id,intake_scope_key,pipeline_id,stage_id,metadata)
	 values($1::uuid,$2,$3,'manual',$4::uuid,'queue:'||$4::uuid::text,$5::uuid,$6::uuid,'{"distribution_deferred":true}') returning id::text`,
		f.organizationID, f.suffix+"-managed", f.phone, f.queueID, pipelineID, stageID).Scan(&f.leadID); err != nil {
		t.Fatal(err)
	}
	var assigned bool
	if err := pool.QueryRow(ctx, `select (private.distribute_lead($1::uuid,$2::uuid,$3,$4::uuid,false,'manual')->>'success')::boolean`, f.organizationID, f.leadID, f.suffix, f.queueID).Scan(&assigned); err != nil || !assigned {
		t.Fatalf("canonical WhatsApp pool fixture assignment: assigned=%t error=%v", assigned, err)
	}
	var validManagedLead bool
	if err := pool.QueryRow(ctx, `select lead.assigned_user_id=$3::uuid and runtime.state='auto_assigned' and runtime.last_user_id=lead.assigned_user_id
	 and lead.pipeline_id=$5::uuid and lead.stage_id=$6::uuid and lead.origin_round_robin_id=$4::uuid and lead.intake_scope_key='queue:'||$4::uuid::text
	 and queue.pipeline_id=lead.pipeline_id and queue.target_pipeline_id=lead.pipeline_id and queue.target_stage_id=lead.stage_id
	 from public.leads lead join private.queue_lead_runtime runtime on runtime.organization_id=lead.organization_id and runtime.lead_id=lead.id
	 join public.round_robins queue on queue.organization_id=lead.organization_id and queue.id=runtime.round_robin_id
	 where lead.organization_id=$1::uuid and lead.id=$2::uuid`, f.organizationID, f.leadID, f.userID, f.queueID, pipelineID, stageID).Scan(&validManagedLead); err != nil || !validManagedLead {
		t.Fatalf("managed fixture lost canonical owner/runtime, immutable intake or destination: valid=%t error=%v", validManagedLead, err)
	}
	if _, err := pool.Exec(ctx, `select public.activate_whatsapp_conversation_lead_binding($1::uuid,$2::uuid,$3::uuid,null)`, f.organizationID, f.conversationID, f.leadID); err != nil {
		t.Fatal(err)
	}
	if actorKind != "admin" {
		if _, err := pool.Exec(ctx, `update public.users set role='user' where id=$1::uuid;
		 update public.organization_members set role='user' where organization_id=$2::uuid and user_id=$1::uuid`, f.userID, f.organizationID); err != nil {
			t.Fatal(err)
		}
		f.tenant.UserRole, f.tenant.MemberRole = "user", "user"
		f.tenant.Permissions = []string{"*"}
		deepReadRole(t, ctx, pool, f.sessionConversationLockFixture)
	}
	if actorKind == "outside" || actorKind == "leader" {
		if _, err := pool.Exec(ctx, `delete from public.round_robin_members where organization_id=$1::uuid and round_robin_id=$2::uuid`, f.organizationID, f.queueID); err != nil {
			t.Fatal(err)
		}
	}
	if actorKind == "leader" {
		addWhatsAppPoolLedMember(t, ctx, pool, f)
	}
	if _, err := pool.Exec(ctx, `update public.whatsapp_sessions set phone_number='5511888877777' where organization_id=$1::uuid and id=$2::uuid`, f.organizationID, f.sessionID); err != nil {
		t.Fatal(err)
	}
	return f
}

func newWhatsAppPoolReactionTarget(t *testing.T, ctx context.Context, pool *pgxpool.Pool, f whatsAppPoolFixture) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(ctx, `insert into public.whatsapp_messages(organization_id,conversation_id,session_id,lead_id,
	 message_id,provider_message_id,remote_jid,from_me,direction,message_type,content,status,capture_state,sent_at)
	 values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$5,$6,false,'inbound','text','Synthetic reaction target','received','captured',clock_timestamp())
	 returning id::text`, f.organizationID, f.conversationID, f.sessionID, f.leadID, f.suffix+"-target", f.remoteJID).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func addWhatsAppPoolLedMember(t *testing.T, ctx context.Context, pool *pgxpool.Pool, f whatsAppPoolFixture) {
	t.Helper()
	var member, team string
	if err := pool.QueryRow(ctx, `select gen_random_uuid()::text,gen_random_uuid()::text`).Scan(&member, &team); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
	 values($1::uuid,'authenticated','authenticated',$2,'',now(),'{}','{}');
	 insert into public.users(id,organization_id,name,email,role,is_active) values($1::uuid,$3::uuid,'Synthetic queue member',$2,'user',true)
	 on conflict(id) do update set organization_id=excluded.organization_id,role='user',is_active=true;
	 insert into public.organization_members(organization_id,user_id,role,is_active) values($3::uuid,$1::uuid,'user',true)
	 on conflict(organization_id,user_id) do update set role='user',is_active=true;
	 insert into public.teams(id,organization_id,name,is_active) values($4::uuid,$3::uuid,'Synthetic led team',true);
	 insert into public.team_members(organization_id,team_id,user_id,is_active,is_leader)
	 values($3::uuid,$4::uuid,$1::uuid,true,false),($3::uuid,$4::uuid,$5::uuid,true,true);
	 insert into public.round_robin_members(organization_id,round_robin_id,user_id,position,is_active)
	 values($3::uuid,$6::uuid,$1::uuid,1,true)`, member, member+"@example.invalid", f.organizationID, team, f.userID, f.queueID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if _, err := pool.Exec(cleanup, `delete from public.round_robin_members where organization_id=$1::uuid and user_id=$2::uuid;
		 delete from public.teams where organization_id=$1::uuid and id=$3::uuid;
		 delete from public.organization_members where organization_id=$1::uuid and user_id=$2::uuid;
		 delete from public.users where id=$2::uuid;delete from auth.users where id=$2::uuid`, f.organizationID, member, team); err != nil {
			t.Error(err)
		}
	})
}

func putWhatsAppLeadInPool(t *testing.T, ctx context.Context, queryer interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}, f whatsAppPoolFixture, state string) {
	t.Helper()
	reason, window := "queue_closed", `{"open":false}`
	if state == "pool_ready" {
		reason, window = "no_available_members", `{"open":true}`
	} else if state == "limit_exhausted" {
		reason = "queue_limit_reached"
	}
	if _, err := queryer.Exec(ctx, `select private.queue_runtime_pool($1::uuid,$2::uuid,$3,clock_timestamp(),$4::jsonb)`, f.organizationID, f.leadID, reason, window); err != nil {
		t.Fatal(err)
	}
	var correct bool
	if err := queryer.QueryRow(ctx, `select runtime.state=$3 and lead.assigned_user_id is null
	 from private.queue_lead_runtime runtime join public.leads lead on lead.organization_id=runtime.organization_id and lead.id=runtime.lead_id
	 where runtime.organization_id=$1::uuid and runtime.lead_id=$2::uuid`, f.organizationID, f.leadID, state).Scan(&correct); err != nil || !correct {
		t.Fatalf("canonical pool transition did not produce %s with no owner: correct=%t error=%v", state, correct, err)
	}
}

func claimWhatsAppPool(t *testing.T, ctx context.Context, pool *pgxpool.Pool, f whatsAppPoolFixture) {
	t.Helper()
	var success bool
	if err := pool.QueryRow(ctx, `select (private.claim_queue_pool($1::uuid,$2::uuid,$3::uuid,$4::uuid,r.episode_id,r.revision,$5)->>'success')::boolean
	 from private.queue_lead_runtime r where r.organization_id=$1::uuid and r.lead_id=$2::uuid`, f.organizationID, f.leadID, f.userID, f.queueID, "whatsapp-pool-claim:"+f.leadID).Scan(&success); err != nil || !success {
		t.Fatalf("actual queue claim failed: success=%t error=%v", success, err)
	}
}

func whatsAppPoolFingerprint(t *testing.T, ctx context.Context, pool *pgxpool.Pool, org string) string {
	t.Helper()
	parts := []string{}
	for _, table := range []string{"public.leads", "public.whatsapp_conversations", "public.whatsapp_conversation_lead_bindings", "public.whatsapp_attendance_entries", "public.whatsapp_messages", "public.whatsapp_outbox", "public.lead_timeline_events", "private.queue_lead_runtime", "private.queue_runtime_events", "private.queue_pool_claim_receipts"} {
		parts = append(parts, fmt.Sprintf("'%s',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') from %s x where organization_id=$1::uuid)", table, table))
	}
	var fingerprint string
	if err := pool.QueryRow(ctx, "select md5(jsonb_build_object("+strings.Join(parts, ",")+")::text)", org).Scan(&fingerprint); err != nil {
		t.Fatal(err)
	}
	return fingerprint
}

func waitWhatsAppPoolLeadLock(t *testing.T, ctx context.Context, pool *pgxpool.Pool, holderPID int, leadID string) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		var waiting bool
		// The long visibility predicate can put the trailing FOR SHARE beyond
		// pg_stat_activity's track_activity_query_size. Match those exact two
		// repository SELECT prefixes too, while requiring this lead UUID and an
		// actual Lock wait directly blocked by our lead-lock holder's backend.
		if err := pool.QueryRow(ctx, `select exists(select 1 from pg_stat_activity a where a.datname=current_database()
		 and a.wait_event_type='Lock' and $1=any(pg_blocking_pids(a.pid)) and a.query ilike '%public.leads%'
		 and a.query ilike '%'||$2::text||'%'
		 and (a.query ilike '%for share%' or a.query ilike '%for update%' or a.query ilike '%for no key update%'
		 or a.query ilike '%select l.id::text, coalesce(l.assigned_user_id%'
		 or a.query ilike '%select true, coalesce(l.assigned_user_id%'))`, holderPID, leadID).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("operation did not reach its actual lead lock wait")
}

// Warm distinct connections before the holder so Docker stdio connection
// startup is not mistaken for waiting on the PostgreSQL row lock.
func warmWhatsAppPoolConnections(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()
	var connections []*pgxpool.Conn
	defer func() {
		for _, connection := range connections {
			connection.Release()
		}
	}()
	identities := map[int]bool{}
	for range 3 {
		connection, err := pool.Acquire(ctx)
		if err != nil {
			t.Fatal(err)
		}
		connections = append(connections, connection)
		var pid int
		if err := connection.QueryRow(ctx, `select pg_backend_pid()`).Scan(&pid); err != nil || identities[pid] {
			t.Fatalf("warm distinct connection: %v", err)
		}
		identities[pid] = true
	}
}
