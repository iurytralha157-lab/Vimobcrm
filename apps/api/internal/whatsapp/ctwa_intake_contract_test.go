package whatsapp

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

const ctwaAttributionMigration = "20260903204548_require_ctwa_ad_lead_creation_and_attribution.sql"

func TestCTWAMigrationRejectsAmbiguousLeadPhoneOwnership(t *testing.T) {
	source := strings.ToLower(readCTWAContractFile(t,
		"supabase", "migrations", ctwaAttributionMigration,
	))
	finder := compactCTWAContract(sectionCTWAContract(
		t,
		source,
		"create or replace function public.find_lead_by_normalized_phone(",
		"create or replace function public.whatsapp_webhook_has_lead_creation_context(p_metadata jsonb)",
	))
	for _, fragment := range []string{
		"lead.phone is not null and btrim(lead.phone) <> '' and public.normalize_phone(lead.phone) is not null and public.normalize_phone(lead.phone) <> '' and public.normalize_phone(lead.phone) = v_phone_key",
		"public.normalize_phone(lead.phone) = v_phone_key",
		"limit 2",
		"if v_match_count > 1 then raise exception using errcode = '23505', message = 'whatsapp_lead_phone_ambiguous'",
		"from public, anon, authenticated; grant execute on function public.find_lead_by_normalized_phone(uuid, text) to service_role",
	} {
		requireCTWAContractContains(t, finder, fragment)
	}
	if strings.Contains(finder, "to_jsonb(lead)->>'whatsapp'") {
		t.Fatal("phone lookup must stay on the indexed leads.phone identity instead of scanning a nonexistent legacy field")
	}
}

func TestCTWAMigrationProtectsTrustedProvenanceAndHotTableCutover(t *testing.T) {
	source := strings.ToLower(readCTWAContractFile(t,
		"supabase", "migrations", ctwaAttributionMigration,
	))
	compact := compactCTWAContract(source)
	for _, fragment := range []string{
		"begin; set local lock_timeout = '5s';",
		"message = 'trusted_whatsapp_lead_provenance_required'",
		"before insert or update of metadata on public.leads",
		"message = 'trusted_whatsapp_provider_attribution_required'",
		"before insert or update of metadata on public.whatsapp_messages",
		"v_actor_role = 'service_role'",
		"session_user not in ('anon', 'authenticated', 'authenticator')",
		"commit;",
	} {
		requireCTWAContractContains(t, compact, fragment)
	}
}

func TestCTWAMigrationSerializesMetaCreativeHistoryByProviderIdentity(t *testing.T) {
	source := strings.ToLower(readCTWAContractFile(t,
		"supabase", "migrations", ctwaAttributionMigration,
	))
	compact := compactCTWAContract(source)
	deduper := compactCTWAContract(sectionCTWAContract(
		t,
		source,
		"create or replace function private.dedupe_whatsapp_meta_creative_activity()",
		"revoke all on function private.dedupe_whatsapp_meta_creative_activity()",
	))
	for _, fragment := range []string{
		"create table if not exists private.whatsapp_meta_creative_event_ledger",
		"primary key (organization_id, whatsapp_session_id, provider_message_id)",
		"foreign key (organization_id) references public.organizations(id) on delete cascade",
		"foreign key (whatsapp_session_id) references public.whatsapp_sessions(id) on delete cascade",
		"foreign key (lead_id) references public.leads(id) on delete cascade",
		"on private.whatsapp_meta_creative_event_ledger (whatsapp_session_id)",
		"on private.whatsapp_meta_creative_event_ledger (lead_id)",
		"revoke all on table private.whatsapp_meta_creative_event_ledger from public, anon, authenticated, service_role",
		"before insert or update or delete on public.activities",
	} {
		requireCTWAContractContains(t, compact, fragment)
	}
	for _, fragment := range []string{
		"message = 'trusted_whatsapp_meta_creative_activity_required'",
		"activity.lead_id = new.lead_id",
		"activity.organization_id = new.organization_id",
		"activity.metadata->>'whatsapp_session_id' = v_session_id::text",
		"activity.metadata->>'message_id' = v_message_id",
		"delete from public.activities as activity where activity.organization_id = new.organization_id and activity.lead_id = new.lead_id and activity.type = 'meta_creative'",
		"update public.activities as activity set user_id = new.user_id, content = new.content, metadata = new.metadata",
		"insert into private.whatsapp_meta_creative_event_ledger",
		"on conflict (organization_id, whatsapp_session_id, provider_message_id) do nothing returning lead_id into v_registered_lead_id",
		"message = 'whatsapp_meta_creative_provider_event_lead_collision'",
		"return null",
	} {
		requireCTWAContractContains(t, deduper, fragment)
	}
	reservation := strings.Index(deduper, "insert into private.whatsapp_meta_creative_event_ledger")
	winnerBranch := strings.Index(deduper, "if found then if v_historical_found then")
	promotion := strings.Index(deduper, "delete from public.activities as activity")
	if reservation < 0 || winnerBranch < 0 || promotion < 0 ||
		reservation >= winnerBranch || winnerBranch >= promotion {
		t.Fatal("historical creative promotion must happen only after this transaction wins the provider-event ledger key")
	}
}

