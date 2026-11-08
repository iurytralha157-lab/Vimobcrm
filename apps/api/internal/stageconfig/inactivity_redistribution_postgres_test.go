package stageconfig

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestStageInactivityRedistributionPostgres(t *testing.T) {
	f := openInactivityPostgresFixture(t)
	prepareInactivityMoveFixture(f)
	org, lead, source, target := inactivityFixtureID(1), inactivityFixtureID(501), inactivityFixtureID(201), inactivityFixtureID(203)
	queue, foreignQueue := inactivityFixtureID(701), inactivityFixtureID(702)
	f.exec(`create table public.round_robins(id uuid primary key, organization_id uuid not null,
 deleted_at timestamptz, is_active boolean default true, target_pipeline_id uuid, target_stage_id uuid);
 insert into public.round_robins(id,organization_id,target_stage_id) values ($1,$3,$4),($2,$5,null)`,
		queue, foreignQueue, org, target, inactivityFixtureID(2))
	manager := inactivityMoveManager()
	restricted := tenant.Context{OrganizationID: org, UserID: manager.UserID, MemberRole: "member",
		Permissions: []string{permissions.AutomationsManage}, EnabledModules: manager.EnabledModules}
	mover := &fakeInactivityMover{}
	redistributionOutcome := "queue_unavailable"
	var calls int
	repo := f.repo.WithStageInactivityRuntime(true).WithStageInactivityMover(mover.move).
		WithStageInactivityRedistributor(func(ctx context.Context, tx pgx.Tx, request StageInactivityRedistributionRequest) (string, error) {
			calls++
			if request.RoundRobinID != queue || request.OrganizationID != org || request.LeadID != lead || request.StageID != source || request.ActorID != manager.UserID {
				t.Fatalf("redistribution request = %#v", request)
			}
			_, err := tx.Exec(ctx, `update public.leads set stage_id=$3::uuid, assigned_user_id=$4::uuid, stage_entered_at=clock_timestamp()
 where organization_id=$1::uuid and id=$2::uuid`, org, lead, target, inactivityFixtureID(402))
			return redistributionOutcome, err
		})

	save := func(actor tenant.Context, targetQueue string, previous *StageAutomation, enable bool) (StageAutomation, error) {
		days := 2
		input := StageInactivityRequest{StageID: source, TriggerDays: &days, IsEnabled: &enable, Clock: InactivityClockLastInteraction,
			StartMode: InactivityStartAtActivation, Action: InactivityActionRedistribute, TargetRoundRobinID: targetQueue}
		var id string
		if previous != nil {
			id, input.StageID = previous.ID, ""
			input.ExpectedUpdatedAt = previous.UpdatedAt
			revision := previous.InactivityPolicy.Revision
			input.ExpectedPolicyRevision = &revision
		}
		validated, err := input.Validate(id == "")
		if err != nil {
			return StageAutomation{}, err
		}
		return repo.SaveInactivityAutomation(f.ctx, actor, id, validated)
	}

	if _, err := save(restricted, queue, nil, false); !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatalf("redistribution without distribution_manage = %v", err)
	}
	if _, err := save(manager, foreignQueue, nil, false); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("foreign queue = %v", err)
	}
	created, err := save(manager, queue, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	active, err := save(manager, queue, &created, true)
	if err != nil {
		t.Fatal(err)
	}
	if policy := active.InactivityPolicy; !policy.IsEnabled || policy.Action != InactivityActionRedistribute ||
		policy.TargetRoundRobinID == nil || *policy.TargetRoundRobinID != queue {
		t.Fatalf("saved policy = %#v", policy)
	}
	other, err := save(manager, queue, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := save(manager, queue, &other, true); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("duplicate redistribution = %v", err)
	}
	deleteInput := stageAutomationDeleteInput{ExpectedUpdatedAt: mustAutomationRevision(t, active.UpdatedAt)}
	if err := repo.DeleteAutomation(f.ctx, restricted, active.ID, deleteInput); !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatalf("delete without distribution_manage = %v", err)
	}
	moveDraft, err := saveMoveRule(t, repo, "", source, target, false, nil)
	if err != nil {
		t.Fatal(err)
	}
	move, err := saveMoveRule(t, repo, moveDraft.ID, source, target, true, &moveDraft)
	if err != nil {
		t.Fatalf("activate move alongside redistribution: %v", err)
	}

	f.exec(`update private.stage_inactivity_policies set activated_at=now()-interval '2.5 days',
 interaction_coverage_from=now()-interval '3 days', next_scan_at=now()
 where automation_id in ($1::uuid,$2::uuid)`, active.ID, move.ID)
	f.cycleWith(repo)
	if calls != 1 || len(mover.calls) != 0 || f.count(`select count(*) from public.leads
 where id=$1 and stage_id=$2 and assigned_user_id=$3`, lead, source, manager.UserID) != 1 {
		t.Fatal("failed allocation changed lead or triggered a move before its deadline")
	}
	if f.count(`select count(*) from private.stage_inactivity_jobs where automation_id=$1 and status='pending' and attempts=1`, active.ID) != 1 {
		t.Fatal("unavailable distribution did not schedule a bounded retry")
	}

	redistributionOutcome = "redistributed"
	f.exec(`update private.stage_inactivity_jobs set next_attempt_at=now()-interval '1 second' where automation_id=$1`, active.ID)
	result := f.cycleWith(repo)
	if result.Redistributed != 1 || calls != 2 || f.count(`select count(*) from public.leads
 where id=$1 and stage_id=$2 and assigned_user_id=$3`, lead, target, inactivityFixtureID(402)) != 1 {
		t.Fatalf("redistribution cycle = %#v, calls=%d", result, calls)
	}
	f.exec(`update private.stage_inactivity_jobs set due_at=now()-interval '1 second',
 next_attempt_at=now()-interval '1 second' where automation_id=$1`, move.ID)
	result = f.cycleWith(repo)
	if result.Cancelled != 1 || result.Redistributed != 0 || len(mover.calls) != 0 || calls != 2 {
		t.Fatalf("source jobs did not retire after redistribution: %#v", result)
	}

	f.exec(`update public.round_robins set deleted_at=now() where id=$1`, queue)
	if _, err := save(manager, queue, &active, false); err != nil {
		t.Fatalf("pause after removing selected distribution: %v", err)
	}
}
