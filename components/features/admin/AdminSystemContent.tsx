"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Database } from "lucide-react";

import type { AdminSection } from "@/components/features/admin/admin-navigation";
import { AiAgentsContent } from "@/components/features/admin/AiAgentsContent";
import { VimobLoader } from "@/components/shared/loading";
import { Badge } from "@/components/ui/badge";
import { normalizeSearchText } from "@/lib/search-text";
import { cn } from "@/lib/utils";
import { AdminWarning, KpiCard } from "@/components/features/admin/AdminPrimitives";
import { AdminToolbar } from "@/components/features/admin/AdminToolbar";
import {
  formatNumber,
  GenericRowsPreview,
  getErrorMessage,
  normalizeText,
} from "@/components/features/admin/admin-display";
import { countAdminTable, useAdminRows, useSafeAdminQuery } from "@/components/features/admin/admin-queries";

const LEGACY_TABLES = [
  { name: "organizations", label: "Organizações", critical: true },
  { name: "users", label: "Usuários", critical: true },
  { name: "organization_members", label: "Membros", critical: true },
  { name: "admin_subscription_plans", label: "Planos", critical: true },
  { name: "onboarding_requests", label: "Onboarding", critical: false },
  { name: "feature_requests", label: "Solicitações", critical: false },
  { name: "announcements", label: "Comunicados", critical: false },
  { name: "help_articles", label: "Ajuda", critical: false },
  { name: "audit_logs", label: "Auditoria", critical: false },
  { name: "notifications", label: "Notificações", critical: false },
  { name: "email_templates", label: "Templates de e-mail", critical: false },
  { name: "email_logs", label: "Logs de e-mail", critical: false },
];

const SECTION_TABLE: Partial<Record<AdminSection, { table: string; title: string; fields: string[]; empty: string }>> = {
  onboarding: {
    table: "onboarding_requests",
    title: "Solicitações de onboarding",
    fields: ["company_name", "responsible_name", "responsible_email", "status", "created_at"],
    empty: "Nenhuma solicitação de onboarding encontrada.",
  },
  requests: {
    table: "feature_requests",
    title: "Solicitações de melhoria",
    fields: ["title", "category", "status", "created_at"],
    empty: "Nenhuma solicitação de melhoria encontrada.",
  },
  notifications: {
    table: "notifications",
    title: "Notificações sistêmicas",
    fields: ["title", "type", "is_read", "created_at"],
    empty: "Nenhuma notificação encontrada.",
  },
  "email-templates": {
    table: "email_templates",
    title: "Templates de e-mail",
    fields: ["name", "subject", "slug", "updated_at"],
    empty: "Nenhum template de e-mail encontrado.",
  },
  "email-logs": {
    table: "email_logs",
    title: "Logs de e-mail",
    fields: ["recipient_email", "subject", "status", "sent_at"],
    empty: "Nenhum log de e-mail encontrado.",
  },
  announcements: {
    table: "announcements",
    title: "Comunicados",
    fields: ["message", "target_type", "is_active", "created_at"],
    empty: "Nenhum comunicado encontrado.",
  },
  help: {
    table: "help_articles",
    title: "Artigos da central de ajuda",
    fields: ["title", "category", "is_active", "updated_at"],
    empty: "Nenhum artigo de ajuda encontrado.",
  },
  audit: {
    table: "audit_logs",
    title: "Eventos de auditoria",
    fields: ["action", "entity_type", "user_id", "created_at"],
    empty: "Nenhum evento de auditoria encontrado.",
  },
};

export function AdminGenericTableContent({ section }: { section: AdminSection }) {
  const config = SECTION_TABLE[section];
  if (!config) return null;

  return <GenericTable tableConfig={config} />;
}

function GenericTable({
  tableConfig,
}: {
  tableConfig: { table: string; title: string; fields: string[]; empty: string };
}) {
  const [search, setSearch] = useState("");
  const query = useAdminRows(tableConfig.table, 120);
  const rows = query.data?.data || [];
  const errorMessage = query.data?.errorMessage;
  const filteredRows = rows.filter((row) =>
    tableConfig.fields.some((field) => normalizeText(row[field]).includes(normalizeSearchText(search))),
  );

  return (
    <div className="space-y-4">
      <AdminWarning message={errorMessage} />
      <AdminToolbar search={search} onSearch={setSearch} placeholder={`Buscar em ${tableConfig.title.toLowerCase()}...`} />
      {query.isPending ? (
        <div className="flex min-h-[220px] items-center justify-center">
          <VimobLoader label={`Carregando ${tableConfig.title.toLowerCase()}...`} />
        </div>
      ) : null}
      {!query.isPending && !errorMessage ? (
        <GenericRowsPreview title={tableConfig.title} rows={filteredRows} fields={tableConfig.fields} empty={tableConfig.empty} />
      ) : null}
    </div>
  );
}

export function AdminDatabaseContent() {
  const counts = useSafeAdminQuery(
    ["admin-table-counts", LEGACY_TABLES.map((table) => table.name).join("|")],
    async () => {
      const results = await Promise.all(
        LEGACY_TABLES.map(async (table) => {
          try {
            return { table: table.name, count: await countAdminTable(table.name), errorMessage: null };
          } catch (error) {
            return { table: table.name, count: 0, errorMessage: getErrorMessage(error) };
          }
        }),
      );
      return results;
    },
    [],
  );

  const countResults = counts.data?.data || [];
  const countByTable = new Map(countResults.map((item) => [item.table, item]));
  const configured = countResults.filter((item) => !item.errorMessage).length;
  const criticalMissing = LEGACY_TABLES.filter((item) => {
    const result = countByTable.get(item.name);
    return item.critical && (!result || Boolean(result.errorMessage));
  }).length;

  return (
    <div className="space-y-4">
      <AdminWarning message={counts.data?.errorMessage} />
      {counts.isPending ? (
        <div className="flex min-h-[220px] items-center justify-center">
          <VimobLoader label="Verificando estrutura..." />
        </div>
      ) : null}
      {!counts.isPending ? (
        <>
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard title="Tabelas mapeadas" value={LEGACY_TABLES.length} icon={Database} />
        <KpiCard title="Respondendo" value={configured} icon={CheckCircle2} />
        <KpiCard title="Críticas pendentes" value={criticalMissing} icon={AlertTriangle} />
      </div>

      <div className="app-card p-4">
        <div className="mb-4">
          <h2 className="text-base font-medium">Checklist visual de estrutura</h2>
          <p className="text-sm text-muted-foreground">
            Checagem feita via cliente Supabase da aplicação. Não executei SQL manual nem alterei schema.
          </p>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {LEGACY_TABLES.map((item) => {
            const result = countByTable.get(item.name);
            const pending = !result || Boolean(result.errorMessage);
            return (
              <div key={item.name} className="app-card-soft flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="font-medium">{item.label}</p>
                  <p className="truncate text-xs text-muted-foreground">{item.name}</p>
                </div>
                <Badge className={cn("border-0", pending ? "bg-amber-500/12 text-amber-400" : "bg-emerald-500/12 text-emerald-400")}>
                  {pending ? "Pendente" : `${formatNumber(result?.count)} registros`}
                </Badge>
              </div>
            );
          })}
        </div>
      </div>
        </>
      ) : null}
    </div>
  );
}

export function AdminAiContent() {
  return <AiAgentsContent />;
}
