import assert from "node:assert/strict";
import test from "node:test";

import { buildSetupGuideHref, setupGuidePathMatches } from "./navigation";

test("buildSetupGuideHref inclui a etapa sem perder query ou hash", () => {
  assert.equal(
    buildSetupGuideHref("/settings?tab=integrations#meta", "integrations_meta"),
    "/settings?tab=integrations&setupGuide=integrations_meta#meta",
  );
  assert.equal(
    buildSetupGuideHref("/dashboard?setupGuide=old", "dashboard"),
    "/dashboard?setupGuide=dashboard",
  );
});

test("buildSetupGuideHref rejeita rotas externas e IDs malformados", () => {
  assert.throws(() => buildSetupGuideHref("https://example.com", "dashboard"));
  assert.throws(() => buildSetupGuideHref("//example.com", "dashboard"));
  assert.throws(() => buildSetupGuideHref("/dashboard", "dashboard&admin=true"));
});

test("setupGuidePathMatches aceita barra final, mas não subrotas vizinhas", () => {
  assert.equal(setupGuidePathMatches("/properties/", "/properties"), true);
  assert.equal(setupGuidePathMatches("/properties/new", "/properties"), false);
  assert.equal(setupGuidePathMatches(null, "/properties"), false);
});
