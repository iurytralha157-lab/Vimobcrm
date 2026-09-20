package leads

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/distribution"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const (
	importDistributionOrganizationID = "11111111-1111-4111-8111-111111111111"
	importDistributionActorID        = "22222222-2222-4222-8222-222222222222"
	importDistributionQueueID        = "33333333-3333-4333-8333-333333333333"
)

type requestedRoundRobinQueryer struct {
	exists bool
	err    error
	query  string
	args   []any
}

func (queryer *requestedRoundRobinQueryer) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	queryer.query = query
	queryer.args = args
	return requestedRoundRobinRow{exists: queryer.exists, err: queryer.err}
}

type requestedRoundRobinRow struct {
	exists bool
	err    error
}

type intakeRoutingQueryer struct {
	queueByProperty map[string]string
	behaviorByQueue map[string]string
	automaticCalls  int
}

func (queryer *intakeRoutingQueryer) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	if strings.Contains(query, "with intake_input as") {
		queryer.automaticCalls++
		propertyID := ""
		if len(args) > 3 && args[3] != nil {
			propertyID = args[3].(string)
		}
		return intakeRoutingRow{values: []any{queryer.queueByProperty[propertyID], true, []string{}}}
	}
	if strings.Contains(query, "from public.round_robins as queue") {
		queueID := args[1].(string)
		return intakeRoutingRow{values: []any{queueID, queryer.behaviorByQueue[queueID]}}
	}
	if strings.Contains(query, "from public.round_robins rr") {
		queueID := args[1].(string)
		return intakeRoutingRow{values: []any{queryer.behaviorByQueue[queueID]}}
	}
	return intakeRoutingRow{err: errors.New("unexpected intake routing query")}
}

type intakeRoutingRow struct {
	values []any
	err    error
}

func (row intakeRoutingRow) Scan(dest ...any) error {
	if row.err != nil {
		return row.err
	}
	if len(dest) != len(row.values) {
		return errors.New("unexpected intake routing scan")
	}
	for index, value := range row.values {
		switch target := dest[index].(type) {
		case *string:
			*target = value.(string)
		case *bool:
			*target = value.(bool)
		case *[]string:
			*target = value.([]string)
		default:
			return errors.New("unsupported intake routing scan target")
		}
	}
	return nil
}

func (row requestedRoundRobinRow) Scan(dest ...any) error {
	if row.err != nil {
		return row.err
	}
	*(dest[0].(*bool)) = row.exists
	return nil
}

func boolPointer(value bool) *bool {
	return &value
}

func stringPointer(value string) *string {
	return &value
}

func TestCreateAutoDistributionDefaultsToExistingBehavior(t *testing.T) {
	if !shouldAutoDistribute(createInput{}) {
		t.Fatal("omitted autoDistribute must preserve automatic distribution")
	}
	if !shouldAutoDistribute(createInput{AutoDistribute: boolPointer(true)}) {
		t.Fatal("autoDistribute=true must enable automatic distribution")
	}
	if shouldAutoDistribute(createInput{AutoDistribute: boolPointer(false)}) {
		t.Fatal("autoDistribute=false must disable automatic distribution")
	}
}

func TestImportAssignmentPolicyLeavesExplicitAutoDistributionUnassigned(t *testing.T) {
	contextWithoutLeadOperate := tenant.Context{
		OrganizationID: importDistributionOrganizationID,
		UserID:         importDistributionActorID,
		Permissions:    []string{permissions.LeadImport},
	}

	automatic, err := applyCreateAssignmentPolicy(contextWithoutLeadOperate, createInput{
		ImportMode:     true,
		AutoDistribute: boolPointer(true),
	})
	if err != nil {
		t.Fatalf("automatic import assignment policy: %v", err)
	}
	if automatic.AssignedUserID != nil {
		t.Fatalf("automatic import assigned user = %#v, want nil", automatic.AssignedUserID)
	}

	for name, input := range map[string]createInput{
		"explicit false": {ImportMode: true, AutoDistribute: boolPointer(false)},
		"omitted":        {ImportMode: true},
	} {
		t.Run(name, func(t *testing.T) {
			resolved, err := applyCreateAssignmentPolicy(contextWithoutLeadOperate, input)
			if err != nil {
				t.Fatalf("assignment policy: %v", err)
			}
			if resolved.AssignedUserID == nil || *resolved.AssignedUserID != importDistributionActorID {
				t.Fatalf("assigned user = %#v, want importing actor", resolved.AssignedUserID)
			}
		})
	}
}

