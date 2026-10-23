package stageconfig

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
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type inactivityPostgresFixture struct {
	t      *testing.T
	ctx    context.Context
	db     *dbpkg.Postgres
	repo   Repository
	seedTx pgx.Tx
}

func openInactivityPostgresFixture(t *testing.T) inactivityPostgresFixture {
	t.Helper()
	return openInactivityPostgresFixtureAtFactPolicyGate(t, true)
}

func openInactivityPostgresFixtureAtFactPolicyGate(t *testing.T, applyFactPolicyGate bool) inactivityPostgresFixture {
	t.Helper()
	if os.Getenv("VIMOB_RUN_STAGE_INACTIVITY_DB_TESTS") != "LOCAL_WRITE_TEST" {
		t.Skip("set VIMOB_RUN_STAGE_INACTIVITY_DB_TESTS=LOCAL_WRITE_TEST and PIPELINE_INACTIVITY_TEST_DATABASE_URL for a disposable loopback server")
	}
	config, err := inactivityTestConfig(strings.TrimSpace(os.Getenv("PIPELINE_INACTIVITY_TEST_DATABASE_URL")))
	if err != nil {
		t.Fatal(err)
	}
	// Local DDL/fsync preparation has a separate budget from test scenarios;
	// product cycle/statement/phase deadlines are not relaxed by the harness.
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Minute)
	t.Cleanup(cancel)
	admin, err := pgx.ConnectConfig(ctx, config)
	if err != nil {
		t.Fatal("cannot connect to the explicitly selected disposable PostgreSQL server")
	}
	var roleCount int
	if err := admin.QueryRow(ctx, `select count(*) from pg_roles where rolname in ('anon','authenticated','service_role')`).Scan(&roleCount); err != nil || roleCount != 3 {
		_ = admin.Close(ctx)
		t.Fatal("the owned synthetic server must pre-create anon/authenticated/service_role NOLOGIN roles; the fixture never changes global roles")
	}
	var suffix [6]byte
	if _, err := rand.Read(suffix[:]); err != nil {
		_ = admin.Close(ctx)
		t.Fatal("cannot generate disposable database name")
	}
	databaseName := "vimob_stage_inactivity_test_" + hex.EncodeToString(suffix[:])
	quotedName := pgx.Identifier{databaseName}.Sanitize()
	if _, err := admin.Exec(ctx, "create database "+quotedName); err != nil {
		_ = admin.Close(ctx)
		t.Fatal("cannot create explicitly scoped random test database")
	}
	var database *dbpkg.Postgres
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cleanupCancel()
		if database != nil {
			database.Close()
		}
		if _, err := admin.Exec(cleanupCtx, "drop database "+quotedName); err != nil {
			t.Errorf("drop generated inactivity database: %v", err)
		}
		_ = admin.Close(cleanupCtx)
	})
	// ConnConfig.ConnString preserves the original DSN rather than mutated
	// fields. Build the URL destination explicitly, then prove it before DDL.
	isolatedURL, err := inactivityFixtureDatabaseURL(strings.TrimSpace(os.Getenv("PIPELINE_INACTIVITY_TEST_DATABASE_URL")), databaseName)
	if err != nil {
		t.Fatal(err)
	}
	database, err = dbpkg.NewPostgres(ctx, dbpkg.Config{URL: isolatedURL, MaxConns: 4, MinConns: 0, HealthTimeout: 5 * time.Second})
	if err != nil {
		t.Fatal("cannot connect to generated inactivity database")
	}
	var actualDatabase string
	if err := database.Pool().QueryRow(ctx, `select current_database()`).Scan(&actualDatabase); err != nil || actualDatabase != databaseName {
		t.Fatal("isolated database identity was not confirmed; no fixture DDL was executed")
	}
	fixture := inactivityPostgresFixture{t: t, ctx: ctx, db: database, repo: NewRepository(database)}
	t.Log("synthetic setup: public schema")
	fixture.exec(inactivityPostgresSchema)
	t.Log("synthetic setup: real normalized notification producers")
	installInactivityNotificationHooks(fixture)
	migration, err := os.ReadFile("../../../../supabase/migrations/20261013015858_stage_inactivity_runtime_scaffold.sql")
	if err != nil {
		t.Fatal(err)
	}
	t.Log("synthetic setup: candidate private runtime migration")
	fixture.exec(string(migration))
	if applyFactPolicyGate {
		installInactivityFactPolicyGate(fixture)
	}
	index, err := os.ReadFile("../../../../supabase/cutovers/20261013_prepare_simple_stage_inactivity_index.sql")
	if err != nil {
		t.Fatal(err)
	}
	t.Log("synthetic setup: concurrent public lead index outside a transaction")
	connection, err := database.Pool().Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if connection.Conn().PgConn().TxStatus() != 'I' {
		connection.Release()
		t.Fatal("concurrent index preparation was not outside a transaction")
	}
	_, err = connection.Exec(ctx, string(index))
	connection.Release()
	if err != nil {
		t.Fatalf("synthetic concurrent index: %v", err)
	}
	cancel()
	scenarioCtx, scenarioCancel := context.WithTimeout(t.Context(), 5*time.Minute)
	t.Cleanup(scenarioCancel)
	fixture.ctx = scenarioCtx
	t.Log("synthetic setup complete; scenario budget started")
	return fixture
}

