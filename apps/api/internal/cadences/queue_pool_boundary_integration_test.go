package cadences

import (
	"context"
	"fmt"
	"net"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestQueuePoolCadenceAudienceAndClaimAgainstDatabase(t *testing.T) {
	ctx, postgres := openQueueCadenceTestDatabase(t)
	fixture := createQueuePoolCadenceFixture(t, ctx, postgres)
	foreign := createOperationalRulesFixture(t, ctx, postgres, "queue-pool-foreign")
	repository := NewRepository(postgres)
	for _, test := range []struct {
		name  string
		actor tenant.Context
		read  int
		write int
	}{
		{"administrator", fixture.tenantContext(), 200, 403},
		{"member", fixture.member, 200, 403},
		{"leader", fixture.leader, 200, 403},
		{"unrelated_global_reader", fixture.outsider, 404, 404},
		{"foreign_administrator", foreign.tenantContext(), 404, 404},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest("GET", "/v1/leads/"+fixture.leadID+"/cadence-state", nil)
			request.SetPathValue("id", fixture.leadID)
			request = request.WithContext(tenant.ContextWithTenant(ctx, test.actor))
			response := httptest.NewRecorder()
			NewHandler(repository).GetLeadCadenceState(response, request)
			if response.Code != test.read {
				t.Fatalf("read status=%d, want %d: %s", response.Code, test.read, response.Body.String())
			}
			response = switchPoolCadenceHTTP(ctx, repository, test.actor, fixture.leadID, fixture.templateID)
			if response.Code != test.write {
				t.Fatalf("unclaimed write status=%d, want %d: %s", response.Code, test.write, response.Body.String())
			}
		})
	}

	var revision int64
	var episode, claim string
	if err := postgres.Pool().QueryRow(ctx, `select revision,episode_id::text from private.queue_lead_runtime
		where organization_id=$1::uuid and lead_id=$2::uuid`, fixture.organizationID, fixture.leadID).Scan(&revision, &episode); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `select private.claim_queue_pool($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7)->>'success'`,
		fixture.organizationID, fixture.leadID, fixture.member.UserID, fixture.queueID, episode, revision, fixture.suffix+"-claim").Scan(&claim); err != nil || claim != "true" {
		t.Fatalf("legitimate member claim failed: success=%s error=%v", claim, err)
	}
	response := switchPoolCadenceHTTP(ctx, repository, fixture.member, fixture.leadID, fixture.templateID)
	if response.Code != 200 {
		t.Fatalf("claimed owner cannot switch cadence: %d %s", response.Code, response.Body.String())
	}
	if _, err := repository.GetLeadCadenceState(ctx, fixture.member, fixture.leadID); err != nil {
		t.Fatalf("claimed owner cannot read cadence: %v", err)
	}
	// Preserve ordinary non-queue behavior as well as the new claimed path.
	response = switchPoolCadenceHTTP(ctx, repository, fixture.tenantContext(), fixture.legacyLeadID, fixture.templateID)
	if response.Code != 200 {
		t.Fatalf("ordinary lead cadence behavior changed: %d %s", response.Code, response.Body.String())
	}
}

func TestSwitchLeadCadenceRechecksPoolAfterConcurrentCloseAgainstDatabase(t *testing.T) {
	ctx, postgres := openQueueCadenceTestDatabase(t)
	fixture := createQueuePoolCadenceFixture(t, ctx, postgres)
	if _, err := postgres.Pool().Exec(ctx, `update public.round_robins set settings=jsonb_set(settings,'{operating_schedule,days}',
		(select jsonb_agg(jsonb_build_object('day_of_week',n,'is_active',true,'is_all_day',true,'start_time',null,'end_time',null)) from generate_series(0,6)n))
		where organization_id=$1::uuid and id=$2::uuid`, fixture.organizationID, fixture.queueID); err != nil {
		t.Fatal(err)
	}
	var resumed bool
	if err := postgres.Pool().QueryRow(ctx, `select (private.distribute_lead($1::uuid,$2::uuid,$3,$4::uuid,false,'manual')->>'success')::boolean`,
		fixture.organizationID, fixture.leadID, fixture.suffix+"-resume", fixture.queueID).Scan(&resumed); err != nil || !resumed {
		t.Fatalf("canonical resume failed: success=%t error=%v", resumed, err)
	}
	holder, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer holder.Rollback(ctx)
	var holderPID int32
	if err := holder.QueryRow(ctx, `select pg_backend_pid()`).Scan(&holderPID); err != nil {
		t.Fatal(err)
	}
	if _, err := holder.Exec(ctx, `select id from public.round_robins where organization_id=$1::uuid and id=$2::uuid for share`, fixture.organizationID, fixture.queueID); err != nil {
		t.Fatal(err)
	}
	if _, err := holder.Exec(ctx, `select id from public.leads where organization_id=$1::uuid and id=$2::uuid for no key update`, fixture.organizationID, fixture.leadID); err != nil {
		t.Fatal(err)
	}
	if _, err := holder.Exec(ctx, `select private.queue_runtime_pool($1::uuid,$2::uuid,'queue_closed',clock_timestamp(),'{"open":false}'::jsonb)`, fixture.organizationID, fixture.leadID); err != nil {
		t.Fatal(err)
	}
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		done <- switchPoolCadenceHTTP(ctx, NewRepository(postgres), fixture.tenantContext(), fixture.leadID, fixture.templateID)
	}()
	deadline := time.Now().Add(10 * time.Second)
	waiting := false
	for time.Now().Before(deadline) {
		if err := postgres.Pool().QueryRow(ctx, `select exists(select 1 from pg_stat_activity
			where datname=current_database() and wait_event_type='Lock' and $1::int=any(pg_blocking_pids(pid)))`, holderPID).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !waiting {
		_ = holder.Rollback(ctx)
		<-done
		t.Fatal("the actual cadence command never waited on the closing lead")
	}
	if err := holder.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	response := <-done
	if response.Code != 403 {
		t.Fatalf("admin changed cadence after pool close without claim: %d %s", response.Code, response.Body.String())
	}
	var intact bool
	if err := postgres.Pool().QueryRow(ctx, `select r.state='pool_waiting' and l.assigned_user_id is null
		and not exists(select 1 from public.activities a where a.organization_id=l.organization_id and a.lead_id=l.id and a.type='cadence_switched')
		from public.leads l join private.queue_lead_runtime r on r.organization_id=l.organization_id and r.lead_id=l.id
		where l.organization_id=$1::uuid and l.id=$2::uuid`, fixture.organizationID, fixture.leadID).Scan(&intact); err != nil || !intact {
		t.Fatalf("rejected command changed cadence or pool ownership: intact=%t error=%v", intact, err)
	}
}

