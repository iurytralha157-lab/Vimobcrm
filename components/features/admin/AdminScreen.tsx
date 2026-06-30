"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ElementType, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  CreditCard,
  Database,
  Loader2,
  Inbox,
  Pencil,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";

import type { AdminSection } from "@/components/features/admin/admin-navigation";
import { AnnouncementsContent } from "@/components/features/admin/AnnouncementsContent";
import { AiAgentsContent } from "@/components/features/admin/AiAgentsContent";
import { ErrorEventsContent } from "@/components/features/admin/ErrorEventsContent";
import { VimobLoader } from "@/components/shared/loading";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  SYSTEM_MODULES,
  getSystemModuleLabel,
  type SystemModuleKey,
} from "@/config/constants";
import { useAdminPlans, type SubscriptionPlan } from "@/hooks/use-admin-plans";
import { adminAPI } from "@/lib/api/admin";
import { cn } from "@/lib/utils";

type AdminRecord = Record<string, unknown>;
type OrganizationModuleRow = AdminRecord & {
  module_name?: string;
  is_enabled?: boolean;
};
type OrganizationPaymentRow = AdminRecord & {
  id?: string;
  status?: string;
  value?: number | string;
  billing_type?: string;
  due_date?: string;
  invoice_url?: string;
};
type OrganizationUpdatePayload = AdminRecord;

type SafeQueryResult<T> = {
  data: T;
  errorMessage: string | null;
};

type AdminScreenProps = {
  section: AdminSection;
  organizationId?: string;
};

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
  cancelled: "Cancelado",
  draft: "Rascunho",
  failed: "Falhou",
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
  trial: "Trial",
  unread: "Não lida",
  user: "Usuário",
  annual: "Anual",
};

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
  { name: "system_settings", label: "Configurações globais", critical: false },
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
    fields: ["to_email", "subject", "status", "sent_at"],
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

function getErrorMessage(error: unknown) {
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
  return "Estrutura ainda nao disponivel no Supabase conectado.";
}

function formatCurrency(value: unknown) {
  const numericValue = Number(value || 0);
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(numericValue) ? numericValue : 0);
}

function formatNumber(value: unknown) {
  const numericValue = Number(value || 0);
  return new Intl.NumberFormat("pt-BR").format(Number.isFinite(numericValue) ? numericValue : 0);
}

