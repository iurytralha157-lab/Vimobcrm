import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createCanonicalPropertyLocationResolver } from "./property-import-location.ts";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ORGANIZATION_ID = "22222222-2222-4222-8222-222222222222";
const CITY_ID = "33333333-3333-4333-8333-333333333333";
const NEIGHBORHOOD_ID = "44444444-4444-4444-8444-444444444444";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function resolver(
  cityOverrides: Record<string, unknown> = {},
  neighborhoodOverrides: Record<string, unknown> = {},
) {
  return createCanonicalPropertyLocationResolver(
    ORGANIZATION_ID,
    [{
      id: CITY_ID,
      organization_id: ORGANIZATION_ID,
      name: "São Paulo",
      uf: "SP",
      is_active: true,
      ...cityOverrides,
    }],
    [{
      id: NEIGHBORHOOD_ID,
      organization_id: ORGANIZATION_ID,
      city_id: CITY_ID,
      name: "Vila Mariana",
      is_active: true,
      ...neighborhoodOverrides,
    }],
  );
}

test("resolves only an exact canonical city/state/neighborhood tuple", () => {
  assert.deepEqual(resolver().resolve({
    city: " são paulo ",
    state: "sp",
    neighborhood: "VILA MARIANA",
  }), {
    city_id: CITY_ID,
    neighborhood_id: NEIGHBORHOOD_ID,
  });
  assert.deepEqual(resolver().resolve({
    city: "Sao Paulo",
    state: "SP",
    neighborhood: "Vila Mariana",
  }), {});
  assert.deepEqual(resolver().resolve({
    city: "São Paulo",
    state: null,
    neighborhood: "Vila Mariana",
  }), {});
});

test("keeps legacy text when the neighborhood is missing or ambiguous", () => {
  const ambiguous = createCanonicalPropertyLocationResolver(
    ORGANIZATION_ID,
    [{
      id: CITY_ID,
      organization_id: ORGANIZATION_ID,
      name: "São Paulo",
      uf: "SP",
      is_active: true,
    }],
    [
      {
        id: NEIGHBORHOOD_ID,
        organization_id: ORGANIZATION_ID,
        city_id: CITY_ID,
        name: "Centro",
        is_active: true,
      },
      {
        id: "55555555-5555-4555-8555-555555555555",
        organization_id: ORGANIZATION_ID,
        city_id: CITY_ID,
        name: "centro",
        is_active: true,
      },
    ],
  );

  assert.deepEqual(ambiguous.resolve({
    city: "São Paulo",
    state: "SP",
    neighborhood: "Centro",
  }), {});
  assert.deepEqual(resolver().resolve({
    city: "São Paulo",
    state: "SP",
    neighborhood: "Bairro ainda não cadastrado",
  }), {});
  assert.deepEqual(resolver().resolve({
    city: "São Paulo",
    state: "SP",
    neighborhood: null,
  }), { city_id: CITY_ID });
});

test("rejects inactive, cross-tenant and malformed catalog rows", () => {
  assert.deepEqual(resolver({ is_active: false }).resolve({
    city: "São Paulo",
    state: "SP",
    neighborhood: null,
  }), {});
  assert.deepEqual(resolver({ is_active: null }).resolve({
    city: "São Paulo",
    state: "SP",
    neighborhood: null,
  }), {});
  assert.deepEqual(resolver({}, { is_active: null }).resolve({
    city: "São Paulo",
    state: "SP",
    neighborhood: "Vila Mariana",
  }), {});
  assert.deepEqual(resolver({ organization_id: OTHER_ORGANIZATION_ID }).resolve({
    city: "São Paulo",
    state: "SP",
    neighborhood: null,
  }), {});
  assert.deepEqual(resolver({}, { organization_id: OTHER_ORGANIZATION_ID }).resolve({
    city: "São Paulo",
    state: "SP",
    neighborhood: "Vila Mariana",
  }), {});
  assert.deepEqual(resolver({ id: "not-a-uuid" }).resolve({
    city: "São Paulo",
    state: "SP",
    neighborhood: null,
  }), {});
});

test("both provider syncs load one tenant-scoped catalog resolver per sync and write only resolved ids", () => {
  const shared = source("./property-import-location.ts");
  const catalogSerialization = source(
    "../../migrations/20260908115000_serialize_property_catalog_references.sql",
  );

  assert.match(shared, /\.eq\("organization_id", organizationId\)/);
  assert.match(shared, /\.order\("id", \{ ascending: true \}\)/);
  assert.match(shared, /\.range\(offset, offset \+ catalogPageSize - 1\)/);
  assert.match(shared, /throw new Error\("property_location_catalog_load_failed"\)/);
  assert.doesNotMatch(shared, /unaccent|levenshtein|similarity|cep/i);

  for (const relativePath of [
    "../imoview-sync/index.ts",
    "../vista-sync/index.ts",
  ]) {
    const sync = source(relativePath);
    assert.equal(
      sync.match(/loadCanonicalPropertyLocationResolver\(/g)?.length,
      1,
    );
    assert.match(sync, /Location catalog load failed on page \$\{page\}/);
    assert.match(sync, /const canonicalLocation = locationResolver\.resolve\(/);
    assert.match(sync, /\.\.\.canonicalLocation/);
    assert.doesNotMatch(
      sync.slice(sync.indexOf("const canonicalLocation"), sync.indexOf("const propertyData", sync.indexOf("const canonicalLocation"))),
      /condominium|owner/i,
    );
  }

  assert.match(catalogSerialization, /a0_properties_active_location_references/);
  assert.match(catalogSerialization, /for share nowait/);
  assert.match(
    catalogSerialization,
    /city\.organization_id = new\.organization_id[\s\S]+city\.id = new\.city_id/,
  );
  assert.match(
    catalogSerialization,
    /neighborhood\.organization_id = new\.organization_id[\s\S]+neighborhood\.id = new\.neighborhood_id/,
  );
});
