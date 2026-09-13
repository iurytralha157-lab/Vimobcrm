package teams

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestParseTeamHistoryLimit(t *testing.T) {
	tests := []struct {
		name      string
		value     string
		want      int
		wantError bool
	}{
		{name: "default", value: "", want: defaultTeamHistoryLimit},
		{name: "explicit", value: "25", want: 25},
		{name: "maximum", value: "100", want: maxTeamHistoryLimit},
		{name: "zero", value: "0", wantError: true},
		{name: "above maximum", value: "101", wantError: true},
		{name: "not a number", value: "many", wantError: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := parseTeamHistoryLimit(test.value)
			if test.wantError {
				if err == nil {
					t.Fatalf("parseTeamHistoryLimit(%q) error = nil, want error", test.value)
				}
				return
			}
			if err != nil {
				t.Fatalf("parseTeamHistoryLimit(%q) error = %v", test.value, err)
			}
			if got != test.want {
				t.Fatalf("parseTeamHistoryLimit(%q) = %d, want %d", test.value, got, test.want)
			}
		})
	}
}

func TestCanViewTeamMatchesTeamReadScope(t *testing.T) {
	const teamID = "11111111-1111-4111-8111-111111111111"
	tests := []struct {
		name    string
		context tenant.Context
		want    bool
	}{
		{
			name:    "organization admin",
			context: tenant.Context{MemberRole: "admin"},
			want:    true,
		},
		{
			name: "explicit team manager",
			context: tenant.Context{
				MemberRole:  "manager",
				Permissions: []string{permissions.TeamManage},
			},
			want: true,
		},
		{
			name: "leader of requested team",
			context: tenant.Context{
				MemberRole:   "manager",
				IsTeamLeader: true,
				LedTeamIDs:   []string{teamID},
			},
			want: true,
		},
		{
			name: "leader of another team",
			context: tenant.Context{
				MemberRole:   "manager",
				IsTeamLeader: true,
				LedTeamIDs:   []string{"22222222-2222-4222-8222-222222222222"},
			},
			want: false,
		},
		{
			name:    "regular member",
			context: tenant.Context{MemberRole: "user"},
			want:    false,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := canViewTeam(test.context, teamID); got != test.want {
				t.Fatalf("canViewTeam() = %v, want %v", got, test.want)
			}
		})
	}
}

func TestTeamHistoryQueryScopesRelatedEntities(t *testing.T) {
	requiredFragments := []string{
		"team_creation as",
		"creation.entity_type = 'team'",
		"creation.action = 'create'",
		"creation.entity_id = $2::text",
		"tm.organization_id = $1::uuid",
		"tm.team_id = $2::uuid",
		"member_audit.organization_id = $1::uuid",
		"member_audit.entity_type = 'team_member'",
		"al.organization_id = $1::uuid",
		"al.entity_id is not null",
		"al.entity_type = 'team'",
		"al.entity_type in ('team_member', 'team_pipeline')",
		"al.entity_type = 'team_member_availability'",
		"related_member.team_member_id is not null",
		"ranked_history as",
		"availability_event_rank",
		"visible_history as",
		"or availability_event_rank = 1",
		"ordered_history as",
		"is_initial_creation_event",
		"initial_creation_group_at",
		"when history.entity_type = 'team' then 0",
		"when history.entity_type = 'team_member' then 1",
		"when history.entity_type = 'team_member_availability' then 2",
		"left join public.users actor",
		"left join public.users subject",
		"limit $3",
	}
	for _, fragment := range requiredFragments {
		if !strings.Contains(teamHistoryQuery, fragment) {
			t.Errorf("team history query is missing %q", fragment)
		}
	}
}

func TestTeamHistoryQueryOnlyAppliesSemanticOrderToInitialCreation(t *testing.T) {
	normalized := strings.Join(strings.Fields(teamHistoryQuery), " ")

	creationGroup := "when history.is_initial_creation_event then history.initial_creation_group_at else history.created_at end desc"
	if !strings.Contains(normalized, creationGroup) {
		t.Fatalf("team history query must group only initial creation events before applying the limit")
	}

	semanticOrder := "when not history.is_initial_creation_event then 0 when history.entity_type = 'team' then 0 when history.entity_type = 'team_member' then 1 when history.entity_type = 'team_member_availability' then 2 else 3 end"
	if !strings.Contains(normalized, semanticOrder) {
		t.Fatalf("team history query must order the initial creation as team, members, then availability")
	}

	chronologicalFallback := "end nulls first, history.created_at desc, history.id desc limit $3"
	if !strings.Contains(normalized, chronologicalFallback) {
		t.Fatalf("team history query must keep ordinary updates in deterministic chronological order")
	}
}

func TestTeamHistoryEnvelopeJSONContract(t *testing.T) {
	name := "Pessoa Teste"
	email := "pessoa@example.com"
	avatar := "https://example.com/avatar.png"
	entityID := "33333333-3333-4333-8333-333333333333"
	user := &TeamUser{
		ID:        "44444444-4444-4444-8444-444444444444",
		Name:      &name,
		Email:     &email,
		AvatarURL: &avatar,
	}
	payload := Envelope[[]TeamHistoryEvent]{Data: []TeamHistoryEvent{{
		ID:          "55555555-5555-4555-8555-555555555555",
		Action:      "update",
		EntityType:  "team_member",
		EntityID:    entityID,
		OldData:     map[string]any{"is_leader": false},
		NewData:     map[string]any{"is_leader": true},
		Diff:        map[string]any{"is_leader": map[string]any{"old": false, "new": true}},
		CreatedAt:   time.Date(2026, time.September, 4, 12, 30, 0, 0, time.UTC),
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
		t.Fatalf("envelope keys = %v, want only data", mapKeys(envelope))
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
		t.Fatalf("event keys = %v, want %v", mapKeys(events[0]), expectedKeys)
	}
	for _, key := range expectedKeys {
		if events[0][key] == nil {
			t.Errorf("event is missing key %q", key)
		}
	}
}

func mapKeys[T any](value map[string]T) []string {
	keys := make([]string, 0, len(value))
	for key := range value {
		keys = append(keys, key)
	}
	return keys
}
