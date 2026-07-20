package integrations

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestImoviewEdgeFunctionSecurityTimeoutAndPrivacyContracts(t *testing.T) {
	root := filepath.Join("..", "..", "..", "..", "supabase", "functions")
	readFunction := func(name string) string {
		t.Helper()
		raw, err := os.ReadFile(filepath.Join(root, name, "index.ts"))
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		return string(raw)
	}

	imoviewSync := readFunction("imoview-sync")
	for _, required := range []string{
		"@supabase/supabase-js@2.108.1",
		"authorizeRequest",
		"constantTimeEqual",
		"profile.role === \"super_admin\"",
		"organization_members",
		"[\"owner\", \"admin\"].includes(membership.role)",
		"fetchWithTimeout",
		"requestTimeoutMs = 20_000",
		"maxRuntimeMs = 140_000",
		"redirect: \"error\"",
		"loadIntegration",
		"imoview_integrations_service",
		"invalid_json_body",
	} {
		if !strings.Contains(imoviewSync, required) {
			t.Fatalf("imoview-sync is missing contract fragment %q", required)
		}
	}
	for _, forbidden := range []string{
		"Testing Imoview connection with key:",
		"response body:",
		"response (first",
		"sample: data",
		"await fetch(`${IMOVIEW_BASE}",
	} {
		if strings.Contains(imoviewSync, forbidden) {
			t.Fatalf("imoview-sync contains unsafe legacy fragment %q", forbidden)
		}
	}

	scheduledSync := readFunction("imoview-scheduled-sync")
	for _, required := range []string{
		"@supabase/supabase-js@2.108.1",
		"IMOVIEW_SCHEDULED_SYNC_SECRET",
		"x-vimob-cron-secret",
		"constantTimeEqual",
		"runWithConcurrency",
		"EdgeRuntime.waitUntil",
		"accepted: true",
	} {
		if !strings.Contains(scheduledSync, required) {
			t.Fatalf("imoview-scheduled-sync is missing contract fragment %q", required)
		}
	}
}

func TestImoviewRepositoryUsesWriteOnlyVaultContract(t *testing.T) {
	raw, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatalf("read integrations repository: %v", err)
	}
	repository := string(raw)
	for _, required := range []string{
		"select to_jsonb(i) - 'api_key' - 'api_key_secret_ref'",
		"returning to_jsonb(imoview_integrations.*) - 'api_key' - 'api_key_secret_ref'",
	} {
		if !strings.Contains(repository, required) {
			t.Fatalf("Imoview repository is missing Vault contract fragment %q", required)
		}
	}

	start := strings.Index(repository, "func (repo Repository) SaveImoview")
	if start < 0 {
		t.Fatal("could not find SaveImoview implementation")
	}
	end := strings.Index(repository[start:], "func (repo Repository) DeleteImoview")
	if end < 0 {
		t.Fatal("could not isolate SaveImoview implementation")
	}
	if strings.Contains(repository[start:start+end], `"plain:"+apiKey`) {
		t.Fatal("SaveImoview must use the database write-only credential input")
	}
}
