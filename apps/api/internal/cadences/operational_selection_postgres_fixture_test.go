package cadences

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type operationalSelectionFixture struct {
	t    *testing.T
	ctx  context.Context
	conn *pgx.Conn
	db   *dbpkg.Postgres
	repo Repository
}

func operationalSelectionID(n int) string { return fmt.Sprintf("00000000-0000-4000-8000-%012d", n) }

// A separate explicit opt-in protects existing application databases. Only a
// generated owned database on a postgres/postgres loopback admin is modified.
func openOperationalSelectionFixture(t *testing.T) operationalSelectionFixture {
	t.Helper()
	if os.Getenv("VIMOB_RUN_CADENCE_SELECTION_DB_TESTS") != "LOCAL_WRITE_TEST" {
		t.Skip("set VIMOB_RUN_CADENCE_SELECTION_DB_TESTS=LOCAL_WRITE_TEST and CADENCE_SELECTION_TEST_DATABASE_URL for an owned disposable database")
	}
	dsn := strings.TrimSpace(os.Getenv("CADENCE_SELECTION_TEST_DATABASE_URL"))
	u, err := url.Parse(dsn)
	loopback := func(host string) bool { return host == "localhost" || host == "127.0.0.1" || host == "::1" }
	if err != nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") || u.User == nil || u.User.Username() != "postgres" || u.Path != "/postgres" || !loopback(u.Hostname()) {
		t.Fatal("cadence selection requires loopback postgres/postgres URL")
	}
	config, err := pgx.ParseConfig(dsn)
	if err != nil || config.User != "postgres" || config.Database != "postgres" || !loopback(config.Host) {
		t.Fatal("invalid effective cadence selection target")
	}
	for _, fallback := range config.Fallbacks {
		if !loopback(fallback.Host) {
			t.Fatal("non-loopback fallback")
		}
	}
	ctx, cancel := context.WithTimeout(t.Context(), 60*time.Second)
	t.Cleanup(cancel)
	admin, err := pgx.ConnectConfig(ctx, config)
	if err != nil {
		t.Fatal("connect to explicitly selected disposable server")
	}
	var database, user string
	if err := admin.QueryRow(ctx, `select current_database(),current_user`).Scan(&database, &user); err != nil || database != "postgres" || user != "postgres" {
		_ = admin.Close(ctx)
		t.Fatal("effective admin must be postgres/postgres")
	}
	var random [6]byte
	if _, err := rand.Read(random[:]); err != nil {
		_ = admin.Close(ctx)
		t.Fatal(err)
	}
	name := "vimob_cadence_selection_" + hex.EncodeToString(random[:])
	quoted := pgx.Identifier{name}.Sanitize()
	if _, err := admin.Exec(ctx, "create database "+quoted); err != nil {
		_ = admin.Close(ctx)
		t.Fatal(err)
	}
	var conn *pgx.Conn
	t.Cleanup(func() {
		clean, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if conn != nil {
			if err := conn.Close(clean); err != nil {
				t.Error(err)
			}
		}
		if _, err := admin.Exec(clean, "drop database "+quoted); err != nil {
			t.Error(err)
		}
		if err := admin.Close(clean); err != nil {
			t.Error(err)
		}
	})
	owned := config.Copy()
	owned.Database = name
	conn, err = pgx.ConnectConfig(ctx, owned)
	if err != nil {
		t.Fatal(err)
	}
	if err := conn.QueryRow(ctx, `select current_database()`).Scan(&database); err != nil || database != name {
		t.Fatal("fixture escaped owned database")
	}
	poolURL := url.URL{Scheme: "postgres", User: url.User("postgres"), Host: net.JoinHostPort(config.Host, strconv.Itoa(int(config.Port))), Path: "/" + name, RawQuery: "sslmode=disable"}
	pool, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: poolURL.String(), MaxConns: 4, HealthTimeout: 2 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Pool().QueryRow(ctx, `select current_database()`).Scan(&database); err != nil || database != name {
		t.Fatal("pool escaped owned database")
	}
	f := operationalSelectionFixture{t: t, ctx: ctx, conn: conn, db: pool, repo: NewRepository(pool)}
	f.exec(`create table public.pipelines(id uuid primary key,organization_id uuid not null);
 create table public.stages(id uuid primary key,organization_id uuid not null,pipeline_id uuid not null references public.pipelines(id),stage_key text,name text);
 create table public.stage_operational_configs(organization_id uuid,stage_id uuid,cadence_enabled boolean,revision bigint,
 attention_mode text,first_outreach_minutes int,first_effective_contact_minutes int,stage_inactivity_minutes int,stage_max_age_minutes int,
 warning_minutes int,escalation_minutes int,business_hours_only boolean,config jsonb);
 create table public.cadence_templates(id uuid primary key,organization_id uuid not null,stage_id uuid,pipeline_id uuid,stage_key text,is_active boolean,updated_at timestamptz default now());
 create table public.cadence_tasks_template(id uuid primary key default gen_random_uuid(),organization_id uuid,cadence_template_id uuid,position int,type text,
 title text,description text,observation text,recommended_message text,due_minutes int,delay_days int,warning_minutes int,is_required boolean,outcome_required boolean,created_at timestamptz default now());
 insert into public.pipelines values($1,$2),($3,$4),($5,$2);
 insert into public.stages values($6,$2,$1,'contacted','Stage'),($7,$4,$3,'contacted','Foreign');
 insert into public.stage_operational_configs(organization_id,stage_id,cadence_enabled,revision,config) values($2,$6,true,0,'{}');`,
		operationalSelectionID(101), operationalSelectionID(1), operationalSelectionID(111), operationalSelectionID(2), operationalSelectionID(102), operationalSelectionID(201), operationalSelectionID(211))
	return f
}

func (f operationalSelectionFixture) exec(sql string, args ...any) {
	f.t.Helper()
	if _, err := f.conn.Exec(f.ctx, sql, append([]any{pgx.QueryExecModeSimpleProtocol}, args...)...); err != nil {
		f.t.Fatal(err)
	}
}

func (f operationalSelectionFixture) template(id, org, stage, pipeline int, active, task bool, title string) {
	f.t.Helper()
	var stageID, pipelineID any
	if stage > 0 {
		stageID = operationalSelectionID(stage)
	}
	if pipeline > 0 {
		pipelineID = operationalSelectionID(pipeline)
	}
	f.exec(`insert into public.cadence_templates(id,organization_id,stage_id,pipeline_id,stage_key,is_active) values($1,$2,$3,$4,'contacted',$5)`, operationalSelectionID(id), operationalSelectionID(org), stageID, pipelineID, active)
	if task {
		f.exec(`insert into public.cadence_tasks_template(organization_id,cadence_template_id,position,type,title,due_minutes) values($1,$2,1,'call',$3,10)`, operationalSelectionID(org), operationalSelectionID(id), title)
	}
}

func (f operationalSelectionFixture) rules() OperationalRules {
	f.t.Helper()
	stage, err := f.repo.loadOperationalStage(f.ctx, f.conn, operationalSelectionID(1), operationalSelectionID(201), false)
	if err != nil {
		f.t.Fatal(err)
	}
	rules, err := f.repo.loadOperationalRules(f.ctx, f.conn, operationalSelectionID(1), stage)
	if err != nil {
		f.t.Fatal(err)
	}
	return rules
}
