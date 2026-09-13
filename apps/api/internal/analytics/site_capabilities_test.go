package analytics

import (
	"errors"
	"os"
	"strings"
	"testing"
	"time"
)

func TestSiteAnalyticsCapabilitiesCachesWithinTTLAndRefreshesAfterExpiry(t *testing.T) {
	t.Parallel()

	capabilities := &siteAnalyticsCapabilities{}
	now := time.Date(2026, time.September, 6, 12, 0, 0, 0, time.UTC)
	loads := 0
	loader := func() (siteAnalyticsSchemaCapabilities, error) {
		loads++
		return siteAnalyticsSchemaCapabilities{
			trackingV2: loads > 1,
			lastSeenAt: loads == 1,
		}, nil
	}

	available, err := capabilities.resolve(now, loader)
	if err != nil || available.trackingV2 || !available.lastSeenAt {
		t.Fatalf("first capability resolution = (%#v, %v)", available, err)
	}
	available, err = capabilities.resolve(now.Add(siteAnalyticsCapabilitiesTTL-time.Second), loader)
	if err != nil || available.trackingV2 || !available.lastSeenAt || loads != 1 {
		t.Fatalf("cached capability resolution = (%#v, %v), loads=%d", available, err, loads)
	}
	available, err = capabilities.resolve(now.Add(siteAnalyticsCapabilitiesTTL), loader)
	if err != nil || !available.trackingV2 || available.lastSeenAt || loads != 2 {
		t.Fatalf("refreshed capability resolution = (%#v, %v), loads=%d", available, err, loads)
	}
}

func TestSiteAnalyticsCapabilitiesDoesNotCacheLoaderErrors(t *testing.T) {
	t.Parallel()

	capabilities := &siteAnalyticsCapabilities{}
	now := time.Date(2026, time.September, 6, 12, 0, 0, 0, time.UTC)
	wantErr := errors.New("temporary database failure")
	loads := 0

	available, err := capabilities.resolve(now, func() (siteAnalyticsSchemaCapabilities, error) {
		loads++
		if loads == 1 {
			return siteAnalyticsSchemaCapabilities{}, wantErr
		}
		return siteAnalyticsSchemaCapabilities{trackingV2: true, lastSeenAt: true}, nil
	})
	if available != (siteAnalyticsSchemaCapabilities{}) || !errors.Is(err, wantErr) {
		t.Fatalf("failed capability resolution = (%#v, %v)", available, err)
	}

	available, err = capabilities.resolve(now, func() (siteAnalyticsSchemaCapabilities, error) {
		loads++
		return siteAnalyticsSchemaCapabilities{trackingV2: true, lastSeenAt: true}, nil
	})
	if err != nil || !available.trackingV2 || !available.lastSeenAt || loads != 2 {
		t.Fatalf("retried capability resolution = (%#v, %v), loads=%d", available, err, loads)
	}
}

func TestSiteAnalyticsObservedAtSQLUsesOnlyAvailableColumns(t *testing.T) {
	t.Parallel()

	if got := siteAnalyticsObservedAtSQL("e.", true); got != "coalesce(e.last_seen_at, e.created_at)" {
		t.Fatalf("last-seen expression = %q", got)
	}
	if got := siteAnalyticsObservedAtSQL("e.", false); got != "e.created_at" {
		t.Fatalf("legacy observed-at expression = %q", got)
	}
}

func TestSiteAnalyticsSchemaCapabilitiesKeepTrackingV2IndependentFromLastSeenAt(t *testing.T) {
	t.Parallel()

	raw, err := os.ReadFile("site_repository.go")
	if err != nil {
		t.Fatalf("read site_repository.go: %v", err)
	}
	source := strings.ReplaceAll(string(raw), "\r\n", "\n")

	for _, required := range []string{
		"column_name in ('property_id','lead_id','metadata')",
		"column_name = 'last_seen_at'",
		"if !capabilities.trackingV2",
		"capabilities.lastSeenAt",
		"metadata->>'city'",
		"'locations',coalesce",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("site analytics capability contract is missing %q", required)
		}
	}
	if strings.Contains(source, "column_name in ('property_id','lead_id','metadata','last_seen_at')") {
		t.Fatal("last_seen_at must not be part of the tracking V2 capability gate")
	}
}
