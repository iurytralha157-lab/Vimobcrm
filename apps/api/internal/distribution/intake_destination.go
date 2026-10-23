package distribution

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
)

var ErrIntakeDestinationUnavailable = errors.New("the selected pipeline requires an active destination stage")

// LockIntakePipelineDestination protects a selected destination until the
// caller's intake transaction ends. Always pass that transaction, never a Pool:
// statement-scoped pool locks cannot protect a later write/commit.
// An intentionally unscoped intake remains
// valid. Lock the parent before its child, matching Pipeline structure writers;
// SHARE also prevents an archive that FK KEY SHARE alone would permit.
func LockIntakePipelineDestination(ctx context.Context, queryer Queryer, organizationID string, pipelineID, stageID *string) error {
	if pipelineID == nil && stageID == nil {
		return nil
	}
	if queryer == nil || strings.TrimSpace(organizationID) == "" || pipelineID == nil || stageID == nil ||
		strings.TrimSpace(*pipelineID) == "" || strings.TrimSpace(*stageID) == "" {
		return ErrIntakeDestinationUnavailable
	}
	var lockedPipelineID string
	err := queryer.QueryRow(ctx, `select id::text from public.pipelines
		where organization_id=$1::uuid and id=$2::uuid and coalesce(is_active,true)
		for share`, organizationID, *pipelineID).Scan(&lockedPipelineID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrIntakeDestinationUnavailable
	}
	if err != nil {
		return err
	}
	var lockedStageID string
	err = queryer.QueryRow(ctx, `select id::text from public.stages
		where organization_id=$1::uuid and pipeline_id=$2::uuid and id=$3::uuid
		  and coalesce(is_active,true) for share`, organizationID, lockedPipelineID, *stageID).Scan(&lockedStageID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrIntakeDestinationUnavailable
	}
	return err
}

// ValidatePersistedIntakeDestination checks the effective references after
// triggers/distribution, including queues that changed the original destination.
// The caller must already own the lead row through INSERT, UPDATE or a canonical
// distributor row lock. Pass that transaction and return the error before commit,
// so rejected intake also rolls back entries, notifications and effects.
func ValidatePersistedIntakeDestination(ctx context.Context, queryer Queryer, organizationID, leadID string) error {
	if queryer == nil || strings.TrimSpace(organizationID) == "" || strings.TrimSpace(leadID) == "" {
		return ErrIntakeDestinationUnavailable
	}
	var pipelineID, stageID string
	err := queryer.QueryRow(ctx, `select coalesce(pipeline_id::text,''),coalesce(stage_id::text,'')
		from public.leads where organization_id=$1::uuid and id=$2::uuid`, organizationID, leadID).Scan(&pipelineID, &stageID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrIntakeDestinationUnavailable
	}
	if err != nil {
		return err
	}
	var pipeline, stage *string
	if pipelineID != "" {
		pipeline = &pipelineID
	}
	if stageID != "" {
		stage = &stageID
	}
	return LockIntakePipelineDestination(ctx, queryer, organizationID, pipeline, stage)
}
