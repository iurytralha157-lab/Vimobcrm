package leads

import (
	"encoding/json"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestLeadOperationCapabilityMatchesBoardAndDetail(t *testing.T) {
	leader := tenant.Context{
		UserID:      "leader",
		Permissions: []string{permissions.LeadViewTeam, permissions.LeadOperate},
		LedTeamIDs:  []string{"team-a"},
		LedUserIDs:  []string{"broker"},
	}
	broker := tenant.Context{
		UserID:      "broker",
		Permissions: []string{permissions.LeadViewOwn, permissions.LeadOperate},
	}
	tests := []struct {
		name       string
		viewer     tenant.Context
		assigneeID string
		teamID     string
		want       bool
	}{
		{"leader's team lead", leader, "broker", "team-a", true},
		{"leader's broker under another team", leader, "broker", "team-b", false},
		{"leader's unassigned queue lead", leader, "", "team-a", true},
		{"unrelated broker from led queue", leader, "outside", "team-a", false},
		{"broker's own cross-team lead", broker, "broker", "team-b", true},
		{"manager with full access", tenant.Context{UserID: "manager", MemberRole: "manager", Permissions: []string{permissions.LeadViewAll, permissions.LeadOperate}}, "broker", "team-b", true},
		{"read-only all-lead viewer", tenant.Context{UserID: "auditor", Permissions: []string{permissions.LeadViewAll}}, "broker", "team-b", false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			boardLead := withPipelineLeadOperationCapability(test.viewer, PipelineBoardLead{
				AssignedUserID: optionalString(test.assigneeID, 64),
				TeamID:         optionalString(test.teamID, 64),
			})
			detailLead := withLeadOperationCapability(test.viewer, Lead{
				AssignedUserID: test.assigneeID,
				TeamID:         test.teamID,
			})
			if boardLead.CanOperate != test.want || detailLead.CanOperate == nil || *detailLead.CanOperate != test.want {
				t.Fatalf("board can_operate=%v, detail canOperate=%v; want %v", boardLead.CanOperate, detailLead.CanOperate, test.want)
			}
		})
	}
}

func TestLeadOperationCapabilityJSONUsesExistingResponseConventions(t *testing.T) {
	viewer := tenant.Context{UserID: "broker", Permissions: []string{permissions.LeadViewOwn, permissions.LeadOperate}}
	board, err := json.Marshal(withPipelineLeadOperationCapability(viewer, PipelineBoardLead{
		AssignedUserID: optionalString("broker", 64),
	}))
	if err != nil {
		t.Fatal(err)
	}
	var boardPayload map[string]any
	if err := json.Unmarshal(board, &boardPayload); err != nil {
		t.Fatal(err)
	}
	if boardPayload["can_operate"] != true {
		t.Fatalf("board JSON can_operate=%v, want true", boardPayload["can_operate"])
	}

	detail, err := json.Marshal(withLeadOperationCapability(viewer, Lead{AssignedUserID: "broker"}))
	if err != nil {
		t.Fatal(err)
	}
	var detailPayload map[string]any
	if err := json.Unmarshal(detail, &detailPayload); err != nil {
		t.Fatal(err)
	}
	if detailPayload["canOperate"] != true {
		t.Fatalf("detail JSON canOperate=%v, want true", detailPayload["canOperate"])
	}
	leader := tenant.Context{
		UserID:      "leader",
		Permissions: []string{permissions.LeadViewTeam, permissions.LeadOperate},
		LedTeamIDs:  []string{"team-a"},
		LedUserIDs:  []string{"broker"},
	}
	readOnlyDetail, err := json.Marshal(withLeadOperationCapability(leader, Lead{
		AssignedUserID: "broker",
		TeamID:         "team-b",
	}))
	if err != nil {
		t.Fatal(err)
	}
	var readOnlyPayload map[string]any
	if err := json.Unmarshal(readOnlyDetail, &readOnlyPayload); err != nil {
		t.Fatal(err)
	}
	if readOnlyPayload["canOperate"] != false {
		t.Fatalf("read-only detail must explicitly report canOperate=false, got %v", readOnlyPayload["canOperate"])
	}

	undecorated, err := json.Marshal(Lead{})
	if err != nil {
		t.Fatal(err)
	}
	var undecoratedPayload map[string]any
	if err := json.Unmarshal(undecorated, &undecoratedPayload); err != nil {
		t.Fatal(err)
	}
	if _, exists := undecoratedPayload["canOperate"]; exists {
		t.Fatal("a write response without a fresh access check must not claim an operation capability")
	}
}
