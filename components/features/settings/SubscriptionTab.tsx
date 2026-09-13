import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FiscalDetailsDialog,
  PaymentDetailsDialog,
  PaymentMethodDialogs,
  PaymentMethodsPage,
  PaymentsPage,
  PlanConfirmationDialog,
  PlansPage,
  SubscriptionDetailsDialog,
  SubscriptionsPage,
  SubscriptionToolbar,
  type BillingInfo,
  type CheckoutNotice,
  type SubscriptionData,
} from "@/components/features/settings/subscription";
import { useAuth } from "@/contexts/AuthContext";
import {
  settingsAPI,
  type PaymentHistoryItem,
  type SubscriptionPlan,
} from "@/lib/api/settings";
import { isBillingPlanPromotionConfirmed } from "@/lib/billing-access";
import {
  filterPaymentHistory,
  formatBillingFrequency,
  formatBillingPeriod,
  getBillingPage,
  getSubscriptionStatus,
  normalizeBillingPeriodMonths,
  type BillingPage,
} from "@/lib/billing/subscription-presentation";
import { checkoutBillingDetailsSchema } from "@/lib/validation";
import { stringifyErrorMessage as getErrorMessage } from "@/lib/api/vimob-error";

export function SubscriptionTab() {
  const { activeOrganization } = useAuth();

  return <SubscriptionTabContent key={activeOrganization.organizationId ?? "sem-organizacao"} />;
}

