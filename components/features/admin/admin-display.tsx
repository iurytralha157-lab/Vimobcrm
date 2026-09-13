import Link from "next/link";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { normalizeSearchText } from "@/lib/search-text";
import { getInitials as getSharedInitials } from "@/lib/user-display";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/features/admin/AdminPrimitives";
import {
  formatPtBRNumber,
  formatWholePtBRCurrency,
} from "@/lib/utils/formatting";

export type AdminRecord = Record<string, unknown>;

const FIELD_LABELS: Record<string, string> = {
  action: "Ação",
  billing_cycle: "Ciclo",
  category: "Categoria",
  cnpj: "CNPJ",
  company_name: "Empresa",
  created_at: "Criado em",
  description: "Descrição",
  email: "E-mail",
  entity_type: "Entidade",
  is_active: "Status",
  is_read: "Leitura",
  key: "Chave",
  logo_url_dark: "Logo escuro",
  logo_url_light: "Logo claro",
  maintenance_mode: "Manutenção",
  max_users: "Usuários",
  message: "Mensagem",
  name: "Nome",
  organization_id: "Organização",
  price: "Preço",
  responsible_email: "E-mail responsável",
  responsible_name: "Responsável",
  recipient_email: "Destinatário",
  role: "Perfil",
  segment: "Segmento",
  sent_at: "Enviado em",
  slug: "Slug",
  status: "Status",
  subject: "Assunto",
  subscription_status: "Status",
  target_type: "Destino",
  title: "Título",
  to_email: "Destinatário",
  trial_days: "Dias de trial",
  trial_enabled: "Trial",
  type: "Tipo",
  updated_at: "Atualizado em",
  user_id: "Usuário",
  whatsapp: "WhatsApp",
};

const VALUE_LABELS: Record<string, string> = {
  active: "Ativo",
  admin: "Admin",
  all: "Todos",
  approved: "Aprovado",
  accepted: "Aceito pelo provedor",
  cancelled: "Cancelado",
  draft: "Rascunho",
  failed: "Falhou",
  delivered: "Entregue",
  delivery_failed: "Falha na entrega",
  imobiliario: "Imobiliário",
  inactive: "Inativo",
  monthly: "Mensal",
  new: "Novo",
  owner: "Proprietário",
  pending: "Pendente",
  quarterly: "Trimestral",
  read: "Lida",
  sent: "Enviado",
  submitted: "Enviado",
  super_admin: "Super admin",
  trial: "Período de teste",
  unread: "Não lida",
  user: "Usuário",
  annual: "Anual",
};

const ORGANIZATION_STATUS_LABELS: Record<string, string> = {
  active: "Ativa",
  inactive: "Inativa",
  trial: "Período de teste",
  pending_payment: "Pagamento pendente",
  overdue: "Em atraso",
  past_due: "Em atraso",
  blocked: "Bloqueada",
  cancelled: "Cancelada",
  canceled: "Cancelada",
};

export function getErrorMessage(error: unknown) {
  const friendlyMissingStructureMessage = "O Supabase conectado ainda não retornou os dados esperados para esta área.";

  if (error instanceof Error) {
    if (error.message.includes("Could not find the table") || error.message.includes("does not exist")) {
      return friendlyMissingStructureMessage;
    }
    return error.message;
  }
  if (typeof error === "object" && error && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      if (message.includes("Could not find the table") || message.includes("does not exist")) {
        return friendlyMissingStructureMessage;
      }
      return message;
    }
  }
  return "Estrutura ainda não disponível no Supabase conectado.";
}

export function formatCurrency(value: unknown) {
  const numericValue = Number(value || 0);
  return formatWholePtBRCurrency(Number.isFinite(numericValue) ? numericValue : 0);
}

export function formatNumber(value: unknown) {
  const numericValue = Number(value || 0);
  return formatPtBRNumber(Number.isFinite(numericValue) ? numericValue : 0);
}

