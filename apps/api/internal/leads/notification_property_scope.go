package leads

import (
	"context"
	"strings"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/pgvalue"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/propertyscope"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

var notificationPropertyMetadataKeys = []string{
	"property_id",
	"propertyId",
	"interest_property_id",
	"interestPropertyId",
	"property_title",
	"propertyTitle",
	"property_code",
	"propertyCode",
	"property_name",
	"propertyName",
	"property_price",
	"propertyPrice",
	"property_image",
	"propertyImage",
	"property_images",
	"propertyImages",
	"property_media",
	"propertyMedia",
	"commission_percentage",
	"commissionPercentage",
	"imovel",
}

func notificationPropertyReference(metadata map[string]any) string {
	for _, source := range notificationPropertyMetadataMaps(metadata) {
		for _, key := range []string{"property_id", "propertyId", "interest_property_id", "interestPropertyId"} {
			if value := strings.TrimSpace(stringFromMap(source, key)); value != "" {
				return value
			}
		}
	}
	return ""
}

func notificationPropertyMetadataMaps(metadata map[string]any) []map[string]any {
	maps := []map[string]any{metadata}
	if nested, ok := metadata["variables"].(map[string]any); ok {
		maps = append(maps, nested)
	}
	return maps
}

func notificationHasPropertyContext(metadata map[string]any) bool {
	switch strings.ToLower(strings.TrimSpace(stringFromMap(metadata, "event_key"))) {
	case "interest_property_reserved", "property_interest_reserved", "property_selected":
		return true
	}
	for _, source := range notificationPropertyMetadataMaps(metadata) {
		for _, key := range notificationPropertyMetadataKeys {
			if _, exists := source[key]; exists {
				return true
			}
		}
	}
	return false
}

func redactNotificationPropertyContext(metadata map[string]any) map[string]any {
	if metadata == nil {
		return map[string]any{}
	}
	for _, source := range notificationPropertyMetadataMaps(metadata) {
		for _, key := range notificationPropertyMetadataKeys {
			delete(source, key)
		}
	}
	return metadata
}

func hiddenPropertyNotificationCopy(title string, content string, metadata map[string]any) (string, string, map[string]any) {
	eventKey := strings.ToLower(strings.TrimSpace(stringFromMap(metadata, "event_key")))
	metadata = redactNotificationPropertyContext(metadata)
	switch eventKey {
	case "schedule_reminder", "appointment_reminder", "appointment_outcome_pending":
		return title, content, metadata
	case "interest_property_reserved":
		return "Imovel de interesse reservado", "O imovel de interesse foi reservado. Revise este atendimento.", metadata
	default:
		return "Atualizacao de imovel", "Uma atualizacao relacionada a imovel foi registrada.", metadata
	}
}

func (repo Repository) tenantCanViewNotificationProperty(ctx context.Context, tenantContext tenant.Context, propertyID string) bool {
	propertyID, ok := normalizeUUID(propertyID)
	if !ok || !propertyscope.CanRead(tenantContext) {
		return false
	}
	viewerID := any(pgvalue.NullableString(tenantContext.UserID))
	var visible bool
	err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from public.properties notification_property
			where notification_property.organization_id = $1::uuid
			  and notification_property.id = $2::uuid
			  and `+propertyscope.VisibilitySQL("notification_property", "$3", "$4", "$5")+`
		)
	`,
		tenantContext.OrganizationID,
		propertyID,
		propertyscope.CanViewAll(tenantContext),
		viewerID,
		propertyscope.CanViewTeam(tenantContext),
	).Scan(&visible)
	return err == nil && visible
}

func scopeNotificationPropertyForAPI(notification Notification, visiblePropertyIDs map[string]struct{}) Notification {
	propertyID := notificationPropertyReference(notification.Metadata)
	if propertyID == "" && !notificationHasPropertyContext(notification.Metadata) {
		return notification
	}
	if normalized, ok := normalizeUUID(propertyID); ok {
		if _, visible := visiblePropertyIDs[normalized]; visible {
			return notification
		}
	}
	title, content, metadata := hiddenPropertyNotificationCopy(
		notification.Title,
		stringValue(notification.Content),
		notification.Metadata,
	)
	notification.Title = title
	notification.Content = &content
	notification.Metadata = metadata
	return notification
}

func (repo Repository) visibleNotificationPropertyIDs(ctx context.Context, tenantContext tenant.Context, notifications []Notification) map[string]struct{} {
	visible := map[string]struct{}{}
	if !propertyscope.CanRead(tenantContext) {
		return visible
	}

	propertyIDs := []string{}
	seen := map[string]struct{}{}
	for _, notification := range notifications {
		propertyID, ok := normalizeUUID(notificationPropertyReference(notification.Metadata))
		if !ok {
			continue
		}
		if _, duplicate := seen[propertyID]; duplicate {
			continue
		}
		seen[propertyID] = struct{}{}
		propertyIDs = append(propertyIDs, propertyID)
	}
	if len(propertyIDs) == 0 {
		return visible
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select notification_property.id::text
		from public.properties notification_property
		where notification_property.organization_id = $1::uuid
		  and notification_property.id = any($2::uuid[])
		  and `+propertyscope.VisibilitySQL("notification_property", "$3", "$4", "$5")+`
	`,
		tenantContext.OrganizationID,
		propertyIDs,
		propertyscope.CanViewAll(tenantContext),
		pgvalue.NullableString(tenantContext.UserID),
		propertyscope.CanViewTeam(tenantContext),
	)
	if err != nil {
		return visible
	}
	defer rows.Close()
	for rows.Next() {
		var propertyID string
		if rows.Scan(&propertyID) == nil {
			visible[propertyID] = struct{}{}
		}
	}
	return visible
}

func (repo Repository) scopePendingNotificationProperty(ctx context.Context, notification pendingNotification) pendingNotification {
	propertyID := notificationPropertyReference(notification.Metadata)
	if propertyID == "" && !notificationHasPropertyContext(notification.Metadata) {
		return notification
	}

	if propertyID != "" {
		tenantContext, err := tenant.NewRepository(repo.db).Resolve(ctx, notification.UserID, notification.OrganizationID)
		if err == nil && repo.tenantCanViewNotificationProperty(ctx, tenantContext, propertyID) {
			return notification
		}
	}
	notification.Title, notification.Content, notification.Metadata = hiddenPropertyNotificationCopy(
		notification.Title,
		notification.Content,
		notification.Metadata,
	)
	return notification
}
