package stageconfig

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

func TestNativeStageAutomationStatusMatchesTerminalStage(t *testing.T) {
	for _, test := range []struct {
		name      string
		won, lost bool
		status    string
		valid     bool
	}{
		{"ordinary open", false, false, "open", true},
		{"ordinary won", false, false, "won", true},
		{"ordinary lost", false, false, "lost", true},
		{"won same", true, false, "won", true},
		{"won open rejected", true, false, "open", false},
		{"won lost rejected", true, false, "lost", false},
		{"lost same", false, true, "lost", true},
		{"lost open rejected", false, true, "open", false},
		{"lost won rejected", false, true, "won", false},
		{"corrupt dual terminal rejected", true, true, "won", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			err := validateNativeStageAutomationStatus(test.won, test.lost, test.status)
			if test.valid && err != nil {
				t.Fatalf("expected valid outcome: %v", err)
			}
			if !test.valid && !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("expected invalid outcome, got %v", err)
			}
		})
	}
}

type policyQuery struct {
	values  [][]any
	queries []string
	args    [][]any
}

func (query *policyQuery) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	query.queries = append(query.queries, sql)
	query.args = append(query.args, args)
	if len(query.values) == 0 {
		return policyRow{err: fmt.Errorf("unexpected query")}
	}
	row := policyRow{values: query.values[0]}
	query.values = query.values[1:]
	return row
}

type policyRow struct {
	values []any
	err    error
}

func (row policyRow) Scan(dest ...any) error {
	if row.err != nil {
		return row.err
	}
	if len(dest) != len(row.values) {
		return fmt.Errorf("scan mismatch")
	}
	for index, target := range dest {
		switch pointer := target.(type) {
		case *bool:
			*pointer = row.values[index].(bool)
		case *int:
			*pointer = row.values[index].(int)
		default:
			return fmt.Errorf("unsupported target")
		}
	}
	return nil
}

func TestAutomationPolicyChecksTenantNativeOutcomeAndExistingRules(t *testing.T) {
	for _, configSchema := range []bool{false, true} {
		for _, scenario := range []struct {
			name, automationType, status string
			active                       bool
			rows                         [][]any
			invalid                      bool
		}{
			{"won stage rejects lost rule", "change_deal_status_on_enter", "lost", true, [][]any{{true, false}}, true},
			{"lost stage accepts matching rule", "change_deal_status_on_enter", "lost", true, [][]any{{false, true}, {0}}, false},
			{"ordinary stage rejects another status rule", "change_deal_status_on_enter", "won", true, [][]any{{false, false}, {1}}, true},
			{"ordinary stage accepts same status", "change_deal_status_on_enter", "won", true, [][]any{{false, false}, {0}}, false},
			{"assignee exclusivity", "change_assignee_on_enter", "", true, [][]any{{1}}, true},
			{"one assignee", "change_assignee_on_enter", "", true, [][]any{{0}}, false},
			{"inactive legacy can be repaired", "change_assignee_on_enter", "", false, nil, false},
		} {
			t.Run(fmt.Sprintf("%s/schema=%t", scenario.name, configSchema), func(t *testing.T) {
				query := &policyQuery{values: scenario.rows}
				input := stageAutomationInput{IsActive: scenario.active, Config: map[string]any{"automation_type": scenario.automationType, "action_config": map[string]any{"deal_status": scenario.status}}}
				err := (Repository{}).validateAutomationStatusConflict(context.Background(), query, "organization-A", "stage-A", "edited-rule", input, configSchema)
				if scenario.invalid != errors.Is(err, ErrInvalidInput) {
					t.Fatalf("unexpected validation: %v", err)
				}
				if !scenario.invalid && err != nil {
					t.Fatal(err)
				}
				for index, args := range query.args {
					if args[0] != "organization-A" || args[1] != "stage-A" {
						t.Fatalf("policy lost tenant/stage scope: %#v", args)
					}
					if !strings.Contains(query.queries[index], "organization_id = $1::uuid") {
						t.Fatal("query must constrain tenant")
					}
					if len(args) > 2 && args[2] != "edited-rule" {
						t.Fatal("edit must exclude only the current automation")
					}
				}
			})
		}
	}
}
