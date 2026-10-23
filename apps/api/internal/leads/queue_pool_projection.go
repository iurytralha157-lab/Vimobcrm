package leads

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// QueuePoolMetadata is returned only by the backend audience check. The owner
// on Lead remains authoritative; a client cannot turn an unassigned lead into
// a queue pool by setting presentation fields.
type QueuePoolMetadata struct {
	RoundRobinID string     `json:"roundRobinId"`
	EpisodeID    string     `json:"episodeId"`
	Revision     int64      `json:"revision"`
	State        string     `json:"state"`
	Reason       string     `json:"reason"`
	EnteredAt    *time.Time `json:"enteredAt,omitempty"`
	NextActionAt *time.Time `json:"nextActionAt,omitempty"`
	CanClaim     bool       `json:"canClaim"`
}

type queuePoolProjection struct {
	Access   *bool
	Metadata *QueuePoolMetadata
}

type queuePoolProjectionRow struct {
	row        scanner
	projection *queuePoolProjection
}

func (row queuePoolProjectionRow) Scan(dest ...any) error {
	var raw []byte
	if err := row.row.Scan(append(dest, &row.projection.Access, &raw)...); err != nil {
		return err
	}
	if len(raw) > 0 && string(raw) != "null" {
		return json.Unmarshal(raw, &row.projection.Metadata)
	}
	return nil
}

func isQueuePoolSnapshot(current leadSnapshot) bool {
	value, _ := current.Data["__queue_pool_private"].(bool)
	return value
}

// One bounded enrichment query per page, without a query per card. The same
// database functions serve HTTP scope, RLS and claim authorization.
func loadQueuePoolProjections(ctx context.Context, queryer notificationRowsQueryer, actor tenant.Context, ids []string) (map[string]queuePoolProjection, error) {
	result := make(map[string]queuePoolProjection, len(ids))
	if len(ids) == 0 {
		return result, nil
	}
	rows, err := queryer.Query(ctx, `select l.id::text,
		private.queue_pool_read_access(l.organization_id,l.id,$2::uuid),
		private.queue_pool_metadata(l.organization_id,l.id,$2::uuid)
		from public.leads l where l.organization_id=$1::uuid and l.id=any($3::uuid[])`,
		actor.OrganizationID, actor.UserID, ids)
	if err != nil {
		return nil, fmt.Errorf("load queue pool projection: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var projection queuePoolProjection
		var raw []byte
		if err := rows.Scan(&id, &projection.Access, &raw); err != nil {
			return nil, err
		}
		if projection.Access != nil && !*projection.Access {
			return nil, ErrLeadNotFound
		}
		if len(raw) > 0 && string(raw) != "null" {
			if err := json.Unmarshal(raw, &projection.Metadata); err != nil {
				return nil, fmt.Errorf("decode queue pool projection: %w", err)
			}
		}
		result[id] = projection
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for _, id := range ids {
		if _, present := result[id]; !present {
			return nil, ErrLeadNotFound
		}
	}
	return result, nil
}

func hydrateQueuePoolLeads(ctx context.Context, queryer notificationRowsQueryer, actor tenant.Context, leads []Lead) error {
	ids := make([]string, 0, len(leads))
	for _, lead := range leads {
		ids = append(ids, lead.ID)
	}
	projections, err := loadQueuePoolProjections(ctx, queryer, actor, ids)
	if err != nil {
		return err
	}
	for index := range leads {
		projection := projections[leads[index].ID]
		leads[index].QueuePool = projection.Metadata
		leads[index].QueuePoolReadAccess = projection.Access
		leads[index] = withLeadOperationCapability(actor, leads[index])
	}
	return nil
}

func hydrateQueuePoolLead(ctx context.Context, queryer leadTeamQueryer, actor tenant.Context, lead *Lead) error {
	var raw []byte
	if err := queryer.QueryRow(ctx, `select
		private.queue_pool_read_access($1::uuid,$2::uuid,$3::uuid),
		private.queue_pool_metadata($1::uuid,$2::uuid,$3::uuid)`,
		actor.OrganizationID, lead.ID, actor.UserID).Scan(&lead.QueuePoolReadAccess, &raw); err != nil {
		return err
	}
	if lead.QueuePoolReadAccess != nil && !*lead.QueuePoolReadAccess {
		return ErrLeadNotFound
	}
	if len(raw) > 0 && string(raw) != "null" {
		if err := json.Unmarshal(raw, &lead.QueuePool); err != nil {
			return err
		}
	}
	*lead = withLeadOperationCapability(actor, *lead)
	return nil
}

func hydrateQueuePoolBoard(ctx context.Context, queryer notificationRowsQueryer, actor tenant.Context, leads []*PipelineBoardLead) error {
	ids := make([]string, 0, len(leads))
	for _, lead := range leads {
		ids = append(ids, lead.ID)
	}
	projections, err := loadQueuePoolProjections(ctx, queryer, actor, ids)
	if err != nil {
		return err
	}
	for _, lead := range leads {
		projection := projections[lead.ID]
		lead.QueuePool = projection.Metadata
		if projection.Access != nil {
			lead.CanOperate = false
		}
	}
	return nil
}
