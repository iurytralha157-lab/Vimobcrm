#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const ROOT = process.cwd();
const APP_DIR = path.join(ROOT, "app");
const REPORT_DIR = path.join(ROOT, "docs", "audits");
const JSON_REPORT = path.join(REPORT_DIR, "crm-surface-inventory.json");
const MARKDOWN_REPORT = path.join(REPORT_DIR, "crm-surface-inventory.md");

const SOURCE_ROOTS = [
  "app",
  "components",
  "config",
  "contexts",
  "hooks",
  "i18n",
  "integrations",
  "lib",
  "stores",
];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const ROUTE_INFRASTRUCTURE_NAMES = new Set([
  "error.tsx",
  "global-error.tsx",
  "layout.tsx",
  "loading.tsx",
  "not-found.tsx",
  "template.tsx",
]);
const OVERLAY_ROOTS = new Map([
  ["components/ui/dialog.tsx", new Map([["Dialog", "dialog"]])],
  ["components/ui/alert-dialog.tsx", new Map([["AlertDialog", "alertDialog"]])],
  ["components/ui/sheet.tsx", new Map([["Sheet", "sheet"]])],
  ["components/ui/dropdown-menu.tsx", new Map([["DropdownMenu", "dropdownMenu"]])],
  ["components/ui/popover.tsx", new Map([["Popover", "popover"]])],
]);
const INTERACTION_PRIMITIVES = new Map([
  ["components/ui/dialog.tsx", new Set(["DialogTrigger", "DialogClose"])],
  [
    "components/ui/alert-dialog.tsx",
    new Set(["AlertDialogTrigger", "AlertDialogAction", "AlertDialogCancel"]),
  ],
  ["components/ui/sheet.tsx", new Set(["SheetTrigger", "SheetClose"])],
  [
    "components/ui/dropdown-menu.tsx",
    new Set([
      "DropdownMenuTrigger",
      "DropdownMenuItem",
      "DropdownMenuCheckboxItem",
      "DropdownMenuRadioItem",
      "DropdownMenuSubTrigger",
    ]),
  ],
  ["components/ui/popover.tsx", new Set(["PopoverTrigger"])],
  ["components/ui/tabs.tsx", new Set(["TabsTrigger"])],
]);

const argv = new Set(process.argv.slice(2));
const writeReports = argv.has("--write");
const checkReports = argv.has("--check");
const printDetails = argv.has("--details");

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function relative(file) {
  return toPosix(path.relative(ROOT, file));
}

const STABLE_ID_NAMESPACE = "vimob-crm-surface/v1";
const STABLE_ID_HEX_LENGTH = 20;

function stableId(type, fields) {
  const canonicalKey = [STABLE_ID_NAMESPACE, type, ...fields.map(String)].join("\0");
  const digest = crypto.createHash("sha256").update(canonicalKey).digest("hex");
  return `${type}:${digest.slice(0, STABLE_ID_HEX_LENGTH)}`;
}

function walk(directory) {
  if (!fs.existsSync(directory)) return [];

  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(absolute));
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(absolute);
    }
  }
  return files;
}

const sourceFiles = SOURCE_ROOTS.flatMap((directory) => walk(path.join(ROOT, directory)))
  .map((file) => path.normalize(file))
  .sort((left, right) => relative(left).localeCompare(relative(right)));
const sourceFileSet = new Set(sourceFiles);
const sourceTextByFile = new Map(sourceFiles.map((file) => [file, fs.readFileSync(file, "utf8")]));
const astByFile = new Map(
  sourceFiles.map((file) => [
    file,
    ts.createSourceFile(
      file,
      sourceTextByFile.get(file),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    ),
  ]),
);

