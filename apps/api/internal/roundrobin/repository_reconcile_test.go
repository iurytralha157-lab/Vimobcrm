package roundrobin

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestReconcileRoundTripEmitsNoChildWrites(t *testing.T) {
	const (
		organizationID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
		queueID        = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
		ruleID         = "11111111-1111-4111-8111-111111111111"
		memberID       = "22222222-2222-4222-8222-222222222222"
		teamID         = "33333333-3333-4333-8333-333333333333"
	)

	tx := &reconcileTestTx{
		query: func(_ string) (pgx.Rows, error) {
			return nil, fmt.Errorf("unexpected query")
		},
	}
	tx.query = func(query string) (pgx.Rows, error) {
		switch {
		case strings.Contains(query, "from public.round_robin_rules"):
			return &reconcileTestRows{values: [][]any{{
				ruleID,
				"source",
				"website",
				`{"source":["website"]}`,
				17,
				false,
			}}}, nil
		case strings.Contains(query, "from public.round_robin_members"):
			return &reconcileTestRows{values: [][]any{{
				memberID,
				nil,
				teamID,
				8,
				0,
				false,
			}}}, nil
		default:
			return nil, fmt.Errorf("unexpected query: %s", query)
		}
	}

	repo := Repository{}
	rule, err := (ConditionInput{ID: ruleID, Type: "source", Values: []string{"website"}}).toRuleInput(0)
	if err != nil {
		t.Fatalf("normalize rule: %v", err)
	}
	rulesChanged, err := repo.reconcileRules(context.Background(), tx, organizationID, queueID, []ruleInput{rule})
	if err != nil {
		t.Fatalf("reconcile rules: %v", err)
	}
	if rulesChanged {
		t.Fatal("semantic rule round trip was reported as changed")
	}

	weight := 8
	members, err := normalizeMemberInputs([]MemberInput{{
		ID:       memberID,
		Type:     "team",
		EntityID: teamID,
		Weight:   &weight,
	}})
	if err != nil {
		t.Fatalf("normalize member: %v", err)
	}
	membersChanged, err := repo.reconcileMembers(context.Background(), tx, tenant.Context{
		OrganizationID: organizationID,
		MemberRole:     "admin",
	}, queueID, members, false)
	if err != nil {
		t.Fatalf("reconcile members: %v", err)
	}
	if membersChanged {
		t.Fatal("semantic member round trip was reported as changed")
	}
	if tx.execCount != 0 {
		t.Fatalf("round trip emitted %d child writes; audit triggers would be spurious", tx.execCount)
	}
}

func TestPlanRuleReconciliationRoundTripPreservesIDActiveStateAndPriority(t *testing.T) {
	const ruleID = "11111111-1111-4111-8111-111111111111"
	condition, err := (ConditionInput{
		ID:     ruleID,
		Type:   "source",
		Values: []string{"meta_ads", "whatsapp"},
	}).toRuleInput(0)
	if err != nil {
		t.Fatalf("normalize condition: %v", err)
	}

	plan, err := planRuleReconciliation([]persistedRuleState{{
		ID:         ruleID,
		MatchType:  "source",
		MatchValue: "meta_ads,whatsapp",
		Match:      map[string]any{"source": []string{"meta_ads", "whatsapp"}},
		Priority:   37,
		IsActive:   false,
	}}, []ruleInput{condition})
	if err != nil {
		t.Fatalf("plan reconciliation: %v", err)
	}
	if len(plan.Updates) != 0 || len(plan.Inserts) != 0 || len(plan.Deletes) != 0 {
		t.Fatalf("semantic round trip must be a no-op: %#v", plan)
	}
	if len(plan.Effective) != 1 {
		t.Fatalf("effective rules = %d, want 1", len(plan.Effective))
	}
	if plan.Effective[0].ID != ruleID || plan.Effective[0].IsActive || plan.Effective[0].Priority != 37 {
		t.Fatalf("saved identity/state was not inherited: %#v", plan.Effective[0])
	}
}

