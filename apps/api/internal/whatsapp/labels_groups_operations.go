package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) ListLabels(ctx context.Context, tenantContext tenant.Context, sessionID string) ([]WhatsAppLabel, error) {
	sessionID, ok := normalizeUUID(sessionID)
	if !ok {
		return nil, ErrSessionNotFound
	}
	if _, err := repo.GetSession(ctx, tenantContext, sessionID); err != nil {
		return nil, err
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select id::text, session_id::text, organization_id::text, remote_label_id, name, color, predefined, created_at::text
		from public.whatsapp_labels
		where organization_id = $1::uuid
		  and session_id = $2::uuid
		order by name
	`, tenantContext.OrganizationID, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	labels := []WhatsAppLabel{}
	for rows.Next() {
		label, err := scanWhatsAppLabel(rows)
		if err != nil {
			return nil, err
		}
		labels = append(labels, label)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return labels, nil
}

func (repo Repository) ListChatLabels(ctx context.Context, tenantContext tenant.Context, conversationID string) ([]WhatsAppLabel, error) {
	conversationID, ok := normalizeUUID(conversationID)
	if !ok {
		return nil, ErrConversationNotFound
	}
	if err := repo.ensureCanViewConversation(ctx, tenantContext, conversationID); err != nil {
		return nil, err
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select l.id::text, l.session_id::text, l.organization_id::text, l.remote_label_id, l.name, l.color, l.predefined, l.created_at::text
		from public.whatsapp_chat_labels chat_label
		join public.whatsapp_labels l on l.id = chat_label.label_id
		where chat_label.conversation_id = $1::uuid
		  and l.organization_id = $2::uuid
		order by l.name
	`, conversationID, tenantContext.OrganizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	labels := []WhatsAppLabel{}
	for rows.Next() {
		label, err := scanWhatsAppLabel(rows)
		if err != nil {
			return nil, err
		}
		labels = append(labels, label)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return labels, nil
}

func (repo Repository) SyncLabels(ctx context.Context, tenantContext tenant.Context, sessionID string) (SyncLabelsResponse, error) {
	session, err := repo.GetSession(ctx, tenantContext, sessionID)
	if err != nil {
		return SyncLabelsResponse{}, err
	}

	result, err := repo.functions.invokeEvolution(ctx, "label.list", map[string]any{"session_id": session.ID})
	if err != nil {
		return SyncLabelsResponse{}, err
	}

	rawLabels := extractArray(result, "data", "data.data", "data.labels", "data.data.labels", "labels")
	synced := 0
	for _, raw := range rawLabels {
		label, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		remoteID := firstString(label, "id", "ID", "labelId", "LabelID")
		if remoteID == "" {
			continue
		}
		name := firstString(label, "name", "Name", "label", "Label")
		if name == "" {
			name = "Etiqueta"
		}
		color := normalizeLabelColor(label["color"])
		if color == nil {
			color = normalizeLabelColor(label["Color"])
		}
		if color == nil {
			color = normalizeLabelColor(label["colorIndex"])
		}
		predefined, _ := label["predefined"].(bool)
		if value, ok := label["Predefined"].(bool); ok {
			predefined = value
		}

		_, err := repo.db.Pool().Exec(ctx, `
			insert into public.whatsapp_labels (
				session_id,
				organization_id,
				remote_label_id,
				name,
				color,
				predefined
			)
			values ($1::uuid, $2::uuid, $3, $4, $5, $6::boolean)
			on conflict (session_id, remote_label_id)
			do update set
				name = excluded.name,
				color = excluded.color,
				predefined = excluded.predefined
		`, session.ID, session.OrganizationID, remoteID, name, color, predefined)
		if err != nil {
			return SyncLabelsResponse{}, err
		}
		synced++
	}

	return SyncLabelsResponse{Raw: result["data"], Synced: synced}, nil
}

func (repo Repository) AssignLabel(ctx context.Context, tenantContext tenant.Context, sessionID string, request AssignLabelRequest) (map[string]any, error) {
	session, err := repo.getCanSendSession(ctx, tenantContext, sessionID)
	if err != nil {
		return nil, err
	}
	conversationID, ok := normalizeUUID(request.ConversationID)
	if !ok {
		return nil, ErrConversationNotFound
	}
	if err := repo.ensureCanEditConversation(ctx, tenantContext, conversationID); err != nil {
		return nil, err
	}

	labelID, remoteLabelID, err := repo.resolveLabel(ctx, session.ID, strings.TrimSpace(request.LabelID))
	if err != nil {
		return nil, err
	}
	action := "label.removeChat"
	if request.Add {
		action = "label.addChat"
	}
	result, err := repo.functions.invokeEvolution(ctx, action, map[string]any{
		"session_id": session.ID,
		"body": map[string]any{
			"labelId": remoteLabelID,
			"jid":     request.RemoteJID,
		},
	})
	if err != nil {
		return nil, err
	}

	if request.Add {
		_, err = repo.db.Pool().Exec(ctx, `
			insert into public.whatsapp_chat_labels (conversation_id, label_id)
			values ($1::uuid, $2::uuid)
			on conflict (conversation_id, label_id) do nothing
		`, conversationID, labelID)
	} else {
		_, err = repo.db.Pool().Exec(ctx, `
			delete from public.whatsapp_chat_labels
			where conversation_id = $1::uuid
			  and label_id = $2::uuid
		`, conversationID, labelID)
	}
	if err != nil {
		return nil, err
	}

	return result, nil
}

func (repo Repository) ListGroups(ctx context.Context, tenantContext tenant.Context, sessionID string) ([]WhatsAppGroup, error) {
	sessionID, ok := normalizeUUID(sessionID)
	if !ok {
		return nil, ErrSessionNotFound
	}
	if _, err := repo.GetSession(ctx, tenantContext, sessionID); err != nil {
		return nil, err
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select
			id::text,
			session_id::text,
			organization_id::text,
			group_jid,
			subject,
			description,
			picture_url,
			coalesce(participants, '[]'::jsonb)::text,
			owner_jid,
			coalesce(is_announce, false),
			updated_at::text
		from public.whatsapp_groups
		where organization_id = $1::uuid
		  and session_id = $2::uuid
		order by subject
	`, tenantContext.OrganizationID, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	groups := []WhatsAppGroup{}
	for rows.Next() {
		group, err := scanWhatsAppGroup(rows)
		if err != nil {
			return nil, err
		}
		groups = append(groups, group)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return groups, nil
}

func (repo Repository) SyncGroups(ctx context.Context, tenantContext tenant.Context, sessionID string) (map[string]any, error) {
	session, err := repo.GetSession(ctx, tenantContext, sessionID)
	if err != nil {
		return nil, err
	}

	return repo.functions.invokeEvolution(ctx, "group.myAll", map[string]any{"session_id": session.ID})
}

func (repo Repository) GroupInfo(ctx context.Context, tenantContext tenant.Context, sessionID string, jid string) (map[string]any, error) {
	session, err := repo.GetSession(ctx, tenantContext, sessionID)
	if err != nil {
		return nil, err
	}

	return repo.functions.invokeEvolution(ctx, "group.info", map[string]any{
		"session_id": session.ID,
		"body":       map[string]any{"jid": jid, "groupJid": jid},
	})
}

func (repo Repository) GroupInviteLink(ctx context.Context, tenantContext tenant.Context, sessionID string, jid string) (map[string]any, error) {
	session, err := repo.GetSession(ctx, tenantContext, sessionID)
	if err != nil {
		return nil, err
	}

	return repo.functions.invokeEvolution(ctx, "group.inviteLink", map[string]any{
		"session_id": session.ID,
		"body":       map[string]any{"jid": jid},
	})
}

func (repo Repository) UpdateGroup(ctx context.Context, tenantContext tenant.Context, sessionID string, request UpdateGroupRequest) (map[string]any, error) {
	session, err := repo.getCanSendSession(ctx, tenantContext, sessionID)
	if err != nil {
		return nil, err
	}

	actionByField := map[string]string{
		"name":        "group.setName",
		"description": "group.setDescription",
		"photo":       "group.setPhoto",
	}
	action := actionByField[request.Field]
	if action == "" {
		return nil, fmt.Errorf("%w: field is invalid", ErrInvalidInput)
	}

	return repo.functions.invokeEvolution(ctx, action, map[string]any{
		"session_id": session.ID,
		"body":       map[string]any{"jid": request.JID, "value": request.Value},
	})
}

func (repo Repository) CheckNumbers(ctx context.Context, tenantContext tenant.Context, sessionID string, numbers []string) (map[string]any, error) {
	session, err := repo.GetSession(ctx, tenantContext, sessionID)
	if err != nil {
		return nil, err
	}

	return repo.functions.invokeEvolution(ctx, "user.check", map[string]any{
		"session_id": session.ID,
		"body":       map[string]any{"numbers": numbers},
	})
}

func (repo Repository) FetchAvatar(ctx context.Context, tenantContext tenant.Context, sessionID string, jid string) (map[string]any, error) {
	session, err := repo.GetSession(ctx, tenantContext, sessionID)
	if err != nil {
		return nil, err
	}

	return repo.functions.invokeEvolution(ctx, "user.avatar", map[string]any{
		"session_id": session.ID,
		"body":       map[string]any{"jid": jid, "number": strings.NewReplacer("@c.us", "", "@s.whatsapp.net", "", "@g.us", "").Replace(jid), "preview": true},
	})
}

func (repo Repository) SyncContactsAvatars(ctx context.Context, tenantContext tenant.Context, sessionID string) (map[string]any, error) {
	session, err := repo.GetSession(ctx, tenantContext, sessionID)
	if err != nil {
		return nil, err
	}

	return repo.functions.invoke(ctx, "sync-whatsapp-contacts", map[string]any{"session_id": session.ID})
}

func (repo Repository) HistorySync(ctx context.Context, tenantContext tenant.Context, sessionID string, jid string) (map[string]any, error) {
	session, err := repo.GetSession(ctx, tenantContext, sessionID)
	if err != nil {
		return nil, err
	}

	body := map[string]any{}
	if strings.TrimSpace(jid) != "" {
		body["jid"] = strings.TrimSpace(jid)
	}

	return repo.functions.invokeEvolution(ctx, "chat.historySync", map[string]any{
		"session_id": session.ID,
		"body":       body,
	})
}

func (repo Repository) RunProviderAction(ctx context.Context, tenantContext tenant.Context, request ProviderActionRequest) (ProviderActionResponse, error) {
	action := strings.TrimSpace(request.Action)
	requireSend, allowed := providerActionAllowed(action)
	if !allowed {
		return ProviderActionResponse{}, fmt.Errorf("%w: provider action is not allowed", ErrInvalidInput)
	}

	var session Session
	var err error
	if requireSend {
		session, err = repo.getCanSendSession(ctx, tenantContext, request.SessionID)
	} else {
		session, err = repo.GetSession(ctx, tenantContext, request.SessionID)
	}
	if err != nil {
		return ProviderActionResponse{}, err
	}

	payload := map[string]any{"session_id": session.ID}
	if request.InstanceID != "" {
		payload["instance_id"] = request.InstanceID
	}
	if request.Body != nil {
		payload["body"] = request.Body
	}

	result, err := repo.functions.invokeEvolution(ctx, action, payload)
	if err != nil {
		return ProviderActionResponse{}, err
	}

	return ProviderActionResponse{OK: true, Data: result["data"]}, nil
}

func scanWhatsAppLabel(row scanner) (WhatsAppLabel, error) {
	var label WhatsAppLabel
	var color pgtype.Int4
	if err := row.Scan(
		&label.ID,
		&label.SessionID,
		&label.OrganizationID,
		&label.RemoteLabelID,
		&label.Name,
		&color,
		&label.Predefined,
		&label.CreatedAt,
	); err != nil {
		return WhatsAppLabel{}, err
	}
	if color.Valid {
		value := int(color.Int32)
		label.Color = &value
	}

	return label, nil
}

func scanWhatsAppGroup(row scanner) (WhatsAppGroup, error) {
	var group WhatsAppGroup
	var subject, description, pictureURL, ownerJID pgtype.Text
	var participantsJSON string
	if err := row.Scan(
		&group.ID,
		&group.SessionID,
		&group.OrganizationID,
		&group.GroupJID,
		&subject,
		&description,
		&pictureURL,
		&participantsJSON,
		&ownerJID,
		&group.IsAnnounce,
		&group.UpdatedAt,
	); err != nil {
		return WhatsAppGroup{}, err
	}

	group.Subject = textPtr(subject)
	group.Description = textPtr(description)
	group.PictureURL = textPtr(pictureURL)
	group.OwnerJID = textPtr(ownerJID)
	group.Participants = []any{}
	_ = json.Unmarshal([]byte(participantsJSON), &group.Participants)

	return group, nil
}

func (repo Repository) resolveLabel(ctx context.Context, sessionID string, labelID string) (string, string, error) {
	if strings.TrimSpace(labelID) == "" {
		return "", "", fmt.Errorf("%w: labelId is required", ErrInvalidInput)
	}

	var id, remoteID string
	var err error
	if normalized, ok := normalizeUUID(labelID); ok {
		err = repo.db.Pool().QueryRow(ctx, `
			select id::text, remote_label_id
			from public.whatsapp_labels
			where session_id = $1::uuid
			  and (id = $2::uuid or remote_label_id = $3)
			limit 1
		`, sessionID, normalized, labelID).Scan(&id, &remoteID)
	} else {
		err = repo.db.Pool().QueryRow(ctx, `
			select id::text, remote_label_id
			from public.whatsapp_labels
			where session_id = $1::uuid
			  and remote_label_id = $2
			limit 1
		`, sessionID, labelID).Scan(&id, &remoteID)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return labelID, labelID, nil
	}
	if err != nil {
		return "", "", err
	}

	return id, remoteID, nil
}

func extractArray(result map[string]any, paths ...string) []any {
	for _, path := range paths {
		current := any(result)
		for _, key := range strings.Split(path, ".") {
			object, ok := current.(map[string]any)
			if !ok {
				current = nil
				break
			}
			current = object[key]
		}
		if items, ok := current.([]any); ok {
			return items
		}
	}

	return []any{}
}

func normalizeLabelColor(value any) *int {
	switch typed := value.(type) {
	case float64:
		parsed := int(typed)
		return &parsed
	case int:
		return &typed
	case string:
		var parsed int
		if _, err := fmt.Sscanf(typed, "%d", &parsed); err == nil {
			return &parsed
		}
	}

	return nil
}

func providerActionAllowed(action string) (requireSend bool, allowed bool) {
	viewActions := map[string]struct{}{
		"instance.status":  {},
		"instance.qr":      {},
		"label.list":       {},
		"group.myAll":      {},
		"group.info":       {},
		"group.inviteLink": {},
		"user.check":       {},
		"user.avatar":      {},
		"user.contacts":    {},
		"chat.historySync": {},
	}
	sendActions := map[string]struct{}{
		"send.text":            {},
		"send.media":           {},
		"send.audio":           {},
		"chat.archive":         {},
		"chat.mute":            {},
		"chat.pin":             {},
		"label.addChat":        {},
		"label.removeChat":     {},
		"group.setName":        {},
		"group.setDescription": {},
		"group.setPhoto":       {},
		"message.markread":     {},
		"message.delete":       {},
		"message.edit":         {},
		"message.react":        {},
	}
	if _, ok := viewActions[action]; ok {
		return false, true
	}
	if _, ok := sendActions[action]; ok {
		return true, true
	}

	return false, false
}

var _ = tenant.Context{}
