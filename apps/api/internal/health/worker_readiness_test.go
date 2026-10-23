package health

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestReadinessRequiresConfiguredWorkerProgress(t *testing.T) {
	handler := Handler{db: successfulPinger{}, timeout: time.Second}.WithReadinessCheck(func() error {
		return errors.New("private worker details must not leak")
	})
	response := httptest.NewRecorder()
	handler.Ready(response, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	if response.Code != http.StatusServiceUnavailable || strings.Contains(response.Body.String(), "private worker") {
		t.Fatalf("stalled worker readiness = %d %s", response.Code, response.Body.String())
	}
	response = httptest.NewRecorder()
	handler.WithReadinessCheck(func() error { return nil }).Ready(response, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("ready worker status = %d", response.Code)
	}
	response = httptest.NewRecorder()
	handler.Health(response, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("process liveness status = %d", response.Code)
	}
}
