package tenant

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	authpkg "github.com/vimob-crm/vimob-crm/packages/auth"
)

type resolverFunc func(context.Context, string, string) (Context, error)

func (resolve resolverFunc) Resolve(ctx context.Context, userID, organizationID string) (Context, error) {
	return resolve(ctx, userID, organizationID)
}

func TestAttachForwardsOrganizationAndInjectsTenant(t *testing.T) {
	const userID = "10000000-0000-0000-0000-000000000001"
	const organizationID = "20000000-0000-0000-0000-000000000001"

	var resolvedUserID, requestedOrganizationID string
	resolver := resolverFunc(func(_ context.Context, user, organization string) (Context, error) {
		resolvedUserID = user
		requestedOrganizationID = organization
		return Context{UserID: user, OrganizationID: organization, MemberRole: "admin"}, nil
	})

	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tenantContext, ok := FromContext(r.Context())
		if !ok || tenantContext.OrganizationID != organizationID {
			t.Fatal("resolved tenant context was not attached")
		}
		w.WriteHeader(http.StatusNoContent)
	})

	request := httptest.NewRequest(http.MethodGet, "/v1/leads", nil)
	request.Header.Set(OrganizationHeader, "  "+organizationID+"  ")
	request = request.WithContext(httpserver.ContextWithUser(request.Context(), authpkg.User{ID: userID}))
	recorder := httptest.NewRecorder()

	Attach(resolver, next).ServeHTTP(recorder, request)

	if recorder.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusNoContent)
	}
	if resolvedUserID != userID || requestedOrganizationID != organizationID {
		t.Fatalf("Resolve() received user=%q organization=%q", resolvedUserID, requestedOrganizationID)
	}
}

func TestAttachRejectsMissingAuthenticatedUser(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/v1/leads", nil)
	recorder := httptest.NewRecorder()

	Attach(resolverFunc(func(context.Context, string, string) (Context, error) {
		t.Fatal("resolver must not run without an authenticated user")
		return Context{}, nil
	}), http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("next handler must not run")
	})).ServeHTTP(recorder, request)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusUnauthorized)
	}
}

func TestAttachMapsTenantResolutionErrors(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
	}{
		{name: "invalid organization id", err: ErrInvalidOrganizationID, wantStatus: http.StatusBadRequest, wantCode: "invalid_organization_id"},
		{name: "cross organization access", err: ErrOrganizationAccessDenied, wantStatus: http.StatusForbidden, wantCode: "organization_access_denied"},
		{name: "inactive user", err: ErrUserInactive, wantStatus: http.StatusForbidden, wantCode: "user_inactive"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "/v1/leads", nil)
			request = request.WithContext(httpserver.ContextWithUser(request.Context(), authpkg.User{ID: "10000000-0000-0000-0000-000000000001"}))
			recorder := httptest.NewRecorder()

			Attach(resolverFunc(func(context.Context, string, string) (Context, error) {
				return Context{}, test.err
			}), http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
				t.Fatal("next handler must not run")
			})).ServeHTTP(recorder, request)

			if recorder.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", recorder.Code, test.wantStatus)
			}
			if !strings.Contains(recorder.Body.String(), test.wantCode) {
				t.Fatalf("body = %q, want error code %q", recorder.Body.String(), test.wantCode)
			}
		})
	}
}

func TestRequireOrganization(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})

	missingRequest := httptest.NewRequest(http.MethodGet, "/v1/leads", nil)
	missingRecorder := httptest.NewRecorder()
	RequireOrganization(next).ServeHTTP(missingRecorder, missingRequest)
	if missingRecorder.Code != http.StatusForbidden {
		t.Fatalf("missing organization status = %d, want %d", missingRecorder.Code, http.StatusForbidden)
	}

	allowedRequest := httptest.NewRequest(http.MethodGet, "/v1/leads", nil)
	allowedRequest = allowedRequest.WithContext(ContextWithTenant(allowedRequest.Context(), Context{
		UserID:         "10000000-0000-0000-0000-000000000001",
		OrganizationID: "20000000-0000-0000-0000-000000000001",
	}))
	allowedRecorder := httptest.NewRecorder()
	RequireOrganization(next).ServeHTTP(allowedRecorder, allowedRequest)
	if allowedRecorder.Code != http.StatusNoContent {
		t.Fatalf("allowed organization status = %d, want %d", allowedRecorder.Code, http.StatusNoContent)
	}
}
