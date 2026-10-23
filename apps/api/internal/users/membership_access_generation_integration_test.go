package users

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

const membershipAccessDBTestGuard = "LOCAL_WRITE_TEST"

func TestMembershipRemovalDoesNotRestoreOldAccessAcrossOrganizations(t *testing.T) {
	database, ctx := openDisposableMembershipAccessDatabase(t)
	organizationA := lifecycleUUID(t)
	organizationB := lifecycleUUID(t)
	actorID := lifecycleUUID(t)
	userID := lifecycleUUID(t)
	teamA := lifecycleUUID(t)
	teamB := lifecycleUUID(t)
	queueA := lifecycleUUID(t)
	queueATeam := lifecycleUUID(t)
	queueB := lifecycleUUID(t)
	queueANew := lifecycleUUID(t)

	for _, organization := range []string{organizationA, organizationB} {
		mustMembershipExec(t, ctx, database, `insert into public.organizations (id, name) values ($1::uuid, $2)`, organization, "Synthetic organization")
	}
	for _, user := range []string{actorID, userID} {
		mustMembershipExec(t, ctx, database, `insert into public.users (id, organization_id, name, email) values ($1::uuid, $2::uuid, $3, $4)`, user, organizationA, "Synthetic user", user+"@example.test")
	}
	mustMembershipExec(t, ctx, database, `insert into public.organization_members (organization_id, user_id, role) values ($1::uuid, $2::uuid, 'owner')`, organizationA, actorID)
	for _, organization := range []string{organizationA, organizationB} {
		mustMembershipExec(t, ctx, database, `insert into public.organization_members (organization_id, user_id, role) values ($1::uuid, $2::uuid, 'user')`, organization, userID)
	}
	for _, pair := range [][2]string{{teamA, organizationA}, {teamB, organizationB}} {
		mustMembershipExec(t, ctx, database, `insert into public.teams (id, organization_id) values ($1::uuid, $2::uuid)`, pair[0], pair[1])
		var teamMemberID string
		if err := database.Pool().QueryRow(ctx, `insert into public.team_members (team_id, organization_id, user_id) values ($1::uuid, $2::uuid, $3::uuid) returning id::text`, pair[0], pair[1], userID).Scan(&teamMemberID); err != nil {
			t.Fatalf("insert synthetic team membership: %v", err)
		}
		mustMembershipExec(t, ctx, database, `insert into public.member_availability (organization_id, team_member_id, day_of_week, is_all_day, is_active) values ($1::uuid, $2::uuid, 4, true, true)`, pair[1], teamMemberID)
		mustMembershipExec(t, ctx, database, `insert into public.user_organization_roles (organization_id, user_id) values ($1::uuid, $2::uuid)`, pair[1], userID)
		mustMembershipExec(t, ctx, database, `insert into public.user_permission_overrides (organization_id, user_id, permission_key, allowed) values ($1::uuid, $2::uuid, 'synthetic_permission', true)`, pair[1], userID)
	}
	for _, pair := range [][2]string{{queueA, organizationA}, {queueATeam, organizationA}, {queueB, organizationB}, {queueANew, organizationA}} {
		mustMembershipExec(t, ctx, database, `insert into public.round_robins (id, organization_id) values ($1::uuid, $2::uuid)`, pair[0], pair[1])
	}
	for _, pair := range [][2]string{{queueA, organizationA}, {queueB, organizationB}} {
		mustMembershipExec(t, ctx, database, `insert into public.round_robin_members (round_robin_id, organization_id, user_id) values ($1::uuid, $2::uuid, $3::uuid)`, pair[0], pair[1], userID)
	}
	mustMembershipExec(t, ctx, database, `insert into public.round_robin_members (round_robin_id, organization_id, team_id) values ($1::uuid, $2::uuid, $3::uuid)`, queueATeam, organizationA, teamA)
	mustMembershipExec(t, ctx, database, `insert into private.pending_queue (organization_id, round_robin_id) values ($1::uuid, $2::uuid)`, organizationA, queueA)
	mustMembershipExec(t, ctx, database, `insert into private.pending_queue (organization_id, round_robin_id) values ($1::uuid, $2::uuid)`, organizationA, queueATeam)
	assertMembershipPicker(t, ctx, database, organizationA, queueA, userID)
	assertMembershipPicker(t, ctx, database, organizationA, queueATeam, userID)
	assertMembershipPicker(t, ctx, database, organizationB, queueB, userID)

	repo := NewRepository(database, AuthAdminConfig{})
	actor := tenant.Context{
		OrganizationID: organizationA,
		UserID:         actorID,
		MemberRole:     "owner",
		Permissions:    []string{permissions.UsersManage, permissions.PermissionsManage},
	}
	impact, err := repo.GetDeleteUserImpact(ctx, actor, userID)
	if err != nil {
		t.Fatalf("get removal impact: %v", err)
	}
	if impact.Teams != 1 || impact.CustomRoles != 1 || impact.PermissionOverrides != 1 || impact.RoundRobinEntries != 1 {
		t.Fatalf("unexpected access impact: %#v", impact)
	}
	// Fail after the role and override mutations to prove the whole removal
	// transaction rolls back before retrying against the real queue guard.
	mustMembershipExec(t, ctx, database, `
		create function private.reject_synthetic_team_delete() returns trigger
		language plpgsql as $body$ begin raise exception using errcode = '55000', message = 'synthetic_team_delete_failure'; end $body$
	`)
	mustMembershipExec(t, ctx, database, `create trigger reject_synthetic_team_delete before delete on public.team_members for each row execute function private.reject_synthetic_team_delete()`)
	if _, err := repo.DeleteOrganizationUser(ctx, actor, userID, DeleteUserInput{}); !isMembershipPgCode(err, "55000") {
		t.Fatalf("forced team delete failure=%v, want 55000", err)
	}
	assertMembershipNumber(t, ctx, database, `select count(*) from public.organization_members where organization_id = $1::uuid and user_id = $2::uuid and is_active and deleted_at is null`, 1, organizationA, userID)
	assertMembershipNumber(t, ctx, database, `select count(*) from public.user_organization_roles where organization_id = $1::uuid and user_id = $2::uuid and is_active`, 1, organizationA, userID)
	assertMembershipNumber(t, ctx, database, `select count(*) from public.user_permission_overrides where organization_id = $1::uuid and user_id = $2::uuid`, 1, organizationA, userID)
	assertMembershipPicker(t, ctx, database, organizationA, queueA, userID)
	mustMembershipExec(t, ctx, database, `drop trigger reject_synthetic_team_delete on public.team_members`)
	mustMembershipExec(t, ctx, database, `drop function private.reject_synthetic_team_delete()`)
	if _, err := repo.DeleteOrganizationUser(ctx, actor, userID, DeleteUserInput{}); err != nil {
		t.Fatalf("remove membership while WhatsApp queue snapshot is pending: %v", err)
	}
	assertMembershipPicker(t, ctx, database, organizationA, queueA, "")
	assertMembershipPicker(t, ctx, database, organizationA, queueATeam, "")
	assertMembershipPicker(t, ctx, database, organizationB, queueB, userID)
	assertMembershipNumber(t, ctx, database, `select count(*) from public.round_robin_members where round_robin_id = $1::uuid and user_id = $2::uuid`, 1, queueA, userID)
	assertMembershipNumber(t, ctx, database, `select count(*) from public.round_robin_members where round_robin_id = $1::uuid and team_id = $2::uuid`, 1, queueATeam, teamA)
	assertMembershipNumber(t, ctx, database, `select count(*) from public.team_members where organization_id = $1::uuid and user_id = $2::uuid`, 0, organizationA, userID)
	assertMembershipNumber(t, ctx, database, `select count(*) from public.team_members where organization_id = $1::uuid and user_id = $2::uuid`, 1, organizationB, userID)
	assertMembershipNumber(t, ctx, database, `select count(*) from public.member_availability where organization_id = $1::uuid`, 0, organizationA)
	assertMembershipNumber(t, ctx, database, `select count(*) from public.member_availability where organization_id = $1::uuid`, 1, organizationB)
	assertMembershipNumber(t, ctx, database, `select count(*) from public.user_organization_roles where organization_id = $1::uuid and user_id = $2::uuid and is_active`, 0, organizationA, userID)
	assertMembershipNumber(t, ctx, database, `select count(*) from public.user_organization_roles where organization_id = $1::uuid and user_id = $2::uuid and is_active`, 1, organizationB, userID)
	assertMembershipNumber(t, ctx, database, `select count(*) from public.user_permission_overrides where organization_id = $1::uuid and user_id = $2::uuid`, 0, organizationA, userID)
	assertMembershipNumber(t, ctx, database, `select count(*) from public.user_permission_overrides where organization_id = $1::uuid and user_id = $2::uuid`, 1, organizationB, userID)
	var canonicalOrganization string
	var globallyActive bool
	if err := database.Pool().QueryRow(ctx, `select organization_id::text, is_active from public.users where id = $1::uuid`, userID).Scan(&canonicalOrganization, &globallyActive); err != nil {
		t.Fatalf("read canonical user: %v", err)
	}
	if canonicalOrganization != organizationB || !globallyActive {
		t.Fatalf("canonical organization=%s globally active=%t, want B and true", canonicalOrganization, globallyActive)
	}
	if _, err := database.Pool().Exec(ctx, `delete from public.round_robin_members where round_robin_id = $1::uuid and user_id = $2::uuid`, queueA, userID); !isMembershipPgCode(err, "55000") {
		t.Fatalf("pending WhatsApp guard error=%v, want 55000", err)
	}
	if _, err := database.Pool().Exec(ctx, `delete from public.round_robin_members where round_robin_id = $1::uuid and team_id = $2::uuid`, queueATeam, teamA); !isMembershipPgCode(err, "55000") {
		t.Fatalf("pending WhatsApp team queue guard error=%v, want 55000", err)
	}

	// Simulate a proven invitation without restoring any access from the old epoch.
	mustMembershipExec(t, ctx, database, `
		insert into public.organization_members (organization_id, user_id, role, is_active)
		values ($1::uuid, $2::uuid, 'admin', true)
		on conflict (user_id, organization_id) do update set
		  role = excluded.role, is_active = true, deleted_at = null
	`, organizationA, userID)
	assertMembershipNumber(t, ctx, database, `select membership_generation from public.organization_members where organization_id = $1::uuid and user_id = $2::uuid`, 2, organizationA, userID)
	assertMembershipPicker(t, ctx, database, organizationA, queueA, "")
	assertMembershipPicker(t, ctx, database, organizationA, queueATeam, "")
	assertMembershipPicker(t, ctx, database, organizationB, queueB, userID)
	mustMembershipExec(t, ctx, database, `insert into public.round_robin_members (round_robin_id, organization_id, user_id) values ($1::uuid, $2::uuid, $3::uuid)`, queueANew, organizationA, userID)
	assertMembershipNumber(t, ctx, database, `select membership_generation from public.round_robin_members where round_robin_id = $1::uuid and user_id = $2::uuid`, 2, queueANew, userID)
	assertMembershipPicker(t, ctx, database, organizationA, queueANew, userID)
	mustMembershipExec(t, ctx, database, `update public.organization_members set is_active = false where organization_id = $1::uuid and user_id = $2::uuid`, organizationA, userID)
	assertMembershipPicker(t, ctx, database, organizationA, queueANew, "")
	mustMembershipExec(t, ctx, database, `update public.organization_members set is_active = true where organization_id = $1::uuid and user_id = $2::uuid`, organizationA, userID)
	assertMembershipNumber(t, ctx, database, `select membership_generation from public.organization_members where organization_id = $1::uuid and user_id = $2::uuid`, 2, organizationA, userID)
	assertMembershipPicker(t, ctx, database, organizationA, queueANew, userID)
	mustMembershipExec(t, ctx, database, `update public.users set is_active = false where id = $1::uuid`, userID)
	assertMembershipPicker(t, ctx, database, organizationA, queueANew, "")
	assertMembershipPicker(t, ctx, database, organizationB, queueB, "")
}

