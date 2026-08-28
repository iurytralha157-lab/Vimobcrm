import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const retiredGenerator = readFileSync(
  "supabase/functions/recurring-entries-generator/index.ts",
  "utf8",
);
const canonicalGenerator = readFileSync(
  "supabase/functions/smart-recurring-generator/index.ts",
  "utf8",
);
const retiredFinancialEngine = readFileSync(
  "supabase/functions/financial-engine/index.ts",
  "utf8",
);

test("the legacy recurring generator is an authenticated tombstone", () => {
  assert.match(retiredGenerator, /authorizePrivateWorkerRequest\(request\)/);
  assert.match(retiredGenerator, /request\.method\s*!==\s*"POST"/);
  assert.match(retiredGenerator, /status:\s*410/);
  assert.match(retiredGenerator, /smart-recurring-generator/);
  assert.doesNotMatch(retiredGenerator, /createClient|financial_entries/);
});

test("the legacy financial engine is a private non-writing tombstone", () => {
  assert.match(
    retiredFinancialEngine,
    /authorizePrivateWorkerRequest\(request\)/,
  );
  assert.match(retiredFinancialEngine, /request\.method\s*!==\s*"POST"/);
  assert.match(retiredFinancialEngine, /status:\s*410/);
  assert.match(retiredFinancialEngine, /\/v1\/contracts\/.*\/activate/);
  assert.doesNotMatch(retiredFinancialEngine, /createClient|\.from\(|\.rpc\(/);
});

test("financial recurrence fails closed until an atomic database primitive exists", () => {
  assert.match(canonicalGenerator, /authorizePrivateWorkerRequest\(request\)/);
  assert.match(canonicalGenerator, /request\.method\s*!==\s*"POST"/);
  assert.match(canonicalGenerator, /status:\s*503/);
  assert.match(canonicalGenerator, /financial_recurring_atomicity_required/);
  assert.doesNotMatch(canonicalGenerator, /createClient|\.from\(|\.rpc\(/);
});

test("both deployed recurring generators are currently recorded as public", () => {
  const manifest = JSON.parse(
    readFileSync("supabase/functions/production-manifest.json", "utf8"),
  ) as { functions?: Array<{ slug?: string; verify_jwt?: boolean }> };
  const bySlug = new Map(
    (manifest.functions ?? []).map((entry) => [entry.slug, entry]),
  );

  assert.equal(bySlug.get("recurring-entries-generator")?.verify_jwt, false);
  assert.equal(bySlug.get("smart-recurring-generator")?.verify_jwt, false);
});
