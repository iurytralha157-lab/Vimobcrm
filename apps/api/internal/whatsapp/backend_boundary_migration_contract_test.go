package whatsapp

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

const whatsappBackendBoundaryMigration = "20260912132937_harden_whatsapp_backend_only_boundary.sql"

func TestWhatsAppBackendBoundaryMigrationClosesTablesHelpersAndStorage(t *testing.T) {
	t.Parallel()

	migration := readWhatsAppBackendBoundaryFile(t, "migrations", whatsappBackendBoundaryMigration)
	storageCutover := readWhatsAppBackendBoundaryFile(t, "cutovers", "20260912_prepare_whatsapp_storage_boundary.sql")
	for _, required := range []string{
		"set local lock_timeout = '3s'",
		"lock table public.%I in access exclusive mode nowait",
		"order by relation.oid",
		"left(relation.relname, 9) = 'whatsapp_'",
		"alter table public.%I enable row level security",
		"revoke all privileges on table public.%I from public, anon, authenticated, service_role",
		"grant select, insert, update, delete on table public.%I to service_role",
		"alter table public.media_jobs enable row level security",
		"revoke all privileges\non table public.media_jobs\nfrom public, anon, authenticated, service_role",
		"grant insert on table public.media_jobs to service_role",
		"drop policy if exists %I on %I.%I",
		"private.can_manage_whatsapp_session(uuid)",
		"private.can_receive_whatsapp_broadcast(text)",
		"create policy \"whatsapp media backend-only boundary\"",
		"using (bucket_id <> 'whatsapp-media')",
		"with check (bucket_id <> 'whatsapp-media')",
		"20260912_prepare_whatsapp_storage_boundary.sql",
		"if exists (select 1 from storage.objects limit 1)",
		"and public = false",
		"$postconditions$",
	} {
		if !strings.Contains(migration, required) {
			t.Fatalf("backend boundary migration is missing %q", required)
		}
	}

	normalizedMigration := strings.ToLower(migration)
	whitespaceNormalizedMigration := strings.Join(strings.Fields(normalizedMigration), " ")
	if !strings.Contains(whitespaceNormalizedMigration, "on storage.objects as restrictive for all to anon, authenticated") {
		t.Fatal("backend boundary migration is missing the restrictive browser-role Storage policy")
	}
	if strings.Contains(normalizedMigration, "grant select on table storage.objects to authenticated") ||
		strings.Contains(normalizedMigration, "grant select on table storage.objects to anon") {
		t.Fatal("backend boundary migration must not grant browser access to Storage objects")
	}
	if strings.Contains(normalizedMigration, "alter table storage.objects") {
		t.Fatal("backend boundary migration must not alter the Supabase-managed storage.objects table")
	}

	const sessionManagementHelper = "private.can_manage_whatsapp_session(uuid)"
	if count := strings.Count(migration, sessionManagementHelper); count != 2 {
		t.Fatalf("session management helper must be present in revoke and postcondition lists, got %d occurrences", count)
	}
	hardeningBlock := sqlDollarBlock(t, migration, "$harden_backend_helpers$")
	if !strings.Contains(hardeningBlock, sessionManagementHelper) ||
		!strings.Contains(hardeningBlock, "grant execute on function") ||
		!strings.Contains(hardeningBlock, "to service_role") {
		t.Fatal("session management helper must be revoked from browser roles and explicitly granted to service_role")
	}
	postconditionsBlock := sqlDollarBlock(t, migration, "$postconditions$")
	if !strings.Contains(postconditionsBlock, sessionManagementHelper) {
		t.Fatal("backend boundary postconditions do not verify the session management helper")
	}

	for _, required := range []string{
		"set local lock_timeout = '3s'",
		"lock table storage.objects in access exclusive mode nowait",
		"$replace_whatsapp_storage_policies$",
		"create policy \"whatsapp media backend-only boundary\"",
		"$verify_whatsapp_storage_boundary$",
	} {
		if !strings.Contains(storageCutover, required) {
			t.Fatalf("Storage boundary cutover is missing %q", required)
		}
	}

	storagePolicyDrop := sqlDollarBlock(t, storageCutover, "$replace_whatsapp_storage_policies$")
	for _, policyName := range []string{
		"org members read private whatsapp media",
		"org members remove own whatsapp media",
		"org members upload private whatsapp media",
		"whatsapp media backend-only boundary",
	} {
		if !strings.Contains(storagePolicyDrop, policyName) {
			t.Fatalf("Storage policy cleanup is missing owned policy %q", policyName)
		}
	}
	if strings.Contains(storagePolicyDrop, "coalesce(qual") ||
		strings.Contains(storagePolicyDrop, "coalesce(with_check") ||
		strings.Contains(storagePolicyDrop, "ilike '%whatsapp-media%'") {
		t.Fatal("Storage policy cleanup must be name-scoped, not expression-scoped")
	}
}

func TestWhatsAppBackendBoundaryHasExecutablePgTAPContract(t *testing.T) {
	t.Parallel()

	testSQL := readWhatsAppBackendBoundaryFile(t, "cutovers", "tests", "whatsapp_backend_only_boundary.test.sql")
	for _, required := range []string{
		"select plan(21)",
		"authenticated has no raw WhatsApp table DML",
		"anonymous has no raw WhatsApp table DML",
		"service_role retains explicit CRUD on every installed WhatsApp relation",
		"service_role cannot claim, read, mutate or delete media jobs",
		"Storage has a restrictive WhatsApp media boundary for browser roles",
		"coalesce(qual, '') like '%<>%'",
		"coalesce(with_check, '') like '%<>%'",
		"known legacy WhatsApp media Storage policies are absent",
		"WhatsApp media bucket exists and remains private",
		"authenticated retains the content-free private Realtime authorization gate",
		"private.can_manage_whatsapp_session(uuid)",
		"select * from finish()",
		"rollback",
	} {
		if !strings.Contains(testSQL, required) {
			t.Fatalf("pgTAP boundary contract is missing %q", required)
		}
	}
	for _, policyName := range []string{
		"org members read private whatsapp media",
		"org members remove own whatsapp media",
		"org members upload private whatsapp media",
	} {
		if !strings.Contains(testSQL, policyName) {
			t.Fatalf("pgTAP boundary contract is missing known legacy policy %q", policyName)
		}
	}
	if strings.Contains(testSQL, "policyname <> 'whatsapp media backend-only boundary'") {
		t.Fatal("pgTAP must not require deleting unknown Storage policies by expression")
	}
	if count := strings.Count(testSQL, "private.can_manage_whatsapp_session(uuid)"); count != 4 {
		t.Fatalf("pgTAP must cover authenticated, anon and both service_role helper sets, got %d occurrences", count)
	}
}

func sqlDollarBlock(t *testing.T, sql string, delimiter string) string {
	t.Helper()
	start := strings.Index(sql, delimiter)
	if start < 0 {
		t.Fatalf("SQL is missing block delimiter %q", delimiter)
	}
	remaining := sql[start+len(delimiter):]
	end := strings.Index(remaining, delimiter)
	if end < 0 {
		t.Fatalf("SQL block %q is not closed", delimiter)
	}
	return remaining[:end]
}

func readWhatsAppBackendBoundaryFile(t *testing.T, pathParts ...string) string {
	t.Helper()
	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("unable to locate WhatsApp backend boundary contract test")
	}
	repositoryRoot := filepath.Clean(filepath.Join(filepath.Dir(sourceFile), "..", "..", "..", ".."))
	path := filepath.Join(append([]string{repositoryRoot, "supabase"}, pathParts...)...)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(raw)
}
