package admin

import (
	"context"
	"errors"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestGenericAdminMutationsRejectDomainTablesBeforeDatabase(t *testing.T) {
	t.Parallel()

	protectedTables := []string{
		"organizations",
		"users",
		"organization_members",
		"onboarding_requests",
		"feature_requests",
		"audit_logs",
		"email_templates",
		"email_logs",
		"organization_modules",
	}
	const rowID = "10000000-0000-0000-0000-000000000001"
	actor := tenant.Context{IsSuperAdmin: true}
	repo := Repository{} // A rejected mutation must never try to use a database pool.

	for _, table := range protectedTables {
		t.Run(table, func(t *testing.T) {
			t.Parallel()
			if !isAllowedAdminReadTable(table) {
				t.Fatal("existing SuperAdmin inventory read must remain available")
			}

			if _, err := repo.CreateTableRow(context.Background(), actor, table, map[string]any{"name": "blocked"}); !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("create error = %v, want ErrInvalidInput", err)
			}
			if _, err := repo.UpdateTableRow(context.Background(), actor, table, rowID, map[string]any{"name": "blocked"}); !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("update error = %v, want ErrInvalidInput", err)
			}
			if err := repo.DeleteTableRow(context.Background(), actor, table, rowID); !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("delete error = %v, want ErrInvalidInput", err)
			}
		})
	}
}

func TestGenericAdminMutationAllowlistPreservesContentOperations(t *testing.T) {
	t.Parallel()

	for _, testCase := range []struct {
		table       string
		allowDelete bool
	}{
		{table: "admin_subscription_plans", allowDelete: true},
		{table: "announcements", allowDelete: false},
		{table: "help_articles", allowDelete: true},
	} {
		t.Run(testCase.table, func(t *testing.T) {
			t.Parallel()
			if !isAllowedAdminWriteTable(testCase.table) {
				t.Fatal("current admin content create/update operation must remain available")
			}
			if got := isAllowedAdminDeleteTable(testCase.table); got != testCase.allowDelete {
				t.Fatalf("delete allowed = %t, want %t", got, testCase.allowDelete)
			}
		})
	}
}

func TestGenericAdminDeleteRejectsAnnouncementsBeforeDatabase(t *testing.T) {
	t.Parallel()

	repo := Repository{}
	actor := tenant.Context{IsSuperAdmin: true}
	err := repo.DeleteTableRow(context.Background(), actor, "announcements", "10000000-0000-0000-0000-000000000001")
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("delete error = %v, want ErrInvalidInput", err)
	}
}
