package settings

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// Uses only the explicitly selected disposable local database. The fixture is
// committed so two connections can exercise the real membership row lock.
func TestPermissionWriteDoesNotCrossMembershipReinvite(t *testing.T) {
	if os.Getenv("VIMOB_RUN_SETTINGS_MEMBERSHIP_DB_TESTS") != "LOCAL_WRITE_TEST" {
		t.Skip("set VIMOB_RUN_SETTINGS_MEMBERSHIP_DB_TESTS=LOCAL_WRITE_TEST for a disposable local database")
	}
	databaseURL := strings.TrimSpace(os.Getenv("SETTINGS_MEMBERSHIP_TEST_DATABASE_URL"))
	target, err := url.Parse(databaseURL)
	if err != nil || target.User == nil || target.User.Username() != "postgres" || target.Path != "/postgres" ||
		(target.Hostname() != "127.0.0.1" && target.Hostname() != "localhost") {
		t.Fatal("settings membership test requires a disposable loopback postgres/postgres database URL")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 40*time.Second)
	defer cancel()
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, MaxConns: 4, HealthTimeout: 5 * time.Second})
	if err != nil {
		t.Fatalf("connect disposable database: %v", err)
	}
	t.Cleanup(database.Close)
	var organizationID, userID string
	if err := database.Pool().QueryRow(ctx, `select gen_random_uuid()::text, gen_random_uuid()::text`).Scan(&organizationID, &userID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		for _, statement := range []string{
			`delete from public.user_permission_overrides where organization_id = $1::uuid and user_id = $2::uuid`,
			`delete from public.organization_members where organization_id = $1::uuid and user_id = $2::uuid`,
		} {
			_, _ = database.Pool().Exec(cleanupCtx, statement, organizationID, userID)
		}
		_, _ = database.Pool().Exec(cleanupCtx, `delete from public.users where id = $1::uuid`, userID)
		_, _ = database.Pool().Exec(cleanupCtx, `delete from auth.users where id = $1::uuid`, userID)
		_, _ = database.Pool().Exec(cleanupCtx, `delete from public.organizations where id = $1::uuid`, organizationID)
	})
	exec := func(statement string, args ...any) {
		t.Helper()
		if _, err := database.Pool().Exec(ctx, statement, args...); err != nil {
			t.Fatalf("settings membership fixture: %v", err)
		}
	}
	exec(`insert into public.organizations (id, name, is_active)
		values ($1::uuid, 'Settings membership write fence', true)`, organizationID)
	email := fmt.Sprintf("settings-generation-%s@example.test", strings.ReplaceAll(userID, "-", ""))
	exec(`insert into auth.users (
		id, aud, role, email, encrypted_password, email_confirmed_at,
		raw_app_meta_data, raw_user_meta_data, created_at, updated_at
	) values ($1::uuid, 'authenticated', 'authenticated', $2, '', now(), '{}'::jsonb, '{}'::jsonb, now(), now())`, userID, email)
	exec(`insert into public.users (id, organization_id, name, email, role, is_active)
		values ($1::uuid, $2::uuid, 'Settings target', $3, 'user', true)
		on conflict (id) do update set organization_id = excluded.organization_id,
		name = excluded.name, email = excluded.email, role = excluded.role,
		is_active = excluded.is_active`, userID, organizationID, email)
	exec(`insert into public.organization_members (organization_id, user_id, role, is_active)
		values ($1::uuid, $2::uuid, 'user', true)
		on conflict (organization_id, user_id) do update set
		role = excluded.role, is_active = true, deleted_at = null`, organizationID, userID)

	repo := NewRepository(database, ExternalConfig{})
	before, err := repo.getPermissionTarget(ctx, organizationID, userID)
	if err != nil {
		t.Fatalf("read original membership: %v", err)
	}
	exec(`update public.organization_members set is_active = false, deleted_at = now()
		where organization_id = $1::uuid and user_id = $2::uuid`, organizationID, userID)
	exec(`update public.organization_members set is_active = true, deleted_at = null
		where organization_id = $1::uuid and user_id = $2::uuid`, organizationID, userID)

	actor := tenant.Context{OrganizationID: organizationID, UserID: userID}
	err = repo.replaceUserPermissionOverrides(ctx, actor, userID, before, map[string]bool{"lead_view_all": true})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("stale permission edit error = %v, want ErrInvalidInput", err)
	}
	var overrideCount int
	if err := database.Pool().QueryRow(ctx, `select count(*)::int from public.user_permission_overrides
		where organization_id = $1::uuid and user_id = $2::uuid`, organizationID, userID).Scan(&overrideCount); err != nil || overrideCount != 0 {
		t.Fatalf("stale edit wrote %d overrides: %v", overrideCount, err)
	}

	current, err := repo.getPermissionTarget(ctx, organizationID, userID)
	if err != nil {
		t.Fatal(err)
	}
	writeTx, err := database.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer writeTx.Rollback(context.Background())
	if err := lockPermissionTargetForWrite(ctx, writeTx, organizationID, userID, current); err != nil {
		t.Fatalf("lock current membership: %v", err)
	}
	removeTx, err := database.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer removeTx.Rollback(context.Background())
	if _, err := removeTx.Exec(ctx, `set local lock_timeout = '500ms'`); err != nil {
		t.Fatal(err)
	}
	_, err = removeTx.Exec(ctx, `update public.organization_members
		set is_active = false, deleted_at = now()
		where organization_id = $1::uuid and user_id = $2::uuid`, organizationID, userID)
	var pgError *pgconn.PgError
	if !errors.As(err, &pgError) || pgError.Code != "55P03" {
		t.Fatalf("concurrent removal bypassed permission write lock: %v", err)
	}
	if err := removeTx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	if err := writeTx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	exec(`update public.organization_members set is_active = false, deleted_at = now()
		where organization_id = $1::uuid and user_id = $2::uuid`, organizationID, userID)
}
