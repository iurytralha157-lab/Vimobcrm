package users

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// This fixture rolls back every write. The disposable local database must
// already contain the membership-generation migration.
func TestRemovedMembershipDoesNotRestoreCustomGrants(t *testing.T) {
	if os.Getenv("VIMOB_RUN_MEMBERSHIP_ROUTING_DB_TESTS") != "LOCAL_WRITE_TEST" {
		t.Skip("set VIMOB_RUN_MEMBERSHIP_ROUTING_DB_TESTS=LOCAL_WRITE_TEST for the disposable database contract")
	}
	databaseURL := strings.TrimSpace(os.Getenv("MEMBERSHIP_ROUTING_TEST_DATABASE_URL"))
	target, err := url.Parse(databaseURL)
	if err != nil || target.User == nil || target.User.Username() != "postgres" || target.Path != "/postgres" || (target.Hostname() != "127.0.0.1" && target.Hostname() != "localhost") {
		t.Fatal("membership grant test requires a disposable loopback postgres/postgres database URL")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 45*time.Second)
	defer cancel()
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, MaxConns: 4, HealthTimeout: 5 * time.Second})
	if err != nil {
		t.Fatalf("connect disposable database: %v", err)
	}
	t.Cleanup(database.Close)
	tx, err := database.Pool().Begin(ctx)
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
			t.Fatal(err)
		}
		return id
	}
	exec := func(statement string, args ...any) {
		t.Helper()
		if _, err := tx.Exec(ctx, statement, args...); err != nil {
			t.Fatalf("membership grant fixture: %v", err)
		}
	}
	organizationID, otherOrganizationID, userID := newID(), newID(), newID()
	roleID, otherRoleID := newID(), newID()
	exec(`insert into public.organizations (id, name, is_active)
		values ($1::uuid, 'Grant lifecycle target', true),
		       ($2::uuid, 'Grant lifecycle control', true)`, organizationID, otherOrganizationID)
	email := fmt.Sprintf("grant-lifecycle-%s@example.test", strings.ReplaceAll(userID, "-", ""))
	exec(`insert into auth.users (
		id, aud, role, email, encrypted_password, email_confirmed_at,
		raw_app_meta_data, raw_user_meta_data, created_at, updated_at
	) values ($1::uuid, 'authenticated', 'authenticated', $2, '', now(), '{}'::jsonb, '{}'::jsonb, now(), now())`, userID, email)
	exec(`insert into public.users (id, organization_id, name, email, role, is_active)
		values ($1::uuid, $2::uuid, 'Reinvited user', $3, 'user', true)
		on conflict (id) do update set organization_id = excluded.organization_id,
		name = excluded.name, email = excluded.email, role = excluded.role,
		is_active = excluded.is_active`, userID, organizationID, email)
	exec(`insert into public.organization_members (organization_id, user_id, role, is_active)
		values ($1::uuid, $3::uuid, 'user', true),
		       ($2::uuid, $3::uuid, 'user', true)
		on conflict (organization_id, user_id) do update set
		  role = excluded.role, is_active = true, deleted_at = null`, organizationID, otherOrganizationID, userID)
	exec(`insert into public.organization_roles (id, organization_id, name, is_active)
		values ($1::uuid, $3::uuid, 'Old custom role', true),
		       ($2::uuid, $4::uuid, 'Other organization role', true)`, roleID, otherRoleID, organizationID, otherOrganizationID)

	grant := func(orgID, assignedRoleID string) {
		t.Helper()
		exec(`insert into public.user_organization_roles
			(organization_role_id, organization_id, user_id, role_id, is_active)
			values ($1::uuid, $2::uuid, $3::uuid, $1::uuid, true)`, assignedRoleID, orgID, userID)
		exec(`insert into public.user_permission_overrides
			(organization_id, user_id, permission_key, allowed)
			values ($1::uuid, $2::uuid, 'lead_view_all', true)`, orgID, userID)
	}
	grantLegacy := func(assignedRoleID string) {
		t.Helper()
		// Older SQL consumers still understand organization_role_id rows whose
		// canonical organization_id and role_id were never populated.
		exec(`insert into public.user_organization_roles
			(organization_role_id, user_id, is_active)
			values ($1::uuid, $2::uuid, true)`, assignedRoleID, userID)
	}
	assertGrants := func(label, orgID string, roleCount, overrideCount int) {
		t.Helper()
		var gotRoles, gotOverrides int
		err := tx.QueryRow(ctx, `select
			(select count(*)::int
			 from public.user_organization_roles assignment
			 left join public.organization_roles legacy_role
			   on legacy_role.id = assignment.organization_role_id
			 where assignment.user_id = $2::uuid
			   and (assignment.organization_id = $1::uuid
			        or legacy_role.organization_id = $1::uuid)),
			(select count(*)::int from public.user_permission_overrides
			 where organization_id = $1::uuid and user_id = $2::uuid)`, orgID, userID).Scan(&gotRoles, &gotOverrides)
		if err != nil || gotRoles != roleCount || gotOverrides != overrideCount {
			t.Fatalf("%s: roles=%d overrides=%d err=%v; want %d/%d", label, gotRoles, gotOverrides, err, roleCount, overrideCount)
		}
	}
	grant(organizationID, roleID)
	grant(otherOrganizationID, otherRoleID)
	assertGrants("initial target grants", organizationID, 1, 1)
	assertGrants("initial control grants", otherOrganizationID, 1, 1)

	// A temporary suspension is not a new invitation.
	exec(`update public.organization_members set is_active = false
		where organization_id = $1::uuid and user_id = $2::uuid`, organizationID, userID)
	assertGrants("temporary suspension", organizationID, 1, 1)
	exec(`update public.organization_members set is_active = true
		where organization_id = $1::uuid and user_id = $2::uuid`, organizationID, userID)
	assertGrants("temporary reactivation", organizationID, 1, 1)

	exec(`update public.organization_members set is_active = false, deleted_at = clock_timestamp()
		where organization_id = $1::uuid and user_id = $2::uuid`, organizationID, userID)
	assertGrants("removal", organizationID, 0, 0)
	assertGrants("other organization unaffected", otherOrganizationID, 1, 1)
	// A legacy or service-role write to a tombstoned membership must not
	// become effective when the invitation restores that membership.
	grant(organizationID, roleID)
	grantLegacy(roleID)
	assertGrants("grants written while tombstoned", organizationID, 2, 1)
	exec(`update public.organization_members set is_active = true, deleted_at = null
		where organization_id = $1::uuid and user_id = $2::uuid`, organizationID, userID)
	assertGrants("reinvitation", organizationID, 0, 0)
	assertGrants("other organization after reinvitation", otherOrganizationID, 1, 1)

	// Only a new explicit grant after rejoining is retained.
	grant(organizationID, roleID)
	exec(`update public.organization_members set updated_at = clock_timestamp()
		where organization_id = $1::uuid and user_id = $2::uuid`, organizationID, userID)
	assertGrants("explicit regrant", organizationID, 1, 1)

	// Legacy hard deletion also clears assignments; a later INSERT cannot
	// inherit an assignment written while no membership row existed.
	exec(`delete from public.organization_members where organization_id = $1::uuid and user_id = $2::uuid`, organizationID, userID)
	assertGrants("hard deletion", organizationID, 0, 0)
	exec(`insert into public.user_organization_roles
		(organization_role_id, organization_id, user_id, role_id, is_active)
		values ($1::uuid, $2::uuid, $3::uuid, $1::uuid, true)`, roleID, organizationID, userID)
	grantLegacy(roleID)
	assertGrants("grants written after hard deletion", organizationID, 2, 0)
	exec(`insert into public.organization_members (organization_id, user_id, role, is_active)
		values ($1::uuid, $2::uuid, 'user', true)`, organizationID, userID)
	assertGrants("membership inserted after hard deletion", organizationID, 0, 0)
	assertGrants("other organization after hard deletion", otherOrganizationID, 1, 1)
}
