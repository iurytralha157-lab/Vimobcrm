package leads

import (
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestCanUpdateAssignedLeadStatusAllowsOwnLeadStatusPatch(t *testing.T) {
	userID := "10000000-0000-0000-0000-000000000001"
	reason := "Contato invalido"
	propertyID := "20000000-0000-0000-0000-000000000001"
	status := "lost"

	current := leadSnapshot{
		AssignedUserID: userID,
		DealStatus:     "open",
	}
	input := updateInput{
		DealStatus:         patchString{Set: true, Value: &status},
		LostReason:         patchString{Set: true, Value: &reason},
		InterestPropertyID: patchString{Set: true, Value: &propertyID},
	}
	tenantContext := tenant.Context{
		UserID:         userID,
		OrganizationID: "30000000-0000-0000-0000-000000000001",
		MemberRole:     "user",
	}

	if !canUpdateAssignedLeadStatus(tenantContext, current, input) {
		t.Fatal("expected assigned user to update own lead status")
	}
}

func TestCanUpdateAssignedLeadStatusAllowsLostReasonOnOwnLostLead(t *testing.T) {
	userID := "10000000-0000-0000-0000-000000000001"
	reason := "Sem interesse no momento"

	current := leadSnapshot{
		AssignedUserID: userID,
		DealStatus:     "lost",
	}
	input := updateInput{
		LostReason: patchString{Set: true, Value: &reason},
	}
	tenantContext := tenant.Context{
		UserID:         userID,
		OrganizationID: "30000000-0000-0000-0000-000000000001",
		MemberRole:     "user",
	}

	if !canUpdateAssignedLeadStatus(tenantContext, current, input) {
		t.Fatal("expected assigned user to update lost reason on own lost lead")
	}
}

func TestCanUpdateAssignedLeadStatusRejectsUnassignedUser(t *testing.T) {
	status := "won"
	current := leadSnapshot{
		AssignedUserID: "10000000-0000-0000-0000-000000000001",
		DealStatus:     "open",
	}
	input := updateInput{
		DealStatus: patchString{Set: true, Value: &status},
	}
	tenantContext := tenant.Context{
		UserID:         "10000000-0000-0000-0000-000000000002",
		OrganizationID: "30000000-0000-0000-0000-000000000001",
		MemberRole:     "user",
	}

	if canUpdateAssignedLeadStatus(tenantContext, current, input) {
		t.Fatal("expected non-assigned user to be denied")
	}
}

func TestCanUpdateAssignedLeadStatusRejectsNonStatusFields(t *testing.T) {
	userID := "10000000-0000-0000-0000-000000000001"
	status := "won"
	name := "Lead alterado"

	current := leadSnapshot{
		AssignedUserID: userID,
		DealStatus:     "open",
	}
	input := updateInput{
		DealStatus: patchString{Set: true, Value: &status},
		Name:       patchString{Set: true, Value: &name},
	}
	tenantContext := tenant.Context{
		UserID:         userID,
		OrganizationID: "30000000-0000-0000-0000-000000000001",
		MemberRole:     "user",
	}

	if canUpdateAssignedLeadStatus(tenantContext, current, input) {
		t.Fatal("expected status permission to reject lead data edits")
	}
}

func TestCanUpdateAssignedLeadOperationalPatchAllowsFeedbackOnOwnLead(t *testing.T) {
	userID := "10000000-0000-0000-0000-000000000001"
	feedback := "Nao atendeu, tentar novamente amanha"

	current := leadSnapshot{
		AssignedUserID: userID,
		DealStatus:     "open",
	}
	input := updateInput{
		Feedback: patchString{Set: true, Value: &feedback},
	}
	tenantContext := tenant.Context{
		UserID:         userID,
		OrganizationID: "30000000-0000-0000-0000-000000000001",
		MemberRole:     "user",
	}

	if !canUpdateAssignedLeadOperationalPatch(tenantContext, current, input) {
		t.Fatal("expected assigned user to register feedback on own lead")
	}
}

func TestCanUpdateAssignedLeadOperationalPatchRejectsFeedbackWithDataEdit(t *testing.T) {
	userID := "10000000-0000-0000-0000-000000000001"
	feedback := "Nao atendeu"
	phone := "+55 11 99999-0000"

	current := leadSnapshot{
		AssignedUserID: userID,
		DealStatus:     "open",
	}
	input := updateInput{
		Feedback: patchString{Set: true, Value: &feedback},
		Phone:    patchString{Set: true, Value: &phone},
	}
	tenantContext := tenant.Context{
		UserID:         userID,
		OrganizationID: "30000000-0000-0000-0000-000000000001",
		MemberRole:     "user",
	}

	if canUpdateAssignedLeadOperationalPatch(tenantContext, current, input) {
		t.Fatal("expected feedback permission to reject lead data edits")
	}
}

func TestCanUpdateAssignedLeadStatusRejectsLostReasonOnOpenLeadWithoutStatusChange(t *testing.T) {
	userID := "10000000-0000-0000-0000-000000000001"
	reason := "Sem interesse no momento"

	current := leadSnapshot{
		AssignedUserID: userID,
		DealStatus:     "open",
	}
	input := updateInput{
		LostReason: patchString{Set: true, Value: &reason},
	}
	tenantContext := tenant.Context{
		UserID:         userID,
		OrganizationID: "30000000-0000-0000-0000-000000000001",
		MemberRole:     "user",
	}

	if canUpdateAssignedLeadStatus(tenantContext, current, input) {
		t.Fatal("expected lost reason without status change to be denied for open lead")
	}
}
