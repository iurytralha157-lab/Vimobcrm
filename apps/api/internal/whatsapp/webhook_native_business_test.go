package whatsapp

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type nativeHandledTransportTestExecutor struct {
	calls int
	query string
	args  []any
	err   error
}

type nativeHandledAutoReplyTestQuerier struct {
	calls          int
	query          string
	args           []any
	conversationID string
	messageID      string
	text           string
	err            error
}

type nativeHandledAutoReplyTestRow struct {
	conversationID string
	messageID      string
	text           string
	err            error
}

func (querier *nativeHandledAutoReplyTestQuerier) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	querier.calls++
	querier.query = query
	querier.args = args
	return nativeHandledAutoReplyTestRow{
		conversationID: querier.conversationID,
		messageID:      querier.messageID,
		text:           querier.text,
		err:            querier.err,
	}
}

func (row nativeHandledAutoReplyTestRow) Scan(dest ...any) error {
	if row.err != nil {
		return row.err
	}
	values := []string{row.conversationID, row.messageID, row.text}
	if len(dest) != len(values) {
		return fmt.Errorf("scan destinations = %d, want %d", len(dest), len(values))
	}
	for index, value := range values {
		target, ok := dest[index].(*string)
		if !ok {
			return fmt.Errorf("scan destination %d is %T, want *string", index, dest[index])
		}
		*target = value
	}
	return nil
}

func (executor *nativeHandledTransportTestExecutor) Exec(_ context.Context, query string, arguments ...any) (pgconn.CommandTag, error) {
	executor.calls++
	executor.query = query
	executor.args = arguments
	return pgconn.NewCommandTag("UPDATE 1"), executor.err
}

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

