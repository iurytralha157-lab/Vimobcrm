import { ChevronRight, CreditCard } from "lucide-react";

import { Badge } from "@/components/ui/badge";

type PaymentMethodsPageProps = {
  hasAutomaticBilling: boolean;
  onOpenDetails: () => void;
};

export function PaymentMethodsPage({
  hasAutomaticBilling,
  onOpenDetails,
}: PaymentMethodsPageProps) {
  return (
    <section aria-label="Formas de pagamento" className="space-y-5">
      <div className="overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
        <div className="border-b border-[var(--app-border)] bg-[var(--app-surface-soft)] px-4 py-3">
          <p className="text-sm font-medium">Lista de formas de pagamento</p>
        </div>

        {hasAutomaticBilling ? (
          <button
            type="button"
            onClick={onOpenDetails}
            className="flex w-full items-center gap-4 p-4 text-left transition-colors hover:bg-[var(--app-surface-hover)]"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-primary/10 text-primary">
              <CreditCard className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">Cartão recorrente</p>
                <Badge variant="secondary">Padrão</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Gerenciado com segurança pelo provedor de pagamento
              </p>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        ) : (
          <div className="px-4 py-12 text-center">
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-[var(--app-surface-soft)] text-muted-foreground">
              <CreditCard className="h-5 w-5" />
            </div>
            <p className="mt-3 text-sm font-medium">Nenhuma forma salva</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Adicione uma forma de pagamento somente quando precisar.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
