import {
  Check,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  ReceiptText,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { VimobLoader } from "@/components/shared/loading";
import { CheckoutPageShell } from "./CheckoutPageShell";
import { DEFAULT_AUTHENTICATED_ROUTE } from "@/config/constants";
import type { CheckoutPaymentReceiptReference } from "@/lib/billing/payment-receipt";
import type { CardRecurrenceState } from "@/lib/billing/checkout-ui-state";
import type { PaymentRecoveryState } from "@/lib/billing/checkout-types";

export function CheckoutLoadingView() {
  return (
    <CheckoutPageShell>
      <div className="flex min-h-[55vh] items-center justify-center">
        <VimobLoader size="lg" label="Carregando checkout..." />
      </div>
    </CheckoutPageShell>
  );
}

export function CheckoutLoadErrorView({
  error,
  onRetry,
}: {
  error: { message: string; notFound: boolean } | null;
  onRetry: () => void;
}) {
  const notFound = error?.notFound ?? true;

  return (
    <CheckoutPageShell>
      <div className="flex min-h-[55vh] items-center justify-center">
        <Card className="w-full max-w-md rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
          <CardContent className="space-y-4 p-6 text-center sm:p-8">
            <div>
              <h2 className="text-[18px] font-normal text-[var(--app-text-primary)]">
                {notFound
                  ? "Checkout não encontrado"
                  : "Não foi possível carregar o checkout"}
              </h2>
              <p className="mt-2 text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
                {notFound
                  ? "Confira se o link está completo ou solicite um novo checkout."
                  : error?.message ||
                    "A conexão falhou temporariamente. Tente novamente."}
              </p>
            </div>
            {!notFound
              ? (
                <Button
                  type="button"
                  onClick={onRetry}
                  className="h-10 w-full rounded-[6px] bg-primary/50 text-[12px] font-light hover:bg-primary"
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Tentar novamente
                </Button>
              )
              : null}
          </CardContent>
        </Card>
      </div>
    </CheckoutPageShell>
  );
}

export function PaymentCheckoutUnavailableView({
  cancelled,
  message,
  onRetry,
}: {
  cancelled: boolean;
  message: string | null;
  onRetry: () => void;
}) {
  return (
    <CheckoutPageShell>
      <div className="flex min-h-[55vh] items-center justify-center">
        <Card className="w-full max-w-md rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
          <CardContent className="space-y-4 p-6 text-center sm:p-8">
            <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]">
              {cancelled
                ? <ReceiptText className="h-5 w-5" aria-hidden="true" />
                : <RefreshCw className="h-5 w-5" aria-hidden="true" />}
            </span>
            <h2 className="text-[18px] font-normal">
              {cancelled ? "Cobrança cancelada" : "Pagamento em verificação"}
            </h2>
            <p className="text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
              {cancelled
                ? "Esta cobrança não aceita mais pagamentos. Solicite um novo link à sua organização."
                : message ||
                  "Não liberamos uma nova tentativa enquanto o estado real da cobrança não puder ser confirmado."}
            </p>
            {!cancelled
              ? (
                <Button
                  type="button"
                  onClick={onRetry}
                  className="h-10 w-full rounded-[6px] bg-primary/50 text-[12px] font-light hover:bg-primary"
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Consultar novamente
                </Button>
              )
              : null}
          </CardContent>
        </Card>
      </div>
    </CheckoutPageShell>
  );
}

