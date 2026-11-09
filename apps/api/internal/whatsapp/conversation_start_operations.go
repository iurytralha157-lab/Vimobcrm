package whatsapp

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) StartConversation(ctx context.Context, tenantContext tenant.Context, request StartConversationRequest) (result Conversation, resultErr error) {
	defer func() {
		if resultErr == nil {
			repo.hydrateConversationAvatar(ctx, tenantContext.OrganizationID, &result)
		}
	}()
	if err := requireOriginalWhatsAppOrganization(ctx, repo.db.Pool(), tenantContext); err != nil {
		return Conversation{}, err
	}
	if !isValidWhatsAppPhone(request.Phone) {
		return Conversation{}, fmt.Errorf("%w: Telefone invalido para WhatsApp", ErrInvalidInput)
	}
	if err := validateStartPhoneConfirmation(request); err != nil {
		return Conversation{}, err
	}
	expectedPreviousLeadID, err := validateExpectedPreviousConversationLeadID(request.ExpectedPreviousLeadID)
	if err != nil {
		return Conversation{}, err
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
	session, err := repo.resolveLeadStartSession(ctx, tenantContext, request.SessionID, leadID)
	if err != nil {
		return Conversation{}, err
	}
	if err := validateStartSessionOwnership(request.OwnSessionOnly, session.OwnerUserID, tenantContext.UserID); err != nil {
		return Conversation{}, err
	}
	if session.Provider != "evolution_go" {
		return Conversation{}, fmt.Errorf("%w: legacy Evolution provider is disabled", ErrInvalidInput)
	}
	sharedSession := session.OwnerUserID != tenantContext.UserID

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
	if sharedSession && leadContact.AssignedUserID != tenantContext.UserID {
		return Conversation{}, ErrSessionAccessRevoked
	}
	identity := leadContact.Identity
	cleanPhone := identity.ContactPhone
	remoteJID := identity.RemoteJID
	if changed, handled, changeErr := repo.startCorrectedPhoneConversation(ctx, tenantContext, session, leadID, identity, request); handled || changeErr != nil {
		return changed, changeErr
	}

	// A webhook may have already persisted an exact same-session conversation
	// in quarantine. Claim that row before looking at historical lead
	// conversations; rebinding an older conversation would collide with the
	// unique (organization, session, remote_jid) identity and hide its history.
	if !sharedSession {
		if conversationID, lockedLeadContact, found, err := repo.claimExactQuarantinedConversationForLead(
			ctx,
			tenantContext,
			session.ID,
			leadID,
			requestedIdentity,
			expectedPreviousLeadID,
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
		if err := repo.retireExpiredExactUnlinkedConversation(ctx, tenantContext, session.ID, remoteJID, request.OwnSessionOnly); err != nil {
			return Conversation{}, err
		}
	} else if err := repo.validateSharedStartDestination(ctx, tenantContext, session.ID, remoteJID, leadID); err != nil {
		return Conversation{}, err
	}

	conversation, err := repo.findConversationByExactSessionJID(ctx, tenantContext, session.ID, remoteJID)
	if err != nil {
		return Conversation{}, err
	}
	if conversation != nil {
		if conversation.LeadID == nil || strings.TrimSpace(*conversation.LeadID) == "" {
			return Conversation{}, ErrConversationHistoryLinkRequired
		}
		if *conversation.LeadID != leadID {
			// Starting a chat cannot silently reassign an existing lead's route.
			// Reassignment is a separate explicit link action with a CAS snapshot.
			return Conversation{}, ErrConversationBindingChanged
		}
		if sharedSession {
			return repo.GetConversation(ctx, tenantContext, conversation.ID)
		}
		var linkErr error
		if request.OwnSessionOnly {
			linkErr = repo.linkConversationToLeadWithOwnSession(ctx, tenantContext, conversation.ID, leadID, expectedPreviousLeadID, session.ID)
		} else {
			linkErr = repo.LinkConversationToLead(ctx, tenantContext, conversation.ID, leadID, expectedPreviousLeadID)
		}
		if linkErr != nil {
			return Conversation{}, linkErr
		}
		return repo.GetConversation(ctx, tenantContext, conversation.ID)
	}
	if expectedPreviousLeadID != unlinkedConversationLeadSnapshot {
		return Conversation{}, ErrConversationBindingChanged
	}

	contactName := strings.TrimSpace(request.LeadName)
	if contactName == "" {
		contactName = matchedLeadName
	}
	if contactName == "" {
		contactName = cleanPhone
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return Conversation{}, err
	}
	defer tx.Rollback(ctx)
	if err := lockConversationSendSession(ctx, tx, tenantContext, session.ID); err != nil {
		return Conversation{}, err
	}
	if err := revalidateOwnStartSession(ctx, tx, tenantContext, session.ID, request.OwnSessionOnly); err != nil {
		return Conversation{}, err
	}
	if err := requireOriginalWhatsAppOrganization(ctx, tx, tenantContext); err != nil {
		return Conversation{}, err
	}

	var newID string
	err = tx.QueryRow(ctx, `
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
			null,
			null,
			0,
			false
		)
		returning id::text
	`, tenantContext.OrganizationID, session.ID, remoteJID, cleanPhone, contactName).Scan(&newID)
	if err != nil {
		var postgresError *pgconn.PgError
		if errors.As(err, &postgresError) &&
			postgresError.Code == "23505" &&
			(postgresError.ConstraintName == "whatsapp_conversations_session_id_remote_jid_key" ||
				postgresError.ConstraintName == "whatsapp_conversations_active_session_remote_jid_uidx") {
			return Conversation{}, ErrConversationBindingChanged
		}
		return Conversation{}, err
	}
	lockedLeadContact, err := resolveAccessibleLeadContact(ctx, tx, tenantContext, leadID, requestedIdentity)
	if err != nil {
		return Conversation{}, fmt.Errorf("%w: o telefone informado nao pertence ao lead selecionado", err)
	}
	if lockedLeadContact.Identity.RemoteJID != remoteJID || lockedLeadContact.Identity.ContactPhone != cleanPhone {
		return Conversation{}, ErrConversationBindingChanged
	}
	if sharedSession && lockedLeadContact.AssignedUserID != tenantContext.UserID {
		return Conversation{}, ErrSessionAccessRevoked
	}
	if err := lockOriginalWhatsAppActor(ctx, tx, tenantContext); err != nil {
		return Conversation{}, err
	}
	if sharedSession {
		if _, err := outboundSessionAccessGrantID(ctx, tx, tenantContext.OrganizationID, session.ID, tenantContext.UserID); err != nil {
			return Conversation{}, err
		}
	}
	if _, err := tx.Exec(ctx, `
		update public.whatsapp_conversations
		set assigned_user_id = nullif($2, '')::uuid,
		    updated_at = now()
		where id = $1::uuid
	`, newID, lockedLeadContact.AssignedUserID); err != nil {
		return Conversation{}, err
	}
	if _, err := activateRepositoryWhatsAppConversationLeadBindingIfExpected(
		ctx,
		tx,
		tenantContext.OrganizationID,
		newID,
		leadID,
		expectedPreviousLeadID,
	); err != nil {
		return Conversation{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Conversation{}, err
	}

	return repo.GetConversation(ctx, tenantContext, newID)
}

func (repo Repository) retireExpiredExactUnlinkedConversation(
	ctx context.Context,
	tenantContext tenant.Context,
	sessionID string,
	remoteJID string,
	ownSessionOnly bool,
) error {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	// resolveStartSession already checked the caller's current send grant.
	// Lock the session here without requiring ownership: a broker with a
	// valid shared-number grant may start a lead conversation on this number.
	var sessionExists bool
	err = tx.QueryRow(ctx, `
		select true
		from public.whatsapp_sessions ws
		where ws.organization_id = $1::uuid
		  and ws.id = $2::uuid
		  and ws.provider = 'evolution_go'
		  and coalesce(ws.is_active, true) = true
		  and ws.status = 'connected'
		  and (not $4::boolean or ws.owner_user_id = $3::uuid)
		for share of ws
	`, tenantContext.OrganizationID, sessionID, tenantContext.UserID, ownSessionOnly).Scan(&sessionExists)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrSessionNotFound
	}
	if err != nil {
		return err
	}
	var expiredID string
	err = tx.QueryRow(ctx, `
		select id::text
		from public.whatsapp_conversations
		where organization_id = $1::uuid
		  and session_id = $2::uuid
		  and remote_jid = $3
		  and retired_at is null
		  and lead_id is null
		  and unlinked_retention_v1
		  and coalesce(is_group, false) = false
		  and created_at <= clock_timestamp() - interval '7 days'
		limit 1
		for update
	`, tenantContext.OrganizationID, sessionID, remoteJID).Scan(&expiredID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if err := retireWhatsAppUnlinkedConversationEpoch(
		ctx, tx, tenantContext.OrganizationID, sessionID, expiredID, remoteJID,
	); err != nil {
		return err
	}
	return tx.Commit(ctx)
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
	expectedPreviousLeadID string,
) (string, accessibleLeadContact, bool, error) {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return "", accessibleLeadContact{}, false, err
	}
	defer tx.Rollback(ctx)

	// The session is the outer lock for every mutation that touches both
	// resources. Send/reaction/read and native ingress use the same
	// session -> conversation -> lead/dependent-row order.
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

	requestedAliases := requestedIdentity.RemoteAliases()
	if len(requestedAliases) == 0 || requestedIdentity.RemoteJID == "" {
		return "", accessibleLeadContact{}, false, ErrInvalidReference
	}

	var conversationID, existingLeadID string
	var unlinkedRetentionV1 bool
	err = tx.QueryRow(ctx, `
		select wc.id::text, coalesce(wc.lead_id::text, ''), wc.unlinked_retention_v1
		from public.whatsapp_conversations wc
		where wc.organization_id = $1::uuid
		  and wc.session_id = $2::uuid
		  and wc.deleted_at is null
		  and wc.retired_at is null
		  and `+conversationRetentionVisibilitySQL()+`
		  and coalesce(wc.is_group, false) = false
		  and wc.remote_jid = $3
		limit 1
		for update of wc
	`, tenantContext.OrganizationID, sessionID, requestedIdentity.RemoteJID).Scan(&conversationID, &existingLeadID, &unlinkedRetentionV1)
	if errors.Is(err, pgx.ErrNoRows) {
		leadContact, leadErr := resolveAccessibleLeadContact(ctx, tx, tenantContext, leadID, requestedIdentity)
		if leadErr != nil {
			return "", accessibleLeadContact{}, false, fmt.Errorf("%w: o telefone informado nao pertence ao lead selecionado", leadErr)
		}
		return "", leadContact, false, nil
	}
	if err != nil {
		return "", accessibleLeadContact{}, false, err
	}

	// Inside the locked session, the remaining global mutation order is
	// conversation -> lead. Revalidate both access and phone ownership only
	// after the exact quarantine row is locked so lead deletion and every
	// binding writer can never form a lock cycle.
	leadContact, err := resolveAccessibleLeadContact(ctx, tx, tenantContext, leadID, requestedIdentity)
	if err != nil {
		return "", accessibleLeadContact{}, false, fmt.Errorf("%w: o telefone informado nao pertence ao lead selecionado", err)
	}
	identity := leadContact.Identity
	aliases := identity.RemoteAliases()
	if len(aliases) == 0 || identity.RemoteJID != requestedIdentity.RemoteJID {
		return "", accessibleLeadContact{}, false, ErrInvalidReference
	}
	if existingLeadID != "" {
		// This is an already bound chat, not a quarantine row. Let the explicit
		// start path below activate the requested card through the binding RPC.
		return "", leadContact, false, nil
	}
	// Starting a lead chat is not consent to attach an earlier no-lead history.
	// A truly empty legacy route may still be claimed; any retained message or
	// prospective ephemeral marker requires a separate preview and confirmation.
	var hasRetainedMessages bool
	if err := tx.QueryRow(ctx, `
		select exists (
		  select 1
		  from public.whatsapp_messages wm
		  where wm.organization_id = $1::uuid
		    and wm.conversation_id = $2::uuid
		)
	`, tenantContext.OrganizationID, conversationID).Scan(&hasRetainedMessages); err != nil {
		return "", accessibleLeadContact{}, false, err
	}
	if unlinkedRetentionV1 || hasRetainedMessages {
		return "", accessibleLeadContact{}, false, ErrConversationHistoryLinkRequired
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
		set assigned_user_id = nullif($5, '')::uuid,
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
		  and lead_id is null
	`, tenantContext.OrganizationID, sessionID, conversationID, leadID, leadContact.AssignedUserID, identity.RemoteJID, identity.ContactPhone)
	if err != nil {
		return "", accessibleLeadContact{}, false, err
	}
	if tag.RowsAffected() != 1 {
		return "", accessibleLeadContact{}, false, ErrConversationNotFound
	}
	if _, err := activateRepositoryWhatsAppConversationLeadBindingIfExpected(
		ctx,
		tx,
		tenantContext.OrganizationID,
		conversationID,
		leadID,
		expectedPreviousLeadID,
	); err != nil {
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
	conversation, err := resolveConversationFind(
		filter,
		func(leadID string, sessionID string) (*Conversation, error) {
			if strings.TrimSpace(sessionID) != "" {
				return repo.findConversationByLeadAndSession(ctx, tenantContext, leadID, sessionID)
			}
			return repo.findConversationForLead(ctx, tenantContext, leadID)
		},
		func(phone string, sessionID string) (*Conversation, error) {
			identity := newWhatsAppContactIdentity(phone, phone, false)
			return repo.findConversationByPhoneVariants(ctx, tenantContext, identity.ConversationMatchValues(), sessionID)
		},
		func(conversation *Conversation, phone string) (bool, error) {
			return repo.conversationHasRequestedPhone(ctx, tenantContext, conversation, phone)
		},
	)
	if err == nil {
		repo.hydrateConversationAvatar(ctx, tenantContext.OrganizationID, conversation)
	}
	return conversation, err
}

type conversationLeadFinder func(leadID string, sessionID string) (*Conversation, error)
type conversationPhoneFinder func(phone string, sessionID string) (*Conversation, error)

// resolveConversationFind keeps the start-chat lookup deterministic while the
// repository callbacks retain the existing tenant and lead-visibility checks.
// A linked lead conversation wins only inside the explicitly selected session.
// Without a selected session, the historical cross-session lookup is retained
// for read/navigation compatibility. Starting a chat never migrates a physical
// conversation or its binding ledger between provider sessions.
func resolveConversationFind(
	filter FindConversationFilter,
	findByLead conversationLeadFinder,
	findByPhone conversationPhoneFinder,
	matchers ...conversationPhoneMatcher,
) (*Conversation, error) {
	if filter.Phone != "" && !isValidWhatsAppPhone(filter.Phone) {
		return nil, fmt.Errorf("%w: Telefone invalido para WhatsApp", ErrInvalidInput)
	}
	if filter.LeadID != "" {
		conversation, err := findByLead(filter.LeadID, filter.SessionID)
		if err != nil {
			return nil, err
		}
		if conversation != nil {
			if filter.Phone != "" {
				matcher := conversationHasExactPhone
				if len(matchers) > 0 {
					matcher = matchers[0]
				}
				matches, err := matcher(conversation, filter.Phone)
				if err != nil || !matches {
					return nil, err
				}
			}
			return conversation, nil
		}
	}

	if !isValidWhatsAppPhone(filter.Phone) {
		if filter.LeadID != "" {
			return nil, nil
		}
		return nil, fmt.Errorf("%w: Telefone invalido para WhatsApp", ErrInvalidInput)
	}

	conversation, err := findByPhone(filter.Phone, filter.SessionID)
	if err != nil || conversation == nil {
		return conversation, err
	}
	if filter.LeadID != "" {
		if pointerValue(conversation.LeadID) != filter.LeadID {
			return nil, nil
		}
		matcher := conversationHasExactPhone
		if len(matchers) > 0 {
			matcher = matchers[0]
		}
		matches, err := matcher(conversation, filter.Phone)
		if err != nil || !matches {
			return nil, err
		}
	}
	return conversation, nil
}

func (repo Repository) findConversationByExactSessionJID(ctx context.Context, tenantContext tenant.Context, sessionID string, remoteJID string) (*Conversation, error) {
	identity := newWhatsAppContactIdentity("", remoteJID, strings.Contains(strings.ToLower(remoteJID), "@g.us"))
	if identity.RemoteJID == "" {
		return nil, nil
	}

	args := append(baseConversationArgs(tenantContext), sessionID, identity.RemoteJID)
	conversation, err := scanConversation(repo.db.Pool().QueryRow(ctx, `
		select `+conversationSelectFields()+`
		from public.whatsapp_conversations wc
		left join public.whatsapp_sessions ws on ws.id = wc.session_id
		left join public.leads l on l.id = wc.lead_id
		left join public.pipelines pipeline on pipeline.id = l.pipeline_id
		left join public.stages stage on stage.id = l.stage_id
		where wc.organization_id = $1::uuid
		  and wc.deleted_at is null
		  and wc.retired_at is null
		  and `+conversationVisibilitySQL(canViewOwnWhatsAppLeads(tenantContext))+`
		  and wc.session_id = $5::uuid
		  and wc.remote_jid = $6
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
		  and `+conversationVisibilitySQL(canViewOwnWhatsAppLeads(tenantContext))+`
		  and wc.lead_id = $5::uuid
		  and wc.session_id = $6::uuid
		order by wc.last_message_at desc nulls last, wc.created_at desc
		limit 1
	`, args...))
	if errors.Is(err, pgx.ErrNoRows) {
		conversations, historyErr := repo.listLeadHistoryConversations(ctx, tenantContext, leadID, "")
		if historyErr != nil {
			return nil, historyErr
		}
		for _, historical := range conversations {
			if historical.SessionID == sessionID {
				historical.HistoricalLeadView = true
				return &historical, nil
			}
		}
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
		"wc.retired_at is null",
		conversationVisibilitySQL(canViewOwnWhatsAppLeads(tenantContext)),
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
