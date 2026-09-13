package developments

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestDevelopmentJSONRejectsUnknownAndConcatenatedValues(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{name: "unknown field", body: `{"code":"T1","name":"Torre 1","phase_id":"11111111-1111-4111-8111-111111111111","unexpected":true}`},
		{name: "concatenated values", body: `{"code":"T1"}{"code":"T2"}`},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest("POST", "/v1/property-developments/id/buildings", strings.NewReader(test.body))
			response := httptest.NewRecorder()
			var input CreateBuildingInput
			if err := httpserver.DecodeJSON(response, request, &input, developmentBodyLimit); err == nil {
				t.Fatal("expected strict JSON decoder to reject body")
			}
		})
	}
}

func TestDevelopmentJSONAcceptsOneStrictValue(t *testing.T) {
	request := httptest.NewRequest(
		"POST",
		"/v1/property-developments/id/buildings",
		strings.NewReader(`{"phase_id":"11111111-1111-4111-8111-111111111111","code":"T1","name":"Torre 1"}`),
	)
	response := httptest.NewRecorder()
	var input CreateBuildingInput
	if err := httpserver.DecodeJSON(response, request, &input, developmentBodyLimit); err != nil {
		t.Fatalf("expected valid JSON body, got %v", err)
	}
	if input.Name != "Torre 1" {
		t.Fatalf("decoded name = %q, want Torre 1", input.Name)
	}
}

func TestCreateReservationRequiresIdempotencyKeyBeforeRepositoryCall(t *testing.T) {
	request := httptest.NewRequest(
		http.MethodPost,
		"/v1/property-developments/11111111-1111-4111-8111-111111111111/units/22222222-2222-4222-8222-222222222222/reservations",
		strings.NewReader(`{"expires_at":"2027-01-04T12:00:00Z","expected_unit_updated_at":"2027-01-02T12:00:00Z"}`),
	)
	request = request.WithContext(tenant.ContextWithTenant(context.Background(), tenant.Context{
		OrganizationID: "33333333-3333-4333-8333-333333333333",
		UserID:         "44444444-4444-4444-8444-444444444444",
		MemberRole:     "admin",
	}))
	response := httptest.NewRecorder()

	NewHandler(Repository{}).CreateReservation(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
	}
	if !strings.Contains(response.Body.String(), `"code":"invalid_development_input"`) {
		t.Fatalf("response body = %s", response.Body.String())
	}
}

func TestUnitPropertyMutationsRequireIdempotencyKeyBeforeRepositoryCall(t *testing.T) {
	tests := []struct {
		name    string
		path    string
		body    string
		handler func(Handler, http.ResponseWriter, *http.Request)
	}{
		{
			name: "link",
			path: "/v1/property-developments/development/units/unit/link-property",
			body: `{"property_id":"11111111-1111-4111-8111-111111111111","expected_unit_updated_at":"2027-01-02T12:00:00Z","expected_property_updated_at":"2027-01-02T12:00:00Z"}`,
			handler: func(handler Handler, response http.ResponseWriter, request *http.Request) {
				handler.LinkUnitProperty(response, request)
			},
		},
		{
			name: "promote",
			path: "/v1/property-developments/development/units/unit/promote-property",
			body: `{"expected_unit_updated_at":"2027-01-02T12:00:00Z"}`,
			handler: func(handler Handler, response http.ResponseWriter, request *http.Request) {
				handler.PromoteUnitProperty(response, request)
			},
		},
		{
			name: "unlink",
			path: "/v1/property-developments/development/units/unit/unlink-property",
			body: `{"expected_unit_updated_at":"2027-01-02T12:00:00Z"}`,
			handler: func(handler Handler, response http.ResponseWriter, request *http.Request) {
				handler.UnlinkUnitProperty(response, request)
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, test.path, strings.NewReader(test.body))
			request = request.WithContext(tenant.ContextWithTenant(context.Background(), tenant.Context{
				OrganizationID: "33333333-3333-4333-8333-333333333333",
				UserID:         "44444444-4444-4444-8444-444444444444",
				MemberRole:     "admin",
			}))
			response := httptest.NewRecorder()

			test.handler(NewHandler(Repository{}), response, request)

			if response.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
			}
			if !strings.Contains(response.Body.String(), `"code":"invalid_development_input"`) {
				t.Fatalf("response body = %s", response.Body.String())
			}
		})
	}
}

func TestDecodeCancellationUsesContractField(t *testing.T) {
	request := httptest.NewRequest(
		http.MethodPost,
		"/v1/property-developments/id/reservations/id/cancel",
		strings.NewReader(`{"expected_updated_at":"2027-01-02T12:00:00Z","cancellation_reason":"cliente desistiu"}`),
	)
	response := httptest.NewRecorder()
	var input CancelReservationInput
	if err := httpserver.DecodeJSON(response, request, &input, developmentBodyLimit); err != nil {
		t.Fatalf("decode cancellation input: %v", err)
	}
	if input.CancellationReason != "cliente desistiu" {
		t.Fatalf("cancellation reason = %q", input.CancellationReason)
	}
}
