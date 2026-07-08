package tenant

import (
	"context"
	"strings"
)

type contextKey string

const contextKeyTenant contextKey = "tenant_context"

type Context struct {
	UserID           string   `json:"userId"`
	UserRole         string   `json:"userRole"`
	OrganizationID   string   `json:"organizationId,omitempty"`
	OrganizationName string   `json:"organizationName,omitempty"`
	OrganizationLogo string   `json:"organizationLogo,omitempty"`
	MemberRole       string   `json:"memberRole,omitempty"`
	Permissions      []string `json:"permissions"`
	IsSuperAdmin     bool     `json:"isSuperAdmin"`
}

func ContextWithTenant(ctx context.Context, tenant Context) context.Context {
	return context.WithValue(ctx, contextKeyTenant, tenant)
}

func FromContext(ctx context.Context) (Context, bool) {
	value, ok := ctx.Value(contextKeyTenant).(Context)
	return value, ok
}

func (ctx Context) HasRole(roles ...string) bool {
	if ctx.IsSuperAdmin {
		return true
	}

	memberRole := normalizeRole(ctx.MemberRole)
	userRole := normalizeRole(ctx.UserRole)
	for _, role := range roles {
		role = normalizeRole(role)
		if memberRole == role || userRole == role {
			return true
		}
	}

	return false
}

func (ctx Context) IsOrganizationMember() bool {
	return strings.TrimSpace(ctx.OrganizationID) != "" && strings.TrimSpace(ctx.UserID) != ""
}

func (ctx Context) HasPermission(permission string) bool {
	memberRole := normalizeRole(ctx.MemberRole)
	if ctx.IsSuperAdmin || memberRole == "owner" || memberRole == "admin" {
		return true
	}

	permission = strings.TrimSpace(permission)
	for _, candidate := range ctx.Permissions {
		candidate = strings.TrimSpace(candidate)
		if candidate == "*" || candidate == permission {
			return true
		}
	}

	return false
}

func normalizeRole(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return ""
	}

	replacer := strings.NewReplacer(
		"á", "a", "à", "a", "â", "a", "ã", "a",
		"é", "e", "ê", "e",
		"í", "i",
		"ó", "o", "ô", "o", "õ", "o",
		"ú", "u",
		"ç", "c",
	)
	value = replacer.Replace(value)

	switch value {
	case "administrador", "administrator":
		return "admin"
	case "proprietario":
		return "owner"
	case "gerente":
		return "manager"
	case "usuario", "membro", "member", "corretor", "broker", "agent":
		return "user"
	default:
		return value
	}
}
