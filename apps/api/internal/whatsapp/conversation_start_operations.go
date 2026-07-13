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

	session, err := repo.resolveStartSession(ctx, tenantContext, request.SessionID)
	if err != nil {
		return Conversation{}, err
	}
	if session.Provider != "evolution_go" {
		return Conversation{}, fmt.Errorf("%w: legacy Evolution provider is disabled", ErrInvalidInput)
	}

	leadID := ""
	if strings.TrimSpace(request.LeadID) != "" {
		value, ok := normalizeUUID(request.LeadID)
		if !ok {
			return Conversation{}, fmt.Errorf("%w: leadId is invalid", ErrInvalidInput)
		}
		if err := repo.ensureCanViewLead(ctx, tenantContext, value); err != nil {
			return Conversation{}, err
		}
		leadID = value
	}

	requestedIdentity := newWhatsAppContactIdentity(request.Phone, request.Phone, false)
	if requestedIdentity.ContactPhone == "" || requestedIdentity.RemoteJID == "" {
		return Conversation{}, fmt.Errorf("%w: Telefone invalido para WhatsApp", ErrInvalidInput)
	}

	matchedLeadName := ""
	if leadID == "" {
		match, err := repo.findLeadByPhone(ctx, tenantContext, requestedIdentity.LeadMatchValues()...)
		if err != nil {
			return Conversation{}, err
		}
		if match != nil {
			leadID = match.ID
			matchedLeadName = match.Name
		}
	}
	if leadID == "" {
		return Conversation{}, fmt.Errorf("%w: a conversa deve estar vinculada a um lead acessivel", ErrInvalidReference)
	}
	leadContact, err := resolveAccessibleLeadContact(ctx, repo.db.Pool(), tenantContext, leadID, requestedIdentity)
	if err != nil {
		return Conversation{}, fmt.Errorf("%w: o telefone informado nao pertence ao lead selecionado", err)
	}
	identity := leadContact.Identity
	cleanPhone := identity.ContactPhone
	remoteJID := identity.RemoteJID

	// A webhook may have already persisted an exact same-session conversation
	// in quarantine. Claim that row before looking at historical lead
	// conversations; rebinding an older conversation would collide with the
	// unique (organization, session, remote_jid) identity and hide its history.
	if conversationID, lockedLeadContact, found, err := repo.claimExactQuarantinedConversationForLead(
		ctx,
		tenantContext,
		session.ID,
		leadID,
		requestedIdentity,
	); err != nil {
		return Conversation{}, err
	} else if found {
		return repo.GetConversation(ctx, tenantContext, conversationID)
	} else {
		// Use the identity revalidated under the transaction lock for every
		// subsequent lookup/write as well.
		leadContact = lockedLeadContact
		identity = leadContact.Identity
		cleanPhone = identity.ContactPhone
		remoteJID = identity.RemoteJID
	}

	if conversation, err := repo.findConversationByExactSessionJID(ctx, tenantContext, session.ID, remoteJID); err == nil && conversation != nil {
		if pointerValue(conversation.LeadID) != leadID {
			return Conversation{}, fmt.Errorf("%w: a conversa ja pertence a outro lead", ErrInvalidReference)
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
				    assigned_user_id = nullif($6, '')::uuid,
				    updated_at = now()
				where organization_id = $1::uuid
				  and id = $2::uuid
			`, tenantContext.OrganizationID, conversation.ID, session.ID, remoteJID, cleanPhone, leadContact.AssignedUserID)
			if err != nil {
				return Conversation{}, err
			}
			return repo.GetConversation(ctx, tenantContext, conversation.ID)
		}
	}

	if conversation, err := repo.findConversationByPhoneVariants(ctx, tenantContext, identity.ConversationMatchValues(), session.ID); err != nil {
		return Conversation{}, err
	} else if conversation != nil {
		if pointerValue(conversation.LeadID) != "" && pointerValue(conversation.LeadID) != leadID {
			return Conversation{}, fmt.Errorf("%w: a conversa ja pertence a outro lead", ErrInvalidReference)
		}
		_, err := repo.db.Pool().Exec(ctx, `
			update public.whatsapp_conversations
			set session_id = $3::uuid,
			    remote_jid = $4,
			    contact_phone = $5,
			    lead_id = coalesce(lead_id, nullif($6, '')::uuid),
			    assigned_user_id = nullif($7, '')::uuid,
			    updated_at = now()
			where organization_id = $1::uuid
			  and id = $2::uuid
		`, tenantContext.OrganizationID, conversation.ID, session.ID, remoteJID, cleanPhone, leadID, leadContact.AssignedUserID)
		if err != nil {
			return Conversation{}, err
		}
		return repo.GetConversation(ctx, tenantContext, conversation.ID)
	}

	contactName := strings.TrimSpace(request.LeadName)
	if contactName == "" {
		contactName = matchedLeadName
	}
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
			assigned_user_id,
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
			nullif($7, '')::uuid,
			0,
			false
		)
		returning id::text
	`, tenantContext.OrganizationID, session.ID, remoteJID, cleanPhone, contactName, leadID, leadContact.AssignedUserID).Scan(&newID)
	if err != nil {
		return Conversation{}, err
	}

	return repo.GetConversation(ctx, tenantContext, newID)
}

