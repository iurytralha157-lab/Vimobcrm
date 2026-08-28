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
	} {
		if strings.Contains(source, forbidden) {
			t.Errorf("organization creation must not contain %q", forbidden)
		}
	}

	commitIndex := strings.Index(source, "tx.Commit(ctx)")
	emailIndex := strings.Index(source, "repo.sendInvitationEmail")
	if commitIndex == -1 || emailIndex == -1 || commitIndex >= emailIndex {
		t.Fatal("organization and invitation must commit before the external email request")
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
