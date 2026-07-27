package leads

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type FirstResponseFilter struct {
	UserID     string
	PipelineID string
	DateFrom   string
	DateTo     string
	SLASeconds int
}

type RecordFirstResponseRequest struct {
	LeadID         string `json:"lead_id"`
	OrganizationID string `json:"organization_id,omitempty"`
	Channel        string `json:"channel"`
	ActorUserID    string `json:"actor_user_id,omitempty"`
	IsAutomation   bool   `json:"is_automation"`
}

type recordFirstResponseInput struct {
	LeadID       string
	Channel      string
	ActorUserID  string
	IsAutomation bool
}

func ParseFirstResponseFilter(values url.Values) (FirstResponseFilter, error) {
	filter := FirstResponseFilter{
		UserID:     strings.TrimSpace(values.Get("userId")),
		PipelineID: strings.TrimSpace(values.Get("pipelineId")),
		DateFrom:   strings.TrimSpace(values.Get("dateFrom")),
		DateTo:     strings.TrimSpace(values.Get("dateTo")),
		SLASeconds: 600,
	}

	if rawSLA := strings.TrimSpace(values.Get("slaSeconds")); rawSLA != "" {
		value, err := parseBoundedInt(rawSLA, 600, 1, 30*24*60*60)
		if err != nil {
			return FirstResponseFilter{}, err
		}
		filter.SLASeconds = value
	}

	for _, item := range []struct {
		name  string
		value string
	}{
		{name: "userId", value: filter.UserID},
		{name: "pipelineId", value: filter.PipelineID},
	} {
		if item.value != "" && !isUUID(item.value) {
			return FirstResponseFilter{}, fmt.Errorf("%w: %s is invalid", ErrInvalidInput, item.name)
		}
	}

	for _, item := range []struct {
		name  string
		value string
	}{
		{name: "dateFrom", value: filter.DateFrom},
		{name: "dateTo", value: filter.DateTo},
	} {
		if item.value == "" {
			continue
		}
		if !isValidDateFilter(item.value) {
			return FirstResponseFilter{}, fmt.Errorf("%w: %s is invalid", ErrInvalidInput, item.name)
		}
	}

	return filter, nil
}

func (request RecordFirstResponseRequest) Validate(defaultUserID string) (recordFirstResponseInput, error) {
	leadID, ok := normalizeUUID(request.LeadID)
	if !ok {
		return recordFirstResponseInput{}, fmt.Errorf("%w: lead_id is invalid", ErrInvalidInput)
	}

	channel := trimMax(request.Channel, 40)
	if channel == "" {
		channel = "whatsapp"
	}
	if !validEnum(channel, "whatsapp", "phone", "email", "message", "manual") {
		return recordFirstResponseInput{}, fmt.Errorf("%w: channel is invalid", ErrInvalidInput)
	}

	actorUserID := strings.TrimSpace(request.ActorUserID)
	if actorUserID == "" {
		actorUserID = defaultUserID
	}
	if actorUserID != "" {
		value, ok := normalizeUUID(actorUserID)
		if !ok {
			return recordFirstResponseInput{}, fmt.Errorf("%w: actor_user_id is invalid", ErrInvalidInput)
		}
		actorUserID = value
	}

	return recordFirstResponseInput{
		LeadID:       leadID,
		Channel:      channel,
		ActorUserID:  actorUserID,
		IsAutomation: request.IsAutomation,
	}, nil
}

func (repo Repository) ListLeadTimeline(ctx context.Context, tenantContext tenant.Context, leadID string) ([]map[string]any, error) {
	leadID, ok := normalizeUUID(leadID)
	if !ok {
		return nil, ErrInvalidInput
	}

	return repo.queryJSONArray(ctx, `
		select coalesce(jsonb_agg(
			jsonb_strip_nulls(
				to_jsonb(e)
				|| jsonb_build_object(
					'id', e.id::text,
					'organization_id', e.organization_id::text,
					'lead_id', e.lead_id::text,
					'user_id', e.user_id::text,
					'actor_user_id', coalesce(e.actor_user_id::text, e.user_id::text),
					'event_at', e.created_at,
					'channel', null,
					'is_automation', false,
					'actor',
						case when u.id is null then null else jsonb_build_object(
							'id', u.id::text,
							'name', u.name,
							'avatar_url', u.avatar_url
						) end
				)
			)
			order by e.occurred_at asc, e.created_at asc, e.id asc
		), '[]'::jsonb)
		from public.lead_timeline_events e
		join public.leads l on l.id = e.lead_id
		left join public.users u on u.id = coalesce(e.actor_user_id, e.user_id)
		where l.organization_id = $1::uuid
		  and `+leadVisibilitySQL("$2", "$3", "$4", tenantContext.HasPermission(permissions.LeadViewOwn))+`
		  and e.lead_id = $5::uuid
	`, tenantContext.OrganizationID, canViewAllLeads(tenantContext), tenantContext.UserID, tenantContext.HasPermission("lead_view_team"), leadID)
}

