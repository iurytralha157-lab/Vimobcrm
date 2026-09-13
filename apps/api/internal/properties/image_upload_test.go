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

func TestLegacyPropertyImageUploadCannotWriteStorage(t *testing.T) {
	_, err := (Repository{}).UploadImage(
		context.Background(),
		tenant.Context{OrganizationID: "11111111-1111-4111-8111-111111111111"},
		propertyImageUploadInput{
			PropertyID:  "22222222-2222-4222-8222-222222222222",
			ContentType: "image/jpeg",
		},
	)
	if !errors.Is(err, ErrLegacyPropertyImageUploadRetired) {
		t.Fatalf("expected retired endpoint error, got %v", err)
	}
}

func TestLegacyPropertyImageUploadEndpointReturnsGone(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/v1/property-images", nil)
	request = request.WithContext(tenant.ContextWithTenant(request.Context(), tenant.Context{
		OrganizationID: "11111111-1111-4111-8111-111111111111",
	}))
	response := httptest.NewRecorder()

	(Handler{}).UploadImage(response, request)

	if response.Code != http.StatusGone {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusGone)
	}
	if body := response.Body.String(); !strings.Contains(body, "property_image_upload_retired") {
		t.Fatalf("response body = %q, want retired endpoint code", body)
	}
}
