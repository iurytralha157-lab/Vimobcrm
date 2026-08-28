"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { VimobLoader } from "@/components/shared/loading";
import { saveCheckoutBillingProfileSession } from "@/lib/billing/checkout-profile-session";
import {
  applyPublicSignupEmailCorrection,
  clearPublicSignupAttempt,
  getOrCreatePublicSignupAttemptId,
  persistPublicSignupCompletion,
  readPublicSignupCompletion,
} from "@/lib/onboarding/signup-attempt";
import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
  onboardingAccessStepSchema,
  onboardingOrganizationStepSchema,
  onboardingSignupResponseSchema,
  onboardingStepValidationResponseSchema,
  type ParsedOnboardingSignupResponse,
  type ParsedOnboardingStepValidationResponse,
} from "@/lib/validation/onboarding";
import {
  PlanCarousel,
  type OnboardingPlanOption as PlanOption,
} from "./PlanCarousel";
import { SignupRecoveryActions } from "./SignupRecoveryActions";

const SignupPaymentPanel = dynamic(
  () => import("./signup-payment-panel").then((module) => module.SignupPaymentPanel),
  {
    loading: () => (
      <div className="flex min-h-32 items-center justify-center">
        <VimobLoader size="sm" label="Carregando pagamento..." />
      </div>
    ),
  },
);

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

type SignupResponse = ParsedOnboardingSignupResponse;

type CheckoutPlanChangeResponse = {
  ok: boolean;
  message: string;
  requiresPayment?: boolean;
  checkoutToken?: string | null;
  organizationId?: string;
};

type PublicPlan = {
  id?: string;
  slug?: string;
  name?: string;
  price?: number;
  reference_price?: number | null;
  discount_percentage?: number | null;
  display_order?: number | null;
  billing_periods?: number[] | null;
  billing_cycle?: string | null;
  description?: string | null;
  trial_enabled?: boolean | null;
  trial_days?: number | null;
  max_users?: number | null;
  max_whatsapp_sessions?: number | null;
  modules?: string[] | null;
  display_features?: string[] | null;
};

type PublicPlansResponse = {
  data?: PublicPlan[];
  error?: string;
};

type PlansLoadState = "idle" | "loading" | "ready" | "empty" | "error";

type SignupFieldErrorKey =
  | "documentNumber"
  | "companyName"
  | "brokersCount"
  | "adminName"
  | "phone"
  | "email"
  | "password"
  | "legal";

type SignupFieldErrors = Partial<Record<SignupFieldErrorKey, string>>;

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
  "auth-login-field h-12 w-full rounded-[6px] border-0 bg-[var(--app-surface-solid)] px-4 text-base text-[var(--app-text-primary)] placeholder:text-[var(--app-text-secondary)] outline-none ring-0 transition-colors sm:text-sm focus:bg-[var(--app-surface-solid)] focus:ring-1 focus:ring-primary/40";

const labelClass =
  "block text-[13px] font-light text-[var(--app-text-primary)]";

const secondaryActionClass =
  "h-12 w-[36%] rounded-[6px] border-0 bg-[var(--app-surface-solid)] text-[12px] font-light text-[var(--app-text-secondary)] outline-none transition-colors hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)] focus-visible:ring-1 focus-visible:ring-primary/40";

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

function normalizePlanName(name: string) {
  return name.replace(/^Vimob\s+/i, "").trim() || name;
}

function formatBillingCycle(cycle?: string | null) {
  const normalized = String(cycle || "").toLowerCase();
  if (normalized === "monthly" || normalized === "mensal" || normalized === "month") return "/mes";
  if (normalized === "yearly" || normalized === "annual" || normalized === "anual" || normalized === "year") return "/ano";
  return "";
}

function formatPlanPrice(price?: number, cycle?: string | null) {
  if (typeof price !== "number" || !Number.isFinite(price)) return "Sob consulta";
  const formatted = price.toLocaleString("pt-BR", {
    currency: "BRL",
    maximumFractionDigits: 0,
    style: "currency",
  });
  return `${formatted}${formatBillingCycle(cycle)}`;
}

function normalizePlanFeatures(features?: string[] | null) {
  if (!Array.isArray(features)) return [];

  return Array.from(
    new Set(
      features
        .filter((feature): feature is string => typeof feature === "string")
        .map((feature) => feature.trim())
        .filter(Boolean),
    ),
  );
}

