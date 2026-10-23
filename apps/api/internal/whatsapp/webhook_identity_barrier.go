package whatsapp

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"
)

const whatsappPNConflictReason = "whatsapp_contact_pn_conflict"
const whatsappPNRouteConflictReason = "whatsapp_contact_pn_route_conflict"

func isWhatsAppContactPNConflictError(err error) bool {
	if errors.Is(err, errNativeStoredContactPNConflict) {
		return true
	}
	var pgerr *pgconn.PgError
	return errors.As(err, &pgerr) && pgerr.Code == "23514" && pgerr.Message == whatsappPNConflictReason
}

func nativeWebhookQuarantinedIDs(payload map[string]any) []string {
	metadata := mapFromAny(payload[evolutionWebhookRoutingMetaKey])
	if stringFromAny(metadata["identity_quarantine_reason"]) != whatsappPNRouteConflictReason {
		return nil
	}
	var ids []string
	values, _ := metadata["identity_quarantined_provider_message_ids"].([]any)
	for _, value := range values {
		id := stringFromAny(value)
		if id != "" && len(id) <= 200 && !strings.ContainsAny(id, "\r\n\x00") {
			ids = append(ids, id)
		}
	}
	return uniqueStrings(ids...)
}

func withoutNativeWebhookQuarantinedMessages(payload map[string]any, messages []nativeEvolutionMessage) []nativeEvolutionMessage {
	ids := nativeWebhookQuarantinedIDs(payload)
	if len(ids) == 0 {
		return messages
	}
	result := make([]nativeEvolutionMessage, 0, len(messages))
	for _, message := range messages {
		if !containsNativeString(ids, message.ProviderMessageID) {
			result = append(result, message)
		}
	}
	return result
}

func containsNativeString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

// A provider cannot supply these hints: Go replaces ingress metadata before
// admission. Retained legacy payloads also require the distinct admission-only
// ledger reason; the worker's raw-PN classifier cannot manufacture this proof.
func (repo Repository) verifyWebhookPNRouteQuarantine(ctx context.Context, item pendingEvolutionWebhook) error {
	payload, err := decodeNativeEvolutionPayload(item.Payload)
	if err != nil || len(nativeWebhookQuarantinedIDs(payload)) == 0 {
		return nil
	}
	var trusted bool
	err = repo.db.Pool().QueryRow(ctx, `select exists(select 1 from public.whatsapp_webhook_inbox inbox
	 join private.whatsapp_webhook_ignored_events ignored on ignored.organization_id=inbox.organization_id
	 and ignored.session_id=inbox.session_id and ignored.event_key=inbox.event_key
	 where inbox.id=$1::uuid and inbox.organization_id=$2::uuid and inbox.session_id=$3::uuid
	 and ignored.reason=$4 and inbox.payload #>> '{__vimob_ingress,identity_quarantine_reason}'=$4
	 and inbox.payload #> '{__vimob_ingress,identity_quarantined_provider_message_ids}'=$5::jsonb)`,
		item.ID, item.OrganizationID, item.SessionID, whatsappPNRouteConflictReason,
		jsonb(mapFromAny(payload[evolutionWebhookRoutingMetaKey])["identity_quarantined_provider_message_ids"])).Scan(&trusted)
	if err != nil {
		return err
	}
	if !trusted {
		return errors.New("untrusted WhatsApp PN route quarantine metadata")
	}
	return nil
}

func canonicalContactLookupValues(phone string, values ...string) []string {
	result := append([]string{}, values...)
	if phone != "" {
		result = append([]string{"+" + phone}, result...)
	}
	for i, value := range result {
		if phone != "" && !strings.Contains(value, "@") && !strings.HasPrefix(strings.TrimSpace(value), "+") &&
			!strings.HasPrefix(strings.TrimSpace(value), "00") && normalizeDigits(value) == phone {
			result[i] = "+" + phone
		}
	}
	return uniqueStrings(result...)
}

func nativeContactPhoneCandidates(message nativeEvolutionMessage) []string {
	return phoneMatchCandidates(canonicalContactLookupValues(message.ContactPhone, message.RemoteAliases...)...)
}

