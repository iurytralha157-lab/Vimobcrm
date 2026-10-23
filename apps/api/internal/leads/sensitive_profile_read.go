package leads

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func loadSensitiveLeadProfile(ctx context.Context, q attachmentQueryer, actor tenant.Context, leadID string) (SensitiveLeadProfile, error) {
	leadID, ok := normalizeUUID(leadID)
	if !ok {
		return SensitiveLeadProfile{}, ErrLeadNotFound
	}
	if !actor.HasPermission(permissions.LeadOperate) {
		return SensitiveLeadProfile{}, tenant.ErrOrganizationAccessDenied
	}
	var cpf, rg pgtype.Text
	err := q.QueryRow(ctx, sensitiveLeadProfileQuery(actor), actor.OrganizationID, canViewAllLeads(actor), actor.UserID,
		actor.HasPermission(permissions.LeadViewTeam), leadID, actor.LedTeamIDs).Scan(&cpf, &rg)
	if errors.Is(err, pgx.ErrNoRows) {
		return SensitiveLeadProfile{}, ErrLeadNotFound
	}
	if err != nil {
		return SensitiveLeadProfile{}, err
	}
	return SensitiveLeadProfile{CPF: textValue(cpf), RG: textValue(rg)}, nil
}

// Visibility, operational team boundary and personal data share a statement
// snapshot. A transfer cannot happen between authorizing and reading CPF/RG.
func sensitiveLeadProfileQuery(actor tenant.Context) string {
	own := "false"
	if actor.HasPermission(permissions.LeadViewOwn) {
		own = "true"
	}
	return `select nullif(l.metadata #>> '{profile,cpf}', ''), nullif(l.metadata #>> '{profile,rg}', '')
	 from public.leads l where l.organization_id=$1::uuid and l.id=$5::uuid
	 and ` + leadVisibilitySQL("$2", "$3", "$4", actor.HasPermission(permissions.LeadViewOwn)) + `
	 and ($2::boolean or (` + own + ` and l.assigned_user_id=$3::uuid)
	 or ($4::boolean and (nullif(to_jsonb(l)->>'team_id','') is null
	 or nullif(to_jsonb(l)->>'team_id','')=any($6::text[])))) limit 1`
}
