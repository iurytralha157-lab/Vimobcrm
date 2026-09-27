package leads

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// GetDashboardFirstContact summarizes the same creation-date lead cohort used by
// dashboard stats. The first human response belongs to its actor, while a lead's
// current assignee is reported separately so transfers do not rewrite history.
func (repo Repository) GetDashboardFirstContact(ctx context.Context, tenantContext tenant.Context, filter DashboardFilter) (DashboardFirstContact, error) {
	result := DashboardFirstContact{
		Brokers: []DashboardFirstContactBroker{},
		Sources: []DashboardFirstContactSource{},
	}
	if !canViewDashboardLeadDistribution(tenantContext) {
		return result, tenant.ErrOrganizationAccessDenied
	}
	where, args, selectedUserID, err := repo.buildDashboardFirstContactWhere(tenantContext, filter)
	if err != nil {
		return DashboardFirstContact{}, err
	}
	actorScoped, allowedActorIDs := dashboardFirstContactActorScope(tenantContext)
	queryArgs := append(append([]any{}, args...), selectedUserID, actorScoped, allowedActorIDs, dashboardFirstContactSelectedTeamID(filter))

	tx, err := repo.db.Pool().BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return DashboardFirstContact{}, err
	}
	defer tx.Rollback(ctx)

	brokerIndex := map[string]int{}
	sourceIndex := map[string]int{}
	rows, err := tx.Query(ctx, dashboardFirstContactMetricsSQL(where, len(args)), queryArgs...)
	if err != nil {
		return DashboardFirstContact{}, err
	}
	for rows.Next() {
		var dimension, id, name string
		var avatar pgtype.Text
		var leadCount, receivedLeads, handledLeads, contactedLeads int64
		var average pgtype.Float8
		if err := rows.Scan(&dimension, &id, &name, &avatar, &leadCount, &receivedLeads, &handledLeads, &contactedLeads, &average); err != nil {
			rows.Close()
			return DashboardFirstContact{}, err
		}
		switch dimension {
		case "total":
			result.LeadCount = leadCount
			result.ContactedLeads = contactedLeads
			result.AverageResponseSeconds = dashboardNullableAverage(average)
		case "broker":
			brokerIndex[id] = len(result.Brokers)
			result.Brokers = append(result.Brokers, DashboardFirstContactBroker{
				ID: id, Name: name, AvatarURL: pipelineTextPtr(avatar),
				LeadCount: leadCount, ReceivedLeads: receivedLeads, HandledLeads: handledLeads, ContactedLeads: contactedLeads,
				AverageResponseSeconds: dashboardNullableAverage(average),
			})
		case "source":
			sourceIndex[id] = len(result.Sources)
			result.Sources = append(result.Sources, DashboardFirstContactSource{
				Source: id, LeadCount: leadCount, ContactedLeads: contactedLeads,
				AverageResponseSeconds: dashboardNullableAverage(average),
			})
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return DashboardFirstContact{}, err
	}
	rows.Close()

	redistributionRows, err := tx.Query(ctx, dashboardFirstContactRedistributionSQL(where, len(args)), queryArgs...)
	if err != nil {
		return DashboardFirstContact{}, err
	}
	for redistributionRows.Next() {
		var dimension, id, name string
		var avatar pgtype.Text
		var events, distinctLeads int64
		if err := redistributionRows.Scan(&dimension, &id, &name, &avatar, &events, &distinctLeads); err != nil {
			redistributionRows.Close()
			return DashboardFirstContact{}, err
		}
		switch dimension {
		case "total":
			result.RedistributionEvents = events
			result.RedistributedLeads = distinctLeads
		case "source":
			if index, ok := sourceIndex[id]; ok {
				result.Sources[index].RedistributionEvents = events
				result.Sources[index].RedistributedLeads = distinctLeads
			}
		case "broker_away", "broker_received":
			index, ok := brokerIndex[id]
			if !ok {
				index = len(result.Brokers)
				brokerIndex[id] = index
				result.Brokers = append(result.Brokers, DashboardFirstContactBroker{
					ID: id, Name: name, AvatarURL: pipelineTextPtr(avatar),
				})
			}
			if dimension == "broker_away" {
				result.Brokers[index].RedistributedAway = distinctLeads
			} else {
				result.Brokers[index].RedistributedReceived = distinctLeads
			}
		}
	}
	if err := redistributionRows.Err(); err != nil {
		redistributionRows.Close()
		return DashboardFirstContact{}, err
	}
	redistributionRows.Close()
	if err := tx.Commit(ctx); err != nil {
		return DashboardFirstContact{}, err
	}

	sort.Slice(result.Brokers, func(i, j int) bool {
		left, right := result.Brokers[i], result.Brokers[j]
		if left.ContactedLeads != right.ContactedLeads {
			return left.ContactedLeads > right.ContactedLeads
		}
		if left.Name != right.Name {
			return left.Name < right.Name
		}
		return left.ID < right.ID
	})
	sort.Slice(result.Sources, func(i, j int) bool {
		left, right := result.Sources[i], result.Sources[j]
		if left.LeadCount != right.LeadCount {
			return left.LeadCount > right.LeadCount
		}
		return left.Source < right.Source
	})
	return result, nil
}

