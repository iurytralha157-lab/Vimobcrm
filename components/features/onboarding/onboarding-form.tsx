"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { SignupPaymentPanel } from "./signup-payment-panel";

type OnboardingStep = 1 | 2 | 3 | 4;

type OnboardingData = {
  documentNumber: string;
  companyName: string;
  brokersCount: string;
  adminName: string;
  phoneCountryCode: string;
  phone: string;
  email: string;
  password: string;
  signupPath: "trial" | "paid";
  planSlug: string;
};

type CountryCodeOption = {
  label: string;
  maxDigits: number;
  placeholder: string;
  value: string;
};

type SignupResponse = {
  ok: boolean;
  message: string;
  redirectTo?: string;
  checkoutToken?: string | null;
  organizationId?: string;
};

type CheckoutPlanChangeResponse = {
  ok: boolean;
  message: string;
  requiresPayment?: boolean;
  checkoutToken?: string | null;
  organizationId?: string;
};

type PlanOption = {
  slug: string;
  signupPath: "trial" | "paid";
  name: string;
  price: string;
  description: string;
};

const initialFormData: OnboardingData = {
  documentNumber: "",
  companyName: "",
  brokersCount: "",
  adminName: "",
  phoneCountryCode: "+55",
  phone: "",
  email: "",
  password: "",
  signupPath: "trial",
  planSlug: "",
};

const inputClass =
  "h-12 w-full rounded-[6px] border border-transparent bg-[#121212] px-4 text-sm font-extralight tracking-wide text-white placeholder:text-white/30 outline-none transition-colors focus:border-transparent focus:bg-[#121212]";

const defaultCountryCodeOption: CountryCodeOption = {
  label: "BR +55",
  maxDigits: 11,
  placeholder: "(00) 00000-0000",
  value: "+55",
};

const countryCodeOptions: CountryCodeOption[] = [
  defaultCountryCodeOption,
  { label: "US +1", maxDigits: 10, placeholder: "000 000 0000", value: "+1" },
  { label: "PT +351", maxDigits: 9, placeholder: "000 000 000", value: "+351" },
  { label: "AR +54", maxDigits: 10, placeholder: "00 0000 0000", value: "+54" },
  { label: "CL +56", maxDigits: 9, placeholder: "0 0000 0000", value: "+56" },
  { label: "UY +598", maxDigits: 8, placeholder: "0000 0000", value: "+598" },
  { label: "PY +595", maxDigits: 9, placeholder: "000 000 000", value: "+595" },
];

const planOptions: PlanOption[] = [
  {
    slug: "starter-197",
    signupPath: "trial",
    name: "Starter",
    price: "R$ 197/mes",
    description: "7 dias gratis. CRM, agenda, WhatsApp e Meta.",
  },
  {
    slug: "intermediario-297",
    signupPath: "paid",
    name: "Pro",
    price: "R$ 297/mes",
    description: "Tudo do Starter, com imoveis e site publico.",
  },
  {
    slug: "master-497",
    signupPath: "paid",
    name: "Master",
    price: "R$ 497/mes",
    description: "Tudo do Pro, com automacoes e integracoes com portais.",
  },
];

function onlyDigits(value: string, maxLength = 14) {
  return value.replace(/\D/g, "").slice(0, maxLength);
}

function formatCpfDigits(digits: string) {
  return digits
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1-$2");
}

function formatCnpjDigits(digits: string) {
  return digits
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

function formatCpfCnpj(value: string) {
  const digits = onlyDigits(value);

  if (digits.length <= 11) {
    return formatCpfDigits(digits);
  }

  return formatCnpjDigits(digits);
}

function getCountryCodeOption(value: string) {
  return (
    countryCodeOptions.find((option) => option.value === value) ??
    defaultCountryCodeOption
  );
}

function formatBrazilPhoneDigits(digits: string) {
  if (digits.length <= 2) {
    return digits;
  }

  if (digits.length <= 7) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  }

  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function formatPhoneNumber(value: string, countryCode: string) {
  const countryCodeOption = getCountryCodeOption(countryCode);
  const digits = onlyDigits(value, countryCodeOption.maxDigits);

  if (countryCodeOption.value === "+55") {
    return formatBrazilPhoneDigits(digits);
  }

  return digits;
}

function translateSignupMessage(message?: string) {
  const normalized = (message || "").toLowerCase();

  if (
    normalized.includes("already been registered") ||
    normalized.includes("already registered") ||
    normalized.includes("user already exists")
  ) {
    return "Este e-mail ja esta cadastrado. Faca login ou use outro e-mail.";
  }

  return message || "Não foi possível concluir o cadastro.";
}

function VimobLogo() {
  return (
    <Image
      src="/images/logo-white.png"
      alt="Vimob"
      width={1228}
      height={429}
      preload
      className="mx-auto"
      style={{ width: "148px", height: "auto" }}
    />
  );
}

function EnvelopeIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="0.75"
      className="text-white/40"
      aria-hidden="true"
    >
      <rect x="1.5" y="3.5" width="13" height="9" />
      <path d="M1.5 4.5L8 9.5L14.5 4.5" />
    </svg>
  );
}

function EyeIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.35"
        aria-hidden="true"
      >
        <path d="M1.5 8C1.5 8 3.5 3.5 8 3.5C12.5 3.5 14.5 8 14.5 8C14.5 8 12.5 12.5 8 12.5C3.5 12.5 1.5 8 1.5 8Z" />
        <circle cx="8" cy="8" r="2" />
      </svg>
    );
  }

  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      aria-hidden="true"
    >
      <path d="M2 2L14 14" />
      <path d="M6.5 6.5C6 7 5.75 7.5 5.75 8C5.75 9.25 6.75 10.25 8 10.25C8.5 10.25 9 10 9.5 9.5" />
      <path d="M1.5 8C1.5 8 3.5 3.5 8 3.5C9.25 3.5 10.35 3.85 11.25 4.4M14.5 8C14.5 8 12.5 12.5 8 12.5C7.15 12.5 6.35 12.3 5.65 11.95" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 22 22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d="M4.5 11.5L8.75 15.75L17.5 6.25" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 13 13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden="true"
    >
      <path d="M3.25 5L6.5 8.25L9.75 5" />
    </svg>
  );
}

function StepIndicator({ step }: { step: OnboardingStep }) {
  const steps = [1, 2, 3] as const;
  const currentStep = Math.min(step, 3);

  return (
    <div className="mb-5" aria-label={`Etapa ${currentStep} de 3`}>
      <div className="grid grid-cols-3 gap-2">
        {steps.map((item) => (
          <span
            key={item}
            className={item <= currentStep ? "h-px bg-[#FF4529]" : "h-px bg-white/10"}
            aria-hidden="true"
          />
        ))}
      </div>
    </div>
  );
}

function LegalConsentText({
  checked,
  onCheckedChange,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="mx-auto flex max-w-[340px] items-start gap-3 text-left">
      <input
        id="legal-consent"
        type="checkbox"
        checked={checked}
        onChange={(event) => onCheckedChange(event.target.checked)}
        className="mt-1 h-4 w-4 shrink-0 accent-[#FF4529]"
      />
      <label
        htmlFor="legal-consent"
        className="text-[11px] font-light leading-5 tracking-wide text-white/45"
      >
      Ao me cadastrar, eu aceito os{" "}
      <Link
        href="/termos-de-uso"
        className="font-semibold text-white/70 outline-none transition-colors hover:text-[#FF4529] focus-visible:text-[#FF4529]"
      >
        Termos de Uso
      </Link>{" "}
      e{" "}
      <Link
        href="/politica-de-privacidade"
        className="font-semibold text-white/70 outline-none transition-colors hover:text-[#FF4529] focus-visible:text-[#FF4529]"
      >
        Política de Privacidade
      </Link>{" "}
      da Vimob
      </label>
    </div>
  );
}

