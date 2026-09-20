package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/distribution"
)

const (
	webhookProcessorEdge           = "edge"
	webhookProcessorNative         = "native"
	webhookProcessorNativeFallback = "native_fallback"
	nativeProviderMessageMaxBytes  = 1 << 20
	nativeCanonicalIntakeProofV1   = "canonical_intake_v1:"
)

type nativeEvolutionSession struct {
	ID               string
	OrganizationID   string
	PhoneNumber      string
	ProfileName      string
	OwnerUserID      string
	CreatedBy        string
	AdvancedSettings map[string]any
}

type nativeEvolutionConversation struct {
	ID                             string
	LeadID                         string
	MessageLeadID                  string
	RemoteJID                      string
	LeadIsNew                      bool
	LeadResolutionQuarantineReason string
	LeadScopeCompatibilityFallback bool
	RequestedOriginRoundRobinID    string
	HistoricalBindingReplay        bool
}

type nativeEvolutionLead struct {
	ID                          string
	AssignedUserID              string
	Name                        string
	IsNew                       bool
	ScopeCompatibilityFallback  bool
	RequestedOriginRoundRobinID string
}

type nativeEvolutionStoredMessageIdentity struct {
	ID               string
	ConversationID   string
	LeadID           string
	QuarantineReason string
}

type nativeIngressRoutingSnapshot struct {
	State                        string
	ProviderMessageID            string
	InboxEventKey                string
	ProcessingLane               string
	ConversationID               string
	EventLeadID                  string
	CurrentLeadID                string
	ActiveBindingID              string
	QuarantineReason             string
	ContextKind                  string
	ContextProof                 string
	RuleID                       string
	OriginRoundRobinID           string
	ManagedMessageDistribution   bool
	ManagedProviderEventPending  bool
	ManagedProviderEventHandled  bool
	RoutingKey                   string
	BindingEligible              bool
	TargetMode                   string
	IngressSequence              int64
	PredecessorProviderMessageID string
	PredecessorInboxEventKey     string
	PredecessorProcessingLane    string
}

func nativeIngressRoutingSnapshotForMessage(
	payload []byte,
	session nativeEvolutionSession,
	message nativeEvolutionMessage,
) (*nativeIngressRoutingSnapshot, error) {
	decoded, err := decodeNativeEvolutionPayload(payload)
	if err != nil {
		return nil, err
	}
	ingress := mapFromAny(decoded[evolutionWebhookRoutingMetaKey])
	envelope := mapFromAny(ingress["routing_snapshot"])
	if len(envelope) == 0 {
		// A1-to-B1 compatibility only. B1 drains/quarantines active legacy rows
		// before enforcing v1 on every newly active inbox delivery.
		return nil, nil
	}
	if nativeInt64(envelope["version"]) != 1 {
		return nil, errors.New("WhatsApp ingress routing snapshot envelope is invalid")
	}
	matches := []map[string]any{}
	for _, candidate := range nativeObjectList(envelope["messages"]) {
		if strings.TrimSpace(stringFromAny(candidate["provider_message_id"])) == strings.TrimSpace(message.ProviderMessageID) {
			matches = append(matches, candidate)
		}
	}
	if len(matches) != 1 {
		return nil, errors.New("WhatsApp ingress routing snapshot provider identity is missing or ambiguous")
	}
	row := matches[0]
	if nativeInt64(row["version"]) != 1 ||
		strings.TrimSpace(stringFromAny(row["organization_id"])) != session.OrganizationID ||
		strings.TrimSpace(stringFromAny(row["session_id"])) != session.ID {
		return nil, errors.New("WhatsApp ingress routing snapshot tenant scope is invalid")
	}
	normalizeOptionalUUID := func(value any) (string, error) {
		text := strings.TrimSpace(stringFromAny(value))
		if text == "" {
			return "", nil
		}
		normalized, ok := normalizeUUID(text)
		if !ok {
			return "", errors.New("WhatsApp ingress routing snapshot contains an invalid UUID")
		}
		return normalized, nil
	}
	managedMessageDistribution, managedMessageDistributionOK := nativeBool(row["managed_message_distribution"])
	managedProviderEventPending, managedProviderEventPendingOK := nativeBool(row["managed_event_pending"])
	managedProviderEventHandled, managedProviderEventHandledOK := nativeBool(row["managed_event_handled"])
	bindingEligible, bindingEligibleOK := nativeBool(row["binding_eligible"])
	snapshot := &nativeIngressRoutingSnapshot{
		State:                        strings.TrimSpace(stringFromAny(row["state"])),
		ProviderMessageID:            strings.TrimSpace(stringFromAny(row["provider_message_id"])),
		InboxEventKey:                strings.TrimSpace(stringFromAny(row["inbox_event_key"])),
		ProcessingLane:               strings.TrimSpace(stringFromAny(row["processing_lane"])),
		QuarantineReason:             strings.TrimSpace(stringFromAny(row["quarantine_reason"])),
		ContextKind:                  strings.TrimSpace(stringFromAny(row["context_kind"])),
		ContextProof:                 strings.TrimSpace(stringFromAny(row["context_proof"])),
		ManagedMessageDistribution:   managedMessageDistribution,
		ManagedProviderEventPending:  managedProviderEventPending,
		ManagedProviderEventHandled:  managedProviderEventHandled,
		RoutingKey:                   strings.TrimSpace(stringFromAny(row["routing_key"])),
		BindingEligible:              bindingEligible,
		TargetMode:                   strings.TrimSpace(stringFromAny(row["target_mode"])),
		IngressSequence:              nativeInt64(row["ingress_sequence"]),
		PredecessorProviderMessageID: strings.TrimSpace(stringFromAny(row["predecessor_provider_message_id"])),
		PredecessorInboxEventKey:     strings.TrimSpace(stringFromAny(row["predecessor_inbox_event_key"])),
		PredecessorProcessingLane:    strings.TrimSpace(stringFromAny(row["predecessor_processing_lane"])),
	}
	if snapshot.ConversationID, err = normalizeOptionalUUID(row["conversation_id"]); err != nil {
		return nil, err
	}
	if snapshot.EventLeadID, err = normalizeOptionalUUID(row["event_lead_id"]); err != nil {
		return nil, err
	}
	if snapshot.CurrentLeadID, err = normalizeOptionalUUID(row["current_lead_id"]); err != nil {
		return nil, err
	}
	if snapshot.ActiveBindingID, err = normalizeOptionalUUID(row["active_binding_id"]); err != nil {
		return nil, err
	}
	if snapshot.RuleID, err = normalizeOptionalUUID(row["rule_id"]); err != nil {
		return nil, err
	}
	if snapshot.OriginRoundRobinID, err = normalizeOptionalUUID(row["origin_round_robin_id"]); err != nil {
		return nil, err
	}
	validState := map[string]bool{
		"bound": true, "lead_match": true, "unlinked": true,
		"quarantine": true, "contextual_intake": true, "provider_replay": true,
		"predecessor_inherit": true,
	}[snapshot.State]
	if !validState ||
		snapshot.ProviderMessageID != strings.TrimSpace(message.ProviderMessageID) ||
		snapshot.InboxEventKey == "" ||
		(snapshot.ProcessingLane != "live" && snapshot.ProcessingLane != "backlog") ||
		snapshot.RoutingKey == "" ||
		!bindingEligibleOK ||
		(snapshot.TargetMode != "snapshot" && snapshot.TargetMode != "inherit_predecessor") ||
		snapshot.IngressSequence <= 0 ||
		!managedMessageDistributionOK ||
		!managedProviderEventPendingOK ||
		!managedProviderEventHandledOK ||
		(snapshot.ContextKind != "organic" && snapshot.ContextKind != "contextual_intake") ||
		(snapshot.ActiveBindingID != "" && (snapshot.ConversationID == "" || snapshot.CurrentLeadID == "")) ||
		(snapshot.State == "quarantine" && (snapshot.QuarantineReason == "" || snapshot.EventLeadID != "")) ||
		(snapshot.State != "quarantine" && snapshot.QuarantineReason != "") ||
		((snapshot.State == "bound" || snapshot.State == "lead_match" || snapshot.State == "provider_replay") && snapshot.EventLeadID == "") ||
		(snapshot.State == "unlinked" && snapshot.EventLeadID != "") ||
		(snapshot.State == "predecessor_inherit" && snapshot.EventLeadID != "") ||
		(snapshot.ManagedMessageDistribution && (snapshot.RuleID == "" || snapshot.OriginRoundRobinID == "" || snapshot.ContextKind != "contextual_intake")) ||
		(snapshot.ManagedMessageDistribution != (snapshot.ContextProof == "managed_rule")) ||
		(snapshot.ManagedProviderEventPending && snapshot.ManagedProviderEventHandled) ||
		(snapshot.ContextKind == "contextual_intake" && snapshot.ContextProof == "") ||
		(snapshot.BindingEligible && snapshot.RoutingKey == evolutionWebhookSessionRoute) ||
		(snapshot.TargetMode == "inherit_predecessor" && (snapshot.State != "predecessor_inherit" ||
			snapshot.ContextKind != "organic" ||
			!snapshot.BindingEligible ||
			snapshot.PredecessorProviderMessageID == "" ||
			snapshot.PredecessorInboxEventKey == "" ||
			(snapshot.PredecessorProcessingLane != "live" && snapshot.PredecessorProcessingLane != "backlog"))) ||
		(snapshot.TargetMode == "snapshot" && snapshot.State == "predecessor_inherit") ||
		(snapshot.PredecessorProviderMessageID == "" &&
			(snapshot.PredecessorInboxEventKey != "" || snapshot.PredecessorProcessingLane != "")) {
		return nil, errors.New("WhatsApp ingress routing snapshot contract is invalid")
	}
	return snapshot, nil
}

func nativeEvolutionMessagesInIngressOrder(
	payload []byte,
	session nativeEvolutionSession,
	messages []nativeEvolutionMessage,
) ([]nativeEvolutionMessage, error) {
	legacyOrder := nativeEvolutionMessageProcessingOrder(messages)
	if len(legacyOrder) <= 1 {
		return legacyOrder, nil
	}
	type orderedMessage struct {
		message  nativeEvolutionMessage
		sequence int64
		index    int
	}
	ordered := make([]orderedMessage, 0, len(legacyOrder))
	seen := map[int64]struct{}{}
	sequenced := 0
	for index, message := range legacyOrder {
		snapshot, err := nativeIngressRoutingSnapshotForMessage(payload, session, message)
		if err != nil {
			return nil, err
		}
		sequence := int64(0)
		if snapshot != nil {
			sequence = snapshot.IngressSequence
			if _, exists := seen[sequence]; exists {
				return nil, errors.New("WhatsApp ingress routing snapshot sequence is ambiguous")
			}
			seen[sequence] = struct{}{}
			sequenced++
		}
		ordered = append(ordered, orderedMessage{message: message, sequence: sequence, index: index})
	}
	if sequenced == 0 {
		return legacyOrder, nil
	}
	if sequenced != len(ordered) {
		return nil, errors.New("WhatsApp ingress routing snapshot batch is incomplete")
	}
	sort.SliceStable(ordered, func(left, right int) bool {
		if ordered[left].sequence == ordered[right].sequence {
			return ordered[left].index < ordered[right].index
		}
		return ordered[left].sequence < ordered[right].sequence
	})
	result := make([]nativeEvolutionMessage, 0, len(ordered))
	for _, entry := range ordered {
		result = append(result, entry.message)
	}
	return result, nil
}

const nativeLegacyNonManagedRecoveryQuery = `
	/* whatsapp-lock-order:native-legacy-recovery */
	with target_identity as materialized (
	  select message.id, message.conversation_id
	  from public.whatsapp_messages as message
	  where message.organization_id = $1::uuid
	    and message.session_id = $2::uuid
	    and (
	      message.provider_message_id = $3
	      or (message.provider_message_id is null and message.message_id = $3)
	    )
	    and coalesce(message.from_me, false) = false
	    and lower(coalesce(message.direction, 'inbound')) <> 'outbound'
	  order by message.created_at, message.id
	  limit 1
	), locked_conversation as materialized (
	  select conversation.id
	  from target_identity as target
	  join public.whatsapp_conversations as conversation
	    on conversation.id = target.conversation_id
	  where conversation.organization_id = $1::uuid
	    and conversation.session_id = $2::uuid
	  for no key update of conversation
	)
	select
	  message.id::text,
	  message.conversation_id::text,
	  coalesce(message.lead_id::text, ''),
	  coalesce(conversation.lead_id::text, ''),
	  conversation.remote_jid,
	  coalesce(message.provider_message_id, message.message_id, ''),
	  coalesce(message.content, ''),
	  coalesce(message.message_type, 'text'),
	  coalesce(message.sent_at, message.received_at, message.created_at),
	  coalesce(message.metadata, '{}'::jsonb)::text,
	  coalesce(lead.metadata, '{}'::jsonb)::text
	from target_identity as target
	join locked_conversation as locked
	  on locked.id = target.conversation_id
	join public.whatsapp_messages as message
	  on message.id = target.id
	 and message.conversation_id = locked.id
	join public.whatsapp_conversations as conversation
	  on conversation.id = locked.id
	 and conversation.organization_id = message.organization_id
	 and conversation.session_id = message.session_id
	left join public.leads as lead
	  on lead.organization_id = message.organization_id
	 and lead.id = message.lead_id
	where message.organization_id = $1::uuid
	  and message.session_id = $2::uuid
	  and (
	    message.provider_message_id = $3
	    or (message.provider_message_id is null and message.message_id = $3)
	  )
	  and coalesce(message.from_me, false) = false
	  and lower(coalesce(message.direction, 'inbound')) <> 'outbound'
	for update of message
`

const nativeLegacyNonManagedConversationRecoveryQuery = `
	update public.whatsapp_conversations as conversation
	set last_message = $5,
	    last_message_preview = $5,
	    last_message_at = $4::timestamptz,
	    unread_count = greatest(0, coalesce(conversation.unread_count, 0) + 1),
	    updated_at = now()
	where conversation.organization_id = $1::uuid
	  and conversation.session_id = $2::uuid
	  and conversation.id = $3::uuid
	  and conversation.lead_id = $6::uuid
	  and (conversation.last_message_at is null or conversation.last_message_at < $4::timestamptz)
`

var errNativeWebhookMessageLikeUnsupported = errors.New("native WhatsApp processor rejected an unsupported message-like event")
var errNativeEvolutionLeadPhoneAmbiguous = errors.New("native WhatsApp lead phone matches multiple leads")
var errNativeEvolutionAliasLeadAmbiguous = errors.New("native WhatsApp identity aliases match multiple leads")
var errNativeEvolutionScopedLeadMissing = errors.New("scoped WhatsApp conversation lead was not found in organization")

func normalizeEvolutionWebhookProcessorMode(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case webhookProcessorNative:
		return webhookProcessorNative
	case webhookProcessorNativeFallback, "native-fallback", "hybrid":
		return webhookProcessorNativeFallback
	default:
		// Production remains on the existing Edge processor until the operator
		// explicitly enables a session-safe backend cutover.
		return webhookProcessorEdge
	}
}

func (repo Repository) dispatchEvolutionWebhook(ctx context.Context, item pendingEvolutionWebhook) error {
	// History-sync control envelopes are not CRM messages. A provider version
	// can still emit one during reconnect even when the session subscription is
	// live-only; acknowledge it here so it cannot consume retries or reach Edge.
	if evolutionWebhookIsHistorySyncControl(item) {
		return nil
	}
	// Drain group-only rows that predate the ingress filter without creating
	// conversations or calling Edge. Mixed historical rows are filtered before
	// either processor sees them, preserving only their direct messages.
	filteredItem, groupOnly, err := prepareEvolutionWebhookWithoutGroupMessages(item)
	if err != nil {
		return err
	}
	if groupOnly {
		return nil
	}
	item = filteredItem

	mode := evolutionWebhookProcessorModeForSession(
		repo.functions.webhookProcessorMode,
		repo.functions.webhookRolloutSessionIDs,
		item.SessionID,
	)
	if mode == webhookProcessorEdge {
		return repo.forwardEvolutionWebhook(ctx, item)
	}

	handled, err := repo.processEvolutionWebhookNative(ctx, item)
	if err != nil {
		return err
	}
	if handled {
		return nil
	}
	if mode == webhookProcessorNativeFallback {
		// Never hand an unrecognized message, reaction, receipt or campaign
		// referral to the legacy Edge implementation. A version-skewed Edge
		// could create a lead or persist a message under weaker rules. Keeping
		// the item in the durable inbox makes it retry and eventually enter the
		// DLQ without crossing that trust boundary.
		if nativeFallbackRequiresNativeHandling(item) {
			return errNativeWebhookMessageLikeUnsupported
		}
		return repo.forwardEvolutionWebhook(ctx, item)
	}
	return errors.New("native WhatsApp processor does not support this event")
}

func evolutionWebhookIsHistorySyncControl(item pendingEvolutionWebhook) bool {
	payload, err := decodeNativeEvolutionPayload(item.Payload)
	if err != nil {
		return false
	}
	if compactEvolutionWebhookControlName(nativeEvolutionEventName(payload, item.EventType)) == "historysync" {
		return true
	}
	messages := extractNativeEvolutionMessages(payload)
	if len(messages) == 0 {
		return false
	}
	for _, message := range messages {
		if !nativeEvolutionMessageIsHistorySyncControl(message) {
			return false
		}
	}
	return true
}

func prepareEvolutionWebhookWithoutGroupMessages(item pendingEvolutionWebhook) (pendingEvolutionWebhook, bool, error) {
	payload, err := decodeNativeEvolutionPayload(item.Payload)
	if err != nil {
		// Preserve the existing invalid-payload path; its processor will return
		// the canonical decode error and keep the durable retry semantics.
		return item, false, nil
	}
	messages := withoutNativeEvolutionHistorySyncControls(extractNativeEvolutionMessages(payload))
	if len(messages) == 0 {
		return item, false, nil
	}
	groupCount := 0
	for _, message := range messages {
		if message.IsGroup {
			groupCount++
		}
	}
	if groupCount == 0 {
		return item, false, nil
	}
	if groupCount == len(messages) {
		return item, true, nil
	}
	if !filterNativeEvolutionGroupMessageLists(payload) {
		return item, false, fmt.Errorf("mixed Evolution webhook contains a group message that cannot be filtered safely")
	}
	filteredPayload, err := json.Marshal(payload)
	if err != nil {
		return item, false, fmt.Errorf("filter mixed Evolution group webhook: %w", err)
	}
	filteredDecoded, err := decodeNativeEvolutionPayload(filteredPayload)
	if err != nil {
		return item, false, fmt.Errorf("verify mixed Evolution group webhook: %w", err)
	}
	remaining := withoutNativeEvolutionHistorySyncControls(extractNativeEvolutionMessages(filteredDecoded))
	if len(remaining) == 0 {
		return item, false, fmt.Errorf("mixed Evolution webhook lost its direct message while filtering groups")
	}
	for _, message := range remaining {
		if message.IsGroup {
			return item, false, fmt.Errorf("mixed Evolution webhook retained a group message after filtering")
		}
	}
	item.Payload = filteredPayload
	return item, false, nil
}

func filterNativeEvolutionGroupMessageLists(payload map[string]any) bool {
	containers := []map[string]any{payload}
	if data := mapFromAny(nativeFirstValue(payload, "data", "Data")); len(data) > 0 {
		containers = append(containers, data)
	}
	changed := false
	for _, container := range containers {
		for _, key := range []string{"messages", "Messages"} {
			values, ok := container[key].([]any)
			if !ok {
				continue
			}
			filtered := make([]any, 0, len(values))
			for _, value := range values {
				raw, ok := value.(map[string]any)
				if !ok {
					filtered = append(filtered, value)
					continue
				}
				message, ok := normalizeNativeEvolutionMessage(raw)
				if ok && message.IsGroup {
					changed = true
					continue
				}
				filtered = append(filtered, value)
			}
			container[key] = filtered
		}
	}
	return changed
}

func nativeEvolutionMessageIsHistorySyncControl(message nativeEvolutionMessage) bool {
	messageNode := nativeFirstMap(message.Raw, "message", "Message")
	if len(messageNode) == 0 {
		messageNode = message.Raw
	}
	protocol := nativeFirstMap(messageNode, "protocolMessage", "ProtocolMessage")
	protocolType := compactEvolutionWebhookControlName(firstString(
		protocol,
		"type", "Type", "protocolType", "protocol_type",
	))
	return protocolType == "historysync" || protocolType == "historysyncnotification" || protocolType == "5"
}

func withoutNativeEvolutionHistorySyncControls(messages []nativeEvolutionMessage) []nativeEvolutionMessage {
	filtered := make([]nativeEvolutionMessage, 0, len(messages))
	for _, message := range messages {
		if nativeEvolutionMessageIsHistorySyncControl(message) {
			continue
		}
		filtered = append(filtered, message)
	}
	return filtered
}

func withoutNativeEvolutionGroupMessages(messages []nativeEvolutionMessage) []nativeEvolutionMessage {
	filtered := make([]nativeEvolutionMessage, 0, len(messages))
	for _, message := range messages {
		if message.IsGroup {
			continue
		}
		filtered = append(filtered, message)
	}
	return filtered
}

func nativeEvolutionMessageProcessingOrder(messages []nativeEvolutionMessage) []nativeEvolutionMessage {
	if len(messages) < 2 {
		return messages
	}

	ordered := make([]nativeEvolutionMessage, 0, len(messages))
	for _, message := range messages {
		if message.IsReaction || message.IsDeletion {
			continue
		}
		ordered = append(ordered, message)
	}
	for _, message := range messages {
		if !message.IsReaction && !message.IsDeletion {
			continue
		}
		ordered = append(ordered, message)
	}
	return ordered
}