func (repo Repository) ListLeadJourney(ctx context.Context, tenantContext tenant.Context, leadID string) ([]map[string]any, error) {
	leadID, ok := normalizeUUID(leadID)
	if !ok {
		return nil, ErrInvalidInput
	}

	return repo.queryJSONArray(ctx, `
		with visible_lead as (
			select l.visitor_session_id
			from public.leads l
			where l.organization_id = $1::uuid
			  and `+leadVisibilitySQL("$2", "$3", "$4", tenantContext.HasPermission(permissions.LeadViewOwn))+`
			  and l.id = $5::uuid
			limit 1
		)
		select coalesce(jsonb_agg(
			jsonb_strip_nulls(jsonb_build_object(
				'id', sae.id::text,
				'event_type', sae.event_type,
				'page_path', sae.page_path,
				'page_title', sae.page_title,
				'property_id', null,
				'created_at', sae.created_at,
				'metadata', null,
				'referrer', sae.referrer,
				'device_type', sae.device_type,
				'browser', sae.browser,
				'utm_source', sae.utm_source,
				'utm_medium', sae.utm_medium,
				'utm_campaign', sae.utm_campaign
			))
			order by sae.created_at asc, sae.id asc
		), '[]'::jsonb)
		from visible_lead vl
		join public.site_analytics_events sae
		  on sae.organization_id = $1::uuid
		 and sae.session_id = vl.visitor_session_id
		where vl.visitor_session_id is not null
	`, tenantContext.OrganizationID, canViewAllLeads(tenantContext), tenantContext.UserID, tenantContext.HasPermission("lead_view_team"), leadID)
}

