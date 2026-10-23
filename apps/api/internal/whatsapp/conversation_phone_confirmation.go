package whatsapp

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func validateStartPhoneConfirmation(request StartConversationRequest) error {
	invalid := func() error { return fmt.Errorf("%w: invalid phone-change confirmation snapshot", ErrInvalidInput) }
	if !request.ConfirmPhoneChange {
		if request.ExpectedPreviousConversationID != "" || request.ConfirmDestinationHistory || request.ExpectedDestinationConversationID != "" {
			return invalid()
		}
		return nil
	}
	leadID, valid := normalizeUUID(request.LeadID)
	previousLead, validPreviousLead := normalizeUUID(request.ExpectedPreviousLeadID)
	_, validSession := normalizeUUID(request.SessionID)
	_, validPreviousConversation := normalizeUUID(request.ExpectedPreviousConversationID)
	if !valid || !validPreviousLead || previousLead != leadID || !validSession || !validPreviousConversation {
		return invalid()
	}
	if request.ConfirmDestinationHistory {
		if _, valid := normalizeUUID(request.ExpectedDestinationConversationID); !valid {
			return invalid()
		}
	} else if strings.TrimSpace(request.ExpectedDestinationConversationID) != "" {
		return invalid()
	}
	return nil
}

// A response lost after commit may be read again only for the exact closed old
// binding and exact new current physical route. It never performs a second
// retirement/link, and a stale or forged previous route cannot pass the CAS.
func (repo Repository) findConfirmedPhoneChangeReplay(ctx context.Context, actor tenant.Context, session Session, leadID string, identity whatsappContactIdentity, request StartConversationRequest) (Conversation, bool, error) {
	oldID, valid := normalizeUUID(request.ExpectedPreviousConversationID)
	if !valid {
		return Conversation{}, true, ErrConversationBindingChanged
	}
	var id string
	err := repo.db.Pool().QueryRow(ctx, `select current.id::text
		from public.whatsapp_conversations current
		join public.whatsapp_conversations old on old.organization_id=current.organization_id and old.session_id=current.session_id
		where current.organization_id=$1::uuid and current.session_id=$2::uuid and current.lead_id=$3::uuid
		and current.remote_jid=$4 and current.deleted_at is null and current.retired_at is null
		and old.id=$5::uuid and old.id<>current.id and old.retired_at is not null and old.lead_id is null
		and old.deleted_at is null and old.remote_jid<>current.remote_jid
		and exists(select 1 from public.whatsapp_conversation_lead_bindings binding
		 where binding.organization_id=old.organization_id and binding.session_id=old.session_id and binding.conversation_id=old.id
		 and binding.lead_id=$3::uuid and binding.active_to is not null)
		and not exists(select 1 from public.whatsapp_conversation_lead_bindings binding
		 where binding.organization_id=old.organization_id and binding.conversation_id=old.id and binding.active_to is null)
		and (not $6::boolean or current.id=nullif($7,'')::uuid)`, actor.OrganizationID, session.ID, leadID, identity.RemoteJID, oldID,
		request.ConfirmDestinationHistory, request.ExpectedDestinationConversationID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return Conversation{}, true, ErrConversationBindingChanged
	}
	if err != nil {
		return Conversation{}, true, err
	}
	conversation, err := repo.GetConversation(ctx, actor, id)
	return conversation, true, err
}
