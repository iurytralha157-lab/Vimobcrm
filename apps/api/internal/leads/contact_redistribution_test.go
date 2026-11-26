package leads

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestContactRedistributionRequiresBothPermissions(t *testing.T) {
	for _, granted := range [][]string{nil, {permissions.LeadOperate}, {permissions.DistributionManage}} {
		request := httptest.NewRequest(http.MethodPost, "/v1/contacts/redistribute", nil)
		request = request.WithContext(tenant.ContextWithTenant(request.Context(), tenant.Context{
			OrganizationID: pipelinePostgresID(1), UserID: pipelinePostgresID(2), Permissions: granted,
		}))
		response := httptest.NewRecorder()
		(Handler{}).RedistributeContacts(response, request)
		if response.Code != http.StatusForbidden {
			t.Fatalf("permissions %v: got HTTP %d", granted, response.Code)
		}
	}
}

func TestContactRedistributionRequestOrderAndBounds(t *testing.T) {
	at := time.Date(2026, 11, 26, 0, 0, 0, 0, time.UTC)
	request := contactRedistributionRequest{RoundRobinID: pipelinePostgresID(1), OperationID: pipelinePostgresID(2)}
	for i := range maxContactRedistributionTargets {
		request.Targets = append(request.Targets, contactRedistributionTarget{pipelinePostgresID(100 + i), at})
	}
	initial, err := request.validate()
	if err != nil {
		t.Fatal(err)
	}
	request.Targets[0], request.Targets[1] = request.Targets[1], request.Targets[0]
	if reordered, err := request.validate(); err != nil || reordered == initial {
		t.Fatal("request digest must bind input order")
	}
	request.Targets[0] = request.Targets[1]
	if _, err := request.validate(); err == nil {
		t.Fatal("duplicate lead accepted")
	}
	request.Targets = append(request.Targets, contactRedistributionTarget{pipelinePostgresID(900), at})
	if _, err := request.validate(); err == nil {
		t.Fatal("oversized batch accepted")
	}
	request.Targets = []contactRedistributionTarget{{LeadID: pipelinePostgresID(100)}}
	if _, err := request.validate(); err == nil {
		t.Fatal("missing lead revision accepted")
	}
}

