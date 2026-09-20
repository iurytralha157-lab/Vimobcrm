package distribution

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
)

var ErrInvalidIntakeRouting = errors.New("invalid intake routing")

// IntakeContext contains only values that are already known before a lead is
// inserted. ResolveIntakeDestination deliberately mirrors
// public.pick_round_robin_for_lead so intake identity and later distribution
// cannot classify the same provider event into different queues.
type IntakeContext struct {
	OrganizationID       string
	PipelineID           *string
	Source               string
	PropertyID           *string
	InterestPropertyID   *string
	TagIDs               []string
	FormID               *string
	SourceWebhookID      *string
	SourceSessionID      *string
	City                 *string
	WebsiteCategory      *string
	UTMCampaign          *string
	LeadMetaCampaignName *string
	MetaCampaignID       *string
}

type IntakeDestination struct {
	RoundRobinID    *string
	ReentryBehavior string
	// TagIDs is the tenant-validated, row-locked tag snapshot used by routing.
	// Callers that persist lead_tags must use this exact slice rather than the
	// raw input so the stored lead and the frozen routing decision cannot drift.
	TagIDs []string
	// Resolved is true even when RoundRobinID is nil. Callers must propagate it
	// to Request.RoundRobinResolved so a deliberate no-queue decision cannot be
	// reinterpreted as legacy auto-routing by private.distribute_lead.
	Resolved bool
}

