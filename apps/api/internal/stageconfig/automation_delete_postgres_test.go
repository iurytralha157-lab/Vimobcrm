package stageconfig

import (
	"errors"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func resetAutomationDelete(t *testing.T, f inactivityPostgresFixture, modern bool) StageAutomation {
	t.Helper()
	f.exec(`insert into public.stage_automations(id,organization_id,stage_id) values($1,$2,$3) on conflict(id) do nothing`, inactivityFixtureID(301), inactivityFixtureID(1), inactivityFixtureID(201))
	f.exec(`delete from private.stage_inactivity_policies where automation_id=$1`, inactivityFixtureID(301))
	return resetAutomationRevision(t, f, modern)
}

func TestStageAutomationDeleteRevisionLocalPostgres(t *testing.T) {
	for _, modern := range []bool{true, false} {
		t.Run(map[bool]string{true: "config", false: "legacy"}[modern], func(t *testing.T) {
			f := automationRevisionPostgresFixture(t, modern)
			actor := automationRevisionActor(1)
			t.Run("edit invalidates old delete and current token deletes", func(t *testing.T) {
				f.t = t
				original := resetAutomationDelete(t, f, modern)
				old := stageAutomationDeleteInput{ExpectedUpdatedAt: mustAutomationRevision(t, original.UpdatedAt)}
				edited, err := f.repo.UpdateAutomation(f.ctx, actor, original.ID, automationRevisionInput(t, 402, original.UpdatedAt))
				if err != nil {
					t.Fatal(err)
				}
				if mustAutomationRevision(t, edited.UpdatedAt).Sub(old.ExpectedUpdatedAt) != time.Microsecond {
					t.Fatal("future revision must advance by exactly one microsecond")
				}
				if err := f.repo.DeleteAutomation(f.ctx, actor, original.ID, old); !errors.Is(err, ErrStageAutomationChanged) {
					t.Fatalf("stale delete after edit=%v", err)
				}
				if current := automationRevisionRead(t, f, 1); current.UpdatedAt != edited.UpdatedAt || current.ID != original.ID {
					t.Fatal("stale delete changed the edited automation")
				}
				if err := f.repo.DeleteAutomation(f.ctx, actor, original.ID, stageAutomationDeleteInput{ExpectedUpdatedAt: mustAutomationRevision(t, edited.UpdatedAt)}); err != nil {
					t.Fatal(err)
				}
				if f.count(`select count(*) from public.stage_automations where id=$1`, original.ID) != 0 || f.count(`select count(*) from public.stage_automations where organization_id=$1`, inactivityFixtureID(2)) != 1 {
					t.Fatal("fresh delete did not remove only its selected tenant automation")
				}
			})
			t.Run("toggle invalidates old delete", func(t *testing.T) {
				f.t = t
				original := resetAutomationDelete(t, f, modern)
				revision := mustAutomationRevision(t, original.UpdatedAt)
				toggled, err := f.repo.ToggleAutomation(f.ctx, actor, original.ID, stageAutomationStatusInput{IsActive: false, ExpectedUpdatedAt: revision})
				if err != nil {
					t.Fatal(err)
				}
				if err := f.repo.DeleteAutomation(f.ctx, actor, original.ID, stageAutomationDeleteInput{ExpectedUpdatedAt: revision}); !errors.Is(err, ErrStageAutomationChanged) {
					t.Fatalf("stale delete after toggle=%v", err)
				}
				if current := automationRevisionRead(t, f, 1); current.IsActive || current.UpdatedAt != toggled.UpdatedAt {
					t.Fatal("stale delete changed the confirmed toggle")
				}
			})
			t.Run("missing one-microsecond foreign and forbidden revisions preserve rows", func(t *testing.T) {
				f.t = t
				original := resetAutomationDelete(t, f, modern)
				revision := mustAutomationRevision(t, original.UpdatedAt)
				for _, expected := range []time.Time{{}, revision.Add(-time.Microsecond), revision.Add(time.Microsecond)} {
					if err := f.repo.DeleteAutomation(f.ctx, actor, original.ID, stageAutomationDeleteInput{ExpectedUpdatedAt: expected}); !errors.Is(err, ErrStageAutomationChanged) {
						t.Fatalf("missing/stale revision=%v", err)
					}
				}
				input := stageAutomationDeleteInput{ExpectedUpdatedAt: revision}
				if err := f.repo.DeleteAutomation(f.ctx, automationRevisionActor(2), original.ID, input); !errors.Is(err, ErrNotFound) {
					t.Fatalf("foreign tenant=%v", err)
				}
				if err := f.repo.DeleteAutomation(f.ctx, actor, inactivityFixtureID(999), input); !errors.Is(err, ErrNotFound) {
					t.Fatalf("missing automation=%v", err)
				}
				broker := actor
				broker.MemberRole = "broker"
				if err := f.repo.DeleteAutomation(f.ctx, broker, original.ID, input); !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
					t.Fatalf("forbidden actor=%v", err)
				}
				if f.count(`select count(*) from public.stage_automations`) != 2 {
					t.Fatal("a rejected delete removed an automation")
				}
			})
			t.Run("two deletes sharing a snapshot have one winner", func(t *testing.T) {
				f.t = t
				original := resetAutomationDelete(t, f, modern)
				blocker, err := f.db.Pool().Begin(f.ctx)
				if err != nil {
					t.Fatal(err)
				}
				defer rollbackInactivityTransaction(blocker)
				if err := f.repo.lockAutomationStage(f.ctx, blocker, actor.OrganizationID, original.StageID); err != nil {
					t.Fatal(err)
				}
				input := stageAutomationDeleteInput{ExpectedUpdatedAt: mustAutomationRevision(t, original.UpdatedAt)}
				results := make(chan error, 2)
				for range 2 {
					go func() { results <- f.repo.DeleteAutomation(f.ctx, actor, original.ID, input) }()
				}
				waitAutomationRevisionStageWaiters(t, f, 2)
				rollbackInactivityTransaction(blocker)
				wins, absent := 0, 0
				for range 2 {
					err := <-results
					if err == nil {
						wins++
					} else if errors.Is(err, ErrNotFound) {
						absent++
					} else {
						t.Fatal(err)
					}
				}
				if wins != 1 || absent != 1 || f.count(`select count(*) from public.stage_automations where id=$1`, original.ID) != 0 {
					t.Fatalf("concurrent deletes wins=%d missing=%d", wins, absent)
				}
			})
			t.Run("fresh deletion preserves canonical inactivity cascades", func(t *testing.T) {
				f.t = t
				original := resetAutomationDelete(t, f, modern)
				f.exec(`update public.stage_automations set trigger_type='inactivity' where id=$1;
 insert into private.stage_inactivity_policies(automation_id,organization_id,stage_id,activation_epoch,revision,clock,start_mode,activated_at,automation_updated_at,interaction_coverage_from,duration_days,is_enabled)
 select id,organization_id,stage_id,gen_random_uuid(),1,'last_interaction','activation',now(),updated_at,now(),1,false from public.stage_automations where id=$1;
 insert into private.stage_inactivity_jobs(organization_id,automation_id,lead_id,activation_epoch,policy_revision,lead_cycle_id,episode_key,baseline_at,due_at)
 select organization_id,automation_id,$2,activation_epoch,revision,gen_random_uuid(),repeat('a',64),now(),now()+interval '1 day' from private.stage_inactivity_policies where automation_id=$1`, original.ID, inactivityFixtureID(501))
				revision := mustAutomationRevision(t, original.UpdatedAt)
				if err := f.repo.DeleteAutomation(f.ctx, actor, original.ID, stageAutomationDeleteInput{ExpectedUpdatedAt: revision.Add(-time.Microsecond)}); !errors.Is(err, ErrStageAutomationChanged) {
					t.Fatal(err)
				}
				if f.count(`select count(*) from private.stage_inactivity_policies`) != 1 || f.count(`select count(*) from private.stage_inactivity_jobs`) != 1 {
					t.Fatal("rejected deletion cascaded runtime records")
				}
				if err := f.repo.DeleteAutomation(f.ctx, actor, original.ID, stageAutomationDeleteInput{ExpectedUpdatedAt: revision}); err != nil {
					t.Fatal(err)
				}
				if f.count(`select count(*) from private.stage_inactivity_policies`) != 0 || f.count(`select count(*) from private.stage_inactivity_jobs`) != 0 || f.count(`select count(*) from public.leads`) != 2 {
					t.Fatal("fresh deletion changed the real runtime FK cascade or removed leads")
				}
			})
		})
	}
}