func installInactivityFactPolicyGate(fixture inactivityPostgresFixture) {
	fixture.t.Helper()
	migration, err := os.ReadFile("../../../../supabase/migrations/20261016164738_fence_stage_inactivity_fact_capture.sql")
	if err != nil {
		fixture.t.Fatal(err)
	}
	fixture.t.Log("synthetic setup: forward inactivity fact policy gate migration")
	fixture.exec(string(migration))
}

func inactivityFixtureDatabaseURL(dsn, databaseName string) (string, error) {
	if _, err := inactivityTestConfig(dsn); err != nil {
		return "", err
	}
	const prefix = "vimob_stage_inactivity_test_"
	if !strings.HasPrefix(databaseName, prefix) || len(databaseName) != len(prefix)+12 {
		return "", fmt.Errorf("database name is not owned by the inactivity fixture")
	}
	if _, err := hex.DecodeString(strings.TrimPrefix(databaseName, prefix)); err != nil {
		return "", fmt.Errorf("database suffix is not generated fixture identity")
	}
	target, err := url.Parse(dsn)
	if err != nil {
		return "", err
	}
	target.Path = "/" + databaseName
	config, err := pgx.ParseConfig(target.String())
	if err != nil || config.Database != databaseName || !inactivityLoopback(config.Host) {
		return "", fmt.Errorf("isolated database destination was overridden")
	}
	return target.String(), nil
}

func inactivityTestConfig(dsn string) (*pgx.ConnConfig, error) {
	invalid := fmt.Errorf("PIPELINE_INACTIVITY_TEST_DATABASE_URL must target a disposable loopback postgres/postgres server")
	target, err := url.Parse(dsn)
	if err != nil || (target.Scheme != "postgres" && target.Scheme != "postgresql") || target.User == nil ||
		target.User.Username() != "postgres" || target.Path != "/postgres" || !inactivityLoopback(target.Hostname()) {
		return nil, invalid
	}
	config, err := pgx.ParseConfig(dsn)
	if err != nil || config.User != "postgres" || config.Database != "postgres" || !inactivityLoopback(config.Host) {
		return nil, invalid
	}
	for _, fallback := range config.Fallbacks {
		if !inactivityLoopback(fallback.Host) {
			return nil, invalid
		}
	}
	return config, nil
}

func inactivityLoopback(host string) bool {
	return host == "127.0.0.1" || host == "localhost" || host == "::1"
}

