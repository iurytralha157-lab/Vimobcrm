import assert from "node:assert/strict";
import test from "node:test";

import {
  PUBLIC_TRACKING_HEARTBEAT_MS,
  PUBLIC_TRACKING_EVENT_TYPES,
  pickPublicSiteSearchFilters,
} from "./public-tracking";

test("persists only declared public search filters", () => {
  const filters = pickPublicSiteSearchFilters(
    "search=apto&cidade=S%C3%A3o+Paulo&utm_source=meta&token=secret&vagas=2",
  );

  assert.deepEqual(filters, {
    search: "apto",
    cidade: "São Paulo",
    vagas: "2",
  });
  assert.equal("utm_source" in filters, false);
  assert.equal("token" in filters, false);
});

test("drops empty filters and uses one stable value per allowlisted key", () => {
  const params = new URLSearchParams();
  params.append("bairro", "");
  params.append("tipo", " apartamento ");
  params.append("tipo", "casa");

  assert.deepEqual(pickPublicSiteSearchFilters(params), {
    tipo: "apartamento",
  });
});

test("canonical public event union excludes authoritative form conversions", () => {
  assert.ok(PUBLIC_TRACKING_EVENT_TYPES.includes("page_duration"));
  assert.equal(
    (PUBLIC_TRACKING_EVENT_TYPES as readonly string[]).includes("form_submit"),
    false,
  );
});

test("heartbeat is no more frequent than once every two minutes", () => {
  assert.equal(PUBLIC_TRACKING_HEARTBEAT_MS, 120_000);
});
