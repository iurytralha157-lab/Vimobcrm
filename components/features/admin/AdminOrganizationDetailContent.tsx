"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Check, CreditCard, Loader2, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { VimobLoader } from "@/components/shared/loading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SYSTEM_MODULES, getSystemModuleLabel, type SystemModuleKey } from "@/config/constants";
import { useAdminPlans, type SubscriptionPlan } from "@/hooks/use-admin-plans";
import { useAdminOrganizationsList } from "@/hooks/use-admin-organizations";
import { adminAPI } from "@/lib/api/admin";
import { resolveBillingPaymentStatus } from "@/lib/billing/checkout-ui-state";
import { cn } from "@/lib/utils";
import type { AdminUpdateOrganizationInput } from "@/lib/validation/admin";
import type { AdminSection } from "@/components/features/admin/admin-navigation";
import { AdminWarning, EmptyState } from "@/components/features/admin/AdminPrimitives";
import { AdminUserActions, UsersRowsPreview } from "@/components/features/admin/AdminUsersContent";
import {
  formatCurrency,
  formatDate,
  formatFieldValue,
  formatNumber,
  formatRecordsCount,
  getErrorMessage,
  getOptionalString,
  getOrganizationStatus,
  getString,
  MiniInfo,
  normalizeValue,
  StatusBadge,
  type AdminRecord,
} from "@/components/features/admin/admin-display";
import {
  useAdminOrganizationModules,
  useAdminOrganizationPayments,
  useAdminRows,
  useAdminUsersList,
  type OrganizationModuleRow,
  type OrganizationPaymentRow,
} from "@/components/features/admin/admin-queries";
import {
  isSystemModuleKey,
  isValidNumberInput,
  normalizePlanModules,
  parseNullableNumberInput,
  parseNumberInput,
  stringFromNullableNumber,
} from "@/components/features/admin/admin-plan-form";
import { OrganizationDeleteDialog } from "@/components/features/admin/AdminOrganizationsContent";

type OrganizationUpdatePayload = AdminUpdateOrganizationInput;

type AdminScreenProps = {
  section: AdminSection;
  organizationId?: string;
};

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
  if (typeof status !== "string") return "Em verificação";
  return resolveBillingPaymentStatus(status).label;
}

function getPaymentMethodLabel(method: unknown) {
  const normalized = normalizeValue(method);
  if (normalized === "credit_card") return "Cartão";
  if (normalized === "pix") return "Pix";
  if (normalized === "boleto") return "Boleto";
  return "Cobrança";
}

function isPaidPayment(payment: OrganizationPaymentRow) {
  return resolveBillingPaymentStatus(payment.status).state === "paid";
}

function getEnabledModulesFromRows(rows: OrganizationModuleRow[], fallback: SystemModuleKey[]) {
  if (rows.length === 0) return fallback;

  return rows
    .filter((row) => row.is_enabled)
    .map((row) => row.module_name)
    .filter(isSystemModuleKey);
}

function getOrganizationAccessForm(
  organization: AdminRecord,
  currentPlan: SubscriptionPlan | null,
  moduleRows: OrganizationModuleRow[],
): OrganizationAccessForm {
  const planModules = normalizePlanModules(currentPlan?.modules);
  const fallbackModules = planModules.length > 0 ? planModules : [...DEFAULT_PLAN_MODULES];

  return {
    planId: getOptionalString(organization, "plan_id") || NO_PLAN_VALUE,
    subscriptionStatus: getRecordInputValue(organization, "subscription_status") || "active",
    maxUsers: getRecordInputValue(organization, "max_users"),
    maxWhatsappSessions: getRecordInputValue(organization, "max_whatsapp_sessions_override"),
    subscriptionValue: getRecordInputValue(organization, "subscription_value"),
    billingDay: getRecordInputValue(organization, "billing_day"),
    nextBillingDate: getDateInputValue(organization.next_billing_date),
    trialEndsAt: getDateInputValue(organization.trial_ends_at),
    modules: getEnabledModulesFromRows(moduleRows, fallbackModules),
  };
}

