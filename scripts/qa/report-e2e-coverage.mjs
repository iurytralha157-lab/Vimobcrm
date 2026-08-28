#!/usr/bin/env node

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  CATEGORY_DEFINITIONS,
  flattenPlaywrightTests,
  loadCoverageContract,
  protocolFrom,
} from "../../tests/e2e/coverage/contract.mjs";

export const ATTESTATION_KEY_ENV = "E2E_CLAIM_ATTESTATION_KEY";

const ATTESTATION_CONTEXT_KEYS = Object.freeze([
  "commitSha",
  "runId",
  "issuer",
  "repository",
  "workflow",
  "runAttempt",
]);
const ATTESTATION_PAYLOAD_KEYS = Object.freeze([
  "schemaVersion",
  "kind",
  "algorithm",
  "reportSha256",
  "commitSha",
  "inventoryDigestSha256",
  "runId",
  "issuer",
  "repository",
  "workflow",
  "runAttempt",
]);

function exactKeys(value, expectedKeys) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expectedKeys].sort()),
  );
}

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalizedPath(urlOrPath) {
  const pathname = new URL(urlOrPath, "http://e2e.local").pathname;
  return pathname.replace(/\/+$/, "") || "/";
}

function validatedSecret(secret) {
  assertCondition(typeof secret === "string", `${ATTESTATION_KEY_ENV} é obrigatório para assinar/verificar`);
  const bytes = Buffer.from(secret, "utf8");
  assertCondition(bytes.length >= 32, `${ATTESTATION_KEY_ENV} deve ter pelo menos 32 bytes`);
  return bytes;
}

function validatedAttestationContext(context, label = "contexto de attestation") {
  assertCondition(exactKeys(context, ATTESTATION_CONTEXT_KEYS), `${label} possui campos ausentes ou extras`);
  assertCondition(/^[0-9a-f]{40}$/.test(context.commitSha), `${label}.commitSha deve ser SHA full40 minúsculo`);
  for (const key of ["runId", "issuer", "repository", "workflow"]) {
    assertCondition(
      typeof context[key] === "string" && context[key].trim().length > 0 && context[key].length <= 256,
      `${label}.${key} inválido`,
    );
  }
  assertCondition(Number.isInteger(context.runAttempt) && context.runAttempt >= 1, `${label}.runAttempt inválido`);
  return Object.freeze({ ...context });
}

function unsignedAttestation({ reportBytes, inventoryDigestSha256, context, protocol }) {
  const validatedContext = validatedAttestationContext(context);
  assertCondition(Buffer.isBuffer(reportBytes), "reportBytes exatos são obrigatórios para attestation");
  assertCondition(/^[0-9a-f]{64}$/.test(inventoryDigestSha256), "inventoryDigestSha256 inválido para attestation");
  return {
    schemaVersion: protocol.attestationSchemaVersion,
    kind: protocol.attestationKind,
    algorithm: protocol.attestationAlgorithm,
    reportSha256: sha256(reportBytes),
    commitSha: validatedContext.commitSha,
    inventoryDigestSha256,
    runId: validatedContext.runId,
    issuer: validatedContext.issuer,
    repository: validatedContext.repository,
    workflow: validatedContext.workflow,
    runAttempt: validatedContext.runAttempt,
  };
}

function attestationSignature(unsigned, secret) {
  return createHmac("sha256", validatedSecret(secret)).update(JSON.stringify(unsigned)).digest("hex");
}

export function createE2EReportAttestation({ reportBytes, inventoryDigestSha256, context, secret, protocol }) {
  const unsigned = unsignedAttestation({ reportBytes, inventoryDigestSha256, context, protocol });
  return Object.freeze({ ...unsigned, signature: attestationSignature(unsigned, secret) });
}

