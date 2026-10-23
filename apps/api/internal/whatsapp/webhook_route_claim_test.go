package whatsapp

import (
	"strings"
	"testing"
)

func TestWebhookRouteClaimSeparatesReservationFromFreshClaim(t *testing.T) {
	source := readWhatsAppSourceFunction(t, "webhook_worker.go", "func claimEvolutionWebhooksInLaneSegment")
	reserve := strings.Index(source, "reserveEvolutionWebhookClaimSessions(")
	claim := strings.Index(source, "tx.Query(ctx, claimReservedEvolutionWebhooksQuery")
	if reserve < 0 || claim <= reserve || !strings.Contains(source, "reservedSessionIDs") {
		t.Fatal("the session mutex must be acquired in a separate statement before the READ COMMITTED claim")
	}
	for _, name := range []string{"func (repo Repository) claimEvolutionWebhooksForLane", "func (repo Repository) claimEvolutionWebhooksForWorker"} {
		transaction := readWhatsAppSourceFunction(t, "webhook_worker.go", name)
		if !strings.Contains(transaction, "IsoLevel: pgx.ReadCommitted") {
			t.Fatalf("%s must explicitly request a fresh READ COMMITTED statement snapshot", name)
		}
	}
}

func TestWebhookRouteClaimLocksOnlyEligibleRouteHeadsBeforeLimit(t *testing.T) {
	query := strings.ToLower(strings.Join(strings.Fields(claimEvolutionWebhooksQuery), " "))
	for _, fragment := range []string{
		"join public.whatsapp_webhook_inbox claim_head on claim_head.id = head.id",
		"limit 1 for update of claim_head skip locked",
		"older.processing_lane = wi.processing_lane",
		"(older.created_at, older.id) < (wi.created_at, wi.id)",
		"older.status in ('pending', 'retry')",
		"limit $1 for share of ws skip locked",
	} {
		if !strings.Contains(query, fragment) {
			t.Fatalf("route-isolated claim is missing %q", fragment)
		}
	}
	if strings.Contains(query, "older.next_attempt_at <= now()") {
		t.Fatal("a deferred same-route predecessor must still block its successor")
	}
	if due, active, limit := strings.Index(query, "where head.next_attempt_at <= now()"),
		strings.Index(query, "active.session_id = ws.id"), strings.Index(query, "limit 1 for update of claim_head skip locked"); due < 0 || active < due || limit <= active {
		t.Fatal("due and active-route eligibility must be tested before choosing a session's head")
	}
}

func TestWebhookRouteClaimReservationScopesMutexAndClaim(t *testing.T) {
	reservation := strings.ToLower(strings.Join(strings.Fields(reserveEvolutionWebhookClaimSessionsQuery), " "))
	for _, fragment := range []string{
		"pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(",
		"'vimob:whatsapp-webhook:claim:' || ws.organization_id::text || ':' || ws.id::text",
		"limit $1 for share of ws skip locked",
		"select session_id::text from candidate_sessions order by session_id",
	} {
		if !strings.Contains(reservation, fragment) {
			t.Fatalf("reservation lacks scoped short claim fence %q", fragment)
		}
	}
	if got := strings.Count(claimReservedEvolutionWebhooksQuery, "ws.id = any($5::uuid[])"); got != 1 {
		t.Fatalf("reserved-session claim predicates = %d, want exactly one", got)
	}
	if strings.Contains(reservation, "set status = 'processing'") {
		t.Fatal("reservation must not update a lease before the fresh claim statement")
	}
}
