package leads

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type ContactTag struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

type Contact struct {
	ID                     string       `json:"id"`
	Name                   string       `json:"name"`
	Phone                  *string      `json:"phone"`
	Email                  *string      `json:"email"`
	WhatsAppAvatarURL      *string      `json:"whatsapp_avatar_url"`
	PipelineID             *string      `json:"pipeline_id"`
	PipelineName           *string      `json:"pipeline_name"`
	StageID                *string      `json:"stage_id"`
	StageName              *string      `json:"stage_name"`
	StageColor             *string      `json:"stage_color"`
	AssignedUserID         *string      `json:"assigned_user_id"`
	AssigneeName           *string      `json:"assignee_name"`
	AssigneeAvatar         *string      `json:"assignee_avatar"`
	Source                 string       `json:"source"`
	CreatedAt              time.Time    `json:"created_at"`
	SLAStatus              *string      `json:"sla_status"`
	LastInteractionAt      *time.Time   `json:"last_interaction_at"`
	LastInteractionPreview *string      `json:"last_interaction_preview"`
	LastInteractionChannel *string      `json:"last_interaction_channel"`
	Tags                   []ContactTag `json:"tags"`
	TotalCount             int64        `json:"total_count"`
	DealStatus             *string      `json:"deal_status"`
	LostReason             *string      `json:"lost_reason"`
	LastEntryAt            *time.Time   `json:"last_entry_at"`
	ReentryCount           int          `json:"reentry_count"`
}

type ContactListFilter struct {
	Search      string
	TeamID      string
	PipelineID  string
	StageID     string
	AssigneeID  string
	Unassigned  bool
	TagID       string
	Source      string
	CampaignID  string
	AdSetID     string
	AdID        string
	DealStatus  string
	CreatedFrom string
	CreatedTo   string
	SortBy      string
	SortDir     string
	Page        int
	Limit       int
}

type Tag struct {
	ID             string    `json:"id"`
	Name           string    `json:"name"`
	Color          string    `json:"color"`
	Description    *string   `json:"description"`
	OrganizationID string    `json:"organization_id"`
	CreatedAt      time.Time `json:"created_at"`
	LeadCount      int64     `json:"lead_count"`
}

type TagMutationRequest struct {
	Name        string  `json:"name"`
	Color       string  `json:"color"`
	Description *string `json:"description"`
}

type tagMutationInput struct {
	Name        string
	Color       string
	Description *string
}

