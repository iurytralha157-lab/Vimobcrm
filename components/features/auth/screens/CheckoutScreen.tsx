"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { SignupCheckoutRecoveryBanner } from "@/components/features/onboarding/SignupCheckoutRecoveryBanner";
import { toast } from "sonner";
import { paymentsAPI } from "@/lib/api/payments";
import { settingsAPI } from "@/lib/api/settings";
import { createUUID } from "@/lib/client-id";
import { stringifyErrorMessage as getErrorMessage } from "@/lib/api/vimob-error";
import { DEFAULT_AUTHENTICATED_ROUTE } from "@/config/constants";
import {
  clearCheckoutBillingDraftSession,
  consumeCheckoutBillingProfileSession,
  loadCheckoutBillingDraftSession,
  saveCheckoutBillingDraftSession,
} from "@/lib/billing/checkout-profile-session";
import {
  type CheckoutPaymentReceiptReference,
  parseCheckoutPaymentReceiptReference,
} from "@/lib/billing/payment-receipt";
import {
  type CardRecurrenceSignal,
  type CardRecurrenceState,
  parseCheckoutPaymentMethod,
  resolveCardRecurrenceState,
} from "@/lib/billing/checkout-ui-state";
import { checkoutBillingDetailsSchema } from "@/lib/validation";
import {
  CardConfirmationView,
  CheckoutBillingSection,
  CheckoutLoadErrorView,
  CheckoutLoadingView,
  CheckoutOrderSummary,
  CheckoutPageShell,
  CheckoutPaymentSection,
  PaidCheckoutView,
  PaymentCheckoutUnavailableView,
  PlanUnavailableView,
} from "@/components/features/auth/checkout";
import {
  cardUpdateSessionStorageKey,
  checkoutCardRequestFingerprint,
  fetchPublicCheckoutPlans,
  formatPeriodLabel,
  getHTTPStatus,
  isCardFailureStatus,
  isCheckoutActivated,
  isProcessingResult,
  isSupportedBillingPeriod,
  normalizeBillingPeriods,
  parsePersistedCardUpdateJob,
  validateCardInput,
} from "@/lib/billing/checkout-domain";
import type {
  ActiveCheckout,
  BoletoResult,
  CancelPaymentResult,
  ChargeRequest,
  ChargeResult,
  CheckoutInfo,
  CheckoutPlanChangeResponse,
  CheckoutScreenProps,
  PaymentMethod,
  PaymentRecoveryState,
  PaymentStatusResponse,
  PersistedCardUpdateJob,
  PixResult,
  PublicCheckoutPlan,
} from "@/lib/billing/checkout-types";

