package whatsapp

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func validateWhatsAppSendStatusInput(clientMessageID, expectedLeadID string) (string, string, error) {
	clientMessageID = strings.TrimSpace(clientMessageID)
	if clientMessageID == "" || len(clientMessageID) > 200 || strings.ContainsRune(clientMessageID, '\x00') {
		return "", "", fmt.Errorf("%w: clientMessageId is invalid", ErrInvalidInput)
	}
	leadID, err := validateExpectedLeadID(expectedLeadID)
	return clientMessageID, leadID, err
}

// This read is scoped to the current authorized conversation/card. An absent
// row is not evidence that the browser may resend an unconfirmed intent.
func (repo Repository) GetSendStatus(ctx context.Context, tenantContext tenant.Context, conversationID, clientMessageID, expectedLeadID string) (SendMessageResponse, error) {
	clientMessageID, expectedLeadID, err := validateWhatsAppSendStatusInput(clientMessageID, expectedLeadID)
	if err != nil {
		return SendMessageResponse{}, err
	}
	conversation, err := repo.GetConversation(ctx, tenantContext, conversationID)
	if err != nil {
		return SendMessageResponse{}, err
	}
	if pointerValue(conversation.LeadID) != expectedLeadID {
		return SendMessageResponse{}, ErrConversationNotFound
	}
	args := append(baseConversationArgs(tenantContext), conversation.ID, clientMessageID, expectedLeadID)
	message, err := scanMessage(repo.db.Pool().QueryRow(ctx, `
		select `+messageSelectFields()+`
		from public.whatsapp_messages wm
		join public.whatsapp_conversations wc
		  on wc.id=wm.conversation_id and wc.organization_id=wm.organization_id and wc.session_id=wm.session_id
		left join public.whatsapp_sessions ws on ws.id=wc.session_id
		left join public.leads l on l.id=wc.lead_id and l.organization_id=wc.organization_id
		where wc.organization_id=$1::uuid and wc.id=$5::uuid
		  and wc.lead_id=$7::uuid and wm.lead_id=$7::uuid
		  and wc.deleted_at is null and wc.retired_at is null
		  and `+conversationVisibilitySQL(canViewOwnWhatsAppLeads(tenantContext))+`
		  and wm.client_message_id=$6 and wm.from_me
		  and wm.capture_state='captured'
		limit 1
	`, args...))
	if errors.Is(err, pgx.ErrNoRows) {
		return SendMessageResponse{}, ErrMessageNotFound
	}
	if err != nil {
		return SendMessageResponse{}, err
	}
	return SendMessageResponse{ClientMessageID: clientMessageID, ConversationID: conversation.ID, Status: message.Status, Message: &message}, nil
}
