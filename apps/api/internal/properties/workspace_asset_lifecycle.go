package properties

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	propertyAssetCleanupWorkerInterval = 30 * time.Second
	propertyAssetCleanupWorkerBatch    = 100
	propertyAssetUploadExpiryMargin    = 5 * time.Minute
)

func consumePropertyAssetUploadIntent(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	propertyID string,
	storagePath string,
	assetType string,
	mimeType string,
	fileSizeBytes *int64,
) error {
	if fileSizeBytes == nil {
		return fmt.Errorf("%w: upload reservation size is missing", ErrInvalidInput)
	}
	var intentID string
	err := tx.QueryRow(ctx, `
		select intent.id::text
		from public.property_asset_upload_intents as intent
		where organization_id = $1::uuid
		  and property_id = $2::uuid
		  and storage_path = $3
		  and asset_type = $4
		  and mime_type = lower(btrim($5))
		  and file_size_bytes = $6::bigint
		  and expires_at > now()
		  and consumed_at is null
		  and discard_requested_at is null
		for update of intent
	`, organizationID, propertyID, storagePath, assetType, mimeType, *fileSizeBytes).Scan(&intentID)
	if err == pgx.ErrNoRows {
		return fmt.Errorf("%w: private upload reservation is missing, expired, or already consumed", ErrInvalidInput)
	}
	if err != nil {
		return err
	}
	return nil
}

func completePropertyAssetUploadIntent(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	propertyID string,
	storagePath string,
) error {
	command, err := tx.Exec(ctx, `
		update public.property_asset_upload_intents
		set consumed_at = now(),
		    cleanup_claimed_until = null,
		    last_cleanup_error = null
		where organization_id = $1::uuid
		  and property_id = $2::uuid
		  and storage_path = $3
		  and consumed_at is null
		  and discard_requested_at is null
	`, organizationID, propertyID, storagePath)
	if err != nil {
		return err
	}
	if command.RowsAffected() != 1 {
		return fmt.Errorf("%w: private upload reservation could not be completed", ErrInvalidInput)
	}
	return nil
}

type propertyAssetCleanupCandidate struct {
	ID          string
	StoragePath string
	Consumed    bool
}

