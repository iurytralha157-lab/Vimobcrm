package meta

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestSharedPageMigrationsUseFormScopedLeadgenOwnership(t *testing.T) {
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	root := filepath.Clean(filepath.Join(filepath.Dir(filename), "../../../.."))
	paths := []string{
		filepath.Join(root, "supabase/migrations/20260731120000_marketing_intelligence_foundation.sql"),
		filepath.Join(root, "supabase/migrations/20260831053204_allow_shared_meta_pages_with_form_scoped_webhooks.sql"),
	}

	foundation, err := os.ReadFile(paths[0])
	if err != nil {
		t.Fatal(err)
	}
	foundationText := strings.ToLower(string(foundation))
	for _, required := range []string{
		"revoke all on table public.meta_integrations",
		"revoke all on table public.meta_form_configs",
		"from public, anon, authenticated",
	} {
		if !strings.Contains(foundationText, required) {
			t.Fatalf("shared Page support must preserve the BFF-only Meta RLS boundary; missing %q", required)
		}
	}

	forward, err := os.ReadFile(paths[1])
	if err != nil {
		t.Fatal(err)
	}
	forwardText := strings.ToLower(string(forward))
	for _, required := range []string{
		"drop index if exists public.uq_meta_integrations_connected_page_owner",
		"drop index if exists public.uq_meta_integrations_connected_instagram_owner",
		"create unique index if not exists uq_meta_form_configs_active_provider_route",
		"on public.meta_form_configs (btrim(form_id))",
		"where coalesce(is_active, true) = true",
		"create index if not exists idx_meta_integrations_connected_page_route",
		"create index if not exists idx_meta_integrations_connected_instagram_route",
		"meta_active_form_has_multiple_tenant_routes",
	} {
		if !strings.Contains(forwardText, required) {
			t.Errorf("forward migration %s is missing %q", filepath.Base(paths[1]), required)
		}
	}
	for _, forbidden := range []string{
		"create unique index if not exists uq_meta_integrations_connected_page_owner",
		"create unique index if not exists uq_meta_integrations_connected_instagram_owner",
		"meta_connected_asset_has_multiple_tenant_owners",
		"disable row level security",
	} {
		if strings.Contains(forwardText, forbidden) {
			t.Errorf("forward migration still enforces tenant ownership by Page/Instagram asset: %q", forbidden)
		}
	}
	if strings.Contains(forwardText, "grant ") {
		t.Fatal("the shared Page forward migration must not expand database privileges")
	}
}
