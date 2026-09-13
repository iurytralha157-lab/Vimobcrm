import assert from "node:assert/strict";
import test from "node:test";

import {
  describeSiteAnalyticsFreshness,
  getSiteAnalyticsFreshness,
} from "./analytics-freshness";

const NOW = new Date("2026-08-31T15:00:00.000Z");

test("classifica a coleta do site sem fabricar timestamp ausente", () => {
  assert.deepEqual(getSiteAnalyticsFreshness(null, NOW), {
    status: "unavailable",
    collectedAt: null,
    ageMs: null,
  });
  assert.equal(
    getSiteAnalyticsFreshness("data-invalida", NOW).status,
    "unavailable",
  );
});

test("distingue coleta ativa, atrasada e sem eventos recentes", () => {
  const fresh = getSiteAnalyticsFreshness("2026-08-31T14:00:00.000Z", NOW);
  const delayed = getSiteAnalyticsFreshness("2026-08-30T09:00:00.000Z", NOW);
  const stale = getSiteAnalyticsFreshness("2026-08-21T15:00:00.000Z", NOW);

  assert.equal(fresh.status, "fresh");
  assert.equal(
    describeSiteAnalyticsFreshness(fresh),
    "Evento recebido nas últimas 24h",
  );
  assert.equal(delayed.status, "delayed");
  assert.equal(
    describeSiteAnalyticsFreshness(delayed),
    "Sem novos eventos há 30 horas",
  );
  assert.equal(stale.status, "stale");
  assert.equal(
    describeSiteAnalyticsFreshness(stale),
    "Sem novos eventos há 10 dias",
  );
});

test("não classifica relógio do cliente adiantado como coleta antiga", () => {
  const freshness = getSiteAnalyticsFreshness("2026-08-31T16:00:00.000Z", NOW);
  assert.equal(freshness.status, "fresh");
  assert.equal(freshness.ageMs, 0);
});
