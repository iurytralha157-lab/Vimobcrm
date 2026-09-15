import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlertCircle,
  AtSign,
  Check,
  ExternalLink,
  Globe,
  FilePlus2,
  Loader2,
  MoreVertical,
  Plug,
  Plus,
  Search,
  Settings,
  Trash2,
  Unplug,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { normalizeSearchText } from "@/lib/search-text";
import { useAuth } from "@/contexts/AuthContext";
import { VimobAPIError } from "@/lib/api/vimob-client";
import { useOrganizationModules } from "@/hooks/use-organization-modules";
import { useUserPermissions } from "@/hooks/use-user-permissions";
import {
  MetaAdAccount,
  MetaIntegration,
  MetaPage,
  useMetaAdAccounts,
  useMetaConnectPage,
  useMetaDisconnectPage,
  useMetaGetAuthUrl,
  useMetaIntegrations,
  useMetaOAuthFlowResult,
  useMetaUpdateAdAccounts,
} from "@/hooks/use-meta-integration";
import {
  MetaForm,
  MetaFormConfig,
  useAllMetaFormConfigs,
  useDeleteFormConfig,
  useFetchPageForms,
  useToggleFormConfig,
} from "@/hooks/use-meta-forms";
import { MetaFormConfigDialog } from "./MetaFormConfigDialog";

interface OAuthPayload {
  pages?: MetaPage[];
  ad_accounts?: MetaAdAccount[];
  flow_id?: string;
  adAccountId?: string | null;
  ad_account_id?: string | null;
  facebook_user_id?: string | null;
  facebook_user_name?: string | null;
}

interface OAuthStatus {
  status?: string;
  flowId?: string | null;
  error?: string | null;
  nonce?: number;
}

interface OAuthWindowMessage {
  type?: string;
  data?: OAuthPayload | null;
  status?: string;
  flowId?: string | null;
  error?: string | null;
  nonce?: number;
}

interface AccountGroup {
  key: string;
  name: string;
  facebookUserId?: string | null;
  facebookUserName?: string | null;
  flowId?: string;
  adAccountId?: string;
  adAccounts?: MetaAdAccount[];
  integrations: MetaIntegration[];
  pages: MetaPage[];
  isNew?: boolean;
}

const getPagePicture = (page?: MetaPage | null) => page?.picture?.data?.url || "";
const searchableText = (value: unknown) => normalizeSearchText(String(value ?? ""));
const getIntegrationAccountKey = (integration: MetaIntegration) =>
  integration.facebook_user_id ||
  integration.facebook_user_name ||
  integration.page_id ||
  integration.id;

function getAccountPageSummary(account: AccountGroup) {
  const names = Array.from(
    new Set(
      (account.isNew
        ? account.pages.map((page) => page.name)
        : account.integrations.map((integration) => integration.page_name))
        .map((name) => name?.trim())
        .filter((name): name is string => Boolean(name)),
    ),
  );

  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  return `${names[0]} +${names.length - 1}`;
}

function getNameInitials(value?: string | null) {
  const parts = String(value ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) return "?";
  return `${parts[0]?.[0] ?? ""}${parts.length > 1 ? parts.at(-1)?.[0] ?? "" : ""}`.toUpperCase();
}
const getIntegrationAdAccountIds = (integration?: MetaIntegration | null) => {
  const ids = Array.isArray(integration?.selected_ad_accounts)
    ? integration.selected_ad_accounts.flatMap((value) => {
        if (typeof value === "string") return value.trim() ? [value.trim()] : [];
        if (!value || typeof value !== "object" || !("id" in value)) return [];
        const id = String(value.id ?? "").trim();
        return id ? [id] : [];
      })
    : [];
  const fallbackId = integration?.ad_account_id?.trim();
  return Array.from(new Set(fallbackId ? [...ids, fallbackId] : ids));
};
const META_OAUTH_CHANNEL = "vimob-meta-oauth";
const META_OAUTH_STORAGE_KEY = "vimob:meta-oauth";

