package roundrobin

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const (
	defaultHistoryLimit = 50
	maxHistoryLimit     = 100
)

const historyQuery = `
	with queue_creation as (
		select
			creation.created_at as audit_created_at,
			nullif(creation.new_data ->> 'created_at', '') as entity_created_at
		from public.audit_logs creation
		where creation.organization_id = $1::uuid
		  and creation.entity_type = 'distribution_queue'
		  and creation.entity_id = $2::text
		  and creation.action = 'create'
		order by creation.created_at, creation.id
		limit 1
	),
	queue_history as (
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
			case
				when al.entity_type = 'distribution_queue_member' then coalesce(
					al.new_data ->> 'user_id',
					al.old_data ->> 'user_id'
				)
				else null
			end as subject_user_id,
			(
				al.action = 'create'
				and (
					(
						al.entity_type = 'distribution_queue'
						and al.entity_id = $2::text
					)
					or (
						creation.audit_created_at is not null
						and (
							(
								creation.entity_created_at is not null
								and al.new_data ->> 'created_at' = creation.entity_created_at
							)
							or al.created_at = creation.audit_created_at
						)
					)
				)
			) as is_initial_creation_event
		from public.audit_logs al
		left join queue_creation creation on true
		where al.organization_id = $1::uuid
		  and al.entity_id is not null
		  and (
			(
				al.entity_type = 'distribution_queue'
				and al.entity_id = $2::text
			)
			or (
				al.entity_type in ('distribution_queue_rule', 'distribution_queue_member')
				and coalesce(
					al.new_data ->> 'round_robin_id',
					al.old_data ->> 'round_robin_id'
				) = $2::text
			)
		  )
	),
	ordered_history as (
		select
			queue_history.*,
			max(created_at) filter (
				where is_initial_creation_event
			) over () as initial_creation_group_at
		from queue_history
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
			when history.entity_type = 'distribution_queue' then 0
			when history.entity_type = 'distribution_queue_rule' then 1
			when history.entity_type = 'distribution_queue_member' then 2
			else 3
		end,
		case
			when history.is_initial_creation_event
				then history.entity_id
			else null
		end nulls first,
		history.created_at desc,
		history.id desc
	limit $3
`

func parseHistoryLimit(value string) (int, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return defaultHistoryLimit, nil
	}

	limit, err := strconv.Atoi(value)
	if err != nil || limit < 1 || limit > maxHistoryLimit {
		return 0, ErrInvalidInput
	}
	return limit, nil
}

func (repo Repository) ListHistory(
	ctx context.Context,
	tenantContext tenant.Context,
	roundRobinID string,
	limit int,
) ([]HistoryEvent, error) {
	if strings.TrimSpace(tenantContext.OrganizationID) == "" {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	roundRobinID, ok := normalizeUUID(roundRobinID)
	if !ok || limit < 1 || limit > maxHistoryLimit {
		return nil, ErrInvalidInput
	}
	if err := repo.ensureRoundRobinVisible(ctx, repo.db.Pool(), tenantContext, roundRobinID); err != nil {
		return nil, err
	}

	rows, err := repo.db.Pool().Query(
		ctx,
		historyQuery,
		tenantContext.OrganizationID,
		roundRobinID,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	events := make([]HistoryEvent, 0, limit)
	for rows.Next() {
		event, err := scanHistoryEvent(rows)
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

func scanHistoryEvent(row scanner) (HistoryEvent, error) {
	var event HistoryEvent
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
		return HistoryEvent{}, err
	}

	var err error
	if event.OldData, err = decodeHistoryJSON(oldData); err != nil {
		return HistoryEvent{}, err
	}
	if event.NewData, err = decodeHistoryJSON(newData); err != nil {
		return HistoryEvent{}, err
	}
	if event.Diff, err = decodeHistoryJSON(diff); err != nil {
		return HistoryEvent{}, err
	}
	event.User = historyUser(actorID, actorName, actorEmail, actorAvatar)
	event.SubjectUser = historyUser(subjectID, subjectName, subjectEmail, subjectAvatar)
	return event, nil
}

func decodeHistoryJSON(value pgtype.Text) (map[string]any, error) {
	if !value.Valid || strings.TrimSpace(value.String) == "" {
		return nil, nil
	}

	decoded := map[string]any{}
	if err := json.Unmarshal([]byte(value.String), &decoded); err != nil {
		return nil, err
	}
	return decoded, nil
}

func historyUser(
	id pgtype.Text,
	name pgtype.Text,
	email pgtype.Text,
	avatar pgtype.Text,
) *HistoryUser {
	if !id.Valid {
		return nil
	}
	return &HistoryUser{
		ID:        id.String,
		Name:      historyTextPointer(name),
		Email:     historyTextPointer(email),
		AvatarURL: historyTextPointer(avatar),
	}
}

func historyTextPointer(value pgtype.Text) *string {
	if !value.Valid {
		return nil
	}
	result := value.String
	return &result
}
