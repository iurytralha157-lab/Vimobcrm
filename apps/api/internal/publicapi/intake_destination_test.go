package publicapi

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/distribution"
)

func TestCreateLeadRejectsUnavailablePipelineDestinationWithoutAcknowledgingSuccess(t *testing.T) {
	authorizer := &fakeAuthorizer{}
	intake := &fakeLeadIntake{err: fmt.Errorf("synthetic tenant-reference SQL: %w", distribution.ErrIntakeDestinationUnavailable)}
	handler := newTestHandler(authorizer, intake)
	response := httptest.NewRecorder()
	handler.CreateLead(response, newLeadRequest(`{"name":"Synthetic contact","phone":"11999999999"}`))
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), `"code":"lead_intake_destination_unavailable"`) || !strings.Contains(response.Body.String(), "Tente novamente mais tarde") || authorizer.markUsedCalls != 0 {
		t.Fatalf("destination failure acknowledged as success: %d %s", response.Code, response.Body.String())
	}
	if strings.Contains(response.Body.String(), "tenant-reference") || strings.Contains(response.Body.String(), "SQL") {
		t.Fatal("internal destination details disclosed")
	}
}
