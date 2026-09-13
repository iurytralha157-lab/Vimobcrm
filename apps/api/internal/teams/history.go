package teams

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const (
	defaultTeamHistoryLimit = 50
	maxTeamHistoryLimit     = 100
)

const teamHistoryQuery = `
	with team_creation as (
		select
			creation.created_at as audit_created_at,
			nullif(creation.new_data ->> 'created_at', '') as entity_created_at
		from public.audit_logs creation
		where creation.organization_id = $1::uuid
		  and creation.entity_type = 'team'
		  and creation.entity_id = $2::text
		  and creation.action = 'create'
		order by creation.created_at, creation.id
		limit 1
	),
	related_team_members as (
		select
			tm.id::text as team_member_id,
			tm.user_id::text as subject_user_id
		from public.team_members tm
		where tm.organization_id = $1::uuid
		  and tm.team_id = $2::uuid

		union

		select
			member_audit.entity_id as team_member_id,
			coalesce(
				member_audit.new_data ->> 'user_id',
				member_audit.old_data ->> 'user_id'
			) as subject_user_id
		from public.audit_logs member_audit
		where member_audit.organization_id = $1::uuid
		  and member_audit.entity_type = 'team_member'
		  and member_audit.entity_id is not null
		  and coalesce(
			member_audit.new_data ->> 'user_id',
			member_audit.old_data ->> 'user_id'
		  ) is not null
		  and coalesce(
			member_audit.new_data ->> 'team_id',
			member_audit.old_data ->> 'team_id'
		  ) = $2::text
	),
	team_history as (
		select
			al.id,
			al.user_id,
			al.action,
			al.entity_type,
			al.entity_id,
			al.old_data,
			al.new_data,
			al.diff,
			al.created_at,
			related_member.subject_user_id,
			(
				al.action = 'create'
				and (
					(
						al.entity_type = 'team'
						and al.entity_id = $2::text
					)
					or (
						creation.entity_created_at is not null
						and al.new_data ->> 'created_at' = creation.entity_created_at
					)
				)
			) as is_initial_creation_event
		from public.audit_logs al
		left join related_team_members related_member
		  on related_member.team_member_id = case
			when al.entity_type = 'team_member' then al.entity_id
			when al.entity_type = 'team_member_availability' then coalesce(
				al.new_data ->> 'team_member_id',
				al.old_data ->> 'team_member_id'
			)
			else null
		  end
		left join team_creation creation on true
		where al.organization_id = $1::uuid
		  and al.entity_id is not null
		  and (
			(
				al.entity_type = 'team'
				and al.entity_id = $2::text
			)
			or (
				al.entity_type in ('team_member', 'team_pipeline')
				and coalesce(
					al.new_data ->> 'team_id',
					al.old_data ->> 'team_id'
				) = $2::text
			)
			or (
				al.entity_type = 'team_member_availability'
				and related_member.team_member_id is not null
			)
		  )
	),
	ranked_history as (
		select
			team_history.*,
			row_number() over (
				partition by
					case
						when team_history.entity_type = 'team_member_availability'
							then team_history.entity_type
						else team_history.id::text
					end,
					case
						when team_history.entity_type = 'team_member_availability'
							then coalesce(
								team_history.new_data ->> 'team_member_id',
								team_history.old_data ->> 'team_member_id'
							)
						else null
					end,
					case
						when team_history.entity_type = 'team_member_availability'
							then team_history.user_id
						else null
					end,
					case
						when team_history.entity_type = 'team_member_availability'
							then coalesce(
								team_history.new_data ->> 'updated_at',
								team_history.new_data ->> 'created_at',
								team_history.old_data ->> 'updated_at',
								team_history.old_data ->> 'created_at',
								team_history.created_at::text
							)
						else null
					end
				order by team_history.id
			) as availability_event_rank
		from team_history
	),
	visible_history as (
		select *
		from ranked_history
		where entity_type <> 'team_member_availability'
		   or availability_event_rank = 1
	),
	ordered_history as (
		select
			visible_history.*,
			max(created_at) filter (
				where is_initial_creation_event
			) over () as initial_creation_group_at
		from visible_history
	)
	select
		history.id::text,
		history.action,
		history.entity_type,
		history.entity_id,
		history.old_data::text,
		history.new_data::text,
		history.diff::text,
		history.created_at,
		actor.id::text,
		actor.name,
		actor.email,
		actor.avatar_url,
		subject.id::text,
		subject.name,
		subject.email,
		subject.avatar_url
	from ordered_history history
	left join public.users actor on actor.id = history.user_id
	left join public.users subject on subject.id::text = history.subject_user_id
	order by
		case
			when history.is_initial_creation_event
				then history.initial_creation_group_at
			else history.created_at
		end desc,
		case
			when not history.is_initial_creation_event then 0
			when history.entity_type = 'team' then 0
			when history.entity_type = 'team_member' then 1
			when history.entity_type = 'team_member_availability' then 2
			else 3
		end,
		case
			when history.is_initial_creation_event
				then history.subject_user_id
			else null
		end nulls first,
		history.created_at desc,
		history.id desc
	limit $3
`

