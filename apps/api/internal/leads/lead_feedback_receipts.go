package leads

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func feedbackReceiptStorageError(err error) error {
	var databaseError *pgconn.PgError
	if errors.Is(err, pgx.ErrNoRows) || (errors.As(err, &databaseError) &&
		(databaseError.Code == "42P01" || databaseError.Code == "3F000" || databaseError.Code == "42703" || databaseError.Code == "42501")) {
		return ErrLeadFeedbackStorageUnavailable
	}
	return err
}

func claimLeadFeedbackReceipt(ctx context.Context, tx pgx.Tx, actor tenant.Context, leadID, commandID, digest string) (LeadFeedbackReceipt, bool, error) {
	receipt := LeadFeedbackReceipt{CommandID: commandID, LeadID: leadID}
	inserted, err := tx.Exec(ctx, `insert into private.lead_feedback_command_receipts
		(organization_id,actor_id,command_id,lead_id,payload_sha256)
		values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5)
		on conflict(organization_id,actor_id,command_id) do nothing`, actor.OrganizationID, actor.UserID, commandID, leadID, digest)
	if err != nil {
		return receipt, false, feedbackReceiptStorageError(err)
	}
	var storedDigest, storedLeadID string
	var activityID pgtype.Text
	var recordedAt pgtype.Timestamptz
	err = tx.QueryRow(ctx, `select payload_sha256,lead_id::text,activity_id::text,recorded_at
		from private.lead_feedback_command_receipts
		where organization_id=$1::uuid and actor_id=$2::uuid and command_id=$3::uuid
		for update`, actor.OrganizationID, actor.UserID, commandID).Scan(&storedDigest, &storedLeadID, &activityID, &recordedAt)
	if err != nil {
		return receipt, false, feedbackReceiptStorageError(err)
	}
	if storedDigest != digest || storedLeadID != leadID {
		return receipt, false, ErrLeadFeedbackConflict
	}
	if activityID.Valid && recordedAt.Valid && !recordedAt.Time.IsZero() {
		if _, valid := normalizeUUID(activityID.String); !valid {
			return receipt, false, ErrLeadFeedbackStorageUnavailable
		}
		receipt.ActivityID, receipt.RecordedAt = activityID.String, recordedAt.Time
		return receipt, true, nil
	}
	if inserted.RowsAffected() != 1 || activityID.Valid || recordedAt.Valid {
		return receipt, false, ErrLeadFeedbackStorageUnavailable
	}
	return receipt, false, nil
}

func completeLeadFeedbackReceipt(ctx context.Context, tx pgx.Tx, actor tenant.Context, receipt LeadFeedbackReceipt, digest string) error {
	updated, err := tx.Exec(ctx, `update private.lead_feedback_command_receipts
		set activity_id=$5::uuid,recorded_at=$6::timestamptz
		where organization_id=$1::uuid and actor_id=$2::uuid and command_id=$3::uuid
		and payload_sha256=$4 and activity_id is null and recorded_at is null`, actor.OrganizationID, actor.UserID, receipt.CommandID, digest, receipt.ActivityID, receipt.RecordedAt)
	if err != nil {
		return feedbackReceiptStorageError(err)
	}
	if updated.RowsAffected() != 1 {
		return ErrLeadFeedbackStorageUnavailable
	}
	return nil
}
