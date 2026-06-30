package whatsapp

import (
	"context"
	"crypto/subtle"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/ai"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const autoReplyClientMessagePrefix = "ai-"

type aiRunner interface {
	Run(context.Context, tenant.Context, ai.RunRequest) (ai.RunResponse, error)
}

type AutoReplyRequest struct {
	OrganizationID    string `json:"organizationId"`
	SessionID         string `json:"sessionId"`
	ConversationID    string `json:"conversationId"`
	MessageID         string `json:"messageId"`
	ProviderMessageID string `json:"providerMessageId,omitempty"`
	Text              string `json:"text,omitempty"`
}

type AutoReplyResponse struct {
	OK              bool            `json:"ok"`
	Skipped         bool            `json:"skipped,omitempty"`
	Reason          string          `json:"reason,omitempty"`
	ConversationID  string          `json:"conversationId,omitempty"`
	ClientMessageID string          `json:"clientMessageId,omitempty"`
	Output          string          `json:"output,omitempty"`
	Agent           ai.AgentSummary `json:"agent,omitempty"`
}

type autoReplyInput struct {
	OrganizationID string
	SessionID      string
	ConversationID string
	MessageID      string
	Text           string
}

type autoReplyContext struct {
	Tenant       tenant.Context
	Session      Session
	Conversation Conversation
	Message      Message
	AgentID      string
}

func (handler Handler) WithAutoReply(runner aiRunner, token string) Handler {
	handler.aiRunner = runner
	handler.autoReplyToken = strings.TrimSpace(token)
	return handler
}

func (handler Handler) AutoReply(w http.ResponseWriter, r *http.Request) {
	if handler.autoReplyToken == "" {
		httpserver.WriteError(w, r, http.StatusServiceUnavailable, "ai_autoreply_disabled", "AI auto-reply is not configured.")
		return
	}
	if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Internal-Token")), []byte(handler.autoReplyToken)) != 1 {
		httpserver.WriteError(w, r, http.StatusUnauthorized, "invalid_internal_token", "Internal token is invalid.")
		return
	}
	if handler.aiRunner == nil {
		httpserver.WriteError(w, r, http.StatusServiceUnavailable, "ai_autoreply_disabled", "AI auto-reply runner is not configured.")
		return
	}

	var request AutoReplyRequest
	if !decodeWhatsAppJSON(w, r, &request, 1<<16) {
		return
	}
	input, err := request.validate()
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	replyContext, err := handler.repo.loadAutoReplyContext(r.Context(), input)
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}
	if reason := replyContext.skipReason(); reason != "" {
		httpserver.WriteJSON(w, http.StatusOK, AutoReplyResponse{OK: true, Skipped: true, Reason: reason})
		return
	}
	if exists, err := handler.repo.autoReplyExists(r.Context(), replyContext); err != nil {
		writeWhatsAppError(w, r, err)
		return
	} else if exists {
		httpserver.WriteJSON(w, http.StatusOK, AutoReplyResponse{OK: true, Skipped: true, Reason: "already_replied"})
		return
	}

	aiResponse, err := handler.aiRunner.Run(r.Context(), replyContext.Tenant, ai.RunRequest{
		Message:        firstNonEmpty(input.Text, pointerValue(replyContext.Message.Content)),
		AgentID:        replyContext.AgentID,
		LeadID:         pointerValue(replyContext.Conversation.LeadID),
		ConversationID: replyContext.Conversation.ID,
	})
	if err != nil {
		httpserver.WriteError(w, r, http.StatusBadGateway, "ai_autoreply_failed", "Unable to generate AI response.")
		return
	}
	output := strings.TrimSpace(aiResponse.Output)
	if output == "" {
		httpserver.WriteJSON(w, http.StatusOK, AutoReplyResponse{OK: true, Skipped: true, Reason: "empty_ai_output"})
		return
	}

	clientMessageID := autoReplyClientMessagePrefix + replyContext.Message.ID
	sendResponse, err := handler.repo.SendMessage(r.Context(), replyContext.Tenant, replyContext.Conversation.ID, sendMessageInput{
		Text:            output,
		SendSessionID:   replyContext.Session.ID,
		ClientMessageID: clientMessageID,
	})
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}
	if err := handler.repo.markAutoReplyMessage(r.Context(), replyContext, clientMessageID, aiResponse); err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	handler.publishWhatsAppEvent(replyContext.Tenant, "whatsapp.ai_autoreply.sent", sendResponse.ConversationID, replyContext.Conversation.LeadID, map[string]any{
		"conversationId":   sendResponse.ConversationID,
		"clientMessageId":  sendResponse.ClientMessageID,
		"inboundMessageId": replyContext.Message.ID,
		"agentId":          aiResponse.Agent.ID,
		"agentType":        aiResponse.Agent.Type,
	})
	httpserver.WriteJSON(w, http.StatusOK, AutoReplyResponse{
		OK:              true,
		ConversationID:  sendResponse.ConversationID,
		ClientMessageID: sendResponse.ClientMessageID,
		Output:          output,
		Agent:           aiResponse.Agent,
	})
}

