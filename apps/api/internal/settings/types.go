package settings

import (
	"errors"
	"time"
)

var (
	ErrInvalidInput             = errors.New("invalid settings input")
	ErrPushVAPIDMismatch        = errors.New("push VAPID key mismatch")
	ErrAPIKeyNotFound           = errors.New("api key not found")
	ErrStorageNotConfigured     = errors.New("settings storage is not configured")
	ErrStorageOperation         = errors.New("settings storage operation failed")
	ErrAuthNotConfigured        = errors.New("settings auth admin is not configured")
	ErrAuthOperation            = errors.New("settings auth admin operation failed")
	ErrEmailOperation           = errors.New("settings email notification failed")
	ErrPermissionStorage        = errors.New("user permission storage is not available")
	ErrCheckoutInProgress       = errors.New("a billing checkout is already in progress")
	ErrPlanChangeInProgress     = errors.New("another managed billing plan change is already in progress")
	ErrPlanChangeRequiresActive = errors.New("the current provider subscription must be active before changing plans")
	ErrAsaasNotConfigured       = errors.New("Asaas subscription management is not configured")
	ErrAsaasOperation           = errors.New("Asaas subscription update failed")
	ErrAsaasAmbiguous           = errors.New("Asaas subscription update outcome is ambiguous")
	ErrPaymentNotFound          = errors.New("billing payment was not found")
	ErrPaymentProviderMismatch  = errors.New("billing payment provider identity mismatch")
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
	Org                  map[string]any       `json:"org"`
	Plan                 map[string]any       `json:"plan"`
	PendingPlan          map[string]any       `json:"pendingPlan"`
	PlanChange           map[string]any       `json:"planChange"`
	AvailablePlans       []map[string]any     `json:"availablePlans"`
	History              []PaymentHistoryItem `json:"history"`
	BillingCheckoutReady bool                 `json:"billingCheckoutReady"`
}

const (
	PaymentSyncStateCached              = "cached"
	PaymentSyncStateCurrent             = "current"
	PaymentSyncStateProviderUnavailable = "provider_unavailable"
)

// PaymentHistoryItem is the client-safe billing history projection. Provider
// settlement fees and hosted invoice URLs intentionally never cross the BFF.
type PaymentHistoryItem struct {
	ID                            string   `json:"id"`
	AsaasPaymentID                string   `json:"asaas_payment_id"`
	AsaasSubscriptionID           *string  `json:"asaas_subscription_id"`
	BillingIntentID               *string  `json:"billing_intent_id"`
	PlanID                        *string  `json:"plan_id"`
	PlanName                      *string  `json:"plan_name"`
	BillingType                   *string  `json:"billing_type"`
	Status                        string   `json:"status"`
	Value                         *float64 `json:"value"`
	DueDate                       *string  `json:"due_date"`
	PaymentDate                   *string  `json:"payment_date"`
	BankSlipRegistrationCancelled bool     `json:"bank_slip_registration_cancelled"`
	CheckoutURL                   *string  `json:"checkout_url"`
	ReceiptPath                   *string  `json:"receipt_path"`
	SyncState                     string   `json:"sync_state"`
	CreatedAt                     string   `json:"created_at"`
	UpdatedAt                     string   `json:"updated_at"`
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
