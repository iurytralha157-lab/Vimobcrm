package developments

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestPriceActivationRequiresUsableCASBeforeDatabase(t *testing.T) {
	for _, value := range []*string{nil, activationText(""), activationText("   "), activationText("invalid")} {
		input := ActivatePriceTableInput{ExpectedUpdatedAt: value}
		if err := input.Validate(); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("version %v was accepted: %v", value, err)
		}
		// A nil repository proves these requests stop before acquiring a pool.
		_, err := (Repository{}).ActivatePriceTable(context.Background(), tenant.Context{
			Permissions: []string{permissions.PropertyManage},
		}, testUUID, testUUID, input)
		if !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("invalid activation reached database: %v", err)
		}
	}
	input := ActivatePriceTableInput{ExpectedUpdatedAt: activationText(" 2026-10-13T09:00:00.123456-03:00 ")}
	if err := input.Validate(); err != nil || *input.ExpectedUpdatedAt != "2026-10-13T12:00:00.123456Z" {
		t.Fatalf("valid CAS was not normalized preserving precision: %#v, %v", input, err)
	}
}

func TestPriceActivationHandlerRejectsMissingAndBlankVersion(t *testing.T) {
	for _, body := range []string{`{}`, `{"expected_updated_at":null}`, `{"expected_updated_at":""}`, `{"expected_updated_at":" "}`} {
		request := httptest.NewRequest(http.MethodPost, "/synthetic/activate", strings.NewReader(body))
		request.SetPathValue("id", testUUID)
		request.SetPathValue("priceTableId", testUUID)
		request = request.WithContext(tenant.ContextWithTenant(context.Background(), tenant.Context{
			OrganizationID: testUUID, UserID: testUUID, MemberRole: "admin",
		}))
		response := httptest.NewRecorder()
		NewHandler(Repository{}).ActivatePriceTable(response, request)
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "invalid_development_input") {
			t.Fatalf("body %s produced %d: %s", body, response.Code, response.Body.String())
		}
	}
}

func activationText(value string) *string { return &value }
