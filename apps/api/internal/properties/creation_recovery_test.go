package properties

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func creationRecoveryActor() tenant.Context {
	return tenant.Context{UserID: "20000000-0000-4000-8000-000000000001", OrganizationID: "10000000-0000-4000-8000-000000000001",
		MemberRole: "admin", EnabledModules: []string{"properties"}, SubscriptionType: "free", SubscriptionStatus: "active"}
}

func creationRecoveryRequest(query string, actor tenant.Context) *http.Request {
	r := httptest.NewRequest(http.MethodGet, "/v1/properties/30000000-0000-4000-8000-000000000001"+query, nil)
	r.SetPathValue("id", "30000000-0000-4000-8000-000000000001")
	return r.WithContext(tenant.ContextWithTenant(r.Context(), actor))
}

func TestPropertyCreationRecoveryRechecksCurrentTenantBeforeProvingGone(t *testing.T) {
	actor := creationRecoveryActor()
	for _, test := range []struct {
		name   string
		change func(*tenant.Context)
	}{
		{"revoked management", func(c *tenant.Context) { c.MemberRole = "user"; c.Permissions = []string{"property_view"} }},
		{"different actor", func(c *tenant.Context) { c.UserID = "20000000-0000-4000-8000-000000000002" }},
		{"different organization", func(c *tenant.Context) { c.OrganizationID = "10000000-0000-4000-8000-000000000002" }},
		{"disabled module", func(c *tenant.Context) { c.EnabledModules = nil }},
		{"expired billing", func(c *tenant.Context) { c.SubscriptionStatus = "inactive" }},
	} {
		t.Run(test.name, func(t *testing.T) {
			current := actor
			test.change(&current)
			read := false
			handler := Handler{
				resolveCreationRecoveryTenant: func(_ context.Context, userID, orgID string) (tenant.Context, error) {
					if userID != actor.UserID || orgID != actor.OrganizationID {
						t.Fatal("recovery changed requested identity")
					}
					return current, nil
				},
				readProperty: func(context.Context, tenant.Context, string) (Property, error) {
					read = true
					return nil, ErrPropertyNotFound
				},
			}
			response := httptest.NewRecorder()
			handler.Show(response, creationRecoveryRequest("?creation_recovery=true", actor))
			if response.Code != http.StatusForbidden || read || strings.Contains(response.Body.String(), "property_creation_resource_removed") {
				t.Fatalf("unauthorized recovery manufactured deletion proof: %d read=%v %s", response.Code, read, response.Body.String())
			}
		})
	}
}

func TestPropertyCreationRecoveryReturnsGoneOnlyForAuthorizedMissingResource(t *testing.T) {
	actor := creationRecoveryActor()
	for _, test := range []struct {
		name      string
		readError error
		status    int
	}{
		{"missing property", ErrPropertyNotFound, http.StatusGone},
		{"temporary read failure", errors.New("temporary database failure"), http.StatusInternalServerError},
		{"live property", nil, http.StatusOK},
	} {
		t.Run(test.name, func(t *testing.T) {
			resolved := false
			handler := Handler{
				resolveCreationRecoveryTenant: func(context.Context, string, string) (tenant.Context, error) { resolved = true; return actor, nil },
				readProperty: func(_ context.Context, current tenant.Context, id string) (Property, error) {
					if !resolved || !canCreateProperties(current) {
						t.Fatal("read preceded fresh authorization")
					}
					return Property{"id": id}, test.readError
				},
			}
			response := httptest.NewRecorder()
			handler.Show(response, creationRecoveryRequest("?creation_recovery=true", actor))
			if response.Code != test.status {
				t.Fatalf("recovery status = %d %s", response.Code, response.Body.String())
			}
			if (test.status == http.StatusGone) != strings.Contains(response.Body.String(), "property_creation_resource_removed") {
				t.Fatalf("wrong deletion proof: %s", response.Body.String())
			}
			if response.Header().Get("Cache-Control") != "private, no-store" {
				t.Fatal("recovery may be cached")
			}
		})
	}
}

func TestPropertyCreationRecoveryFlagIsExactAndOrdinaryNotFoundStaysAmbiguous(t *testing.T) {
	actor := creationRecoveryActor()
	actor.MemberRole = "user"
	for _, query := range []string{"", "?creation_recovery=false", "?creation_recovery=TRUE", "?creation_recovery=1", "?creation_recovery=%20true%20", "?creation_recovery=true&creation_recovery=false"} {
		handler := Handler{
			resolveCreationRecoveryTenant: func(context.Context, string, string) (tenant.Context, error) {
				t.Fatal("ordinary GET became recovery")
				return tenant.Context{}, nil
			},
			readProperty: func(context.Context, tenant.Context, string) (Property, error) { return nil, ErrPropertyNotFound },
		}
		response := httptest.NewRecorder()
		handler.Show(response, creationRecoveryRequest(query, actor))
		if response.Code != http.StatusNotFound || strings.Contains(response.Body.String(), "property_creation_resource_removed") {
			t.Fatalf("ordinary hidden/missing resource is not proof: %s %d %s", query, response.Code, response.Body.String())
		}
	}
}

func TestPropertyCreationRecoveryInvalidIdentifierCannotProveDeletion(t *testing.T) {
	actor := creationRecoveryActor()
	handler := Handler{resolveCreationRecoveryTenant: func(context.Context, string, string) (tenant.Context, error) { return actor, nil }}
	r := creationRecoveryRequest("?creation_recovery=true", actor)
	r.SetPathValue("id", "broken-id")
	response := httptest.NewRecorder()
	handler.Show(response, r)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("invalid identifier status = %d", response.Code)
	}
}

func TestPropertyCreationRecoveryAllowsExplicitManageWithoutViewPermission(t *testing.T) {
	actor := creationRecoveryActor()
	actor.MemberRole = "user"
	actor.Permissions = []string{"property_manage"}
	handler := Handler{
		resolveCreationRecoveryTenant: func(context.Context, string, string) (tenant.Context, error) { return actor, nil },
		readProperty: func(_ context.Context, current tenant.Context, _ string) (Property, error) {
			if !canManageProperties(current) {
				t.Fatal("manage-only creator lost full organization scope")
			}
			return nil, ErrPropertyNotFound
		},
	}
	response := httptest.NewRecorder()
	handler.Show(response, creationRecoveryRequest("?creation_recovery=true", actor))
	if response.Code != http.StatusGone {
		t.Fatalf("manage-only recovery = %d %s", response.Code, response.Body.String())
	}
}