func TestSelectNativeInboundRuleRespectsPriorityAndCatchAllException(t *testing.T) {
	message := nativeEvolutionMessage{Content: "Olá, quero conhecer o imóvel"}
	managed := func(id string) nativeInboundRule {
		return nativeInboundRule{
			ID:                         id,
			MatchType:                  "contains",
			MatchField:                 "message",
			MatchValue:                 "quero conhecer",
			ManagedMessageDistribution: true,
		}
	}
	manualSpecific := func(id string) nativeInboundRule {
		return nativeInboundRule{
			ID:         id,
			MatchType:  "contains",
			MatchField: "message",
			MatchValue: "quero conhecer",
		}
	}
	manualCatchAll := nativeInboundRule{ID: "manual-catch-all", MatchType: "all"}

	tests := []struct {
		name   string
		rules  []nativeInboundRule
		wantID string
	}{
		{
			name:   "first matching managed rule wins",
			rules:  []nativeInboundRule{managed("managed-high"), manualSpecific("manual-low")},
			wantID: "managed-high",
		},
		{
			name:   "first matching specific manual rule is preserved",
			rules:  []nativeInboundRule{manualSpecific("manual-high"), managed("managed-low")},
			wantID: "manual-high",
		},
		{
			name: "manual catch-all yields only to lower managed rule",
			rules: []nativeInboundRule{
				manualCatchAll,
				manualSpecific("manual-specific-low"),
				managed("managed-low"),
			},
			wantID: "managed-low",
		},
		{
			name:   "lower specific manual rule never overtakes catch-all",
			rules:  []nativeInboundRule{manualCatchAll, manualSpecific("manual-specific-low")},
			wantID: "manual-catch-all",
		},
		{
			name: "higher non-matching rule does not block next matching rule",
			rules: []nativeInboundRule{
				{ID: "manual-non-match", MatchType: "contains", MatchField: "message", MatchValue: "outro texto"},
				managed("managed-match"),
			},
			wantID: "managed-match",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := selectNativeInboundRule(test.rules, message); got.ID != test.wantID {
				t.Fatalf("selectNativeInboundRule() ID = %q, want %q", got.ID, test.wantID)
			}
		})
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

func TestParseNativeManagedWhatsAppEntryLookup(t *testing.T) {
	tests := []struct {
		name      string
		raw       string
		want      nativeManagedWhatsAppEntryLookup
		wantError bool
	}{
		{
			name: "no prior provider event",
			raw:  `{"handled":false,"pending":false}`,
		},
		{
			name: "completed provider event",
			raw:  `{"handled":true,"pending":false,"lead_id":"lead-id","matched_rule_id":"rule-id","target_round_robin_id":"queue-id"}`,
			want: nativeManagedWhatsAppEntryLookup{
				Handled:       true,
				LeadID:        "lead-id",
				MatchedRuleID: "rule-id",
				TargetQueueID: "queue-id",
			},
		},
		{
			name: "legacy non-managed retry is a handled no-op without managed context",
			raw:  `{"handled":true,"pending":false,"legacy_non_managed_retry":true,"reason":"legacy_whatsapp_message_already_persisted","lead_id":null,"matched_rule_id":null,"target_round_robin_id":null}`,
			want: nativeManagedWhatsAppEntryLookup{
				Handled:               true,
				LegacyNonManagedRetry: true,
				Reason:                "legacy_whatsapp_message_already_persisted",
			},
		},
		{
			name: "pending provider event preserves original routing",
			raw:  `{"handled":false,"pending":true,"lead_id":"lead-id","matched_rule_id":"rule-id","target_round_robin_id":"queue-id"}`,
			want: nativeManagedWhatsAppEntryLookup{
				Pending:       true,
				LeadID:        "lead-id",
				MatchedRuleID: "rule-id",
				TargetQueueID: "queue-id",
			},
		},
		{
			name:      "pending cannot also be handled",
			raw:       `{"handled":true,"pending":true,"lead_id":"lead-id","matched_rule_id":"rule-id","target_round_robin_id":"queue-id"}`,
			wantError: true,
		},
		{
			name:      "pending requires frozen queue",
			raw:       `{"handled":false,"pending":true,"lead_id":"lead-id","matched_rule_id":"rule-id"}`,
			wantError: true,
		},
		{
			name:      "completed requires original context",
			raw:       `{"handled":true,"pending":false,"lead_id":"lead-id"}`,
			wantError: true,
		},
		{
			name:      "legacy marker requires handled",
			raw:       `{"handled":false,"pending":false,"legacy_non_managed_retry":true}`,
			wantError: true,
		},
		{
			name:      "quarantine cannot be reported as handled",
			raw:       `{"handled":true,"pending":false,"quarantine":true,"reason":"collision"}`,
			wantError: true,
		},
		{
			name: "quarantined miss remains a valid fail-closed lookup result",
			raw:  `{"handled":false,"pending":false,"quarantined":true,"reason":"legacy_whatsapp_intake_incomplete"}`,
			want: nativeManagedWhatsAppEntryLookup{Quarantined: true, Reason: "legacy_whatsapp_intake_incomplete"},
		},
		{name: "null is not a lookup object", raw: `null`, wantError: true},
		{name: "array is not a lookup object", raw: `[]`, wantError: true},
		{name: "invalid JSON", raw: `{`, wantError: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := parseNativeManagedWhatsAppEntryLookup([]byte(test.raw))
			if (err != nil) != test.wantError {
				t.Fatalf("parse lookup error = %v, wantError %t", err, test.wantError)
			}
			if got != test.want {
				t.Fatalf("parse lookup = %#v, want %#v", got, test.want)
			}
		})
	}
}

func TestNativeManagedWhatsAppLookupUsesImmutableProviderIdentity(t *testing.T) {
	for _, fragment := range []string{
		"public.lookup_managed_whatsapp_lead_entry",
		"p_organization_id => $1::uuid",
		"p_session_id => $2::uuid",
		"p_provider_message_id => $3",
		"p_message => $4",
	} {
		if !strings.Contains(nativeManagedWhatsAppEntryLookupQuery, fragment) {
			t.Fatalf("lookup SQL must contain %q", fragment)
		}
	}
}

func TestNativeManagedWhatsAppLookupFailsClosedBeforeRuleSelection(t *testing.T) {
	for _, lookup := range []nativeManagedWhatsAppEntryLookup{
		{Quarantine: true, Reason: "provider_message_collision"},
		{Quarantined: true, Reason: "legacy_whatsapp_intake_incomplete"},
		{Incomplete: true},
	} {
		if err := nativeManagedWhatsAppEntryLookupFailure(lookup); err == nil {
			t.Fatalf("lookup %#v must fail closed", lookup)
		}
	}
	if err := nativeManagedWhatsAppEntryLookupFailure(nativeManagedWhatsAppEntryLookup{}); err != nil {
		t.Fatalf("clean lookup miss returned error: %v", err)
	}
}

