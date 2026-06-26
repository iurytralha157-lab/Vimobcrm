import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlertCircle,
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
import { cn } from "@/lib/utils";
import {
  MetaIntegration,
  MetaPage,
  useMetaConnectPage,
  useMetaDisconnectPage,
  useMetaGetAuthUrl,
  useMetaIntegrations,
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
  user_token?: string;
  facebook_user_id?: string;
  facebook_user_name?: string;
}

interface AccountGroup {
  key: string;
  name: string;
  facebookUserId?: string | null;
  facebookUserName?: string | null;
  userToken?: string;
  integrations: MetaIntegration[];
  pages: MetaPage[];
  isNew?: boolean;
}

const getPagePicture = (page?: MetaPage | null) => page?.picture?.data?.url || "";
const searchableText = (value: unknown) => String(value ?? "").toLowerCase();

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
}: {
  oauthPayload?: OAuthPayload | null;
}) {
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [accountSearch, setAccountSearch] = useState("");
  const [formSearch, setFormSearch] = useState("");
  const [selectedAccountKey, setSelectedAccountKey] = useState("");
  const [selectedIntegration, setSelectedIntegration] = useState<MetaIntegration | null>(null);
  const [forms, setForms] = useState<MetaForm[]>([]);
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [editingForm, setEditingForm] = useState<MetaForm | null>(null);
  const [editingConfig, setEditingConfig] = useState<MetaFormConfig | undefined>();
  const [newOAuth, setNewOAuth] = useState<OAuthPayload | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<AccountGroup | null>(null);

  const { data: integrations = [], isLoading, refetch: refetchIntegrations } = useMetaIntegrations();
  const { data: configs = [], refetch: refetchConfigs } = useAllMetaFormConfigs();
  const getAuthUrl = useMetaGetAuthUrl();
  const connectPage = useMetaConnectPage();
  const disconnectPage = useMetaDisconnectPage();
  const fetchForms = useFetchPageForms();
  const toggleForm = useToggleFormConfig();
  const deleteForm = useDeleteFormConfig();

  useEffect(() => {
    if (oauthPayload !== undefined) return;

    const params = new URLSearchParams(window.location.search);
    const raw = params.get("meta_oauth_data");
    if (!raw) return;

    try {
      const decoded = decodeURIComponent(raw);
      const payload = JSON.parse(decoded);

      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: "META_OAUTH_SUCCESS", data: payload }, window.location.origin);
        window.close();
        return;
      }

      queueMicrotask(() => {
        setNewOAuth(payload);
        setSelectedAccountKey("new-oauth");
        setWizardOpen(true);
        toast.success("Conta do Facebook conectada. Escolha a página para continuar.");
      });
    } catch (error) {
      console.error("Invalid Meta OAuth payload", error);
    } finally {
      params.delete("meta_oauth_data");
      window.history.replaceState({}, "", `${window.location.pathname}${params.toString() ? `?${params}` : ""}`);
    }
  }, [oauthPayload]);

  useEffect(() => {
    if (!oauthPayload) return;
    queueMicrotask(() => {
      setNewOAuth(oauthPayload);
      setSelectedAccountKey("new-oauth");
      setWizardOpen(true);
      setAccountModalOpen(false);
      toast.success("Conta do Facebook conectada. Escolha a página para continuar.");
    });
  }, [oauthPayload]);

  useEffect(() => {
    if (oauthPayload !== undefined) return;

    const handleMessage = (event: MessageEvent) => {
      if (!event.data || event.data.type !== "META_OAUTH_SUCCESS") return;
      setNewOAuth(event.data.data || null);
      setSelectedAccountKey("new-oauth");
      setWizardOpen(true);
      setAccountModalOpen(false);
      toast.success("Conta do Facebook conectada. Escolha a página para continuar.");
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [oauthPayload]);

  const accounts = useMemo<AccountGroup[]>(() => {
    const grouped = new Map<string, AccountGroup>();

    for (const integration of integrations) {
      const key = integration.facebook_user_id || integration.facebook_user_name || integration.page_id || integration.id;
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
        userToken: newOAuth.user_token,
        integrations: [],
        pages: newOAuth.pages,
        isNew: true,
      });
    }

    return Array.from(grouped.values());
  }, [integrations, newOAuth]);

  const selectedAccount = accounts.find((account) => account.key === selectedAccountKey) || accounts[0];
  const configuredByFormId = useMemo(() => new Map(configs.map((config) => [config.form_id, config])), [configs]);
  const integrationById = useMemo(() => new Map(integrations.map((integration) => [integration.id, integration])), [integrations]);

  const getConfiguredFormsForIntegration = (integrationId?: string | null) =>
    integrationId ? configs.filter((config) => config.integration_id === integrationId) : [];

  const filteredAccounts = accounts.filter((account) =>
    searchableText(account.name).includes(searchableText(accountSearch))
  );

  const filteredForms = forms.filter((form) => {
    const search = searchableText(formSearch.trim());
    if (!search) return true;
    return [form.name, form.id, form.status].some((value) => searchableText(value).includes(search));
  });

  const openOAuth = async () => {
    const returnUrl = `${window.location.origin}${window.location.pathname}${window.location.search}`;
    const result = await getAuthUrl.mutateAsync({ returnUrl });
    const popup = window.open(result.auth_url, "meta_oauth", "width=600,height=720");
    if (!popup) window.location.href = result.auth_url;
  };

  const disconnectAccount = async (account: AccountGroup) => {
    for (const integration of account.integrations) {
      if (integration.page_id) await disconnectPage.mutateAsync(integration.page_id);
    }
    await refetchIntegrations();
    setDisconnectTarget(null);
  };

  const loadFormsForIntegration = async (integration: MetaIntegration) => {
    if (!integration.page_id) {
      toast.error("Página sem identificador válido para buscar formulários.");
      return;
    }
    setSelectedIntegration(integration);
    const result = await fetchForms.mutateAsync({ pageId: integration.page_id });
    setForms(mergeFormsWithConfigured(result.forms || [], getConfiguredFormsForIntegration(integration.id)));
  };

  const connectAndLoadPage = async (page: MetaPage) => {
    if (!selectedAccount?.userToken) return;

    const result = await connectPage.mutateAsync({
      pageId: page.id,
      userToken: selectedAccount.userToken,
      facebookUserId: selectedAccount.facebookUserId || undefined,
      facebookUserName: selectedAccount.facebookUserName || selectedAccount.name,
      pagePictureUrl: getPagePicture(page),
    });

    await refetchIntegrations();
    const refreshed = await refetchIntegrations();
    const integration = (refreshed.data || []).find((item) => item.page_id === page.id);
    if (integration) {
      await loadFormsForIntegration(integration);
    } else if (result?.success) {
      toast.success("Página conectada. Reabra o wizard se os formulários não aparecerem agora.");
    }
  };

  const handleSelectPage = async (page: MetaPage | MetaIntegration) => {
    setForms([]);
    setFormSearch("");

    if ("page_id" in page) {
      await loadFormsForIntegration(page);
      return;
    }

    const existing = integrations.find((integration) => integration.page_id === page.id);
    if (existing) {
      await loadFormsForIntegration(existing);
      return;
    }

    await connectAndLoadPage(page);
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

  const pageItems = selectedAccount
    ? selectedAccount.isNew
      ? selectedAccount.pages
      : selectedAccount.integrations
    : [];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={formSearch}
            onChange={(event) => setFormSearch(event.target.value)}
            placeholder="Buscar formulário configurado"
            className="pl-9"
          />
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          <Button variant="outline" className="gap-2 whitespace-nowrap" onClick={() => setAccountModalOpen(true)}>
            <Settings className="h-4 w-4" />
            Gerenciar contas
          </Button>
          <Button className="gap-2 whitespace-nowrap" onClick={() => setWizardOpen(true)}>
            <Plus className="h-4 w-4" />
            Adicionar formulários
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-white/[0.055] bg-white/[0.035]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Conta Facebook</TableHead>
              <TableHead>Página Facebook</TableHead>
              <TableHead>Nome do formulário</TableHead>
              <TableHead>Criado por</TableHead>
              <TableHead>Data de configuração</TableHead>
              <TableHead className="w-12 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="h-28 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></TableCell></TableRow>
            ) : configs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-40 text-center text-muted-foreground">
                  Nenhum formulário Meta configurado ainda.
                </TableCell>
              </TableRow>
            ) : (
              configs
                .filter((config) => {
                  const search = formSearch.trim().toLowerCase();
                  if (!search) return true;
                  const integration = integrationById.get(config.integration_id);
                  return [
                    config.form_name,
                    config.form_id,
                    integration?.facebook_user_name,
                    integration?.page_name,
                    config.created_by_name,
                  ]
                    .filter(Boolean)
                    .some((value) => String(value).toLowerCase().includes(search));
                })
                .map((config) => {
                  const integration = integrationById.get(config.integration_id);
                  return (
                    <TableRow
                      key={config.id}
                      className="cursor-pointer"
                      onClick={() => openConfig(buildConfigForm(config), config, integration)}
                    >
                      <TableCell>{integration?.facebook_user_name || "Conta Facebook"}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar className="h-7 w-7">
                            <AvatarImage src={integration?.page_picture_url || undefined} />
                            <AvatarFallback>{integration?.page_name?.[0] || "F"}</AvatarFallback>
                          </Avatar>
                          <span>{integration?.page_name || "Página conectada"}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{config.form_name || config.form_id}</span>
                          <Badge variant={config.is_active ? "default" : "secondary"}>{config.is_active ? "Ativo" : "Inativo"}</Badge>
                          {!config.round_robin_id && <Badge variant="outline">Sem fila vinculada</Badge>}
                        </div>
                      </TableCell>
                      <TableCell>{config.created_by_name || "-"}</TableCell>
                      <TableCell>{format(new Date(config.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}</TableCell>
                      <TableCell className="text-right" onClick={(event) => event.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon"><MoreVertical className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openConfig(buildConfigForm(config), config, integration)}>
                              <Settings className="mr-2 h-4 w-4" />Editar configuração
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => toggleForm.mutate({ formId: config.form_id, integrationId: config.integration_id, isActive: !config.is_active })}>
                              {config.is_active ? <Unplug className="mr-2 h-4 w-4" /> : <Plug className="mr-2 h-4 w-4" />}
                              {config.is_active ? "Desativar" : "Ativar"} formulário
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive" onClick={() => deleteForm.mutate({ formId: config.form_id, integrationId: config.integration_id })}>
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
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Globe className="h-5 w-5 text-blue-600" />Gerenciar contas do Facebook</DialogTitle>
            <DialogDescription>Conecte ou desconecte contas usadas para buscar páginas e formulários.</DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" value={accountSearch} onChange={(event) => setAccountSearch(event.target.value)} placeholder="Buscar conta" />
          </div>
          <ScrollArea className="max-h-72 pr-3">
            <div className="space-y-2">
              {filteredAccounts.map((account) => (
                <div key={account.key} className="flex items-center justify-between rounded-lg border border-white/[0.055] bg-white/[0.035] p-3">
                  <div>
                    <p className="font-medium">{account.name}</p>
                    <p className="text-xs text-muted-foreground">{account.integrations.length || account.pages.length} páginas disponíveis</p>
                  </div>
                  {account.integrations.length > 0 && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setDisconnectTarget(account)}
                      disabled={disconnectPage.isPending}
                    >
                      Desconectar
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
          <DialogFooter className="items-center justify-between sm:justify-between">
            <p className="text-sm text-muted-foreground">Existem {accounts.filter((a) => !a.isNew).length} contas conectadas</p>
            <Button onClick={openOAuth} disabled={getAuthUrl.isPending}>{getAuthUrl.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Conectar nova conta</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!disconnectTarget} onOpenChange={(open) => !open && setDisconnectTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desconectar conta?</AlertDialogTitle>
            <AlertDialogDescription>
              A conta {disconnectTarget?.name} será desconectada das páginas e formulários Meta vinculados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => disconnectTarget && disconnectAccount(disconnectTarget)}
            >
              Desconectar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={wizardOpen} onOpenChange={setWizardOpen}>
        <DialogContent className="w-[96vw] max-w-[1100px] max-h-[92vh] p-0 overflow-hidden">
          <div className="grid max-h-[92vh] min-h-[520px] min-w-0 grid-cols-1 lg:grid-cols-[minmax(260px,320px)_minmax(0,1fr)]">
            <aside className="min-w-0 overflow-y-auto border-r border-white/[0.055] bg-white/[0.035] p-4 space-y-3">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2"><Plug className="h-5 w-5 text-primary" />Criar nova integração</DialogTitle>
                <DialogDescription>Escolha uma conta, uma página e o formulário que será configurado.</DialogDescription>
              </DialogHeader>
              <Button className="w-full gap-2 bg-blue-600 text-white hover:bg-blue-700" onClick={openOAuth}><ExternalLink className="h-4 w-4" />Conectar nova conta</Button>
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase text-muted-foreground">Contas Facebook</p>
                {accounts.map((account) => (
                  <button
                    key={account.key}
                    type="button"
                    className={cn("flex w-full items-center justify-between rounded-lg border border-white/[0.055] p-2.5 text-left hover:bg-white/[0.055]", selectedAccount?.key === account.key && "border-primary bg-primary/10")}
                    onClick={() => {
                      setSelectedAccountKey(account.key);
                      setSelectedIntegration(null);
                      setForms([]);
                    }}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{account.name}</p>
                      <p className="text-xs text-muted-foreground">{account.isNew ? "Nova conexão" : "Conta conectada"}</p>
                    </div>
                    {selectedAccount?.key === account.key && <Check className="h-4 w-4 shrink-0 text-primary" />}
                  </button>
                ))}
              </div>
            </aside>

            <main className="min-w-0 overflow-y-auto p-4 space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <h3 className="text-lg font-semibold">Páginas e formulários</h3>
                  <p className="text-sm text-muted-foreground">Selecione uma página para carregar os formulários ativos.</p>
                </div>
              </div>

              {!selectedAccount ? (
                <Alert><AlertCircle className="h-4 w-4" /><AlertDescription>Conecte ou selecione uma conta do Facebook para continuar.</AlertDescription></Alert>
              ) : (
                <div className="grid min-w-0 grid-cols-1 xl:grid-cols-[minmax(240px,300px)_minmax(0,1fr)] gap-4">
                  <div className="min-w-0 rounded-xl border border-white/[0.055] bg-white/[0.035] p-2.5 space-y-2">
                    <p className="text-xs font-medium uppercase text-muted-foreground">Páginas</p>
                    <ScrollArea className="h-[370px] pr-3">
                      <div className="space-y-2">
                        {pageItems.map((page) => {
                          const isIntegrationPage = "page_id" in page;
                          const pageId = isIntegrationPage ? page.page_id : page.id;
                          const name = isIntegrationPage ? page.page_name : page.name;
                          const picture = isIntegrationPage ? page.page_picture_url : getPagePicture(page);
                          const active = selectedIntegration?.page_id === pageId;
                          return (
                            <button key={pageId} type="button" className={cn("flex w-full min-w-0 items-center justify-between rounded-lg border border-white/[0.055] p-2.5 text-left hover:bg-white/[0.055]", active && "border-primary bg-primary/10")} onClick={() => handleSelectPage(page)}>
                              <div className="flex min-w-0 items-center gap-3">
                                <Avatar className="h-10 w-10"><AvatarImage src={picture || undefined} /><AvatarFallback>{name?.[0] || "F"}</AvatarFallback></Avatar>
                                <span className="truncate font-medium">{name}</span>
                              </div>
                              {active && <Check className="h-4 w-4 shrink-0 text-primary" />}
                            </button>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  </div>

                  <div className="min-w-0 overflow-hidden rounded-xl border border-white/[0.055] bg-white/[0.035] p-2.5 space-y-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="font-medium">Formulários</p>
                        <p className="truncate text-xs text-muted-foreground">{selectedIntegration ? `${forms.length} formulários encontrados em ${selectedIntegration.page_name}` : "Escolha uma página"}</p>
                      </div>
                      <div className="relative min-w-0 sm:w-64 lg:w-72">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input className="pl-9" value={formSearch} onChange={(event) => setFormSearch(event.target.value)} placeholder="Buscar formulário" />
                      </div>
                    </div>
                    <ScrollArea className="h-[370px] pr-2">
                      {fetchForms.isPending || connectPage.isPending ? (
                        <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>
                      ) : !selectedIntegration ? (
                        <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">Selecione uma página para ver os formulários.</div>
                      ) : filteredForms.length === 0 ? (
                        <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">Nenhum formulário encontrado.</div>
                      ) : (
                        <div className="min-w-0 overflow-hidden rounded-lg border border-white/[0.055]">
                          {filteredForms.map((form) => {
                            const existing = configuredByFormId.get(form.id);
                            return (
                              <div
                                key={form.id}
                                role="button"
                                tabIndex={0}
                                className="grid w-full min-w-0 cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-3 text-left transition-colors hover:bg-white/[0.06]"
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
                                    <span className="truncate font-medium">{form.name}</span>
                                    {existing && <Badge variant="secondary" className="shrink-0">Configurado</Badge>}
                                  </div>
                                  <p className="truncate text-xs text-muted-foreground">ID {form.id}</p>
                                </div>
                                <Button
                                  className="shrink-0 whitespace-nowrap"
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
