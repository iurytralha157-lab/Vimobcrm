package schedule

import (
	"errors"
	"net/url"
	"strings"
	"testing"
)

func TestLeadPreviewRequiresAnExplicitLeadAndValidFlag(t *testing.T) {
	leadID := "11111111-1111-4111-8111-111111111111"
	for _, values := range []url.Values{
		{"leadPreview": {"true"}, "eventId": {leadID}},
		{"leadPreview": {"yes"}, "leadId": {leadID}},
	} {
		if _, err := ParseListFilter(values); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("invalid preview accepted: %v", err)
		}
	}
	filter, err := ParseListFilter(url.Values{"leadPreview": {"true"}, "leadId": {leadID}, "limit": {"50"}})
	if err != nil || !filter.LeadPreview || filter.LeadID != leadID || filter.Limit != 50 {
		t.Fatalf("valid scoped preview = %+v, %v", filter, err)
	}
	legacy, err := ParseListFilter(url.Values{"leadId": {leadID}})
	if err != nil || legacy.LeadPreview {
		t.Fatal("existing Agenda list must keep its ordering")
	}
}

func TestLeadPreviewKeepsVisibilityProjectionAndPrioritizesOpenAppointments(t *testing.T) {
	where := "se.organization_id = $1::uuid and se.lead_id = $11::uuid"
	preview := scheduleLeadPreviewEventsQuery(where)
	legacy := scheduleEventsQuery(where)
	previewProjection, _, _ := strings.Cut(preview, "order by ")
	legacyProjection, _, _ := strings.Cut(legacy, "order by ")
	if previewProjection != legacyProjection {
		t.Fatal("preview must preserve authorization, masking and the selected projection")
	}
	if !strings.Contains(preview, "then 1 else 0 end asc") || !strings.Contains(preview, "then v.start_time else null end desc, v.id asc") {
		t.Fatal("preview must place open events first and recent history next")
	}
	if !strings.HasSuffix(legacy, "v.start_time asc, v.id asc") {
		t.Fatal("default Agenda ordering changed")
	}
}
