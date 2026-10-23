import assert from "node:assert/strict";
import test from "node:test";
import { filterOpenPropertyInventory } from "./property-inventory-eligibility.ts";

type Row = Record<string, unknown>;
const org = "org-a";
const property = { id: "property-a", organization_id: org };
function fixture() {
  return {
    property_development_units: [{ id: "unit-a", organization_id: org, property_id: property.id, development_id: "dev-a", building_id: "building-a", floor_plan_id: "plan-a" }],
    property_developments: [{ id: "dev-a", organization_id: org, status: "launched", commercial_status: "active" }],
    property_development_buildings: [{ id: "building-a", organization_id: org, development_id: "dev-a", phase_id: "phase-a", status: "active" }],
    property_development_phases: [{ id: "phase-a", organization_id: org, development_id: "dev-a", status: "launched" }],
    property_development_floor_plans: [{ id: "plan-a", organization_id: org, development_id: "dev-a", status: "active" }],
  } as Record<string, Row[]>;
}
function client(rows: Record<string, unknown>, errorTable?: string) {
  const calls: Array<{ table: string; organization: unknown; ids: string[] }> = [];
  return {
    calls,
    from(table: string) {
      let organization: unknown;
      const query = {
        select: (_columns: string) => query,
        eq: (field: string, value: unknown) => {
          assert.equal(field, "organization_id"); organization = value; return query;
        },
        in: async (field: string, ids: string[]) => {
          calls.push({ table, organization, ids });
          assert.equal(organization, org);
          assert.ok(ids.length <= 50);
          const value = table in rows ? rows[table] : [];
          return { data: Array.isArray(value) ? value.filter((row) => ids.includes(row[field])) : value,
            error: table === errorTable ? new Error("synthetic lookup failure") : null };
        },
      };
      return query;
    },
  };
}

test("inventory filter keeps independent properties and looks up linked parents in bounded batches", async () => {
  const rows = fixture();
  const api = client(rows);
  const properties = Array.from({ length: 101 }, (_, i) => ({ ...property, id: i === 100 ? property.id : `independent-${i}` }));
  assert.deepEqual(await filterOpenPropertyInventory(api, org, properties), properties);
  assert.equal(api.calls.filter((call) => call.table === "property_development_units").length, 3);
  assert.equal(api.calls.length, 7);
});

test("inventory filter vetoes closed inactive suspended and unknown parents for published snapshots", async () => {
  for (const [table, field, value] of [
    ["property_developments", "status", "suspended"], ["property_developments", "status", "archived"],
    ["property_developments", "commercial_status", "closed"], ["property_developments", "commercial_status", "sold_out"],
    ["property_development_phases", "status", "suspended"], ["property_development_phases", "status", "cancelled"],
    ["property_development_buildings", "status", "inactive"], ["property_development_floor_plans", "status", "archived"],
    ["property_development_floor_plans", "status", "inactive"], ["property_developments", "status", "unknown"],
    ["property_development_phases", "status", null], ["property_development_buildings", "status", ""],
  ]) {
    const rows = fixture(); rows[String(table)][0][String(field)] = value;
    assert.deepEqual(await filterOpenPropertyInventory(client(rows), org, [property]), [], `${table} ${field} ${value}`);
  }
});

test("inventory filter fails closed for missing cross-tenant cross-development or duplicate parents", async () => {
  for (const table of Object.keys(fixture()).filter((name) => name !== "property_development_units")) {
    const missing = fixture(); missing[table] = [];
    assert.deepEqual(await filterOpenPropertyInventory(client(missing), org, [property]), [], table);
    const foreign = fixture(); foreign[table][0].organization_id = "org-b";
    assert.deepEqual(await filterOpenPropertyInventory(client(foreign), org, [property]), [], table);
    const duplicate = fixture(); duplicate[table].push({ ...duplicate[table][0] });
    assert.deepEqual(await filterOpenPropertyInventory(client(duplicate), org, [property]), [], table);
  }
  for (const table of ["property_development_buildings", "property_development_phases", "property_development_floor_plans"]) {
    const rows = fixture(); rows[table][0].development_id = "other-development";
    assert.deepEqual(await filterOpenPropertyInventory(client(rows), org, [property]), []);
  }
  const rows = fixture(); rows.property_development_units.push({ ...rows.property_development_units[0], id: "another-unit" });
  assert.deepEqual(await filterOpenPropertyInventory(client(rows), org, [property]), []);
});

test("inventory filter allows null floorplan only and never falls back after lookup failure", async () => {
  const rows = fixture(); rows.property_development_units[0].floor_plan_id = null;
  rows.property_development_floor_plans = [];
  assert.deepEqual(await filterOpenPropertyInventory(client(rows), org, [property]), [property]);
  delete rows.property_development_units[0].floor_plan_id;
  assert.deepEqual(await filterOpenPropertyInventory(client(rows), org, [property]), []);
  for (const table of Object.keys(fixture())) {
    assert.deepEqual(await filterOpenPropertyInventory(client(fixture(), table), org, [property]), []);
    assert.deepEqual(await filterOpenPropertyInventory(client({ ...fixture(), [table]: null }), org, [property]), []);
  }
});
