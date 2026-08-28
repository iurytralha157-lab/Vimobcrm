package properties

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
)

type propertyReference struct {
	field     string
	table     string
	userScope bool
}

var propertyReferences = []propertyReference{
	{field: "owner_id", table: "property_owners"},
	{field: "city_id", table: "property_cities"},
	{field: "neighborhood_id", table: "property_neighborhoods"},
	{field: "condominium_id", table: "property_condominiums"},
	{field: "property_type_id", table: "property_types"},
	{field: "created_by", userScope: true},
	{field: "responsible_user_id", userScope: true},
	{field: "corretor_id", userScope: true},
}

func (repo Repository) validatePropertyReferences(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	input propertyRequest,
) error {
	for _, reference := range propertyReferences {
		referenceID := optionalReferenceID(input[reference.field])
		if referenceID == "" {
			continue
		}

		var exists bool
		var err error
		if reference.userScope {
			err = tx.QueryRow(ctx, `
				select exists (
					select 1
					from public.users app_user
					where app_user.id = $2::uuid
					  and coalesce(app_user.is_active, true)
					  and (
						app_user.organization_id = $1::uuid
						or app_user.role = 'super_admin'
						or exists (
							select 1
							from public.user_roles global_role
							where global_role.user_id = app_user.id
							  and global_role.role = 'super_admin'
						)
						or exists (
							select 1
							from public.organization_members member
							where member.organization_id = $1::uuid
							  and member.user_id = app_user.id
							  and coalesce(member.is_active, false)
						)
					  )
				)
			`, organizationID, referenceID).Scan(&exists)
		} else {
			err = tx.QueryRow(ctx, `
				select exists (
					select 1
					from public.`+reference.table+` scoped_reference
					where scoped_reference.organization_id = $1::uuid
					  and scoped_reference.id = $2::uuid
				)
			`, organizationID, referenceID).Scan(&exists)
		}
		if err != nil {
			return err
		}
		if !exists {
			return fmt.Errorf("%w: %s does not belong to the organization", ErrInvalidInput, reference.field)
		}
	}

	return nil
}

func optionalReferenceID(value any) string {
	text, _ := value.(string)
	return strings.TrimSpace(text)
}
