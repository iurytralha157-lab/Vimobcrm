"use client";

import { useMemo, useState } from "react";
import { Loader2, ShieldCheck, Target } from "lucide-react";
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

type FeedbackState = "active" | "paused" | "error" | "not_configured";

const feedbackStatus: Record<
  FeedbackState,
  {
    label: string;
    variant: "default" | "secondary" | "destructive" | "outline";
  }
> = {
  active: { label: "Ativa", variant: "default" },
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
    return "active";
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
  const [testEventCode, setTestEventCode] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [editingDestination, setEditingDestination] = useState(false);
  const saveFeedback = useMetaConversionFeedback();

  const connected = useMemo(
    () => integrations.filter((integration) => integration.is_connected),
    [integrations],
  );
  const activeCount = connected.filter(
    (integration) => getFeedbackState(integration) === "active",
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
    setTestEventCode("");
    setEnabled(Boolean(integration.conversion_feedback_enabled));
    setEditingDestination(!integration.crm_dataset_id);
  };

  const closeConfiguration = (open: boolean) => {
    if (!open && !saveFeedback.isPending) {
      setSelected(null);
      setDatasetToken("");
      setTestEventCode("");
      setEditingDestination(false);
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
  const canSave = Boolean(
    selected && !datasetIdError && !datasetTokenError,
  );

  const isLoading = accessLoading || integrationsLoading;
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
    if (!selected || !canSave) return;
    const replayRecentFacts = enabled && !selected.conversion_feedback_enabled;
    const normalizedTestEventCode = testEventCode.trim();

    try {
      await saveFeedback.mutateAsync({
        integrationId: selected.id,
        datasetId: normalizedDatasetId || null,
        datasetName: datasetName.trim() || null,
        datasetAccessToken: datasetToken.trim() || null,
        enabled,
        replayRecentFacts,
        ...(replayRecentFacts && normalizedTestEventCode
          ? { testEventCode: normalizedTestEventCode }
          : {}),
      });
      setSelected(null);
      setDatasetToken("");
      setTestEventCode("");
      setEditingDestination(false);
    } catch {
      // The mutation already renders the backend error as a toast. Keeping the
      // dialog open lets the administrator correct the configuration safely.
    }
  };

  return (
    <>
      <section
        className="app-card flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"
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
              O token do CRM Dataset vai direto ao backend, fica protegido no cofre e nunca retorna ao navegador.
            </AlertDescription>
          </Alert>

          <div className="space-y-4 py-1">
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
                  {configuredBefore
                    ? "Ative ou pause os próximos envios sem alterar o Dataset salvo."
                    : "Ative os envios e informe o CRM Dataset usado pelo Meta."}
                </p>
              </div>
              <Switch
                id="meta-feedback-enabled"
                checked={enabled}
                onCheckedChange={(checked) => {
                  setEnabled(checked);
                  if (!checked) setTestEventCode("");
                }}
                aria-label="Ativar devolução de qualidade para o Meta"
              />
            </div>

            {activatingFeedback ? (
              <div className="space-y-2">
                <Label htmlFor="meta-test-event-code">Código de teste do Meta</Label>
                <Input
                  id="meta-test-event-code"
                  autoComplete="off"
                  value={testEventCode}
                  onChange={(event) => setTestEventCode(event.target.value.slice(0, 255))}
                  maxLength={255}
                  aria-describedby="meta-test-event-code-help"
                  placeholder="Opcional"
                />
                <p
                  id="meta-test-event-code-help"
                  className="text-xs leading-5 text-[var(--app-text-tertiary)]"
                >
                  Fatos reais dos últimos 7 dias serão enviados; com o código, os Test Events também contam para a mensuração.
                </p>
              </div>
            ) : null}

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
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="meta-crm-dataset-id">ID do CRM Dataset</Label>
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
                    <Label htmlFor="meta-crm-dataset-name">Nome para identificação</Label>
                    <Input
                      id="meta-crm-dataset-name"
                      value={datasetName}
                      onChange={(event) => setDatasetName(event.target.value.slice(0, 160))}
                      placeholder="Ex.: Vimob · Imobiliária"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="meta-crm-dataset-token">Token de acesso do Dataset</Label>
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
                    Ao trocar o ID do Dataset, informe também um novo token para impedir envio ao ativo errado.
                  </p>
                  {datasetTokenError ? (
                    <p id="meta-crm-dataset-token-error" className="text-xs text-destructive" role="alert">
                      {datasetTokenError}
                    </p>
                  ) : null}
                </div>
              </>
            )}
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
              {activatingFeedback ? "Ativar e enviar últimos 7 dias" : "Salvar configuração"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
