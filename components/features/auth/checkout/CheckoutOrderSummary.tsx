"use client";

import { Pencil, RefreshCw } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatCurrency, formatPeriod } from "@/lib/billing/checkout-domain";
import type {
  CheckoutInfo,
  PublicCheckoutPlan,
} from "@/lib/billing/checkout-types";

type CheckoutPlan = NonNullable<CheckoutInfo["plan"]>;

export type CheckoutOrderSummaryProps = {
  plan: CheckoutPlan;
  managingPaymentMethod: boolean;
  planSelectorOpen: boolean;
  canChangePlan: boolean;
  changingPlanId: string | null;
  plansLoading: boolean;
  availablePlans: PublicCheckoutPlan[];
  selectedPeriodLabel: string;
  activePaymentMethodLabel: string;
  selectedPeriodMonths: number | null;
  total: number;
  monthlyPrice: number;
  onPlanSelectorOpenChange: (open: boolean) => void;
  onPlanChange: (plan: PublicCheckoutPlan) => void;
};

export function CheckoutOrderSummary({
  plan,
  managingPaymentMethod,
  planSelectorOpen,
  canChangePlan,
  changingPlanId,
  plansLoading,
  availablePlans,
  selectedPeriodLabel,
  activePaymentMethodLabel,
  selectedPeriodMonths,
  total,
  monthlyPrice,
  onPlanSelectorOpenChange: setPlanSelectorOpen,
  onPlanChange: handlePlanChange,
}: CheckoutOrderSummaryProps) {
  return (
          <aside className="min-w-0">
            <section className="rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-4 shadow-none sm:p-5">
              <h2 className="app-section-title">
                {managingPaymentMethod
                  ? "Assinatura atual"
                  : "Resumo do pedido"}
              </h2>

              <div className="mt-4 divide-y divide-[var(--app-border)] text-[12px] font-light">
                <DropdownMenu
                  open={planSelectorOpen}
                  onOpenChange={(open) =>
                    setPlanSelectorOpen(canChangePlan ? open : false)}
                >
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      disabled={!canChangePlan}
                      aria-label={"Editar plano. Atual: " + plan.name}
                      className="group flex w-full items-center justify-between gap-4 px-2 py-3 text-left outline-none transition-colors hover:bg-[var(--app-surface-soft)] focus-visible:ring-1 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <span className="text-[var(--app-text-tertiary)]">
                        Plano
                      </span>
                      <span className="flex min-w-0 items-center justify-end gap-2 text-right text-[var(--app-text-secondary)] transition-colors group-hover:text-primary">
                        <span className="truncate">{plan.name}</span>
                        {changingPlanId
                          ? (
                            <RefreshCw
                              className="h-3 w-3 shrink-0 animate-spin"
                              aria-hidden="true"
                            />
                          )
                          : (
                            <Pencil
                              className="h-3 w-3 shrink-0"
                              aria-hidden="true"
                            />
                          )}
                      </span>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    sideOffset={6}
                    className="w-[min(300px,calc(100vw-32px))] rounded-[8px] p-2"
                  >
                    <DropdownMenuLabel className="px-2 pb-2 pt-1 text-[11px] font-light text-[var(--app-text-tertiary)]">
                      Escolha o plano
                    </DropdownMenuLabel>
                    {plansLoading
                      ? (
                        <div className="flex items-center px-2 py-3 text-[11px] font-light text-[var(--app-text-tertiary)]">
                          <RefreshCw
                            className="mr-2 h-3.5 w-3.5 animate-spin"
                            aria-hidden="true"
                          />
                          Carregando planos...
                        </div>
                      )
                      : availablePlans.length > 0
                      ? (
                        <DropdownMenuRadioGroup
                          value={plan.id}
                          className="space-y-1"
                          onValueChange={(value) => {
                            const nextPlan = availablePlans.find(
                              (availablePlan) => availablePlan.id === value,
                            );
                            if (!nextPlan || nextPlan.id === plan.id) return;
                            setPlanSelectorOpen(false);
                            void handlePlanChange(nextPlan);
                          }}
                        >
                          {availablePlans.map((availablePlan) => (
                            <DropdownMenuRadioItem
                              key={availablePlan.id ||
                                availablePlan.slug ||
                                availablePlan.name}
                              value={availablePlan.id || ""}
                              disabled={Boolean(changingPlanId)}
                              className="rounded-[6px] py-2 pl-7 pr-2 text-[12px] font-light"
                            >
                              <span className="min-w-0 flex-1 truncate">
                                {availablePlan.name}
                              </span>
                              <span className="ml-3 shrink-0 text-[11px] text-[var(--app-text-tertiary)]">
                                {formatCurrency(
                                  Number(availablePlan.price),
                                )}/mês
                              </span>
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      )
                      : (
                        <p className="px-2 py-3 text-[11px] font-light leading-[16px] text-[var(--app-text-tertiary)]">
                          Não foi possível listar os planos agora.
                        </p>
                      )}
                  </DropdownMenuContent>
                </DropdownMenu>

                {!managingPaymentMethod
                  ? (
                    <div className="flex w-full items-center justify-between gap-4 px-2 py-3">
                      <span className="text-[var(--app-text-tertiary)]">
                        Período
                      </span>
                      <span className="text-right text-[var(--app-text-secondary)]">
                        {selectedPeriodLabel}
                      </span>
                    </div>
                  )
                  : null}

                <div className="flex w-full items-center justify-between gap-4 px-2 py-3">
                  <span className="text-[var(--app-text-tertiary)]">
                    Pagamento
                  </span>
                  <span className="text-right text-[var(--app-text-secondary)]">
                    {managingPaymentMethod
                      ? "Cartão recorrente"
                      : activePaymentMethodLabel}
                  </span>
                </div>
              </div>

              {!managingPaymentMethod
                ? (
                  <div className="mt-2 border-t border-[var(--app-border)] pt-4">
                    <div className="flex items-end justify-between gap-4">
                      <div>
                        <p className="text-[12px] font-light text-[var(--app-text-secondary)]">
                          Total
                        </p>
                        {selectedPeriodMonths
                          ? (
                            <p className="mt-0.5 text-[11px] font-light text-[var(--app-text-tertiary)]">
                              Referente a {formatPeriod(selectedPeriodMonths)}
                            </p>
                          )
                          : null}
                      </div>
                      <p className="text-[20px] font-normal tracking-tight text-primary/70">
                        {formatCurrency(total)}
                      </p>
                    </div>
                    <p className="mt-2 text-right text-[11px] font-light text-[var(--app-text-tertiary)]">
                      {formatCurrency(monthlyPrice)}/mês
                    </p>
                  </div>
                )
                : (
                  <p className="mt-3 border-t border-[var(--app-border)] px-2 pt-4 text-[11px] font-light leading-[17px] text-[var(--app-text-tertiary)]">
                    O novo cartão será usado nas próximas cobranças automáticas.
                  </p>
                )}
            </section>
          </aside>
  );
}
