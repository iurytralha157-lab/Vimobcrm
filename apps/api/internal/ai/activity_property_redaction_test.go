package ai

import (
	"os"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestAIActivityProjectionRedactsInvisiblePropertyDetails(t *testing.T) {
	const visibleMarker = "VISIBLE_ACTIVITY_PROPERTY"
	metadataSQL := aiActivityMetadataSQL(
		tenant.Context{Permissions: []string{permissions.PropertyView}},
		visibleMarker,
	)
	for _, key := range []string{
		"property_id",
		"property_title",
		"property_code",
		"property_price",
		"property_image",
		"property_images",
		"property_media",
		"commission_percentage",
	} {
		if !strings.Contains(metadataSQL, "- '"+key+"'") {
			t.Fatalf("AI activity metadata does not redact %s: %s", key, metadataSQL)
		}
	}
	if !strings.Contains(metadataSQL, visibleMarker) {
		t.Fatalf("AI activity metadata does not consult property visibility: %s", metadataSQL)
	}

	contentSQL := aiActivityContentSQL(visibleMarker)
	for _, required := range []string{visibleMarker, "property_selected", "property_interest_reserved", "Imovel selecionado"} {
		if !strings.Contains(contentSQL, required) {
			t.Fatalf("AI activity content projection is missing %q: %s", required, contentSQL)
		}
	}

	referenceSQL := aiActivityPropertyReferenceSQL()
	for _, alias := range []string{"property_id", "propertyId", "interest_property_id", "interestPropertyId"} {
		if !strings.Contains(referenceSQL, "metadata->>'"+alias+"'") {
			t.Fatalf("AI activity property reference omits legacy alias %q: %s", alias, referenceSQL)
		}
	}
	hiddenSQL := aiHiddenActivityPropertySQL(visibleMarker)
	for _, required := range []string{
		"not (" + visibleMarker + ")",
		"a.type in ('property_selected', 'property_interest_reserved')",
		"coalesce(a.metadata, '{}'::jsonb) ?| array[",
		"'property_title'",
		"'property_code'",
		"'property_media'",
	} {
		if !strings.Contains(hiddenSQL, required) {
			t.Fatalf("AI activity property redaction is fail-open without a canonical property id; missing %q: %s", required, hiddenSQL)
		}
	}
}

func TestAILeadPropertyCodeIsVisibilityProjected(t *testing.T) {
	source, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatalf("read repository.go: %v", err)
	}
	query := string(source)
	for _, required := range []string{
		"left join public.properties lead_property",
		"lead_property.id = coalesce(l.interest_property_id, l.property_id)",
		"propertyscope.VisibilitySQL(\"lead_property\", \"$6\", \"$7\", \"$8\")",
		"lead_property.id is not null then l.property_code",
	} {
		if !strings.Contains(query, required) {
			t.Fatalf("AI lead property-code projection is missing %q", required)
		}
	}
}

func TestScopedPropertyVisibilityBindingsFailClosedWithoutPropertyRead(t *testing.T) {
	all, viewer, team := scopedPropertyVisibilityBindings(tenant.Context{
		UserID:       "20000000-0000-4000-8000-000000000001",
		IsTeamLeader: true,
		Permissions:  []string{permissions.LeadViewAll},
	})
	if all || viewer != nil || team {
		t.Fatalf("no-property-read bindings = all:%t viewer:%#v team:%t", all, viewer, team)
	}
}
