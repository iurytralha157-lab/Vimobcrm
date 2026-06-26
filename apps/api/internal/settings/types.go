package settings

import "errors"

var (
	ErrInvalidInput         = errors.New("invalid settings input")
	ErrAPIKeyNotFound       = errors.New("api key not found")
	ErrStorageNotConfigured = errors.New("settings storage is not configured")
	ErrStorageOperation     = errors.New("settings storage operation failed")
	ErrAuthNotConfigured    = errors.New("settings auth admin is not configured")
	ErrAuthOperation        = errors.New("settings auth admin operation failed")
)

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
	Name                        *string  `json:"name"`
	CNPJ                        *string  `json:"cnpj"`
	Creci                       *string  `json:"creci"`
	InscricaoEstadual           *string  `json:"inscricao_estadual"`
	RazaoSocial                 *string  `json:"razao_social"`
	NomeFantasia                *string  `json:"nome_fantasia"`
	CEP                         *string  `json:"cep"`
	Endereco                    *string  `json:"endereco"`
	Numero                      *string  `json:"numero"`
	Complemento                 *string  `json:"complemento"`
	Bairro                      *string  `json:"bairro"`
	Cidade                      *string  `json:"cidade"`
	UF                          *string  `json:"uf"`
	Telefone                    *string  `json:"telefone"`
	Whatsapp                    *string  `json:"whatsapp"`
	Email                       *string  `json:"email"`
	Website                     *string  `json:"website"`
	DefaultCommissionPercentage *float64 `json:"default_commission_percentage"`
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
	Allowed bool   `json:"allowed"`
	Message string `json:"message"`
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
	Endpoint  string  `json:"endpoint"`
	P256DH    *string `json:"p256dh"`
	Auth      *string `json:"auth"`
	UserAgent *string `json:"userAgent"`
}

type DeactivatePushTokenRequest struct {
	Endpoint *string `json:"endpoint"`
}