func TestNativeManagedWhatsAppDistributionRequiresRealProviderMessageID(t *testing.T) {
	managed := nativeInboundRule{ManagedMessageDistribution: true}
	if err := validateNativeManagedProviderMessageIdentity(nativeEvolutionMessage{
		ProviderMessageID:          "native-synthetic",
		ProviderMessageIDSynthetic: true,
	}, managed); err == nil {
		t.Fatal("new managed intake with a synthetic provider id must fail closed")
	}
	if err := validateNativeManagedProviderMessageIdentity(nativeEvolutionMessage{
		ProviderMessageID: "wamid.real",
	}, managed); err != nil {
		t.Fatalf("real provider id was rejected: %v", err)
	}
	if err := validateNativeManagedProviderMessageIdentity(nativeEvolutionMessage{
		ProviderMessageID:          "native-synthetic",
		ProviderMessageIDSynthetic: true,
	}, nativeInboundRule{}); err != nil {
		t.Fatalf("legacy non-managed behavior must remain unchanged: %v", err)
	}
}

func TestReconcileNativeHandledMessageTransportOnlyUpdatesExistingInboundMedia(t *testing.T) {
	session := nativeEvolutionSession{
		OrganizationID: "11111111-1111-4111-8111-111111111111",
		ID:             "22222222-2222-4222-8222-222222222222",
	}

	executor := &nativeHandledTransportTestExecutor{}
	if err := reconcileNativeHandledMessageTransport(context.Background(), executor, session, nativeEvolutionMessage{
		ProviderMessageID: "provider-text",
		MessageType:       "text",
	}); err != nil {
		t.Fatal(err)
	}
	if executor.calls != 0 {
		t.Fatalf("text duplicate executed %d transport updates, want 0", executor.calls)
	}

	if err := reconcileNativeHandledMessageTransport(context.Background(), executor, session, nativeEvolutionMessage{
		ProviderMessageID: "provider-media",
		MessageType:       "image",
		MediaURL:          "https://example.invalid/provider-media",
		MediaMimeType:     "image/jpeg",
		MediaStoragePath:  "orgs/111/sessions/222/incoming/provider-media.jpg",
		MediaSize:         123,
	}); err != nil {
		t.Fatal(err)
	}
	if executor.calls != 1 {
		t.Fatalf("media duplicate executed %d updates, want 1", executor.calls)
	}
	for _, fragment := range []string{
		"update public.whatsapp_messages",
		"message.organization_id = $1::uuid",
		"message.session_id = $2::uuid",
		"message.provider_message_id = $3 or message.message_id = $3",
		"coalesce(message.from_me, false) = false",
	} {
		if !strings.Contains(executor.query, fragment) {
			t.Fatalf("transport reconciliation query must contain %q", fragment)
		}
	}
	if strings.Contains(executor.query, "insert into") || strings.Contains(executor.query, "lead_id =") {
		t.Fatalf("handled transport reconciliation may not create or reroute business state: %s", executor.query)
	}
	if len(executor.args) != 7 || executor.args[0] != session.OrganizationID || executor.args[1] != session.ID || executor.args[2] != "provider-media" {
		t.Fatalf("unexpected transport reconciliation scope: %#v", executor.args)
	}
}

