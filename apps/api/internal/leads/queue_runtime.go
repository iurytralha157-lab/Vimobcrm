package leads

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/distribution"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/realtime"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// Managed queues own their calendar, pool, visits and assignment budget in SQL.
// The legacy worker must never also consume those leads/jobs.
func (repo Repository) processManagedQueueRuntime(ctx context.Context) error {
	budget, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	for batch := 0; batch < 10 && budget.Err() == nil; batch++ {
		processed, err := repo.processManagedQueueBatch(budget)
		if err != nil {
			return err
		}
		if processed < leadRedistributionBatchLimit {
			return nil
		}
	}
	return ctx.Err()
}

func (repo Repository) processManagedQueueBatch(ctx context.Context) (int, error) {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return 0, err
	}
	return repo.processManagedQueueBatchInTx(ctx, tx)
}

func (repo Repository) processManagedQueueBatchInTx(ctx context.Context, tx pgx.Tx) (int, error) {
	defer rollbackRedistributionTransaction(ctx, tx)
	var locked bool
	if err := tx.QueryRow(ctx, `select pg_try_advisory_xact_lock(hashtextextended('lead_queue_runtime_worker',0))`).Scan(&locked); err != nil || !locked {
		return 0, err
	}
	outcome, err := processManagedQueueBatchWithTx(ctx, tx)
	if err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	if repo.queueRuntimePublisher != nil {
		for _, change := range outcome.Changed {
			repo.queueRuntimePublisher.Publish(realtime.NewEvent("lead.updated", change.OrganizationID, "", map[string]any{"leadId": change.LeadID}))
		}
	}
	if outcome.Failed > 0 {
		return *outcome.Processed, fmt.Errorf("queue runtime deferred %d failed item(s)", outcome.Failed)
	}
	return *outcome.Processed, nil
}

type managedQueueBatchOutcome struct {
	Processed *int `json:"processed"`
	Failed    int  `json:"failed"`
	Changed   []struct {
		OrganizationID string `json:"organizationId"`
		LeadID         string `json:"leadId"`
	} `json:"changed"`
}

func processManagedQueueBatchWithTx(ctx context.Context, tx pgx.Tx) (managedQueueBatchOutcome, error) {
	var result []byte
	if err := tx.QueryRow(ctx, `select private.process_queue_runtime_batch($1::integer,clock_timestamp())`, leadRedistributionBatchLimit).Scan(&result); err != nil {
		return managedQueueBatchOutcome{}, err
	}
	return decodeManagedQueueBatchOutcome(result)
}

func decodeManagedQueueBatchOutcome(raw []byte) (managedQueueBatchOutcome, error) {
	var payload managedQueueBatchOutcome
	if err := json.Unmarshal(raw, &payload); err != nil || payload.Processed == nil || *payload.Processed < 0 || payload.Failed < 0 {
		return managedQueueBatchOutcome{}, fmt.Errorf("queue runtime returned an invalid batch outcome")
	}
	for _, change := range payload.Changed {
		_, organizationOK := normalizeUUID(change.OrganizationID)
		_, leadOK := normalizeUUID(change.LeadID)
		if !organizationOK || !leadOK {
			return managedQueueBatchOutcome{}, fmt.Errorf("queue runtime returned an invalid invalidation scope")
		}
	}
	return payload, nil
}

func managedQueueManualRedistribution(ctx context.Context, tx pgx.Tx, actor tenant.Context, current leadSnapshot) (RoundRobinResult, bool, error) {
	var raw []byte
	if err := tx.QueryRow(ctx, `select private.queue_runtime_redistribute($1::uuid,$2::uuid,$3::uuid)`, actor.OrganizationID, current.ID, actor.UserID).Scan(&raw); err != nil {
		return RoundRobinResult{}, false, queueRuntimeCommandError(err)
	}
	var result distribution.Result
	if err := json.Unmarshal(raw, &result); err != nil {
		return RoundRobinResult{}, false, fmt.Errorf("decode managed redistribution: %w", err)
	}
	if result.Reason == "legacy_queue" && !result.Success {
		return RoundRobinResult{}, false, nil
	}
	switch result.Reason {
	case "assigned", "already_assigned", "queue_closed", "queue_waiting", "queue_limit_reached", "queue_protected", "pooled", "no_available_members", "queue_busy":
	case "forbidden", "not_found":
		return RoundRobinResult{}, true, ErrLeadNotFound
	default:
		return RoundRobinResult{}, true, fmt.Errorf("managed redistribution returned an invalid outcome")
	}
	response := RoundRobinResult{Success: result.Success, LeadID: current.ID, PipelineID: current.PipelineID, StageID: current.StageID}
	if result.RoundRobinID != nil {
		response.RoundRobinID, response.RoundRobinUsed = *result.RoundRobinID, true
	}
	if result.AssignedUserID != nil {
		response.AssignedUserID = *result.AssignedUserID
	}
	if result.PipelineID != nil {
		response.PipelineID = *result.PipelineID
	}
	if result.StageID != nil {
		response.StageID = *result.StageID
	}
	if !result.Success {
		response.Error = result.Reason
	}
	return response, true, nil
}
