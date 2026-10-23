package leads

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestQueuePoolPatchRechecksAfterClosingLockAgainstPostgres(t *testing.T) {
	f := newQueuePostLockFixture(t)
	holder, err := f.db.Pool().Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer holder.Rollback(f.ctx)
	var holderPID int32
	if err := holder.QueryRow(f.ctx, `select pg_backend_pid()`).Scan(&holderPID); err != nil {
		t.Fatal(err)
	}
	if _, err := holder.Exec(f.ctx, `select id from public.round_robins where organization_id=$1::uuid and id=$2::uuid for share`, f.org, f.queue); err != nil {
		t.Fatal(err)
	}
	if _, err := holder.Exec(f.ctx, `select id from public.leads where organization_id=$1::uuid and id=$2::uuid for no key update`, f.org, f.lead); err != nil {
		t.Fatal(err)
	}
	if _, err := holder.Exec(f.ctx, `select private.queue_runtime_pool($1::uuid,$2::uuid,'queue_closed',clock_timestamp(),'{"open":false}'::jsonb)`, f.org, f.lead); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest("PATCH", "/v1/leads/"+f.lead, strings.NewReader(`{"message":"Queue post-lock rejected patch"}`))
	request.SetPathValue("id", f.lead)
	request = request.WithContext(tenant.ContextWithTenant(f.ctx, f.actor))
	response := httptest.NewRecorder()
	done := make(chan struct{})
	go func() { NewHandler(f.repo).Update(response, request); close(done) }()
	waiting := false
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if err := f.db.Pool().QueryRow(f.ctx, `select exists(select 1 from pg_stat_activity
			where datname=current_database() and wait_event_type='Lock' and $1::int=any(pg_blocking_pids(pid))
			and query like '%for no key update of l%')`, holderPID).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !waiting {
		_ = holder.Rollback(f.ctx)
		<-done
		t.Fatal("actual PATCH did not prove a lock wait before the close committed")
	}
	if err := holder.Commit(f.ctx); err != nil {
		t.Fatal(err)
	}
	<-done
	if response.Code != 409 {
		t.Fatalf("pool PATCH status=%d, want409: %s", response.Code, response.Body.String())
	}
	var intact bool
	if err := f.db.Pool().QueryRow(f.ctx, `select r.state='pool_waiting' and l.assigned_user_id is null and l.message is null
		and not exists(select 1 from private.queue_pool_claim_receipts c where c.organization_id=l.organization_id and c.lead_id=l.id)
		and not exists(select 1 from public.audit_logs a where a.organization_id=l.organization_id and a.entity_id=l.id::text
		  and a.new_data->>'message'='Queue post-lock rejected patch')
		from public.leads l join private.queue_lead_runtime r on r.organization_id=l.organization_id and r.lead_id=l.id
		where l.organization_id=$1::uuid and l.id=$2::uuid`, f.org, f.lead).Scan(&intact); err != nil || !intact {
		t.Fatalf("rejected PATCH changed pooled data or left side effects: intact=%t error=%v", intact, err)
	}
}

func TestQueuePoolRelatedMutationsRequireClaimAgainstPostgres(t *testing.T) {
	f := newQueuePostLockFixture(t)
	f.closePool(t)
	note := "Rejected pool task note"
	if _, err := f.repo.CreateLeadTask(f.ctx, f.actor, leadTaskCreateInput{LeadID: f.lead, Type: "note", Title: "Rejected pool task"}); !errors.Is(err, ErrQueuePoolConflict) {
		t.Fatalf("unclaimed task creation error=%v, want pool conflict", err)
	}
	if _, err := f.repo.PatchLeadTask(f.ctx, f.actor, f.task, LeadTaskPatchRequest{OutcomeNotes: &note}); !errors.Is(err, ErrQueuePoolConflict) {
		t.Fatalf("unclaimed task edit error=%v, want pool conflict", err)
	}
	first := recordFirstResponseInput{LeadID: f.lead, Channel: "manual", ActorUserID: f.actor.UserID}
	if _, err := f.repo.RecordFirstResponse(f.ctx, f.actor, first); !errors.Is(err, ErrQueuePoolConflict) {
		t.Fatalf("unclaimed first response error=%v, want pool conflict", err)
	}
	tx, err := f.db.Pool().Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	err = lockAttachmentLeadResources(f.ctx, tx, f.actor, f.lead, f.lead)
	_ = tx.Rollback(f.ctx)
	if !errors.Is(err, ErrQueuePoolConflict) {
		t.Fatalf("unclaimed attachment resource error=%v, want pool conflict", err)
	}
	var unchanged bool
	if err := f.db.Pool().QueryRow(f.ctx, `select first_response_at is null
		and (select count(*)=1 from public.lead_tasks where organization_id=$1::uuid and lead_id=$2::uuid)
		and exists(select 1 from public.lead_tasks where id=$3::uuid and outcome_notes is null and not is_done)
		from public.leads where organization_id=$1::uuid and id=$2::uuid`, f.org, f.lead, f.task).Scan(&unchanged); err != nil || !unchanged {
		t.Fatalf("unclaimed related writes left changes: unchanged=%t error=%v", unchanged, err)
	}
	f.claim(t)
	if result, err := f.repo.RecordFirstResponse(f.ctx, f.actor, first); err != nil || result["recorded"] != true {
		t.Fatalf("claimed first response failed: result=%v error=%v", result, err)
	}
	created, err := f.repo.CreateLeadTask(f.ctx, f.actor, leadTaskCreateInput{LeadID: f.lead, Type: "note", Title: "Claimed task"})
	if err != nil {
		t.Fatalf("claimed task creation failed: %v", err)
	}
	done, note := true, "Claimed task completed"
	updated, err := f.repo.PatchLeadTask(f.ctx, f.actor, created.ID, LeadTaskPatchRequest{IsDone: &done, OutcomeNotes: &note})
	if err != nil || updated.IsDone == nil || !*updated.IsDone {
		t.Fatalf("claimed task completion failed: task=%+v error=%v", updated, err)
	}
	var activities int
	if err := f.db.Pool().QueryRow(f.ctx, `select count(*)::int from public.activities where organization_id=$1::uuid and lead_id=$2::uuid
		and type='task_completed' and metadata->>'task_id'=$3`, f.org, f.lead, created.ID).Scan(&activities); err != nil || activities != 1 {
		t.Fatalf("task completion did not commit exactly one activity: count=%d error=%v", activities, err)
	}
	tx, err = f.db.Pool().Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	err = lockAttachmentLeadResources(f.ctx, tx, f.actor, f.lead, f.lead)
	_ = tx.Rollback(f.ctx)
	if err != nil {
		t.Fatalf("claimed attachment resource rejected: %v", err)
	}
}