export function verifyE2EReportAttestation({
  attestation,
  reportBytes,
  inventoryDigestSha256,
  expectedContext,
  secret,
  protocol,
}) {
  assertCondition(
    exactKeys(attestation, [...ATTESTATION_PAYLOAD_KEYS, "signature"]),
    "Sidecar de attestation possui campos ausentes ou extras",
  );
  const expectedUnsigned = unsignedAttestation({
    reportBytes,
    inventoryDigestSha256,
    context: expectedContext,
    protocol,
  });
  const suppliedUnsigned = Object.fromEntries(ATTESTATION_PAYLOAD_KEYS.map((key) => [key, attestation[key]]));
  for (const key of ATTESTATION_PAYLOAD_KEYS) {
    assertCondition(
      suppliedUnsigned[key] === expectedUnsigned[key],
      `Attestation inválida ou stale: ${key} diverge do report/run esperado`,
    );
  }
  assertCondition(/^[0-9a-f]{64}$/.test(attestation.signature), "Assinatura HMAC inválida");
  const expectedSignature = Buffer.from(attestationSignature(expectedUnsigned, secret), "hex");
  const suppliedSignature = Buffer.from(attestation.signature, "hex");
  assertCondition(
    suppliedSignature.length === expectedSignature.length && timingSafeEqual(suppliedSignature, expectedSignature),
    "Assinatura HMAC inválida",
  );
  return Object.freeze({
    status: "verified",
    reportSha256: expectedUnsigned.reportSha256,
    commitSha: expectedUnsigned.commitSha,
    runId: expectedUnsigned.runId,
    issuer: expectedUnsigned.issuer,
    repository: expectedUnsigned.repository,
    workflow: expectedUnsigned.workflow,
    runAttempt: expectedUnsigned.runAttempt,
  });
}

