package admin

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const notificationSecretUnchanged = "unchanged"

type NotificationDispatchSettings struct {
	Enabled                 bool   `json:"enabled"`
	Mode                    string `json:"mode"`
	InstanceName            string `json:"instanceName"`
	SenderNumber            string `json:"senderNumber"`
	WebhookURL              string `json:"webhookUrl"`
	HeaderName              string `json:"headerName"`
	TimeoutSeconds          int    `json:"timeoutSeconds"`
	InstanceTokenConfigured bool   `json:"instanceTokenConfigured"`
	HeaderValueConfigured   bool   `json:"headerValueConfigured"`
	UpdatedAt               string `json:"updatedAt,omitempty"`
}

type NotificationSecretWrite struct {
	Action string `json:"action"`
	Value  string `json:"value,omitempty"`
}

type UpdateNotificationDispatchSettingsRequest struct {
	Enabled        bool                    `json:"enabled"`
	Mode           string                  `json:"mode"`
	InstanceName   string                  `json:"instanceName"`
	SenderNumber   string                  `json:"senderNumber"`
	WebhookURL     string                  `json:"webhookUrl"`
	HeaderName     string                  `json:"headerName"`
	TimeoutSeconds int                     `json:"timeoutSeconds"`
	InstanceToken  NotificationSecretWrite `json:"instanceToken"`
	HeaderValue    NotificationSecretWrite `json:"headerValue"`
}

func (repo Repository) ShowNotificationDispatchSettings(
	ctx context.Context,
	tenantContext tenant.Context,
) (NotificationDispatchSettings, error) {
	if !tenantContext.IsSuperAdmin {
		return NotificationDispatchSettings{}, tenant.ErrOrganizationAccessDenied
	}

	value, updatedAt, err := repo.notificationSystemSettingValue(ctx, nil)
	if err != nil {
		return NotificationDispatchSettings{}, err
	}
	return maskNotificationDispatchSettings(value, updatedAt), nil
}

