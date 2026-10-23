package stageconfig

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func automationRevisionPostgresFixture(t *testing.T, modern bool) inactivityPostgresFixture {
	t.Helper()
	f := openInactivityPostgresFixture(t)
	f.seed(false, InactivityClockLastInteraction, InactivityStartAtActivation)
	f.exec(`alter table public.stage_automations add column created_at timestamptz default now();
 alter table public.stages add column is_won boolean default false,add column is_lost boolean default false;`)
	if modern {
		f.exec(`alter table public.stage_automations add column config jsonb default '{}'`)
	} else {
		f.exec(`alter table public.stage_automations add column action_type text,add column automation_type text,
 add column action_config jsonb default '{}',add column trigger_days integer,add column target_stage_id uuid,
 add column whatsapp_template text,add column alert_message text;`)
	}
	if actual, err := f.repo.hasStageAutomationConfigSchema(f.ctx); err != nil || actual != modern {
		t.Fatalf("fixture does not select its declared production schema branch: config=%v err=%v", actual, err)
	}
	return f
}

func automationRevisionActor(org int) tenant.Context {
	return tenant.Context{OrganizationID: inactivityFixtureID(org), UserID: inactivityFixtureID(401),
		MemberRole: "admin", EnabledModules: []string{"automations"}}
}

func automationRevisionInput(t *testing.T, target int, revision string) stageAutomationInput {
	t.Helper()
	input, err := (StageAutomationRequest{StageID: inactivityFixtureID(201), AutomationType: "change_assignee_on_enter",
		ActionConfig: map[string]any{"target_user_id": inactivityFixtureID(target)}, ExpectedUpdatedAt: revision}).Validate(false)
	if err != nil {
		t.Fatal(err)
	}
	return input
}

func automationRevisionRead(t *testing.T, f inactivityPostgresFixture, org int) StageAutomation {
	t.Helper()
	rows, err := f.repo.ListAutomations(f.ctx, automationRevisionActor(org), inactivityFixtureID(200+org))
	if err != nil || len(rows) != 1 {
		t.Fatalf("exact API list token unavailable: count=%d err=%v", len(rows), err)
	}
	return rows[0]
}

func resetAutomationRevision(t *testing.T, f inactivityPostgresFixture, modern bool) StageAutomation {
	t.Helper()
	input := automationRevisionInput(t, 401, "2100-01-01T00:00:00.123456Z")
	if modern {
		f.exec(`update public.stage_automations set trigger_type='on_enter',is_active=true,config=$2::jsonb,
 updated_at='2100-01-01T00:00:00.123456Z' where id=$1`, inactivityFixtureID(301), jsonb(input.Config))
	} else {
		automationType, config, days, stage, template, message := legacyStageAutomationValues(input.Config)
		f.exec(`update public.stage_automations set trigger_type='on_enter',is_active=true,automation_type=$2,
 action_type=$2,action_config=$3::jsonb,trigger_days=$4,target_stage_id=$5,whatsapp_template=$6,alert_message=$7,
 updated_at='2100-01-01T00:00:00.123456Z' where id=$1`, inactivityFixtureID(301), automationType, config, days, stage, template, message)
	}
	return automationRevisionRead(t, f, 1)
}

func waitAutomationRevisionStageWaiters(t *testing.T, f inactivityPostgresFixture, want int) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if f.count(`select count(*) from pg_stat_activity where datname=current_database()
 and wait_event_type='Lock' and query like '%from public.stages%'`) >= want {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("concurrent editors did not both wait on the shared stage lock")
}

