package leads

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) ListEnrichments(ctx context.Context, tenantContext tenant.Context, leadIDs []string) ([]LeadEnrichment, error) {
	leadIDs = normalizeLeadEnrichmentIDs(leadIDs)
	if len(leadIDs) == 0 {
		return []LeadEnrichment{}, nil
	}

	seeds, err := repo.listVisibleLeadEnrichmentSeeds(ctx, tenantContext, leadIDs)
	if err != nil {
		return nil, err
	}
	if len(seeds) == 0 {
		return []LeadEnrichment{}, nil
	}

	enrichmentsByLead := make(map[string]*LeadEnrichment, len(seeds))
	visibleLeadIDs := make([]string, 0, len(seeds))
	assignedUserIDs := make([]string, 0, len(seeds))
	propertyIDs := make([]string, 0, len(seeds))
	assignedUserByLead := map[string]string{}
	propertyByLead := map[string]string{}

	for _, seed := range seeds {
		visibleLeadIDs = append(visibleLeadIDs, seed.LeadID)
		enrichmentsByLead[seed.LeadID] = &LeadEnrichment{
			LeadID:     seed.LeadID,
			Tags:       []LeadEnrichmentTag{},
			TasksCount: LeadEnrichmentTaskCount{},
			LeadMeta:   []LeadEnrichmentMeta{},
		}
		if seed.AssignedUserID != "" {
			assignedUserIDs = appendUniqueString(assignedUserIDs, seed.AssignedUserID)
			assignedUserByLead[seed.LeadID] = seed.AssignedUserID
		}
		if seed.InterestPropertyID != "" {
			propertyIDs = appendUniqueString(propertyIDs, seed.InterestPropertyID)
			propertyByLead[seed.LeadID] = seed.InterestPropertyID
		}
	}

	if err := repo.attachLeadEnrichmentTags(ctx, tenantContext, visibleLeadIDs, enrichmentsByLead); err != nil {
		return nil, err
	}
	if err := repo.attachLeadEnrichmentTaskCounts(ctx, tenantContext, visibleLeadIDs, enrichmentsByLead); err != nil {
		return nil, err
	}
	if err := repo.attachLeadEnrichmentMeta(ctx, tenantContext, visibleLeadIDs, enrichmentsByLead); err != nil {
		return nil, err
	}
	if err := repo.attachLeadEnrichmentUsers(ctx, tenantContext, assignedUserIDs, assignedUserByLead, enrichmentsByLead); err != nil {
		return nil, err
	}
	if err := repo.attachLeadEnrichmentProperties(ctx, tenantContext, propertyIDs, propertyByLead, enrichmentsByLead); err != nil {
		return nil, err
	}

	out := make([]LeadEnrichment, 0, len(seeds))
	for _, seed := range seeds {
		out = append(out, *enrichmentsByLead[seed.LeadID])
	}

	return out, nil
}