func compactEvolutionWebhookControlName(value string) string {
	return strings.NewReplacer(".", "", "_", "", "-", "", " ", "").Replace(strings.ToLower(strings.TrimSpace(value)))
}

func nativeFallbackRequiresNativeHandling(item pendingEvolutionWebhook) bool {
	payload, err := decodeNativeEvolutionPayload(item.Payload)
	if err != nil {
		return true
	}
	event := nativeEvolutionEventName(payload, item.EventType)
	compactEvent := strings.NewReplacer(".", "", "_", "", "-", "", " ", "").Replace(strings.ToLower(event))
	for _, marker := range []string{"message", "reaction", "receipt", "ack", "referral", "campaign", "ctwa", "externalad"} {
		if strings.Contains(compactEvent, marker) {
			return true
		}
	}
	if nativeIsStatusEvent(event) &&
		!strings.Contains(compactEvent, "connection") &&
		!strings.Contains(compactEvent, "instance") &&
		!strings.Contains(compactEvent, "session") {
		return true
	}
	if len(extractNativeEvolutionMessages(payload)) > 0 ||
		len(extractNativeEvolutionStatuses(payload)) > 0 ||
		nativeHasCampaignSignal(payload) ||
		len(nativeCampaignReferral(payload)) > 0 {
		return true
	}
	return nativePayloadContainsMessageLikeKey(payload, 0)
}

func nativePayloadContainsMessageLikeKey(value any, depth int) bool {
	if depth > 12 || value == nil {
		return false
	}
	switch typed := value.(type) {
	case map[string]any:
		for key, nested := range typed {
			normalized := strings.NewReplacer("_", "", "-", "", ".", "", " ", "").Replace(strings.ToLower(key))
			for _, marker := range []string{"message", "reaction", "receipt", "referral", "campaign", "ctwa", "externaladreply"} {
				if strings.Contains(normalized, marker) {
					return true
				}
			}
			if nativePayloadContainsMessageLikeKey(nested, depth+1) {
				return true
			}
		}
	case []any:
		for _, nested := range typed {
			if nativePayloadContainsMessageLikeKey(nested, depth+1) {
				return true
			}
		}
	}
	return false
}

func evolutionWebhookProcessorModeForSession(configuredMode string, allowlist []string, sessionID string) string {
	if !webhookRolloutAllowsSession(allowlist, sessionID) {
		return webhookProcessorEdge
	}
	return normalizeEvolutionWebhookProcessorMode(configuredMode)
}

