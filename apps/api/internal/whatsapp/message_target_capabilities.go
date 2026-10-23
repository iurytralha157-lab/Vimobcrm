package whatsapp

import (
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// This is target eligibility, shared by the API validators and provider-start
// revalidation. A target does not itself grant session/lead access.
func messageTargetIdentitySQL(alias string) string {
	return alias + `.capture_state='captured' and ` + alias + `.unlinked_retention_scrubbed_at is null
	 and ` + alias + `.message_type not in ('reaction','deleted','deleted_event','system')
	 and coalesce(nullif(` + alias + `.provider_message_id,''),` + alias + `.message_id,'') <> ''
	 and octet_length(coalesce(nullif(` + alias + `.provider_message_id,''),` + alias + `.message_id,'')) <= 200
	 and coalesce(nullif(` + alias + `.provider_message_id,''),` + alias + `.message_id,'') !~ '[[:cntrl:]]'`
}

func messageTargetEligibleSQL(alias string) string {
	return `(` + messageTargetIdentitySQL(alias) + ` and (not ` + alias + `.from_me or lower(` + alias + `.status) in ('sent','delivered','read','played')))`
}

// Only the operational conversation feed exposes these capabilities. The
// historical feeds and default projections deliberately keep both false.
func operationalMessageTargetSQL(actor tenant.Context) string {
	if !actor.HasPermission(permissions.WhatsAppOperate) {
		return "false"
	}
	return `coalesce((` + messageTargetEligibleSQL("wm") + `
	 and wc.lead_id=wm.lead_id and wc.session_id=wm.session_id
	 and wc.deleted_at is null and wc.retired_at is null
	 and ws.provider='evolution_go' and ws.status='connected' and coalesce(ws.is_active,true)
	 and exists (
	  select 1 from public.whatsapp_conversation_lead_bindings binding
	  join public.whatsapp_sessions session on session.id=binding.session_id and session.organization_id=binding.organization_id
	  join public.users actor on actor.id=$2::uuid and actor.organization_id=binding.organization_id and coalesce(actor.is_active,false)
	  join public.organization_members member on member.user_id=actor.id and member.organization_id=actor.organization_id
	    and coalesce(member.is_active,false) and member.deleted_at is null
	  where binding.organization_id=wm.organization_id and binding.conversation_id=wm.conversation_id
	    and binding.session_id=wm.session_id and binding.lead_id=wm.lead_id and binding.active_to is null and not binding.stale
	    and (session.owner_user_id=$2::uuid or (l.assigned_user_id=$2::uuid and ` + sessionGrantExistsSQL("session", "$2::uuid", true) + `))
	 )),false)`
}
