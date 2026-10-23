package leads

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type moveReferenceTx struct {
	pgx.Tx
	statuses []string
}

func (*moveReferenceTx) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	return historyScopeRow{scan: func(dest ...any) error {
		if strings.Contains(query, "select exists") {
			if len(args) != 2 || args[0] != moveRevisionOrg {
				panic("property check lost tenant scope")
			}
			*dest[0].(*bool) = false
			return nil
		}
		if strings.Contains(query, "from public.stages s") {
			if len(args) != 2 || args[1] != moveRevisionOrg || !strings.Contains(query, "s.is_active = true") || !strings.Contains(query, "p.is_active = true") {
				panic("stage availability lost tenant/active guards")
			}
		} else if len(args) < 2 || args[0] != moveRevisionOrg || !strings.Contains(query, "for update") {
			panic("property release lost scope or lock")
		}
		return pgx.ErrNoRows
	}}
}

func (tx *moveReferenceTx) Query(_ context.Context, query string, args ...any) (pgx.Rows, error) {
	if len(args) != 2 || args[0] != moveRevisionOrg || !strings.Contains(query, "change_deal_status_on_enter") || !strings.Contains(query, "for share of automation") {
		panic("stage automation validation lost scope or lock")
	}
	return &moveReferenceRows{statuses: tx.statuses}, nil
}

type moveReferenceRows struct {
	pgx.Rows
	statuses []string
	index    int
}

func (rows *moveReferenceRows) Next() bool { return rows.index < len(rows.statuses) }
func (rows *moveReferenceRows) Scan(dest ...any) error {
	*dest[0].(*string) = rows.statuses[rows.index]
	rows.index++
	return nil
}
func (*moveReferenceRows) Close()     {}
func (*moveReferenceRows) Err() error { return nil }

func TestMoveStageBusinessPrerequisitesHaveActionableErrorCodes(t *testing.T) {
	ctx, repo, actor := context.Background(), Repository{}, moveRevisionActor()
	_, destination := repo.resolveMoveStageDestination(ctx, &moveReferenceTx{}, moveRevisionOrg, moveRevisionDestination)
	_, ambiguous := terminalStageDealStatus(true, true)
	_, rules := repo.resolveMoveStageDealStatus(ctx, &moveReferenceTx{statuses: []string{"won", "lost"}}, moveRevisionOrg, moveRevisionDestination, false, false)
	_, terminalRule := repo.resolveMoveStageDealStatus(ctx, &moveReferenceTx{statuses: []string{"lost"}}, moveRevisionOrg, moveRevisionDestination, true, false)
	current := leadSnapshot{ID: moveRevisionLead, DealStatus: "open", PropertyID: moveRevisionDestination}
	_, gain := repo.lockWonLeadPropertyForUpdate(ctx, &moveReferenceTx{}, actor, current, moveStagePredictedStatusInput("won", nil))
	current.DealStatus = "won"
	reopen := repo.releaseReopenedLeadProperty(ctx, &moveReferenceTx{}, actor, current, moveStagePredictedStatusInput("open", nil))
	for _, test := range []struct {
		name   string
		err    error
		code   string
		status int
	}{
		{"destination unavailable", destination, "lead_move_destination_unavailable", 400},
		{"ambiguous terminal", ambiguous, "lead_move_configuration_conflict", 409},
		{"conflicting rules", rules, "lead_move_configuration_conflict", 409},
		{"terminal versus rule", terminalRule, "lead_move_configuration_conflict", 409},
		{"gain missing linked property", gain, "lead_linked_property_invalid", 400},
		{"reopen missing linked property", reopen, "lead_linked_property_invalid", 400},
	} {
		t.Run(test.name, func(t *testing.T) {
			if !errors.Is(test.err, ErrInvalidReference) || !isCanonicalStageBusinessError(test.err) {
				t.Fatal("new error must preserve canonical business classification")
			}
			response := httptest.NewRecorder()
			writeLeadError(response, httptest.NewRequest(http.MethodPost, "/v1/leads/synthetic/move-stage", nil), test.err)
			if response.Code != test.status || !strings.Contains(response.Body.String(), `"code":"`+test.code+`"`) || strings.Contains(response.Body.String(), "Uma ou mais informações") {
				t.Fatalf("prerequisite lost its actionable error: status=%d code=%s", response.Code, test.code)
			}
		})
	}
}

func TestMoveStageSpecificErrorsDoNotReplaceOtherRejections(t *testing.T) {
	for _, test := range []struct {
		err    error
		code   string
		status int
	}{
		{ErrInvalidReference, "invalid_lead_reference", 400},
		{tenant.ErrOrganizationAccessDenied, "permission_denied", 403},
		{ErrLeadChanged, "lead_changed", 409},
		{ErrLeadReservationUnverified, "lead_reservation_unverified", 409},
	} {
		response := httptest.NewRecorder()
		writeLeadError(response, httptest.NewRequest(http.MethodPost, "/v1/leads/synthetic/move-stage", nil), test.err)
		if response.Code != test.status || !strings.Contains(response.Body.String(), `"code":"`+test.code+`"`) {
			t.Fatalf("existing rejection changed: status=%d want=%d code=%s", response.Code, test.status, test.code)
		}
	}
}
