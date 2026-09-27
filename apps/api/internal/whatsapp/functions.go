package whatsapp

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/evolutionroute"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/supabasehttp"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type functionsClient struct {
	projectURL                 string
	apiKey                     string
	evolutionGoAPIURL          string
	evolutionGoAPIKey          string
	evolutionCallMediaSecret   string
	evolutionGoImageDigest     string
	providerRoutes             evolutionroute.Config
	evolutionWebhookURL        string
	evolutionBackendWebhookURL string
	webhookProcessorMode       string
	webhookRolloutSessionIDs   []string
	db                         *dbpkg.Postgres
	httpClient                 *http.Client
	runtimeStats               *whatsappRuntimeCounters
}

func newFunctionsClient(config StorageConfig, db *dbpkg.Postgres) functionsClient {
	return functionsClient{
		projectURL:               strings.TrimRight(strings.TrimSpace(config.ProjectURL), "/"),
		apiKey:                   strings.TrimSpace(config.APIKey),
		evolutionGoAPIURL:        strings.TrimRight(strings.TrimSpace(config.EvolutionGo.APIURL), "/"),
		evolutionGoAPIKey:        strings.TrimSpace(config.EvolutionGo.APIKey),
		evolutionCallMediaSecret: strings.TrimSpace(config.EvolutionGo.CallMediaHMACSecret),
		evolutionGoImageDigest:   strings.ToLower(strings.TrimSpace(config.EvolutionGo.ImageDigest)),
		providerRoutes: evolutionroute.Config{
			Production: evolutionroute.Destination{
				APIURL:              strings.TrimRight(strings.TrimSpace(config.EvolutionGo.APIURL), "/"),
				APIKey:              strings.TrimSpace(config.EvolutionGo.APIKey),
				CallMediaHMACSecret: strings.TrimSpace(config.EvolutionGo.CallMediaHMACSecret),
				ImageDigest:         strings.ToLower(strings.TrimSpace(config.EvolutionGo.ImageDigest)),
			},
			Canary: evolutionroute.Destination{
				APIURL:              strings.TrimRight(strings.TrimSpace(config.EvolutionGo.CanaryAPIURL), "/"),
				APIKey:              strings.TrimSpace(config.EvolutionGo.CanaryAPIKey),
				CallMediaHMACSecret: strings.TrimSpace(config.EvolutionGo.CanaryCallMediaHMACSecret),
				ImageDigest:         strings.ToLower(strings.TrimSpace(config.EvolutionGo.CanaryImageDigest)),
			},
			CanarySessionIDs: append([]string(nil), config.EvolutionGo.CanarySessionIDs...),
		},
		evolutionWebhookURL:        strings.TrimRight(strings.TrimSpace(config.EvolutionGo.WebhookURL), "/"),
		evolutionBackendWebhookURL: strings.TrimRight(strings.TrimSpace(config.EvolutionGo.BackendWebhookURL), "/"),
		webhookProcessorMode:       strings.TrimSpace(config.EvolutionGo.WebhookProcessorMode),
		webhookRolloutSessionIDs:   canonicalWhatsAppSessionScope(config.EvolutionGo.WebhookRolloutSessionIDs),
		db:                         db,
		httpClient:                 newEvolutionHTTPClient(),
		runtimeStats:               &whatsappRuntimeCounters{},
	}
}

func (client functionsClient) providerForSession(sessionID string) (evolutionroute.Destination, error) {
	routes := client.providerRoutes
	if routes.Production.APIURL == "" && routes.Production.APIKey == "" {
		// Older unit callers instantiate functionsClient directly.
		routes.Production = evolutionroute.Destination{
			APIURL:              client.evolutionGoAPIURL,
			APIKey:              client.evolutionGoAPIKey,
			CallMediaHMACSecret: client.evolutionCallMediaSecret,
			ImageDigest:         client.evolutionGoImageDigest,
		}
	}
	return routes.ForSession(sessionID)
}

func (client functionsClient) forSession(sessionID string) (functionsClient, error) {
	destination, err := client.providerForSession(sessionID)
	if err != nil {
		return functionsClient{}, err
	}
	if client.providerRoutes.IsCanarySession(sessionID) {
		base := client.httpClient
		if base == nil {
			base = http.DefaultClient
		}
		redirectSafeClient := *base
		redirectSafeClient.CheckRedirect = func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		}
		client.httpClient = &redirectSafeClient
	}
	client.evolutionGoAPIURL = destination.APIURL
	client.evolutionGoAPIKey = destination.APIKey
	client.evolutionCallMediaSecret = destination.CallMediaHMACSecret
	client.evolutionGoImageDigest = destination.ImageDigest
	return client, nil
}

