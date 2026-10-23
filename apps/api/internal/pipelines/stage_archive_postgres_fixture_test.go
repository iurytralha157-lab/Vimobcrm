package pipelines

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

// Opt-in follows the disposable-database pattern in admin's activation tests.
// It requires a loopback postgres/postgres server with CREATE DATABASE privilege;
// it creates/drops only a random vimob_stage_archive_test_* database. No migration,
// extension, trigger, real tenant or credential fixture is installed. The minimal
// tables below mirror the types/nullability consumed by stageArchiveRoutingSQL;
// this tests that query, not the complete deployed schema, RLS or archive handler.
func openStageArchivePostgresFixture(t *testing.T) (context.Context, *pgx.Conn) {
	return openStageArchivePostgresFixtureWithPrefix(t, "vimob_stage_archive_test_")
}

func openStageArchivePostgresFixtureWithPrefix(t *testing.T, prefix string) (context.Context, *pgx.Conn) {
	t.Helper()
	if prefix != "vimob_stage_archive_test_" && prefix != "vimob_pipeline_f03_" && prefix != "vimob_pipeline_f04_" {
		t.Fatal("unsupported disposable database ownership prefix")
	}
	if os.Getenv("VIMOB_RUN_STAGE_ARCHIVE_DB_TESTS") != "LOCAL_WRITE_TEST" {
		t.Skip("PostgreSQL routing not executed: set VIMOB_RUN_STAGE_ARCHIVE_DB_TESTS=LOCAL_WRITE_TEST and PIPELINE_ARCHIVE_TEST_DATABASE_URL for a disposable loopback server")
	}
	config, err := stageArchiveTestConfig(strings.TrimSpace(os.Getenv("PIPELINE_ARCHIVE_TEST_DATABASE_URL")))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 60*time.Second)
	t.Cleanup(cancel)
	admin, err := pgx.ConnectConfig(ctx, config)
	if err != nil {
		t.Fatal("cannot connect to the explicitly selected disposable PostgreSQL server")
	}
	var adminDatabase, adminRole string
	if err := admin.QueryRow(ctx, `select current_database(), current_user`).Scan(&adminDatabase, &adminRole); err != nil || adminDatabase != "postgres" || adminRole != "postgres" {
		_ = admin.Close(ctx)
		t.Fatal("effective admin database/user must be postgres/postgres before isolated DDL")
	}
	var suffix [6]byte
	if _, err := rand.Read(suffix[:]); err != nil {
		_ = admin.Close(ctx)
		t.Fatal("cannot generate disposable database name")
	}
	databaseName := prefix + hex.EncodeToString(suffix[:])
	quotedName := pgx.Identifier{databaseName}.Sanitize()
	if _, err := admin.Exec(ctx, "create database "+quotedName); err != nil {
		_ = admin.Close(ctx)
		t.Fatal("cannot create disposable database; the local test role needs CREATE DATABASE")
	}
	var conn *pgx.Conn
	t.Cleanup(func() {
		// Windows may spend more than ten seconds checkpointing/removing an owned
		// database under concurrent fixture DDL. This cleanup budget does not
		// change query/operation deadlines or any behavior assertion.
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cleanupCancel()
		if conn != nil {
			if err := conn.Close(cleanupCtx); err != nil {
				t.Errorf("close isolated routing connection: %v", err)
			}
		}
		if _, err := admin.Exec(cleanupCtx, "drop database "+quotedName); err != nil {
			t.Errorf("drop generated routing database: %v", err)
		}
		if err := admin.Close(cleanupCtx); err != nil {
			t.Errorf("close local admin connection: %v", err)
		}
	})
	config = config.Copy()
	config.Database = databaseName
	conn, err = pgx.ConnectConfig(ctx, config)
	if err != nil {
		t.Fatal("cannot connect to generated routing database")
	}
	var effectiveDatabase string
	if err := conn.QueryRow(ctx, `select current_database()`).Scan(&effectiveDatabase); err != nil || effectiveDatabase != databaseName {
		t.Fatal("effective fixture database must match the generated owned database before schema DDL")
	}
	for _, statement := range stageArchivePostgresSchema {
		if _, err := conn.Exec(ctx, statement); err != nil {
			t.Fatalf("create minimal routing schema: %v", err)
		}
	}
	return ctx, conn
}

func stageArchiveTestConfig(dsn string) (*pgx.ConnConfig, error) {
	invalid := fmt.Errorf("PIPELINE_ARCHIVE_TEST_DATABASE_URL must be a PostgreSQL URL for a disposable loopback postgres/postgres server")
	target, err := url.Parse(dsn)
	if err != nil || (target.Scheme != "postgres" && target.Scheme != "postgresql") || target.User == nil ||
		target.User.Username() != "postgres" || target.Path != "/postgres" || !stageArchiveLoopback(target.Hostname()) {
		return nil, invalid
	}
	config, err := pgx.ParseConfig(dsn)
	if err != nil || config.User != "postgres" || config.Database != "postgres" || !stageArchiveLoopback(config.Host) {
		return nil, invalid
	}
	for _, fallback := range config.Fallbacks {
		if !stageArchiveLoopback(fallback.Host) {
			return nil, invalid
		}
	}
	return config, nil
}