// A PN hint is evidence of the contact, not permission to merge two unrelated
// phone identities. LIDs remain opaque; the BR ninth-digit alias is equivalent.
func whatsAppContactPNConflict(values ...string) bool {
	key := ""
	referencePhone := ""
	for _, value := range values {
		raw := strings.ToLower(strings.TrimSpace(value))
		if strings.HasSuffix(raw, "@s.whatsapp.net") || strings.HasSuffix(raw, "@c.us") {
			if phone, ok := phoneFromIdentityValue(raw); ok {
				referencePhone = phone
				break
			}
		}
	}
	for _, value := range values {
		candidate := whatsAppContactPNKey(value)
		if referencePhone != "" && !strings.Contains(value, "@") && !strings.HasPrefix(strings.TrimSpace(value), "+") &&
			!strings.HasPrefix(strings.TrimSpace(value), "00") && normalizeDigits(value) == referencePhone {
			candidate = whatsAppContactPNKey(referencePhone + "@s.whatsapp.net")
		}
		if candidate == "" {
			continue
		}
		if key != "" && key != candidate {
			return true
		}
		key = candidate
	}
	return false
}

func whatsAppContactPNKey(value string) string {
	raw := strings.ToLower(strings.TrimSpace(value))
	if at := strings.Index(raw, "@"); at >= 0 {
		if domain := raw[at+1:]; domain != "s.whatsapp.net" && domain != "c.us" {
			return ""
		}
	}
	phone, ok := phoneFromIdentityValue(raw)
	if !ok || len(phone) < 8 || len(phone) > 15 {
		return ""
	}
	if strings.HasPrefix(phone, "55") && len(phone) == 13 && phone[4] == '9' {
		phone = phone[:4] + phone[5:]
	}
	return phone
}

func nativeContactPNConflict(raw, info, key map[string]any, fromMe bool) bool {
	values := []string{}
	appendFields := func(object map[string]any, fields ...string) {
		for _, field := range fields {
			values = append(values, firstString(object, field))
		}
	}
	appendFields(key, "remoteJid", "RemoteJID", "remote_jid")
	appendFields(raw, "remoteJid", "remote_jid", "chat", "chatId", "chatJid", "chat_jid", "jid")
	appendFields(info, "Chat", "chat", "JID", "jid")
	if fromMe {
		appendFields(info, "RecipientPN", "recipientPN", "RecipientPn", "Recipient", "recipient", "RecipientAlt", "recipientAlt")
		appendFields(raw, "recipient", "recipientJid", "to", "phone", "number")
		appendFields(nativeFirstMap(info, "DeviceSentMeta", "deviceSentMeta"), "DestinationJID", "destinationJID")
	} else {
		appendFields(info, "SenderPN", "senderPN", "SenderPn", "Sender", "sender", "SenderAlt", "senderAlt")
		appendFields(raw, "sender", "senderJid", "from", "phone", "number")
	}
	return whatsAppContactPNConflict(values...)
}

func withoutNativeEvolutionPNConflicts(messages []nativeEvolutionMessage) []nativeEvolutionMessage {
	result := make([]nativeEvolutionMessage, 0, len(messages))
	for _, message := range messages {
		if !message.IdentityPNConflict {
			result = append(result, message)
		}
	}
	return result
}

func (repo Repository) recordWebhookContactPNQuarantine(ctx context.Context, item pendingEvolutionWebhook) error {
	payload, err := decodeNativeEvolutionPayload(item.Payload)
	if err != nil {
		return nil
	} // The normal decoder owns malformed callbacks.
	event := nativeEvolutionEventName(payload, item.EventType)
	if nativeIsStatusEvent(event) || nativeEvolutionMessageUpdateIsReceipt(event, payload, extractNativeEvolutionStatuses(payload)) {
		return nil
	}
	for _, message := range extractNativeEvolutionMessages(payload) {
		if !message.IdentityPNConflict {
			continue
		}
		_, err := repo.db.Pool().Exec(ctx, `insert into private.whatsapp_webhook_ignored_events
			(organization_id,session_id,event_key,reason)
			select organization_id,session_id,event_key,$4 from public.whatsapp_webhook_inbox
			where organization_id=$1::uuid and session_id=$2::uuid and id=$3::uuid
			on conflict(organization_id,session_id,event_key) do nothing`, item.OrganizationID, item.SessionID, item.ID, whatsappPNConflictReason)
		return err
	}
	return nil
}
