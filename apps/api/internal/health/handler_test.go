package health

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealthIncludesRuntimeReliabilityCounters(t *testing.T) {
	handler := NewHandler(nil, 0).WithRuntimeStats(func() map[string]any {
		return map[string]any{
			"realtime": map[string]any{
				"publishFailures": 0,
				"dropped":         2,
			},
		}
	})
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/healthz", nil)

	handler.Health(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d", response.Code)
	}
	var payload struct {
		Status  string                    `json:"status"`
		Runtime map[string]map[string]any `json:"runtime"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Status != "ok" ||
		payload.Runtime["realtime"]["publishFailures"] != float64(0) ||
		payload.Runtime["realtime"]["dropped"] != float64(2) {
		t.Fatalf("payload = %#v", payload)
	}
}
