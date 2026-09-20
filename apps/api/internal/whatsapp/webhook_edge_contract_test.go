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
		`monotonicWhatsAppMessageStatus as monotonicMessageStatus`,
		`monotonicWhatsAppOutboxStatus as monotonicOutboxStatus`,
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
		`target_round_robin_id: targetRoundRobinId`,
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
		`if (eventBindingIsCurrent && eventLeadId && result.inserted && !managedMessageDistribution && !isReactionEvent) {`,
		`await processManagedWhatsAppLeadEntry(session, attachedLead, rule, message);`,
		`await enrichManagedWhatsAppLeadEntryAttribution(session, attachedLead?.id, message);`,
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
		`(?s)if \(existing\).*?if \(managedMessageDistribution\).*?return \{.*?is_new_lead: false.*?is_managed_whatsapp_message_distribution: true.*?\};`,
		`(?s)let conversation = await ensureConversation\(.*?activateWhatsAppConversationLeadBinding\(.*?await logInbound\(session, conversation, attachedLead, rule, message\);.*?const result = await insertMessage\(\s*session,\s*conversation,\s*attachedLead,\s*message,\s*leadResolutionQuarantineReason,\s*eventBindingIsCurrent,\s*\);`,
		`(?s)const providerMessageId = \[.*?message\.provider_message_id,\s*\]\s*\.map\(\(value\) => normalizeText\(value\)\.replace\(/\\u0000/g, ""\)\.trim\(\)\)\s*\.find\(Boolean\) \|\| "";\s*const providerMessageIdSynthetic = !providerMessageId;`,
		`(?s)async function reconcileHandledWhatsAppMessageTransport\(.*?for \(const providerIdentityColumn of \["message_id", "provider_message_id"\]\).*?\.from\("whatsapp_messages"\).*?\.eq\("organization_id", session\.organization_id\).*?\.eq\("session_id", session\.id\).*?\.eq\(providerIdentityColumn, message\.messageId\).*?\.eq\("from_me", false\).*?\.update\(\{.*?media_storage_path: mediaStoragePath,.*?media_status: "ready",.*?media_error: null,.*?\}\).*?\.eq\("id", existing\.id\).*?\.eq\("from_me", false\);`,
		`(?s)managedEntryLookup = await lookupManagedWhatsAppLeadEntry\(session, message\).*?if \(managedEntryLookup\?\.handled === true\) \{.*?await reconcileHandledWhatsAppMessageTransport\(session, message\);.*?managedEntryAlreadyHandled = true;.*?loadPendingManagedWhatsAppLead\(session, managedEntryLookup\).*?\} else if \(managedEntryLookup\?\.pending === true\) \{.*?managedEntryWasPending = true;.*?loadPendingManagedWhatsAppLead\(session, managedEntryLookup\).*?\} else \{\s*try \{\s*rule = await findInboundRule\(session, message\);.*?if \(managedRuleMatched \|\| confirmedCtwaAd\) \{.*?validateNewWhatsAppLeadProviderEvent\(message\);\s*\}.*?lead = await ensureLead\(`,
		`(?s)function validateNewWhatsAppLeadProviderEvent\(.*?message\.providerMessageIdSynthetic.*?Array\.from\(providerMessageId\)\.length.*?providerMessageIdCharacters < 1 \|\| providerMessageIdCharacters > 500.*?if \(!content\.trim\(\)\).*?new TextEncoder\(\)\.encode\(content\)\.byteLength > 65_536`,
		`(?s)if \(managedMessageDistribution\) \{\s*if \(!managedEntryAlreadyHandled \|\| managedEntryWasPending\) \{\s*await processManagedWhatsAppLeadEntry\(session, attachedLead, rule, message\);\s*\}\s*await enrichManagedWhatsAppLeadEntryAttribution\(session, attachedLead\?\.id, message\);\s*\}.*?await triggerAutoReply\(session, conversation, result\.message, message, eventLeadId\);.*?await completeStoredMessageEffects\(`,
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
	pattern := `(?s)rule := nativeInboundRule\{\}.*?findNativeInboundRule\(ctx, tx, session, message\).*?if nativeManagedProviderEventAlreadyHandled\(rule\) \{\s*if err := reconcileNativeHandledMessageTransport\(ctx, tx, session, message\); err != nil \{\s*return err\s*\}.*?recoverNativeHandledAutoReplyInput\(.*?message\.ProviderMessageID,\s*rule\.ManagedProviderEventLeadID,\s*\).*?autoReplyInputs = append\(autoReplyInputs, recoveredInput\).*?leadID := strings\.TrimSpace\(rule\.ManagedProviderEventLeadID\).*?leadIDsToPublish\[leadID\] = struct\{\}\{\}.*?continue\s*\}\s*storedIdentity, err := findNativeEvolutionStoredMessageIdentity.*?conversation, err := ensureNativeEvolutionConversation`
	if !regexp.MustCompile(pattern).MatchString(source) {
		t.Fatal("completed native retries must reconcile transport and auto-reply enqueue state before stopping business effects")
	}
}

