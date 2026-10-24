package roundrobin

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestMemberReadShowsRemovedEpochAsInactive(t *testing.T) {
	if os.Getenv("VIMOB_RUN_MEMBERSHIP_ACCESS_DB_TESTS") != "LOCAL_WRITE_TEST" {
		t.Skip("set VIMOB_RUN_MEMBERSHIP_ACCESS_DB_TESTS=LOCAL_WRITE_TEST and a disposable loopback PostgreSQL URL")
	}
	serverURL := strings.TrimSpace(os.Getenv("MEMBERSHIP_ACCESS_TEST_DATABASE_URL"))
	parsed, err := url.Parse(serverURL)
	if err != nil || parsed.User == nil || parsed.User.Username() != "postgres" || parsed.Path != "/postgres" || (parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "localhost") {
		t.Fatal("member read DB test requires a disposable loopback postgres/postgres URL")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	t.Cleanup(cancel)
	admin, err := pgx.Connect(ctx, serverURL)
	if err != nil {
		t.Fatalf("connect to disposable PostgreSQL: %v", err)
	}
	t.Cleanup(func() { _ = admin.Close(context.Background()) })
	for _, role := range []string{"anon", "authenticated", "service_role"} {
		statement := fmt.Sprintf(`do $body$ begin if not exists (select 1 from pg_roles where rolname = '%s') then create role %s nologin; end if; end $body$`, role, role)
		if _, err := admin.Exec(ctx, statement); err != nil {
			t.Fatalf("prepare disposable role %s: %v", role, err)
		}
	}
	var suffix [8]byte
	if _, err := rand.Read(suffix[:]); err != nil {
		t.Fatalf("generate disposable database name: %v", err)
	}
	name := "vimob_member_read_" + hex.EncodeToString(suffix[:])
	identifier := pgx.Identifier{name}.Sanitize()
	if _, err := admin.Exec(ctx, `create database `+identifier); err != nil {
		t.Fatalf("create disposable database: %v", err)
	}
	t.Cleanup(func() {
		dropCtx, dropCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer dropCancel()
		if _, err := admin.Exec(dropCtx, `drop database if exists `+identifier+` with (force)`); err != nil {
			t.Errorf("drop disposable database: %v", err)
		}
	})
	parsed.Path = "/" + name
	databaseURL := parsed.String()
	setup, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		t.Fatalf("connect to new disposable database: %v", err)
	}
	for _, path := range []string{
		filepath.Join("..", "users", "testdata", "membership_access_setup.sql"),
		filepath.Join("..", "..", "..", "..", "supabase", "migrations", "20261009030225_membership_access_generation.sql"),
	} {
		content, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		if _, err := setup.Exec(ctx, string(content), pgx.QueryExecModeSimpleProtocol); err != nil {
			t.Fatalf("execute %s: %v", path, err)
		}
	}
	// Member reads also project the queue revision introduced by
	// 20261012212832_management_revisions_and_create_intents.sql.
	if _, err := setup.Exec(ctx, `
		alter table public.round_robins add column revision bigint not null default 1;
		alter table public.round_robins add constraint round_robins_revision_safe_integer
		check (revision between 1 and 9007199254740991) not valid;
		alter table public.round_robins validate constraint round_robins_revision_safe_integer;
	`, pgx.QueryExecModeSimpleProtocol); err != nil {
		t.Fatalf("prepare disposable queue revision schema: %v", err)
	}
	if err := setup.Close(ctx); err != nil {
		t.Fatalf("close migration connection: %v", err)
	}
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, MaxConns: 4, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatalf("open disposable application pool: %v", err)
	}
	t.Cleanup(database.Close)
	newUUID := func() string {
		t.Helper()
		var value string
		if err := database.Pool().QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&value); err != nil {
			t.Fatalf("generate fixture UUID: %v", err)
		}
		return value
	}
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := database.Pool().Exec(ctx, sql, args...); err != nil {
			t.Fatalf("write synthetic member fixture: %v", err)
		}
	}
	organizationID, userID, teamID := newUUID(), newUUID(), newUUID()
	queueDirect, queueTeam := newUUID(), newUUID()
	exec(`insert into public.organizations (id, name) values ($1::uuid, 'Synthetic organization')`, organizationID)
	exec(`insert into public.users (id, organization_id, name) values ($1::uuid, $2::uuid, 'Synthetic user')`, userID, organizationID)
	exec(`insert into public.organization_members (organization_id, user_id) values ($1::uuid, $2::uuid)`, organizationID, userID)
	exec(`insert into public.teams (id, organization_id) values ($1::uuid, $2::uuid)`, teamID, organizationID)
	exec(`insert into public.team_members (team_id, organization_id, user_id) values ($1::uuid, $2::uuid, $3::uuid)`, teamID, organizationID, userID)
	for _, queueID := range []string{queueDirect, queueTeam} {
		exec(`insert into public.round_robins (id, organization_id) values ($1::uuid, $2::uuid)`, queueID, organizationID)
	}
	var directEntryID, teamEntryID string
	if err := database.Pool().QueryRow(ctx, `insert into public.round_robin_members (round_robin_id, organization_id, user_id) values ($1::uuid, $2::uuid, $3::uuid) returning id::text`, queueDirect, organizationID, userID).Scan(&directEntryID); err != nil {
		t.Fatalf("insert direct queue entry: %v", err)
	}
	if err := database.Pool().QueryRow(ctx, `insert into public.round_robin_members (round_robin_id, organization_id, team_id) values ($1::uuid, $2::uuid, $3::uuid) returning id::text`, queueTeam, organizationID, teamID).Scan(&teamEntryID); err != nil {
		t.Fatalf("insert team queue entry: %v", err)
	}
	repository := NewRepository(database)
	assertRead := func(entryID, queueID string, want bool) {
		t.Helper()
		members, err := listMembersWithQueryer(ctx, database.Pool(), organizationID, &queueID)
		if err != nil || len(members) != 1 || members[0].ID != entryID || members[0].IsActive != want {
			t.Fatalf("list queue member=%#v err=%v, want entry %s active=%t", members, err, entryID, want)
		}
		member, err := repository.getMember(ctx, organizationID, entryID)
		if err != nil || member.IsActive != want {
			t.Fatalf("get queue member=%#v err=%v, want active=%t", member, err, want)
		}
	}
	assertRead(directEntryID, queueDirect, true)
	assertRead(teamEntryID, queueTeam, true)
	exec(`update public.organization_members set is_active = false, deleted_at = now() where organization_id = $1::uuid and user_id = $2::uuid`, organizationID, userID)
	exec(`update public.organization_members set is_active = true, deleted_at = null where organization_id = $1::uuid and user_id = $2::uuid`, organizationID, userID)
	assertRead(directEntryID, queueDirect, false)
	assertRead(teamEntryID, queueTeam, false)
	exec(`update public.round_robin_members set weight = 2, position = 1 where id = $1::uuid`, directEntryID)
	assertRead(directEntryID, queueDirect, false)
	exec(`update public.round_robin_members set is_active = true where id = $1::uuid`, directEntryID)
	assertRead(directEntryID, queueDirect, true)
	exec(`update public.team_members set is_active = true where team_id = $1::uuid`, teamID)
	assertRead(teamEntryID, queueTeam, true)
}
