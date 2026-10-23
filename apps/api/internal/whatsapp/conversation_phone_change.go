package whatsapp

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

var ErrPhoneChangeConfirmationRequired = errors.New("whatsapp phone change requires confirmation")
var ErrConversationSendInFlight = errors.New("whatsapp conversation has an unfinished provider send")

type PhoneChangeConfirmation struct {
	ConversationID                         string  `json:"conversationId"`
	LeadID                                 string  `json:"leadId"`
	SessionID                              string  `json:"sessionId"`
	DestinationConversationID              *string `json:"destinationConversationId,omitempty"`
	RequiresDestinationHistoryConfirmation bool    `json:"requiresDestinationHistoryConfirmation,omitempty"`
}

type phoneChangeConfirmationError struct{ PhoneChangeConfirmation }

func (err *phoneChangeConfirmationError) Error() string {
	return ErrPhoneChangeConfirmationRequired.Error()
}
func (err *phoneChangeConfirmationError) Unwrap() error { return ErrPhoneChangeConfirmationRequired }

// Correcting a CRM phone never repurposes an existing provider JID. An explicit
// CAS confirmation retires its old route and opens a fresh physical chat while
// preserving immutable lead history. New attendance is a separate action.
func (repo Repository) startCorrectedPhoneConversation(ctx context.Context, actor tenant.Context, session Session, leadID string, requested whatsappContactIdentity, request StartConversationRequest) (Conversation, bool, error) {
	var old Conversation
	err := repo.db.Pool().QueryRow(ctx, `select id::text,session_id::text,remote_jid,contact_phone
		from public.whatsapp_conversations where organization_id=$1::uuid and session_id=$2::uuid and lead_id=$3::uuid
		and deleted_at is null and retired_at is null and not is_group limit 1`, actor.OrganizationID, session.ID, leadID).Scan(&old.ID, &old.SessionID, &old.RemoteJID, &old.ContactPhone)
	if errors.Is(err, pgx.ErrNoRows) {
		if request.ConfirmPhoneChange {
			return repo.findConfirmedPhoneChangeReplay(ctx, actor, session, leadID, requested, request)
		}
		return Conversation{}, false, nil
	}
	if err != nil {
		return Conversation{}, false, err
	}
	matches, err := repo.conversationHasRequestedPhone(ctx, actor, &old, requested.ContactPhone)
	if err != nil || matches {
		if err == nil && request.ConfirmPhoneChange {
			return repo.findConfirmedPhoneChangeReplay(ctx, actor, session, leadID, requested, request)
		}
		return Conversation{}, false, err
	}
	// A physical destination already bound to another card, or awaiting history
	// consent, cannot be hidden by retiring the old route first.
	destination, err := readPhoneChangeDestination(ctx, repo.db.Pool(), actor.OrganizationID, session.ID, requested.RemoteJID, false)
	if err != nil {
		return Conversation{}, true, err
	}
	if err := validatePhoneChangeDestination(destination, session.OwnerUserID == actor.UserID); err != nil {
		return Conversation{}, true, err
	}
	if !request.ConfirmPhoneChange {
		snapshot := PhoneChangeConfirmation{ConversationID: old.ID, LeadID: leadID, SessionID: session.ID}
		if destination != nil {
			snapshot.DestinationConversationID = &destination.ID
			snapshot.RequiresDestinationHistoryConfirmation = true
		}
		return Conversation{}, true, &phoneChangeConfirmationError{snapshot}
	}
	previousID, valid := normalizeUUID(request.ExpectedPreviousConversationID)
	if !valid || previousID != old.ID || request.ExpectedPreviousLeadID != leadID {
		return Conversation{}, true, ErrConversationBindingChanged
	}
	if destination != nil {
		requestedDestinationID, valid := normalizeUUID(request.ExpectedDestinationConversationID)
		if !request.ConfirmDestinationHistory || !valid || requestedDestinationID != destination.ID {
			return Conversation{}, true, ErrConversationBindingChanged
		}
	} else if request.ConfirmDestinationHistory || request.ExpectedDestinationConversationID != "" {
		return Conversation{}, true, ErrConversationBindingChanged
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return Conversation{}, true, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `set local lock_timeout='3s';set local statement_timeout='10s'`); err != nil {
		return Conversation{}, true, err
	}
	if err := lockConversationSendSession(ctx, tx, actor, session.ID); err != nil {
		return Conversation{}, true, err
	}
	var lockedOwner string
	if err := tx.QueryRow(ctx, `select owner_user_id::text from public.whatsapp_sessions where organization_id=$1::uuid and id=$2::uuid`, actor.OrganizationID, session.ID).Scan(&lockedOwner); err != nil {
		return Conversation{}, true, err
	}
	if lockedOwner != session.OwnerUserID {
		return Conversation{}, true, ErrConversationBindingChanged
	}
	if err := validateStartSessionOwnership(request.OwnSessionOnly, lockedOwner, actor.UserID); err != nil {
		return Conversation{}, true, err
	}
	var lockedJID string
	err = tx.QueryRow(ctx, `select remote_jid from public.whatsapp_conversations
		where organization_id=$1::uuid and id=$2::uuid and session_id=$3::uuid and lead_id=$4::uuid
		and deleted_at is null and retired_at is null for update`, actor.OrganizationID, old.ID, session.ID, leadID).Scan(&lockedJID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Conversation{}, true, ErrConversationBindingChanged
	}
	if err != nil {
		return Conversation{}, true, err
	}
	if lockedJID != old.RemoteJID {
		return Conversation{}, true, ErrConversationBindingChanged
	}
	contact, err := resolveAccessibleLeadContact(ctx, tx, actor, leadID, requested)
	if err != nil {
		return Conversation{}, true, err
	}
	if contact.Identity.RemoteJID != requested.RemoteJID || contact.Identity.ContactPhone != requested.ContactPhone {
		return Conversation{}, true, ErrConversationBindingChanged
	}
	if err := requireOriginalWhatsAppOrganization(ctx, tx, actor); err != nil {
		return Conversation{}, true, err
	}
	lockedDestination, err := readPhoneChangeDestination(ctx, tx, actor.OrganizationID, session.ID, requested.RemoteJID, true)
	if err != nil {
		return Conversation{}, true, err
	}
	if err := validatePhoneChangeDestination(lockedDestination, lockedOwner == actor.UserID); err != nil {
		return Conversation{}, true, err
	}
	if (destination == nil) != (lockedDestination == nil) || (destination != nil && destination.ID != lockedDestination.ID) {
		return Conversation{}, true, ErrConversationBindingChanged
	}
	var preparationRaw []byte
	if err := tx.QueryRow(ctx, `select private.prepare_whatsapp_confirmed_phone_route_retirement($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid)`, actor.OrganizationID, session.ID, old.ID, leadID, actor.UserID).Scan(&preparationRaw); err != nil {
		var databaseError *pgconn.PgError
		if errors.As(err, &databaseError) {
			if databaseError.Code == "55000" {
				return Conversation{}, true, ErrConversationSendInFlight
			}
			if databaseError.Code == "40001" {
				return Conversation{}, true, ErrConversationBindingChanged
			}
			if databaseError.Code == "42501" {
				return Conversation{}, true, tenant.ErrOrganizationAccessDenied
			}
		}
		return Conversation{}, true, err
	}
	var prepared struct {
		Prepared       bool     `json:"prepared"`
		ConversationID string   `json:"conversation_id"`
		CanceledIDs    []string `json:"canceled_outbox_ids"`
	}
	if err := json.Unmarshal(preparationRaw, &prepared); err != nil || !prepared.Prepared || prepared.ConversationID != old.ID {
		return Conversation{}, true, ErrConversationBindingChanged
	}
	// The helper has fenced the actor/member before the exact grant row. User
	// deactivation also takes actor -> grant, so taking this lock sooner would
	// invert that order while waiting for the helper's actor fence.
	if lockedOwner != actor.UserID {
		if _, err := outboundSessionAccessGrantID(ctx, tx, actor.OrganizationID, session.ID, actor.UserID); err != nil {
			return Conversation{}, true, err
		}
	}
	if len(prepared.CanceledIDs) > 0 {
		if err := repo.syncTerminalWhatsAppOutboxFailuresBatch(ctx, tx, prepared.CanceledIDs); err != nil {
			return Conversation{}, true, err
		}
	}
	if _, err := tx.Exec(ctx, `update public.whatsapp_conversation_lead_bindings set active_to=clock_timestamp()
		where organization_id=$1::uuid and conversation_id=$2::uuid and session_id=$3::uuid and lead_id=$4::uuid and active_to is null;
		update public.whatsapp_conversations set retired_at=clock_timestamp(),lead_id=null,assigned_user_id=null,updated_at=now() where organization_id=$1::uuid and id=$2::uuid`, actor.OrganizationID, old.ID, session.ID, leadID); err != nil {
		return Conversation{}, true, err
	}
	var newID string
	if lockedDestination != nil {
		result, err := confirmUnlinkedHistoryBinding(ctx, tx, actor.OrganizationID, lockedDestination.ID, leadID, actor.UserID, "manual_link")
		if err != nil {
			return Conversation{}, true, err
		}
		if result.BindingMode != "active" {
			return Conversation{}, true, ErrConversationBindingChanged
		}
		newID = lockedDestination.ID
	} else {
		if err := tx.QueryRow(ctx, `insert into public.whatsapp_conversations
		(organization_id,session_id,remote_jid,contact_phone,contact_name,assigned_user_id,is_group)
		values($1::uuid,$2::uuid,$3,$4,$5,nullif($6,'')::uuid,false) returning id::text`, actor.OrganizationID, session.ID,
			requested.RemoteJID, requested.ContactPhone, firstNonEmpty(request.LeadName, requested.ContactPhone), contact.AssignedUserID).Scan(&newID); err != nil {
			return Conversation{}, true, err
		}
		if _, err := activateRepositoryWhatsAppConversationLeadBindingIfExpected(ctx, tx, actor.OrganizationID, newID, leadID, unlinkedConversationLeadSnapshot); err != nil {
			return Conversation{}, true, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return Conversation{}, true, err
	}
	conversation, err := repo.GetConversation(ctx, actor, newID)
	return conversation, true, err
}

type phoneChangeDestination struct {
	ID       string
	LeadID   *string
	Eligible bool
}

func readPhoneChangeDestination(ctx context.Context, queryer whatsappQueryRower, organizationID, sessionID, remoteJID string, lock bool) (*phoneChangeDestination, error) {
	destination := phoneChangeDestination{}
	query := `select id::text,lead_id::text,(unlinked_retention_v1 and unlinked_retention_scrubbed_at is null and created_at>clock_timestamp()-interval '7 days') from public.whatsapp_conversations
		where organization_id=$1::uuid and session_id=$2::uuid and remote_jid=$3 and deleted_at is null and retired_at is null`
	if lock {
		query += " for update"
	}
	err := queryer.QueryRow(ctx, query, organizationID, sessionID, remoteJID).Scan(&destination.ID, &destination.LeadID, &destination.Eligible)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &destination, nil
}

func validatePhoneChangeDestination(destination *phoneChangeDestination, owner bool) error {
	if destination == nil {
		return nil
	}
	if destination.LeadID != nil || !destination.Eligible {
		return ErrConversationBindingChanged
	}
	if !owner {
		return ErrConversationHistoryLinkRequired
	}
	return nil
}