func TestCTWALeadCreationMigrationRequiresExplicitEntryPointForEveryVersionedAutomaticLead(t *testing.T) {
	source := strings.ToLower(readCTWAContractFile(t,
		"supabase", "migrations", ctwaAttributionMigration,
	))

	ctwaPredicate := compactCTWAContract(sectionCTWAContract(
		t,
		source,
		"create or replace function private.whatsapp_metadata_is_ctwa_ad(p_metadata jsonb)",
		"revoke all on function private.whatsapp_metadata_is_ctwa_ad(jsonb)",
	))
	for _, fragment := range []string{
		"{whatsapp_attribution,entry_point_conversion_source}",
		"{whatsapp_attribution,source_referral,entry_point_conversion_source}",
		") = 'ctwa_ad'",
		"{whatsapp_attribution,source_referral,explicit_source_type}",
		") in ('', 'ad')",
	} {
		requireCTWAContractContains(t, ctwaPredicate, fragment)
	}
	for _, obsoleteSignal := range []string{"source_id", "ad_id", "ctwa_clid"} {
		if strings.Contains(ctwaPredicate, obsoleteSignal) {
			t.Fatalf("CTWA predicate must not accept legacy ad identity %q without entry_point_conversion_source=ctwa_ad", obsoleteSignal)
		}
	}

	creationGate := compactCTWAContract(sectionCTWAContract(
		t,
		source,
		"create or replace function public.whatsapp_webhook_has_lead_creation_context(p_metadata jsonb)",
		"revoke all on function public.whatsapp_webhook_has_lead_creation_context(jsonb)",
	))
	for _, fragment := range []string{
		"private.whatsapp_metadata_is_ctwa_ad(coalesce(p_metadata, '{}'::jsonb)) as is_ctwa_ad",
		"p_metadata->>'whatsapp_lead_creation_contract', '')) as contract_version",
		"select case when managed_context.contract_version = 'ctwa_ad_v1' then managed_context.is_ctwa_ad",
		"when managed_context.contract_version <> '' then false",
		"end and case when managed_context.is_managed then",
		"managed_context.rule_id is not null and managed_context.session_id is not null and managed_context.round_robin_id is not null",
		"else true end from managed_context",
	} {
		requireCTWAContractContains(t, creationGate, fragment)
	}

	// The versioned CTWA predicate is evaluated before the independent
	// managed/non-managed CASE. Therefore a managed queue gets its additional
	// canonical-rule checks, while the owner fallback (ELSE TRUE) is still
	// reachable only after the same ctwa_ad_v1 predicate succeeds.
	ctwaGate := strings.Index(creationGate, "when managed_context.contract_version = 'ctwa_ad_v1' then managed_context.is_ctwa_ad")
	managedBranch := strings.Index(creationGate, "when managed_context.is_managed then")
	ownerFallback := strings.Index(creationGate, "else true end from managed_context")
	if ctwaGate < 0 || managedBranch < 0 || ownerFallback < 0 ||
		ctwaGate >= managedBranch || managedBranch >= ownerFallback {
		t.Fatal("CTWA must gate both the managed queue branch and the non-managed owner fallback")
	}

	gatePrivileges := compactCTWAContract(sectionCTWAContract(
		t,
		source,
		"revoke all on function public.whatsapp_webhook_has_lead_creation_context(jsonb)",
		"comment on function public.whatsapp_webhook_has_lead_creation_context(jsonb)",
	))
	requireCTWAContractContains(t, gatePrivileges,
		"from public, anon, authenticated; grant execute on function public.whatsapp_webhook_has_lead_creation_context(jsonb) to service_role;")
	for _, forbiddenRole := range []string{"to anon", "to authenticated"} {
		if strings.Contains(gatePrivileges, forbiddenRole) {
			t.Fatalf("automatic lead creation guard must remain service-role only; found %q", forbiddenRole)
		}
	}
}