func TestRecoverNativeHandledAutoReplyInputIsTenantSessionAndProviderScoped(t *testing.T) {
	session := nativeEvolutionSession{
		OrganizationID: "11111111-1111-4111-8111-111111111111",
		ID:             "22222222-2222-4222-8222-222222222222",
	}
	querier := &nativeHandledAutoReplyTestQuerier{
		conversationID: "33333333-3333-4333-8333-333333333333",
		messageID:      "44444444-4444-4444-8444-444444444444",
		text:           "  Quero conhecer o imóvel  ",
	}

	input, ok, err := recoverNativeHandledAutoReplyInput(
		context.Background(),
		querier,
		session,
		"provider-message-id",
		"55555555-5555-4555-8555-555555555555",
	)
	if err != nil || !ok {
		t.Fatalf("recover handled auto-reply = ok:%t error:%v", ok, err)
	}
	if input.OrganizationID != session.OrganizationID || input.SessionID != session.ID ||
		input.ConversationID != querier.conversationID || input.MessageID != querier.messageID || input.Text != querier.text {
		t.Fatalf("unexpected recovered auto-reply input: %#v", input)
	}
	for _, fragment := range []string{
		"message.organization_id = $1::uuid",
		"message.session_id = $2::uuid",
		"message.provider_message_id = $3",
		"message.provider_message_id is null and message.message_id = $3",
		"conversation.organization_id = message.organization_id",
		"conversation.session_id = message.session_id",
		"message.lead_id = $4::uuid",
		"conversation.lead_id = $4::uuid",
		"coalesce(message.from_me, false) = false",
	} {
		if !strings.Contains(querier.query, fragment) {
			t.Fatalf("handled auto-reply recovery query must contain %q", fragment)
		}
	}
	if strings.Contains(querier.query, "insert into") || strings.Contains(querier.query, "update public") {
		t.Fatalf("handled auto-reply recovery must remain read-only: %s", querier.query)
	}
	if querier.calls != 1 || len(querier.args) != 4 || querier.args[0] != session.OrganizationID ||
		querier.args[1] != session.ID || querier.args[2] != "provider-message-id" ||
		querier.args[3] != "55555555-5555-4555-8555-555555555555" {
		t.Fatalf("unexpected handled auto-reply recovery scope: calls:%d args:%#v", querier.calls, querier.args)
	}
}

func TestRecoverNativeHandledAutoReplyInputSkipsMissingAndBlankMessages(t *testing.T) {
	session := nativeEvolutionSession{OrganizationID: "org", ID: "session"}

	missing := &nativeHandledAutoReplyTestQuerier{err: pgx.ErrNoRows}
	if input, ok, err := recoverNativeHandledAutoReplyInput(context.Background(), missing, session, "provider-id", "lead-id"); err != nil || ok || input != (autoReplyInput{}) {
		t.Fatalf("missing handled message = input:%#v ok:%t error:%v", input, ok, err)
	}

	blank := &nativeHandledAutoReplyTestQuerier{conversationID: "conversation", messageID: "message", text: " \r\n "}
	if input, ok, err := recoverNativeHandledAutoReplyInput(context.Background(), blank, session, "provider-id", "lead-id"); err != nil || ok || input != (autoReplyInput{}) {
		t.Fatalf("blank handled message = input:%#v ok:%t error:%v", input, ok, err)
	}

	emptyProvider := &nativeHandledAutoReplyTestQuerier{}
	if input, ok, err := recoverNativeHandledAutoReplyInput(context.Background(), emptyProvider, session, "  ", "lead-id"); err != nil || ok || input != (autoReplyInput{}) || emptyProvider.calls != 0 {
		t.Fatalf("empty provider id = input:%#v ok:%t error:%v calls:%d", input, ok, err, emptyProvider.calls)
	}

	emptyLead := &nativeHandledAutoReplyTestQuerier{}
	if input, ok, err := recoverNativeHandledAutoReplyInput(context.Background(), emptyLead, session, "provider-id", "  "); err != nil || ok || input != (autoReplyInput{}) || emptyLead.calls != 0 {
		t.Fatalf("empty handled lead id = input:%#v ok:%t error:%v calls:%d", input, ok, err, emptyLead.calls)
	}
}

func TestNativeManagedWhatsAppLookupShortCircuitsCompletedProviderEvent(t *testing.T) {
	if !nativeManagedProviderEventAlreadyHandled(nativeInboundRule{ManagedProviderEventHandled: true}) {
		t.Fatal("completed managed provider event must short-circuit before conversation and message effects")
	}
	if nativeManagedProviderEventAlreadyHandled(nativeInboundRule{ManagedProviderEventPending: true}) {
		t.Fatal("pending managed provider event must continue using its frozen routing context")
	}
	for _, fragment := range []string{
		"lead.organization_id = $1::uuid",
		"lead.id = $2::uuid",
	} {
		if !strings.Contains(nativeScopedManagedPendingLeadQuery, fragment) {
			t.Fatalf("pending lead lookup must contain %q", fragment)
		}
	}
}