function decodeAttachmentBody(attachment) {
  if (typeof attachment?.body !== "string" || attachment.body.length === 0) return null;
  try {
    return JSON.parse(Buffer.from(attachment.body, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function validRealAttempt(result) {
  return Boolean(
    result &&
      ["passed", "failed", "timedOut", "interrupted"].includes(result.status) &&
      Number.isFinite(result.duration) &&
      result.duration >= 0 &&
      Number.isInteger(result.retry) &&
      result.retry >= 0 &&
      typeof result.startTime === "string" &&
      Number.isFinite(Date.parse(result.startTime)) &&
      Array.isArray(result.attachments),
  );
}

function proofMatchesClaim(proof, claim, testCase, inventoryDigestSha256, protocol) {
  if (
    !exactKeys(proof, [
      "schemaVersion", "kind", "inventoryDigestSha256", "caseId", "claimId", "category",
      "inventoryId", "route", "viewport", "ready", "evidence",
    ]) ||
    !exactKeys(proof.ready, ["role", "name"]) ||
    !exactKeys(proof.evidence, [
      "responseStatus", "bodyVisible", "bodyTextLength", "noHorizontalOverflow", "redirected",
      "responsePath", "finalPath", "readyLandmarkVisible", "stabilityFrames", "viewportWidth",
      "viewportHeight",
    ])
  ) return false;

  const evidence = proof.evidence;
  const expectedPath = normalizedPath(claim.route);
  const correctViewport = claim.viewport === "desktop"
    ? Number.isFinite(evidence.viewportWidth) && evidence.viewportWidth >= 1024
    : Number.isFinite(evidence.viewportWidth) && evidence.viewportWidth > 0 && evidence.viewportWidth < 768;
  return Boolean(
    proof.schemaVersion === protocol.schemaVersion &&
      proof.kind === protocol.proofKind &&
      proof.inventoryDigestSha256 === inventoryDigestSha256 &&
      proof.caseId === testCase.caseId && proof.claimId === claim.claimId &&
      proof.category === claim.category && proof.inventoryId === claim.inventoryId &&
      proof.route === claim.route && proof.viewport === claim.viewport &&
      proof.ready.role === claim.ready.role && proof.ready.name === claim.ready.name &&
      evidence.responseStatus === 200 && evidence.bodyVisible === true &&
      Number.isFinite(evidence.bodyTextLength) && evidence.bodyTextLength > 0 &&
      evidence.noHorizontalOverflow === true && evidence.redirected === false &&
      evidence.responsePath === expectedPath && evidence.finalPath === expectedPath &&
      evidence.readyLandmarkVisible === true && Number.isInteger(evidence.stabilityFrames) &&
      evidence.stabilityFrames >= 2 && correctViewport &&
      Number.isFinite(evidence.viewportHeight) && evidence.viewportHeight > 0
  );
}

function attemptMatchesClaim(attempt, claim, testCase, inventoryDigestSha256, protocol) {
  return Boolean(
    exactKeys(attempt, ["schemaVersion", "kind", "inventoryDigestSha256", "caseId", "claimId"]) &&
      attempt.schemaVersion === protocol.schemaVersion && attempt.kind === protocol.attemptKind &&
      attempt.inventoryDigestSha256 === inventoryDigestSha256 && attempt.caseId === testCase.caseId &&
      attempt.claimId === claim.claimId,
  );
}

function matchingAttachments(result, { name, contentType, bodyMatches }) {
  if (!validRealAttempt(result)) return [];
  return result.attachments.filter((attachment) => {
    if (attachment.name !== name || attachment.contentType !== contentType || attachment.path !== undefined) return false;
    const body = decodeAttachmentBody(attachment);
    return body !== null && bodyMatches(body);
  });
}

function testExecutionIsProtocolApproved(test) {
  if (
    test.rawSpec?.ok !== true || test.expectedStatus !== "passed" || test.status !== "expected" ||
    test.results.length !== 1
  ) return false;
  const [result] = test.results;
  return Boolean(
    validRealAttempt(result) && result.status === "passed" && result.retry === 0 &&
      (!Array.isArray(result.errors) || result.errors.length === 0) && result.error === undefined,
  );
}

function percent(count, denominator) {
  return Number.isFinite(denominator) && denominator > 0
    ? Number(((count / denominator) * 100).toFixed(2))
    : null;
}

function matchingReportTests(testCase, flattenedTests) {
  return flattenedTests.filter(
    (test) => test.file === testCase.file && test.projectName === testCase.projectName &&
      JSON.stringify(test.titlePath) === JSON.stringify(testCase.titlePath),
  );
}

export function buildE2ECoverageReport({
  contract,
  playwrightReport,
  reportBytes,
  attestation = null,
  attestationSecret,
  expectedAttestationContext,
  protocol = protocolFrom(contract.rootDir),
}) {
  if (attestation) {
    assertCondition(Buffer.isBuffer(reportBytes), "Report atestado exige seus bytes exatos");
    let parsedReportBytes;
    try {
      parsedReportBytes = JSON.parse(reportBytes.toString("utf8"));
    } catch {
      throw new Error("Bytes do report atestado não contêm JSON válido");
    }
    assertCondition(
      JSON.stringify(parsedReportBytes) === JSON.stringify(playwrightReport),
      "Objeto Playwright diverge dos bytes atestados",
    );
  }
  const attestationVerification = attestation
    ? verifyE2EReportAttestation({
        attestation,
        reportBytes,
        inventoryDigestSha256: contract.inventory.stableIdIndex.digestSha256,
        expectedContext: expectedAttestationContext,
        secret: attestationSecret,
        protocol,
      })
    : Object.freeze({ status: "missing" });
  const flattenedTests = flattenPlaywrightTests(playwrightReport, contract.rootDir);
  const plannedByCategory = new Map();
  const attemptedByCategory = new Map();
  const protocolExecutedByCategory = new Map();
  let unmatchedManifestCases = 0;
  for (const category of Object.keys(CATEGORY_DEFINITIONS)) {
    plannedByCategory.set(category, new Set());
    attemptedByCategory.set(category, new Set());
    protocolExecutedByCategory.set(category, new Set());
  }

  for (const testCase of contract.tests) {
    for (const claim of testCase.claims) plannedByCategory.get(claim.category).add(claim.claimId);
    const matchingTests = matchingReportTests(testCase, flattenedTests);
    if (matchingTests.length !== 1) {
      unmatchedManifestCases += 1;
      continue;
    }
    const [reportedTest] = matchingTests;
    const realResults = reportedTest.results.filter(validRealAttempt);
    for (const claim of testCase.claims) {
      const attemptDescriptor = {
        name: `${protocol.attemptAttachmentPrefix}${claim.claimId}`,
        contentType: protocol.attemptContentType,
        bodyMatches: (body) => attemptMatchesClaim(
          body, claim, testCase, contract.inventory.stableIdIndex.digestSha256, protocol,
        ),
      };
      const proofDescriptor = {
        name: `${protocol.proofAttachmentPrefix}${claim.claimId}`,
        contentType: protocol.proofContentType,
        bodyMatches: (body) => proofMatchesClaim(
          body, claim, testCase, contract.inventory.stableIdIndex.digestSha256, protocol,
        ),
      };
      if (realResults.some((result) => matchingAttachments(result, attemptDescriptor).length === 1)) {
        attemptedByCategory.get(claim.category).add(claim.claimId);
      }
      if (!testExecutionIsProtocolApproved(reportedTest)) continue;
      const [approvedResult] = reportedTest.results;
      if (
        matchingAttachments(approvedResult, attemptDescriptor).length === 1 &&
        matchingAttachments(approvedResult, proofDescriptor).length === 1
      ) protocolExecutedByCategory.get(claim.category).add(claim.claimId);
    }
  }

  const categories = {};
  for (const [category, definition] of Object.entries(CATEGORY_DEFINITIONS)) {
    const denominator = contract.inventory.recomputedQaDenominators[definition.denominatorKey];
    const plannedIds = [...plannedByCategory.get(category)].sort();
    const attemptedIds = [...attemptedByCategory.get(category)].sort();
    const protocolExecutedIds = [...protocolExecutedByCategory.get(category)].sort();
    const executedIds = attestationVerification.status === "verified" ? protocolExecutedIds : [];
    for (const [metric, ids] of Object.entries({ plannedIds, attemptedIds, protocolExecutedIds, executedIds })) {
      assertCondition(ids.length <= denominator, `${category}.${metric} excede o denominador recomputado`);
    }
    categories[category] = {
      denominator,
      planned: plannedIds.length,
      attempted: attemptedIds.length,
      protocolExecuted: protocolExecutedIds.length,
      executed: executedIds.length,
      plannedPercent: percent(plannedIds.length, denominator),
      attemptedPercent: percent(attemptedIds.length, denominator),
      protocolExecutedPercent: percent(protocolExecutedIds.length, denominator),
      executedPercent: percent(executedIds.length, denominator),
      claimIds: {
        planned: plannedIds,
        attempted: attemptedIds,
        protocolExecuted: protocolExecutedIds,
        executed: executedIds,
      },
    };
  }
  return {
    schemaVersion: 2,
    inventorySchemaVersion: contract.inventory.schemaVersion,
    inventoryDigestSha256: contract.inventory.stableIdIndex.digestSha256,
    attestation: attestationVerification,
    categories,
    diagnostics: { reportTests: flattenedTests.length, unmatchedManifestCases },
  };
}

function contextFromEnvironment(environment) {
  return validatedAttestationContext({
    commitSha: environment.E2E_CLAIM_COMMIT_SHA ?? environment.GITHUB_SHA,
    runId: environment.E2E_CLAIM_RUN_ID ?? environment.GITHUB_RUN_ID,
    issuer: environment.E2E_CLAIM_ISSUER ?? (environment.GITHUB_ACTIONS === "true" ? "github-actions" : undefined),
    repository: environment.E2E_CLAIM_REPOSITORY ?? environment.GITHUB_REPOSITORY,
    workflow: environment.E2E_CLAIM_WORKFLOW ?? environment.GITHUB_WORKFLOW_REF ?? environment.GITHUB_WORKFLOW,
    runAttempt: Number(environment.E2E_CLAIM_RUN_ATTEMPT ?? environment.GITHUB_RUN_ATTEMPT),
  }, "contexto CI");
}

function parseArguments(argv) {
  const options = {
    rootDir: process.cwd(), inventoryPath: "docs/audits/crm-surface-inventory.json",
    manifestsDir: "tests/e2e/coverage", reportPath: null, outputPath: null,
    attestationPath: null, signAttestation: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (["--root", "--inventory", "--manifests-dir", "--report", "--output", "--attestation"].includes(argument) && !value) {
      throw new Error(`${argument} exige um valor`);
    }
    if (argument === "--root") { options.rootDir = path.resolve(value); index += 1; }
    else if (argument === "--inventory") { options.inventoryPath = value; index += 1; }
    else if (argument === "--manifests-dir") { options.manifestsDir = value; index += 1; }
    else if (argument === "--report") { options.reportPath = path.resolve(value); index += 1; }
    else if (argument === "--output") { options.outputPath = path.resolve(value); index += 1; }
    else if (argument === "--attestation") { options.attestationPath = path.resolve(value); index += 1; }
    else if (argument === "--sign-attestation") options.signAttestation = true;
    else if (argument === "--help") return { help: true };
    else throw new Error(`Argumento desconhecido: ${argument}`);
  }
  return options;
}

function runCli() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(
      "Uso:\n" +
        "  pós-Playwright: node scripts/qa/report-e2e-coverage.mjs --sign-attestation --report REPORT.json --attestation SIDECAR.json\n" +
        "  relatório: node scripts/qa/report-e2e-coverage.mjs --report REPORT.json [--attestation SIDECAR.json] [--output JSON]\n",
    );
    return;
  }
  assertCondition(options.reportPath, "--report é obrigatório; manifests nunca são tratados como execução");
  const contract = loadCoverageContract(options);
  const protocol = protocolFrom(contract.rootDir);
  const reportBytes = readFileSync(options.reportPath);
  const playwrightReport = JSON.parse(reportBytes.toString("utf8"));
  if (options.signAttestation) {
    assertCondition(options.attestationPath, "--attestation é obrigatório como destino do sidecar");
    const protocolReport = buildE2ECoverageReport({ contract, playwrightReport, reportBytes, protocol });
    assertCondition(
      Object.values(protocolReport.categories).some((category) => category.protocolExecuted > 0),
      "Report sem execução protocolar válida não pode ser atestado",
    );
    const sidecar = createE2EReportAttestation({
      reportBytes,
      inventoryDigestSha256: contract.inventory.stableIdIndex.digestSha256,
      context: contextFromEnvironment(process.env),
      secret: process.env[ATTESTATION_KEY_ENV],
      protocol,
    });
    writeFileSync(options.attestationPath, `${JSON.stringify(sidecar, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify({ status: "signed", reportSha256: sidecar.reportSha256 }, null, 2)}\n`);
    return;
  }
  const attestation = options.attestationPath ? JSON.parse(readFileSync(options.attestationPath, "utf8")) : null;
  const report = buildE2ECoverageReport({
    contract, playwrightReport, reportBytes, attestation,
    attestationSecret: attestation ? process.env[ATTESTATION_KEY_ENV] : undefined,
    expectedAttestationContext: attestation ? contextFromEnvironment(process.env) : undefined,
    protocol,
  });
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (options.outputPath) writeFileSync(options.outputPath, serialized, "utf8");
  else process.stdout.write(serialized);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { runCli(); }
  catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