// claimExactQuarantinedConversationForLead promotes only the exact
// organization/session/contact quarantine row. It intentionally does not use
// conversationVisibilitySQL: unlinked rows can be browsed by the session owner,
// but an authorized lead + owned session + exact stored lead phone is still
// required to claim this single row safely.
func (repo Repository) claimExactQuarantinedConversationForLead(
	ctx context.Context,
	tenantContext tenant.Context,
	sessionID string,
	leadID string,
	requestedIdentity whatsappContactIdentity,
) (string, accessibleLeadContact, bool, error) {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return "", accessibleLeadContact{}, false, err
	}
	defer tx.Rollback(ctx)

	var sessionExists bool
	err = tx.QueryRow(ctx, `
		select true
		from public.whatsapp_sessions ws
		where ws.organization_id = $1::uuid
		  and ws.id = $2::uuid
		  and ws.owner_user_id = $3::uuid
		  and ws.provider = 'evolution_go'
		  and coalesce(ws.is_active, true) = true
		  and ws.status = 'connected'
		for share of ws
	`, tenantContext.OrganizationID, sessionID, tenantContext.UserID).Scan(&sessionExists)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", accessibleLeadContact{}, false, ErrSessionNotFound
	}
	if err != nil {
		return "", accessibleLeadContact{}, false, err
	}

	leadContact, err := resolveAccessibleLeadContact(ctx, tx, tenantContext, leadID, requestedIdentity)
	if err != nil {
		return "", accessibleLeadContact{}, false, fmt.Errorf("%w: o telefone informado nao pertence ao lead selecionado", err)
	}
	identity := leadContact.Identity
	aliases := identity.RemoteAliases()
	if len(aliases) == 0 {
		return "", accessibleLeadContact{}, false, ErrInvalidReference
	}

	var conversationID, existingLeadID string
	err = tx.QueryRow(ctx, `
		select wc.id::text, coalesce(wc.lead_id::text, '')
		from public.whatsapp_conversations wc
		where wc.organization_id = $1::uuid
		  and wc.session_id = $2::uuid
		  and wc.deleted_at is null
		  and coalesce(wc.is_group, false) = false
		  and (
		    wc.remote_jid = any($3::text[])
		    or exists (
		      select 1
		      from public.whatsapp_contact_identity_aliases alias
		      where alias.organization_id = wc.organization_id
		        and alias.session_id = wc.session_id
		        and alias.alias_jid = any($3::text[])
		        and alias.canonical_jid = wc.remote_jid
		    )
		  )
		order by
		  case when wc.remote_jid = $4 then 0 else 1 end,
		  wc.last_message_at desc nulls last,
		  wc.created_at desc
		limit 1
		for update of wc
	`, tenantContext.OrganizationID, sessionID, aliases, identity.RemoteJID).Scan(&conversationID, &existingLeadID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", leadContact, false, nil
	}
	if err != nil {
		return "", accessibleLeadContact{}, false, err
	}
	if existingLeadID != "" && existingLeadID != leadID {
		return "", accessibleLeadContact{}, false, fmt.Errorf("%w: a conversa ja pertence a outro lead", ErrInvalidReference)
	}

	var conflictingMessages, conflictingAliases, conflictingLogs bool
	if err := tx.QueryRow(ctx, `
		select exists (
		  select 1 from public.whatsapp_messages message
		  where message.organization_id = $1::uuid
		    and message.conversation_id = $2::uuid
		    and message.lead_id is not null
		    and message.lead_id <> $3::uuid
		)
	`, tenantContext.OrganizationID, conversationID, leadID).Scan(&conflictingMessages); err != nil {
		return "", accessibleLeadContact{}, false, err
	}
	if err := tx.QueryRow(ctx, `
		select exists (
		  select 1 from public.whatsapp_contact_identity_aliases alias
		  where alias.organization_id = $1::uuid
		    and alias.session_id = $2::uuid
		    and (
		      alias.alias_jid = any($3::text[])
		      or alias.canonical_jid = any($3::text[])
		      or alias.contact_phone = $4
		    )
		    and alias.lead_id is not null
		    and alias.lead_id <> $5::uuid
		)
	`, tenantContext.OrganizationID, sessionID, aliases, identity.ContactPhone, leadID).Scan(&conflictingAliases); err != nil {
		return "", accessibleLeadContact{}, false, err
	}
	if err := tx.QueryRow(ctx, `
		select exists (
		  select 1 from public.whatsapp_inbound_logs log
		  where log.organization_id = $1::uuid
		    and log.session_id = $2::uuid
		    and log.conversation_id = $3::uuid
		    and log.lead_id is not null
		    and log.lead_id <> $4::uuid
		)
	`, tenantContext.OrganizationID, sessionID, conversationID, leadID).Scan(&conflictingLogs); err != nil {
		return "", accessibleLeadContact{}, false, err
	}
	if conflictingMessages || conflictingAliases || conflictingLogs {
		return "", accessibleLeadContact{}, false, fmt.Errorf("%w: historico da conversa pertence a outro lead", ErrInvalidReference)
	}

	tag, err := tx.Exec(ctx, `
		update public.whatsapp_conversations
		set lead_id = $4::uuid,
		    assigned_user_id = nullif($5, '')::uuid,
		    remote_jid = $6,
		    contact_phone = $7,
		    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
		      'lead_claimed_from_quarantine_at', now(),
		      'lead_claimed_from_quarantine_id', $4::text
		    ),
		    updated_at = now()
		where organization_id = $1::uuid
		  and session_id = $2::uuid
		  and id = $3::uuid
		  and (lead_id is null or lead_id = $4::uuid)
	`, tenantContext.OrganizationID, sessionID, conversationID, leadID, leadContact.AssignedUserID, identity.RemoteJID, identity.ContactPhone)
	if err != nil {
		return "", accessibleLeadContact{}, false, err
	}
	if tag.RowsAffected() != 1 {
		return "", accessibleLeadContact{}, false, ErrConversationNotFound
	}

	if _, err := tx.Exec(ctx, `
		update public.whatsapp_messages
		set lead_id = $3::uuid
		where organization_id = $1::uuid
		  and conversation_id = $2::uuid
		  and (lead_id is null or lead_id = $3::uuid)
	`, tenantContext.OrganizationID, conversationID, leadID); err != nil {
		return "", accessibleLeadContact{}, false, err
	}

	if _, err := tx.Exec(ctx, `
		insert into public.whatsapp_contact_identity_aliases (
		  organization_id, session_id, alias_jid, canonical_jid,
		  contact_phone, lead_id, is_group, metadata
		)
		select $1::uuid, $2::uuid, alias_jid, $4, $5, $6::uuid, false,
		       jsonb_build_object('source', 'start_conversation_quarantine_claim', 'conversation_id', $7::uuid)
		from unnest($3::text[]) alias_jid
		on conflict (organization_id, session_id, alias_jid) do update
		set canonical_jid = excluded.canonical_jid,
		    contact_phone = excluded.contact_phone,
		    lead_id = excluded.lead_id,
		    last_seen_at = now(),
		    metadata = coalesce(public.whatsapp_contact_identity_aliases.metadata, '{}'::jsonb) || excluded.metadata
		where public.whatsapp_contact_identity_aliases.lead_id is null
		   or public.whatsapp_contact_identity_aliases.lead_id = excluded.lead_id
	`, tenantContext.OrganizationID, sessionID, aliases, identity.RemoteJID, identity.ContactPhone, leadID, conversationID); err != nil {
		return "", accessibleLeadContact{}, false, err
	}

	if _, err := tx.Exec(ctx, `
		update public.whatsapp_inbound_logs
		set lead_id = $4::uuid,
		    assigned_user_id = coalesce(assigned_user_id, nullif($5, '')::uuid)
		where organization_id = $1::uuid
		  and session_id = $2::uuid
		  and conversation_id = $3::uuid
		  and (lead_id is null or lead_id = $4::uuid)
	`, tenantContext.OrganizationID, sessionID, conversationID, leadID, leadContact.AssignedUserID); err != nil {
		return "", accessibleLeadContact{}, false, err
	}

	if err := tx.Commit(ctx); err != nil {
		return "", accessibleLeadContact{}, false, err
	}
	return conversationID, leadContact, true, nil
}

