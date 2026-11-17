package config

import (
	"fmt"
	"strings"
	"testing"
)

func TestWebhookBacklogConcurrencyDefaultsAutoAndRejectsInvalidSettings(t *testing.T) {
	for _, test := range []struct {
		raw   string
		total int
		want  int
		valid bool
	}{
		{"", 16, 0, true}, {"0", 16, 0, true}, {" 8 ", 16, 8, true},
		{"1", 2, 1, true}, {"15", 16, 15, true}, {"0", 1, 0, true},
		{"1", 1, 1, false}, {"16", 16, 16, false}, {"17", 16, 17, false},
		{"-1", 16, -1, false}, {"8.5", 16, -1, false}, {"invalid", 16, -1, false},
		{"999999999999999999999", 16, -1, false},
	} {
		t.Run(fmt.Sprintf("total=%d/raw=%q", test.total, test.raw), func(t *testing.T) {
			t.Setenv("WHATSAPP_WEBHOOK_WORKER_BACKLOG_CONCURRENCY", test.raw)
			value := loadWhatsAppWebhookBacklogConcurrency()
			if value != test.want {
				t.Fatalf("loaded concurrency=%d, want %d", value, test.want)
			}
			cfg := validConfigForWebhookRolloutTest()
			cfg.WhatsApp.WebhookWorkerEnabled = true
			cfg.WhatsApp.WebhookWorkerConcurrency = test.total
			cfg.WhatsApp.WebhookWorkerBacklogConcurrency = value
			err := cfg.Validate()
			if test.valid && err != nil {
				t.Fatalf("valid split rejected: %v", err)
			}
			if !test.valid && (err == nil || !strings.Contains(err.Error(), "WHATSAPP_WEBHOOK_WORKER_BACKLOG_CONCURRENCY must be 0")) {
				t.Fatalf("invalid split accepted or wrong error: %v", err)
			}
		})
	}
}
