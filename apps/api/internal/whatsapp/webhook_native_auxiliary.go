package whatsapp

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
)

// Label and group callbacks only update session-scoped metadata. They must
// never consume a mixed envelope that could contain a customer message.
func nativeEvolutionAuxiliaryKinds(payload map[string]any, event string) (labels, groups bool) {
	for _, part := range strings.FieldsFunc(strings.ToLower(event), func(r rune) bool {
		return r == '.' || r == '_' || r == '-' || r == ' ' || r == '/'
	}) {
		switch part {
		case "message", "messages", "reaction", "reactions", "receipt", "receipts", "ack", "status", "statuses":
			return false, false
		case "label", "labels":
			labels = true
		case "group", "groups":
			groups = true
		}
	}
	if (!labels && !groups) || nativeEvolutionAuxiliaryHasMessages(payload) {
		return false, false
	}
	return labels, groups
}

func nativeEvolutionAuxiliaryHasMessages(payload map[string]any) bool {
	for _, path := range []string{
		"message", "Message", "messages", "Messages",
		"data.message", "data.Message", "data.messages", "data.Messages",
		"Data.message", "Data.Message", "Data.messages", "Data.Messages",
		"__vimob_ingress.routing_snapshot.messages",
	} {
		if nativeEvolutionAuxiliaryNonempty(nativeValueAt(payload, path)) {
			return true
		}
	}
	return false
}

func nativeEvolutionAuxiliaryNonempty(value any) bool {
	switch typed := value.(type) {
	case nil:
		return false
	case []any:
		return len(typed) > 0
	case map[string]any:
		return len(typed) > 0
	case string:
		return strings.TrimSpace(typed) != ""
	default:
		return true
	}
}

func nativeEvolutionNamedObjects(payload map[string]any, names ...string) []map[string]any {
	data := nativeFirstMap(payload, "data", "Data")
	result := make([]map[string]any, 0)
	for _, name := range names {
		capitalized := strings.ToUpper(name[:1]) + name[1:]
		for _, value := range []any{
			payload[name], payload[capitalized], data[name], data[capitalized],
		} {
			result = append(result, nativeObjectList(value)...)
		}
	}
	return result
}

func nativeEvolutionLabelColor(label map[string]any) *int32 {
	for _, value := range []any{label["color"], label["Color"], label["colorIndex"]} {
		var parsed int64
		switch typed := value.(type) {
		case float64:
			if math.Trunc(typed) != typed || typed < math.MinInt32 || typed > math.MaxInt32 {
				continue
			}
			parsed = int64(typed)
		case int:
			parsed = int64(typed)
		case string:
			var err error
			parsed, err = strconv.ParseInt(strings.TrimSpace(typed), 10, 32)
			if err != nil {
				continue
			}
		default:
			continue
		}
		if parsed >= math.MinInt32 && parsed <= math.MaxInt32 {
			color := int32(parsed)
			return &color
		}
	}
	return nil
}

func nativeEvolutionAuxiliaryJID(value string, forceGroup bool) string {
	raw := strings.TrimSpace(value)
	if raw == "" {
		return ""
	}
	if left, domain, hasDomain := strings.Cut(raw, "@"); hasDomain {
		if device, instance, hasDevice := strings.Cut(left, ":"); hasDevice && device != "" && instance != "" &&
			normalizeDigits(device) == device && normalizeDigits(instance) == instance {
			left = device
		}
		domain = strings.ToLower(domain)
		if domain == "c.us" {
			domain = "s.whatsapp.net"
		}
		return left + "@" + domain
	}
	if digits := normalizeDigits(raw); digits != "" {
		if forceGroup {
			return digits + "@g.us"
		}
		return digits + "@s.whatsapp.net"
	}
	return raw
}

func (repo Repository) processNativeEvolutionAuxiliary(
	ctx context.Context,
	item pendingEvolutionWebhook,
	payload map[string]any,
	labels, groups bool,
) (bool, error) {
	labelRows := []map[string]any(nil)
	groupRows := []map[string]any(nil)
	if labels {
		labelRows = nativeEvolutionNamedObjects(payload, "labels", "label")
	}
	if groups {
		groupRows = nativeEvolutionNamedObjects(payload, "groups", "group")
	}
	if len(labelRows) == 0 && len(groupRows) == 0 {
		return false, nil
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return true, err
	}
	defer tx.Rollback(ctx)
	session, err := loadNativeEvolutionSession(ctx, tx, item)
	if err != nil {
		return true, err
	}
	processed := 0
	for _, label := range labelRows {
		stored, err := upsertNativeEvolutionLabel(ctx, tx, session, label)
		if err != nil {
			return true, err
		}
		if stored {
			processed++
		}
	}
	for _, group := range groupRows {
		stored, err := upsertNativeEvolutionGroup(ctx, tx, session, group)
		if err != nil {
			return true, err
		}
		if stored {
			processed++
		}
	}
	if processed == 0 {
		return false, nil
	}
	if err := tx.Commit(ctx); err != nil {
		return true, err
	}
	return true, nil
}