function formatDate(value: unknown) {
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

function getString(record: AdminRecord | undefined, key: string, fallback = "--") {
  const value = record?.[key];
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function getOptionalString(record: AdminRecord | undefined, key: string) {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function getInitials(name?: string | null) {
  if (!name) return "US";
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function normalizeText(value: unknown) {
  return String(value || "").toLowerCase();
}

function normalizeValue(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function formatFieldLabel(field: string) {
  return FIELD_LABELS[field] || field.replaceAll("_", " ");
}

function formatRecordsCount(count: number) {
  return `${formatNumber(count)} ${count === 1 ? "registro exibido" : "registros exibidos"}`;
}

function translateValue(value: unknown) {
  const normalized = normalizeValue(value);
  return VALUE_LABELS[normalized] || getString({ value }, "value");
}

function getInactiveLabel(activeLabel: string) {
  return activeLabel === "Ativa" ? "Inativa" : "Inativo";
}

function formatStatusValue(value: unknown, activeLabel = "Ativo") {
  if (typeof value === "boolean") return value ? activeLabel : getInactiveLabel(activeLabel);

  const normalized = normalizeValue(value);
  if (!normalized) return "--";
  if (normalized === "true" || normalized === "sim" || normalized === "active") return activeLabel;
  if (normalized === "false" || normalized === "não" || normalized === "nao" || normalized === "inactive") {
    return getInactiveLabel(activeLabel);
  }

  return VALUE_LABELS[normalized] || getString({ value }, "value");
}

function getStatusTone(value: unknown) {
  const normalized = normalizeValue(value);
  if (typeof value === "boolean") return value ? "active" : "muted";
  if (["active", "true", "sim", "approved", "sent", "read"].includes(normalized)) return "active";
  if (["pending", "new", "submitted", "trial"].includes(normalized)) return "warning";
  if (["inactive", "false", "não", "nao", "cancelled", "failed"].includes(normalized)) return "muted";
  return "soft";
}

function StatusBadge({
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
        "border-0 px-2.5 py-1 font-medium transition-colors",
        tone === "active" && "bg-[#FF4529] text-white hover:bg-[#FF4529]",
        tone === "warning" && "bg-amber-500 text-white hover:bg-amber-500",
        tone === "muted" && "bg-[var(--app-surface-soft)] text-muted-foreground hover:bg-[var(--app-surface-soft)]",
        tone === "soft" && "bg-[#FF4529]/12 text-[#FF806B] hover:bg-[#FF4529]/12",
      )}
    >
      {formatStatusValue(value, activeLabel)}
    </Badge>
  );
}

function formatFieldValue(row: AdminRecord, field: string) {
  const value = row[field];
  if (field.includes("_at") || field.endsWith("date")) return formatDate(value);
  if (field === "role") return translateValue(value);
  if (field === "segment" || field === "billing_cycle" || field === "target_type" || field === "type") {
    return translateValue(value);
  }
  return getString(row, field);
}

function renderFieldValue(row: AdminRecord, field: string): ReactNode {
  if (field === "subscription_status") return <StatusBadge value={row[field]} activeLabel="Ativa" />;
  if (field === "status" || field === "is_active" || field === "is_read" || field === "trial_enabled" || field === "maintenance_mode") {
    return <StatusBadge value={row[field]} />;
  }
  return <span>{formatFieldValue(row, field)}</span>;
}

function getOrganizationStatus(organization: AdminRecord) {
  if (organization.is_active === false) return "inactive";
  return getString(organization, "subscription_status", "active");
}

const NO_PLAN_VALUE = "__none__";
const DEFAULT_PLAN_MODULES: SystemModuleKey[] = ["crm", "properties", "whatsapp", "agenda"];

type OrganizationAccessForm = {
  planId: string;
  subscriptionStatus: string;
  maxUsers: string;
  maxWhatsappSessions: string;
  subscriptionValue: string;
  billingDay: string;
  nextBillingDate: string;
  trialEndsAt: string;
  modules: SystemModuleKey[];
};

function getRecordInputValue(record: AdminRecord | undefined, key: string) {
  const value = record?.[key];
  if (value === null || value === undefined) return "";
  return String(value);
}

function getDateInputValue(value: unknown) {
  if (!value || typeof value !== "string") return "";
  return value.slice(0, 10);
}

function formatDateOnly(value: unknown) {
  if (!value || typeof value !== "string") return "--";
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function getDaysUntil(value: unknown) {
  if (!value || typeof value !== "string") return null;
  const target = new Date(`${value.slice(0, 10)}T23:59:59`);
  if (Number.isNaN(target.getTime())) return null;
  const now = new Date();
  return Math.max(0, Math.ceil((target.getTime() - now.getTime()) / 86_400_000));
}

function getPaymentStatusLabel(status: unknown) {
  const normalized = normalizeValue(status);
  if (["confirmed", "received", "received_in_cash"].includes(normalized)) return "Pago";
  if (["pending", "created"].includes(normalized)) return "Pendente";
  if (["overdue"].includes(normalized)) return "Vencido";
  if (["refunded", "chargeback"].includes(normalized)) return "Estornado";
  if (["deleted", "cancelled", "canceled"].includes(normalized)) return "Cancelado";
  return getString({ status }, "status");
}

function isPaidPayment(payment: OrganizationPaymentRow) {
  return ["CONFIRMED", "RECEIVED", "RECEIVED_IN_CASH"].includes(payment.status || "");
}

function getEnabledModulesFromRows(rows: OrganizationModuleRow[], fallback: SystemModuleKey[]) {
  if (rows.length === 0) return fallback;

  return rows
    .filter((row) => row.is_enabled)
    .map((row) => row.module_name)
    .filter((module): module is SystemModuleKey => typeof module === "string" && SYSTEM_MODULE_KEY_SET.has(module));
}

function useSafeAdminQuery<T>(
  queryKey: readonly unknown[],
  queryFn: () => Promise<T>,
  fallback: T,
  enabled = true,
) {
  return useQuery<SafeQueryResult<T>>({
    queryKey,
    enabled,
    queryFn: async () => {
      try {
        return { data: await queryFn(), errorMessage: null };
      } catch (error) {
        return { data: fallback, errorMessage: getErrorMessage(error) };
      }
    },
    staleTime: 60_000,
  });
}

async function selectAdminRows(table: string, limit = 60) {
  return adminAPI.listTableRows(table, limit) as Promise<AdminRecord[]>;
}

async function countAdminTable(table: string) {
  const result = await adminAPI.countTableRows(table);
  return result.count || 0;
}

function useAdminRows(table: string, limit = 60) {
  return useSafeAdminQuery(["admin-rows", table, limit], () => selectAdminRows(table, limit), []);
}

function useAdminOrganizationModules(organizationId?: string) {
  return useSafeAdminQuery<OrganizationModuleRow[]>(
    ["admin-organization-modules", organizationId],
    async () => {
      if (!organizationId) return [];
      return adminAPI.listOrganizationModules(organizationId) as Promise<OrganizationModuleRow[]>;
    },
    [],
    Boolean(organizationId),
  );
}

function useAdminOrganizationPayments(organizationId?: string) {
  return useSafeAdminQuery<OrganizationPaymentRow[]>(
    ["admin-organization-payments", organizationId],
    async () => {
      if (!organizationId) return [];
      return [];
    },
    [],
    Boolean(organizationId),
  );
}

function AdminWarning({ message }: { message: string | null | undefined }) {
  if (!message) return null;

  return (
    <div className="flex items-start gap-3 rounded-[6px] bg-[#FF4529]/10 p-4 text-sm text-[#FFB3A6]">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <p className="font-medium text-[#FF806B]">Dados indisponíveis no momento</p>
        <p className="mt-1 text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}

function KpiCard({
  title,
  value,
  icon: Icon,
  helper,
}: {
  title: string;
  value: string | number;
  icon: ElementType;
  helper?: string;
}) {
  return (
    <div className="app-card card-hover min-h-[108px] p-3 sm:min-h-0 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase leading-snug tracking-wider text-muted-foreground sm:text-xs">{title}</p>
          <p className="mt-2 truncate text-xl font-semibold sm:text-2xl">{value}</p>
          {helper ? <p className="mt-1 text-[11px] leading-snug text-muted-foreground sm:text-xs">{helper}</p> : null}
        </div>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-[#FF4529]/12 text-[#FF4529] sm:h-10 sm:w-10">
          <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
        </span>
      </div>
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="app-card flex min-h-[260px] flex-col items-center justify-center p-8 text-center">
      <ShieldCheck className="mb-4 h-10 w-10 text-muted-foreground/50" />
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function AdminDashboardContent() {
  const organizations = useAdminRows("organizations", 100);
  const users = useAdminRows("users", 100);
  const plans = useAdminRows("admin_subscription_plans", 50);
  const onboarding = useAdminRows("onboarding_requests", 50);
  const requests = useAdminRows("feature_requests", 50);

  const orgRows = organizations.data?.data || [];
  const userRows = users.data?.data || [];
  const planRows = plans.data?.data || [];
  const onboardingRows = onboarding.data?.data || [];
  const requestRows = requests.data?.data || [];

  const activeOrgs = orgRows.filter((org) => org.is_active !== false).length;
  const trialOrgs = orgRows.filter((org) => getString(org, "subscription_status", "").toLowerCase() === "trial").length;
  const pendingRequests = requestRows.filter((request) => getString(request, "status", "").toLowerCase() === "pending").length;
  const pendingOnboarding = onboardingRows.filter((request) => {
    const status = getString(request, "status", "").toLowerCase();
    return status === "pending" || status === "new" || status === "submitted";
  }).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
        <KpiCard title="Organizações" value={formatNumber(orgRows.length)} icon={Building2} helper={`${activeOrgs} ativas`} />
        <KpiCard title="Usuários" value={formatNumber(userRows.length)} icon={Users} helper="Contas carregadas" />
        <KpiCard title="Planos" value={formatNumber(planRows.length)} icon={CreditCard} helper={`${trialOrgs} orgs em trial`} />
        <KpiCard title="Pendências" value={formatNumber(pendingRequests + pendingOnboarding)} icon={Inbox} helper="Onboarding e melhorias" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="app-card p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Saúde da carteira</h2>
              <p className="text-sm text-muted-foreground">Resumo visual das organizações carregadas.</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 md:gap-3">
            <StatusTile label="Ativas" value={activeOrgs} total={orgRows.length} tone="success" />
            <StatusTile label="Trial" value={trialOrgs} total={orgRows.length} tone="warning" />
            <StatusTile label="Inativas" value={Math.max(orgRows.length - activeOrgs, 0)} total={orgRows.length} tone="danger" />
          </div>
        </div>

        <div className="app-card p-4">
          <h2 className="text-base font-semibold">Próximas ações</h2>
          <div className="mt-4 space-y-3">
            {[
              "Validar schema final do Supabase novo antes de habilitar ações de escrita.",
              "Conectar métricas financeiras depois das tabelas de assinatura e Asaas ficarem definitivas.",
              "Revisar permissões RLS para leitura global exclusiva de superadmin.",
            ].map((item) => (
              <div key={item} className="app-card-soft flex gap-3 p-3 text-sm text-muted-foreground">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#FF4529]" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <RecentOrganizationsPreview rows={orgRows.slice(0, 6)} />
    </div>
  );
}

function RecentOrganizationsPreview({ rows }: { rows: AdminRecord[] }) {
  if (rows.length === 0) {
    return <EmptyState title="Organizações recentes" description="Nenhuma organização encontrada." />;
  }

  return (
    <div className="app-card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.045] px-4 py-3">
        <div>
          <h2 className="text-base font-semibold">Organizações recentes</h2>
          <p className="text-sm text-muted-foreground">{formatRecordsCount(rows.length)}</p>
        </div>
      </div>
      <div className="divide-y divide-white/[0.045]">
        {rows.map((row, index) => {
          const id = getString(row, "id", String(index));
          const status = getOrganizationStatus(row);
          const content = (
            <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 px-4 py-3 transition-colors hover:bg-[var(--app-surface-hover)]">
              <p className="min-w-0 truncate text-sm font-semibold">
                {getString(row, "name", "Organização sem nome")}
              </p>
              <StatusBadge value={status} activeLabel="Ativa" />
              <p className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(row.created_at)}</p>
            </div>
          );

          if (row.id) {
            return (
              <Link key={id} href={`/admin/organizations/${id}`} className="block">
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

function StatusTile({
  label,
  value,
  total,
  tone,
}: {
  label: string;
  value: number;
  total: number;
  tone: "success" | "warning" | "danger";
}) {
  const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
  const color = tone === "success" ? "bg-emerald-500" : tone === "warning" ? "bg-amber-500" : "bg-[#FF4529]";

  return (
    <div className="app-card-soft p-2.5 sm:p-4">
      <p className="truncate text-[11px] text-muted-foreground sm:text-sm">{label}</p>
      <div className="mt-2 flex items-end justify-between gap-2">
        <p className="truncate text-xl font-semibold sm:text-2xl">{formatNumber(value)}</p>
        <p className="pb-0.5 text-xs font-semibold sm:text-sm">{percentage}%</p>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--app-surface-hover)] sm:mt-4 sm:h-2">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
}

function OrganizationsContent() {
  const [search, setSearch] = useState("");
  const organizations = useAdminRows("organizations", 120);
  const rows = organizations.data?.data || [];
  const filteredRows = rows.filter((org) => {
    const haystack = [org.name, org.email, org.cnpj, org.cidade, org.subscription_status].map(normalizeText).join(" ");
    return haystack.includes(search.toLowerCase());
  });

  return (
    <div className="space-y-4">
      <AdminWarning message={organizations.data?.errorMessage} />
      <Toolbar search={search} onSearch={setSearch} placeholder="Buscar organização, CNPJ, cidade ou status..." />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {filteredRows.map((org) => (
          <Link key={getString(org, "id")} href={`/admin/organizations/${getString(org, "id")}`} className="app-card card-hover p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-base font-semibold">{getString(org, "name", "Organização sem nome")}</p>
                <p className="mt-1 text-xs text-muted-foreground">{getString(org, "email", "E-mail não informado")}</p>
              </div>
              <StatusBadge value={getOrganizationStatus(org)} activeLabel="Ativa" />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
              <MiniInfo label="CNPJ" value={getString(org, "cnpj", "--")} />
              <MiniInfo label="Usuários" value={getString(org, "max_users", "--")} />
              <MiniInfo label="Cidade" value={getString(org, "cidade", "--")} />
              <MiniInfo label="Criada em" value={formatDate(org.created_at)} />
            </div>
          </Link>
        ))}
      </div>
      {filteredRows.length === 0 && (
        <EmptyState
          title="Nenhuma organização na listagem"
          description="O Supabase conectado ainda não retornou organizações para este painel."
        />
      )}
    </div>
  );
}

export function OrganizationDetailContent({ organizationId }: { organizationId?: string }) {
  const organizations = useAdminRows("organizations", 200);
  const users = useAdminRows("users", 200);
  const organizationRows = useMemo(() => organizations.data?.data || [], [organizations.data?.data]);
  const organization = organizationRows.find((org) => getString(org, "id") === organizationId);
  const orgUsers = (users.data?.data || []).filter((user) => getString(user, "organization_id") === organizationId);
  const organizationsById = useMemo(() => {
    return new Map(organizationRows.map((org) => [getString(org, "id"), org]));
  }, [organizationRows]);

  if (!organization && organizations.isLoading) {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <VimobLoader label="Carregando organização..." />
      </div>
    );
  }

  if (!organization) {
    return (
      <div className="space-y-4">
        <AdminWarning message={organizations.data?.errorMessage} />
        <EmptyState
          title="Organização não encontrada"
          description="A rota existe, mas a organização não foi retornada pelo Supabase conectado."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="app-card p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Organização</p>
            <h2 className="mt-2 text-2xl font-semibold">{getString(organization, "name")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{getString(organization, "email", "E-mail não informado")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge value={getOrganizationStatus(organization)} activeLabel="Ativa" />
          </div>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-4">
          <MiniInfo label="CNPJ" value={getString(organization, "cnpj", "--")} />
          <MiniInfo label="Segmento" value={formatFieldValue(organization, "segment")} />
          <MiniInfo label="WhatsApp" value={getString(organization, "whatsapp", "--")} />
          <MiniInfo label="Criada em" value={formatDate(organization.created_at)} />
        </div>
      </div>

      <UsersRowsPreview
        title="Usuários vinculados"
        rows={orgUsers}
        organizationsById={organizationsById}
        empty="Nenhum usuário retornado para esta organização."
      />
    </div>
  );
}

function OrganizationDetailManagementContent({ organizationId }: { organizationId?: string }) {
  const queryClient = useQueryClient();
  const organizations = useAdminRows("organizations", 200);
  const users = useAdminRows("users", 200);
  const modulesQuery = useAdminOrganizationModules(organizationId);
  const paymentsQuery = useAdminOrganizationPayments(organizationId);
  const { plans, isLoading: plansLoading } = useAdminPlans();
  const organizationRows = useMemo(() => organizations.data?.data || [], [organizations.data?.data]);
  const organization = organizationRows.find((org) => getString(org, "id") === organizationId);
  const orgUsers = (users.data?.data || []).filter((user) => getString(user, "organization_id") === organizationId);
  const moduleRows = useMemo(() => modulesQuery.data?.data || [], [modulesQuery.data?.data]);
  const payments = useMemo(() => paymentsQuery.data?.data || [], [paymentsQuery.data?.data]);
  const currentPlan = useMemo(() => {
    const planId = getOptionalString(organization, "plan_id");
    return plans.find((plan) => plan.id === planId) || null;
  }, [organization, plans]);
  const paidPayments = useMemo(() => payments.filter(isPaidPayment), [payments]);
  const latestPaidPayment = paidPayments[0];
  const firstPaidPayment = paidPayments[paidPayments.length - 1];
  const [accessForm, setAccessForm] = useState<OrganizationAccessForm>({
    planId: NO_PLAN_VALUE,
    subscriptionStatus: "active",
    maxUsers: "",
    maxWhatsappSessions: "",
    subscriptionValue: "",
    billingDay: "",
    nextBillingDate: "",
    trialEndsAt: "",
    modules: [...DEFAULT_PLAN_MODULES],
  });
  const organizationsById = useMemo(() => {
    return new Map(organizationRows.map((org) => [getString(org, "id"), org]));
  }, [organizationRows]);
  const updateOrganizationAccess = useMutation({
    mutationFn: async (payload: {
      organizationId: string;
      organizationUpdates: OrganizationUpdatePayload;
      modules: SystemModuleKey[];
    }) => {
      await adminAPI.updateOrganizationAccess({
        organizationId: payload.organizationId,
        organizationUpdates: payload.organizationUpdates,
        modules: payload.modules,
      });
    },
    onSuccess: async (_, variables) => {
      toast.success("Acessos da organização atualizados.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-rows", "organizations"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-organization-modules", variables.organizationId] }),
        queryClient.invalidateQueries({ queryKey: ["organization-modules", variables.organizationId] }),
        queryClient.invalidateQueries({ queryKey: ["super-admin-organizations"] }),
      ]);
    },
    onError: (error) => {
      toast.error(`Erro ao salvar acessos: ${getErrorMessage(error)}`);
    },
  });

  useEffect(() => {
    if (!organization) return;

    const planModules = normalizePlanModules(currentPlan?.modules);
    const fallbackModules = planModules.length > 0 ? planModules : [...DEFAULT_PLAN_MODULES];
    const enabledModules = getEnabledModulesFromRows(moduleRows, fallbackModules);

    // eslint-disable-next-line react-hooks/set-state-in-effect -- Sincroniza o formulario quando a organizacao carregada muda.
    setAccessForm({
      planId: getOptionalString(organization, "plan_id") || NO_PLAN_VALUE,
      subscriptionStatus: getRecordInputValue(organization, "subscription_status") || "active",
      maxUsers: getRecordInputValue(organization, "max_users"),
      maxWhatsappSessions: getRecordInputValue(organization, "max_whatsapp_sessions_override"),
      subscriptionValue: getRecordInputValue(organization, "subscription_value"),
      billingDay: getRecordInputValue(organization, "billing_day"),
      nextBillingDate: getDateInputValue(organization.next_billing_date),
      trialEndsAt: getDateInputValue(organization.trial_ends_at),
      modules: enabledModules,
    });
  }, [organization, currentPlan, moduleRows]);

  const updateAccessForm = <K extends keyof OrganizationAccessForm>(key: K, value: OrganizationAccessForm[K]) => {
    setAccessForm((current) => ({ ...current, [key]: value }));
  };

  const handlePlanChange = (planId: string) => {
    const selectedPlan = plans.find((plan) => plan.id === planId);
    setAccessForm((current) => {
      if (!selectedPlan) {
        return { ...current, planId };
      }

      const planModules = normalizePlanModules(selectedPlan.modules);
      return {
        ...current,
        planId,
        subscriptionValue: String(selectedPlan.price || 0),
        maxUsers: stringFromNullableNumber(selectedPlan.max_users) || current.maxUsers,
        maxWhatsappSessions: stringFromNullableNumber(selectedPlan.max_whatsapp_sessions),
        modules: planModules.length > 0 ? planModules : current.modules,
      };
    });
  };

  const toggleOrganizationModule = (moduleKey: SystemModuleKey) => {
    setAccessForm((current) => {
      const enabled = current.modules.includes(moduleKey);
      return {
        ...current,
        modules: enabled
          ? current.modules.filter((module) => module !== moduleKey)
          : [...current.modules, moduleKey],
      };
    });
  };

  const handleSaveAccess = async () => {
    if (!organizationId || !organization) return;

    const selectedPlan = plans.find((plan) => plan.id === accessForm.planId);
    const maxUsersFallback = Number(organization.max_users || 1);
    const organizationUpdates: OrganizationUpdatePayload = {
      plan_id: accessForm.planId === NO_PLAN_VALUE ? null : accessForm.planId,
      subscription_status: accessForm.subscriptionStatus || "active",
      subscription_value: parseNullableNumberInput(accessForm.subscriptionValue),
      max_users: Math.max(1, parseNumberInput(accessForm.maxUsers, maxUsersFallback)),
      max_whatsapp_sessions_override: parseNullableNumberInput(accessForm.maxWhatsappSessions),
      billing_day: parseNullableNumberInput(accessForm.billingDay),
      next_billing_date: accessForm.nextBillingDate || null,
      trial_ends_at: accessForm.trialEndsAt ? new Date(`${accessForm.trialEndsAt}T23:59:59`).toISOString() : null,
      subscription_type: selectedPlan ? "paid" : getOptionalString(organization, "subscription_type") || null,
    };

    await updateOrganizationAccess.mutateAsync({
      organizationId,
      organizationUpdates,
      modules: accessForm.modules,
    });
  };

  if (!organization && organizations.isLoading) {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <VimobLoader label="Carregando organização..." />
      </div>
    );
  }

  if (!organization) {
    return (
      <div className="space-y-4">
        <AdminWarning message={organizations.data?.errorMessage} />
        <EmptyState
          title="Organização não encontrada"
          description="A rota existe, mas a organização não foi retornada pelo Supabase conectado."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <AdminWarning message={modulesQuery.data?.errorMessage || paymentsQuery.data?.errorMessage} />

      <div className="app-card p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Organização</p>
            <h2 className="mt-2 text-2xl font-semibold">{getString(organization, "name")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{getString(organization, "email", "E-mail não informado")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge value={getOrganizationStatus(organization)} activeLabel="Ativa" />
          </div>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-4">
          <MiniInfo label="CNPJ" value={getString(organization, "cnpj", "--")} />
          <MiniInfo label="Segmento" value={formatFieldValue(organization, "segment")} />
          <MiniInfo label="WhatsApp" value={getString(organization, "whatsapp", "--")} />
          <MiniInfo label="Criada em" value={formatDate(organization.created_at)} />
        </div>
      </div>

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.1fr)_minmax(560px,0.9fr)]">
        <div className="app-card p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-base font-semibold">Acessos, plano e limites</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Ajuste manualmente o que esta organização pode usar, sem depender de uma nova contratação.
              </p>
            </div>
            <Button
              onClick={handleSaveAccess}
              disabled={updateOrganizationAccess.isPending}
              className="h-10 rounded-[6px] bg-[#FF4529] text-white hover:bg-[#FF4529]/90"
            >
              {updateOrganizationAccess.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Salvar acessos
            </Button>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="organization-plan">Plano comercial</Label>
              <select
                id="organization-plan"
                value={accessForm.planId}
                disabled={plansLoading}
                onChange={(event) => handlePlanChange(event.target.value)}
                className="h-10 w-full rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-sm outline-none"
              >
                <option value={NO_PLAN_VALUE}>Sem plano vinculado</option>
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name} - {formatCurrency(plan.price)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="organization-status">Status</Label>
              <select
                id="organization-status"
                value={accessForm.subscriptionStatus}
                onChange={(event) => updateAccessForm("subscriptionStatus", event.target.value)}
                className="h-10 w-full rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-sm outline-none"
              >
                <option value="trial">Trial</option>
                <option value="active">Ativa</option>
                <option value="pending_payment">Pagamento pendente</option>
                <option value="overdue">Atrasada</option>
                <option value="blocked">Bloqueada</option>
                <option value="cancelled">Cancelada</option>
              </select>
            </div>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-5">
            <div className="space-y-2">
              <Label htmlFor="organization-max-users">Usuários</Label>
              <Input
                id="organization-max-users"
                inputMode="numeric"
                value={accessForm.maxUsers}
                onChange={(event) => updateAccessForm("maxUsers", event.target.value)}
                className="border-0 bg-[var(--app-surface-soft)]"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="organization-whatsapp">WhatsApp</Label>
              <Input
                id="organization-whatsapp"
                inputMode="numeric"
                value={accessForm.maxWhatsappSessions}
                onChange={(event) => updateAccessForm("maxWhatsappSessions", event.target.value)}
                placeholder="Sem limite"
                className="border-0 bg-[var(--app-surface-soft)]"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="organization-value">Valor mensal</Label>
              <Input
                id="organization-value"
                inputMode="decimal"
                value={accessForm.subscriptionValue}
                onChange={(event) => updateAccessForm("subscriptionValue", event.target.value)}
                className="border-0 bg-[var(--app-surface-soft)]"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="organization-billing-day">Dia cobrança</Label>
              <Input
                id="organization-billing-day"
                inputMode="numeric"
                value={accessForm.billingDay}
                onChange={(event) => updateAccessForm("billingDay", event.target.value)}
                placeholder="Ex.: 10"
                className="border-0 bg-[var(--app-surface-soft)]"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="organization-next-billing">Próximo vencimento</Label>
              <Input
                id="organization-next-billing"
                type="date"
                value={accessForm.nextBillingDate}
                onChange={(event) => updateAccessForm("nextBillingDate", event.target.value)}
                className="border-0 bg-[var(--app-surface-soft)]"
              />
            </div>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="organization-trial-end">Fim do trial</Label>
              <Input
                id="organization-trial-end"
                type="date"
                value={accessForm.trialEndsAt}
                onChange={(event) => updateAccessForm("trialEndsAt", event.target.value)}
                className="border-0 bg-[var(--app-surface-soft)]"
              />
            </div>
            <MiniInfo label="Plano salvo" value={currentPlan?.name || "Sem plano"} />
            <MiniInfo label="Módulos ativos" value={formatNumber(accessForm.modules.length)} />
          </div>

          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Módulos liberados</Label>
              <span className="text-xs text-muted-foreground">{accessForm.modules.length} ativos</span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              {SYSTEM_MODULES.map((module) => {
                const checked = accessForm.modules.includes(module.key);

                return (
                  <button
                    key={module.key}
                    type="button"
                    aria-pressed={checked}
                    onClick={() => toggleOrganizationModule(module.key)}
                    className={cn(
                      "flex h-10 items-center justify-between gap-2 rounded-[6px] px-2.5 text-left text-xs font-medium transition-colors",
                      checked
                        ? "bg-[#FF4529] text-white shadow-sm"
                        : "bg-[var(--app-surface-soft)] text-muted-foreground hover:bg-[var(--app-surface-hover)] hover:text-foreground",
                    )}
                  >
                    <span className="truncate">{module.label}</span>
                    <Check className={cn("h-3.5 w-3.5 shrink-0", !checked && "opacity-0")} strokeWidth={1.9} />
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="app-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Resumo financeiro</h2>
                <p className="mt-1 text-sm text-muted-foreground">Plano, vencimentos e cobrança Asaas.</p>
              </div>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px] bg-[#FF4529]/12 text-[#FF4529]">
                <CreditCard className="h-5 w-5" />
              </span>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-2">
              <MiniInfo label="Plano atual" value={currentPlan?.name || "Sem plano vinculado"} />
              <MiniInfo label="Valor" value={formatCurrency(organization.subscription_value || currentPlan?.price)} />
              <MiniInfo
                label="Próximo vencimento"
                value={`${formatDateOnly(organization.next_billing_date)}${
                  getDaysUntil(organization.next_billing_date) !== null ? ` (${getDaysUntil(organization.next_billing_date)} dias)` : ""
                }`}
              />
              <MiniInfo
                label="Trial"
                value={`${formatDateOnly(organization.trial_ends_at)}${
                  getDaysUntil(organization.trial_ends_at) !== null ? ` (${getDaysUntil(organization.trial_ends_at)} dias)` : ""
                }`}
              />
              <MiniInfo label="Primeiro pagamento" value={firstPaidPayment ? formatDateOnly(firstPaidPayment.payment_date || firstPaidPayment.due_date) : "--"} />
              <MiniInfo label="Último pagamento" value={latestPaidPayment ? formatDateOnly(latestPaidPayment.payment_date || latestPaidPayment.due_date) : "--"} />
              <MiniInfo label="Cliente Asaas" value={getString(organization, "asaas_customer_id", "--")} />
              <MiniInfo label="Assinatura Asaas" value={getString(organization, "asaas_subscription_id", "--")} />
            </div>
          </div>

          <div className="app-card overflow-hidden">
            <div className="flex items-center justify-between gap-3 p-4">
              <div>
                <h2 className="text-base font-semibold">Histórico de pagamentos</h2>
                <p className="text-sm text-muted-foreground">{formatRecordsCount(payments.length)}</p>
              </div>
              <CalendarDays className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="divide-y divide-white/[0.045]">
              {payments.slice(0, 8).map((payment) => (
                <div key={payment.id} className="grid gap-2 p-4 text-sm sm:grid-cols-[1fr_auto]">
                  <div className="min-w-0">
                    <p className="font-medium">{formatCurrency(payment.value)}</p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {payment.billing_type || "Cobrança"} · vence em {formatDateOnly(payment.due_date)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 sm:justify-end">
                    <Badge className="border-0 bg-[var(--app-surface-soft)] text-muted-foreground">
                      {getPaymentStatusLabel(payment.status)}
                    </Badge>
                    {payment.invoice_url ? (
                      <Button asChild variant="outline" size="sm" className="h-8 border-0 bg-[var(--app-surface-soft)]">
                        <a href={payment.invoice_url} target="_blank" rel="noreferrer">
                          Abrir
                        </a>
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
              {payments.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">Nenhum pagamento registrado para esta organização.</div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <UsersRowsPreview
        title="Usuários vinculados"
        rows={orgUsers}
        organizationsById={organizationsById}
        empty="Nenhum usuário retornado para esta organização."
      />
    </div>
  );
}

function getOrganizationName(user: AdminRecord, organizationsById: Map<string, AdminRecord>) {
  const organizationId = getOptionalString(user, "organization_id");
  if (!organizationId) return "Plataforma";
  const organization = organizationsById.get(organizationId);
  return getString(organization, "name", "Organização não encontrada");
}

function UserMetaTile({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 rounded-[6px] bg-[var(--app-surface-soft)] px-3 py-2", className)}>
      <p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-xs font-medium">{value}</p>
    </div>
  );
}

function UsersRowsPreview({
  title,
  rows,
  organizationsById,
  empty,
}: {
  title: string;
  rows: AdminRecord[];
  organizationsById: Map<string, AdminRecord>;
  empty: string;
}) {
  if (rows.length === 0) {
    return <EmptyState title={title} description={empty} />;
  }

  return (
    <div className="app-card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.045] p-4">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">{formatRecordsCount(rows.length)}</p>
        </div>
      </div>

      <div className="hidden grid-cols-[minmax(260px,1.6fr)_130px_110px_minmax(180px,1fr)_145px] gap-4 border-b border-white/[0.045] px-4 py-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground lg:grid">
        <span>Usuário</span>
        <span>Perfil</span>
        <span>Status</span>
        <span>Organização</span>
        <span>Criado em</span>
      </div>

      <div className="divide-y divide-white/[0.045]">
        {rows.map((user, index) => {
          const id = getString(user, "id", String(index));
          const name = getString(user, "name", "Usuário sem nome");
          const email = getString(user, "email", "E-mail não informado");
          const avatarUrl = getOptionalString(user, "avatar_url");
          const organizationName = getOrganizationName(user, organizationsById);
          const roleLabel = formatFieldValue(user, "role");
          const createdAt = formatDate(user.created_at);

          return (
            <div
              key={id}
              className="transition-colors hover:bg-[var(--app-surface-hover)]"
            >
              <div className="p-4 lg:hidden">
                <div className="flex items-start gap-3">
                  <Avatar className="h-10 w-10 shrink-0 border border-white/[0.055]">
                    {avatarUrl ? <AvatarImage src={avatarUrl} className="object-cover" /> : <AvatarImage src={undefined} />}
                    <AvatarFallback className="bg-[#FF4529]/12 text-xs font-semibold text-[#FF4529]">
                      {getInitials(name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{name}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{email}</p>
                  </div>
                  <StatusBadge value={user.is_active !== false} />
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <UserMetaTile label="Perfil" value={roleLabel} />
                  <UserMetaTile label="Criado em" value={createdAt} />
                  <UserMetaTile label="Organização" value={organizationName} className="col-span-2" />
                </div>
              </div>

              <div className="hidden gap-4 px-4 py-3 lg:grid lg:grid-cols-[minmax(260px,1.6fr)_130px_110px_minmax(180px,1fr)_145px] lg:items-center">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar className="h-9 w-9 shrink-0 border border-white/[0.055]">
                    {avatarUrl ? <AvatarImage src={avatarUrl} className="object-cover" /> : <AvatarImage src={undefined} />}
                    <AvatarFallback className="bg-[#FF4529]/12 text-xs font-semibold text-[#FF4529]">
                      {getInitials(name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{name}</p>
                    <p className="truncate text-xs text-muted-foreground">{email}</p>
                  </div>
                </div>

                <div className="min-w-0">
                  <p className="truncate text-sm">{roleLabel}</p>
                </div>

                <div className="min-w-0">
                  <StatusBadge value={user.is_active !== false} />
                </div>

                <div className="min-w-0">
                  <p className="truncate text-sm">{organizationName}</p>
                </div>

                <div className="min-w-0">
                  <p className="truncate text-sm text-muted-foreground">{createdAt}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function UsersContent() {
  const [search, setSearch] = useState("");
  const users = useAdminRows("users", 160);
  const organizations = useAdminRows("organizations", 200);
  const rows = users.data?.data || [];
  const organizationRows = useMemo(() => organizations.data?.data || [], [organizations.data?.data]);
  const organizationsById = useMemo(() => {
    return new Map(organizationRows.map((org) => [getString(org, "id"), org]));
  }, [organizationRows]);
  const filteredRows = rows.filter((user) => {
    const organizationName = getOrganizationName(user, organizationsById);
    const haystack = [user.name, user.email, user.role, user.organization_id, organizationName].map(normalizeText).join(" ");
    return haystack.includes(search.toLowerCase());
  });

  return (
    <div className="space-y-4">
      <AdminWarning message={users.data?.errorMessage} />
      <Toolbar search={search} onSearch={setSearch} placeholder="Buscar usuário, e-mail, papel ou organização..." />
      <UsersRowsPreview
        title="Usuários da plataforma"
        rows={filteredRows}
        organizationsById={organizationsById}
        empty="Nenhum usuário retornado pelo Supabase conectado."
      />
    </div>
  );
}

type PlanFormState = {
  slug: string;
  name: string;
  description: string;
  price: string;
  billing_cycle: string;
  trial_enabled: boolean;
  trial_days: string;
  max_users: string;
  max_leads: string;
  max_whatsapp_sessions: string;
  modules: SystemModuleKey[];
  is_active: boolean;
  is_public: boolean;
};

const SYSTEM_MODULE_KEY_SET = new Set<string>(SYSTEM_MODULES.map((module) => module.key));

const DEFAULT_PLAN_FORM: PlanFormState = {
  slug: "",
  name: "",
  description: "",
  price: "0",
  billing_cycle: "monthly",
  trial_enabled: false,
  trial_days: "",
  max_users: "",
  max_leads: "",
  max_whatsapp_sessions: "",
  modules: DEFAULT_PLAN_MODULES,
  is_active: true,
  is_public: true,
};

function slugifyPlanName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function stringFromNullableNumber(value: number | null | undefined) {
  return value === null || value === undefined ? "" : String(value);
}

function normalizePlanModules(modules: string[] | null | undefined) {
  return (modules || []).filter((module): module is SystemModuleKey => SYSTEM_MODULE_KEY_SET.has(module));
}

function planToFormState(plan: SubscriptionPlan): PlanFormState {
  return {
    slug: plan.slug || "",
    name: plan.name || "",
    description: plan.description || "",
    price: String(plan.price || 0),
    billing_cycle: plan.billing_cycle || "monthly",
    trial_enabled: Boolean(plan.trial_enabled),
    trial_days: stringFromNullableNumber(plan.trial_days),
    max_users: stringFromNullableNumber(plan.max_users),
    max_leads: stringFromNullableNumber(plan.max_leads),
    max_whatsapp_sessions: stringFromNullableNumber(plan.max_whatsapp_sessions),
    modules: normalizePlanModules(plan.modules),
    is_active: plan.is_active !== false,
    is_public: plan.is_public !== false,
  };
}

function parseNumberInput(value: string, fallback = 0) {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return fallback;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseNullableNumberInput(value: string) {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function planFormToPayload(form: PlanFormState) {
  return {
    slug: form.slug.trim() || slugifyPlanName(form.name),
    name: form.name.trim(),
    description: form.description.trim() || null,
    price: parseNumberInput(form.price),
    billing_cycle: form.billing_cycle.trim() || "monthly",
    trial_enabled: form.trial_enabled,
    trial_days: parseNullableNumberInput(form.trial_days),
    max_users: parseNullableNumberInput(form.max_users),
    max_leads: parseNullableNumberInput(form.max_leads),
    max_whatsapp_sessions: parseNullableNumberInput(form.max_whatsapp_sessions),
    modules: form.modules,
    is_active: form.is_active,
    is_public: form.is_public,
  };
}

function PlansContent() {
  const { plans, isLoading, error, createPlan, updatePlan } = useAdminPlans();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<SubscriptionPlan | null>(null);
  const [form, setForm] = useState<PlanFormState>(() => ({
    ...DEFAULT_PLAN_FORM,
    modules: [...DEFAULT_PLAN_FORM.modules],
  }));
  const isSaving = createPlan.isPending || updatePlan.isPending;

  const openCreateDialog = () => {
    setEditingPlan(null);
    setForm({ ...DEFAULT_PLAN_FORM, modules: [...DEFAULT_PLAN_FORM.modules] });
    setDialogOpen(true);
  };

  const openEditDialog = (plan: SubscriptionPlan) => {
    setEditingPlan(plan);
    setForm(planToFormState(plan));
    setDialogOpen(true);
  };

  const updateForm = <K extends keyof PlanFormState>(key: K, value: PlanFormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const toggleModule = (moduleKey: SystemModuleKey) => {
    setForm((current) => {
      const enabled = current.modules.includes(moduleKey);
      return {
        ...current,
        modules: enabled
          ? current.modules.filter((module) => module !== moduleKey)
          : [...current.modules, moduleKey],
      };
    });
  };

  const handleNameChange = (value: string) => {
    setForm((current) => ({
      ...current,
      name: value,
      slug: current.slug || slugifyPlanName(value),
    }));
  };

  const handleSubmitPlan = async () => {
    const payload = planFormToPayload(form);
    try {
      if (editingPlan) {
        await updatePlan.mutateAsync({ id: editingPlan.id, ...payload });
      } else {
        await createPlan.mutateAsync(payload);
      }
      setDialogOpen(false);
    } catch {
      // Toast is handled by the mutation hook.
    }
  };

  return (
    <div className="space-y-4">
      <AdminWarning message={error instanceof Error ? error.message : null} />

      <div className="app-card flex items-center justify-between gap-3 p-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Planos comerciais</h2>
          <p className="text-sm text-muted-foreground">{formatRecordsCount(plans.length)}</p>
        </div>
        <Button
          onClick={openCreateDialog}
          size="icon"
          className="h-10 w-10 shrink-0 rounded-[6px] bg-[#FF4529] text-white hover:bg-[#FF4529]/90 sm:w-auto sm:px-4"
          aria-label="Novo plano"
          title="Novo plano"
        >
          <Plus className="h-4 w-4" strokeWidth={1.7} />
          <span className="sr-only sm:not-sr-only">Novo plano</span>
        </Button>
      </div>

      {isLoading ? (
        <div className="flex min-h-[220px] items-center justify-center">
          <VimobLoader label="Carregando planos..." />
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {plans.map((plan) => (
            <div key={plan.id} className="app-card p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold">{plan.name}</p>
                </div>
                <StatusBadge value={plan.is_active !== false} />
              </div>

              <div className="mt-3 flex items-end justify-between gap-3">
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Preço</p>
                  <p className="mt-0.5 text-2xl font-semibold">{formatCurrency(plan.price)}</p>
                </div>
                <Badge className="border-0 bg-[var(--app-surface-soft)] text-muted-foreground">
                  {formatFieldValue(plan as unknown as AdminRecord, "billing_cycle")}
                </Badge>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <PlanInfoTile label="Usuários" value={stringFromNullableNumber(plan.max_users) || "--"} />
                <PlanInfoTile label="WhatsApp" value={stringFromNullableNumber(plan.max_whatsapp_sessions) || "--" } />
                <PlanInfoTile label="Leads" value={stringFromNullableNumber(plan.max_leads) || "--"} />
                <PlanInfoTile label="Trial" value={plan.trial_enabled ? `${plan.trial_days || 0} dias` : "Não"} />
              </div>

              {(plan.modules || []).length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {(plan.modules || []).slice(0, 6).map((module) => (
                    <Badge key={module} className="border-0 bg-[#FF4529]/10 px-2 py-0.5 text-[11px] text-[#FF806B]">
                      {getSystemModuleLabel(module)}
                    </Badge>
                  ))}
                  {(plan.modules || []).length > 6 ? (
                    <Badge className="border-0 bg-[var(--app-surface-soft)] px-2 py-0.5 text-[11px] text-muted-foreground">
                      +{(plan.modules || []).length - 6}
                    </Badge>
                  ) : null}
                </div>
              ) : null}

              <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/[0.045] pt-2.5">
                <span className="text-xs text-muted-foreground">{plan.is_public === false ? "Interno" : "Público"}</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 w-9 border-0 bg-[var(--app-surface-soft)] px-0 sm:w-auto sm:px-3"
                  onClick={() => openEditDialog(plan)}
                  aria-label="Editar plano"
                  title="Editar plano"
                >
                  <Pencil className="h-3.5 w-3.5" strokeWidth={1.7} />
                  <span className="sr-only sm:not-sr-only">Editar</span>
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!isLoading && plans.length === 0 && (
        <EmptyState title="Nenhum plano carregado" description="Crie o primeiro plano comercial para disponibilizar no onboarding." />
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto rounded-[8px] p-0">
          <DialogHeader className="border-b border-white/[0.045] px-4 py-3">
            <DialogTitle className="text-base">{editingPlan ? "Editar plano" : "Novo plano"}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-3 px-4 py-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="plan-name">Nome</Label>
                <Input
                  id="plan-name"
                  value={form.name}
                  onChange={(event) => handleNameChange(event.target.value)}
                  placeholder="Starter"
                  className="border-0 bg-[var(--app-surface-soft)]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="plan-slug">Slug</Label>
                <Input
                  id="plan-slug"
                  value={form.slug}
                  onChange={(event) => updateForm("slug", slugifyPlanName(event.target.value))}
                  placeholder="starter"
                  className="border-0 bg-[var(--app-surface-soft)]"
                />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="plan-price">Preço</Label>
                <Input
                  id="plan-price"
                  inputMode="decimal"
                  value={form.price}
                  onChange={(event) => updateForm("price", event.target.value)}
                  className="border-0 bg-[var(--app-surface-soft)]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="plan-cycle">Ciclo</Label>
                <select
                  id="plan-cycle"
                  value={form.billing_cycle}
                  onChange={(event) => updateForm("billing_cycle", event.target.value)}
                  className="h-10 w-full rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-sm outline-none"
                >
                  <option value="monthly">Mensal</option>
                  <option value="quarterly">Trimestral</option>
                  <option value="annual">Anual</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="plan-trial-days">Dias de trial</Label>
                <Input
                  id="plan-trial-days"
                  inputMode="numeric"
                  disabled={!form.trial_enabled}
                  value={form.trial_days}
                  onChange={(event) => updateForm("trial_days", event.target.value)}
                  className="border-0 bg-[var(--app-surface-soft)] disabled:opacity-50"
                />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="plan-users">Máx. usuários</Label>
                <Input
                  id="plan-users"
                  inputMode="numeric"
                  value={form.max_users}
                  onChange={(event) => updateForm("max_users", event.target.value)}
                  className="border-0 bg-[var(--app-surface-soft)]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="plan-whatsapp">Máx. WhatsApp</Label>
                <Input
                  id="plan-whatsapp"
                  inputMode="numeric"
                  value={form.max_whatsapp_sessions}
                  onChange={(event) => updateForm("max_whatsapp_sessions", event.target.value)}
                  className="border-0 bg-[var(--app-surface-soft)]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="plan-leads">Máx. leads</Label>
                <Input
                  id="plan-leads"
                  inputMode="numeric"
                  value={form.max_leads}
                  onChange={(event) => updateForm("max_leads", event.target.value)}
                  className="border-0 bg-[var(--app-surface-soft)]"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>Módulos</Label>
                <span className="text-xs text-muted-foreground">{form.modules.length} ativos</span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {SYSTEM_MODULES.map((module) => {
                  const checked = form.modules.includes(module.key);

                  return (
                    <button
                      key={module.key}
                      type="button"
                      aria-pressed={checked}
                      onClick={() => toggleModule(module.key)}
                      className={cn(
                        "flex h-9 items-center justify-between gap-2 rounded-[6px] px-2.5 text-left text-xs font-medium transition-colors",
                        checked
                          ? "bg-[#FF4529] text-white shadow-sm"
                          : "bg-[var(--app-surface-soft)] text-muted-foreground hover:bg-[var(--app-surface-hover)] hover:text-foreground",
                      )}
                    >
                      <span className="truncate">{module.label}</span>
                      <Check className={cn("h-3.5 w-3.5 shrink-0", !checked && "opacity-0")} strokeWidth={1.9} />
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <label className="app-card-soft flex items-center justify-between gap-3 p-2.5">
                <span className="text-sm">Trial ativo</span>
                <Switch checked={form.trial_enabled} onCheckedChange={(checked) => updateForm("trial_enabled", checked)} />
              </label>
              <label className="app-card-soft flex items-center justify-between gap-3 p-2.5">
                <span className="text-sm">Plano ativo</span>
                <Switch checked={form.is_active} onCheckedChange={(checked) => updateForm("is_active", checked)} />
              </label>
              <label className="app-card-soft flex items-center justify-between gap-3 p-2.5">
                <span className="text-sm">Público</span>
                <Switch checked={form.is_public} onCheckedChange={(checked) => updateForm("is_public", checked)} />
              </label>
            </div>
          </div>

          <DialogFooter className="border-t border-white/[0.045] px-4 py-3">
            <Button variant="outline" className="border-0 bg-[var(--app-surface-soft)]" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button className="bg-[#FF4529] text-white hover:bg-[#FF4529]/90" onClick={handleSubmitPlan} disabled={isSaving}>
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {editingPlan ? "Salvar plano" : "Criar plano"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function GenericTableSection({ section }: { section: AdminSection }) {
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
  const filteredRows = rows.filter((row) =>
    tableConfig.fields.some((field) => normalizeText(row[field]).includes(search.toLowerCase())),
  );

  return (
    <div className="space-y-4">
      <AdminWarning message={query.data?.errorMessage} />
      <Toolbar search={search} onSearch={setSearch} placeholder={`Buscar em ${tableConfig.title.toLowerCase()}...`} />
      <GenericRowsPreview title={tableConfig.title} rows={filteredRows} fields={tableConfig.fields} empty={tableConfig.empty} />
    </div>
  );
}

function DatabaseContent() {
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

  const countByTable = new Map((counts.data?.data || []).map((item) => [item.table, item]));
  const configured = LEGACY_TABLES.filter((item) => !countByTable.get(item.name)?.errorMessage).length;
  const criticalMissing = LEGACY_TABLES.filter((item) => item.critical && countByTable.get(item.name)?.errorMessage).length;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard title="Tabelas mapeadas" value={LEGACY_TABLES.length} icon={Database} />
        <KpiCard title="Respondendo" value={configured} icon={CheckCircle2} />
        <KpiCard title="Críticas pendentes" value={criticalMissing} icon={AlertTriangle} />
      </div>

      <div className="app-card p-4">
        <div className="mb-4">
          <h2 className="text-base font-semibold">Checklist visual de estrutura</h2>
          <p className="text-sm text-muted-foreground">
            Checagem feita via cliente Supabase da aplicação. Não executei SQL manual nem alterei schema.
          </p>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {LEGACY_TABLES.map((item) => {
            const result = countByTable.get(item.name);
            const error = result?.errorMessage;
            return (
              <div key={item.name} className="app-card-soft flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="font-medium">{item.label}</p>
                  <p className="truncate text-xs text-muted-foreground">{item.name}</p>
                </div>
                <Badge className={cn("border-0", error ? "bg-amber-500/12 text-amber-400" : "bg-emerald-500/12 text-emerald-400")}>
                  {error ? "Pendente" : `${formatNumber(result?.count)} registros`}
                </Badge>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AiContent() {
  return <AiAgentsContent />;
}

function SettingsContent({ technical = false }: { technical?: boolean }) {
  const settings = useAdminRows("system_settings", 20);
  const rows = settings.data?.data || [];
  const first = rows[0];
  const fields = technical
    ? ["key", "description", "updated_at", "created_at"]
    : ["key", "logo_url_light", "logo_url_dark", "maintenance_mode", "updated_at"];

  return (
    <div className="space-y-4">
      <AdminWarning message={settings.data?.errorMessage} />
      <div className="grid gap-3 md:grid-cols-3">
        <KpiCard title="Registros" value={formatNumber(rows.length)} icon={Settings} />
        <KpiCard title="Manutenção" value={getString(first, "maintenance_mode", "Não")} icon={AlertTriangle} />
        <KpiCard title="Última atualização" value={formatDate(first?.updated_at)} icon={Activity} />
      </div>
      <GenericRowsPreview
        title={technical ? "Configurações técnicas" : "Configurações administrativas"}
        rows={rows}
        fields={fields}
        empty="Nenhuma configuração global encontrada."
      />
    </div>
  );
}

function Toolbar({
  search,
  onSearch,
  placeholder,
}: {
  search: string;
  onSearch: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="app-card p-2">
      <div className="relative w-full md:max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder={placeholder}
          className="h-10 border-0 bg-[var(--app-surface-soft)] pl-9 pr-10"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            "absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 rounded-[6px] text-muted-foreground hover:bg-[var(--app-surface-hover)] hover:text-foreground",
            !search && "pointer-events-none opacity-35",
          )}
          onClick={() => onSearch("")}
          aria-label="Limpar filtros"
          title="Limpar filtros"
        >
          <X className="h-4 w-4" strokeWidth={1.7} />
        </Button>
      </div>
    </div>
  );
}

function MiniInfo({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[6px] bg-[var(--app-surface-soft)] p-3">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-medium">{value}</p>
    </div>
  );
}

function PlanInfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[6px] bg-[var(--app-surface-soft)] px-2.5 py-2">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-sm font-semibold">{value}</p>
    </div>
  );
}

function GenericRowsPreview({
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
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.045] p-4">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">{formatRecordsCount(rows.length)}</p>
        </div>
      </div>
      <div className="divide-y divide-white/[0.045]">
        {rows.map((row, index) => {
          const id = getString(row, "id", String(index));
          const content = (
            <div className="grid gap-3 p-4 transition-colors hover:bg-[var(--app-surface-hover)] md:grid-cols-4">
              {fields.map((field) => (
                <div key={field} className="min-w-0">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{formatFieldLabel(field)}</p>
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

function renderAdminContent(section: AdminSection, organizationId?: string) {
  switch (section) {
    case "dashboard":
      return <AdminDashboardContent />;
    case "organizations":
      return <OrganizationsContent />;
    case "organization-detail":
      return <OrganizationDetailManagementContent organizationId={organizationId} />;
    case "users":
      return <UsersContent />;
    case "plans":
      return <PlansContent />;
    case "announcements":
      return <AnnouncementsContent />;
    case "database":
      return <DatabaseContent />;
    case "error-logs":
      return <ErrorEventsContent />;
    case "ai":
      return <AiContent />;
    case "settings":
      return <SettingsContent />;
    case "system-settings":
      return <SettingsContent technical />;
    default:
      return <GenericTableSection section={section} />;
  }
}

export function AdminScreen({ section, organizationId }: AdminScreenProps) {
  return (
    <div className="space-y-4">
      {renderAdminContent(section, organizationId)}
    </div>
  );
}
