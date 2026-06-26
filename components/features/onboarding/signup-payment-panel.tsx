"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { CheckCircle2, Copy, CreditCard, QrCode, ShieldCheck } from "lucide-react";
import { VimobLoader } from "@/components/shared/loading";
import { toast } from "sonner";
import { paymentsAPI } from "@/lib/api/payments";

type SignupPaymentPlan = {
  name: string;
  price: string;
  description: string;
  signupPath: "trial" | "paid";
};

type PaymentMethod = "PIX" | "CREDIT_CARD";

type BillingData = {
  email: string;
  cpfCnpj: string;
  phone: string;
  holderName: string;
  cardNumber: string;
  expiry: string;
  ccv: string;
  postalCode: string;
  addressNumber: string;
};

type PixResult = {
  success: true;
  type: "PIX";
  payment_id: string;
  invoice_url: string;
  qr_code: string;
  qr_payload: string;
  value: number;
};

type CardResult = {
  success: true;
  type: "CREDIT_CARD";
  subscription_id: string;
  status: string;
  next_due_date: string;
  value: number;
};

type ChargeResult =
  | PixResult
  | CardResult
  | { success?: false; error?: string };

type CancelPaymentResult = {
  success?: boolean;
  error?: string;
};

type PaymentStatusResponse = {
  payment?: {
    status?: string;
  };
};

type SignupPaymentPanelProps = {
  step: number;
  selectedPlan?: SignupPaymentPlan;
  checkoutToken: string | null;
  companyName: string;
  adminName: string;
  email: string;
  documentNumber: string;
  phoneCountryCode: string;
  phone: string;
  onAccessPlatform: () => void | Promise<void>;
  isPlanChangeMode: boolean;
  onRequestPlanChange: () => void;
};

const fieldClass =
  "h-11 min-w-0 w-full rounded-[6px] bg-[#121212]/40 px-3 text-sm font-extralight tracking-wide text-white placeholder:text-white/30 outline-none transition-colors focus:bg-[#121212]/50";

const labelClass = "text-xs font-extralight tracking-wide text-white/58";

type FunctionErrorPayload = {
  error?: string;
  message?: string;
  errors?: Array<{ description?: string }>;
};

function isResponse(value: unknown): value is Response {
  return (
    typeof value === "object" &&
    value !== null &&
    "clone" in value &&
    "json" in value
  );
}