const resolveIntakeQueueIDSQL = `
	with intake_input as (
		select
		  $1::uuid as organization_id,
		  nullif(btrim($2), '')::uuid as pipeline_id,
		  lower(coalesce($3, '')) as source,
		  nullif(btrim($4), '')::uuid as property_id,
		  nullif(btrim($5), '')::uuid as interest_property_id,
		  coalesce($6::uuid[], array[]::uuid[]) as requested_tag_ids,
		  lower(coalesce($7, '')) as form_id,
		  nullif(btrim($8), '')::uuid as source_webhook_id,
		  lower(coalesce($9, '')) as source_session_id,
		  lower(coalesce($10, '')) as city,
		  lower(coalesce($11, '')) as website_category,
		  lower(nullif(btrim($12), '')) as utm_campaign,
		  lower(nullif(btrim($13), '')) as lead_meta_campaign_name,
		  lower(nullif(btrim($14), '')) as meta_campaign_id
	), locked_tags as materialized (
		select tag.id
		from intake_input as input
		join public.tags as tag
		  on tag.organization_id = input.organization_id
		 and tag.id = any(input.requested_tag_ids)
		order by tag.id
		for key share of tag
	), lead_context as (
		select
		  input.organization_id,
		  input.pipeline_id,
		  input.source,
		  input.property_id,
		  input.interest_property_id,
		  array(
			select locked_tag.id
			from locked_tags as locked_tag
			order by locked_tag.id
		  ) as tag_ids,
		  input.form_id,
		  input.source_webhook_id,
		  input.source_session_id,
		  input.city,
		  input.website_category,
		  input.utm_campaign,
		  input.lead_meta_campaign_name,
		  input.meta_campaign_id
		from intake_input as input
	), matched_queue as (
		select queue.id
		from lead_context as lead
		join public.round_robins as queue
		  on queue.organization_id = lead.organization_id
		 and coalesce(queue.is_active, true) = true
		 and (queue.pipeline_id is null or queue.pipeline_id = lead.pipeline_id)
		cross join lateral (
			select exists (
				select 1
				from public.round_robin_rules as rule
				where rule.organization_id = queue.organization_id
				  and rule.round_robin_id = queue.id
				  and coalesce(rule.is_active, true) = true
			) as has_rules
		) as rule_state
		left join lateral (
			select max(coalesce(rule.priority, 0)) as matched_priority
			from public.round_robin_rules as rule
			cross join lateral (
				select
				  lower(coalesce(nullif(rule.match_type, ''), rule.conditions->>'match_type', rule.name, '')) as match_type,
				  coalesce(nullif(rule.match_value, ''), rule.conditions->>'match_value', '') as match_value
			) as normalized
			cross join lateral (
				select array(
					select lower(btrim(value))
					from unnest(string_to_array(coalesce(normalized.match_value, ''), ',')) as value
					where btrim(value) <> ''
				) as values
			) as match_values
			where rule.organization_id = queue.organization_id
			  and rule.round_robin_id = queue.id
			  and coalesce(rule.is_active, true) = true
			  and (
				normalized.match_type in ('all', 'any')
				or (
				  normalized.match_type = 'source'
				  and lead.source = any(match_values.values)
				)
				or (
				  normalized.match_type in ('property', 'interest_property')
				  and exists (
					select 1
					from unnest(match_values.values) as value
					where private.safe_uuid(value) = coalesce(lead.interest_property_id, lead.property_id)
				  )
				)
				or (
				  normalized.match_type = 'tag'
				  and exists (
					select 1
					from unnest(match_values.values) as value
					where private.safe_uuid(value) = any(lead.tag_ids)
				  )
				)
				or (
				  normalized.match_type in ('meta_form', 'form')
				  and lead.form_id = any(match_values.values)
				)
				or (
				  normalized.match_type = 'webhook'
				  and exists (
					select 1
					from unnest(match_values.values) as value
					where private.safe_uuid(value) = lead.source_webhook_id
				  )
				)
				or (
				  normalized.match_type = 'whatsapp_session'
				  and lead.source_session_id = any(match_values.values)
				)
				or (
				  normalized.match_type = 'city'
				  and lead.city = any(match_values.values)
				)
				or (
				  normalized.match_type = 'website_category'
				  and lead.website_category = any(match_values.values)
				)
				or (
				  normalized.match_type = 'campaign_contains'
				  and exists (
					select 1
					from unnest(match_values.values) as value
					where coalesce(lead.utm_campaign, lead.lead_meta_campaign_name, lead.meta_campaign_id, '') like '%' || value || '%'
				  )
				)
			  )
		) as matched_rule on true
		where matched_rule.matched_priority is not null
		   or not rule_state.has_rules
		order by
		  (matched_rule.matched_priority is null) asc,
		  (queue.pipeline_id is null) asc,
		  matched_rule.matched_priority desc nulls last,
		  queue.created_at asc,
		  queue.id asc
		limit 1
	), pipeline_state as (
		select pipeline.default_round_robin_id
		from lead_context as lead
		join public.pipelines as pipeline
		  on pipeline.id = lead.pipeline_id
		 and pipeline.organization_id = lead.organization_id
		 and coalesce(pipeline.is_active, true) = true
	), resolved_queue as (
		select matched_queue.id
		from matched_queue
		union all
		select pipeline_state.default_round_robin_id
		from pipeline_state
		where pipeline_state.default_round_robin_id is not null
		  and not exists (select 1 from matched_queue)
	)
	select
	  coalesce((select id::text from resolved_queue limit 1), ''),
	  case
		when (select pipeline_id from lead_context) is null then true
		else exists (select 1 from pipeline_state)
	  end,
	  array(
		select locked_tag.id::text
		from locked_tags as locked_tag
		order by locked_tag.id
	  )::text[]
`

const lockResolvedIntakeQueueSQL = `
	select
	  queue.id::text,
	  case
		when lower(btrim(coalesce(
		  nullif(queue.reentry_behavior, ''),
		  nullif(queue.rules->>'reentry_behavior', ''),
		  'redistribute'
		))) = 'keep_assignee' then 'keep_assignee'
		else 'redistribute'
	  end
	from public.round_robins as queue
	where queue.organization_id = $1::uuid
	  and queue.id = $2::uuid
	  and coalesce(queue.is_active, true) = true
	for share
`

