package properties

// PropertyInventoryOpenSQL accepts only a source-controlled alias. Standard
// properties have no inventory dependency. Linked properties must retain the
// complete organization-scoped hierarchy, including any referenced floor plan.
func PropertyInventoryOpenSQL(propertyAlias string) string {
	return `(
		not exists (select 1 from public.property_development_units inventory_link
		  where inventory_link.organization_id = ` + propertyAlias + `.organization_id
		    and inventory_link.property_id = ` + propertyAlias + `.id)
		or exists (select 1 from public.property_development_units inventory_unit
		  where inventory_unit.organization_id = ` + propertyAlias + `.organization_id
		    and inventory_unit.property_id = ` + propertyAlias + `.id
		    and ` + UnitInventoryOpenSQL("inventory_unit") + `)
	)`
}

// UnitInventoryOpenSQL uses the valid open states, so missing and future unknown
// states fail closed. Aliases are supplied by source code, never browser input.
// The properties domain owns this linked-property predicate so developments and
// public readers share it without a circular domain import.
func UnitInventoryOpenSQL(unitAlias string) string {
	return `exists (
		select 1 from public.property_developments inventory_development
		join public.property_development_buildings inventory_building
		  on inventory_building.organization_id = inventory_development.organization_id
		 and inventory_building.development_id = inventory_development.id
		join public.property_development_phases inventory_phase
		  on inventory_phase.organization_id = inventory_building.organization_id
		 and inventory_phase.development_id = inventory_building.development_id
		 and inventory_phase.id = inventory_building.phase_id
		left join public.property_development_floor_plans inventory_plan
		  on inventory_plan.organization_id = ` + unitAlias + `.organization_id
		 and inventory_plan.development_id = ` + unitAlias + `.development_id
		 and inventory_plan.id = ` + unitAlias + `.floor_plan_id
		where inventory_development.organization_id = ` + unitAlias + `.organization_id
		  and inventory_development.id = ` + unitAlias + `.development_id
		  and inventory_building.id = ` + unitAlias + `.building_id
		  and inventory_development.status in ('planning', 'pre_launch', 'launched', 'under_construction', 'ready', 'delivered')
		  and inventory_development.commercial_status in ('draft', 'active', 'paused')
		  and inventory_building.status in ('planned', 'active', 'delivered')
		  and inventory_phase.status in ('planned', 'pre_launch', 'launched', 'under_construction', 'delivered')
		  and (` + unitAlias + `.floor_plan_id is null or
		    (inventory_plan.id is not null and inventory_plan.status in ('draft', 'active')))
	)`
}
