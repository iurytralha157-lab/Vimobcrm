package whatsapp

import (
	"context"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type conversationPhoneMatcher func(*Conversation, string) (bool, error)

func conversationHasExactPhone(conversation *Conversation, phone string) (bool, error) {
	requested := newWhatsAppContactIdentity(phone, phone, false)
	physical, ok := phoneFromIdentityValue(conversation.RemoteJID)
	if ok {
		return requested.ContactPhone != "" && physical == requested.ContactPhone, nil
	}
	physical, ok = phoneFromIdentityValue(pointerValue(conversation.ContactPhone))
	return ok && requested.ContactPhone != "" && physical == requested.ContactPhone, nil
}

// Read the physical identity, not ContactPhone from a history projection (which
// describes the current CRM lead). Ninth-digit heuristics are not proof that
// two provider accounts are the same; only persisted same-session aliases may
// authorize an alternative PN for this lookup.
func (repo Repository) conversationHasRequestedPhone(ctx context.Context, tenantContext tenant.Context, conversation *Conversation, phone string) (bool, error) {
	identity := newWhatsAppContactIdentity(phone, phone, false)
	var matches bool
	err := repo.db.Pool().QueryRow(ctx, `select exists (
		select 1 from public.whatsapp_conversations physical
		where physical.organization_id=$1::uuid and physical.id=$2::uuid and physical.session_id=$3::uuid
		and not physical.is_group and (
		  physical.remote_jid=any($4::text[])
		  or (physical.remote_jid not like '%@s.whatsapp.net' and physical.remote_jid not like '%@c.us'
		      and normalize_phone(physical.contact_phone)=normalize_phone($5))
		  or exists (select 1 from public.whatsapp_contact_identity_aliases alias
		    where alias.organization_id=physical.organization_id and alias.session_id=physical.session_id
		      and alias.canonical_jid=physical.remote_jid
		      and (alias.alias_jid=any($4::text[]) or normalize_phone(alias.contact_phone)=normalize_phone($5)))
		))`, tenantContext.OrganizationID, conversation.ID, conversation.SessionID,
		identity.RemoteAliases(), identity.ContactPhone).Scan(&matches)
	return matches, err
}