func TestPlanRuleReconciliationEditsInPlaceAndRejectsForeignID(t *testing.T) {
	const ruleID = "11111111-1111-4111-8111-111111111111"
	plan, err := planRuleReconciliation([]persistedRuleState{{
		ID:         ruleID,
		MatchType:  "city",
		MatchValue: "Campinas",
		Match:      map[string]any{"city_in": []string{"Campinas"}},
		Priority:   81,
		IsActive:   false,
	}}, []ruleInput{{
		ID:         ruleID,
		MatchType:  "city",
		MatchValue: "Jundiai",
		Match:      map[string]any{"city_in": []string{"Jundiai"}},
		Priority:   1000,
		IsActive:   true,
	}})
	if err != nil {
		t.Fatalf("plan reconciliation: %v", err)
	}
	if len(plan.Updates) != 1 || len(plan.Inserts) != 0 || len(plan.Deletes) != 0 {
		t.Fatalf("rule edit must update the saved row in place: %#v", plan)
	}
	mutation := plan.Updates[0]
	if mutation.ID != ruleID || mutation.Rule.ID != ruleID || mutation.Rule.Priority != 81 || mutation.Rule.IsActive {
		t.Fatalf("rule identity/state changed during edit: %#v", mutation)
	}

	_, err = planRuleReconciliation(nil, []ruleInput{{
		ID:         ruleID,
		MatchType:  "city",
		MatchValue: "Jundiai",
		Match:      map[string]any{"city_in": []string{"Jundiai"}},
	}})
	if !errors.Is(err, ErrInvalidReference) {
		t.Fatalf("foreign/stale rule id error = %v, want ErrInvalidReference", err)
	}
}

func TestPlanRuleReconciliationFallsBackToExactSemanticsWithoutID(t *testing.T) {
	const ruleID = "11111111-1111-4111-8111-111111111111"
	plan, err := planRuleReconciliation([]persistedRuleState{{
		ID:         ruleID,
		MatchType:  "source",
		MatchValue: "website",
		Match:      map[string]any{"source": []any{"website"}},
		Priority:   63,
		IsActive:   false,
	}}, []ruleInput{{
		MatchType:  "source",
		MatchValue: "website",
		Match:      map[string]any{"source": []string{"website"}},
		Priority:   1000,
		IsActive:   true,
	}})
	if err != nil {
		t.Fatalf("plan reconciliation: %v", err)
	}
	if len(plan.Updates) != 0 || len(plan.Inserts) != 0 || len(plan.Deletes) != 0 {
		t.Fatalf("exact semantic fallback must preserve the saved row: %#v", plan)
	}
	if len(plan.Effective) != 1 || plan.Effective[0].ID != ruleID || plan.Effective[0].Priority != 63 || plan.Effective[0].IsActive {
		t.Fatalf("semantic fallback did not inherit saved identity/state: %#v", plan.Effective)
	}
}

func TestClassifyUnmatchedRuleIDsAcceptsEditorUUIDButRejectsPersistedForeignID(t *testing.T) {
	const (
		currentID = "11111111-1111-4111-8111-111111111111"
		clientID  = "22222222-2222-4222-8222-222222222222"
		foreignID = "33333333-3333-4333-8333-333333333333"
	)
	classified, err := classifyUnmatchedRuleIDs(
		map[string]struct{}{currentID: {}},
		map[string]struct{}{},
		[]ruleInput{
			{ID: currentID, MatchType: "source", MatchValue: "website"},
			{ID: clientID, MatchType: "city", MatchValue: "Jundiai"},
		},
	)
	if err != nil {
		t.Fatalf("classify ids: %v", err)
	}
	if classified[0].ID != currentID || classified[1].ID != "" {
		t.Fatalf("unexpected ID classification: %#v", classified)
	}

	_, err = classifyUnmatchedRuleIDs(
		map[string]struct{}{currentID: {}},
		map[string]struct{}{foreignID: {}},
		[]ruleInput{{ID: foreignID, MatchType: "source", MatchValue: "website"}},
	)
	if !errors.Is(err, ErrInvalidReference) {
		t.Fatalf("foreign rule id error = %v, want ErrInvalidReference", err)
	}
}

