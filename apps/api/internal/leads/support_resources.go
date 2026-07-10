package leads

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
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
	WhatsApp               *string      `json:"whatsapp"`
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
	SourceDetail           *string      `json:"source_detail"`
	SourceSessionID        *string      `json:"source_session_id"`
	SourceWebhookID        *string      `json:"source_webhook_id"`
	VisitorSessionID       *string      `json:"visitor_session_id"`
	Status                 string       `json:"status"`
	Priority               *string      `json:"priority"`
	Message                *string      `json:"message"`
	InitialMessage         *string      `json:"initial_message"`
	PropertyCode           *string      `json:"property_code"`
	PropertyID             *string      `json:"property_id"`
	InterestPropertyID     *string      `json:"interest_property_id"`
	InterestPlanID         *string      `json:"interest_plan_id"`
	CreatedAt              time.Time    `json:"created_at"`
	UpdatedAt              time.Time    `json:"updated_at"`
	SLAStatus              *string      `json:"sla_status"`
	LastInteractionAt      *time.Time   `json:"last_interaction_at"`
	LastInteractionPreview *string      `json:"last_interaction_preview"`
	LastInteractionChannel *string      `json:"last_interaction_channel"`
	Tags                   []ContactTag `json:"tags"`
	TotalCount             int64        `json:"total_count"`
	DealStatus             *string      `json:"deal_status"`
	LostReason             *string      `json:"lost_reason"`
	Feedback               *string      `json:"feedback"`
	InterestValue          *string      `json:"valor_interesse"`
	CommissionPercentage   *string      `json:"commission_percentage"`
	PriceRange             *string      `json:"faixa_valor_imovel"`
	FamilyIncome           *string      `json:"renda_familiar"`
	PurchasePurpose        *string      `json:"finalidade_compra"`
	SeekingFinancing       *bool        `json:"procura_financiamento"`
	Works                  *bool        `json:"trabalha"`
	Role                   *string      `json:"cargo"`
	Company                *string      `json:"empresa"`
	Profession             *string      `json:"profissao"`
	PostalCode             *string      `json:"cep"`
	Address                *string      `json:"endereco"`
	AddressNumber          *string      `json:"numero"`
	AddressComplement      *string      `json:"complemento"`
	Neighborhood           *string      `json:"bairro"`
	City                   *string      `json:"cidade"`
	State                  *string      `json:"uf"`
	IsOwnResource          *bool        `json:"is_own_resource"`
	FirstTouchAt           *time.Time   `json:"first_touch_at"`
	FirstTouchSeconds      *int32       `json:"first_touch_seconds"`
	FirstTouchChannel      *string      `json:"first_touch_channel"`
	FirstTouchActorUserID  *string      `json:"first_touch_actor_user_id"`
	FirstResponseAt        *time.Time   `json:"first_response_at"`
	FirstResponseSeconds   *int32       `json:"first_response_seconds"`
	FirstResponseChannel   *string      `json:"first_response_channel"`
	FirstResponseAuto      *bool        `json:"first_response_is_automation"`
	FirstResponseActorID   *string      `json:"first_response_actor_user_id"`
	StageEnteredAt         *time.Time   `json:"stage_entered_at"`
	LastEntryAt            *time.Time   `json:"last_entry_at"`
	ReentryCount           int          `json:"reentry_count"`
	RedistributionCount    int          `json:"redistribution_count"`
	LastContactAt          *time.Time   `json:"last_contact_at"`
	NextFollowUpAt         *time.Time   `json:"next_follow_up_at"`
	WonAt                  *time.Time   `json:"won_at"`
	LostAt                 *time.Time   `json:"lost_at"`
	CreatedBy              *string      `json:"created_by"`
	MetadataJSON           *string      `json:"metadata_json"`
	MetaLeadID             *string      `json:"meta_lead_id"`
	MetaFormID             *string      `json:"meta_form_id"`
	MetaCampaignID         *string      `json:"meta_campaign_id"`
	MetaAdsetID            *string      `json:"meta_adset_id"`
	MetaAdID               *string      `json:"meta_ad_id"`
	MetaClickID            *string      `json:"meta_click_id"`
	CampaignID             *string      `json:"campaign_id"`
	CampaignName           *string      `json:"campaign_name"`
	AdsetID                *string      `json:"adset_id"`
	AdsetName              *string      `json:"adset_name"`
	AdID                   *string      `json:"ad_id"`
	AdName                 *string      `json:"ad_name"`
	FormID                 *string      `json:"form_id"`
	FormName               *string      `json:"form_name"`
	Platform               *string      `json:"platform"`
	UTMSource              *string      `json:"utm_source"`
	UTMMedium              *string      `json:"utm_medium"`
	UTMCampaign            *string      `json:"utm_campaign"`
	UTMContent             *string      `json:"utm_content"`
	UTMTerm                *string      `json:"utm_term"`
	CreativeURL            *string      `json:"creative_url"`
	CreativeVideoURL       *string      `json:"creative_video_url"`
	CreativeInstagramURL   *string      `json:"creative_instagram_url"`
	MetaPayloadJSON        *string      `json:"meta_payload_json"`
	MetaRawPayloadJSON     *string      `json:"meta_raw_payload_json"`
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
	Mode        string
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
	ID            string    `json:"id"`
	LeadID        string    `json:"lead_id"`
	FileName      string    `json:"file_name"`
	FileURL       string    `json:"file_url"`
	FileType      *string   `json:"file_type"`
	FileSize      *int64    `json:"file_size"`
	CreatedAt     time.Time `json:"created_at"`
	CreatedBy     *string   `json:"created_by"`
	MessageID     *string   `json:"message_id"`
	StorageBucket string    `json:"-"`
	StoragePath   string    `json:"-"`
}

type LeadAttachmentCreateRequest struct {
	LeadID    string  `json:"lead_id"`
	FileName  string  `json:"file_name"`
	FileURL   string  `json:"file_url"`
	FileType  *string `json:"file_type"`
	FileSize  *int64  `json:"file_size"`
	MessageID *string `json:"message_id"`
}

const leadAttachmentSignedURLTTLSeconds = 60 * 60

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
	ID             string         `json:"id"`
	UserID         string         `json:"user_id"`
	OrganizationID string         `json:"organization_id"`
	Title          string         `json:"title"`
	Content        *string        `json:"content"`
	Type           string         `json:"type"`
	IsRead         bool           `json:"is_read"`
	LeadID         *string        `json:"lead_id"`
	Metadata       map[string]any `json:"metadata"`
	CreatedAt      time.Time      `json:"created_at"`
}

type CreateNotificationRequest struct {
	UserID         string         `json:"user_id"`
	OrganizationID string         `json:"organization_id"`
	Title          string         `json:"title"`
	Content        *string        `json:"content"`
	Type           string         `json:"type"`
	LeadID         *string        `json:"lead_id"`
	Metadata       map[string]any `json:"metadata"`
}