func TestNativeConversationUpsertUsesCanonicalSessionRemoteJIDConflictTarget(t *testing.T) {
	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("unable to locate native processor contract test")
	}
	raw, err := os.ReadFile(filepath.Join(filepath.Dir(sourceFile), "webhook_native_processor.go"))
	if err != nil {
		t.Fatalf("read native processor: %v", err)
	}
	source := string(raw)
	if strings.Contains(source, "on conflict (organization_id, session_id, remote_jid)") {
		t.Fatal("native conversation upsert must not target a non-existent three-column unique constraint")
	}
	pattern := `(?s)if conversationMissing \{.*?insert into public\.whatsapp_conversations.*?on conflict \(session_id, remote_jid\).*?returning id::text, coalesce\(lead_id::text, ''\), remote_jid`
	if !regexp.MustCompile(pattern).MatchString(source) {
		t.Fatal("native missing-conversation path must use the canonical session/remote_jid conflict target")
	}
}

func TestProviderReplayKeepsOriginalCardWithoutMutatingCurrentPreview(t *testing.T) {
	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("unable to locate replay isolation contract test")
	}

	nativeRaw, err := os.ReadFile(filepath.Join(filepath.Dir(sourceFile), "webhook_native_processor.go"))
	if err != nil {
		t.Fatalf("read native processor: %v", err)
	}
	native := string(nativeRaw)
	storedLookup := strings.Index(native, "storedIdentity, err := findNativeEvolutionStoredMessageIdentity")
	conversationResolution := -1
	if storedLookup >= 0 {
		if offset := strings.Index(native[storedLookup:], "conversation, err := ensureNativeEvolutionConversation"); offset >= 0 {
			conversationResolution = storedLookup + offset
		}
	}
	if storedLookup < 0 || conversationResolution < 0 || storedLookup >= conversationResolution {
		t.Fatal("native replay must resolve immutable message identity before conversation/card resolution")
	}
	for _, fragment := range []string{
		"conversation.MessageLeadID = storedLeadID",
		"conversation.HistoricalBindingReplay = storedLeadID != conversation.LeadID",
		"set lead_id = coalesce(lead_id, nullif($15, '')::uuid)",
		"eventBindingIsCurrent := !conversation.HistoricalBindingReplay",
		"updated, err = updateNativeEvolutionConversation",
		`quarantineReason = "whatsapp_message_lead_unattributed"`,
	} {
		if !strings.Contains(native, fragment) {
			t.Fatalf("native replay isolation contract is missing %q", fragment)
		}
	}

	edgePath := filepath.Clean(filepath.Join(
		filepath.Dir(sourceFile), "..", "..", "..", "..",
		"supabase", "functions", "evolution-go-webhook", "index.ts",
	))
	edgeRaw, err := os.ReadFile(edgePath)
	if err != nil {
		t.Fatalf("read Edge Function: %v", err)
	}
	edge := string(edgeRaw)
	for _, fragment := range []string{
		`for (const identityColumn of ["message_id", "provider_message_id"] as const)`,
		`throw new Error("whatsapp_message_provider_identity_conflict")`,
		"lead_id: existingLeadId || eventLeadId",
		"|| ingressRoutingSnapshot?.eventLeadId",
		"eventBindingIsCurrent = eventBindingIsCurrent",
		"await updateConversationAfterMessage(session, conversation, eventLeadId, message)",
		"return { inserted: false, message: data }",
	} {
		if !strings.Contains(edge, fragment) {
			t.Fatalf("Edge replay isolation contract is missing %q", fragment)
		}
	}
}

