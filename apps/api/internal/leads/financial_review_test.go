package leads

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

func TestLeadFinancialReviewSignalsOnlyTheCommercialTransitionAndNeverWritesFinance(t *testing.T) {
	for _, scenario := range []struct {
		name, before, after string
		exists, required    bool
		queries             int
	}{
		{"first win", "open", "won", false, false, 1},
		{"rewin after reopen", "open", "won", true, true, 1},
		{"rewin after loss", "lost", "won", true, true, 1},
		{"reopen existing win", "won", "open", false, true, 0},
		{"lose existing win", "won", "lost", true, true, 0},
		{"open to loss", "open", "lost", true, false, 0},
		{"same status", "won", "won", true, false, 0},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			tx := &financialReviewTx{exists: scenario.exists}
			current := leadSnapshot{ID: pipelinePostgresID(900), DealStatus: scenario.before}
			required, err := leadTransitionRequiresFinancialReview(context.Background(), tx, pipelinePostgresID(990), current, updateInput{DealStatus: patchString{Set: true, Value: &scenario.after}})
			if err != nil || required != scenario.required || tx.queries != scenario.queries {
				t.Fatalf("review required=%v queries=%d err=%v", required, tx.queries, err)
			}
			if tx.queries != 0 && (len(tx.args) != 2 || tx.args[0] != pipelinePostgresID(990) || tx.args[1] != current.ID ||
				strings.Count(tx.query, "organization_id=$1::uuid and lead_id=$2::uuid") != 2) {
				t.Fatal("financial existence did not preserve both tenant and lead boundaries")
			}
		})
	}
}

func TestLeadFinancialReviewReadFailureIsNotMisreportedAsNoExistingFinance(t *testing.T) {
	status := "won"
	tx := &financialReviewTx{failure: errors.New("synthetic finance read failure")}
	if _, err := leadTransitionRequiresFinancialReview(context.Background(), tx, pipelinePostgresID(990), leadSnapshot{ID: pipelinePostgresID(900), DealStatus: "open"}, updateInput{DealStatus: patchString{Set: true, Value: &status}}); !errors.Is(err, tx.failure) {
		t.Fatal("failed lookup silently claimed a first financial episode")
	}
	raw, err := json.Marshal(Lead{FinancialReviewRequired: true})
	if err != nil || !strings.Contains(string(raw), `"financialReviewRequired":true`) || strings.Contains(string(raw), "balance") {
		t.Fatalf("review response must expose the boolean only: %s, %v", raw, err)
	}
	raw, _ = json.Marshal(Lead{})
	if strings.Contains(string(raw), "financialReviewRequired") {
		t.Fatal("ordinary read/list payload added a financial existence flag")
	}
}

type financialReviewTx struct {
	pgx.Tx
	exists  bool
	failure error
	query   string
	args    []any
	queries int
}

func (tx *financialReviewTx) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	tx.query, tx.args = query, args
	tx.queries++
	return historyScopeRow{scan: func(destinations ...any) error {
		if tx.failure != nil {
			return tx.failure
		}
		*destinations[0].(*bool) = tx.exists
		return nil
	}}
}
