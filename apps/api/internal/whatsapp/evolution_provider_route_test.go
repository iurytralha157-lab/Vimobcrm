package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/evolutionroute"
)

func TestEvolutionProviderDispatchKeepsProductionSessionsAndIsolatesCanary(t *testing.T) {
	const canarySession = "7ec1c269-e28a-41ca-82e7-237df52c550d"
	var productionRequests, canaryRequests atomic.Int32
	server := func(expectedKey string, counter *atomic.Int32) *httptest.Server {
		return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			counter.Add(1)
			if r.Header.Get("apikey") != expectedKey || r.URL.Path != "/instance/status" {
				t.Errorf("provider request used wrong route or credential: %s", r.URL.Path)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
		}))
	}
	production := server("production-key", &productionRequests)
	defer production.Close()
	canary := server("canary-key", &canaryRequests)
	defer canary.Close()

	client := functionsClient{
		evolutionGoAPIURL: production.URL,
		evolutionGoAPIKey: "production-key",
		httpClient:        production.Client(),
		runtimeStats:      &whatsappRuntimeCounters{},
		providerRoutes: evolutionroute.Config{
			Production: evolutionroute.Destination{APIURL: production.URL, APIKey: "production-key"},
			Canary: evolutionroute.Destination{
				APIURL: canary.URL, APIKey: "canary-key", CallMediaHMACSecret: strings.Repeat("c", 32),
				ImageDigest: "sha256:" + strings.Repeat("a", 64),
			},
			CanarySessionIDs: []string{canarySession},
		},
	}
	for _, sessionID := range []string{"42187162-cc3f-4945-afde-7af7b4483880", canarySession} {
		routed, err := client.forSession(sessionID)
		if err != nil {
			t.Fatal(err)
		}
		result, err := routed.evolutionFetch(context.Background(), http.MethodGet, "/instance/status", evolutionFetchOptions{UseGlobalAPIKey: true})
		if err != nil || !result.OK {
			t.Fatalf("session %s provider fetch: %+v, %v", sessionID, result, err)
		}
	}
	if productionRequests.Load() != 1 || canaryRequests.Load() != 1 {
		t.Fatalf("requests prod=%d canary=%d, want 1 each", productionRequests.Load(), canaryRequests.Load())
	}
	client.providerRoutes.Canary.APIKey = ""
	if _, err := client.forSession(canarySession); !errors.Is(err, evolutionroute.ErrCanaryUnavailable) {
		t.Fatalf("missing canary key must not fall through: %v", err)
	}
	if productionRequests.Load() != 1 || canaryRequests.Load() != 1 {
		t.Fatal("unavailable canary route sent a provider request")
	}
}

