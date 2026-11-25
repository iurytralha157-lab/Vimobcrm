"use client";

import { useMemo, useState } from "react";
import { ExternalLink, Loader2, ShieldCheck, Target } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import { Switch } from "@/components/ui/switch";
import {
  type MetaIntegration,
  useMetaConversionFeedback,
} from "@/hooks/use-meta-integration";
import { cn } from "@/lib/utils";

type FeedbackState = "active" | "awaiting_first_send" | "paused" | "error" | "not_configured";

const feedbackStatus: Record<
  FeedbackState,
  {
    label: string;
    variant: "default" | "secondary" | "destructive" | "outline";
  }
> = {
  active: { label: "Ativa", variant: "default" },
  awaiting_first_send: { label: "Aguardando primeiro envio", variant: "secondary" },
  paused: { label: "Pausada", variant: "secondary" },
  error: { label: "Requer atenção", variant: "destructive" },
  not_configured: { label: "Não configurada", variant: "outline" },
};

function getFeedbackState(integration: MetaIntegration): FeedbackState {
  if (
    integration.conversion_feedback_status === "error" ||
    integration.conversion_feedback_last_error
  ) {
    return "error";
  }

  if (
    integration.conversion_feedback_enabled &&
    integration.conversion_feedback_status === "active"
  ) {
    return integration.conversion_feedback_last_sent_at ? "active" : "awaiting_first_send";
  }

  if (integration.crm_dataset_id) return "paused";
  return "not_configured";
}

function getDatasetLabel(integration: MetaIntegration) {
  if (integration.crm_dataset_name) return integration.crm_dataset_name;
  if (integration.crm_dataset_id) return `Dataset ${integration.crm_dataset_id}`;
  return "Dataset não configurado";
}