type LeadTask struct {
	ID           string     `json:"id"`
	LeadID       string     `json:"lead_id"`
	DayOffset    int        `json:"day_offset"`
	Type         *string    `json:"type"`
	Title        string     `json:"title"`
	Description  *string    `json:"description"`
	DueDate      *time.Time `json:"due_date"`
	IsDone       *bool      `json:"is_done"`
	DoneAt       *time.Time `json:"done_at"`
	DoneBy       *string    `json:"done_by"`
	Outcome      *string    `json:"outcome"`
	OutcomeNotes *string    `json:"outcome_notes"`
	CreatedAt    time.Time  `json:"created_at"`
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

type LeadAttachment struct {
	ID        string    `json:"id"`
	LeadID    string    `json:"lead_id"`
	FileName  string    `json:"file_name"`
	FileURL   string    `json:"file_url"`
	FileType  *string   `json:"file_type"`
	FileSize  *int64    `json:"file_size"`
	CreatedAt time.Time `json:"created_at"`
	CreatedBy *string   `json:"created_by"`
	MessageID *string   `json:"message_id"`
}

type LeadAttachmentCreateRequest struct {
	LeadID    string  `json:"lead_id"`
	FileName  string  `json:"file_name"`
	FileURL   string  `json:"file_url"`
	FileType  *string `json:"file_type"`
	FileSize  *int64  `json:"file_size"`
	MessageID *string `json:"message_id"`
}

type leadAttachmentCreateInput struct {
	LeadID    string
	FileName  string
	FileURL   string
	FileType  *string
	FileSize  *int64
	MessageID *string
}

type leadAttachmentColumns struct {
	OrganizationID bool
	CreatedBy      bool
	UploadedBy     bool
	FileType       bool
	FileURL        bool
	PublicURL      bool
	FileSize       bool
	MessageID      bool
	StorageBucket  bool
	StoragePath    bool
	Metadata       bool
}

type LeadTaskCreateRequest struct {
	LeadID      string  `json:"lead_id"`
	DayOffset   int     `json:"day_offset"`
	Type        string  `json:"type"`
	Title       string  `json:"title"`
	Description *string `json:"description"`
	DueDate     *string `json:"due_date"`
}

type leadTaskCreateInput struct {
	LeadID      string
	DayOffset   int
	Type        string
	Title       string
	Description *string
	DueDate     *time.Time
}

type LeadTaskPatchRequest struct {
	IsDone       *bool   `json:"is_done"`
	Outcome      *string `json:"outcome"`
	OutcomeNotes *string `json:"outcome_notes"`
	LeadID       string  `json:"leadId"`
}

type CompleteCadenceTaskRequest struct {
	LeadID         string  `json:"leadId"`
	TemplateTaskID string  `json:"templateTaskId"`
	DayOffset      int     `json:"dayOffset"`
	Type           string  `json:"type"`
	Title          string  `json:"title"`
	Description    *string `json:"description"`
	Outcome        *string `json:"outcome"`
	OutcomeNotes   *string `json:"outcomeNotes"`
}

type Notification struct {
	ID             string    `json:"id"`
	UserID         string    `json:"user_id"`
	OrganizationID string    `json:"organization_id"`
	Title          string    `json:"title"`
	Content        *string   `json:"content"`
	Type           string         `json:"type"`
	IsRead         bool           `json:"is_read"`
	LeadID         *string        `json:"lead_id"`
	Metadata       map[string]any `json:"metadata"`
	CreatedAt      time.Time      `json:"created_at"`
}

type CreateNotificationRequest struct {
	UserID         string  `json:"user_id"`
	OrganizationID string  `json:"organization_id"`
	Title          string  `json:"title"`
	Content        *string        `json:"content"`
	Type           string         `json:"type"`
	LeadID         *string        `json:"lead_id"`
	Metadata       map[string]any `json:"metadata"`
}

type LeadVisibility struct {
	CanViewAll    bool     `json:"canViewAll"`
	TeamMemberIDs []string `json:"teamMemberIds,omitempty"`
	UserID        string   `json:"userId,omitempty"`
}

func ParseContactListFilter(values url.Values) (ContactListFilter, error) {
	limit, err := parseBoundedInt(values.Get("limit"), 25, 1, 500)
	if err != nil {
		return ContactListFilter{}, err
	}

	page, err := parseBoundedInt(values.Get("page"), 1, 1, 10_000)
	if err != nil {
		return ContactListFilter{}, err
	}

	filter := ContactListFilter{
		Search:      trimMax(cleanContactFilterValue(values.Get("search")), 100),
		TeamID:      cleanContactFilterValue(values.Get("teamId")),
		PipelineID:  cleanContactFilterValue(values.Get("pipelineId")),
		StageID:     cleanContactFilterValue(values.Get("stageId")),
		AssigneeID:  cleanContactFilterValue(values.Get("assigneeId")),
		Unassigned:  strings.EqualFold(values.Get("unassigned"), "true"),
		TagID:       cleanContactFilterValue(values.Get("tagId")),
		Source:      trimMax(cleanContactFilterValue(values.Get("source")), 80),
		CampaignID:  trimMax(cleanContactFilterValue(values.Get("campaignId")), 120),
		AdSetID:     trimMax(cleanContactFilterValue(values.Get("adSetId")), 120),
		AdID:        trimMax(cleanContactFilterValue(values.Get("adId")), 120),
		DealStatus:  cleanContactFilterValue(values.Get("dealStatus")),
		CreatedFrom: cleanContactFilterValue(values.Get("createdFrom")),
		CreatedTo:   cleanContactFilterValue(values.Get("createdTo")),
		SortBy:      cleanContactFilterValue(values.Get("sortBy")),
		SortDir:     cleanContactFilterValue(values.Get("sortDir")),
		Page:        page,
		Limit:       limit,
	}

	for _, item := range []struct {
		name  string
		value string
	}{
		{name: "teamId", value: filter.TeamID},
		{name: "pipelineId", value: filter.PipelineID},
		{name: "stageId", value: filter.StageID},
		{name: "assigneeId", value: filter.AssigneeID},
		{name: "tagId", value: filter.TagID},
	} {
		if item.value != "" && !isUUID(item.value) {
			return ContactListFilter{}, fmt.Errorf("%w: %s is invalid", ErrInvalidInput, item.name)
		}
	}

	if filter.DealStatus != "" && !validEnum(filter.DealStatus, "open", "won", "lost") {
		return ContactListFilter{}, fmt.Errorf("%w: dealStatus is invalid", ErrInvalidInput)
	}
	if filter.SortBy == "" {
		filter.SortBy = "created_at"
	}
	if !validEnum(filter.SortBy, "created_at", "name", "last_interaction_at", "stage") {
		return ContactListFilter{}, fmt.Errorf("%w: sortBy is invalid", ErrInvalidInput)
	}
	if filter.SortDir == "" {
		filter.SortDir = "desc"
	}
	if !validEnum(filter.SortDir, "asc", "desc") {
		return ContactListFilter{}, fmt.Errorf("%w: sortDir is invalid", ErrInvalidInput)
	}

	return filter, nil
}

func cleanContactFilterValue(value string) string {
	value = strings.TrimSpace(value)
	switch strings.ToLower(value) {
	case "", "all", "__all__", "none", "__none__", "null", "undefined":
		return ""
	default:
		return value
	}
}

func (request TagMutationRequest) Validate() (tagMutationInput, error) {
	input := tagMutationInput{
		Name:        trimMax(request.Name, 80),
		Color:       trimMax(request.Color, 40),
		Description: optionalStringFromPointer(request.Description, 300),
	}
	if input.Name == "" {
		return tagMutationInput{}, fmt.Errorf("%w: name is required", ErrInvalidInput)
	}
	if input.Color == "" {
		input.Color = "#64748b"
	}
	return input, nil
}

func (request ActivityCreateRequest) Validate() (activityCreateInput, error) {
	leadID, ok := normalizeUUID(request.LeadID)
	if !ok {
		return activityCreateInput{}, fmt.Errorf("%w: lead_id is invalid", ErrInvalidInput)
	}

	activityType := trimMax(request.Type, 80)
	if activityType == "" {
		return activityCreateInput{}, fmt.Errorf("%w: type is required", ErrInvalidInput)
	}

	metadata := request.Metadata
	if metadata == nil {
		metadata = map[string]any{}
	}

	return activityCreateInput{
		LeadID:   leadID,
		Type:     activityType,
		Content:  optionalStringFromPointer(request.Content, 2_000),
		Metadata: metadata,
	}, nil
}

func (request LeadAttachmentCreateRequest) Validate() (leadAttachmentCreateInput, error) {
	leadID, ok := normalizeUUID(request.LeadID)
	if !ok {
		return leadAttachmentCreateInput{}, fmt.Errorf("%w: lead_id is invalid", ErrInvalidInput)
	}

	fileName := trimMax(request.FileName, 240)
	if fileName == "" {
		return leadAttachmentCreateInput{}, fmt.Errorf("%w: file_name is required", ErrInvalidInput)
	}

	fileURL := trimMax(request.FileURL, 2_000)
	if fileURL == "" {
		return leadAttachmentCreateInput{}, fmt.Errorf("%w: file_url is required", ErrInvalidInput)
	}

	var messageID *string
	if request.MessageID != nil && strings.TrimSpace(*request.MessageID) != "" {
		value, ok := normalizeUUID(*request.MessageID)
		if !ok {
			return leadAttachmentCreateInput{}, fmt.Errorf("%w: message_id is invalid", ErrInvalidInput)
		}
		messageID = &value
	}

	return leadAttachmentCreateInput{
		LeadID:    leadID,
		FileName:  fileName,
		FileURL:   fileURL,
		FileType:  optionalStringFromPointer(request.FileType, 120),
		FileSize:  request.FileSize,
		MessageID: messageID,
	}, nil
}

func (request LeadTaskCreateRequest) Validate() (leadTaskCreateInput, error) {
	leadID, ok := normalizeUUID(request.LeadID)
	if !ok {
		return leadTaskCreateInput{}, fmt.Errorf("%w: lead_id is invalid", ErrInvalidInput)
	}
	input := leadTaskCreateInput{
		LeadID:      leadID,
		DayOffset:   request.DayOffset,
		Type:        trimMax(request.Type, 40),
		Title:       trimMax(request.Title, 180),
		Description: optionalStringFromPointer(request.Description, 1_000),
	}
	if input.Title == "" {
		return leadTaskCreateInput{}, fmt.Errorf("%w: title is required", ErrInvalidInput)
	}
	if input.Type == "" {
		input.Type = "note"
	}
	if request.DueDate != nil && strings.TrimSpace(*request.DueDate) != "" {
		parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(*request.DueDate))
		if err != nil {
			return leadTaskCreateInput{}, fmt.Errorf("%w: due_date is invalid", ErrInvalidInput)
		}
		input.DueDate = &parsed
	}
	return input, nil
}

