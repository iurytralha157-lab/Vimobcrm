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
)

type functionsClient struct {
	projectURL string
	apiKey     string
	httpClient *http.Client
}

func newFunctionsClient(config StorageConfig) functionsClient {
	return functionsClient{
		projectURL: strings.TrimRight(strings.TrimSpace(config.ProjectURL), "/"),
		apiKey:     strings.TrimSpace(config.APIKey),
		httpClient: &http.Client{Timeout: 45 * time.Second},
	}
}

func (client functionsClient) webhookURL(functionName string) string {
	if client.projectURL == "" {
		return ""
	}

	return fmt.Sprintf("%s/functions/v1/%s", client.projectURL, url.PathEscape(functionName))
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
	body := map[string]any{"action": action}
	for key, value := range payload {
		body[key] = value
	}

	result, err := client.invoke(ctx, "evolution-go-proxy", body)
	if err != nil {
		return nil, err
	}
	if !providerResultOK(result) {
		return result, fmt.Errorf("%w: %s", ErrProviderFailed, providerErrorMessage(result, "Falha na Evolution Go."))
	}

	return result, nil
}
