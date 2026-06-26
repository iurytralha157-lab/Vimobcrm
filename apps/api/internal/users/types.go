package users

import "errors"

const maxSummaryIDs = 100

var (
	ErrInvalidInput           = errors.New("invalid user input")
	ErrUserNotFound           = errors.New("user not found")
	ErrUserConflict           = errors.New("user conflict")
	ErrAuthAdminNotConfigured = errors.New("auth admin is not configured")
	ErrAuthAdminOperation     = errors.New("auth admin operation failed")
)

type Summary struct {
	ID        string  `json:"id"`
	Name      *string `json:"name"`
	AvatarURL *string `json:"avatar_url"`
}

type Envelope[T any] struct {
	Data T `json:"data"`
}

type User struct {
	ID             string  `json:"id"`
	OrganizationID *string `json:"organization_id"`
	Name           string  `json:"name"`
	Email          string  `json:"email"`
	Role           string  `json:"role"`
	AvatarURL      *string `json:"avatar_url"`
	IsActive       bool    `json:"is_active"`
	Whatsapp       *string `json:"whatsapp"`
	CreatedAt      string  `json:"created_at"`
	UpdatedAt      string  `json:"updated_at"`
}

type UserOrganization struct {
	OrganizationID   string  `json:"organization_id"`
	OrganizationName string  `json:"organization_name"`
	OrganizationLogo *string `json:"organization_logo"`
	MemberRole       string  `json:"member_role"`
	IsActive         bool    `json:"is_active"`
	JoinedAt         string  `json:"joined_at"`
	LastAccessedAt   *string `json:"last_accessed_at"`
}

type CreateUserRequest struct {
	Name     string  `json:"name"`
	Email    string  `json:"email"`
	Phone    *string `json:"phone"`
	Whatsapp *string `json:"whatsapp"`
	Endereco *string `json:"endereco"`
	Role     string  `json:"role"`
}

type CreateUserInput struct {
	Name     string
	Email    string
	Phone    *string
	Whatsapp *string
	Endereco *string
	Role     string
}

type CreateUserResult struct {
	Success           bool    `json:"success"`
	User              User    `json:"user"`
	GeneratedPassword *string `json:"generatedPassword,omitempty"`
	WhatsappSent      bool    `json:"whatsappSent"`
	WasMultiOrg       bool    `json:"wasMultiOrg"`
	WasOrphan         bool    `json:"wasOrphan"`
	Message           string  `json:"message,omitempty"`
}

type UpdateUserRequest struct {
	Updates UpdateUserPayload `json:"updates"`
}

type UpdateUserPayload struct {
	Name     *string `json:"name"`
	Role     *string `json:"role"`
	IsActive *bool   `json:"is_active"`
	AvatarURL *string `json:"avatar_url"`
	Whatsapp *string `json:"whatsapp"`
}

type UpdateUserInput struct {
	Name     *string
	Role     *string
	IsActive *bool
	AvatarURL *string
	Whatsapp *string
}

type MutateUserResult struct {
	Success bool `json:"success"`
	User    User `json:"user"`
}

type DeleteUserResult struct {
	Success bool `json:"success"`
}
