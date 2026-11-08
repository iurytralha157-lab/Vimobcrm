package app

import (
	"strings"
	"testing"
)

func TestMetaIntegrationRoutesAreOwnedByGoBackend(t *testing.T) {
	source := readAppWiringSource(t)
	for _, route := range []string{
		`GET /v1/public/integrations/meta/oauth/callback`,
		`POST /v1/integrations/meta/oauth/actions`,
		`PUT /v1/integrations/meta/conversion-feedback`,
		`POST /v1/integrations/meta/marketing/sync`,
		`GET /v1/integrations/meta/pages/{pageId}/forms`,
		`POST /v1/integrations/meta/conversations/{id}/messages`,
		`GET /v1/public/integrations/meta/webhook`,
		`POST /v1/public/integrations/meta/webhook`,
	} {
		if !strings.Contains(source, route) {
			t.Fatalf("native Meta route %q is not registered", route)
		}
	}
	for _, constructor := range []string{
		"meta.NewOAuthHandler(",
		"meta.NewMarketingSyncHTTPHandler(",
		"meta.NewMarketingSyncService(",
	} {
		if !strings.Contains(source, constructor) {
			t.Fatalf("native Meta component %q is not wired", constructor)
		}
	}
	if !strings.Contains(source, "AppSecret:    cfg.Meta.AppSecret") {
		t.Fatal("Meta Marketing Sync must receive META_APP_SECRET for appsecret_proof")
	}
	for _, guard := range []string{
		`GET /v1/analytics/meta-insights", withActiveModulePermission("campaigns", permissions.DashboardCampaignsView, http.HandlerFunc(analyticsHandler.MetaInsights))`,
		`GET /v1/analytics/campaign-insights", withActiveModulePermission("campaigns", permissions.DashboardCampaignsView, http.HandlerFunc(analyticsHandler.CampaignInsights))`,
		`withModulePermission("campaigns", permissions.SettingsIntegrations, http.HandlerFunc(metaMarketingSyncHandler.Sync))`,
		`withModulePermission("campaigns", permissions.SettingsIntegrations, http.HandlerFunc(integrationsHandler.SaveMetaConversionFeedback))`,
		`withModulesPermission([]string{"whatsapp", "campaigns"}, permissions.WhatsAppView, http.HandlerFunc(integrationsHandler.ListMetaConversations))`,
		`withModulesPermission([]string{"whatsapp", "campaigns"}, permissions.WhatsAppOperate, http.HandlerFunc(integrationsHandler.SendMetaMessage))`,
	} {
		if !strings.Contains(source, guard) {
			t.Fatalf("Meta deep capability is missing module/permission guard %q", guard)
		}
	}
	for _, baseRoute := range []string{
		`GET /v1/integrations/meta", withPermission(permissions.SettingsIntegrations`,
		`POST /v1/integrations/meta/oauth/actions", withActivePermission(permissions.SettingsIntegrations`,
		`GET /v1/integrations/meta/form-configs", withPermission(permissions.SettingsIntegrations`,
	} {
		if !strings.Contains(source, baseRoute) {
			t.Fatalf("base Meta lead intake must stay available without the Marketing module: %q", baseRoute)
		}
	}
}

// Marketing connections need the Marketing module and the integrations
// permission; only the OAuth callback may be public.
func TestMarketingConnectionRoutesAreGuarded(t *testing.T) {
	source := readAppWiringSource(t)
	for _, route := range []string{
		`GET /v1/marketing/connections"`,
		`POST /v1/marketing/connections/meta/start"`,
		`PUT /v1/marketing/connections/{id}/assets"`,
		`POST /v1/marketing/connections/{id}/sync"`,
		`DELETE /v1/marketing/connections/{id}"`,
	} {
		guarded := route + `, withActiveModulePermission("campaigns", permissions.SettingsIntegrations,`
		if !strings.Contains(source, guarded) {
			t.Errorf("route %s is missing its guard", route)
		}
	}
	if !strings.Contains(source, `"GET /v1/public/marketing/oauth/meta/callback"`) {
		t.Error("Marketing OAuth callback is not registered")
	}
}
