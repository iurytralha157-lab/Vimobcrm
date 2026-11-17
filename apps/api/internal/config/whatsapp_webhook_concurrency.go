package config

import (
	"errors"
	"os"
	"strconv"
	"strings"
)

func loadWhatsAppWebhookBacklogConcurrency() int {
	raw := strings.TrimSpace(os.Getenv("WHATSAPP_WEBHOOK_WORKER_BACKLOG_CONCURRENCY"))
	if raw == "" {
		return 0
	}
	value, err := strconv.ParseInt(raw, 10, 32)
	if err != nil {
		// Validation rejects malformed settings instead of silently using auto.
		return -1
	}
	return int(value)
}

func validateWhatsAppWebhookBacklogConcurrency(total, backlog int) error {
	if backlog < 0 || (backlog > 0 && (total < 2 || backlog >= total)) {
		return errors.New("WHATSAPP_WEBHOOK_WORKER_BACKLOG_CONCURRENCY must be 0 (auto) or between 1 and WHATSAPP_WEBHOOK_WORKER_CONCURRENCY-1")
	}
	return nil
}