type DispatchNotificationRequest struct {
	EventKey       string         `json:"event_key"`
	TemplateSlug   string         `json:"template_slug"`
	OrganizationID string         `json:"organization_id"`
	UserID         string         `json:"user_id"`
	Recipient      string         `json:"recipient"`
	Title          string         `json:"title"`
	Content        string         `json:"content"`
	Variables      map[string]any `json:"variables"`
	LeadID         *string        `json:"lead_id"`
	DedupeKey      string         `json:"dedupe_key"`
	IsTest         bool           `json:"is_test"`
	Channels       []string       `json:"channels"`
}

type DispatchNotificationResult struct {
	Success      bool                  `json:"success"`
	Notification *Notification         `json:"notification,omitempty"`
	WhatsApp     DispatchChannelResult `json:"whatsapp"`
	Push         DispatchChannelResult `json:"push"`
	Email        DispatchChannelResult `json:"email"`
	Error        string                `json:"error,omitempty"`
}

type DispatchChannelResult struct {
	Enabled    bool   `json:"enabled"`
	Attempted  bool   `json:"attempted"`
	OK         bool   `json:"ok"`
	Status     int    `json:"status,omitempty"`
	Error      string `json:"error,omitempty"`
	Provider   string `json:"provider,omitempty"`
	SessionID  string `json:"session_id,omitempty"`
	InstanceID string `json:"instance_id,omitempty"`
	Sent       int    `json:"sent,omitempty"`
	Skipped    int    `json:"skipped,omitempty"`
}

type DispatchWhatsAppResult = DispatchChannelResult

type notificationRecipient struct {
	ID       string
	Name     string
	Email    string
	WhatsApp string
}

type notificationWhatsAppConfig struct {
	Enabled        bool              `json:"enabled"`
	Mode           string            `json:"mode"`
	WebhookURL     string            `json:"webhook_url"`
	URL            string            `json:"url"`
	Method         string            `json:"method"`
	Headers        map[string]string `json:"headers"`
	TimeoutSeconds int               `json:"timeout_seconds"`
	SessionID      string            `json:"session_id"`
	InstanceName   string            `json:"instance_name"`
	InstanceID     string            `json:"instance_id"`
	Token          string            `json:"token"`
	PhoneNumber    string            `json:"phone_number"`
}

