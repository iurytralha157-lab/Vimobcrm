package settings

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
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

type apiKeyScanner interface {
	Scan(dest ...any) error
}

type organizationModuleScanner interface {
	Scan(dest ...any) error
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

func (repo Repository) PublicPushConfig() PublicPushConfig {
	return PublicPushConfig{
		Enabled:     repo.vapidPublicKey != "",
		PublicKey:   repo.vapidPublicKey,
		Fingerprint: repo.vapidKeyFingerprint,
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

	item, err := decodeJSONObject(raw)
	if err != nil {
		return nil, err
	}
	if value, ok := item["value"].(map[string]any); ok {
		item["value"] = sanitizePublicSystemSettingsValue(value)
	}
	return item, nil
}

func (repo Repository) UpdateProfile(ctx context.Context, tenantContext tenant.Context, request UpdateProfileRequest) error {
	name := cleanStringPointer(request.Name)
	whatsapp := cleanStringPointer(request.Whatsapp)
	cpf := cleanStringPointer(request.CPF)
	themeMode := cleanThemeMode(request.ThemeMode)
	language := cleanLanguage(request.Language)

	tag, err := repo.db.Pool().Exec(ctx, `
		update public.users
		set
			name = coalesce($2, name),
			whatsapp = coalesce($3, whatsapp),
			cpf = coalesce($4, cpf),
			theme_mode = coalesce($5, theme_mode),
			language = coalesce($6, language),
			updated_at = now()
		where id = $1::uuid
	`, tenantContext.UserID, name, whatsapp, cpf, themeMode, language)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrInvalidInput
	}

	return nil
}

func (repo Repository) UpdateOrganization(ctx context.Context, tenantContext tenant.Context, request UpdateOrganizationRequest) error {
	if !canManageSetting(tenantContext, permissions.SettingsOrganization) {
		return tenant.ErrOrganizationAccessDenied
	}

	name := cleanStringPointer(request.Name)
	if name == nil {
		return ErrInvalidInput
	}

	propertyEditPolicy := cleanStringPointer(request.PropertyEditPolicy)
	if propertyEditPolicy != nil && *propertyEditPolicy != "everyone" && *propertyEditPolicy != "responsible_or_admin" {
		return ErrInvalidInput
	}
	propertyOwnerContactVisibility := cleanStringPointer(request.PropertyOwnerContactVisibility)
	if propertyOwnerContactVisibility != nil && *propertyOwnerContactVisibility != "visible" && *propertyOwnerContactVisibility != "hidden" {
		return ErrInvalidInput
	}

	_, err := repo.db.Pool().Exec(ctx, `
		update public.organizations
		set
			name = $2,
			cnpj = $3,
			creci = $4,
			inscricao_estadual = $5,
			razao_social = $6,
			nome_fantasia = $7,
			cep = $8,
			endereco = $9,
			numero = $10,
			complemento = $11,
			bairro = $12,
			cidade = $13,
			uf = $14,
			telefone = $15,
			whatsapp = $16,
			email = $17,
			website = $18,
			default_commission_percentage = coalesce($19, default_commission_percentage),
			property_edit_policy = coalesce($20, property_edit_policy),
			property_owner_contact_visibility = coalesce($21, property_owner_contact_visibility),
			updated_at = now()
		where id = $1::uuid
	`, tenantContext.OrganizationID,
		*name,
		cleanStringPointer(request.CNPJ),
		cleanStringPointer(request.Creci),
		cleanStringPointer(request.InscricaoEstadual),
		cleanStringPointer(request.RazaoSocial),
		cleanStringPointer(request.NomeFantasia),
		cleanStringPointer(request.CEP),
		cleanStringPointer(request.Endereco),
		cleanStringPointer(request.Numero),
		cleanStringPointer(request.Complemento),
		cleanStringPointer(request.Bairro),
		cleanStringPointer(request.Cidade),
		cleanUpperStringPointer(request.UF),
		cleanStringPointer(request.Telefone),
		cleanStringPointer(request.Whatsapp),
		cleanStringPointer(request.Email),
		cleanStringPointer(request.Website),
		request.DefaultCommissionPercentage,
		propertyEditPolicy,
		propertyOwnerContactVisibility,
	)

	return err
}

func (repo Repository) UploadProfileAvatar(ctx context.Context, tenantContext tenant.Context, contentType string, size int64, body io.Reader) (AssetUpload, error) {
	objectPath := fmt.Sprintf("avatars/%s-%d.png", tenantContext.UserID, time.Now().UTC().UnixMilli())
	if err := repo.storage.upload(ctx, "avatars", objectPath, contentType, body); err != nil {
		return AssetUpload{}, err
	}

	publicURL := repo.storage.publicURL("avatars", objectPath)
	_, err := repo.db.Pool().Exec(ctx, `
		update public.users
		set avatar_url = $2,
		    updated_at = now()
		where id = $1::uuid
	`, tenantContext.UserID, publicURL)
	if err != nil {
		return AssetUpload{}, err
	}

	return AssetUpload{
		URL:         publicURL,
		Path:        objectPath,
		Bucket:      "avatars",
		ContentType: contentType,
		Size:        size,
	}, nil
}

func (repo Repository) UploadOrganizationLogo(ctx context.Context, tenantContext tenant.Context, contentType string, size int64, body io.Reader) (AssetUpload, error) {
	if !canManageSetting(tenantContext, permissions.SettingsOrganization) {
		return AssetUpload{}, tenant.ErrOrganizationAccessDenied
	}

	objectPath := fmt.Sprintf("organizations/%s/%d.png", tenantContext.OrganizationID, time.Now().UTC().UnixMilli())
	if err := repo.storage.upload(ctx, "logos", objectPath, contentType, body); err != nil {
		return AssetUpload{}, err
	}

	publicURL := repo.storage.publicURL("logos", objectPath)
	_, err := repo.db.Pool().Exec(ctx, `
		update public.organizations
		set logo_url = $2,
		    updated_at = now()
		where id = $1::uuid
	`, tenantContext.OrganizationID, publicURL)
	if err != nil {
		return AssetUpload{}, err
	}

	return AssetUpload{
		URL:         publicURL,
		Path:        objectPath,
		Bucket:      "logos",
		ContentType: contentType,
		Size:        size,
	}, nil
}

func (repo Repository) ChangePassword(ctx context.Context, tenantContext tenant.Context, request ChangePasswordRequest) (ChangePasswordResult, error) {
	return changePassword(
		ctx,
		tenantContext.UserID,
		request,
		repo.authAdmin.updatePassword,
		repo.recordPasswordChangeEvent,
		repo.sendPasswordChangedNotification,
		slog.Default(),
	)
}

type passwordUpdateFunc func(context.Context, string, string) error

type passwordChangeEventRecorder func(context.Context, string, string) error

type passwordChangedNotifier func(context.Context, string) bool

func changePassword(
	ctx context.Context,
	userID string,
	request ChangePasswordRequest,
	updatePassword passwordUpdateFunc,
	recordEvent passwordChangeEventRecorder,
	notify passwordChangedNotifier,
	logger *slog.Logger,
) (ChangePasswordResult, error) {
	password := request.Password
	if len(password) < 8 || len(password) > 256 {
		return ChangePasswordResult{}, ErrInvalidInput
	}

	source, ok := normalizePasswordChangeSource(request.Source)
	if !ok {
		return ChangePasswordResult{}, ErrInvalidInput
	}

	if err := updatePassword(ctx, userID, password); err != nil {
		return ChangePasswordResult{}, err
	}

	if err := recordEvent(ctx, userID, source); err != nil {
		if logger == nil {
			logger = slog.Default()
		}
		logger.ErrorContext(
			ctx,
			"password changed but audit event persistence failed",
			"user_id", userID,
			"source", source,
			"error", err,
		)
	}

	emailSent := notify(ctx, userID)

	return ChangePasswordResult{
		Allowed:               true,
		Message:               "Senha alterada com sucesso!",
		EmailNotificationSent: emailSent,
	}, nil
}

func normalizePasswordChangeSource(raw string) (string, bool) {
	source := strings.ToLower(strings.TrimSpace(raw))
	if source == "" {
		source = "settings"
	}

	switch source {
	case "settings", "recovery":
		return source, true
	default:
		return "", false
	}
}

func (repo Repository) recordPasswordChangeEvent(ctx context.Context, userID string, source string) error {
	_, err := repo.db.Pool().Exec(ctx, `
		insert into public.password_change_events (user_id, source, metadata)
		values ($1::uuid, $2, '{}'::jsonb)
	`, userID, source)
	return err
}

func (repo Repository) sendPasswordChangedNotification(ctx context.Context, userID string) bool {
	if !repo.email.isConfigured() {
		return false
	}

	var name, email pgtype.Text
	err := repo.db.Pool().QueryRow(ctx, `
		select name, email
		from public.users
		where id = $1::uuid
	`, userID).Scan(&name, &email)
	if err != nil || !email.Valid || strings.TrimSpace(email.String) == "" {
		return false
	}

	err = repo.email.sendPasswordChanged(ctx, passwordChangedEmailInput{
		UserID:    userID,
		Email:     email.String,
		Name:      textValue(name),
		ChangedAt: time.Now(),
	})

	return err == nil
}

func (repo Repository) PasswordStatus(ctx context.Context, tenantContext tenant.Context) (PasswordStatus, error) {
	var status PasswordStatus
	var event PasswordChangeEvent
	err := repo.db.Pool().QueryRow(ctx, `
		select changed_at::text, source
		from public.password_change_events
		where user_id = $1::uuid
		order by changed_at desc
		limit 1
	`, tenantContext.UserID).Scan(&event.ChangedAt, &event.Source)
	if err == nil {
		status.LastChange = &event
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return PasswordStatus{}, err
	}

	var lockout PasswordChangeLockout
	var lockedUntil, reason pgtype.Text
	err = repo.db.Pool().QueryRow(ctx, `
		select locked_until::text, lock_level, last_lock_reason
		from public.password_change_lockouts
		where user_id = $1::uuid
		limit 1
	`, tenantContext.UserID).Scan(&lockedUntil, &lockout.LockLevel, &reason)
	if err == nil {
		lockout.LockedUntil = textPointer(lockedUntil)
		lockout.LastLockReason = textPointer(reason)
		status.Lockout = &lockout
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return PasswordStatus{}, err
	}

	return status, nil
}

func (repo Repository) ListAPIKeys(ctx context.Context, tenantContext tenant.Context) ([]APIKey, error) {
	if !canManageSetting(tenantContext, permissions.SettingsIntegrations) {
		return nil, tenant.ErrOrganizationAccessDenied
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select
			id::text,
			organization_id::text,
			name,
			key_prefix,
			is_active,
			last_used_at::text,
			created_by::text,
			created_at::text,
			updated_at::text
		from public.organization_api_keys
		where organization_id = $1::uuid
		order by created_at desc, id desc
	`, tenantContext.OrganizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []APIKey{}
	for rows.Next() {
		item, err := scanAPIKey(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}

	return items, rows.Err()
}

func (repo Repository) ListOrganizationModules(ctx context.Context, tenantContext tenant.Context) ([]OrganizationModule, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		select
			id::text,
			organization_id::text,
			module_name,
			coalesce(is_enabled, false),
			created_at::text,
			updated_at::text
		from public.organization_modules
		where organization_id = $1::uuid
		order by module_name asc
	`, tenantContext.OrganizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []OrganizationModule{}
	for rows.Next() {
		item, err := scanOrganizationModule(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}

	return items, rows.Err()
}

func (repo Repository) GetSetupGuideProgress(ctx context.Context, tenantContext tenant.Context) (SetupGuideProgress, error) {
	var completedRaw []byte
	var skipped pgtype.Bool

	err := repo.db.Pool().QueryRow(ctx, `
		select coalesce(completed_steps, '{}'::jsonb), skipped
		from public.setup_guide_progress
		where user_id = $1::uuid
	`, tenantContext.UserID).Scan(&completedRaw, &skipped)
	if errors.Is(err, pgx.ErrNoRows) || isUndefinedTableError(err) {
		return SetupGuideProgress{
			CompletedSteps: map[string]bool{},
			Skipped:        false,
		}, nil
	}
	if err != nil {
		return SetupGuideProgress{}, err
	}

	completed := map[string]bool{}
	if len(completedRaw) > 0 {
		if err := json.Unmarshal(completedRaw, &completed); err != nil {
			return SetupGuideProgress{}, err
		}
	}

	return SetupGuideProgress{
		CompletedSteps: completed,
		Skipped:        skipped.Valid && skipped.Bool,
	}, nil
}

func (repo Repository) UpdateSetupGuideProgress(ctx context.Context, tenantContext tenant.Context, request UpdateSetupGuideProgressRequest) (SetupGuideProgress, error) {
	completed := request.CompletedSteps
	if completed == nil {
		current, err := repo.GetSetupGuideProgress(ctx, tenantContext)
		if err != nil {
			return SetupGuideProgress{}, err
		}
		completed = current.CompletedSteps
	}
	if completed == nil {
		completed = map[string]bool{}
	}
	skipped := false
	if request.Skipped != nil {
		skipped = *request.Skipped
	} else {
		current, err := repo.GetSetupGuideProgress(ctx, tenantContext)
		if err != nil {
			return SetupGuideProgress{}, err
		}
		skipped = current.Skipped
	}

	completedRaw, err := json.Marshal(completed)
	if err != nil {
		return SetupGuideProgress{}, ErrInvalidInput
	}

	_, err = repo.db.Pool().Exec(ctx, `
		insert into public.setup_guide_progress (user_id, completed_steps, skipped)
		values ($1::uuid, $2::jsonb, $3)
		on conflict (user_id) do update
		set completed_steps = excluded.completed_steps,
		    skipped = excluded.skipped,
		    updated_at = now()
	`, tenantContext.UserID, string(completedRaw), skipped)
	if isUndefinedTableError(err) {
		return SetupGuideProgress{CompletedSteps: completed, Skipped: skipped}, nil
	}
	if err != nil {
		return SetupGuideProgress{}, err
	}

	return SetupGuideProgress{CompletedSteps: completed, Skipped: skipped}, nil
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
	if err := repo.deactivatePushEndpointForOtherUsers(
		ctx,
		tenantContext.UserID,
		endpoint,
		token,
	); err != nil {
		return PushTokenResult{}, err
	}
	if request.SyncOnly != nil && *request.SyncOnly {
		dead, err := repo.hasInactivePushToken(ctx, tenantContext.UserID, endpoint)
		if isUndefinedTableError(err) {
			return PushTokenResult{OK: true, Active: false}, nil
		}
		if isUndefinedColumnError(err) {
			dead = false
		} else if err != nil {
			return PushTokenResult{}, err
		}
		if dead {
			return PushTokenResult{OK: true, Active: false, RequiresResubscribe: true}, nil
		}
	}

	result, err := repo.db.Pool().Exec(ctx, `
		update public.push_tokens
		set organization_id = $1::uuid,
		    token = $4,
		    platform = $5,
		    device_info = $6::jsonb,
		    p256dh = $7,
		    auth = $8,
		    user_agent = $9,
		    is_active = true,
		    updated_at = now()
	where user_id = $2::uuid
	  and endpoint = $3
	`, tenantContext.OrganizationID, tenantContext.UserID, endpoint, token, platform, string(deviceInfo), cleanStringPointer(request.P256DH), cleanStringPointer(request.Auth), cleanStringPointer(request.UserAgent))
	if isUndefinedTableError(err) {
		return PushTokenResult{OK: true, Active: false}, nil
	}
	if isUndefinedColumnError(err) {
		return repo.saveLegacyPushToken(ctx, tenantContext, endpoint, request)
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
			endpoint,
			p256dh,
			auth,
			user_agent,
			is_active
		)
		values ($1::uuid, $2::uuid, $3, $4, $5::jsonb, $6, $7, $8, $9, true)
	`, tenantContext.OrganizationID, tenantContext.UserID, token, platform, string(deviceInfo), endpoint, cleanStringPointer(request.P256DH), cleanStringPointer(request.Auth), cleanStringPointer(request.UserAgent))
	if isUniqueViolation(err) {
		_, err = repo.db.Pool().Exec(ctx, `
			update public.push_tokens
			set organization_id = $1::uuid,
			    token = $4,
			    platform = $5,
			    device_info = $6::jsonb,
			    p256dh = $7,
			    auth = $8,
			    user_agent = $9,
			    is_active = true,
			    updated_at = now()
			where user_id = $2::uuid
			  and endpoint = $3
		`, tenantContext.OrganizationID, tenantContext.UserID, endpoint, token, platform, string(deviceInfo), cleanStringPointer(request.P256DH), cleanStringPointer(request.Auth), cleanStringPointer(request.UserAgent))
	}
	if isUndefinedColumnError(err) {
		return repo.saveLegacyPushToken(ctx, tenantContext, endpoint, request)
	}
	if err != nil {
		return PushTokenResult{}, err
	}
	return PushTokenResult{OK: true, Active: true}, nil
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
		where organization_id = $1::uuid and user_id = $2::uuid
		order by coalesce(is_active, true) desc, updated_at desc nulls last, created_at desc
	`, tenantContext.OrganizationID, tenantContext.UserID)
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

	endpoint := cleanStringPointer(request.Endpoint)
	var err error
	if endpoint == nil {
		_, err = repo.db.Pool().Exec(ctx, `
			update public.push_tokens
			set is_active = false,
			    updated_at = now()
			where user_id = $1::uuid
		`, tenantContext.UserID)
	} else {
		_, err = repo.db.Pool().Exec(ctx, `
			update public.push_tokens
			set is_active = false,
			    updated_at = now()
			where user_id = $1::uuid
			  and endpoint = $2
		`, tenantContext.UserID, *endpoint)
	}
	if isUndefinedTableError(err) {
		return nil
	}
	if isUndefinedColumnError(err) {
		return repo.deactivateLegacyPushToken(ctx, tenantContext.UserID, endpoint)
	}
	return err
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

func (repo Repository) CreateAPIKey(ctx context.Context, tenantContext tenant.Context, input CreateAPIKeyInput) (CreateAPIKeyResult, error) {
	if !canManageSetting(tenantContext, permissions.SettingsIntegrations) {
		return CreateAPIKeyResult{}, tenant.ErrOrganizationAccessDenied
	}

	rawKey, err := generateRawAPIKey()
	if err != nil {
		return CreateAPIKeyResult{}, err
	}

	keyHash := sha256.Sum256([]byte(rawKey))
	prefix := rawKey[:14]
	name := strings.TrimSpace(input.Name)
	if name == "" {
		name = "Chave Padrao"
	}

	item, err := scanAPIKey(repo.db.Pool().QueryRow(ctx, `
		insert into public.organization_api_keys (
			organization_id,
			name,
			key_prefix,
			key_hash,
			created_by
		)
		values ($1::uuid, $2, $3, $4, $5::uuid)
		returning
			id::text,
			organization_id::text,
			name,
			key_prefix,
			is_active,
			last_used_at::text,
			created_by::text,
			created_at::text,
			updated_at::text
	`, tenantContext.OrganizationID, name, prefix, hex.EncodeToString(keyHash[:]), tenantContext.UserID))
	if err != nil {
		return CreateAPIKeyResult{}, err
	}

	return CreateAPIKeyResult{APIKey: rawKey, Key: item}, nil
}

func (repo Repository) DeleteAPIKey(ctx context.Context, tenantContext tenant.Context, apiKeyID string) error {
	if !canManageSetting(tenantContext, permissions.SettingsIntegrations) {
		return tenant.ErrOrganizationAccessDenied
	}

	apiKeyID, ok := normalizeUUID(apiKeyID)
	if !ok {
		return ErrInvalidInput
	}

	tag, err := repo.db.Pool().Exec(ctx, `
		delete from public.organization_api_keys
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, apiKeyID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrAPIKeyNotFound
	}

	return nil
}

func (repo Repository) GetSubscriptionOverview(ctx context.Context, tenantContext tenant.Context) (SubscriptionOverview, error) {
	if !canManageSetting(tenantContext, permissions.SettingsBilling) {
		return SubscriptionOverview{}, tenant.ErrOrganizationAccessDenied
	}

	org, plan, pendingPlan, err := repo.getSubscriptionOrgAndPlan(ctx, tenantContext.OrganizationID)
	if err != nil {
		return SubscriptionOverview{}, err
	}
	plans, err := repo.listActiveSubscriptionPlans(ctx)
	if err != nil {
		return SubscriptionOverview{}, err
	}
	history, billingCheckoutReady, err := repo.listPaymentHistory(ctx, tenantContext.OrganizationID)
	if err != nil {
		return SubscriptionOverview{}, err
	}
	planChange, err := repo.getActiveBillingPlanChange(ctx, tenantContext.OrganizationID)
	if err != nil {
		return SubscriptionOverview{}, err
	}
	return SubscriptionOverview{
		Org:                  org,
		Plan:                 plan,
		PendingPlan:          pendingPlan,
		PlanChange:           planChange,
		AvailablePlans:       plans,
		History:              history,
		BillingCheckoutReady: billingCheckoutReady,
	}, nil
}

type localPaymentIdentity struct {
	ID                  string
	AsaasPaymentID      string
	AsaasCustomerID     string
	AsaasSubscriptionID string
	BillingType         string
	Value               float64
	DueDate             string
}

type paymentSnapshotApplyResult struct {
	Outcome string `json:"outcome"`
	Field   string `json:"field"`
}

// RefreshSubscriptionPayment reconciles one tenant-scoped local payment with
// its authoritative Asaas snapshot. The observation timestamp is captured
// before the network request so a newer webhook always wins the database
// ordering race.
func (repo Repository) RefreshSubscriptionPayment(
	ctx context.Context,
	tenantContext tenant.Context,
	paymentID string,
) (PaymentHistoryItem, error) {
	if !canManageSetting(tenantContext, permissions.SettingsBilling) {
		return PaymentHistoryItem{}, tenant.ErrOrganizationAccessDenied
	}

	paymentID, ok := normalizeUUID(paymentID)
	if !ok {
		return PaymentHistoryItem{}, ErrPaymentNotFound
	}

	local, err := repo.getLocalPaymentIdentity(ctx, tenantContext.OrganizationID, paymentID)
	if err != nil {
		return PaymentHistoryItem{}, err
	}
	item, err := repo.getPaymentHistoryItem(ctx, tenantContext.OrganizationID, paymentID)
	if err != nil {
		return PaymentHistoryItem{}, err
	}

	observedAt := time.Now().UTC()
	snapshot, providerErr := repo.asaasSubscriptions.getPayment(ctx, local.AsaasPaymentID)
	if providerErr != nil {
		if ctx.Err() != nil {
			return PaymentHistoryItem{}, ctx.Err()
		}

		// A provider 404 is ambiguous (deleted payment, wrong provider account,
		// or temporary inconsistency). Keep the last local status, mark it as
		// unavailable, and suppress the checkout URL instead of claiming it was
		// cancelled. The same safe response is used for timeouts and upstream
		// outages.
		slog.Warn(
			"billing payment provider refresh unavailable",
			"organization_id", tenantContext.OrganizationID,
			"payment_id", paymentID,
			"provider_not_found", isAsaasPaymentNotFound(providerErr),
		)
		item.SyncState = PaymentSyncStateProviderUnavailable
		item.CheckoutURL = nil
		return item, nil
	}

	if err := validateAsaasPaymentSnapshot(snapshot, local); err != nil {
		slog.Error(
			"billing payment provider identity mismatch",
			"organization_id", tenantContext.OrganizationID,
			"payment_id", paymentID,
		)
		return PaymentHistoryItem{}, err
	}

	providerStatus := snapshot.normalizedStatus()
	if providerStatus == "" {
		item.SyncState = PaymentSyncStateProviderUnavailable
		item.CheckoutURL = nil
		return item, nil
	}

	providerValue := local.Value
	providerDueDate := local.DueDate
	providerCustomerID := local.AsaasCustomerID
	providerSubscriptionID := local.AsaasSubscriptionID
	if !snapshot.Deleted {
		providerValue = *snapshot.Value
		providerDueDate = snapshot.DueDate
		providerCustomerID = snapshot.CustomerID
		providerSubscriptionID = snapshot.SubscriptionID
	}

	var rawResult string
	err = repo.db.Pool().QueryRow(ctx, `
		select public.reconcile_asaas_payment_snapshot(
			$1::uuid,
			nullif($2, ''),
			nullif($3, ''),
			nullif($4, ''),
			nullif($5, ''),
			$6::numeric,
			nullif($7, '')::date,
			$8::timestamptz,
			'settings_payment_refresh'
		)::text
	`,
		tenantContext.OrganizationID,
		local.AsaasPaymentID,
		providerCustomerID,
		providerSubscriptionID,
		providerStatus,
		providerValue,
		providerDueDate,
		observedAt,
	).Scan(&rawResult)
	if err != nil {
		return PaymentHistoryItem{}, err
	}

	var applyResult paymentSnapshotApplyResult
	if err := json.Unmarshal([]byte(rawResult), &applyResult); err != nil {
		return PaymentHistoryItem{}, fmt.Errorf("decode payment refresh result: %w", err)
	}
	switch applyResult.Outcome {
	case "applied", "stale", "stale_snapshot":
		// A stale outcome means a webhook already persisted a newer truth. The
		// reread below intentionally returns that newer row.
	case "organization_not_found", "payment_not_found":
		return PaymentHistoryItem{}, ErrPaymentNotFound
	case "identifier_mismatch", "amount_mismatch", "invalid_identity", "invalid_payment_snapshot", "unsupported_status", "invalid_observed_at", "invalid_source":
		return PaymentHistoryItem{}, fmt.Errorf(
			"%w: %s",
			ErrPaymentProviderMismatch,
			strings.TrimSpace(applyResult.Field),
		)
	default:
		return PaymentHistoryItem{}, fmt.Errorf(
			"unexpected payment refresh outcome %q",
			applyResult.Outcome,
		)
	}

	item, err = repo.getPaymentHistoryItem(ctx, tenantContext.OrganizationID, paymentID)
	if err != nil {
		return PaymentHistoryItem{}, err
	}
	item.SyncState = PaymentSyncStateCurrent
	return item, nil
}

func (repo Repository) UpdateSubscriptionBilling(ctx context.Context, tenantContext tenant.Context, request UpdateBillingRequest) (SubscriptionOverview, error) {
	if !canManageSetting(tenantContext, permissions.SettingsBilling) {
		return SubscriptionOverview{}, tenant.ErrOrganizationAccessDenied
	}

	_, err := repo.db.Pool().Exec(ctx, `
		update public.organizations
		set
			billing_legal_name = $2,
			billing_tax_id = $3,
			billing_postal_code = $4,
			billing_address = $5,
			billing_address_number = $6,
			billing_address_complement = $7,
			billing_neighborhood = $8,
			billing_city = $9,
			billing_state = $10,
			billing_email = $11,
			billing_phone = $12,
			updated_at = now()
		where id = $1::uuid
	`, tenantContext.OrganizationID,
		cleanStringPointer(request.RazaoSocial),
		cleanStringPointer(request.CNPJ),
		cleanStringPointer(request.CEP),
		cleanStringPointer(request.Endereco),
		cleanStringPointer(request.Numero),
		cleanStringPointer(request.Complemento),
		cleanStringPointer(request.Bairro),
		cleanStringPointer(request.Cidade),
		cleanUpperStringPointer(request.UF),
		cleanStringPointer(request.Email),
		cleanStringPointer(request.Telefone),
	)
	if err != nil {
		return SubscriptionOverview{}, err
	}

	return repo.GetSubscriptionOverview(ctx, tenantContext)
}

func (repo Repository) SelectSubscriptionPlan(ctx context.Context, tenantContext tenant.Context, planID string) (SubscriptionOverview, error) {
	if !canManageSetting(tenantContext, permissions.SettingsBilling) {
		return SubscriptionOverview{}, tenant.ErrOrganizationAccessDenied
	}

	planID, ok := normalizeUUID(planID)
	if !ok {
		return SubscriptionOverview{}, ErrInvalidInput
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return SubscriptionOverview{}, err
	}
	defer tx.Rollback(ctx)

	var currentPlanID, pendingPlanID, subscriptionType, subscriptionStatus, providerSubscriptionID string
	var currentPlanConsistent bool
	var targetPlanName, nextBillingDate string
	var targetPlanPrice float64
	var billingPeriodMonths int
	err = tx.QueryRow(ctx, `
		select
			coalesce(o.plan_id::text, ''),
			coalesce(o.pending_plan_id::text, ''),
			coalesce(o.subscription_type, ''),
			coalesce(o.subscription_status, ''),
			coalesce(o.asaas_subscription_id, ''),
			exists (
				select 1
				from public.admin_subscription_plans current_plan
				where current_plan.id = o.plan_id
				  and coalesce(current_plan.price, 0) > 0
			),
			p.name,
			p.price::double precision,
			case
				when o.subscription_billing_period_months in (1, 6, 12)
					then o.subscription_billing_period_months
				else 1
			end,
			coalesce(to_char(o.next_billing_date, 'YYYY-MM-DD'), '')
		from public.organizations o
		join public.admin_subscription_plans p
		  on p.id = $2::uuid
		 and coalesce(p.is_active, true) = true
		 and coalesce(p.is_public, true) = true
		 and coalesce(p.price, 0) > 0
		 and lower(btrim(p.name)) not in ('trial', 'básico', 'basico')
		where o.id = $1::uuid
		for update of o
	`, tenantContext.OrganizationID, planID).Scan(
		&currentPlanID,
		&pendingPlanID,
		&subscriptionType,
		&subscriptionStatus,
		&providerSubscriptionID,
		&currentPlanConsistent,
		&targetPlanName,
		&targetPlanPrice,
		&billingPeriodMonths,
		&nextBillingDate,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return SubscriptionOverview{}, ErrInvalidInput
	}
	if err != nil {
		return SubscriptionOverview{}, err
	}
	var activeCheckoutPlanID string
	err = tx.QueryRow(ctx, `
		select coalesce(intent.pending_plan_id::text, '')
		from private.billing_checkout_intents intent
		where intent.organization_id = $1::uuid
		  and intent.status in ('creating', 'pending')
		order by intent.created_at desc, intent.id desc
		limit 1
		for update
	`, tenantContext.OrganizationID).Scan(&activeCheckoutPlanID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return SubscriptionOverview{}, err
	}
	// Re-selecting the current paid plan is an idempotent read, not permission
	// to open a second provider subscription.
	if isIdempotentPaidPlanSelection(
		subscriptionType,
		subscriptionStatus,
		currentPlanID,
		planID,
		currentPlanConsistent,
	) {
		if strings.TrimSpace(pendingPlanID) != "" &&
			!strings.EqualFold(strings.TrimSpace(pendingPlanID), planID) {
			return SubscriptionOverview{}, ErrPlanChangeInProgress
		}
		if err := tx.Commit(ctx); err != nil {
			return SubscriptionOverview{}, err
		}
		return repo.GetSubscriptionOverview(ctx, tenantContext)
	}

	// A provider-linked organization must never fall through to checkout, even
	// if its local subscription type drifted away from the provider contract.
	// Only an active contract with a known paid current plan may continue, and
	// that path is required to become the managed update below. Missing catalog
	// state and non-active contracts fail closed for billing regularization.
	if blocksProviderPlanChange(
		subscriptionType,
		subscriptionStatus,
		currentPlanID,
		planID,
		providerSubscriptionID,
		currentPlanConsistent,
	) {
		return SubscriptionOverview{}, ErrPlanChangeRequiresActive
	}
	if activeCheckoutPlanID != "" && !strings.EqualFold(activeCheckoutPlanID, planID) {
		return SubscriptionOverview{}, ErrCheckoutInProgress
	}

	managedPlanChange := requiresManagedPlanChange(
		subscriptionType,
		subscriptionStatus,
		currentPlanID,
		planID,
		providerSubscriptionID,
		currentPlanConsistent,
	)
	if managedPlanChange {
		if activeCheckoutPlanID != "" {
			return SubscriptionOverview{}, ErrCheckoutInProgress
		}
		if !repo.asaasSubscriptions.isConfigured() {
			return SubscriptionOverview{}, ErrAsaasNotConfigured
		}

		amount := math.Round(targetPlanPrice*float64(billingPeriodMonths)*100) / 100
		cycle := asaasCycleForBillingPeriod(billingPeriodMonths)
		description := managedPlanDescription(targetPlanName, billingPeriodMonths)
		changeID, alreadyScheduled, recoverProviderState, err := stageManagedPlanChange(
			ctx,
			tx,
			tenantContext,
			currentPlanID,
			planID,
			providerSubscriptionID,
			billingPeriodMonths,
			amount,
			cycle,
			description,
			pendingPlanID,
		)
		if err != nil {
			return SubscriptionOverview{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return SubscriptionOverview{}, err
		}
		if alreadyScheduled {
			return repo.GetSubscriptionOverview(ctx, tenantContext)
		}

		providerInput := asaasPlanChangeInput{
			Amount:      amount,
			Cycle:       cycle,
			Description: description,
		}
		var snapshot asaasSubscriptionSnapshot
		var providerErr error
		if recoverProviderState {
			snapshot, providerErr = repo.asaasSubscriptions.recoverPlanChange(
				ctx,
				providerSubscriptionID,
				providerInput,
			)
		} else {
			snapshot, providerErr = repo.asaasSubscriptions.schedulePlanChange(
				ctx,
				providerSubscriptionID,
				providerInput,
			)
		}
		if providerErr != nil {
			persistenceCtx, cancelPersistence := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
			defer cancelPersistence()
			if errors.Is(providerErr, ErrAsaasOperation) {
				if persistErr := repo.failManagedPlanChange(
					persistenceCtx,
					tenantContext.OrganizationID,
					changeID,
					planID,
				); persistErr != nil {
					return SubscriptionOverview{}, errors.Join(providerErr, persistErr)
				}
			} else if errors.Is(providerErr, ErrAsaasAmbiguous) {
				if persistErr := repo.markManagedPlanChangeAmbiguous(persistenceCtx, changeID); persistErr != nil {
					return SubscriptionOverview{}, errors.Join(providerErr, persistErr)
				}
			}
			return SubscriptionOverview{}, providerErr
		}

		effectiveOn := normalizeProviderDate(snapshot.NextDueDate)
		if effectiveOn == "" {
			effectiveOn = normalizeProviderDate(nextBillingDate)
		}
		persistenceCtx, cancelPersistence := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancelPersistence()
		if effectiveOn == "" {
			// Never guess a billing anchor. The payment trigger can still recover
			// an accepted but ambiguous provider update from an exact future charge.
			if persistErr := repo.markManagedPlanChangeAmbiguous(persistenceCtx, changeID); persistErr != nil {
				return SubscriptionOverview{}, errors.Join(ErrAsaasAmbiguous, persistErr)
			}
			return SubscriptionOverview{}, ErrAsaasAmbiguous
		}
		if err := repo.confirmManagedPlanChange(
			persistenceCtx,
			changeID,
			snapshot.rawJSON(),
			effectiveOn,
		); err != nil {
			// The provider may already have accepted the update. Keeping the
			// durable row in provider_updating lets an identical retry recover.
			return SubscriptionOverview{}, err
		}

		return repo.GetSubscriptionOverview(ctx, tenantContext)
	}

	stagedStatus := subscriptionStatusWhilePlanPending(subscriptionType, subscriptionStatus)
	tag, err := tx.Exec(ctx, `
		update public.organizations o
		set
			pending_plan_id = p.id,
			subscription_status = $3,
			updated_at = now()
		from public.admin_subscription_plans p
		where o.id = $1::uuid
		  and p.id = $2::uuid
		  and coalesce(p.is_active, true) = true
		  and coalesce(p.is_public, true) = true
		  and coalesce(p.price, 0) > 0
		  and lower(btrim(p.name)) not in ('trial', 'básico', 'basico')
	`, tenantContext.OrganizationID, planID, stagedStatus)
	if err != nil {
		return SubscriptionOverview{}, err
	}
	if tag.RowsAffected() == 0 {
		return SubscriptionOverview{}, ErrInvalidInput
	}
	if err := tx.Commit(ctx); err != nil {
		return SubscriptionOverview{}, err
	}

	return repo.GetSubscriptionOverview(ctx, tenantContext)
}

func stageManagedPlanChange(
	ctx context.Context,
	tx pgx.Tx,
	tenantContext tenant.Context,
	currentPlanID string,
	targetPlanID string,
	providerSubscriptionID string,
	billingPeriodMonths int,
	amount float64,
	cycle string,
	description string,
	pendingPlanID string,
) (string, bool, bool, error) {
	var existingID, existingTargetPlanID, existingProviderID, existingStatus string
	var existingPeriod int
	var existingAmount float64
	err := tx.QueryRow(ctx, `
		select
			change.id::text,
			change.target_plan_id::text,
			change.provider_subscription_id,
			change.billing_period_months,
			change.amount::double precision,
			change.status
		from private.billing_plan_changes change
		where change.organization_id = $1::uuid
		  and change.status in ('provider_updating', 'scheduled')
		order by change.created_at desc, change.id desc
		limit 1
		for update
	`, tenantContext.OrganizationID).Scan(
		&existingID,
		&existingTargetPlanID,
		&existingProviderID,
		&existingPeriod,
		&existingAmount,
		&existingStatus,
	)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", false, false, err
	}
	if err == nil {
		sameRequest := sameManagedPlanChange(
			existingTargetPlanID,
			existingProviderID,
			existingPeriod,
			existingAmount,
			targetPlanID,
			providerSubscriptionID,
			billingPeriodMonths,
			amount,
		)
		if !sameRequest {
			return "", false, false, ErrPlanChangeInProgress
		}
		alreadyScheduled := strings.EqualFold(existingStatus, "scheduled")
		return existingID, alreadyScheduled, !alreadyScheduled, nil
	}

	if strings.TrimSpace(pendingPlanID) != "" && !strings.EqualFold(pendingPlanID, targetPlanID) {
		return "", false, false, ErrPlanChangeInProgress
	}

	var changeID string
	err = tx.QueryRow(ctx, `
		insert into private.billing_plan_changes (
			organization_id,
			from_plan_id,
			target_plan_id,
			requested_by,
			provider_subscription_id,
			billing_period_months,
			amount,
			provider_cycle,
			description,
			status,
			provider_request_started_at
		)
		values (
			$1::uuid,
			$2::uuid,
			$3::uuid,
			nullif($4, '')::uuid,
			$5,
			$6,
			$7::numeric,
			$8,
			$9,
			'provider_updating',
			now()
		)
		returning id::text
	`,
		tenantContext.OrganizationID,
		currentPlanID,
		targetPlanID,
		tenantContext.UserID,
		providerSubscriptionID,
		billingPeriodMonths,
		amount,
		cycle,
		description,
	).Scan(&changeID)
	if err != nil {
		if isUniqueViolation(err) {
			return "", false, false, ErrPlanChangeInProgress
		}
		return "", false, false, err
	}

	if _, err := tx.Exec(ctx, `
		update public.organizations
		set pending_plan_id = $2::uuid,
		    updated_at = now()
		where id = $1::uuid
	`, tenantContext.OrganizationID, targetPlanID); err != nil {
		return "", false, false, err
	}

	return changeID, false, false, nil
}

func sameManagedPlanChange(
	existingTargetPlanID string,
	existingProviderID string,
	existingPeriod int,
	existingAmount float64,
	targetPlanID string,
	providerSubscriptionID string,
	billingPeriodMonths int,
	amount float64,
) bool {
	return strings.EqualFold(existingTargetPlanID, targetPlanID) &&
		strings.EqualFold(existingProviderID, providerSubscriptionID) &&
		existingPeriod == billingPeriodMonths &&
		math.Abs(existingAmount-amount) < 0.005
}

func (repo Repository) markManagedPlanChangeAmbiguous(ctx context.Context, changeID string) error {
	_, err := repo.db.Pool().Exec(ctx, `
		update private.billing_plan_changes
		set
			last_error = 'provider response ambiguous; retry will read provider state first',
			updated_at = now()
		where id = $1::uuid
		  and status = 'provider_updating'
	`, changeID)
	return err
}

func (repo Repository) confirmManagedPlanChange(
	ctx context.Context,
	changeID string,
	providerResponse json.RawMessage,
	effectiveOn string,
) error {
	tag, err := repo.db.Pool().Exec(ctx, `
		update private.billing_plan_changes
		set
			status = 'scheduled',
			provider_response = $2::jsonb,
			provider_updated_at = now(),
			effective_on = $3::date,
			last_error = null,
			updated_at = now()
		where id = $1::uuid
		  and status = 'provider_updating'
	`, changeID, providerResponse, effectiveOn)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		var status string
		if readErr := repo.db.Pool().QueryRow(ctx, `
			select status
			from private.billing_plan_changes
			where id = $1::uuid
		`, changeID).Scan(&status); readErr == nil && strings.EqualFold(status, "scheduled") {
			return nil
		}
		return ErrAsaasAmbiguous
	}
	return nil
}

func (repo Repository) failManagedPlanChange(
	ctx context.Context,
	organizationID string,
	changeID string,
	targetPlanID string,
) error {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		update private.billing_plan_changes
		set
			status = 'failed',
			failed_at = now(),
			last_error = 'provider rejected subscription update',
			updated_at = now()
		where id = $1::uuid
		  and status = 'provider_updating'
	`, changeID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		update public.organizations organization_row
		set pending_plan_id = null,
		    updated_at = now()
		where organization_row.id = $1::uuid
		  and organization_row.pending_plan_id = $2::uuid
		  and not exists (
			select 1
			from private.billing_plan_changes active_change
			where active_change.organization_id = organization_row.id
			  and active_change.status in ('provider_updating', 'scheduled')
		  )
	`, organizationID, targetPlanID); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func asaasCycleForBillingPeriod(months int) string {
	switch months {
	case 6:
		return "SEMIANNUALLY"
	case 12:
		return "YEARLY"
	default:
		return "MONTHLY"
	}
}

func managedPlanDescription(planName string, months int) string {
	return fmt.Sprintf("Vimob CRM - Plano %s - %d mes(es)", strings.TrimSpace(planName), months)
}

func normalizeProviderDate(value string) string {
	value = strings.TrimSpace(value)
	if len(value) != len("2006-01-02") {
		return ""
	}
	if _, err := time.Parse("2006-01-02", value); err != nil {
		return ""
	}
	return value
}

func subscriptionStatusWhilePlanPending(subscriptionType string, subscriptionStatus string) string {
	subscriptionType = strings.ToLower(strings.TrimSpace(subscriptionType))
	subscriptionStatus = strings.ToLower(strings.TrimSpace(subscriptionStatus))

	if (subscriptionType == "free" || subscriptionType == "paid") && subscriptionStatus == "active" {
		return "active"
	}
	if subscriptionType == "trial" && subscriptionStatus == "trial" {
		return "trial"
	}
	return "pending_payment"
}

func isIdempotentPaidPlanSelection(
	subscriptionType string,
	subscriptionStatus string,
	currentPlanID string,
	targetPlanID string,
	currentPlanConsistent bool,
) bool {
	return strings.EqualFold(strings.TrimSpace(subscriptionType), "paid") &&
		strings.EqualFold(strings.TrimSpace(subscriptionStatus), "active") &&
		currentPlanConsistent &&
		strings.TrimSpace(currentPlanID) != "" &&
		strings.EqualFold(strings.TrimSpace(currentPlanID), strings.TrimSpace(targetPlanID))
}

func requiresManagedPlanChange(
	subscriptionType string,
	subscriptionStatus string,
	currentPlanID string,
	targetPlanID string,
	providerSubscriptionID string,
	currentPlanConsistent bool,
) bool {
	differentPlan := strings.TrimSpace(currentPlanID) != "" &&
		strings.TrimSpace(targetPlanID) != "" &&
		!strings.EqualFold(strings.TrimSpace(currentPlanID), strings.TrimSpace(targetPlanID))
	if !differentPlan ||
		!currentPlanConsistent ||
		!strings.EqualFold(strings.TrimSpace(subscriptionType), "paid") ||
		!strings.EqualFold(strings.TrimSpace(subscriptionStatus), "active") {
		return false
	}

	return strings.TrimSpace(providerSubscriptionID) != ""
}

func blocksProviderPlanChange(
	subscriptionType string,
	subscriptionStatus string,
	currentPlanID string,
	targetPlanID string,
	providerSubscriptionID string,
	currentPlanConsistent bool,
) bool {
	differentPlan := strings.TrimSpace(currentPlanID) != "" &&
		strings.TrimSpace(targetPlanID) != "" &&
		!strings.EqualFold(strings.TrimSpace(currentPlanID), strings.TrimSpace(targetPlanID))

	if strings.TrimSpace(providerSubscriptionID) == "" {
		return false
	}

	// The provider identifier is authoritative even if the local subscription
	// type drifted. The only provider-linked selection that may continue beyond
	// this guard is a managed paid change from a known, active current plan.
	// A same-plan selection has already returned idempotently above. Treat it as
	// blocked here too so a future refactor cannot accidentally open a checkout.
	return !strings.EqualFold(strings.TrimSpace(subscriptionType), "paid") ||
		!strings.EqualFold(strings.TrimSpace(subscriptionStatus), "active") ||
		!currentPlanConsistent ||
		!differentPlan
}

func (repo Repository) getSubscriptionOrgAndPlan(ctx context.Context, organizationID string) (map[string]any, map[string]any, map[string]any, error) {
	var orgRaw, planRaw, pendingPlanRaw []byte
	err := repo.db.Pool().QueryRow(ctx, `
		select
			jsonb_build_object(
				'id', o.id::text,
				'name', o.name,
				'razao_social', coalesce(o.billing_legal_name, o.razao_social),
				'cnpj', coalesce(o.billing_tax_id, o.cnpj),
				'cep', coalesce(o.billing_postal_code, o.cep),
				'endereco', coalesce(o.billing_address, o.endereco),
				'numero', coalesce(o.billing_address_number, o.numero),
				'complemento', coalesce(o.billing_address_complement, o.complemento),
				'bairro', coalesce(o.billing_neighborhood, o.bairro),
				'cidade', coalesce(o.billing_city, o.cidade),
				'uf', coalesce(o.billing_state, o.uf),
				'telefone', coalesce(o.billing_phone, o.telefone),
				'whatsapp', o.whatsapp,
				'email', coalesce(o.billing_email, o.email),
				'plan_id', o.plan_id::text,
				'pending_plan_id', o.pending_plan_id::text,
				'plan_name', current_plan.name,
				'pending_plan_name', pending_plan.name,
				'subscription_status', o.subscription_status,
				'subscription_type', o.subscription_type,
				'subscription_value', o.subscription_value,
				'subscription_billing_period_months', o.subscription_billing_period_months,
				'subscription_renewal_value', round(
					coalesce(o.subscription_value, current_plan.price, 0)::numeric
					* o.subscription_billing_period_months,
					2
				),
				'next_billing_date', o.next_billing_date,
				'trial_ends_at', o.trial_ends_at,
				'billing_grace_until', o.billing_grace_until,
				'billing_last_reconciled_at', o.billing_last_reconciled_at,
				'max_users', o.max_users,
				'max_whatsapp_sessions_override', o.max_whatsapp_sessions_override,
				'has_automatic_billing', nullif(btrim(o.asaas_subscription_id), '') is not null,
				'subscription_reference', coalesce(
					nullif(btrim(o.asaas_subscription_id), ''),
					o.id::text
				),
				'created_at', o.created_at
			),
			coalesce(to_jsonb(current_plan), 'null'::jsonb),
			coalesce(to_jsonb(pending_plan), 'null'::jsonb)
		from public.organizations o
		left join public.admin_subscription_plans current_plan
		  on current_plan.id = o.plan_id
		left join public.admin_subscription_plans pending_plan
		  on pending_plan.id = o.pending_plan_id
		where o.id = $1::uuid
	`, organizationID).Scan(&orgRaw, &planRaw, &pendingPlanRaw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, nil, tenant.ErrOrganizationNotFound
	}
	if err != nil {
		return nil, nil, nil, err
	}

	org, err := decodeJSONObject(orgRaw)
	if err != nil {
		return nil, nil, nil, err
	}
	plan, err := decodeNullableJSONObject(planRaw)
	if err != nil {
		return nil, nil, nil, err
	}
	pendingPlan, err := decodeNullableJSONObject(pendingPlanRaw)
	if err != nil {
		return nil, nil, nil, err
	}
	return org, plan, pendingPlan, nil
}

func (repo Repository) listActiveSubscriptionPlans(ctx context.Context) ([]map[string]any, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		select to_jsonb(p)
		from public.admin_subscription_plans p
		where coalesce(p.is_active, true) = true
		  and coalesce(p.is_public, true) = true
		  and coalesce(p.price, 0) > 0
		  and lower(btrim(p.name)) not in ('trial', 'básico', 'basico')
		order by p.price asc, p.name asc
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []map[string]any{}
	for rows.Next() {
		var raw []byte
		var item map[string]any
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(raw, &item); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

const paymentHistoryProjection = `
	jsonb_build_object(
		'id', p.id::text,
		'asaas_payment_id', p.asaas_payment_id,
		'asaas_subscription_id', p.asaas_subscription_id,
		'billing_intent_id', p.billing_intent_id,
		'plan_id', coalesce(intent.plan_id, capability.plan_id),
		'plan_name', historical_plan.name,
		'billing_type', p.billing_type,
		'status', p.status,
		'value', p.value,
		'due_date', p.due_date,
		'payment_date', p.payment_date,
		'bank_slip_registration_cancelled', (
			p.bank_slip_registration_cancelled_at is not null
			and p.bank_slip_registration_cancelled_due_date is not distinct from p.due_date
		),
		'checkout_url', case
			when capability.checkout_token is not null
			then '/checkout/' || capability.checkout_token
			else null
		end,
		'receipt_path', case
			when receipt.verification_token is not null
			then '/comprovantes/' || receipt.verification_token::text
			else null
		end,
		'sync_state', 'cached',
		'created_at', p.created_at,
		'updated_at', p.updated_at
	)
`

const paymentHistoryFrom = `
	from public.asaas_payments p
	left join public.billing_payment_checkout_capabilities capability
		on capability.payment_id = p.id
		and capability.organization_id = p.organization_id
		and capability.asaas_payment_id = p.asaas_payment_id
		and capability.revoked_at is null
		and capability.expires_at > now()
		and private.billing_payment_checkout_is_resolvable(p.id)
		and upper(btrim(coalesce(p.status, ''))) in (
			'CREATED',
			'PENDING',
			'OVERDUE',
			'DUNNING_REQUESTED',
			'DUNNING_RECEIVED',
			'CREDIT_CARD_CAPTURE_REFUSED'
		)
	left join private.billing_checkout_intents intent
		on intent.id = p.billing_intent_id
		and intent.organization_id = p.organization_id
	left join public.admin_subscription_plans historical_plan
		on historical_plan.id = coalesce(intent.plan_id, capability.plan_id)
	left join public.billing_payment_receipts receipt
		on receipt.payment_id = p.id
		and receipt.organization_id = p.organization_id
`

const paymentHistoryFallbackProjection = `
	jsonb_build_object(
		'id', p.id::text,
		'asaas_payment_id', p.asaas_payment_id,
		'asaas_subscription_id', p.asaas_subscription_id,
		'billing_intent_id', p.billing_intent_id,
		'plan_id', receipt.plan_id,
		'plan_name', receipt.plan_name,
		'billing_type', p.billing_type,
		'status', p.status,
		'value', p.value,
		'due_date', p.due_date,
		'payment_date', p.payment_date,
		'bank_slip_registration_cancelled', false,
		'checkout_url', null,
		'receipt_path', case
			when receipt.verification_token is not null
			then '/comprovantes/' || receipt.verification_token::text
			else null
		end,
		'sync_state', 'cached',
		'created_at', p.created_at,
		'updated_at', p.updated_at
	)
`

const paymentHistoryFallbackFrom = `
	from public.asaas_payments p
	left join public.billing_payment_receipts receipt
		on receipt.payment_id = p.id
		and receipt.organization_id = p.organization_id
`

func (repo Repository) listPaymentHistory(ctx context.Context, organizationID string) ([]PaymentHistoryItem, bool, error) {
	rows, err := repo.db.Pool().Query(ctx, fmt.Sprintf(`
		select %s
		%s
		where p.organization_id = $1::uuid
		order by p.due_date desc nulls last, p.created_at desc
	`, paymentHistoryProjection, paymentHistoryFrom), organizationID)
	if err == nil {
		items, scanErr := scanPaymentHistoryRows(rows)
		if scanErr == nil {
			return items, true, nil
		}
		err = scanErr
	}
	if !isPaymentHistoryCheckoutSchemaDrift(err) {
		return nil, false, err
	}

	rows, err = repo.db.Pool().Query(ctx, fmt.Sprintf(`
		select %s
		%s
		where p.organization_id = $1::uuid
		order by p.due_date desc nulls last, p.created_at desc
	`, paymentHistoryFallbackProjection, paymentHistoryFallbackFrom), organizationID)
	if err != nil {
		return nil, false, err
	}
	items, scanErr := scanPaymentHistoryRows(rows)
	return items, false, scanErr
}

func scanPaymentHistoryRows(rows pgx.Rows) ([]PaymentHistoryItem, error) {
	defer rows.Close()
	items := []PaymentHistoryItem{}
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		var item PaymentHistoryItem
		if err := json.Unmarshal(raw, &item); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (repo Repository) getPaymentHistoryItem(
	ctx context.Context,
	organizationID string,
	paymentID string,
) (PaymentHistoryItem, error) {
	var raw []byte
	err := repo.db.Pool().QueryRow(ctx, fmt.Sprintf(`
		select %s
		%s
		where p.organization_id = $1::uuid
		  and p.id = $2::uuid
		limit 1
	`, paymentHistoryProjection, paymentHistoryFrom), organizationID, paymentID).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return PaymentHistoryItem{}, ErrPaymentNotFound
	}
	if err != nil {
		return PaymentHistoryItem{}, err
	}

	var item PaymentHistoryItem
	if err := json.Unmarshal(raw, &item); err != nil {
		return PaymentHistoryItem{}, err
	}
	return item, nil
}

func (repo Repository) getLocalPaymentIdentity(
	ctx context.Context,
	organizationID string,
	paymentID string,
) (localPaymentIdentity, error) {
	var item localPaymentIdentity
	err := repo.db.Pool().QueryRow(ctx, `
		select
			p.id::text,
			p.asaas_payment_id,
			coalesce(p.asaas_customer_id, ''),
			coalesce(p.asaas_subscription_id, ''),
			upper(coalesce(p.billing_type, '')),
			coalesce(p.value, 0)::double precision,
			coalesce(p.due_date::text, '')
		from public.asaas_payments p
		where p.organization_id = $1::uuid
		  and p.id = $2::uuid
		limit 1
	`, organizationID, paymentID).Scan(
		&item.ID,
		&item.AsaasPaymentID,
		&item.AsaasCustomerID,
		&item.AsaasSubscriptionID,
		&item.BillingType,
		&item.Value,
		&item.DueDate,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return localPaymentIdentity{}, ErrPaymentNotFound
	}
	if err != nil {
		return localPaymentIdentity{}, err
	}
	return item, nil
}

func (repo Repository) getActiveBillingPlanChange(ctx context.Context, organizationID string) (map[string]any, error) {
	var raw []byte
	err := repo.db.Pool().QueryRow(ctx, `
		select jsonb_build_object(
			'id', change.id::text,
			'from_plan_id', change.from_plan_id::text,
			'target_plan_id', change.target_plan_id::text,
			'status', change.status,
			'billing_period_months', change.billing_period_months,
			'amount', change.amount,
			'effective_on', change.effective_on,
			'requested_at', change.created_at,
			'provider_updated_at', change.provider_updated_at
		)
		from private.billing_plan_changes change
		where change.organization_id = $1::uuid
		  and change.status in ('provider_updating', 'scheduled')
		order by change.created_at desc, change.id desc
		limit 1
	`, organizationID).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) || isUndefinedTableError(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return decodeJSONObject(raw)
}

func decodeJSONObject(raw []byte) (map[string]any, error) {
	var item map[string]any
	if err := json.Unmarshal(raw, &item); err != nil {
		return nil, err
	}
	return item, nil
}

func decodeNullableJSONObject(raw []byte) (map[string]any, error) {
	if strings.TrimSpace(string(raw)) == "null" || len(raw) == 0 {
		return nil, nil
	}
	return decodeJSONObject(raw)
}

func scanAPIKey(row apiKeyScanner) (APIKey, error) {
	var item APIKey
	var lastUsedAt, createdBy pgtype.Text

	err := row.Scan(
		&item.ID,
		&item.OrganizationID,
		&item.Name,
		&item.KeyPrefix,
		&item.IsActive,
		&lastUsedAt,
		&createdBy,
		&item.CreatedAt,
		&item.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return APIKey{}, ErrAPIKeyNotFound
		}
		return APIKey{}, err
	}

	item.LastUsedAt = textPointer(lastUsedAt)
	item.CreatedBy = textPointer(createdBy)
	return item, nil
}

func scanOrganizationModule(row organizationModuleScanner) (OrganizationModule, error) {
	var item OrganizationModule
	err := row.Scan(
		&item.ID,
		&item.OrganizationID,
		&item.ModuleName,
		&item.IsEnabled,
		&item.CreatedAt,
		&item.UpdatedAt,
	)
	return item, err
}

func generateRawAPIKey() (string, error) {
	var bytes [32]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}

	return "vimob_" + hex.EncodeToString(bytes[:]), nil
}

func normalizeUUID(value string) (string, bool) {
	var uuid pgtype.UUID
	if err := uuid.Scan(strings.TrimSpace(value)); err != nil {
		return "", false
	}
	if !uuid.Valid {
		return "", false
	}

	return uuid.String(), true
}

func textPointer(value pgtype.Text) *string {
	if !value.Valid || strings.TrimSpace(value.String) == "" {
		return nil
	}

	return &value.String
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

func isPaymentHistoryCheckoutSchemaDrift(err error) bool {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return false
	}

	message := strings.ToLower(strings.TrimSpace(pgErr.Message))
	tableName := strings.ToLower(strings.TrimSpace(pgErr.TableName))
	columnName := strings.ToLower(strings.TrimSpace(pgErr.ColumnName))

	switch pgErr.Code {
	case "42P01":
		return tableName == "billing_payment_checkout_capabilities" ||
			strings.Contains(message, `relation "billing_payment_checkout_capabilities" does not exist`) ||
			strings.Contains(message, `relation "public.billing_payment_checkout_capabilities" does not exist`)
	case "42703":
		return columnName == "bank_slip_registration_cancelled_at" ||
			columnName == "bank_slip_registration_cancelled_due_date" ||
			strings.Contains(message, "column p.bank_slip_registration_cancelled_at does not exist") ||
			strings.Contains(message, "column p.bank_slip_registration_cancelled_due_date does not exist")
	case "42883":
		return strings.Contains(
			message,
			"function private.billing_payment_checkout_is_resolvable(uuid) does not exist",
		)
	default:
		return false
	}
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
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

func cleanThemeMode(value *string) *string {
	if value == nil {
		return nil
	}
	switch strings.ToLower(strings.TrimSpace(*value)) {
	case "light":
		out := "light"
		return &out
	case "dark":
		out := "dark"
		return &out
	case "system":
		out := "system"
		return &out
	default:
		out := "system"
		return &out
	}
}

func cleanLanguage(value *string) *string {
	if value == nil {
		return nil
	}
	switch strings.TrimSpace(*value) {
	case "pt-BR":
		out := "pt-BR"
		return &out
	case "en":
		out := "en"
		return &out
	default:
		return nil
	}
}

func canManageSetting(tenantContext tenant.Context, permission string) bool {
	return tenantContext.IsSuperAdmin ||
		tenantContext.HasRole("owner", "admin") ||
		tenantContext.HasPermission(permission)
}
