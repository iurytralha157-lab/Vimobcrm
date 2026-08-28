package tenant

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

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

func TestRequireBillingAccess(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	future := time.Now().Add(time.Hour)

	tests := []struct {
		name           string
		tenantContext  *Context
		wantStatusCode int
		wantErrorCode  string
	}{
		{
			name:           "missing context fails closed",
			wantStatusCode: http.StatusPaymentRequired,
			wantErrorCode:  "billing_access_required",
		},
		{
			name: "active paid organization is allowed",
			tenantContext: &Context{
				OrganizationID:     "20000000-0000-0000-0000-000000000001",
				SubscriptionType:   "paid",
				SubscriptionStatus: "active",
			},
			wantStatusCode: http.StatusNoContent,
		},
		{
			name: "overdue organization inside grace is allowed",
			tenantContext: &Context{
				OrganizationID:     "20000000-0000-0000-0000-000000000001",
				SubscriptionType:   "paid",
				SubscriptionStatus: "overdue",
				BillingGraceUntil:  &future,
			},
			wantStatusCode: http.StatusNoContent,
		},
		{
			name: "blocked organization receives payment required",
			tenantContext: &Context{
				OrganizationID:     "20000000-0000-0000-0000-000000000001",
				SubscriptionType:   "paid",
				SubscriptionStatus: "suspended",
			},
			wantStatusCode: http.StatusPaymentRequired,
			wantErrorCode:  "billing_access_required",
		},
		{
			name: "super admin bypasses organization billing",
			tenantContext: &Context{
				IsSuperAdmin:       true,
				SubscriptionType:   "paid",
				SubscriptionStatus: "suspended",
			},
			wantStatusCode: http.StatusNoContent,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "/v1/leads", nil)
			if test.tenantContext != nil {
				request = request.WithContext(ContextWithTenant(request.Context(), *test.tenantContext))
			}
			recorder := httptest.NewRecorder()

			RequireBillingAccess(nil, next).ServeHTTP(recorder, request)

			if recorder.Code != test.wantStatusCode {
				t.Fatalf("status = %d, want %d", recorder.Code, test.wantStatusCode)
			}
			if test.wantErrorCode != "" && !strings.Contains(recorder.Body.String(), test.wantErrorCode) {
				t.Fatalf("body = %q, want error code %q", recorder.Body.String(), test.wantErrorCode)
			}
		})
	}
}

func TestRequireBillingAccessUsesExactRouteAllowlist(t *testing.T) {
	allowlist := NewBillingAccessAllowlist(
		" GET   /v1/me ",
		"POST /v1/admin/error-events/{id}/resolve",
		"GET /v1/settings/subscription",
	)
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	middleware := RequireBillingAccess(allowlist, next)

	tests := []struct {
		name           string
		pattern        string
		method         string
		path           string
		wantStatusCode int
	}{
		{
			name:           "exact me route is allowed",
			pattern:        "GET /v1/me",
			method:         http.MethodGet,
			path:           "/v1/me",
			wantStatusCode: http.StatusNoContent,
		},
		{
			name:           "dynamic telemetry route is allowed by registered pattern",
			pattern:        "POST /v1/admin/error-events/{id}/resolve",
			method:         http.MethodPost,
			path:           "/v1/admin/error-events/event-1/resolve",
			wantStatusCode: http.StatusNoContent,
		},
		{
			name:           "financial recovery route is allowed",
			pattern:        "GET /v1/settings/subscription",
			method:         http.MethodGet,
			path:           "/v1/settings/subscription",
			wantStatusCode: http.StatusNoContent,
		},
		{
			name:           "different method is denied",
			pattern:        "POST /v1/me",
			method:         http.MethodPost,
			path:           "/v1/me",
			wantStatusCode: http.StatusPaymentRequired,
		},
		{
			name:           "path prefix is not implicitly allowed",
			pattern:        "GET /v1/me/private",
			method:         http.MethodGet,
			path:           "/v1/me/private",
			wantStatusCode: http.StatusPaymentRequired,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(test.method, test.path, nil)
			request.Pattern = test.pattern
			recorder := httptest.NewRecorder()

			middleware.ServeHTTP(recorder, request)

			if recorder.Code != test.wantStatusCode {
				t.Fatalf("status = %d, want %d; body=%s", recorder.Code, test.wantStatusCode, recorder.Body.String())
			}
		})
	}
}

func TestBillingAccessAllowlistFallsBackToExactMethodAndPath(t *testing.T) {
	allowlist := NewBillingAccessAllowlist("GET /v1/me")
	request := httptest.NewRequest(http.MethodGet, "/v1/me?source=test", nil)

	if !allowlist.Allows(request) {
		t.Fatal("expected exact method and URL path fallback to be allowed")
	}
}

func TestBillingAccessAllowlistUsesServeMuxRoutePattern(t *testing.T) {
	const pattern = "POST /v1/admin/error-events/{id}/resolve"
	allowlist := NewBillingAccessAllowlist(pattern)
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Pattern != pattern {
			t.Fatalf("request pattern = %q, want %q", r.Pattern, pattern)
		}
		w.WriteHeader(http.StatusNoContent)
	})
	mux := http.NewServeMux()
	mux.Handle(pattern, RequireBillingAccess(allowlist, next))

	request := httptest.NewRequest(http.MethodPost, "/v1/admin/error-events/event-1/resolve", nil)
	recorder := httptest.NewRecorder()
	mux.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d; body=%s", recorder.Code, http.StatusNoContent, recorder.Body.String())
	}
}

func TestRequireModule(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})

	tests := []struct {
		name           string
		tenantContext  Context
		module         string
		wantStatusCode int
	}{
		{
			name:           "requires organization context",
			module:         "gamification",
			wantStatusCode: http.StatusForbidden,
		},
		{
			name: "denies disabled module",
			tenantContext: Context{
				UserID:         "10000000-0000-0000-0000-000000000001",
				OrganizationID: "20000000-0000-0000-0000-000000000001",
				EnabledModules: []string{"crm"},
			},
			module:         "gamification",
			wantStatusCode: http.StatusForbidden,
		},
		{
			name: "allows enabled module case insensitively",
			tenantContext: Context{
				UserID:         "10000000-0000-0000-0000-000000000001",
				OrganizationID: "20000000-0000-0000-0000-000000000001",
				EnabledModules: []string{"Gamification"},
			},
			module:         " gamification ",
			wantStatusCode: http.StatusNoContent,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "/v1/gamification/overview", nil)
			if test.tenantContext.OrganizationID != "" {
				request = request.WithContext(ContextWithTenant(request.Context(), test.tenantContext))
			}
			recorder := httptest.NewRecorder()

			RequireModule(test.module, next).ServeHTTP(recorder, request)
			if recorder.Code != test.wantStatusCode {
				t.Fatalf("status = %d, want %d", recorder.Code, test.wantStatusCode)
			}
		})
	}
}
