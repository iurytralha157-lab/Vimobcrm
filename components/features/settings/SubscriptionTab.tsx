import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Check,
  ChevronRight,
  Copy,
  CreditCard,
  Loader2,
  LockKeyhole,
  MessageSquareText,
  Package,
  ReceiptText,
  RefreshCcw,
  Search,
  ShieldCheck,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { getSystemModuleLabel } from "@/config/constants";
import { useAuth } from "@/contexts/AuthContext";
import {
  settingsAPI,
  type BillingPlanChange,
  type PaymentHistoryItem,
  type SubscriptionOrganization,
  type SubscriptionPlan,
} from "@/lib/api";
import { isBillingPlanPromotionConfirmed } from "@/lib/billing-access";
import {
  isBillingPaymentCheckoutActionable,
  resolveBillingPaymentStatus,
  shouldTreatHistoryStatusAsCurrent,
} from "@/lib/billing/checkout-ui-state";
import { cn } from "@/lib/utils";
import { checkoutBillingDetailsSchema } from "@/lib/validation";

type SubscriptionData = {
  org: SubscriptionOrganization | null;
  plan: SubscriptionPlan | null;
  pendingPlan: SubscriptionPlan | null;
  planChange: BillingPlanChange | null;
  billingCheckoutReady: boolean;
};
type BillingPage = "subscriptions" | "payments" | "methods" | "plans";
type SubscriptionStatusMeta = {
  label: string;
  variant: NonNullable<BadgeProps["variant"]>;
};

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  return String(error);
};

function normalizeBillingPeriodMonths(
  value: number | null | undefined,
  billingCycle?: string | null,
): 1 | 6 | 12 {
  if (value === 6 || value === 12) return value;
  if (value === 1) return 1;

  const normalizedCycle = billingCycle?.trim().toLowerCase();
  return ["yearly", "annual", "anual"].includes(normalizedCycle || "") ? 12 : 1;
}

function formatBillingPeriod(months: 1 | 6 | 12) {
  if (months === 1) return "1 mês";
  return `${months} meses`;
}

function formatBillingFrequency(months: 1 | 6 | 12) {
  return months === 1 ? "Mensal" : `A cada ${formatBillingPeriod(months)}`;
}

function formatPaymentMethod(billingType: string | null | undefined) {
  if (billingType === "CREDIT_CARD") return "Cartão";
  if (billingType === "PIX") return "Pix";
  if (billingType === "BOLETO") return "Boleto";
  return "—";
}

function hasCancelledBankSlipRegistration(payment: PaymentHistoryItem) {
  return payment.bank_slip_registration_cancelled;
}

const billingPages = new Set<BillingPage>([
  "subscriptions",
  "payments",
  "methods",
  "plans",
]);

function getBillingPage(value: string | null): BillingPage {
  return value && billingPages.has(value as BillingPage)
    ? (value as BillingPage)
    : "payments";
}

export function SubscriptionTab() {
  const { organization } = useAuth();

  return <SubscriptionTabContent key={organization?.id ?? "sem-organizacao"} />;
}

