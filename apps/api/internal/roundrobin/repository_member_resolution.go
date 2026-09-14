package roundrobin

import (
	"context"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) insertMembers(
	ctx context.Context,
	tx pgx.Tx,
	tenantContext tenant.Context,
	roundRobinID string,
	members []memberInput,
	ignoreAvailability bool,
) ([]string, error) {
	organizationID := tenantContext.OrganizationID
	insertedIDs := []string{}
	seen := map[string]struct{}{}

	for _, member := range members {
		memberKey, userID, teamID, err := repo.resolveMemberEntry(
			ctx,
			tx,
			organizationID,
			member,
			ignoreAvailability,
		)
		if err != nil {
			return nil, err
		}
		if err := ensureResolvedMemberInScope(tenantContext, userID, teamID); err != nil {
			return nil, err
		}
		if _, exists := seen[memberKey]; exists {
			continue
		}
		seen[memberKey] = struct{}{}

		var nextPosition int
		if err := tx.QueryRow(ctx, `
			select coalesce(max(position), -1) + 1
			from public.round_robin_members
			where organization_id = $1::uuid
			  and round_robin_id = $2::uuid
		`, organizationID, roundRobinID).Scan(&nextPosition); err != nil {
			return nil, err
		}

		var insertedID string
		err = tx.QueryRow(ctx, `
			insert into public.round_robin_members (
				organization_id,
				round_robin_id,
				team_id,
				user_id,
				weight,
				position,
				is_active
			)
			values (
				$1::uuid,
				$2::uuid,
				$3::uuid,
				$4::uuid,
				$5,
				$6,
				true
			)
			returning id::text
		`, organizationID, roundRobinID, nullable(teamID), nullable(userID), member.Weight, nextPosition).Scan(&insertedID)
		if err != nil {
			return nil, err
		}
		insertedIDs = append(insertedIDs, insertedID)
	}

	return insertedIDs, nil
}

func ensureResolvedMemberInScope(
	tenantContext tenant.Context,
	userID *string,
	teamID *string,
) error {
	if canManageRoundRobins(tenantContext) {
		return nil
	}
	if !tenantContext.IsTeamLeader {
		return tenant.ErrOrganizationAccessDenied
	}
	if teamID != nil && !tenantContext.LeadsTeam(*teamID) {
		return tenant.ErrOrganizationAccessDenied
	}
	if userID != nil && !tenantContext.LeadsUser(*userID) {
		return tenant.ErrOrganizationAccessDenied
	}
	return nil
}

func (repo Repository) resolveMemberEntry(
	ctx context.Context,
	q queryer,
	organizationID string,
	member memberInput,
	_ bool,
) (string, *string, *string, error) {
	if member.UserID != nil {
		if err := repo.validateUser(ctx, q, organizationID, *member.UserID); err != nil {
			return "", nil, nil, err
		}
		activeTeamIDs, err := repo.activeUserTeamIDs(ctx, q, organizationID, *member.UserID)
		if err != nil {
			return "", nil, nil, err
		}
		teamID, err := resolveDirectUserTeamID(activeTeamIDs, member.TeamID)
		if err != nil {
			return "", nil, nil, err
		}
		memberKey := "user:" + *member.UserID + ":team:none"
		if teamID != nil {
			memberKey = "user:" + *member.UserID + ":team:" + *teamID
		}
		return memberKey, member.UserID, teamID, nil
	}

	if member.TeamID == nil {
		return "", nil, nil, ErrInvalidReference
	}

	if err := repo.validateTeam(ctx, q, organizationID, *member.TeamID); err != nil {
		return "", nil, nil, err
	}
	return "team:" + *member.TeamID, nil, member.TeamID, nil
}

func resolveDirectUserTeamID(
	activeTeamIDs []string,
	requestedTeamID *string,
) (*string, error) {
	uniqueTeamIDs := make([]string, 0, len(activeTeamIDs))
	seen := map[string]struct{}{}
	for _, teamID := range activeTeamIDs {
		teamID = strings.TrimSpace(teamID)
		if teamID == "" {
			continue
		}
		if _, exists := seen[teamID]; exists {
			continue
		}
		seen[teamID] = struct{}{}
		uniqueTeamIDs = append(uniqueTeamIDs, teamID)
	}

	if requestedTeamID != nil {
		for _, teamID := range uniqueTeamIDs {
			if teamID == *requestedTeamID {
				value := teamID
				return &value, nil
			}
		}
		return nil, ErrInvalidReference
	}

	return nil, nil
}

func (repo Repository) activeUserTeamIDs(
	ctx context.Context,
	q queryer,
	organizationID string,
	userID string,
) ([]string, error) {
	rows, err := q.Query(ctx, `
		select tm.team_id::text
		from public.team_members tm
		join public.teams t
		  on t.id = tm.team_id
		 and t.organization_id = tm.organization_id
		 and coalesce(t.is_active, true) = true
		where tm.organization_id = $1::uuid
		  and tm.user_id = $2::uuid
		  and coalesce(tm.is_active, true) = true
		order by tm.created_at asc, tm.id asc
	`, organizationID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	teamIDs := []string{}
	for rows.Next() {
		var teamID string
		if err := rows.Scan(&teamID); err != nil {
			return nil, err
		}
		teamIDs = append(teamIDs, teamID)
	}
	return teamIDs, rows.Err()
}

func (repo Repository) validateTeam(ctx context.Context, q queryer, organizationID string, teamID string) error {
	var exists bool
	err := q.QueryRow(ctx, `
		select exists (
			select 1
			from public.teams
			where organization_id = $1::uuid
			  and id = $2::uuid
			  and coalesce(is_active, true) = true
		)
	`, organizationID, teamID).Scan(&exists)
	if err != nil {
		return err
	}
	if !exists {
		return ErrInvalidReference
	}
	return nil
}

func (repo Repository) validateUser(ctx context.Context, q queryer, organizationID string, userID string) error {
	var exists bool
	err := q.QueryRow(ctx, `
		select exists (
			select 1
			from public.users u
			join public.organization_members om
			  on om.user_id = u.id
			 and om.organization_id = $1::uuid
			where u.id = $2::uuid
			  and coalesce(u.is_active, false) = true
			  and coalesce(om.is_active, false) = true
		)
	`, organizationID, userID).Scan(&exists)
	if err != nil {
		return err
	}
	if !exists {
		return ErrInvalidReference
	}
	return nil
}
