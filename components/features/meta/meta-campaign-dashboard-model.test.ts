import assert from "node:assert/strict";
import test from "node:test";

import {
  selectAttributedMetaEntities,
// The Node type-stripping runner requires the explicit TypeScript extension.
// @ts-expect-error -- production imports remain extensionless for Next.js.
} from "./meta-campaign-dashboard-model.ts";

test("keeps unattributed Meta buckets out of real entity indicators", () => {
  const entities = [
    { id: "campaign-1", label: "Campanha real" },
    { id: "unattributed", label: "Sem atribuicao" },
    { id: " UNATTRIBUTED ", label: "Sem atribuicao normalizada" },
    { id: "", label: "ID ausente" },
    { id: "creative-2", label: "Criativo real" },
  ];

  assert.deepEqual(selectAttributedMetaEntities(entities), [
    entities[0],
    entities[4],
  ]);
  assert.equal(entities.length, 5);
});
