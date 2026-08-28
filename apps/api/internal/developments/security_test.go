package developments

import (
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestReservationLeadVisibilityUsesCanonicalOwnTeamAllScopes(t *testing.T) {
	tests := []struct {
		name    string
		context tenant.Context
		scope   reservationLeadScope
		want    bool
	}{
		{
			name: "own lead",
			context: tenant.Context{
				UserID:      "user-1",
				Permissions: []string{permissions.LeadViewOwn},
			},
			scope: reservationLeadScope{AssignedUserID: "user-1"},
			want:  true,
		},
		{
			name: "led team lead",
			context: tenant.Context{
				UserID:      "leader",
				LedTeamIDs:  []string{"team-1"},
				Permissions: []string{permissions.LeadViewTeam},
			},
			scope: reservationLeadScope{AssignedUserID: "user-2", TeamID: "team-1"},
			want:  true,
		},
		{
			name: "foreign lead",
			context: tenant.Context{
				UserID:      "user-1",
				Permissions: []string{permissions.LeadViewOwn},
			},
			scope: reservationLeadScope{AssignedUserID: "user-2", TeamID: "team-2"},
			want:  false,
		},
		{
			name: "view all",
			context: tenant.Context{
				UserID:      "auditor",
				Permissions: []string{permissions.LeadViewAll},
			},
			scope: reservationLeadScope{AssignedUserID: "user-2", TeamID: "team-2"},
			want:  true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := canViewReservationLead(test.context, test.scope); got != test.want {
				t.Fatalf("canViewReservationLead() = %v, want %v", got, test.want)
			}
		})
	}
}

func TestRedactReservationLeadRemovesForeignIdentifiers(t *testing.T) {
	leadID := "11111111-1111-4111-8111-111111111111"
	leadName := "Lead de outro corretor"
	reason := "contém contexto privado do lead"
	reservation := Reservation{LeadID: &leadID, LeadName: &leadName, CancellationReason: &reason}
	redactReservationLead(
		tenant.Context{UserID: "user-1", Permissions: []string{permissions.LeadViewOwn}},
		reservationLeadScope{AssignedUserID: "user-2"},
		&reservation,
	)
	if reservation.LeadID != nil || reservation.LeadName != nil || reservation.CancellationReason != nil {
		t.Fatalf("foreign lead was not redacted: %#v", reservation)
	}
}

func TestReservationOperationCapabilityCombinesManagementAndLeadVisibility(t *testing.T) {
	leadID := "11111111-1111-4111-8111-111111111111"
	manager := tenant.Context{
		UserID:      "user-1",
		Permissions: []string{permissions.PropertyManage, permissions.LeadViewOwn},
	}

	if canOperateReservation(
		manager,
		reservationLeadScope{AssignedUserID: "user-2"},
		Reservation{LeadID: &leadID},
	) {
		t.Fatal("manager must not operate a reservation whose lead is outside the current scope")
	}
	if !canOperateReservation(
		manager,
		reservationLeadScope{},
		Reservation{},
	) {
		t.Fatal("manager must be able to operate a reservation without a linked lead")
	}
	if canOperateReservation(
		tenant.Context{UserID: "user-1", Permissions: []string{permissions.LeadViewAll}},
		reservationLeadScope{AssignedUserID: "user-2"},
		Reservation{LeadID: &leadID},
	) {
		t.Fatal("lead visibility alone must not grant reservation management")
	}
}

func TestRedactUnitCommercialFieldsKeepsOnlyActiveListPrice(t *testing.T) {
	active := "active"
	value := 900000.0
	minimum := 850000.0
	identifier := "11111111-1111-4111-8111-111111111111"
	name := "Tabela ativa"
	updatedAt := "2027-01-02T12:00:00Z"
	unit := Unit{
		ListPrice:                &value,
		MinimumPrice:             &minimum,
		PricePerSqm:              &value,
		PriceTableStatus:         &active,
		PriceTableID:             &identifier,
		PriceTableName:           &name,
		DraftListPrice:           &value,
		DraftMinimumPrice:        &minimum,
		DraftPricePerSqm:         &value,
		DraftPriceTableID:        &identifier,
		DraftPriceTableName:      &name,
		DraftPriceTableUpdatedAt: &updatedAt,
	}

	redactUnitCommercialFields(&unit)

	if unit.ListPrice == nil || unit.PricePerSqm == nil || unit.PriceTableStatus == nil {
		t.Fatalf("active public list pricing was removed: %#v", unit)
	}
	if unit.MinimumPrice != nil || unit.DraftListPrice != nil || unit.DraftMinimumPrice != nil ||
		unit.DraftPricePerSqm != nil || unit.DraftPriceTableID != nil ||
		unit.DraftPriceTableName != nil || unit.DraftPriceTableUpdatedAt != nil {
		t.Fatalf("sensitive unit pricing was not fully redacted: %#v", unit)
	}
}

func TestRedactWorkspaceCommercialFieldsRemovesDraftsAndPricePayloads(t *testing.T) {
	notes := "internal"
	actor := "11111111-1111-4111-8111-111111111111"
	workspace := Workspace{
		PriceTables: []PriceTable{
			{ID: "active", Status: "active", Notes: &notes, ApprovedBy: &actor, Metadata: map[string]any{"secret": true}},
			{ID: "draft", Status: "draft", Metadata: map[string]any{"secret": true}},
		},
		RecentUnitEvents: []UnitEvent{
			{EventType: "price_changed", BeforeData: map[string]any{"minimum_price": 1}, AfterData: map[string]any{"payment_terms": "secret"}, Metadata: map[string]any{"secret": true}},
			{EventType: "reservation_cancelled", Metadata: map[string]any{"reservation_id": "reservation", "reason": "private"}},
			{EventType: "status_changed", BeforeData: map[string]any{"status": "available"}, Metadata: map[string]any{}},
		},
	}

	redactWorkspaceCommercialFields(&workspace)

	if len(workspace.PriceTables) != 1 || workspace.PriceTables[0].ID != "active" {
		t.Fatalf("visible price tables = %#v, want only active", workspace.PriceTables)
	}
	if workspace.PriceTables[0].Notes != nil || workspace.PriceTables[0].ApprovedBy != nil || len(workspace.PriceTables[0].Metadata) != 0 {
		t.Fatalf("active price table internals were not redacted: %#v", workspace.PriceTables[0])
	}
	priceEvent := workspace.RecentUnitEvents[0]
	if priceEvent.BeforeData != nil || priceEvent.AfterData != nil || len(priceEvent.Metadata) != 0 {
		t.Fatalf("price event payload was not redacted: %#v", priceEvent)
	}
	if _, exists := workspace.RecentUnitEvents[1].Metadata["reason"]; exists {
		t.Fatalf("cancellation event leaked free-form reason: %#v", workspace.RecentUnitEvents[1])
	}
	if workspace.RecentUnitEvents[2].BeforeData == nil {
		t.Fatal("non-commercial unit event was unexpectedly redacted")
	}
}