func ResolveIntakeDestination(ctx context.Context, queryer Queryer, input IntakeContext) (IntakeDestination, error) {
	if queryer == nil || strings.TrimSpace(input.OrganizationID) == "" || strings.TrimSpace(input.Source) == "" {
		return IntakeDestination{}, ErrInvalidRequest
	}

	tagIDs := make([]string, 0, len(input.TagIDs))
	for _, tagID := range input.TagIDs {
		if tagID = strings.TrimSpace(tagID); tagID != "" {
			tagIDs = append(tagIDs, tagID)
		}
	}

	resolverArguments := []any{
		strings.TrimSpace(input.OrganizationID),
		nullableText(input.PipelineID),
		strings.TrimSpace(input.Source),
		nullableText(input.PropertyID),
		nullableText(input.InterestPropertyID),
		tagIDs,
		nullableText(input.FormID),
		nullableText(input.SourceWebhookID),
		nullableText(input.SourceSessionID),
		nullableText(input.City),
		nullableText(input.WebsiteCategory),
		nullableText(input.UTMCampaign),
		nullableText(input.LeadMetaCampaignName),
		nullableText(input.MetaCampaignID),
	}
	var selectedQueueID string
	var pipelineValid bool
	var resolvedTagIDs []string
	err := queryer.QueryRow(ctx, resolveIntakeQueueIDSQL, resolverArguments...).Scan(&selectedQueueID, &pipelineValid, &resolvedTagIDs)
	if err != nil {
		return IntakeDestination{}, fmt.Errorf("resolve intake queue: %w", err)
	}
	if !pipelineValid {
		return IntakeDestination{}, fmt.Errorf("%w: pipeline is inactive or outside the organization", ErrInvalidIntakeRouting)
	}
	selectedQueueID = strings.TrimSpace(selectedQueueID)
	if selectedQueueID == "" {
		return IntakeDestination{Resolved: true, TagIDs: resolvedTagIDs}, nil
	}

	var lockedQueueID string
	var reentryBehavior string
	err = queryer.QueryRow(
		ctx,
		lockResolvedIntakeQueueSQL,
		strings.TrimSpace(input.OrganizationID),
		selectedQueueID,
	).Scan(&lockedQueueID, &reentryBehavior)
	if errors.Is(err, pgx.ErrNoRows) {
		return IntakeDestination{}, fmt.Errorf("%w: selected queue is inactive or outside the organization", ErrInvalidIntakeRouting)
	}
	if err != nil {
		return IntakeDestination{}, fmt.Errorf("lock intake queue: %w", err)
	}
	if !strings.EqualFold(strings.TrimSpace(lockedQueueID), selectedQueueID) {
		return IntakeDestination{}, fmt.Errorf("%w: selected queue changed while resolving intake", ErrInvalidIntakeRouting)
	}

	// The first statement chooses a deterministic queue and the second locks
	// that queue. Re-run the exact resolver while the row is protected so an
	// admin update that committed in the small interval between those statements
	// cannot combine an old rule match with new queue settings.
	var confirmedQueueID string
	var confirmedPipelineValid bool
	var confirmedTagIDs []string
	err = queryer.QueryRow(ctx, resolveIntakeQueueIDSQL, resolverArguments...).Scan(&confirmedQueueID, &confirmedPipelineValid, &confirmedTagIDs)
	if err != nil {
		return IntakeDestination{}, fmt.Errorf("confirm intake queue: %w", err)
	}
	if !confirmedPipelineValid ||
		!strings.EqualFold(strings.TrimSpace(confirmedQueueID), selectedQueueID) ||
		!sameIntakeStringSlice(confirmedTagIDs, resolvedTagIDs) {
		return IntakeDestination{}, fmt.Errorf("%w: queue routing changed while resolving intake", ErrInvalidIntakeRouting)
	}

	lockedQueueID = strings.ToLower(strings.TrimSpace(lockedQueueID))
	return IntakeDestination{
		RoundRobinID:    &lockedQueueID,
		ReentryBehavior: normalizeReentryBehavior(reentryBehavior),
		TagIDs:          resolvedTagIDs,
		Resolved:        true,
	}, nil
}

func IntakeScopeKey(roundRobinID *string) string {
	if roundRobinID == nil || strings.TrimSpace(*roundRobinID) == "" {
		return "unscoped"
	}
	return "queue:" + strings.ToLower(strings.TrimSpace(*roundRobinID))
}

func PreserveAssigneeForIntake(reentry bool, destination IntakeDestination) bool {
	return !reentry || destination.RoundRobinID == nil || normalizeReentryBehavior(destination.ReentryBehavior) != "redistribute"
}

func normalizeReentryBehavior(value string) string {
	if strings.EqualFold(strings.TrimSpace(value), "keep_assignee") {
		return "keep_assignee"
	}
	return "redistribute"
}

func sameIntakeStringSlice(first []string, second []string) bool {
	if len(first) != len(second) {
		return false
	}
	for index := range first {
		if !strings.EqualFold(strings.TrimSpace(first[index]), strings.TrimSpace(second[index])) {
			return false
		}
	}
	return true
}
