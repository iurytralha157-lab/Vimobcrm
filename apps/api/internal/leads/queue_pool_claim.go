package leads

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/authorization"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/leadscope"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

var ErrQueuePoolConflict = errors.New("queue pool claim changed")
var ErrQueueManagedReleaseRequired = errors.New("managed queue cannot be manually left without an owner")

type ClaimQueuePoolRequest struct {
	RoundRobinID     string `json:"roundRobinId"`
	EpisodeID        string `json:"episodeId"`
	ExpectedRevision *int64 `json:"expectedRevision"`
}

type claimQueuePoolInput struct {
	RoundRobinID, EpisodeID, IdempotencyKey string
	ExpectedRevision                        int64
}

func (request ClaimQueuePoolRequest) validate(idempotencyKey string) (claimQueuePoolInput, error) {
	queueID, queueOK := normalizeUUID(request.RoundRobinID)
	episodeID, episodeOK := normalizeUUID(request.EpisodeID)
	key := strings.TrimSpace(idempotencyKey)
	if !queueOK || !episodeOK || request.ExpectedRevision == nil || *request.ExpectedRevision < 1 || key == "" || len(key) > 200 || key != idempotencyKey || strings.ContainsAny(key, "\r\n\x00") {
		return claimQueuePoolInput{}, fmt.Errorf("%w: claim requires queue, episode, revision and Idempotency-Key", ErrInvalidInput)
	}
	return claimQueuePoolInput{queueID, episodeID, key, *request.ExpectedRevision}, nil
}

type queuePoolCommandResult struct {
	Success bool   `json:"success"`
	Reason  string `json:"reason"`
}

func decodeQueuePoolClaimResult(raw []byte) (bool, error) {
	var result queuePoolCommandResult
	if err := json.Unmarshal(raw, &result); err != nil {
		return false, fmt.Errorf("decode queue pool claim: %w", err)
	}
	if result.Success && (result.Reason == "claimed" || result.Reason == "already_claimed") {
		return result.Reason == "claimed", nil
	}
	switch result.Reason {
	case "forbidden", "not_found":
		// Do not reveal whether a private queue pool contains this lead.
		return false, ErrLeadNotFound
	case "revision_conflict", "idempotency_key_conflict", "not_in_pool", "queue_busy":
		return false, ErrQueuePoolConflict
	case "invalid_idempotency_key":
		return false, ErrInvalidInput
	default:
		return false, fmt.Errorf("queue pool claim returned an invalid outcome")
	}
}

func (repo Repository) ClaimQueuePool(ctx context.Context, actor tenant.Context, leadID string, input claimQueuePoolInput) (Lead, bool, error) {
	leadID, ok := normalizeUUID(leadID)
	if !ok {
		return Lead{}, false, ErrLeadNotFound
	}
	if !canClaimQueuePool(actor) {
		return Lead{}, false, tenant.ErrOrganizationAccessDenied
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return Lead{}, false, err
	}
	defer rollbackRedistributionTransaction(ctx, tx)
	var raw []byte
	if err := tx.QueryRow(ctx, `select private.claim_queue_pool($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::bigint,$7::text)`, actor.OrganizationID, leadID, actor.UserID, input.RoundRobinID, input.EpisodeID, input.ExpectedRevision, input.IdempotencyKey).Scan(&raw); err != nil {
		return Lead{}, false, queueRuntimeCommandError(err)
	}
	changed, err := decodeQueuePoolClaimResult(raw)
	if err != nil {
		return Lead{}, false, err
	}
	lead, err := repo.getLeadForMutation(ctx, tx, actor, leadID)
	if err != nil {
		return Lead{}, false, err
	}
	if !authorization.CanViewLead(actor, authorization.LeadResource{AssignedUserID: lead.AssignedUserID, TeamID: lead.TeamID, QueuePoolReadAccess: lead.QueuePoolReadAccess}) {
		return Lead{}, false, ErrLeadNotFound
	}
	if err := tx.Commit(ctx); err != nil {
		return Lead{}, false, err
	}
	repo.hydrateMutationLeadAvatar(actor.OrganizationID, &lead)
	return lead, changed, nil
}

func canClaimQueuePool(actor tenant.Context) bool {
	return actor.OrganizationID != "" && actor.UserID != "" && actor.HasPermission(permissions.LeadOperate) &&
		(leadscope.CanViewOwn(actor) || leadscope.CanViewTeam(actor) || leadscope.CanViewAll(actor))
}

// The SQL helper is private, validates the actor and authorizes this exact
// transaction. A pooled lead must use the CAS claim instead of generic PATCH.
func prepareManualQueueTransfer(ctx context.Context, tx pgx.Tx, actor tenant.Context, leadID string, targetUserID *string) error {
	var prepared bool
	if err := tx.QueryRow(ctx, `select private.prepare_queue_manual_transfer($1::uuid,$2::uuid,$3::uuid,$4::uuid)`, actor.OrganizationID, leadID, actor.UserID, nullable(targetUserID)).Scan(&prepared); err != nil {
		return queueRuntimeCommandError(err)
	}
	if !prepared {
		if targetUserID == nil {
			return ErrQueueManagedReleaseRequired
		}
		return ErrQueuePoolConflict
	}
	return nil
}

func queueRuntimeCommandError(err error) error {
	var databaseError *pgconn.PgError
	if errors.As(err, &databaseError) {
		switch databaseError.Code {
		case "55P03", "40001":
			return ErrQueuePoolConflict
		case "42501":
			return tenant.ErrOrganizationAccessDenied
		}
	}
	return err
}
