import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isPropertySettingsConflict } from "./property-settings-concurrency";

test("identifica apenas o conflito CAS das configurações de imóveis", () => {
  assert.equal(
    isPropertySettingsConflict({
      status: 409,
      code: "property_settings_conflict",
    }),
    true,
  );
  assert.equal(
    isPropertySettingsConflict({
      status: 409,
      code: "property_workspace_conflict",
    }),
    false,
  );
  assert.equal(
    isPropertySettingsConflict({ status: 409, code: "local_read_only" }),
    false,
  );
  assert.equal(
    isPropertySettingsConflict({
      status: 400,
      code: "property_settings_conflict",
    }),
    false,
  );
  assert.equal(isPropertySettingsConflict(null), false);
});

test("tela preserva escolhas no conflito e exige recarga explícita", () => {
  const screen = readFileSync(
    "components/features/properties/PropertySettingsScreen.tsx",
    "utf8",
  );

  assert.match(screen, /expected_updated_at: expectedUpdatedAt/);
  assert.match(screen, /if \(isPropertySettingsConflict\(error\)\)/);
  assert.match(screen, /setHasConcurrencyConflict\(true\)/);
  assert.match(screen, /Suas escolhas continuam neste formulário/);
  assert.match(screen, /window\.confirm\(/);
  assert.match(screen, /await refreshProfile\(\)/);
  assert.match(screen, /Recarregar configurações/);
  assert.match(screen, /\|\| hasConcurrencyConflict/);
});