func (repo Repository) processEvolutionWebhookNative(ctx context.Context, item pendingEvolutionWebhook) (bool, error) {
	if strings.TrimSpace(item.OrganizationID) == "" || strings.TrimSpace(item.SessionID) == "" {
		return false, fmt.Errorf("native webhook requires organization and session scope")
	}
	payload, err := decodeNativeEvolutionPayload(item.Payload)
	if err != nil {
		return false, err
	}
	event := nativeEvolutionEventName(payload, item.EventType)

	if nativeIsStatusEvent(event) {
		statuses := extractNativeEvolutionStatuses(payload)
		if len(statuses) == 0 {
			return false, nil
		}
		return true, repo.processNativeEvolutionStatuses(ctx, item, statuses)
	}

	messages := extractNativeEvolutionMessages(payload)
	if len(messages) > 0 {
		messages = withoutNativeEvolutionHistorySyncControls(messages)
		messages = withoutNativeEvolutionGroupMessages(messages)
		if len(messages) == 0 {
			return true, nil
		}
		for _, message := range messages {
			// Unsupported protocol shapes remain in the durable inbox and can
			// never fall back to Edge. Campaign referrals supported by the native
			// parser continue below under the strict Meta-only creation rules.
			if message.UnsupportedMessage {
				return false, nil
			}
			if message.IsReaction && message.ReactionTargetID == "" {
				return false, nil
			}
			if !message.IsReaction && !message.IsDeletion && !nativeIsMediaType(message.MessageType) && strings.TrimSpace(message.Content) == "" {
				return false, nil
			}
		}
		// Persist the conversation, canonical message and media job without any
		// provider I/O. The separately leased media worker applies type/size policy
		// through a bounded pool with per-session serialization.
		if err := repo.processNativeEvolutionMessages(ctx, item, messages); err != nil {
			return true, err
		}
		return true, nil
	}

	qrCode := ""
	if strings.Contains(event, "qr") {
		qrCode = nativeEvolutionQRCode(payload)
	}
	connectionStatus, connectionRecognized, connectionError := nativeEvolutionConnectionStatus(payload, event)
	if qrCode == "" && !connectionRecognized {
		return false, nil
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return true, err
	}
	defer tx.Rollback(ctx)
	// Connection events mutate the session itself and never touch a
	// conversation. Acquire the exclusive row lock up front so this path cannot
	// upgrade a shared lock after another worker has queued.
	session, err := loadNativeEvolutionSessionWithLock(ctx, tx, item, true)
	if err != nil {
		return true, err
	}
	lifecycleUpdatesAllowed := sessionAutoReconnectEnabled(session.AdvancedSettings)
	if qrCode != "" && lifecycleUpdatesAllowed {
		if _, err := tx.Exec(ctx, `
			update public.whatsapp_sessions
			set status = 'qr_ready',
			    qr_code = $3,
			    advanced_settings = coalesce(advanced_settings, '{}'::jsonb) || jsonb_build_object(
			      'qr_code', $3,
			      'qr_updated_at', now()
			    ),
			    updated_at = now()
			where organization_id = $1::uuid
			  and id = $2::uuid
			  and provider = 'evolution_go'
			  and coalesce(is_active, true) = true
			  and coalesce(status, '') not in ('deleted', 'disabled')
			  and lower(coalesce(advanced_settings->>'auto_reconnect_enabled', 'true')) <> 'false'
		`, session.OrganizationID, session.ID, qrCode); err != nil {
			return true, err
		}
	}
	if connectionRecognized && lifecycleUpdatesAllowed {
		data := nativeFirstMap(payload, "data", "Data")
		jid := firstNonEmpty(
			firstString(data, "jid", "JID", "phone", "Phone", "user.id"),
			firstString(payload, "jid", "JID", "phone", "Phone", "user.id"),
		)
		phoneNumber := ""
		if phone, ok := phoneFromIdentityValue(jid); ok {
			phoneNumber = phone
		}
		profileName := firstNonEmpty(
			firstString(data, "pushName", "name", "profileName"),
			firstString(payload, "pushName", "name", "profileName"),
			session.ProfileName,
		)
		if _, err := tx.Exec(ctx, `
			update public.whatsapp_sessions
			set status = coalesce(nullif($3, ''), status),
			    phone_number = case when $3 = 'connected' then coalesce(nullif($4, ''), phone_number) else phone_number end,
			    profile_name = case when $3 = 'connected' then coalesce(nullif($5, ''), profile_name) else profile_name end,
			    last_connected_at = case when $3 = 'connected' then now() else last_connected_at end,
			    last_error = nullif($6, ''),
			    updated_at = now()
			where organization_id = $1::uuid
			  and id = $2::uuid
			  and provider = 'evolution_go'
			  and coalesce(is_active, true) = true
			  and coalesce(status, '') not in ('deleted', 'disabled')
			  and lower(coalesce(advanced_settings->>'auto_reconnect_enabled', 'true')) <> 'false'
		`, session.OrganizationID, session.ID, connectionStatus, phoneNumber, profileName, connectionError); err != nil {
			return true, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return true, err
	}
	if connectionRecognized && connectionStatus == "connected" {
		// Offline outbox/media rows are deliberately skipped by their hot claims.
		// Wake both workers immediately when the signed provider event makes the
		// session eligible again instead of waiting for a polling interval.
		wakeWhatsAppOutboxWorker()
		wakeWhatsAppMediaWorker()
	}
	return true, nil
}

func nativeEvolutionMessagesContainMedia(messages []nativeEvolutionMessage) bool {
	for index := range messages {
		if nativeIsMediaType(messages[index].MessageType) {
			return true
		}
	}
	return false
}

func (repo Repository) downloadNativeEvolutionMedia(
	ctx context.Context,
	item pendingEvolutionWebhook,
	message nativeEvolutionMessage,
	maxDecodedBytes int64,
) (recoveredWhatsAppMedia, error) {
	providerMessage, err := nativeEvolutionProviderMessage(message)
	if err != nil {
		return recoveredWhatsAppMedia{}, err
	}
	body := map[string]any{
		"message":   providerMessage,
		"messageId": message.ProviderMessageID,
	}
	payload := map[string]any{
		"session_id":      item.SessionID,
		"organization_id": item.OrganizationID,
		"body":            body,
	}

	responseLimit := evolutionMediaResponseMaxBytes(maxDecodedBytes)
	response, err := repo.functions.invokeEvolutionDirectWithResponseLimit(
		ctx,
		"message.downloadMedia",
		payload,
		responseLimit,
	)
	if err != nil {
		return recoveredWhatsAppMedia{}, err
	}
	status := nativeEvolutionResponseStatus(response)
	if !nativeEvolutionResponseOK(response) && (status == 404 || status == 405) {
		response, err = repo.functions.invokeEvolutionDirectWithResponseLimit(
			ctx,
			"message.downloadImage",
			payload,
			responseLimit,
		)
		if err != nil {
			return recoveredWhatsAppMedia{}, err
		}
	}
	if !nativeEvolutionResponseOK(response) {
		if message := providerErrorMessage(response, ""); isAuthoritativeEvolutionStatusDisconnect(message) {
			return recoveredWhatsAppMedia{}, fmt.Errorf(
				"%w: %s",
				errWhatsAppMediaProviderDisconnected,
				message,
			)
		}
		return recoveredWhatsAppMedia{}, nativeEvolutionMediaRejection(nativeEvolutionResponseStatus(response))
	}

	encoded := firstString(response,
		"data.data.base64",
		"data.base64",
		"base64",
		"data.data.data.base64",
	)
	if encoded == "" {
		return recoveredWhatsAppMedia{}, fmt.Errorf("%w: Evolution Go media recovery returned no bytes", ErrProviderFailed)
	}
	contentType := nativeDataURLMimeType(encoded)
	decoded, err := decodeFlexibleBase64Media(encoded)
	if err != nil {
		return recoveredWhatsAppMedia{}, err
	}
	if len(decoded) == 0 {
		return recoveredWhatsAppMedia{}, fmt.Errorf("%w: Evolution Go media recovery returned an empty file", ErrProviderFailed)
	}
	if len(decoded) > whatsappMediaMaxBytes {
		return recoveredWhatsAppMedia{}, fmt.Errorf("%w: arquivo acima do limite de 25MB", ErrInvalidInput)
	}

	return recoveredWhatsAppMedia{
		bytes:       decoded,
		contentType: firstNonEmpty(contentType, message.MediaMimeType, detectWhatsAppMediaMimeType(decoded), fallbackWhatsAppMediaMimeType(message.MessageType)),
		source:      "evolution_go_download",
	}, nil
}

func nativeEvolutionMediaRejection(status int64) error {
	if status == http.StatusRequestEntityTooLarge {
		return fmt.Errorf(
			"%w: %w: Evolution Go rejected media above the configured size",
			ErrProviderFailed,
			errWhatsAppMediaTooLarge,
		)
	}
	return fmt.Errorf("%w: Evolution Go media recovery failed with status %d", ErrProviderFailed, status)
}

func nativeEvolutionProviderMessage(message nativeEvolutionMessage) (map[string]any, error) {
	node := nativeFirstMap(message.Raw, "message", "Message")
	if len(node) == 0 {
		node = message.Raw
	}
	blockNames := map[string]string{
		"imagemessage":    "imageMessage",
		"videomessage":    "videoMessage",
		"audiomessage":    "audioMessage",
		"documentmessage": "documentMessage",
		"stickermessage":  "stickerMessage",
	}
	providerMessage := map[string]any{}
	for key, value := range node {
		canonical, allowed := blockNames[strings.ToLower(strings.TrimSpace(key))]
		if !allowed {
			continue
		}
		block, ok := nativeSanitizeProviderValue(value, 0)
		if !ok {
			return nil, fmt.Errorf("%w: Evolution Go media message is invalid", ErrProviderFailed)
		}
		block, ok = nativeNormalizeProviderMediaNumbers(block)
		if !ok {
			return nil, fmt.Errorf("%w: Evolution Go media message has invalid numeric metadata", ErrProviderFailed)
		}
		providerMessage[canonical] = block
		break
	}
	if len(providerMessage) == 0 {
		return nil, fmt.Errorf("%w: Evolution Go media block was not found", ErrProviderFailed)
	}
	raw, err := json.Marshal(providerMessage)
	if err != nil || len(raw) > nativeProviderMessageMaxBytes {
		return nil, fmt.Errorf("%w: Evolution Go media message exceeds the recovery limit", ErrProviderFailed)
	}
	return providerMessage, nil
}

func nativeNormalizeProviderMediaNumbers(value any) (any, bool) {
	block, ok := value.(map[string]any)
	if !ok {
		return nil, false
	}
	for _, key := range []string{"fileLength", "mediaKeyTimestamp"} {
		raw, exists := block[key]
		if !exists {
			continue
		}
		text, isText := raw.(string)
		if !isText {
			continue
		}
		parsed, err := strconv.ParseUint(strings.TrimSpace(text), 10, 64)
		if err != nil {
			return nil, false
		}
		block[key] = parsed
	}
	return block, true
}

func nativeSanitizeProviderValue(value any, depth int) (any, bool) {
	if depth > 10 {
		return nil, false
	}
	switch typed := value.(type) {
	case nil, bool, float64, int, int64:
		return typed, true
	case string:
		if len(typed) > nativeProviderMessageMaxBytes {
			return nil, false
		}
		return stripNullBytes(typed), true
	case map[string]any:
		if len(typed) > 256 {
			return nil, false
		}
		out := make(map[string]any, len(typed))
		for key, item := range typed {
			key = strings.TrimSpace(stripNullBytes(key))
			if key == "" || len(key) > 128 {
				return nil, false
			}
			clean, ok := nativeSanitizeProviderValue(item, depth+1)
			if !ok {
				return nil, false
			}
			out[key] = clean
		}
		return out, true
	case []any:
		if len(typed) > 256 {
			return nil, false
		}
		out := make([]any, 0, len(typed))
		for _, item := range typed {
			clean, ok := nativeSanitizeProviderValue(item, depth+1)
			if !ok {
				return nil, false
			}
			out = append(out, clean)
		}
		return out, true
	default:
		return nil, false
	}
}

func nativeEvolutionResponseOK(response map[string]any) bool {
	value, _ := nativeBool(response["ok"])
	return value
}

func nativeEvolutionResponseStatus(response map[string]any) int64 {
	return nativeInt64(response["status"])
}

func nativeDataURLMimeType(value string) string {
	value = strings.TrimSpace(value)
	if !strings.HasPrefix(strings.ToLower(value), "data:") {
		return ""
	}
	header, _, found := strings.Cut(value, ",")
	if !found {
		return ""
	}
	header = header[len("data:"):]
	mimeType, _, _ := strings.Cut(header, ";")
	if !strings.Contains(mimeType, "/") {
		return ""
	}
	return strings.ToLower(strings.TrimSpace(mimeType))
}

func (repo Repository) processNativeEvolutionMessages(ctx context.Context, item pendingEvolutionWebhook, messages []nativeEvolutionMessage) error {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	// A signed outbound event may repair the stored account phone. Take the
	// exclusive session lock before any conversation only for batches that can
	// perform that write; ordinary inbound batches retain a shared fence and can
	// progress independently across conversations.
	session, err := loadNativeEvolutionSessionWithLock(
		ctx,
		tx,
		item,
		nativeEvolutionMessagesMayUpdateSession(messages),
	)
	if err != nil {
		return err
	}

	allowAutomatedReply := evolutionWebhookAllowsAutomatedReply(item)
	autoReplyInputs := []autoReplyInput{}
	leadIDsToPublish := map[string]struct{}{}
	mediaQueued := false
	orderedMessages, err := nativeEvolutionMessagesInIngressOrder(item.Payload, session, messages)
	if err != nil {
		return err
	}
	for _, message := range orderedMessages {
		routingSnapshot, err := nativeIngressRoutingSnapshotForMessage(item.Payload, session, message)
		if err != nil {
			return err
		}
		if message.FromMe {
			// Some provider status endpoints expose the profile name in the field
			// historically treated as a phone. A signed outbound webhook is a
			// stronger source for the account JID and repairs that legacy value so
			// outbound reactions have a canonical actor identity.
			if phoneNumber, ok := phoneFromIdentityValue(message.SenderJID); ok && phoneNumber != session.PhoneNumber {
				if _, err := tx.Exec(ctx, `
					update public.whatsapp_sessions
					set phone_number = $3, updated_at = now()
					where organization_id = $1::uuid and id = $2::uuid
					  and provider = 'evolution_go'
				`, session.OrganizationID, session.ID, phoneNumber); err != nil {
					return err
				}
				session.PhoneNumber = phoneNumber
			}
		}
		if message.IsDeletion {
			if err := processNativeEvolutionDeletion(ctx, tx, session, message); err != nil {
				return err
			}
			continue
		}
		if message.IsReaction {
			if err := processNativeEvolutionReaction(ctx, tx, session, message); err != nil {
				return err
			}
			continue
		}
		if nativeIsMediaType(message.MessageType) && message.MediaStoragePath == "" {
			policy := automaticWhatsAppMediaPolicy(message.MessageType, message.MediaMimeType, message.MediaSize)
			if policy.automatic {
				message.MediaStatus = "pending"
				message.MediaError = ""
			} else {
				message.MediaStatus = "failed"
				message.MediaError = policy.errorCode
			}
		}

		if _, err := tx.Exec(ctx, `
			select pg_advisory_xact_lock(hashtextextended($1, 0))
		`, "whatsapp-native:"+session.OrganizationID+":"+firstNonEmpty(message.ContactPhone, message.ProviderMessageID)); err != nil {
			return err
		}
		rule := nativeInboundRule{}
		if routingSnapshot != nil {
			rule = nativeInboundRule{
				ID:                          routingSnapshot.RuleID,
				TargetRoundRobinID:          routingSnapshot.OriginRoundRobinID,
				ManagedMessageDistribution:  routingSnapshot.ManagedMessageDistribution,
				ManagedProviderEventPending: routingSnapshot.ManagedProviderEventPending,
				ManagedProviderEventHandled: routingSnapshot.ManagedProviderEventHandled,
				ManagedProviderEventLeadID:  routingSnapshot.EventLeadID,
				CanonicalIntakeResolved:     strings.HasPrefix(routingSnapshot.ContextProof, nativeCanonicalIntakeProofV1),
				IngressSnapshotPresent:      true,
			}
		} else {
			rule, err = findNativeInboundRule(ctx, tx, session, message)
			if err != nil {
				return err
			}
			if message.IsCTWAAd && !rule.ManagedMessageDistribution &&
				strings.TrimSpace(rule.ManagedProviderEventLeadID) == "" {
				if nativeCTWAAdConfirmationMethod(message) == "" {
					return errors.New("click-to-WhatsApp intake is missing canonical provider proof")
				}
				propertyID, propertyErr := resolveNativeCampaignProperty(
					ctx,
					tx,
					session.OrganizationID,
					message.CampaignPropertyCode,
				)
				if propertyErr != nil {
					return propertyErr
				}
				intakeDestination, destinationErr := resolveNativeCTWAIntakeDestination(
					ctx,
					tx,
					session,
					message,
					propertyID,
				)
				if destinationErr != nil {
					return destinationErr
				}
				rule = nativeInboundRule{CanonicalIntakeResolved: true}
				if intakeDestination.RoundRobinID != nil {
					rule.TargetRoundRobinID = *intakeDestination.RoundRobinID
				}
			}
		}
		if nativeManagedProviderEventAlreadyHandled(rule) {
			if err := reconcileNativeHandledMessageTransport(ctx, tx, session, message); err != nil {
				return err
			}
			if rule.LegacyNonManagedRetry {
				if err := recoverNativeLegacyNonManagedRetry(ctx, tx, session, message, rule); err != nil {
					return err
				}
			} else if message.IsCTWAAd {
				// Edge may have committed the managed ledger before a transient
				// attribution failure. A native retry repairs that metadata, while
				// tolerating older handled rows that predate attribution support.
				if err := enrichNativeManagedWhatsAppLeadEntryAttribution(
					ctx,
					tx,
					session,
					rule.ManagedProviderEventLeadID,
					message,
					true,
				); err != nil {
					return err
				}
			}
			if allowAutomatedReply && boolFromObject(session.AdvancedSettings, "ai_auto_reply_enabled") {
				recoveredInput, ok, err := recoverNativeHandledAutoReplyInput(
					ctx,
					tx,
					session,
					message.ProviderMessageID,
					rule.ManagedProviderEventLeadID,
				)
				if err != nil {
					return err
				}
				if ok {
					autoReplyInputs = append(autoReplyInputs, recoveredInput)
				}
			}
			if leadID := strings.TrimSpace(rule.ManagedProviderEventLeadID); leadID != "" {
				leadIDsToPublish[leadID] = struct{}{}
			}
			continue
		}
		storedIdentity, err := findNativeEvolutionStoredMessageIdentity(ctx, tx, session, message)
		if err != nil {
			return err
		}
		conversation, err := ensureNativeEvolutionConversation(ctx, tx, session, message, rule, storedIdentity, routingSnapshot)
		if err != nil {
			return err
		}
		if message.FromMe {
			// The outbox finalizer always locks outbox before messages. Preserve that
			// order before insertNativeEvolutionMessage can lock a duplicate row.
			if err := lockNativeOutboundOutbox(ctx, tx, session, message.ProviderMessageID); err != nil {
				return err
			}
		}
		inserted, effectiveConversationID, messageRowID, err := insertNativeEvolutionMessage(ctx, tx, session, conversation, message)
		if err != nil {
			return err
		}
		queued := false
		if conversation.LeadResolutionQuarantineReason == "" {
			queued, err = enqueueNativeEvolutionMediaJob(ctx, tx, session, effectiveConversationID, message, messageRowID)
			if err != nil {
				return err
			}
		}
		mediaQueued = mediaQueued || queued
		if message.FromMe {
			if err := reconcileNativeOutboundOutbox(ctx, tx, session, message, messageRowID); err != nil {
				return err
			}
		}
		eventBindingIsCurrent := !conversation.HistoricalBindingReplay &&
			nativeEvolutionMessageLeadID(conversation) == strings.TrimSpace(conversation.LeadID)
		if inserted && effectiveConversationID == conversation.ID && eventBindingIsCurrent {
			var updated bool
			updated, err = updateNativeEvolutionConversation(ctx, tx, session, conversation, message)
			if err != nil {
				return err
			}
			eventBindingIsCurrent = updated
		}
		if !message.FromMe && !message.IsGroup {
			applyInboundEffects := inserted || rule.ManagedProviderEventPending
			// A historical/CAS-losing provider event may persist its immutable
			// message under the original card, but it must never repeat lead-entry,
			// distribution, unread/preview, automation or other current-binding
			// effects after a newer accepted intent (or a manual relink) won.
			if applyInboundEffects && eventBindingIsCurrent && conversation.LeadResolutionQuarantineReason == "" {
				if err := applyNativeInboundBusinessEffects(ctx, tx, session, conversation, message, messageRowID, rule); err != nil {
					return err
				}
				if leadID := nativeEvolutionMessageLeadID(conversation); leadID != "" {
					leadIDsToPublish[leadID] = struct{}{}
				}
			}
			if allowAutomatedReply && applyInboundEffects && eventBindingIsCurrent && conversation.LeadResolutionQuarantineReason == "" && nativeEvolutionMessageLeadID(conversation) != "" && boolFromObject(session.AdvancedSettings, "ai_auto_reply_enabled") && strings.TrimSpace(message.Content) != "" {
				autoReplyInputs = append(autoReplyInputs, autoReplyInput{
					OrganizationID: session.OrganizationID,
					SessionID:      session.ID,
					ConversationID: conversation.ID,
					MessageID:      messageRowID,
					ExpectedLeadID: nativeEvolutionMessageLeadID(conversation),
					Text:           message.Content,
				})
			}
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	repo.publishNativeLeadChanges(session.OrganizationID, leadIDsToPublish)
	if mediaQueued {
		wakeWhatsAppMediaWorker()
	}
	if allowAutomatedReply {
		for _, input := range autoReplyInputs {
			if _, err := repo.enqueueAutoReplyJob(ctx, input); err != nil {
				if errors.Is(err, errAutoReplyBindingStale) {
					continue
				}
				return err
			}
		}
	}
	return nil
}

func evolutionWebhookAllowsAutomatedReply(item pendingEvolutionWebhook) bool {
	return strings.TrimSpace(item.ProcessingLane) == evolutionWebhookLaneLive
}

func recoverNativeLegacyNonManagedRetry(
	ctx context.Context,
	tx pgx.Tx,
	session nativeEvolutionSession,
	incoming nativeEvolutionMessage,
	rule nativeInboundRule,
) error {
	var messageRowID string
	var conversationID string
	var messageLeadID string
	var conversationLeadID string
	var remoteJID string
	var providerMessageID string
	var content string
	var messageType string
	var sentAt time.Time
	var messageMetadataJSON string
	var leadMetadataJSON string
	if err := tx.QueryRow(
		ctx,
		nativeLegacyNonManagedRecoveryQuery,
		session.OrganizationID,
		session.ID,
		incoming.ProviderMessageID,
	).Scan(
		&messageRowID,
		&conversationID,
		&messageLeadID,
		&conversationLeadID,
		&remoteJID,
		&providerMessageID,
		&content,
		&messageType,
		&sentAt,
		&messageMetadataJSON,
		&leadMetadataJSON,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return errors.New("legacy non-managed WhatsApp retry message was not found")
		}
		return err
	}
	if providerMessageID != strings.TrimSpace(incoming.ProviderMessageID) {
		return errors.New("legacy non-managed WhatsApp retry provider identity mismatch")
	}
	if messageLeadID == "" {
		if rule.ManagedProviderEventLeadID != "" {
			return errors.New("legacy non-managed WhatsApp retry has no immutable message lead")
		}
		// A quarantined/unbound inbound message has no business effects to
		// recover. Treat its replay as the same handled no-op recorded by the
		// managed lookup instead of retrying a permanently leadless event.
		return nil
	}
	if rule.ManagedProviderEventLeadID != "" && rule.ManagedProviderEventLeadID != messageLeadID {
		return errors.New("legacy non-managed WhatsApp retry lead mismatch")
	}

	persistedMessage := nativeEvolutionMessage{
		ProviderMessageID:          providerMessageID,
		ProviderMessageIDSynthetic: incoming.ProviderMessageIDSynthetic,
		RemoteJID:                  remoteJID,
		Content:                    content,
		MessageType:                firstNonEmpty(messageType, "text"),
		SentAt:                     sentAt.UTC(),
	}
	persistedMessage = nativeMessageWithPersistedCampaignAttribution(
		persistedMessage,
		decodeObjectJSON(messageMetadataJSON),
	)
	conversation := nativeEvolutionConversation{
		ID:                      conversationID,
		LeadID:                  conversationLeadID,
		MessageLeadID:           messageLeadID,
		RemoteJID:               remoteJID,
		HistoricalBindingReplay: conversationLeadID != messageLeadID,
	}
	leadMetadata := decodeObjectJSON(leadMetadataJSON)
	conversation.LeadIsNew = messageLeadID != "" && strings.TrimSpace(stringFromAny(
		leadMetadata["whatsapp_initial_provider_event_id"],
	)) == nativeWhatsAppProviderEventID(session, persistedMessage)

	if !conversation.HistoricalBindingReplay {
		if _, err := tx.Exec(
			ctx,
			nativeLegacyNonManagedConversationRecoveryQuery,
			session.OrganizationID,
			session.ID,
			conversation.ID,
			persistedMessage.SentAt,
			nativeEvolutionPreview(persistedMessage),
			messageLeadID,
		); err != nil {
			return err
		}
	}
	return applyNativeInboundBusinessEffects(
		ctx,
		tx,
		session,
		conversation,
		persistedMessage,
		messageRowID,
		nativeInboundRule{},
	)
}

func nativeMessageWithPersistedCampaignAttribution(
	message nativeEvolutionMessage,
	metadata map[string]any,
) nativeEvolutionMessage {
	attribution := mapFromAny(metadata["whatsapp_attribution"])
	referral := nativeMergeCampaignReferral(
		nativeNormalizePersistedCampaignReferralCandidate(mapFromAny(metadata["whatsapp_referral"])),
		nativeNormalizePersistedCampaignReferralCandidate(mapFromAny(attribution["source_referral"])),
	)
	attributionProof := map[string]any{}
	for _, key := range []string{
		"entry_point_conversion_source",
		"explicit_source_type",
		"ctwa_clid",
		"show_ad_attribution",
		"ctwa_proof_conflict",
		"ctwa_show_ad_attribution_invalid",
	} {
		if value := nativeFirstValue(attribution, key); value != nil {
			attributionProof[key] = value
		}
	}
	referral = nativeMergeCampaignReferral(
		referral,
		nativeNormalizePersistedCampaignReferralCandidate(attributionProof),
	)

	// source_type may have been inferred from ctwa_clid. Only the provider's
	// explicitly persisted source type can authorize the CTWA v2 fallback.
	message.CampaignSourceType = firstString(referral, "explicit_source_type")
	message.CampaignSourceID = firstNonEmpty(
		firstString(referral, "source_id", "sourceId", "ad_id", "adId"),
		firstString(attribution, "source_id", "ad_id"),
	)
	message.CampaignSourceURL = firstNonEmpty(
		nativeFirstHTTPURL(referral, "source_url", "sourceUrl"),
		nativeFirstHTTPURL(attribution, "source_url", "creative_link_url", "creative_destination_url"),
	)
	message.CampaignCreativeURL = firstNonEmpty(
		nativeFirstHTTPURL(referral, "image_url", "thumbnail_url"),
		nativeFirstHTTPURL(attribution, "creative_url"),
	)
	message.CampaignCreativeVideoURL = firstNonEmpty(
		nativeFirstHTTPURL(referral, "video_url"),
		nativeFirstHTTPURL(attribution, "creative_video_url"),
	)
	message.CampaignCTWAClid = firstNonEmpty(
		firstString(referral, "ctwa_clid", "ctwaClid"),
		firstString(attribution, "ctwa_clid"),
	)
	message.CampaignHeadline = firstNonEmpty(
		firstString(referral, "headline", "title", "body"),
		firstString(attribution, "campaign_name", "ad_name", "creative_name", "source_referral_title"),
	)
	message.CampaignEntryPointConversionSource = firstNonEmpty(
		firstString(referral, "entry_point_conversion_source", "entryPointConversionSource"),
		firstString(attribution, "entry_point_conversion_source"),
	)
	message.CampaignEntryPointConversionApp = firstNonEmpty(
		firstString(referral, "entry_point_conversion_app", "entryPointConversionApp"),
		firstString(attribution, "entry_point_conversion_app"),
	)
	message.CampaignConversionSource = firstNonEmpty(
		firstString(referral, "conversion_source", "conversionSource"),
		firstString(attribution, "conversion_source"),
	)
	message.CampaignSourceApp = firstNonEmpty(
		firstString(referral, "source_app", "sourceApp"),
		firstString(attribution, "source_app"),
	)
	message.CampaignShowAdAttribution, message.CampaignShowAdAttributionInvalid = nativeOptionalStrictBool(
		nativeFirstValue(referral, "show_ad_attribution", "showAdAttribution"),
	)
	message.CampaignShowAdAttributionInvalid = message.CampaignShowAdAttributionInvalid || nativeFailClosedMarker(
		nativeFirstValue(referral, "ctwa_show_ad_attribution_invalid"),
	)
	message.CampaignCTWAProofConflict = nativeFailClosedMarker(
		nativeFirstValue(referral, "ctwa_proof_conflict"),
	)
	message.CampaignPropertyCode = firstNonEmpty(
		firstString(referral, "property_code"),
		firstString(attribution, "property_code"),
	)
	message.HasCampaignSignal = len(referral) > 0 || len(attribution) > 0
	message.CTWAConfirmationMethod = nativeCTWAAdConfirmationMethod(message)
	message.IsCTWAAd = message.CTWAConfirmationMethod != ""
	return message
}

func nativeNormalizePersistedCampaignReferralCandidate(value map[string]any) map[string]any {
	if len(value) == 0 {
		return nil
	}
	normalized := make(map[string]any, len(value)+2)
	for key, item := range value {
		normalized[key] = item
	}

	proofConflict := nativeFailClosedMarker(nativeFirstValue(value, "ctwa_proof_conflict"))
	showInvalid := nativeFailClosedMarker(nativeFirstValue(value, "ctwa_show_ad_attribution_invalid"))

	explicitSourceType, explicitInvalid := nativeStrictCampaignProofText(value, "explicit_source_type")
	entryPoint, entryInvalid := nativeStrictCampaignProofText(value,
		"entry_point_conversion_source", "entryPointConversionSource", "EntryPointConversionSource",
	)
	ctwaClid, clidInvalid := nativeStrictCampaignProofText(value,
		"ctwa_clid", "ctwaClid", "CTWAClid", "click_id", "clickId",
	)
	showRaw := nativeFirstValue(value,
		"show_ad_attribution", "showAdAttribution", "ShowAdAttribution",
	)
	show, parsedShowInvalid := nativeOptionalStrictBool(showRaw)
	proofConflict = proofConflict || explicitInvalid || entryInvalid || clidInvalid
	showInvalid = showInvalid || parsedShowInvalid

	for _, key := range []string{
		"explicit_source_type",
		"entry_point_conversion_source", "entryPointConversionSource", "EntryPointConversionSource",
		"ctwa_clid", "ctwaClid", "CTWAClid", "click_id", "clickId",
		"show_ad_attribution", "showAdAttribution", "ShowAdAttribution",
		"ctwa_proof_conflict", "ctwa_show_ad_attribution_invalid",
	} {
		delete(normalized, key)
	}
	if explicitSourceType != "" {
		normalized["explicit_source_type"] = explicitSourceType
	}
	if entryPoint != "" {
		normalized["entry_point_conversion_source"] = entryPoint
	}
	if ctwaClid != "" {
		normalized["ctwa_clid"] = ctwaClid
	}
	if show != nil {
		normalized["show_ad_attribution"] = *show
	}
	if proofConflict {
		normalized["ctwa_proof_conflict"] = true
	}
	if showInvalid {
		normalized["ctwa_show_ad_attribution_invalid"] = true
	}
	if len(normalized) == 0 {
		return nil
	}
	return normalized
}

type nativeHandledAutoReplyQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

const nativeHandledAutoReplyInputQuery = `
	select message.conversation_id::text, message.id::text, coalesce(message.content, '')
	from public.whatsapp_messages as message
	join public.whatsapp_conversations as conversation
	  on conversation.organization_id = message.organization_id
	 and conversation.session_id = message.session_id
	 and conversation.id = message.conversation_id
	where message.organization_id = $1::uuid
	  and message.session_id = $2::uuid
	  and (
	    message.provider_message_id = $3
	    or (message.provider_message_id is null and message.message_id = $3)
	  )
	  and coalesce(message.from_me, false) = false
	  and lower(coalesce(message.direction, 'inbound')) <> 'outbound'
	  and message.lead_id = $4::uuid
	  and conversation.lead_id = $4::uuid
	limit 1
`

// A provider retry can arrive after the message/lifecycle transaction committed
// but before the separate auto-reply job insert succeeded. Recover only the
// already-persisted transport identity; the caller still skips every lead,
// inbound-rule, attribution and distribution effect.
func recoverNativeHandledAutoReplyInput(
	ctx context.Context,
	querier nativeHandledAutoReplyQuerier,
	session nativeEvolutionSession,
	providerMessageID string,
	leadID string,
) (autoReplyInput, bool, error) {
	providerMessageID = strings.TrimSpace(providerMessageID)
	leadID = strings.TrimSpace(leadID)
	if providerMessageID == "" || leadID == "" {
		return autoReplyInput{}, false, nil
	}

	input := autoReplyInput{
		OrganizationID: session.OrganizationID,
		SessionID:      session.ID,
		ExpectedLeadID: leadID,
	}
	err := querier.QueryRow(
		ctx,
		nativeHandledAutoReplyInputQuery,
		session.OrganizationID,
		session.ID,
		providerMessageID,
		leadID,
	).Scan(&input.ConversationID, &input.MessageID, &input.Text)
	if errors.Is(err, pgx.ErrNoRows) {
		return autoReplyInput{}, false, nil
	}
	if err != nil {
		return autoReplyInput{}, false, err
	}
	if strings.TrimSpace(input.Text) == "" {
		return autoReplyInput{}, false, nil
	}
	return input, true, nil
}

// reconcileNativeOutboundOutbox turns a late signed outbound webhook into the
// provider acknowledgement that an HTTP timeout could not prove. This is the
// safe alternative to automatically resending an outcome-unknown message.
func reconcileNativeOutboundOutbox(
	ctx context.Context,
	tx pgx.Tx,
	session nativeEvolutionSession,
	message nativeEvolutionMessage,
	messageRowID string,
) error {
	if strings.TrimSpace(message.ProviderMessageID) == "" || strings.TrimSpace(messageRowID) == "" {
		return nil
	}

	// lockNativeOutboundOutbox acquired this row after the physical conversation
	// was resolved/locked. Read the exact durable delivery projection before
	// touching either message: changing the outbox first would temporarily point
	// it at a provider-webhook row that does not yet own the client identity.
	var outboxID, clientMessageID, pendingMessageRowID, outboxConversationID string
	var outboxStatus, outboxLastError string
	err := tx.QueryRow(ctx, `
		select outbox.id::text,
		       outbox.client_message_id,
		       outbox.message_id::text,
		       outbox.conversation_id::text,
		       outbox.status,
		       coalesce(outbox.last_error, '')
		from public.whatsapp_outbox as outbox
		where outbox.organization_id = $1::uuid
		  and outbox.session_id = $2::uuid
		  and outbox.provider_message_id = $3
		for update
	`, session.OrganizationID, session.ID, message.ProviderMessageID).Scan(
		&outboxID,
		&clientMessageID,
		&pendingMessageRowID,
		&outboxConversationID,
		&outboxStatus,
		&outboxLastError,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}

	// A duplicate webhook after the atomic reconciliation is already complete.
	// No transport, card or timeline effect must be repeated.
	if (outboxStatus == "sent" || outboxStatus == "delivered" || outboxStatus == "read") &&
		pendingMessageRowID == messageRowID {
		return nil
	}
	if outboxStatus != "processing" &&
		!(outboxStatus == "dead" && outboxLastError == whatsappOutboxProviderUnknownMarker) {
		return fmt.Errorf(
			"%w: signed outbound webhook cannot reconcile outbox status %s",
			ErrProviderFailed,
			outboxStatus,
		)
	}

	if pendingMessageRowID != messageRowID {
		// Lock both immutable message projections in UUID order. The pending row
		// must release its partial-unique client id before that identity moves to
		// the provider row; all writes are rolled back if any causal check fails.
		messageRows, err := tx.Query(ctx, `
			select message.id::text
			from public.whatsapp_messages as message
			where message.id = any($1::uuid[])
			order by message.id
			for update
		`, []string{pendingMessageRowID, messageRowID})
		if err != nil {
			return err
		}
		lockedMessageCount := 0
		for messageRows.Next() {
			var ignoredID string
			if err := messageRows.Scan(&ignoredID); err != nil {
				messageRows.Close()
				return err
			}
			lockedMessageCount++
		}
		if err := messageRows.Err(); err != nil {
			messageRows.Close()
			return err
		}
		messageRows.Close()
		if lockedMessageCount != 2 {
			return fmt.Errorf("%w: WhatsApp webhook reconciliation message projection missing", ErrProviderFailed)
		}

		released, err := tx.Exec(ctx, `
			update public.whatsapp_messages as pending
			set client_message_id = null,
			    updated_at = now()
			where pending.id = $1::uuid
			  and pending.organization_id = $2::uuid
			  and pending.session_id = $3::uuid
			  and pending.conversation_id = $4::uuid
			  and pending.client_message_id = $5
			  and pending.lead_id is not null
			  and coalesce(pending.from_me, false) = true
			  and (
			    pending.provider_message_id = $6
			    or pending.message_id = $6
			    or pending.message_id = $5
			  )
		`, pendingMessageRowID, session.OrganizationID, session.ID, outboxConversationID,
			clientMessageID, message.ProviderMessageID)
		if err != nil {
			return err
		}
		if released.RowsAffected() != 1 {
			return fmt.Errorf("%w: WhatsApp webhook reconciliation pending identity mismatch", ErrProviderFailed)
		}

		transferred, err := tx.Exec(ctx, `
			update public.whatsapp_messages as canonical
			set client_message_id = $5,
			    sender_user_id = coalesce(canonical.sender_user_id, pending.sender_user_id),
			    content = coalesce(canonical.content, pending.content),
			    media_url = coalesce(canonical.media_url, pending.media_url),
			    media_mime_type = coalesce(canonical.media_mime_type, pending.media_mime_type),
			    media_storage_path = coalesce(canonical.media_storage_path, pending.media_storage_path),
			    media_size = coalesce(canonical.media_size, pending.media_size),
			    metadata = coalesce(pending.metadata, '{}'::jsonb) || coalesce(canonical.metadata, '{}'::jsonb),
			    provider_message_id = $6,
			    message_id = $6,
			    status = case when canonical.status in ('delivered', 'read') then canonical.status else 'sent' end,
			    sent_at = coalesce(canonical.sent_at, $7),
			    updated_at = now()
			from public.whatsapp_messages as pending
			where canonical.id = $1::uuid
			  and pending.id = $8::uuid
			  and canonical.organization_id = $2::uuid
			  and pending.organization_id = canonical.organization_id
			  and canonical.session_id = $3::uuid
			  and pending.session_id = canonical.session_id
			  and canonical.conversation_id = $4::uuid
			  and pending.conversation_id = canonical.conversation_id
			  and canonical.lead_id is not null
			  and pending.lead_id = canonical.lead_id
			  and coalesce(canonical.from_me, false) = true
			  and coalesce(pending.from_me, false) = true
			  and (canonical.client_message_id is null or canonical.client_message_id = $5)
			  and canonical.provider_message_id = $6
			  and canonical.message_id = $6
		`, messageRowID, session.OrganizationID, session.ID, outboxConversationID,
			clientMessageID, message.ProviderMessageID, message.SentAt, pendingMessageRowID)
		if err != nil {
			return err
		}
		if transferred.RowsAffected() != 1 {
			return fmt.Errorf("%w: WhatsApp webhook reconciliation canonical identity mismatch", ErrProviderFailed)
		}
	} else {
		updatedMessage, err := tx.Exec(ctx, `
			update public.whatsapp_messages as message
			set provider_message_id = $5,
			    message_id = $5,
			    status = case when message.status in ('delivered', 'read') then message.status else 'sent' end,
			    sent_at = coalesce(message.sent_at, $6),
			    updated_at = now()
			where message.id = $1::uuid
			  and message.organization_id = $2::uuid
			  and message.session_id = $3::uuid
			  and message.conversation_id = $4::uuid
			  and message.lead_id is not null
			  and coalesce(message.from_me, false) = true
			  and message.client_message_id = $7
		`, messageRowID, session.OrganizationID, session.ID, outboxConversationID,
			message.ProviderMessageID, message.SentAt, clientMessageID)
		if err != nil {
			return err
		}
		if updatedMessage.RowsAffected() != 1 {
			return fmt.Errorf("%w: WhatsApp webhook reconciliation message identity mismatch", ErrProviderFailed)
		}
	}

	reconciled, err := tx.Exec(ctx, `
		update public.whatsapp_outbox as outbox
		set message_id = $4::uuid,
		    status = 'sent',
		    sent_at = coalesce(outbox.sent_at, $5),
		    failed_at = null,
		    dead_lettered_at = null,
		    locked_at = null,
		    locked_by = null,
		    last_error = null,
		    updated_at = now()
		where outbox.id = $1::uuid
		  and outbox.organization_id = $2::uuid
		  and outbox.session_id = $3::uuid
		  and outbox.conversation_id = $6::uuid
		  and outbox.message_id = $7::uuid
		  and outbox.client_message_id = $8
		  and outbox.provider_message_id = $9
		  and (
		    outbox.status = 'processing'
		    or (
		      outbox.status = 'dead'
		      and outbox.last_error = $10
		    )
		  )
	`, outboxID, session.OrganizationID, session.ID, messageRowID, message.SentAt,
		outboxConversationID, pendingMessageRowID, clientMessageID,
		message.ProviderMessageID, whatsappOutboxProviderUnknownMarker)
	if err != nil {
		return err
	}
	if reconciled.RowsAffected() != 1 {
		return fmt.Errorf("%w: WhatsApp webhook reconciliation outbox identity mismatch", ErrProviderFailed)
	}

	if pendingMessageRowID != messageRowID {
		deleted, err := tx.Exec(ctx, `
			delete from public.whatsapp_messages as pending
			where pending.id = $1::uuid
			  and pending.organization_id = $2::uuid
			  and pending.session_id = $3::uuid
			  and pending.conversation_id = $4::uuid
			  and pending.client_message_id is null
		`, pendingMessageRowID, session.OrganizationID, session.ID, outboxConversationID)
		if err != nil {
			return err
		}
		if deleted.RowsAffected() != 1 {
			return fmt.Errorf("%w: WhatsApp webhook reconciliation losing projection survived", ErrProviderFailed)
		}
	}

	if _, err := tx.Exec(ctx, `
		update public.leads as lead
		set last_contact_at = greatest(
		      coalesce(lead.last_contact_at, '-infinity'::timestamptz),
		      coalesce(message.sent_at, $4)
		    ),
		    first_response_at = coalesce(lead.first_response_at, message.sent_at, $4),
		    first_response_seconds = coalesce(
		      lead.first_response_seconds,
		      greatest(0, extract(epoch from (coalesce(message.sent_at, $4) - lead.created_at))::integer)
		    ),
		    first_response_channel = coalesce(lead.first_response_channel, 'whatsapp'),
		    first_response_is_automation = coalesce(
		      lead.first_response_is_automation,
		      coalesce(message.metadata->>'origin', '') = 'automation'
		    ),
		    first_response_actor_user_id = coalesce(lead.first_response_actor_user_id, message.sender_user_id),
		    updated_at = now()
		from public.whatsapp_messages as message
		where message.id = $1::uuid
		  and message.organization_id = $2::uuid
		  and message.session_id = $3::uuid
		  and message.lead_id = lead.id
		  and lead.organization_id = message.organization_id
	`, messageRowID, session.OrganizationID, session.ID, message.SentAt); err != nil {
		return err
	}

	timelineResult, err := tx.Exec(ctx, `
		update public.lead_timeline_events as timeline
		set event_type = 'whatsapp_message_sent',
		    title = 'Mensagem WhatsApp enviada',
		    metadata = (coalesce(timeline.metadata, '{}'::jsonb) - 'last_error') || jsonb_build_object(
		      'delivery_status', 'sent',
		      'message_id', $4,
		      'client_message_id', $5,
		      'message_row_id', $1::uuid
		    ),
		    event_at = coalesce(message.sent_at, $6)
		from public.whatsapp_messages as message
		where timeline.organization_id = $2::uuid
		  and timeline.metadata->>'outbox_id' = $3
		  and message.id = $1::uuid
		  and message.organization_id = timeline.organization_id
	`, messageRowID, session.OrganizationID, outboxID, message.ProviderMessageID, clientMessageID, message.SentAt)
	if err != nil {
		return err
	}
	if timelineResult.RowsAffected() == 0 {
		if _, err := tx.Exec(ctx, `
			insert into public.lead_timeline_events (
			  organization_id, lead_id, event_type, title, description,
			  user_id, actor_user_id, metadata, event_at
			)
			select
			  message.organization_id, message.lead_id, 'whatsapp_message_sent',
			  'Mensagem WhatsApp enviada', coalesce(nullif(message.content, ''), '[Mensagem]'),
			  message.sender_user_id, message.sender_user_id,
			  jsonb_build_object(
			    'outbox_id', $3::uuid,
			    'message_row_id', message.id,
			    'message_id', $4,
			    'client_message_id', $5,
			    'delivery_status', 'sent'
			  ),
			  coalesce(message.sent_at, $6)
			from public.whatsapp_messages as message
			where message.id = $1::uuid
			  and message.organization_id = $2::uuid
			  and message.lead_id is not null
		`, messageRowID, session.OrganizationID, outboxID, message.ProviderMessageID, clientMessageID, message.SentAt); err != nil {
			return err
		}
	}

	if _, err := tx.Exec(ctx, `
		update public.automation_effect_dispatches as dispatch
		set status = 'succeeded',
		    provider_id = $3,
		    error_message = null,
		    completed_at = now(),
		    response = (coalesce(dispatch.response, '{}'::jsonb) - 'last_error') || jsonb_build_object(
		      'status', 'sent',
		      'delivery_status', 'sent',
		      'provider_id', $3,
		      'message_id', $4::uuid,
		      'outbox_id', $2::uuid
		    )
		where dispatch.organization_id = $1::uuid
		  and dispatch.effect_key = $5
		  and dispatch.request->>'delivery_contract' = 'canonical_whatsapp_outbox_v1'
		  and dispatch.response->>'outbox_id' = $2
		  and dispatch.status in ('succeeded', 'failed', 'unknown')
	`, session.OrganizationID, outboxID, message.ProviderMessageID, messageRowID, clientMessageID); err != nil {
		return err
	}

	return nil
}

func lockNativeOutboundOutbox(
	ctx context.Context,
	tx pgx.Tx,
	session nativeEvolutionSession,
	providerMessageID string,
) error {
	providerMessageID = strings.TrimSpace(providerMessageID)
	if providerMessageID == "" {
		return nil
	}
	rows, err := tx.Query(ctx, `
		select id::text
		from public.whatsapp_outbox
		where organization_id = $1::uuid
		  and session_id = $2::uuid
		  and (provider_message_id = $3 or client_message_id = $3)
		order by id
		for update
	`, session.OrganizationID, session.ID, providerMessageID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var ignoredID string
		if err := rows.Scan(&ignoredID); err != nil {
			return err
		}
	}
	return rows.Err()
}

func lockNativeStatusTransportRows(
	ctx context.Context,
	tx pgx.Tx,
	session nativeEvolutionSession,
	messageIDs []string,
) error {
	messageIDs = uniqueStrings(messageIDs...)
	if len(messageIDs) == 0 {
		return nil
	}

	outboxRows, err := tx.Query(ctx, `
		select id::text
		from public.whatsapp_outbox
		where organization_id = $1::uuid
		  and session_id = $2::uuid
		  and (
		    provider_message_id = any($3::text[])
		    or client_message_id = any($3::text[])
		    or exists (
		      select 1
		      from public.whatsapp_messages as message
		      where message.id = whatsapp_outbox.message_id
		        and message.organization_id = whatsapp_outbox.organization_id
		        and message.session_id = whatsapp_outbox.session_id
		        and (
		          message.message_id = any($3::text[])
		          or message.provider_message_id = any($3::text[])
		          or message.client_message_id = any($3::text[])
		        )
		    )
		  )
		order by id
		for update
	`, session.OrganizationID, session.ID, messageIDs)
	if err != nil {
		return err
	}
	for outboxRows.Next() {
		var ignoredID string
		if err := outboxRows.Scan(&ignoredID); err != nil {
			outboxRows.Close()
			return err
		}
	}
	if err := outboxRows.Err(); err != nil {
		outboxRows.Close()
		return err
	}
	outboxRows.Close()

	messageRows, err := tx.Query(ctx, `
		select id::text
		from public.whatsapp_messages
		where organization_id = $1::uuid
		  and session_id = $2::uuid
		  and (
		    message_id = any($3::text[])
		    or provider_message_id = any($3::text[])
		    or client_message_id = any($3::text[])
		    or exists (
		      select 1
		      from public.whatsapp_outbox as outbox
		      where outbox.message_id = whatsapp_messages.id
		        and outbox.organization_id = whatsapp_messages.organization_id
		        and outbox.session_id = whatsapp_messages.session_id
		        and (
		          outbox.provider_message_id = any($3::text[])
		          or outbox.client_message_id = any($3::text[])
		        )
		    )
		  )
		order by id
		for update
	`, session.OrganizationID, session.ID, messageIDs)
	if err != nil {
		return err
	}
	defer messageRows.Close()
	for messageRows.Next() {
		var ignoredID string
		if err := messageRows.Scan(&ignoredID); err != nil {
			return err
		}
	}
	return messageRows.Err()
}

func loadNativeEvolutionSession(ctx context.Context, tx pgx.Tx, item pendingEvolutionWebhook) (nativeEvolutionSession, error) {
	return loadNativeEvolutionSessionWithLock(ctx, tx, item, false)
}

func loadNativeEvolutionSessionWithLock(
	ctx context.Context,
	tx pgx.Tx,
	item pendingEvolutionWebhook,
	forUpdate bool,
) (nativeEvolutionSession, error) {
	var session nativeEvolutionSession
	var advancedSettings string
	lockClause := "for share"
	if forUpdate {
		lockClause = "for update"
	}
	err := tx.QueryRow(ctx, `
		select id::text, organization_id::text, coalesce(phone_number, ''), coalesce(profile_name, ''),
		       coalesce(owner_user_id::text, ''), coalesce(owner_user_id::text, ''),
		       coalesce(advanced_settings, '{}'::jsonb)::text
		from public.whatsapp_sessions
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and provider = 'evolution_go'
		  and coalesce(is_active, true) = true
		  and lower(btrim(coalesce(status, ''))) not in ('deleted', 'disabled')
		`+lockClause+`
	`, item.OrganizationID, item.SessionID).Scan(
		&session.ID,
		&session.OrganizationID,
		&session.PhoneNumber,
		&session.ProfileName,
		&session.OwnerUserID,
		&session.CreatedBy,
		&advancedSettings,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nativeEvolutionSession{}, ErrSessionNotFound
	}
	if err == nil {
		session.AdvancedSettings = decodeObjectJSON(advancedSettings)
	}
	return session, err
}

func nativeEvolutionMessagesMayUpdateSession(messages []nativeEvolutionMessage) bool {
	for _, message := range messages {
		if !message.FromMe {
			continue
		}
		if _, ok := phoneFromIdentityValue(message.SenderJID); ok {
			return true
		}
	}
	return false
}

func findNativeEvolutionStoredMessageIdentity(
	ctx context.Context,
	tx pgx.Tx,
	session nativeEvolutionSession,
	message nativeEvolutionMessage,
) (nativeEvolutionStoredMessageIdentity, error) {
	rows, err := tx.Query(ctx, `
		select message.id::text,
		       message.conversation_id::text,
		       coalesce(message.lead_id::text, ''),
		       case
		         when coalesce(message.metadata, '{}'::jsonb) @>
		              '{"lead_resolution_quarantine":{"terminal":true,"retryable":false}}'::jsonb
		           then coalesce(nullif(message.metadata #>> '{lead_resolution_quarantine,reason}', ''), 'whatsapp_lead_resolution_ambiguous')
		         else ''
		       end
		from public.whatsapp_messages message
		where message.organization_id = $1::uuid
		  and message.session_id = $2::uuid
		  and (
		    message.message_id = $3
		    or message.provider_message_id = $3
		    or message.client_message_id = $3
		  )
		order by message.id
		limit 2
	`, session.OrganizationID, session.ID, message.ProviderMessageID)
	if err != nil {
		return nativeEvolutionStoredMessageIdentity{}, err
	}
	defer rows.Close()

	matches := []nativeEvolutionStoredMessageIdentity{}
	for rows.Next() {
		var match nativeEvolutionStoredMessageIdentity
		if err := rows.Scan(&match.ID, &match.ConversationID, &match.LeadID, &match.QuarantineReason); err != nil {
			return nativeEvolutionStoredMessageIdentity{}, err
		}
		matches = append(matches, match)
	}
	if err := rows.Err(); err != nil {
		return nativeEvolutionStoredMessageIdentity{}, err
	}
	if len(matches) > 1 {
		return nativeEvolutionStoredMessageIdentity{}, errors.New("WhatsApp message provider identity conflict")
	}
	if len(matches) == 0 {
		return nativeEvolutionStoredMessageIdentity{}, nil
	}
	return matches[0], nil
}

type nativeInheritedRoutingTarget struct {
	Ready           bool   `json:"ready"`
	Terminal        bool   `json:"terminal"`
	Reason          string `json:"reason"`
	ConversationID  string `json:"conversation_id"`
	LeadID          string `json:"lead_id"`
	ActiveBindingID string `json:"active_binding_id"`
}

func resolveNativeInheritedRoutingTarget(
	ctx context.Context,
	tx pgx.Tx,
	session nativeEvolutionSession,
	snapshot nativeIngressRoutingSnapshot,
) (nativeInheritedRoutingTarget, error) {
	if snapshot.TargetMode != "inherit_predecessor" {
		return nativeInheritedRoutingTarget{}, errors.New("WhatsApp inherited routing target has an invalid mode")
	}
	var raw string
	if err := tx.QueryRow(ctx, `
		select public.resolve_whatsapp_webhook_inherited_routing_target(
		  $1::uuid,
		  $2::uuid,
		  $3
		)::text
	`, session.OrganizationID, session.ID, snapshot.ProviderMessageID).Scan(&raw); err != nil {
		return nativeInheritedRoutingTarget{}, err
	}
	var target nativeInheritedRoutingTarget
	if err := json.Unmarshal([]byte(raw), &target); err != nil {
		return nativeInheritedRoutingTarget{}, fmt.Errorf("decode WhatsApp inherited routing target: %w", err)
	}
	if !target.Ready {
		if !target.Terminal || strings.TrimSpace(target.Reason) == "" {
			return nativeInheritedRoutingTarget{}, errors.New("WhatsApp inherited routing target is incomplete")
		}
		return target, nil
	}
	if target.Terminal || strings.TrimSpace(target.Reason) != "" ||
		strings.TrimSpace(target.ConversationID) == "" ||
		strings.TrimSpace(target.LeadID) == "" ||
		strings.TrimSpace(target.ActiveBindingID) == "" {
		return nativeInheritedRoutingTarget{}, errors.New("WhatsApp inherited routing target is incomplete")
	}
	return target, nil
}

func ensureNativeEvolutionConversation(
	ctx context.Context,
	tx pgx.Tx,
	session nativeEvolutionSession,
	message nativeEvolutionMessage,
	rule nativeInboundRule,
	storedIdentity nativeEvolutionStoredMessageIdentity,
	routingSnapshot *nativeIngressRoutingSnapshot,
) (nativeEvolutionConversation, error) {
	if routingSnapshot != nil && routingSnapshot.TargetMode == "inherit_predecessor" && storedIdentity.ID == "" {
		target, err := resolveNativeInheritedRoutingTarget(ctx, tx, session, *routingSnapshot)
		if err != nil {
			return nativeEvolutionConversation{}, err
		}
		effectiveSnapshot := *routingSnapshot
		if target.Ready {
			if effectiveSnapshot.ConversationID != "" && effectiveSnapshot.ConversationID != target.ConversationID {
				return nativeEvolutionConversation{}, errors.New("WhatsApp inherited routing target conversation conflict")
			}
			effectiveSnapshot.ConversationID = target.ConversationID
			effectiveSnapshot.EventLeadID = target.LeadID
		} else {
			effectiveSnapshot.QuarantineReason = strings.TrimSpace(target.Reason)
		}
		routingSnapshot = &effectiveSnapshot
	}
	aliases := uniqueStrings(append([]string{message.RemoteJID}, message.RemoteAliases...)...)
	var conversation nativeEvolutionConversation
	var err error
	if storedIdentity.ID != "" {
		err = tx.QueryRow(ctx, `
			select wc.id::text, coalesce(wc.lead_id::text, ''), wc.remote_jid
			from public.whatsapp_conversations wc
			where wc.organization_id = $1::uuid
			  and wc.session_id = $2::uuid
			  and wc.id = $3::uuid
			limit 1
			for update of wc
		`, session.OrganizationID, session.ID, storedIdentity.ConversationID).Scan(
			&conversation.ID,
			&conversation.LeadID,
			&conversation.RemoteJID,
		)
	} else if routingSnapshot != nil && routingSnapshot.ConversationID != "" {
		err = tx.QueryRow(ctx, `
			select wc.id::text, coalesce(wc.lead_id::text, ''), wc.remote_jid
			from public.whatsapp_conversations wc
			where wc.organization_id = $1::uuid
			  and wc.session_id = $2::uuid
			  and wc.id = $3::uuid
			limit 1
			for update of wc
		`, session.OrganizationID, session.ID, routingSnapshot.ConversationID).Scan(
			&conversation.ID,
			&conversation.LeadID,
			&conversation.RemoteJID,
		)
	} else if routingSnapshot != nil {
		// No physical conversation existed when ingress accepted this event.
		// Do not discover a row created later through the same phone or alias.
		err = pgx.ErrNoRows
	} else {
		err = tx.QueryRow(ctx, `
			select wc.id::text, coalesce(wc.lead_id::text, ''), wc.remote_jid
			from public.whatsapp_conversations wc
			where wc.organization_id = $1::uuid
			  and wc.session_id = $2::uuid
			  and (
			    wc.remote_jid = any($3::text[])
			    or exists (
			      select 1
			      from public.whatsapp_contact_identity_aliases alias
			      where alias.organization_id = $1::uuid
			        and alias.session_id = $2::uuid
			        and alias.alias_jid = any($3::text[])
			        and alias.canonical_jid = wc.remote_jid
			    )
			  )
			order by wc.deleted_at nulls first, (wc.remote_jid = $4) desc, wc.last_message_at desc nulls last
			limit 1
		`, session.OrganizationID, session.ID, aliases, message.RemoteJID).Scan(
			&conversation.ID,
			&conversation.LeadID,
			&conversation.RemoteJID,
		)
	}
	conversationMissing := errors.Is(err, pgx.ErrNoRows)
	if err != nil && !conversationMissing {
		return nativeEvolutionConversation{}, err
	}
	if storedIdentity.ID != "" && conversationMissing {
		return nativeEvolutionConversation{}, errors.New("stored WhatsApp message conversation is missing")
	}

	lead := nativeEvolutionLead{}
	contextualBinding := false
	quarantineReason := strings.TrimSpace(storedIdentity.QuarantineReason)
	if !message.IsGroup && quarantineReason == "" {
		if routingSnapshot != nil {
			if storedIdentity.ID != "" {
				if routingSnapshot.ConversationID != "" && storedIdentity.ConversationID != routingSnapshot.ConversationID {
					return nativeEvolutionConversation{}, errors.New("stored WhatsApp message conflicts with ingress conversation provenance")
				}
				if routingSnapshot.EventLeadID != "" && storedIdentity.LeadID != "" && storedIdentity.LeadID != routingSnapshot.EventLeadID {
					return nativeEvolutionConversation{}, errors.New("stored WhatsApp message conflicts with ingress lead provenance")
				}
			}
			quarantineReason = routingSnapshot.QuarantineReason
			if routingSnapshot.EventLeadID != "" && quarantineReason == "" {
				contextualBinding = true
				lead, err = findScopedNativeEvolutionLeadByID(
					ctx,
					tx,
					session.OrganizationID,
					routingSnapshot.EventLeadID,
				)
				if errors.Is(err, errNativeEvolutionScopedLeadMissing) {
					quarantineReason = "whatsapp_ingress_snapshot_lead_deleted"
					lead = nativeEvolutionLead{}
					err = nil
				}
				if err != nil {
					return nativeEvolutionConversation{}, err
				}
			} else if routingSnapshot.ContextKind == "contextual_intake" && quarantineReason == "" {
				contextualBinding = true
				if routingSnapshot.OriginRoundRobinID != "" {
					lead, err = findScopedNativeEvolutionLeadByPhone(
						ctx,
						tx,
						session.OrganizationID,
						message,
						routingSnapshot.OriginRoundRobinID,
					)
					if isNativeEvolutionLeadPhoneAmbiguous(err) {
						quarantineReason = "whatsapp_lead_phone_ambiguous_in_intake_scope"
						lead = nativeEvolutionLead{}
						err = nil
					}
					if err != nil {
						return nativeEvolutionConversation{}, err
					}
				}
				if lead.ID == "" && quarantineReason == "" {
					lead, err = createAuthorizedNativeLead(ctx, tx, session, message, rule)
					if err != nil {
						return nativeEvolutionConversation{}, err
					}
				}
			}
		} else if rule.ManagedProviderEventPending {
			contextualBinding = true
			lead, err = findScopedNativeEvolutionLeadByID(
				ctx,
				tx,
				session.OrganizationID,
				rule.ManagedProviderEventLeadID,
			)
			if err != nil {
				return nativeEvolutionConversation{}, err
			}
		} else if !message.FromMe && message.IsCTWAAd {
			contextualBinding = true
			originRoundRobinID := ""
			if rule.ManagedMessageDistribution || rule.CanonicalIntakeResolved {
				originRoundRobinID = strings.TrimSpace(rule.TargetRoundRobinID)
			}
			if originRoundRobinID != "" || !rule.CanonicalIntakeResolved {
				lead, err = findScopedNativeEvolutionLeadByPhone(
					ctx,
					tx,
					session.OrganizationID,
					message,
					originRoundRobinID,
				)
			}
			if isNativeEvolutionLeadPhoneAmbiguous(err) {
				quarantineReason = "whatsapp_lead_phone_ambiguous_in_intake_scope"
				lead = nativeEvolutionLead{}
				err = nil
			}
			if err != nil {
				return nativeEvolutionConversation{}, err
			}
			if lead.ID == "" && quarantineReason == "" {
				lead, err = createAuthorizedNativeLead(ctx, tx, session, message, rule)
				if err != nil {
					return nativeEvolutionConversation{}, err
				}
			}
		} else if nativeConversationHasAttachedLead(conversation, conversationMissing) {
			// The conversation link is already scoped by organization and session.
			// Re-load that exact lead in the same organization instead of resolving
			// the phone globally again; legacy duplicate WhatsApp-only values must
			// not block an otherwise valid established chat.
			lead, err = findScopedNativeEvolutionLeadByID(
				ctx,
				tx,
				session.OrganizationID,
				conversation.LeadID,
			)
			if err != nil {
				return nativeEvolutionConversation{}, err
			}
		} else {
			lead, err = findSingleNativeEvolutionAliasLead(ctx, tx, session, aliases)
			if errors.Is(err, errNativeEvolutionAliasLeadAmbiguous) {
				quarantineReason = "whatsapp_identity_alias_lead_ambiguous"
				lead = nativeEvolutionLead{}
				err = nil
			}
			if err != nil {
				return nativeEvolutionConversation{}, err
			}
			if lead.ID == "" && quarantineReason == "" {
				lead, err = findSingleNativeEvolutionLead(ctx, tx, session.OrganizationID, message)
				if isNativeEvolutionLeadPhoneAmbiguous(err) {
					// Preserve ordinary chat delivery without guessing which historical
					// duplicate owns the phone. The unlinked message is a terminal
					// quarantine outcome, not a retry/DLQ candidate.
					quarantineReason = "whatsapp_lead_phone_ambiguous"
					lead = nativeEvolutionLead{}
					err = nil
				}
				if err != nil {
					return nativeEvolutionConversation{}, err
				}
			}
		}
	}
	identityLead := lead
	if contextualBinding && nativeConversationHasAttachedLead(conversation, conversationMissing) {
		// Identity promotion predates multi-card bindings and must compare the
		// current conversation owner, not the new event owner. The binding RPC
		// performs the intentional switch after identity reconciliation.
		identityLead, err = findScopedNativeEvolutionLeadByID(
			ctx,
			tx,
			session.OrganizationID,
			conversation.LeadID,
		)
		if err != nil {
			return nativeEvolutionConversation{}, err
		}
	}
	if storedIdentity.ID == "" && routingSnapshot == nil {
		conversation, conversationMissing, err = reconcileNativeEvolutionConversationIdentity(
			ctx, tx, session, message, conversation, conversationMissing, identityLead,
		)
		if err != nil {
			return nativeEvolutionConversation{}, err
		}
	}
	if !conversationMissing {
		// The legacy identity lookup above is deliberately non-locking: LID
		// reconciliation must acquire every matching conversation in canonical
		// UUID order rather than retaining an arbitrary LIMIT 1 lock. Re-lock the
		// selected row here and reject a concurrent rebind/identity change before
		// any message or binding mutation can inherit a stale snapshot.
		var locked nativeEvolutionConversation
		err = tx.QueryRow(ctx, `
			select wc.id::text, coalesce(wc.lead_id::text, ''), wc.remote_jid
			from public.whatsapp_conversations wc
			where wc.organization_id = $1::uuid
			  and wc.session_id = $2::uuid
			  and wc.id = $3::uuid
			limit 1
			for update of wc
		`, session.OrganizationID, session.ID, conversation.ID).Scan(
			&locked.ID,
			&locked.LeadID,
			&locked.RemoteJID,
		)
		if errors.Is(err, pgx.ErrNoRows) {
			return nativeEvolutionConversation{}, errors.New("WhatsApp conversation changed during identity reconciliation")
		}
		if err != nil {
			return nativeEvolutionConversation{}, err
		}
		if locked.LeadID != conversation.LeadID || locked.RemoteJID != conversation.RemoteJID {
			return nativeEvolutionConversation{}, errors.New("WhatsApp conversation binding changed during identity reconciliation")
		}
		conversation.ID = locked.ID
		conversation.LeadID = locked.LeadID
		conversation.RemoteJID = locked.RemoteJID
	}

	if conversationMissing {
		contactName := firstNonEmpty(message.ContactName, message.ContactPhone, message.RemoteJID)
		err = tx.QueryRow(ctx, `
			insert into public.whatsapp_conversations (
				organization_id, session_id, lead_id, assigned_user_id, remote_jid,
				contact_phone, contact_name, is_group, unread_count, metadata
			) values (
				$1::uuid, $2::uuid, null, nullif($3, '')::uuid, $4,
				nullif($5, ''), nullif($6, ''), $7, 0, '{"source":"evolution_go_native"}'::jsonb
			)
			on conflict (session_id, remote_jid)
			do update set
				deleted_at = null,
				assigned_user_id = coalesce(whatsapp_conversations.assigned_user_id, excluded.assigned_user_id),
				contact_phone = coalesce(whatsapp_conversations.contact_phone, excluded.contact_phone),
				contact_name = coalesce(whatsapp_conversations.contact_name, excluded.contact_name),
				updated_at = now()
			returning id::text, coalesce(lead_id::text, ''), remote_jid
		`, session.OrganizationID, session.ID, lead.AssignedUserID, message.RemoteJID, message.ContactPhone, contactName, message.IsGroup).Scan(
			&conversation.ID, &conversation.LeadID, &conversation.RemoteJID,
		)
		if err != nil {
			return nativeEvolutionConversation{}, err
		}
	}
	bindingApplied := false
	if lead.ID != "" && quarantineReason == "" && (contextualBinding || conversation.LeadID == "") {
		activeLeadID, historicalReplay, err := activateNativeWhatsAppConversationLeadBinding(
			ctx,
			tx,
			session.OrganizationID,
			conversation.ID,
			lead.ID,
			message.ProviderMessageID,
			routingSnapshot,
		)
		if err != nil {
			return nativeEvolutionConversation{}, err
		}
		conversation.LeadID = activeLeadID
		conversation.MessageLeadID = lead.ID
		conversation.HistoricalBindingReplay = historicalReplay
		bindingApplied = true
	} else if routingSnapshot != nil && routingSnapshot.EventLeadID == "" && quarantineReason == "" {
		conversation.MessageLeadID = ""
		conversation.HistoricalBindingReplay = strings.TrimSpace(conversation.LeadID) != strings.TrimSpace(routingSnapshot.CurrentLeadID)
		if conversation.HistoricalBindingReplay && conversation.LeadID != "" {
			quarantineReason = "whatsapp_ingress_unlinked_after_binding_change"
		}
	} else if quarantineReason == "" {
		conversation.MessageLeadID = conversation.LeadID
	}
	if storedIdentity.ID != "" {
		if storedIdentity.ConversationID != conversation.ID {
			return nativeEvolutionConversation{}, errors.New("WhatsApp message conversation identity conflict")
		}
		storedLeadID := strings.TrimSpace(storedIdentity.LeadID)
		if bindingApplied && storedLeadID != "" && conversation.MessageLeadID != storedLeadID {
			return nativeEvolutionConversation{}, errors.New("WhatsApp message binding ledger identity conflict")
		}
		if storedLeadID != "" {
			conversation.MessageLeadID = storedLeadID
			conversation.HistoricalBindingReplay = storedLeadID != conversation.LeadID
		} else if !bindingApplied && conversation.LeadID != "" {
			// A legacy NULL event cannot inherit a card selected later through the
			// conversation's mutable active binding.
			conversation.MessageLeadID = ""
			conversation.HistoricalBindingReplay = true
			quarantineReason = "whatsapp_message_lead_unattributed"
		}
	}
	conversation.LeadResolutionQuarantineReason = quarantineReason
	conversation.LeadIsNew = lead.IsNew && conversation.MessageLeadID == lead.ID
	conversation.LeadScopeCompatibilityFallback = lead.ScopeCompatibilityFallback
	conversation.RequestedOriginRoundRobinID = lead.RequestedOriginRoundRobinID
	if rule.ManagedProviderEventPending && conversation.MessageLeadID != lead.ID {
		return nativeEvolutionConversation{}, errors.New("pending managed WhatsApp provider event lead mismatch")
	}

	// Identity discovery is not a binding operation. In particular, a delayed
	// event must not overwrite an alias that the row-locked binding RPC already
	// moved to another card. The RPC remains the sole alias.lead_id writer.
	for _, alias := range aliases {
		if strings.TrimSpace(alias) == "" {
			continue
		}
		if _, err := tx.Exec(ctx, `
			insert into public.whatsapp_contact_identity_aliases (
				organization_id, session_id, alias_jid, canonical_jid, contact_phone,
				is_group, metadata
			) values (
				$1::uuid, $2::uuid, $3, $4, nullif($5, ''), $6,
				'{"source":"evolution_go_native"}'::jsonb
			)
			on conflict (organization_id, session_id, alias_jid)
			do update set
				last_seen_at = now(),
				contact_phone = coalesce(whatsapp_contact_identity_aliases.contact_phone, excluded.contact_phone)
		`, session.OrganizationID, session.ID, alias, conversation.RemoteJID, message.ContactPhone, message.IsGroup); err != nil {
			return nativeEvolutionConversation{}, err
		}
	}
	return conversation, nil
}

func nativeConversationHasAttachedLead(conversation nativeEvolutionConversation, conversationMissing bool) bool {
	return !conversationMissing && strings.TrimSpace(conversation.ID) != "" && strings.TrimSpace(conversation.LeadID) != ""
}

const nativeScopedManagedPendingLeadQuery = `
	select lead.id::text, coalesce(lead.assigned_user_id::text, ''), coalesce(lead.name, '')
	from public.leads lead
	where lead.organization_id = $1::uuid
	  and lead.id = $2::uuid
	limit 1
`

func findScopedNativeEvolutionLeadByID(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	leadID string,
) (nativeEvolutionLead, error) {
	if strings.TrimSpace(leadID) == "" {
		return nativeEvolutionLead{}, errors.New("scoped WhatsApp conversation lead is missing")
	}
	var lead nativeEvolutionLead
	err := tx.QueryRow(ctx, nativeScopedManagedPendingLeadQuery, organizationID, leadID).Scan(
		&lead.ID,
		&lead.AssignedUserID,
		&lead.Name,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nativeEvolutionLead{}, errNativeEvolutionScopedLeadMissing
	}
	return lead, err
}

func reconcileNativeEvolutionConversationIdentity(
	ctx context.Context,
	tx pgx.Tx,
	session nativeEvolutionSession,
	message nativeEvolutionMessage,
	current nativeEvolutionConversation,
	currentMissing bool,
	lead nativeEvolutionLead,
) (nativeEvolutionConversation, bool, error) {
	canonicalJID := strings.TrimSpace(message.RemoteJID)
	if message.IsGroup || message.ContactPhone == "" || canonicalJID == "" || isOpaqueWhatsAppJID(canonicalJID) {
		return current, currentMissing, nil
	}
	opaqueAliases := make([]string, 0, len(message.RemoteAliases))
	for _, alias := range uniqueStrings(message.RemoteAliases...) {
		if isOpaqueWhatsAppJID(alias) {
			opaqueAliases = append(opaqueAliases, alias)
		}
	}
	// Discover without retaining an arbitrary row lock. If there is neither an
	// active opaque source nor a deleted canonical route to restore, identity
	// reconciliation has nothing to mutate and the caller will lock only its
	// selected conversation.
	discoveredRows, err := tx.Query(ctx, `
		select id::text, coalesce(lead_id::text, ''), remote_jid, deleted_at is not null
		from public.whatsapp_conversations
		where organization_id = $1::uuid
		  and session_id = $2::uuid
		  and (remote_jid = $3 or remote_jid = any($4::text[]))
		order by id
	`, session.OrganizationID, session.ID, canonicalJID, opaqueAliases)
	if err != nil {
		return nativeEvolutionConversation{}, false, err
	}
	discoveredIDs := []string{}
	hasActiveSource := false
	hasDeletedTarget := false
	for discoveredRows.Next() {
		var candidate nativeEvolutionConversation
		var candidateDeleted bool
		if err := discoveredRows.Scan(&candidate.ID, &candidate.LeadID, &candidate.RemoteJID, &candidateDeleted); err != nil {
			discoveredRows.Close()
			return nativeEvolutionConversation{}, false, err
		}
		discoveredIDs = append(discoveredIDs, candidate.ID)
		if candidate.RemoteJID == canonicalJID && candidateDeleted {
			hasDeletedTarget = true
		}
		if candidate.RemoteJID != canonicalJID && !candidateDeleted {
			hasActiveSource = true
		}
	}
	if err := discoveredRows.Err(); err != nil {
		discoveredRows.Close()
		return nativeEvolutionConversation{}, false, err
	}
	discoveredRows.Close()
	if !hasActiveSource && !hasDeletedTarget {
		return current, currentMissing, nil
	}

	// Lock the discovered canonical row and opaque sources as one UUID-ordered
	// set, then re-read every predicate under those locks. Locking the target
	// first and the sources afterwards inverted the order used by lead deletion,
	// allowing target(high)->source(low) to deadlock with
	// source(low)->target(high). The initial legacy lookup is intentionally
	// non-locking so this is the first conversation lock in that path.
	rows, err := tx.Query(ctx, `
		select id::text, coalesce(lead_id::text, ''), remote_jid, deleted_at is not null
		from public.whatsapp_conversations
		where organization_id = $1::uuid
		  and session_id = $2::uuid
		  and id = any($3::uuid[])
		order by id
		for update
	`, session.OrganizationID, session.ID, discoveredIDs)
	if err != nil {
		return nativeEvolutionConversation{}, false, err
	}
	defer rows.Close()

	var target nativeEvolutionConversation
	var targetDeleted bool
	sources := []nativeEvolutionConversation{}
	for rows.Next() {
		var candidate nativeEvolutionConversation
		var candidateDeleted bool
		if err := rows.Scan(&candidate.ID, &candidate.LeadID, &candidate.RemoteJID, &candidateDeleted); err != nil {
			return nativeEvolutionConversation{}, false, err
		}
		if candidate.RemoteJID == canonicalJID {
			target = candidate
			targetDeleted = candidateDeleted
			continue
		}
		if slices.Contains(opaqueAliases, candidate.RemoteJID) && !candidateDeleted {
			sources = append(sources, candidate)
		}
	}
	if err := rows.Err(); err != nil {
		return nativeEvolutionConversation{}, false, err
	}
	targetMissing := target.ID == ""
	if len(sources) == 0 {
		if !targetMissing {
			if targetDeleted {
				if _, err := tx.Exec(ctx, `
					update public.whatsapp_conversations
					set deleted_at = null, updated_at = now()
					where organization_id = $1::uuid
					  and session_id = $2::uuid
					  and id = $3::uuid
				`, session.OrganizationID, session.ID, target.ID); err != nil {
					return nativeEvolutionConversation{}, false, err
				}
			}
			return target, false, nil
		}
		if !currentMissing && !slices.Contains(discoveredIDs, current.ID) {
			return nativeEvolutionConversation{}, false, errors.New("WhatsApp identity candidates changed during reconciliation")
		}
		return current, currentMissing, nil
	}

	if targetMissing {
		if len(sources) != 1 {
			return nativeEvolutionConversation{}, false, fmt.Errorf("%w: LID promotion found multiple source conversations", ErrInvalidInput)
		}
		target = sources[0]
		desiredLeadID, err := safeNativeMergedLeadID("", target.LeadID, lead.ID)
		if err != nil {
			return nativeEvolutionConversation{}, false, err
		}
		if err := validateNativeConversationLeadShape(ctx, tx, session, target.ID, desiredLeadID); err != nil {
			return nativeEvolutionConversation{}, false, err
		}
		if _, err := tx.Exec(ctx, `
			update public.whatsapp_conversations
			set remote_jid = $4,
			    contact_phone = coalesce(nullif($5, ''), contact_phone),
			    contact_name = coalesce(nullif(contact_name, ''), nullif($6, ''), nullif($5, '')),
			    assigned_user_id = coalesce(assigned_user_id, nullif($7, '')::uuid),
			    deleted_at = null,
			    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
			      'promoted_from_remote_jid', $8,
			      'identity_promoted_at', now(),
			      'identity_promotion_source', 'evolution_go_native'
			    ),
			    updated_at = now()
			where organization_id = $1::uuid and session_id = $2::uuid and id = $3::uuid
		`, session.OrganizationID, session.ID, target.ID, canonicalJID, message.ContactPhone, message.ContactName,
			lead.AssignedUserID, target.RemoteJID); err != nil {
			return nativeEvolutionConversation{}, false, err
		}
		// Message remote_jid is immutable provider-event provenance. Promotion
		// changes only the future conversation route and the alias map; rewriting
		// historical rows would make an old LID event look as if it was accepted
		// under the later canonical phone identity.
		if _, err := tx.Exec(ctx, `
			update public.whatsapp_contact_identity_aliases
			set canonical_jid = $4,
			    contact_phone = coalesce(contact_phone, nullif($5, '')),
			    last_seen_at = now()
			where organization_id = $1::uuid and session_id = $2::uuid
			  and (canonical_jid = $3 or alias_jid = $3)
		`, session.OrganizationID, session.ID, target.RemoteJID, canonicalJID, message.ContactPhone); err != nil {
			return nativeEvolutionConversation{}, false, err
		}
		target.RemoteJID = canonicalJID
	} else {
		desiredLeadID, err := safeNativeMergedLeadID(target.LeadID, "", lead.ID)
		if err != nil {
			return nativeEvolutionConversation{}, false, err
		}
		// Retire only unbound or same-card opaque routes before using the
		// canonical row. Their messages and binding ledger remain on the original
		// conversation; routes owned by another card are never touched. Doing this
		// before restoring a deleted target also preserves the active-route unique
		// index when both physical rows historically belonged to the same lead.
		for _, source := range sources {
			if source.LeadID != "" && (desiredLeadID == "" || source.LeadID != desiredLeadID) {
				continue
			}
			aliasRows, err := tx.Query(ctx, `
				select identity_alias.id::text, coalesce(identity_alias.lead_id::text, '')
				from public.whatsapp_contact_identity_aliases as identity_alias
				where identity_alias.organization_id = $1::uuid
				  and identity_alias.session_id = $2::uuid
				  and (
				    identity_alias.alias_jid = $3
				    or identity_alias.canonical_jid = $3
				  )
				order by identity_alias.id
				for update of identity_alias
			`, session.OrganizationID, session.ID, source.RemoteJID)
			if err != nil {
				return nativeEvolutionConversation{}, false, err
			}
			aliasIDs := []string{}
			aliasLeadConflict := false
			for aliasRows.Next() {
				var aliasID string
				var aliasLeadID string
				if err := aliasRows.Scan(&aliasID, &aliasLeadID); err != nil {
					aliasRows.Close()
					return nativeEvolutionConversation{}, false, err
				}
				aliasIDs = append(aliasIDs, aliasID)
				if aliasLeadID != "" && (desiredLeadID == "" || aliasLeadID != desiredLeadID) {
					aliasLeadConflict = true
				}
			}
			if err := aliasRows.Err(); err != nil {
				aliasRows.Close()
				return nativeEvolutionConversation{}, false, err
			}
			aliasRows.Close()
			if aliasLeadConflict {
				// The alias ledger is newer or more specific than this unbound
				// legacy route. Leave both route and alias untouched rather than
				// moving another card's identity into the canonical conversation.
				continue
			}
			if _, err := tx.Exec(ctx, `
				update public.whatsapp_conversations
				set deleted_at = coalesce(deleted_at, now()),
				    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
				      'identity_route_retired_at', now(),
				      'identity_route_replaced_by', $4
				    ),
				    updated_at = now()
				where organization_id = $1::uuid
				  and session_id = $2::uuid
				  and id = $3::uuid
			`, session.OrganizationID, session.ID, source.ID, target.ID); err != nil {
				return nativeEvolutionConversation{}, false, err
			}
			if len(aliasIDs) > 0 {
				if _, err := tx.Exec(ctx, `
					update public.whatsapp_contact_identity_aliases
					set canonical_jid = $4,
					    contact_phone = coalesce(contact_phone, nullif($5, '')),
					    last_seen_at = now()
					where organization_id = $1::uuid
					  and session_id = $2::uuid
					  and id = any($3::uuid[])
				`, session.OrganizationID, session.ID, aliasIDs, target.RemoteJID, message.ContactPhone); err != nil {
					return nativeEvolutionConversation{}, false, err
				}
			}
		}
		if targetDeleted {
			if _, err := tx.Exec(ctx, `
				update public.whatsapp_conversations
				set deleted_at = null, updated_at = now()
				where organization_id = $1::uuid and session_id = $2::uuid and id = $3::uuid
			`, session.OrganizationID, session.ID, target.ID); err != nil {
				return nativeEvolutionConversation{}, false, err
			}
		}
	}

	// Never merge histories from another physical conversation into the
	// canonical row. Message attribution and the binding ledger are scoped to
	// the original conversation id; moving rows would make old events appear in
	// the currently active card and can leak preview/unread state across cards.
	// Future traffic uses the canonical row while each retired legacy LID row
	// remains an intact, auditable history.
	return target, false, nil
}

func safeNativeMergedLeadID(targetLeadID string, sourceLeadID string, resolvedLeadID string) (string, error) {
	nonEmpty := uniqueStrings(targetLeadID, sourceLeadID, resolvedLeadID)
	if len(nonEmpty) > 1 {
		return "", fmt.Errorf("%w: LID promotion has conflicting lead ownership", ErrInvalidInput)
	}
	if len(nonEmpty) == 0 {
		return "", nil
	}
	// A previously linked opaque conversation is promoted only when the now
	// visible phone resolves to that same lead. Ambiguous/mismatched ownership
	// remains quarantined rather than exposing history to another person.
	if sourceLeadID != "" && resolvedLeadID == "" {
		return "", fmt.Errorf("%w: LID promotion could not verify existing lead ownership", ErrInvalidInput)
	}
	return nonEmpty[0], nil
}

func validateNativeConversationLeadShape(ctx context.Context, tx pgx.Tx, session nativeEvolutionSession, conversationID string, desiredLeadID string) error {
	var conflict bool
	if err := tx.QueryRow(ctx, `
		select
		  exists (
		    select 1 from public.whatsapp_messages
		    where organization_id = $1::uuid and session_id = $2::uuid and conversation_id = $3::uuid
		      and lead_id is not null and ($4 = '' or lead_id::text <> $4)
		  )
		  or exists (
		    select 1 from public.whatsapp_inbound_logs
		    where organization_id = $1::uuid and conversation_id = $3::uuid
		      and lead_id is not null and ($4 = '' or lead_id::text <> $4)
		  )
		  or exists (
		    select 1 from public.automation_executions
		    where organization_id = $1::uuid and conversation_id = $3::uuid
		      and lead_id is not null and ($4 = '' or lead_id::text <> $4)
		  )
		  or exists (
		    select 1 from public.conversation_ai_state
		    where organization_id = $1::uuid and conversation_id = $3::uuid
		      and lead_id is not null and ($4 = '' or lead_id::text <> $4)
		  )
		  or exists (
		    select 1 from public.automation_event_outbox
		    where organization_id = $1::uuid and conversation_id = $3::uuid
		      and lead_id is not null and ($4 = '' or lead_id::text <> $4)
		  )
	`, session.OrganizationID, session.ID, conversationID, desiredLeadID).Scan(&conflict); err != nil {
		return err
	}
	if conflict {
		return fmt.Errorf("%w: LID promotion found conflicting lead history", ErrInvalidInput)
	}
	return nil
}

func findSingleNativeEvolutionAliasLead(
	ctx context.Context,
	tx pgx.Tx,
	session nativeEvolutionSession,
	aliases []string,
) (nativeEvolutionLead, error) {
	aliases = uniqueStrings(aliases...)
	if len(aliases) == 0 {
		return nativeEvolutionLead{}, nil
	}
	rows, err := tx.Query(ctx, `
		select distinct alias.lead_id::text
		from public.whatsapp_contact_identity_aliases alias
		where alias.organization_id = $1::uuid
		  and alias.session_id = $2::uuid
		  and alias.alias_jid = any($3::text[])
		  and alias.lead_id is not null
		order by alias.lead_id::text
		limit 2
	`, session.OrganizationID, session.ID, aliases)
	if err != nil {
		return nativeEvolutionLead{}, err
	}
	defer rows.Close()
	leadIDs := []string{}
	for rows.Next() {
		var leadID string
		if err := rows.Scan(&leadID); err != nil {
			return nativeEvolutionLead{}, err
		}
		leadIDs = append(leadIDs, leadID)
	}
	if err := rows.Err(); err != nil {
		return nativeEvolutionLead{}, err
	}
	leadID, err := nativeSingleEvolutionAliasLeadID(leadIDs)
	if err != nil || leadID == "" {
		return nativeEvolutionLead{}, err
	}
	return findScopedNativeEvolutionLeadByID(ctx, tx, session.OrganizationID, leadID)
}

func nativeSingleEvolutionAliasLeadID(leadIDs []string) (string, error) {
	switch normalized := uniqueStrings(leadIDs...); len(normalized) {
	case 0:
		return "", nil
	case 1:
		return normalized[0], nil
	default:
		return "", errNativeEvolutionAliasLeadAmbiguous
	}
}

func findSingleNativeEvolutionLead(ctx context.Context, tx pgx.Tx, organizationID string, message nativeEvolutionMessage) (nativeEvolutionLead, error) {
	candidates := phoneMatchCandidates(append([]string{message.ContactPhone}, message.RemoteAliases...)...)
	if len(candidates) == 0 {
		return nativeEvolutionLead{}, nil
	}
	rows, err := tx.Query(ctx, `
		select l.id::text, coalesce(l.assigned_user_id::text, ''), coalesce(l.name, '')
		from public.leads l
		where l.organization_id = $1::uuid
		  and l.phone is not null
		  and exists (
		    select 1
		    from unnest($2::text[]) candidate(value)
		    where normalize_phone(candidate.value) <> ''
		      and normalize_phone(l.phone) = normalize_phone(candidate.value)
		  )
		order by case when l.deal_status = 'open' then 0 else 1 end, l.created_at desc
		limit 2
	`, organizationID, candidates)
	if err != nil {
		return nativeEvolutionLead{}, err
	}
	defer rows.Close()
	matches := []nativeEvolutionLead{}
	for rows.Next() {
		var match nativeEvolutionLead
		if err := rows.Scan(&match.ID, &match.AssignedUserID, &match.Name); err != nil {
			return nativeEvolutionLead{}, err
		}
		matches = append(matches, match)
	}
	if err := rows.Err(); err != nil {
		return nativeEvolutionLead{}, err
	}
	return nativeSingleEvolutionLeadMatch(matches)
}

func nativeSingleEvolutionLeadMatch(matches []nativeEvolutionLead) (nativeEvolutionLead, error) {
	switch len(matches) {
	case 0:
		return nativeEvolutionLead{}, nil
	case 1:
		return matches[0], nil
	default:
		// Ambiguous phone ownership must stop before upsert. Treating ambiguity
		// as "not found" could create or attach a third lead for the same phone.
		return nativeEvolutionLead{}, errNativeEvolutionLeadPhoneAmbiguous
	}
}

func isNativeEvolutionLeadPhoneAmbiguous(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, errNativeEvolutionLeadPhoneAmbiguous) {
		return true
	}
	var postgresError *pgconn.PgError
	return errors.As(err, &postgresError) && postgresError.Code == "23505" &&
		strings.Contains(strings.ToLower(postgresError.Message), "whatsapp_lead_phone_ambiguous")
}

func isNativeLegacyLeadPhoneUniqueViolation(err error) bool {
	var postgresError *pgconn.PgError
	if !errors.As(err, &postgresError) || postgresError.Code != "23505" {
		return false
	}
	return postgresError.ConstraintName == "leads_org_phone_unique" ||
		strings.Contains(strings.ToLower(postgresError.Message), "leads_org_phone_unique")
}

func findScopedNativeEvolutionLeadByPhone(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	message nativeEvolutionMessage,
	originRoundRobinID string,
) (nativeEvolutionLead, error) {
	candidates := phoneMatchCandidates(append([]string{message.ContactPhone}, message.RemoteAliases...)...)
	matchesByID := map[string]nativeEvolutionLead{}
	for _, candidate := range candidates {
		var match nativeEvolutionLead
		lookupSQL := `
			select lead.id::text, coalesce(lead.assigned_user_id::text, ''), coalesce(lead.name, '')
			from public.find_lead_by_normalized_phone($1::uuid, $2) as lead
		`
		lookupArgs := []any{organizationID, candidate}
		if scopedRoundRobinID := strings.TrimSpace(originRoundRobinID); scopedRoundRobinID != "" {
			lookupSQL = `
				select lead.id::text, coalesce(lead.assigned_user_id::text, ''), coalesce(lead.name, '')
				from public.find_lead_by_normalized_phone(
				  $1::uuid,
				  $2,
				  $3::uuid
				) as lead
			`
			lookupArgs = append(lookupArgs, scopedRoundRobinID)
		}
		err := tx.QueryRow(ctx, lookupSQL, lookupArgs...).Scan(
			&match.ID,
			&match.AssignedUserID,
			&match.Name,
		)
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			return nativeEvolutionLead{}, err
		}
		matchesByID[match.ID] = match
		if len(matchesByID) > 1 {
			return nativeEvolutionLead{}, errNativeEvolutionLeadPhoneAmbiguous
		}
	}
	for _, match := range matchesByID {
		return match, nil
	}
	return nativeEvolutionLead{}, nil
}

