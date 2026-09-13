package properties

import (
	"os"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestPropertyUpdateAuthorizationAppliesConfiguredPolicy(t *testing.T) {
	t.Parallel()

	viewer := tenant.Context{
		UserID:         "user-1",
		OrganizationID: "org-1",
		MemberRole:     "user",
		Permissions:    []string{permissions.PropertyView},
	}

	tests := []struct {
		name        string
		context     tenant.Context
		policy      string
		ownerIDs    []string
		wantCanEdit bool
	}{
		{name: "everyone allows a viewer", context: viewer, policy: propertyEditPolicyEveryone, wantCanEdit: true},
		{name: "responsible allows creator", context: viewer, policy: propertyEditPolicyResponsibleOrAdmin, ownerIDs: []string{"user-1", "other"}, wantCanEdit: true},
		{name: "responsible allows legacy captor", context: viewer, policy: propertyEditPolicyResponsibleOrAdmin, ownerIDs: []string{"other", "user-1"}, wantCanEdit: true},
		{name: "responsible denies unrelated viewer", context: viewer, policy: propertyEditPolicyResponsibleOrAdmin, ownerIDs: []string{"other"}, wantCanEdit: false},
		{name: "unknown policy fails closed", context: viewer, policy: "custom", ownerIDs: []string{"user-1"}, wantCanEdit: false},
		{name: "viewer permission remains required", context: tenant.Context{UserID: "user-1", OrganizationID: "org-1", MemberRole: "user"}, policy: propertyEditPolicyEveryone, wantCanEdit: false},
		{name: "manager always edits", context: tenant.Context{UserID: "manager-1", OrganizationID: "org-1", MemberRole: "manager"}, policy: propertyEditPolicyResponsibleOrAdmin, wantCanEdit: true},
		{name: "manager still requires membership", context: tenant.Context{UserID: "manager-1", MemberRole: "manager"}, policy: propertyEditPolicyEveryone, wantCanEdit: false},
		{name: "property manager always edits", context: tenant.Context{UserID: "user-2", OrganizationID: "org-1", MemberRole: "user", Permissions: []string{permissions.PropertyManage}}, policy: propertyEditPolicyResponsibleOrAdmin, wantCanEdit: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := propertyUpdateAuthorizationFor(tt.context, tt.policy, "hidden", tt.ownerIDs...)
			if got.CanEdit != tt.wantCanEdit {
				t.Fatalf("CanEdit = %t, want %t", got.CanEdit, tt.wantCanEdit)
			}
		})
	}
}

func TestPropertyUpdateAuthorizationProtectsOwnerContacts(t *testing.T) {
	t.Parallel()

	viewer := tenant.Context{
		UserID:         "user-1",
		OrganizationID: "org-1",
		MemberRole:     "user",
		Permissions:    []string{permissions.PropertyView},
	}
	if propertyUpdateAuthorizationFor(viewer, propertyEditPolicyEveryone, "hidden").CanViewOwnerContacts {
		t.Fatal("hidden owner contacts must remain unavailable to a viewer allowed to edit")
	}
	if !propertyUpdateAuthorizationFor(viewer, propertyEditPolicyEveryone, "visible").CanViewOwnerContacts {
		t.Fatal("visible owner contacts should be editable by an allowed viewer")
	}

	manager := tenant.Context{
		UserID:         "manager-1",
		OrganizationID: "org-1",
		MemberRole:     "user",
		Permissions:    []string{permissions.PropertyManage},
	}
	if !propertyUpdateAuthorizationFor(manager, propertyEditPolicyResponsibleOrAdmin, "hidden").CanViewOwnerContacts {
		t.Fatal("property managers must retain owner contact access")
	}
}

