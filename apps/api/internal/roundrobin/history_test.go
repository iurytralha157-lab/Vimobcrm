package roundrobin

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"
)

func TestParseHistoryLimit(t *testing.T) {
	tests := []struct {
		name      string
		value     string
		want      int
		wantError bool
	}{
		{name: "default", value: "", want: defaultHistoryLimit},
		{name: "explicit", value: "25", want: 25},
		{name: "maximum", value: "100", want: maxHistoryLimit},
		{name: "zero", value: "0", wantError: true},
		{name: "above maximum", value: "101", wantError: true},
		{name: "not a number", value: "many", wantError: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := parseHistoryLimit(test.value)
			if test.wantError {
				if err == nil {
					t.Fatalf("parseHistoryLimit(%q) error = nil, want error", test.value)
				}
				return
			}
			if err != nil {
				t.Fatalf("parseHistoryLimit(%q) error = %v", test.value, err)
			}
			if got != test.want {
				t.Fatalf("parseHistoryLimit(%q) = %d, want %d", test.value, got, test.want)
			}
		})
	}
}

func TestHistoryQueryScopesQueueAndRelatedEntities(t *testing.T) {
	requiredFragments := []string{
		"queue_creation as",
		"creation.organization_id = $1::uuid",
		"creation.entity_type = 'distribution_queue'",
		"creation.entity_id = $2::text",
		"creation.action = 'create'",
		"al.organization_id = $1::uuid",
		"al.entity_id is not null",
		"al.entity_type = 'distribution_queue'",
		"al.entity_type in ('distribution_queue_rule', 'distribution_queue_member')",
		"al.new_data ->> 'round_robin_id'",
		"al.old_data ->> 'round_robin_id'",
		"al.new_data ->> 'user_id'",
		"al.old_data ->> 'user_id'",
		"is_initial_creation_event",
		"initial_creation_group_at",
		"left join public.users actor",
		"left join public.users subject",
		"limit $3",
	}
	for _, fragment := range requiredFragments {
		if !strings.Contains(historyQuery, fragment) {
			t.Errorf("distribution queue history query is missing %q", fragment)
		}
	}
}

func TestHistoryQueryOrdersTiedCreationBeforeRulesAndMembers(t *testing.T) {
	normalized := strings.Join(strings.Fields(historyQuery), " ")

	creationGroup := "when history.is_initial_creation_event then history.initial_creation_group_at else history.created_at end desc"
	if !strings.Contains(normalized, creationGroup) {
		t.Fatal("history query must group the initial creation batch before applying the limit")
	}

	semanticOrder := "when not history.is_initial_creation_event then 0 when history.entity_type = 'distribution_queue' then 0 when history.entity_type = 'distribution_queue_rule' then 1 when history.entity_type = 'distribution_queue_member' then 2 else 3 end"
	if !strings.Contains(normalized, semanticOrder) {
		t.Fatal("tied creation events must be ordered as queue, rules, then members")
	}

	chronologicalFallback := "end nulls first, history.created_at desc, history.id desc limit $3"
	if !strings.Contains(normalized, chronologicalFallback) {
		t.Fatal("ordinary history events must keep deterministic reverse chronological ordering")
	}
}

func TestListHistoryUsesOrganizationAndQueueVisibilityBoundary(t *testing.T) {
	source, err := os.ReadFile("history.go")
	if err != nil {
		t.Fatalf("read history.go: %v", err)
	}
	normalized := strings.Join(strings.Fields(string(source)), " ")
	for _, fragment := range []string{
		`strings.TrimSpace(tenantContext.OrganizationID) == ""`,
		"repo.ensureRoundRobinVisible(ctx, repo.db.Pool(), tenantContext, roundRobinID)",
		"tenantContext.OrganizationID, roundRobinID, limit",
	} {
		if !strings.Contains(normalized, fragment) {
			t.Errorf("ListHistory visibility contract is missing %q", fragment)
		}
	}
}

func TestHistoryEnvelopeJSONContract(t *testing.T) {
	name := "Pessoa Teste"
	email := "pessoa@example.com"
	avatar := "https://example.com/avatar.png"
	user := &HistoryUser{
		ID:        "44444444-4444-4444-8444-444444444444",
		Name:      &name,
		Email:     &email,
		AvatarURL: &avatar,
	}
	payload := map[string][]HistoryEvent{"data": {{
		ID:          "55555555-5555-4555-8555-555555555555",
		Action:      "update",
		EntityType:  "distribution_queue_member",
		EntityID:    "33333333-3333-4333-8333-333333333333",
		OldData:     map[string]any{"is_active": false},
		NewData:     map[string]any{"is_active": true},
		Diff:        map[string]any{"is_active": map[string]any{"old": false, "new": true}},
		CreatedAt:   time.Date(2026, time.September, 8, 12, 30, 0, 0, time.UTC),
		User:        user,
		SubjectUser: user,
	}}}

	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal history envelope: %v", err)
	}
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(encoded, &envelope); err != nil {
		t.Fatalf("decode history envelope: %v", err)
	}
	if len(envelope) != 1 || envelope["data"] == nil {
		t.Fatalf("envelope keys = %v, want only data", historyMapKeys(envelope))
	}

	var events []map[string]json.RawMessage
	if err := json.Unmarshal(envelope["data"], &events); err != nil {
		t.Fatalf("decode history events: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("event count = %d, want 1", len(events))
	}
	expectedKeys := []string{
		"id",
		"action",
		"entity_type",
		"entity_id",
		"old_data",
		"new_data",
		"diff",
		"created_at",
		"user",
		"subject_user",
	}
	if len(events[0]) != len(expectedKeys) {
		t.Fatalf("event keys = %v, want %v", historyMapKeys(events[0]), expectedKeys)
	}
	for _, key := range expectedKeys {
		if events[0][key] == nil {
			t.Errorf("event is missing key %q", key)
		}
	}
}

func historyMapKeys[T any](value map[string]T) []string {
	keys := make([]string, 0, len(value))
	for key := range value {
		keys = append(keys, key)
	}
	return keys
}
