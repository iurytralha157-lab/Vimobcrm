"use client";

import type { RefObject } from "react";
import NextImage from "next/image";
import {
  ArrowRight,
  Copy,
  CreditCard,
  ExternalLink,
  LockKeyhole,
  QrCode,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { CardPaymentFields } from "@/components/features/auth/CardPaymentFields";
import { VimobLoader } from "@/components/shared/loading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatBoletoDueDate } from "@/lib/billing/checkout-domain";
import type {
  BoletoResult,
  PaymentMethod,
  PaymentRecoveryState,
  PixResult,
} from "@/lib/billing/checkout-types";

type CardFields = {
  holderName: string;
  holderDocument: string;
  number: string;
  expiryMonth: string;
  expiryYear: string;
  ccv: string;
  onHolderNameChange: (value: string) => void;
  onHolderDocumentChange: (value: string) => void;
  onNumberChange: (value: string) => void;
  onExpiryMonthChange: (value: string) => void;
  onExpiryYearChange: (value: string) => void;
  onCcvChange: (value: string) => void;
};

export type CheckoutPaymentSectionProps = {
  formRef: RefObject<HTMLFormElement | null>;
  billing: {
    confirmed: boolean;
    managingPaymentMethod: boolean;
    periods: number[];
  };
  payment: {
    isFormReady: boolean;
    providerProcessing: boolean;
    checkoutMethod: PaymentMethod;
    processingMethod: PaymentMethod | null;
    submitting: boolean;
    recoveryMessage: string | null;
    recoveryState: PaymentRecoveryState | null;
    pollingExpired: boolean;
    cancelling: boolean;
    recoveryInProgress: boolean;
    bankSlipRegistrationCancelled: boolean;
    cardUpdateJobId: string | null;
    cardUpdateMode: "settled_payment" | "saved_only" | null;
    tab: PaymentMethod;
  };
  pixResult: PixResult | null;
  boletoResult: BoletoResult | null;
  card: CardFields;
  actions: {
    onSubmit: (method: PaymentMethod) => Promise<void>;
    onRetryStatus: () => void;
    onUseAnotherPaymentMethod: () => Promise<void>;
    onTabChange: (method: PaymentMethod) => void;
  };
};

async function copyPaymentCode(value: string, successMessage: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(successMessage);
  } catch {
    toast.error(
      "Não foi possível copiar automaticamente. Selecione o código e copie manualmente.",
    );
  }
}

