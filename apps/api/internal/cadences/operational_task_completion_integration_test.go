package cadences

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	leadspkg "github.com/vimob-crm/vimob-crm/apps/api/internal/leads"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestSwitchLeadCadenceRevalidatesAssignmentAfterConcurrentChangeAgainstDatabase(t *testing.T) {
	ctx, postgres := openLocalCadenceTestDatabase(t)
	fixture := createOperationalRulesFixture(t, ctx, postgres, "switch-authorization-race")
	leadID, _, _ := createOperationalCadenceLead(
		t,
		ctx,
		postgres,
		fixture,
		[]bool{false},
	)
	rules, err := NewRepository(postgres).GetOperationalRules(
		ctx,
		fixture.tenantContext(),
		fixture.stageID,
	)
	if err != nil || rules.Cadence.TemplateID == nil {
		t.Fatalf("read operational template for switch race: rules=%+v err=%v", rules, err)
	}

	actorContext := tenant.Context{
		OrganizationID: fixture.organizationID,
		UserID:         fixture.userID,
		UserRole:       "user",
		MemberRole:     "user",
		Permissions: []string{
			permissions.LeadViewOwn,
			permissions.LeadOperate,
		},
	}
	reassignment, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatalf("begin concurrent reassignment: %v", err)
	}
	defer reassignment.Rollback(ctx)
	if _, err := reassignment.Exec(ctx, `
		update public.leads
		set assigned_user_id = null, updated_at = now()
		where organization_id = $1::uuid and id = $2::uuid
	`, fixture.organizationID, leadID); err != nil {
		t.Fatalf("lock and unassign lead: %v", err)
	}

	result := make(chan error, 1)
	go func() {
		_, switchErr := NewRepository(postgres).SwitchLeadCadence(
			ctx,
			actorContext,
			leadID,
			SwitchCadenceRequest{CadenceTemplateID: *rules.Cadence.TemplateID},
		)
		result <- switchErr
	}()

	if err := reassignment.Commit(ctx); err != nil {
		t.Fatalf("commit concurrent reassignment: %v", err)
	}
	if switchErr := <-result; !errors.Is(switchErr, tenant.ErrOrganizationAccessDenied) {
		t.Fatalf("stale former assignee switched cadence after reassignment: %v", switchErr)
	}

	var switchedActivities int
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::int
		from public.activities
		where organization_id = $1::uuid
		  and lead_id = $2::uuid
		  and type = 'cadence_switched'
	`, fixture.organizationID, leadID).Scan(&switchedActivities); err != nil {
		t.Fatalf("read cadence switch audit after rejected race: %v", err)
	}
	if switchedActivities != 0 {
		t.Fatalf("rejected stale assignee still changed cadence: activities=%d", switchedActivities)
	}
}

func TestOperationalCadenceTaskRequiresCanonicalCompletionAgainstDatabase(t *testing.T) {
	ctx, postgres := openLocalCadenceTestDatabase(t)
	fixture := createOperationalRulesFixture(t, ctx, postgres, "canonical-completion")
	leadID, _, taskIDs := createOperationalCadenceLead(
		t,
		ctx,
		postgres,
		fixture,
		[]bool{true},
	)
	leadRepository := leadspkg.NewRepository(postgres, nil)
	tenantContext := fixture.tenantContext()

	done := true
	if _, err := leadRepository.PatchLeadTask(
		ctx,
		tenantContext,
		taskIDs[0],
		leadspkg.LeadTaskPatchRequest{IsDone: &done},
	); !errors.Is(err, leadspkg.ErrInvalidInput) {
		t.Fatalf("generic PATCH must reject a cadence task, got %v", err)
	}
	assertMaterializedTaskState(t, ctx, postgres, taskIDs[0], "pending", false)

	withoutOutcome, err := (leadspkg.CompleteCadenceTaskRequest{
		LeadID: leadID,
		TaskID: taskIDs[0],
	}).Validate()
	if err != nil {
		t.Fatalf("normalize cadence completion without outcome: %v", err)
	}
	if _, err := leadRepository.CompleteCadenceTask(
		ctx,
		tenantContext,
		withoutOutcome,
	); !errors.Is(err, leadspkg.ErrInvalidInput) {
		t.Fatalf("canonical completion must enforce required outcome, got %v", err)
	}
	assertMaterializedTaskState(t, ctx, postgres, taskIDs[0], "pending", false)

	outcome := "answered"
	withOutcome, err := (leadspkg.CompleteCadenceTaskRequest{
		LeadID:  leadID,
		TaskID:  taskIDs[0],
		Outcome: &outcome,
	}).Validate()
	if err != nil {
		t.Fatalf("normalize valid cadence completion: %v", err)
	}
	if _, err := leadRepository.CompleteCadenceTask(
		ctx,
		tenantContext,
		withOutcome,
	); err != nil {
		t.Fatalf("complete cadence task through canonical endpoint: %v", err)
	}
	assertMaterializedTaskState(t, ctx, postgres, taskIDs[0], "completed", true)
}

func TestOperationalCadenceTasksCompleteConcurrentlyExactlyOnceAgainstDatabase(t *testing.T) {
	baseContext, postgres := openLocalCadenceTestDatabase(t)
	ctx, cancel := context.WithTimeout(baseContext, 15*time.Second)
	defer cancel()

	fixture := createOperationalRulesFixture(t, ctx, postgres, "completion-race")
	leadID, enrollmentID, taskIDs := createOperationalCadenceLead(
		t,
		ctx,
		postgres,
		fixture,
		[]bool{false, false},
	)
	leadRepository := leadspkg.NewRepository(postgres, nil)
	tenantContext := fixture.tenantContext()

	start := make(chan struct{})
	errorsChannel := make(chan error, len(taskIDs))
	var wait sync.WaitGroup
	for _, taskID := range taskIDs {
		taskID := taskID
		wait.Add(1)
		go func() {
			defer wait.Done()
			request, validateErr := (leadspkg.CompleteCadenceTaskRequest{
				LeadID: leadID,
				TaskID: taskID,
			}).Validate()
			if validateErr != nil {
				errorsChannel <- validateErr
				return
			}
			<-start
			_, completeErr := leadRepository.CompleteCadenceTask(
				ctx,
				tenantContext,
				request,
			)
			errorsChannel <- completeErr
		}()
	}
	close(start)
	wait.Wait()
	close(errorsChannel)

	for completionErr := range errorsChannel {
		if completionErr != nil {
			t.Fatalf("concurrent cadence completion failed: %v", completionErr)
		}
	}

	var enrollmentStatus string
	var completedTasks, completionActivities, distinctActivityTasks int
	if err := postgres.Pool().QueryRow(ctx, `
		select status
		from public.cadence_enrollments
		where organization_id = $1::uuid and id = $2::uuid
	`, fixture.organizationID, enrollmentID).Scan(&enrollmentStatus); err != nil {
		t.Fatalf("read enrollment after concurrent completion: %v", err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::int
		from public.lead_tasks
		where organization_id = $1::uuid
		  and cadence_enrollment_id = $2::uuid
		  and status = 'completed'
		  and is_done = true
	`, fixture.organizationID, enrollmentID).Scan(&completedTasks); err != nil {
		t.Fatalf("read completed cadence tasks: %v", err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select
		  count(*)::int,
		  count(distinct metadata->>'task_id')::int
		from public.activities
		where organization_id = $1::uuid
		  and lead_id = $2::uuid
		  and type = 'task_completed'
		  and metadata->>'task_id' = any($3::text[])
	`, fixture.organizationID, leadID, taskIDs).Scan(
		&completionActivities,
		&distinctActivityTasks,
	); err != nil {
		t.Fatalf("read cadence completion activities: %v", err)
	}

	if enrollmentStatus != "completed" ||
		completedTasks != len(taskIDs) ||
		completionActivities != len(taskIDs) ||
		distinctActivityTasks != len(taskIDs) {
		t.Fatalf(
			"concurrent completion was not exactly-once: enrollment=%s tasks=%d activities=%d distinct=%d",
			enrollmentStatus,
			completedTasks,
			completionActivities,
			distinctActivityTasks,
		)
	}

	idempotentRequest, err := (leadspkg.CompleteCadenceTaskRequest{
		LeadID: leadID,
		TaskID: taskIDs[0],
	}).Validate()
	if err != nil {
		t.Fatalf("normalize idempotent completion: %v", err)
	}
	if _, err := leadRepository.CompleteCadenceTask(
		ctx,
		tenantContext,
		idempotentRequest,
	); err != nil {
		t.Fatalf("repeat completed cadence task: %v", err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::int
		from public.activities
		where organization_id = $1::uuid
		  and lead_id = $2::uuid
		  and type = 'task_completed'
		  and metadata->>'task_id' = any($3::text[])
	`, fixture.organizationID, leadID, taskIDs).Scan(&completionActivities); err != nil {
		t.Fatalf("read activities after idempotent retry: %v", err)
	}
	if completionActivities != len(taskIDs) {
		t.Fatalf("idempotent retry duplicated completion history: activities=%d", completionActivities)
	}
}

