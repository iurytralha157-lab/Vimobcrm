package leads

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/distribution"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// These use the real HTTP handler and canonical queue SQL. The shared fixture
// requires LOCAL_WRITE_TEST, a loopback URL and an explicitly disposable DB.
func TestQueuePoolReentryRequiresClaimAgainstPostgres(t *testing.T) {
	for _, state := range []string{"pool_waiting", "pool_ready", "limit_exhausted"} {
		for _, mode := range []string{"manual", "import", "keyed_import"} {
			t.Run(state+"/"+mode, func(t *testing.T) {
				f := newQueuePostLockFixture(t)
				request := queueReentryRequest(t, f, mode)
				member := queueReentryActor(t, f, true)
				outside := queueReentryActor(t, f, false)
				queueReentryPool(t, f, state)
				for _, actor := range []struct {
					name   string
					ctx    tenant.Context
					status int
					code   string
				}{
					{"admin", f.actor, http.StatusConflict, "queue_pool_changed"},
					{"member", member, http.StatusConflict, "queue_pool_changed"},
					{"outside", outside, http.StatusNotFound, "lead_not_found"},
				} {
					t.Run(actor.name, func(t *testing.T) {
						var access *bool
						if err := f.db.Pool().QueryRow(f.ctx, `select private.queue_pool_read_access($1::uuid,$2::uuid,$3::uuid)`, f.org, f.lead, actor.ctx.UserID).Scan(&access); err != nil || access == nil || *access != (actor.name != "outside") {
							t.Fatalf("real pool audience mismatch: access=%v error=%v", access, err)
						}
						before := queueReentryFingerprint(t, f, f.db.Pool())
						response := queueReentryPost(t, f, actor.ctx, request)
						queueReentryExpectError(t, response, actor.status, actor.code)
						if after := queueReentryFingerprint(t, f, f.db.Pool()); after != before {
							t.Fatalf("rejected %s left lead, runtime, history, binding, tag, notification or receipt effects", mode)
						}
					})
				}
				// A real claim grants the normal reentry contract. Also prove that a
				// normal queue member can claim and use the manual creation endpoint.
				if mode == "manual" {
					f.actor = member
				}
				f.claim(t)
				response := queueReentryPost(t, f, f.actor, request)
				queueReentryExpectSuccess(t, f, response, request)
				if mode == "keyed_import" {
					before := queueReentryFingerprint(t, f, f.db.Pool())
					replay := queueReentryPost(t, f, f.actor, request)
					queueReentryExpectSuccess(t, f, replay, request)
					if after := queueReentryFingerprint(t, f, f.db.Pool()); after != before {
						t.Fatal("completed keyed import replay changed lead or emitted duplicate effects")
					}
				}
			})
		}
	}
}