func (repo Repository) resolveStartSession(ctx context.Context, tenantContext tenant.Context, preferredSessionID string) (Session, error) {
	if strings.TrimSpace(preferredSessionID) != "" {
		session, err := repo.getCanSendSession(ctx, tenantContext, preferredSessionID)
		if err != nil {
			return Session{}, err
		}
		if session.Status != "connected" {
			return Session{}, fmt.Errorf("%w: WhatsApp selecionado esta desconectado.", ErrInvalidInput)
		}
		return session, nil
	}

	return repo.resolveAnyConnectedSendSession(ctx, tenantContext, "iniciar esta conversa")
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

	identity := newWhatsAppContactIdentity(filter.Phone, filter.Phone, false)
	return repo.findConversationByPhoneVariants(ctx, tenantContext, identity.ConversationMatchValues(), filter.SessionID)
}

func (repo Repository) findConversationByExactSessionJID(ctx context.Context, tenantContext tenant.Context, sessionID string, remoteJID string) (*Conversation, error) {
	identity := newWhatsAppContactIdentity("", remoteJID, strings.Contains(strings.ToLower(remoteJID), "@g.us"))
	aliases := identity.RemoteAliases()
	if len(aliases) == 0 {
		return nil, nil
	}

	args := append(baseConversationArgs(tenantContext), sessionID, aliases, identity.RemoteJID)
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
		  and wc.session_id = $5::uuid
		  and (
			wc.remote_jid = any($6::text[])
			or exists (
				select 1
				from public.whatsapp_contact_identity_aliases wcia
				where wcia.organization_id = wc.organization_id
				  and wcia.session_id = wc.session_id
				  and wcia.alias_jid = any($6::text[])
				  and wcia.canonical_jid = wc.remote_jid
			)
		  )
		order by
		  case
			when wc.remote_jid = $7 then 0
			when exists (
				select 1
				from public.whatsapp_contact_identity_aliases wcia
				where wcia.organization_id = wc.organization_id
				  and wcia.session_id = wc.session_id
				  and wcia.alias_jid = any($6::text[])
				  and wcia.canonical_jid = wc.remote_jid
			) then 1
			else 2
		  end,
		  wc.last_message_at desc nulls last,
		  wc.created_at desc
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
		  and wc.lead_id = $5::uuid
		  and wc.session_id = $6::uuid
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
	variants = uniqueStrings(variants...)
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
		orParts = append(orParts, fmt.Sprintf(`(
			wc.remote_jid ilike $%d
			or wc.contact_phone ilike $%d
			or exists (
				select 1
				from public.whatsapp_contact_identity_aliases wcia
				where wcia.organization_id = wc.organization_id
				  and wcia.session_id = wc.session_id
				  and (
					wcia.canonical_jid = wc.remote_jid
					or (
						wc.contact_phone is not null
						and wcia.contact_phone is not null
						and wcia.contact_phone = wc.contact_phone
					)
				  )
				  and (
					wcia.alias_jid ilike $%d
					or wcia.canonical_jid ilike $%d
					or wcia.contact_phone ilike $%d
				  )
			)
		)`, len(args), len(args), len(args), len(args), len(args)))
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
