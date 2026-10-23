package leads

import (
	"context"
	"strings"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// TagCatalog is a read-only picker projection. Management responses retain
// their revision/count contract and do not use this narrower DTO for edits.
type TagCatalog struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	Color          string `json:"color"`
	OrganizationID string `json:"organization_id"`
}

func (repo Repository) ListTagCatalog(ctx context.Context, actor tenant.Context) ([]TagCatalog, error) {
	if strings.TrimSpace(actor.OrganizationID) == "" || strings.TrimSpace(actor.UserID) == "" {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	var authorized bool
	if err := repo.db.Pool().QueryRow(ctx, `select exists(select 1
		from public.organization_members member
		join public.users actor on actor.id=member.user_id and coalesce(actor.is_active,false)
		join public.organizations organization on organization.id=member.organization_id and coalesce(organization.is_active,true)
		where member.organization_id=$1::uuid and member.user_id=$2::uuid
		and coalesce(member.is_active,false) and member.deleted_at is null)`,
		actor.OrganizationID, actor.UserID).Scan(&authorized); err != nil {
		return nil, err
	}
	if !authorized {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	rows, err := repo.db.Pool().Query(ctx, `select id::text,name,color,organization_id::text
		from public.tags where organization_id=$1::uuid order by name,id`, actor.OrganizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []TagCatalog{}
	for rows.Next() {
		var tag TagCatalog
		if err := rows.Scan(&tag.ID, &tag.Name, &tag.Color, &tag.OrganizationID); err != nil {
			return nil, err
		}
		result = append(result, tag)
	}
	return result, rows.Err()
}
