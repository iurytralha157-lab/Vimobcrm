package roundrobin

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type thirdCaptureTx struct {
	pgx.Tx
	row  func(string, ...any) pgx.Row
	sql  []string
	args [][]any
}

func (q *thirdCaptureTx) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	return q.row(sql, args...)
}
func (q *thirdCaptureTx) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	q.sql = append(q.sql, sql)
	q.args = append(q.args, args)
	return pgconn.NewCommandTag("UPDATE 1"), nil
}

func TestAggregateMemberWeightAndOrderNeverBindNewMembershipGeneration(t *testing.T) {
	q := &thirdCaptureTx{}
	mutation := memberReconcileMutation{ID: secondA, Weight: 23, Position: 2, IsActive: true}
	if _, err := updateReconciledMember(context.Background(), q, secondOrg, secondQueue, mutation); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(q.sql[0], "is_active") {
		t.Fatalf("ordinary edit references activity trigger column: %s", q.sql[0])
	}
	if q.args[0][0] != secondOrg || q.args[0][1] != secondQueue || q.args[0][2] != secondA {
		t.Fatal("lost tenant/parent/row fence")
	}
	for _, active := range []bool{true, false} {
		mutation.ActiveSet = true
		mutation.IsActive = active
		if _, err := updateReconciledMember(context.Background(), q, secondOrg, secondQueue, mutation); err != nil {
			t.Fatal(err)
		}
		sql := q.sql[len(q.sql)-1]
		if !strings.Contains(sql, "is_active = $6") || q.args[len(q.args)-1][5] != active || !strings.Contains(sql, "or true") {
			t.Fatalf("explicit activity not applied: %s", sql)
		}
	}
}

func TestQueueCollectionCapsAndLockedAppendFence(t *testing.T) {
	if err := validateNewQueueCollectionSizes(make([]memberInput, 500), make([]ruleInput, 200)); err != nil {
		t.Fatal(err)
	}
	for _, sizes := range [][2]int{{501, 200}, {500, 201}} {
		if err := validateNewQueueCollectionSizes(make([]memberInput, sizes[0]), make([]ruleInput, sizes[1])); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("oversize create accepted: %v", err)
		}
	}
	for _, members := range []bool{true, false} {
		maximum := 200
		table := "round_robin_rules"
		if members {
			maximum = 500
			table = "round_robin_members"
		}
		for _, count := range []int{maximum - 1, maximum, maximum + 1} {
			q := &thirdCaptureTx{row: func(sql string, args ...any) pgx.Row {
				if !strings.Contains(sql, "public."+table) || !strings.Contains(sql, "organization_id = $1::uuid and round_robin_id = $2::uuid") || args[0] != secondOrg || args[1] != secondQueue {
					t.Fatalf("append count lacks tenant/parent fence: %s %#v", sql, args)
				}
				return hardeningRow{count}
			}}
			err := ensureQueueCollectionCanGrow(context.Background(), q, secondOrg, secondQueue, members)
			if (count >= maximum) != errors.Is(err, ErrInvalidInput) {
				t.Fatalf("count%d maximum%d err%v", count, maximum, err)
			}
		}
	}
}

func TestChildAppendCapsRunAfterDomainParentAndRevisionLocks(t *testing.T) {
	for _, name := range []string{"AddMember", "CreateRule"} {
		source := repositoryFunctionSource(t, name)
		requireRepositoryOrder(t, source, "lockConditionDomain", "getStateForUpdate")
		requireRepositoryOrder(t, source, "getStateForUpdate", "requireQueueRevision")
		requireRepositoryOrder(t, source, "requireQueueRevision", "ensureQueueCollectionCanGrow")
	}
}

func TestHybridRuleReadersAndConflictsUseSameRightBiasedMerge(t *testing.T) {
	for _, name := range []string{"getRuleWithQueryer", "listRulesWithQueryer", "loadPersistedRuleStates", "checkConditionConflicts"} {
		source := repositoryFunctionSource(t, name)
		requireRepositoryFragments(t, source, "conditions->'match', '{}'::jsonb) || coalesce(")
	}
	patch := repositoryFunctionSource(t, "UpdateRule")
	// A repeated matcher field may be present without changing persisted data.
	// Only an actual matcher change may replace hybrid conditions or markers.
	requireRepositoryFragments(t, patch, "if matcherChanged {", "MatcherUnchanged: !matcherChanged")
	requireRepositoryFragmentAbsent(t, patch, "if input.MatchType.Set || input.MatchValue.Set || input.Match.Set {")
}

