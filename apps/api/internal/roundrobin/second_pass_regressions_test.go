package roundrobin

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const secondOrg = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const secondQueue = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const secondA = "11111111-1111-4111-8111-111111111111"
const secondB = "22222222-2222-4222-8222-222222222222"
const secondC = "33333333-3333-4333-8333-333333333333"

func secondLeader() tenant.Context {
	return tenant.Context{OrganizationID: secondOrg, IsTeamLeader: true, LedUserIDs: []string{secondA, secondC}, Permissions: []string{permissions.DistributionManage}}
}

func TestSharedRosterOmissionCannotDeleteAnotherLeadersParticipant(t *testing.T) {
	a, b := secondA, secondB
	existing := []persistedMemberState{{ID: secondA, UserID: &a, Weight: 10, Position: 0, IsActive: true}, {ID: secondB, UserID: &b, Weight: 20, Position: 1, IsActive: false}}
	members := []memberInput{{ID: secondA, UserID: &a, Weight: 10, WeightSet: true}, {ID: secondB, UserID: &b, Weight: 20, WeightSet: true}}
	plan, err := planMemberReconciliationInScope(secondLeader(), existing, members)
	if err != nil || len(plan.Updates)+len(plan.Deletes)+len(plan.Inserts) != 0 {
		t.Fatalf("rename/unchanged roster must preserve outsider: plan=%#v err=%v", plan, err)
	}
	for _, changed := range [][]memberInput{members[:1], {{ID: secondA, UserID: &a}, {ID: secondB, UserID: &b, Weight: 21, WeightSet: true}}} {
		if _, err := planMemberReconciliationInScope(secondLeader(), existing, changed); !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
			t.Fatalf("omission/weight change of outsider accepted: %v", err)
		}
	}
	active := true
	members[1].IsActive = &active
	if _, err := planMemberReconciliationInScope(secondLeader(), existing, members); !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatalf("re-enrollment of outsider accepted: %v", err)
	}
}

func TestScopedRosterRemovalAndInsertionKeepProtectedPosition(t *testing.T) {
	a, b, c := secondA, secondB, secondC
	existing := []persistedMemberState{{ID: secondA, UserID: &a, Weight: 10, Position: 0, IsActive: true}, {ID: secondB, UserID: &b, Weight: 20, Position: 1, IsActive: true}}
	plan, err := planMemberReconciliationInScope(secondLeader(), existing, []memberInput{{UserID: &b, Weight: 20, WeightSet: true}, {UserID: &c, Weight: 7, WeightSet: true}})
	if err != nil || len(plan.Updates) != 0 || len(plan.Deletes) != 1 || plan.Deletes[0] != secondA || len(plan.Inserts) != 1 || plan.Inserts[0].Position != 2 {
		t.Fatalf("removed predecessor must not re-position protected B; new C must not collide: %#v %v", plan, err)
	}
	// A foreign roster ID cannot be used to inherit or authorize a participant.
	if _, err := planMemberReconciliationInScope(secondLeader(), existing, []memberInput{{ID: secondC, UserID: &c}}); !errors.Is(err, ErrInvalidReference) {
		t.Fatalf("unknown/other-organization member ID accepted: %v", err)
	}
}

func TestSharedRosterRepositoryRejectsOmissionAndForeignIDsBeforeAnyWrite(t *testing.T) {
	pipeline := secondC
	leader := secondLeader()
	leader.LedPipelineIDs = []string{pipeline}
	if err := ensureRoundRobinInputInScope(leader, &pipeline, nil, false, true); err != nil {
		t.Fatalf("shared queue must remain editable through led pipeline: %v", err)
	}
	for _, candidate := range [][]memberInput{
		{{ID: secondA, UserID: stringPointer(secondA)}},
		{{ID: secondC, UserID: stringPointer(secondC)}},
		{{ID: secondA, UserID: stringPointer(secondA)}, {ID: secondB, UserID: stringPointer(secondB)}},
	} {
		tx := &secondTx{rows: func(sql string, args ...any) (pgx.Rows, error) {
			if !strings.Contains(sql, "where organization_id = $1::uuid") || args[0] != secondOrg || args[1] != secondQueue {
				t.Fatalf("roster read lost organization/queue fence: %s %#v", sql, args)
			}
			return &reconcileTestRows{values: [][]any{{secondA, secondA, nil, 10, 0, true}, {secondB, secondB, nil, 20, 1, false}}}, nil
		}}
		changed, err := (Repository{}).reconcileMembers(context.Background(), tx, leader, secondQueue, candidate, true)
		if len(candidate) == 2 {
			if err != nil || changed {
				t.Fatalf("unchanged shared roster unexpectedly mutated: %v %v", changed, err)
			}
		} else if candidate[0].ID == secondA {
			if !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
				t.Fatalf("outsider omission reached SQL: %v", err)
			}
		} else if !errors.Is(err, ErrInvalidReference) {
			t.Fatalf("foreign roster ID reached SQL: %v", err)
		}
		if len(tx.writes) != 0 {
			t.Fatalf("rejected/unchanged roster wrote rows: %#v", tx.writes)
		}
	}
}

