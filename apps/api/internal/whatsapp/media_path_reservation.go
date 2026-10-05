package whatsapp

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"
)

// reserveWhatsAppMediaJobUpload creates the path reservation and stores its
// token/upload intent on the leased media job in the same database transaction.
// No database connection remains occupied during the subsequent Storage HTTP
// request. A crash before this transaction commits leaves neither record.
func (repo Repository) reserveWhatsAppMediaJobUpload(ctx context.Context, job queuedWhatsAppMediaJob, asset completedWhatsAppMediaAsset) (string, error) {
	if !whatsappMediaPathBelongsToOrganization(asset.storagePath, job.OrganizationID) {
		return "", fmt.Errorf("WhatsApp media reservation path escaped organization scope")
	}
	var token pgtype.Text
	err := repo.db.Pool().QueryRow(ctx, `
		select private.reserve_whatsapp_media_job_upload(
			$1::uuid, $2::uuid, $3::uuid, $4::text, $5::uuid,
			$6::text, $7::text, $8::bigint
		)::text
	`, job.ID, job.OrganizationID, job.ConversationID, job.LockedBy, job.LeaseToken,
		asset.storagePath, asset.contentType, asset.actualSize).Scan(&token)
	if err != nil {
		return "", err
	}
	if !token.Valid || token.String == "" {
		return "", fmt.Errorf("WhatsApp media path is reserved by another operation")
	}
	return token.String, nil
}

// A reservation is released as committed only after the uploaded object has a
// durable media_jobs reference. An ambiguous Storage outcome stays reserved.
func (repo Repository) releaseWhatsAppMediaPath(ctx context.Context, token, outcome string) error {
	if token == "" {
		return nil
	}
	var released bool
	err := repo.db.Pool().QueryRow(ctx, `
		select public.whatsapp_media_path_release($1::uuid, $2::text)
	`, token, outcome).Scan(&released)
	if err != nil {
		return err
	}
	if !released {
		return fmt.Errorf("WhatsApp media path reservation could not be released")
	}
	return nil
}

// An absent object is not proof that a timed-out Storage upload will never
// finish. While its durable reservation exists, a retry must wait for the
// original operation to be reconciled instead of issuing another HTTP upload.
func (repo Repository) whatsAppMediaPathReservationStillHeld(ctx context.Context, token, objectPath string) (bool, error) {
	var held bool
	err := repo.db.Pool().QueryRow(ctx, `
		select exists (
		  select 1
		  from private.whatsapp_media_path_operations as operation
		  where operation.owner_token = $1::uuid
		    and operation.bucket_id = $2
		    and operation.storage_path = $3
		    and operation.operation = 'upload'
		)
	`, token, whatsappMediaBucket, objectPath).Scan(&held)
	return held, err
}
