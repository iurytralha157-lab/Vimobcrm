"use client";

import { useState } from "react";
import { Check, Loader2, Pencil, Plus } from "lucide-react";

import { VimobLoader } from "@/components/shared/loading";
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
import { SYSTEM_MODULES, getSystemModuleLabel, type SystemModuleKey } from "@/config/constants";
import { useAdminPlans, type SubscriptionPlan } from "@/hooks/use-admin-plans";
import { cn } from "@/lib/utils";
import { AdminWarning, EmptyState } from "@/components/features/admin/AdminPrimitives";
import {
  formatCurrency,
  formatFieldValue,
  formatRecordsCount,
  PlanInfoTile,
  StatusBadge,
  type AdminRecord,
} from "@/components/features/admin/admin-display";
import {
  DEFAULT_PLAN_FORM,
  isValidNumberInput,
  planFormToPayload,
  planToFormState,
  slugifyPlanName,
  stringFromNullableNumber,
  type PlanFormState,
} from "@/components/features/admin/admin-plan-form";

export function AdminPlansContent() {
  const { plans, isLoading, error, createPlan, updatePlan } = useAdminPlans();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<SubscriptionPlan | null>(null);
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [form, setForm] = useState<PlanFormState>(() => ({
    ...DEFAULT_PLAN_FORM,
    modules: [...DEFAULT_PLAN_FORM.modules],
  }));
  const isSaving = createPlan.isPending || updatePlan.isPending;
  const planFormIsValid = Boolean(form.name.trim() && form.slug.trim())
    && isValidNumberInput(form.price, { min: 0 })
    && isValidNumberInput(form.trial_days, { allowEmpty: true, integer: true, min: 0 })
    && isValidNumberInput(form.max_users, { allowEmpty: true, integer: true, min: 0 })
    && isValidNumberInput(form.max_leads, { allowEmpty: true, integer: true, min: 0 })
    && isValidNumberInput(form.max_whatsapp_sessions, { allowEmpty: true, integer: true, min: 0 });

  const openCreateDialog = () => {
    setEditingPlan(null);
    setSlugManuallyEdited(false);
    setForm({ ...DEFAULT_PLAN_FORM, modules: [...DEFAULT_PLAN_FORM.modules] });
    setDialogOpen(true);
  };

  const openEditDialog = (plan: SubscriptionPlan) => {
    setEditingPlan(plan);
    setSlugManuallyEdited(true);
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
      slug: slugManuallyEdited ? current.slug : slugifyPlanName(value),
    }));
  };

  const handleSubmitPlan = async () => {
    if (!planFormIsValid || isSaving) return;
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
          <h2 className="text-base font-medium">Planos comerciais</h2>
          <p className="text-sm text-muted-foreground">{formatRecordsCount(plans.length)}</p>
        </div>
        <Button
          onClick={openCreateDialog}
          size="icon"
          className="h-10 w-10 shrink-0 rounded-[6px] bg-primary text-primary-foreground shadow-none hover:bg-primary/90 sm:w-auto sm:px-4"
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
                  <p className="truncate text-base font-medium">{plan.name}</p>
                </div>
                <StatusBadge value={plan.is_active !== false} />
              </div>

              <div className="mt-3 flex items-end justify-between gap-3">
                <div>
                  <p className="text-[10px] font-light text-muted-foreground">Preço</p>
                  <p className="mt-0.5 text-2xl font-medium">{formatCurrency(plan.price)}</p>
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
                    <Badge key={module} className="border-0 bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
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

              <div className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--app-border)] pt-2.5">
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

      {!isLoading && !error && plans.length === 0 && (
        <EmptyState title="Nenhum plano carregado" description="Crie o primeiro plano comercial para disponibilizar no onboarding." />
      )}

      <Dialog open={dialogOpen} onOpenChange={(nextOpen) => {
        if (isSaving) return;
        setDialogOpen(nextOpen);
      }}>
        <DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto rounded-[8px] border-0 p-0">
          <DialogHeader className="border-b border-[var(--app-border)] px-4 py-3">
            <DialogTitle className="text-base">{editingPlan ? "Editar plano" : "Novo plano"}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-3 px-4 py-3">
            {!planFormIsValid ? (
              <p className="text-sm text-destructive">
                Informe nome, slug e valores numéricos válidos antes de salvar.
              </p>
            ) : null}
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
                  onChange={(event) => {
                    setSlugManuallyEdited(true);
                    updateForm("slug", slugifyPlanName(event.target.value));
                  }}
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

          <DialogFooter className="border-t border-[var(--app-border)] px-4 py-3">
            <Button
              variant="outline"
              className="rounded-[6px] border-0 bg-[var(--app-surface-soft)] shadow-none"
              onClick={() => setDialogOpen(false)}
              disabled={isSaving}
            >
              Cancelar
            </Button>
            <Button className="rounded-[6px] bg-primary text-primary-foreground shadow-none hover:bg-primary/90" onClick={handleSubmitPlan} disabled={isSaving || !planFormIsValid}>
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {editingPlan ? "Salvar plano" : "Criar plano"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