type secondTx struct {
	pgx.Tx
	row    func(string, ...any) pgx.Row
	rows   func(string, ...any) (pgx.Rows, error)
	writes []string
}

func (tx *secondTx) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	return tx.row(sql, args...)
}
func (tx *secondTx) Query(_ context.Context, sql string, args ...any) (pgx.Rows, error) {
	return tx.rows(sql, args...)
}
func (tx *secondTx) Exec(_ context.Context, sql string, _ ...any) (pgconn.CommandTag, error) {
	tx.writes = append(tx.writes, sql)
	return pgconn.NewCommandTag("UPDATE 1"), nil
}

func TestInactiveNewMembersReachTheInsertAndAggregatePlan(t *testing.T) {
	inactive := false
	input, err := normalizeMemberInputs([]MemberInput{{Type: "user", EntityID: secondA, IsActive: &inactive}})
	if err != nil {
		t.Fatal(err)
	}
	plan, err := planMemberReconciliation(nil, input)
	if err != nil || len(plan.Inserts) != 1 || plan.Inserts[0].IsActive {
		t.Fatalf("aggregate ignored false: %#v %v", plan, err)
	}
	inserted := false
	tx := &secondTx{row: func(sql string, args ...any) pgx.Row {
		switch {
		case strings.Contains(sql, "select exists"):
			if args[0] != secondOrg {
				t.Fatal("user validation lost tenant")
			}
			return hardeningRow{true}
		case strings.Contains(sql, "max(position)"):
			return hardeningRow{0}
		case strings.Contains(sql, "insert into public.round_robin_members"):
			inserted = true
			if len(args) != 7 || args[6] != false {
				t.Fatalf("insert did not bind explicit false: %#v", args)
			}
			return hardeningRow{secondB}
		default:
			return hardeningErrorRow{fmt.Errorf("unexpected query %s", sql)}
		}
	}, rows: func(string, ...any) (pgx.Rows, error) { return &reconcileTestRows{}, nil }}
	ids, err := (Repository{}).insertMembers(context.Background(), tx, tenant.Context{OrganizationID: secondOrg, MemberRole: "admin"}, secondQueue, input, true)
	if err != nil || !inserted || len(ids) != 1 {
		t.Fatalf("insert: %#v %v", ids, err)
	}
}

func TestRawTagSnapshotsKeepSeventeenAndOneHundredIdentifiers(t *testing.T) {
	for _, count := range []int{17, 100} {
		values := make([]string, count)
		for index := range values {
			values[index] = fmt.Sprintf("%08x-1111-4111-8111-111111111111", index)
		}
		raw := strings.Join(values, ",")
		rule, err := normalizeRuleInput(RuleInput{ID: secondA, MatchType: "tag", MatchValue: raw, Match: map[string]any{"tags": values}}, 0)
		if err != nil || rule.MatchValue != raw {
			t.Fatalf("%d tags truncated: %v", count, err)
		}
		state := persistedRuleState{ID: secondA, MatchType: "tag", MatchValue: raw, Match: rule.Match, Priority: 27, IsActive: true}
		plan, err := planRuleReconciliation([]persistedRuleState{state}, []ruleInput{rule})
		if err != nil || len(plan.Updates)+len(plan.Deletes)+len(plan.Inserts) != 0 {
			t.Fatalf("%d tags roundtrip changed: %#v %v", count, plan, err)
		}
		if err := validateNewRuleValueBounds(rule); err != nil {
			t.Fatalf("%d tags unexpectedly too large: %v", count, err)
		}
		q := &hardeningQueryer{query: func(sql string, args ...any) pgx.Row {
			if !strings.Contains(sql, "public.tags where organization_id = $1::uuid") || args[0] != secondOrg {
				t.Fatal("tag validation lost tenant")
			}
			return hardeningRow{true}
		}}
		if err := (Repository{}).validateRuleReferences(context.Background(), q, secondOrg, []ruleInput{rule}); err != nil || len(q.calls) != count {
			t.Fatalf("%d tag references not preserved/validated: %d %v", count, len(q.calls), err)
		}
	}
}

