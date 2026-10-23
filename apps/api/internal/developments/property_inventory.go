package developments

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	propertiesdomain "github.com/vimob-crm/vimob-crm/apps/api/internal/properties"
)

type inventoryQueryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

// All hierarchy mutations first lock the development FOR UPDATE. Publication
// uses compatible shared locks in the same development -> unit -> property
// order, so an archive cannot pass its dependency check during publication.
// This function deliberately permits a closed hierarchy: withdrawal must remain
// possible. PropertyInventoryOpenSQL supplies the separate eligibility check.
func LockPropertyInventory(ctx context.Context, tx pgx.Tx, organizationID, propertyID string) error {
	var developmentID, unitID string
	err := tx.QueryRow(ctx, `select development_id::text, id::text
		from public.property_development_units
		where organization_id = $1::uuid and property_id = $2::uuid`, organizationID, propertyID).Scan(&developmentID, &unitID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if unitID != "" {
		if err := lockDevelopmentInventoryRead(ctx, tx, organizationID, developmentID); err != nil {
			if errors.Is(err, ErrNotFound) {
				return fmt.Errorf("%w: o vínculo de estoque foi alterado", ErrConflict)
			}
			return err
		}
		var lockedID string
		err = tx.QueryRow(ctx, `select id::text
			from public.property_development_units
			where organization_id = $1::uuid and development_id = $2::uuid
			  and id = $3::uuid and property_id = $4::uuid
			for share`, organizationID, developmentID, unitID, propertyID).Scan(&lockedID)
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("%w: o vínculo de estoque foi alterado", ErrConflict)
		}
		if err != nil {
			return err
		}
	}
	// A property discovered without a unit may have been linked while we waited
	// for its row. Never take parent locks after this lock: detect that change
	// and require a retry through the ordered parent -> unit -> property path.
	var lockedPropertyID string
	err = tx.QueryRow(ctx, `select id::text from public.properties
		where organization_id = $1::uuid and id = $2::uuid for update`, organizationID, propertyID).Scan(&lockedPropertyID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	// Missing property authorization/existence is still determined by the
	// caller's scoped source loader; this helper grants no access on its own.
	var currentUnitID string
	err = tx.QueryRow(ctx, `select id::text
		from public.property_development_units
		where organization_id = $1::uuid and property_id = $2::uuid`, organizationID, propertyID).Scan(&currentUnitID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if currentUnitID != unitID {
		return fmt.Errorf("%w: o vínculo de estoque foi alterado", ErrConflict)
	}
	return nil
}

func lockDevelopmentInventoryRead(ctx context.Context, queryer inventoryQueryer, organizationID, developmentID string) error {
	var id string
	err := queryer.QueryRow(ctx, `select id::text from public.property_developments
		where organization_id = $1::uuid and id = $2::uuid for share`, organizationID, developmentID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

// PropertyInventoryOpenSQL accepts only a source-controlled SQL alias. A normal
// property has no inventory dependency. A linked property must retain its full
// organization-scoped, open hierarchy; missing parents fail closed.
func PropertyInventoryOpenSQL(propertyAlias string) string {
	return propertiesdomain.PropertyInventoryOpenSQL(propertyAlias)
}

func requireUnitInventoryOpen(ctx context.Context, queryer inventoryQueryer, organizationID, developmentID, unitID string) error {
	var available bool
	err := queryer.QueryRow(ctx, `select exists (select 1 from public.property_development_units inventory_unit
		where inventory_unit.organization_id = $1::uuid
		  and inventory_unit.development_id = $2::uuid and inventory_unit.id = $3::uuid
		  and `+propertiesdomain.UnitInventoryOpenSQL("inventory_unit")+`)`, organizationID, developmentID, unitID).Scan(&available)
	if err != nil {
		return err
	}
	if !available {
		return fmt.Errorf("%w: a unidade pertence a um empreendimento ou estrutura encerrada", ErrConflict)
	}
	return nil
}
