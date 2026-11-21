package properties

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) ListHistory(ctx context.Context, tenantContext tenant.Context, propertyID string) ([]HistoryEvent, error) {
	propertyID, ok := normalizeUUID(propertyID)
	if !ok {
		return nil, ErrPropertyNotFound
	}

	visibilityArgs := []any{tenantContext.OrganizationID, propertyID}
	visibilityWhere := []string{
		"p.organization_id = $1::uuid",
		"p.id = $2::uuid",
	}
	visibilityArgs, visibilityWhere = addScopedPropertyVisibility(visibilityArgs, visibilityWhere, tenantContext, "p", "")

	rows, err := repo.db.Pool().Query(ctx, `
		with visible_property as materialized (
			select p.*
			from public.properties p
			where `+strings.Join(visibilityWhere, " and ")+`
			limit 1
		),
		property_events as (
			select
				e.id::text as id,
				e.event_type,
				e.payload,
				e.created_at,
				coalesce(e.payload->>'message', e.event_type) as title
			from public.events e
			join visible_property p
			  on p.organization_id = e.organization_id
			 and p.id = e.entity_id
			where e.entity_type = 'property'
		),
		property_created_row as (
			select
				p.id::text || ':created' as id,
				'property_created' as event_type,
				jsonb_build_object(
					'user_id', coalesce(p.created_by::text, p.cadastrado_por::text, p.responsible_user_id::text, ''),
					'title', coalesce(nullif(p.title, ''), nullif(p.tipo_de_imovel, ''), 'Imovel'),
					'property_id', p.id::text,
					'code', coalesce(p.code, ''),
					'organization_id', p.organization_id::text,
					'message', 'Imovel criado',
					'synthetic', true
				) as payload,
				p.created_at,
				'Imovel criado' as title
			from visible_property p
			where not exists (
				select 1
				from public.events e
				where e.organization_id = p.organization_id
				  and e.entity_type = 'property'
				  and e.entity_id = p.id
				  and e.event_type = 'property_created'
			  )
		),
		schedule_rows as (
			select
				se.id::text as id,
				case
					when se.status = 'completed' then 'property_schedule_completed'
					else 'property_schedule'
				end as event_type,
				jsonb_build_object(
					'event_type', se.event_type,
					'status', se.status,
					'start_time', se.start_time,
					'end_time', se.end_time,
					'message', 'Agendamento vinculado ao imovel'
				) as payload,
				se.created_at,
				'Agendamento vinculado ao imovel' as title
			from public.schedule_events se
			join visible_property p
			  on p.organization_id = se.organization_id
			 and p.id = se.property_id
		),
		publication_rows as (
			select
				'publication-job:' || job.id::text as id,
				'property_publication_job' as event_type,
				jsonb_build_object(
					'job_id', job.id::text,
					'channel', job.channel,
					'action', job.action,
					'status', job.status,
					'version', version.version,
					'attempts', job.attempts,
					'max_attempts', job.max_attempts,
					'requested_by', job.requested_by::text,
					'completed_at', job.completed_at
				) as payload,
				job.created_at,
				concat(
					case job.action
						when 'publish' then 'Solicitação de publicação'
						when 'update' then 'Solicitação de atualização'
						when 'unpublish' then 'Solicitação de remoção'
						when 'revalidate' then 'Solicitação de revalidação'
						else 'Solicitação de processamento'
					end,
					' no ', case job.channel when 'site' then 'Site' when 'grupo_olx' then 'Grupo OLX' else 'canal de publicação' end,
					' — ', case job.status
						when 'pending' then 'Na fila'
						when 'processing' then 'Processando'
						when 'retry' then 'Nova tentativa agendada'
						when 'succeeded' then 'Concluída'
						when 'superseded' then 'Substituída'
						when 'dead' then 'Falhou'
						else 'Estado não informado'
					end
				) as title
			from public.property_channel_publication_jobs job
			join visible_property p
			  on p.organization_id = job.organization_id
			 and p.id = job.property_id
			left join public.property_channel_publication_versions version
			  on version.id = job.version_id
			 and version.organization_id = job.organization_id
			 and version.property_id = job.property_id
			 and version.publication_id = job.publication_id
		)
		select id, event_type, title, payload::text, created_at::text
		from (
			select * from property_events
			union all
			select * from property_created_row
			union all
			select * from schedule_rows
			union all
			select * from publication_rows
		) history
		order by created_at desc
		limit 100
	`, visibilityArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	events := []HistoryEvent{}
	for rows.Next() {
		var event HistoryEvent
		var payload string
		if err := rows.Scan(&event.ID, &event.Type, &event.Title, &payload, &event.CreatedAt); err != nil {
			return nil, err
		}
		event.Metadata = map[string]any{}
		_ = json.Unmarshal([]byte(payload), &event.Metadata)
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(events) == 0 {
		return nil, ErrPropertyNotFound
	}
	return events, nil
}
