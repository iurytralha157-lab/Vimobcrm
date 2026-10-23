package leads

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

func TestBillingNotificationDispatchRequiresActiveRoleAndMembership(t *testing.T) {
	if os.Getenv("VIMOB_RUN_BILLING_AUTH_DB_TESTS") != "LOCAL_WRITE_TEST" {
		t.Skip("set VIMOB_RUN_BILLING_AUTH_DB_TESTS=LOCAL_WRITE_TEST for a disposable local database")
	}
	databaseURL := strings.TrimSpace(os.Getenv("BILLING_AUTH_TEST_DATABASE_URL"))
	target, err := url.Parse(databaseURL)
	if err != nil || target.User == nil || target.User.Username() != "postgres" || target.Path != "/postgres" ||
		(target.Hostname() != "127.0.0.1" && target.Hostname() != "localhost") {
		t.Fatal("billing authorization test requires a disposable loopback postgres/postgres database URL")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, MaxConns: 2, HealthTimeout: 5 * time.Second})
	if err != nil {
		t.Fatalf("connect disposable database: %v", err)
	}
	t.Cleanup(database.Close)
	tx, err := database.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		rollbackCtx, rollbackCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer rollbackCancel()
		_ = tx.Rollback(rollbackCtx)
	})
	var organizationID, userID, roleID, permissionID string
	if err := tx.QueryRow(ctx, `select gen_random_uuid()::text, gen_random_uuid()::text,
		gen_random_uuid()::text, gen_random_uuid()::text`).Scan(&organizationID, &userID, &roleID, &permissionID); err != nil {
		t.Fatal(err)
	}
	exec := func(statement string, args ...any) {
		t.Helper()
		if _, err := tx.Exec(ctx, statement, args...); err != nil {
			t.Fatalf("billing authorization fixture: %v", err)
		}
	}
	exec(`insert into public.organizations (id, name, is_active)
		values ($1::uuid, 'Billing authorization fence', true)`, organizationID)
	email := fmt.Sprintf("billing-generation-%s@example.test", strings.ReplaceAll(userID, "-", ""))
	exec(`insert into auth.users (
		id, aud, role, email, encrypted_password, email_confirmed_at,
		raw_app_meta_data, raw_user_meta_data, created_at, updated_at
	) values ($1::uuid, 'authenticated', 'authenticated', $2, '', now(), '{}'::jsonb, '{}'::jsonb, now(), now())`, userID, email)
	exec(`insert into public.users (id, organization_id, name, email, role, is_active)
		values ($1::uuid, $2::uuid, 'Billing recipient', $3, 'user', true)
		on conflict (id) do update set organization_id = excluded.organization_id,
		name = excluded.name, email = excluded.email, role = excluded.role,
		is_active = excluded.is_active`, userID, organizationID, email)
	exec(`insert into public.organization_members (organization_id, user_id, role, is_active)
		values ($1::uuid, $2::uuid, 'user', true)
		on conflict (organization_id, user_id) do update set
		role = excluded.role, is_active = true, deleted_at = null`, organizationID, userID)
	exec(`insert into public.available_permissions (id, key, name, category)
		values ($1::uuid, 'settings_billing', 'Billing', 'settings')
		on conflict (key) do nothing`, permissionID)
	if err := tx.QueryRow(ctx, `select id::text from public.available_permissions
		where key = 'settings_billing'`).Scan(&permissionID); err != nil {
		t.Fatal(err)
	}
	exec(`insert into public.organization_roles (id, organization_id, name, is_active)
		values ($1::uuid, $2::uuid, 'Billing role', true)`, roleID, organizationID)
	exec(`insert into public.organization_role_permissions
		(organization_role_id, permission_key, organization_id, role_id, permission_id)
		values ($1::uuid, 'settings_billing', $2::uuid, $1::uuid, $3::uuid)`, roleID, organizationID, permissionID)
	exec(`insert into public.user_organization_roles
		(organization_role_id, organization_id, user_id, role_id, is_active)
		values ($1::uuid, $2::uuid, $3::uuid, $1::uuid, true)`, roleID, organizationID, userID)
	assertAuthorized := func(label string, want bool) {
		t.Helper()
		var got bool
		if err := tx.QueryRow(ctx, billingNotificationDispatchAuthorizationQuery, organizationID, userID).Scan(&got); err != nil {
			t.Fatalf("%s: %v", label, err)
		}
		if got != want {
			t.Fatalf("%s: authorized=%t, want %t", label, got, want)
		}
	}
	assertAuthorized("active custom role", true)
	exec(`update public.organization_roles set is_active = false where id = $1::uuid`, roleID)
	assertAuthorized("deactivated custom role", false)
	exec(`update public.organization_roles set is_active = true where id = $1::uuid`, roleID)
	assertAuthorized("reactivated custom role", true)
	exec(`update public.organization_members set deleted_at = now()
		where organization_id = $1::uuid and user_id = $2::uuid`, organizationID, userID)
	// Service-role writes can still add raw rows while the membership is
	// tombstoned; the authorization query must never treat them as active.
	exec(`insert into public.user_organization_roles
		(organization_role_id, organization_id, user_id, role_id, is_active)
		values ($1::uuid, $2::uuid, $3::uuid, $1::uuid, true)`, roleID, organizationID, userID)
	assertAuthorized("tombstoned membership with raw grant", false)
}
