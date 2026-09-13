package analytics

import (
	"os"
	"strings"
	"testing"
)

func readAnalyticsSource(t *testing.T, path string) string {
	t.Helper()
	source, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return strings.ReplaceAll(string(source), "\r\n", "\n")
}

func repositoryFunctionSource(t *testing.T, source string, name string) string {
	t.Helper()
	marker := "func (repo Repository) " + name + "("
	start := strings.Index(source, marker)
	if start < 0 {
		t.Fatalf("repository function %s not found", name)
	}
	tail := source[start+len(marker):]
	if next := strings.Index(tail, "\nfunc (repo Repository) "); next >= 0 {
		return source[start : start+len(marker)+next]
	}
	return source[start:]
}

func TestSiteAnalyticsUsesOrganizationLocalCalendar(t *testing.T) {
	t.Parallel()
	source := readAnalyticsSource(t, "site_repository.go")

	for _, name := range []string{
		"SiteSummary",
		"SiteDetailed",
		"LeadAnalytics",
		"siteDetailedLegacy",
		"leadAnalyticsLegacy",
	} {
		functionSource := repositoryFunctionSource(t, source, name)
		for _, required := range []string{
			"from public.organization_attention_settings as settings",
			"where settings.organization_id = $1::uuid",
			"'America/Sao_Paulo'",
		} {
			if !strings.Contains(functionSource, required) {
				t.Errorf("%s is missing timezone contract %q", name, required)
			}
		}
	}

	summary := repositoryFunctionSource(t, source, "SiteSummary")
	for _, required := range []string{
		"(current_timestamp at time zone report_settings.timezone_name)::date",
		"date_from::timestamp at time zone timezone_name as starts_at",
		"(date_to + 1)::timestamp at time zone timezone_name as ends_at",
		"e.created_at >= p.starts_at and e.created_at < p.ends_at",
		"e.created_at >= (p.date_from - p.days)::timestamp at time zone p.timezone_name",
		"e.created_at < p.starts_at",
	} {
		if !strings.Contains(summary, required) {
			t.Errorf("SiteSummary is missing local calendar bound %q", required)
		}
	}

	for _, name := range []string{"SiteDetailed", "LeadAnalytics", "siteDetailedLegacy", "leadAnalyticsLegacy"} {
		functionSource := repositoryFunctionSource(t, source, name)
		for _, required := range []string{
			"coalesce(params.date_from, (current_timestamp at time zone report_settings.timezone_name)::date - 6) date_from",
			"coalesce(params.date_to, (current_timestamp at time zone report_settings.timezone_name)::date) date_to",
			"date_from::timestamp at time zone timezone_name starts_at",
			"(date_to + 1)::timestamp at time zone timezone_name ends_at",
			"e.created_at >= time_bounds.starts_at",
			"e.created_at < time_bounds.ends_at",
			"(e.created_at at time zone time_bounds.timezone_name)::date",
		} {
			if !strings.Contains(functionSource, required) {
				t.Errorf("%s is missing local calendar contract %q", name, required)
			}
		}
		for _, forbidden := range []string{
			"e.created_at >= nullif($2,'')::date",
			"e.created_at < nullif($3,'')::date + 1",
			"time_bounds.starts_at is null",
			"time_bounds.ends_at is null",
			"select created_at::date::text date",
		} {
			if strings.Contains(functionSource, forbidden) {
				t.Errorf("%s still depends on the database session timezone via %q", name, forbidden)
			}
		}
	}
}

func TestLeadAnalyticsExposesDistinctConvertedSessions(t *testing.T) {
	t.Parallel()
	source := readAnalyticsSource(t, "site_repository.go")
	for _, name := range []string{"LeadAnalytics", "leadAnalyticsLegacy"} {
		functionSource := repositoryFunctionSource(t, source, name)
		for _, required := range []string{
			"'total_conversions',(select count(*) from events where event_type='form_submit')",
			"'total_converted_sessions',(select count(distinct session_id) from events where event_type='form_submit' and session_id not like 'site-contact:%')",
		} {
			if !strings.Contains(functionSource, required) {
				t.Errorf("%s is missing conversion contract %q", name, required)
			}
		}
	}

	openAPI := readAnalyticsSource(t, "../../../../packages/contracts/openapi/v1.yaml")
	if strings.Count(openAPI, "total_converted_sessions") < 2 {
		t.Error("LeadAnalytics OpenAPI schema must require and describe total_converted_sessions")
	}
}

func TestLeadAnalyticsCanonicalizesPageViewFunnelOnly(t *testing.T) {
	t.Parallel()
	source := readAnalyticsSource(t, "site_repository.go")
	for _, name := range []string{"LeadAnalytics", "leadAnalyticsLegacy"} {
		functionSource := repositoryFunctionSource(t, source, name)
		for _, required := range []string{
			"array_agg(event_type order by created_at, id) event_sequence",
			"case when event_type in ('pageview','page_view') then 'pageview' else event_type end event_type",
			"count(distinct session_id)::int total from events",
			"where session_id is not null and session_id not like 'site-contact:%'",
			"and event_type not in ('session_start', 'page_duration')",
			"group by 1 order by total desc",
		} {
			if !strings.Contains(functionSource, required) {
				t.Errorf("%s is missing page-view funnel contract %q", name, required)
			}
		}
		if strings.Contains(functionSource, "array_agg(case when event_type") {
			t.Errorf("%s must preserve raw journey event_sequence values", name)
		}
		if strings.Contains(functionSource, "count(*)::int total from events") {
			t.Errorf("%s funnel must count distinct sessions instead of repeated events", name)
		}
	}
}

