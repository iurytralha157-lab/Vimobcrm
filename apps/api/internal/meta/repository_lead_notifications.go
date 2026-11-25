package meta

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func (repo Repository) findLeadAssignedUser(ctx context.Context, tx pgx.Tx, organizationID string, leadID string) (*string, error) {
	var assignedUserID *string
	err := tx.QueryRow(ctx, `
		select assigned_user_id::text
		from public.leads
		where organization_id = $1::uuid
		  and id = $2::uuid
		limit 1
	`, organizationID, leadID).Scan(&assignedUserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return assignedUserID, err
}

func (repo Repository) listFallbackLeadNotificationRecipients(ctx context.Context, tx pgx.Tx, organizationID string, initialEntry bool) ([]string, bool, error) {
	// Only the database can activate the new push policy during rollout.
	rows, err := tx.Query(ctx, `
		select distinct user_id::text, case when $2::boolean
			then pg_catalog.to_regprocedure('private.meta_unassigned_admin_push_enabled()') is not null
			else false
		end
		from (
			select om.user_id
			from public.organization_members om
			where om.organization_id = $1::uuid
			  and coalesce(om.is_active, true) = true
			  and om.role in ('owner', 'admin', 'manager')
		) recipients
		where user_id is not null
	`, organizationID, initialEntry)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()

	recipients := []string{}
	var adminPush bool
	for rows.Next() {
		var userID string
		if err := rows.Scan(&userID, &adminPush); err != nil {
			return nil, false, err
		}
		if strings.TrimSpace(userID) != "" {
			recipients = append(recipients, userID)
		}
	}
	return recipients, adminPush, rows.Err()
}

func (repo Repository) insertLeadNotification(ctx context.Context, tx pgx.Tx, organizationID string, userID string, leadID string, title string, content string, eventKey string, metadata map[string]any) error {
	if strings.TrimSpace(userID) == "" {
		return nil
	}
	metadata = prepareMetaLeadNotificationMetadata(metadata, eventKey)
	dedupeKey := metaStringFromMap(metadata, "dedupe_key")

	_, err := tx.Exec(ctx, `
		with input as (
			select nullif($7, '') as dedupe_key
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
			$1::uuid,
			$2::uuid,
			$3,
			$4,
			$4,
			'lead',
			'in_app',
			$5::uuid,
			'/crm/pipelines?lead=' || $5::text,
			$6::jsonb
		from input
		where input.dedupe_key is null
		   or not exists (
		     select 1
		     from public.notifications n
		     where n.organization_id = $1::uuid
		       and n.user_id = $2::uuid
		       and n.metadata->>'dedupe_key' = input.dedupe_key
		   )
	`, organizationID, userID, title, content, leadID, jsonb(metadata), dedupeKey)
	if isNotificationDedupeConflict(err) {
		return nil
	}
	return err
}

// UnassignedAdminAlertMetadataKey identifies the backend-owned Meta intake notice.
const UnassignedAdminAlertMetadataKey = "meta_unassigned_admin_alert"

func prepareMetaLeadNotificationMetadata(metadata map[string]any, eventKey string) map[string]any {
	if metadata == nil {
		metadata = map[string]any{}
	}
	metadata["event_key"] = eventKey
	if metadata[UnassignedAdminAlertMetadataKey] == true {
		metadata["whatsapp_dispatch_required"] = false
		delete(metadata, "whatsapp_dispatch")
		delete(metadata, "email_dispatch")
		metadata["dispatch"] = map[string]any{
			"push":     map[string]any{"required": true, "status": "pending"},
			"whatsapp": map[string]any{"required": false},
			"email":    map[string]any{"required": false},
		}
		return metadata
	}
	metadata["whatsapp_dispatch_required"] = true
	if _, exists := metadata["whatsapp_dispatch"]; !exists {
		metadata["whatsapp_dispatch"] = map[string]any{
			"status": "pending",
		}
	}
	if _, exists := metadata["dispatch"]; !exists {
		metadata["dispatch"] = map[string]any{
			"whatsapp": map[string]any{
				"required": true,
				"status":   "pending",
			},
			"push": map[string]any{
				"required": true,
				"status":   "pending",
			},
		}
	}
	return metadata
}

func (repo Repository) enrichCanonicalLeadNotification(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	userID string,
	leadID string,
	distributionEventID string,
	title string,
	content string,
	metadata map[string]any,
) (bool, error) {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(distributionEventID) == "" {
		return false, nil
	}
	command, err := tx.Exec(ctx, `
		update public.notifications notification
		set title = $5,
		    content = $6,
		    body = $6,
		    type = 'lead',
		    metadata = coalesce(notification.metadata, '{}'::jsonb) || $7::jsonb
		where notification.id = (
			select candidate.id
			from public.notifications candidate
			where candidate.organization_id = $1::uuid
			  and candidate.user_id = $2::uuid
			  and candidate.lead_id = $3::uuid
			  and candidate.metadata->>'distribution_event_id' = $4
			order by candidate.created_at desc, candidate.id desc
			limit 1
		)
	`, organizationID, userID, leadID, distributionEventID, title, content, jsonb(metadata))
	if err != nil {
		return false, err
	}
	return command.RowsAffected() == 1, nil
}

func isNotificationDedupeConflict(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) &&
		pgErr.Code == "23505" &&
		pgErr.ConstraintName == "notifications_unique_dedupe_key"
}

func metaNotificationDedupeKey(parts ...string) string {
	cleaned := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			cleaned = append(cleaned, part)
		}
	}
	return strings.Join(cleaned, ":")
}

func metaStringFromMap(values map[string]any, key string) string {
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