func TestAmbiguousLeadQuarantinePersistsNeutralEvidenceWithoutCardEffects(t *testing.T) {
	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("unable to locate quarantine isolation contract test")
	}
	nativeRaw, err := os.ReadFile(filepath.Join(filepath.Dir(sourceFile), "webhook_native_processor.go"))
	if err != nil {
		t.Fatal(err)
	}
	native := string(nativeRaw)
	for _, fragment := range []string{
		`metadata["lead_resolution_quarantine"]`,
		`nativeEvolutionMessageLeadID(conversation)`,
		`conversation.LeadResolutionQuarantineReason == ""`,
		`conversation.LeadResolutionQuarantineReason == "" && nativeIsMediaType(message.MessageType)`,
		"and lead_id is not distinct from nullif($9, '')::uuid",
		"eventBindingIsCurrent = updated",
		`if applyInboundEffects && eventBindingIsCurrent && conversation.LeadResolutionQuarantineReason == ""`,
		"ExpectedLeadID: nativeEvolutionMessageLeadID(conversation)",
	} {
		if !strings.Contains(native, fragment) {
			t.Fatalf("native binding fence is missing %q", fragment)
		}
	}

	edgePath := filepath.Clean(filepath.Join(
		filepath.Dir(sourceFile), "..", "..", "..", "..",
		"supabase", "functions", "evolution-go-webhook", "index.ts",
	))
	edgeRaw, err := os.ReadFile(edgePath)
	if err != nil {
		t.Fatal(err)
	}
	edge := string(edgeRaw)
	for _, fragment := range []string{
		`const eventLeadId = leadResolutionQuarantineReason`,
		`terminalLeadResolutionQuarantineReason(storedBeforeProcessing?.metadata)`,
		`&& !leadResolutionQuarantineReason) {`,
		`lead_resolution_quarantine: {`,
		`if (leadResolutionQuarantineReason || !eventBindingIsCurrent) {`,
		`await completeStoredMessageEffects(session, result.message, message.messageId)`,
		`const isMedia = allowMediaEffects && !leadResolutionQuarantineReason`,
		`updateQuery.eq("lead_id", expectedLeadId)`,
		`updateQuery.is("lead_id", null)`,
		`expectedLeadId,`,
		`eventBindingIsCurrent = eventBindingIsCurrent`,
	} {
		if !strings.Contains(edge, fragment) {
			t.Fatalf("Edge binding fence is missing %q", fragment)
		}
	}
}

