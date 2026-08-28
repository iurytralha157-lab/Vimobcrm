package cadences

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/attention"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// These tests exercise the real repository SQL and are intentionally opt-in.
// CADENCE_TEST_DATABASE_URL must point to a loopback-only, disposable database.
// Every test creates its own organization-scoped fixture and removes it.
func TestUpsertOperationalRulesRejectsConcurrentStaleManagerSaveAgainstDatabase(t *testing.T) {
	ctx, postgres := openLocalCadenceTestDatabase(t)
	fixture := createOperationalRulesFixture(t, ctx, postgres, "revision-race")
	repository := NewRepository(postgres)

	initial, err := repository.GetOperationalRules(
		ctx,
		fixture.tenantContext(),
		fixture.stageID,
	)
	if err != nil {
		t.Fatalf("load initial operational rules: %v", err)
	}
	if initial.Revision != 0 {
		t.Fatalf("new stage must start at revision zero, got %d", initial.Revision)
	}

	localSilence := operationalRulesRequestFromRules(initial)
	localSilence.Attention.SourceMode = "local"
	localSilence.Attention.Mode = "disabled"
	localSilence.Attention.BusinessHoursOnly = true

	inherit := operationalRulesRequestFromRules(initial)
	inherit.Attention.SourceMode = "inherit"
	inherit.Attention.Mode = "disabled"
	inherit.Attention.BusinessHoursOnly = false

	start := make(chan struct{})
	results := make(chan struct {
		rules OperationalRules
		err   error
	}, 2)
	var wait sync.WaitGroup
	for _, request := range []OperationalRulesRequest{localSilence, inherit} {
		request := request
		wait.Add(1)
		go func() {
			defer wait.Done()
			<-start
			rules, saveErr := repository.UpsertOperationalRules(
				ctx,
				fixture.tenantContext(),
				fixture.stageID,
				request,
			)
			results <- struct {
				rules OperationalRules
				err   error
			}{rules: rules, err: saveErr}
		}()
	}
	close(start)
	wait.Wait()
	close(results)

	var winner OperationalRules
	successes := 0
	conflicts := 0
	for result := range results {
		switch {
		case result.err == nil:
			successes++
			winner = result.rules
		case errors.Is(result.err, ErrOperationalRulesConflict):
			conflicts++
		default:
			t.Fatalf("unexpected concurrent save result: %v", result.err)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("expected one winner and one stale conflict, successes=%d conflicts=%d", successes, conflicts)
	}
	if winner.Revision != 1 {
		t.Fatalf("winning manager save must advance to revision one, got %d", winner.Revision)
	}

	reloaded, err := repository.GetOperationalRules(
		ctx,
		fixture.tenantContext(),
		fixture.stageID,
	)
	if err != nil {
		t.Fatalf("reload winning operational rules: %v", err)
	}
	if reloaded.Revision != winner.Revision ||
		reloaded.Attention.SourceMode != winner.Attention.SourceMode ||
		reloaded.Attention.BusinessHoursOnly != winner.Attention.BusinessHoursOnly {
		t.Fatalf("stale save overwrote the winner: winner=%+v reloaded=%+v", winner, reloaded)
	}
}

func TestUpsertOperationalRulesLifecycleAgainstDatabase(t *testing.T) {
	ctx, postgres := openLocalCadenceTestDatabase(t)
	fixture := createOperationalRulesFixture(t, ctx, postgres, "lifecycle")
	repository := NewRepository(postgres)

	var leadID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.leads (
			organization_id,
			pipeline_id,
			stage_id,
			assigned_user_id,
			name,
			source,
			deal_status,
			stage_entered_at
		) values (
			$1::uuid,
			$2::uuid,
			$3::uuid,
			$4::uuid,
			$5,
			'manual',
			'open',
			now() - interval '10 minutes'
		)
		returning id::text
	`, fixture.organizationID, fixture.pipelineID, fixture.stageID, fixture.userID, fixture.suffix+"-lead").Scan(&leadID); err != nil {
		t.Fatalf("create lead already in target stage: %v", err)
	}

	assertLeadCadenceCounts(t, ctx, postgres, leadID, cadenceCounts{})

	firstWarning := 5
	secondWarning := 10
	initialRequest := OperationalRulesRequest{
		StageID:    fixture.stageID,
		PipelineID: fixture.pipelineID,
		Revision:   int64PointerForTest(0),
		Cadence: OperationalCadenceRule{
			Enabled: true,
			Tasks: []OperationalCadenceTask{
				{
					Position:        1,
					Type:            "call",
					Title:           "Primeiro contato",
					DueMinutes:      30,
					WarningMinutes:  &firstWarning,
					IsRequired:      true,
					OutcomeRequired: true,
				},
				{
					Position:       2,
					Type:           "message",
					Title:          "Retorno por mensagem",
					DueMinutes:     60,
					WarningMinutes: &secondWarning,
					IsRequired:     false,
				},
			},
		},
		Attention: OperationalAttentionRule{
			SourceMode:     "inherit",
			Mode:           "disabled",
			WarningMinutes: 0,
		},
		Lifecycle: defaultOperationalLifecycleRule(),
	}

	activated, err := repository.UpsertOperationalRules(ctx, fixture.tenantContext(), fixture.stageID, initialRequest)
	if err != nil {
		t.Fatalf("activate operational cadence: %v", err)
	}
	if !activated.Cadence.Enabled || activated.Cadence.TemplateID == nil || len(activated.Cadence.Tasks) != 2 {
		t.Fatalf("activation returned an incomplete cadence: %+v", activated.Cadence)
	}
	for index, task := range activated.Cadence.Tasks {
		if task.ID == nil {
			t.Fatalf("activation task %d has no stable id", index)
		}
	}
	assertLeadCadenceCounts(t, ctx, postgres, leadID, cadenceCounts{})

	var nextStageID string
	if err := postgres.Pool().QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&nextStageID); err != nil {
		t.Fatalf("generate next stage id: %v", err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.stages (
			id,
			organization_id,
			pipeline_id,
			name,
			stage_key,
			position,
			is_active
		) values (
			$1::uuid,
			$2::uuid,
			$3::uuid,
			$4,
			$5,
			2,
			true
		)
	`, nextStageID, fixture.organizationID, fixture.pipelineID, fixture.suffix+" next stage", fixture.suffix+"-next-stage"); err != nil {
		t.Fatalf("create lifecycle next stage: %v", err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.leads
		set stage_id = $3::uuid, stage_entered_at = now(), updated_at = now()
		where organization_id = $1::uuid and id = $2::uuid
	`, fixture.organizationID, leadID, nextStageID); err != nil {
		t.Fatalf("move lead out of configured stage: %v", err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.leads
		set stage_id = $3::uuid, stage_entered_at = now(), updated_at = now()
		where organization_id = $1::uuid and id = $2::uuid
	`, fixture.organizationID, leadID, fixture.stageID); err != nil {
		t.Fatalf("move lead into a fresh configured stage cycle: %v", err)
	}

	firstEnrollmentID := activeEnrollmentID(t, ctx, postgres, leadID)
	assertLeadCadenceCounts(t, ctx, postgres, leadID, cadenceCounts{
		enrollments:       1,
		activeEnrollments: 1,
		tasks:             2,
		pendingTasks:      2,
	})
	if err := attention.NewRepository(postgres).Process(ctx); err != nil {
		t.Fatalf("reconcile cadence task attention: %v", err)
	}
	var taskDueAt, attentionDueAt, attentionWarningAt time.Time
	if err := postgres.Pool().QueryRow(ctx, `
		select task.due_at, instance.due_at, instance.warning_at
		from public.lead_tasks task
		join public.lead_attention_instances instance
		  on instance.organization_id = task.organization_id
		 and (instance.metadata->>'lead_task_id')::uuid = task.id
		join public.lead_attention_policies policy
		  on policy.organization_id = instance.organization_id
		 and policy.id = instance.policy_id
		 and policy.policy_type = 'cadence_task'
		where task.organization_id = $1::uuid
		  and task.lead_id = $2::uuid
		  and task.cadence_template_task_id = $3::uuid
	`, fixture.organizationID, leadID, *activated.Cadence.Tasks[0].ID).Scan(
		&taskDueAt,
		&attentionDueAt,
		&attentionWarningAt,
	); err != nil {
		var diagnostic string
		_ = postgres.Pool().QueryRow(ctx, `
			select jsonb_build_object(
			  'task', (
			    select jsonb_build_object(
			      'id', task.id,
			      'created_at', task.created_at,
			      'due_at', task.due_at,
			      'status', task.status,
			      'metadata', task.metadata,
			      'enrollment_status', enrollment.status
			    )
			    from public.lead_tasks task
			    left join public.cadence_enrollments enrollment
			      on enrollment.organization_id = task.organization_id
			     and enrollment.id = task.cadence_enrollment_id
			    where task.organization_id = $1::uuid
			      and task.lead_id = $2::uuid
			      and task.cadence_template_task_id = $3::uuid
			    limit 1
			  ),
			  'policy', (
			    select jsonb_build_object(
			      'id', policy.id,
			      'status', policy.status,
			      'created_at', policy.created_at,
			      'config', policy.config
			    )
			    from public.lead_attention_policies policy
			    where policy.organization_id = $1::uuid
			      and policy.pipeline_id = $4::uuid
			      and policy.stage_id = $5::uuid
			      and policy.policy_type = 'cadence_task'
			      and policy.status <> 'archived'
			    limit 1
			  ),
			  'instances', (
			    select count(*)
			    from public.lead_attention_instances instance
			    where instance.organization_id = $1::uuid
			      and instance.lead_id = $2::uuid
			  )
			)::text
		`, fixture.organizationID, leadID, *activated.Cadence.Tasks[0].ID, fixture.pipelineID, fixture.stageID).Scan(&diagnostic)
		t.Logf("cadence attention diagnostic: %s", diagnostic)
		t.Fatalf("read cadence task attention timing: %v", err)
	}
	if !attentionDueAt.Equal(taskDueAt) {
		t.Fatalf("cadence attention changed the canonical task due time: task=%s attention=%s", taskDueAt, attentionDueAt)
	}
	if got := attentionDueAt.Sub(attentionWarningAt); got != 5*time.Minute {
		t.Fatalf("cadence warning does not match the task template: got=%s want=%s", got, 5*time.Minute)
	}

	var completedTaskID string
	if err := postgres.Pool().QueryRow(ctx, `
		update public.lead_tasks
		set status = 'completed',
		    is_done = true,
		    done_at = now(),
		    completed_at = now(),
		    done_by = $3::uuid,
		    outcome = 'answered',
		    updated_at = now()
		where organization_id = $1::uuid
		  and cadence_enrollment_id = $2::uuid
		  and cadence_template_task_id = $4::uuid
		returning id::text
	`, fixture.organizationID, firstEnrollmentID, fixture.userID, *activated.Cadence.Tasks[0].ID).Scan(&completedTaskID); err != nil {
		t.Fatalf("complete first cadence task: %v", err)
	}
	completedSnapshot := taskSnapshot(t, ctx, postgres, completedTaskID)

	identicalRequest := operationalRulesRequestFromRules(activated)
	savedAgain, err := repository.UpsertOperationalRules(ctx, fixture.tenantContext(), fixture.stageID, identicalRequest)
	if err != nil {
		t.Fatalf("save identical operational rules: %v", err)
	}
	if savedAgain.Cadence.TemplateID == nil || *savedAgain.Cadence.TemplateID != *activated.Cadence.TemplateID {
		t.Fatalf("identical save replaced the template: before=%v after=%v", activated.Cadence.TemplateID, savedAgain.Cadence.TemplateID)
	}
	if got := activeEnrollmentID(t, ctx, postgres, leadID); got != firstEnrollmentID {
		t.Fatalf("identical save reset enrollment: before=%s after=%s", firstEnrollmentID, got)
	}
	assertLeadCadenceCounts(t, ctx, postgres, leadID, cadenceCounts{
		enrollments:       1,
		activeEnrollments: 1,
		tasks:             2,
		pendingTasks:      1,
		completedTasks:    1,
	})
	if got := taskSnapshot(t, ctx, postgres, completedTaskID); got != completedSnapshot {
		t.Fatalf("identical save changed completed progress\nbefore: %s\nafter:  %s", completedSnapshot, got)
	}

	var fullyCompletedLeadID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.leads (
			organization_id,
			pipeline_id,
			stage_id,
			assigned_user_id,
			name,
			source,
			deal_status
		) values (
			$1::uuid,
			$2::uuid,
			$3::uuid,
			$4::uuid,
			$5,
			'manual',
			'open'
		)
		returning id::text
	`, fixture.organizationID, fixture.pipelineID, fixture.stageID, fixture.userID, fixture.suffix+"-completed-lead").Scan(&fullyCompletedLeadID); err != nil {
		t.Fatalf("create lead for completed-enrollment guard: %v", err)
	}
	fullyCompletedEnrollmentID := activeEnrollmentID(t, ctx, postgres, fullyCompletedLeadID)
	if _, err := postgres.Pool().Exec(ctx, `
		update public.lead_tasks
		set status = 'completed',
		    is_done = true,
		    done_at = now(),
		    completed_at = now(),
		    done_by = $3::uuid,
		    outcome = 'answered',
		    updated_at = now()
		where organization_id = $1::uuid
		  and cadence_enrollment_id = $2::uuid
	`, fixture.organizationID, fullyCompletedEnrollmentID, fixture.userID); err != nil {
		t.Fatalf("complete every task in enrollment: %v", err)
	}
	assertLeadCadenceCounts(t, ctx, postgres, fullyCompletedLeadID, cadenceCounts{
		enrollments:          1,
		completedEnrollments: 1,
		tasks:                2,
		completedTasks:       2,
	})
	fullyCompletedEnrollmentSnapshot := enrollmentSnapshot(t, ctx, postgres, fullyCompletedEnrollmentID)

	savedAfterCompletion, err := repository.UpsertOperationalRules(
		ctx,
		fixture.tenantContext(),
		fixture.stageID,
		operationalRulesRequestFromRules(savedAgain),
	)
	if err != nil {
		t.Fatalf("save rules with completed enrollment in current stage cycle: %v", err)
	}
	assertLeadCadenceCounts(t, ctx, postgres, fullyCompletedLeadID, cadenceCounts{
		enrollments:          1,
		completedEnrollments: 1,
		tasks:                2,
		completedTasks:       2,
	})
	if got := enrollmentSnapshot(t, ctx, postgres, fullyCompletedEnrollmentID); got != fullyCompletedEnrollmentSnapshot {
		t.Fatalf("identical save reopened or changed completed enrollment\nbefore: %s\nafter:  %s", fullyCompletedEnrollmentSnapshot, got)
	}

	disabledRequest := operationalRulesRequestFromRules(savedAfterCompletion)
	disabledRequest.Cadence.Enabled = false
	disabled, err := repository.UpsertOperationalRules(ctx, fixture.tenantContext(), fixture.stageID, disabledRequest)
	if err != nil {
		t.Fatalf("disable operational cadence: %v", err)
	}
	if disabled.Cadence.Enabled {
		t.Fatal("disabled cadence was returned as enabled")
	}
	assertLeadCadenceCounts(t, ctx, postgres, leadID, cadenceCounts{
		enrollments:          1,
		cancelledEnrollments: 1,
		tasks:                2,
		completedTasks:       1,
		cancelledTasks:       1,
	})
	assertEnrollmentState(t, ctx, postgres, firstEnrollmentID, "cancelled", "stage_cadence_disabled")
	if got := taskSnapshot(t, ctx, postgres, completedTaskID); got != completedSnapshot {
		t.Fatalf("disabling cadence changed completed history\nbefore: %s\nafter:  %s", completedSnapshot, got)
	}
	cancelledTaskID := enrollmentTaskIDByStatus(t, ctx, postgres, firstEnrollmentID, "cancelled")
	cancelledSnapshot := taskSnapshot(t, ctx, postgres, cancelledTaskID)

	reactivatedRequest := operationalRulesRequestFromRules(disabled)
	reactivatedRequest.Cadence.Enabled = true
	reactivated, err := repository.UpsertOperationalRules(ctx, fixture.tenantContext(), fixture.stageID, reactivatedRequest)
	if err != nil {
		t.Fatalf("reactivate operational cadence: %v", err)
	}
	if !reactivated.Cadence.Enabled {
		t.Fatal("reactivated cadence was returned as disabled")
	}
	assertLeadCadenceCounts(t, ctx, postgres, leadID, cadenceCounts{
		enrollments:          1,
		cancelledEnrollments: 1,
		tasks:                2,
		completedTasks:       1,
		cancelledTasks:       1,
	})
	if _, err := postgres.Pool().Exec(ctx, `
		update public.leads
		set stage_id = $3::uuid, stage_entered_at = now(), updated_at = now()
		where organization_id = $1::uuid and id = $2::uuid
	`, fixture.organizationID, leadID, nextStageID); err != nil {
		t.Fatalf("move reactivated lead out of configured stage: %v", err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.leads
		set stage_id = $3::uuid, stage_entered_at = now(), updated_at = now()
		where organization_id = $1::uuid and id = $2::uuid
	`, fixture.organizationID, leadID, fixture.stageID); err != nil {
		t.Fatalf("start fresh stage cycle after reactivation: %v", err)
	}
	secondEnrollmentID := activeEnrollmentID(t, ctx, postgres, leadID)
	if secondEnrollmentID == firstEnrollmentID {
		t.Fatalf("reactivation revived cancelled enrollment %s instead of creating a new one", firstEnrollmentID)
	}
	assertLeadCadenceCounts(t, ctx, postgres, leadID, cadenceCounts{
		enrollments:          2,
		activeEnrollments:    1,
		cancelledEnrollments: 1,
		tasks:                4,
		pendingTasks:         2,
		completedTasks:       1,
		cancelledTasks:       1,
	})
	assertEnrollmentState(t, ctx, postgres, firstEnrollmentID, "cancelled", "stage_cadence_disabled")
	assertEnrollmentState(t, ctx, postgres, secondEnrollmentID, "active", "")
	if got := taskSnapshot(t, ctx, postgres, completedTaskID); got != completedSnapshot {
		t.Fatalf("reactivation changed completed history\nbefore: %s\nafter:  %s", completedSnapshot, got)
	}
	if got := taskSnapshot(t, ctx, postgres, cancelledTaskID); got != cancelledSnapshot {
		t.Fatalf("reactivation revived or changed cancelled history\nbefore: %s\nafter:  %s", cancelledSnapshot, got)
	}
	assertLeadCadenceCounts(t, ctx, postgres, fullyCompletedLeadID, cadenceCounts{
		enrollments:          1,
		completedEnrollments: 1,
		tasks:                2,
		completedTasks:       2,
	})
	if got := enrollmentSnapshot(t, ctx, postgres, fullyCompletedEnrollmentID); got != fullyCompletedEnrollmentSnapshot {
		t.Fatalf("disable/reactivation changed completed enrollment history\nbefore: %s\nafter:  %s", fullyCompletedEnrollmentSnapshot, got)
	}
}

