package settings

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

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

func normalizePropertySettingsRequest(request UpdatePropertySettingsRequest) (*string, *string, time.Time, error) {
	expectedUpdatedAt, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(request.ExpectedUpdatedAt))
	if err != nil {
		return nil, nil, time.Time{}, ErrInvalidInput
	}

	if request.PropertyEditPolicy.Set && request.PropertyEditPolicy.Value == nil {
		return nil, nil, time.Time{}, ErrInvalidInput
	}
	propertyEditPolicy := cleanStringPointer(request.PropertyEditPolicy.Value)
	if request.PropertyEditPolicy.Set && propertyEditPolicy == nil {
		return nil, nil, time.Time{}, ErrInvalidInput
	}
	if propertyEditPolicy != nil && *propertyEditPolicy != "everyone" && *propertyEditPolicy != "responsible_or_admin" {
		return nil, nil, time.Time{}, ErrInvalidInput
	}

	if request.PropertyOwnerContactVisibility.Set && request.PropertyOwnerContactVisibility.Value == nil {
		return nil, nil, time.Time{}, ErrInvalidInput
	}
	propertyOwnerContactVisibility := cleanStringPointer(request.PropertyOwnerContactVisibility.Value)
	if request.PropertyOwnerContactVisibility.Set && propertyOwnerContactVisibility == nil {
		return nil, nil, time.Time{}, ErrInvalidInput
	}
	if propertyOwnerContactVisibility != nil && *propertyOwnerContactVisibility != "visible" && *propertyOwnerContactVisibility != "hidden" {
		return nil, nil, time.Time{}, ErrInvalidInput
	}
	if propertyEditPolicy == nil && propertyOwnerContactVisibility == nil {
		return nil, nil, time.Time{}, ErrInvalidInput
	}

	return propertyEditPolicy, propertyOwnerContactVisibility, expectedUpdatedAt, nil
}

func (repo Repository) UpdatePropertySettings(ctx context.Context, tenantContext tenant.Context, request UpdatePropertySettingsRequest) (PropertySettingsUpdateResult, error) {
	if !canManageSetting(tenantContext, permissions.SettingsOrganization) {
		return PropertySettingsUpdateResult{}, tenant.ErrOrganizationAccessDenied
	}

	propertyEditPolicy, propertyOwnerContactVisibility, expectedUpdatedAt, err := normalizePropertySettingsRequest(request)
	if err != nil {
		return PropertySettingsUpdateResult{}, err
	}

	var updatedAt time.Time
	err = repo.db.Pool().QueryRow(ctx, `
		update public.organizations
		set
			property_edit_policy = coalesce($2, property_edit_policy),
			property_owner_contact_visibility = coalesce($3, property_owner_contact_visibility),
			updated_at = clock_timestamp()
		where id = $1::uuid
		  and updated_at = $4::timestamptz
		returning updated_at
	`, tenantContext.OrganizationID, propertyEditPolicy, propertyOwnerContactVisibility, expectedUpdatedAt).Scan(&updatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return PropertySettingsUpdateResult{}, ErrPropertySettingsConflict
	}
	if err != nil {
		return PropertySettingsUpdateResult{}, err
	}

	return PropertySettingsUpdateResult{
		OK:        true,
		UpdatedAt: updatedAt.UTC().Format(time.RFC3339Nano),
	}, nil
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