func parseTeamHistoryLimit(value string) (int, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return defaultTeamHistoryLimit, nil
	}

	limit, err := strconv.Atoi(value)
	if err != nil || limit < 1 || limit > maxTeamHistoryLimit {
		return 0, ErrInvalidInput
	}
	return limit, nil
}

func (repo Repository) ListHistory(
	ctx context.Context,
	tenantContext tenant.Context,
	teamID string,
	limit int,
) ([]TeamHistoryEvent, error) {
	teamID, ok := normalizeUUID(teamID)
	if !ok || limit < 1 || limit > maxTeamHistoryLimit {
		return nil, ErrInvalidInput
	}
	if !canViewTeam(tenantContext, teamID) {
		return nil, tenant.ErrOrganizationAccessDenied
	}

	var teamExists bool
	if err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from public.teams
			where organization_id = $1::uuid
			  and id = $2::uuid
		)
	`, tenantContext.OrganizationID, teamID).Scan(&teamExists); err != nil {
		return nil, err
	}
	if !teamExists {
		return nil, ErrTeamNotFound
	}

	rows, err := repo.db.Pool().Query(
		ctx,
		teamHistoryQuery,
		tenantContext.OrganizationID,
		teamID,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	events := make([]TeamHistoryEvent, 0, limit)
	for rows.Next() {
		event, err := scanTeamHistoryEvent(rows)
		if err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return events, nil
}

func scanTeamHistoryEvent(row teamScanner) (TeamHistoryEvent, error) {
	var event TeamHistoryEvent
	var oldData, newData, diff pgtype.Text
	var actorID, actorName, actorEmail, actorAvatar pgtype.Text
	var subjectID, subjectName, subjectEmail, subjectAvatar pgtype.Text

	if err := row.Scan(
		&event.ID,
		&event.Action,
		&event.EntityType,
		&event.EntityID,
		&oldData,
		&newData,
		&diff,
		&event.CreatedAt,
		&actorID,
		&actorName,
		&actorEmail,
		&actorAvatar,
		&subjectID,
		&subjectName,
		&subjectEmail,
		&subjectAvatar,
	); err != nil {
		return TeamHistoryEvent{}, err
	}

	var err error
	if event.OldData, err = decodeTeamHistoryJSON(oldData); err != nil {
		return TeamHistoryEvent{}, err
	}
	if event.NewData, err = decodeTeamHistoryJSON(newData); err != nil {
		return TeamHistoryEvent{}, err
	}
	if event.Diff, err = decodeTeamHistoryJSON(diff); err != nil {
		return TeamHistoryEvent{}, err
	}
	event.User = teamHistoryUser(actorID, actorName, actorEmail, actorAvatar)
	event.SubjectUser = teamHistoryUser(subjectID, subjectName, subjectEmail, subjectAvatar)
	return event, nil
}

func decodeTeamHistoryJSON(value pgtype.Text) (map[string]any, error) {
	if !value.Valid || strings.TrimSpace(value.String) == "" {
		return nil, nil
	}

	decoded := map[string]any{}
	if err := json.Unmarshal([]byte(value.String), &decoded); err != nil {
		return nil, err
	}
	return decoded, nil
}

func teamHistoryUser(
	id pgtype.Text,
	name pgtype.Text,
	email pgtype.Text,
	avatar pgtype.Text,
) *TeamUser {
	if !id.Valid {
		return nil
	}
	return &TeamUser{
		ID:        id.String,
		Name:      textPointer(name),
		Email:     textPointer(email),
		AvatarURL: textPointer(avatar),
	}
}