func TestUpsertOperationalRulesPreservesAttentionIdentityAgainstDatabase(t *testing.T) {
	ctx, postgres := openLocalCadenceTestDatabase(t)
	fixture := createOperationalRulesFixture(t, ctx, postgres, "attention")
	repository := NewRepository(postgres)

	var leadID, stageCycleID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.leads (
			organization_id,
			pipeline_id,
			stage_id,
			assigned_user_id,
			name,
			source,
			deal_status
		) values (
			$1::uuid,
			$2::uuid,
			$3::uuid,
			$4::uuid,
			$5,
			'manual',
			'open'
		)
		returning id::text
	`, fixture.organizationID, fixture.pipelineID, fixture.stageID, fixture.userID, fixture.suffix+"-lead").Scan(&leadID); err != nil {
		t.Fatalf("create attention fixture lead: %v", err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select id::text
		from public.lead_stage_cycles
		where organization_id = $1::uuid
		  and lead_id = $2::uuid
		  and stage_id = $3::uuid
		  and exited_at is null
	`, fixture.organizationID, leadID, fixture.stageID).Scan(&stageCycleID); err != nil {
		t.Fatalf("read current attention stage cycle: %v", err)
	}

	firstOutreachMinutes := 60
	initialRequest := OperationalRulesRequest{
		StageID:    fixture.stageID,
		PipelineID: fixture.pipelineID,
		Revision:   int64PointerForTest(0),
		Cadence: OperationalCadenceRule{
			Enabled: false,
			Tasks:   []OperationalCadenceTask{},
		},
		Attention: OperationalAttentionRule{
			SourceMode:           "local",
			Mode:                 "enabled",
			FirstOutreachMinutes: &firstOutreachMinutes,
			WarningMinutes:       10,
			BusinessHoursOnly:    false,
		},
		Lifecycle: defaultOperationalLifecycleRule(),
	}
	created, err := repository.UpsertOperationalRules(ctx, fixture.tenantContext(), fixture.stageID, initialRequest)
	if err != nil {
		t.Fatalf("create stage attention policy: %v", err)
	}
	initialPolicy := attentionPolicyByType(t, ctx, postgres, fixture, "first_contact")
	if initialPolicy.version != 1 || initialPolicy.thresholdMinutes != firstOutreachMinutes || initialPolicy.status != "enabled" {
		t.Fatalf("unexpected initial attention policy: %+v", initialPolicy)
	}

	var instanceID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.lead_attention_instances (
			organization_id,
			lead_id,
			policy_id,
			policy_version,
			cycle_key,
			stage_cycle_id,
			assigned_user_id,
			pipeline_id,
			stage_id,
			baseline_at,
			warning_at,
			due_at,
			next_evaluation_at,
			status,
			shadow,
			warning_sent_at,
			breach_sent_at,
			last_reminder_at,
			reminder_count,
			metadata
		) values (
			$1::uuid,
			$2::uuid,
			$3::uuid,
			$4,
			$5,
			$6::uuid,
			$7::uuid,
			$8::uuid,
			$9::uuid,
			now() - interval '120 minutes',
			now() - interval '70 minutes',
			now() - interval '60 minutes',
			now() + interval '5 minutes',
			'breached',
			false,
			now() - interval '55 minutes',
			now() - interval '50 minutes',
			now() - interval '5 minutes',
			2,
			'{"source":"cadence_operational_rules_integration"}'::jsonb
		)
		returning id::text
	`, fixture.organizationID, leadID, initialPolicy.id, initialPolicy.version,
		fixture.suffix+"-first-contact-cycle", stageCycleID, fixture.userID,
		fixture.pipelineID, fixture.stageID).Scan(&instanceID); err != nil {
		t.Fatalf("create current-cycle attention instance: %v", err)
	}
	initialInstanceSnapshot := attentionInstanceSnapshot(t, ctx, postgres, instanceID)
	initialWarningSentAt, initialBreachSentAt := attentionInstanceSentFlags(t, ctx, postgres, instanceID)

	savedIdentically, err := repository.UpsertOperationalRules(
		ctx,
		fixture.tenantContext(),
		fixture.stageID,
		operationalRulesRequestFromRules(created),
	)
	if err != nil {
		t.Fatalf("save identical attention policy: %v", err)
	}
	policyAfterIdenticalSave := attentionPolicyByType(t, ctx, postgres, fixture, "first_contact")
	if policyAfterIdenticalSave != initialPolicy {
		t.Fatalf(
			"identical PUT changed policy identity or version\nbefore: %+v\nafter:  %+v",
			initialPolicy,
			policyAfterIdenticalSave,
		)
	}
	if got := attentionInstanceSnapshot(t, ctx, postgres, instanceID); got != initialInstanceSnapshot {
		t.Fatalf("identical PUT changed current-cycle attention instance\nbefore: %s\nafter:  %s", initialInstanceSnapshot, got)
	}

	changedThreshold := 90
	changedRequest := operationalRulesRequestFromRules(savedIdentically)
	changedRequest.Attention.FirstOutreachMinutes = &changedThreshold
	changed, err := repository.UpsertOperationalRules(ctx, fixture.tenantContext(), fixture.stageID, changedRequest)
	if err != nil {
		t.Fatalf("change attention threshold: %v", err)
	}
	policyAfterThresholdChange := attentionPolicyByType(t, ctx, postgres, fixture, "first_contact")
	if policyAfterThresholdChange.id != initialPolicy.id ||
		policyAfterThresholdChange.policyKey != initialPolicy.policyKey ||
		policyAfterThresholdChange.version != initialPolicy.version {
		t.Fatalf(
			"threshold change replaced policy identity: before=%+v after=%+v",
			initialPolicy,
			policyAfterThresholdChange,
		)
	}
	if policyAfterThresholdChange.thresholdMinutes != changedThreshold {
		t.Fatalf(
			"threshold change was not persisted: got %d, want %d",
			policyAfterThresholdChange.thresholdMinutes,
			changedThreshold,
		)
	}
	var instanceShadow, grandfatheredShadow bool
	var instanceStatusBeforeDisable string
	if err := postgres.Pool().QueryRow(ctx, `
		select
			shadow,
			coalesce((metadata->>'grandfathered_shadow')::boolean, false),
			status
		from public.lead_attention_instances
		where id = $1::uuid
	`, instanceID).Scan(&instanceShadow, &grandfatheredShadow, &instanceStatusBeforeDisable); err != nil {
		t.Fatalf("read reconfigured attention instance: %v", err)
	}
	if !instanceShadow || !grandfatheredShadow || instanceStatusBeforeDisable != "breached" {
		t.Fatalf(
			"threshold change must preserve the state but grandfather the existing cycle in shadow: shadow=%v grandfathered=%v status=%s",
			instanceShadow,
			grandfatheredShadow,
			instanceStatusBeforeDisable,
		)
	}
	warningAfterChange, breachAfterChange := attentionInstanceSentFlags(t, ctx, postgres, instanceID)
	if warningAfterChange != initialWarningSentAt || breachAfterChange != initialBreachSentAt {
		t.Fatalf(
			"threshold change erased attention delivery history: warning %q -> %q, breach %q -> %q",
			initialWarningSentAt,
			warningAfterChange,
			initialBreachSentAt,
			breachAfterChange,
		)
	}

	disabledRequest := operationalRulesRequestFromRules(changed)
	disabledRequest.Attention.Mode = "disabled"
	disabledRules, err := repository.UpsertOperationalRules(ctx, fixture.tenantContext(), fixture.stageID, disabledRequest)
	if err != nil {
		t.Fatalf("disable attention policy: %v", err)
	}
	pausedPolicy := attentionPolicyByID(t, ctx, postgres, initialPolicy.id)
	if pausedPolicy.id != initialPolicy.id ||
		pausedPolicy.policyKey != initialPolicy.policyKey ||
		pausedPolicy.version != initialPolicy.version ||
		pausedPolicy.status != "paused" {
		t.Fatalf("local disable must retain an explicit stage tombstone: before=%+v after=%+v", initialPolicy, pausedPolicy)
	}
	var disabledOverride bool
	if err := postgres.Pool().QueryRow(ctx, `
		select coalesce((config->>'disabled_override')::boolean, false)
		from public.lead_attention_policies
		where id = $1::uuid
	`, initialPolicy.id).Scan(&disabledOverride); err != nil {
		t.Fatalf("read disabled override marker: %v", err)
	}
	if !disabledOverride {
		t.Fatal("local disable did not persist its inherited-policy tombstone")
	}

	var instanceStatus, resolvedReason string
	if err := postgres.Pool().QueryRow(ctx, `
		select status, coalesce(resolved_reason, '')
		from public.lead_attention_instances
		where id = $1::uuid
	`, instanceID).Scan(&instanceStatus, &resolvedReason); err != nil {
		t.Fatalf("read disabled attention instance: %v", err)
	}
	if instanceStatus != "cancelled" || resolvedReason != "stage_policy_disabled" {
		t.Fatalf(
			"disable did not cancel open attention instance: status=%s reason=%q",
			instanceStatus,
			resolvedReason,
		)
	}
	warningSentAt, breachSentAt := attentionInstanceSentFlags(t, ctx, postgres, instanceID)
	if warningSentAt != initialWarningSentAt || breachSentAt != initialBreachSentAt {
		t.Fatalf(
			"disable erased attention delivery history: warning %q -> %q, breach %q -> %q",
			initialWarningSentAt,
			warningSentAt,
			initialBreachSentAt,
			breachSentAt,
		)
	}

	inheritRequest := operationalRulesRequestFromRules(disabledRules)
	inheritRequest.Attention.SourceMode = "inherit"
	if _, err := repository.UpsertOperationalRules(ctx, fixture.tenantContext(), fixture.stageID, inheritRequest); err != nil {
		t.Fatalf("release stage attention policy to inheritance: %v", err)
	}
	releasedPolicy := attentionPolicyByID(t, ctx, postgres, initialPolicy.id)
	if releasedPolicy.status != "archived" {
		t.Fatalf("inherit mode must archive the stage-owned override: %+v", releasedPolicy)
	}
}

func TestOperationalAttentionLocalTombstoneBlocksAndInheritanceResumesAgainstDatabase(t *testing.T) {
	ctx, postgres := openLocalCadenceTestDatabase(t)
	fixture := createOperationalRulesFixture(t, ctx, postgres, "attention-tombstone")
	repository := NewRepository(postgres)

	var globalPolicyID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.lead_attention_policies (
			organization_id,
			name,
			policy_type,
			status,
			threshold_minutes,
			warning_minutes,
			notify_assignee,
			config,
			created_by
		) values (
			$1::uuid,
			'Primeiro contato global',
			'first_contact',
			'enabled',
			60,
			10,
			true,
			'{"source":"attention_center"}'::jsonb,
			$2::uuid
		)
		returning id::text
	`, fixture.organizationID, fixture.userID).Scan(&globalPolicyID); err != nil {
		t.Fatalf("create global first-contact policy: %v", err)
	}

	localDisabled := OperationalRulesRequest{
		StageID:    fixture.stageID,
		PipelineID: fixture.pipelineID,
		Revision:   int64PointerForTest(0),
		Cadence: OperationalCadenceRule{
			Enabled: false,
			Tasks:   []OperationalCadenceTask{},
		},
		Attention: OperationalAttentionRule{
			SourceMode:     "local",
			Mode:           "disabled",
			WarningMinutes: 0,
		},
		Lifecycle: defaultOperationalLifecycleRule(),
	}
	savedLocalDisabled, err := repository.UpsertOperationalRules(ctx, fixture.tenantContext(), fixture.stageID, localDisabled)
	if err != nil {
		t.Fatalf("save explicit local attention silence: %v", err)
	}

	tombstone := attentionPolicyByType(t, ctx, postgres, fixture, "first_contact")
	if tombstone.status != "paused" {
		t.Fatalf("local silence did not create a paused tombstone: %+v", tombstone)
	}
	var disabledOverride bool
	if err := postgres.Pool().QueryRow(ctx, `
		select coalesce((config->>'disabled_override')::boolean, false)
		from public.lead_attention_policies
		where id = $1::uuid
	`, tombstone.id).Scan(&disabledOverride); err != nil {
		t.Fatalf("read tombstone metadata: %v", err)
	}
	if !disabledOverride {
		t.Fatal("local silence did not mark the stage policy as an inherited-policy override")
	}

	var leadID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.leads (
			organization_id,
			pipeline_id,
			stage_id,
			assigned_user_id,
			name,
			source,
			meta_lead_id,
			deal_status
		) values (
			$1::uuid,
			$2::uuid,
			$3::uuid,
			$4::uuid,
			$5,
			'meta',
			$6,
			'open'
		)
		returning id::text
	`, fixture.organizationID, fixture.pipelineID, fixture.stageID, fixture.userID,
		fixture.suffix+"-lead", fixture.suffix+"-meta").Scan(&leadID); err != nil {
		t.Fatalf("create eligible lead under the local tombstone: %v", err)
	}
	if err := attention.NewRepository(postgres).Process(ctx); err != nil {
		t.Fatalf("reconcile attention under local tombstone: %v", err)
	}

	var globalInstances int
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::int
		from public.lead_attention_instances
		where organization_id = $1::uuid
		  and lead_id = $2::uuid
		  and policy_id = $3::uuid
	`, fixture.organizationID, leadID, globalPolicyID).Scan(&globalInstances); err != nil {
		t.Fatalf("read inherited instances while locally blocked: %v", err)
	}
	if globalInstances != 0 {
		var diagnostic string
		_ = postgres.Pool().QueryRow(ctx, `
			select jsonb_build_object(
			  'lead', (
			    select jsonb_build_object('pipeline_id', pipeline_id, 'stage_id', stage_id)
			    from public.leads
			    where organization_id = $1::uuid and id = $2::uuid
			  ),
			  'policies', (
			    select jsonb_agg(jsonb_build_object(
			      'id', id,
			      'type', policy_type,
			      'status', status,
			      'pipeline_id', pipeline_id,
			      'stage_id', stage_id,
			      'config', config
			    ))
			    from public.lead_attention_policies
			    where organization_id = $1::uuid and policy_type = 'first_contact'
			  ),
			  'instances', (
			    select jsonb_agg(to_jsonb(instance))
			    from public.lead_attention_instances instance
			    where organization_id = $1::uuid and lead_id = $2::uuid
			  )
			)::text
		`, fixture.organizationID, leadID).Scan(&diagnostic)
		t.Fatalf("local tombstone did not block the inherited policy: instances=%d diagnostic=%s", globalInstances, diagnostic)
	}

	inherit := operationalRulesRequestFromRules(savedLocalDisabled)
	inherit.Attention.SourceMode = "inherit"
	if _, err := repository.UpsertOperationalRules(ctx, fixture.tenantContext(), fixture.stageID, inherit); err != nil {
		t.Fatalf("release local attention silence: %v", err)
	}
	if released := attentionPolicyByID(t, ctx, postgres, tombstone.id); released.status != "archived" {
		t.Fatalf("inheritance did not archive the local tombstone: %+v", released)
	}
	if err := attention.NewRepository(postgres).Process(ctx); err != nil {
		t.Fatalf("reconcile inherited policy after releasing tombstone: %v", err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::int
		from public.lead_attention_instances
		where organization_id = $1::uuid
		  and lead_id = $2::uuid
		  and policy_id = $3::uuid
		  and status not in ('resolved', 'redistributed', 'cancelled')
	`, fixture.organizationID, leadID, globalPolicyID).Scan(&globalInstances); err != nil {
		t.Fatalf("read inherited instance after releasing tombstone: %v", err)
	}
	if globalInstances != 1 {
		t.Fatalf("inherited policy did not resume after releasing the local override: instances=%d", globalInstances)
	}
}

func TestOperationalAttentionSafelyAdoptsSeededStagePolicyAgainstDatabase(t *testing.T) {
	ctx, postgres := openLocalCadenceTestDatabase(t)
	fixture := createOperationalRulesFixture(t, ctx, postgres, "attention-seed-adoption")
	repository := NewRepository(postgres)

	var seededPolicyID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.lead_attention_policies (
			organization_id,
			name,
			policy_type,
			status,
			pipeline_id,
			stage_id,
			threshold_minutes,
			warning_minutes,
			notify_assignee,
			config,
			created_by
		) values (
			$1::uuid,
			'SLA legado da etapa',
			'stage_age',
			'shadow',
			$2::uuid,
			$3::uuid,
			1440,
			60,
			true,
			'{"source":"stage_sla_hours","seeded":true}'::jsonb,
			$4::uuid
		)
		returning id::text
	`, fixture.organizationID, fixture.pipelineID, fixture.stageID, fixture.userID).Scan(&seededPolicyID); err != nil {
		t.Fatalf("create seeded legacy stage policy: %v", err)
	}

	stageMaxAgeMinutes := 2 * 24 * 60
	request := OperationalRulesRequest{
		StageID:    fixture.stageID,
		PipelineID: fixture.pipelineID,
		Revision:   int64PointerForTest(0),
		Cadence: OperationalCadenceRule{
			Enabled: false,
			Tasks:   []OperationalCadenceTask{},
		},
		Attention: OperationalAttentionRule{
			SourceMode:         "local",
			Mode:               "shadow",
			StageMaxAgeMinutes: &stageMaxAgeMinutes,
			WarningMinutes:     30,
		},
		Lifecycle: defaultOperationalLifecycleRule(),
	}
	if _, err := repository.UpsertOperationalRules(ctx, fixture.tenantContext(), fixture.stageID, request); err != nil {
		t.Fatalf("adopt seeded legacy stage policy: %v", err)
	}

	adopted := attentionPolicyByType(t, ctx, postgres, fixture, "stage_age")
	if adopted.id != seededPolicyID || adopted.status != "shadow" || adopted.thresholdMinutes != stageMaxAgeMinutes {
		t.Fatalf("seeded policy was replaced or not updated in place: seeded=%s adopted=%+v", seededPolicyID, adopted)
	}
	var source, adoptedFrom string
	if err := postgres.Pool().QueryRow(ctx, `
		select
		  coalesce(config->>'source', ''),
		  coalesce(config->>'adopted_from_source', '')
		from public.lead_attention_policies
		where id = $1::uuid
	`, seededPolicyID).Scan(&source, &adoptedFrom); err != nil {
		t.Fatalf("read adopted stage policy metadata: %v", err)
	}
	if source != "stage_operational_rules" || adoptedFrom != "stage_sla_hours" {
		t.Fatalf("seeded ownership adoption is not auditable: source=%q adopted_from=%q", source, adoptedFrom)
	}
}

