package stageconfig

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type fakeInactivityMover struct {
	calls   []StageInactivityMoveRequest
	outcome string
}

// The fake performs the observable part of a canonical move (the lead changes
// stage in the same transaction) so scope/trigger behaviour stays realistic.
func (mover *fakeInactivityMover) move(ctx context.Context, tx pgx.Tx, request StageInactivityMoveRequest) (string, error) {
	mover.calls = append(mover.calls, request)
	if mover.outcome != "" && mover.outcome != "moved" {
		return mover.outcome, nil
	}
	_, err := tx.Exec(ctx, `update public.leads set stage_id=$3::uuid, stage_entered_at=clock_timestamp()
 where organization_id=$1::uuid and id=$2::uuid and stage_id=$4::uuid`, request.OrganizationID, request.LeadID, request.ToStageID, request.FromStageID)
	return "moved", err
}

func prepareInactivityMoveFixture(f inactivityPostgresFixture) {
	f.seed(false, "", "")
	f.exec(`alter table public.stage_automations add column created_at timestamptz default now(),
 add column action_type text,add column automation_type text,add column action_config jsonb default '{}',
 add column trigger_days integer,add column target_stage_id uuid,add column whatsapp_template text,add column alert_message text;
 alter table public.stage_automations alter column id set default gen_random_uuid();
 alter table public.stages add column is_won boolean default false,add column is_lost boolean default false;
 delete from public.stage_automations;
 insert into public.stages(id,organization_id,pipeline_id) values ($1,$4,$5),($2,$4,$5),($3,$4,$6);
 insert into public.pipelines(id,organization_id) values ($6,$4);
 update public.stages set is_won=true where id=$2;
 insert into public.stages(id,organization_id,pipeline_id,is_active) values ($7,$4,$5,false)`,
		inactivityFixtureID(203), inactivityFixtureID(204), inactivityFixtureID(205), inactivityFixtureID(1),
		inactivityFixtureID(101), inactivityFixtureID(105), inactivityFixtureID(206))
	f.exec(`insert into public.users(id) values ($1) on conflict do nothing`, inactivityFixtureID(401))
}

func inactivityMoveManager() tenant.Context {
	return tenant.Context{OrganizationID: inactivityFixtureID(1), UserID: inactivityFixtureID(401), MemberRole: "admin", EnabledModules: []string{"automations"}}
}

func saveMoveRule(t *testing.T, repo Repository, automationID, stageID, targetID string, enabled bool, previous *StageAutomation) (StageAutomation, error) {
	t.Helper()
	days := 3
	request := StageInactivityRequest{TriggerDays: &days, IsEnabled: &enabled, Clock: InactivityClockLastInteraction,
		StartMode: InactivityStartAtActivation, Action: InactivityActionMoveStage, TargetStageID: targetID}
	if automationID == "" {
		request.StageID = stageID
	} else {
		request.ExpectedUpdatedAt = previous.UpdatedAt
		revision := previous.InactivityPolicy.Revision
		request.ExpectedPolicyRevision = &revision
	}
	input, err := request.Validate(automationID == "")
	if err != nil {
		return StageAutomation{}, err
	}
	return repo.SaveInactivityAutomation(context.Background(), inactivityMoveManager(), automationID, input)
}