func TestCTWAAttributionMigrationEnrichesOnlyFromScopedPersistedInboundMessage(t *testing.T) {
	source := strings.ToLower(readCTWAContractFile(t,
		"supabase", "migrations", ctwaAttributionMigration,
	))
	enrichment := compactCTWAContract(sectionCTWAContract(
		t,
		source,
		"create or replace function public.enrich_whatsapp_lead_entry_attribution(",
		"revoke all on function public.enrich_whatsapp_lead_entry_attribution(",
	))

	for _, fragment := range []string{
		"security definer set search_path = ''",
		"v_provider_event_id := p_session_id::text || ':' || v_provider_message_id",
		"from public.whatsapp_messages as message",
		"message.organization_id = p_organization_id",
		"message.session_id = p_session_id",
		"message.lead_id = p_lead_id",
		"coalesce(message.from_me, false) = false",
		"lower(coalesce(message.direction, 'inbound')) <> 'outbound'",
		"message.provider_message_id = v_provider_message_id or ( message.provider_message_id is null and message.message_id = v_provider_message_id )",
		"from public.whatsapp_inbound_logs as inbound_log",
		"inbound_log.organization_id = p_organization_id",
		"inbound_log.session_id = p_session_id",
		"inbound_log.conversation_id = v_message.conversation_id",
		"inbound_log.lead_id = p_lead_id",
		"inbound_log.match_details->>'message_id' = v_provider_message_id",
		"inbound_log.match_details->'whatsapp_attribution'",
		"inbound_log.match_details->>'managed_whatsapp_message_distribution'",
		"not private.whatsapp_metadata_is_ctwa_ad( jsonb_build_object('whatsapp_attribution', v_source) ) then return false",
		"'creative_link_url', nullif(btrim(coalesce(v_source->>'creative_link_url', v_source->>'source_url', '')), '')",
		"'creative_destination_url', nullif(btrim(coalesce(v_source->>'creative_destination_url', v_source->>'source_url', '')), '')",
		"update public.lead_entry_events as entry",
		"entry.organization_id = p_organization_id",
		"entry.lead_id = p_lead_id",
		"entry.provider = 'whatsapp'",
		"entry.provider_event_id = v_provider_event_id",
	} {
		requireCTWAContractContains(t, enrichment, fragment)
	}
	enrichmentSignature := sectionCTWAContract(
		t,
		enrichment,
		"create or replace function public.enrich_whatsapp_lead_entry_attribution(",
		"returns boolean",
	)
	if strings.Contains(enrichmentSignature, "p_metadata") || strings.Contains(enrichmentSignature, "p_attribution") {
		t.Fatal("attribution enrichment must derive trusted stored provenance, not accept caller-supplied attribution")
	}

	privileges := compactCTWAContract(sectionCTWAContract(
		t,
		source,
		"revoke all on function public.enrich_whatsapp_lead_entry_attribution(",
		"comment on function public.enrich_whatsapp_lead_entry_attribution(",
	))
	for _, fragment := range []string{
		") from public, anon, authenticated;",
		") to service_role;",
	} {
		requireCTWAContractContains(t, privileges, fragment)
	}
	for _, forbiddenRole := range []string{"to anon", "to authenticated"} {
		if strings.Contains(privileges, forbiddenRole) {
			t.Fatalf("attribution enrichment RPC must remain service-role only; found %q", forbiddenRole)
		}
	}
}

