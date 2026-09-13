package presence

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type stubLister struct {
	users      []User
	err        error
	calls      int
	scope      ListScope
	freshSince time.Time
}

func (stub *stubLister) List(_ context.Context, scope ListScope, freshSince time.Time) ([]User, error) {
	stub.calls++
	stub.scope = scope
	stub.freshSince = freshSince
	return stub.users, stub.err
}

func TestHandlerListsTenantPresenceWithFreshnessWindow(t *testing.T) {
	fixedNow := time.Date(2026, time.September, 2, 15, 4, 5, 987654321, time.UTC)
	lastSeenAt := "2026-09-02T15:04:00Z"
	stub := &stubLister{users: []User{{
		UserID:         "f4e86159-26f4-4420-ad63-36683fa45bca",
		Name:           "Ada Lovelace",
		MemberRole:     "admin",
		PresenceStatus: StatusOnline,
		LastSeenAt:     &lastSeenAt,
	}}}
	handler := NewHandler(stub)
	handler.now = func() time.Time { return fixedNow }

	request := httptest.NewRequest(http.MethodGet, "/v1/user-presence", nil)
	request = request.WithContext(tenant.ContextWithTenant(request.Context(), tenant.Context{
		OrganizationID: "25415af4-ee44-4b0d-a1a6-895699450251",
		MemberRole:     "admin",
	}))
	response := httptest.NewRecorder()
	handler.List(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if cacheControl := response.Header().Get("Cache-Control"); cacheControl != "private, no-store" {
		t.Fatalf("Cache-Control = %q", cacheControl)
	}
	if stub.calls != 1 || stub.scope.OrganizationID != "25415af4-ee44-4b0d-a1a6-895699450251" {
		t.Fatalf("repository call = %d, scope = %#v", stub.calls, stub.scope)
	}
	if stub.scope.RestrictToUserIDs || len(stub.scope.UserIDs) != 0 {
		t.Fatalf("organization-wide caller received restricted scope: %#v", stub.scope)
	}
	wantFreshSince := fixedNow.Add(-3 * time.Minute)
	if !stub.freshSince.Equal(wantFreshSince) {
		t.Fatalf("freshSince = %s, want %s", stub.freshSince, wantFreshSince)
	}

	var payload Response
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Data.GeneratedAt != "2026-09-02T15:04:05Z" {
		t.Fatalf("generated_at = %q", payload.Data.GeneratedAt)
	}
	if payload.Data.Counts != (Counts{Total: 1, Online: 1}) {
		t.Fatalf("counts = %#v", payload.Data.Counts)
	}
}

func TestHandlerRestrictsTeamLeaderToLedUsersAndIncludesSelf(t *testing.T) {
	stub := &stubLister{}
	handler := NewHandler(stub)
	request := httptest.NewRequest(http.MethodGet, "/v1/user-presence", nil)
	request = request.WithContext(tenant.ContextWithTenant(request.Context(), tenant.Context{
		UserID:         "e9200000-0000-4000-8000-000000000010",
		OrganizationID: "e9100000-0000-4000-8000-000000000001",
		MemberRole:     "user",
		IsTeamLeader:   true,
		Permissions:    []string{"users_presence_view"},
		LedUserIDs: []string{
			"e9200000-0000-4000-8000-000000000011",
			"e9200000-0000-4000-8000-000000000010",
			" e9200000-0000-4000-8000-000000000011 ",
		},
	}))
	response := httptest.NewRecorder()

	handler.List(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if !stub.scope.RestrictToUserIDs {
		t.Fatalf("leader scope must be restricted: %#v", stub.scope)
	}
	want := []string{
		"e9200000-0000-4000-8000-000000000010",
		"e9200000-0000-4000-8000-000000000011",
	}
	if len(stub.scope.UserIDs) != len(want) {
		t.Fatalf("leader user ids = %#v, want %#v", stub.scope.UserIDs, want)
	}
	for index := range want {
		if stub.scope.UserIDs[index] != want[index] {
			t.Fatalf("leader user ids = %#v, want %#v", stub.scope.UserIDs, want)
		}
	}
}

func TestHandlerKeepsAdministratorOrganizationWideEvenWhenLeadingATeam(t *testing.T) {
	stub := &stubLister{}
	handler := NewHandler(stub)
	request := httptest.NewRequest(http.MethodGet, "/v1/user-presence", nil)
	request = request.WithContext(tenant.ContextWithTenant(request.Context(), tenant.Context{
		UserID:         "e9200000-0000-4000-8000-000000000002",
		OrganizationID: "e9100000-0000-4000-8000-000000000001",
		MemberRole:     "admin",
		IsTeamLeader:   true,
		LedUserIDs:     []string{"e9200000-0000-4000-8000-000000000011"},
	}))
	response := httptest.NewRecorder()

	handler.List(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if stub.scope.RestrictToUserIDs || len(stub.scope.UserIDs) != 0 {
		t.Fatalf("administrator must retain organization-wide scope: %#v", stub.scope)
	}
}

func TestHandlerRejectsMissingOrganizationWithoutQuerying(t *testing.T) {
	stub := &stubLister{}
	handler := NewHandler(stub)
	request := httptest.NewRequest(http.MethodGet, "/v1/user-presence", nil)
	response := httptest.NewRecorder()

	handler.List(response, request)

	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if stub.calls != 0 {
		t.Fatalf("repository called %d times", stub.calls)
	}
	if cacheControl := response.Header().Get("Cache-Control"); cacheControl != "private, no-store" {
		t.Fatalf("Cache-Control = %q", cacheControl)
	}
}

func TestHandlerRejectsStandardUserWithoutPresencePermission(t *testing.T) {
	stub := &stubLister{}
	handler := NewHandler(stub)
	request := httptest.NewRequest(http.MethodGet, "/v1/user-presence", nil)
	request = request.WithContext(tenant.ContextWithTenant(request.Context(), tenant.Context{
		UserID:         "e9200000-0000-4000-8000-000000000013",
		OrganizationID: "e9100000-0000-4000-8000-000000000001",
		MemberRole:     "user",
	}))
	response := httptest.NewRecorder()

	handler.List(response, request)

	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if stub.calls != 0 {
		t.Fatalf("repository called %d times", stub.calls)
	}
}

func TestHandlerRejectsExplicitNonLeaderPermissionWithoutQuerying(t *testing.T) {
	stub := &stubLister{}
	handler := NewHandler(stub)
	request := httptest.NewRequest(http.MethodGet, "/v1/user-presence", nil)
	request = request.WithContext(tenant.ContextWithTenant(request.Context(), tenant.Context{
		UserID:         "e9200000-0000-4000-8000-000000000012",
		OrganizationID: "e9100000-0000-4000-8000-000000000001",
		MemberRole:     "user",
		Permissions:    []string{"users_presence_view"},
	}))
	response := httptest.NewRecorder()

	handler.List(response, request)

	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if stub.calls != 0 {
		t.Fatalf("repository called %d times", stub.calls)
	}
	if !strings.Contains(response.Body.String(), "permission_denied") {
		t.Fatalf("response = %s", response.Body.String())
	}
}

func TestPresenceListScopeFailsClosedForNonLeader(t *testing.T) {
	scope := presenceListScope(tenant.Context{
		UserID:         "e9200000-0000-4000-8000-000000000012",
		OrganizationID: "e9100000-0000-4000-8000-000000000001",
		MemberRole:     "user",
		Permissions:    []string{"users_presence_view"},
	})

	if !scope.RestrictToUserIDs || len(scope.UserIDs) != 0 {
		t.Fatalf("non-leader scope must fail closed: %#v", scope)
	}
}

func TestHandlerDoesNotLeakRepositoryErrors(t *testing.T) {
	stub := &stubLister{err: errors.New("password=secret host=database.internal")}
	handler := NewHandler(stub)
	request := httptest.NewRequest(http.MethodGet, "/v1/user-presence", nil)
	request = request.WithContext(tenant.ContextWithTenant(request.Context(), tenant.Context{
		OrganizationID: "25415af4-ee44-4b0d-a1a6-895699450251",
		MemberRole:     "admin",
	}))
	response := httptest.NewRecorder()

	handler.List(response, request)

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if strings.Contains(response.Body.String(), "secret") || strings.Contains(response.Body.String(), "database.internal") {
		t.Fatalf("response leaked repository error: %s", response.Body.String())
	}
}
