package meta

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type marketingSyncExecutorStub struct {
	request MarketingSyncRequest
	result  MarketingSyncResult
	err     error
}

func (stub *marketingSyncExecutorStub) Sync(_ context.Context, request MarketingSyncRequest) (MarketingSyncResult, error) {
	stub.request = request
	return stub.result, stub.err
}

func TestMarketingSyncHTTPHandlerUsesTenantContextOnly(t *testing.T) {
	stub := &marketingSyncExecutorStub{result: MarketingSyncResult{Success: true, Synced: 4, MediaSynced: 2, Errors: []string{}}}
	handler := MarketingSyncHTTPHandler{syncer: stub}
	request := httptest.NewRequest(http.MethodPost, "/v1/integrations/meta/marketing/sync", strings.NewReader(`{"date_start":"2026-07-01","date_stop":"2026-07-31"}`))
	request.Header.Set("Content-Type", "application/json")
	request = request.WithContext(tenant.ContextWithTenant(request.Context(), tenant.Context{
		OrganizationID: "11111111-1111-4111-8111-111111111111",
		UserID:         "22222222-2222-4222-8222-222222222222",
		MemberRole:     "admin",
	}))
	recorder := httptest.NewRecorder()

	handler.Sync(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if stub.request.OrganizationID != "11111111-1111-4111-8111-111111111111" || stub.request.UserID != "22222222-2222-4222-8222-222222222222" {
		t.Fatalf("service request = %#v", stub.request)
	}
	var response MarketingSyncResult
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !response.Success || response.Synced != 4 || response.MediaSynced != 2 {
		t.Fatalf("response = %#v", response)
	}
}

func TestMarketingSyncHTTPHandlerKeepsPartialProviderWarningsInThe200Result(t *testing.T) {
	stub := &marketingSyncExecutorStub{result: MarketingSyncResult{
		Success: false, Synced: 3, Errors: []string{"act_123:meta_request_timeout"},
	}}
	handler := MarketingSyncHTTPHandler{syncer: stub}
	request := httptest.NewRequest(http.MethodPost, "/v1/integrations/meta/marketing/sync", strings.NewReader(`{"date_start":"2026-07-01","date_stop":"2026-07-31"}`))
	request.Header.Set("Content-Type", "application/json")
	request = request.WithContext(tenant.ContextWithTenant(request.Context(), tenant.Context{
		OrganizationID: "11111111-1111-4111-8111-111111111111",
		UserID:         "22222222-2222-4222-8222-222222222222",
		MemberRole:     "admin",
	}))
	recorder := httptest.NewRecorder()

	handler.Sync(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var response MarketingSyncResult
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Success || response.Synced != 3 || len(response.Errors) != 1 {
		t.Fatalf("partial response = %#v", response)
	}
}

func TestMarketingSyncHTTPHandlerRejectsBodyTenantOverride(t *testing.T) {
	stub := &marketingSyncExecutorStub{}
	handler := MarketingSyncHTTPHandler{syncer: stub}
	request := httptest.NewRequest(http.MethodPost, "/v1/integrations/meta/marketing/sync", strings.NewReader(`{"date_start":"2026-07-01","date_stop":"2026-07-31","organization_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}`))
	request.Header.Set("Content-Type", "application/json")
	request = request.WithContext(tenant.ContextWithTenant(request.Context(), tenant.Context{
		OrganizationID: "11111111-1111-4111-8111-111111111111",
		UserID:         "22222222-2222-4222-8222-222222222222",
		MemberRole:     "owner",
	}))
	recorder := httptest.NewRecorder()

	handler.Sync(recorder, request)
	if recorder.Code != http.StatusBadRequest || stub.request.OrganizationID != "" {
		t.Fatalf("status = %d, service request = %#v", recorder.Code, stub.request)
	}
	assertMarketingSyncAPIError(t, recorder, "invalid_json_body", "")
}

func TestMarketingSyncHTTPHandlerRequiresOrganizationAdmin(t *testing.T) {
	handler := MarketingSyncHTTPHandler{syncer: &marketingSyncExecutorStub{}}
	request := httptest.NewRequest(http.MethodPost, "/v1/integrations/meta/marketing/sync", strings.NewReader(`{"date_start":"2026-07-01","date_stop":"2026-07-31"}`))
	request.Header.Set("Content-Type", "application/json")
	request = request.WithContext(tenant.ContextWithTenant(request.Context(), tenant.Context{
		OrganizationID: "11111111-1111-4111-8111-111111111111",
		UserID:         "22222222-2222-4222-8222-222222222222",
		MemberRole:     "user",
	}))
	recorder := httptest.NewRecorder()

	handler.Sync(recorder, request)
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	assertMarketingSyncAPIError(t, recorder, "organization_admin_required", "")
}

func TestMarketingSyncHTTPHandlerReturnsStandardSafeFailure(t *testing.T) {
	stub := &marketingSyncExecutorStub{err: newMarketingSyncFailure("no_connected_meta_integration", http.StatusNotFound, errors.New("database details"))}
	handler := MarketingSyncHTTPHandler{syncer: stub}
	request := httptest.NewRequest(http.MethodPost, "/v1/integrations/meta/marketing/sync", strings.NewReader(`{"date_start":"2026-07-01","date_stop":"2026-07-31"}`))
	request.Header.Set("Content-Type", "application/json")
	request = request.WithContext(tenant.ContextWithTenant(request.Context(), tenant.Context{
		OrganizationID: "11111111-1111-4111-8111-111111111111",
		UserID:         "22222222-2222-4222-8222-222222222222",
		MemberRole:     "admin",
	}))
	request = request.WithContext(httpserver.ContextWithRequestID(request.Context(), "request-marketing-123"))
	recorder := httptest.NewRecorder()

	handler.Sync(recorder, request)
	if recorder.Code != http.StatusNotFound || strings.Contains(recorder.Body.String(), "database details") {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	assertMarketingSyncAPIError(t, recorder, "no_connected_meta_integration", "request-marketing-123")
	if strings.Contains(recorder.Body.String(), `"errors"`) || strings.Contains(recorder.Body.String(), `"success"`) {
		t.Fatalf("fatal error leaked the 200 result contract: %s", recorder.Body.String())
	}
}

func TestMarketingSyncHTTPHandlerReturnsConflictWhenOrganizationSyncIsRunning(t *testing.T) {
	stub := &marketingSyncExecutorStub{err: newMarketingSyncFailure("marketing_sync_in_progress", http.StatusConflict, nil)}
	handler := MarketingSyncHTTPHandler{syncer: stub}
	request := httptest.NewRequest(http.MethodPost, "/v1/integrations/meta/marketing/sync", strings.NewReader(`{"date_start":"2026-07-01","date_stop":"2026-07-31"}`))
	request.Header.Set("Content-Type", "application/json")
	request = request.WithContext(tenant.ContextWithTenant(request.Context(), tenant.Context{
		OrganizationID: "11111111-1111-4111-8111-111111111111",
		UserID:         "22222222-2222-4222-8222-222222222222",
		MemberRole:     "admin",
	}))
	recorder := httptest.NewRecorder()

	handler.Sync(recorder, request)
	if recorder.Code != http.StatusConflict {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	assertMarketingSyncAPIError(t, recorder, "marketing_sync_in_progress", "")
	if !strings.Contains(recorder.Body.String(), "sincronização de Marketing em andamento") {
		t.Fatalf("conflict message is not actionable: %s", recorder.Body.String())
	}
}

func assertMarketingSyncAPIError(t *testing.T, recorder *httptest.ResponseRecorder, code, requestID string) {
	t.Helper()
	var response httpserver.ErrorEnvelope
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode API error: %v; body = %s", err, recorder.Body.String())
	}
	if response.Error.Code != code || response.Error.Message == "" || response.Error.RequestID != requestID {
		t.Fatalf("API error = %#v", response.Error)
	}
	if recorder.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", recorder.Header().Get("Cache-Control"))
	}
}