func stageArchiveLoopback(host string) bool {
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

var stageArchivePostgresSchema = []string{
	`create table public.pipelines (id uuid primary key, organization_id uuid not null,
	  is_active boolean default true, is_default boolean default false, position integer default 0,
	  created_at timestamptz not null default now())`,
	`create table public.stages (id uuid primary key, organization_id uuid not null, pipeline_id uuid not null,
	  is_active boolean not null default true, position integer not null default 0,
	  created_at timestamptz not null default now())`,
	`create table public.round_robins (id uuid primary key, organization_id uuid not null,
	  is_active boolean default true, target_stage_id uuid, target_pipeline_id uuid, pipeline_id uuid,
	  rules jsonb default '{}'::jsonb)`,
	`create table public.meta_integrations (id uuid primary key, organization_id uuid not null,
	  is_connected boolean default false, stage_id uuid, pipeline_id uuid)`,
	`create table public.meta_form_configs (id uuid primary key, organization_id uuid not null,
	  integration_id uuid not null, is_active boolean default true, stage_id uuid, pipeline_id uuid, round_robin_id uuid)`,
	`create table public.portal_integrations (id uuid primary key, organization_id uuid not null,
	  is_active boolean not null default false, default_stage_id uuid, default_pipeline_id uuid, default_round_robin_id uuid)`,
	`create table public.webhooks_integrations (id uuid primary key, organization_id uuid not null,
	  is_active boolean not null default true, type text not null default 'incoming', target_stage_id uuid, target_pipeline_id uuid)`,
	`create table public.whatsapp_inbound_rules (id uuid primary key, organization_id uuid not null,
	  is_active boolean not null default true, target_stage_id uuid, target_pipeline_id uuid)`,
	`create table public.organization_api_keys (id uuid primary key, organization_id uuid not null,
	  is_active boolean default true, expires_at timestamptz)`,
	`create table public.organization_modules (id uuid primary key, organization_id uuid not null,
	  module_name text not null, is_enabled boolean default false)`,
	`create table public.lead_stage_history (id uuid primary key, lead_id uuid not null, stage_id uuid)`,
	`create table public.lead_stage_cycles (id uuid primary key, organization_id uuid not null,
	  lead_id uuid not null, pipeline_id uuid not null, stage_id uuid not null)`,
	`create table public.cadence_templates (id uuid primary key, organization_id uuid not null, stage_id uuid, is_active boolean not null default true)`,
	`create table public.lead_attention_policies (id uuid primary key, organization_id uuid not null, stage_id uuid, status text not null)`,
	`create table public.automations (id uuid primary key, organization_id uuid not null, name text not null,
	  is_active boolean not null default false, deleted_at timestamptz, active_flow_version_id uuid, flow_definition jsonb)`,
	`create table public.automation_flow_versions (id uuid primary key, organization_id uuid not null,
	  automation_id uuid not null, graph jsonb not null, requires_review boolean not null default false)`,
	`create table public.automation_nodes (id uuid primary key, automation_id uuid not null,
	  node_type text not null, action_type text, config jsonb not null default '{}')`,
	`create table public.automation_executions (id uuid primary key, organization_id uuid not null,
	  automation_id uuid not null, flow_version_id uuid, status text not null)`,
}

type stageArchivePostgresFixture struct {
	t   *testing.T
	ctx context.Context
	tx  pgx.Tx
}

func (fixture stageArchivePostgresFixture) exec(sql string, args ...any) {
	fixture.t.Helper()
	if _, err := fixture.tx.Exec(fixture.ctx, sql, args...); err != nil {
		fixture.t.Fatalf("prepare synthetic routing fixture: %v", err)
	}
}

func stageArchiveFixtureID(value int) string {
	return fmt.Sprintf("00000000-0000-4000-8000-%012d", value)
}

func stageArchiveNullableID(value int) any {
	if value == 0 {
		return nil
	}
	return stageArchiveFixtureID(value)
}

func (fixture stageArchivePostgresFixture) seed() {
	for _, row := range []struct {
		id, org, position int
		active, isDefault bool
	}{
		{101, 1, 10, true, true}, {102, 1, 20, true, false}, {103, 1, 30, true, false},
		{104, 1, 0, false, true}, {111, 2, 1, true, true},
	} {
		fixture.exec(`insert into public.pipelines (id,organization_id,position,is_active,is_default) values ($1,$2,$3,$4,$5)`,
			stageArchiveFixtureID(row.id), stageArchiveFixtureID(row.org), row.position, row.active, row.isDefault)
	}
	for _, row := range []struct {
		id, org, pipeline, position int
		active                      bool
	}{
		{201, 1, 101, 1, true}, {202, 1, 101, 2, true}, {203, 1, 102, 1, true},
		{204, 1, 101, 0, false}, {205, 1, 104, 1, true}, {211, 2, 111, 1, true},
	} {
		fixture.exec(`insert into public.stages (id,organization_id,pipeline_id,position,is_active) values ($1,$2,$3,$4,$5)`,
			stageArchiveFixtureID(row.id), stageArchiveFixtureID(row.org), stageArchiveFixtureID(row.pipeline), row.position, row.active)
	}
	// Retained history/configuration is present in every scenario, but is never intake.
	fixture.exec(`insert into public.lead_stage_history values ($1,$2,$3)`, stageArchiveFixtureID(1101), stageArchiveFixtureID(1201), stageArchiveFixtureID(201))
	fixture.exec(`insert into public.lead_stage_cycles values ($1,$2,$3,$4,$5)`, stageArchiveFixtureID(1102), stageArchiveFixtureID(1), stageArchiveFixtureID(1201), stageArchiveFixtureID(101), stageArchiveFixtureID(201))
	fixture.exec(`insert into public.cadence_templates values ($1,$2,$3,true)`, stageArchiveFixtureID(1103), stageArchiveFixtureID(1), stageArchiveFixtureID(201))
	fixture.exec(`insert into public.lead_attention_policies values ($1,$2,$3,'enabled')`, stageArchiveFixtureID(1104), stageArchiveFixtureID(1), stageArchiveFixtureID(201))
}

func (fixture stageArchivePostgresFixture) queue(org, stage, pipeline, legacyPipeline int, active any, rules string) {
	if rules == "" {
		rules = "{}"
	}
	fixture.exec(`insert into public.round_robins (id,organization_id,target_stage_id,target_pipeline_id,pipeline_id,is_active,rules)
	  values ($1,$2,$3,$4,$5,$6,$7::jsonb)`, stageArchiveFixtureID(300+org), stageArchiveFixtureID(org),
		stageArchiveNullableID(stage), stageArchiveNullableID(pipeline), stageArchiveNullableID(legacyPipeline), active, rules)
}

func (fixture stageArchivePostgresFixture) meta(org, formStage, formPipeline, queue, integrationStage, integrationPipeline int, active, connected bool) {
	fixture.exec(`insert into public.meta_integrations (id,organization_id,stage_id,pipeline_id,is_connected) values ($1,$2,$3,$4,$5)`,
		stageArchiveFixtureID(400+org), stageArchiveFixtureID(org), stageArchiveNullableID(integrationStage), stageArchiveNullableID(integrationPipeline), connected)
	fixture.exec(`insert into public.meta_form_configs (id,organization_id,integration_id,stage_id,pipeline_id,round_robin_id,is_active)
	  values ($1,$2,$3,$4,$5,$6,$7)`, stageArchiveFixtureID(500+org), stageArchiveFixtureID(org), stageArchiveFixtureID(400+org),
		stageArchiveNullableID(formStage), stageArchiveNullableID(formPipeline), stageArchiveNullableID(queue), active)
}

func (fixture stageArchivePostgresFixture) portal(org, stage, pipeline, queue int, active bool) {
	fixture.exec(`insert into public.portal_integrations (id,organization_id,default_stage_id,default_pipeline_id,default_round_robin_id,is_active)
	  values ($1,$2,$3,$4,$5,$6)`, stageArchiveFixtureID(600+org), stageArchiveFixtureID(org), stageArchiveNullableID(stage), stageArchiveNullableID(pipeline), stageArchiveNullableID(queue), active)
}

func (fixture stageArchivePostgresFixture) direct(table string, org, stage, pipeline int, active bool) {
	fixture.t.Helper()
	// Only test-owned constants are accepted as identifiers; destinations are parameters.
	if table != "webhooks_integrations" && table != "whatsapp_inbound_rules" {
		fixture.t.Fatal("unsupported synthetic routing table")
	}
	fixture.exec(`insert into `+pgx.Identifier{"public", table}.Sanitize()+` (id,organization_id,target_stage_id,target_pipeline_id,is_active) values ($1,$2,$3,$4,$5)`,
		stageArchiveFixtureID(700+org), stageArchiveFixtureID(org), stageArchiveNullableID(stage), stageArchiveNullableID(pipeline), active)
}

func (fixture stageArchivePostgresFixture) api(org int, keyActive, moduleEnabled bool, expiry any) {
	fixture.exec(`insert into public.organization_api_keys (id,organization_id,is_active,expires_at) values ($1,$2,$3,$4)`,
		stageArchiveFixtureID(900+org), stageArchiveFixtureID(org), keyActive, expiry)
	fixture.exec(`insert into public.organization_modules (id,organization_id,module_name,is_enabled) values ($1,$2,' API ',$3)`,
		stageArchiveFixtureID(1000+org), stageArchiveFixtureID(org), moduleEnabled)
}
