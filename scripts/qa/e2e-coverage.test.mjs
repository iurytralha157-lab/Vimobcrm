import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  buildE2ECoverageReport,
  createE2EReportAttestation,
} from "./report-e2e-coverage.mjs";
import {
  loadCoverageContract,
  protocolFrom,
  validateCoverageDiscovery,
  validateInventoryDocument,
} from "../../tests/e2e/coverage/contract.mjs";
import { buildDiscoveryEnvironment } from "./validate-e2e-claims.mjs";

const rootDir = path.resolve(import.meta.dirname, "../..");
const contract = loadCoverageContract({ rootDir });
const protocol = protocolFrom(rootDir);
const [pilot] = contract.tests;
const attestationSecret = "test-only-attestation-key-with-more-than-32-bytes";
const attestationContext = Object.freeze({
  commitSha: "0123456789abcdef0123456789abcdef01234567",
  runId: "987654321",
  issuer: "synthetic-ci",
  repository: "vimob/vimob-crm",
  workflow: "release-e2e.yml",
  runAttempt: 1,
});

function encodedBody(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function attemptAttachment(claim, overrides = {}) {
  return {
    name: `${protocol.attemptAttachmentPrefix}${claim.claimId}`,
    contentType: protocol.attemptContentType,
    body: encodedBody({
      schemaVersion: protocol.schemaVersion,
      kind: protocol.attemptKind,
      inventoryDigestSha256: contract.inventory.stableIdIndex.digestSha256,
      caseId: pilot.caseId,
      claimId: claim.claimId,
      ...overrides,
    }),
  };
}

function validProofEvidence(claim, overrides = {}) {
  return {
    responseStatus: 200,
    bodyVisible: true,
    bodyTextLength: 120,
    noHorizontalOverflow: true,
    redirected: false,
    responsePath: claim.route,
    finalPath: claim.route,
    readyLandmarkVisible: true,
    stabilityFrames: 2,
    viewportWidth: 1366,
    viewportHeight: 768,
    ...overrides,
  };
}

function proofAttachment(claim, overrides = {}) {
  return {
    name: `${protocol.proofAttachmentPrefix}${claim.claimId}`,
    contentType: protocol.proofContentType,
    body: encodedBody({
      schemaVersion: protocol.schemaVersion,
      kind: protocol.proofKind,
      inventoryDigestSha256: contract.inventory.stableIdIndex.digestSha256,
      caseId: pilot.caseId,
      claimId: claim.claimId,
      category: claim.category,
      inventoryId: claim.inventoryId,
      route: claim.route,
      viewport: claim.viewport,
      ready: claim.ready,
      evidence: validProofEvidence(claim),
      ...overrides,
    }),
  };
}

function result({ status = "passed", retry = 0, attachments = [] } = {}) {
  return {
    workerIndex: 0,
    parallelIndex: 0,
    status,
    duration: 25,
    errors: [],
    stdout: [],
    stderr: [],
    retry,
    startTime: "2026-08-16T12:00:00.000Z",
    attachments,
  };
}

function playwrightReport({ outcome = "expected", expectedStatus = "passed", results = [], specOk = true } = {}) {
  return {
    config: { rootDir: path.join(rootDir, "tests/e2e") },
    suites: [
      {
        title: "auth-public-release.spec.ts",
        file: "auth-public-release.spec.ts",
        specs: [],
        suites: [
          {
            title: pilot.titlePath[0],
            file: "auth-public-release.spec.ts",
            specs: [
              {
                title: pilot.titlePath[1],
                ok: specOk,
                file: "auth-public-release.spec.ts",
                tests: [{
                  expectedStatus,
                  projectId: "chromium",
                  projectName: pilot.projectName,
                  results,
                  status: outcome,
                }],
              },
            ],
          },
        ],
      },
    ],
    errors: [],
  };
}

function reportFixture(options = {}) {
  const playwright = playwrightReport(options);
  return { playwright, bytes: Buffer.from(JSON.stringify(playwright), "utf8") };
}

function validAttachments() {
  return pilot.claims.flatMap((claim) => [attemptAttachment(claim), proofAttachment(claim)]);
}

function build({ playwright, bytes }, attestationOptions = {}) {
  return buildE2ECoverageReport({
    contract,
    playwrightReport: playwright,
    reportBytes: bytes,
    protocol,
    ...attestationOptions,
  });
}

function sign(bytes, context = attestationContext, secret = attestationSecret) {
  return createE2EReportAttestation({
    reportBytes: bytes,
    inventoryDigestSha256: contract.inventory.stableIdIndex.digestSha256,
    context,
    secret,
    protocol,
  });
}

function metrics(report) {
  return report.categories.routeViewport;
}

test("inventário tem digest e todos os denominadores recomputados, não confiados", () => {
  assert.equal(
    contract.inventory.stableIdIndex.digestSha256,
    "d70d8932aac65155d36e9c39e656a281d312114dc0c45efa2989c95d5ae2bc6c",
  );
  assert.deepEqual(contract.inventory.recomputedQaDenominators, contract.inventory.qaDenominators);

  const changedIndex = structuredClone(contract.inventory);
  changedIndex.stableIdIndex.routes[0].url = "/conteudo-adulterado";
  assert.throws(() => validateInventoryDocument(changedIndex), /não corresponde ao conteúdo recomputado/);

  const changedDenominator = structuredClone(contract.inventory);
  changedDenominator.qaDenominators.renderableRouteViewportChecksDesktopAndMobile += 1;
  assert.throws(() => validateInventoryDocument(changedDenominator), /Denominador .* divergente/);
});

test("discovery Playwright recebe ambiente sem a chave de attestation", () => {
  const childEnvironment = buildDiscoveryEnvironment({
    E2E_CLAIM_ATTESTATION_KEY: "must-not-reach-worker",
    KEEP_ME: "ok",
  });
  assert.equal(childEnvironment.E2E_CLAIM_ATTESTATION_KEY, undefined);
  assert.equal(childEnvironment.E2E_DISCOVERY_ONLY, "true");
  assert.equal(childEnvironment.KEEP_ME, "ok");
});

test("manifest e --list permanecem somente planned", () => {
  const report = build(reportFixture({ outcome: "skipped", results: [] }));
  assert.equal(metrics(report).planned, 4);
  assert.equal(metrics(report).attempted, 0);
  assert.equal(metrics(report).protocolExecuted, 0);
  assert.equal(metrics(report).executed, 0);
  assert.equal(report.attestation.status, "missing");
  assert.deepEqual(Object.keys(report.categories), ["routeViewport"]);
});

test("resultado skipped nunca entra no numerador mesmo com attachments", () => {
  const report = build(reportFixture({
    outcome: "skipped",
    results: [result({ status: "skipped", attachments: validAttachments() })],
  }));
  assert.equal(metrics(report).attempted, 0);
  assert.equal(metrics(report).protocolExecuted, 0);
  assert.equal(metrics(report).executed, 0);
});

test("passed sem attachments conta zero", () => {
  const report = build(reportFixture({ results: [result()] }));
  assert.equal(metrics(report).attempted, 0);
  assert.equal(metrics(report).protocolExecuted, 0);
  assert.equal(metrics(report).executed, 0);
});

test("retry/flaky conta tentativa, mas não execução protocolar", () => {
  const attachments = validAttachments();
  const report = build(reportFixture({
    outcome: "flaky",
    results: [
      result({ status: "failed", retry: 0, attachments }),
      result({ status: "passed", retry: 1, attachments }),
    ],
  }));
  assert.equal(metrics(report).attempted, 4);
  assert.equal(metrics(report).protocolExecuted, 0);
  assert.equal(metrics(report).executed, 0);
});

test("proof estranho conta zero protocolExecuted", () => {
  const attachments = pilot.claims.flatMap((claim) => [
    attemptAttachment(claim),
    proofAttachment(claim, { caseId: "foreign.case" }),
  ]);
  const report = build(reportFixture({ results: [result({ attachments })] }));
  assert.equal(metrics(report).attempted, 4);
  assert.equal(metrics(report).protocolExecuted, 0);
  assert.equal(metrics(report).executed, 0);
});

test("proof com redirect, final path divergente ou body vazio é rejeitado", () => {
  const invalidProofs = [
    proofAttachment(pilot.claims[0], { evidence: validProofEvidence(pilot.claims[0], { redirected: true }) }),
    proofAttachment(pilot.claims[1], { evidence: validProofEvidence(pilot.claims[1], { finalPath: "/login" }) }),
    proofAttachment(pilot.claims[2], { evidence: validProofEvidence(pilot.claims[2], { bodyTextLength: 0 }) }),
    proofAttachment(pilot.claims[3], { evidence: validProofEvidence(pilot.claims[3], { readyLandmarkVisible: false }) }),
  ];
  const attachments = pilot.claims.flatMap((claim, index) => [attemptAttachment(claim), invalidProofs[index]]);
  const report = build(reportFixture({ results: [result({ attachments })] }));
  assert.equal(metrics(report).attempted, 4);
  assert.equal(metrics(report).protocolExecuted, 0);
  assert.equal(metrics(report).executed, 0);
});

test("proof sem attachment de tentativa não conta nem attempted nem protocolExecuted", () => {
  const attachments = pilot.claims.map((claim) => proofAttachment(claim));
  const report = build(reportFixture({ results: [result({ attachments })] }));
  assert.equal(metrics(report).attempted, 0);
  assert.equal(metrics(report).protocolExecuted, 0);
  assert.equal(metrics(report).executed, 0);
});

test("JSON fabricado com proofs válidos, mas sem attestation, mantém executed oficial em zero", () => {
  const fixture = reportFixture({ results: [result({ attachments: validAttachments() })] });
  const report = build(fixture);
  assert.equal(metrics(report).attempted, 4);
  assert.equal(metrics(report).protocolExecuted, 4);
  assert.equal(metrics(report).executed, 0);
  assert.deepEqual(metrics(report).claimIds.executed, []);
});

test("attestation com assinatura inválida falha fechado", () => {
  const fixture = reportFixture({ results: [result({ attachments: validAttachments() })] });
  const attestation = { ...sign(fixture.bytes), signature: "0".repeat(64) };
  assert.throws(
    () => build(fixture, {
      attestation,
      attestationSecret,
      expectedAttestationContext: attestationContext,
    }),
    /Assinatura HMAC inválida/,
  );
});

test("attestation stale de outro runId falha fechado", () => {
  const fixture = reportFixture({ results: [result({ attachments: validAttachments() })] });
  const attestation = sign(fixture.bytes);
  assert.throws(
    () => build(fixture, {
      attestation,
      attestationSecret,
      expectedAttestationContext: { ...attestationContext, runId: "new-run" },
    }),
    /stale: runId diverge/,
  );
});

test("alterar um byte do report depois da assinatura falha fechado", () => {
  const fixture = reportFixture({ results: [result({ attachments: validAttachments() })] });
  const attestation = sign(fixture.bytes);
  assert.throws(
    () => build({ ...fixture, bytes: Buffer.concat([fixture.bytes, Buffer.from(" ")]) }, {
      attestation,
      attestationSecret,
      expectedAttestationContext: attestationContext,
    }),
    /stale: reportSha256 diverge/,
  );
});

test("objeto Playwright diferente dos bytes assinados falha fechado", () => {
  const fixture = reportFixture({ results: [result({ attachments: validAttachments() })] });
  const attestation = sign(fixture.bytes);
  const differentObject = structuredClone(fixture.playwright);
  differentObject.errors = [{ message: "fabricated" }];
  assert.throws(
    () => build({ ...fixture, playwright: differentObject }, {
      attestation,
      attestationSecret,
      expectedAttestationContext: attestationContext,
    }),
    /Objeto Playwright diverge dos bytes atestados/,
  );
});

test("sidecar HMAC válido promove as quatro claims protocolExecuted para executed oficial", () => {
  const fixture = reportFixture({ results: [result({ attachments: validAttachments() })] });
  const attestation = sign(fixture.bytes);
  const report = build(fixture, {
    attestation,
    attestationSecret,
    expectedAttestationContext: attestationContext,
  });
  assert.equal(report.attestation.status, "verified");
  assert.equal(metrics(report).protocolExecuted, 4);
  assert.equal(metrics(report).executed, 4);
  assert.deepEqual(metrics(report).claimIds.executed, pilot.claims.map((claim) => claim.claimId).sort());
});

test("teste request/API não pode reivindicar claim UI", () => {
  const apiOnlyTitle = "payloads inválidos retornam 400 e no-store";
  const apiOnlyContract = {
    ...contract,
    tests: [{ ...pilot, caseId: "auth-public-release.api-cannot-claim-ui", titlePath: [pilot.titlePath[0], apiOnlyTitle] }],
  };
  const discovery = playwrightReport();
  discovery.suites[0].suites[0].specs[0].title = apiOnlyTitle;
  assert.throws(
    () => validateCoverageDiscovery(apiOnlyContract, discovery),
    /fixture Playwright page; testes API\/unit não podem reivindicá-las/,
  );
});

test("teste UI sem import e chamada aguardada ao helper oficial é rejeitado", () => {
  const uiTitle = "desktop inicia recolhido e fecha novamente depois da navegacao";
  const uiWithoutHelperContract = {
    ...contract,
    tests: [{
      ...pilot,
      caseId: "navigation-shell.ui-without-proof-helper",
      file: "tests/e2e/navigation-shell.spec.ts",
      titlePath: ["navegacao principal", uiTitle],
    }],
  };
  const discovery = playwrightReport();
  discovery.suites[0].title = "navigation-shell.spec.ts";
  discovery.suites[0].file = "navigation-shell.spec.ts";
  discovery.suites[0].suites[0].title = "navegacao principal";
  discovery.suites[0].suites[0].file = "navigation-shell.spec.ts";
  discovery.suites[0].suites[0].specs[0].title = uiTitle;
  discovery.suites[0].suites[0].specs[0].file = "navigation-shell.spec.ts";

  assert.throws(
    () => validateCoverageDiscovery(uiWithoutHelperContract, discovery),
    /deve importar verifyRouteViewportClaim diretamente do helper oficial/,
  );
});