func TestManagedWhatsAppInboundLogFreezesPendingContext(t *testing.T) {
	session := nativeEvolutionSession{
		OrganizationID: "11111111-1111-4111-8111-111111111111",
		ID:             "22222222-2222-4222-8222-222222222222",
	}
	message := nativeEvolutionMessage{
		ProviderMessageID: "wamid.HBgLExample",
		Content:           "  Olá\r\nMundo  ",
	}
	rule := nativeInboundRule{
		ID:                         "33333333-3333-4333-8333-333333333333",
		TargetRoundRobinID:         "44444444-4444-4444-8444-444444444444",
		ManagedMessageDistribution: true,
	}
	details := nativeInboundLogDetailsPayload(
		session,
		nativeEvolutionConversation{RemoteJID: "5511999999999@s.whatsapp.net"},
		message,
		"message-row-id",
		rule,
		map[string]any{},
	)

	if managed, ok := details["managed_whatsapp_message_distribution"].(bool); !ok || !managed {
		t.Fatalf("managed snapshot marker = %#v, want true", details["managed_whatsapp_message_distribution"])
	}
	if queue := details["target_round_robin_id"]; queue != rule.TargetRoundRobinID {
		t.Fatalf("frozen queue = %#v, want %q", queue, rule.TargetRoundRobinID)
	}
	const expectedFingerprint = "0be4751d69eaa5d8730a3216b703ec9daa5fce06aa3e7f920650ed9b30c5c4ad"
	if fingerprint := details["message_fingerprint"]; fingerprint != expectedFingerprint {
		t.Fatalf("message fingerprint = %#v, want %q", fingerprint, expectedFingerprint)
	}
	if changed := nativeManagedWhatsAppMessageFingerprint(
		session.OrganizationID,
		session.ID,
		message.ProviderMessageID,
		strings.TrimSpace(message.Content),
	); changed == expectedFingerprint {
		t.Fatal("message fingerprint must preserve the exact message content, including whitespace")
	}
}

func TestValidateNativeManagedWhatsAppLeadEntryResult(t *testing.T) {
	tests := []struct {
		name          string
		raw           string
		wantError     bool
		wantSubstring string
	}{
		{
			name: "handled result",
			raw:  `{"handled":true,"reason":"distributed","lead_id":"lead-id"}`,
		},
		{
			name:          "unhandled result preserves reason",
			raw:           `{"handled":false,"reason":"managed_rule_unavailable"}`,
			wantError:     true,
			wantSubstring: "managed_rule_unavailable",
		},
		{
			name:          "missing handled is rejected",
			raw:           `{"reason":"contract_missing_handled"}`,
			wantError:     true,
			wantSubstring: "contract_missing_handled",
		},
		{
			name:          "missing reason uses safe fallback",
			raw:           `{"handled":false}`,
			wantError:     true,
			wantSubstring: "unknown",
		},
		{
			name:          "invalid JSON is rejected",
			raw:           `{"handled":`,
			wantError:     true,
			wantSubstring: "invalid managed WhatsApp lead entry result",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateNativeManagedWhatsAppLeadEntryResult([]byte(test.raw))
			if !test.wantError {
				if err != nil {
					t.Fatalf("validateNativeManagedWhatsAppLeadEntryResult() error = %v", err)
				}
				return
			}
			if err == nil {
				t.Fatal("validateNativeManagedWhatsAppLeadEntryResult() error = nil")
			}
			if !strings.Contains(err.Error(), test.wantSubstring) {
				t.Fatalf("validateNativeManagedWhatsAppLeadEntryResult() error = %q, want substring %q", err, test.wantSubstring)
			}
		})
	}
}

func TestManagedWhatsAppDistributionFailsClosedForLegacyWildcardSession(t *testing.T) {
	if !strings.Contains(nativeInboundRulesQuery, "coalesce(session_id = $2::uuid, false) and (") {
		t.Fatal("managed WhatsApp distribution must treat a legacy NULL session as false")
	}
	if !strings.Contains(nativeInboundRulesQuery, "and (session_id is null or session_id = $2::uuid)") {
		t.Fatal("legacy wildcard rules must remain readable for their existing non-managed behavior")
	}
	if !strings.Contains(nativeInboundRulesQuery, "order by priority desc") {
		t.Fatal("specific inbound rules must preserve their configured priority")
	}
}