func TestContactRedistributionLocalPostgres(t *testing.T) {
	f := newAutomationStageFixture(t, "round_robins", "round_robin_members", "organization_attention_settings", "member_availability", "lead_entry_events")
	f.exec(t, `alter table public.round_robins add column if not exists deleted_at timestamptz;
		alter table public.round_robin_members add column if not exists membership_generation bigint default 1;
		create table private.lead_distribution_events(
			id uuid primary key default gen_random_uuid(), organization_id uuid not null, lead_id uuid not null,
			idempotency_key text not null, requested_round_robin_id uuid, round_robin_id uuid, assigned_user_id uuid,
			candidate_position bigint, source text not null, outcome text not null, result jsonb not null,
			created_at timestamptz not null, completed_at timestamptz not null, unique (organization_id, idempotency_key));
		create table private.queue_runtime_events(organization_id uuid, lead_id uuid, event_type text, metadata jsonb);
		create function private.prepare_queue_manual_transfer(uuid,uuid,uuid,uuid) returns boolean language sql as 'select true';
		create function private.queue_window(uuid,uuid,timestamptz) returns jsonb language sql as
			$$select jsonb_build_object('managed',false,'open',true)$$;
		create function private.queue_runtime_members(uuid,uuid,timestamptz)
			returns table(member_id uuid,user_id uuid,team_member_id uuid,"position" integer,is_available boolean)
			language sql as $$select null::uuid,null::uuid,null::uuid,0,false where false$$;
		create function private.synthetic_runtime_transfer() returns trigger language plpgsql as $$begin
			insert into private.queue_runtime_events values(new.organization_id,new.id,'manual_transfer',
				jsonb_build_object('history_transaction_id',txid_current()));
			return new; end$$;
		create trigger synthetic_runtime_transfer after update of assigned_user_id on public.leads
			for each row when (old.assigned_user_id is distinct from new.assigned_user_id)
			execute function private.synthetic_runtime_transfer();`)
	source, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "supabase", "migrations", "20261016031913_reconcile_legacy_rotation_with_queue_runtime.sql"))
	if err != nil {
		t.Fatal(err)
	}
	_, declaration, ok := strings.Cut(string(source), "create or replace function private.round_robin_rotation_candidates(")
	if !ok {
		t.Fatal("missing canonical legacy queue audience")
	}
	body, _, ok := strings.Cut(declaration, "$rotation_candidates$;")
	if !ok {
		t.Fatal("missing canonical legacy queue audience terminator")
	}
	f.exec(t, "create or replace function private.round_robin_rotation_candidates("+body+"$rotation_candidates$;")

	queueID, foreignOrg := pipelinePostgresID(80), pipelinePostgresID(99)
	f.exec(t, `insert into public.round_robins(id,organization_id,name,is_active,settings)
		values($1,$2,'Synthetic queue',true,'{"timezone":"Invalid/Legacy"}')`, queueID, f.org)
	recipients := make([]string, 4)
	for i := range recipients {
		recipients[i] = pipelinePostgresID(81 + i)
		f.exec(t, `insert into public.users(id,organization_id,name,email,role,is_active)
			values($1,$2,'Synthetic recipient','broker-'||$5::text||'@example.test','user',true);
			insert into public.organization_members(organization_id,user_id,role,is_active) values($2,$1,'user',true);
			insert into public.round_robin_members(id,organization_id,round_robin_id,user_id,position,is_active,membership_generation)
				values($3,$2,$4,$1,$5,true,1)`, recipients[i], f.org, pipelinePostgresID(90+i), queueID, i+1)
	}
	at := time.Date(2026, 11, 26, 12, 0, 0, 0, time.UTC)
	request := contactRedistributionRequest{RoundRobinID: queueID, OperationID: pipelinePostgresID(94)}
	leadIDs := make([]string, maxContactRedistributionTargets)
	expectedOwners := make([]string, len(leadIDs))
	for i := range leadIDs {
		leadID := pipelinePostgresID(110 + i)
		leadIDs[i], expectedOwners[i] = leadID, recipients[i%len(recipients)]
		request.Targets = append(request.Targets, contactRedistributionTarget{leadID, at})
	}
	f.exec(t, `insert into public.leads(id,organization_id,name,source,deal_status,pipeline_id,stage_id,assigned_user_id,updated_at)
		select id,$2::uuid,'Synthetic lead','manual','open',$3::uuid,$4::uuid,
			case when slot=5 then $5::uuid else $6::uuid end,$7::timestamptz
		from unnest($1::uuid[]) with ordinality as target(id,slot)`,
		leadIDs, f.org, f.pipeline, f.open, recipients[0], f.user, at)
	foreignLeadID := pipelinePostgresID(599)
	f.exec(t, `insert into public.leads(id,organization_id,name,source,deal_status,pipeline_id,stage_id,assigned_user_id,updated_at)
		values($1,$2,'Foreign lead','manual','open',$3,$4,$5,$6)`, foreignLeadID, foreignOrg, f.pipeline, f.open, f.user, at)
	actor, err := f.resolver.Resolve(f.ctx, f.user, f.org)
	if err != nil {
		t.Fatal(err)
	}
	run := func(request contactRedistributionRequest) contactRedistributionResult {
		t.Helper()
		digest, err := request.validate()
		if err != nil {
			t.Fatal(err)
		}
		result, err := f.repo.redistributeContacts(f.ctx, actor, request, digest)
		if err != nil {
			t.Fatal(err)
		}
		return result
	}
	startedAt := time.Now()
	result := run(request)
	t.Logf("%d ordered targets completed in %s (fixture setup excluded)", len(result.Items), time.Since(startedAt))
	for i, item := range result.Items {
		reason := "redistributed"
		if i == 4 {
			reason = "same_assignee"
		}
		if item.LeadID != leadIDs[i] || !item.Success || item.AssignedUserID != expectedOwners[i] || item.Reason != reason {
			t.Fatalf("slot %d outcome = %+v, want %s and %s", i, item, reason, expectedOwners[i])
		}
	}
	var verifiedLeads int
	if err := f.conn.QueryRow(f.ctx, `select count(*) from public.leads lead
		join unnest($1::uuid[], $2::uuid[]) expected(id,owner) on expected.id=lead.id and expected.owner=lead.assigned_user_id
		where lead.organization_id=$3::uuid and lead.stage_id=$4::uuid and lead.deal_status='open'`,
		leadIDs, expectedOwners, f.org, f.open).Scan(&verifiedLeads); err != nil || verifiedLeads != len(leadIDs) {
		t.Fatalf("leads retaining stage and status with expected assignee = %d, error = %v", verifiedLeads, err)
	}
	startedAt = time.Now()
	if replay := run(request); !reflect.DeepEqual(replay, result) {
		t.Fatalf("exact request replay differed: %+v", replay)
	}
	t.Logf("%d exact receipts replayed in %s", len(result.Items), time.Since(startedAt))
	conflict := contactRedistributionRequest{RoundRobinID: queueID, OperationID: request.OperationID,
		Targets: []contactRedistributionTarget{{pipelinePostgresID(500), at}}}
	if result := run(conflict); result.Items[0].Reason != "operation_conflict" {
		t.Fatal("confirmed operation was rebound to disjoint targets")
	}
	foreign := contactRedistributionRequest{RoundRobinID: queueID, OperationID: pipelinePostgresID(95),
		Targets: []contactRedistributionTarget{{foreignLeadID, at}}}
	if item := run(foreign).Items[0]; item.Success || item.Reason != "lead_unavailable" {
		t.Fatalf("foreign lead outcome = %+v", item)
	}
	transferCount := len(leadIDs) - 1
	if f.count(t, "private.lead_distribution_events") != len(leadIDs) || f.count(t, "public.assignments_log") != transferCount ||
		f.count(t, "private.realtime_events") != transferCount || f.count(t, "public.lead_entry_events") != 0 ||
		f.count(t, "public.notifications") != 0 {
		t.Fatal("success or replay produced unexpected history, receipt, or intake effects")
	}
	var namedLinkedTransfers int
	if err := f.conn.QueryRow(f.ctx, `select count(*) from public.assignments_log assignment
		join private.queue_runtime_events runtime on runtime.organization_id=assignment.organization_id
			and runtime.lead_id=assignment.lead_id and runtime.metadata->>'assignment_log_id'=assignment.id::text
		where assignment.created_by=$1 and assignment.reason=$2`, actor.UserID, manualQueueRedistribution).Scan(&namedLinkedTransfers); err != nil || namedLinkedTransfers != transferCount {
		t.Fatalf("linked actor history = %d, error = %v", namedLinkedTransfers, err)
	}
}
