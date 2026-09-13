import { ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { PaymentHistoryItem } from "@/lib/api/settings";
import { formatBillingDate } from "@/lib/billing/subscription-date";
import {
  formatBillingMoney,
  formatPaymentMethod,
  getPaymentStatus,
  shortBillingReference,
} from "@/lib/billing/subscription-presentation";

import { BillingStatusBadge } from "./BillingStatusBadge";

type PaymentsPageProps = {
  filteredHistory: PaymentHistoryItem[];
  historyLength: number;
  paymentRefreshErrors: Record<string, string>;
  planDisplayName: string;
  onRetryFailedRefreshes: () => void;
  onSelectPayment: (payment: PaymentHistoryItem) => void;
};

export function PaymentsPage({
  filteredHistory,
  historyLength,
  paymentRefreshErrors,
  planDisplayName,
  onRetryFailedRefreshes,
  onSelectPayment,
}: PaymentsPageProps) {
  const refreshErrorCount = Object.keys(paymentRefreshErrors).length;

  return (
    <section aria-label="Histórico de pagamentos" className="space-y-5">
      {refreshErrorCount > 0 ? (
        <div
          className="flex flex-col gap-3 rounded-[8px] bg-amber-500/10 p-3 text-[12px] font-light text-amber-800 dark:text-amber-300 sm:flex-row sm:items-center sm:justify-between"
          role="status"
        >
          <span>
            {refreshErrorCount === 1
              ? "Não foi possível confirmar 1 pagamento. O status permanece bloqueado até uma nova consulta."
              : `Não foi possível confirmar ${refreshErrorCount} pagamentos. Os status permanecem bloqueados até uma nova consulta.`}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRetryFailedRefreshes}
            className="shrink-0 text-current hover:bg-amber-500/10"
          >
            Tentar novamente
          </Button>
        </div>
      ) : null}

      <div className="min-w-0 max-w-full overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
        <div className="scrollbar-thin hidden max-w-full overflow-x-auto md:block">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-[var(--app-surface-soft)] text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">ID do pagamento</th>
                <th className="px-4 py-3 font-medium">Serviço</th>
                <th className="px-4 py-3 font-medium">Pago / vencimento</th>
                <th className="px-4 py-3 font-medium">Método</th>
                <th className="px-4 py-3 font-medium">Valor</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="w-12 px-4 py-3">
                  <span className="sr-only">Detalhes</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--app-border)]">
              {filteredHistory.map((item) => {
                const status = getPaymentStatus(
                  item,
                  Boolean(paymentRefreshErrors[item.id]),
                );

                return (
                  <tr
                    key={item.id}
                    className="transition-colors hover:bg-[var(--app-surface-hover)]"
                  >
                    <td className="px-4 py-4 font-mono text-xs">
                      {shortBillingReference(item.asaas_payment_id)}
                    </td>
                    <td className="px-4 py-4">
                      <p className="font-medium">Assinatura Vimob</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {item.plan_name || planDisplayName}
                      </p>
                    </td>
                    <td className="px-4 py-4">
                      {formatBillingDate(item.payment_date || item.due_date)}
                    </td>
                    <td className="px-4 py-4">
                      {formatPaymentMethod(item.billing_type)}
                    </td>
                    <td className="px-4 py-4 font-medium">
                      {formatBillingMoney(item.value)}
                    </td>
                    <td className="px-4 py-4">
                      <BillingStatusBadge status={status} />
                    </td>
                    <td className="px-4 py-4 text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Ver detalhes do pagamento ${item.asaas_payment_id}`}
                        onClick={() => onSelectPayment(item)}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {filteredHistory.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-12 text-center text-muted-foreground"
                  >
                    {historyLength === 0
                      ? "Nenhum pagamento registrado para esta organização."
                      : "Nenhum pagamento corresponde à pesquisa."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="divide-y divide-[var(--app-border)] md:hidden">
          {filteredHistory.map((item) => {
            const status = getPaymentStatus(
              item,
              Boolean(paymentRefreshErrors[item.id]),
            );

            return (
              <button
                key={item.id}
                type="button"
                aria-label={`Ver detalhes do pagamento ${item.asaas_payment_id}`}
                onClick={() => onSelectPayment(item)}
                className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-[var(--app-surface-hover)]"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-light text-[var(--app-text-primary)]">
                      Assinatura Vimob
                    </p>
                    <p className="mt-0.5 text-[11px] font-light text-[var(--app-text-tertiary)]">
                      {item.plan_name || planDisplayName}
                    </p>
                    <BillingStatusBadge status={status} />
                  </div>
                  <p className="mt-1 truncate text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
                    {shortBillingReference(item.asaas_payment_id)} ·{" "}
                    {formatPaymentMethod(item.billing_type)} ·{" "}
                    {formatBillingDate(item.payment_date || item.due_date)}
                  </p>
                </div>
                <p className="shrink-0 text-sm font-light text-[var(--app-text-primary)]">
                  {formatBillingMoney(item.value)}
                </p>
                <ChevronRight className="h-4 w-4 shrink-0 text-[var(--app-text-tertiary)]" />
              </button>
            );
          })}

          {filteredHistory.length === 0 && (
            <div className="px-4 py-12 text-center text-[12px] font-light text-[var(--app-text-tertiary)]">
              {historyLength === 0
                ? "Nenhum pagamento registrado para esta organização."
                : "Nenhum pagamento corresponde à pesquisa."}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
