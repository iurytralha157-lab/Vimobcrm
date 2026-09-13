package properties

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestDeletePropertyInputRequiresCurrentVersion(t *testing.T) {
	for _, input := range []DeletePropertyInput{
		{},
		{ExpectedUpdatedAt: "yesterday"},
	} {
		if err := input.Validate(); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("DeletePropertyInput.Validate() error = %v, want ErrInvalidInput", err)
		}
	}
	if err := (DeletePropertyInput{ExpectedUpdatedAt: "2026-09-08T12:00:00Z"}).Validate(); err != nil {
		t.Fatalf("valid delete revision rejected: %v", err)
	}
}

func TestPropertyDeleteRejectsAStaleVersionAgainstDatabase(t *testing.T) {
	if os.Getenv("VIMOB_RUN_DB_TESTS") != "1" {
		t.Skip("set VIMOB_RUN_DB_TESTS=1 to run database integration tests")
	}
	databaseURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if databaseURL == "" {
		t.Fatal("DATABASE_URL is required")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL: databaseURL, MaxConns: 2, MinConns: 0, HealthTimeout: 5 * time.Second,
	})
	if err != nil {
		t.Fatalf("NewPostgres() returned error: %v", err)
	}
	t.Cleanup(postgres.Close)

	var organizationID, userID string
	err = postgres.Pool().QueryRow(ctx, `
		select member.organization_id::text, member.user_id::text
		from public.organization_members member
		join public.users app_user on app_user.id = member.user_id
		where coalesce(member.is_active, true)
		  and coalesce(app_user.is_active, true)
		order by member.created_at, member.user_id
		limit 1
	`).Scan(&organizationID, &userID)
	if errors.Is(err, pgx.ErrNoRows) {
		t.Skip("no active organization member is available")
	}
	if err != nil {
		t.Fatalf("organization fixture lookup returned error: %v", err)
	}

	code := fmt.Sprintf("DELETE-CAS-%d", time.Now().UnixNano())
	var propertyID string
	var originalUpdatedAt time.Time
	err = postgres.Pool().QueryRow(ctx, `
		insert into public.properties (
			organization_id, code, title, tipo, tipo_de_imovel, status,
			created_by, responsible_user_id
		) values (
			$1::uuid, $2, 'Delete CAS original', 'Apartamento', 'Apartamento', 'active',
			$3::uuid, $3::uuid
		)
		returning id::text, updated_at
	`, organizationID, code, userID).Scan(&propertyID, &originalUpdatedAt)
	if err != nil {
		t.Fatalf("property fixture insert returned error: %v", err)
	}
	t.Cleanup(func() {
		cleanupContext, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		_, _ = postgres.Pool().Exec(cleanupContext, `
			delete from public.properties
			where organization_id = $1::uuid and id = $2::uuid
		`, organizationID, propertyID)
	})

	var currentUpdatedAt time.Time
	err = postgres.Pool().QueryRow(ctx, `
		update public.properties
		set title = 'Delete CAS concurrent edit', updated_at = clock_timestamp()
		where organization_id = $1::uuid and id = $2::uuid
		returning updated_at
	`, organizationID, propertyID).Scan(&currentUpdatedAt)
	if err != nil {
		t.Fatalf("concurrent property update returned error: %v", err)
	}

	repo := NewRepository(postgres, StorageConfig{})
	manager := tenant.Context{OrganizationID: organizationID, UserID: userID, MemberRole: "admin"}
	err = repo.Delete(ctx, manager, propertyID, DeletePropertyInput{
		ExpectedUpdatedAt: originalUpdatedAt.UTC().Format(time.RFC3339Nano),
	})
	if !errors.Is(err, ErrPropertyWorkspaceConflict) {
		t.Fatalf("stale Delete() error = %v, want ErrPropertyWorkspaceConflict", err)
	}

	var title string
	if err := postgres.Pool().QueryRow(ctx, `
		select title
		from public.properties
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, propertyID).Scan(&title); err != nil {
		t.Fatalf("stale delete removed property: %v", err)
	}
	if title != "Delete CAS concurrent edit" {
		t.Fatalf("property title after stale delete = %q", title)
	}

	err = repo.Delete(ctx, manager, propertyID, DeletePropertyInput{
		ExpectedUpdatedAt: currentUpdatedAt.UTC().Format(time.RFC3339Nano),
	})
	if err != nil {
		t.Fatalf("current Delete() returned error: %v", err)
	}
	var exists bool
	if err := postgres.Pool().QueryRow(ctx, `
		select exists (
			select 1 from public.properties
			where organization_id = $1::uuid and id = $2::uuid
		)
	`, organizationID, propertyID).Scan(&exists); err != nil {
		t.Fatalf("property deletion readback returned error: %v", err)
	}
	if exists {
		t.Fatal("current delete did not remove the property")
	}
}
