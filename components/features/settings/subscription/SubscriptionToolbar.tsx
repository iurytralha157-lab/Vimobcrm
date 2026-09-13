import {
  AlertTriangle,
  CreditCard,
  Package,
  ReceiptText,
  RefreshCcw,
  Search,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { BillingPage } from "@/lib/billing/subscription-presentation";
import { cn } from "@/lib/utils";

type SubscriptionToolbarProps = {
  activePage: BillingPage;
  billingCheckoutReady: boolean;
  billingProfileReady: boolean;
  commercialPlanDisplayName: string;
  hasPlan: boolean;
  historyQuery: string;
  onHistoryQueryChange: (value: string) => void;
  onNavigate: (page: BillingPage) => void;
  onOpenFiscalDetails: () => void;
  onOpenPaymentMethod: () => void;
};

const billingNavigation: Array<{
  id: BillingPage;
  label: string;
  icon: LucideIcon;
}> = [
  { id: "payments", label: "Histórico de pagamentos", icon: ReceiptText },
  { id: "subscriptions", label: "Assinaturas", icon: RefreshCcw },
  { id: "methods", label: "Formas de pagamento", icon: CreditCard },
  { id: "plans", label: "Planos", icon: Package },
];

export function SubscriptionToolbar({
  activePage,
  billingCheckoutReady,
  billingProfileReady,
  commercialPlanDisplayName,
  hasPlan,
  historyQuery,
  onHistoryQueryChange,
  onNavigate,
  onOpenFiscalDetails,
  onOpenPaymentMethod,
}: SubscriptionToolbarProps) {
  return (
    <>
      {!billingCheckoutReady && (
        <div
          className="flex items-start gap-3 rounded-[8px] bg-amber-500/10 p-4 text-[12px] font-light text-amber-800 dark:text-amber-300"
          role="status"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Cobranças temporariamente indisponíveis</p>
            <p className="mt-1 leading-5">
              O histórico e os comprovantes continuam disponíveis. Novos
              pagamentos, trocas de plano e confirmações ficam bloqueados até a
              atualização segura do ambiente financeiro.
            </p>
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-row items-center gap-2">
        <div
          data-collapse="standard"
          className="app-responsive-tab-list min-w-0 flex-1"
        >
          <nav
            data-responsive-tab-scroll
            aria-label="Navegação de faturamento"
            className="scrollbar-hidden flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-[8px] bg-[var(--app-surface-solid)] p-1"
          >
            {billingNavigation.map((item) => {
              const isActive = activePage === item.id;
              const Icon = item.icon;

              return (
                <button
                  key={item.id}
                  type="button"
                  data-responsive-tab
                  aria-label={item.label}
                  aria-pressed={isActive}
                  title={item.label}
                  onClick={() => onNavigate(item.id)}
                  className={cn(
                    "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[6px] px-3 text-xs font-light transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                    isActive
                      ? "bg-[var(--app-surface-hover)] text-[var(--app-text-primary)]"
                      : "text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-soft)] hover:text-[var(--app-text-primary)]",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="app-responsive-tab-label">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {activePage === "payments" && (
          <div className="ml-auto flex w-[min(420px,55%)] min-w-0 shrink-0 justify-end">
            <div className="relative w-full max-w-[420px]">
              <Label
                htmlFor="billing-payment-history-search"
                className="sr-only"
              >
                Pesquisar no histórico de pagamentos
              </Label>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="billing-payment-history-search"
                value={historyQuery}
                onChange={(event) => onHistoryQueryChange(event.target.value)}
                placeholder="Pesquisar por fatura, status ou método"
                className="!h-9 rounded-[6px] border-0 bg-[var(--app-surface-solid)] !py-0 pl-9 !text-[12px] font-light shadow-none placeholder:text-[var(--app-text-tertiary)] focus-visible:ring-1 focus-visible:ring-primary/30"
              />
            </div>
          </div>
        )}

        {activePage === "methods" && (
          <div className="ml-auto flex min-w-0 shrink-0 flex-wrap justify-end gap-2">
            {!billingProfileReady && (
              <Button
                variant="outline"
                size="sm"
                onClick={onOpenFiscalDetails}
              >
                Completar dados fiscais
              </Button>
            )}
            <Button
              size="sm"
              className="rounded-[6px] bg-primary/50 font-light text-primary-foreground shadow-none hover:bg-primary"
              disabled={!billingCheckoutReady}
              onClick={onOpenPaymentMethod}
            >
              Adicionar forma de pagamento
            </Button>
          </div>
        )}

        {activePage === "plans" && hasPlan && (
          <Badge
            variant="secondary"
            className="ml-auto w-fit shrink-0 rounded-[6px] px-3 py-1 font-light"
          >
            Plano atual: {commercialPlanDisplayName}
          </Badge>
        )}
      </div>
    </>
  );
}