func TestRemoveProtectedPropertyOwnerUpdatesKeepsOtherFields(t *testing.T) {
	t.Parallel()

	input := propertyRequest{
		"title":                   "Novo título",
		"owner_id":                nil,
		"owner_name":              "",
		"owner_phone_residential": "",
		"owner_phone_commercial":  "",
		"owner_cellphone":         "",
		"owner_email":             "",
		"owner_media_source":      "",
		"origin_media":            "indicacao-confidencial",
		"owner_notify_email":      false,
		"metadata": map[string]any{
			"summary":      "preservado",
			"owner_email":  "root@example.com",
			"origin_media": "portal-confidencial",
			"legacy": map[string]any{
				"owner_cellphone": "5511999999999",
				"origin_media":    "importacao-confidencial",
				"area_total":      120,
			},
		},
	}
	removeProtectedPropertyOwnerUpdates(input)

	if got := input["title"]; got != "Novo título" {
		t.Fatalf("unrelated field changed: %#v", got)
	}
	for _, field := range protectedPropertyOwnerUpdateFields {
		if _, exists := input[field]; exists {
			t.Fatalf("protected owner field was retained: %s", field)
		}
	}
	metadata := input["metadata"].(map[string]any)
	if _, exists := metadata["owner_email"]; exists {
		t.Fatal("protected owner field was retained in metadata")
	}
	if metadata["summary"] != "preservado" {
		t.Fatal("unrelated metadata was changed")
	}
	legacy := metadata["legacy"].(map[string]any)
	if _, exists := legacy["owner_cellphone"]; exists {
		t.Fatal("protected owner field was retained in legacy metadata")
	}
	if legacy["area_total"] != 120 {
		t.Fatal("unrelated legacy metadata was changed")
	}
}

func TestProtectedPropertyMediaUpdatesRequirePropertyManage(t *testing.T) {
	t.Parallel()

	for _, input := range []propertyRequest{
		{"imagem_principal": "https://media.example.test/main.jpg"},
		{"image_urls": []string{}},
		{"fotos": nil},
		{"documents": "[]"},
		{"arquivos": nil},
		{"tour_virtual": "https://media.example.test/tour"},
		{"video_imovel": "https://media.example.test/video"},
	} {
		if !hasProtectedPropertyMediaUpdate(input) {
			t.Fatalf("protected media update was not detected: %#v", input)
		}
	}

	for _, input := range []propertyRequest{
		{"title": "Edicao permitida"},
	} {
		if hasProtectedPropertyMediaUpdate(input) {
			t.Fatalf("unrelated update was classified as protected media: %#v", input)
		}
	}
}

func TestInternalPropertyUpdatesRequirePropertyManage(t *testing.T) {
	t.Parallel()

	for _, field := range workspacePropertyInternalFields {
		if !hasProtectedPropertyInternalUpdate(propertyRequest{field: nil}) {
			t.Fatalf("internal field %s was not protected", field)
		}
	}
	for _, input := range []propertyRequest{
		{"metadata": map[string]any{"hidden_site_image_urls": []any{}}},
		{"metadata": `{"legacy":{"hidden_site_image_urls":[]}}`},
	} {
		if !hasProtectedPropertyInternalUpdate(input) {
			t.Fatalf("nested internal metadata update was not protected: %#v", input)
		}
	}
	if hasProtectedPropertyInternalUpdate(propertyRequest{"title": "Edicao permitida"}) {
		t.Fatal("safe property title was classified as internal")
	}
}

func TestPropertyUpdateAuthorizationLookupIsTenantScoped(t *testing.T) {
	t.Parallel()

	raw, err := os.ReadFile("edit_policy.go")
	if err != nil {
		t.Fatalf("read edit_policy.go: %v", err)
	}
	source := string(raw)
	for _, required := range []string{
		"coalesce(o.property_edit_policy, 'responsible_or_admin')",
		"coalesce(o.property_owner_contact_visibility, 'hidden')",
		"coalesce(p.created_by::text, '')",
		"coalesce(p.responsible_user_id::text, '')",
		"coalesce(p.cadastrado_por, '')",
		"where p.organization_id = $1::uuid",
		"and p.id = $2::uuid",
		"propertyscope.CanRead(tenantContext)",
		"propertyVisibilitySQL(\"$3\", \"$4\", \"$5\", \"p\")",
		"canViewAllProperties(tenantContext)",
		"canViewTeamProperties(tenantContext)",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("authorization lookup is missing %q", required)
		}
	}
}

