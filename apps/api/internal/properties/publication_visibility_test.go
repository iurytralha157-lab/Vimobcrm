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
		"'available', 'disponivel'",
	} {
		if !strings.Contains(visibility, required) {
			t.Errorf("Site publication projection is missing %q: %s", required, visibility)
		}
	}
}

func TestPropertyCatalogUsesCanonicalSiteProjectionWithoutExtraRequests(t *testing.T) {
	t.Parallel()

	source, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatal(err)
	}
	methods := string(source)
	for _, boundary := range [][2]string{
		{"func (repo Repository) List(", "func (repo Repository) Stats("},
		{"func (repo Repository) Stats(", "func propertyStatusAliases("},
		{"func (repo Repository) Get(", "func (repo Repository) Create("},
	} {
		start := strings.Index(methods, boundary[0])
		end := strings.Index(methods, boundary[1])
		if start < 0 || end <= start {
			t.Fatalf("missing method boundary %s", boundary[0])
		}
		method := methods[start:end]
		if !strings.Contains(method, "propertySitePublicationJoinSQL(\"p\", \"site_publication\")") ||
			!strings.Contains(method, "propertyPublishedOnSiteSQL(\"p\", \"site_publication\")") {
			t.Fatalf("%s does not project the canonical Site state in its SQL", boundary[0])
		}
	}
}
