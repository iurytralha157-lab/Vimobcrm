package developments

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// Users belong to multiple organizations; a users(id) FK does not authorize
// assignment within the current organization. Lock the active membership and
// user until this mutation commits, including against concurrent revocation.
func requireDevelopmentResponsibleMember(ctx context.Context, tx pgx.Tx, organizationID string, userID *string) error {
	if userID == nil {
		return nil
	}
	var assigned string
	err := tx.QueryRow(ctx, `select member.user_id::text
		from public.organization_members member
		join public.users assigned_user on assigned_user.id = member.user_id
		where member.organization_id = $1::uuid and member.user_id = $2::uuid
		  and member.is_active = true and member.deleted_at is null
		  and coalesce(assigned_user.is_active, false) = true
		for share of member, assigned_user`, organizationID, *userID).Scan(&assigned)
	if errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("%w: responsible_user_id must be an active organization member", ErrInvalidInput)
	}
	return err
}

func requireDevelopmentInventoryOpen(ctx context.Context, tx pgx.Tx, organizationID, developmentID string) error {
	var available bool
	if err := tx.QueryRow(ctx, `select status not in ('cancelled','archived','suspended') and commercial_status not in ('closed','sold_out')
		from public.property_developments where organization_id = $1::uuid and id = $2::uuid`, organizationID, developmentID).Scan(&available); err != nil {
		return err
	}
	if !available {
		return fmt.Errorf("%w: este empreendimento não está aberto para operações de estoque", ErrConflict)
	}
	return nil
}

func requireUnitStructureOpen(ctx context.Context, tx pgx.Tx, organizationID, developmentID, unitID string) error {
	var available bool
	if err := tx.QueryRow(ctx, `select exists (
		select 1 from public.property_development_units unit
		join public.property_development_buildings building on building.organization_id = unit.organization_id and building.id = unit.building_id
		join public.property_development_phases phase on phase.organization_id = building.organization_id and phase.id = building.phase_id
		left join public.property_development_floor_plans plan on plan.organization_id = unit.organization_id and plan.id = unit.floor_plan_id
		where unit.organization_id = $1::uuid and unit.development_id = $2::uuid and unit.id = $3::uuid
		  and building.status <> 'inactive' and phase.status not in ('cancelled','suspended')
		  and (plan.id is null or plan.status not in ('inactive','archived'))
	)`, organizationID, developmentID, unitID).Scan(&available); err != nil {
		return err
	}
	if !available {
		return fmt.Errorf("%w: a unidade pertence a uma estrutura ou planta desativada", ErrConflict)
	}
	return nil
}