func createOperationalCadenceLead(
	t *testing.T,
	ctx context.Context,
	postgres *dbpkg.Postgres,
	fixture operationalRulesFixture,
	outcomeRequired []bool,
) (string, string, []string) {
	t.Helper()

	tasks := make([]OperationalCadenceTask, 0, len(outcomeRequired))
	for index, required := range outcomeRequired {
		tasks = append(tasks, OperationalCadenceTask{
			Position:        index,
			Type:            "call",
			Title:           "Contato operacional",
			DueMinutes:      (index + 1) * 30,
			IsRequired:      true,
			OutcomeRequired: required,
		})
	}
	repository := NewRepository(postgres)
	if _, err := repository.UpsertOperationalRules(
		ctx,
		fixture.tenantContext(),
		fixture.stageID,
		OperationalRulesRequest{
			StageID:    fixture.stageID,
			PipelineID: fixture.pipelineID,
			Revision:   int64PointerForTest(0),
			Cadence: OperationalCadenceRule{
				Enabled: true,
				Tasks:   tasks,
			},
			Attention: OperationalAttentionRule{
				SourceMode:     "inherit",
				Mode:           "disabled",
				WarningMinutes: 0,
			},
			Lifecycle: defaultOperationalLifecycleRule(),
		},
	); err != nil {
		t.Fatalf("save operational cadence fixture: %v", err)
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
	`, fixture.organizationID, fixture.pipelineID, fixture.stageID, fixture.userID,
		fixture.suffix+"-completion-lead").Scan(&leadID); err != nil {
		t.Fatalf("create lead for cadence completion: %v", err)
	}

	var enrollmentID string
	if err := postgres.Pool().QueryRow(ctx, `
		select id::text
		from public.cadence_enrollments
		where organization_id = $1::uuid
		  and lead_id = $2::uuid
		  and status = 'active'
	`, fixture.organizationID, leadID).Scan(&enrollmentID); err != nil {
		t.Fatalf("read materialized cadence enrollment: %v", err)
	}

	rows, err := postgres.Pool().Query(ctx, `
		select id::text
		from public.lead_tasks
		where organization_id = $1::uuid
		  and cadence_enrollment_id = $2::uuid
		order by sequence, id
	`, fixture.organizationID, enrollmentID)
	if err != nil {
		t.Fatalf("read materialized cadence tasks: %v", err)
	}
	defer rows.Close()

	taskIDs := make([]string, 0, len(outcomeRequired))
	for rows.Next() {
		var taskID string
		if err := rows.Scan(&taskID); err != nil {
			t.Fatalf("scan materialized cadence task: %v", err)
		}
		taskIDs = append(taskIDs, taskID)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate materialized cadence tasks: %v", err)
	}
	if len(taskIDs) != len(outcomeRequired) {
		t.Fatalf("unexpected materialized task count: got %d want %d", len(taskIDs), len(outcomeRequired))
	}
	return leadID, enrollmentID, taskIDs
}

func assertMaterializedTaskState(
	t *testing.T,
	ctx context.Context,
	postgres *dbpkg.Postgres,
	taskID string,
	wantStatus string,
	wantDone bool,
) {
	t.Helper()
	var status string
	var done bool
	if err := postgres.Pool().QueryRow(ctx, `
		select status, is_done
		from public.lead_tasks
		where id = $1::uuid
	`, taskID).Scan(&status, &done); err != nil {
		t.Fatalf("read materialized task state: %v", err)
	}
	if status != wantStatus || done != wantDone {
		t.Fatalf("unexpected task state: status=%s done=%v", status, done)
	}
}
