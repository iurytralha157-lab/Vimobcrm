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

type recordedExec struct {
	query string
	args  []any
}

type recordingQueryer struct {
	execs []recordedExec
}

func (queryer *recordingQueryer) Exec(_ context.Context, query string, args ...any) (pgconn.CommandTag, error) {
	queryer.execs = append(queryer.execs, recordedExec{query: query, args: args})
	return pgconn.NewCommandTag("INSERT 0 1"), nil
}

func (*recordingQueryer) Query(context.Context, string, ...any) (pgx.Rows, error) {
	panic("unexpected Query call")
}

func (*recordingQueryer) QueryRow(context.Context, string, ...any) pgx.Row {
	panic("unexpected QueryRow call")
}

type stateRecordingQueryer struct {
	recordingQueryer
	query string
	args  []any
}

func (queryer *stateRecordingQueryer) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	queryer.query = query
	queryer.args = args
	return validWhatsAppMessageDistributionRow{}
}

type validWhatsAppMessageDistributionRow struct{}

func (validWhatsAppMessageDistributionRow) Scan(dest ...any) error {
	if len(dest) != 4 {
		return fmt.Errorf("unexpected destination count: %d", len(dest))
	}
	*dest[0].(*bool) = true
	*dest[1].(*bool) = false
	*dest[2].(*bool) = true
	*dest[3].(*int) = 0
	return nil
}

func TestSyncWhatsAppInboundRulesUsesNativeRuntimeContract(t *testing.T) {
	queryer := &recordingQueryer{}
	repo := Repository{}
	organizationID := "11111111-1111-1111-1111-111111111111"
	roundRobinID := "22222222-2222-2222-2222-222222222222"

	if err := repo.syncWhatsAppInboundRules(context.Background(), queryer, organizationID, roundRobinID); err != nil {
		t.Fatalf("syncWhatsAppInboundRules() error = %v", err)
	}
	if len(queryer.execs) != 3 {
		t.Fatalf("expected cleanup, upsert and deterministic priority statements, got %d", len(queryer.execs))
	}

	upsert := queryer.execs[1]
	for _, fragment := range []string{
		"insert into public.whatsapp_inbound_rules",
		"whatsapp_session.id",
		"round_robin_rule.match->>$4",
		"'contains'",
		"'message'",
		"target_round_robin_id",
		"coalesce(round_robin.target_pipeline_id, round_robin.pipeline_id)",
		"round_robin.target_stage_id",
		"on conflict (id) do update",
		"-2000000000",
	} {
		if !strings.Contains(upsert.query, fragment) {
			t.Errorf("upsert query does not contain %q", fragment)
		}
	}
	wantArgs := []any{organizationID, roundRobinID, whatsappMessageContainsConditionType, whatsappSessionMatchKey}
	if fmt.Sprint(upsert.args) != fmt.Sprint(wantArgs) {
		t.Fatalf("unexpected upsert args: %#v", upsert.args)
	}

	priorities := queryer.execs[2]
	for _, fragment := range []string{
		"row_number() over",
		"partition by inbound_rule.session_id",
		"char_length(inbound_rule.match_value) desc",
		"round_robin_rule.id = inbound_rule.id",
		"set priority = -1000000000 - ranked_managed_rules.managed_rank::int",
	} {
		if !strings.Contains(priorities.query, fragment) {
			t.Errorf("priority query does not contain %q", fragment)
		}
	}
	wantPriorityArgs := []any{organizationID, whatsappMessageContainsConditionType}
	if fmt.Sprint(priorities.args) != fmt.Sprint(wantPriorityArgs) {
		t.Fatalf("unexpected priority args: %#v", priorities.args)
	}
}

func TestDeleteWhatsAppInboundRulesOnlyTargetsManagedRuleIDs(t *testing.T) {
	queryer := &recordingQueryer{}
	repo := Repository{}

	if err := repo.deleteWhatsAppInboundRulesForRoundRobin(
		context.Background(),
		queryer,
		"11111111-1111-1111-1111-111111111111",
		"22222222-2222-2222-2222-222222222222",
	); err != nil {
		t.Fatalf("deleteWhatsAppInboundRulesForRoundRobin() error = %v", err)
	}
	if len(queryer.execs) != 1 {
		t.Fatalf("expected one cleanup statement, got %d", len(queryer.execs))
	}
	query := queryer.execs[0].query
	for _, fragment := range []string{
		"inbound_rule.organization_id = $1::uuid",
		"round_robin_rule.organization_id = $1::uuid",
		"round_robin_rule.round_robin_id = $2::uuid",
		"inbound_rule.id = round_robin_rule.id",
	} {
		if !strings.Contains(query, fragment) {
			t.Errorf("cleanup query does not contain %q", fragment)
		}
	}
}

