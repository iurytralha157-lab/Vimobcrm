package whatsapp

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

func TestPrivateCollisionEligibilityKeepsInboundOrganicAndFrozen(t *testing.T) {
	message := nativeEvolutionMessage{ProviderMessageID: "synthetic-message", RemoteJID: "5511980000101@s.whatsapp.net", SentAt: time.Now()}
	snapshot := nativeIngressRoutingSnapshot{
		RawSnapshot: json.RawMessage(`{"version":1}`), State: "lead_match", TargetMode: "snapshot", BindingEligible: true,
		ProviderMessageID: message.ProviderMessageID, IngressSequence: 1, RoutingKey: "phone:5511980000101",
		ContextKind: "organic", EventLeadID: "synthetic-lead", ConversationID: "synthetic-conversation",
	}
	if !nativePrivateCollisionEligible(message, &snapshot) {
		t.Fatal("valid organic inbound lead collision was excluded")
	}
	if repo := NewRepository(nil, nil, StorageConfig{}); repo.privateCollisionCaptureEnabled {
		t.Fatal("private collision emission must default off")
	}
	if _, handled, err := ensureNativePrivateCollisionConversation(context.Background(), nil, nativeEvolutionSession{}, message,
		nativeEvolutionStoredMessageIdentity{}, &snapshot); handled || err != nil {
		t.Fatalf("disabled emission accessed a new private route: %v/%v", handled, err)
	}
	for _, name := range []string{"outbound", "group", "reaction", "deletion", "timestamp", "context", "managed", "bound", "v1", "missing-frozen", "provider-id", "session-route"} {
		t.Run(name, func(t *testing.T) {
			m, s := message, snapshot
			switch name {
			case "outbound":
				m.FromMe = true
			case "group":
				m.IsGroup = true
			case "reaction":
				m.IsReaction = true
			case "deletion":
				m.IsDeletion = true
			case "timestamp":
				m.ProviderTimestampMissing = true
			case "context":
				s.ContextKind = "contextual_intake"
			case "managed":
				s.ManagedProviderEventPending = true
			case "bound":
				s.CurrentLeadID = "another-lead"
			case "v1":
				s.UnlinkedCapturePolicy = "v1"
			case "missing-frozen":
				s.ConversationID = ""
			case "provider-id":
				s.ProviderMessageID = "another-message"
			case "session-route":
				s.RoutingKey = evolutionWebhookSessionRoute
			}
			if nativePrivateCollisionEligible(m, &s) {
				t.Fatal("ineligible private recovery was accepted")
			}
		})
	}
}