func (repo Repository) LeadHistoryRaw(ctx context.Context, tenantContext tenant.Context, leadID string) (map[string]any, error) {
	leadID, ok := normalizeUUID(leadID)
	if !ok {
		return nil, ErrInvalidInput
	}
	if err := repo.ensureLeadVisible(ctx, tenantContext, leadID); err != nil {
		return nil, err
	}
	batch := &pgx.Batch{}

	timelineEvents, err := queueHistoryJSONArray(batch, `
		select coalesce(jsonb_agg(
			jsonb_strip_nulls(
				to_jsonb(e)
				|| jsonb_build_object(
					'id', e.id::text,
					'organization_id', e.organization_id::text,
					'lead_id', e.lead_id::text,
					'user_id', e.user_id::text,
					'actor_user_id', e.actor_user_id::text,
					'metadata', coalesce(e.metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
						'from_stage', coalesce(e.metadata->>'from_stage', e.metadata->>'old_stage_name', old_stage.name),
						'to_stage', coalesce(e.metadata->>'to_stage', e.metadata->>'new_stage_name', new_stage.name),
						'old_stage_name', coalesce(e.metadata->>'old_stage_name', e.metadata->>'from_stage', old_stage.name),
						'new_stage_name', coalesce(e.metadata->>'new_stage_name', e.metadata->>'to_stage', new_stage.name)
					))
				)
			)
			order by e.created_at asc, e.id asc
		), '[]'::jsonb)
		from public.lead_timeline_events e
		left join public.stages old_stage
		  on old_stage.organization_id = e.organization_id
		 and old_stage.id::text = coalesce(e.metadata->>'old_stage_id', e.metadata->>'from_stage_id')
		left join public.stages new_stage
		  on new_stage.organization_id = e.organization_id
		 and new_stage.id::text = coalesce(e.metadata->>'new_stage_id', e.metadata->>'to_stage_id')
		where e.organization_id = $1::uuid
		  and e.lead_id = $2::uuid
	`, tenantContext.OrganizationID, leadID)
	if err != nil {
		return nil, err
	}

	activityEvents, err := queueHistoryJSONArray(batch, `
		select coalesce(jsonb_agg(
			jsonb_strip_nulls(
				to_jsonb(a)
				|| jsonb_build_object(
					'id', a.id::text,
					'organization_id', a.organization_id::text,
					'lead_id', a.lead_id::text,
					'user_id', a.user_id::text,
					'user',
						case when u.id is null then null else jsonb_build_object(
							'id', u.id::text,
							'name', u.name,
							'avatar_url', u.avatar_url
						) end,
					'metadata', coalesce(a.metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
						'from_stage', coalesce(a.metadata->>'from_stage', a.metadata->>'old_stage_name', old_stage.name),
						'to_stage', coalesce(a.metadata->>'to_stage', a.metadata->>'new_stage_name', new_stage.name),
						'old_stage_name', coalesce(a.metadata->>'old_stage_name', a.metadata->>'from_stage', old_stage.name),
						'new_stage_name', coalesce(a.metadata->>'new_stage_name', a.metadata->>'to_stage', new_stage.name)
					))
				)
			)
			order by a.created_at asc, a.id asc
		), '[]'::jsonb)
		from public.activities a
		left join public.users u on u.id = a.user_id
		left join public.stages old_stage
		  on old_stage.organization_id = a.organization_id
		 and old_stage.id::text = coalesce(a.metadata->>'old_stage_id', a.metadata->>'from_stage_id')
		left join public.stages new_stage
		  on new_stage.organization_id = a.organization_id
		 and new_stage.id::text = coalesce(a.metadata->>'new_stage_id', a.metadata->>'to_stage_id')
		where a.organization_id = $1::uuid
		  and a.lead_id = $2::uuid
	`, tenantContext.OrganizationID, leadID)
	if err != nil {
		return nil, err
	}

	entryEvents, err := queueHistoryJSONArray(batch, `
		select coalesce(jsonb_agg(
			jsonb_strip_nulls(
				to_jsonb(e)
				|| jsonb_build_object(
					'id', e.id::text,
					'organization_id', e.organization_id::text,
					'lead_id', e.lead_id::text,
					'property_id', e.property_id::text
				)
			)
			order by e.created_at asc, e.id asc
		), '[]'::jsonb)
		from public.lead_entry_events e
		where e.organization_id = $1::uuid
		  and e.lead_id = $2::uuid
	`, tenantContext.OrganizationID, leadID)
	if err != nil {
		return nil, err
	}

	lead, err := queueHistoryJSONObject(batch, `
		select jsonb_strip_nulls(jsonb_build_object(
			'id', l.id::text,
			'source', l.source,
			'utm_source', l.utm_source,
			'assigned_user_id', l.assigned_user_id::text,
			'assigned_at', l.assigned_at,
			'created_at', l.created_at,
			'assigned_user',
				case when u.id is null then null else jsonb_build_object(
					'id', u.id::text,
					'name', u.name,
					'avatar_url', u.avatar_url
				) end
		))
		from public.leads l
		left join public.users u on u.id = l.assigned_user_id
		where l.organization_id = $1::uuid
		  and l.id = $2::uuid
		limit 1
	`, tenantContext.OrganizationID, leadID)
	if err != nil {
		return nil, err
	}

	leadMeta, err := queueHistoryJSONObject(batch, `
		select coalesce((
			select jsonb_strip_nulls(jsonb_build_object(
				'id', lm.id::text,
				'lead_id', lm.lead_id::text,
				'page_id', lm.page_id,
				'form_id', lm.form_id,
				'form_name', lm.form_name,
				'ad_id', lm.ad_id,
				'ad_name', lm.ad_name,
				'adset_id', lm.adset_id,
				'adset_name', lm.adset_name,
				'campaign_id', lm.campaign_id,
				'campaign_name', lm.campaign_name,
				'platform', lm.platform,
				'source_type', lm.source_type,
				'creative_url', lm.creative_url,
				'creative_video_url', lm.creative_video_url,
				'creative_instagram_url', lm.creative_instagram_url,
				'raw_payload', coalesce(lm.raw_payload, lm.payload, '{}'::jsonb),
				'created_at', lm.created_at
			))
			from public.lead_meta lm
			where lm.organization_id = $1::uuid
			  and lm.lead_id = $2::uuid
			order by lm.updated_at desc nulls last, lm.created_at desc nulls last
			limit 1
		), '{}'::jsonb)
	`, tenantContext.OrganizationID, leadID)
	if err != nil {
		return nil, err
	}

	distributionLogs, err := queueHistoryJSONArray(batch, `
		select coalesce(jsonb_agg(
			jsonb_strip_nulls(
				to_jsonb(rrl)
				|| jsonb_build_object(
					'id', rrl.id::text,
					'organization_id', rrl.organization_id::text,
					'lead_id', rrl.lead_id::text,
					'round_robin_id', rrl.round_robin_id::text,
					'assigned_user_id', rrl.assigned_user_id::text,
					'queue',
						case when rr.id is null then null else jsonb_build_object(
							'id', rr.id::text,
							'name', rr.name
						) end,
					'assigned_user',
						case when u.id is null then null else jsonb_build_object(
							'id', u.id::text,
							'name', u.name,
							'avatar_url', u.avatar_url
						) end
				)
			)
			order by rrl.created_at asc, rrl.id asc
		), '[]'::jsonb)
		from public.round_robin_logs rrl
		left join public.round_robins rr on rr.id = rrl.round_robin_id
		left join public.users u on u.id = rrl.assigned_user_id
		where rrl.organization_id = $1::uuid
		  and rrl.lead_id = $2::uuid
	`, tenantContext.OrganizationID, leadID)
	if err != nil {
		return nil, err
	}

	assignmentLogs, err := queueHistoryJSONArray(batch, `
		select coalesce(jsonb_agg(
			jsonb_strip_nulls(jsonb_build_object(
				'id', al.id::text,
				'organization_id', al.organization_id::text,
				'lead_id', al.lead_id::text,
				'old_user_id', al.old_user_id::text,
				'new_user_id', al.new_user_id::text,
				'reason', al.reason,
				'created_by', al.created_by::text,
				'created_at', al.created_at,
				'old_user',
					case when old_user.id is null then null else jsonb_build_object(
						'id', old_user.id::text,
						'name', old_user.name,
						'avatar_url', old_user.avatar_url
					) end,
				'new_user',
					case when new_user.id is null then null else jsonb_build_object(
						'id', new_user.id::text,
						'name', new_user.name,
						'avatar_url', new_user.avatar_url
					) end,
				'actor',
					case when actor.id is null then null else jsonb_build_object(
						'id', actor.id::text,
						'name', actor.name,
						'avatar_url', actor.avatar_url
					) end
			))
			order by al.created_at asc, al.id asc
		), '[]'::jsonb)
		from public.assignments_log al
		left join public.users old_user on old_user.id = al.old_user_id
		left join public.users new_user on new_user.id = al.new_user_id
		left join public.users actor on actor.id = al.created_by
		where al.organization_id = $1::uuid
		  and al.lead_id = $2::uuid
	`, tenantContext.OrganizationID, leadID)
	if err != nil {
		return nil, err
	}

	auditLogs, err := queueHistoryJSONArray(batch, `
		select coalesce(jsonb_agg(
			jsonb_strip_nulls(jsonb_build_object(
				'id', al.id::text,
				'organization_id', al.organization_id::text,
				'user_id', al.user_id::text,
				'action', al.action,
				'entity_type', al.entity_type,
				'entity_id', al.entity_id::text,
				'old_data', (coalesce(al.old_data, '{}'::jsonb) #- '{metadata,profile,cpf}') #- '{metadata,profile,rg}',
				'new_data', (coalesce(al.new_data, '{}'::jsonb) #- '{metadata,profile,cpf}') #- '{metadata,profile,rg}',
				'created_at', al.created_at,
				'actor',
					case when u.id is null then null else jsonb_build_object(
						'id', u.id::text,
						'name', u.name,
						'avatar_url', u.avatar_url
					) end
			))
			order by al.created_at asc, al.id asc
		), '[]'::jsonb)
		from public.audit_logs al
		left join public.users u on u.id = al.user_id
		where al.organization_id = $1::uuid
		  and al.entity_type = 'lead'
		  and al.entity_id::text = $2
	`, tenantContext.OrganizationID, leadID)
	if err != nil {
		return nil, err
	}

	users, err := queueHistoryJSONArray(batch, `
		with user_ids as (
			select e.user_id as id
			from public.lead_timeline_events e
			where e.organization_id = $1::uuid
			  and e.lead_id = $2::uuid
			  and e.user_id is not null
			union
			select e.actor_user_id as id
			from public.lead_timeline_events e
			where e.organization_id = $1::uuid
			  and e.lead_id = $2::uuid
			  and e.actor_user_id is not null
			union
			select a.user_id as id
			from public.activities a
			where a.organization_id = $1::uuid
			  and a.lead_id = $2::uuid
			  and a.user_id is not null
			union
			select rrl.assigned_user_id as id
			from public.round_robin_logs rrl
			where rrl.organization_id = $1::uuid
			  and rrl.lead_id = $2::uuid
			  and rrl.assigned_user_id is not null
			union
			select al.old_user_id as id
			from public.assignments_log al
			where al.organization_id = $1::uuid
			  and al.lead_id = $2::uuid
			  and al.old_user_id is not null
			union
			select al.new_user_id as id
			from public.assignments_log al
			where al.organization_id = $1::uuid
			  and al.lead_id = $2::uuid
			  and al.new_user_id is not null
			union
			select al.created_by as id
			from public.assignments_log al
			where al.organization_id = $1::uuid
			  and al.lead_id = $2::uuid
			  and al.created_by is not null
			union
			select audit.user_id as id
			from public.audit_logs audit
			where audit.organization_id = $1::uuid
			  and audit.entity_type = 'lead'
			  and audit.entity_id::text = $2
			  and audit.user_id is not null
			union
			select l.assigned_user_id as id
			from public.leads l
			where l.organization_id = $1::uuid
			  and l.id = $2::uuid
			  and l.assigned_user_id is not null
		)
		select coalesce(jsonb_agg(jsonb_build_object(
			'id', u.id::text,
			'name', coalesce(nullif(u.name, ''), u.email, 'Usuario'),
			'avatar_url', u.avatar_url
		) order by u.name asc), '[]'::jsonb)
		from public.users u
		join user_ids on user_ids.id = u.id
	`, tenantContext.OrganizationID, leadID)
	if err != nil {
		return nil, err
	}

	results := repo.db.Pool().SendBatch(ctx, batch)
	defer results.Close()

	if timelineEvents, err = scanHistoryJSONArray(results.QueryRow()); err != nil {
		return nil, err
	}
	if activityEvents, err = scanHistoryJSONArray(results.QueryRow()); err != nil {
		return nil, err
	}
	if entryEvents, err = scanHistoryJSONArray(results.QueryRow()); err != nil {
		return nil, err
	}
	if lead, err = scanHistoryJSONObject(results.QueryRow()); err != nil {
		return nil, err
	}
	if leadMeta, err = scanHistoryJSONObject(results.QueryRow()); err != nil {
		return nil, err
	}
	if distributionLogs, err = scanHistoryJSONArray(results.QueryRow()); err != nil {
		return nil, err
	}
	if assignmentLogs, err = scanHistoryJSONArray(results.QueryRow()); err != nil {
		return nil, err
	}
	if auditLogs, err = scanHistoryJSONArray(results.QueryRow()); err != nil {
		return nil, err
	}
	if users, err = scanHistoryJSONArray(results.QueryRow()); err != nil {
		return nil, err
	}
	if err := results.Close(); err != nil {
		return nil, err
	}

	return map[string]any{
		"timelineEvents":   timelineEvents,
		"activityEvents":   activityEvents,
		"entryEvents":      entryEvents,
		"lead":             lead,
		"leadMeta":         leadMeta,
		"distributionLogs": distributionLogs,
		"assignmentLogs":   assignmentLogs,
		"auditLogs":        auditLogs,
		"users":            users,
	}, nil
}