function SubscriptionTabContent() {
  const { activeOrganization, organization, profile, refreshProfile } = useAuth();
  const organizationId = activeOrganization.organizationId;
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<SubscriptionData | null>(null);
  const [history, setHistory] = useState<PaymentHistoryItem[]>([]);
  const [availablePlans, setAvailablePlans] = useState<SubscriptionPlan[]>([]);
  const [changingPlanId, setChangingPlanId] = useState<string | null>(null);
  const [checkoutNotice, setCheckoutNotice] = useState<CheckoutNotice>(null);
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const activePage = getBillingPage(searchParams.get("billing"));
  const [subscriptionDetailsOpen, setSubscriptionDetailsOpen] = useState(false);
  const [fiscalDialogOpen, setFiscalDialogOpen] = useState(false);
  const [paymentMethodDialogOpen, setPaymentMethodDialogOpen] = useState(false);
  const [methodDetailsOpen, setMethodDetailsOpen] = useState(false);
  const [planToConfirm, setPlanToConfirm] = useState<SubscriptionPlan | null>(null);
  const [historyQuery, setHistoryQuery] = useState("");
  const [refreshingPaymentId, setRefreshingPaymentId] = useState<string | null>(
    null,
  );
  const [paymentRefreshError, setPaymentRefreshError] = useState<string | null>(
    null,
  );
  const [paymentRefreshNonce, setPaymentRefreshNonce] = useState(0);
  const [paymentListRefreshNonce, setPaymentListRefreshNonce] = useState(0);
  const [refreshingPaymentIds, setRefreshingPaymentIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [paymentListRefreshErrors, setPaymentListRefreshErrors] = useState<
    Record<string, string>
  >({});
  const paymentRefreshRequestRef = useRef<string | null>(null);
  const paymentListRefreshRef = useRef(new Set<string>());
  const paymentListRefreshOrganizationRef = useRef<string | null>(null);
  const [billingInfo, setBillingInfo] = useState<BillingInfo>({
    name: "",
    taxId: "",
    cep: "",
    endereco: "",
    numero: "",
    complemento: "",
    bairro: "",
    cidade: "",
    uf: "",
    email: "",
    telefone: "",
  });

  const replaceBillingLocation = (
    page: BillingPage,
    paymentId?: string | null,
  ) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", "subscription");
    next.set("billing", page);

    if (page === "payments" && paymentId) {
      next.set("payment", paymentId);
    } else {
      next.delete("payment");
    }

    router.replace(`/settings?${next.toString()}`, { scroll: false });
  };

  const handleSelectPayment = (payment: PaymentHistoryItem) => {
    replaceBillingLocation("payments", payment.id);
  };

  const handleClosePayment = () => {
    replaceBillingLocation("payments");
  };

  const requestedPaymentId = searchParams.get("payment");
  const selectedPayment =
    activePage === "payments" && requestedPaymentId
      ? (history.find(
          (item) =>
            item.id === requestedPaymentId ||
            item.asaas_payment_id === requestedPaymentId,
        ) ?? null)
      : null;

  useEffect(() => {
    const paymentId = selectedPayment?.id;

    if (!requestedPaymentId) {
      paymentRefreshRequestRef.current = null;
      return;
    }

    if (!organizationId || !paymentId || data?.billingCheckoutReady !== true)
      return;

    const requestKey = `${organizationId}:${requestedPaymentId}`;
    if (paymentRefreshRequestRef.current === requestKey) return;
    paymentRefreshRequestRef.current = requestKey;

    let cancelled = false;
    setRefreshingPaymentId(paymentId);
    setPaymentRefreshError(null);
    setPaymentListRefreshErrors((current) => {
      if (!(paymentId in current)) return current;
      const next = { ...current };
      delete next[paymentId];
      return next;
    });

    void settingsAPI
      .refreshSubscriptionPayment(paymentId, organizationId)
      .then((payment) => {
        if (cancelled) return;
        setHistory((current) =>
          current.map((item) => (item.id === payment.id ? payment : item)),
        );
        setPaymentListRefreshErrors((current) => {
          if (!(payment.id in current)) return current;
          const next = { ...current };
          delete next[payment.id];
          return next;
        });
      })
      .catch((error) => {
        if (cancelled) return;
        const message = getErrorMessage(error);
        setPaymentRefreshError(message);
        setPaymentListRefreshErrors((current) => ({
          ...current,
          [paymentId]: message,
        }));
        paymentRefreshRequestRef.current = null;
      })
      .finally(() => {
        if (!cancelled) setRefreshingPaymentId(null);
      });

    return () => {
      cancelled = true;
    };
  }, [
    organizationId,
    paymentRefreshNonce,
    requestedPaymentId,
    selectedPayment?.id,
    data?.billingCheckoutReady,
  ]);

  useEffect(() => {
    if (
      !organizationId ||
      data?.billingCheckoutReady !== true ||
      activePage !== "payments" ||
      paymentListRefreshOrganizationRef.current !== organizationId
    )
      return;

    const statusesToRefresh = new Set([
      "",
      "CREATED",
      "PENDING",
      "OVERDUE",
      "DUNNING_REQUESTED",
      "DUNNING_RECEIVED",
      "CREDIT_CARD_CAPTURE_REFUSED",
      "AWAITING_RISK_ANALYSIS",
      "AUTHORIZED",
      "PROCESSING",
      "BANK_SLIP_CANCELLED",
    ]);
    const candidates = history.filter(
      (item) =>
        item.sync_state === "cached" &&
        statusesToRefresh.has((item.status || "").trim().toUpperCase()) &&
        !paymentListRefreshRef.current.has(item.id),
    );
    if (candidates.length === 0) return;

    let cursor = 0;
    const refreshedByID = new Map<string, PaymentHistoryItem>();
    const refreshErrors: Record<string, string> = {};

    for (const item of candidates) paymentListRefreshRef.current.add(item.id);

    const worker = async () => {
      while (cursor < candidates.length) {
        const candidate = candidates[cursor];
        cursor += 1;
        try {
          const refreshed = await settingsAPI.refreshSubscriptionPayment(
            candidate.id,
            organizationId,
          );
          refreshedByID.set(refreshed.id, refreshed);
        } catch (error) {
          refreshErrors[candidate.id] = getErrorMessage(error);
        }
      }
    };

    const runQueue = async () => {
      setRefreshingPaymentIds((current) => {
        const next = new Set(current);
        for (const item of candidates) next.add(item.id);
        return next;
      });

      const concurrency = Math.min(3, candidates.length);
      await Promise.all(Array.from({ length: concurrency }, () => worker()));
      if (paymentListRefreshOrganizationRef.current !== organizationId) return;

      if (refreshedByID.size > 0) {
        setHistory((current) =>
          current.map(
            (candidate) => refreshedByID.get(candidate.id) || candidate,
          ),
        );
      }
      if (Object.keys(refreshErrors).length > 0) {
        setPaymentListRefreshErrors((current) => ({
          ...current,
          ...refreshErrors,
        }));
      }
      setRefreshingPaymentIds((current) => {
        const next = new Set(current);
        for (const item of candidates) next.delete(item.id);
        return next;
      });
    };

    void runQueue().catch(() => {
      if (paymentListRefreshOrganizationRef.current === organizationId) {
        setRefreshingPaymentIds((current) => {
          const next = new Set(current);
          for (const item of candidates) next.delete(item.id);
          return next;
        });
      }
    });
  }, [
    activePage,
    data?.billingCheckoutReady,
    history,
    organizationId,
    paymentListRefreshNonce,
  ]);

  const retryFailedPaymentRefreshes = () => {
    if (data?.billingCheckoutReady !== true) return;
    const failedPaymentIds = Object.keys(paymentListRefreshErrors);
    for (const paymentId of failedPaymentIds) {
      paymentListRefreshRef.current.delete(paymentId);
    }
    setPaymentListRefreshErrors({});
    setPaymentListRefreshNonce((value) => value + 1);
  };

  const retrySelectedPaymentRefresh = () => {
    if (!selectedPayment || data?.billingCheckoutReady !== true) return;
    paymentRefreshRequestRef.current = null;
    paymentListRefreshRef.current.add(selectedPayment.id);
    setPaymentListRefreshErrors((current) => {
      if (!(selectedPayment.id in current)) return current;
      const next = { ...current };
      delete next[selectedPayment.id];
      return next;
    });
    setPaymentRefreshError(null);
    setPaymentRefreshNonce((value) => value + 1);
  };

  useEffect(() => {
    let isMounted = true;

    const fetchData = async () => {
      setLoading(true);
      setErrorMessage(null);

      if (!organizationId) {
        if (isMounted) setLoading(false);
        return;
      }

      try {
        const overview = await settingsAPI.getSubscription(organizationId);
        if (!isMounted) return;

        if (paymentListRefreshOrganizationRef.current !== organizationId) {
          paymentListRefreshOrganizationRef.current = organizationId;
          paymentListRefreshRef.current.clear();
          setPaymentListRefreshErrors({});
          setRefreshingPaymentIds(new Set());
        }

        setData({
          org: overview.org,
          plan: overview.plan,
          pendingPlan: overview.pendingPlan,
          planChange: overview.planChange,
          billingCheckoutReady: overview.billingCheckoutReady,
        });
        setAvailablePlans(overview.availablePlans || []);
        setHistory(overview.history || []);

        if (overview.org) {
          setBillingInfo({
            name: overview.org.razao_social || overview.org.name || "",
            taxId: overview.org.cnpj || "",
            cep: overview.org.cep || "",
            endereco: overview.org.endereco || "",
            numero: overview.org.numero || "",
            complemento: overview.org.complemento || "",
            bairro: overview.org.bairro || "",
            cidade: overview.org.cidade || "",
            uf: overview.org.uf || "",
            email: overview.org.email || "",
            telefone: overview.org.telefone || overview.org.whatsapp || "",
          });
        }
      } catch (error) {
        console.error(error);
        if (isMounted) setErrorMessage(getErrorMessage(error));
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    void fetchData();

    return () => {
      isMounted = false;
    };
  }, [organizationId]);

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    const outcome = url.searchParams.get("checkout");

    if (
      outcome === "success" ||
      outcome === "cancelled" ||
      outcome === "expired"
    ) {
      url.searchParams.delete("checkout");
      window.history.replaceState(
        {},
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
      const timer = window.setTimeout(() => setCheckoutNotice(outcome), 0);
      return () => window.clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    const pendingPlanId = data?.org?.pending_plan_id;

    // Managed changes keep pending_plan_id for visibility, but do not open a
    // checkout or poll as if a new payment were awaiting confirmation.
    if (
      !organizationId ||
      !pendingPlanId ||
      data?.planChange ||
      data?.billingCheckoutReady !== true
    )
      return;

    let cancelled = false;
    let checking = false;
    let attempts = 0;

    const checkCardConfirmation = async () => {
      if (checking || cancelled || attempts >= 24) return;
      checking = true;
      attempts += 1;

      try {
        const overview = await settingsAPI.getSubscription(organizationId);
        if (cancelled) return;

        setData({
          org: overview.org,
          plan: overview.plan,
          pendingPlan: overview.pendingPlan,
          planChange: overview.planChange,
          billingCheckoutReady: overview.billingCheckoutReady,
        });
        setAvailablePlans(overview.availablePlans || []);
        setHistory(overview.history || []);

        if (isBillingPlanPromotionConfirmed(overview.org, pendingPlanId)) {
          window.clearInterval(timer);
          toast.success("Pagamento confirmado. Assinatura ativa.");
          await refreshProfile();
        }
      } catch {
        // O webhook continua sendo a fonte de verdade. Falhas transitórias de consulta
        // não transformam um pagamento válido em falha.
      } finally {
        checking = false;
        if (attempts >= 24) window.clearInterval(timer);
      }
    };

    const timer = window.setInterval(() => {
      void checkCardConfirmation();
    }, 5_000);
    void checkCardConfirmation();

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    data?.org?.pending_plan_id,
    data?.org?.subscription_status,
    data?.planChange,
    data?.billingCheckoutReady,
    organizationId,
    refreshProfile,
  ]);

  const handleOpenCheckout = () => {
    if (data?.billingCheckoutReady !== true) {
      toast.error("Cobranças temporariamente indisponíveis.");
      return;
    }
    if (!organizationId) {
      toast.error("Organização não encontrada.");
      return;
    }

    setPaymentMethodDialogOpen(false);
    router.push(`/checkout/organizacao/${organizationId}`);
  };

  const autoFillFromUser = () => {
    if (!profile) return;
    setBillingInfo((current) => ({
      ...current,
      name: profile.name || current.name,
      taxId: profile.cpf || current.taxId,
      email: profile.email || current.email,
      telefone: profile.whatsapp || current.telefone,
    }));
    toast.info("Dados importados do seu perfil");
  };

  const autoFillFromOrg = () => {
    if (!organization) return;
    setBillingInfo({
      name: organization.razao_social || organization.name || "",
      taxId: organization.cnpj || "",
      cep: organization.cep || "",
      endereco: organization.endereco || "",
      numero: organization.numero || "",
      complemento: organization.complemento || "",
      bairro: organization.bairro || "",
      cidade: organization.cidade || "",
      uf: organization.uf || "",
      email: organization.email || "",
      telefone: organization.telefone || organization.whatsapp || "",
    });
    toast.info("Dados importados da empresa");
  };

  const handleSaveBilling = async () => {
    if (!organizationId) return;

    setSaving(true);
    try {
      const overview = await settingsAPI.updateSubscriptionBilling(
        {
          razao_social: billingInfo.name,
          cnpj: billingInfo.taxId,
          cep: billingInfo.cep,
          endereco: billingInfo.endereco,
          numero: billingInfo.numero,
          complemento: billingInfo.complemento,
          bairro: billingInfo.bairro,
          cidade: billingInfo.cidade,
          uf: billingInfo.uf,
          email: billingInfo.email,
          telefone: billingInfo.telefone,
        },
        organizationId,
      );

      setData({
        org: overview.org,
        plan: overview.plan,
        pendingPlan: overview.pendingPlan,
        planChange: overview.planChange,
        billingCheckoutReady: overview.billingCheckoutReady,
      });
      setAvailablePlans(overview.availablePlans || []);
      setHistory(overview.history || []);
      setFiscalDialogOpen(false);
      toast.success("Dados fiscais salvos.");
      await refreshProfile();
    } catch {
      toast.error("Erro ao salvar os dados fiscais");
    } finally {
      setSaving(false);
    }
  };

  const handleSelectPlan = async (selectedPlan: SubscriptionPlan) => {
    if (!organizationId || !data?.org) return;
    if (data.billingCheckoutReady !== true) {
      toast.error("Cobranças temporariamente indisponíveis.");
      return;
    }

    setChangingPlanId(selectedPlan.id);
    try {
      const overview = await settingsAPI.selectSubscriptionPlan(
        { plan_id: selectedPlan.id },
        organizationId,
      );

      setData({
        org: overview.org,
        plan: overview.plan,
        pendingPlan: overview.pendingPlan,
        planChange: overview.planChange,
        billingCheckoutReady: overview.billingCheckoutReady,
      });
      setAvailablePlans(overview.availablePlans || []);
      setHistory(overview.history || []);
      setPlanToConfirm(null);
      if (overview.planChange) {
        setPaymentMethodDialogOpen(false);
        toast.success("Troca agendada para a próxima cobrança.");
      } else {
        setPaymentMethodDialogOpen(true);
        toast.success("Plano selecionado. Agora escolha como pagar.");
      }
      await refreshProfile();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setChangingPlanId(null);
    }
  };

  if (loading) {
    return (
      <div className="w-full min-w-0 space-y-4">
        <Skeleton className="h-11 w-full rounded-[8px] sm:w-[520px]" />
        <Skeleton className="h-72 w-full rounded-[8px]" />
      </div>
    );
  }

  if (!organizationId) {
    return (
      <div className="app-card p-5 text-sm text-muted-foreground">
        Carregando dados da organização...
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="app-card flex flex-col gap-3 p-5 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>Não foi possível carregar os dados de pagamento agora.</span>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => window.location.reload()}
        >
          Tentar novamente
        </Button>
      </div>
    );
  }

  const org = data?.org;
  const plan = data?.plan;
  const pendingPlan = data?.pendingPlan;
  const planChange = data?.planChange;
  const status = (org?.subscription_status || "pending").trim().toLowerCase();
  const managedPlanChangeAvailable =
    org?.subscription_type?.trim().toLowerCase() === "paid" &&
    status === "active" &&
    org?.has_automatic_billing === true;
  const providerPlanChangeBlocked =
    org?.subscription_type?.trim().toLowerCase() === "paid" &&
    org?.has_automatic_billing === true &&
    status !== "active";
  const canManageExistingPaymentMethod =
    status === "active" && org?.has_automatic_billing === true;
  const checkoutAllowed =
    data?.billingCheckoutReady === true &&
    !planChange &&
    (Boolean(org?.pending_plan_id) ||
      status === "pending_payment" ||
      canManageExistingPaymentMethod);
  const nextBilling = org?.next_billing_date;
  const daysUntilBilling = nextBilling
    ? Math.max(
        0,
        Math.ceil(
          (new Date(`${nextBilling}T23:59:59`).getTime() - currentTime) /
            86_400_000,
        ),
      )
    : null;
  const billingProfileReady = checkoutBillingDetailsSchema.safeParse({
    name: billingInfo.name,
    email: billingInfo.email.trim() || profile?.email?.trim() || "",
    cpf_cnpj: billingInfo.taxId,
    phone:
      billingInfo.telefone ||
      profile?.whatsapp ||
      organization?.telefone ||
      organization?.whatsapp ||
      "",
    country: "BR",
    postal_code: billingInfo.cep,
    address: billingInfo.endereco,
    address_number: billingInfo.numero,
    address_complement: billingInfo.complemento,
    neighborhood: billingInfo.bairro,
    city: billingInfo.cidade,
    state: billingInfo.uf,
  }).success;

  const statusMeta = getSubscriptionStatus(status);
  const filteredHistory = filterPaymentHistory(
    history,
    historyQuery,
    paymentListRefreshErrors,
  );

  const attentionRequired = ["overdue", "past_due", "blocked"].includes(status);
  const planDisplayName = plan?.name || org?.plan_name || "Vimob CRM";
  const billingPeriodMonths = normalizeBillingPeriodMonths(
    org?.subscription_billing_period_months,
    plan?.billing_cycle,
  );
  const monthlyPlanValue = org?.subscription_value ?? plan?.price;
  const renewalValue =
    org?.subscription_renewal_value ??
    (monthlyPlanValue == null
      ? null
      : Number(monthlyPlanValue) * billingPeriodMonths);
  const billingPeriodLabel = formatBillingPeriod(billingPeriodMonths);
  const billingFrequencyLabel = formatBillingFrequency(billingPeriodMonths);
  const commercialPlans = [...availablePlans]
    .sort((left, right) => left.price - right.price)
    .slice(0, 3);
  const currentCommercialPlan =
    commercialPlans.find((availablePlan) => availablePlan.id === plan?.id) ||
    commercialPlans.find(
      (availablePlan) =>
        plan?.price != null &&
        Number(availablePlan.price) === Number(plan.price),
    );
  const commercialPlanDisplayName =
    currentCommercialPlan?.name || planDisplayName;

  const organizationName =
    organization?.name || data?.org?.name || "Organização";

  return (
    <div className="w-full min-w-0 space-y-5 overflow-x-hidden">
      <SubscriptionToolbar
        activePage={activePage}
        billingCheckoutReady={data?.billingCheckoutReady === true}
        billingProfileReady={billingProfileReady}
        commercialPlanDisplayName={commercialPlanDisplayName}
        hasPlan={Boolean(plan)}
        historyQuery={historyQuery}
        onHistoryQueryChange={setHistoryQuery}
        onNavigate={(page) => replaceBillingLocation(page)}
        onOpenFiscalDetails={() => setFiscalDialogOpen(true)}
        onOpenPaymentMethod={() => setPaymentMethodDialogOpen(true)}
      />

      <main className="min-w-0">
        {activePage === "subscriptions" && (
          <SubscriptionsPage
            attentionRequired={attentionRequired}
            billingFrequencyLabel={billingFrequencyLabel}
            checkoutNotice={checkoutNotice}
            nextBilling={nextBilling}
            organizationName={organizationName}
            org={org}
            pendingPlan={pendingPlan}
            planChange={planChange}
            planDisplayName={planDisplayName}
            renewalValue={renewalValue}
            status={statusMeta}
            onOpenDetails={() => setSubscriptionDetailsOpen(true)}
          />
        )}

        {activePage === "payments" && (
          <PaymentsPage
            filteredHistory={filteredHistory}
            historyLength={history.length}
            paymentRefreshErrors={paymentListRefreshErrors}
            planDisplayName={planDisplayName}
            onRetryFailedRefreshes={retryFailedPaymentRefreshes}
            onSelectPayment={handleSelectPayment}
          />
        )}

        {activePage === "methods" && (
          <PaymentMethodsPage
            hasAutomaticBilling={org?.has_automatic_billing === true}
            onOpenDetails={() => setMethodDetailsOpen(true)}
          />
        )}

        {activePage === "plans" && (
          <PlansPage
            billingCheckoutReady={data?.billingCheckoutReady === true}
            changingPlanId={changingPlanId}
            commercialPlans={commercialPlans}
            currentPlanId={currentCommercialPlan?.id}
            managedPlanChangeAvailable={managedPlanChangeAvailable}
            pendingPlan={pendingPlan}
            planChange={planChange}
            providerPlanChangeBlocked={providerPlanChangeBlocked}
            onConfirmPlan={setPlanToConfirm}
            onContinuePayment={() => setPaymentMethodDialogOpen(true)}
            onRetryProviderConfirmation={(selectedPlan) =>
              void handleSelectPlan(selectedPlan)
            }
          />
        )}
      </main>

      <SubscriptionDetailsDialog
        attentionRequired={attentionRequired}
        billingPeriodLabel={billingPeriodLabel}
        checkoutAllowed={checkoutAllowed}
        daysUntilBilling={daysUntilBilling}
        nextBilling={nextBilling}
        open={subscriptionDetailsOpen}
        organizationName={organizationName}
        org={org}
        pendingPlan={pendingPlan}
        plan={plan}
        planChange={planChange}
        planDisplayName={planDisplayName}
        renewalValue={renewalValue}
        status={statusMeta}
        onOpenChange={setSubscriptionDetailsOpen}
        onContinuePayment={() => {
          setSubscriptionDetailsOpen(false);
          setPaymentMethodDialogOpen(true);
        }}
        onOpenFiscalDetails={() => {
          setSubscriptionDetailsOpen(false);
          setFiscalDialogOpen(true);
        }}
        onOpenPlans={() => {
          setSubscriptionDetailsOpen(false);
          replaceBillingLocation("plans");
        }}
      />

      <PaymentDetailsDialog
        checkoutReady={data?.billingCheckoutReady === true}
        payment={selectedPayment}
        paymentRefreshErrors={paymentListRefreshErrors}
        refreshError={paymentRefreshError}
        refreshingPaymentId={refreshingPaymentId}
        refreshingPaymentIds={refreshingPaymentIds}
        onClose={handleClosePayment}
        onRetry={retrySelectedPaymentRefresh}
      />

      <PaymentMethodDialogs
        billingCheckoutReady={data?.billingCheckoutReady === true}
        billingProfileReady={billingProfileReady}
        canManageExistingPaymentMethod={canManageExistingPaymentMethod}
        checkoutAllowed={checkoutAllowed}
        methodDetailsOpen={methodDetailsOpen}
        paymentMethodDialogOpen={paymentMethodDialogOpen}
        onMethodDetailsOpenChange={setMethodDetailsOpen}
        onPaymentMethodDialogOpenChange={setPaymentMethodDialogOpen}
        onOpenCheckout={handleOpenCheckout}
        onOpenFiscalDetails={() => {
          setPaymentMethodDialogOpen(false);
          setFiscalDialogOpen(true);
        }}
        onOpenPlans={() => {
          setPaymentMethodDialogOpen(false);
          replaceBillingLocation("plans");
        }}
      />

      <FiscalDetailsDialog
        billingInfo={billingInfo}
        open={fiscalDialogOpen}
        saving={saving}
        onAutoFillFromOrganization={autoFillFromOrg}
        onAutoFillFromUser={autoFillFromUser}
        onBillingInfoChange={setBillingInfo}
        onOpenChange={setFiscalDialogOpen}
        onSave={() => void handleSaveBilling()}
      />

      <PlanConfirmationDialog
        changingPlanId={changingPlanId}
        managedPlanChangeAvailable={managedPlanChangeAvailable}
        plan={planToConfirm}
        onConfirm={(selectedPlan) => void handleSelectPlan(selectedPlan)}
        onOpenChange={(open) => {
          if (!open && changingPlanId) return;
          if (!open) setPlanToConfirm(null);
        }}
      />
    </div>
  );
}