func inactivityFixtureID(value int) string {
	return fmt.Sprintf("00000000-0000-4000-8000-%012d", value)
}

func (fixture inactivityPostgresFixture) exec(sql string, args ...any) {
	fixture.t.Helper()
	if fixture.seedTx != nil {
		if _, err := fixture.seedTx.Exec(fixture.ctx, sql, args...); err != nil {
			fixture.t.Fatalf("synthetic inactivity transaction SQL: %v", err)
		}
		return
	}
	if _, err := fixture.db.Pool().Exec(fixture.ctx, sql, args...); err != nil {
		fixture.t.Fatalf("synthetic inactivity SQL: %v", err)
	}
}

func (fixture inactivityPostgresFixture) count(sql string, args ...any) int {
	fixture.t.Helper()
	var count int
	if err := fixture.db.Pool().QueryRow(fixture.ctx, sql, args...).Scan(&count); err != nil {
		fixture.t.Fatalf("synthetic inactivity count: %v", err)
	}
	return count
}

func (fixture inactivityPostgresFixture) reset() {
	fixture.exec(`truncate public.organizations, public.pipelines, public.stages, public.stage_automations,
 public.leads, public.organization_members, public.users, public.organization_modules,
 public.lead_action_facts, public.lead_assignment_cycles, public.lead_stage_cycles,
 public.stage_operational_configs, public.notifications cascade`)
}

func (fixture inactivityPostgresFixture) seed(enabled bool, clock, startMode string) {
	tx, err := fixture.db.Pool().Begin(fixture.ctx)
	if err != nil {
		fixture.t.Fatal(err)
	}
	defer rollbackInactivityTransaction(tx)
	fixture.seedTx = tx
	for _, org := range []int{1, 2} {
		fixture.exec(`insert into public.organizations(id) values ($1); insert into public.pipelines(id,organization_id) values ($2,$1); insert into public.stages(id,organization_id,pipeline_id) values ($3,$1,$2); insert into public.organization_modules(organization_id,module_name,is_enabled) values ($1,'automations',true); insert into public.stage_automations(id,organization_id,stage_id) values ($4,$1,$3)`, inactivityFixtureID(org), inactivityFixtureID(100+org), inactivityFixtureID(200+org), inactivityFixtureID(300+org))
	}
	fixture.exec(`insert into public.users(id) values ($1),($2); insert into public.organization_members(organization_id,user_id) values ($3,$1),($3,$2),($4,$1)`, inactivityFixtureID(401), inactivityFixtureID(402), inactivityFixtureID(1), inactivityFixtureID(2))
	if enabled {
		fixture.exec(`insert into private.stage_inactivity_policies(automation_id,organization_id,stage_id,activation_epoch,revision,clock,start_mode,activated_at,automation_updated_at,interaction_coverage_from,duration_days,is_enabled)
 select id,organization_id,stage_id,$2::uuid,1,$3,$4,now()-interval '3 days',updated_at,now()-interval '12 days',1,true from public.stage_automations where id=$1::uuid`, inactivityFixtureID(301), inactivityFixtureID(601), clock, startMode)
	}
	fixture.exec(`insert into public.leads(id,organization_id,stage_id,pipeline_id,stage_entered_at,created_at,assigned_user_id)
 values ($1,$2,$3,$4,now()-interval '10 days',now()-interval '12 days',$5),($6,$7,$8,$9,now()-interval '10 days',now()-interval '12 days',$5)`, inactivityFixtureID(501), inactivityFixtureID(1), inactivityFixtureID(201), inactivityFixtureID(101), inactivityFixtureID(401), inactivityFixtureID(502), inactivityFixtureID(2), inactivityFixtureID(202), inactivityFixtureID(102))
	if err := tx.Commit(fixture.ctx); err != nil {
		fixture.t.Fatal(err)
	}
}

