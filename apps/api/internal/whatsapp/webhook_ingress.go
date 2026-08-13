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
	"time"

	"github.com/jackc/pgx/v5"
)

var (
	errWebhookUnauthorized    = errors.New("whatsapp webhook unauthorized")
	errWebhookSessionMismatch = errors.New("whatsapp webhook session mismatch")
)

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
	if !session.Active || strings.EqualFold(session.Status, "deleted") {
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

	var receipt evolutionWebhookReceipt
	err = repo.db.Pool().QueryRow(ctx, `
		insert into public.whatsapp_webhook_inbox (
			organization_id,
			session_id,
			provider,
			provider_instance_id,
			event_key,
			event_type,
			payload,
			status,
			next_attempt_at,
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
			'pending',
			now(),
			now() + interval '30 days'
		)
		on conflict (event_key) do nothing
		returning id::text, session_id::text, event_type, status
	`, session.OrganizationID, session.ID, firstNonEmpty(session.InstanceID, session.InstanceName), eventKey, envelope.EventType, string(envelope.Payload)).Scan(
		&receipt.ID,
		&receipt.SessionID,
		&receipt.EventType,
		&receipt.Status,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		receipt.Duplicate = true
		err = repo.db.Pool().QueryRow(ctx, `
			select id::text, session_id::text, event_type, status
			from public.whatsapp_webhook_inbox
			where event_key = $1
			limit 1
		`, eventKey).Scan(&receipt.ID, &receipt.SessionID, &receipt.EventType, &receipt.Status)
	}
	if err != nil {
		return evolutionWebhookReceipt{}, err
	}
	return receipt, nil
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
	_, err := repo.db.Pool().Exec(ctx, `
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
	return err
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
			case "instancetoken", "webhooktoken", "apikey", "accesstoken", "authorization", "signature":
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
	if !session.Active || strings.EqualFold(session.Status, "deleted") {
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
	if !session.Active || strings.EqualFold(session.Status, "deleted") {
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
