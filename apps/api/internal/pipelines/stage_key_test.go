package pipelines

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestStageKeyGenerationBoundsValidNames(t *testing.T) {
	for _, length := range []int{2, 79, 80, 81, 120} {
		t.Run(strings.Repeat("a", length), func(t *testing.T) {
			key := buildStageKey(strings.Repeat("a", length))
			if len(key) > 80 || key == "" {
				t.Fatalf("valid %d-character name generated a %d-character key", length, len(key))
			}
			if length <= 80 && key != strings.Repeat("a", length) {
				t.Fatal("an already-compatible key was changed")
			}
		})
	}
	for _, name := range []string{"Contato Quente", "ÁÉÍÓÚ", "😀🏡", strings.Repeat("中", 120)} {
		if key := buildStageKey(name); key == "" || len(key) > 80 {
			t.Fatalf("Unicode/fallback name produced invalid key %q", key)
		}
	}
}

type stageKeyTx struct {
	pgx.Tx
	keys []string
}
type stageKeyRows struct {
	pgx.Rows
	keys  []string
	index int
}

func (tx stageKeyTx) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return &stageKeyRows{keys: tx.keys, index: -1}, nil
}
func (rows *stageKeyRows) Next() bool { rows.index++; return rows.index < len(rows.keys) }
func (rows *stageKeyRows) Scan(dest ...any) error {
	*dest[0].(*pgtype.Text) = pgtype.Text{String: rows.keys[rows.index], Valid: true}
	return nil
}
func (*stageKeyRows) Close()     {}
func (*stageKeyRows) Err() error { return nil }

func TestStageKeyCollisionReservesSuffixWithinContract(t *testing.T) {
	name := strings.Repeat("a", 80)
	for _, suffix := range []string{"_2", "_10"} {
		t.Run(suffix, func(t *testing.T) {
			keys := []string{name}
			if suffix == "_10" {
				for _, digit := range "23456789" {
					keys = append(keys, strings.Repeat("a", 78)+"_"+string(digit))
				}
			}
			key, err := (Repository{}).uniqueStageKey(context.Background(), stageKeyTx{keys: keys}, "org", "pipeline", name)
			want := strings.Repeat("a", 80-len(suffix)) + suffix
			if err != nil || key != want {
				t.Fatalf("collision key=%q length=%d err=%v, want %q", key, len(key), err, want)
			}
		})
	}
}

func TestStageKeyReorderPreservesOmittedIdentityAndRejectsExplicitOverflow(t *testing.T) {
	revision := time.Date(2026, 10, 20, 12, 0, 0, 123456000, time.UTC)
	id := "11111111-1111-4111-8111-111111111111"
	input, err := (ReorderStagesRequest{Stages: []StageOrderItem{{ID: id, Name: "Renamed", ExpectedUpdatedAt: &revision}}}).Validate()
	if err != nil || input.Stages[0].StageKey != "" {
		t.Fatalf("omitted existing key was regenerated: %+v %v", input, err)
	}
	for _, isNew := range []bool{false, true} {
		item := StageOrderItem{ID: id, Name: "Valid name", StageKey: strings.Repeat("x", 81), IsNew: isNew}
		if !isNew {
			item.ExpectedUpdatedAt = &revision
		}
		if _, err := (ReorderStagesRequest{Stages: []StageOrderItem{item}}).Validate(); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("explicit oversized key was truncated or accepted: new=%t err=%v", isNew, err)
		}
	}
}

func TestStageKeyPreservationFlagIsRecognizedAndLegacyDecoderRejectsIt(t *testing.T) {
	body := `{"preserveStageKeys":true,"stages":[]}`
	var current ReorderStagesRequest
	decoder := json.NewDecoder(strings.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&current); err != nil {
		t.Fatalf("current request rejected preservation contract: %v", err)
	}
	// This is the pre-change request model. The old handler uses exactly this
	// strict decoder policy and must stop before it can rename a persisted key.
	var legacy struct {
		Stages []StageOrderItem `json:"stages"`
	}
	decoder = json.NewDecoder(strings.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&legacy); err == nil || !strings.Contains(err.Error(), "preserveStageKeys") {
		t.Fatal("legacy request did not reject the new preservation flag")
	}
}

func TestStageKeyPreservationHTTPFlagValidationStopsBeforeRepository(t *testing.T) {
	for _, scenario := range []struct{ body, code string }{
		{`{"preserveStageKeys":true,"stages":[]}`, "invalid_pipeline_input"},
		{`{"preserveStageKeys":"true","stages":[]}`, "invalid_json"},
	} {
		req := httptest.NewRequest("POST", "/", strings.NewReader(scenario.body))
		req = req.WithContext(tenant.ContextWithTenant(req.Context(), tenant.Context{OrganizationID: stageArchiveFixtureID(1), MemberRole: "admin"}))
		response := httptest.NewRecorder()
		NewHandler(NewRepository(nil)).ReorderStages(response, req)
		if response.Code != 400 || !strings.Contains(response.Body.String(), `"code":"`+scenario.code+`"`) {
			t.Fatalf("flag/validation crossed repository boundary or wrong contract: %d %s", response.Code, response.Body.String())
		}
	}
}
