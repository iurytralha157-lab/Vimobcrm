package settings

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestCreateRoleAndPermissionsShareOneTransaction(t *testing.T) {
	source, err := os.ReadFile("roles.go")
	if err != nil {
		t.Fatalf("read roles repository source: %v", err)
	}
	function := isolateSettingsFunction(t, string(source), "func (repo Repository) CreateRole(")

	beginIndex := strings.Index(function, "repo.db.Pool().Begin")
	insertIndex := strings.Index(function, "insert into public.organization_roles")
	replaceIndex := strings.Index(function, "repo.replaceRolePermissionsTx")
	commitIndex := strings.Index(function, "tx.Commit")
	if beginIndex < 0 || insertIndex < 0 || replaceIndex < 0 || commitIndex < 0 {
		t.Fatal("CreateRole must begin a transaction, insert the role, replace permissions and commit")
	}
	if !(beginIndex < insertIndex && insertIndex < replaceIndex && replaceIndex < commitIndex) {
		t.Fatal("CreateRole must persist the role and its permissions atomically in that order")
	}
	if strings.Contains(function, "repo.queryJSONObject") {
		t.Fatal("CreateRole must not create the role through an autocommit repository helper")
	}
}

func TestCustomRoleWritesPopulateLegacyAndCanonicalColumns(t *testing.T) {
	source, err := os.ReadFile("roles.go")
	if err != nil {
		t.Fatalf("read roles repository source: %v", err)
	}
	text := string(source)

	for _, required := range []string{
		"organization_role_id,",
		"permission_key,",
		"organization_id,",
		"role_id,",
		"permission_id",
		"on conflict (organization_role_id, permission_key)",
		"on conflict (organization_id, user_id) where organization_id is not null",
	} {
		if !strings.Contains(text, required) {
			t.Fatalf("custom role storage is missing dual-write contract %q", required)
		}
	}
}

func TestCustomRoleSchemaMigrationPreservesAndBackfillsLegacyContract(t *testing.T) {
	_, testFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("could not resolve test file")
	}
	repositoryRoot := filepath.Clean(filepath.Join(filepath.Dir(testFile), "..", "..", "..", ".."))
	payload, err := os.ReadFile(filepath.Join(
		repositoryRoot,
		"supabase",
		"migrations",
		"20260905121600_reconcile_custom_role_storage_contract.sql",
	))
	if err != nil {
		t.Fatalf("read custom role migration: %v", err)
	}
	migration := string(payload)
	for _, required := range []string{
		"insert into public.organization_role_permissions",
		"organization_role_id",
		"permission_key",
		"permission_expansions",
		"update public.user_organization_roles assignment",
		"drop constraint if exists user_organization_roles_user_id_key",
		"user_organization_roles_organization_user_uidx",
		"organization_role_permissions_canonical_role_fkey",
		"user_organization_roles_canonical_role_fkey",
	} {
		if !strings.Contains(migration, required) {
			t.Fatalf("custom role migration is missing %q", required)
		}
	}
}

func isolateSettingsFunction(t *testing.T, source string, signature string) string {
	t.Helper()
	start := strings.Index(source, signature)
	if start < 0 {
		t.Fatalf("could not find %s", signature)
	}
	remainder := source[start+1:]
	end := strings.Index(remainder, "\nfunc ")
	if end < 0 {
		return source[start:]
	}
	return source[start : start+1+end]
}