func (fixture inactivityPostgresFixture) scanNow() {
	fixture.exec(`update private.stage_inactivity_policies set next_scan_at=now()`)
}

func (fixture inactivityPostgresFixture) cycle() StageInactivityCycleResult {
	fixture.t.Helper()
	result, err := fixture.repo.ProcessStageInactivityOnce(fixture.ctx)
	if err != nil {
		fixture.t.Fatalf("candidate worker cycle: %v", err)
	}
	return result
}

func (fixture inactivityPostgresFixture) fact(org, lead, source int, inbound, automated bool, ago string) {
	fixture.exec(`select private.record_lead_action_fact($1::uuid,$2::uuid,$3::uuid,'synthetic_interaction','whatsapp',now()-$4::interval,$5,$6,false,true,false,'test',$7,'{}'::jsonb)`, inactivityFixtureID(org), inactivityFixtureID(lead), inactivityFixtureID(401), ago, automated, inbound, fmt.Sprint(source))
}

const inactivityPostgresSchema = `
create schema private;
create table public.organizations(id uuid primary key,is_active boolean default true);
create table public.pipelines(id uuid primary key,organization_id uuid not null,is_active boolean default true);
create table public.stages(id uuid primary key,organization_id uuid not null,pipeline_id uuid not null,is_active boolean default true);
create table public.stage_automations(id uuid primary key,organization_id uuid not null,stage_id uuid not null,trigger_type text not null default 'inactivity',is_active boolean default true,updated_at timestamptz not null default now());
create table public.users(id uuid primary key,is_active boolean default true);
create table public.organization_members(organization_id uuid not null,user_id uuid not null,membership_generation bigint not null default 1,is_active boolean default true,deleted_at timestamptz,primary key(organization_id,user_id));
create table public.organization_modules(organization_id uuid not null,module_name text not null,is_enabled boolean default true);
create table public.leads(id uuid primary key,organization_id uuid not null,stage_id uuid,pipeline_id uuid,stage_entered_at timestamptz,created_at timestamptz not null default now(),deal_status text not null default 'open',assigned_user_id uuid,attention_eligible boolean not null default false,operational_effects_suppressed boolean not null default false);
create function private.historical_import_effects_suppressed() returns boolean language sql as $$ select false $$;
create table public.stage_operational_configs(organization_id uuid,stage_id uuid,config jsonb default '{}',cadence_enabled boolean default false,attention_mode text default 'disabled');
create table public.lead_assignment_cycles(id uuid,organization_id uuid,lead_id uuid,ended_at timestamptz,assigned_at timestamptz);
create table public.lead_stage_cycles(id uuid,organization_id uuid,lead_id uuid,exited_at timestamptz,entered_at timestamptz);
create table public.lead_action_facts(id uuid primary key default gen_random_uuid(),organization_id uuid not null,lead_id uuid not null,actor_user_id uuid,assignment_cycle_id uuid,stage_cycle_id uuid,action_type text,channel text,occurred_at timestamptz not null,is_automated boolean not null default false,is_inbound boolean not null default false,qualifies_first_outreach boolean not null default false,qualifies_stage_inactivity boolean not null default false,is_effective_contact boolean not null default false,source_type text,source_id text,metadata jsonb);
create unique index synthetic_action_source on public.lead_action_facts(organization_id,source_type,source_id) where source_id is not null;
create index synthetic_action_last on public.lead_action_facts(organization_id,lead_id,occurred_at desc,id desc);
create table public.notifications(id uuid primary key default gen_random_uuid(),organization_id uuid not null,user_id uuid not null,title text not null,content text,body text,type text not null default 'info',channel text not null default 'in_app',lead_id uuid,target_url text,metadata jsonb not null default '{}',created_at timestamptz not null default now(),is_read boolean default false);
create unique index synthetic_notification_dedupe on public.notifications(organization_id,user_id,(metadata->>'dedupe_key')) where nullif(metadata->>'dedupe_key','') is not null;
`