func (repo Repository) UpdateNotificationDispatchSettings(
	ctx context.Context,
	tenantContext tenant.Context,
	request UpdateNotificationDispatchSettingsRequest,
) (NotificationDispatchSettings, error) {
	if !tenantContext.IsSuperAdmin {
		return NotificationDispatchSettings{}, tenant.ErrOrganizationAccessDenied
	}
	validated, err := validateNotificationDispatchSettingsRequest(request, repo.environment)
	if err != nil {
		return NotificationDispatchSettings{}, err
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return NotificationDispatchSettings{}, err
	}
	defer tx.Rollback(ctx)

	value, _, err := repo.notificationSystemSettingValue(ctx, tx)
	if err != nil {
		return NotificationDispatchSettings{}, err
	}
	dispatch := objectValue(value["notification_dispatch"])
	whatsapp := objectValue(dispatch["whatsapp"])

	whatsapp["enabled"] = validated.Enabled
	whatsapp["mode"] = validated.Mode
	whatsapp["instance_name"] = validated.InstanceName
	whatsapp["phone_number"] = validated.SenderNumber
	whatsapp["webhook_url"] = validated.WebhookURL
	whatsapp["allow_organization_session"] = false
	whatsapp["method"] = "POST"
	whatsapp["timeout_seconds"] = validated.TimeoutSeconds

	if err := applyWriteOnlySecret(whatsapp, "token", validated.InstanceToken); err != nil {
		return NotificationDispatchSettings{}, err
	}
	currentHeaders := objectValue(whatsapp["headers"])
	headers := map[string]any{}
	headerAction := strings.ToLower(strings.TrimSpace(validated.HeaderValue.Action))
	currentHeaderValue := strings.TrimSpace(stringValue(currentHeaders[validated.HeaderName]))
	if headerAction == notificationSecretUnchanged {
		if validated.HeaderName == "" {
			for _, item := range currentHeaders {
				if strings.TrimSpace(stringValue(item)) != "" {
					return NotificationDispatchSettings{}, ErrInvalidInput
				}
			}
		} else if currentHeaderValue == "" {
			// A write-only secret cannot be copied to a different header name.
			// Require an explicit replacement instead of silently clearing it.
			return NotificationDispatchSettings{}, ErrInvalidInput
		}
	}
	if validated.HeaderName != "" {
		headerHolder := map[string]any{"value": currentHeaderValue}
		if err := applyWriteOnlySecret(headerHolder, "value", validated.HeaderValue); err != nil {
			return NotificationDispatchSettings{}, err
		}
		if headerValue := strings.TrimSpace(stringValue(headerHolder["value"])); headerValue != "" {
			headers[validated.HeaderName] = headerValue
		}
	}
	whatsapp["headers"] = headers
	if validated.Enabled {
		if validated.Mode == "webhook" && validated.WebhookURL == "" {
			return NotificationDispatchSettings{}, ErrInvalidInput
		}
		if validated.Mode == "evolution_go_instance" &&
			(validated.InstanceName == "" || strings.TrimSpace(stringValue(whatsapp["token"])) == "") {
			return NotificationDispatchSettings{}, ErrInvalidInput
		}
	}
	dispatch["whatsapp"] = whatsapp
	value["notification_dispatch"] = dispatch
	rawValue, err := json.Marshal(value)
	if err != nil {
		return NotificationDispatchSettings{}, err
	}

	var updatedAt string
	err = tx.QueryRow(ctx, `
		insert into public.system_settings (key, description, value)
		values ('notifications', 'Configuracoes globais de entrega transacional', $1::jsonb)
		on conflict (key) do update
		set value = excluded.value,
		    description = excluded.description,
		    updated_at = now()
		returning updated_at::text
	`, string(rawValue)).Scan(&updatedAt)
	if err != nil {
		return NotificationDispatchSettings{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return NotificationDispatchSettings{}, err
	}
	return maskNotificationDispatchSettings(value, updatedAt), nil
}

type queryRower interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func (repo Repository) notificationSystemSettingValue(
	ctx context.Context,
	tx pgx.Tx,
) (map[string]any, string, error) {
	var queryer queryRower = repo.db.Pool()
	suffix := ""
	if tx != nil {
		queryer = tx
		suffix = " for update"
	}
	var rawValue string
	var updatedAt string
	err := queryer.QueryRow(ctx, `
		select coalesce(value, '{}'::jsonb)::text, coalesce(updated_at, created_at, now())::text
		from public.system_settings
		where key = 'notifications'
		order by updated_at desc nulls last, created_at desc nulls last
		limit 1`+suffix).Scan(&rawValue, &updatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return map[string]any{}, "", nil
	}
	if err != nil {
		return nil, "", err
	}
	value := map[string]any{}
	if err := json.Unmarshal([]byte(rawValue), &value); err != nil {
		return nil, "", err
	}
	return value, updatedAt, nil
}

func maskNotificationDispatchSettings(value map[string]any, updatedAt string) NotificationDispatchSettings {
	whatsapp := objectValue(objectValue(value["notification_dispatch"])["whatsapp"])
	headers := objectValue(whatsapp["headers"])
	headerName := ""
	headerValueConfigured := false
	for key, item := range headers {
		if strings.TrimSpace(key) == "" || strings.TrimSpace(stringValue(item)) == "" {
			continue
		}
		headerName = key
		headerValueConfigured = true
		break
	}
	timeout := intValue(whatsapp["timeout_seconds"])
	if timeout < 3 || timeout > 60 {
		timeout = 10
	}
	return NotificationDispatchSettings{
		Enabled:                 boolValue(whatsapp["enabled"]),
		Mode:                    firstNonEmpty(stringValue(whatsapp["mode"]), "webhook"),
		InstanceName:            stringValue(whatsapp["instance_name"]),
		SenderNumber:            stringValue(whatsapp["phone_number"]),
		WebhookURL:              stringValue(whatsapp["webhook_url"]),
		HeaderName:              headerName,
		TimeoutSeconds:          timeout,
		InstanceTokenConfigured: strings.TrimSpace(stringValue(whatsapp["token"])) != "",
		HeaderValueConfigured:   headerValueConfigured,
		UpdatedAt:               updatedAt,
	}
}

func validateNotificationDispatchSettingsRequest(
	request UpdateNotificationDispatchSettingsRequest,
	environment string,
) (UpdateNotificationDispatchSettingsRequest, error) {
	request.Mode = strings.ToLower(strings.TrimSpace(request.Mode))
	request.InstanceName = strings.TrimSpace(request.InstanceName)
	request.SenderNumber = strings.TrimSpace(request.SenderNumber)
	request.WebhookURL = strings.TrimSpace(request.WebhookURL)
	request.HeaderName = strings.TrimSpace(request.HeaderName)
	if request.Mode != "webhook" && request.Mode != "evolution_go_instance" {
		return request, ErrInvalidInput
	}
	if len(request.InstanceName) > 160 || len(request.SenderNumber) > 40 || len(request.WebhookURL) > 2048 || len(request.HeaderName) > 120 {
		return request, ErrInvalidInput
	}
	if request.TimeoutSeconds < 3 || request.TimeoutSeconds > 60 || strings.ContainsAny(request.HeaderName, "\r\n:") {
		return request, ErrInvalidInput
	}
	if request.WebhookURL != "" {
		parsed, err := url.Parse(request.WebhookURL)
		if err != nil || parsed.User != nil || parsed.Host == "" || (strings.EqualFold(environment, "production") && parsed.Scheme != "https") || (parsed.Scheme != "http" && parsed.Scheme != "https") {
			return request, ErrInvalidInput
		}
	}
	for _, secret := range []NotificationSecretWrite{request.InstanceToken, request.HeaderValue} {
		action := strings.ToLower(strings.TrimSpace(secret.Action))
		if action != notificationSecretUnchanged && action != "replace" && action != "clear" {
			return request, ErrInvalidInput
		}
		if action == "replace" && (strings.TrimSpace(secret.Value) == "" || len(secret.Value) > 4096 || strings.ContainsAny(secret.Value, "\r\n")) {
			return request, ErrInvalidInput
		}
		if action != "replace" && strings.TrimSpace(secret.Value) != "" {
			return request, ErrInvalidInput
		}
	}
	if request.HeaderName == "" && strings.EqualFold(strings.TrimSpace(request.HeaderValue.Action), "replace") {
		return request, ErrInvalidInput
	}
	return request, nil
}

func applyWriteOnlySecret(target map[string]any, key string, write NotificationSecretWrite) error {
	switch strings.ToLower(strings.TrimSpace(write.Action)) {
	case notificationSecretUnchanged:
		return nil
	case "replace":
		target[key] = strings.TrimSpace(write.Value)
		return nil
	case "clear":
		delete(target, key)
		return nil
	default:
		return ErrInvalidInput
	}
}

func objectValue(value any) map[string]any {
	object, ok := value.(map[string]any)
	if !ok || object == nil {
		return map[string]any{}
	}
	return object
}