func TestUpsertOperationalRulesDoesNotBackfillLegacyCyclesAndStartsOnFreshEntryAgainstDatabase(t *testing.T) {
	ctx, postgres := openLocalCadenceTestDatabase(t)
	fixture := createOperationalRulesFixture(t, ctx, postgres, "legacy-attention")
	repository := NewRepository(postgres)

	var leadID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.leads (
			organization_id,
			pipeline_id,
			stage_id,
			assigned_user_id,
			name,
			source,
			deal_status,
			stage_entered_at,
			assigned_at
		) values (
			$1::uuid,
			$2::uuid,
			$3::uuid,
			$4::uuid,
			$5,
			'manual',
			'open',
			now() - interval '30 days',
			now() - interval '30 days'
		)
		returning id::text
	`, fixture.organizationID, fixture.pipelineID, fixture.stageID, fixture.userID, fixture.suffix+"-legacy-lead").Scan(&leadID); err != nil {
		t.Fatalf("create legacy attention lead: %v", err)
	}

	// Reproduce a lead created before the attention engine: immutable enrollment
	// markers are false/null and no canonical cycles exist yet.
	legacyTx, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatalf("begin legacy lead setup: %v", err)
	}
	if _, err := legacyTx.Exec(ctx, `set local session_replication_role = replica`); err != nil {
		_ = legacyTx.Rollback(ctx)
		t.Fatalf("disable fixture triggers locally: %v", err)
	}
	if _, err := legacyTx.Exec(ctx, `
		delete from public.lead_assignment_cycles
		where organization_id = $1::uuid and lead_id = $2::uuid;

		delete from public.lead_stage_cycles
		where organization_id = $1::uuid and lead_id = $2::uuid;

		update public.leads
		set attention_eligible = false,
		    attention_enrolled_at = null
		where organization_id = $1::uuid and id = $2::uuid
	`, fixture.organizationID, leadID); err != nil {
		_ = legacyTx.Rollback(ctx)
		t.Fatalf("prepare legacy lead fixture: %v", err)
	}
	if err := legacyTx.Commit(ctx); err != nil {
		t.Fatalf("commit legacy lead fixture: %v", err)
	}

	firstOutreachMinutes := 60
	stageInactivityMinutes := 60
	stageMaxAgeMinutes := 24 * 60
	request := OperationalRulesRequest{
		StageID:    fixture.stageID,
		PipelineID: fixture.pipelineID,
		Revision:   int64PointerForTest(0),
		Cadence: OperationalCadenceRule{
			Enabled: false,
			Tasks:   []OperationalCadenceTask{},
		},
		Attention: OperationalAttentionRule{
			SourceMode:             "local",
			Mode:                   "enabled",
			FirstOutreachMinutes:   &firstOutreachMinutes,
			StageInactivityMinutes: &stageInactivityMinutes,
			StageMaxAgeMinutes:     &stageMaxAgeMinutes,
			WarningMinutes:         10,
			BusinessHoursOnly:      false,
		},
		Lifecycle: defaultOperationalLifecycleRule(),
	}
	if _, err := repository.UpsertOperationalRules(ctx, fixture.tenantContext(), fixture.stageID, request); err != nil {
		t.Fatalf("activate attention-only rules for legacy lead: %v", err)
	}

	var globalFirstContactPolicyID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.lead_attention_policies (
			organization_id,
			name,
			policy_type,
			status,
			threshold_minutes,
			warning_minutes,
			notify_assignee,
			config,
			created_by
		) values (
			$1::uuid,
			'Primeiro contato global',
			'first_contact',
			'enabled',
			30,
			5,
			true,
			'{"source":"attention_center"}'::jsonb,
			$2::uuid
		)
		returning id::text
	`, fixture.organizationID, fixture.userID).Scan(&globalFirstContactPolicyID); err != nil {
		t.Fatalf("create inherited global attention policy: %v", err)
	}

	var eligible bool
	var enrolledAt *time.Time
	if err := postgres.Pool().QueryRow(ctx, `
		select attention_eligible, attention_enrolled_at
		from public.leads
		where organization_id = $1::uuid and id = $2::uuid
	`, fixture.organizationID, leadID).Scan(&eligible, &enrolledAt); err != nil {
		t.Fatalf("read immutable legacy marker: %v", err)
	}
	if eligible || enrolledAt != nil {
		t.Fatalf("operational opt-in mutated immutable legacy marker: eligible=%v enrolled_at=%v", eligible, enrolledAt)
	}

	var stageCycles, assignmentCycles int
	var stageHistorical, assignmentHistorical bool
	if err := postgres.Pool().QueryRow(ctx, `
		select
		  count(*)::int,
		  coalesce(bool_and(coalesce((metadata->>'historical_backfill')::boolean, false)), false)
		from public.lead_stage_cycles
		where organization_id = $1::uuid and lead_id = $2::uuid and exited_at is null
	`, fixture.organizationID, leadID).Scan(&stageCycles, &stageHistorical); err != nil {
		t.Fatalf("read backfilled stage cycle: %v", err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select
		  count(*)::int,
		  coalesce(bool_and(coalesce((metadata->>'historical_backfill')::boolean, false)), false)
		from public.lead_assignment_cycles
		where organization_id = $1::uuid and lead_id = $2::uuid and ended_at is null
	`, fixture.organizationID, leadID).Scan(&assignmentCycles, &assignmentHistorical); err != nil {
		t.Fatalf("read backfilled assignment cycle: %v", err)
	}
	if stageCycles != 0 || assignmentCycles != 0 || stageHistorical || assignmentHistorical {
		t.Fatalf(
			"saving rules reconstructed legacy cycles: stage=%d/%v assignment=%d/%v",
			stageCycles,
			stageHistorical,
			assignmentCycles,
			assignmentHistorical,
		)
	}

	if err := attention.NewRepository(postgres).Process(ctx); err != nil {
		t.Fatalf("reconcile explicit operational attention for legacy lead: %v", err)
	}
	var instanceCount int
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::int
		from public.lead_attention_instances instance
		where instance.organization_id = $1::uuid
		  and instance.lead_id = $2::uuid
	`, fixture.organizationID, leadID).Scan(&instanceCount); err != nil {
		t.Fatalf("read legacy attention instances: %v", err)
	}
	if instanceCount != 0 {
		t.Fatalf("activating stage attention backfilled old cycles: instances=%d", instanceCount)
	}

	var nextStageID string
	if err := postgres.Pool().QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&nextStageID); err != nil {
		t.Fatalf("generate next stage id: %v", err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.stages (
			id,
			organization_id,
			pipeline_id,
			name,
			stage_key,
			position,
			is_active
		) values (
			$1::uuid,
			$2::uuid,
			$3::uuid,
			$4,
			$5,
			2,
			true
		)
	`, nextStageID, fixture.organizationID, fixture.pipelineID, fixture.suffix+" next stage", fixture.suffix+"-next-stage"); err != nil {
		t.Fatalf("create next stage: %v", err)
	}

	if _, err := postgres.Pool().Exec(ctx, `
		update public.leads
		set stage_id = $3::uuid, stage_entered_at = now(), updated_at = now()
		where organization_id = $1::uuid and id = $2::uuid
	`, fixture.organizationID, leadID, nextStageID); err != nil {
		t.Fatalf("move legacy lead out of the configured stage: %v", err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.leads
		set stage_id = $3::uuid, stage_entered_at = now(), updated_at = now()
		where organization_id = $1::uuid and id = $2::uuid
	`, fixture.organizationID, leadID, fixture.stageID); err != nil {
		t.Fatalf("return legacy lead into a fresh configured cycle: %v", err)
	}
	if err := attention.NewRepository(postgres).Process(ctx); err != nil {
		t.Fatalf("reconcile attention for the fresh legacy cycle: %v", err)
	}

	var legacyFreshInstances int
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::int
		from public.lead_attention_instances instance
		join public.lead_attention_policies policy
		  on policy.organization_id = instance.organization_id
		 and policy.id = instance.policy_id
		where instance.organization_id = $1::uuid
		  and instance.lead_id = $2::uuid
		  and policy.policy_type in ('first_contact', 'stage_inactivity', 'stage_age')
		  and coalesce(policy.config->>'source', '') = 'stage_operational_rules'
		  and instance.status not in ('resolved', 'redistributed', 'cancelled')
	`, fixture.organizationID, leadID).Scan(&legacyFreshInstances); err != nil {
		t.Fatalf("read fresh legacy-cycle attention instances: %v", err)
	}
	if legacyFreshInstances != 3 {
		t.Fatalf("fresh legacy cycle did not receive its operational attention: instances=%d", legacyFreshInstances)
	}

	var actionAt time.Time
	if err := postgres.Pool().QueryRow(ctx, `select clock_timestamp()`).Scan(&actionAt); err != nil {
		t.Fatalf("read action timestamp: %v", err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		select private.record_lead_action_fact(
		  $1::uuid,
		  $2::uuid,
		  $3::uuid,
		  'call',
		  'phone',
		  $4::timestamptz,
		  false,
		  false,
		  true,
		  true,
		  false,
		  'operational_rules_integration',
		  $5,
		  '{"fixture":"legacy_human_action"}'::jsonb
		)
	`, fixture.organizationID, leadID, fixture.userID, actionAt, fixture.suffix+"-legacy-action"); err != nil {
		t.Fatalf("record a human action for the legacy lead: %v", err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.lead_attention_instances instance
		set next_evaluation_at = now() - interval '1 minute'
		from public.lead_attention_policies policy
		where policy.organization_id = instance.organization_id
		  and policy.id = instance.policy_id
		  and instance.organization_id = $1::uuid
		  and instance.lead_id = $2::uuid
		  and policy.policy_type = 'stage_inactivity'
		  and instance.status not in ('resolved', 'redistributed', 'cancelled')
	`, fixture.organizationID, leadID); err != nil {
		t.Fatalf("schedule legacy inactivity instance for reconciliation: %v", err)
	}
	if err := attention.NewRepository(postgres).Process(ctx); err != nil {
		t.Fatalf("reconcile legacy human action: %v", err)
	}

	var recordedFacts, completedFirstContact int
	var inactivityBaseline, inactivityDueAt time.Time
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::int
		from public.lead_action_facts
		where organization_id = $1::uuid
		  and lead_id = $2::uuid
		  and source_type = 'operational_rules_integration'
		  and source_id = $3
	`, fixture.organizationID, leadID, fixture.suffix+"-legacy-action").Scan(&recordedFacts); err != nil {
		t.Fatalf("read legacy human action fact: %v", err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::int
		from public.lead_attention_instances instance
		join public.lead_attention_policies policy
		  on policy.organization_id = instance.organization_id
		 and policy.id = instance.policy_id
		where instance.organization_id = $1::uuid
		  and instance.lead_id = $2::uuid
		  and policy.policy_type = 'first_contact'
		  and instance.status = 'resolved'
		  and instance.resolved_reason = 'first_contact_completed'
	`, fixture.organizationID, leadID).Scan(&completedFirstContact); err != nil {
		t.Fatalf("read legacy first-contact completion: %v", err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select instance.baseline_at, instance.due_at
		from public.lead_attention_instances instance
		join public.lead_attention_policies policy
		  on policy.organization_id = instance.organization_id
		 and policy.id = instance.policy_id
		where instance.organization_id = $1::uuid
		  and instance.lead_id = $2::uuid
		  and policy.policy_type = 'stage_inactivity'
		  and instance.status not in ('resolved', 'redistributed', 'cancelled')
		order by instance.created_at desc
		limit 1
	`, fixture.organizationID, leadID).Scan(&inactivityBaseline, &inactivityDueAt); err != nil {
		t.Fatalf("read reset legacy inactivity window: %v", err)
	}
	if recordedFacts != 1 || completedFirstContact != 1 {
		t.Fatalf(
			"legacy human work was not reflected in operational attention: facts=%d first_contact_completed=%d",
			recordedFacts,
			completedFirstContact,
		)
	}
	if !inactivityBaseline.Equal(actionAt) || !inactivityDueAt.After(actionAt) {
		t.Fatalf(
			"legacy inactivity window was not reset from the human action: action=%s baseline=%s due=%s",
			actionAt,
			inactivityBaseline,
			inactivityDueAt,
		)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select attention_eligible
		from public.leads
		where organization_id = $1::uuid and id = $2::uuid
	`, fixture.organizationID, leadID).Scan(&eligible); err != nil {
		t.Fatalf("read immutable marker after legacy action: %v", err)
	}
	if eligible {
		t.Fatal("recording legacy operational work mutated the immutable enrollment marker")
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.leads
		set stage_id = $3::uuid, stage_entered_at = now(), updated_at = now()
		where organization_id = $1::uuid and id = $2::uuid
	`, fixture.organizationID, leadID, nextStageID); err != nil {
		t.Fatalf("move contacted legacy lead out of the configured stage: %v", err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.leads
		set stage_id = $3::uuid, stage_entered_at = now(), updated_at = now()
		where organization_id = $1::uuid and id = $2::uuid
	`, fixture.organizationID, leadID, fixture.stageID); err != nil {
		t.Fatalf("return contacted legacy lead to the configured stage: %v", err)
	}
	if err := attention.NewRepository(postgres).Process(ctx); err != nil {
		t.Fatalf("reconcile contacted legacy lead after stage return: %v", err)
	}
	var activeContactedFirstContact int
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::int
		from public.lead_attention_instances instance
		join public.lead_attention_policies policy
		  on policy.organization_id = instance.organization_id
		 and policy.id = instance.policy_id
		where instance.organization_id = $1::uuid
		  and instance.lead_id = $2::uuid
		  and policy.policy_type = 'first_contact'
		  and coalesce(policy.config->>'source', '') = 'stage_operational_rules'
		  and instance.status not in ('resolved', 'redistributed', 'cancelled')
	`, fixture.organizationID, leadID).Scan(&activeContactedFirstContact); err != nil {
		t.Fatalf("read first-contact state after contacted lead returned: %v", err)
	}
	if activeContactedFirstContact != 0 {
		t.Fatalf("contacted lead received a new first-contact obligation: active=%d", activeContactedFirstContact)
	}

	var freshLeadID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.leads (
			organization_id,
			pipeline_id,
			stage_id,
			assigned_user_id,
			name,
			source,
			deal_status,
			stage_entered_at,
			assigned_at
		) values (
			$1::uuid,
			$2::uuid,
			$3::uuid,
			$4::uuid,
			$5,
			'manual',
			'open',
			now(),
			now()
		)
		returning id::text
	`, fixture.organizationID, fixture.pipelineID, fixture.stageID, fixture.userID, fixture.suffix+"-fresh-lead").Scan(&freshLeadID); err != nil {
		t.Fatalf("create lead after operational attention activation: %v", err)
	}
	if err := attention.NewRepository(postgres).Process(ctx); err != nil {
		t.Fatalf("reconcile attention for fresh lead: %v", err)
	}

	var shadowCount, historicalCount int
	if err := postgres.Pool().QueryRow(ctx, `
		select
		  count(*)::int,
		  count(*) filter (where instance.shadow)::int,
		  count(*) filter (
		    where coalesce((instance.metadata->>'historical_backfill')::boolean, false)
		  )::int
		from public.lead_attention_instances instance
		join public.lead_attention_policies policy
		  on policy.organization_id = instance.organization_id
		 and policy.id = instance.policy_id
		where instance.organization_id = $1::uuid
		  and instance.lead_id = $2::uuid
		  and policy.policy_type in ('first_contact', 'stage_inactivity', 'stage_age')
		  and coalesce(policy.config->>'source', '') = 'stage_operational_rules'
	`, fixture.organizationID, freshLeadID).Scan(&instanceCount, &shadowCount, &historicalCount); err != nil {
		t.Fatalf("read fresh operational attention instances: %v", err)
	}
	if instanceCount != 3 || shadowCount != 3 || historicalCount != 0 {
		t.Fatalf(
			"fresh cycles did not get the expected safe operational instances: instances=%d shadow=%d historical=%d",
			instanceCount,
			shadowCount,
			historicalCount,
		)
	}

	var inheritedInstanceCount int
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::int
		from public.lead_attention_instances
		where organization_id = $1::uuid
		  and lead_id = $2::uuid
		  and policy_id = $3::uuid
	`, fixture.organizationID, freshLeadID, globalFirstContactPolicyID).Scan(&inheritedInstanceCount); err != nil {
		t.Fatalf("read inherited attention instances: %v", err)
	}
	if inheritedInstanceCount != 0 {
		t.Fatalf("less-specific global policy duplicated the stage rule: instances=%d", inheritedInstanceCount)
	}

	if _, err := postgres.Pool().Exec(ctx, `
		update public.leads
		set stage_id = $3::uuid,
		    stage_entered_at = now(),
		    updated_at = now()
		where organization_id = $1::uuid and id = $2::uuid
	`, fixture.organizationID, freshLeadID, nextStageID); err != nil {
		t.Fatalf("move fresh lead to next stage: %v", err)
	}
	if err := attention.NewRepository(postgres).Process(ctx); err != nil {
		t.Fatalf("reconcile attention after stage move: %v", err)
	}

	var resolvedStageInstances, scopeChangedInstances int
	if err := postgres.Pool().QueryRow(ctx, `
		select
		  count(*) filter (
		    where instance.status in ('resolved', 'cancelled')
		  )::int,
		  count(*) filter (
		    where instance.resolved_reason in ('policy_scope_changed', 'stage_changed')
		  )::int
		from public.lead_attention_instances instance
		join public.lead_attention_policies policy
		  on policy.organization_id = instance.organization_id
		 and policy.id = instance.policy_id
		where instance.organization_id = $1::uuid
		  and instance.lead_id = $2::uuid
		  and coalesce(policy.config->>'source', '') = 'stage_operational_rules'
	`, fixture.organizationID, freshLeadID).Scan(&resolvedStageInstances, &scopeChangedInstances); err != nil {
		t.Fatalf("read attention state after stage move: %v", err)
	}
	if resolvedStageInstances != 3 || scopeChangedInstances != 3 {
		t.Fatalf(
			"stage-scoped attention remained active after moving the lead: resolved=%d safe_scope_resolution=%d",
			resolvedStageInstances,
			scopeChangedInstances,
		)
	}

	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::int
		from public.lead_attention_instances
		where organization_id = $1::uuid
		  and lead_id = $2::uuid
		  and policy_id = $3::uuid
		  and status not in ('resolved', 'redistributed', 'cancelled')
	`, fixture.organizationID, freshLeadID, globalFirstContactPolicyID).Scan(&inheritedInstanceCount); err != nil {
		t.Fatalf("read inherited attention fallback after stage move: %v", err)
	}
	if inheritedInstanceCount != 1 {
		t.Fatalf("global policy did not resume after leaving the overridden stage: instances=%d", inheritedInstanceCount)
	}

	if _, err := postgres.Pool().Exec(ctx, `
		update public.leads
		set stage_id = $3::uuid,
		    stage_entered_at = now(),
		    updated_at = now()
		where organization_id = $1::uuid and id = $2::uuid
	`, fixture.organizationID, freshLeadID, fixture.stageID); err != nil {
		t.Fatalf("return uncontacted lead to the configured stage: %v", err)
	}
	if err := attention.NewRepository(postgres).Process(ctx); err != nil {
		t.Fatalf("reconcile uncontacted lead after returning to the configured stage: %v", err)
	}
	var totalStageFirstContact, activeStageFirstContact int
	if err := postgres.Pool().QueryRow(ctx, `
		select
		  count(*)::int,
		  count(*) filter (
		    where instance.status not in ('resolved', 'redistributed', 'cancelled')
		  )::int
		from public.lead_attention_instances instance
		join public.lead_attention_policies policy
		  on policy.organization_id = instance.organization_id
		 and policy.id = instance.policy_id
		where instance.organization_id = $1::uuid
		  and instance.lead_id = $2::uuid
		  and policy.policy_type = 'first_contact'
		  and coalesce(policy.config->>'source', '') = 'stage_operational_rules'
	`, fixture.organizationID, freshLeadID).Scan(&totalStageFirstContact, &activeStageFirstContact); err != nil {
		t.Fatalf("read first-contact cycles after uncontacted lead returned: %v", err)
	}
	if totalStageFirstContact != 2 || activeStageFirstContact != 1 {
		t.Fatalf(
			"uncontacted lead did not receive a fresh stage-cycle obligation: total=%d active=%d",
			totalStageFirstContact,
			activeStageFirstContact,
		)
	}
}

func TestUpsertOperationalRulesDoesNotTakeOverAttentionCenterPolicyAgainstDatabase(t *testing.T) {
	ctx, postgres := openLocalCadenceTestDatabase(t)
	fixture := createOperationalRulesFixture(t, ctx, postgres, "attention-conflict")
	repository := NewRepository(postgres)

	var externalPolicyID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.lead_attention_policies (
			organization_id,
			name,
			policy_type,
			status,
			pipeline_id,
			stage_id,
			threshold_minutes,
			warning_minutes,
			notify_assignee,
			config,
			created_by
		) values (
			$1::uuid,
			'Política da Central de Atenção',
			'first_contact',
			'enabled',
			$2::uuid,
			$3::uuid,
			120,
			15,
			true,
			'{"source":"attention_center"}'::jsonb,
			$4::uuid
		)
		returning id::text
	`, fixture.organizationID, fixture.pipelineID, fixture.stageID, fixture.userID).Scan(&externalPolicyID); err != nil {
		t.Fatalf("create external attention policy: %v", err)
	}

	cadenceOnly := OperationalRulesRequest{
		StageID:    fixture.stageID,
		PipelineID: fixture.pipelineID,
		Revision:   int64PointerForTest(0),
		Cadence: OperationalCadenceRule{
			Enabled: true,
			Tasks: []OperationalCadenceTask{{
				Position:        0,
				Type:            "message",
				Title:           "Retorno da etapa",
				DueMinutes:      60,
				IsRequired:      true,
				OutcomeRequired: false,
			}},
		},
		Attention: OperationalAttentionRule{
			SourceMode:     "inherit",
			Mode:           "disabled",
			WarningMinutes: 0,
		},
		Lifecycle: defaultOperationalLifecycleRule(),
	}
	saved, err := repository.UpsertOperationalRules(
		ctx,
		fixture.tenantContext(),
		fixture.stageID,
		cadenceOnly,
	)
	if err != nil {
		t.Fatalf("save cadence without taking over external policy: %v", err)
	}

	var externalStatus, externalSource string
	if err := postgres.Pool().QueryRow(ctx, `
		select status, coalesce(config->>'source', '')
		from public.lead_attention_policies
		where organization_id = $1::uuid and id = $2::uuid
	`, fixture.organizationID, externalPolicyID).Scan(&externalStatus, &externalSource); err != nil {
		t.Fatalf("read preserved external attention policy: %v", err)
	}
	if externalStatus != "enabled" || externalSource != "attention_center" {
		t.Fatalf(
			"cadence-only save changed external attention policy: status=%s source=%s",
			externalStatus,
			externalSource,
		)
	}

	firstOutreachMinutes := 90
	conflictingRequest := operationalRulesRequestFromRules(saved)
	conflictingRequest.Attention.SourceMode = "local"
	conflictingRequest.Attention.Mode = "enabled"
	conflictingRequest.Attention.FirstOutreachMinutes = &firstOutreachMinutes
	_, err = repository.UpsertOperationalRules(
		ctx,
		fixture.tenantContext(),
		fixture.stageID,
		conflictingRequest,
	)
	if !errors.Is(err, ErrAttentionPolicyConflict) {
		t.Fatalf("expected external policy conflict, got %v", err)
	}

	if err := postgres.Pool().QueryRow(ctx, `
		select status, coalesce(config->>'source', '')
		from public.lead_attention_policies
		where organization_id = $1::uuid and id = $2::uuid
	`, fixture.organizationID, externalPolicyID).Scan(&externalStatus, &externalSource); err != nil {
		t.Fatalf("read external policy after rejected takeover: %v", err)
	}
	if externalStatus != "enabled" || externalSource != "attention_center" {
		t.Fatalf(
			"rejected takeover still changed external policy: status=%s source=%s",
			externalStatus,
			externalSource,
		)
	}
}