type notificationWhatsAppSession struct {
	ID          string
	InstanceID  string
	InstanceKey string
	Token       string
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
		Mode:        strings.ToLower(cleanContactFilterValue(values.Get("mode"))),
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
	if filter.Mode == "" || filter.Mode == "export" {
		filter.Mode = "full"
	}
	if !validEnum(filter.Mode, "compact", "full") {
		return ContactListFilter{}, fmt.Errorf("%w: mode is invalid", ErrInvalidInput)
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
	if filter.Mode == "compact" {
		return repo.listContactsCompact(ctx, tenantContext, filter)
	}
	return repo.listContactsFull(ctx, tenantContext, filter)
}

func (repo Repository) countContacts(ctx context.Context, tenantContext tenant.Context, filter ContactListFilter) (int64, error) {
	where, args, err := buildContactWhere(tenantContext, filter)
	if err != nil {
		return 0, err
	}

	var total int64
	err = repo.db.Pool().QueryRow(ctx, `
		select count(*)::bigint
		from public.leads l
		where `+strings.Join(where, " and "),
		args...,
	).Scan(&total)
	if err != nil {
		return 0, err
	}
	return total, nil
}

func (repo Repository) listContactsFull(ctx context.Context, tenantContext tenant.Context, filter ContactListFilter) ([]Contact, error) {
	total, err := repo.countContacts(ctx, tenantContext, filter)
	if err != nil {
		return nil, err
	}
	if total == 0 {
		return []Contact{}, nil
	}

	where, args, err := buildContactWhere(tenantContext, filter)
	if err != nil {
		return nil, err
	}

	offset := (filter.Page - 1) * filter.Limit
	args = append(args, total, filter.Limit, offset)
	totalIndex := len(args) - 2
	limitIndex := len(args) - 1
	offsetIndex := len(args)

	rows, err := repo.db.Pool().Query(ctx, `
		select
			$`+fmt.Sprint(totalIndex)+`::bigint as total_count,
			l.id::text,
			l.name,
			l.phone,
			l.email,
			coalesce(to_jsonb(l)->>'whatsapp', l.phone),
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
			to_jsonb(l)->>'source_detail',
			l.source_session_id,
			l.source_webhook_id::text,
			l.visitor_session_id,
			l.status,
			l.priority,
			l.message,
			l.initial_message,
			l.property_code,
			l.property_id::text,
			l.interest_property_id::text,
			l.interest_plan_id::text,
			l.created_at,
			l.updated_at,
			null::text as sla_status,
			l.last_entry_at,
			null::text as last_interaction_preview,
			null::text as last_interaction_channel,
			coalesce(tags.tags, '[]'::json)::text,
			l.deal_status,
			l.lost_reason,
			l.feedback,
			l.valor_interesse::text,
			l.commission_percentage::text,
			l.faixa_valor_imovel,
			l.renda_familiar,
			l.finalidade_compra,
			l.procura_financiamento,
			l.trabalha,
			l.cargo,
			l.empresa,
			l.profissao,
			l.cep,
			l.endereco,
			l.numero,
			l.complemento,
			l.bairro,
			l.cidade,
			l.uf,
			l.is_own_resource,
			l.first_touch_at,
			l.first_touch_seconds,
			l.first_touch_channel,
			l.first_touch_actor_user_id::text,
			l.first_response_at,
			l.first_response_seconds,
			l.first_response_channel,
			l.first_response_is_automation,
			l.first_response_actor_user_id::text,
			l.stage_entered_at,
			l.last_entry_at,
			l.reentry_count,
			l.redistribution_count,
			l.last_contact_at,
			l.next_follow_up_at,
			l.won_at,
			l.lost_at,
			l.created_by::text,
			coalesce(to_jsonb(l)->'metadata', '{}'::jsonb)::text,
			l.meta_lead_id,
			l.meta_form_id,
			l.meta_campaign_id,
			l.meta_adset_id,
			l.meta_ad_id,
			l.meta_click_id,
			coalesce(lm.campaign_id, l.meta_campaign_id),
			coalesce(lm.campaign_name, l.utm_campaign),
			coalesce(lm.adset_id, l.meta_adset_id),
			lm.adset_name,
			coalesce(lm.ad_id, l.meta_ad_id),
			coalesce(lm.ad_name, l.utm_content),
			coalesce(lm.form_id, l.meta_form_id),
			coalesce(lm.form_name, l.utm_term),
			coalesce(lm.platform, l.utm_medium),
			coalesce(lm.utm_source, l.utm_source),
			coalesce(lm.utm_medium, l.utm_medium),
			coalesce(lm.utm_campaign, l.utm_campaign),
			coalesce(lm.utm_content, l.utm_content),
			coalesce(lm.utm_term, l.utm_term),
			lm.creative_url,
			lm.creative_video_url,
			lm.creative_instagram_url,
			lm.payload::text,
			lm.raw_payload::text
		from public.leads l
		left join public.pipelines p on p.id = l.pipeline_id and p.organization_id = l.organization_id
		left join public.stages s on s.id = l.stage_id and s.organization_id = l.organization_id
		left join public.users u on u.id = l.assigned_user_id
		left join lateral (
			select lm.*
			from public.lead_meta lm
			where lm.organization_id = l.organization_id
			  and lm.lead_id = l.id
			order by lm.updated_at desc nulls last, lm.created_at desc nulls last
			limit 1
		) lm on true
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

func (repo Repository) listContactsCompact(ctx context.Context, tenantContext tenant.Context, filter ContactListFilter) ([]Contact, error) {
	total, err := repo.countContacts(ctx, tenantContext, filter)
	if err != nil {
		return nil, err
	}
	if total == 0 {
		return []Contact{}, nil
	}

	where, args, err := buildContactWhere(tenantContext, filter)
	if err != nil {
		return nil, err
	}

	offset := (filter.Page - 1) * filter.Limit
	args = append(args, total, filter.Limit, offset)
	totalIndex := len(args) - 2
	limitIndex := len(args) - 1
	offsetIndex := len(args)

	rows, err := repo.db.Pool().Query(ctx, `
		select
			$`+fmt.Sprint(totalIndex)+`::bigint as total_count,
			l.id::text,
			l.name,
			l.phone,
			l.email,
			coalesce(to_jsonb(l)->>'whatsapp', l.phone),
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
			null::text as source_detail,
			l.source_session_id,
			l.source_webhook_id::text,
			l.visitor_session_id,
			coalesce(l.status, 'new'),
			l.priority,
			null::text as message,
			null::text as initial_message,
			l.property_code,
			l.property_id::text,
			l.interest_property_id::text,
			l.interest_plan_id::text,
			l.created_at,
			l.updated_at,
			null::text as sla_status,
			l.last_entry_at,
			null::text as last_interaction_preview,
			null::text as last_interaction_channel,
			coalesce(tags.tags, '[]'::json)::text,
			l.deal_status,
			l.lost_reason,
			null::text as feedback,
			null::text as valor_interesse,
			null::text as commission_percentage,
			null::text as faixa_valor_imovel,
			null::text as renda_familiar,
			null::text as finalidade_compra,
			null::boolean as procura_financiamento,
			null::boolean as trabalha,
			null::text as cargo,
			null::text as empresa,
			null::text as profissao,
			null::text as cep,
			null::text as endereco,
			null::text as numero,
			null::text as complemento,
			null::text as bairro,
			null::text as cidade,
			null::text as uf,
			l.is_own_resource,
			l.first_touch_at,
			l.first_touch_seconds,
			l.first_touch_channel,
			l.first_touch_actor_user_id::text,
			l.first_response_at,
			l.first_response_seconds,
			l.first_response_channel,
			l.first_response_is_automation,
			l.first_response_actor_user_id::text,
			l.stage_entered_at,
			l.last_entry_at,
			coalesce(l.reentry_count, 0),
			coalesce(l.redistribution_count, 0),
			l.last_contact_at,
			l.next_follow_up_at,
			l.won_at,
			l.lost_at,
			l.created_by::text,
			null::text as metadata_json,
			l.meta_lead_id,
			l.meta_form_id,
			l.meta_campaign_id,
			l.meta_adset_id,
			l.meta_ad_id,
			l.meta_click_id,
			null::text as campaign_id,
			null::text as campaign_name,
			null::text as adset_id,
			null::text as adset_name,
			null::text as ad_id,
			null::text as ad_name,
			null::text as form_id,
			null::text as form_name,
			null::text as platform,
			null::text as utm_source,
			null::text as utm_medium,
			null::text as utm_campaign,
			null::text as utm_content,
			null::text as utm_term,
			null::text as creative_url,
			null::text as creative_video_url,
			null::text as creative_instagram_url,
			null::text as meta_payload_json,
			null::text as meta_raw_payload_json
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
		repo.signLeadAttachmentURL(ctx, &attachment)
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
			repo.signLeadAttachmentURL(ctx, &existing)
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
	repo.signLeadAttachmentURL(ctx, &attachment)

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

	repo.signLeadAttachmentURL(ctx, &attachment)
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
	eventKey := firstNotificationText(stringFromMap(metadata, "event_key"), notificationType)
	metadata = applyNotificationDispatchMetadata(metadata, eventKey, nil)
	return scanNotification(repo.db.Pool().QueryRow(ctx, `
		insert into public.notifications (user_id, organization_id, title, content, type, lead_id, is_read, metadata)
		values ($1::uuid, $2::uuid, $3, $4, $5, $6, false, $7::jsonb)
		returning id::text, user_id::text, organization_id::text, title, content, type, coalesce(is_read, false), lead_id::text, coalesce(metadata, '{}'::jsonb)::text, created_at
	`, userID, organizationID, title, optionalStringFromPointer(request.Content, 1_000), notificationType, request.LeadID, jsonb(metadata)))
}

func (repo Repository) DispatchNotification(ctx context.Context, tenantContext tenant.Context, request DispatchNotificationRequest) (DispatchNotificationResult, error) {
	if request.OrganizationID != "" && request.OrganizationID != tenantContext.OrganizationID {
		return DispatchNotificationResult{}, tenant.ErrOrganizationAccessDenied
	}

	eventKey := trimMax(firstNotificationText(request.EventKey, request.TemplateSlug), 80)
	if eventKey == "" {
		return DispatchNotificationResult{}, fmt.Errorf("%w: event_key is required", ErrInvalidInput)
	}

	userID := strings.TrimSpace(request.UserID)
	if userID == "" {
		userID = tenantContext.UserID
	}
	normalizedUserID, ok := normalizeUUID(userID)
	if !ok {
		return DispatchNotificationResult{}, fmt.Errorf("%w: user_id is invalid", ErrInvalidInput)
	}
	if normalizedUserID != tenantContext.UserID && !canDispatchNotifications(tenantContext) {
		return DispatchNotificationResult{}, tenant.ErrOrganizationAccessDenied
	}

	recipient, err := repo.getNotificationRecipient(ctx, tenantContext.OrganizationID, normalizedUserID)
	if err != nil {
		return DispatchNotificationResult{}, err
	}

	variables := request.Variables
	if variables == nil {
		variables = map[string]any{}
	}
	request.Variables = variables
	title, content, notificationType := buildDispatchNotificationContent(eventKey, request, variables)
	if title == "" {
		return DispatchNotificationResult{}, fmt.Errorf("%w: notification title is required", ErrInvalidInput)
	}

	dedupeKey := trimMax(request.DedupeKey, 180)
	if dedupeKey != "" {
		if existing, found, err := repo.findRecentNotificationByDedupeKey(ctx, tenantContext.OrganizationID, normalizedUserID, dedupeKey); err != nil {
			return DispatchNotificationResult{}, err
		} else if found {
			delivery := repo.dispatchNotificationDeliveries(ctx, existing, request.Channels)
			return DispatchNotificationResult{
				Success:      delivery.Error == "",
				Notification: &existing,
				WhatsApp:     delivery.WhatsApp,
				Push:         delivery.Push,
				Email:        delivery.Email,
				Error:        delivery.Error,
			}, nil
		}
	}

	metadata := map[string]any{
		"event_key": eventKey,
		"variables": variables,
		"is_test":   request.IsTest,
	}
	if dedupeKey != "" {
		metadata["dedupe_key"] = dedupeKey
	}
	if request.Recipient != "" {
		metadata["requested_recipient"] = trimMax(request.Recipient, 180)
	}
	metadata = applyNotificationDispatchMetadata(metadata, eventKey, request.Channels)

	notification, err := repo.createNotificationRow(ctx, tenantContext.OrganizationID, normalizedUserID, title, content, notificationType, request.LeadID, metadata)
	if err != nil {
		return DispatchNotificationResult{}, err
	}

	_ = recipient
	delivery := repo.dispatchNotificationDeliveries(ctx, notification, request.Channels)

	return DispatchNotificationResult{
		Success:      delivery.Error == "",
		Notification: &notification,
		WhatsApp:     delivery.WhatsApp,
		Push:         delivery.Push,
		Email:        delivery.Email,
		Error:        delivery.Error,
	}, nil
}

func (repo Repository) createNotificationRow(ctx context.Context, organizationID string, userID string, title string, content string, notificationType string, leadID *string, metadata map[string]any) (Notification, error) {
	return scanNotification(repo.db.Pool().QueryRow(ctx, `
		insert into public.notifications (user_id, organization_id, title, content, type, lead_id, is_read, metadata)
		values ($1::uuid, $2::uuid, $3, $4, $5, $6, false, $7::jsonb)
		returning id::text, user_id::text, organization_id::text, title, content, type, coalesce(is_read, false), lead_id::text, coalesce(metadata, '{}'::jsonb)::text, created_at
	`, userID, organizationID, title, optionalString(content, 1_000), notificationType, leadID, jsonb(metadata)))
}

func (repo Repository) findRecentNotificationByDedupeKey(ctx context.Context, organizationID string, userID string, dedupeKey string) (Notification, bool, error) {
	notification, err := scanNotification(repo.db.Pool().QueryRow(ctx, `
		select id::text, user_id::text, organization_id::text, title, content, type, coalesce(is_read, false), lead_id::text, coalesce(metadata, '{}'::jsonb)::text, created_at
		from public.notifications
		where organization_id = $1::uuid
		  and user_id = $2::uuid
		  and metadata->>'dedupe_key' = $3
		  and created_at >= now() - interval '6 hours'
		order by created_at desc
		limit 1
	`, organizationID, userID, dedupeKey))
	if errors.Is(err, pgx.ErrNoRows) {
		return Notification{}, false, nil
	}
	if err != nil {
		return Notification{}, false, err
	}
	return notification, true, nil
}

func (repo Repository) getNotificationRecipient(ctx context.Context, organizationID string, userID string) (notificationRecipient, error) {
	var recipient notificationRecipient
	var name, email, whatsapp pgtype.Text
	err := repo.db.Pool().QueryRow(ctx, `
		select u.id::text, u.name, u.email, u.whatsapp
		from public.users u
		left join public.organization_members om
		  on om.user_id = u.id
		 and om.organization_id = $1::uuid
		where u.id = $2::uuid
		  and (u.organization_id = $1::uuid or om.id is not null)
		limit 1
	`, organizationID, userID).Scan(&recipient.ID, &name, &email, &whatsapp)
	if errors.Is(err, pgx.ErrNoRows) {
		return notificationRecipient{}, ErrInvalidReference
	}
	if err != nil {
		return notificationRecipient{}, err
	}
	recipient.Name = textValue(name)
	recipient.Email = textValue(email)
	recipient.WhatsApp = textValue(whatsapp)
	return recipient, nil
}

func (repo Repository) dispatchWhatsAppNotification(ctx context.Context, tenantContext tenant.Context, request DispatchNotificationRequest, recipient notificationRecipient, title string, content string, eventKey string, dedupeKey string) (DispatchWhatsAppResult, error) {
	config, err := repo.getNotificationWhatsAppConfig(ctx)
	if err != nil {
		return DispatchWhatsAppResult{}, err
	}
	result := DispatchWhatsAppResult{Enabled: config.Enabled}
	if !config.Enabled || !requestWantsChannel(request.Channels, "whatsapp") {
		return result, nil
	}

	to := strings.TrimSpace(recipient.WhatsApp)
	if strings.TrimSpace(to) == "" {
		result.Attempted = false
		result.Error = "recipient_whatsapp_missing"
		return result, nil
	}
	messageText := buildWhatsAppNotificationText(title, content)

	var organizationResult DispatchWhatsAppResult
	if session, found, err := repo.findNotificationWhatsAppSession(ctx, tenantContext.OrganizationID, config.SessionID); err != nil {
		return result, err
	} else if found {
		organizationResult, err = repo.dispatchWhatsAppViaEvolutionGo(ctx, session, to, messageText, "evolution_go_org_session")
		if err == nil && organizationResult.OK {
			return organizationResult, nil
		}
	}

	if session, found, err := repo.findGlobalNotificationWhatsAppSession(ctx, config.SessionID); err != nil {
		return result, err
	} else if found && (!organizationResult.Attempted || session.ID != organizationResult.SessionID) {
		globalSessionResult, err := repo.dispatchWhatsAppViaEvolutionGo(ctx, session, to, messageText, "evolution_go_global_session")
		if err == nil && globalSessionResult.OK {
			if organizationResult.Attempted {
				globalSessionResult.Provider = "evolution_go_global_session_fallback"
			}
			return globalSessionResult, nil
		}
		if organizationResult.Attempted {
			if globalSessionResult.Error != "" {
				organizationResult.Error = firstNotificationText(organizationResult.Error, "global_session_failed: "+globalSessionResult.Error)
			}
			return organizationResult, err
		}
		return globalSessionResult, err
	}

	if notificationConfigUsesDirectInstance(config) {
		globalResult, err := repo.dispatchWhatsAppViaEvolutionGo(ctx, notificationWhatsAppSession{
			InstanceID:  strings.TrimSpace(config.InstanceID),
			InstanceKey: firstNotificationText(config.InstanceName, config.InstanceID),
			Token:       strings.TrimSpace(config.Token),
		}, to, messageText, "evolution_go_global_instance")
		if err == nil && globalResult.OK {
			if organizationResult.Attempted {
				globalResult.Provider = "evolution_go_global_instance_fallback"
			}
			return globalResult, nil
		}
		if organizationResult.Attempted {
			if globalResult.Error != "" {
				organizationResult.Error = firstNotificationText(organizationResult.Error, "fallback_failed: "+globalResult.Error)
			}
			return organizationResult, err
		}
		return globalResult, err
	}
	if organizationResult.Attempted {
		return organizationResult, nil
	}

	result.Error = "notification_whatsapp_sender_missing"
	return result, nil
}

func notificationConfigUsesDirectInstance(config notificationWhatsAppConfig) bool {
	mode := strings.ToLower(strings.TrimSpace(config.Mode))
	if mode == "evolution_go_instance" || mode == "instance" || mode == "direct_instance" {
		return true
	}
	return strings.TrimSpace(firstNotificationText(config.InstanceName, config.InstanceID)) != ""
}

func (repo Repository) findNotificationWhatsAppSession(ctx context.Context, organizationID string, sessionID string) (notificationWhatsAppSession, bool, error) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID != "" {
		normalized, ok := normalizeUUID(sessionID)
		if !ok {
			return notificationWhatsAppSession{}, false, fmt.Errorf("%w: notification WhatsApp session_id is invalid", ErrInvalidInput)
		}
		sessionID = normalized
	}

	var session notificationWhatsAppSession
	err := repo.db.Pool().QueryRow(ctx, `
		select
			ws.id::text,
			coalesce(nullif(ws.instance_id, ''), ''),
			coalesce(
				nullif(ws.advanced_settings->>'evolution_go_resolved_instance_key', ''),
				nullif(ws.instance_id, ''),
				nullif(ws.instance_name, '')
			),
			coalesce(nullif(ws.advanced_settings->>'token', ''), '')
		from public.whatsapp_sessions ws
		where ws.organization_id = $1::uuid
		  and ws.provider = 'evolution_go'
		  and coalesce(ws.is_active, true) = true
		  and coalesce(ws.status, '') = 'connected'
		  and (
		    ($2 = '' and coalesce(ws.is_notification_session, false) = true)
		    or ($2 <> '' and ws.id = $2::uuid)
		  )
		order by ws.last_connected_at desc nulls last, ws.created_at desc
		limit 1
	`, organizationID, sessionID).Scan(&session.ID, &session.InstanceID, &session.InstanceKey, &session.Token)
	if errors.Is(err, pgx.ErrNoRows) {
		return notificationWhatsAppSession{}, false, nil
	}
	if err != nil {
		return notificationWhatsAppSession{}, false, err
	}
	return session, true, nil
}

func (repo Repository) findGlobalNotificationWhatsAppSession(ctx context.Context, sessionID string) (notificationWhatsAppSession, bool, error) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return notificationWhatsAppSession{}, false, nil
	}
	normalized, ok := normalizeUUID(sessionID)
	if !ok {
		return notificationWhatsAppSession{}, false, fmt.Errorf("%w: global notification WhatsApp session_id is invalid", ErrInvalidInput)
	}

	var session notificationWhatsAppSession
	err := repo.db.Pool().QueryRow(ctx, `
		select
			ws.id::text,
			coalesce(nullif(ws.instance_id, ''), ''),
			coalesce(
				nullif(ws.advanced_settings->>'evolution_go_resolved_instance_key', ''),
				nullif(ws.instance_id, ''),
				nullif(ws.instance_name, '')
			),
			coalesce(nullif(ws.advanced_settings->>'token', ''), '')
		from public.whatsapp_sessions ws
		where ws.id = $1::uuid
		  and ws.provider = 'evolution_go'
		  and coalesce(ws.is_active, true) = true
		  and coalesce(ws.status, '') = 'connected'
		limit 1
	`, normalized).Scan(&session.ID, &session.InstanceID, &session.InstanceKey, &session.Token)
	if errors.Is(err, pgx.ErrNoRows) {
		return notificationWhatsAppSession{}, false, nil
	}
	if err != nil {
		return notificationWhatsAppSession{}, false, err
	}
	return session, true, nil
}

