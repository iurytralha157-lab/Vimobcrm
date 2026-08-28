package whatsapp

import (
	"bytes"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

type trackingWebhookBody struct {
	reader    *bytes.Reader
	readCalls int
	bytesRead int
	closed    bool
}

func newTrackingWebhookBody(payload []byte) *trackingWebhookBody {
	return &trackingWebhookBody{reader: bytes.NewReader(payload)}
}

func (body *trackingWebhookBody) Read(destination []byte) (int, error) {
	body.readCalls++
	read, err := body.reader.Read(destination)
	body.bytesRead += read
	return read, err
}

func (body *trackingWebhookBody) Close() error {
	body.closed = true
	return nil
}

func TestEvolutionWebhookRejectsDeclaredOversizeBeforeRepositoryOrBodyRead(t *testing.T) {
	payload := bytes.Repeat([]byte("x"), int(evolutionWebhookMaxBodyBytes)+4096)
	body := newTrackingWebhookBody(payload)
	request := httptest.NewRequest(
		http.MethodPost,
		"/v1/whatsapp/webhook/evolution-go?session_id=45c7cc1f-6dad-4cf4-8df3-561858de4725&instance_id=instance-1",
		nil,
	)
	request.Body = body
	request.ContentLength = int64(len(payload))
	response := httptest.NewRecorder()

	// A zero-value repository would panic if the handler reached the session
	// lookup, so this also proves Content-Length rejection precedes the query.
	(Handler{}).EvolutionGoWebhook(response, request)

	if response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusRequestEntityTooLarge)
	}
	if body.readCalls != 0 || body.bytesRead != 0 {
		t.Fatalf("oversized body was read: calls=%d bytes=%d", body.readCalls, body.bytesRead)
	}
	if response.Header().Get("Connection") != "close" || !request.Close {
		t.Fatal("oversized request must close the connection instead of draining the body")
	}
}

func TestReadEvolutionWebhookBodyStopsAtRealLimitForUnknownLength(t *testing.T) {
	payload := bytes.Repeat([]byte("x"), int(evolutionWebhookMaxBodyBytes)+4096)
	body := newTrackingWebhookBody(payload)
	request := httptest.NewRequest(http.MethodPost, "/", nil)
	request.Body = body
	request.ContentLength = -1

	_, err := readEvolutionWebhookBody(httptest.NewRecorder(), request)
	if !errors.Is(err, errEvolutionWebhookBodyTooLarge) {
		t.Fatalf("read error = %v, want errEvolutionWebhookBodyTooLarge", err)
	}
	if body.bytesRead > int(evolutionWebhookMaxBodyBytes)+1 {
		t.Fatalf("streaming limit read %d bytes, want at most %d", body.bytesRead, evolutionWebhookMaxBodyBytes+1)
	}
	if body.bytesRead >= len(payload) {
		t.Fatalf("streaming limit consumed the entire %d-byte body", len(payload))
	}
}

func TestReadEvolutionWebhookBodyAcceptsExactLimit(t *testing.T) {
	payload := bytes.Repeat([]byte("x"), int(evolutionWebhookMaxBodyBytes))
	request := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(payload))

	body, err := readEvolutionWebhookBody(httptest.NewRecorder(), request)
	if err != nil {
		t.Fatalf("readEvolutionWebhookBody() error = %v", err)
	}
	if !bytes.Equal(body, payload) {
		t.Fatalf("read %d bytes, want %d", len(body), len(payload))
	}
}

func TestEvolutionWebhookRateLimiterRefillsWithoutExceedingBurst(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	limiter := &evolutionWebhookRateLimiter{
		now:        func() time.Time { return now },
		entries:    make(map[string]evolutionWebhookRateLimitEntry),
		maxEntries: 4,
		idleTTL:    time.Minute,
	}
	key := evolutionWebhookRateLimitKey{
		value: "session:test",
		spec: evolutionWebhookRateLimitSpec{
			ratePerSecond: 1,
			burst:         2,
		},
	}

	if !limiter.allow(key) || !limiter.allow(key) {
		t.Fatal("initial burst was rejected")
	}
	if limiter.allow(key) {
		t.Fatal("request beyond burst was allowed")
	}
	now = now.Add(time.Second)
	if !limiter.allow(key) {
		t.Fatal("one token was not restored after one second")
	}
	if limiter.allow(key) {
		t.Fatal("refill exceeded the configured rate")
	}
}

