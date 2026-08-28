import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const surfaceInventory = JSON.parse(
  fs.readFileSync(path.join(ROOT, "docs", "audits", "crm-surface-inventory.json"), "utf8"),
);
const homeDebt = JSON.parse(
  fs.readFileSync(path.join(ROOT, "docs", "audits", "home-design-debt.json"), "utf8"),
);

const validAccess = new Set(["auth", "protected", "public", "publicSite"]);
const validSurfaceScopes = new Set([
  "infrastructure",
  "protected-and-public",
  "protected-only",
  "public-only",
]);
const stableIdNamespace = "vimob-crm-surface/v1";
const stableIdHexLength = 20;

function expectedStableId(type, fields) {
  const key = [stableIdNamespace, type, ...fields.map(String)].join("\0");
  return `${type}:${crypto.createHash("sha256").update(key).digest("hex").slice(0, stableIdHexLength)}`;
}

test("surface inventory binds every reachable component to canonical route access", () => {
  assert.equal(surfaceInventory.schemaVersion, 3);
  const routeAccess = new Map(surfaceInventory.routes.map((route) => [route.url, route.access]));
  const files = new Set();
  let previousFile = "";

  for (const entry of surfaceInventory.routeReachabilityBySurfaceFile) {
    assert.equal(typeof entry.file, "string");
    assert.ok(
      previousFile === "" || previousFile.localeCompare(entry.file) < 0,
      "surface reachability must be sorted and unique",
    );
    assert.ok(!files.has(entry.file));
    assert.ok(fs.existsSync(path.join(ROOT, entry.file)), `missing surface file: ${entry.file}`);
    assert.ok(Array.isArray(entry.routes) && entry.routes.length > 0);
    assert.equal(new Set(entry.routes).size, entry.routes.length);
    assert.deepEqual(entry.routes, [...entry.routes].sort());

    const expectedAccess = [...new Set(entry.routes.map((url) => {
      assert.ok(routeAccess.has(url), `unknown route ${url} for ${entry.file}`);
      return routeAccess.get(url);
    }))].sort();
    assert.deepEqual(entry.access, expectedAccess);
    assert.ok(entry.access.every((access) => validAccess.has(access)));

    files.add(entry.file);
    previousFile = entry.file;
  }
});

