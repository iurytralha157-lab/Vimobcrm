package leads

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type automationStageFixture struct {
	ctx                                            context.Context
	db                                             *dbpkg.Postgres
	conn                                           *pgx.Conn
	repo                                           Repository
	resolver                                       tenant.Repository
	org, user, pipeline, open, won, lost, property string
}

// Only an explicit local opt-in is read. The random database belongs to this
// test and is the only database dropped; production env files are never loaded.
func newAutomationStageFixture(t *testing.T) *automationStageFixture {
	t.Helper()
	if os.Getenv("VIMOB_RUN_AUTOMATION_STAGE_DB_TESTS") != "LOCAL_WRITE_TEST" {
		t.Skip("opt in to the disposable local automation command fixture")
	}
	config, err := leadPipelineTestConfig(os.Getenv("AUTOMATION_STAGE_TEST_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 3*time.Minute)
	t.Cleanup(cancel)
	admin, err := pgx.ConnectConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	var suffix [8]byte
	if _, err = rand.Read(suffix[:]); err != nil {
		t.Fatal(err)
	}
	name := "vimob_automation_stage_test_" + hex.EncodeToString(suffix[:])
	quoted := pgx.Identifier{name}.Sanitize()
	if _, err = admin.Exec(ctx, "create database "+quoted); err != nil {
		admin.Close(ctx)
		t.Fatal(err)
	}
	f := &automationStageFixture{ctx: ctx, org: pipelinePostgresID(1), user: pipelinePostgresID(2), pipeline: pipelinePostgresID(3), open: pipelinePostgresID(4), won: pipelinePostgresID(5), lost: pipelinePostgresID(6), property: pipelinePostgresID(7)}
	t.Cleanup(func() {
		cleanup, done := context.WithTimeout(context.Background(), 30*time.Second)
		defer done()
		if f.db != nil {
			f.db.Close()
		}
		if f.conn != nil {
			f.conn.Close(cleanup)
		}
		if _, err := admin.Exec(cleanup, "drop database "+quoted); err != nil {
			t.Errorf("drop own fixture: %v", err)
		}
		admin.Close(cleanup)
	})
	config = config.Copy()
	config.Database = name
	f.conn, err = pgx.ConnectConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	ownedURL, err := url.Parse(os.Getenv("AUTOMATION_STAGE_TEST_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	ownedURL.Path = "/" + name
	ownedConfig, err := pgx.ParseConfig(ownedURL.String())
	if err != nil || ownedConfig.Database != name || ownedConfig.Host != config.Host || ownedConfig.User != "postgres" {
		t.Fatal("repository target must remain the owned random database")
	}
	f.db, err = dbpkg.NewPostgres(ctx, dbpkg.Config{URL: ownedURL.String(), MaxConns: 6, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	f.repo = NewRepository(f.db, nil)
	f.resolver = tenant.NewRepository(f.db)
	source, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "supabase", "migrations", "20260722000000_production_public_private_baseline.sql"))
	if err != nil {
		t.Fatal(err)
	}
	// Use real table declarations for all columns consumed by the command. RLS,
	// full production triggers and deployment state are outside this fixture.
	for _, table := range []string{"users", "organizations", "organization_members", "organization_modules", "organization_roles", "organization_role_permissions", "available_permissions", "user_organization_roles", "user_permission_overrides", "teams", "team_members", "team_pipelines", "pipelines", "stages", "stage_automations", "leads", "properties", "events", "activities", "audit_logs", "assignments_log", "notifications", "notification_templates", "automations", "automation_flow_versions", "automation_executions", "automation_effect_dispatches"} {
		expression := regexp.MustCompile(`(?s)CREATE TABLE IF NOT EXISTS "public"\."` + table + `" \(.*?\n\);`)
		statement := expression.FindString(string(source))
		if statement == "" {
			t.Fatalf("missing real table %s", table)
		}
		f.exec(t, statement)
	}
	f.exec(t, `create schema private;
 create function private.queue_pool_read_access(uuid,uuid,uuid) returns boolean language sql as 'select null::boolean';
 create function private.queue_pool_metadata(uuid,uuid,uuid) returns jsonb language sql as 'select null::jsonb';
 create table private.realtime_events(id uuid default gen_random_uuid(),organization_id uuid,user_id uuid,audience_user_id uuid,event_type text,data jsonb,created_at timestamptz);
 alter table public.organization_members add column deleted_at timestamptz,add column membership_generation bigint default 1;
 alter table public.team_members add column if not exists membership_generation bigint default 1;
 alter table public.organizations add column billing_grace_until timestamptz;
 alter table public.leads add column if not exists board_order_at timestamptz;
 alter table public.leads add column if not exists whatsapp_avatar_storage_path text,add column if not exists whatsapp_avatar_synced_at timestamptz;
 create unique index automation_stage_effect_key on public.automation_effect_dispatches(effect_key);
 create unique index automation_stage_notification_key on public.notifications(organization_id,user_id,(metadata->>'dedupe_key')) where metadata ? 'dedupe_key';`)
	f.exec(t, `insert into public.organizations(id,name,subscription_status,subscription_type) values($1,'Synthetic org','active','free'),($2,'Other org','active','free')`, f.org, pipelinePostgresID(99))
	f.exec(t, `insert into public.users(id,organization_id,name,email,role) values($1,$2,'Synthetic actor','actor@example.test','user')`, f.user, f.org)
	f.exec(t, `insert into public.organization_members(organization_id,user_id,role) values($1,$2,'admin')`, f.org, f.user)
	f.exec(t, `insert into public.organization_modules(organization_id,module_name,is_enabled) values($1,'automations',true)`, f.org)
	f.exec(t, `insert into public.pipelines(id,organization_id,name) values($1,$2,'Synthetic pipeline')`, f.pipeline, f.org)
	f.exec(t, `insert into public.stages(id,organization_id,pipeline_id,name,stage_key,is_won,is_lost) values($1,$4,$5,'Open','open',false,false),($2,$4,$5,'Won','won',true,false),($3,$4,$5,'Lost','lost',false,true)`, f.open, f.won, f.lost, f.org, f.pipeline)
	f.exec(t, `insert into public.properties(id,organization_id,code,status,published_on_site,anunciar) values($1,$2,'SYNTHETIC','active',true,true)`, f.property, f.org)
	return f
}

func (f *automationStageFixture) exec(t *testing.T, query string, args ...any) {
	t.Helper()
	if _, err := f.conn.Exec(f.ctx, query, append([]any{pgx.QueryExecModeSimpleProtocol}, args...)...); err != nil {
		t.Fatalf("synthetic fixture SQL: %v", err)
	}
}
func (f *automationStageFixture) count(t *testing.T, table string) int {
	t.Helper()
	var n int
	if err := f.conn.QueryRow(f.ctx, "select count(*) from "+table).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func (f *automationStageFixture) command(t *testing.T, sequence int, target string, lostReason *string) automationStageCommand {
	t.Helper()
	lead, automation, version, execution := pipelinePostgresID(sequence), pipelinePostgresID(sequence+1000), pipelinePostgresID(sequence+2000), pipelinePostgresID(sequence+3000)
	f.exec(t, `insert into public.leads(id,organization_id,name,source,deal_status,pipeline_id,stage_id,assigned_user_id,property_id,interest_property_id) values($1,$2,'Synthetic lead','manual','open',$3,$4,$5,$6,$6)`, lead, f.org, f.pipeline, f.open, f.user, f.property)
	f.exec(t, `insert into public.automations(id,organization_id,name,trigger_type,created_by,active_flow_version_id) values($1,$2,'Synthetic flow','manual',$3,$4)`, automation, f.org, f.user, version)
	graph := jsonb(map[string]any{"nodes": []any{map[string]any{"id": "stage-node", "type": "action", "action_type": "move_lead", "config": automationStageConfig{target, f.pipeline, lostReason}}}})
	f.exec(t, `insert into public.automation_flow_versions(id,automation_id,organization_id,version,trigger_type,graph,graph_checksum,first_node_key,created_by) values($1,$2,$3,1,'manual',$4::jsonb,'synthetic','stage-node',$5)`, version, automation, f.org, graph, f.user)
	f.exec(t, `insert into public.automation_executions(id,organization_id,automation_id,flow_version_id,lead_id,status,current_node_key,locked_by,locked_at) values($1,$2,$3,$4,$5,'running','stage-node','synthetic-lease',now())`, execution, f.org, automation, version, lead)
	return automationStageCommand{f.org, execution, "stage-node", "synthetic-lease", "automation:" + execution + ":stage-node:move_lead"}
}

func (f *automationStageFixture) status(t *testing.T, leadID string) (string, string) {
	t.Helper()
	var status, stage string
	if err := f.conn.QueryRow(f.ctx, `select deal_status,stage_id::text from public.leads where id=$1`, leadID).Scan(&status, &stage); err != nil {
		t.Fatal(err)
	}
	return status, stage
}

// Keep strings import tied to fixture safety: no host-list or options may
// smuggle a second remote target through the opt-in connection string.
func TestAutomationStageFixtureRejectsUnsafeConnection(t *testing.T) {
	for _, target := range []string{"postgres://postgres@remote.example/postgres", "postgres://postgres@127.0.0.1/prod", "postgres://postgres@127.0.0.1/postgres?host=remote.example"} {
		if _, err := leadPipelineTestConfig(strings.TrimSpace(target)); err == nil {
			t.Fatal("unsafe target accepted")
		}
	}
}
