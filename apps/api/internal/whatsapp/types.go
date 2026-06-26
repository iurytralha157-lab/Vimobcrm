package whatsapp

import (
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

var (
	ErrInvalidInput         = errors.New("invalid whatsapp input")
	ErrInvalidReference     = errors.New("invalid whatsapp reference")
	ErrSessionNotFound      = errors.New("whatsapp session not found")
	ErrConversationNotFound = errors.New("whatsapp conversation not found")
	ErrMessageNotFound      = errors.New("whatsapp message not found")
	ErrProviderFailed       = errors.New("whatsapp provider operation failed")
)

type Session struct {
	ID                    string         `json:"id"`
	OrganizationID        string         `json:"organization_id"`
	OwnerUserID           string         `json:"owner_user_id"`
	InstanceName          string         `json:"instance_name"`
	DisplayName           *string        `json:"display_name"`
	InstanceID            *string        `json:"instance_id"`
	Status                string         `json:"status"`
	PhoneNumber           *string        `json:"phone_number"`
	ProfileName           *string        `json:"profile_name"`
	ProfilePicture        *string        `json:"profile_picture"`
	IsActive              bool           `json:"is_active"`
	IsNotificationSession bool           `json:"is_notification_session"`
	Provider              string         `json:"provider"`
	AdvancedSettings      map[string]any `json:"advanced_settings,omitempty"`
	CreatedAt             time.Time      `json:"created_at"`
	UpdatedAt             time.Time      `json:"updated_at"`
	LastConnectedAt       *time.Time     `json:"last_connected_at"`
	Owner                 *OwnerRef      `json:"owner,omitempty"`
}

type OwnerRef struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
}

type SessionAccess struct {
	ID              string      `json:"id"`
	SessionID       string      `json:"session_id"`
	UserID          string      `json:"user_id"`
	AccessMode      string      `json:"access_mode"`
	CanView         bool        `json:"can_view"`
	CanRead         bool        `json:"can_read"`
	CanSend         bool        `json:"can_send"`
	OnlyLeadsAccess bool        `json:"only_leads_access"`
	GrantedBy       *string     `json:"granted_by"`
	CreatedAt       time.Time   `json:"created_at"`
	User            *AccessUser `json:"user,omitempty"`
}

type AccessUser struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
}

type Conversation struct {
	ID                string       `json:"id"`
	SessionID         string       `json:"session_id"`
	LeadID            *string      `json:"lead_id"`
	RemoteJID         string       `json:"remote_jid"`
	ContactName       *string      `json:"contact_name"`
	ContactPhone      *string      `json:"contact_phone"`
	ContactPicture    *string      `json:"contact_picture"`
	ContactPresence   *string      `json:"contact_presence"`
	PresenceUpdatedAt *time.Time   `json:"presence_updated_at"`
	LastMessage       *string      `json:"last_message"`
	LastMessageAt     *time.Time   `json:"last_message_at"`
	UnreadCount       int          `json:"unread_count"`
	IsGroup           bool         `json:"is_group"`
	ArchivedAt        *time.Time   `json:"archived_at"`
	DeletedAt         *time.Time   `json:"deleted_at"`
	CreatedAt         time.Time    `json:"created_at"`
	UpdatedAt         time.Time    `json:"updated_at"`
	Session           *SessionLite `json:"session,omitempty"`
	Lead              *LeadLite    `json:"lead,omitempty"`
}

type SessionLite struct {
	ID             string  `json:"id"`
	InstanceName   string  `json:"instance_name"`
	PhoneNumber    *string `json:"phone_number"`
	Status         string  `json:"status"`
	OrganizationID string  `json:"organization_id"`
	Provider       *string `json:"provider"`
}

