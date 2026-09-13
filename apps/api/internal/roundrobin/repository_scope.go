package roundrobin

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func canManageRoundRobinScope(tenantContext tenant.Context) bool {
	if tenantContext.IsSuperAdmin || tenantContext.HasRole("owner", "admin") {
		return true
	}
	return tenantContext.HasPermission(permissions.DistributionManage)
}

func canManageRoundRobins(tenantContext tenant.Context) bool {
	if !canManageRoundRobinScope(tenantContext) {
		return false
	}
	if tenantContext.IsSuperAdmin || tenantContext.HasRole("owner", "admin") {
		return true
	}

	// Leaders keep their distribution permission, but every queue operation
	// remains limited to the teams, users and pipelines they lead. A
	// non-leader with the same explicit grant retains organization-wide access.
	return !tenantContext.IsTeamLeader
}

func ensureRoundRobinInputInScope(tenantContext tenant.Context, pipelineID *string, members []memberInput, membersSet bool, requirePipeline bool) error {
	if canManageRoundRobins(tenantContext) {
		return nil
	}
	if !tenantContext.IsTeamLeader {
		return tenant.ErrOrganizationAccessDenied
	}
	if requirePipeline {
		if pipelineID == nil || !tenantContext.LeadsPipeline(*pipelineID) {
			return tenant.ErrOrganizationAccessDenied
		}
	} else if pipelineID != nil && !tenantContext.LeadsPipeline(*pipelineID) {
		return tenant.ErrOrganizationAccessDenied
	}
	if !membersSet {
		return nil
	}
	if len(members) == 0 {
		return tenant.ErrOrganizationAccessDenied
	}
	for _, member := range members {
		if member.TeamID != nil {
			if member.UserID == nil && !tenantContext.LeadsTeam(*member.TeamID) {
				return tenant.ErrOrganizationAccessDenied
			}
			if member.UserID != nil && !tenantContext.LeadsTeam(*member.TeamID) {
				return tenant.ErrOrganizationAccessDenied
			}
			if member.UserID == nil {
				continue
			}
		}
		if member.UserID == nil || !tenantContext.LeadsUser(*member.UserID) {
			return tenant.ErrOrganizationAccessDenied
		}
	}
	return nil
}

func leadershipRoundRobinCondition(tenantContext tenant.Context, alias string, args *[]any) string {
	conditions := []string{}
	if tenantContext.UserID != "" {
		*args = append(*args, tenantContext.UserID)
		conditions = append(conditions, fmt.Sprintf("%s.created_by = $%d::uuid", alias, len(*args)))
	}
	if len(tenantContext.LedPipelineIDs) > 0 {
		conditions = append(conditions, fmt.Sprintf("%s.pipeline_id in (%s)", alias, appendUUIDPlaceholders(args, tenantContext.LedPipelineIDs)))
	}
	if len(tenantContext.LedTeamIDs) > 0 {
		conditions = append(conditions, fmt.Sprintf(`exists (
			select 1
			from public.round_robin_members scoped_rrm
			where scoped_rrm.organization_id = %s.organization_id
			  and scoped_rrm.round_robin_id = %s.id
			  and coalesce(scoped_rrm.is_active, true) = true
			  and scoped_rrm.team_id in (%s)
		)`, alias, alias, appendUUIDPlaceholders(args, tenantContext.LedTeamIDs)))
	}
	if len(tenantContext.LedUserIDs) > 0 {
		conditions = append(conditions, fmt.Sprintf(`exists (
			select 1
			from public.round_robin_members scoped_rrm
			where scoped_rrm.organization_id = %s.organization_id
			  and scoped_rrm.round_robin_id = %s.id
			  and coalesce(scoped_rrm.is_active, true) = true
			  and scoped_rrm.user_id in (%s)
		)`, alias, alias, appendUUIDPlaceholders(args, tenantContext.LedUserIDs)))
	}
	if len(conditions) == 0 {
		return "false"
	}
	return "(" + strings.Join(conditions, " or ") + ")"
}

func appendUUIDPlaceholders(args *[]any, values []string) string {
	placeholders := make([]string, 0, len(values))
	for _, value := range values {
		*args = append(*args, value)
		placeholders = append(placeholders, fmt.Sprintf("$%d::uuid", len(*args)))
	}
	if len(placeholders) == 0 {
		return "null"
	}
	return strings.Join(placeholders, ", ")
}

func (repo Repository) ensureRoundRobinVisible(ctx context.Context, q queryer, tenantContext tenant.Context, roundRobinID string) error {
	if canManageRoundRobins(tenantContext) {
		return repo.ensureRoundRobin(ctx, q, tenantContext.OrganizationID, roundRobinID)
	}
	if !tenantContext.IsTeamLeader {
		return tenant.ErrOrganizationAccessDenied
	}
	args := []any{tenantContext.OrganizationID, roundRobinID}
	condition := leadershipRoundRobinCondition(tenantContext, "rr", &args)
	var exists bool
	if err := q.QueryRow(ctx, `
		select exists (
			select 1
			from public.round_robins rr
			where rr.organization_id = $1::uuid
			  and rr.id = $2::uuid
			  and `+condition+`
		)
	`, args...).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrRoundRobinNotFound
	}
	return nil
}

func (repo Repository) ensureRoundRobinMutable(ctx context.Context, q queryer, tenantContext tenant.Context, roundRobinID string) error {
	return repo.ensureRoundRobinVisible(ctx, q, tenantContext, roundRobinID)
}

func (repo Repository) ensureRoundRobinMemberMutable(ctx context.Context, q queryer, tenantContext tenant.Context, memberID string) (string, error) {
	var roundRobinID string
	err := q.QueryRow(ctx, `
		select round_robin_id::text
		from public.round_robin_members
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, memberID).Scan(&roundRobinID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrMemberNotFound
	}
	if err != nil {
		return "", err
	}
	if err := repo.ensureRoundRobinMutable(ctx, q, tenantContext, roundRobinID); err != nil {
		return "", err
	}
	if _, err := repo.getStateForUpdate(ctx, q, tenantContext.OrganizationID, roundRobinID); err != nil {
		return "", err
	}
	return roundRobinID, nil
}

func (repo Repository) visibleRoundRobinIDSet(ctx context.Context, tenantContext tenant.Context) (map[string]bool, error) {
	if canManageRoundRobins(tenantContext) {
		return nil, nil
	}
	if !tenantContext.IsTeamLeader {
		return map[string]bool{}, nil
	}
	args := []any{tenantContext.OrganizationID}
	condition := leadershipRoundRobinCondition(tenantContext, "rr", &args)
	rows, err := repo.db.Pool().Query(ctx, `
		select rr.id::text
		from public.round_robins rr
		where rr.organization_id = $1::uuid
		  and `+condition+`
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := map[string]bool{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		result[id] = true
	}
	return result, rows.Err()
}
