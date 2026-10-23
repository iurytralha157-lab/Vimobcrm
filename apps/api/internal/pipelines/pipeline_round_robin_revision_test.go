package pipelines

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestPipelineRoundRobinRevisionValidationAndRepositoryFailClosed(t *testing.T) {
	valid := strings.Repeat("a1", 32)
	queue := stageArchiveFixtureID(801)
	for _, scenario := range []struct {
		revision string
		want     error
	}{{"", ErrPipelineChanged}, {"short", ErrInvalidInput}, {strings.ToUpper(valid), ErrInvalidInput}, {" " + valid, ErrInvalidInput}, {valid, nil}} {
		for _, roundRobinID := range []json.RawMessage{json.RawMessage("null"), json.RawMessage(`"` + queue + `"`)} {
			input, err := (SetPipelineRoundRobinRequest{ExpectedRevision: scenario.revision, RoundRobinID: roundRobinID}).Validate()
			if !errors.Is(err, scenario.want) {
				t.Fatalf("revision validation=%v want=%v", err, scenario.want)
			}
			if err == nil && input.ExpectedRevision != valid {
				t.Fatal("original aggregate revision changed")
			}
		}
	}
	for _, roundRobinID := range []json.RawMessage{nil, json.RawMessage(`"invalid"`), json.RawMessage(`""`), json.RawMessage(`"   "`), json.RawMessage(`1`), json.RawMessage(`{}`)} {
		if _, err := (SetPipelineRoundRobinRequest{ExpectedRevision: valid, RoundRobinID: roundRobinID}).Validate(); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("invalid/omitted queue accepted: %s %v", roundRobinID, err)
		}
	}
	actor := tenant.Context{OrganizationID: stageArchiveFixtureID(1), MemberRole: "admin"}
	if _, err := (Repository{}).SetDefaultRoundRobin(t.Context(), actor, stageArchiveFixtureID(101), setPipelineRoundRobinInput{}); !errors.Is(err, ErrPipelineChanged) {
		t.Fatalf("missing token reached DB: %v", err)
	}
}

func TestPipelineRoundRobinHTTPStrictRevisionAndPermission(t *testing.T) {
	actor := tenant.Context{OrganizationID: stageArchiveFixtureID(1), MemberRole: "admin"}
	valid := strings.Repeat("a1", 32)
	for _, scenario := range []struct {
		name, body string
		status     int
		code       string
	}{
		{"empty body", "", 400, "invalid_pipeline_input"}, {"missing token", `{"roundRobinId":null}`, 409, "pipeline_changed"},
		{"null token", `{"expectedRevision":null,"roundRobinId":null}`, 409, "pipeline_changed"}, {"bad token", `{"expectedRevision":"short","roundRobinId":null}`, 400, "invalid_pipeline_input"},
		{"omitted queue", `{"expectedRevision":"` + valid + `"}`, 400, "invalid_pipeline_input"},
		{"wrong token type", `{"expectedRevision":1}`, 400, "invalid_json"}, {"unknown", `{"expected_revision":"bad"}`, 400, "invalid_json"},
		{"trailing", `{"expectedRevision":"` + valid + `","roundRobinId":null} {}`, 400, "invalid_json"},
		{"invalid queue", `{"expectedRevision":"` + valid + `","roundRobinId":"invalid"}`, 400, "invalid_pipeline_input"},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPatch, "/", strings.NewReader(scenario.body))
			req.SetPathValue("id", stageArchiveFixtureID(101))
			req = req.WithContext(tenant.ContextWithTenant(req.Context(), actor))
			response := httptest.NewRecorder()
			NewHandler(NewRepository(nil)).SetDefaultRoundRobin(response, req)
			if response.Code != scenario.status || !strings.Contains(response.Body.String(), `"code":"`+scenario.code+`"`) {
				t.Fatalf("response=%d %s", response.Code, response.Body.String())
			}
		})
	}
	actor.MemberRole = "broker"
	req := httptest.NewRequest(http.MethodPatch, "/", strings.NewReader(`{"expectedRevision":"short"}`))
	req = req.WithContext(tenant.ContextWithTenant(req.Context(), actor))
	response := httptest.NewRecorder()
	NewHandler(NewRepository(nil)).SetDefaultRoundRobin(response, req)
	if response.Code != 403 {
		t.Fatalf("unauthorized write processed input: %d", response.Code)
	}
	response = httptest.NewRecorder()
	writePipelineError(response, req, ErrRoundRobinBusy)
	var body struct {
		Error struct{ Code, Message string }
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil || response.Code != 409 || body.Error.Code != "round_robin_busy" || !strings.Contains(body.Error.Message, "Aguarde e revise") {
		t.Fatalf("busy response=%d %s", response.Code, response.Body.String())
	}
}

type roundRobinReferenceTestTx struct {
	pgx.Tx
	active bool
	locked pgtype.Text
	err    error
	sql    string
	args   []any
}
type roundRobinReferenceTestRow struct{ tx *roundRobinReferenceTestTx }

func (row roundRobinReferenceTestRow) Scan(dest ...any) error {
	if row.tx.err != nil {
		return row.tx.err
	}
	*dest[0].(*bool) = row.tx.active
	*dest[1].(*pgtype.Text) = row.tx.locked
	return nil
}
func (tx *roundRobinReferenceTestTx) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	tx.sql, tx.args = sql, args
	return roundRobinReferenceTestRow{tx}
}

func TestPipelineRoundRobinReferenceDistinguishesBusyAndInvalidWithoutWaiting(t *testing.T) {
	queue, org := stageArchiveFixtureID(801), stageArchiveFixtureID(1)
	sentinel := errors.New("synthetic SQL failure")
	for _, scenario := range []struct {
		name           string
		active, locked bool
		sqlError, want error
	}{
		{"active unlocked", true, true, nil, nil}, {"active locked", true, false, nil, ErrRoundRobinBusy}, {"missing inactive deleted or foreign", false, false, nil, ErrInvalidReference}, {"query failure", false, false, sentinel, sentinel},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			tx := &roundRobinReferenceTestTx{active: scenario.active, locked: pgtype.Text{String: queue, Valid: scenario.locked}, err: scenario.sqlError}
			if err := lockPipelineRoundRobinReference(t.Context(), tx, org, queue); !errors.Is(err, scenario.want) {
				t.Fatalf("error=%v", err)
			}
			if !strings.Contains(tx.sql, "for share skip locked") || strings.Count(tx.sql, "queue.deleted_at is null") != 2 || strings.Count(tx.sql, "queue.organization_id=$1::uuid") != 2 || tx.args[0] != org || tx.args[1] != queue {
				t.Fatal("queue lock lost fail-closed tenant tombstone predicates")
			}
		})
	}
}