type queuePostLockFixture struct {
	ctx                           context.Context
	db                            *dbpkg.Postgres
	repo                          Repository
	actor                         tenant.Context
	org, queue, lead, task, stage string
}

func newQueuePostLockFixture(t *testing.T) queuePostLockFixture {
	t.Helper()
	raw := strings.TrimSpace(os.Getenv("QUEUE_POOL_TEST_DATABASE_URL"))
	if raw == "" || os.Getenv("VIMOB_RUN_QUEUE_POOL_DB_TESTS") != "LOCAL_WRITE_TEST" {
		t.Skip("requires QUEUE_POOL_TEST_DATABASE_URL and VIMOB_RUN_QUEUE_POOL_DB_TESTS=LOCAL_WRITE_TEST")
	}
	target, err := url.Parse(raw)
	if err != nil || (target.Scheme != "postgres" && target.Scheme != "postgresql") || !strings.HasPrefix(target.Path, "/vimob_") {
		t.Fatal("queue post-lock tests require an explicitly selected disposable vimob_ database")
	}
	ip := net.ParseIP(target.Hostname())
	if target.Hostname() != "localhost" && (ip == nil || !ip.IsLoopback()) {
		t.Fatal("queue post-lock tests require a loopback database")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	t.Cleanup(cancel)
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: raw, MaxConns: 6, HealthTimeout: 10 * time.Second})
	if err != nil {
		t.Fatal("connect to explicitly selected local queue post-lock database")
	}
	t.Cleanup(database.Close)
	var actual string
	if err := database.Pool().QueryRow(ctx, `select current_database()`).Scan(&actual); err != nil || actual != strings.TrimPrefix(target.Path, "/") {
		t.Fatal("queue post-lock database differs from selected disposable target")
	}
	f := queuePostLockFixture{ctx: ctx, db: database, repo: NewRepository(database, nil)}
	var user, pipeline string
	if err := database.Pool().QueryRow(ctx, `select gen_random_uuid()::text,gen_random_uuid()::text,gen_random_uuid()::text,
		gen_random_uuid()::text,gen_random_uuid()::text,gen_random_uuid()::text`).Scan(&f.org, &user, &pipeline, &f.stage, &f.queue, &f.lead); err != nil {
		t.Fatal(err)
	}
	f.actor = tenant.Context{OrganizationID: f.org, UserID: user, UserRole: "admin", MemberRole: "admin"}
	t.Cleanup(func() {
		cleanup, stop := context.WithTimeout(context.Background(), 20*time.Second)
		defer stop()
		for _, statement := range []string{`delete from public.leads where organization_id=$1::uuid`, `update public.users set organization_id=null where organization_id=$1::uuid`, `delete from public.organizations where id=$1::uuid`} {
			if _, err := database.Pool().Exec(cleanup, statement, f.org); err != nil {
				t.Errorf("cleanup post-lock fixture: %v", err)
			}
		}
		for _, statement := range []string{`delete from public.users where id=$1::uuid`, `delete from auth.users where id=$1::uuid`} {
			if _, err := database.Pool().Exec(cleanup, statement, user); err != nil {
				t.Errorf("cleanup post-lock identity: %v", err)
			}
		}
	})
	name := fmt.Sprintf("queue-post-lock-%d", time.Now().UnixNano())
	for _, operation := range []struct {
		sql  string
		args []any
	}{
		{`insert into public.organizations(id,name,slug,is_active) values($1::uuid,$2,$2,true)`, []any{f.org, name}},
		{`insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values($1::uuid,'authenticated','authenticated',$2,'',now(),'{}','{}')`, []any{user, name + "@example.invalid"}},
		{`insert into public.users(id,organization_id,name,email,role,is_active) values($1::uuid,$2::uuid,$3,$4,'admin',true) on conflict(id) do update set organization_id=excluded.organization_id,role='admin',is_active=true`, []any{user, f.org, name, name + "@example.invalid"}},
		{`insert into public.organization_members(organization_id,user_id,role,is_active) values($1::uuid,$2::uuid,'admin',true) on conflict(organization_id,user_id) do update set role='admin',is_active=true`, []any{f.org, user}},
		{`insert into public.pipelines(id,organization_id,name,is_active) values($1::uuid,$2::uuid,$3,true)`, []any{pipeline, f.org, name}},
		{`insert into public.stages(id,organization_id,pipeline_id,name,stage_key,position,is_active) values($1::uuid,$2::uuid,$3::uuid,$4,$4,1,true)`, []any{f.stage, f.org, pipeline, name}},
		{`insert into public.round_robins(id,organization_id,name,strategy,pipeline_id,target_pipeline_id,target_stage_id,settings)
		 select $1::uuid,$2::uuid,$3,'simple',$4::uuid,$4::uuid,$5::uuid,jsonb_build_object('enable_redistribution',true,'redistribution_timeout_minutes',1,
		 'redistribution_warning_minutes',0,'redistribution_max_attempts',0,'pool_notifications',jsonb_build_object('enabled',false),'operating_schedule',jsonb_build_object('version',1,'timezone','UTC',
		 'days',(select jsonb_agg(jsonb_build_object('day_of_week',n,'is_active',true,'is_all_day',true,'start_time',null,'end_time',null)) from generate_series(0,6)n)))`, []any{f.queue, f.org, name, pipeline, f.stage}},
		{`insert into public.round_robin_members(organization_id,round_robin_id,user_id,position,is_active) values($1::uuid,$2::uuid,$3::uuid,1,true)`, []any{f.org, f.queue, user}},
		{`insert into public.leads(id,organization_id,name,source,pipeline_id,stage_id,origin_round_robin_id,metadata) values($1::uuid,$2::uuid,$3,'manual',$4::uuid,$5::uuid,$6::uuid,'{"distribution_deferred":true}')`, []any{f.lead, f.org, name, pipeline, f.stage, f.queue}},
	} {
		if _, err := database.Pool().Exec(ctx, operation.sql, operation.args...); err != nil {
			t.Fatal(err)
		}
	}
	var assigned bool
	if err := database.Pool().QueryRow(ctx, `select (private.distribute_lead($1::uuid,$2::uuid,$3,$4::uuid,false,'manual')->>'success')::boolean`, f.org, f.lead, name, f.queue).Scan(&assigned); err != nil || !assigned {
		t.Fatalf("canonical post-lock fixture assignment: assigned=%t error=%v", assigned, err)
	}
	task, err := f.repo.CreateLeadTask(ctx, f.actor, leadTaskCreateInput{LeadID: f.lead, Type: "note", Title: "Task before pooling"})
	if err != nil {
		t.Fatal(err)
	}
	f.task = task.ID
	return f
}