func (repo Repository) cleanupExpiredPropertyAssetUploads(ctx context.Context, organizationID string, limit int) error {
	if limit <= 0 {
		return nil
	}
	rows, err := repo.db.Pool().Query(ctx, `
		with candidates as (
			select intent.id
			from public.property_asset_upload_intents as intent
			where ($1 = '' or intent.organization_id::text = $1)
			  and intent.expires_at + ($3::bigint * interval '1 second') <= now()
			  and coalesce(intent.cleanup_claimed_until, '-infinity'::timestamptz) <= now()
			order by coalesce(intent.discard_requested_at, intent.expires_at), intent.created_at, intent.id
			for update skip locked
			limit $2
		)
		update public.property_asset_upload_intents as intent
		set cleanup_claimed_until = now() + interval '2 minutes',
		    cleanup_attempts = intent.cleanup_attempts
		      + case when intent.consumed_at is null then 1 else 0 end,
		    last_cleanup_error = null
		from candidates
		where intent.id = candidates.id
		returning intent.id::text, intent.storage_path, intent.consumed_at is not null
	`, organizationID, limit, int64(propertyAssetUploadExpiryMargin/time.Second))
	if err != nil {
		return err
	}
	candidates := make([]propertyAssetCleanupCandidate, 0, limit)
	for rows.Next() {
		var candidate propertyAssetCleanupCandidate
		if err := rows.Scan(&candidate.ID, &candidate.StoragePath, &candidate.Consumed); err != nil {
			rows.Close()
			return err
		}
		candidates = append(candidates, candidate)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	for _, candidate := range candidates {
		if candidate.Consumed {
			_, _ = repo.db.Pool().Exec(context.WithoutCancel(ctx), `
				delete from public.property_asset_upload_intents where id = $1::uuid
			`, candidate.ID)
			continue
		}
		if err := repo.storage.remove(ctx, propertyPrivateBucket, []string{candidate.StoragePath}); err != nil {
			repo.recordPropertyAssetUploadCleanupFailure(context.WithoutCancel(ctx), candidate.StoragePath, err)
			continue
		}
		_, _ = repo.db.Pool().Exec(context.WithoutCancel(ctx), `
			delete from public.property_asset_upload_intents where id = $1::uuid
		`, candidate.ID)
	}
	return nil
}

func (repo Repository) recordPropertyAssetUploadCleanupFailure(ctx context.Context, storagePath string, cleanupError error) {
	_, _ = repo.db.Pool().Exec(ctx, `
		update public.property_asset_upload_intents
		set cleanup_claimed_until = now() + interval '5 minutes',
		    last_cleanup_error = $2,
		    discard_requested_at = coalesce(discard_requested_at, now())
		where storage_path = $1
	`, storagePath, boundedPropertyAssetCleanupError(cleanupError))
}

func (repo Repository) cleanupQueuedPropertyAssetStorage(ctx context.Context, organizationID string, limit int) error {
	if limit <= 0 {
		return nil
	}
	rows, err := repo.db.Pool().Query(ctx, `
		with candidates as (
			select queued.id
			from public.property_asset_storage_cleanup_queue as queued
			where ($1 = '' or queued.organization_id::text = $1)
			  and queued.available_at <= now()
			order by queued.available_at, queued.created_at, queued.id
			for update skip locked
			limit $2
		)
		update public.property_asset_storage_cleanup_queue as queued
		set cleanup_attempts = queued.cleanup_attempts + 1,
		    available_at = now() + interval '2 minutes',
		    last_cleanup_error = null,
		    updated_at = now()
		from candidates
		where queued.id = candidates.id
		returning queued.id::text, queued.storage_path
	`, organizationID, limit)
	if err != nil {
		return err
	}
	candidates := make([]propertyAssetCleanupCandidate, 0, limit)
	for rows.Next() {
		var candidate propertyAssetCleanupCandidate
		if err := rows.Scan(&candidate.ID, &candidate.StoragePath); err != nil {
			rows.Close()
			return err
		}
		candidates = append(candidates, candidate)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	for _, candidate := range candidates {
		if err := repo.storage.remove(ctx, propertyPrivateBucket, []string{candidate.StoragePath}); err != nil {
			repo.recordQueuedPropertyAssetCleanupFailure(context.WithoutCancel(ctx), candidate.ID, err)
			continue
		}
		_, _ = repo.db.Pool().Exec(context.WithoutCancel(ctx), `
			delete from public.property_asset_storage_cleanup_queue where id = $1::uuid
		`, candidate.ID)
	}
	return nil
}

func (repo Repository) cleanupQueuedPropertyAssetStoragePath(ctx context.Context, storagePath string) error {
	var candidate propertyAssetCleanupCandidate
	err := repo.db.Pool().QueryRow(ctx, `
		with candidate as (
			select queued.id
			from public.property_asset_storage_cleanup_queue as queued
			where queued.storage_path = $1
			  and queued.available_at <= now()
			for update skip locked
			limit 1
		)
		update public.property_asset_storage_cleanup_queue as queued
		set cleanup_attempts = queued.cleanup_attempts + 1,
		    available_at = now() + interval '2 minutes',
		    last_cleanup_error = null,
		    updated_at = now()
		from candidate
		where queued.id = candidate.id
		returning queued.id::text, queued.storage_path
	`, storagePath).Scan(&candidate.ID, &candidate.StoragePath)
	if err == pgx.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	if err := repo.storage.remove(ctx, propertyPrivateBucket, []string{candidate.StoragePath}); err != nil {
		repo.recordQueuedPropertyAssetCleanupFailure(context.WithoutCancel(ctx), candidate.ID, err)
		return err
	}
	_, err = repo.db.Pool().Exec(context.WithoutCancel(ctx), `
		delete from public.property_asset_storage_cleanup_queue where id = $1::uuid
	`, candidate.ID)
	return err
}

func (repo Repository) recordQueuedPropertyAssetCleanupFailure(ctx context.Context, queueID string, cleanupError error) {
	_, _ = repo.db.Pool().Exec(ctx, `
		update public.property_asset_storage_cleanup_queue
		set last_cleanup_error = $2,
		    available_at = now() + interval '5 minutes',
		    updated_at = now()
		where id = $1::uuid
	`, queueID, boundedPropertyAssetCleanupError(cleanupError))
}

func boundedPropertyAssetCleanupError(err error) string {
	if err == nil {
		return ""
	}
	value := []rune(strings.TrimSpace(err.Error()))
	if len(value) > 2000 {
		value = value[:2000]
	}
	return string(value)
}

// StartAssetCleanupWorker drains both sides of the Storage outbox. The queue
// is database-owned, so cascaded property deletions remain recoverable even
// when the request that caused them has already returned.
func (repo Repository) StartAssetCleanupWorker(ctx context.Context, logger *slog.Logger) {
	var lifecycleSchemaReady bool
	err := repo.db.Pool().QueryRow(ctx, `
		select
			to_regclass('public.property_asset_upload_intents') is not null
			and to_regclass('public.property_asset_storage_cleanup_queue') is not null
	`).Scan(&lifecycleSchemaReady)
	if err != nil {
		if logger != nil && ctx.Err() == nil {
			logger.Error("property asset cleanup schema check failed", "error", err)
		}
		return
	}
	if !lifecycleSchemaReady {
		if logger != nil {
			logger.Warn("property asset cleanup worker disabled until its schema migration is applied")
		}
		return
	}

	run := func() {
		workerContext, cancel := context.WithTimeout(ctx, 25*time.Second)
		defer cancel()
		if err := repo.cleanupExpiredPropertyAssetUploads(workerContext, "", propertyAssetCleanupWorkerBatch); err != nil && logger != nil {
			logger.Error("property asset upload cleanup failed", "error", err)
		}
		if err := repo.cleanupQueuedPropertyAssetStorage(workerContext, "", propertyAssetCleanupWorkerBatch); err != nil && logger != nil {
			logger.Error("property asset storage cleanup failed", "error", err)
		}
	}

	run()
	ticker := time.NewTicker(propertyAssetCleanupWorkerInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			run()
		}
	}
}
