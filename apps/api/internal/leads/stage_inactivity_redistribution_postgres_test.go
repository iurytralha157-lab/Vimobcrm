package leads

import (
	"strings"
	"testing"
)

func TestStageInactivityRedistributionLocalPostgres(t *testing.T) {
	f := newAutomationStageFixture(t, "round_robins")
	queue, foreignQueue, recipient, follow := pipelinePostgresID(81), pipelinePostgresID(82), pipelinePostgresID(83), pipelinePostgresID(84)
	f.exec(t, `alter table public.round_robins add column if not exists deleted_at timestamptz;
 insert into public.round_robins(id,organization_id,name,is_active) values ($1,$3,'Synthetic rotation',true),($2,$4,'Foreign rotation',true);
 insert into public.users(id,organization_id,name,email,role) values ($5,$3,'Synthetic recipient','recipient@example.test','user');
 insert into public.stages(id,organization_id,pipeline_id,name,stage_key,is_won,is_lost)
 values ($6,$3,$7,'Follow-up','follow',false,false)`, queue, foreignQueue, f.org, pipelinePostgresID(99), recipient, follow, f.pipeline)
	f.exec(t, `create table private.inactivity_allocator_fixture(
   lead_id uuid primary key, result jsonb not null, invocations integer not null default 0);
 create function private.distribute_lead(uuid,uuid,text,uuid,boolean,text,timestamptz) returns jsonb
 language plpgsql as $$
 declare result jsonb;
 begin
   if $5 or $6 <> 'stage_inactivity' or $3 not like 'stage_inactivity:%' then
     raise exception 'expected explicit redistribution of an already-assigned lead';
   end if;
   update private.inactivity_allocator_fixture set invocations=invocations+1
   where lead_id=$2 returning inactivity_allocator_fixture.result into result;
   if not found then raise exception 'unexpected allocator call'; end if;
   update public.leads set assigned_user_id=(result->>'assigned_user_id')::uuid,
      stage_id=(result->>'stage_id')::uuid
   where organization_id=$1 and id=$2;
   return result || jsonb_build_object('round_robin_id',coalesce((result->>'round_robin_id')::uuid,$4));
 end $$;`)

	for index, test := range []struct {
		name, reason, resultQueue, assignedUser, stage, wantOutcome string
	}{
		{"commit new assignee and destination", "assigned", queue, recipient, follow, "redistributed"},
		{"rollback pooling while queue is closed", "queue_closed", queue, "", follow, "queue_unavailable"},
		{"rollback selection of same assignee", "assigned", queue, f.user, follow, "same_assignee"},
		{"rollback routing to another queue", "assigned", foreignQueue, recipient, follow, "queue_protected"},
		{"rollback terminal destination", "assigned", queue, recipient, f.won, "target_unavailable"},
	} {
		t.Run(test.name, func(t *testing.T) {
			id := pipelinePostgresID(500 + index)
			f.exec(t, `insert into public.leads(id,organization_id,name,source,deal_status,pipeline_id,stage_id,assigned_user_id)
 values ($1,$2,'Synthetic lead','manual','open',$3,$4,$5);
 insert into private.inactivity_allocator_fixture(lead_id,result)
 values($1,jsonb_build_object('reason',$6::text,'success',$6::text='assigned','round_robin_id',$7::uuid,
 'assigned_user_id',nullif($8::text,'')::uuid,'stage_id',$9::uuid,'pipeline_id',$3::uuid))`,
				id, f.org, f.pipeline, f.open, f.user, test.reason, test.resultQueue, test.assignedUser, test.stage)
			tx, err := f.db.Pool().Begin(f.ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback(f.ctx)
			outcome, err := f.repo.RedistributeLeadForStageInactivity(f.ctx, tx, f.resolver, StageInactivityRedistribution{
				OrganizationID: f.org, ActorID: f.user, LeadID: id, StageID: f.open,
				RoundRobinID: queue, AutomationID: pipelinePostgresID(90), EpisodeKey: strings.Repeat("a", 64),
			})
			if err != nil || outcome != test.wantOutcome {
				t.Fatalf("outcome = %q, %v", outcome, err)
			}
			if err := tx.Commit(f.ctx); err != nil {
				t.Fatal(err)
			}
			wantUser, wantStage, wantInvocations := f.user, f.open, 0
			if test.wantOutcome == "redistributed" {
				wantUser, wantStage, wantInvocations = recipient, follow, 1
			}
			var owner, stage string
			var invocations int
			if err := f.conn.QueryRow(f.ctx, `select l.assigned_user_id::text,l.stage_id::text,a.invocations
 from public.leads l join private.inactivity_allocator_fixture a on a.lead_id=l.id where l.id=$1`, id).Scan(&owner, &stage, &invocations); err != nil {
				t.Fatal(err)
			}
			if owner != wantUser || stage != wantStage || invocations != wantInvocations {
				t.Fatalf("effects = %s/%s, invocations=%d", owner, stage, invocations)
			}
		})
	}
}
