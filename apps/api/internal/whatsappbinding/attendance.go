package whatsappbinding

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// StartAssignedOwnerAttendance records explicit consent for this card on the
// owner's current connection. Callers hold the actor, session, conversation
// and lead locks and have already checked the phone and the requested binding.
// The manual attendance ledger preserves the ingress fence and idempotency.
func StartAssignedOwnerAttendance(ctx context.Context, tx pgx.Tx, actor tenant.Context, conversationID, sessionID, leadID string) (bool, error) {
	var eligible bool
	err := tx.QueryRow(ctx, `
		with target as (
		  select b.id as binding_id,
		         left(coalesce(nullif(btrim(u.name), ''), nullif(btrim(u.email), ''), 'Usuario'), 180) as actor_name
		  from public.whatsapp_conversation_lead_bindings b
		  join public.whatsapp_conversations c
		    on c.organization_id=b.organization_id and c.id=b.conversation_id
		   and c.session_id=b.session_id and c.lead_id=b.lead_id
		  join public.whatsapp_sessions s
		    on s.organization_id=b.organization_id and s.id=b.session_id
		  join public.leads l
		    on l.organization_id=b.organization_id and l.id=b.lead_id
		  join public.users u
		    on u.organization_id=b.organization_id and u.id=$5::uuid
		  join public.organization_members m
		    on m.organization_id=u.organization_id and m.user_id=u.id
		  where b.organization_id=$1::uuid and b.conversation_id=$2::uuid
		    and b.session_id=$3::uuid and b.lead_id=$4::uuid
		    and b.active_to is null and b.stale=false
		    and c.deleted_at is null and c.retired_at is null and c.is_group is not true
		    and s.owner_user_id=u.id and s.provider='evolution_go'
		    and coalesce(s.is_active,true) and s.status='connected'
		    and l.assigned_user_id=u.id
		    and coalesce(u.is_active,false) and coalesce(m.is_active,false) and m.deleted_at is null
		    and private.queue_pool_read_access(b.organization_id,b.lead_id,u.id) is null
		), started as (
		  insert into public.whatsapp_attendance_entries (
		    organization_id, conversation_id, session_id, lead_id, binding_id, user_id,
		    actor_name_snapshot, joined_at, ingress_sequence_cutoff
		  )
		  select $1::uuid,$2::uuid,$3::uuid,$4::uuid,target.binding_id,$5::uuid,
		         target.actor_name, clock_timestamp(),
		         case when ingress.is_called then ingress.last_value::bigint else 0::bigint end
		  from target cross join public.whatsapp_webhook_routing_ingress_sequence ingress
		  on conflict (organization_id, conversation_id, binding_id, session_id, user_id) do nothing
		)
		select exists (select 1 from target)
	`, actor.OrganizationID, conversationID, sessionID, leadID, actor.UserID).Scan(&eligible)
	return eligible, err
}
