package leads

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/authorization"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) ensureLeadVisible(ctx context.Context, tenantContext tenant.Context, leadID string) error {
	var id string
	err := repo.db.Pool().QueryRow(ctx, `
		select l.id::text
		from public.leads l
		where l.organization_id = $1::uuid
		  and `+leadVisibilitySQL("$2", "$3", "$4", tenantContext.HasPermission(permissions.LeadViewOwn))+`
		  and l.id = $5::uuid
		limit 1
	`, tenantContext.OrganizationID, canViewAllLeads(tenantContext), tenantContext.UserID, tenantContext.HasPermission("lead_view_team"), leadID).Scan(&id)
	if err == pgx.ErrNoRows {
		return ErrLeadNotFound
	}
	return err
}

func (repo Repository) ensureLeadEditable(ctx context.Context, tenantContext tenant.Context, leadID string) error {
	var assignedUserID, teamID pgtype.Text
	err := repo.db.Pool().QueryRow(ctx, `
		select
			assigned_user_id::text,
			nullif(to_jsonb(l)->>'team_id', '')
		from public.leads l
		where organization_id = $1::uuid and id = $2::uuid
		limit 1
	`, tenantContext.OrganizationID, leadID).Scan(&assignedUserID, &teamID)
	if err == pgx.ErrNoRows {
		return ErrLeadNotFound
	}
	if err != nil {
		return err
	}
	if !authorization.CanOperateLead(tenantContext, authorization.LeadResource{
		AssignedUserID: textValue(assignedUserID),
		TeamID:         textValue(teamID),
	}) {
		return tenant.ErrOrganizationAccessDenied
	}
	return nil
}

func ensureLeadEditableForUpdate(
	ctx context.Context,
	tx pgx.Tx,
	tenantContext tenant.Context,
	leadID string,
) error {
	var assignedUserID, teamID pgtype.Text
	err := tx.QueryRow(ctx, `
		select
			assigned_user_id::text,
			nullif(to_jsonb(l)->>'team_id', '')
		from public.leads l
		where organization_id = $1::uuid and id = $2::uuid
		limit 1
		for update of l
	`, tenantContext.OrganizationID, leadID).Scan(&assignedUserID, &teamID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrLeadNotFound
	}
	if err != nil {
		return err
	}
	if !authorization.CanOperateLead(tenantContext, authorization.LeadResource{
		AssignedUserID: textValue(assignedUserID),
		TeamID:         textValue(teamID),
	}) {
		return tenant.ErrOrganizationAccessDenied
	}
	return nil
}

func optionalStringFromPointer(value *string, maxLength int) *string {
	if value == nil {
		return nil
	}
	return optionalString(*value, maxLength)
}
