package meta

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/realtime"
)

func TestDesiredWebhookSubscribedFieldsFailClosed(t *testing.T) {
	tests := []struct {
		name                  string
		target                webhookSubscriptionTarget
		wantFields            []string
		wantAuthorizationFlag bool
	}{
		{
			name:       "base integration keeps leadgen",
			target:     webhookSubscriptionTarget{},
			wantFields: []string{"leadgen"},
		},
		{
			name: "enabled modules without scopes keep leadgen",
			target: webhookSubscriptionTarget{
				MessagingModulesEnabled: true,
				MessagingAuthorized:     false,
			},
			wantFields:            []string{"leadgen"},
			wantAuthorizationFlag: true,
		},
		{
			name: "enabled modules with scopes add messaging fields",
			target: webhookSubscriptionTarget{
				MessagingModulesEnabled: true,
				MessagingAuthorized:     true,
			},
			wantFields: []string{"leadgen", "messages", "messaging_postbacks"},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			fields, authorizationRequired := desiredWebhookSubscribedFields(test.target)
			if !reflect.DeepEqual(fields, test.wantFields) {
				t.Fatalf("fields = %#v, want %#v", fields, test.wantFields)
			}
			if authorizationRequired != test.wantAuthorizationFlag {
				t.Fatalf("authorizationRequired = %t, want %t", authorizationRequired, test.wantAuthorizationFlag)
			}
		})
	}
}

