import assert from "node:assert/strict";
import test from "node:test";

import {
  isPropertyWorkspaceConflict,
  propertyConflictQueryKeys,
} from "./property-concurrency";

test("identifica somente o conflito CAS do workspace do imóvel", () => {
  assert.equal(
    isPropertyWorkspaceConflict({
      status: 409,
      code: "property_workspace_conflict",
    }),
    true,
  );
  assert.equal(
    isPropertyWorkspaceConflict({ status: 409, code: "property_has_dependencies" }),
    false,
  );
  assert.equal(
    isPropertyWorkspaceConflict({ status: 409, code: "local_read_only" }),
    false,
  );
  assert.equal(
    isPropertyWorkspaceConflict({ status: 400, code: "property_workspace_conflict" }),
    false,
  );
  assert.equal(isPropertyWorkspaceConflict(null), false);
});

test("conflito força atualização de listas, ficha, histórico e workspace", () => {
  assert.deepEqual(propertyConflictQueryKeys("org-1", "property-1"), [
    ["properties"],
    ["properties-infinite"],
    ["property", "org-1", "property-1"],
    ["property-history", "org-1", "property-1"],
    ["property-workspace", "org-1"],
  ]);
});
