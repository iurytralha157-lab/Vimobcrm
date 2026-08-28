package admin

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func validNotificationDispatchSettingsRequest() UpdateNotificationDispatchSettingsRequest {
	return UpdateNotificationDispatchSettingsRequest{
		Enabled:        true,
		Mode:           "webhook",
		InstanceName:   "vimob-transacional",
		SenderNumber:   "5522999999999",
		WebhookURL:     "https://notifications.example.test/send",
		HeaderName:     "X-Webhook-Token",
		TimeoutSeconds: 10,
		InstanceToken: NotificationSecretWrite{
			Action: notificationSecretUnchanged,
		},
		HeaderValue: NotificationSecretWrite{
			Action: notificationSecretUnchanged,
		},
	}
}

func TestNotificationDispatchSettingsNeverExposeWriteOnlySecrets(t *testing.T) {
	masked := maskNotificationDispatchSettings(map[string]any{
		"notification_dispatch": map[string]any{
			"whatsapp": map[string]any{
				"enabled":         true,
				"mode":            "webhook",
				"instance_name":   "vimob-transacional",
				"phone_number":    "5522999999999",
				"webhook_url":     "https://notifications.example.test/send",
				"timeout_seconds": 12,
				"token":           "instance-secret-that-must-never-leave-the-api",
				"headers": map[string]any{
					"X-Webhook-Token": "header-secret-that-must-never-leave-the-api",
				},
			},
		},
	}, "2026-08-05T12:00:00Z")

	if !masked.InstanceTokenConfigured || !masked.HeaderValueConfigured {
		t.Fatalf("masked secret flags = instance:%v header:%v, want both configured", masked.InstanceTokenConfigured, masked.HeaderValueConfigured)
	}
	raw, err := json.Marshal(masked)
	if err != nil {
		t.Fatal(err)
	}
	serialized := string(raw)
	for _, secret := range []string{
		"instance-secret-that-must-never-leave-the-api",
		"header-secret-that-must-never-leave-the-api",
	} {
		if strings.Contains(serialized, secret) {
			t.Fatalf("masked settings leaked %q in %s", secret, serialized)
		}
	}
}

func TestNotificationDispatchSettingsRejectUnsafeConfiguration(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*UpdateNotificationDispatchSettingsRequest)
	}{
		{
			name: "plaintext webhook in production",
			mutate: func(request *UpdateNotificationDispatchSettingsRequest) {
				request.WebhookURL = "http://notifications.example.test/send"
			},
		},
		{
			name: "credential in webhook URL",
			mutate: func(request *UpdateNotificationDispatchSettingsRequest) {
				request.WebhookURL = "https://admin:secret@notifications.example.test/send"
			},
		},
		{
			name: "header injection",
			mutate: func(request *UpdateNotificationDispatchSettingsRequest) {
				request.HeaderName = "X-Webhook-Token\r\nX-Injected"
			},
		},
		{
			name: "unknown secret action",
			mutate: func(request *UpdateNotificationDispatchSettingsRequest) {
				request.InstanceToken.Action = "reveal"
			},
		},
		{
			name: "secret supplied while unchanged",
			mutate: func(request *UpdateNotificationDispatchSettingsRequest) {
				request.HeaderValue.Value = "must-not-be-accepted"
			},
		},
		{
			name: "header value replacement without header name",
			mutate: func(request *UpdateNotificationDispatchSettingsRequest) {
				request.HeaderName = ""
				request.HeaderValue = NotificationSecretWrite{Action: "replace", Value: "new-header-secret"}
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := validNotificationDispatchSettingsRequest()
			test.mutate(&request)
			if _, err := validateNotificationDispatchSettingsRequest(request, "production"); !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("validateNotificationDispatchSettingsRequest() error = %v, want ErrInvalidInput", err)
			}
		})
	}
}

func TestNotificationDispatchSettingsAcceptExplicitWriteOnlySecretActions(t *testing.T) {
	request := validNotificationDispatchSettingsRequest()
	request.InstanceToken = NotificationSecretWrite{Action: "replace", Value: "new-instance-token"}
	request.HeaderValue = NotificationSecretWrite{Action: "clear"}

	validated, err := validateNotificationDispatchSettingsRequest(request, "production")
	if err != nil {
		t.Fatalf("validateNotificationDispatchSettingsRequest() error = %v", err)
	}
	target := map[string]any{"token": "old-token"}
	if err := applyWriteOnlySecret(target, "token", validated.InstanceToken); err != nil {
		t.Fatal(err)
	}
	if target["token"] != "new-instance-token" {
		t.Fatalf("replacement token = %#v", target["token"])
	}
	if err := applyWriteOnlySecret(target, "token", NotificationSecretWrite{Action: "clear"}); err != nil {
		t.Fatal(err)
	}
	if _, exists := target["token"]; exists {
		t.Fatal("clear must remove the persisted secret")
	}
}

func TestGenericAdminTablesCannotReadOrMutateSystemSettings(t *testing.T) {
	if isAllowedAdminTable("system_settings") || isAllowedAdminReadTable("system_settings") {
		t.Fatal("system_settings must only be reachable through the purpose-built masked endpoint")
	}
	if !isAllowedAdminReadTable("notifications") {
		t.Fatal("the redacted notifications read model must remain available")
	}
}
