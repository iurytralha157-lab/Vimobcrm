import assert from "node:assert/strict";
import test from "node:test";

import { dashboardCreativeDisplayName } from "./creative-display.ts";

test("remove apenas sufixo de data e hash gerado dos títulos de criativos", () => {
  assert.equal(
    dashboardCreativeDisplayName("Fale Conosco 2026-08-06-ec120b30314d239e583ea95bae278b15", null, null, false),
    "Fale Conosco",
  );
  assert.equal(
    dashboardCreativeDisplayName("Entrada a partir de R$ 500 2026-07-17-47d9901234567890abcdef1234567890", null, null, false),
    "Entrada a partir de R$ 500",
  );
  assert.equal(
    dashboardCreativeDisplayName("Visite o imóvel 2026-08-06-550e8400-e29b-41d4-a716-446655440000", null, null, false),
    "Visite o imóvel",
  );
  assert.equal(
    dashboardCreativeDisplayName("Campanha 2026-08-06", null, null, false),
    "Campanha 2026-08-06",
  );
  assert.equal(
    dashboardCreativeDisplayName("Criativo abc123", null, null, false),
    "Criativo abc123",
  );
});

test("não mostra ID puro como título", () => {
  assert.equal(dashboardCreativeDisplayName("238901234567890", "238901234567890", null, false), "Criativo sem título");
  assert.equal(dashboardCreativeDisplayName("238901234567891", null, "238901234567891", true), "Anúncio sem título");
});
