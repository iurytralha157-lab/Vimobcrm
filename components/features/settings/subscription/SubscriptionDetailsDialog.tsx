import { MessageSquareText, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  BillingPlanChange,
  SubscriptionOrganization,
  SubscriptionPlan,
} from "@/lib/api/settings";
import type { BillingStatusPresentation } from "@/lib/billing/subscription-presentation";
import { formatBillingDate } from "@/lib/billing/subscription-date";
import {
  formatBillingMoney,
  shortBillingReference,
} from "@/lib/billing/subscription-presentation";
import { cn } from "@/lib/utils";

import { BillingStatusBadge } from "./BillingStatusBadge";
import { DetailRow } from "./DetailRow";

type SubscriptionDetailsDialogProps = {
  attentionRequired: boolean;
  billingPeriodLabel: string;
  checkoutAllowed: boolean;
  daysUntilBilling: number | null;
  nextBilling: string | null | undefined;
  open: boolean;
  organizationName: string;
  org: SubscriptionOrganization | null | undefined;
  pendingPlan: SubscriptionPlan | null | undefined;
  plan: SubscriptionPlan | null | undefined;
  planChange: BillingPlanChange | null | undefined;
  planDisplayName: string;
  renewalValue: number | null | undefined;
  status: BillingStatusPresentation;
  onOpenChange: (open: boolean) => void;
  onContinuePayment: () => void;
  onOpenFiscalDetails: () => void;
  onOpenPlans: () => void;
};

export function SubscriptionDetailsDialog({
  attentionRequired,
  billingPeriodLabel,
  checkoutAllowed,
  daysUntilBilling,
  nextBilling,
  open,
  organizationName,
  org,
  pendingPlan,
  plan,
  planChange,
  planDisplayName,
  renewalValue,
  status,
  onOpenChange,
  onContinuePayment,
  onOpenFiscalDetails,
  onOpenPlans,
}: SubscriptionDetailsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-32px)] overflow-y-auto rounded-[8px] border-0 bg-[var(--app-surface-solid)] text-[12px] font-light shadow-none sm:max-w-xl">
        <DialogHeader className="pr-8">
          <DialogTitle className="text-[14px] font-normal">
            Detalhes da assinatura
          </DialogTitle>
          <DialogDescription>
            {planDisplayName} · {organizationName}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-6 space-y-5">
          {(attentionRequired || checkoutAllowed || planChange) && (
            <div
              className={cn(
                "rounded-[8px] border p-4",
                attentionRequired
                  ? "border-destructive/25 bg-destructive/5"
                  : "border-primary/20 bg-primary/5",
              )}
            >
              <p className="font-medium">
                {attentionRequired
                  ? "A assinatura precisa de atenção"
                  : planChange
                    ? "Troca de plano agendada"
                    : "Existe um plano aguardando pagamento"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {attentionRequired
                  ? "Regularize a cobrança para manter o acesso operacional."
                  : planChange
                    ? `${pendingPlan?.name || org?.pending_plan_name || "Novo plano"} entra em vigor na próxima cobrança elegível.`
                    : `${pendingPlan?.name || org?.pending_plan_name || "Novo plano"} será ativado após a confirmação financeira.`}
              </p>
              {checkoutAllowed && (
                <Button size="sm" className="mt-3" onClick={onContinuePayment}>
                  Continuar pagamento
                </Button>
              )}
            </div>
          )}

          <div className="divide-y divide-[var(--app-border)] rounded-[8px] border border-[var(--app-border)]">
            <DetailRow label="Status">
              <BillingStatusBadge status={status} />
            </DetailRow>
            <DetailRow label="Próxima cobrança">
              <span>{formatBillingDate(nextBilling)}</span>
            </DetailRow>
            <DetailRow label="Período contratado">
              <span>{billingPeriodLabel}</span>
            </DetailRow>
            <DetailRow label="Valor da renovação">
              <span className="font-medium">
                {formatBillingMoney(renewalValue)}
              </span>
            </DetailRow>
            <DetailRow label="Renovação">
              <span>{org?.has_automatic_billing ? "Automática" : "Manual"}</span>
            </DetailRow>
            <DetailRow label="Tempo restante">
              <span>
                {daysUntilBilling === null
                  ? "Sem vencimento definido"
                  : `${daysUntilBilling} dias`}
              </span>
            </DetailRow>
            <DetailRow label="ID da assinatura">
              <span className="font-mono text-xs">
                {shortBillingReference(org?.subscription_reference)}
              </span>
            </DetailRow>
          </div>

          <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-4">
            <p className="text-sm font-medium">Limites do plano</p>
            <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <span className="flex items-center gap-2 text-muted-foreground">
                <Users className="h-4 w-4 text-primary" /> Até{" "}
                {plan?.max_users ?? org?.max_users ?? "—"} usuários
              </span>
              <span className="flex items-center gap-2 text-muted-foreground">
                <MessageSquareText className="h-4 w-4 text-primary" /> Até{" "}
                {plan?.max_whatsapp_sessions ??
                  org?.max_whatsapp_sessions_override ??
                  "—"}{" "}
                WhatsApp
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" className="flex-1" onClick={onOpenFiscalDetails}>
              Dados fiscais
            </Button>
            <Button className="flex-1" onClick={onOpenPlans}>
              Alterar plano
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
