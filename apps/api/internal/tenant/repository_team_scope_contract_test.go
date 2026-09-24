package tenant

import (
	"os"
	"strings"
	"testing"
)

func TestLeadershipScopeRequiresActiveBrokerMembershipInSelectedOrganization(t *testing.T) {
	source, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatalf("read repository.go: %v", err)
	}
	query := string(source)
	start := strings.Index(query, "led_users as (")
	end := strings.Index(query, "led_pipelines as (")
	if start < 0 || end <= start {
		t.Fatal("team leadership query must include broker and pipeline scopes")
	}
	brokerScope := query[start:end]
	for _, required := range []string{
		"join public.organization_members om",
		"om.organization_id = member.organization_id",
		"om.user_id = member.user_id",
		"om.is_active = true",
		"om.deleted_at is null",
		"coalesce(u.is_active, false) = true",
	} {
		if !strings.Contains(brokerScope, required) {
			t.Errorf("led broker scope lacks %q", required)
		}
	}
	if strings.Contains(brokerScope, "u.organization_id = member.organization_id") {
		t.Fatal("multi-organization brokers must be scoped by active membership, not primary profile organization")
	}
}