func dashboardNullableAverage(value pgtype.Float8) *float64 {
	if !value.Valid {
		return nil
	}
	average := value.Float64
	return &average
}

func dashboardFirstContactActorScope(tenantContext tenant.Context) (bool, []string) {
	if tenantContext.IsSuperAdmin || tenantContext.HasRole("owner", "admin") {
		return false, nil
	}
	if tenantContext.IsTeamLeader {
		return true, tenantContext.LedUserIDs
	}
	return true, []string{tenantContext.UserID}
}

func dashboardFirstContactCanSeeActor(tenantContext tenant.Context, actorID string) bool {
	scoped, allowedIDs := dashboardFirstContactActorScope(tenantContext)
	if !scoped {
		return true
	}
	for _, allowedID := range allowedIDs {
		if strings.EqualFold(allowedID, actorID) {
			return true
		}
	}
	return false
}

func dashboardFirstContactSelectedTeamID(filter DashboardFilter) string {
	teamID := strings.TrimSpace(filter.TeamID)
	if strings.EqualFold(teamID, "all") {
		return ""
	}
	return teamID
}

// The team filter on the lead cohort follows the current assignee. Response
// performance also needs the responding person's active team membership.
// Keep this an EXISTS so multi-team membership never multiplies lead counts.
func dashboardFirstContactTeamMemberSQL(actor, team string) string {
	return `exists (
		select 1 from public.team_members tm
		join public.teams fc_team on fc_team.id = tm.team_id and fc_team.organization_id = tm.organization_id
		join public.users u on u.id = tm.user_id
		join public.organization_members om on om.organization_id = tm.organization_id and om.user_id = tm.user_id
		where tm.organization_id = $1::uuid and tm.team_id = nullif(` + team + `::text, '')::uuid
		  and tm.user_id = ` + actor + ` and coalesce(tm.is_active, true) = true
		  and coalesce(fc_team.is_active, true) = true and coalesce(u.is_active, false) = true
		  and coalesce(om.is_active, false) = true and om.deleted_at is null
	)`
}

func dashboardFirstContactActorSQL(actor, selected, scoped, allowed, team string) string {
	return `(` + actor + ` is not null
		and (` + selected + `::text = '' or ` + actor + ` = nullif(` + selected + `::text, '')::uuid)
		and (not ` + scoped + `::boolean or ` + actor + ` = any(` + allowed + `::uuid[]))
		and (` + team + `::text = '' or ` + dashboardFirstContactTeamMemberSQL(actor, team) + `))`
}

