"use client";

import { useState } from "react";
import { CheckCircle2, CreditCard, QrCode, ReceiptText, ShieldCheck } from "lucide-react";

import {
  buildCheckoutPaymentPath,
  type CheckoutPaymentMethod,
} from "@/lib/billing/checkout-ui-state";

type SignupPaymentPlan = {
  id?: string;
  slug?: string;
  name: string;
  price: string;
  description: string;
  signupPath: "trial" | "paid";
  billingCycle?: string | null;
  trialEnabled?: boolean | null;
  trialDays?: number | null;
  maxUsers?: number | null;
  maxWhatsappSessions?: number | null;
  modules?: string[];
  features?: string[];
};

type PaymentMethod = CheckoutPaymentMethod;

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

const paymentMethodCopy: Record<PaymentMethod, { label: string; action: string }> = {
  PIX: { label: "Pix", action: "Continuar com Pix" },
  BOLETO: { label: "Boleto", action: "Continuar com boleto" },
  CREDIT_CARD: { label: "Cartão", action: "Continuar com cartão" },
};

function formatLimit(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "--";
  return value.toLocaleString("pt-BR");
}

function getTrialDays(plan: SignupPaymentPlan) {
  if (typeof plan.trialDays === "number" && plan.trialDays > 0) return plan.trialDays;
  return plan.signupPath === "trial" ? 7 : null;
}

function getPlanFeatures(plan: SignupPaymentPlan) {
  return plan.features || [];
}

function getPlanBadge(plan: SignupPaymentPlan, trialDays: number | null) {
  const slug = String(plan.slug || plan.name || "").toLowerCase();

  if (trialDays) return "Teste gratis";
  if (slug.includes("master")) return "Mais completo";
  if (slug.includes("pro") || slug.includes("intermediario")) return "Recomendado";

  return null;
}

function SecureCheckoutDisclosure() {
  return (
    <p className="text-center text-[10px] font-extralight leading-[1.15] text-white/36">
      <span className="block">O pagamento será concluído no checkout seguro da Vimob.</span>
      <span className="block">Os dados sensíveis do cartão não ficam armazenados no CRM.</span>
    </p>
  );
}

