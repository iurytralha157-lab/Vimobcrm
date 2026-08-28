package meta

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

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
	if recorder.Code != http.StatusForbidden || !strings.Contains(recorder.Body.String(), "organization_admin_required") {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
}

func TestMarketingSyncHTTPHandlerReturnsDirectSafeFailure(t *testing.T) {
	stub := &marketingSyncExecutorStub{err: newMarketingSyncFailure("no_connected_meta_integration", http.StatusNotFound, errors.New("database details"))}
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
	if recorder.Code != http.StatusNotFound || strings.Contains(recorder.Body.String(), "database details") {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), `"errors":["no_connected_meta_integration"]`) {
		t.Fatalf("body = %s", recorder.Body.String())
	}
}
