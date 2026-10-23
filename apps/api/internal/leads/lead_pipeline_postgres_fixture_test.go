package leads

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

// This fixture executes the actual Pipeline queries in a random owned database.
// It deliberately ignores DATABASE_URL, uses no migrations or real credentials,
// and can only connect to the explicitly selected disposable loopback server.
func openLeadPipelinePostgresFixture(t *testing.T) (context.Context, *pgx.Conn) {
	t.Helper()
	if os.Getenv("VIMOB_RUN_STAGE_ARCHIVE_DB_TESTS") != "LOCAL_WRITE_TEST" {
		t.Skip("opt in to the disposable Pipeline PostgreSQL server")
	}
	config, err := leadPipelineTestConfig(strings.TrimSpace(os.Getenv("PIPELINE_ARCHIVE_TEST_DATABASE_URL")))
	if err != nil {
		t.Fatal(err)
	}
	// Windows may spend substantial time copying/fsyncing a fresh database.
	// Setup has its own bound; query execution below still gets a separate minute.
	ctx, cancel := context.WithTimeout(t.Context(), 3*time.Minute)
	t.Cleanup(cancel)
	admin, err := pgx.ConnectConfig(ctx, config)
	if err != nil {
		t.Fatal("cannot connect to the explicitly selected disposable PostgreSQL server")
	}
	var suffix [6]byte
	if _, err := rand.Read(suffix[:]); err != nil {
		_ = admin.Close(ctx)
		t.Fatal("cannot generate disposable database name")
	}
	quoted := pgx.Identifier{"vimob_lead_pipeline_test_" + hex.EncodeToString(suffix[:])}.Sanitize()
	if _, err := admin.Exec(ctx, "create database "+quoted); err != nil {
		_ = admin.Close(ctx)
		t.Fatal("cannot create the owned disposable database")
	}
	var conn *pgx.Conn
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cleanupCancel()
		if conn != nil {
			if err := conn.Close(cleanupCtx); err != nil {
				t.Errorf("close synthetic query connection: %v", err)
			}
		}
		if _, err := admin.Exec(cleanupCtx, "drop database "+quoted); err != nil {
			t.Errorf("drop owned synthetic database: %v", err)
		}
		if err := admin.Close(cleanupCtx); err != nil {
			t.Errorf("close local test admin connection: %v", err)
		}
	})
	config = config.Copy()
	config.Database = strings.Trim(quoted, `"`)
	conn, err = pgx.ConnectConfig(ctx, config)
	if err != nil {
		t.Fatal("cannot connect to the owned synthetic database")
	}
	for _, statement := range leadPipelinePostgresSchema {
		if _, err := conn.Exec(ctx, statement); err != nil {
			t.Fatalf("create minimal Pipeline query schema: %v", err)
		}
	}
	queryCtx, queryCancel := context.WithTimeout(t.Context(), time.Minute)
	t.Cleanup(queryCancel)
	return queryCtx, conn
}

func leadPipelineTestConfig(dsn string) (*pgx.ConnConfig, error) {
	invalid := fmt.Errorf("Pipeline query tests require a disposable loopback postgres/postgres URL")
	parsed, err := url.Parse(dsn)
	loopback := func(host string) bool { return host == "127.0.0.1" || host == "localhost" || host == "::1" }
	if err != nil || (parsed.Scheme != "postgres" && parsed.Scheme != "postgresql") || parsed.User == nil ||
		parsed.User.Username() != "postgres" || parsed.Path != "/postgres" || !loopback(parsed.Hostname()) {
		return nil, invalid
	}
	config, err := pgx.ParseConfig(dsn)
	if err != nil || config.User != "postgres" || config.Database != "postgres" || !loopback(config.Host) {
		return nil, invalid
	}
	for _, fallback := range config.Fallbacks {
		if !loopback(fallback.Host) {
			return nil, invalid
		}
	}
	return config, nil
}

// These tables mirror only the columns consumed by the production read SQL.
// This verifies SQL syntax/projection/tenant boundaries, not deployed RLS/schema.
var leadPipelinePostgresSchema = []string{
	`create table public.users(id uuid primary key, organization_id uuid, role text default 'user',
	 name text, email text, avatar_url text, is_active boolean default true)`,
	`create table public.organization_members(organization_id uuid not null, user_id uuid not null,
	 is_active boolean default true, deleted_at timestamptz, membership_generation bigint not null default 1)`,
	`create table public.teams(id uuid primary key, organization_id uuid not null, is_active boolean default true)`,
	`create table public.team_members(organization_id uuid not null, team_id uuid not null, user_id uuid not null,
	 membership_generation bigint not null default 1, is_active boolean default true, is_leader boolean default false)`,
	`create table public.stages(id uuid primary key, organization_id uuid not null, name text)`,
	`create table public.leads(id uuid primary key, organization_id uuid not null, source text, utm_source text,
	 assigned_user_id uuid, assigned_at timestamptz, first_response_at timestamptz,
	 first_response_seconds integer, first_response_channel text, first_response_is_automation boolean,
	 first_response_actor_user_id uuid, created_at timestamptz)`,
	`create table public.lead_timeline_events(id uuid primary key, organization_id uuid not null, lead_id uuid,
	 user_id uuid, actor_user_id uuid, event_at timestamptz, event_type text, metadata jsonb, created_at timestamptz)`,
	`create table public.activities(id uuid primary key, organization_id uuid not null, lead_id uuid,
	 user_id uuid, type text, metadata jsonb, created_at timestamptz)`,
	`create table public.lead_entry_events(id uuid primary key, organization_id uuid not null, lead_id uuid,
	 property_id uuid, metadata jsonb, payload jsonb, created_at timestamptz)`,
	`create table public.round_robins(id uuid primary key, organization_id uuid not null, name text)`,
	`create table public.round_robin_logs(id uuid primary key, organization_id uuid not null, lead_id uuid,
	 round_robin_id uuid, assigned_user_id uuid, created_at timestamptz)`,
	`create table public.assignments_log(id uuid primary key, organization_id uuid not null, lead_id uuid,
	 old_user_id uuid, new_user_id uuid, reason text, created_by uuid, created_at timestamptz)`,
	`create table public.audit_logs(id uuid primary key, organization_id uuid not null, user_id uuid,
	 action text, entity_type text, entity_id uuid, old_data jsonb, new_data jsonb, created_at timestamptz)`,
	`create table public.lead_meta(id uuid primary key, organization_id uuid not null, lead_id uuid,
	 page_id text, form_id text, form_name text, ad_id text, ad_name text, adset_id text, adset_name text,
	 campaign_id text, campaign_name text, platform text, source_type text, creative_url text,
	 creative_video_url text, creative_instagram_url text, raw_payload jsonb, payload jsonb,
	 created_at timestamptz, updated_at timestamptz)`,
	`create table public.tags(id uuid primary key, organization_id uuid not null, name text, color text)`,
	`create table public.lead_tags(organization_id uuid not null, lead_id uuid not null, tag_id uuid not null,
	 created_at timestamptz)`,
}

func pipelinePostgresID(value int) string {
	return fmt.Sprintf("00000000-0000-4000-8000-%012d", value)
}

func pipelinePostgresExec(t *testing.T, ctx context.Context, conn *pgx.Conn, sql string, args ...any) {
	t.Helper()
	if _, err := conn.Exec(ctx, sql, args...); err != nil {
		t.Fatalf("seed synthetic Pipeline data: %v", err)
	}
}