type nativeWhatsAppConversationLeadBinding struct {
	Success        bool   `json:"success"`
	Changed        bool   `json:"changed"`
	IsCurrent      bool   `json:"is_current"`
	Stale          bool   `json:"stale"`
	ConversationID string `json:"conversation_id"`
	LeadID         string `json:"lead_id"`
	ActiveLeadID   string `json:"active_lead_id"`
	BindingID      string `json:"binding_id"`
}

func activateNativeWhatsAppConversationLeadBinding(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	conversationID string,
	leadID string,
	providerMessageID string,
	routingSnapshot *nativeIngressRoutingSnapshot,
) (string, bool, error) {
	var rawResult string
	var err error
	if routingSnapshot != nil {
		if routingSnapshot.ConversationID != "" && routingSnapshot.ConversationID != conversationID {
			return "", false, errors.New("WhatsApp conversation changed after ingress routing snapshot")
		}
		err = tx.QueryRow(ctx, `
			select public.activate_whatsapp_conversation_lead_binding_if_current(
			  p_organization_id => $1::uuid,
			  p_conversation_id => $2::uuid,
			  p_lead_id => $3::uuid,
			  p_provider_message_id => nullif($4, ''),
			  p_expected_active_binding_id => nullif($5, '')::uuid,
			  p_expected_current_lead_id => nullif($6, '')::uuid
			)::text
		`, organizationID, conversationID, leadID, strings.TrimSpace(providerMessageID),
			routingSnapshot.ActiveBindingID, routingSnapshot.CurrentLeadID).Scan(&rawResult)
	} else {
		err = tx.QueryRow(ctx, `
			select public.activate_whatsapp_conversation_lead_binding(
			  p_organization_id => $1::uuid,
			  p_conversation_id => $2::uuid,
			  p_lead_id => $3::uuid,
			  p_provider_message_id => nullif($4, '')
			)::text
		`, organizationID, conversationID, leadID, strings.TrimSpace(providerMessageID)).Scan(&rawResult)
	}
	if err != nil {
		return "", false, err
	}
	var binding nativeWhatsAppConversationLeadBinding
	if err := json.Unmarshal([]byte(rawResult), &binding); err != nil {
		return "", false, fmt.Errorf("decode WhatsApp conversation lead binding: %w", err)
	}
	if !binding.Success || strings.TrimSpace(binding.BindingID) == "" ||
		binding.ConversationID != conversationID || binding.LeadID != leadID {
		return "", false, errors.New("WhatsApp conversation lead binding was not activated")
	}
	activeLeadID := strings.TrimSpace(binding.ActiveLeadID)
	if strings.TrimSpace(activeLeadID) == "" {
		return "", false, errors.New("WhatsApp conversation lead binding has no active conversation lead")
	}
	if binding.IsCurrent && (binding.Stale || activeLeadID != leadID) {
		return "", false, errors.New("WhatsApp conversation lead binding returned inconsistent current state")
	}
	historicalReplay := !binding.IsCurrent
	if historicalReplay && strings.TrimSpace(providerMessageID) == "" {
		return "", false, errors.New("WhatsApp conversation lead binding returned a historical result without provider identity")
	}
	return activeLeadID, historicalReplay, nil
}