type LeadLite struct {
	ID                string       `json:"id"`
	Name              string       `json:"name"`
	WhatsAppAvatarURL *string      `json:"whatsapp_avatar_url,omitempty"`
	PipelineID        *string      `json:"pipeline_id,omitempty"`
	StageID           *string      `json:"stage_id,omitempty"`
	Pipeline          *NameRef     `json:"pipeline,omitempty"`
	Stage             *StageRef    `json:"stage,omitempty"`
	Tags              []LeadTagRef `json:"tags,omitempty"`
}

type NameRef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type StageRef struct {
	ID    string  `json:"id"`
	Name  string  `json:"name"`
	Color *string `json:"color"`
}

type LeadTagRef struct {
	Tag TagRef `json:"tag"`
}

type TagRef struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

type Message struct {
	ID                  string         `json:"id"`
	ConversationID      string         `json:"conversation_id"`
	SessionID           string         `json:"session_id"`
	MessageID           string         `json:"message_id"`
	ClientMessageID     *string        `json:"client_message_id,omitempty"`
	FromMe              bool           `json:"from_me"`
	Content             *string        `json:"content"`
	MessageType         string         `json:"message_type"`
	MediaURL            *string        `json:"media_url"`
	MediaMimeType       *string        `json:"media_mime_type"`
	MediaStatus         *string        `json:"media_status,omitempty"`
	MediaError          *string        `json:"media_error,omitempty"`
	MediaSize           *int64         `json:"media_size,omitempty"`
	MediaStoragePath    *string        `json:"media_storage_path,omitempty"`
	RemoteJID           *string        `json:"remote_jid,omitempty"`
	ReactionToMessageID *string        `json:"reaction_to_message_id,omitempty"`
	ReactionEmoji       *string        `json:"reaction_emoji,omitempty"`
	ReactionSenderJID   *string        `json:"reaction_sender_jid,omitempty"`
	ReactionSenderName  *string        `json:"reaction_sender_name,omitempty"`
	Metadata            map[string]any `json:"metadata,omitempty"`
	Status              string         `json:"status"`
	SentAt              time.Time      `json:"sent_at"`
	DeliveredAt         *time.Time     `json:"delivered_at"`
	ReadAt              *time.Time     `json:"read_at"`
	SenderJID           *string        `json:"sender_jid"`
	SenderName          *string        `json:"sender_name"`
}

type MessagePage struct {
	Messages   []Message  `json:"messages"`
	NextCursor *time.Time `json:"nextCursor"`
}

type HistoryAccessResponse struct {
	Conversation *Conversation `json:"conversation,omitempty"`
	Messages     []Message     `json:"messages"`
}

type Envelope[T any] struct {
	Data T `json:"data"`
}

type ConversationListFilter struct {
	SessionID          string
	SessionIDs         []string
	HideGroups         bool
	ShowArchived       bool
	AccessibleProvided bool
}

type MessageFilter struct {
	Limit  int
	Cursor *time.Time
}

type FindConversationFilter struct {
	Phone     string
	LeadID    string
	SessionID string
}

type HistoryAccessFilter struct {
	ConversationID string
	LeadID         string
	AllMessages    bool
}

type GrantAccessRequest struct {
	UserID     string `json:"userId"`
	CanView    *bool  `json:"canView,omitempty"`
	CanSend    *bool  `json:"canSend,omitempty"`
	AccessMode string `json:"accessMode,omitempty"`
}

type CreateSessionRequest struct {
	DisplayName string `json:"displayName"`
	Provider    string `json:"provider,omitempty"`
}

type createSessionInput struct {
	DisplayName string
	Provider    string
}

type grantAccessInput struct {
	UserID     string
	CanView    bool
	CanSend    bool
	AccessMode string
}

type LinkLeadRequest struct {
	LeadID string `json:"leadId"`
}

type ArchiveRequest struct {
	Archive bool `json:"archive"`
}

type SessionOperationResponse struct {
	Session       Session `json:"session"`
	EvolutionData any     `json:"evolutionData,omitempty"`
}

type QRCodeResponse struct {
	Base64 string `json:"base64,omitempty"`
	QRCode string `json:"qrcode,omitempty"`
}