// The user filter means current owner for the lead-count cards, but performance
// belongs to the person who answered. Keep every other cohort filter and apply
// userId to the response actor and the recorded assignment history below.
func (repo Repository) buildDashboardFirstContactWhere(tenantContext tenant.Context, filter DashboardFilter) ([]string, []any, string, error) {
	selectedUserID := ""
	if filter.UserID != "" && filter.UserID != "all" && filter.UserID != "unassigned" {
		var ok bool
		selectedUserID, ok = normalizeUUID(filter.UserID)
		if !ok {
			return nil, nil, "", ErrInvalidInput
		}
		if !dashboardFirstContactCanSeeActor(tenantContext, selectedUserID) {
			return nil, nil, "", tenant.ErrOrganizationAccessDenied
		}
		filter.UserID = ""
	}
	where, args, err := repo.buildDashboardLeadWhere(tenantContext, filter, dashboardLeadWhereOptions{DateColumn: "created_at"})
	return where, args, selectedUserID, err
}

func dashboardFirstContactMetricsSQL(where []string, argCount int) string {
	selected := fmt.Sprintf("$%d", argCount+1)
	scoped := fmt.Sprintf("$%d", argCount+2)
	allowed := fmt.Sprintf("$%d", argCount+3)
	team := fmt.Sprintf("$%d", argCount+4)
	contactActor := dashboardFirstContactActorSQL("c.first_response_actor_user_id", selected, scoped, allowed, team)
	brokerActor := dashboardFirstContactActorSQL("b.user_id", selected, scoped, allowed, team)
	touchedActor := dashboardFirstContactActorSQL("t.user_id", selected, scoped, allowed, team)
	return `
		with cohort as (
			select l.id, l.assigned_user_id, l.first_response_actor_user_id,
				coalesce(nullif(l.source, ''), 'manual') as source,
				case when l.first_response_actor_user_id is not null
				  and coalesce(l.first_response_is_automation, false) = false
				  and l.first_response_seconds >= 0
				  and l.first_response_at is not null
				  then l.first_response_seconds end as response_seconds
			from public.leads l
			where ` + strings.Join(where, " and ") + `
		), receipts as (
			select id as lead_id, assigned_user_id as user_id from cohort where assigned_user_id is not null
			union
			select c.id, rrl.assigned_user_id from cohort c
			join public.round_robin_logs rrl on rrl.organization_id = $1::uuid and rrl.lead_id = c.id
			where rrl.assigned_user_id is not null
			union
			select c.id, h.to_user_id from cohort c
			join public.lead_pool_history h on h.organization_id = $1::uuid and h.lead_id = c.id
			where h.to_user_id is not null
			union
			select c.id, lac.assigned_user_id from cohort c
			join public.lead_assignment_cycles lac on lac.organization_id = $1::uuid and lac.lead_id = c.id
			where lac.assigned_user_id is not null
			union
			select c.id, lah.assigned_to from cohort c
			join public.lead_assignment_history lah on lah.lead_id = c.id
			where lah.assigned_to is not null
		), touched as (
			select lead_id, user_id from receipts
			union
			select id, first_response_actor_user_id from cohort
			where response_seconds is not null
		), visible_cohort as (
			select c.* from cohort c
			where (` + selected + `::text = '' and not ` + scoped + `::boolean and ` + team + `::text = '')
			   or exists (select 1 from touched t where t.lead_id = c.id and ` + touchedActor + `)
		), assigned as (
			select assigned_user_id as user_id, count(*)::bigint as lead_count
			from cohort where assigned_user_id is not null group by assigned_user_id
		), received as (
			select user_id, count(*)::bigint as received_leads
			from receipts group by user_id
		), handled as (
			select user_id, count(*)::bigint as handled_leads
			from touched group by user_id
		), contacted as (
			select first_response_actor_user_id as user_id,
				count(*)::bigint as contacted_leads,
				avg(response_seconds)::double precision as average_seconds
			from cohort where response_seconds is not null group by first_response_actor_user_id
		), brokers as (
			select coalesce(a.user_id, c.user_id, r.user_id, h.user_id) as user_id,
				coalesce(a.lead_count, 0)::bigint as lead_count,
				coalesce(r.received_leads, 0)::bigint as received_leads,
				coalesce(h.handled_leads, 0)::bigint as handled_leads,
				coalesce(c.contacted_leads, 0)::bigint as contacted_leads,
				c.average_seconds
			from assigned a full join contacted c on c.user_id = a.user_id
			full join received r on r.user_id = coalesce(a.user_id, c.user_id)
			full join handled h on h.user_id = coalesce(a.user_id, c.user_id, r.user_id)
		)
		select 'total'::text, ''::text, ''::text, null::text,
			count(*)::bigint, 0::bigint, 0::bigint,
			count(c.response_seconds) filter (where ` + contactActor + `)::bigint,
			avg(c.response_seconds) filter (where ` + contactActor + `)::double precision
		from visible_cohort c
		union all
		select 'broker', b.user_id::text,
			coalesce(nullif(btrim(u.name), ''), 'Usuário indisponível'), u.avatar_url,
			b.lead_count, b.received_leads, b.handled_leads, b.contacted_leads, b.average_seconds
		from brokers b
		left join public.users u on u.id = b.user_id and exists (
			select 1 from public.organization_members om
			where om.organization_id = $1::uuid and om.user_id = b.user_id
		)
		where ` + brokerActor + `
		union all
		select 'source', c.source, ''::text, null::text,
			count(*)::bigint, 0::bigint, 0::bigint,
			count(c.response_seconds) filter (where ` + contactActor + `)::bigint,
			avg(c.response_seconds) filter (where ` + contactActor + `)::double precision
		from visible_cohort c group by c.source
	`
}