func TestMembershipRemovalSerializesNewQueueAndTeamParticipants(t *testing.T) {
	database, ctx := openDisposableMembershipAccessDatabase(t)
	organizationID := lifecycleUUID(t)
	userID := lifecycleUUID(t)
	teamID := lifecycleUUID(t)
	queueID := lifecycleUUID(t)
	mustMembershipExec(t, ctx, database, `insert into public.organizations (id, name) values ($1::uuid, 'Synthetic organization')`, organizationID)
	mustMembershipExec(t, ctx, database, `insert into public.users (id, organization_id, name) values ($1::uuid, $2::uuid, 'Synthetic user')`, userID, organizationID)
	mustMembershipExec(t, ctx, database, `insert into public.organization_members (organization_id, user_id) values ($1::uuid, $2::uuid)`, organizationID, userID)
	mustMembershipExec(t, ctx, database, `insert into public.teams (id, organization_id) values ($1::uuid, $2::uuid)`, teamID, organizationID)
	mustMembershipExec(t, ctx, database, `insert into public.round_robins (id, organization_id) values ($1::uuid, $2::uuid)`, queueID, organizationID)

	tx, err := database.Pool().Begin(ctx)
	if err != nil {
		t.Fatalf("begin removal transaction: %v", err)
	}
	defer tx.Rollback(context.Background())
	if err := lockCanonicalUserAccess(ctx, tx, userID); err != nil {
		t.Fatalf("lock canonical user: %v", err)
	}
	if _, err := organizationMemberRoleForUpdate(ctx, tx, organizationID, userID); err != nil {
		t.Fatalf("lock organization membership: %v", err)
	}
	results := make(chan error, 2)
	go func() {
		_, insertErr := database.Pool().Exec(ctx, `insert into public.team_members (team_id, organization_id, user_id) values ($1::uuid, $2::uuid, $3::uuid)`, teamID, organizationID, userID)
		results <- insertErr
	}()
	go func() {
		_, insertErr := database.Pool().Exec(ctx, `insert into public.round_robin_members (round_robin_id, organization_id, user_id) values ($1::uuid, $2::uuid, $3::uuid)`, queueID, organizationID, userID)
		results <- insertErr
	}()
	select {
	case result := <-results:
		t.Fatalf("participant insert completed before membership removal: %v", result)
	case <-time.After(150 * time.Millisecond):
	}
	if _, err := tx.Exec(ctx, `update public.organization_members set is_active = false, deleted_at = now() where organization_id = $1::uuid and user_id = $2::uuid`, organizationID, userID); err != nil {
		t.Fatalf("tombstone membership: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit membership removal: %v", err)
	}
	for range 2 {
		select {
		case result := <-results:
			if !isMembershipPgCode(result, "23514") {
				t.Fatalf("concurrent participant insert error=%v, want 23514", result)
			}
		case <-ctx.Done():
			t.Fatalf("wait for concurrent participant inserts: %v", ctx.Err())
		}
	}
	assertMembershipNumber(t, ctx, database, `select count(*) from public.team_members where user_id = $1::uuid`, 0, userID)
	assertMembershipNumber(t, ctx, database, `select count(*) from public.round_robin_members where user_id = $1::uuid`, 0, userID)
}

