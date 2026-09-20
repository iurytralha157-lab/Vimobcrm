package whatsapp

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/pgvalue"
)

var (
	ErrInvalidInput               = errors.New("invalid whatsapp input")
	ErrInvalidReference           = errors.New("invalid whatsapp reference")
	ErrSessionNotFound            = errors.New("whatsapp session not found")
	ErrConversationNotFound       = errors.New("whatsapp conversation not found")
	ErrMessageNotFound            = errors.New("whatsapp message not found")
	ErrProviderFailed             = errors.New("whatsapp provider operation failed")
	ErrProviderOutcomeUnknown     = errors.New("whatsapp provider outcome is unknown")
	ErrFeatureUnavailable         = errors.New("whatsapp feature unavailable")
	ErrConversationBindingChanged = errors.New("whatsapp conversation binding changed")
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

func (session Session) MarshalJSON() ([]byte, error) {
	type sessionJSON Session
	safe := sessionJSON(session)
	safe.AdvancedSettings = redactWhatsAppSessionSettings(session.AdvancedSettings)
	return json.Marshal(safe)
}

func redactWhatsAppSessionSettings(settings map[string]any) map[string]any {
	if len(settings) == 0 {
		return settings
	}
	safe := make(map[string]any, len(settings))
	for key, value := range settings {
		normalized := strings.ToLower(strings.TrimSpace(key))
		if normalized == "token" ||
			strings.Contains(normalized, "webhook_url") ||
			strings.Contains(normalized, "token") ||
			strings.Contains(normalized, "secret") ||
			strings.Contains(normalized, "password") ||
			strings.Contains(normalized, "api_key") ||
			strings.Contains(normalized, "apikey") ||
			strings.Contains(normalized, "qr_code") {
			continue
		}
		switch typed := value.(type) {
		case map[string]any:
			safe[key] = redactWhatsAppSessionSettings(typed)
		default:
			safe[key] = value
		}
	}
	return safe
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
	ID                 string       `json:"id"`
	SessionID          string       `json:"session_id"`
	LeadID             *string      `json:"lead_id"`
	RemoteJID          string       `json:"remote_jid"`
	ContactName        *string      `json:"contact_name"`
	ContactPhone       *string      `json:"contact_phone"`
	ContactPicture     *string      `json:"contact_picture"`
	ContactPresence    *string      `json:"contact_presence"`
	PresenceUpdatedAt  *time.Time   `json:"presence_updated_at"`
	LastMessage        *string      `json:"last_message"`
	LastMessageAt      *time.Time   `json:"last_message_at"`
	UnreadCount        int          `json:"unread_count"`
	IsGroup            bool         `json:"is_group"`
	ArchivedAt         *time.Time   `json:"archived_at"`
	DeletedAt          *time.Time   `json:"deleted_at"`
	CreatedAt          time.Time    `json:"created_at"`
	UpdatedAt          time.Time    `json:"updated_at"`
	HistoricalLeadView bool         `json:"historical_lead_view,omitempty"`
	Session            *SessionLite `json:"session,omitempty"`
	Lead               *LeadLite    `json:"lead,omitempty"`
}

// MarshalJSON keeps the operational Go model ergonomic while making missing
// historical session references explicit on the wire. An empty or fabricated
// UUID would break strict clients and could be mistaken for real provenance.
func (conversation Conversation) MarshalJSON() ([]byte, error) {
	type conversationJSON Conversation
	var sessionID *string
	if strings.TrimSpace(conversation.SessionID) != "" {
		value := conversation.SessionID
		sessionID = &value
	}

	return json.Marshal(struct {
		conversationJSON
		SessionID *string `json:"session_id"`
	}{
		conversationJSON: conversationJSON(conversation),
		SessionID:        sessionID,
	})
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
	ID                string           `json:"id"`
	Name              string           `json:"name"`
	WhatsAppAvatarURL *string          `json:"whatsapp_avatar_url,omitempty"`
	PipelineID        *string          `json:"pipeline_id,omitempty"`
	StageID           *string          `json:"stage_id,omitempty"`
	Pipeline          *NameRef         `json:"pipeline,omitempty"`
	Stage             *StageRef        `json:"stage,omitempty"`
	Assignee          *LeadAssigneeRef `json:"assignee,omitempty"`
	Tags              []LeadTagRef     `json:"tags,omitempty"`
}

type LeadAssigneeRef struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	AvatarURL *string `json:"avatar_url,omitempty"`
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
	SessionID           *string        `json:"session_id"`
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
	Messages   []Message `json:"messages"`
	NextCursor *string   `json:"nextCursor"`
}

