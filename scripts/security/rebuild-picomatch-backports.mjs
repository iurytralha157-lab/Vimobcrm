#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempDisposableSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const vendor = fileURLToPath(new URL("../../vendor/picomatch/", import.meta.url));
const manifest = JSON.parse(readFileSync(join(vendor, "manifest.json"), "utf8"));
const patch = readFileSync(join(vendor, manifest.patch.file));
const upstreamCommit = "f03bec2c02e46f063fbfdc161aae1d0f854b2565";

function integrity(file) {
  return "sha512-" + createHash("sha512").update(readFileSync(file)).digest("base64");
}

function pack(cwd, spec) {
  const windows = process.platform === "win32";
  const npmCli = windows ? [join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")] : [];
  const output = execFileSync(windows ? process.execPath : "npm", [...npmCli,
    "pack", spec, "--ignore-scripts", "--json", "--registry=https://registry.npmjs.org",
  ], { cwd, encoding: "utf8", timeout: 60_000 });
  return JSON.parse(output)[0].filename;
}

function rebuild(directory, backport) {
  assert.match(backport.upstreamVersion, /^(2\.3\.2|4\.0\.4)$/);
  assert.equal(backport.version, backport.upstreamVersion + "-vimob.1");
  mkdirSync(directory);
  const original = pack(directory, "picomatch@" + backport.upstreamVersion);
  assert.equal(integrity(join(directory, original)), backport.upstreamIntegrity, "Upstream archive failed integrity check");
  execFileSync("tar", ["-xzf", original], { cwd: directory, timeout: 15_000 });

  const source = join(directory, "package");
  execFileSync("git", ["-c", "core.autocrlf=false", "apply", "-"], { cwd: source, input: patch, timeout: 15_000 });
  const parser = join(source, "lib", "parse.js");
  writeFileSync(parser, readFileSync(parser, "utf8").replaceAll("\r\n", "\n"));

  const packageFile = join(source, "package.json");
  const metadata = JSON.parse(readFileSync(packageFile, "utf8"));
  assert.equal(metadata.name, "picomatch");
  assert.equal(metadata.version, backport.upstreamVersion);
  metadata.name = "@vimob-crm/picomatch";
  metadata.version = backport.version;
  metadata.private = true;
  metadata.vimobBackport = {
    upstream: "picomatch@" + backport.upstreamVersion,
    advisory: "GHSA-fc5q-39xc-vjpf",
    patch: "https://github.com/micromatch/picomatch/pull/246/commits/" + upstreamCommit,
  };
  writeFileSync(packageFile, JSON.stringify(metadata, null, 2) + "\n");

  const regenerated = pack(directory, "./package");
  assert.equal(regenerated, backport.file);
  assert.equal(integrity(join(directory, regenerated)), backport.integrity, "Backport build differs from the reviewed archive");
  assert.equal(integrity(join(vendor, backport.file)), backport.integrity, "Checked-in backport archive differs");
  console.log("Reproduced " + backport.version + " from the pinned upstream archive and parser patch.");
}

const workspace = mkdtempDisposableSync(join(tmpdir(), "vimob-picomatch-"));
try {
  for (const backport of manifest.packages) {
    rebuild(join(workspace.path, backport.upstreamVersion), backport);
  }
} finally {
  workspace.remove();
}