func (repo Repository) FirstResponseMetrics(ctx context.Context, tenantContext tenant.Context, filter FirstResponseFilter) (map[string]any, error) {
	where, args := buildFirstResponseWhere(tenantContext, filter)
	args = append(args, filter.SLASeconds)
	slaPlaceholder := fmt.Sprintf("$%d", len(args))

	result, err := repo.queryJSONObject(ctx, `
		with filtered as (
			select l.first_response_seconds::integer as seconds
			from public.leads l
			where `+strings.Join(where, " and ")+`
		)
		select jsonb_build_object(
			'average', coalesce(round(avg(seconds))::integer, 0),
			'median', coalesce(round(percentile_cont(0.5) within group (order by seconds))::integer, 0),
			'count', count(*)::integer,
			'withinSla', count(*) filter (where seconds <= `+slaPlaceholder+`::integer)::integer,
			'slaPercentage',
				case when count(*) = 0 then 0
				     else round((count(*) filter (where seconds <= `+slaPlaceholder+`::integer))::numeric / count(*)::numeric * 100)::integer
				end
		)
		from filtered
	`, args...)
	if err != nil {
		return nil, err
	}
	return result, nil
}

func (repo Repository) FirstResponseRanking(ctx context.Context, tenantContext tenant.Context, filter FirstResponseFilter) ([]map[string]any, error) {
	filter.UserID = ""
	where, args := buildFirstResponseWhere(tenantContext, filter)
	where = append(where, "l.first_response_actor_user_id is not null")
	args = append(args, filter.SLASeconds)
	slaPlaceholder := fmt.Sprintf("$%d", len(args))

	return repo.queryJSONArray(ctx, `
		with grouped as (
			select
				l.first_response_actor_user_id,
				coalesce(nullif(u.name, ''), u.email, 'Desconhecido') as user_name,
				u.avatar_url,
				round(avg(l.first_response_seconds))::integer as average,
				round(percentile_cont(0.5) within group (order by l.first_response_seconds))::integer as median,
				count(*)::integer as count,
				round((count(*) filter (where l.first_response_seconds <= `+slaPlaceholder+`::integer))::numeric / count(*)::numeric * 100)::integer as sla_percentage
			from public.leads l
			left join public.users u on u.id = l.first_response_actor_user_id
			where `+strings.Join(where, " and ")+`
			group by l.first_response_actor_user_id, u.name, u.email, u.avatar_url
			order by average asc, count desc
		)
		select coalesce(jsonb_agg(jsonb_build_object(
			'userId', first_response_actor_user_id::text,
			'userName', user_name,
			'userAvatar', avatar_url,
			'average', average,
			'median', median,
			'count', count,
			'slaPercentage', sla_percentage
		)), '[]'::jsonb)
		from grouped
	`, args...)
}

