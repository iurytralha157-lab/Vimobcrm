package ai

import (
	"os"
	"strings"
	"testing"
)

func TestAIMetricsCountImmutableLeadCardsInsteadOfPhysicalConversations(t *testing.T) {
	raw, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatalf("read repository source: %v", err)
	}
	source := string(raw)
	start := strings.Index(source, "func (repo Repository) Metrics(")
	end := strings.Index(source[start:], "func (repo Repository) ListEvents(")
	if start < 0 || end <= 0 {
		t.Fatal("could not isolate AI metrics query")
	}
	metrics := source[start : start+end]

	for _, required := range []string{
		"received_cards as (",
		"select distinct l.id",
		"from public.leads l",
		"wm.organization_id = l.organization_id",
		"wm.lead_id = l.id",
		"wm.from_me = false",
		"attended_cards as (",
		"select distinct wm.lead_id",
		"count(distinct l.id)::bigint as total",
		"count(distinct wm.lead_id)::bigint as total",
		"l.created_at::date as day",
		"where wm.organization_id = $1::uuid",
	} {
		if !strings.Contains(metrics, required) {
			t.Fatalf("AI metrics do not preserve card identity contract %q", required)
		}
	}

	for _, forbidden := range []string{
		"count(distinct wc.id)",
		"count(distinct wm.conversation_id)",
		"wc.created_at::date as day",
	} {
		if strings.Contains(metrics, forbidden) {
			t.Fatalf("AI metrics still infer a lead card from physical conversation identity %q", forbidden)
		}
	}
}
