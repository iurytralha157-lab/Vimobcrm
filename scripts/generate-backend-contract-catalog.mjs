import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const appFile = join(repositoryRoot, "apps", "api", "internal", "app", "app.go");
const markdownFile = join(repositoryRoot, "docs", "catalogo-contratos-backend.md");
const csvFile = join(repositoryRoot, "docs", "catalogo-contratos-backend.csv");
const expectedContractCount = 472;

const groupLabels = {
  health: "Saúde da aplicação",
  help: "Central de ajuda",
  home: "Página inicial",
  "internal-whatsapp": "WhatsApp interno",
  me: "Conta e organização atual",
  realtime: "Eventos em tempo real",
  telemetry: "Telemetria",
  "audit-logs": "Auditoria",
  analytics: "Analytics",
  ai: "Inteligência artificial",
  attention: "Central de atenção",
  admin: "Superadmin",
  gamification: "Gamificação",
  "cadence-templates": "Modelos de cadência",
  "cadence-tasks": "Tarefas de cadência",
  leads: "Leads",
  financial: "Financeiro",
  contracts: "Contratos financeiros",
  "commission-rules": "Regras de comissão",
  commissions: "Comissões",
  dre: "DRE",
  dashboard: "Dashboard",
  notifications: "Notificações",
  invitations: "Convites",
  users: "Usuários",
  settings: "Configurações",
  integrations: "Integrações",
  whatsapp: "WhatsApp",
  webhooks: "Webhooks",
  public: "APIs públicas",
  site: "Site",
  properties: "Imóveis",
  schedule: "Agenda",
  automations: "Automações",
  "automation-executions": "Execuções de automação",
  "automation-media": "Mídias de automação",
  "automation-runtime": "Runtime de automação",
  "automation-templates": "Modelos de automação",
  pipelines: "Pipelines",
  "pipeline-board": "Quadro do pipeline",
  "pipeline-sla-settings": "SLA do pipeline",
  "pipeline-stage-counts": "Contagem por etapa",
  "pipeline-stage-leads": "Leads por etapa",
  "stage-automations": "Automações de etapa",
  "stage-operational-configs": "Configurações operacionais de etapa",
  stages: "Etapas",
  teams: "Equipes",
  "team-members": "Membros de equipe",
  "team-pipelines": "Pipelines das equipes",
  "member-availability": "Disponibilidade dos membros",
  tags: "Tags",
  activities: "Atividades",
  announcements: "Comunicados",
  contacts: "Contatos",
  "feature-requests": "Solicitações de recursos",
  "lead-analytics": "Analytics de leads",
  "lead-attachments": "Anexos de leads",
  "lead-enrichments": "Enriquecimento de leads",
  "lead-meta": "Metadados de leads",
  "lead-meta-filters": "Filtros de metadados de leads",
  "lead-tasks": "Tarefas de leads",
  "lead-visibility": "Visibilidade de leads",
  "onboarding-requests": "Solicitações de onboarding",
  "property-captors": "Captadores de imóveis",
  "property-cities": "Cidades dos imóveis",
  "property-condominiums": "Condomínios dos imóveis",
  "property-features": "Características dos imóveis",
  "property-images": "Imagens dos imóveis",
  "property-neighborhoods": "Bairros dos imóveis",
  "property-owners": "Proprietários dos imóveis",
  "property-proximities": "Proximidades dos imóveis",
  "property-site-info": "Informações públicas do imóvel",
  "property-summaries": "Resumos dos imóveis",
  "property-types": "Tipos de imóveis",
  "subscription-plans": "Planos de assinatura",
  "user-organizations": "Organizações dos usuários",
  "user-summaries": "Resumos dos usuários",
  "round-robins": "Filas de distribuição",
  "round-robin-rules": "Regras de distribuição",
  "round-robin-members": "Membros da distribuição",
};