func TestQueuePoolReentryRechecksAfterClosingLockAgainstPostgres(t *testing.T) {
	for _, mode := range []string{"manual", "keyed_import"} {
		t.Run(mode, func(t *testing.T) {
			f := newQueuePostLockFixture(t)
			request := queueReentryRequest(t, f, mode)
			holder, err := f.db.Pool().Begin(f.ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer holder.Rollback(f.ctx)
			var holderPID int32
			if err := holder.QueryRow(f.ctx, `select pg_backend_pid()`).Scan(&holderPID); err != nil {
				t.Fatal(err)
			}
			for _, operation := range []struct{ sql, id string }{
				{`select id from public.round_robins where organization_id=$1::uuid and id=$2::uuid for share`, f.queue},
				{`select id from public.leads where organization_id=$1::uuid and id=$2::uuid for no key update`, f.lead},
				{`select private.queue_runtime_pool($1::uuid,$2::uuid,'queue_closed',clock_timestamp(),'{"open":false}'::jsonb)`, f.lead},
			} {
				if _, err := holder.Exec(f.ctx, operation.sql, f.org, operation.id); err != nil {
					t.Fatal(err)
				}
			}
			before := queueReentryFingerprint(t, f, holder)
			response := httptest.NewRecorder()
			httpRequest := queueReentryHTTP(t, f, f.actor, request)
			done := make(chan struct{})
			go func() { NewHandler(f.repo).Create(response, httpRequest); close(done) }()
			waiting := false
			deadline := time.Now().Add(10 * time.Second)
			for time.Now().Before(deadline) {
				if err := f.db.Pool().QueryRow(f.ctx, `select exists(select 1 from pg_stat_activity where datname=current_database()
					and wait_event_type='Lock' and $1::int=any(pg_blocking_pids(pid)))`, holderPID).Scan(&waiting); err != nil {
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
				t.Fatalf("actual %s POST did not wait on the concurrent close: status=%d", mode, response.Code)
			}
			if err := holder.Commit(f.ctx); err != nil {
				t.Fatal(err)
			}
			select {
			case <-done:
			case <-time.After(15 * time.Second):
				t.Fatal("manual/import reentry did not finish after the proven closing lock was released")
			}
			queueReentryExpectError(t, response, http.StatusConflict, "queue_pool_changed")
			if after := queueReentryFingerprint(t, f, f.db.Pool()); after != before {
				t.Fatal("post-lock rejection left effects beyond the legitimate queue close")
			}
		})
	}
}

func TestQueuePoolReentryKeepsTenantIdentityAgainstPostgres(t *testing.T) {
	a, b := newQueuePostLockFixture(t), newQueuePostLockFixture(t)
	requestA := queueReentryRequest(t, a, "manual")
	requestB := queueReentryRequest(t, b, "keyed_import")
	requestB.Phone = requestA.Phone
	if _, err := b.db.Pool().Exec(b.ctx, `update public.leads set phone=$3 where organization_id=$1::uuid and id=$2::uuid`, b.org, b.lead, requestB.Phone); err != nil {
		t.Fatal(err)
	}
	queueReentryPool(t, a, "pool_waiting")
	queueReentryPool(t, b, "pool_waiting")
	beforeA, beforeB := queueReentryFingerprint(t, a, a.db.Pool()), queueReentryFingerprint(t, b, b.db.Pool())
	queueReentryExpectError(t, queueReentryPost(t, a, a.actor, requestA), http.StatusConflict, "queue_pool_changed")
	queueReentryExpectError(t, queueReentryPost(t, b, b.actor, requestB), http.StatusConflict, "queue_pool_changed")
	if queueReentryFingerprint(t, a, a.db.Pool()) != beforeA || queueReentryFingerprint(t, b, b.db.Pool()) != beforeB {
		t.Fatal("same phone in separate tenants changed an unclaimed lead")
	}
	b.claim(t)
	queueReentryExpectSuccess(t, b, queueReentryPost(t, b, b.actor, requestB), requestB)
	if queueReentryFingerprint(t, a, a.db.Pool()) != beforeA {
		t.Fatal("successful claimed import changed the other tenant's same-phone pool lead")
	}
}

func TestQueuePoolReentryTrustedIntakeStillAssignsAgainstPostgres(t *testing.T) {
	f := newQueuePostLockFixture(t)
	request := queueReentryRequest(t, f, "manual")
	f.closePool(t)
	var control string
	if err := f.db.Pool().QueryRow(f.ctx, `insert into public.leads(organization_id,name,phone,source,pipeline_id,stage_id,origin_round_robin_id,metadata)
		values($1::uuid,'Independent trusted intake',$2,'meta_ads',$3::uuid,$4::uuid,$5::uuid,'{"distribution_deferred":true}') returning id::text`,
		f.org, fmt.Sprintf("55119%08d", (time.Now().UnixNano()+1)%100000000), request.PipelineID, f.stage, f.queue).Scan(&control); err != nil {
		t.Fatal(err)
	}
	source := "meta_ads"
	result, err := distribution.Distribute(f.ctx, f.db.Pool(), distribution.Request{OrganizationID: f.org, LeadID: control,
		IdempotencyKey: distribution.StableKey("reentry-pool-trusted-control", control), RoundRobinID: &f.queue,
		RoundRobinResolved: true, Source: &source, OccurredAt: time.Now().UTC()})
	if err != nil || !result.Success || result.Reason != "assigned" || result.AssignedUserID == nil || *result.AssignedUserID != f.actor.UserID {
		t.Fatalf("independent canonical intake failed: result=%+v error=%v", result, err)
	}
	var correct bool
	if err := f.db.Pool().QueryRow(f.ctx, `select r.state='auto_assigned' and l.assigned_user_id=$3::uuid
		and exists(select 1 from private.queue_lead_runtime old join public.leads pooled on pooled.id=old.lead_id and pooled.organization_id=old.organization_id
		 where old.organization_id=$1::uuid and old.lead_id=$4::uuid and old.state='pool_waiting' and pooled.assigned_user_id is null)
		and not exists(select 1 from private.queue_pool_claim_receipts where organization_id=$1::uuid)
		from public.leads l join private.queue_lead_runtime r on r.organization_id=l.organization_id and r.lead_id=l.id
		where l.organization_id=$1::uuid and l.id=$2::uuid`, f.org, control, f.actor.UserID, f.lead).Scan(&correct); err != nil || !correct {
		t.Fatalf("trusted intake must assign its own new lead without claiming or moving the old pool: correct=%t error=%v", correct, err)
	}
}

func queueReentryRequest(t *testing.T, f queuePostLockFixture, mode string) CreateRequest {
	t.Helper()
	phone := fmt.Sprintf("55119%08d", time.Now().UnixNano()%100000000)
	var pipeline, key string
	if err := f.db.Pool().QueryRow(f.ctx, `update public.leads set phone=$3 where organization_id=$1::uuid and id=$2::uuid returning pipeline_id::text,gen_random_uuid()::text`, f.org, f.lead, phone).Scan(&pipeline, &key); err != nil {
		t.Fatal(err)
	}
	if _, err := f.db.Pool().Exec(f.ctx, `update public.round_robins set reentry_behavior='keep_assignee' where organization_id=$1::uuid and id=$2::uuid`, f.org, f.queue); err != nil {
		t.Fatal(err)
	}
	auto := true
	request := CreateRequest{Name: "Claimed reentry contact", Phone: phone, Source: "manual", Message: "Reentry must require a real claim", Email: "reentry@example.invalid",
		PipelineID: pipeline, StageID: f.stage, RoundRobinID: f.queue, AutoDistribute: &auto, ImportMode: mode != "manual"}
	if mode == "keyed_import" {
		request.ImportRequestKey = key
	}
	if _, err := request.Validate(); err != nil {
		t.Fatalf("test must satisfy the actual creation contract: %v", err)
	}
	return request
}

func queueReentryPool(t *testing.T, f queuePostLockFixture, state string) {
	t.Helper()
	reason, window := "queue_closed", `{"open":false}`
	if state == "pool_ready" {
		reason, window = "no_available_members", `{"open":true}`
	} else if state == "limit_exhausted" {
		reason = "queue_limit_reached"
	}
	tx, err := f.db.Pool().Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(f.ctx)
	for _, operation := range []struct {
		sql  string
		args []any
	}{
		{`select id from public.round_robins where organization_id=$1::uuid and id=$2::uuid for share`, []any{f.org, f.queue}},
		{`select id from public.leads where organization_id=$1::uuid and id=$2::uuid for no key update`, []any{f.org, f.lead}},
		{`select private.queue_runtime_pool($1::uuid,$2::uuid,$3,clock_timestamp(),$4::jsonb)`, []any{f.org, f.lead, reason, window}},
	} {
		if _, err := tx.Exec(f.ctx, operation.sql, operation.args...); err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.Commit(f.ctx); err != nil {
		t.Fatal(err)
	}
	var correct bool
	if err := f.db.Pool().QueryRow(f.ctx, `select r.state=$3 and l.assigned_user_id is null from private.queue_lead_runtime r join public.leads l
		on l.organization_id=r.organization_id and l.id=r.lead_id where r.organization_id=$1::uuid and r.lead_id=$2::uuid`, f.org, f.lead, state).Scan(&correct); err != nil || !correct {
		t.Fatalf("canonical pool transition did not produce %s: correct=%t error=%v", state, correct, err)
	}
}

func queueReentryActor(t *testing.T, f queuePostLockFixture, inQueue bool) tenant.Context {
	t.Helper()
	var user string
	if err := f.db.Pool().QueryRow(f.ctx, `select gen_random_uuid()::text`).Scan(&user); err != nil {
		t.Fatal(err)
	}
	email := "reentry-" + user + "@example.invalid"
	for _, operation := range []struct {
		sql  string
		args []any
	}{
		{`insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values($1::uuid,'authenticated','authenticated',$2,'',now(),'{}','{}')`, []any{user, email}},
		{`insert into public.users(id,organization_id,name,email,role,is_active) values($1::uuid,$2::uuid,'Reentry test member',$3,'user',true) on conflict(id) do update set organization_id=excluded.organization_id,role='user',is_active=true`, []any{user, f.org, email}},
		{`insert into public.organization_members(organization_id,user_id,role,is_active) values($1::uuid,$2::uuid,'user',true) on conflict(organization_id,user_id) do update set role='user',is_active=true`, []any{f.org, user}},
	} {
		if _, err := f.db.Pool().Exec(f.ctx, operation.sql, operation.args...); err != nil {
			t.Fatal(err)
		}
	}
	// Remove synthetic leads before identities to respect actor/owner FKs.
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		for _, operation := range []struct {
			sql  string
			args []any
		}{
			{`delete from public.leads where organization_id=$1::uuid`, []any{f.org}},
			{`delete from public.round_robin_members where organization_id=$1::uuid and user_id=$2::uuid`, []any{f.org, user}},
			{`delete from public.organization_members where organization_id=$1::uuid and user_id=$2::uuid`, []any{f.org, user}},
			{`delete from public.users where id=$1::uuid`, []any{user}},
			{`delete from auth.users where id=$1::uuid`, []any{user}},
		} {
			if _, err := f.db.Pool().Exec(ctx, operation.sql, operation.args...); err != nil {
				t.Errorf("cleanup synthetic reentry identity: %v", err)
			}
		}
	})
	if inQueue {
		if _, err := f.db.Pool().Exec(f.ctx, `insert into public.round_robin_members(organization_id,round_robin_id,user_id,position,is_active) values($1::uuid,$2::uuid,$3::uuid,2,true)`, f.org, f.queue, user); err != nil {
			t.Fatal(err)
		}
	}
	return tenant.Context{OrganizationID: f.org, UserID: user, UserRole: "user", MemberRole: "user", Permissions: []string{
		permissions.LeadViewAll, permissions.LeadOperate, permissions.LeadCreate, permissions.LeadImport, permissions.DistributionManage,
	}}
}

func queueReentryHTTP(t *testing.T, f queuePostLockFixture, actor tenant.Context, request CreateRequest) *http.Request {
	t.Helper()
	raw, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	httpRequest := httptest.NewRequest(http.MethodPost, "/v1/leads", strings.NewReader(string(raw)))
	return httpRequest.WithContext(tenant.ContextWithTenant(f.ctx, actor))
}

func queueReentryPost(t *testing.T, f queuePostLockFixture, actor tenant.Context, request CreateRequest) *httptest.ResponseRecorder {
	t.Helper()
	response := httptest.NewRecorder()
	NewHandler(f.repo).Create(response, queueReentryHTTP(t, f, actor, request))
	return response
}

func queueReentryExpectError(t *testing.T, response *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	if response.Code != status || !strings.Contains(response.Body.String(), `"code":"`+code+`"`) {
		t.Fatalf("creation status=%d body=%s, want %d/%s", response.Code, response.Body.String(), status, code)
	}
}

func queueReentryExpectSuccess(t *testing.T, f queuePostLockFixture, response *httptest.ResponseRecorder, request CreateRequest) {
	t.Helper()
	var result CreateResponse
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || response.Code != http.StatusCreated || !result.Reentry || result.LeadID != f.lead || !result.LeadVisible || result.Data == nil {
		t.Fatalf("claimed reentry failed: status=%d error=%v body=%s", response.Code, err, response.Body.String())
	}
	var correct bool
	if err := f.db.Pool().QueryRow(f.ctx, `select l.name=$3 and l.message=$4 and l.email=$5 and l.assigned_user_id=$6::uuid and l.reentry_count=1
		and r.state='manual_protected' and (select count(*)=1 from private.queue_pool_claim_receipts c where c.organization_id=l.organization_id and c.lead_id=l.id)
		and (select count(*)=1 from public.lead_entry_events e where e.organization_id=l.organization_id and e.lead_id=l.id and e.entry_type='reentry')
		and (select count(*)=1 from public.activities a where a.organization_id=l.organization_id and a.lead_id=l.id and a.type='lead_reentry')
		and exists(select 1 from public.lead_entry_events e join public.activities a
		 on a.organization_id=e.organization_id and a.lead_id=e.lead_id and a.metadata->>'entry_event_id'=e.id::text
		 where e.organization_id=l.organization_id and e.lead_id=l.id and e.entry_type='reentry'
		 and a.type='lead_reentry' and a.metadata->>'entry_type'='manual_reentry' and a.user_id=$6::uuid)
		from public.leads l join private.queue_lead_runtime r on r.organization_id=l.organization_id and r.lead_id=l.id
		where l.organization_id=$1::uuid and l.id=$2::uuid`, f.org, f.lead, request.Name, request.Message, request.Email, f.actor.UserID).Scan(&correct); err != nil || !correct {
		t.Fatalf("claimed reentry lost owner/protection, contact changes or exact-once correlated history: correct=%t error=%v", correct, err)
	}
}

func queueReentryFingerprint(t *testing.T, f queuePostLockFixture, queryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}) string {
	t.Helper()
	var parts []string
	// Only this fixed test allowlist is interpolated. Every value is parameterized.
	for _, table := range []string{"public.leads", "public.lead_entry_events", "public.activities", "public.notifications", "public.audit_logs", "public.lead_tags", "public.whatsapp_conversations", "public.whatsapp_messages", "public.whatsapp_conversation_lead_bindings", "private.whatsapp_unlinked_history_links", "private.whatsapp_unlinked_promotion_authorizations", "private.queue_lead_runtime", "private.queue_runtime_events", "private.queue_runtime_commands", "private.queue_round_visits", "private.queue_pool_claim_receipts", "private.contact_import_request_receipts"} {
		parts = append(parts, fmt.Sprintf("'%s',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from %s x where organization_id=$1::uuid)", table, table))
	}
	var snapshot string
	if err := queryer.QueryRow(f.ctx, "select jsonb_build_object("+strings.Join(parts, ",")+")::text", f.org).Scan(&snapshot); err != nil {
		t.Fatal(err)
	}
	return fmt.Sprintf("%x", sha256.Sum256([]byte(snapshot)))
}
