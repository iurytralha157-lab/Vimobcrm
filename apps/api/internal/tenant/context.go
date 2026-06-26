package tenant

import "context"

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

	for _, role := range roles {
		if ctx.MemberRole == role || ctx.UserRole == role {
			return true
		}
	}

	return false
}

func (ctx Context) HasPermission(permission string) bool {
	if ctx.IsSuperAdmin || ctx.MemberRole == "owner" || ctx.MemberRole == "admin" {
		return true
	}

	for _, candidate := range ctx.Permissions {
		if candidate == "*" || candidate == permission {
			return true
		}
	}

	return false
}
