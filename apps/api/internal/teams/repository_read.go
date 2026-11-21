package teams

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) List(ctx context.Context, tenantContext tenant.Context, includeInactive bool) ([]Team, error) {
	where := []string{"t.organization_id = $1::uuid"}
	args := []any{tenantContext.OrganizationID}
	if !includeInactive {
		where = append(where, "t.is_active = true")
	}
	if !canViewAllTeams(tenantContext) {
		if !tenantContext.IsTeamLeader || len(tenantContext.LedTeamIDs) == 0 {
			return []Team{}, nil
		}
		placeholders := []string{}
		for _, teamID := range tenantContext.LedTeamIDs {
			args = append(args, teamID)
			placeholders = append(placeholders, fmt.Sprintf("$%d::uuid", len(args)))
		}
		where = append(where, "t.id in ("+strings.Join(placeholders, ", ")+")")
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select
			t.id::text,
			t.name,
			t.organization_id::text,
			t.created_at::text,
			t.revision,
			t.is_active,
			t.logo_url,
			t.created_by::text,
			u.id::text,
			u.name,
			u.email,
			u.avatar_url
		from public.teams t
		left join public.users u on u.id = t.created_by
		where `+strings.Join(where, " and ")+`
		order by t.name asc, t.created_at desc
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	teams := []Team{}
	for rows.Next() {
		team, err := scanTeam(rows)
		if err != nil {
			return nil, err
		}
		teams = append(teams, team)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(teams) == 0 {
		return []Team{}, nil
	}

	membersByTeam, err := repo.membersByTeam(ctx, tenantContext.OrganizationID)
	if err != nil {
		return nil, err
	}
	for index := range teams {
		teams[index].Members = membersByTeam[teams[index].ID]
		if teams[index].Members == nil {
			teams[index].Members = []TeamMember{}
		}
	}

	return teams, nil
}

func (repo Repository) Get(ctx context.Context, tenantContext tenant.Context, teamID string) (Team, error) {
	teamID, ok := normalizeUUID(teamID)
	if !ok {
		return Team{}, ErrInvalidInput
	}
	if !canViewTeam(tenantContext, teamID) {
		return Team{}, tenant.ErrOrganizationAccessDenied
	}
	return repo.getWithQueryer(ctx, repo.db.Pool(), tenantContext, teamID)
}

func (repo Repository) getWithQueryer(
	ctx context.Context,
	q teamReadExecutor,
	tenantContext tenant.Context,
	teamID string,
) (Team, error) {
	team, err := scanTeam(q.QueryRow(ctx, `
		select
			t.id::text,
			t.name,
			t.organization_id::text,
			t.created_at::text,
			t.revision,
			t.is_active,
			t.logo_url,
			t.created_by::text,
			u.id::text,
			u.name,
			u.email,
			u.avatar_url
		from public.teams t
		left join public.users u on u.id = t.created_by
		where t.organization_id = $1::uuid
		  and t.id = $2::uuid
	`, tenantContext.OrganizationID, teamID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Team{}, ErrTeamNotFound
	}
	if err != nil {
		return Team{}, err
	}
	membersByTeam, err := membersByTeamWithQueryer(ctx, q, tenantContext.OrganizationID, &teamID)
	if err != nil {
		return Team{}, err
	}
	team.Members = membersByTeam[team.ID]
	if team.Members == nil {
		team.Members = []TeamMember{}
	}
	return team, nil
}

func (repo Repository) membersByTeam(ctx context.Context, organizationID string) (map[string][]TeamMember, error) {
	return membersByTeamWithQueryer(ctx, repo.db.Pool(), organizationID, nil)
}

func membersByTeamWithQueryer(
	ctx context.Context,
	q teamReadExecutor,
	organizationID string,
	teamID *string,
) (map[string][]TeamMember, error) {
	args := []any{organizationID}
	teamPredicate := ""
	if teamID != nil {
		args = append(args, *teamID)
		teamPredicate = " and t.id = $2::uuid"
	}
	rows, err := q.Query(ctx, `
		select
			tm.id::text,
			tm.team_id::text,
			tm.user_id::text,
			tm.created_at::text,
			coalesce(tm.is_leader, false),
			u.id::text,
			u.name,
			u.email,
			u.avatar_url
		from public.team_members tm
		join public.teams t on t.id = tm.team_id and t.organization_id = $1::uuid
		join public.users u on u.id = tm.user_id
		join public.organization_members om
		  on om.organization_id = t.organization_id
		 and om.user_id = tm.user_id
		 and coalesce(om.is_active, false) = true
		 and om.deleted_at is null
		 and om.membership_generation = tm.membership_generation
		where coalesce(tm.is_active, true) = true`+teamPredicate+`
		  and coalesce(u.is_active, false) = true
		order by tm.created_at asc, tm.id asc
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := map[string][]TeamMember{}
	for rows.Next() {
		member, err := scanTeamMember(rows)
		if err != nil {
			return nil, err
		}
		result[member.TeamID] = append(result[member.TeamID], member)
	}
	return result, rows.Err()
}

func scanTeam(row teamScanner) (Team, error) {
	var team Team
	var logoURL, createdBy pgtype.Text
	var creatorID, creatorName, creatorEmail, creatorAvatar pgtype.Text
	err := row.Scan(&team.ID, &team.Name, &team.OrganizationID, &team.CreatedAt, &team.Revision, &team.IsActive, &logoURL, &createdBy, &creatorID, &creatorName, &creatorEmail, &creatorAvatar)
	if err != nil {
		return Team{}, err
	}
	team.LogoURL = textPointer(logoURL)
	team.CreatedBy = textPointer(createdBy)
	if creatorID.Valid {
		team.CreatedByUser = &TeamUser{
			ID:        creatorID.String,
			Name:      textPointer(creatorName),
			Email:     textPointer(creatorEmail),
			AvatarURL: textPointer(creatorAvatar),
		}
	}
	team.Members = []TeamMember{}
	return team, nil
}

func scanTeamMember(row teamScanner) (TeamMember, error) {
	var member TeamMember
	var userName, userEmail, userAvatar pgtype.Text
	var userID string
	if err := row.Scan(&member.ID, &member.TeamID, &member.UserID, &member.CreatedAt, &member.IsLeader, &userID, &userName, &userEmail, &userAvatar); err != nil {
		return TeamMember{}, err
	}
	member.User = &TeamUser{
		ID:        userID,
		Name:      textPointer(userName),
		Email:     textPointer(userEmail),
		AvatarURL: textPointer(userAvatar),
	}
	return member, nil
}