type MessageMediaURL struct {
	MessageID string `json:"messageId"`
	URL       string `json:"url"`
	ExpiresIn int    `json:"expiresIn"`
}

type HistoryAccessResponse struct {
	Conversation  *Conversation  `json:"conversation,omitempty"`
	Conversations []Conversation `json:"conversations,omitempty"`
	Messages      []Message      `json:"messages"`
	NextCursor    *string        `json:"nextCursor"`
}

type Envelope[T any] struct {
	Data T   `json:"data"`
	Meta any `json:"meta,omitempty"`
}

type SessionQuota struct {
	MaxSessions     *int `json:"maxSessions,omitempty"`
	CurrentSessions int  `json:"currentSessions"`
	CanCreate       bool `json:"canCreate"`
}

type ConversationListFilter struct {
	SessionID           string
	SessionIDs          []string
	HideGroups          bool
	ShowArchived        bool
	OnlyLeads           bool
	WithoutLead         bool
	PendingReply        bool
	Search              string
	AccessibleProvided  bool
	Limit               int
	CursorSet           bool
	CursorLastMessageAt *time.Time
	CursorCreatedAt     time.Time
	CursorID            string
}

type ConversationListMeta struct {
	NextCursor *string `json:"nextCursor"`
}

type MessageFilter struct {
	Limit            int
	CursorAt         *time.Time
	CursorID         string
	IncludeMediaURLs bool
	ExpectedLeadID   string
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
	MessageFilter
}

// Legacy web clients request the complete lead history with allMessages=true.
// The paginated client no longer uses this path, but keeping a bounded bridge
// prevents an API-first rolling deploy from silently truncating existing CRM
// history. The current production maximum is below this ceiling.
const legacyAllMessagesLimit = 10_000

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
	LeadID                 string `json:"leadId"`
	ExpectedPreviousLeadID string `json:"expectedPreviousLeadId"`
}

