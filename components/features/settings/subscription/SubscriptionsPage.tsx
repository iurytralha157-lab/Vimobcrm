import { AlertTriangle, ChevronRight, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type {
  BillingPlanChange,
  SubscriptionOrganization,
  SubscriptionPlan,
} from "@/lib/api/settings";
import type { BillingStatusPresentation } from "@/lib/billing/subscription-presentation";
import { formatBillingDate } from "@/lib/billing/subscription-date";
import { formatBillingMoney } from "@/lib/billing/subscription-presentation";
import { cn } from "@/lib/utils";

import { BillingStatusBadge } from "./BillingStatusBadge";
import type { CheckoutNotice } from "./types";

type SubscriptionsPageProps = {
  attentionRequired: boolean;
  billingFrequencyLabel: string;
  checkoutNotice: CheckoutNotice;
  nextBilling: string | null | undefined;
  organizationName: string;
  org: SubscriptionOrganization | null | undefined;
  pendingPlan: SubscriptionPlan | null | undefined;
  planChange: BillingPlanChange | null | undefined;
  planDisplayName: string;
  renewalValue: number | null | undefined;
  status: BillingStatusPresentation;
  onOpenDetails: () => void;
};

export function SubscriptionsPage({
  attentionRequired,
  billingFrequencyLabel,
  checkoutNotice,
  nextBilling,
  organizationName,
  org,
  pendingPlan,
  planChange,
  planDisplayName,
  renewalValue,
  status,
  onOpenDetails,
}: SubscriptionsPageProps) {
  return (
    <section aria-label="Assinaturas" className="space-y-5">
      {(checkoutNotice || pendingPlan || planChange || attentionRequired) && (
        <div
          className={cn(
            "flex items-start gap-3 rounded-[8px] border-0 p-3.5",
            attentionRequired ? "bg-destructive/5" : "bg-primary/10",
          )}
        >
          {checkoutNotice === "success" ? (
            <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {checkoutNotice === "success"
                ? "Pagamento enviado para confirmação"
                : checkoutNotice === "cancelled"
                  ? "Checkout cancelado"
                  : checkoutNotice === "expired"
                    ? "O checkout expirou"
                    : attentionRequired
                      ? "Assinatura precisa de atenção"
                      : planChange
                        ? `${pendingPlan?.name || org?.pending_plan_name || "Novo plano"} com troca agendada`
                        : `${pendingPlan?.name || org?.pending_plan_name || "Novo plano"} aguardando pagamento`}
            </p>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
              {checkoutNotice === "success"
                ? "A confirmação acontece automaticamente."
                : checkoutNotice === "cancelled"
                  ? "Nenhuma nova assinatura foi ativada."
                  : checkoutNotice === "expired"
                    ? "Gere um novo checkout para concluir a contratação."
                    : attentionRequired
                      ? "Abra os detalhes para regularizar a cobrança."
                      : planChange?.status === "provider_updating"
                        ? "Estamos confirmando a alteração na assinatura atual, sem criar outra recorrência."
                        : planChange
                          ? `O plano atual continua ativo até a cobrança de ${formatBillingDate(planChange.effective_on)}.`
                          : "O plano atual continua preservado até a confirmação financeira."}
            </p>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-[var(--app-surface-soft)] text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Assinatura</th>
                <th className="px-4 py-3 font-medium">Próxima cobrança</th>
                <th className="px-4 py-3 font-medium">Renovação</th>
                <th className="px-4 py-3 font-medium">Valor</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="w-12 px-4 py-3">
                  <span className="sr-only">Detalhes</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-[var(--app-border)]">
                <td className="px-4 py-4">
                  <p className="font-medium text-foreground">{planDisplayName}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {organizationName}
                  </p>
                </td>
                <td className="px-4 py-4">{formatBillingDate(nextBilling)}</td>
                <td className="px-4 py-4">
                  <p>{org?.has_automatic_billing ? "Automática" : "Manual"}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {billingFrequencyLabel}
                  </p>
                </td>
                <td className="px-4 py-4 font-medium">
                  <p>{formatBillingMoney(renewalValue)}</p>
                  <p className="mt-0.5 text-xs font-normal text-muted-foreground">
                    Total do período
                  </p>
                </td>
                <td className="px-4 py-4">
                  <BillingStatusBadge status={status} />
                </td>
                <td className="px-4 py-4 text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Ver detalhes da assinatura"
                    onClick={onOpenDetails}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <button
          type="button"
          onClick={onOpenDetails}
          className="flex w-full items-center justify-between gap-4 p-4 text-left md:hidden"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">{planDisplayName}</p>
              <BillingStatusBadge status={status} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatBillingMoney(renewalValue)} ·{" "}
              {billingFrequencyLabel.toLocaleLowerCase("pt-BR")} · próxima
              cobrança {formatBillingDate(nextBilling)}
            </p>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </div>

      <p className="text-xs text-muted-foreground">
        1 assinatura vinculada a esta organização
      </p>
    </section>
  );
}
