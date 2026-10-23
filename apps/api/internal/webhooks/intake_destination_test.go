package webhooks

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/distribution"
)

func TestWebhookDestinationErrorIsAConfigurationRejectionWithoutInternalDetails(t *testing.T) {
	response := httptest.NewRecorder()
	writeWebhookError(response, httptest.NewRequest(http.MethodPost, "/public/webhook", nil), fmt.Errorf("synthetic tenant-reference SQL: %w", distribution.ErrIntakeDestinationUnavailable))
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), `"code":"lead_intake_destination_unavailable"`) || !strings.Contains(response.Body.String(), "Tente novamente mais tarde") {
		t.Fatalf("destination error=%d %s", response.Code, response.Body.String())
	}
	if strings.Contains(response.Body.String(), "tenant-reference") || strings.Contains(response.Body.String(), "SQL") {
		t.Fatal("internal destination details disclosed")
	}
}