function resolveLocalModule(fromFile, specifier) {
  let base;
  if (specifier.startsWith("@/")) {
    base = path.join(ROOT, specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else {
    return null;
  }

  const candidates = path.extname(base)
    ? [base]
    : [
        `${base}.ts`,
        `${base}.tsx`,
        path.join(base, "index.ts"),
        path.join(base, "index.tsx"),
      ];
  return candidates.map(path.normalize).find((candidate) => sourceFileSet.has(candidate)) ?? null;
}

function collectModuleSpecifiers(sourceFile) {
  const specifiers = [];
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}

const dependencyGraph = new Map(
  sourceFiles.map((file) => [
    file,
    [...new Set(
      collectModuleSpecifiers(astByFile.get(file))
        .map((specifier) => resolveLocalModule(file, specifier))
        .filter(Boolean),
    )].sort((left, right) => relative(left).localeCompare(relative(right))),
  ]),
);

function routeFromPage(pageFile) {
  const relativePage = relative(pageFile);
  const directoryParts = relativePage.split("/").slice(1, -1);
  const urlParts = directoryParts.filter(
    (part) => !(part.startsWith("(") && part.endsWith(")")) && !part.startsWith("@"),
  );
  return urlParts.length === 0 ? "/" : `/${urlParts.join("/")}`;
}

function classifyAccess(relativePage) {
  const parts = relativePage.split("/");
  if (parts.includes("(protected)")) return "protected";
  if (parts.includes("(auth)")) return "auth";
  if (parts.includes("(public-site)")) return "publicSite";
  return "public";
}

function getRedirectCalls(file) {
  const sourceFile = astByFile.get(file);
  const redirectLocals = new Set();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "next/navigation" ||
      !statement.importClause?.namedBindings ||
      !ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      continue;
    }
    for (const element of statement.importClause.namedBindings.elements) {
      if ((element.propertyName?.text ?? element.name.text) === "redirect") {
        redirectLocals.add(element.name.text);
      }
    }
  }

  const calls = [];
  let jsxCount = 0;
  const visit = (node) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) jsxCount += 1;
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      redirectLocals.has(node.expression.text)
    ) {
      const argument = node.arguments[0];
      let target = null;
      if (argument && ts.isStringLiteralLike(argument)) target = argument.text;
      else if (argument) target = argument.getText(sourceFile);
      calls.push(target ?? "<missing>");
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { calls, redirectOnly: calls.length > 0 && jsxCount === 0 };
}

function routeRoots(pageFile) {
  const roots = [pageFile];
  let directory = path.dirname(pageFile);
  while (directory.startsWith(APP_DIR)) {
    for (const name of ["layout.tsx", "template.tsx"]) {
      const candidate = path.normalize(path.join(directory, name));
      if (sourceFileSet.has(candidate)) roots.push(candidate);
    }
    if (directory === APP_DIR) break;
    directory = path.dirname(directory);
  }
  return [...new Set(roots)];
}

function reachableFrom(roots) {
  const visited = new Set();
  const pending = [...roots];
  while (pending.length > 0) {
    const file = pending.pop();
    if (!file || visited.has(file)) continue;
    visited.add(file);
    for (const dependency of dependencyGraph.get(file) ?? []) pending.push(dependency);
  }
  return visited;
}

const pageFiles = sourceFiles.filter(
  (file) => file.startsWith(`${APP_DIR}${path.sep}`) && path.basename(file) === "page.tsx",
);
const routes = pageFiles
  .map((file) => {
    const source = relative(file);
    const url = routeFromPage(file);
    const redirect = getRedirectCalls(file);
    const dynamicSegments = [...url.matchAll(/\[+[^\]]+\]+/g)].map((match) => match[0]);
    const access = classifyAccess(source);
    const alias = redirect.redirectOnly;
    return {
      access,
      admin: access === "protected" && (url === "/admin" || url.startsWith("/admin/")),
      alias,
      catchAll: dynamicSegments.some((segment) => segment.includes("...")),
      dynamic: dynamicSegments.length > 0,
      dynamicSegments,
      id: stableId("route", [source, alias ? "alias" : "renderable", url]),
      optionalCatchAll: dynamicSegments.some((segment) => segment.startsWith("[[...")),
      redirectTargets: redirect.calls,
      source,
      url,
      _file: file,
      _reachable: reachableFrom(routeRoots(file)),
    };
  })
  .sort((left, right) => left.url.localeCompare(right.url));

const routeCollisions = [];
const routesByUrl = new Map();
for (const route of routes) {
  const existing = routesByUrl.get(route.url) ?? [];
  existing.push(route.source);
  routesByUrl.set(route.url, existing);
}
for (const [url, sources] of routesByUrl) {
  if (sources.length > 1) routeCollisions.push({ sources: sources.sort(), url });
}

function importedBindings(file) {
  const sourceFile = astByFile.get(file);
  const result = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) {
      continue;
    }
    const specifier = statement.moduleSpecifier.text;
    const resolved = resolveLocalModule(file, specifier);
    const importClause = statement.importClause;
    if (!importClause) continue;
    if (importClause.name) {
      result.push({ imported: "default", local: importClause.name.text, resolved, specifier });
    }
    if (importClause.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
      for (const element of importClause.namedBindings.elements) {
        result.push({
          imported: element.propertyName?.text ?? element.name.text,
          local: element.name.text,
          resolved,
          specifier,
        });
      }
    }
  }
  return result;
}

function jsxTagName(node) {
  const tag = ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName;
  return ts.isIdentifier(tag) ? tag.text : tag.getText();
}

function jsxAttributes(node) {
  return ts.isJsxElement(node) ? node.openingElement.attributes : node.attributes;
}