func nativeEvolutionMessageLeadID(conversation nativeEvolutionConversation) string {
	if conversation.LeadResolutionQuarantineReason != "" {
		return ""
	}
	if leadID := strings.TrimSpace(conversation.MessageLeadID); leadID != "" {
		return leadID
	}
	return strings.TrimSpace(conversation.LeadID)
}

func createAuthorizedNativeLead(ctx context.Context, tx pgx.Tx, session nativeEvolutionSession, message nativeEvolutionMessage, rule nativeInboundRule) (nativeEvolutionLead, error) {
	if message.ContactPhone == "" || !message.IsCTWAAd {
		return nativeEvolutionLead{}, nil
	}
	ctwaConfirmationMethod := nativeCTWAAdConfirmationMethod(message)
	if ctwaConfirmationMethod == "" {
		return nativeEvolutionLead{}, nil
	}
	propertyID, err := resolveNativeCampaignProperty(ctx, tx, session.OrganizationID, message.CampaignPropertyCode)
	if err != nil {
		return nativeEvolutionLead{}, err
	}

	assignment := nativeLeadAssignment{}
	intakeDestination := distribution.IntakeDestination{}
	if rule.ManagedMessageDistribution {
		assignment, err = resolveNativeLeadAssignment(ctx, tx, session, nativeCTWALeadAssignmentRule(rule))
		if err != nil {
			return nativeEvolutionLead{}, err
		}
	} else {
		if rule.IngressSnapshotPresent && !rule.CanonicalIntakeResolved {
			return nativeEvolutionLead{}, errors.New("non-managed WhatsApp CTWA intake is missing a canonical ingress routing decision")
		}
		if rule.CanonicalIntakeResolved {
			intakeDestination, err = lockNativeCTWAIntakeDestination(
				ctx,
				tx,
				session.OrganizationID,
				rule.TargetRoundRobinID,
			)
		} else {
			intakeDestination, err = resolveNativeCTWAIntakeDestination(
				ctx,
				tx,
				session,
				message,
				propertyID,
			)
		}
		if err != nil {
			return nativeEvolutionLead{}, err
		}
		if intakeDestination.RoundRobinID != nil {
			assignment.RoundRobinID = *intakeDestination.RoundRobinID
		} else {
			// A deliberate no-queue result retains the historical connection-owner
			// fallback. Queue-scoped intake is left unassigned until the canonical
			// distributor selects its member below.
			assignment.UserID, err = resolveNativeActiveSessionOwner(ctx, tx, session)
			if err != nil {
				return nativeEvolutionLead{}, err
			}
		}
	}
	createdBy := assignment.UserID
	if createdBy == "" {
		createdBy, err = resolveNativeActiveSessionOwner(ctx, tx, session)
		if err != nil {
			return nativeEvolutionLead{}, err
		}
	}
	targetRoundRobinID := assignment.RoundRobinID
	attribution := nativeCampaignAttribution(message)
	metadataPayload := map[string]any{
		"source":                                "whatsapp",
		"whatsapp_session_id":                   session.ID,
		"remote_jid":                            message.RemoteJID,
		"matched_rule_id":                       rule.ID,
		"managed_whatsapp_message_distribution": rule.ManagedMessageDistribution,
		"target_team_id":                        assignment.TeamID,
		"target_round_robin_id":                 targetRoundRobinID,
		"campaign_label":                        firstNonEmpty(rule.CampaignLabel, message.CampaignHeadline),
		"ctwa_ad_confirmed":                     true,
		"whatsapp_lead_creation_contract":       "ctwa_ad_v2",
		"ctwa_confirmation_method":              ctwaConfirmationMethod,
		"whatsapp_initial_provider_event_id":    session.ID + ":" + message.ProviderMessageID,
		"whatsapp_attribution":                  attribution,
		"property_id":                           propertyID,
	}
	if rule.ManagedMessageDistribution {
		metadataPayload["managed_whatsapp_initial_provider_event_id"] = session.ID + ":" + message.ProviderMessageID
	}
	if !rule.ManagedMessageDistribution {
		metadataPayload["distribution_deferred"] = true
	}
	metadata := jsonb(metadataPayload)
	sourceDetailFallback := "WhatsApp Meta Ads"

	var lead nativeEvolutionLead
	upsertTx, err := tx.Begin(ctx)
	if err != nil {
		return nativeEvolutionLead{}, err
	}
	err = upsertTx.QueryRow(ctx, `
		select id::text, coalesce(assigned_user_id::text, ''), coalesce(name, ''), is_new_lead
		from public.upsert_whatsapp_webhook_lead(
		  p_organization_id => $1::uuid,
		  p_name => $2,
		  p_phone => $3,
		  p_whatsapp => $3,
		  p_whatsapp_avatar_url => null::text,
		  p_whatsapp_avatar_synced_at => null::timestamptz,
		  p_source_detail => nullif($4, ''),
		  p_source_session_id => $5::uuid,
		  p_initial_message => nullif($6, ''),
		  p_message => nullif($6, ''),
		  p_property_code => nullif($13, ''),
		  p_property_id => nullif($14, '')::uuid,
		  p_interest_property_id => nullif($14, '')::uuid,
		  p_assigned_user_id => nullif($7, '')::uuid,
		  p_assigned_at => case when nullif($7, '') is null then null else $8::timestamptz end,
		  p_pipeline_id => nullif($10, '')::uuid,
		  p_stage_id => nullif($11, '')::uuid,
		  p_created_by => nullif($12, '')::uuid,
		  p_first_touch_at => $8::timestamptz,
		  p_first_touch_channel => 'whatsapp',
		  p_last_contact_at => $8::timestamptz,
		  p_metadata => $9::jsonb,
		  p_origin_round_robin_id => nullif($15, '')::uuid
		)
	`, session.OrganizationID, firstNonEmpty(message.ContactName, message.ContactPhone), message.ContactPhone,
		firstNonEmpty(rule.CampaignLabel, message.CampaignHeadline, rule.SourceLabel, sourceDetailFallback), session.ID, message.Content,
		assignment.UserID, message.SentAt, metadata, assignment.PipelineID, assignment.StageID, createdBy,
		message.CampaignPropertyCode, propertyID, targetRoundRobinID).Scan(
		&lead.ID,
		&lead.AssignedUserID,
		&lead.Name,
		&lead.IsNew,
	)
	if err != nil {
		_ = upsertTx.Rollback(ctx)
		if errors.Is(err, pgx.ErrNoRows) {
			// The database guard is intentionally a second fail-closed layer for
			// every CTWA creation mode. Committing a conversation/message without the
			// requested lead would consume the provider event and lose the lead.
			return nativeEvolutionLead{}, errors.New("WhatsApp CTWA lead creation context was rejected")
		}
		if isNativeLegacyLeadPhoneUniqueViolation(err) {
			lead, err = findSingleNativeEvolutionLead(ctx, tx, session.OrganizationID, message)
			if err != nil {
				return nativeEvolutionLead{}, err
			}
			if lead.ID == "" {
				return nativeEvolutionLead{}, errors.New("legacy WhatsApp phone uniqueness conflict could not recover a lead")
			}
			lead.ScopeCompatibilityFallback = true
			lead.RequestedOriginRoundRobinID = targetRoundRobinID
			if _, updateErr := tx.Exec(ctx, `
				update public.leads
				set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
				      'whatsapp_queue_scope_compatibility', jsonb_build_object(
				        'mode', 'legacy_global_phone_unique',
				        'requested_origin_round_robin_id', nullif($3, '')::uuid,
				        'provider_message_id', $4,
				        'recorded_at', now()
				      )
				    ),
				    updated_at = now()
				where organization_id = $1::uuid and id = $2::uuid
			`, session.OrganizationID, lead.ID, targetRoundRobinID, message.ProviderMessageID); updateErr != nil {
				return nativeEvolutionLead{}, updateErr
			}
		} else {
			return nativeEvolutionLead{}, err
		}
	} else if commitErr := upsertTx.Commit(ctx); commitErr != nil {
		return nativeEvolutionLead{}, commitErr
	}
	if !rule.ManagedMessageDistribution && targetRoundRobinID != "" {
		var persistedOriginRoundRobinID string
		if err := tx.QueryRow(ctx, `
			select
			  coalesce(origin_round_robin_id::text, ''),
			  coalesce(assigned_user_id::text, ''),
			  coalesce(name, '')
			from public.leads
			where organization_id = $1::uuid and id = $2::uuid
			for update
		`, session.OrganizationID, lead.ID).Scan(
			&persistedOriginRoundRobinID,
			&lead.AssignedUserID,
			&lead.Name,
		); err != nil {
			return nativeEvolutionLead{}, err
		}
		if !strings.EqualFold(strings.TrimSpace(persistedOriginRoundRobinID), targetRoundRobinID) {
			lead.ScopeCompatibilityFallback = true
			lead.RequestedOriginRoundRobinID = targetRoundRobinID
			if _, err := tx.Exec(ctx, `
				update public.leads
				set metadata = (coalesce(metadata, '{}'::jsonb) - 'distribution_deferred')
				      || jsonb_build_object(
				        'whatsapp_queue_scope_compatibility', jsonb_build_object(
				          'mode', 'legacy_global_phone_unique',
				          'requested_origin_round_robin_id', $3::uuid,
				          'provider_message_id', $4,
				          'recorded_at', now()
				        )
				      ),
				    updated_at = now()
				where organization_id = $1::uuid and id = $2::uuid
			`, session.OrganizationID, lead.ID, targetRoundRobinID, message.ProviderMessageID); err != nil {
				return nativeEvolutionLead{}, err
			}
			// During A1/A2 the legacy global phone index can force a queue-B event
			// onto an existing queue-A card. Never redistribute or cosmetically
			// relabel that card; B2 enables the next event to create its own scope.
			return lead, nil
		}
	}
	if rule.ManagedMessageDistribution && lead.IsNew {
		if err := tx.QueryRow(ctx, `
			select coalesce(assigned_user_id::text, ''), coalesce(name, '')
			from public.leads
			where organization_id = $1::uuid and id = $2::uuid
		`, session.OrganizationID, lead.ID).Scan(&lead.AssignedUserID, &lead.Name); err != nil {
			return nativeEvolutionLead{}, err
		}
	}
	if rule.ManagedMessageDistribution {
		return lead, nil
	}
	var roundRobinID *string
	if targetRoundRobinID != "" {
		roundRobinID = &targetRoundRobinID
	}
	distributionSource := "whatsapp"
	distributionResult, err := distribution.Distribute(ctx, tx, distribution.Request{
		OrganizationID:     session.OrganizationID,
		LeadID:             lead.ID,
		IdempotencyKey:     distribution.StableKey("whatsapp-native", session.ID, message.ProviderMessageID),
		RoundRobinID:       roundRobinID,
		RoundRobinResolved: true,
		PreserveAssignee:   distribution.PreserveAssigneeForIntake(!lead.IsNew, intakeDestination),
		Source:             &distributionSource,
		OccurredAt:         message.SentAt,
	})
	if err != nil {
		return nativeEvolutionLead{}, err
	}
	if distributionResult.AssignedUserID != nil {
		lead.AssignedUserID = *distributionResult.AssignedUserID
	} else {
		lead.AssignedUserID = ""
	}
	return lead, nil
}

