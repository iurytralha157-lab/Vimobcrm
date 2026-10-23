package leads

import (
	"context"

	"github.com/jackc/pgx/v5"
)

// The caller already owns the explicit conversation set, before the exclusive
// lead lock. Keep the same seven
// work-family order as confirmed phone retirement. Every check precedes every
// cancellation, and all changes share the lead deletion transaction.
func prepareLeadWhatsAppDeletion(ctx context.Context, tx pgx.Tx, organizationID, leadID string, conversationIDs []string) error {
	activeConversation := `select wc.id from public.whatsapp_conversations wc where wc.organization_id=$1::uuid and wc.lead_id=$2::uuid and wc.deleted_at is null and wc.retired_at is null and wc.id=any($3::uuid[])`
	canonicalScope := `queued.organization_id=$1::uuid and queued.conversation_id=any($3::uuid[]) and exists(select 1 from public.whatsapp_messages message
	 where message.id=queued.message_id and message.organization_id=queued.organization_id and message.conversation_id=queued.conversation_id
	 and (message.lead_id=$2::uuid or (message.lead_id is null and queued.conversation_id in (` + activeConversation + `))))`
	conversationScope := `queued.organization_id=$1::uuid and queued.conversation_id in (` + activeConversation + `)`
	jobScope := `queued.organization_id=$1::uuid and queued.job_type='whatsapp_ai_autoreply' and queued.payload->>'conversationId' in (select id::text from (` + activeConversation + `) scoped)`
	executionScope := `queued.organization_id=$1::uuid and queued.conversation_id in (` + activeConversation + `) and (queued.lead_id=$2::uuid or queued.lead_id is null)`
	families := []struct{ table, scope, live, busy, cancel string }{
		{"whatsapp_outbox", canonicalScope, `queued.status in ('pending','retry','processing','dead','failed')`,
			`queued.status='processing' or (queued.status<>'sent' and queued.last_error in ('provider_delivery_started','provider_accepted_finalization_pending','provider_delivery_outcome_unknown'))`,
			`status='failed',failed_at=coalesce(failed_at,now()),locked_at=null,locked_by=null,last_error='lead_deleted',updated_at=now()`},
		{"outbox_messages", conversationScope, `queued.status in ('pending','processing')`, `queued.status='processing'`,
			`status='failed',processed_at=coalesce(processed_at,now()),error_message='lead_deleted'`},
		{"ai_jobs", conversationScope, `queued.status in ('pending','processing')`, `queued.status='processing'`,
			`status='cancelled',error_message='lead_deleted',completed_at=coalesce(completed_at,now())`},
		{"jobs", jobScope, `queued.status in ('queued','processing')`, `queued.status='processing'`,
			`status='cancelled',locked_at=null,last_error='lead_deleted',updated_at=now()`},
		{"ai_outbox_messages", conversationScope, `queued.status in ('draft','pending_approval','approved','sending')`, `queued.status='sending'`,
			`status='cancelled',failure_reason='lead_deleted',updated_at=now()`},
		{"automation_event_outbox", conversationScope, `queued.status in ('pending','failed','processing')`, `queued.status='processing'`,
			`status='dead_letter',dead_lettered_at=coalesce(dead_lettered_at,now()),locked_at=null,locked_by=null,last_error='lead_deleted',updated_at=now()`},
		{"automation_executions", executionScope, `queued.status in ('queued','waiting','running')`, `queued.status='running'`,
			`status='cancelled',cancellation_requested_at=coalesce(cancellation_requested_at,now()),completed_at=coalesce(completed_at,now()),error_message='lead_deleted',locked_at=null,locked_by=null,updated_at=now()`},
	}
	for _, family := range families {
		rows, err := tx.Query(ctx, `select queued.id from public.`+family.table+` queued where `+family.scope+` and (`+family.live+`) order by queued.id for update`, organizationID, leadID, conversationIDs)
		if err != nil {
			return err
		}
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return err
			}
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return err
		}
	}
	// Steps/effects are locked after executions, matching dispatcher/retirement.
	for _, table := range []string{"automation_execution_steps", "automation_effect_dispatches"} {
		rows, err := tx.Query(ctx, `select item.id from public.`+table+` item join public.automation_executions queued
		 on queued.id=item.execution_id and queued.organization_id=item.organization_id where `+executionScope+`
		 and item.status in ('running','waiting','sending') order by item.id for update of item`, organizationID, leadID, conversationIDs)
		if err != nil {
			return err
		}
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return err
			}
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return err
		}
	}
	for _, family := range families {
		var busy bool
		if err := tx.QueryRow(ctx, `select exists(select 1 from public.`+family.table+` queued where `+family.scope+` and (`+family.busy+`))`, organizationID, leadID, conversationIDs).Scan(&busy); err != nil {
			return err
		}
		if busy {
			return ErrWhatsAppSendInFlight
		}
	}
	var busyEffect bool
	if err := tx.QueryRow(ctx, `select exists(select 1 from public.automation_effect_dispatches dispatch join public.automation_executions queued
	 on queued.id=dispatch.execution_id and queued.organization_id=dispatch.organization_id where `+executionScope+` and dispatch.status='sending')`, organizationID, leadID, conversationIDs).Scan(&busyEffect); err != nil {
		return err
	}
	if busyEffect {
		return ErrWhatsAppSendInFlight
	}
	for _, family := range families {
		live := family.live
		if family.table == "whatsapp_outbox" {
			live = `queued.status in ('pending','retry')`
		}
		if _, err := tx.Exec(ctx, `update public.`+family.table+` queued set `+family.cancel+` where `+family.scope+` and (`+live+`)`, organizationID, leadID, conversationIDs); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(ctx, `update public.automation_execution_steps item set status='cancelled',completed_at=coalesce(item.completed_at,now()),error_message='lead_deleted'
	 from public.automation_executions queued where queued.id=item.execution_id and queued.organization_id=item.organization_id and `+executionScope+`
	 and queued.status='cancelled' and queued.error_message='lead_deleted' and item.status in ('running','waiting')`, organizationID, leadID, conversationIDs); err != nil {
		return err
	}
	// Immutable message lead_id scopes historical queues too. A conversation may
	// now belong to another card; only this deleted card's outbox is projected.
	if _, err := tx.Exec(ctx, `update public.whatsapp_messages message set status='failed',updated_at=now(),
	 metadata=coalesce(message.metadata,'{}'::jsonb)||jsonb_build_object('delivery_error_code','send_failed','delivery_failed_at',now())
	 from public.whatsapp_outbox queued where queued.message_id=message.id and `+canonicalScope+` and queued.status='failed' and queued.last_error='lead_deleted'`, organizationID, leadID, conversationIDs); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `update public.automation_effect_dispatches dispatch set status='failed',error_message='whatsapp_delivery_failed',completed_at=coalesce(dispatch.completed_at,now()),
	 response=coalesce(dispatch.response,'{}'::jsonb)||jsonb_build_object('status','failed','delivery_status','failed','delivery_error_code','send_failed')
	 from public.whatsapp_outbox queued where dispatch.organization_id=queued.organization_id and dispatch.response->>'outbox_id'=queued.id::text
	 and dispatch.request->>'delivery_contract'='canonical_whatsapp_outbox_v1' and dispatch.effect_key=queued.client_message_id
	 and dispatch.status='succeeded' and `+canonicalScope+` and queued.status='failed' and queued.last_error='lead_deleted'`, organizationID, leadID, conversationIDs); err != nil {
		return err
	}
	return nil
}
