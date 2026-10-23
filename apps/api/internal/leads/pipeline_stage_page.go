package leads

import (
	"context"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// The sentinel and returned cards share one filtered read. An older board total
// cannot determine whether this page has another matching card after its cursor.
func readPipelineStagePageWithQueryer(ctx context.Context, queryer pipelineBoardReadQueryer, actor tenant.Context, filter PipelineBoardFilter) (PipelineStageLeadsResponse, error) {
	limit := filter.Limit
	if limit <= 0 {
		limit = defaultPipelineBoardLimit
	}
	if limit > maxPipelineBoardLimit {
		limit = maxPipelineBoardLimit
	}
	filter.Limit = limit + 1
	leads, err := listPipelineBoardLeadsWithQueryer(ctx, queryer, actor, filter)
	if err != nil {
		return PipelineStageLeadsResponse{}, err
	}
	hasMore := len(leads) > limit
	if hasMore {
		// Only returned cards are enriched, serialized and used as the next
		// cursor. The sentinel is eligible for the following page's read.
		leads = leads[:limit:limit]
	}
	return PipelineStageLeadsResponse{StageID: filter.StageID, Leads: leads, HasMore: hasMore}, nil
}