func TestSiteAnalyticsUsesOnePaidFirstAcquisitionClassifier(t *testing.T) {
	t.Parallel()
	source := readAnalyticsSource(t, "site_repository.go")

	googleClickMarker := "when coalesce(google_ads_click, false)"
	paidMarker := "or nullif(btrim(utm_campaign), '') is not null"
	facebookClickMarker := "when coalesce(facebook_click, false)"
	searchMarker := "when lower(coalesce(nullif(btrim(utm_medium), ''), '')) in ('organic'"
	googleClickIndex := strings.Index(siteAcquisitionSourceTypeSQL, googleClickMarker)
	paidIndex := strings.Index(siteAcquisitionSourceTypeSQL, paidMarker)
	facebookClickIndex := strings.Index(siteAcquisitionSourceTypeSQL, facebookClickMarker)
	searchIndex := strings.Index(siteAcquisitionSourceTypeSQL, searchMarker)
	if googleClickIndex < 0 || paidIndex < 0 || facebookClickIndex < 0 || searchIndex < 0 ||
		!(googleClickIndex < paidIndex && paidIndex < facebookClickIndex && facebookClickIndex < searchIndex) {
		t.Fatalf("acquisition precedence must be Google Ads/paid, Facebook-social, then organic search: %s", siteAcquisitionSourceTypeSQL)
	}
	for _, paidMedium := range []string{"'cpc'", "'ppc'"} {
		if !strings.Contains(siteAcquisitionSourceTypeSQL, paidMedium) {
			t.Errorf("paid acquisition classifier is missing %s", paidMedium)
		}
	}
	for _, label := range []string{"'Google Ads'", "'Facebook / Meta'"} {
		if !strings.Contains(siteAcquisitionSourceLabelSQL, label) {
			t.Errorf("click-id acquisition label is missing %s", label)
		}
	}

	for _, name := range []string{"SiteSummary", "SiteDetailed", "siteDetailedLegacy"} {
		functionSource := repositoryFunctionSource(t, source, name)
		if !strings.Contains(functionSource, "siteAcquisitionSourceTypeSQL") {
			t.Errorf("%s does not use the canonical acquisition classifier", name)
		}
	}
	for _, name := range []string{"SiteSummary", "SiteDetailed"} {
		functionSource := repositoryFunctionSource(t, source, name)
		for _, required := range []string{"metadata->>'google_ads_click'", "metadata->>'facebook_click'"} {
			if !strings.Contains(functionSource, required) {
				t.Errorf("%s does not project click attribution marker %q", name, required)
			}
		}
	}
	if legacy := repositoryFunctionSource(t, source, "siteDetailedLegacy"); !strings.Contains(legacy, "false google_ads_click, false facebook_click") {
		t.Error("legacy site analytics must not query a metadata column that may not exist")
	}
	for _, name := range []string{"SiteDetailed", "siteDetailedLegacy"} {
		functionSource := repositoryFunctionSource(t, source, name)
		for _, required := range []string{
			"classified.source_type",
			"count(*)::int sessions",
			"group by classified.source, classified.campaign, classified.source_type",
		} {
			if !strings.Contains(functionSource, required) {
				t.Errorf("%s is missing detailed acquisition contract %q", name, required)
			}
		}
	}
}

func TestLeadAnalyticsSeparatesNavigationPathFromRawEvents(t *testing.T) {
	t.Parallel()
	source := readAnalyticsSource(t, "site_repository.go")

	for _, name := range []string{"LeadAnalytics", "leadAnalyticsLegacy"} {
		functionSource := repositoryFunctionSource(t, source, name)
		for _, required := range []string{
			"filter (where event_type in ('pageview','page_view') and nullif(btrim(page_path), '') is not null)",
			"array[]::text[]",
			"array_agg(event_type order by created_at, id) event_sequence",
		} {
			if !strings.Contains(functionSource, required) {
				t.Errorf("%s is missing journey sequence contract %q", name, required)
			}
		}
	}
}

func TestSiteSummaryKeepsUnknownDevicesVisible(t *testing.T) {
	t.Parallel()
	source := readAnalyticsSource(t, "site_repository.go")
	summary := repositoryFunctionSource(t, source, "SiteSummary")

	for _, required := range []string{
		"when first_device in ('desktop', 'mobile', 'tablet') then first_device",
		"else 'other'",
		"(select count(*)::numeric from current_sessions where device_type = 'other') other_device",
		"case when t.sessions>0 then round(t.other_device*100/t.sessions,2) else 0 end other_pct",
		"when t.desktop >= t.mobile and t.desktop >= t.tablet and t.desktop >= t.other_device then 'desktop'",
		"'otherDevicePct', case when d.balance_device='other' then 100-d.desktop_pct-d.mobile_pct-d.tablet_pct else d.other_pct end",
		"cross join device_percentages d",
	} {
		if !strings.Contains(summary, required) {
			t.Errorf("SiteSummary is missing explicit other-device contract %q", required)
		}
	}

	for _, name := range []string{"LeadAnalytics", "leadAnalyticsLegacy"} {
		functionSource := repositoryFunctionSource(t, source, name)
		if !strings.Contains(functionSource, "select device_type, count(*)::int total from session_devices group by device_type") {
			t.Errorf("%s device breakdown must assign every session to exactly one device bucket", name)
		}
	}

	openAPI := readAnalyticsSource(t, "../../../../packages/contracts/openapi/v1.yaml")
	for _, required := range []string{
		"otherDevicePct:",
		"enum: [desktop, mobile, tablet, other]",
	} {
		if !strings.Contains(openAPI, required) {
			t.Errorf("site analytics OpenAPI is missing device contract %q", required)
		}
	}
}
