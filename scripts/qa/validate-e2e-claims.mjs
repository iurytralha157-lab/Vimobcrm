#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  CATEGORY_DEFINITIONS,
  loadCoverageContract,
  readJsonFile,
  validateCoverageDiscovery,
} from "../../tests/e2e/coverage/contract.mjs";

const require = createRequire(import.meta.url);

function parseArguments(argv) {
  const options = {
    rootDir: process.cwd(),
    inventoryPath: "docs/audits/crm-surface-inventory.json",
    manifestsDir: "tests/e2e/coverage",
    discoveryReport: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (["--root", "--inventory", "--manifests-dir", "--discovery-report"].includes(argument) && !value) {
      throw new Error(`${argument} exige um valor`);
    }
    if (argument === "--root") {
      options.rootDir = path.resolve(value);
      index += 1;
    } else if (argument === "--inventory") {
      options.inventoryPath = value;
      index += 1;
    } else if (argument === "--manifests-dir") {
      options.manifestsDir = value;
      index += 1;
    } else if (argument === "--discovery-report") {
      options.discoveryReport = path.resolve(value);
      index += 1;
    } else if (argument === "--help") {
      return { help: true };
    } else {
      throw new Error(`Argumento desconhecido: ${argument}`);
    }
  }
  return options;
}

export function buildDiscoveryEnvironment(environment = process.env) {
  const childEnvironment = { ...environment, E2E_DISCOVERY_ONLY: "true" };
  delete childEnvironment.E2E_CLAIM_ATTESTATION_KEY;
  return childEnvironment;
}

function discoverPlaywrightTests(rootDir) {
  const playwrightCli = require.resolve("@playwright/test/cli");
  const childEnvironment = buildDiscoveryEnvironment();
  const result = spawnSync(
    process.execPath,
    [playwrightCli, "test", "--list", "--reporter=json"],
    {
      cwd: rootDir,
      encoding: "utf8",
      env: childEnvironment,
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    throw new Error(`Playwright discovery falhou (${result.status}): ${result.stderr || result.stdout}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`Playwright discovery não produziu JSON válido: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function validateE2EClaims(options = {}) {
  const contract = loadCoverageContract(options);
  const discovery = options.discoveryReport
    ? readJsonFile(options.discoveryReport)
    : discoverPlaywrightTests(contract.rootDir);
  const summary = validateCoverageDiscovery(contract, discovery);
  return {
    schemaVersion: 1,
    inventorySchemaVersion: contract.inventory.schemaVersion,
    inventoryDigestSha256: contract.inventory.stableIdIndex.digestSha256,
    manifestFiles: contract.manifestFiles.map((file) => path.relative(contract.rootDir, file).replaceAll("\\", "/")),
    executableCategories: Object.keys(CATEGORY_DEFINITIONS),
    recomputedQaDenominators: contract.inventory.recomputedQaDenominators,
    ...summary,
  };
}

function isMainModule() {
  return process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isMainModule()) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(
        "Uso: node scripts/qa/validate-e2e-claims.mjs [--root DIR] [--inventory ARQUIVO] [--manifests-dir DIR] [--discovery-report JSON]\n",
      );
    } else {
      process.stdout.write(`${JSON.stringify(validateE2EClaims(options), null, 2)}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
