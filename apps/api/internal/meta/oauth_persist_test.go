package meta

import (
	"errors"
	"net/http"
	"reflect"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestPersistConnectedOAuthIntegrationOnlyInsertsAfterMissingUpdate(t *testing.T) {
	updateFailure := errors.New("vault rotation failed")
	insertFailure := errors.New("insert failed")
	raceUpdateFailure := errors.New("raced credential rotation failed")
	uniquePage := &pgconn.PgError{Code: "23505", ConstraintName: "meta_integrations_organization_id_page_id_key"}
	uniqueOtherOwner := &pgconn.PgError{Code: "23505", ConstraintName: "uq_meta_integrations_connected_page_owner"}

	type outcome struct {
		row map[string]any
		err error
	}
	tests := []struct {
		name       string
		updates    []outcome
		insert     outcome
		wantCalls  []string
		wantRowID  string
		wantCode   string
		wantStatus int
		wantCause  error
	}{
		{
			name:      "existing page updates without insert",
			updates:   []outcome{{row: map[string]any{"id": "existing"}}},
			wantCalls: []string{"update"}, wantRowID: "existing",
		},
		{
			name:      "failed rotation preserves update error without insert",
			updates:   []outcome{{err: updateFailure}},
			wantCalls: []string{"update"}, wantCode: "meta_integration_write_failed",
			wantStatus: http.StatusInternalServerError, wantCause: updateFailure,
		},
		{
			name:    "missing page inserts",
			updates: []outcome{{}}, insert: outcome{row: map[string]any{"id": "new"}},
			wantCalls: []string{"update", "insert"}, wantRowID: "new",
		},
		{
			name:      "same page insert race retries update",
			updates:   []outcome{{}, {row: map[string]any{"id": "raced"}}},
			insert:    outcome{err: uniquePage},
			wantCalls: []string{"update", "insert", "update"}, wantRowID: "raced",
		},
		{
			name:    "other owner remains a conflict",
			updates: []outcome{{}, {}}, insert: outcome{err: uniqueOtherOwner},
			wantCalls: []string{"update", "insert", "update"},
			wantCode:  "meta_asset_already_connected", wantStatus: http.StatusConflict,
		},
		{
			name:    "race update error is preserved",
			updates: []outcome{{}, {err: raceUpdateFailure}}, insert: outcome{err: uniquePage},
			wantCalls: []string{"update", "insert", "update"},
			wantCode:  "meta_integration_write_failed", wantStatus: http.StatusInternalServerError,
			wantCause: raceUpdateFailure,
		},
		{
			name:    "insert error is preserved",
			updates: []outcome{{}}, insert: outcome{err: insertFailure},
			wantCalls: []string{"update", "insert"},
			wantCode:  "meta_integration_write_failed", wantStatus: http.StatusInternalServerError,
			wantCause: insertFailure,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var calls []string
			updateCount := 0
			update := func() (map[string]any, error) {
				calls = append(calls, "update")
				if updateCount >= len(test.updates) {
					t.Fatal("unexpected extra update")
				}
				result := test.updates[updateCount]
				updateCount++
				return result.row, result.err
			}
			insert := func() (map[string]any, error) {
				calls = append(calls, "insert")
				return test.insert.row, test.insert.err
			}

			row, err := persistConnectedOAuthIntegration(update, insert)
			if !reflect.DeepEqual(calls, test.wantCalls) {
				t.Fatalf("calls = %v, want %v", calls, test.wantCalls)
			}
			if test.wantCode == "" {
				if err != nil || row["id"] != test.wantRowID {
					t.Fatalf("result = (%v, %v), want row %q", row, err, test.wantRowID)
				}
				return
			}
			if row != nil || oauthErrorCode(err) != test.wantCode || oauthErrorStatus(err) != test.wantStatus {
				t.Fatalf("result = (%v, %v), want %s (%d)", row, err, test.wantCode, test.wantStatus)
			}
			if test.wantCause != nil && !errors.Is(err, test.wantCause) {
				t.Fatalf("error %v does not preserve cause %v", err, test.wantCause)
			}
		})
	}
}