function PlanSummary({ plan }: { plan: SignupPaymentPlan }) {
  const trialDays = getTrialDays(plan);
  const features = getPlanFeatures(plan);
  const badge = getPlanBadge(plan, trialDays);

  return (
    <div className="rounded-[8px] border border-primary/25 bg-[var(--auth-hero-panel-strong)] px-4 py-4 shadow-none">
      <div className="text-center">
        {badge ? (
          <p className="mx-auto mb-2 inline-flex h-6 items-center rounded-[6px] bg-primary/15 px-3 text-[10px] font-light text-primary">
            {badge}
          </p>
        ) : null}
        <p className="text-base font-light text-white">{plan.name}</p>
        <p className="mt-1 text-[18px] font-light text-white">
          {plan.price}
        </p>
        <p className="mx-auto mt-1 max-w-[360px] text-[11px] font-extralight leading-4 text-white/46">
          {trialDays
            ? `${trialDays} dias gratis. Nenhum pagamento sera cobrado agora.`
            : plan.description}
        </p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 border-y border-white/8 py-3">
        <div className="rounded-[6px] bg-[var(--auth-hero-panel-hover)] px-3 py-2 text-center">
          <p className="text-[10px] font-light text-white/34">
            Usuarios
          </p>
          <p className="mt-0.5 text-sm font-light text-white">
            Ate {formatLimit(plan.maxUsers)}
          </p>
        </div>
        <div className="rounded-[6px] bg-[var(--auth-hero-panel-hover)] px-3 py-2 text-center">
          <p className="text-[10px] font-light text-white/34">
            WhatsApp
          </p>
          <p className="mt-0.5 text-sm font-light text-white">
            Ate {formatLimit(plan.maxWhatsappSessions)}
          </p>
        </div>
      </div>

      {features.length > 0 ? (
        <div className="mt-3">
          <p className="mb-2 text-[10px] font-light text-white/36">
            Acesso incluso
          </p>
          <div className="grid gap-1.5">
            {features.map((feature) => (
              <span
                key={feature}
                className="flex min-w-0 items-start gap-2 text-[11.5px] font-extralight leading-4 text-white/62"
              >
                <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                <span>{feature}</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function SignupPaymentPanel({
  step,
  selectedPlan,
  checkoutToken,
  companyName,
  isPlanChangeMode,
  onRequestPlanChange,
}: SignupPaymentPanelProps) {
  const [method, setMethod] = useState<PaymentMethod>("PIX");
  const [navigating, setNavigating] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  const isPaidPlan = selectedPlan?.signupPath === "paid";

  function handlePayment() {
    if (!selectedPlan || isPlanChangeMode) return;
    if (!checkoutToken) {
      setPaymentError("O checkout seguro da Vimob ainda não está disponível. Aguarde a conclusão do cadastro e tente novamente.");
      return;
    }

    const checkoutPath = buildCheckoutPaymentPath(checkoutToken, method);
    if (!checkoutPath) {
      setPaymentError("O link do checkout é inválido. Gere um novo cadastro para continuar.");
      return;
    }

    setPaymentError(null);
    setNavigating(true);
    window.location.assign(checkoutPath);
  }

  const canContinue = Boolean(
    checkoutToken && selectedPlan && !navigating && !isPlanChangeMode,
  );

  return (
    <aside className="w-full rounded-[8px] bg-[var(--auth-hero-panel)] p-4 shadow-none sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[6px] bg-[var(--auth-hero-panel-strong)] px-3 py-2.5">
        <p className="text-[10px] font-light text-white/42">
          Organização
        </p>
        <p className="text-sm font-light text-white/72">
          {companyName || "Organização em criação"}
        </p>
      </div>

      {step < 3 ? (
        <div className="space-y-3 text-sm font-extralight leading-6 text-white/48">
          <p>O pagamento aparece aqui depois da escolha do plano.</p>
          <p>Para Starter, o acesso entra em teste gratis. Para Pro e Master, o pagamento fica nesta coluna.</p>
        </div>
      ) : selectedPlan && !isPaidPlan ? (
        <div className="space-y-2">
          <PlanSummary plan={selectedPlan} />
          <div className="flex items-center gap-2 rounded-[6px] bg-primary/10 px-3 py-2">
            <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
            <p className="text-[11px] font-extralight leading-4 text-white/54">
              Acesso de teste liberado apos criar a organizacao.
            </p>
          </div>
        </div>
      ) : selectedPlan && !checkoutToken ? (
        <div className="space-y-2">
          <PlanSummary plan={selectedPlan} />
          <SecureCheckoutDisclosure />
        </div>
      ) : (
        <div className="space-y-4">
          {checkoutToken ? (
            <div className="rounded-[6px] bg-[var(--auth-hero-panel-strong)] p-3">
              <p className="text-xs font-extralight leading-5 text-white/45">
                {isPlanChangeMode
                  ? "Escolha o novo plano no formulário. O pagamento fica pausado até você concluir a troca."
                  : "Escolha como deseja pagar. Os dados e a cobrança serão gerados somente no checkout da Vimob."}
              </p>
              {!isPlanChangeMode ? (
                <button
                  type="button"
                  onClick={onRequestPlanChange}
                  className="mt-3 h-9 w-full rounded-[6px] bg-primary/15 text-[11px] font-light text-white transition-colors hover:bg-primary/20"
                >
                  Trocar plano
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Forma de pagamento">
            <button
              type="button"
              role="radio"
              aria-checked={method === "PIX"}
              onClick={() => setMethod("PIX")}
              disabled={isPlanChangeMode}
              className={`flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-[6px] px-2 text-[12px] font-extralight transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                method === "PIX"
                  ? "bg-primary/15 text-white"
                  : "bg-[var(--auth-hero-panel)] text-white/52 hover:bg-[var(--auth-hero-panel-hover)]"
              }`}
            >
              <QrCode className="h-4 w-4" />
              Pix
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={method === "BOLETO"}
              onClick={() => setMethod("BOLETO")}
              disabled={isPlanChangeMode}
              className={`flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-[6px] px-2 text-[12px] font-extralight transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                method === "BOLETO"
                  ? "bg-primary/15 text-white"
                  : "bg-[var(--auth-hero-panel)] text-white/52 hover:bg-[var(--auth-hero-panel-hover)]"
              }`}
            >
              <ReceiptText className="h-4 w-4 shrink-0" />
              Boleto
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={method === "CREDIT_CARD"}
              onClick={() => setMethod("CREDIT_CARD")}
              disabled={isPlanChangeMode}
              className={`flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-[6px] px-2 text-[12px] font-extralight transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                method === "CREDIT_CARD"
                  ? "bg-primary/15 text-white"
                  : "bg-[var(--auth-hero-panel)] text-white/52 hover:bg-[var(--auth-hero-panel-hover)]"
              }`}
            >
              <CreditCard className="h-4 w-4" />
              Cartão
            </button>
          </div>

          <div className="rounded-[6px] border border-primary/20 bg-primary/10 p-3">
            <div className="flex items-start gap-2.5">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <p className="text-[11px] font-extralight leading-5 text-white/52">
                {method === "CREDIT_CARD"
                  ? "Informe o cartão e autorize a recorrência no checkout seguro da Vimob."
                  : method === "BOLETO"
                    ? "Revise os dados de faturamento e gere o boleto no checkout seguro da Vimob."
                    : "Revise os dados de faturamento e gere o QR Code Pix no checkout seguro da Vimob."}
              </p>
            </div>
          </div>

          {paymentError ? (
            <p className="text-center text-xs font-light leading-5 text-primary">
              {paymentError}
            </p>
          ) : null}

          <button
            type="button"
            onClick={handlePayment}
            disabled={!canContinue}
            className="auth-primary-action h-12 w-full rounded-[6px] text-[12px] font-light outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-45"
          >
            <span className="inline-flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" />
              {navigating ? "Abrindo checkout" : paymentMethodCopy[method].action}
            </span>
          </button>
        </div>
      )}
    </aside>
  );
}
