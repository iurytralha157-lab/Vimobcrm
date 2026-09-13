package portals

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestChavesNaMaoPublicationRepositoryRejectsSettingsOnlyAccess(t *testing.T) {
	t.Parallel()

	repo := Repository{chavesNaMaoEnabled: true}
	tenantContext := tenant.Context{
		OrganizationID: "10000000-0000-4000-8000-000000000001",
		UserID:         "20000000-0000-4000-8000-000000000001",
		MemberRole:     "user",
		Permissions:    []string{permissions.SettingsIntegrations},
	}

	if _, err := repo.ListChavesNaMaoPublications(context.Background(), tenantContext); !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatalf("ListChavesNaMaoPublications error = %v, want organization access denied", err)
	}
	viewerContext := tenantContext
	viewerContext.Permissions = append(viewerContext.Permissions, permissions.PropertyView)
	if _, err := repo.UpsertChavesNaMaoPublications(context.Background(), viewerContext, UpsertPublicationsRequest{}); !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatalf("UpsertChavesNaMaoPublications error = %v, want organization access denied", err)
	}
}

func TestChavesNaMaoPublicationRepositoryUsesCanonicalPropertyScope(t *testing.T) {
	t.Parallel()

	raw, err := os.ReadFile("chaves_na_mao_repository.go")
	if err != nil {
		t.Fatalf("read chaves_na_mao_repository.go: %v", err)
	}
	source := string(raw)
	listStart := strings.Index(source, "func (repo Repository) ListChavesNaMaoPublications(")
	upsertStart := strings.Index(source, "func (repo Repository) UpsertChavesNaMaoPublications(")
	if listStart < 0 || upsertStart <= listStart {
		t.Fatal("could not isolate Chaves na Mao publication repository methods")
	}
	listSection := source[listStart:upsertStart]
	for _, required := range []string{
		"if !propertyscope.CanRead(tenantContext)",
		`propertyscope.VisibilitySQL("property", "$2", "$3", "$4")`,
		"propertyscope.CanViewAll(tenantContext)",
		"tenantContext.UserID",
		"propertyscope.CanViewTeam(tenantContext)",
	} {
		if !strings.Contains(listSection, required) {
			t.Fatalf("Chaves na Mao publication read scope is missing %q", required)
		}
	}

	upsertSection := source[upsertStart:]
	guard := "if !propertyscope.CanViewAll(tenantContext)"
	emptyRequest := "if len(request.Publications) == 0"
	guardIndex := strings.Index(upsertSection, guard)
	emptyIndex := strings.Index(upsertSection, emptyRequest)
	if guardIndex < 0 || emptyIndex < 0 || guardIndex > emptyIndex {
		t.Fatal("Chaves na Mao publication write guard must run before the empty-request readback")
	}
}
