package site

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/distribution"
)

func TestPublicContactDestinationErrorIsActionableAndDoesNotDiscloseConfiguration(t *testing.T) {
	response := httptest.NewRecorder()
	writeSiteError(response, httptest.NewRequest(http.MethodPost, "/public/contact", nil), fmt.Errorf("synthetic tenant-reference SQL: %w", distribution.ErrIntakeDestinationUnavailable))
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), `"code":"lead_intake_destination_unavailable"`) || !strings.Contains(response.Body.String(), "Tente novamente mais tarde") {
		t.Fatalf("destination error=%d %s", response.Code, response.Body.String())
	}
	for _, private := range []string{"tenant-reference", "SQL", "funil", "pipeline", "coluna"} {
		if strings.Contains(response.Body.String(), private) {
			t.Fatalf("public contact disclosed internal configuration: %s", private)
		}
	}
}
