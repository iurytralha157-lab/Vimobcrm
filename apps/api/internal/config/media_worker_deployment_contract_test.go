package config

import (
	"os"
	"strings"
	"testing"
)

func TestProductionStacksProvideDisabledSerializedWhatsAppMediaWorker(t *testing.T) {
	for _, path := range []string{
		"../../../../deploy/portainer-stack.yml",
		"../../../../deploy/portainer-stack.build.yml",
	} {
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		stack := string(raw)
		for _, expected := range []string{
			`WHATSAPP_MEDIA_WORKER_ENABLED: ${WHATSAPP_MEDIA_WORKER_ENABLED:-false}`,
			`WHATSAPP_MEDIA_WORKER_INTERVAL: ${WHATSAPP_MEDIA_WORKER_INTERVAL:-2s}`,
			`WHATSAPP_MEDIA_WORKER_LEASE: ${WHATSAPP_MEDIA_WORKER_LEASE:-5m}`,
			`WHATSAPP_MEDIA_WORKER_SESSION_IDS: ${WHATSAPP_MEDIA_WORKER_SESSION_IDS:-}`,
		} {
			if !strings.Contains(stack, expected) {
				t.Fatalf("%s does not provide %q", path, expected)
			}
		}
	}

	raw, err := os.ReadFile("../../../../.env.example")
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{
		"WHATSAPP_MEDIA_WORKER_ENABLED=false",
		"WHATSAPP_MEDIA_WORKER_INTERVAL=2s",
		"WHATSAPP_MEDIA_WORKER_LEASE=5m",
		"WHATSAPP_MEDIA_WORKER_SESSION_IDS=",
	} {
		if !strings.Contains(string(raw), expected) {
			t.Fatalf(".env.example does not provide %q", expected)
		}
	}
}
