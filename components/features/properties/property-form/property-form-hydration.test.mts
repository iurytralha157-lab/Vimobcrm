import assert from "node:assert/strict";
import test from "node:test";

const modulePath = "./property-form-hydration.ts";
const {
  arePropertySnapshotsEqualOutsideMedia,
  resolvePropertyFormRefetch,
} = await import(modulePath);

test("refetch concorrente preserva rascunho e a versão-base do CAS", () => {
  assert.deepEqual(
    resolvePropertyFormRefetch({
      hydratedPropertyId: "property-1",
      hydratedUpdatedAt: "2026-09-08T10:00:00Z",
      nextPropertyId: "property-1",
      nextUpdatedAt: "2026-09-08T10:05:00Z",
      hasLocalChanges: true,
      serverChangesAreMediaOnly: false,
    }),
    {
      action: "preserve",
      expectedUpdatedAt: "2026-09-08T10:00:00Z",
    },
  );
});

test("mudança própria apenas de fotos preserva rascunho e rebasa o CAS", () => {
  const baseline = {
    id: "property-1",
    title: "Casa",
    preco: 500_000,
    metadata: { financing_mode: "sim" },
    imagem_principal: "old.jpg",
    fotos: ["old.jpg"],
    updated_at: "2026-09-08T10:00:00Z",
  };
  const afterAssetMutation = {
    ...baseline,
    imagem_principal: "new.jpg",
    fotos: ["new.jpg", "old.jpg"],
    updated_at: "2026-09-08T10:05:00Z",
  };

  assert.equal(
    arePropertySnapshotsEqualOutsideMedia(baseline, afterAssetMutation),
    true,
  );
  assert.deepEqual(
    resolvePropertyFormRefetch({
      hydratedPropertyId: "property-1",
      hydratedUpdatedAt: baseline.updated_at,
      nextPropertyId: "property-1",
      nextUpdatedAt: afterAssetMutation.updated_at,
      hasLocalChanges: true,
      serverChangesAreMediaOnly: true,
    }),
    {
      action: "preserve-and-rebase",
      expectedUpdatedAt: "2026-09-08T10:05:00Z",
    },
  );

  assert.equal(
    arePropertySnapshotsEqualOutsideMedia(baseline, {
      ...afterAssetMutation,
      preco: 550_000,
    }),
    false,
  );
});

test("carga inicial, refetch limpo e troca de imóvel continuam reidratando", () => {
  assert.equal(
    resolvePropertyFormRefetch({
      hydratedPropertyId: null,
      hydratedUpdatedAt: null,
      nextPropertyId: "property-1",
      nextUpdatedAt: "version-1",
      hasLocalChanges: false,
      serverChangesAreMediaOnly: false,
    }).action,
    "hydrate",
  );
  assert.equal(
    resolvePropertyFormRefetch({
      hydratedPropertyId: "property-1",
      hydratedUpdatedAt: "version-1",
      nextPropertyId: "property-1",
      nextUpdatedAt: "version-2",
      hasLocalChanges: false,
      serverChangesAreMediaOnly: false,
    }).action,
    "hydrate",
  );
  assert.equal(
    resolvePropertyFormRefetch({
      hydratedPropertyId: "property-1",
      hydratedUpdatedAt: "version-1",
      nextPropertyId: "property-2",
      nextUpdatedAt: "version-2",
      hasLocalChanges: true,
      serverChangesAreMediaOnly: false,
    }).action,
    "hydrate",
  );
});