func TestGenericIdentityAliasUpsertCannotRegressConversationBinding(t *testing.T) {
	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("unable to locate identity alias contract test")
	}
	nativeRaw, err := os.ReadFile(filepath.Join(filepath.Dir(sourceFile), "webhook_native_processor.go"))
	if err != nil {
		t.Fatal(err)
	}
	native := string(nativeRaw)
	for _, forbidden := range []string{
		"lead_id = coalesce(excluded.lead_id, whatsapp_contact_identity_aliases.lead_id)",
		"message.ContactPhone, conversation.LeadID, message.IsGroup",
	} {
		if strings.Contains(native, forbidden) {
			t.Fatalf("native generic alias upsert can still regress binding via %q", forbidden)
		}
	}

	edgePath := filepath.Clean(filepath.Join(
		filepath.Dir(sourceFile), "..", "..", "..", "..",
		"supabase", "functions", "evolution-go-webhook", "index.ts",
	))
	edgeRaw, err := os.ReadFile(edgePath)
	if err != nil {
		t.Fatal(err)
	}
	edge := string(edgeRaw)
	start := strings.Index(edge, "async function upsertWhatsAppIdentityAliases(")
	end := strings.Index(edge, "async function safelyUpsertWhatsAppIdentityAliases(")
	if start < 0 || end <= start {
		t.Fatal("unable to isolate Edge generic alias upsert")
	}
	block := edge[start:end]
	if strings.Contains(block, "lead_id:") {
		t.Fatal("Edge generic alias upsert must leave alias.lead_id to the locked binding RPC")
	}
}

func TestEdgeIntakeBindingUsesVersionedCASAndSuppressesLosingEventEffects(t *testing.T) {
	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("unable to locate Edge CAS contract test")
	}
	edgePath := filepath.Clean(filepath.Join(
		filepath.Dir(sourceFile), "..", "..", "..", "..",
		"supabase", "functions", "evolution-go-webhook", "index.ts",
	))
	raw, err := os.ReadFile(edgePath)
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	snapshot := strings.Index(source, "const conversationBindingSnapshot = ingressRoutingSnapshot || ((")
	resolveLead := strings.Index(source, "lead = await ensureLead(")
	if snapshot < 0 || resolveLead < 0 || snapshot >= resolveLead {
		t.Fatal("Edge must freeze the conversation/binding version before resolving a lead")
	}
	for _, fragment := range []string{
		`.rpc("activate_whatsapp_conversation_lead_binding_if_current"`,
		"p_expected_active_binding_id: expected.activeBindingId",
		"p_expected_current_lead_id: expected.currentLeadId",
		"conversationBindingSnapshot.currentLeadId",
		"providerEventBinding?.leadId",
		"const providerEventBinding = await findWhatsAppProviderEventBinding(session, message)",
		"? await loadScopedWhatsAppLead(session, expectedCurrentLeadId)",
		`typeof data.stale !== "boolean"`,
		`if (lead?.id) {`,
		"bindingResultIsCurrent = binding.isCurrent",
		"let eventBindingIsCurrent = bindingResultIsCurrent ??",
		`if (leadResolutionQuarantineReason || !eventBindingIsCurrent)`,
		"allowMediaEffects && !leadResolutionQuarantineReason",
	} {
		if !strings.Contains(source, fragment) {
			t.Fatalf("Edge intake CAS contract is missing %q", fragment)
		}
	}
}

