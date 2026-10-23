package leads

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/propertyscope"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type Tag struct {
	ID             string    `json:"id"`
	Name           string    `json:"name"`
	Color          string    `json:"color"`
	Description    *string   `json:"description"`
	OrganizationID string    `json:"organization_id"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
	LeadCount      int64     `json:"lead_count"`
}

type TagMutationRequest struct {
	Name              string  `json:"name"`
	Color             string  `json:"color"`
	Description       *string `json:"description"`
	ExpectedUpdatedAt *string `json:"expected_updated_at"`
}

var tagHexColorPattern = regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)

type tagMutationInput struct {
	Name              string
	Color             string
	Description       *string
	ExpectedUpdatedAt *time.Time
}

type Activity struct {
	ID             string         `json:"id"`
	OrganizationID string         `json:"organization_id"`
	LeadID         string         `json:"lead_id"`
	UserID         *string        `json:"user_id"`
	Type           string         `json:"type"`
	Content        *string        `json:"content"`
	Metadata       map[string]any `json:"metadata"`
	CreatedAt      time.Time      `json:"created_at"`
	User           *ActivityUser  `json:"user,omitempty"`
	Lead           *ActivityLead  `json:"lead,omitempty"`
}

type ActivityUser struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type ActivityLead struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type ActivityCreateRequest struct {
	LeadID   string         `json:"lead_id"`
	Type     string         `json:"type"`
	Content  *string        `json:"content"`
	Metadata map[string]any `json:"metadata"`
}

type activityCreateInput struct {
	LeadID   string
	Type     string
	Content  *string
	Metadata map[string]any
}

type LeadMeta struct {
	ID                   string         `json:"id"`
	LeadID               string         `json:"lead_id"`
	PageID               *string        `json:"page_id"`
	FormID               *string        `json:"form_id"`
	AdID                 *string        `json:"ad_id"`
	AdsetID              *string        `json:"adset_id"`
	CampaignID           *string        `json:"campaign_id"`
	AdName               *string        `json:"ad_name"`
	AdsetName            *string        `json:"adset_name"`
	CampaignName         *string        `json:"campaign_name"`
	Platform             *string        `json:"platform"`
	RawPayload           map[string]any `json:"raw_payload"`
	CreatedAt            time.Time      `json:"created_at"`
	UTMSource            *string        `json:"utm_source"`
	UTMMedium            *string        `json:"utm_medium"`
	UTMCampaign          *string        `json:"utm_campaign"`
	UTMContent           *string        `json:"utm_content"`
	UTMTerm              *string        `json:"utm_term"`
	FormName             *string        `json:"form_name"`
	SourceType           *string        `json:"source_type"`
	ContactNotes         *string        `json:"contact_notes"`
	CreativeURL          *string        `json:"creative_url"`
	CreativeVideoURL     *string        `json:"creative_video_url"`
	CreativeInstagramURL *string        `json:"creative_instagram_url"`
}

func (request TagMutationRequest) Validate() (tagMutationInput, error) {
	input := tagMutationInput{
		Name:        trimMax(request.Name, 80),
		Color:       trimMax(request.Color, 40),
		Description: optionalStringFromPointer(request.Description, 300),
	}
	if input.Name == "" {
		return tagMutationInput{}, fmt.Errorf("%w: name is required", ErrInvalidTagInput)
	}
	if input.Color == "" {
		input.Color = "#64748b"
	}
	if !tagHexColorPattern.MatchString(input.Color) {
		return tagMutationInput{}, fmt.Errorf("%w: color must use hexadecimal format #RRGGBB", ErrInvalidTagInput)
	}
	if request.ExpectedUpdatedAt != nil {
		revision, err := parseTagRevision(*request.ExpectedUpdatedAt)
		if err != nil {
			return tagMutationInput{}, err
		}
		input.ExpectedUpdatedAt = &revision
	}
	return input, nil
}

func (request ActivityCreateRequest) Validate() (activityCreateInput, error) {
	return normalizeManualActivityInput(activityCreateInput{
		LeadID: request.LeadID, Type: request.Type, Content: request.Content, Metadata: request.Metadata,
	})
}

func (repo Repository) ListTags(ctx context.Context, tenantContext tenant.Context) ([]Tag, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		select
			t.id::text,
			t.name,
			t.color,
			t.description,
			t.organization_id::text,
			t.created_at,
			t.updated_at,
			count(distinct l.id)::bigint as lead_count
		from public.tags t
		left join public.lead_tags lt on lt.tag_id = t.id
		left join public.leads l on l.id = lt.lead_id and l.organization_id = t.organization_id
		where t.organization_id = $1::uuid
		group by t.id, t.name, t.color, t.description, t.organization_id, t.created_at, t.updated_at
		order by t.name asc
	`, tenantContext.OrganizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tags := []Tag{}
	for rows.Next() {
		tag, err := scanTag(rows)
		if err != nil {
			return nil, err
		}
		tags = append(tags, tag)
	}
	return tags, rows.Err()
}

