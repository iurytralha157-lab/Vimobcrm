import assert from "node:assert/strict";
import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkLegacyCoverage, compareOperations, readGoRoutePatterns } from "./check-openapi-parity.mjs";

test("router parity distinguishes HTTP methods and detects absent and stale contracts", () => {
  const routes = [
    { value: "GET /v1/items/{id}" },
    { value: "POST /v1/items" },
  ];
  const document = { paths: { "/v1/items/{itemId}": { get: {}, delete: {} } } };
  assert.deepEqual(compareOperations(routes, document), {
    routes: 2,
    operations: 2,
    matched: 1,
    undocumented: ["POST /v1/items"],
    contractOnly: ["DELETE /v1/items/{itemId}"],
  });
  assert.throws(() => compareOperations([...routes, { value: "GET /v1/items/{duplicate}" }], document), /Duplicate operation/);
});

test("exact private exceptions never exempt adjacent operations", () => {
  const worker = "POST /v1/internal/operations/sla-check";
  const extra = "POST /v1/internal/operations/other-check";
  const baseline = { undocumented: [], contractOnly: [], privateOperations: { [worker]: "private worker" } };
  assert.deepEqual(checkLegacyCoverage({ undocumented: [worker, extra], contractOnly: [] }, baseline), [
    { kind: "undocumented", additions: [extra], resolved: [] },
    { kind: "contractOnly", additions: [], resolved: [] },
    { kind: "privateOperations", additions: [], resolved: [] },
  ]);
  const formerlyPrivate = checkLegacyCoverage({ undocumented: [], contractOnly: [] }, baseline);
  assert.deepEqual(formerlyPrivate.at(-1).resolved, [worker]);
});

test("the Go scanner finds literal registrations and rejects computed patterns", () => {
  const directory = mkdtempSync(join(tmpdir(), "vimob-openapi-parity-"));
  const router = join(directory, "routes.go");
  try {
    writeFileSync(router, 'package app\nfunc register() { mux.HandleFunc("GET /v1/items/{id}", handler) }\n');
    assert.deepEqual(readGoRoutePatterns(directory), [
      { file: "routes.go", line: 2, value: "GET /v1/items/{id}" },
    ]);
    writeFileSync(router, 'package app\nfunc register() { mux.HandleFunc(pattern, handler) }\n');
    assert.throws(() => readGoRoutePatterns(directory), error =>
      error.status !== 0 && /routes\.go:2:\d+: use a literal ServeMux pattern/.test(error.stderr),
    );
  } finally {
    unlinkSync(router);
    rmdirSync(directory);
  }
});