func TestUpsertOperationalRulesCopiesInheritedGlobalTemplateAgainstDatabase(t *testing.T) {
	ctx, postgres := openLocalCadenceTestDatabase(t)
	fixture := createOperationalRulesFixture(t, ctx, postgres, "inheritance")
	repository := NewRepository(postgres)

	var globalTemplateID, globalTaskID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.cadence_templates (
			organization_id,
			pipeline_id,
			stage_id,
			stage_key,
			name,
			description,
			is_active,
			created_by
		) values (
			$1::uuid,
			null,
			null,
			$2,
			'Modelo global compartilhado',
			'Não pode ser alterado por uma etapa',
			true,
			$3::uuid
		)
		returning id::text
	`, fixture.organizationID, fixture.stageKey, fixture.userID).Scan(&globalTemplateID); err != nil {
		t.Fatalf("create inherited global template: %v", err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.cadence_tasks_template (
			organization_id,
			cadence_template_id,
			position,
			day_offset,
			delay_days,
			due_minutes,
			warning_minutes,
			type,
			title,
			is_required,
			outcome_required,
			metadata
		) values (
			$1::uuid,
			$2::uuid,
			1,
			0,
			0,
			45,
			5,
			'call',
			'Tarefa herdada',
			true,
			true,
			'{"source":"global_fixture"}'::jsonb
		)
		returning id::text
	`, fixture.organizationID, globalTemplateID).Scan(&globalTaskID); err != nil {
		t.Fatalf("create inherited global task: %v", err)
	}

	inherited, err := repository.GetOperationalRules(ctx, fixture.tenantContext(), fixture.stageID)
	if err != nil {
		t.Fatalf("load inherited operational rules: %v", err)
	}
	if inherited.Cadence.TemplateID != nil {
		t.Fatalf("inherited global template exposed an editable template id: %s", *inherited.Cadence.TemplateID)
	}
	if len(inherited.Cadence.Tasks) != 1 {
		t.Fatalf("expected one inherited task, got %d", len(inherited.Cadence.Tasks))
	}
	if inherited.Cadence.Tasks[0].ID != nil {
		t.Fatalf("inherited global task exposed editable id %s", *inherited.Cadence.Tasks[0].ID)
	}
	if inherited.Cadence.Tasks[0].Title != "Tarefa herdada" {
		t.Fatalf("unexpected inherited task: %+v", inherited.Cadence.Tasks[0])
	}

	globalTemplateSnapshot := databaseRowSnapshot(t, ctx, postgres, `
		select to_jsonb(template)::text
		from public.cadence_templates template
		where id = $1::uuid
	`, globalTemplateID)
	globalTaskSnapshot := databaseRowSnapshot(t, ctx, postgres, `
		select to_jsonb(task)::text
		from public.cadence_tasks_template task
		where id = $1::uuid
	`, globalTaskID)

	saveRequest := operationalRulesRequestFromRules(inherited)
	saveRequest.Cadence.Enabled = true
	saved, err := repository.UpsertOperationalRules(ctx, fixture.tenantContext(), fixture.stageID, saveRequest)
	if err != nil {
		t.Fatalf("save inherited rules as stage-specific rules: %v", err)
	}
	if saved.Cadence.TemplateID == nil || *saved.Cadence.TemplateID == globalTemplateID {
		t.Fatalf("save did not create a stage-specific template: global=%s saved=%v", globalTemplateID, saved.Cadence.TemplateID)
	}
	if len(saved.Cadence.Tasks) != 1 || saved.Cadence.Tasks[0].ID == nil || *saved.Cadence.Tasks[0].ID == globalTaskID {
		t.Fatalf("save did not create a stage-owned task: global=%s saved=%+v", globalTaskID, saved.Cadence.Tasks)
	}
	if got := databaseRowSnapshot(t, ctx, postgres, `
		select to_jsonb(template)::text
		from public.cadence_templates template
		where id = $1::uuid
	`, globalTemplateID); got != globalTemplateSnapshot {
		t.Fatalf("stage save altered the inherited global template\nbefore: %s\nafter:  %s", globalTemplateSnapshot, got)
	}
	if got := databaseRowSnapshot(t, ctx, postgres, `
		select to_jsonb(task)::text
		from public.cadence_tasks_template task
		where id = $1::uuid
	`, globalTaskID); got != globalTaskSnapshot {
		t.Fatalf("stage save altered the inherited global task\nbefore: %s\nafter:  %s", globalTaskSnapshot, got)
	}

	var specificTemplates, globalTemplates, globalTasks, specificTasks int
	if err := postgres.Pool().QueryRow(ctx, `
		select
			count(*) filter (
				where template.stage_id = $2::uuid
				  and template.pipeline_id = $3::uuid
			)::int,
			count(*) filter (
				where template.id = $4::uuid
				  and template.stage_id is null
				  and template.pipeline_id is null
			)::int,
			(
				select count(*)::int
				from public.cadence_tasks_template task
				where task.cadence_template_id = $4::uuid
			),
			(
				select count(*)::int
				from public.cadence_tasks_template task
				where task.cadence_template_id = $5::uuid
			)
		from public.cadence_templates template
		where template.organization_id = $1::uuid
		  and template.stage_key = $6
	`, fixture.organizationID, fixture.stageID, fixture.pipelineID, globalTemplateID, *saved.Cadence.TemplateID, fixture.stageKey).Scan(
		&specificTemplates,
		&globalTemplates,
		&globalTasks,
		&specificTasks,
	); err != nil {
		t.Fatalf("inspect inherited and stage-specific templates: %v", err)
	}
	if specificTemplates != 1 || globalTemplates != 1 || globalTasks != 1 || specificTasks != 1 {
		t.Fatalf(
			"global inheritance was not preserved: specific_templates=%d global_templates=%d global_tasks=%d specific_tasks=%d",
			specificTemplates,
			globalTemplates,
			globalTasks,
			specificTasks,
		)
	}

	var competingTemplateID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.cadence_templates (
			organization_id,
			pipeline_id,
			stage_id,
			stage_key,
			name,
			description,
			is_active,
			created_by,
			updated_at
		) values (
			$1::uuid,
			$2::uuid,
			$3::uuid,
			$4,
			'Modelo manual concorrente',
			'NÃ£o deve substituir o template canÃ´nico',
			true,
			$5::uuid,
			now() + interval '1 hour'
		)
		returning id::text
	`, fixture.organizationID, fixture.pipelineID, fixture.stageID, fixture.stageKey, fixture.userID).Scan(&competingTemplateID); err != nil {
		t.Fatalf("create competing stage template: %v", err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.cadence_tasks_template (
			organization_id,
			cadence_template_id,
			position,
			day_offset,
			delay_days,
			due_minutes,
			warning_minutes,
			type,
			title,
			is_required,
			outcome_required,
			metadata
		) values (
			$1::uuid,
			$2::uuid,
			1,
			0,
			0,
			5,
			0,
			'call',
			'Tarefa concorrente indevida',
			true,
			false,
			'{"source":"manual_competing_fixture"}'::jsonb
		)
	`, fixture.organizationID, competingTemplateID); err != nil {
		t.Fatalf("create competing template task: %v", err)
	}

	reloaded, err := repository.GetOperationalRules(ctx, fixture.tenantContext(), fixture.stageID)
	if err != nil {
		t.Fatalf("reload rules after competing template: %v", err)
	}
	if reloaded.Cadence.TemplateID == nil || *reloaded.Cadence.TemplateID != *saved.Cadence.TemplateID {
		t.Fatalf(
			"competing template replaced canonical selection: canonical=%v reloaded=%v",
			saved.Cadence.TemplateID,
			reloaded.Cadence.TemplateID,
		)
	}
	if len(reloaded.Cadence.Tasks) != 1 || reloaded.Cadence.Tasks[0].Title != "Tarefa herdada" {
		t.Fatalf("competing template changed editor tasks: %+v", reloaded.Cadence.Tasks)
	}

	var leadID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.leads (
			organization_id,
			pipeline_id,
			stage_id,
			assigned_user_id,
			name,
			source,
			deal_status
		) values (
			$1::uuid,
			$2::uuid,
			$3::uuid,
			$4::uuid,
			$5,
			'manual',
			'open'
		)
		returning id::text
	`, fixture.organizationID, fixture.pipelineID, fixture.stageID, fixture.userID, fixture.suffix+"-canonical-lead").Scan(&leadID); err != nil {
		t.Fatalf("create lead for canonical template selection: %v", err)
	}
	var materializedTitle string
	if err := postgres.Pool().QueryRow(ctx, `
		select title
		from public.lead_tasks
		where organization_id = $1::uuid
		  and lead_id = $2::uuid
		  and cadence_enrollment_id is not null
		order by created_at, id
		limit 1
	`, fixture.organizationID, leadID).Scan(&materializedTitle); err != nil {
		t.Fatalf("read task from canonical template: %v", err)
	}
	if materializedTitle != "Tarefa herdada" {
		t.Fatalf("materializer elected a competing template: got=%q", materializedTitle)
	}
}

type operationalRulesFixture struct {
	suffix         string
	organizationID string
	userID         string
	pipelineID     string
	stageID        string
	stageKey       string
}

func (fixture operationalRulesFixture) tenantContext() tenant.Context {
	return tenant.Context{
		OrganizationID: fixture.organizationID,
		UserID:         fixture.userID,
		UserRole:       "admin",
		MemberRole:     "admin",
	}
}

func createOperationalRulesFixture(
	t *testing.T,
	ctx context.Context,
	postgres *dbpkg.Postgres,
	name string,
) operationalRulesFixture {
	t.Helper()

	suffix := fmt.Sprintf("cadence-upsert-%s-%d", name, time.Now().UnixNano())
	fixture := operationalRulesFixture{
		suffix:   suffix,
		stageKey: suffix + "-stage",
	}

	tx, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatalf("begin fixture transaction: %v", err)
	}
	defer tx.Rollback(ctx)

	if err := tx.QueryRow(ctx, `
		select
			gen_random_uuid()::text,
			gen_random_uuid()::text,
			gen_random_uuid()::text,
			gen_random_uuid()::text
	`).Scan(
		&fixture.organizationID,
		&fixture.userID,
		&fixture.pipelineID,
		&fixture.stageID,
	); err != nil {
		t.Fatalf("generate fixture ids: %v", err)
	}

	if _, err := tx.Exec(ctx, `
		insert into public.organizations (id, name, slug, is_active)
		values ($1::uuid, $2, $3, true)
	`, fixture.organizationID, suffix, suffix); err != nil {
		t.Fatalf("create fixture organization: %v", err)
	}

	email := suffix + "@example.invalid"
	if _, err := tx.Exec(ctx, `
		insert into auth.users (
			id,
			aud,
			role,
			email,
			encrypted_password,
			email_confirmed_at,
			raw_app_meta_data,
			raw_user_meta_data,
			created_at,
			updated_at
		) values (
			$1::uuid,
			'authenticated',
			'authenticated',
			$2,
			'',
			now(),
			'{}'::jsonb,
			'{}'::jsonb,
			now(),
			now()
		)
	`, fixture.userID, email); err != nil {
		t.Fatalf("create fixture auth user: %v", err)
	}
	if _, err := tx.Exec(ctx, `
		insert into public.users (id, organization_id, name, email, role, is_active)
		values ($1::uuid, $2::uuid, $3, $4, 'admin', true)
		on conflict (id) do update
		set organization_id = excluded.organization_id,
		    name = excluded.name,
		    email = excluded.email,
		    role = excluded.role,
		    is_active = excluded.is_active
	`, fixture.userID, fixture.organizationID, "Cadence Integration Admin", email); err != nil {
		t.Fatalf("create fixture public user: %v", err)
	}
	if _, err := tx.Exec(ctx, `
		insert into public.organization_members (organization_id, user_id, role, is_active)
		values ($1::uuid, $2::uuid, 'admin', true)
		on conflict (user_id, organization_id) do update
		set role = excluded.role,
		    is_active = excluded.is_active
	`, fixture.organizationID, fixture.userID); err != nil {
		t.Fatalf("create fixture membership: %v", err)
	}
	if _, err := tx.Exec(ctx, `
		insert into public.pipelines (id, organization_id, name, position, is_active)
		values ($1::uuid, $2::uuid, $3, 1, true)
	`, fixture.pipelineID, fixture.organizationID, suffix+" pipeline"); err != nil {
		t.Fatalf("create fixture pipeline: %v", err)
	}
	if _, err := tx.Exec(ctx, `
		insert into public.stages (
			id,
			organization_id,
			pipeline_id,
			name,
			stage_key,
			position,
			is_active
		) values (
			$1::uuid,
			$2::uuid,
			$3::uuid,
			$4,
			$5,
			1,
			true
		)
	`, fixture.stageID, fixture.organizationID, fixture.pipelineID, suffix+" stage", fixture.stageKey); err != nil {
		t.Fatalf("create fixture stage: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit fixture: %v", err)
	}

	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cleanupCancel()

		// public.users has a non-cascading organization foreign key. Remove
		// organization-owned lead data first, detach the identity projection,
		// then let organization cascades remove the remaining fixture graph.
		if _, err := postgres.Pool().Exec(cleanupCtx, `
			delete from public.leads
			where organization_id = $1::uuid
		`, fixture.organizationID); err != nil {
			t.Errorf("cleanup fixture leads: %v", err)
		}
		if _, err := postgres.Pool().Exec(cleanupCtx, `
			update public.users
			set organization_id = null
			where id = $1::uuid
			  and organization_id = $2::uuid
		`, fixture.userID, fixture.organizationID); err != nil {
			t.Errorf("detach fixture public user: %v", err)
		}
		if _, err := postgres.Pool().Exec(cleanupCtx, `
			delete from public.organizations
			where id = $1::uuid
		`, fixture.organizationID); err != nil {
			t.Errorf("cleanup fixture organization: %v", err)
		}
		if _, err := postgres.Pool().Exec(cleanupCtx, `
			delete from public.users
			where id = $1::uuid
		`, fixture.userID); err != nil {
			t.Errorf("cleanup fixture public user: %v", err)
		}
		if _, err := postgres.Pool().Exec(cleanupCtx, `
			delete from auth.users
			where id = $1::uuid
		`, fixture.userID); err != nil {
			t.Errorf("cleanup fixture auth user: %v", err)
		}
	})

	return fixture
}

func openLocalCadenceTestDatabase(t *testing.T) (context.Context, *dbpkg.Postgres) {
	t.Helper()

	databaseURL := strings.TrimSpace(os.Getenv("CADENCE_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("CADENCE_TEST_DATABASE_URL is not set")
	}
	parsed, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatalf("parse CADENCE_TEST_DATABASE_URL: %v", err)
	}
	host := parsed.Hostname()
	ip := net.ParseIP(host)
	if !strings.EqualFold(host, "localhost") && (ip == nil || !ip.IsLoopback()) {
		t.Fatalf("CADENCE_TEST_DATABASE_URL must use a loopback host, got %q", host)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	t.Cleanup(cancel)
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL:           databaseURL,
		HealthTimeout: 3 * time.Second,
	})
	if err != nil {
		t.Fatalf("connect to local cadence test database: %v", err)
	}
	t.Cleanup(postgres.Close)
	return ctx, postgres
}

func operationalRulesRequestFromRules(rules OperationalRules) OperationalRulesRequest {
	revision := rules.Revision
	return OperationalRulesRequest{
		StageID:    rules.StageID,
		PipelineID: rules.PipelineID,
		Revision:   &revision,
		Cadence:    rules.Cadence,
		Attention:  rules.Attention,
		Lifecycle:  rules.Lifecycle,
	}
}

type attentionPolicyState struct {
	id                string
	policyKey         string
	version           int
	status            string
	thresholdMinutes  int
	warningMinutes    int
	businessHoursOnly bool
	updatedAt         string
}

func attentionPolicyByType(
	t *testing.T,
	ctx context.Context,
	postgres *dbpkg.Postgres,
	fixture operationalRulesFixture,
	policyType string,
) attentionPolicyState {
	t.Helper()
	return scanAttentionPolicyState(t, postgres.Pool().QueryRow(ctx, `
		select
			id::text,
			policy_key::text,
			version,
			status,
			threshold_minutes,
			warning_minutes,
			business_hours_only,
			updated_at::text
		from public.lead_attention_policies
		where organization_id = $1::uuid
		  and pipeline_id = $2::uuid
		  and stage_id = $3::uuid
		  and policy_type = $4
		  and status <> 'archived'
	`, fixture.organizationID, fixture.pipelineID, fixture.stageID, policyType))
}

func attentionPolicyByID(
	t *testing.T,
	ctx context.Context,
	postgres *dbpkg.Postgres,
	policyID string,
) attentionPolicyState {
	t.Helper()
	return scanAttentionPolicyState(t, postgres.Pool().QueryRow(ctx, `
		select
			id::text,
			policy_key::text,
			version,
			status,
			threshold_minutes,
			warning_minutes,
			business_hours_only,
			updated_at::text
		from public.lead_attention_policies
		where id = $1::uuid
	`, policyID))
}

func scanAttentionPolicyState(t *testing.T, row scanner) attentionPolicyState {
	t.Helper()

	var state attentionPolicyState
	if err := row.Scan(
		&state.id,
		&state.policyKey,
		&state.version,
		&state.status,
		&state.thresholdMinutes,
		&state.warningMinutes,
		&state.businessHoursOnly,
		&state.updatedAt,
	); err != nil {
		t.Fatalf("read attention policy state: %v", err)
	}
	return state
}

func attentionInstanceSnapshot(
	t *testing.T,
	ctx context.Context,
	postgres *dbpkg.Postgres,
	instanceID string,
) string {
	t.Helper()
	return databaseRowSnapshot(t, ctx, postgres, `
		select to_jsonb(instance)::text
		from public.lead_attention_instances instance
		where id = $1::uuid
	`, instanceID)
}

func attentionInstanceSentFlags(
	t *testing.T,
	ctx context.Context,
	postgres *dbpkg.Postgres,
	instanceID string,
) (string, string) {
	t.Helper()

	var warningSentAt, breachSentAt string
	if err := postgres.Pool().QueryRow(ctx, `
		select
			coalesce(warning_sent_at::text, ''),
			coalesce(breach_sent_at::text, '')
		from public.lead_attention_instances
		where id = $1::uuid
	`, instanceID).Scan(&warningSentAt, &breachSentAt); err != nil {
		t.Fatalf("read attention instance delivery flags: %v", err)
	}
	return warningSentAt, breachSentAt
}

type cadenceCounts struct {
	enrollments          int
	activeEnrollments    int
	completedEnrollments int
	cancelledEnrollments int
	tasks                int
	pendingTasks         int
	completedTasks       int
	cancelledTasks       int
}

func assertLeadCadenceCounts(
	t *testing.T,
	ctx context.Context,
	postgres *dbpkg.Postgres,
	leadID string,
	expected cadenceCounts,
) {
	t.Helper()

	var actual cadenceCounts
	if err := postgres.Pool().QueryRow(ctx, `
		select
			count(*)::int,
			count(*) filter (where status = 'active')::int,
			count(*) filter (where status = 'completed')::int,
			count(*) filter (where status = 'cancelled')::int
		from public.cadence_enrollments
		where lead_id = $1::uuid
	`, leadID).Scan(
		&actual.enrollments,
		&actual.activeEnrollments,
		&actual.completedEnrollments,
		&actual.cancelledEnrollments,
	); err != nil {
		t.Fatalf("read cadence enrollment counts: %v", err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select
			count(*)::int,
			count(*) filter (where status = 'pending')::int,
			count(*) filter (where status = 'completed')::int,
			count(*) filter (where status = 'cancelled')::int
		from public.lead_tasks
		where lead_id = $1::uuid
		  and cadence_enrollment_id is not null
	`, leadID).Scan(
		&actual.tasks,
		&actual.pendingTasks,
		&actual.completedTasks,
		&actual.cancelledTasks,
	); err != nil {
		t.Fatalf("read cadence task counts: %v", err)
	}
	if actual != expected {
		t.Fatalf("unexpected cadence state: got %+v, want %+v", actual, expected)
	}
}

