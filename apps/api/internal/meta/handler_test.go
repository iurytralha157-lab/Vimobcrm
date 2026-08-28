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

var errTestDeferredProcessing = errors.New("defer webhook processing")

type fakeWebhookRepository struct {
	insertCalls          int
	finishCalls          int
	markCalls            int
	processCalls         int
	insertEventID        string
	insertSignatureValid bool
	insertPayload        map[string]any
	markError            error
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
	return repo.insertEventID, nil
}

func (repo *fakeWebhookRepository) FinishWebhookEvent(context.Context, string, string, string, string) error {
	repo.finishCalls++
	return nil
}

func (repo *fakeWebhookRepository) MarkWebhookEventProcessing(context.Context, string, time.Duration) error {
	repo.markCalls++
	return repo.markError
}

func (*fakeWebhookRepository) ClaimPendingWebhookEvents(context.Context, int, time.Duration) ([]webhookEventJob, error) {
	return nil, nil
}

func (repo *fakeWebhookRepository) ProcessWebhookPayload(context.Context, string, map[string]any) (WebhookResponse, error) {
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
	if repo.insertCalls != 0 || repo.finishCalls != 0 || repo.markCalls != 0 || repo.processCalls != 0 {
		t.Fatalf(
			"invalid signature reached persistence or processing: insert=%d finish=%d mark=%d process=%d",
			repo.insertCalls,
			repo.finishCalls,
			repo.markCalls,
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
	repo := &fakeWebhookRepository{
		insertEventID: "event-1",
		markError:     errTestDeferredProcessing,
	}
	handler := Handler{
		repo:      repo,
		config:    Config{AppSecret: appSecret},
		publisher: realtime.NoopPublisher{},
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
	if repo.markCalls != 1 {
		t.Fatalf("expected one processing claim, got %d", repo.markCalls)
	}
	if repo.processCalls != 0 {
		t.Fatalf("deferred event was processed synchronously: %d calls", repo.processCalls)
	}

	var body WebhookResponse
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode webhook response: %v", err)
	}
	if !body.OK || body.EventID != "event-1" {
		t.Fatalf("unexpected webhook response %#v", body)
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