func dashboardFirstContactRedistributionSQL(where []string, argCount int) string {
	selected := fmt.Sprintf("$%d", argCount+1)
	scoped := fmt.Sprintf("$%d", argCount+2)
	allowed := fmt.Sprintf("$%d", argCount+3)
	team := fmt.Sprintf("$%d", argCount+4)
	fromActor := dashboardFirstContactActorSQL("e.from_user_id", selected, scoped, allowed, team)
	toActor := dashboardFirstContactActorSQL("e.to_user_id", selected, scoped, allowed, team)
	brokerActor := dashboardFirstContactActorSQL("b.user_id", selected, scoped, allowed, team)
	return `
		with cohort as (
			select l.id, coalesce(nullif(l.source, ''), 'manual') as source
			from public.leads l
			where ` + strings.Join(where, " and ") + `
		), events as (
			select c.id as lead_id, c.source,
				previous_user.id as from_user_id, rrl.assigned_user_id as to_user_id
			from cohort c
			join public.round_robin_logs rrl on rrl.organization_id = $1::uuid and rrl.lead_id = c.id
			  and rrl.reason = 'auto_redistribution' and rrl.assigned_user_id is not null
			join public.users previous_user on previous_user.id::text = rrl.metadata->>'previous_user_id'
			where previous_user.id <> rrl.assigned_user_id
			union all
			select c.id, c.source, h.from_user_id, h.to_user_id
			from cohort c
			join public.lead_pool_history h on h.organization_id = $1::uuid and h.lead_id = c.id
			where h.from_user_id is not null and h.to_user_id is not null
			  and h.from_user_id <> h.to_user_id
		), visible_events as (
			select * from events e
			where ` + fromActor + ` or ` + toActor + `
		), by_broker as (
			select 'broker_away'::text as dimension, from_user_id as user_id, lead_id from visible_events
			union all
			select 'broker_received', to_user_id, lead_id from visible_events
		)
		select 'total'::text, ''::text, ''::text, null::text,
			count(*)::bigint, count(distinct lead_id)::bigint from visible_events
		union all
		select 'source', source, ''::text, null::text,
			count(*)::bigint, count(distinct lead_id)::bigint
		from visible_events group by source
		union all
		select b.dimension, b.user_id::text,
			coalesce(nullif(btrim(u.name), ''), 'Usuário indisponível'), u.avatar_url,
			count(*)::bigint, count(distinct b.lead_id)::bigint
		from by_broker b
		left join public.users u on u.id = b.user_id and exists (
			select 1 from public.organization_members om
			where om.organization_id = $1::uuid and om.user_id = b.user_id
		)
		where ` + brokerActor + `
		group by b.dimension, b.user_id, u.name, u.avatar_url
	`
}

