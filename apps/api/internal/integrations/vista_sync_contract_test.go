package integrations

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestVistaEdgeFunctionSecurityAndTimeoutContracts(t *testing.T) {
	root := filepath.Join("..", "..", "..", "..", "supabase", "functions")

	readFunction := func(name string) string {
		t.Helper()
		raw, err := os.ReadFile(filepath.Join(root, name, "index.ts"))
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		return string(raw)
	}

	vistaSync := readFunction("vista-sync")
	for _, required := range []string{
		"@supabase/supabase-js@2.108.1",
		"authorizeVistaRequest",
		"constantTimeEqual",
		"profile.role === \"super_admin\"",
		"organization_members",
		"[\"owner\", \"admin\"].includes(membership.role)",
		"fetchWithTimeout",
		"externalRequestTimeoutMs = 20_000",
		"Vista request timed out",
		"normalizeVistaApiUrl",
		"Deno.resolveDns",
		"isPrivateIP",
		"redirect: \"error\"",
		"unsafe_vista_api_target",
		"loadVistaIntegration",
		"vista_integrations_service",
	} {
		if !strings.Contains(vistaSync, required) {
			t.Fatalf("vista-sync is missing contract fragment %q", required)
		}
	}
	if strings.Contains(vistaSync, "await fetch(`${apiUrl}/imoveis/listar") {
		t.Fatal("Vista listing requests must use the bounded fetch helper")
	}

	scheduledSync := readFunction("vista-scheduled-sync")
	for _, required := range []string{
		"@supabase/supabase-js@2.108.1",
		"VISTA_SCHEDULED_SYNC_SECRET",
		"x-vimob-cron-secret",
		"constantTimeEqual",
		"runWithConcurrency",
		"EdgeRuntime.waitUntil",
		"accepted: true",
	} {
		if !strings.Contains(scheduledSync, required) {
			t.Fatalf("vista-scheduled-sync is missing contract fragment %q", required)
		}
	}
}

func TestVistaCronUsesVaultWithoutEmbeddedCredential(t *testing.T) {
	pattern := filepath.Join("..", "..", "..", "..", "supabase", "migrations", "*_secure_vista_scheduled_sync.sql")
	matches, err := filepath.Glob(pattern)
	if err != nil {
		t.Fatalf("glob Vista scheduler migration: %v", err)
	}
	if len(matches) != 1 {
		t.Fatalf("expected one Vista scheduler migration, found %d", len(matches))
	}
	raw, err := os.ReadFile(matches[0])
	if err != nil {
		t.Fatalf("read Vista scheduler migration: %v", err)
	}
	sql := strings.ToLower(string(raw))
	for _, required := range []string{
		"vista_scheduled_sync_secret",
		"vault.decrypted_secrets",
		"x-vimob-cron-secret",
		"timeout_milliseconds := 15000",
		"cron.alter_job",
	} {
		if !strings.Contains(sql, required) {
			t.Fatalf("Vista scheduler migration is missing contract fragment %q", required)
		}
	}
	if strings.Contains(sql, "authorization") || strings.Contains(sql, "eyj") {
		t.Fatal("Vista scheduler migration must not embed JWT credentials")
	}
}

func TestVistaRepositoryUsesWriteOnlyVaultContract(t *testing.T) {
	repositoryPath := filepath.Join("repository.go")
	raw, err := os.ReadFile(repositoryPath)
	if err != nil {
		t.Fatalf("read integrations repository: %v", err)
	}
	repository := string(raw)

	for _, required := range []string{
		"select to_jsonb(v) - 'api_key' - 'api_key_secret_ref'",
		"api_key_secret_ref = excluded.api_key_secret_ref",
		"returning to_jsonb(vista_integrations.*) - 'api_key' - 'api_key_secret_ref'",
	} {
		if !strings.Contains(repository, required) {
			t.Fatalf("Vista repository is missing Vault contract fragment %q", required)
		}
	}

	vistaStart := strings.Index(repository, "func (repo Repository) SaveVista")
	if vistaStart < 0 {
		t.Fatal("could not find SaveVista implementation")
	}
	vistaEnd := strings.Index(repository[vistaStart:], "func normalizeVistaAPIURL")
	if vistaEnd < 0 {
		t.Fatal("could not isolate SaveVista implementation")
	}
	saveVista := repository[vistaStart : vistaStart+vistaEnd]
	if strings.Contains(saveVista, `"plain:"+apiKey`) {
		t.Fatal("SaveVista must pass the raw write-only input to the database trigger, not a plain: pseudo-reference")
	}
}

func TestNormalizeVistaAPIURL(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    string
		wantErr bool
	}{
		{name: "Vista HTTP is promoted to HTTPS", input: "http://tenant-rest.vistahost.com.br/", want: "https://tenant-rest.vistahost.com.br"},
		{name: "Vista hostname without scheme", input: "tenant-rest.vistahost.com.br", want: "https://tenant-rest.vistahost.com.br"},
		{name: "public HTTPS custom host", input: "https://api.example.com/base?ignored=true", want: "https://api.example.com/base"},
		{name: "email is not an API URL", input: "person@example.com", wantErr: true},
		{name: "private IPv4 is blocked", input: "https://127.0.0.1", wantErr: true},
		{name: "local host is blocked", input: "https://service.local", wantErr: true},
		{name: "plain HTTP custom host is blocked", input: "http://api.example.com", wantErr: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := normalizeVistaAPIURL(test.input)
			if test.wantErr {
				if err == nil {
					t.Fatalf("normalizeVistaAPIURL(%q) unexpectedly returned %q", test.input, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("normalizeVistaAPIURL(%q): %v", test.input, err)
			}
			if got != test.want {
				t.Fatalf("normalizeVistaAPIURL(%q) = %q, want %q", test.input, got, test.want)
			}
		})
	}
}
