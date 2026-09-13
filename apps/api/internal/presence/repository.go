package presence

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/pgvalue"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

const listUsersQuery = `
with active_team_leaders as (
  select distinct
    member.organization_id,
    member.user_id
  from public.team_members member
  join public.teams team
    on team.id = member.team_id
   and team.organization_id = member.organization_id
  where member.organization_id = $1::uuid
    and coalesce(member.is_active, true) = true
    and coalesce(member.is_leader, false) = true
    and coalesce(team.is_active, true) = true
),
roster as (
  select
    om.organization_id,
    u.id as user_uuid,
    u.id::text as user_id,
    coalesce(nullif(btrim(u.name), ''), 'Usuário') as name,
    nullif(btrim(u.avatar_url), '') as avatar_url,
    coalesce(nullif(lower(btrim(om.role)), ''), 'user') as member_role,
    team_leader.user_id is not null as is_team_leader
  from public.organization_members om
  join public.users u
    on u.id = om.user_id
  left join active_team_leaders team_leader
    on team_leader.organization_id = om.organization_id
   and team_leader.user_id = om.user_id
  where om.organization_id = $1::uuid
    and (
      not $3::boolean
      or om.user_id = any($4::uuid[])
    )
    and coalesce(om.is_active, false) = true
    and om.deleted_at is null
    and coalesce(u.is_active, false) = true
    and lower(btrim(coalesce(u.role, ''))) <> 'super_admin'
),
fresh_activity as (
  select
    activity.organization_id,
    activity.user_id,
    bool_or(activity.status = 'online') as has_online,
    bool_or(activity.status = 'idle') as has_idle,
    case
      when bool_or(activity.status = 'online') then null
      when bool_or(activity.status = 'idle')
      and coalesce(bool_and(
        activity.idle_since_at is not null
      ) filter (
        where activity.status = 'idle'
      ), false) then max(activity.idle_since_at) filter (
        where activity.status = 'idle'
      )
      else null
    end as idle_since_at
  from public.user_activity_sessions activity
  where activity.organization_id = $1::uuid
    and (
      not $3::boolean
      or activity.user_id = any($4::uuid[])
    )
    and activity.disconnected_at is null
    and activity.last_seen_at >= $2::timestamptz
    and activity.status in ('online', 'idle')
  group by activity.organization_id, activity.user_id
),
presence as (
  select
    roster.user_id,
    roster.name,
    roster.avatar_url,
    roster.member_role,
    roster.is_team_leader,
    case
      when coalesce(fresh.has_online, false) then 'online'
      when coalesce(fresh.has_idle, false) then 'idle'
      else 'offline'
    end as presence_status,
    latest_activity.last_seen_at,
    fresh.idle_since_at
  from roster
  left join fresh_activity fresh
    on fresh.organization_id = roster.organization_id
   and fresh.user_id = roster.user_uuid
  left join lateral (
    select activity.last_seen_at
    from public.user_activity_sessions activity
    where activity.organization_id = roster.organization_id
      and activity.user_id = roster.user_uuid
    order by activity.last_seen_at desc, activity.id desc
    limit 1
  ) latest_activity on true
)
select
  user_id,
  name,
  avatar_url,
  member_role,
  is_team_leader,
  presence_status,
  last_seen_at,
  idle_since_at
from presence
order by
  case presence_status
    when 'online' then 0
    when 'idle' then 1
    else 2
  end,
  last_seen_at desc nulls last,
  lower(name),
  user_id
`

type rowIterator interface {
	Close()
	Err() error
	Next() bool
	Scan(dest ...any) error
}

type queryer interface {
	Query(ctx context.Context, query string, args ...any) (rowIterator, error)
}

type postgresQueryer struct {
	database *dbpkg.Postgres
}

func (queryer postgresQueryer) Query(ctx context.Context, query string, args ...any) (rowIterator, error) {
	return queryer.database.Pool().Query(ctx, query, args...)
}

type Repository struct {
	queryer queryer
}

func NewRepository(database *dbpkg.Postgres) Repository {
	return Repository{queryer: postgresQueryer{database: database}}
}

func (repo Repository) List(ctx context.Context, scope ListScope, freshSince time.Time) ([]User, error) {
	if scope.RestrictToUserIDs && len(scope.UserIDs) == 0 {
		return []User{}, nil
	}

	userIDs := scope.UserIDs
	if userIDs == nil {
		userIDs = []string{}
	}
	rows, err := repo.queryer.Query(
		ctx,
		listUsersQuery,
		scope.OrganizationID,
		freshSince.UTC(),
		scope.RestrictToUserIDs,
		userIDs,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	users := []User{}
	for rows.Next() {
		var user User
		var avatarURL pgtype.Text
		var status string
		var lastSeenAt pgtype.Timestamptz
		var idleSinceAt pgtype.Timestamptz
		if err := rows.Scan(
			&user.UserID,
			&user.Name,
			&avatarURL,
			&user.MemberRole,
			&user.IsTeamLeader,
			&status,
			&lastSeenAt,
			&idleSinceAt,
		); err != nil {
			return nil, err
		}

		parsedStatus, err := parseStatus(status)
		if err != nil {
			return nil, err
		}
		user.AvatarURL = textPointer(avatarURL)
		user.PresenceStatus = parsedStatus
		user.LastSeenAt = timestampPointer(lastSeenAt)
		user.IdleSinceAt = timestampPointer(idleSinceAt)
		users = append(users, user)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}
	return users, nil
}

func parseStatus(value string) (Status, error) {
	status := Status(value)
	switch status {
	case StatusOnline, StatusIdle, StatusOffline:
		return status, nil
	default:
		return "", fmt.Errorf("unsupported presence status %q", value)
	}
}

func textPointer(value pgtype.Text) *string {
	return pgvalue.TextPointer(value)
}

func timestampPointer(value pgtype.Timestamptz) *string {
	if !value.Valid {
		return nil
	}
	result := value.Time.UTC().Format(time.RFC3339Nano)
	return &result
}