function waitFor(milliseconds: number) {
  return new Promise<void>((resolve) =>
    window.setTimeout(resolve, milliseconds)
  );
}
export default function Checkout(props: CheckoutScreenProps = {}) {
  const organizationId = props.organizationId?.trim() || null;
  const checkoutToken = organizationId
    ? null
    : props.checkoutToken?.trim() || null;
  const identity = organizationId
    ? `organization:${organizationId}`
    : `payment:${checkoutToken || "invalid"}`;

  return (
    <CheckoutContent
      key={identity}
      organizationId={organizationId}
      checkoutToken={checkoutToken}
    />
  );
}
function CheckoutContent({
  organizationId: organizationIdProp,
  checkoutToken: checkoutTokenProp,
}: CheckoutScreenProps = {}) {
  const organizationId = organizationIdProp?.trim() || null;
  const token = organizationId
    ? undefined
    : checkoutTokenProp?.trim() || undefined;
  const hasCheckoutIdentity = Boolean(token || organizationId);
  const [info, setInfo] = useState<CheckoutInfo | null>(null);
  const managingPaymentMethod = Boolean(
    info?.checkout_access?.can_manage_payment_method,
  );
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [checkoutLoadError, setCheckoutLoadError] = useState<
    {
      message: string;
      notFound: boolean;
    } | null
  >(null);
  const [tab, setTab] = useState<PaymentMethod>("PIX");
  const [submitting, setSubmitting] = useState(false);
  const [submittedMethod, setSubmittedMethod] = useState<PaymentMethod | null>(
    null,
  );
  const [processingMethod, setProcessingMethod] = useState<
    PaymentMethod | null
  >(null);
  const [pixResult, setPixResult] = useState<PixResult | null>(null);
  const [boletoResult, setBoletoResult] = useState<BoletoResult | null>(null);
  const [cancellingDirectPayment, setCancellingDirectPayment] = useState(false);
  const [directPollingExpired, setDirectPollingExpired] = useState(false);
  const [directPollingNonce, setDirectPollingNonce] = useState(0);
  const [activeCheckout, setActiveCheckout] = useState<ActiveCheckout | null>(
    null,
  );
  const [recoveryState, setRecoveryState] = useState<
    PaymentRecoveryState | null
  >(null);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
  const [cardFailureMessage, setCardFailureMessage] = useState<string | null>(
    null,
  );
  const [recurrenceWarning, setRecurrenceWarning] = useState<string | null>(
    null,
  );
  const [recurrenceState, setRecurrenceState] = useState<CardRecurrenceState>(
    "unknown",
  );
  const [bankSlipRegistrationCancelled, setBankSlipRegistrationCancelled] =
    useState(false);
  const [recoveryIntentOverride, setRecoveryIntentOverride] = useState<
    string | null
  >(null);
  const [recoveryPaymentOverride, setRecoveryPaymentOverride] = useState<
    string | null
  >(null);
  const [directCardSubscriptionId, setDirectCardSubscriptionId] = useState<
    string | null
  >(null);
  const [directCardUpdateJobId, setDirectCardUpdateJobId] = useState<
    string | null
  >(null);
  const [directCardUpdateMode, setDirectCardUpdateMode] = useState<
    "settled_payment" | "saved_only" | null
  >(null);
  const [paid, setPaid] = useState(false);
  const [paymentReceipt, setPaymentReceipt] = useState<
    CheckoutPaymentReceiptReference | null
  >(null);
  const [paymentReceiptLoading, setPaymentReceiptLoading] = useState(false);
  const [awaitingCardConfirmation, setAwaitingCardConfirmation] = useState(
    false,
  );
  const [selectedPeriodMonths, setSelectedPeriodMonths] = useState<
    number | null
  >(null);
  const [billingDetailsConfirmed, setBillingDetailsConfirmed] = useState(false);
  const [planSelectorOpen, setPlanSelectorOpen] = useState(false);
  const [availablePlans, setAvailablePlans] = useState<PublicCheckoutPlan[]>(
    [],
  );
  const [plansLoading, setPlansLoading] = useState(false);
  const [changingPlanId, setChangingPlanId] = useState<string | null>(null);
  const periodSectionRef = useRef<HTMLElement>(null);
  const paymentFormRef = useRef<HTMLFormElement>(null);
  const planChangeInFlightRef = useRef(false);
  const paymentRequestInFlightRef = useRef(false);
  const cardRequestIdentityRef = useRef<
    {
      fingerprint: string;
      idempotencyKey: string;
    } | null
  >(null);
  const checkoutLoadGenerationRef = useRef(0);
  const cardUpdateStorageKeyRef = useRef<Promise<string> | null>(null);
  const cardUpdateStorageIdentity = organizationId
    ? `organization:${organizationId}`
    : token
    ? `payment:${token}`
    : null;

  const clearCardRequestIdentity = useCallback(() => {
    cardRequestIdentityRef.current = null;
  }, []);

  const getCardUpdateStorageKey = useCallback(() => {
    if (!cardUpdateStorageIdentity) return null;
    cardUpdateStorageKeyRef.current ??= cardUpdateSessionStorageKey(
      cardUpdateStorageIdentity,
    );
    return cardUpdateStorageKeyRef.current;
  }, [cardUpdateStorageIdentity]);

  const rememberCardUpdateJob = useCallback(async (
    job: Omit<PersistedCardUpdateJob, "version" | "createdAt">,
  ) => {
    const key = getCardUpdateStorageKey();
    if (!key) return;
    try {
      window.sessionStorage.setItem(
        await key,
        JSON.stringify(
          {
            version: 1,
            ...job,
            createdAt: Date.now(),
          } satisfies PersistedCardUpdateJob,
        ),
      );
    } catch {
      // Polling remains available in the current render even when browser
      // storage is unavailable or full.
    }
  }, [getCardUpdateStorageKey]);

  const forgetCardUpdateJob = useCallback(async () => {
    const key = getCardUpdateStorageKey();
    if (!key) return;
    try {
      window.sessionStorage.removeItem(await key);
    } catch {
      // Storage cleanup is best effort; every restored job is server-verified.
    }
  }, [getCardUpdateStorageKey]);

  const readCheckoutInfo = useCallback(async () => {
    if (organizationId) {
      return paymentsAPI.checkoutBillingProfile<CheckoutInfo>(organizationId);
    }
    if (token) {
      return paymentsAPI.checkoutInfo<CheckoutInfo>({ token });
    }
    throw new Error("Checkout invalido.");
  }, [organizationId, token]);

  const receiptPaymentId = activeCheckout?.payment_id ||
    pixResult?.payment_id ||
    boletoResult?.payment_id ||
    recoveryPaymentOverride ||
    null;

  const capturePaymentReceipt = useCallback((value: unknown) => {
    const receipt = parseCheckoutPaymentReceiptReference(value);
    if (receipt) setPaymentReceipt(receipt);
    return receipt;
  }, []);

  const refreshPaymentReceipt = useCallback(async () => {
    if (!hasCheckoutIdentity) return null;

    setPaymentReceiptLoading(true);
    try {
      const status = await paymentsAPI.paymentStatus<PaymentStatusResponse>({
        checkoutToken: token,
        organizationId,
        paymentId: receiptPaymentId,
      });
      return capturePaymentReceipt(status.receipt);
    } catch {
      // Payment activation stays successful even if this optional read fails.
      // The immutable receipt remains available through the delivery channels.
      return null;
    } finally {
      setPaymentReceiptLoading(false);
    }
  }, [
    capturePaymentReceipt,
    hasCheckoutIdentity,
    organizationId,
    receiptPaymentId,
    token,
  ]);

  // Shared billing profile used by Pix, boleto and card.
  const [holderEmail, setHolderEmail] = useState("");
  const [holderCpf, setHolderCpf] = useState("");
  const [holderPhone, setHolderPhone] = useState("");
  const [holderName, setHolderName] = useState("");
  const [holderPostalCode, setHolderPostalCode] = useState("");
  const [holderAddress, setHolderAddress] = useState("");
  const [holderAddressNumber, setHolderAddressNumber] = useState("");
  const [holderAddressComplement, setHolderAddressComplement] = useState("");
  const [holderNeighborhood, setHolderNeighborhood] = useState("");
  const [holderCity, setHolderCity] = useState("");
  const [holderState, setHolderState] = useState("");

  // Card data stays only in React memory until it is sent once to Asaas.
  // It is never copied to sessionStorage, localStorage or the Vimob database.
  const [cardHolderName, setCardHolderName] = useState("");
  const [cardHolderDocument, setCardHolderDocument] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [cardExpiryMonth, setCardExpiryMonth] = useState("");
  const [cardExpiryYear, setCardExpiryYear] = useState("");
  const [cardCcv, setCardCcv] = useState("");

  const clearPaymentState = useCallback((clearCard = false) => {
    setActiveCheckout(null);
    setPixResult(null);
    setBoletoResult(null);
    setProcessingMethod(null);
    setRecoveryState(null);
    setRecoveryMessage(null);
    setCardFailureMessage(null);
    setRecurrenceWarning(null);
    setRecurrenceState("unknown");
    setBankSlipRegistrationCancelled(false);
    setRecoveryIntentOverride(null);
    setRecoveryPaymentOverride(null);
    setDirectCardSubscriptionId(null);
    setDirectCardUpdateJobId(null);
    setDirectCardUpdateMode(null);
    setPaymentReceipt(null);
    setPaymentReceiptLoading(false);
    setAwaitingCardConfirmation(false);
    setDirectPollingExpired(false);
    if (clearCard) {
      setCardNumber("");
      setCardExpiryMonth("");
      setCardExpiryYear("");
      setCardCcv("");
    }
  }, []);

  const applyCardRecurrenceSignal = useCallback(
    (signal: CardRecurrenceSignal, message?: string | null) => {
      const nextState = resolveCardRecurrenceState(signal);
      setRecurrenceState(nextState);

      if (nextState === "saved") {
        setRecurrenceWarning(null);
      } else if (nextState === "processing") {
        setRecurrenceWarning(
          message ||
            "Pagamento confirmado. O cartão ainda está sendo conciliado para as próximas cobranças.",
        );
      } else if (nextState === "failed") {
        setRecurrenceWarning(
          message ||
            "Pagamento confirmado, mas o cartão recorrente não foi salvo. Atualize a forma de pagamento antes da próxima cobrança.",
        );
      }

      return nextState;
    },
    [],
  );

  const hydrateActiveCheckout = useCallback(
    (checkout?: ActiveCheckout | null) => {
      if (!checkout) {
        clearPaymentState();
        return;
      }

      setActiveCheckout(checkout);
      setBillingDetailsConfirmed(true);
      if (isSupportedBillingPeriod(checkout.billing_period_months)) {
        setSelectedPeriodMonths(checkout.billing_period_months);
      }
      setTab(checkout.billing_method);
      setRecoveryMessage(null);
      setDirectPollingExpired(false);

      if (checkout.billing_method === "CREDIT_CARD") {
        setCardNumber("");
        setCardExpiryMonth("");
        setCardExpiryYear("");
        setCardCcv("");
        setDirectCardSubscriptionId(checkout.subscription_id);
        setAwaitingCardConfirmation(true);
        setProcessingMethod(null);
        if (isCardFailureStatus(checkout.provider_status)) {
          setCardFailureMessage(
            "O cartão foi recusado. Cancele esta tentativa para informar outro cartão.",
          );
          setDirectPollingExpired(true);
        }
        return;
      }

      setProcessingMethod(checkout.billing_method);
    },
    [clearPaymentState],
  );

  useEffect(() => {
    const generation = ++checkoutLoadGenerationRef.current;
    let active = true;
    const isCurrentGeneration = () =>
      active && checkoutLoadGenerationRef.current === generation;

    void (async () => {
      setLoading(true);
      setCheckoutLoadError(null);
      try {
        if (!hasCheckoutIdentity) {
          setInfo(null);
          setCheckoutLoadError({
            message: "O link deste checkout é inválido.",
            notFound: true,
          });
          return;
        }

        const data = await readCheckoutInfo();
        if (!isCurrentGeneration()) return;
        let initialPaymentStatus: PaymentStatusResponse | null = null;
        let initialPaymentStatusError: string | null = null;
        if (
          data.checkout_access?.scope === "payment" &&
          token &&
          !data.checkout_access.payment_settled
        ) {
          try {
            initialPaymentStatus = await paymentsAPI.paymentStatus<
              PaymentStatusResponse
            >({
              checkoutToken: token,
              paymentId: data.active_checkout?.payment_id || null,
            });
          } catch (error) {
            if (!isCurrentGeneration()) return;
            initialPaymentStatusError = getErrorMessage(error) ||
              "Não foi possível confirmar o estado desta cobrança agora.";
          }
        }
        if (!isCurrentGeneration()) return;
        setInfo(data);
        const checkoutParams = new URLSearchParams(window.location.search);
        const preferredPaymentMethod = parseCheckoutPaymentMethod(
          checkoutParams.get("method"),
        );
        const paymentScoped = data.checkout_access?.scope === "payment";
        if (paymentScoped) {
          clearPaymentState();
          const bankRegistrationCancelled = Boolean(
            initialPaymentStatus?.bank_slip_registration_cancelled ||
              initialPaymentStatus?.code ===
                "bank_slip_registration_cancelled" ||
              data.checkout_access?.bank_slip_registration_cancelled,
          );
          setBankSlipRegistrationCancelled(bankRegistrationCancelled);
          if (initialPaymentStatus) {
            setRecoveryState(initialPaymentStatus.state);
            setRecoveryMessage(
              bankRegistrationCancelled
                ? "O boleto expirou ou teve o registro bancário cancelado. Gere um novo boleto ou escolha outra forma de pagamento."
                : initialPaymentStatus.message || null,
            );
            capturePaymentReceipt(initialPaymentStatus.receipt);

            if (initialPaymentStatus.state === "settled") {
              setPaid(true);
            } else if (initialPaymentStatus.state === "cancelled") {
              setDirectPollingExpired(true);
            } else if (initialPaymentStatus.state === "assisted") {
              setDirectPollingExpired(true);
            }
          } else if (initialPaymentStatusError) {
            setRecoveryState("assisted");
            setRecoveryMessage(initialPaymentStatusError);
            setDirectPollingExpired(true);
          }
          const scopedMethod = data.active_checkout?.billing_method;
          if (
            scopedMethod === "CREDIT_CARD" &&
            (initialPaymentStatus?.state === "settled" ||
              data.checkout_access?.payment_settled)
          ) {
            applyCardRecurrenceSignal(
              initialPaymentStatus || data.checkout_access || {},
              initialPaymentStatus?.message,
            );
          }
          if (
            scopedMethod &&
            ["PIX", "BOLETO", "CREDIT_CARD"].includes(scopedMethod)
          ) {
            setTab(scopedMethod);
          }
          if (
            data.active_checkout &&
            isSupportedBillingPeriod(
              data.active_checkout.billing_period_months,
            )
          ) {
            setSelectedPeriodMonths(data.active_checkout.billing_period_months);
          }
          if (
            data.active_checkout &&
            (initialPaymentStatus?.state === "processing" ||
              ["AWAITING_RISK_ANALYSIS", "AUTHORIZED", "PROCESSING"].includes(
                (data.checkout_access?.payment_status || "").toUpperCase(),
              ))
          ) {
            setRecoveryIntentOverride(data.active_checkout.intent_id || null);
            setRecoveryPaymentOverride(data.active_checkout.payment_id || null);
            setProcessingMethod(data.active_checkout.billing_method);
          }
        } else {
          if (data.checkout_access?.can_manage_payment_method) {
            setTab("CREDIT_CARD");
          } else if (!data.active_checkout && preferredPaymentMethod) {
            setTab(preferredPaymentMethod);
          }
          hydrateActiveCheckout(data.active_checkout);
        }
        const availablePeriods = normalizeBillingPeriods(
          data.plan?.billing_periods,
        );
        if (!data.active_checkout) {
          setSelectedPeriodMonths(
            availablePeriods.includes(1) ? 1 : (availablePeriods[0] ?? null),
          );
        }
        const storedProfile =
          data.checkout_access?.use_stored_billing_profile &&
            data.billing_profile_summary?.complete
            ? data.billing_profile_summary
            : null;
        if (storedProfile) {
          setHolderName(storedProfile.name);
          setHolderEmail(storedProfile.email);
          setHolderCpf(storedProfile.cpf_cnpj);
          setHolderPhone(storedProfile.phone);
          setHolderPostalCode(storedProfile.postal_code);
          setHolderAddress(storedProfile.address);
          setHolderAddressNumber(storedProfile.address_number);
          setHolderAddressComplement(storedProfile.address_complement);
          setHolderNeighborhood(storedProfile.neighborhood);
          setHolderCity(storedProfile.city);
          setHolderState(storedProfile.state);
          setBillingDetailsConfirmed(true);
        } else {
          const authorizedProfile = data.billing_profile || null;
          const sessionProfile = consumeCheckoutBillingProfileSession(
            data.organization.id,
          );
          if (authorizedProfile) {
            setHolderName(authorizedProfile.name);
            setHolderEmail(authorizedProfile.email);
            setHolderCpf(authorizedProfile.cpf_cnpj);
            setHolderPhone(authorizedProfile.phone);
            setHolderPostalCode(authorizedProfile.postal_code);
            setHolderAddress(authorizedProfile.address);
            setHolderAddressNumber(authorizedProfile.address_number);
            setHolderAddressComplement(authorizedProfile.address_complement);
            setHolderNeighborhood(authorizedProfile.neighborhood);
            setHolderCity(authorizedProfile.city);
            setHolderState(authorizedProfile.state);
          } else if (sessionProfile) {
            setHolderName(sessionProfile.name);
            setHolderEmail(sessionProfile.email);
            setHolderCpf(sessionProfile.cpf_cnpj);
            setHolderPhone(sessionProfile.phone);
          }
          const draftProfile = token
            ? loadCheckoutBillingDraftSession(token, data.organization.id)
            : null;
          if (draftProfile) {
            setHolderName(draftProfile.name);
            setHolderEmail(draftProfile.email);
            setHolderCpf(draftProfile.cpf_cnpj);
            setHolderPhone(draftProfile.phone);
            setHolderPostalCode(draftProfile.postal_code);
            setHolderAddress(draftProfile.address);
            setHolderAddressNumber(draftProfile.address_number);
            setHolderAddressComplement(draftProfile.address_complement);
            setHolderNeighborhood(draftProfile.neighborhood);
            setHolderCity(draftProfile.city);
            setHolderState(draftProfile.state);
          }
          // An authenticated profile is only a convenience. Do not hold the
          // public checkout loading screen while Supabase resolves a session.
          if (token && !authorizedProfile) {
            void paymentsAPI
              .checkoutBillingProfile<CheckoutInfo>(data.organization.id)
              .then((authorizedInfo) => {
                if (!isCurrentGeneration()) return;
                const billingProfile = authorizedInfo.billing_profile;
                if (!billingProfile) return;
                setHolderName(
                  (current) => current || billingProfile.name || "",
                );
                setHolderEmail(
                  (current) => current || billingProfile.email || "",
                );
                setHolderCpf(
                  (current) => current || billingProfile.cpf_cnpj || "",
                );
                setHolderPhone(
                  (current) => current || billingProfile.phone || "",
                );
                setHolderPostalCode(
                  (current) => current || billingProfile.postal_code || "",
                );
                setHolderAddress(
                  (current) => current || billingProfile.address || "",
                );
                setHolderAddressNumber(
                  (current) => current || billingProfile.address_number || "",
                );
                setHolderAddressComplement(
                  (current) =>
                    current || billingProfile.address_complement || "",
                );
                setHolderNeighborhood(
                  (current) => current || billingProfile.neighborhood || "",
                );
                setHolderCity(
                  (current) => current || billingProfile.city || "",
                );
                setHolderState(
                  (current) => current || billingProfile.state || "",
                );
              })
              .catch(() => {
                // Public checkout remains usable without an authenticated session.
              });
          }
        }
        const checkoutOutcome = checkoutParams.get("checkout");
        if (data.checkout_access?.bank_slip_registration_cancelled) {
          setBankSlipRegistrationCancelled(true);
          setBoletoResult(null);
          setProcessingMethod(null);
          setRecoveryMessage(
            "O boleto expirou ou teve o registro bancário cancelado. Gere um novo boleto ou escolha outra forma de pagamento.",
          );
        }
        if (
          data.checkout_access?.recurrence_saved !== undefined ||
          data.checkout_access?.recurrence_processing !== undefined ||
          data.checkout_access?.recurrence_save_failed !== undefined ||
          data.checkout_access?.requires_payment_method_update !== undefined
        ) {
          applyCardRecurrenceSignal(data.checkout_access);
        }
        if (isCheckoutActivated(data)) {
          setPaid(true);
        } else if (checkoutOutcome === "success") {
          setAwaitingCardConfirmation(true);
          setProcessingMethod("CREDIT_CARD");
          toast.info("Pagamento enviado. Estamos aguardando a confirmação.");
        } else if (checkoutOutcome === "cancelled") {
          toast.info(
            "Checkout cancelado. Nenhuma nova assinatura foi ativada.",
          );
        } else if (checkoutOutcome === "expired") {
          if (token) clearCheckoutBillingDraftSession(token);
          toast.error(
            "O link de pagamento expirou. Gere um novo checkout para continuar.",
          );
        }
      } catch (error: unknown) {
        if (!isCurrentGeneration()) return;
        const message = getErrorMessage(error) ||
          "Não foi possível carregar o checkout agora.";
        setInfo(null);
        setCheckoutLoadError({
          message,
          notFound: getHTTPStatus(error) === 404,
        });
      } finally {
        if (isCurrentGeneration()) setLoading(false);
      }
    })();

    return () => {
      active = false;
      if (checkoutLoadGenerationRef.current === generation) {
        checkoutLoadGenerationRef.current += 1;
      }
    };
  }, [
    applyCardRecurrenceSignal,
    capturePaymentReceipt,
    clearPaymentState,
    hasCheckoutIdentity,
    hydrateActiveCheckout,
    loadAttempt,
    readCheckoutInfo,
    token,
  ]);

  useEffect(() => {
    if (
      loading || !info || !hasCheckoutIdentity || directCardUpdateJobId
    ) return;

    let active = true;
    void (async () => {
      const key = getCardUpdateStorageKey();
      if (!key) return;
      try {
        const resolvedKey = await key;
        const storedValue = window.sessionStorage.getItem(resolvedKey);
        const stored = parsePersistedCardUpdateJob(storedValue);
        if (!stored) {
          if (storedValue) window.sessionStorage.removeItem(resolvedKey);
          return;
        }
        if (!active) return;
        setDirectCardUpdateJobId(stored.jobId);
        setDirectCardUpdateMode(stored.mode);
        setRecoveryPaymentOverride(stored.paymentId);
        setDirectCardSubscriptionId(stored.subscriptionId);
        setRecurrenceState("processing");
        setRecoveryState("processing");
        setRecoveryMessage(
          "Retomamos a verificacao segura da atualizacao do cartao.",
        );
        setProcessingMethod(
          stored.mode === "settled_payment" ? "CREDIT_CARD" : null,
        );
        setDirectPollingExpired(false);
      } catch {
        // A missing/blocked session store does not weaken server-side fencing.
      }
    })();

    return () => {
      active = false;
    };
  }, [
    directCardUpdateJobId,
    getCardUpdateStorageKey,
    hasCheckoutIdentity,
    info,
    loading,
  ]);

  useEffect(() => {
    if (!paid) return;
    const timer = window.setTimeout(() => {
      void refreshPaymentReceipt();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [paid, refreshPaymentReceipt]);

  useEffect(() => {
    const organizationId = info?.organization.id;
    if (
      !token ||
      !organizationId ||
      loading ||
      paid ||
      info?.checkout_access?.use_stored_billing_profile
    ) {
      return;
    }

    const timeout = window.setTimeout(() => {
      saveCheckoutBillingDraftSession(token, organizationId, {
        name: holderName,
        email: holderEmail,
        cpf_cnpj: holderCpf,
        phone: holderPhone,
        country: "BR",
        postal_code: holderPostalCode,
        address: holderAddress,
        address_number: holderAddressNumber,
        address_complement: holderAddressComplement,
        neighborhood: holderNeighborhood,
        city: holderCity,
        state: holderState,
      });
    }, 200);

    return () => window.clearTimeout(timeout);
  }, [
    holderAddress,
    holderAddressComplement,
    holderAddressNumber,
    holderCity,
    holderCpf,
    holderEmail,
    holderName,
    holderNeighborhood,
    holderPhone,
    holderPostalCode,
    holderState,
    info?.organization.id,
    info?.checkout_access?.use_stored_billing_profile,
    loading,
    paid,
    token,
  ]);

  useEffect(() => {
    if (paid && token) clearCheckoutBillingDraftSession(token);
  }, [paid, token]);

  useEffect(() => {
    if (!planSelectorOpen || availablePlans.length > 0) return;

    const controller = new AbortController();
    const loadPlans = async () => {
      setPlansLoading(true);
      try {
        setAvailablePlans(await fetchPublicCheckoutPlans(controller.signal));
      } catch (error) {
        if (controller.signal.aborted) return;
        toast.error(getErrorMessage(error));
      } finally {
        if (!controller.signal.aborted) setPlansLoading(false);
      }
    };

    void loadPlans();
    return () => controller.abort();
  }, [availablePlans.length, planSelectorOpen]);

  const recoveryMethod: PaymentMethod | null = activeCheckout?.billing_method ||
    processingMethod ||
    (pixResult
      ? "PIX"
      : boletoResult
      ? "BOLETO"
      : awaitingCardConfirmation
      ? "CREDIT_CARD"
      : null);
  const recoveryIntentId = activeCheckout?.intent_id || recoveryIntentOverride;
  const recoveryPaymentId = activeCheckout?.payment_id ||
    pixResult?.payment_id ||
    boletoResult?.payment_id ||
    recoveryPaymentOverride ||
    null;
  const recoverySubscriptionId = activeCheckout?.subscription_id ||
    directCardSubscriptionId;

  // Provider status and organization activation are separate confirmations.
  // Recover the provider artifacts first, then keep checking the canonical
  // checkout until the selected plan is effectively promoted.
  useEffect(() => {
    if (
      !hasCheckoutIdentity ||
      !recoveryMethod ||
      (directCardUpdateJobId && directCardUpdateMode === "saved_only") ||
      (paid && recurrenceState !== "processing")
    ) {
      return;
    }

    let attempts = 0;
    let checking = false;
    let mounted = true;
    const maxAttempts = recoveryMethod === "CREDIT_CARD" ? 24 : 60;

    const checkRecovery = async () => {
      if (!mounted || checking || attempts >= maxAttempts) return;
      checking = true;
      attempts += 1;

      try {
        const statusResult = await paymentsAPI.paymentStatus<
          PaymentStatusResponse
        >({
          checkoutToken: token,
          organizationId,
          intentId: recoveryIntentId,
          paymentId: recoveryPaymentId,
          subscriptionId: recoverySubscriptionId,
        });
        if (!mounted) return;

        const checkout = statusResult.checkout;
        const method = checkout?.billing_method || recoveryMethod;
        const paymentId = checkout?.payment_id || statusResult.payment?.id ||
          recoveryPaymentId;
        const amount = statusResult.payment?.value ?? checkout?.amount ?? 0;
        setRecoveryState(statusResult.state);
        setRecoveryMessage(statusResult.message || null);
        capturePaymentReceipt(statusResult.receipt);

        if (
          statusResult.bank_slip_registration_cancelled ||
          statusResult.code === "bank_slip_registration_cancelled"
        ) {
          setBankSlipRegistrationCancelled(true);
          setBoletoResult(null);
          setProcessingMethod(null);
          setActiveCheckout(null);
          setRecoveryState("retry");
          setRecoveryMessage(
            "O boleto expirou ou teve o registro bancário cancelado. Gere um novo boleto ou escolha outra forma de pagamento.",
          );
          window.clearInterval(interval);
          return;
        }

        if (statusResult.state === "settled") {
          const recurrence = method === "CREDIT_CARD" && !directCardUpdateJobId
            ? applyCardRecurrenceSignal(statusResult, statusResult.message)
            : directCardUpdateJobId
            ? "processing"
            : "unknown";
          setPaid(true);
          setAwaitingCardConfirmation(false);
          setProcessingMethod(null);
          setCardFailureMessage(null);
          if (
            directCardUpdateJobId || method !== "CREDIT_CARD" ||
            recurrence !== "processing"
          ) {
            window.clearInterval(interval);
          }
          if (!capturePaymentReceipt(statusResult.receipt)) {
            void refreshPaymentReceipt();
          }
          if (!paid) toast.success("Pagamento confirmado! 🎉");
          return;
        }

        if (checkout) {
          setActiveCheckout(checkout);
          setTab(checkout.billing_method);
          if (isSupportedBillingPeriod(checkout.billing_period_months)) {
            setSelectedPeriodMonths(checkout.billing_period_months);
          }
          if (checkout.subscription_id) {
            setDirectCardSubscriptionId(checkout.subscription_id);
          }
        }

        if (statusResult.state === "cancelled") {
          clearPaymentState(true);
          window.clearInterval(interval);
          toast.info(
            "A tentativa anterior foi cancelada. Escolha uma nova forma de pagamento.",
          );
          return;
        }

        if (method === "PIX" && paymentId) {
          setPixResult((current) => ({
            type: "PIX",
            payment_id: paymentId,
            invoice_url: statusResult.payment?.invoice_url ||
              current?.invoice_url || "",
            qr_code: statusResult.pix?.qr_code || current?.qr_code || "",
            qr_payload: statusResult.pix?.qr_payload || current?.qr_payload ||
              "",
            value: amount || current?.value || 0,
          }));
          if (statusResult.pix?.qr_code || statusResult.pix?.qr_payload) {
            setProcessingMethod(null);
          }
        } else if (method === "BOLETO" && paymentId) {
          setBoletoResult((current) => ({
            type: "BOLETO",
            payment_id: paymentId,
            invoice_url: statusResult.payment?.invoice_url ||
              current?.invoice_url || "",
            bank_slip_url: statusResult.boleto?.bank_slip_url ||
              current?.bank_slip_url ||
              "",
            identification_field: statusResult.boleto?.identification_field ||
              current?.identification_field ||
              "",
            bar_code: statusResult.boleto?.bar_code || current?.bar_code || "",
            due_date: statusResult.payment?.due_date ?? current?.due_date ??
              null,
            value: amount || current?.value || 0,
          }));
          if (
            statusResult.payment?.invoice_url ||
            statusResult.boleto?.bank_slip_url ||
            statusResult.boleto?.identification_field ||
            statusResult.boleto?.bar_code
          ) {
            setProcessingMethod(null);
          }
        } else if (method === "CREDIT_CARD") {
          setAwaitingCardConfirmation(true);
          setProcessingMethod(null);
          const providerStatus = checkout?.provider_status ||
            statusResult.payment?.status;
          if (
            isCardFailureStatus(providerStatus) ||
            statusResult.state === "retry"
          ) {
            setCardFailureMessage(
              statusResult.message ||
                "O cartão foi recusado. Cancele esta tentativa para informar outro cartão.",
            );
            setDirectPollingExpired(true);
            window.clearInterval(interval);
            return;
          }
          if (statusResult.state === "assisted") {
            setCardFailureMessage(null);
            setDirectPollingExpired(true);
            window.clearInterval(interval);
            return;
          }
        }

        if (statusResult.state === "assisted") {
          setDirectPollingExpired(true);
          window.clearInterval(interval);
          return;
        }

        const canonicalInfo = await readCheckoutInfo();
        if (!mounted) return;
        setInfo(canonicalInfo);
        if (
          canonicalInfo.active_checkout &&
          canonicalInfo.checkout_access?.scope !== "payment"
        ) {
          setActiveCheckout(canonicalInfo.active_checkout);
          if (
            isSupportedBillingPeriod(
              canonicalInfo.active_checkout.billing_period_months,
            )
          ) {
            setSelectedPeriodMonths(
              canonicalInfo.active_checkout.billing_period_months,
            );
          }
        }
        if (isCheckoutActivated(canonicalInfo)) {
          setPaid(true);
          if (!capturePaymentReceipt(statusResult.receipt)) {
            void refreshPaymentReceipt();
          }
          setAwaitingCardConfirmation(false);
          setCardFailureMessage(null);
          window.clearInterval(interval);
          toast.success("Pagamento confirmado! 🎉");
        }
      } catch (error) {
        if (attempts >= 3 && mounted) {
          setRecoveryMessage(
            getErrorMessage(error) ||
              "Ainda não foi possível consultar a cobrança.",
          );
        }
        try {
          const canonicalInfo = await readCheckoutInfo();
          if (!mounted) return;
          setInfo(canonicalInfo);
          if (canonicalInfo.active_checkout) {
            setActiveCheckout(canonicalInfo.active_checkout);
            setBillingDetailsConfirmed(true);
            if (
              isSupportedBillingPeriod(
                canonicalInfo.active_checkout.billing_period_months,
              )
            ) {
              setSelectedPeriodMonths(
                canonicalInfo.active_checkout.billing_period_months,
              );
            }
          }
          if (isCheckoutActivated(canonicalInfo)) {
            setPaid(true);
            void refreshPaymentReceipt();
            setAwaitingCardConfirmation(false);
            setCardFailureMessage(null);
            window.clearInterval(interval);
            toast.success("Pagamento confirmado! 🎉");
          }
        } catch {
          // Both reads are retried by the next recovery cycle.
        }
      } finally {
        checking = false;
        if (attempts >= maxAttempts && mounted) {
          window.clearInterval(interval);
          setDirectPollingExpired(true);
          if (recurrenceState === "processing") {
            setRecurrenceWarning(
              "O pagamento está confirmado, mas a recorrência continua em conciliação. Consulte novamente antes de atualizar o cartão.",
            );
          } else {
            setRecoveryMessage(
              (current) =>
                current || "A confirmação está demorando mais que o esperado.",
            );
          }
        }
      }
    };

    const interval = window.setInterval(() => void checkRecovery(), 5_000);
    void checkRecovery();
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, [
    clearPaymentState,
    capturePaymentReceipt,
    directPollingNonce,
    directCardUpdateJobId,
    directCardUpdateMode,
    hasCheckoutIdentity,
    organizationId,
    paid,
    applyCardRecurrenceSignal,
    recoveryIntentId,
    recoveryMethod,
    recoveryPaymentId,
    recoverySubscriptionId,
    recurrenceState,
    refreshPaymentReceipt,
    readCheckoutInfo,
    token,
  ]);

  useEffect(() => {
    if (!hasCheckoutIdentity || !directCardUpdateJobId) return;

    let mounted = true;
    let checking = false;
    let attempts = 0;
    const maxAttempts = 60;

    const checkCardUpdate = async () => {
      if (!mounted || checking || attempts >= maxAttempts) return;
      checking = true;
      attempts += 1;
      try {
        const status = await paymentsAPI.paymentStatus<PaymentStatusResponse>({
          checkoutToken: token,
          organizationId,
          paymentId: directCardUpdateMode === "settled_payment"
            ? recoveryPaymentId
            : null,
          cardUpdateJobId: directCardUpdateJobId,
        });
        if (!mounted) return;
        const update = status.card_update;
        if (!update || update.job_id !== directCardUpdateJobId) {
          throw new Error("A atualização do cartão não foi localizada.");
        }

        setRecoveryMessage(status.message || null);
        if (update.state === "queued") {
          setRecurrenceState("processing");
          setRecoveryState("processing");
          return;
        }

        window.clearInterval(interval);
        clearCardRequestIdentity();
        if (update.state !== "manual_review") {
          await forgetCardUpdateJob();
        }
        if (update.state === "succeeded") {
          setRecurrenceState("saved");
          setRecurrenceWarning(null);
          setDirectCardUpdateJobId(null);
          setDirectCardUpdateMode(null);
          setProcessingMethod(null);
          setRecoveryState("settled");
          toast.success(
            status.message ||
              "Cartão atualizado para as próximas cobranças.",
          );
          if (directCardUpdateMode === "saved_only") {
            window.location.assign(
              "/settings?tab=subscription&billing=methods&saved=1",
            );
          }
          return;
        }

        const requiresAssistance = update.state === "manual_review";
        setRecurrenceState("failed");
        setRecoveryState(requiresAssistance ? "assisted" : "retry");
        setRecurrenceWarning(
          status.message ||
            (requiresAssistance
              ? "A atualização do cartão precisa de verificação do suporte."
              : "O cartão não foi atualizado. Confira os dados e tente novamente."),
        );
        setCardFailureMessage(status.message || null);
        setAwaitingCardConfirmation(false);
        if (requiresAssistance) {
          setProcessingMethod("CREDIT_CARD");
          setDirectPollingExpired(true);
        } else {
          setDirectCardUpdateJobId(null);
          setDirectCardUpdateMode(null);
          setProcessingMethod(null);
        }
      } catch (error) {
        if (mounted && attempts >= 3) {
          setRecoveryMessage(
            getErrorMessage(error) ||
              "Ainda não foi possível confirmar a atualização do cartão.",
          );
        }
      } finally {
        checking = false;
        if (mounted && attempts >= maxAttempts) {
          window.clearInterval(interval);
          setDirectPollingExpired(true);
          setRecoveryMessage(
            "A atualização continua em conciliação. Tente consultar novamente em instantes.",
          );
        }
      }
    };

    const interval = window.setInterval(() => void checkCardUpdate(), 5_000);
    void checkCardUpdate();
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, [
    clearCardRequestIdentity,
    directCardUpdateJobId,
    directCardUpdateMode,
    directPollingNonce,
    forgetCardUpdateJob,
    hasCheckoutIdentity,
    organizationId,
    recoveryPaymentId,
    token,
  ]);

  const handlePlanChange = async (nextPlan: PublicCheckoutPlan) => {
    if (
      !hasCheckoutIdentity ||
      !nextPlan.id ||
      !nextPlan.slug ||
      !nextPlan.name
    ) {
      return;
    }
    if (nextPlan.id === info?.plan?.id) {
      setPlanSelectorOpen(false);
      return;
    }
    if (
      planChangeInFlightRef.current ||
      paymentRequestInFlightRef.current ||
      pixResult ||
      boletoResult ||
      processingMethod ||
      activeCheckout ||
      submitting ||
      awaitingCardConfirmation ||
      paid
    ) {
      toast.error(
        "Cancele ou conclua a cobrança atual antes de trocar o plano.",
      );
      return;
    }

    planChangeInFlightRef.current = true;
    setChangingPlanId(nextPlan.id);
    let updateError: unknown = null;
    try {
      if (organizationId) {
        try {
          await settingsAPI.selectSubscriptionPlan(
            { plan_id: nextPlan.id },
            organizationId,
          );
        } catch (error) {
          updateError = error;
        }
      } else {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 20_000);
        try {
          const response = await fetch("/api/onboarding/checkout-plan", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              checkoutToken: token,
              planSlug: nextPlan.slug,
            }),
            signal: controller.signal,
          });
          const payload = (await response
            .json()
            .catch(() => null)) as CheckoutPlanChangeResponse | null;
          if (!response.ok || !payload?.ok) {
            updateError = new Error(
              payload?.message || "Não foi possível trocar o plano.",
            );
          }
        } catch (error) {
          updateError = error;
        } finally {
          window.clearTimeout(timeout);
        }
      }

      // A lost HTTP response does not mean the mutation failed. Re-read the
      // canonical quote and reconcile what the server actually committed.
      let canonicalInfo: CheckoutInfo | null = null;
      for (const delay of [0, 500, 1_000, 2_000]) {
        if (delay > 0) await waitFor(delay);
        try {
          canonicalInfo = await readCheckoutInfo();
          const appliedPlanId = canonicalInfo.organization.pending_plan_id ||
            canonicalInfo.organization.plan_id;
          if (
            appliedPlanId === nextPlan.id &&
            canonicalInfo.plan?.id === nextPlan.id
          ) {
            break;
          }
        } catch (error) {
          updateError = updateError || error;
        }
      }

      if (canonicalInfo) {
        setInfo(canonicalInfo);
        hydrateActiveCheckout(canonicalInfo.active_checkout);
      }

      const appliedPlanId = canonicalInfo?.organization.pending_plan_id ||
        canonicalInfo?.organization.plan_id;
      const planApplied = appliedPlanId === nextPlan.id &&
        canonicalInfo?.plan?.id === nextPlan.id;
      if (!planApplied || !canonicalInfo?.plan) {
        throw (
          updateError ||
          new Error("O plano não pôde ser confirmado. Tente novamente.")
        );
      }

      const selectedPlanAlreadyActive = ["active", "trial"].includes(
        canonicalInfo.organization.subscription_status || "",
      ) &&
        canonicalInfo.organization.plan_id === nextPlan.id &&
        !canonicalInfo.organization.pending_plan_id;
      if (selectedPlanAlreadyActive) {
        window.location.assign(DEFAULT_AUTHENTICATED_ROUTE);
        return;
      }

      const nextPeriods = normalizeBillingPeriods(
        canonicalInfo.plan.billing_periods,
      );
      if (!canonicalInfo.active_checkout) {
        setSelectedPeriodMonths(
          nextPeriods.includes(1) ? 1 : (nextPeriods[0] ?? null),
        );
      }
      setPlanSelectorOpen(false);
      toast.success(`Plano alterado para ${canonicalInfo.plan.name}.`);
    } catch (error) {
      toast.error(getErrorMessage(error) || "Não foi possível trocar o plano.");
    } finally {
      planChangeInFlightRef.current = false;
      setChangingPlanId(null);
    }
  };

  const handleBillingDetailsContinue = () => {
    if (usesStoredBillingProfile) {
      setBillingDetailsConfirmed(true);
      window.requestAnimationFrame(() => {
        (managingPaymentMethod
          ? paymentFormRef.current
          : periodSectionRef.current)?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
      });
      return;
    }

    const parsed = checkoutBillingDetailsSchema.safeParse({
      name: holderName,
      email: holderEmail,
      cpf_cnpj: holderCpf,
      phone: holderPhone,
      country: "BR",
      postal_code: holderPostalCode,
      address: holderAddress,
      address_number: holderAddressNumber,
      address_complement: holderAddressComplement,
      neighborhood: holderNeighborhood,
      city: holderCity,
      state: holderState,
    });

    if (!parsed.success) {
      toast.error(
        parsed.error.issues[0]?.message || "Confira os dados de faturamento.",
      );
      return;
    }

    setHolderName(parsed.data.name);
    setHolderEmail(parsed.data.email);
    setHolderCpf(parsed.data.cpf_cnpj);
    setHolderPhone(parsed.data.phone);
    setHolderPostalCode(parsed.data.postal_code);
    setHolderAddress(parsed.data.address);
    setHolderAddressNumber(parsed.data.address_number);
    setHolderAddressComplement(parsed.data.address_complement);
    setHolderNeighborhood(parsed.data.neighborhood);
    setHolderCity(parsed.data.city);
    setHolderState(parsed.data.state);
    setCardHolderName((current) => current.trim() || parsed.data.name);
    setCardHolderDocument((current) => current.trim() || parsed.data.cpf_cnpj);
    setBillingDetailsConfirmed(true);

    window.requestAnimationFrame(() => {
      (managingPaymentMethod
        ? paymentFormRef.current
        : periodSectionRef.current)?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
    });
  };

  const handleSubmit = async (billingType: PaymentMethod) => {
    if (!info?.plan) return;
    if (planChangeInFlightRef.current || changingPlanId) {
      toast.error(
        "Aguarde a troca de plano terminar antes de gerar a cobrança.",
      );
      return;
    }
    if (paymentRequestInFlightRef.current) return;
    if (processingMethod || activeCheckout) {
      setDirectPollingExpired(false);
      setDirectPollingNonce((value) => value + 1);
      return;
    }

    paymentRequestInFlightRef.current = true;
    setTab(billingType);
    setSubmittedMethod(billingType);
    setSubmitting(true);
    setRecoveryMessage(null);
    setCardFailureMessage(null);
    setBankSlipRegistrationCancelled(false);
    let chargeRequested = false;
    try {
      if (!selectedPeriodMonths && !managingPaymentMethod) {
        throw new Error("Escolha um período de cobrança para continuar.");
      }

      if (billingType === "CREDIT_CARD") {
        const cardError = validateCardInput({
          holderName: cardHolderName,
          holderDocument: cardHolderDocument,
          number: cardNumber,
          expiryMonth: cardExpiryMonth,
          expiryYear: cardExpiryYear,
          ccv: cardCcv,
        });
        if (cardError) throw new Error(cardError);
      }

      const body: ChargeRequest = {
        billing_type: billingType,
        billing_profile_mode: usesStoredBillingProfile ? "stored" : "manual",
        billing_period_months: selectedPeriodMonths || 1,
        expected_plan_id: info.plan.id,
        expected_monthly_price: info.plan.price,
      };
      if (!usesStoredBillingProfile) {
        body.holder_name = holderName;
        body.holder_email = holderEmail;
        body.holder_cpf_cnpj = holderCpf;
        body.holder_phone = holderPhone;
        body.holder_postal_code = holderPostalCode;
        body.holder_address = holderAddress;
        body.holder_address_number = holderAddressNumber;
        body.holder_address_complement = holderAddressComplement;
        body.holder_neighborhood = holderNeighborhood;
        body.holder_city = holderCity;
        body.holder_state = holderState;
        body.holder_country = "BR";
      }
      if (billingType === "CREDIT_CARD") {
        const fingerprint = await checkoutCardRequestFingerprint([
          organizationId || token || "",
          info.plan.id,
          String(selectedPeriodMonths || 1),
          cardHolderName.trim(),
          cardHolderDocument.replace(/\D/g, ""),
          cardNumber.replace(/\D/g, ""),
          cardExpiryMonth.trim(),
          cardExpiryYear.trim(),
          cardCcv.trim(),
        ]);
        if (cardRequestIdentityRef.current?.fingerprint !== fingerprint) {
          cardRequestIdentityRef.current = {
            fingerprint,
            idempotencyKey: createUUID(),
          };
        }
        body.idempotency_key = cardRequestIdentityRef.current.idempotencyKey;
        body.card = {
          holder_name: cardHolderName.trim(),
          holder_cpf_cnpj: cardHolderDocument.trim(),
          number: cardNumber,
          expiry_month: cardExpiryMonth,
          expiry_year: cardExpiryYear,
          ccv: cardCcv,
        };
      }
      if (organizationId) {
        body.organization_id = organizationId;
      } else if (token) {
        body.checkout_token = token;
      } else {
        throw new Error("Checkout invalido.");
      }

      chargeRequested = true;
      const result = await paymentsAPI.createCharge<ChargeResult>(
        body as unknown as Record<string, unknown>,
      );
      if (!result?.success) throw new Error(result?.error || "Falha");
      if (billingType === "CREDIT_CARD" && !isProcessingResult(result)) {
        clearCardRequestIdentity();
      }

      if (isProcessingResult(result)) {
        const cardUpdateJobId = billingType === "CREDIT_CARD"
          ? result.card_update_job_id || null
          : null;
        const cardUpdateMode = cardUpdateJobId
          ? result.saved_only === true ? "saved_only" : "settled_payment"
          : null;
        const recurrence = billingType === "CREDIT_CARD"
          ? applyCardRecurrenceSignal(result, result.message)
          : "unknown";
        setRecoveryIntentOverride(result.intent_id || null);
        setRecoveryPaymentOverride(result.payment_id || null);
        setDirectCardSubscriptionId(result.subscription_id || null);
        setDirectCardUpdateJobId(cardUpdateJobId);
        setDirectCardUpdateMode(cardUpdateMode);
        if (cardUpdateJobId && cardUpdateMode) {
          void rememberCardUpdateJob({
            jobId: cardUpdateJobId,
            mode: cardUpdateMode,
            paymentId: result.payment_id || null,
            subscriptionId: result.subscription_id || null,
          });
        }
        setProcessingMethod(
          cardUpdateMode === "saved_only" || result.settled
            ? null
            : billingType,
        );
        setRecoveryState("creating");
        setRecoveryMessage(
          result.message ||
            "A cobrança está sendo localizada sem gerar duplicidade.",
        );
        if (billingType === "CREDIT_CARD") {
          setCardNumber("");
          setCardExpiryMonth("");
          setCardExpiryYear("");
          setCardCcv("");
          setAwaitingCardConfirmation(cardUpdateMode !== "saved_only");
          if (result.settled) {
            setPaid(true);
            setAwaitingCardConfirmation(false);
            setRecoveryState("settled");
            setRecoveryPaymentOverride(result.payment_id || null);
            void refreshPaymentReceipt();
            toast.success("Pagamento confirmado.");
            if (recurrence === "unknown") {
              setRecurrenceWarning(
                "Pagamento confirmado. O estado do cartão recorrente ainda não foi informado; confira a forma de pagamento antes da próxima cobrança.",
              );
            }
            return;
          }
        }
        toast.info(
          result.message ||
            "Estamos localizando a cobrança anterior automaticamente.",
        );
        return;
      }

      setProcessingMethod(null);
      if (billingType === "PIX") {
        if (result.type !== "PIX") throw new Error("Resposta Pix invalida");
        setDirectPollingExpired(false);
        setPixResult(result);
        setRecoveryPaymentOverride(result.payment_id);
        if (!result.qr_code && !result.qr_payload) {
          setProcessingMethod("PIX");
          setRecoveryState("creating");
          setRecoveryMessage(
            "O Pix foi criado e o código está sendo preparado.",
          );
        }
      } else if (billingType === "BOLETO") {
        if (result.type !== "BOLETO") {
          throw new Error("Resposta de boleto inválida");
        }
        setDirectPollingExpired(false);
        setBoletoResult(result);
        setRecoveryPaymentOverride(result.payment_id);
        if (
          !result.invoice_url &&
          !result.bank_slip_url &&
          !result.identification_field &&
          !result.bar_code
        ) {
          setProcessingMethod("BOLETO");
          setRecoveryState("creating");
          setRecoveryMessage(
            "O boleto foi criado e os dados bancários estão sendo preparados.",
          );
        }
      } else {
        if (result.type !== "CREDIT_CARD") {
          throw new Error("Resposta de cartão inválida");
        }
        if (!result.hosted) {
          if (result.saved_only && result.recurrence_saved === true) {
            void forgetCardUpdateJob();
            setCardNumber("");
            setCardExpiryMonth("");
            setCardExpiryYear("");
            setCardCcv("");
            toast.success(
              result.message || "Cartão salvo para as próximas cobranças.",
            );
            window.location.assign(
              "/settings?tab=subscription&billing=methods&saved=1",
            );
            return;
          }
          if (result.saved_only) {
            const savedOnlyJobId = result.card_update_job_id || null;
            setDirectCardUpdateJobId(savedOnlyJobId);
            setDirectCardUpdateMode("saved_only");
            if (savedOnlyJobId) {
              void rememberCardUpdateJob({
                jobId: savedOnlyJobId,
                mode: "saved_only",
                paymentId: null,
                subscriptionId: result.subscription_id || null,
              });
            }
            setCardNumber("");
            setCardExpiryMonth("");
            setCardExpiryYear("");
            setCardCcv("");
            setProcessingMethod(null);
            setRecoveryState("processing");
            setRecoveryMessage(
              result.message ||
                "O cartão foi recebido e está sendo atualizado com segurança.",
            );
            toast.info(
              result.message ||
                "A atualização do cartão está em processamento.",
            );
            return;
          }
          if (result.settled) {
            const recurrence = applyCardRecurrenceSignal(
              result,
              result.message,
            );
            if (recurrence === "unknown") {
              setRecurrenceWarning(
                "Pagamento confirmado. O estado do cartão recorrente ainda não foi informado; confira a forma de pagamento antes da próxima cobrança.",
              );
            }
            setPaid(true);
            setCardNumber("");
            setCardExpiryMonth("");
            setCardExpiryYear("");
            setCardCcv("");
            setAwaitingCardConfirmation(false);
            setRecoveryPaymentOverride(result.payment_id || null);
            void refreshPaymentReceipt();
            toast.success(result.message || "Pagamento confirmado.");
            return;
          }
          if (!result.subscription_id && !result.payment_id) {
            throw new Error(
              "A confirmação do cartão ainda não está disponível.",
            );
          }
          setDirectCardSubscriptionId(result.subscription_id || null);
          setRecoveryPaymentOverride(result.payment_id || null);
          setCardNumber("");
          setCardExpiryMonth("");
          setCardExpiryYear("");
          setCardCcv("");
          setAwaitingCardConfirmation(true);
          setRecoveryState("pending");
          toast.success(result.message || "Cartão cadastrado com segurança.");
          return;
        }
        throw new Error(
          "O pagamento com cartão precisa ser concluído dentro do checkout da Vimob.",
        );
      }
    } catch (error: unknown) {
      const message = getErrorMessage(error) || "Erro ao processar";
      const errorStatus = getHTTPStatus(error);
      if (
        billingType === "CREDIT_CARD" && errorStatus !== null &&
        errorStatus >= 400 && errorStatus < 500 &&
        ![408, 425, 429].includes(errorStatus)
      ) {
        clearCardRequestIdentity();
      }
      if (chargeRequested && hasCheckoutIdentity) {
        for (const delay of [0, 500, 1_000, 2_000]) {
          if (delay > 0) await waitFor(delay);
          try {
            const canonicalInfo = await readCheckoutInfo();
            setInfo(canonicalInfo);
            if (isCheckoutActivated(canonicalInfo)) {
              setPaid(true);
              void refreshPaymentReceipt();
              toast.success("Pagamento confirmado! 🎉");
              return;
            }
            if (canonicalInfo.active_checkout) {
              if (canonicalInfo.checkout_access?.scope === "payment") {
                setRecoveryIntentOverride(
                  canonicalInfo.active_checkout.intent_id || null,
                );
                setRecoveryPaymentOverride(
                  canonicalInfo.active_checkout.payment_id || null,
                );
                setProcessingMethod(billingType);
              } else {
                hydrateActiveCheckout(canonicalInfo.active_checkout);
              }
              setRecoveryMessage(
                "A resposta foi interrompida, mas a tentativa está sendo recuperada com segurança.",
              );
              toast.info(
                "A tentativa está sendo localizada sem gerar uma nova cobrança.",
              );
              return;
            }
          } catch {
            // A later canonical read may observe an intent committed after the
            // provider response or browser connection was interrupted.
          }
        }
      }
      toast.error(message);
    } finally {
      paymentRequestInFlightRef.current = false;
      setSubmitting(false);
      setSubmittedMethod(null);
    }
  };

  const handleCancelDirectPayment = async () => {
    if (!hasCheckoutIdentity || info?.checkout_access?.scope === "payment") {
      return;
    }

    let intentId = activeCheckout?.intent_id || recoveryIntentOverride;
    let paymentId = activeCheckout?.payment_id ||
      pixResult?.payment_id ||
      boletoResult?.payment_id ||
      recoveryPaymentOverride;
    let subscriptionId = activeCheckout?.subscription_id ||
      directCardSubscriptionId;

    if (!intentId && !paymentId && !subscriptionId) {
      try {
        const canonicalInfo = await readCheckoutInfo();
        setInfo(canonicalInfo);
        intentId = canonicalInfo.active_checkout?.intent_id || null;
        paymentId = canonicalInfo.active_checkout?.payment_id || null;
        subscriptionId = canonicalInfo.active_checkout?.subscription_id || null;
      } catch {
        // The actionable error below is clearer than a second lookup error.
      }
    }

    setCancellingDirectPayment(true);
    try {
      const cancellationRequest: Record<string, string> = {};
      if (organizationId) cancellationRequest.organization_id = organizationId;
      else if (token) cancellationRequest.checkout_token = token;
      if (intentId) cancellationRequest.intent_id = intentId;
      if (paymentId) cancellationRequest.payment_id = paymentId;
      if (subscriptionId) cancellationRequest.subscription_id = subscriptionId;

      const result = await paymentsAPI.cancelPayment<CancelPaymentResult>(
        cancellationRequest,
      );
      if (!result?.success) {
        throw new Error(
          result?.error || "Não foi possível cancelar a cobrança.",
        );
      }

      clearPaymentState(true);
      toast.success(
        "Cobrança cancelada. Você pode escolher outra forma de pagamento.",
      );
    } catch (error: unknown) {
      setRecoveryMessage(
        "Não recebemos a confirmação do cancelamento. Estamos consultando o estado real da cobrança.",
      );
      setDirectPollingExpired(false);
      setDirectPollingNonce((value) => value + 1);
      toast.info(
        getErrorMessage(error)
          ? "A confirmação do cancelamento foi interrompida. O status será reconciliado automaticamente."
          : "Estamos confirmando o cancelamento com segurança.",
      );
    } finally {
      setCancellingDirectPayment(false);
    }
  };

  const handleRetryDirectStatus = () => {
    setDirectPollingExpired(false);
    setCardFailureMessage(null);
    setRecoveryMessage(null);
    setDirectPollingNonce((value) => value + 1);
  };

  const handleUseAnotherPaymentMethod = async () => {
    if (info?.checkout_access?.scope === "payment") {
      clearPaymentState(true);
      setRecoveryMessage(null);
      window.requestAnimationFrame(() => {
        paymentFormRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
      toast.info("Escolha outra forma para pagar a mesma cobrança.");
      return;
    }
    await handleCancelDirectPayment();
  };

  if (loading) return <CheckoutLoadingView />;

  if (!info) {
    return (
      <CheckoutLoadErrorView
        error={checkoutLoadError}
        onRetry={() => setLoadAttempt((value) => value + 1)}
      />
    );
  }

  const paymentCheckoutUnavailable =
    info.checkout_access?.scope === "payment" &&
    (recoveryState === "cancelled" ||
      (recoveryState === "assisted" && directPollingExpired));

  if (paymentCheckoutUnavailable) {
    return (
      <PaymentCheckoutUnavailableView
        cancelled={recoveryState === "cancelled"}
        message={recoveryMessage}
        onRetry={() => setLoadAttempt((value) => value + 1)}
      />
    );
  }

  if (paid) {
    return (
      <PaidCheckoutView
        planName={info.plan?.name}
        recurrenceWarning={recurrenceWarning}
        recurrenceState={recurrenceState}
        pollingExpired={directPollingExpired}
        receipt={paymentReceipt}
        receiptLoading={paymentReceiptLoading}
        onRefreshReceipt={() => void refreshPaymentReceipt()}
        onRetryStatus={handleRetryDirectStatus}
      />
    );
  }

  if (awaitingCardConfirmation) {
    return (
      <CardConfirmationView
        failureMessage={cardFailureMessage}
        recoveryMessage={recoveryMessage}
        recoveryState={recoveryState}
        pollingExpired={directPollingExpired}
        recoveryPaymentId={recoveryPaymentId}
        recoverySubscriptionId={recoverySubscriptionId}
        cancelling={cancellingDirectPayment}
        onRetryStatus={handleRetryDirectStatus}
        onUseAnotherPaymentMethod={() => void handleUseAnotherPaymentMethod()}
      />
    );
  }

  if (!info.plan) return <PlanUnavailableView />;
  const plan = info.plan;
  const billingPeriods = normalizeBillingPeriods(plan.billing_periods);
  const scopedQuote = info.checkout_access?.scope === "payment"
    ? info.active_checkout || null
    : null;
  const activeQuote = activeCheckout?.plan_id === plan.id
    ? activeCheckout
    : scopedQuote?.plan_id === plan.id
    ? scopedQuote
    : null;
  const catalogMonthlyPrice = Number.isFinite(plan.price)
    ? Math.max(0, plan.price)
    : 0;
  const monthlyPrice = activeQuote && activeQuote.billing_period_months > 0
    ? activeQuote.amount / activeQuote.billing_period_months
    : catalogMonthlyPrice;
  const total = activeQuote
    ? activeQuote.amount
    : monthlyPrice * (selectedPeriodMonths ?? 0);
  const activePaymentMethod: PaymentMethod = boletoResult
    ? "BOLETO"
    : pixResult
    ? "PIX"
    : processingMethod || submittedMethod || tab;
  const activePaymentMethodLabel = activePaymentMethod === "PIX"
    ? "Pix"
    : activePaymentMethod === "BOLETO"
    ? "Boleto bancário"
    : "Cartão de crédito";
  const selectedPeriodLabel = selectedPeriodMonths
    ? formatPeriodLabel(selectedPeriodMonths)
    : "Não selecionado";
  const checkoutMethod = processingMethod || tab;
  const usesStoredBillingProfile = Boolean(
    info?.checkout_access?.scope === "payment" &&
      info.checkout_access.use_stored_billing_profile &&
      info.billing_profile_summary?.complete,
  );
  const billingDetailsValid = usesStoredBillingProfile ||
    checkoutBillingDetailsSchema.safeParse({
      name: holderName,
      email: holderEmail,
      cpf_cnpj: holderCpf,
      phone: holderPhone,
      country: "BR",
      postal_code: holderPostalCode,
      address: holderAddress,
      address_number: holderAddressNumber,
      address_complement: holderAddressComplement,
      neighborhood: holderNeighborhood,
      city: holderCity,
      state: holderState,
    }).success;
  const cardDetailsReady = Boolean(
    cardHolderName.trim().length >= 2 &&
      [11, 14].includes(cardHolderDocument.replace(/\D/g, "").length) &&
      cardNumber.replace(/\D/g, "").length >= 13 &&
      cardExpiryMonth.length === 2 &&
      cardExpiryYear.length === 4 &&
      cardCcv.length >= 3,
  );
  const paymentProviderProcessing = Boolean(
    info?.checkout_access?.scope === "payment" &&
      ["AWAITING_RISK_ANALYSIS", "AUTHORIZED", "PROCESSING"].includes(
        (info.checkout_access.payment_status || "").toUpperCase(),
      ),
  );
  const paymentRecoveryInProgress = Boolean(processingMethod || activeCheckout);
  const isPaymentFormReady = paymentRecoveryInProgress ||
    Boolean(
      (selectedPeriodMonths || managingPaymentMethod) &&
        billingDetailsConfirmed &&
        billingDetailsValid &&
        !paymentProviderProcessing &&
        !changingPlanId &&
        (tab !== "CREDIT_CARD" || cardDetailsReady),
    );
  const canChangePlan = !managingPaymentMethod &&
    info?.checkout_access?.can_change_plan !== false &&
    !(
      submitting ||
      processingMethod ||
      pixResult ||
      boletoResult ||
      activeCheckout ||
      awaitingCardConfirmation ||
      paid ||
      changingPlanId
    );
  const canEditCheckoutSelection = canChangePlan;

  return (
    <CheckoutPageShell>
      {!managingPaymentMethod && token
        ? <SignupCheckoutRecoveryBanner checkoutToken={token} />
        : null}
      <div className="mb-5">
        <h1 className="text-[14px] font-normal leading-[1.25] text-[var(--app-text-primary)]">
          {managingPaymentMethod
            ? "Atualize seu cartão recorrente"
            : "Finalize sua assinatura"}
        </h1>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-5">
        <CheckoutBillingSection
          periodSectionRef={periodSectionRef}
          details={{
            name: holderName,
            email: holderEmail,
            document: holderCpf,
            phone: holderPhone,
            postalCode: holderPostalCode,
            address: holderAddress,
            addressNumber: holderAddressNumber,
            addressComplement: holderAddressComplement,
            neighborhood: holderNeighborhood,
            city: holderCity,
            state: holderState,
            onNameChange: setHolderName,
            onEmailChange: setHolderEmail,
            onDocumentChange: setHolderCpf,
            onPhoneChange: setHolderPhone,
            onPostalCodeChange: setHolderPostalCode,
            onAddressChange: setHolderAddress,
            onAddressNumberChange: setHolderAddressNumber,
            onAddressComplementChange: setHolderAddressComplement,
            onNeighborhoodChange: setHolderNeighborhood,
            onCityChange: setHolderCity,
            onStateChange: setHolderState,
          }}
          state={{
            confirmed: billingDetailsConfirmed,
            usesStoredProfile: usesStoredBillingProfile,
            submitting,
            processingMethod,
            hasDirectPaymentResult: Boolean(pixResult || boletoResult),
          }}
          period={{
            managingPaymentMethod,
            periods: billingPeriods,
            selectedMonths: selectedPeriodMonths,
            canEdit: canEditCheckoutSelection,
            monthlyPrice,
          }}
          actions={{
            onContinue: handleBillingDetailsContinue,
            onEdit: () => setBillingDetailsConfirmed(false),
            onSelectPeriod: setSelectedPeriodMonths,
          }}
        />

        <div className="min-w-0 space-y-4">
          <CheckoutOrderSummary
            plan={plan}
            managingPaymentMethod={managingPaymentMethod}
            planSelectorOpen={planSelectorOpen}
            canChangePlan={canChangePlan}
            changingPlanId={changingPlanId}
            plansLoading={plansLoading}
            availablePlans={availablePlans}
            selectedPeriodLabel={selectedPeriodLabel}
            activePaymentMethodLabel={activePaymentMethodLabel}
            selectedPeriodMonths={selectedPeriodMonths}
            total={total}
            monthlyPrice={monthlyPrice}
            onPlanSelectorOpenChange={setPlanSelectorOpen}
            onPlanChange={handlePlanChange}
          />
          <CheckoutPaymentSection
            formRef={paymentFormRef}
            billing={{
              confirmed: billingDetailsConfirmed,
              managingPaymentMethod,
              periods: billingPeriods,
            }}
            payment={{
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
            }}
            pixResult={pixResult}
            boletoResult={boletoResult}
            card={{
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
            }}
            actions={{
              onSubmit: handleSubmit,
              onRetryStatus: handleRetryDirectStatus,
              onUseAnotherPaymentMethod: handleUseAnotherPaymentMethod,
              onTabChange: setTab,
            }}
          />
        </div>
      </div>
    </CheckoutPageShell>
  );
}