function hasTruthyAttribute(node, name) {
  const attribute = jsxAttributes(node).properties.find(
    (item) => ts.isJsxAttribute(item) && item.name.text === name,
  );
  if (!attribute || !ts.isJsxAttribute(attribute)) return false;
  if (!attribute.initializer) return true;
  if (
    ts.isJsxExpression(attribute.initializer) &&
    attribute.initializer.expression?.kind === ts.SyntaxKind.FalseKeyword
  ) {
    return false;
  }
  return true;
}

function getAttribute(node, name) {
  const attribute = jsxAttributes(node).properties.find(
    (item) => ts.isJsxAttribute(item) && item.name.text === name,
  );
  if (!attribute || !ts.isJsxAttribute(attribute) || !attribute.initializer) return null;
  if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer.text;
  if (ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression) {
    const expression = attribute.initializer.expression;
    if (ts.isStringLiteralLike(expression)) return expression.text;
    return { expression: expression.getText() };
  }
  return { expression: attribute.initializer.getText() };
}

function directJsxChildTag(node) {
  if (!ts.isJsxElement(node)) return null;
  const child = node.children.find(
    (item) => ts.isJsxElement(item) || ts.isJsxSelfClosingElement(item),
  );
  return child ? jsxTagName(child) : null;
}

function hasDescendantJsxTag(node, allowedTags) {
  let found = false;
  const visit = (child) => {
    if (found) return;
    if (
      child !== node &&
      (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) &&
      allowedTags.has(jsxTagName(child))
    ) {
      found = true;
      return;
    }
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(node, visit);
  return found;
}

function navigationKind(href, assumeInternal) {
  if (typeof href === "string") {
    if (/^(?:https?:)?\/\//i.test(href) || /^(?:mailto|tel):/i.test(href)) return "external";
    return "internal";
  }
  if (href && typeof href.expression === "string") {
    if (/^[`'"](?:https?:)?\/\//i.test(href.expression)) return "external";
    return assumeInternal ? "internalDynamic" : "unknownDynamic";
  }
  return assumeInternal ? "internalDynamic" : "unknownDynamic";
}

function locationFor(sourceFile, node, extra = {}) {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return {
    column: position.character + 1,
    file: relative(sourceFile.fileName),
    line: position.line + 1,
    ...extra,
  };
}

function identifiedLocationFor(type, sourceFile, node, extra = {}) {
  const location = locationFor(sourceFile, node, extra);
  return {
    id: stableId(type, [location.file, location.line, location.column]),
    ...location,
  };
}

function owningDeclaration(node) {
  let current = node.parent;
  while (current) {
    if (ts.isFunctionDeclaration(current) && current.name) return current.name.text;
    if (ts.isMethodDeclaration(current) && current.name) return current.name.getText();
    if (
      (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
      ts.isVariableDeclaration(current.parent) &&
      ts.isIdentifier(current.parent.name)
    ) {
      return current.parent.name.text;
    }
    current = current.parent;
  }
  return "<module>";
}

const productSurfaceFiles = sourceFiles.filter((file) => {
  const source = relative(file);
  return (
    (source.startsWith("app/") || source.startsWith("components/")) &&
    source.endsWith(".tsx") &&
    !source.startsWith("components/ui/")
  );
});
const routeUrlsByReachableFile = new Map();
for (const route of routes) {
  for (const file of route._reachable) {
    const urls = routeUrlsByReachableFile.get(file) ?? new Set();
    urls.add(route.url);
    routeUrlsByReachableFile.set(file, urls);
  }
}
const routeByURL = new Map(routes.map((route) => [route.url, route]));
const routeReachabilityBySurfaceFile = productSurfaceFiles
  .map((file) => {
    const urls = [...(routeUrlsByReachableFile.get(file) ?? [])].sort();
    if (urls.length === 0) return null;
    const access = [...new Set(
      urls
        .map((url) => routeByURL.get(url)?.access)
        .filter((value) => typeof value === "string"),
    )].sort();
    return {
      access,
      file: relative(file),
      routes: urls,
    };
  })
  .filter(Boolean)
  .sort((left, right) => left.file.localeCompare(right.file));

const overlays = [];
const forms = [];
const ctas = [];
const supplementalControls = [];
const asChildButtonDelegates = [];
const asChildPrimitiveDelegates = [];
let asChildButtonsExcluded = 0;
let asChildPrimitiveControlsExcluded = 0;

for (const file of productSurfaceFiles) {
  const sourceFile = astByFile.get(file);
  const bindings = importedBindings(file);
  const overlayBindings = new Map();
  const buttonBindings = new Set();
  const linkBindings = new Set();
  const primitiveBindings = new Map();

  for (const binding of bindings) {
    const resolved = binding.resolved ? relative(binding.resolved) : null;
    const overlayExports = resolved ? OVERLAY_ROOTS.get(resolved) : null;
    if (overlayExports?.has(binding.imported)) {
      overlayBindings.set(binding.local, overlayExports.get(binding.imported));
    }
    if (resolved === "components/ui/button.tsx" && binding.imported === "Button") {
      buttonBindings.add(binding.local);
    }
    if (binding.specifier === "next/link" && binding.imported === "default") {
      linkBindings.add(binding.local);
    }
    const primitiveExports = resolved ? INTERACTION_PRIMITIVES.get(resolved) : null;
    if (primitiveExports?.has(binding.imported)) {
      primitiveBindings.set(binding.local, binding.imported);
    }
  }

  const visit = (node) => {
    const isJsx = ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node);
    if (isJsx) {
      const tag = jsxTagName(node);
      const owner = owningDeclaration(node);
      const routeAssociations = [...(routeUrlsByReachableFile.get(file) ?? [])].sort();
      const shared = { owner, routes: routeAssociations };

      if (overlayBindings.has(tag)) {
        overlays.push(
          identifiedLocationFor("overlay", sourceFile, node, {
            ...shared,
            kind: overlayBindings.get(tag),
          }),
        );
      }

      if (tag === "form") {
        const action = getAttribute(node, "action");
        const onSubmit = getAttribute(node, "onSubmit");
        forms.push(
          identifiedLocationFor("form", sourceFile, node, {
            ...shared,
            action: action ? (typeof action === "string" ? action : action.expression) : null,
            hasSubmitHandler: Boolean(action || onSubmit),
          }),
        );
      }

      if (tag === "button") {
        ctas.push(
          identifiedLocationFor("cta", sourceFile, node, {
            ...shared,
            kind: "actionButton",
            tag,
          }),
        );
      } else if (buttonBindings.has(tag)) {
        if (hasTruthyAttribute(node, "asChild")) {
          asChildButtonsExcluded += 1;
          const recognizedInteractiveTags = new Set(["a", "button", ...linkBindings]);
          asChildButtonDelegates.push(
            locationFor(sourceFile, node, {
              ...shared,
              childTag: directJsxChildTag(node),
              recognizedInteractiveChild: hasDescendantJsxTag(
                node,
                recognizedInteractiveTags,
              ),
            }),
          );
        } else {
          ctas.push(
            identifiedLocationFor("cta", sourceFile, node, {
              ...shared,
              kind: "actionButton",
              tag,
            }),
          );
        }
      } else if (linkBindings.has(tag)) {
        const href = getAttribute(node, "href");
        ctas.push(
          identifiedLocationFor("cta", sourceFile, node, {
            ...shared,
            href: typeof href === "string" ? href : href?.expression ?? null,
            kind: navigationKind(href, true),
            tag,
          }),
        );
      } else if (tag === "a") {
        const href = getAttribute(node, "href");
        ctas.push(
          identifiedLocationFor("cta", sourceFile, node, {
            ...shared,
            href: typeof href === "string" ? href : href?.expression ?? null,
            kind: navigationKind(href, false),
            tag,
          }),
        );
      }

      if (primitiveBindings.has(tag)) {
        if (hasTruthyAttribute(node, "asChild")) {
          asChildPrimitiveControlsExcluded += 1;
          const recognizedInteractiveTags = new Set([
            "a",
            "button",
            ...buttonBindings,
            ...linkBindings,
          ]);
          asChildPrimitiveDelegates.push(
            locationFor(sourceFile, node, {
              ...shared,
              childTag: directJsxChildTag(node),
              primitive: primitiveBindings.get(tag),
              recognizedInteractiveChild: hasDescendantJsxTag(
                node,
                recognizedInteractiveTags,
              ),
            }),
          );
        } else {
          supplementalControls.push(
            identifiedLocationFor("control", sourceFile, node, {
              ...shared,
              kind: primitiveBindings.get(tag),
              tag,
            }),
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function countBy(items, selector) {
  const counts = {};
  for (const item of items) {
    const key = selector(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function reachableCount(items) {
  return items.filter((item) => item.routes.length > 0).length;
}

function infrastructureCount(items) {
  return items.filter((item) =>
    infrastructureSurfaceFiles.includes(item.file),
  ).length;
}

const internalCtas = ctas.filter((cta) =>
  ["actionButton", "internal", "internalDynamic"].includes(cta.kind),
);
const routeReachableOverlays = overlays.filter((overlay) => overlay.routes.length > 0);
const routeReachableForms = forms.filter((form) => form.routes.length > 0);
const routeReachableInternalCtas = internalCtas.filter((cta) => cta.routes.length > 0);
const routeReachableSupplementalControls = supplementalControls.filter(
  (control) => control.routes.length > 0,
);
const routeCounts = {
  aliases: routes.filter((route) => route.alias).length,
  auth: routes.filter((route) => route.access === "auth").length,
  catchAll: routes.filter((route) => route.catchAll).length,
  dynamic: routes.filter((route) => route.dynamic).length,
  nonProtected: routes.filter((route) => route.access !== "protected").length,
  protected: routes.filter((route) => route.access === "protected").length,
  protectedAdmin: routes.filter((route) => route.admin).length,
  protectedNonAdmin: routes.filter((route) => route.access === "protected" && !route.admin).length,
  public: routes.filter((route) => route.access === "public").length,
  publicSite: routes.filter((route) => route.access === "publicSite").length,
  renderable: routes.filter((route) => !route.alias).length,
  totalFilesystemRoutes: routes.length,
};

const qaDenominators = {
  aliasRedirectChecks: routeCounts.aliases,
  errorInfrastructureCtaImplementations: 0,
  protectedAccessChecksThreePersonas: routeCounts.protected * 3,
  renderableRouteViewportChecksDesktopAndMobile: routeCounts.renderable * 2,
  routeReachableFormImplementations: reachableCount(forms),
  routeReachableInternalCtaImplementations: reachableCount(internalCtas),
  routeReachableOverlayImplementations: reachableCount(overlays),
  routeReachableSupplementalOverlayAndTabControls: reachableCount(supplementalControls),
};

const routeInfrastructure = sourceFiles
  .filter(
    (file) =>
      file.startsWith(`${APP_DIR}${path.sep}`) && ROUTE_INFRASTRUCTURE_NAMES.has(path.basename(file)),
  )
  .map((file) => relative(file));

const sourceDigest = crypto
  .createHash("sha256")
  .update(
    sourceFiles
      .map((file) => `${relative(file)}\0${sourceTextByFile.get(file)}\0`)
      .join(""),
  )
  .digest("hex");

const infrastructureSurfaceFiles = [...new Set(
  [...overlays, ...forms, ...internalCtas, ...supplementalControls]
    .filter(
      (item) =>
        item.routes.length === 0 &&
        item.file.startsWith("app/") &&
        ROUTE_INFRASTRUCTURE_NAMES.has(path.basename(item.file)),
    )
    .map((item) => item.file),
)].sort();
qaDenominators.errorInfrastructureCtaImplementations = infrastructureCount(internalCtas);
const orphanSurfaceFiles = [...new Set(
  [...overlays, ...forms, ...internalCtas, ...supplementalControls]
    .filter(
      (item) =>
        item.routes.length === 0 &&
        !infrastructureSurfaceFiles.includes(item.file),
    )
    .map((item) => item.file),
)].sort();
const formsWithoutSubmitContract = forms.filter((form) => !form.hasSubmitHandler);
const suspiciousAsChildButtonDelegates = asChildButtonDelegates.filter(
  (item) => !item.recognizedInteractiveChild,
);
const suspiciousAsChildPrimitiveDelegates = asChildPrimitiveDelegates.filter(
  (item) => !item.recognizedInteractiveChild,
);

function duplicateLocations(items) {
  const seen = new Set();
  const duplicates = [];
  for (const item of items) {
    const identity = `${item.file}:${item.line}:${item.column}`;
    if (seen.has(identity)) duplicates.push(identity);
    seen.add(identity);
  }
  return duplicates;
}

function duplicateIds(groups) {
  const seen = new Map();
  const duplicates = [];
  for (const [type, items] of groups) {
    for (const item of items) {
      const previous = seen.get(item.id);
      const location = item.source ?? `${item.file}:${item.line}:${item.column}`;
      if (previous) duplicates.push(`${item.id} (${previous}; ${type}:${location})`);
      else seen.set(item.id, `${type}:${location}`);
    }
  }
  return duplicates;
}

const stableIdGroups = [
  ["route", routes],
  ["overlay", routeReachableOverlays],
  ["form", routeReachableForms],
  ["cta", routeReachableInternalCtas],
  ["control", routeReachableSupplementalControls],
];
const stableIdDuplicates = duplicateIds(stableIdGroups);

const invariantFailures = [];
if (
  routeCounts.protected +
    routeCounts.auth +
    routeCounts.public +
    routeCounts.publicSite !==
  routeCounts.totalFilesystemRoutes
) {
  invariantFailures.push("As classes de acesso nao fecham no total de rotas.");
}
if (routeCounts.renderable + routeCounts.aliases !== routeCounts.totalFilesystemRoutes) {
  invariantFailures.push("Rotas renderizaveis mais aliases nao fecham no total.");
}
if (routes.some((route) => route.alias && route.redirectTargets.length === 0)) {
  invariantFailures.push("Existe alias sem chamada redirect identificada.");
}
for (const [label, items] of [
  ["overlay", overlays],
  ["formulario", forms],
  ["CTA", ctas],
  ["controle complementar", supplementalControls],
]) {
  const duplicates = duplicateLocations(items);
  if (duplicates.length > 0) {
    invariantFailures.push(`${duplicates.length} local(is) duplicado(s) em ${label}.`);
  }
}
if (stableIdDuplicates.length > 0) {
  invariantFailures.push(
    `${stableIdDuplicates.length} identificador(es) estavel(is) duplicado(s) no indice canonico.`,
  );
}

const gaps = [
  ...(routeCollisions.length > 0
    ? [`${routeCollisions.length} colisao(oes) de URL encontrada(s).`]
    : []),
  ...(invariantFailures.length > 0
    ? [`${invariantFailures.length} invariante(s) estrutural(is) falharam.`]
    : []),
  ...(formsWithoutSubmitContract.length > 0
    ? [
        `${formsWithoutSubmitContract.length} <form> sem action/onSubmit local; revisar se o envio depende de um ancestral ou esta incompleto.`,
      ]
    : []),
  ...(suspiciousAsChildButtonDelegates.length > 0
    ? [
        `${suspiciousAsChildButtonDelegates.length} Button asChild delega para filho nao reconhecido como interativo; revisar semantica e clique.`,
      ]
    : []),
  ...(orphanSurfaceFiles.length > 0
    ? [
        `${orphanSurfaceFiles.length} arquivo(s) com superficie declarada nao aparecem no grafo conservador iniciado nas rotas.`,
      ]
    : []),
  `${routeCounts.dynamic} rota(s) dinamica(s) exigem fixture valida e caso invalido; o inventario nao cria dados.`,
  "As 19 rotas /admin sao de superadministracao: ADM/Lider/Usuario da organizacao devem ter negacao esperada, e uma persona superadmin separada e necessaria para validar a tela.",
  "Imports por barrel sao seguidos em nivel de arquivo e podem superestimar associacoes rota-componente; os denominadores unicos nao duplicam a implementacao.",
  "Elementos gerados por map/lista contam uma implementacao de codigo, nao a quantidade dependente dos dados em runtime.",
  "Handlers, feature flags, permissoes e destinos dinamicos precisam de verificacao em runtime; este auditor e deliberadamente estatico.",
];

const publicRoutes = routes.map((route) => {
  const copy = { ...route };
  delete copy._file;
  delete copy._reachable;
  return copy;
});
const stableIdIndexPayload = {
  schemaVersion: 1,
  algorithm: `sha256/${STABLE_ID_HEX_LENGTH * 4}-bit`,
  namespace: STABLE_ID_NAMESPACE,
  derivation: {
    route: "route + caminho relativo do page.tsx + alias|renderable + URL canonica",
    surface: "tipo da superficie + caminho relativo + linha + coluna",
  },
  routes: publicRoutes.map(({ alias, id, source, url }) => ({
    id,
    kind: alias ? "alias" : "renderable",
    source,
    url,
  })),
  routeReachableSurfaces: {
    overlays: routeReachableOverlays,
    forms: routeReachableForms,
    internalCtas: routeReachableInternalCtas,
    supplementalControls: routeReachableSupplementalControls,
  },
};
const stableIdIndex = {
  ...stableIdIndexPayload,
  digestSha256: crypto
    .createHash("sha256")
    .update(JSON.stringify(stableIdIndexPayload))
    .digest("hex"),
};
const publicFormsWithoutSubmitContract = formsWithoutSubmitContract.map((form) => {
  const copy = { ...form };
  delete copy.routes;
  return copy;
});
const summary = {
  schemaVersion: 3,
  scope: {
    ctaDefinition:
      "button/Button sem asChild e Link/a; somente actionButton/internal/internalDynamic entra no denominador interno",
    excluded:
      "components/ui, links externos, providers <Form>, duplicatas Button asChild e primitivas asChild",
    formsDefinition: "cada elemento HTML <form>; providers React <Form> nao contam novamente",
    overlayDefinition:
      "cada raiz Dialog/AlertDialog/Sheet/DropdownMenu/Popover importada da primitiva UI, fora de components/ui",
    routeDefinition: "cada app/**/page.tsx; grupos (x) e slots @x nao compoem a URL",
  },
  sourceDigestSha256: sourceDigest,
  stableIdIndex,
  routes: publicRoutes,
  routeReachabilityBySurfaceFile,
  counts: {
    routes: routeCounts,
    routeInfrastructure: countBy(routeInfrastructure, (file) => path.basename(file)),
    surfaces: {
      asChildButtonsExcluded,
      asChildButtonsWithUnrecognizedChild: suspiciousAsChildButtonDelegates.length,
      asChildPrimitiveControlsExcluded,
      asChildPrimitiveControlsWithUnrecognizedChild:
        suspiciousAsChildPrimitiveDelegates.length,
      ctasAll: ctas.length,
      ctasByKind: countBy(ctas, (cta) => cta.kind),
      forms: forms.length,
      formsRouteReachable: reachableCount(forms),
      formsWithoutLocalSubmitContract: formsWithoutSubmitContract.length,
      internalCtas: internalCtas.length,
      internalCtasRouteReachable: reachableCount(internalCtas),
      overlays: overlays.length,
      overlaysByKind: countBy(overlays, (overlay) => overlay.kind),
      overlaysRouteReachable: reachableCount(overlays),
      supplementalControls: supplementalControls.length,
      supplementalControlsByKind: countBy(supplementalControls, (control) => control.kind),
      supplementalControlsRouteReachable: reachableCount(supplementalControls),
    },
  },
  qaDenominators,
  diagnostics: {
    formsWithoutLocalSubmitContract: publicFormsWithoutSubmitContract,
    infrastructureSurfaceFiles,
    invariantFailures,
    orphanSurfaceFiles,
    routeCollisions,
    stableIdDuplicates,
    suspiciousAsChildButtonDelegates,
    suspiciousAsChildPrimitiveDelegates,
  },
  gaps,
};

function markdownFor(report) {
  const routeRows = report.routes
    .map((route) => {
      const type = route.alias ? "alias" : route.dynamic ? "dinamica" : "estatica";
      const target = route.redirectTargets.length > 0 ? route.redirectTargets.join("; ") : "-";
      return `| \`${route.id}\` | \`${route.url}\` | ${route.access}${route.admin ? "/admin" : ""} | ${type} | \`${target}\` |`;
    })
    .join("\n");
  const overlayCounts = Object.entries(report.counts.surfaces.overlaysByKind)
    .map(([kind, count]) => `\`${kind}\` ${count}`)
    .join(", ");
  const ctaCounts = Object.entries(report.counts.surfaces.ctasByKind)
    .map(([kind, count]) => `\`${kind}\` ${count}`)
    .join(", ");

  return `# Inventario canonico de superficies do CRM

Gerado por \`node scripts/audits/inventory-crm-surfaces.mjs --write\`.
O conteudo e deterministico para o digest \`${report.sourceDigestSha256}\`.

## Denominadores

| Superficie | Total |
| --- | ---: |
| Rotas de arquivo | ${report.counts.routes.totalFilesystemRoutes} |
| Telas renderizaveis (sem redirects) | ${report.counts.routes.renderable} |
| Aliases/redirects | ${report.counts.routes.aliases} |
| Rotas protegidas | ${report.counts.routes.protected} |
| Rotas protegidas admin | ${report.counts.routes.protectedAdmin} |
| Rotas nao protegidas (publicas, site e auth) | ${report.counts.routes.nonProtected} |
| Rotas dinamicas | ${report.counts.routes.dynamic} |
| Overlays unicos | ${report.counts.surfaces.overlays} |
| Formularios HTML unicos | ${report.counts.surfaces.forms} |
| CTAs internos unicos | ${report.counts.surfaces.internalCtas} |
| Controles complementares de overlay/tab | ${report.counts.surfaces.supplementalControls} |

Overlays: ${overlayCounts}.

CTAs declarados, inclusive externos/desconhecidos: ${ctaCounts}.

## Identificadores estaveis

O indice JSON usa IDs no formato \`tipo:${"0".repeat(STABLE_ID_HEX_LENGTH)}\`, derivados por SHA-256 de tipo + caminho relativo + localizacao/assinatura estrutural. Nenhum caminho absoluto entra na chave. O digest do indice e \`${report.stableIdIndex.digestSha256}\`.

| Categoria enderecavel | IDs |
| --- | ---: |
| Rotas renderizaveis e aliases | ${report.stableIdIndex.routes.length} |
| Overlays alcancaveis | ${report.stableIdIndex.routeReachableSurfaces.overlays.length} |
| Formularios alcancaveis | ${report.stableIdIndex.routeReachableSurfaces.forms.length} |
| CTAs internos alcancaveis | ${report.stableIdIndex.routeReachableSurfaces.internalCtas.length} |
| Controles complementares alcancaveis | ${report.stableIdIndex.routeReachableSurfaces.supplementalControls.length} |

Cada entrada de superficie preserva arquivo, linha, coluna, dono e rotas associadas, permitindo que um caso E2E declare exatamente o ID coberto sem criar uma segunda contagem.

## Matriz minima mensuravel

| Verificacao | Denominador |
| --- | ---: |
| Acesso das rotas protegidas x ADM/Lider/Usuario | ${report.qaDenominators.protectedAccessChecksThreePersonas} |
| Tela renderizavel x desktop/mobile | ${report.qaDenominators.renderableRouteViewportChecksDesktopAndMobile} |
| Contrato dos aliases | ${report.qaDenominators.aliasRedirectChecks} |
| Overlays alcancaveis por implementacao | ${report.qaDenominators.routeReachableOverlayImplementations} |
| Formularios alcancaveis por implementacao | ${report.qaDenominators.routeReachableFormImplementations} |
| CTAs internos alcancaveis por implementacao | ${report.qaDenominators.routeReachableInternalCtaImplementations} |
| CTAs das telas de erro/infraestrutura | ${report.qaDenominators.errorInfrastructureCtaImplementations} |

Nao se somam esses denominadores como se fossem equivalentes. A cobertura deve ser informada por categoria e, para o corte de 90%, tambem como \`aprovados / planejados\` com todo P0/P1 obrigatoriamente aprovado.

## Regras contra dupla contagem

- Uma rota e um \`app/**/page.tsx\`; aliases continuam sendo endpoints, mas nao contam como tela renderizavel.
- Uma implementacao JSX tem identidade \`arquivo:linha:coluna\`. Reuso em varias rotas fica como associacao, sem multiplicar o denominador unico.
- \`Button asChild\` nao conta junto com o link filho. Primitivas com \`asChild\` tambem nao contam novamente.
- \`<Form>\` de contexto nao conta como segundo formulario quando envolve um \`<form>\` HTML.
- Componentes-base em \`components/ui\` sao infraestrutura; contam apenas as instancias de produto que os importam.
- Um \`map\` conta o ponto de interacao implementado uma vez; volume de dados em runtime nao altera este inventario.

## Lacunas do inventario estatico

${report.gaps.map((gap) => `- ${gap}`).join("\n")}

Arquivos com superficie fora do grafo conservador: ${report.diagnostics.orphanSurfaceFiles.length === 0 ? "nenhum" : report.diagnostics.orphanSurfaceFiles.map((file) => `\`${file}\``).join(", ")}.

Superficies de erro/infraestrutura verificadas separadamente: ${report.diagnostics.infrastructureSurfaceFiles.length === 0 ? "nenhuma" : report.diagnostics.infrastructureSurfaceFiles.map((file) => `\`${file}\``).join(", ")}.

Delegacoes \`Button asChild\` a revisar: ${report.diagnostics.suspiciousAsChildButtonDelegates.length === 0 ? "nenhuma" : report.diagnostics.suspiciousAsChildButtonDelegates.map((item) => `\`${item.file}:${item.line}\` (filho \`${item.childTag ?? "desconhecido"}\`)`).join(", ")}.

