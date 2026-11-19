package leads

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/leadscope"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/searchtext"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) List(ctx context.Context, tenantContext tenant.Context, filter ListFilter) (ListResponse, error) {
	args := []any{
		tenantContext.OrganizationID,
		canViewAllLeads(tenantContext),
		tenantContext.UserID,
		tenantContext.HasPermission("lead_view_team"),
	}

	where := []string{
		"l.organization_id = $1::uuid",
		leadVisibilitySQL("$2", "$3", "$4", tenantContext.HasPermission(permissions.LeadViewOwn)),
	}

	addFilter := func(clause string, value any) {
		args = append(args, value)
		where = append(where, fmt.Sprintf(clause, len(args)))
	}

	if strings.TrimSpace(filter.StageID) != "" {
		stageID, ok := normalizeUUID(filter.StageID)
		if !ok {
			return ListResponse{}, fmt.Errorf("%w: stageId is invalid", ErrInvalidInput)
		}
		addFilter("l.stage_id = $%d::uuid", stageID)
	}
	if filter.Unassigned {
		where = append(where, "l.assigned_user_id is null")
	} else if strings.TrimSpace(filter.AssignedUserID) != "" {
		assignedUserID, ok := normalizeUUID(filter.AssignedUserID)
		if !ok {
			return ListResponse{}, fmt.Errorf("%w: assignedUserId is invalid", ErrInvalidInput)
		}
		addFilter("l.assigned_user_id = $%d::uuid", assignedUserID)
	}
	if filter.DealStatus != "" {
		addFilter("l.deal_status = $%d", filter.DealStatus)
	}
	if filter.Search != "" {
		args = append(args, searchtext.Pattern(filter.Search))
		index := len(args)
		where = append(where, searchtext.AnySQL([]string{"l.name", "l.phone", "l.email"}, fmt.Sprintf("$%d", index)))
	}

	args = append(args, filter.Limit, filter.Offset)
	limitIndex := len(args) - 1
	offsetIndex := len(args)
	args, propertyVisibility := appendCanonicalPropertyVisibility(args, tenantContext, "visible_property")

	query := `
		select
			count(*) over() as total_count,
			` + leadSelectFields(propertyVisibility) + `
		from public.leads l
		left join public.stages s on s.id = l.stage_id
		left join public.users u on u.id = l.assigned_user_id
		where ` + strings.Join(where, " and ") + `
		order by l.created_at desc, l.id desc
		limit $` + fmt.Sprint(limitIndex) + `
		offset $` + fmt.Sprint(offsetIndex)

	rows, err := repo.db.Pool().Query(ctx, query, args...)
	if err != nil {
		return ListResponse{}, err
	}
	defer rows.Close()

	leads := make([]Lead, 0, filter.Limit)
	var total int64

	for rows.Next() {
		lead, rowTotal, err := scanLeadWithTotal(rows)
		if err != nil {
			return ListResponse{}, err
		}
		total = rowTotal
		leads = append(leads, withLeadOperationCapability(tenantContext, lead))
	}

	if err := rows.Err(); err != nil {
		return ListResponse{}, err
	}
	rows.Close()
	if err := hydrateQueuePoolLeads(ctx, repo.db.Pool(), tenantContext, leads); err != nil {
		return ListResponse{}, err
	}
	repo.hydrateLeadAvatars(ctx, tenantContext.OrganizationID, leads)

	return ListResponse{
		Data:   leads,
		Total:  total,
		Limit:  filter.Limit,
		Offset: filter.Offset,
	}, nil
}

func (repo Repository) Get(ctx context.Context, tenantContext tenant.Context, leadID string) (Lead, error) {
	leadID, ok := normalizeUUID(leadID)
	if !ok {
		return Lead{}, ErrLeadNotFound
	}

	args := []any{
		tenantContext.OrganizationID,
		canViewAllLeads(tenantContext),
		tenantContext.UserID,
		tenantContext.HasPermission("lead_view_team"),
		leadID,
	}
	args, propertyVisibility := appendCanonicalPropertyVisibility(args, tenantContext, "visible_property")
	query := `
		select ` + leadSelectFields(propertyVisibility) + `, ` + leadDetailTagsSQL + `
		from public.leads l
		left join public.stages s on s.id = l.stage_id
		left join public.users u on u.id = l.assigned_user_id
		where l.organization_id = $1::uuid
		  and ` + leadVisibilitySQL("$2", "$3", "$4", tenantContext.HasPermission(permissions.LeadViewOwn)) + `
		  and l.id = $5::uuid
		limit 1`

	var tags LeadTags
	lead, err := scanLead(leadDetailTagsRow{row: repo.db.Pool().QueryRow(ctx, query, args...), tags: &tags})
	if errors.Is(err, pgx.ErrNoRows) {
		return Lead{}, ErrLeadNotFound
	}
	if err != nil {
		return Lead{}, err
	}
	lead.Tags = &tags
	if err := hydrateQueuePoolLead(ctx, repo.db.Pool(), tenantContext, &lead); err != nil {
		return Lead{}, err
	}
	repo.hydrateLeadAvatar(ctx, tenantContext.OrganizationID, &lead)

	return withLeadOperationCapability(tenantContext, lead), nil
}

func (repo Repository) GetSensitiveProfile(ctx context.Context, tenantContext tenant.Context, leadID string) (SensitiveLeadProfile, error) {
	return loadSensitiveLeadProfile(ctx, repo.db.Pool(), tenantContext, leadID)
}

func leadSelectFields(propertyVisibility string) string {
	propertyID := pipelineBoardVisiblePropertyIDSQL("property_id", propertyVisibility)
	interestPropertyID := pipelineBoardVisiblePropertyIDSQL("interest_property_id", propertyVisibility)
	return `
		l.id::text,
		l.organization_id::text,
		l.name,
		l.email,
		l.phone,
		l.source,
		l.status,
		l.deal_status,
		l.priority,
		l.message,
		l.property_code,
		` + propertyID + `,
		` + interestPropertyID + `,
		l.pipeline_id::text,
		l.stage_id::text,
		l.assigned_user_id::text,
		l.team_id::text,
		l.valor_interesse::text,
		l.commission_percentage::text,
		l.lost_reason,
		l.feedback,
		l.finalidade_compra,
		l.trabalha,
		l.procura_financiamento,
		l.is_own_resource,
		l.reentry_count,
		l.cargo,
		l.empresa,
		l.profissao,
		l.endereco,
		l.bairro,
		l.numero,
		l.cep,
		l.cidade,
		l.uf,
		l.renda_familiar,
		l.faixa_valor_imovel,
		l.metadata,
		l.created_at,
		l.updated_at,
		l.stage_entered_at,
		l.board_order_at,
		l.last_contact_at,
		l.next_follow_up_at,
		l.first_response_at,
		l.first_response_seconds,
		l.first_response_channel,
		l.first_response_is_automation,
		l.whatsapp_avatar_url,
		l.whatsapp_avatar_storage_path,
		l.whatsapp_avatar_synced_at,
		s.id::text,
		s.name,
		s.color,
		s.stage_key,
		u.id::text,
		u.name,
		u.avatar_url`
}

func leadVisibilitySQL(canViewAllPlaceholder string, userIDPlaceholder string, canViewTeamPlaceholder string, canViewOwn bool) string {
	return leadscope.VisibilitySQL("l", canViewAllPlaceholder, userIDPlaceholder, canViewTeamPlaceholder, canViewOwn)
}