function getGroup(pathname) {
  if (pathname === "/healthz" || pathname === "/readyz") {
    return "health";
  }

  if (pathname.startsWith("/v1/internal/whatsapp")) {
    return "internal-whatsapp";
  }

  const normalized = pathname.replace(/^\/v1\//, "");
  return normalized.split("/")[0];
}

function getAccess(registration, pathname) {
  const modulePermission = registration.match(
    /withModulePermission\("([^"]+)", permissions\.([A-Za-z0-9_]+)/,
  );
  if (modulePermission) {
    return `Módulo ${modulePermission[1]} + permissão ${modulePermission[2]}`;
  }

  const permission = registration.match(
    /withPermission\(permissions\.([A-Za-z0-9_]+)/,
  );
  if (permission) {
    return `Organização + permissão ${permission[1]}`;
  }

  if (registration.includes("withFinancialOrganization(")) {
    return "Organização + acesso financeiro";
  }

  if (registration.includes("withOrganization(")) {
    return "Organização ativa";
  }

  if (registration.includes("withAuthTenant(")) {
    return "Usuário autenticado";
  }

  if (pathname === "/healthz" || pathname === "/readyz") {
    return "Saúde pública";
  }

  return "Sem middleware na rota; o handler pode validar segredo, assinatura ou token";
}

function escapeMarkdown(value) {
  return value.replaceAll("|", "\\|");
}

function escapeCsv(value) {
  const text = String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

const source = readFileSync(appFile, "utf8");
const contracts = [];

for (const [index, line] of source.split(/\r?\n/).entries()) {
  const match = line.match(
    /^\s*mux\.Handle(?:Func)?\("(GET|POST|PUT|PATCH|DELETE) ([^"]+)",\s*(.+)\)\s*$/,
  );
  if (!match) {
    continue;
  }

  const [, method, pathname, registration] = match;
  const handlerMatch = registration.match(
    /([A-Za-z0-9_]+Handler)\.([A-Za-z0-9_]+)/,
  );

  if (!handlerMatch) {
    throw new Error(`Handler não identificado na linha ${index + 1}: ${line}`);
  }

  const [, handlerObject, operation] = handlerMatch;
  const group = getGroup(pathname);

  contracts.push({
    id: contracts.length + 1,
    method,
    pathname,
    operation,
    handler: `${handlerObject}.${operation}`,
    access: getAccess(registration, pathname),
    group,
    groupLabel: groupLabels[group] ?? group,
    line: index + 1,
  });
}

if (contracts.length !== expectedContractCount) {
  throw new Error(
    `O catálogo esperava ${expectedContractCount} contratos, mas encontrou ${contracts.length}. Revise o parser.`,
  );
}

const methodCounts = Object.groupBy(contracts, ({ method }) => method);
const groups = new Map();

for (const contract of contracts) {
  const current = groups.get(contract.group) ?? [];
  current.push(contract);
  groups.set(contract.group, current);
}

const groupSummary = [...groups.entries()]
  .map(([group, items]) => ({
    group,
    label: items[0].groupLabel,
    count: items.length,
  }))
  .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));

const markdown = [
  `# Catálogo dos ${contracts.length} contratos do backend`,
  "",
  "Gerado automaticamente a partir de `apps/api/internal/app/app.go`.",
  "",
  "Cada contrato abaixo contém o método HTTP, a rota exata, a operação/handler responsável, a camada de acesso registrada e a linha de origem. A indicação “sem middleware na rota” não significa necessariamente acesso irrestrito: webhooks e rotas internas podem validar assinatura, segredo ou token dentro do próprio handler.",
  "",
  "## Resumo",
  "",
  `- Total: **${contracts.length} contratos HTTP**.`,
  `- GET: **${methodCounts.GET?.length ?? 0}**.`,
  `- POST: **${methodCounts.POST?.length ?? 0}**.`,
  `- PUT: **${methodCounts.PUT?.length ?? 0}**.`,
  `- PATCH: **${methodCounts.PATCH?.length ?? 0}**.`,
  `- DELETE: **${methodCounts.DELETE?.length ?? 0}**.`,
  `- Grupos de rota: **${groups.size}**.`,
  "",
  "## Índice por domínio",
  "",
  "| Domínio | Prefixo | Contratos |",
  "| --- | --- | ---: |",
  ...groupSummary.map(
    ({ group, label, count }) =>
      `| ${escapeMarkdown(label)} | \`${escapeMarkdown(group)}\` | ${count} |`,
  ),
  "",
  "## Lista completa",
  "",
];

for (const items of groups.values()) {
  markdown.push(
    `### ${escapeMarkdown(items[0].groupLabel)} — ${items.length}`,
    "",
    "| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |",
    "| ---: | --- | --- | --- | --- | --- | ---: |",
  );

  for (const contract of items) {
    markdown.push(
      `| ${contract.id} | ${contract.method} | \`${escapeMarkdown(contract.pathname)}\` | \`${escapeMarkdown(contract.operation)}\` | \`${escapeMarkdown(contract.handler)}\` | ${escapeMarkdown(contract.access)} | ${contract.line} |`,
    );
  }

  markdown.push("");
}

const csvHeader = [
  "id",
  "dominio",
  "prefixo",
  "metodo",
  "rota",
  "operacao",
  "handler",
  "protecao",
  "linha_app_go",
];

const csvRows = contracts.map((contract) =>
  [
    contract.id,
    contract.groupLabel,
    contract.group,
    contract.method,
    contract.pathname,
    contract.operation,
    contract.handler,
    contract.access,
    contract.line,
  ]
    .map(escapeCsv)
    .join(","),
);

mkdirSync(dirname(markdownFile), { recursive: true });
writeFileSync(markdownFile, `${markdown.join("\n").trimEnd()}\n`, "utf8");
writeFileSync(csvFile, `${csvHeader.map(escapeCsv).join(",")}\n${csvRows.join("\n")}\n`, "utf8");

console.log(
  JSON.stringify(
    {
      contracts: contracts.length,
      groups: groups.size,
      markdownFile,
      csvFile,
    },
    null,
    2,
  ),
);
