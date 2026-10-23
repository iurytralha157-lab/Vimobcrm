package leads

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLeadDeleteWhatsAppInFlightHasConflictContract(t *testing.T) {
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodDelete, "/v1/leads/synthetic", nil)
	writeLeadError(w, r, ErrWhatsAppSendInFlight)
	if w.Code != http.StatusConflict || !strings.Contains(w.Body.String(), `"code":"lead_whatsapp_send_in_flight"`) {
		t.Fatalf("unexpected conflict contract: %d %s", w.Code, w.Body.String())
	}
}
