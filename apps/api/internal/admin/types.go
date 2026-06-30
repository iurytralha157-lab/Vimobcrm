package admin

import "errors"

var (
	ErrInvalidInput = errors.New("invalid admin input")
	ErrNotFound     = errors.New("admin resource not found")
)

type Envelope[T any] struct {
	Data T `json:"data"`
}

type OrganizationUpdateRequest struct {
	Name                        *string  `json:"name"`
	IsActive                    *bool    `json:"is_active"`
	SubscriptionStatus          *string  `json:"subscription_status"`
	MaxUsers                    *int     `json:"max_users"`
	AdminNotes                  *string  `json:"admin_notes"`
	PlanID                      *string  `json:"plan_id"`
	SubscriptionValue           *float64 `json:"subscription_value"`
	BillingDay                  *int     `json:"billing_day"`
	NextBillingDate             *string  `json:"next_billing_date"`
	TrialEndsAt                 *string  `json:"trial_ends_at"`
	Creci                       *string  `json:"creci"`
	MaxWhatsappSessionsOverride *int     `json:"max_whatsapp_sessions_override"`
}

type OrganizationAccessRequest struct {
	OrganizationUpdates OrganizationUpdateRequest `json:"organizationUpdates"`
	Modules             []string                  `json:"modules"`
}

type ModuleAccessRequest struct {
	OrganizationID string `json:"organizationId"`
	ModuleName     string `json:"moduleName"`
	IsEnabled      bool   `json:"isEnabled"`
}

type UserUpdateRequest struct {
	IsActive       *bool   `json:"is_active"`
	OrganizationID *string `json:"organization_id"`
}

type InvitationRequest struct {
	Email          *string `json:"email"`
	Role           string  `json:"role"`
	OrganizationID *string `json:"organizationId"`
	ExpiresAt      *string `json:"expires_at"`
}

type AcceptInvitationRequest struct {
	Name            string  `json:"name"`
	Password        string  `json:"password"`
	Whatsapp        *string `json:"whatsapp"`
	TermsAccepted   bool    `json:"termsAccepted"`
	PrivacyAccepted bool    `json:"privacyAccepted"`
}

type AcceptInvitationResult struct {
	Success          bool   `json:"success"`
	RequiresLogin    bool   `json:"requiresLogin"`
	Email            string `json:"email"`
	OrganizationID   string `json:"organizationId"`
	OrganizationName string `json:"organizationName"`
	Message          string `json:"message,omitempty"`
}

type OnboardingSignupRequest struct {
	CompanyName      string `json:"companyName"`
	DocumentNumber   string `json:"documentNumber"`
	BrokersCount     int    `json:"brokersCount"`
	AdminName        string `json:"adminName"`
	PhoneCountryCode string `json:"phoneCountryCode"`
	Phone            string `json:"phone"`
	Email            string `json:"email"`
	Password         string `json:"password"`
	SignupPath       string `json:"signupPath"`
	PlanSlug         string `json:"planSlug"`
	TermsAccepted    bool   `json:"termsAccepted"`
	PrivacyAccepted  bool   `json:"privacyAccepted"`
	TermsVersion     string `json:"termsVersion"`
	PrivacyVersion   string `json:"privacyVersion"`
	IPAddress        string `json:"ipAddress"`
	UserAgent        string `json:"userAgent"`
}

type CheckoutPlanRequest struct {
	CheckoutToken string `json:"checkoutToken"`
	PlanSlug      string `json:"planSlug"`
}

type CreateOrganizationRequest struct {
	Name          string  `json:"name"`
	Segment       *string `json:"segment"`
	AdminEmail    string  `json:"adminEmail"`
	AdminName     string  `json:"adminName"`
	AdminPassword string  `json:"adminPassword"`
	Whatsapp      *string `json:"whatsapp"`
	Phone         *string `json:"phone"`
	CNPJ          *string `json:"cnpj"`
	Creci         *string `json:"creci"`
	PlanID        *string `json:"planId"`
	Address       *string `json:"address"`
	City          *string `json:"city"`
	Neighborhood  *string `json:"neighborhood"`
	Number        *string `json:"number"`
	Complement    *string `json:"complement"`
	CPF           *string `json:"cpf"`
}