func TestStageInactivityMovePostgres(t *testing.T) {
	f := openInactivityPostgresFixture(t)
	prepareInactivityMoveFixture(f)
	mover := &fakeInactivityMover{}
	repo := f.repo.WithStageInactivityRuntime(true)
	source, target := inactivityFixtureID(201), inactivityFixtureID(203)

	t.Run("destination must be another active, open stage of the same pipeline", func(t *testing.T) {
		for name, destination := range map[string]string{
			"same column": source, "won column": inactivityFixtureID(204),
			"other pipeline": inactivityFixtureID(205), "archived column": inactivityFixtureID(206),
		} {
			if _, err := saveMoveRule(t, repo, "", source, destination, false, nil); !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("%s accepted: %v", name, err)
			}
		}
	})

	created, err := saveMoveRule(t, repo, "", source, target, false, nil)
	if err != nil {
		t.Fatalf("create disabled move rule: %v", err)
	}
	if created.IsActive || created.InactivityPolicy == nil || created.InactivityPolicy.Action != InactivityActionMoveStage ||
		created.InactivityPolicy.TargetStageID == nil || *created.InactivityPolicy.TargetStageID != target {
		t.Fatalf("created rule = %#v", created)
	}

	t.Run("activation needs the move runtime", func(t *testing.T) {
		if _, err := saveMoveRule(t, repo, created.ID, source, target, true, &created); !errors.Is(err, ErrInactivityRuntimeNotReady) {
			t.Fatalf("activated without a mover: %v", err)
		}
	})

	repo = repo.WithStageInactivityMover(mover.move)
	active, err := saveMoveRule(t, repo, created.ID, source, target, true, &created)
	if err != nil {
		t.Fatalf("activate: %v", err)
	}
	if f.count(`select count(*) from private.stage_inactivity_policies where automation_id=$1::uuid and action_kind='move_stage'
 and target_stage_id=$2::uuid and acting_user_id=$3::uuid and is_enabled`, active.ID, target, inactivityFixtureID(401)) != 1 {
		t.Fatal("policy was not stored with its destination and acting manager")
	}

	t.Run("generic endpoints cannot desynchronize a move rule", func(t *testing.T) {
		revision, _ := parseRequiredStageAutomationRevision(active.UpdatedAt)
		_, err := repo.ToggleAutomation(context.Background(), inactivityMoveManager(), active.ID, stageAutomationStatusInput{IsActive: false, ExpectedUpdatedAt: revision})
		if !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("generic toggle = %v", err)
		}
	})

	t.Run("a second active move rule and a return rule are refused", func(t *testing.T) {
		if _, err := saveMoveRule(t, repo, "", source, inactivityFixtureID(203), false, nil); err != nil {
			t.Fatalf("a disabled draft is allowed: %v", err)
		}
		f.exec(`insert into public.stage_automations(id,organization_id,stage_id,trigger_type,is_active) values ($1,$2,$3,'inactivity',false)`, inactivityFixtureID(399), inactivityFixtureID(1), source)
		back, err := saveMoveRule(t, repo, "", target, source, false, nil)
		if err != nil {
			t.Fatalf("disabled return draft: %v", err)
		}
		if _, err := saveMoveRule(t, repo, back.ID, target, source, true, &back); err == nil || !strings.Contains(err.Error(), "indo e voltando") {
			t.Fatalf("A→B→A cycle accepted: %v", err)
		}
		drafts := f.count(`select count(*) from private.stage_inactivity_policies where stage_id=$1::uuid and not is_enabled`, source)
		if drafts != 1 {
			t.Fatalf("drafts on source = %d", drafts)
		}
		var draftID string
		if err := f.db.Pool().QueryRow(f.ctx, `select automation_id::text from private.stage_inactivity_policies where stage_id=$1::uuid and not is_enabled`, source).Scan(&draftID); err != nil {
			t.Fatal(err)
		}
		draft := mustLoadAutomation(t, f, repo, draftID)
		if _, err := saveMoveRule(t, repo, draftID, source, target, true, &draft); err == nil || !strings.Contains(err.Error(), "já tem uma regra ativa") {
			t.Fatalf("second active rule on the same column accepted: %v", err)
		}
	})

	t.Run("the worker moves an idle lead once, through the mover", func(t *testing.T) {
		f.exec(`update private.stage_inactivity_policies set activated_at=now()-interval '5 days', interaction_coverage_from=now()-interval '12 days', next_scan_at=now() where automation_id=$1::uuid`, active.ID)
		result := f.cycleWith(repo)
		if result.Moved != 1 || len(mover.calls) != 1 {
			t.Fatalf("cycle=%#v calls=%d", result, len(mover.calls))
		}
		call := mover.calls[0]
		if call.FromStageID != source || call.ToStageID != target || call.ActorID != inactivityFixtureID(401) || call.LeadID != inactivityFixtureID(501) {
			t.Fatalf("move request = %#v", call)
		}
		if f.count(`select count(*) from private.stage_inactivity_jobs where status='moved' and moved_to_stage_id=$1::uuid and moved_at is not null`, target) != 1 {
			t.Fatal("job was not completed as moved")
		}
		f.scanNow()
		if result := f.cycleWith(repo); result.Moved != 0 || len(mover.calls) != 1 {
			t.Fatalf("lead was moved again: %#v", result)
		}
	})

	t.Run("a business refusal closes the episode without retries", func(t *testing.T) {
		f.exec(`update public.leads set stage_id=$1::uuid, stage_entered_at=now()-interval '10 days' where id=$2::uuid`, source, inactivityFixtureID(501))
		f.exec(`update private.stage_inactivity_policies set next_scan_at=now() where automation_id=$1::uuid`, active.ID)
		mover.outcome = "actor_forbidden"
		if result := f.cycleWith(repo); result.Cancelled != 1 || result.Failed != 0 {
			t.Fatalf("refusal cycle = %#v", result)
		}
		if f.count(`select count(*) from private.stage_inactivity_jobs where status='cancelled' and error_code='actor_forbidden'`) != 1 {
			t.Fatal("refusal reason was not recorded")
		}
		if f.count(`select count(*) from public.notifications`) != 0 {
			t.Fatal("a move rule must not send the alert notification")
		}
	})
}

func (fixture inactivityPostgresFixture) cycleWith(repo Repository) StageInactivityCycleResult {
	fixture.t.Helper()
	result, err := repo.ProcessStageInactivityOnce(fixture.ctx)
	if err != nil {
		fixture.t.Fatalf("worker cycle: %v", err)
	}
	return result
}

func mustLoadAutomation(t *testing.T, f inactivityPostgresFixture, repo Repository, id string) StageAutomation {
	t.Helper()
	automations, err := repo.ListAutomations(context.Background(), inactivityMoveManager(), inactivityFixtureID(201))
	if err != nil {
		t.Fatal(err)
	}
	for _, automation := range automations {
		if automation.ID == id {
			return automation
		}
	}
	t.Fatalf("automation %s not listed", id)
	return StageAutomation{}
}
