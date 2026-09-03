package whatsapp

import (
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"testing"
)

func TestEvolutionGoEdgeManagedDistributionFailsClosedAndRetries(t *testing.T) {
	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("unable to locate Edge Function contract test")
	}
	edgePath := filepath.Clean(filepath.Join(
		filepath.Dir(sourceFile),
		"..", "..", "..", "..",
		"supabase", "functions", "evolution-go-webhook", "index.ts",
	))
	raw, err := os.ReadFile(edgePath)
	if err != nil {
		t.Fatalf("read Edge Function: %v", err)
	}
	source := string(raw)

	for _, fragment := range []string{
		"boundSessionId !== sessionId",
		`["deleted", "disabled"].includes(resolvedSessionStatus)`,
		`if (loggedIn && connected) return "connected";`,
		`if (!loggedIn && connected) return "qr_ready";`,
		`if (connected) return "connected";`,
		`if (!normalizedStatus && !isErrorState) return null;`,
		`.eq("updated_at", session.updated_at)`,
		`sessionAllowsLifecycleUpdates(session)`,
		`is_managed_whatsapp_message_distribution: true`,
		`managed_whatsapp_initial_provider_event_id`,
		`lookup_managed_whatsapp_lead_entry`,
		`managed_whatsapp_entry_lookup_pending_context_invalid`,
		`managed_whatsapp_entry_lookup_handled_context_invalid`,
		`legacy_non_managed_retry`,
		`data.quarantine === true || data.quarantined === true || data.incomplete === true`,
		`managed_whatsapp_message_distribution: managedMessageDistribution`,
		`target_round_robin_id: rule?.target_round_robin_id || null`,
		`message_fingerprint: messageFingerprint`,
		`${session.organization_id}\u001f${session.id}\u001f${message.messageId}\u001f${message.content || ""}`,
		`process_managed_whatsapp_lead_entry`,
		`whatsapp_contact_identity_aliases`,
		`managed_whatsapp_lead_identity_unresolved`,
		`providerMessageIdSynthetic`,
		`const content = normalizeText(extractContent(messageNode, message, mediaBlock)).replace(/\u0000/g, "") || null;`,
		`managed_whatsapp_distribution_requires_provider_message_id`,
		`managed_whatsapp_distribution_provider_message_id_invalid`,
		`managed_whatsapp_distribution_message_required`,
		`managed_whatsapp_distribution_message_too_large`,
		`new TextEncoder().encode(content).byteLength > 65_536`,
		`reconcileHandledWhatsAppMessageTransport`,
		`managedEntryWasPending = true;`,
		`if (!managedMessageDistribution) {`,
		`await processManagedWhatsAppLeadEntry(session, attachedLead, rule, message);`,
		`if (updateError) throw updateError;`,
		`if (insertError) throw insertError;`,
	} {
		if !strings.Contains(source, fragment) {
			t.Fatalf("Edge Function managed distribution contract is missing %q", fragment)
		}
	}

	for _, pattern := range []string{
		`(?s)inbound rule lookup failed; durable delivery will retry.*?throw error;`,
		`(?s)managed intake lookup failed; durable delivery will retry.*?throw error;`,
		`(?s)lead resolution failed; durable delivery will retry.*?throw error;`,
		`(?s)if \(data\.quarantine === true \|\| data\.quarantined === true \|\| data\.incomplete === true\).*?throw new Error.*?if \(data\.handled === true\).*?if \(data\.legacy_non_managed_retry === true\) \{\s*return \{ \.\.\.data, handled: true, pending: false, legacy_non_managed_retry: true \};\s*\}.*?managed_whatsapp_entry_lookup_handled_context_invalid`,
		`(?s)async function handleConnection\(.*?const \{ data, error \} = await supabase.*?\.from\("whatsapp_sessions"\).*?\.update\(update\).*?\.eq\("updated_at", session\.updated_at\).*?if \(error\) throw error;`,
		`(?s)const firstRule = matchingRules\[0\].*?firstMatchType !== "all".*?for \(const rule of matchingRules\.slice\(1\)\).*?return \{ \.\.\.rule, __managed_whatsapp_message_distribution: true \};`,
		`(?s)if \(existing\).*?if \(managedMessageDistribution\).*?return \{.*?is_new_lead: false.*?is_managed_whatsapp_message_distribution: true.*?\};`,
		`(?s)async function resolveAttachableLeadId\(.*?\.eq\("organization_id", session\.organization_id\).*?\.eq\("session_id", session\.id\).*?\.eq\("lead_id", candidateLeadId\)`,
		`(?s)const conversation = await ensureConversation\(session, message, lead\);.*?await logInbound\(session, conversation, attachedLead, rule, message\);.*?const result = await insertMessage\(session, conversation, attachedLead, message\);`,
		`(?s)const providerMessageId = \[.*?message\.provider_message_id,\s*\]\s*\.map\(\(value\) => normalizeText\(value\)\.replace\(/\\u0000/g, ""\)\.trim\(\)\)\s*\.find\(Boolean\) \|\| "";\s*const providerMessageIdSynthetic = !providerMessageId;`,
		`(?s)async function reconcileHandledWhatsAppMessageTransport\(.*?for \(const providerIdentityColumn of \["message_id", "provider_message_id"\]\).*?\.from\("whatsapp_messages"\).*?\.eq\("organization_id", session\.organization_id\).*?\.eq\("session_id", session\.id\).*?\.eq\(providerIdentityColumn, message\.messageId\).*?\.eq\("from_me", false\).*?\.update\(\{.*?media_storage_path: mediaStoragePath,.*?media_status: "ready",.*?media_error: null,.*?\}\).*?\.eq\("id", existing\.id\).*?\.eq\("from_me", false\);`,
		`(?s)managedEntryLookup = await lookupManagedWhatsAppLeadEntry\(session, message\).*?if \(managedEntryLookup\?\.handled === true\) \{\s*await reconcileHandledWhatsAppMessageTransport\(session, message\);\s*processed \+= 1;\s*continue;\s*\}.*?if \(managedEntryLookup\?\.pending === true\).*?loadPendingManagedWhatsAppLead\(session, managedEntryLookup\).*?else \{\s*try \{\s*rule = await findInboundRule\(session, message\);.*?if \(managedRuleMatched\) \{.*?validateNewManagedWhatsAppProviderEvent\(message\);\s*\}.*?lead = await ensureLead\(session, message, rule, managedRuleMatched\);`,
		`(?s)function validateNewManagedWhatsAppProviderEvent\(.*?message\.providerMessageIdSynthetic.*?Array\.from\(providerMessageId\)\.length.*?providerMessageIdCharacters < 1 \|\| providerMessageIdCharacters > 500.*?if \(!content\.trim\(\)\).*?new TextEncoder\(\)\.encode\(content\)\.byteLength > 65_536`,
		`(?s)if \(result\.inserted && !isReactionEvent\) \{.*?if \(!managedMessageDistribution\) \{\s*scheduleAutoReply\(session, conversation, result\.message, message\);\s*\}.*?\}\s*if \(managedMessageDistribution\) \{\s*await processManagedWhatsAppLeadEntry\(session, attachedLead, rule, message\);.*?if \(\(result\.inserted \|\| managedEntryWasPending\) && !isReactionEvent\) \{\s*scheduleAutoReply\(session, conversation, result\.message, message\);`,
	} {
		if !regexp.MustCompile(pattern).MatchString(source) {
			t.Fatalf("Edge Function must propagate operational failure matching %q", pattern)
		}
	}
}

func TestNativeManagedHandledRetryReconcilesTransportAndAutoReplyBeforeBusinessNoOp(t *testing.T) {
	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("unable to locate native processor contract test")
	}
	raw, err := os.ReadFile(filepath.Join(filepath.Dir(sourceFile), "webhook_native_processor.go"))
	if err != nil {
		t.Fatalf("read native processor: %v", err)
	}
	source := string(raw)
	pattern := `(?s)rule, err := findNativeInboundRule\(ctx, tx, session, message\).*?if nativeManagedProviderEventAlreadyHandled\(rule\) \{\s*if err := reconcileNativeHandledMessageTransport\(ctx, tx, session, message\); err != nil \{\s*return err\s*\}.*?recoverNativeHandledAutoReplyInput\(.*?message\.ProviderMessageID,\s*rule\.ManagedProviderEventLeadID,\s*\).*?autoReplyInputs = append\(autoReplyInputs, recoveredInput\).*?continue\s*\}\s*conversation, err := ensureNativeEvolutionConversation`
	if !regexp.MustCompile(pattern).MatchString(source) {
		t.Fatal("completed native retries must reconcile transport and auto-reply enqueue state before stopping business effects")
	}
}
