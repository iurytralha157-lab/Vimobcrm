package app

import (
	"net/http"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/admin"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/ai"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/analytics"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/attention"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/audit"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/automations"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/cadences"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/developments"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/financial"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/gamification"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/health"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/help"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/homefocus"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/integrations"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/leads"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/marketing"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/me"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/meta"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/pipelines"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/portals"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/presence"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/properties"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/publicapi"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/publications"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/realtime"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/roundrobin"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/schedule"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/settings"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/site"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/stageconfig"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/teams"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/telemetry"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/users"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/webhooks"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/whatsapp"
	authpkg "github.com/vimob-crm/vimob-crm/packages/auth"
)

type routeDependencies struct {
	authVerifier             *authpkg.Verifier
	activeSessionChecker     httpserver.ActiveSessionChecker
	tenantRepository         tenant.Resolver
	adminHandler             admin.Handler
	aiHandler                ai.Handler
	analyticsHandler         analytics.Handler
	attentionHandler         attention.Handler
	auditHandler             audit.Handler
	automationsHandler       automations.Handler
	cadencesHandler          cadences.Handler
	developmentsHandler      developments.Handler
	financialHandler         financial.Handler
	gamificationHandler      gamification.Handler
	healthHandler            health.Handler
	helpHandler              help.Handler
	homeFocusHandler         homefocus.Handler
	integrationsHandler      integrations.Handler
	leadsHandler             leads.Handler
	automationStageHandler   leads.AutomationStageCommandHandler
	marketingHandler         *marketing.Handler
	meHandler                me.Handler
	metaHandler              meta.Handler
	metaMarketingSyncHandler meta.MarketingSyncHTTPHandler
	metaOAuthActionHandler   http.HandlerFunc
	metaOAuthCallbackHandler http.HandlerFunc
	pipelinesHandler         pipelines.Handler
	portalsHandler           portals.Handler
	presenceHandler          presence.Handler
	propertiesHandler        properties.Handler
	publicAPIHandler         publicapi.Handler
	publicationsHandler      publications.Handler
	realtimeHandler          realtime.Handler
	roundRobinHandler        roundrobin.Handler
	scheduleHandler          schedule.Handler
	settingsHandler          settings.Handler
	siteHandler              site.Handler
	stageConfigHandler       stageconfig.Handler
	teamsHandler             teams.Handler
	telemetryHandler         telemetry.Handler
	usersHandler             users.Handler
	webhooksHandler          webhooks.Handler
	whatsappHandler          whatsapp.Handler
}