export function CheckoutPaymentSection({
  formRef,
  billing,
  payment,
  pixResult,
  boletoResult,
  card,
  actions,
}: CheckoutPaymentSectionProps) {
  const {
    confirmed: billingDetailsConfirmed,
    managingPaymentMethod,
    periods: billingPeriods,
  } = billing;
  const {
    isFormReady: isPaymentFormReady,
    providerProcessing: paymentProviderProcessing,
    checkoutMethod,
    processingMethod,
    submitting,
    recoveryMessage,
    recoveryState,
    pollingExpired: directPollingExpired,
    cancelling: cancellingDirectPayment,
    recoveryInProgress: paymentRecoveryInProgress,
    bankSlipRegistrationCancelled,
    cardUpdateJobId: directCardUpdateJobId,
    cardUpdateMode: directCardUpdateMode,
    tab,
  } = payment;
  const {
    holderName: cardHolderName,
    holderDocument: cardHolderDocument,
    number: cardNumber,
    expiryMonth: cardExpiryMonth,
    expiryYear: cardExpiryYear,
    ccv: cardCcv,
    onHolderNameChange: setCardHolderName,
    onHolderDocumentChange: setCardHolderDocument,
    onNumberChange: setCardNumber,
    onExpiryMonthChange: setCardExpiryMonth,
    onExpiryYearChange: setCardExpiryYear,
    onCcvChange: setCardCcv,
  } = card;
  const {
    onSubmit: handleSubmit,
    onRetryStatus: handleRetryDirectStatus,
    onUseAnotherPaymentMethod: handleUseAnotherPaymentMethod,
    onTabChange: setTab,
  } = actions;
  const boletoDueDate = boletoResult
    ? formatBoletoDueDate(boletoResult.due_date)
    : null;
  const boletoPaymentCode = boletoResult?.identification_field ||
    boletoResult?.bar_code || "";
  const boletoPaymentCodeLabel = boletoResult?.identification_field
    ? "Linha digitável"
    : "Código de barras";
  const boletoPaymentCodeCopiedMessage = boletoResult?.identification_field
    ? "Linha digitável copiada!"
    : "Código de barras copiado!";
  const boletoDocumentUrl = boletoResult?.bank_slip_url ||
    boletoResult?.invoice_url || "";
  const boletoArtifactsReady = Boolean(boletoDocumentUrl || boletoPaymentCode);

  return (
          <form
            ref={formRef}
            id="checkout-payment-form"
            className="min-w-0 rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-4 shadow-none sm:p-5"
            onSubmit={(event) => {
              event.preventDefault();
              if (isPaymentFormReady) void handleSubmit(checkoutMethod);
            }}
          >
            <div className="flex items-center gap-3">
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] text-[12px] font-light ${
                  billingDetailsConfirmed
                    ? "bg-primary/50 text-primary-foreground"
                    : "bg-[var(--app-surface-soft)] text-[var(--app-text-tertiary)]"
                }`}
              >
                {managingPaymentMethod ? 2 : 3}
              </span>
              <h2 className="app-section-title">
                {managingPaymentMethod
                  ? "Cartão recorrente"
                  : "Informação de pagamento"}
              </h2>
            </div>

            {!billingDetailsConfirmed
              ? (
                <div className="mt-5 flex items-center gap-3 rounded-[6px] bg-[var(--app-surface-soft)] p-4 text-[12px] font-light text-[var(--app-text-tertiary)]">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-[var(--app-surface-solid)]">
                    <LockKeyhole
                      className="h-3.5 w-3.5"
                      strokeWidth={1.6}
                      aria-hidden="true"
                    />
                  </span>
                  Confira os dados de faturamento para liberar as formas de
                  pagamento.
                </div>
              )
              : paymentProviderProcessing
              ? (
                <div className="mt-5 flex items-start gap-3 rounded-[6px] bg-[var(--app-surface-soft)] p-4 text-[12px] font-light text-[var(--app-text-tertiary)]">
                  <VimobLoader size="xs" label="Processando pagamento..." />
                  <span>
                    O pagamento já foi enviado e está em análise. As formas de
                    pagamento ficam bloqueadas até a confirmação.
                  </span>
                </div>
              )
              : pixResult
              ? (
                <div className="mt-5 space-y-4 text-center" aria-live="polite">
                  <div>
                    <h3 className="text-[14px] font-light">
                      {pixResult.qr_code || pixResult.qr_payload
                        ? "Pague com Pix"
                        : "Preparando seu Pix"}
                    </h3>
                    <p className="mt-1 text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
                      {pixResult.qr_code || pixResult.qr_payload
                        ? "Escaneie o QR Code ou use o código copia e cola. A confirmação é automática."
                        : recoveryMessage ||
                          "A cobrança já foi criada e o código está sendo recuperado."}
                    </p>
                  </div>
                  {pixResult.qr_code
                    ? (
                      <NextImage
                        src={`data:image/png;base64,${pixResult.qr_code}`}
                        alt="QR Code Pix"
                        width={256}
                        height={256}
                        className="mx-auto aspect-square h-auto w-full max-w-56 rounded-[8px] bg-[var(--app-surface-solid)] p-2"
                        unoptimized
                      />
                    )
                    : !pixResult.qr_payload
                    ? (
                      <div className="mx-auto flex h-48 w-full max-w-56 items-center justify-center rounded-[8px] bg-[var(--app-surface-soft)]">
                        {!directPollingExpired
                          ? (
                            <VimobLoader
                              size="sm"
                              label="Preparando código Pix..."
                            />
                          )
                          : (
                            <QrCode
                              className="h-6 w-6 text-[var(--app-text-tertiary)]"
                              aria-hidden="true"
                            />
                          )}
                      </div>
                    )
                    : null}
                  {pixResult.qr_payload
                    ? (
                      <div className="mx-auto flex max-w-xl items-center gap-2">
                        <Input
                          value={pixResult.qr_payload}
                          readOnly
                          aria-label="Código Pix copia e cola"
                          className="h-10 min-w-0 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[11px] font-light shadow-none"
                        />
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          className="h-10 w-10 shrink-0 rounded-[6px] border-0 bg-primary/50 text-primary-foreground shadow-none hover:bg-primary"
                          aria-label="Copiar código Pix"
                          onClick={() => {
                            void copyPaymentCode(
                              pixResult.qr_payload || "",
                              "Código Pix copiado!",
                            );
                          }}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    )
                    : null}
                  <div className="flex items-center justify-center gap-2 text-[11px] font-light text-[var(--app-text-tertiary)]">
                    {!directPollingExpired
                      ? (
                        <VimobLoader
                          size="xs"
                          label="Aguardando pagamento..."
                        />
                      )
                      : null}
                    {directPollingExpired
                      ? recoveryMessage || "A confirmação ainda está pendente."
                      : recoveryState === "settled"
                      ? "Pagamento recebido. Ativando assinatura..."
                      : pixResult.qr_code || pixResult.qr_payload
                      ? "Aguardando pagamento..."
                      : "Recuperando código Pix..."}
                  </div>
                  <div className="flex flex-col items-center justify-center gap-2 sm:flex-row">
                    {directPollingExpired
                      ? (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handleRetryDirectStatus}
                          className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[11px] font-light shadow-none hover:bg-primary hover:text-primary-foreground"
                        >
                          <RefreshCw className="mr-2 h-4 w-4" />
                          Atualizar status
                        </Button>
                      )
                      : null}
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-9 rounded-[6px] text-[11px] font-light"
                      disabled={cancellingDirectPayment}
                      onClick={() => void handleUseAnotherPaymentMethod()}
                    >
                      {cancellingDirectPayment
                        ? (
                          <VimobLoader
                            size="xs"
                            className="mr-2"
                            label="Cancelando cobrança..."
                          />
                        )
                        : null}
                      Usar outra forma
                    </Button>
                  </div>
                </div>
              )
              : boletoResult
              ? (
                <div className="mt-5 space-y-4" aria-live="polite">
                  <div className="flex items-start gap-3 rounded-[6px] bg-[var(--app-surface-soft)] p-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
                      <ReceiptText className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div>
                      <h3 className="text-[14px] font-light">
                        {boletoArtifactsReady
                          ? "Boleto gerado"
                          : "Preparando seu boleto"}
                      </h3>
                      <p className="mt-1 text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
                        {boletoArtifactsReady
                          ? (
                            <>
                              {boletoDueDate
                                ? `Vencimento em ${boletoDueDate}. `
                                : "Consulte o vencimento na fatura. "}
                              O plano será ativado automaticamente após a
                              compensação.
                            </>
                          )
                          : (
                            recoveryMessage ||
                            "A cobrança já foi criada e os dados bancários estão sendo recuperados."
                          )}
                      </p>
                    </div>
                  </div>

                  {boletoPaymentCode
                    ? (
                      <div>
                        <Label
                          htmlFor="boleto-identification-field"
                          className="text-[12px] font-light text-[var(--app-text-secondary)]"
                        >
                          {boletoPaymentCodeLabel}
                        </Label>
                        <div className="mt-2 flex items-center gap-2">
                          <Input
                            id="boleto-identification-field"
                            value={boletoPaymentCode}
                            readOnly
                            className="h-10 min-w-0 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[11px] font-light shadow-none"
                          />
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            className="h-10 w-10 shrink-0 rounded-[6px] border-0 bg-primary/50 text-primary-foreground shadow-none hover:bg-primary"
                            aria-label={`Copiar ${boletoPaymentCodeLabel.toLowerCase()}`}
                            onClick={() => {
                              void copyPaymentCode(
                                boletoPaymentCode,
                                boletoPaymentCodeCopiedMessage,
                              );
                            }}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    )
                    : null}

                  <div className="flex items-center gap-2 text-[11px] font-light text-[var(--app-text-tertiary)]">
                    {!directPollingExpired
                      ? (
                        <VimobLoader
                          size="xs"
                          label={boletoArtifactsReady
                            ? "Aguardando compensação do boleto..."
                            : "Preparando boleto..."}
                        />
                      )
                      : null}
                    {directPollingExpired
                      ? recoveryMessage || "A confirmação ainda está pendente."
                      : recoveryState === "settled"
                      ? "Pagamento recebido. Ativando assinatura..."
                      : boletoArtifactsReady
                      ? "Aguardando compensação bancária"
                      : "Recuperando dados do boleto..."}
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                    {boletoDocumentUrl
                      ? (
                        <Button
                          variant="outline"
                          asChild
                          className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[11px] font-light shadow-none hover:bg-primary hover:text-primary-foreground"
                        >
                          <a
                            href={boletoDocumentUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Abrir boleto
                            <ExternalLink className="ml-2 h-4 w-4" />
                          </a>
                        </Button>
                      )
                      : null}
                    {directPollingExpired
                      ? (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handleRetryDirectStatus}
                          className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[11px] font-light shadow-none hover:bg-primary hover:text-primary-foreground"
                        >
                          <RefreshCw className="mr-2 h-4 w-4" />
                          Atualizar status
                        </Button>
                      )
                      : null}
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-9 rounded-[6px] text-[11px] font-light"
                      disabled={cancellingDirectPayment}
                      onClick={() => void handleUseAnotherPaymentMethod()}
                    >
                      {cancellingDirectPayment
                        ? (
                          <VimobLoader
                            size="xs"
                            className="mr-2"
                            label="Cancelando cobrança..."
                          />
                        )
                        : null}
                      Usar outra forma
                    </Button>
                  </div>
                </div>
              )
              : (
                <Tabs
                  value={tab}
                  onValueChange={(value) => setTab(value as PaymentMethod)}
                  className="mt-5"
                >
                  {bankSlipRegistrationCancelled
                    ? (
                      <div
                        className="mb-4 flex items-start gap-2 rounded-[6px] bg-amber-500/10 p-3 text-[12px] font-light leading-[18px] text-amber-700 dark:text-amber-300"
                        role="status"
                      >
                        <ReceiptText
                          className="mt-0.5 h-4 w-4 shrink-0"
                          aria-hidden="true"
                        />
                        <span>
                          O boleto anterior expirou ou teve o registro bancário
                          cancelado. Gere um novo boleto ou escolha Pix ou
                          cartão; o documento antigo não está mais disponível.
                        </span>
                      </div>
                    )
                    : null}
                  {directCardUpdateJobId &&
                      directCardUpdateMode === "saved_only"
                    ? (
                      <div
                        className="mb-4 space-y-3 rounded-[6px] bg-amber-500/10 p-3 text-[12px] font-light leading-[18px] text-amber-700 dark:text-amber-300"
                        role="status"
                        aria-live="polite"
                      >
                        <div className="flex items-start gap-2">
                          {!directPollingExpired
                            ? (
                              <VimobLoader
                                size="xs"
                                label="Confirmando atualização do cartão..."
                              />
                            )
                            : (
                              <RefreshCw
                                className="mt-0.5 h-4 w-4 shrink-0"
                                aria-hidden="true"
                              />
                            )}
                          <span>
                            {recoveryMessage ||
                              (directPollingExpired
                                ? "A atualização continua em conciliação. Consulte novamente em instantes."
                                : "A atualização do cartão está sendo confirmada com segurança.")}
                          </span>
                        </div>
                        {directPollingExpired && recoveryState !== "assisted"
                          ? (
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={handleRetryDirectStatus}
                              className="h-8 px-2.5 text-[11px] font-light text-current hover:bg-amber-500/10"
                            >
                              <RefreshCw
                                className="mr-2 h-3.5 w-3.5"
                                aria-hidden="true"
                              />
                              Consultar novamente
                            </Button>
                          )
                          : null}
                      </div>
                    )
                    : processingMethod
                    ? (
                      <div className="mb-4 space-y-3 rounded-[6px] bg-amber-500/10 p-3 text-[12px] font-light leading-[18px] text-amber-700 dark:text-amber-300">
                        <div className="flex items-start gap-2">
                          {!directPollingExpired
                            ? (
                              <VimobLoader
                                size="xs"
                                label="Localizando cobrança..."
                              />
                            )
                            : (
                              <RefreshCw
                                className="mt-0.5 h-4 w-4 shrink-0"
                                aria-hidden="true"
                              />
                            )}
                          <span>
                            {recoveryMessage ||
                              (directPollingExpired
                                ? "A cobrança ainda não pôde ser localizada. Consulte novamente ou cancele a tentativa."
                                : "A cobrança está sendo localizada automaticamente sem gerar duplicidade.")}
                          </span>
                        </div>
                        {directPollingExpired
                          ? (
                            <Button
                              type="button"
                              variant="ghost"
                              disabled={cancellingDirectPayment}
                              onClick={() =>
                                void handleUseAnotherPaymentMethod()}
                              className="h-8 px-2.5 text-[11px] font-light text-current hover:bg-amber-500/10"
                            >
                              {cancellingDirectPayment
                                ? (
                                  <VimobLoader
                                    size="xs"
                                    className="mr-2"
                                    label="Cancelando tentativa..."
                                  />
                                )
                                : null}
                              Cancelar tentativa
                            </Button>
                          )
                          : null}
                      </div>
                    )
                    : null}
                  <TabsList
                    className={`grid h-10 w-full ${
                      managingPaymentMethod ? "grid-cols-1" : "grid-cols-3"
                    } rounded-[8px] bg-[var(--app-surface-soft)] p-1 text-[var(--app-text-tertiary)]`}
                  >
                    {!managingPaymentMethod
                      ? (
                        <>
                          <TabsTrigger
                            value="PIX"
                            disabled={submitting || Boolean(processingMethod) ||
                              Boolean(directCardUpdateJobId)}
                            className="mx-0 min-w-0 rounded-[6px] px-2 text-[11px] font-light shadow-none data-[state=active]:bg-[var(--app-surface-solid)] data-[state=active]:text-primary/70 data-[state=active]:shadow-none sm:text-[12px]"
                          >
                            <QrCode className="mr-1 h-3.5 w-3.5 sm:mr-1.5" />
                            Pix
                          </TabsTrigger>
                          <TabsTrigger
                            value="BOLETO"
                            disabled={submitting || Boolean(processingMethod) ||
                              Boolean(directCardUpdateJobId)}
                            className="mx-0 min-w-0 rounded-[6px] px-2 text-[11px] font-light shadow-none data-[state=active]:bg-[var(--app-surface-solid)] data-[state=active]:text-primary/70 data-[state=active]:shadow-none sm:text-[12px]"
                          >
                            <ReceiptText className="mr-1 h-3.5 w-3.5 sm:mr-1.5" />
                            Boleto
                          </TabsTrigger>
                        </>
                      )
                      : null}
                    <TabsTrigger
                      value="CREDIT_CARD"
                      disabled={submitting || Boolean(processingMethod) ||
                        Boolean(directCardUpdateJobId)}
                      className="mx-0 min-w-0 rounded-[6px] px-2 text-[11px] font-light shadow-none data-[state=active]:bg-[var(--app-surface-solid)] data-[state=active]:text-primary/70 data-[state=active]:shadow-none sm:text-[12px]"
                    >
                      <CreditCard className="mr-1 h-3.5 w-3.5 sm:mr-1.5" />
                      Cartão
                    </TabsTrigger>
                  </TabsList>

                  {tab === "CREDIT_CARD"
                    ? (
                      <CardPaymentFields
                        holderName={cardHolderName}
                        holderDocument={cardHolderDocument}
                        number={cardNumber}
                        expiryMonth={cardExpiryMonth}
                        expiryYear={cardExpiryYear}
                        ccv={cardCcv}
                        disabled={submitting || Boolean(processingMethod) ||
                          Boolean(directCardUpdateJobId)}
                        onHolderNameChange={setCardHolderName}
                        onHolderDocumentChange={setCardHolderDocument}
                        onNumberChange={setCardNumber}
                        onExpiryMonthChange={setCardExpiryMonth}
                        onExpiryYearChange={setCardExpiryYear}
                        onCcvChange={setCardCcv}
                      />
                    )
                    : null}
                </Tabs>
              )}
            <div className="mt-5 flex items-start gap-2 border-t border-[var(--app-border)] pt-4 text-[11px] font-light leading-[17px] text-[var(--app-text-tertiary)]">
              <ShieldCheck
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600"
                aria-hidden="true"
              />
              Seus dados são protegidos e processados em ambiente seguro.
            </div>

            {pixResult || boletoResult
              ? (
                <div className="mt-5 flex items-center gap-2 rounded-[6px] bg-amber-500/10 p-3 text-[11px] font-light text-amber-800 dark:text-amber-300">
                  {!directPollingExpired
                    ? (
                      <VimobLoader
                        size="xs"
                        label={pixResult
                          ? "Aguardando pagamento Pix..."
                          : "Aguardando compensação do boleto..."}
                      />
                    )
                    : (
                      <ReceiptText
                        className="h-4 w-4 shrink-0"
                        aria-hidden="true"
                      />
                    )}
                  {directPollingExpired
                    ? "Confirmação ainda pendente"
                    : pixResult
                    ? "Aguardando pagamento Pix"
                    : "Aguardando compensação do boleto"}
                </div>
              )
              : (
                <Button
                  type="submit"
                  className="mt-5 h-10 w-full rounded-[6px] bg-primary/50 text-[12px] font-light hover:bg-primary focus-visible:bg-primary"
                  disabled={submitting ||
                    Boolean(directCardUpdateJobId) ||
                    !isPaymentFormReady ||
                    (!managingPaymentMethod &&
                      billingPeriods.length === 0 &&
                      !paymentRecoveryInProgress)}
                >
                  {submitting
                    ? (
                      <VimobLoader
                        size="sm"
                        className="mr-2"
                        label={checkoutMethod === "PIX"
                          ? "Gerando QR Code Pix..."
                          : checkoutMethod === "BOLETO"
                          ? "Gerando boleto..."
                          : managingPaymentMethod
                          ? "Salvando cartão..."
                          : "Cadastrando cartão..."}
                      />
                    )
                    : processingMethod
                    ? <RefreshCw className="mr-2 h-4 w-4" />
                    : checkoutMethod === "PIX"
                    ? <QrCode className="mr-2 h-4 w-4" />
                    : checkoutMethod === "BOLETO"
                    ? <ReceiptText className="mr-2 h-4 w-4" />
                    : <CreditCard className="mr-2 h-4 w-4" />}
                  {processingMethod
                    ? "Localizar cobrança"
                    : checkoutMethod === "PIX"
                    ? "Gerar QR Code Pix"
                    : checkoutMethod === "BOLETO"
                    ? "Gerar boleto"
                    : managingPaymentMethod
                    ? "Salvar cartão recorrente"
                    : "Cadastrar cartão"}
                  {!submitting && !processingMethod
                    ? <ArrowRight className="ml-2 h-4 w-4" />
                    : null}
                </Button>
              )}
          </form>
  );
}