func TestEvolutionGoEdgeUsesProviderCTWASignalBeforeManagedRoutingOrLeadCreation(t *testing.T) {
	source := readCTWAContractFile(t,
		"supabase", "functions", "evolution-go-webhook", "index.ts",
	)

	normalizer := sectionCTWAContract(
		t,
		source,
		"function normalizeProviderProofText(",
		"function mergeReferralCandidates(",
	)
	for _, fragment := range []string{
		"candidate.entry_point_conversion_source",
		"candidate.entryPointConversionSource",
		"candidate.entry_point_conversion_app",
		"candidate.entryPointConversionApp",
		"candidate.conversion_source",
		"candidate.conversionSource",
		"candidate.source_app",
		"candidate.sourceApp",
		"entry_point_conversion_source: entryPointConversionSource",
		"entry_point_conversion_app: entryPointConversionApp",
		"conversion_source: conversionSource",
		"source_app: sourceApp",
	} {
		requireCTWAContractContains(t, normalizer, fragment)
	}

	referralExtraction := sectionCTWAContract(
		t,
		source,
		"function extractWhatsAppReferral(",
		"function detectMediaBlock(",
	)
	for _, fragment := range []string{
		"const appendExternalAdReplies =",
		"container.externalAdReply",
		"container.ExternalAdReply",
		"container.external_ad_reply",
		"const appendContextInfo =",
		"appendContextInfo(container.contextInfo)",
		"appendContextInfo(container.ContextInfo)",
		"messageNode?.extendedTextMessage",
		"messageNode?.ExtendedTextMessage",
		"return mergeReferralCandidates(...normalizedCandidates);",
	} {
		requireCTWAContractContains(t, referralExtraction, fragment)
	}
	for _, forbiddenTraversal := range []string{
		"findNestedObjects",
		"Object.values(",
		"quotedMessage",
		"QuotedMessage",
		"quotedAd",
		"container.ad",
	} {
		if strings.Contains(referralExtraction, forbiddenTraversal) {
			t.Fatalf("CTWA referral extraction must not traverse arbitrary or quoted payloads; found %q", forbiddenTraversal)
		}
	}

	confirmationMapping := compactCTWAContract(sectionCTWAContract(
		t,
		source,
		"function clickToWhatsAppAdConfirmationMethod(",
		"function whatsappAttribution(",
	))
	for _, fragment := range []string{
		"whatsappCTWAConfirmationMethod({",
		"providerMessageIdSynthetic: message.providerMessageIdSynthetic",
		"entryPointConversionSource: referral.entry_point_conversion_source",
		"explicitSourceType: referral.explicit_source_type",
		"ctwaClid: referral.ctwa_clid",
		"showAdAttribution: referral.show_ad_attribution",
		"showAdAttributionInvalid: referral.ctwa_show_ad_attribution_invalid",
		"proofConflict: referral.ctwa_proof_conflict",
	} {
		requireCTWAContractContains(t, confirmationMapping, fragment)
	}

	confirmation := compactCTWAContract(strings.ToLower(readCTWAContractFile(t,
		"supabase", "functions", "_shared", "whatsapp-ctwa.ts",
	)))
	for _, fragment := range []string{
		"if (input.fromme || input.isgroup) return null",
		"normalizedtext(input.entrypointconversionsource).tolowercase()",
		"entrypoint === \"ctwa_ad\"",
		"(!explicitsourcetype || explicitsourcetype === \"ad\")",
		"if (entrypoint)",
		"input.providermessageidsynthetic === false",
		"explicitsourcetype === \"ad\"",
		"validwhatsappctwaclickidentifier(input.ctwaclid)",
		"showadattributionallowed",
		"input.showadattributioninvalid !== false",
		"input.proofconflict !== false",
		"return \"evolution_ctwa_clid_v1\"",
	} {
		requireCTWAContractContains(t, confirmation, fragment)
	}
	for _, forbiddenFallback := range []string{
		"input.sourcetype",
		"source_type",
		"sourceid",
		"sourceurl",
		"content",
	} {
		if strings.Contains(confirmation, forbiddenFallback) {
			t.Fatalf("CTWA v2 fallback must not authorize from %q", forbiddenFallback)
		}
	}
	confirmationWrapper := compactCTWAContract(sectionCTWAContract(
		t,
		source,
		"function isConfirmedClickToWhatsAppAd(",
		"function whatsappAttributionUtmSource(",
	))
	requireCTWAContractContains(t, strings.ToLower(confirmationWrapper),
		"return boolean(clicktowhatsappadconfirmationmethod(message))")

	ruleSelection := compactCTWAContract(sectionCTWAContract(
		t,
		source,
		"async function findInboundRule(",
		"async function lookupManagedWhatsAppLeadEntry(",
	))
	for _, fragment := range []string{
		"const confirmedCtwaAd = isConfirmedClickToWhatsAppAd(message)",
		"const targetsSessionQueue = Boolean(optionalUuid(rule?.target_round_robin_id)) && optionalUuid(rule?.session_id) === session.id",
		"if (managed && confirmedCtwaAd)",
		"return { ...rule, __managed_whatsapp_message_distribution: true }",
		"if (!targetsSessionQueue && !firstManualRule) firstManualRule = rule",
		"return firstManualRule ? { ...firstManualRule, __managed_whatsapp_message_distribution: false } : null",
	} {
		requireCTWAContractContains(t, ruleSelection, fragment)
	}

	managedBinding := compactCTWAContract(sectionCTWAContract(
		t,
		source,
		"async function isManagedWhatsAppMessageDistributionRule(",
		"async function findLeadByPhone(",
	))
	for _, fragment := range []string{
		`.select("id, match_type, match_value, match, conditions, name, is_active")`,
		`const inboundMatchType = normalizeText(rule?.match_type).trim().toLowerCase()`,
		`const inboundMatchField = normalizeText(rule?.match_field ?? "message").trim().toLowerCase()`,
		`const inboundMatchValue = normalizeText(rule?.match_value).trim()`,
		`const directMatch = isRecord(persistedRule.match) ? persistedRule.match : {}`,
		`const conditionMatch = isRecord(conditions.match) ? conditions.match : {}`,
		`inboundMatchType === "contains"`,
		`inboundMatchField === "message"`,
		`persistedMatchType === "whatsapp_message_contains"`,
		`persistedSessionId === sessionId`,
		`inboundMatchValue.toLowerCase() === persistedMatchValue.trim().toLowerCase()`,
	} {
		requireCTWAContractContains(t, managedBinding, fragment)
	}

	leadCreation := compactCTWAContract(sectionCTWAContract(
		t,
		source,
		"async function ensureLead(",
		"async function processManagedWhatsAppLeadEntry(",
	))
	existingLead := strings.Index(leadCreation, "if (existing)")
	ctwaRequired := strings.Index(leadCreation, "if (!confirmedCtwaAd)")
	leadUpsert := strings.Index(leadCreation, `.rpc("upsert_whatsapp_webhook_lead"`)
	if existingLead < 0 || ctwaRequired < 0 || leadUpsert < 0 ||
		existingLead >= ctwaRequired || ctwaRequired >= leadUpsert {
		t.Fatal("new automatic leads must be CTWA-gated after existing-lead resolution and before upsert")
	}
	for _, fragment := range []string{
		"const ctwaConfirmationMethod = clickToWhatsAppAdConfirmationMethod(message)",
		"const confirmedCtwaAd = Boolean(ctwaConfirmationMethod)",
		"await findEstablishedWhatsAppConversationLead(session, message, identity)",
		"if (!confirmedCtwaAd && isAmbiguousWhatsAppLeadPhone(error))",
		"return null",
		"const targetRoundRobinId = managedMessageDistribution ? optionalUuid(rule?.target_round_robin_id) : null",
		"const ownerUserId = await resolveActiveSessionOwner(session)",
		"const assignedUserId = managedMessageDistribution ? null : ownerUserId",
		`whatsapp_lead_creation_contract: "ctwa_ad_v2"`,
		"ctwa_confirmation_method: ctwaConfirmationMethod",
		"ctwa_ad_confirmed: true",
	} {
		requireCTWAContractContains(t, leadCreation, fragment)
	}
	establishedLead := strings.Index(leadCreation, "await findEstablishedWhatsAppConversationLead(session, message, identity)")
	globalPhoneLookup := strings.Index(leadCreation, "await findLeadByPhone(session.organization_id, phone)")
	if establishedLead < 0 || globalPhoneLookup < 0 || establishedLead >= globalPhoneLookup {
		t.Fatal("Edge intake must reuse an established session conversation before global phone resolution")
	}

	ownerFallback := compactCTWAContract(sectionCTWAContract(
		t,
		source,
		"async function resolveActiveSessionOwner(",
		"async function resolvePropertyByCode(",
	))
	for _, fragment := range []string{
		"optionalUuid(session.owner_user_id)",
		"optionalUuid(session.created_by)",
		`.from("users")`,
		`.from("organization_members")`,
		`.eq("organization_id", session.organization_id)`,
		"if (user?.id && membership?.user_id) return userId",
	} {
		requireCTWAContractContains(t, ownerFallback, fragment)
	}
	activeOwnerFilters := strings.Count(ownerFallback, `.eq("is_active", true)`) +
		strings.Count(ownerFallback, `.or("is_active.is.null,is_active.eq.true")`)
	if activeOwnerFilters < 2 {
		t.Fatal("session owner fallback must require both the user and organization membership to be active")
	}

	if strings.Contains(source, "meta_campaign_insights") || strings.Contains(source, "meta_creative_assets") {
		t.Fatal("CTWA intake must not depend on optional Meta campaign-insight or creative-asset tables")
	}
}