func (repo Repository) RecordFirstResponse(ctx context.Context, tenantContext tenant.Context, input recordFirstResponseInput) (map[string]any, error) {
	if err := repo.ensureLeadEditable(ctx, tenantContext, input.LeadID); err != nil {
		return nil, err
	}
	if input.IsAutomation {
		return map[string]any{
			"recorded": false,
			"skipped":  true,
			"reason":   "automated_actions_do_not_count",
		}, nil
	}

	var responseBaselineAt time.Time
	var firstResponseAt pgtype.Timestamptz
	err := repo.db.Pool().QueryRow(ctx, `
		select
			coalesce(
				(
					select lac.assigned_at
					from public.lead_assignment_cycles lac
					where lac.lead_id = l.id and lac.ended_at is null
					order by lac.cycle_number desc
					limit 1
				),
				l.assigned_at,
				l.created_at
			),
			l.first_response_at
		from public.leads l
		where l.organization_id = $1::uuid
		  and l.id = $2::uuid
	`, tenantContext.OrganizationID, input.LeadID).Scan(&responseBaselineAt, &firstResponseAt)
	if err == pgx.ErrNoRows {
		return nil, ErrLeadNotFound
	}
	if err != nil {
		return nil, err
	}

	if firstResponseAt.Valid {
		return map[string]any{
			"recorded": false,
			"skipped":  true,
		}, nil
	}

	responseSeconds := int(time.Since(responseBaselineAt).Seconds())
	if responseSeconds < 0 {
		responseSeconds = 0
	}

	actorUserID := input.ActorUserID
	if actorUserID == "" {
		actorUserID = tenantContext.UserID
	}

	_, err = repo.db.Pool().Exec(ctx, `
		update public.leads
		set first_response_at = now(),
		    first_response_seconds = $3,
		    first_response_channel = $4,
		    first_response_is_automation = $5,
		    first_response_actor_user_id = nullif($6, '')::uuid,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and first_response_at is null
	`, tenantContext.OrganizationID, input.LeadID, responseSeconds, input.Channel, input.IsAutomation, actorUserID)
	if err != nil {
		return nil, err
	}

	_, _ = repo.db.Pool().Exec(ctx, `
		insert into public.lead_timeline_events (
			organization_id,
			lead_id,
			actor_user_id,
			user_id,
			event_type,
			title,
			description,
			metadata
		)
		values (
			$1::uuid,
			$2::uuid,
			nullif($3, '')::uuid,
			nullif($3, '')::uuid,
			'first_response',
			'Primeiro contato',
			'Primeiro contato registrado',
			$4::jsonb
		)
	`, tenantContext.OrganizationID, input.LeadID, actorUserID, jsonb(map[string]any{
		"channel":          input.Channel,
		"response_seconds": responseSeconds,
		"is_automation":    input.IsAutomation,
	}))

	return map[string]any{
		"recorded":              true,
		"lead_id":               input.LeadID,
		"channel":               input.Channel,
		"actor_user_id":         actorUserID,
		"is_automation":         input.IsAutomation,
		"response_seconds":      responseSeconds,
		"first_response_at":     time.Now().UTC().Format(time.RFC3339Nano),
		"first_response_at_utc": time.Now().UTC().Format(time.RFC3339Nano),
	}, nil
}

