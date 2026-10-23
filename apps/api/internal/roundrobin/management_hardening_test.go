package roundrobin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type hardeningRow []any

func (row hardeningRow) Scan(destinations ...any) error {
	if len(row) != len(destinations) {
		return fmt.Errorf("scan columns: got %d want %d", len(row), len(destinations))
	}
	for index, value := range row {
		switch destination := destinations[index].(type) {
		case *int64:
			*destination = value.(int64)
		case **string:
			if value == nil {
				*destination = nil
			} else {
				text := value.(string)
				*destination = &text
			}
		default:
			if err := assignReconcileTestValue(destination, value); err != nil {
				return err
			}
		}
	}
	return nil
}

type hardeningErrorRow struct{ err error }

func (row hardeningErrorRow) Scan(...any) error { return row.err }

type hardeningQueryer struct {
	query func(string, ...any) pgx.Row
	calls []string
}

func (q *hardeningQueryer) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	q.calls = append(q.calls, query)
	return q.query(query, args...)
}
func (q *hardeningQueryer) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return nil, errors.New("unexpected query")
}
func (q *hardeningQueryer) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, errors.New("unexpected mutation")
}

func TestQueueRevisionPreconditionsRejectMissingAndStaleBeforeWrites(t *testing.T) {
	expected := int64(3)
	for _, item := range []struct {
		expected *int64
		actual   int64
		want     error
	}{{nil, 3, ErrRevisionRequired}, {&expected, 4, ErrRevisionConflict}, {&expected, 3, nil}} {
		if err := checkExpectedRevision(item.expected, item.actual); !errors.Is(err, item.want) {
			t.Fatalf("precondition = %v want %v", err, item.want)
		}
	}
	q := &hardeningQueryer{query: func(string, ...any) pgx.Row {
		t.Fatal("missing precondition reached database")
		return hardeningErrorRow{ErrInvalidInput}
	}}
	if err := requireQueueRevision(context.Background(), q, testScopeOrganizationID, testScopeQueueID, nil); !errors.Is(err, ErrRevisionRequired) {
		t.Fatal(err)
	}
	for _, value := range []string{"*", "W/\"3\"", "3", "\"0\"", "\"3,4\""} {
		if _, err := parseRevisionHeader(value); err == nil {
			t.Fatalf("accepted invalid precondition %q", value)
		}
	}
	if revision, err := parseRevisionHeader("\"3\""); err != nil || *revision != 3 {
		t.Fatalf("valid precondition = %v %v", revision, err)
	}
}

func TestRulePrioritiesFitTheDatabaseIntegerBeforeMutating(t *testing.T) {
	for _, priority := range []int{-1, 2147483648} {
		_, createErr := normalizeRuleInput(RuleInput{MatchType: "city", MatchValue: "Campinas", Priority: &priority}, 0)
		_, patchErr := (UpdateRuleRequest{Priority: &priority}).Validate()
		_, conditionErr := (ConditionInput{Type: "city", Values: []string{"Campinas"}, Priority: &priority}).toRuleInput(0)
		for _, err := range []error{createErr, patchErr, conditionErr} {
			if !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("priority %d reached persistence validation: %v", priority, err)
			}
		}
	}
	maximum := 2147483647
	if _, err := normalizeRuleInput(RuleInput{MatchType: "city", MatchValue: "Campinas", Priority: &maximum}, 0); err != nil {
		t.Fatalf("maximum valid priority rejected: %v", err)
	}
}

func TestTagReferenceGuardRaceReturnsAReferenceErrorWithoutMaskingOtherDatabaseErrors(t *testing.T) {
	for _, item := range []struct {
		code         string
		constraint   string
		status       int
		responseCode string
	}{
		{"23503", "tags_management_reference_guard", http.StatusBadRequest, "invalid_round_robin_reference"},
		{"23503", "another_constraint", http.StatusInternalServerError, "round_robin_operation_failed"},
		{"23514", "tags_management_reference_guard", http.StatusInternalServerError, "round_robin_operation_failed"},
	} {
		recorder := httptest.NewRecorder()
		writeRoundRobinError(recorder, httptest.NewRequest(http.MethodPatch, "/", nil), fmt.Errorf("wrapped: %w", &pgconn.PgError{Code: item.code, ConstraintName: item.constraint}))
		var body httpserver.ErrorEnvelope
		if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if recorder.Code != item.status || body.Error.Code != item.responseCode {
			t.Fatalf("database error %s/%s returned %d/%s", item.code, item.constraint, recorder.Code, body.Error.Code)
		}
	}
}