func TestCanaryMediaAndRecordingWorkerDoNotReachProductionProvider(t *testing.T) {
	const canarySession = "7ec1c269-e28a-41ca-82e7-237df52c550d"
	var productionRequests, canaryRequests, storageUploads atomic.Int32
	production := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		productionRequests.Add(1)
		_, _ = w.Write([]byte("production-media"))
	}))
	defer production.Close()
	canary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		canaryRequests.Add(1)
		if r.URL.Path == "/call/recording" {
			if r.Header.Get("apikey") != "canary-instance-token" || r.Header.Get("instanceId") != "canary-instance" {
				t.Error("recording worker sent unexpected provider credentials")
			}
			wav := make([]byte, 44)
			copy(wav, "RIFF")
			copy(wav[8:], "WAVE")
			_, _ = w.Write(wav)
			return
		}
		_, _ = w.Write([]byte("canary-media"))
	}))
	defer canary.Close()
	storage := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		storageUploads.Add(1)
		if r.URL.Path != "/storage/v1/object/whatsapp-call-recordings/org/"+canarySession+"/job/incoming.wav" {
			t.Errorf("unexpected recording storage path %q", r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer storage.Close()

	repo := Repository{
		storage: storageClient{projectURL: storage.URL, apiKey: "storage-key", httpClient: storage.Client()},
		functions: functionsClient{
			evolutionGoAPIURL: production.URL,
			evolutionGoAPIKey: "production-key",
			httpClient:        production.Client(),
			providerRoutes: evolutionroute.Config{
				Production: evolutionroute.Destination{APIURL: production.URL, APIKey: "production-key"},
				Canary: evolutionroute.Destination{
					APIURL: canary.URL, APIKey: "canary-key", CallMediaHMACSecret: strings.Repeat("c", 32),
					ImageDigest: "sha256:" + strings.Repeat("a", 64),
				},
				CanarySessionIDs: []string{canarySession},
			},
		},
	}
	media, err := repo.downloadWhatsAppMediaURLForSession(context.Background(), canarySession, canary.URL+"/media")
	if err != nil || string(media.bytes) != "canary-media" {
		t.Fatalf("canary media = %q, %v", media.bytes, err)
	}
	if _, err := repo.downloadWhatsAppMediaURLForSession(context.Background(), canarySession, production.URL+"/media"); err == nil {
		t.Fatal("canary media worker accepted the production provider origin")
	}
	if !repo.whatsappMediaURLIsDemonstrablyPlaintextForSession(canarySession, canary.URL+"/media") ||
		repo.whatsappMediaURLIsDemonstrablyPlaintextForSession(canarySession, production.URL+"/media") {
		t.Fatal("canary media origin classification used the production host")
	}
	job := callRecordingJob{ID: "job", OrganizationID: "org", SessionID: canarySession, ProviderCallID: "call"}
	path, err := repo.fetchAndStoreCallRecordingChannel(
		context.Background(), job,
		callRecordingChannel{Channel: "incoming", ContentType: "audio/wav", SizeBytes: 44},
		"canary-instance", "canary-instance-token",
	)
	if err != nil || path != "org/"+canarySession+"/job/incoming.wav" {
		t.Fatalf("recording transfer = %q, %v", path, err)
	}
	if productionRequests.Load() != 0 || canaryRequests.Load() != 2 || storageUploads.Load() != 1 {
		t.Fatalf("requests production=%d canary=%d storage=%d", productionRequests.Load(), canaryRequests.Load(), storageUploads.Load())
	}
	repo.functions.providerRoutes.Canary.APIKey = ""
	if _, err := repo.fetchAndStoreCallRecordingChannel(
		context.Background(), job,
		callRecordingChannel{Channel: "incoming", ContentType: "audio/wav", SizeBytes: 44},
		"canary-instance", "canary-instance-token",
	); !errors.Is(err, evolutionroute.ErrCanaryUnavailable) {
		t.Fatalf("missing canary worker route did not fail closed: %v", err)
	}
	if productionRequests.Load() != 0 || canaryRequests.Load() != 2 || storageUploads.Load() != 1 {
		t.Fatal("unavailable canary route sent a media or storage request")
	}
}

func TestCanaryProviderRequestDoesNotFollowRedirectWithAPIKey(t *testing.T) {
	const canarySession = "7ec1c269-e28a-41ca-82e7-237df52c550d"
	var productionRequests atomic.Int32
	production := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		productionRequests.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	defer production.Close()
	canary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, production.URL+"/instance/status", http.StatusFound)
	}))
	defer canary.Close()
	client := functionsClient{
		httpClient:   canary.Client(),
		runtimeStats: &whatsappRuntimeCounters{},
		providerRoutes: evolutionroute.Config{
			Production: evolutionroute.Destination{APIURL: production.URL, APIKey: "production-key"},
			Canary: evolutionroute.Destination{
				APIURL: canary.URL, APIKey: "canary-key", CallMediaHMACSecret: strings.Repeat("c", 32),
				ImageDigest: "sha256:" + strings.Repeat("a", 64),
			},
			CanarySessionIDs: []string{canarySession},
		},
	}
	routed, err := client.forSession(canarySession)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = routed.evolutionFetch(context.Background(), http.MethodGet, "/instance/status", evolutionFetchOptions{UseGlobalAPIKey: true})
	if productionRequests.Load() != 0 {
		t.Fatal("canary API key was forwarded to a redirect destination")
	}
}