func TestEdgeConsumesOnlyAuthenticatedImmutableIngressRouting(t *testing.T) {
	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("unable to locate Edge ingress provenance test")
	}
	edgePath := filepath.Clean(filepath.Join(
		filepath.Dir(sourceFile), "..", "..", "..", "..",
		"supabase", "functions", "evolution-go-webhook", "index.ts",
	))
	raw, err := os.ReadFile(edgePath)
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	for _, fragment := range []string{
		`authorization.contract !== "internal_worker_lease"`,
		`throw new Error("whatsapp_durable_ingress_required")`,
		`const envelope = isRecord(ingress.routing_snapshot)`,
		`Number(envelope.version) !== 1`,
		`optionalUuid(row.organization_id) !== optionalUuid(session.organization_id)`,
		`optionalUuid(row.session_id) !== optionalUuid(session.id)`,
		`managedMessageDistribution !== (contextProof === "managed_rule")`,
		`messages = orderMessagesByIngressRoutingSnapshot`,
		`"resolve_whatsapp_webhook_inherited_routing_target"`,
		`return quarantinedWhatsAppLeadResolution("whatsapp_ingress_snapshot_lead_deleted")`,
		`eventLeadId = null`,
		`if (leadResolutionQuarantineReason || !eventBindingIsCurrent)`,
	} {
		if !strings.Contains(source, fragment) {
			t.Fatalf("Edge ingress provenance contract is missing %q", fragment)
		}
	}
	providerReject := strings.Index(source, `if (messages.length > 0 && authorization.contract !== "internal_worker_lease")`)
	messageLoop := strings.Index(source, `for (const { rawMessage, envelope } of messages)`)
	if providerReject < 0 || messageLoop < 0 || providerReject > messageLoop {
		t.Fatal("direct provider messages must be rejected before any message effect")
	}
	deletedLead := strings.Index(source, `return quarantinedWhatsAppLeadResolution("whatsapp_ingress_snapshot_lead_deleted")`)
	ensureConversation := -1
	if deletedLead >= 0 {
		if relative := strings.Index(source[deletedLead:], `let conversation = await ensureConversation(`); relative >= 0 {
			ensureConversation = deletedLead + relative
		}
	}
	if deletedLead < 0 || ensureConversation < 0 || deletedLead > ensureConversation {
		t.Fatal("deleted snapshot lead must become terminal quarantine before persistence/effects")
	}
}

func TestNativeOutboundWebhookReconciliationTransfersOnlyExactDurableIdentity(t *testing.T) {
	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("unable to locate native outbound reconciliation contract test")
	}
	raw, err := os.ReadFile(filepath.Join(filepath.Dir(sourceFile), "webhook_native_processor.go"))
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	start := strings.Index(source, "func reconcileNativeOutboundOutbox(")
	end := strings.Index(source, "func lockNativeOutboundOutbox(")
	if start < 0 || end <= start {
		t.Fatal("unable to isolate native outbound reconciliation")
	}
	block := source[start:end]
	for _, fragment := range []string{
		"from public.whatsapp_outbox as outbox",
		"for update",
		`outboxStatus == "dead" && outboxLastError == whatsappOutboxProviderUnknownMarker`,
		"set client_message_id = null",
		"pending.lead_id = canonical.lead_id",
		"canonical.client_message_id is null or canonical.client_message_id = $5",
		"and canonical.provider_message_id = $6",
		"and canonical.message_id = $6",
		"and outbox.message_id = $7::uuid",
		"and outbox.client_message_id = $8",
		"and outbox.provider_message_id = $9",
		"and outbox.last_error = $10",
		"if reconciled.RowsAffected() != 1",
		"delete from public.whatsapp_messages as pending",
	} {
		if !strings.Contains(block, fragment) {
			t.Fatalf("native outbound reconciliation is missing %q", fragment)
		}
	}
	if strings.Index(block, "set client_message_id = null") > strings.Index(block, "set message_id = $4::uuid") {
		t.Fatal("native reconciliation must transfer message identity before the outbox points at the provider row")
	}
}

func TestNativeLIDPromotionPreservesHistoricalMessageRemoteJID(t *testing.T) {
	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("unable to locate native LID promotion contract test")
	}
	raw, err := os.ReadFile(filepath.Join(filepath.Dir(sourceFile), "webhook_native_processor.go"))
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	start := strings.Index(source, "func reconcileNativeEvolutionConversationIdentity(")
	end := strings.Index(source, "func safeNativeMergedLeadID(")
	if start < 0 || end <= start {
		t.Fatal("unable to isolate native LID promotion")
	}
	block := source[start:end]
	if strings.Contains(block, "update public.whatsapp_messages") {
		t.Fatal("LID promotion must not rewrite immutable remote_jid on historical messages")
	}
	for _, fragment := range []string{
		"Message remote_jid is immutable provider-event provenance",
		"update public.whatsapp_conversations",
		"update public.whatsapp_contact_identity_aliases",
	} {
		if !strings.Contains(block, fragment) {
			t.Fatalf("native LID promotion contract is missing %q", fragment)
		}
	}
}