func (request AutoReplyRequest) validate() (autoReplyInput, error) {
	organizationID, ok := normalizeUUID(request.OrganizationID)
	if !ok {
		return autoReplyInput{}, ErrInvalidInput
	}
	sessionID, ok := normalizeUUID(request.SessionID)
	if !ok {
		return autoReplyInput{}, ErrInvalidInput
	}
	conversationID, ok := normalizeUUID(request.ConversationID)
	if !ok {
		return autoReplyInput{}, ErrInvalidInput
	}
	messageID, ok := normalizeUUID(request.MessageID)
	if !ok {
		return autoReplyInput{}, ErrInvalidInput
	}
	return autoReplyInput{
		OrganizationID: organizationID,
		SessionID:      sessionID,
		ConversationID: conversationID,
		MessageID:      messageID,
		Text:           strings.TrimSpace(request.Text),
	}, nil
}

func (repo Repository) loadAutoReplyContext(ctx context.Context, input autoReplyInput) (autoReplyContext, error) {
	session, err := scanSession(repo.db.Pool().QueryRow(ctx, `
		select `+sessionSelectFields()+`
		from public.whatsapp_sessions ws
		left join public.users owner on owner.id = ws.owner_user_id
		where ws.organization_id = $1::uuid
		  and ws.id = $2::uuid
		  and ws.is_active is not false
		limit 1
	`, input.OrganizationID, input.SessionID))
	if errors.Is(err, pgx.ErrNoRows) {
		return autoReplyContext{}, ErrSessionNotFound
	}
	if err != nil {
		return autoReplyContext{}, err
	}

	userID := session.OwnerUserID
	memberRole := ""
	if userID != "" {
		memberRole = repo.memberRole(ctx, session.OrganizationID, userID)
	}
	if userID == "" || memberRole == "" {
		userID, memberRole = repo.firstActiveOrganizationMember(ctx, session.OrganizationID)
	}
	if userID == "" {
		return autoReplyContext{}, ErrInvalidReference
	}

	tenantContext := tenant.Context{
		UserID:         userID,
		UserRole:       memberRole,
		OrganizationID: session.OrganizationID,
		MemberRole:     memberRole,
		Permissions:    []string{"*"},
	}

	conversation, err := scanConversation(repo.db.Pool().QueryRow(ctx, `
		select `+conversationSelectFields()+`
		from public.whatsapp_conversations wc
		left join public.whatsapp_sessions ws on ws.id = wc.session_id
		left join public.leads l on l.id = wc.lead_id
		left join public.pipelines pipeline on pipeline.id = l.pipeline_id
		left join public.stages stage on stage.id = l.stage_id
		where wc.organization_id = $1::uuid
		  and wc.id = $2::uuid
		  and wc.session_id = $3::uuid
		  and wc.deleted_at is null
		limit 1
	`, session.OrganizationID, input.ConversationID, session.ID))
	if errors.Is(err, pgx.ErrNoRows) {
		return autoReplyContext{}, ErrConversationNotFound
	}
	if err != nil {
		return autoReplyContext{}, err
	}

	message, err := scanMessage(repo.db.Pool().QueryRow(ctx, `
		select `+messageSelectFields()+`
		from public.whatsapp_messages wm
		where wm.organization_id = $1::uuid
		  and wm.id = $2::uuid
		  and wm.conversation_id = $3::uuid
		  and wm.session_id = $4::uuid
		limit 1
	`, session.OrganizationID, input.MessageID, conversation.ID, session.ID))
	if errors.Is(err, pgx.ErrNoRows) {
		return autoReplyContext{}, ErrMessageNotFound
	}
	if err != nil {
		return autoReplyContext{}, err
	}

	return autoReplyContext{
		Tenant:       tenantContext,
		Session:      session,
		Conversation: conversation,
		Message:      message,
		AgentID:      stringFromObject(session.AdvancedSettings, "ai_auto_reply_agent_id"),
	}, nil
}

