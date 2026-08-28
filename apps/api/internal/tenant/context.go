package tenant

import (
	"context"
	"strings"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
)

type contextKey string

const contextKeyTenant contextKey = "tenant_context"

type Context struct {
	UserID             string     `json:"userId"`
	UserRole           string     `json:"userRole"`
	OrganizationID     string     `json:"organizationId,omitempty"`
	OrganizationName   string     `json:"organizationName,omitempty"`
	OrganizationLogo   string     `json:"organizationLogo,omitempty"`
	SubscriptionStatus string     `json:"subscriptionStatus,omitempty"`
	SubscriptionType   string     `json:"subscriptionType,omitempty"`
	TrialEndsAt        *time.Time `json:"trialEndsAt,omitempty"`
	BillingGraceUntil  *time.Time `json:"billingGraceUntil,omitempty"`
	MemberRole         string     `json:"memberRole,omitempty"`
	Permissions        []string   `json:"permissions"`
	EnabledModules     []string   `json:"enabledModules"`
	IsTeamLeader       bool       `json:"isTeamLeader"`
	LedTeamIDs         []string   `json:"ledTeamIds,omitempty"`
	LedUserIDs         []string   `json:"ledUserIds,omitempty"`
	LedPipelineIDs     []string   `json:"ledPipelineIds,omitempty"`
	IsSuperAdmin       bool       `json:"isSuperAdmin"`
}

func (ctx Context) HasBillingAccessAt(now time.Time) bool {
	if ctx.IsSuperAdmin {
		return true
	}
	if strings.TrimSpace(ctx.OrganizationID) == "" {
		return false
	}

	subscriptionStatus := normalizeBillingValue(ctx.SubscriptionStatus)
	subscriptionType := normalizeBillingValue(ctx.SubscriptionType)

	switch subscriptionType {
	case "free":
		return subscriptionStatus == "active"
	case "trial":
		return subscriptionStatus == "trial" && timestampIsActive(ctx.TrialEndsAt, now)
	case "paid":
		if subscriptionStatus == "active" {
			return true
		}
		if isGraceEligibleBillingStatus(subscriptionStatus) {
			return timestampIsActive(ctx.BillingGraceUntil, now)
		}
	}

	return false
}

func normalizeBillingValue(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func timestampIsActive(value *time.Time, now time.Time) bool {
	return value != nil && now.Before(*value)
}

func isGraceEligibleBillingStatus(status string) bool {
	switch status {
	case "overdue", "past_due":
		return true
	default:
		return false
	}
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
	for _, role := range roles {
		role = normalizeRole(role)
		if memberRole == role {
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

	return permissions.Has(ctx.Permissions, permission)
}

func (ctx Context) HasModule(module string) bool {
	module = strings.ToLower(strings.TrimSpace(module))
	if module == "" {
		return false
	}

	for _, candidate := range ctx.EnabledModules {
		if strings.ToLower(strings.TrimSpace(candidate)) == module {
			return true
		}
	}

	return false
}

func (ctx Context) LeadsTeam(teamID string) bool {
	return containsScopeID(ctx.LedTeamIDs, teamID)
}

func (ctx Context) LeadsUser(userID string) bool {
	return containsScopeID(ctx.LedUserIDs, userID)
}

func (ctx Context) LeadsPipeline(pipelineID string) bool {
	return containsScopeID(ctx.LedPipelineIDs, pipelineID)
}

func containsScopeID(values []string, target string) bool {
	target = strings.TrimSpace(target)
	if target == "" {
		return false
	}
	for _, value := range values {
		if strings.EqualFold(strings.TrimSpace(value), target) {
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
