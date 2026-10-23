package pipelines

import (
	"errors"
	"testing"
)

func TestNativeStageStatusInverseCompatibilityLocalPostgres(t *testing.T) {
	for _, schema := range []string{"legacy", "config-only", "mixed"} {
		t.Run(schema, func(t *testing.T) {
			f := openStageDeletePostgresFixture(t)
			f.exec(`alter table public.stage_automations add column id uuid default gen_random_uuid(),
 add column trigger_type text default 'on_enter',add column is_active boolean default true;`)
			if schema != "config-only" {
				f.exec(`alter table public.stage_automations add column automation_type text,add column action_type text,add column action_config jsonb default '{}'`)
			}
			if schema != "legacy" {
				f.exec(`alter table public.stage_automations add column config jsonb default '{}'`)
			}
			seed := func(org int, status string, active bool, trigger string) {
				if schema == "config-only" {
					f.exec(`insert into public.stage_automations(organization_id,stage_id,trigger_type,is_active,config)
 values($1,$2,$3,$4,jsonb_build_object('automation_type','change_deal_status_on_enter','action_config',jsonb_build_object('deal_status',$5::text)))`, stageArchiveFixtureID(org), stageArchiveFixtureID(202), trigger, active, status)
				} else {
					f.exec(`insert into public.stage_automations(organization_id,stage_id,trigger_type,is_active,automation_type,action_config)
 values($1,$2,$3,$4,'change_deal_status_on_enter',jsonb_build_object('deal_status',$5::text))`, stageArchiveFixtureID(org), stageArchiveFixtureID(202), trigger, active, status)
				}
			}
			for _, scenario := range []struct {
				name, status       string
				won, lost, blocked bool
			}{
				{"won rejects open", "open", true, false, true}, {"won rejects lost", "lost", true, false, true},
				{"won rejects normalized legacy lost", " LOST ", true, false, true},
				{"lost rejects open", "open", false, true, true}, {"lost rejects won", "won", false, true, true},
				{"won accepts won", "won", true, false, false}, {"lost accepts lost", "lost", false, true, false},
				{"neutral accepts status", "won", false, false, false},
			} {
				t.Run(scenario.name, func(t *testing.T) {
					f.t = t
					f.reset()
					f.exec(`update public.stages set is_won=false,is_lost=false`)
					seed(1, scenario.status, true, "on_enter")
					if schema == "mixed" {
						f.exec(`update public.stage_automations set config='{"automation_type":"change_deal_status_on_enter","action_config":{"deal_status":"won"}}'`)
					}
					_, err := f.repo.UpdateStage(f.ctx, f.actor, stageArchiveFixtureID(202), updateStageInput{ExpectedUpdatedAt: &f.base, IsWon: newPatchBool(scenario.won), IsLost: newPatchBool(scenario.lost)})
					if errors.Is(err, ErrInvalidInput) != scenario.blocked || (!scenario.blocked && err != nil) {
						t.Fatalf("blocked=%t err=%v", scenario.blocked, err)
					}
					if scenario.blocked && f.count(`select count(*) from public.stages where id=$1 and not is_won and not is_lost and updated_at=$2`, stageArchiveFixtureID(202), f.base) != 1 {
						t.Fatal("rejected native flags changed stage")
					}
				})
			}
			t.Run("disabled foreign and inactivity rules ignored", func(t *testing.T) {
				f.t = t
				f.reset()
				f.exec(`update public.stages set is_won=false,is_lost=false`)
				seed(1, "lost", false, "on_enter")
				seed(2, "lost", true, "on_enter")
				seed(1, "lost", true, "inactivity")
				if _, err := f.repo.UpdateStage(f.ctx, f.actor, stageArchiveFixtureID(202), updateStageInput{ExpectedUpdatedAt: &f.base, IsWon: newPatchBool(true)}); err != nil {
					t.Fatal(err)
				}
			})
			t.Run("rename of legacy conflict remains available", func(t *testing.T) {
				f.t = t
				f.reset()
				f.exec(`update public.stages set is_won=true,is_lost=false where id=$1`, stageArchiveFixtureID(202))
				seed(1, "lost", true, "on_enter")
				name := "Rename only"
				if _, err := f.repo.UpdateStage(f.ctx, f.actor, stageArchiveFixtureID(202), updateStageInput{ExpectedUpdatedAt: &f.base, Name: patchString{Set: true, Value: &name}}); err != nil {
					t.Fatal(err)
				}
			})
		})
	}
}
