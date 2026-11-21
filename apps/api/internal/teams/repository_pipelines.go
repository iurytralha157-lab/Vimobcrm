package teams

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) ListTeamPipelines(ctx context.Context, tenantContext tenant.Context, teamID string) ([]TeamPipelineRelation, error) {
	args := []any{tenantContext.OrganizationID}
	where := []string{"tp.organization_id = $1::uuid"}
	if strings.TrimSpace(teamID) != "" {
		normalizedTeamID, ok := normalizeUUID(teamID)
		if !ok {
			return nil, ErrInvalidInput
		}
		if !canViewAllTeams(tenantContext) && !tenantContext.LeadsTeam(normalizedTeamID) {
			return []TeamPipelineRelation{}, nil
		}
		args = append(args, normalizedTeamID)
		where = append(where, fmt.Sprintf("tp.team_id = $%d::uuid", len(args)))
	} else if !canViewAllTeams(tenantContext) {
		if !tenantContext.IsTeamLeader || len(tenantContext.LedTeamIDs) == 0 {
			return []TeamPipelineRelation{}, nil
		}
		placeholders := []string{}
		for _, ledTeamID := range tenantContext.LedTeamIDs {
			args = append(args, ledTeamID)
			placeholders = append(placeholders, fmt.Sprintf("$%d::uuid", len(args)))
		}
		where = append(where, "tp.team_id in ("+strings.Join(placeholders, ", ")+")")
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select
			tp.id::text,
			tp.team_id::text,
			tp.pipeline_id::text,
			tp.created_at::text,
			p.id::text,
			p.name,
			t.id::text,
			t.name
		from public.team_pipelines tp
		join public.pipelines p
		  on p.id = tp.pipeline_id
		 and p.organization_id = tp.organization_id
		join public.teams t
		  on t.id = tp.team_id
		 and t.organization_id = tp.organization_id
		where `+strings.Join(where, " and ")+`
		order by t.name asc, p.name asc
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []TeamPipelineRelation{}
	for rows.Next() {
		item, err := scanTeamPipeline(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (repo Repository) AssignPipelineToTeam(ctx context.Context, tenantContext tenant.Context, request AssignPipelineRequest) (TeamPipelineRelation, error) {
	item, _, err := repo.assignPipelineToTeam(ctx, tenantContext, request)
	return item, err
}

func (repo Repository) assignPipelineToTeam(ctx context.Context, tenantContext tenant.Context, request AssignPipelineRequest) (TeamPipelineRelation, bool, error) {
	teamID, pipelineID, err := normalizeTeamPipelineRequest(request)
	if err != nil {
		return TeamPipelineRelation{}, false, err
	}
	if !canManageTeamPipeline(tenantContext, teamID) {
		return TeamPipelineRelation{}, false, tenant.ErrOrganizationAccessDenied
	}
	tx, err := repo.beginTeamMutation(ctx)
	if err != nil {
		return TeamPipelineRelation{}, false, err
	}
	defer tx.Rollback(ctx)
	if err := setAuditActor(ctx, tx, tenantContext); err != nil {
		return TeamPipelineRelation{}, false, err
	}
	if err := ensureTeamAndPipelineWithQueryer(ctx, tx, tenantContext.OrganizationID, teamID, pipelineID); err != nil {
		return TeamPipelineRelation{}, false, err
	}

	tag, err := tx.Exec(ctx, `
		insert into public.team_pipelines (organization_id, team_id, pipeline_id)
		values ($1::uuid, $2::uuid, $3::uuid)
		on conflict (team_id, pipeline_id) do nothing
	`, tenantContext.OrganizationID, teamID, pipelineID)
	if err != nil {
		return TeamPipelineRelation{}, false, err
	}
	item, err := getTeamPipelineByPairWithQueryer(ctx, tx, tenantContext.OrganizationID, teamID, pipelineID)
	if err != nil {
		return TeamPipelineRelation{}, false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return TeamPipelineRelation{}, false, err
	}

	return item, tag.RowsAffected() > 0, nil
}

func (repo Repository) RemovePipelineFromTeam(ctx context.Context, tenantContext tenant.Context, request AssignPipelineRequest) error {
	_, err := repo.removePipelineFromTeam(ctx, tenantContext, request)
	return err
}

func (repo Repository) removePipelineFromTeam(ctx context.Context, tenantContext tenant.Context, request AssignPipelineRequest) (bool, error) {
	teamID, pipelineID, err := normalizeTeamPipelineRequest(request)
	if err != nil {
		return false, err
	}
	if !canManageTeamPipeline(tenantContext, teamID) {
		return false, tenant.ErrOrganizationAccessDenied
	}

	tx, err := repo.beginTeamMutation(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)
	if err := setAuditActor(ctx, tx, tenantContext); err != nil {
		return false, err
	}

	tag, err := tx.Exec(ctx, `
		delete from public.team_pipelines
		where organization_id = $1::uuid
		  and team_id = $2::uuid
		  and pipeline_id = $3::uuid
	`, tenantContext.OrganizationID, teamID, pipelineID)
	if err != nil {
		return false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func (repo Repository) getTeamPipelineByPair(ctx context.Context, organizationID string, teamID string, pipelineID string) (TeamPipelineRelation, error) {
	return getTeamPipelineByPairWithQueryer(ctx, repo.db.Pool(), organizationID, teamID, pipelineID)
}

func getTeamPipelineByPairWithQueryer(ctx context.Context, q queryRowExecutor, organizationID string, teamID string, pipelineID string) (TeamPipelineRelation, error) {
	item, err := scanTeamPipeline(q.QueryRow(ctx, `
		select
			tp.id::text,
			tp.team_id::text,
			tp.pipeline_id::text,
			tp.created_at::text,
			p.id::text,
			p.name,
			t.id::text,
			t.name
		from public.team_pipelines tp
		join public.pipelines p
		  on p.id = tp.pipeline_id
		 and p.organization_id = tp.organization_id
		join public.teams t
		  on t.id = tp.team_id
		 and t.organization_id = tp.organization_id
		where tp.organization_id = $1::uuid
		  and tp.team_id = $2::uuid
		  and tp.pipeline_id = $3::uuid
	`, organizationID, teamID, pipelineID))
	if errors.Is(err, pgx.ErrNoRows) {
		return TeamPipelineRelation{}, ErrInvalidInput
	}
	return item, err
}

func scanTeamPipeline(row teamScanner) (TeamPipelineRelation, error) {
	var item TeamPipelineRelation
	var pipelineID, pipelineName, teamID, teamName string
	if err := row.Scan(&item.ID, &item.TeamID, &item.PipelineID, &item.CreatedAt, &pipelineID, &pipelineName, &teamID, &teamName); err != nil {
		return TeamPipelineRelation{}, err
	}
	item.Pipeline = &EntityRef{ID: pipelineID, Name: pipelineName}
	item.Team = &EntityRef{ID: teamID, Name: teamName}
	return item, nil
}

func (repo Repository) ensureTeamAndPipeline(ctx context.Context, organizationID string, teamID string, pipelineID string) error {
	return ensureTeamAndPipelineWithQueryer(ctx, repo.db.Pool(), organizationID, teamID, pipelineID)
}

func ensureTeamAndPipelineWithQueryer(ctx context.Context, q queryRowExecutor, organizationID string, teamID string, pipelineID string) error {
	var ok bool
	if err := q.QueryRow(ctx, `
		select exists (
			select 1
			from public.teams t
			where t.organization_id = $1::uuid
			  and t.id = $2::uuid
		) and exists (
			select 1
			from public.pipelines p
			where p.organization_id = $1::uuid
			  and p.id = $3::uuid
		)
	`, organizationID, teamID, pipelineID).Scan(&ok); err != nil {
		return err
	}
	if !ok {
		return ErrInvalidInput
	}
	return nil
}

func normalizeTeamPipelineRequest(request AssignPipelineRequest) (string, string, error) {
	teamID, ok := normalizeUUID(request.TeamID)
	if !ok {
		return "", "", ErrInvalidInput
	}
	pipelineID, ok := normalizeUUID(request.PipelineID)
	if !ok {
		return "", "", ErrInvalidInput
	}
	return teamID, pipelineID, nil
}
