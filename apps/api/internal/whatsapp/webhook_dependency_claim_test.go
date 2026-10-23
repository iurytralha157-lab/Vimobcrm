package whatsapp

import (
	"strings"
	"testing"
)

func TestWebhookDependencyWalkIsScopedAndBounded(t *testing.T) {
	query := strings.ToLower(strings.Join(strings.Fields(transitiveEvolutionWebhookDependencyQuery), " "))
	for _, guard := range []string{
		"with recursive dependency_chain",
		"dependency_predecessor.organization_id = head.organization_id",
		"dependency_predecessor.session_id = ws.id",
		"dependency_predecessor.processing_epoch = head.processing_epoch",
		"dependency_predecessor.event_key = nullif(descendant.snapshot->>'predecessor_inbox_event_key', '')",
		"dependency_predecessor.processing_lane = 'backlog'",
		"dependency_predecessor.event_type = 'message'",
		"dependency_predecessor.provider = 'evolution_go'",
		"dependency_predecessor.status in ('pending', 'retry')",
		"dependency_predecessor.edge_execution_id is null",
		"dependency_predecessor.attempts < dependency_predecessor.max_attempts",
		"dependency_predecessor.next_attempt_at <= now()",
		"else 0 end = 1",
		"), '__session__') = head.routing_key",
		"predecessor_route.snapshot->>'binding_eligible' = 'true'",
		"nullif(predecessor_route.snapshot->>'provider_message_id', '') = nullif(descendant.snapshot->>'predecessor_provider_message_id', '')",
		"(dependency_predecessor.created_at, dependency_predecessor.id) < (descendant.created_at, descendant.id)",
		"descendant.depth < 32",
		"not (dependency_predecessor.id = any(descendant.visited))",
		"dependency_outcome.organization_id = head.organization_id",
		"dependency_outcome.session_id = ws.id",
		"ancestor.id = head.id and ancestor.depth > 0",
	} {
		if !strings.Contains(query, guard) {
			t.Errorf("transitive dependency walk is missing %q", guard)
		}
	}
	for _, mutation := range []string{"update public.", "insert into", "delete from", "set status"} {
		if strings.Contains(query, mutation) {
			t.Fatalf("dependency selection must not recover or complete predecessors: %s", mutation)
		}
	}
}
