package leads

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type Notification struct {
	ID             string         `json:"id"`
	UserID         string         `json:"user_id"`
	OrganizationID string         `json:"organization_id"`
	Title          string         `json:"title"`
	Content        *string        `json:"content"`
	Type           string         `json:"type"`
	IsRead         bool           `json:"is_read"`
	LeadID         *string        `json:"lead_id"`
	TargetURL      string         `json:"target_url"`
	Metadata       map[string]any `json:"metadata"`
	CreatedAt      time.Time      `json:"created_at"`
}

type NotificationCursor struct {
	CreatedAt time.Time `json:"created_at"`
	ID        string    `json:"id"`
}

type NotificationListResponse struct {
	Data       []Notification `json:"data"`
	NextCursor *string        `json:"next_cursor"`
}

func encodeNotificationCursor(cursor NotificationCursor) string {
	payload, _ := json.Marshal(cursor)
	return base64.RawURLEncoding.EncodeToString(payload)
}

func decodeNotificationCursor(value string) (*NotificationCursor, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}
	if len(value) > 512 {
		return nil, fmt.Errorf("%w: notification cursor is invalid", ErrInvalidInput)
	}

	payload, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return nil, fmt.Errorf("%w: notification cursor is invalid", ErrInvalidInput)
	}

	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	var cursor NotificationCursor
	if err := decoder.Decode(&cursor); err != nil {
		return nil, fmt.Errorf("%w: notification cursor is invalid", ErrInvalidInput)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return nil, fmt.Errorf("%w: notification cursor is invalid", ErrInvalidInput)
	}

	id, valid := normalizeUUID(cursor.ID)
	if !valid || cursor.CreatedAt.IsZero() {
		return nil, fmt.Errorf("%w: notification cursor is invalid", ErrInvalidInput)
	}
	cursor.ID = id
	cursor.CreatedAt = cursor.CreatedAt.UTC()
	return &cursor, nil
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

type notificationRecipient struct {
	ID       string
	Name     string
	Email    string
	WhatsApp string
}

