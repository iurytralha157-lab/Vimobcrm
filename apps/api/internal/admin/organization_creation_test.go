package admin

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestSuperAdminOrganizationCreationUsesInvitationLifecycle(t *testing.T) {
	sourceBytes, err := os.ReadFile("organization_creation.go")
	if err != nil {
		t.Fatalf("read organization creation source: %v", err)
	}
	source := string(sourceBytes)

	for _, required := range []string{
		"insert into public.organizations",
		"insert into public.invitations",
		"token_hash",
		"invitationTokenHash(invitation.Token)",
		"invitation.Token, tokenHash",
		"'admin'",
		"pg_advisory_xact_lock",
		"findRecoverableOrganizationInvitation",
		"repo.classifyInvitationIdentity(ctx, invitation.ID, adminEmail)",
		"existingAccount := identity.requiresLogin()",
		"repo.sendInvitationEmail",
		`invitationResult["recoverable"] = true`,
	} {
		if !strings.Contains(source, required) {
			t.Errorf("organization creation must contain %q", required)
		}
	}

	for _, forbidden := range []string{
		"createAuthUser",
		"updateAuthUserPassword",
		"AdminPassword",
		"adminPassword",
		"temporary_password",
		"insert into public.users",
		"insert into public.organization_members",
		"returning id::text, token",
		"i.token,",
		"userIDByEmail",
	} {
		if strings.Contains(source, forbidden) {
			t.Errorf("organization creation must not contain %q", forbidden)
		}
	}

	commitIndex := strings.Index(source, "tx.Commit(ctx)")
	classificationIndex := strings.Index(source, "repo.classifyInvitationIdentity(ctx, invitation.ID, adminEmail)")
	emailIndex := strings.Index(source, "repo.sendInvitationEmail")
	if commitIndex == -1 || classificationIndex == -1 || emailIndex == -1 ||
		commitIndex >= classificationIndex || classificationIndex >= emailIndex {
		t.Fatal("organization invitation must commit, classify its exact identity, and only then send email")
	}
}

func TestCreateOrganizationRequestRejectsLegacyTemporaryPassword(t *testing.T) {
	decoder := json.NewDecoder(strings.NewReader(`{
		"name":"Imobiliaria Exemplo",
		"adminEmail":"admin@example.com",
		"adminName":"Pessoa Administradora",
		"adminPassword":"shared-secret"
	}`))
	decoder.DisallowUnknownFields()

	var request CreateOrganizationRequest
	if err := decoder.Decode(&request); err == nil {
		t.Fatal("legacy adminPassword must be rejected instead of creating a shared temporary credential")
	}
}