function SubscriptionTabContent() {
  const { organization, profile, refreshProfile } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<SubscriptionData | null>(null);
  const [history, setHistory] = useState<PaymentHistoryItem[]>([]);
  const [availablePlans, setAvailablePlans] = useState<SubscriptionPlan[]>([]);
  const [changingPlanId, setChangingPlanId] = useState<string | null>(null);
  const [checkoutNotice, setCheckoutNotice] = useState<
    "success" | "cancelled" | "expired" | null
  >(null);
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
  const [billingInfo, setBillingInfo] = useState({
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
    const organizationId = organization?.id;
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
    organization?.id,
    paymentRefreshNonce,
    requestedPaymentId,
    selectedPayment?.id,
    data?.billingCheckoutReady,
  ]);

  useEffect(() => {
    const organizationId = organization?.id;
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
    organization?.id,
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

      if (!organization?.id) {
        if (isMounted) setLoading(false);
        return;
      }

      try {
        const overview = await settingsAPI.getSubscription(organization.id);
        if (!isMounted) return;

        if (paymentListRefreshOrganizationRef.current !== organization.id) {
          paymentListRefreshOrganizationRef.current = organization.id;
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
  }, [organization?.id]);

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
    const organizationId = organization?.id;
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
    organization?.id,
    refreshProfile,
  ]);

  const handleOpenCheckout = () => {
    if (data?.billingCheckoutReady !== true) {
      toast.error("Cobranças temporariamente indisponíveis.");
      return;
    }
    if (!organization?.id) {
      toast.error("Organização não encontrada.");
      return;
    }

    setPaymentMethodDialogOpen(false);
    router.push(`/checkout/organizacao/${organization.id}`);
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
    if (!organization?.id) return;

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
        organization.id,
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
    if (!organization?.id || !data?.org) return;
    if (data.billingCheckoutReady !== true) {
      toast.error("Cobranças temporariamente indisponíveis.");
      return;
    }

    setChangingPlanId(selectedPlan.id);
    try {
      const overview = await settingsAPI.selectSubscriptionPlan(
        { plan_id: selectedPlan.id },
        organization.id,
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
        toast.success("Troca agendada para a prÃ³xima cobranÃ§a.");
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

  if (!organization?.id) {
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

  const formatMoney = (value: number | null | undefined) =>
    Number(value || 0).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
  const formatDateValue = (
    value: string | null | undefined,
    pattern = "dd/MM/yyyy",
  ) =>
    value
      ? format(new Date(`${value.slice(0, 10)}T12:00:00`), pattern, {
          locale: ptBR,
        })
      : "Não definido";
  const shortReference = (value: string | null | undefined) =>
    value && value.length > 18
      ? `${value.slice(0, 10)}…${value.slice(-6)}`
      : value || "Não definida";

  const subscriptionStatuses: Record<string, SubscriptionStatusMeta> = {
    active: { label: "Ativa", variant: "default" },
    trial: { label: "Período de teste", variant: "secondary" },
    pending: { label: "Pendente", variant: "destructive" },
    pending_payment: { label: "Pagamento pendente", variant: "destructive" },
    overdue: { label: "Em atraso", variant: "destructive" },
    past_due: { label: "Em atraso", variant: "destructive" },
    suspended: { label: "Suspensa", variant: "destructive" },
    blocked: { label: "Bloqueada", variant: "destructive" },
    cancelled: { label: "Cancelada", variant: "outline" },
    canceled: { label: "Cancelada", variant: "outline" },
    expired: { label: "Expirada", variant: "destructive" },
  };
  const statusMeta = subscriptionStatuses[status] || {
    label: status,
    variant: "outline" as const,
  };
  const paidStatuses = new Set([
    "RECEIVED",
    "CONFIRMED",
    "RECEIVED_IN_CASH",
    "REFUND_DENIED",
  ]);
  const paymentStatus = (
    value: string | null,
    syncState?: PaymentHistoryItem["sync_state"],
  ) => {
    if (syncState && !shouldTreatHistoryStatusAsCurrent({ syncState })) {
      if (syncState === "cached") {
        return { label: "Conferindo", variant: "secondary" as const };
      }
      return { label: "Não confirmado", variant: "secondary" as const };
    }
    const normalized = (value || "").trim().toUpperCase();
    if (paidStatuses.has(normalized))
      return { label: "Pago", variant: "default" as const };
    if (
      ["AWAITING_RISK_ANALYSIS", "AUTHORIZED", "PROCESSING"].includes(
        normalized,
      )
    ) {
      return { label: "Processando", variant: "secondary" as const };
    }
    if (
      ["OVERDUE", "DUNNING_REQUESTED", "DUNNING_RECEIVED"].includes(normalized)
    ) {
      return { label: "Em atraso", variant: "destructive" as const };
    }
    if (
      ["CREDIT_CARD_CAPTURE_REFUSED", "REPROVED_BY_RISK_ANALYSIS"].includes(
        normalized,
      )
    ) {
      return { label: "Recusado", variant: "destructive" as const };
    }
    if (["REFUND_IN_PROGRESS", "REFUND_REQUESTED"].includes(normalized)) {
      return { label: "Estorno em andamento", variant: "secondary" as const };
    }
    if (
      ["REFUNDED", "PARTIALLY_REFUNDED", "RECEIVED_IN_CASH_UNDONE"].includes(
        normalized,
      )
    ) {
      return { label: "Estornado", variant: "secondary" as const };
    }
    if (
      [
        "CHARGEBACK",
        "CHARGEBACK_REQUESTED",
        "CHARGEBACK_DISPUTE",
        "AWAITING_CHARGEBACK_REVERSAL",
      ].includes(normalized)
    ) {
      return { label: "Em contestação", variant: "destructive" as const };
    }
    if (normalized === "BANK_SLIP_CANCELLED") {
      return { label: "Boleto expirado", variant: "secondary" as const };
    }
    if (["CANCELED", "CANCELLED", "DELETED"].includes(normalized)) {
      return { label: "Cancelado", variant: "outline" as const };
    }
    if (["CREATED", "PENDING"].includes(normalized)) {
      return { label: "Pendente", variant: "outline" as const };
    }
    return { label: "Em verificação", variant: "secondary" as const };
  };
  const getPaymentStatus = (payment: PaymentHistoryItem) => {
    const refreshFailed = Boolean(paymentListRefreshErrors[payment.id]);
    const syncState = refreshFailed
      ? "provider_unavailable"
      : payment.sync_state;
    if (!shouldTreatHistoryStatusAsCurrent({ syncState, refreshFailed })) {
      return paymentStatus(payment.status, syncState);
    }
    if (hasCancelledBankSlipRegistration(payment)) {
      return { label: "Boleto expirado", variant: "secondary" as const };
    }
    return paymentStatus(payment.status, syncState);
  };
  const statusBadgeClassName = (variant: SubscriptionStatusMeta["variant"]) =>
    cn(
      "rounded-[6px] border-transparent font-light shadow-none",
      variant === "default" &&
        "bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300",
      variant === "destructive" &&
        "bg-destructive/15 text-destructive hover:bg-destructive/25",
      (variant === "outline" || variant === "secondary") &&
        "bg-[var(--app-surface-hover)] text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-hover)]",
    );

  const normalizedHistoryQuery = historyQuery.trim().toLocaleLowerCase("pt-BR");
  const paymentListRefreshErrorCount = Object.keys(
    paymentListRefreshErrors,
  ).length;
  const filteredHistory = normalizedHistoryQuery
    ? history.filter((item) =>
        [
          item.asaas_payment_id,
          item.asaas_subscription_id,
          item.billing_type,
          item.status,
          getPaymentStatus(item).label,
          formatMoney(item.value),
        ].some((value) =>
          value?.toLocaleLowerCase("pt-BR").includes(normalizedHistoryQuery),
        ),
      )
    : history;

  const billingNavigation: Array<{
    id: BillingPage;
    label: string;
    icon: LucideIcon;
  }> = [
    { id: "payments", label: "Histórico de pagamentos", icon: ReceiptText },
    { id: "subscriptions", label: "Assinaturas", icon: RefreshCcw },
    { id: "methods", label: "Formas de pagamento", icon: CreditCard },
    { id: "plans", label: "Planos", icon: Package },
  ];

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

  return (
    <div className="w-full min-w-0 space-y-5 overflow-x-hidden">
      {data?.billingCheckoutReady !== true && (
        <div
          className="flex items-start gap-3 rounded-[8px] bg-amber-500/10 p-4 text-[12px] font-light text-amber-800 dark:text-amber-300"
          role="status"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Cobranças temporariamente indisponíveis</p>
            <p className="mt-1 leading-5">
              O histórico e os comprovantes continuam disponíveis. Novos
              pagamentos, trocas de plano e confirmações ficam bloqueados até a
              atualização segura do ambiente financeiro.
            </p>
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-row items-center gap-2">
        <div
          data-collapse="standard"
          className="app-responsive-tab-list min-w-0 flex-1"
        >
          <nav
            data-responsive-tab-scroll
            aria-label="Navegação de faturamento"
            className="scrollbar-hidden flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-[8px] bg-[var(--app-surface-solid)] p-1"
          >
            {billingNavigation.map((item) => {
              const isActive = activePage === item.id;
              const Icon = item.icon;

              return (
                <button
                  key={item.id}
                  type="button"
                  data-responsive-tab
                  aria-label={item.label}
                  aria-pressed={isActive}
                  title={item.label}
                  onClick={() => replaceBillingLocation(item.id)}
                  className={cn(
                    "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[6px] px-3 text-xs font-light transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                    isActive
                      ? "bg-[var(--app-surface-hover)] text-[var(--app-text-primary)]"
                      : "text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-soft)] hover:text-[var(--app-text-primary)]",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="app-responsive-tab-label">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {activePage === "payments" && (
          <div className="ml-auto flex w-[min(420px,55%)] min-w-0 shrink-0 justify-end">
            <div className="relative w-full max-w-[420px]">
              <Label
                htmlFor="billing-payment-history-search"
                className="sr-only"
              >
                Pesquisar no histórico de pagamentos
              </Label>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="billing-payment-history-search"
                value={historyQuery}
                onChange={(event) => setHistoryQuery(event.target.value)}
                placeholder="Pesquisar por fatura, status ou método"
                className="!h-9 rounded-[6px] border-0 bg-[var(--app-surface-solid)] !py-0 pl-9 !text-[12px] font-light shadow-none placeholder:text-[var(--app-text-tertiary)] focus-visible:ring-1 focus-visible:ring-primary/30"
              />
            </div>
          </div>
        )}

        {activePage === "methods" && (
          <div className="ml-auto flex min-w-0 shrink-0 flex-wrap justify-end gap-2">
            {!billingProfileReady && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFiscalDialogOpen(true)}
              >
                Completar dados fiscais
              </Button>
            )}
            <Button
              size="sm"
              className="rounded-[6px] bg-primary/50 font-light text-primary-foreground shadow-none hover:bg-primary"
              disabled={data?.billingCheckoutReady !== true}
              onClick={() => setPaymentMethodDialogOpen(true)}
            >
              Adicionar forma de pagamento
            </Button>
          </div>
        )}

        {activePage === "plans" && plan && (
          <Badge
            variant="secondary"
            className="ml-auto w-fit shrink-0 rounded-[6px] px-3 py-1 font-light"
          >
            Plano atual: {commercialPlanDisplayName}
          </Badge>
        )}
      </div>

      <main className="min-w-0">
        {activePage === "subscriptions" && (
          <section aria-label="Assinaturas" className="space-y-5">
            {(checkoutNotice ||
              pendingPlan ||
              planChange ||
              attentionRequired) && (
              <div
                className={cn(
                  "flex items-start gap-3 rounded-[8px] border-0 p-3.5",
                  attentionRequired ? "bg-destructive/5" : "bg-primary/10",
                )}
              >
                {checkoutNotice === "success" ? (
                  <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {checkoutNotice === "success"
                      ? "Pagamento enviado para confirmação"
                      : checkoutNotice === "cancelled"
                        ? "Checkout cancelado"
                        : checkoutNotice === "expired"
                          ? "O checkout expirou"
                          : attentionRequired
                            ? "Assinatura precisa de atenção"
                            : planChange
                              ? `${pendingPlan?.name || org?.pending_plan_name || "Novo plano"} com troca agendada`
                              : `${pendingPlan?.name || org?.pending_plan_name || "Novo plano"} aguardando pagamento`}
                  </p>
                  <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                    {checkoutNotice === "success"
                      ? "A confirmação acontece automaticamente."
                      : checkoutNotice === "cancelled"
                        ? "Nenhuma nova assinatura foi ativada."
                        : checkoutNotice === "expired"
                          ? "Gere um novo checkout para concluir a contratação."
                          : attentionRequired
                            ? "Abra os detalhes para regularizar a cobrança."
                            : planChange?.status === "provider_updating"
                              ? "Estamos confirmando a alteração na assinatura atual, sem criar outra recorrência."
                              : planChange
                                ? `O plano atual continua ativo até a cobrança de ${formatDateValue(planChange.effective_on)}.`
                                : "O plano atual continua preservado até a confirmação financeira."}
                  </p>
                </div>
              </div>
            )}

            <div className="overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="bg-[var(--app-surface-soft)] text-xs text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">Assinatura</th>
                      <th className="px-4 py-3 font-medium">
                        Próxima cobrança
                      </th>
                      <th className="px-4 py-3 font-medium">Renovação</th>
                      <th className="px-4 py-3 font-medium">Valor</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="w-12 px-4 py-3">
                        <span className="sr-only">Detalhes</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t border-[var(--app-border)]">
                      <td className="px-4 py-4">
                        <p className="font-medium text-foreground">
                          {planDisplayName}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {organization.name}
                        </p>
                      </td>
                      <td className="px-4 py-4">
                        {formatDateValue(nextBilling)}
                      </td>
                      <td className="px-4 py-4">
                        <p>
                          {org?.has_automatic_billing ? "Automática" : "Manual"}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {billingFrequencyLabel}
                        </p>
                      </td>
                      <td className="px-4 py-4 font-medium">
                        <p>{formatMoney(renewalValue)}</p>
                        <p className="mt-0.5 text-xs font-normal text-muted-foreground">
                          Total do período
                        </p>
                      </td>
                      <td className="px-4 py-4">
                        <Badge
                          variant={statusMeta.variant}
                          className={statusBadgeClassName(statusMeta.variant)}
                        >
                          {statusMeta.label}
                        </Badge>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Ver detalhes da assinatura"
                          onClick={() => setSubscriptionDetailsOpen(true)}
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <button
                type="button"
                onClick={() => setSubscriptionDetailsOpen(true)}
                className="flex w-full items-center justify-between gap-4 p-4 text-left md:hidden"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{planDisplayName}</p>
                    <Badge
                      variant={statusMeta.variant}
                      className={statusBadgeClassName(statusMeta.variant)}
                    >
                      {statusMeta.label}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatMoney(renewalValue)} ·{" "}
                    {billingFrequencyLabel.toLocaleLowerCase("pt-BR")} · próxima
                    cobrança {formatDateValue(nextBilling)}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            </div>

            <p className="text-xs text-muted-foreground">
              1 assinatura vinculada a esta organização
            </p>
          </section>
        )}

        {activePage === "payments" && (
          <section aria-label="Histórico de pagamentos" className="space-y-5">
            {paymentListRefreshErrorCount > 0 ? (
              <div
                className="flex flex-col gap-3 rounded-[8px] bg-amber-500/10 p-3 text-[12px] font-light text-amber-800 dark:text-amber-300 sm:flex-row sm:items-center sm:justify-between"
                role="status"
              >
                <span>
                  {paymentListRefreshErrorCount === 1
                    ? "Não foi possível confirmar 1 pagamento. O status permanece bloqueado até uma nova consulta."
                    : `Não foi possível confirmar ${paymentListRefreshErrorCount} pagamentos. Os status permanecem bloqueados até uma nova consulta.`}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={retryFailedPaymentRefreshes}
                  className="shrink-0 text-current hover:bg-amber-500/10"
                >
                  Tentar novamente
                </Button>
              </div>
            ) : null}
            <div className="min-w-0 max-w-full overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
              <div className="scrollbar-thin hidden max-w-full overflow-x-auto md:block">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="bg-[var(--app-surface-soft)] text-xs text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">ID do pagamento</th>
                      <th className="px-4 py-3 font-medium">Serviço</th>
                      <th className="px-4 py-3 font-medium">
                        Pago / vencimento
                      </th>
                      <th className="px-4 py-3 font-medium">Método</th>
                      <th className="px-4 py-3 font-medium">Valor</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="w-12 px-4 py-3">
                        <span className="sr-only">Detalhes</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--app-border)]">
                    {filteredHistory.map((item) => {
                      const itemStatus = getPaymentStatus(item);

                      return (
                        <tr
                          key={item.id}
                          className="transition-colors hover:bg-[var(--app-surface-hover)]"
                        >
                          <td className="px-4 py-4 font-mono text-xs">
                            {shortReference(item.asaas_payment_id)}
                          </td>
                          <td className="px-4 py-4">
                            <p className="font-medium">Assinatura Vimob</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {item.plan_name || planDisplayName}
                            </p>
                          </td>
                          <td className="px-4 py-4">
                            {formatDateValue(
                              item.payment_date || item.due_date,
                            )}
                          </td>
                          <td className="px-4 py-4">
                            {formatPaymentMethod(item.billing_type)}
                          </td>
                          <td className="px-4 py-4 font-medium">
                            {formatMoney(item.value)}
                          </td>
                          <td className="px-4 py-4">
                            <Badge
                              variant={itemStatus.variant}
                              className={statusBadgeClassName(
                                itemStatus.variant,
                              )}
                            >
                              {itemStatus.label}
                            </Badge>
                          </td>
                          <td className="px-4 py-4 text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Ver detalhes do pagamento ${item.asaas_payment_id}`}
                              onClick={() => handleSelectPayment(item)}
                            >
                              <ChevronRight className="h-4 w-4" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                    {filteredHistory.length === 0 && (
                      <tr>
                        <td
                          colSpan={7}
                          className="px-4 py-12 text-center text-muted-foreground"
                        >
                          {history.length === 0
                            ? "Nenhum pagamento registrado para esta organização."
                            : "Nenhum pagamento corresponde à pesquisa."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="divide-y divide-[var(--app-border)] md:hidden">
                {filteredHistory.map((item) => {
                  const itemStatus = getPaymentStatus(item);

                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-label={`Ver detalhes do pagamento ${item.asaas_payment_id}`}
                      onClick={() => handleSelectPayment(item)}
                      className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-[var(--app-surface-hover)]"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-light text-[var(--app-text-primary)]">
                            Assinatura Vimob
                          </p>
                          <p className="mt-0.5 text-[11px] font-light text-[var(--app-text-tertiary)]">
                            {item.plan_name || planDisplayName}
                          </p>
                          <Badge
                            variant={itemStatus.variant}
                            className={statusBadgeClassName(itemStatus.variant)}
                          >
                            {itemStatus.label}
                          </Badge>
                        </div>
                        <p className="mt-1 truncate text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
                          {shortReference(item.asaas_payment_id)} ·{" "}
                          {formatPaymentMethod(item.billing_type)} ·{" "}
                          {formatDateValue(item.payment_date || item.due_date)}
                        </p>
                      </div>
                      <p className="shrink-0 text-sm font-light text-[var(--app-text-primary)]">
                        {formatMoney(item.value)}
                      </p>
                      <ChevronRight className="h-4 w-4 shrink-0 text-[var(--app-text-tertiary)]" />
                    </button>
                  );
                })}

                {filteredHistory.length === 0 && (
                  <div className="px-4 py-12 text-center text-[12px] font-light text-[var(--app-text-tertiary)]">
                    {history.length === 0
                      ? "Nenhum pagamento registrado para esta organização."
                      : "Nenhum pagamento corresponde à pesquisa."}
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {activePage === "methods" && (
          <section aria-label="Formas de pagamento" className="space-y-5">
            <div className="overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
              <div className="border-b border-[var(--app-border)] bg-[var(--app-surface-soft)] px-4 py-3">
                <p className="text-sm font-medium">
                  Lista de formas de pagamento
                </p>
              </div>

              {org?.has_automatic_billing ? (
                <button
                  type="button"
                  onClick={() => setMethodDetailsOpen(true)}
                  className="flex w-full items-center gap-4 p-4 text-left transition-colors hover:bg-[var(--app-surface-hover)]"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-primary/10 text-primary">
                    <CreditCard className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">Cartão recorrente</p>
                      <Badge variant="secondary">Padrão</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Gerenciado com segurança pelo provedor de pagamento
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              ) : (
                <div className="px-4 py-12 text-center">
                  <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-[var(--app-surface-soft)] text-muted-foreground">
                    <CreditCard className="h-5 w-5" />
                  </div>
                  <p className="mt-3 text-sm font-medium">
                    Nenhuma forma salva
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Adicione uma forma de pagamento somente quando precisar.
                  </p>
                </div>
              )}
            </div>
          </section>
        )}

        {activePage === "plans" && (
          <section aria-label="Planos" className="space-y-6">
            <div className="grid items-stretch gap-4 lg:grid-cols-3">
              {commercialPlans.map((availablePlan, index) => {
                const isCurrent =
                  availablePlan.id === currentCommercialPlan?.id;
                const isPending = availablePlan.id === pendingPlan?.id;
                const isScheduledChange =
                  availablePlan.id === planChange?.target_plan_id;
                const canRetryProviderConfirmation =
                  isScheduledChange &&
                  planChange?.status === "provider_updating";
                const isRecommended = index === 1;
                const modules = (availablePlan.modules || []).slice(0, 4);
                const planFeatures = [
                  `Até ${availablePlan.max_users ?? "—"} usuários`,
                  ...(Number(availablePlan.max_leads || 0) > 0
                    ? [
                        `Até ${Number(availablePlan.max_leads).toLocaleString("pt-BR")} leads`,
                      ]
                    : []),
                  `Até ${availablePlan.max_whatsapp_sessions ?? "—"} WhatsApp`,
                  ...modules.map((moduleName) =>
                    getSystemModuleLabel(moduleName),
                  ),
                ];

                return (
                  <article
                    key={availablePlan.id}
                    className="relative flex flex-col overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-5 shadow-none"
                  >
                    <div className="flex min-h-7 items-start justify-between gap-2">
                      {isCurrent ? (
                        <Badge>Seu plano atual</Badge>
                      ) : isPending ? (
                        <Badge variant="secondary">
                          {canRetryProviderConfirmation
                            ? "Confirmando troca"
                            : isScheduledChange
                              ? "Troca agendada"
                              : "Aguardando pagamento"}
                        </Badge>
                      ) : isRecommended ? (
                        <Badge className="bg-primary/10 text-primary hover:bg-primary/10">
                          Recomendado
                        </Badge>
                      ) : (
                        <span />
                      )}
                    </div>

                    <div className="mt-3">
                      <h4 className="text-[14px] font-normal">
                        {availablePlan.name}
                      </h4>
                      <p className="mt-2 min-h-12 text-[12px] font-light leading-[18px] text-muted-foreground">
                        {availablePlan.description ||
                          "Plano Vimob para gestão imobiliária."}
                      </p>
                    </div>

                    <div className="mt-5">
                      <div className="flex items-end gap-1">
                        <span className="text-[22px] font-normal tabular-nums">
                          {formatMoney(availablePlan.price)}
                        </span>
                        <span className="pb-1 text-xs text-muted-foreground">
                          /
                          {availablePlan.billing_cycle === "yearly"
                            ? "ano"
                            : "mês"}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Cobrança recorrente, sem taxa de adesão
                      </p>
                    </div>

                    <Button
                      variant={isCurrent ? "secondary" : "default"}
                      className={cn(
                        "mt-5 w-full rounded-[6px] font-light shadow-none",
                        !isCurrent &&
                          "bg-primary/50 text-primary-foreground hover:bg-primary",
                      )}
                      disabled={
                        data?.billingCheckoutReady !== true ||
                        isCurrent ||
                        (providerPlanChangeBlocked && !isPending) ||
                        (Boolean(planChange) &&
                          !canRetryProviderConfirmation) ||
                        changingPlanId === availablePlan.id
                      }
                      onClick={() => {
                        if (isPending) {
                          if (canRetryProviderConfirmation) {
                            void handleSelectPlan(availablePlan);
                            return;
                          }
                          if (isScheduledChange) return;
                          setPaymentMethodDialogOpen(true);
                          return;
                        }
                        setPlanToConfirm(availablePlan);
                      }}
                    >
                      {changingPlanId === availablePlan.id && (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      )}
                      {isCurrent ? (
                        "Plano atual"
                      ) : providerPlanChangeBlocked && !isPending ? (
                        "Regularize a assinatura"
                      ) : isPending ? (
                        isScheduledChange ? (
                          canRetryProviderConfirmation ? (
                            "Tentar confirmar"
                          ) : (
                            "Troca agendada"
                          )
                        ) : (
                          "Continuar pagamento"
                        )
                      ) : managedPlanChangeAvailable ? (
                        <span className="inline-flex items-center">
                          Agendar troca <ArrowRight className="ml-2 h-4 w-4" />
                        </span>
                      ) : (
                        <span className="inline-flex items-center">
                          Escolher plano <ArrowRight className="ml-2 h-4 w-4" />
                        </span>
                      )}
                    </Button>

                    <div className="my-5 h-px bg-[var(--app-border)]" />

                    <p className="text-[12px] font-light text-muted-foreground">
                      Incluído no plano
                    </p>
                    <ul className="mt-3 space-y-2.5">
                      {planFeatures.map((feature) => (
                        <li key={feature} className="flex items-start gap-2 text-[12px] font-light">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </article>
                );
              })}

              {commercialPlans.length === 0 && (
                <div className="col-span-full rounded-[8px] border-0 bg-[var(--app-surface-solid)] py-14 text-center text-sm text-muted-foreground shadow-none">
                  Nenhum plano comercial disponível agora.
                </div>
              )}
            </div>

            {managedPlanChangeAvailable && (
              <div className="rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-4 text-sm shadow-none">
                <p className="font-medium">
                  Sua assinatura já possui recorrência ativa
                </p>
                <p className="mt-1 text-muted-foreground">
                  A troca altera a assinatura existente e entra em vigor na
                  próxima cobrança. Nenhum novo checkout é aberto.
                </p>
              </div>
            )}

            <p className="text-center text-xs text-muted-foreground">
              Cartão de crédito é recomendado para manter a renovação
              automática. Pix permanece disponível como pagamento manual.
            </p>
          </section>
        )}
      </main>

      <Dialog
        open={subscriptionDetailsOpen}
        onOpenChange={setSubscriptionDetailsOpen}
      >
        <DialogContent className="max-h-[90vh] w-[calc(100vw-32px)] overflow-y-auto rounded-[8px] border-0 bg-[var(--app-surface-solid)] text-[12px] font-light shadow-none sm:max-w-xl">
          <DialogHeader className="pr-8">
            <DialogTitle className="text-[14px] font-normal">
              Detalhes da assinatura
            </DialogTitle>
            <DialogDescription>
              {planDisplayName} · {organization.name}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-6 space-y-5">
            {(attentionRequired || checkoutAllowed || planChange) && (
              <div
                className={cn(
                  "rounded-[8px] border p-4",
                  attentionRequired
                    ? "border-destructive/25 bg-destructive/5"
                    : "border-primary/20 bg-primary/5",
                )}
              >
                <p className="font-medium">
                  {attentionRequired
                    ? "A assinatura precisa de atenção"
                    : planChange
                      ? "Troca de plano agendada"
                      : "Existe um plano aguardando pagamento"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {attentionRequired
                    ? "Regularize a cobrança para manter o acesso operacional."
                    : planChange
                      ? `${pendingPlan?.name || org?.pending_plan_name || "Novo plano"} entra em vigor na próxima cobrança elegível.`
                      : `${pendingPlan?.name || org?.pending_plan_name || "Novo plano"} será ativado após a confirmação financeira.`}
                </p>
                {checkoutAllowed && (
                  <Button
                    size="sm"
                    className="mt-3"
                    onClick={() => {
                      setSubscriptionDetailsOpen(false);
                      setPaymentMethodDialogOpen(true);
                    }}
                  >
                    Continuar pagamento
                  </Button>
                )}
              </div>
            )}

            <div className="divide-y divide-[var(--app-border)] rounded-[8px] border border-[var(--app-border)]">
              <DetailRow label="Status">
                <Badge
                  variant={statusMeta.variant}
                  className={statusBadgeClassName(statusMeta.variant)}
                >
                  {statusMeta.label}
                </Badge>
              </DetailRow>
              <DetailRow label="Próxima cobrança">
                <span>{formatDateValue(nextBilling)}</span>
              </DetailRow>
              <DetailRow label="Período contratado">
                <span>{billingPeriodLabel}</span>
              </DetailRow>
              <DetailRow label="Valor da renovação">
                <span className="font-medium">{formatMoney(renewalValue)}</span>
              </DetailRow>
              <DetailRow label="Renovação">
                <span>
                  {org?.has_automatic_billing ? "Automática" : "Manual"}
                </span>
              </DetailRow>
              <DetailRow label="Tempo restante">
                <span>
                  {daysUntilBilling === null
                    ? "Sem vencimento definido"
                    : `${daysUntilBilling} dias`}
                </span>
              </DetailRow>
              <DetailRow label="ID da assinatura">
                <span className="font-mono text-xs">
                  {shortReference(org?.subscription_reference)}
                </span>
              </DetailRow>
            </div>

            <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-4">
              <p className="text-sm font-medium">Limites do plano</p>
              <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Users className="h-4 w-4 text-primary" /> Até{" "}
                  {plan?.max_users ?? org?.max_users ?? "—"} usuários
                </span>
                <span className="flex items-center gap-2 text-muted-foreground">
                  <MessageSquareText className="h-4 w-4 text-primary" /> Até{" "}
                  {plan?.max_whatsapp_sessions ??
                    org?.max_whatsapp_sessions_override ??
                    "—"}{" "}
                  WhatsApp
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setSubscriptionDetailsOpen(false);
                  setFiscalDialogOpen(true);
                }}
              >
                Dados fiscais
              </Button>
              <Button
                className="flex-1"
                onClick={() => {
                  setSubscriptionDetailsOpen(false);
                  replaceBillingLocation("plans");
                }}
              >
                Alterar plano
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(selectedPayment)}
        onOpenChange={(open) => {
          if (!open) handleClosePayment();
        }}
      >
        <DialogContent className="max-h-[90vh] w-[calc(100vw-32px)] overflow-y-auto rounded-[8px] border-0 bg-[var(--app-surface-solid)] text-[12px] font-light shadow-none sm:max-w-xl">
          <DialogHeader className="pr-8">
            <DialogTitle className="text-[14px] font-normal">
              Detalhes do pagamento
            </DialogTitle>
            <DialogDescription>
              {selectedPayment
                ? `Pagamento ${shortReference(selectedPayment.asaas_payment_id)}`
                : "Pagamento"}
            </DialogDescription>
          </DialogHeader>

          {selectedPayment && (
            <div className="mt-6 space-y-5">
              <div className="divide-y divide-[var(--app-border)] rounded-[8px] border border-[var(--app-border)]">
                <DetailRow label="Status">
                  <Badge
                    variant={getPaymentStatus(selectedPayment).variant}
                    className={statusBadgeClassName(
                      getPaymentStatus(selectedPayment).variant,
                    )}
                  >
                    {getPaymentStatus(selectedPayment).label}
                  </Badge>
                </DetailRow>
                <DetailRow label="ID do pagamento">
                  <span className="font-mono text-xs">
                    {selectedPayment.asaas_payment_id}
                  </span>
                </DetailRow>
                <DetailRow label="ID da assinatura">
                  <span className="font-mono text-xs">
                    {selectedPayment.asaas_subscription_id || "—"}
                  </span>
                </DetailRow>
                <DetailRow label="Método">
                  <span>
                    {selectedPayment.billing_type === "CREDIT_CARD"
                      ? "Cartão"
                      : selectedPayment.billing_type === "PIX"
                        ? "Pix"
                        : selectedPayment.billing_type === "BOLETO"
                          ? "Boleto"
                          : "—"}
                  </span>
                </DetailRow>
                <DetailRow label="Vencimento">
                  <span>{formatDateValue(selectedPayment.due_date)}</span>
                </DetailRow>
                <DetailRow label="Pagamento">
                  <span>{formatDateValue(selectedPayment.payment_date)}</span>
                </DetailRow>
                {selectedPayment.receipt_path && (
                  <DetailRow label="Comprovante">
                    <Button asChild variant="outline" size="sm">
                      <a
                        href={selectedPayment.receipt_path}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Ver comprovante
                        <ArrowRight className="h-4 w-4" />
                      </a>
                    </Button>
                  </DetailRow>
                )}
              </div>

              <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-4">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm text-muted-foreground">
                    Valor total
                  </span>
                  <span className="text-[16px] font-normal tabular-nums">
                    {formatMoney(selectedPayment.value)}
                  </span>
                </div>
              </div>

              <PaymentCheckoutActions
                payment={selectedPayment}
                checkoutReady={data?.billingCheckoutReady === true}
                refreshing={
                  refreshingPaymentId === selectedPayment.id ||
                  refreshingPaymentIds.has(selectedPayment.id)
                }
                refreshError={
                  paymentRefreshError ||
                  paymentListRefreshErrors[selectedPayment.id] ||
                  null
                }
                onRetry={retrySelectedPaymentRefresh}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Sheet open={methodDetailsOpen} onOpenChange={setMethodDetailsOpen}>
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
                setMethodDetailsOpen(false);
                setPaymentMethodDialogOpen(true);
              }}
            >
              Adicionar outra forma
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog
        open={paymentMethodDialogOpen}
        onOpenChange={setPaymentMethodDialogOpen}
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

          {data?.billingCheckoutReady !== true ? (
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
              <Button
                className="mt-4"
                onClick={() => {
                  setPaymentMethodDialogOpen(false);
                  setFiscalDialogOpen(true);
                }}
              >
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
              <Button
                className="mt-4"
                onClick={() => {
                  setPaymentMethodDialogOpen(false);
                  replaceBillingLocation("plans");
                }}
              >
                Escolher plano
              </Button>
            </div>
          ) : (
            <div className="py-2">
              <button
                type="button"
                onClick={handleOpenCheckout}
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

      <Dialog open={fiscalDialogOpen} onOpenChange={setFiscalDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto rounded-[8px] border-0 bg-[var(--app-surface-solid)] text-[12px] font-light shadow-none">
          <DialogHeader>
            <DialogTitle className="text-[14px] font-normal">
              Dados fiscais
            </DialogTitle>
            <DialogDescription>
              Usados no cadastro do pagador e na emissão dos documentos
              financeiros.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={autoFillFromUser}>
              <User className="h-3.5 w-3.5" /> Usar meu perfil
            </Button>
            <Button variant="outline" size="sm" onClick={autoFillFromOrg}>
              <Building2 className="h-3.5 w-3.5" /> Usar dados da empresa
            </Button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Nome / Razão social">
              <Input
                value={billingInfo.name}
                onChange={(event) =>
                  setBillingInfo({ ...billingInfo, name: event.target.value })
                }
              />
            </Field>
            <Field label="CPF ou CNPJ">
              <Input
                value={billingInfo.taxId}
                onChange={(event) =>
                  setBillingInfo({ ...billingInfo, taxId: event.target.value })
                }
              />
            </Field>
            <Field label="E-mail financeiro">
              <Input
                type="email"
                value={billingInfo.email}
                onChange={(event) =>
                  setBillingInfo({ ...billingInfo, email: event.target.value })
                }
              />
            </Field>
            <Field label="Telefone">
              <Input
                value={billingInfo.telefone}
                onChange={(event) =>
                  setBillingInfo({
                    ...billingInfo,
                    telefone: event.target.value,
                  })
                }
              />
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-6">
            <Field label="CEP" className="md:col-span-2">
              <Input
                value={billingInfo.cep}
                onChange={(event) =>
                  setBillingInfo({ ...billingInfo, cep: event.target.value })
                }
              />
            </Field>
            <Field label="Endereço" className="md:col-span-3">
              <Input
                value={billingInfo.endereco}
                onChange={(event) =>
                  setBillingInfo({
                    ...billingInfo,
                    endereco: event.target.value,
                  })
                }
              />
            </Field>
            <Field label="Número">
              <Input
                value={billingInfo.numero}
                onChange={(event) =>
                  setBillingInfo({ ...billingInfo, numero: event.target.value })
                }
              />
            </Field>
            <Field label="Complemento" className="md:col-span-2">
              <Input
                value={billingInfo.complemento}
                onChange={(event) =>
                  setBillingInfo({
                    ...billingInfo,
                    complemento: event.target.value,
                  })
                }
              />
            </Field>
            <Field label="Bairro" className="md:col-span-2">
              <Input
                value={billingInfo.bairro}
                onChange={(event) =>
                  setBillingInfo({ ...billingInfo, bairro: event.target.value })
                }
              />
            </Field>
            <Field label="UF">
              <Input
                value={billingInfo.uf}
                maxLength={2}
                onChange={(event) =>
                  setBillingInfo({
                    ...billingInfo,
                    uf: event.target.value.toUpperCase(),
                  })
                }
              />
            </Field>
            <Field label="Cidade">
              <Input
                value={billingInfo.cidade}
                onChange={(event) =>
                  setBillingInfo({ ...billingInfo, cidade: event.target.value })
                }
              />
            </Field>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setFiscalDialogOpen(false)}
            >
              Cancelar
            </Button>
            <Button onClick={() => void handleSaveBilling()} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Salvar dados fiscais
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!planToConfirm}
        onOpenChange={(open) => {
          if (!open && changingPlanId) return;
          if (!open) setPlanToConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar escolha do plano?</AlertDialogTitle>
            <AlertDialogDescription>
              {managedPlanChangeAvailable
                ? `A troca para ${planToConfirm?.name || "o plano selecionado"} será agendada para a próxima cobrança.`
                : `O plano ${planToConfirm?.name || "selecionado"} será preparado para o checkout por ${formatMoney(planToConfirm?.price || 0)}.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!changingPlanId}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                if (planToConfirm) void handleSelectPlan(planToConfirm);
              }}
              disabled={!planToConfirm || !!changingPlanId}
            >
              {changingPlanId ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirmar plano
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <div className="min-w-0 text-right text-foreground">{children}</div>
    </div>
  );
}

function PaymentCheckoutActions({
  payment,
  checkoutReady,
  refreshing,
  refreshError,
  onRetry,
}: {
  payment: PaymentHistoryItem;
  checkoutReady: boolean;
  refreshing: boolean;
  refreshError: string | null;
  onRetry: () => void;
}) {
  const normalizedStatus = (payment.status || "").trim().toUpperCase();
  const bankSlipExpired =
    hasCancelledBankSlipRegistration(payment) ||
    normalizedStatus === "BANK_SLIP_CANCELLED";
  const semanticStatus = resolveBillingPaymentStatus(
    normalizedStatus,
    bankSlipExpired,
  ).state;
  const actionable = isBillingPaymentCheckoutActionable(
    normalizedStatus,
    bankSlipExpired,
  );
  const paid = semanticStatus === "paid";
  const cancelled = semanticStatus === "cancelled";
  const processing = semanticStatus === "processing";

  if (!checkoutReady) {
    return (
      <div className="flex items-start gap-3 rounded-[8px] bg-amber-500/10 p-4 text-[12px] font-light text-amber-800 dark:text-amber-300">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          A cobrança não pode ser consultada ou paga enquanto o ambiente
          financeiro está em atualização.
        </p>
      </div>
    );
  }

  if (refreshError || payment.sync_state === "provider_unavailable") {
    return (
      <div className="space-y-3 rounded-[8px] border border-warning/25 bg-warning/5 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-foreground" />
          <div>
            <p className="text-sm font-medium">
              Status temporariamente indisponível
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Não foi possível confirmar a cobrança agora. O pagamento fica
              bloqueado até uma resposta segura do provedor.
            </p>
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  if (refreshing) {
    return (
      <div className="flex items-center gap-3 rounded-[8px] bg-[var(--app-surface-soft)] p-4 text-[12px] font-light text-muted-foreground">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
        Conferindo o status atual do pagamento…
      </div>
    );
  }

  if (payment.sync_state === "cached") {
    return (
      <div className="space-y-3 rounded-[8px] bg-[var(--app-surface-soft)] p-4 text-[12px] font-light text-muted-foreground">
        <p>
          Este status ainda veio do histórico local e não foi confirmado pelo
          provedor.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Confirmar status
        </Button>
      </div>
    );
  }

  if (actionable && payment.checkout_url) {
    const copyCheckoutLink = async () => {
      try {
        const checkoutLink = new URL(
          payment.checkout_url || "",
          window.location.origin,
        ).toString();
        await navigator.clipboard.writeText(checkoutLink);
        toast.success("Link de pagamento copiado.");
      } catch {
        toast.error("Não foi possível copiar o link de pagamento.");
      }
    };

    return (
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <Button asChild className="w-full">
          <a href={payment.checkout_url}>
            {bankSlipExpired
              ? "Gerar novo boleto ou trocar método"
              : "Pagar no checkout"}
            <ArrowRight className="h-4 w-4" />
          </a>
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => void copyCheckoutLink()}
        >
          <Copy className="h-4 w-4" /> Copiar link
        </Button>
      </div>
    );
  }

  if (actionable) {
    return (
      <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-4 text-[12px] font-light text-muted-foreground">
        O link seguro desta cobrança está sendo preparado. Atualize os detalhes
        em alguns instantes.
      </div>
    );
  }

  if (paid) {
    return (
      <div className="flex items-center gap-3 rounded-[8px] bg-primary/[0.06] p-4 text-[12px] font-light text-muted-foreground">
        <Check className="h-4 w-4 shrink-0 text-primary" /> Pagamento
        confirmado. Não há valor pendente nesta cobrança.
      </div>
    );
  }

  if (cancelled) {
    return (
      <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-4 text-[12px] font-light text-muted-foreground">
        Esta cobrança foi cancelada e não pode mais receber pagamento.
      </div>
    );
  }

  if (semanticStatus === "refund_processing") {
    return (
      <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-4 text-[12px] font-light text-muted-foreground">
        O estorno está em andamento. Esta cobrança não aceita um novo pagamento.
      </div>
    );
  }

  if (semanticStatus === "refunded") {
    return (
      <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-4 text-[12px] font-light text-muted-foreground">
        Esta cobrança foi estornada e não pode mais receber pagamento.
      </div>
    );
  }

  if (semanticStatus === "chargeback") {
    return (
      <div className="rounded-[8px] bg-destructive/[0.06] p-4 text-[12px] font-light text-muted-foreground">
        Esta cobrança está em contestação. Nenhum novo pagamento foi liberado.
      </div>
    );
  }

  if (processing) {
    return (
      <div className="flex items-center gap-3 rounded-[8px] bg-[var(--app-surface-soft)] p-4 text-[12px] font-light text-muted-foreground">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" /> O
        pagamento está sendo processado.
      </div>
    );
  }

  return (
    <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-4 text-[12px] font-light text-muted-foreground">
      O status desta cobrança ainda está em verificação. Nenhuma ação de
      pagamento foi liberada.
    </div>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}