func TestLegacyOversizedRuleSnapshotsCanOnlyBeKeptOrReduced(t *testing.T) {
	existing := make([]persistedRuleState, 202)
	inputs := make([]ruleInput, 202)
	for i := range existing {
		id := fmt.Sprintf("10000000-0000-4000-8000-%012d", i+1)
		existing[i] = persistedRuleState{ID: id, MatchType: "city", MatchValue: fmt.Sprint(i), IsActive: true}
		inputs[i] = ruleInput{ID: id, MatchType: "city", MatchValue: fmt.Sprint(i)}
	}
	for _, keep := range []int{202, 201, 200} {
		plan, err := planRuleReconciliation(existing, inputs[:keep])
		if err != nil {
			t.Fatal(err)
		}
		if err = validateRuleCollectionPlan(existing, plan); err != nil {
			t.Fatalf("preserve/reduce rejected: %v", err)
		}
	}
	for _, changed := range []ruleInput{
		{ID: inputs[0].ID, MatchType: "city", MatchValue: "changed"},
		{ID: inputs[0].ID, MatchType: "city", MatchValue: "0", Priority: 3, PrioritySet: true},
		{MatchType: "city", MatchValue: "new"},
	} {
		altered := append([]ruleInput(nil), inputs...)
		altered[0] = changed
		plan, err := planRuleReconciliation(existing, altered)
		if err != nil {
			t.Fatal(err)
		}
		if err = validateRuleCollectionPlan(existing, plan); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("legacy exception allowed changes: %v", err)
		}
	}
	foreign := append([]ruleInput(nil), inputs...)
	foreign[0].ID = secondB
	if _, err := planRuleReconciliation(existing, foreign); !errors.Is(err, ErrInvalidReference) {
		t.Fatalf("fabricated ID bypassed snapshot validation: %v", err)
	}
}

func TestLegacyOversizedMemberReductionRetainsHistoricalPosition(t *testing.T) {
	existing := make([]persistedMemberState, 502)
	inputs := make([]memberInput, 502)
	for i := range existing {
		id := fmt.Sprintf("10000000-0000-4000-8000-%012d", i+1)
		user := id
		existing[i] = persistedMemberState{ID: id, UserID: &user, Weight: 10, Position: i + 8, IsActive: true}
		inputs[i] = memberInput{ID: id, UserID: &user, Weight: 10, WeightSet: true}
	}
	candidate := inputs[1:]
	plan, err := planMemberReconciliation(existing, candidate)
	if err != nil {
		t.Fatal(err)
	}
	plan, err = constrainLegacyMemberCollectionPlan(existing, candidate, plan)
	if err != nil || len(plan.Updates) != 0 || len(plan.Deletes) != 1 {
		t.Fatalf("pure reduction changed retained rows: %#v %v", plan, err)
	}
	changed := append([]memberInput(nil), inputs...)
	changed[0].Weight = 11
	plan, err = planMemberReconciliation(existing, changed)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = constrainLegacyMemberCollectionPlan(existing, changed, plan); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("value change accepted above cap: %v", err)
	}
	changed = append([]memberInput(nil), inputs...)
	changed[0], changed[1] = changed[1], changed[0]
	plan, err = planMemberReconciliation(existing, changed)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = constrainLegacyMemberCollectionPlan(existing, changed, plan); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("reordering accepted above cap: %v", err)
	}
	changed = append([]memberInput(nil), inputs...)
	active := true
	changed[0].IsActive = &active
	plan, err = planMemberReconciliation(existing, changed)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = constrainLegacyMemberCollectionPlan(existing, changed, plan); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("repeated raw true can rebind a generation and cannot use the legacy exception: %v", err)
	}
}

