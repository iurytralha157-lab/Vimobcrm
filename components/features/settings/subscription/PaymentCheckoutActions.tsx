import { AlertTriangle, ArrowRight, Check, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { PaymentHistoryItem } from "@/lib/api/settings";
import {
  isBillingPaymentCheckoutActionable,
  resolveBillingPaymentStatus,
} from "@/lib/billing/checkout-ui-state";
import { hasCancelledBankSlipRegistration } from "@/lib/billing/subscription-presentation";

type PaymentCheckoutActionsProps = {
  payment: PaymentHistoryItem;
  checkoutReady: boolean;
  refreshing: boolean;
  refreshError: string | null;
  onRetry: () => void;
};

export function PaymentCheckoutActions({
  payment,
  checkoutReady,
  refreshing,
  refreshError,
  onRetry,
}: PaymentCheckoutActionsProps) {
  const normalizedStatus = (payment.status || "").trim().toUpperCase();
  const bankSlipExpired =
    hasCancelledBankSlipRegistration(payment) ||
    normalizedStatus === "BANK_SLIP_CANCELLED";
  const semanticStatus = resolveBillingPaymentStatus(
    normalizedStatus,
    bankSlipExpired,
  ).state;
  const actionable = isBillingPaymentCheckoutActionable(
    normalizedStatus,
    bankSlipExpired,
  );
  const paid = semanticStatus === "paid";
  const cancelled = semanticStatus === "cancelled";
  const processing = semanticStatus === "processing";

  if (!checkoutReady) {
    return (
      <div className="flex items-start gap-3 rounded-[8px] bg-amber-500/10 p-4 text-[12px] font-light text-amber-800 dark:text-amber-300">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          A cobrança não pode ser consultada ou paga enquanto o ambiente
          financeiro está em atualização.
        </p>
      </div>
    );
  }

  if (refreshError || payment.sync_state === "provider_unavailable") {
    return (
      <div className="space-y-3 rounded-[8px] border border-warning/25 bg-warning/5 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-foreground" />
          <div>
            <p className="text-sm font-medium">
              Status temporariamente indisponível
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Não foi possível confirmar a cobrança agora. O pagamento fica
              bloqueado até uma resposta segura do provedor.
            </p>
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  if (refreshing) {
    return (
      <div className="flex items-center gap-3 rounded-[8px] bg-[var(--app-surface-soft)] p-4 text-[12px] font-light text-muted-foreground">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
        Conferindo o status atual do pagamento…
      </div>
    );
  }

  if (payment.sync_state === "cached") {
    return (
      <div className="space-y-3 rounded-[8px] bg-[var(--app-surface-soft)] p-4 text-[12px] font-light text-muted-foreground">
        <p>
          Este status ainda veio do histórico local e não foi confirmado pelo
          provedor.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Confirmar status
        </Button>
      </div>
    );
  }

  if (actionable && payment.checkout_url) {
    const copyCheckoutLink = async () => {
      try {
        const checkoutLink = new URL(
          payment.checkout_url || "",
          window.location.origin,
        ).toString();
        await navigator.clipboard.writeText(checkoutLink);
        toast.success("Link de pagamento copiado.");
      } catch {
        toast.error("Não foi possível copiar o link de pagamento.");
      }
    };

    return (
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <Button asChild className="w-full">
          <a href={payment.checkout_url}>
            {bankSlipExpired
              ? "Gerar novo boleto ou trocar método"
              : "Pagar no checkout"}
            <ArrowRight className="h-4 w-4" />
          </a>
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => void copyCheckoutLink()}
        >
          <Copy className="h-4 w-4" /> Copiar link
        </Button>
      </div>
    );
  }

  if (actionable) {
    return (
      <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-4 text-[12px] font-light text-muted-foreground">
        O link seguro desta cobrança está sendo preparado. Atualize os detalhes
        em alguns instantes.
      </div>
    );
  }

  if (paid) {
    return (
      <div className="flex items-center gap-3 rounded-[8px] bg-primary/[0.06] p-4 text-[12px] font-light text-muted-foreground">
        <Check className="h-4 w-4 shrink-0 text-primary" /> Pagamento
        confirmado. Não há valor pendente nesta cobrança.
      </div>
    );
  }

  if (cancelled) {
    return (
      <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-4 text-[12px] font-light text-muted-foreground">
        Esta cobrança foi cancelada e não pode mais receber pagamento.
      </div>
    );
  }

  if (semanticStatus === "refund_processing") {
    return (
      <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-4 text-[12px] font-light text-muted-foreground">
        O estorno está em andamento. Esta cobrança não aceita um novo pagamento.
      </div>
    );
  }

  if (semanticStatus === "refunded") {
    return (
      <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-4 text-[12px] font-light text-muted-foreground">
        Esta cobrança foi estornada e não pode mais receber pagamento.
      </div>
    );
  }

  if (semanticStatus === "chargeback") {
    return (
      <div className="rounded-[8px] bg-destructive/[0.06] p-4 text-[12px] font-light text-muted-foreground">
        Esta cobrança está em contestação. Nenhum novo pagamento foi liberado.
      </div>
    );
  }

  if (processing) {
    return (
      <div className="flex items-center gap-3 rounded-[8px] bg-[var(--app-surface-soft)] p-4 text-[12px] font-light text-muted-foreground">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" /> O
        pagamento está sendo processado.
      </div>
    );
  }

  return (
    <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-4 text-[12px] font-light text-muted-foreground">
      O status desta cobrança ainda está em verificação. Nenhuma ação de
      pagamento foi liberada.
    </div>
  );
}