type ConnectionStatusResponse struct {
	Connected        bool           `json:"connected"`
	Status           string         `json:"status"`
	State            string         `json:"state,omitempty"`
	InstanceNotFound bool           `json:"instanceNotFound,omitempty"`
	Instance         map[string]any `json:"instance,omitempty"`
	RawResponse      any            `json:"rawResponse,omitempty"`
	RawStatus        any            `json:"rawStatus,omitempty"`
}

type ToggleNotificationRequest struct {
	Enabled bool `json:"enabled"`
}

type SendMessageRequest struct {
	Text            string  `json:"text"`
	MediaURL        *string `json:"mediaUrl,omitempty"`
	MediaType       *string `json:"mediaType,omitempty"`
	Base64          *string `json:"base64,omitempty"`
	Mimetype        *string `json:"mimetype,omitempty"`
	Filename        *string `json:"filename,omitempty"`
	SendSessionID   *string `json:"sendSessionId,omitempty"`
	ClientMessageID *string `json:"clientMessageId,omitempty"`
}

type sendMessageInput struct {
	Text            string
	MediaURL        string
	MediaType       string
	Base64          string
	Mimetype        string
	Filename        string
	SendSessionID   string
	ClientMessageID string
}

type SendMessageResponse struct {
	ClientMessageID string         `json:"clientMessageId"`
	ConversationID  string         `json:"conversationId"`
	ProviderData    map[string]any `json:"providerData,omitempty"`
}

type ProviderActionRequest struct {
	Action     string         `json:"action"`
	SessionID  string         `json:"session_id"`
	InstanceID string         `json:"instance_id,omitempty"`
	Body       map[string]any `json:"body,omitempty"`
}

type ProviderActionResponse struct {
	OK     bool   `json:"ok"`
	Status int    `json:"status,omitempty"`
	Error  string `json:"error,omitempty"`
	Data   any    `json:"data,omitempty"`
}

type WhatsAppLabel struct {
	ID             string `json:"id"`
	SessionID      string `json:"session_id"`
	OrganizationID string `json:"organization_id"`
	RemoteLabelID  string `json:"remote_label_id"`
	Name           string `json:"name"`
	Color          *int   `json:"color"`
	Predefined     bool   `json:"predefined"`
	CreatedAt      string `json:"created_at"`
}

type AssignLabelRequest struct {
	RemoteJID      string `json:"remoteJid"`
	LabelID        string `json:"labelId"`
	ConversationID string `json:"conversationId"`
	Add            bool   `json:"add"`
}

type SyncLabelsResponse struct {
	Raw    any `json:"raw,omitempty"`
	Synced int `json:"synced"`
}

type WhatsAppGroup struct {
	ID             string  `json:"id"`
	SessionID      string  `json:"session_id"`
	OrganizationID string  `json:"organization_id"`
	GroupJID       string  `json:"group_jid"`
	Subject        *string `json:"subject"`
	Description    *string `json:"description"`
	PictureURL     *string `json:"picture_url"`
	Participants   []any   `json:"participants"`
	OwnerJID       *string `json:"owner_jid"`
	IsAnnounce     bool    `json:"is_announce"`
	UpdatedAt      string  `json:"updated_at"`
}

type GroupJIDRequest struct {
	JID string `json:"jid"`
}

type UpdateGroupRequest struct {
	JID   string `json:"jid"`
	Field string `json:"field"`
	Value string `json:"value"`
}

type CheckNumbersRequest struct {
	Numbers []string `json:"numbers"`
}

type AvatarRequest struct {
	JID string `json:"jid"`
}

type HistorySyncRequest struct {
	JID string `json:"jid,omitempty"`
}

type StartConversationRequest struct {
	Phone     string `json:"phone"`
	SessionID string `json:"sessionId"`
	LeadID    string `json:"leadId,omitempty"`
	LeadName  string `json:"leadName,omitempty"`
}