func (repo Repository) dispatchWhatsAppViaEvolutionGo(ctx context.Context, session notificationWhatsAppSession, to string, text string, provider string) (DispatchWhatsAppResult, error) {
	result := DispatchWhatsAppResult{
		Enabled:    true,
		Attempted:  true,
		Provider:   provider,
		SessionID:  session.ID,
		InstanceID: firstNotificationText(session.InstanceID, session.InstanceKey),
	}
	if strings.TrimSpace(repo.evolutionGoAPIURL) == "" {
		result.Error = "evolution_go_api_url_missing"
		return result, fmt.Errorf("%w: Evolution Go API URL is not configured", ErrInvalidInput)
	}

	token := strings.TrimSpace(session.Token)
	if token == "" {
		token = strings.TrimSpace(repo.evolutionGoAPIKey)
	}
	if token == "" {
		result.Error = "evolution_go_token_missing"
		return result, fmt.Errorf("%w: Evolution Go token is not configured", ErrInvalidInput)
	}

	payload := map[string]any{
		"number": normalizeNotificationWhatsAppRecipient(to),
		"text":   text,
	}
	rawPayload, err := json.Marshal(payload)
	if err != nil {
		return result, err
	}

	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, repo.evolutionGoAPIURL+"/send/text", bytes.NewReader(rawPayload))
	if err != nil {
		return result, err
	}
	httpRequest.Header.Set("Accept", "application/json")
	httpRequest.Header.Set("Content-Type", "application/json")
	httpRequest.Header.Set("apikey", token)
	if strings.TrimSpace(session.InstanceKey) != "" {
		httpRequest.Header.Set("instanceId", strings.TrimSpace(session.InstanceKey))
	}

	client := &http.Client{Timeout: 15 * time.Second}
	response, err := client.Do(httpRequest)
	if err != nil {
		result.Error = err.Error()
		return result, err
	}
	defer response.Body.Close()

	result.Status = response.StatusCode
	result.OK = response.StatusCode >= 200 && response.StatusCode < 300
	if !result.OK {
		raw, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		result.Error = trimMax(firstNotificationText(strings.TrimSpace(string(raw)), response.Status), 240)
	}
	return result, nil
}

