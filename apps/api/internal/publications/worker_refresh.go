package publications

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// Reuse the same durable job and its attempt budget when the saved source
// changed. Both its lease and the current publication version are locked by
// processPublishJob; readiness and the actor's current access were revalidated.
func (repo Repository) refreshChangedSnapshot(
	ctx context.Context, tx pgx.Tx, workerID string, job pendingJob,
	publication publicationRecord, actor tenant.Context, source publicationSource,
	scope publicationScope, checks []Check,
) error {
	if !publishJobIsCurrent(publication, job) {
		return supersedeClaim(ctx, tx, workerID, job, "superseded", "Uma nova intenção de publicação substituiu este trabalho.")
	}
	if !publicationRefreshAllowed(publication, job) {
		return repo.finishRolledBackFailure(ctx, tx, workerID, job, "snapshot_changed",
			"O imóvel foi alterado repetidamente. Revise os dados e tente publicar novamente.",
			true, publicationRefreshExhaustedError(job))
	}
	versionID, err := repo.createVersion(ctx, tx, actor, source, publication, scope, checks)
	if err != nil {
		return err
	}
	if err := repo.markPublicationRequested(ctx, tx, actor, publication.ID,
		DesiredPublished, ObservedQueued, ReadinessReady, publication.CurrentVersion+1,
		checks, publication.ProviderListingID); err != nil {
		return err
	}
	command, err := tx.Exec(ctx, `
		update public.property_channel_publication_jobs
		set version_id = $4::uuid,
		    status = 'retry',
		    next_attempt_at = clock_timestamp(),
		    locked_at = null, locked_by = null, lease_token = null,
		    last_error_code = 'snapshot_refreshed',
		    last_error_message = 'A versão foi atualizada com os dados salvos antes da entrega.',
		    completed_at = null, dead_lettered_at = null,
		    updated_at = clock_timestamp()
		where id = $1::uuid and status = 'processing'
		  and locked_by = $2 and lease_token = $3::uuid
		  and attempts < max_attempts
	`, job.ID, workerID, job.LeaseToken, *versionID)
	if err != nil {
		return err
	}
	if command.RowsAffected() != 1 {
		return ErrPublicationConflict
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	wakePublicationWorker()
	return nil
}