export function OrganizationDetailManagementContent({ organizationId }: { organizationId?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const organizations = useAdminOrganizationsList();
  const organizationDetails = useAdminRows("organizations", 200);
  const users = useAdminUsersList();
  const modulesQuery = useAdminOrganizationModules(organizationId);
  const paymentsQuery = useAdminOrganizationPayments(organizationId);
  const { plans, isLoading: plansLoading, error: plansError } = useAdminPlans();
  const organizationRows = useMemo(
    () => (organizations.data || []) as unknown as AdminRecord[],
    [organizations.data],
  );
  const organizationDetailRows = useMemo(
    () => organizationDetails.data?.data || [],
    [organizationDetails.data?.data],
  );
  const organizationSummary = useMemo(
    () => organizationRows.find((org) => getString(org, "id") === organizationId),
    [organizationId, organizationRows],
  );
  const organizationDetail = useMemo(
    () => organizationDetailRows.find((org) => getString(org, "id") === organizationId),
    [organizationDetailRows, organizationId],
  );
  const organization = useMemo(
    () => organizationSummary && organizationDetail
      ? { ...organizationSummary, ...organizationDetail }
      : organizationSummary,
    [organizationDetail, organizationSummary],
  );
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
  const organizationErrorMessage = organizations.error ? getErrorMessage(organizations.error) : null;
  const organizationDetailsErrorMessage = organizationDetails.data?.errorMessage;
  const organizationDetailMissing = Boolean(
    organizationSummary
    && !organizationDetails.isPending
    && !organizationDetailsErrorMessage
    && !organizationDetail,
  );
  const organizationAccessDataErrorMessage = organizationDetailsErrorMessage
    || (organizationDetailMissing
      ? "A ficha completa da organização não está disponível nesta consulta. A edição foi bloqueada para preservar os dados atuais."
      : null);
  const usersErrorMessage = users.data?.errorMessage;
  const plansErrorMessage = plansError ? getErrorMessage(plansError) : null;
  const accessErrorMessage = organizationAccessDataErrorMessage || modulesQuery.data?.errorMessage || plansErrorMessage;
  const accessDependenciesLoading = organizationDetails.isPending || modulesQuery.isPending || plansLoading;
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
  const [isEditingAccess, setIsEditingAccess] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const accessFormIsValid = isValidNumberInput(accessForm.maxUsers, { integer: true, min: 1 })
    && isValidNumberInput(accessForm.maxWhatsappSessions, { allowEmpty: true, integer: true, min: 0 })
    && isValidNumberInput(accessForm.subscriptionValue, { allowEmpty: true, min: 0 })
    && isValidNumberInput(accessForm.billingDay, { allowEmpty: true, integer: true, min: 1, max: 31 });
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
      setIsEditingAccess(false);
      toast.success("Acessos da organização atualizados.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-rows", "organizations"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-organizations-list"] }),
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
    if (!organization || isEditingAccess) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect -- Sincroniza o formulario quando a organizacao carregada muda.
    setAccessForm(getOrganizationAccessForm(organization, currentPlan, moduleRows));
  }, [organization, currentPlan, moduleRows, isEditingAccess]);

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
    if (!organizationId || !organization || !accessFormIsValid || accessDependenciesLoading || accessErrorMessage) return;

    const selectedPlan = plans.find((plan) => plan.id === accessForm.planId);
    const maxUsersFallback = Number(organization.max_users || 1);
    const organizationUpdates: OrganizationUpdatePayload = {
      plan_id: accessForm.planId === NO_PLAN_VALUE ? null : accessForm.planId,
      clear_plan_id: accessForm.planId === NO_PLAN_VALUE,
      subscription_status: accessForm.subscriptionStatus || "active",
      subscription_value: parseNullableNumberInput(accessForm.subscriptionValue),
      max_users: Math.max(1, parseNumberInput(accessForm.maxUsers, maxUsersFallback)),
      max_whatsapp_sessions_override: parseNullableNumberInput(accessForm.maxWhatsappSessions),
      billing_day: parseNullableNumberInput(accessForm.billingDay),
      next_billing_date: accessForm.nextBillingDate || null,
      clear_next_billing_date: !accessForm.nextBillingDate,
      trial_ends_at: accessForm.trialEndsAt || null,
      clear_trial_ends_at: !accessForm.trialEndsAt,
      subscription_type: selectedPlan ? "paid" : getOptionalString(organization, "subscription_type") || null,
    };

    try {
      await updateOrganizationAccess.mutateAsync({
        organizationId,
        organizationUpdates,
        modules: accessForm.modules,
      });
    } catch {
      // Toast is handled by the mutation; preserve the draft for retry.
    }
  };

  const handleCancelAccessEdit = () => {
    if (!organization) return;
    setAccessForm(getOrganizationAccessForm(organization, currentPlan, moduleRows));
    setIsEditingAccess(false);
  };

  if (!organization && organizations.isLoading) {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <VimobLoader label="Carregando organização..." />
      </div>
    );
  }

  if (!organization && organizationErrorMessage) {
    return <AdminWarning message={organizationErrorMessage} />;
  }

  if (!organization) {
    return (
      <EmptyState
        title="Organização não encontrada"
        description="A rota existe, mas a organização não foi retornada pela API administrativa."
      />
    );
  }

  return (
    <div className="space-y-4">
      <AdminWarning
        message={[
          organizationAccessDataErrorMessage,
          usersErrorMessage,
          modulesQuery.data?.errorMessage,
          paymentsQuery.data?.errorMessage,
          plansErrorMessage,
        ].find(Boolean)}
      />

      <div className="app-card p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-light text-muted-foreground">Organização</p>
            <h2 className="mt-2 text-2xl font-medium">{getString(organization, "name")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{getString(organization, "email", "E-mail não informado")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge value={getOrganizationStatus(organization)} activeLabel="Ativa" />
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDeleteOpen(true)}
              className="h-8 rounded-[6px] border-0 bg-destructive/10 px-3 text-destructive hover:bg-destructive/15 hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
              Excluir organização
            </Button>
          </div>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-4">
          <MiniInfo label="CNPJ" value={getString(organization, "cnpj", "--")} />
          <MiniInfo label="Segmento" value={formatFieldValue(organization, "segment")} />
          <MiniInfo label="WhatsApp" value={getString(organization, "whatsapp", "--")} />
          <MiniInfo label="Criada em" value={formatDate(organization.created_at)} />
        </div>
      </div>

      <OrganizationDeleteDialog
        organizationId={organizationId || ""}
        organizationName={getString(organization, "name")}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onDeleted={() => router.replace("/admin/organizations")}
      />

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.1fr)_minmax(560px,0.9fr)]">
        <div className="app-card p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-base font-medium">Plano, status e limites</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {isEditingAccess
                  ? "Altere o plano, o status e os limites liberados para esta organização."
                  : "Consulte os acessos atuais. Para fazer alterações, clique em Editar."}
              </p>
            </div>
            {isEditingAccess ? (
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCancelAccessEdit}
                  disabled={updateOrganizationAccess.isPending}
                  className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)]"
                >
                  Cancelar
                </Button>
                <Button
                  type="button"
                  onClick={handleSaveAccess}
                  disabled={updateOrganizationAccess.isPending || !accessFormIsValid || accessDependenciesLoading || Boolean(accessErrorMessage)}
                  className="h-9 rounded-[6px] bg-primary text-primary-foreground shadow-none hover:bg-primary/90"
                >
                  {updateOrganizationAccess.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Salvar alterações
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsEditingAccess(true)}
                disabled={accessDependenciesLoading || Boolean(accessErrorMessage)}
                className="h-9 shrink-0 rounded-[6px] border-0 bg-[var(--app-surface-soft)]"
              >
                <Pencil className="h-4 w-4" />
                Editar
              </Button>
            )}
          </div>

          {isEditingAccess ? (
            <>
              {!accessFormIsValid ? (
                <p className="mt-3 text-sm text-destructive">
                  Revise os limites, o valor mensal e o dia da cobrança antes de salvar.
                </p>
              ) : null}
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
                    <option value="trial">Período de teste</option>
                    <option value="active">Ativa</option>
                    <option value="pending_payment">Pagamento pendente</option>
                    <option value="overdue">Em atraso</option>
                    <option value="blocked">Bloqueada</option>
                    <option value="cancelled">Cancelada</option>
                  </select>
                </div>
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-5">
                <div className="space-y-2">
                  <Label htmlFor="organization-max-users">Limite de usuários</Label>
                  <Input
                    id="organization-max-users"
                    inputMode="numeric"
                    value={accessForm.maxUsers}
                    onChange={(event) => updateAccessForm("maxUsers", event.target.value)}
                    className="border-0 bg-[var(--app-surface-soft)]"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="organization-whatsapp">Limite de WhatsApp</Label>
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
                  <Label htmlFor="organization-billing-day">Dia da cobrança</Label>
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
                  <Label htmlFor="organization-trial-end">Fim do período de teste</Label>
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
                            ? "bg-primary text-primary-foreground shadow-none"
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
            </>
          ) : (
            <>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <MiniInfo label="Plano comercial" value={currentPlan?.name || "Sem plano vinculado"} />
                <div className="rounded-[8px] bg-[var(--app-surface-soft)] px-3 py-2">
                  <p className="text-[10px] font-light text-muted-foreground">Status</p>
                  <div className="mt-1">
                    <StatusBadge value={getOrganizationStatus(organization)} activeLabel="Ativa" />
                  </div>
                </div>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <MiniInfo label="Limite de usuários" value={accessForm.maxUsers || "--"} />
                <MiniInfo label="Limite de WhatsApp" value={accessForm.maxWhatsappSessions || "Sem limite"} />
                <MiniInfo label="Valor mensal" value={formatCurrency(accessForm.subscriptionValue)} />
                <MiniInfo label="Dia da cobrança" value={accessForm.billingDay || "--"} />
                <MiniInfo label="Próximo vencimento" value={formatDateOnly(accessForm.nextBillingDate)} />
                <MiniInfo label="Fim do período de teste" value={formatDateOnly(accessForm.trialEndsAt)} />
              </div>
              <div className="mt-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">Módulos liberados</p>
                  <span className="text-xs text-muted-foreground">{accessForm.modules.length} ativos</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {accessForm.modules.length > 0 ? (
                    accessForm.modules.map((module) => (
                      <Badge
                        key={module}
                        variant="secondary"
                        className="rounded-[6px] border-0 bg-[var(--app-surface-soft)] font-medium"
                      >
                        {getSystemModuleLabel(module)}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-sm text-muted-foreground">Nenhum módulo liberado.</span>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="space-y-4">
          <div className="app-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-medium">Resumo financeiro</h2>
                <p className="mt-1 text-sm text-muted-foreground">Plano, vencimentos e cobranças conciliadas.</p>
              </div>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px] bg-primary/12 text-primary">
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
            </div>
          </div>

          <div className="app-card overflow-hidden">
            <div className="flex items-center justify-between gap-3 p-4">
              <div>
                <h2 className="text-base font-medium">Histórico de pagamentos</h2>
                <p className="text-sm text-muted-foreground">{formatRecordsCount(payments.length)}</p>
              </div>
              <CalendarDays className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="divide-y divide-[var(--app-border)]">
              {!paymentsQuery.isPending ? payments.slice(0, 8).map((payment) => (
                <div key={payment.id} className="grid gap-2 p-4 text-sm sm:grid-cols-[1fr_auto]">
                  <div className="min-w-0">
                    <p className="font-medium">{formatCurrency(payment.value)}</p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {getPaymentMethodLabel(payment.billing_type)} · vence em {formatDateOnly(payment.due_date)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 sm:justify-end">
                    <Badge className="border-0 bg-[var(--app-surface-soft)] text-muted-foreground">
                      {getPaymentStatusLabel(payment.status)}
                    </Badge>
                  </div>
                </div>
              )) : (
                <div className="flex min-h-[120px] items-center justify-center p-4">
                  <VimobLoader label="Carregando pagamentos..." />
                </div>
              )}
              {!paymentsQuery.isPending && !paymentsQuery.data?.errorMessage && payments.length === 0 ? (
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
        createOrganizationId={organizationId}
        isLoading={users.isPending}
        errorMessage={usersErrorMessage}
        empty="Nenhum usuário retornado para esta organização."
      />
    </div>
  );
}
