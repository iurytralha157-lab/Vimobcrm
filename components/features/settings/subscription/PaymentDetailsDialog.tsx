import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PaymentHistoryItem } from "@/lib/api/settings";
import { formatBillingDate } from "@/lib/billing/subscription-date";
import {
  formatBillingMoney,
  formatPaymentMethod,
  getPaymentStatus,
  shortBillingReference,
} from "@/lib/billing/subscription-presentation";

import { BillingStatusBadge } from "./BillingStatusBadge";
import { DetailRow } from "./DetailRow";
import { PaymentCheckoutActions } from "./PaymentCheckoutActions";

type PaymentDetailsDialogProps = {
  checkoutReady: boolean;
  payment: PaymentHistoryItem | null;
  paymentRefreshErrors: Record<string, string>;
  refreshError: string | null;
  refreshingPaymentId: string | null;
  refreshingPaymentIds: Set<string>;
  onClose: () => void;
  onRetry: () => void;
};

export function PaymentDetailsDialog({
  checkoutReady,
  payment,
  paymentRefreshErrors,
  refreshError,
  refreshingPaymentId,
  refreshingPaymentIds,
  onClose,
  onRetry,
}: PaymentDetailsDialogProps) {
  const status = payment
    ? getPaymentStatus(payment, Boolean(paymentRefreshErrors[payment.id]))
    : null;

  return (
    <Dialog
      open={Boolean(payment)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] w-[calc(100vw-32px)] overflow-y-auto rounded-[8px] border-0 bg-[var(--app-surface-solid)] text-[12px] font-light shadow-none sm:max-w-xl">
        <DialogHeader className="pr-8">
          <DialogTitle className="text-[14px] font-normal">
            Detalhes do pagamento
          </DialogTitle>
          <DialogDescription>
            {payment
              ? `Pagamento ${shortBillingReference(payment.asaas_payment_id)}`
              : "Pagamento"}
          </DialogDescription>
        </DialogHeader>

        {payment && status && (
          <div className="mt-6 space-y-5">
            <div className="divide-y divide-[var(--app-border)] rounded-[8px] border border-[var(--app-border)]">
              <DetailRow label="Status">
                <BillingStatusBadge status={status} />
              </DetailRow>
              <DetailRow label="ID do pagamento">
                <span className="font-mono text-xs">
                  {payment.asaas_payment_id}
                </span>
              </DetailRow>
              <DetailRow label="ID da assinatura">
                <span className="font-mono text-xs">
                  {payment.asaas_subscription_id || "—"}
                </span>
              </DetailRow>
              <DetailRow label="Método">
                <span>{formatPaymentMethod(payment.billing_type)}</span>
              </DetailRow>
              <DetailRow label="Vencimento">
                <span>{formatBillingDate(payment.due_date)}</span>
              </DetailRow>
              <DetailRow label="Pagamento">
                <span>{formatBillingDate(payment.payment_date)}</span>
              </DetailRow>
              {payment.receipt_path && (
                <DetailRow label="Comprovante">
                  <Button asChild variant="outline" size="sm">
                    <a
                      href={payment.receipt_path}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Ver comprovante
                      <ArrowRight className="h-4 w-4" />
                    </a>
                  </Button>
                </DetailRow>
              )}
            </div>

            <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-4">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-muted-foreground">Valor total</span>
                <span className="text-[16px] font-normal tabular-nums">
                  {formatBillingMoney(payment.value)}
                </span>
              </div>
            </div>

            <PaymentCheckoutActions
              payment={payment}
              checkoutReady={checkoutReady}
              refreshing={
                refreshingPaymentId === payment.id ||
                refreshingPaymentIds.has(payment.id)
              }
              refreshError={
                refreshError || paymentRefreshErrors[payment.id] || null
              }
              onRetry={onRetry}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
