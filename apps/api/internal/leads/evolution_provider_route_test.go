package leads

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/evolutionroute"
)

func TestNotificationSendUsesSessionProviderRoute(t *testing.T) {
	const canarySession = "7ec1c269-e28a-41ca-82e7-237df52c550d"
	var productionRequests, canaryRequests atomic.Int32
	server := func(expectedKey string, counter *atomic.Int32) *httptest.Server {
		return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			counter.Add(1)
			if r.URL.Path != "/send/text" || r.Header.Get("apikey") != expectedKey {
				t.Errorf("notification used wrong provider route or key")
			}
			var payload struct {
				ID string `json:"id"`
			}
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Error(err)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"key": map[string]any{"id": payload.ID}}})
		}))
	}
	production := server("production-key", &productionRequests)
	defer production.Close()
	canary := server("canary-key", &canaryRequests)
	defer canary.Close()
	repo := Repository{
		evolutionGoAPIURL: production.URL,
		evolutionGoAPIKey: "production-key",
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
		result, err := repo.dispatchWhatsAppViaEvolutionGoWithClient(
			context.Background(), notificationWhatsAppSession{ID: sessionID, InstanceKey: "test-sender"},
			"5511999999999", "teste", "evolution_go_org_session", "message-"+sessionID, nil,
		)
		if err != nil || !result.OK {
			t.Fatalf("session %s notification: %+v, %v", sessionID, result, err)
		}
	}
	if productionRequests.Load() != 1 || canaryRequests.Load() != 1 {
		t.Fatalf("requests prod=%d canary=%d, want 1 each", productionRequests.Load(), canaryRequests.Load())
	}
	repo.providerRoutes.Canary.APIKey = ""
	if _, err := repo.dispatchWhatsAppViaEvolutionGoWithClient(
		context.Background(), notificationWhatsAppSession{ID: canarySession, InstanceKey: "test-sender"},
		"5511999999999", "teste", "evolution_go_org_session", "blocked-canary", nil,
	); err == nil {
		t.Fatal("missing canary route must fail")
	}
	if productionRequests.Load() != 1 || canaryRequests.Load() != 1 {
		t.Fatal("unavailable canary route sent a notification")
	}
}

func TestCanaryNotificationDoesNotFollowRedirectWithInstanceToken(t *testing.T) {
	const canarySession = "7ec1c269-e28a-41ca-82e7-237df52c550d"
	var productionRequests atomic.Int32
	production := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		productionRequests.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	defer production.Close()
	canary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, production.URL+"/send/text", http.StatusFound)
	}))
	defer canary.Close()
	repo := Repository{providerRoutes: evolutionroute.Config{
		Production: evolutionroute.Destination{APIURL: production.URL, APIKey: "production-key"},
		Canary: evolutionroute.Destination{
			APIURL: canary.URL, APIKey: "canary-key", CallMediaHMACSecret: strings.Repeat("c", 32),
			ImageDigest: "sha256:" + strings.Repeat("a", 64),
		},
		CanarySessionIDs: []string{canarySession},
	}}
	_, _ = repo.dispatchWhatsAppViaEvolutionGoWithClient(
		context.Background(), notificationWhatsAppSession{ID: canarySession, InstanceKey: "test-sender", Token: "canary-instance-token"},
		"5511999999999", "teste", "evolution_go_org_session", "blocked-redirect", canary.Client(),
	)
	if productionRequests.Load() != 0 {
		t.Fatal("canary instance token was forwarded to a redirect destination")
	}
}
