package schedule

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) eventRecipientIDs(ctx context.Context, tx pgx.Tx, organizationID string, eventID string, ownerID string, excludeUserID string) ([]string, error) {
	recipients := map[string]struct{}{}
	if ownerID != "" && ownerID != excludeUserID {
		recipients[ownerID] = struct{}{}
	}

	rows, err := tx.Query(ctx, `
		select user_id::text
		from public.schedule_event_assignees
		where organization_id = $1::uuid
		  and event_id = $2::uuid
	`, organizationID, eventID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var userID string
		if err := rows.Scan(&userID); err != nil {
			return nil, err
		}
		if userID != excludeUserID {
			recipients[userID] = struct{}{}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	out := make([]string, 0, len(recipients))
	for userID := range recipients {
		out = append(out, userID)
	}
	return out, nil
}

func (repo Repository) insertTimelineEvent(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, snapshot eventSnapshot, action string) error {
	return repo.insertTimelineEventWithMetadata(ctx, tx, tenantContext, snapshot, action, nil)
}

func (repo Repository) insertTimelineEventWithMetadata(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, snapshot eventSnapshot, action string, additionalMetadata map[string]any) error {
	if snapshot.LeadID == "" {
		return nil
	}

	title := map[string]string{
		"created":     "Atividade agendada",
		"rescheduled": "Atividade remarcada",
		"completed":   "Atividade concluida",
		"no_show":     "Cliente nao compareceu",
		"cancelled":   "Atividade cancelada",
		"commented":   "Comentario em atividade",
	}[action]
	if title == "" {
		title = "Atividade atualizada"
	}

	description := fmt.Sprintf("%s: %s", title, snapshot.Title)
	metadata := map[string]any{
		"schedule_event_id": snapshot.ID,
		"event_type":        snapshot.EventType,
		"start_time":        snapshot.StartTime,
		"assigned_to":       snapshot.UserID,
	}
	for key, value := range additionalMetadata {
		metadata[key] = value
	}
	_, err := tx.Exec(ctx, `
		insert into public.lead_timeline_events (
			organization_id,
			lead_id,
			actor_user_id,
			user_id,
			event_type,
			title,
			description,
			metadata
		)
		values (
			$1::uuid,
			$2::uuid,
			$3::uuid,
			$3::uuid,
			$4,
			$5,
			$6,
			$7::jsonb
		)
	`, tenantContext.OrganizationID, snapshot.LeadID, tenantContext.UserID, "agenda_"+action, title, description, jsonb(metadata))
	return err
}

func (repo Repository) insertScheduleActivity(ctx context.Context, tx pgx.Tx, organizationID string, snapshot eventSnapshot, action string) error {
	if snapshot.LeadID == "" {
		return nil
	}
	if snapshot.EventType != "visit" && snapshot.EventType != "meeting" {
		return nil
	}

	activityType := "meeting_scheduled"
	content := "Reuniao agendada: " + snapshot.Title
	if snapshot.EventType == "visit" {
		activityType = "visit_scheduled"
		content = "Visita agendada: " + snapshot.Title
	}
	if action == "completed" {
		activityType = "meeting_held"
		content = "Reuniao realizada: " + snapshot.Title
		if snapshot.EventType == "visit" {
			activityType = "visit_confirmed"
			content = "Visita realizada: " + snapshot.Title
		}
	}

	_, err := tx.Exec(ctx, `
		insert into public.activities (
			organization_id,
			lead_id,
			user_id,
			type,
			content,
			metadata
		)
		values (
			$1::uuid,
			$2::uuid,
			$3::uuid,
			$4,
			$5,
			$6::jsonb
		)
	`, organizationID, snapshot.LeadID, snapshot.UserID, activityType, content, jsonb(map[string]any{
		"schedule_event_id": snapshot.ID,
	}))
	return err
}

func (repo Repository) insertScheduleNotifications(ctx context.Context, tx pgx.Tx, organizationID string, actorID string, recipientIDs []string, title string, content string, metadata map[string]any) error {
	if metadata == nil {
		metadata = map[string]any{}
	}
	if _, exists := metadata["event_key"]; !exists {
		metadata["event_key"] = "schedule_notification"
	}
	if _, exists := metadata["dispatch"]; !exists {
		metadata["dispatch"] = map[string]any{
			"push": map[string]any{
				"required": true,
				"status":   "pending",
			},
		}
	}
	targetURL := scheduleNotificationTargetURL(metadata)

	seen := map[string]struct{}{}
	for _, recipientID := range recipientIDs {
		if recipientID == "" || recipientID == actorID {
			continue
		}
		if _, exists := seen[recipientID]; exists {
			continue
		}
		seen[recipientID] = struct{}{}

		_, err := tx.Exec(ctx, `
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
			values (
				$1::uuid,
				$2::uuid,
				$3,
				$4,
				$4,
				'schedule',
				'in_app',
				$5,
				$6::jsonb
			)
		`, organizationID, recipientID, title, content, targetURL, jsonb(metadata))
		if err != nil {
			return err
		}
	}

	return nil
}

func scheduleNotificationTargetURL(metadata map[string]any) string {
	rawEventID, _ := metadata["schedule_event_id"].(string)
	if eventID, ok := normalizeUUID(rawEventID); ok {
		return "/agenda?event=" + eventID
	}
	return "/agenda"
}
