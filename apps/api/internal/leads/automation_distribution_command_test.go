package leads

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func TestAutomationDistributionCommandRejectsUnboundAuthority(t *testing.T) {
	input := validAutomationStageInput()
	distribution := strings.TrimSuffix(input.EffectKey, ":move_lead") + ":distribute_lead"
	body, _ := json.Marshal(input)
	calls := 0
	handler := AutomationDistributionCommandHandler{AutomationStageCommandHandler{
		token: "synthetic-token",
		execute: func(_ context.Context, received automationStageCommand) (automationStageResponse, error) {
			calls++
			if received.EffectKey != distribution {
				t.Fatal("wrong command identity")
			}
			return automationStageResponse{OK: true}, nil
		},
	}}
	for _, scenario := range []struct {
		token, body string
		status      int
	}{
		{"", strings.ReplaceAll(string(body), input.EffectKey, distribution), 401},
		{"synthetic-token", string(body), 400},
		{"synthetic-token", strings.ReplaceAll(strings.TrimSuffix(string(body), "}"), input.EffectKey, distribution) + `,"roundRobinId":"forged"}`, 400},
		{"synthetic-token", strings.ReplaceAll(string(body), input.EffectKey, distribution), 200},
	} {
		request := httptest.NewRequest(http.MethodPost, "/v1/internal/automations/distribution-command", strings.NewReader(scenario.body))
		request.Header.Set("X-Internal-Token", scenario.token)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != scenario.status {
			t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
		}
	}
	if calls != 1 {
		t.Fatalf("handler calls = %d, expected only bound command", calls)
	}
}