export function PaidCheckoutView({
  planName,
  recurrenceWarning,
  recurrenceState,
  pollingExpired,
  receipt,
  receiptLoading,
  onRefreshReceipt,
  onRetryStatus,
}: {
  planName?: string;
  recurrenceWarning: string | null;
  recurrenceState: CardRecurrenceState;
  pollingExpired: boolean;
  receipt: CheckoutPaymentReceiptReference | null;
  receiptLoading: boolean;
  onRefreshReceipt: () => void;
  onRetryStatus: () => void;
}) {
  return (
    <CheckoutPageShell>
      <div className="flex min-h-[55vh] items-center justify-center">
        <Card className="w-full max-w-md rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
          <CardContent className="space-y-4 p-6 text-center sm:p-8">
            <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-[6px] bg-emerald-500/10 text-emerald-600">
              <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
            </span>
            <h2 className="text-[18px] font-normal">Pagamento confirmado!</h2>
            <p className="text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
              Sua assinatura do {planName}{" "}
              está ativa. Você já pode usar o Vimob normalmente.
            </p>
            {recurrenceWarning
              ? (
                <div className="rounded-[6px] bg-amber-500/10 p-3 text-left text-[11px] font-light leading-[17px] text-amber-800 dark:text-amber-300">
                  <div className="flex items-start gap-2">
                    {recurrenceState === "processing" && !pollingExpired
                      ? (
                        <VimobLoader
                          size="xs"
                          className="mt-0.5"
                          label="Conciliando cartão recorrente..."
                        />
                      )
                      : (
                        <CreditCard
                          className="mt-0.5 h-4 w-4 shrink-0"
                          aria-hidden="true"
                        />
                      )}
                    <span>{recurrenceWarning}</span>
                  </div>
                </div>
              )
              : null}
            {recurrenceState === "saved"
              ? (
                <div className="flex items-center gap-2 rounded-[6px] bg-emerald-500/10 p-3 text-left text-[11px] font-light text-emerald-700 dark:text-emerald-300">
                  <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
                  Cartão recorrente confirmado para as próximas cobranças.
                </div>
              )
              : null}
            <div className="rounded-[6px] bg-[var(--app-surface-soft)] p-4 text-left">
              <div className="flex items-start gap-3">
                <ReceiptText
                  className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                  strokeWidth={1.7}
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p className="text-[12px] font-normal text-[var(--app-text-primary)]">
                    {receipt
                      ? `Comprovante ${receipt.number}`
                      : "Comprovante Vimob"}
                  </p>
                  <p className="mt-1 text-[11px] font-light leading-[17px] text-[var(--app-text-tertiary)]">
                    O envio para o e-mail e o WhatsApp cadastrados foi
                    enfileirado. Você também pode abrir o registro por aqui; ele
                    confirma o pagamento, mas não é documento fiscal.
                  </p>
                </div>
              </div>
            </div>
            {receipt
              ? (
                <Button
                  asChild
                  variant="outline"
                  className="h-10 w-full rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] font-light shadow-none hover:bg-primary hover:text-primary-foreground"
                >
                  <a
                    href={receipt.verification_path}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Ver comprovante
                    <ExternalLink
                      className="ml-2 h-4 w-4"
                      aria-hidden="true"
                    />
                  </a>
                </Button>
              )
              : (
                <Button
                  type="button"
                  variant="outline"
                  disabled={receiptLoading}
                  onClick={onRefreshReceipt}
                  className="h-10 w-full rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] font-light shadow-none hover:bg-primary hover:text-primary-foreground"
                >
                  {receiptLoading
                    ? (
                      <VimobLoader
                        size="xs"
                        className="mr-2"
                        label="Preparando comprovante..."
                      />
                    )
                    : (
                      <RefreshCw
                        className="mr-2 h-4 w-4"
                        aria-hidden="true"
                      />
                    )}
                  {receiptLoading
                    ? "Preparando comprovante"
                    : "Consultar comprovante"}
                </Button>
              )}
            <Button
              asChild
              className="h-10 w-full rounded-[6px] bg-primary/50 text-[12px] font-light hover:bg-primary"
            >
              <a href={DEFAULT_AUTHENTICATED_ROUTE}>Acessar plataforma</a>
            </Button>
            {recurrenceState === "failed"
              ? (
                <Button
                  asChild
                  variant="outline"
                  className="h-10 w-full rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] font-light shadow-none hover:bg-primary hover:text-primary-foreground"
                >
                  <a href="/settings?tab=subscription&billing=methods">
                    Atualizar cartão para renovação
                  </a>
                </Button>
              )
              : null}
            {recurrenceState === "processing" && pollingExpired
              ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={onRetryStatus}
                  className="h-10 w-full rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] font-light shadow-none hover:bg-primary hover:text-primary-foreground"
                >
                  <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
                  Consultar recorrência novamente
                </Button>
              )
              : null}
          </CardContent>
        </Card>
      </div>
    </CheckoutPageShell>
  );
}

