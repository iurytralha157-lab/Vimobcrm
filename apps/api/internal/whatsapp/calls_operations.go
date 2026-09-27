package whatsapp

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func evolutionCallIDFromResponse(result map[string]any) string {
	data := mapFromAny(result["data"])
	callID := strings.TrimSpace(stringFromAny(firstPresentAny(
		data["callId"], data["call_id"], mapFromAny(data["data"])["callId"],
	)))
	if len(callID) > 256 {
		return ""
	}
	return callID
}

func (repo Repository) startCall(
	ctx context.Context,
	tenantContext tenant.Context,
	conversationID string,
) (WhatsAppCall, error) {
	conversation, err := repo.GetConversationSnapshot(ctx, tenantContext, conversationID)
	if err != nil {
		return WhatsAppCall{}, err
	}
	if conversation.IsGroup || conversation.DeletedAt != nil ||
		conversation.SessionID == "" || conversation.RemoteJID == "" {
		return WhatsAppCall{}, ErrInvalidReference
	}
	if err := repo.requireCallFeature(ctx, tenantContext, conversation.SessionID, "whatsapp_calls_enabled"); err != nil {
		return WhatsAppCall{}, err
	}
	// The destination is read from the authorized conversation. A caller cannot
	// substitute an arbitrary phone or lead ID in the HTTP request.
	result, err := repo.functions.invokeEvolution(ctx, "call.start", map[string]any{
		"session_id": conversation.SessionID,
		"body":       map[string]any{"peerJid": conversation.RemoteJID},
	})
	if err != nil {
		return WhatsAppCall{}, err
	}
	providerCallID := evolutionCallIDFromResponse(result)
	if providerCallID == "" {
		return WhatsAppCall{}, fmt.Errorf("%w: provider started a call without returning an identity", ErrProviderOutcomeUnknown)
	}

	// The provider may have emitted CallState before its HTTP response arrived.
	// Preserve the event's state, and only adopt the card snapshot if it still
	// names the exact session/peer/lead observed before calling the provider.
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return WhatsAppCall{}, callStartPersistenceUnknown(err)
	}
	defer tx.Rollback(ctx)
	var currentLeadID *string
	var validBinding bool
	err = tx.QueryRow(ctx, `
		select c.lead_id::text,
		  c.organization_id = $1::uuid
		  and c.session_id = $2::uuid
		  and c.remote_jid = $3
		  and c.deleted_at is null
		  and coalesce(c.is_group, false) = false
		  and c.lead_id is not distinct from nullif($5,'')::uuid
		from public.whatsapp_conversations c
		where c.id = $4::uuid
	`, tenantContext.OrganizationID, conversation.SessionID,
		conversation.RemoteJID, conversation.ID, nullableString(conversation.LeadID)).Scan(
		&currentLeadID, &validBinding,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		validBinding = false
		err = nil
	}
	if err != nil {
		return WhatsAppCall{}, callStartPersistenceUnknown(err)
	}
	boundConversationID, boundLeadID := "", ""
	if validBinding {
		boundConversationID = conversation.ID
		boundLeadID = nullableString(conversation.LeadID)
	}
	var persistedID string
	err = tx.QueryRow(ctx, `
		insert into public.whatsapp_calls (
		  organization_id, session_id, operator_user_id,
		  provider_call_id, remote_jid, direction, state, source,
		  offered_at, last_event_at
		) values (
		  $1::uuid, $2::uuid, $3::uuid,
		  $4, $5, 'outgoing', 'outgoing', 'meowcaller', now(), now()
		)
		on conflict (session_id, provider_call_id) do update
		set operator_user_id = excluded.operator_user_id
		where whatsapp_calls.organization_id = excluded.organization_id
		  and (
		    whatsapp_calls.remote_jid = excluded.remote_jid
		    or exists (
		      select 1 from public.whatsapp_contact_identity_aliases alias
		      where alias.organization_id = excluded.organization_id
		        and alias.session_id = excluded.session_id
		        and alias.alias_jid = whatsapp_calls.remote_jid
		        and alias.canonical_jid = excluded.remote_jid
		    )
		  )
		  and whatsapp_calls.direction = 'outgoing'
		returning id::text
	`, tenantContext.OrganizationID, conversation.SessionID,
		tenantContext.UserID, providerCallID, conversation.RemoteJID).Scan(&persistedID)
	if errors.Is(err, pgx.ErrNoRows) {
		return WhatsAppCall{}, fmt.Errorf("%w: provider call identity conflict", ErrProviderOutcomeUnknown)
	}
	if err != nil {
		return WhatsAppCall{}, callStartPersistenceUnknown(err)
	}
	if boundConversationID != "" {
		if _, err := tx.Exec(ctx, `savepoint whatsapp_call_binding`); err != nil {
			return WhatsAppCall{}, callStartPersistenceUnknown(err)
		}
		_, bindErr := tx.Exec(ctx, `
			update public.whatsapp_calls
			set conversation_id = coalesce(conversation_id, $2::uuid),
			    lead_id = coalesce(lead_id, nullif($3,'')::uuid)
			where id = $1::uuid
		`, persistedID, boundConversationID, boundLeadID)
		if bindErr != nil {
			if _, err := tx.Exec(ctx, `rollback to savepoint whatsapp_call_binding`); err != nil {
				return WhatsAppCall{}, callStartPersistenceUnknown(errors.Join(bindErr, err))
			}
		}
		if _, err := tx.Exec(ctx, `release savepoint whatsapp_call_binding`); err != nil {
			return WhatsAppCall{}, callStartPersistenceUnknown(err)
		}
	}
	if _, err := tx.Exec(ctx, `savepoint whatsapp_call_timeline`); err != nil {
		return WhatsAppCall{}, callStartPersistenceUnknown(err)
	}
	if timelineErr := updateWhatsAppCallTimeline(ctx, tx, persistedID); timelineErr != nil {
		// The call row is more important than a timeline projection. A later
		// CallState callback retries the same deterministic timeline ID.
		if _, err := tx.Exec(ctx, `rollback to savepoint whatsapp_call_timeline`); err != nil {
			return WhatsAppCall{}, callStartPersistenceUnknown(errors.Join(timelineErr, err))
		}
	}
	if _, err := tx.Exec(ctx, `release savepoint whatsapp_call_timeline`); err != nil {
		return WhatsAppCall{}, callStartPersistenceUnknown(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return WhatsAppCall{}, callStartPersistenceUnknown(err)
	}
	call, err := repo.ownedCall(ctx, tenantContext, persistedID)
	if err != nil {
		return WhatsAppCall{}, callStartPersistenceUnknown(err)
	}
	return call, nil
}

