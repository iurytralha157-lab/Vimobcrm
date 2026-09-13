package whatsapp

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
)

var (
	errWebhookUnauthorized      = errors.New("whatsapp webhook unauthorized")
	errWebhookSessionMismatch   = errors.New("whatsapp webhook session mismatch")
	errWebhookSchemaUnavailable = errors.New("whatsapp webhook schema unavailable")
)

const evolutionWebhookSchemaCompatibilityQuery = `
	select
		to_regclass('public.whatsapp_webhook_inbox') is not null
		and exists (
			select 1
			from pg_catalog.pg_attribute
			where attrelid = to_regclass('public.whatsapp_webhook_inbox')
			  and attname = 'processing_lane'
			  and attnum > 0
			  and not attisdropped
		)
		and exists (
			select 1
			from pg_catalog.pg_attribute
			where attrelid = to_regclass('public.whatsapp_webhook_inbox')
			  and attname = 'provider_occurred_at'
			  and attnum > 0
			  and not attisdropped
		)
		and coalesce((
			select indisready and indisvalid
			from pg_catalog.pg_index
			where indexrelid = to_regclass('public.whatsapp_webhook_inbox_lane_session_due_head_idx')
		), false)
		and coalesce((
			select indisready and indisvalid
			from pg_catalog.pg_index
			where indexrelid = to_regclass('public.whatsapp_webhook_inbox_session_processing_idx')
		), false)
`

const releaseWhatsAppOutboxRetriesAfterReconnectQuery = `
	update public.whatsapp_outbox
	set next_attempt_at = now(),
	    updated_at = now()
	where organization_id = $1::uuid
	  and session_id = $2::uuid
	  and status = 'retry'
	  and attempts < max_attempts
	  and next_attempt_at > now()
`

type evolutionWebhookSchemaGate struct {
	mu        sync.Mutex
	checkedAt time.Time
	err       error
}

func (repo Repository) ensureEvolutionWebhookSchema(ctx context.Context) error {
	gate := repo.webhookSchemaGate
	if gate == nil {
		gate = &evolutionWebhookSchemaGate{}
	}

	gate.mu.Lock()
	defer gate.mu.Unlock()
	now := time.Now()
	cacheTTL := 5 * time.Minute
	if gate.err != nil {
		cacheTTL = 5 * time.Second
	}
	if !gate.checkedAt.IsZero() && now.Sub(gate.checkedAt) < cacheTTL {
		return gate.err
	}

	checkContext, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	compatible := false
	err := repo.db.Pool().QueryRow(checkContext, evolutionWebhookSchemaCompatibilityQuery).Scan(&compatible)
	if err == nil && !compatible {
		err = fmt.Errorf("%w: required inbox columns or fair-claim indexes are missing", errWebhookSchemaUnavailable)
	} else if err != nil {
		err = fmt.Errorf("%w: %v", errWebhookSchemaUnavailable, err)
	}
	gate.checkedAt = now
	gate.err = err
	return err
}

type evolutionWebhookEnvelope struct {
	SessionID           string
	RouteInstanceID     string
	InstanceID          string
	InstanceName        string
	EventType           string
	InstanceToken       string
	WebhookHeaderTokens []string
	EventKey            string
	Payload             []byte
	ReceivedAt          time.Time
}

type evolutionWebhookReceipt struct {
	ID        string `json:"id"`
	SessionID string `json:"sessionId"`
	EventType string `json:"eventType"`
	Status    string `json:"status"`
	Duplicate bool   `json:"duplicate"`
	Inline    bool   `json:"inline,omitempty"`
}

type evolutionWebhookSession struct {
	ID             string
	OrganizationID string
	InstanceID     string
	InstanceName   string
	InstanceToken  string
	WebhookToken   string
	Status         string
	Active         bool
}

func evolutionWebhookSessionInactive(session evolutionWebhookSession) bool {
	status := strings.ToLower(strings.TrimSpace(session.Status))
	return !session.Active || status == "deleted" || status == "disabled"
}

func (repo Repository) AuthorizeEvolutionWebhookRoute(ctx context.Context, query url.Values, headers http.Header) error {
	if hasEvolutionWebhookQueryCredential(query) {
		return errWebhookUnauthorized
	}
	sessionID := strings.TrimSpace(query.Get("session_id"))
	if _, ok := normalizeUUID(sessionID); !ok {
		return errWebhookUnauthorized
	}
	session, err := repo.evolutionWebhookSession(ctx, sessionID)
	if err != nil {
		return errWebhookUnauthorized
	}
	return authorizeEvolutionWebhookRouteSession(session, evolutionWebhookEnvelope{
		RouteInstanceID:     strings.TrimSpace(query.Get("instance_id")),
		WebhookHeaderTokens: suppliedEvolutionWebhookHeaderTokens(headers),
	})
}

