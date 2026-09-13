import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const formSource = readFileSync(join(directory, "..", "PropertyFormScreen.tsx"), "utf8");
const guardSource = readFileSync(
  join(directory, "..", "..", "..", "..", "hooks", "properties", "use-property-form-navigation-guard.ts"),
  "utf8",
);

test("formulário protege refresh, links internos e histórico com mudanças locais", () => {
  assert.match(guardSource, /addEventListener\("beforeunload"/);
  assert.match(guardSource, /addEventListener\("click", handleDocumentClick, true\)/);
  assert.match(guardSource, /addEventListener\("popstate"/);
  assert.match(guardSource, /window\.confirm\(PROPERTY_FORM_UNSAVED_MESSAGE\)/);
  assert.match(formSource, /usePropertyFormNavigationGuard\(\{/);
  assert.match(formSource, /if \(!confirmFormNavigation\(\)\) return;/);
});

test("conflito mantém mudanças locais e exige recarga explícita antes de novo save", () => {
  assert.match(formSource, /isPropertyWorkspaceConflict\(error\)/);
  assert.match(formSource, /setHasConcurrencyConflict\(true\)/);
  assert.match(formSource, /Recarregar dados atualizados/);
  assert.match(formSource, /hasConcurrencyConflict/);
});