func TestValidateWhatsAppMessageDistributionState(t *testing.T) {
	tests := []struct {
		name      string
		state     whatsappMessageDistributionState
		wantError string
	}{
		{
			name: "inactive queue remains an editable draft",
			state: whatsappMessageDistributionState{
				RequireCheckIn: true,
				HasActiveRule:  true,
			},
		},
		{
			name: "inactive rule remains an editable draft",
			state: whatsappMessageDistributionState{
				QueueActive:    true,
				RequireCheckIn: true,
			},
		},
		{
			name: "active queue may use a direct member without forcing schedule bypass",
			state: whatsappMessageDistributionState{
				QueueActive:   true,
				HasActiveRule: true,
			},
		},
		{
			name: "active queue may enforce schedules with team entries",
			state: whatsappMessageDistributionState{
				QueueActive:   true,
				HasActiveRule: true,
			},
		},
		{
			name: "missing WhatsApp connection is rejected",
			state: whatsappMessageDistributionState{
				QueueActive:             true,
				HasActiveRule:           true,
				InvalidSessionRuleCount: 1,
			},
			wantError: "valid active connection",
		},
		{
			name: "required check-in is rejected until the canonical engine supports it",
			state: whatsappMessageDistributionState{
				QueueActive:    true,
				RequireCheckIn: true,
				HasActiveRule:  true,
			},
			wantError: "required check-in",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateWhatsAppMessageDistributionState(test.state)
			if test.wantError == "" {
				if err != nil {
					t.Fatalf("validateWhatsAppMessageDistributionState() error = %v", err)
				}
				return
			}
			if !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("validateWhatsAppMessageDistributionState() error = %v, want ErrInvalidInput", err)
			}
			if !strings.Contains(err.Error(), test.wantError) {
				t.Fatalf("validateWhatsAppMessageDistributionState() error = %q, want substring %q", err, test.wantError)
			}
		})
	}
}

func TestWhatsAppMessageContainsConditionIsUniqueAcrossQueues(t *testing.T) {
	if _, ok := uniqueConditionTypes[whatsappMessageContainsConditionType]; !ok {
		t.Fatalf("%q must be checked for conflicts across queues", whatsappMessageContainsConditionType)
	}
}

func TestWhatsAppMessageConditionUsesOneCaseInsensitiveConflictValue(t *testing.T) {
	values := uniqueConditionValues(whatsappMessageContainsConditionType, "  Quero Casa, Agora  ")
	if len(values) != 1 || values[0] != "quero casa, agora" {
		t.Fatalf("uniqueConditionValues() = %#v, want one runtime-equivalent keyword", values)
	}
}

func TestWhatsAppMessageConditionRejectsOverlappingKeywords(t *testing.T) {
	for _, test := range []struct {
		name  string
		left  string
		right string
		want  bool
	}{
		{name: "same keyword", left: "quero casa", right: "quero casa", want: true},
		{name: "existing keyword contains new keyword", left: "casa", right: "quero casa", want: true},
		{name: "new keyword contains existing keyword", left: "quero apartamento", right: "apartamento", want: true},
		{name: "distinct keywords", left: "quero casa", right: "quero apartamento", want: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := conditionValuesConflict(whatsappMessageContainsConditionType, test.left, test.right); got != test.want {
				t.Fatalf("conditionValuesConflict() = %v, want %v", got, test.want)
			}
		})
	}
}

func TestWhatsAppMessageConditionConflictIsScopedBySession(t *testing.T) {
	const firstSession = "11111111-1111-1111-1111-111111111111"
	const secondSession = "22222222-2222-2222-2222-222222222222"
	if !conditionScopesConflict(whatsappMessageContainsConditionType, firstSession, firstSession) {
		t.Fatal("the same session must conflict")
	}
	if conditionScopesConflict(whatsappMessageContainsConditionType, firstSession, secondSession) {
		t.Fatal("different sessions must not conflict")
	}
	if !conditionScopesConflict(whatsappMessageContainsConditionType, "", secondSession) {
		t.Fatal("legacy wildcard sessions must conflict with every session")
	}
}

func TestWhatsAppMessageDistributionStateQueryMatchesCanonicalRuntime(t *testing.T) {
	queryer := &stateRecordingQueryer{}
	organizationID := "11111111-1111-1111-1111-111111111111"
	roundRobinID := "22222222-2222-2222-2222-222222222222"

	if err := (Repository{}).validateWhatsAppMessageDistribution(
		context.Background(),
		queryer,
		organizationID,
		roundRobinID,
	); err != nil {
		t.Fatalf("validateWhatsAppMessageDistribution() error = %v", err)
	}

	for _, fragment := range []string{
		"coalesce(round_robin.is_active, true)",
		"round_robin.settings->>'require_checkin'",
		"btrim(coalesce(nullif(rule.match_value, ''), rule.conditions->>'match_value', '')) <> ''",
		"left join public.whatsapp_sessions session",
		"rule.match->>$4",
		"session.provider = 'evolution_go'",
		"coalesce(session.is_active, true) = true",
		"not in ('deleted', 'disabled')",
	} {
		if !strings.Contains(queryer.query, fragment) {
			t.Errorf("state query does not contain %q", fragment)
		}
	}
	for _, forbidden := range []string{
		"round_robin.settings->>'enable_redistribution'",
		"round_robin.settings->>'ignore_availability'",
		"round_robin.strategy",
		"from public.round_robin_members member",
		"coalesce(nullif(rule.match_type, ''), rule.conditions->>'match_type', rule.name, '') <> $3",
	} {
		if strings.Contains(queryer.query, forbidden) {
			t.Errorf("state query must leave ordinary queue behavior to the canonical distributor; found %q", forbidden)
		}
	}

	wantArgs := []any{organizationID, roundRobinID, whatsappMessageContainsConditionType, whatsappSessionMatchKey}
	if fmt.Sprint(queryer.args) != fmt.Sprint(wantArgs) {
		t.Fatalf("unexpected state query args: %#v", queryer.args)
	}
}
