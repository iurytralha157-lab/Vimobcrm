package roundrobin

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func TestGetQueueReadUsesTenantVisibilityAndCompleteEditorShape(t *testing.T) {
	source := repositoryFunctionSource(t, "Get")

	requireRepositoryFragments(t, source,
		"normalizeUUID(roundRobinID)",
		"repo.ensureRoundRobinVisible(ctx, repo.db.Pool(), tenantContext, roundRobinID)",
		"where rr.organization_id = $1::uuid",
		"and rr.id = $2::uuid",
		"repo.listRules(ctx, tenantContext.OrganizationID, &roundRobinID)",
		"repo.listMetaFormLinkRules(ctx, tenantContext.OrganizationID)",
		"rule.RoundRobinID == roundRobinID",
		"mergeMissingMetaFormLinkRules(rules, linkedRulesForQueue)",
		"repo.listMembers(ctx, tenantContext.OrganizationID, &roundRobinID)",
	)
}

func TestGetHandlerUsesRepositoryDetailAndDataEnvelope(t *testing.T) {
	source, err := os.ReadFile("handler.go")
	if err != nil {
		t.Fatalf("read handler.go: %v", err)
	}
	text := strings.Join(strings.Fields(string(source)), " ")
	for _, fragment := range []string{
		"func (handler Handler) Get(w http.ResponseWriter, r *http.Request)",
		"tenant.RequireOrganizationContext(w, r)",
		"handler.repo.Get(r.Context(), tenantContext, r.PathValue(\"id\"))",
		"map[string]RoundRobin{\"data\": item}",
	} {
		if !strings.Contains(text, fragment) {
			t.Errorf("round-robin detail handler is missing %q", fragment)
		}
	}
}

func TestGetRequiresOrganizationContext(t *testing.T) {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/round-robins/22222222-2222-4222-8222-222222222222", nil)
	request.SetPathValue("id", "22222222-2222-4222-8222-222222222222")

	(Handler{}).Get(recorder, request)

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusForbidden)
	}
	if !strings.Contains(recorder.Body.String(), `"code":"organization_required"`) {
		t.Fatalf("response = %s, want organization_required", recorder.Body.String())
	}
}

func TestGetNotFoundErrorResponseDoesNotLeakQueueScope(t *testing.T) {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/round-robins/22222222-2222-4222-8222-222222222222", nil)

	writeRoundRobinError(recorder, request, ErrRoundRobinNotFound)

	if recorder.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusNotFound)
	}
	if !strings.Contains(recorder.Body.String(), `"code":"round_robin_not_found"`) {
		t.Fatalf("response = %s, want round_robin_not_found", recorder.Body.String())
	}
}

func TestRoundRobinDetailEnvelopeJSONContract(t *testing.T) {
	payload := map[string]RoundRobin{"data": {
		ID:                "22222222-2222-4222-8222-222222222222",
		OrganizationID:    "11111111-1111-4111-8111-111111111111",
		Name:              "Fila comercial",
		IsActive:          true,
		LastAssignedIndex: 2,
		CreatedBy:         "33333333-3333-4333-8333-333333333333",
		CreatedByUser:     &UserSummary{ID: "33333333-3333-4333-8333-333333333333", Name: "Admin"},
		Strategy:          "weighted",
		LeadsDistributed:  14,
		TargetPipelineID:  "44444444-4444-4444-8444-444444444444",
		TargetStageID:     "55555555-5555-4555-8555-555555555555",
		Settings:          map[string]any{"auto_tag_ids": []string{"66666666-6666-4666-8666-666666666666"}},
		ReentryBehavior:   "redistribute",
		TargetPipeline:    &PipelineSummary{ID: "44444444-4444-4444-8444-444444444444", Name: "Vendas"},
		TargetStage:       &StageSummary{ID: "55555555-5555-4555-8555-555555555555", Name: "Novo", Color: "#ff4529"},
		Rules: []Rule{{
			ID:           "77777777-7777-4777-8777-777777777777",
			RoundRobinID: "22222222-2222-4222-8222-222222222222",
			MatchType:    "source",
			MatchValue:   "website",
			Priority:     0,
			IsActive:     true,
		}},
		Members: []Member{{
			ID:           "88888888-8888-4888-8888-888888888888",
			RoundRobinID: "22222222-2222-4222-8222-222222222222",
			UserID:       "99999999-9999-4999-8999-999999999999",
			Position:     0,
			Weight:       10,
			IsActive:     true,
			LeadsCount:   3,
		}},
		CreatedAt: time.Date(2026, time.September, 8, 12, 0, 0, 0, time.UTC),
		UpdatedAt: time.Date(2026, time.September, 8, 13, 0, 0, 0, time.UTC),
	}}

	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal detail envelope: %v", err)
	}
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(encoded, &envelope); err != nil {
		t.Fatalf("decode detail envelope: %v", err)
	}
	if len(envelope) != 1 || envelope["data"] == nil {
		t.Fatalf("envelope = %s, want only data", encoded)
	}

	var item map[string]json.RawMessage
	if err := json.Unmarshal(envelope["data"], &item); err != nil {
		t.Fatalf("decode detail item: %v", err)
	}
	for _, key := range []string{
		"id", "organizationId", "name", "isActive", "lastAssignedIndex",
		"createdBy", "createdByUser", "strategy", "leadsDistributed",
		"targetPipelineId", "targetStageId", "settings", "reentryBehavior",
		"targetPipeline", "targetStage", "rules", "members", "createdAt", "updatedAt",
	} {
		if item[key] == nil {
			t.Errorf("detail item is missing key %q: %s", key, envelope["data"])
		}
	}
}
