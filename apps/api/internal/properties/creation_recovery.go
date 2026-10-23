package properties

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func isPropertyCreationRecoveryRequest(r *http.Request) bool {
	values := r.URL.Query()["creation_recovery"]
	return len(values) == 1 && values[0] == "true"
}

// A normal scoped 404 may mean hidden, rather than deleted. Only a fresh
// manager's unrestricted organization read may prove a creation was removed.
func (handler Handler) propertyCreationRecoveryTenant(ctx context.Context, original tenant.Context) (tenant.Context, error) {
	actorID, actorValid := normalizeUUID(original.UserID)
	organizationID, organizationValid := normalizeUUID(original.OrganizationID)
	if !actorValid || !organizationValid {
		return tenant.Context{}, tenant.ErrOrganizationAccessDenied
	}
	resolve := handler.resolveCreationRecoveryTenant
	if resolve == nil {
		// Each recovery builds a new resolver, bypassing the shared five-second
		// permission/module cache used by ordinary authenticated reads.
		resolve = tenant.NewRepository(handler.repo.db).Resolve
	}
	current, err := resolve(ctx, actorID, organizationID)
	if err != nil {
		for _, denied := range []error{tenant.ErrOrganizationAccessDenied, tenant.ErrUserInactive,
			tenant.ErrUserProfileNotFound, tenant.ErrOrganizationNotFound, tenant.ErrOrganizationRequired,
			tenant.ErrInvalidOrganizationID} {
			if errors.Is(err, denied) {
				return tenant.Context{}, tenant.ErrOrganizationAccessDenied
			}
		}
		return tenant.Context{}, err
	}
	if current.UserID != actorID || current.OrganizationID != organizationID ||
		!canCreateProperties(current) || !current.HasModule("properties") || !current.HasBillingAccessAt(time.Now().UTC()) {
		return tenant.Context{}, tenant.ErrOrganizationAccessDenied
	}
	return current, nil
}
