package users

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestMembershipStatusOnlyUpdate(t *testing.T) {
	active := true
	name := "Nome alterado"

	tests := []struct {
		name  string
		input UpdateUserInput
		want  bool
	}{
		{name: "status only", input: UpdateUserInput{IsActive: &active}, want: true},
		{name: "status and profile", input: UpdateUserInput{IsActive: &active, Name: &name}, want: false},
		{name: "profile only", input: UpdateUserInput{Name: &name}, want: false},
		{name: "empty", input: UpdateUserInput{}, want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := isMembershipStatusOnlyUpdate(test.input); got != test.want {
				t.Fatalf("isMembershipStatusOnlyUpdate() = %v, want %v", got, test.want)
			}
		})
	}
}

func TestInactiveOrganizationUsersRequireManagementPermission(t *testing.T) {
	repo := Repository{}
	_, err := repo.ListOrganizationUsers(t.Context(), tenant.Context{
		UserID:         "10000000-0000-0000-0000-000000000001",
		OrganizationID: "20000000-0000-0000-0000-000000000002",
		MemberRole:     "user",
	}, OrganizationUserListManagement)

	if !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatalf("ListOrganizationUsers() error = %v, want organization access denied", err)
	}
}

func TestInactiveUserFiltersRequireRelevantVisibilityPermission(t *testing.T) {
	tests := []struct {
		name        string
		permissions []string
		want        bool
	}{
		{name: "lead organization", permissions: []string{"lead_view_all"}, want: true},
		{name: "lead team", permissions: []string{"lead_view_team"}, want: true},
		{name: "property catalog", permissions: []string{"property_view"}, want: true},
		{name: "unrelated permission", permissions: []string{"schedule_view"}, want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := canListInactiveUserFilters(tenant.Context{
				UserID:         "10000000-0000-0000-0000-000000000001",
				OrganizationID: "20000000-0000-0000-0000-000000000002",
				MemberRole:     "user",
				Permissions:    test.permissions,
			})
			if got != test.want {
				t.Fatalf("canListInactiveUserFilters() = %v, want %v", got, test.want)
			}
		})
	}
}

func TestListOrganizationUsersRejectsInvalidInactiveFlag(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/v1/users?include_inactive=invalid", nil)
	request = request.WithContext(tenant.ContextWithTenant(request.Context(), tenant.Context{
		UserID:         "10000000-0000-0000-0000-000000000001",
		OrganizationID: "20000000-0000-0000-0000-000000000002",
		MemberRole:     "admin",
	}))
	recorder := httptest.NewRecorder()

	Handler{}.ListOrganizationUsers(recorder, request)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusBadRequest)
	}
	if !strings.Contains(recorder.Body.String(), "invalid_user_input") {
		t.Fatalf("response body = %q, want invalid_user_input", recorder.Body.String())
	}
}

func TestMembershipDeletionLifecycleContract(t *testing.T) {
	_, testFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("could not resolve test file")
	}
	repositoryRoot := filepath.Clean(filepath.Join(filepath.Dir(testFile), "..", "..", "..", ".."))

	read := func(relativePath string) string {
		t.Helper()
		payload, err := os.ReadFile(filepath.Join(repositoryRoot, relativePath))
		if err != nil {
			t.Fatalf("read %s: %v", relativePath, err)
		}
		return string(payload)
	}

	migration := read(filepath.Join("supabase", "migrations", "20260827000000_distinguish_disabled_and_deleted_organization_members.sql"))
	repository := read(filepath.Join("apps", "api", "internal", "users", "repository.go"))
	invitation := read(filepath.Join("apps", "api", "internal", "admin", "invitation_accept.go"))

	if !strings.Contains(migration, "add column if not exists deleted_at timestamptz") {
		t.Fatal("membership migration must add the deletion marker")
	}
	if !strings.Contains(migration, "as restrictive") || !strings.Contains(migration, "private.is_org_member(organization_id)") {
		t.Fatal("membership migration must enforce active membership across tenant RLS policies")
	}
	if !strings.Contains(repository, "and om.deleted_at is null") {
		t.Fatal("organization user reads must hide explicitly deleted memberships")
	}
	if !strings.Contains(repository, "deleted_at = now()") {
		t.Fatal("DELETE must tombstone the organization membership")
	}
	if !strings.Contains(repository, "responsible_user_id is null and created_by = $2::uuid") {
		t.Fatal("DELETE must transfer legacy properties whose responsibility falls back to the creator")
	}
	if !strings.Contains(invitation, "deleted_at = null") {
		t.Fatal("accepting a new invitation must restore a tombstoned membership")
	}
	if !strings.Contains(repository, "syncCanonicalUserAccess") ||
		!strings.Contains(repository, "is_active = selected_state.organization_id is not null") {
		t.Fatal("membership changes must synchronize the legacy canonical user access fields")
	}
	if !strings.Contains(repository, "func lockCanonicalUserAccess") || !strings.Contains(repository, "for update") {
		t.Fatal("membership lifecycle writes must serialize the canonical user access state")
	}
}
