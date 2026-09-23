package app

import (
	"context"
	"log/slog"
	"net/http"
	"strings"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/admin"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/ai"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/analytics"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/attention"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/audit"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/automations"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/billing"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/cadences"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/config"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/developments"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/financial"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/gamification"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/health"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/help"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/homefocus"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/integrations"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/leads"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/me"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/meta"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/pipelines"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/portals"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/presence"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/properties"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/publicapi"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/publications"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/publicingress"
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
	handler  http.Handler
	db       *dbpkg.Postgres
	auth     *authpkg.Verifier
	realtime *realtime.Hub
}

func New(ctx context.Context, cfg config.Config, logger *slog.Logger) (*App, error) {
	backgroundWorkers := newBackgroundWorkerStartup(cfg.BackgroundWorkersEnabled)
	if !cfg.BackgroundWorkersEnabled && logger != nil {
		logger.Info(
			"api background workers disabled",
			"config", "API_BACKGROUND_WORKERS_ENABLED",
		)
	}

	publicClientIPResolver, err := publicingress.NewClientIPResolver(
		cfg.HTTP.TrustedProxyCIDRs,
	)
	if err != nil {
		return nil, err
	}

	authVerifier, err := authpkg.NewVerifier(ctx, cfg.Auth)
	if err != nil {
		return nil, err
	}

	postgres, err := dbpkg.NewPostgres(ctx, cfg.Database)
	if err != nil {
		return nil, err
	}

	mux := http.NewServeMux()
	realtimeHub := realtime.NewDurableHub(realtime.NewPostgresStore(postgres), logger)
	if _, err := backgroundWorkers.RunWithError(func() error {
		return realtimeHub.Start(ctx)
	}); err != nil {
		postgres.Close()
		authVerifier.Close()
		return nil, err
	}

	var metaOAuthHandler *meta.OAuthHandler
	if strings.TrimSpace(cfg.Meta.AppID) != "" {
		metaOAuthHandler, err = meta.NewOAuthHandler(postgres, meta.OAuthConfig{
			AppID:          cfg.Meta.AppID,
			AppSecret:      cfg.Meta.AppSecret,
			LoginConfigID:  cfg.Meta.LoginConfigID,
			GraphVersion:   cfg.Meta.GraphVersion,
			CallbackURL:    cfg.Meta.OAuthCallbackURL,
			AllowedOrigins: meta.ParseOAuthAllowedOrigins(cfg.Email.AppURL, strings.Join(cfg.Meta.OAuthAllowedOrigins, ",")),
			GraphBaseURL:   cfg.Meta.GraphBaseURL,
		})
		if err != nil {
			realtimeHub.Close()
			postgres.Close()
			authVerifier.Close()
			return nil, err
		}
	}
	billingReconciler := billing.NewReconciler(postgres, billing.Config{
		Enabled:         cfg.Asaas.ReconciliationEnabled,
		BaseURL:         cfg.Asaas.APIURL,
		APIKey:          cfg.Asaas.APIKey,
		FunctionsURL:    cfg.Storage.ProjectURL,
		FunctionsAPIKey: cfg.Storage.APIKey,
		AppURL:          cfg.Email.AppURL,
		Interval:        cfg.Asaas.ReconciliationInterval,
		BatchSize:       cfg.Asaas.ReconciliationBatch,
		RequestTimeout:  cfg.Asaas.RequestTimeout,
	})
	backgroundWorkers.Run(func() {
		billingReconciler.Start(ctx, logger)
	})

	var notificationDispatchStats func() leads.NotificationDispatchStats
	var whatsappRuntimeStats func() map[string]any
	healthHandler := health.NewHandler(postgres, cfg.Database.HealthTimeout).WithRuntimeStats(
		func() map[string]any {
			runtime := map[string]any{
				"realtime":              realtimeHub.Stats(),
				"billingReconciliation": billingReconciler.Stats(),
				"notificationDispatch": map[string]any{
					"backgroundWorkersEnabled": cfg.BackgroundWorkersEnabled,
					"workerEnabled":            cfg.Notifications.DispatchWorkerEnabled,
				},
				"whatsapp": map[string]any{
					"backgroundWorkersEnabled": cfg.BackgroundWorkersEnabled,
					"webhookWorkerEnabled":     cfg.WhatsApp.WebhookWorkerEnabled,
					"outboxWorkerEnabled":      cfg.WhatsApp.OutboxWorkerEnabled,
					"mediaWorkerEnabled":       cfg.WhatsApp.MediaWorkerEnabled,
					"mediaWorkerConcurrency":   cfg.WhatsApp.MediaWorkerConcurrency,
				},
			}
			if notificationDispatchStats != nil {
				runtime["notificationDispatch"].(map[string]any)["stats"] = notificationDispatchStats()
			}
			if whatsappRuntimeStats != nil {
				runtime["whatsapp"].(map[string]any)["stats"] = whatsappRuntimeStats()
			}
			return runtime
		},
	)
	helpHandler := help.NewHandler(help.NewRepository(postgres))
	realtimeHandler := realtime.NewHandler(realtimeHub)
	analyticsHandler := analytics.NewHandler(analytics.NewRepository(postgres))
	attentionRepository := attention.NewRepository(postgres)
	backgroundWorkers.Run(func() {
		attentionRepository.StartWorker(ctx, logger)
	})
	attentionHandler := attention.NewHandler(attentionRepository)
	homeFocusHandler := homefocus.NewHandler(homefocus.NewRepository(postgres))
	gamificationRepository := gamification.NewRepository(postgres)
	backgroundWorkers.Run(func() {
		gamificationRepository.StartWorker(ctx, logger)
	})
	gamificationHandler := gamification.NewHandler(gamificationRepository)
	cadencesHandler := cadences.NewHandler(cadences.NewRepository(postgres))
	financialHandler := financial.NewHandler(financial.NewRepository(postgres, financial.StorageConfig{
		ProjectURL: cfg.Storage.ProjectURL,
		APIKey:     cfg.Storage.APIKey,
	}))
	adminHandler := admin.NewHandler(admin.NewRepository(postgres, admin.ExternalConfig{
		Environment:          cfg.Environment,
		ProjectURL:           cfg.Storage.ProjectURL,
		APIKey:               cfg.Storage.APIKey,
		ResendAPIKey:         cfg.Email.ResendAPIKey,
		FromEmail:            cfg.Email.FromEmail,
		ReplyTo:              cfg.Email.ReplyTo,
		SupportEmail:         cfg.Email.SupportEmail,
		AppURL:               cfg.Email.AppURL,
		EvolutionGoURL:       cfg.EvolutionGo.APIURL,
		EvolutionGoAPIKey:    cfg.EvolutionGo.APIKey,
		AsaasURL:             cfg.Asaas.APIURL,
		AsaasAPIKey:          cfg.Asaas.APIKey,
		SignupRecoverySecret: cfg.Email.SignupRecoverySecret,
	}), realtimeHub).WithPublicClientIPResolver(publicClientIPResolver)
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
	leadsRepository := leads.NewRepository(postgres, gamificationRepository, leads.StorageConfig{
		ProjectURL: cfg.Storage.ProjectURL,
		APIKey:     cfg.Storage.APIKey,
		EvolutionGo: leads.EvolutionGoConfig{
			APIURL: cfg.EvolutionGo.APIURL,
			APIKey: cfg.EvolutionGo.APIKey,
		},
		Email: leads.EmailConfig{
			ResendAPIKey:   cfg.Email.ResendAPIKey,
			FromEmail:      cfg.Email.FromEmail,
			ReplyTo:        cfg.Email.ReplyTo,
			SupportEmail:   cfg.Email.SupportEmail,
			AppURL:         cfg.Email.AppURL,
			AuthProjectURL: cfg.Storage.ProjectURL,
		},
		Push: leads.PushConfig{
			VAPIDPublicKey:        cfg.Push.VAPIDPublicKey,
			VAPIDPrivateKey:       cfg.Push.VAPIDPrivateKey,
			VAPIDSubject:          cfg.Push.VAPIDSubject,
			FCMServerKey:          cfg.Push.FCMServerKey,
			FCMProjectID:          cfg.Push.FCMProjectID,
			FCMServiceAccountJSON: cfg.Push.FCMServiceAccountJSON,
			FCMServiceAccountFile: cfg.Push.FCMServiceAccountFile,
		},
	})
	notificationDispatchStats = leadsRepository.NotificationDispatchStats
	backgroundWorkers.Run(func() {
		leadsRepository.StartRedistributionWorker(ctx, logger)
	})
	backgroundWorkers.Run(func() {
		if !startNotificationDispatchWorker(cfg.Notifications.DispatchWorkerEnabled, func() {
			leadsRepository.StartNotificationDispatchWorker(ctx, logger)
		}) && logger != nil {
			logger.Info(
				"notification dispatch worker disabled",
				"config", "NOTIFICATION_DISPATCH_WORKER_ENABLED",
			)
		}
	})
	leadsHandler := leads.NewHandler(leadsRepository, realtimeHub)
	pipelinesHandler := pipelines.NewHandler(pipelines.NewRepository(postgres))
	propertiesRepository := properties.NewRepository(postgres, properties.StorageConfig{
		ProjectURL: cfg.Storage.ProjectURL,
		APIKey:     cfg.Storage.APIKey,
	})
	backgroundWorkers.Run(func() {
		go propertiesRepository.StartAssetCleanupWorker(ctx, logger)
	})
	propertiesHandler := properties.NewHandler(propertiesRepository)
	publicationsRepository := publications.NewRepository(postgres, publications.Config{
		PublicBaseURL: cfg.Publications.PublicBaseURL,
		AppURL:        cfg.Email.AppURL,
		StorageURL:    cfg.Storage.ProjectURL,
		StorageAPIKey: cfg.Storage.APIKey,
		Worker: publications.WorkerConfig{
			Enabled:     cfg.Publications.WorkerEnabled,
			Interval:    cfg.Publications.WorkerInterval,
			BatchSize:   cfg.Publications.WorkerBatch,
			Lease:       cfg.Publications.WorkerLease,
			MaxAttempts: cfg.Publications.MaxAttempts,
		},
	})
	backgroundWorkers.Run(func() {
		publicationsRepository.StartWorker(ctx, logger)
	})
	publicationsHandler := publications.NewHandler(publicationsRepository)
	developmentsRepository := developments.NewRepository(postgres)
	backgroundWorkers.Run(func() {
		developmentsRepository.StartReservationExpirationWorker(ctx, logger, developments.ReservationExpirationWorkerConfig{
			Enabled:   cfg.Developments.ReservationExpirationWorkerEnabled,
			Interval:  cfg.Developments.ReservationExpirationWorkerInterval,
			BatchSize: cfg.Developments.ReservationExpirationWorkerBatch,
		})
	})
	developmentsHandler := developments.NewHandler(developmentsRepository)
	roundRobinHandler := roundrobin.NewHandler(roundrobin.NewRepository(postgres))
	scheduleHandler := schedule.NewHandler(schedule.NewRepository(postgres, gamificationRepository), realtimeHub)
	stageConfigHandler := stageconfig.NewHandler(stageconfig.NewRepository(postgres))
	settingsHandler := settings.NewHandler(settings.NewRepository(postgres, settings.ExternalConfig{
		ProjectURL:          cfg.Storage.ProjectURL,
		APIKey:              cfg.Storage.APIKey,
		ResendAPIKey:        cfg.Email.ResendAPIKey,
		FromEmail:           cfg.Email.FromEmail,
		ReplyTo:             cfg.Email.ReplyTo,
		SupportEmail:        cfg.Email.SupportEmail,
		AppURL:              cfg.Email.AppURL,
		VAPIDPublicKey:      cfg.Push.VAPIDPublicKey,
		AsaasURL:            cfg.Asaas.APIURL,
		AsaasAPIKey:         cfg.Asaas.APIKey,
		AsaasRequestTimeout: cfg.Asaas.RequestTimeout,
	}), realtimeHub)
	siteHandler := site.NewHandler(site.NewRepository(postgres, site.StorageConfig{
		ProjectURL: cfg.Storage.ProjectURL,
		APIKey:     cfg.Storage.APIKey,
	}), realtimeHub).WithPublicClientIPResolver(publicClientIPResolver)
	teamsHandler := teams.NewHandler(teams.NewRepository(postgres, teams.StorageConfig{
		ProjectURL: cfg.Storage.ProjectURL,
		APIKey:     cfg.Storage.APIKey,
	}))
	telemetryHandler := telemetry.NewHandler(telemetry.NewRepository(postgres))
	presenceHandler := presence.NewHandler(presence.NewRepository(postgres))
	usersHandler := users.NewHandler(users.NewRepository(postgres, users.AuthAdminConfig{
		ProjectURL: cfg.Storage.ProjectURL,
		APIKey:     cfg.Storage.APIKey,
	}), realtimeHub)
	automationsRepository := automations.NewRepository(postgres, automations.FunctionsConfig{
		ProjectURL: cfg.Storage.ProjectURL,
		APIKey:     cfg.Storage.APIKey,
	}, automations.StorageConfig{
		ProjectURL: cfg.Storage.ProjectURL,
		APIKey:     cfg.Storage.APIKey,
	})
	backgroundWorkers.Run(func() {
		automationsRepository.StartRuntimeWorker(ctx, logger, automations.WorkerConfig{
			Enabled:            cfg.Automations.RuntimeWorkerEnabled,
			RuntimeInterval:    cfg.Automations.RuntimeWorkerInterval,
			InactivityInterval: cfg.Automations.InactivityWorkerInterval,
			RunTimeout:         cfg.Automations.WorkerRunTimeout,
			LockTimeout:        cfg.Automations.WorkerLockTimeout,
		})
	})
	automationsHandler := automations.NewHandler(automationsRepository)
	whatsappHandler := whatsapp.NewHandler(whatsapp.NewRepository(postgres, gamificationRepository, whatsapp.StorageConfig{
		ProjectURL: cfg.Storage.ProjectURL,
		APIKey:     cfg.Storage.APIKey,
		EvolutionGo: whatsapp.EvolutionGoConfig{
			APIURL:                   cfg.EvolutionGo.APIURL,
			APIKey:                   cfg.EvolutionGo.APIKey,
			ImageDigest:              cfg.EvolutionGo.ImageDigest,
			WebhookURL:               cfg.EvolutionGo.WebhookURL,
			BackendWebhookURL:        cfg.EvolutionGo.BackendWebhookURL,
			WebhookProcessorMode:     cfg.EvolutionGo.WebhookProcessorMode,
			WebhookRolloutSessionIDs: cfg.EvolutionGo.WebhookRolloutSessionIDs,
		},
	}, realtimeHub)).WithAutoReply(aiService, cfg.AI.AutoReplyToken).WithWorkerConfig(whatsapp.WorkerConfig{
		AIWorkerEnabled:               cfg.WhatsApp.AIWorkerEnabled,
		AIWorkerInterval:              cfg.WhatsApp.AIWorkerInterval,
		AIFollowUpWorkerEnabled:       cfg.WhatsApp.AIFollowUpWorkerEnabled,
		AIFollowUpWorkerInterval:      cfg.WhatsApp.AIFollowUpWorkerInterval,
		OutboxWorkerEnabled:           cfg.WhatsApp.OutboxWorkerEnabled,
		OutboxWorkerInterval:          cfg.WhatsApp.OutboxWorkerInterval,
		OutboxWorkerBatch:             cfg.WhatsApp.OutboxWorkerBatch,
		OutboxWorkerConcurrency:       cfg.WhatsApp.OutboxWorkerConcurrency,
		WebhookWorkerEnabled:          cfg.WhatsApp.WebhookWorkerEnabled,
		WebhookWorkerInterval:         cfg.WhatsApp.WebhookWorkerInterval,
		WebhookWorkerBatch:            cfg.WhatsApp.WebhookWorkerBatch,
		WebhookWorkerConcurrency:      cfg.WhatsApp.WebhookWorkerConcurrency,
		MediaWorkerEnabled:            cfg.WhatsApp.MediaWorkerEnabled,
		MediaWorkerInterval:           cfg.WhatsApp.MediaWorkerInterval,
		MediaWorkerLease:              cfg.WhatsApp.MediaWorkerLease,
		MediaWorkerConcurrency:        cfg.WhatsApp.MediaWorkerConcurrency,
		SessionSupervisorEnabled:      cfg.WhatsApp.SessionSupervisorEnabled,
		SessionSupervisorInitialDelay: cfg.WhatsApp.SessionSupervisorInitialDelay,
		SessionSupervisorInterval:     cfg.WhatsApp.SessionSupervisorInterval,
		SessionSupervisorBatch:        cfg.WhatsApp.SessionSupervisorBatch,
		SessionSupervisorRecoveryIDs:  cfg.WhatsApp.SessionSupervisorRecoveryIDs,
	})
	whatsappRuntimeStats = whatsappHandler.RuntimeStats
	backgroundWorkers.Run(func() {
		whatsappHandler.StartAIWorker(ctx, logger)
	})
	backgroundWorkers.Run(func() {
		whatsappHandler.StartOutboxWorker(ctx, logger)
	})
	backgroundWorkers.Run(func() {
		whatsappHandler.StartWebhookWorker(ctx, logger)
	})
	backgroundWorkers.Run(func() {
		whatsappHandler.StartMediaWorker(ctx, logger)
	})
	backgroundWorkers.Run(func() {
		whatsappHandler.StartAvatarWorker(ctx, logger)
	})
	backgroundWorkers.Run(func() {
		whatsappHandler.StartSessionSupervisor(ctx, logger)
	})
	webhooksRepository := webhooks.NewRepository(postgres)
	backgroundWorkers.Run(func() {
		go webhooksRepository.StartDeliveryWorker(ctx, logger)
	})
	webhooksHandler := webhooks.NewHandler(webhooksRepository, realtimeHub).
		WithPublicClientIPResolver(publicClientIPResolver)
	publicAPIHandler := publicapi.NewHandler(
		publicapi.NewRepository(postgres),
		webhooksRepository,
	).WithPublicClientIPResolver(publicClientIPResolver)
	metaHandler := meta.NewHandler(meta.NewRepository(postgres, meta.Config{
		AppSecret:                               cfg.Meta.AppSecret,
		WebhookVerifyToken:                      cfg.Meta.WebhookVerifyToken,
		GraphVersion:                            cfg.Meta.GraphVersion,
		GraphBaseURL:                            cfg.Meta.GraphBaseURL,
		ConversionFeedbackWorkerEnabled:         cfg.Meta.ConversionFeedbackWorkerEnabled,
		ConversionFeedbackWorkerInterval:        cfg.Meta.ConversionFeedbackWorkerInterval,
		ConversionFeedbackWorkerBatch:           cfg.Meta.ConversionFeedbackWorkerBatch,
		ConversionFeedbackWorkerLease:           cfg.Meta.ConversionFeedbackWorkerLease,
		ConversionFeedbackRequestTimeout:        cfg.Meta.ConversionFeedbackRequestTimeout,
		ConversionFeedbackPartnerAgent:          cfg.Meta.ConversionFeedbackPartnerAgent,
		ConversionFeedbackAppSecretProofEnabled: cfg.Meta.ConversionFeedbackAppSecretProofEnabled,
	}), realtimeHub)
	backgroundWorkers.Run(func() {
		if cfg.Meta.WebhookWorkerEnabled {
			metaHandler.StartWebhookWorker(ctx, logger)
		}
	})
	backgroundWorkers.Run(func() {
		metaHandler.StartConversionFeedbackWorker(ctx, logger)
	})
	metaMarketingSyncHandler := meta.NewMarketingSyncHTTPHandler(meta.NewMarketingSyncService(postgres, meta.Config{
		AppSecret:    cfg.Meta.AppSecret,
		GraphVersion: cfg.Meta.GraphVersion,
		GraphBaseURL: cfg.Meta.GraphBaseURL,
	}, nil))
	integrationsHandler := integrations.NewHandler(integrations.NewRepository(postgres, integrations.ExternalConfig{
		ProjectURL:            cfg.Storage.ProjectURL,
		APIKey:                cfg.Storage.APIKey,
		ClientIPSigningSecret: cfg.Storage.EdgeClientIPSigningSecret,
		MetaAppSecret:         cfg.Meta.AppSecret,
		MetaGraphVersion:      cfg.Meta.GraphVersion,
		MetaGraphBaseURL:      cfg.Meta.GraphBaseURL,
	})).WithPublicClientIPResolver(publicClientIPResolver)
	metaOAuthActionHandler := http.HandlerFunc(metaOAuthUnavailable)
	metaOAuthCallbackHandler := http.HandlerFunc(metaOAuthUnavailable)
	if metaOAuthHandler != nil {
		metaOAuthActionHandler = metaOAuthHandler.Action
		metaOAuthCallbackHandler = metaOAuthHandler.Callback
	}
	portalsRepository := portals.NewRepository(postgres, portals.Config{
		WebhookSecret:              cfg.Portals.GrupoOLXWebhookSecret,
		ImportReportWorkerEnabled:  cfg.Portals.ImportReportWorkerEnabled,
		ImportReportWorkerInterval: cfg.Portals.ImportReportWorkerInterval,
		ImportReportWorkerBatch:    cfg.Portals.ImportReportWorkerBatch,
		ChavesNaMaoEnabled:         cfg.Portals.ChavesNaMaoEnabled,
	})
	backgroundWorkers.Run(func() {
		portalsRepository.StartImportReportWorker(ctx, logger)
	})
	portalsHandler := portals.NewHandler(portalsRepository).WithPublicClientIPResolver(publicClientIPResolver)

	registerRoutes(mux, routeDependencies{
		authVerifier:             authVerifier,
		tenantRepository:         tenantRepository,
		adminHandler:             adminHandler,
		aiHandler:                aiHandler,
		analyticsHandler:         analyticsHandler,
		attentionHandler:         attentionHandler,
		auditHandler:             auditHandler,
		automationsHandler:       automationsHandler,
		cadencesHandler:          cadencesHandler,
		developmentsHandler:      developmentsHandler,
		financialHandler:         financialHandler,
		gamificationHandler:      gamificationHandler,
		healthHandler:            healthHandler,
		helpHandler:              helpHandler,
		homeFocusHandler:         homeFocusHandler,
		integrationsHandler:      integrationsHandler,
		leadsHandler:             leadsHandler,
		meHandler:                meHandler,
		metaHandler:              metaHandler,
		metaMarketingSyncHandler: metaMarketingSyncHandler,
		metaOAuthActionHandler:   metaOAuthActionHandler,
		metaOAuthCallbackHandler: metaOAuthCallbackHandler,
		pipelinesHandler:         pipelinesHandler,
		portalsHandler:           portalsHandler,
		presenceHandler:          presenceHandler,
		propertiesHandler:        propertiesHandler,
		publicAPIHandler:         publicAPIHandler,
		publicationsHandler:      publicationsHandler,
		realtimeHandler:          realtimeHandler,
		roundRobinHandler:        roundRobinHandler,
		scheduleHandler:          scheduleHandler,
		settingsHandler:          settingsHandler,
		siteHandler:              siteHandler,
		stageConfigHandler:       stageConfigHandler,
		teamsHandler:             teamsHandler,
		telemetryHandler:         telemetryHandler,
		usersHandler:             usersHandler,
		webhooksHandler:          webhooksHandler,
		whatsappHandler:          whatsappHandler,
	})
	handler := httpserver.Chain(
		mux,
		httpserver.Recover(logger),
		httpserver.RequestID,
		httpserver.LogRequests(logger),
		httpserver.CORS(cfg.HTTP.CORSOrigins),
	)

	return &App{
		handler:  handler,
		db:       postgres,
		auth:     authVerifier,
		realtime: realtimeHub,
	}, nil
}

func metaOAuthUnavailable(w http.ResponseWriter, r *http.Request) {
	httpserver.WriteError(
		w,
		r,
		http.StatusServiceUnavailable,
		"meta_oauth_not_configured",
		"Meta OAuth is not configured on the backend.",
	)
}

func (app *App) Handler() http.Handler {
	return app.handler
}

func (app *App) Close() {
	if app.realtime != nil {
		app.realtime.Close()
	}

	if app.db != nil {
		app.db.Close()
	}

	if app.auth != nil {
		app.auth.Close()
	}
}