func TestLongLegacyMatcherExceptionRequiresRealUnchangedIdentity(t *testing.T) {
	raw := strings.Repeat("x", maxNewRuleMatchValueLength+1)
	state := persistedRuleState{ID: secondA, MatchType: "city", MatchValue: raw, Priority: 1, IsActive: false}
	for _, id := range []string{"", secondB} {
		rule := ruleInput{ID: id, MatchType: "city", MatchValue: raw}
		if id == "" && !errors.Is(validateNewRuleValueBounds(rule), ErrInvalidInput) {
			t.Fatal("new oversized value accepted")
		}
		if id != "" {
			if _, err := planRuleReconciliation([]persistedRuleState{state}, []ruleInput{rule}); !errors.Is(err, ErrInvalidReference) {
				t.Fatalf("invented ID bypassed limits: %v", err)
			}
		}
	}
	unchanged := ruleInput{ID: secondA, MatchType: "city", MatchValue: raw, IsActive: true, IsActiveSet: true}
	plan, err := planRuleReconciliation([]persistedRuleState{state}, []ruleInput{unchanged})
	if err != nil {
		t.Fatal(err)
	}
	validate := rulesRequiringReferenceValidation([]persistedRuleState{state}, plan)
	if len(validate) != 1 || !validate[0].MatcherUnchanged || validateNewRuleValueBounds(validate[0]) != nil {
		t.Fatalf("persisted unchanged matcher was not preserved: %#v", validate)
	}
	unchanged.MatchValue += "y"
	plan, err = planRuleReconciliation([]persistedRuleState{state}, []ruleInput{unchanged})
	if err != nil {
		t.Fatal(err)
	}
	validate = rulesRequiringReferenceValidation([]persistedRuleState{state}, plan)
	if len(validate) != 1 || validate[0].MatcherUnchanged || !errors.Is(validateNewRuleValueBounds(validate[0]), ErrInvalidInput) {
		t.Fatal("changed oversized matcher reused legacy exception")
	}
}

func TestRuleRepositoryCannotUseAnInventedOrForeignIDToBypassNewValueBounds(t *testing.T) {
	for _, foreign := range []bool{false, true} {
		tx := &secondTx{rows: func(sql string, args ...any) (pgx.Rows, error) {
			if strings.Contains(sql, "where organization_id = $1::uuid") {
				if args[0] != secondOrg || args[1] != secondQueue {
					t.Fatal("persisted rule snapshot lost tenant/queue")
				}
				return &reconcileTestRows{}, nil
			}
			if foreign {
				return &reconcileTestRows{values: [][]any{{secondA}}}, nil
			}
			return &reconcileTestRows{}, nil
		}}
		changed, err := (Repository{}).reconcileRules(context.Background(), tx, secondOrg, secondQueue, []ruleInput{{ID: secondA, MatchType: "city", MatchValue: strings.Repeat("x", maxNewRuleMatchValueLength+1)}})
		want := ErrInvalidInput
		if foreign {
			want = ErrInvalidReference
		}
		if changed || !errors.Is(err, want) || len(tx.writes) != 0 {
			t.Fatalf("foreign=%v changed=%v error=%v writes=%d", foreign, changed, err, len(tx.writes))
		}
	}
}

