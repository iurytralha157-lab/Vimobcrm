package homefocus

import (
	"context"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type Store interface {
	List(context.Context, tenant.Context, Filter) ([]Item, error)
	ListNotices(context.Context, tenant.Context) ([]Notice, error)
}

type Repository struct {
	db *dbpkg.Postgres
}

type rowScanner interface {
	Scan(...any) error
}

func NewRepository(db *dbpkg.Postgres) Repository {
	return Repository{db: db}
}

const listFocusSQL = `
	with attention_candidates as (
		select
			'attention:' || i.id::text as item_id,
			'attention'::text as kind,
			case
			  when p.policy_type = 'cadence_task' and nullif(i.metadata->>'lead_task_id', '') is not null
			    then 'cadence_task:' || (i.metadata->>'lead_task_id')
			  else p.policy_type || ':' || i.cycle_key
			end as obligation_key,
			i.organization_id,
			l.id as lead_id,
			l.name as lead_name,
			case p.policy_type
			  when 'first_contact' then 'Primeiro contato com ' || l.name
			  when 'first_effective_contact' then 'Contato efetivo com ' || l.name
			  when 'stage_inactivity' then l.name || ' está sem interação'
			  when 'stage_age' then l.name || ' está há muito tempo na etapa'
			  when 'cadence_task' then coalesce(nullif(i.metadata->>'task_title', ''), p.name)
			  when 'unassigned' then l.name || ' está sem responsável'
			  else p.name
			end as title,
			coalesce(
			  nullif(concat_ws(' · ', pi.name, s.name), ''),
			  p.name
			) as description,
			i.due_at,
			case
			  when i.status in ('breached', 'escalated') or i.due_at <= now() then 'breached'
			  when i.status in ('warning', 'acknowledged') then 'warning'
			  else 'due'
			end as status,
			case
			  when i.status in ('breached', 'escalated') or i.due_at <= now() then 'critical'
			  when i.status in ('warning', 'acknowledged') then 'warning'
			  else 'neutral'
			end as tone,
			p.policy_type,
			case
			  when p.policy_type = 'cadence_task' then nullif(i.metadata->>'task_type', '')
			  else null::text
			end as task_type,
			'/crm/pipelines?lead=' || l.id::text as target_url,
			l.stage_id as stage_id,
			s.name as stage_name,
			i.assigned_user_id,
			0 as source_priority,
			case
			  when i.status in ('breached', 'escalated') or i.due_at <= now() then 0
			  when i.status in ('warning', 'acknowledged') then 1
			  else 2
			end as severity_rank
		from public.lead_attention_instances i
		join public.lead_attention_policies p
		  on p.organization_id = i.organization_id and p.id = i.policy_id
		join public.leads l
		  on l.organization_id = i.organization_id and l.id = i.lead_id
		left join public.pipelines pi
		  on pi.organization_id = i.organization_id and pi.id = l.pipeline_id
		left join public.stages s
		  on s.organization_id = i.organization_id and s.id = l.stage_id
		where i.organization_id = $1::uuid
		  and l.deal_status = 'open'
		  and (
		    (l.attention_eligible = true and l.attention_enrolled_at is not null)
		    or coalesce(p.config->>'source', '') = 'stage_operational_rules'
		  )
		  and i.status in ('monitoring', 'warning', 'breached', 'escalated', 'acknowledged', 'exception')
		  and p.status = 'enabled'
		  and coalesce(i.shadow, true) = false
		  and (i.snoozed_until is null or i.snoozed_until <= now())
		  and (p.pipeline_id is null or p.pipeline_id = l.pipeline_id)
		  and (p.stage_id is null or p.stage_id = l.stage_id)
		  and not exists (
		    select 1
		    from public.lead_attention_policies higher
		    where higher.organization_id = p.organization_id
		      and higher.policy_type = p.policy_type
		      and (
		        higher.status in ('shadow', 'enabled')
		        or (
		          higher.status = 'paused'
		          and coalesce(lower(higher.config->>'disabled_override') = 'true', false)
		        )
		      )
		      and (higher.pipeline_id is null or higher.pipeline_id = l.pipeline_id)
		      and (higher.stage_id is null or higher.stage_id = l.stage_id)
		      and (
		        case
		          when higher.stage_id is not null then 3
		          when higher.pipeline_id is not null then 2
		          else 1
		        end
		      ) > (
		        case
		          when p.stage_id is not null then 3
		          when p.pipeline_id is not null then 2
		          else 1
		        end
		      )
		  )
		  and (
		    i.assignment_cycle_id is null
		    or exists (
		      select 1
		      from public.lead_assignment_cycles ac
		      where ac.organization_id = i.organization_id
		        and ac.id = i.assignment_cycle_id
		        and ac.lead_id = i.lead_id
		        and ac.ended_at is null
		    )
		  )
		  and (
		    i.stage_cycle_id is null
		    or exists (
		      select 1
		      from public.lead_stage_cycles sc
		      where sc.organization_id = i.organization_id
		        and sc.id = i.stage_cycle_id
		        and sc.lead_id = i.lead_id
		        and sc.stage_id = l.stage_id
		        and sc.exited_at is null
		    )
		  )
		  and (
		    p.policy_type <> 'cadence_task'
		    or exists (
		      select 1
		      from public.lead_tasks pending_task
		      join public.cadence_enrollments active_enrollment
		        on active_enrollment.organization_id = pending_task.organization_id
		       and active_enrollment.id = pending_task.cadence_enrollment_id
		       and active_enrollment.status = 'active'
		      join public.lead_stage_cycles active_stage_cycle
		        on active_stage_cycle.organization_id = active_enrollment.organization_id
		       and active_stage_cycle.id = active_enrollment.stage_cycle_id
		       and active_stage_cycle.exited_at is null
		      where pending_task.organization_id = i.organization_id
		        and pending_task.id = case
		          when nullif(i.metadata->>'lead_task_id', '') ~*
		            '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
		            then (i.metadata->>'lead_task_id')::uuid
		          else null
		        end
		        and pending_task.lead_id = i.lead_id
		        and pending_task.status = 'pending'
		        and pending_task.is_done = false
		        and active_stage_cycle.lead_id = i.lead_id
		        and active_stage_cycle.stage_id = l.stage_id
		    )
		  )
	),
	task_candidates as (
		select
			'task:' || lt.id::text as item_id,
			'task'::text as kind,
			case
			  when lt.cadence_enrollment_id is not null then 'cadence_task:' || lt.id::text
			  else 'lead_task:' || lt.id::text
			end as obligation_key,
			lt.organization_id,
			l.id as lead_id,
			l.name as lead_name,
			lt.title,
			coalesce(nullif(btrim(lt.description), ''), 'Lead: ' || l.name) as description,
			coalesce(lt.due_at, lt.due_date::timestamptz) as due_at,
			case
			  when coalesce(lt.due_at, lt.due_date::timestamptz) <= now() then 'breached'
			  else 'due'
			end as status,
			case
			  when coalesce(lt.due_at, lt.due_date::timestamptz) <= now() then 'critical'
			  else 'neutral'
			end as tone,
			case
			  when lt.cadence_enrollment_id is not null then 'cadence_task'::text
			  else null::text
			end as policy_type,
			nullif(lt.type, '') as task_type,
			'/crm/pipelines?lead=' || l.id::text as target_url,
			l.stage_id,
			s.name as stage_name,
			coalesce(lt.assigned_user_id, l.assigned_user_id) as assigned_user_id,
			1 as source_priority,
			case
			  when coalesce(lt.due_at, lt.due_date::timestamptz) <= now() then 0
			  else 2
			end as severity_rank
		from public.lead_tasks lt
		join public.leads l
		  on l.organization_id = lt.organization_id and l.id = lt.lead_id
		join public.stages s
		  on s.organization_id = l.organization_id and s.id = l.stage_id
		join public.lead_stage_cycles current_stage_cycle
		  on current_stage_cycle.organization_id = l.organization_id
		 and current_stage_cycle.lead_id = l.id
		 and current_stage_cycle.stage_id = l.stage_id
		 and current_stage_cycle.exited_at is null
		left join public.cadence_enrollments ce
		  on ce.organization_id = lt.organization_id and ce.id = lt.cadence_enrollment_id
		where lt.organization_id = $1::uuid
		  and l.deal_status = 'open'
		  and lt.status = 'pending'
		  and lt.is_done = false
		  and (lt.due_at is not null or lt.due_date is not null)
		  and (
		    lt.cadence_enrollment_id is null
		    or (
		      ce.status = 'active'
		      and ce.stage_cycle_id = current_stage_cycle.id
		    )
		  )
	),
	all_candidates as (
		select * from attention_candidates
		union all
		select * from task_candidates
	),
	visible_candidates as (
		select candidate.*
		from all_candidates candidate
		where
		  $2::text = 'organization'
		  or ($2::text = 'mine' and candidate.assigned_user_id = $3::uuid)
		  or ($2::text = 'team' and candidate.assigned_user_id = any($4::uuid[]))
	),
	deduplicated as (
		select
			candidate.*,
			row_number() over (
			  partition by candidate.organization_id, candidate.lead_id, candidate.obligation_key
			  order by
			    candidate.source_priority,
			    candidate.severity_rank,
			    candidate.due_at,
			    candidate.item_id
			) as obligation_rank
		from visible_candidates candidate
	)
	select
		item_id,
		kind,
		obligation_key,
		lead_id::text,
		lead_name,
		title,
		description,
		due_at,
		status,
		tone,
		policy_type,
		task_type,
		target_url,
		stage_id::text,
		stage_name
	from deduplicated
	where obligation_rank = 1
	order by severity_rank, due_at, source_priority, item_id
	limit $5
`

func (repo Repository) List(ctx context.Context, tenantContext tenant.Context, filter Filter) ([]Item, error) {
	mode, scopedUserIDs, err := resolveScope(tenantContext, filter.Scope)
	if err != nil {
		return nil, err
	}
	limit := filter.Limit
	if limit < 1 {
		limit = defaultLimit
	}
	if limit > maxLimit {
		limit = maxLimit
	}

	rows, err := repo.db.Pool().Query(
		ctx,
		listFocusSQL,
		tenantContext.OrganizationID,
		mode,
		tenantContext.UserID,
		scopedUserIDs,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]Item, 0, limit)
	for rows.Next() {
		item, err := scanItem(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return deduplicateAndLimit(items, limit), nil
}

func resolveScope(context tenant.Context, requestedScope string) (string, []string, error) {
	scope := strings.ToLower(strings.TrimSpace(requestedScope))
	if scope == "" {
		scope = "mine"
	}
	switch scope {
	case "mine":
		return "mine", []string{context.UserID}, nil
	case "team":
		if canViewOrganizationFocus(context) && len(context.LedUserIDs) == 0 {
			return "organization", []string{}, nil
		}
		if !context.IsTeamLeader || len(context.LedUserIDs) == 0 {
			return "", nil, ErrForbidden
		}
		return "team", uniqueUserIDs(append([]string{context.UserID}, context.LedUserIDs...)), nil
	case "organization", "all":
		if !canViewOrganizationFocus(context) {
			return "", nil, ErrForbidden
		}
		return "organization", []string{}, nil
	default:
		return "", nil, ErrInvalidInput
	}
}

func canViewOrganizationFocus(context tenant.Context) bool {
	return context.IsSuperAdmin ||
		context.HasRole("owner", "admin") ||
		context.HasPermission(permissions.LeadViewAll)
}

func uniqueUserIDs(values []string) []string {
	result := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		key := strings.ToLower(value)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, value)
	}
	return result
}

