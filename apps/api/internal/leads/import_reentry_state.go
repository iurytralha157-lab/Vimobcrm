package leads

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// importReentryState is private commercial state for the history writer. Public
// lead responses must continue applying their independent property read scope.
type importReentryState struct {
	PipelineID    *string
	StageID       *string
	StageName     *string
	PropertyID    *string
	PropertyCode  *string
	InterestValue *string
	LostReason    *string
	DealStatus    string
}

func loadImportReentryState(ctx context.Context, queryer leadTeamQueryer, organizationID, leadID string) (importReentryState, error) {
	var actualLeadID, actualOrganizationID string
	var pipelineID, stageID, stageName, propertyID, propertyCode, interestValue, lostReason, dealStatus pgtype.Text
	err := queryer.QueryRow(ctx, `
		select l.id::text,
		       l.organization_id::text,
		       l.pipeline_id::text,
		       l.stage_id::text,
		       s.name,
		       coalesce(l.interest_property_id, l.property_id)::text,
		       l.property_code,
		       l.valor_interesse::text,
		       l.lost_reason,
		       l.deal_status
		from public.leads l
		left join public.stages s
		  on s.id = l.stage_id
		 and s.organization_id = l.organization_id
		where l.organization_id = $1::uuid
		  and l.id = $2::uuid
		limit 1
	`, organizationID, leadID).Scan(&actualLeadID, &actualOrganizationID,
		&pipelineID, &stageID, &stageName, &propertyID, &propertyCode, &interestValue, &lostReason, &dealStatus)
	if errors.Is(err, pgx.ErrNoRows) {
		return importReentryState{}, ErrLeadNotFound
	}
	if err != nil {
		return importReentryState{}, err
	}
	if actualOrganizationID != organizationID || actualLeadID != leadID {
		return importReentryState{}, ErrLeadNotFound
	}
	return importReentryState{
		PipelineID:    textPointer(pipelineID),
		StageID:       textPointer(stageID),
		StageName:     textPointer(stageName),
		PropertyID:    textPointer(propertyID),
		PropertyCode:  textPointer(propertyCode),
		InterestValue: textPointer(interestValue),
		LostReason:    textPointer(lostReason),
		DealStatus:    textValueWithDefault(dealStatus, "open"),
	}, nil
}