export function MetaConversionFeedbackPanel({
  integrations,
  moduleEnabled,
  accessLoading,
  integrationsLoading,
  integrationsLoadFailed,
}: {
  integrations: MetaIntegration[];
  moduleEnabled: boolean;
  accessLoading: boolean;
  integrationsLoading: boolean;
  integrationsLoadFailed: boolean;
}) {
  const [managementOpen, setManagementOpen] = useState(false);
  const [selected, setSelected] = useState<MetaIntegration | null>(null);
  const [datasetId, setDatasetId] = useState("");
  const [datasetName, setDatasetName] = useState("");
  const [datasetToken, setDatasetToken] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [editingDestination, setEditingDestination] = useState(false);
  const saveFeedback = useMetaConversionFeedback();

  const connected = useMemo(
    () => integrations.filter((integration) => integration.is_connected),
    [integrations],
  );
  const activeCount = connected.filter(
    (integration) => {
      const state = getFeedbackState(integration);
      return state === "active" || state === "awaiting_first_send";
    },
  ).length;
  const configuredCount = connected.filter(
    (integration) => Boolean(integration.crm_dataset_id),
  ).length;
  const attentionCount = connected.filter(
    (integration) => getFeedbackState(integration) === "error",
  ).length;

  const openConfiguration = (integration: MetaIntegration) => {
    setManagementOpen(false);
    setSelected(integration);
    setDatasetId(integration.crm_dataset_id || "");
    setDatasetName(integration.crm_dataset_name || "");
    setDatasetToken("");
    setEnabled(Boolean(integration.conversion_feedback_enabled));
    setEditingDestination(!integration.crm_dataset_id);
  };

  const closeConfiguration = (open: boolean) => {
    if (!open && !saveFeedback.isPending) {
      setSelected(null);
      setDatasetToken("");
      setEditingDestination(false);
      saveFeedback.reset();
    }
  };

  const configuredBefore = Boolean(selected?.crm_dataset_id);
  const activatingFeedback = Boolean(
    selected && enabled && !selected.conversion_feedback_enabled,
  );
  const canReuseStoredToken = Boolean(
    configuredBefore && datasetId.trim() === selected?.crm_dataset_id,
  );
  const normalizedDatasetId = datasetId.trim();
  const datasetIdIsValid =
    normalizedDatasetId === "" || /^\d{5,30}$/.test(normalizedDatasetId);
  const destinationCredentialIsValid =
    normalizedDatasetId === "" ||
    canReuseStoredToken ||
    Boolean(datasetToken.trim());
  const datasetIdError = enabled && normalizedDatasetId === ""
    ? "Informe o ID do CRM Dataset para ativar os envios."
    : !datasetIdIsValid
      ? "Use de 5 a 30 dígitos no ID do CRM Dataset."
      : null;
  const datasetTokenError =
    normalizedDatasetId !== "" && !destinationCredentialIsValid
      ? "Informe o token emitido para este CRM Dataset."
      : null;
  const isLoading = accessLoading || integrationsLoading;
  const canSave = Boolean(
    selected && connected.some((integration) => integration.id === selected.id) &&
    moduleEnabled && !isLoading && !integrationsLoadFailed &&
    !datasetIdError && !datasetTokenError,
  );

  const onlyConnection = connected.length === 1 ? connected[0] : null;
  const onlyConnectionState = onlyConnection
    ? getFeedbackState(onlyConnection)
    : null;

  let summaryStatus = feedbackStatus.not_configured;
  let summaryText = "Conecte uma Página Meta para configurar os envios.";
  let actionLabel = "Sem página";
  let actionDisabled = true;

  if (isLoading) {
    summaryStatus = { label: "Verificando", variant: "secondary" };
    summaryText = "Verificando a configuração da integração.";
    actionLabel = "Aguarde";
  } else if (!moduleEnabled) {
    summaryStatus = { label: "Indisponível", variant: "secondary" };
    summaryText = "Disponível quando o módulo Marketing estiver ativo.";
    actionLabel = "Indisponível";
  } else if (integrationsLoadFailed) {
    summaryStatus = { label: "Indisponível", variant: "destructive" };
    summaryText = "Não foi possível verificar os envios agora.";
    actionLabel = "Indisponível";
  } else if (onlyConnection && onlyConnectionState) {
    summaryStatus = feedbackStatus[onlyConnectionState];
    actionDisabled = false;
    actionLabel = onlyConnection.crm_dataset_id ? "Revisar" : "Configurar";
    const pageName = onlyConnection.page_name || "Página Meta";
    summaryText = onlyConnectionState === "active"
      ? `Envios ativos para ${pageName}.`
      : onlyConnectionState === "awaiting_first_send"
        ? `Envios habilitados para ${pageName}. Aguardando um novo evento do funil.`
        : onlyConnectionState === "paused"
          ? `Envios pausados para ${pageName}.`
          : onlyConnectionState === "error"
            ? `Revise a configuração de ${pageName}.`
            : `Configure os envios de ${pageName}.`;
  } else if (connected.length > 1) {
    actionDisabled = false;
    actionLabel = "Gerenciar";

    if (attentionCount > 0) {
      summaryStatus = feedbackStatus.error;
      summaryText = `${attentionCount} de ${connected.length} páginas requer revisão.`;
    } else if (activeCount > 0) {
      summaryStatus = {
        label: `${activeCount}/${connected.length} ativas`,
        variant: "default",
      };
      summaryText = "Gerencie os envios por Página Meta.";
    } else if (configuredCount > 0) {
      summaryStatus = feedbackStatus.paused;
      summaryText = "Os envios configurados estão pausados.";
    } else {
      summaryText = `${connected.length} páginas prontas para configurar.`;
    }
  }

  const handlePrimaryAction = () => {
    if (actionDisabled) return;
    if (onlyConnection) {
      openConfiguration(onlyConnection);
      return;
    }
    setManagementOpen(true);
  };

  const submit = async () => {
    if (!selected || !canSave || saveFeedback.isPending) return;

    try {
      await saveFeedback.mutateAsync({
        integrationId: selected.id,
        datasetId: normalizedDatasetId || null,
        datasetName: datasetName.trim() || null,
        datasetAccessToken: datasetToken.trim() || null,
        enabled,
        replayRecentFacts: false,
      });
      setSelected(null);
      setDatasetToken("");
      setEditingDestination(false);
    } catch {
      // The mutation already renders the backend error as a toast. Keeping the
      // dialog open lets the administrator correct the configuration safely.
    } finally {
      saveFeedback.reset();
    }
  };

  return (
    <>
      <section
        className="app-card flex shrink-0 flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"
        aria-labelledby="meta-feedback-title"
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] bg-primary/10 text-primary">
            <Target className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 id="meta-feedback-title" className="app-card-title">
                Enviar qualidade dos leads ao Meta
              </h3>
              <Badge variant={summaryStatus.variant} aria-live="polite">
                {summaryStatus.label}
              </Badge>
            </div>
            <p className="mt-0.5 truncate text-xs text-[var(--app-text-tertiary)] sm:max-w-2xl">
              {summaryText}
            </p>
          </div>
        </div>

        <Button
          type="button"
          variant={onlyConnection?.crm_dataset_id || connected.length > 1 ? "outline" : "default"}
          size="sm"
          className="shrink-0"
          disabled={actionDisabled}
          onClick={handlePrimaryAction}
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {actionLabel}
        </Button>
      </section>

      <Dialog open={managementOpen} onOpenChange={setManagementOpen}>
        <DialogContent className="border-0 bg-[var(--app-surface-solid)] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Qualidade dos leads por página</DialogTitle>
            <DialogDescription>
              Escolha uma Página Meta para configurar, ativar ou pausar os envios.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[min(420px,60dvh)] space-y-2 overflow-y-auto pr-1">
            {connected.map((integration) => {
              const state = getFeedbackState(integration);
              const status = feedbackStatus[state];

              return (
                <div
                  key={integration.id}
                  className="app-card-soft flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-normal">
                        {integration.page_name || "Página Meta"}
                      </p>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-[var(--app-text-tertiary)]">
                      {getDatasetLabel(integration)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => openConfiguration(integration)}
                  >
                    {integration.crm_dataset_id ? "Revisar" : "Configurar"}
                  </Button>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(selected)} onOpenChange={closeConfiguration}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto border-0 bg-[var(--app-surface-solid)] sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
              Devolução de qualidade
            </DialogTitle>
            <DialogDescription>
              {selected?.page_name || "Página Meta"} · envio dos novos estágios do funil.
            </DialogDescription>
          </DialogHeader>

          <Alert className="border-0 bg-primary/10">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <AlertDescription className="text-[var(--app-text-secondary)]">
              Os eventos incluem o ID original do lead e, quando disponíveis, e-mail e telefone com hash.
              Os dados seguem para o CRM Dataset escolhido nesta organização. O token do Dataset fica protegido no cofre.
            </AlertDescription>
          </Alert>

          <div className="space-y-4 py-1">
            {configuredBefore && !editingDestination ? (
              <div className="app-card-soft flex flex-col gap-3 p-3.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-normal">CRM Dataset</p>
                  <p className="mt-0.5 truncate text-xs text-[var(--app-text-tertiary)]">
                    {selected ? getDatasetLabel(selected) : "Dataset configurado"}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => setEditingDestination(true)}
                >
                  Alterar Dataset
                </Button>
              </div>
            ) : (
              <>
                <section className="app-card-soft space-y-3 p-3.5" aria-labelledby="meta-crm-setup-title">
                  <div className="space-y-1">
                    <h3 id="meta-crm-setup-title" className="text-sm font-medium">
                      Onde encontrar o ID e o token
                    </h3>
                    <p className="text-xs leading-5 text-[var(--app-text-secondary)]">
                      O conjunto de dados (Dataset) recebe os resultados dos leads na Meta.
                      O token é a chave que autoriza o Vimob a enviar para esse destino.
                    </p>
                  </div>
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="h-auto min-h-9 w-full whitespace-normal py-2 text-center sm:w-auto"
                  >
                    <a
                      href="https://www.facebook.com/events_manager2/list"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Abrir Gerenciador de Eventos da Meta
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      <span className="sr-only">(abre em outra aba)</span>
                    </a>
                  </Button>
                  <ol className="list-decimal space-y-1 pl-4 text-xs leading-5 text-[var(--app-text-secondary)]">
                    <li>Entre na Meta com acesso de administrador e selecione o portfólio empresarial da imobiliária.</li>
                    <li>
                      Abra o conjunto de dados conectado ao CRM. Se ainda não tiver um, use{" "}
                      <strong>Conectar fontes de dados → CRM</strong> e escolha <strong>Código manual</strong>.
                      O Vimob já cuida do envio.
                    </li>
                    <li>
                      Em <strong>Configurações</strong>, copie o ID do conjunto de dados. Na seção{" "}
                      <strong>API de Conversões</strong>, clique em <strong>Gerar token de acesso</strong>.
                    </li>
                    <li>Volte ao Vimob e cole o ID e o token nos campos abaixo.</li>
                  </ol>
                  <p className="text-xs leading-5 text-[var(--app-text-secondary)]">
                    Se o conjunto ou o botão de gerar token não aparecer, peça ajuda ao administrador
                    do portfólio empresarial da Meta.
                  </p>
                </section>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="meta-crm-dataset-id">ID do conjunto de dados</Label>
                    <Input
                      id="meta-crm-dataset-id"
                      inputMode="numeric"
                      autoComplete="off"
                      value={datasetId}
                      onChange={(event) =>
                        setDatasetId(event.target.value.replace(/\D/g, "").slice(0, 30))
                      }
                      aria-invalid={Boolean(datasetIdError)}
                      aria-describedby={datasetIdError ? "meta-crm-dataset-id-error" : undefined}
                      placeholder="Ex.: 123456789012345"
                    />
                    {datasetIdError ? (
                      <p id="meta-crm-dataset-id-error" className="text-xs text-destructive" role="alert">
                        {datasetIdError}
                      </p>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="meta-crm-dataset-name">Nome no Vimob (opcional)</Label>
                    <Input
                      id="meta-crm-dataset-name"
                      value={datasetName}
                      onChange={(event) => setDatasetName(event.target.value.slice(0, 160))}
                      placeholder="Ex.: Vimob · Imobiliária"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="meta-crm-dataset-token">Token da API de Conversões</Label>
                  <Input
                    id="meta-crm-dataset-token"
                    type="password"
                    autoComplete="new-password"
                    value={datasetToken}
                    onChange={(event) => setDatasetToken(event.target.value)}
                    maxLength={8192}
                    aria-invalid={Boolean(datasetTokenError)}
                    aria-describedby={
                      datasetTokenError
                        ? "meta-crm-dataset-token-help meta-crm-dataset-token-error"
                        : "meta-crm-dataset-token-help"
                    }
                    placeholder={
                      configuredBefore
                        ? "Token protegido no cofre · deixe em branco para manter"
                        : "Cole o token gerado no Gerenciador de Eventos"
                    }
                  />
                  <p id="meta-crm-dataset-token-help" className="text-xs leading-5 text-[var(--app-text-tertiary)]">
                    {configuredBefore
                      ? "Ao trocar o ID, informe também o token do novo conjunto de dados."
                      : "Cole aqui o token gerado para o mesmo conjunto de dados do ID acima."}
                  </p>
                  {datasetTokenError ? (
                    <p id="meta-crm-dataset-token-error" className="text-xs text-destructive" role="alert">
                      {datasetTokenError}
                    </p>
                  ) : null}
                </div>
              </>
            )}

            <div
              className={cn(
                "app-card-soft flex items-start justify-between gap-4 p-3.5",
                enabled && "ring-1 ring-primary/25",
              )}
            >
              <div className="min-w-0">
                <Label htmlFor="meta-feedback-enabled" className="text-sm font-medium">
                  Enviar novos resultados ao Meta
                </Label>
                <p className="mt-1 text-xs leading-5 text-[var(--app-text-secondary)]">
                  A ativação começa a enviar os novos resultados da Página a partir de agora.
                </p>
              </div>
              <Switch
                id="meta-feedback-enabled"
                checked={enabled}
                onCheckedChange={setEnabled}
                aria-label="Ativar devolução de qualidade para o Meta"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => closeConfiguration(false)}
              disabled={saveFeedback.isPending}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => void submit()}
              disabled={!canSave || saveFeedback.isPending}
            >
              {saveFeedback.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {activatingFeedback ? "Ativar novos envios" : "Salvar configuração"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
