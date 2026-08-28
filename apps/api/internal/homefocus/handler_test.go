package homefocus

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type recordingStore struct {
	filter       Filter
	calls        int
	items        []Item
	err          error
	noticeCalls  int
	noticeTenant tenant.Context
	notices      []Notice
	noticeErr    error
}

func (store *recordingStore) List(_ context.Context, _ tenant.Context, filter Filter) ([]Item, error) {
	store.calls++
	store.filter = filter
	return store.items, store.err
}

func (store *recordingStore) ListNotices(_ context.Context, tenantContext tenant.Context) ([]Notice, error) {
	store.noticeCalls++
	store.noticeTenant = tenantContext
	return store.notices, store.noticeErr
}

func TestHandlerCapsLimitAtTwenty(t *testing.T) {
	store := &recordingStore{items: []Item{}}
	handler := NewHandler(store)
	request := httptest.NewRequest(http.MethodGet, "/v1/home/focus?limit=200", nil)
	request = request.WithContext(tenant.ContextWithTenant(request.Context(), tenant.Context{
		UserID:         "10000000-0000-4000-8000-000000000001",
		OrganizationID: "20000000-0000-4000-8000-000000000001",
	}))
	response := httptest.NewRecorder()

	handler.List(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if store.calls != 1 || store.filter.Limit != maxLimit || store.filter.Scope != "mine" {
		t.Fatalf("store state = calls:%d filter:%#v", store.calls, store.filter)
	}
	var payload Envelope[[]Item]
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Data == nil {
		t.Fatal("empty feed must serialize as an array")
	}
}

func TestHandlerRejectsInvalidLimitWithoutCallingStore(t *testing.T) {
	store := &recordingStore{}
	handler := NewHandler(store)
	request := httptest.NewRequest(http.MethodGet, "/v1/home/focus?limit=invalid", nil)
	request = request.WithContext(tenant.ContextWithTenant(request.Context(), tenant.Context{
		UserID:         "10000000-0000-4000-8000-000000000001",
		OrganizationID: "20000000-0000-4000-8000-000000000001",
	}))
	response := httptest.NewRecorder()

	handler.List(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if store.calls != 0 {
		t.Fatalf("store was called %d times", store.calls)
	}
}

func TestItemJSONUsesStableSnakeCaseContract(t *testing.T) {
	policyType := "first_effective_contact"
	taskType := "call"
	stageID := "30000000-0000-4000-8000-000000000001"
	stageName := "Atendimento"
	payload, err := json.Marshal(Item{
		ID:            "attention:40000000-0000-4000-8000-000000000001",
		Kind:          "attention",
		ObligationKey: "first_effective_contact:cycle-1",
		LeadID:        "50000000-0000-4000-8000-000000000001",
		LeadName:      "Maria",
		Title:         "Contato efetivo com Maria",
		Description:   "Pipeline · Atendimento",
		Status:        "warning",
		Tone:          "warning",
		PolicyType:    &policyType,
		TaskType:      &taskType,
		TargetURL:     "/crm/pipelines?lead=50000000-0000-4000-8000-000000000001",
		StageID:       &stageID,
		StageName:     &stageName,
	})
	if err != nil {
		t.Fatalf("marshal item: %v", err)
	}
	body := string(payload)
	for _, field := range []string{
		`"obligation_key"`,
		`"lead_id"`,
		`"lead_name"`,
		`"due_at"`,
		`"policy_type"`,
		`"task_type"`,
		`"target_url"`,
		`"stage_id"`,
		`"stage_name"`,
	} {
		if !strings.Contains(body, field) {
			t.Errorf("JSON contract is missing %s: %s", field, body)
		}
	}
}
