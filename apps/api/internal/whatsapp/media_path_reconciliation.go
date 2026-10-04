package whatsapp

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

type whatsAppMediaPathReconciliation struct {
	Found            bool
	Released         bool
	RequiresOperator bool
	ObjectPresent    bool
}

// reconcileOneExpiredWhatsAppMediaPath is deliberately not scheduled yet.
// It releases only a Go upload whose OWN leased media job durably recorded the
// same Storage path and token after the HTTP upload. For every other expired
// reservation it records an unknown outcome and leaves the path reserved;
// neither a timeout nor a missing object proves that an in-flight Storage
// request can no longer finish. Edge uploads need their own completion proof.
func (repo Repository) reconcileOneExpiredWhatsAppMediaPath(ctx context.Context) (whatsAppMediaPathReconciliation, error) {
	var token, organizationID, objectPath string
	err := repo.db.Pool().QueryRow(ctx, `
		select owner_token::text, organization_id::text, storage_path
		from private.whatsapp_media_path_operations
		where operation = 'upload'
		  and expires_at <= clock_timestamp()
		order by expires_at, started_at
		limit 1
	`).Scan(&token, &organizationID, &objectPath)
	if errors.Is(err, pgx.ErrNoRows) {
		return whatsAppMediaPathReconciliation{}, nil
	}
	if err != nil {
		return whatsAppMediaPathReconciliation{}, err
	}
	if !whatsappMediaPathBelongsToOrganization(objectPath, organizationID) {
		return whatsAppMediaPathReconciliation{Found: true, RequiresOperator: true}, fmt.Errorf("WhatsApp media reservation escaped organization scope")
	}

	objectPresent, err := repo.storage.objectExists(ctx, whatsappMediaBucket, objectPath)
	if err != nil {
		return whatsAppMediaPathReconciliation{Found: true}, err
	}
	result := whatsAppMediaPathReconciliation{Found: true, ObjectPresent: objectPresent}
	if objectPresent {
		var durablyRecorded bool
		err = repo.db.Pool().QueryRow(ctx, `
			select exists (
			  select 1
			  from public.media_jobs as job
			  where job.organization_id = $1::uuid
			    and job.storage_path = $2
			    and job.actual_size > 0
			    and job.upload_path_reservation_token = $3::uuid
			    and job.upload_http_confirmed is true
			)
		`, organizationID, objectPath, token).Scan(&durablyRecorded)
		if err != nil {
			return result, err
		}
		if durablyRecorded {
			if err := repo.releaseWhatsAppMediaPath(ctx, token, "committed"); err != nil {
				return result, err
			}
			result.Released = true
			return result, nil
		}
	}

	// Keep the reservation for operator review and move its next inspection
	// forward so one orphan cannot starve all later operations.
	_, err = repo.db.Pool().Exec(ctx, `
		update private.whatsapp_media_path_operations
		set outcome_unknown = true,
		    expires_at = clock_timestamp() + interval '1 hour'
		where owner_token = $1::uuid
		  and operation = 'upload'
	`, token)
	if err != nil {
		return result, err
	}
	result.RequiresOperator = true
	return result, nil
}