func openQueueCadenceTestDatabase(t *testing.T) (context.Context, *dbpkg.Postgres) {
	t.Helper()
	raw := strings.TrimSpace(os.Getenv("CADENCE_TEST_DATABASE_URL"))
	if raw == "" {
		t.Skip("CADENCE_TEST_DATABASE_URL is not set")
	}
	target, err := url.Parse(raw)
	if err != nil || (target.Scheme != "postgres" && target.Scheme != "postgresql") || !strings.HasPrefix(target.Path, "/vimob_") {
		t.Fatal("queue cadence tests require an explicitly selected disposable vimob_ database")
	}
	ip := net.ParseIP(target.Hostname())
	if target.Hostname() != "localhost" && (ip == nil || !ip.IsLoopback()) {
		t.Fatal("queue cadence tests require a loopback database")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	t.Cleanup(cancel)
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: raw, HealthTimeout: 10 * time.Second})
	if err != nil {
		t.Fatal("connect to explicitly selected local queue cadence database")
	}
	t.Cleanup(postgres.Close)
	var database string
	if err := postgres.Pool().QueryRow(ctx, `select current_database()`).Scan(&database); err != nil || database != strings.TrimPrefix(target.Path, "/") {
		t.Fatal("effective queue cadence database does not match the selected disposable target")
	}
	return ctx, postgres
}

func switchPoolCadenceHTTP(ctx context.Context, repository Repository, actor tenant.Context, leadID, templateID string) *httptest.ResponseRecorder {
	request := httptest.NewRequest("POST", "/v1/leads/"+leadID+"/cadence", strings.NewReader(fmt.Sprintf(`{"cadence_template_id":%q}`, templateID)))
	request.SetPathValue("id", leadID)
	request = request.WithContext(tenant.ContextWithTenant(ctx, actor))
	response := httptest.NewRecorder()
	NewHandler(repository).SwitchLeadCadence(response, request)
	return response
}

type queuePoolCadenceFixture struct {
	operationalRulesFixture
	queueID, leadID, templateID, legacyLeadID string
	member, outsider, leader                  tenant.Context
}