function normalizePositiveNumber(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function normalizeDisplayOrder(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function comparePlansByDisplayOrder(first: PlanOption, second: PlanOption) {
  if (first.displayOrder === null || first.displayOrder === undefined) {
    return second.displayOrder === null || second.displayOrder === undefined ? 0 : 1;
  }

  if (second.displayOrder === null || second.displayOrder === undefined) return -1;
  return first.displayOrder - second.displayOrder;
}

function mapPublicPlan(plan: PublicPlan): PlanOption | null {
  const slug = plan.slug?.trim();
  const name = plan.name?.trim();

  if (!slug || !name) return null;

  const trialDays = plan.trial_days ?? null;
  const isTrial = Boolean(plan.trial_enabled) && Number(trialDays || 0) > 0;
  const modules = Array.isArray(plan.modules) ? plan.modules.filter(Boolean) : [];

  return {
    id: plan.id,
    slug,
    signupPath: isTrial ? "trial" : "paid",
    name: normalizePlanName(name),
    price: formatPlanPrice(plan.price, plan.billing_cycle),
    originalPrice: normalizePositiveNumber(plan.reference_price),
    discount: normalizePositiveNumber(plan.discount_percentage),
    displayOrder: normalizeDisplayOrder(plan.display_order),
    description: plan.description?.trim() || "",
    billingCycle: plan.billing_cycle ?? null,
    trialEnabled: Boolean(plan.trial_enabled),
    trialDays,
    maxUsers: plan.max_users ?? null,
    maxWhatsappSessions: plan.max_whatsapp_sessions ?? null,
    modules,
    features: normalizePlanFeatures(plan.display_features),
  };
}

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

function translateSignupMessage(message?: string, code?: string) {
  if (code === "signup_email_exists") {
    return "Este e-mail já está cadastrado. Faça login ou use outro e-mail.";
  }
  if (code === "signup_document_exists") {
    return "Já existe uma organização cadastrada com este CPF ou CNPJ.";
  }
  if (code === "signup_attempt_conflict") {
    return "Esta tentativa pertence a outro e-mail. Reinicie o cadastro em uma nova aba.";
  }
  if (code === "signup_rate_limited") {
    return "Muitas tentativas. Aguarde um pouco antes de tentar novamente.";
  }

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

function collectStepFieldErrors(
  issues: readonly { message: string; path: readonly PropertyKey[] }[],
): SignupFieldErrors {
  const errors: SignupFieldErrors = {};
  const allowedFields = new Set<SignupFieldErrorKey>([
    "documentNumber",
    "companyName",
    "brokersCount",
    "adminName",
    "phone",
    "email",
    "password",
    "legal",
  ]);

  for (const issue of issues) {
    const rawField = issue.path[0] === "legalAccepted" ? "legal" : issue.path[0];
    if (typeof rawField !== "string" || !allowedFields.has(rawField as SignupFieldErrorKey)) continue;
    const field = rawField as SignupFieldErrorKey;
    if (!errors[field]) errors[field] = issue.message;
  }

  return errors;
}

function InlineFieldError({ field, message }: { field: SignupFieldErrorKey; message?: string }) {
  if (!message) return null;
  return (
    <p id={field + "-error"} className="text-[12px] font-light leading-[15px] text-primary">
      {message}
    </p>
  );
}

async function requestStepValidation(body: unknown): Promise<{
  response: Response;
  result: ParsedOnboardingStepValidationResponse;
}> {
  const response = await fetch("/api/onboarding/validate-step", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const parsed = onboardingStepValidationResponseSchema.safeParse(
    await response.json().catch(() => null),
  );

  if (!parsed.success) {
    throw new Error("O servidor devolveu uma resposta de validação inválida.");
  }

  return { response, result: parsed.data };
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
      className="text-[var(--app-text-tertiary)]"
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

function StepIndicator({
  step,
  compact = false,
}: {
  step: OnboardingStep;
  compact?: boolean;
}) {
  const steps = [1, 2, 3] as const;
  const currentStep = Math.min(step, 3);

  return (
    <div
      className={compact ? "mb-2" : "mb-5"}
      role="progressbar"
      aria-label="Progresso do cadastro"
      aria-valuemin={1}
      aria-valuemax={3}
      aria-valuenow={currentStep}
      aria-valuetext={`Etapa ${currentStep} de 3`}
    >
      <div className="grid grid-cols-3 gap-2">
        {steps.map((item) => (
          <span
            key={item}
            className={item <= currentStep ? "h-px bg-primary" : "h-px bg-[var(--app-border)]"}
            aria-hidden="true"
          />
        ))}
      </div>
    </div>
  );
}

function LegalConsentText({
  checked,
  disabled,
  invalid,
  onCheckedChange,
}: {
  checked: boolean;
  disabled?: boolean;
  invalid?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="auth-signup-legal mx-auto flex max-w-[360px] items-start gap-3 text-left">
      <span className="relative mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
        <input
          id="legal-consent"
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? "legal-error" : undefined}
          onChange={(event) => onCheckedChange(event.target.checked)}
          className="peer absolute inset-0 z-10 h-4 w-4 cursor-pointer opacity-0 disabled:cursor-not-allowed"
        />
        <span
          className={
            invalid
              ? "h-4 w-4 rounded-[4px] border border-primary transition-colors peer-checked:border-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary/30"
              : "h-4 w-4 rounded-[4px] border border-[var(--app-border-strong)] transition-colors peer-checked:border-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary/30"
          }
        />
        <span className="pointer-events-none absolute hidden h-2 w-2 rounded-[2px] bg-primary peer-checked:block" />
      </span>
      <label
        htmlFor="legal-consent"
        className="text-[11px] leading-[17px] text-[var(--app-text-tertiary)]"
      >
      Ao me cadastrar, eu aceito os{" "}
      <Link
        href="/termos-de-uso"
        target="_blank"
        rel="noopener noreferrer"
        prefetch={false}
        className="text-primary outline-none transition-opacity hover:opacity-80"
      >
        Termos de Uso
      </Link>{' '}

      e{" "}
      <Link
        href="/politica-de-privacidade"
        target="_blank"
        rel="noopener noreferrer"
        prefetch={false}
        className="text-primary outline-none transition-opacity hover:opacity-80"
      >
        Política de Privacidade
      </Link>{' '}

      da Vimob CRM.
      </label>
    </div>
  );
}

export function OnboardingForm() {
  const router = useRouter();
  const [step, setStep] = useState<OnboardingStep>(1);
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState<OnboardingData>(initialFormData);
  const [acceptedLegal, setAcceptedLegal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isValidatingStep, setIsValidatingStep] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<SignupFieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const stepValidationInFlight = useRef(false);
  const [checkoutToken, setCheckoutToken] = useState<string | null>(null);
  const [recoveryCapability, setRecoveryCapability] = useState<string | null>(null);
  const [isChangingCheckoutPlan, setIsChangingCheckoutPlan] = useState(false);
  const [isUpdatingCheckoutPlan, setIsUpdatingCheckoutPlan] = useState(false);
  const [planOptions, setPlanOptions] = useState<PlanOption[]>([]);
  const [plansLoadState, setPlansLoadState] = useState<PlansLoadState>("idle");
  const [plansLoadError, setPlansLoadError] = useState<string | null>(null);
  const [plansRequestVersion, setPlansRequestVersion] = useState(0);
  const selectedPlan = planOptions.find((plan) => plan.slug === formData.planSlug);
  const shouldShowPaymentPanel = step === 3 && !!selectedPlan && !!checkoutToken;
  const isCheckoutPlanLocked = Boolean(checkoutToken) && !isChangingCheckoutPlan;
  const shouldLoadPlans = step >= 2;
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
  const selectedCountryCodeOption = getCountryCodeOption(
    formData.phoneCountryCode,
  );
  const canSubmitPlan =
    !!selectedPlan && !isSubmitting && !isUpdatingCheckoutPlan && !checkoutToken;

  useEffect(() => {
    const hydrationFrame = window.requestAnimationFrame(() => {
      try {
        const completedSignup = readPublicSignupCompletion(window.sessionStorage);
        if (!completedSignup) return;

        setCheckoutToken(completedSignup.checkoutToken);
        setRecoveryCapability(completedSignup.recoveryCapability || null);
        setFormData((current) => ({ ...current, email: completedSignup.email }));
        if (completedSignup.requiresPayment) {
          router.replace(completedSignup.redirectTo);
          return;
        }

        setStep(4);
      } catch {
        // Browsers may disable sessionStorage. A live submission still reports
        // this before mutating the backend when it tries to create the attempt.
      }
    });

    return () => window.cancelAnimationFrame(hydrationFrame);
  }, [router]);

  useEffect(() => {
    if (!shouldLoadPlans) return;

    let isMounted = true;

    async function loadPlans() {
      setPlansLoadState("loading");
      setPlansLoadError(null);

      try {
        const response = await fetch("/api/onboarding/plans", {
          headers: { Accept: "application/json" },
        });
        const payload = (await response.json().catch(() => ({}))) as PublicPlansResponse;

        if (!response.ok || !Array.isArray(payload.data)) {
          throw new Error(payload.error || "Não foi possível carregar os planos agora.");
        }

        const nextPlans = payload.data
          .map(mapPublicPlan)
          .filter((plan): plan is PlanOption => Boolean(plan))
          .sort(comparePlansByDisplayOrder);

        if (!isMounted) return;

        setPlanOptions(nextPlans);
        setPlansLoadState(nextPlans.length > 0 ? "ready" : "empty");
      } catch (error) {
        if (!isMounted) return;

        setPlanOptions([]);
        setPlansLoadState("error");
        setPlansLoadError(
          error instanceof Error
            ? error.message
            : "Não foi possível carregar os planos agora.",
        );
      }
    }

    void loadPlans();

    return () => {
      isMounted = false;
    };
  }, [plansRequestVersion, shouldLoadPlans]);

  useEffect(() => {
    if (step !== 2) return;
    void import("./signup-payment-panel");
  }, [step]);

  const handleAccessPlatform = useCallback(
    () => {
      router.replace("/login?emailConfirmation=required");
    },
    [router],
  );

  function clearFieldError(field: SignupFieldErrorKey) {
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function updateField(field: keyof OnboardingData, value: string) {
    setFormData((current) => ({ ...current, [field]: value }));
    if (
      field === "documentNumber" ||
      field === "companyName" ||
      field === "brokersCount" ||
      field === "adminName" ||
      field === "phone" ||
      field === "email" ||
      field === "password"
    ) {
      clearFieldError(field);
    }
    setSubmitError(null);
  }

  function updatePhoneCountryCode(countryCode: string) {
    setFormData((current) => ({
      ...current,
      phone: formatPhoneNumber(current.phone, countryCode),
      phoneCountryCode: countryCode,
    }));
    clearFieldError("phone");
    setSubmitError(null);
  }

  function showFieldErrors(
    errors: SignupFieldErrors,
    order: readonly SignupFieldErrorKey[],
  ) {
    setFieldErrors(errors);
    const firstField = order.find((field) => Boolean(errors[field]));
    if (!firstField) return;
    const elementId = firstField === "legal" ? "legal-consent" : firstField;
    window.requestAnimationFrame(() => document.getElementById(elementId)?.focus());
  }

  function fieldInputClass(field: SignupFieldErrorKey, extra = "") {
    return [inputClass, extra, fieldErrors[field] ? "ring-1 ring-primary/50" : ""]
      .filter(Boolean)
      .join(" ");
  }

  function fieldDescription(field: SignupFieldErrorKey) {
    return fieldErrors[field] ? field + "-error" : undefined;
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

      setIsChangingCheckoutPlan(false);

      if (!result.requiresPayment) {
        handleAccessPlatform();
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
      const parsedStep = onboardingOrganizationStepSchema.safeParse({
        companyName: formData.companyName,
        documentNumber: formData.documentNumber,
        brokersCount: formData.brokersCount,
      });
      if (!parsedStep.success) {
        showFieldErrors(collectStepFieldErrors(parsedStep.error.issues), [
          "documentNumber",
          "companyName",
          "brokersCount",
        ]);
        return;
      }
      if (stepValidationInFlight.current) return;

      stepValidationInFlight.current = true;
      setIsValidatingStep(true);
      setFieldErrors({});

      try {
        const { response, result } = await requestStepValidation({
          step: "organization",
          companyName: parsedStep.data.companyName,
          documentNumber: parsedStep.data.documentNumber,
        });

        if (!response.ok || !result.ok) {
          if (!result.ok && result.code === "signup_document_exists") {
            showFieldErrors(
              { documentNumber: translateSignupMessage(result.message, result.code) },
              ["documentNumber"],
            );
          } else {
            setSubmitError(
              !result.ok
                ? translateSignupMessage(result.message, result.code)
                : "Não foi possível validar os dados agora. Tente novamente.",
            );
          }
          return;
        }

        setFormData((current) => ({
          ...current,
          companyName: parsedStep.data.companyName,
          documentNumber: formatCpfCnpj(parsedStep.data.documentNumber),
          brokersCount: String(parsedStep.data.brokersCount),
        }));
        setStep(2);
      } catch (error) {
        setSubmitError(
          error instanceof Error
            ? error.message
            : "Não foi possível validar os dados agora. Tente novamente.",
        );
      } finally {
        stepValidationInFlight.current = false;
        setIsValidatingStep(false);
      }
      return;
    }

    if (step === 2) {
      const parsedStep = onboardingAccessStepSchema.safeParse({
        adminName: formData.adminName,
        phoneCountryCode: formData.phoneCountryCode,
        phone: formData.phone,
        email: formData.email,
        password: formData.password,
        legalAccepted: acceptedLegal,
      });
      if (!parsedStep.success) {
        showFieldErrors(collectStepFieldErrors(parsedStep.error.issues), [
          "adminName",
          "phone",
          "email",
          "password",
          "legal",
        ]);
        return;
      }
      if (stepValidationInFlight.current) return;

      stepValidationInFlight.current = true;
      setIsValidatingStep(true);
      setFieldErrors({});

      try {
        const { response, result } = await requestStepValidation({
          step: "access",
          email: parsedStep.data.email,
        });

        if (!response.ok || !result.ok) {
          if (!result.ok && result.code === "signup_email_exists") {
            showFieldErrors(
              { email: translateSignupMessage(result.message, result.code) },
              ["email"],
            );
          } else {
            setSubmitError(
              !result.ok
                ? translateSignupMessage(result.message, result.code)
                : "Não foi possível validar os dados agora. Tente novamente.",
            );
          }
          return;
        }

        setFormData((current) => ({
          ...current,
          adminName: parsedStep.data.adminName,
          phone: parsedStep.data.phone,
          email: parsedStep.data.email,
        }));
        setStep(3);
      } catch (error) {
        setSubmitError(
          error instanceof Error
            ? error.message
            : "Não foi possível validar os dados agora. Tente novamente.",
        );
      } finally {
        stepValidationInFlight.current = false;
        setIsValidatingStep(false);
      }
      return;
    }

    if (step === 3 && canSubmitPlan) {
      setIsSubmitting(true);
      let signupCompleted = false;

      try {
        const attemptId = getOrCreatePublicSignupAttemptId(window.sessionStorage);
        const response = await fetch("/api/onboarding/signup", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            attemptId,
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
            termsVersion: CURRENT_TERMS_VERSION,
            privacyVersion: CURRENT_PRIVACY_VERSION,
          }),
        });
        const parsedResult = onboardingSignupResponseSchema.safeParse(
          await response.json().catch(() => null),
        );

        if (!parsedResult.success) {
          setSubmitError("O servidor devolveu uma resposta de cadastro inválida. Tente novamente.");
          return;
        }

        const result: SignupResponse = parsedResult.data;

        if (!response.ok || !result.ok) {
          if (result.ok) {
            setSubmitError(result.message || "Não foi possível concluir o cadastro.");
            return;
          }
          if (result.code === "signup_document_exists") {
            setStep(1);
            showFieldErrors(
              { documentNumber: translateSignupMessage(result.message, result.code) },
              ["documentNumber"],
            );
            return;
          }
          if (result.code === "signup_email_exists") {
            setStep(2);
            showFieldErrors(
              { email: translateSignupMessage(result.message, result.code) },
              ["email"],
            );
            return;
          }

          setSubmitError(translateSignupMessage(result.message, result.code));
          return;
        }

        signupCompleted = true;
        setCheckoutToken(result.checkoutToken);
        setRecoveryCapability(result.recoveryCapability);
        // The password is no longer needed after the backend confirms the
        // idempotent signup. Remove it from component memory before navigating
        // to checkout or rendering the confirmation state.
        setFormData((current) => ({ ...current, password: "" }));

        try {
          persistPublicSignupCompletion(
            window.sessionStorage,
            attemptId,
            formData.email,
            result,
          );
        } catch {
          // The backend is already authoritative at this point. A browser
          // storage failure must never turn a completed signup into a false
          // "cadastro não concluído" error.
        }

        if (result.requiresPayment) {
          try {
            const documentDigits = onlyDigits(formData.documentNumber);
            saveCheckoutBillingProfileSession(result.organizationId, {
              name:
                documentDigits.length === 14
                  ? formData.companyName.trim()
                  : formData.adminName.trim(),
              email: formData.email.trim(),
              cpf_cnpj: formData.documentNumber.trim(),
              phone: `${formData.phoneCountryCode} ${formData.phone}`.trim(),
            });
          } catch {
            // Checkout can still collect the billing profile again. This
            // session convenience is not part of signup correctness.
          }
          // Checkout remains authorized by its opaque public token. Email
          // ownership is proved separately and never blocks payment.
          router.replace(result.redirectTo);
          return;
        }

        setStep(4);
      } catch {
        if (signupCompleted) {
          setStep(4);
        } else {
          setSubmitError("Não foi possível concluir o cadastro agora.");
        }
      } finally {
        setIsSubmitting(false);
      }
    }
  }

  return (
    <div className="relative w-full max-w-[400px]">
      <header className={`text-left ${step === 3 ? "mb-2" : "mb-8 lg:mb-10"}`}>
        <h1 className="text-[20px] font-normal text-[var(--app-text-primary)]">
          {step === 4 ? "Cadastro concluído" : "Criar conta no Vimob CRM"}
        </h1>
        <p className="mt-1.5 text-[12px] font-light text-[var(--app-text-tertiary)]">
          {step === 4
            ? "Agora confirme seu e-mail"
            : "Crie a infraestrutura da sua organização"}
        </p>
      </header>

      <StepIndicator step={step} compact={step === 3} />

      {step === 4 ? (
        <div className="space-y-6 py-4 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
            <CheckIcon />
          </div>
          <div className="space-y-2">
            <p className="text-[12px] font-light leading-[18px] text-[var(--app-text-secondary)]">
              O ambiente da{" "}
              <span className="text-[var(--app-text-primary)]">
                {formData.companyName || "sua organização"}
              </span>{" "}
              está pronto. Enviamos um e-mail para {formData.email || "o endereço cadastrado"}. Confirme o endereço antes de entrar no Vimob.
            </p>
          </div>
          <Link
            href="/login?emailConfirmation=required"
            className="auth-primary-action inline-flex h-12 w-full items-center justify-center rounded-[6px] text-[12px] font-light outline-none transition-colors"
          >
            Ir para login
          </Link>
          {recoveryCapability && formData.email ? (
            <SignupRecoveryActions
              capability={recoveryCapability}
              currentEmail={formData.email}
              onCorrected={(recoveryResult) => {
                if (recoveryResult.email) {
                  setFormData((current) => ({ ...current, email: recoveryResult.email || current.email }));
                }
                setRecoveryCapability(null);
                try {
                  applyPublicSignupEmailCorrection(window.sessionStorage, recoveryResult);
                } catch {
                  // Backend remains authoritative if browser storage is unavailable.
                }
              }}
              onCancelled={(recoveryResult) => {
                try {
                  clearPublicSignupAttempt(window.sessionStorage);
                } catch {
                  // Navigation below still restarts the local form.
                }
                window.location.assign(recoveryResult.redirectTo);
              }}
            />
          ) : null}
        </div>
      ) : (
        <form method="post" noValidate onSubmit={handleSubmit} aria-busy={isValidatingStep || isSubmitting} className={step === 3 ? "space-y-2" : "space-y-4"}>
          {step === 1 ? (
            <>
              <div className="space-y-2">
                <label
                  htmlFor="documentNumber"
                  className={labelClass}
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
                  disabled={isValidatingStep}
                  aria-invalid={Boolean(fieldErrors.documentNumber) || undefined}
                  aria-describedby={fieldDescription("documentNumber")}
                  title="Informe um CPF com 11 números ou CNPJ com 14 números."
                  placeholder="CPF ou CNPJ"
                  value={formData.documentNumber}
                  onChange={(event) =>
                    updateField(
                      "documentNumber",
                      formatCpfCnpj(event.target.value),
                    )
                  }
                  className={fieldInputClass("documentNumber")}
                />
                <InlineFieldError field="documentNumber" message={fieldErrors.documentNumber} />
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="companyName"
                  className={labelClass}
                >
                  Nome da imobiliária
                </label>
                <input
                  id="companyName"
                  name="companyName"
                  type="text"
                  required
                  disabled={isValidatingStep}
                  aria-invalid={Boolean(fieldErrors.companyName) || undefined}
                  aria-describedby={fieldDescription("companyName")}
                  placeholder="Ex: Machado Imóveis"
                  value={formData.companyName}
                  onChange={(event) =>
                    updateField("companyName", event.target.value)
                  }
                  className={fieldInputClass("companyName")}
                />
                <InlineFieldError field="companyName" message={fieldErrors.companyName} />
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="brokersCount"
                  className={labelClass}
                >
                  Quantidade de corretores
                </label>
                <input
                  id="brokersCount"
                  name="brokersCount"
                  type="number"
                  min="1"
                  max="500"
                  required
                  disabled={isValidatingStep}
                  aria-invalid={Boolean(fieldErrors.brokersCount) || undefined}
                  aria-describedby={fieldDescription("brokersCount")}
                  placeholder="Ex: 25"
                  value={formData.brokersCount}
                  onChange={(event) =>
                    updateField("brokersCount", event.target.value)
                  }
                  className={fieldInputClass("brokersCount")}
                />
                <InlineFieldError field="brokersCount" message={fieldErrors.brokersCount} />
              </div>

              <button
                type="submit"
                disabled={isValidatingStep}
                className="auth-primary-action h-12 w-full rounded-[6px] text-[12px] font-light outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-45"
              >
                {isValidatingStep ? "Verificando..." : "Continuar"}
              </button>

              {submitError ? (
                <p role="alert" className="text-center text-[12px] font-light leading-[15px] text-primary">
                  {submitError}
                </p>
              ) : null}
            </>
          ) : step === 2 ? (
            <>
              <div className="space-y-2">
                <label
                  htmlFor="adminName"
                  className={labelClass}
                >
                  Nome completo do gestor
                </label>
                <input
                  id="adminName"
                  name="adminName"
                  type="text"
                  required
                  disabled={isValidatingStep}
                  aria-invalid={Boolean(fieldErrors.adminName) || undefined}
                  aria-describedby={fieldDescription("adminName")}
                  placeholder="Nome do gestor administrador"
                  value={formData.adminName}
                  onChange={(event) =>
                    updateField("adminName", event.target.value)
                  }
                  className={fieldInputClass("adminName")}
                />
                <InlineFieldError field="adminName" message={fieldErrors.adminName} />
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="phone"
                  className={labelClass}
                >
                  WhatsApp
                </label>
                <div className={fieldErrors.phone ? "flex h-12 overflow-hidden rounded-[6px] bg-[var(--app-surface-solid)] ring-1 ring-primary/50" : "flex h-12 overflow-hidden rounded-[6px] bg-[var(--app-surface-solid)] focus-within:ring-1 focus-within:ring-primary/40"}>
                  <div className="relative w-[112px] shrink-0 border-r border-[var(--app-border)]">
                    <select
                      name="phoneCountryCode"
                      value={formData.phoneCountryCode}
                      disabled={isValidatingStep}
                      onChange={(event) =>
                        updatePhoneCountryCode(event.target.value)
                      }
                      aria-label="Código do país"
                      className="auth-login-field h-12 w-full appearance-none bg-[var(--app-surface-solid)] pl-4 pr-8 text-base text-[var(--app-text-primary)] outline-none sm:text-sm"
                    >
                      {countryCodeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[var(--app-text-tertiary)]">
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
                    disabled={isValidatingStep}
                    aria-invalid={Boolean(fieldErrors.phone) || undefined}
                    aria-describedby={fieldDescription("phone")}
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
                    className="auth-login-field h-12 min-w-0 flex-1 bg-[var(--app-surface-solid)] px-4 text-base text-[var(--app-text-primary)] placeholder:text-[var(--app-text-secondary)] outline-none sm:text-sm"
                  />
                </div>
                <InlineFieldError field="phone" message={fieldErrors.phone} />
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="email"
                  className={labelClass}
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
                    disabled={isValidatingStep}
                    aria-invalid={Boolean(fieldErrors.email) || undefined}
                    aria-describedby={fieldDescription("email")}
                    placeholder="seu@email.com"
                    value={formData.email}
                    onChange={(event) =>
                      updateField("email", event.target.value)
                    }
                    className={fieldInputClass("email", "pl-11")}
                  />
                </div>
                <InlineFieldError field="email" message={fieldErrors.email} />
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="password"
                  className={labelClass}
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
                    maxLength={128}
                    disabled={isValidatingStep}
                    aria-invalid={Boolean(fieldErrors.password) || undefined}
                    aria-describedby={fieldDescription("password")}
                    placeholder="Mínimo 8 caracteres"
                    value={formData.password}
                    onChange={(event) =>
                      updateField("password", event.target.value)
                    }
                    className={fieldInputClass("password", "pr-12")}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((current) => !current)}
                    className="absolute inset-y-0 right-0 flex items-center px-4 text-[var(--app-text-tertiary)] outline-none transition-colors hover:text-[var(--app-text-primary)] focus-visible:text-[var(--app-text-primary)]"
                    aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  >
                    <EyeIcon open={showPassword} />
                  </button>
                </div>
                <InlineFieldError field="password" message={fieldErrors.password} />
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-[11px] font-light">
                  {passwordRules.map((rule) => (
                    <span
                      key={rule.label}
                      className={`inline-flex items-center gap-1 whitespace-nowrap ${
                        rule.isValid ? "text-primary" : "text-[var(--app-text-tertiary)]"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          rule.isValid ? "bg-primary" : "bg-[var(--app-border-strong)]"
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
                  onClick={() => {
                    setFieldErrors({});
                    setSubmitError(null);
                    setStep(1);
                  }}
                  disabled={isSubmitting || isValidatingStep}
                  className={secondaryActionClass}
                >
                  Voltar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || isValidatingStep}
                  className="auth-primary-action h-12 flex-1 rounded-[6px] text-[12px] font-light outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {isValidatingStep ? "Verificando..." : "Continuar"}
                </button>
              </div>

              {submitError ? (
                <p className="text-center text-xs font-light leading-5 text-primary">
                  {submitError}
                </p>
              ) : null}

              <LegalConsentText
                checked={acceptedLegal}
                disabled={isValidatingStep}
                invalid={Boolean(fieldErrors.legal)}
                onCheckedChange={(checked) => {
                  setAcceptedLegal(checked);
                  clearFieldError("legal");
                  setSubmitError(null);
                }}
              />
              <InlineFieldError field="legal" message={fieldErrors.legal} />
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <p className={labelClass}>
                  Escolha seu plano
                </p>
                {plansLoadState === "idle" || plansLoadState === "loading" ? (
                  <div className="flex min-h-36 items-center justify-center rounded-[8px] bg-[var(--app-surface-solid)]">
                    <VimobLoader size="sm" label="Carregando planos..." />
                  </div>
                ) : plansLoadState === "error" ? (
                  <div className="rounded-[8px] bg-[var(--app-surface-solid)] px-5 py-6 text-center">
                    <p className="text-xs font-light leading-5 text-[var(--app-text-secondary)]">
                      {plansLoadError || "Não foi possível carregar os planos agora."}
                    </p>
                    <button
                      type="button"
                      onClick={() => setPlansRequestVersion((current) => current + 1)}
                      className="mt-4 inline-flex h-10 items-center justify-center rounded-[6px] bg-primary/50 px-5 text-[11px] font-light text-primary-foreground outline-none transition-colors hover:bg-primary focus-visible:ring-2 focus-visible:ring-primary/30"
                    >
                      Tentar novamente
                    </button>
                  </div>
                ) : (
                  <PlanCarousel
                    plans={planOptions}
                    selectedSlug={formData.planSlug}
                    disabled={isCheckoutPlanLocked || isUpdatingCheckoutPlan}
                    onSelect={selectPlan}
                  />
                )}
                {checkoutToken ? (
                  <p
                    className={`text-[11px] font-light leading-5 ${
                      isChangingCheckoutPlan ? "text-primary" : "text-[var(--app-text-tertiary)]"
                    }`}
                  >
                    {isChangingCheckoutPlan
                      ? "Escolha outro plano para atualizar este checkout."
                      : "Plano travado para a cobranca atual. Cancele a cobranca na coluna de pagamento para trocar."}
                  </p>
                ) : null}
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  disabled={isSubmitting || !!checkoutToken}
                  className={`${secondaryActionClass} disabled:cursor-not-allowed disabled:opacity-45`}
                >
                  Voltar
                </button>
                <button
                  type="submit"
                  disabled={!canSubmitPlan}
                  className="auth-primary-action h-12 flex-1 rounded-[6px] text-[12px] font-light outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {isUpdatingCheckoutPlan
                    ? "Atualizando plano"
                    : checkoutToken
                    ? "Ambiente criado"
                    : isSubmitting
                      ? "Criando ambiente"
                      : selectedPlan?.signupPath === "paid"
                        ? `Criar e pagar ${selectedPlan.name}`
                        : selectedPlan
                          ? `Iniciar teste ${selectedPlan.name}`
                          : "Escolha um plano"}
                </button>
              </div>

              {submitError ? (
                <p className="text-center text-xs font-light leading-5 text-primary">
                  {submitError}
                </p>
              ) : null}
            </>
          )}
        </form>
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