func resolveNativeCTWAIntakeDestination(
	ctx context.Context,
	queryer distribution.Queryer,
	session nativeEvolutionSession,
	message nativeEvolutionMessage,
	propertyID string,
) (distribution.IntakeDestination, error) {
	pipelineID, err := resolveNativeCTWAIntakePipeline(ctx, queryer, session.OrganizationID)
	if err != nil {
		return distribution.IntakeDestination{}, err
	}
	return distribution.ResolveIntakeDestination(ctx, queryer, distribution.IntakeContext{
		OrganizationID:       session.OrganizationID,
		PipelineID:           pipelineID,
		Source:               "whatsapp",
		PropertyID:           nativeOptionalTextPointer(propertyID),
		InterestPropertyID:   nativeOptionalTextPointer(propertyID),
		SourceSessionID:      nativeOptionalTextPointer(session.ID),
		UTMCampaign:          nativeOptionalTextPointer(message.CampaignHeadline),
		LeadMetaCampaignName: nativeOptionalTextPointer(message.CampaignHeadline),
		MetaCampaignID:       nativeOptionalTextPointer(message.CampaignSourceID),
	})
}

func resolveNativeCTWAIntakePipeline(
	ctx context.Context,
	queryer distribution.Queryer,
	organizationID string,
) (*string, error) {
	var pipelineID string
	err := queryer.QueryRow(ctx, `
		select pipeline.id::text
		from public.pipelines as pipeline
		where pipeline.organization_id = $1::uuid
		  and coalesce(pipeline.is_active, true) = true
		order by
		  coalesce(pipeline.is_default, false) desc,
		  coalesce(pipeline.position, 0) asc,
		  pipeline.created_at asc,
		  pipeline.id asc
		limit 1
		for share
	`, strings.TrimSpace(organizationID)).Scan(&pipelineID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("resolve WhatsApp intake pipeline: %w", err)
	}
	pipelineID = strings.ToLower(strings.TrimSpace(pipelineID))
	if pipelineID == "" {
		return nil, errors.New("resolved WhatsApp intake pipeline is empty")
	}
	return &pipelineID, nil
}