func TestEvolutionGoEdgeRejectsCTWASignalInsideQuotedMessage(t *testing.T) {
	source := readCTWAContractFile(t,
		"supabase", "functions", "evolution-go-webhook", "index.ts",
	)
	extractor := sectionCTWAContract(
		t,
		source,
		"function extractWhatsAppReferral(",
		"function detectMediaBlock(",
	)

	// A quotedMessage can contain a complete historical CTWA payload. The
	// current message must be confirmed only from explicit current-message
	// referral/contextInfo/externalAdReply containers, never by recursive scan.
	const nestedQuotedCTWA = `"quotedMessage":{"contextInfo":{"entryPointConversionSource":"ctwa_ad"}}`
	if !strings.Contains(nestedQuotedCTWA, `"entryPointConversionSource":"ctwa_ad"`) {
		t.Fatal("invalid nested quoted CTWA regression fixture")
	}
	for _, forbiddenTraversal := range []string{
		"quotedMessage",
		"QuotedMessage",
		"findNestedObjects",
		"Object.values(",
	} {
		if strings.Contains(extractor, forbiddenTraversal) {
			t.Fatalf("nested quoted CTWA could reach the current-message referral through %q", forbiddenTraversal)
		}
	}

	confirmation := compactCTWAContract(sectionCTWAContract(
		t,
		source,
		"function clickToWhatsAppAdConfirmationMethod(",
		"function whatsappAttribution(",
	))
	requireCTWAContractContains(t, confirmation, "const referral = message.referral")
	requireCTWAContractContains(t, confirmation, "whatsappCTWAConfirmationMethod({")

	leadCreation := compactCTWAContract(sectionCTWAContract(
		t,
		source,
		"async function ensureLead(",
		"async function processManagedWhatsAppLeadEntry(",
	))
	requireCTWAContractContains(t, leadCreation,
		"const ctwaConfirmationMethod = clickToWhatsAppAdConfirmationMethod(message)")
	requireCTWAContractContains(t, leadCreation,
		"const confirmedCtwaAd = Boolean(ctwaConfirmationMethod)")
	requireCTWAContractContains(t, leadCreation, "if (!confirmedCtwaAd)")
}

