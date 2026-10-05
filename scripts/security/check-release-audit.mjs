#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const allowedDevAdvisory = "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm";
const allowedDevChain = new Set([
  "braces",
  "micromatch",
  "fast-glob",
  "@next/eslint-plugin-next",
  "eslint-config-next",
]);

function audit(args) {
  const result = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["audit", "--json", ...args],
    { encoding: "utf8", shell: process.platform === "win32" },
  );
  if (result.error || ![0, 1].includes(result.status)) {
    throw new Error(`npm audit could not finish: ${result.error?.message ?? result.stderr}`);
  }
  const report = JSON.parse(result.stdout);
  if (report.error || !report.vulnerabilities) {
    throw new Error(`npm audit returned an invalid report: ${report.error?.message ?? "missing vulnerabilities"}`);
  }
  return report.vulnerabilities;
}

function severe(vulnerabilities) {
  return Object.entries(vulnerabilities).filter(([, finding]) =>
    finding.severity === "high" || finding.severity === "critical",
  );
}

const productionFindings = severe(audit(["--omit=dev"]));
if (productionFindings.length > 0) {
  throw new Error(`Production dependency audit failed: ${productionFindings.map(([name]) => name).join(", ")}`);
}

const allFindings = severe(audit([]));
const advisories = allFindings.flatMap(([, finding]) =>
  finding.via.filter((item) => typeof item === "object"),
);
const allowedOnly = allFindings.length === 0 || (
  allFindings.every(([name]) => allowedDevChain.has(name)) &&
  advisories.length === 1 &&
  advisories[0].url === allowedDevAdvisory &&
  advisories[0].name === "braces" &&
  advisories[0].severity === "high"
);
if (!allowedOnly) {
  throw new Error(`Dependency audit found unapproved high/critical findings: ${allFindings.map(([name]) => name).join(", ")}`);
}

if (allFindings.length > 0) {
  console.warn("Known dev-only braces advisory remains in eslint-config-next; no patched braces release is available. All production dependencies and other high/critical advisories passed.");
} else {
  console.log("No high or critical dependency advisories.");
}
