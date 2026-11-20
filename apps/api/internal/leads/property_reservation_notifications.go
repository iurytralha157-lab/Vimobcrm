package leads

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) notifyInterestedLeadsForReservedProperty(
	ctx context.Context,
	tx pgx.Tx,
	tenantContext tenant.Context,
	current leadSnapshot,
	propertyID string,
	propertyTitle string,
	propertyCode string,
	oldStatus string,
	targetSnapshot string,
) (int64, error) {
	propertyLabel := propertyTitle
	if strings.TrimSpace(propertyLabel) == "" {
		propertyLabel = "Imovel"
	}
	if strings.TrimSpace(propertyCode) != "" {
		propertyLabel = fmt.Sprintf("%s (%s)", propertyLabel, propertyCode)
	}

	targetSource := `
			select
				lead.id,
				lead.name,
				lead.assigned_user_id
			from public.leads lead
			where lead.organization_id = $1::uuid
			  and lead.id <> $2::uuid
			  and lead.assigned_user_id is not null
			  and coalesce(lead.deal_status, 'open') not in ('won', 'lost')
			  and (
			    lead.interest_property_id = $4::uuid
			    or lead.property_id = $4::uuid
			  )
			  and exists (
			    select 1
			    from public.properties property
			    join public.leads reserved_lead
			      on reserved_lead.organization_id = property.organization_id
			     and reserved_lead.id = $2::uuid
			    where property.organization_id = $1::uuid
			      and property.id = $4::uuid
			      and lower(coalesce(property.status, '')) in ('reserved', 'reservado')
			      and coalesce(reserved_lead.deal_status, 'open') = 'won'
			      and (
			        reserved_lead.interest_property_id = property.id
			        or reserved_lead.property_id = property.id
			      )
			  )
	`
	queryArgs := []any{
		tenantContext.OrganizationID,
		current.ID,
		tenantContext.UserID,
		propertyID,
		propertyTitle,
		propertyCode,
		current.Name,
		propertyLabel,
		oldStatus,
	}
	if strings.TrimSpace(targetSnapshot) != "" {
		targetSource = `
			select
				snapshot.lead_id as id,
				coalesce(nullif(snapshot.lead_name, ''), existing_lead.name) as name,
				snapshot.user_id as assigned_user_id
			from jsonb_to_recordset($10::jsonb)
			  as snapshot(lead_id uuid, lead_name text, user_id uuid)
			join public.leads existing_lead
			  on existing_lead.organization_id = $1::uuid
			 and existing_lead.id = snapshot.lead_id
			join public.users existing_user
			  on existing_user.id = snapshot.user_id
		`
		queryArgs = append(queryArgs, targetSnapshot)
	}

	tag, err := tx.Exec(ctx, `
		with targets as materialized (
		`+targetSource+`
		),
		activity_actor as materialized (
			select id
			from public.users
			where id = nullif($3::text, '')::uuid
			limit 1
		),
		payloads as materialized (
			select
				target.id as lead_id,
				target.assigned_user_id,
				format(
					'O imovel de interesse "%s" foi reservado pelo lead "%s". Revise este atendimento.',
					$8::text,
					$7::text
				) as content,
				jsonb_build_object(
					'property_id', $4::text,
					'property_title', nullif($5::text, ''),
					'property_code', nullif($6::text, ''),
					'old_status', $9::text,
					'new_status', 'reserved',
					'reserved_by_lead_id', $2::text,
					'reserved_by_lead_name', $7::text,
					'affected_lead_id', target.id::text,
					'affected_lead_name', target.name,
					'event_key', 'interest_property_reserved',
					'notification_reason', 'same_interest_property_reserved',
					'source', 'deal_won_property_reservation',
					'dedupe_key',
						'interest_property_reserved:' || $2::text || ':' ||
						target.id::text || ':' || target.assigned_user_id::text
				) as metadata
			from targets target
		),
		inserted_activities as (
			insert into public.activities (
				organization_id,
				lead_id,
				user_id,
				type,
				content,
				metadata
			)
			select
				$1::uuid,
				payload.lead_id,
				(select id from activity_actor),
				'property_interest_reserved',
				payload.content,
				payload.metadata
			from payloads payload
			returning id
		)
		insert into public.notifications (
			organization_id,
			user_id,
			title,
			content,
			body,
			type,
			channel,
			lead_id,
			target_url,
			metadata
		)
		select
			$1::uuid,
			payload.assigned_user_id,
			'Imovel de interesse reservado',
			payload.content,
			payload.content,
			'warning',
			'in_app',
			payload.lead_id,
			'/crm/pipelines?lead=' || payload.lead_id::text,
			payload.metadata || jsonb_build_object(
				'dispatch', jsonb_build_object(
					'push', jsonb_build_object(
						'status', 'pending',
						'required', true
					)
				)
			)
		from payloads payload
		on conflict do nothing
	`, queryArgs...)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}
