package distribution

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Functional SQL cases live in management_campaign_literal_matching.test.sql
// and the opt-in local routing test. This contract prevents the SQL and Go
// selectors from silently drifting to different comma interpretations.
func TestIntakeAndLegacyPickersShareCampaignLiteralContract(t *testing.T) {
	path := filepath.Join("..", "..", "..", "..", "supabase", "migrations", "20261013004750_management_literal_campaign_matching.sql")
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	migration := string(content)
	for name, source := range map[string]string{"intake": resolveIntakeQueueIDSQL, "legacy": migration} {
		campaign := "coalesce(lead.utm_campaign, lead.lead_meta_campaign_name, lead.meta_campaign_id, '')"
		if name == "legacy" {
			campaign = "lower(" + campaign + ")" // Intake lowercases these fields in its input CTE.
		}
		for _, required := range []string{
			"normalized.match_type = 'campaign_contains'",
			"private.management_campaign_match_values(",
			"coalesce(rule.conditions->'match', '{}'::jsonb) || coalesce(rule.match, '{}'::jsonb)",
			"strpos(" + campaign + ", value) > 0",
		} {
			if !strings.Contains(source, required) {
				t.Fatalf("%s selector lost %q", name, required)
			}
		}
		if strings.Contains(source, "ilike") {
			t.Fatalf("%s selector must not interpret percent as a wildcard", name)
		}
	}
}
