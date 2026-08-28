package health

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type successfulPinger struct{}

func (successfulPinger) Ping(context.Context) error {
	return nil
}

type failingPinger struct{}

func (failingPinger) Ping(context.Context) error {
	return errors.New("database unavailable")
}

func TestNormalizeReleaseSHA(t *testing.T) {
	lowercaseSHA := strings.Repeat("a1", 20)
	uppercaseSHA := strings.ToUpper(lowercaseSHA)

	tests := []struct {
		name  string
		value string
		want  string
	}{
		{name: "missing", value: "", want: unversionedRelease},
		{name: "local fallback", value: unversionedRelease, want: unversionedRelease},
		{name: "lowercase sha", value: lowercaseSHA, want: lowercaseSHA},
		{name: "uppercase sha", value: uppercaseSHA, want: lowercaseSHA},
		{name: "surrounding whitespace", value: "  " + uppercaseSHA + "\n", want: lowercaseSHA},
		{name: "short sha", value: lowercaseSHA[:39], want: unversionedRelease},
		{name: "long sha", value: lowercaseSHA + "0", want: unversionedRelease},
		{name: "non hexadecimal", value: strings.Repeat("g", 40), want: unversionedRelease},
		{name: "arbitrary build value", value: "production-secret-value", want: unversionedRelease},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := normalizeReleaseSHA(test.value); got != test.want {
				t.Fatalf("normalizeReleaseSHA(%q) = %q, want %q", test.value, got, test.want)
			}
		})
	}
}

func TestHealthIncludesNormalizedRelease(t *testing.T) {
	previousReleaseSHA := releaseSHA
	releaseSHA = strings.Repeat("A", 40)
	t.Cleanup(func() {
		releaseSHA = previousReleaseSHA
	})

	handler := NewHandler(nil, 0)
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/healthz", nil)

	handler.Health(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}

	var payload struct {
		Status  string `json:"status"`
		Release string `json:"release"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode health payload: %v", err)
	}
	if payload.Status != "ok" {
		t.Fatalf("status payload = %q, want %q", payload.Status, "ok")
	}
	if want := strings.Repeat("a", 40); payload.Release != want {
		t.Fatalf("release payload = %q, want %q", payload.Release, want)
	}
	if got := response.Header().Get(releaseHeader); got != payload.Release {
		t.Fatalf("release header = %q, want %q", got, payload.Release)
	}
	if got := response.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("cache control = %q, want %q", got, "no-store")
	}
}

func TestHealthUsesUnversionedForUnsafeBuildValue(t *testing.T) {
	previousReleaseSHA := releaseSHA
	releaseSHA = "do-not-expose-this-build-value"
	t.Cleanup(func() {
		releaseSHA = previousReleaseSHA
	})

	handler := NewHandler(nil, 0)
	response := httptest.NewRecorder()
	handler.Health(response, httptest.NewRequest(http.MethodGet, "/healthz", nil))

	var payload struct {
		Release string `json:"release"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode health payload: %v", err)
	}
	if payload.Release != unversionedRelease {
		t.Fatalf("release payload = %q, want %q", payload.Release, unversionedRelease)
	}
}

func TestReadyIncludesNormalizedRelease(t *testing.T) {
	previousReleaseSHA := releaseSHA
	releaseSHA = strings.Repeat("B", 40)
	t.Cleanup(func() {
		releaseSHA = previousReleaseSHA
	})

	handler := Handler{
		db:      successfulPinger{},
		timeout: time.Second,
	}
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/readyz", nil)

	handler.Ready(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}

	var payload struct {
		Status  string `json:"status"`
		Release string `json:"release"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode readiness payload: %v", err)
	}
	if payload.Status != "ready" {
		t.Fatalf("status payload = %q, want %q", payload.Status, "ready")
	}
	if want := strings.Repeat("b", 40); payload.Release != want {
		t.Fatalf("release payload = %q, want %q", payload.Release, want)
	}
	if got := response.Header().Get(releaseHeader); got != payload.Release {
		t.Fatalf("release header = %q, want %q", got, payload.Release)
	}
	if got := response.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("cache control = %q, want %q", got, "no-store")
	}
}

func TestReadyFailureStillIdentifiesTheReleaseWithoutCaching(t *testing.T) {
	previousReleaseSHA := releaseSHA
	releaseSHA = strings.Repeat("c", 40)
	t.Cleanup(func() {
		releaseSHA = previousReleaseSHA
	})

	handler := Handler{db: failingPinger{}, timeout: time.Second}
	response := httptest.NewRecorder()
	handler.Ready(response, httptest.NewRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusServiceUnavailable)
	}
	if got := response.Header().Get(releaseHeader); got != releaseSHA {
		t.Fatalf("release header = %q, want %q", got, releaseSHA)
	}
	if got := response.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("cache control = %q, want %q", got, "no-store")
	}
}
