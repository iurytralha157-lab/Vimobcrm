package settings

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/jsonvalue"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/pgvalue"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/pushconfig"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type Repository struct {
	db                  *dbpkg.Postgres
	storage             storageClient
	authAdmin           authAdminClient
	email               passwordNotificationClient
	asaasSubscriptions  asaasSubscriptionClient
	vapidPublicKey      string
	vapidKeyFingerprint string
}

func NewRepository(db *dbpkg.Postgres, externalConfig ExternalConfig) Repository {
	vapidPublicKey := strings.TrimSpace(externalConfig.VAPIDPublicKey)
	return Repository{
		db:                  db,
		storage:             newStorageClient(externalConfig),
		authAdmin:           newAuthAdminClient(externalConfig),
		email:               newPasswordNotificationClient(externalConfig),
		asaasSubscriptions:  newAsaasSubscriptionClient(externalConfig),
		vapidPublicKey:      vapidPublicKey,
		vapidKeyFingerprint: pushconfig.Fingerprint(vapidPublicKey),
	}
}

func (repo Repository) PublicSystemSettings(ctx context.Context) (map[string]any, error) {
	var raw []byte
	err := repo.db.Pool().QueryRow(ctx, `
		select jsonb_build_object(
			'id', id::text,
			'key', key,
			'value', coalesce(value, '{}'::jsonb),
			'description', description,
			'created_at', created_at::text,
			'updated_at', updated_at::text
		)
		from public.system_settings
		where key = 'global'
		limit 1
	`).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) || isUndefinedTableError(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	item, err := jsonvalue.DecodeObject(raw)
	if err != nil {
		return nil, err
	}
	if value, ok := item["value"].(map[string]any); ok {
		item["value"] = sanitizePublicSystemSettingsValue(value)
	}
	return item, nil
}

func normalizeUUID(value string) (string, bool) {
	return pgvalue.NormalizeUUID(value)
}

func textPointer(value pgtype.Text) *string {
	return pgvalue.TextPointerNonBlank(value)
}

func textValue(value pgtype.Text) string {
	if !value.Valid {
		return ""
	}

	return strings.TrimSpace(value.String)
}

func cleanStringPointer(value *string) *string {
	if value == nil {
		return nil
	}
	cleaned := strings.TrimSpace(*value)
	if cleaned == "" {
		return nil
	}

	return &cleaned
}

func sanitizePublicSystemSettingsValue(value map[string]any) map[string]any {
	allowed := map[string]bool{
		"logo_url_light":      true,
		"logo_url_dark":       true,
		"favicon_url_light":   true,
		"favicon_url_dark":    true,
		"pwa_icon_url":        true,
		"login_bg_url":        true,
		"default_whatsapp":    true,
		"contact_whatsapp":    true,
		"logo_width":          true,
		"logo_height":         true,
		"maintenance_mode":    true,
		"maintenance_message": true,
		"feature_flags":       true,
		"logo_principal":      true,
		"logo_secundaria":     true,
		"favicon":             true,
		"imagens_padrao":      true,
		"comunicados":         true,
		"force_update":        true,
	}

	sanitized := map[string]any{}
	for key, item := range value {
		if key == "maintenance" {
			maintenance, ok := item.(map[string]any)
			if !ok {
				continue
			}
			publicMaintenance := map[string]any{}
			if enabled, exists := maintenance["enabled"]; exists {
				publicMaintenance["enabled"] = enabled
			}
			if message, exists := maintenance["message"]; exists {
				publicMaintenance["message"] = message
			}
			sanitized[key] = publicMaintenance
			continue
		}
		if allowed[key] {
			sanitized[key] = item
		}
	}
	return sanitized
}

func cleanUpperStringPointer(value *string) *string {
	cleaned := cleanStringPointer(value)
	if cleaned == nil {
		return nil
	}
	upper := strings.ToUpper(*cleaned)
	return &upper
}

func isUndefinedTableError(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "42P01"
}

func isUndefinedColumnError(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "42703"
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func canManageSetting(tenantContext tenant.Context, permission string) bool {
	return tenantContext.IsSuperAdmin ||
		tenantContext.HasRole("owner", "admin") ||
		tenantContext.HasPermission(permission)
}