func parseEvolutionWebhookEnvelope(query url.Values, headers http.Header, body []byte) (evolutionWebhookEnvelope, error) {
	if hasEvolutionWebhookQueryCredential(query) {
		return evolutionWebhookEnvelope{}, fmt.Errorf("%w: webhook credentials are not allowed in the URL", ErrInvalidInput)
	}
	payload := map[string]any{}
	if len(body) == 0 || json.Unmarshal(body, &payload) != nil {
		return evolutionWebhookEnvelope{}, fmt.Errorf("%w: webhook payload must be a JSON object", ErrInvalidInput)
	}
	data := mapFromAny(payload["data"])

	envelope := evolutionWebhookEnvelope{
		SessionID: strings.TrimSpace(stringFromAny(firstPresentAny(
			query.Get("session_id"),
			payload["session_id"],
			payload["sessionId"],
			data["session_id"],
			data["sessionId"],
		))),
		RouteInstanceID: strings.TrimSpace(query.Get("instance_id")),
		InstanceID: strings.TrimSpace(stringFromAny(firstPresentAny(
			payload["instance_id"],
			payload["instanceId"],
			payload["instanceID"],
			data["instance_id"],
			data["instanceId"],
			data["instanceID"],
		))),
		InstanceName: strings.TrimSpace(stringFromAny(firstPresentAny(
			query.Get("instance_name"),
			payload["instance_name"],
			payload["instanceName"],
			payload["instance"],
			data["instance_name"],
			data["instanceName"],
			data["instance"],
		))),
		EventType: strings.ToLower(strings.TrimSpace(stringFromAny(firstPresentAny(
			payload["event"],
			payload["type"],
			payload["action"],
			payload["Event"],
			data["event"],
		)))),
		InstanceToken: strings.TrimSpace(stringFromAny(firstPresentAny(
			payload["instanceToken"],
			payload["instance_token"],
			payload["InstanceToken"],
			data["instanceToken"],
			data["instance_token"],
			data["InstanceToken"],
		))),
		WebhookHeaderTokens: suppliedEvolutionWebhookHeaderTokens(headers),
		Payload:             append([]byte(nil), body...),
		ReceivedAt:          time.Now().UTC(),
	}

	if envelope.SessionID == "" {
		return evolutionWebhookEnvelope{}, fmt.Errorf("%w: session_id is required", ErrInvalidInput)
	}
	if _, ok := normalizeUUID(envelope.SessionID); !ok {
		return evolutionWebhookEnvelope{}, fmt.Errorf("%w: session_id is invalid", ErrInvalidInput)
	}
	if envelope.EventType == "" {
		envelope.EventType = "unknown"
	}
	// Preserve the provider payload hash used by the existing deduplication
	// contract while keeping the persisted payload free of credentials.
	envelope.EventKey = evolutionWebhookEventKey(envelope.SessionID, body)
	sanitizedPayload, err := sanitizeEvolutionWebhookPayload(payload)
	if err != nil {
		return evolutionWebhookEnvelope{}, fmt.Errorf("%w: webhook payload could not be sanitized", ErrInvalidInput)
	}
	envelope.Payload = sanitizedPayload
	return envelope, nil
}