export function OnboardingForm() {
  const router = useRouter();
  const { signIn, switchOrganization } = useAuth();
  const [step, setStep] = useState<OnboardingStep>(1);
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState<OnboardingData>(initialFormData);
  const [acceptedLegal, setAcceptedLegal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [checkoutToken, setCheckoutToken] = useState<string | null>(null);
  const [createdOrganizationId, setCreatedOrganizationId] = useState<string | null>(null);
  const [isChangingCheckoutPlan, setIsChangingCheckoutPlan] = useState(false);
  const [isUpdatingCheckoutPlan, setIsUpdatingCheckoutPlan] = useState(false);
  const selectedPlan = planOptions.find((plan) => plan.slug === formData.planSlug);
  const shouldShowPaymentPanel = step === 3 && !!selectedPlan;
  const isCheckoutPlanLocked = Boolean(checkoutToken) && !isChangingCheckoutPlan;
  const passwordRules = [
    {
      label: "8 caracteres",
      isValid: formData.password.length >= 8,
    },
    {
      label: "Maiúscula",
      isValid: /[A-Z]/.test(formData.password),
    },
    {
      label: "Especial",
      isValid: /[^A-Za-z0-9]/.test(formData.password),
    },
  ];
  const isPasswordStrong = passwordRules.every((rule) => rule.isValid);
  const selectedCountryCodeOption = getCountryCodeOption(
    formData.phoneCountryCode,
  );
  const phoneDigits = onlyDigits(
    formData.phone,
    selectedCountryCodeOption.maxDigits,
  );
  const isPhoneNumberValid =
    phoneDigits.length === selectedCountryCodeOption.maxDigits;
  const hasRequiredAccessFields =
    formData.adminName.trim().length > 0 &&
    isPhoneNumberValid &&
    formData.email.trim().length > 0;
  const canContinueAccess =
    hasRequiredAccessFields && isPasswordStrong && acceptedLegal && !isSubmitting;
  const canSubmitPlan =
    !!selectedPlan && !isSubmitting && !isUpdatingCheckoutPlan && !checkoutToken;

  const handleAccessPlatform = useCallback(
    async (organizationId?: string | null) => {
      const targetOrganizationId = organizationId || createdOrganizationId;

      if (targetOrganizationId) {
        await switchOrganization(targetOrganizationId);
      }

      router.replace("/dashboard");
    },
    [createdOrganizationId, router, switchOrganization],
  );

  function updateField(field: keyof OnboardingData, value: string) {
    setFormData((current) => ({ ...current, [field]: value }));
  }

  function updatePhoneCountryCode(countryCode: string) {
    setFormData((current) => ({
      ...current,
      phone: formatPhoneNumber(current.phone, countryCode),
      phoneCountryCode: countryCode,
    }));
  }

  function requestCheckoutPlanChange() {
    setSubmitError(null);
    setIsChangingCheckoutPlan(true);
  }

  async function selectPlan(plan: PlanOption) {
    setSubmitError(null);

    if (!checkoutToken) {
      setFormData((current) => ({
        ...current,
        signupPath: plan.signupPath,
        planSlug: plan.slug,
      }));
      return;
    }

    if (!isChangingCheckoutPlan || isUpdatingCheckoutPlan) {
      return;
    }

    if (plan.slug === formData.planSlug) {
      setIsChangingCheckoutPlan(false);
      return;
    }

    setIsUpdatingCheckoutPlan(true);

    try {
      const response = await fetch("/api/onboarding/checkout-plan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          checkoutToken,
          planSlug: plan.slug,
        }),
      });
      const result = (await response.json()) as CheckoutPlanChangeResponse;

      if (!response.ok || !result.ok) {
        setSubmitError(result.message || "Não foi possível atualizar o plano.");
        return;
      }

      setFormData((current) => ({
        ...current,
        signupPath: plan.signupPath,
        planSlug: plan.slug,
      }));
      setCheckoutToken(result.checkoutToken || checkoutToken);

      if (result.organizationId) {
        setCreatedOrganizationId(result.organizationId);
      }

      setIsChangingCheckoutPlan(false);

      if (!result.requiresPayment) {
        await handleAccessPlatform(result.organizationId);
      }
    } catch {
      setSubmitError("Não foi possível atualizar o plano agora.");
    } finally {
      setIsUpdatingCheckoutPlan(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);

    if (step === 1) {
      setStep(2);
      return;
    }

    if (step === 2) {
      if (canContinueAccess) {
        setStep(3);
      }

      return;
    }

    if (step === 3 && canSubmitPlan) {
      setIsSubmitting(true);

      try {
        const response = await fetch("/api/onboarding/signup", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            companyName: formData.companyName,
            documentNumber: formData.documentNumber,
            brokersCount: formData.brokersCount,
            adminName: formData.adminName,
            phoneCountryCode: formData.phoneCountryCode,
            phone: formData.phone,
            email: formData.email,
            password: formData.password,
            signupPath: formData.signupPath,
            planSlug: formData.planSlug,
            termsAccepted: acceptedLegal,
            privacyAccepted: acceptedLegal,
          }),
        });
        const result = (await response.json()) as SignupResponse;

        if (!response.ok || !result.ok) {
          setSubmitError(translateSignupMessage(result.message));
          return;
        }

        const { error } = await signIn(formData.email.trim(), formData.password);

        if (error) {
          setStep(4);
          return;
        }

        if (selectedPlan?.signupPath === "paid") {
          const tokenFromRedirect = result.redirectTo?.startsWith("/checkout/")
            ? result.redirectTo.replace("/checkout/", "")
            : null;

          setCheckoutToken(result.checkoutToken || tokenFromRedirect);
          setCreatedOrganizationId(result.organizationId || null);
          return;
        }

        router.replace(result.redirectTo || "/select-organization");
      } catch {
        setSubmitError("Não foi possível concluir o cadastro agora.");
      } finally {
        setIsSubmitting(false);
      }
    }
  }

  return (
    <div className="relative w-full max-w-sm">
      <header className="mb-5 text-center">
        <VimobLogo />
        <p className="mt-4 text-sm font-extralight tracking-wide text-white/50">
          {step === 4
            ? "Estamos preparando seu ambiente"
            : "Crie a infraestrutura da sua organização"}
        </p>
      </header>

      <StepIndicator step={step} />

      {step === 4 ? (
        <div className="space-y-6 py-4 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-none border border-[#FF4529] text-[#FF4529]">
            <CheckIcon />
          </div>
          <div className="space-y-2">
            <h1 className="text-sm font-extralight uppercase tracking-[0.2em] text-white">
              Cadastro recebido
            </h1>
            <p className="text-sm font-extralight leading-6 tracking-wide text-white/56">
              O ambiente da{" "}
              <span className="text-white">
                {formData.companyName || "sua organização"}
              </span>{" "}
              está pronto para ser conectado ao backend.
            </p>
          </div>
          <Link
            href="/login"
            className="inline-flex h-12 w-full items-center justify-center rounded-[6px] bg-[#FF4529] text-[12px] font-extralight uppercase tracking-[0.08em] text-white outline-none transition-opacity hover:opacity-90 focus-visible:opacity-90"
          >
            Ir para login
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {step === 1 ? (
            <>
              <div className="space-y-2">
                <label
                  htmlFor="documentNumber"
                  className="block text-sm font-extralight tracking-wide text-white"
                >
                  CPF/CNPJ
                </label>
                <input
                  id="documentNumber"
                  name="documentNumber"
                  type="text"
                  inputMode="numeric"
                  maxLength={18}
                  pattern="(\d{3}\.\d{3}\.\d{3}-\d{2}|\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2})"
                  required
                  title="Informe um CPF com 11 números ou CNPJ com 14 números."
                  placeholder="CPF ou CNPJ"
                  value={formData.documentNumber}
                  onChange={(event) =>
                    updateField(
                      "documentNumber",
                      formatCpfCnpj(event.target.value),
                    )
                  }
                  className={inputClass}
                />
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="companyName"
                  className="block text-sm font-extralight tracking-wide text-white"
                >
                  Nome da imobiliária
                </label>
                <input
                  id="companyName"
                  name="companyName"
                  type="text"
                  required
                  placeholder="Ex: Machado Imóveis"
                  value={formData.companyName}
                  onChange={(event) =>
                    updateField("companyName", event.target.value)
                  }
                  className={inputClass}
                />
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="brokersCount"
                  className="block text-sm font-extralight tracking-wide text-white"
                >
                  Quantidade de corretores
                </label>
                <input
                  id="brokersCount"
                  name="brokersCount"
                  type="number"
                  min="1"
                  required
                  placeholder="Ex: 25"
                  value={formData.brokersCount}
                  onChange={(event) =>
                    updateField("brokersCount", event.target.value)
                  }
                  className={inputClass}
                />
              </div>

              <button
                type="submit"
                className="h-12 w-full rounded-[6px] bg-[#FF4529] text-[12px] font-extralight uppercase tracking-[0.08em] text-white outline-none transition-opacity hover:opacity-90 focus-visible:opacity-90"
              >
                Continuar
              </button>
            </>
          ) : step === 2 ? (
            <>
              <div className="space-y-2">
                <label
                  htmlFor="adminName"
                  className="block text-sm font-extralight tracking-wide text-white"
                >
                  Nome completo do gestor
                </label>
                <input
                  id="adminName"
                  name="adminName"
                  type="text"
                  required
                  placeholder="Nome do gestor administrador"
                  value={formData.adminName}
                  onChange={(event) =>
                    updateField("adminName", event.target.value)
                  }
                  className={inputClass}
                />
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="phone"
                  className="block text-sm font-extralight tracking-wide text-white"
                >
                  WhatsApp
                </label>
                <div className="flex h-12 overflow-hidden rounded-[6px] bg-[#121212]">
                  <div className="relative w-[112px] shrink-0 border-r border-white/10">
                    <select
                      name="phoneCountryCode"
                      value={formData.phoneCountryCode}
                      onChange={(event) =>
                        updatePhoneCountryCode(event.target.value)
                      }
                      aria-label="Código do país"
                      className="h-12 w-full appearance-none bg-[#121212] pl-4 pr-8 text-sm font-extralight tracking-wide text-white outline-none"
                    >
                      {countryCodeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-white/45">
                      <ChevronDownIcon />
                    </span>
                  </div>
                  <input
                    id="phone"
                    name="phone"
                    type="tel"
                    inputMode="numeric"
                    maxLength={
                      selectedCountryCodeOption.value === "+55"
                        ? 15
                        : selectedCountryCodeOption.maxDigits
                    }
                    required
                    placeholder={selectedCountryCodeOption.placeholder}
                    value={formData.phone}
                    onChange={(event) =>
                      updateField(
                        "phone",
                        formatPhoneNumber(
                          event.target.value,
                          formData.phoneCountryCode,
                        ),
                      )
                    }
                    className="h-12 min-w-0 flex-1 bg-[#121212] px-4 text-sm font-extralight tracking-wide text-white placeholder:text-white/30 outline-none transition-colors focus:bg-[#121212]"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="email"
                  className="block text-sm font-extralight tracking-wide text-white"
                >
                  E-mail de acesso
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                    <EnvelopeIcon />
                  </span>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    placeholder="seu@email.com"
                    value={formData.email}
                    onChange={(event) =>
                      updateField("email", event.target.value)
                    }
                    className={`${inputClass} pl-11`}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="password"
                  className="block text-sm font-extralight tracking-wide text-white"
                >
                  Crie sua senha
                </label>
                <div className="relative">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    minLength={8}
                    placeholder="Mínimo 8 caracteres"
                    value={formData.password}
                    onChange={(event) =>
                      updateField("password", event.target.value)
                    }
                    className={`${inputClass} pr-12`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((current) => !current)}
                    className="absolute inset-y-0 right-0 flex items-center px-4 text-white/65 outline-none transition-colors hover:text-white/90 focus-visible:text-white"
                    aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  >
                    <EyeIcon open={showPassword} />
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-[11px] font-extralight tracking-wide">
                  {passwordRules.map((rule) => (
                    <span
                      key={rule.label}
                      className={`inline-flex items-center gap-1 whitespace-nowrap ${
                        rule.isValid ? "text-[#FF4529]" : "text-white/38"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          rule.isValid ? "bg-[#FF4529]" : "bg-white/24"
                        }`}
                        aria-hidden="true"
                      />
                      {rule.label}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  disabled={isSubmitting}
                  className="h-12 w-[36%] rounded-[6px] border border-white/10 text-[12px] font-extralight uppercase tracking-[0.08em] text-white/70 outline-none transition-colors hover:bg-white/5 focus-visible:border-[#FF4529]"
                >
                  Voltar
                </button>
                <button
                  type="submit"
                  disabled={!canContinueAccess}
                  className="h-12 flex-1 rounded-[6px] bg-[#FF4529] text-[12px] font-extralight uppercase tracking-[0.08em] text-white outline-none transition-opacity hover:opacity-90 focus-visible:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  Continuar
                </button>
              </div>

              {submitError ? (
                <p className="text-center text-xs font-light leading-5 text-[#FF4529]">
                  {submitError}
                </p>
              ) : null}

              <LegalConsentText
                checked={acceptedLegal}
                onCheckedChange={setAcceptedLegal}
              />
            </>
          ) : (
            <>
              <div className="space-y-2">
                <p className="block text-sm font-extralight tracking-wide text-white">
                  Escolha seu plano
                </p>
                <div className="grid gap-2">
                  {planOptions.map((plan) => {
                    const isSelected = formData.planSlug === plan.slug;
                    const isPlanDisabled =
                      isCheckoutPlanLocked || isUpdatingCheckoutPlan;

                    return (
                      <button
                        key={plan.slug}
                        type="button"
                        onClick={() => void selectPlan(plan)}
                        disabled={isPlanDisabled}
                        aria-pressed={isSelected}
                        className={`min-h-[74px] rounded-[6px] px-4 py-3 text-left outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${
                          isSelected
                            ? "bg-[#FF4529]/15"
                            : "bg-[#121212] hover:bg-[#171717]"
                        }`}
                      >
                        <span className="flex items-center justify-between gap-3">
                          <span className="text-sm font-light tracking-wide text-white">
                            {plan.name}
                          </span>
                          <span className="shrink-0 text-xs font-light uppercase tracking-[0.08em] text-[#FF4529]">
                            {plan.price}
                          </span>
                        </span>
                        <span className="mt-1 block text-xs font-extralight leading-5 tracking-wide text-white/45">
                          {plan.description}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {checkoutToken ? (
                  <p
                    className={`text-[11px] font-extralight leading-5 tracking-wide ${
                      isChangingCheckoutPlan ? "text-[#FF4529]" : "text-white/38"
                    }`}
                  >
                    {isChangingCheckoutPlan
                      ? "Escolha outro plano para atualizar este checkout."
                      : "Plano travado para a cobranca atual. Cancele a cobranca na coluna de pagamento para trocar."}
                  </p>
                ) : null}
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  disabled={isSubmitting || !!checkoutToken}
                  className="h-12 w-[36%] rounded-[6px] border border-white/10 text-[12px] font-extralight uppercase tracking-[0.08em] text-white/70 outline-none transition-colors hover:bg-white/5 focus-visible:border-[#FF4529] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  Voltar
                </button>
                <button
                  type="submit"
                  disabled={!canSubmitPlan}
                  className="h-12 flex-1 rounded-[6px] bg-[#FF4529] text-[12px] font-extralight uppercase tracking-[0.08em] text-white outline-none transition-opacity hover:opacity-90 focus-visible:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {isUpdatingCheckoutPlan
                    ? "Atualizando plano"
                    : checkoutToken
                    ? "Ambiente criado"
                    : isSubmitting
                      ? "Criando ambiente"
                      : selectedPlan?.signupPath === "paid"
                        ? "Criar e pagar"
                        : selectedPlan
                          ? "Iniciar teste gratis"
                          : "Escolha um plano"}
                </button>
              </div>

              {submitError ? (
                <p className="text-center text-xs font-light leading-5 text-[#FF4529]">
                  {submitError}
                </p>
              ) : null}
            </>
          )}
        </form>
      )}

      {step < 4 && (
        <footer className="mt-5 text-center text-sm font-extralight tracking-wide">
          <span className="text-white/30">Já tem uma organização? </span>
          <Link
            href="/login"
            className="text-[#FF4529] outline-none transition-opacity hover:opacity-80"
          >
            Fazer login
          </Link>
        </footer>
      )}

      {shouldShowPaymentPanel ? (
        <div className="mt-5 w-full lg:fixed lg:left-[50%] lg:top-1/2 lg:z-20 lg:mt-0 lg:w-[min(42vw,520px)] lg:max-h-[calc(100dvh-6rem)] lg:-translate-y-1/2 lg:overflow-y-auto lg:pr-1 xl:left-[49%]">
          <SignupPaymentPanel
            step={step}
            selectedPlan={selectedPlan}
            checkoutToken={checkoutToken}
            companyName={formData.companyName}
            adminName={formData.adminName}
            email={formData.email}
            documentNumber={formData.documentNumber}
            phoneCountryCode={formData.phoneCountryCode}
            phone={formData.phone}
            onAccessPlatform={handleAccessPlatform}
            isPlanChangeMode={isChangingCheckoutPlan}
            onRequestPlanChange={requestCheckoutPlanChange}
          />
        </div>
      ) : null}
    </div>
  );
}
