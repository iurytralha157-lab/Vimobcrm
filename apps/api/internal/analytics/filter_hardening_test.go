package analytics

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestCampaignInsightsSupportUnassignedAndLiteralCampaignArrays(t *testing.T) {
	values := url.Values{"dateFrom": {"2026-10-01"}, "dateTo": {"2026-10-12"}, "userId": {"unassigned"}, "campaignIds": {"A", "B, with comma", "A"}}
	if err := validateCampaignInsightsValues(values); err != nil {
		t.Fatal(err)
	}
	ids, err := normalizeCampaignInsightIDs(values)
	if err != nil || len(ids) != 2 || ids[1] != "B, with comma" {
		t.Fatalf("campaign array changed: %#v, %v", ids, err)
	}
	values.Set("userId", "not-a-uuid")
	if err := validateCampaignInsightsValues(values); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("invalid user accepted: %v", err)
	}
	values.Set("userId", "unassigned")
	values.Set("pipelineId", "not-a-uuid")
	if err := validateCampaignInsightsValues(values); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("invalid pipeline accepted: %v", err)
	}
	if _, err := normalizeCampaignInsightIDs(url.Values{"campaignIds": {strings.Repeat("x", 256)}}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("invalid campaign accepted: %v", err)
	}
	unicodeValues := url.Values{"dateFrom": {"2026-10-01"}, "dateTo": {"2026-10-12"}, "campaignId": {strings.Repeat("🏠", 255)}, "adSetId": {strings.Repeat("á", 255)}, "source": {strings.Repeat("🏠", 4096)}}
	if err := validateCampaignInsightsValues(unicodeValues); err != nil {
		t.Fatalf("Unicode text rejected: %v", err)
	}
	if err := validateAnalyticsFilterText(url.Values{"adId": {"ad\x00invalid"}}, map[string]int{"adId": 255}); err == nil {
		t.Fatal("invalid Meta text accepted")
	}
}

func TestCampaignInsightsSourceMatchesSharedFilterBounds(t *testing.T) {
	for _, length := range []int{121, 4096} {
		t.Run(fmt.Sprint(length), func(t *testing.T) {
			values := url.Values{"dateFrom": {"2026-10-01"}, "dateTo": {"2026-10-12"}, "source": {strings.Repeat("🏠", length)}}
			if err := validateCampaignInsightsValues(values); err != nil {
				t.Fatalf("shared source with %d code points rejected: %v", length, err)
			}
		})
	}
	for _, source := range []string{strings.Repeat("🏠", 4097), "source\x00suffix", string([]byte{0xff})} {
		values := url.Values{"dateFrom": {"2026-10-01"}, "dateTo": {"2026-10-12"}, "source": {source}}
		if err := validateCampaignInsightsValues(values); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("invalid shared source accepted: %v", err)
		}
	}
}

func TestCampaignInsightsCompleteSQLReadOnlyIntegration(t *testing.T) {
	if os.Getenv("VIMOB_TEST_ISOLATED") != "1" {
		t.Skip("VIMOB_TEST_ISOLATED=1 is required")
	}
	databaseURL := strings.TrimSpace(os.Getenv("VIMOB_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("VIMOB_TEST_DATABASE_URL is not set")
	}
	target, err := url.Parse(databaseURL)
	if err != nil || (target.Scheme != "postgres" && target.Scheme != "postgresql") {
		t.Fatal("the read-only integration requires a PostgreSQL URL")
	}
	switch strings.ToLower(target.Hostname()) {
	case "localhost", "127.0.0.1", "::1":
	default:
		t.Fatal("the read-only integration must use a disposable loopback database")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 10 * time.Second, ForceReadOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	defer postgres.Close()
	var organizationID string
	if err := postgres.Pool().QueryRow(ctx, "select gen_random_uuid()::text").Scan(&organizationID); err != nil {
		t.Fatal(err)
	}
	repo := NewRepository(postgres)
	tc := tenant.Context{OrganizationID: organizationID, UserID: "11111111-1111-4111-8111-111111111111", IsSuperAdmin: true}
	values := url.Values{"dateFrom": {"2026-10-01"}, "dateTo": {"2026-10-12"}, "campaignIds": {"A", "B"}, "adSetId": {"set-x"}, "adId": {"ad-z"}, "userId": {"unassigned"}, "pipelineId": {"22222222-2222-4222-8222-222222222222"}}
	result, err := repo.CampaignInsights(ctx, tc, values)
	if err != nil {
		t.Fatalf("complete campaign SQL rejected: %v", err)
	}
	dataQuality, ok := result["dataQuality"].(map[string]any)
	if !ok || dataQuality["hasCRMScopedFilters"] != true {
		t.Fatalf("pipeline/unassigned CRM scope not represented: %#v", result["dataQuality"])
	}
	if _, err := repo.MetaInsights(ctx, tc, url.Values{"dateFrom": {"2026-10-01"}, "dateTo": {"2026-10-12"}, "campaignIds": {"A", "B"}}); err != nil {
		t.Fatalf("legacy Meta SQL rejected: %v", err)
	}
}