func buildFirstResponseWhere(tenantContext tenant.Context, filter FirstResponseFilter) ([]string, []any) {
	args := []any{
		tenantContext.OrganizationID,
		canViewAllLeads(tenantContext),
		tenantContext.UserID,
		tenantContext.HasPermission("lead_view_team"),
	}
	where := []string{
		"l.organization_id = $1::uuid",
		leadVisibilitySQL("$2", "$3", "$4", tenantContext.HasPermission(permissions.LeadViewOwn)),
		"l.first_response_seconds is not null",
	}

	add := func(clause string, value any) {
		args = append(args, value)
		where = append(where, fmt.Sprintf(clause, len(args)))
	}

	if filter.UserID != "" {
		add("l.first_response_actor_user_id = $%d::uuid", filter.UserID)
	}
	if filter.PipelineID != "" {
		add("l.pipeline_id = $%d::uuid", filter.PipelineID)
	}
	if filter.DateFrom != "" {
		add("l.first_response_at >= $%d::timestamptz", filter.DateFrom)
	}
	if filter.DateTo != "" {
		add("l.first_response_at <= $%d::timestamptz", filter.DateTo)
	}

	return where, args
}

func (repo Repository) queryJSONArray(ctx context.Context, sql string, args ...any) ([]map[string]any, error) {
	var raw []byte
	if err := repo.db.Pool().QueryRow(ctx, sql, args...).Scan(&raw); err != nil {
		return nil, err
	}
	if len(raw) == 0 || string(raw) == "null" {
		return []map[string]any{}, nil
	}

	var out []map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	if out == nil {
		return []map[string]any{}, nil
	}
	return out, nil
}

