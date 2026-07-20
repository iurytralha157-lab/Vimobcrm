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

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type functionsClient struct {
	projectURL                 string
	apiKey                     string
	evolutionGoAPIURL          string
	evolutionGoAPIKey          string
	evolutionWebhookURL        string
	evolutionBackendWebhookURL string
	webhookProcessorMode       string
	webhookRolloutSessionIDs   []string
	db                         *dbpkg.Postgres
	httpClient                 *http.Client
}

func newFunctionsClient(config StorageConfig, db *dbpkg.Postgres) functionsClient {
	return functionsClient{
		projectURL:                 strings.TrimRight(strings.TrimSpace(config.ProjectURL), "/"),
		apiKey:                     strings.TrimSpace(config.APIKey),
		evolutionGoAPIURL:          strings.TrimRight(strings.TrimSpace(config.EvolutionGo.APIURL), "/"),
		evolutionGoAPIKey:          strings.TrimSpace(config.EvolutionGo.APIKey),
		evolutionWebhookURL:        strings.TrimRight(strings.TrimSpace(config.EvolutionGo.WebhookURL), "/"),
		evolutionBackendWebhookURL: strings.TrimRight(strings.TrimSpace(config.EvolutionGo.BackendWebhookURL), "/"),
		webhookProcessorMode:       strings.TrimSpace(config.EvolutionGo.WebhookProcessorMode),
		webhookRolloutSessionIDs:   append([]string(nil), config.EvolutionGo.WebhookRolloutSessionIDs...),
		db:                         db,
		httpClient:                 &http.Client{Timeout: 45 * time.Second},
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
	request.Header.Set("apikey", client.apiKey)
	request.Header.Set("Authorization", "Bearer "+client.apiKey)
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
	if client.evolutionGoAPIURL == "" || client.evolutionGoAPIKey == "" {
		return nil, fmt.Errorf("%w: Evolution Go direta nao configurada", ErrProviderFailed)
	}

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
