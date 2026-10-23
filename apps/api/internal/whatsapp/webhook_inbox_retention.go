package whatsapp

import "context"

// Receipt families expire atomically. A bounded cleanup batch may defer a
// whole family when its members are not all locked and eligible in this batch.
func (repo Repository) CleanupExpiredWebhookInbox(ctx context.Context, limit int) (int64, error) {
	if limit < 1 || limit > 10000 {
		limit = 1000
	}
	result, err := repo.db.Pool().Exec(ctx, `
		with expired_candidates as materialized (
			select id, organization_id, session_id, processing_epoch, payload
			from public.whatsapp_webhook_inbox
			where expires_at < now()
			  and not (
			    coalesce(payload #>> '{__vimob_ingress,receipt_effect,version}', '') = '1'
			    and coalesce(payload #>> '{__vimob_ingress,routing_key}', '') like 'receipt-target:%'
			    and (
			      status = 'dead'
			      or exists (
			        select 1
			        from public.whatsapp_webhook_inbox sibling
			        where sibling.organization_id = whatsapp_webhook_inbox.organization_id
			          and sibling.session_id = whatsapp_webhook_inbox.session_id
			          and sibling.processing_epoch = whatsapp_webhook_inbox.processing_epoch
			          and sibling.payload #>> '{__vimob_ingress,receipt_effect,parent_event_key}' =
			              whatsapp_webhook_inbox.payload #>> '{__vimob_ingress,receipt_effect,parent_event_key}'
			          and (
			            sibling.status in ('pending', 'retry', 'processing', 'dead')
			            or sibling.expires_at >= now()
			          )
			      )
			    )
			  )
			  and (
			    status = 'processed'
			    or (
			      status = 'dead'
			      and not (
			        strpos(lower(btrim(event_type)), 'message') > 0
			        and strpos(lower(btrim(event_type)), 'receipt') = 0
			        and strpos(lower(btrim(event_type)), 'ack') = 0
			        and strpos(lower(btrim(event_type)), 'status') = 0
			      )
			    )
			  )
			order by expires_at, id
			limit $1
			for update skip locked
		), expired as (
			select candidate.id
			from expired_candidates candidate
			where not (
			  coalesce(candidate.payload #>> '{__vimob_ingress,receipt_effect,version}', '') = '1'
			  and coalesce(candidate.payload #>> '{__vimob_ingress,routing_key}', '') like 'receipt-target:%'
			)
			or not exists (
			  select 1
			  from public.whatsapp_webhook_inbox sibling
			  where sibling.organization_id = candidate.organization_id
			    and sibling.session_id = candidate.session_id
			    and sibling.processing_epoch = candidate.processing_epoch
			    and sibling.payload #>> '{__vimob_ingress,receipt_effect,parent_event_key}' =
			        candidate.payload #>> '{__vimob_ingress,receipt_effect,parent_event_key}'
			    and not exists (select 1 from expired_candidates selected where selected.id = sibling.id)
			)
		)
		delete from public.whatsapp_webhook_inbox inbox
		using expired
		where inbox.id = expired.id
	`, limit)
	if err != nil {
		return 0, err
	}
	provenanceLimit := limit
	if provenanceLimit > 250 {
		provenanceLimit = 250
	}
	var deletedProvenance int64
	if err := repo.db.Pool().QueryRow(ctx, `
		select private.cleanup_whatsapp_webhook_routing_provenance($1)::bigint
	`, provenanceLimit).Scan(&deletedProvenance); err != nil {
		return result.RowsAffected(), err
	}
	return result.RowsAffected(), nil
}
