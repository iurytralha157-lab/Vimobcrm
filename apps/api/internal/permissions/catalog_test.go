package permissions

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestResolveAppliesDefaultsAndLeaderScope(t *testing.T) {
	standard := Resolve("user", false, nil, nil)
	if !Has(standard, LeadViewOwn) || !Has(standard, LeadOperate) || !Has(standard, WhatsAppManage) || Has(standard, SettingsIntegrations) || Has(standard, LeadViewTeam) {
		t.Fatalf("unexpected standard permissions: %v", standard)
	}

	leader := Resolve("user", true, nil, nil)
	if !Has(leader, LeadViewTeam) || !Has(leader, TeamManage) || !Has(leader, WhatsAppManage) || Has(leader, SettingsIntegrations) || Has(leader, DistributionManage) {
		t.Fatalf("unexpected leader permissions: %v", leader)
	}
}

func TestResolveSupportsLegacyAliasesAndExplicitDeny(t *testing.T) {
	resolved := Resolve("user", false, []string{"lead_edit_all", "settings_pipelines"}, map[string]bool{
		LeadOperate: false,
	})
	if !Has(resolved, LeadViewAll) || !Has(resolved, PipelineManage) {
		t.Fatalf("legacy grants were not expanded: %v", resolved)
	}
	if Has(resolved, "lead_transfer") {
		t.Fatalf("explicit deny must remove canonical operation permission: %v", resolved)
	}
}

func TestAdminAlwaysResolvesWildcard(t *testing.T) {
	resolved := Resolve("admin", false, nil, map[string]bool{LeadOperate: false})
	if len(resolved) != 1 || resolved[0] != "*" {
		t.Fatalf("admin permissions = %v, want wildcard", resolved)
	}
}

func TestResolveAddsReadPermissionForManagementGrants(t *testing.T) {
	resolved := Resolve("user", false, nil, map[string]bool{
		AutomationsManage: true,
		FinancialManage:   true,
		WhatsAppManage:    true,
	})

	for _, permission := range []string{AutomationsView, FinancialView, WhatsAppView, WhatsAppOperate} {
		if !Has(resolved, permission) {
			t.Fatalf("management grant did not imply %s: %v", permission, resolved)
		}
	}
}

func TestOperationalManagementPermissionsImplyTeamRead(t *testing.T) {
	for _, granted := range []string{DistributionManage, PipelineManage} {
		resolved := Resolve("user", false, nil, map[string]bool{granted: true})
		if !Has(resolved, TeamView) {
			t.Fatalf("%s must imply %s: %v", granted, TeamView, resolved)
		}
	}
}

func TestActiveMigrationSeedsEveryCanonicalPermission(t *testing.T) {
	_, testFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("could not resolve catalog test path")
	}
	repositoryRoot := filepath.Clean(filepath.Join(filepath.Dir(testFile), "..", "..", "..", ".."))
	migrationPath := filepath.Join(
		repositoryRoot,
		"supabase",
		"migrations",
		"20260905120000_sync_available_permission_catalog.sql",
	)
	payload, err := os.ReadFile(migrationPath)
	if err != nil {
		t.Fatalf("read permission catalog migration: %v", err)
	}
	migration := string(payload)

	for _, definition := range Catalog() {
		if !strings.Contains(migration, "('"+definition.Key+"',") {
			t.Errorf("active migration is missing canonical permission %q", definition.Key)
		}
	}
}