func upsertNativeEvolutionLabel(ctx context.Context, tx pgx.Tx, session nativeEvolutionSession, label map[string]any) (bool, error) {
	remoteID := strings.TrimSpace(firstString(label, "id", "ID", "labelId", "LabelID"))
	name := strings.TrimSpace(firstString(label, "name", "Name", "text", "label"))
	if remoteID == "" && name == "" {
		return false, nil
	}
	if remoteID == "" {
		remoteID = name
	}
	if name == "" {
		name = remoteID
	}
	predefined, _ := nativeBool(nativeFirstValue(label, "predefined"))
	var color any
	if parsed := nativeEvolutionLabelColor(label); parsed != nil {
		color = *parsed
	}
	tag, err := tx.Exec(ctx, `
		insert into public.whatsapp_labels (
			organization_id, session_id, remote_label_id, name, color, predefined
		) values ($1::uuid, $2::uuid, $3, $4, $5::integer, $6::boolean)
		on conflict (session_id, remote_label_id) do update set
			name = excluded.name,
			color = excluded.color,
			predefined = excluded.predefined
		where public.whatsapp_labels.organization_id = excluded.organization_id
	`, session.OrganizationID, session.ID, remoteID, name, color, predefined)
	if err != nil {
		return false, err
	}
	if tag.RowsAffected() != 1 {
		return false, fmt.Errorf("native label tenant scope mismatch")
	}
	return true, nil
}

func upsertNativeEvolutionGroup(ctx context.Context, tx pgx.Tx, session nativeEvolutionSession, group map[string]any) (bool, error) {
	jid := nativeEvolutionAuxiliaryJID(firstString(group, "id", "jid", "groupJid", "remoteJid"), true)
	if jid == "" {
		return false, nil
	}
	name := strings.TrimSpace(firstString(group, "name", "subject", "Subject"))
	if name == "" {
		name = "Grupo WhatsApp"
	}
	subject := strings.TrimSpace(firstString(group, "subject", "Subject", "name"))
	if subject == "" {
		subject = "Grupo WhatsApp"
	}
	participants, ok := group["participants"].([]any)
	if !ok {
		participants = []any{}
	}
	participantsJSON, err := json.Marshal(participants)
	if err != nil {
		return false, err
	}
	metadataJSON, err := json.Marshal(map[string]any{"raw": group})
	if err != nil {
		return false, err
	}
	owner := nativeEvolutionAuxiliaryJID(firstString(group, "owner", "ownerJid"), false)
	announce, _ := nativeBool(nativeFirstValue(group, "isAnnounce", "announce"))
	_, err = tx.Exec(ctx, `
		insert into public.whatsapp_groups (
			organization_id, session_id, remote_jid, group_jid, name, subject,
			description, picture_url, invite_link, participants, owner_jid, is_announce, metadata
		) values (
			$1::uuid, $2::uuid, $3, $3, $4, $5,
			nullif($6, ''), nullif($7, ''), nullif($8, ''), $9::jsonb, nullif($10, ''), $11::boolean, $12::jsonb
		)
		on conflict (organization_id, session_id, remote_jid) do update set
			group_jid = excluded.group_jid,
			name = excluded.name,
			subject = excluded.subject,
			description = excluded.description,
			picture_url = excluded.picture_url,
			invite_link = excluded.invite_link,
			participants = excluded.participants,
			owner_jid = excluded.owner_jid,
			is_announce = excluded.is_announce,
			metadata = excluded.metadata,
			updated_at = now()
	`, session.OrganizationID, session.ID, jid, name, subject,
		strings.TrimSpace(firstString(group, "description", "desc")),
		strings.TrimSpace(firstString(group, "pictureUrl", "profilePicture", "avatar")),
		strings.TrimSpace(firstString(group, "inviteLink", "invite_link")),
		string(participantsJSON), owner, announce, string(metadataJSON))
	if err != nil {
		return false, err
	}
	_, err = tx.Exec(ctx, `
		update public.whatsapp_conversations
		set contact_name = $4,
		    contact_picture = nullif($5, '')
		where organization_id = $1::uuid
		  and session_id = $2::uuid
		  and remote_jid = $3
		  and is_group = true
	`, session.OrganizationID, session.ID, jid, name,
		strings.TrimSpace(firstString(group, "pictureUrl", "profilePicture", "avatar")))
	return true, err
}