type ArchiveRequest struct {
	Archive        bool   `json:"archive"`
	ExpectedLeadID string `json:"expectedLeadId"`
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

type ToggleAutoReplyRequest struct {
	Enabled              bool    `json:"enabled"`
	AgentID              string  `json:"agentId,omitempty"`
	FollowUpEnabled      *bool   `json:"followUpEnabled,omitempty"`
	FollowUpIntervalDays *int    `json:"followUpIntervalDays,omitempty"`
	FollowUpTemplate     *string `json:"followUpTemplate,omitempty"`
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
	ExpectedLeadID  string  `json:"expectedLeadId"`
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
	ExpectedLeadID  string
}

type SendMessageResponse struct {
	ClientMessageID string         `json:"clientMessageId"`
	ConversationID  string         `json:"conversationId"`
	Status          string         `json:"status"`
	Message         *Message       `json:"message,omitempty"`
	ProviderData    map[string]any `json:"providerData,omitempty"`
}

type ReactToMessageRequest struct {
	Emoji            string `json:"emoji"`
	ClientReactionID string `json:"clientReactionId"`
	ExpectedLeadID   string `json:"expectedLeadId"`
}

type reactToMessageInput struct {
	Emoji            string
	ClientReactionID string
	ExpectedLeadID   string
}

type ReactToMessageResponse struct {
	ClientReactionID        string   `json:"clientReactionId"`
	ConversationID          string   `json:"conversationId"`
	TargetMessageID         string   `json:"targetMessageId"`
	TargetProviderMessageID string   `json:"targetProviderMessageId"`
	Status                  string   `json:"status"`
	Reaction                *Message `json:"reaction,omitempty"`
	LeadID                  string   `json:"-"`
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
	Phone                  string `json:"phone"`
	SessionID              string `json:"sessionId"`
	LeadID                 string `json:"leadId,omitempty"`
	LeadName               string `json:"leadName,omitempty"`
	ExpectedPreviousLeadID string `json:"expectedPreviousLeadId"`
}

func ParseConversationListFilter(values url.Values) (ConversationListFilter, error) {
	filter := ConversationListFilter{
		HideGroups:   parseBool(values.Get("hideGroups")),
		ShowArchived: parseBool(values.Get("showArchived")),
		OnlyLeads:    parseBool(values.Get("onlyLeads")),
		WithoutLead:  parseBool(values.Get("withoutLead")),
		PendingReply: parseBool(values.Get("pendingReply")),
		Search:       strings.TrimSpace(values.Get("search")),
		Limit:        80,
	}
	if filter.OnlyLeads && filter.WithoutLead {
		return ConversationListFilter{}, fmt.Errorf("%w: lead filters are mutually exclusive", ErrInvalidInput)
	}
	if raw := strings.TrimSpace(values.Get("sessionId")); raw != "" {
		value, ok := normalizeUUID(raw)
		if !ok {
			return ConversationListFilter{}, fmt.Errorf("%w: sessionId is invalid", ErrInvalidInput)
		}
		filter.SessionID = value
	}
	if values.Has("sessionIds") {
		filter.AccessibleProvided = true
		raw := strings.TrimSpace(values.Get("sessionIds"))
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
	if raw := strings.TrimSpace(values.Get("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value <= 0 {
			return ConversationListFilter{}, fmt.Errorf("%w: limit is invalid", ErrInvalidInput)
		}
		filter.Limit = value
	}
	if filter.Limit > 120 {
		filter.Limit = 120
	}
	if raw := strings.TrimSpace(values.Get("cursor")); raw != "" {
		parts := strings.Split(raw, "|")
		if len(parts) != 4 || parts[0] != "v1" {
			return ConversationListFilter{}, fmt.Errorf("%w: cursor is invalid", ErrInvalidInput)
		}
		if parts[1] != "-" {
			lastMessageAt, err := time.Parse(time.RFC3339Nano, parts[1])
			if err != nil {
				return ConversationListFilter{}, fmt.Errorf("%w: cursor is invalid", ErrInvalidInput)
			}
			filter.CursorLastMessageAt = &lastMessageAt
		}
		createdAt, err := time.Parse(time.RFC3339Nano, parts[2])
		if err != nil {
			return ConversationListFilter{}, fmt.Errorf("%w: cursor is invalid", ErrInvalidInput)
		}
		cursorID, ok := normalizeUUID(parts[3])
		if !ok {
			return ConversationListFilter{}, fmt.Errorf("%w: cursor is invalid", ErrInvalidInput)
		}
		filter.CursorSet = true
		filter.CursorCreatedAt = createdAt
		filter.CursorID = cursorID
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

	filter := MessageFilter{Limit: limit, IncludeMediaURLs: true}
	if raw := strings.TrimSpace(values.Get("expectedLeadId")); raw != "" {
		value, err := validateExpectedConversationLeadSnapshot(raw)
		if err != nil {
			return MessageFilter{}, fmt.Errorf("%w: expectedLeadId is invalid", ErrInvalidInput)
		}
		filter.ExpectedLeadID = value
	}
	if raw := strings.TrimSpace(values.Get("includeMediaUrls")); raw != "" {
		value, err := strconv.ParseBool(raw)
		if err != nil {
			return MessageFilter{}, fmt.Errorf("%w: includeMediaUrls is invalid", ErrInvalidInput)
		}
		filter.IncludeMediaURLs = value
	}
	if raw := strings.TrimSpace(values.Get("cursor")); raw != "" {
		parts := strings.Split(raw, "|")
		if len(parts) > 2 {
			return MessageFilter{}, fmt.Errorf("%w: cursor is invalid", ErrInvalidInput)
		}
		value, err := time.Parse(time.RFC3339Nano, parts[0])
		if err != nil {
			return MessageFilter{}, fmt.Errorf("%w: cursor is invalid", ErrInvalidInput)
		}
		filter.CursorAt = &value
		if len(parts) == 2 {
			cursorID, ok := normalizeUUID(parts[1])
			if !ok {
				return MessageFilter{}, fmt.Errorf("%w: cursor is invalid", ErrInvalidInput)
			}
			filter.CursorID = cursorID
		}
	}

	return filter, nil
}

// ParseExpectedLeadID validates the immutable conversation binding snapshot
// sent by a browser. A linked conversation uses the card UUID. An explicitly
// unlinked conversation uses the reserved sentinel and is authorized only
// while the row still has lead_id IS NULL. The value is intentionally
// required: a browser tab opened for card A (or while unlinked) must not
// silently read or mutate a different binding after the physical conversation
// is rebound.
func ParseExpectedLeadID(values url.Values) (string, error) {
	return validateExpectedConversationLeadSnapshot(values.Get("expectedLeadId"))
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
	messageFilter, err := ParseMessageFilter(values)
	if err != nil {
		return HistoryAccessFilter{}, err
	}
	filter := HistoryAccessFilter{
		AllMessages:   parseBool(values.Get("allMessages")),
		MessageFilter: messageFilter,
	}
	if filter.AllMessages && strings.TrimSpace(values.Get("limit")) == "" && strings.TrimSpace(values.Get("cursor")) == "" {
		filter.MessageFilter.Limit = legacyAllMessagesLimit
	}
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
	if filter.LeadID == "" {
		return HistoryAccessFilter{}, fmt.Errorf("%w: leadId is required", ErrInvalidInput)
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
	if !validEnum(accessMode, "assigned_leads_only") {
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
	expectedLeadID, err := validateExpectedLeadID(request.ExpectedLeadID)
	if err != nil {
		return sendMessageInput{}, err
	}
	input := sendMessageInput{
		Text:            strings.TrimSpace(request.Text),
		MediaURL:        stringPtrValue(request.MediaURL),
		MediaType:       strings.TrimSpace(stringPtrValue(request.MediaType)),
		Base64:          strings.TrimSpace(stringPtrValue(request.Base64)),
		Mimetype:        strings.TrimSpace(stringPtrValue(request.Mimetype)),
		Filename:        strings.TrimSpace(stringPtrValue(request.Filename)),
		SendSessionID:   strings.TrimSpace(stringPtrValue(request.SendSessionID)),
		ClientMessageID: strings.TrimSpace(stringPtrValue(request.ClientMessageID)),
		ExpectedLeadID:  expectedLeadID,
	}

	if input.Text == "" && input.MediaURL == "" && input.Base64 == "" {
		return sendMessageInput{}, fmt.Errorf("%w: text or media is required", ErrInvalidInput)
	}
	if len(input.Text) > 10000 || len(input.MediaURL) > 4000 || len(input.Mimetype) > 255 || len(input.Filename) > 255 {
		return sendMessageInput{}, fmt.Errorf("%w: message field exceeds the allowed size", ErrInvalidInput)
	}
	if len(input.ClientMessageID) > 200 {
		return sendMessageInput{}, fmt.Errorf("%w: clientMessageId is too long", ErrInvalidInput)
	}
	// Keep the encoded media below the handler's 8 MiB request ceiling after
	// accounting for JSON fields and a possible data-URL prefix.
	if len(input.Base64) > 7*1024*1024 {
		return sendMessageInput{}, fmt.Errorf("%w: media is too large", ErrInvalidInput)
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

func (request ReactToMessageRequest) Validate() (reactToMessageInput, error) {
	expectedLeadID, err := validateExpectedLeadID(request.ExpectedLeadID)
	if err != nil {
		return reactToMessageInput{}, err
	}
	emoji := strings.TrimSpace(request.Emoji)
	clientReactionID := strings.TrimSpace(request.ClientReactionID)
	if clientReactionID == "" || len(clientReactionID) > 200 {
		return reactToMessageInput{}, fmt.Errorf("%w: clientReactionId is required and must have at most 200 characters", ErrInvalidInput)
	}
	if !utf8.ValidString(emoji) || utf8.RuneCountInString(emoji) > 64 {
		return reactToMessageInput{}, fmt.Errorf("%w: emoji is invalid", ErrInvalidInput)
	}

	return reactToMessageInput{
		Emoji:            emoji,
		ClientReactionID: clientReactionID,
		ExpectedLeadID:   expectedLeadID,
	}, nil
}

func (request ArchiveRequest) Validate() (bool, string, error) {
	expectedLeadID, err := validateExpectedConversationLeadSnapshot(request.ExpectedLeadID)
	if err != nil {
		return false, "", err
	}
	return request.Archive, expectedLeadID, nil
}

func (request LinkLeadRequest) Validate() (string, string, error) {
	value, ok := normalizeUUID(request.LeadID)
	if !ok {
		return "", "", fmt.Errorf("%w: leadId is invalid", ErrInvalidInput)
	}
	expectedPreviousLeadID, err := validateExpectedPreviousConversationLeadID(request.ExpectedPreviousLeadID)
	if err != nil {
		return "", "", err
	}

	return value, expectedPreviousLeadID, nil
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
	return pgvalue.NormalizeUUID(value)
}

func validateExpectedLeadID(value string) (string, error) {
	normalized, ok := normalizeUUID(strings.TrimSpace(value))
	if !ok {
		return "", fmt.Errorf("%w: expectedLeadId is required and must be a valid UUID", ErrInvalidInput)
	}
	return normalized, nil
}

const unlinkedConversationLeadSnapshot = "unlinked"

func validateExpectedConversationLeadSnapshot(value string) (string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == unlinkedConversationLeadSnapshot {
		return trimmed, nil
	}

	return validateExpectedLeadID(trimmed)
}

func validateExpectedPreviousConversationLeadID(value string) (string, error) {
	normalized, err := validateExpectedConversationLeadSnapshot(value)
	if err != nil {
		return "", fmt.Errorf("%w: expectedPreviousLeadId is required and must be a valid UUID or unlinked", ErrInvalidInput)
	}
	return normalized, nil
}