func canonicalWhatsAppSessionScope(values []string) []string {
	canonical := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if value == "*" {
			canonical = append(canonical, value)
			continue
		}
		if normalized, ok := normalizeUUID(value); ok {
			canonical = append(canonical, normalized)
			continue
		}
		canonical = append(canonical, value)
	}
	return canonical
}

func newEvolutionHTTPClient() *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	// Bound the reusable provider pool. This prevents a request burst from
	// creating an unbounded number of sockets while still allowing status probes
	// to progress independently from the serialized lifecycle lane.
	transport.MaxIdleConns = 32
	transport.MaxIdleConnsPerHost = 8
	transport.MaxConnsPerHost = 16
	transport.IdleConnTimeout = 90 * time.Second
	transport.TLSHandshakeTimeout = 10 * time.Second
	transport.ResponseHeaderTimeout = 15 * time.Second
	transport.ExpectContinueTimeout = time.Second

	return &http.Client{
		Transport: transport,
		Timeout:   30 * time.Second,
	}
}

func (client functionsClient) webhookURL(functionName string) string {
	if client.projectURL == "" {
		return ""
	}

	return fmt.Sprintf("%s/functions/v1/%s", client.projectURL, url.PathEscape(functionName))
}

func (client functionsClient) configuredEvolutionWebhookURL(sessionID string, instanceID string) string {
	baseURL := client.validEvolutionWebhookBaseURL()
	if baseURL == "" {
		return ""
	}

	endpoint, err := url.Parse(baseURL)
	if err != nil {
		return ""
	}
	query := endpoint.Query()
	// Webhook URLs are retained by the provider and logged by every proxy in
	// the request path. Strip every legacy credential name unconditionally;
	// only non-secret routing identifiers may be present in the callback URL.
	removeEvolutionWebhookQueryCredentials(query)
	query.Set("session_id", sessionID)
	query.Set("instance_id", instanceID)
	endpoint.RawQuery = query.Encode()

	return endpoint.String()
}

func (client functionsClient) validEvolutionWebhookBaseURL() string {
	if isDeadEvolutionWebhookURL(client.evolutionBackendWebhookURL) {
		return ""
	}
	return client.evolutionBackendWebhookURL
}

func (client functionsClient) validLegacyEvolutionWebhookBaseURL() string {
	if isDeadEvolutionWebhookURL(client.evolutionWebhookURL) {
		return client.webhookURL("evolution-go-webhook")
	}

	if client.evolutionWebhookURL != "" {
		return client.evolutionWebhookURL
	}

	return client.webhookURL("evolution-go-webhook")
}

func isDeadEvolutionWebhookURL(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" {
		return false
	}

	endpoint, err := url.Parse(value)
	if err != nil {
		return true
	}

	return endpoint.Host == "" || (endpoint.Scheme != "https" && endpoint.Scheme != "http")
}

func (client functionsClient) invoke(ctx context.Context, functionName string, body map[string]any) (map[string]any, error) {
	if client.projectURL == "" || client.apiKey == "" {
		return nil, fmt.Errorf("%w: Supabase functions are not configured", ErrProviderFailed)
	}

	payload, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}

	endpoint := client.webhookURL(functionName)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	supabasehttp.SetServiceAuth(request, client.apiKey)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")

	response, err := client.httpClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrProviderFailed, err)
	}
	defer response.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		message := strings.TrimSpace(string(raw))
		if message == "" {
			message = response.Status
		}
		return nil, fmt.Errorf("%w: %s", ErrProviderFailed, message)
	}

	out := map[string]any{}
	if len(raw) == 0 {
		return out, nil
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}

	return out, nil
}

func (client functionsClient) invokeEvolution(ctx context.Context, action string, payload map[string]any) (map[string]any, error) {
	// Provider operations are backend-owned. Never fall back to the legacy
	// Edge proxy: doing so would reintroduce a second authorization and history
	// path whenever the direct provider configuration is missing.
	result, err := client.invokeEvolutionDirect(ctx, action, payload)
	if err != nil {
		return nil, err
	}
	if !providerResultOK(result) {
		if evolutionAllowsProviderFailure(action) {
			return result, nil
		}
		return result, fmt.Errorf("%w: %s", ErrProviderFailed, providerErrorMessage(result, "Falha na Evolution Go."))
	}

	return result, nil
}
