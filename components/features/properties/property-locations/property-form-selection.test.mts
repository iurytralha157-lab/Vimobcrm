import assert from "node:assert/strict";
import test from "node:test";

const locationModelPath = "./model.ts";
const {
  catalogLocationIdForMutation,
  catalogLocationsOnly,
} = await import(locationModelPath);

test("localidade legada continua exibível, mas não é selecionável nem submetível", () => {
  const catalog = {
    id: "catalog-city",
    name: "Cidade canônica",
    catalog_source: "catalog" as const,
  };
  const legacy = {
    id: "legacy-city",
    name: "Cidade histórica",
    catalog_source: "property" as const,
  };
  const fullReadOnlyList = [catalog, legacy];

  assert.equal(
    fullReadOnlyList.find(({ id }) => id === legacy.id)?.name,
    "Cidade histórica",
  );
  assert.deepEqual(
    catalogLocationsOnly(fullReadOnlyList).map(
      (location: { id: string }) => location.id,
    ),
    ["catalog-city"],
  );
  assert.equal(
    catalogLocationIdForMutation(fullReadOnlyList, legacy.id),
    "",
  );
  assert.equal(
    catalogLocationIdForMutation(fullReadOnlyList, catalog.id),
    catalog.id,
  );
});
