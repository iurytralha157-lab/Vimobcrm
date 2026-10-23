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
)

type archiveQuery struct {
	categories  []string
	meta        []metaArchiveRoute
	portals     []portalArchiveRoute
	sql         string
	args        []any
	err         error
	automations []string
}

func (query *archiveQuery) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	if sql == stageAutomationReferencesSQL {
		return stageAutomationNamesRow{names: query.automations, err: query.err}
	}
	query.sql, query.args = sql, args
	metaJSON, _ := json.Marshal(archiveRoutingSnapshot{Meta: query.meta, Portals: query.portals})
	return archiveRow{query.categories, metaJSON, query.err}
}

type archiveRow struct {
	categories []string
	metaJSON   []byte
	err        error
}

func (row archiveRow) Scan(dest ...any) error {
	if row.err != nil {
		return row.err
	}
	*dest[0].(*[]string) = row.categories
	*dest[1].(*[]byte) = row.metaJSON
	return nil
}

func TestArchiveOnlyBlocksActiveRoutingAndKeepsTenantScope(t *testing.T) {
	for _, organization := range []string{"organization-A", "organization-B"} {
		query := &archiveQuery{}
		if err := (Repository{}).ensureStageArchiveRoutingSafe(context.Background(), query, organization, "pipeline", "stage"); err != nil {
			t.Fatal(err)
		}
		if query.args[0] != organization || query.args[1] != "pipeline" || query.args[2] != "stage" {
			t.Fatalf("lost scope: %#v", query.args)
		}
		for _, historicalTable := range []string{"lead_stage_history", "lead_stage_cycles", "cadence_templates", "lead_attention_policies"} {
			if strings.Contains(query.sql, historicalTable) {
				t.Fatalf("archive must preserve and allow history: %s", historicalTable)
			}
		}
	}
	for _, category := range []string{"meta_forms", "meta_default", "portals", "round_robin", "incoming_webhooks", "whatsapp_rules", "public_api_default"} {
		query := &archiveQuery{categories: []string{category}}
		err := (Repository{}).ensureStageArchiveRoutingSafe(context.Background(), query, "organization-A", "pipeline", "stage")
		var dependency *StageArchiveDependenciesError
		if !errors.As(err, &dependency) || !errors.Is(err, ErrHasDependencies) {
			t.Fatalf("routing %s not blocked: %v", category, err)
		}
	}
}

func TestArchiveRoutingQueryLimitsDefaultFallbackAndExpiredKeys(t *testing.T) {
	for _, contract := range []string{
		"s.pipeline_id = p.id", "coalesce(s.is_active, true) = true", "fallback.organization_id = $1::uuid",
		"f.organization_id = $1::uuid", "coalesce(f.is_active, true) = true", "coalesce(i.is_connected, false) = true",
		"i.organization_id = $1::uuid and i.is_active = true", "r.organization_id = $1::uuid and coalesce(r.is_active, true) = true",
		"w.organization_id = $1::uuid and w.is_active = true and w.type = 'incoming'",
		"k.organization_id = $1::uuid", "coalesce(k.is_active, false) = true", "k.expires_at > now()", "t.is_default and t.is_first",
		"module.organization_id = k.organization_id", "lower(trim(module.module_name)) = 'api'", "coalesce(module.is_enabled, false) = true",
		"left join queue_routes q on q.id = f.round_robin_id", "'queue_required', f.round_robin_id is not null",
		"r.rules->>'target_stage_id'",
	} {
		if !strings.Contains(stageArchiveRoutingSQL, contract) {
			t.Fatalf("missing operational contract %q", contract)
		}
	}
}

func TestArchiveDependencyResponseListsOnlySafeCategories(t *testing.T) {
	request := httptest.NewRequest(http.MethodPatch, "/v1/stages/stage", nil)
	response := httptest.NewRecorder()
	writePipelineError(response, request, &StageArchiveDependenciesError{Categories: []string{"meta_forms", "incoming_webhooks", "secret-token-or-sql"}})
	if response.Code != http.StatusConflict {
		t.Fatalf("status=%d", response.Code)
	}
	for _, expected := range []string{"stage_has_active_routing", "formulários Meta", "webhooks de entrada"} {
		if !strings.Contains(response.Body.String(), expected) {
			t.Fatalf("missing safe explanation %q", expected)
		}
	}
	if strings.Contains(response.Body.String(), "secret-token-or-sql") {
		t.Fatal("must not expose unknown routing metadata")
	}
}

func TestArchiveReadFailureDoesNotPermitMutation(t *testing.T) {
	want := errors.New("synthetic read failure")
	err := (Repository{}).ensureStageArchiveRoutingSafe(context.Background(), &archiveQuery{err: want}, "org", "pipeline", "stage")
	if !errors.Is(err, want) {
		t.Fatalf("read error was hidden: %v", err)
	}
}
