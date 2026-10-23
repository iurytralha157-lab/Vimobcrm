package leads

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestManagedQueueSQLFailuresUseStableHTTPContracts(t *testing.T) {
	cases := []struct {
		state, reason, code string
		status              int
	}{
		{"55P03", "queue_configuration_busy", "queue_configuration_busy", 409},
		{"23514", "queue_stage_assignment_rule_or_recipient_invalid", "queue_stage_assignment_invalid", 422},
		{"23514", "queue_stage_assignment_recipient_unavailable", "queue_stage_assignment_unavailable", 409},
		{"23514", "managed_queue_window_or_recipient_closed", "queue_stage_assignment_unavailable", 409},
		{"23514", "queue_stage_assignment_round_not_exhausted", "queue_stage_assignment_round_incomplete", 409},
		{"23514", "queue_stage_assignment_limit_reached", "queue_stage_assignment_limit_reached", 409},
		{"23514", "queue_stage_assignment_requires_review", "queue_stage_assignment_requires_review", 409},
		{"23514", "queue_stage_assignment_existing_owner_drift", "queue_assignment_changed", 409},
		{"23514", "queue_stage_assignment_owner_mismatch", "queue_assignment_changed", 409},
		{"23514", "queue_effective_owner_invariant_failed", "queue_assignment_changed", 409},
		{"42501", "managed_queue_ownership_requires_command", "queue_assignment_changed", 409},
		{"42501", "managed_queue_pool_requires_claim", "queue_pool_claim_required", 409},
		{"42501", "queue_pool_activity_requires_claim", "queue_pool_claim_required", 409},
		{"42501", "queue_pool_task_requires_claim", "queue_pool_claim_required", 409},
		{"42501", "managed_queue_owner_protected", "queue_assignment_protected", 409},
		{"23514", "managed_queue_inactive_recipient", "queue_recipient_inactive", 422},
		{"42501", "queue_activity_actor_mismatch", "queue_activity_actor_mismatch", 403},
	}
	for _, test := range cases {
		t.Run(test.reason, func(t *testing.T) {
			response := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, "/v1/leads/synthetic/move-stage", nil)
			err := fmt.Errorf("stage transition: %w", &pgconn.PgError{
				Code: test.state, Message: test.reason, Detail: "PRIVATE_SYNTHETIC_DETAIL", Hint: "PRIVATE_SYNTHETIC_HINT",
			})
			writeLeadError(response, request, err)
			if response.Code != test.status {
				t.Fatalf("status=%d, want %d; body=%s", response.Code, test.status, response.Body.String())
			}
			var body struct {
				Error struct{ Code, Message string } `json:"error"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if body.Error.Code != test.code || body.Error.Message == "" || strings.Contains(response.Body.String(), "PRIVATE_") {
				t.Fatalf("unsafe or invalid contract: %s", response.Body.String())
			}
		})
	}
}

func TestManagedQueueErrorMappingDoesNotMaskOtherDatabaseErrors(t *testing.T) {
	for _, err := range []error{
		nil, fmt.Errorf("queue_stage_assignment_recipient_unavailable"),
		&pgconn.PgError{Code: "23505", Message: "queue_stage_assignment_recipient_unavailable"},
		&pgconn.PgError{Code: "23514", Message: "unrelated_constraint"},
		&pgconn.PgError{Code: "55P03", Message: "canceling statement due to lock timeout"},
	} {
		response := httptest.NewRecorder()
		if writeQueueRuntimeError(response, httptest.NewRequest(http.MethodPost, "/", nil), err) {
			t.Fatalf("unrelated error consumed: %v", err)
		}
		if response.Body.Len() != 0 {
			t.Fatalf("unrelated error wrote response: %s", response.Body.String())
		}
	}
}
