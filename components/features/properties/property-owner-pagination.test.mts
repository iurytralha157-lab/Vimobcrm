import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const propertiesDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = join(propertiesDirectory, "..", "..", "..");

function source(...segments: string[]) {
  return readFileSync(join(workspaceRoot, ...segments), "utf8");
}

test("todos os seletores de proprietário usam busca paginada", () => {
  const ownerHook = source("hooks", "use-property-owners.ts");
  const ownerAPI = source("lib", "api", "property-owners.ts");
  const workspaceHook = source(
    "hooks",
    "properties",
    "use-property-workspace.ts",
  );
  const ownershipDialog = source(
    "components",
    "features",
    "properties",
    "detail",
    "PropertyOwnershipDialog.tsx",
  );
  const combobox = source(
    "components",
    "features",
    "properties",
    "PropertyOwnerCombobox.tsx",
  );

  assert.doesNotMatch(ownerHook, /export function usePropertyOwners\(/);
  assert.doesNotMatch(ownerAPI, /async getOwners\(/);
  assert.doesNotMatch(workspaceHook, /usePropertyOwnerOptions/);
  assert.match(ownershipDialog, /<PropertyOwnerCombobox/);
  assert.match(combobox, /usePropertyOwnersPage/);
  assert.match(combobox, /fetchNextPage/);
  assert.match(ownerAPI, /limit: query\.limit/);
  assert.match(ownerAPI, /cursor: query\.cursor/);
});
