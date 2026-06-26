package whatsapp

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) StartConversation(ctx context.Context, tenantContext tenant.Context, request StartConversationRequest) (Conversation, error) {
	if !isValidWhatsAppPhone(request.Phone) {
		return Conversation{}, fmt.Errorf("%w: Telefone invalido para WhatsApp", ErrInvalidInput)
	}

	session, err := repo.getCanSendSession(ctx, tenantContext, request.SessionID)
	if err != nil {
		return Conversation{}, err
	}

	leadID := ""
	if strings.TrimSpace(request.LeadID) != "" {
		value, ok := normalizeUUID(request.LeadID)
		if !ok {
			return Conversation{}, fmt.Errorf("%w: leadId is invalid", ErrInvalidInput)
		}
		if err := repo.validateLead(ctx, tenantContext.OrganizationID, value); err != nil {
			return Conversation{}, err
		}
		leadID = value
	}

	cleanPhone := formatPhoneForWhatsApp(request.Phone)
	remoteJID := cleanPhone
	if !strings.Contains(remoteJID, "@") {
		remoteJID += "@c.us"
	}

	if conversation, err := repo.findConversationByExactSessionJID(ctx, tenantContext, session.ID, remoteJID); err == nil && conversation != nil {
		if leadID != "" && pointerValue(conversation.LeadID) != leadID {
			_, _ = repo.db.Pool().Exec(ctx, `
				update public.whatsapp_conversations
				set lead_id = $3::uuid,
				    updated_at = now()
				where organization_id = $1::uuid
				  and id = $2::uuid
			`, tenantContext.OrganizationID, conversation.ID, leadID)
			conversation.LeadID = &leadID
		}
		return *conversation, nil
	}

	if leadID != "" {
		if conversation, err := repo.findConversationForLead(ctx, tenantContext, leadID); err != nil {
			return Conversation{}, err
		} else if conversation != nil {
			_, err := repo.db.Pool().Exec(ctx, `
				update public.whatsapp_conversations
				set session_id = $3::uuid,
				    remote_jid = $4,
				    contact_phone = $5,
				    updated_at = now()
				where organization_id = $1::uuid
				  and id = $2::uuid
			`, tenantContext.OrganizationID, conversation.ID, session.ID, remoteJID, cleanPhone)
			if err != nil {
				return Conversation{}, err
			}
			return repo.GetConversation(ctx, tenantContext, conversation.ID)
		}
	}

	if conversation, err := repo.findConversationByPhoneVariants(ctx, tenantContext, phoneVariants(cleanPhone), session.ID); err != nil {
		return Conversation{}, err
	} else if conversation != nil {
		_, err := repo.db.Pool().Exec(ctx, `
			update public.whatsapp_conversations
			set session_id = $3::uuid,
			    remote_jid = $4,
			    contact_phone = $5,
			    lead_id = coalesce(lead_id, nullif($6, '')::uuid),
			    updated_at = now()
			where organization_id = $1::uuid
			  and id = $2::uuid
		`, tenantContext.OrganizationID, conversation.ID, session.ID, remoteJID, cleanPhone, leadID)
		if err != nil {
			return Conversation{}, err
		}
		return repo.GetConversation(ctx, tenantContext, conversation.ID)
	}

	contactName := strings.TrimSpace(request.LeadName)
	if contactName == "" {
		contactName = cleanPhone
	}

	var newID string
	err = repo.db.Pool().QueryRow(ctx, `
		insert into public.whatsapp_conversations (
			organization_id,
			session_id,
			remote_jid,
			contact_phone,
			contact_name,
			lead_id,
			unread_count,
			is_group
		)
		values (
			$1::uuid,
			$2::uuid,
			$3,
			$4,
			$5,
			nullif($6, '')::uuid,
			0,
			false
		)
		returning id::text
	`, tenantContext.OrganizationID, session.ID, remoteJID, cleanPhone, contactName, leadID).Scan(&newID)
	if err != nil {
		return Conversation{}, err
	}

	return repo.GetConversation(ctx, tenantContext, newID)
}