func TestLegacyParticipantsRemainIneligibleAfterReinvite(t *testing.T) {
	database, ctx := openDisposableMembershipAccessDatabase(t)
	organizationID := lifecycleUUID(t)
	userID := lifecycleUUID(t)
	teamID := lifecycleUUID(t)
	queueDirect := lifecycleUUID(t)
	queueTeam := lifecycleUUID(t)
	mustMembershipExec(t, ctx, database, `insert into public.organizations (id, name) values ($1::uuid, 'Synthetic organization')`, organizationID)
	mustMembershipExec(t, ctx, database, `insert into public.users (id, organization_id, name) values ($1::uuid, $2::uuid, 'Synthetic user')`, userID, organizationID)
	mustMembershipExec(t, ctx, database, `insert into public.organization_members (organization_id, user_id) values ($1::uuid, $2::uuid)`, organizationID, userID)
	mustMembershipExec(t, ctx, database, `insert into public.teams (id, organization_id) values ($1::uuid, $2::uuid)`, teamID, organizationID)
	mustMembershipExec(t, ctx, database, `insert into public.team_members (team_id, organization_id, user_id) values ($1::uuid, $2::uuid, $3::uuid)`, teamID, organizationID, userID)
	for _, queueID := range []string{queueDirect, queueTeam} {
		mustMembershipExec(t, ctx, database, `insert into public.round_robins (id, organization_id) values ($1::uuid, $2::uuid)`, queueID, organizationID)
	}
	mustMembershipExec(t, ctx, database, `insert into public.round_robin_members (round_robin_id, organization_id, user_id) values ($1::uuid, $2::uuid, $3::uuid)`, queueDirect, organizationID, userID)
	mustMembershipExec(t, ctx, database, `insert into public.round_robin_members (round_robin_id, organization_id, team_id) values ($1::uuid, $2::uuid, $3::uuid)`, queueTeam, organizationID, teamID)
	assertMembershipPicker(t, ctx, database, organizationID, queueDirect, userID)
	assertMembershipPicker(t, ctx, database, organizationID, queueTeam, userID)

	// Legacy removals could leave both participant rows behind. The generation
	// fence must protect them even before a newer API cleans team membership.
	mustMembershipExec(t, ctx, database, `update public.organization_members set is_active = false, deleted_at = now() where organization_id = $1::uuid and user_id = $2::uuid`, organizationID, userID)
	mustMembershipExec(t, ctx, database, `update public.organization_members set is_active = true, deleted_at = null where organization_id = $1::uuid and user_id = $2::uuid`, organizationID, userID)
	assertMembershipNumber(t, ctx, database, `select membership_generation from public.organization_members where organization_id = $1::uuid and user_id = $2::uuid`, 2, organizationID, userID)
	assertMembershipPicker(t, ctx, database, organizationID, queueDirect, "")
	assertMembershipPicker(t, ctx, database, organizationID, queueTeam, "")

	// Explicit participant re-enrollment binds it to the current generation.
	mustMembershipExec(t, ctx, database, `update public.round_robin_members set weight = 2, position = 1 where round_robin_id = $1::uuid`, queueDirect)
	assertMembershipPicker(t, ctx, database, organizationID, queueDirect, "")
	mustMembershipExec(t, ctx, database, `update public.round_robin_members set is_active = true where round_robin_id = $1::uuid`, queueDirect)
	assertMembershipPicker(t, ctx, database, organizationID, queueDirect, userID)
	mustMembershipExec(t, ctx, database, `update public.team_members set is_active = true where team_id = $1::uuid`, teamID)
	assertMembershipPicker(t, ctx, database, organizationID, queueTeam, userID)

	// A historical hard delete may leave queue/team rows without a membership
	// row. A fresh INSERT must choose a generation above those orphan rows.
	mustMembershipExec(t, ctx, database, `delete from public.organization_members where organization_id = $1::uuid and user_id = $2::uuid`, organizationID, userID)
	mustMembershipExec(t, ctx, database, `insert into public.organization_members (organization_id, user_id) values ($1::uuid, $2::uuid)`, organizationID, userID)
	assertMembershipNumber(t, ctx, database, `select membership_generation from public.organization_members where organization_id = $1::uuid and user_id = $2::uuid`, 3, organizationID, userID)
	assertMembershipPicker(t, ctx, database, organizationID, queueDirect, "")
	assertMembershipPicker(t, ctx, database, organizationID, queueTeam, "")
}

