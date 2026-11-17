package whatsapp

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

const syntheticLegacyOutboundLID = "700000001234567@lid"

func syntheticLegacyOutbound(t *testing.T, providerID, recipient string) (map[string]any, nativeEvolutionMessage) {
	t.Helper()
	payload := map[string]any{"event": "message", "data": map[string]any{
		"Info": map[string]any{"ID": providerID, "Chat": syntheticLegacyOutboundLID,
			"Sender": "5511980000199:1@s.whatsapp.net", "RecipientAlt": recipient,
			"IsFromMe": true, "IsGroup": false, "Timestamp": time.Now().UTC().Format(time.RFC3339Nano)},
		"Message": map[string]any{"conversation": "Synthetic external echo"},
	}}
	messages := extractNativeEvolutionMessages(payload)
	if len(messages) != 1 {
		t.Fatalf("outbound parser messages=%d", len(messages))
	}
	return payload, messages[0]
}

func TestPrivateLegacyOutboundRequiresOriginalRecipientProof(t *testing.T) {
	_, message := syntheticLegacyOutbound(t, "synthetic-outbound", "5511980000101@s.whatsapp.net")
	if !message.FromMe || message.UnsupportedID || message.ContactPhone == "" || message.IdentityPNConflict || message.MessageType != "text" {
		t.Fatal("complete outbound Info must normalize RecipientAlt as the contact PN")
	}
	snapshot := nativeIngressRoutingSnapshot{RawSnapshot: json.RawMessage(`{"version":1}`), State: "lead_match", TargetMode: "snapshot",
		ProviderMessageID: message.ProviderMessageID, IngressSequence: 1, RoutingKey: "jid:" + syntheticLegacyOutboundLID,
		ContextKind: "organic", EventLeadID: "synthetic-lead", ConversationID: "synthetic-conversation"}
	if !nativePrivateLegacyOutboundEligible(message, &snapshot) || nativePrivateCollisionEligible(message, &snapshot) {
		t.Fatal("external outbound candidate crossed the binding-eligible PN contract")
	}
	if _, handled, err := ensureNativePrivateLegacyOutboundConversation(context.Background(), nil, nativeEvolutionSession{}, message, nativeEvolutionStoredMessageIdentity{}, &snapshot); handled || err != nil {
		t.Fatal("disabled external outbound emission accessed a new route")
	}
	for _, name := range []string{"inbound", "recipient-missing", "recipient-different", "chat-PN", "binding", "inherit", "group", "reaction", "deletion", "unsupported", "timestamp", "campaign", "managed", "bound", "v1", "conversation", "provider-id", "session-route", "conflict"} {
		t.Run(name, func(t *testing.T) {
			m, s := message, snapshot
			m.Raw = map[string]any{"Info": map[string]any{"Chat": syntheticLegacyOutboundLID, "RecipientAlt": message.RemoteJID}}
			info := m.Raw["Info"].(map[string]any)
			switch name {
			case "inbound":
				m.FromMe = false
			case "recipient-missing":
				delete(info, "RecipientAlt")
			case "recipient-different":
				info["RecipientAlt"] = "5511980000102@s.whatsapp.net"
			case "chat-PN":
				info["Chat"] = message.RemoteJID
			case "binding":
				s.BindingEligible = true
			case "inherit":
				s.State, s.TargetMode = "predecessor_inherit", "inherit_predecessor"
			case "group":
				m.IsGroup = true
			case "reaction":
				m.IsReaction = true
			case "deletion":
				m.IsDeletion = true
			case "unsupported":
				m.UnsupportedMessage = true
			case "timestamp":
				m.ProviderTimestampMissing = true
			case "campaign":
				m.IsCTWAAd = true
			case "managed":
				s.ManagedProviderEventPending = true
			case "bound":
				s.CurrentLeadID = "other-lead"
			case "v1":
				s.UnlinkedCapturePolicy = "v1"
			case "conversation":
				s.ConversationID = ""
			case "provider-id":
				m.ProviderMessageIDSynthetic = true
			case "session-route":
				s.RoutingKey = evolutionWebhookSessionRoute
			case "conflict":
				m.IdentityPNConflict = true
			}
			if nativePrivateLegacyOutboundEligible(m, &s) {
				t.Fatal("invalid external outbound proof was accepted")
			}
		})
	}
}