func (repo Repository) FindConversation(ctx context.Context, tenantContext tenant.Context, filter FindConversationFilter) (*Conversation, error) {
	if filter.LeadID != "" && filter.SessionID != "" {
		if conversation, err := repo.findConversationByLeadAndSession(ctx, tenantContext, filter.LeadID, filter.SessionID); err != nil {
			return nil, err
		} else if conversation != nil {
			return conversation, nil
		}
	}

	if filter.LeadID != "" && filter.SessionID == "" {
		if conversation, err := repo.findConversationForLead(ctx, tenantContext, filter.LeadID); err != nil {
			return nil, err
		} else if conversation != nil {
			return conversation, nil
		}
	}

	if !isValidWhatsAppPhone(filter.Phone) {
		if filter.LeadID != "" {
			return nil, nil
		}
		return nil, fmt.Errorf("%w: Telefone invalido para WhatsApp", ErrInvalidInput)
	}

	return repo.findConversationByPhoneVariants(ctx, tenantContext, phoneVariants(formatPhoneForWhatsApp(filter.Phone)), filter.SessionID)
}

func (repo Repository) findConversationByExactSessionJID(ctx context.Context, tenantContext tenant.Context, sessionID string, remoteJID string) (*Conversation, error) {
	args := append(baseConversationArgs(tenantContext), sessionID, remoteJID)
	conversation, err := scanConversation(repo.db.Pool().QueryRow(ctx, `
		select `+conversationSelectFields()+`
		from public.whatsapp_conversations wc
		left join public.whatsapp_sessions ws on ws.id = wc.session_id
		left join public.leads l on l.id = wc.lead_id
		left join public.pipelines pipeline on pipeline.id = l.pipeline_id
		left join public.stages stage on stage.id = l.stage_id
		where wc.organization_id = $1::uuid
		  and wc.deleted_at is null
		  and `+conversationVisibilitySQL()+`
		  and wc.session_id = $6::uuid
		  and wc.remote_jid = $7
		limit 1
	`, args...))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	return &conversation, nil
}

func (repo Repository) findConversationByLeadAndSession(ctx context.Context, tenantContext tenant.Context, leadID string, sessionID string) (*Conversation, error) {
	args := append(baseConversationArgs(tenantContext), leadID, sessionID)
	conversation, err := scanConversation(repo.db.Pool().QueryRow(ctx, `
		select `+conversationSelectFields()+`
		from public.whatsapp_conversations wc
		left join public.whatsapp_sessions ws on ws.id = wc.session_id
		left join public.leads l on l.id = wc.lead_id
		left join public.pipelines pipeline on pipeline.id = l.pipeline_id
		left join public.stages stage on stage.id = l.stage_id
		where wc.organization_id = $1::uuid
		  and wc.deleted_at is null
		  and `+conversationVisibilitySQL()+`
		  and wc.lead_id = $6::uuid
		  and wc.session_id = $7::uuid
		order by wc.last_message_at desc nulls last, wc.created_at desc
		limit 1
	`, args...))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	return &conversation, nil
}

func (repo Repository) findConversationByPhoneVariants(ctx context.Context, tenantContext tenant.Context, variants []string, sessionID string) (*Conversation, error) {
	if len(variants) == 0 {
		return nil, nil
	}

	args := baseConversationArgs(tenantContext)
	where := []string{
		"wc.organization_id = $1::uuid",
		"wc.deleted_at is null",
		conversationVisibilitySQL(),
	}
	if sessionID != "" {
		sessionID, ok := normalizeUUID(sessionID)
		if !ok {
			return nil, fmt.Errorf("%w: sessionId is invalid", ErrInvalidInput)
		}
		args = append(args, sessionID)
		where = append(where, fmt.Sprintf("wc.session_id = $%d::uuid", len(args)))
	}

	orParts := []string{}
	for _, variant := range variants {
		args = append(args, "%"+variant+"%")
		orParts = append(orParts, fmt.Sprintf("(wc.remote_jid ilike $%d or wc.contact_phone ilike $%d)", len(args), len(args)))
	}
	where = append(where, "("+strings.Join(orParts, " or ")+")")

	conversation, err := scanConversation(repo.db.Pool().QueryRow(ctx, `
		select `+conversationSelectFields()+`
		from public.whatsapp_conversations wc
		left join public.whatsapp_sessions ws on ws.id = wc.session_id
		left join public.leads l on l.id = wc.lead_id
		left join public.pipelines pipeline on pipeline.id = l.pipeline_id
		left join public.stages stage on stage.id = l.stage_id
		where `+strings.Join(where, " and ")+`
		order by wc.last_message_at desc nulls last, wc.created_at desc
		limit 1
	`, args...))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	return &conversation, nil
}

var _ = tenant.Context{}
