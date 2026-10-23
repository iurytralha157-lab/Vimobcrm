package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestStageInactivityRoutesRejectRevokedSessionsBeforeDataAccess(t *testing.T) {
	checker := &revokedRouteSessionChecker{}
	mux, token := newActiveSessionRouteTestMux(t, checker)
	for _, route := range []struct{ method, path string }{
		{http.MethodPost, "/v1/stage-inactivity-automations"},
		{http.MethodPut, "/v1/stage-automations/30000000-0000-0000-0000-000000000001/inactivity"},
	} {
		t.Run(route.method, func(t *testing.T) {
			before := checker.calls
			request := httptest.NewRequest(route.method, route.path, strings.NewReader(`{"is_enabled":true}`))
			request.Header.Set("Authorization", "Bearer "+token)
			response := httptest.NewRecorder()
			mux.ServeHTTP(response, request)
			if response.Code != http.StatusUnauthorized || checker.calls != before+1 ||
				!strings.Contains(response.Body.String(), `"code":"session_revoked"`) {
				t.Fatalf("revoked activation reached data access: status=%d, checks=%d", response.Code, checker.calls-before)
			}
		})
	}
}

func TestAppCloseCancelsAndWaitsForStageInactivity(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	closed := make(chan struct{})
	application := &App{stageInactivityCancel: cancel, stageInactivityDone: done}
	go func() { application.Close(); close(closed) }()
	select {
	case <-ctx.Done():
	case <-time.After(2 * time.Second):
		t.Fatal("Close did not cancel stage inactivity")
	}
	select {
	case <-closed:
		t.Fatal("Close returned before the worker finished")
	default:
	}
	close(done)
	select {
	case <-closed:
	case <-time.After(2 * time.Second):
		t.Fatal("Close did not finish after the worker stopped")
	}
	application.Close()
}
