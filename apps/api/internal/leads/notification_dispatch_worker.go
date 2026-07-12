package leads

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const (
	notificationDispatchWorkerInterval = 15 * time.Second
	notificationDispatchBatchLimit     = 25
	notificationDispatchMaxAttempts    = 5
	notificationDispatchClaimTimeout   = 5 * time.Minute
	notificationDispatchLockKey        = int64(860421705)
	scheduleReminderLockKey            = int64(860421706)
)

type pendingNotification struct {
	ID             string
	OrganizationID string
	UserID         string
	LeadID         *string
	Title          string
	Content        string
	Type           string
	TargetURL      string
	Metadata       map[string]any
}

type notificationDeliveryResult struct {
	WhatsApp DispatchChannelResult
	Push     DispatchChannelResult
	Email    DispatchChannelResult
	Error    string
}

func (repo Repository) StartNotificationDispatchWorker(ctx context.Context, logger *slog.Logger) {
	if logger == nil {
		logger = slog.Default()
	}

	go func() {
		timer := time.NewTimer(7 * time.Second)
		defer timer.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
				if err := repo.CreateDueScheduleReminderNotifications(ctx); err != nil && !errors.Is(err, context.Canceled) {
					logger.Error("schedule reminder notification worker failed", "error", err)
				}
				if err := repo.ProcessNotificationDeliveries(ctx); err != nil && !errors.Is(err, context.Canceled) {
					logger.Error("notification delivery worker failed", "error", err)
				}
				timer.Reset(notificationDispatchWorkerInterval)
			}
		}
	}()
}

func (repo Repository) ProcessLeadWhatsAppNotifications(ctx context.Context) error {
	return repo.ProcessNotificationDeliveries(ctx)
}

func (repo Repository) ProcessNotificationDeliveries(ctx context.Context) error {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var locked bool
	if err := tx.QueryRow(ctx, `select pg_try_advisory_xact_lock($1)`, notificationDispatchLockKey).Scan(&locked); err != nil {
		return err
	}
	if !locked {
		return nil
	}

	notifications, err := repo.listPendingNotificationDeliveries(ctx, tx)
	if err != nil {
		return err
	}

	notifications, err = repo.claimPendingNotificationDeliveries(ctx, tx, notifications)
	if err != nil {
		return err
	}

	if err := tx.Commit(ctx); err != nil {
		return err
	}

	for _, notification := range notifications {
		delivery := repo.dispatchPendingNotification(ctx, notification, nil)
		if err := repo.markNotificationDeliveryDirect(ctx, notification, delivery); err != nil {
			return err
		}
	}

	return nil
}

func (repo Repository) dispatchNotificationDeliveries(ctx context.Context, notification Notification, channels []string) notificationDeliveryResult {
	pending := pendingNotification{
		ID:             notification.ID,
		OrganizationID: notification.OrganizationID,
		UserID:         notification.UserID,
		LeadID:         notification.LeadID,
		Title:          notification.Title,
		Content:        firstNotificationText(stringValue(notification.Content), stringFromMap(notification.Metadata, "body")),
		Type:           notification.Type,
		Metadata:       notification.Metadata,
	}
	if pending.Metadata == nil {
		pending.Metadata = map[string]any{}
	}
	delivery := repo.dispatchPendingNotification(ctx, pending, channels)
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		delivery.Error = firstNotificationText(delivery.Error, err.Error())
		return delivery
	}
	defer tx.Rollback(ctx)
	if err := repo.markNotificationDelivery(ctx, tx, pending, delivery); err != nil {
		delivery.Error = firstNotificationText(delivery.Error, err.Error())
		return delivery
	}
	if err := tx.Commit(ctx); err != nil {
		delivery.Error = firstNotificationText(delivery.Error, err.Error())
	}
	return delivery
}