func TestStageAutomationRevisionLocalPostgres(t *testing.T) {
	for _, modern := range []bool{true, false} {
		t.Run(map[bool]string{true: "config", false: "legacy"}[modern], func(t *testing.T) {
			f := automationRevisionPostgresFixture(t, modern)
			actor := automationRevisionActor(1)
			t.Run("two editors sharing the exact API token have one winner", func(t *testing.T) {
				original := resetAutomationRevision(t, f, modern)
				blocker, err := f.db.Pool().Begin(f.ctx)
				if err != nil {
					t.Fatal(err)
				}
				defer rollbackInactivityTransaction(blocker)
				if err := f.repo.lockAutomationStage(f.ctx, blocker, actor.OrganizationID, original.StageID); err != nil {
					t.Fatal(err)
				}
				results := make(chan error, 2)
				for _, target := range []int{401, 402} {
					input := automationRevisionInput(t, target, original.UpdatedAt)
					go func() { _, err := f.repo.UpdateAutomation(f.ctx, actor, original.ID, input); results <- err }()
				}
				waitAutomationRevisionStageWaiters(t, f, 2)
				if err := blocker.Commit(f.ctx); err != nil {
					t.Fatal(err)
				}
				wins, conflicts := 0, 0
				for range 2 {
					select {
					case err := <-results:
						if err == nil {
							wins++
						} else if errors.Is(err, ErrStageAutomationChanged) {
							conflicts++
						} else {
							t.Fatal(err)
						}
					case <-time.After(5 * time.Second):
						t.Fatal("editors did not finish")
					}
				}
				if wins != 1 || conflicts != 1 {
					t.Fatalf("wins=%d conflicts=%d", wins, conflicts)
				}
				updated := automationRevisionRead(t, f, 1)
				if err := requireAdvancedStageAutomationRevision(updated, mustAutomationRevision(t, original.UpdatedAt)); err != nil {
					t.Fatal(err)
				}
			})
			t.Run("toggle invalidates old edit and edit invalidates old toggle", func(t *testing.T) {
				original := resetAutomationRevision(t, f, modern)
				updated, err := f.repo.ToggleAutomation(f.ctx, actor, original.ID, stageAutomationStatusInput{IsActive: false, ExpectedUpdatedAt: mustAutomationRevision(t, original.UpdatedAt)})
				if err != nil || updated.IsActive {
					t.Fatalf("toggle: %+v %v", updated, err)
				}
				if _, err := f.repo.UpdateAutomation(f.ctx, actor, original.ID, automationRevisionInput(t, 402, original.UpdatedAt)); !errors.Is(err, ErrStageAutomationChanged) {
					t.Fatalf("old edit after toggle: %v", err)
				}
				edited, err := f.repo.UpdateAutomation(f.ctx, actor, original.ID, automationRevisionInput(t, 402, updated.UpdatedAt))
				if err != nil || edited.IsActive {
					t.Fatalf("edit lost the actual inactive state: %+v %v", edited, err)
				}
				if _, err := f.repo.ToggleAutomation(f.ctx, actor, original.ID, stageAutomationStatusInput{IsActive: true, ExpectedUpdatedAt: mustAutomationRevision(t, updated.UpdatedAt)}); !errors.Is(err, ErrStageAutomationChanged) {
					t.Fatalf("old toggle after edit: %v", err)
				}
				if current := automationRevisionRead(t, f, 1); current.UpdatedAt != edited.UpdatedAt || current.IsActive {
					t.Fatal("stale toggle changed the edited rule")
				}
			})
			t.Run("same-value operations consume one microsecond and stale no-op is rejected", func(t *testing.T) {
				original := resetAutomationRevision(t, f, modern)
				edited, err := f.repo.UpdateAutomation(f.ctx, actor, original.ID, automationRevisionInput(t, 401, original.UpdatedAt))
				if err != nil || mustAutomationRevision(t, edited.UpdatedAt).Sub(mustAutomationRevision(t, original.UpdatedAt)) != time.Microsecond {
					t.Fatalf("same-value edit did not advance future revision exactly 1us: %+v %v", edited, err)
				}
				toggled, err := f.repo.ToggleAutomation(f.ctx, actor, original.ID, stageAutomationStatusInput{IsActive: true, ExpectedUpdatedAt: mustAutomationRevision(t, edited.UpdatedAt)})
				if err != nil || mustAutomationRevision(t, toggled.UpdatedAt).Sub(mustAutomationRevision(t, edited.UpdatedAt)) != time.Microsecond {
					t.Fatalf("same-value toggle did not advance exactly 1us: %+v %v", toggled, err)
				}
				if _, err := f.repo.ToggleAutomation(f.ctx, actor, original.ID, stageAutomationStatusInput{IsActive: true, ExpectedUpdatedAt: mustAutomationRevision(t, edited.UpdatedAt)}); !errors.Is(err, ErrStageAutomationChanged) {
					t.Fatalf("1us stale no-op accepted: %v", err)
				}
			})
			t.Run("other tenant and missing revision cannot change either rule", func(t *testing.T) {
				original := resetAutomationRevision(t, f, modern)
				foreign := automationRevisionRead(t, f, 2)
				if _, err := f.repo.UpdateAutomation(f.ctx, automationRevisionActor(2), original.ID, automationRevisionInput(t, 402, original.UpdatedAt)); !errors.Is(err, ErrNotFound) {
					t.Fatalf("foreign edit: %v", err)
				}
				if _, err := f.repo.ToggleAutomation(f.ctx, automationRevisionActor(2), original.ID, stageAutomationStatusInput{IsActive: false, ExpectedUpdatedAt: mustAutomationRevision(t, original.UpdatedAt)}); !errors.Is(err, ErrNotFound) {
					t.Fatalf("foreign toggle: %v", err)
				}
				input := automationRevisionInput(t, 402, original.UpdatedAt)
				input.ExpectedUpdatedAt = time.Time{}
				if _, err := f.repo.UpdateAutomation(f.ctx, actor, original.ID, input); !errors.Is(err, ErrStageAutomationChanged) {
					t.Fatal(err)
				}
				if current := automationRevisionRead(t, f, 1); current.UpdatedAt != original.UpdatedAt {
					t.Fatal("rejected edit changed original revision")
				}
				if current := automationRevisionRead(t, f, 2); current.UpdatedAt != foreign.UpdatedAt || current.IsActive != foreign.IsActive {
					t.Fatal("foreign rule changed")
				}
			})
			t.Run("a trigger replacing the new revision cannot commit any effect", func(t *testing.T) {
				original := resetAutomationRevision(t, f, modern)
				f.exec(`create function private.override_automation_revision() returns trigger language plpgsql as $$
 begin new.updated_at:=now(); return new; end $$;
 create trigger synthetic_revision_override before update on public.stage_automations
 for each row execute function private.override_automation_revision();`)
				defer f.exec(`drop trigger synthetic_revision_override on public.stage_automations; drop function private.override_automation_revision()`)
				if _, err := f.repo.UpdateAutomation(f.ctx, actor, original.ID, automationRevisionInput(t, 402, original.UpdatedAt)); !errors.Is(err, ErrStageAutomationChanged) {
					t.Fatalf("overridden edit revision committed: %v", err)
				}
				if _, err := f.repo.ToggleAutomation(f.ctx, actor, original.ID, stageAutomationStatusInput{IsActive: false, ExpectedUpdatedAt: mustAutomationRevision(t, original.UpdatedAt)}); !errors.Is(err, ErrStageAutomationChanged) {
					t.Fatalf("overridden toggle revision committed: %v", err)
				}
				current := automationRevisionRead(t, f, 1)
				if current.UpdatedAt != original.UpdatedAt || current.IsActive != original.IsActive || jsonb(current.Config) != jsonb(original.Config) {
					t.Fatal("trigger failure escaped transaction rollback")
				}
			})
		})
	}
}

