package app

import (
	"os"
	"strings"
	"testing"
)

func TestAppStartsWhatsAppMediaWorkerExactlyOnce(t *testing.T) {
	raw, err := os.ReadFile("app.go")
	if err != nil {
		t.Fatal(err)
	}
	if count := strings.Count(string(raw), "whatsappHandler.StartMediaWorker"); count != 1 {
		t.Fatalf("StartMediaWorker occurrences = %d, want 1", count)
	}
}

func TestAppPreflightsMediaWorkerDatabaseBeforeStartingWorkers(t *testing.T) {
	raw, err := os.ReadFile("app.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	preflightIndex := strings.Index(source, "whatsapp.ValidateMediaWorkerDatabasePrivileges")
	firstWorkerIndex := strings.Index(source, ".StartWorker(ctx, logger)")
	if preflightIndex < 0 {
		t.Fatal("media worker database privilege preflight is missing from app.New")
	}
	if firstWorkerIndex < 0 || preflightIndex >= firstWorkerIndex {
		t.Fatalf("media privilege preflight index=%d, first worker index=%d", preflightIndex, firstWorkerIndex)
	}
	if !strings.Contains(source[:firstWorkerIndex], "if cfg.WhatsApp.MediaWorkerEnabled") {
		t.Fatal("media privilege preflight must run only when the media worker is enabled")
	}
}