export function formatDate(value: unknown) {
  if (!value || typeof value !== "string") return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function getString(record: AdminRecord | undefined, key: string, fallback = "--") {
  const value = record?.[key];
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function getOptionalString(record: AdminRecord | undefined, key: string) {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function getInitials(name?: string | null) {
  return getSharedInitials(name, { fallback: "US" });
}

export function normalizeText(value: unknown) {
  return normalizeSearchText(String(value || ""));
}

export function normalizeValue(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export function formatFieldLabel(field: string) {
  return FIELD_LABELS[field] || field.replaceAll("_", " ");
}

export function formatRecordsCount(count: number) {
  return `${formatNumber(count)} ${count === 1 ? "registro exibido" : "registros exibidos"}`;
}

export function translateValue(value: unknown) {
  const normalized = normalizeValue(value);
  return VALUE_LABELS[normalized] || getString({ value }, "value");
}

function getInactiveLabel(activeLabel: string) {
  return activeLabel === "Ativa" ? "Inativa" : "Inativo";
}

export function formatStatusValue(value: unknown, activeLabel = "Ativo") {
  if (typeof value === "boolean") return value ? activeLabel : getInactiveLabel(activeLabel);

  const normalized = normalizeValue(value);
  if (!normalized) return "--";
  if (activeLabel === "Ativa" && ORGANIZATION_STATUS_LABELS[normalized]) {
    return ORGANIZATION_STATUS_LABELS[normalized];
  }
  if (normalized === "true" || normalized === "sim" || normalized === "active") return activeLabel;
  if (normalized === "false" || normalized === "não" || normalized === "nao" || normalized === "inactive") {
    return getInactiveLabel(activeLabel);
  }

  return VALUE_LABELS[normalized] || getString({ value }, "value");
}

function getStatusTone(value: unknown) {
  const normalized = normalizeValue(value);
  if (typeof value === "boolean") return value ? "active" : "muted";
  if (["active", "true", "sim", "approved", "delivered", "sent", "read"].includes(normalized)) return "active";
  if (["accepted", "pending", "processing", "new", "submitted", "trial"].includes(normalized)) return "warning";
  if (["inactive", "false", "não", "nao", "cancelled", "delivery_failed", "failed"].includes(normalized)) return "muted";
  return "soft";
}

export function StatusBadge({
  value,
  activeLabel = "Ativo",
}: {
  value: unknown;
  activeLabel?: string;
}) {
  const tone = getStatusTone(value);
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-[6px] border-0 px-2.5 py-1 font-medium transition-colors",
        tone === "active" && "bg-primary text-primary-foreground hover:bg-primary",
        tone === "warning" && "bg-amber-500 text-white hover:bg-amber-500",
        tone === "muted" && "bg-[var(--app-surface-soft)] text-muted-foreground hover:bg-[var(--app-surface-soft)]",
        tone === "soft" && "bg-primary/12 text-primary hover:bg-primary/12",
      )}
    >
      {formatStatusValue(value, activeLabel)}
    </Badge>
  );
}

export function formatFieldValue(row: AdminRecord, field: string) {
  const value = row[field];
  if (field.includes("_at") || field.endsWith("date")) return formatDate(value);
  if (field === "role") return translateValue(value);
  if (field === "segment" || field === "billing_cycle" || field === "target_type" || field === "type") {
    return translateValue(value);
  }
  return getString(row, field);
}

export function renderFieldValue(row: AdminRecord, field: string): ReactNode {
  if (field === "subscription_status") return <StatusBadge value={row[field]} activeLabel="Ativa" />;
  if (field === "status" || field === "is_active" || field === "is_read" || field === "trial_enabled" || field === "maintenance_mode") {
    return <StatusBadge value={row[field]} />;
  }
  return <span>{formatFieldValue(row, field)}</span>;
}

export function getOrganizationStatus(organization: AdminRecord) {
  if (organization.is_active === false) return "inactive";
  return getString(organization, "subscription_status", "active");
}

export function MiniInfo({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-3">
      <p className="text-[10px] font-light text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-medium">{value}</p>
    </div>
  );
}

export function PlanInfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[8px] bg-[var(--app-surface-soft)] px-2.5 py-2">
      <p className="text-[10px] font-light text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-sm font-medium">{value}</p>
    </div>
  );
}

export function GenericRowsPreview({
  title,
  rows,
  fields,
  empty,
  hrefBase,
}: {
  title: string;
  rows: AdminRecord[];
  fields: string[];
  empty: string;
  hrefBase?: string;
}) {
  if (rows.length === 0) {
    return <EmptyState title={title} description={empty} />;
  }

  return (
    <div className="app-card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--app-border)] p-4">
        <div>
          <h2 className="text-base font-medium">{title}</h2>
          <p className="text-sm text-muted-foreground">{formatRecordsCount(rows.length)}</p>
        </div>
      </div>
      <div className="divide-y divide-[var(--app-border)]">
        {rows.map((row, index) => {
          const id = getString(row, "id", String(index));
          const content = (
            <div className="grid gap-3 p-4 transition-colors hover:bg-[var(--app-surface-hover)] md:grid-cols-4">
              {fields.map((field) => (
                <div key={field} className="min-w-0">
                  <p className="text-[10px] font-light text-muted-foreground">{formatFieldLabel(field)}</p>
                  <div className="mt-1 truncate text-sm">{renderFieldValue(row, field)}</div>
                </div>
              ))}
            </div>
          );

          if (hrefBase && row.id) {
            return (
              <Link key={id} href={`${hrefBase}/${id}`} className="block">
                {content}
              </Link>
            );
          }

          return <div key={id}>{content}</div>;
        })}
      </div>
    </div>
  );
}
