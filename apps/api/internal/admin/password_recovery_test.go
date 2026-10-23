package admin

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRequestAdminPasswordRecoveryRecordsRequestOnlyAfterAuthAcceptance(t *testing.T) {
	callOrder := make([]string, 0, 2)
	err := requestAdminPasswordRecovery(
		context.Background(), "user@example.com", "admin-id", "target-id",
		func(_ context.Context, email string) error {
			callOrder = append(callOrder, "auth")
			if email != "user@example.com" {
				t.Fatalf("recovery email = %q", email)
			}
			return nil
		},
		func(_ context.Context, requestedBy, targetUserID string) error {
			callOrder = append(callOrder, "audit")
			if requestedBy != "admin-id" || targetUserID != "target-id" {
				t.Fatalf("audit actor = %q, target = %q", requestedBy, targetUserID)
			}
			return nil
		},
		nil,
	)
	if err != nil || strings.Join(callOrder, ",") != "auth,audit" {
		t.Fatalf("error = %v, calls = %v", err, callOrder)
	}
}

func TestRequestAdminPasswordRecoveryDoesNotAuditRejectedAuthRequest(t *testing.T) {
	authErr := errors.New("Auth unavailable")
	auditCalled := false
	err := requestAdminPasswordRecovery(
		context.Background(), "user@example.com", "admin-id", "target-id",
		func(context.Context, string) error { return authErr },
		func(context.Context, string, string) error {
			auditCalled = true
			return nil
		},
		nil,
	)
	if !errors.Is(err, authErr) || auditCalled {
		t.Fatalf("error = %v, audit called = %t", err, auditCalled)
	}
}

func TestRequestAdminPasswordRecoveryKeepsAcceptedResultWhenAuditFails(t *testing.T) {
	var output bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&output, nil))
	err := requestAdminPasswordRecovery(
		context.Background(), "user@example.com", "admin-id", "target-id",
		func(context.Context, string) error { return nil },
		func(context.Context, string, string) error { return errors.New("audit unavailable") },
		logger,
	)
	if err != nil {
		t.Fatalf("accepted Auth request became a false failure: %v", err)
	}
	if !strings.Contains(output.String(), "audit persistence failed") ||
		strings.Contains(output.String(), "user@example.com") ||
		strings.Contains(output.String(), "admin-id") ||
		strings.Contains(output.String(), "target-id") {
		t.Fatalf("audit failure log has unexpected content: %s", output.String())
	}
}

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