func TestImportAssignmentPolicyStillRejectsForeignExplicitAssignee(t *testing.T) {
	foreignUserID := "44444444-4444-4444-8444-444444444444"
	contextWithoutLeadOperate := tenant.Context{
		OrganizationID: importDistributionOrganizationID,
		UserID:         importDistributionActorID,
		Permissions:    []string{permissions.LeadImport},
	}

	_, err := applyCreateAssignmentPolicy(contextWithoutLeadOperate, createInput{
		ImportMode:     true,
		AutoDistribute: boolPointer(true),
		AssignedUserID: &foreignUserID,
	})
	if !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatalf("foreign assignee error = %v, want organization access denied", err)
	}
}

func TestRequestedRoundRobinRequiresDistributionManagement(t *testing.T) {
	input := createInput{ImportMode: true, RoundRobinID: stringPointer(importDistributionQueueID)}
	importOnly := tenant.Context{
		OrganizationID: importDistributionOrganizationID,
		UserID:         importDistributionActorID,
		Permissions:    []string{permissions.LeadImport},
	}
	if canUseRequestedRoundRobin(importOnly, input) {
		t.Fatal("lead_import alone must not authorize an explicit distribution queue")
	}

	withDistributionManagement := importOnly
	withDistributionManagement.Permissions = append(withDistributionManagement.Permissions, permissions.DistributionManage)
	if !canUseRequestedRoundRobin(withDistributionManagement, input) {
		t.Fatal("distribution_manage should authorize an explicit distribution queue")
	}
	if !canCreateLeadInput(withDistributionManagement, input) {
		t.Fatal("lead_import must remain required for an import row")
	}

	distributionOnly := withDistributionManagement
	distributionOnly.Permissions = []string{permissions.DistributionManage}
	if canCreateLeadInput(distributionOnly, input) {
		t.Fatal("distribution_manage must not replace lead_import")
	}
}

func TestValidateRequestedRoundRobinScopesActiveQueueToOrganization(t *testing.T) {
	queryer := &requestedRoundRobinQueryer{exists: true}
	err := (Repository{}).validateRequestedRoundRobin(
		context.Background(),
		queryer,
		importDistributionOrganizationID,
		stringPointer(importDistributionQueueID),
	)
	if err != nil {
		t.Fatalf("validate requested queue: %v", err)
	}
	if len(queryer.args) != 2 || queryer.args[0] != importDistributionOrganizationID || queryer.args[1] != importDistributionQueueID {
		t.Fatalf("queue validation args = %#v", queryer.args)
	}
	for _, required := range []string{"rr.organization_id = $1::uuid", "rr.id = $2::uuid", "coalesce(rr.is_active, true) = true"} {
		if !strings.Contains(queryer.query, required) {
			t.Fatalf("queue validation query missing %q", required)
		}
	}

	missing := &requestedRoundRobinQueryer{exists: false}
	err = (Repository{}).validateRequestedRoundRobin(
		context.Background(),
		missing,
		importDistributionOrganizationID,
		stringPointer(importDistributionQueueID),
	)
	if !errors.Is(err, ErrInvalidReference) {
		t.Fatalf("inactive or foreign queue error = %v, want invalid reference", err)
	}
}

