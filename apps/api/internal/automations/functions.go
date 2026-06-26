package automations

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

type FunctionsConfig struct {
	ProjectURL string
	APIKey     string
}

type functionsClient struct {
	projectURL string
	apiKey     string
	httpClient *http.Client
}

func newFunctionsClient(config FunctionsConfig) functionsClient {
	return functionsClient{
		projectURL: strings.TrimRight(strings.TrimSpace(config.ProjectURL), "/"),
		apiKey:     strings.TrimSpace(config.APIKey),
		httpClient: &http.Client{Timeout: 45 * time.Second},
	}
}

func (client functionsClient) invoke(ctx context.Context, functionName string, body map[string]any) error {
	if client.projectURL == "" || client.apiKey == "" {
		return fmt.Errorf("supabase functions are not configured")
	}

	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}

	endpoint := fmt.Sprintf("%s/functions/v1/%s", client.projectURL, url.PathEscape(functionName))
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	request.Header.Set("apikey", client.apiKey)
	request.Header.Set("Authorization", "Bearer "+client.apiKey)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")

	response, err := client.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		message := strings.TrimSpace(string(raw))
		if message == "" {
			message = response.Status
		}
		return fmt.Errorf("supabase function %s failed: %s", functionName, message)
	}

	return nil
}
