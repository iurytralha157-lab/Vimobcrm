package tenant

import (
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

func TestRequireOrganizationContextFailsClosedWithoutOrganization(t *testing.T) {
	request := httptest.NewRequest("GET", "/", nil)
	response := httptest.NewRecorder()

	if _, ok := RequireOrganizationContext(response, request); ok {
		t.Fatal("RequireOrganizationContext() ok = true, want false")
	}
	if response.Code != 403 {
		t.Fatalf("status = %d, want 403", response.Code)
	}
	if !strings.Contains(response.Body.String(), `"code":"organization_required"`) {
		t.Fatalf("response = %s, want organization_required", response.Body.String())
	}
}

func TestRequireOrganizationContextReturnsActiveContext(t *testing.T) {
	want := Context{UserID: "user-id", OrganizationID: "organization-id"}
	request := httptest.NewRequest("GET", "/", nil).WithContext(
		ContextWithTenant(httptest.NewRequest("GET", "/", nil).Context(), want),
	)
	response := httptest.NewRecorder()

	got, ok := RequireOrganizationContext(response, request)
	if !ok {
		t.Fatal("RequireOrganizationContext() ok = false, want true")
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("context = %#v, want %#v", got, want)
	}
}