func TestEvolutionGoEdgeUsesOnlyTheImmediateSingularLIDEnvelope(t *testing.T) {
	source := readCTWAContractFile(t,
		"supabase", "functions", "evolution-go-webhook", "index.ts",
	)
	extraction := compactCTWAContract(sectionCTWAContract(
		t,
		source,
		"function wrapsEvolutionMessage(",
		"function getMessageNode(",
	))
	for _, fragment := range []string{
		"{ value: data?.messages, envelope: null }",
		"const dataMessageEnvelope = isRecord(dataMessage) ? data : null",
		"{ value: dataMessage, envelope: dataMessageEnvelope }",
		"!wrapsEvolutionMessage(item)",
		"isRecord(identity) && Object.keys(identity).length > 0",
		"isRecord(nested) && hasStructuralIdentity(nested)",
	} {
		requireCTWAContractContains(t, extraction, fragment)
	}
	wrapper := sectionCTWAContract(t, source, "function wrapsEvolutionMessage(", "function inboundEnvelopeContactCandidates(")
	if strings.Contains(wrapper, "value.message_id") || strings.Contains(wrapper, "value.messageId") || strings.Contains(wrapper, "value.ID") {
		t.Fatal("a scalar envelope ID must not prevent structural wrapper detection")
	}

	normalization := sectionCTWAContract(
		t,
		source,
		"function normalizeMessage(",
		"function previewForMessage(",
	)
	for _, fragment := range []string{
		"const hasLidInboundChat = !fromMe",
		".some(isLidJid)",
		"...(hasLidInboundChat ? inboundEnvelopeContactCandidates(currentEnvelope) : [])",
	} {
		requireCTWAContractContains(t, normalization, fragment)
	}
	if strings.Contains(normalization, ".some(isOpaqueJid)") {
		t.Fatal("newsletter, broadcast and status chats must never inherit a contact phone from the LID envelope fallback")
	}

	referralExtraction := sectionCTWAContract(
		t,
		source,
		"function normalizeProviderProofText(",
		"function detectMediaBlock(",
	)
	for _, fragment := range []string{
		"const referralProofKeys = [",
		"typeof value !== \"string\"",
		"const showAdAttributionProof = normalizeProviderOptionalBoolean(rawShowAdAttribution)",
		"const rawShowAdAttribution = firstDefined(",
		"ctwa_show_ad_attribution_invalid: showAdAttributionInvalid || null",
		`"entry_point_conversion_source"`,
		`"explicit_source_type"`,
		`"ctwa_clid"`,
		`"show_ad_attribution"`,
		"if (proofConflict) merged.ctwa_proof_conflict = true",
	} {
		requireCTWAContractContains(t, referralExtraction, fragment)
	}
	messageBlocks := strings.Index(referralExtraction, "for (const block of messageBlocks)")
	envelope := strings.LastIndex(referralExtraction, "appendStructuredContainers(currentEnvelope)")
	if messageBlocks < 0 || envelope < 0 || messageBlocks >= envelope {
		t.Fatal("current-message referral blocks must precede the immediate envelope")
	}
}

