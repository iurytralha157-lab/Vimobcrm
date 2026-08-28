package admin

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSendAuthPasswordRecoveryUsesEmailFlowWithoutPassword(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost {
			t.Errorf("method = %q, want POST", request.Method)
		}
		if request.URL.Path != "/auth/v1/recover" {
			t.Errorf("path = %q, want Auth recovery endpoint", request.URL.Path)
		}
		if request.URL.Query().Get("redirect_to") != "https://app.vimobcrm.com.br/reset-password" {
			t.Errorf("redirect_to = %q", request.URL.Query().Get("redirect_to"))
		}
		if request.Header.Get("apikey") != "sb_secret_recovery_test" || request.Header.Get("Authorization") != "" {
			t.Error("trusted Auth headers were not sent")
		}

		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatalf("decode recovery payload: %v", err)
		}
		if body["email"] != "user@example.com" {
			t.Errorf("email = %#v", body["email"])
		}
		if _, hasPassword := body["password"]; hasPassword {
			t.Fatal("password recovery payload must never transport a password")
		}
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(`{}`))
	}))
	defer server.Close()

	repo := NewRepository(nil, ExternalConfig{
		ProjectURL: server.URL,
		APIKey:     "sb_secret_recovery_test",
		AppURL:     "https://app.vimobcrm.com.br",
	})
	if err := repo.sendAuthPasswordRecovery(context.Background(), " user@example.com "); err != nil {
		t.Fatalf("sendAuthPasswordRecovery() error = %v", err)
	}
}

func TestSendAuthPasswordRecoveryReportsProviderFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		http.Error(response, `{"message":"smtp unavailable"}`, http.StatusBadGateway)
	}))
	defer server.Close()

	repo := NewRepository(nil, ExternalConfig{
		ProjectURL: server.URL,
		APIKey:     "service-key",
		AppURL:     "https://app.vimobcrm.com.br",
	})
	err := repo.sendAuthPasswordRecovery(context.Background(), "user@example.com")
	if !errors.Is(err, ErrPasswordRecoveryEmailFailed) {
		t.Fatalf("error = %v, want ErrPasswordRecoveryEmailFailed", err)
	}
}
