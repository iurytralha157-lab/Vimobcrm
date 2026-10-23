package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const postFormPolicyTestContent = "Olá! Preenchi seu formulário e gostaria de saber mais sobre sua empresa.\nPhone number: +55 11 99999-1111\nQuando pretende comprar: Este ano\nFull name: Contato de teste"

func postFormPolicyTestMessage() nativeEvolutionMessage {
	return nativeEvolutionMessage{
		ProviderMessageID: "post-form-policy-provider-id", ContactPhone: "5511999991111",
		Content: postFormPolicyTestContent, IsCTWAAd: true,
		CTWAConfirmationMethod: "entry_point_ctwa_ad", CampaignSourceType: "ad",
		CampaignEntryPointConversionSource: "ctwa_ad", CampaignSourceID: "12345678",
		SentAt: time.Date(2026, 10, 16, 12, 0, 0, 0, time.UTC),
	}
}

func TestPostFormIntakePolicyKeepsProviderEvidenceAndOrdinaryCTWA(t *testing.T) {
	message := postFormPolicyTestMessage()
	before := message
	if nativeCTWAIntakeEligible(message) {
		t.Fatal("structured post-form follow-up must not enter automatic intake")
	}
	if !reflect.DeepEqual(message, before) || nativeCTWAAdConfirmationMethod(message) != "entry_point_ctwa_ad" {
		t.Fatal("intake policy must preserve provider attribution and CTWA proof")
	}
	for name, mutate := range map[string]func(*nativeEvolutionMessage){
		"ordinary ad":                func(m *nativeEvolutionMessage) { m.Content = "Tenho interesse no apartamento" },
		"intro only":                 func(m *nativeEvolutionMessage) { m.Content = strings.Split(postFormPolicyTestContent, "\n")[0] },
		"quoted envelope":            func(m *nativeEvolutionMessage) { m.Content = "Segue um exemplo:\n" + m.Content },
		"outbound is not classified": func(m *nativeEvolutionMessage) { m.FromMe = true },
		"group is not classified":    func(m *nativeEvolutionMessage) { m.IsGroup = true },
		"reaction is not classified": func(m *nativeEvolutionMessage) { m.IsReaction = true },
		"deletion is not classified": func(m *nativeEvolutionMessage) { m.IsDeletion = true },
	} {
		t.Run(name, func(t *testing.T) {
			m := message
			mutate(&m)
			if nativePostFormFollowUp(m) || !nativeCTWAIntakeEligible(m) {
				t.Fatal("narrow post-form policy changed another event category")
			}
		})
	}
	message.IsCTWAAd = false
	if nativePostFormFollowUp(message) || nativeCTWAIntakeEligible(message) {
		t.Fatal("ordinary messages must retain their original non-CTWA policy")
	}
}

type postFormPolicyRow struct{ err error }

func (row postFormPolicyRow) Scan(dest ...any) error {
	if row.err != nil {
		return row.err
	}
	*dest[0].(*string) = "test-owner"
	return nil
}

type postFormPolicyTx struct {
	pgx.Tx
	queryErr error
	queries  []string
	writes   []string
	args     [][]any
}

func (tx *postFormPolicyTx) QueryRow(_ context.Context, sql string, _ ...any) pgx.Row {
	tx.queries = append(tx.queries, sql)
	return postFormPolicyRow{err: tx.queryErr}
}

func (tx *postFormPolicyTx) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	tx.writes = append(tx.writes, sql)
	tx.args = append(tx.args, args)
	return pgconn.NewCommandTag("UPDATE 1"), nil
}

func TestPostFormIntakePolicyRejectsCreationBeforeAnyDatabaseCall(t *testing.T) {
	ctx := context.Background()
	message := postFormPolicyTestMessage()
	session := nativeEvolutionSession{OrganizationID: "test-organization", OwnerUserID: "test-owner"}
	tx := &postFormPolicyTx{queryErr: errors.New("unexpected database access")}
	lead, err := createAuthorizedNativeLead(ctx, tx, session, message, nativeInboundRule{})
	if err != nil || lead.ID != "" || len(tx.queries) != 0 || len(tx.writes) != 0 {
		t.Fatalf("post-form creation was not a no-op: lead=%+v err=%v queries=%d writes=%d", lead, err, len(tx.queries), len(tx.writes))
	}

	message.Content = "Quero conhecer este imóvel"
	if _, err = createAuthorizedNativeLead(ctx, tx, session, message, nativeInboundRule{}); !errors.Is(err, tx.queryErr) || len(tx.queries) != 1 {
		t.Fatal("ordinary CTWA must still enter the existing authorized creation path")
	}
}