func ParseConversationListFilter(values url.Values) (ConversationListFilter, error) {
	filter := ConversationListFilter{
		HideGroups:   parseBool(values.Get("hideGroups")),
		ShowArchived: parseBool(values.Get("showArchived")),
	}
	if raw := strings.TrimSpace(values.Get("sessionId")); raw != "" {
		value, ok := normalizeUUID(raw)
		if !ok {
			return ConversationListFilter{}, fmt.Errorf("%w: sessionId is invalid", ErrInvalidInput)
		}
		filter.SessionID = value
	}
	if raw := strings.TrimSpace(values.Get("sessionIds")); raw != "" {
		filter.AccessibleProvided = true
		for _, item := range strings.Split(raw, ",") {
			item = strings.TrimSpace(item)
			if item == "" {
				continue
			}
			value, ok := normalizeUUID(item)
			if !ok {
				return ConversationListFilter{}, fmt.Errorf("%w: sessionIds contains invalid uuid", ErrInvalidInput)
			}
			filter.SessionIDs = append(filter.SessionIDs, value)
		}
	}

	return filter, nil
}

func ParseMessageFilter(values url.Values) (MessageFilter, error) {
	limit := 50
	if raw := strings.TrimSpace(values.Get("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 200 {
			return MessageFilter{}, fmt.Errorf("%w: limit is invalid", ErrInvalidInput)
		}
		limit = value
	}

	filter := MessageFilter{Limit: limit}
	if raw := strings.TrimSpace(values.Get("cursor")); raw != "" {
		value, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			return MessageFilter{}, fmt.Errorf("%w: cursor is invalid", ErrInvalidInput)
		}
		filter.Cursor = &value
	}

	return filter, nil
}

func ParseFindConversationFilter(values url.Values) (FindConversationFilter, error) {
	filter := FindConversationFilter{
		Phone: strings.TrimSpace(values.Get("phone")),
	}
	if raw := strings.TrimSpace(values.Get("leadId")); raw != "" {
		value, ok := normalizeUUID(raw)
		if !ok {
			return FindConversationFilter{}, fmt.Errorf("%w: leadId is invalid", ErrInvalidInput)
		}
		filter.LeadID = value
	}
	if raw := strings.TrimSpace(values.Get("sessionId")); raw != "" {
		value, ok := normalizeUUID(raw)
		if !ok {
			return FindConversationFilter{}, fmt.Errorf("%w: sessionId is invalid", ErrInvalidInput)
		}
		filter.SessionID = value
	}

	return filter, nil
}

func ParseHistoryAccessFilter(values url.Values) (HistoryAccessFilter, error) {
	filter := HistoryAccessFilter{AllMessages: parseBool(values.Get("allMessages"))}
	if raw := strings.TrimSpace(values.Get("conversationId")); raw != "" {
		value, ok := normalizeUUID(raw)
		if !ok {
			return HistoryAccessFilter{}, fmt.Errorf("%w: conversationId is invalid", ErrInvalidInput)
		}
		filter.ConversationID = value
	}
	if raw := strings.TrimSpace(values.Get("leadId")); raw != "" {
		value, ok := normalizeUUID(raw)
		if !ok {
			return HistoryAccessFilter{}, fmt.Errorf("%w: leadId is invalid", ErrInvalidInput)
		}
		filter.LeadID = value
	}
	if filter.ConversationID == "" && filter.LeadID == "" {
		return HistoryAccessFilter{}, fmt.Errorf("%w: conversationId or leadId is required", ErrInvalidInput)
	}

	return filter, nil
}

func (request CreateSessionRequest) Validate() (createSessionInput, error) {
	displayName := strings.TrimSpace(request.DisplayName)
	if len(displayName) < 2 {
		return createSessionInput{}, fmt.Errorf("%w: displayName must have at least 2 characters", ErrInvalidInput)
	}
	if len(displayName) > 80 {
		displayName = displayName[:80]
	}

	provider := strings.TrimSpace(request.Provider)
	if provider == "" {
		provider = "evolution_go"
	}
	if provider != "evolution_go" {
		return createSessionInput{}, fmt.Errorf("%w: legacy Evolution provider is disabled", ErrInvalidInput)
	}

	return createSessionInput{DisplayName: displayName, Provider: provider}, nil
}

