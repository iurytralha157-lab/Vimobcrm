#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const REPORT_DIR = path.join(ROOT, "docs", "audits");
const JSON_REPORT = path.join(REPORT_DIR, "home-design-debt.json");
const MARKDOWN_REPORT = path.join(REPORT_DIR, "home-design-debt.md");
const SURFACE_INVENTORY = path.join(REPORT_DIR, "crm-surface-inventory.json");

const argv = new Set(process.argv.slice(2));
const writeReports = argv.has("--write");
const checkReports = argv.has("--check");

const rules = [
  {
    id: "heavy-shadow",
    label: "Sombra forte",
    priority: "P1",
    weight: 4,
    pattern: /\bshadow-(?:lg|xl|2xl)\b|\bshadow-\[[^\]]*(?:rgba?|0\s+\d)/g,
    guidance: "Usar shadow-none ou a sombra sutil dos pop-ups globais.",
  },
  {
    id: "medium-shadow",
    label: "Sombra fora do padrão",
    priority: "P2",
    weight: 2,
    pattern: /\bshadow-(?:sm|md)\b/g,
    guidance: "Blocos Home não usam sombra; validar se a elevação é realmente necessária.",
  },
  {
    id: "oversized-radius",
    label: "Raio acima de 8px",
    priority: "P1",
    weight: 3,
    pattern: /\brounded-(?:xl|2xl|3xl)\b|\brounded-\[(?:1[0-9]|[2-9][0-9])px\]/g,
    guidance: "Blocos usam 8px; controles 6px; microelementos 4px.",
  },
  {
    id: "heavy-font",
    label: "Tipografia pesada",
    priority: "P1",
    weight: 3,
    pattern: /\bfont-(?:semibold|bold|extrabold|black)\b/g,
    guidance: "Texto normal usa 300; títulos usam 400.",
  },
  {
    id: "hardcoded-color",
    label: "Cor hardcoded",
    priority: "P1",
    weight: 4,
    pattern: /#[0-9a-fA-F]{3,8}\b|\b(?:bg|border|text)-\[(?:rgba?|hsla?)\([^\]]+\)\]/g,
    guidance: "Usar tokens --app-* ou cores semânticas do domínio.",
  },
  {
    id: "hardcoded-surface",
    label: "Superfície branca/preta fixa",
    priority: "P2",
    weight: 2,
    pattern: /\bbg-(?:white|black)(?:\/[0-9.]+)?\b/g,
    guidance: "Usar --app-surface-solid, --app-surface-soft ou --app-surface-hover.",
  },
  {
    id: "aggressive-motion",
    label: "Movimento agressivo",
    priority: "P2",
    weight: 2,
    pattern: /\b(?:hover|group-hover):(?:scale|translate)-[^\s"'`}]+/g,
    guidance: "Remover scale/translate decorativo de cards e ações operacionais.",
  },
  {
    id: "uppercase-tracking",
    label: "Caixa alta/tracking",
    priority: "P3",
    weight: 1,
    pattern: /\buppercase\b|\btracking-(?:wide|wider|widest)\b/g,
    guidance: "Preferir texto natural em 10–12px e peso 300.",
  },
  {
    id: "panel-blur",
    label: "Blur no painel",
    priority: "P2",
    weight: 2,
    pattern: /\bbackdrop-blur(?:-[^\s"'`}]+)?/g,
    guidance: "O overlay pode escurecer; o painel deve usar superfície sólida.",
  },
];

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function relative(file) {
  return toPosix(path.relative(ROOT, file));
}

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(absolute));
    } else if (entry.isFile() && entry.name.endsWith(".tsx")) {
      files.push(absolute);
    }
  }
  return files;
}

function ignoredFile(file, orphanFiles) {
  const source = relative(file);
  return (
    source.startsWith("components/ui/") ||
    source.includes(".test.") ||
    source.includes(".spec.") ||
    source.includes(".stories.") ||
    orphanFiles.has(source)
  );
}

function sourceInventory() {
  if (!fs.existsSync(SURFACE_INVENTORY)) {
    return { orphanFiles: new Set(), digest: null, routeAccessByFile: new Map() };
  }
  const parsed = JSON.parse(fs.readFileSync(SURFACE_INVENTORY, "utf8"));
  return {
    orphanFiles: new Set(parsed.diagnostics?.orphanSurfaceFiles ?? []),
    digest: parsed.sourceDigestSha256 ?? null,
    routeAccessByFile: new Map(
      (parsed.routeReachabilityBySurfaceFile ?? []).map((entry) => [
        entry.file,
        Array.isArray(entry.access) ? entry.access : [],
      ]),
    ),
  };
}

function surfaceScopeFor(sourcePath) {
  const access = inventory.routeAccessByFile.get(sourcePath) ?? [];
  const protectedReachable = access.includes("protected");
  const nonProtectedReachable = access.some((value) => value !== "protected");
  if (protectedReachable && nonProtectedReachable) return "protected-and-public";
  if (protectedReachable) return "protected-only";
  if (nonProtectedReachable) return "public-only";
  return "infrastructure";
}

const inventory = sourceInventory();
const sourceFiles = [
  ...walk(path.join(ROOT, "app")),
  ...walk(path.join(ROOT, "components", "features")),
  ...walk(path.join(ROOT, "components", "shared")),
]
  .filter((file) => !ignoredFile(file, inventory.orphanFiles))
  .sort((left, right) => relative(left).localeCompare(relative(right)));

const findings = [];
const digester = crypto.createHash("sha256");