func createQueuePoolCadenceFixture(t *testing.T, ctx context.Context, postgres *dbpkg.Postgres) queuePoolCadenceFixture {
	t.Helper()
	fixture := queuePoolCadenceFixture{operationalRulesFixture: createOperationalRulesFixture(t, ctx, postgres, "queue-pool")}
	var extraIDs []string
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		for _, statement := range []string{
			`delete from public.leads where organization_id=$1::uuid`,
			`update public.users set organization_id=null where organization_id=$1::uuid`,
			`delete from public.organizations where id=$1::uuid`,
		} {
			if _, err := postgres.Pool().Exec(cleanup, statement, fixture.organizationID); err != nil {
				t.Errorf("cleanup queue cadence fixture: %v", err)
			}
		}
		for _, statement := range []string{`delete from public.users where id=any($1::uuid[])`, `delete from auth.users where id=any($1::uuid[])`} {
			if _, err := postgres.Pool().Exec(cleanup, statement, extraIDs); err != nil {
				t.Errorf("cleanup queue cadence actors: %v", err)
			}
		}
	})
	for _, actor := range []*tenant.Context{&fixture.member, &fixture.outsider, &fixture.leader} {
		if err := postgres.Pool().QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&actor.UserID); err != nil {
			t.Fatal(err)
		}
		extraIDs = append(extraIDs, actor.UserID)
		actor.OrganizationID, actor.UserRole, actor.MemberRole = fixture.organizationID, "user", "user"
		actor.Permissions = []string{permissions.LeadViewOwn, permissions.LeadOperate}
		email := actor.UserID + "@example.invalid"
		if _, err := postgres.Pool().Exec(ctx, `insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
			values($1::uuid,'authenticated','authenticated',$2,'',now(),'{}','{}')`, actor.UserID, email); err != nil {
			t.Fatal(err)
		}
		if _, err := postgres.Pool().Exec(ctx, `insert into public.users(id,organization_id,name,email,role,is_active)
			values($1::uuid,$2::uuid,'Queue cadence synthetic actor',$3,'user',true)
			on conflict(id) do update set organization_id=excluded.organization_id,is_active=true`, actor.UserID, fixture.organizationID, email); err != nil {
			t.Fatal(err)
		}
		if _, err := postgres.Pool().Exec(ctx, `insert into public.organization_members(organization_id,user_id,role,is_active)
			values($1::uuid,$2::uuid,'user',true) on conflict(organization_id,user_id) do update set is_active=true`, fixture.organizationID, actor.UserID); err != nil {
			t.Fatal(err)
		}
	}
	fixture.outsider.Permissions = append(fixture.outsider.Permissions, permissions.LeadViewAll)
	fixture.leader.Permissions = append(fixture.leader.Permissions, permissions.LeadViewTeam)
	var teamID string
	if err := postgres.Pool().QueryRow(ctx, `insert into public.teams(organization_id,name,is_active) values($1::uuid,$2,true) returning id::text`, fixture.organizationID, fixture.suffix).Scan(&teamID); err != nil {
		t.Fatal(err)
	}
	for _, actor := range []tenant.Context{fixture.member, fixture.leader} {
		if _, err := postgres.Pool().Exec(ctx, `insert into public.team_members(organization_id,team_id,user_id,is_active,is_leader)
			values($1::uuid,$2::uuid,$3::uuid,true,$4)`, fixture.organizationID, teamID, actor.UserID, actor.UserID == fixture.leader.UserID); err != nil {
			t.Fatal(err)
		}
	}
	fixture.legacyLeadID, _, _ = createOperationalCadenceLead(t, ctx, postgres, fixture.operationalRulesFixture, []bool{false})
	rules, err := NewRepository(postgres).GetOperationalRules(ctx, fixture.tenantContext(), fixture.stageID)
	if err != nil || rules.Cadence.TemplateID == nil {
		t.Fatalf("queue cadence template unavailable: %v", err)
	}
	fixture.templateID = *rules.Cadence.TemplateID
	if err := postgres.Pool().QueryRow(ctx, `insert into public.round_robins(organization_id,name,strategy,pipeline_id,target_pipeline_id,target_stage_id,settings)
		select $1::uuid,$2,'simple',$3::uuid,$3::uuid,$4::uuid,jsonb_build_object('enable_redistribution',true,'redistribution_timeout_minutes',1,
		'redistribution_warning_minutes',0,'redistribution_max_attempts',0,'pool_notifications',jsonb_build_object('enabled',false),
		'operating_schedule',jsonb_build_object('version',1,'timezone','UTC','days',(select jsonb_agg(jsonb_build_object('day_of_week',n,
		'is_active',false,'is_all_day',false,'start_time',null,'end_time',null)) from generate_series(0,6)n))) returning id::text`,
		fixture.organizationID, fixture.suffix, fixture.pipelineID, fixture.stageID).Scan(&fixture.queueID); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `insert into public.round_robin_members(organization_id,round_robin_id,user_id,position,is_active)
		values($1::uuid,$2::uuid,$3::uuid,1,true)`, fixture.organizationID, fixture.queueID, fixture.member.UserID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `insert into public.leads(organization_id,name,source,pipeline_id,stage_id,origin_round_robin_id,metadata)
		values($1::uuid,$2,'manual',$3::uuid,$4::uuid,$5::uuid,'{"distribution_deferred":true}') returning id::text`,
		fixture.organizationID, fixture.suffix, fixture.pipelineID, fixture.stageID, fixture.queueID).Scan(&fixture.leadID); err != nil {
		t.Fatal(err)
	}
	var outcome string
	if err := postgres.Pool().QueryRow(ctx, `select private.distribute_lead($1::uuid,$2::uuid,$3,$4::uuid,false,'manual')->>'reason'`,
		fixture.organizationID, fixture.leadID, fixture.suffix+"-initial", fixture.queueID).Scan(&outcome); err != nil || outcome != "queue_closed" {
		t.Fatalf("canonical pool fixture failed: outcome=%s error=%v", outcome, err)
	}
	return fixture
}