func (repo Repository) listPendingNotificationDeliveries(ctx context.Context, tx pgx.Tx) ([]pendingNotification, error) {
	rows, err := tx.Query(ctx, `
		select
			id::text,
			organization_id::text,
			user_id::text,
			coalesce(lead_id::text, ''),
			coalesce(title, ''),
			coalesce(content, body, ''),
			coalesce(type, 'info'),
			coalesce(target_url, ''),
			coalesce(metadata, '{}'::jsonb)::text
		from public.notifications
		where created_at >= now() - interval '48 hours'
		  and (
		    (
		      lower(coalesce(metadata->'dispatch'->'whatsapp'->>'required', metadata->>'whatsapp_dispatch_required', 'false')) in ('true', '1', 'yes')
		      and coalesce(metadata->'dispatch'->'whatsapp'->>'status', metadata->'whatsapp_dispatch'->>'status', 'pending') not in ('sent', 'skipped', 'permanent_failed')
		      and coalesce(nullif(coalesce(metadata->'dispatch'->'whatsapp'->>'attempts', metadata->'whatsapp_dispatch'->>'attempts'), '')::int, 0) < $1
		      and (
		        coalesce(metadata->'dispatch'->'whatsapp'->>'status', metadata->'whatsapp_dispatch'->>'status', 'pending') <> 'processing'
		        or coalesce(nullif(metadata->'dispatch'->'whatsapp'->>'claimed_at', '')::timestamptz, now() - interval '1 hour') < now() - interval '5 minutes'
		      )
		    )
		    or (
		      lower(coalesce(metadata->'dispatch'->'push'->>'required', 'false')) in ('true', '1', 'yes')
		      and coalesce(metadata->'dispatch'->'push'->>'status', 'pending') not in ('sent', 'skipped', 'permanent_failed')
		      and coalesce(nullif(metadata->'dispatch'->'push'->>'attempts', '')::int, 0) < $1
		      and (
		        coalesce(metadata->'dispatch'->'push'->>'status', 'pending') <> 'processing'
		        or coalesce(nullif(metadata->'dispatch'->'push'->>'claimed_at', '')::timestamptz, now() - interval '1 hour') < now() - interval '5 minutes'
		      )
		    )
		    or (
		      lower(coalesce(metadata->'dispatch'->'email'->>'required', 'false')) in ('true', '1', 'yes')
		      and coalesce(metadata->'dispatch'->'email'->>'status', 'pending') not in ('sent', 'skipped', 'permanent_failed')
		      and coalesce(nullif(metadata->'dispatch'->'email'->>'attempts', '')::int, 0) < $1
		      and (
		        coalesce(metadata->'dispatch'->'email'->>'status', 'pending') <> 'processing'
		        or coalesce(nullif(metadata->'dispatch'->'email'->>'claimed_at', '')::timestamptz, now() - interval '1 hour') < now() - interval '5 minutes'
		      )
		    )
		  )
		order by created_at asc
		limit $2
		for update skip locked
	`, notificationDispatchMaxAttempts, notificationDispatchBatchLimit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	notifications := []pendingNotification{}
	for rows.Next() {
		var item pendingNotification
		var leadID string
		var rawMetadata string
		if err := rows.Scan(&item.ID, &item.OrganizationID, &item.UserID, &leadID, &item.Title, &item.Content, &item.Type, &item.TargetURL, &rawMetadata); err != nil {
			return nil, err
		}
		if strings.TrimSpace(leadID) != "" {
			item.LeadID = &leadID
		}
		item.Metadata = map[string]any{}
		if strings.TrimSpace(rawMetadata) != "" {
			_ = json.Unmarshal([]byte(rawMetadata), &item.Metadata)
		}
		notifications = append(notifications, item)
	}
	return notifications, rows.Err()
}

func (repo Repository) claimPendingNotificationDeliveries(ctx context.Context, tx pgx.Tx, notifications []pendingNotification) ([]pendingNotification, error) {
	claimed := make([]pendingNotification, 0, len(notifications))
	claimToken := fmt.Sprintf("%d", time.Now().UTC().UnixNano())

	for _, notification := range notifications {
		metadata := notification.Metadata
		if metadata == nil {
			metadata = map[string]any{}
		}

		channelClaimed := false
		for _, channel := range []string{"whatsapp", "push", "email"} {
			if !shouldClaimNotificationChannel(metadata, channel) {
				continue
			}
			metadata = setNotificationChannelProcessing(metadata, channel, claimToken)
			channelClaimed = true
		}
		if !channelClaimed {
			continue
		}

		if _, err := tx.Exec(ctx, `
			update public.notifications
			set metadata = $2::jsonb
			where id = $1::uuid
		`, notification.ID, jsonb(metadata)); err != nil {
			return nil, err
		}

		notification.Metadata = metadata
		claimed = append(claimed, notification)
	}

	return claimed, nil
}

func (repo Repository) dispatchPendingNotification(ctx context.Context, notification pendingNotification, channels []string) notificationDeliveryResult {
	var result notificationDeliveryResult
	if shouldAttemptNotificationChannel(notification.Metadata, "whatsapp", channels) {
		result.WhatsApp, _ = repo.dispatchPendingWhatsAppNotification(ctx, notification)
	}
	if shouldAttemptNotificationChannel(notification.Metadata, "push", channels) {
		result.Push = repo.dispatchPendingPushNotification(ctx, notification)
	}
	if shouldAttemptNotificationChannel(notification.Metadata, "email", channels) {
		result.Email = repo.dispatchPendingEmailNotification(ctx, notification)
	}

	for _, item := range []DispatchChannelResult{result.WhatsApp, result.Push, result.Email} {
		if item.Error != "" && item.Attempted && !item.OK {
			result.Error = firstNotificationText(result.Error, item.Error)
		}
	}
	return result
}

func (repo Repository) dispatchPendingWhatsAppNotification(ctx context.Context, notification pendingNotification) (DispatchWhatsAppResult, error) {
	eventKey := firstNotificationText(stringFromMap(notification.Metadata, "event_key"), "notification")
	variables := notificationVariables(notification.Metadata)
	recipient, err := repo.getNotificationRecipient(ctx, notification.OrganizationID, notification.UserID)
	if err != nil {
		return DispatchWhatsAppResult{Enabled: true, Error: err.Error()}, err
	}

	request := DispatchNotificationRequest{
		EventKey:  eventKey,
		UserID:    notification.UserID,
		Recipient: recipient.WhatsApp,
		Title:     notification.Title,
		Content:   notification.Content,
		Variables: variables,
		LeadID:    notification.LeadID,
		DedupeKey: firstNotificationText(stringFromMap(notification.Metadata, "dedupe_key"), notification.ID),
		Channels:  []string{"whatsapp"},
	}
	tenantContext := tenant.Context{
		OrganizationID: notification.OrganizationID,
		UserID:         notification.UserID,
	}
	result, err := repo.dispatchWhatsAppNotification(ctx, tenantContext, request, recipient, notification.Title, notification.Content, eventKey, request.DedupeKey)
	return result, err
}

func (repo Repository) dispatchPendingPushNotification(ctx context.Context, notification pendingNotification) DispatchChannelResult {
	if repo.notificationPush.vapidPrivateKey == "" && repo.notificationPush.fcmServerKey == "" {
		return DispatchChannelResult{Enabled: false, Error: "push_sender_not_configured"}
	}
	subscriptions, err := repo.listActivePushSubscriptions(ctx, notification.OrganizationID, notification.UserID)
	if err != nil {
		return DispatchChannelResult{Enabled: true, Error: err.Error()}
	}
	if len(subscriptions) == 0 {
		return DispatchChannelResult{Enabled: true, Error: "push_tokens_missing"}
	}

	payload := pushPayload{
		Title:     notification.Title,
		Body:      notification.Content,
		Type:      notification.Type,
		LeadID:    notification.LeadID,
		TargetURL: firstNotificationText(notification.TargetURL, notificationTargetURL(notification)),
	}
	aggregate := DispatchChannelResult{Enabled: true, Attempted: true, Provider: "push", OK: true}
	for _, subscription := range subscriptions {
		item := repo.notificationPush.send(ctx, subscription, payload)
		if item.Attempted && item.OK {
			aggregate.Sent++
			continue
		}
		aggregate.Skipped++
		if item.Error != "" {
			aggregate.Error = firstNotificationText(aggregate.Error, item.Error)
		}
		if item.Status != 0 {
			aggregate.Status = item.Status
		}
	}
	if aggregate.Sent == 0 {
		aggregate.OK = false
	}
	return aggregate
}

func (repo Repository) dispatchPendingEmailNotification(ctx context.Context, notification pendingNotification) DispatchChannelResult {
	eventKey := firstNotificationText(stringFromMap(notification.Metadata, "event_key"), "notification")
	if eventKey != "deal_won" {
		return DispatchChannelResult{Enabled: false, Error: "email_event_not_supported"}
	}
	recipient, err := repo.getNotificationRecipient(ctx, notification.OrganizationID, notification.UserID)
	if err != nil {
		return DispatchChannelResult{Enabled: true, Error: err.Error()}
	}
	payload := dealWonEmailPayload{
		RecipientEmail: recipient.Email,
		RecipientName:  recipient.Name,
		LeadName:       firstNotificationText(stringFromMap(notification.Metadata, "lead_name"), stringFromMap(notificationVariables(notification.Metadata), "lead_name")),
		ActorName:      firstNotificationText(stringFromMap(notification.Metadata, "actor_name"), stringFromMap(notificationVariables(notification.Metadata), "actor_name")),
		Organization:   firstNotificationText(stringFromMap(notification.Metadata, "organization_name"), stringFromMap(notificationVariables(notification.Metadata), "organization_name")),
		Value:          firstNotificationText(stringFromMap(notification.Metadata, "valor_interesse"), stringFromMap(notificationVariables(notification.Metadata), "valor_interesse")),
		LeadURL:        firstNotificationText(notification.TargetURL, notificationTargetURL(notification)),
	}
	return repo.notificationEmail.sendDealWon(ctx, payload)
}

func (repo Repository) markNotificationDelivery(ctx context.Context, tx pgx.Tx, notification pendingNotification, result notificationDeliveryResult) error {
	metadata := notification.Metadata
	if metadata == nil {
		metadata = map[string]any{}
	}
	if result.WhatsApp.Enabled || result.WhatsApp.Attempted || result.WhatsApp.Error != "" {
		metadata = setNotificationChannelDispatch(metadata, "whatsapp", result.WhatsApp)
		metadata["whatsapp_dispatch"] = mapFromAny(mapFromAny(metadata["dispatch"])["whatsapp"])
	}
	if result.Push.Enabled || result.Push.Attempted || result.Push.Error != "" {
		metadata = setNotificationChannelDispatch(metadata, "push", result.Push)
	}
	if result.Email.Enabled || result.Email.Attempted || result.Email.Error != "" {
		metadata = setNotificationChannelDispatch(metadata, "email", result.Email)
	}

	_, err := tx.Exec(ctx, `
		update public.notifications
		set metadata = $2::jsonb
		where id = $1::uuid
	`, notification.ID, jsonb(metadata))
	return err
}

func (repo Repository) markNotificationDeliveryDirect(ctx context.Context, notification pendingNotification, result notificationDeliveryResult) error {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if err := repo.markNotificationDelivery(ctx, tx, notification, result); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func setNotificationChannelDispatch(metadata map[string]any, channel string, result DispatchChannelResult) map[string]any {
	dispatch := mapFromAny(metadata["dispatch"])
	attempts := notificationDispatchAttempts(metadata, channel) + 1
	status := "failed"
	errorText := result.Error
	switch {
	case result.OK:
		status = "sent"
	case !result.Enabled:
		status = "skipped"
	case !result.Attempted && errorText != "":
		status = "skipped"
	case !result.Attempted:
		status = "skipped"
	case attempts >= notificationDispatchMaxAttempts:
		status = "permanent_failed"
	}
	dispatch[channel] = map[string]any{
		"required":    true,
		"status":      status,
		"attempts":    attempts,
		"provider":    result.Provider,
		"session_id":  result.SessionID,
		"instance_id": result.InstanceID,
		"http_status": result.Status,
		"sent":        result.Sent,
		"skipped":     result.Skipped,
		"error":       errorText,
		"updated_at":  time.Now().UTC().Format(time.RFC3339),
	}
	metadata["dispatch"] = dispatch
	return metadata
}

func setNotificationChannelProcessing(metadata map[string]any, channel string, claimToken string) map[string]any {
	dispatch := mapFromAny(metadata["dispatch"])
	current := mapFromAny(dispatch[channel])
	current["required"] = true
	current["status"] = "processing"
	current["claim_token"] = claimToken
	current["claimed_at"] = time.Now().UTC().Format(time.RFC3339)
	current["updated_at"] = time.Now().UTC().Format(time.RFC3339)
	dispatch[channel] = current
	metadata["dispatch"] = dispatch
	if channel == "whatsapp" {
		metadata["whatsapp_dispatch"] = mapFromAny(current)
		metadata["whatsapp_dispatch_required"] = true
	}
	return metadata
}

func shouldClaimNotificationChannel(metadata map[string]any, channel string) bool {
	if !shouldAttemptNotificationChannel(metadata, channel, nil) {
		return false
	}
	status := notificationChannelStatus(metadata, channel)
	if status != "processing" {
		return true
	}
	return notificationChannelClaimExpired(metadata, channel)
}

func shouldAttemptNotificationChannel(metadata map[string]any, channel string, requested []string) bool {
	if !requestWantsChannel(requested, channel) {
		return false
	}
	required := false
	if channel == "whatsapp" {
		required = truthyString(stringFromMap(metadata, "whatsapp_dispatch_required"))
	}
	channelDispatch := mapFromAny(mapFromAny(metadata["dispatch"])[channel])
	required = required || truthyValue(channelDispatch["required"])
	if !required {
		return false
	}
	status := notificationChannelStatus(metadata, channel)
	switch status {
	case "sent", "skipped", "permanent_failed":
		return false
	}
	return notificationDispatchAttempts(metadata, channel) < notificationDispatchMaxAttempts
}

func notificationChannelStatus(metadata map[string]any, channel string) string {
	channelDispatch := mapFromAny(mapFromAny(metadata["dispatch"])[channel])
	status := strings.TrimSpace(fmt.Sprint(channelDispatch["status"]))
	if status == "" && channel == "whatsapp" {
		status = strings.TrimSpace(fmt.Sprint(mapFromAny(metadata["whatsapp_dispatch"])["status"]))
	}
	if status == "" {
		status = "pending"
	}
	return status
}

func notificationChannelClaimExpired(metadata map[string]any, channel string) bool {
	channelDispatch := mapFromAny(mapFromAny(metadata["dispatch"])[channel])
	claimedAt := strings.TrimSpace(fmt.Sprint(channelDispatch["claimed_at"]))
	if claimedAt == "" && channel == "whatsapp" {
		claimedAt = strings.TrimSpace(fmt.Sprint(mapFromAny(metadata["whatsapp_dispatch"])["claimed_at"]))
	}
	if claimedAt == "" {
		return true
	}
	parsed, err := time.Parse(time.RFC3339, claimedAt)
	if err != nil {
		return true
	}
	return time.Since(parsed) > notificationDispatchClaimTimeout
}

func notificationDispatchAttempts(metadata map[string]any, channel string) int {
	if metadata == nil {
		return 0
	}
	dispatch := mapFromAny(mapFromAny(metadata["dispatch"])[channel])
	if len(dispatch) == 0 && channel == "whatsapp" {
		dispatch = mapFromAny(metadata["whatsapp_dispatch"])
	}
	value := dispatch["attempts"]
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case string:
		parsed, err := strconv.Atoi(strings.TrimSpace(typed))
		if err == nil {
			return parsed
		}
	case fmt.Stringer:
		parsed, err := strconv.Atoi(strings.TrimSpace(typed.String()))
		if err == nil {
			return parsed
		}
	}
	return 0
}

func (repo Repository) listActivePushSubscriptions(ctx context.Context, organizationID string, userID string) ([]pushSubscription, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		select
			coalesce(endpoint, ''),
			coalesce(p256dh, ''),
			coalesce(auth, ''),
			coalesce(token, ''),
			coalesce(platform, ''),
			coalesce(device_info, '{}'::jsonb)::text
		from public.push_tokens
		where organization_id = $1::uuid
		  and user_id = $2::uuid
		  and coalesce(is_active, true) = true
		order by updated_at desc nulls last, created_at desc nulls last
	`, organizationID, userID)
	if isUndefinedTableError(err) || isUndefinedColumnError(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	subscriptions := []pushSubscription{}
	for rows.Next() {
		var item pushSubscription
		var rawDeviceInfo string
		if err := rows.Scan(&item.Endpoint, &item.P256DH, &item.Auth, &item.Token, &item.Platform, &rawDeviceInfo); err != nil {
			return nil, err
		}
		var deviceInfo map[string]any
		_ = json.Unmarshal([]byte(rawDeviceInfo), &deviceInfo)
		item.Endpoint = firstNotificationText(item.Endpoint, stringFromMap(deviceInfo, "endpoint"))
		item.P256DH = firstNotificationText(item.P256DH, stringFromMap(deviceInfo, "p256dh"))
		item.Auth = firstNotificationText(item.Auth, stringFromMap(deviceInfo, "auth"))
		item.Platform = strings.ToLower(firstNotificationText(item.Platform, stringFromMap(deviceInfo, "platform")))
		if item.Endpoint == "" && item.Token != "" {
			item.Endpoint = "native:" + firstNotificationText(item.Platform, "unknown") + ":" + item.Token
		}
		if item.Endpoint != "" {
			subscriptions = append(subscriptions, item)
		}
	}
	return subscriptions, rows.Err()
}

func (repo Repository) CreateDueScheduleReminderNotifications(ctx context.Context) error {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var locked bool
	if err := tx.QueryRow(ctx, `select pg_try_advisory_xact_lock($1)`, scheduleReminderLockKey).Scan(&locked); err != nil {
		return err
	}
	if !locked {
		return nil
	}

	_, err = tx.Exec(ctx, `
		with due_events as (
			select
				se.id,
				se.organization_id,
				se.user_id,
				se.lead_id,
				se.title,
				se.start_time
			from public.schedule_events se
			where coalesce(se.status, 'scheduled') = 'scheduled'
			  and se.start_time > now()
			  and se.start_time <= now() + interval '5 minutes'
			  and not exists (
			    select 1
			    from public.notifications n
			    where n.organization_id = se.organization_id
			      and n.metadata->>'event_key' = 'schedule_reminder'
			      and n.metadata->>'schedule_event_id' = se.id::text
			  )
			order by se.start_time asc
			limit 50
		),
		recipients as (
			select distinct
				due_events.id,
				due_events.organization_id,
				due_events.user_id,
				due_events.lead_id,
				due_events.title,
				due_events.start_time
			from due_events
			union
			select distinct
				due_events.id,
				due_events.organization_id,
				sea.user_id,
				due_events.lead_id,
				due_events.title,
				due_events.start_time
			from due_events
			join public.schedule_event_assignees sea
			  on sea.event_id = due_events.id
			 and sea.organization_id = due_events.organization_id
		)
		insert into public.notifications (
			organization_id,
			user_id,
			title,
			content,
			body,
			type,
			channel,
			lead_id,
			target_url,
			metadata
		)
		select
			organization_id,
			user_id,
			'Lembrete de agenda',
			'A atividade "' || title || '" comeca em instantes.',
			'A atividade "' || title || '" comeca em instantes.',
			'schedule',
			'in_app',
			lead_id,
			'/agenda',
			jsonb_build_object(
				'event_key', 'schedule_reminder',
				'dedupe_key', 'schedule_reminder:' || id::text || ':' || user_id::text,
				'schedule_event_id', id::text,
				'start_time', start_time,
				'dispatch', jsonb_build_object(
					'push', jsonb_build_object('required', true, 'status', 'pending'),
					'whatsapp', jsonb_build_object('required', true, 'status', 'pending')
				),
				'whatsapp_dispatch_required', true,
				'whatsapp_dispatch', jsonb_build_object('status', 'pending')
			)
		from recipients
		where user_id is not null
		on conflict do nothing
	`)
	if isUndefinedTableError(err) || isUndefinedColumnError(err) {
		return nil
	}
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func notificationTargetURL(notification pendingNotification) string {
	if notification.LeadID != nil && strings.TrimSpace(*notification.LeadID) != "" {
		return "/crm/pipelines?lead=" + strings.TrimSpace(*notification.LeadID)
	}
	switch notification.Type {
	case "schedule":
		return "/agenda"
	case "whatsapp":
		return "/settings?tab=integrations"
	default:
		return "/notifications"
	}
}

func notificationVariables(metadata map[string]any) map[string]any {
	if metadata == nil {
		return map[string]any{}
	}
	variables := map[string]any{}
	for key, value := range metadata {
		switch key {
		case "dispatch", "whatsapp_dispatch", "push_dispatch", "email_dispatch", "variables":
			continue
		default:
			variables[key] = value
		}
	}
	if nested, ok := metadata["variables"].(map[string]any); ok {
		for key, value := range nested {
			variables[key] = value
		}
	}
	return variables
}

func truthyString(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "true", "1", "yes", "sim":
		return true
	default:
		return false
	}
}

func truthyValue(value any) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		return truthyString(typed)
	case float64:
		return typed != 0
	case int:
		return typed != 0
	default:
		return false
	}
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
