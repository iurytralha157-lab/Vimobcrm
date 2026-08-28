import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const CLAIM_NAMESPACE = "vimob-e2e-claim/v1";
const MANIFEST_SUFFIX = ".claims.json";
const ID_PATTERN = /^(route|overlay|form|cta|control):[0-9a-f]{20}$/;
const CASE_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const CLAIM_ID_PATTERN = /^claim:[0-9a-f]{20}$/;

export const EXPECTED_INVENTORY_SCHEMA_VERSION = 3;
export const EXPECTED_INVENTORY_DIGEST =
  "d70d8932aac65155d36e9c39e656a281d312114dc0c45efa2989c95d5ae2bc6c";

export const CATEGORY_DEFINITIONS = Object.freeze({
  routeViewport: Object.freeze({
    denominatorKey: "renderableRouteViewportChecksDesktopAndMobile",
    inventoryPrefix: "route",
    requiredClaimKeys: ["claimId", "category", "inventoryId", "route", "viewport", "ready"],
  }),
});

const QA_DENOMINATOR_KEYS = Object.freeze([
  "aliasRedirectChecks",
  "errorInfrastructureCtaImplementations",
  "protectedAccessChecksThreePersonas",
  "renderableRouteViewportChecksDesktopAndMobile",
  "routeReachableFormImplementations",
  "routeReachableInternalCtaImplementations",
  "routeReachableOverlayImplementations",
  "routeReachableSupplementalOverlayAndTabControls",
]);

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertExactKeys(value, expectedKeys, context) {
  assertCondition(value && typeof value === "object" && !Array.isArray(value), `${context} deve ser um objeto`);
  const actualKeys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  assertCondition(
    JSON.stringify(actualKeys) === JSON.stringify(expected),
    `${context} possui chaves inválidas: esperado ${expected.join(", ")}; recebido ${actualKeys.join(", ")}`,
  );
}

function normalizeRepoPath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

