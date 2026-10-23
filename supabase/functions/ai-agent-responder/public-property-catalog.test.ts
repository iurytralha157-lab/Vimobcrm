import assert from "node:assert/strict";
import test from "node:test";
import { loadPublicPropertyCatalog, matchPublicPropertyCodes, type PublicCatalogClient } from "./public-property-catalog.ts";

type Row = Record<string, unknown>;
const org = "org-a";
const pubId = "11111111-1111-4111-8111-111111111111";
function property(id: string, overrides: Row = {}): Row {
  return { id, organization_id: org, code: "CA123", status: "active", published_on_site: true,
    title: "Public house", cidade: "Curitiba", bairro: "Public neighborhood", public_address_visibility: "parcial", ...overrides };
}
function client(properties: Row[], publications: Row[] = [], versions: Row[] = [], errorTable?: string) {
  const calls: Array<{ table: string; organization: unknown; from?: number; to?: number }> = [];
  const tables: Record<string, Row[]> = { properties, property_channel_publications: publications,
    property_channel_publication_versions: versions, property_development_units: [] };
  return { calls, from(table: string) {
    assert.ok(Object.hasOwn(tables, table), table);
    let selected = [...tables[table]], organization: unknown, from: number | undefined, to: number | undefined;
    const ordering: Array<{ key: string; ascending: boolean }> = [];
    const query = {
      select: (_columns: string) => query,
      eq: (key: string, value: unknown) => { if (key === "organization_id") organization = value; selected = selected.filter(row => row[key] === value); return query; },
      not: (key: string, _operator: string, value: unknown) => { selected = selected.filter(row => row[key] !== value); return query; },
      order: (key: string, options: { ascending: boolean }) => { ordering.push({ key, ascending: options.ascending }); return query; },
      range: (start: number, end: number) => { from = start; to = end; return query; },
      in: (key: string, values: string[]) => { selected = selected.filter(row => values.includes(String(row[key]))); return query; },
      or: (_expression: string) => query,
      then: (resolve: (value: unknown) => unknown, reject: (value: unknown) => unknown) => {
        calls.push({ table, organization, from, to });
        assert.equal(organization, org, `${table} must remain tenant scoped`);
        selected.sort((a, b) => { for (const { key, ascending } of ordering) { if (a[key] !== b[key]) return (String(a[key] ?? "") > String(b[key] ?? "") ? 1 : -1) * (ascending ? 1 : -1); } return 0; });
        return Promise.resolve({ data: from === undefined ? selected : selected.slice(from, Number(to) + 1), error: table === errorTable ? "synthetic failure" : null }).then(resolve, reject);
      },
    };
    return query;
  } } as unknown as PublicCatalogClient & { calls: typeof calls };
}

test("private newer portfolio cannot consume public search and mentioned-code limits", async () => {
  const privateRows = Array.from({ length: 250 }, (_, i) => property(`private-${i}`, { published_on_site: false, status: "draft", code: `CA123${i}`, destaque: true }));
  const catalog = await loadPublicPropertyCatalog(client([...privateRows, property("public")]), org, "*");
  assert.equal(catalog.length, 1);
  assert.equal(matchPublicPropertyCodes(catalog, ["CA123"])[0]?.id, "public");
});

test("legacy public candidates beyond first page remain searchable and pages use inclusive stable ranges", async () => {
  const api = client(Array.from({ length: 201 }, (_, i) => property(`public-${String(i).padStart(3, "0")}`, { code: `CA${1000 + i}` })));
  const catalog = await loadPublicPropertyCatalog(api, org, "*");
  assert.equal(catalog.length, 201);
  assert.equal(matchPublicPropertyCodes(catalog, ["CA1200"])[0]?.id, "public-200");
  assert.deepEqual(api.calls.filter(call => call.table === "properties" && call.from !== undefined).map(({ from, to }) => [from, to]), [[0, 199], [200, 399]]);
});

test("canonical frozen code is searched even if live code and compatibility boolean drifted", async () => {
  const publication = { id: pubId, organization_id: org, property_id: "canonical", channel: "site", channel_account_key: "default", desired_state: "published", published_version: 1 };
  const version = { publication_id: pubId, organization_id: org, property_id: "canonical", channel: "site", channel_account_key: "default", version: 1,
    payload: { property: { id: "canonical", codigo: "CA-123", titulo: "Frozen house", status: "active", public_address_visibility: "minimo", bairro: "PRIVATE", cidade: "Curitiba" } } };
  const catalog = await loadPublicPropertyCatalog(client([property("canonical", { code: "NEW99", published_on_site: false })], [publication], [version]), org, "*");
  assert.equal(catalog.length, 1);
  assert.equal(matchPublicPropertyCodes(catalog, ["CA123"])[0]?.code, "CA-123");
  assert.equal(catalog[0].bairro, null);
});

test("exact public code outranks public substring matches before top four", () => {
  const rows = [0, 1, 2, 3, 4].map(i => ({ id: `partial-${i}`, code: `CA123${i}` }));
  rows.push({ id: "exact", code: "CA-123" });
  const matched = matchPublicPropertyCodes(rows, ["CA123"]);
  assert.equal(matched.length, 4);
  assert.equal(matched[0].id, "exact");
});

test("withdrawal and query failures cannot resurrect compatibility candidates", async () => {
  const withdrawal = { id: pubId, organization_id: org, property_id: "withdrawn", channel: "site", channel_account_key: "default", desired_state: "unpublished", published_version: null };
  assert.deepEqual(await loadPublicPropertyCatalog(client([property("withdrawn")], [withdrawal]), org, "*"), []);
  assert.deepEqual(await loadPublicPropertyCatalog(client([property("public")], [], [], "property_channel_publications"), org, "*"), []);
});
