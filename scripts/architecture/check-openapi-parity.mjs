import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const methods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE"]);
const scanner = fileURLToPath(new URL("./go-source-inventory.go", import.meta.url));

export function readGoRoutePatterns(directory) {
  return JSON.parse(execFileSync("go", ["run", scanner, directory], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }));
}

function operationKey(method, path) {
  assert(methods.has(method) && path.startsWith("/"), `Invalid HTTP operation: ${method} ${path}`);
  return `${method} ${path.replace(/\{[^/{}]+\}/g, (part) => part.endsWith("...}") ? "{...}" : "{}")}`;
}

function register(operations, key, operation) {
  assert(!operations.has(key), `Duplicate operation: ${operation}`);
  operations.set(key, operation);
}

export function compareOperations(routes, document) {
  const runtime = new Map();
  for (const { file, line, value } of routes) {
    const match = /^(\S+) +(\/\S*)$/.exec(value);
    assert(match, `${file}:${line}: expected a ServeMux \"METHOD /path\" registration`);
    const [, method, path] = match;
    register(runtime, operationKey(method, path.replace(/\{\$\}$/, "")), value);
  }

  const described = new Map();
  for (const [path, pathItem] of Object.entries(document.paths)) {
    const resolved = pathItem.$ref ? resolvePathReference(document, pathItem.$ref) : pathItem;
    for (const key of Object.keys(resolved)) {
      const method = key.toUpperCase();
      if (methods.has(method)) register(described, operationKey(method, path), `${method} ${path}`);
    }
  }
  return {
    routes: runtime.size,
    operations: described.size,
    matched: [...runtime.keys()].filter(key => described.has(key)).length,
    undocumented: [...runtime].filter(([key]) => !described.has(key)).map(([, value]) => value).sort(),
    contractOnly: [...described].filter(([key]) => !runtime.has(key)).map(([, value]) => value).sort(),
  };
}

export function checkLegacyCoverage(report, baseline) {
  const privateOperations = Object.keys(baseline.privateOperations);
  const exceptions = new Set(privateOperations);
  const undocumented = report.undocumented.filter(operation => !exceptions.has(operation));
  const groups = {
    undocumented,
    contractOnly: report.contractOnly,
    privateOperations: report.undocumented.filter(operation => exceptions.has(operation)),
  };
  return Object.entries(groups).map(([kind, current]) => {
    const known = kind === "privateOperations" ? privateOperations : baseline[kind];
    return {
      kind,
      additions: current.filter(operation => !known.includes(operation)),
      resolved: known.filter(operation => !current.includes(operation)),
    };
  });
}

function resolvePathReference(document, reference) {
  assert(reference.startsWith("#/"), `Path references must be local: ${reference}`);
  const pathItem = reference.slice(2).split("/")
    .reduce((value, part) => value?.[part.replaceAll("~1", "/").replaceAll("~0", "~")], document);
  assert(pathItem && !pathItem.$ref, `Could not resolve OpenAPI path reference: ${reference}`);
  return pathItem;
}

function main() {
  const base = new URL("../../packages/contracts/openapi/", import.meta.url);
  const document = yaml.load(readFileSync(new URL("v1.yaml", base), "utf8"));
  const report = compareOperations(readGoRoutePatterns("apps/api/internal/app"), document);
  if (process.argv[2] === "--report") {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const baseline = JSON.parse(readFileSync(new URL("router-parity-baseline.json", base), "utf8"));
  for (const { kind, additions, resolved } of checkLegacyCoverage(report, baseline)) {
    if (additions.length || resolved.length) {
      console.error(`${kind}: ${additions.length} new, ${resolved.length} resolved\n` +
        [...additions.map(value => `+ ${value}`), ...resolved.map(value => `- ${value}`)].join("\n"));
      process.exitCode = 1;
    }
  }
  if (!process.exitCode) {
    console.log(`OpenAPI parity: ${report.matched}/${report.routes} Go routes documented, ` +
      `${baseline.undocumented.length} legacy undocumented, ${report.contractOnly.length} legacy contract-only, ` +
      `${Object.keys(baseline.privateOperations).length} explicit private operations.`);
  }
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(error.stderr?.trim() || error.message);
    process.exitCode = 1;
  }
}
