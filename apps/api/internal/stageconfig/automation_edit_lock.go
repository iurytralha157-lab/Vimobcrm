package stageconfig

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

var ErrStageAutomationChanged = errors.New("stage automation changed")

type stageAutomationStatusInput struct {
	IsActive          bool
	ExpectedUpdatedAt time.Time
}

func parseRequiredStageAutomationRevision(raw string) (time.Time, error) {
	if raw == "" {
		return time.Time{}, ErrStageAutomationChanged
	}
	revision, err := time.Parse(time.RFC3339Nano, raw)
	if err != nil || revision.IsZero() {
		return time.Time{}, fmt.Errorf("%w: expected_updated_at must be the exact RFC3339 timestamp returned by the API", ErrInvalidInput)
	}
	return revision, nil
}

func (request StageAutomationStatusRequest) Validate() (stageAutomationStatusInput, error) {
	if request.IsActive == nil {
		return stageAutomationStatusInput{}, fmt.Errorf("%w: is_active is required", ErrInvalidInput)
	}
	revision, err := parseRequiredStageAutomationRevision(request.ExpectedUpdatedAt)
	if err != nil {
		return stageAutomationStatusInput{}, err
	}
	return stageAutomationStatusInput{IsActive: *request.IsActive, ExpectedUpdatedAt: revision}, nil
}

// Called after lockAutomationStage. Compare the original revision and read the
// actual active state together under the row lock, before validating any effect.
func readLockedAutomationRevision(ctx context.Context, tx automationPolicyQueryer, organizationID, stageID, automationID string, expected time.Time) (bool, error) {
	var active bool
	var updatedAt time.Time
	err := tx.QueryRow(ctx, `select coalesce(is_active,true), updated_at from public.stage_automations
 where organization_id=$1::uuid and stage_id=$2::uuid and id=$3::uuid
 for update`, organizationID, stageID, automationID).Scan(&active, &updatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, ErrNotFound
	}
	if err == nil && (expected.IsZero() || !updatedAt.Equal(expected)) {
		return false, ErrStageAutomationChanged
	}
	return active, err
}

// A trigger outside the reviewed source must never silently erase the CAS
// revision. Reject and roll back the entire transaction if RETURNING did not
// advance, including an accepted same-value PATCH/toggle.
func requireAdvancedStageAutomationRevision(automation StageAutomation, previous time.Time) error {
	updatedAt, err := time.Parse(time.RFC3339Nano, automation.UpdatedAt)
	if err != nil || !updatedAt.After(previous) {
		return fmt.Errorf("%w: persisted revision did not advance", ErrStageAutomationChanged)
	}
	return nil
}
