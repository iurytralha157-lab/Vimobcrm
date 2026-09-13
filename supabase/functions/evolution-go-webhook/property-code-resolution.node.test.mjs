import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const start = source.indexOf("async function resolvePropertyByCode");
const end = source.indexOf("async function ensureLead", start);
const resolver = source.slice(start, end);

test("property-code resolution accepts only one unique property across legacy aliases", () => {
  assert.ok(start >= 0 && end > start, "resolvePropertyByCode source must be present");
  assert.match(resolver, /new Map<string, JsonRecord>\(\)/);
  assert.match(resolver, /\.limit\(2\)/);
  assert.doesNotMatch(resolver, /\.limit\(1\)/);
  assert.doesNotMatch(resolver, /\.maybeSingle\(\)/);
  assert.match(resolver, /matches\.set\(propertyId, property as JsonRecord\)/);
  assert.match(resolver, /matches\.size > 1/);
  assert.match(resolver, /return matches\.size === 1/);
});
