package leads

import (
	"os"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/propertyscope"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestAppendCanonicalPropertyVisibilityFailsClosedWithoutPropertyRead(t *testing.T) {
	context := tenant.Context{
		OrganizationID: "10000000-0000-4000-8000-000000000001",
		UserID:         "20000000-0000-4000-8000-000000000001",
		Permissions:    []string{permissions.LeadViewAll, permissions.DashboardView},
		IsTeamLeader:   true,
	}
	args, clause := appendCanonicalPropertyVisibility([]any{"seed"}, context, "property")
	if len(args) != 4 || args[1] != false || args[2] != nil || args[3] != false {
		t.Fatalf("no-property-read bindings = %#v, want all=false/user=nil/team=false", args)
	}
	want := propertyscope.VisibilitySQL("property", "$2", "$3", "$4")
	if clause != want {
		t.Fatalf("visibility clause = %q, want canonical %q", clause, want)
	}
}

func TestAppendCanonicalPropertyVisibilityPreservesOwnTeamAndManageSemantics(t *testing.T) {
	const userID = "20000000-0000-4000-8000-000000000001"
	tests := []struct {
		name     string
		context  tenant.Context
		wantAll  bool
		wantUser any
		wantTeam bool
	}{
		{name: "own viewer", context: tenant.Context{UserID: userID, Permissions: []string{permissions.PropertyView}}, wantUser: userID},
		{name: "team leader", context: tenant.Context{UserID: userID, Permissions: []string{permissions.PropertyView}, IsTeamLeader: true}, wantUser: userID, wantTeam: true},
		{name: "legacy all alias stays scoped", context: tenant.Context{UserID: userID, Permissions: []string{"property_view_all"}}, wantUser: userID},
		{name: "legacy team alias stays scoped", context: tenant.Context{UserID: userID, Permissions: []string{"property_view_team"}}, wantUser: userID},
		{name: "property manager", context: tenant.Context{UserID: userID, Permissions: []string{permissions.PropertyManage}}, wantAll: true, wantUser: userID},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			args, _ := appendCanonicalPropertyVisibility(nil, test.context, "p")
			if len(args) != 3 || args[0] != test.wantAll || args[1] != test.wantUser || args[2] != test.wantTeam {
				t.Fatalf("visibility bindings = %#v, want [%t %#v %t]", args, test.wantAll, test.wantUser, test.wantTeam)
			}
		})
	}
}

func TestDashboardPropertyValueHidesManagedAppraisalFromScopedViewer(t *testing.T) {
	viewerSQL := dashboardPropertyValueSQL(tenant.Context{Permissions: []string{permissions.PropertyView}})
	if strings.Contains(viewerSQL, "valor_venda_avaliado") {
		t.Fatalf("viewer dashboard value exposes managed appraisal: %s", viewerSQL)
	}
	managerSQL := dashboardPropertyValueSQL(tenant.Context{Permissions: []string{permissions.PropertyManage}})
	if !strings.Contains(managerSQL, "valor_venda_avaliado") {
		t.Fatalf("manager dashboard value lost managed appraisal fallback: %s", managerSQL)
	}
}

func TestPipelineBoardPropertyReferencesAreVisibilityProjected(t *testing.T) {
	const marker = "CANONICAL_PROPERTY_VISIBILITY"
	selectSQL := pipelineBoardLeadSelectFields(marker)
	for _, column := range []string{"property_id", "interest_property_id"} {
		if !strings.Contains(selectSQL, "visible_property.id = l."+column) {
			t.Fatalf("pipeline select does not project %s through property lookup: %s", column, selectSQL)
		}
	}
	if strings.Count(selectSQL, marker) != 2 {
		t.Fatalf("pipeline select visibility uses = %d, want 2: %s", strings.Count(selectSQL, marker), selectSQL)
	}
	if strings.Contains(selectSQL, "\n\t\tl.property_id,") || strings.Contains(selectSQL, "\n\t\tl.interest_property_id,") {
		t.Fatalf("pipeline select contains raw property reference: %s", selectSQL)
	}
}

func TestActivityProjectionRedactsInvisiblePropertyDetails(t *testing.T) {
	const visibleMarker = "VISIBLE_ACTIVITY_PROPERTY"
	viewerSQL := activityMetadataSQL(
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
		"commissionPercentage",
	} {
		if !strings.Contains(viewerSQL, "- '"+key+"'") {
			t.Fatalf("viewer activity metadata does not redact %s: %s", key, viewerSQL)
		}
	}
	if !strings.Contains(viewerSQL, visibleMarker) {
		t.Fatalf("activity metadata does not consult canonical property visibility: %s", viewerSQL)
	}

	managerSQL := activityMetadataSQL(
		tenant.Context{Permissions: []string{permissions.PropertyManage}},
		visibleMarker,
	)
	if !strings.Contains(managerSQL, "else coalesce(a.metadata, '{}'::jsonb)") {
		t.Fatalf("visible manager activity metadata lost its unredacted branch: %s", managerSQL)
	}

	contentSQL := activityContentSQL(visibleMarker)
	for _, required := range []string{visibleMarker, "property_selected", "property_interest_reserved", "Imovel selecionado"} {
		if !strings.Contains(contentSQL, required) {
			t.Fatalf("activity content projection is missing %q: %s", required, contentSQL)
		}
	}
	referenceSQL := activityPropertyReferenceSQL()
	for _, alias := range []string{"property_id", "propertyId", "interest_property_id", "interestPropertyId"} {
		if !strings.Contains(referenceSQL, "metadata->>'"+alias+"'") {
			t.Fatalf("activity property reference omits legacy alias %q: %s", alias, referenceSQL)
		}
	}
	hiddenSQL := hiddenActivityPropertySQL(visibleMarker)
	for _, required := range []string{
		"not (" + visibleMarker + ")",
		"a.type in ('property_selected', 'property_interest_reserved')",
		"coalesce(a.metadata, '{}'::jsonb) ?| array[",
		"'property_title'",
		"'property_code'",
		"'property_media'",
	} {
		if !strings.Contains(hiddenSQL, required) {
			t.Fatalf("activity property redaction is fail-open without a canonical property id; missing %q: %s", required, hiddenSQL)
		}
	}
}

func TestLeadPropertyConsumersUseScopedSafeProjections(t *testing.T) {
	checks := []struct {
		file     string
		required []string
	}{
		{
			file: "enrichment.go",
			required: []string{
				"len(propertyIDs) > 0 && propertyscope.CanRead(tenantContext)",
				"appendCanonicalPropertyVisibility(propertyArgs, tenantContext, \"property\")",
				"and `+propertyVisibility+`",
			},
		},
		{
			file: "dashboard.go",
			required: []string{
				"dashboardPropertyValueSQL(tenantContext)",
				"appendCanonicalPropertyVisibility(args, tenantContext, \"p\")",
			},
		},
		{
			file: "repository.go",
			required: []string{
				"includeManagedCommission := propertyscope.CanViewAll(tenantContext)",
				"propertyscope.VisibilitySQL(\"property\", \"$3\", \"$4\", \"$5\")",
				"if includeManagedCommission {",
			},
		},
	}
	for _, check := range checks {
		raw, err := os.ReadFile(check.file)
		if err != nil {
			t.Fatalf("read %s: %v", check.file, err)
		}
		source := string(raw)
		for _, required := range check.required {
			if !strings.Contains(source, required) {
				t.Errorf("%s is missing scoped consumer contract %q", check.file, required)
			}
		}
	}
}
