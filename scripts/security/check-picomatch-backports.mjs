#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const vendor = join(root, "vendor", "picomatch");
const registry = "https://registry.npmjs.org";
const forkName = "@vimob-crm/picomatch";
const advisoryUrl = "https://github.com/advisories/GHSA-fc5q-39xc-vjpf";
const upstreamVersions = ["2.3.2", "4.0.4"];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function digest(path, algorithm, encoding) {
  return createHash(algorithm).update(readFileSync(path)).digest(encoding);
}

function vendorFile(filename) {
  assert.match(filename, /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/, "Invalid backport filename");
  const file = join(vendor, filename);
  assert(lstatSync(file).isFile(), "Backport artifacts must be regular files");
  return file;
}

function installedFileDigests(packageRoot) {
  const files = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path);
      } else {
        assert(entry.isFile(), "Backport tree must contain only regular files");
        files.push([relative(packageRoot, path).split(sep).join("/"), digest(path, "sha256", "hex")]);
      }
    }
  }
  assert(lstatSync(packageRoot).isDirectory(), "Backport must be installed as a directory");
  visit(packageRoot);
  return Object.fromEntries(files);
}

function isPicomatchEntry([path, entry]) {
  return path.endsWith("/node_modules/picomatch") ||
    path === "node_modules/picomatch" ||
    entry.name === forkName || entry.name === "picomatch";
}

function verifyInstalledBackports(manifest, lock) {
  assert.equal(manifest.advisoryUrl, advisoryUrl, "Unexpected Picomatch advisory in the manifest");
  assert.deepEqual(
    manifest.packages.map((pkg) => pkg.upstreamVersion).sort(),
    upstreamVersions,
    "Both upstream Picomatch versions must be verified",
  );
  assert.equal(digest(vendorFile(manifest.patch.file), "sha256", "hex"), manifest.patch.sha256, "Backport patch changed");

  const entries = Object.entries(lock.packages).filter(isPicomatchEntry);
  assert.equal(entries.length, upstreamVersions.length, "Unexpected Picomatch copies in the lockfile");

  const rootRequire = createRequire(join(root, "package.json"));
  const micromatchRequire = createRequire(rootRequire.resolve("micromatch"));
  const tinyglobbyRequire = createRequire(rootRequire.resolve("tinyglobby"));
  const fdirRequire = createRequire(tinyglobbyRequire.resolve("fdir"));
  const installedManifests = new Map([
    ["2.3.2", micromatchRequire.resolve("picomatch/package.json")],
    ["4.0.4", tinyglobbyRequire.resolve("picomatch/package.json")],
  ]);
  assert.equal(
    fdirRequire.resolve("picomatch/package.json"),
    installedManifests.get("4.0.4"),
    "fdir must use the same verified backport as tinyglobby",
  );

  for (const pkg of manifest.packages) {
    assert(pkg.version.startsWith(pkg.upstreamVersion + "-vimob."), "Backport version must identify the original release");
    assert.equal("sha512-" + digest(vendorFile(pkg.file), "sha512", "base64"), pkg.integrity, "Backport archive changed");

    const installedManifest = installedManifests.get(pkg.upstreamVersion);
    const installedRoot = dirname(installedManifest);
    const lockPath = relative(root, installedRoot).split(sep).join("/");
    const locked = lock.packages[lockPath];
    assert(locked && locked.dev, "Backport must be a locked development dependency");
    assert.equal(locked.name, forkName, "Unexpected locked package name");
    assert.equal(locked.version, pkg.version, "Unexpected locked backport version");
    assert.equal(locked.resolved, "file:vendor/picomatch/" + pkg.file, "Backport must be locked to the reviewed archive");
    assert.equal(locked.integrity, pkg.integrity, "Locked archive integrity changed");

    const installed = readJson(installedManifest);
    assert.equal(installed.name, forkName, "Unexpected installed package name");
    assert.equal(installed.version, pkg.version, "Unexpected installed backport version");
    assert.deepEqual(installedFileDigests(installedRoot), pkg.files, "Installed backport files differ from reviewed content");
  }
}

async function registryJson(path, options = {}) {
  const response = await fetch(registry + path, {
    ...options,
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  assert(response.ok, `Public npm registry request failed with HTTP ${response.status}`);
  return response.json();
}

async function auditUpstream(manifest) {
  await Promise.all(manifest.packages.map(async (pkg) => {
    const source = await registryJson("/picomatch/" + pkg.upstreamVersion);
    assert.equal(source.name, "picomatch", "Unexpected upstream module name");
    assert.equal(source.version, pkg.upstreamVersion, "Unexpected upstream module version");
    assert.equal(source.dist.integrity, pkg.upstreamIntegrity, "Upstream archive no longer matches the reviewed source");
  }));

  const report = await registryJson("/-/npm/v1/security/advisories/bulk", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ picomatch: upstreamVersions }),
  });
  const advisories = report.picomatch;
  assert(Array.isArray(advisories) && advisories.length, "Upstream audit omitted the reviewed Picomatch advisory");
  const severities = new Set(["info", "low", "moderate", "high", "critical"]);
  assert(advisories.every((item) => item && severities.has(item.severity) &&
    typeof item.url === "string" && typeof item.vulnerable_versions === "string"), "Invalid upstream advisory data");

  for (const item of advisories) {
    console.log(JSON.stringify({
      upstreamPackage: "picomatch",
      upstreamVersions,
      advisory: item.url,
      severity: item.severity,
      range: item.vulnerable_versions,
    }));
  }

  const known = advisories.filter((item) => item.url === advisoryUrl);
  assert(known.length === 1 && known[0].severity === "high" && known[0].vulnerable_versions === "<=4.0.7",
    "The reviewed Picomatch advisory changed and requires another review");
  assert(!advisories.some((item) => item.url !== advisoryUrl && (item.severity === "high" || item.severity === "critical")),
    "Unreviewed high or critical upstream Picomatch advisory");
  console.log("Reviewed Picomatch backports verified for both installed versions.");
}

const manifest = readJson(join(vendor, "manifest.json"));
verifyInstalledBackports(manifest, readJson(join(root, "package-lock.json")));
await auditUpstream(manifest);
