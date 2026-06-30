package app

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/admin"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/ai"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/analytics"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/audit"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/automations"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/cadences"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/config"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/financial"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/gamification"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/health"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/integrations"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/leads"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/me"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/pipelines"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/properties"
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
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type App struct {
	handler http.Handler
	db      *dbpkg.Postgres
	auth    *authpkg.Verifier
}

func New(ctx context.Context, cfg config.Config, logger *slog.Logger) (*App, error) {
	authVerifier, err := authpkg.NewVerifier(ctx, cfg.Auth)
	if err != nil {
		return nil, err
	}

	postgres, err := dbpkg.NewPostgres(ctx, cfg.Database)
	if err != nil {
		return nil, err
	}

	mux := http.NewServeMux()
	realtimeHub := realtime.NewHub()

	healthHandler := health.NewHandler(postgres)
	realtimeHandler := realtime.NewHandler(realtimeHub)
	analyticsHandler := analytics.NewHandler(analytics.NewRepository(postgres))
	gamificationHandler := gamification.NewHandler(gamification.NewRepository(postgres))
	cadencesHandler := cadences.NewHandler(cadences.NewRepository(postgres))
	financialHandler := financial.NewHandler(financial.NewRepository(postgres, financial.StorageConfig{
		ProjectURL: cfg.Storage.ProjectURL,
		APIKey:     cfg.Storage.APIKey,
	}))
	adminHandler := admin.NewHandler(admin.NewRepository(postgres, admin.ExternalConfig{
		ProjectURL:   cfg.Storage.ProjectURL,
		APIKey:       cfg.Storage.APIKey,
		ResendAPIKey: cfg.Email.ResendAPIKey,
		FromEmail:    cfg.Email.FromEmail,
		ReplyTo:      cfg.Email.ReplyTo,
		SupportEmail: cfg.Email.SupportEmail,
		AppURL:       cfg.Email.AppURL,
	}))
	aiRepository := ai.NewRepository(postgres)
	aiService := ai.NewService(aiRepository, ai.Config{
		OpenAIAPIKey:  cfg.AI.OpenAIAPIKey,
		OpenAIBaseURL: cfg.AI.OpenAIBaseURL,
		DefaultModel:  cfg.AI.DefaultModel,
		RealtimeModel: cfg.AI.RealtimeModel,
		RealtimeVoice: cfg.AI.RealtimeVoice,
	})
	aiHandler := ai.NewHandler(aiRepository, aiService)
	meHandler := me.NewHandler(me.NewRepository(postgres))
	tenantRepository := tenant.NewRepository(postgres)
	auditHandler := audit.NewHandler(audit.NewRepository(postgres))
	leadsHandler := leads.NewHandler(leads.NewRepository(postgres, leads.StorageConfig{
		ProjectURL: cfg.Storage.ProjectURL,
		APIKey:     cfg.Storage.APIKey,
	}), realtimeHub)
	pipelinesHandler := pipelines.NewHandler(pipelines.NewRepository(postgres))
	propertiesHandler := properties.NewHandler(properties.NewRepository(postgres, properties.StorageConfig{
		ProjectURL: cfg.Storage.ProjectURL,
		APIKey:     cfg.Storage.APIKey,
	}))
	roundRobinHandler := roundrobin.NewHandler(roundrobin.NewRepository(postgres))
	scheduleHandler := schedule.NewHandler(schedule.NewRepository(postgres), realtimeHub)
	stageConfigHandler := stageconfig.NewHandler(stageconfig.NewRepository(postgres))
	settingsHandler := settings.NewHandler(settings.NewRepository(postgres, settings.ExternalConfig{
		ProjectURL:   cfg.Storage.ProjectURL,
		APIKey:       cfg.Storage.APIKey,
		ResendAPIKey: cfg.Email.ResendAPIKey,
		FromEmail:    cfg.Email.FromEmail,
		ReplyTo:      cfg.Email.ReplyTo,
		SupportEmail: cfg.Email.SupportEmail,
		AppURL:       cfg.Email.AppURL,
	}))
	siteHandler := site.NewHandler(site.NewRepository(postgres, site.StorageConfig{
		ProjectURL: cfg.Storage.ProjectURL,
		APIKey:     cfg.Storage.APIKey,
	}), realtimeHub)
	teamsHandler := teams.NewHandler(teams.NewRepository(postgres, teams.StorageConfig{
		ProjectURL: cfg.Storage.ProjectURL,
		APIKey:     cfg.Storage.APIKey,
	}))
	telemetryHandler := telemetry.NewHandler(telemetry.NewRepository(postgres))
	usersHandler := users.NewHandler(users.NewRepository(postgres, users.AuthAdminConfig{
		ProjectURL: cfg.Storage.ProjectURL,
		APIKey:     cfg.Storage.APIKey,
	}))
	automationsHandler := automations.NewHandler(automations.NewRepository(postgres, automations.FunctionsConfig{
		ProjectURL: cfg.Storage.ProjectURL,
		APIKey:     cfg.Storage.APIKey,
	}, automations.StorageConfig{
		ProjectURL: cfg.Storage.ProjectURL,
		APIKey:     cfg.Storage.APIKey,
	}))
	whatsappHandler := whatsapp.NewHandler(whatsapp.NewRepository(postgres, whatsapp.StorageConfig{
		ProjectURL: cfg.Storage.ProjectURL,
		APIKey:     cfg.Storage.APIKey,
	}), realtimeHub).WithAutoReply(aiService, cfg.AI.AutoReplyToken)
	webhooksHandler := webhooks.NewHandler(webhooks.NewRepository(postgres), realtimeHub)
	integrationsHandler := integrations.NewHandler(integrations.NewRepository(postgres, integrations.ExternalConfig{
		ProjectURL: cfg.Storage.ProjectURL,
		APIKey:     cfg.Storage.APIKey,
	}))

	withAuthTenant := func(handler http.Handler) http.Handler {
		return httpserver.RequireAuth(
			authVerifier,
			tenant.Attach(tenantRepository, handler),
		)
	}

	withOrganization := func(handler http.Handler) http.Handler {
		return withAuthTenant(tenant.RequireOrganization(handler))
	}

	mux.HandleFunc("GET /healthz", healthHandler.Health)
	mux.HandleFunc("GET /readyz", healthHandler.Ready)
	mux.HandleFunc("POST /v1/internal/whatsapp/auto-reply", whatsappHandler.AutoReply)
	mux.Handle("GET /v1/me", withAuthTenant(http.HandlerFunc(meHandler.Show)))
	mux.Handle("GET /v1/me/profile", withAuthTenant(http.HandlerFunc(meHandler.ShowProfile)))
	mux.Handle("POST /v1/me/switch-organization", withAuthTenant(http.HandlerFunc(meHandler.SwitchOrganization)))
	mux.Handle("GET /v1/realtime/events", withOrganization(http.HandlerFunc(realtimeHandler.Events)))
	mux.Handle("POST /v1/telemetry/errors", withAuthTenant(http.HandlerFunc(telemetryHandler.CreateErrorEvent)))
	mux.Handle("GET /v1/audit-logs", withAuthTenant(http.HandlerFunc(auditHandler.List)))
	mux.Handle("POST /v1/audit-logs", withAuthTenant(http.HandlerFunc(auditHandler.Create)))
	mux.Handle("GET /v1/analytics/meta-insights", withOrganization(http.HandlerFunc(analyticsHandler.MetaInsights)))
	mux.Handle("GET /v1/analytics/campaign-insights", withOrganization(http.HandlerFunc(analyticsHandler.CampaignInsights)))
	mux.Handle("GET /v1/analytics/lead", withOrganization(http.HandlerFunc(analyticsHandler.LeadAnalytics)))
	mux.Handle("GET /v1/analytics/site-summary", withOrganization(http.HandlerFunc(analyticsHandler.SiteSummary)))
	mux.Handle("GET /v1/analytics/site-detailed", withOrganization(http.HandlerFunc(analyticsHandler.SiteDetailed)))
	mux.Handle("GET /v1/analytics/enterprise-kpis", withOrganization(http.HandlerFunc(analyticsHandler.EnterpriseKPIs)))
	mux.Handle("GET /v1/analytics/dre-executive", withOrganization(http.HandlerFunc(analyticsHandler.DREExecutive)))
	mux.Handle("GET /v1/analytics/sla-summary", withOrganization(http.HandlerFunc(analyticsHandler.SlaSummary)))
	mux.Handle("GET /v1/analytics/sla-performance-by-user", withOrganization(http.HandlerFunc(analyticsHandler.SlaPerformanceByUser)))
	mux.Handle("GET /v1/analytics/team-ranking", withOrganization(http.HandlerFunc(analyticsHandler.TeamRanking)))
	mux.Handle("GET /v1/analytics/vgv-stats", withOrganization(http.HandlerFunc(analyticsHandler.VGVStats)))
	mux.Handle("GET /v1/analytics/vgv-by-broker", withOrganization(http.HandlerFunc(analyticsHandler.VGVByBroker)))
	mux.Handle("GET /v1/analytics/stage-vgv", withOrganization(http.HandlerFunc(analyticsHandler.StageVGV)))
	mux.Handle("GET /v1/analytics/leader-stats", withOrganization(http.HandlerFunc(analyticsHandler.LeaderStats)))
	mux.Handle("GET /v1/analytics/team-leader-stats/{teamId}", withOrganization(http.HandlerFunc(analyticsHandler.TeamLeaderStats)))
	mux.Handle("GET /v1/admin/error-events", withAuthTenant(http.HandlerFunc(telemetryHandler.ListErrorEvents)))
	mux.Handle("POST /v1/admin/error-events/{id}/resolve", withAuthTenant(http.HandlerFunc(telemetryHandler.ResolveErrorEvent)))
	mux.Handle("GET /v1/gamification/overview", withOrganization(http.HandlerFunc(gamificationHandler.Overview)))
	mux.Handle("GET /v1/cadence-templates", withOrganization(http.HandlerFunc(cadencesHandler.ListTemplates)))
	mux.Handle("POST /v1/cadence-tasks", withOrganization(http.HandlerFunc(cadencesHandler.CreateTask)))
	mux.Handle("PATCH /v1/cadence-tasks/{id}", withOrganization(http.HandlerFunc(cadencesHandler.UpdateTask)))
	mux.Handle("DELETE /v1/cadence-tasks/{id}", withOrganization(http.HandlerFunc(cadencesHandler.DeleteTask)))
	mux.Handle("GET /v1/financial/categories", withOrganization(http.HandlerFunc(financialHandler.ListCategories)))
	mux.Handle("POST /v1/financial/categories", withOrganization(http.HandlerFunc(financialHandler.CreateCategory)))
	mux.Handle("GET /v1/financial/entries", withOrganization(http.HandlerFunc(financialHandler.ListEntries)))
	mux.Handle("POST /v1/financial/entries", withOrganization(http.HandlerFunc(financialHandler.CreateEntry)))
	mux.Handle("PATCH /v1/financial/entries/{id}", withOrganization(http.HandlerFunc(financialHandler.UpdateEntry)))
	mux.Handle("DELETE /v1/financial/entries/{id}", withOrganization(http.HandlerFunc(financialHandler.DeleteEntry)))
	mux.Handle("POST /v1/financial/entries/{id}/pay", withOrganization(http.HandlerFunc(financialHandler.MarkEntryPaid)))
	mux.Handle("GET /v1/financial/dashboard", withOrganization(http.HandlerFunc(financialHandler.Dashboard)))
	mux.Handle("GET /v1/contracts", withOrganization(http.HandlerFunc(financialHandler.ListContracts)))
	mux.Handle("POST /v1/contracts", withOrganization(http.HandlerFunc(financialHandler.CreateContract)))
	mux.Handle("GET /v1/contracts/{id}", withOrganization(http.HandlerFunc(financialHandler.ShowContract)))
	mux.Handle("PATCH /v1/contracts/{id}", withOrganization(http.HandlerFunc(financialHandler.UpdateContract)))
	mux.Handle("DELETE /v1/contracts/{id}", withOrganization(http.HandlerFunc(financialHandler.DeleteContract)))
	mux.Handle("POST /v1/contracts/{id}/activate", withOrganization(http.HandlerFunc(financialHandler.ActivateContract)))
	mux.Handle("POST /v1/contracts/{id}/regenerate-commissions", withOrganization(http.HandlerFunc(financialHandler.RegenerateCommissions)))
	mux.Handle("GET /v1/contracts/{id}/documents", withOrganization(http.HandlerFunc(financialHandler.ListContractDocuments)))
	mux.Handle("POST /v1/contracts/{id}/documents", withOrganization(http.HandlerFunc(financialHandler.UploadContractDocument)))
	mux.Handle("DELETE /v1/contracts/{id}/documents", withOrganization(http.HandlerFunc(financialHandler.DeleteContractDocument)))
	mux.Handle("POST /v1/contracts/{id}/documents/signed-url", withOrganization(http.HandlerFunc(financialHandler.ContractDocumentSignedURL)))
	mux.Handle("GET /v1/commission-rules", withOrganization(http.HandlerFunc(financialHandler.ListCommissionRules)))
	mux.Handle("POST /v1/commission-rules", withOrganization(http.HandlerFunc(financialHandler.CreateCommissionRule)))
	mux.Handle("PATCH /v1/commission-rules/{id}", withOrganization(http.HandlerFunc(financialHandler.UpdateCommissionRule)))
	mux.Handle("DELETE /v1/commission-rules/{id}", withOrganization(http.HandlerFunc(financialHandler.DeleteCommissionRule)))
	mux.Handle("GET /v1/commissions", withOrganization(http.HandlerFunc(financialHandler.ListCommissions)))
	mux.Handle("POST /v1/commissions/{id}/{action}", withOrganization(http.HandlerFunc(financialHandler.CommissionStatus)))
	mux.Handle("GET /v1/commissions/by-broker", withOrganization(http.HandlerFunc(financialHandler.CommissionsByBroker)))
	mux.Handle("GET /v1/dre/input", withOrganization(http.HandlerFunc(financialHandler.DREInput)))
	mux.Handle("GET /v1/dre/groups", withOrganization(http.HandlerFunc(financialHandler.DREGroups)))
	mux.Handle("GET /v1/dre/mappings", withOrganization(http.HandlerFunc(financialHandler.DREMappings)))
	mux.Handle("POST /v1/dre/mappings", withOrganization(http.HandlerFunc(financialHandler.CreateDREMapping)))
	mux.Handle("DELETE /v1/dre/mappings/{id}", withOrganization(http.HandlerFunc(financialHandler.DeleteDREMapping)))
	mux.Handle("POST /v1/dre/groups/initialize", withOrganization(http.HandlerFunc(financialHandler.InitializeDREGroups)))
	mux.Handle("GET /v1/stage-automations", withOrganization(http.HandlerFunc(stageConfigHandler.ListAutomations)))
	mux.Handle("POST /v1/stage-automations", withOrganization(http.HandlerFunc(stageConfigHandler.CreateAutomation)))
	mux.Handle("PATCH /v1/stage-automations/{id}", withOrganization(http.HandlerFunc(stageConfigHandler.UpdateAutomation)))
	mux.Handle("DELETE /v1/stage-automations/{id}", withOrganization(http.HandlerFunc(stageConfigHandler.DeleteAutomation)))
	mux.Handle("PATCH /v1/stage-automations/{id}/status", withOrganization(http.HandlerFunc(stageConfigHandler.ToggleAutomation)))
	mux.Handle("GET /v1/stage-operational-configs", withOrganization(http.HandlerFunc(stageConfigHandler.ListOperationalConfigs)))
	mux.Handle("PUT /v1/stage-operational-configs", withOrganization(http.HandlerFunc(stageConfigHandler.UpsertOperationalConfig)))
	mux.Handle("GET /v1/pipeline-sla-settings", withOrganization(http.HandlerFunc(stageConfigHandler.ListPipelineSLASettings)))
	mux.Handle("PUT /v1/pipeline-sla-settings", withOrganization(http.HandlerFunc(stageConfigHandler.UpsertPipelineSLASettings)))
	mux.Handle("GET /v1/admin/organizations", withAuthTenant(http.HandlerFunc(adminHandler.ListOrganizations)))
	mux.Handle("POST /v1/admin/organizations", withAuthTenant(http.HandlerFunc(adminHandler.CreateOrganization)))
	mux.Handle("PATCH /v1/admin/organizations/{id}", withAuthTenant(http.HandlerFunc(adminHandler.UpdateOrganization)))
	mux.Handle("DELETE /v1/admin/organizations/{id}", withAuthTenant(http.HandlerFunc(adminHandler.DeleteOrganization)))
	mux.Handle("GET /v1/admin/organizations/{id}/modules", withAuthTenant(http.HandlerFunc(adminHandler.ListOrganizationModules)))
	mux.Handle("POST /v1/admin/organizations/{id}/access", withAuthTenant(http.HandlerFunc(adminHandler.UpdateOrganizationAccess)))
	mux.Handle("GET /v1/admin/users", withAuthTenant(http.HandlerFunc(adminHandler.ListUsers)))
	mux.Handle("PATCH /v1/admin/users/{id}", withAuthTenant(http.HandlerFunc(adminHandler.UpdateUser)))
	mux.Handle("DELETE /v1/admin/users/{id}", withAuthTenant(http.HandlerFunc(adminHandler.DeleteUser)))
	mux.Handle("GET /v1/announcements/active", withAuthTenant(http.HandlerFunc(adminHandler.ListActiveAnnouncements)))
	mux.Handle("GET /v1/feature-requests/mine", withAuthTenant(http.HandlerFunc(adminHandler.ListMyFeatureRequests)))
	mux.Handle("POST /v1/feature-requests", withOrganization(http.HandlerFunc(adminHandler.CreateFeatureRequest)))
	mux.Handle("GET /v1/admin/feature-requests", withAuthTenant(http.HandlerFunc(adminHandler.ListFeatureRequestsAdmin)))
	mux.Handle("PATCH /v1/admin/feature-requests/{id}", withAuthTenant(http.HandlerFunc(adminHandler.RespondFeatureRequestAdmin)))
	mux.Handle("GET /v1/invitations", withAuthTenant(http.HandlerFunc(adminHandler.ListInvitations)))
	mux.Handle("POST /v1/invitations", withAuthTenant(http.HandlerFunc(adminHandler.CreateInvitation)))
	mux.Handle("DELETE /v1/invitations/{id}", withAuthTenant(http.HandlerFunc(adminHandler.DeleteInvitation)))
	mux.Handle("POST /v1/invitations/{token}/accept", withAuthTenant(http.HandlerFunc(adminHandler.AcceptInvitationAuthenticated)))
	mux.Handle("GET /v1/onboarding-requests/mine", withAuthTenant(http.HandlerFunc(adminHandler.ShowMyOnboardingRequest)))
	mux.Handle("POST /v1/onboarding-requests", withAuthTenant(http.HandlerFunc(adminHandler.CreateOnboardingRequest)))
	mux.Handle("GET /v1/admin/onboarding-requests", withAuthTenant(http.HandlerFunc(adminHandler.ListOnboardingRequestsAdmin)))
	mux.Handle("PATCH /v1/admin/onboarding-requests/{id}", withAuthTenant(http.HandlerFunc(adminHandler.UpdateOnboardingRequestAdmin)))
	mux.Handle("GET /v1/subscription-plans/active", withAuthTenant(http.HandlerFunc(adminHandler.ListActiveSubscriptionPlans)))
	mux.Handle("POST /v1/admin/modules", withAuthTenant(http.HandlerFunc(adminHandler.UpdateModuleAccess)))
	mux.Handle("GET /v1/admin/dashboard/overview", withAuthTenant(http.HandlerFunc(adminHandler.DashboardOverview)))
	mux.Handle("GET /v1/admin/dashboard/timeseries", withAuthTenant(http.HandlerFunc(adminHandler.DashboardTimeseries)))
	mux.Handle("GET /v1/admin/dashboard/pending", withAuthTenant(http.HandlerFunc(adminHandler.DashboardPending)))
	mux.Handle("GET /v1/admin/dashboard/feed", withAuthTenant(http.HandlerFunc(adminHandler.DashboardFeed)))
	mux.Handle("GET /v1/admin/ai-agents", withAuthTenant(http.HandlerFunc(aiHandler.ListAgents)))
	mux.Handle("POST /v1/admin/ai-agents", withAuthTenant(http.HandlerFunc(aiHandler.CreateAgent)))
	mux.Handle("PATCH /v1/admin/ai-agents/{id}", withAuthTenant(http.HandlerFunc(aiHandler.UpdateAgent)))
	mux.Handle("DELETE /v1/admin/ai-agents/{id}", withAuthTenant(http.HandlerFunc(aiHandler.DeleteAgent)))
	mux.Handle("GET /v1/admin/tables/{table}", withAuthTenant(http.HandlerFunc(adminHandler.ListTableRows)))
	mux.Handle("GET /v1/admin/tables/{table}/count", withAuthTenant(http.HandlerFunc(adminHandler.CountTableRows)))
	mux.Handle("POST /v1/admin/tables/{table}", withAuthTenant(http.HandlerFunc(adminHandler.CreateTableRow)))
	mux.Handle("PATCH /v1/admin/tables/{table}/{id}", withAuthTenant(http.HandlerFunc(adminHandler.UpdateTableRow)))
	mux.Handle("DELETE /v1/admin/tables/{table}/{id}", withAuthTenant(http.HandlerFunc(adminHandler.DeleteTableRow)))
	mux.Handle("GET /v1/admin/database-stats", withAuthTenant(http.HandlerFunc(adminHandler.DatabaseStats)))
	mux.Handle("GET /v1/admin/orphan-members", withAuthTenant(http.HandlerFunc(adminHandler.OrphanMemberStats)))
	mux.Handle("POST /v1/admin/orphan-members/cleanup", withAuthTenant(http.HandlerFunc(adminHandler.CleanupOrphanMembers)))
	mux.Handle("GET /v1/dashboard/stats", withOrganization(http.HandlerFunc(leadsHandler.ShowDashboardStats)))
	mux.Handle("GET /v1/dashboard/funnel", withOrganization(http.HandlerFunc(leadsHandler.ShowDashboardFunnel)))
	mux.Handle("GET /v1/dashboard/sources", withOrganization(http.HandlerFunc(leadsHandler.ShowDashboardSources)))
	mux.Handle("GET /v1/dashboard/top-brokers", withOrganization(http.HandlerFunc(leadsHandler.ShowDashboardTopBrokers)))
	mux.Handle("GET /v1/dashboard/upcoming-tasks", withOrganization(http.HandlerFunc(leadsHandler.ListDashboardUpcomingTasks)))
	mux.Handle("GET /v1/dashboard/deals-evolution", withOrganization(http.HandlerFunc(leadsHandler.ShowDashboardDealsEvolution)))
	mux.Handle("GET /v1/dashboard/extra-counts", withOrganization(http.HandlerFunc(leadsHandler.ShowDashboardExtraCounts)))
	mux.Handle("GET /v1/dashboard/recent-activities", withOrganization(http.HandlerFunc(leadsHandler.ListDashboardRecentActivities)))
	mux.Handle("GET /v1/dashboard/team-lead-ids", withOrganization(http.HandlerFunc(leadsHandler.ListDashboardTeamLeadIDs)))
	mux.Handle("POST /v1/ai/run", withOrganization(http.HandlerFunc(aiHandler.Run)))
	mux.Handle("GET /v1/schedule/capabilities", withOrganization(http.HandlerFunc(scheduleHandler.ShowCapabilities)))
	mux.Handle("GET /v1/schedule/events", withOrganization(http.HandlerFunc(scheduleHandler.ListEvents)))
	mux.Handle("POST /v1/schedule/events", withOrganization(http.HandlerFunc(scheduleHandler.CreateEvent)))
	mux.Handle("PATCH /v1/schedule/events/{id}", withOrganization(http.HandlerFunc(scheduleHandler.UpdateEvent)))
	mux.Handle("DELETE /v1/schedule/events/{id}", withOrganization(http.HandlerFunc(scheduleHandler.DeleteEvent)))
	mux.Handle("POST /v1/schedule/events/{id}/complete", withOrganization(http.HandlerFunc(scheduleHandler.CompleteEvent)))
	mux.Handle("GET /v1/schedule/events/{id}/comments", withOrganization(http.HandlerFunc(scheduleHandler.ListComments)))
	mux.Handle("POST /v1/schedule/events/{id}/comments", withOrganization(http.HandlerFunc(scheduleHandler.AddComment)))
	mux.Handle("GET /v1/schedule/events/{id}/assignees", withOrganization(http.HandlerFunc(scheduleHandler.ListAssignees)))
	mux.Handle("POST /v1/schedule/events/{id}/assignees", withOrganization(http.HandlerFunc(scheduleHandler.AddAssignee)))
	mux.Handle("DELETE /v1/schedule/events/{id}/assignees/{userId}", withOrganization(http.HandlerFunc(scheduleHandler.RemoveAssignee)))
	mux.Handle("GET /v1/automations", withOrganization(http.HandlerFunc(automationsHandler.List)))
	mux.Handle("POST /v1/automations", withOrganization(http.HandlerFunc(automationsHandler.Create)))
	mux.Handle("GET /v1/automations/{id}", withOrganization(http.HandlerFunc(automationsHandler.Show)))
	mux.Handle("PATCH /v1/automations/{id}", withOrganization(http.HandlerFunc(automationsHandler.Update)))
	mux.Handle("DELETE /v1/automations/{id}", withOrganization(http.HandlerFunc(automationsHandler.Delete)))
	mux.Handle("POST /v1/automations/{id}/duplicate", withOrganization(http.HandlerFunc(automationsHandler.Duplicate)))
	mux.Handle("PUT /v1/automations/{id}/flow", withOrganization(http.HandlerFunc(automationsHandler.SaveFlow)))
	mux.Handle("POST /v1/automations/{id}/start", withOrganization(http.HandlerFunc(automationsHandler.Start)))
	mux.Handle("GET /v1/automation-templates", withOrganization(http.HandlerFunc(automationsHandler.ListTemplates)))
	mux.Handle("POST /v1/automation-templates", withOrganization(http.HandlerFunc(automationsHandler.CreateTemplate)))
	mux.Handle("DELETE /v1/automation-templates/{id}", withOrganization(http.HandlerFunc(automationsHandler.DeleteTemplate)))
	mux.Handle("GET /v1/automation-executions", withOrganization(http.HandlerFunc(automationsHandler.ListExecutions)))
	mux.Handle("POST /v1/automation-executions/{id}/cancel", withOrganization(http.HandlerFunc(automationsHandler.CancelExecution)))
	mux.Handle("GET /v1/automation-media", withOrganization(http.HandlerFunc(automationsHandler.ListMedia)))
	mux.Handle("POST /v1/automation-media", withOrganization(http.HandlerFunc(automationsHandler.UploadMedia)))
	mux.Handle("DELETE /v1/automation-media", withOrganization(http.HandlerFunc(automationsHandler.DeleteMedia)))
	mux.Handle("POST /v1/public/webhooks/generic", http.HandlerFunc(webhooksHandler.ReceiveLead))
	mux.HandleFunc("POST /v1/public/onboarding/signup", adminHandler.PublicOnboardingSignup)
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
	mux.Handle("GET /v1/webhooks", withOrganization(http.HandlerFunc(webhooksHandler.List)))
	mux.Handle("POST /v1/webhooks", withOrganization(http.HandlerFunc(webhooksHandler.Create)))
	mux.Handle("PATCH /v1/webhooks/{id}", withOrganization(http.HandlerFunc(webhooksHandler.Update)))
	mux.Handle("DELETE /v1/webhooks/{id}", withOrganization(http.HandlerFunc(webhooksHandler.Delete)))
	mux.Handle("POST /v1/webhooks/{id}/regenerate-token", withOrganization(http.HandlerFunc(webhooksHandler.RegenerateToken)))
	mux.Handle("POST /v1/integrations/functions/{name}", withOrganization(http.HandlerFunc(integrationsHandler.InvokeFunction)))
	mux.Handle("GET /v1/integrations/vista", withOrganization(http.HandlerFunc(integrationsHandler.GetVista)))
	mux.Handle("PUT /v1/integrations/vista", withOrganization(http.HandlerFunc(integrationsHandler.SaveVista)))
	mux.Handle("DELETE /v1/integrations/vista", withOrganization(http.HandlerFunc(integrationsHandler.DeleteVista)))
	mux.Handle("GET /v1/integrations/imoview", withOrganization(http.HandlerFunc(integrationsHandler.GetImoview)))
	mux.Handle("PUT /v1/integrations/imoview", withOrganization(http.HandlerFunc(integrationsHandler.SaveImoview)))
	mux.Handle("DELETE /v1/integrations/imoview", withOrganization(http.HandlerFunc(integrationsHandler.DeleteImoview)))
	mux.Handle("GET /v1/integrations/meta", withOrganization(http.HandlerFunc(integrationsHandler.ListMetaIntegrations)))
	mux.Handle("GET /v1/integrations/meta/form-configs", withOrganization(http.HandlerFunc(integrationsHandler.ListMetaFormConfigs)))
	mux.Handle("POST /v1/integrations/meta/form-configs", withOrganization(http.HandlerFunc(integrationsHandler.SaveMetaFormConfig)))
	mux.Handle("PATCH /v1/integrations/meta/form-configs", withOrganization(http.HandlerFunc(integrationsHandler.ToggleMetaFormConfig)))
	mux.Handle("DELETE /v1/integrations/meta/form-configs", withOrganization(http.HandlerFunc(integrationsHandler.DeleteMetaFormConfig)))
	mux.Handle("GET /v1/integrations/meta/webhook-health", withOrganization(http.HandlerFunc(integrationsHandler.MetaWebhookHealth)))
	mux.Handle("GET /v1/integrations/meta/conversations", withOrganization(http.HandlerFunc(integrationsHandler.ListMetaConversations)))
	mux.Handle("GET /v1/integrations/meta/conversations/{id}/messages", withOrganization(http.HandlerFunc(integrationsHandler.ListMetaMessages)))
	mux.Handle("PATCH /v1/settings/profile", withAuthTenant(http.HandlerFunc(settingsHandler.UpdateProfile)))
	mux.Handle("POST /v1/settings/profile/avatar", withAuthTenant(http.HandlerFunc(settingsHandler.UploadProfileAvatar)))
	mux.Handle("PATCH /v1/settings/organization", withOrganization(http.HandlerFunc(settingsHandler.UpdateOrganization)))
	mux.Handle("POST /v1/settings/organization/logo", withOrganization(http.HandlerFunc(settingsHandler.UploadOrganizationLogo)))
	mux.Handle("POST /v1/settings/password", withAuthTenant(http.HandlerFunc(settingsHandler.ChangePassword)))
	mux.Handle("GET /v1/settings/password/status", withAuthTenant(http.HandlerFunc(settingsHandler.PasswordStatus)))
	mux.Handle("GET /v1/settings/modules", withOrganization(http.HandlerFunc(settingsHandler.ListOrganizationModules)))
	mux.Handle("GET /v1/settings/setup-guide-progress", withAuthTenant(http.HandlerFunc(settingsHandler.ShowSetupGuideProgress)))
	mux.Handle("PUT /v1/settings/setup-guide-progress", withAuthTenant(http.HandlerFunc(settingsHandler.UpdateSetupGuideProgress)))
	mux.Handle("POST /v1/settings/push-tokens", withOrganization(http.HandlerFunc(settingsHandler.SavePushToken)))
	mux.Handle("POST /v1/settings/push-tokens/deactivate", withAuthTenant(http.HandlerFunc(settingsHandler.DeactivatePushToken)))
	mux.Handle("GET /v1/settings/api-keys", withOrganization(http.HandlerFunc(settingsHandler.ListAPIKeys)))
	mux.Handle("POST /v1/settings/api-keys", withOrganization(http.HandlerFunc(settingsHandler.CreateAPIKey)))
	mux.Handle("DELETE /v1/settings/api-keys/{id}", withOrganization(http.HandlerFunc(settingsHandler.DeleteAPIKey)))
	mux.Handle("GET /v1/settings/subscription", withOrganization(http.HandlerFunc(settingsHandler.ShowSubscription)))
	mux.Handle("PATCH /v1/settings/subscription/billing", withOrganization(http.HandlerFunc(settingsHandler.UpdateSubscriptionBilling)))
	mux.Handle("PATCH /v1/settings/subscription/plan", withOrganization(http.HandlerFunc(settingsHandler.SelectSubscriptionPlan)))
	mux.Handle("GET /v1/settings/roles", withOrganization(http.HandlerFunc(settingsHandler.ListOrganizationRoles)))
	mux.Handle("POST /v1/settings/roles", withOrganization(http.HandlerFunc(settingsHandler.CreateRole)))
	mux.Handle("PATCH /v1/settings/roles/{id}", withOrganization(http.HandlerFunc(settingsHandler.UpdateRole)))
	mux.Handle("DELETE /v1/settings/roles/{id}", withOrganization(http.HandlerFunc(settingsHandler.DeleteRole)))
	mux.Handle("GET /v1/settings/roles/{id}/permissions", withOrganization(http.HandlerFunc(settingsHandler.ListRolePermissions)))
	mux.Handle("PUT /v1/settings/roles/{id}/permissions", withOrganization(http.HandlerFunc(settingsHandler.ReplaceRolePermissions)))
	mux.Handle("GET /v1/settings/permissions", withAuthTenant(http.HandlerFunc(settingsHandler.ListAvailablePermissions)))
	mux.Handle("GET /v1/settings/user-roles", withOrganization(http.HandlerFunc(settingsHandler.ListUserOrganizationRoles)))
	mux.Handle("PUT /v1/settings/user-roles", withOrganization(http.HandlerFunc(settingsHandler.AssignUserRole)))
	mux.Handle("GET /v1/settings/has-permission", withAuthTenant(http.HandlerFunc(settingsHandler.HasPermission)))
	mux.Handle("GET /v1/site", withOrganization(http.HandlerFunc(siteHandler.ShowSite)))
	mux.Handle("POST /v1/site", withOrganization(http.HandlerFunc(siteHandler.CreateSite)))
	mux.Handle("PATCH /v1/site", withOrganization(http.HandlerFunc(siteHandler.UpdateSite)))
	mux.Handle("POST /v1/site/assets", withOrganization(http.HandlerFunc(siteHandler.UploadAsset)))
	mux.Handle("GET /v1/site/menu-items", withOrganization(http.HandlerFunc(siteHandler.ListMenuItems)))
	mux.Handle("POST /v1/site/menu-items", withOrganization(http.HandlerFunc(siteHandler.CreateMenuItem)))
	mux.Handle("PATCH /v1/site/menu-items/{id}", withOrganization(http.HandlerFunc(siteHandler.UpdateMenuItem)))
	mux.Handle("DELETE /v1/site/menu-items/{id}", withOrganization(http.HandlerFunc(siteHandler.DeleteMenuItem)))
	mux.Handle("POST /v1/site/menu-items/reorder", withOrganization(http.HandlerFunc(siteHandler.ReorderMenuItems)))
	mux.Handle("GET /v1/site/search-filters", withOrganization(http.HandlerFunc(siteHandler.ListSearchFilters)))
	mux.Handle("POST /v1/site/search-filters", withOrganization(http.HandlerFunc(siteHandler.CreateSearchFilter)))
	mux.Handle("PATCH /v1/site/search-filters/{id}", withOrganization(http.HandlerFunc(siteHandler.UpdateSearchFilter)))
	mux.Handle("DELETE /v1/site/search-filters/{id}", withOrganization(http.HandlerFunc(siteHandler.DeleteSearchFilter)))
	mux.Handle("POST /v1/site/search-filters/reorder", withOrganization(http.HandlerFunc(siteHandler.ReorderSearchFilters)))
	mux.Handle("GET /v1/whatsapp/message-templates", withOrganization(http.HandlerFunc(whatsappHandler.ListMessageTemplates)))
	mux.Handle("POST /v1/whatsapp/message-templates", withOrganization(http.HandlerFunc(whatsappHandler.CreateMessageTemplate)))
	mux.Handle("PATCH /v1/whatsapp/message-templates/{id}", withOrganization(http.HandlerFunc(whatsappHandler.UpdateMessageTemplate)))
	mux.Handle("DELETE /v1/whatsapp/message-templates/{id}", withOrganization(http.HandlerFunc(whatsappHandler.DeleteMessageTemplate)))
	mux.Handle("GET /v1/whatsapp/sessions", withOrganization(http.HandlerFunc(whatsappHandler.ListSessions)))
	mux.Handle("POST /v1/whatsapp/sessions", withOrganization(http.HandlerFunc(whatsappHandler.CreateSession)))
	mux.Handle("GET /v1/whatsapp/sessions/{id}", withOrganization(http.HandlerFunc(whatsappHandler.ShowSession)))
	mux.Handle("DELETE /v1/whatsapp/sessions/{id}", withOrganization(http.HandlerFunc(whatsappHandler.DeleteSession)))
	mux.Handle("POST /v1/whatsapp/sessions/{id}/qr", withOrganization(http.HandlerFunc(whatsappHandler.GetQRCode)))
	mux.Handle("POST /v1/whatsapp/sessions/{id}/status", withOrganization(http.HandlerFunc(whatsappHandler.GetConnectionStatus)))
	mux.Handle("POST /v1/whatsapp/sessions/{id}/recreate", withOrganization(http.HandlerFunc(whatsappHandler.RecreateSession)))
	mux.Handle("POST /v1/whatsapp/sessions/{id}/logout", withOrganization(http.HandlerFunc(whatsappHandler.LogoutSession)))
	mux.Handle("POST /v1/whatsapp/sessions/{id}/notification-session", withOrganization(http.HandlerFunc(whatsappHandler.ToggleNotificationSession)))
	mux.Handle("GET /v1/whatsapp/sessions/{id}/access", withOrganization(http.HandlerFunc(whatsappHandler.ListSessionAccess)))
	mux.Handle("POST /v1/whatsapp/sessions/{id}/access", withOrganization(http.HandlerFunc(whatsappHandler.GrantSessionAccess)))
	mux.Handle("DELETE /v1/whatsapp/sessions/{id}/access/{userId}", withOrganization(http.HandlerFunc(whatsappHandler.RevokeSessionAccess)))
	mux.Handle("GET /v1/whatsapp/sessions/{id}/labels", withOrganization(http.HandlerFunc(whatsappHandler.ListLabels)))
	mux.Handle("POST /v1/whatsapp/sessions/{id}/labels/sync", withOrganization(http.HandlerFunc(whatsappHandler.SyncLabels)))
	mux.Handle("POST /v1/whatsapp/sessions/{id}/labels/assign", withOrganization(http.HandlerFunc(whatsappHandler.AssignLabel)))
	mux.Handle("GET /v1/whatsapp/sessions/{id}/groups", withOrganization(http.HandlerFunc(whatsappHandler.ListGroups)))
	mux.Handle("POST /v1/whatsapp/sessions/{id}/groups/sync", withOrganization(http.HandlerFunc(whatsappHandler.SyncGroups)))
	mux.Handle("POST /v1/whatsapp/sessions/{id}/groups/info", withOrganization(http.HandlerFunc(whatsappHandler.GroupInfo)))
	mux.Handle("POST /v1/whatsapp/sessions/{id}/groups/invite-link", withOrganization(http.HandlerFunc(whatsappHandler.GroupInviteLink)))
	mux.Handle("POST /v1/whatsapp/sessions/{id}/groups/update", withOrganization(http.HandlerFunc(whatsappHandler.UpdateGroup)))
	mux.Handle("POST /v1/whatsapp/sessions/{id}/contacts/check", withOrganization(http.HandlerFunc(whatsappHandler.CheckNumbers)))
	mux.Handle("POST /v1/whatsapp/sessions/{id}/contacts/avatar", withOrganization(http.HandlerFunc(whatsappHandler.FetchAvatar)))
	mux.Handle("POST /v1/whatsapp/sessions/{id}/contacts/sync", withOrganization(http.HandlerFunc(whatsappHandler.SyncContactsAvatars)))
	mux.Handle("POST /v1/whatsapp/sessions/{id}/history-sync", withOrganization(http.HandlerFunc(whatsappHandler.HistorySync)))
	mux.Handle("POST /v1/whatsapp/provider-action", withOrganization(http.HandlerFunc(whatsappHandler.ProviderAction)))
	mux.Handle("GET /v1/whatsapp/conversations", withOrganization(http.HandlerFunc(whatsappHandler.ListConversations)))
	mux.Handle("POST /v1/whatsapp/conversations/start", withOrganization(http.HandlerFunc(whatsappHandler.StartConversation)))
	mux.Handle("GET /v1/whatsapp/conversations/find", withOrganization(http.HandlerFunc(whatsappHandler.FindConversation)))
	mux.Handle("GET /v1/whatsapp/history", withOrganization(http.HandlerFunc(whatsappHandler.HistoryAccess)))
	mux.Handle("GET /v1/whatsapp/conversations/{id}", withOrganization(http.HandlerFunc(whatsappHandler.ShowConversation)))
	mux.Handle("GET /v1/whatsapp/conversations/{id}/messages", withOrganization(http.HandlerFunc(whatsappHandler.ListMessages)))
	mux.Handle("POST /v1/whatsapp/conversations/{id}/send-message", withOrganization(http.HandlerFunc(whatsappHandler.SendMessage)))
	mux.Handle("POST /v1/whatsapp/conversations/{id}/mark-read", withOrganization(http.HandlerFunc(whatsappHandler.MarkConversationAsRead)))
	mux.Handle("POST /v1/whatsapp/conversations/{id}/mark-seen", withOrganization(http.HandlerFunc(whatsappHandler.MarkAsSeenOnWhatsApp)))
	mux.Handle("POST /v1/whatsapp/conversations/{id}/archive", withOrganization(http.HandlerFunc(whatsappHandler.ArchiveConversation)))
	mux.Handle("DELETE /v1/whatsapp/conversations/{id}", withOrganization(http.HandlerFunc(whatsappHandler.DeleteConversation)))
	mux.Handle("POST /v1/whatsapp/conversations/{id}/link-lead", withOrganization(http.HandlerFunc(whatsappHandler.LinkConversationToLead)))
	mux.Handle("GET /v1/whatsapp/conversations/{id}/labels", withOrganization(http.HandlerFunc(whatsappHandler.ListChatLabels)))
	mux.Handle("POST /v1/whatsapp/messages/{id}/retry-media", withOrganization(http.HandlerFunc(whatsappHandler.RetryMediaDownload)))
	mux.Handle("GET /v1/lead-enrichments", withOrganization(http.HandlerFunc(leadsHandler.ListEnrichments)))
	mux.Handle("GET /v1/pipeline-board", withOrganization(http.HandlerFunc(leadsHandler.ShowPipelineBoard)))
	mux.Handle("GET /v1/pipeline-stage-leads", withOrganization(http.HandlerFunc(leadsHandler.ListPipelineStageLeads)))
	mux.Handle("GET /v1/pipeline-stage-counts", withOrganization(http.HandlerFunc(leadsHandler.ListPipelineStageCounts)))
	mux.Handle("GET /v1/lead-meta-filters", withOrganization(http.HandlerFunc(leadsHandler.ListLeadMetaFilters)))
	mux.Handle("GET /v1/lead-visibility", withOrganization(http.HandlerFunc(leadsHandler.ShowLeadVisibility)))
	mux.Handle("GET /v1/contacts", withOrganization(http.HandlerFunc(leadsHandler.ListContacts)))
	mux.Handle("GET /v1/tags", withOrganization(http.HandlerFunc(leadsHandler.ListTags)))
	mux.Handle("POST /v1/tags", withOrganization(http.HandlerFunc(leadsHandler.CreateTag)))
	mux.Handle("PATCH /v1/tags/{id}", withOrganization(http.HandlerFunc(leadsHandler.UpdateTag)))
	mux.Handle("DELETE /v1/tags/{id}", withOrganization(http.HandlerFunc(leadsHandler.DeleteTag)))
	mux.Handle("GET /v1/activities", withOrganization(http.HandlerFunc(leadsHandler.ListActivities)))
	mux.Handle("POST /v1/activities", withOrganization(http.HandlerFunc(leadsHandler.CreateActivity)))
	mux.Handle("GET /v1/lead-meta", withOrganization(http.HandlerFunc(leadsHandler.ShowLeadMeta)))
	mux.Handle("GET /v1/lead-attachments", withOrganization(http.HandlerFunc(leadsHandler.ListLeadAttachments)))
	mux.Handle("POST /v1/lead-attachments", withOrganization(http.HandlerFunc(leadsHandler.CreateLeadAttachment)))
	mux.Handle("GET /v1/lead-analytics/first-response-metrics", withOrganization(http.HandlerFunc(leadsHandler.ShowFirstResponseMetrics)))
	mux.Handle("GET /v1/lead-analytics/first-response-ranking", withOrganization(http.HandlerFunc(leadsHandler.ListFirstResponseRanking)))
	mux.Handle("GET /v1/lead-tasks", withOrganization(http.HandlerFunc(leadsHandler.ListLeadTasks)))
	mux.Handle("POST /v1/lead-tasks", withOrganization(http.HandlerFunc(leadsHandler.CreateLeadTask)))
	mux.Handle("PATCH /v1/lead-tasks/{id}", withOrganization(http.HandlerFunc(leadsHandler.PatchLeadTask)))
	mux.Handle("POST /v1/lead-tasks/complete-cadence", withOrganization(http.HandlerFunc(leadsHandler.CompleteCadenceTask)))
	mux.Handle("GET /v1/notifications", withOrganization(http.HandlerFunc(leadsHandler.ListNotifications)))
	mux.Handle("POST /v1/notifications", withOrganization(http.HandlerFunc(leadsHandler.CreateNotification)))
	mux.Handle("GET /v1/notifications/unread-count", withOrganization(http.HandlerFunc(leadsHandler.CountUnreadNotifications)))
	mux.Handle("POST /v1/notifications/{id}/read", withOrganization(http.HandlerFunc(leadsHandler.MarkNotificationRead)))
	mux.Handle("POST /v1/notifications/read-all", withOrganization(http.HandlerFunc(leadsHandler.MarkAllNotificationsRead)))
	mux.Handle("GET /v1/leads", withOrganization(http.HandlerFunc(leadsHandler.List)))
	mux.Handle("POST /v1/leads", withOrganization(http.HandlerFunc(leadsHandler.Create)))
	mux.Handle("GET /v1/leads/{id}/timeline", withOrganization(http.HandlerFunc(leadsHandler.ListLeadTimeline)))
	mux.Handle("GET /v1/leads/{id}/journey", withOrganization(http.HandlerFunc(leadsHandler.ListLeadJourney)))
	mux.Handle("GET /v1/leads/{id}/history-raw", withOrganization(http.HandlerFunc(leadsHandler.ShowLeadHistoryRaw)))
	mux.Handle("GET /v1/leads/{id}/conversation-detail", withOrganization(http.HandlerFunc(leadsHandler.ShowConversationDetail)))
	mux.Handle("GET /v1/leads/{id}", withOrganization(http.HandlerFunc(leadsHandler.Show)))
	mux.Handle("PATCH /v1/leads/{id}", withOrganization(http.HandlerFunc(leadsHandler.Update)))
	mux.Handle("DELETE /v1/leads/{id}", withOrganization(http.HandlerFunc(leadsHandler.Delete)))
	mux.Handle("POST /v1/leads/{id}/attachments", withOrganization(http.HandlerFunc(leadsHandler.UploadLeadAttachment)))
	mux.Handle("POST /v1/leads/{id}/first-response", withOrganization(http.HandlerFunc(leadsHandler.RecordFirstResponse)))
	mux.Handle("POST /v1/leads/{id}/move-stage", withOrganization(http.HandlerFunc(leadsHandler.MoveStage)))
	mux.Handle("POST /v1/leads/{id}/assign", withOrganization(http.HandlerFunc(leadsHandler.Assign)))
	mux.Handle("POST /v1/leads/{id}/redistribute", withOrganization(http.HandlerFunc(leadsHandler.RedistributeRoundRobin)))
	mux.Handle("POST /v1/leads/{id}/tags", withOrganization(http.HandlerFunc(leadsHandler.AddTag)))
	mux.Handle("DELETE /v1/leads/{id}/tags/{tagId}", withOrganization(http.HandlerFunc(leadsHandler.RemoveTag)))
	mux.Handle("GET /v1/properties", withOrganization(http.HandlerFunc(propertiesHandler.List)))
	mux.Handle("POST /v1/properties", withOrganization(http.HandlerFunc(propertiesHandler.Create)))
	mux.Handle("GET /v1/properties/{id}", withOrganization(http.HandlerFunc(propertiesHandler.Show)))
	mux.Handle("PATCH /v1/properties/{id}", withOrganization(http.HandlerFunc(propertiesHandler.Update)))
	mux.Handle("DELETE /v1/properties/{id}", withOrganization(http.HandlerFunc(propertiesHandler.Delete)))
	mux.Handle("POST /v1/property-images", withOrganization(http.HandlerFunc(propertiesHandler.UploadImage)))
	mux.Handle("GET /v1/property-captors/{id}", withOrganization(http.HandlerFunc(propertiesHandler.ShowPropertyCaptor)))
	mux.Handle("GET /v1/property-site-info", withOrganization(http.HandlerFunc(propertiesHandler.ShowPropertySiteInfo)))
	mux.Handle("GET /v1/property-summaries", withOrganization(http.HandlerFunc(propertiesHandler.ListPropertySummaries)))
	mux.Handle("GET /v1/user-organizations", withAuthTenant(http.HandlerFunc(usersHandler.ListUserOrganizations)))
	mux.Handle("GET /v1/users", withOrganization(http.HandlerFunc(usersHandler.ListOrganizationUsers)))
	mux.Handle("POST /v1/users", withOrganization(http.HandlerFunc(usersHandler.CreateOrganizationUser)))
	mux.Handle("PATCH /v1/users/{id}", withOrganization(http.HandlerFunc(usersHandler.UpdateOrganizationUser)))
	mux.Handle("DELETE /v1/users/{id}", withOrganization(http.HandlerFunc(usersHandler.DeleteOrganizationUser)))
	mux.Handle("GET /v1/user-summaries", withOrganization(http.HandlerFunc(usersHandler.ListSummaries)))
	mux.Handle("GET /v1/teams", withOrganization(http.HandlerFunc(teamsHandler.List)))
	mux.Handle("POST /v1/teams", withOrganization(http.HandlerFunc(teamsHandler.Create)))
	mux.Handle("PATCH /v1/teams/{id}", withOrganization(http.HandlerFunc(teamsHandler.Update)))
	mux.Handle("DELETE /v1/teams/{id}", withOrganization(http.HandlerFunc(teamsHandler.Delete)))
	mux.Handle("PATCH /v1/teams/{id}/status", withOrganization(http.HandlerFunc(teamsHandler.UpdateStatus)))
	mux.Handle("POST /v1/teams/logo", withOrganization(http.HandlerFunc(teamsHandler.UploadLogo)))
	mux.Handle("GET /v1/team-pipelines", withOrganization(http.HandlerFunc(teamsHandler.ListTeamPipelines)))
	mux.Handle("POST /v1/team-pipelines", withOrganization(http.HandlerFunc(teamsHandler.AssignPipelineToTeam)))
	mux.Handle("DELETE /v1/team-pipelines", withOrganization(http.HandlerFunc(teamsHandler.RemovePipelineFromTeam)))
	mux.Handle("PATCH /v1/team-members/leader", withOrganization(http.HandlerFunc(teamsHandler.SetTeamLeader)))
	mux.Handle("GET /v1/member-availability", withOrganization(http.HandlerFunc(teamsHandler.ListMemberAvailability)))
	mux.Handle("PATCH /v1/member-availability", withOrganization(http.HandlerFunc(teamsHandler.UpsertAvailability)))
	mux.Handle("GET /v1/team-members/{id}/availability", withOrganization(http.HandlerFunc(teamsHandler.ListTeamMemberAvailability)))
	mux.Handle("PUT /v1/team-members/{id}/availability", withOrganization(http.HandlerFunc(teamsHandler.ReplaceAvailability)))
	mux.Handle("GET /v1/property-types", withOrganization(http.HandlerFunc(propertiesHandler.ListPropertyTypes)))
	mux.Handle("POST /v1/property-types", withOrganization(http.HandlerFunc(propertiesHandler.CreatePropertyType)))
	mux.Handle("GET /v1/property-features", withOrganization(http.HandlerFunc(propertiesHandler.ListPropertyFeatures)))
	mux.Handle("POST /v1/property-features", withOrganization(http.HandlerFunc(propertiesHandler.CreatePropertyFeature)))
	mux.Handle("POST /v1/property-features/seed-defaults", withOrganization(http.HandlerFunc(propertiesHandler.SeedPropertyFeatures)))
	mux.Handle("GET /v1/property-proximities", withOrganization(http.HandlerFunc(propertiesHandler.ListPropertyProximities)))
	mux.Handle("POST /v1/property-proximities", withOrganization(http.HandlerFunc(propertiesHandler.CreatePropertyProximity)))
	mux.Handle("POST /v1/property-proximities/seed-defaults", withOrganization(http.HandlerFunc(propertiesHandler.SeedPropertyProximities)))
	mux.Handle("GET /v1/property-cities", withOrganization(http.HandlerFunc(propertiesHandler.ListCities)))
	mux.Handle("POST /v1/property-cities", withOrganization(http.HandlerFunc(propertiesHandler.CreateCity)))
	mux.Handle("DELETE /v1/property-cities/{id}", withOrganization(http.HandlerFunc(propertiesHandler.DeleteCity)))
	mux.Handle("GET /v1/property-neighborhoods", withOrganization(http.HandlerFunc(propertiesHandler.ListNeighborhoods)))
	mux.Handle("POST /v1/property-neighborhoods", withOrganization(http.HandlerFunc(propertiesHandler.CreateNeighborhood)))
	mux.Handle("DELETE /v1/property-neighborhoods/{id}", withOrganization(http.HandlerFunc(propertiesHandler.DeleteNeighborhood)))
	mux.Handle("GET /v1/property-condominiums", withOrganization(http.HandlerFunc(propertiesHandler.ListCondominiums)))
	mux.Handle("POST /v1/property-condominiums", withOrganization(http.HandlerFunc(propertiesHandler.CreateCondominium)))
	mux.Handle("DELETE /v1/property-condominiums/{id}", withOrganization(http.HandlerFunc(propertiesHandler.DeleteCondominium)))
	mux.Handle("GET /v1/pipelines", withOrganization(http.HandlerFunc(pipelinesHandler.List)))
	mux.Handle("POST /v1/pipelines", withOrganization(http.HandlerFunc(pipelinesHandler.Create)))
	mux.Handle("PATCH /v1/pipelines/{id}", withOrganization(http.HandlerFunc(pipelinesHandler.Update)))
	mux.Handle("DELETE /v1/pipelines/{id}", withOrganization(http.HandlerFunc(pipelinesHandler.Delete)))
	mux.Handle("GET /v1/stages", withOrganization(http.HandlerFunc(pipelinesHandler.ListStages)))
	mux.Handle("POST /v1/pipelines/{id}/stages", withOrganization(http.HandlerFunc(pipelinesHandler.CreateStage)))
	mux.Handle("POST /v1/pipelines/{id}/stages/reorder", withOrganization(http.HandlerFunc(pipelinesHandler.ReorderStages)))
	mux.Handle("POST /v1/pipelines/{id}/round-robin", withOrganization(http.HandlerFunc(pipelinesHandler.SetDefaultRoundRobin)))
	mux.Handle("PATCH /v1/stages/{id}", withOrganization(http.HandlerFunc(pipelinesHandler.UpdateStage)))
	mux.Handle("DELETE /v1/stages/{id}", withOrganization(http.HandlerFunc(pipelinesHandler.DeleteStage)))
	mux.Handle("GET /v1/round-robins", withOrganization(http.HandlerFunc(roundRobinHandler.List)))
	mux.Handle("POST /v1/round-robins", withOrganization(http.HandlerFunc(roundRobinHandler.Create)))
	mux.Handle("PATCH /v1/round-robins/{id}", withOrganization(http.HandlerFunc(roundRobinHandler.Update)))
	mux.Handle("DELETE /v1/round-robins/{id}", withOrganization(http.HandlerFunc(roundRobinHandler.Delete)))
	mux.Handle("GET /v1/round-robins/{id}/rules", withOrganization(http.HandlerFunc(roundRobinHandler.ListRules)))
	mux.Handle("POST /v1/round-robins/{id}/rules", withOrganization(http.HandlerFunc(roundRobinHandler.CreateRule)))
	mux.Handle("GET /v1/round-robin-rules", withOrganization(http.HandlerFunc(roundRobinHandler.ListRules)))
	mux.Handle("POST /v1/round-robin-rules", withOrganization(http.HandlerFunc(roundRobinHandler.CreateRule)))
	mux.Handle("PATCH /v1/round-robin-rules/{id}", withOrganization(http.HandlerFunc(roundRobinHandler.UpdateRule)))
	mux.Handle("DELETE /v1/round-robin-rules/{id}", withOrganization(http.HandlerFunc(roundRobinHandler.DeleteRule)))
	mux.Handle("POST /v1/round-robins/{id}/members", withOrganization(http.HandlerFunc(roundRobinHandler.AddMember)))
	mux.Handle("PATCH /v1/round-robin-members/{id}", withOrganization(http.HandlerFunc(roundRobinHandler.UpdateMember)))
	mux.Handle("DELETE /v1/round-robin-members/{id}", withOrganization(http.HandlerFunc(roundRobinHandler.DeleteMember)))

	handler := httpserver.Chain(
		mux,
		httpserver.Recover(logger),
		httpserver.RequestID,
		httpserver.LogRequests(logger),
		httpserver.CORS(cfg.HTTP.CORSOrigins),
	)

	return &App{
		handler: handler,
		db:      postgres,
		auth:    authVerifier,
	}, nil
}

func (app *App) Handler() http.Handler {
	return app.handler
}

func (app *App) Close() {
	if app.db != nil {
		app.db.Close()
	}

	if app.auth != nil {
		app.auth.Close()
	}
}
