"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { VimobLoader } from "@/components/shared/loading";
import { saveCheckoutBillingProfileSession } from "@/lib/billing/checkout-profile-session";
import {
  applyPublicSignupEmailCorrection,
  clearPublicSignupAttempt,
  getOrCreatePublicSignupAttemptId,
  persistPublicSignupRetry,
  persistPublicSignupCompletion,
  readPublicSignupCompletion,
  readPublicSignupRetry,
  rotatePublicSignupAttemptId,
} from "@/lib/onboarding/signup-attempt";
import { normalizeBrazilianTaxId } from "@/lib/validation/brazilian-tax-id";
import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
  onboardingAccessStepSchema,
  onboardingOrganizationStepSchema,
  onboardingSignupResponseSchema,
} from "@/lib/validation/onboarding";
import {
  AccessStep,
  collectStepFieldErrors,
  comparePlansByDisplayOrder,
  CompletionStep,
  formatCpfCnpj,
  formatCpfDigits,
  formatPhoneNumber,
  initialFormData,
  isCnpjDocument,
  mapPublicPlan,
  OrganizationStep,
  PlanStep,
  requestStepValidation,
  StepIndicator,
  translateSignupMessage,
  type CheckoutPlanChangeResponse,
  type OnboardingData,
  type OnboardingPlanOption as PlanOption,
  type OnboardingStep,
  type PlansLoadState,
  type PublicPlansResponse,
  type SignupFieldErrorKey,
  type SignupFieldErrors,
  type SignupResponse,
} from "./form";

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
  const signupAttemptIdRef = useRef<string | null>(null);
  const [retryableAttemptEmail, setRetryableAttemptEmail] = useState<string | null>(null);
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
  const isOrganizationCnpj = isCnpjDocument(formData.documentNumber);
  const isRetryingAttemptEmail =
    retryableAttemptEmail === formData.email.trim().toLowerCase();
  const canSubmitPlan =
    !!selectedPlan && !isSubmitting && !isUpdatingCheckoutPlan && !checkoutToken;

  useEffect(() => {
    const hydrationFrame = window.requestAnimationFrame(() => {
      try {
        const completedSignup = readPublicSignupCompletion(window.sessionStorage);
        if (completedSignup) {
          setCheckoutToken(completedSignup.checkoutToken);
          setRecoveryCapability(completedSignup.recoveryCapability || null);
          setFormData((current) => ({ ...current, email: completedSignup.email }));
          if (completedSignup.requiresPayment) {
            router.replace(completedSignup.redirectTo);
            return;
          }

          setStep(4);
          return;
        }

        const retryableSignup = readPublicSignupRetry(window.sessionStorage);
        if (!retryableSignup) return;
        signupAttemptIdRef.current = retryableSignup.attemptId;
        setRetryableAttemptEmail(retryableSignup.email);
        setFormData((current) => ({ ...current, email: retryableSignup.email }));
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
      field === "adminCpf" ||
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

  function rotateSignupAttempt() {
    const nextAttemptId = window.crypto.randomUUID();
    try {
      rotatePublicSignupAttemptId(window.sessionStorage, () => nextAttemptId);
    } catch {
      // Keep the fresh identity in memory when browser storage is unavailable.
      // Retries in this mounted form remain idempotent and are no longer pinned
      // to an attempt that the API proved belongs to another e-mail.
    }
    signupAttemptIdRef.current = nextAttemptId;
    setRetryableAttemptEmail(null);
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
        documentNumber: formData.documentNumber,
        adminName: formData.adminName,
        adminCpf: isOrganizationCnpj ? formData.adminCpf : undefined,
        phoneCountryCode: formData.phoneCountryCode,
        phone: formData.phone,
        email: formData.email,
        password: formData.password,
        legalAccepted: acceptedLegal,
      });
      if (!parsedStep.success) {
        showFieldErrors(collectStepFieldErrors(parsedStep.error.issues), [
          "adminName",
          "adminCpf",
          "phone",
          "email",
          "password",
          "legal",
        ]);
        return;
      }
      if (
        signupAttemptIdRef.current &&
        retryableAttemptEmail === parsedStep.data.email
      ) {
        // A document conflict can happen after Auth created the exact
        // attempt-owned, unconfirmed identity. Rechecking availability would
        // see that safe orphan as a duplicate and prevent the idempotent retry.
        setFieldErrors({});
        setFormData((current) => ({
          ...current,
          adminName: parsedStep.data.adminName,
          adminCpf: isOrganizationCnpj
            ? formatCpfDigits(parsedStep.data.adminCpf || "")
            : "",
          phone: parsedStep.data.phone,
          email: parsedStep.data.email,
        }));
        setStep(3);
        return;
      }
      if (retryableAttemptEmail) {
        // Changing the e-mail leaves the attempt-owned Auth orphan behind. A
        // new address must start in a fresh idempotency scope.
        rotateSignupAttempt();
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
          adminCpf: isOrganizationCnpj
            ? formatCpfDigits(parsedStep.data.adminCpf || "")
            : "",
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
        let attemptId = signupAttemptIdRef.current;
        if (!attemptId) {
          try {
            attemptId = getOrCreatePublicSignupAttemptId(window.sessionStorage);
          } catch {
            // sessionStorage can be disabled by privacy settings. A stable
            // in-memory UUID still protects retries for this mounted form.
            attemptId = window.crypto.randomUUID();
          }
          signupAttemptIdRef.current = attemptId;
        }
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
            adminCpf: isOrganizationCnpj
              ? formData.adminCpf
              : formData.documentNumber,
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
            const retryableEmail = formData.email.trim().toLowerCase();
            setRetryableAttemptEmail(retryableEmail);
            try {
              persistPublicSignupRetry(
                window.sessionStorage,
                attemptId,
                retryableEmail,
              );
            } catch {
              // The in-memory marker still preserves a safe retry while this
              // mounted form remains open.
            }
            setStep(1);
            showFieldErrors(
              { documentNumber: translateSignupMessage(result.message, result.code) },
              ["documentNumber"],
            );
            return;
          }
          if (result.code === "signup_email_exists") {
            if (
              signupAttemptIdRef.current &&
              retryableAttemptEmail === formData.email.trim().toLowerCase()
            ) {
              setStep(2);
              showFieldErrors(
                {
                  password:
                    "Para retomar esta tentativa, informe a mesma senha usada no primeiro envio.",
                },
                ["password"],
              );
              return;
            }
            rotateSignupAttempt();
            setStep(2);
            showFieldErrors(
              { email: translateSignupMessage(result.message, result.code) },
              ["email"],
            );
            return;
          }
          if (result.code === "signup_attempt_conflict") {
            rotateSignupAttempt();
            setSubmitError(
              "A tentativa anterior estava vinculada a outro e-mail. Reiniciamos com segurança; tente novamente.",
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
            const documentDigits = normalizeBrazilianTaxId(
              formData.documentNumber,
            ).slice(0, 14);
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
      <header
        className={
          "text-left " + (step === 3 ? "mb-2" : "mb-8 lg:mb-10")
        }
      >
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
        <CompletionStep
          companyName={formData.companyName}
          email={formData.email}
          recoveryCapability={recoveryCapability}
          onCorrected={(recoveryResult) => {
            if (recoveryResult.email) {
              setFormData((current) => ({
                ...current,
                email: recoveryResult.email || current.email,
              }));
            }
            setRecoveryCapability(null);
            try {
              applyPublicSignupEmailCorrection(
                window.sessionStorage,
                recoveryResult,
              );
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
      ) : (
        <form
          method="post"
          noValidate
          onSubmit={handleSubmit}
          aria-busy={isValidatingStep || isSubmitting}
          className={step === 3 ? "space-y-2" : "space-y-4"}
        >
          {step === 1 ? (
            <OrganizationStep
              formData={formData}
              fieldErrors={fieldErrors}
              isValidatingStep={isValidatingStep}
              submitError={submitError}
              onUpdateField={updateField}
            />
          ) : step === 2 ? (
            <AccessStep
              acceptedLegal={acceptedLegal}
              fieldErrors={fieldErrors}
              formData={formData}
              isOrganizationCnpj={isOrganizationCnpj}
              isRetryingAttemptEmail={isRetryingAttemptEmail}
              isSubmitting={isSubmitting}
              isValidatingStep={isValidatingStep}
              showPassword={showPassword}
              submitError={submitError}
              onBack={() => {
                setFieldErrors({});
                setSubmitError(null);
                setStep(1);
              }}
              onLegalChange={(checked) => {
                setAcceptedLegal(checked);
                clearFieldError("legal");
                setSubmitError(null);
              }}
              onPhoneCountryCodeChange={updatePhoneCountryCode}
              onTogglePassword={() =>
                setShowPassword((current) => !current)
              }
              onUpdateField={updateField}
            />
          ) : (
            <PlanStep
              canSubmitPlan={canSubmitPlan}
              checkoutToken={checkoutToken}
              isChangingCheckoutPlan={isChangingCheckoutPlan}
              isCheckoutPlanLocked={isCheckoutPlanLocked}
              isSubmitting={isSubmitting}
              isUpdatingCheckoutPlan={isUpdatingCheckoutPlan}
              planOptions={planOptions}
              plansLoadError={plansLoadError}
              plansLoadState={plansLoadState}
              selectedPlan={selectedPlan}
              selectedPlanSlug={formData.planSlug}
              submitError={submitError}
              onBack={() => setStep(2)}
              onRetryPlans={() =>
                setPlansRequestVersion((current) => current + 1)
              }
              onSelectPlan={selectPlan}
            />
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
