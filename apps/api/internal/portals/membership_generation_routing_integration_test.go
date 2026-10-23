package portals

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func TestPortalRoundRobinPickerRequiresCurrentMembershipGeneration(t *testing.T) {
	if os.Getenv("VIMOB_RUN_MEMBERSHIP_ROUTING_DB_TESTS") != "LOCAL_WRITE_TEST" {
		t.Skip("set VIMOB_RUN_MEMBERSHIP_ROUTING_DB_TESTS=LOCAL_WRITE_TEST for the disposable database contract")
	}
	databaseURL := strings.TrimSpace(os.Getenv("MEMBERSHIP_ROUTING_TEST_DATABASE_URL"))
	target, err := url.Parse(databaseURL)
	if err != nil || target.User == nil || target.User.Username() != "postgres" || target.Path != "/postgres" || (target.Hostname() != "127.0.0.1" && target.Hostname() != "localhost") {
		t.Fatal("portal routing test requires a disposable loopback postgres/postgres database URL")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	conn, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		t.Fatalf("connect disposable database: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close(context.Background()) })
	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatalf("begin disposable fixture: %v", err)
	}
	t.Cleanup(func() {
		rollbackCtx, rollbackCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer rollbackCancel()
		_ = tx.Rollback(rollbackCtx)
	})
	newID := func() string {
		t.Helper()
		var id string
		if err := tx.QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&id); err != nil {
			t.Fatalf("generate fixture UUID: %v", err)
		}
		return id
	}
	exec := func(statement string, args ...any) {
		t.Helper()
		if _, err := tx.Exec(ctx, statement, args...); err != nil {
			t.Fatalf("prepare portal routing fixture: %v", err)
		}
	}
	organizationID, userID := newID(), newID()
	roundRobinID, queueMemberID := newID(), newID()
	email := fmt.Sprintf("portal-routing-%s@example.test", strings.ReplaceAll(userID, "-", ""))
	exec(`insert into public.organizations (id, name, is_active) values ($1::uuid, 'Portal routing epoch', true)`, organizationID)
	exec(`insert into auth.users (
		id, aud, role, email, encrypted_password, email_confirmed_at,
		raw_app_meta_data, raw_user_meta_data, created_at, updated_at
	) values ($1::uuid, 'authenticated', 'authenticated', $2, '', now(), '{}'::jsonb, '{}'::jsonb, now(), now())`, userID, email)
	exec(`insert into public.users (id, organization_id, name, email, role, is_active)
		values ($1::uuid, $2::uuid, 'Portal routing member', $3, 'user', true)
		on conflict (id) do update set organization_id = excluded.organization_id,
		name = excluded.name, email = excluded.email, role = excluded.role,
		is_active = excluded.is_active`, userID, organizationID, email)
	exec(`insert into public.organization_members (organization_id, user_id, role, is_active)
		values ($1::uuid, $2::uuid, 'user', true)
		on conflict (user_id, organization_id) do update set role = excluded.role,
		is_active = excluded.is_active, deleted_at = null`, organizationID, userID)
	exec(`insert into public.round_robins (id, organization_id, name, is_active)
		values ($1::uuid, $2::uuid, 'Portal routing queue', true)`, roundRobinID, organizationID)
	exec(`insert into public.round_robin_members (
		id, round_robin_id, organization_id, user_id, position, is_active
	) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 0, true)`, queueMemberID, roundRobinID, organizationID, userID)

	assertSelected := func(want bool) {
		t.Helper()
		member, user, _, err := selectPortalRoundRobinMember(ctx, tx, organizationID, roundRobinID)
		if err != nil {
			t.Fatalf("select portal round-robin member: %v", err)
		}
		if want && (member != queueMemberID || user != userID) {
			t.Fatalf("portal selection member=%q user=%q, want %s/%s", member, user, queueMemberID, userID)
		}
		if !want && (member != "" || user != "") {
			t.Fatalf("stale portal queue member selected: member=%q user=%q", member, user)
		}
	}
	assertSelected(true)
	exec(`update public.organization_members set is_active = false, deleted_at = now()
		where organization_id = $1::uuid and user_id = $2::uuid`, organizationID, userID)
	exec(`update public.organization_members set is_active = true, deleted_at = null
		where organization_id = $1::uuid and user_id = $2::uuid`, organizationID, userID)
	assertSelected(false)
	exec(`update public.round_robin_members set is_active = true where id = $1::uuid`, queueMemberID)
	assertSelected(true)
}