func (f queuePostLockFixture) closePool(t *testing.T) {
	t.Helper()
	tx, err := f.db.Pool().Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(f.ctx)
	for _, operation := range []struct{ sql, id string }{
		{`select id from public.round_robins where organization_id=$1::uuid and id=$2::uuid for share`, f.queue},
		{`select id from public.leads where organization_id=$1::uuid and id=$2::uuid for no key update`, f.lead},
		{`select private.queue_runtime_pool($1::uuid,$2::uuid,'queue_closed',clock_timestamp(),'{"open":false}'::jsonb)`, f.lead},
	} {
		if _, err := tx.Exec(f.ctx, operation.sql, f.org, operation.id); err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.Commit(f.ctx); err != nil {
		t.Fatal(err)
	}
}

func (f queuePostLockFixture) claim(t *testing.T) {
	t.Helper()
	var claimed bool
	if err := f.db.Pool().QueryRow(f.ctx, `select (private.claim_queue_pool($1::uuid,$2::uuid,$3::uuid,$4::uuid,r.episode_id,r.revision,$5)->>'success')::boolean
		from private.queue_lead_runtime r where r.organization_id=$1::uuid and r.lead_id=$2::uuid`, f.org, f.lead, f.actor.UserID, f.queue, "post-lock-claim:"+f.lead).Scan(&claimed); err != nil || !claimed {
		t.Fatalf("legitimate post-lock claim failed: claimed=%t error=%v", claimed, err)
	}
}