func openDisposableMembershipAccessDatabase(t *testing.T) (*dbpkg.Postgres, context.Context) {
	t.Helper()
	if os.Getenv("VIMOB_RUN_MEMBERSHIP_ACCESS_DB_TESTS") != membershipAccessDBTestGuard {
		t.Skip("set VIMOB_RUN_MEMBERSHIP_ACCESS_DB_TESTS=LOCAL_WRITE_TEST and a disposable loopback PostgreSQL URL")
	}
	serverURL := strings.TrimSpace(os.Getenv("MEMBERSHIP_ACCESS_TEST_DATABASE_URL"))
	parsed, err := url.Parse(serverURL)
	if err != nil || parsed.User == nil || parsed.User.Username() != "postgres" || parsed.Path != "/postgres" || (parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "localhost") {
		t.Fatal("membership access DB tests require a disposable loopback postgres/postgres URL")
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
	name := "vimob_membership_" + hex.EncodeToString(suffix[:])
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
	readAndExecute := func(path string) {
		t.Helper()
		content, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		if _, err := setup.Exec(ctx, string(content), pgx.QueryExecModeSimpleProtocol); err != nil {
			t.Fatalf("execute %s: %v", path, err)
		}
	}
	readAndExecute(filepath.Join("testdata", "membership_access_setup.sql"))
	guardPath := filepath.Join("..", "..", "..", "..", "supabase", "migrations", "20260920012629_preserve_deleted_round_robin_identity.sql")
	guardSource, err := os.ReadFile(guardPath)
	if err != nil {
		t.Fatalf("read managed WhatsApp guard: %v", err)
	}
	guardText := string(guardSource)
	begin := strings.Index(guardText, "create or replace function private.guard_pending_managed_whatsapp_child_mutation()")
	end := strings.Index(guardText, "create or replace function private.guard_live_round_robin_reference()")
	if begin < 0 || end <= begin {
		t.Fatal("managed WhatsApp queue guard source boundary changed")
	}
	if _, err := setup.Exec(ctx, guardText[begin:end], pgx.QueryExecModeSimpleProtocol); err != nil {
		t.Fatalf("install real managed WhatsApp queue guard: %v", err)
	}
	readAndExecute(filepath.Join("..", "..", "..", "..", "supabase", "migrations", "20261009030225_membership_access_generation.sql"))
	// The Teams gateway now advances this token when user removal deletes a
	// team_member. This lightweight fixture does not install the full later
	// migration because its unrelated audit dependencies are absent here.
	if _, err := setup.Exec(ctx, `alter table public.teams
		add column revision bigint not null default 1,
		add column updated_at timestamptz not null default now()`); err != nil {
		t.Fatalf("add team revision to disposable fixture: %v", err)
	}
	if err := setup.Close(ctx); err != nil {
		t.Fatalf("close migration connection: %v", err)
	}
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, MaxConns: 8, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatalf("open disposable application pool: %v", err)
	}
	t.Cleanup(database.Close)
	return database, ctx
}