for (const file of sourceFiles) {
  const source = fs.readFileSync(file, "utf8");
  const sourcePath = relative(file);
  digester.update(sourcePath);
  digester.update("\0");
  digester.update(source);
  digester.update("\0");

  const lines = source.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (!line.includes("class") && !line.includes("#")) continue;
    for (const rule of rules) {
      rule.pattern.lastIndex = 0;
      const matches = [...line.matchAll(rule.pattern)];
      for (const match of matches) {
        findings.push({
          file: sourcePath,
          line: index + 1,
          match: match[0],
          priority: rule.priority,
          rule: rule.id,
          surfaceScope: surfaceScopeFor(sourcePath),
          weight: rule.weight,
        });
      }
    }
  }
}

const byRule = Object.fromEntries(
  rules.map((rule) => [
    rule.id,
    {
      count: findings.filter((finding) => finding.rule === rule.id).length,
      guidance: rule.guidance,
      label: rule.label,
      priority: rule.priority,
    },
  ]),
);

const fileMap = new Map();
for (const finding of findings) {
  const current = fileMap.get(finding.file) ?? { count: 0, score: 0, rules: {} };
  current.count += 1;
  current.score += finding.weight;
  current.rules[finding.rule] = (current.rules[finding.rule] ?? 0) + 1;
  fileMap.set(finding.file, current);
}

const files = [...fileMap.entries()]
  .map(([file, value]) => ({ file, ...value }))
  .sort((left, right) => right.score - left.score || right.count - left.count || left.file.localeCompare(right.file));
const protectedFileSet = new Set(
  findings
    .filter((finding) => finding.surfaceScope.startsWith("protected"))
    .map((finding) => finding.file),
);
const protectedFiles = files.filter((file) => protectedFileSet.has(file.file));

const report = {
  schemaVersion: 2,
  sourceDigestSha256: digester.digest("hex"),
  surfaceInventoryDigestSha256: inventory.digest,
  scope: {
    excluded: "components/ui, testes, stories e arquivos fora do grafo conservador do inventário de superfícies",
    filesScanned: sourceFiles.length,
    note: "Achados são candidatos estáticos. Cores de dados e estados semânticos exigem revisão humana antes da troca.",
  },
  counts: {
    filesWithFindings: files.length,
    findings: findings.length,
    protectedReachableFilesWithFindings: protectedFiles.length,
    protectedReachableFindings: findings.filter(
      (finding) => finding.surfaceScope.startsWith("protected"),
    ).length,
    bySurfaceScope: Object.fromEntries(
      ["protected-only", "protected-and-public", "public-only", "infrastructure"].map(
        (scope) => [scope, findings.filter((finding) => finding.surfaceScope === scope).length],
      ),
    ),
    byPriority: {
      P1: findings.filter((finding) => finding.priority === "P1").length,
      P2: findings.filter((finding) => finding.priority === "P2").length,
      P3: findings.filter((finding) => finding.priority === "P3").length,
    },
    byRule,
  },
  topFiles: files.slice(0, 50),
  topProtectedFiles: protectedFiles.slice(0, 50),
  findings,
};

function markdownFor(value) {
  const ruleRows = rules
    .map((rule) => {
      const result = value.counts.byRule[rule.id];
      return `| ${result.priority} | ${result.label} | ${result.count} | ${result.guidance} |`;
    })
    .join("\n");
  const fileRows = value.topFiles
    .map((file) => `| \`${file.file}\` | ${file.score} | ${file.count} | ${Object.entries(file.rules).map(([rule, count]) => `${rule}: ${count}`).join(", ")} |`)
    .join("\n");
  const protectedFileRows = value.topProtectedFiles
    .map((file) => `| \`${file.file}\` | ${file.score} | ${file.count} | ${Object.entries(file.rules).map(([rule, count]) => `${rule}: ${count}`).join(", ")} |`)
    .join("\n");

  return `# Dívida visual em relação ao padrão Home

Este relatório é gerado por \`scripts/audits/inventory-home-design-debt.mjs\`.

Ele prioriza candidatos a revisão; não substitui inspeção renderizada. Cores que codificam dados, status e gráficos não devem ser removidas mecanicamente.

## Resumo

- Arquivos analisados: ${value.scope.filesScanned}
- Arquivos com achados: ${value.counts.filesWithFindings}
- Achados: ${value.counts.findings}
- Arquivos protegidos/mistos com achados: ${value.counts.protectedReachableFilesWithFindings}
- Achados alcançáveis pelo CRM protegido: ${value.counts.protectedReachableFindings}
- Distribuição por superfície: protected-only ${value.counts.bySurfaceScope["protected-only"]}, protected-and-public ${value.counts.bySurfaceScope["protected-and-public"]}, public-only ${value.counts.bySurfaceScope["public-only"]}, infraestrutura ${value.counts.bySurfaceScope.infrastructure}
- P1: ${value.counts.byPriority.P1}
- P2: ${value.counts.byPriority.P2}
- P3: ${value.counts.byPriority.P3}

## Regras

| Prioridade | Regra | Quantidade | Direção |
| --- | --- | ---: | --- |
${ruleRows}

## Arquivos prioritários

### CRM protegido e componentes compartilhados

| Arquivo | Score | Achados | Distribuição |
| --- | ---: | ---: | --- |
${protectedFileRows}

### Todas as superfícies

| Arquivo | Score | Achados | Distribuição |
| --- | ---: | ---: | --- |
${fileRows}
`;
}

const jsonContent = `${JSON.stringify(report, null, 2)}\n`;
const markdownContent = markdownFor(report);

function assertFresh(file, expected) {
  if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== expected) {
    console.error(`Relatório desatualizado: ${relative(file)}`);
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

console.log(
  JSON.stringify(
    {
      counts: report.counts,
      sourceDigestSha256: report.sourceDigestSha256,
      topFiles: report.topFiles.slice(0, 15),
    },
    null,
    2,
  ),
);