func normalizeNotificationWhatsAppRecipient(value string) string {
	value = strings.TrimSpace(value)
	if strings.Contains(value, "@g.us") || strings.Contains(value, "@s.whatsapp.net") {
		return value
	}

	var builder strings.Builder
	for _, item := range value {
		if item >= '0' && item <= '9' {
			builder.WriteRune(item)
		}
	}
	return builder.String()
}

func buildWhatsAppNotificationText(title string, content string) string {
	title = strings.TrimSpace(title)
	content = strings.TrimSpace(content)
	if title == "" {
		return content
	}
	if content == "" {
		return title
	}
	return title + "\n" + content
}

func (repo Repository) getNotificationWhatsAppConfig(ctx context.Context) (notificationWhatsAppConfig, error) {
	var raw string
	err := repo.db.Pool().QueryRow(ctx, `
		select coalesce(value->'notification_dispatch'->'whatsapp', '{}'::jsonb)::text
		from public.system_settings
		order by updated_at desc nulls last, created_at desc nulls last
		limit 1
	`).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) || isUndefinedTableError(err) {
		return notificationWhatsAppConfig{}, nil
	}
	if err != nil {
		return notificationWhatsAppConfig{}, err
	}
	var config notificationWhatsAppConfig
	if strings.TrimSpace(raw) != "" {
		_ = json.Unmarshal([]byte(raw), &config)
	}
	return config, nil
}