func (repo Repository) listVisibleLeadEnrichmentSeeds(ctx context.Context, tenantContext tenant.Context, leadIDs []string) ([]visibleLeadEnrichmentSeed, error) {
	args := []any{
		tenantContext.OrganizationID,
		canViewAllLeads(tenantContext),
		tenantContext.UserID,
		tenantContext.HasPermission("lead_view_team"),
	}
	for _, id := range leadIDs {
		args = append(args, id)
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select
			l.id::text,
			l.assigned_user_id::text,
			l.interest_property_id::text
		from public.leads l
		where l.organization_id = $1::uuid
		  and `+leadVisibilitySQL("$2", "$3", "$4")+`
		  and l.id in (`+uuidPlaceholders(5, leadIDs)+`)
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	seedsByID := map[string]visibleLeadEnrichmentSeed{}
	for rows.Next() {
		var seed visibleLeadEnrichmentSeed
		var assignedUserID, interestPropertyID pgtype.Text
		if err := rows.Scan(&seed.LeadID, &assignedUserID, &interestPropertyID); err != nil {
			return nil, err
		}
		seed.AssignedUserID = textValue(assignedUserID)
		seed.InterestPropertyID = textValue(interestPropertyID)
		seedsByID[seed.LeadID] = seed
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	ordered := make([]visibleLeadEnrichmentSeed, 0, len(seedsByID))
	for _, id := range leadIDs {
		if seed, ok := seedsByID[id]; ok {
			ordered = append(ordered, seed)
		}
	}

	return ordered, nil
}

func (repo Repository) attachLeadEnrichmentTags(ctx context.Context, tenantContext tenant.Context, leadIDs []string, enrichments map[string]*LeadEnrichment) error {
	if len(leadIDs) == 0 {
		return nil
	}

	args := []any{tenantContext.OrganizationID}
	for _, id := range leadIDs {
		args = append(args, id)
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select
			lt.lead_id::text,
			t.id::text,
			t.name,
			t.color
		from public.lead_tags lt
		join public.tags t on t.id = lt.tag_id
		where lt.organization_id = $1::uuid
		  and t.organization_id = $1::uuid
		  and lt.lead_id in (`+uuidPlaceholders(2, leadIDs)+`)
		order by lt.created_at asc
	`, args...)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var leadID string
		var tag LeadEnrichmentTag
		var name, color pgtype.Text
		if err := rows.Scan(&leadID, &tag.ID, &name, &color); err != nil {
			return err
		}
		if enrichment, ok := enrichments[leadID]; ok {
			tag.Name = textPtr(name)
			tag.Color = textPtr(color)
			enrichment.Tags = append(enrichment.Tags, tag)
		}
	}

	return rows.Err()
}

func (repo Repository) attachLeadEnrichmentTaskCounts(ctx context.Context, tenantContext tenant.Context, leadIDs []string, enrichments map[string]*LeadEnrichment) error {
	if len(leadIDs) == 0 {
		return nil
	}

	args := []any{tenantContext.OrganizationID}
	for _, id := range leadIDs {
		args = append(args, id)
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select
			lead_id::text,
			count(*) filter (where is_done = false) as pending,
			count(*) filter (where is_done = true) as completed
		from public.lead_tasks
		where organization_id = $1::uuid
		  and lead_id in (`+uuidPlaceholders(2, leadIDs)+`)
		group by lead_id
	`, args...)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var leadID string
		var pending, completed int64
		if err := rows.Scan(&leadID, &pending, &completed); err != nil {
			return err
		}
		if enrichment, ok := enrichments[leadID]; ok {
			enrichment.TasksCount = LeadEnrichmentTaskCount{
				Pending:   int(pending),
				Completed: int(completed),
			}
		}
	}

	return rows.Err()
}

func (repo Repository) attachLeadEnrichmentMeta(ctx context.Context, tenantContext tenant.Context, leadIDs []string, enrichments map[string]*LeadEnrichment) error {
	if len(leadIDs) == 0 {
		return nil
	}

	args := []any{tenantContext.OrganizationID}
	for _, id := range leadIDs {
		args = append(args, id)
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select
			lead_id::text,
			campaign_name,
			campaign_id,
			adset_name,
			adset_id,
			ad_name,
			ad_id,
			platform
		from public.lead_meta
		where organization_id = $1::uuid
		  and lead_id in (`+uuidPlaceholders(2, leadIDs)+`)
		order by created_at asc
	`, args...)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var meta LeadEnrichmentMeta
		var campaignName, campaignID, adsetName, adsetID, adName, adID, platform pgtype.Text
		if err := rows.Scan(&meta.LeadID, &campaignName, &campaignID, &adsetName, &adsetID, &adName, &adID, &platform); err != nil {
			return err
		}
		if enrichment, ok := enrichments[meta.LeadID]; ok {
			meta.CampaignName = textPtr(campaignName)
			meta.CampaignID = textPtr(campaignID)
			meta.AdsetName = textPtr(adsetName)
			meta.AdsetID = textPtr(adsetID)
			meta.AdName = textPtr(adName)
			meta.AdID = textPtr(adID)
			meta.Platform = textPtr(platform)
			enrichment.LeadMeta = append(enrichment.LeadMeta, meta)
		}
	}

	return rows.Err()
}

func (repo Repository) attachLeadEnrichmentUsers(ctx context.Context, tenantContext tenant.Context, userIDs []string, userByLead map[string]string, enrichments map[string]*LeadEnrichment) error {
	userIDs = uniqueStrings(userIDs)
	if len(userIDs) == 0 {
		return nil
	}

	args := []any{tenantContext.OrganizationID}
	for _, id := range userIDs {
		args = append(args, id)
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select
			u.id::text,
			u.name,
			u.avatar_url
		from public.users u
		left join public.organization_members om
		  on om.user_id = u.id
		 and om.organization_id = $1::uuid
		 and om.is_active = true
		where u.id in (`+uuidPlaceholders(2, userIDs)+`)
		  and (
		    u.organization_id = $1::uuid
		    or om.id is not null
		  )
	`, args...)
	if err != nil {
		return err
	}
	defer rows.Close()

	usersByID := map[string]*LeadEnrichmentUser{}
	for rows.Next() {
		var user LeadEnrichmentUser
		var name, avatarURL pgtype.Text
		if err := rows.Scan(&user.ID, &name, &avatarURL); err != nil {
			return err
		}
		user.Name = textPtr(name)
		user.AvatarURL = textPtr(avatarURL)
		usersByID[user.ID] = &user
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for leadID, userID := range userByLead {
		if enrichment, ok := enrichments[leadID]; ok {
			enrichment.Assignee = usersByID[userID]
		}
	}

	return nil
}

func (repo Repository) attachLeadEnrichmentProperties(ctx context.Context, tenantContext tenant.Context, propertyIDs []string, propertyByLead map[string]string, enrichments map[string]*LeadEnrichment) error {
	propertyIDs = uniqueStrings(propertyIDs)
	if len(propertyIDs) == 0 {
		return nil
	}

	args := []any{tenantContext.OrganizationID}
	for _, id := range propertyIDs {
		args = append(args, id)
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select
			id::text,
			code,
			title,
			preco::double precision
		from public.properties
		where organization_id = $1::uuid
		  and id in (`+uuidPlaceholders(2, propertyIDs)+`)
	`, args...)
	if err != nil {
		return err
	}
	defer rows.Close()

	propertiesByID := map[string]*LeadEnrichmentProperty{}
	for rows.Next() {
		var property LeadEnrichmentProperty
		var code, title pgtype.Text
		var price pgtype.Float8
		if err := rows.Scan(&property.ID, &code, &title, &price); err != nil {
			return err
		}
		property.Code = textPtr(code)
		property.Title = textPtr(title)
		if price.Valid {
			value := price.Float64
			property.Price = &value
		}
		propertiesByID[property.ID] = &property
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for leadID, propertyID := range propertyByLead {
		if enrichment, ok := enrichments[leadID]; ok {
			enrichment.InterestProperty = propertiesByID[propertyID]
		}
	}

	return nil
}

func normalizeLeadEnrichmentIDs(values []string) []string {
	out := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, value := range values {
		normalized, ok := normalizeUUID(value)
		if !ok {
			continue
		}
		if _, exists := seen[normalized]; exists {
			continue
		}
		seen[normalized] = struct{}{}
		out = append(out, normalized)
	}

	return out
}

func uuidPlaceholders(start int, ids []string) string {
	placeholders := make([]string, 0, len(ids))
	for index := range ids {
		placeholders = append(placeholders, fmt.Sprintf("$%d::uuid", start+index))
	}

	return strings.Join(placeholders, ", ")
}

func appendUniqueString(values []string, value string) []string {
	value = strings.TrimSpace(value)
	if value == "" {
		return values
	}
	for _, current := range values {
		if current == value {
			return values
		}
	}

	return append(values, value)
}

func uniqueStrings(values []string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		out = appendUniqueString(out, value)
	}

	return out
}

func textPtr(value pgtype.Text) *string {
	if !value.Valid {
		return nil
	}

	return &value.String
}
