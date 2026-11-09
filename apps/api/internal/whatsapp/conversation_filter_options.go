package whatsapp

import (
	"context"
	"fmt"
	"strings"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/searchtext"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func emptyConversationFilterOptions() ConversationFilterOptions {
	return ConversationFilterOptions{
		Pipelines: []ConversationFilterOption{}, Teams: []ConversationFilterOption{},
		Users: []ConversationFilterOption{}, Sources: []string{}, Tags: []ConversationFilterOption{},
		Pages: []ConversationFilterOption{}, Campaigns: []ConversationFilterOption{},
		AdSets: []ConversationFilterOption{}, Ads: []ConversationFilterOption{},
	}
}

// The opt-in expanded catalog keeps older web clients compatible during a rolling release.
func (repo Repository) ListConversationFilterOptions(ctx context.Context, tc tenant.Context, filter ConversationListFilter) (ConversationFilterOptions, error) {
	if !filter.ExpandedOptions {
		return repo.listLegacyConversationFilterOptions(ctx, tc, filter)
	}
	options := emptyConversationFilterOptions()
	args, query, empty, err := conversationFilterOptionsSQL(tc, filter)
	if err != nil || empty {
		return options, err
	}
	rows, err := repo.db.Pool().Query(ctx, query, args...)
	if err != nil {
		return options, err
	}
	defer rows.Close()
	limit := filter.OptionsLimit
	if limit == 0 {
		limit = 100
	}
	seen := map[string]int{}
	for rows.Next() {
		var kind, id, name, color, campaign, adset string
		if err := rows.Scan(&kind, &id, &name, &color, &campaign, &adset); err != nil {
			return options, err
		}
		seen[kind]++
		if seen[kind] > limit {
			options.HasMore = true
			continue
		}
		value := ConversationFilterOption{ID: id, Name: name}
		switch kind {
		case "pipeline":
			options.Pipelines = append(options.Pipelines, value)
		case "team":
			options.Teams = append(options.Teams, value)
		case "user":
			options.Users = append(options.Users, value)
		case "source":
			options.Sources = append(options.Sources, id)
		case "tag":
			value.Color = color
			options.Tags = append(options.Tags, value)
		case "page":
			options.Pages = append(options.Pages, value)
		case "campaign":
			options.Campaigns = append(options.Campaigns, value)
		case "adset":
			value.CampaignID = campaign
			options.AdSets = append(options.AdSets, value)
		case "ad":
			value.CampaignID = campaign
			value.AdSetID = adset
			options.Ads = append(options.Ads, value)
		}
	}
	if options.HasMore {
		next := filter.OptionsOffset + limit
		options.NextOffset = &next
	}
	return options, rows.Err()
}