func activeEnrollmentID(t *testing.T, ctx context.Context, postgres *dbpkg.Postgres, leadID string) string {
	t.Helper()

	var enrollmentID string
	if err := postgres.Pool().QueryRow(ctx, `
		select id::text
		from public.cadence_enrollments
		where lead_id = $1::uuid
		  and status = 'active'
		order by created_at desc, id desc
		limit 1
	`, leadID).Scan(&enrollmentID); err != nil {
		t.Fatalf("read active cadence enrollment: %v", err)
	}
	return enrollmentID
}

func assertEnrollmentState(
	t *testing.T,
	ctx context.Context,
	postgres *dbpkg.Postgres,
	enrollmentID string,
	expectedStatus string,
	expectedReason string,
) {
	t.Helper()

	var status, reason string
	if err := postgres.Pool().QueryRow(ctx, `
		select status, coalesce(cancel_reason, '')
		from public.cadence_enrollments
		where id = $1::uuid
	`, enrollmentID).Scan(&status, &reason); err != nil {
		t.Fatalf("read enrollment %s: %v", enrollmentID, err)
	}
	if status != expectedStatus || reason != expectedReason {
		t.Fatalf(
			"unexpected enrollment state for %s: got status=%s reason=%q, want status=%s reason=%q",
			enrollmentID,
			status,
			reason,
			expectedStatus,
			expectedReason,
		)
	}
}