func buildDispatchNotificationContent(eventKey string, request DispatchNotificationRequest, variables map[string]any) (string, string, string) {
	title := trimMax(firstNotificationText(request.Title, stringFromMap(variables, "title")), 180)
	content := trimMax(firstNotificationText(request.Content, stringFromMap(variables, "message"), stringFromMap(variables, "body")), 1_000)

	switch eventKey {
	case "new_lead_received":
		if title == "" {
			title = "Novo lead recebido"
		}
		if content == "" {
			leadName := firstNotificationText(stringFromMap(variables, "lead_name"), stringFromMap(variables, "leadName"), "Lead")
			source := stringFromMap(variables, "source")
			content = leadName + " foi atribuido a voce"
			if source != "" {
				content += " (origem: " + source + ")"
			}
		}
	case "deal_won":
		if title == "" {
			title = "Lead ganho"
		}
		if content == "" {
			leadName := firstNotificationText(stringFromMap(variables, "lead_name"), stringFromMap(variables, "leadName"), "Lead")
			content = "Venda concluida para " + leadName
		}
	case "lead_reentry":
		if title == "" {
			title = "Lead retornou"
		}
		if content == "" {
			leadName := firstNotificationText(stringFromMap(variables, "lead_name"), stringFromMap(variables, "leadName"), "Lead")
			content = leadName + " teve uma nova entrada"
		}
	case "update_phone_reminder":
		if title == "" {
			title = "Complete seu perfil"
		}
		if content == "" {
			content = "Adicione seu WhatsApp para receber avisos importantes."
		}
	case "gamification_update":
		if title == "" {
			title = "Atualizacao de gamificacao"
		}
		if content == "" {
			content = "Sua pontuacao foi atualizada."
		}
	case "whatsapp_disconnected":
		if title == "" {
			title = "WhatsApp desconectado"
		}
		if content == "" {
			sessionName := firstNotificationText(stringFromMap(variables, "session_name"), stringFromMap(variables, "display_name"), "Sessao")
			content = sessionName + " foi desconectada."
		}
	case "test_push":
		if title == "" {
			title = "Teste de notificacao"
		}
		if content == "" {
			content = "Se voce recebeu este aviso, o dispatcher do backend esta funcionando."
		}
	default:
		if title == "" {
			title = "Notificacao Vimob"
		}
		if content == "" {
			content = "Voce tem uma nova notificacao."
		}
	}

	return title, content, notificationTypeForEvent(eventKey)
}

func notificationTypeForEvent(eventKey string) string {
	switch eventKey {
	case "new_lead_received", "lead_reentry", "lead_duplicate_existing", "lead_transferred", "lead_stage_changed", "lead_redistribution_warning", "lead_redistributed_received", "lead_redistributed_away":
		return "lead"
	case "deal_won":
		return "deal_won"
	case "gamification_update":
		return "gamification"
	case "whatsapp_disconnected":
		return "whatsapp"
	case "test_push":
		return "test"
	default:
		return "info"
	}
}

func shouldDispatchLeadWhatsAppNotification(eventKey string) bool {
	switch strings.TrimSpace(eventKey) {
	case "new_lead_received",
		"lead_reentry",
		"lead_duplicate_existing",
		"lead_transferred",
		"lead_stage_changed",
		"deal_won",
		"lead_redistribution_warning",
		"lead_redistributed_received",
		"lead_redistributed_away",
		"whatsapp_disconnected",
		"schedule_reminder":
		return true
	default:
		return false
	}
}

func shouldDispatchPushNotification(eventKey string) bool {
	eventKey = strings.TrimSpace(eventKey)
	return eventKey != ""
}

func shouldDispatchEmailNotification(eventKey string) bool {
	return strings.TrimSpace(eventKey) == "deal_won"
}

func applyNotificationDispatchMetadata(metadata map[string]any, eventKey string, channels []string) map[string]any {
	if metadata == nil {
		metadata = map[string]any{}
	}
	eventKey = firstNotificationText(eventKey, stringFromMap(metadata, "event_key"), "notification")
	metadata["event_key"] = eventKey

	dispatch := mapFromAny(metadata["dispatch"])
	setChannel := func(channel string, required bool) {
		current := mapFromAny(dispatch[channel])
		if _, exists := current["status"]; !exists {
			current["status"] = "pending"
		}
		current["required"] = required
		dispatch[channel] = current
	}

	wantsWhatsApp := requestWantsChannel(channels, "whatsapp") && shouldDispatchLeadWhatsAppNotification(eventKey)
	wantsPush := requestWantsChannel(channels, "push") && shouldDispatchPushNotification(eventKey)
	wantsEmail := requestWantsChannel(channels, "email") && shouldDispatchEmailNotification(eventKey)

	if wantsWhatsApp {
		metadata["whatsapp_dispatch_required"] = true
		if _, exists := metadata["whatsapp_dispatch"]; !exists {
			metadata["whatsapp_dispatch"] = map[string]any{"status": "pending"}
		}
		setChannel("whatsapp", true)
	}
	if wantsPush {
		setChannel("push", true)
	}
	if wantsEmail {
		setChannel("email", true)
	}
	if len(dispatch) > 0 {
		metadata["dispatch"] = dispatch
	}
	return metadata
}

func mapFromAny(value any) map[string]any {
	if value == nil {
		return map[string]any{}
	}
	if typed, ok := value.(map[string]any); ok {
		return typed
	}
	return map[string]any{}
}

func requestWantsChannel(channels []string, channel string) bool {
	if len(channels) == 0 {
		return true
	}
	for _, item := range channels {
		if strings.EqualFold(strings.TrimSpace(item), channel) {
			return true
		}
	}
	return false
}