func callStartPersistenceUnknown(err error) error {
	return fmt.Errorf("%w: call started but its CRM persistence requires reconciliation: %v", ErrProviderOutcomeUnknown, err)
}

func nullableString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func (repo Repository) callAction(
	ctx context.Context,
	tenantContext tenant.Context,
	callID string,
	action string,
) (WhatsAppCall, error) {
	if !stringIn(action, "accept", "reject", "end") {
		return WhatsAppCall{}, ErrInvalidInput
	}
	call, err := repo.ownedCall(ctx, tenantContext, callID)
	if err != nil {
		return WhatsAppCall{}, err
	}
	if err := repo.requireCallFeature(ctx, tenantContext, call.SessionID, "whatsapp_calls_enabled"); err != nil {
		return WhatsAppCall{}, err
	}
	if action == "accept" && !stringIn(call.State, "incoming", "ringing") ||
		action == "reject" && !stringIn(call.State, "incoming", "ringing") ||
		action == "end" && stringIn(call.State, "rejected", "ended", "failed") {
		return WhatsAppCall{}, ErrInvalidReference
	}
	claimToken := ""
	if action == "accept" {
		err = repo.db.Pool().QueryRow(ctx, `
			update public.whatsapp_calls
			set operator_user_id = $3::uuid,
			    answer_claim_token = gen_random_uuid(),
			    answer_claimed_at = now()
			where id = $1::uuid
			  and organization_id = $2::uuid
			  and session_id = $4::uuid
			  and provider_call_id = $5
			  and state in ('incoming', 'ringing')
			  and answer_claim_token is null
			returning answer_claim_token::text
		`, call.ID, tenantContext.OrganizationID, tenantContext.UserID,
			call.SessionID, call.ProviderCallID).Scan(&claimToken)
		if errors.Is(err, pgx.ErrNoRows) {
			return WhatsAppCall{}, ErrCallAlreadyClaimed
		}
		if err != nil {
			return WhatsAppCall{}, err
		}
	}
	providerResult, err := repo.functions.invokeEvolution(ctx, "call."+action, map[string]any{
		"session_id": call.SessionID,
		"body":       map[string]any{"callId": call.ProviderCallID},
	})
	if err != nil {
		if errors.Is(err, ErrProviderOutcomeUnknown) && stringIn(action, "end", "reject") {
			if stateErr := repo.setCallProvisionalState(ctx, call.ID, tenantContext.OrganizationID, "outcome_unknown"); stateErr != nil {
				return WhatsAppCall{}, errors.Join(err, stateErr)
			}
		}
		if claimToken != "" && !errors.Is(err, ErrProviderOutcomeUnknown) {
			_, _ = repo.db.Pool().Exec(ctx, `
				update public.whatsapp_calls
				set operator_user_id = null,
				    answer_claim_token = null,
				    answer_claimed_at = null
				where id = $1::uuid and answer_claim_token = $2::uuid
				  and state in ('incoming','ringing')
			`, call.ID, claimToken)
		}
		return WhatsAppCall{}, err
	}
	if stringIn(action, "end", "reject") {
		view := mapFromAny(providerResult["data"])
		providerState := strings.TrimSpace(stringFromAny(view["state"]))
		if providerState == "" {
			providerState = strings.TrimSpace(stringFromAny(mapFromAny(view["data"])["state"]))
		}
		if !stringIn(providerState, "end_pending", "reject_pending", "outcome_unknown") {
			providerState = action + "_pending"
		}
		if err := repo.setCallProvisionalState(ctx, call.ID, tenantContext.OrganizationID, providerState); err != nil {
			return WhatsAppCall{}, err
		}
	}
	return repo.ownedCall(ctx, tenantContext, call.ID)
}