func queueHistoryJSONArray(batch *pgx.Batch, sql string, args ...any) ([]map[string]any, error) {
	batch.Queue(sql, args...)
	return nil, nil
}

func queueHistoryJSONObject(batch *pgx.Batch, sql string, args ...any) (map[string]any, error) {
	batch.Queue(sql, args...)
	return nil, nil
}

func scanHistoryJSONArray(row pgx.Row) ([]map[string]any, error) {
	var raw []byte
	if err := row.Scan(&raw); err != nil {
		return nil, err
	}
	if len(raw) == 0 || string(raw) == "null" {
		return []map[string]any{}, nil
	}

	var out []map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func scanHistoryJSONObject(row pgx.Row) (map[string]any, error) {
	var raw []byte
	if err := row.Scan(&raw); err != nil {
		return nil, err
	}
	if len(raw) == 0 || string(raw) == "null" {
		return map[string]any{}, nil
	}

	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func (repo Repository) queryJSONObject(ctx context.Context, sql string, args ...any) (map[string]any, error) {
	var raw []byte
	if err := repo.db.Pool().QueryRow(ctx, sql, args...).Scan(&raw); err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrLeadNotFound
		}
		return nil, err
	}
	if len(raw) == 0 || string(raw) == "null" {
		return map[string]any{}, nil
	}

	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	if out == nil {
		return map[string]any{}, nil
	}
	return out, nil
}

func isValidDateFilter(value string) bool {
	if _, err := time.Parse(time.RFC3339, value); err == nil {
		return true
	}
	if _, err := time.Parse("2006-01-02", value); err == nil {
		return true
	}
	return false
}