## Rotas

| ID | URL | Acesso | Tipo | Destino do redirect |
| --- | --- | --- | --- | --- |
${routeRows}
`;
}

const jsonContent = `${JSON.stringify(summary, null, 2)}\n`;
const markdownContent = markdownFor(summary);

function assertFresh(file, expected) {
  if (!fs.existsSync(file)) {
    console.error(`Relatorio ausente: ${relative(file)}`);
    process.exitCode = 1;
    return;
  }
  if (fs.readFileSync(file, "utf8") !== expected) {
    console.error(`Relatorio desatualizado: ${relative(file)}`);
    process.exitCode = 1;
  }
}

if (writeReports) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(JSON_REPORT, jsonContent);
  fs.writeFileSync(MARKDOWN_REPORT, markdownContent);
}
if (checkReports) {
  assertFresh(JSON_REPORT, jsonContent);
  assertFresh(MARKDOWN_REPORT, markdownContent);
}

if (printDetails) {
  console.log(JSON.stringify({ ...summary, details: { ctas, forms, overlays, supplementalControls } }, null, 2));
} else {
  console.log(
    JSON.stringify(
      {
        counts: summary.counts,
        diagnostics: summary.diagnostics,
        qaDenominators: summary.qaDenominators,
        sourceDigestSha256: summary.sourceDigestSha256,
        stableIdIndexDigestSha256: summary.stableIdIndex.digestSha256,
      },
      null,
      2,
    ),
  );
}

if (routeCollisions.length > 0 || invariantFailures.length > 0) process.exitCode = 1;
