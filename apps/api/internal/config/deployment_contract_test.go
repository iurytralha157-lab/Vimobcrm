package config

import (
	"os"
	"strings"
	"testing"
)

func TestProductionStacksProvidePublicPublicationOriginToAPI(t *testing.T) {
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
			`API_TRUSTED_PROXY_CIDRS: ${API_TRUSTED_PROXY_CIDRS:?API_TRUSTED_PROXY_CIDRS is required in production}`,
			`RESEND_API_KEY: ${RESEND_API_KEY:?RESEND_API_KEY is required for transactional email}`,
			`RESEND_WEBHOOK_SECRET: ${RESEND_WEBHOOK_SECRET:?RESEND_WEBHOOK_SECRET is required for verified Resend webhooks}`,
			`VIMOB_API_URL: ${VIMOB_API_URL:-https://api.vimobcrm.com.br}`,
			`NEXT_PUBLIC_VIMOB_API_URL: ${NEXT_PUBLIC_VIMOB_API_URL:-https://api.vimobcrm.com.br}`,
			`GRUPO_OLX_WEBHOOK_SECRET: ${GRUPO_OLX_WEBHOOK_SECRET}`,
			`SUPABASE_SECRET_KEY: ${SUPABASE_SECRET_KEY:-}`,
			`BILLING_EDGE_CLIENT_IP_SIGNING_SECRET: ${BILLING_EDGE_CLIENT_IP_SIGNING_SECRET:?BILLING_EDGE_CLIENT_IP_SIGNING_SECRET is required for billing checkout}`,
		} {
			if !strings.Contains(stack, expected) {
				t.Fatalf("%s does not provide %q", path, expected)
			}
		}
	}
}

func TestDatabasePoolDefaultsPreserveSharedSessionCapacity(t *testing.T) {
	contracts := map[string]string{
		"../../../../deploy/portainer-stack.yml":       `DATABASE_MAX_CONNS: ${DATABASE_MAX_CONNS:-8}`,
		"../../../../deploy/portainer-stack.build.yml": `DATABASE_MAX_CONNS: ${DATABASE_MAX_CONNS:-8}`,
		"../../../../.env.example":                     `DATABASE_MAX_CONNS=8`,
		"config.go":                                    `parseInt("DATABASE_MAX_CONNS", 8)`,
	}

	for path, expected := range contracts {
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		if !strings.Contains(string(raw), expected) {
			t.Fatalf("%s does not preserve the bounded pool default %q", path, expected)
		}
	}
}

func TestProductionStacksExposeBoundedWhatsAppMediaWorker(t *testing.T) {
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
			`WHATSAPP_MEDIA_WORKER_CONCURRENCY: ${WHATSAPP_MEDIA_WORKER_CONCURRENCY:-4}`,
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
		"WHATSAPP_MEDIA_WORKER_CONCURRENCY=4",
	} {
		if !strings.Contains(string(raw), expected) {
			t.Fatalf(".env.example does not provide %q", expected)
		}
	}
}

func TestProductionWebIngressCannotBypassTheForwardingProxy(t *testing.T) {
	swarmRaw, err := os.ReadFile("../../../../deploy/portainer-stack.yml")
	if err != nil {
		t.Fatal(err)
	}
	swarmWeb, _, found := strings.Cut(string(swarmRaw), "\n  api:")
	if !found {
		t.Fatal("could not isolate the Swarm web service")
	}
	if strings.Contains(swarmWeb, "\n    ports:") {
		t.Fatal("the Swarm web service must be reachable only through Traefik")
	}
	_, swarmAPI, found := strings.Cut(string(swarmRaw), "\n  api:")
	if !found {
		t.Fatal("could not isolate the Swarm API service")
	}
	if strings.Contains(swarmAPI, "\n    ports:") {
		t.Fatal("the Swarm API service must be reachable only through Traefik")
	}

	composeRaw, err := os.ReadFile("../../../../deploy/portainer-stack.build.yml")
	if err != nil {
		t.Fatal(err)
	}
	composeWeb, _, found := strings.Cut(string(composeRaw), "\n  api:")
	if !found {
		t.Fatal("could not isolate the Compose web service")
	}
	if !strings.Contains(composeWeb, `127.0.0.1:${WEB_PORT:-3000}:3000`) {
		t.Fatal("the standalone web port must be bound to loopback")
	}
	_, composeAPI, found := strings.Cut(string(composeRaw), "\n  api:")
	if !found {
		t.Fatal("could not isolate the Compose API service")
	}
	if !strings.Contains(composeAPI, `127.0.0.1:${API_PUBLIC_PORT:-8081}:8081`) {
		t.Fatal("the standalone API port must be bound to loopback")
	}
}
