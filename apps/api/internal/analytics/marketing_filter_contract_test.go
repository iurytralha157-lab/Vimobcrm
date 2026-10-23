package analytics

import (
	"errors"
	"net/url"
	"testing"
)

func TestCampaignInsightsUnassignedSentinelRejectsSurroundingWhitespace(t *testing.T) {
	for _, value := range []string{" unassigned", "unassigned ", "\tunassigned\n"} {
		t.Run(value, func(t *testing.T) {
			err := validateCampaignInsightsValues(url.Values{
				"dateFrom": {"2026-10-01"}, "dateTo": {"2026-10-17"}, "userId": {value},
			})
			if !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("padded sentinel must be rejected before the raw SQL binding, got %v", err)
			}
		})
	}
	if err := validateCampaignInsightsValues(url.Values{
		"dateFrom": {"2026-10-01"}, "dateTo": {"2026-10-17"}, "userId": {"unassigned"},
	}); err != nil {
		t.Fatalf("exact shared-filter sentinel must remain supported: %v", err)
	}
}
