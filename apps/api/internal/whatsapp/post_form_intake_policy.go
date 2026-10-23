package whatsapp

import (
	"errors"
	"strings"
)

// Emission is opt-in until every Go/Edge reader supports this organic proof.
// Disabling emission does not rewrite accepted snapshots: drain their retries
// before downgrading readers. No schema or Meta form-intake change is required.
const nativePostFormFollowUpProof = "post_form_followup_v1"

func nativeIngressMessageWithPostFormGuard(message nativeEvolutionMessage, enabled bool) nativeEvolutionMessage {
	if !enabled && nativePostFormFollowUp(message) {
		message.legacyContextualIntake = true
	}
	return message
}

func nativeEvolutionIngressContext(message nativeEvolutionMessage, rule nativeInboundRule, canonicalIntakeProof string) (string, string, error) {
	if rule.ManagedMessageDistribution {
		return "contextual_intake", "managed_rule", nil
	}
	if strings.TrimSpace(rule.ManagedProviderEventLeadID) != "" {
		return "contextual_intake", "provider_event_ledger", nil
	}
	if nativeCTWAIntakeEligible(message) {
		if canonicalIntakeProof == "" {
			return "", "", errors.New("click-to-WhatsApp intake is missing canonical provider proof")
		}
		return "contextual_intake", canonicalIntakeProof, nil
	}
	if nativePostFormFollowUp(message) {
		return "organic", nativePostFormFollowUpProof, nil
	}
	return "organic", "", nil
}

// A structured follow-up is still an attributed WhatsApp message. Only its
// automatic lead-intake effects are excluded; provider evidence stays intact.
func nativePostFormFollowUp(message nativeEvolutionMessage) bool {
	return message.IsCTWAAd && !message.FromMe && !message.IsGroup &&
		!message.IsReaction && !message.IsDeletion &&
		isWhatsAppPostFormFollowUp(message.Content)
}

func nativeCTWAIntakeEligible(message nativeEvolutionMessage) bool {
	return message.IsCTWAAd && (message.legacyContextualIntake || !nativePostFormFollowUp(message))
}

// The restriction is prospective. Unfrozen compatibility deliveries and a
// durable intake decision retain their original replay/capture semantics. Only
// a newly marked authoritative ingress snapshot activates the guard.
func nativeMessageWithAcceptedIntakePolicy(message nativeEvolutionMessage, snapshot *nativeIngressRoutingSnapshot, rule nativeInboundRule) nativeEvolutionMessage {
	message.legacyContextualIntake = snapshot == nil || (snapshot.ContextKind == "contextual_intake" && snapshot.ContextProof != "") ||
		rule.ManagedProviderEventPending || rule.ManagedProviderEventHandled
	return message
}

func nativeOrganicRoutingProofMatchesMessage(snapshot *nativeIngressRoutingSnapshot, message nativeEvolutionMessage) bool {
	if snapshot == nil || snapshot.ContextKind != "organic" {
		return false
	}
	if snapshot.ContextProof == "" {
		return !message.IsCTWAAd
	}
	return snapshot.ContextProof == nativePostFormFollowUpProof &&
		!message.legacyContextualIntake && nativePostFormRoutingProofValid(snapshot, message)
}

func nativePostFormRoutingProofValid(snapshot *nativeIngressRoutingSnapshot, message nativeEvolutionMessage) bool {
	return snapshot == nil || snapshot.ContextProof != nativePostFormFollowUpProof ||
		(snapshot.ContextKind == "organic" && nativePostFormFollowUp(message) &&
			!snapshot.ManagedMessageDistribution && !snapshot.ManagedProviderEventPending &&
			!snapshot.ManagedProviderEventHandled && snapshot.RuleID == "" && snapshot.OriginRoundRobinID == "")
}
