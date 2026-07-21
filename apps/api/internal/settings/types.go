package settings

import (
	"errors"
	"time"
)

var (
	ErrInvalidInput         = errors.New("invalid settings input")
	ErrPushVAPIDMismatch    = errors.New("push VAPID key mismatch")
	ErrAPIKeyNotFound       = errors.New("api key not found")
	ErrStorageNotConfigured = errors.New("settings storage is not configured")
	ErrStorageOperation     = errors.New("settings storage operation failed")
	ErrAuthNotConfigured    = errors.New("settings auth admin is not configured")
	ErrAuthOperation        = errors.New("settings auth admin operation failed")
	ErrEmailOperation       = errors.New("settings email notification failed")
	ErrPermissionStorage    = errors.New("user permission storage is not available")
)

type UserPermissionItem struct {
	Key            string `json:"key"`
	Label          string `json:"label"`
	Description    string `json:"description"`
	Domain         string `json:"domain"`
	Allowed        bool   `json:"allowed"`
	DefaultAllowed bool   `json:"defaultAllowed"`
	Override       *bool  `json:"override"`
}

type UserPermissionProfile struct {
	UserID      string               `json:"userId"`
	Profile     string               `json:"profile"`
	Locked      bool                 `json:"locked"`
	Permissions []UserPermissionItem `json:"permissions"`
}

type ReplaceUserPermissionsRequest struct {
	Permissions map[string]bool `json:"permissions"`
}

type Envelope[T any] struct {
	Data T `json:"data"`
}

type APIKey struct {
	ID             string  `json:"id"`
	OrganizationID string  `json:"organization_id"`
	Name           string  `json:"name"`
	KeyPrefix      string  `json:"key_prefix"`
	IsActive       bool    `json:"is_active"`
	LastUsedAt     *string `json:"last_used_at"`
	CreatedBy      *string `json:"created_by"`
	CreatedAt      string  `json:"created_at"`
	UpdatedAt      string  `json:"updated_at"`
}

type OrganizationModule struct {
	ID             string `json:"id"`
	OrganizationID string `json:"organization_id"`
	ModuleName     string `json:"module_name"`
	IsEnabled      bool   `json:"is_enabled"`
	CreatedAt      string `json:"created_at"`
	UpdatedAt      string `json:"updated_at"`
}

type SetupGuideProgress struct {
	CompletedSteps map[string]bool `json:"completed_steps"`
	Skipped        bool            `json:"skipped"`
}

type UpdateSetupGuideProgressRequest struct {
	CompletedSteps map[string]bool `json:"completed_steps"`
	Skipped        *bool           `json:"skipped"`
}

type CreateAPIKeyRequest struct {
	Name string `json:"name"`
}

type CreateAPIKeyInput struct {
	Name string
}

type CreateAPIKeyResult struct {
	APIKey string `json:"apiKey"`
	Key    APIKey `json:"key"`
}

type UpdateProfileRequest struct {
	Name      *string `json:"name"`
	Whatsapp  *string `json:"whatsapp"`
	CPF       *string `json:"cpf"`
	ThemeMode *string `json:"theme_mode"`
	Language  *string `json:"language"`
}

type UpdateOrganizationRequest struct {
	Name                           *string  `json:"name"`
	CNPJ                           *string  `json:"cnpj"`
	Creci                          *string  `json:"creci"`
	InscricaoEstadual              *string  `json:"inscricao_estadual"`
	RazaoSocial                    *string  `json:"razao_social"`
	NomeFantasia                   *string  `json:"nome_fantasia"`
	CEP                            *string  `json:"cep"`
	Endereco                       *string  `json:"endereco"`
	Numero                         *string  `json:"numero"`
	Complemento                    *string  `json:"complemento"`
	Bairro                         *string  `json:"bairro"`
	Cidade                         *string  `json:"cidade"`
	UF                             *string  `json:"uf"`
	Telefone                       *string  `json:"telefone"`
	Whatsapp                       *string  `json:"whatsapp"`
	Email                          *string  `json:"email"`
	Website                        *string  `json:"website"`
	DefaultCommissionPercentage    *float64 `json:"default_commission_percentage"`
	PropertyEditPolicy             *string  `json:"property_edit_policy"`
	PropertyOwnerContactVisibility *string  `json:"property_owner_contact_visibility"`
}

type AssetUpload struct {
	URL         string `json:"url"`
	Path        string `json:"path"`
	Bucket      string `json:"bucket"`
	ContentType string `json:"contentType"`
	Size        int64  `json:"size"`
}

type ChangePasswordRequest struct {
	Password string `json:"password"`
	Source   string `json:"source"`
}

type ChangePasswordResult struct {
	Allowed               bool   `json:"allowed"`
	Message               string `json:"message"`
	EmailNotificationSent bool   `json:"emailNotificationSent"`
}

type PasswordChangeEvent struct {
	ChangedAt string `json:"changed_at"`
	Source    string `json:"source"`
}

type PasswordChangeLockout struct {
	LockedUntil    *string `json:"locked_until"`
	LockLevel      int     `json:"lock_level"`
	LastLockReason *string `json:"last_lock_reason"`
}

type PasswordStatus struct {
	LastChange *PasswordChangeEvent   `json:"lastChange"`
	Lockout    *PasswordChangeLockout `json:"lockout"`
}

type SubscriptionOverview struct {
	Org            map[string]any   `json:"org"`
	Plan           map[string]any   `json:"plan"`
	AvailablePlans []map[string]any `json:"availablePlans"`
	History        []map[string]any `json:"history"`
}

type UpdateBillingRequest struct {
	RazaoSocial *string `json:"razao_social"`
	CNPJ        *string `json:"cnpj"`
	CEP         *string `json:"cep"`
	Endereco    *string `json:"endereco"`
	Numero      *string `json:"numero"`
	Complemento *string `json:"complemento"`
	Bairro      *string `json:"bairro"`
	Cidade      *string `json:"cidade"`
	UF          *string `json:"uf"`
	Email       *string `json:"email"`
	Telefone    *string `json:"telefone"`
}

type SelectSubscriptionPlanRequest struct {
	PlanID string `json:"plan_id"`
}

type PushTokenRequest struct {
	Endpoint       string  `json:"endpoint"`
	P256DH         *string `json:"p256dh"`
	Auth           *string `json:"auth"`
	UserAgent      *string `json:"userAgent"`
	VAPIDPublicKey *string `json:"vapidPublicKey"`
	SyncOnly       *bool   `json:"syncOnly"`
}

type PublicPushConfig struct {
	Enabled     bool   `json:"enabled"`
	PublicKey   string `json:"publicKey"`
	Fingerprint string `json:"fingerprint"`
}

type PushTokenResult struct {
	OK                  bool `json:"ok"`
	Active              bool `json:"active"`
	RequiresResubscribe bool `json:"requiresResubscribe"`
}

type PushDevice struct {
	ID                string     `json:"id"`
	Platform          string     `json:"platform"`
	Label             string     `json:"label"`
	Active            bool       `json:"active"`
	LastSuccessAt     *time.Time `json:"lastSuccessAt,omitempty"`
	LastFailureAt     *time.Time `json:"lastFailureAt,omitempty"`
	LastFailureReason *string    `json:"lastFailureReason,omitempty"`
	FailureCount      int        `json:"failureCount"`
	UpdatedAt         time.Time  `json:"updatedAt"`
}

type DeactivatePushTokenRequest struct {
	Endpoint *string `json:"endpoint"`
}