func lockNativeCTWAIntakeDestination(
	ctx context.Context,
	queryer distribution.Queryer,
	organizationID string,
	roundRobinID string,
) (distribution.IntakeDestination, error) {
	roundRobinID = strings.TrimSpace(roundRobinID)
	if roundRobinID == "" {
		return distribution.IntakeDestination{Resolved: true}, nil
	}
	var lockedRoundRobinID string
	var reentryBehavior string
	err := queryer.QueryRow(ctx, `
		select
		  queue.id::text,
		  case
		    when lower(btrim(coalesce(
		      nullif(queue.reentry_behavior, ''),
		      nullif(queue.rules->>'reentry_behavior', ''),
		      'redistribute'
		    ))) = 'keep_assignee' then 'keep_assignee'
		    else 'redistribute'
		  end
		from public.round_robins as queue
		where queue.organization_id = $1::uuid
		  and queue.id = $2::uuid
		for share
	`, strings.TrimSpace(organizationID), roundRobinID).Scan(&lockedRoundRobinID, &reentryBehavior)
	if errors.Is(err, pgx.ErrNoRows) {
		return distribution.IntakeDestination{}, fmt.Errorf(
			"%w: frozen WhatsApp intake queue was deleted or is outside the organization",
			distribution.ErrInvalidIntakeRouting,
		)
	}
	if err != nil {
		return distribution.IntakeDestination{}, fmt.Errorf("lock frozen WhatsApp intake queue: %w", err)
	}
	if !strings.EqualFold(strings.TrimSpace(lockedRoundRobinID), roundRobinID) {
		return distribution.IntakeDestination{}, fmt.Errorf(
			"%w: frozen WhatsApp intake queue changed while locking",
			distribution.ErrInvalidIntakeRouting,
		)
	}
	lockedRoundRobinID = strings.ToLower(strings.TrimSpace(lockedRoundRobinID))
	return distribution.IntakeDestination{
		RoundRobinID:    &lockedRoundRobinID,
		ReentryBehavior: reentryBehavior,
		Resolved:        true,
	}, nil
}