async function getErrorMessage(error: unknown) {
  if (error instanceof Error && "context" in error && isResponse(error.context)) {
    try {
      const payload = (await error.context.clone().json()) as FunctionErrorPayload;
      const message =
        payload.error || payload.message || payload.errors?.[0]?.description;

      if (message) return message;
    } catch {
      return error.message;
    }
  }

  if (error instanceof Error) return error.message;
  return String(error || "Não foi possível processar o pagamento.");
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

function normalizePaymentPhone(value: string) {
  const digits = onlyDigits(value);

  if (digits.startsWith("55") && digits.length > 11) {
    return digits.slice(2);
  }

  return digits;
}

function formatExpiry(value: string) {
  const digits = onlyDigits(value).slice(0, 4);

  if (digits.length <= 2) {
    return digits;
  }

  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

function getExpiryParts(value: string) {
  const digits = onlyDigits(value);
  const month = digits.slice(0, 2);
  const year = digits.slice(2, 4);

  if (month.length !== 2 || year.length !== 2) return null;

  const monthNumber = Number(month);
  if (monthNumber < 1 || monthNumber > 12) return null;

  return {
    month,
    year: `20${year}`,
  };
}

function isPaidStatus(status?: string) {
  return status === "CONFIRMED" || status === "RECEIVED" || status === "RECEIVED_IN_CASH";
}

export function SignupPaymentPanel({
  step,
  selectedPlan,
  checkoutToken,
  companyName,
  adminName,
  email,
  documentNumber,
  phoneCountryCode,
  phone,
  onAccessPlatform,
  isPlanChangeMode,
  onRequestPlanChange,
}: SignupPaymentPanelProps) {
  const [method, setMethod] = useState<PaymentMethod>("PIX");
  const [billingData, setBillingData] = useState<BillingData>({
    email: "",
    cpfCnpj: "",
    phone: "",
    holderName: "",
    cardNumber: "",
    expiry: "",
    ccv: "",
    postalCode: "",
    addressNumber: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [pixResult, setPixResult] = useState<PixResult | null>(null);
  const [cardResult, setCardResult] = useState<CardResult | null>(null);
  const [paid, setPaid] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [isCanceling, setIsCanceling] = useState(false);

  const isPaidPlan = selectedPlan?.signupPath === "paid";
  const fullPhone = `${phoneCountryCode} ${phone}`.trim();

  const effectiveBillingData = {
    ...billingData,
    email: billingData.email || email,
    cpfCnpj: billingData.cpfCnpj || documentNumber,
    phone: billingData.phone || fullPhone,
    holderName: billingData.holderName || adminName,
  };

  useEffect(() => {
    if (!pixResult?.payment_id || paid) return;

    const interval = window.setInterval(async () => {
      const data = await paymentsAPI.paymentStatus<PaymentStatusResponse>(pixResult.payment_id);

      if (isPaidStatus(data?.payment?.status)) {
        setPaid(true);
        window.clearInterval(interval);
        toast.success("Pagamento confirmado. Acesso liberado.");
      }
    }, 5000);

    return () => window.clearInterval(interval);
  }, [paid, pixResult?.payment_id]);

  useEffect(() => {
    if (!paid) return;

    const timeout = window.setTimeout(() => {
      void onAccessPlatform();
    }, 1200);

    return () => window.clearTimeout(timeout);
  }, [onAccessPlatform, paid]);

  function updateBillingField(field: keyof BillingData, value: string) {
    setBillingData((current) => ({ ...current, [field]: value }));
  }

  async function handlePayment() {
    if (!checkoutToken || !selectedPlan || isPlanChangeMode) return;
    const expiry = getExpiryParts(billingData.expiry);

    setSubmitting(true);
    setPaymentError(null);

    try {
      const body: Record<string, string> = {
        checkout_token: checkoutToken,
        billing_type: method,
        holder_email: effectiveBillingData.email.trim(),
        holder_cpf_cnpj: effectiveBillingData.cpfCnpj.trim(),
        holder_phone: normalizePaymentPhone(effectiveBillingData.phone),
      };

      if (method === "CREDIT_CARD") {
        if (!expiry) {
          throw new Error("Informe a validade do cartao no formato MM/AA.");
        }

        Object.assign(body, {
          holder_name: effectiveBillingData.holderName.trim(),
          card_number: onlyDigits(billingData.cardNumber),
          expiry_month: expiry.month,
          expiry_year: expiry.year,
          ccv: billingData.ccv.trim(),
          holder_postal_code: onlyDigits(billingData.postalCode),
          holder_address_number: billingData.addressNumber.trim(),
        });
      }

      const data = await paymentsAPI.createCharge<ChargeResult>(body);
      if (!data?.success) throw new Error(data?.error || "Falha ao processar pagamento.");

      if (data.type === "PIX") {
        setPixResult(data);
        setCardResult(null);
        toast.success("QR Code Pix gerado.");
        return;
      }

      setCardResult(data);
      setPixResult(null);
      setPaid(true);
      toast.success("Assinatura ativada. Acesso liberado.");
    } catch (error) {
      setPaymentError(await getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelPixAttempt(nextAction: PaymentMethod | "PLAN") {
    if (!checkoutToken || !pixResult?.payment_id) return;

    setIsCanceling(true);
    setPaymentError(null);

    try {
      const data = await paymentsAPI.cancelPayment<CancelPaymentResult>({
        payment_id: pixResult.payment_id,
        checkout_token: checkoutToken,
      });
      if (!data?.success) {
        throw new Error(data?.error || "Não foi possível cancelar a cobrança.");
      }

      setPixResult(null);

      if (nextAction === "PLAN") {
        onRequestPlanChange();
        toast.success("Cobranca cancelada. Escolha outro plano.");
        return;
      }

      setMethod(nextAction);
      toast.success("Cobranca cancelada.");
    } catch (error) {
      setPaymentError(await getErrorMessage(error));
    } finally {
      setIsCanceling(false);
    }
  }

  const canSubmitPix =
    !!checkoutToken &&
    !!effectiveBillingData.email.trim() &&
    !!effectiveBillingData.cpfCnpj.trim() &&
    !submitting &&
    !isCanceling &&
    !isPlanChangeMode;
  const canSubmitCard =
    canSubmitPix &&
    !!effectiveBillingData.holderName.trim() &&
    !!billingData.cardNumber.trim() &&
    !!getExpiryParts(billingData.expiry) &&
    !!billingData.ccv.trim() &&
    !!billingData.postalCode.trim() &&
    !!billingData.addressNumber.trim();

  return (
    <aside className="w-full rounded-[8px] bg-[#121212]/40 p-4 shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur-md sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[6px] bg-[#151515]/50 px-3 py-2.5">
        <p className="text-[10px] font-extralight uppercase tracking-[0.18em] text-white/42">
          Organização
        </p>
        <p className="text-sm font-light tracking-wide text-white/72">
          {companyName || "Organização em criação"}
        </p>
      </div>

      {step < 3 ? (
        <div className="space-y-3 text-sm font-extralight leading-6 text-white/48">
          <p>O pagamento aparece aqui depois da escolha do plano.</p>
          <p>Para Starter, o acesso entra em teste gratis. Para Pro e Master, o pagamento fica nesta coluna.</p>
        </div>
      ) : !isPaidPlan ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-[6px] bg-[#FF4529]/10 p-4">
            <ShieldCheck className="h-5 w-5 text-[#FF4529]" />
            <p className="text-sm font-extralight leading-6 text-white/58">
              O Starter comeca com 7 dias gratis. Nenhum pagamento e cobrado agora.
            </p>
          </div>
        </div>
      ) : !checkoutToken ? (
        <div className="space-y-3">
          <div className="rounded-[6px] bg-[#FF4529]/15 px-4 py-3">
            <p className="text-center text-sm font-extralight leading-5 text-white/74">
              Clique em criar e pagar para aparecer as opcoes de Pix ou cartao de credito aqui mesmo, sem sair da tela.
            </p>
          </div>
          <p className="text-center text-[11px] font-extralight leading-5 text-white/36">
            O cartao sera enviado diretamente ao ASAAS. O Vimob guarda apenas os identificadores da assinatura.
          </p>
        </div>
      ) : paid || cardResult ? (
        <div className="space-y-5 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-[8px] border border-[#FF4529] text-[#FF4529]">
            <CheckCircle2 className="h-7 w-7" />
          </div>
          <div className="space-y-2">
            <h3 className="text-base font-light tracking-wide text-white">
              Acesso liberado
            </h3>
            <p className="text-sm font-extralight leading-6 text-white/54">
              Sua assinatura foi confirmada e a organizacao ja pode acessar o CRM.
            </p>
          </div>
          <button
            type="button"
            onClick={onAccessPlatform}
            className="h-12 w-full rounded-[6px] bg-[#FF4529] text-[12px] font-extralight uppercase tracking-[0.08em] text-white outline-none transition-opacity hover:opacity-90 focus-visible:opacity-90"
          >
            Acessar plataforma
          </button>
        </div>
      ) : pixResult ? (
        <div className="space-y-4">
          <div className="rounded-[8px] bg-white p-3">
            {pixResult.qr_code ? (
              <Image
                src={`data:image/png;base64,${pixResult.qr_code}`}
                alt="QR Code Pix"
                width={224}
                height={224}
                className="mx-auto h-56 w-56"
                unoptimized
              />
            ) : (
              <div className="flex h-56 items-center justify-center text-sm text-black/60">
                QR Code indisponivel
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <input
              value={pixResult.qr_payload}
              readOnly
              className={`${fieldClass} min-w-0 flex-1 text-xs`}
            />
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(pixResult.qr_payload);
                toast.success("Codigo Pix copiado.");
              }}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[6px] bg-[#121212]/40 text-white/70 transition-colors hover:bg-[#121212]/50 hover:text-[#FF4529]"
              aria-label="Copiar Pix"
            >
              <Copy className="h-4 w-4" />
            </button>
          </div>
          <p className="flex items-center justify-center gap-2 text-xs font-extralight text-white/45">
            <VimobLoader size="xs" label="Aguardando confirmacao do ASAAS" />
            Aguardando confirmacao do ASAAS
          </p>
          <p className="text-center text-xs font-extralight leading-5 text-white/38">
            Para trocar plano ou forma de pagamento, cancele esta cobranca primeiro.
          </p>
          {paymentError ? (
            <p className="text-center text-xs font-light leading-5 text-[#FF4529]">
              {paymentError}
            </p>
          ) : null}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <button
              type="button"
              onClick={() => void cancelPixAttempt("PIX")}
              disabled={isCanceling}
              className="min-h-10 rounded-[6px] bg-[#121212]/40 px-3 py-2 text-[11px] font-extralight uppercase leading-4 tracking-[0.08em] text-white/62 transition-colors hover:bg-[#121212]/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
            >
              {isCanceling ? "Cancelando" : "Novo Pix"}
            </button>
            <button
              type="button"
              onClick={() => void cancelPixAttempt("CREDIT_CARD")}
              disabled={isCanceling}
              className="min-h-10 rounded-[6px] bg-[#FF4529]/15 px-3 py-2 text-[11px] font-extralight uppercase leading-4 tracking-[0.08em] text-white transition-colors hover:bg-[#FF4529]/20 disabled:cursor-not-allowed disabled:opacity-45"
            >
              Cartao
            </button>
            <button
              type="button"
              onClick={() => void cancelPixAttempt("PLAN")}
              disabled={isCanceling}
              className="min-h-10 rounded-[6px] bg-[#121212]/40 px-3 py-2 text-[11px] font-extralight uppercase leading-4 tracking-[0.08em] text-white/62 transition-colors hover:bg-[#121212]/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
            >
              Trocar plano
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {checkoutToken ? (
            <div className="rounded-[6px] bg-[#151515]/50 p-3">
              <p className="text-xs font-extralight leading-5 text-white/45">
                {isPlanChangeMode
                  ? "Escolha o novo plano no formulario. O pagamento fica pausado ate voce concluir a troca."
                  : "Se precisar escolher outro plano, troque antes de gerar Pix ou tentar o cartao."}
              </p>
              {!isPlanChangeMode ? (
                <button
                  type="button"
                  onClick={onRequestPlanChange}
                  className="mt-3 h-9 w-full rounded-[6px] bg-[#FF4529]/15 text-[11px] font-extralight uppercase tracking-[0.08em] text-white transition-colors hover:bg-[#FF4529]/20"
                >
                  Trocar plano
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMethod("PIX")}
              disabled={isPlanChangeMode}
              className={`flex h-11 items-center justify-center gap-2 rounded-[6px] text-sm font-extralight transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                method === "PIX"
                  ? "bg-[#FF4529]/15 text-white"
                  : "bg-[#121212]/40 text-white/52 hover:bg-[#121212]/50"
              }`}
            >
              <QrCode className="h-4 w-4" />
              Pix
            </button>
            <button
              type="button"
              onClick={() => setMethod("CREDIT_CARD")}
              disabled={isPlanChangeMode}
              className={`flex h-11 items-center justify-center gap-2 rounded-[6px] text-sm font-extralight transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                method === "CREDIT_CARD"
                  ? "bg-[#FF4529]/15 text-white"
                  : "bg-[#121212]/40 text-white/52 hover:bg-[#121212]/50"
              }`}
            >
              <CreditCard className="h-4 w-4" />
              Cartao
            </button>
          </div>

          <div className="grid gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="min-w-0 space-y-1.5">
                <span className={labelClass}>CPF/CNPJ</span>
                <input
                  value={effectiveBillingData.cpfCnpj}
                  onChange={(event) => updateBillingField("cpfCnpj", event.target.value)}
                  className={fieldClass}
                />
              </label>
              <label className="min-w-0 space-y-1.5">
                <span className={labelClass}>WhatsApp</span>
                <input
                  value={effectiveBillingData.phone}
                  onChange={(event) => updateBillingField("phone", event.target.value)}
                  className={fieldClass}
                />
              </label>
            </div>

            {method === "CREDIT_CARD" ? (
              <>
                <label className="min-w-0 space-y-1.5">
                  <span className={labelClass}>Nome no cartao</span>
                  <input
                    value={effectiveBillingData.holderName}
                    onChange={(event) => updateBillingField("holderName", event.target.value)}
                    className={fieldClass}
                  />
                </label>
                <label className="min-w-0 space-y-1.5">
                  <span className={labelClass}>Numero do cartao</span>
                  <input
                    value={billingData.cardNumber}
                    onChange={(event) => updateBillingField("cardNumber", event.target.value)}
                    inputMode="numeric"
                    placeholder="0000 0000 0000 0000"
                    className={fieldClass}
                  />
                </label>
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(88px,120px)] gap-3">
                  <label className="min-w-0 space-y-1.5">
                    <span className={labelClass}>Validade</span>
                    <input
                      value={billingData.expiry}
                      onChange={(event) =>
                        updateBillingField("expiry", formatExpiry(event.target.value))
                      }
                      inputMode="numeric"
                      maxLength={5}
                      placeholder="MM/AA"
                      className={fieldClass}
                    />
                  </label>
                  <label className="min-w-0 space-y-1.5">
                    <span className={labelClass}>CVV</span>
                    <input
                      value={billingData.ccv}
                      onChange={(event) => updateBillingField("ccv", event.target.value)}
                      inputMode="numeric"
                      maxLength={4}
                      className={fieldClass}
                    />
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="min-w-0 space-y-1.5">
                    <span className={labelClass}>CEP</span>
                    <input
                      value={billingData.postalCode}
                      onChange={(event) => updateBillingField("postalCode", event.target.value)}
                      inputMode="numeric"
                      className={fieldClass}
                    />
                  </label>
                  <label className="min-w-0 space-y-1.5">
                    <span className={labelClass}>Numero</span>
                    <input
                      value={billingData.addressNumber}
                      onChange={(event) => updateBillingField("addressNumber", event.target.value)}
                      className={fieldClass}
                    />
                  </label>
                </div>
                <p className="text-[11px] font-extralight leading-5 text-white/36">
                  O Vimob nao armazena dados completos do cartao. A recorrencia fica tokenizada no ASAAS.
                </p>
              </>
            ) : null}
          </div>

          {paymentError ? (
            <p className="text-center text-xs font-light leading-5 text-[#FF4529]">
              {paymentError}
            </p>
          ) : null}

          <button
            type="button"
            onClick={handlePayment}
            disabled={method === "PIX" ? !canSubmitPix : !canSubmitCard}
            className="h-12 w-full rounded-[6px] bg-[#FF4529] text-[12px] font-extralight uppercase tracking-[0.08em] text-white outline-none transition-opacity hover:opacity-90 focus-visible:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {submitting
              ? "Processando"
              : method === "PIX"
                ? "Gerar QR Code Pix"
                : "Ativar assinatura"}
          </button>
        </div>
      )}
    </aside>
  );
}