export function CardConfirmationView({
  failureMessage,
  recoveryMessage,
  recoveryState,
  pollingExpired,
  recoveryPaymentId,
  recoverySubscriptionId,
  cancelling,
  onRetryStatus,
  onUseAnotherPaymentMethod,
}: {
  failureMessage: string | null;
  recoveryMessage: string | null;
  recoveryState: PaymentRecoveryState | null;
  pollingExpired: boolean;
  recoveryPaymentId: string | null;
  recoverySubscriptionId: string | null;
  cancelling: boolean;
  onRetryStatus: () => void;
  onUseAnotherPaymentMethod: () => void;
}) {
  const needsAction = Boolean(
    failureMessage || pollingExpired || recoveryState === "assisted",
  );
  const canBeCancelled = Boolean(
    recoveryState === "retry" ||
      (failureMessage && recoveryState !== "assisted") ||
      (pollingExpired && !recoveryPaymentId && !recoverySubscriptionId),
  );

  return (
    <CheckoutPageShell>
      <div className="flex min-h-[55vh] items-center justify-center">
        <Card className="w-full max-w-md rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
          <CardContent className="space-y-4 p-6 text-center sm:p-8">
            {!needsAction
              ? <VimobLoader size="lg" label="Confirmando pagamento..." />
              : (
                <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-[6px] bg-amber-500/10 text-amber-700 dark:text-amber-300">
                  <CreditCard className="h-5 w-5" aria-hidden="true" />
                </span>
              )}
            <h2 className="text-[18px] font-normal">
              {failureMessage
                ? "Cartão não autorizado"
                : needsAction
                ? "Confirmação pendente"
                : recoveryState === "settled"
                ? "Ativando sua assinatura"
                : "Confirmando pagamento"}
            </h2>
            <p className="text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
              {failureMessage ||
                recoveryMessage ||
                "Seu cartão foi cadastrado com segurança e ficou vinculado à assinatura. Estamos aguardando a confirmação da primeira cobrança."}
            </p>
            <Button
              variant="outline"
              onClick={onRetryStatus}
              className="h-10 w-full rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] font-light shadow-none hover:bg-primary hover:text-primary-foreground"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Consultar novamente
            </Button>
            {canBeCancelled
              ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={cancelling}
                  onClick={onUseAnotherPaymentMethod}
                  className="h-10 w-full rounded-[6px] text-[12px] font-light"
                >
                  {cancelling
                    ? (
                      <VimobLoader
                        size="xs"
                        className="mr-2"
                        label="Cancelando tentativa..."
                      />
                    )
                    : null}
                  Cancelar e tentar outro cartão
                </Button>
              )
              : null}
          </CardContent>
        </Card>
      </div>
    </CheckoutPageShell>
  );
}

export function PlanUnavailableView() {
  return (
    <CheckoutPageShell>
      <div className="flex min-h-[55vh] items-center justify-center">
        <Card className="w-full max-w-md rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
          <CardContent className="space-y-2 p-6 text-center sm:p-8">
            <h2 className="text-[18px] font-normal">Plano indisponível</h2>
            <p className="text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
              Este checkout não possui um plano válido. Solicite um novo link
              para continuar.
            </p>
          </CardContent>
        </Card>
      </div>
    </CheckoutPageShell>
  );
}
