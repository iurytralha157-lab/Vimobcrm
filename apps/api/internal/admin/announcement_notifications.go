package admin

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"time"
)

const announcementNotificationFanoutQuery = `
	with announcement as (
		select
			id,
			message,
			coalesce(nullif(target_type, ''), 'all') as target_type,
			coalesce(target_organization_ids, '{}'::uuid[]) as target_organization_ids,
			coalesce(target_user_ids, '{}'::uuid[]) as target_user_ids
		from public.announcements announcement
		where announcement.id = $1::uuid
		  and coalesce(announcement.is_active, false) = true
		  and (
			nullif(to_jsonb(announcement)->>'starts_at', '') is null
			or nullif(to_jsonb(announcement)->>'starts_at', '')::timestamptz <= now()
		  )
		  and (
			nullif(to_jsonb(announcement)->>'ends_at', '') is null
			or nullif(to_jsonb(announcement)->>'ends_at', '')::timestamptz >= now()
		  )
	), recipients as (
		select distinct
			member.organization_id,
			member.user_id
		from announcement
		join public.organization_members member
		  on member.is_active is true
		join public.users app_user
		  on app_user.id = member.user_id
		 and app_user.is_active is true
		where
			announcement.target_type = 'all'
			or (
				announcement.target_type = 'specific'
				and member.user_id = any(announcement.target_user_ids)
			)
			or (
				announcement.target_type = 'organizations'
				and member.organization_id = any(announcement.target_organization_ids)
			)
			or (
				announcement.target_type = 'admins'
				and lower(coalesce(nullif(member.role, ''), 'user')) in ('owner', 'admin')
			)
			or (
				announcement.target_type = 'brokers'
				and lower(coalesce(nullif(member.role, ''), 'user')) = 'user'
			)
	)
	insert into public.notifications (
		organization_id,
		user_id,
		title,
		content,
		body,
		type,
		channel,
		target_url,
		metadata
	)
	select
		recipient.organization_id,
		recipient.user_id,
		'Novo comunicado',
		announcement.message,
		announcement.message,
		'system',
		'in_app',
		'/inicio',
		jsonb_build_object(
			'event_key', 'announcement_published',
			'announcement_id', announcement.id::text,
			'dedupe_key', concat_ws(
				':',
				'announcement_published',
				announcement.id::text,
				recipient.organization_id::text,
				recipient.user_id::text
			)
		)
	from announcement
	cross join recipients recipient
	on conflict do nothing
`

func (repo Repository) createAnnouncementWithNotifications(ctx context.Context, payload map[string]any) (map[string]any, error) {
	if err := normalizeAnnouncementPayload(payload); err != nil {
		return nil, err
	}

	columns, placeholders, args, err := buildAdminPayload(payload, 0)
	if err != nil {
		return nil, err
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var raw []byte
	err = tx.QueryRow(ctx, fmt.Sprintf(`
		insert into public.announcements (%s)
		values (%s)
		returning to_jsonb(announcements)
	`, strings.Join(columns, ", "), strings.Join(placeholders, ", ")), args...).Scan(&raw)
	if err != nil {
		return nil, err
	}

	item := map[string]any{}
	if err := json.Unmarshal(raw, &item); err != nil {
		return nil, err
	}
	if announcementNotificationIsDue(item, time.Now()) {
		announcementID, ok := normalizeUUID(stringValue(item["id"]))
		if !ok {
			return nil, ErrInvalidInput
		}
		if _, err := tx.Exec(ctx, announcementNotificationFanoutQuery, announcementID); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return item, nil
}
func normalizeAnnouncementPayload(payload map[string]any) error {
	message := strings.TrimSpace(stringValue(payload["message"]))
	if message == "" || len(message) > 500 {
		return ErrInvalidInput
	}
	payload["message"] = message

	if value := strings.TrimSpace(stringValue(payload["button_text"])); value != "" {
		if len(value) > 48 {
			return ErrInvalidInput
		}
		payload["button_text"] = value
	}
	if value := strings.TrimSpace(stringValue(payload["button_url"])); value != "" {
		if len(value) > 2048 || !isSafeAnnouncementURL(value) {
			return ErrInvalidInput
		}
		payload["button_url"] = value
	}

	targetType := strings.ToLower(strings.TrimSpace(stringValue(payload["target_type"])))
	if targetType == "" {
		targetType = "all"
		payload["target_type"] = targetType
	}
	switch targetType {
	case "all", "specific", "organizations", "admins":
		return nil
	default:
		return ErrInvalidInput
	}
}

func isSafeAnnouncementURL(value string) bool {
	if strings.HasPrefix(value, "/") && !strings.HasPrefix(value, "//") {
		return true
	}
	parsed, err := url.Parse(value)
	return err == nil && parsed.Host != "" && (parsed.Scheme == "http" || parsed.Scheme == "https")
}

func announcementNotificationIsDue(item map[string]any, now time.Time) bool {
	if !boolValue(item["send_notification"]) || !boolValue(item["is_active"]) {
		return false
	}
	if startsAt, ok := announcementTime(item["starts_at"]); ok && startsAt.After(now) {
		return false
	}
	if endsAt, ok := announcementTime(item["ends_at"]); ok && endsAt.Before(now) {
		return false
	}
	return true
}

func announcementTime(value any) (time.Time, bool) {
	raw := strings.TrimSpace(stringValue(value))
	if raw == "" {
		return time.Time{}, false
	}
	parsed, err := time.Parse(time.RFC3339, raw)
	return parsed, err == nil
}