func TestPropertyUpdateUsesAuthorizationAndRedactsProtectedResponse(t *testing.T) {
	t.Parallel()

	raw, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatalf("read repository.go: %v", err)
	}
	source := string(raw)
	start := strings.Index(source, "func (repo Repository) Update(")
	end := strings.Index(source, "func (repo Repository) propertyHasDevelopmentUnitLink(")
	if start < 0 || end <= start {
		t.Fatal("property Update method was not found")
	}
	method := source[start:end]

	for _, required := range []string{
		"repo.propertyUpdateAuthorization(ctx, tx, tenantContext, propertyID)",
		"if !authorization.CanEdit",
		"hasProtectedPropertyInternalUpdate(input) || hasProtectedPropertyMediaUpdate(input)",
		"removeProtectedPropertyOwnerUpdates(input)",
		"return projectWorkspaceProperty(",
		"property[\"can_edit\"] = authorization.CanEdit",
	} {
		if !strings.Contains(method, required) {
			t.Fatalf("property Update policy contract is missing %q", required)
		}
	}
	authorizationIndex := strings.Index(method, "repo.propertyUpdateAuthorization(ctx, tx, tenantContext, propertyID)")
	protectedFieldsIndex := strings.Index(method, "hasProtectedPropertyInternalUpdate(input) || hasProtectedPropertyMediaUpdate(input)")
	assignmentPolicyIndex := strings.Index(method, "if !canAssignProperties(tenantContext)")
	versionIndex := strings.Index(method, "if enforceVersion && !propertyVersionMatches(current.UpdatedAt, expectedUpdatedAt)")
	if authorizationIndex < 0 || protectedFieldsIndex < 0 || assignmentPolicyIndex < 0 || versionIndex < 0 ||
		authorizationIndex > protectedFieldsIndex || protectedFieldsIndex > versionIndex || assignmentPolicyIndex > versionIndex {
		t.Fatal("property Update must complete edit, protected-field, and assignment authorization before revealing a stale-version conflict")
	}
	if !strings.Contains(method, "// AFTER UPDATE compatibility triggers") ||
		strings.Count(method, "reloadPropertyForMutation(ctx, tx, tenantContext.OrganizationID, propertyID)") != 1 {
		t.Fatal("property Update must reload its revision once after every update and compatibility trigger")
	}
}

func TestPropertyListDisablesSharedCachingOfRoleDependentProjection(t *testing.T) {
	t.Parallel()

	raw, err := os.ReadFile("handler.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	start := strings.Index(source, "func (handler Handler) List(")
	end := strings.Index(source, "func (handler Handler) Stats(")
	if start < 0 || end <= start ||
		!strings.Contains(source[start:end], "setPropertyWorkspacePrivateHeaders(w)") {
		t.Fatal("property List does not disable shared caching of role-dependent fields")
	}
}

func TestPropertyShowUsesTheSharedWorkspaceAllowlist(t *testing.T) {
	t.Parallel()

	raw, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	start := strings.Index(source, "func (repo Repository) Get(")
	end := strings.Index(source, "func (repo Repository) Create(")
	if start < 0 || end <= start {
		t.Fatal("property Get method was not found")
	}
	method := source[start:end]
	for _, required := range []string{
		"propertyUpdateAuthorizationFromProperty(",
		"property[\"can_edit\"] = authorization.CanEdit",
		"projectWorkspaceProperty(property, canManageProperties(tenantContext), authorization.CanViewOwnerContacts)",
	} {
		if !strings.Contains(method, required) {
			t.Fatalf("property Show shared capability/privacy contract is missing %q", required)
		}
	}

	handlerRaw, err := os.ReadFile("handler.go")
	if err != nil {
		t.Fatal(err)
	}
	handlerSource := string(handlerRaw)
	handlerStart := strings.Index(handlerSource, "func (handler Handler) Show(")
	handlerEnd := strings.Index(handlerSource, "func (handler Handler) History(")
	if handlerStart < 0 || handlerEnd <= handlerStart ||
		!strings.Contains(handlerSource[handlerStart:handlerEnd], "setPropertyWorkspacePrivateHeaders(w)") {
		t.Fatal("property Show does not disable shared caching of role-dependent fields")
	}
}
