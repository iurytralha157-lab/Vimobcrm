package meta

import (
	"errors"
	"net/http"
	"reflect"
	"strings"
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

func TestOAuthReconnectKeepsOmittedRoutingAndAdAccounts(t *testing.T) {
	omitted, err := parseOAuthConnectionOptions(map[string]any{})
	if err != nil || omitted.PipelineProvided || omitted.StageProvided || omitted.DefaultStatusProvided || omitted.DefaultStatus != "novo" {
		t.Fatalf("omitted connection options = (%#v, %v)", omitted, err)
	}
	const pipelineID = "11111111-1111-4111-8111-111111111111"
	const stageID = "22222222-2222-4222-8222-222222222222"
	explicit, err := parseOAuthConnectionOptions(map[string]any{
		"pipeline_id": pipelineID, "stage_id": stageID, "default_status": "novo",
	})
	if err != nil || !explicit.PipelineProvided || !explicit.StageProvided || !explicit.DefaultStatusProvided ||
		explicit.PipelineID == nil || *explicit.PipelineID != pipelineID ||
		explicit.StageID == nil || *explicit.StageID != stageID || explicit.DefaultStatus != "novo" {
		t.Fatalf("explicit connection options = (%#v, %v)", explicit, err)
	}

	source := readOAuthSource(t, "oauth_postgres.go")
	persist := oauthSourceSection(t, source, "func (store oauthPostgresStore) persistConnectedIntegration", "func persistConnectedOAuthIntegration")
	update := oauthSourceSection(t, persist, "updateSQL := `", "insertSQL := `")
	for _, assignment := range []string{
		"pipeline_id = case when $21::boolean then $7::uuid else integration.pipeline_id end",
		"stage_id = case when $22::boolean then $8::uuid else integration.stage_id end",
		"default_status = case when $23::boolean then $9 else integration.default_status end",
		"ad_account_id = case when $24::boolean then $10 else integration.ad_account_id end",
		"when $24::boolean then $11::jsonb",
		"else integration.selected_ad_accounts",
	} {
		if !strings.Contains(update, assignment) {
			t.Fatalf("reconnect UPDATE must preserve omitted settings: missing %q", assignment)
		}
	}
	for _, flag := range []string{
		"options.PipelineProvided", "options.StageProvided", "options.DefaultStatusProvided", "len(selected) > 0",
	} {
		if !strings.Contains(persist, flag) {
			t.Fatalf("reconnect UPDATE must bind %q", flag)
		}
	}
	if !strings.Contains(persist, "store.integrationJSON(ctx, updateSQL, updateArguments...)") ||
		!strings.Contains(persist, "store.integrationJSON(ctx, insertSQL, arguments...)") {
		t.Fatal("UPDATE must receive presence flags while INSERT keeps default values")
	}
}