function manifestFilesIn(directory) {
  assertCondition(existsSync(directory), `Diretório de manifests não encontrado: ${directory}`);
  const files = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile() && entry.name.endsWith(MANIFEST_SUFFIX)) {
        files.push(absolute);
      }
    }
  };
  visit(directory);
  return files.sort((left, right) => left.localeCompare(right));
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`JSON inválido em ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

export function deriveClaimId(caseId, claimWithoutId) {
  const canonicalClaim = canonicalize(
    Object.fromEntries(Object.entries(claimWithoutId).filter(([key]) => key !== "claimId")),
  );
  return `claim:${createHash("sha256")
    .update(`${CLAIM_NAMESPACE}\0${caseId}\0${JSON.stringify(canonicalClaim)}`)
    .digest("hex")
    .slice(0, 20)}`;
}

function recomputeStableIndexDigest(stableIdIndex) {
  assertExactKeys(
    stableIdIndex,
    [
      "schemaVersion",
      "algorithm",
      "namespace",
      "derivation",
      "routes",
      "routeReachableSurfaces",
      "digestSha256",
    ],
    "stableIdIndex",
  );
  const payload = { ...stableIdIndex };
  delete payload.digestSha256;
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function recomputeQaDenominators(inventory) {
  const stableRoutes = inventory.stableIdIndex.routes;
  const publicRoutes = inventory.routes;
  const surfaces = inventory.stableIdIndex.routeReachableSurfaces;
  assertCondition(Array.isArray(publicRoutes), "Inventário sem routes");
  assertExactKeys(surfaces, ["overlays", "forms", "internalCtas", "supplementalControls"], "routeReachableSurfaces");
  for (const [name, collection] of Object.entries(surfaces)) {
    assertCondition(Array.isArray(collection), `Coleção ${name} deve ser uma lista`);
  }

  const expectedPrefixes = {
    overlays: "overlay:",
    forms: "form:",
    internalCtas: "cta:",
    supplementalControls: "control:",
  };
  const implementationIds = new Set();
  for (const [name, collection] of Object.entries(surfaces)) {
    for (const item of collection) {
      assertCondition(
        typeof item?.id === "string" && item.id.startsWith(expectedPrefixes[name]),
        `ID inválido em ${name}: ${String(item?.id)}`,
      );
      assertCondition(!implementationIds.has(item.id), `Implementação duplicada no stableIdIndex: ${item.id}`);
      implementationIds.add(item.id);
    }
  }
  const routeIds = new Set();
  for (const route of stableRoutes) {
    assertCondition(typeof route?.id === "string" && route.id.startsWith("route:"), `ID de rota inválido: ${String(route?.id)}`);
    assertCondition(!routeIds.has(route.id), `Rota duplicada no stableIdIndex: ${route.id}`);
    routeIds.add(route.id);
  }

  const protectedRoutes = publicRoutes.filter((route) => route.access === "protected");
  for (const route of protectedRoutes) {
    assertCondition(
      typeof route.source === "string" && route.source.startsWith("app/(protected)/"),
      `Rota protected fora de app/(protected): ${String(route.url)}`,
    );
  }

  const infrastructureErrorFiles = inventory.diagnostics?.infrastructureSurfaceFiles;
  assertCondition(Array.isArray(infrastructureErrorFiles), "Inventário sem diagnostics.infrastructureSurfaceFiles");
  const uniqueInfrastructureErrors = new Set(
    infrastructureErrorFiles.filter((file) =>
      typeof file === "string" && /(?:^|\/)error\.tsx$/.test(file),
    ),
  );

  return Object.freeze({
    aliasRedirectChecks: stableRoutes.filter((route) => route.kind === "alias").length,
    // O schema 3 não fornece IDs dessas CTAs. Validamos o denominador estrutural,
    // mas a categoria permanece deliberadamente não executável neste protocolo.
    errorInfrastructureCtaImplementations: uniqueInfrastructureErrors.size,
    protectedAccessChecksThreePersonas: protectedRoutes.length * 3,
    renderableRouteViewportChecksDesktopAndMobile:
      stableRoutes.filter((route) => route.kind === "renderable").length * 2,
    routeReachableFormImplementations: surfaces.forms.length,
    routeReachableInternalCtaImplementations: surfaces.internalCtas.length,
    routeReachableOverlayImplementations: surfaces.overlays.length,
    routeReachableSupplementalOverlayAndTabControls: surfaces.supplementalControls.length,
  });
}

function validateInventory(inventory) {
  assertCondition(inventory?.schemaVersion === EXPECTED_INVENTORY_SCHEMA_VERSION, `Inventário deve usar schema ${EXPECTED_INVENTORY_SCHEMA_VERSION}`);
  assertCondition(inventory?.stableIdIndex && typeof inventory.stableIdIndex === "object", "Inventário sem stableIdIndex");
  const recomputedDigest = recomputeStableIndexDigest(inventory.stableIdIndex);
  assertCondition(
    recomputedDigest === inventory.stableIdIndex.digestSha256,
    `Digest armazenado do inventário não corresponde ao conteúdo recomputado: ${recomputedDigest}`,
  );
  assertCondition(
    recomputedDigest === EXPECTED_INVENTORY_DIGEST,
    `Digest do inventário divergente: esperado ${EXPECTED_INVENTORY_DIGEST}`,
  );
  assertCondition(Array.isArray(inventory.stableIdIndex.routes), "Inventário sem stableIdIndex.routes");
  assertCondition(inventory.qaDenominators && typeof inventory.qaDenominators === "object", "Inventário sem qaDenominators");
  assertExactKeys(inventory.qaDenominators, QA_DENOMINATOR_KEYS, "qaDenominators");
  const recomputedQaDenominators = recomputeQaDenominators(inventory);
  for (const key of QA_DENOMINATOR_KEYS) {
    assertCondition(
      inventory.qaDenominators[key] === recomputedQaDenominators[key],
      `Denominador ${key} divergente: armazenado ${inventory.qaDenominators[key]}; recomputado ${recomputedQaDenominators[key]}`,
    );
  }
  return Object.freeze({ ...inventory, recomputedQaDenominators });
}

export function validateInventoryDocument(inventory) {
  return validateInventory(inventory);
}

function validateRouteClaim(claim, routeById, publicRouteById, context) {
  const route = routeById.get(claim.inventoryId);
  const publicRoute = publicRouteById.get(claim.inventoryId);
  assertCondition(route, `${context}: ID de rota não existe no inventário: ${claim.inventoryId}`);
  assertCondition(publicRoute, `${context}: rota ausente da coleção detalhada: ${claim.inventoryId}`);
  assertCondition(route.url === claim.route, `${context}: ${claim.inventoryId} pertence a ${route.url}, não a ${claim.route}`);

  assertCondition(route.kind === "renderable", `${context}: routeViewport exige rota renderizável`);
  assertCondition(
    publicRoute.dynamic === false && !claim.route.includes("[") && !claim.route.includes("]"),
    `${context}: rotas dinâmicas não são executáveis no protocolo routeViewport v1`,
  );
  assertCondition(["desktop", "mobile"].includes(claim.viewport), `${context}: viewport deve ser desktop ou mobile`);
  assertExactKeys(claim.ready, ["role", "name"], `${context} ready`);
  assertCondition(claim.ready.role === "heading", `${context}: somente landmark heading é suportado`);
  assertCondition(typeof claim.ready.name === "string" && claim.ready.name.trim().length > 0, `${context}: ready.name inválido`);
}

function validateManifest(manifest, sourceFile, inventory, globalIds, globalDimensions) {
  const manifestLabel = normalizeRepoPath(sourceFile);
  assertExactKeys(
    manifest,
    ["schemaVersion", "inventorySchemaVersion", "inventoryDigestSha256", "tests"],
    manifestLabel,
  );
  assertCondition(manifest.schemaVersion === 2, `${manifestLabel}: schemaVersion deve ser 2`);
  assertCondition(manifest.inventorySchemaVersion === EXPECTED_INVENTORY_SCHEMA_VERSION, `${manifestLabel}: inventorySchemaVersion divergente`);
  assertCondition(manifest.inventoryDigestSha256 === EXPECTED_INVENTORY_DIGEST, `${manifestLabel}: inventoryDigestSha256 divergente`);
  assertCondition(Array.isArray(manifest.tests) && manifest.tests.length > 0, `${manifestLabel}: tests deve ser uma lista não vazia`);

  const routeById = new Map(inventory.stableIdIndex.routes.map((route) => [route.id, route]));
  const publicRouteById = new Map(inventory.routes.map((route) => [route.id, route]));
  const normalizedTests = [];

  manifest.tests.forEach((testCase, testIndex) => {
    const context = `${manifestLabel} tests[${testIndex}]`;
    assertExactKeys(testCase, ["caseId", "file", "titlePath", "projectName", "testKind", "claims"], context);
    assertCondition(typeof testCase.caseId === "string" && CASE_ID_PATTERN.test(testCase.caseId), `${context}: caseId inválido`);
    assertCondition(!globalIds.caseIds.has(testCase.caseId), `${context}: caseId duplicado: ${testCase.caseId}`);
    globalIds.caseIds.add(testCase.caseId);
    assertCondition(testCase.testKind === "ui", `${context}: apenas testes UI Playwright podem declarar claims UI`);
    assertCondition(typeof testCase.file === "string" && normalizeRepoPath(testCase.file).startsWith("tests/e2e/"), `${context}: file deve estar sob tests/e2e`);
    assertCondition(testCase.file.endsWith(".spec.ts"), `${context}: file deve apontar para um spec TypeScript`);
    assertCondition(
      Array.isArray(testCase.titlePath) && testCase.titlePath.length >= 1 && testCase.titlePath.every((title) => typeof title === "string" && title.length > 0),
      `${context}: titlePath inválido`,
    );
    assertCondition(typeof testCase.projectName === "string" && testCase.projectName.length > 0, `${context}: projectName inválido`);
    assertCondition(Array.isArray(testCase.claims) && testCase.claims.length > 0, `${context}: claims deve ser uma lista não vazia`);

    const normalizedClaims = testCase.claims.map((claim, claimIndex) => {
      const claimContext = `${context} claims[${claimIndex}]`;
      const definition = CATEGORY_DEFINITIONS[claim?.category];
      assertCondition(
        definition,
        `${claimContext}: somente routeViewport é executável no protocolo atual; recebido ${String(claim?.category)}`,
      );
      assertExactKeys(claim, definition.requiredClaimKeys, claimContext);
      assertCondition(typeof claim.claimId === "string" && CLAIM_ID_PATTERN.test(claim.claimId), `${claimContext}: claimId inválido`);
      assertCondition(!globalIds.claimIds.has(claim.claimId), `${claimContext}: claimId duplicado: ${claim.claimId}`);
      globalIds.claimIds.add(claim.claimId);
      assertCondition(typeof claim.inventoryId === "string" && ID_PATTERN.test(claim.inventoryId), `${claimContext}: inventoryId inválido`);
      assertCondition(claim.inventoryId.startsWith(`${definition.inventoryPrefix}:`), `${claimContext}: prefixo de inventoryId incompatível com ${claim.category}`);
      assertCondition(typeof claim.route === "string" && claim.route.startsWith("/"), `${claimContext}: route inválida`);
      const expectedClaimId = deriveClaimId(testCase.caseId, claim);
      assertCondition(claim.claimId === expectedClaimId, `${claimContext}: claimId deve ser ${expectedClaimId}`);

      validateRouteClaim(claim, routeById, publicRouteById, claimContext);

      const dimension = `${claim.category}\0${claim.inventoryId}\0${claim.viewport}`;
      assertCondition(!globalDimensions.has(dimension), `${claimContext}: dimensão de cobertura duplicada`);
      globalDimensions.add(dimension);
      return Object.freeze({ ...claim });
    });

    normalizedTests.push(
      Object.freeze({
        ...testCase,
        file: normalizeRepoPath(testCase.file),
        titlePath: Object.freeze([...testCase.titlePath]),
        claims: Object.freeze(normalizedClaims),
      }),
    );
  });

  return normalizedTests;
}

export function loadCoverageContract({
  rootDir = process.cwd(),
  inventoryPath = "docs/audits/crm-surface-inventory.json",
  manifestsDir = "tests/e2e/coverage",
} = {}) {
  const absoluteInventory = path.resolve(rootDir, inventoryPath);
  const absoluteManifests = path.resolve(rootDir, manifestsDir);
  const inventory = validateInventory(readJson(absoluteInventory));
  const manifestFiles = manifestFilesIn(absoluteManifests);
  assertCondition(manifestFiles.length > 0, `Nenhum manifest ${MANIFEST_SUFFIX} encontrado em ${absoluteManifests}`);

  const globalIds = { caseIds: new Set(), claimIds: new Set() };
  const globalDimensions = new Set();
  const tests = manifestFiles.flatMap((manifestFile) =>
    validateManifest(readJson(manifestFile), path.relative(rootDir, manifestFile), inventory, globalIds, globalDimensions),
  );
  const plannedByCategory = new Map();
  for (const testCase of tests) {
    for (const claim of testCase.claims) {
      plannedByCategory.set(claim.category, (plannedByCategory.get(claim.category) ?? 0) + 1);
    }
  }
  for (const [category, planned] of plannedByCategory) {
    const denominatorKey = CATEGORY_DEFINITIONS[category].denominatorKey;
    const denominator = inventory.recomputedQaDenominators[denominatorKey];
    assertCondition(
      planned <= denominator,
      `Claims planned de ${category} (${planned}) excedem o denominador recomputado (${denominator})`,
    );
  }

  return Object.freeze({
    rootDir: path.resolve(rootDir),
    inventory,
    inventoryPath: absoluteInventory,
    manifestFiles: Object.freeze(manifestFiles),
    tests: Object.freeze(tests),
  });
}

function resolveReportFile(report, file, rootDir) {
  const reportRoot = report?.config?.rootDir;
  const absolute = path.isAbsolute(file)
    ? file
    : path.resolve(reportRoot ? path.resolve(reportRoot) : path.join(rootDir, "tests/e2e"), file);
  return normalizeRepoPath(path.relative(rootDir, absolute));
}

export function flattenPlaywrightTests(report, rootDir = process.cwd()) {
  const flattened = [];

  const visit = (suite, inheritedTitles = []) => {
    const suiteFile = typeof suite?.file === "string" ? suite.file : "";
    const isFileWrapper =
      inheritedTitles.length === 0 && suiteFile && suite.title === path.basename(suiteFile.replaceAll("\\", "/"));
    const titles = suite?.title && !isFileWrapper ? [...inheritedTitles, suite.title] : inheritedTitles;

    for (const spec of Array.isArray(suite?.specs) ? suite.specs : []) {
      const file = resolveReportFile(report, spec.file || suiteFile, rootDir);
      for (const test of Array.isArray(spec.tests) ? spec.tests : []) {
        flattened.push({
          file,
          titlePath: [...titles, spec.title],
          projectName: test.projectName,
          expectedStatus: test.expectedStatus,
          status: test.status,
          results: Array.isArray(test.results) ? test.results : [],
          rawSpec: spec,
          rawTest: test,
        });
      }
    }

    for (const child of Array.isArray(suite?.suites) ? suite.suites : []) {
      visit(child, titles);
    }
  };

  for (const suite of Array.isArray(report?.suites) ? report.suites : []) {
    visit(suite);
  }
  return flattened;
}

function auditUiProofSource(source, fileName, testTitle) {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let matches = 0;
  let matchesWithPage = 0;
  let verifyCalls = 0;
  let awaitedVerifyCalls = 0;
  let helperImported = false;

  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      /(?:^|\/)tests\/e2e\/support\/e2e-claims$/.test(statement.moduleSpecifier.text) &&
      statement.importClause?.namedBindings &&
      ts.isNamedImports(statement.importClause.namedBindings) &&
      statement.importClause.namedBindings.elements.some(
        (element) =>
          (element.propertyName?.text ?? element.name.text) === "verifyRouteViewportClaim" &&
          element.name.text === "verifyRouteViewportClaim",
      )
    ) {
      helperImported = true;
    }
  }

  const countVerifyCalls = (callback) => {
    const visitCallback = (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "verifyRouteViewportClaim"
      ) {
        verifyCalls += 1;
        if (ts.isAwaitExpression(node.parent)) {
          awaitedVerifyCalls += 1;
        }
      }
      ts.forEachChild(node, visitCallback);
    };
    visitCallback(callback.body);
  };

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sourceFile);
      const titleArgument = node.arguments[0];
      const callback = node.arguments[1];
      if (
        /^(test|test\.(?:only|skip|fixme))$/.test(callee) &&
        titleArgument &&
        (ts.isStringLiteral(titleArgument) || ts.isNoSubstitutionTemplateLiteral(titleArgument)) &&
        titleArgument.text === testTitle &&
        callback &&
        (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
      ) {
        matches += 1;
        const firstParameter = callback.parameters[0];
        if (
          firstParameter &&
          ts.isObjectBindingPattern(firstParameter.name) &&
          firstParameter.name.elements.some((element) => ts.isIdentifier(element.name) && element.name.text === "page")
        ) {
          matchesWithPage += 1;
        }
        countVerifyCalls(callback);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { awaitedVerifyCalls, helperImported, matches, matchesWithPage, verifyCalls };
}

export function validateCoverageDiscovery(contract, discoveryReport) {
  const discovered = flattenPlaywrightTests(discoveryReport, contract.rootDir);
  const matchedKeys = new Set();
  const helperSource = readFileSync(
    path.resolve(contract.rootDir, "tests/e2e/support/e2e-claims.ts"),
    "utf8",
  );
  assertCondition(
    !helperSource.includes("E2E_CLAIM_ATTESTATION_KEY"),
    "O helper Playwright não pode conhecer a chave de attestation",
  );

  for (const testCase of contract.tests) {
    const matches = discovered.filter(
      (test) =>
        test.file === testCase.file &&
        test.projectName === testCase.projectName &&
        JSON.stringify(test.titlePath) === JSON.stringify(testCase.titlePath),
    );
    assertCondition(matches.length === 1, `${testCase.caseId}: discovery deve conter exatamente um teste; encontrado ${matches.length}`);

    const matchKey = `${testCase.file}\0${testCase.projectName}\0${testCase.titlePath.join("\0")}`;
    assertCondition(!matchedKeys.has(matchKey), `${testCase.caseId}: associação de discovery duplicada`);
    matchedKeys.add(matchKey);

    const absoluteSource = path.resolve(contract.rootDir, testCase.file);
    assertCondition(existsSync(absoluteSource), `${testCase.caseId}: arquivo de teste não encontrado: ${testCase.file}`);
    const testSource = readFileSync(absoluteSource, "utf8");
    assertCondition(
      !testSource.includes("E2E_CLAIM_ATTESTATION_KEY"),
      `${testCase.caseId}: o spec não pode conhecer a chave de attestation`,
    );
    const fixtureEvidence = auditUiProofSource(
      testSource,
      testCase.file,
      testCase.titlePath.at(-1),
    );
    assertCondition(fixtureEvidence.matches === 1, `${testCase.caseId}: título deve identificar exatamente um test() literal no arquivo`);
    assertCondition(fixtureEvidence.matchesWithPage === 1, `${testCase.caseId}: claims UI exigem o fixture Playwright page; testes API/unit não podem reivindicá-las`);
    assertCondition(
      fixtureEvidence.helperImported,
      `${testCase.caseId}: deve importar verifyRouteViewportClaim diretamente do helper oficial`,
    );
    assertCondition(
      fixtureEvidence.verifyCalls >= 1 && fixtureEvidence.awaitedVerifyCalls === fixtureEvidence.verifyCalls,
      `${testCase.caseId}: deve aguardar chamada a verifyRouteViewportClaim dentro do teste manifestado`,
    );
  }

  return Object.freeze({
    discoveredTests: discovered.length,
    manifestedTests: contract.tests.length,
    manifestedClaims: contract.tests.reduce((total, testCase) => total + testCase.claims.length, 0),
  });
}

export function readJsonFile(file) {
  return readJson(file);
}

export function protocolFrom(rootDir = process.cwd()) {
  const protocol = readJson(path.resolve(rootDir, "tests/e2e/coverage/protocol.json"));
  assertExactKeys(
    protocol,
    [
      "schemaVersion",
      "attemptKind",
      "attemptContentType",
      "attemptAttachmentPrefix",
      "proofKind",
      "proofContentType",
      "proofAttachmentPrefix",
      "attestationSchemaVersion",
      "attestationKind",
      "attestationAlgorithm",
    ],
    "protocolo E2E",
  );
  assertCondition(protocol.schemaVersion === 2, "Protocolo E2E deve usar schema 2");
  assertCondition(protocol.attestationSchemaVersion === 1, "Attestation E2E deve usar schema 1");
  return Object.freeze(protocol);
}
