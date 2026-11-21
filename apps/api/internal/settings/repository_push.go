package settings

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/pushconfig"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) PublicPushConfig() PublicPushConfig {
	return PublicPushConfig{
		Enabled:     repo.vapidPublicKey != "",
		PublicKey:   repo.vapidPublicKey,
		Fingerprint: repo.vapidKeyFingerprint,
	}
}

func (repo Repository) SavePushToken(ctx context.Context, tenantContext tenant.Context, request PushTokenRequest) (PushTokenResult, error) {
	if tenantContext.UserID == "" || tenantContext.OrganizationID == "" {
		return PushTokenResult{}, ErrInvalidInput
	}
	endpoint := strings.TrimSpace(request.Endpoint)
	if endpoint == "" {
		return PushTokenResult{}, ErrInvalidInput
	}
	if strings.HasPrefix(strings.ToLower(endpoint), "https://") {
		clientVAPIDPublicKey := cleanStringPointer(request.VAPIDPublicKey)
		if clientVAPIDPublicKey == nil || *clientVAPIDPublicKey != repo.vapidPublicKey {
			return PushTokenResult{}, ErrPushVAPIDMismatch
		}
	}
	token := legacyPushTokenValue(endpoint)
	platform := legacyPushPlatform(endpoint)
	deviceInfo, err := legacyPushDeviceInfo(endpoint, request)
	if err != nil {
		return PushTokenResult{}, err
	}
	return repo.savePushTokenAtomically(ctx, tenantContext, request, endpoint, token, platform, deviceInfo)
}

func (repo Repository) ListPushDevices(ctx context.Context, tenantContext tenant.Context) ([]PushDevice, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		select id::text,
		       coalesce(nullif(platform, ''), 'web'),
		       coalesce(
		         nullif(device_info->>'deviceName', ''),
		         nullif(device_info->>'model', ''),
		         nullif(user_agent, ''),
		         case when coalesce(platform, 'web') = 'web' then 'Navegador web' else 'Dispositivo movel' end
		       ),
		       coalesce(is_active, true),
		       last_success_at,
		       last_failure_at,
		       last_failure_reason,
		       coalesce(failure_count, 0),
		       coalesce(updated_at, created_at, now())
		from public.push_tokens
		where user_id = $1::uuid
		order by coalesce(is_active, true) desc, updated_at desc nulls last, created_at desc
	`, tenantContext.UserID)
	if isUndefinedTableError(err) || isUndefinedColumnError(err) {
		return []PushDevice{}, nil
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	devices := []PushDevice{}
	for rows.Next() {
		var device PushDevice
		var lastSuccessAt, lastFailureAt pgtype.Timestamptz
		var lastFailureReason pgtype.Text
		if err := rows.Scan(
			&device.ID, &device.Platform, &device.Label, &device.Active,
			&lastSuccessAt, &lastFailureAt, &lastFailureReason,
			&device.FailureCount, &device.UpdatedAt,
		); err != nil {
			return nil, err
		}
		if lastSuccessAt.Valid {
			value := lastSuccessAt.Time
			device.LastSuccessAt = &value
		}
		if lastFailureAt.Valid {
			value := lastFailureAt.Time
			device.LastFailureAt = &value
		}
		if lastFailureReason.Valid {
			value := lastFailureReason.String
			device.LastFailureReason = &value
		}
		devices = append(devices, device)
	}
	return devices, rows.Err()
}

func (repo Repository) deactivatePushEndpointForOtherUsers(
	ctx context.Context,
	userID string,
	endpoint string,
	legacyToken string,
) error {
	_, err := repo.db.Pool().Exec(ctx, `
		update public.push_tokens
		set is_active = false,
		    updated_at = now()
		where user_id is distinct from $1::uuid
		  and endpoint = $2
		  and coalesce(is_active, false) = true
	`, userID, endpoint)
	if isUndefinedTableError(err) {
		return nil
	}
	if !isUndefinedColumnError(err) {
		return err
	}

	_, err = repo.db.Pool().Exec(ctx, `
		update public.push_tokens
		set is_active = false,
		    updated_at = now()
		where user_id is distinct from $1::uuid
		  and token = $2
		  and coalesce(is_active, false) = true
	`, userID, legacyToken)
	if isUndefinedTableError(err) {
		return nil
	}
	return err
}

func (repo Repository) hasInactivePushToken(ctx context.Context, userID string, endpoint string) (bool, error) {
	var exists bool
	err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from public.push_tokens
			where user_id = $1::uuid
			  and endpoint = $2
			  and coalesce(is_active, false) = false
		)
	`, userID, endpoint).Scan(&exists)
	return exists, err
}