func enrollmentTaskIDByStatus(
	t *testing.T,
	ctx context.Context,
	postgres *dbpkg.Postgres,
	enrollmentID string,
	status string,
) string {
	t.Helper()

	var taskID string
	if err := postgres.Pool().QueryRow(ctx, `
		select id::text
		from public.lead_tasks
		where cadence_enrollment_id = $1::uuid
		  and status = $2
		order by sequence, id
		limit 1
	`, enrollmentID, status).Scan(&taskID); err != nil {
		t.Fatalf("read %s task from enrollment %s: %v", status, enrollmentID, err)
	}
	return taskID
}

func taskSnapshot(t *testing.T, ctx context.Context, postgres *dbpkg.Postgres, taskID string) string {
	t.Helper()
	return databaseRowSnapshot(t, ctx, postgres, `
		select to_jsonb(task)::text
		from public.lead_tasks task
		where id = $1::uuid
	`, taskID)
}

func enrollmentSnapshot(t *testing.T, ctx context.Context, postgres *dbpkg.Postgres, enrollmentID string) string {
	t.Helper()
	return databaseRowSnapshot(t, ctx, postgres, `
		select to_jsonb(enrollment)::text
		from public.cadence_enrollments enrollment
		where id = $1::uuid
	`, enrollmentID)
}

func databaseRowSnapshot(
	t *testing.T,
	ctx context.Context,
	postgres *dbpkg.Postgres,
	query string,
	id string,
) string {
	t.Helper()

	var snapshot string
	if err := postgres.Pool().QueryRow(ctx, query, id).Scan(&snapshot); err != nil {
		t.Fatalf("read database row snapshot %s: %v", id, err)
	}
	return snapshot
}