func TestNewLeadDistributionRequestPropagatesExplicitQueue(t *testing.T) {
	input := createInput{
		Source:       "spreadsheet",
		RoundRobinID: stringPointer(importDistributionQueueID),
	}
	tenantContext := tenant.Context{OrganizationID: importDistributionOrganizationID}
	request := newLeadDistributionRequest(tenantContext, input, "55555555-5555-4555-8555-555555555555", distribution.IntakeDestination{
		RoundRobinID:    input.RoundRobinID,
		ReentryBehavior: "redistribute",
		Resolved:        true,
	})

	if request.RoundRobinID == nil || *request.RoundRobinID != importDistributionQueueID {
		t.Fatalf("round robin id = %#v", request.RoundRobinID)
	}
	if request.OrganizationID != importDistributionOrganizationID || request.IdempotencyKey != "manual:"+request.LeadID {
		t.Fatalf("distribution request = %#v", request)
	}
	if request.Source == nil || *request.Source != "spreadsheet" || !request.PreserveAssignee || request.OccurredAt.IsZero() {
		t.Fatalf("distribution request fields = %#v", request)
	}
	if !request.RoundRobinResolved {
		t.Fatal("explicit queue decision must be frozen in the distribution request")
	}
}

func TestManualAutomaticIntakeScopesQueueIdentityAndReentryBehavior(t *testing.T) {
	const (
		pipelineID = "55555555-5555-4555-8555-555555555555"
		propertyA  = "66666666-6666-4666-8666-666666666661"
		propertyB  = "66666666-6666-4666-8666-666666666662"
		queueA     = "77777777-7777-4777-8777-777777777771"
		queueB     = "77777777-7777-4777-8777-777777777772"
	)
	autoDistribute := true
	queryer := &intakeRoutingQueryer{
		queueByProperty: map[string]string{propertyA: queueA, propertyB: queueB},
		behaviorByQueue: map[string]string{queueA: "keep_assignee", queueB: "redistribute"},
	}
	repo := Repository{}
	resolveAutomatic := func(propertyID string) distribution.IntakeDestination {
		t.Helper()
		resolved, err := repo.resolveLeadIntakeDestination(context.Background(), queryer, importDistributionOrganizationID, createInput{
			Source:         "spreadsheet",
			PropertyID:     stringPointer(propertyID),
			AutoDistribute: &autoDistribute,
		}, destination{PipelineID: stringPointer(pipelineID)})
		if err != nil {
			t.Fatal(err)
		}
		return resolved
	}

	autoA := resolveAutomatic(propertyA)
	autoARepeat := resolveAutomatic(propertyA)
	autoB := resolveAutomatic(propertyB)
	automaticCallsBeforeExplicit := queryer.automaticCalls
	explicitA, err := repo.resolveLeadIntakeDestination(context.Background(), queryer, importDistributionOrganizationID, createInput{
		Source:         "spreadsheet",
		PropertyID:     stringPointer(propertyB),
		AutoDistribute: &autoDistribute,
		RoundRobinID:   stringPointer(queueA),
	}, destination{PipelineID: stringPointer(pipelineID)})
	if err != nil {
		t.Fatal(err)
	}

	for name, resolved := range map[string]distribution.IntakeDestination{
		"auto A":        autoA,
		"auto A repeat": autoARepeat,
		"auto B":        autoB,
		"explicit A":    explicitA,
	} {
		if !resolved.Resolved || resolved.RoundRobinID == nil {
			t.Fatalf("%s destination is not frozen: %#v", name, resolved)
		}
	}
	if distribution.IntakeScopeKey(autoA.RoundRobinID) != distribution.IntakeScopeKey(autoARepeat.RoundRobinID) {
		t.Fatal("automatic A,A must reuse the same queue-scoped card")
	}
	if distribution.IntakeScopeKey(autoA.RoundRobinID) == distribution.IntakeScopeKey(autoB.RoundRobinID) {
		t.Fatal("automatic A,B must create separate queue-scoped cards")
	}
	if !sameLeadIntakeDestination(autoA, explicitA) {
		t.Fatal("automatic A followed by explicit A must resolve to the same intake identity")
	}
	if queryer.automaticCalls != automaticCallsBeforeExplicit {
		t.Fatal("an explicit queue must not reopen automatic queue selection")
	}
	if !distribution.PreserveAssigneeForIntake(true, autoA) {
		t.Fatal("keep_assignee queue must preserve the assignee on reentry")
	}
	if distribution.PreserveAssigneeForIntake(true, autoB) {
		t.Fatal("redistribute queue must release the assignee on reentry")
	}
	noQueue := resolveAutomatic("66666666-6666-4666-8666-666666666669")
	if !noQueue.Resolved || noQueue.RoundRobinID != nil || distribution.IntakeScopeKey(noQueue.RoundRobinID) != "unscoped" {
		t.Fatalf("manual frozen no-queue decision = %#v", noQueue)
	}
	noQueueRequest := newLeadDistributionRequest(tenant.Context{OrganizationID: importDistributionOrganizationID}, createInput{Source: "spreadsheet"}, "88888888-8888-4888-8888-888888888888", noQueue)
	if !noQueueRequest.RoundRobinResolved || noQueueRequest.RoundRobinID != nil {
		t.Fatalf("manual frozen no-queue request = %#v", noQueueRequest)
	}
}

