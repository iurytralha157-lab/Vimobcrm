package whatsapp

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type leadPhoneMatch struct {
	ID               string
	Name             string
	WhatsAppAvatar   *string
	PipelineID       *string
	StageID          *string
	AssignedUserID   *string
	AssignedUserName *string
	AssigneeAvatar   *string
}

func (repo Repository) resolveConversationLead(ctx context.Context, tenantContext tenant.Context, conversation Conversation) (Conversation, error) {
	if conversation.LeadID != nil || conversation.IsGroup {
		return conversation, nil
	}

	identity := newWhatsAppContactIdentity(pointerValue(conversation.ContactPhone), conversation.RemoteJID, conversation.IsGroup)
	match, err := repo.findLeadByPhone(ctx, tenantContext.OrganizationID, identity.LeadMatchValues()...)
	if err != nil || match == nil {
		return conversation, err
	}

	if err := repo.attachConversationToLead(ctx, tenantContext.OrganizationID, conversation.ID, match.ID); err != nil {
		return conversation, err
	}

	if refreshed, err := repo.GetConversation(ctx, tenantContext, conversation.ID); err == nil {
		return refreshed, nil
	}

	conversation.LeadID = &match.ID
	conversation.Lead = match.toLeadLite()
	return conversation, nil
}

func (repo Repository) findLeadByPhone(ctx context.Context, organizationID string, values ...string) (*leadPhoneMatch, error) {
	candidates := phoneMatchCandidates(values...)
	if len(candidates) == 0 {
		return nil, nil
	}

	var match leadPhoneMatch
	var leadName, leadAvatar, pipelineID, stageID, assignedUserID, assignedUserName, assigneeAvatar pgtype.Text
	err := repo.db.Pool().QueryRow(ctx, `
		select
			l.id::text,
			l.name,
			l.whatsapp_avatar_url,
			l.pipeline_id::text,
			l.stage_id::text,
			l.assigned_user_id::text,
			u.name,
			u.avatar_url
		from public.leads l
		left join public.users u on u.id = l.assigned_user_id
		where l.organization_id = $1::uuid
		  and exists (
			select 1
			from unnest($2::text[]) as candidate(value)
			where normalize_phone(candidate.value) <> ''
			  and (
				(l.phone is not null and normalize_phone(l.phone) = normalize_phone(candidate.value))
				or (
					nullif(to_jsonb(l)->>'whatsapp', '') is not null
					and normalize_phone(to_jsonb(l)->>'whatsapp') = normalize_phone(candidate.value)
				)
			  )
		  )
		order by
			case when l.deal_status = 'open' then 0 else 1 end,
			l.last_contact_at desc nulls last,
			l.created_at desc
		limit 1
	`, organizationID, candidates).Scan(
		&match.ID,
		&leadName,
		&leadAvatar,
		&pipelineID,
		&stageID,
		&assignedUserID,
		&assignedUserName,
		&assigneeAvatar,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	match.Name = textValue(leadName)
	match.WhatsAppAvatar = textPtr(leadAvatar)
	match.PipelineID = textPtr(pipelineID)
	match.StageID = textPtr(stageID)
	match.AssignedUserID = textPtr(assignedUserID)
	match.AssignedUserName = textPtr(assignedUserName)
	match.AssigneeAvatar = textPtr(assigneeAvatar)

	return &match, nil
}

func (repo Repository) attachConversationToLead(ctx context.Context, organizationID string, conversationID string, leadID string) error {
	_, err := repo.db.Pool().Exec(ctx, `
		update public.whatsapp_conversations
		set lead_id = $3::uuid,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and lead_id is null
	`, organizationID, conversationID, leadID)
	if err != nil {
		return err
	}

	_, err = repo.db.Pool().Exec(ctx, `
		update public.whatsapp_messages
		set lead_id = $3::uuid
		where organization_id = $1::uuid
		  and conversation_id = $2::uuid
		  and lead_id is null
	`, organizationID, conversationID, leadID)
	return err
}

func phoneMatchCandidates(values ...string) []string {
	seen := map[string]struct{}{}
	out := []string{}

	for _, value := range values {
		for _, candidate := range phoneVariants(value) {
			if candidate == "" {
				continue
			}
			if _, exists := seen[candidate]; exists {
				continue
			}
			seen[candidate] = struct{}{}
			out = append(out, candidate)
		}
	}

	return out
}

func (match leadPhoneMatch) toLeadLite() *LeadLite {
	lead := &LeadLite{
		ID:                match.ID,
		Name:              match.Name,
		WhatsAppAvatarURL: match.WhatsAppAvatar,
		PipelineID:        match.PipelineID,
		StageID:           match.StageID,
	}
	if match.AssignedUserID != nil && *match.AssignedUserID != "" {
		lead.Assignee = &LeadAssigneeRef{
			ID:        *match.AssignedUserID,
			Name:      pointerValue(match.AssignedUserName),
			AvatarURL: match.AssigneeAvatar,
		}
	}
	return lead
}