func TestEvolutionGoEdgePersistsCTWAAttributionAcrossManagedRetryLifecycle(t *testing.T) {
	source := readCTWAContractFile(t,
		"supabase", "functions", "evolution-go-webhook", "index.ts",
	)

	attribution := compactCTWAContract(sectionCTWAContract(
		t,
		source,
		"function whatsappAttribution(",
		"function isConfirmedClickToWhatsAppAd(",
	))
	for _, fragment := range []string{
		"creative_link_url: referral.source_url",
		"creative_destination_url: referral.source_url",
		"conversion_source: referral.conversion_source",
		"entry_point_conversion_source: referral.entry_point_conversion_source",
		"entry_point_conversion_app: referral.entry_point_conversion_app",
		"source_app: referral.source_app",
	} {
		requireCTWAContractContains(t, attribution, fragment)
	}

	entryLog := compactCTWAContract(sectionCTWAContract(
		t,
		source,
		"async function logLeadEntryAttribution(",
		"async function enrichManagedWhatsAppLeadEntryAttribution(",
	))
	requireCTWAContractContains(t, entryLog,
		"const providerEventId = `${session.id}:${message.messageId}`")
	requireCTWAContractContains(t, entryLog,
		"const nonManagedProviderEventId = `nonmanaged:${providerEventId}`")
	requireCTWAContractContains(t, entryLog,
		"provider_event_id: providerEventId")
	for _, fragment := range []string{
		"provider_event_id: nonManagedProviderEventId",
		`.eq("provider_event_id", nonManagedProviderEventId)`,
		`throw new Error("nonmanaged_whatsapp_provider_event_lead_collision")`,
		"if (!isUniqueViolation(updateError)) throw updateError",
		"await recoverProviderEntry(updateError)",
		"if (!isUniqueViolation(error)) throw error",
		"await recoverProviderEntry(error)",
		"metadata: { ...existingMetadata, ...metadata }",
		"payload: { ...existingPayload, ...metadata }",
	} {
		requireCTWAContractContains(t, entryLog, fragment)
	}

	recovery := compactCTWAContract(sectionCTWAContract(
		t,
		source,
		"async function recoverPersistedNonManagedWhatsAppMessage(",
		"async function resolveGroupName(",
	))
	for _, fragment := range []string{
		"provider_message_id, message_id, content, sent_at, received_at, created_at, remote_jid, sender_jid, sender_name, from_me, direction, message_type, metadata",
		"const storedMetadata = isRecord(storedMessage.metadata)",
		"const storedAttribution = isRecord(storedMetadata.whatsapp_attribution)",
		"const persistedMessage = { ...message",
		"content: normalizeText(storedMessage.content)",
		"sentAt: persistedSentAt",
		"referral: persistedReferral",
		"normalizePersistedReferralCandidate(storedReferral)",
		"normalizePersistedReferralCandidate(storedSourceReferral)",
		"ctwa_show_ad_attribution_invalid: storedAttribution.ctwa_show_ad_attribution_invalid",
		"await logInbound(session, conversation, lead, null, persistedMessage)",
		"isConfirmedClickToWhatsAppAd(persistedMessage)",
	} {
		requireCTWAContractContains(t, recovery, fragment)
	}
	if strings.Contains(recovery, "normalizeReferralCandidate(storedReferral)") ||
		strings.Contains(recovery, "normalizeReferralCandidate(storedSourceReferral)") {
		t.Fatal("persisted inferred source_type must not be promoted to explicit provenance")
	}

	nativeSource := compactCTWAContract(readCTWAContractFile(t,
		"apps", "api", "internal", "whatsapp", "webhook_native_processor.go",
	))
	nativeRecovery := sectionCTWAContract(
		t,
		nativeSource,
		"func recoverNativeLegacyNonManagedRetry(",
		"func nativeMessageWithPersistedCampaignAttribution(",
	)
	requireCTWAContractContains(t, nativeRecovery,
		"ProviderMessageIDSynthetic: incoming.ProviderMessageIDSynthetic")

	enrichmentCall := compactCTWAContract(sectionCTWAContract(
		t,
		source,
		"async function enrichManagedWhatsAppLeadEntryAttribution(",
		"async function logCreativeActivity(",
	))
	for _, fragment := range []string{
		"if (!isConfirmedClickToWhatsAppAd(message)) return false",
		`.rpc("enrich_whatsapp_lead_entry_attribution", {`,
		"p_organization_id: session.organization_id",
		"p_lead_id: leadId",
		"p_session_id: session.id",
		"p_provider_message_id: message.messageId",
	} {
		requireCTWAContractContains(t, enrichmentCall, fragment)
	}

	handleMessages := compactCTWAContract(sectionCTWAContract(
		t,
		source,
		"async function handleMessages(",
		"function statusFromProvider(",
	))
	handledBranch := strings.Index(handleMessages, "if (managedEntryLookup?.handled === true)")
	if handledBranch < 0 {
		t.Fatal("managed handled-retry branch is missing")
	}
	handledEnrichment := strings.Index(handleMessages[handledBranch:], "await enrichManagedWhatsAppLeadEntryAttribution(")
	handledContinue := strings.Index(handleMessages[handledBranch:], "continue")
	if handledEnrichment < 0 || handledContinue < 0 || handledEnrichment >= handledContinue {
		t.Fatal("a completed managed retry must enrich attribution before stopping business processing")
	}

	pendingBranch := strings.Index(handleMessages, "if (managedEntryLookup?.pending === true)")
	pendingMarker := strings.Index(handleMessages, "managedEntryWasPending = true")
	shouldPersist := strings.Index(handleMessages,
		"const shouldPersistAttribution = confirmedCtwaAd && ( result.inserted || (managedMessageDistribution && managedEntryWasPending)")
	if strings.Contains(handleMessages, "fallbackCtwaAttribution") {
		t.Fatal("an insert=false non-managed delivery must recover on retry instead of duplicating attribution or creative history")
	}
	requireCTWAContractContains(t, handleMessages,
		"if (!managedMessageDistribution && result.inserted)")
	managedSuccess := strings.Index(handleMessages, "if (managedMessageDistribution)")
	if managedSuccess < 0 {
		t.Fatal("managed intake success branch is missing")
	}
	processManaged := strings.Index(handleMessages[managedSuccess:], "await processManagedWhatsAppLeadEntry(")
	successEnrichment := strings.Index(handleMessages[managedSuccess:], "await enrichManagedWhatsAppLeadEntryAttribution(")
	if pendingBranch < 0 || pendingMarker < pendingBranch || shouldPersist < pendingMarker {
		t.Fatal("a pending retry must preserve attribution work after the message was already inserted")
	}
	if managedSuccess <= pendingBranch || processManaged < 0 || successEnrichment < 0 || processManaged >= successEnrichment {
		t.Fatal("managed pending and first-attempt success paths must enrich after the canonical intake RPC succeeds")
	}
	if strings.Index(handleMessages, "if (result.inserted && !managedMessageDistribution && !isReactionEvent)") < 0 {
		t.Fatal("normal inserted WhatsApp messages must keep auto-reply scheduling independent from CTWA attribution")
	}
}

