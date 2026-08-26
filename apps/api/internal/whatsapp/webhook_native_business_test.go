package whatsapp

import (
	"strings"
	"testing"
)

func TestNativeInboundRuleMatchesWhatsAppMessageCaseInsensitive(t *testing.T) {
	rule := nativeInboundRule{
		MatchType:  "contains",
		MatchField: "message",
		MatchValue: "QUERO CONHECER",
	}

	if !nativeInboundRuleMatches(rule, nativeEvolutionMessage{Content: "Olá, quero conhecer o imóvel"}) {
		t.Fatal("expected the initial WhatsApp message to match without case sensitivity")
	}
	if nativeInboundRuleMatches(rule, nativeEvolutionMessage{
		Content:          "Olá",
		CampaignHeadline: "Quero conhecer",
	}) {
		t.Fatal("expected message matching not to inspect the campaign name")
	}
}

func TestManagedWhatsAppDistributionPreservesDatabaseQueueTarget(t *testing.T) {
	rule := nativeInboundRule{
		TargetRoundRobinID:         "managed-queue",
		ManagedMessageDistribution: true,
	}
	assignment := nativeLeadAssignment{RoundRobinID: "runtime-queue"}
	if got := nativeTargetRoundRobinID(rule, assignment); got != "managed-queue" {
		t.Fatalf("nativeTargetRoundRobinID() = %q, want managed queue", got)
	}
}

func TestManagedWhatsAppDistributionFailsClosedForLegacyWildcardSession(t *testing.T) {
	if !strings.Contains(nativeInboundRulesQuery, "coalesce(session_id = $2::uuid, false) and (") {
		t.Fatal("managed WhatsApp distribution must treat a legacy NULL session as false")
	}
	if !strings.Contains(nativeInboundRulesQuery, "and (session_id is null or session_id = $2::uuid)") {
		t.Fatal("legacy wildcard rules must remain readable for their existing non-managed behavior")
	}
}
