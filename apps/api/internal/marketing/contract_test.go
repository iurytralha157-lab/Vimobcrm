package marketing

import (
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
)

func productionSources(t *testing.T) map[string]string {
	t.Helper()
	paths, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	sources := map[string]string{}
	for _, path := range paths {
		if strings.HasSuffix(path, "_test.go") {
			continue
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		sources[path] = stripLineComments(string(raw))
	}
	if len(sources) == 0 {
		t.Fatal("no production sources found")
	}
	return sources
}

// Comments may name what the package avoids; only code and SQL are checked.
func stripLineComments(source string) string {
	lines := strings.Split(source, "\n")
	kept := lines[:0]
	for _, line := range lines {
		if !strings.HasPrefix(strings.TrimSpace(line), "//") {
			kept = append(kept, line)
		}
	}
	return strings.Join(kept, "\n")
}

// The lead intake depends on these objects. Marketing must never reach them.
func TestMarketingCodeNeverTouchesLeadIntake(t *testing.T) {
	forbidden := []string{
		"public.meta_integrations", "meta_oauth_flows", "meta_form_configs",
		"meta_webhook_events", "public.leads",
	}
	for path, source := range productionSources(t) {
		for _, item := range forbidden {
			if strings.Contains(source, item) {
				t.Errorf("%s references %s", path, item)
			}
		}
	}
}

func TestMarketingDoesNotImportLeadIntakePackages(t *testing.T) {
	forbidden := []string{"/internal/meta", "/internal/leads", "/internal/webhooks", "/internal/publicingress"}
	for path := range productionSources(t) {
		file, err := parser.ParseFile(token.NewFileSet(), path, nil, parser.ImportsOnly)
		if err != nil {
			t.Fatal(err)
		}
		for _, item := range file.Imports {
			value, _ := strconv.Unquote(item.Path.Value)
			for _, blocked := range forbidden {
				if strings.HasSuffix(value, blocked) {
					t.Errorf("%s imports %s", path, value)
				}
			}
		}
	}
}

// The Graph client is GET only, so it cannot subscribe or unsubscribe a Page,
// nor revoke the app with DELETE /me/permissions.
func TestMetaClientSourceCannotWriteToGraph(t *testing.T) {
	source := productionSources(t)["meta_client.go"]
	for _, item := range []string{"MethodPost", "MethodPut", "MethodPatch", "MethodDelete", "http.Post", `"POST"`, `"DELETE"`} {
		if strings.Contains(source, item) {
			t.Errorf("meta_client.go contains %s", item)
		}
	}
	if strings.Count(source, "http.NewRequestWithContext(") != 1 {
		t.Error("meta_client.go must have exactly one request constructor")
	}
	for path, text := range productionSources(t) {
		if strings.Contains(text, "subscribed_apps") {
			t.Errorf("%s uses subscribed_apps", path)
		}
	}
}

func TestMetaScopesExcludeLeadAndWritePermissions(t *testing.T) {
	for _, scope := range []string{
		"leads_retrieval", "pages_manage_ads", "pages_manage_metadata",
		"ads_management", "business_management", "pages_messaging",
	} {
		if slices.Contains(metaLoginScopes, scope) {
			t.Errorf("Marketing login must not request %s", scope)
		}
	}
}

func TestMigrationStaysAwayFromLeadIntakeTables(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "supabase", "migrations", "20261104120000_add_marketing_connections.sql"))
	if err != nil {
		t.Fatal(err)
	}
	var statements []string
	for _, line := range strings.Split(string(raw), "\n") {
		if !strings.HasPrefix(strings.TrimSpace(line), "--") {
			statements = append(statements, line)
		}
	}
	text := strings.Join(statements, "\n")
	for _, item := range []string{"meta_integrations", "meta_oauth_flows", "alter table public.leads", "marketing_accounts"} {
		if strings.Contains(text, item) {
			t.Errorf("migration references %s", item)
		}
	}
}