func scanItem(row rowScanner) (Item, error) {
	var item Item
	var policyType, taskType, stageID, stageName pgtype.Text
	err := row.Scan(
		&item.ID,
		&item.Kind,
		&item.ObligationKey,
		&item.LeadID,
		&item.LeadName,
		&item.Title,
		&item.Description,
		&item.DueAt,
		&item.Status,
		&item.Tone,
		&policyType,
		&taskType,
		&item.TargetURL,
		&stageID,
		&stageName,
	)
	if err != nil {
		return Item{}, err
	}
	item.PolicyType = textPointer(policyType)
	item.TaskType = textPointer(taskType)
	item.StageID = textPointer(stageID)
	item.StageName = textPointer(stageName)
	return item, nil
}

func textPointer(value pgtype.Text) *string {
	if !value.Valid {
		return nil
	}
	copy := value.String
	return &copy
}

func deduplicateAndLimit(items []Item, limit int) []Item {
	if limit < 1 {
		limit = defaultLimit
	}
	if limit > maxLimit {
		limit = maxLimit
	}

	byObligation := make(map[string]Item, len(items))
	for _, item := range items {
		key := item.LeadID + "\x00" + item.ObligationKey
		current, exists := byObligation[key]
		if !exists || preferItem(item, current) {
			byObligation[key] = item
		}
	}

	result := make([]Item, 0, len(byObligation))
	for _, item := range byObligation {
		result = append(result, item)
	}
	sort.Slice(result, func(left, right int) bool {
		leftRank := toneRank(result[left].Tone)
		rightRank := toneRank(result[right].Tone)
		if leftRank != rightRank {
			return leftRank < rightRank
		}
		if !result[left].DueAt.Equal(result[right].DueAt) {
			return result[left].DueAt.Before(result[right].DueAt)
		}
		if result[left].Kind != result[right].Kind {
			return result[left].Kind == "attention"
		}
		return result[left].ID < result[right].ID
	})
	if len(result) > limit {
		result = result[:limit]
	}
	return result
}

func preferItem(candidate, current Item) bool {
	if candidate.Kind != current.Kind {
		return candidate.Kind == "attention"
	}
	candidateRank := toneRank(candidate.Tone)
	currentRank := toneRank(current.Tone)
	if candidateRank != currentRank {
		return candidateRank < currentRank
	}
	if !candidate.DueAt.Equal(current.DueAt) {
		return candidate.DueAt.Before(current.DueAt)
	}
	return candidate.ID < current.ID
}

func toneRank(tone string) int {
	switch strings.ToLower(strings.TrimSpace(tone)) {
	case "critical":
		return 0
	case "warning":
		return 1
	default:
		return 2
	}
}

var _ Store = Repository{}