func TestMemberMutationAuthorizesExactParticipantAfterLockingSharedQueue(t *testing.T) {
	for _, scenario := range []struct {
		name, user, team string
		want             error
	}{
		{"direct led user", testScopeUserID, "", nil},
		{"foreign participant in visible shared queue", testScopeLeaderID, testOutsideTeamID, tenant.ErrOrganizationAccessDenied},
		{"led user with foreign team context", testScopeUserID, testOutsideTeamID, tenant.ErrOrganizationAccessDenied},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			q := &hardeningQueryer{query: func(query string, args ...any) pgx.Row {
				if args[0] != testScopeOrganizationID {
					t.Fatal("participant authorization lost tenant predicate")
				}
				switch {
				case strings.Contains(query, "select round_robin_id::text"):
					return hardeningRow{testScopeQueueID}
				case strings.Contains(query, "select exists"):
					return hardeningRow{true}
				case strings.Contains(query, "select user_id::text"):
					if scenario.team == "" {
						return hardeningRow{scenario.user, nil}
					}
					return hardeningRow{scenario.user, scenario.team}
				case strings.Contains(query, "coalesce(target_pipeline_id, pipeline_id)"):
					return hardeningRow{testScopeQueueID, int64(3), testScopePipelineID, `{"settings":{}}`}
				default:
					t.Fatalf("unexpected query %s", query)
					return hardeningErrorRow{ErrInvalidInput}
				}
			}}
			leader := tenant.Context{OrganizationID: testScopeOrganizationID, UserID: testScopeLeaderID, MemberRole: "user", IsTeamLeader: true, Permissions: []string{permissions.DistributionManage}, LedUserIDs: []string{testScopeUserID}, LedTeamIDs: []string{testScopeTeamID}, LedPipelineIDs: []string{testScopePipelineID}}
			_, err := (Repository{}).ensureRoundRobinMemberMutable(context.Background(), q, leader, testScopeUserID)
			if !errors.Is(err, scenario.want) {
				t.Fatalf("participant mutation error = %v want %v", err, scenario.want)
			}
			parent, participant := -1, -1
			for index, query := range q.calls {
				if strings.Contains(query, "coalesce(target_pipeline_id, pipeline_id)") {
					parent = index
				}
				if strings.Contains(query, "select user_id::text") {
					participant = index
				}
			}
			if parent < 0 || participant <= parent {
				t.Fatalf("participant was not reread under parent lock: %v", q.calls)
			}
		})
	}
	// A same-shaped ID in another tenant must disappear at the first scoped read.
	q := &hardeningQueryer{query: func(string, ...any) pgx.Row { return hardeningErrorRow{pgx.ErrNoRows} }}
	_, err := (Repository{}).ensureRoundRobinMemberMutable(context.Background(), q, tenant.Context{OrganizationID: testOutsideTeamID}, testScopeUserID)
	if !errors.Is(err, ErrMemberNotFound) {
		t.Fatalf("foreign tenant error = %v", err)
	}
}

func TestQueueCapacityCannotBeReducedBelowRedistributionMinimum(t *testing.T) {
	q := &hardeningQueryer{query: func(query string, args ...any) pgx.Row {
		if args[0] != testScopeOrganizationID {
			t.Fatal("capacity query lost tenant scope")
		}
		switch {
		case strings.Contains(query, "select coalesce(rr.is_active"):
			return hardeningRow{true, 1}
		case strings.Contains(query, "coalesce(target_pipeline_id, pipeline_id)"):
			return hardeningRow{testScopeQueueID, int64(3), testScopePipelineID, `{"settings":{"enable_redistribution":true}}`}
		case strings.Contains(query, "count(distinct c.user_id)"):
			return hardeningRow{1}
		default:
			t.Fatalf("unexpected capacity query %s", query)
			return hardeningErrorRow{ErrInvalidInput}
		}
	}}
	if err := (Repository{}).validateQueueParticipants(context.Background(), q, testScopeOrganizationID, testScopeQueueID); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("unsafe capacity accepted: %v", err)
	}
}

func TestRedistributionSettingsRejectFractionalAndOutOfRangeValues(t *testing.T) {
	for _, settings := range []map[string]any{
		{"enable_redistribution": true, "redistribution_timeout_minutes": 1.5},
		{"enable_redistribution": false, "redistribution_max_attempts": 1001},
		{"enable_redistribution": true, "redistribution_warning_minutes": -1},
	} {
		if _, err := normalizeRedistributionSettings(settings); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("invalid settings accepted: %#v %v", settings, err)
		}
	}
}

func TestMutationResponsesAreReadBeforeTheirTransactionCommits(t *testing.T) {
	for _, item := range []struct{ file, start, end, read string }{
		{"repository_members.go", "func (repo Repository) AddMember(", "func (repo Repository) UpdateMember(", "getMemberWithQueryer(ctx, tx"},
		{"repository_members.go", "func (repo Repository) UpdateMember(", "func (repo Repository) DeleteMember(", "getMemberWithQueryer(ctx, tx"},
		{"repository_rules.go", "func (repo Repository) CreateRule(", "func (repo Repository) UpdateRule(", "getRuleWithQueryer(ctx, tx"},
		{"repository_rules.go", "func (repo Repository) UpdateRule(", "func (repo Repository) DeleteRule(", "getRuleWithQueryer(ctx, tx"},
	} {
		source, err := os.ReadFile(item.file)
		if err != nil {
			t.Fatal(err)
		}
		body := string(source)
		start := strings.Index(body, item.start)
		end := strings.Index(body, item.end)
		if start < 0 || end < start {
			t.Fatal("missing mutation")
		}
		body = body[start:end]
		read, commit := strings.Index(body, item.read), strings.Index(body, "tx.Commit(ctx)")
		if read < 0 || commit < read {
			t.Fatalf("%s reads committed response after closing transaction", item.start)
		}
		if strings.Count(body, "tx.Commit(ctx)") != 1 {
			t.Fatalf("%s commits more than once", item.start)
		}
	}
}
