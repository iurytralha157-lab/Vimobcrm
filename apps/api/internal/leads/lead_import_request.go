package leads

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

var (
	ErrLeadImportRequestConflict        = errors.New("contact import request key was reused with different input")
	ErrLeadImportIdempotencyUnavailable = errors.New("contact import receipt storage is unavailable")
)

type leadImportRequest struct {
	tx     pgx.Tx
	key    string
	digest string
}

type leadImportReceipt struct {
	LeadID    string
	Reentry   bool
	Outcome   CreateDistributionOutcome
	Completed bool
}

// Canonical v1 is the normalized input, with Go's deterministic JSON map-key
// ordering. The key itself is a namespace, not part of the operation payload.
// Only this digest is persisted; no imported personal payload is stored.
func leadImportRequestDigest(input createInput) (string, error) {
	input.ImportRequestKey = nil
	raw, err := json.Marshal(input)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(append([]byte("contacts-import:v1:"), raw...))
	return hex.EncodeToString(digest[:]), nil
}

func claimLeadImportRequest(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, request *leadImportRequest) (leadImportReceipt, error) {
	inserted, err := tx.Exec(ctx, `
		insert into private.contact_import_request_receipts (organization_id, actor_id, request_key, payload_sha256)
		values ($1::uuid, $2::uuid, $3::uuid, $4)
		on conflict (organization_id, actor_id, request_key) do nothing
	`, tenantContext.OrganizationID, tenantContext.UserID, request.key, request.digest)
	if err != nil {
		return leadImportReceipt{}, leadImportReceiptStorageError(err)
	}
	var digest string
	var leadID, outcome pgtype.Text
	var reentry pgtype.Bool
	var completed bool
	err = tx.QueryRow(ctx, `
		select payload_sha256, lead_id::text, reentry, distribution_outcome, completed_at is not null
		from private.contact_import_request_receipts
		where organization_id=$1::uuid and actor_id=$2::uuid and request_key=$3::uuid
		for update
	`, tenantContext.OrganizationID, tenantContext.UserID, request.key).Scan(&digest, &leadID, &reentry, &outcome, &completed)
	if err != nil {
		return leadImportReceipt{}, leadImportReceiptStorageError(err)
	}
	if digest != request.digest {
		return leadImportReceipt{}, ErrLeadImportRequestConflict
	}
	if !completed && inserted.RowsAffected() != 1 {
		// A pending committed record is ambiguous. Never repeat its mutation.
		return leadImportReceipt{}, ErrLeadImportIdempotencyUnavailable
	}
	if completed && (!leadID.Valid || !isUUID(leadID.String) || !reentry.Valid || !validCreateDistributionOutcome(CreateDistributionOutcome(textValue(outcome)))) {
		return leadImportReceipt{}, ErrLeadImportIdempotencyUnavailable
	}
	return leadImportReceipt{LeadID: textValue(leadID), Reentry: reentry.Bool, Outcome: CreateDistributionOutcome(textValue(outcome)), Completed: completed}, nil
}

func (repo Repository) createImportedLeadIdempotently(ctx context.Context, tenantContext tenant.Context, input createInput) (CreateResult, error) {
	if !input.ImportMode || input.ImportRequestKey == nil || !canCreateLeadInput(tenantContext, input) {
		return CreateResult{}, tenant.ErrOrganizationAccessDenied
	}
	key, valid := normalizeUUID(*input.ImportRequestKey)
	if !valid {
		return CreateResult{}, fmt.Errorf("%w: importRequestKey is invalid", ErrInvalidInput)
	}
	digest, err := leadImportRequestDigest(input)
	if err != nil {
		return CreateResult{}, err
	}
	for attempt := 0; attempt < leadIntakeMaxAttempts; attempt++ {
		result, err := func() (CreateResult, error) {
			tx, err := repo.db.Pool().Begin(ctx)
			if err != nil {
				return CreateResult{}, err
			}
			defer tx.Rollback(ctx)
			request := &leadImportRequest{tx: tx, key: key, digest: digest}
			receipt, err := claimLeadImportRequest(ctx, tx, tenantContext, request)
			if err != nil {
				return CreateResult{}, err
			}
			if receipt.Completed {
				return replayLeadImportReceipt(ctx, tx, tenantContext, receipt)
			}
			return repo.Create(ctx, tenantContext, input, request)
		}()
		if err == nil {
			return result, nil
		}
		if !errors.Is(err, errLeadIntakeRetry) && !isLeadPhoneUniqueViolation(err) {
			return CreateResult{}, err
		}
	}
	return CreateResult{}, ErrLeadPhoneConflict
}

func (repo Repository) beginLeadImportTransaction(ctx context.Context, request *leadImportRequest) (pgx.Tx, error) {
	if request != nil {
		return request.tx, nil
	}
	return repo.db.Pool().Begin(ctx)
}

func (repo Repository) leadCreationReadQueryer(request *leadImportRequest) leadTeamQueryer {
	if request != nil {
		return request.tx
	}
	return repo.db.Pool()
}

func (repo Repository) leadPhoneLookupQueryer(readQueryers []leadTeamQueryer) leadTeamQueryer {
	if len(readQueryers) > 0 {
		return readQueryers[0]
	}
	return repo.db.Pool()
}

func commitLeadImportCreation(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, leadID string, request *leadImportRequest, reentry bool, outcome CreateDistributionOutcome) (Lead, error) {
	if request == nil {
		return commitLeadCreation(ctx, tx, tenantContext, leadID)
	}
	if !validCreateDistributionOutcome(outcome) {
		return Lead{}, ErrLeadImportIdempotencyUnavailable
	}
	lead, err := loadLeadCreationSnapshot(ctx, tx, tenantContext, leadID)
	if err != nil {
		return Lead{}, err
	}
	updated, err := tx.Exec(ctx, `
		update private.contact_import_request_receipts
		set lead_id=$4::uuid, reentry=$5, distribution_outcome=$6, completed_at=now()
		where organization_id=$1::uuid and actor_id=$2::uuid and request_key=$3::uuid
		  and payload_sha256=$7 and completed_at is null
	`, tenantContext.OrganizationID, tenantContext.UserID, request.key, leadID, reentry, string(outcome), request.digest)
	if err != nil {
		return Lead{}, leadImportReceiptStorageError(err)
	}
	if updated.RowsAffected() != 1 {
		return Lead{}, ErrLeadImportIdempotencyUnavailable
	}
	if err := tx.Commit(ctx); err != nil {
		return Lead{}, err
	}
	return lead, nil
}

func replayLeadImportReceipt(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, receipt leadImportReceipt) (CreateResult, error) {
	// Re-evaluate the current read scope through the normal public response
	// builder. The record is actor/organization scoped before this internal read.
	result := CreateResult{Lead: Lead{ID: receipt.LeadID, OrganizationID: tenantContext.OrganizationID}, Reentry: receipt.Reentry, DistributionOutcome: receipt.Outcome, Replayed: true}
	lead, err := loadLeadCreationSnapshot(ctx, tx, tenantContext, receipt.LeadID)
	if errors.Is(err, ErrLeadNotFound) {
		result.ReceiptOnly = true // Deleted after completion: never recreate it.
	} else if err != nil {
		return CreateResult{}, err
	} else {
		result.Lead = lead
		if lead.Assignee != nil {
			result.AssignedUserName = lead.Assignee.Name
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return CreateResult{}, err
	}
	return result, nil
}

func leadImportReceiptStorageError(err error) error {
	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) {
		switch postgresError.Code {
		case "42P01", "3F000", "42703", "42501":
			return ErrLeadImportIdempotencyUnavailable
		}
	}
	return err
}