func nativeOptionalTextPointer(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

func nativeCTWALeadAssignmentRule(rule nativeInboundRule) nativeInboundRule {
	if rule.ManagedMessageDistribution {
		return rule
	}
	// CTWA without a canonical managed queue falls back only to the active
	// session owner. Legacy rule users, teams, pipelines and round robins must
	// not bypass canonical schedules, tags or redistribution.
	return nativeInboundRule{}
}

func nativeTargetRoundRobinID(rule nativeInboundRule, assignment nativeLeadAssignment) string {
	if rule.ManagedMessageDistribution {
		return rule.TargetRoundRobinID
	}
	return assignment.RoundRobinID
}

func resolveNativeCampaignProperty(ctx context.Context, tx pgx.Tx, organizationID string, rawCode string) (string, error) {
	code := strings.TrimSpace(rawCode)
	if code == "" {
		return "", nil
	}
	rows, err := tx.Query(ctx, `
		select property.id::text
		from public.properties property
		where property.organization_id = $1::uuid
		  and (
		    btrim(coalesce(property.code, '')) = $2
		    or btrim(coalesce(property.referencia_alternativa, '')) = $2
		    or btrim(coalesce(property.external_id, '')) = $2
		    or btrim(coalesce(property.imoview_codigo, '')) = $2
		    or btrim(coalesce(property.vista_codigo, '')) = $2
		  )
		order by property.updated_at desc, property.id
		limit 2
		for share
	`, organizationID, code)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	matches := make([]string, 0, 2)
	for rows.Next() {
		var propertyID string
		if err := rows.Scan(&propertyID); err != nil {
			return "", err
		}
		matches = append(matches, propertyID)
	}
	if err := rows.Err(); err != nil {
		return "", err
	}
	// Duplicate property codes are unsafe: never guess and never cross an
	// organization boundary merely because an external reference matches.
	if len(matches) != 1 {
		return "", nil
	}
	return matches[0], nil
}

func insertNativeEvolutionMessage(ctx context.Context, tx pgx.Tx, session nativeEvolutionSession, conversation nativeEvolutionConversation, message nativeEvolutionMessage) (bool, string, string, error) {
	if conversation.LeadResolutionQuarantineReason != "" {
		// Keep neutral provider evidence, but never start or preserve a media
		// transfer on behalf of whichever card currently owns this thread.
		message.MediaURL = ""
		message.MediaBase64 = ""
		message.MediaMimeType = ""
		message.MediaStoragePath = ""
		message.MediaSize = 0
		message.MediaStatus = ""
		message.MediaError = ""
	}
	messageMetadata := jsonb(nativeEvolutionMessageMetadata(message, conversation))
	var existingID, existingConversationID, existingLeadID, existingStatus string
	rows, err := tx.Query(ctx, `
		select id::text, conversation_id::text, coalesce(lead_id::text, ''), status
		from public.whatsapp_messages
		where organization_id = $1::uuid
		  and session_id = $2::uuid
		  and (
		    message_id = $3 or provider_message_id = $3 or client_message_id = $3
		  )
		order by id
		limit 2
		for update
	`, session.OrganizationID, session.ID, message.ProviderMessageID)
	if err != nil {
		return false, "", "", err
	}
	existingCount := 0
	for rows.Next() {
		existingCount++
		if existingCount > 1 {
			rows.Close()
			return false, "", "", errors.New("WhatsApp message provider identity conflict")
		}
		if err := rows.Scan(&existingID, &existingConversationID, &existingLeadID, &existingStatus); err != nil {
			rows.Close()
			return false, "", "", err
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return false, "", "", err
	}
	rows.Close()
	if existingCount == 1 {
		expectedLeadID := nativeEvolutionMessageLeadID(conversation)
		if existingConversationID != conversation.ID {
			return false, "", "", errors.New("WhatsApp message conversation identity conflict")
		}
		if existingLeadID != "" && existingLeadID != expectedLeadID {
			return false, "", "", errors.New("WhatsApp message lead identity conflict")
		}
		incomingStatus := "received"
		if message.FromMe {
			incomingStatus = "sent"
		}
		status := nativeMonotonicStatus(existingStatus, incomingStatus)
		_, err = tx.Exec(ctx, `
			update public.whatsapp_messages
			set lead_id = coalesce(lead_id, nullif($15, '')::uuid),
			    provider_message_id = coalesce(provider_message_id, $4),
			    message_id = coalesce(message_id, $4),
			    status = $5,
			    content = coalesce(content, nullif($6, '')),
			    media_url = coalesce(media_url, nullif($7, '')),
			    media_mime_type = coalesce(media_mime_type, nullif($8, '')),
			    media_storage_path = coalesce(media_storage_path, nullif($9, '')),
			    media_status = case
			      when coalesce(media_storage_path, nullif($9, '')) is not null then 'ready'
			      when media_status in ('ready', 'pending') then media_status
			      else coalesce(nullif($12, ''), media_status)
			    end,
			    media_error = case
			      when coalesce(media_storage_path, nullif($9, '')) is not null then null
			      when media_status in ('ready', 'pending') then media_error
			      else coalesce(nullif($13, ''), media_error)
			    end,
			    media_size = coalesce(media_size, nullif($11, 0)),
			    sent_at = coalesce(sent_at, $10),
			    received_at = case when from_me then received_at else coalesce(received_at, now()) end,
			    metadata = coalesce(metadata, '{}'::jsonb) || $14::jsonb,
			    updated_at = now()
			where organization_id = $1::uuid and session_id = $2::uuid and id = $3::uuid
		`, session.OrganizationID, session.ID, existingID, message.ProviderMessageID, status, message.Content, message.MediaURL, message.MediaMimeType, message.MediaStoragePath, message.SentAt, message.MediaSize, message.MediaStatus, message.MediaError, messageMetadata, expectedLeadID)
		return false, existingConversationID, existingID, err
	}

	status := "received"
	direction := "inbound"
	if message.FromMe {
		status = "sent"
		direction = "outbound"
	}
	mediaStatus := message.MediaStatus
	mediaError := message.MediaError
	if conversation.LeadResolutionQuarantineReason == "" && nativeIsMediaType(message.MessageType) {
		if message.MediaStoragePath != "" {
			mediaStatus = "ready"
			mediaError = ""
		} else if mediaStatus == "" {
			mediaStatus = "pending"
		}
	}
	var insertedID string
	err = tx.QueryRow(ctx, `
		insert into public.whatsapp_messages (
			organization_id, conversation_id, session_id, lead_id,
			provider_message_id, message_id, from_me, direction, content,
			message_type, media_url, media_mime_type, media_storage_path,
			media_status, media_error, media_size, remote_jid, sender_jid,
			sender_name, status, sent_at, received_at, metadata
		) values (
			$1::uuid, $2::uuid, $3::uuid, nullif($4, '')::uuid,
			$5, $5, $6, $7, nullif($8, ''),
			$9, nullif($10, ''), nullif($11, ''), nullif($12, ''),
			nullif($13, ''), nullif($14, ''), nullif($15, 0), $16, nullif($17, ''),
			nullif($18, ''), $19, $20, case when $6 then null else now() end,
			$21::jsonb
		)
		on conflict (conversation_id, message_id) do nothing
		returning id::text
	`, session.OrganizationID, conversation.ID, session.ID, nativeEvolutionMessageLeadID(conversation),
		message.ProviderMessageID, message.FromMe, direction, message.Content,
		message.MessageType, message.MediaURL, message.MediaMimeType, message.MediaStoragePath,
		mediaStatus, mediaError, message.MediaSize, conversation.RemoteJID, message.SenderJID,
		message.SenderName, status, message.SentAt, messageMetadata).Scan(&insertedID)
	if errors.Is(err, pgx.ErrNoRows) {
		var conflictedLeadID string
		if err := tx.QueryRow(ctx, `
			select id::text, coalesce(lead_id::text, '') from public.whatsapp_messages
			where organization_id = $1::uuid and session_id = $2::uuid
			  and conversation_id = $3::uuid and message_id = $4
			limit 1
		`, session.OrganizationID, session.ID, conversation.ID, message.ProviderMessageID).Scan(&insertedID, &conflictedLeadID); err != nil {
			return false, "", "", err
		}
		expectedLeadID := nativeEvolutionMessageLeadID(conversation)
		if conflictedLeadID != expectedLeadID {
			return false, "", "", errors.New("WhatsApp message lead identity conflict")
		}
		return false, conversation.ID, insertedID, nil
	}
	return err == nil, conversation.ID, insertedID, err
}

func nativeEvolutionMessageMetadata(message nativeEvolutionMessage, conversations ...nativeEvolutionConversation) map[string]any {
	conversation := nativeEvolutionConversation{}
	if len(conversations) > 0 {
		conversation = conversations[0]
	}
	metadata := map[string]any{
		"source": "evolution_go_webhook",
		"whatsapp_event_binding_is_current": conversation.LeadResolutionQuarantineReason == "" &&
			!conversation.HistoricalBindingReplay &&
			nativeEvolutionMessageLeadID(conversation) == strings.TrimSpace(conversation.LeadID),
		"whatsapp_attribution": nativeCampaignAttribution(message),
		"whatsapp_referral":    nativeCampaignReferralSnapshot(message),
	}
	if conversation.LeadResolutionQuarantineReason != "" {
		metadata["lead_resolution_quarantine"] = map[string]any{
			"reason":      conversation.LeadResolutionQuarantineReason,
			"terminal":    true,
			"retryable":   false,
			"recorded_at": time.Now().UTC().Format(time.RFC3339Nano),
		}
	}
	if conversation.LeadScopeCompatibilityFallback {
		metadata["lead_scope_compatibility"] = map[string]any{
			"mode":                            "legacy_global_phone_unique",
			"requested_origin_round_robin_id": conversation.RequestedOriginRoundRobinID,
		}
	}
	return metadata
}

func updateNativeEvolutionConversation(ctx context.Context, tx pgx.Tx, session nativeEvolutionSession, conversation nativeEvolutionConversation, message nativeEvolutionMessage) (bool, error) {
	preview := nativeEvolutionPreview(message)
	unreadIncrement := 0
	if !message.FromMe {
		unreadIncrement = 1
	}
	expectedLeadID := nativeEvolutionMessageLeadID(conversation)
	tag, err := tx.Exec(ctx, `
		update public.whatsapp_conversations
		set last_message = case when last_message_at is null or last_message_at <= $4 then $5 else last_message end,
		    last_message_preview = case when last_message_at is null or last_message_at <= $4 then $5 else last_message_preview end,
		    last_message_at = greatest(coalesce(last_message_at, $4), $4),
		    unread_count = greatest(0, coalesce(unread_count, 0) + $6),
		    contact_name = coalesce(contact_name, nullif($7, '')),
		    contact_phone = coalesce(contact_phone, nullif($8, '')),
		    updated_at = now()
		where organization_id = $1::uuid and session_id = $2::uuid and id = $3::uuid
		  and lead_id is not distinct from nullif($9, '')::uuid
	`, session.OrganizationID, session.ID, conversation.ID, message.SentAt, preview, unreadIncrement, message.ContactName, message.ContactPhone, expectedLeadID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

type nativeEvolutionLockedMessageTarget struct {
	ID                  string
	ConversationID      string
	LeadID              string
	MessageID           string
	ProviderMessageID   string
	ClientMessageID     string
	CanonicalProviderID string
	SentAt              *time.Time
}

var errNativeEvolutionTransportIdentityConflict = errors.New("WhatsApp transport identity conflict")

func nativeCanonicalProviderIdentity(providerMessageID string, messageID string) string {
	return firstNonEmpty(strings.TrimSpace(providerMessageID), strings.TrimSpace(messageID))
}

// lockNativeEvolutionMessageTarget keeps the webhook mutation lock order
// aligned with rebind and outbox finalization: conversation first, message
// second. The first CTE only discovers an immutable row id without locking it;
// after the conversation lock is held, the final join revalidates and locks the
// exact target message from the same statement snapshot.
func lockNativeEvolutionMessageTarget(
	ctx context.Context,
	tx pgx.Tx,
	session nativeEvolutionSession,
	providerIdentity string,
) (nativeEvolutionLockedMessageTarget, error) {
	rows, err := tx.Query(ctx, `
		with target_identity as materialized (
			select message.id, message.conversation_id
			from public.whatsapp_messages as message
			where message.organization_id = $1::uuid
			  and message.session_id = $2::uuid
			  and (
				message.message_id = $3
				or message.provider_message_id = $3
				or message.client_message_id = $3
			  )
			order by message.id
			limit 2
		), locked_conversation as materialized (
			select target.id as target_id, conversation.id
			from target_identity as target
			join public.whatsapp_conversations as conversation
			  on conversation.id = target.conversation_id
			where conversation.organization_id = $1::uuid
			  and conversation.session_id = $2::uuid
			order by conversation.id, target.id
			for no key update of conversation
		)
		select
			message.id::text,
			message.conversation_id::text,
			coalesce(message.lead_id::text, ''),
			coalesce(message.message_id, ''),
			coalesce(message.provider_message_id, ''),
			coalesce(message.client_message_id, ''),
			message.sent_at
		from target_identity as target
		join locked_conversation as conversation
		  on conversation.target_id = target.id
		 and conversation.id = target.conversation_id
		join public.whatsapp_messages as message
		  on message.id = target.id
		 and message.conversation_id = conversation.id
		where message.organization_id = $1::uuid
		  and message.session_id = $2::uuid
		  and (
			message.message_id = $3
			or message.provider_message_id = $3
			or message.client_message_id = $3
		  )
		order by message.id
		for update of message
	`, session.OrganizationID, session.ID, providerIdentity)
	if err != nil {
		return nativeEvolutionLockedMessageTarget{}, err
	}
	defer rows.Close()

	targets := make([]nativeEvolutionLockedMessageTarget, 0, 2)
	for rows.Next() {
		var target nativeEvolutionLockedMessageTarget
		if err := rows.Scan(
			&target.ID,
			&target.ConversationID,
			&target.LeadID,
			&target.MessageID,
			&target.ProviderMessageID,
			&target.ClientMessageID,
			&target.SentAt,
		); err != nil {
			return nativeEvolutionLockedMessageTarget{}, err
		}
		target.CanonicalProviderID = nativeCanonicalProviderIdentity(target.ProviderMessageID, target.MessageID)
		targets = append(targets, target)
	}
	if err := rows.Err(); err != nil {
		return nativeEvolutionLockedMessageTarget{}, err
	}
	if len(targets) == 0 {
		return nativeEvolutionLockedMessageTarget{}, pgx.ErrNoRows
	}
	if len(targets) != 1 || targets[0].CanonicalProviderID != strings.TrimSpace(providerIdentity) {
		return nativeEvolutionLockedMessageTarget{}, fmt.Errorf(
			"%w: provider identity %q matched %d logical messages",
			errNativeEvolutionTransportIdentityConflict,
			strings.TrimSpace(providerIdentity),
			len(targets),
		)
	}
	return targets[0], nil
}

func processNativeEvolutionDeletion(ctx context.Context, tx pgx.Tx, session nativeEvolutionSession, message nativeEvolutionMessage) error {
	target, err := lockNativeEvolutionMessageTarget(
		ctx,
		tx,
		session,
		message.DeletionTargetID,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("deletion target %s not found yet", message.DeletionTargetID)
	}
	if err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, `
			update public.whatsapp_messages
		set content = 'Esta mensagem foi apagada',
		    message_type = 'deleted',
		    media_url = null,
		    media_storage_path = null,
		    media_status = null,
		    media_error = null,
		    media_mime_type = null,
		    media_size = null,
		    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
		      'deleted', true,
		      'deleted_at', coalesce(metadata->>'deleted_at', now()::text),
		      'deletion_event_id', $4
			    ),
			    updated_at = now()
			where organization_id = $1::uuid
			  and session_id = $2::uuid
			  and id = $3::uuid
			  and conversation_id = $5::uuid
			  and lead_id is not distinct from nullif($6, '')::uuid
			  and coalesce(message_id, '') = $7
			  and coalesce(provider_message_id, '') = $8
			  and coalesce(client_message_id, '') = $9
		`, session.OrganizationID, session.ID, target.ID, message.ProviderMessageID,
		target.ConversationID, target.LeadID, target.MessageID, target.ProviderMessageID, target.ClientMessageID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return fmt.Errorf("%w: deletion target changed after lock", errNativeEvolutionTransportIdentityConflict)
	}
	if target.SentAt != nil {
		if _, err := tx.Exec(ctx, `
			update public.whatsapp_conversations
			set last_message = 'Esta mensagem foi apagada',
			    last_message_preview = 'Esta mensagem foi apagada',
			    updated_at = now()
				where organization_id = $1::uuid and session_id = $2::uuid and id = $3::uuid
				  and last_message_at = $4::timestamptz
				  and lead_id is not distinct from nullif($5, '')::uuid
			`, session.OrganizationID, session.ID, target.ConversationID, *target.SentAt, target.LeadID); err != nil {
			return err
		}
	}
	return nil
}

func processNativeEvolutionReaction(ctx context.Context, tx pgx.Tx, session nativeEvolutionSession, message nativeEvolutionMessage) error {
	target, err := lockNativeEvolutionMessageTarget(
		ctx,
		tx,
		session,
		message.ReactionTargetID,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("reaction target %s not found yet", message.ReactionTargetID)
	}
	if err != nil {
		return err
	}
	actorJID := normalizeRemoteAlias(message.SenderJID)
	if message.FromMe {
		var valid bool
		actorJID, valid = canonicalWhatsAppSelfJID(message.SenderJID)
		if !valid {
			actorJID, valid = canonicalWhatsAppSelfJID(session.PhoneNumber)
		}
		if !valid {
			return fmt.Errorf("outbound reaction actor identity is unavailable")
		}
	}
	actorJID = firstNonEmpty(actorJID, message.RemoteJID)
	if actorJID == "" {
		return fmt.Errorf("reaction actor is missing")
	}
	state := "active"
	if message.ReactionEmoji == "" {
		state = "removed"
	}
	if _, err := tx.Exec(ctx, `
		insert into public.whatsapp_message_reactions (
			organization_id, session_id, conversation_id, target_message_id,
			target_provider_message_id, provider_reaction_message_id, actor_jid,
			actor_name, from_me, emoji, status, reacted_at, removed_at
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid,
			$5, $6, $7, nullif($8, ''), $9, nullif($10, ''), $11, $12::timestamptz,
			case when $11 = 'removed' then $12::timestamptz else null::timestamptz end
		)
		on conflict (organization_id, session_id, target_provider_message_id, actor_jid)
		do update set
			provider_reaction_message_id = excluded.provider_reaction_message_id,
			actor_name = coalesce(excluded.actor_name, whatsapp_message_reactions.actor_name),
			from_me = excluded.from_me,
			emoji = excluded.emoji,
			status = excluded.status,
			reacted_at = excluded.reacted_at,
			removed_at = excluded.removed_at,
			updated_at = now()
	`, session.OrganizationID, session.ID, target.ConversationID, target.ID, target.CanonicalProviderID,
		message.ProviderMessageID, actorJID, message.SenderName, message.FromMe,
		message.ReactionEmoji, state, message.SentAt); err != nil {
		return err
	}

	direction := "inbound"
	status := "received"
	if message.FromMe {
		direction = "outbound"
		status = "sent"
	}
	_, err = tx.Exec(ctx, `
		insert into public.whatsapp_messages (
			organization_id, conversation_id, session_id, lead_id,
			provider_message_id, message_id, from_me, direction, content,
			message_type, reaction_to_message_id, reaction_emoji,
			reaction_sender_jid, reaction_sender_name, remote_jid, sender_jid,
			sender_name, status, sent_at, received_at, metadata
		) values (
			$1::uuid, $2::uuid, $3::uuid, nullif($4, '')::uuid,
			$5, $5, $6, $7, nullif($8, ''),
			'reaction', $9, nullif($8, ''), $10, nullif($11, ''), $12, $10,
			nullif($11, ''), $13, $14, case when $6 then null else now() end,
			jsonb_build_object('source', 'evolution_go_native')
		)
		on conflict (conversation_id, message_id)
		do update set
			content = excluded.content,
			reaction_emoji = excluded.reaction_emoji,
			reaction_sender_jid = excluded.reaction_sender_jid,
			reaction_sender_name = excluded.reaction_sender_name,
			sent_at = excluded.sent_at,
			updated_at = now()
	`, session.OrganizationID, target.ConversationID, session.ID, target.LeadID,
		message.ProviderMessageID, message.FromMe, direction, message.ReactionEmoji,
		target.CanonicalProviderID, actorJID, message.SenderName, message.RemoteJID, status, message.SentAt)
	return err
}

type nativeStatusTransportTarget struct {
	MessageRowID            string
	ConversationID          string
	LeadID                  string
	MessageID               string
	ProviderMessageID       string
	ClientMessageID         string
	MessageStatus           string
	OutboxID                string
	OutboxMessageRowID      string
	OutboxConversationID    string
	OutboxProviderMessageID string
	OutboxClientMessageID   string
	OutboxStatus            string
}

func (target nativeStatusTransportTarget) matches(identity string) bool {
	identity = strings.TrimSpace(identity)
	return identity != "" && (target.MessageID == identity ||
		target.ProviderMessageID == identity ||
		target.ClientMessageID == identity ||
		target.OutboxProviderMessageID == identity ||
		target.OutboxClientMessageID == identity)
}

func (target nativeStatusTransportTarget) validateCanonicalIdentity(identity string) error {
	identity = strings.TrimSpace(identity)
	canonicalProviderID := nativeCanonicalProviderIdentity(target.ProviderMessageID, target.MessageID)
	if canonicalProviderID == "" || canonicalProviderID != identity {
		return fmt.Errorf(
			"%w: receipt identity %q is not the canonical provider identity for message %s",
			errNativeEvolutionTransportIdentityConflict,
			identity,
			target.MessageRowID,
		)
	}
	if target.OutboxID == "" {
		return nil
	}
	if target.OutboxMessageRowID != target.MessageRowID ||
		target.OutboxConversationID != target.ConversationID ||
		target.OutboxClientMessageID != target.ClientMessageID ||
		(target.OutboxProviderMessageID != "" && target.OutboxProviderMessageID != canonicalProviderID) {
		return fmt.Errorf(
			"%w: receipt identity %q resolved to an incoherent outbox/message pair",
			errNativeEvolutionTransportIdentityConflict,
			identity,
		)
	}
	return nil
}

func loadNativeStatusTransportTargets(
	ctx context.Context,
	tx pgx.Tx,
	session nativeEvolutionSession,
	messageIDs []string,
) ([]nativeStatusTransportTarget, error) {
	messageIDs = uniqueStrings(messageIDs...)
	if len(messageIDs) == 0 {
		return nil, nil
	}
	rows, err := tx.Query(ctx, `
		select
		  message.id::text,
		  message.conversation_id::text,
		  coalesce(message.lead_id::text, ''),
		  coalesce(message.message_id, ''),
		  coalesce(message.provider_message_id, ''),
		  coalesce(message.client_message_id, ''),
		  message.status,
		  coalesce(outbox.id::text, ''),
		  coalesce(outbox.message_id::text, ''),
		  coalesce(outbox.conversation_id::text, ''),
		  coalesce(outbox.provider_message_id, ''),
		  coalesce(outbox.client_message_id, ''),
		  coalesce(outbox.status, '')
		from public.whatsapp_messages as message
		left join public.whatsapp_outbox as outbox
		  on outbox.organization_id = message.organization_id
		 and outbox.session_id = message.session_id
		 and outbox.message_id = message.id
		where message.organization_id = $1::uuid
		  and message.session_id = $2::uuid
		  and (
		    message.message_id = any($3::text[])
		    or message.provider_message_id = any($3::text[])
		    or message.client_message_id = any($3::text[])
		    or outbox.provider_message_id = any($3::text[])
		    or outbox.client_message_id = any($3::text[])
		  )
		order by message.id, outbox.id
	`, session.OrganizationID, session.ID, messageIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	targets := make([]nativeStatusTransportTarget, 0)
	for rows.Next() {
		var target nativeStatusTransportTarget
		if err := rows.Scan(
			&target.MessageRowID,
			&target.ConversationID,
			&target.LeadID,
			&target.MessageID,
			&target.ProviderMessageID,
			&target.ClientMessageID,
			&target.MessageStatus,
			&target.OutboxID,
			&target.OutboxMessageRowID,
			&target.OutboxConversationID,
			&target.OutboxProviderMessageID,
			&target.OutboxClientMessageID,
			&target.OutboxStatus,
		); err != nil {
			return nil, err
		}
		targets = append(targets, target)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return targets, nil
}

func resolveNativeStatusTransportTargets(
	messageIDs []string,
	candidates []nativeStatusTransportTarget,
) ([]nativeStatusTransportTarget, map[string]bool, error) {
	resolved := make([]nativeStatusTransportTarget, 0)
	resolvedRows := map[string]struct{}{}
	matched := map[string]bool{}
	for _, identity := range uniqueStrings(messageIDs...) {
		identityMatches := make([]nativeStatusTransportTarget, 0, 2)
		for _, candidate := range candidates {
			if candidate.matches(identity) {
				identityMatches = append(identityMatches, candidate)
			}
		}
		if len(identityMatches) == 0 {
			continue
		}
		if len(identityMatches) != 1 {
			return nil, nil, fmt.Errorf(
				"%w: receipt identity %q matched %d logical messages",
				errNativeEvolutionTransportIdentityConflict,
				identity,
				len(identityMatches),
			)
		}
		target := identityMatches[0]
		if err := target.validateCanonicalIdentity(identity); err != nil {
			return nil, nil, err
		}
		matched[identity] = true
		if _, alreadyResolved := resolvedRows[target.MessageRowID]; alreadyResolved {
			continue
		}
		resolvedRows[target.MessageRowID] = struct{}{}
		resolved = append(resolved, target)
	}
	return resolved, matched, nil
}

func (repo Repository) processNativeEvolutionStatuses(ctx context.Context, item pendingEvolutionWebhook, statuses []nativeEvolutionStatus) error {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	session, err := loadNativeEvolutionSession(ctx, tx, item)
	if err != nil {
		return err
	}
	receiptMessageIDs := make([]string, 0)
	for _, receipt := range statuses {
		receiptMessageIDs = append(receiptMessageIDs, receipt.MessageIDs...)
	}
	// Lock the complete batch once in canonical row order. Per-receipt locking
	// can deadlock when equivalent provider batches arrive in reverse order.
	if err := lockNativeStatusTransportRows(ctx, tx, session, receiptMessageIDs); err != nil {
		return err
	}
	failedOutboxIDs := make([]string, 0)
	failedOutboxSeen := map[string]struct{}{}
	for _, receipt := range statuses {
		// Repeat the canonical outbox -> message acquisition order inside each
		// READ COMMITTED receipt. Rows inserted after the batch pre-lock are then
		// still acquired in the same order as outbox completion/finalization.
		if err := lockNativeStatusTransportRows(ctx, tx, session, receipt.MessageIDs); err != nil {
			return err
		}
		candidates, err := loadNativeStatusTransportTargets(ctx, tx, session, receipt.MessageIDs)
		if err != nil {
			return err
		}
		targets, matched, err := resolveNativeStatusTransportTargets(receipt.MessageIDs, candidates)
		if err != nil {
			return err
		}
		for _, target := range targets {
			status := nativeMonotonicStatus(target.MessageStatus, receipt.Status)
			tag, err := tx.Exec(ctx, `
				update public.whatsapp_messages
				set status = $4,
				    delivered_at = case when $4 = 'delivered' then coalesce(delivered_at, $5) else delivered_at end,
				    read_at = case when $4 = 'read' then coalesce(read_at, $5) else read_at end,
				    updated_at = now()
				where organization_id = $1::uuid
				  and session_id = $2::uuid
				  and id = $3::uuid
				  and conversation_id = $6::uuid
				  and lead_id is not distinct from nullif($7, '')::uuid
				  and coalesce(message_id, '') = $8
				  and coalesce(provider_message_id, '') = $9
				  and coalesce(client_message_id, '') = $10
			`, session.OrganizationID, session.ID, target.MessageRowID, status, receipt.OccurredAt,
				target.ConversationID, target.LeadID, target.MessageID, target.ProviderMessageID, target.ClientMessageID)
			if err != nil {
				return err
			}
			if tag.RowsAffected() != 1 {
				return fmt.Errorf("%w: status message target changed after lock", errNativeEvolutionTransportIdentityConflict)
			}
			if target.OutboxID == "" {
				continue
			}

			outboxStatus := nativeMonotonicOutboxStatus(target.OutboxStatus, receipt.Status)
			tag, err = tx.Exec(ctx, `
				update public.whatsapp_outbox
				set status = $4,
				    sent_at = case when $4 = 'sent' then coalesce(sent_at, $5) else sent_at end,
				    delivered_at = case when $4 = 'delivered' then coalesce(delivered_at, $5) else delivered_at end,
				    read_at = case when $4 = 'read' then coalesce(read_at, $5) else read_at end,
				    failed_at = case when $4 = 'failed' then coalesce(failed_at, $5) else failed_at end,
				    last_error = case
				      when $4 = 'failed' then nullif($6, '')
				      when $4 in ('sent', 'delivered', 'read') then null
				      else last_error
				    end,
				    locked_at = case when $4 in ('sent', 'delivered', 'read', 'failed') then null else locked_at end,
				    locked_by = case when $4 in ('sent', 'delivered', 'read', 'failed') then null else locked_by end,
				    updated_at = now()
				where organization_id = $1::uuid
				  and session_id = $2::uuid
				  and id = $3::uuid
				  and message_id = $7::uuid
				  and conversation_id = $8::uuid
				  and coalesce(provider_message_id, '') = $9
				  and client_message_id = $10
			`, session.OrganizationID, session.ID, target.OutboxID, outboxStatus, receipt.OccurredAt, receipt.Error,
				target.OutboxMessageRowID, target.OutboxConversationID,
				target.OutboxProviderMessageID, target.OutboxClientMessageID)
			if err != nil {
				return err
			}
			if tag.RowsAffected() != 1 {
				return fmt.Errorf("%w: status outbox target changed after lock", errNativeEvolutionTransportIdentityConflict)
			}
			if outboxStatus == "failed" {
				if _, alreadyQueued := failedOutboxSeen[target.OutboxID]; !alreadyQueued {
					failedOutboxSeen[target.OutboxID] = struct{}{}
					failedOutboxIDs = append(failedOutboxIDs, target.OutboxID)
				}
			}
		}

		notificationReceipt := receipt
		notificationReceipt.MessageIDs = make([]string, 0, len(receipt.MessageIDs))
		for _, id := range receipt.MessageIDs {
			if !matched[id] {
				notificationReceipt.MessageIDs = append(notificationReceipt.MessageIDs, id)
			}
		}
		if len(notificationReceipt.MessageIDs) > 0 {
			notificationMatches, err := reconcileNativeNotificationWhatsAppReceipt(
				ctx,
				tx,
				session.OrganizationID,
				notificationReceipt,
			)
			if err != nil {
				return err
			}
			for id := range notificationMatches {
				matched[id] = true
			}
		}

		missing := []string{}
		for _, id := range receipt.MessageIDs {
			if !matched[id] {
				missing = append(missing, id)
			}
		}
		if len(missing) > 0 {
			return fmt.Errorf("message status target not found yet: %s", strings.Join(missing, ","))
		}
	}
	for _, outboxID := range failedOutboxIDs {
		if err := repo.syncTerminalWhatsAppOutboxFailures(ctx, tx, outboxID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func reconcileNativeNotificationWhatsAppReceipt(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	receipt nativeEvolutionStatus,
) (map[string]bool, error) {
	matched := map[string]bool{}
	status := strings.ToLower(strings.TrimSpace(receipt.Status))
	if status != "delivered" && status != "read" && status != "failed" {
		return matched, nil
	}

	for _, messageID := range receipt.MessageIDs {
		messageID = strings.TrimSpace(messageID)
		if messageID == "" {
			continue
		}
		var rawOutcome string
		if err := tx.QueryRow(ctx, `
			select private.reconcile_notification_whatsapp_delivery(
				$1::uuid,
				$2,
				$3,
				$4::timestamptz
			)::text
		`, organizationID, messageID, status, receipt.OccurredAt).Scan(&rawOutcome); err != nil {
			return nil, err
		}

		var result struct {
			Outcome string `json:"outcome"`
		}
		if err := json.Unmarshal([]byte(rawOutcome), &result); err != nil {
			return nil, fmt.Errorf("decode notification WhatsApp receipt outcome: %w", err)
		}
		reconciled, err := nativeNotificationReceiptOutcomeMatched(result.Outcome)
		if err != nil {
			return nil, fmt.Errorf("notification WhatsApp receipt %s: %w", messageID, err)
		}
		if reconciled {
			matched[messageID] = true
		}
	}
	return matched, nil
}

func nativeNotificationReceiptOutcomeMatched(outcome string) (bool, error) {
	switch strings.ToLower(strings.TrimSpace(outcome)) {
	case "applied", "already_applied", "stale":
		return true, nil
	case "not_found", "ambiguous", "invalid_status":
		return false, fmt.Errorf("reconciliation rejected outcome %q", outcome)
	default:
		return false, fmt.Errorf("unexpected reconciliation outcome %q", outcome)
	}
}

func markNativeMatchedIDs(matched map[string]bool, expected []string, actual ...string) {
	for _, candidate := range actual {
		for _, id := range expected {
			if candidate != "" && candidate == id {
				matched[id] = true
			}
		}
	}
}

func nativeEvolutionPreview(message nativeEvolutionMessage) string {
	if message.Content != "" {
		return message.Content
	}
	switch message.MessageType {
	case "image":
		return "Imagem"
	case "video":
		return "Video"
	case "audio":
		return "Audio"
	case "document":
		return "Documento"
	case "sticker":
		return "Figurinha"
	default:
		return "Mensagem"
	}
}

func nativeIsMediaType(messageType string) bool {
	switch messageType {
	case "image", "video", "audio", "document", "sticker":
		return true
	default:
		return false
	}
}

func nativeIsStatusEvent(event string) bool {
	return strings.Contains(event, "status") || strings.Contains(event, "receipt") || strings.Contains(event, "ack")
}

func nativeEvolutionQRCode(payload map[string]any) string {
	return firstNonEmpty(
		firstString(payload, "qrcode", "Qrcode", "qrCode", "base64", "code"),
		firstString(payload, "data.qrcode", "data.Qrcode", "data.qrCode", "data.base64", "data.code"),
		firstString(payload, "Data.qrcode", "Data.Qrcode", "Data.qrCode", "Data.base64", "Data.code"),
	)
}

func nativeEvolutionConnectionStatus(payload map[string]any, event string) (string, bool, string) {
	data := nativeFirstMap(payload, "data", "Data")
	if len(data) == 0 {
		data = payload
	}
	state := strings.ToLower(firstNonEmpty(
		firstString(data, "state", "State", "connectionStatus", "status"),
		firstString(payload, "state", "State", "connectionStatus", "status"),
	))
	loggedIn, loggedInPresent := nativeBool(nativeFirstValue(data, "loggedIn", "LoggedIn"))
	connected, connectedPresent := nativeBool(nativeFirstValue(data, "connected", "Connected"))
	errorMessage := firstString(data, "error", "message", "reason")

	if loggedInPresent && connectedPresent {
		if loggedIn && connected {
			return "connected", true, ""
		}
		if !loggedIn && connected {
			return "qr_ready", true, ""
		}
		return "disconnected", true, errorMessage
	}
	if loggedInPresent {
		if loggedIn {
			return "connected", true, ""
		}
		return "disconnected", true, errorMessage
	}
	if connectedPresent {
		if connected {
			return "connected", true, ""
		}
		return "disconnected", true, errorMessage
	}
	if state == "open" || state == "connected" {
		return "connected", true, ""
	}
	if state == "qr" || state == "qrcode" || state == "qr_ready" || state == "pairing" || state == "connecting" || nativeEvolutionQRCode(payload) != "" {
		return "qr_ready", true, ""
	}
	if strings.Contains(event, "logout") ||
		state == "close" || state == "closed" || state == "disconnected" || state == "offline" || state == "logged_out" {
		return "disconnected", true, errorMessage
	}
	if state == "error" || state == "failed" || state == "failure" {
		return "", true, firstNonEmpty(errorMessage, "Falha na conexao")
	}
	return "", false, ""
}
