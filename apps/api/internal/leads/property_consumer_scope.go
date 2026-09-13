package leads

import (
	"fmt"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/propertyscope"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func appendCanonicalPropertyVisibility(args []any, tenantContext tenant.Context, alias string) ([]any, string) {
	canRead := propertyscope.CanRead(tenantContext)
	viewerID := any(nil)
	canViewTeam := false
	if canRead {
		viewerID = nullableString(tenantContext.UserID)
		canViewTeam = propertyscope.CanViewTeam(tenantContext)
	}

	args = append(args, propertyscope.CanViewAll(tenantContext), viewerID, canViewTeam)
	return args, propertyscope.VisibilitySQL(
		alias,
		fmt.Sprintf("$%d", len(args)-2),
		fmt.Sprintf("$%d", len(args)-1),
		fmt.Sprintf("$%d", len(args)),
	)
}

func dashboardPropertyValueSQL(tenantContext tenant.Context) string {
	if propertyscope.CanViewAll(tenantContext) {
		return "coalesce(nullif(l.valor_interesse, 0), nullif(p.preco, 0), nullif(p.valor_venda_avaliado, 0), 0)::double precision"
	}
	return "coalesce(nullif(l.valor_interesse, 0), nullif(p.preco, 0), 0)::double precision"
}
