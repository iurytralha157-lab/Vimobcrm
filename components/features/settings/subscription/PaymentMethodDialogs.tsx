import { ArrowRight, CreditCard, LockKeyhole, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

type PaymentMethodDialogsProps = {
  billingCheckoutReady: boolean;
  billingProfileReady: boolean;
  canManageExistingPaymentMethod: boolean;
  checkoutAllowed: boolean;
  methodDetailsOpen: boolean;
  paymentMethodDialogOpen: boolean;
  onMethodDetailsOpenChange: (open: boolean) => void;
  onPaymentMethodDialogOpenChange: (open: boolean) => void;
  onOpenCheckout: () => void;
  onOpenFiscalDetails: () => void;
  onOpenPlans: () => void;
};

export function PaymentMethodDialogs({
  billingCheckoutReady,
  billingProfileReady,
  canManageExistingPaymentMethod,
  checkoutAllowed,
  methodDetailsOpen,
  paymentMethodDialogOpen,
  onMethodDetailsOpenChange,
  onPaymentMethodDialogOpenChange,
  onOpenCheckout,
  onOpenFiscalDetails,
  onOpenPlans,
}: PaymentMethodDialogsProps) {
  return (
    <>
      <Sheet open={methodDetailsOpen} onOpenChange={onMethodDetailsOpenChange}>
        <SheetContent
          side="right"
          className="w-[94vw] overflow-y-auto sm:max-w-lg"
        >
          <SheetHeader className="pr-8">
            <SheetTitle className="text-[14px] font-normal">
              Cartão recorrente
            </SheetTitle>
            <SheetDescription>
              Forma de pagamento padrão da assinatura.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-5">
            <div className="flex items-center gap-4 rounded-[8px] border border-[var(--app-border)] p-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-[8px] bg-primary/10 text-primary">
                <CreditCard className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-medium">Cartão recorrente</p>
                  <Badge variant="secondary">Padrão</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Processado com segurança
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-[8px] bg-[var(--app-surface-soft)] p-4">
              <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <p className="text-sm leading-6 text-muted-foreground">
                Os dados sensíveis do cartão ficam no ambiente seguro do
                provedor. A Vimob recebe apenas o estado da cobrança e da
                recorrência.
              </p>
            </div>

            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                onMethodDetailsOpenChange(false);
                onPaymentMethodDialogOpenChange(true);
              }}
            >
              Adicionar outra forma
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog
        open={paymentMethodDialogOpen}
        onOpenChange={onPaymentMethodDialogOpenChange}
      >
        <DialogContent className="max-w-xl rounded-[8px] border-0 bg-[var(--app-surface-solid)] text-[12px] font-light shadow-none">
          <DialogHeader>
            <DialogTitle className="text-[14px] font-normal">
              Adicionar forma de pagamento
            </DialogTitle>
            <DialogDescription>
              O pagamento é finalizado no checkout seguro da Vimob.
            </DialogDescription>
          </DialogHeader>

          {!billingCheckoutReady ? (
            <div className="rounded-[8px] bg-amber-500/10 p-4 text-amber-800 dark:text-amber-300">
              <p className="font-medium">Checkout temporariamente bloqueado</p>
              <p className="mt-1 text-sm">
                Aguarde a atualização segura do ambiente financeiro antes de
                criar ou alterar uma cobrança.
              </p>
            </div>
          ) : !billingProfileReady ? (
            <div className="rounded-[8px] border border-warning/25 bg-warning/5 p-4">
              <p className="font-medium">Complete os dados fiscais primeiro</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Nome, CPF/CNPJ e e-mail financeiro são obrigatórios para emitir
                a cobrança.
              </p>
              <Button className="mt-4" onClick={onOpenFiscalDetails}>
                Preencher dados fiscais
              </Button>
            </div>
          ) : !checkoutAllowed ? (
            <div className="rounded-[8px] border border-[var(--app-border)] p-4">
              <p className="font-medium">Escolha o plano antes do pagamento</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Uma nova forma de pagamento é vinculada ao checkout do plano
                selecionado.
              </p>
              <Button className="mt-4" onClick={onOpenPlans}>
                Escolher plano
              </Button>
            </div>
          ) : (
            <div className="py-2">
              <button
                type="button"
                onClick={onOpenCheckout}
                className="flex w-full items-center gap-4 rounded-[8px] border border-primary/35 bg-primary/[0.06] p-4 text-left transition-colors hover:bg-primary/10"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] bg-primary text-primary-foreground">
                  <CreditCard className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {canManageExistingPaymentMethod
                      ? "Atualizar cartão recorrente"
                      : "Abrir checkout seguro"}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {canManageExistingPaymentMethod
                      ? "Atualize o cartão recorrente com segurança dentro da Vimob."
                      : "Escolha cartão, Pix ou boleto e conclua tudo dentro da Vimob."}
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-primary" />
              </button>
            </div>
          )}

          <div className="flex items-start gap-2 rounded-[8px] bg-[var(--app-surface-soft)] p-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 text-primary" />
            <p className="text-xs leading-5 text-muted-foreground">
              A Vimob não armazena número do cartão, validade ou CVV.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
