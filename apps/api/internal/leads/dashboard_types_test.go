package leads

import (
	"encoding/json"
	"errors"
	"net/url"
	"strings"
	"testing"
)

const dashboardTestUUID = "11111111-1111-4111-8111-111111111111"

func TestParseDashboardFilterValidatesAndCanonicalizesInput(t *testing.T) {
	values := url.Values{
		"dateFrom":    {"2026-08-01T00:00:00Z"},
		"dateTo":      {"2026-08-01T23:59:59Z"},
		"granularity": {"hour"},
		"teamId":      {"  " + dashboardTestUUID + "  "},
		"userId":      {dashboardTestUUID},
		"source":      {" meta "},
		"campaignId":  {" campaign-123 "},
		"adSetId":     {" adset-123 "},
		"adId":        {" ad-123 "},
		"tagId":       {dashboardTestUUID},
		"dealStatus":  {"won"},
		"search":      {"  Maria  "},
		"pipelineId":  {dashboardTestUUID},
		"limit":       {"50"},
	}

	filter, err := ParseDashboardFilter(values)
	if err != nil {
		t.Fatalf("ParseDashboardFilter() error = %v", err)
	}
	if filter.DateFrom == nil || filter.DateTo == nil {
		t.Fatal("expected a complete date range")
	}
	if filter.TeamID != dashboardTestUUID || filter.UserID != dashboardTestUUID || filter.TagID != dashboardTestUUID || filter.PipelineID != dashboardTestUUID {
		t.Fatalf("UUID filters were not canonicalized: %#v", filter)
	}
	if filter.Source != "meta" || filter.CampaignID != "campaign-123" || filter.AdSetID != "adset-123" || filter.AdID != "ad-123" {
		t.Fatalf("text filters were not trimmed: %#v", filter)
	}
	if filter.SearchQuery != "Maria" {
		t.Fatalf("legacy search fallback was not preserved: %q", filter.SearchQuery)
	}
	if filter.Granularity != "hour" || filter.DealStatus != "won" || filter.Limit != 50 {
		t.Fatalf("bounded filters were not preserved: %#v", filter)
	}
}

func TestParseDashboardFilterPreservesDefaultsAndAllCompatibility(t *testing.T) {
	filter, err := ParseDashboardFilter(url.Values{
		"teamId":     {"ALL"},
		"source":     {" all "},
		"dealStatus": {"ALL"},
	})
	if err != nil {
		t.Fatalf("ParseDashboardFilter() error = %v", err)
	}
	if filter.DateFrom != nil || filter.DateTo != nil {
		t.Fatal("omitted dates must keep the repository default range")
	}
	if filter.TeamID != "all" || filter.Source != "all" || filter.DealStatus != "all" {
		t.Fatalf("legacy all filters were not canonicalized: %#v", filter)
	}
	if filter.Limit != defaultDashboardTaskLimit {
		t.Fatalf("default limit = %d, want %d", filter.Limit, defaultDashboardTaskLimit)
	}
}

func TestParseDashboardFilterRejectsUnsafeOrAmbiguousInput(t *testing.T) {
	testCases := map[string]url.Values{
		"date from without date to": {
			"dateFrom": {"2026-08-01T00:00:00Z"},
		},
		"equal dates": {
			"dateFrom": {"2026-08-01T00:00:00Z"},
			"dateTo":   {"2026-08-01T00:00:00Z"},
		},
		"reversed dates": {
			"dateFrom": {"2026-08-02T00:00:00Z"},
			"dateTo":   {"2026-08-01T00:00:00Z"},
		},
		"oversized date range": {
			"dateFrom": {"2020-01-01T00:00:00Z"},
			"dateTo":   {"2026-01-02T00:00:00Z"},
		},
		"unknown granularity": {
			"granularity": {"quarter"},
		},
		"invalid team UUID": {
			"teamId": {"not-a-uuid"},
		},
		"invalid deal status": {
			"dealStatus": {"deleted"},
		},
		"oversized source": {
			"source": {strings.Repeat("s", 181)},
		},
		"oversized campaign": {
			"campaignId": {strings.Repeat("c", 256)},
		},
		"oversized search": {
			"searchQuery": {strings.Repeat("q", maxDashboardSearchLength+1)},
		},
		"zero limit": {
			"limit": {"0"},
		},
		"oversized limit": {
			"limit": {"51"},
		},
		"malformed limit": {
			"limit": {"five"},
		},
	}

	for name, values := range testCases {
		t.Run(name, func(t *testing.T) {
			_, err := ParseDashboardFilter(values)
			if !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("ParseDashboardFilter() error = %v, want ErrInvalidInput", err)
			}
		})
	}
}

func TestDashboardStatsJSONKeepsTheTypedDetailContract(t *testing.T) {
	stats := DashboardStats{
		WonConversionBuckets: []WonConversionBucket{{
			Key: "zero_a_sete", Label: "0 a 7 dias", Count: 1, Percentage: 100, Value: 500000, Color: "#16a34a",
		}},
		WonDeals: []WonDealDetail{{
			ID: dashboardTestUUID, Name: "Maria", Value: 500000, AssignedUserName: "Corretor",
		}},
		LostReasonBuckets: []LostReasonBucket{{
			Key: "sem_interesse", Label: "Sem interesse", Count: 1, Percentage: 100, Color: "#8b5cf6",
		}},
		LostDeals: []LostDealDetail{{
			ID: dashboardTestUUID, Name: "Joao", LostReason: "Sem interesse", LostReasonGroup: "Sem interesse", AssignedUserName: "Corretor",
		}},
	}

	payload, err := json.Marshal(map[string]DashboardStats{"data": stats})
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}

	var decoded map[string]any
	if err := json.Unmarshal(payload, &decoded); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	data, ok := decoded["data"].(map[string]any)
	if !ok {
		t.Fatalf("data envelope has type %T", decoded["data"])
	}
	for _, field := range []string{
		"openLeads", "lostLeads", "closedLeads", "wonAverageConversionDays",
		"wonConversionBuckets", "wonDeals", "lostReasonBuckets", "lostDeals",
		"avgResponseTime", "pendingCommissions", "totalReceivables", "paidCommissions",
	} {
		if _, exists := data[field]; !exists {
			t.Errorf("DashboardStats JSON is missing %q", field)
		}
	}
}
