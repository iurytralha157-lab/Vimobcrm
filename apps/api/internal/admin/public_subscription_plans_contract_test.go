package admin

import (
	"strings"
	"testing"
)

func TestPublicSubscriptionPlansProjectsPersistedPresentation(t *testing.T) {
	query := normalizeSQLContract(listPublicSubscriptionPlansSQL)

	for _, required := range []string{
		"'reference_price', p.reference_price",
		"'discount_percentage', p.discount_percentage",
		"'billing_periods', p.billing_periods",
		"'display_features', p.display_features",
		"'display_order', p.display_order",
	} {
		if !strings.Contains(query, required) {
			t.Fatalf("public plan projection is missing persisted field %q", required)
		}
	}

	for _, forbidden := range []string{
		"starter-197",
		"intermediario-297",
		"master-497",
		"case when p.slug",
		"coalesce(to_jsonb(p.display_features)",
	} {
		if strings.Contains(query, forbidden) {
			t.Fatalf("public plan presentation must come directly from persisted columns: found %q", forbidden)
		}
	}
}

func TestPublicSubscriptionPlansRemainPublicActiveAndDatabaseOrdered(t *testing.T) {
	query := normalizeSQLContract(listPublicSubscriptionPlansSQL)

	for _, required := range []string{
		"where coalesce(p.is_active, true) = true",
		"and coalesce(p.is_public, true) = true",
		"order by p.display_order asc, p.price asc, p.name asc",
	} {
		if !strings.Contains(query, required) {
			t.Fatalf("public plan query is missing contract %q", required)
		}
	}
}

func TestSignupOnlyAcceptsPublicActivePlans(t *testing.T) {
	query := normalizeSQLContract(activeSignupPlanSQL)

	for _, required := range []string{
		"where p.slug = $1",
		"and coalesce(p.is_active, true) = true",
		"and coalesce(p.is_public, true) = true",
	} {
		if !strings.Contains(query, required) {
			t.Fatalf("signup plan lookup is missing contract %q", required)
		}
	}
}

func TestGamificationIsPlanControlled(t *testing.T) {
	for _, moduleName := range planControlledModules {
		if moduleName == "gamification" {
			return
		}
	}

	t.Fatal("gamification must be synchronized with the selected plan modules")
}

func normalizeSQLContract(query string) string {
	return strings.ToLower(strings.Join(strings.Fields(query), " "))
}
