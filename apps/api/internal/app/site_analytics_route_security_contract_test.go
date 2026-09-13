package app

import (
	"strings"
	"testing"
)

func TestSiteAnalyticsRoutesRequireDedicatedModulePermission(t *testing.T) {
	source := readAppWiringSource(t)

	for _, route := range []string{
		`mux.Handle("GET /v1/analytics/lead", withModulePermission("site", permissions.DashboardSiteView, http.HandlerFunc(analyticsHandler.LeadAnalytics)))`,
		`mux.Handle("GET /v1/analytics/site-summary", withModulePermission("site", permissions.DashboardSiteView, http.HandlerFunc(analyticsHandler.SiteSummary)))`,
		`mux.Handle("GET /v1/analytics/site-detailed", withModulePermission("site", permissions.DashboardSiteView, http.HandlerFunc(analyticsHandler.SiteDetailed)))`,
	} {
		if !strings.Contains(source, route) {
			t.Fatalf("site analytics route must require the site module and dashboard_site_view: %s", route)
		}
	}

	for _, insufficientGuard := range []string{
		`mux.Handle("GET /v1/analytics/lead", withOrganization(`,
		`mux.Handle("GET /v1/analytics/site-summary", withOrganization(`,
		`mux.Handle("GET /v1/analytics/site-detailed", withOrganization(`,
		`mux.Handle("GET /v1/analytics/lead", withAuthTenant(`,
		`mux.Handle("GET /v1/analytics/site-summary", withAuthTenant(`,
		`mux.Handle("GET /v1/analytics/site-detailed", withAuthTenant(`,
	} {
		if strings.Contains(source, insufficientGuard) {
			t.Fatalf("site analytics route uses an insufficient gateway guard: %s", insufficientGuard)
		}
	}
}