func TestNativeOrganicAmbiguousPhoneRemainsReceivableWithoutUnsafeAttachment(t *testing.T) {
	source := compactCTWAContract(readCTWAContractFile(t,
		"apps", "api", "internal", "whatsapp", "webhook_native_processor.go",
	))
	for _, fragment := range []string{
		"if errors.Is(err, errNativeEvolutionLeadPhoneAmbiguous) && !message.IsCTWAAd",
		"lead = nativeEvolutionLead{}",
		"err = nil",
		"and l.phone is not null",
		"and normalize_phone(l.phone) = normalize_phone(candidate.value)",
	} {
		requireCTWAContractContains(t, source, fragment)
	}
	if strings.Contains(source, "to_jsonb(l)->>'whatsapp'") {
		t.Fatal("native phone lookup must not scan a nonexistent legacy lead field")
	}
}

func readCTWAContractFile(t *testing.T, pathParts ...string) string {
	t.Helper()
	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("unable to locate CTWA contract test")
	}
	repoRoot := filepath.Clean(filepath.Join(filepath.Dir(sourceFile), "..", "..", "..", ".."))
	raw, err := os.ReadFile(filepath.Join(append([]string{repoRoot}, pathParts...)...))
	if err != nil {
		t.Fatalf("read CTWA contract source: %v", err)
	}
	return string(raw)
}

func sectionCTWAContract(t *testing.T, source string, startMarker string, endMarker string) string {
	t.Helper()
	start := strings.Index(source, startMarker)
	if start < 0 {
		t.Fatalf("CTWA contract start marker is missing: %q", startMarker)
	}
	endOffset := strings.Index(source[start:], endMarker)
	if endOffset < 0 {
		t.Fatalf("CTWA contract end marker is missing after %q: %q", startMarker, endMarker)
	}
	return source[start : start+endOffset]
}

func compactCTWAContract(source string) string {
	return strings.Join(strings.Fields(source), " ")
}

func requireCTWAContractContains(t *testing.T, source string, fragment string) {
	t.Helper()
	if !strings.Contains(source, fragment) {
		t.Fatalf("CTWA contract is missing %q", fragment)
	}
}