function publishMetaOAuthReturn(message: OAuthWindowMessage) {
  const payload = { ...message, nonce: message.nonce ?? Date.now() };

  if (window.opener && !window.opener.closed) {
    window.opener.postMessage(payload, window.location.origin);
  }

  try {
    if ("BroadcastChannel" in window) {
      const channel = new BroadcastChannel(META_OAUTH_CHANNEL);
      channel.postMessage(payload);
      channel.close();
    }
  } catch {
    // BroadcastChannel can be unavailable in restricted browser modes.
  }

  try {
    window.localStorage.setItem(META_OAUTH_STORAGE_KEY, JSON.stringify(payload));
    window.localStorage.removeItem(META_OAUTH_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in restricted browser modes.
  }
}

function metaErrorMessage(error: unknown, fallback: string) {
  if (error instanceof VimobAPIError && error.status === 403) {
    return "Sem permissao para gerenciar integracoes Meta nesta organizacao.";
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

const normalizeOAuthPayload = (payload?: OAuthPayload | null): OAuthPayload | null => {
  if (!payload) return null;
  const flowId = payload.flow_id?.trim();
  if (!flowId) return null;
  const adAccounts = (payload.ad_accounts || [])
    .filter((account) => Boolean(account.id?.trim()))
    .map((account) => ({
      id: account.id.trim(),
      account_id: account.account_id,
      name: account.name,
      account_status: account.account_status,
      currency: account.currency,
      timezone_name: account.timezone_name,
    }));

  return {
    flow_id: flowId,
    pages: (payload.pages || []).map((page) => ({
      id: page.id,
      name: page.name,
      picture: page.picture,
      instagram_business_account: page.instagram_business_account,
      facebook_user_id: page.facebook_user_id,
      facebook_user_name: page.facebook_user_name,
    })),
    ad_accounts: adAccounts,
    adAccountId: payload.adAccountId || payload.ad_account_id || adAccounts[0]?.id,
    facebook_user_id: payload.facebook_user_id,
    facebook_user_name: payload.facebook_user_name,
  };
};

const buildConfigForm = (config: MetaFormConfig): MetaForm => ({
  id: config.form_id,
  name: config.form_name || config.form_id,
  status: config.is_active ? "ACTIVE" : "INACTIVE",
});

const mergeFormsWithConfigured = (
  metaForms: MetaForm[],
  configuredForms: MetaFormConfig[]
): MetaForm[] => {
  const byId = new Map<string, MetaForm>();

  for (const form of metaForms) {
    byId.set(form.id, form);
  }

  for (const config of configuredForms) {
    if (!byId.has(config.form_id)) {
      byId.set(config.form_id, buildConfigForm(config));
    }
  }

  return Array.from(byId.values());
};

export function MetaIntegrationSettings({
  oauthPayload,
  oauthStatus,
  listenForOAuthMessages = true,
}: {
  oauthPayload?: OAuthPayload | null;
  oauthStatus?: OAuthStatus | null;
  listenForOAuthMessages?: boolean;
}) {
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [accountSearch, setAccountSearch] = useState("");
  const [tableSearch, setTableSearch] = useState("");
  const [wizardFormSearch, setWizardFormSearch] = useState("");
  const [wizardPageSearch, setWizardPageSearch] = useState("");
  const [selectedAccountKey, setSelectedAccountKey] = useState("");
  const [managedAdAccountIds, setManagedAdAccountIds] = useState<string[]>([]);
  const [managedAdAccountIntegration, setManagedAdAccountIntegration] = useState<MetaIntegration | null>(null);
  const [pendingPage, setPendingPage] = useState<MetaPage | null>(null);
  const [selectedIntegration, setSelectedIntegration] = useState<MetaIntegration | null>(null);
  const [forms, setForms] = useState<MetaForm[]>([]);
  const [formsLoading, setFormsLoading] = useState(false);
  const [formsLoadError, setFormsLoadError] = useState<string | null>(null);
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [editingForm, setEditingForm] = useState<MetaForm | null>(null);
  const [editingConfig, setEditingConfig] = useState<MetaFormConfig | undefined>();
  const [newOAuth, setNewOAuth] = useState<OAuthPayload | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<AccountGroup | null>(null);
  const [configToDelete, setConfigToDelete] = useState<MetaFormConfig | null>(null);
  const [formToDeactivate, setFormToDeactivate] = useState<MetaFormConfig | null>(null);
  const handledOAuthStatusRef = useRef<string | number | null>(null);
  const handledOAuthMessageRef = useRef<string | number | null>(null);
  const formsRequestSequenceRef = useRef(0);

  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId;
  const {
    data: integrations = [],
    isLoading: integrationsLoading,
    isError: integrationsLoadFailed,
    refetch: refetchIntegrations,
  } = useMetaIntegrations();
  const {
    data: configs = [],
    isLoading: configsLoading,
    isError: configsLoadFailed,
    refetch: refetchConfigs,
  } = useAllMetaFormConfigs();
  const getAuthUrl = useMetaGetAuthUrl();
  const getOAuthFlow = useMetaOAuthFlowResult();
  const connectPage = useMetaConnectPage();
  const disconnectPage = useMetaDisconnectPage();
  const fetchForms = useFetchPageForms();
  const toggleForm = useToggleFormConfig();
  const deleteForm = useDeleteFormConfig();
  const { hasModule } = useOrganizationModules();
  const { hasPermission } = useUserPermissions();
  const hasMarketingModule = hasModule("campaigns");
  const canViewAdvancedMarketing =
    hasMarketingModule && hasPermission("dashboard_campaigns_view");
  const availableAdAccountsQuery = useMetaAdAccounts(managedAdAccountIntegration?.page_id, {
    enabled:
      !!managedAdAccountIntegration &&
      canViewAdvancedMarketing &&
      !!managedAdAccountIntegration?.page_id &&
      managedAdAccountIntegration?.is_connected !== false,
  });
  const updateAdAccounts = useMetaUpdateAdAccounts();

  const openOAuthWizard = useCallback((payload: OAuthPayload | null | undefined, message: string) => {
    const normalized = normalizeOAuthPayload(payload);
    if (!normalized?.pages?.length) return false;

    setNewOAuth(normalized);
    setSelectedAccountKey("new-oauth");
    setPendingPage(null);
    setFormsLoadError(null);
    setAccountSearch("");
    setWizardPageSearch("");
    setWizardFormSearch("");
    setWizardOpen(true);
    setAccountModalOpen(false);
    toast.success(message);
    return true;
  }, []);

  const handleOAuthStatusResult = useCallback(async (status: OAuthStatus) => {
    if (status.status === "success") {
      if (status.flowId) {
        try {
          const flow = await getOAuthFlow.mutateAsync(status.flowId);
          if (openOAuthWizard(flow.payload, "Conta do Facebook autorizada. Escolha a página para concluir.")) {
            await refetchConfigs();
            return;
          }
        } catch (error) {
          console.error("Unable to load Meta OAuth flow result", error);
        }
      }

      setNewOAuth(null);
      setSelectedAccountKey("");
      setAccountSearch("");
      setWizardOpen(false);
      setAccountModalOpen(true);
      const [integrationsResult] = await Promise.all([refetchIntegrations(), refetchConfigs()]);
      if ((integrationsResult.data || []).length > 0) {
        toast.success("Conta do Facebook reconectada com sucesso.");
      } else {
        toast.warning("Conta do Facebook autorizada, mas nenhuma página foi vinculada ainda. Escolha uma página para concluir.");
      }
      return;
    }

    if (status.error) {
      toast.error(`Erro ao reconectar Facebook: ${status.error}`);
    }
  }, [getOAuthFlow, openOAuthWizard, refetchConfigs, refetchIntegrations]);

  useEffect(() => {
    if (oauthStatus !== undefined) return;

    const params = new URLSearchParams(window.location.search);
    const status = params.get("meta_oauth_status");
    const flowId = params.get("meta_oauth_flow_id");
    const error = params.get("meta_oauth_error");
    const legacyPayload = params.has("meta_oauth_data");
    const isOAuthPopupReturn = params.get("meta_oauth_popup") === "1";
    if (!status && !flowId && !error && !legacyPayload) return;

    const result: OAuthStatus = {
      status: legacyPayload && !flowId ? "error" : status || undefined,
      flowId,
      error: legacyPayload && !flowId
        ? "O retorno antigo da Meta foi bloqueado por segurança. Inicie a conexão novamente."
        : error,
      nonce: Date.now(),
    };

    params.delete("meta_oauth_data");
    params.delete("meta_oauth_status");
    params.delete("meta_oauth_flow_id");
    params.delete("meta_oauth_error");
    params.delete("meta_oauth_popup");
    window.history.replaceState({}, "", `${window.location.pathname}${params.toString() ? `?${params}` : ""}`);

    if ((window.opener && !window.opener.closed) || isOAuthPopupReturn) {
      publishMetaOAuthReturn({ type: "META_OAUTH_STATUS", ...result });
      window.close();
      return;
    }

    queueMicrotask(() => {
      void handleOAuthStatusResult(result);
    });
  }, [handleOAuthStatusResult, oauthStatus]);

  useEffect(() => {
    if (!oauthPayload) return;
    queueMicrotask(() => {
      openOAuthWizard(oauthPayload, "Conta do Facebook autorizada. Escolha a página para concluir.");
    });
  }, [oauthPayload, openOAuthWizard]);

  useEffect(() => {
    if (!oauthStatus) return;
    if (oauthStatus.status === "success" && !organizationId) return;
    const currentOAuthStatus = oauthStatus;
    const statusKey = oauthStatus.nonce ?? oauthStatus.flowId ?? oauthStatus.status ?? oauthStatus.error ?? "unknown";
    if (handledOAuthStatusRef.current === statusKey) return;
    handledOAuthStatusRef.current = statusKey;

    queueMicrotask(async () => {
      await handleOAuthStatusResult(currentOAuthStatus);
    });
  }, [handleOAuthStatusResult, oauthStatus, organizationId]);

  useEffect(() => {
    if (!listenForOAuthMessages || oauthPayload !== undefined) return;

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const message = event.data as OAuthWindowMessage;
      if (!message?.type) return;
      const messageKey =
        message?.nonce ??
        `${message?.type ?? ""}:${message?.flowId ?? ""}:${message?.status ?? ""}:${message?.error ?? ""}:${message?.data?.facebook_user_id ?? ""}`;
      if (handledOAuthMessageRef.current === messageKey) return;
      handledOAuthMessageRef.current = messageKey;

      if (event.data?.type === "META_OAUTH_STATUS") {
        void handleOAuthStatusResult({
          status: event.data.status,
          flowId: event.data.flowId,
          error: event.data.error,
          nonce: event.data.nonce,
        });
        return;
      }

      if (!event.data || event.data.type !== "META_OAUTH_SUCCESS") return;
      if (openOAuthWizard(event.data.data || null, "Conta do Facebook autorizada. Escolha a página para concluir.")) return;
      toast.error("O retorno da Meta não possui um fluxo seguro válido. Inicie a conexão novamente.");
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== META_OAUTH_STORAGE_KEY || !event.newValue) return;
      try {
        handleMessage(new MessageEvent("message", {
          data: JSON.parse(event.newValue) as OAuthWindowMessage,
          origin: window.location.origin,
        }));
      } catch {
        // Ignore malformed cross-window events.
      }
    };

    window.addEventListener("message", handleMessage);
    window.addEventListener("storage", handleStorage);

    let channel: BroadcastChannel | null = null;
    try {
      if ("BroadcastChannel" in window) {
        channel = new BroadcastChannel(META_OAUTH_CHANNEL);
        channel.onmessage = (event) => {
          handleMessage(new MessageEvent("message", { data: event.data, origin: window.location.origin }));
        };
      }
    } catch {
      channel = null;
    }

    return () => {
      window.removeEventListener("message", handleMessage);
      window.removeEventListener("storage", handleStorage);
      channel?.close();
    };
  }, [handleOAuthStatusResult, listenForOAuthMessages, oauthPayload, openOAuthWizard]);

  const accounts = useMemo<AccountGroup[]>(() => {
    const grouped = new Map<string, AccountGroup>();

    for (const integration of integrations) {
      const key = getIntegrationAccountKey(integration);
      const current = grouped.get(key) || {
        key,
        name: integration.facebook_user_name || integration.page_name || "Conta Facebook",
        facebookUserId: integration.facebook_user_id,
        facebookUserName: integration.facebook_user_name,
        integrations: [],
        pages: [],
      };
      current.integrations.push(integration);
      grouped.set(key, current);
    }

    if (newOAuth?.pages?.length) {
      grouped.set("new-oauth", {
        key: "new-oauth",
        name: newOAuth.facebook_user_name || "Nova conta Facebook",
        facebookUserId: newOAuth.facebook_user_id,
        facebookUserName: newOAuth.facebook_user_name,
        flowId: newOAuth.flow_id,
        adAccountId: newOAuth.adAccountId || newOAuth.ad_account_id || undefined,
        adAccounts: newOAuth.ad_accounts || [],
        integrations: [],
        pages: newOAuth.pages,
        isNew: true,
      });
    }

    return Array.from(grouped.values());
  }, [integrations, newOAuth]);

  const selectedAccount = accounts.find((account) => account.key === selectedAccountKey) || accounts[0];
  const pendingPageIntegration = pendingPage
    ? integrations.find((integration) => integration.page_id === pendingPage.id) ?? null
    : null;
  const configuredByFormId = useMemo(() => new Map(configs.map((config) => [config.form_id, config])), [configs]);
  const integrationById = useMemo(() => new Map(integrations.map((integration) => [integration.id, integration])), [integrations]);

  const getConfiguredFormsForIntegration = (integrationId?: string | null) =>
    integrationId ? configs.filter((config) => config.integration_id === integrationId) : [];

  const filteredAccounts = accounts.filter((account) => {
    const search = searchableText(accountSearch);
    if (!search) return true;
    return [
      account.name,
      account.facebookUserName,
      ...account.integrations.flatMap((integration) => [
        integration.page_name,
        integration.instagram_username,
      ]),
      ...account.pages.flatMap((page) => [
        page.name,
        page.instagram_business_account?.username,
      ]),
    ].some((value) => searchableText(value).includes(search));
  });

  const pageItems = selectedAccount
    ? selectedAccount.isNew
      ? selectedAccount.pages
      : selectedAccount.integrations
    : [];

  const filteredForms = forms.filter((form) => {
    const search = searchableText(wizardFormSearch.trim());
    if (!search) return true;
    return [form.name, form.id, form.status].some((value) => searchableText(value).includes(search));
  });

  const filteredPageItems = pageItems.filter((page) => {
    const search = searchableText(wizardPageSearch.trim());
    if (!search) return true;
    const isIntegrationPage = "page_id" in page;
    const name = isIntegrationPage ? page.page_name : page.name;
    const instagramUsername = isIntegrationPage
      ? page.instagram_username
      : page.instagram_business_account?.username;
    return [name, instagramUsername].some((value) =>
      searchableText(value).includes(search),
    );
  });

  const openOAuth = async () => {
    try {
      const returnUrl = new URL(window.location.href);
      returnUrl.searchParams.set("meta_oauth_popup", "1");
      const result = await getAuthUrl.mutateAsync({
        returnUrl: returnUrl.toString(),
        includeInstagram: true,
      });
      const popup = window.open(result.auth_url, "meta_oauth", "width=600,height=720");
      if (!popup) {
        const fallbackReturnUrl = new URL(window.location.href);
        fallbackReturnUrl.searchParams.delete("meta_oauth_popup");
        const fallbackResult = await getAuthUrl.mutateAsync({
          returnUrl: fallbackReturnUrl.toString(),
          includeInstagram: true,
        });
        window.location.href = fallbackResult.auth_url;
      }
    } catch (error) {
      toast.error(metaErrorMessage(error, "Nao foi possivel iniciar a conexao com a Meta."));
    }
  };

  const disconnectAccount = async (account: AccountGroup) => {
    try {
      for (const integration of account.integrations) {
        if (integration.page_id) await disconnectPage.mutateAsync(integration.page_id);
      }
      await refetchIntegrations();
      setDisconnectTarget(null);
    } catch {
      // The mutation already presents the API error; keep the confirmation open for retry.
    }
  };

  const deleteFormConfig = async () => {
    if (!configToDelete) return;
    try {
      await deleteForm.mutateAsync({
        formId: configToDelete.form_id,
        integrationId: configToDelete.integration_id,
      });
      setConfigToDelete(null);
    } catch {
      // The mutation already presents the API error; keep the confirmation open for retry.
    }
  };

  const deactivateFormConfig = async () => {
    if (!formToDeactivate) return;
    try {
      await toggleForm.mutateAsync({
        formId: formToDeactivate.form_id,
        integrationId: formToDeactivate.integration_id,
        isActive: false,
      });
      setFormToDeactivate(null);
    } catch {
      // The mutation already presents the API error; keep the confirmation open for retry.
    }
  };

  const loadFormsForIntegration = async (integration: MetaIntegration) => {
    if (!integration.page_id) {
      toast.error("Página sem identificador válido para buscar formulários.");
      return;
    }
    const requestSequence = ++formsRequestSequenceRef.current;
    setSelectedIntegration(integration);
    setFormsLoadError(null);
    setFormsLoading(true);
    try {
      const result = await fetchForms.mutateAsync({ pageId: integration.page_id });
      if (formsRequestSequenceRef.current !== requestSequence) return;
      setForms(mergeFormsWithConfigured(result.forms || [], getConfiguredFormsForIntegration(integration.id)));
    } catch (error) {
      if (formsRequestSequenceRef.current !== requestSequence) return;
      setForms([]);
      setFormsLoadError(metaErrorMessage(error, "Não foi possível carregar os formulários desta página."));
    } finally {
      if (formsRequestSequenceRef.current === requestSequence) {
        setFormsLoading(false);
      }
    }
  };

  const connectAndLoadPage = async (page: MetaPage) => {
    if (!selectedAccount?.flowId) {
      toast.error("A autorização expirou. Conecte a conta Meta novamente.");
      return;
    }

    const result = await connectPage.mutateAsync({
      pageId: page.id,
      flowId: selectedAccount.flowId,
      adAccountId: selectedAccount.adAccountId,
    });

    const refreshed = await refetchIntegrations();
    const integration = (refreshed.data || []).find((item) => item.page_id === page.id);
    if (integration) {
      setNewOAuth(null);
      setSelectedAccountKey(getIntegrationAccountKey(integration));
      setPendingPage(null);
      await loadFormsForIntegration(integration);
    } else if (result?.success) {
      setNewOAuth(null);
      setSelectedAccountKey("");
      setPendingPage(null);
      toast.success("Página conectada. Reabra o wizard se os formulários não aparecerem agora.");
    }
  };

  const handleSelectPage = async (page: MetaPage | MetaIntegration) => {
    formsRequestSequenceRef.current += 1;
    setForms([]);
    setFormsLoading(false);
    setFormsLoadError(null);
    setWizardFormSearch("");
    setPendingPage(null);

    if ("page_id" in page) {
      await loadFormsForIntegration(page);
      return;
    }

    if (selectedAccount?.isNew) {
      setSelectedIntegration(null);
      setPendingPage(page);
      return;
    }

    const existing = integrations.find((integration) => integration.page_id === page.id);
    if (existing) {
      await loadFormsForIntegration(existing);
      return;
    }

    setSelectedIntegration(null);
    setPendingPage(page);
  };

  const openAdAccountManager = (integration: MetaIntegration) => {
    setManagedAdAccountIntegration(integration);
    setManagedAdAccountIds(getIntegrationAdAccountIds(integration));
    setAccountModalOpen(false);
  };

  const saveManagedAdAccounts = async () => {
    if (!managedAdAccountIntegration?.page_id) return;
    try {
      await updateAdAccounts.mutateAsync({
        pageId: managedAdAccountIntegration.page_id,
        adAccountIds: managedAdAccountIds,
      });
      await refetchIntegrations();
      setManagedAdAccountIntegration(null);
    } catch {
      // The mutation keeps the dialog open and already presents an actionable error.
    }
  };

  const openConfig = (form: MetaForm, config?: MetaFormConfig, integration?: MetaIntegration | null) => {
    const ownerIntegration = integration || selectedIntegration || (config ? integrationById.get(config.integration_id) : null) || null;
    if (!ownerIntegration?.id) {
      toast.error("Selecione uma página antes de configurar o formulário.");
      return;
    }
    setSelectedIntegration(ownerIntegration);
    setEditingForm(form);
    setEditingConfig(config);
    setConfigDialogOpen(true);
  };

  const closeConfigDialog = (open: boolean) => {
    setConfigDialogOpen(open);
    if (!open) {
      refetchConfigs();
      setEditingConfig(undefined);
      setEditingForm(null);
    }
  };

  const filteredConfiguredForms = configs.filter((config) => {
    const search = searchableText(tableSearch);
    if (!search) return true;
    const integration = integrationById.get(config.integration_id);
    return [
      config.form_name,
      config.form_id,
      integration?.facebook_user_name,
      integration?.page_name,
      integration?.instagram_username,
      config.created_by_name,
    ]
      .filter(Boolean)
      .some((value) => searchableText(value).includes(search));
  });

  return (
    <div className="crm-management-surface animate-in flex h-full min-h-0 flex-col gap-4 text-[var(--app-text-primary)]">
      {(integrationsLoadFailed || configsLoadFailed) && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>Não foi possível carregar a integração Meta. Nenhuma conexão foi alterada.</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void Promise.all([refetchIntegrations(), refetchConfigs()])}
            >
              Tentar novamente
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="app-toolbar flex shrink-0 flex-col gap-2 p-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full min-w-0 sm:max-w-sm lg:w-[360px] lg:flex-none">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={tableSearch}
            onChange={(event) => setTableSearch(event.target.value)}
            placeholder="Buscar formulário configurado"
            aria-label="Buscar formulário configurado"
            className="h-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)] pl-9 text-[12px] font-light shadow-none focus-visible:ring-1 focus-visible:ring-primary/30"
          />
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          <Button
            variant="outline"
            className="h-8 gap-2 whitespace-nowrap rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2.5 text-[12px] font-light shadow-none hover:bg-[var(--app-surface-hover)]"
            disabled={integrationsLoadFailed}
            onClick={() => setAccountModalOpen(true)}
          >
            <Settings className="h-4 w-4" />
            Gerenciar contas
          </Button>
          <Button
            className="h-8 gap-2 whitespace-nowrap rounded-[6px] bg-primary/50 px-2.5 text-[12px] font-light shadow-none hover:bg-primary"
            disabled={integrationsLoadFailed}
            onClick={() => setWizardOpen(true)}
          >
            <Plus className="h-4 w-4" />
            Adicionar formulários
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none [&>div]:h-full [&>div]:overflow-auto">
        <Table className="crm-management-table min-h-full min-w-[840px] table-fixed">
          <TableHeader className="sticky top-0 z-10 bg-[var(--app-surface-soft)]">
            <TableRow className="bg-[var(--app-surface-soft)]">
              <TableHead className="w-[18%]">Conta Facebook</TableHead>
              <TableHead className="w-[21%]">Página Facebook</TableHead>
              <TableHead className="w-[29%]">Nome do formulário</TableHead>
              <TableHead className="w-[10%]">Criado por</TableHead>
              <TableHead className="w-[16%]">Data de configuração</TableHead>
              <TableHead className="w-12 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {integrationsLoading || configsLoading ? (
              <TableRow><TableCell colSpan={6} className="h-28 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></TableCell></TableRow>
            ) : integrationsLoadFailed || configsLoadFailed ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                  Dados temporariamente indisponíveis. Tente novamente acima.
                </TableCell>
              </TableRow>
            ) : filteredConfiguredForms.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-40 text-center text-muted-foreground">
                  {configs.length === 0
                    ? "Nenhum formulário Meta configurado ainda."
                    : "Nenhum formulário corresponde a esta busca."}
                </TableCell>
              </TableRow>
            ) : (
              filteredConfiguredForms.map((config) => {
                  const integration = integrationById.get(config.integration_id);
                  return (
                    <TableRow
                      key={config.id}
                      className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                      tabIndex={0}
                      onClick={() => openConfig(buildConfigForm(config), config, integration)}
                      onKeyDown={(event) => {
                        if (
                          event.target === event.currentTarget &&
                          (event.key === "Enter" || event.key === " ")
                        ) {
                          event.preventDefault();
                          openConfig(buildConfigForm(config), config, integration);
                        }
                      }}
                    >
                      <TableCell className="text-[12px] font-light">{integration?.facebook_user_name || "Conta Facebook"}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar className="h-7 w-7">
                            <AvatarImage src={integration?.page_picture_url || undefined} />
                            <AvatarFallback>{integration?.page_name?.[0] || "F"}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <span
                              className="block max-w-[220px] truncate text-[12px] font-light"
                              title={integration?.page_name || "Página conectada"}
                            >
                              {integration?.page_name || "Página conectada"}
                            </span>
                            {integration?.instagram_username && (
                              <span className="flex items-center gap-1 text-xs text-[var(--app-text-tertiary)]">
                                <AtSign className="h-3 w-3" />{integration.instagram_username}
                              </span>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span
                            className="max-w-[260px] truncate text-[12px] font-normal"
                            title={config.form_name || config.form_id}
                          >
                            {config.form_name || config.form_id}
                          </span>
                          <Badge variant={config.is_active ? "default" : "secondary"}>{config.is_active ? "Ativo" : "Inativo"}</Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        {config.created_by_name ? (
                          <Avatar
                            className="h-7 w-7 bg-primary/10"
                            aria-label={`Criado por ${config.created_by_name}`}
                            title={config.created_by_name}
                          >
                            <AvatarFallback className="bg-primary/10 text-[9px] font-normal text-primary">
                              {getNameInitials(config.created_by_name)}
                            </AvatarFallback>
                          </Avatar>
                        ) : (
                          <span className="text-[11px] text-[var(--app-text-tertiary)]">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="text-[11px] font-light leading-4 text-[var(--app-text-secondary)]">
                          <span className="block">{format(new Date(config.created_at), "dd/MM/yyyy", { locale: ptBR })}</span>
                          <span className="block text-[10px] text-[var(--app-text-tertiary)]">
                            {format(new Date(config.created_at), "HH:mm", { locale: ptBR })}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right" onClick={(event) => event.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Ações de ${config.form_name || config.form_id}`}
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openConfig(buildConfigForm(config), config, integration)}>
                              <Settings className="mr-2 h-4 w-4" />Editar configuração
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => {
                                if (config.is_active) {
                                  setFormToDeactivate(config);
                                  return;
                                }
                                toggleForm.mutate({
                                  formId: config.form_id,
                                  integrationId: config.integration_id,
                                  isActive: true,
                                });
                              }}
                            >
                              {config.is_active ? <Unplug className="mr-2 h-4 w-4" /> : <Plug className="mr-2 h-4 w-4" />}
                              {config.is_active ? "Desativar" : "Ativar"} formulário
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive" onClick={() => setConfigToDelete(config)}>
                              <Trash2 className="mr-2 h-4 w-4" />Excluir configuração
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={accountModalOpen} onOpenChange={setAccountModalOpen}>
        <DialogContent className="max-h-[calc(100dvh-24px)] w-[calc(100vw-24px)] overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-4 shadow-none sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Globe className="h-5 w-5 text-primary" />Gerenciar conexão Meta</DialogTitle>
            <DialogDescription>Contas, páginas e ativos de Marketing vinculados à organização.</DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="h-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)] pl-9 text-[12px] font-light shadow-none focus-visible:ring-1 focus-visible:ring-primary/30" value={accountSearch} onChange={(event) => setAccountSearch(event.target.value)} placeholder="Buscar conta ou página" />
          </div>
          <ScrollArea className="max-h-[min(520px,62dvh)] pr-3">
            <div className="space-y-2">
              {filteredAccounts.map((account) => (
                <div key={account.key} className="app-card-soft space-y-3 rounded-[8px] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-normal">{account.name}</p>
                      <p className="text-[11px] font-light text-muted-foreground">
                        {account.integrations.length || account.pages.length} página{(account.integrations.length || account.pages.length) === 1 ? "" : "s"}
                      </p>
                    </div>
                    {account.integrations.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 shrink-0 rounded-[6px] px-2.5 text-[12px] font-light shadow-none hover:bg-[var(--app-surface-hover)]"
                        onClick={() => setDisconnectTarget(account)}
                        disabled={disconnectPage.isPending}
                      >
                        <Unplug className="mr-1.5 h-3.5 w-3.5" />
                        Desconectar
                      </Button>
                    )}
                  </div>

                  {account.integrations.length > 0 && (
                    <div className="space-y-1.5">
                      {account.integrations.map((integration) => {
                        const selectedCount = getIntegrationAdAccountIds(integration).length;
                        return (
                          <div
                            key={integration.id}
                            className="flex min-w-0 items-center gap-3 rounded-[6px] bg-[var(--app-surface-solid)] px-2.5 py-2"
                          >
                            <Avatar className="h-8 w-8 shrink-0">
                              <AvatarImage src={integration.page_picture_url || undefined} />
                              <AvatarFallback>{integration.page_name?.[0] || "F"}</AvatarFallback>
                            </Avatar>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[12px] font-normal" title={integration.page_name || "Página conectada"}>
                                {integration.page_name || "Página conectada"}
                              </p>
                              <p className="text-[10px] font-light text-[var(--app-text-tertiary)]">
                                {selectedCount === 0
                                  ? "Nenhuma conta de anúncio selecionada"
                                  : `${selectedCount} conta${selectedCount === 1 ? "" : "s"} de anúncio`}
                              </p>
                            </div>
                            {canViewAdvancedMarketing && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 shrink-0 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2.5 text-[11px] font-light shadow-none hover:bg-[var(--app-surface-hover)]"
                                onClick={() => openAdAccountManager(integration)}
                              >
                                Gerenciar anúncios
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
              {filteredAccounts.length === 0 && (
                <p className="py-10 text-center text-[12px] font-light text-[var(--app-text-tertiary)]">
                  Nenhuma conta corresponde à busca.
                </p>
              )}
            </div>
          </ScrollArea>
          <DialogFooter className="items-center justify-between sm:justify-between">
            <p className="text-[11px] font-light text-muted-foreground">{accounts.filter((a) => !a.isNew).length} conta{accounts.filter((a) => !a.isNew).length === 1 ? "" : "s"} conectada{accounts.filter((a) => !a.isNew).length === 1 ? "" : "s"}</p>
            <Button className="h-8 rounded-[6px] px-3 text-[12px] font-light shadow-none" onClick={openOAuth} disabled={getAuthUrl.isPending}>{getAuthUrl.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Conectar nova conta</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!managedAdAccountIntegration}
        onOpenChange={(open) => {
          if (!open && !updateAdAccounts.isPending) setManagedAdAccountIntegration(null);
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-24px)] w-[calc(100vw-24px)] overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-4 shadow-none sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Contas de anúncio</DialogTitle>
            <DialogDescription>
              {managedAdAccountIntegration?.page_name || "Página Meta"}
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[min(460px,58dvh)] pr-3">
            {availableAdAccountsQuery.isLoading ? (
              <div className="flex min-h-32 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            ) : availableAdAccountsQuery.isError ? (
              <div className="flex min-h-32 flex-col items-center justify-center gap-3 rounded-[8px] bg-[var(--app-surface-soft)] p-4 text-center">
                <p className="text-[12px] font-light text-[var(--app-text-secondary)]">
                  Não foi possível carregar as contas de anúncio desta conexão.
                </p>
                <Button type="button" variant="outline" size="sm" onClick={() => availableAdAccountsQuery.refetch()}>
                  Tentar novamente
                </Button>
              </div>
            ) : availableAdAccountsQuery.data?.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {availableAdAccountsQuery.data.map((account) => {
                  const checked = managedAdAccountIds.includes(account.id);
                  const checkboxId = `managed-meta-ad-account-${account.id}`;
                  return (
                    <label
                      key={account.id}
                      htmlFor={checkboxId}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-[6px] bg-[var(--app-surface-soft)] p-3 transition-colors hover:bg-[var(--app-surface-hover)]",
                        checked && "bg-primary/10 ring-1 ring-inset ring-primary/30",
                      )}
                    >
                      <Checkbox
                        id={checkboxId}
                        checked={checked}
                        onCheckedChange={(nextChecked) => {
                          setManagedAdAccountIds((current) =>
                            nextChecked
                              ? Array.from(new Set([...current, account.id]))
                              : current.filter((id) => id !== account.id),
                          );
                        }}
                        aria-label={`Selecionar ${account.name || account.account_id || account.id}`}
                      />
                      <span className="min-w-0">
                        <span className="block break-words text-[12px] font-normal">
                          {account.name || account.account_id || account.id}
                        </span>
                        <span className="mt-0.5 block text-[10px] font-light text-[var(--app-text-tertiary)]">
                          {account.account_id || account.id}
                          {account.currency ? ` · ${account.currency}` : ""}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <p className="rounded-[8px] bg-[var(--app-surface-soft)] p-4 text-center text-[12px] font-light text-[var(--app-text-secondary)]">
                Nenhuma conta de anúncio está disponível para esta conexão.
              </p>
            )}
          </ScrollArea>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={updateAdAccounts.isPending}
              onClick={() => setManagedAdAccountIntegration(null)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => void saveManagedAdAccounts()}
              disabled={
                availableAdAccountsQuery.isLoading ||
                availableAdAccountsQuery.isError ||
                updateAdAccounts.isPending
              }
            >
              {updateAdAccounts.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar contas
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!disconnectTarget}
        onOpenChange={(open) => !open && !disconnectPage.isPending && setDisconnectTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desconectar conta?</AlertDialogTitle>
            <AlertDialogDescription>
              A conta {disconnectTarget?.name} será desconectada das páginas e formulários Meta vinculados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnectPage.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={disconnectPage.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (disconnectTarget) void disconnectAccount(disconnectTarget);
              }}
            >
              {disconnectPage.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Desconectar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!configToDelete}
        onOpenChange={(open) => !open && !deleteForm.isPending && setConfigToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir configuração do formulário?</AlertDialogTitle>
            <AlertDialogDescription>
              O formulário {configToDelete?.form_name || configToDelete?.form_id} deixará de enviar leads para o CRM até ser configurado novamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteForm.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteForm.isPending}
              onClick={(event) => {
                event.preventDefault();
                void deleteFormConfig();
              }}
            >
              {deleteForm.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Excluir configuração
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!formToDeactivate}
        onOpenChange={(open) => !open && !toggleForm.isPending && setFormToDeactivate(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desativar formulário?</AlertDialogTitle>
            <AlertDialogDescription>
              O formulário {formToDeactivate?.form_name || formToDeactivate?.form_id} deixará de enviar novos leads para o CRM até ser ativado novamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={toggleForm.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={toggleForm.isPending}
              onClick={(event) => {
                event.preventDefault();
                void deactivateFormConfig();
              }}
            >
              {toggleForm.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Desativar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={wizardOpen}
        onOpenChange={(open) => {
          setWizardOpen(open);
          if (!open) {
            formsRequestSequenceRef.current += 1;
            setFormsLoading(false);
            setFormsLoadError(null);
          }
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-24px)] w-[calc(100vw-24px)] max-w-[1500px] overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-0 shadow-none sm:max-h-[88dvh]">
          <DialogTitle className="sr-only">Adicionar formulários Meta</DialogTitle>
          <DialogDescription className="sr-only">
            Selecione uma conta e uma página para configurar os formulários recebidos pelo CRM.
          </DialogDescription>
          <div className="grid max-h-[calc(100dvh-24px)] min-h-[580px] min-w-0 grid-cols-1 sm:max-h-[88dvh] lg:grid-cols-[minmax(220px,260px)_minmax(0,1fr)]">
            <aside className="max-h-[220px] min-w-0 space-y-3 overflow-y-auto border-b border-[var(--app-border)] bg-[var(--app-surface-soft)] p-3 lg:max-h-none lg:border-b-0 lg:border-r">
              <Button
                size="sm"
                className="h-8 w-full gap-2 rounded-[6px] text-[12px] font-light shadow-none"
                onClick={openOAuth}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Conectar conta Meta
              </Button>
              <div className="space-y-2">
                <p className="text-[10px] font-light uppercase tracking-wide text-muted-foreground">Contas Facebook</p>
                {accounts.map((account) => {
                  const pageSummary = getAccountPageSummary(account);
                  const connectionLabel = account.isNew ? "autorização pronta" : "conectada";
                  return (
                    <button
                      key={account.key}
                      type="button"
                      aria-pressed={selectedAccount?.key === account.key}
                      className={cn(
                        "flex w-full min-w-0 items-center justify-between rounded-[6px] bg-[var(--app-surface-solid)] px-2.5 py-2 text-left transition-colors hover:bg-[var(--app-surface-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/30",
                        selectedAccount?.key === account.key && "bg-primary/10 text-[var(--app-text-primary)] ring-1 ring-inset ring-primary/30",
                      )}
                      onClick={() => {
                        setSelectedAccountKey(account.key);
                        formsRequestSequenceRef.current += 1;
                        setSelectedIntegration(null);
                        setPendingPage(null);
                        setForms([]);
                        setFormsLoading(false);
                        setFormsLoadError(null);
                        setWizardPageSearch("");
                        setWizardFormSearch("");
                      }}
                    >
                      <div className="min-w-0">
                        <p className="break-words text-[12px] font-normal leading-4">
                          {account.name}
                        </p>
                        <p
                          className="truncate text-xs text-muted-foreground"
                          title={pageSummary || undefined}
                        >
                          {pageSummary
                            ? `${pageSummary} · ${connectionLabel}`
                            : connectionLabel}
                        </p>
                      </div>
                      {selectedAccount?.key === account.key && <Check className="h-4 w-4 shrink-0 text-primary" />}
                    </button>
                  );
                })}
              </div>
            </aside>

            <main className="min-w-0 space-y-3 overflow-y-auto p-3 pr-12">
              {!selectedAccount ? (
                <Alert><AlertCircle className="h-4 w-4" /><AlertDescription>Conecte ou selecione uma conta do Facebook para continuar.</AlertDescription></Alert>
              ) : (
                <>
                  <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-[minmax(280px,0.8fr)_minmax(360px,1.4fr)]">
                  <div className="min-w-0 space-y-2 rounded-[8px] bg-[var(--app-surface-soft)] p-2.5">
                    <p className="text-[10px] font-light uppercase tracking-wide text-[var(--app-text-tertiary)]">Páginas</p>
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--app-text-tertiary)]" />
                      <Input
                        className="h-8 rounded-[6px] border-0 bg-[var(--app-surface-solid)] pl-8 text-[12px] font-light shadow-none focus-visible:ring-1 focus-visible:ring-primary/30"
                        value={wizardPageSearch}
                        onChange={(event) => setWizardPageSearch(event.target.value)}
                        placeholder="Buscar página ou Instagram"
                        aria-label="Buscar página ou Instagram"
                      />
                    </div>
                    <ScrollArea className="h-[460px] pr-2">
                      <div className="space-y-1.5">
                        {filteredPageItems.map((page) => {
                          const isIntegrationPage = "page_id" in page;
                          const pageId = isIntegrationPage ? page.page_id : page.id;
                          const name = isIntegrationPage ? page.page_name : page.name;
                          const picture = isIntegrationPage ? page.page_picture_url : getPagePicture(page);
                          const instagramUsername = isIntegrationPage
                            ? page.instagram_username
                            : page.instagram_business_account?.username;
                          const active = selectedIntegration?.page_id === pageId || pendingPage?.id === pageId;
                          return (
                            <button
                              key={pageId}
                              type="button"
                              aria-pressed={active}
                              className={cn(
                                "flex w-full min-w-0 items-start justify-between rounded-[6px] bg-[var(--app-surface-solid)] px-2.5 py-2 text-left transition-colors hover:bg-[var(--app-surface-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/30",
                                active && "bg-primary/10 ring-1 ring-inset ring-primary/30",
                              )}
                              onClick={() => handleSelectPage(page)}
                            >
                              <div className="flex min-w-0 items-start gap-2.5">
                                <Avatar className="h-9 w-9 shrink-0"><AvatarImage src={picture || undefined} /><AvatarFallback>{name?.[0] || "F"}</AvatarFallback></Avatar>
                                <span className="min-w-0">
                                  <span className="block break-words text-[12px] font-normal leading-[18px]">
                                    {name}
                                  </span>
                                  {instagramUsername && (
                                    <span className="mt-1 flex items-center gap-1 break-all text-[10px] text-[var(--app-text-tertiary)]">
                                      <AtSign className="h-3 w-3 shrink-0" />{instagramUsername}
                                    </span>
                                  )}
                                </span>
                              </div>
                              {active && <Check className="ml-2 h-4 w-4 shrink-0 text-primary" />}
                            </button>
                          );
                        })}
                        {filteredPageItems.length === 0 && (
                          <p className="px-3 py-10 text-center text-[12px] font-light text-[var(--app-text-tertiary)]">
                            Nenhuma página encontrada.
                          </p>
                        )}
                      </div>
                    </ScrollArea>
                  </div>

                  <div className="min-w-0 space-y-2 overflow-hidden rounded-[8px] bg-[var(--app-surface-soft)] p-2.5">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-center gap-2">
                        <p className="text-[12px] font-normal">{pendingPage ? "Confirmar página" : "Formulários"}</p>
                        {selectedIntegration && !pendingPage && (
                          <span className="rounded-full bg-[var(--app-surface-solid)] px-2 py-0.5 text-[10px] font-light text-[var(--app-text-tertiary)]">
                            {forms.length}
                          </span>
                        )}
                      </div>
                      <div className="relative min-w-0 sm:w-[min(340px,54%)]">
                        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--app-text-tertiary)]" />
                        <Input
                          className="h-8 rounded-[6px] border-0 bg-[var(--app-surface-solid)] pl-8 text-[12px] font-light shadow-none focus-visible:ring-1 focus-visible:ring-primary/30"
                          value={wizardFormSearch}
                          onChange={(event) => setWizardFormSearch(event.target.value)}
                          placeholder="Buscar formulário"
                          aria-label="Buscar formulário"
                          disabled={!selectedIntegration || !!pendingPage || formsLoading}
                        />
                      </div>
                    </div>
                    <ScrollArea className="h-[460px] pr-2">
                      {formsLoading || connectPage.isPending ? (
                        <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>
                      ) : pendingPage ? (
                        <div className="flex min-h-[300px] items-center justify-center p-3">
                          <div className="app-card w-full max-w-md p-4">
                            <div className="flex items-center gap-3">
                              <Avatar className="h-12 w-12">
                                <AvatarImage src={getPagePicture(pendingPage) || undefined} />
                                <AvatarFallback>{pendingPage.name?.[0] || "F"}</AvatarFallback>
                              </Avatar>
                              <div className="min-w-0">
                                <p className="break-words font-medium">{pendingPage.name}</p>
                                {pendingPage.instagram_business_account?.username ? (
                                  <p className="mt-0.5 flex items-center gap-1 break-all text-xs text-[var(--app-text-tertiary)]">
                                    <AtSign className="h-3 w-3 shrink-0" />
                                    {pendingPage.instagram_business_account.username}
                                  </p>
                                ) : (
                                  <p className="mt-0.5 text-xs text-[var(--app-text-tertiary)]">
                                    Nenhum Instagram profissional vinculado
                                  </p>
                                )}
                              </div>
                            </div>

                            <div className="my-4 text-xs text-[var(--app-text-secondary)]">
                              <p className="flex items-start gap-2">
                                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                                Os formulários desta página poderão enviar leads ao CRM.
                              </p>
                            </div>

                            <Button
                              className="h-9 w-full rounded-[6px] text-[12px] font-light shadow-none"
                              onClick={() => connectAndLoadPage(pendingPage)}
                              disabled={connectPage.isPending}
                            >
                              {connectPage.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                              {pendingPageIntegration
                                ? "Atualizar conexão da página"
                                : "Confirmar e conectar página"}
                            </Button>
                            <p className="mt-2 text-center text-[11px] text-[var(--app-text-tertiary)]">
                              {pendingPageIntegration
                                ? "A nova autorização substituirá as credenciais desta página sem alterar seus formulários."
                                : "Nada é conectado apenas ao selecionar a página na lista."}
                            </p>
                          </div>
                        </div>
                      ) : formsLoadError && selectedIntegration ? (
                        <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 px-4 text-center">
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--app-surface-solid)] text-primary">
                            <AlertCircle className="h-4 w-4" />
                          </div>
                          <div>
                            <p className="text-[12px] font-normal">Não foi possível carregar os formulários</p>
                            <p className="mt-1 max-w-md text-[11px] font-light text-[var(--app-text-tertiary)]">
                              {formsLoadError}
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 rounded-[6px] text-[12px] font-light shadow-none"
                            onClick={() => void loadFormsForIntegration(selectedIntegration)}
                          >
                            Tentar novamente
                          </Button>
                        </div>
                      ) : !selectedIntegration ? (
                        <div className="flex h-40 items-center justify-center text-[12px] font-light text-muted-foreground">Selecione uma página para ver os formulários.</div>
                      ) : filteredForms.length === 0 ? (
                        <div className="flex h-40 items-center justify-center text-[12px] font-light text-muted-foreground">
                          {forms.length === 0 ? "Nenhum formulário encontrado." : "Nenhum formulário corresponde à busca."}
                        </div>
                      ) : (
                        <div className="min-w-0 space-y-1.5">
                          {filteredForms.map((form) => {
                            const existing = configuredByFormId.get(form.id);
                            return (
                              <div
                                key={form.id}
                                role="button"
                                tabIndex={0}
                                className="grid w-full min-w-0 cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[6px] bg-[var(--app-surface-solid)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--app-surface-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/30"
                                onClick={() => openConfig(form, existing, selectedIntegration)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    openConfig(form, existing, selectedIntegration);
                                  }
                                }}
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="flex min-w-0 items-center gap-2">
                                    <span className="break-words text-[12px] font-normal leading-4">
                                      {form.name}
                                    </span>
                                    {existing && <Badge variant="secondary" className="shrink-0">Configurado</Badge>}
                                  </div>
                                  <p className="mt-1 break-all text-[10px] text-muted-foreground">ID {form.id}</p>
                                </div>
                                <Button
                                  className="h-8 shrink-0 whitespace-nowrap rounded-[6px] px-2.5 text-[11px] font-light shadow-none"
                                  variant={existing ? "outline" : "default"}
                                  size="sm"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openConfig(form, existing, selectedIntegration);
                                  }}
                                >
                                  <FilePlus2 className="mr-2 h-4 w-4" />{existing ? "Editar" : "Configurar"}
                                </Button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </ScrollArea>
                  </div>
                  </div>
                </>
              )}
            </main>
          </div>
        </DialogContent>
      </Dialog>

      <MetaFormConfigDialog
        open={configDialogOpen}
        onOpenChange={closeConfigDialog}
        form={editingForm}
        config={editingConfig}
        integrationId={selectedIntegration?.id || editingConfig?.integration_id || ""}
        pageName={selectedIntegration?.page_name || integrationById.get(editingConfig?.integration_id || "")?.page_name}
      />
    </div>
  );
}