func canDispatchNotifications(tenantContext tenant.Context) bool {
	return tenantContext.IsSuperAdmin ||
		canManageLeads(tenantContext) ||
		tenantContext.HasPermission("settings_manage") ||
		tenantContext.HasPermission("whatsapp_manage") ||
		tenantContext.HasPermission("users_manage")
}

func firstNotificationText(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func stringFromMap(values map[string]any, key string) string {
	value, ok := values[key]
	if !ok || value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case fmt.Stringer:
		return strings.TrimSpace(typed.String())
	default:
		return strings.TrimSpace(fmt.Sprint(typed))
	}
}

func isUndefinedTableError(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "42P01"
}

func isUndefinedColumnError(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "42703"
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
	if filter.Search == "" {
		if filter.CreatedFrom != "" {
			add("l.created_at >= $%d::timestamptz", filter.CreatedFrom)
		}
		if filter.CreatedTo != "" {
			add("l.created_at <= $%d::timestamptz", filter.CreatedTo)
		}
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
	var phone, email, whatsApp, avatar, pipelineID, pipelineName, stageID, stageName, stageColor pgtype.Text
	var assignedUserID, assigneeName, assigneeAvatar, slaStatus, preview, channel pgtype.Text
	var sourceDetail, sourceSessionID, sourceWebhookID, visitorSessionID pgtype.Text
	var priority, message, initialMessage, propertyCode, propertyID, interestPropertyID, interestPlanID pgtype.Text
	var dealStatus, lostReason, feedback, interestValue, commissionPercentage pgtype.Text
	var priceRange, familyIncome, purchasePurpose, role, company, profession pgtype.Text
	var postalCode, address, addressNumber, addressComplement, neighborhood, city, state pgtype.Text
	var createdBy, metadataJSON pgtype.Text
	var firstTouchChannel, firstTouchActorUserID, firstResponseChannel, firstResponseActorUserID pgtype.Text
	var metaLeadID, campaignID, campaignName, adsetID, adsetName, adID, adName pgtype.Text
	var formID, formName, platform, utmSource, utmMedium, utmCampaign, utmContent, utmTerm pgtype.Text
	var metaFormID, metaCampaignID, metaAdsetID, metaAdID, metaClickID pgtype.Text
	var creativeURL, creativeVideoURL, creativeInstagramURL, metaPayloadJSON, metaRawPayloadJSON pgtype.Text
	var seekingFinancing, works, isOwnResource, firstResponseAuto pgtype.Bool
	var firstTouchSeconds, firstResponseSeconds pgtype.Int4
	var lastInteraction, firstTouchAt, firstResponseAt, stageEnteredAt, lastEntry pgtype.Timestamptz
	var lastContactAt, nextFollowUpAt, wonAt, lostAt pgtype.Timestamptz
	var tagsJSON string
	if err := row.Scan(
		&contact.TotalCount,
		&contact.ID,
		&contact.Name,
		&phone,
		&email,
		&whatsApp,
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
		&sourceDetail,
		&sourceSessionID,
		&sourceWebhookID,
		&visitorSessionID,
		&contact.Status,
		&priority,
		&message,
		&initialMessage,
		&propertyCode,
		&propertyID,
		&interestPropertyID,
		&interestPlanID,
		&contact.CreatedAt,
		&contact.UpdatedAt,
		&slaStatus,
		&lastInteraction,
		&preview,
		&channel,
		&tagsJSON,
		&dealStatus,
		&lostReason,
		&feedback,
		&interestValue,
		&commissionPercentage,
		&priceRange,
		&familyIncome,
		&purchasePurpose,
		&seekingFinancing,
		&works,
		&role,
		&company,
		&profession,
		&postalCode,
		&address,
		&addressNumber,
		&addressComplement,
		&neighborhood,
		&city,
		&state,
		&isOwnResource,
		&firstTouchAt,
		&firstTouchSeconds,
		&firstTouchChannel,
		&firstTouchActorUserID,
		&firstResponseAt,
		&firstResponseSeconds,
		&firstResponseChannel,
		&firstResponseAuto,
		&firstResponseActorUserID,
		&stageEnteredAt,
		&lastEntry,
		&contact.ReentryCount,
		&contact.RedistributionCount,
		&lastContactAt,
		&nextFollowUpAt,
		&wonAt,
		&lostAt,
		&createdBy,
		&metadataJSON,
		&metaLeadID,
		&metaFormID,
		&metaCampaignID,
		&metaAdsetID,
		&metaAdID,
		&metaClickID,
		&campaignID,
		&campaignName,
		&adsetID,
		&adsetName,
		&adID,
		&adName,
		&formID,
		&formName,
		&platform,
		&utmSource,
		&utmMedium,
		&utmCampaign,
		&utmContent,
		&utmTerm,
		&creativeURL,
		&creativeVideoURL,
		&creativeInstagramURL,
		&metaPayloadJSON,
		&metaRawPayloadJSON,
	); err != nil {
		return Contact{}, err
	}
	contact.Phone = textPtr(phone)
	contact.Email = textPtr(email)
	contact.WhatsApp = textPtr(whatsApp)
	contact.WhatsAppAvatarURL = textPtr(avatar)
	contact.PipelineID = textPtr(pipelineID)
	contact.PipelineName = textPtr(pipelineName)
	contact.StageID = textPtr(stageID)
	contact.StageName = textPtr(stageName)
	contact.StageColor = textPtr(stageColor)
	contact.AssignedUserID = textPtr(assignedUserID)
	contact.AssigneeName = textPtr(assigneeName)
	contact.AssigneeAvatar = textPtr(assigneeAvatar)
	contact.SourceDetail = textPtr(sourceDetail)
	contact.SourceSessionID = textPtr(sourceSessionID)
	contact.SourceWebhookID = textPtr(sourceWebhookID)
	contact.VisitorSessionID = textPtr(visitorSessionID)
	contact.Priority = textPtr(priority)
	contact.Message = textPtr(message)
	contact.InitialMessage = textPtr(initialMessage)
	contact.PropertyCode = textPtr(propertyCode)
	contact.PropertyID = textPtr(propertyID)
	contact.InterestPropertyID = textPtr(interestPropertyID)
	contact.InterestPlanID = textPtr(interestPlanID)
	contact.SLAStatus = textPtr(slaStatus)
	contact.LastInteractionAt = timePtr(lastInteraction)
	contact.LastInteractionPreview = textPtr(preview)
	contact.LastInteractionChannel = textPtr(channel)
	contact.DealStatus = textPtr(dealStatus)
	contact.LostReason = textPtr(lostReason)
	contact.Feedback = textPtr(feedback)
	contact.InterestValue = textPtr(interestValue)
	contact.CommissionPercentage = textPtr(commissionPercentage)
	contact.PriceRange = textPtr(priceRange)
	contact.FamilyIncome = textPtr(familyIncome)
	contact.PurchasePurpose = textPtr(purchasePurpose)
	contact.SeekingFinancing = boolPtr(seekingFinancing)
	contact.Works = boolPtr(works)
	contact.Role = textPtr(role)
	contact.Company = textPtr(company)
	contact.Profession = textPtr(profession)
	contact.PostalCode = textPtr(postalCode)
	contact.Address = textPtr(address)
	contact.AddressNumber = textPtr(addressNumber)
	contact.AddressComplement = textPtr(addressComplement)
	contact.Neighborhood = textPtr(neighborhood)
	contact.City = textPtr(city)
	contact.State = textPtr(state)
	contact.IsOwnResource = boolPtr(isOwnResource)
	contact.FirstTouchAt = timePtr(firstTouchAt)
	contact.FirstTouchSeconds = int32Ptr(firstTouchSeconds)
	contact.FirstTouchChannel = textPtr(firstTouchChannel)
	contact.FirstTouchActorUserID = textPtr(firstTouchActorUserID)
	contact.FirstResponseAt = timePtr(firstResponseAt)
	contact.FirstResponseSeconds = int32Ptr(firstResponseSeconds)
	contact.FirstResponseChannel = textPtr(firstResponseChannel)
	contact.FirstResponseAuto = boolPtr(firstResponseAuto)
	contact.FirstResponseActorID = textPtr(firstResponseActorUserID)
	contact.StageEnteredAt = timePtr(stageEnteredAt)
	contact.LastEntryAt = timePtr(lastEntry)
	contact.LastContactAt = timePtr(lastContactAt)
	contact.NextFollowUpAt = timePtr(nextFollowUpAt)
	contact.WonAt = timePtr(wonAt)
	contact.LostAt = timePtr(lostAt)
	contact.CreatedBy = textPtr(createdBy)
	contact.MetadataJSON = textPtr(metadataJSON)
	contact.MetaLeadID = textPtr(metaLeadID)
	contact.MetaFormID = textPtr(metaFormID)
	contact.MetaCampaignID = textPtr(metaCampaignID)
	contact.MetaAdsetID = textPtr(metaAdsetID)
	contact.MetaAdID = textPtr(metaAdID)
	contact.MetaClickID = textPtr(metaClickID)
	contact.CampaignID = textPtr(campaignID)
	contact.CampaignName = textPtr(campaignName)
	contact.AdsetID = textPtr(adsetID)
	contact.AdsetName = textPtr(adsetName)
	contact.AdID = textPtr(adID)
	contact.AdName = textPtr(adName)
	contact.FormID = textPtr(formID)
	contact.FormName = textPtr(formName)
	contact.Platform = textPtr(platform)
	contact.UTMSource = textPtr(utmSource)
	contact.UTMMedium = textPtr(utmMedium)
	contact.UTMCampaign = textPtr(utmCampaign)
	contact.UTMContent = textPtr(utmContent)
	contact.UTMTerm = textPtr(utmTerm)
	contact.CreativeURL = textPtr(creativeURL)
	contact.CreativeVideoURL = textPtr(creativeVideoURL)
	contact.CreativeInstagramURL = textPtr(creativeInstagramURL)
	contact.MetaPayloadJSON = textPtr(metaPayloadJSON)
	contact.MetaRawPayloadJSON = textPtr(metaRawPayloadJSON)
	contact.Tags = []ContactTag{}
	if strings.TrimSpace(tagsJSON) != "" {
		_ = json.Unmarshal([]byte(tagsJSON), &contact.Tags)
	}
	return contact, nil
}

func int32Ptr(value pgtype.Int4) *int32 {
	if !value.Valid {
		return nil
	}
	v := value.Int32
	return &v
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

	storageBucketExpression := "null::text"
	if columns.StorageBucket {
		storageBucketExpression = "la.storage_bucket"
	}

	storagePathExpression := "null::text"
	if columns.StoragePath {
		storagePathExpression = "la.storage_path"
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
		` + storageBucketExpression + `,
		` + storagePathExpression + `,
		la.created_at`
}

func scanLeadAttachment(row scanner) (LeadAttachment, error) {
	var attachment LeadAttachment
	var fileType, createdBy, messageID, storageBucket, storagePath pgtype.Text
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
		&storageBucket,
		&storagePath,
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
	attachment.StorageBucket = textValue(storageBucket)
	attachment.StoragePath = textValue(storagePath)
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

	if err == nil && repo.gamificationRecorder != nil {
		tenantCtx := tenant.Context{OrganizationID: organizationID, UserID: userID}
		if taskType != nil && *taskType == "call" {
			_ = repo.gamificationRecorder.RecordAction(ctx, tenantCtx, "call_made", 1, taskID)

			if outcome != nil && (strings.EqualFold(*outcome, "efetivo") || strings.EqualFold(*outcome, "contato efetivo")) {
				_ = repo.gamificationRecorder.RecordAction(ctx, tenantCtx, "contact_made", 1, taskID)
			}
		}
	}

	return err
}

func storagePathFromPublicURL(fileURL string, _ string) string {
	if path := storagePathFromPublicStorageURL(fileURL); path != "" {
		return path
	}

	return ""
}

func storagePathFromPublicStorageURL(fileURL string) string {
	rawURL := strings.TrimSpace(fileURL)
	if rawURL == "" {
		return ""
	}

	parsed, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}

	for _, prefix := range []string{"/storage/v1/object/public/", "/storage/v1/object/sign/"} {
		path := parsed.Path
		index := strings.Index(path, prefix)
		if index < 0 {
			continue
		}

		remainder := strings.Trim(path[index+len(prefix):], "/")
		bucket, objectPath, ok := strings.Cut(remainder, "/")
		if !ok || bucket != leadAttachmentBucket {
			continue
		}

		objectPath, err = url.PathUnescape(strings.Trim(objectPath, "/"))
		if err != nil {
			return ""
		}
		return objectPath
	}

	return ""
}

func (repo Repository) signLeadAttachmentURL(ctx context.Context, attachment *LeadAttachment) {
	if attachment == nil {
		return
	}

	fileURLPath := storagePathFromPublicStorageURL(attachment.FileURL)
	path := fileURLPath
	if path == "" {
		storedPath := strings.TrimSpace(attachment.StoragePath)
		if storedPath != "" && !strings.HasPrefix(storedPath, "lead-attachments/") {
			path = storedPath
		}
	}
	if path == "" {
		return
	}

	bucket := strings.TrimSpace(attachment.StorageBucket)
	if bucket == "" {
		bucket = leadAttachmentBucket
	}

	signedURL, err := repo.storage.signedURL(ctx, bucket, path, leadAttachmentSignedURLTTLSeconds)
	if err == nil && signedURL != "" {
		attachment.FileURL = signedURL
	}
}

func optionalStringFromPointer(value *string, maxLength int) *string {
	if value == nil {
		return nil
	}
	return optionalString(*value, maxLength)
}