func (repo Repository) setCallProvisionalState(
	ctx context.Context,
	callID string,
	organizationID string,
	state string,
) error {
	if !stringIn(state, "end_pending", "reject_pending", "outcome_unknown") {
		return ErrInvalidInput
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var storedID string
	err = tx.QueryRow(ctx, `
		update public.whatsapp_calls
		set state = $3
		where id = $1::uuid and organization_id = $2::uuid
		  and (
		    state in ('incoming','outgoing','ringing','active')
		    or state = $3
		    or ($3 = 'outcome_unknown' and state in ('end_pending','reject_pending'))
		  )
		returning id::text
	`, callID, organizationID, state).Scan(&storedID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if err := updateWhatsAppCallTimeline(ctx, tx, storedID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (repo Repository) saveLeadContact(
	ctx context.Context,
	tenantContext tenant.Context,
	sessionID string,
	leadID string,
) error {
	leadID, valid := normalizeUUID(leadID)
	if !valid {
		return ErrInvalidReference
	}
	if err := repo.requireCallFeature(ctx, tenantContext, sessionID, "whatsapp_contact_save_enabled"); err != nil {
		return err
	}
	args := append(baseConversationArgs(tenantContext), leadID)
	var name, phone string
	err := repo.db.Pool().QueryRow(ctx, `
		select coalesce(nullif(btrim(l.name), ''), ''),
		       coalesce(nullif(btrim(l.phone), ''), nullif(btrim(to_jsonb(l)->>'whatsapp'), ''), '')
		from public.leads l
		where l.organization_id = $1::uuid
		  and l.id = $5::uuid
		  and `+leadVisibilitySQL(canViewOwnWhatsAppLeads(tenantContext))+`
	`, args...).Scan(&name, &phone)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrInvalidReference
	}
	if err != nil {
		return err
	}
	identity := newWhatsAppContactIdentity(phone, phone, false)
	if identity.ContactPhone == "" || name == "" {
		return ErrInvalidReference
	}
	_, err = repo.functions.invokeEvolution(ctx, "user.contact.save", map[string]any{
		"session_id": sessionID,
		"body": map[string]any{
			"number": identity.ContactPhone, "fullName": name,
		},
	})
	return err
}

func (repo Repository) saveConversationContact(
	ctx context.Context,
	tenantContext tenant.Context,
	conversationID string,
	fullName string,
) error {
	conversation, err := repo.GetConversationSnapshot(ctx, tenantContext, conversationID)
	if err != nil {
		return err
	}
	if conversation.IsGroup || conversation.SessionID == "" {
		return ErrInvalidReference
	}
	if err := repo.requireCallFeature(ctx, tenantContext, conversation.SessionID, "whatsapp_contact_save_enabled"); err != nil {
		return err
	}
	fullName = strings.TrimSpace(fullName)
	if fullName == "" || len(fullName) > 160 || strings.ContainsAny(fullName, "\r\n\x00") {
		return ErrInvalidInput
	}
	identity := newWhatsAppContactIdentity(nullableString(conversation.ContactPhone), conversation.RemoteJID, false)
	if identity.ContactPhone == "" {
		return ErrInvalidReference
	}
	_, err = repo.functions.invokeEvolution(ctx, "user.contact.save", map[string]any{
		"session_id": conversation.SessionID,
		"body": map[string]any{
			"number": identity.ContactPhone, "fullName": fullName,
		},
	})
	return err
}
