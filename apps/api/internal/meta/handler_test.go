package meta

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/realtime"
)

type fakeWebhookRepository struct {
	insertCalls          int
	finishCalls          int
	claimCalls           int
	processCalls         int
	insertEventID        string
	insertSignatureValid bool
	insertPayload        map[string]any
	insertError          error
}

func (repo *fakeWebhookRepository) InsertWebhookEvent(
	_ context.Context,
	_ webhookEventContext,
	payload map[string]any,
	signatureValid bool,
) (string, error) {
	repo.insertCalls++
	repo.insertSignatureValid = signatureValid
	repo.insertPayload = payload
	return repo.insertEventID, repo.insertError
}

func (repo *fakeWebhookRepository) FinishWebhookEvent(context.Context, webhookEventClaim, string, string, string) error {
	repo.finishCalls++
	return nil
}

func (repo *fakeWebhookRepository) ClaimPendingWebhookEvent(context.Context, time.Duration) (*webhookEventJob, error) {
	repo.claimCalls++
	return nil, nil
}

func (repo *fakeWebhookRepository) ProcessWebhookPayload(context.Context, webhookEventJob) (WebhookResponse, error) {
	repo.processCalls++
	return WebhookResponse{OK: true}, nil
}

func TestMetaWebhookRejectsInvalidSignatureBeforePersistence(t *testing.T) {
	repo := &fakeWebhookRepository{insertEventID: "event-1"}
	handler := Handler{
		repo:      repo,
		config:    Config{AppSecret: "meta-secret"},
		publisher: realtime.NoopPublisher{},
	}
	request := httptest.NewRequest(http.MethodPost, "/v1/webhooks/meta", strings.NewReader(`{"object":"page"}`))
	request.Header.Set("X-Hub-Signature-256", "sha256=00")
	response := httptest.NewRecorder()

	handler.Webhook(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected status %d, got %d: %s", http.StatusUnauthorized, response.Code, response.Body.String())
	}
	if repo.insertCalls != 0 || repo.finishCalls != 0 || repo.claimCalls != 0 || repo.processCalls != 0 {
		t.Fatalf(
			"invalid signature reached persistence or processing: insert=%d finish=%d claim=%d process=%d",
			repo.insertCalls,
			repo.finishCalls,
			repo.claimCalls,
			repo.processCalls,
		)
	}

	var envelope httpserver.ErrorEnvelope
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode error response: %v", err)
	}
	if envelope.Error.Code != "invalid_meta_webhook_signature" {
		t.Fatalf("unexpected error code %q", envelope.Error.Code)
	}
}

func TestMetaWebhookPersistsValidSignedPayload(t *testing.T) {
	const appSecret = "meta-secret"
	raw := []byte(`{"object":"page","entry":[]}`)
	repo := &fakeWebhookRepository{insertEventID: "event-1"}
	handler := Handler{
		repo:      repo,
		config:    Config{AppSecret: appSecret},
		publisher: realtime.NoopPublisher{},
		wake:      make(chan struct{}, 1),
	}
	request := httptest.NewRequest(http.MethodPost, "/v1/webhooks/meta", bytes.NewReader(raw))
	request.Header.Set("X-Hub-Signature-256", signMetaWebhook(raw, appSecret))
	response := httptest.NewRecorder()

	handler.Webhook(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d: %s", http.StatusOK, response.Code, response.Body.String())
	}
	if repo.insertCalls != 1 {
		t.Fatalf("expected one persisted event, got %d", repo.insertCalls)
	}
	if !repo.insertSignatureValid {
		t.Fatal("persisted event was not marked with a verified signature")
	}
	if repo.insertPayload["object"] != "page" {
		t.Fatalf("unexpected persisted payload %#v", repo.insertPayload)
	}
	if repo.claimCalls != 0 || repo.processCalls != 0 || repo.finishCalls != 0 {
		t.Fatalf("receipt was processed by the handler: claim=%d process=%d finish=%d",
			repo.claimCalls, repo.processCalls, repo.finishCalls)
	}
	select {
	case <-handler.wake:
	default:
		t.Fatal("persisted event did not wake the local worker")
	}

	var body WebhookResponse
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode webhook response: %v", err)
	}
	if !body.OK || body.EventID != "event-1" || len(body.Warnings) != 1 || body.Warnings[0] != "queued" {
		t.Fatalf("unexpected webhook response %#v", body)
	}
}

func TestMetaWebhookDoesNotAcknowledgeOrWakeWithoutDurableReceipt(t *testing.T) {
	const appSecret = "meta-secret"
	raw := []byte(`{"object":"page","entry":[]}`)
	repo := &fakeWebhookRepository{insertError: errors.New("inbox not available")}
	handler := Handler{repo: repo, config: Config{AppSecret: appSecret}, wake: make(chan struct{}, 1)}
	request := httptest.NewRequest(http.MethodPost, "/v1/webhooks/meta", bytes.NewReader(raw))
	request.Header.Set("X-Hub-Signature-256", signMetaWebhook(raw, appSecret))
	response := httptest.NewRecorder()

	handler.Webhook(response, request)

	if response.Code != http.StatusServiceUnavailable || len(handler.wake) != 0 {
		t.Fatalf("failed insert produced status=%d wake=%d", response.Code, len(handler.wake))
	}
}

func TestMetaWebhookRejectsOversizedBodyBeforePersistence(t *testing.T) {
	repo := &fakeWebhookRepository{insertEventID: "event-1"}
	handler := Handler{
		repo:      repo,
		config:    Config{AppSecret: "meta-secret"},
		publisher: realtime.NoopPublisher{},
	}
	body := strings.NewReader(strings.Repeat("a", int(metaWebhookMaxBodyBytes)+1))
	request := httptest.NewRequest(http.MethodPost, "/v1/webhooks/meta", body)
	response := httptest.NewRecorder()

	handler.Webhook(response, request)

	if response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected status %d, got %d: %s", http.StatusRequestEntityTooLarge, response.Code, response.Body.String())
	}
	if repo.insertCalls != 0 {
		t.Fatalf("oversized body reached persistence: %d calls", repo.insertCalls)
	}
}

func TestMetaWebhookRejectsMissingSecretBeforeReadingBody(t *testing.T) {
	repo := &fakeWebhookRepository{insertEventID: "event-1"}
	body := &trackingReadCloser{}
	handler := Handler{
		repo:      repo,
		config:    Config{},
		publisher: realtime.NoopPublisher{},
	}
	request := httptest.NewRequest(http.MethodPost, "/v1/webhooks/meta", body)
	response := httptest.NewRecorder()

	handler.Webhook(response, request)

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("expected status %d, got %d: %s", http.StatusInternalServerError, response.Code, response.Body.String())
	}
	if body.reads != 0 {
		t.Fatalf("body was read before app secret validation: %d reads", body.reads)
	}
	if !body.closed {
		t.Fatal("request body was not closed")
	}
	if repo.insertCalls != 0 {
		t.Fatalf("missing secret reached persistence: %d calls", repo.insertCalls)
	}
}

func signMetaWebhook(raw []byte, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(raw)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

type trackingReadCloser struct {
	reads  int
	closed bool
}

func (body *trackingReadCloser) Read([]byte) (int, error) {
	body.reads++
	return 0, io.EOF
}

func (body *trackingReadCloser) Close() error {
	body.closed = true
	return nil
}