func mustAutomationRevision(t *testing.T, raw string) time.Time {
	t.Helper()
	value, err := time.Parse(time.RFC3339Nano, raw)
	if err != nil {
		t.Fatalf("API must return RFC3339 with full precision: %v", err)
	}
	return value
}

func TestStageAutomationRevisionDedicatedWriterInterleavingLocalPostgres(t *testing.T) {
	for _, modern := range []bool{true, false} {
		t.Run(map[bool]string{true: "config", false: "legacy"}[modern], func(t *testing.T) {
			f := automationRevisionPostgresFixture(t, modern)
			days := 3
			initial := "2100-01-01T00:00:00.123456Z"
			request := StageAutomationRequest{AutomationType: "alert_on_inactivity", TriggerDays: &days, ExpectedUpdatedAt: initial}
			input, err := request.Validate(false)
			if err != nil {
				t.Fatal(err)
			}
			if modern {
				f.exec(`update public.stage_automations set is_active=false,config=$2::jsonb,updated_at=$3 where id=$1`, inactivityFixtureID(301), jsonb(input.Config), mustAutomationRevision(t, initial))
			} else {
				f.exec(`update public.stage_automations set is_active=false,automation_type='alert_on_inactivity',action_type='alert_on_inactivity',
 trigger_days=1,updated_at=$2 where id=$1`, inactivityFixtureID(301), mustAutomationRevision(t, initial))
			}
			common, err := f.repo.UpdateAutomation(f.ctx, automationRevisionActor(1), inactivityFixtureID(301), input)
			if err != nil {
				t.Fatal(err)
			}
			dedicated := stageInactivityInput{Days: 4, Message: "Synthetic update", ExpectedUpdatedAt: mustAutomationRevision(t, initial)}
			if _, err := f.repo.SaveInactivityAutomation(f.ctx, automationRevisionActor(1), common.ID, dedicated); !errors.Is(err, ErrInactivityConfigurationChanged) {
				t.Fatalf("old dedicated edit replaced the common editor: %v", err)
			}
			dedicated.ExpectedUpdatedAt = mustAutomationRevision(t, common.UpdatedAt)
			updated, err := f.repo.SaveInactivityAutomation(f.ctx, automationRevisionActor(1), common.ID, dedicated)
			if err != nil {
				t.Fatal(err)
			}
			if mustAutomationRevision(t, updated.UpdatedAt).Sub(dedicated.ExpectedUpdatedAt) != time.Microsecond {
				t.Fatal("dedicated writer regressed the common editor's future microsecond revision")
			}
			input.ExpectedUpdatedAt = dedicated.ExpectedUpdatedAt
			if _, err := f.repo.UpdateAutomation(f.ctx, automationRevisionActor(1), common.ID, input); !errors.Is(err, ErrStageAutomationChanged) {
				t.Fatalf("old common edit replaced the dedicated editor: %v", err)
			}
			if current := automationRevisionRead(t, f, 1); current.UpdatedAt != updated.UpdatedAt || strings.Contains(jsonb(current.Config), `"trigger_days":3`) {
				t.Fatal("stale common edit changed the dedicated configuration")
			}
		})
	}
}
