import { ArrowRight, Check, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getSystemModuleLabel } from "@/config/constants";
import type {
  BillingPlanChange,
  SubscriptionPlan,
} from "@/lib/api/settings";
import { formatBillingMoney } from "@/lib/billing/subscription-presentation";
import { cn } from "@/lib/utils";
import { formatPtBRNumber } from "@/lib/utils/formatting";

type PlansPageProps = {
  billingCheckoutReady: boolean;
  changingPlanId: string | null;
  commercialPlans: SubscriptionPlan[];
  currentPlanId: string | null | undefined;
  managedPlanChangeAvailable: boolean;
  pendingPlan: SubscriptionPlan | null | undefined;
  planChange: BillingPlanChange | null | undefined;
  providerPlanChangeBlocked: boolean;
  onConfirmPlan: (plan: SubscriptionPlan) => void;
  onContinuePayment: () => void;
  onRetryProviderConfirmation: (plan: SubscriptionPlan) => void;
};

export function PlansPage({
  billingCheckoutReady,
  changingPlanId,
  commercialPlans,
  currentPlanId,
  managedPlanChangeAvailable,
  pendingPlan,
  planChange,
  providerPlanChangeBlocked,
  onConfirmPlan,
  onContinuePayment,
  onRetryProviderConfirmation,
}: PlansPageProps) {
  return (
    <section aria-label="Planos" className="space-y-6">
      <div className="grid items-stretch gap-4 lg:grid-cols-3">
        {commercialPlans.map((availablePlan, index) => {
          const isCurrent = availablePlan.id === currentPlanId;
          const isPending = availablePlan.id === pendingPlan?.id;
          const isScheduledChange =
            availablePlan.id === planChange?.target_plan_id;
          const canRetryProviderConfirmation =
            isScheduledChange && planChange?.status === "provider_updating";
          const isRecommended = index === 1;
          const modules = (availablePlan.modules || []).slice(0, 4);
          const planFeatures = [
            `Até ${availablePlan.max_users ?? "—"} usuários`,
            ...(Number(availablePlan.max_leads || 0) > 0
              ? [
                  `Até ${formatPtBRNumber(Number(availablePlan.max_leads))} leads`,
                ]
              : []),
            `Até ${availablePlan.max_whatsapp_sessions ?? "—"} WhatsApp`,
            ...modules.map((moduleName) => getSystemModuleLabel(moduleName)),
          ];

          return (
            <article
              key={availablePlan.id}
              className="relative flex flex-col overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-5 shadow-none"
            >
              <div className="flex min-h-7 items-start justify-between gap-2">
                {isCurrent ? (
                  <Badge>Seu plano atual</Badge>
                ) : isPending ? (
                  <Badge variant="secondary">
                    {canRetryProviderConfirmation
                      ? "Confirmando troca"
                      : isScheduledChange
                        ? "Troca agendada"
                        : "Aguardando pagamento"}
                  </Badge>
                ) : isRecommended ? (
                  <Badge className="bg-primary/10 text-primary hover:bg-primary/10">
                    Recomendado
                  </Badge>
                ) : (
                  <span />
                )}
              </div>

              <div className="mt-3">
                <h4 className="text-[14px] font-normal">{availablePlan.name}</h4>
                <p className="mt-2 min-h-12 text-[12px] font-light leading-[18px] text-muted-foreground">
                  {availablePlan.description ||
                    "Plano Vimob para gestão imobiliária."}
                </p>
              </div>

              <div className="mt-5">
                <div className="flex items-end gap-1">
                  <span className="text-[22px] font-normal tabular-nums">
                    {formatBillingMoney(availablePlan.price)}
                  </span>
                  <span className="pb-1 text-xs text-muted-foreground">
                    /{availablePlan.billing_cycle === "yearly" ? "ano" : "mês"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Cobrança recorrente, sem taxa de adesão
                </p>
              </div>

              <Button
                variant={isCurrent ? "secondary" : "default"}
                className={cn(
                  "mt-5 w-full rounded-[6px] font-light shadow-none",
                  !isCurrent &&
                    "bg-primary/50 text-primary-foreground hover:bg-primary",
                )}
                disabled={
                  !billingCheckoutReady ||
                  isCurrent ||
                  (providerPlanChangeBlocked && !isPending) ||
                  (Boolean(planChange) && !canRetryProviderConfirmation) ||
                  changingPlanId === availablePlan.id
                }
                onClick={() => {
                  if (isPending) {
                    if (canRetryProviderConfirmation) {
                      onRetryProviderConfirmation(availablePlan);
                      return;
                    }
                    if (isScheduledChange) return;
                    onContinuePayment();
                    return;
                  }
                  onConfirmPlan(availablePlan);
                }}
              >
                {changingPlanId === availablePlan.id && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                {isCurrent ? (
                  "Plano atual"
                ) : providerPlanChangeBlocked && !isPending ? (
                  "Regularize a assinatura"
                ) : isPending ? (
                  isScheduledChange ? (
                    canRetryProviderConfirmation ? (
                      "Tentar confirmar"
                    ) : (
                      "Troca agendada"
                    )
                  ) : (
                    "Continuar pagamento"
                  )
                ) : managedPlanChangeAvailable ? (
                  <span className="inline-flex items-center">
                    Agendar troca <ArrowRight className="ml-2 h-4 w-4" />
                  </span>
                ) : (
                  <span className="inline-flex items-center">
                    Escolher plano <ArrowRight className="ml-2 h-4 w-4" />
                  </span>
                )}
              </Button>

              <div className="my-5 h-px bg-[var(--app-border)]" />

              <p className="text-[12px] font-light text-muted-foreground">
                Incluído no plano
              </p>
              <ul className="mt-3 space-y-2.5">
                {planFeatures.map((feature) => (
                  <li
                    key={feature}
                    className="flex items-start gap-2 text-[12px] font-light"
                  >
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </article>
          );
        })}

        {commercialPlans.length === 0 && (
          <div className="col-span-full rounded-[8px] border-0 bg-[var(--app-surface-solid)] py-14 text-center text-sm text-muted-foreground shadow-none">
            Nenhum plano comercial disponível agora.
          </div>
        )}
      </div>

      {managedPlanChangeAvailable && (
        <div className="rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-4 text-sm shadow-none">
          <p className="font-medium">
            Sua assinatura já possui recorrência ativa
          </p>
          <p className="mt-1 text-muted-foreground">
            A troca altera a assinatura existente e entra em vigor na próxima
            cobrança. Nenhum novo checkout é aberto.
          </p>
        </div>
      )}

      <p className="text-center text-xs text-muted-foreground">
        Cartão de crédito é recomendado para manter a renovação automática. Pix
        permanece disponível como pagamento manual.
      </p>
    </section>
  );
}