func mustMembershipExec(t *testing.T, ctx context.Context, database *dbpkg.Postgres, sql string, args ...any) {
	t.Helper()
	if _, err := database.Pool().Exec(ctx, sql, args...); err != nil {
		t.Fatalf("execute membership fixture SQL: %v", err)
	}
}

func assertMembershipNumber(t *testing.T, ctx context.Context, database *dbpkg.Postgres, sql string, want int64, args ...any) {
	t.Helper()
	var got int64
	if err := database.Pool().QueryRow(ctx, sql, args...).Scan(&got); err != nil {
		t.Fatalf("read membership state: %v", err)
	}
	if got != want {
		t.Fatalf("membership state = %d, want %d for %s", got, want, sql)
	}
}

func assertMembershipPicker(t *testing.T, ctx context.Context, database *dbpkg.Postgres, organizationID string, queueID string, wantUserID string) {
	t.Helper()
	var selectedUserID string
	err := database.Pool().QueryRow(ctx, `
		select user_id::text
		from private.pick_round_robin_ticket_candidate($1::uuid, $2::uuid, 'simple', true, 4, '12:00'::time, 1)
	`, organizationID, queueID).Scan(&selectedUserID)
	if errors.Is(err, pgx.ErrNoRows) {
		selectedUserID = ""
	} else if err != nil {
		t.Fatalf("select queue candidate: %v", err)
	}
	if selectedUserID != wantUserID {
		t.Fatalf("queue %s candidate=%q, want %q", queueID, selectedUserID, wantUserID)
	}
}

func isMembershipPgCode(err error, code string) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == code
}
