package whatsapp

import "time"

const (
	defaultAIWorkerInterval                      = time.Minute
	defaultAIFollowUpWorkerInterval              = 10 * time.Minute
	defaultWhatsAppOutboxWorkerInterval          = time.Second
	defaultWhatsAppOutboxWorkerBatch             = 10
	defaultWhatsAppOutboxWorkerConcurrency       = 4
	maxWhatsAppOutboxWorkerConcurrency           = 16
	defaultWhatsAppWebhookWorkerInterval         = time.Second
	defaultWhatsAppWebhookWorkerBatch            = 10
	defaultWhatsAppWebhookWorkerConcurrency      = 4
	maxWhatsAppWebhookWorkerConcurrency          = 16
	defaultWhatsAppMediaWorkerInterval           = 2 * time.Second
	defaultWhatsAppMediaWorkerLease              = 5 * time.Minute
	defaultWhatsAppMediaWorkerConcurrency        = 4
	maxWhatsAppMediaWorkerConcurrency            = 16
	defaultWhatsAppSessionSupervisorInitialDelay = 30 * time.Second
	defaultWhatsAppSessionSupervisorInterval     = time.Minute
	defaultWhatsAppSessionSupervisorBatch        = 50
)

type WorkerConfig struct {
	AIWorkerEnabled               bool
	AIWorkerInterval              time.Duration
	AIFollowUpWorkerEnabled       bool
	AIFollowUpWorkerInterval      time.Duration
	OutboxWorkerEnabled           bool
	OutboxWorkerInterval          time.Duration
	OutboxWorkerBatch             int
	OutboxWorkerConcurrency       int
	WebhookWorkerEnabled          bool
	WebhookWorkerInterval         time.Duration
	WebhookWorkerBatch            int
	WebhookWorkerConcurrency      int
	MediaWorkerEnabled            bool
	MediaWorkerInterval           time.Duration
	MediaWorkerLease              time.Duration
	MediaWorkerConcurrency        int
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
		OutboxWorkerConcurrency:       defaultWhatsAppOutboxWorkerConcurrency,
		WebhookWorkerEnabled:          true,
		WebhookWorkerInterval:         defaultWhatsAppWebhookWorkerInterval,
		WebhookWorkerBatch:            defaultWhatsAppWebhookWorkerBatch,
		WebhookWorkerConcurrency:      defaultWhatsAppWebhookWorkerConcurrency,
		MediaWorkerEnabled:            false,
		MediaWorkerInterval:           defaultWhatsAppMediaWorkerInterval,
		MediaWorkerLease:              defaultWhatsAppMediaWorkerLease,
		MediaWorkerConcurrency:        defaultWhatsAppMediaWorkerConcurrency,
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
	config.OutboxWorkerConcurrency = normalizeOutboxWorkerConcurrency(config.OutboxWorkerConcurrency)
	if config.WebhookWorkerInterval <= 0 {
		config.WebhookWorkerInterval = defaults.WebhookWorkerInterval
	}
	if config.WebhookWorkerBatch <= 0 || config.WebhookWorkerBatch > 100 {
		config.WebhookWorkerBatch = defaults.WebhookWorkerBatch
	}
	config.WebhookWorkerConcurrency = normalizeWebhookWorkerConcurrency(config.WebhookWorkerConcurrency)
	if config.MediaWorkerInterval <= 0 {
		config.MediaWorkerInterval = defaults.MediaWorkerInterval
	}
	if config.MediaWorkerLease < 30*time.Second || config.MediaWorkerLease > 30*time.Minute {
		config.MediaWorkerLease = defaults.MediaWorkerLease
	}
	config.MediaWorkerConcurrency = normalizeMediaWorkerConcurrency(config.MediaWorkerConcurrency)
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

func normalizeOutboxWorkerConcurrency(value int) int {
	if value < 1 || value > maxWhatsAppOutboxWorkerConcurrency {
		return defaultWhatsAppOutboxWorkerConcurrency
	}
	return value
}

func normalizeWebhookWorkerConcurrency(value int) int {
	if value <= 0 || value > maxWhatsAppWebhookWorkerConcurrency {
		return defaultWhatsAppWebhookWorkerConcurrency
	}
	return value
}

func normalizeMediaWorkerConcurrency(value int) int {
	if value < 1 || value > maxWhatsAppMediaWorkerConcurrency {
		return defaultWhatsAppMediaWorkerConcurrency
	}
	return value
}

func normalizeWorkerBatch(value int, fallback int) int {
	if value <= 0 || value > 100 {
		return fallback
	}
	return value
}