func TestManualAutomaticQueueIsConfirmedInsideIdentityTransaction(t *testing.T) {
	raw, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	createStart := strings.Index(source, "func (repo Repository) Create(")
	createEnd := strings.Index(source[createStart:], "func (repo Repository) Update(")
	if createStart < 0 || createEnd < 0 {
		t.Fatal("Create source boundary was not found")
	}
	createFlow := source[createStart : createStart+createEnd]
	if resolve, lookup := strings.Index(createFlow, "repo.resolveLeadIntakeDestination"), strings.Index(createFlow, "repo.findExistingLeadByPhone"); resolve < 0 || lookup < 0 || resolve >= lookup {
		t.Fatal("manual automatic queue candidate must be resolved before outer phone lookup")
	}

	for _, functionName := range []string{"createNewLead", "registerReentry"} {
		start := strings.Index(source, "func (repo Repository) "+functionName+"(")
		if start < 0 {
			t.Fatalf("%s source was not found", functionName)
		}
		end := strings.Index(source[start+1:], "\nfunc (repo Repository)")
		if end < 0 {
			t.Fatalf("%s source boundary was not found", functionName)
		}
		flow := source[start : start+1+end]
		resolve := strings.Index(flow, "repo.resolveLeadIntakeDestination")
		driftCheck := strings.Index(flow, "sameLeadIntakeDestination")
		phoneLock := strings.Index(flow, "lockLeadIntakeIdentity")
		if resolve < 0 || driftCheck < 0 || phoneLock < 0 || resolve >= driftCheck || driftCheck >= phoneLock {
			t.Fatalf("%s must freeze and confirm queue routing before phone identity", functionName)
		}
	}
}

func TestCreateResponseExposesEveryDistributionOutcome(t *testing.T) {
	for _, outcome := range []CreateDistributionOutcome{
		CreateDistributionOutcomeAssigned,
		CreateDistributionOutcomeAlreadyAssigned,
		CreateDistributionOutcomeNoMatchingQueue,
		CreateDistributionOutcomeNoAvailableMembers,
		CreateDistributionOutcomeSkipped,
		CreateDistributionOutcomeReentryPreserved,
	} {
		payload, err := json.Marshal(CreateResponse{DistributionOutcome: outcome})
		if err != nil {
			t.Fatalf("marshal %q: %v", outcome, err)
		}
		var decoded map[string]any
		if err := json.Unmarshal(payload, &decoded); err != nil {
			t.Fatalf("decode %q: %v", outcome, err)
		}
		if decoded["distributionOutcome"] != string(outcome) {
			t.Fatalf("distribution outcome = %#v, want %q", decoded["distributionOutcome"], outcome)
		}
	}
}
