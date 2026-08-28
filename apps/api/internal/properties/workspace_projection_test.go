package properties

import (
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestWorkspaceSQLProjectionsAreExplicitAllowlists(t *testing.T) {
	projections := map[string]string{
		"offer":     workspaceOfferProjection("offer", "true"),
		"ownership": workspaceOwnershipProjection("ownership", "owner", "true", "true"),
		"asset":     workspaceAssetProjection("asset", "true"),
		"key":       workspaceKeyProjection("property_key"),
		"movement":  workspaceKeyMovementProjection("movement"),
	}

	for name, projection := range projections {
		t.Run(name, func(t *testing.T) {
			if strings.Contains(strings.ToLower(projection), "to_jsonb") {
				t.Fatalf("%s projection must not serialize a whole row: %s", name, projection)
			}
			if !strings.Contains(projection, "jsonb_build_object") {
				t.Fatalf("%s projection must enumerate its response keys", name)
			}
		})
	}
}

func TestProjectWorkspacePropertyUsesRoleAwareAllowlist(t *testing.T) {
	source := Property{
		"id":                    "00000000-0000-4000-8000-000000000001",
		"organization_id":       "00000000-0000-4000-8000-000000000002",
		"title":                 "Apartamento",
		"zoneamento":            "ZR-4",
		"proximidades":          []string{"Escola", "Mercado"},
		"owner_cellphone":       "48999999999",
		"commission_percentage": 6.0,
		"comentarios_internos":  "nao expor",
		"aprovacao_ambiental":   "aprovada",
		"metadata":              map[string]any{"internal": true},
		"future_secret_column":  "must never leak",
	}

	viewer := projectWorkspaceProperty(source, false, false)
	if viewer["title"] != "Apartamento" {
		t.Fatalf("safe workspace field was removed: %#v", viewer)
	}
	if viewer["zoneamento"] != "ZR-4" {
		t.Fatalf("safe technical workspace field was removed: %#v", viewer)
	}
	if proximidades, ok := viewer["proximidades"].([]string); !ok || len(proximidades) != 2 {
		t.Fatalf("safe property surroundings were removed: %#v", viewer)
	}
	for _, forbidden := range []string{
		"owner_cellphone", "commission_percentage", "comentarios_internos",
		"aprovacao_ambiental", "metadata", "future_secret_column",
	} {
		if _, exists := viewer[forbidden]; exists {
			t.Fatalf("viewer projection leaked %s: %#v", forbidden, viewer)
		}
	}

	contactViewer := projectWorkspaceProperty(source, false, true)
	if contactViewer["owner_cellphone"] != "48999999999" {
		t.Fatalf("organization contact visibility was not honored: %#v", contactViewer)
	}
	if _, exists := contactViewer["metadata"]; exists {
		t.Fatalf("contact visibility must not expose internal metadata: %#v", contactViewer)
	}

	manager := projectWorkspaceProperty(source, true, true)
	if manager["commission_percentage"] != 6.0 || manager["comentarios_internos"] != "nao expor" || manager["aprovacao_ambiental"] != "aprovada" {
		t.Fatalf("manager projection omitted intentional internal fields: %#v", manager)
	}
	if _, exists := manager["future_secret_column"]; exists {
		t.Fatalf("future database columns must require an explicit contract change: %#v", manager)
	}
}

func TestViewerWorkspaceProjectionRedactsCommercialAndPhysicalInternals(t *testing.T) {
	offer := workspaceOfferProjection("offer", "false")
	if !strings.Contains(offer, "else '{}'::jsonb") {
		t.Fatalf("viewer offer projection must redact terms and metadata: %s", offer)
	}

	asset := workspaceAssetProjection("asset", "false")
	if !strings.Contains(asset, "then asset.storage_path else null") {
		t.Fatalf("viewer asset projection must hide storage paths: %s", asset)
	}

	movement := workspaceKeyMovementProjection("movement")
	if !strings.Contains(movement, "'idempotency_key', null") {
		t.Fatalf("movement projection must not echo idempotency keys: %s", movement)
	}
}

func TestWorkspaceReadUsesCanonicalPropertyVisibilityPredicate(t *testing.T) {
	tenantContext := tenant.Context{
		OrganizationID: "00000000-0000-4000-8000-000000000001",
		UserID:         "00000000-0000-4000-8000-000000000002",
		MemberRole:     "user",
		Permissions:    []string{"property_view"},
	}
	arguments, clause := workspaceReadVisibility(
		tenantContext,
		"00000000-0000-4000-8000-000000000003",
		false,
		false,
	)

	canonical := propertyVisibilitySQL("$5", "$6", "$7", "visible_property")
	if !strings.Contains(clause, canonical) {
		t.Fatalf("workspace read must reuse canonical visibility predicate: %s", clause)
	}
	if len(arguments) != 7 || arguments[4] != false || arguments[5] != tenantContext.UserID || arguments[6] != false {
		t.Fatalf("workspace visibility arguments do not match own/team/all scope: %#v", arguments)
	}
}

func TestLegacyWorkspaceReadUsesContiguousVisibilityArguments(t *testing.T) {
	const (
		organizationID = "00000000-0000-4000-8000-000000000001"
		userID         = "00000000-0000-4000-8000-000000000002"
		propertyID     = "00000000-0000-4000-8000-000000000003"
	)

	tests := []struct {
		name          string
		tenantContext tenant.Context
		canViewAll    bool
		canViewTeam   bool
	}{
		{
			name: "administrator",
			tenantContext: tenant.Context{
				OrganizationID: organizationID,
				UserID:         userID,
				MemberRole:     "admin",
			},
			canViewAll:  true,
			canViewTeam: true,
		},
		{
			name: "restricted visibility",
			tenantContext: tenant.Context{
				OrganizationID: organizationID,
				UserID:         userID,
				MemberRole:     "user",
				Permissions:    []string{"property_view"},
			},
		},
		{
			name: "team visibility",
			tenantContext: tenant.Context{
				OrganizationID: organizationID,
				UserID:         userID,
				MemberRole:     "user",
				Permissions:    []string{"property_view"},
				IsTeamLeader:   true,
			},
			canViewTeam: true,
		},
	}

	wantClause := strings.Join([]string{
		"visible_property.organization_id = $1::uuid",
		"visible_property.id = $2::uuid",
		propertyVisibilitySQL("$3", "$4", "$5", "visible_property"),
	}, " and ")

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			arguments, clause := legacyWorkspaceReadVisibility(test.tenantContext, propertyID)

			if clause != wantClause {
				t.Fatalf("legacy workspace placeholders must be contiguous from $1 through $5; got %s", clause)
			}
			if len(arguments) != 5 {
				t.Fatalf("legacy workspace query must receive exactly five used arguments, got %#v", arguments)
			}
			if arguments[0] != organizationID || arguments[1] != propertyID {
				t.Fatalf("legacy workspace identity arguments are out of order: %#v", arguments)
			}
			if arguments[2] != test.canViewAll || arguments[3] != userID || arguments[4] != test.canViewTeam {
				t.Fatalf("legacy workspace visibility arguments are out of order: %#v", arguments)
			}
		})
	}
}
