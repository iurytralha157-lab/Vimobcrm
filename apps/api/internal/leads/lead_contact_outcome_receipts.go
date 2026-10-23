package leads

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func contactOutcomeReceiptStorageError(err error) error {
	var databaseError *pgconn.PgError
	if errors.Is(err, pgx.ErrNoRows) || (errors.As(err, &databaseError) &&
		(databaseError.Code == "42P01" || databaseError.Code == "3F000" || databaseError.Code == "42703" || databaseError.Code == "42501")) {
		return ErrLeadContactOutcomeStorageUnavailable
	}
	return err
}

func claimLeadContactOutcomeReceipt(ctx context.Context, tx pgx.Tx, actor tenant.Context, leadID string, input leadContactOutcomeInput, digest string) (LeadContactOutcomeReceipt, bool, error) {
	receipt := LeadContactOutcomeReceipt{CommandID: input.commandID, LeadID: leadID, Channel: input.channel}
	inserted, err := tx.Exec(ctx, `insert into private.lead_contact_outcome_command_receipts
		(organization_id,actor_id,command_id,lead_id,channel,payload_sha256)
		values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6)
		on conflict(organization_id,actor_id,command_id) do nothing`, actor.OrganizationID, actor.UserID, input.commandID, leadID, input.channel, digest)
	if err != nil {
		return receipt, false, contactOutcomeReceiptStorageError(err)
	}
	var storedDigest, storedLeadID, storedChannel string
	var activityID pgtype.Text
	var recordedAt pgtype.Timestamptz
	err = tx.QueryRow(ctx, `select payload_sha256,lead_id::text,channel,activity_id::text,recorded_at
		from private.lead_contact_outcome_command_receipts
		where organization_id=$1::uuid and actor_id=$2::uuid and command_id=$3::uuid
		for update`, actor.OrganizationID, actor.UserID, input.commandID).Scan(&storedDigest, &storedLeadID, &storedChannel, &activityID, &recordedAt)
	if err != nil {
		return receipt, false, contactOutcomeReceiptStorageError(err)
	}
	if storedDigest != digest || storedLeadID != leadID || storedChannel != input.channel {
		return receipt, false, ErrLeadContactOutcomeConflict
	}
	if activityID.Valid && recordedAt.Valid && !recordedAt.Time.IsZero() {
		if _, valid := normalizeUUID(activityID.String); !valid {
			return receipt, false, ErrLeadContactOutcomeStorageUnavailable
		}
		receipt.ActivityID, receipt.RecordedAt = activityID.String, recordedAt.Time
		return receipt, true, nil
	}
	if inserted.RowsAffected() != 1 || activityID.Valid || recordedAt.Valid {
		return receipt, false, ErrLeadContactOutcomeStorageUnavailable
	}
	return receipt, false, nil
}

func completeLeadContactOutcomeReceipt(ctx context.Context, tx pgx.Tx, actor tenant.Context, receipt LeadContactOutcomeReceipt, digest string) error {
	updated, err := tx.Exec(ctx, `update private.lead_contact_outcome_command_receipts
		set activity_id=$6::uuid,recorded_at=$7::timestamptz
		where organization_id=$1::uuid and actor_id=$2::uuid and command_id=$3::uuid
		and payload_sha256=$4 and channel=$5 and activity_id is null and recorded_at is null`, actor.OrganizationID, actor.UserID, receipt.CommandID, digest, receipt.Channel, receipt.ActivityID, receipt.RecordedAt)
	if err != nil {
		return contactOutcomeReceiptStorageError(err)
	}
	if updated.RowsAffected() != 1 {
		return ErrLeadContactOutcomeStorageUnavailable
	}
	return nil
}
