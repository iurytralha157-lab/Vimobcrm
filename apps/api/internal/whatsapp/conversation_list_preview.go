package whatsapp

import (
	"encoding/json"
	"time"
)

// Keep the text, direction and receipt from one immutable, visible message.
// Session ownership cannot establish whether the contact or a CRM actor sent it.
func conversationMessagePreviewSQL() string {
	return `coalesce(nullif(wm.content, ''), case wm.message_type
		when 'image' then '[Imagem]'
		when 'video' then '[Video]'
		when 'audio' then '[Audio]'
		when 'document' then '[Documento]'
		when 'sticker' then '[Figurinha]'
		else '[Mensagem]'
	end)`
}

func conversationListPreviewSQL() string {
	return `coalesce((select jsonb_build_object(
		'preview', ` + conversationMessagePreviewSQL() + `,
		'from_me', wm.from_me, 'status', wm.status, 'id', wm.id, 'sent_at', wm.sent_at
	)::text
	from public.whatsapp_messages wm
	where wm.organization_id = wc.organization_id
	  and wm.conversation_id = wc.id
	  and ` + conversationMessageLeadMatchSQL() + `
	  and wm.capture_state is distinct from 'suppressed'
	  and wm.reaction_to_message_id is null
	  and wm.message_type is distinct from 'reaction'
	order by ` + messageOrderSQL(MessageFilter{OrderingVersion: 2}) + `
	limit 1), '{"preview":null,"from_me":null,"status":null}')`
}

type conversationListPreview struct {
	Preview *string    `json:"preview"`
	FromMe  *bool      `json:"from_me"`
	Status  *string    `json:"status"`
	ID      *string    `json:"id"`
	SentAt  *time.Time `json:"sent_at"`
}

func applyConversationListPreview(conversation *Conversation, value string) error {
	if value == "" {
		// A history projection without a head contains no preview to attribute.
		return nil
	}
	var preview conversationListPreview
	if err := json.Unmarshal([]byte(value), &preview); err != nil {
		return err
	}
	conversation.LastMessage = preview.Preview
	conversation.LastMessageFromMe = preview.FromMe
	conversation.LastMessageStatus = preview.Status
	conversation.LastMessageID = preview.ID
	conversation.LastMessageSentAt = preview.SentAt
	// Retain the conversation's existing sort/cursor timestamp. Receipt changes
	// refresh this projection without changing queue order or inbox pagination.
	return nil
}
