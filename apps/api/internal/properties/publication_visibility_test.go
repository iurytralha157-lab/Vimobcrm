package properties

import (
	"os"
	"strings"
	"testing"
)

func TestPropertySitePublicationProjectionFollowsPublicSiteEligibility(t *testing.T) {
	t.Parallel()

	join := propertySitePublicationJoinSQL("p", "site_publication")
	for _, required := range []string{
		"public.property_channel_publications site_publication",
		"site_publication.organization_id = p.organization_id",
		"site_publication.property_id = p.id",
		"site_publication.channel = 'site'",
		"site_publication.channel_account_key = 'default'",
	} {
		if !strings.Contains(join, required) {
			t.Errorf("Site publication join is missing %q: %s", required, join)
		}
	}

	visibility := propertyPublishedOnSiteSQL("p", "site_publication")
	for _, required := range []string{
		"site_publication.id is not null",
		"site_publication.desired_state = 'published'",
		"site_publication.published_version is not null",
		"else coalesce(p.published_on_site, false)",
		"in ('active', 'ativo', 'available', 'disponivel', 'disponível')",
		"p.autorizado_comercializacao is distinct from false",
	} {
		if !strings.Contains(visibility, required) {
			t.Errorf("Site publication projection is missing %q: %s", required, visibility)
		}
	}
}

func TestPropertyCatalogUsesCanonicalSiteProjectionWithoutExtraRequests(t *testing.T) {
	t.Parallel()

	for _, boundary := range []struct{ file, start, next string }{
		{"repository_listing.go", "func (repo Repository) List(", "func (repo Repository) Stats("},
		{"repository_listing.go", "func (repo Repository) Stats(", ""},
		{"repository_read.go", "func (repo Repository) Get(", "type jsonTextProperty "},
	} {
		source, err := os.ReadFile(boundary.file)
		if err != nil {
			t.Fatal(err)
		}
		methods := string(source)
		start := strings.Index(methods, boundary.start)
		end := len(methods)
		if boundary.next != "" {
			end = strings.Index(methods, boundary.next)
		}
		if start < 0 || end <= start {
			t.Fatalf("missing method boundary %s", boundary.start)
		}
		method := methods[start:end]
		if !strings.Contains(method, "propertySitePublicationJoinSQL(\"p\", \"site_publication\")") ||
			!strings.Contains(method, "propertyPublishedOnSiteSQL(\"p\", \"site_publication\")") {
			t.Fatalf("%s does not project the canonical Site state in its SQL", boundary.start)
		}
	}
}