func registerRoutes(mux *http.ServeMux, dependencies routeDependencies) {
	authVerifier := dependencies.authVerifier
	activeSessionChecker := dependencies.activeSessionChecker
	tenantRepository := dependencies.tenantRepository
	adminHandler := dependencies.adminHandler
	aiHandler := dependencies.aiHandler
	analyticsHandler := dependencies.analyticsHandler
	attentionHandler := dependencies.attentionHandler
	auditHandler := dependencies.auditHandler
	automationsHandler := dependencies.automationsHandler
	cadencesHandler := dependencies.cadencesHandler
	developmentsHandler := dependencies.developmentsHandler
	financialHandler := dependencies.financialHandler
	gamificationHandler := dependencies.gamificationHandler
	healthHandler := dependencies.healthHandler
	helpHandler := dependencies.helpHandler
	homeFocusHandler := dependencies.homeFocusHandler
	integrationsHandler := dependencies.integrationsHandler
	leadsHandler := dependencies.leadsHandler
	meHandler := dependencies.meHandler
	metaHandler := dependencies.metaHandler
	metaMarketingSyncHandler := dependencies.metaMarketingSyncHandler
	metaOAuthActionHandler := dependencies.metaOAuthActionHandler
	metaOAuthCallbackHandler := dependencies.metaOAuthCallbackHandler
	pipelinesHandler := dependencies.pipelinesHandler
	portalsHandler := dependencies.portalsHandler
	presenceHandler := dependencies.presenceHandler
	propertiesHandler := dependencies.propertiesHandler
	publicAPIHandler := dependencies.publicAPIHandler
	publicationsHandler := dependencies.publicationsHandler
	realtimeHandler := dependencies.realtimeHandler
	roundRobinHandler := dependencies.roundRobinHandler
	scheduleHandler := dependencies.scheduleHandler
	settingsHandler := dependencies.settingsHandler
	siteHandler := dependencies.siteHandler
	stageConfigHandler := dependencies.stageConfigHandler
	teamsHandler := dependencies.teamsHandler
	telemetryHandler := dependencies.telemetryHandler
	usersHandler := dependencies.usersHandler
	webhooksHandler := dependencies.webhooksHandler
	whatsappHandler := dependencies.whatsappHandler

	withAuth := func(handler http.Handler) http.Handler {
		return httpserver.RequireAuth(authVerifier, handler)
	}
	withActiveAuth := func(handler http.Handler) http.Handler {
		return withAuth(httpserver.RequireActiveSession(activeSessionChecker, handler))
	}

	billingAccessAllowlist := tenant.NewBillingAccessAllowlist(
		"GET /v1/me",
		"GET /v1/me/profile",
		"POST /v1/me/switch-organization",
		"GET /v1/user-organizations",
		"POST /v1/telemetry/errors",
		"GET /v1/admin/error-events",
		"POST /v1/admin/error-events/{id}/resolve",
		"GET /v1/subscription-plans/active",
		"GET /v1/settings/subscription",
		"POST /v1/settings/subscription/payments/{id}/refresh",
		"PATCH /v1/settings/subscription/billing",
		"PATCH /v1/settings/subscription/plan",
		"POST /v1/settings/subscription/charge",
		"GET /v1/home/publications",
		"GET /v1/home/notices",
		"POST /v1/home/assistant",
		"GET /v1/help/articles",
		"GET /v1/help/articles/{slug}",
		"POST /v1/help/search",
	)
	withActiveAuthTenant := func(handler http.Handler) http.Handler {
		return withActiveAuth(
			tenant.Attach(
				tenantRepository,
				tenant.RequireBillingAccess(billingAccessAllowlist, handler),
			),
		)
	}
	// Tenant routes reject revoked sessions before resolving organization access.
	withAuthTenant := withActiveAuthTenant

	withOrganization := func(handler http.Handler) http.Handler {
		return withAuthTenant(tenant.RequireOrganization(handler))
	}
	withActiveOrganization := func(handler http.Handler) http.Handler {
		return withActiveAuthTenant(tenant.RequireOrganization(handler))
	}

	withFinancialOrganization := func(handler http.Handler) http.Handler {
		return withOrganization(tenant.RequireFinancialAccess(handler))
	}

	withModulePermission := func(module string, permission string, handler http.Handler) http.Handler {
		return withOrganization(tenant.RequireModule(module, tenant.RequirePermission(permission, handler)))
	}
	withActiveModulePermission := func(module string, permission string, handler http.Handler) http.Handler {
		return withActiveOrganization(tenant.RequireModule(module, tenant.RequirePermission(permission, handler)))
	}

	withModuleAnyPermission := func(module string, permissionKeys []string, handler http.Handler) http.Handler {
		return withOrganization(tenant.RequireModule(module, tenant.RequireAnyPermission(permissionKeys, handler)))
	}

	withModulesPermission := func(modules []string, permission string, handler http.Handler) http.Handler {
		guarded := tenant.RequirePermission(permission, handler)
		for index := len(modules) - 1; index >= 0; index-- {
			guarded = tenant.RequireModule(modules[index], guarded)
		}
		return withOrganization(guarded)
	}

	withPermission := func(permission string, handler http.Handler) http.Handler {
		return withOrganization(tenant.RequirePermission(permission, handler))
	}
	withActivePermission := func(permission string, handler http.Handler) http.Handler {
		return withActiveAuthTenant(tenant.RequireOrganization(tenant.RequirePermission(permission, handler)))
	}

	mux.HandleFunc("GET /healthz", healthHandler.Health)
	mux.HandleFunc("GET /readyz", healthHandler.Ready)
	mux.HandleFunc("POST /v1/internal/whatsapp/auto-reply", whatsappHandler.AutoReply)
	mux.Handle("POST /v1/internal/automations/stage-command", dependencies.automationStageHandler)
	mux.Handle("GET /v1/me", withActiveAuthTenant(http.HandlerFunc(meHandler.Show)))
	mux.Handle("GET /v1/me/account-status", withActiveAuth(http.HandlerFunc(meHandler.ShowAccountStatus)))
	mux.Handle("GET /v1/me/profile", withActiveAuthTenant(http.HandlerFunc(meHandler.ShowProfile)))
	mux.Handle("POST /v1/me/switch-organization", withActiveAuthTenant(http.HandlerFunc(meHandler.SwitchOrganization)))
	mux.Handle("GET /v1/realtime/events", withActiveOrganization(http.HandlerFunc(realtimeHandler.WithActiveSessionChecker(activeSessionChecker).Events)))
	mux.Handle("POST /v1/telemetry/errors", withAuthTenant(http.HandlerFunc(telemetryHandler.CreateErrorEvent)))
	mux.Handle("GET /v1/audit-logs", withActiveAuthTenant(http.HandlerFunc(auditHandler.List)))
	mux.Handle("POST /v1/audit-logs", withActiveAuthTenant(http.HandlerFunc(auditHandler.RejectClientCreate)))
	mux.Handle("GET /v1/analytics/meta-insights", withActiveModulePermission("campaigns", permissions.DashboardCampaignsView, http.HandlerFunc(analyticsHandler.MetaInsights)))
	mux.Handle("GET /v1/analytics/campaign-insights", withActiveModulePermission("campaigns", permissions.DashboardCampaignsView, http.HandlerFunc(analyticsHandler.CampaignInsights)))
	mux.Handle("GET /v1/analytics/lead", withModulePermission("site", permissions.DashboardSiteView, http.HandlerFunc(analyticsHandler.LeadAnalytics)))
	mux.Handle("GET /v1/analytics/site-summary", withModulePermission("site", permissions.DashboardSiteView, http.HandlerFunc(analyticsHandler.SiteSummary)))
	mux.Handle("GET /v1/analytics/site-detailed", withModulePermission("site", permissions.DashboardSiteView, http.HandlerFunc(analyticsHandler.SiteDetailed)))
	mux.Handle("GET /v1/analytics/enterprise-kpis", withActivePermission(permissions.DashboardView, tenant.RequireFinancialAccess(tenant.RequireAnyPermission([]string{permissions.FinancialView, permissions.FinancialManage}, http.HandlerFunc(analyticsHandler.EnterpriseKPIs)))))
	mux.Handle("GET /v1/analytics/dre-executive", withActivePermission(permissions.FinancialView, tenant.RequireFinancialAccess(http.HandlerFunc(analyticsHandler.DREExecutive))))
	mux.Handle("GET /v1/analytics/sla-summary", withActivePermission(permissions.DashboardView, http.HandlerFunc(analyticsHandler.SlaSummary)))
	mux.Handle("GET /v1/analytics/sla-performance-by-user", withActivePermission(permissions.DashboardView, http.HandlerFunc(analyticsHandler.SlaPerformanceByUser)))
	mux.Handle("GET /v1/analytics/team-ranking", withActivePermission(permissions.DashboardView, http.HandlerFunc(analyticsHandler.TeamRanking)))
	mux.Handle("GET /v1/analytics/vgv-stats", withActivePermission(permissions.DashboardView, http.HandlerFunc(analyticsHandler.VGVStats)))
	mux.Handle("GET /v1/analytics/vgv-by-broker", withActivePermission(permissions.DashboardView, http.HandlerFunc(analyticsHandler.VGVByBroker)))
	mux.Handle("GET /v1/analytics/stage-vgv", withActivePermission(permissions.DashboardView, http.HandlerFunc(analyticsHandler.StageVGV)))
	mux.Handle("GET /v1/analytics/leader-stats", withActivePermission(permissions.DashboardView, http.HandlerFunc(analyticsHandler.LeaderStats)))
	mux.Handle("GET /v1/analytics/team-leader-stats/{teamId}", withActivePermission(permissions.DashboardView, http.HandlerFunc(analyticsHandler.TeamLeaderStats)))
	mux.Handle("GET /v1/attention/settings", withPermission(permissions.AttentionView, http.HandlerFunc(attentionHandler.GetSettings)))
	mux.Handle("PATCH /v1/attention/settings", withPermission(permissions.AttentionView, http.HandlerFunc(attentionHandler.UpdateSettings)))
	mux.Handle("GET /v1/attention/policies", withPermission(permissions.AttentionView, http.HandlerFunc(attentionHandler.ListPolicies)))
	mux.Handle("POST /v1/attention/policies", withPermission(permissions.AttentionView, http.HandlerFunc(attentionHandler.CreatePolicy)))
	mux.Handle("PATCH /v1/attention/policies/{id}", withPermission(permissions.AttentionView, http.HandlerFunc(attentionHandler.UpdatePolicy)))
	mux.Handle("GET /v1/attention/items", withPermission(permissions.AttentionView, http.HandlerFunc(attentionHandler.ListItems)))
	mux.Handle("GET /v1/attention/summary", withPermission(permissions.AttentionView, http.HandlerFunc(attentionHandler.Summary)))
	mux.Handle("POST /v1/attention/items/{id}/acknowledge", withPermission(permissions.AttentionView, http.HandlerFunc(attentionHandler.AcknowledgeItem)))
	mux.Handle("POST /v1/attention/items/{id}/snooze", withPermission(permissions.AttentionView, http.HandlerFunc(attentionHandler.SnoozeItem)))
	mux.Handle("POST /v1/attention/items/{id}/resolve", withPermission(permissions.AttentionView, http.HandlerFunc(attentionHandler.ResolveItem)))
	mux.Handle("GET /v1/home/focus", withPermission(permissions.AttentionView, http.HandlerFunc(homeFocusHandler.List)))
	mux.Handle("GET /v1/home/notices", withOrganization(http.HandlerFunc(homeFocusHandler.Notices)))
	mux.Handle("GET /v1/admin/error-events", withActiveAuthTenant(http.HandlerFunc(telemetryHandler.ListErrorEvents)))
	mux.Handle("POST /v1/admin/error-events/{id}/resolve", withActiveAuthTenant(http.HandlerFunc(telemetryHandler.ResolveErrorEvent)))
	mux.Handle("GET /v1/gamification/overview", withModulePermission("gamification", permissions.GamificationView, http.HandlerFunc(gamificationHandler.Overview)))
	mux.Handle("GET /v1/gamification/ranking", withModulePermission("gamification", permissions.GamificationView, http.HandlerFunc(gamificationHandler.Ranking)))
	mux.Handle("GET /v1/gamification/events", withModulePermission("gamification", permissions.GamificationView, http.HandlerFunc(gamificationHandler.Events)))
	mux.Handle("GET /v1/gamification/admin", withModulePermission("gamification", permissions.GamificationView, http.HandlerFunc(gamificationHandler.AdminSnapshot)))
	mux.Handle("PUT /v1/gamification/rules/{actionType}", withModulePermission("gamification", permissions.GamificationManage, http.HandlerFunc(gamificationHandler.UpsertRule)))
	mux.Handle("PATCH /v1/gamification/participants/{userId}", withModulePermission("gamification", permissions.GamificationManage, http.HandlerFunc(gamificationHandler.SetParticipant)))
	mux.Handle("POST /v1/gamification/missions", withModulePermission("gamification", permissions.GamificationManage, http.HandlerFunc(gamificationHandler.CreateMission)))
	mux.Handle("PATCH /v1/gamification/missions/{id}", withModulePermission("gamification", permissions.GamificationManage, http.HandlerFunc(gamificationHandler.UpdateMission)))
	mux.Handle("DELETE /v1/gamification/missions/{id}", withModulePermission("gamification", permissions.GamificationManage, http.HandlerFunc(gamificationHandler.DeleteMission)))
	mux.Handle("POST /v1/gamification/manual-entries", withModulePermission("gamification", permissions.GamificationView, http.HandlerFunc(gamificationHandler.CreateManualEntry)))
	mux.Handle("PATCH /v1/gamification/manual-entries/{id}", withModulePermission("gamification", permissions.GamificationManage, http.HandlerFunc(gamificationHandler.DecideManualEntry)))
	mux.Handle("POST /v1/gamification/seasons", withModulePermission("gamification", permissions.GamificationManage, http.HandlerFunc(gamificationHandler.ResetSeason)))
	mux.Handle("GET /v1/cadence-templates", withOrganization(http.HandlerFunc(cadencesHandler.ListTemplates)))
	mux.Handle("GET /v1/stages/{id}/operational-rules", withActiveOrganization(http.HandlerFunc(cadencesHandler.GetOperationalRules)))
	mux.Handle("PUT /v1/stages/{id}/operational-rules", withActiveOrganization(tenant.RequireAnyPermission(
		[]string{permissions.PipelineManage, permissions.AutomationsManage},
		http.HandlerFunc(cadencesHandler.UpsertOperationalRules),
	)))
	mux.Handle("GET /v1/leads/{id}/cadence-state", withActiveOrganization(http.HandlerFunc(cadencesHandler.GetLeadCadenceState)))
	mux.Handle("POST /v1/cadence-tasks", withActivePermission(permissions.PipelineManage, http.HandlerFunc(cadencesHandler.CreateTask)))
	mux.Handle("PATCH /v1/cadence-tasks/{id}", withActivePermission(permissions.PipelineManage, http.HandlerFunc(cadencesHandler.UpdateTask)))
	mux.Handle("DELETE /v1/cadence-tasks/{id}", withActivePermission(permissions.PipelineManage, http.HandlerFunc(cadencesHandler.DeleteTask)))
	mux.Handle("POST /v1/leads/{id}/cadence", withActivePermission(permissions.LeadOperate, http.HandlerFunc(cadencesHandler.SwitchLeadCadence)))
	mux.Handle("GET /v1/financial/categories", withFinancialOrganization(http.HandlerFunc(financialHandler.ListCategories)))
	mux.Handle("POST /v1/financial/categories", withFinancialOrganization(http.HandlerFunc(financialHandler.CreateCategory)))
	mux.Handle("GET /v1/financial/entries", withFinancialOrganization(http.HandlerFunc(financialHandler.ListEntries)))
	mux.Handle("POST /v1/financial/entries", withFinancialOrganization(http.HandlerFunc(financialHandler.CreateEntry)))
	mux.Handle("PATCH /v1/financial/entries/{id}", withFinancialOrganization(http.HandlerFunc(financialHandler.UpdateEntry)))
	mux.Handle("DELETE /v1/financial/entries/{id}", withFinancialOrganization(http.HandlerFunc(financialHandler.DeleteEntry)))
	mux.Handle("POST /v1/financial/entries/{id}/pay", withFinancialOrganization(http.HandlerFunc(financialHandler.MarkEntryPaid)))
	mux.Handle("GET /v1/financial/dashboard", withFinancialOrganization(http.HandlerFunc(financialHandler.Dashboard)))
	mux.Handle("GET /v1/contracts", withFinancialOrganization(http.HandlerFunc(financialHandler.ListContracts)))
	mux.Handle("POST /v1/contracts", withFinancialOrganization(http.HandlerFunc(financialHandler.CreateContract)))
	mux.Handle("GET /v1/contracts/{id}", withFinancialOrganization(http.HandlerFunc(financialHandler.ShowContract)))
	mux.Handle("PATCH /v1/contracts/{id}", withFinancialOrganization(http.HandlerFunc(financialHandler.UpdateContract)))
	mux.Handle("DELETE /v1/contracts/{id}", withFinancialOrganization(http.HandlerFunc(financialHandler.DeleteContract)))
	mux.Handle("POST /v1/contracts/{id}/activate", withFinancialOrganization(http.HandlerFunc(financialHandler.ActivateContract)))
	mux.Handle("POST /v1/contracts/{id}/regenerate-commissions", withFinancialOrganization(http.HandlerFunc(financialHandler.RegenerateCommissions)))
	mux.Handle("GET /v1/contracts/{id}/documents", withFinancialOrganization(http.HandlerFunc(financialHandler.ListContractDocuments)))
	mux.Handle("POST /v1/contracts/{id}/documents", withFinancialOrganization(http.HandlerFunc(financialHandler.UploadContractDocument)))
	mux.Handle("DELETE /v1/contracts/{id}/documents", withFinancialOrganization(http.HandlerFunc(financialHandler.DeleteContractDocument)))
	mux.Handle("POST /v1/contracts/{id}/documents/signed-url", withFinancialOrganization(http.HandlerFunc(financialHandler.ContractDocumentSignedURL)))
	mux.Handle("GET /v1/commission-rules", withFinancialOrganization(http.HandlerFunc(financialHandler.ListCommissionRules)))
	mux.Handle("POST /v1/commission-rules", withFinancialOrganization(http.HandlerFunc(financialHandler.CreateCommissionRule)))
	mux.Handle("PATCH /v1/commission-rules/{id}", withFinancialOrganization(http.HandlerFunc(financialHandler.UpdateCommissionRule)))
	mux.Handle("DELETE /v1/commission-rules/{id}", withFinancialOrganization(http.HandlerFunc(financialHandler.DeleteCommissionRule)))
	mux.Handle("GET /v1/commissions", withFinancialOrganization(http.HandlerFunc(financialHandler.ListCommissions)))
	mux.Handle("POST /v1/commissions/{id}/{action}", withFinancialOrganization(http.HandlerFunc(financialHandler.CommissionStatus)))
	mux.Handle("GET /v1/commissions/by-broker", withFinancialOrganization(http.HandlerFunc(financialHandler.CommissionsByBroker)))
	mux.Handle("GET /v1/dre/input", withFinancialOrganization(http.HandlerFunc(financialHandler.DREInput)))
	mux.Handle("GET /v1/dre/groups", withFinancialOrganization(http.HandlerFunc(financialHandler.DREGroups)))
	mux.Handle("GET /v1/dre/mappings", withFinancialOrganization(http.HandlerFunc(financialHandler.DREMappings)))
	mux.Handle("POST /v1/dre/mappings", withFinancialOrganization(http.HandlerFunc(financialHandler.CreateDREMapping)))
	mux.Handle("DELETE /v1/dre/mappings/{id}", withFinancialOrganization(http.HandlerFunc(financialHandler.DeleteDREMapping)))
	mux.Handle("POST /v1/dre/groups/initialize", withFinancialOrganization(http.HandlerFunc(financialHandler.InitializeDREGroups)))
	mux.Handle("GET /v1/stage-automations", withActiveModulePermission("automations", permissions.AutomationsView, http.HandlerFunc(stageConfigHandler.ListAutomations)))
	mux.Handle("POST /v1/stage-inactivity-automations", withActiveModulePermission("automations", permissions.AutomationsManage, http.HandlerFunc(stageConfigHandler.CreateInactivityAutomation)))
	mux.Handle("PUT /v1/stage-automations/{id}/inactivity", withActiveModulePermission("automations", permissions.AutomationsManage, http.HandlerFunc(stageConfigHandler.UpdateInactivityAutomation)))
	mux.Handle("POST /v1/stage-automations", withActiveModulePermission("automations", permissions.AutomationsManage, http.HandlerFunc(stageConfigHandler.CreateAutomation)))
	mux.Handle("PATCH /v1/stage-automations/{id}", withActiveModulePermission("automations", permissions.AutomationsManage, http.HandlerFunc(stageConfigHandler.UpdateAutomation)))
	mux.Handle("DELETE /v1/stage-automations/{id}", withActiveModulePermission("automations", permissions.AutomationsManage, http.HandlerFunc(stageConfigHandler.DeleteAutomation)))
	mux.Handle("PATCH /v1/stage-automations/{id}/status", withActiveModulePermission("automations", permissions.AutomationsManage, http.HandlerFunc(stageConfigHandler.ToggleAutomation)))
	mux.Handle("GET /v1/stage-operational-configs", withActivePermission(permissions.PipelineManage, http.HandlerFunc(stageConfigHandler.ListOperationalConfigs)))
	mux.Handle("PUT /v1/stage-operational-configs", withActivePermission(permissions.PipelineManage, http.HandlerFunc(stageConfigHandler.UpsertOperationalConfig)))
	mux.Handle("GET /v1/pipeline-sla-settings", withActivePermission(permissions.PipelineManage, http.HandlerFunc(stageConfigHandler.ListPipelineSLASettings)))
	mux.Handle("PUT /v1/pipeline-sla-settings", withActivePermission(permissions.PipelineManage, http.HandlerFunc(stageConfigHandler.UpsertPipelineSLASettings)))
	mux.Handle("GET /v1/admin/organizations", withActiveAuthTenant(http.HandlerFunc(adminHandler.ListOrganizations)))
	mux.Handle("POST /v1/admin/organizations", withActiveAuthTenant(http.HandlerFunc(adminHandler.CreateOrganization)))
	mux.Handle("PATCH /v1/admin/organizations/{id}", withActiveAuthTenant(http.HandlerFunc(adminHandler.UpdateOrganization)))
	mux.Handle("DELETE /v1/admin/organizations/{id}", withActiveAuthTenant(http.HandlerFunc(adminHandler.DeleteOrganization)))
	mux.Handle("GET /v1/admin/organizations/{id}/modules", withActiveAuthTenant(http.HandlerFunc(adminHandler.ListOrganizationModules)))
	mux.Handle("GET /v1/admin/organizations/{id}/payments", withActiveAuthTenant(http.HandlerFunc(adminHandler.ListOrganizationPayments)))
	mux.Handle("POST /v1/admin/organizations/{id}/access", withActiveAuthTenant(http.HandlerFunc(adminHandler.UpdateOrganizationAccess)))
	mux.Handle("GET /v1/admin/users", withActiveAuthTenant(http.HandlerFunc(adminHandler.ListUsers)))
	mux.Handle("PATCH /v1/admin/users/{id}", withActiveAuthTenant(http.HandlerFunc(adminHandler.UpdateUser)))
	mux.Handle("DELETE /v1/admin/users/{id}", withActiveAuthTenant(http.HandlerFunc(adminHandler.DeleteUser)))
	mux.Handle("POST /v1/admin/users/{id}/reset-password", withActiveAuthTenant(http.HandlerFunc(adminHandler.ResetUserPassword)))
	mux.Handle("GET /v1/announcements/active", withAuthTenant(http.HandlerFunc(adminHandler.ListActiveAnnouncements)))
	mux.Handle("GET /v1/home/publications", withAuthTenant(http.HandlerFunc(adminHandler.ListHomePublications)))
	mux.Handle("POST /v1/home/assistant", withAuthTenant(http.HandlerFunc(adminHandler.AnswerHomeAssistant)))
	mux.Handle("GET /v1/help/articles", withAuthTenant(http.HandlerFunc(helpHandler.ListArticles)))
	mux.Handle("GET /v1/help/articles/{slug}", withAuthTenant(http.HandlerFunc(helpHandler.ShowArticle)))
	mux.Handle("POST /v1/help/search", withAuthTenant(http.HandlerFunc(helpHandler.SearchArticles)))
	mux.Handle("GET /v1/public/help/articles", http.HandlerFunc(helpHandler.ListPublicArticles))
	mux.Handle("GET /v1/public/help/articles/{slug}", http.HandlerFunc(helpHandler.ShowPublicArticle))
	mux.Handle("GET /v1/admin/home-publications", withActiveAuthTenant(http.HandlerFunc(adminHandler.ListHomePublicationsAdmin)))
	mux.Handle("POST /v1/admin/home-publications", withActiveAuthTenant(http.HandlerFunc(adminHandler.CreateHomePublicationAdmin)))
	mux.Handle("PUT /v1/admin/home-publications/order", withActiveAuthTenant(http.HandlerFunc(adminHandler.ReorderHomePublicationsAdmin)))
	mux.Handle("PATCH /v1/admin/home-publications/{id}", withActiveAuthTenant(http.HandlerFunc(adminHandler.UpdateHomePublicationAdmin)))
	mux.Handle("DELETE /v1/admin/home-publications/{id}", withActiveAuthTenant(http.HandlerFunc(adminHandler.DeleteHomePublicationAdmin)))
	mux.Handle("POST /v1/admin/home-publications/{id}/image", withActiveAuthTenant(http.HandlerFunc(adminHandler.UploadHomePublicationImageAdmin)))
	mux.Handle("DELETE /v1/admin/home-publications/{id}/image", withActiveAuthTenant(http.HandlerFunc(adminHandler.DeleteHomePublicationImageAdmin)))
	mux.Handle("POST /v1/admin/home-publications/{id}/mobile-image", withActiveAuthTenant(http.HandlerFunc(adminHandler.UploadHomePublicationMobileImageAdmin)))
	mux.Handle("DELETE /v1/admin/home-publications/{id}/mobile-image", withActiveAuthTenant(http.HandlerFunc(adminHandler.DeleteHomePublicationMobileImageAdmin)))
	mux.Handle("GET /v1/feature-requests/mine", withAuthTenant(http.HandlerFunc(adminHandler.ListMyFeatureRequests)))
	mux.Handle("POST /v1/feature-requests", withOrganization(http.HandlerFunc(adminHandler.CreateFeatureRequest)))
	mux.Handle("GET /v1/admin/feature-requests", withActiveAuthTenant(http.HandlerFunc(adminHandler.ListFeatureRequestsAdmin)))
	mux.Handle("PATCH /v1/admin/feature-requests/{id}", withActiveAuthTenant(http.HandlerFunc(adminHandler.RespondFeatureRequestAdmin)))
	mux.Handle("GET /v1/invitations", withActivePermission(permissions.UsersManage, http.HandlerFunc(adminHandler.ListInvitations)))
	mux.Handle("POST /v1/invitations", withActivePermission(permissions.UsersManage, http.HandlerFunc(adminHandler.CreateInvitation)))
	mux.Handle("PATCH /v1/invitations/{id}", withActivePermission(permissions.UsersManage, http.HandlerFunc(adminHandler.UpdateInvitationRole)))
	mux.Handle("POST /v1/invitations/{id}/resend", withActivePermission(permissions.UsersManage, http.HandlerFunc(adminHandler.ResendInvitation)))
	mux.Handle("DELETE /v1/invitations/{id}", withActivePermission(permissions.UsersManage, http.HandlerFunc(adminHandler.DeleteInvitation)))
	mux.Handle("POST /v1/invitations/{token}/accept", withActiveAuth(http.HandlerFunc(adminHandler.AcceptInvitationAuthenticated)))
	mux.Handle("GET /v1/onboarding-requests/mine", withAuthTenant(http.HandlerFunc(adminHandler.ShowMyOnboardingRequest)))
	mux.Handle("POST /v1/onboarding-requests", withAuthTenant(http.HandlerFunc(adminHandler.CreateOnboardingRequest)))
	mux.Handle("GET /v1/admin/onboarding-requests", withActiveAuthTenant(http.HandlerFunc(adminHandler.ListOnboardingRequestsAdmin)))
	mux.Handle("PATCH /v1/admin/onboarding-requests/{id}", withActiveAuthTenant(http.HandlerFunc(adminHandler.UpdateOnboardingRequestAdmin)))
	mux.Handle("GET /v1/subscription-plans/active", withAuthTenant(http.HandlerFunc(adminHandler.ListActiveSubscriptionPlans)))
	mux.Handle("POST /v1/admin/modules", withActiveAuthTenant(http.HandlerFunc(adminHandler.UpdateModuleAccess)))
	mux.Handle("GET /v1/admin/dashboard/overview", withActiveAuthTenant(http.HandlerFunc(adminHandler.DashboardOverview)))
	mux.Handle("GET /v1/admin/dashboard/timeseries", withActiveAuthTenant(http.HandlerFunc(adminHandler.DashboardTimeseries)))
	mux.Handle("GET /v1/admin/dashboard/pending", withActiveAuthTenant(http.HandlerFunc(adminHandler.DashboardPending)))
	mux.Handle("GET /v1/admin/dashboard/feed", withActiveAuthTenant(http.HandlerFunc(adminHandler.DashboardFeed)))
	mux.Handle("GET /v1/admin/ai-agents", withActiveAuthTenant(http.HandlerFunc(aiHandler.ListAgents)))
	mux.Handle("POST /v1/admin/ai-agents", withActiveAuthTenant(http.HandlerFunc(aiHandler.CreateAgent)))
	mux.Handle("PATCH /v1/admin/ai-agents/{id}", withActiveAuthTenant(http.HandlerFunc(aiHandler.UpdateAgent)))
	mux.Handle("DELETE /v1/admin/ai-agents/{id}", withActiveAuthTenant(http.HandlerFunc(aiHandler.DeleteAgent)))
	mux.Handle("PUT /v1/admin/organizations/{id}/ai-settings", withActiveAuthTenant(http.HandlerFunc(aiHandler.AdminUpdateSettings)))
	mux.Handle("GET /v1/admin/tables/{table}", withActiveAuthTenant(http.HandlerFunc(adminHandler.ListTableRows)))
	mux.Handle("GET /v1/admin/tables/{table}/count", withActiveAuthTenant(http.HandlerFunc(adminHandler.CountTableRows)))
	mux.Handle("POST /v1/admin/tables/{table}", withActiveAuthTenant(http.HandlerFunc(adminHandler.CreateTableRow)))
	mux.Handle("PATCH /v1/admin/tables/{table}/{id}", withActiveAuthTenant(http.HandlerFunc(adminHandler.UpdateTableRow)))
	mux.Handle("DELETE /v1/admin/tables/{table}/{id}", withActiveAuthTenant(http.HandlerFunc(adminHandler.DeleteTableRow)))
	mux.Handle("GET /v1/admin/system-settings/notification-dispatch", withActiveAuthTenant(http.HandlerFunc(adminHandler.ShowNotificationDispatchSettings)))
	mux.Handle("PUT /v1/admin/system-settings/notification-dispatch", withActiveAuthTenant(http.HandlerFunc(adminHandler.UpdateNotificationDispatchSettings)))
	mux.Handle("GET /v1/admin/notification-deliveries", withActiveAuthTenant(http.HandlerFunc(adminHandler.ShowNotificationDeliveryOperations)))
	mux.Handle("GET /v1/admin/notification-deliveries/whatsapp-reset-preview", withActiveAuthTenant(http.HandlerFunc(adminHandler.PreviewWhatsAppNotificationReset)))
	mux.Handle("POST /v1/admin/notification-deliveries/whatsapp-reset", withActiveAuthTenant(http.HandlerFunc(adminHandler.ResetWhatsAppNotifications)))
	mux.Handle("POST /v1/admin/notification-deliveries/{id}/replay", withActiveAuthTenant(http.HandlerFunc(adminHandler.ReplayNotificationDelivery)))
	mux.Handle("GET /v1/admin/orphan-members", withActiveAuthTenant(http.HandlerFunc(adminHandler.OrphanMemberStats)))
	mux.Handle("POST /v1/admin/orphan-members/cleanup", withActiveAuthTenant(http.HandlerFunc(adminHandler.CleanupOrphanMembers)))
	mux.Handle("GET /v1/dashboard/stats", withActivePermission(permissions.DashboardView, http.HandlerFunc(leadsHandler.ShowDashboardStats)))
	mux.Handle("GET /v1/dashboard/lead-entries", withActivePermission(permissions.DashboardView, http.HandlerFunc(leadsHandler.ListDashboardLeadEntries)))
	mux.Handle("GET /v1/dashboard/funnel", withActivePermission(permissions.DashboardView, http.HandlerFunc(leadsHandler.ShowDashboardFunnel)))
	mux.Handle("GET /v1/dashboard/sources", withActivePermission(permissions.DashboardView, http.HandlerFunc(leadsHandler.ShowDashboardSources)))
	mux.Handle("GET /v1/dashboard/campaigns", withActivePermission(permissions.DashboardView, http.HandlerFunc(leadsHandler.ShowDashboardCampaigns)))
	mux.Handle("GET /v1/dashboard/creatives", withActivePermission(permissions.DashboardView, http.HandlerFunc(leadsHandler.ShowDashboardCreatives)))
	mux.Handle("GET /v1/dashboard/creative-media", withActivePermission(permissions.DashboardView, http.HandlerFunc(leadsHandler.ShowDashboardCreativeMedia)))
	mux.Handle("GET /v1/dashboard/top-brokers", withActivePermission(permissions.DashboardView, http.HandlerFunc(leadsHandler.ShowDashboardTopBrokers)))
	mux.Handle("GET /v1/dashboard/lead-distribution", withActivePermission(permissions.DashboardView, http.HandlerFunc(leadsHandler.ShowDashboardLeadDistribution)))
	mux.Handle("GET /v1/dashboard/first-contact", withActivePermission(permissions.DashboardView, http.HandlerFunc(leadsHandler.ShowDashboardFirstContact)))
	mux.Handle("GET /v1/dashboard/first-contact/leads", withActivePermission(permissions.DashboardView, http.HandlerFunc(leadsHandler.ListDashboardFirstContactLeads)))
	mux.Handle("GET /v1/dashboard/upcoming-tasks", withActivePermission(permissions.DashboardView, http.HandlerFunc(leadsHandler.ListDashboardUpcomingTasks)))
	mux.Handle("GET /v1/dashboard/deals-evolution", withActivePermission(permissions.DashboardView, http.HandlerFunc(leadsHandler.ShowDashboardDealsEvolution)))
	mux.Handle("GET /v1/dashboard/extra-counts", withActivePermission(permissions.DashboardView, http.HandlerFunc(leadsHandler.ShowDashboardExtraCounts)))
	mux.Handle("GET /v1/dashboard/visits", withActivePermission(permissions.DashboardView, http.HandlerFunc(leadsHandler.ShowDashboardVisits)))
	mux.Handle("GET /v1/dashboard/recent-activities", withActivePermission(permissions.DashboardView, http.HandlerFunc(leadsHandler.ListDashboardRecentActivities)))
	mux.Handle("GET /v1/dashboard/team-lead-ids", withActivePermission(permissions.DashboardView, http.HandlerFunc(leadsHandler.ListDashboardTeamLeadIDs)))
	mux.Handle("GET /v1/ai/settings", withPermission(permissions.SettingsAI, http.HandlerFunc(aiHandler.ShowSettings)))
	mux.Handle("PUT /v1/ai/settings", withPermission(permissions.SettingsAI, http.HandlerFunc(aiHandler.UpdateSettings)))
	mux.Handle("GET /v1/ai/agents", withPermission(permissions.SettingsAI, http.HandlerFunc(aiHandler.ListOrganizationAgents)))
	mux.Handle("POST /v1/ai/agents", withPermission(permissions.SettingsAI, http.HandlerFunc(aiHandler.CreateOrganizationAgent)))
	mux.Handle("PATCH /v1/ai/agents/{id}", withPermission(permissions.SettingsAI, http.HandlerFunc(aiHandler.UpdateOrganizationAgent)))
	mux.Handle("DELETE /v1/ai/agents/{id}", withPermission(permissions.SettingsAI, http.HandlerFunc(aiHandler.DeleteOrganizationAgent)))
	mux.Handle("GET /v1/ai/routing-rules", withPermission(permissions.SettingsAI, http.HandlerFunc(aiHandler.ListRoutingRules)))
	mux.Handle("POST /v1/ai/routing-rules", withPermission(permissions.SettingsAI, http.HandlerFunc(aiHandler.CreateRoutingRule)))
	mux.Handle("PATCH /v1/ai/routing-rules/{id}", withPermission(permissions.SettingsAI, http.HandlerFunc(aiHandler.UpdateRoutingRule)))
	mux.Handle("DELETE /v1/ai/routing-rules/{id}", withPermission(permissions.SettingsAI, http.HandlerFunc(aiHandler.DeleteRoutingRule)))
	mux.Handle("GET /v1/ai/metrics", withPermission(permissions.SettingsAI, http.HandlerFunc(aiHandler.Metrics)))
	mux.Handle("GET /v1/ai/events", withPermission(permissions.SettingsAI, http.HandlerFunc(aiHandler.ListEvents)))
	mux.Handle(
		"POST /v1/ai/run",
		withPermission(
			permissions.SettingsAI,
			tenant.RequireAnyPermission(
				[]string{permissions.PropertyView, permissions.PropertyManage},
				http.HandlerFunc(aiHandler.Run),
			),
		),
	)
	mux.Handle("GET /v1/schedule/capabilities", withActiveModulePermission("agenda", permissions.ScheduleView, http.HandlerFunc(scheduleHandler.ShowCapabilities)))
	mux.Handle("GET /v1/schedule/dashboard", withActiveModulePermission("agenda", permissions.ScheduleView, http.HandlerFunc(scheduleHandler.ShowDashboard)))
	mux.Handle("GET /v1/schedule/dashboard/events", withActiveModulePermission("agenda", permissions.ScheduleView, http.HandlerFunc(scheduleHandler.ListDashboardEvents)))
	mux.Handle("GET /v1/schedule/events", withActiveModulePermission("agenda", permissions.ScheduleView, http.HandlerFunc(scheduleHandler.ListEvents)))
	mux.Handle("POST /v1/schedule/events", withActiveModulePermission("agenda", permissions.ScheduleManage, http.HandlerFunc(scheduleHandler.CreateEvent)))
	mux.Handle("PATCH /v1/schedule/events/{id}", withActiveModulePermission("agenda", permissions.ScheduleManage, http.HandlerFunc(scheduleHandler.UpdateEvent)))
	mux.Handle("DELETE /v1/schedule/events/{id}", withActiveModulePermission("agenda", permissions.ScheduleManage, http.HandlerFunc(scheduleHandler.DeleteEvent)))
	mux.Handle("POST /v1/schedule/events/{id}/complete", withActiveModulePermission("agenda", permissions.ScheduleManage, http.HandlerFunc(scheduleHandler.CompleteEvent)))
	mux.Handle("POST /v1/schedule/events/{id}/reschedule", withActiveModulePermission("agenda", permissions.ScheduleManage, http.HandlerFunc(scheduleHandler.RescheduleEvent)))
	mux.Handle("GET /v1/schedule/events/{id}/comments", withActiveModulePermission("agenda", permissions.ScheduleView, http.HandlerFunc(scheduleHandler.ListComments)))
	mux.Handle("POST /v1/schedule/events/{id}/comments", withActiveModulePermission("agenda", permissions.ScheduleManage, http.HandlerFunc(scheduleHandler.AddComment)))
	mux.Handle("GET /v1/schedule/events/{id}/assignees", withActiveModulePermission("agenda", permissions.ScheduleView, http.HandlerFunc(scheduleHandler.ListAssignees)))
	mux.Handle("POST /v1/schedule/events/{id}/assignees", withActiveModulePermission("agenda", permissions.ScheduleManage, http.HandlerFunc(scheduleHandler.AddAssignee)))
	mux.Handle("DELETE /v1/schedule/events/{id}/assignees/{userId}", withActiveModulePermission("agenda", permissions.ScheduleManage, http.HandlerFunc(scheduleHandler.RemoveAssignee)))
	mux.Handle("GET /v1/automations", withModulePermission("automations", permissions.AutomationsView, http.HandlerFunc(automationsHandler.List)))
	mux.Handle("POST /v1/automations", withModulePermission("automations", permissions.AutomationsManage, http.HandlerFunc(automationsHandler.Create)))
	mux.Handle("GET /v1/automations/{id}", withModulePermission("automations", permissions.AutomationsView, http.HandlerFunc(automationsHandler.Show)))
	mux.Handle("PATCH /v1/automations/{id}", withModulePermission("automations", permissions.AutomationsManage, http.HandlerFunc(automationsHandler.Update)))
	mux.Handle("DELETE /v1/automations/{id}", withModulePermission("automations", permissions.AutomationsManage, http.HandlerFunc(automationsHandler.Delete)))
	mux.Handle("POST /v1/automations/{id}/duplicate", withModulePermission("automations", permissions.AutomationsManage, http.HandlerFunc(automationsHandler.Duplicate)))
	mux.Handle("PUT /v1/automations/{id}/flow", withModulePermission("automations", permissions.AutomationsManage, http.HandlerFunc(automationsHandler.SaveFlow)))
	mux.Handle("POST /v1/automations/{id}/start", withModulePermission("automations", permissions.AutomationsManage, http.HandlerFunc(automationsHandler.Start)))
	mux.Handle("GET /v1/automation-templates", withModulePermission("automations", permissions.AutomationsView, http.HandlerFunc(automationsHandler.ListTemplates)))
	mux.Handle("POST /v1/automation-templates", withModulePermission("automations", permissions.AutomationsManage, http.HandlerFunc(automationsHandler.CreateTemplate)))
	mux.Handle("DELETE /v1/automation-templates/{id}", withModulePermission("automations", permissions.AutomationsManage, http.HandlerFunc(automationsHandler.DeleteTemplate)))
	mux.Handle("GET /v1/automation-executions", withModulePermission("automations", permissions.AutomationsView, http.HandlerFunc(automationsHandler.ListExecutions)))
	mux.Handle("GET /v1/automation-executions/summary", withModulePermission("automations", permissions.AutomationsView, http.HandlerFunc(automationsHandler.ListExecutionSummaries)))
	mux.Handle("GET /v1/automation-executions/{id}/steps", withModulePermission("automations", permissions.AutomationsView, http.HandlerFunc(automationsHandler.ListExecutionSteps)))
	mux.Handle("POST /v1/automation-executions/{id}/cancel", withModulePermission("automations", permissions.AutomationsManage, http.HandlerFunc(automationsHandler.CancelExecution)))
	mux.Handle("POST /v1/leads/{id}/automation-executions/cancel", withModulePermission("automations", permissions.AutomationsManage, http.HandlerFunc(automationsHandler.CancelLeadExecutions)))
	mux.Handle("POST /v1/automations/{id}/executions/cancel", withModulePermission("automations", permissions.AutomationsManage, http.HandlerFunc(automationsHandler.CancelAutomationExecutions)))
	mux.Handle("GET /v1/automation-runtime/issues", withModulePermission("automations", permissions.AutomationsView, http.HandlerFunc(automationsHandler.ListRuntimeIssues)))
	mux.Handle("POST /v1/automation-runtime/issues/{kind}/{id}/retry", withModulePermission("automations", permissions.AutomationsManage, http.HandlerFunc(automationsHandler.RetryRuntimeIssue)))
	mux.Handle("GET /v1/automation-media", withModulePermission("automations", permissions.AutomationsView, http.HandlerFunc(automationsHandler.ListMedia)))
	mux.Handle("POST /v1/automation-media", withModulePermission("automations", permissions.AutomationsManage, http.HandlerFunc(automationsHandler.UploadMedia)))
	mux.Handle("DELETE /v1/automation-media", withModulePermission("automations", permissions.AutomationsManage, http.HandlerFunc(automationsHandler.DeleteMedia)))
	mux.HandleFunc("GET /v1/whatsapp/webhook/evolution-go", whatsappHandler.EvolutionGoWebhook)
	mux.HandleFunc("POST /v1/whatsapp/webhook/evolution-go", whatsappHandler.EvolutionGoWebhook)
	mux.Handle("POST /v1/public/webhooks/generic", http.HandlerFunc(webhooksHandler.ReceiveLead))
	mux.Handle("POST /v1/public/api/leads", http.HandlerFunc(publicAPIHandler.CreateLead))
	mux.HandleFunc("GET /v1/public/integrations/meta/webhook", metaHandler.Webhook)
	mux.HandleFunc("POST /v1/public/integrations/meta/webhook", metaHandler.Webhook)
	mux.HandleFunc("GET /v1/public/integrations/meta/oauth/callback", metaOAuthCallbackHandler)
	mux.HandleFunc("GET /v1/public/marketing/oauth/meta/callback", dependencies.marketingHandler.CallbackMeta)
	mux.HandleFunc("GET /v1/public/integrations/portals/grupo-olx/feed/{token}", portalsHandler.GrupoOLXFeed)
	mux.HandleFunc("POST /v1/public/integrations/portals/grupo-olx/leads/{token}", portalsHandler.GrupoOLXLeadWebhook)
	mux.HandleFunc("POST /v1/public/integrations/portals/grupo-olx/import-reports/{token}", portalsHandler.GrupoOLXImportReportWebhook)
	mux.HandleFunc("GET /v1/public/integrations/portals/chaves-na-mao/feed/{token}", portalsHandler.ChavesNaMaoFeed)
	mux.HandleFunc("GET /v1/public/property-publications/{publicationId}/versions/{version}/assets/{assetId}", publicationsHandler.PublicMedia)
	mux.HandleFunc("GET /v1/public/onboarding/plans", adminHandler.PublicSubscriptionPlans)
	mux.HandleFunc("POST /v1/public/onboarding/validate-step", adminHandler.PublicOnboardingValidateStep)
	mux.HandleFunc("POST /v1/public/onboarding/signup", adminHandler.PublicOnboardingSignup)
	mux.HandleFunc("POST /v1/public/onboarding/signup/recovery", adminHandler.PublicRecoverOnboardingSignup)
	mux.HandleFunc("POST /v1/public/onboarding/email-confirmation/resend", adminHandler.PublicResendOnboardingEmailConfirmation)
	mux.HandleFunc("POST /v1/public/onboarding/checkout-plan", adminHandler.PublicCheckoutPlan)
	mux.HandleFunc("GET /v1/public/system-settings", settingsHandler.PublicSystemSettings)
	mux.HandleFunc("GET /v1/public/site/resolve", siteHandler.ResolvePublicSite)
	mux.HandleFunc("GET /v1/public/site/data", siteHandler.PublicSiteData)
	mux.HandleFunc("GET /v1/public/site/menu-items", siteHandler.ListPublicMenuItems)
	mux.HandleFunc("GET /v1/public/site/search-filters", siteHandler.ListPublicSearchFilters)
	mux.HandleFunc("POST /v1/public/site/contact", siteHandler.SubmitPublicContact)
	mux.HandleFunc("POST /v1/public/tracking/events", siteHandler.TrackPublicEvent)
	mux.HandleFunc("GET /v1/public/payments/checkout-info", integrationsHandler.PublicCheckoutInfo)
	mux.HandleFunc("GET /v1/public/payments/status", integrationsHandler.PublicPaymentStatus)
	mux.HandleFunc("POST /v1/public/payments/charge", integrationsHandler.PublicCreateCharge)
	mux.HandleFunc("POST /v1/public/payments/cancel", integrationsHandler.PublicCancelPayment)
	mux.HandleFunc("GET /v1/public/invitations/{token}", adminHandler.ShowInvitationByToken)
	mux.HandleFunc("POST /v1/public/invitations/{token}/accept", adminHandler.AcceptInvitationPublic)
	mux.Handle("GET /v1/webhooks", withModulePermission("webhooks", permissions.SettingsIntegrations, http.HandlerFunc(webhooksHandler.List)))
	mux.Handle("POST /v1/webhooks", withActiveModulePermission("webhooks", permissions.SettingsIntegrations, http.HandlerFunc(webhooksHandler.Create)))
	mux.Handle("PATCH /v1/webhooks/{id}", withActiveModulePermission("webhooks", permissions.SettingsIntegrations, http.HandlerFunc(webhooksHandler.Update)))
	mux.Handle("DELETE /v1/webhooks/{id}", withActiveModulePermission("webhooks", permissions.SettingsIntegrations, http.HandlerFunc(webhooksHandler.Delete)))
	mux.Handle("POST /v1/webhooks/{id}/regenerate-token", withActiveModulePermission("webhooks", permissions.SettingsIntegrations, http.HandlerFunc(webhooksHandler.RegenerateToken)))
	mux.Handle("POST /v1/integrations/google-calendar/functions/{name}", withActiveOrganization(http.HandlerFunc(integrationsHandler.InvokeGoogleCalendarFunction)))
	mux.Handle("POST /v1/integrations/functions/{name}", withActivePermission(permissions.SettingsIntegrations, http.HandlerFunc(integrationsHandler.InvokeFunction)))
	mux.Handle("GET /v1/integrations/vista", withPermission(permissions.SettingsIntegrations, http.HandlerFunc(integrationsHandler.GetVista)))
	mux.Handle("PUT /v1/integrations/vista", withActivePermission(permissions.SettingsIntegrations, http.HandlerFunc(integrationsHandler.SaveVista)))
	mux.Handle("DELETE /v1/integrations/vista", withActivePermission(permissions.SettingsIntegrations, http.HandlerFunc(integrationsHandler.DeleteVista)))
	mux.Handle("GET /v1/integrations/imoview", withPermission(permissions.SettingsIntegrations, http.HandlerFunc(integrationsHandler.GetImoview)))
	mux.Handle("PUT /v1/integrations/imoview", withActivePermission(permissions.SettingsIntegrations, http.HandlerFunc(integrationsHandler.SaveImoview)))
	mux.Handle("DELETE /v1/integrations/imoview", withActivePermission(permissions.SettingsIntegrations, http.HandlerFunc(integrationsHandler.DeleteImoview)))
	mux.Handle("GET /v1/integrations/meta", withPermission(permissions.SettingsIntegrations, http.HandlerFunc(integrationsHandler.ListMetaIntegrations)))
	mux.Handle("PUT /v1/integrations/meta/conversion-feedback", withModulePermission("campaigns", permissions.SettingsIntegrations, http.HandlerFunc(integrationsHandler.SaveMetaConversionFeedback)))
	mux.Handle("POST /v1/integrations/meta/oauth/actions", withActivePermission(permissions.SettingsIntegrations, metaOAuthActionHandler))
	mux.Handle("GET /v1/marketing/connections", withActiveModulePermission("campaigns", permissions.SettingsIntegrations, http.HandlerFunc(dependencies.marketingHandler.List)))
	mux.Handle("POST /v1/marketing/connections/meta/start", withActiveModulePermission("campaigns", permissions.SettingsIntegrations, http.HandlerFunc(dependencies.marketingHandler.StartMeta)))
	mux.Handle("PUT /v1/marketing/connections/{id}/assets", withActiveModulePermission("campaigns", permissions.SettingsIntegrations, http.HandlerFunc(dependencies.marketingHandler.UpdateAssets)))
	mux.Handle("POST /v1/marketing/connections/{id}/sync", withActiveModulePermission("campaigns", permissions.SettingsIntegrations, http.HandlerFunc(dependencies.marketingHandler.Sync)))
	mux.Handle("DELETE /v1/marketing/connections/{id}", withActiveModulePermission("campaigns", permissions.SettingsIntegrations, http.HandlerFunc(dependencies.marketingHandler.Disconnect)))
	mux.Handle("POST /v1/integrations/meta/marketing/sync", withModulePermission("campaigns", permissions.SettingsIntegrations, http.HandlerFunc(metaMarketingSyncHandler.Sync)))
	mux.Handle("GET /v1/integrations/meta/pages/{pageId}/forms", withPermission(permissions.SettingsIntegrations, http.HandlerFunc(integrationsHandler.ListMetaPageForms)))
	mux.Handle("GET /v1/integrations/meta/oauth-flows/{id}", withPermission(permissions.SettingsIntegrations, http.HandlerFunc(integrationsHandler.ShowMetaOAuthFlow)))
	mux.Handle("GET /v1/integrations/meta/form-configs", withPermission(permissions.SettingsIntegrations, http.HandlerFunc(integrationsHandler.ListMetaFormConfigs)))
	mux.Handle("POST /v1/integrations/meta/form-configs", withPermission(permissions.SettingsIntegrations, http.HandlerFunc(integrationsHandler.SaveMetaFormConfig)))
	mux.Handle("PATCH /v1/integrations/meta/form-configs", withPermission(permissions.SettingsIntegrations, http.HandlerFunc(integrationsHandler.ToggleMetaFormConfig)))
	mux.Handle("DELETE /v1/integrations/meta/form-configs", withPermission(permissions.SettingsIntegrations, http.HandlerFunc(integrationsHandler.DeleteMetaFormConfig)))
	mux.Handle("GET /v1/integrations/meta/webhook-health", withPermission(permissions.SettingsIntegrations, http.HandlerFunc(integrationsHandler.MetaWebhookHealth)))
	mux.Handle("GET /v1/integrations/meta/conversations", withModulesPermission([]string{"whatsapp", "campaigns"}, permissions.WhatsAppView, http.HandlerFunc(integrationsHandler.ListMetaConversations)))
	mux.Handle("GET /v1/integrations/meta/conversations/{id}/messages", withModulesPermission([]string{"whatsapp", "campaigns"}, permissions.WhatsAppView, http.HandlerFunc(integrationsHandler.ListMetaMessages)))
	mux.Handle("POST /v1/integrations/meta/conversations/{id}/messages", withModulesPermission([]string{"whatsapp", "campaigns"}, permissions.WhatsAppOperate, http.HandlerFunc(integrationsHandler.SendMetaMessage)))
	mux.Handle("GET /v1/integrations/portals/grupo-olx", withModulePermission("portals", permissions.SettingsIntegrations, http.HandlerFunc(portalsHandler.GetGrupoOLX)))
	mux.Handle("PUT /v1/integrations/portals/grupo-olx", withModulePermission("portals", permissions.SettingsIntegrations, http.HandlerFunc(portalsHandler.SaveGrupoOLX)))
	mux.Handle("POST /v1/integrations/portals/grupo-olx/activate", withModulePermission("portals", permissions.SettingsIntegrations, http.HandlerFunc(portalsHandler.ActivateGrupoOLX)))
	mux.Handle("POST /v1/integrations/portals/grupo-olx/pause", withModulePermission("portals", permissions.SettingsIntegrations, http.HandlerFunc(portalsHandler.PauseGrupoOLX)))
	mux.Handle("POST /v1/integrations/portals/grupo-olx/regenerate-feed-token", withActiveModulePermission("portals", permissions.SettingsIntegrations, http.HandlerFunc(portalsHandler.RegenerateGrupoOLXFeedToken)))
	mux.Handle("POST /v1/integrations/portals/grupo-olx/regenerate-webhook-token", withActiveModulePermission("portals", permissions.SettingsIntegrations, http.HandlerFunc(portalsHandler.RegenerateGrupoOLXWebhookToken)))
	mux.Handle("GET /v1/integrations/portals/grupo-olx/publications", withModulePermission("portals", permissions.SettingsIntegrations, tenant.RequireAnyPermission([]string{permissions.PropertyView, permissions.PropertyManage}, http.HandlerFunc(portalsHandler.ListGrupoOLXPublications))))
	mux.Handle("PUT /v1/integrations/portals/grupo-olx/publications", withModulePermission("portals", permissions.SettingsIntegrations, tenant.RequirePermission(permissions.PropertyManage, http.HandlerFunc(portalsHandler.UpsertGrupoOLXPublications))))
	mux.Handle("GET /v1/integrations/portals/grupo-olx/import-reports", withModulePermission("portals", permissions.SettingsIntegrations, http.HandlerFunc(portalsHandler.ListGrupoOLXImportReports)))
	mux.Handle("POST /v1/integrations/portals/grupo-olx/import-reports/{id}/replay", withModulePermission("portals", permissions.SettingsIntegrations, http.HandlerFunc(portalsHandler.ReplayGrupoOLXImportReport)))
	mux.Handle("GET /v1/integrations/portals/chaves-na-mao", withModulePermission("portals", permissions.SettingsIntegrations, http.HandlerFunc(portalsHandler.GetChavesNaMao)))
	mux.Handle("PUT /v1/integrations/portals/chaves-na-mao", withModulePermission("portals", permissions.SettingsIntegrations, http.HandlerFunc(portalsHandler.SaveChavesNaMao)))
	mux.Handle("POST /v1/integrations/portals/chaves-na-mao/activate", withModulePermission("portals", permissions.SettingsIntegrations, http.HandlerFunc(portalsHandler.ActivateChavesNaMao)))
	mux.Handle("POST /v1/integrations/portals/chaves-na-mao/pause", withModulePermission("portals", permissions.SettingsIntegrations, http.HandlerFunc(portalsHandler.PauseChavesNaMao)))
	mux.Handle("POST /v1/integrations/portals/chaves-na-mao/regenerate-feed-token", withActiveModulePermission("portals", permissions.SettingsIntegrations, http.HandlerFunc(portalsHandler.RegenerateChavesNaMaoFeedToken)))
	mux.Handle("GET /v1/integrations/portals/chaves-na-mao/publications", withModulePermission("portals", permissions.SettingsIntegrations, tenant.RequireAnyPermission([]string{permissions.PropertyView, permissions.PropertyManage}, http.HandlerFunc(portalsHandler.ListChavesNaMaoPublications))))
	mux.Handle("PUT /v1/integrations/portals/chaves-na-mao/publications", withModulePermission("portals", permissions.SettingsIntegrations, tenant.RequirePermission(permissions.PropertyManage, http.HandlerFunc(portalsHandler.UpsertChavesNaMaoPublications))))
	mux.Handle("GET /v1/public/push-config", http.HandlerFunc(settingsHandler.PublicPushConfig))
	mux.Handle("PATCH /v1/settings/profile", withActiveAuthTenant(http.HandlerFunc(settingsHandler.UpdateProfile)))
	mux.Handle("POST /v1/settings/profile/avatar", withActiveAuthTenant(http.HandlerFunc(settingsHandler.UploadProfileAvatar)))
	mux.Handle("PATCH /v1/settings/organization", withPermission(permissions.SettingsOrganization, http.HandlerFunc(settingsHandler.UpdateOrganization)))
	mux.Handle("PATCH /v1/settings/properties", withPermission(permissions.SettingsOrganization, http.HandlerFunc(settingsHandler.UpdatePropertySettings)))
	mux.Handle("POST /v1/settings/organization/logo", withPermission(permissions.SettingsOrganization, http.HandlerFunc(settingsHandler.UploadOrganizationLogo)))
	mux.Handle("POST /v1/settings/password", httpserver.RequirePasswordChangeAuth(authVerifier, httpserver.RequireActiveSession(activeSessionChecker, http.HandlerFunc(settingsHandler.ChangePassword))))
	mux.Handle("GET /v1/settings/password/status", withActiveAuthTenant(http.HandlerFunc(settingsHandler.PasswordStatus)))
	mux.Handle("GET /v1/settings/modules", withOrganization(http.HandlerFunc(settingsHandler.ListOrganizationModules)))
	mux.Handle("GET /v1/settings/setup-guide-progress", withAuthTenant(http.HandlerFunc(settingsHandler.ShowSetupGuideProgress)))
	mux.Handle("PUT /v1/settings/setup-guide-progress", withAuthTenant(http.HandlerFunc(settingsHandler.UpdateSetupGuideProgress)))
	mux.Handle("POST /v1/settings/push-tokens", withActiveOrganization(http.HandlerFunc(settingsHandler.SavePushToken)))
	mux.Handle("GET /v1/settings/push-tokens", withActiveOrganization(http.HandlerFunc(settingsHandler.ListPushDevices)))
	mux.Handle("POST /v1/settings/push-tokens/deactivate", withActiveAuthTenant(http.HandlerFunc(settingsHandler.DeactivatePushToken)))
	mux.Handle("GET /v1/settings/api-keys", withModulePermission("api", permissions.SettingsIntegrations, http.HandlerFunc(settingsHandler.ListAPIKeys)))
	mux.Handle("POST /v1/settings/api-keys", withActiveModulePermission("api", permissions.SettingsIntegrations, http.HandlerFunc(settingsHandler.CreateAPIKey)))
	mux.Handle("DELETE /v1/settings/api-keys/{id}", withActiveModulePermission("api", permissions.SettingsIntegrations, http.HandlerFunc(settingsHandler.DeleteAPIKey)))
	mux.Handle("GET /v1/settings/subscription", withPermission(permissions.SettingsBilling, http.HandlerFunc(settingsHandler.ShowSubscription)))
	mux.Handle("POST /v1/settings/subscription/payments/{id}/refresh", withActivePermission(permissions.SettingsBilling, http.HandlerFunc(settingsHandler.RefreshSubscriptionPayment)))
	mux.Handle("PATCH /v1/settings/subscription/billing", withActivePermission(permissions.SettingsBilling, http.HandlerFunc(settingsHandler.UpdateSubscriptionBilling)))
	mux.Handle("PATCH /v1/settings/subscription/plan", withActivePermission(permissions.SettingsBilling, http.HandlerFunc(settingsHandler.SelectSubscriptionPlan)))
	mux.Handle("POST /v1/settings/subscription/charge", withActivePermission(permissions.SettingsBilling, http.HandlerFunc(integrationsHandler.CreateSubscriptionCharge)))
	mux.Handle("GET /v1/settings/roles", withActivePermission(permissions.PermissionsManage, http.HandlerFunc(settingsHandler.ListOrganizationRoles)))
	mux.Handle("POST /v1/settings/roles", withActivePermission(permissions.PermissionsManage, http.HandlerFunc(settingsHandler.CreateRole)))
	mux.Handle("PATCH /v1/settings/roles/{id}", withActivePermission(permissions.PermissionsManage, http.HandlerFunc(settingsHandler.UpdateRole)))
	mux.Handle("DELETE /v1/settings/roles/{id}", withActivePermission(permissions.PermissionsManage, http.HandlerFunc(settingsHandler.DeleteRole)))
	mux.Handle("GET /v1/settings/roles/{id}/permissions", withActivePermission(permissions.PermissionsManage, http.HandlerFunc(settingsHandler.ListRolePermissions)))
	mux.Handle("PUT /v1/settings/roles/{id}/permissions", withActivePermission(permissions.PermissionsManage, http.HandlerFunc(settingsHandler.ReplaceRolePermissions)))
	mux.Handle("GET /v1/settings/permissions", withAuthTenant(http.HandlerFunc(settingsHandler.ListAvailablePermissions)))
	mux.Handle("GET /v1/settings/users/{id}/permissions", withActivePermission(permissions.PermissionsManage, http.HandlerFunc(settingsHandler.ShowUserPermissions)))
	mux.Handle("PUT /v1/settings/users/{id}/permissions", withActivePermission(permissions.PermissionsManage, http.HandlerFunc(settingsHandler.ReplaceUserPermissions)))
	mux.Handle("DELETE /v1/settings/users/{id}/permissions", withActivePermission(permissions.PermissionsManage, http.HandlerFunc(settingsHandler.ResetUserPermissions)))
	mux.Handle("GET /v1/settings/user-roles", withActivePermission(permissions.PermissionsManage, http.HandlerFunc(settingsHandler.ListUserOrganizationRoles)))
	mux.Handle("PUT /v1/settings/user-roles", withActivePermission(permissions.PermissionsManage, http.HandlerFunc(settingsHandler.AssignUserRole)))
	mux.Handle("GET /v1/settings/has-permission", withActiveAuthTenant(http.HandlerFunc(settingsHandler.HasPermission)))
	mux.Handle("GET /v1/site", withModulePermission("site", permissions.SettingsSite, http.HandlerFunc(siteHandler.ShowSite)))
	mux.Handle("POST /v1/site", withModulePermission("site", permissions.SettingsSite, http.HandlerFunc(siteHandler.CreateSite)))
	mux.Handle("PATCH /v1/site", withModulePermission("site", permissions.SettingsSite, http.HandlerFunc(siteHandler.UpdateSite)))
	mux.Handle("POST /v1/site/domain/verify", withModulePermission("site", permissions.SettingsSite, http.HandlerFunc(siteHandler.VerifyDomain)))
	mux.Handle("POST /v1/site/assets", withModulePermission("site", permissions.SettingsSite, http.HandlerFunc(siteHandler.UploadAsset)))
	mux.Handle("GET /v1/site/menu-items", withModulePermission("site", permissions.SettingsSite, http.HandlerFunc(siteHandler.ListMenuItems)))
	mux.Handle("POST /v1/site/menu-items", withModulePermission("site", permissions.SettingsSite, http.HandlerFunc(siteHandler.CreateMenuItem)))
	mux.Handle("PATCH /v1/site/menu-items/{id}", withModulePermission("site", permissions.SettingsSite, http.HandlerFunc(siteHandler.UpdateMenuItem)))
	mux.Handle("DELETE /v1/site/menu-items/{id}", withModulePermission("site", permissions.SettingsSite, http.HandlerFunc(siteHandler.DeleteMenuItem)))
	mux.Handle("POST /v1/site/menu-items/reorder", withModulePermission("site", permissions.SettingsSite, http.HandlerFunc(siteHandler.ReorderMenuItems)))
	mux.Handle("GET /v1/site/search-filters", withModulePermission("site", permissions.SettingsSite, http.HandlerFunc(siteHandler.ListSearchFilters)))
	mux.Handle("POST /v1/site/search-filters", withModulePermission("site", permissions.SettingsSite, http.HandlerFunc(siteHandler.CreateSearchFilter)))
	mux.Handle("PATCH /v1/site/search-filters/{id}", withModulePermission("site", permissions.SettingsSite, http.HandlerFunc(siteHandler.UpdateSearchFilter)))
	mux.Handle("DELETE /v1/site/search-filters/{id}", withModulePermission("site", permissions.SettingsSite, http.HandlerFunc(siteHandler.DeleteSearchFilter)))
	mux.Handle("POST /v1/site/search-filters/reorder", withModulePermission("site", permissions.SettingsSite, http.HandlerFunc(siteHandler.ReorderSearchFilters)))
	mux.Handle("GET /v1/whatsapp/quick-replies", withActiveModulePermission("whatsapp", permissions.WhatsAppView, http.HandlerFunc(whatsappHandler.ListQuickReplies)))
	mux.Handle("POST /v1/whatsapp/quick-replies", withActiveModulePermission("whatsapp", permissions.WhatsAppOperate, http.HandlerFunc(whatsappHandler.CreateQuickReply)))
	mux.Handle("PATCH /v1/whatsapp/quick-replies/{id}", withActiveModulePermission("whatsapp", permissions.WhatsAppOperate, http.HandlerFunc(whatsappHandler.UpdateQuickReply)))
	mux.Handle("DELETE /v1/whatsapp/quick-replies/{id}", withActiveModulePermission("whatsapp", permissions.WhatsAppOperate, http.HandlerFunc(whatsappHandler.DeleteQuickReply)))
	mux.Handle("GET /v1/whatsapp/message-templates", withActiveModulePermission("whatsapp", permissions.WhatsAppView, http.HandlerFunc(whatsappHandler.ListMessageTemplates)))
	mux.Handle("POST /v1/whatsapp/message-templates", withActiveModulePermission("whatsapp", permissions.WhatsAppOperate, http.HandlerFunc(whatsappHandler.CreateMessageTemplate)))
	mux.Handle("PATCH /v1/whatsapp/message-templates/{id}", withActiveModulePermission("whatsapp", permissions.WhatsAppOperate, http.HandlerFunc(whatsappHandler.UpdateMessageTemplate)))
	mux.Handle("DELETE /v1/whatsapp/message-templates/{id}", withActiveModulePermission("whatsapp", permissions.WhatsAppOperate, http.HandlerFunc(whatsappHandler.DeleteMessageTemplate)))
	mux.Handle("GET /v1/whatsapp/sessions", withActiveModulePermission("whatsapp", permissions.WhatsAppView, http.HandlerFunc(whatsappHandler.ListSessions)))
	mux.Handle("GET /v1/whatsapp/session-statuses", withActiveModulePermission("whatsapp", permissions.WhatsAppView, http.HandlerFunc(whatsappHandler.ListSessionStatuses)))
	mux.Handle("POST /v1/whatsapp/sessions", withActiveModulePermission("whatsapp", permissions.WhatsAppManage, http.HandlerFunc(whatsappHandler.CreateSession)))
	mux.Handle("GET /v1/whatsapp/sessions/{id}", withActiveModulePermission("whatsapp", permissions.WhatsAppView, http.HandlerFunc(whatsappHandler.ShowSession)))
	mux.Handle("DELETE /v1/whatsapp/sessions/{id}", withActiveModulePermission("whatsapp", permissions.WhatsAppManage, http.HandlerFunc(whatsappHandler.DeleteSession)))
	mux.Handle("POST /v1/whatsapp/sessions/{id}/qr", withActiveModulePermission("whatsapp", permissions.WhatsAppManage, http.HandlerFunc(whatsappHandler.GetQRCode)))
	mux.Handle("POST /v1/whatsapp/sessions/{id}/status", withActiveModulePermission("whatsapp", permissions.WhatsAppManage, http.HandlerFunc(whatsappHandler.GetConnectionStatus)))
	mux.Handle("POST /v1/whatsapp/sessions/{id}/recreate", withActiveModulePermission("whatsapp", permissions.WhatsAppManage, http.HandlerFunc(whatsappHandler.RecreateSession)))
	mux.Handle("POST /v1/whatsapp/sessions/{id}/logout", withActiveModulePermission("whatsapp", permissions.WhatsAppManage, http.HandlerFunc(whatsappHandler.LogoutSession)))
	mux.Handle("POST /v1/whatsapp/sessions/{id}/notification-session", withActiveModulePermission("whatsapp", permissions.WhatsAppManage, http.HandlerFunc(whatsappHandler.ToggleNotificationSession)))
	mux.Handle("POST /v1/whatsapp/sessions/{id}/ai-auto-reply", withActiveModulePermission("whatsapp", permissions.WhatsAppManage, http.HandlerFunc(whatsappHandler.ToggleAutoReplySession)))
	mux.Handle("GET /v1/whatsapp/sessions/{id}/access", withActiveModulePermission("whatsapp", permissions.WhatsAppManage, http.HandlerFunc(whatsappHandler.ListSessionAccess)))
	mux.Handle("POST /v1/whatsapp/sessions/{id}/access", withActiveModulePermission("whatsapp", permissions.WhatsAppManage, http.HandlerFunc(whatsappHandler.GrantSessionAccess)))
	mux.Handle("DELETE /v1/whatsapp/sessions/{id}/access/{userId}", withActiveModulePermission("whatsapp", permissions.WhatsAppManage, http.HandlerFunc(whatsappHandler.RevokeSessionAccess)))
	mux.Handle("GET /v1/whatsapp/sessions/{id}/labels", withActiveModulePermission("whatsapp", permissions.WhatsAppView, http.HandlerFunc(whatsappHandler.ListLabels)))
	mux.Handle("POST /v1/whatsapp/sessions/{id}/labels/sync", withActiveModulePermission("whatsapp", permissions.WhatsAppOperate, http.HandlerFunc(whatsappHandler.SyncLabels)))
	mux.Handle("POST /v1/whatsapp/sessions/{id}/labels/assign", withActiveModulePermission("whatsapp", permissions.WhatsAppOperate, http.HandlerFunc(whatsappHandler.AssignLabel)))
	mux.Handle("GET /v1/whatsapp/sessions/{id}/groups", withActiveModulePermission("whatsapp", permissions.WhatsAppView, http.HandlerFunc(whatsappHandler.ListGroups)))
	mux.Handle("POST /v1/whatsapp/sessions/{id}/groups/sync", withActiveModulePermission("whatsapp", permissions.WhatsAppOperate, http.HandlerFunc(whatsappHandler.SyncGroups)))
	mux.Handle("POST /v1/whatsapp/sessions/{id}/groups/info", withActiveModulePermission("whatsapp", permissions.WhatsAppOperate, http.HandlerFunc(whatsappHandler.GroupInfo)))
	mux.Handle("POST /v1/whatsapp/sessions/{id}/groups/invite-link", withActiveModulePermission("whatsapp", permissions.WhatsAppOperate, http.HandlerFunc(whatsappHandler.GroupInviteLink)))
	mux.Handle("POST /v1/whatsapp/sessions/{id}/groups/update", withActiveModulePermission("whatsapp", permissions.WhatsAppOperate, http.HandlerFunc(whatsappHandler.UpdateGroup)))
	mux.Handle("POST /v1/whatsapp/sessions/{id}/contacts/check", withActiveModulePermission("whatsapp", permissions.WhatsAppOperate, http.HandlerFunc(whatsappHandler.CheckNumbers)))
	mux.Handle("POST /v1/whatsapp/sessions/{id}/contacts/avatar", withActiveModulePermission("whatsapp", permissions.WhatsAppOperate, http.HandlerFunc(whatsappHandler.FetchAvatar)))
	mux.Handle("POST /v1/whatsapp/sessions/{id}/contacts/sync", withActiveModulePermission("whatsapp", permissions.WhatsAppOperate, http.HandlerFunc(whatsappHandler.SyncContactsAvatars)))
	mux.Handle("POST /v1/whatsapp/sessions/{id}/history-sync", withActiveModulePermission("whatsapp", permissions.WhatsAppOperate, http.HandlerFunc(whatsappHandler.HistorySync)))
	mux.Handle("POST /v1/whatsapp/provider-action", withActiveModulePermission("whatsapp", permissions.WhatsAppManage, http.HandlerFunc(whatsappHandler.ProviderAction)))
	mux.Handle("GET /v1/whatsapp/conversations", withActiveModulePermission("whatsapp", permissions.WhatsAppView, http.HandlerFunc(whatsappHandler.ListConversations)))
	mux.Handle("GET /v1/whatsapp/conversations/filter-options", withActiveModulePermission("whatsapp", permissions.WhatsAppView, http.HandlerFunc(whatsappHandler.ListConversationFilterOptions)))
	mux.Handle("GET /v1/whatsapp/conversations/unread-count", withActiveModulePermission("whatsapp", permissions.WhatsAppView, http.HandlerFunc(whatsappHandler.CountUnreadConversations)))
	mux.Handle("POST /v1/whatsapp/conversations/start", withActiveModulePermission("whatsapp", permissions.WhatsAppOperate, http.HandlerFunc(whatsappHandler.StartConversation)))
	mux.Handle("GET /v1/whatsapp/conversations/find", withActiveModulePermission("whatsapp", permissions.WhatsAppView, http.HandlerFunc(whatsappHandler.FindConversation)))
	mux.Handle("GET /v1/whatsapp/history", withActiveModulePermission("whatsapp", permissions.WhatsAppView, http.HandlerFunc(whatsappHandler.HistoryAccess)))
	mux.Handle("GET /v1/whatsapp/conversations/{id}/snapshot", withActiveModulePermission("whatsapp", permissions.WhatsAppView, http.HandlerFunc(whatsappHandler.ShowConversationSnapshot)))
	mux.Handle("GET /v1/whatsapp/conversations/{id}", withActiveModulePermission("whatsapp", permissions.WhatsAppView, http.HandlerFunc(whatsappHandler.ShowConversation)))
	mux.Handle("GET /v1/whatsapp/conversations/{id}/messages", withActiveModulePermission("whatsapp", permissions.WhatsAppView, http.HandlerFunc(whatsappHandler.ListMessages)))
	mux.Handle("GET /v1/whatsapp/conversations/{id}/send-status", withActiveModulePermission("whatsapp", permissions.WhatsAppView, http.HandlerFunc(whatsappHandler.GetSendStatus)))
	mux.Handle("GET /v1/whatsapp/conversations/{id}/attendance", withActiveModulePermission("whatsapp", permissions.WhatsAppView, http.HandlerFunc(whatsappHandler.GetConversationAttendance)))
	mux.Handle("POST /v1/whatsapp/conversations/{id}/attendance", withActiveModulePermission("whatsapp", permissions.WhatsAppOperate, http.HandlerFunc(whatsappHandler.JoinConversationAttendance)))
	mux.Handle("GET /v1/whatsapp/messages/{id}/media-url", withActiveModulePermission("whatsapp", permissions.WhatsAppView, http.HandlerFunc(whatsappHandler.GetMessageMediaURL)))
	mux.Handle("POST /v1/whatsapp/conversations/{id}/send-message", withActiveModulePermission("whatsapp", permissions.WhatsAppOperate, http.HandlerFunc(whatsappHandler.SendMessage)))
	mux.Handle("POST /v1/whatsapp/conversations/{id}/messages/{messageId}/reaction", withActiveModulePermission("whatsapp", permissions.WhatsAppOperate, http.HandlerFunc(whatsappHandler.ReactToMessage)))
	mux.Handle("POST /v1/whatsapp/conversations/{id}/mark-read", withActiveModulePermission("whatsapp", permissions.WhatsAppOperate, http.HandlerFunc(whatsappHandler.MarkConversationAsRead)))
	mux.Handle("POST /v1/whatsapp/conversations/{id}/mark-seen", withActiveModulePermission("whatsapp", permissions.WhatsAppOperate, http.HandlerFunc(whatsappHandler.MarkAsSeenOnWhatsApp)))
	mux.Handle("POST /v1/whatsapp/conversations/{id}/archive", withActiveModulePermission("whatsapp", permissions.WhatsAppOperate, http.HandlerFunc(whatsappHandler.ArchiveConversation)))
	mux.Handle("DELETE /v1/whatsapp/conversations/{id}", withActiveModulePermission("whatsapp", permissions.WhatsAppOperate, http.HandlerFunc(whatsappHandler.DeleteConversation)))
	mux.Handle("GET /v1/whatsapp/conversations/{id}/link-preview", withActiveModulePermission("whatsapp", permissions.WhatsAppOperate, tenant.RequirePermission(permissions.LeadOperate, http.HandlerFunc(whatsappHandler.GetConversationLeadLinkPreview))))
	mux.Handle("POST /v1/whatsapp/conversations/{id}/link-lead", withActiveModulePermission("whatsapp", permissions.WhatsAppOperate, tenant.RequirePermission(permissions.LeadOperate, http.HandlerFunc(whatsappHandler.LinkConversationToLead))))
	mux.Handle("GET /v1/whatsapp/conversations/{id}/labels", withActiveModulePermission("whatsapp", permissions.WhatsAppView, http.HandlerFunc(whatsappHandler.ListChatLabels)))
	mux.Handle("POST /v1/whatsapp/messages/{id}/retry-media", withActiveModulePermission("whatsapp", permissions.WhatsAppOperate, http.HandlerFunc(whatsappHandler.RetryMediaDownload)))
	mux.Handle("GET /v1/lead-enrichments", withActiveOrganization(http.HandlerFunc(leadsHandler.ListEnrichments)))
	mux.Handle("GET /v1/pipeline-board", withActiveOrganization(http.HandlerFunc(leadsHandler.ShowPipelineBoard)))
	mux.Handle("GET /v1/pipeline-stage-leads", withActiveOrganization(http.HandlerFunc(leadsHandler.ListPipelineStageLeads)))
	mux.Handle("GET /v1/pipeline-stage-counts", withActiveOrganization(http.HandlerFunc(leadsHandler.ListPipelineStageCounts)))
	mux.Handle("GET /v1/lead-meta-filters", withActiveOrganization(http.HandlerFunc(leadsHandler.ListLeadMetaFilters)))
	mux.Handle("GET /v1/lead-visibility", withActiveOrganization(http.HandlerFunc(leadsHandler.ShowLeadVisibility)))
	mux.Handle("GET /v1/contacts", withActiveOrganization(http.HandlerFunc(leadsHandler.ListContacts)))
	mux.Handle("GET /v1/tags", withActiveOrganization(http.HandlerFunc(leadsHandler.ListTags)))
	mux.Handle("GET /v1/tags/{id}/usage", withPermission(permissions.TagManage, http.HandlerFunc(leadsHandler.TagUsage)))
	mux.Handle("POST /v1/tags", withActivePermission(permissions.TagManage, http.HandlerFunc(leadsHandler.CreateTag)))
	mux.Handle("PATCH /v1/tags/{id}", withActivePermission(permissions.TagManage, http.HandlerFunc(leadsHandler.UpdateTag)))
	mux.Handle("DELETE /v1/tags/{id}", withActivePermission(permissions.TagManage, http.HandlerFunc(leadsHandler.DeleteTag)))
	mux.Handle("GET /v1/lead-sources", withActiveOrganization(http.HandlerFunc(leadsHandler.ListLeadSources)))
	mux.Handle("POST /v1/lead-sources", withActivePermission(permissions.LeadOperate, http.HandlerFunc(leadsHandler.CreateLeadSource)))
	mux.Handle("GET /v1/activities", withActiveOrganization(http.HandlerFunc(leadsHandler.ListActivities)))
	mux.Handle("POST /v1/activities", withActivePermission(permissions.LeadOperate, http.HandlerFunc(leadsHandler.CreateActivity)))
	mux.Handle("GET /v1/lead-meta", withActiveOrganization(http.HandlerFunc(leadsHandler.ShowLeadMeta)))
	mux.Handle("GET /v1/lead-attachments", withActiveOrganization(http.HandlerFunc(leadsHandler.ListLeadAttachments)))
	mux.Handle("POST /v1/lead-attachments", withActivePermission(permissions.LeadOperate, http.HandlerFunc(leadsHandler.CreateLeadAttachment)))
	mux.Handle("GET /v1/lead-analytics/first-response-metrics", withActiveOrganization(http.HandlerFunc(leadsHandler.ShowFirstResponseMetrics)))
	mux.Handle("GET /v1/lead-analytics/first-response-ranking", withActiveOrganization(http.HandlerFunc(leadsHandler.ListFirstResponseRanking)))
	mux.Handle("GET /v1/lead-tasks", withActiveOrganization(http.HandlerFunc(leadsHandler.ListLeadTasks)))
	mux.Handle("POST /v1/lead-tasks", withActivePermission(permissions.LeadOperate, http.HandlerFunc(leadsHandler.CreateLeadTask)))
	mux.Handle("PATCH /v1/lead-tasks/{id}", withActivePermission(permissions.LeadOperate, http.HandlerFunc(leadsHandler.PatchLeadTask)))
	mux.Handle("POST /v1/lead-tasks/complete-cadence", withActivePermission(permissions.LeadOperate, http.HandlerFunc(leadsHandler.CompleteCadenceTask)))
	mux.Handle("GET /v1/notifications", withOrganization(http.HandlerFunc(leadsHandler.ListNotifications)))
	mux.Handle("POST /v1/notifications", withOrganization(http.HandlerFunc(leadsHandler.CreateNotification)))
	mux.Handle("POST /v1/notifications/dispatch", withOrganization(http.HandlerFunc(leadsHandler.DispatchNotification)))
	mux.Handle("GET /v1/notifications/unread-count", withOrganization(http.HandlerFunc(leadsHandler.CountUnreadNotifications)))
	mux.Handle("POST /v1/notifications/{id}/read", withOrganization(http.HandlerFunc(leadsHandler.MarkNotificationRead)))
	mux.Handle("POST /v1/notifications/read-all", withOrganization(http.HandlerFunc(leadsHandler.MarkAllNotificationsRead)))
	mux.Handle("GET /v1/leads", withActiveOrganization(http.HandlerFunc(leadsHandler.List)))
	// Lead creation is authorized after the request is validated: regular rows
	// require lead_create, while importMode rows require lead_import. Keeping the
	// generic organization middleware here lets the repository enforce that
	// distinction without granting either capability to the other.
	mux.Handle("POST /v1/leads", withActiveOrganization(http.HandlerFunc(leadsHandler.Create)))
	mux.Handle("GET /v1/leads/capabilities/move-stage", withActivePermission(permissions.LeadOperate, http.HandlerFunc(leadsHandler.ShowMoveStageCapabilities)))
	mux.Handle("GET /v1/leads/{id}/timeline", withActiveOrganization(http.HandlerFunc(leadsHandler.ListLeadTimeline)))
	mux.Handle("GET /v1/leads/{id}/journey", withActiveOrganization(http.HandlerFunc(leadsHandler.ListLeadJourney)))
	mux.Handle("GET /v1/leads/{id}/history-raw", withActiveOrganization(http.HandlerFunc(leadsHandler.ShowLeadHistoryRaw)))
	mux.Handle("GET /v1/leads/{id}/conversation-detail", withActiveOrganization(http.HandlerFunc(leadsHandler.ShowConversationDetail)))
	mux.Handle("GET /v1/leads/{id}/sensitive-profile", withActivePermission(permissions.LeadOperate, http.HandlerFunc(leadsHandler.ShowSensitiveProfile)))
	mux.Handle("GET /v1/leads/{id}", withActiveOrganization(http.HandlerFunc(leadsHandler.Show)))
	mux.Handle("PATCH /v1/leads/{id}", withActivePermission(permissions.LeadOperate, http.HandlerFunc(leadsHandler.Update)))
	mux.Handle("POST /v1/leads/{id}/feedback", withActivePermission(permissions.LeadOperate, http.HandlerFunc(leadsHandler.RecordFeedback)))
	mux.Handle("POST /v1/leads/{id}/contact-outcomes", withActivePermission(permissions.LeadOperate, http.HandlerFunc(leadsHandler.RecordContactOutcome)))
	mux.Handle("DELETE /v1/leads/{id}", withActivePermission(permissions.LeadDelete, http.HandlerFunc(leadsHandler.Delete)))
	mux.Handle("POST /v1/leads/{id}/attachments", withActivePermission(permissions.LeadOperate, http.HandlerFunc(leadsHandler.UploadLeadAttachment)))
	mux.Handle("GET /v1/leads/{id}/attachments/{attachmentId}/access", withActiveOrganization(http.HandlerFunc(leadsHandler.ShowLeadAttachmentAccess)))
	mux.Handle("POST /v1/leads/{id}/attachment-uploads", withActivePermission(permissions.LeadOperate, http.HandlerFunc(leadsHandler.UploadLeadAttachment)))
	mux.Handle("POST /v1/leads/{id}/first-response", withActivePermission(permissions.LeadOperate, http.HandlerFunc(leadsHandler.RecordFirstResponse)))
	mux.Handle("POST /v1/leads/{id}/move-stage", withActivePermission(permissions.LeadOperate, http.HandlerFunc(leadsHandler.MoveStage)))
	mux.Handle("POST /v1/leads/{id}/assign", withActivePermission(permissions.LeadOperate, http.HandlerFunc(leadsHandler.Assign)))
	mux.Handle("POST /v1/leads/{id}/claim-queue-pool", withActivePermission(permissions.LeadOperate, http.HandlerFunc(leadsHandler.ClaimQueuePool)))
	mux.Handle("POST /v1/leads/{id}/redistribute", withActivePermission(permissions.LeadOperate, http.HandlerFunc(leadsHandler.RedistributeRoundRobin)))
	mux.Handle("POST /v1/leads/{id}/tags", withActivePermission(permissions.LeadOperate, http.HandlerFunc(leadsHandler.AddTag)))
	mux.Handle("DELETE /v1/leads/{id}/tags/{tagId}", withActivePermission(permissions.LeadOperate, http.HandlerFunc(leadsHandler.RemoveTag)))
	mux.Handle("GET /v1/property-developments", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(developmentsHandler.List)))
	mux.Handle("POST /v1/property-developments", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(developmentsHandler.Create)))
	mux.Handle("PATCH /v1/property-developments/{id}", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(developmentsHandler.UpdateDevelopment)))
	mux.Handle("PATCH /v1/property-developments/{id}/phases/{entityId}", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(developmentsHandler.UpdatePhase)))
	mux.Handle("PATCH /v1/property-developments/{id}/buildings/{entityId}", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(developmentsHandler.UpdateBuilding)))
	mux.Handle("PATCH /v1/property-developments/{id}/floor-plans/{entityId}", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(developmentsHandler.UpdateFloorPlan)))
	mux.Handle("GET /v1/property-developments/{id}/workspace", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(developmentsHandler.ShowWorkspace)))
	mux.Handle("GET /v1/property-developments/{id}/units", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(developmentsHandler.ListUnits)))
	mux.Handle("GET /v1/property-developments/{id}/reservations", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(developmentsHandler.ListReservations)))
	mux.Handle("POST /v1/property-developments/{id}/phases", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(developmentsHandler.CreatePhase)))
	mux.Handle("POST /v1/property-developments/{id}/buildings", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(developmentsHandler.CreateBuilding)))
	mux.Handle("POST /v1/property-developments/{id}/floor-plans", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(developmentsHandler.CreateFloorPlan)))
	mux.Handle("POST /v1/property-developments/{id}/units/bulk", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(developmentsHandler.BulkCreateUnits)))
	mux.Handle("PATCH /v1/property-developments/{id}/units/{unitId}", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(developmentsHandler.UpdateUnit)))
	mux.Handle("POST /v1/property-developments/{id}/units/{unitId}/link-property", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(developmentsHandler.LinkUnitProperty)))
	mux.Handle("POST /v1/property-developments/{id}/units/{unitId}/promote-property", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(developmentsHandler.PromoteUnitProperty)))
	mux.Handle("POST /v1/property-developments/{id}/units/{unitId}/unlink-property", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(developmentsHandler.UnlinkUnitProperty)))
	mux.Handle("PUT /v1/property-developments/{id}/units/{unitId}/price", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(developmentsHandler.UpdateUnitPrice)))
	mux.Handle("POST /v1/property-developments/{id}/units/{unitId}/reservations", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(developmentsHandler.CreateReservation)))
	mux.Handle("POST /v1/property-developments/{id}/reservations/{reservationId}/cancel", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(developmentsHandler.CancelReservation)))
	mux.Handle("POST /v1/property-developments/{id}/reservations/{reservationId}/convert", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(developmentsHandler.ConvertReservation)))
	mux.Handle("POST /v1/property-developments/{id}/reservations/{reservationId}/extend", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(developmentsHandler.ExtendReservation)))
	mux.Handle("POST /v1/property-developments/{id}/price-tables/{priceTableId}/activate", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(developmentsHandler.ActivatePriceTable)))
	mux.Handle("GET /v1/properties", withModulePermission("properties", permissions.PropertyView, http.HandlerFunc(propertiesHandler.List)))
	mux.Handle("GET /v1/properties/stats", withModulePermission("properties", permissions.PropertyView, http.HandlerFunc(propertiesHandler.Stats)))
	mux.Handle("GET /v1/properties/settings/portfolio", withModuleAnyPermission("properties", []string{permissions.PropertyView, permissions.PropertyManage}, http.HandlerFunc(propertiesHandler.ShowPortfolioSettings)))
	mux.Handle("PUT /v1/properties/settings/portfolio", withPermission(permissions.SettingsOrganization, http.HandlerFunc(propertiesHandler.UpdatePortfolioSettings)))
	mux.Handle("POST /v1/properties", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(propertiesHandler.Create)))
	mux.Handle("GET /v1/properties/{id}", withModuleAnyPermission("properties", []string{permissions.PropertyView, permissions.PropertyManage}, http.HandlerFunc(propertiesHandler.Show)))
	mux.Handle("GET /v1/properties/{id}/workspace", withModulePermission("properties", permissions.PropertyView, http.HandlerFunc(propertiesHandler.ShowWorkspace)))
	mux.Handle("GET /v1/properties/{id}/history", withModulePermission("properties", permissions.PropertyView, http.HandlerFunc(propertiesHandler.History)))
	mux.Handle("GET /v1/properties/{id}/publications", withModulePermission("properties", permissions.PropertyView, http.HandlerFunc(publicationsHandler.Overview)))
	mux.Handle("POST /v1/properties/{id}/publications/site/publish", withModulesPermission([]string{"properties", "site"}, permissions.PropertyManage, http.HandlerFunc(publicationsHandler.Publish)))
	mux.Handle("POST /v1/properties/{id}/publications/site/unpublish", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(publicationsHandler.Unpublish)))
	mux.Handle("POST /v1/properties/{id}/publications/site/retry", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(publicationsHandler.Retry)))
	mux.Handle("POST /v1/properties/{id}/publications/grupo-olx/publish", withModulesPermission([]string{"properties", "portals"}, permissions.PropertyManage, http.HandlerFunc(publicationsHandler.PublishGrupoOLX)))
	mux.Handle("POST /v1/properties/{id}/publications/grupo-olx/unpublish", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(publicationsHandler.UnpublishGrupoOLX)))
	mux.Handle("POST /v1/properties/{id}/publications/grupo-olx/retry", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(publicationsHandler.RetryGrupoOLX)))
	mux.Handle("PUT /v1/properties/{id}/offers/{offerType}", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(propertiesHandler.UpsertOffer)))
	mux.Handle("POST /v1/properties/{id}/ownerships", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(propertiesHandler.CreateOwnership)))
	mux.Handle("PATCH /v1/properties/{id}/ownerships/{ownershipId}", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(propertiesHandler.UpdateOwnership)))
	mux.Handle("POST /v1/properties/{id}/ownerships/{ownershipId}/end", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(propertiesHandler.EndOwnership)))
	mux.Handle("POST /v1/properties/{id}/assets", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(propertiesHandler.CreateAsset)))
	mux.Handle("POST /v1/properties/{id}/assets/upload-intents", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(propertiesHandler.CreateAssetUploadIntent)))
	mux.Handle("DELETE /v1/properties/{id}/assets/upload-intents", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(propertiesHandler.DiscardAssetUpload)))
	mux.Handle("PUT /v1/properties/{id}/assets/order", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(propertiesHandler.ReorderAssets)))
	mux.Handle("PATCH /v1/properties/{id}/assets/{assetId}", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(propertiesHandler.UpdateAsset)))
	mux.Handle("DELETE /v1/properties/{id}/assets/{assetId}", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(propertiesHandler.DeleteAsset)))
	mux.Handle("PUT /v1/properties/{id}/assets/{assetId}/primary", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(propertiesHandler.SetPrimaryAsset)))
	mux.Handle("GET /v1/properties/{id}/keys/movements", withModulePermission("properties", permissions.PropertyView, http.HandlerFunc(propertiesHandler.ListKeyMovements)))
	mux.Handle("POST /v1/properties/{id}/keys", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(propertiesHandler.CreateKey)))
	mux.Handle("POST /v1/properties/{id}/keys/{keyId}/movements", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(propertiesHandler.MoveKey)))
	mux.Handle("PATCH /v1/properties/{id}", withModuleAnyPermission("properties", []string{permissions.PropertyView, permissions.PropertyManage}, http.HandlerFunc(propertiesHandler.Update)))
	mux.Handle("DELETE /v1/properties/{id}", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(propertiesHandler.Delete)))
	mux.Handle("POST /v1/property-images", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(propertiesHandler.UploadImage)))
	mux.Handle("GET /v1/property-captors/{id}", withModulePermission("properties", permissions.PropertyView, http.HandlerFunc(propertiesHandler.ShowPropertyCaptor)))
	mux.Handle("GET /v1/property-site-info", withModulePermission("properties", permissions.PropertyView, http.HandlerFunc(propertiesHandler.ShowPropertySiteInfo)))
	mux.Handle("GET /v1/property-summaries", withModulePermission("properties", permissions.PropertyView, http.HandlerFunc(propertiesHandler.ListPropertySummaries)))
	mux.Handle("GET /v1/user-organizations", withActiveAuth(http.HandlerFunc(usersHandler.ListUserOrganizations)))
	mux.Handle("GET /v1/users", withActiveOrganization(http.HandlerFunc(usersHandler.ListOrganizationUsers)))
	mux.Handle("POST /v1/users", withActivePermission(permissions.UsersManage, http.HandlerFunc(usersHandler.CreateOrganizationUser)))
	mux.Handle("PATCH /v1/users/{id}", withActivePermission(permissions.UsersManage, http.HandlerFunc(usersHandler.UpdateOrganizationUser)))
	mux.Handle("GET /v1/users/{id}/delete-impact", withActivePermission(permissions.UsersManage, http.HandlerFunc(usersHandler.GetDeleteUserImpact)))
	mux.Handle("DELETE /v1/users/{id}", withActivePermission(permissions.UsersManage, http.HandlerFunc(usersHandler.DeleteOrganizationUser)))
	mux.Handle("GET /v1/user-presence", withPermission(permissions.UsersPresenceView, http.HandlerFunc(presenceHandler.List)))
	mux.Handle("GET /v1/user-summaries", withActiveOrganization(http.HandlerFunc(usersHandler.ListSummaries)))
	mux.Handle("GET /v1/teams", withActivePermission(permissions.TeamView, http.HandlerFunc(teamsHandler.List)))
	mux.Handle("GET /v1/teams/{id}", withPermission(permissions.TeamView, http.HandlerFunc(teamsHandler.Get)))
	mux.Handle("GET /v1/teams/{id}/history", withActivePermission(permissions.TeamView, http.HandlerFunc(teamsHandler.ListHistory)))
	mux.Handle("GET /v1/teams/{teamId}/distribution-stats", withPermission(permissions.TeamView, http.HandlerFunc(roundRobinHandler.GetTeamDistributionStats)))
	mux.Handle("POST /v1/teams", withPermission(permissions.TeamManage, http.HandlerFunc(teamsHandler.Create)))
	mux.Handle("PATCH /v1/teams/{id}", withPermission(permissions.TeamManage, http.HandlerFunc(teamsHandler.Update)))
	mux.Handle("DELETE /v1/teams/{id}", withPermission(permissions.TeamManage, http.HandlerFunc(teamsHandler.Delete)))
	mux.Handle("PATCH /v1/teams/{id}/status", withPermission(permissions.TeamManage, http.HandlerFunc(teamsHandler.UpdateStatus)))
	mux.Handle("POST /v1/teams/logo", withPermission(permissions.TeamManage, http.HandlerFunc(teamsHandler.UploadLogo)))
	mux.Handle("GET /v1/team-pipelines", withPermission(permissions.TeamView, http.HandlerFunc(teamsHandler.ListTeamPipelines)))
	mux.Handle("POST /v1/team-pipelines", withPermission(permissions.PipelineManage, http.HandlerFunc(teamsHandler.AssignPipelineToTeam)))
	mux.Handle("DELETE /v1/team-pipelines", withPermission(permissions.PipelineManage, http.HandlerFunc(teamsHandler.RemovePipelineFromTeam)))
	mux.Handle("PATCH /v1/team-members/leader", withPermission(permissions.TeamManage, http.HandlerFunc(teamsHandler.SetTeamLeader)))
	mux.Handle("GET /v1/member-availability", withPermission(permissions.TeamView, http.HandlerFunc(teamsHandler.ListMemberAvailability)))
	mux.Handle("PATCH /v1/member-availability", withPermission(permissions.TeamManage, http.HandlerFunc(teamsHandler.UpsertAvailability)))
	mux.Handle("GET /v1/team-members/{id}/availability", withPermission(permissions.TeamView, http.HandlerFunc(teamsHandler.ListTeamMemberAvailability)))
	mux.Handle("PUT /v1/team-members/{id}/availability", withPermission(permissions.TeamManage, http.HandlerFunc(teamsHandler.ReplaceAvailability)))
	mux.Handle("GET /v1/property-types", withModulePermission("properties", permissions.PropertyView, http.HandlerFunc(propertiesHandler.ListPropertyTypes)))
	mux.Handle("POST /v1/property-types", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(propertiesHandler.CreatePropertyType)))
	mux.Handle("GET /v1/property-features", withModulePermission("properties", permissions.PropertyView, http.HandlerFunc(propertiesHandler.ListPropertyFeatures)))
	mux.Handle("POST /v1/property-features", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(propertiesHandler.CreatePropertyFeature)))
	mux.Handle("POST /v1/property-features/seed-defaults", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(propertiesHandler.SeedPropertyFeatures)))
	mux.Handle("GET /v1/property-proximities", withModulePermission("properties", permissions.PropertyView, http.HandlerFunc(propertiesHandler.ListPropertyProximities)))
	mux.Handle("POST /v1/property-proximities", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(propertiesHandler.CreatePropertyProximity)))
	mux.Handle("POST /v1/property-proximities/seed-defaults", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(propertiesHandler.SeedPropertyProximities)))
	mux.Handle("GET /v1/property-cities", withModulePermission("properties", permissions.PropertyView, http.HandlerFunc(propertiesHandler.ListCities)))
	mux.Handle("POST /v1/property-cities", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(propertiesHandler.CreateCity)))
	mux.Handle("PATCH /v1/property-cities/{id}", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(propertiesHandler.UpdateCity)))
	mux.Handle("DELETE /v1/property-cities/{id}", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(propertiesHandler.DeleteCity)))
	mux.Handle("GET /v1/property-neighborhoods", withModulePermission("properties", permissions.PropertyView, http.HandlerFunc(propertiesHandler.ListNeighborhoods)))
	mux.Handle("POST /v1/property-neighborhoods", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(propertiesHandler.CreateNeighborhood)))
	mux.Handle("PATCH /v1/property-neighborhoods/{id}", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(propertiesHandler.UpdateNeighborhood)))
	mux.Handle("DELETE /v1/property-neighborhoods/{id}", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(propertiesHandler.DeleteNeighborhood)))
	mux.Handle("GET /v1/property-condominiums", withModulePermission("properties", permissions.PropertyView, http.HandlerFunc(propertiesHandler.ListCondominiums)))
	mux.Handle("POST /v1/property-condominiums", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(propertiesHandler.CreateCondominium)))
	mux.Handle("PATCH /v1/property-condominiums/{id}", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(propertiesHandler.UpdateCondominium)))
	mux.Handle("DELETE /v1/property-condominiums/{id}", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(propertiesHandler.DeleteCondominium)))
	mux.Handle("GET /v1/property-owners", withModulePermission("properties", permissions.PropertyView, http.HandlerFunc(propertiesHandler.ListOwners)))
	mux.Handle("POST /v1/property-owners", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(propertiesHandler.CreateOwner)))
	mux.Handle("PATCH /v1/property-owners/{id}", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(propertiesHandler.UpdateOwner)))
	mux.Handle("DELETE /v1/property-owners/{id}", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(propertiesHandler.DeleteOwner)))
	mux.Handle("GET /v1/pipelines", withActiveOrganization(http.HandlerFunc(pipelinesHandler.List)))
	mux.Handle("POST /v1/pipelines", withActivePermission(permissions.PipelineManage, http.HandlerFunc(pipelinesHandler.Create)))
	mux.Handle("PATCH /v1/pipelines/{id}", withActivePermission(permissions.PipelineManage, http.HandlerFunc(pipelinesHandler.Update)))
	mux.Handle("DELETE /v1/pipelines/{id}", withActivePermission(permissions.PipelineManage, http.HandlerFunc(pipelinesHandler.Delete)))
	mux.Handle("GET /v1/stages", withActiveOrganization(http.HandlerFunc(pipelinesHandler.ListStages)))
	mux.Handle("POST /v1/pipelines/{id}/stages", withActivePermission(permissions.PipelineManage, http.HandlerFunc(pipelinesHandler.CreateStage)))
	mux.Handle("POST /v1/pipelines/{id}/stages/reorder", withActivePermission(permissions.PipelineManage, http.HandlerFunc(pipelinesHandler.ReorderStages)))
	mux.Handle("POST /v1/pipelines/{id}/round-robin", withActivePermission(permissions.PipelineManage, http.HandlerFunc(pipelinesHandler.SetDefaultRoundRobin)))
	mux.Handle("PATCH /v1/stages/{id}", withActivePermission(permissions.PipelineManage, http.HandlerFunc(pipelinesHandler.UpdateStage)))
	mux.Handle("DELETE /v1/stages/{id}", withActivePermission(permissions.PipelineManage, http.HandlerFunc(pipelinesHandler.DeleteStage)))
	mux.Handle("GET /v1/round-robin-whatsapp-sessions", withActivePermission(permissions.DistributionManage, http.HandlerFunc(roundRobinHandler.ListWhatsAppSessionOptions)))
	mux.Handle("GET /v1/round-robin-meta-forms", withActivePermission(permissions.DistributionManage, http.HandlerFunc(roundRobinHandler.ListMetaFormOptions)))
	mux.Handle("GET /v1/round-robins", withActivePermission(permissions.DistributionManage, http.HandlerFunc(roundRobinHandler.List)))
	mux.Handle("POST /v1/round-robins", withActivePermission(permissions.DistributionManage, http.HandlerFunc(roundRobinHandler.Create)))
	mux.Handle("GET /v1/round-robins/{id}", withActivePermission(permissions.DistributionManage, http.HandlerFunc(roundRobinHandler.Get)))
	mux.Handle("PATCH /v1/round-robins/{id}", withActivePermission(permissions.DistributionManage, http.HandlerFunc(roundRobinHandler.Update)))
	mux.Handle("DELETE /v1/round-robins/{id}", withActivePermission(permissions.DistributionManage, http.HandlerFunc(roundRobinHandler.Delete)))
	mux.Handle("GET /v1/round-robins/{id}/history", withActivePermission(permissions.DistributionManage, http.HandlerFunc(roundRobinHandler.ListHistory)))
	mux.Handle("GET /v1/round-robins/{id}/rules", withActivePermission(permissions.DistributionManage, http.HandlerFunc(roundRobinHandler.ListRules)))
	mux.Handle("POST /v1/round-robins/{id}/rules", withActivePermission(permissions.DistributionManage, http.HandlerFunc(roundRobinHandler.CreateRule)))
	mux.Handle("GET /v1/round-robin-rules", withActivePermission(permissions.DistributionManage, http.HandlerFunc(roundRobinHandler.ListRules)))
	mux.Handle("POST /v1/round-robin-rules", withActivePermission(permissions.DistributionManage, http.HandlerFunc(roundRobinHandler.CreateRule)))
	mux.Handle("PATCH /v1/round-robin-rules/{id}", withActivePermission(permissions.DistributionManage, http.HandlerFunc(roundRobinHandler.UpdateRule)))
	mux.Handle("DELETE /v1/round-robin-rules/{id}", withActivePermission(permissions.DistributionManage, http.HandlerFunc(roundRobinHandler.DeleteRule)))
	mux.Handle("POST /v1/round-robins/{id}/members", withActivePermission(permissions.DistributionManage, http.HandlerFunc(roundRobinHandler.AddMember)))
	mux.Handle("PATCH /v1/round-robin-members/{id}", withActivePermission(permissions.DistributionManage, http.HandlerFunc(roundRobinHandler.UpdateMember)))
	mux.Handle("DELETE /v1/round-robin-members/{id}", withActivePermission(permissions.DistributionManage, http.HandlerFunc(roundRobinHandler.DeleteMember)))

}
