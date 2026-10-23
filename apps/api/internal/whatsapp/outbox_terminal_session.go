package whatsapp

import "context"

// A disconnected session can resume. A deleted, disabled, inactive, foreign or
// wrong-provider session cannot claim queued work, so recovery must close that
// unstarted work explicitly. Accepted/started/unknown outcomes are excluded.
func (repo Repository) recoverUnavailableWhatsAppOutboxBatch(ctx context.Context, limit int) (int, error) {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `set local lock_timeout='2s'; set local statement_timeout='10s'`); err != nil {
		return 0, err
	}
	rows, err := tx.Query(ctx, `
		with candidates as materialized (
		  select queued.id
		  from public.whatsapp_outbox queued
		  where queued.status in ('pending','retry')
		    and coalesce(queued.last_error,'') not in ($2,$3,$4)
		    and not exists (
		      select 1 from public.whatsapp_sessions session
		      where session.id=queued.session_id
		        and session.organization_id=queued.organization_id
		        and session.provider='evolution_go'
		        and coalesce(session.is_active,true)
		        and coalesce(session.status,'') not in ('deleted','disabled')
		    )
		  order by queued.id limit $1 for update of queued skip locked
		), changed as (
		  update public.whatsapp_outbox queued
		  set status='failed',failed_at=coalesce(failed_at,now()),
		      locked_at=null,locked_by=null,last_error='delivery_session_unavailable',updated_at=now()
		  from candidates where queued.id=candidates.id
		  returning queued.id::text
		)
		select id from changed order by id
	`, normalizeWorkerBatch(limit, whatsappOutboxRecoveryBatch), whatsappOutboxProviderStartedMarker,
		whatsappOutboxProviderAcceptedMarker, whatsappOutboxProviderUnknownMarker)
	if err != nil {
		return 0, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, err
	}
	rows.Close()
	if len(ids) > 0 {
		if err := repo.syncTerminalWhatsAppOutboxFailuresBatch(ctx, tx, ids); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return len(ids), nil
}
