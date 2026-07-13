package integrations

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestReadJSONBodyAlwaysOverridesOrganization(t *testing.T) {
	request := httptest.NewRequest(
		"POST",
		"/v1/integrations/functions/asaas-create-charge",
		strings.NewReader(`{"organization_id":"00000000-0000-0000-0000-000000000099","organizationId":"00000000-0000-0000-0000-000000000099"}`),
	)

	body, err := readJSONBodyWithOrganization(request, "00000000-0000-0000-0000-000000000001")
	if err != nil {
		t.Fatalf("readJSONBodyWithOrganization() error = %v", err)
	}

	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}

	for _, key := range []string{"organization_id", "organizationId"} {
		if got := payload[key]; got != "00000000-0000-0000-0000-000000000001" {
			t.Fatalf("payload[%q] = %v, want tenant organization", key, got)
		}
	}
}

func TestAllowedFunctionBlocksGoogleCalendarWhenDisabled(t *testing.T) {
	for _, name := range []string{"google-calendar-oauth", "google-calendar-sync"} {
		if allowedFunction(name) {
			t.Fatalf("allowedFunction(%q) = true, want false while Google Calendar is disabled", name)
		}
	}
}