func (request CompleteCadenceTaskRequest) Validate() (CompleteCadenceTaskRequest, error) {
	leadID, ok := normalizeUUID(request.LeadID)
	if !ok {
		return CompleteCadenceTaskRequest{}, fmt.Errorf("%w: leadId is invalid", ErrInvalidInput)
	}
	request.LeadID = leadID
	request.TemplateTaskID = trimMax(request.TemplateTaskID, 120)
	request.Type = trimMax(request.Type, 40)
	request.Title = trimMax(request.Title, 180)
	request.Description = optionalStringFromPointer(request.Description, 1_000)
	request.Outcome = optionalStringFromPointer(request.Outcome, 120)
	request.OutcomeNotes = optionalStringFromPointer(request.OutcomeNotes, 1_000)
	if request.Title == "" {
		return CompleteCadenceTaskRequest{}, fmt.Errorf("%w: title is required", ErrInvalidInput)
	}
	if request.Type == "" {
		request.Type = "note"
	}
	return request, nil
}

func (repo Repository) ListContacts(ctx context.Context, tenantContext tenant.Context, filter ContactListFilter) ([]Contact, error) {
	where, args, err := buildContactWhere(tenantContext, filter)
	if err != nil {
		return nil, err
	}

	offset := (filter.Page - 1) * filter.Limit
	args = append(args, filter.Limit, offset)
	limitIndex := len(args) - 1
	offsetIndex := len(args)

	rows, err := repo.db.Pool().Query(ctx, `
		select
			count(*) over() as total_count,
			l.id::text,
			l.name,
			l.phone,
			l.email,
			l.whatsapp_avatar_url,
			l.pipeline_id::text,
			p.name,
			l.stage_id::text,
			s.name,
			s.color,
			l.assigned_user_id::text,
			u.name,
			u.avatar_url,
			l.source,
			l.created_at,
			null::text as sla_status,
			l.last_entry_at,
			null::text as last_interaction_preview,
			null::text as last_interaction_channel,
			coalesce(tags.tags, '[]'::json)::text,
			l.deal_status,
			l.lost_reason,
			l.last_entry_at,
			l.reentry_count
		from public.leads l
		left join public.pipelines p on p.id = l.pipeline_id and p.organization_id = l.organization_id
		left join public.stages s on s.id = l.stage_id and s.organization_id = l.organization_id
		left join public.users u on u.id = l.assigned_user_id
		left join lateral (
			select json_agg(json_build_object('id', t.id::text, 'name', t.name, 'color', t.color) order by t.name) as tags
			from public.lead_tags lt
			join public.tags t on t.id = lt.tag_id
			where lt.lead_id = l.id
			  and t.organization_id = l.organization_id
		) tags on true
		where `+strings.Join(where, " and ")+`
		`+contactOrderBy(filter)+`
		limit $`+fmt.Sprint(limitIndex)+`
		offset $`+fmt.Sprint(offsetIndex),
		args...,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	contacts := make([]Contact, 0, filter.Limit)
	for rows.Next() {
		contact, err := scanContact(rows)
		if err != nil {
			return nil, err
		}
		contacts = append(contacts, contact)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return contacts, nil
}

func (repo Repository) ListTags(ctx context.Context, tenantContext tenant.Context) ([]Tag, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		select
			t.id::text,
			t.name,
			t.color,
			null::text as description,
			t.organization_id::text,
			t.created_at,
			count(distinct l.id)::bigint as lead_count
		from public.tags t
		left join public.lead_tags lt on lt.tag_id = t.id
		left join public.leads l on l.id = lt.lead_id and l.organization_id = t.organization_id
		where t.organization_id = $1::uuid
		group by t.id, t.name, t.color, t.organization_id, t.created_at
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
	if !canManageLeads(tenantContext) {
		return Tag{}, tenant.ErrOrganizationAccessDenied
	}
	return scanTag(repo.db.Pool().QueryRow(ctx, `
		insert into public.tags (organization_id, name, color)
		values ($1::uuid, $2, $3)
		returning id::text, name, color, null::text, organization_id::text, created_at, 0::bigint
	`, tenantContext.OrganizationID, input.Name, input.Color))
}

func (repo Repository) UpdateTag(ctx context.Context, tenantContext tenant.Context, tagID string, input tagMutationInput) (Tag, error) {
	if !canManageLeads(tenantContext) {
		return Tag{}, tenant.ErrOrganizationAccessDenied
	}
	tagID, ok := normalizeUUID(tagID)
	if !ok {
		return Tag{}, ErrInvalidInput
	}
	return scanTag(repo.db.Pool().QueryRow(ctx, `
		update public.tags
		set name = $3, color = $4
		where id = $1::uuid and organization_id = $2::uuid
		returning id::text, name, color, null::text, organization_id::text, created_at,
			(select count(*)::bigint from public.lead_tags lt where lt.tag_id = public.tags.id)
	`, tagID, tenantContext.OrganizationID, input.Name, input.Color))
}

func (repo Repository) DeleteTag(ctx context.Context, tenantContext tenant.Context, tagID string) error {
	if !canManageLeads(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}
	tagID, ok := normalizeUUID(tagID)
	if !ok {
		return ErrInvalidInput
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		delete from public.lead_tags
		where tag_id = $1::uuid
		  and lead_id in (select id from public.leads where organization_id = $2::uuid)
	`, tagID, tenantContext.OrganizationID); err != nil {
		return err
	}
	result, err := tx.Exec(ctx, `delete from public.tags where id = $1::uuid and organization_id = $2::uuid`, tagID, tenantContext.OrganizationID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return ErrInvalidReference
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
		leadVisibilitySQL("$2", "$3", "$4"),
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
	args = append(args, limit)
	limitIndex := len(args)

	rows, err := repo.db.Pool().Query(ctx, `
		select `+activitySelectFields()+`
		from public.activities a
		join public.leads l on l.id = a.lead_id
		left join public.users u on u.id = a.user_id
		where `+strings.Join(where, " and ")+`
		order by a.created_at desc, a.id desc
		limit $`+fmt.Sprint(limitIndex), args...)
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
	if err := repo.ensureLeadEditable(ctx, tenantContext, input.LeadID); err != nil {
		return Activity{}, err
	}

	return scanActivity(repo.db.Pool().QueryRow(ctx, `
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
		select `+activitySelectFields()+`
		from inserted a
		join public.leads l on l.id = a.lead_id
		left join public.users u on u.id = a.user_id
	`, tenantContext.OrganizationID, input.LeadID, tenantContext.UserID, input.Type, input.Content, jsonb(input.Metadata)))
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
		  and `+leadVisibilitySQL("$2", "$3", "$4")+`
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

func (repo Repository) ListLeadAttachments(ctx context.Context, tenantContext tenant.Context, leadID string) ([]LeadAttachment, error) {
	leadID, ok := normalizeUUID(leadID)
	if !ok {
		return nil, ErrInvalidInput
	}

	columns, err := repo.getLeadAttachmentColumns(ctx)
	if err != nil {
		return nil, err
	}

	where := []string{
		"l.organization_id = $1::uuid",
		"la.lead_id = $5::uuid",
		leadVisibilitySQL("$2", "$3", "$4"),
	}
	if columns.OrganizationID {
		where = append(where, "la.organization_id = $1::uuid")
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select `+leadAttachmentSelectFields(columns)+`
		from public.lead_attachments la
		join public.leads l on l.id = la.lead_id
		where `+strings.Join(where, " and ")+`
		order by la.created_at desc, la.id desc
	`, tenantContext.OrganizationID, canViewAllLeads(tenantContext), tenantContext.UserID, tenantContext.HasPermission("lead_view_team"), leadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	attachments := []LeadAttachment{}
	for rows.Next() {
		attachment, err := scanLeadAttachment(rows)
		if err != nil {
			return nil, err
		}
		attachments = append(attachments, attachment)
	}
	return attachments, rows.Err()
}

func (repo Repository) CreateLeadAttachment(ctx context.Context, tenantContext tenant.Context, input leadAttachmentCreateInput) (LeadAttachment, error) {
	if err := repo.ensureLeadEditable(ctx, tenantContext, input.LeadID); err != nil {
		return LeadAttachment{}, err
	}

	columns, err := repo.getLeadAttachmentColumns(ctx)
	if err != nil {
		return LeadAttachment{}, err
	}

	if input.MessageID != nil && columns.MessageID {
		existingArgs := []any{input.LeadID}
		existingWhere := []string{"la.lead_id = $1::uuid"}
		if columns.OrganizationID {
			existingArgs = append(existingArgs, tenantContext.OrganizationID)
			existingWhere = append(existingWhere, fmt.Sprintf("la.organization_id = $%d::uuid", len(existingArgs)))
		}
		existingArgs = append(existingArgs, *input.MessageID)
		existingWhere = append(existingWhere, fmt.Sprintf("la.message_id = $%d::uuid", len(existingArgs)))

		existing, err := scanLeadAttachment(repo.db.Pool().QueryRow(ctx, `
			select `+leadAttachmentSelectFields(columns)+`
			from public.lead_attachments la
			join public.leads l on l.id = la.lead_id
			where `+strings.Join(existingWhere, " and ")+`
			limit 1
		`, existingArgs...))
		if err == nil {
			return existing, nil
		}
		if err != pgx.ErrNoRows {
			return LeadAttachment{}, err
		}
	}

	insertColumns := []string{}
	values := []string{}
	args := []any{}
	add := func(column string, value any, cast string) {
		args = append(args, value)
		insertColumns = append(insertColumns, column)
		placeholder := fmt.Sprintf("$%d", len(args))
		if cast != "" {
			placeholder += cast
		}
		values = append(values, placeholder)
	}

	if columns.OrganizationID {
		add("organization_id", tenantContext.OrganizationID, "::uuid")
	}
	add("lead_id", input.LeadID, "::uuid")
	if columns.CreatedBy {
		add("created_by", tenantContext.UserID, "::uuid")
	}
	if columns.UploadedBy {
		add("uploaded_by", tenantContext.UserID, "::uuid")
	}
	add("file_name", input.FileName, "")
	if columns.FileType {
		add("file_type", input.FileType, "")
	}
	if columns.FileURL {
		add("file_url", input.FileURL, "")
	}
	if columns.PublicURL {
		add("public_url", input.FileURL, "")
	}
	if columns.FileSize {
		add("file_size", input.FileSize, "")
	}
	if columns.MessageID {
		add("message_id", input.MessageID, "::uuid")
	}
	if columns.StorageBucket {
		add("storage_bucket", "whatsapp-media", "")
	}
	if columns.StoragePath {
		add("storage_path", storagePathFromPublicURL(input.FileURL, input.FileName), "")
	}
	if columns.Metadata {
		metadata := map[string]any{
			"file_url": input.FileURL,
		}
		if input.FileSize != nil {
			metadata["file_size"] = *input.FileSize
		}
		if input.MessageID != nil {
			metadata["message_id"] = *input.MessageID
		}
		add("metadata", jsonb(metadata), "::jsonb")
	}

	attachment, err := scanLeadAttachment(repo.db.Pool().QueryRow(ctx, `
		with inserted as (
			insert into public.lead_attachments (`+strings.Join(insertColumns, ", ")+`)
			values (`+strings.Join(values, ", ")+`)
			returning *
		)
		select `+leadAttachmentSelectFields(columns)+`
		from inserted la
		join public.leads l on l.id = la.lead_id
	`, args...))
	if err != nil {
		return LeadAttachment{}, err
	}

	_, err = repo.db.Pool().Exec(ctx, `
		insert into public.activities (
			organization_id,
			lead_id,
			user_id,
			type,
			content,
			metadata
		)
		values ($1::uuid, $2::uuid, $3::uuid, 'note', $4, $5::jsonb)
	`, tenantContext.OrganizationID, input.LeadID, tenantContext.UserID, "Documento anexado: "+input.FileName, jsonb(map[string]any{
		"file_url":   input.FileURL,
		"file_type":  input.FileType,
		"file_size":  input.FileSize,
		"message_id": input.MessageID,
	}))
	if err != nil {
		return LeadAttachment{}, err
	}

	return attachment, nil
}

func (repo Repository) ListLeadTasks(ctx context.Context, tenantContext tenant.Context, leadID string) ([]LeadTask, error) {
	leadID, ok := normalizeUUID(leadID)
	if !ok {
		return nil, ErrInvalidInput
	}
	if err := repo.ensureLeadVisible(ctx, tenantContext, leadID); err != nil {
		return nil, err
	}
	rows, err := repo.db.Pool().Query(ctx, `
		select id::text, lead_id::text, day_offset, type, title, description, due_date,
			is_done, done_at, done_by::text, outcome, outcome_notes, created_at
		from public.lead_tasks
		where lead_id = $1::uuid
		order by day_offset asc, created_at asc
	`, leadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tasks := []LeadTask{}
	for rows.Next() {
		task, err := scanLeadTask(rows)
		if err != nil {
			return nil, err
		}
		tasks = append(tasks, task)
	}
	return tasks, rows.Err()
}

func (repo Repository) CreateLeadTask(ctx context.Context, tenantContext tenant.Context, input leadTaskCreateInput) (LeadTask, error) {
	if err := repo.ensureLeadEditable(ctx, tenantContext, input.LeadID); err != nil {
		return LeadTask{}, err
	}
	return scanLeadTask(repo.db.Pool().QueryRow(ctx, `
		insert into public.lead_tasks (lead_id, day_offset, type, title, description, due_date)
		values ($1::uuid, $2, $3, $4, $5, $6)
		returning id::text, lead_id::text, day_offset, type, title, description, due_date,
			is_done, done_at, done_by::text, outcome, outcome_notes, created_at
	`, input.LeadID, input.DayOffset, input.Type, input.Title, input.Description, input.DueDate))
}

func (repo Repository) PatchLeadTask(ctx context.Context, tenantContext tenant.Context, taskID string, request LeadTaskPatchRequest) (LeadTask, error) {
	taskID, ok := normalizeUUID(taskID)
	if !ok {
		return LeadTask{}, ErrInvalidInput
	}
	current, err := repo.getTaskLeadID(ctx, taskID)
	if err != nil {
		return LeadTask{}, err
	}
	if err := repo.ensureLeadEditable(ctx, tenantContext, current.LeadID); err != nil {
		return LeadTask{}, err
	}

	var doneAt any
	var doneBy any
	if request.IsDone != nil && *request.IsDone {
		doneAt = time.Now().UTC()
		doneBy = tenantContext.UserID
	} else if request.IsDone != nil {
		doneAt = nil
		doneBy = nil
	}

	task, err := scanLeadTask(repo.db.Pool().QueryRow(ctx, `
		update public.lead_tasks
		set
			is_done = coalesce($2, is_done),
			done_at = case when $2::boolean is null then done_at else $3::timestamptz end,
			done_by = case when $2::boolean is null then done_by else $4::uuid end,
			outcome = coalesce($5, outcome),
			outcome_notes = coalesce($6, outcome_notes)
		where id = $1::uuid
		returning id::text, lead_id::text, day_offset, type, title, description, due_date,
			is_done, done_at, done_by::text, outcome, outcome_notes, created_at
	`, taskID, request.IsDone, doneAt, doneBy, optionalStringFromPointer(request.Outcome, 120), optionalStringFromPointer(request.OutcomeNotes, 1_000)))
	if err != nil {
		return LeadTask{}, err
	}
	if request.IsDone != nil && *request.IsDone {
		_ = repo.insertTaskCompletedActivity(ctx, tenantContext.OrganizationID, current.LeadID, task.ID, task.Type, task.DayOffset, task.Title, tenantContext.UserID, nil, request.Outcome, request.OutcomeNotes)
	}
	return task, nil
}

func (repo Repository) CompleteCadenceTask(ctx context.Context, tenantContext tenant.Context, request CompleteCadenceTaskRequest) (LeadTask, error) {
	if err := repo.ensureLeadEditable(ctx, tenantContext, request.LeadID); err != nil {
		return LeadTask{}, err
	}

	var existingID string
	err := repo.db.Pool().QueryRow(ctx, `
		select id::text
		from public.lead_tasks
		where lead_id = $1::uuid
		  and title = $2
		  and day_offset = $3
		  and coalesce(type, '') = $4
		order by is_done desc nulls last, created_at asc
		limit 1
	`, request.LeadID, request.Title, request.DayOffset, request.Type).Scan(&existingID)
	if err != nil && err != pgx.ErrNoRows {
		return LeadTask{}, err
	}

	var task LeadTask
	if existingID != "" {
		task, err = scanLeadTask(repo.db.Pool().QueryRow(ctx, `
			update public.lead_tasks
			set is_done = true,
				done_at = now(),
				done_by = $2::uuid,
				outcome = coalesce($3, outcome),
				outcome_notes = coalesce($4, outcome_notes)
			where id = $1::uuid
			returning id::text, lead_id::text, day_offset, type, title, description, due_date,
				is_done, done_at, done_by::text, outcome, outcome_notes, created_at
		`, existingID, tenantContext.UserID, request.Outcome, request.OutcomeNotes))
	} else {
		task, err = scanLeadTask(repo.db.Pool().QueryRow(ctx, `
			insert into public.lead_tasks (lead_id, day_offset, type, title, description, is_done, done_at, done_by, outcome, outcome_notes)
			values ($1::uuid, $2, $3, $4, $5, true, now(), $6::uuid, $7, $8)
			returning id::text, lead_id::text, day_offset, type, title, description, due_date,
				is_done, done_at, done_by::text, outcome, outcome_notes, created_at
		`, request.LeadID, request.DayOffset, request.Type, request.Title, request.Description, tenantContext.UserID, request.Outcome, request.OutcomeNotes))
	}
	if err != nil {
		return LeadTask{}, err
	}
	_ = repo.insertTaskCompletedActivity(ctx, tenantContext.OrganizationID, request.LeadID, task.ID, task.Type, task.DayOffset, task.Title, tenantContext.UserID, &request.TemplateTaskID, request.Outcome, request.OutcomeNotes)
	return task, nil
}

func (repo Repository) ListNotifications(ctx context.Context, tenantContext tenant.Context, userID string, limit int) ([]Notification, error) {
	if userID == "" {
		userID = tenantContext.UserID
	}
	if userID != tenantContext.UserID && !canManageLeads(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	limit = max(1, min(limit, 100))
	rows, err := repo.db.Pool().Query(ctx, `
		select id::text, user_id::text, organization_id::text, title, content, type, coalesce(is_read, false), lead_id::text, coalesce(metadata, '{}'::jsonb)::text, created_at
		from public.notifications
		where organization_id = $1::uuid and user_id = $2::uuid
		order by created_at desc
		limit $3
	`, tenantContext.OrganizationID, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	notifications := []Notification{}
	for rows.Next() {
		notification, err := scanNotification(rows)
		if err != nil {
			return nil, err
		}
		notifications = append(notifications, notification)
	}
	return notifications, rows.Err()
}

func (repo Repository) CountUnreadNotifications(ctx context.Context, tenantContext tenant.Context, userID string) (int64, error) {
	if userID == "" {
		userID = tenantContext.UserID
	}
	if userID != tenantContext.UserID && !canManageLeads(tenantContext) {
		return 0, tenant.ErrOrganizationAccessDenied
	}
	var count int64
	err := repo.db.Pool().QueryRow(ctx, `
		select count(*)::bigint
		from public.notifications
		where organization_id = $1::uuid
		  and user_id = $2::uuid
		  and coalesce(is_read, false) = false
	`, tenantContext.OrganizationID, userID).Scan(&count)
	return count, err
}

func (repo Repository) MarkNotificationRead(ctx context.Context, tenantContext tenant.Context, id string) error {
	id, ok := normalizeUUID(id)
	if !ok {
		return ErrInvalidInput
	}
	result, err := repo.db.Pool().Exec(ctx, `
		update public.notifications
		set is_read = true
		where id = $1::uuid
		  and organization_id = $2::uuid
		  and user_id = $3::uuid
	`, id, tenantContext.OrganizationID, tenantContext.UserID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return ErrInvalidReference
	}
	return nil
}

func (repo Repository) MarkAllNotificationsRead(ctx context.Context, tenantContext tenant.Context) error {
	_, err := repo.db.Pool().Exec(ctx, `
		update public.notifications
		set is_read = true
		where organization_id = $1::uuid
		  and user_id = $2::uuid
		  and coalesce(is_read, false) = false
	`, tenantContext.OrganizationID, tenantContext.UserID)
	return err
}

func (repo Repository) CreateNotification(ctx context.Context, tenantContext tenant.Context, request CreateNotificationRequest) (Notification, error) {
	if !canManageLeads(tenantContext) {
		return Notification{}, tenant.ErrOrganizationAccessDenied
	}
	userID, ok := normalizeUUID(request.UserID)
	if !ok {
		return Notification{}, ErrInvalidInput
	}
	organizationID := tenantContext.OrganizationID
	if request.OrganizationID != "" && request.OrganizationID != organizationID {
		return Notification{}, tenant.ErrOrganizationAccessDenied
	}
	title := trimMax(request.Title, 180)
	if title == "" {
		return Notification{}, ErrInvalidInput
	}
	notificationType := trimMax(request.Type, 40)
	if notificationType == "" {
		notificationType = "info"
	}
	metadata := request.Metadata
	if metadata == nil {
		metadata = map[string]any{}
	}
	return scanNotification(repo.db.Pool().QueryRow(ctx, `
		insert into public.notifications (user_id, organization_id, title, content, type, lead_id, is_read, metadata)
		values ($1::uuid, $2::uuid, $3, $4, $5, $6, false, $7::jsonb)
		returning id::text, user_id::text, organization_id::text, title, content, type, coalesce(is_read, false), lead_id::text, coalesce(metadata, '{}'::jsonb)::text, created_at
	`, userID, organizationID, title, optionalStringFromPointer(request.Content, 1_000), notificationType, request.LeadID, jsonb(metadata)))
}

func (repo Repository) GetLeadVisibility(ctx context.Context, tenantContext tenant.Context) (LeadVisibility, error) {
	if canViewAllLeads(tenantContext) {
		return LeadVisibility{CanViewAll: true}, nil
	}

	if tenantContext.HasPermission("lead_view_team") {
		rows, err := repo.db.Pool().Query(ctx, `
			select distinct member.user_id::text
			from public.team_members leader
			join public.team_members member
			  on member.organization_id = leader.organization_id
			 and member.team_id = leader.team_id
			 and member.is_active = true
			where leader.organization_id = $1::uuid
			  and leader.user_id = $2::uuid
			  and leader.is_active = true
			  and leader.is_leader = true
			order by member.user_id::text
		`, tenantContext.OrganizationID, tenantContext.UserID)
		if err != nil {
			return LeadVisibility{}, err
		}
		defer rows.Close()

		memberIDs := []string{tenantContext.UserID}
		seen := map[string]bool{tenantContext.UserID: true}
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				return LeadVisibility{}, err
			}
			if !seen[id] {
				memberIDs = append(memberIDs, id)
				seen[id] = true
			}
		}
		if err := rows.Err(); err != nil {
			return LeadVisibility{}, err
		}
		if len(memberIDs) > 1 {
			return LeadVisibility{CanViewAll: false, TeamMemberIDs: memberIDs}, nil
		}
	}

	return LeadVisibility{CanViewAll: false, UserID: tenantContext.UserID}, nil
}

func buildContactWhere(tenantContext tenant.Context, filter ContactListFilter) ([]string, []any, error) {
	args := []any{
		tenantContext.OrganizationID,
		canViewAllLeads(tenantContext),
		tenantContext.UserID,
		tenantContext.HasPermission("lead_view_team"),
	}
	where := []string{
		"l.organization_id = $1::uuid",
		leadVisibilitySQL("$2", "$3", "$4"),
	}

	add := func(clause string, value any) {
		args = append(args, value)
		where = append(where, fmt.Sprintf(clause, len(args)))
	}

	if filter.Search != "" {
		args = append(args, "%"+filter.Search+"%")
		index := len(args)
		where = append(where, fmt.Sprintf("(l.name ilike $%d or l.phone ilike $%d or l.email ilike $%d)", index, index, index))
	}
	if filter.TeamID != "" {
		add(`exists (
			select 1 from public.team_members tm
			where tm.team_id = $%d::uuid
			  and tm.user_id = l.assigned_user_id
		)`, filter.TeamID)
	}
	if filter.PipelineID != "" {
		add("l.pipeline_id = $%d::uuid", filter.PipelineID)
	}
	if filter.StageID != "" {
		add("l.stage_id = $%d::uuid", filter.StageID)
	}
	if filter.Unassigned {
		where = append(where, "l.assigned_user_id is null")
	} else if filter.AssigneeID != "" {
		add("l.assigned_user_id = $%d::uuid", filter.AssigneeID)
	}
	if filter.TagID != "" {
		add(`exists (
			select 1 from public.lead_tags lt
			where lt.lead_id = l.id
			  and lt.tag_id = $%d::uuid
		)`, filter.TagID)
	}
	if filter.Source != "" {
		add("l.source = $%d", filter.Source)
	}
	if filter.DealStatus != "" {
		add("l.deal_status = $%d", filter.DealStatus)
	}
	if filter.CreatedFrom != "" {
		add("l.created_at >= $%d::timestamptz", filter.CreatedFrom)
	}
	if filter.CreatedTo != "" {
		add("l.created_at <= $%d::timestamptz", filter.CreatedTo)
	}
	addMeta := func(columnID string, columnName string, value string) {
		if value == "" {
			return
		}
		args = append(args, value)
		index := len(args)
		where = append(where, fmt.Sprintf(`exists (
			select 1 from public.lead_meta lm
			where lm.organization_id = l.organization_id
			  and lm.lead_id = l.id
			  and (lm.%s = $%d or lm.%s = $%d)
		)`, columnID, index, columnName, index))
	}
	addMeta("campaign_id", "campaign_name", filter.CampaignID)
	addMeta("adset_id", "adset_name", filter.AdSetID)
	addMeta("ad_id", "ad_name", filter.AdID)

	return where, args, nil
}

func contactOrderBy(filter ContactListFilter) string {
	direction := "desc"
	if filter.SortDir == "asc" {
		direction = "asc"
	}
	switch filter.SortBy {
	case "name":
		return "order by l.name " + direction + ", l.id desc"
	case "last_interaction_at":
		return "order by coalesce(l.last_entry_at, l.updated_at, l.created_at) " + direction + ", l.id desc"
	case "stage":
		return "order by s.position " + direction + " nulls last, l.created_at desc, l.id desc"
	default:
		return "order by l.created_at " + direction + ", l.id desc"
	}
}

func scanContact(row scanner) (Contact, error) {
	var contact Contact
	var phone, email, avatar, pipelineID, pipelineName, stageID, stageName, stageColor pgtype.Text
	var assignedUserID, assigneeName, assigneeAvatar, slaStatus, preview, channel pgtype.Text
	var dealStatus, lostReason pgtype.Text
	var lastInteraction, lastEntry pgtype.Timestamptz
	var tagsJSON string
	if err := row.Scan(
		&contact.TotalCount,
		&contact.ID,
		&contact.Name,
		&phone,
		&email,
		&avatar,
		&pipelineID,
		&pipelineName,
		&stageID,
		&stageName,
		&stageColor,
		&assignedUserID,
		&assigneeName,
		&assigneeAvatar,
		&contact.Source,
		&contact.CreatedAt,
		&slaStatus,
		&lastInteraction,
		&preview,
		&channel,
		&tagsJSON,
		&dealStatus,
		&lostReason,
		&lastEntry,
		&contact.ReentryCount,
	); err != nil {
		return Contact{}, err
	}
	contact.Phone = textPtr(phone)
	contact.Email = textPtr(email)
	contact.WhatsAppAvatarURL = textPtr(avatar)
	contact.PipelineID = textPtr(pipelineID)
	contact.PipelineName = textPtr(pipelineName)
	contact.StageID = textPtr(stageID)
	contact.StageName = textPtr(stageName)
	contact.StageColor = textPtr(stageColor)
	contact.AssignedUserID = textPtr(assignedUserID)
	contact.AssigneeName = textPtr(assigneeName)
	contact.AssigneeAvatar = textPtr(assigneeAvatar)
	contact.SLAStatus = textPtr(slaStatus)
	contact.LastInteractionAt = timePtr(lastInteraction)
	contact.LastInteractionPreview = textPtr(preview)
	contact.LastInteractionChannel = textPtr(channel)
	contact.DealStatus = textPtr(dealStatus)
	contact.LostReason = textPtr(lostReason)
	contact.LastEntryAt = timePtr(lastEntry)
	contact.Tags = []ContactTag{}
	if strings.TrimSpace(tagsJSON) != "" {
		_ = json.Unmarshal([]byte(tagsJSON), &contact.Tags)
	}
	return contact, nil
}

func scanTag(row scanner) (Tag, error) {
	var tag Tag
	var description pgtype.Text
	if err := row.Scan(&tag.ID, &tag.Name, &tag.Color, &description, &tag.OrganizationID, &tag.CreatedAt, &tag.LeadCount); err != nil {
		if err == pgx.ErrNoRows {
			return Tag{}, ErrInvalidReference
		}
		return Tag{}, err
	}
	tag.Description = textPtr(description)
	return tag, nil
}

func activitySelectFields() string {
	return `
		a.id::text,
		a.organization_id::text,
		a.lead_id::text,
		a.user_id::text,
		a.type,
		a.content,
		coalesce(a.metadata, '{}'::jsonb)::text,
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

func leadAttachmentSelectFields(columns leadAttachmentColumns) string {
	fileTypeExpression := "null::text"
	if columns.FileType {
		fileTypeExpression = "la.file_type"
	}

	fileURLExpression := "null::text"
	if columns.FileURL {
		fileURLExpression = "la.file_url"
	} else if columns.PublicURL {
		fileURLExpression = "la.public_url"
	}

	fileSizeExpression := "null::bigint"
	if columns.FileSize {
		fileSizeExpression = "la.file_size::bigint"
	} else if columns.Metadata {
		fileSizeExpression = "case when (la.metadata->>'file_size') ~ '^[0-9]+$' then (la.metadata->>'file_size')::bigint else null::bigint end"
	}

	createdByExpression := "null::text"
	if columns.CreatedBy {
		createdByExpression = "la.created_by::text"
	} else if columns.UploadedBy {
		createdByExpression = "la.uploaded_by::text"
	}

	messageIDExpression := "null::text"
	if columns.MessageID {
		messageIDExpression = "la.message_id::text"
	} else if columns.Metadata {
		messageIDExpression = "la.metadata->>'message_id'"
	}

	return `
		la.id::text,
		la.lead_id::text,
		la.file_name,
		coalesce(` + fileURLExpression + `, ''),
		` + fileTypeExpression + `,
		` + fileSizeExpression + `,
		` + createdByExpression + `,
		` + messageIDExpression + `,
		la.created_at`
}

func scanLeadAttachment(row scanner) (LeadAttachment, error) {
	var attachment LeadAttachment
	var fileType, createdBy, messageID pgtype.Text
	var fileSize pgtype.Int8

	if err := row.Scan(
		&attachment.ID,
		&attachment.LeadID,
		&attachment.FileName,
		&attachment.FileURL,
		&fileType,
		&fileSize,
		&createdBy,
		&messageID,
		&attachment.CreatedAt,
	); err != nil {
		if err == pgx.ErrNoRows {
			return LeadAttachment{}, ErrInvalidReference
		}
		return LeadAttachment{}, err
	}

	attachment.FileType = textPtr(fileType)
	attachment.CreatedBy = textPtr(createdBy)
	attachment.MessageID = textPtr(messageID)
	if fileSize.Valid {
		attachment.FileSize = &fileSize.Int64
	}

	return attachment, nil
}

func scanLeadTask(row scanner) (LeadTask, error) {
	var task LeadTask
	var taskType, description, doneBy, outcome, outcomeNotes pgtype.Text
	var dueDate, doneAt pgtype.Timestamptz
	var isDone pgtype.Bool
	if err := row.Scan(
		&task.ID,
		&task.LeadID,
		&task.DayOffset,
		&taskType,
		&task.Title,
		&description,
		&dueDate,
		&isDone,
		&doneAt,
		&doneBy,
		&outcome,
		&outcomeNotes,
		&task.CreatedAt,
	); err != nil {
		if err == pgx.ErrNoRows {
			return LeadTask{}, ErrInvalidReference
		}
		return LeadTask{}, err
	}
	task.Type = textPtr(taskType)
	task.Description = textPtr(description)
	task.DueDate = timePtr(dueDate)
	task.IsDone = boolPtr(isDone)
	task.DoneAt = timePtr(doneAt)
	task.DoneBy = textPtr(doneBy)
	task.Outcome = textPtr(outcome)
	task.OutcomeNotes = textPtr(outcomeNotes)
	return task, nil
}

func scanNotification(row scanner) (Notification, error) {
	var notification Notification
	var content, leadID, metadataRaw pgtype.Text
	if err := row.Scan(
		&notification.ID,
		&notification.UserID,
		&notification.OrganizationID,
		&notification.Title,
		&content,
		&notification.Type,
		&notification.IsRead,
		&leadID,
		&metadataRaw,
		&notification.CreatedAt,
	); err != nil {
		if err == pgx.ErrNoRows {
			return Notification{}, ErrInvalidReference
		}
		return Notification{}, err
	}
	notification.Content = textPtr(content)
	notification.LeadID = textPtr(leadID)
	notification.Metadata = jsonMap(textValue(metadataRaw))
	return notification, nil
}

func jsonMap(value string) map[string]any {
	if strings.TrimSpace(value) == "" {
		return map[string]any{}
	}

	var result map[string]any
	if err := json.Unmarshal([]byte(value), &result); err != nil {
		return map[string]any{}
	}

	return result
}

type taskLead struct {
	LeadID string
}

func (repo Repository) getTaskLeadID(ctx context.Context, taskID string) (taskLead, error) {
	var current taskLead
	err := repo.db.Pool().QueryRow(ctx, `select lead_id::text from public.lead_tasks where id = $1::uuid`, taskID).Scan(&current.LeadID)
	if err == pgx.ErrNoRows {
		return taskLead{}, ErrInvalidReference
	}
	return current, err
}

func (repo Repository) getLeadAttachmentColumns(ctx context.Context) (leadAttachmentColumns, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		select column_name
		from information_schema.columns
		where table_schema = 'public'
		  and table_name = 'lead_attachments'
	`)
	if err != nil {
		return leadAttachmentColumns{}, err
	}
	defer rows.Close()

	columns := leadAttachmentColumns{}
	for rows.Next() {
		var column string
		if err := rows.Scan(&column); err != nil {
			return leadAttachmentColumns{}, err
		}
		switch column {
		case "organization_id":
			columns.OrganizationID = true
		case "created_by":
			columns.CreatedBy = true
		case "uploaded_by":
			columns.UploadedBy = true
		case "file_type":
			columns.FileType = true
		case "file_url":
			columns.FileURL = true
		case "public_url":
			columns.PublicURL = true
		case "file_size":
			columns.FileSize = true
		case "message_id":
			columns.MessageID = true
		case "storage_bucket":
			columns.StorageBucket = true
		case "storage_path":
			columns.StoragePath = true
		case "metadata":
			columns.Metadata = true
		}
	}
	if err := rows.Err(); err != nil {
		return leadAttachmentColumns{}, err
	}

	return columns, nil
}

func (repo Repository) ensureLeadVisible(ctx context.Context, tenantContext tenant.Context, leadID string) error {
	var id string
	err := repo.db.Pool().QueryRow(ctx, `
		select l.id::text
		from public.leads l
		where l.organization_id = $1::uuid
		  and `+leadVisibilitySQL("$2", "$3", "$4")+`
		  and l.id = $5::uuid
		limit 1
	`, tenantContext.OrganizationID, canViewAllLeads(tenantContext), tenantContext.UserID, tenantContext.HasPermission("lead_view_team"), leadID).Scan(&id)
	if err == pgx.ErrNoRows {
		return ErrLeadNotFound
	}
	return err
}

func (repo Repository) ensureLeadEditable(ctx context.Context, tenantContext tenant.Context, leadID string) error {
	var assignedUserID pgtype.Text
	err := repo.db.Pool().QueryRow(ctx, `
		select assigned_user_id::text
		from public.leads
		where organization_id = $1::uuid and id = $2::uuid
		limit 1
	`, tenantContext.OrganizationID, leadID).Scan(&assignedUserID)
	if err == pgx.ErrNoRows {
		return ErrLeadNotFound
	}
	if err != nil {
		return err
	}
	if !canMoveLead(tenantContext, textValue(assignedUserID)) {
		return tenant.ErrOrganizationAccessDenied
	}
	return nil
}

func (repo Repository) insertTaskCompletedActivity(
	ctx context.Context,
	organizationID string,
	leadID string,
	taskID string,
	taskType *string,
	dayOffset int,
	title string,
	userID string,
	templateTaskID *string,
	outcome *string,
	outcomeNotes *string,
) error {
	metadata := map[string]any{
		"task_id":    taskID,
		"task_type":  taskType,
		"day_offset": dayOffset,
	}
	if templateTaskID != nil {
		metadata["template_task_id"] = *templateTaskID
	}
	if outcome != nil {
		metadata["outcome"] = *outcome
	}
	if outcomeNotes != nil {
		metadata["outcome_notes"] = *outcomeNotes
	}
	_, err := repo.db.Pool().Exec(ctx, `
		insert into public.activities (organization_id, lead_id, type, content, user_id, metadata)
		values ($1::uuid, $2::uuid, 'task_completed', $3, $4::uuid, $5::jsonb)
	`, organizationID, leadID, "Cadencia concluida: "+title, userID, jsonb(metadata))
	return err
}

func storagePathFromPublicURL(fileURL string, fallback string) string {
	const marker = "/storage/v1/object/public/whatsapp-media/"
	if index := strings.Index(fileURL, marker); index >= 0 {
		path := fileURL[index+len(marker):]
		path = strings.Split(path, "?")[0]
		if path = strings.Trim(path, "/"); path != "" {
			return path
		}
	}

	fallback = strings.TrimSpace(fallback)
	if fallback == "" {
		return "lead-attachments/unknown"
	}

	return "lead-attachments/" + fallback
}

func optionalStringFromPointer(value *string, maxLength int) *string {
	if value == nil {
		return nil
	}
	return optionalString(*value, maxLength)
}