func conversationFilterOptionsSQL(tc tenant.Context, filter ConversationListFilter) ([]any, string, bool, error) {
	limit := filter.OptionsLimit
	if limit == 0 {
		limit = 100
	}
	if limit < 1 || limit > 200 || filter.OptionsOffset < 0 || filter.OptionsOffset > 1_000_000 || !validConversationFilterText(filter.OptionsSearch, 120) {
		return nil, "", false, ErrInvalidInput
	}
	scope := ConversationListFilter{
		SessionID: filter.SessionID, SessionIDs: filter.SessionIDs, AccessibleProvided: filter.AccessibleProvided,
		HideGroups: filter.HideGroups, ShowArchived: filter.ShowArchived,
		LastMessageFrom: filter.LastMessageFrom, LastMessageTo: filter.LastMessageTo,
		LeadCreatedFrom: filter.LeadCreatedFrom, LeadCreatedTo: filter.LeadCreatedTo,
	}
	args, where, empty, err := conversationFilterSQLWithSupervisoryRead(tc, scope,
		canIncludeSupervisoryLeads(tc, filter))
	if err != nil || empty {
		return nil, "", empty, err
	}
	attributionWhere := "true"
	if page := strings.TrimSpace(filter.PageID); page != "" {
		if !validConversationFilterText(page, 255) {
			return nil, "", false, ErrInvalidInput
		}
		args = append(args, page)
		attributionWhere += fmt.Sprintf(" and a.page_id = $%d", len(args))
	}
	childWhere := attributionWhere
	if len(filter.CampaignIDs) > 0 {
		if len(filter.CampaignIDs) > 50 {
			return nil, "", false, ErrInvalidInput
		}
		for _, id := range filter.CampaignIDs {
			if !validConversationFilterText(id, 255) {
				return nil, "", false, ErrInvalidInput
			}
		}
		args = append(args, uniqueConversationFilterValues(filter.CampaignIDs))
		childWhere += fmt.Sprintf(" and a.campaign_id = any($%d::text[])", len(args))
	}
	adWhere := childWhere
	if adset := strings.TrimSpace(filter.AdSetID); adset != "" {
		if !validConversationFilterText(adset, 255) {
			return nil, "", false, ErrInvalidInput
		}
		args = append(args, adset)
		adWhere += fmt.Sprintf(" and a.adset_id = $%d", len(args))
	}
	searchWhere := "true"
	if search := strings.TrimSpace(filter.OptionsSearch); search != "" {
		args = append(args, searchtext.Pattern(search))
		searchWhere = searchtext.AnySQL([]string{"name", "id"}, fmt.Sprintf("$%d", len(args)))
	}
	args = append(args, filter.OptionsOffset, filter.OptionsOffset+limit+1)
	lower, upper := len(args)-1, len(args)
	query := `with visible_leads as materialized (
  select distinct l.id, l.organization_id, l.pipeline_id, l.team_id, l.assigned_user_id,
    l.source, l.meta_campaign_id, l.utm_campaign, l.meta_adset_id, l.meta_ad_id
  from public.whatsapp_conversations wc
  join public.whatsapp_sessions ws on ws.id = wc.session_id
  join public.leads l on l.id = wc.lead_id and l.organization_id = wc.organization_id
  where ` + strings.Join(where, " and ") + `
 ), attribution as materialized (
  select nullif(btrim(e.page_id), '') page_id, nullif(btrim(e.page_name), '') page_name,
    coalesce(nullif(btrim(e.campaign_id), ''), nullif(btrim(e.campaign_name), ''), nullif(btrim(e.utm_campaign), '')) campaign_id,
    coalesce(nullif(btrim(e.campaign_name), ''), nullif(btrim(e.utm_campaign), ''), nullif(btrim(e.campaign_id), '')) campaign_name,
    coalesce(nullif(btrim(e.adset_id), ''), nullif(btrim(e.adset_name), '')) adset_id,
    coalesce(nullif(btrim(e.adset_name), ''), nullif(btrim(e.adset_id), '')) adset_name,
    coalesce(nullif(btrim(e.ad_id), ''), nullif(btrim(e.ad_name), '')) ad_id,
    coalesce(nullif(btrim(e.ad_name), ''), nullif(btrim(e.ad_id), '')) ad_name
  from visible_leads l join public.lead_entry_events e on e.organization_id = l.organization_id
    and e.lead_id = l.id and e.is_countable = true
  union all
  select nullif(btrim(lm.page_id), ''), null,
    coalesce(nullif(btrim(lm.campaign_id), ''), nullif(btrim(lm.campaign_name), '')),
    coalesce(nullif(btrim(lm.campaign_name), ''), nullif(btrim(lm.campaign_id), '')),
    coalesce(nullif(btrim(lm.adset_id), ''), nullif(btrim(lm.adset_name), '')),
    coalesce(nullif(btrim(lm.adset_name), ''), nullif(btrim(lm.adset_id), '')),
    coalesce(nullif(btrim(lm.ad_id), ''), nullif(btrim(lm.ad_name), '')),
    coalesce(nullif(btrim(lm.ad_name), ''), nullif(btrim(lm.ad_id), ''))
  from visible_leads l join public.lead_meta lm on lm.organization_id = l.organization_id and lm.lead_id = l.id
  union all
  select null, null, coalesce(nullif(btrim(l.meta_campaign_id), ''), nullif(btrim(l.utm_campaign), '')),
    coalesce(nullif(btrim(l.utm_campaign), ''), nullif(btrim(l.meta_campaign_id), '')),
    nullif(btrim(l.meta_adset_id), ''), nullif(btrim(l.meta_adset_id), ''),
    nullif(btrim(l.meta_ad_id), ''), nullif(btrim(l.meta_ad_id), '') from visible_leads l
 ), raw_options(kind,id,name,color,campaign_id,adset_id) as (
  select 'pipeline', p.id::text, p.name::text, '', '', '' from visible_leads l
    join public.pipelines p on p.id=l.pipeline_id and p.organization_id=l.organization_id
  union all
  select 'team', t.id::text, t.name::text, '', '', '' from visible_leads l
    join public.team_members tm on tm.organization_id=l.organization_id and tm.user_id=l.assigned_user_id and coalesce(tm.is_active,true)
    join public.teams t on t.id=tm.team_id and t.organization_id=tm.organization_id and t.is_active
    join public.users u on u.id=tm.user_id and coalesce(u.is_active,false)
    join public.organization_members m on m.organization_id=tm.organization_id and m.user_id=tm.user_id
      and coalesce(m.is_active,false) and m.deleted_at is null and m.membership_generation=tm.membership_generation
  union all
  select 'team', t.id::text, t.name::text, '', '', '' from visible_leads l
    join public.teams t on t.id=l.team_id and t.organization_id=l.organization_id and t.is_active where l.assigned_user_id is null
  union all
  select 'user', u.id::text, u.name::text, '', '', '' from visible_leads l
    join public.users u on u.id=l.assigned_user_id and coalesce(u.is_active,false)
    join public.organization_members m on m.organization_id=l.organization_id and m.user_id=u.id
      and coalesce(m.is_active,false) and m.deleted_at is null
  union all
  select 'source', btrim(l.source), btrim(l.source), '', '', '' from visible_leads l where nullif(btrim(l.source),'') is not null
  union all
  select 'tag', t.id::text, t.name::text, coalesce(t.color,'#6b7280'), '', '' from visible_leads l
    join public.lead_tags lt on lt.organization_id=l.organization_id and lt.lead_id=l.id
    join public.tags t on t.id=lt.tag_id and t.organization_id=lt.organization_id
  union all
  select 'page', a.page_id, coalesce(a.page_name,a.page_id), '', '', '' from attribution a where a.page_id is not null
  union all
  select 'campaign', a.campaign_id, coalesce(a.campaign_name,a.campaign_id), '', '', '' from attribution a
    where a.campaign_id is not null and ` + attributionWhere + `
  union all
  select 'adset', a.adset_id, coalesce(a.adset_name,a.adset_id), '', a.campaign_id, '' from attribution a
    where a.adset_id is not null and a.campaign_id is not null and ` + childWhere + `
  union all
  select 'ad', a.ad_id, coalesce(a.ad_name,a.ad_id), '', a.campaign_id, a.adset_id from attribution a
    where a.ad_id is not null and a.campaign_id is not null and a.adset_id is not null and ` + adWhere + `
 ), grouped_options as (
  select kind,id,min(name) name,min(color) color,campaign_id,adset_id
  from raw_options where name is not null group by kind,id,campaign_id,adset_id
 ), ranked_options as (
  select *,row_number() over(partition by kind order by name,id,campaign_id,adset_id) rn
  from grouped_options where ` + searchWhere + `
 ) select kind,id,name,color,campaign_id,adset_id from ranked_options
   where rn > $` + fmt.Sprint(lower) + ` and rn <= $` + fmt.Sprint(upper) + ` order by kind,rn`
	return args, query, false, nil
}