func TestPlanMemberReconciliationRoundTripPreservesSavedRow(t *testing.T) {
	const (
		memberID = "11111111-1111-4111-8111-111111111111"
		userID   = "22222222-2222-4222-8222-222222222222"
		teamID   = "33333333-3333-4333-8333-333333333333"
	)
	members, err := normalizeMemberInputs([]MemberInput{{
		ID:       memberID,
		Type:     "user",
		EntityID: userID,
		TeamID:   teamID,
	}})
	if err != nil {
		t.Fatalf("normalize member: %v", err)
	}

	plan, err := planMemberReconciliation([]persistedMemberState{{
		ID:       memberID,
		UserID:   reconcileStringPointer(userID),
		TeamID:   reconcileStringPointer(teamID),
		Weight:   29,
		Position: 0,
		IsActive: false,
	}}, members)
	if err != nil {
		t.Fatalf("plan reconciliation: %v", err)
	}
	if len(plan.Updates) != 0 || len(plan.Inserts) != 0 || len(plan.Deletes) != 0 {
		t.Fatalf("member round trip must preserve the saved row: %#v", plan)
	}
}

func TestPlanMemberReconciliationFallsBackToExactIdentityWithoutID(t *testing.T) {
	const (
		memberID = "11111111-1111-4111-8111-111111111111"
		teamID   = "22222222-2222-4222-8222-222222222222"
	)
	plan, err := planMemberReconciliation([]persistedMemberState{{
		ID:       memberID,
		TeamID:   reconcileStringPointer(teamID),
		Weight:   17,
		Position: 0,
		IsActive: false,
	}}, []memberInput{{
		Type:     "team",
		EntityID: teamID,
		TeamID:   reconcileStringPointer(teamID),
		Weight:   1,
	}})
	if err != nil {
		t.Fatalf("plan reconciliation: %v", err)
	}
	if len(plan.Updates) != 0 || len(plan.Inserts) != 0 || len(plan.Deletes) != 0 {
		t.Fatalf("exact identity fallback must preserve the saved row: %#v", plan)
	}
}

func TestPlanMemberReconciliationChangesWeightInPlace(t *testing.T) {
	const (
		memberID = "11111111-1111-4111-8111-111111111111"
		userID   = "22222222-2222-4222-8222-222222222222"
		teamID   = "33333333-3333-4333-8333-333333333333"
	)
	weight := 41
	members, err := normalizeMemberInputs([]MemberInput{{
		ID:       memberID,
		Type:     "user",
		EntityID: userID,
		TeamID:   teamID,
		Weight:   &weight,
	}})
	if err != nil {
		t.Fatalf("normalize member: %v", err)
	}

	plan, err := planMemberReconciliation([]persistedMemberState{{
		ID:       memberID,
		UserID:   reconcileStringPointer(userID),
		TeamID:   reconcileStringPointer(teamID),
		Weight:   29,
		Position: 0,
		IsActive: false,
	}}, members)
	if err != nil {
		t.Fatalf("plan reconciliation: %v", err)
	}
	if len(plan.Updates) != 1 || len(plan.Inserts) != 0 || len(plan.Deletes) != 0 {
		t.Fatalf("weight edit must update in place: %#v", plan)
	}
	mutation := plan.Updates[0]
	if mutation.ID != memberID || mutation.Weight != weight || mutation.Position != 0 || mutation.IsActive {
		t.Fatalf("member identity/state changed during weight edit: %#v", mutation)
	}
	if !sameOptionalString(mutation.UserID, reconcileStringPointer(userID)) || !sameOptionalString(mutation.TeamID, reconcileStringPointer(teamID)) {
		t.Fatalf("member context changed during weight edit: %#v", mutation)
	}
}

