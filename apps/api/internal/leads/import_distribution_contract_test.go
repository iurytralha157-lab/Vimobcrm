package leads

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
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
	request := newLeadDistributionRequest(tenantContext, input, "55555555-5555-4555-8555-555555555555")

	if request.RoundRobinID == nil || *request.RoundRobinID != importDistributionQueueID {
		t.Fatalf("round robin id = %#v", request.RoundRobinID)
	}
	if request.OrganizationID != importDistributionOrganizationID || request.IdempotencyKey != "manual:"+request.LeadID {
		t.Fatalf("distribution request = %#v", request)
	}
	if request.Source == nil || *request.Source != "spreadsheet" || !request.PreserveAssignee || request.OccurredAt.IsZero() {
		t.Fatalf("distribution request fields = %#v", request)
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
