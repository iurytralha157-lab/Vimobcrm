package pipelines

import (
	"context"
	"errors"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

// Runs the production dependency SQL in an owned, generated local database.
// Parent fixture validates loopback/admin identity and drops only that database.
func TestStageAutomationDependenciesPostgres(t *testing.T) {
	ctx, conn := openStageArchivePostgresFixtureWithPrefix(t, "vimob_pipeline_f03_")
	graph := func(stage int, action bool) string {
		if action {
			return fmt.Sprintf(`{"nodes":[{"id":"move","type":"action","action_type":"move_lead","config":{"pipeline_id":"%s","stage_id":"%s"}}]}`, stageArchiveFixtureID(101), stageArchiveFixtureID(stage))
		}
		return fmt.Sprintf(`{"nodes":[{"id":"trigger","type":"trigger","config":{"triggerType":"lead_stage_changed","pipeline_id":"%s","to_stage_id":"%s"}}]}`, stageArchiveFixtureID(101), stageArchiveFixtureID(stage))
	}
	type scenario struct {
		name        string
		active      bool
		version     int
		versionOrg  int
		org         int
		graph       string
		legacy      bool
		status      string
		execVersion int
		blocked     bool
		pipeline    bool
	}
	scenarios := []scenario{
		{name: "active immutable move", active: true, version: 901, graph: graph(201, true), blocked: true},
		{name: "active immutable trigger", active: true, version: 901, graph: graph(201, false), blocked: true},
		{name: "paused published no execution", version: 901, graph: graph(201, true)},
		{name: "abandoned draft", graph: graph(201, true), legacy: true},
		{name: "active legacy node", active: true, graph: graph(201, true), legacy: true, blocked: true},
		{name: "current draft cannot override effective version", active: true, version: 901, graph: graph(202, true), legacy: true},
		{name: "historical version without execution", active: true, version: 901, graph: graph(202, true), execVersion: 902},
		{name: "queued old version", active: true, version: 901, graph: graph(202, true), execVersion: 902, status: "queued", blocked: true},
		{name: "running old version", version: 901, graph: graph(202, true), execVersion: 902, status: "running", blocked: true},
		{name: "waiting old version", version: 901, graph: graph(202, true), execVersion: 902, status: "waiting", blocked: true},
		{name: "completed old version", version: 901, graph: graph(202, true), execVersion: 902, status: "completed"},
		{name: "failed old version", version: 901, graph: graph(202, true), execVersion: 902, status: "failed"},
		{name: "cancelled old version", version: 901, graph: graph(202, true), execVersion: 902, status: "cancelled"},
		{name: "legacy paused pending execution", graph: graph(201, true), legacy: true, status: "waiting", blocked: true},
		{name: "foreign automation ignored", active: true, version: 901, graph: graph(201, true), org: 2},
		{name: "foreign immutable version ignored", active: true, version: 901, graph: graph(201, true), versionOrg: 2},
		{name: "sibling stage does not block archive", active: true, version: 901, graph: graph(202, true)},
		{name: "sibling stage blocks pipeline delete", active: true, version: 901, graph: graph(202, true), pipeline: true, blocked: true},
		{name: "unrelated config cannot block", active: true, version: 901, graph: fmt.Sprintf(`{"nodes":[{"type":"action","action_type":"send_whatsapp","config":{"stage_id":"%s"}}]}`, stageArchiveFixtureID(201))},
		{name: "malformed legacy graph stays bounded", active: true, version: 901, graph: `{"nodes":{"stage_id":"not-an-array"}}`},
	}
	for _, testCase := range scenarios {
		t.Run(testCase.name, func(t *testing.T) {
			tx, err := conn.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer func() {
				cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				if err := tx.Rollback(cleanup); err != nil {
					t.Error(err)
				}
			}()
			fixture := stageArchivePostgresFixture{t: t, ctx: ctx, tx: tx}
			fixture.seed()
			org := testCase.org
			if org == 0 {
				org = 1
			}
			fixture.exec(`insert into public.automations(id,organization_id,name,is_active,active_flow_version_id,flow_definition)
			  values($1,$2,'Synthetic flow',$3,$4,$5::jsonb)`, stageArchiveFixtureID(801), stageArchiveFixtureID(org), testCase.active, stageArchiveNullableID(testCase.version), graph(201, true))
			if testCase.version != 0 {
				versionOrg := testCase.versionOrg
				if versionOrg == 0 {
					versionOrg = org
				}
				fixture.exec(`insert into public.automation_flow_versions(id,organization_id,automation_id,graph) values($1,$2,$3,$4::jsonb)`, stageArchiveFixtureID(testCase.version), stageArchiveFixtureID(versionOrg), stageArchiveFixtureID(801), testCase.graph)
			}
			if testCase.execVersion != 0 {
				fixture.exec(`insert into public.automation_flow_versions(id,organization_id,automation_id,graph) values($1,$2,$3,$4::jsonb)`, stageArchiveFixtureID(testCase.execVersion), stageArchiveFixtureID(org), stageArchiveFixtureID(801), graph(201, true))
			}
			if testCase.legacy {
				fixture.exec(`insert into public.automation_nodes(id,automation_id,node_type,action_type,config) values($1,$2,'action','move_lead',$3::jsonb)`, stageArchiveFixtureID(950), stageArchiveFixtureID(801), fmt.Sprintf(`{"stage_id":"%s","pipeline_id":"%s"}`, stageArchiveFixtureID(201), stageArchiveFixtureID(101)))
			}
			if testCase.status != "" {
				fixture.exec(`insert into public.automation_executions(id,organization_id,automation_id,flow_version_id,status) values($1,$2,$3,$4,$5)`, stageArchiveFixtureID(960), stageArchiveFixtureID(org), stageArchiveFixtureID(801), stageArchiveNullableID(testCase.execVersion), testCase.status)
			}
			pipelineID, stageID := stageArchiveFixtureID(101), stageArchiveFixtureID(201)
			if testCase.pipeline {
				stageID = ""
			}
			err = (Repository{}).ensureStageAutomationReferencesSafe(ctx, tx, stageArchiveFixtureID(1), pipelineID, stageID)
			var blocked *StageAutomationDependenciesError
			if errors.As(err, &blocked) != testCase.blocked || (!testCase.blocked && err != nil) {
				t.Fatalf("blocked=%v want=%v error=%v", blocked, testCase.blocked, err)
			}
		})
	}
}

// Execute the exact SQL literal used by the sibling domain's publication gate,
// so this verifies the database predicates without exporting a test-only API.
func TestAutomationPublishedStageReferencePostgres(t *testing.T) {
	file, err := parser.ParseFile(token.NewFileSet(), filepath.Join("..", "automations", "stage_reference.go"), nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	var query, pipelineQuery string
	ast.Inspect(file, func(node ast.Node) bool {
		literal, ok := node.(*ast.BasicLit)
		if ok && literal.Kind == token.STRING {
			value, parseErr := strconv.Unquote(literal.Value)
			if parseErr == nil && strings.Contains(value, "from public.stages s") {
				query = value
			}
			if parseErr == nil && strings.Contains(value, "from public.pipelines p") && !strings.Contains(value, "from public.stages s") {
				pipelineQuery = value
			}
		}
		return true
	})
	if query == "" || pipelineQuery == "" {
		t.Fatal("publication SQL not found")
	}
	ctx, conn := openStageArchivePostgresFixtureWithPrefix(t, "vimob_pipeline_f03_")
	for _, testCase := range []struct {
		name           string
		stageActive    bool
		pipelineActive bool
		org            int
		invalid        bool
		pipelineOnly   bool
		stageOnly      bool
	}{
		{"active stage and pipeline", true, true, 1, false, false, false},
		{"archived stage", false, true, 1, true, false, false},
		{"archived pipeline", true, false, 1, true, false, false},
		{"foreign organization", true, true, 2, true, false, false},
		{"pipeline-only filter", true, true, 1, false, true, false},
		{"inactive pipeline-only filter", true, false, 1, true, true, false},
		{"stage-only action", true, true, 1, false, false, true},
		{"inactive stage-only action", false, true, 1, true, false, true},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			tx, err := conn.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback(ctx)
			fixture := stageArchivePostgresFixture{t: t, ctx: ctx, tx: tx}
			fixture.seed()
			fixture.exec(`update public.stages set is_active=$1 where id=$2`, testCase.stageActive, stageArchiveFixtureID(201))
			fixture.exec(`update public.pipelines set is_active=$1 where id=$2`, testCase.pipelineActive, stageArchiveFixtureID(101))
			var exists bool
			pipelineID := stageArchiveFixtureID(101)
			if testCase.stageOnly {
				pipelineID = ""
			}
			if testCase.pipelineOnly {
				err = tx.QueryRow(ctx, pipelineQuery, pipelineID, stageArchiveFixtureID(testCase.org)).Scan(&exists)
			} else {
				err = tx.QueryRow(ctx, query, stageArchiveFixtureID(201), pipelineID, stageArchiveFixtureID(testCase.org)).Scan(&exists)
			}
			if errors.Is(err, pgx.ErrNoRows) != testCase.invalid || (!testCase.invalid && (err != nil || !exists)) {
				t.Fatalf("publication SQL validation: invalid=%v error=%v", testCase.invalid, err)
			}
		})
	}
}