// ListDashboardFirstContactLeads is a bounded drill-down for one response
// actor. It reuses the same visible creation-date cohort as the aggregate,
// including page, campaign, source, pipeline, team, tags, and search filters.
func (repo Repository) ListDashboardFirstContactLeads(ctx context.Context, tenantContext tenant.Context, filter DashboardFilter, brokerID string, offset, limit int) (DashboardFirstContactLeadPage, error) {
	result := DashboardFirstContactLeadPage{Items: []DashboardFirstContactLead{}}
	if !canViewDashboardLeadDistribution(tenantContext) {
		return result, tenant.ErrOrganizationAccessDenied
	}
	if _, ok := normalizeUUID(brokerID); !ok || offset < 0 || offset > 10000 || limit < 1 || limit > 50 {
		return result, ErrInvalidInput
	}
	if !dashboardFirstContactCanSeeActor(tenantContext, brokerID) {
		return result, tenant.ErrOrganizationAccessDenied
	}
	where, args, selectedUserID, err := repo.buildDashboardFirstContactWhere(tenantContext, filter)
	if err != nil {
		return result, err
	}
	if selectedUserID != "" && selectedUserID != brokerID {
		return result, ErrInvalidInput
	}
	args = append(args, brokerID)
	where = append(where,
		fmt.Sprintf("l.first_response_actor_user_id = $%d::uuid", len(args)),
		"coalesce(l.first_response_is_automation, false) = false",
		"l.first_response_seconds >= 0",
		"l.first_response_at is not null",
	)
	if teamID := dashboardFirstContactSelectedTeamID(filter); teamID != "" {
		args = append(args, teamID)
		where = append(where, dashboardFirstContactTeamMemberSQL(
			"l.first_response_actor_user_id", fmt.Sprintf("$%d", len(args)),
		))
	}
	conditions := strings.Join(where, " and ")
	tx, err := repo.db.Pool().BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return result, err
	}
	defer tx.Rollback(ctx)
	if err := tx.QueryRow(ctx, "select count(*)::bigint from public.leads l where "+conditions, args...).Scan(&result.Total); err != nil {
		return result, err
	}
	pageArgs := append(append([]any{}, args...), limit, offset)
	rows, err := tx.Query(ctx, `
		select l.id::text,
			coalesce(nullif(btrim(l.name), ''), 'Lead sem nome'),
			coalesce(nullif(l.source, ''), 'manual'),
			l.created_at, l.first_response_at, l.first_response_seconds::bigint,
			u.name
		from public.leads l
		left join public.users u on u.id = l.assigned_user_id
		  and exists (select 1 from public.organization_members om
		    where om.organization_id = $1::uuid and om.user_id = u.id)
		where `+conditions+`
		order by l.first_response_seconds desc, l.first_response_at desc, l.id desc
		limit $`+fmt.Sprint(len(args)+1)+` offset $`+fmt.Sprint(len(args)+2), pageArgs...)
	if err != nil {
		return result, err
	}
	for rows.Next() {
		var item DashboardFirstContactLead
		var createdAt, respondedAt time.Time
		var currentOwner pgtype.Text
		if err := rows.Scan(&item.ID, &item.Name, &item.Source, &createdAt, &respondedAt, &item.ResponseSeconds, &currentOwner); err != nil {
			rows.Close()
			return result, err
		}
		item.CreatedAt = createdAt.UTC().Format(time.RFC3339)
		item.RespondedAt = respondedAt.UTC().Format(time.RFC3339)
		item.CurrentOwner = pipelineTextPtr(currentOwner)
		result.Items = append(result.Items, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return result, err
	}
	rows.Close()
	if err := tx.Commit(ctx); err != nil {
		return result, err
	}
	result.HasMore = int64(offset+len(result.Items)) < result.Total
	return result, nil
}