func TestPlanMemberReconciliationDeletesOnlyOmittedIDsAndAppendsNewRows(t *testing.T) {
	const (
		keptID    = "11111111-1111-4111-8111-111111111111"
		removedID = "22222222-2222-4222-8222-222222222222"
		keptTeam  = "33333333-3333-4333-8333-333333333333"
		oldTeam   = "44444444-4444-4444-8444-444444444444"
		newTeam   = "55555555-5555-4555-8555-555555555555"
	)
	plan, err := planMemberReconciliation([]persistedMemberState{
		{ID: keptID, TeamID: reconcileStringPointer(keptTeam), Weight: 2, Position: 0, IsActive: false},
		{ID: removedID, TeamID: reconcileStringPointer(oldTeam), Weight: 3, Position: 1, IsActive: true},
	}, []memberInput{
		{ID: keptID, Type: "team", EntityID: keptTeam, TeamID: reconcileStringPointer(keptTeam), Weight: 1},
		{Type: "team", EntityID: newTeam, TeamID: reconcileStringPointer(newTeam), Weight: 5, WeightSet: true},
	})
	if err != nil {
		t.Fatalf("plan reconciliation: %v", err)
	}
	if len(plan.Updates) != 0 || len(plan.Inserts) != 1 || len(plan.Deletes) != 1 {
		t.Fatalf("unexpected differential plan: %#v", plan)
	}
	if plan.Deletes[0] != removedID {
		t.Fatalf("deleted id = %q, want %q", plan.Deletes[0], removedID)
	}
	insert := plan.Inserts[0]
	if insert.ID != "" || insert.Position != 1 || insert.Weight != 5 || !insert.IsActive || !sameOptionalString(insert.TeamID, reconcileStringPointer(newTeam)) {
		t.Fatalf("new row did not append after preserved order: %#v", insert)
	}
}

func TestPlanMemberReconciliationAppliesCanonicalArrayOrderInPlace(t *testing.T) {
	const (
		firstID    = "11111111-1111-4111-8111-111111111111"
		secondID   = "22222222-2222-4222-8222-222222222222"
		firstTeam  = "33333333-3333-4333-8333-333333333333"
		secondTeam = "44444444-4444-4444-8444-444444444444"
	)
	plan, err := planMemberReconciliation([]persistedMemberState{
		{ID: firstID, TeamID: reconcileStringPointer(firstTeam), Weight: 2, Position: 0, IsActive: false},
		{ID: secondID, TeamID: reconcileStringPointer(secondTeam), Weight: 3, Position: 1, IsActive: true},
	}, []memberInput{
		{ID: secondID, Type: "team", EntityID: secondTeam, TeamID: reconcileStringPointer(secondTeam), Weight: 3, WeightSet: true},
		{ID: firstID, Type: "team", EntityID: firstTeam, TeamID: reconcileStringPointer(firstTeam), Weight: 2, WeightSet: true},
	})
	if err != nil {
		t.Fatalf("plan reconciliation: %v", err)
	}
	if len(plan.Updates) != 2 || len(plan.Inserts) != 0 || len(plan.Deletes) != 0 {
		t.Fatalf("reorder must update both saved rows in place: %#v", plan)
	}
	if plan.Updates[0].ID != secondID || plan.Updates[0].Position != 0 || !plan.Updates[0].IsActive {
		t.Fatalf("second member reorder mismatch: %#v", plan.Updates[0])
	}
	if plan.Updates[1].ID != firstID || plan.Updates[1].Position != 1 || plan.Updates[1].IsActive {
		t.Fatalf("first member reorder mismatch: %#v", plan.Updates[1])
	}
}

