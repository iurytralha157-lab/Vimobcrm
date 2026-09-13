package app

import (
	"os"
	"strings"
	"testing"
)

func TestInvitationRolePatchRouteRequiresUsersManage(t *testing.T) {
	source, err := os.ReadFile("routes.go")
	if err != nil {
		t.Fatalf("read app routes: %v", err)
	}
	required := `mux.Handle("PATCH /v1/invitations/{id}", withPermission(permissions.UsersManage, http.HandlerFunc(adminHandler.UpdateInvitationRole)))`
	if !strings.Contains(string(source), required) {
		t.Fatal("invitation role PATCH must be registered behind users_manage")
	}
}

func TestInvitationRolePatchIsDocumentedInOpenAPI(t *testing.T) {
	source, err := os.ReadFile("../../../../packages/contracts/openapi/v1.yaml")
	if err != nil {
		t.Fatalf("read OpenAPI contract: %v", err)
	}
	contract := strings.ReplaceAll(string(source), "\r\n", "\n")
	path := openAPIInvitationRolePatchSource(t, contract)

	for _, required := range []string{
		"patch:",
		`$ref: "#/components/parameters/OrganizationIdHeader"`,
		`$ref: "#/components/parameters/PathId"`,
		`$ref: "#/components/schemas/InvitationRoleUpdateRequest"`,
		`$ref: "#/components/schemas/OrganizationInvitationEnvelope"`,
		`"400":`,
		`"403":`,
		`"404":`,
		"preserves the invitation token and expiry",
	} {
		if !strings.Contains(path, required) {
			t.Fatalf("invitation role PATCH OpenAPI operation is missing %q", required)
		}
	}

	for _, required := range []string{
		"InvitationRole:",
		"enum: [user, manager, admin]",
		"InvitationRoleUpdateRequest:",
		"additionalProperties: false",
		"required: [role]",
		"OrganizationInvitationEnvelope:",
	} {
		if !strings.Contains(contract, required) {
			t.Fatalf("invitation role PATCH OpenAPI schemas are missing %q", required)
		}
	}

	invitationSchema := openAPISchemaSource(t, contract, "OrganizationInvitation")
	if strings.Contains(invitationSchema, "token:") || strings.Contains(invitationSchema, "token_hash:") {
		t.Fatal("invitation response schema must not expose transition credentials")
	}
}

func openAPIInvitationRolePatchSource(t *testing.T, contract string) string {
	t.Helper()
	start := strings.Index(contract, "  /v1/invitations/{id}:\n")
	if start < 0 {
		t.Fatal("OpenAPI path /v1/invitations/{id} is missing")
	}
	rest := contract[start:]
	end := strings.Index(rest, "\ncomponents:")
	if end < 0 {
		t.Fatal("could not isolate invitation role PATCH path")
	}
	return rest[:end]
}

func openAPISchemaSource(t *testing.T, contract string, name string) string {
	t.Helper()
	marker := "    " + name + ":\n"
	start := strings.Index(contract, marker)
	if start < 0 {
		t.Fatalf("OpenAPI schema %s is missing", name)
	}
	rest := contract[start+len(marker):]
	end := strings.Index(rest, "\n    ")
	if end < 0 {
		return rest
	}
	return rest[:end]
}