func TestNoOpCampaignPatchPreservesCSVAndHybridMarker(t *testing.T) {
	legacy := map[string]any{}
	same := resolveRuleMatchPatch(legacy, "campaign_contains", "Alpha, Beta", patchObject{}, false)
	if len(same) != 0 {
		t.Fatalf("no-op changed CSV semantics: %#v", same)
	}
	literal := map[string]any{"campaign_name_contains_literals": []any{"Alpha, Beta"}, "opaque": "keep"}
	same = resolveRuleMatchPatch(literal, "campaign_contains", "Alpha, Beta", patchObject{}, false)
	if jsonb(same) != jsonb(literal) {
		t.Fatalf("hybrid marker lost: %#v", same)
	}
	q := &thirdCaptureTx{}
	if _, err := updateReconciledRuleMetadata(context.Background(), q, secondOrg, secondQueue, ruleReconcileMutation{ID: secondA, Rule: ruleInput{Priority: 0, IsActive: false}}); err != nil {
		t.Fatal(err)
	}
	for _, column := range []string{"conditions =", "match =", "match_type =", "match_value =", "name ="} {
		if strings.Contains(q.sql[0], column) {
			t.Fatalf("metadata edit overwrites legacy matcher: %s", q.sql[0])
		}
	}
}

func TestExplicitZeroPrioritySurvivesParentCreate(t *testing.T) {
	q := &thirdCaptureTx{}
	if err := (Repository{}).insertRules(context.Background(), q, secondOrg, secondQueue, []ruleInput{
		{MatchType: "city", MatchValue: "A", Priority: 0, PrioritySet: true, IsActive: true},
		{MatchType: "city", MatchValue: "B", Priority: 0, IsActive: true},
	}); err != nil {
		t.Fatal(err)
	}
	if q.args[0][7] != 0 || q.args[1][7] != 1 {
		t.Fatalf("explicit/default priority confused: %#v", q.args)
	}
}

func TestCapacitySnapshotMatchesTenantGenerationAndDeduplicationContract(t *testing.T) {
	q := &thirdCaptureTx{row: func(sql string, args ...any) pgx.Row {
		for _, guard := range []string{"rrm.organization_id = $1::uuid", "rrm.round_robin_id = $2::uuid", "count(distinct c.user_id)", "om.membership_generation = c.membership_generation", "om.is_active = true and om.deleted_at is null", "tm.membership_generation = e.membership_generation"} {
			if !strings.Contains(sql, guard) {
				t.Fatalf("capacity SQL missing %q", guard)
			}
		}
		if args[0] != secondOrg || args[1] != secondQueue {
			t.Fatal("capacity crossed organization")
		}
		return hardeningRow{2}
	}}
	count, err := (Repository{}).queueEligibleUserCount(context.Background(), q, secondOrg, secondQueue)
	if err != nil || count != 2 {
		t.Fatalf("authoritative count missing: %d %v", count, err)
	}
}

func TestOversizedChildPatchRequiresReductionButRetainsRealNoOps(t *testing.T) {
	countQueries := 0
	q := &thirdCaptureTx{row: func(sql string, args ...any) pgx.Row {
		if args[0] != secondOrg || args[1] != secondQueue {
			t.Fatal("foreign count")
		}
		if strings.Contains(sql, "count(*)") {
			countQueries++
			return hardeningRow{501}
		}
		return hardeningRow{10, 2, true}
	}}
	weight := 10
	if err := validateMemberPatchCollectionSize(context.Background(), q, secondOrg, secondQueue, secondA, updateMemberInput{Weight: &weight}); err != nil || countQueries != 0 {
		t.Fatalf("no-op rejected: %v", err)
	}
	weight = 11
	if err := validateMemberPatchCollectionSize(context.Background(), q, secondOrg, secondQueue, secondA, updateMemberInput{Weight: &weight}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("oversize edit accepted: %v", err)
	}
	active := true
	if err := validateMemberPatchCollectionSize(context.Background(), q, secondOrg, secondQueue, secondA, updateMemberInput{IsActive: patchBool{Set: true, Value: &active}}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("generation activation accepted above cap: %v", err)
	}
}
