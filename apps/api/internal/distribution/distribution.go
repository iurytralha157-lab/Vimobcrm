package distribution

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

var ErrInvalidRequest = errors.New("invalid distribution request")
var ErrRejected = errors.New("distribution request rejected")
var ErrInvalidResult = errors.New("invalid distribution result")

// frozenNoQueueRoundRobinID is never persisted as an intake identity. It is
// only passed as an explicit, nonexistent queue to private.distribute_lead when
// an intake caller has already resolved routing and found no queue. The SQL
// guard below fails closed if this UUID was ever inserted for the tenant.
const frozenNoQueueRoundRobinID = "00000000-0000-0000-0000-000000000000"

const distributeLeadSQL = `
	with routing_request as (
		select case
			when $8::boolean and $4::uuid is null
				then '` + frozenNoQueueRoundRobinID + `'::uuid
			else $4::uuid
		end as round_robin_id
		where not (
			$8::boolean
			and $4::uuid is null
			and exists (
				select 1
				from public.round_robins as queue
				where queue.organization_id = $1::uuid
				  and queue.id = '` + frozenNoQueueRoundRobinID + `'::uuid
			)
		)
	)
	select private.distribute_lead(
		$1::uuid,
		$2::uuid,
		$3::text,
		routing_request.round_robin_id,
		$5::boolean,
		$6::text,
		$7::timestamptz
	)
	from routing_request`

// Queryer is intentionally satisfied by both pgx.Tx and pgxpool.Pool. Intake
// paths should pass their existing transaction so enrichment and distribution
// either commit together or roll back together.
type Queryer interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type Request struct {
	OrganizationID string
	LeadID         string
	IdempotencyKey string
	RoundRobinID   *string
	// RoundRobinResolved distinguishes legacy auto-routing (false + nil queue)
	// from a frozen intake decision that deliberately found no queue (true +
	// nil queue). Existing callers remain backwards compatible by default.
	RoundRobinResolved bool
	PreserveAssignee   bool
	Source             *string
	OccurredAt         time.Time
}

type Result struct {
	Success             bool    `json:"success"`
	Reason              string  `json:"reason"`
	LeadID              string  `json:"lead_id"`
	AssignedUserID      *string `json:"assigned_user_id"`
	AssignedUserName    *string `json:"assigned_user_name"`
	TeamID              *string `json:"team_id"`
	PipelineID          *string `json:"pipeline_id"`
	StageID             *string `json:"stage_id"`
	RoundRobinID        *string `json:"round_robin_id"`
	RoundRobinName      *string `json:"round_robin_name"`
	MemberID            *string `json:"member_id"`
	Source              string  `json:"source"`
	DistributionEventID *string `json:"distribution_event_id"`
}

// StableKey keeps provider-controlled identifiers within the database limit
// while preserving deterministic retries. JSON encoding length-delimits every
// part, avoiding ambiguities such as ["a:b", "c"] versus ["a", "b:c"].
func StableKey(prefix string, parts ...string) string {
	encoded, _ := json.Marshal(parts)
	digest := sha256.Sum256(encoded)
	return strings.TrimSpace(prefix) + ":" + hex.EncodeToString(digest[:])
}

func Distribute(ctx context.Context, queryer Queryer, request Request) (Result, error) {
	if queryer == nil ||
		strings.TrimSpace(request.OrganizationID) == "" ||
		strings.TrimSpace(request.LeadID) == "" ||
		strings.TrimSpace(request.IdempotencyKey) == "" {
		return Result{}, ErrInvalidRequest
	}

	occurredAt := request.OccurredAt.UTC()
	if request.OccurredAt.IsZero() {
		occurredAt = time.Now().UTC()
	}

	var raw []byte
	err := queryer.QueryRow(
		ctx,
		distributeLeadSQL,
		strings.TrimSpace(request.OrganizationID),
		strings.TrimSpace(request.LeadID),
		strings.TrimSpace(request.IdempotencyKey),
		nullableText(request.RoundRobinID),
		request.PreserveAssignee,
		nullableText(request.Source),
		occurredAt,
		request.RoundRobinResolved,
	).Scan(&raw)
	if err != nil {
		return Result{}, fmt.Errorf("distribute lead: %w", err)
	}

	var result Result
	if err := json.Unmarshal(raw, &result); err != nil {
		return Result{}, fmt.Errorf("decode distribution result: %w", err)
	}
	switch result.Reason {
	case "assigned", "already_assigned", "no_matching_queue", "no_available_members":
		return result, nil
	case "lead_not_found", "idempotency_key_conflict":
		return result, fmt.Errorf("%w: %s", ErrRejected, result.Reason)
	default:
		return result, fmt.Errorf("%w: reason %q", ErrInvalidResult, result.Reason)
	}
}

func nullableText(value *string) any {
	if value == nil || strings.TrimSpace(*value) == "" {
		return nil
	}
	return strings.TrimSpace(*value)
}
