type Row = Record<string, unknown>;
type QueryResponse = { data: unknown; error: unknown };
type InventoryQuery = {
  select: (columns: string) => InventoryQuery;
  eq: (column: string, value: unknown) => InventoryQuery;
  in: (column: string, values: string[]) => PromiseLike<QueryResponse>;
};
export type PropertyInventoryClient = { from: (table: string) => InventoryQuery };

const BATCH_SIZE = 50;
const DEVELOPMENT_STATUSES = new Set(["planning", "pre_launch", "launched", "under_construction", "ready", "delivered"]);
const COMMERCIAL_STATUSES = new Set(["draft", "active", "paused"]);
const PHASE_STATUSES = new Set(["planned", "pre_launch", "launched", "under_construction", "delivered"]);
const BUILDING_STATUSES = new Set(["planned", "active", "delivered"]);
const PLAN_STATUSES = new Set(["draft", "active"]);
function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function status(value: unknown) { return text(value).toLowerCase(); }
function unique(values: unknown[]) { return [...new Set(values.map(text).filter(Boolean))]; }

async function rows(
  client: PropertyInventoryClient, organizationId: string,
  table: string, columns: string, field: string, ids: string[],
): Promise<Row[] | null> {
  const result: Row[] = [];
  for (let offset = 0; offset < ids.length; offset += BATCH_SIZE) {
    const batch = ids.slice(offset, offset + BATCH_SIZE);
    const { data, error } = await client.from(table).select(columns)
      .eq("organization_id", organizationId).in(field, batch);
    if (error || !Array.isArray(data)) return null;
    for (const row of data) {
      if (!row || typeof row !== "object" || Array.isArray(row)
        || row.organization_id !== organizationId || !batch.includes(text(row[field]))) return null;
      result.push(row as Row);
    }
  }
  return result;
}

function index(rows: Row[]) {
  const result = new Map<string, Row>();
  for (const row of rows) {
    const id = text(row.id);
    if (!id || result.has(id)) return null;
    result.set(id, row);
  }
  return result;
}

/**
 * Current hierarchy veto shared by public API and AI, matching the Go inventory
 * boundary. Public versions stay frozen; closing a linked parent hides them.
 * Lookups are tenant scoped and bounded, and missing/error responses fail closed.
 */
export async function filterOpenPropertyInventory<T extends Row>(
  client: PropertyInventoryClient, organizationId: string, properties: T[],
): Promise<T[]> {
  const candidates = properties.filter((property) => property.organization_id === organizationId && text(property.id));
  if (!candidates.length) return [];
  try {
    const units = await rows(client, organizationId, "property_development_units",
      "id, organization_id, property_id, development_id, building_id, floor_plan_id", "property_id", unique(candidates.map((property) => property.id)));
    if (!units) return [];
    if (!units.length) return candidates;
    const [developments, buildings, plans] = await Promise.all([
      rows(client, organizationId, "property_developments", "id, organization_id, status, commercial_status", "id", unique(units.map((unit) => unit.development_id))),
      rows(client, organizationId, "property_development_buildings", "id, organization_id, development_id, phase_id, status", "id", unique(units.map((unit) => unit.building_id))),
      rows(client, organizationId, "property_development_floor_plans", "id, organization_id, development_id, status", "id", unique(units.map((unit) => unit.floor_plan_id))),
    ]);
    if (!developments || !buildings || !plans) return [];
    const phases = await rows(client, organizationId, "property_development_phases", "id, organization_id, development_id, status", "id", unique(buildings.map((building) => building.phase_id)));
    if (!phases) return [];
    const developmentIndex = index(developments), buildingIndex = index(buildings), phaseIndex = index(phases), planIndex = index(plans);
    if (!developmentIndex || !buildingIndex || !phaseIndex || !planIndex) return [];
    const unitsByProperty = new Map<string, Row[]>();
    for (const unit of units) {
      if (!text(unit.id)) return [];
      const id = text(unit.property_id);
      unitsByProperty.set(id, [...(unitsByProperty.get(id) ?? []), unit]);
    }
    return candidates.filter((property) => {
      const links = unitsByProperty.get(text(property.id)) ?? [];
      if (!links.length) return true;
      if (links.length !== 1) return false;
      const unit = links[0], developmentId = text(unit.development_id);
      const development = developmentIndex.get(developmentId), building = buildingIndex.get(text(unit.building_id));
      const phase = building ? phaseIndex.get(text(building.phase_id)) : undefined;
      if (!development || !building || !phase || building.development_id !== developmentId || phase.development_id !== developmentId
        || !DEVELOPMENT_STATUSES.has(status(development.status)) || !COMMERCIAL_STATUSES.has(status(development.commercial_status))
        || !BUILDING_STATUSES.has(status(building.status)) || !PHASE_STATUSES.has(status(phase.status))) return false;
      if (unit.floor_plan_id === null) return true;
      const plan = planIndex.get(text(unit.floor_plan_id));
      return Boolean(plan && plan.development_id === developmentId && PLAN_STATUSES.has(status(plan.status)));
    });
  } catch {
    return [];
  }
}