func TestCampaignCommaIsLiteralForNewRulesAndLegacyCSVRemainsUnchanged(t *testing.T) {
	const phrase = "Lançamento, Centro"
	condition, err := (ConditionInput{Type: "campaign_contains", Values: []string{phrase}}).toRuleInput(0)
	if err != nil {
		t.Fatal(err)
	}
	if literals, ok := condition.Match[campaignLiteralValuesKey].([]string); !ok || len(literals) != 1 || literals[0] != phrase {
		t.Fatalf("condition split literal comma: %#v", condition.Match)
	}
	raw, err := normalizeRuleInput(RuleInput{MatchType: "campaign_contains", MatchValue: phrase}, 0)
	if err != nil {
		t.Fatal(err)
	}
	prepared, err := prepareNewRuleMatcher(raw)
	if err != nil || prepared.Match[campaignLiteralValuesKey].([]string)[0] != phrase {
		t.Fatalf("raw new rule split comma: %#v %v", prepared, err)
	}
	legacy := persistedRuleState{ID: secondA, MatchType: "campaign_contains", MatchValue: phrase, Match: map[string]any{"campaign_name_contains": "Lançamento"}, Priority: 2, IsActive: true}
	input := ruleInput{ID: secondA, MatchType: legacy.MatchType, MatchValue: legacy.MatchValue, Match: legacy.Match}
	plan, err := planRuleReconciliation([]persistedRuleState{legacy}, []ruleInput{input})
	if err != nil {
		t.Fatal(err)
	}
	plan, err = prepareRulePlanMatchers([]persistedRuleState{legacy}, plan)
	if err != nil || len(plan.Updates) != 0 {
		t.Fatalf("unchanged CSV mutated: %#v %v", plan, err)
	}
	if _, exists := plan.Effective[0].Match[campaignLiteralValuesKey]; exists {
		t.Fatal("unchanged legacy matcher silently migrated")
	}
	input.MatchValue = "Novo, Centro"
	plan, _ = planRuleReconciliation([]persistedRuleState{legacy}, []ruleInput{input})
	plan, err = prepareRulePlanMatchers([]persistedRuleState{legacy}, plan)
	if err != nil || plan.Updates[0].Rule.Match[campaignLiteralValuesKey].([]string)[0] != input.MatchValue {
		t.Fatalf("explicit change did not become literal: %#v %v", plan, err)
	}
	for _, invalid := range []any{nil, []string{}, []any{1}, []string{" "}} {
		if err := validateNewRuleValueBounds(ruleInput{MatchType: "campaign_contains", MatchValue: phrase, Match: map[string]any{campaignLiteralValuesKey: invalid}}); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("invalid present marker accepted: %#v %v", invalid, err)
		}
	}
}

func TestFormAliasesConflictBothDirectionsAndKeepConfigurationLinks(t *testing.T) {
	for _, types := range [][2]string{{"form", "meta_form"}, {"meta_form", "form"}} {
		tx := &secondTx{rows: func(sql string, args ...any) (pgx.Rows, error) {
			if args[0] != secondOrg || !strings.Contains(sql, "rrr.organization_id = $1::uuid") {
				t.Fatal("conflict lookup lost tenant boundary")
			}
			return &reconcileTestRows{values: [][]any{{secondQueue, "Other queue", fmt.Sprintf(`{"match_type":%q,"match_value":"form-1"}`, types[1])}}}, nil
		}}
		err := (Repository{}).checkConditionConflicts(context.Background(), tx, secondOrg, nil, []ruleInput{{MatchType: types[0], MatchValue: "form-1", IsActive: true}})
		var conflict ConditionConflictError
		if !errors.As(err, &conflict) {
			t.Fatalf("aliases %v failed conflict check: %v", types, err)
		}
	}
	tx := &secondTx{rows: func(sql string, _ ...any) (pgx.Rows, error) {
		if strings.Contains(sql, "from public.round_robin_rules") {
			if !strings.Contains(sql, "in ('meta_form', 'form')") {
				t.Fatal("legacy form alias no longer selected")
			}
			return &reconcileTestRows{values: [][]any{{"form-1"}}}, nil
		}
		return &reconcileTestRows{values: [][]any{{"form-1", secondQueue, "Queue"}}}, nil
	}}
	if err := (Repository{}).syncMetaFormConfigLinks(context.Background(), tx, secondOrg, secondQueue); err != nil {
		t.Fatal(err)
	}
	if len(tx.writes) != 2 || !strings.Contains(tx.writes[0], "and not (form_id = any($3::text[]))") {
		t.Fatalf("legacy linked form was cleared: %#v", tx.writes)
	}
}

func TestMemberPositionsRejectIntegerOverflowBeforeSQL(t *testing.T) {
	revision := int64(1)
	for _, position := range []int{0, 2147483647, 2147483648, -1} {
		_, err := (UpdateMemberRequest{ExpectedRevision: &revision, Position: &position}).Validate()
		valid := position >= 0 && position <= 2147483647
		if (err == nil) != valid {
			t.Fatalf("position %d validation mismatch: %v", position, err)
		}
	}
}
