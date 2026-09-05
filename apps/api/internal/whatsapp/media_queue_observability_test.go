package whatsapp

import (
	"database/sql"
	"strings"
	"testing"
	"time"
)

func TestWhatsAppMediaQueueMetricsQueryIsReadOnlyAndComplete(t *testing.T) {
	normalized := strings.ToLower(whatsappMediaQueueMetricsSQL)
	for _, required := range []string{
		"status = 'pending'",
		"min(created_at)",
		"status = 'processing'",
		"completed_last_5m",
		"failed_last_5m",
		"private.whatsapp_media_worker_state",
		"where state.singleton = true",
		"breaker_open",
	} {
		if !strings.Contains(normalized, required) {
			t.Fatalf("metrics query does not contain %q", required)
		}
	}
	for _, mutation := range []string{"insert ", "update ", "delete ", "truncate ", " for update"} {
		if strings.Contains(normalized, mutation) {
			t.Fatalf("metrics query must remain read-only; found %q", mutation)
		}
	}
}

func TestWhatsAppMediaQueueOldestAgeSeconds(t *testing.T) {
	now := time.Date(2026, time.September, 5, 0, 0, 0, 0, time.UTC)
	if got := whatsappMediaQueueOldestAgeSeconds(now, sql.NullTime{}); got != 0 {
		t.Fatalf("missing oldest age = %d, want 0", got)
	}
	if got := whatsappMediaQueueOldestAgeSeconds(now, sql.NullTime{Time: now.Add(time.Second), Valid: true}); got != 0 {
		t.Fatalf("future oldest age = %d, want 0", got)
	}
	if got := whatsappMediaQueueOldestAgeSeconds(now, sql.NullTime{Time: now.Add(-95 * time.Second), Valid: true}); got != 95 {
		t.Fatalf("oldest age = %d, want 95", got)
	}
}