func TestPostFormIntakePolicySkipsRulesAndLeadEntryEffects(t *testing.T) {
	message := postFormPolicyTestMessage()
	rules := []nativeInboundRule{
		{ID: "managed", MatchType: "contains", MatchField: "message", MatchValue: "formulário", ManagedMessageDistribution: true, TargetRoundRobinID: "queue"},
		{ID: "manual", MatchType: "all"},
	}
	if got := selectNativeInboundRule(rules, message); got.ID != "" {
		t.Fatalf("post-form follow-up selected an intake rule: %+v", got)
	}
	ordinary := message
	ordinary.Content = "Tenho interesse; o formulário foi enviado"
	if got := selectNativeInboundRule(rules, ordinary); got.ID != "managed" {
		t.Fatalf("ordinary CTWA lost its managed rule: %+v", got)
	}

	tx := &postFormPolicyTx{}
	err := applyNativeInboundBusinessEffects(context.Background(), tx, nativeEvolutionSession{ID: "session", OrganizationID: "organization"},
		nativeEvolutionConversation{ID: "conversation", LeadID: "lead", MessageLeadID: "lead"}, message, "message-row", nativeInboundRule{}, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(tx.writes) != 3 {
		t.Fatalf("expected inbound transport log and last-contact update, got %d writes", len(tx.writes))
	}
	for _, sql := range tx.writes {
		for _, forbidden := range []string{"lead_entry_events", "lead_meta", "process_managed_whatsapp", "round_robins", "insert into public.leads", "meta_creative"} {
			if strings.Contains(sql, forbidden) {
				t.Fatalf("post-form follow-up caused lead-intake effects: %s", forbidden)
			}
		}
	}
	var metadata map[string]any
	if err := json.Unmarshal([]byte(tx.args[2][3].(string)), &metadata); err != nil {
		t.Fatal(err)
	}
	if _, overwritten := metadata["whatsapp_attribution"]; overwritten {
		t.Fatal("follow-up must not overwrite the existing lead's attribution")
	}
}

func TestPostFormIntakePolicyKeepsUnlinkedAndExistingLeadMessagesVisible(t *testing.T) {
	message := postFormPolicyTestMessage()
	snapshot := nativeIngressRoutingSnapshot{
		State: "unlinked", TargetMode: "snapshot", ContextKind: "organic", ContextProof: nativePostFormFollowUpProof,
		ProviderMessageID: message.ProviderMessageID, ConversationID: "conversation", UnlinkedCapturePolicy: "v1",
	}
	conversation := nativeEvolutionConversation{ID: "conversation"}
	if got := nativeEvolutionCaptureState("", conversation, message, &snapshot, false); got != "unlinked_ephemeral" {
		t.Fatalf("post-form message without lead must stay visible, got %q", got)
	}
	snapshot.State = "bound"
	snapshot.EventLeadID, snapshot.CurrentLeadID, snapshot.ActiveBindingID = "lead", "lead", "binding"
	conversation.LeadID, conversation.MessageLeadID = "lead", "lead"
	if got := nativeEvolutionCaptureState("", conversation, message, &snapshot, false); got != "observed_unattended" {
		t.Fatalf("post-form message for existing card without attendance must stay visible, got %q", got)
	}
	if got := nativeEvolutionCaptureState("attendance", conversation, message, &snapshot, false); got != "captured" {
		t.Fatalf("existing active attendance must keep normal capture, got %q", got)
	}
	snapshot.State, snapshot.CurrentLeadID, snapshot.ActiveBindingID = "lead_match", "", ""
	snapshot.ConversationID, snapshot.InboxEventKey, snapshot.CapturedAt = "", "inbox", message.SentAt
	conversation.ActiveBindingID = "binding"
	if got := nativeEvolutionCaptureState("", conversation, message, &snapshot, false); got != "observed_unattended" {
		t.Fatalf("first trusted match to an existing lead must stay visible, got %q", got)
	}
	conversation.LeadIsNew = true
	if nativeCTWAAutoAttendanceEligible(conversation, message, nativeEvolutionStoredMessageIdentity{}, "binding", message.SentAt.Add(time.Second), 1) {
		t.Fatal("post-form message must not auto-enter CTWA attendance")
	}
}

func TestPostFormIntakePolicyRejectsUnprovenOrAlteredMarkers(t *testing.T) {
	message := postFormPolicyTestMessage()
	base := nativeIngressRoutingSnapshot{State: "unlinked", TargetMode: "snapshot", ContextKind: "organic", ContextProof: nativePostFormFollowUpProof,
		ProviderMessageID: message.ProviderMessageID, ConversationID: "conversation", UnlinkedCapturePolicy: "v1"}
	for name, mutate := range map[string]func(*nativeEvolutionMessage, *nativeIngressRoutingSnapshot){
		"unknown proof": func(_ *nativeEvolutionMessage, s *nativeIngressRoutingSnapshot) {
			s.ContextProof = "post_form_followup_v2"
		},
		"empty proof with CTWA":       func(_ *nativeEvolutionMessage, s *nativeIngressRoutingSnapshot) { s.ContextProof = "" },
		"normal CTWA with marker":     func(m *nativeEvolutionMessage, _ *nativeIngressRoutingSnapshot) { m.Content = "Olá" },
		"outbound with marker":        func(m *nativeEvolutionMessage, _ *nativeIngressRoutingSnapshot) { m.FromMe = true },
		"group with marker":           func(m *nativeEvolutionMessage, _ *nativeIngressRoutingSnapshot) { m.IsGroup = true },
		"managed rule with marker":    func(_ *nativeEvolutionMessage, s *nativeIngressRoutingSnapshot) { s.ManagedMessageDistribution = true },
		"queue with marker":           func(_ *nativeEvolutionMessage, s *nativeIngressRoutingSnapshot) { s.OriginRoundRobinID = "queue" },
		"contextual kind with marker": func(_ *nativeEvolutionMessage, s *nativeIngressRoutingSnapshot) { s.ContextKind = "contextual_intake" },
	} {
		t.Run(name, func(t *testing.T) {
			m, s := message, base
			mutate(&m, &s)
			if nativeOrganicRoutingProofMatchesMessage(&s, m) {
				t.Fatal("unproven post-form marker was accepted")
			}
			if got := nativeEvolutionCaptureState("", nativeEvolutionConversation{ID: "conversation"}, m, &s, false); got != "suppressed" {
				t.Fatalf("unproven marker changed fail-closed capture: %q", got)
			}
		})
	}
}

func TestPostFormIntakePolicyPreservesFrozenLegacyIntake(t *testing.T) {
	message := postFormPolicyTestMessage()
	if !nativeCTWAIntakeEligible(nativeMessageWithAcceptedIntakePolicy(message, nil, nativeInboundRule{})) {
		t.Fatal("unfrozen compatibility deliveries must preserve legacy intake until authority marks a new snapshot")
	}
	for _, proof := range []string{nativeCanonicalIntakeProofV1 + "entry_point_ctwa_ad", "managed_rule", "provider_event_ledger"} {
		snapshot := nativeIngressRoutingSnapshot{ContextKind: "contextual_intake", ContextProof: proof}
		before := snapshot
		replay := nativeMessageWithAcceptedIntakePolicy(message, &snapshot, nativeInboundRule{})
		if !nativeCTWAIntakeEligible(replay) || !reflect.DeepEqual(before, snapshot) {
			t.Fatal("accepted contextual intake must preserve its durable replay semantics")
		}
		if got := nativeEvolutionCaptureState("", nativeEvolutionConversation{ID: "conversation"}, replay, &snapshot, false); got != "suppressed" {
			t.Fatal("legacy contextual event must never be reinterpreted as a new unlinked message")
		}
	}
	for _, rule := range []nativeInboundRule{{ManagedProviderEventPending: true}, {ManagedProviderEventHandled: true}} {
		if !nativeCTWAIntakeEligible(nativeMessageWithAcceptedIntakePolicy(message, nil, rule)) {
			t.Fatal("accepted provider ledger must preserve retry semantics")
		}
	}
	newSnapshot := nativeIngressRoutingSnapshot{ContextKind: "organic", ContextProof: nativePostFormFollowUpProof}
	if nativeCTWAIntakeEligible(nativeMessageWithAcceptedIntakePolicy(message, &newSnapshot, nativeInboundRule{})) {
		t.Fatal("new marked follow-up must remain outside automatic intake")
	}
}

func TestPostFormIntakePolicyIngressActivationPreservesMixedVersionCompatibility(t *testing.T) {
	postForm := postFormPolicyTestMessage()
	ordinary := postForm
	ordinary.Content = "Tenho interesse no imóvel"
	organic := postForm
	organic.IsCTWAAd = false
	canonicalProof := nativeCanonicalIntakeProofV1 + "entry_point_ctwa_ad"
	for _, test := range []struct {
		name    string
		enabled bool
		message nativeEvolutionMessage
		kind    string
		proof   string
	}{
		{"disabled keeps the former post-form route", false, postForm, "contextual_intake", canonicalProof},
		{"enabled marks the post-form continuation", true, postForm, "organic", nativePostFormFollowUpProof},
		{"disabled keeps normal CTWA", false, ordinary, "contextual_intake", canonicalProof},
		{"enabled keeps normal CTWA", true, ordinary, "contextual_intake", canonicalProof},
		{"enabled keeps organic messages", true, organic, "organic", ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			message := nativeIngressMessageWithPostFormGuard(test.message, test.enabled)
			kind, proof, err := nativeEvolutionIngressContext(message, nativeInboundRule{}, canonicalProof)
			if err != nil || kind != test.kind || proof != test.proof {
				t.Fatalf("context = (%q, %q, %v), want (%q, %q)", kind, proof, err, test.kind, test.proof)
			}
			if message.IsCTWAAd != test.message.IsCTWAAd || message.CTWAConfirmationMethod != test.message.CTWAConfirmationMethod {
				t.Fatal("activation must never rewrite provider CTWA evidence")
			}
		})
	}
	managed := nativeInboundRule{ID: "managed", ManagedMessageDistribution: true, MatchType: "contains", MatchField: "message", MatchValue: "formulário"}
	if got := selectNativeInboundRule([]nativeInboundRule{managed}, nativeIngressMessageWithPostFormGuard(postForm, false)); got.ID != "managed" {
		t.Fatal("disabled activation must retain the former managed-rule selection")
	}
	if got := selectNativeInboundRule([]nativeInboundRule{managed}, nativeIngressMessageWithPostFormGuard(postForm, true)); got.ID != "" {
		t.Fatal("enabled activation must exclude the structured continuation from intake rules")
	}
	for _, enabled := range []bool{false, true} {
		repo := NewRepository(nil, nil, StorageConfig{WhatsAppPostFormFollowUpGuardEnabled: enabled})
		if repo.postFormGuardEnabled != enabled {
			t.Fatal("repository lost its immutable ingress activation configuration")
		}
	}
}

func TestPostFormIntakePolicyValidatesMarkerAtSnapshotBoundary(t *testing.T) {
	session := nativeEvolutionSession{ID: "22222222-2222-4222-8222-222222222222", OrganizationID: "11111111-1111-4111-8111-111111111111"}
	message := postFormPolicyTestMessage()
	row := nativeRoutingSnapshotTestRow(message.ProviderMessageID, 1)
	row["context_proof"] = nativePostFormFollowUpProof
	if _, err := nativeIngressRoutingSnapshotForMessage(nativeRoutingSnapshotTestPayload(t, row), session, message); err != nil {
		t.Fatalf("valid marked follow-up snapshot rejected: %v", err)
	}
	message.Content = "Tenho interesse neste imóvel"
	if _, err := nativeIngressRoutingSnapshotForMessage(nativeRoutingSnapshotTestPayload(t, row), session, message); err == nil {
		t.Fatal("marker must be checked against the actual structured provider message")
	}
}
