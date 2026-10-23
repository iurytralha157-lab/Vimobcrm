package leads

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/authorization"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type leadCreationTransaction interface {
	leadTeamQueryer
	Commit(context.Context) error
}

// loadLeadCreationSnapshot reads the final mutation state in its transaction.
// It is internal: createLeadResponse applies the caller's final read scope.
func loadLeadCreationSnapshot(ctx context.Context, queryer leadTeamQueryer, tenantContext tenant.Context, leadID string) (Lead, error) {
	args, propertyVisibility := appendCanonicalPropertyVisibility([]any{tenantContext.OrganizationID, leadID}, tenantContext, "visible_property")
	args = append(args, tenantContext.UserID)
	actorParameter := fmt.Sprintf("$%d::uuid", len(args))
	var projection queuePoolProjection
	lead, err := scanLead(queuePoolProjectionRow{projection: &projection, row: queryer.QueryRow(ctx, `
		select `+leadSelectFields(propertyVisibility)+`,
		private.queue_pool_read_access(l.organization_id,l.id,`+actorParameter+`),
		private.queue_pool_metadata(l.organization_id,l.id,`+actorParameter+`)
		from public.leads l
		left join public.stages s
		  on s.id = l.stage_id
		 and s.organization_id = l.organization_id
		left join public.users u on u.id = l.assigned_user_id
		where l.organization_id = $1::uuid
		  and l.id = $2::uuid
		limit 1
	`, args...)})
	if errors.Is(err, pgx.ErrNoRows) {
		return Lead{}, ErrLeadNotFound
	}
	if err != nil {
		return Lead{}, err
	}
	if lead.OrganizationID != tenantContext.OrganizationID || lead.ID != leadID {
		return Lead{}, ErrLeadNotFound
	}
	lead.QueuePoolReadAccess, lead.QueuePool = projection.Access, projection.Metadata
	return withLeadOperationCapability(tenantContext, lead), nil
}

// A failure to prepare the response aborts before commit. Once commit succeeds,
// no visibility-dependent read can turn the successful write into a false 404.
func commitLeadCreation(ctx context.Context, tx leadCreationTransaction, tenantContext tenant.Context, leadID string) (Lead, error) {
	lead, err := loadLeadCreationSnapshot(ctx, tx, tenantContext, leadID)
	if err != nil {
		return Lead{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Lead{}, err
	}
	return lead, nil
}

func createLeadResponse(tenantContext tenant.Context, result CreateResult) CreateResponse {
	if result.Lead.OrganizationID != tenantContext.OrganizationID {
		return CreateResponse{}
	}
	response := CreateResponse{
		LeadID:              result.Lead.ID,
		Reentry:             result.Reentry,
		DistributionOutcome: result.DistributionOutcome,
	}
	if result.ReceiptOnly {
		return response
	}
	if !authorization.CanViewLead(tenantContext, authorization.LeadResource{
		AssignedUserID:      result.Lead.AssignedUserID,
		TeamID:              result.Lead.TeamID,
		QueuePoolReadAccess: result.Lead.QueuePoolReadAccess,
	}) {
		return response
	}
	response.LeadVisible = true
	response.Data = &result.Lead
	response.AssignedUserName = result.AssignedUserName
	return response
}

// Creation invalidates organization caches; each subscriber must re-read its
// own authorized scope. Routing and assignee details do not belong in this bus.
func (handler Handler) publishLeadCreationEvent(tenantContext tenant.Context, leadID string) {
	handler.publishLeadEvent(tenantContext, "lead.created", leadID, nil)
}
