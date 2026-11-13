package leads

import (
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"sync"
	"testing"
)

func TestAutomationStageCommandLocalPostgres(t *testing.T) {
	f := newAutomationStageFixture(t, "commissions", "financial_entries")
	run := func(input automationStageCommand) (automationStageResponse, error) {
		return f.repo.executeAutomationStageCommand(f.ctx, f.resolver, input)
	}
	mustRun := func(t *testing.T, input automationStageCommand) automationStageResponse {
		t.Helper()
		result, err := run(input)
		if err != nil {
			t.Fatalf("canonical command: %v", err)
		}
		if !result.OK || result.Status != "succeeded" || result.EffectID == "" {
			t.Fatal("incomplete success")
		}
		return result
	}
	assertNoEffects := func(t *testing.T) {
		t.Helper()
		for _, table := range []string{"public.automation_effect_dispatches", "public.events", "public.notifications", "public.activities", "public.audit_logs", "private.realtime_events"} {
			if f.count(t, table) != 0 {
				t.Fatalf("rejected command produced %s", table)
			}
		}
	}
	assertCode := func(t *testing.T, err error, code string) {
		t.Helper()
		var classified *automationCommandError
		if !errors.As(err, &classified) || classified.Code != code {
			t.Fatalf("error=%v, want %s", err, code)
		}
	}

	t.Run("tenant cancellation lease review module and current author fences", func(t *testing.T) {
		input := f.command(t, 100, f.open, nil)
		foreign := input
		foreign.OrganizationID = pipelinePostgresID(99)
		_, err := run(foreign)
		assertCode(t, err, "automation_execution_not_running")
		stale := input
		stale.LeaseToken = "previous-lease"
		_, err = run(stale)
		assertCode(t, err, "automation_lease_changed")
		t.Run("execution without a lead is a business rejection", func(t *testing.T) {
			f.exec(t, `update public.automation_executions set lead_id=null where id=$1::uuid`, input.ExecutionID)
			defer f.exec(t, `update public.automation_executions set lead_id=$2::uuid where id=$1::uuid`, input.ExecutionID, pipelinePostgresID(100))
			_, err := run(input)
			assertCode(t, err, "automation_lead_required")
			assertNoEffects(t)
		})
		// Populate the normal resolver's cache first: the command must still read
		// the current grants/overrides from its own transaction after revocation.
		if _, err := f.resolver.Resolve(f.ctx, f.user, f.org); err != nil {
			t.Fatal(err)
		}
		t.Run("revoked permission bypasses stale cache", func(t *testing.T) {
			f.exec(t, `update public.organization_members set role='user';insert into public.user_permission_overrides(organization_id,user_id,permission_key,allowed) values($1,$2,'lead_operate',false)`, f.org, f.user)
			defer f.exec(t, `delete from public.user_permission_overrides;update public.organization_members set role='admin'`)
			_, err := run(input)
			assertCode(t, err, "automation_actor_forbidden")
			assertNoEffects(t)
		})
		t.Run("foreign destination and pipeline mismatch", func(t *testing.T) {
			foreignStage := pipelinePostgresID(90)
			f.exec(t, `insert into public.stages(id,organization_id,pipeline_id,name,stage_key) values($1,$2,$3,'Foreign','foreign')`, foreignStage, pipelinePostgresID(99), f.pipeline)
			wrongStage := f.command(t, 102, foreignStage, nil)
			if _, err := run(wrongStage); !errors.Is(err, ErrInvalidReference) {
				t.Fatalf("foreign stage=%v", err)
			}
			wrongPipeline := f.command(t, 103, f.open, nil)
			f.exec(t, `update public.automation_flow_versions set graph=jsonb_set(graph,'{nodes,0,config,pipeline_id}',to_jsonb($1::text)) where id=$2::uuid`, pipelinePostgresID(91), pipelinePostgresID(2103))
			_, err := run(wrongPipeline)
			assertCode(t, err, "automation_destination_mismatch")
			assertNoEffects(t)
		})
		for _, test := range []struct{ name, change, restore, code string }{
			{"cancellation", `update public.automation_executions set cancellation_requested_at=now()`, `update public.automation_executions set cancellation_requested_at=null`, "automation_execution_not_running"},
			{"review", `update public.automation_flow_versions set requires_review=true`, `update public.automation_flow_versions set requires_review=false`, "automation_execution_not_running"},
			{"inactive flow", `update public.automations set is_active=false`, `update public.automations set is_active=true`, "automation_execution_not_running"},
			{"module", `update public.organization_modules set is_enabled=false`, `update public.organization_modules set is_enabled=true`, "automation_module_disabled"},
			{"inactive author", `update public.users set is_active=false`, `update public.users set is_active=true`, "automation_actor_forbidden"},
			{"removed member", `update public.organization_members set is_active=false`, `update public.organization_members set is_active=true`, "automation_actor_forbidden"},
			{"billing", `update public.organizations set subscription_status='overdue'`, `update public.organizations set subscription_status='active'`, "automation_actor_forbidden"},
		} {
			t.Run(test.name, func(t *testing.T) {
				f.exec(t, test.change)
				defer f.exec(t, test.restore)
				_, err := run(input)
				assertCode(t, err, test.code)
				assertNoEffects(t)
			})
		}
		assertNoEffects(t)
	})

	t.Run("reservation history notification and ledger rollback together then replay once", func(t *testing.T) {
		input := f.command(t, 200, f.won, nil)
		f.exec(t, `create function private.reject_test_audit() returns trigger language plpgsql as $$begin raise exception 'synthetic late failure';end$$;
   create trigger automation_test_audit_failure before insert on public.audit_logs for each row execute function private.reject_test_audit()`)
		if _, err := run(input); err == nil || !strings.Contains(err.Error(), "synthetic late failure") {
			t.Fatalf("did not reach intended late transaction failure: %v", err)
		}
		assertNoEffects(t)
		status, stage := f.status(t, pipelinePostgresID(200))
		if status != "open" || stage != f.open {
			t.Fatal("lead escaped rollback")
		}
		var propertyStatus string
		if err := f.conn.QueryRow(f.ctx, `select status from public.properties where id=$1`, f.property).Scan(&propertyStatus); err != nil || propertyStatus != "active" {
			t.Fatal("property escaped rollback")
		}
		f.exec(t, `drop trigger automation_test_audit_failure on public.audit_logs`)
		result := mustRun(t, input)
		for _, table := range []string{"public.automation_effect_dispatches", "public.events", "public.notifications", "public.audit_logs", "private.realtime_events"} {
			if n := f.count(t, table); n != 1 {
				t.Fatalf("%s=%d, want 1", table, n)
			}
		}
		if n := f.count(t, "public.activities"); n != 2 {
			t.Fatalf("status and stage activity count=%d", n)
		}
		replay := mustRun(t, input)
		var replayBody, originalBody any
		_ = json.Unmarshal(replay.Response, &replayBody)
		_ = json.Unmarshal(result.Response, &originalBody)
		if replay.EffectID != result.EffectID || !reflect.DeepEqual(replayBody, originalBody) {
			t.Fatal("replay changed durable outcome")
		}
		if f.count(t, "public.events") != 1 || f.count(t, "public.notifications") != 1 || f.count(t, "public.activities") != 2 {
			t.Fatal("replay duplicated canonical effects")
		}
		f.exec(t, `update public.automation_executions set status='queued',locked_by=null,current_node_key='later-node' where id=$1::uuid`, input.ExecutionID)
		advancedReplay := mustRun(t, input)
		if advancedReplay.EffectID != result.EffectID || f.count(t, "public.activities") != 2 {
			t.Fatal("cursor/lease changed ACK re-executed effect")
		}
		f.exec(t, `update public.automation_executions set status='running',locked_by='new-lease',current_node_key='stage-node' where id=$1::uuid`, input.ExecutionID)
		staleLeaseReplay := mustRun(t, input)
		if staleLeaseReplay.EffectID != result.EffectID || f.count(t, "public.events") != 1 {
			t.Fatal("stale lease ACK re-executed effect")
		}
		f.exec(t, `update public.organization_members set is_active=false where user_id=$1::uuid`, f.user)
		_, deniedACK := run(input)
		assertCode(t, deniedACK, "automation_actor_forbidden")
		f.exec(t, `update public.organization_members set is_active=true where user_id=$1::uuid`, f.user)
		status, stage = f.status(t, pipelinePostgresID(200))
		if status != "won" || stage != f.won {
			t.Fatal("terminal stage did not win lead")
		}
		var provenance bool
		if err := f.conn.QueryRow(f.ctx, `select bool_and(metadata->>'origin'='automation' and metadata->>'is_automated'='true') from public.activities`).Scan(&provenance); err != nil || !provenance {
			t.Fatal("history lost automation provenance")
		}

		reopen := f.command(t, 201, f.open, nil)
		f.exec(t, `update public.automation_executions set lead_id=$2::uuid where id=$1::uuid`, reopen.ExecutionID, pipelinePostgresID(200))
		mustRun(t, reopen)
		status, stage = f.status(t, pipelinePostgresID(200))
		if status != "open" || stage != f.open {
			t.Fatal("leaving terminal stage did not reopen")
		}
		var published, announce bool
		if err := f.conn.QueryRow(f.ctx, `select status,published_on_site,anunciar from public.properties where id=$1`, f.property).Scan(&propertyStatus, &published, &announce); err != nil || propertyStatus != "active" || !published || !announce {
			t.Fatal("reopen did not restore proven reservation")
		}
	})

	t.Run("lost reason is required and loaded only from published config", func(t *testing.T) {
		before := f.count(t, "public.automation_effect_dispatches")
		missing := f.command(t, 300, f.lost, nil)
		if _, err := run(missing); !errors.Is(err, ErrLostReasonRequired) {
			t.Fatalf("missing reason=%v", err)
		}
		if f.count(t, "public.automation_effect_dispatches") != before {
			t.Fatal("rejected loss consumed effect key")
		}
		reason := "Customer chose another property"
		configured := f.command(t, 301, f.lost, &reason)
		mustRun(t, configured)
		var status, storedReason string
		if err := f.conn.QueryRow(f.ctx, `select deal_status,lost_reason from public.leads where id=$1`, pipelinePostgresID(301)).Scan(&status, &storedReason); err != nil || status != "lost" || storedReason != reason {
			t.Fatal("configured loss was not applied")
		}
	})

	t.Run("two simultaneous callers commit a single canonical effect", func(t *testing.T) {
		input := f.command(t, 400, f.won, nil)
		beforeEvents, beforeNotifications, beforeActivities := f.count(t, "public.events"), f.count(t, "public.notifications"), f.count(t, "public.activities")
		gate := make(chan struct{})
		var wait sync.WaitGroup
		results := make([]automationStageResponse, 2)
		failures := make([]error, 2)
		for index := range 2 {
			wait.Add(1)
			go func() { defer wait.Done(); <-gate; results[index], failures[index] = run(input) }()
		}
		close(gate)
		wait.Wait()
		for _, err := range failures {
			if err != nil {
				t.Fatalf("concurrent duplicate: %v", err)
			}
		}
		if results[0].EffectID != results[1].EffectID {
			t.Fatal("duplicate effect committed")
		}
		if f.count(t, "public.events") != beforeEvents+1 || f.count(t, "public.notifications") != beforeNotifications+1 || f.count(t, "public.activities") != beforeActivities+2 {
			t.Fatal("concurrent callers duplicated effects")
		}
		reason := "Customer cancelled after reservation"
		lost := f.command(t, 401, f.lost, &reason)
		f.exec(t, `update public.automation_executions set lead_id=$2::uuid where id=$1::uuid`, lost.ExecutionID, pipelinePostgresID(400))
		mustRun(t, lost)
		var propertyStatus string
		if err := f.conn.QueryRow(f.ctx, `select status from public.properties where id=$1`, f.property).Scan(&propertyStatus); err != nil || propertyStatus != "active" {
			t.Fatal("won to lost did not release its proven reservation")
		}
		f.exec(t, `update public.automation_effect_dispatches set request=request||'{"actor_id":"forged"}'::jsonb where effect_key=$1`, input.EffectKey)
		_, err := run(input)
		assertCode(t, err, "automation_effect_conflict")
	})

	t.Run("self cancellation by stage trigger preserves committed effect", func(t *testing.T) {
		neutral := pipelinePostgresID(50)
		f.exec(t, `insert into public.stages(id,organization_id,pipeline_id,name,stage_key) values($1,$2,$3,'Next','next')`, neutral, f.org, f.pipeline)
		input := f.command(t, 500, neutral, nil)
		f.exec(t, `create function private.cancel_command_test_execution() returns trigger language plpgsql as $$begin
   update public.automation_executions set status='cancelled',locked_by=null,cancellation_requested_at=now()
   where id=nullif(current_setting('vimob.automation_execution_id',true),'')::uuid;
   return new;end$$;
   create trigger automation_command_test_cancel after update of stage_id on public.leads for each row execute function private.cancel_command_test_execution()`)
		result := mustRun(t, input)
		var status string
		if err := f.conn.QueryRow(f.ctx, `select status from public.automation_executions where id=$1`, input.ExecutionID).Scan(&status); err != nil || status != "cancelled" {
			t.Fatal("trigger cancellation did not persist")
		}
		var succeeded bool
		if err := f.conn.QueryRow(f.ctx, `select status='succeeded' from public.automation_effect_dispatches where id=$1`, result.EffectID).Scan(&succeeded); err != nil || !succeeded {
			t.Fatal("completed effect was undone by cancellation")
		}
		beforeActivities, beforeFeed := f.count(t, "public.activities"), f.count(t, "private.realtime_events")
		replay := mustRun(t, input)
		if replay.EffectID != result.EffectID || f.count(t, "public.activities") != beforeActivities || f.count(t, "private.realtime_events") != beforeFeed {
			t.Fatal("self-cancelled effect could not ACK without replaying")
		}
	})
}
