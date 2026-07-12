package gamification

import (
	"context"
	"errors"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestNormalizeActionTypeRejectsUnknownActions(t *testing.T) {
	t.Parallel()

	tests := map[string]string{
		"call_made":          "call_made",
		"Ligacao realizada":  "call_made",
		"mensagem-enviada":   "message_sent",
		"lead ganho":         "sale_closed",
		"imovel criado":      "property_created",
		"prospecting_report": "prospecting_report",
		"arbitrary_action":   "",
		"mission_bonus":      "",
	}
	for input, expected := range tests {
		input, expected := input, expected
		t.Run(input, func(t *testing.T) {
			t.Parallel()
			if actual := normalizeActionType(input); actual != expected {
				t.Fatalf("normalizeActionType(%q) = %q, want %q", input, actual, expected)
			}
		})
	}
}

func TestIdempotencyKeyIsStableAndTenantScoped(t *testing.T) {
	t.Parallel()

	organizationA := "11111111-1111-4111-8111-111111111111"
	organizationB := "22222222-2222-4222-8222-222222222222"
	first := gamificationIdempotencyKey(organizationA, "venda_concluida", "lead-42")
	retry := gamificationIdempotencyKey(organizationA, "sale_closed", "lead-42")
	otherTenant := gamificationIdempotencyKey(organizationB, "sale_closed", "lead-42")

	if first != retry {
		t.Fatalf("aliases must produce the same idempotency key: %q != %q", first, retry)
	}
	if first == otherTenant {
		t.Fatal("the same business reference in different organizations must not collide")
	}
}

func TestDefaultRuleContractUsesUUIDsAndKnownActions(t *testing.T) {
	t.Parallel()

	seenIDs := map[string]bool{}
	seenActions := map[string]bool{}
	for _, rule := range defaultRules() {
		if !isUUIDText(rule.ID) {
			t.Fatalf("default rule %s has non-UUID id %q", rule.ActionType, rule.ID)
		}
		if seenIDs[rule.ID] {
			t.Fatalf("duplicate default rule id %q", rule.ID)
		}
		if normalizeActionType(rule.ActionType) == "" {
			t.Fatalf("default rule has unknown action %q", rule.ActionType)
		}
		if rule.Points < 0 || rule.Points > 100_000 {
			t.Fatalf("default rule %s has out-of-range points %d", rule.ActionType, rule.Points)
		}
		seenIDs[rule.ID] = true
		seenActions[rule.ActionType] = true
	}
	if len(seenActions) != 15 {
		t.Fatalf("expected 15 canonical default actions, got %d", len(seenActions))
	}
}

func TestManualEntryTransitionsAreOneWay(t *testing.T) {
	t.Parallel()

	if err := validateManualEntryTransition("pending", "approved", ""); err != nil {
		t.Fatalf("pending -> approved should be valid: %v", err)
	}
	if err := validateManualEntryTransition("pending", "rejected", "duplicado"); err != nil {
		t.Fatalf("pending -> rejected with reason should be valid: %v", err)
	}
	invalid := []struct {
		current string
		next    string
		reason  string
	}{
		{current: "approved", next: "rejected", reason: "late"},
		{current: "rejected", next: "approved"},
		{current: "pending", next: "rejected"},
		{current: "pending", next: "pending"},
	}
	for _, item := range invalid {
		if err := validateManualEntryTransition(item.current, item.next, item.reason); err == nil {
			t.Fatalf("transition %s -> %s should be rejected", item.current, item.next)
		}
	}
}

func TestMissionStructureChangePolicy(t *testing.T) {
	t.Parallel()

	base := missionStructure{
		ActionType:  "call_made",
		TargetCount: 10,
		BonusPoints: 100,
		Period:      "daily",
		TargetScope: "organization",
	}
	if missionStructureChanged(base, base) {
		t.Fatal("unchanged mission structure must preserve progress")
	}
	changed := base
	changed.TargetCount = 20
	if !missionStructureChanged(base, changed) {
		t.Fatal("target change must be blocked after progress exists")
	}
	changed = base
	changed.Period = "weekly"
	if !missionStructureChanged(base, changed) {
		t.Fatal("period change must be blocked after progress exists")
	}
}

func TestRecordActionCompatibilityDoesNotTouchDatabase(t *testing.T) {
	t.Parallel()

	repo := Repository{}
	tenantContext := tenant.Context{
		OrganizationID: "11111111-1111-4111-8111-111111111111",
		UserID:         "22222222-2222-4222-8222-222222222222",
	}
	if err := repo.RecordAction(context.Background(), tenantContext, "call_made", 1, "task-1"); err != nil {
		t.Fatalf("covered compatibility action must be a no-op: %v", err)
	}
	if err := repo.RecordAction(context.Background(), tenantContext, "invented", 1, "task-1"); err == nil {
		t.Fatal("unknown compatibility action must still be rejected")
	}
}

func TestEventPageRejectsCrossUserScopeBeforeDatabaseAccess(t *testing.T) {
	t.Parallel()

	repo := Repository{}
	tenantContext := tenant.Context{
		OrganizationID: "11111111-1111-4111-8111-111111111111",
		UserID:         "22222222-2222-4222-8222-222222222222",
	}
	_, err := repo.EventPage(context.Background(), tenantContext, EventQuery{
		UserID: "33333333-3333-4333-8333-333333333333",
		Limit:  30,
	})
	if !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatalf("cross-user history error = %v, want access denied", err)
	}
}

func TestFilteredRankingRejectsUnknownActionsBeforeDatabaseAccess(t *testing.T) {
	t.Parallel()

	repo := Repository{}
	_, err := repo.FilteredRanking(context.Background(), tenant.Context{}, RankingQuery{ActionTypes: []string{"invented"}})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("unknown ranking action error = %v, want invalid input", err)
	}
}