func TestPlanMemberReconciliationRejectsIDContextMismatch(t *testing.T) {
	const (
		memberID = "11111111-1111-4111-8111-111111111111"
		userID   = "22222222-2222-4222-8222-222222222222"
		otherID  = "33333333-3333-4333-8333-333333333333"
	)
	_, err := planMemberReconciliation([]persistedMemberState{{
		ID:       memberID,
		UserID:   reconcileStringPointer(userID),
		Weight:   1,
		Position: 0,
		IsActive: true,
	}}, []memberInput{{
		ID:       memberID,
		Type:     "user",
		EntityID: otherID,
		UserID:   reconcileStringPointer(otherID),
		Weight:   1,
	}})
	if !errors.Is(err, ErrInvalidReference) {
		t.Fatalf("context mismatch error = %v, want ErrInvalidReference", err)
	}
}

func TestQueueUpdateUsesDifferentialChildReconciliation(t *testing.T) {
	source := repositoryFunctionSource(t, "Update")
	requireRepositoryFragments(t, source, "repo.reconcileRules", "repo.reconcileMembers")
	requireRepositoryFragmentAbsent(t, source, "repo.insertRules")
	requireRepositoryFragmentAbsent(t, source, "repo.insertMembers")
	requireRepositoryFragmentAbsent(t, source, "deleteWhatsAppInboundRulesForRoundRobin")

	reconcileSource, err := os.ReadFile("repository_reconcile.go")
	if err != nil {
		t.Fatalf("read repository_reconcile.go: %v", err)
	}
	for _, fragment := range []string{
		"and id = $3::uuid",
		"is distinct from",
		"candidate.IsActive = state.IsActive",
		"desiredWeight := state.Weight",
		"Position: index",
	} {
		if !strings.Contains(string(reconcileSource), fragment) {
			t.Fatalf("reconciliation contract is missing %q", fragment)
		}
	}
}

func reconcileStringPointer(value string) *string {
	return &value
}

type reconcileTestTx struct {
	pgx.Tx
	query     func(string) (pgx.Rows, error)
	execCount int
}

func (tx *reconcileTestTx) Query(_ context.Context, query string, _ ...any) (pgx.Rows, error) {
	return tx.query(query)
}

func (tx *reconcileTestTx) Exec(_ context.Context, _ string, _ ...any) (pgconn.CommandTag, error) {
	tx.execCount++
	return pgconn.NewCommandTag("UPDATE 1"), nil
}

type reconcileTestRows struct {
	pgx.Rows
	values [][]any
	index  int
}

func (rows *reconcileTestRows) Close() {}

func (rows *reconcileTestRows) Err() error { return nil }

func (rows *reconcileTestRows) Next() bool {
	if rows.index >= len(rows.values) {
		return false
	}
	rows.index++
	return true
}

func (rows *reconcileTestRows) Scan(destinations ...any) error {
	if rows.index == 0 || rows.index > len(rows.values) {
		return errors.New("Scan called without a current row")
	}
	values := rows.values[rows.index-1]
	if len(values) != len(destinations) {
		return fmt.Errorf("scan destination count %d does not match value count %d", len(destinations), len(values))
	}
	for index, destination := range destinations {
		if err := assignReconcileTestValue(destination, values[index]); err != nil {
			return fmt.Errorf("scan column %d: %w", index, err)
		}
	}
	return nil
}

func assignReconcileTestValue(destination any, value any) error {
	switch target := destination.(type) {
	case *string:
		text, ok := value.(string)
		if !ok {
			return fmt.Errorf("expected string, got %T", value)
		}
		*target = text
	case *int:
		number, ok := value.(int)
		if !ok {
			return fmt.Errorf("expected int, got %T", value)
		}
		*target = number
	case *bool:
		boolean, ok := value.(bool)
		if !ok {
			return fmt.Errorf("expected bool, got %T", value)
		}
		*target = boolean
	case *pgtype.Text:
		if value == nil {
			*target = pgtype.Text{}
			return nil
		}
		text, ok := value.(string)
		if !ok {
			return fmt.Errorf("expected nullable string, got %T", value)
		}
		*target = pgtype.Text{String: text, Valid: true}
	default:
		return fmt.Errorf("unsupported scan destination %T", destination)
	}
	return nil
}