func (repo Repository) ListNotifications(ctx context.Context, tenantContext tenant.Context, userID string, cursor *NotificationCursor, limit int) ([]Notification, *NotificationCursor, error) {
	if userID == "" {
		userID = tenantContext.UserID
	}
	if userID != tenantContext.UserID {
		return nil, nil, tenant.ErrOrganizationAccessDenied
	}
	limit = max(1, min(limit, 100))
	hasCursor := cursor != nil
	cursorCreatedAt := time.Time{}
	cursorID := "00000000-0000-0000-0000-000000000000"
	if cursor != nil {
		cursorCreatedAt = cursor.CreatedAt
		cursorID = cursor.ID
	}
	rows, err := repo.db.Pool().Query(ctx, `
		select id::text, user_id::text, organization_id::text, title, content, type, coalesce(is_read, false), lead_id::text, coalesce(target_url, ''), coalesce(metadata, '{}'::jsonb)::text, created_at
		from public.notifications
		where organization_id = $1::uuid and user_id = $2::uuid
		  and `+billingNotificationVisibilitySQL("$1", "$4")+`
		  and (
		    not $5::boolean
		    or (created_at, id) < ($6::timestamptz, $7::uuid)
		  )
		order by created_at desc, id desc
		limit $3
	`, tenantContext.OrganizationID, userID, limit+1, tenantContext.UserID, hasCursor, cursorCreatedAt, cursorID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	notifications := []Notification{}
	for rows.Next() {
		notification, err := scanNotification(rows)
		if err != nil {
			return nil, nil, err
		}
		notification.Metadata = redactNotificationMetadataForAPI(notification.Metadata)
		notifications = append(notifications, notification)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	visiblePropertyIDs := repo.visibleNotificationPropertyIDs(ctx, tenantContext, notifications)
	for index := range notifications {
		notifications[index] = scopeNotificationPropertyForAPI(notifications[index], visiblePropertyIDs)
	}

	var nextCursor *NotificationCursor
	if len(notifications) > limit {
		notifications = notifications[:limit]
		last := notifications[len(notifications)-1]
		nextCursor = &NotificationCursor{CreatedAt: last.CreatedAt.UTC(), ID: last.ID}
	}
	return notifications, nextCursor, nil
}

func (repo Repository) CountUnreadNotifications(ctx context.Context, tenantContext tenant.Context, userID string) (int64, error) {
	if userID == "" {
		userID = tenantContext.UserID
	}
	if userID != tenantContext.UserID {
		return 0, tenant.ErrOrganizationAccessDenied
	}
	var count int64
	err := repo.db.Pool().QueryRow(ctx, `
		select count(*)::bigint
		from public.notifications
		where organization_id = $1::uuid
		  and user_id = $2::uuid
		  and coalesce(is_read, false) = false
		  and `+billingNotificationVisibilitySQL("$1", "$3")+`
	`, tenantContext.OrganizationID, userID, tenantContext.UserID).Scan(&count)
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
		  and `+billingNotificationVisibilitySQL("$2", "$3")+`
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
		  and `+billingNotificationVisibilitySQL("$1", "$2")+`
	`, tenantContext.OrganizationID, tenantContext.UserID)
	return err
}

func billingNotificationVisibilitySQL(organizationParameter string, userParameter string) string {
	return `(
		` + billingNotificationAuthorizationSQL(organizationParameter, userParameter) + `
		or (
			lower(coalesce(type, '')) <> 'billing'
			and left(lower(coalesce(metadata ->> 'event_key', '')), 8) <> 'billing_'
		)
	)`
}

func redactNotificationMetadataForAPI(metadata map[string]any) map[string]any {
	if metadata == nil {
		return map[string]any{}
	}
	delete(metadata, "email_confirmation_url")
	if variables, ok := metadata["variables"].(map[string]any); ok {
		delete(variables, "email_confirmation_url")
		metadata["variables"] = variables
	}
	return metadata
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
	if err := validatePublicNotificationEvent(eventKey); err != nil {
		return Notification{}, err
	}
	if _, err := repo.getNotificationRecipient(ctx, organizationID, userID); err != nil {
		return Notification{}, err
	}
	metadata = applyNotificationDispatchMetadata(metadata, eventKey, nil)
	return scanNotification(repo.db.Pool().QueryRow(ctx, `
		insert into public.notifications (user_id, organization_id, title, content, type, lead_id, is_read, metadata)
		values ($1::uuid, $2::uuid, $3, $4, $5, $6, false, $7::jsonb)
		returning id::text, user_id::text, organization_id::text, title, content, type, coalesce(is_read, false), lead_id::text, coalesce(target_url, ''), coalesce(metadata, '{}'::jsonb)::text, created_at
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
	if err := authorizePublicNotificationDispatch(tenantContext, eventKey, normalizedUserID, request.Channels); err != nil {
		return DispatchNotificationResult{}, err
	}

	if _, err := repo.getNotificationRecipient(ctx, tenantContext.OrganizationID, normalizedUserID); err != nil {
		return DispatchNotificationResult{}, err
	}

	request.EventKey = eventKey
	request.UserID = normalizedUserID
	notification, err := repo.enqueueDispatchNotification(ctx, tenantContext.OrganizationID, normalizedUserID, request)
	if err != nil {
		return DispatchNotificationResult{}, err
	}

	return DispatchNotificationResult{
		Success:      true,
		Queued:       true,
		Notification: &notification,
	}, nil
}

func (repo Repository) enqueueDispatchNotification(ctx context.Context, organizationID string, userID string, request DispatchNotificationRequest) (Notification, error) {
	return repo.enqueueDispatchNotificationWithQueryer(ctx, repo.db.Pool(), organizationID, userID, request)
}

func (repo Repository) enqueueDispatchNotificationWithQueryer(ctx context.Context, queryer notificationQueryer, organizationID string, userID string, request DispatchNotificationRequest) (Notification, error) {
	eventKey := trimMax(firstNotificationText(request.EventKey, request.TemplateSlug), 80)
	if eventKey == "" {
		return Notification{}, fmt.Errorf("%w: event_key is required", ErrInvalidInput)
	}

	variables := request.Variables
	if variables == nil {
		variables = map[string]any{}
	}
	request.Variables = variables
	title, content, notificationType := buildDispatchNotificationContent(eventKey, request, variables)
	if title == "" {
		return Notification{}, fmt.Errorf("%w: notification title is required", ErrInvalidInput)
	}
	if rendered, found, err := repo.renderNotificationTemplateContentWithQueryer(ctx, queryer, organizationID, eventKey, "system", variables); err != nil {
		return Notification{}, err
	} else if found {
		title = trimMax(firstNotificationText(rendered.Title, title), 180)
		content = trimMax(firstNotificationText(rendered.Message, content), 1_000)
	}

	dedupeKey := trimMax(request.DedupeKey, 180)
	if dedupeKey != "" {
		if existing, found, err := repo.findRecentNotificationByDedupeKeyWithQueryer(ctx, queryer, organizationID, userID, dedupeKey); err != nil {
			return Notification{}, err
		} else if found {
			return existing, nil
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

	notification, err := repo.createNotificationRowWithQueryer(ctx, queryer, organizationID, userID, title, content, notificationType, request.LeadID, metadata, dedupeKey != "")
	if errors.Is(err, pgx.ErrNoRows) && dedupeKey != "" {
		if existing, found, findErr := repo.findRecentNotificationByDedupeKeyWithQueryer(ctx, queryer, organizationID, userID, dedupeKey); findErr != nil {
			return Notification{}, findErr
		} else if found {
			return existing, nil
		}
	}
	if isNotificationDedupeConflict(err) && dedupeKey != "" {
		if existing, found, findErr := repo.findRecentNotificationByDedupeKeyWithQueryer(ctx, queryer, organizationID, userID, dedupeKey); findErr != nil {
			return Notification{}, findErr
		} else if found {
			return existing, nil
		}
	}
	return notification, err
}

func (repo Repository) createNotificationRow(ctx context.Context, organizationID string, userID string, title string, content string, notificationType string, leadID *string, metadata map[string]any) (Notification, error) {
	return repo.createNotificationRowWithQueryer(ctx, repo.db.Pool(), organizationID, userID, title, content, notificationType, leadID, metadata, false)
}

func (repo Repository) createNotificationRowWithQueryer(ctx context.Context, queryer notificationQueryer, organizationID string, userID string, title string, content string, notificationType string, leadID *string, metadata map[string]any, ignoreConflict bool) (Notification, error) {
	query := `
		insert into public.notifications (user_id, organization_id, title, content, type, lead_id, is_read, metadata)
		values ($1::uuid, $2::uuid, $3, $4, $5, $6, false, $7::jsonb)
	`
	if ignoreConflict {
		// The dedupe key has a unique partial index. DO NOTHING keeps a concurrent
		// producer from aborting a surrounding business transaction; the caller
		// reads back the winner when RETURNING yields no row.
		query += " on conflict do nothing\n"
	}
	query += `returning id::text, user_id::text, organization_id::text, title, content, type, coalesce(is_read, false), lead_id::text, coalesce(target_url, ''), coalesce(metadata, '{}'::jsonb)::text, created_at`
	return scanNotification(queryer.QueryRow(ctx, query, userID, organizationID, title, optionalString(content, 1_000), notificationType, leadID, jsonb(metadata)))
}

func (repo Repository) findRecentNotificationByDedupeKey(ctx context.Context, organizationID string, userID string, dedupeKey string) (Notification, bool, error) {
	return repo.findRecentNotificationByDedupeKeyWithQueryer(ctx, repo.db.Pool(), organizationID, userID, dedupeKey)
}

func (repo Repository) findRecentNotificationByDedupeKeyWithQueryer(ctx context.Context, queryer notificationQueryer, organizationID string, userID string, dedupeKey string) (Notification, bool, error) {
	notification, err := scanNotificationValue(queryer.QueryRow(ctx, `
		select id::text, user_id::text, organization_id::text, title, content, type, coalesce(is_read, false), lead_id::text, coalesce(target_url, ''), coalesce(metadata, '{}'::jsonb)::text, created_at
		from public.notifications
		where organization_id = $1::uuid
		  and user_id = $2::uuid
		  and metadata->>'dedupe_key' = $3
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
		select
		  u.id::text,
		  u.name,
		  u.email,
		  nullif(u.whatsapp, '')
		from public.users u
		join public.organization_members om
		  on om.user_id = u.id
		 and om.organization_id = $1::uuid
		where u.id = $2::uuid
		  and coalesce(u.is_active, false) = true
		  and coalesce(om.is_active, false) = true
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

func scanNotification(row scanner) (Notification, error) {
	notification, err := scanNotificationValue(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Notification{}, ErrInvalidReference
	}
	return notification, err
}

func scanNotificationValue(row scanner) (Notification, error) {
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
		&notification.TargetURL,
		&metadataRaw,
		&notification.CreatedAt,
	); err != nil {
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
