package homefocus

import (
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type scannerFunc func(...any) error

func (scanner scannerFunc) Scan(destinations ...any) error {
	return scanner(destinations...)
}

func TestNormalizeFilterCapsLimitAndDefaultsScope(t *testing.T) {
	filter, err := normalizeFilter(url.Values{"limit": {"999"}})
	if err != nil {
		t.Fatalf("normalize filter: %v", err)
	}
	if filter.Limit != maxLimit || filter.Scope != "mine" {
		t.Fatalf("filter = %#v", filter)
	}

	if _, err := normalizeFilter(url.Values{"limit": {"0"}}); err == nil {
		t.Fatal("zero limit was accepted")
	}
	if _, err := normalizeFilter(url.Values{"scope": {"foreign"}}); err == nil {
		t.Fatal("unknown scope was accepted")
	}
}

func TestResolveScopeMatchesAttentionVisibility(t *testing.T) {
	mine := tenant.Context{UserID: "user-1"}
	mode, userIDs, err := resolveScope(mine, "mine")
	if err != nil || mode != "mine" || len(userIDs) != 1 || userIDs[0] != "user-1" {
		t.Fatalf("mine scope = %q %#v, %v", mode, userIDs, err)
	}

	leader := tenant.Context{
		UserID:       "leader-1",
		IsTeamLeader: true,
		LedUserIDs:   []string{"user-2", "user-2", "user-3"},
	}
	mode, userIDs, err = resolveScope(leader, "team")
	if err != nil || mode != "team" || strings.Join(userIDs, ",") != "leader-1,user-2,user-3" {
		t.Fatalf("team scope = %q %#v, %v", mode, userIDs, err)
	}

	admin := tenant.Context{
		UserID:     "admin-1",
		MemberRole: "admin",
	}
	mode, userIDs, err = resolveScope(admin, "organization")
	if err != nil || mode != "organization" || len(userIDs) != 0 {
		t.Fatalf("organization scope = %q %#v, %v", mode, userIDs, err)
	}

	regular := tenant.Context{
		UserID:      "user-1",
		Permissions: []string{permissions.LeadViewOwn},
	}
	if _, _, err := resolveScope(regular, "team"); err == nil {
		t.Fatal("regular user received team scope")
	}
}

func TestListFocusSQLFiltersCurrentOperationalObligationsBeforeFinalLimit(t *testing.T) {
	query := strings.ToLower(listFocusSQL)
	for _, required := range []string{
		"l.deal_status = 'open'",
		"p.status = 'enabled'",
		"coalesce(i.shadow, true) = false",
		"lt.status = 'pending'",
		"lt.is_done = false",
		"ce.status = 'active'",
		"current_stage_cycle.exited_at is null",
		"ac.ended_at is null",
		"sc.exited_at is null",
		"active_enrollment.status = 'active'",
		"pending_task.status = 'pending'",
		"union all",
		"partition by candidate.organization_id, candidate.lead_id, candidate.obligation_key",
		"candidate.source_priority",
		"where obligation_rank = 1",
		"order by severity_rank, due_at, source_priority, item_id",
		"limit $5",
	} {
		if !strings.Contains(query, required) {
			t.Errorf("focus SQL is missing %q", required)
		}
	}
	if count := strings.Count(query, "limit $"); count != 1 {
		t.Fatalf("focus SQL must limit only after union/dedupe, found %d LIMIT clauses", count)
	}
}

func TestDeduplicatePrefersActiveAttentionAndRanksSeverity(t *testing.T) {
	now := time.Date(2026, time.July, 31, 12, 0, 0, 0, time.UTC)
	items := []Item{
		{
			ID:            "task:1",
			Kind:          "task",
			ObligationKey: "cadence_task:1",
			LeadID:        "lead-1",
			DueAt:         now.Add(-time.Hour),
			Tone:          "critical",
		},
		{
			ID:            "attention:1",
			Kind:          "attention",
			ObligationKey: "cadence_task:1",
			LeadID:        "lead-1",
			DueAt:         now.Add(time.Hour),
			Tone:          "warning",
		},
		{
			ID:            "attention:2",
			Kind:          "attention",
			ObligationKey: "stage_age:cycle-2",
			LeadID:        "lead-2",
			DueAt:         now.Add(-2 * time.Hour),
			Tone:          "critical",
		},
		{
			ID:            "task:3",
			Kind:          "task",
			ObligationKey: "lead_task:3",
			LeadID:        "lead-3",
			DueAt:         now.Add(2 * time.Hour),
			Tone:          "neutral",
		},
	}

	result := deduplicateAndLimit(items, 2)
	if len(result) != 2 {
		t.Fatalf("result length = %d", len(result))
	}
	if result[0].ID != "attention:2" {
		t.Fatalf("critical item was not first: %#v", result)
	}
	if result[1].ID != "attention:1" {
		t.Fatalf("attention did not replace duplicate task: %#v", result)
	}
}

func TestScanItemKeepsStableOptionalFields(t *testing.T) {
	dueAt := time.Date(2026, time.July, 31, 12, 0, 0, 0, time.UTC)
	scanner := scannerFunc(func(destinations ...any) error {
		*destinations[0].(*string) = "attention:1"
		*destinations[1].(*string) = "attention"
		*destinations[2].(*string) = "first_contact:cycle-1"
		*destinations[3].(*string) = "lead-1"
		*destinations[4].(*string) = "Maria"
		*destinations[5].(*string) = "Primeiro contato com Maria"
		*destinations[6].(*string) = "Pipeline · Novo"
		*destinations[7].(*time.Time) = dueAt
		*destinations[8].(*string) = "warning"
		*destinations[9].(*string) = "warning"
		*destinations[10].(*pgtype.Text) = pgtype.Text{String: "first_contact", Valid: true}
		*destinations[11].(*pgtype.Text) = pgtype.Text{}
		*destinations[12].(*string) = "/crm/pipelines?lead=lead-1"
		*destinations[13].(*pgtype.Text) = pgtype.Text{String: "stage-1", Valid: true}
		*destinations[14].(*pgtype.Text) = pgtype.Text{String: "Novo", Valid: true}
		return nil
	})

	item, err := scanItem(scanner)
	if err != nil {
		t.Fatalf("scan item: %v", err)
	}
	if item.PolicyType == nil || *item.PolicyType != "first_contact" ||
		item.TaskType != nil ||
		item.StageID == nil || *item.StageID != "stage-1" ||
		item.StageName == nil || *item.StageName != "Novo" {
		t.Fatalf("item = %#v", item)
	}
}