func (repo Repository) DeactivatePushToken(ctx context.Context, tenantContext tenant.Context, request DeactivatePushTokenRequest) error {
	if tenantContext.UserID == "" {
		return ErrInvalidInput
	}
	return repo.deactivatePushTokenSession(ctx, tenantContext, request)
}

func (repo Repository) saveLegacyPushToken(ctx context.Context, tenantContext tenant.Context, endpoint string, request PushTokenRequest) (PushTokenResult, error) {
	token := legacyPushTokenValue(endpoint)
	platform := legacyPushPlatform(endpoint)
	deviceInfo, err := legacyPushDeviceInfo(endpoint, request)
	if err != nil {
		return PushTokenResult{}, err
	}

	result, err := repo.db.Pool().Exec(ctx, `
		update public.push_tokens
		set organization_id = $1::uuid,
		    platform = $4,
		    device_info = $5::jsonb,
		    is_active = true,
		    updated_at = now()
		where user_id = $2::uuid
		  and token = $3
	`, tenantContext.OrganizationID, tenantContext.UserID, token, platform, string(deviceInfo))
	if isUndefinedTableError(err) {
		return PushTokenResult{OK: true, Active: false}, nil
	}
	if err != nil {
		return PushTokenResult{}, err
	}
	if result.RowsAffected() > 0 {
		return PushTokenResult{OK: true, Active: true}, nil
	}

	_, err = repo.db.Pool().Exec(ctx, `
		insert into public.push_tokens (
			organization_id,
			user_id,
			token,
			platform,
			device_info,
			is_active
		)
		values ($1::uuid, $2::uuid, $3, $4, $5::jsonb, true)
	`, tenantContext.OrganizationID, tenantContext.UserID, token, platform, string(deviceInfo))
	if isUniqueViolation(err) {
		_, err = repo.db.Pool().Exec(ctx, `
			update public.push_tokens
			set organization_id = $1::uuid,
			    platform = $4,
			    device_info = $5::jsonb,
			    is_active = true,
			    updated_at = now()
			where user_id = $2::uuid
			  and token = $3
		`, tenantContext.OrganizationID, tenantContext.UserID, token, platform, string(deviceInfo))
	}
	if err != nil {
		return PushTokenResult{}, err
	}
	return PushTokenResult{OK: true, Active: true}, nil
}

func (repo Repository) deactivateLegacyPushToken(ctx context.Context, userID string, endpoint *string) error {
	var err error
	if endpoint == nil {
		_, err = repo.db.Pool().Exec(ctx, `
			update public.push_tokens
			set is_active = false,
			    updated_at = now()
			where user_id = $1::uuid
		`, userID)
	} else {
		token := legacyPushTokenValue(*endpoint)
		_, err = repo.db.Pool().Exec(ctx, `
			update public.push_tokens
			set is_active = false,
			    updated_at = now()
			where user_id = $1::uuid
			  and (token = $2 or token = $3)
		`, userID, token, *endpoint)
	}
	if isUndefinedTableError(err) {
		return nil
	}
	return err
}

func legacyPushTokenValue(endpoint string) string {
	endpoint = strings.TrimSpace(endpoint)
	if strings.HasPrefix(endpoint, "native:") {
		parts := strings.SplitN(endpoint, ":", 3)
		if len(parts) == 3 && strings.TrimSpace(parts[2]) != "" {
			return strings.TrimSpace(parts[2])
		}
	}
	return endpoint
}

func legacyPushPlatform(endpoint string) string {
	endpoint = strings.TrimSpace(endpoint)
	if strings.HasPrefix(endpoint, "native:") {
		parts := strings.SplitN(endpoint, ":", 3)
		if len(parts) >= 2 && strings.TrimSpace(parts[1]) != "" {
			return strings.ToLower(strings.TrimSpace(parts[1]))
		}
	}
	return "web"
}

func legacyPushDeviceInfo(endpoint string, request PushTokenRequest) ([]byte, error) {
	deviceInfo := map[string]any{
		"endpoint": endpoint,
	}
	if value := cleanStringPointer(request.P256DH); value != nil {
		deviceInfo["p256dh"] = *value
	}
	if value := cleanStringPointer(request.Auth); value != nil {
		deviceInfo["auth"] = *value
	}
	if value := cleanStringPointer(request.UserAgent); value != nil {
		deviceInfo["userAgent"] = *value
	}
	if value := cleanStringPointer(request.VAPIDPublicKey); value != nil {
		deviceInfo["vapidKeyFingerprint"] = pushconfig.Fingerprint(*value)
	}
	return json.Marshal(deviceInfo)
}