func (request GrantAccessRequest) Validate() (grantAccessInput, error) {
	userID, ok := normalizeUUID(request.UserID)
	if !ok {
		return grantAccessInput{}, fmt.Errorf("%w: userId is invalid", ErrInvalidInput)
	}

	accessMode := strings.TrimSpace(request.AccessMode)
	if accessMode == "" {
		accessMode = "assigned_leads_only"
	}
	if !validEnum(accessMode, "assigned_leads_only", "team_leads", "all_leads", "full_inbox") {
		return grantAccessInput{}, fmt.Errorf("%w: accessMode is invalid", ErrInvalidInput)
	}

	return grantAccessInput{
		UserID:     userID,
		CanView:    boolWithDefault(request.CanView, true),
		CanSend:    boolWithDefault(request.CanSend, true),
		AccessMode: accessMode,
	}, nil
}

func (request SendMessageRequest) Validate() (sendMessageInput, error) {
	input := sendMessageInput{
		Text:            strings.TrimSpace(request.Text),
		MediaURL:        stringPtrValue(request.MediaURL),
		MediaType:       strings.TrimSpace(stringPtrValue(request.MediaType)),
		Base64:          strings.TrimSpace(stringPtrValue(request.Base64)),
		Mimetype:        strings.TrimSpace(stringPtrValue(request.Mimetype)),
		Filename:        strings.TrimSpace(stringPtrValue(request.Filename)),
		SendSessionID:   strings.TrimSpace(stringPtrValue(request.SendSessionID)),
		ClientMessageID: strings.TrimSpace(stringPtrValue(request.ClientMessageID)),
	}

	if input.Text == "" && input.MediaURL == "" && input.Base64 == "" {
		return sendMessageInput{}, fmt.Errorf("%w: text or media is required", ErrInvalidInput)
	}
	if input.MediaType != "" && !validEnum(input.MediaType, "text", "image", "video", "document", "audio", "sticker") {
		return sendMessageInput{}, fmt.Errorf("%w: mediaType is invalid", ErrInvalidInput)
	}
	if input.MediaType == "" {
		if input.MediaURL != "" || input.Base64 != "" {
			input.MediaType = "image"
		} else {
			input.MediaType = "text"
		}
	}
	if input.Mimetype == "" && (input.MediaURL != "" || input.Base64 != "") {
		input.Mimetype = "application/octet-stream"
	}
	if input.SendSessionID != "" {
		value, ok := normalizeUUID(input.SendSessionID)
		if !ok {
			return sendMessageInput{}, fmt.Errorf("%w: sendSessionId is invalid", ErrInvalidInput)
		}
		input.SendSessionID = value
	}

	return input, nil
}

func (request LinkLeadRequest) Validate() (string, error) {
	value, ok := normalizeUUID(request.LeadID)
	if !ok {
		return "", fmt.Errorf("%w: leadId is invalid", ErrInvalidInput)
	}

	return value, nil
}

func stringPtrValue(value *string) string {
	if value == nil {
		return ""
	}

	return *value
}

func parseBool(value string) bool {
	value = strings.ToLower(strings.TrimSpace(value))
	return value == "true" || value == "1" || value == "yes"
}

func boolWithDefault(value *bool, fallback bool) bool {
	if value == nil {
		return fallback
	}

	return *value
}

func validEnum(value string, allowed ...string) bool {
	for _, candidate := range allowed {
		if value == candidate {
			return true
		}
	}

	return false
}

func normalizeUUID(value string) (string, bool) {
	var uuid pgtype.UUID
	if err := uuid.Scan(strings.TrimSpace(value)); err != nil {
		return "", false
	}
	if !uuid.Valid {
		return "", false
	}

	return uuid.String(), true
}