func (repo Repository) AcceptEvolutionWebhook(ctx context.Context, envelope evolutionWebhookEnvelope) (evolutionWebhookReceipt, error) {
	session, err := repo.evolutionWebhookSession(ctx, envelope.SessionID)
	if err != nil {
		return evolutionWebhookReceipt{}, err
	}
	if evolutionWebhookSessionInactive(session) {
		return evolutionWebhookReceipt{}, ErrSessionNotFound
	}
	if err := authorizeEvolutionWebhookEnvelopeSession(session, envelope); err != nil {
		return evolutionWebhookReceipt{}, err
	}

	eventKey := strings.TrimSpace(envelope.EventKey)
	if eventKey == "" {
		eventKey = evolutionWebhookEventKey(session.ID, envelope.Payload)
	}
	envelope.EventKey = eventKey
	if evolutionWebhookIsHistorySyncControl(pendingEvolutionWebhook{
		EventType: envelope.EventType,
		Payload:   envelope.Payload,
	}) {
		return evolutionWebhookReceipt{
			ID:        eventKey,
			SessionID: session.ID,
			EventType: envelope.EventType,
			Status:    "processed",
			Inline:    true,
		}, nil
	}
	filteredItem, groupOnly, err := prepareEvolutionWebhookWithoutGroupMessages(pendingEvolutionWebhook{
		EventType: envelope.EventType,
		Payload:   envelope.Payload,
	})
	if err != nil {
		return evolutionWebhookReceipt{}, err
	}
	if groupOnly {
		// Group traffic is outside the CRM lead channel. Acknowledge it only
		// after the session and webhook credentials were validated, but before
		// inserting anything in the durable inbox.
		return evolutionWebhookReceipt{
			ID:        eventKey,
			SessionID: session.ID,
			EventType: envelope.EventType,
			Status:    "processed",
			Inline:    true,
		}, nil
	}
	// A provider normally emits one message per callback. If a version sends a
	// mixed batch, persist only its direct members so a lead is not discarded
	// together with group traffic.
	envelope.Payload = filteredItem.Payload
	inlineState, err := evolutionWebhookInlineSessionState(envelope)
	if err != nil {
		return evolutionWebhookReceipt{}, err
	}
	if inlineState.Handled {
		if err := repo.applyEvolutionWebhookSessionState(ctx, session, inlineState); err != nil {
			return evolutionWebhookReceipt{}, err
		}
		return evolutionWebhookReceipt{
			ID:        eventKey,
			SessionID: session.ID,
			EventType: envelope.EventType,
			Status:    "processed",
			Inline:    true,
		}, nil
	}
	if err := repo.ensureEvolutionWebhookSchema(ctx); err != nil {
		return evolutionWebhookReceipt{}, err
	}
	parts, err := prepareEvolutionWebhookDurableParts(envelope)
	if err != nil {
		return evolutionWebhookReceipt{}, err
	}
	if len(parts) == 0 {
		return evolutionWebhookReceipt{}, fmt.Errorf("prepare Evolution webhook durable delivery: no payload parts")
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return evolutionWebhookReceipt{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Insert the original event key first. Besides preserving the public receipt
	// contract, this is a rolling-deploy fence: if an older API replica already
	// persisted the unsplit callback, this replica must not add derived rows that
	// would process the same provider messages twice.
	first := parts[0]
	var receipt evolutionWebhookReceipt
	var firstCreatedAt time.Time
	err = tx.QueryRow(ctx, `
		insert into public.whatsapp_webhook_inbox (
			organization_id,
			session_id,
			provider,
			provider_instance_id,
			event_key,
			event_type,
			payload,
			processing_lane,
			provider_occurred_at,
			status,
			next_attempt_at,
			created_at,
			expires_at
		)
		values (
			$1::uuid,
			$2::uuid,
			'evolution_go',
			nullif($3, ''),
			$4,
			$5,
			$6::jsonb,
			$7,
			$8,
			'pending',
			now(),
			clock_timestamp(),
			now() + interval '30 days'
		)
		on conflict (event_key) do nothing
		returning id::text, session_id::text, event_type, status, created_at
	`, session.OrganizationID, session.ID, firstNonEmpty(session.InstanceID, session.InstanceName), first.EventKey, first.EventType, string(first.Payload), first.ProcessingLane, first.ProviderOccurredAt).Scan(
		&receipt.ID,
		&receipt.SessionID,
		&receipt.EventType,
		&receipt.Status,
		&firstCreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		receipt.Duplicate = true
		err = tx.QueryRow(ctx, `
			select id::text, session_id::text, event_type, status, created_at
			from public.whatsapp_webhook_inbox
			where organization_id = $1::uuid
			  and session_id = $2::uuid
			  and event_key = $3
			limit 1
		`, session.OrganizationID, session.ID, eventKey).Scan(&receipt.ID, &receipt.SessionID, &receipt.EventType, &receipt.Status, &firstCreatedAt)
	}
	if err != nil {
		return evolutionWebhookReceipt{}, err
	}
	if receipt.Duplicate {
		if err := tx.Commit(ctx); err != nil {
			return evolutionWebhookReceipt{}, err
		}
		return receipt, nil
	}

	if len(parts) > 1 {
		encodedParts, err := json.Marshal(parts[1:])
		if err != nil {
			return evolutionWebhookReceipt{}, fmt.Errorf("encode Evolution webhook batch parts: %w", err)
		}
		if _, err := tx.Exec(ctx, `
			insert into public.whatsapp_webhook_inbox (
				organization_id,
				session_id,
				provider,
				provider_instance_id,
				event_key,
				event_type,
				payload,
				processing_lane,
				provider_occurred_at,
				status,
				next_attempt_at,
				created_at,
				expires_at
			)
			select
				$1::uuid,
				$2::uuid,
				'evolution_go',
				nullif($3, ''),
				part.event_key,
				part.event_type,
				part.payload,
				part.processing_lane,
				part.provider_occurred_at,
				'pending',
				now(),
				$5::timestamptz + (part.ordinal::double precision * interval '1 microsecond'),
				now() + interval '30 days'
			from jsonb_to_recordset($4::jsonb) as part (
				event_key text,
				event_type text,
				payload jsonb,
				processing_lane text,
				provider_occurred_at timestamptz,
				ordinal integer
			)
			order by part.ordinal
			on conflict (event_key) do nothing
		`, session.OrganizationID, session.ID, firstNonEmpty(session.InstanceID, session.InstanceName), string(encodedParts), firstCreatedAt); err != nil {
			return evolutionWebhookReceipt{}, fmt.Errorf("persist Evolution webhook batch parts: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return evolutionWebhookReceipt{}, err
	}
	return receipt, nil
}

const (
	evolutionWebhookLiveWindow       = 10 * time.Minute
	evolutionWebhookMaxSplitMessages = 128
	evolutionWebhookMaxRoutingBytes  = 256
	evolutionWebhookRoutingMetaKey   = "__vimob_ingress"
	evolutionWebhookSessionRoute     = "__session__"
)

type evolutionWebhookDurablePart struct {
	EventKey           string          `json:"event_key"`
	EventType          string          `json:"event_type"`
	Payload            json.RawMessage `json:"payload"`
	ProcessingLane     string          `json:"processing_lane"`
	ProviderOccurredAt *time.Time      `json:"provider_occurred_at"`
	Ordinal            int             `json:"ordinal"`
}

type evolutionWebhookMessageListLocation struct {
	topLevelKey string
	nestedKey   string
	values      []any
}

// prepareEvolutionWebhookDurableParts isolates a provider batch without doing
// provider I/O. Every part remains in the same database transaction, the first
// part keeps the original event key, and later parts receive deterministic
// derived keys. This preserves fast ACK and callback-level deduplication while
// letting a current text use the live lane independently from history/media.
func prepareEvolutionWebhookDurableParts(envelope evolutionWebhookEnvelope) ([]evolutionWebhookDurablePart, error) {
	payloadParts, split, err := splitEvolutionWebhookMessageBatch(envelope.Payload)
	if err != nil {
		return nil, err
	}
	if !split {
		payloadParts = [][]byte{envelope.Payload}
	}

	parts := make([]evolutionWebhookDurablePart, 0, len(payloadParts))
	for index, payloadPart := range payloadParts {
		annotatedPayload, err := annotateEvolutionWebhookRouting(payloadPart)
		if err != nil {
			return nil, fmt.Errorf("annotate Evolution webhook batch part %d: %w", index, err)
		}
		partEnvelope := envelope
		partEnvelope.Payload = annotatedPayload
		lane, occurredAt := evolutionWebhookProcessingLane(partEnvelope)
		partKey := envelope.EventKey
		if index > 0 {
			partKey = evolutionWebhookBatchPartEventKey(envelope.EventKey, index, payloadPart)
		}
		parts = append(parts, evolutionWebhookDurablePart{
			EventKey:           partKey,
			EventType:          envelope.EventType,
			Payload:            json.RawMessage(annotatedPayload),
			ProcessingLane:     lane,
			ProviderOccurredAt: occurredAt,
			Ordinal:            index,
		})
	}
	return parts, nil
}

func splitEvolutionWebhookMessageBatch(payload []byte) ([][]byte, bool, error) {
	decoded, err := decodeNativeEvolutionPayload(payload)
	if err != nil {
		return nil, false, nil
	}
	locations := evolutionWebhookMessageListLocations(decoded)
	if len(locations) != 1 {
		return nil, false, nil
	}
	location := locations[0]
	if len(location.values) < 2 || len(location.values) > evolutionWebhookMaxSplitMessages {
		return nil, false, nil
	}
	if messages := extractNativeEvolutionMessages(decoded); len(messages) != len(location.values) {
		// Fail closed when a provider shape contains wrappers or unknown members.
		// The original callback remains durable as one row; nothing is discarded.
		return nil, false, nil
	}

	parts := make([][]byte, 0, len(location.values))
	for _, value := range location.values {
		clone := cloneEvolutionWebhookMap(decoded)
		if location.nestedKey == "" {
			clone[location.topLevelKey] = []any{value}
		} else {
			container := cloneEvolutionWebhookMap(mapFromAny(clone[location.topLevelKey]))
			if len(container) == 0 {
				return nil, false, nil
			}
			container[location.nestedKey] = []any{value}
			clone[location.topLevelKey] = container
		}
		encoded, err := json.Marshal(clone)
		if err != nil {
			return nil, false, fmt.Errorf("encode Evolution webhook message batch member: %w", err)
		}
		verified, err := decodeNativeEvolutionPayload(encoded)
		if err != nil || len(extractNativeEvolutionMessages(verified)) != 1 {
			return nil, false, nil
		}
		parts = append(parts, encoded)
	}
	return parts, true, nil
}

func evolutionWebhookMessageListLocations(payload map[string]any) []evolutionWebhookMessageListLocation {
	locations := make([]evolutionWebhookMessageListLocation, 0, 2)
	for _, key := range []string{"messages", "Messages", "message", "Message"} {
		if values, ok := payload[key].([]any); ok && len(values) > 0 {
			locations = append(locations, evolutionWebhookMessageListLocation{topLevelKey: key, values: values})
		}
	}
	for _, dataKey := range []string{"data", "Data"} {
		if values, ok := payload[dataKey].([]any); ok && len(values) > 0 {
			locations = append(locations, evolutionWebhookMessageListLocation{topLevelKey: dataKey, values: values})
			continue
		}
		data := mapFromAny(payload[dataKey])
		if len(data) == 0 {
			continue
		}
		for _, key := range []string{"messages", "Messages", "message", "Message"} {
			if values, ok := data[key].([]any); ok && len(values) > 0 {
				locations = append(locations, evolutionWebhookMessageListLocation{topLevelKey: dataKey, nestedKey: key, values: values})
			}
		}
	}
	return locations
}

func cloneEvolutionWebhookMap(payload map[string]any) map[string]any {
	clone := make(map[string]any, len(payload))
	for key, value := range payload {
		clone[key] = value
	}
	return clone
}

func annotateEvolutionWebhookRouting(payload []byte) ([]byte, error) {
	decoded, err := decodeNativeEvolutionPayload(payload)
	if err != nil {
		return nil, err
	}
	delete(decoded, evolutionWebhookRoutingMetaKey)
	decoded[evolutionWebhookRoutingMetaKey] = map[string]any{
		"routing_key": evolutionWebhookPayloadRoutingKey(decoded),
	}
	return json.Marshal(decoded)
}

func evolutionWebhookPayloadRoutingKey(payload map[string]any) string {
	messages := withoutNativeEvolutionGroupMessages(extractNativeEvolutionMessages(payload))
	if len(messages) == 0 {
		return evolutionWebhookSessionRoute
	}
	route := ""
	for _, message := range messages {
		candidate := ""
		// ContactPhone was already normalized by the identity parser. Do not run
		// a bare international number through locale-sensitive canonicalization a
		// second time or two callbacks could receive different ordering keys.
		if phone := normalizeDigits(message.ContactPhone); len(phone) >= 8 && len(phone) <= 20 {
			candidate = "phone:" + phone
		} else if remoteJID := normalizeRemoteAlias(message.RemoteJID); remoteJID != "" && !isOpaqueWhatsAppJID(remoteJID) {
			candidate = "jid:" + remoteJID
		}
		if candidate == "" || len(candidate) > evolutionWebhookMaxRoutingBytes {
			return evolutionWebhookSessionRoute
		}
		if route == "" {
			route = candidate
			continue
		}
		if route != candidate {
			return evolutionWebhookSessionRoute
		}
	}
	return route
}

func evolutionWebhookBatchPartEventKey(eventKey string, index int, payload []byte) string {
	hash := sha256.New()
	_, _ = hash.Write([]byte(eventKey))
	_, _ = hash.Write([]byte{0})
	_, _ = hash.Write([]byte(fmt.Sprintf("%d", index)))
	_, _ = hash.Write([]byte{0})
	_, _ = hash.Write(payload)
	return "evolution_go_part:" + hex.EncodeToString(hash.Sum(nil))
}

func evolutionWebhookProviderPayload(payload []byte) []byte {
	decoded, err := decodeNativeEvolutionPayload(payload)
	if err != nil {
		return payload
	}
	delete(decoded, evolutionWebhookRoutingMetaKey)
	encoded, err := json.Marshal(decoded)
	if err != nil {
		return payload
	}
	return encoded
}

// evolutionWebhookProcessingLane keeps recently-created provider messages out
// of a historical replay backlog. Current media is also live: the native
// processor only persists its placeholder and enqueues an isolated download,
// so a slow video or audio transfer cannot hold the inbox lane. Existing rows
// remain in the backlog lane and no row is discarded: the worker reserves
// capacity for both lanes.
//
// A provider timestamp is mandatory for the live lane. This prevents a delayed
// reconnect replay from entering the live lane merely because it reached the
// API now. Known mixed message arrays are split before this classifier runs; a
// defensive any-current fallback prevents an unknown batch shape from holding
// current text behind historical members.
func evolutionWebhookProcessingLane(envelope evolutionWebhookEnvelope) (string, *time.Time) {
	payload, err := decodeNativeEvolutionPayload(envelope.Payload)
	if err != nil {
		return evolutionWebhookLaneBacklog, nil
	}
	messages := withoutNativeEvolutionHistorySyncControls(extractNativeEvolutionMessages(payload))
	messages = withoutNativeEvolutionGroupMessages(messages)
	if len(messages) == 0 {
		statuses := extractNativeEvolutionStatuses(payload)
		if len(statuses) == 0 {
			return evolutionWebhookLaneBacklog, nil
		}
		providerOccurredAt, present := nativeEvolutionStatusProviderOccurredAt(payload)
		if !present {
			return evolutionWebhookLaneBacklog, nil
		}
		providerOccurredAt = providerOccurredAt.UTC()
		// Delivery receipts are useful, but they must never occupy the lane
		// reserved for lead text. Their provider timestamp remains persisted for
		// diagnostics and eventual backlog ordering.
		return evolutionWebhookLaneBacklog, &providerOccurredAt
	}

	receivedAt := envelope.ReceivedAt.UTC()
	if receivedAt.IsZero() {
		receivedAt = time.Now().UTC()
	}
	var earliestProviderTime *time.Time
	currentLatencyCritical := false
	for _, message := range messages {
		occurredAt, present := nativeEvolutionMessageProviderOccurredAt(message)
		if present {
			occurredAt = occurredAt.UTC()
			if earliestProviderTime == nil || occurredAt.Before(*earliestProviderTime) {
				copyOfOccurredAt := occurredAt
				earliestProviderTime = &copyOfOccurredAt
			}
		}
		if !nativeEvolutionMessageIsLatencyCritical(message) || !present {
			continue
		}
		if evolutionWebhookOccurredInLiveWindow(receivedAt, occurredAt) {
			currentLatencyCritical = true
		}
	}
	if currentLatencyCritical {
		return evolutionWebhookLaneLive, earliestProviderTime
	}
	return evolutionWebhookLaneBacklog, earliestProviderTime
}

func nativeEvolutionMessageIsLatencyCritical(message nativeEvolutionMessage) bool {
	if message.IsGroup ||
		message.UnsupportedID ||
		message.UnsupportedMessage ||
		message.IsReaction ||
		message.IsDeletion {
		return false
	}

	messageType := strings.ToLower(strings.TrimSpace(message.MessageType))
	if nativeIsMediaType(messageType) {
		return true
	}
	return messageType == "text" && strings.TrimSpace(message.Content) != ""
}

func evolutionWebhookOccurredInLiveWindow(receivedAt time.Time, occurredAt time.Time) bool {
	receivedAt = receivedAt.UTC()
	if receivedAt.IsZero() {
		receivedAt = time.Now().UTC()
	}
	occurredAt = occurredAt.UTC()
	return !occurredAt.Before(receivedAt.Add(-evolutionWebhookLiveWindow)) && !occurredAt.After(receivedAt.Add(5*time.Minute))
}

func nativeEvolutionMessageProviderOccurredAt(message nativeEvolutionMessage) (time.Time, bool) {
	info := nativeFirstMap(message.Raw, "Info", "info")
	value := nativeFirstValue(info, "Timestamp", "timestamp")
	if value == nil {
		value = nativeFirstValue(message.Raw, "messageTimestamp", "timestamp", "createdAt", "created_at")
	}
	occurredAt := nativeTimestamp(value)
	return occurredAt, !occurredAt.IsZero()
}

func nativeEvolutionStatusProviderOccurredAt(payload map[string]any) (time.Time, bool) {
	data := nativeFirstValue(payload, "data", "Data")
	dataMap := mapFromAny(data)
	candidates := []any{
		nativeFirstValue(dataMap, "statuses", "Statuses"),
		nativeFirstValue(dataMap, "status", "Status"),
		nativeFirstValue(dataMap, "receipts", "Receipts"),
		data,
	}
	var earliest time.Time
	for _, candidate := range candidates {
		for _, entry := range nativeObjectList(candidate) {
			ids := nativeStringList(nativeFirstValue(entry, "MessageIDs", "messageIds", "message_ids"))
			ids = append(ids, firstString(entry, "messageId", "message_id", "id", "ID", "key.id", "Key.ID"))
			status := nativeProviderStatus(firstNonEmpty(
				firstString(entry, "status", "Status", "state", "State", "ack", "Ack", "type", "Type"),
				firstString(payload, "state", "State", "status", "Status"),
			))
			if len(uniqueStrings(ids...)) == 0 || status == "" {
				continue
			}
			occurredAt := nativeTimestamp(nativeFirstValue(entry, "timestamp", "Timestamp", "time", "date"))
			if occurredAt.IsZero() {
				continue
			}
			if earliest.IsZero() || occurredAt.Before(earliest) {
				earliest = occurredAt
			}
		}
	}
	return earliest, !earliest.IsZero()
}

const (
	evolutionWebhookStateRankQRCode   = 1
	evolutionWebhookStateRankTerminal = 2
)

type evolutionWebhookSessionState struct {
	Handled           bool
	QRCode            string
	Status            string
	ConnectionError   string
	PhoneNumber       string
	ProfileName       string
	OccurredAt        time.Time
	ProviderTimestamp bool
	Rank              int
	EventKey          string
}

func evolutionWebhookInlineSessionState(envelope evolutionWebhookEnvelope) (evolutionWebhookSessionState, error) {
	payload, err := decodeNativeEvolutionPayload(envelope.Payload)
	if err != nil {
		return evolutionWebhookSessionState{}, err
	}
	event := nativeEvolutionEventName(payload, envelope.EventType)
	compactEvent := strings.NewReplacer(".", "", "_", "", "-", "", " ", "").Replace(strings.ToLower(event))
	if compactEvent == "qrtimeout" {
		// QR_TIMEOUT is a provider lifecycle pulse, not a lead message. The
		// provider emits another QRCODE while attempts remain, so persisting every
		// timeout only creates backlog and clearing the current QR here would make
		// the pairing UI flicker between attempts.
		return evolutionWebhookSessionState{Handled: true}, nil
	}
	isSessionEvent := strings.Contains(compactEvent, "connection") ||
		strings.Contains(compactEvent, "instance") ||
		strings.Contains(compactEvent, "session") ||
		compactEvent == "connected" ||
		compactEvent == "disconnected" ||
		compactEvent == "loggedout" ||
		compactEvent == "pairsuccess"

	connectionStatus, connectionRecognized, connectionError := nativeEvolutionConnectionStatus(payload, event)
	if !connectionRecognized {
		switch compactEvent {
		case "connected", "pairsuccess":
			connectionStatus, connectionRecognized = "connected", true
		case "disconnected", "loggedout":
			connectionStatus, connectionRecognized = "disconnected", true
		}
	}
	eventAt, providerTimestamp := evolutionWebhookEventOccurredAt(payload, envelope.ReceivedAt)

	qrCode := nativeEvolutionQRCode(payload)
	isQRCodeEvent := strings.Contains(compactEvent, "qr") ||
		(isSessionEvent && connectionRecognized && connectionStatus == "qr_ready")
	if isQRCodeEvent && strings.TrimSpace(qrCode) != "" {
		return evolutionWebhookSessionState{
			Handled:           true,
			QRCode:            qrCode,
			Status:            "qr_ready",
			OccurredAt:        eventAt,
			ProviderTimestamp: providerTimestamp,
			Rank:              evolutionWebhookStateRankQRCode,
			EventKey:          envelope.EventKey,
		}, nil
	}
	if isSessionEvent && connectionRecognized && connectionStatus != "" && connectionStatus != "qr_ready" {
		// Terminal state retries without a provider timestamp cannot be ordered
		// safely against newer connection events. Keep them in the durable inbox,
		// where event_key deduplication and FIFO processing preserve causality.
		if !providerTimestamp {
			return evolutionWebhookSessionState{}, nil
		}
		data := nativeFirstMap(payload, "data", "Data")
		jid := firstNonEmpty(
			firstString(data, "jid", "JID", "phone", "Phone", "user.id"),
			firstString(payload, "jid", "JID", "phone", "Phone", "user.id"),
		)
		phoneNumber := ""
		if phone, valid := phoneFromIdentityValue(jid); valid {
			phoneNumber = phone
		}
		return evolutionWebhookSessionState{
			Handled:         true,
			Status:          connectionStatus,
			ConnectionError: connectionError,
			PhoneNumber:     phoneNumber,
			ProfileName: firstNonEmpty(
				firstString(data, "pushName", "name", "profileName"),
				firstString(payload, "pushName", "name", "profileName"),
			),
			OccurredAt:        eventAt,
			ProviderTimestamp: providerTimestamp,
			Rank:              evolutionWebhookStateRankTerminal,
			EventKey:          envelope.EventKey,
		}, nil
	}
	return evolutionWebhookSessionState{}, nil
}

func evolutionWebhookEventOccurredAt(payload map[string]any, receivedAt time.Time) (time.Time, bool) {
	if receivedAt.IsZero() {
		receivedAt = time.Now().UTC()
	} else {
		receivedAt = receivedAt.UTC()
	}
	providerTime := nativeTimestamp(nativeFirstValue(
		payload,
		"date_time", "dateTime", "event_time", "eventTime", "event_timestamp", "eventTimestamp", "timestamp", "Timestamp",
		"data.date_time", "data.dateTime", "data.event_time", "data.eventTime", "data.event_timestamp", "data.eventTimestamp",
		"Data.date_time", "Data.dateTime", "Data.event_time", "Data.eventTime", "Data.event_timestamp", "Data.eventTimestamp",
	))
	// A future provider clock must not pin the session state indefinitely.
	if providerTime.IsZero() || providerTime.After(receivedAt.Add(5*time.Minute)) {
		return receivedAt, false
	}
	return providerTime.UTC(), true
}

func evolutionWebhookSessionStateNewer(candidate evolutionWebhookSessionState, current evolutionWebhookSessionState) bool {
	if !candidate.OccurredAt.Equal(current.OccurredAt) {
		return candidate.OccurredAt.After(current.OccurredAt)
	}
	if candidate.Rank != current.Rank {
		return candidate.Rank > current.Rank
	}
	return candidate.EventKey > current.EventKey
}

func (repo Repository) applyEvolutionWebhookSessionState(ctx context.Context, session evolutionWebhookSession, state evolutionWebhookSessionState) error {
	eventMillis := state.OccurredAt.UTC().UnixMilli()
	if state.QRCode != "" {
		_, err := repo.db.Pool().Exec(ctx, `
		update public.whatsapp_sessions
		set status = 'qr_ready',
		    qr_code = $3,
		    advanced_settings = coalesce(advanced_settings, '{}'::jsonb) || jsonb_build_object(
		      'qr_code', $3,
		      'qr_updated_at', to_timestamp($4::double precision / 1000.0),
		      'webhook_state_event_at_ms', $4::bigint,
		      'webhook_state_event_rank', $5::integer,
		      'webhook_state_event_key', $6,
		      'webhook_state_has_provider_timestamp', $7::boolean
		    ),
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and provider = 'evolution_go'
		  and coalesce(is_active, true) = true
		  and coalesce(status, '') <> 'deleted'
		  and coalesce(status, '') <> 'connected'
		  and not (
		    lower(coalesce(advanced_settings->>'auto_reconnect_enabled', 'true')) = 'false'
		    and lower(coalesce(advanced_settings->>'auto_reconnect_blocked_reason', '')) = 'user_logged_out'
		  )
		  and (
		    case
		      when coalesce(advanced_settings->>'webhook_state_event_at_ms', '') ~ '^[0-9]{1,19}$'
		        then (advanced_settings->>'webhook_state_event_at_ms')::bigint
		      else 0::bigint
		    end,
		    case
		      when coalesce(advanced_settings->>'webhook_state_event_rank', '') ~ '^[0-9]{1,3}$'
		        then (advanced_settings->>'webhook_state_event_rank')::integer
		      else 0::integer
		    end,
		    coalesce(advanced_settings->>'webhook_state_event_key', '')
		  ) < ($4::bigint, $5::integer, $6::text)
	`, session.OrganizationID, session.ID, state.QRCode, eventMillis, state.Rank, state.EventKey, state.ProviderTimestamp)
		return err
	}

	if state.Status == "" {
		return nil
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	result, err := tx.Exec(ctx, `
		update public.whatsapp_sessions
		set status = $3,
		    qr_code = null,
		    phone_number = case when $3 = 'connected' then coalesce(nullif($4, ''), phone_number) else phone_number end,
		    profile_name = case when $3 = 'connected' then coalesce(nullif($5, ''), profile_name) else profile_name end,
		    last_connected_at = case when $3 = 'connected' then now() else last_connected_at end,
		    last_error = nullif($6, ''),
		    advanced_settings = (coalesce(advanced_settings, '{}'::jsonb) - 'qr_code' - 'qr_updated_at') || jsonb_build_object(
		      'webhook_state_event_at_ms', $7::bigint,
		      'webhook_state_event_rank', $8::integer,
		      'webhook_state_event_key', $9,
		      'webhook_state_has_provider_timestamp', $10::boolean
		    ),
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and provider = 'evolution_go'
		  and coalesce(is_active, true) = true
		  and coalesce(status, '') <> 'deleted'
		  and (
		    $3 not in ('connected', 'qr_ready')
		    or not (
		      lower(coalesce(advanced_settings->>'auto_reconnect_enabled', 'true')) = 'false'
		      and lower(coalesce(advanced_settings->>'auto_reconnect_blocked_reason', '')) = 'user_logged_out'
		    )
		  )
		  and (
		    case
		      when coalesce(advanced_settings->>'webhook_state_event_at_ms', '') ~ '^[0-9]{1,19}$'
		        then (advanced_settings->>'webhook_state_event_at_ms')::bigint
		      else 0::bigint
		    end,
		    case
		      when coalesce(advanced_settings->>'webhook_state_event_rank', '') ~ '^[0-9]{1,3}$'
		        then (advanced_settings->>'webhook_state_event_rank')::integer
		      else 0::integer
		    end,
		    coalesce(advanced_settings->>'webhook_state_event_key', '')
		  ) < ($7::bigint, $8::integer, $9::text)
	`, session.OrganizationID, session.ID, state.Status, state.PhoneNumber, state.ProfileName, state.ConnectionError, eventMillis, state.Rank, state.EventKey, state.ProviderTimestamp)
	if err != nil {
		return err
	}
	reconnected := state.Status == "connected" && result.RowsAffected() > 0

	// A disconnected provider moves durable sends into retry backoff. Once a
	// newer provider event proves the session connected again, make those rows
	// immediately eligible and wake the worker instead of adding up to five
	// minutes of avoidable post-reconnect latency.
	if reconnected {
		if _, err := tx.Exec(
			ctx,
			releaseWhatsAppOutboxRetriesAfterReconnectQuery,
			session.OrganizationID,
			session.ID,
		); err != nil {
			return fmt.Errorf("release WhatsApp outbox retry after reconnect: %w", err)
		}
		// Only a causally newer, tuple-CAS accepted event may release a
		// definitive-disconnect media fence. An outcome-unknown download keeps
		// its full cooldown because connected does not prove detached work ended.
		// The timestamp condition also protects a quarantine created after this
		// provider event but before its delayed webhook was processed.
		if _, err := tx.Exec(ctx, `
			delete from private.whatsapp_media_session_quarantine
			where session_id = $1::uuid
			  and reason = 'media_provider_disconnected'
			  and updated_at <= $2::timestamptz
		`, session.ID, state.OccurredAt.UTC()); err != nil {
			return fmt.Errorf("release WhatsApp media disconnect quarantine after reconnect: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	if reconnected {
		wakeWhatsAppOutboxWorker()
		wakeWhatsAppMediaWorker()
	}
	return nil
}

func (repo Repository) evolutionWebhookSession(ctx context.Context, sessionID string) (evolutionWebhookSession, error) {
	var session evolutionWebhookSession
	err := repo.db.Pool().QueryRow(ctx, `
		select
			id::text,
			organization_id::text,
			coalesce(instance_id, ''),
			coalesce(instance_name, ''),
			coalesce(advanced_settings->>'token', ''),
			coalesce(advanced_settings->>'webhook_token', ''),
			coalesce(status, ''),
			coalesce(is_active, true)
		from public.whatsapp_sessions
		where id = $1::uuid
		  and provider = 'evolution_go'
		limit 1
	`, sessionID).Scan(
		&session.ID,
		&session.OrganizationID,
		&session.InstanceID,
		&session.InstanceName,
		&session.InstanceToken,
		&session.WebhookToken,
		&session.Status,
		&session.Active,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return evolutionWebhookSession{}, ErrSessionNotFound
	}
	return session, err
}

func evolutionWebhookEventKey(sessionID string, payload []byte) string {
	hash := sha256.New()
	_, _ = hash.Write([]byte(strings.TrimSpace(sessionID)))
	_, _ = hash.Write([]byte{0})
	_, _ = hash.Write(payload)
	return "evolution_go:" + hex.EncodeToString(hash.Sum(nil))
}

func secureWebhookTokenEqual(expected string, actual string) bool {
	expectedHash := sha256.Sum256([]byte(expected))
	actualHash := sha256.Sum256([]byte(actual))
	return subtle.ConstantTimeCompare(expectedHash[:], actualHash[:]) == 1
}

func hasEvolutionWebhookQueryCredential(query url.Values) bool {
	for name := range query {
		if isEvolutionWebhookCredentialName(name) {
			return true
		}
	}
	return false
}

func removeEvolutionWebhookQueryCredentials(query url.Values) {
	for name := range query {
		if isEvolutionWebhookCredentialName(name) {
			query.Del(name)
		}
	}
}

func isEvolutionWebhookCredentialName(name string) bool {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "webhook_token", "apikey", "token":
		return true
	default:
		return false
	}
}

func sanitizeEvolutionWebhookPayload(payload map[string]any) ([]byte, error) {
	removeEvolutionWebhookPayloadCredentials(payload)
	return json.Marshal(payload)
}

func removeEvolutionWebhookPayloadCredentials(value any) {
	switch typed := value.(type) {
	case map[string]any:
		for key, nested := range typed {
			normalized := strings.NewReplacer("_", "", "-", "").Replace(strings.ToLower(strings.TrimSpace(key)))
			switch normalized {
			case "instancetoken", "webhooktoken", "apikey", "accesstoken", "authorization", "signature", "vimobingress":
				delete(typed, key)
				continue
			}
			removeEvolutionWebhookPayloadCredentials(nested)
		}
	case []any:
		for _, nested := range typed {
			removeEvolutionWebhookPayloadCredentials(nested)
		}
	}
}

func suppliedEvolutionWebhookHeaderTokens(headers http.Header) []string {
	tokens := make([]string, 0, 2)
	tokens = append(tokens, headers.Values("x-webhook-token")...)
	tokens = append(tokens, headers.Values("x-evolution-webhook-token")...)
	return tokens
}

func optionalEvolutionWebhookTokensMatch(expected string, candidates []string) bool {
	provided := false
	allMatch := true
	for _, candidate := range candidates {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			continue
		}
		provided = true
		// Do not short-circuit: compare every supplied credential in constant
		// time so a correct header cannot hide a conflicting query token.
		if !secureWebhookTokenEqual(expected, candidate) {
			allMatch = false
		}
	}
	return !provided || (strings.TrimSpace(expected) != "" && allMatch)
}

func authorizeEvolutionWebhookRouteSession(session evolutionWebhookSession, envelope evolutionWebhookEnvelope) error {
	if evolutionWebhookSessionInactive(session) {
		return errWebhookUnauthorized
	}
	if !optionalEvolutionWebhookTokensMatch(session.WebhookToken, envelope.WebhookHeaderTokens) {
		return errWebhookUnauthorized
	}
	if strings.TrimSpace(envelope.RouteInstanceID) == "" {
		return errWebhookSessionMismatch
	}
	if !evolutionWebhookInstanceMatches(session, evolutionWebhookEnvelope{RouteInstanceID: envelope.RouteInstanceID}) {
		return errWebhookSessionMismatch
	}
	return nil
}

func authorizeEvolutionWebhookEnvelopeSession(session evolutionWebhookSession, envelope evolutionWebhookEnvelope) error {
	if evolutionWebhookSessionInactive(session) {
		return errWebhookUnauthorized
	}
	if !optionalEvolutionWebhookTokensMatch(session.WebhookToken, envelope.WebhookHeaderTokens) {
		return errWebhookUnauthorized
	}
	if strings.TrimSpace(session.InstanceToken) == "" ||
		!secureWebhookTokenEqual(session.InstanceToken, strings.TrimSpace(envelope.InstanceToken)) {
		return errWebhookUnauthorized
	}
	if !evolutionWebhookInstanceMatches(session, envelope) {
		return errWebhookSessionMismatch
	}
	return nil
}

func evolutionWebhookInstanceMatches(session evolutionWebhookSession, envelope evolutionWebhookEnvelope) bool {
	expected := []string{session.InstanceID, session.InstanceName}
	return whatsappInstanceCandidatesMatch(expected, []string{envelope.RouteInstanceID}) &&
		whatsappInstanceCandidatesMatch(expected, []string{envelope.InstanceID, envelope.InstanceName})
}

func whatsappInstanceCandidatesMatch(expected []string, incoming []string) bool {
	for _, candidate := range incoming {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			continue
		}
		matched := false
		for _, allowed := range expected {
			if strings.TrimSpace(allowed) != "" && strings.EqualFold(candidate, strings.TrimSpace(allowed)) {
				matched = true
				break
			}
		}
		if !matched {
			return false
		}
	}
	return true
}
