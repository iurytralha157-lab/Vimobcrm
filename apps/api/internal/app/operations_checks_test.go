package app

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/leads"
)

func TestOperationsChecksRoutes(t *testing.T) {
	const token = "synthetic-operations-token-for-tests"
	for _, tc := range []struct {
		name, route, body string
		headers           []string
		disabled          bool
		wantStatus        int
		wantCalls         int
	}{
		{name: "disabled", route: "sla-check", headers: []string{token}, disabled: true, wantStatus: 503},
		{name: "missing token", route: "sla-check", wantStatus: 401},
		{name: "wrong token", route: "pool-check", headers: []string{"wrong"}, wantStatus: 401},
		{name: "repeated token", route: "pool-check", headers: []string{token, token}, wantStatus: 401},
		{name: "rejects target override", route: "pool-check", headers: []string{token}, body: `{"organization_id":"other"}`, wantStatus: 400},
		{name: "rejects trailing body", route: "sla-check", headers: []string{token}, body: "{} {}", wantStatus: 400},
		{name: "rejects oversized body", route: "sla-check", headers: []string{token}, body: strings.Repeat(" ", 32) + "{}", wantStatus: 400},
		{name: "runs SLA", route: "sla-check", headers: []string{token}, body: "{}", wantStatus: 200, wantCalls: 1},
		{name: "runs pool", route: "pool-check", headers: []string{token}, wantStatus: 200, wantCalls: 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			operations := operationsChecksHandler{token: token, timeout: time.Second,
				runSLA: func(context.Context) (leads.SLACheckResult, error) {
					calls++
					return leads.SLACheckResult{Success: true}, nil
				},
				runPool: func(context.Context) (leads.PoolCheckResult, error) {
					calls++
					return leads.PoolCheckResult{Success: true}, nil
				},
			}
			if tc.disabled {
				operations = operationsChecksHandler{}
			}
			mux := http.NewServeMux()
			registerRoutes(mux, routeDependencies{
				operationsChecks:         operations,
				metaOAuthActionHandler:   metaOAuthUnavailable,
				metaOAuthCallbackHandler: metaOAuthUnavailable,
			})
			request := httptest.NewRequest(http.MethodPost, "/v1/internal/operations/"+tc.route, strings.NewReader(tc.body))
			for _, header := range tc.headers {
				request.Header.Add(operationsTokenHeader, header)
			}
			recorder := httptest.NewRecorder()
			mux.ServeHTTP(recorder, request)
			if recorder.Code != tc.wantStatus || calls != tc.wantCalls || recorder.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("status=%d calls=%d cache=%s", recorder.Code, calls, recorder.Header().Get("Cache-Control"))
			}
		})
	}
}

func TestOperationsChecksSanitizeErrorsAndRespectTimeout(t *testing.T) {
	const token = "synthetic-operations-token-for-tests"
	for _, tc := range []struct {
		name       string
		run        func(context.Context) (leads.SLACheckResult, error)
		wantStatus int
	}{
		{name: "failed", wantStatus: 500, run: func(context.Context) (leads.SLACheckResult, error) {
			return leads.SLACheckResult{}, errors.New("internal database detail")
		}},
		{name: "timed out", wantStatus: 504, run: func(ctx context.Context) (leads.SLACheckResult, error) {
			<-ctx.Done()
			return leads.SLACheckResult{}, ctx.Err()
		}},
		{name: "concurrent sweep", wantStatus: 409, run: func(context.Context) (leads.SLACheckResult, error) {
			return leads.SLACheckResult{Busy: true}, nil
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			handler := operationsChecksHandler{token: token, timeout: time.Millisecond, runSLA: tc.run}
			request := httptest.NewRequest(http.MethodPost, "/v1/internal/operations/sla-check", http.NoBody)
			request.Header.Set(operationsTokenHeader, token)
			recorder := httptest.NewRecorder()
			handler.sla(recorder, request)
			if recorder.Code != tc.wantStatus || strings.Contains(recorder.Body.String(), "internal database detail") {
				t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
			}
		})
	}
}

func TestOperationsChecksRespectWorkerGate(t *testing.T) {
	const token = "synthetic-operations-token-for-tests"
	if handler := newOperationsChecksHandler(leads.Repository{}, token, false, time.Minute); handler.token != "" {
		t.Fatal("operations enabled in a process without workers")
	}
	if handler := newOperationsChecksHandler(leads.Repository{}, "", true, time.Minute); handler.token != "" {
		t.Fatal("operations enabled without a token")
	}
	if handler := newOperationsChecksHandler(leads.Repository{}, token, true, 15*time.Second); handler.token != token || handler.timeout != 14*time.Second {
		t.Fatal("operations must finish before the server write timeout")
	}
}

func TestPoolCheckResponseExcludesIndividualAttempts(t *testing.T) {
	const token = "synthetic-operations-token-for-tests"
	handler := operationsChecksHandler{token: token, timeout: time.Second, runPool: func(context.Context) (leads.PoolCheckResult, error) {
		attempts := []leads.PoolCheckAttempt{{LeadID: "synthetic-lead-id", Error: "internal detail"}}
		return leads.PoolCheckResult{Warnings: attempts, Results: attempts, Failed: 2}, nil
	}}
	request := httptest.NewRequest(http.MethodPost, "/v1/internal/operations/pool-check", http.NoBody)
	request.Header.Set(operationsTokenHeader, token)
	recorder := httptest.NewRecorder()
	handler.pool(recorder, request)
	body := recorder.Body.String()
	if recorder.Code != http.StatusInternalServerError || strings.Contains(body, "synthetic-lead-id") ||
		strings.Contains(body, "internal detail") || !strings.Contains(body, `"warnings":1`) {
		t.Fatalf("status=%d body=%s", recorder.Code, body)
	}
}