func TestSubscribeWebhookFieldsUsesBearerProofAndFormBody(t *testing.T) {
	pageToken := "page-token-must-not-appear-in-url"
	appSecret := "app-secret"
	fields := []string{"leadgen", "messages", "messaging_postbacks"}

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost {
			t.Fatalf("method = %s", request.Method)
		}
		if request.URL.Path != "/v25.0/page-123/subscribed_apps" {
			t.Fatalf("path = %q", request.URL.Path)
		}
		if request.URL.Query().Has("access_token") || strings.Contains(request.URL.RawQuery, pageToken) {
			t.Fatalf("credential leaked into URL: %q", request.URL.String())
		}
		if got := request.URL.Query().Get("appsecret_proof"); got != oauthAppSecretProof(appSecret, pageToken) {
			t.Fatalf("appsecret_proof = %q", got)
		}
		if got := request.Header.Get("Authorization"); got != "Bearer "+pageToken {
			t.Fatalf("Authorization = %q", got)
		}
		if got := request.Header.Get("Content-Type"); !strings.HasPrefix(got, "application/x-www-form-urlencoded") {
			t.Fatalf("Content-Type = %q", got)
		}
		if err := request.ParseForm(); err != nil {
			t.Fatalf("ParseForm: %v", err)
		}
		if got := request.Form.Get("subscribed_fields"); got != strings.Join(fields, ",") {
			t.Fatalf("subscribed_fields = %q", got)
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"success":true}`))
	}))
	defer server.Close()

	repository := NewRepository(nil, Config{
		AppSecret:    appSecret,
		GraphVersion: "v25.0",
		GraphBaseURL: server.URL,
	})
	repository.client = server.Client()
	if err := repository.subscribeWebhookFields(context.Background(), "page-123", pageToken, fields); err != nil {
		t.Fatalf("subscribeWebhookFields() error = %v", err)
	}
}

func TestSubscribeWebhookFieldsRejectsProviderFailureWithGenericError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		writer.WriteHeader(http.StatusForbidden)
		_, _ = writer.Write([]byte(`{"error":{"message":"provider detail must not escape","code":200}}`))
	}))
	defer server.Close()

	repository := NewRepository(nil, Config{
		AppSecret:    "app-secret",
		GraphVersion: "v25.0",
		GraphBaseURL: server.URL,
	})
	repository.client = server.Client()
	err := repository.subscribeWebhookFields(context.Background(), "page-123", "page-token", []string{"leadgen"})
	if !errors.Is(err, errMetaWebhookSubscriptionReconcile) {
		t.Fatalf("error = %v", err)
	}
	if strings.Contains(err.Error(), "provider detail") || strings.Contains(err.Error(), "page-token") {
		t.Fatalf("provider detail or token escaped: %v", err)
	}
}

func TestSubscribeWebhookFieldsDoesNotFollowRedirect(t *testing.T) {
	targetCalled := false
	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		targetCalled = true
	}))
	defer target.Close()
	source := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Location", target.URL)
		writer.WriteHeader(http.StatusFound)
	}))
	defer source.Close()

	repository := NewRepository(nil, Config{
		AppSecret:    "app-secret",
		GraphVersion: "v25.0",
		GraphBaseURL: source.URL,
	})
	err := repository.subscribeWebhookFields(context.Background(), "page-123", "page-token", []string{"leadgen"})
	if !errors.Is(err, errMetaWebhookSubscriptionReconcile) {
		t.Fatalf("error = %v", err)
	}
	if targetCalled {
		t.Fatal("redirect target received the Meta authorization")
	}
}

func TestWebhookSubscriptionRepositorySecurityContract(t *testing.T) {
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	sourcePath := filepath.Join(filepath.Dir(filename), "subscription_reconciler.go")
	source, err := os.ReadFile(sourcePath)
	if err != nil {
		t.Fatalf("read reconciler source: %v", err)
	}
	text := string(source)
	required := []string{
		"join vault.decrypted_secrets as page_secret",
		"page_secret.id = integration.access_token_secret_ref",
		"lower(btrim(campaigns_module.module_name)) = 'campaigns'",
		"lower(btrim(whatsapp_module.module_name)) = 'whatsapp'",
		"campaigns_module.is_enabled = true",
		"whatsapp_module.is_enabled = true",
		"lower(btrim(granted_scope.value)) = 'pages_messaging'",
		"lower(btrim(instagram_scope.value)) = 'instagram_manage_messages'",
		"subscribed_fields = $4::jsonb",
		"subscription_reconciled_at = now()",
		"webhook_subscribed_at = now()",
		`metaWebhookSubscriptionReconcileFailed    = "meta_webhook_subscription_reconcile_failed"`,
		`metaWebhookMessagingAuthorizationRequired = "meta_messaging_authorization_required"`,
		"set last_error = $4",
		"when $5 then $6",
		"and last_error is distinct from $5",
		"and last_error = $5",
		"subscription_reconciled_at < now() - $2::interval",
		"updated_at < now() - $3::interval",
		"and organization_id = $2::uuid",
		"and page_id = $3",
	}
	for _, fragment := range required {
		if !strings.Contains(text, fragment) {
			t.Fatalf("reconciler is missing security contract fragment %q", fragment)
		}
	}
	for _, forbidden := range []string{
		"SUPABASE_SERVICE_ROLE_KEY",
		"coalesce(nullif(integration.access_token",
		"access_token=",
	} {
		if strings.Contains(text, forbidden) {
			t.Fatalf("reconciler contains forbidden credential path %q", forbidden)
		}
	}
}

type fakeWebhookSubscriptionReconcileRepository struct {
	*fakeWebhookRepository
	reconcileCalls int
	hasDeadline    bool
	reconcileError error
}

func (repo *fakeWebhookSubscriptionReconcileRepository) ReconcileWebhookSubscriptions(ctx context.Context) error {
	repo.reconcileCalls++
	_, repo.hasDeadline = ctx.Deadline()
	return repo.reconcileError
}

func TestProcessPendingWebhookEventsRunsOptionalSubscriptionReconciler(t *testing.T) {
	repository := &fakeWebhookSubscriptionReconcileRepository{
		fakeWebhookRepository: &fakeWebhookRepository{},
	}
	handler := Handler{
		repo:      repository,
		publisher: realtime.NoopPublisher{},
	}

	if err := handler.ProcessPendingWebhookEvents(context.Background()); err != nil {
		t.Fatalf("ProcessPendingWebhookEvents() error = %v", err)
	}
	if repository.reconcileCalls != 1 {
		t.Fatalf("reconcileCalls = %d", repository.reconcileCalls)
	}
	if !repository.hasDeadline {
		t.Fatal("subscription reconciliation must run with a bounded context")
	}
}

func TestProcessPendingWebhookEventsReturnsOptionalReconcilerError(t *testing.T) {
	want := errors.New("safe reconciliation failure")
	repository := &fakeWebhookSubscriptionReconcileRepository{
		fakeWebhookRepository: &fakeWebhookRepository{},
		reconcileError:        want,
	}
	handler := Handler{
		repo:      repository,
		publisher: realtime.NoopPublisher{},
	}

	if err := handler.ProcessPendingWebhookEvents(context.Background()); !errors.Is(err, want) {
		t.Fatalf("ProcessPendingWebhookEvents() error = %v, want %v", err, want)
	}
}