func (context autoReplyContext) skipReason() string {
	if context.Message.FromMe {
		return "from_me"
	}
	if context.Conversation.IsGroup {
		return "group_conversation"
	}
	if context.Session.Provider != "evolution_go" {
		return "unsupported_provider"
	}
	if context.Session.Status != "connected" {
		return "session_not_connected"
	}
	if !boolFromObject(context.Session.AdvancedSettings, "ai_auto_reply_enabled") {
		return "session_autoreply_disabled"
	}
	if pauseUntil := stringFromObject(context.Session.AdvancedSettings, "ai_auto_reply_pause_until"); pauseUntil != "" {
		if parsed, err := time.Parse(time.RFC3339, pauseUntil); err == nil && parsed.After(time.Now().UTC()) {
			return "session_autoreply_paused"
		}
	}
	if strings.TrimSpace(pointerValue(context.Message.Content)) == "" {
		return "empty_inbound_text"
	}
	if context.Message.MessageType != "" && context.Message.MessageType != "text" && context.Message.MessageType != "conversation" && strings.TrimSpace(pointerValue(context.Message.Content)) == "" {
		return "unsupported_inbound_message_type"
	}
	return ""
}

func (repo Repository) autoReplyExists(ctx context.Context, context autoReplyContext) (bool, error) {
	clientMessageID := autoReplyClientMessagePrefix + context.Message.ID
	var exists bool
	err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from public.whatsapp_messages
			where organization_id = $1::uuid
			  and conversation_id = $2::uuid
			  and from_me = true
			  and (
			    client_message_id = $3
			    or metadata->>'ai_reply_to_message_id' = $4
			  )
		)
	`, context.Session.OrganizationID, context.Conversation.ID, clientMessageID, context.Message.ID).Scan(&exists)
	return exists, err
}

func (repo Repository) markAutoReplyMessage(ctx context.Context, context autoReplyContext, clientMessageID string, response ai.RunResponse) error {
	metadata := map[string]any{
		"ai_generated":           true,
		"ai_reply_to_message_id": context.Message.ID,
		"ai_agent_id":            response.Agent.ID,
		"ai_agent_name":          response.Agent.Name,
		"ai_agent_type":          response.Agent.Type,
		"ai_mode":                response.Mode,
	}
	if response.Handoff != nil {
		metadata["ai_handoff"] = response.Handoff
	}
	_, err := repo.db.Pool().Exec(ctx, `
		update public.whatsapp_messages
		set metadata = coalesce(metadata, '{}'::jsonb) || $4::jsonb,
		    updated_at = now()
		where organization_id = $1::uuid
		  and conversation_id = $2::uuid
		  and client_message_id = $3
	`, context.Session.OrganizationID, context.Conversation.ID, clientMessageID, jsonb(metadata))
	return err
}

func (repo Repository) memberRole(ctx context.Context, organizationID string, userID string) string {
	var role string
	_ = repo.db.Pool().QueryRow(ctx, `
		select role
		from public.organization_members
		where organization_id = $1::uuid
		  and user_id = $2::uuid
		  and coalesce(is_active, true) = true
		limit 1
	`, organizationID, userID).Scan(&role)
	return strings.TrimSpace(role)
}

func (repo Repository) firstActiveOrganizationMember(ctx context.Context, organizationID string) (string, string) {
	var userID, role string
	_ = repo.db.Pool().QueryRow(ctx, `
		select user_id::text, role
		from public.organization_members
		where organization_id = $1::uuid
		  and coalesce(is_active, true) = true
		order by case role when 'owner' then 0 when 'admin' then 1 when 'manager' then 2 else 3 end, created_at asc
		limit 1
	`, organizationID).Scan(&userID, &role)
	return strings.TrimSpace(userID), strings.TrimSpace(role)
}

func boolFromObject(object map[string]any, key string) bool {
	switch value := object[key].(type) {
	case bool:
		return value
	case string:
		value = strings.ToLower(strings.TrimSpace(value))
		return value == "true" || value == "1" || value == "yes" || value == "sim"
	default:
		return false
	}
}

func stringFromObject(object map[string]any, key string) string {
	switch value := object[key].(type) {
	case string:
		return strings.TrimSpace(value)
	case pgtype.Text:
		if value.Valid {
			return strings.TrimSpace(value.String)
		}
	default:
		return ""
	}
	return ""
}
