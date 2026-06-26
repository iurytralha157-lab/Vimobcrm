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
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type Repository struct {
	db        *dbpkg.Postgres
	storage   storageClient
	authAdmin authAdminClient
}

type apiKeyScanner interface {
	Scan(dest ...any) error
}

type organizationModuleScanner interface {
	Scan(dest ...any) error
}

func NewRepository(db *dbpkg.Postgres, externalConfig ExternalConfig) Repository {
	return Repository{
		db:        db,
		storage:   newStorageClient(externalConfig),
		authAdmin: newAuthAdminClient(externalConfig),
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
		order by updated_at desc nulls last, created_at desc nulls last
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
	if !canManageSettings(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}

	name := cleanStringPointer(request.Name)
	if name == nil {
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
	if !canManageSettings(tenantContext) {
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
	password := strings.TrimSpace(request.Password)
	if len(password) < 8 {
		return ChangePasswordResult{}, ErrInvalidInput
	}

	if err := repo.authAdmin.updatePassword(ctx, tenantContext.UserID, password); err != nil {
		return ChangePasswordResult{}, err
	}

	source := strings.TrimSpace(request.Source)
	if source == "" {
		source = "settings"
	}
	_, err := repo.db.Pool().Exec(ctx, `
		insert into public.password_change_events (user_id, source, metadata)
		values ($1::uuid, $2, '{}'::jsonb)
	`, tenantContext.UserID, source)
	if err != nil {
		return ChangePasswordResult{}, err
	}

	return ChangePasswordResult{Allowed: true, Message: "Senha alterada com sucesso!"}, nil
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
	if !canManageSettings(tenantContext) {
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

func (repo Repository) SavePushToken(ctx context.Context, tenantContext tenant.Context, request PushTokenRequest) error {
	if tenantContext.UserID == "" || tenantContext.OrganizationID == "" {
		return ErrInvalidInput
	}
	endpoint := strings.TrimSpace(request.Endpoint)
	if endpoint == "" {
		return ErrInvalidInput
	}

	_, err := repo.db.Pool().Exec(ctx, `
		insert into public.push_tokens (
			organization_id,
			user_id,
			endpoint,
			p256dh,
			auth,
			user_agent,
			is_active
		)
		values ($1::uuid, $2::uuid, $3, $4, $5, $6, true)
		on conflict (user_id, endpoint)
		do update set
			organization_id = excluded.organization_id,
			p256dh = excluded.p256dh,
			auth = excluded.auth,
			user_agent = excluded.user_agent,
			is_active = true,
			updated_at = now()
	`, tenantContext.OrganizationID, tenantContext.UserID, endpoint, cleanStringPointer(request.P256DH), cleanStringPointer(request.Auth), cleanStringPointer(request.UserAgent))
	if isUndefinedTableError(err) {
		return nil
	}
	return err
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
	return err
}

func (repo Repository) CreateAPIKey(ctx context.Context, tenantContext tenant.Context, input CreateAPIKeyInput) (CreateAPIKeyResult, error) {
	if !canManageSettings(tenantContext) {
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
	if !canManageSettings(tenantContext) {
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
	org, plan, err := repo.getSubscriptionOrgAndPlan(ctx, tenantContext.OrganizationID)
	if err != nil {
		return SubscriptionOverview{}, err
	}
	plans, err := repo.listActiveSubscriptionPlans(ctx)
	if err != nil {
		return SubscriptionOverview{}, err
	}
	history, err := repo.listPaymentHistory(ctx, tenantContext.OrganizationID)
	if err != nil {
		return SubscriptionOverview{}, err
	}

	return SubscriptionOverview{
		Org:            org,
		Plan:           plan,
		AvailablePlans: plans,
		History:        history,
	}, nil
}

func (repo Repository) UpdateSubscriptionBilling(ctx context.Context, tenantContext tenant.Context, request UpdateBillingRequest) (SubscriptionOverview, error) {
	if !canManageSettings(tenantContext) {
		return SubscriptionOverview{}, tenant.ErrOrganizationAccessDenied
	}

	_, err := repo.db.Pool().Exec(ctx, `
		update public.organizations
		set
			razao_social = $2,
			cnpj = $3,
			cep = $4,
			endereco = $5,
			numero = $6,
			complemento = $7,
			bairro = $8,
			cidade = $9,
			uf = $10,
			email = $11,
			telefone = $12,
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
	if !canManageSettings(tenantContext) {
		return SubscriptionOverview{}, tenant.ErrOrganizationAccessDenied
	}

	planID, ok := normalizeUUID(planID)
	if !ok {
		return SubscriptionOverview{}, ErrInvalidInput
	}

	tag, err := repo.db.Pool().Exec(ctx, `
		update public.organizations o
		set
			plan_id = p.id,
			subscription_value = p.price,
			subscription_type = 'paid',
			max_users = coalesce(p.max_users, o.max_users),
			max_whatsapp_sessions_override = coalesce(p.max_whatsapp_sessions, o.max_whatsapp_sessions_override),
			subscription_status = coalesce(nullif(o.subscription_status, ''), 'pending_payment'),
			updated_at = now()
		from public.admin_subscription_plans p
		where o.id = $1::uuid
		  and p.id = $2::uuid
		  and coalesce(p.is_active, true) = true
	`, tenantContext.OrganizationID, planID)
	if err != nil {
		return SubscriptionOverview{}, err
	}
	if tag.RowsAffected() == 0 {
		return SubscriptionOverview{}, ErrInvalidInput
	}

	return repo.GetSubscriptionOverview(ctx, tenantContext)
}

func (repo Repository) getSubscriptionOrgAndPlan(ctx context.Context, organizationID string) (map[string]any, map[string]any, error) {
	var orgRaw, planRaw []byte
	err := repo.db.Pool().QueryRow(ctx, `
		select
			to_jsonb(o) || jsonb_build_object('plan_name', p.name),
			coalesce(to_jsonb(p), 'null'::jsonb)
		from public.organizations o
		left join public.admin_subscription_plans p on p.id = o.plan_id
		where o.id = $1::uuid
	`, organizationID).Scan(&orgRaw, &planRaw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, tenant.ErrOrganizationNotFound
	}
	if err != nil {
		return nil, nil, err
	}

	org, err := decodeJSONObject(orgRaw)
	if err != nil {
		return nil, nil, err
	}
	plan, err := decodeNullableJSONObject(planRaw)
	if err != nil {
		return nil, nil, err
	}
	return org, plan, nil
}

func (repo Repository) listActiveSubscriptionPlans(ctx context.Context) ([]map[string]any, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		select to_jsonb(p)
		from public.admin_subscription_plans p
		where coalesce(p.is_active, true) = true
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

func (repo Repository) listPaymentHistory(ctx context.Context, organizationID string) ([]map[string]any, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		select to_jsonb(p)
		from public.asaas_payments p
		where p.organization_id = $1::uuid
		order by p.due_date desc nulls last, p.created_at desc
	`, organizationID)
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
		"logo_url_light":             true,
		"logo_url_dark":              true,
		"favicon_url_light":          true,
		"favicon_url_dark":           true,
		"pwa_icon_url":               true,
		"login_bg_url":               true,
		"default_whatsapp":           true,
		"contact_whatsapp":           true,
		"logo_width":                 true,
		"logo_height":                true,
		"maintenance_mode":           true,
		"maintenance_message":        true,
		"feature_flags":              true,
		"notification_instance_name": true,
		"logo_principal":             true,
		"logo_secundaria":            true,
		"favicon":                    true,
		"imagens_padrao":             true,
		"comunicados":                true,
		"maintenance":                true,
		"force_update":               true,
	}

	sanitized := map[string]any{}
	for key, item := range value {
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

func canManageSettings(tenantContext tenant.Context) bool {
	return tenantContext.IsSuperAdmin ||
		tenantContext.HasRole("owner", "admin", "manager") ||
		tenantContext.HasPermission("settings_manage")
}