func (repo Repository) CreateTag(ctx context.Context, tenantContext tenant.Context, input tagMutationInput) (Tag, error) {
	if !tenantContext.HasPermission(permissions.TagManage) {
		return Tag{}, tenant.ErrOrganizationAccessDenied
	}
	tag, err := scanTag(repo.db.Pool().QueryRow(ctx, `
		insert into public.tags (organization_id, name, color, description)
		values ($1::uuid, $2, $3, $4)
		returning id::text, name, color, description, organization_id::text, created_at, updated_at, 0::bigint
	`, tenantContext.OrganizationID, input.Name, input.Color, input.Description))
	return tag, normalizeTagMutationError(err)
}

func (repo Repository) UpdateTag(ctx context.Context, tenantContext tenant.Context, tagID string, input tagMutationInput) (Tag, error) {
	if !tenantContext.HasPermission(permissions.TagManage) {
		return Tag{}, tenant.ErrOrganizationAccessDenied
	}
	tagID, ok := normalizeUUID(tagID)
	if !ok {
		return Tag{}, ErrInvalidTagInput
	}
	if input.ExpectedUpdatedAt == nil {
		return Tag{}, fmt.Errorf("%w: expected_updated_at is required", ErrInvalidTagInput)
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return Tag{}, err
	}
	defer tx.Rollback(ctx)
	if err := lockTagRevision(ctx, tx, tenantContext.OrganizationID, tagID, *input.ExpectedUpdatedAt); err != nil {
		return Tag{}, err
	}
	tag, err := scanTag(tx.QueryRow(ctx, `
		update public.tags
		set name = $3, color = $4, description = $5, updated_at = clock_timestamp()
		where id = $1::uuid and organization_id = $2::uuid and updated_at = $6::timestamptz
		returning id::text, name, color, description, organization_id::text, created_at, updated_at,
			(select count(*)::bigint from public.lead_tags lt where lt.tag_id = public.tags.id)
	`, tagID, tenantContext.OrganizationID, input.Name, input.Color, input.Description, *input.ExpectedUpdatedAt))
	if err != nil {
		return Tag{}, normalizeTagMutationError(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return Tag{}, err
	}
	return tag, nil
}

func (repo Repository) DeleteTag(ctx context.Context, tenantContext tenant.Context, tagID string, expectedUpdatedAt time.Time) error {
	if !tenantContext.HasPermission(permissions.TagManage) {
		return tenant.ErrOrganizationAccessDenied
	}
	tagID, ok := normalizeUUID(tagID)
	if !ok {
		return ErrInvalidTagInput
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := deleteTagWithQueryer(ctx, tx, tenantContext.OrganizationID, tagID, expectedUpdatedAt); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (repo Repository) ListActivities(ctx context.Context, tenantContext tenant.Context, leadID string, limit int) ([]Activity, error) {
	args := []any{
		tenantContext.OrganizationID,
		canViewAllLeads(tenantContext),
		tenantContext.UserID,
		tenantContext.HasPermission("lead_view_team"),
	}
	where := []string{
		"a.organization_id = $1::uuid",
		"l.organization_id = $1::uuid",
		leadVisibilitySQL("$2", "$3", "$4", tenantContext.HasPermission(permissions.LeadViewOwn)),
	}

	if leadID != "" {
		normalizedLeadID, ok := normalizeUUID(leadID)
		if !ok {
			return nil, ErrInvalidInput
		}
		args = append(args, normalizedLeadID)
		where = append(where, fmt.Sprintf("a.lead_id = $%d::uuid", len(args)))
		limit = 500
	}
	if limit <= 0 {
		limit = 100
	}
	limit = max(1, min(limit, 500))
	args, propertyVisibility := appendCanonicalPropertyVisibility(args, tenantContext, "activity_property")
	args = append(args, limit)
	limitIndex := len(args)
	rows, err := repo.db.Pool().Query(ctx,
		leadHistoryScheduleActivityListSQL(tenantContext, where, propertyVisibility, limitIndex), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	activities := []Activity{}
	for rows.Next() {
		activity, err := scanActivity(rows)
		if err != nil {
			return nil, err
		}
		activities = append(activities, activity)
	}
	return activities, rows.Err()
}

func (repo Repository) CreateActivity(ctx context.Context, tenantContext tenant.Context, input activityCreateInput) (Activity, error) {
	return createActivityWithTransaction(ctx, repo.db.Pool().Begin, tenantContext, input)
}

// The canonical write guard locks the lead before both insertion and response
// hydration, so a transfer cannot invalidate this authorization mid-operation.
func createActivityWithTransaction(ctx context.Context, begin func(context.Context) (pgx.Tx, error), actor tenant.Context, input activityCreateInput) (Activity, error) {
	input, err := normalizeManualActivityInput(input)
	if err != nil {
		return Activity{}, err
	}
	// Stamp only after validation. A request cannot choose even this origin, and
	// the normalized map is detached before any transaction/await can mutate it.
	input.Metadata["origin"] = manualActivityOrigin
	tx, err := begin(ctx)
	if err != nil {
		return Activity{}, err
	}
	defer tx.Rollback(ctx)
	if err := ensureLeadEditableForUpdate(ctx, tx, actor, input.LeadID); err != nil {
		return Activity{}, err
	}
	args := []any{actor.OrganizationID, input.LeadID, actor.UserID, input.Type, input.Content, jsonb(input.Metadata)}
	args, propertyVisibility := appendCanonicalPropertyVisibility(args, actor, "activity_property")
	propertyVisibleSQL := "activity_property.id is not null"
	activity, err := scanActivity(tx.QueryRow(ctx, `
		with inserted as (
			insert into public.activities (
				organization_id,
				lead_id,
				user_id,
				type,
				content,
				metadata
			)
			values ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::jsonb)
			returning *
		)
		select `+activitySelectFields(
		activityMetadataSQL(actor, propertyVisibleSQL),
		activityContentSQL(propertyVisibleSQL),
	)+`
		from inserted a
		join public.leads l on l.id = a.lead_id
		left join public.users u on u.id = a.user_id
		left join public.properties activity_property
		  on activity_property.organization_id = a.organization_id
		 and activity_property.id::text = `+activityPropertyReferenceSQL()+`
		 and `+propertyVisibility+`
	`, args...))
	if err != nil {
		return Activity{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Activity{}, err
	}
	return activity, nil
}

func (repo Repository) GetLeadMeta(ctx context.Context, tenantContext tenant.Context, leadID string) (*LeadMeta, error) {
	leadID, ok := normalizeUUID(leadID)
	if !ok {
		return nil, ErrInvalidInput
	}

	meta, err := scanLeadMeta(repo.db.Pool().QueryRow(ctx, `
		select
			lm.id::text,
			lm.lead_id::text,
			lm.page_id,
			lm.form_id,
			lm.ad_id,
			lm.adset_id,
			lm.campaign_id,
			lm.ad_name,
			lm.adset_name,
			lm.campaign_name,
			lm.platform,
			coalesce(lm.raw_payload, lm.payload, '{}'::jsonb)::text,
			lm.created_at,
			lm.utm_source,
			lm.utm_medium,
			lm.utm_campaign,
			lm.utm_content,
			lm.utm_term,
			lm.form_name,
			lm.source_type,
			lm.contact_notes,
			lm.creative_url,
			lm.creative_video_url,
			lm.creative_instagram_url
		from public.lead_meta lm
		join public.leads l on l.id = lm.lead_id
		where l.organization_id = $1::uuid
		  and lm.organization_id = $1::uuid
		  and `+leadVisibilitySQL("$2", "$3", "$4", tenantContext.HasPermission(permissions.LeadViewOwn))+`
		  and lm.lead_id = $5::uuid
		order by lm.created_at desc
		limit 1
	`, tenantContext.OrganizationID, canViewAllLeads(tenantContext), tenantContext.UserID, tenantContext.HasPermission("lead_view_team"), leadID))
	if err == pgx.ErrNoRows || errors.Is(err, ErrInvalidReference) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	return &meta, nil
}

func scanTag(row scanner) (Tag, error) {
	var tag Tag
	var description pgtype.Text
	if err := row.Scan(&tag.ID, &tag.Name, &tag.Color, &description, &tag.OrganizationID, &tag.CreatedAt, &tag.UpdatedAt, &tag.LeadCount); err != nil {
		if err == pgx.ErrNoRows {
			return Tag{}, ErrInvalidReference
		}
		return Tag{}, err
	}
	tag.Description = textPtr(description)
	return tag, nil
}

func activityMetadataSQL(tenantContext tenant.Context, propertyVisibleSQL string) string {
	metadataSQL := "coalesce(a.metadata, '{}'::jsonb)"
	if !propertyscope.CanViewAll(tenantContext) {
		metadataSQL += " - 'commission_percentage' - 'commissionPercentage'"
	}

	return `case
		when ` + hiddenActivityPropertySQL(propertyVisibleSQL) + ` then
			` + metadataSQL + `
				- 'property_id' - 'propertyId'
				- 'interest_property_id' - 'interestPropertyId'
				- 'property_title' - 'propertyTitle'
				- 'property_code' - 'propertyCode'
				- 'property_price' - 'propertyPrice'
				- 'property_image' - 'propertyImage'
				- 'property_images' - 'propertyImages'
				- 'property_media' - 'propertyMedia'
				- 'commission_percentage' - 'commissionPercentage'
		else ` + metadataSQL + `
	end`
}

func activityContentSQL(propertyVisibleSQL string) string {
	return `case
		when ` + hiddenActivityPropertySQL(propertyVisibleSQL) + ` then
			case a.type
				when 'property_selected' then 'Imovel selecionado'
				when 'property_interest_reserved' then 'Imovel de interesse reservado. Revise este atendimento.'
				else 'Atualizacao de imovel registrada'
			end
		else a.content
	end`
}

func hiddenActivityPropertySQL(propertyVisibleSQL string) string {
	return `(not (` + propertyVisibleSQL + `) and (
		` + activityPropertyReferenceSQL() + ` is not null
		or a.type in ('property_selected', 'property_interest_reserved')
		or coalesce(a.metadata, '{}'::jsonb) ?| array[
			'property_title', 'propertyTitle',
			'property_code', 'propertyCode',
			'property_price', 'propertyPrice',
			'property_image', 'propertyImage',
			'property_images', 'propertyImages',
			'property_media', 'propertyMedia',
			'commission_percentage', 'commissionPercentage'
		]
	))`

}

func activityPropertyReferenceSQL() string {
	return `coalesce(
		nullif(btrim(coalesce(a.metadata->>'property_id', '')), ''),
		nullif(btrim(coalesce(a.metadata->>'propertyId', '')), ''),
		nullif(btrim(coalesce(a.metadata->>'interest_property_id', '')), ''),
		nullif(btrim(coalesce(a.metadata->>'interestPropertyId', '')), '')
	)`
}

func activitySelectFields(metadataSQL string, contentSQL string) string {
	return `
		a.id::text,
		a.organization_id::text,
		a.lead_id::text,
		a.user_id::text,
		a.type,
		` + contentSQL + `,
		` + metadataSQL + `::text,
		a.created_at,
		u.id::text,
		u.name,
		l.id::text,
		l.name`
}

func scanActivity(row scanner) (Activity, error) {
	var activity Activity
	var userID, content, userRefID, userName, leadRefID, leadName pgtype.Text
	var metadataJSON string

	if err := row.Scan(
		&activity.ID,
		&activity.OrganizationID,
		&activity.LeadID,
		&userID,
		&activity.Type,
		&content,
		&metadataJSON,
		&activity.CreatedAt,
		&userRefID,
		&userName,
		&leadRefID,
		&leadName,
	); err != nil {
		if err == pgx.ErrNoRows {
			return Activity{}, ErrInvalidReference
		}
		return Activity{}, err
	}

	activity.UserID = textPtr(userID)
	activity.Content = textPtr(content)
	activity.Metadata = map[string]any{}
	if strings.TrimSpace(metadataJSON) != "" {
		if err := json.Unmarshal([]byte(metadataJSON), &activity.Metadata); err != nil {
			return Activity{}, err
		}
	}
	redactLeadHistoryAttachmentURLs(activity.Metadata)
	if userRefID.Valid {
		activity.User = &ActivityUser{
			ID:   userRefID.String,
			Name: textValue(userName),
		}
	}
	if leadRefID.Valid {
		activity.Lead = &ActivityLead{
			ID:   leadRefID.String,
			Name: textValue(leadName),
		}
	}

	return activity, nil
}

func scanLeadMeta(row scanner) (LeadMeta, error) {
	var meta LeadMeta
	var pageID, formID, adID, adsetID, campaignID pgtype.Text
	var adName, adsetName, campaignName, platform pgtype.Text
	var utmSource, utmMedium, utmCampaign, utmContent, utmTerm pgtype.Text
	var formName, sourceType, contactNotes pgtype.Text
	var creativeURL, creativeVideoURL, creativeInstagramURL pgtype.Text
	var rawPayloadJSON string

	if err := row.Scan(
		&meta.ID,
		&meta.LeadID,
		&pageID,
		&formID,
		&adID,
		&adsetID,
		&campaignID,
		&adName,
		&adsetName,
		&campaignName,
		&platform,
		&rawPayloadJSON,
		&meta.CreatedAt,
		&utmSource,
		&utmMedium,
		&utmCampaign,
		&utmContent,
		&utmTerm,
		&formName,
		&sourceType,
		&contactNotes,
		&creativeURL,
		&creativeVideoURL,
		&creativeInstagramURL,
	); err != nil {
		if err == pgx.ErrNoRows {
			return LeadMeta{}, ErrInvalidReference
		}
		return LeadMeta{}, err
	}

	meta.PageID = textPtr(pageID)
	meta.FormID = textPtr(formID)
	meta.AdID = textPtr(adID)
	meta.AdsetID = textPtr(adsetID)
	meta.CampaignID = textPtr(campaignID)
	meta.AdName = textPtr(adName)
	meta.AdsetName = textPtr(adsetName)
	meta.CampaignName = textPtr(campaignName)
	meta.Platform = textPtr(platform)
	meta.UTMSource = textPtr(utmSource)
	meta.UTMMedium = textPtr(utmMedium)
	meta.UTMCampaign = textPtr(utmCampaign)
	meta.UTMContent = textPtr(utmContent)
	meta.UTMTerm = textPtr(utmTerm)
	meta.FormName = textPtr(formName)
	meta.SourceType = textPtr(sourceType)
	meta.ContactNotes = textPtr(contactNotes)
	meta.CreativeURL = textPtr(creativeURL)
	meta.CreativeVideoURL = textPtr(creativeVideoURL)
	meta.CreativeInstagramURL = textPtr(creativeInstagramURL)
	meta.RawPayload = map[string]any{}
	if strings.TrimSpace(rawPayloadJSON) != "" {
		if err := json.Unmarshal([]byte(rawPayloadJSON), &meta.RawPayload); err != nil {
			return LeadMeta{}, err
		}
	}

	return meta, nil
}