func TestAutomationDistributionCommandLocalPostgres(t *testing.T) {
	f := newAutomationStageFixture(t, "round_robins")
	queue, foreign, recipient, follow := pipelinePostgresID(81), pipelinePostgresID(82), pipelinePostgresID(83), pipelinePostgresID(84)
	f.exec(t, `alter table public.round_robins add column if not exists deleted_at timestamptz;
 insert into public.round_robins(id,organization_id,name,is_active) values ($1,$3,'Synthetic rotation',true),($2,$4,'Foreign rotation',true);
 insert into public.users(id,organization_id,name,email,role) values ($5,$3,'Synthetic recipient','recipient@example.test','user');
 insert into public.stages(id,organization_id,pipeline_id,name,stage_key,is_won,is_lost)
 values ($6,$3,$7,'Follow-up','follow',false,false)`, queue, foreign, f.org, pipelinePostgresID(99), recipient, follow, f.pipeline)
	f.exec(t, `create table private.visual_distribution_fixture(lead_id uuid primary key, result jsonb not null, invocations integer not null default 0);
 create function private.distribute_lead(uuid,uuid,text,uuid,boolean,text,timestamptz) returns jsonb
 language plpgsql as $$
 declare result jsonb;
 begin
   if $5 or $6 <> 'automation' or $3 not like 'automation:%' then
     raise exception 'expected a scoped automation handoff';
   end if;
   update private.visual_distribution_fixture set invocations=invocations+1 where lead_id=$2
   returning visual_distribution_fixture.result into result;
   if not found then raise exception 'unexpected allocator call'; end if;
   update public.leads set assigned_user_id=(result->>'assigned_user_id')::uuid,stage_id=(result->>'stage_id')::uuid
   where organization_id=$1 and id=$2;
   return result || jsonb_build_object('round_robin_id',coalesce((result->>'round_robin_id')::uuid,$4));
 end $$;`)

	for index, scenario := range []struct {
		name, requestedQueue, selectedQueue, user, stage, reason, wantCode string
		protected, changesOwner                                            bool
	}{
		{"commit once across concurrent and stale-lease acknowledgement", queue, queue, recipient, follow, "assigned", "", false, false},
		{"rollback an attempted assignment to an unintended queue", queue, foreign, recipient, follow, "assigned", "automation_queue_protected", false, false},
		{"rollback attempted pooling when the queue is closed", queue, queue, "", follow, "queue_closed", "automation_queue_unavailable", false, false},
		{"rollback selecting the current owner", queue, queue, f.user, follow, "assigned", "automation_queue_same_owner", false, false},
		{"rollback moving to a terminal column", queue, queue, recipient, f.won, "assigned", "automation_queue_destination_unavailable", false, false},
		{"foreign queue never reaches the allocator", foreign, foreign, recipient, follow, "assigned", "automation_queue_unavailable", false, false},
		{"protected WhatsApp lead never reaches the allocator", queue, queue, recipient, follow, "assigned", "automation_queue_protected", true, false},
		{"rollback when a column rule overrides the resulting owner", queue, queue, recipient, follow, "assigned", "automation_queue_protected", false, true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			n := 500 + index
			id, version := pipelinePostgresID(n), pipelinePostgresID(2000+n)
			input := f.command(t, n, f.open, nil)
			input.EffectKey = strings.TrimSuffix(input.EffectKey, ":move_lead") + ":distribute_lead"
			f.exec(t, `update public.automation_flow_versions set graph=jsonb_build_object('nodes',jsonb_build_array(jsonb_build_object(
 'id','stage-node','type','action','action_type','distribute_lead','config',jsonb_build_object('round_robin_id',$2::uuid)))) where id=$1;
 insert into private.visual_distribution_fixture(lead_id,result)
 values($3,jsonb_build_object('reason',$4::text,'success',$4::text='assigned','round_robin_id',$5::uuid,
 'assigned_user_id',nullif($6::text,'')::uuid,'stage_id',$7::uuid,'pipeline_id',$8::uuid))`,
				version, scenario.requestedQueue, id, scenario.reason, scenario.selectedQueue, scenario.user, scenario.stage, f.pipeline)
			if scenario.protected {
				f.exec(t, `update public.leads set metadata='{"managed_whatsapp_message_distribution":true}' where id=$1`, id)
			}
			if scenario.changesOwner {
				f.exec(t, `create function private.keep_original_owner() returns trigger language plpgsql as $$
 begin new.assigned_user_id = old.assigned_user_id; return new; end $$;
 create trigger synthetic_column_override before update of assigned_user_id on public.leads
 for each row execute function private.keep_original_owner();`)
			}
			run := func(input automationStageCommand) (automationStageResponse, error) {
				return f.repo.executeAutomationDistributionCommand(f.ctx, f.resolver, input)
			}
			first, err := run(input)
			wantOwner, wantStage, wantEffects := f.user, f.open, 0
			if scenario.wantCode != "" {
				var rejection *automationCommandError
				if !errors.As(err, &rejection) || rejection.Code != scenario.wantCode {
					t.Fatalf("rejection=%v, want %s", err, scenario.wantCode)
				}
			} else {
				if err != nil || !first.OK || first.EffectID == "" {
					t.Fatalf("result=%+v error=%v", first, err)
				}
				wantOwner, wantStage, wantEffects = recipient, follow, 1
				stale := input
				stale.LeaseToken = "stale-lease"
				var concurrent sync.WaitGroup
				for range 2 {
					concurrent.Add(1)
					go func() {
						defer concurrent.Done()
						replay, err := run(stale)
						if err != nil || replay.EffectID != first.EffectID {
							t.Errorf("replay=%+v error=%v", replay, err)
						}
					}()
				}
				concurrent.Wait()
			}
			var owner, stage string
			var invocations, effects, realtime int
			if err := f.conn.QueryRow(f.ctx, `select l.assigned_user_id::text,l.stage_id::text,a.invocations,
 (select count(*) from public.automation_effect_dispatches d where d.effect_key=$2 and d.status='succeeded'),
 (select count(*) from private.realtime_events r where r.organization_id=l.organization_id and r.data->>'leadId'=l.id::text)
 from public.leads l join private.visual_distribution_fixture a on a.lead_id=l.id where l.id=$1`, id, input.EffectKey).Scan(&owner, &stage, &invocations, &effects, &realtime); err != nil {
				t.Fatal(err)
			}
			if owner != wantOwner || stage != wantStage || invocations != wantEffects || effects != wantEffects || realtime != wantEffects {
				t.Fatalf("lead=%s/%s allocation=%d effects=%d realtime=%d", owner, stage, invocations, effects, realtime)
			}
		})
	}
}
