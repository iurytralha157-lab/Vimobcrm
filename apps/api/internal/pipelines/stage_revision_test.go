package pipelines

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type stageRevisionTx struct {
	pgx.Tx
	current time.Time
	err     error
	query   string
	args    []any
}

func (tx *stageRevisionTx) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	tx.query, tx.args = query, args
	return stageRevisionRow{current: tx.current, err: tx.err}
}

type stageRevisionRow struct {
	current time.Time
	err     error
}

func (row stageRevisionRow) Scan(dest ...any) error {
	if row.err == nil {
		*dest[0].(*time.Time) = row.current
	}
	return row.err
}

func TestStageUpdateRevisionRequiresExactLockedRevision(t *testing.T) {
	base := time.Date(2026, 10, 16, 12, 0, 0, 123456000, time.UTC)
	for _, testCase := range []struct {
		name     string
		expected *time.Time
		current  time.Time
		want     error
	}{
		{"missing", nil, base, ErrStagesChanged},
		{"zero", new(time.Time), base, ErrStagesChanged},
		{"same", &base, base, nil},
		{"one microsecond changed", &base, base.Add(time.Microsecond), ErrStagesChanged},
		{"equivalent timezone", &base, base.In(time.FixedZone("synthetic", -10800)), nil},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			tx := &stageRevisionTx{current: testCase.current}
			err := lockStageUpdateRevision(context.Background(), tx, "org-A", "stage", testCase.expected)
			if !errors.Is(err, testCase.want) {
				t.Fatalf("revision error: %v, want %v", err, testCase.want)
			}
			if testCase.expected != nil && !testCase.expected.IsZero() &&
				(!strings.Contains(tx.query, "organization_id = $1::uuid and id = $2::uuid for update") || tx.args[0] != "org-A") {
				t.Fatal("stage revision lost tenant or lock scope")
			}
		})
	}
	if err := lockStageUpdateRevision(context.Background(), &stageRevisionTx{err: pgx.ErrNoRows}, "org-B", "foreign", &base); !errors.Is(err, ErrStageNotFound) {
		t.Fatalf("foreign/missing stage must remain not found: %v", err)
	}
}

func TestStageUpdateRevisionContractAndPermission(t *testing.T) {
	name := "Renamed"
	if _, err := (UpdateStageRequest{Name: patchString{Set: true, Value: &name}}).Validate(); !errors.Is(err, ErrStagesChanged) {
		t.Fatalf("PATCH accepted missing revision: %v", err)
	}
	if _, err := (Repository{}).UpdateStage(context.Background(), tenant.Context{OrganizationID: "org-A", UserID: "viewer"}, stageArchiveFixtureID(201), updateStageInput{}); !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatalf("permission must precede revision errors: %v", err)
	}
	response := httptest.NewRecorder()
	writePipelineError(response, httptest.NewRequest(http.MethodPatch, "/v1/stages/synthetic", nil), ErrStagesChanged)
	if response.Code != 409 || !strings.Contains(response.Body.String(), `"code":"pipeline_stages_changed"`) {
		t.Fatalf("stage conflict contract: %d %s", response.Code, response.Body.String())
	}
}

func TestStageUpdateRevisionPrecedesQualificationEffects(t *testing.T) {
	raw, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	start := strings.Index(source, "func (repo Repository) UpdateStage(")
	end := strings.Index(source[start:], "func (repo Repository) ReorderStages(")
	method := source[start : start+end]
	previous := -1
	for _, step := range []string{"repo.lockStagePipelineForUpdate(", "lockStageUpdateRevision(", "repo.ensureStageCanBeQualified(", "set is_qualified = false", "update public.stages as s"} {
		position := strings.Index(method, step)
		if position <= previous {
			t.Fatalf("stage revision must stop before every effect: %s", step)
		}
		previous = position
	}
}