test("stable ID index is complete, unique, relative and canonically derivable", () => {
  const index = surfaceInventory.stableIdIndex;
  assert.equal(index.schemaVersion, 1);
  assert.equal(index.namespace, stableIdNamespace);
  assert.equal(index.algorithm, "sha256/80-bit");

  assert.equal(index.routes.length, surfaceInventory.counts.routes.totalFilesystemRoutes);
  assert.equal(
    index.routes.filter((route) => route.kind === "renderable").length,
    surfaceInventory.counts.routes.renderable,
  );
  assert.equal(
    index.routes.filter((route) => route.kind === "alias").length,
    surfaceInventory.counts.routes.aliases,
  );

  const groups = [
    [
      "overlay",
      index.routeReachableSurfaces.overlays,
      surfaceInventory.qaDenominators.routeReachableOverlayImplementations,
    ],
    [
      "form",
      index.routeReachableSurfaces.forms,
      surfaceInventory.qaDenominators.routeReachableFormImplementations,
    ],
    [
      "cta",
      index.routeReachableSurfaces.internalCtas,
      surfaceInventory.qaDenominators.routeReachableInternalCtaImplementations,
    ],
    [
      "control",
      index.routeReachableSurfaces.supplementalControls,
      surfaceInventory.qaDenominators.routeReachableSupplementalOverlayAndTabControls,
    ],
  ];
  const routeByUrl = new Map(surfaceInventory.routes.map((route) => [route.url, route]));
  const ids = new Set();

  for (const route of index.routes) {
    assert.ok(routeByUrl.has(route.url), `unknown indexed route: ${route.url}`);
    assert.ok(!path.isAbsolute(route.source) && !route.source.startsWith("../"));
    assert.equal(
      route.id,
      expectedStableId("route", [route.source, route.kind, route.url]),
    );
    assert.equal(route.id, routeByUrl.get(route.url).id);
    assert.match(route.id, /^route:[0-9a-f]{20}$/);
    assert.ok(!ids.has(route.id), `duplicate stable ID: ${route.id}`);
    ids.add(route.id);
  }

  for (const [type, entries, denominator] of groups) {
    assert.equal(entries.length, denominator, `${type} index must equal its denominator`);
    for (const entry of entries) {
      assert.ok(!path.isAbsolute(entry.file) && !entry.file.startsWith("../"));
      assert.ok(Number.isInteger(entry.line) && entry.line > 0);
      assert.ok(Number.isInteger(entry.column) && entry.column > 0);
      assert.ok(Array.isArray(entry.routes) && entry.routes.length > 0);
      assert.deepEqual(entry.routes, [...new Set(entry.routes)].sort());
      assert.ok(entry.routes.every((url) => routeByUrl.has(url)));
      assert.equal(
        entry.id,
        expectedStableId(type, [entry.file, entry.line, entry.column]),
      );
      assert.match(entry.id, new RegExp(`^${type}:[0-9a-f]{20}$`));
      assert.ok(!ids.has(entry.id), `duplicate stable ID: ${entry.id}`);
      ids.add(entry.id);
    }
  }

  const { digestSha256, ...payload } = index;
  assert.equal(
    digestSha256,
    crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
  );
  assert.deepEqual(surfaceInventory.diagnostics.stableIdDuplicates, []);
  assert.ok(!JSON.stringify(index).includes(ROOT), "stable ID index leaked an absolute path");
});

test("stable ID index digest is repeatable in a fresh inventory execution", () => {
  const execution = spawnSync(
    process.execPath,
    [path.join(ROOT, "scripts", "audits", "inventory-crm-surfaces.mjs")],
    {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120_000,
    },
  );
  assert.equal(execution.status, 0, execution.stderr);
  const fresh = JSON.parse(execution.stdout);
  assert.equal(
    fresh.stableIdIndexDigestSha256,
    surfaceInventory.stableIdIndex.digestSha256,
  );
});

test("Home debt keeps protected CRM findings separate without hiding public debt", () => {
  assert.equal(homeDebt.schemaVersion, 2);
  assert.equal(
    homeDebt.surfaceInventoryDigestSha256,
    surfaceInventory.sourceDigestSha256,
  );
  assert.equal(homeDebt.findings.length, homeDebt.counts.findings);

  const scopeCounts = Object.fromEntries(
    [...validSurfaceScopes].map((scope) => [scope, 0]),
  );
  const protectedFiles = new Set();
  for (const finding of homeDebt.findings) {
    assert.ok(validSurfaceScopes.has(finding.surfaceScope));
    scopeCounts[finding.surfaceScope] += 1;
    if (finding.surfaceScope.startsWith("protected")) protectedFiles.add(finding.file);
  }

  assert.deepEqual(homeDebt.counts.bySurfaceScope, {
    "protected-only": scopeCounts["protected-only"],
    "protected-and-public": scopeCounts["protected-and-public"],
    "public-only": scopeCounts["public-only"],
    infrastructure: scopeCounts.infrastructure,
  });
  assert.equal(
    homeDebt.counts.protectedReachableFindings,
    scopeCounts["protected-only"] + scopeCounts["protected-and-public"],
  );
  assert.equal(homeDebt.counts.protectedReachableFilesWithFindings, protectedFiles.size);
  assert.ok(
    homeDebt.topProtectedFiles.every((entry) => protectedFiles.has(entry.file)),
    "public-only files must not enter the protected CRM priority list",
  );
  assert.equal(
    Object.values(homeDebt.counts.bySurfaceScope).reduce((sum, count) => sum + count, 0),
    homeDebt.counts.findings,
  );
});
