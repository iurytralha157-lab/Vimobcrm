package stageconfig

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestInactivityAlertEditRejectsRetypingAnotherRule(t *testing.T) {
	for _, config := range []any{nil, map[string]any{}, map[string]any{"automation_type": "send_whatsapp"}} {
		if !errors.Is(validateInactivityAlertEdit(StageAutomation{Config: config}), ErrInvalidInput) {
			t.Fatal("inactivity editor accepted a different rule")
		}
	}
	for _, key := range []string{"automation_type", "action_type"} {
		if err := validateInactivityAlertEdit(StageAutomation{Config: map[string]any{key: "alert_on_inactivity"}}); err != nil {
			t.Fatal(err)
		}
	}
}

func TestAutomationEditReadsActivationAfterWaitingForStageLockPostgres(t *testing.T) {
	f := openInactivityPostgresFixture(t)
	f.seed(false, InactivityClockLastInteraction, InactivityStartAtActivation)
	f.exec(`alter table public.stage_automations add column config jsonb default '{}', add column created_at timestamptz default now();
 alter table public.stages add column is_won boolean default false,add column is_lost boolean default false;`)
	f.exec(`update public.stage_automations set is_active=false,config='{"automation_type":"change_deal_status_on_enter","action_config":{"deal_status":"won"}}' where id=$1;
 insert into public.stage_automations(id,organization_id,stage_id,trigger_type,is_active,config) values($2,$3,$4,'on_enter',true,'{"automation_type":"change_assignee_on_enter","action_config":{"target_user_id":"00000000-0000-4000-8000-000000000401"}}')`, inactivityFixtureID(301), inactivityFixtureID(303), inactivityFixtureID(1), inactivityFixtureID(201))
	activation, err := f.db.Pool().Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer rollbackInactivityTransaction(activation)
	if err := f.repo.lockAutomationStage(f.ctx, activation, inactivityFixtureID(1), inactivityFixtureID(201)); err != nil {
		t.Fatal(err)
	}
	if _, err := activation.Exec(f.ctx, `update public.stage_automations set is_active=true where id=$1`, inactivityFixtureID(301)); err != nil {
		t.Fatal(err)
	}
	actor := tenant.Context{OrganizationID: inactivityFixtureID(1), UserID: inactivityFixtureID(401), MemberRole: "admin"}
	var expectedUpdatedAt time.Time
	if err := f.db.Pool().QueryRow(f.ctx, `select updated_at from public.stage_automations where id=$1`, inactivityFixtureID(301)).Scan(&expectedUpdatedAt); err != nil {
		t.Fatal(err)
	}
	result := make(chan error, 1)
	go func() {
		_, err := f.repo.UpdateAutomation(f.ctx, actor, inactivityFixtureID(301), stageAutomationInput{ExpectedUpdatedAt: expectedUpdatedAt, TriggerType: "on_enter", Config: map[string]any{"automation_type": "change_assignee_on_enter", "action_config": map[string]any{"target_user_id": inactivityFixtureID(401)}}})
		result <- err
	}()
	deadline := time.Now().Add(5 * time.Second)
	blocked := false
	for time.Now().Before(deadline) {
		var count int
		if err := f.db.Pool().QueryRow(f.ctx, `select count(*) from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%from public.stages%'`).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count > 0 {
			blocked = true
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !blocked {
		t.Fatal("edit did not wait on the competing activation's stage lock")
	}
	if err := activation.Commit(f.ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-result:
		if !errors.Is(err, ErrInvalidInput) || !strings.Contains(err.Error(), "responsável") {
			t.Fatalf("active conflict was not rejected after wait: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("edit did not resume")
	}
	if f.count(`select count(*) from public.stage_automations where id=$1 and is_active and config->>'automation_type'='change_deal_status_on_enter'`, inactivityFixtureID(301)) != 1 {
		t.Fatal("failed conversion changed stored rule")
	}
	tx, err := f.db.Pool().Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer rollbackInactivityTransaction(tx)
	if _, err := readLockedAutomationRevision(context.Background(), tx, inactivityFixtureID(2), inactivityFixtureID(201), inactivityFixtureID(301), expectedUpdatedAt); !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign tenant read: %v", err)
	}
}

func TestInactivityWriterPreservesExistingConfigurationPostgres(t *testing.T) {
	for _, modern := range []bool{true, false} {
		t.Run(map[bool]string{true: "config", false: "legacy"}[modern], func(t *testing.T) {
			f := openInactivityPostgresFixture(t)
			f.seed(false, InactivityClockLastInteraction, InactivityStartAtActivation)
			f.exec(`alter table public.stage_automations add column config jsonb default '{}',add column created_at timestamptz default now(),
 add column action_type text,add column automation_type text,add column action_config jsonb default '{}',add column trigger_days integer,
 add column target_stage_id uuid,add column whatsapp_template text,add column alert_message text;`)
			f.exec(`update public.stage_automations set config='{"automation_type":"alert_on_inactivity","action_config":{"recipients":["owner"],"sound":false},"extension":{"preserve":true},"trigger_days":9}',
 action_type='alert_on_inactivity',automation_type='alert_on_inactivity',action_config='{"recipients":["owner"],"sound":false}',trigger_days=9 where id=$1`, inactivityFixtureID(301))
			tx, err := f.db.Pool().Begin(f.ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer rollbackInactivityTransaction(tx)
			updated, err := writeInactivityAutomation(f.ctx, tx, inactivityFixtureID(1), inactivityFixtureID(201), inactivityFixtureID(301), stageInactivityInput{Days: 2, Message: "Synthetic updated", Enabled: false}, modern)
			if err != nil {
				t.Fatal(err)
			}
			config, ok := updated.Config.(map[string]any)
			if !ok {
				t.Fatal("config missing")
			}
			action, ok := config["action_config"].(map[string]any)
			if !ok || action["sound"] != false || len(action["recipients"].([]any)) != 1 {
				t.Fatalf("action_config erased: %+v", config)
			}
			if modern && config["extension"].(map[string]any)["preserve"] != true {
				t.Fatal("extension erased")
			}
			if config["trigger_days"] != float64(2) || config["alert_message"] != "Synthetic updated" {
				t.Fatal("intended fields not saved")
			}
			if err := tx.Commit(f.ctx); err != nil {
				t.Fatal(err)
			}
			if f.count(`select count(*) from public.stage_automations where organization_id=$1 and trigger_days is null and config='{}'`, inactivityFixtureID(2)) != 1 {
				t.Fatal("foreign organization's config changed")
			}
		})
	}
}
