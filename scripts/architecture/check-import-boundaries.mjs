import { readFileSync, readdirSync } from "node:fs";
import { join, posix } from "node:path";
import ts from "typescript";
import { readGoSource } from "./go-source-inventory.mjs";

const frontendRoots = ["components/features", "components/shared", "components/ui", "hooks"];
const sourceFile = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const testFile = /(?:\.(?:test|spec|d)\.[^.]+$|\/(?:__tests__|__fixtures__)\/)/;
const internalGoPrefix = "github.com/vimob-crm/vimob-crm/apps/api/internal/";
const infrastructure = new Set([
  "httpserver", "tenant", "pgvalue", "jsonvalue", "phonenumber", "searchtext",
  "numericinput", "config", "supabasehttp", "authorization", "permissions",
]);
const distributionClients = new Set(["leads", "meta", "portals", "webhooks"]);

function frontendDomain(path) {
  if (path.startsWith("components/features/")) {
    const [, , domain, ...interior] = path.split("/");
    return { domain, layer: "feature", publicEntry: !interior.length || interior.join("/") === "index" };
  }
  if (path.startsWith("hooks/") && !path.startsWith("hooks/shared/")) {
    const [, domain, ...interior] = path.split("/");
    return { domain, layer: "hook", publicEntry: !interior.length || interior.join("/") === "index" };
  }
  return null;
}

export function frontendViolation(from, importPath, hookDomains = new Set()) {
  let target;
  if (importPath.startsWith("@/")) target = posix.normalize(importPath.slice(2));
  else if (importPath.startsWith(".")) target = posix.normalize(posix.join(posix.dirname(from), importPath));
  else return null;
  target = target.replace(sourceFile, "");
  const source = from.startsWith("hooks/") && from.split("/").length === 2 ? null : frontendDomain(from);
  const destination = frontendDomain(target);
  if (from.startsWith("components/shared/") &&
      (target === "components/features" || destination?.layer === "feature")) return target;
  if (from.startsWith("components/ui/") &&
      /^(?:app|contexts|hooks|integrations|services|stores|components\/(?:features|shared)|lib\/(?:api|validation))(?:\/|$)/.test(target)) {
    return target;
  }
  if (!source || !destination || source.domain === destination.domain) return null;
  if (source.domain === "dashboard" && (destination.layer === "feature" || hookDomains.has(destination.domain))) {
    return target;
  }
  return destination.publicEntry ? null : target;
}

export function importSpecifiers(source, file) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false);
  if (tree.parseDiagnostics.length) {
    throw new Error(`${file}: ${ts.flattenDiagnosticMessageText(tree.parseDiagnostics[0].messageText, "\n")}`);
  }
  const imports = [];
  function visit(node) {
    let literal;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) literal = node.moduleSpecifier;
    else if (ts.isExternalModuleReference(node)) literal = node.expression;
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) literal = node.argument.literal;
    else if (ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === "require"))) literal = node.arguments[0];
    if (literal && ts.isStringLiteralLike(literal)) {
      imports.push({ value: literal.text, line: tree.getLineAndCharacterOfPosition(literal.getStart(tree)).line + 1 });
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return imports;
}

export function goViolation(file, importPath) {
  if (!importPath.startsWith(internalGoPrefix)) return null;
  const importedPackage = importPath.slice(internalGoPrefix.length);
  const from = posix.dirname(file);
  const domain = from.split("/")[0];
  const targetDomain = importedPackage.split("/")[0];
  if (domain === "app" || domain === targetDomain || infrastructure.has(importedPackage)) return null;
  if (importedPackage === "distribution" && distributionClients.has(domain)) return null;
  return `${from} -> ${importedPackage}`;
}

function frontendFiles(root, path) {
  const files = [];
  for (const entry of readdirSync(join(root, path), { withFileTypes: true })) {
    const name = posix.join(path, entry.name);
    if (entry.isDirectory()) files.push(...frontendFiles(root, name));
    else if (entry.isFile() && sourceFile.test(name) && !testFile.test(name)) files.push(name);
  }
  return files;
}

function inspect(root) {
  const hookDomains = new Set(readdirSync(join(root, "hooks"), { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== "shared").map(entry => entry.name));
  const frontend = new Map();
  for (const file of frontendRoots.flatMap(path => frontendFiles(root, path)).sort()) {
    const source = readFileSync(join(root, file), "utf8");
    for (const { value, line } of importSpecifiers(source, file)) {
      const target = frontendViolation(file, value, hookDomains);
      if (target) frontend.set(`${file} -> ${target}`, `${file}:${line}`);
    }
  }
  const go = new Map();
  for (const { file, line, value } of readGoSource("imports", join(root, "apps/api/internal"))) {
    const edge = goViolation(file, value);
    if (edge) go.set(edge, `apps/api/internal/${file}:${line}`);
  }
  return { frontend, go };
}

export function compareBoundary(baseline, edges) {
  const known = new Set(baseline);
  return {
    additions: [...edges].filter(([edge]) => !known.has(edge)),
    resolved: baseline.filter(edge => !edges.has(edge)),
  };
}

function main() {
  const reportOnly = process.argv[2] === "--report";
  const edges = inspect(reportOnly && process.argv[3] ? process.argv[3] : process.cwd());
  if (reportOnly) {
    console.log(JSON.stringify(Object.fromEntries(
      Object.entries(edges).map(([kind, violations]) => [kind, [...violations.keys()].sort()]),
    ), null, 2));
    return;
  }
  const baseline = JSON.parse(readFileSync(new URL("./import-boundary-baseline.json", import.meta.url), "utf8"));
  for (const kind of ["frontend", "go"]) {
    const { additions, resolved } = compareBoundary(baseline[kind], edges[kind]);
    if (additions.length || resolved.length) {
      console.error(`${kind}: ${additions.length} new, ${resolved.length} resolved\n` +
        [...additions.map(([edge, position]) => `+ ${position}: ${edge}`),
          ...resolved.map(edge => `- ${edge}`)].join("\n"));
      process.exitCode = 1;
    }
  }
  if (!process.exitCode) {
    console.log(`Import boundaries: ${edges.frontend.size} legacy frontend imports and ${edges.go.size} legacy Go package edges.`);
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
