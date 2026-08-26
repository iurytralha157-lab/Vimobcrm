package whatsapp

import "time"

const (
	defaultAIWorkerInterval                      = time.Minute
	defaultAIFollowUpWorkerInterval              = 10 * time.Minute
	defaultWhatsAppOutboxWorkerInterval          = time.Second
	defaultWhatsAppOutboxWorkerBatch             = 5
	defaultWhatsAppWebhookWorkerInterval         = time.Second
	defaultWhatsAppWebhookWorkerBatch            = 5
	defaultWhatsAppWebhookWorkerConcurrency      = 4
	maxWhatsAppWebhookWorkerConcurrency          = 16
	defaultWhatsAppSessionSupervisorInitialDelay = 30 * time.Second
	defaultWhatsAppSessionSupervisorInterval     = time.Minute
	defaultWhatsAppSessionSupervisorBatch        = 10
)

type WorkerConfig struct {
	AIWorkerEnabled               bool
	AIWorkerInterval              time.Duration
	AIFollowUpWorkerEnabled       bool
	AIFollowUpWorkerInterval      time.Duration
	OutboxWorkerEnabled           bool
	OutboxWorkerInterval          time.Duration
	OutboxWorkerBatch             int
	WebhookWorkerEnabled          bool
	WebhookWorkerInterval         time.Duration
	WebhookWorkerBatch            int
	WebhookWorkerConcurrency      int
	SessionSupervisorEnabled      bool
	SessionSupervisorInitialDelay time.Duration
	SessionSupervisorInterval     time.Duration
	SessionSupervisorBatch        int
	SessionSupervisorRecoveryIDs  []string
}

func DefaultWorkerConfig() WorkerConfig {
	return WorkerConfig{
		AIWorkerEnabled:               true,
		AIWorkerInterval:              defaultAIWorkerInterval,
		AIFollowUpWorkerEnabled:       true,
		AIFollowUpWorkerInterval:      defaultAIFollowUpWorkerInterval,
		OutboxWorkerEnabled:           true,
		OutboxWorkerInterval:          defaultWhatsAppOutboxWorkerInterval,
		OutboxWorkerBatch:             defaultWhatsAppOutboxWorkerBatch,
		WebhookWorkerEnabled:          true,
		WebhookWorkerInterval:         defaultWhatsAppWebhookWorkerInterval,
		WebhookWorkerBatch:            defaultWhatsAppWebhookWorkerBatch,
		WebhookWorkerConcurrency:      defaultWhatsAppWebhookWorkerConcurrency,
		SessionSupervisorEnabled:      true,
		SessionSupervisorInitialDelay: defaultWhatsAppSessionSupervisorInitialDelay,
		SessionSupervisorInterval:     defaultWhatsAppSessionSupervisorInterval,
		SessionSupervisorBatch:        defaultWhatsAppSessionSupervisorBatch,
		SessionSupervisorRecoveryIDs:  nil,
	}
}

func (config WorkerConfig) normalized() WorkerConfig {
	defaults := DefaultWorkerConfig()

	if config.AIWorkerInterval <= 0 {
		config.AIWorkerInterval = defaults.AIWorkerInterval
	}
	if config.AIFollowUpWorkerInterval <= 0 {
		config.AIFollowUpWorkerInterval = defaults.AIFollowUpWorkerInterval
	}
	if config.OutboxWorkerInterval <= 0 {
		config.OutboxWorkerInterval = defaults.OutboxWorkerInterval
	}
	if config.OutboxWorkerBatch <= 0 || config.OutboxWorkerBatch > 100 {
		config.OutboxWorkerBatch = defaults.OutboxWorkerBatch
	}
	if config.WebhookWorkerInterval <= 0 {
		config.WebhookWorkerInterval = defaults.WebhookWorkerInterval
	}
	if config.WebhookWorkerBatch <= 0 || config.WebhookWorkerBatch > 100 {
		config.WebhookWorkerBatch = defaults.WebhookWorkerBatch
	}
	config.WebhookWorkerConcurrency = normalizeWebhookWorkerConcurrency(config.WebhookWorkerConcurrency)
	if config.SessionSupervisorInitialDelay <= 0 {
		config.SessionSupervisorInitialDelay = defaults.SessionSupervisorInitialDelay
	}
	if config.SessionSupervisorInterval <= 0 {
		config.SessionSupervisorInterval = defaults.SessionSupervisorInterval
	}
	if config.SessionSupervisorBatch <= 0 || config.SessionSupervisorBatch > 100 {
		config.SessionSupervisorBatch = defaults.SessionSupervisorBatch
	}

	return config
}

func normalizeWebhookWorkerConcurrency(value int) int {
	if value <= 0 || value > maxWhatsAppWebhookWorkerConcurrency {
		return defaultWhatsAppWebhookWorkerConcurrency
	}
	return value
}

func normalizeWorkerBatch(value int, fallback int) int {
	if value <= 0 || value > 100 {
		return fallback
	}
	return value
}