func TestEvolutionWebhookRateLimiterBoundsAndExpiresKeyStorage(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	limiter := &evolutionWebhookRateLimiter{
		now:        func() time.Time { return now },
		entries:    make(map[string]evolutionWebhookRateLimitEntry),
		maxEntries: 2,
		idleTTL:    time.Minute,
	}
	spec := evolutionWebhookRateLimitSpec{ratePerSecond: 1, burst: 1}

	if !limiter.allow(evolutionWebhookRateLimitKey{value: "one", spec: spec}) ||
		!limiter.allow(evolutionWebhookRateLimitKey{value: "two", spec: spec}) {
		t.Fatal("initial bounded keys were rejected")
	}
	if limiter.allow(evolutionWebhookRateLimitKey{value: "three", spec: spec}) {
		t.Fatal("new key was accepted after reaching the storage bound")
	}
	if len(limiter.entries) != limiter.maxEntries {
		t.Fatalf("stored entries = %d, want %d", len(limiter.entries), limiter.maxEntries)
	}

	now = now.Add(time.Minute)
	if !limiter.allow(evolutionWebhookRateLimitKey{value: "three", spec: spec}) {
		t.Fatal("new key was not accepted after idle entries expired")
	}
	if len(limiter.entries) > limiter.maxEntries {
		t.Fatalf("stored entries = %d, exceeds %d", len(limiter.entries), limiter.maxEntries)
	}
}

func TestEvolutionWebhookRateLimiterConcurrentAccessStaysBounded(t *testing.T) {
	limiter := &evolutionWebhookRateLimiter{
		entries:    make(map[string]evolutionWebhookRateLimitEntry),
		maxEntries: 64,
		idleTTL:    time.Minute,
	}
	spec := evolutionWebhookRateLimitSpec{ratePerSecond: 100, burst: 100}
	start := make(chan struct{})
	var workers sync.WaitGroup

	for index := 0; index < 256; index++ {
		workers.Add(1)
		go func(index int) {
			defer workers.Done()
			<-start
			limiter.allow(evolutionWebhookRateLimitKey{
				value: "session:" + strconv.Itoa(index),
				spec:  spec,
			})
		}(index)
	}
	close(start)
	workers.Wait()

	if len(limiter.entries) > limiter.maxEntries {
		t.Fatalf("stored entries = %d, exceeds %d", len(limiter.entries), limiter.maxEntries)
	}
}

func TestEvolutionWebhookRateLimitRejectsBeforeRepositoryOrBodyRead(t *testing.T) {
	limiter := newEvolutionWebhookRateLimiter()
	requestURL := "/v1/whatsapp/webhook/evolution-go?session_id=45c7cc1f-6dad-4cf4-8df3-561858de4725&instance_id=instance-1"
	newRequest := func(body io.ReadCloser) *http.Request {
		request := httptest.NewRequest(http.MethodPost, requestURL, nil)
		request.Body = body
		request.ContentLength = 1
		request.RemoteAddr = "192.0.2.10:4321"
		return request
	}

	for index := 0; index < int(evolutionWebhookSessionRateLimit.burst); index++ {
		if !limiter.allow(evolutionWebhookRateLimitKeys(newRequest(http.NoBody))...) {
			t.Fatalf("request %d inside session burst was rejected", index+1)
		}
	}

	body := newTrackingWebhookBody([]byte("x"))
	request := newRequest(body)
	response := httptest.NewRecorder()
	Handler{webhookRateLimiter: limiter}.EvolutionGoWebhook(response, request)

	if response.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusTooManyRequests)
	}
	if response.Header().Get("Retry-After") != "1" {
		t.Fatalf("Retry-After = %q, want 1", response.Header().Get("Retry-After"))
	}
	if body.readCalls != 0 || body.bytesRead != 0 {
		t.Fatalf("rate-limited body was read: calls=%d bytes=%d", body.readCalls, body.bytesRead)
	}
}

func TestEvolutionWebhookRateLimitKeysAreFixedAndScoped(t *testing.T) {
	request := httptest.NewRequest(
		http.MethodPost,
		"/v1/whatsapp/webhook/evolution-go?session_id=45c7cc1f-6dad-4cf4-8df3-561858de4725",
		nil,
	)
	request.RemoteAddr = "10.0.0.2:1234"
	request.Header.Set("X-Forwarded-For", "203.0.113.9, 10.0.0.1")
	keys := evolutionWebhookRateLimitKeys(request)

	if len(keys) != 3 {
		t.Fatalf("key count = %d, want 3", len(keys))
	}
	seen := map[string]bool{}
	for _, key := range keys {
		if seen[key.value] {
			t.Fatalf("duplicate rate-limit key %q", key.value)
		}
		seen[key.value] = true
		if strings.Contains(key.value, "45c7cc1f") ||
			strings.Contains(key.value, "203.0.113.9") {
			t.Fatalf("rate-limit key retained attacker-controlled text: %q", key.value)
		}
	}
}
