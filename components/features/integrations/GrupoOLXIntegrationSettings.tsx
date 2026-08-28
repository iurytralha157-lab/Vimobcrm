"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileCode2,
  History,
  Loader2,
  PauseCircle,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useProperties, type Property } from "@/hooks/use-properties";
import { usePipelines, useStages } from "@/hooks/use-stages";
import { useUsers } from "@/hooks/use-users";
import { useRoundRobins } from "@/hooks/use-round-robins";
import {
  getGrupoOLXPublicURLs,
  useActivateGrupoOLXIntegration,
  useGrupoOLXImportReports,
  useGrupoOLXIntegration,
  useGrupoOLXPublications,
  usePauseGrupoOLXIntegration,
  useRegenerateGrupoOLXFeedToken,
  useRegenerateGrupoOLXWebhookToken,
  useReplayGrupoOLXImportReport,
  useSaveGrupoOLXIntegration,
  useSaveGrupoOLXPublications,
  type GrupoOLXIntegration,
  type GrupoOLXImportReport,
  type GrupoOLXPublication,
} from "@/hooks/use-grupo-olx-integration";

type SettingsDraft = {
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  detailBaseURL: string;
  defaultPipelineId: string;
  defaultStageId: string;
  defaultAssignedUserId: string;
  defaultRoundRobinId: string;
};

type PublicationDraft = {
  clientListingId: string;
  publicationType: string;
  isDirty: boolean;
};

const emptySettingsDraft: SettingsDraft = {
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  detailBaseURL: "",
  defaultPipelineId: "",
  defaultStageId: "",
  defaultAssignedUserId: "",
  defaultRoundRobinId: "",
};

const publicationTypes = [
  { value: "STANDARD", label: "Standard" },
  { value: "PREMIUM", label: "Premium" },
  { value: "SUPER_PREMIUM", label: "Super premium" },
  { value: "PREMIERE_1", label: "Premiere 1" },
  { value: "PREMIERE_2", label: "Premiere 2" },
  { value: "TRIPLE", label: "Triple" },
];

const emptyPublications: GrupoOLXPublication[] = [];
const emptyProperties: Property[] = [];

function getPublicationPropertyId(publication: GrupoOLXPublication) {
  if (publication.property_id) return publication.property_id;
  return typeof publication.property?.id === "string" ? publication.property.id : "";
}

function getSettingText(settings: Record<string, unknown> | null | undefined, key: string) {
  const value = settings?.[key];
  return typeof value === "string" ? value : "";
}

function settingsDraftFromIntegration(integration: GrupoOLXIntegration | null | undefined): SettingsDraft {
  return {
    contactName: getSettingText(integration?.settings, "contact_name"),
    contactEmail: getSettingText(integration?.settings, "contact_email"),
    contactPhone: getSettingText(integration?.settings, "contact_phone"),
    detailBaseURL: getSettingText(integration?.settings, "detail_base_url"),
    defaultPipelineId: integration?.default_pipeline_id || "",
    defaultStageId: integration?.default_stage_id || "",
    defaultAssignedUserId: integration?.default_assigned_user_id || "",
    defaultRoundRobinId: integration?.default_round_robin_id || "",
  };
}

function getPropertyPrice(property: Property) {
  const salePrice = Number(property.preco || 0);
  const rentPrice = Number(property.valor_locacao || 0);
  const value = salePrice > 0 ? salePrice : rentPrice;
  if (!Number.isFinite(value) || value <= 0) return "-";
  return value.toLocaleString("pt-BR", {
    currency: "BRL",
    maximumFractionDigits: 0,
    style: "currency",
  });
}

function getPublicationDraft(publication: GrupoOLXPublication): PublicationDraft {
  return {
    clientListingId: publication.client_listing_id || "",
    publicationType: publication.publication_type || "STANDARD",
    isDirty: false,
  };
}

function isCanonicalProductEditable(publication?: GrupoOLXPublication) {
  return publication?.canonical_managed === true
    && publication.canonical_desired_state === "unpublished"
    && publication.canonical_observed_state === "unpublished";
}

function integrationStatusLabel(status?: string | null) {
  switch (status) {
    case "connected":
      return "Integrado";
    case "pending_setup":
      return "Aguardando Canal Pro";
    case "paused":
      return "Pausado";
    case "error":
      return "Com erro";
    default:
      return "Não configurado";
  }
}

function reportStatusLabel(status: GrupoOLXImportReport["status"]) {
  if (status === "success") return "Sem apontamentos";
  if (status === "warning") return "Com avisos";
  if (status === "error") return "Com erros";
  return "Recebido";
}

function reportAnnotationLabel(status: GrupoOLXImportReport["annotation_status"]) {
  if (status === "succeeded") return "Processado";
  if (status === "retry") return "Nova tentativa";
  if (status === "dead") return "Requer atenção";
  return "Na fila";
}

function reportStatusVariant(
  report: GrupoOLXImportReport,
): "default" | "secondary" | "destructive" | "outline" {
  if (report.annotation_status === "dead" || report.status === "error") return "destructive";
  if (report.annotation_status === "succeeded" && report.status === "success") return "default";
  if (report.annotation_status === "pending" || report.annotation_status === "retry") return "secondary";
  return "outline";
}

function reportProcessingErrorLabel(value?: string | null) {
  const code = value?.trim().toLowerCase();
  if (!code) return null;
  if (code === "invalid_raw_payload") return "O JSON recebido não pôde ser interpretado.";
  if (code === "invalid_report_schema") return "O relatório não segue o formato reconhecido do Grupo OLX.";
  if (code === "listing_limit_exceeded") return "O relatório ultrapassou o limite seguro de anúncios.";
  return "O processamento não foi concluído. Reprocesse o evento ou consulte a operação da Vimob.";
}

function publicationStatusLabel(status?: string | null) {
  switch (status) {
    case "pending":
      return "Aguardando geração";
    case "valid":
      return "Pronto para o XML";
    case "invalid":
      return "Bloqueado por validação";
    case "exported":
      return "Disponível no XML";
    case "error":
      return "Erro no processamento";
    case "disabled":
      return "Fora do XML";
    default:
      return "Ainda não processado";
  }
}

function publicationStatusVariant(status?: string | null): "default" | "secondary" | "destructive" | "outline" {
  if (status === "invalid" || status === "error") return "destructive";
  if (status === "valid" || status === "exported") return "default";
  if (status === "pending") return "secondary";
  return "outline";
}

function canonicalObservedStateLabel(status?: GrupoOLXPublication["canonical_observed_state"]) {
  switch (status) {
    case "draft":
      return "Rascunho";
    case "queued":
      return "Na fila do XML";
    case "publishing":
      return "Gerando XML";
    case "published":
      return "Disponível no XML";
    case "pausing":
      return "Pausando no XML";
    case "paused":
      return "Pausado no XML";
    case "unpublishing":
      return "Retirando do XML";
    case "unpublished":
      return "Fora do XML";
    case "error":
      return "Com erro";
    default:
      return "Estado canônico indisponível";
  }
}

function canonicalObservedStateVariant(
  status?: GrupoOLXPublication["canonical_observed_state"],
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "error") return "destructive";
  if (status === "published") return "default";
  if (["queued", "publishing", "pausing", "unpublishing"].includes(status || "")) return "secondary";
  return "outline";
}

function canonicalDesiredStateLabel(status?: GrupoOLXPublication["canonical_desired_state"]) {
  if (status === "published") return "No XML";
  if (status === "paused") return "Pausado no XML";
  if (status === "unpublished") return "Fora do XML";
  return "Ainda não definido";
}

function validationErrorText(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const record = value as Record<string, unknown>;
  for (const key of ["message", "error", "description", "label"]) {
    if (typeof record[key] === "string" && record[key].trim()) return record[key].trim();
  }
  return "";
}

function publicationIssueMessages(publication?: GrupoOLXPublication) {
  const messages = (Array.isArray(publication?.validation_errors) ? publication.validation_errors : [])
    .map(validationErrorText)
    .filter(Boolean);
  if (publication?.last_error?.trim()) messages.unshift(publication.last_error.trim());
  return [...new Set(messages)];
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

async function copyToClipboard(value: string, label: string) {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copiado.`);
  } catch {
    toast.error(`Não foi possível copiar ${label.toLowerCase()}.`);
  }
}

export function GrupoOLXIntegrationSettings() {
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft>(emptySettingsDraft);
  const [propertySearch, setPropertySearch] = useState("");
  const [publicationDraft, setPublicationDraft] = useState<Record<string, PublicationDraft>>({});
  const [pendingTokenRegeneration, setPendingTokenRegeneration] = useState<"feed" | "webhook" | null>(null);
  const [pendingIntegrationPause, setPendingIntegrationPause] = useState(false);
  const shouldSearchProperties = propertySearch.trim().length >= 2;

  const { data: integration, isLoading: isLoadingIntegration } = useGrupoOLXIntegration();
  const { data: publicationData, isLoading: isLoadingPublications } = useGrupoOLXPublications();
  const {
    data: importReports = [],
    isError: isImportReportsError,
    isFetching: isFetchingImportReports,
    isLoading: isLoadingImportReports,
    refetch: refetchImportReports,
  } = useGrupoOLXImportReports({ enabled: Boolean(integration) });
  const { data: propertyData, isLoading: isLoadingProperties } = useProperties(
    propertySearch,
    {},
    { enabled: shouldSearchProperties },
  );
  const publications = publicationData ?? emptyPublications;
  const publishedProperties = useMemo(
    () => publications.flatMap((publication) => {
      const propertyId = getPublicationPropertyId(publication);
      if (!propertyId) return [];
      return [{ ...(publication.property || {}), id: propertyId } as unknown as Property];
    }),
    [publications],
  );
  const properties = shouldSearchProperties ? propertyData ?? emptyProperties : publishedProperties;
  const { data: pipelines = [] } = usePipelines();
  const { data: stages = [] } = useStages(settingsDraft.defaultPipelineId || undefined);
  const { data: users = [] } = useUsers();
  const { data: roundRobins = [] } = useRoundRobins();
  const saveIntegration = useSaveGrupoOLXIntegration();
  const activateIntegration = useActivateGrupoOLXIntegration();
  const pauseIntegration = usePauseGrupoOLXIntegration();
  const regenerateFeedToken = useRegenerateGrupoOLXFeedToken();
  const regenerateWebhookToken = useRegenerateGrupoOLXWebhookToken();
  const savePublications = useSaveGrupoOLXPublications();
  const replayImportReport = useReplayGrupoOLXImportReport();

  const urls = useMemo(() => getGrupoOLXPublicURLs(integration), [integration]);
  const publicationsByPropertyId = useMemo(() => {
    const map = new Map<string, GrupoOLXPublication>();
    publications.forEach((publication) => {
      const propertyId = getPublicationPropertyId(publication);
      if (propertyId) map.set(propertyId, publication);
    });
    return map;
  }, [publications]);
  const connected = integration?.status === "connected";
  const canActivate = Boolean(
    integration &&
    getSettingText(integration.settings, "contact_name") &&
    getSettingText(integration.settings, "contact_email"),
  );
  const activeCount = publications.filter((publication) => publication.canonical_managed
    ? publication.canonical_desired_state === "published" && publication.canonical_published_version != null
    : publication.is_enabled !== false).length;
  const visibleImportReports = useMemo(() => {
    const ordered = [
      ...importReports.filter((report) => report.annotation_status === "dead" || report.annotation_status === "retry"),
      ...importReports,
    ];
    return [...new Map(ordered.map((report) => [report.id, report])).values()].slice(0, 20);
  }, [importReports]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Sincroniza o formulario quando a integracao carregada muda.
    setSettingsDraft(settingsDraftFromIntegration(integration));
  }, [integration]);

  useEffect(() => {
    const nextDraft: Record<string, PublicationDraft> = {};
    publications.forEach((publication) => {
      const propertyId = getPublicationPropertyId(publication);
      if (propertyId) {
        nextDraft[propertyId] = getPublicationDraft(publication);
      }
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Mantem o rascunho local alinhado ao backend.
    setPublicationDraft(nextDraft);
  }, [publications]);

  const updateSettingsDraft = (field: keyof SettingsDraft, value: string) => {
    setSettingsDraft((current) => ({ ...current, [field]: value }));
  };

  const selectPipeline = (value: string) => {
    setSettingsDraft((current) => ({
      ...current,
      defaultPipelineId: value === "none" ? "" : value,
      defaultStageId: "",
    }));
  };

  const selectDestination = (field: "defaultAssignedUserId" | "defaultRoundRobinId", value: string) => {
    const normalized = value === "none" ? "" : value;
    setSettingsDraft((current) => ({
      ...current,
      [field]: normalized,
      ...(field === "defaultAssignedUserId" && normalized ? { defaultRoundRobinId: "" } : {}),
      ...(field === "defaultRoundRobinId" && normalized ? { defaultAssignedUserId: "" } : {}),
    }));
  };

  const getPropertyDraft = (property: Property) => {
    const existing = publicationDraft[property.id];
    if (existing) return existing;
    return {
      clientListingId: property.code || property.id,
      publicationType: "STANDARD",
      isDirty: false,
    };
  };

  const updatePublicationDraft = (property: Property, patch: Partial<PublicationDraft>) => {
    const publication = publicationsByPropertyId.get(property.id);
    if (publication?.canonical_managed) {
      if (!isCanonicalProductEditable(publication) || patch.publicationType === undefined) return;
      patch = { publicationType: patch.publicationType };
    }
    setPublicationDraft((current) => {
      const previous = current[property.id] || getPropertyDraft(property);
      return {
        ...current,
        [property.id]: {
          ...previous,
          ...patch,
          isDirty: true,
          clientListingId: (patch.clientListingId ?? previous.clientListingId ?? property.code ?? property.id).slice(0, 50),
          publicationType: patch.publicationType ?? previous.publicationType ?? "STANDARD",
        },
      };
    });
  };

  const saveSettings = () => {
    const contactName = settingsDraft.contactName.trim();
    const contactEmail = settingsDraft.contactEmail.trim();
    if ((integration?.is_active || integration?.status === "paused") && (!contactName || !contactEmail)) {
      toast.error("Nome e e-mail do contato são obrigatórios enquanto a integração estiver ativa ou em drenagem.");
      return;
    }

    saveIntegration.mutate({
      defaultPipelineId: settingsDraft.defaultPipelineId || null,
      defaultStageId: settingsDraft.defaultStageId || null,
      defaultAssignedUserId: settingsDraft.defaultAssignedUserId || null,
      defaultRoundRobinId: settingsDraft.defaultRoundRobinId || null,
      settings: {
        contact_name: contactName,
        contact_email: contactEmail,
        contact_phone: settingsDraft.contactPhone.trim(),
        detail_base_url: settingsDraft.detailBaseURL.trim(),
      },
    });
  };

  const saveSelectedPublications = () => {
    const canonicalProductPayload = publications.flatMap((publication) => {
      if (!isCanonicalProductEditable(publication)) return [];
      const propertyId = getPublicationPropertyId(publication);
      const draft = publicationDraft[propertyId];
      const currentProduct = publication.publication_type || "STANDARD";
      if (!propertyId || !draft || draft.publicationType === currentProduct) return [];
      return [{
        propertyId,
        clientListingId: publication.client_listing_id || undefined,
        publicationType: draft.publicationType || "STANDARD",
      }];
    });
    const legacyPayload = Object.entries(publicationDraft)
      .filter(([propertyId, draft]) => {
        const existing = publicationsByPropertyId.get(propertyId);
        if (existing?.canonical_managed || existing?.is_enabled) return false;
        if (!existing) return draft.isDirty;
        const original = getPublicationDraft(existing);
        return draft.clientListingId.trim() !== original.clientListingId.trim()
          || draft.publicationType !== original.publicationType;
      })
      .map(([propertyId, draft]) => ({
        propertyId,
        clientListingId: draft.clientListingId.trim() || undefined,
        publicationType: draft.publicationType || "STANDARD",
      }));
    const payload = [...legacyPayload, ...canonicalProductPayload];

    if (payload.length === 0) {
      toast.info("Nenhuma alteração para salvar.");
      return;
    }

    savePublications.mutate(payload);
  };

  const confirmTokenRegeneration = () => {
    const target = pendingTokenRegeneration;
    setPendingTokenRegeneration(null);
    if (target === "feed") regenerateFeedToken.mutate();
    if (target === "webhook") regenerateWebhookToken.mutate();
  };

  if (isLoadingIntegration) {
    return (
      <div className="flex min-h-[260px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-normal">Grupo OLX / Canal Pro</h3>
            <Badge variant={connected ? "default" : "outline"}>{integrationStatusLabel(integration?.status)}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            XML VRSync para Zap, Viva Real e OLX, com entrada de leads por webhook.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          {integration?.is_active ? (
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => setPendingIntegrationPause(true)}
              disabled={pauseIntegration.isPending}
            >
              {pauseIntegration.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PauseCircle className="h-4 w-4" />}
              Pausar
            </Button>
          ) : (
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => activateIntegration.mutate()}
              disabled={!canActivate || activateIntegration.isPending}
            >
              {activateIntegration.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Ativar
            </Button>
          )}
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => setPendingTokenRegeneration("feed")}
            disabled={!integration || regenerateFeedToken.isPending}
          >
            {regenerateFeedToken.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Regenerar XML
          </Button>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => setPendingTokenRegeneration("webhook")}
            disabled={!integration || regenerateWebhookToken.isPending}
          >
            {regenerateWebhookToken.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Regenerar webhooks
          </Button>
        </div>
      </div>

      {integration?.last_error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{integration.last_error}</AlertDescription>
        </Alert>
      ) : null}

      <AlertDialog
        open={pendingTokenRegeneration !== null}
        onOpenChange={(open) => !open && setPendingTokenRegeneration(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingTokenRegeneration === "feed" ? "Regenerar URL do XML?" : "Regenerar URLs dos webhooks?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              A URL atual deixará de funcionar imediatamente. Depois desta ação, a nova URL precisa ser atualizada no Canal Pro.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmTokenRegeneration}>Regenerar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={pendingIntegrationPause} onOpenChange={setPendingIntegrationPause}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pausar a integração com o Grupo OLX?</AlertDialogTitle>
            <AlertDialogDescription>
              O feed passará a entregar um XML vazio para retirar os anúncios no provedor. As URLs serão preservadas e os webhooks autenticados continuarão aceitos durante a drenagem.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setPendingIntegrationPause(false);
                pauseIntegration.mutate();
              }}
            >
              Pausar integração
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="space-y-4 rounded-[8px] border border-white/[0.055] p-4">
          <div className="flex items-center gap-2">
            <FileCode2 className="h-4 w-4 text-primary" />
            <h4 className="font-medium">Endpoints Canal Pro</h4>
          </div>
          {!urls ? (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>Ative a integração para gerar as URLs de XML e webhook.</AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-3">
              <EndpointField label="XML de imóveis" value={urls.feedURL} external />
              <EndpointField label="Webhook de leads" value={urls.leadWebhookURL} />
              <EndpointField label="Webhook de relatorios" value={urls.importReportURL} />
            </div>
          )}
        </section>

        <section className="space-y-3 rounded-[8px] border border-white/[0.055] p-4">
          <h4 className="font-medium">Ultima atividade</h4>
          <div className="grid gap-2 text-sm">
            <StatusLine label="XML acessado" value={formatDateTime(integration?.last_feed_accessed_at)} />
            <StatusLine label="Lead recebido" value={formatDateTime(integration?.last_lead_received_at)} />
            <StatusLine label="Relatorio recebido" value={formatDateTime(integration?.last_import_report_at)} />
            <StatusLine label="Imoveis ativos" value={String(activeCount)} />
          </div>
        </section>
      </div>

      <section className="space-y-4 rounded-[8px] border border-white/[0.055] p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-primary" />
              <h4 className="font-medium">Relatórios de importação</h4>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Recebimento durável, processamento assíncrono e recuperação de eventos que exigem atenção.
            </p>
          </div>
          <Badge variant="outline">Últimos 100 recebimentos</Badge>
        </div>

        <div className="overflow-hidden rounded-[8px] border border-white/[0.055]">
          <ScrollArea className="max-h-[360px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Relatório</TableHead>
                  <TableHead>Retorno do portal</TableHead>
                  <TableHead>Processamento</TableHead>
                  <TableHead>Recebido</TableHead>
                  <TableHead className="w-32 text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoadingImportReports ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : isImportReportsError ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-28 text-center">
                      <div className="flex flex-col items-center gap-3">
                        <p className="text-sm text-destructive">
                          Não foi possível carregar o histórico de relatórios.
                        </p>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="gap-2"
                          disabled={isFetchingImportReports}
                          onClick={() => refetchImportReports()}
                        >
                          {isFetchingImportReports
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <RefreshCw className="h-3.5 w-3.5" />}
                          Tentar novamente
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : visibleImportReports.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-sm text-muted-foreground">
                      Nenhum relatório recebido até agora.
                    </TableCell>
                  </TableRow>
                ) : visibleImportReports.map((report) => {
                  const canReplay = report.annotation_status === "dead";
                  const replaying = replayImportReport.isPending && replayImportReport.variables === report.id;
                  const processingError = reportProcessingErrorLabel(report.annotation_last_error);
                  return (
                    <TableRow key={report.id}>
                      <TableCell className="max-w-[260px]">
                        <p className="truncate font-mono text-xs" title={report.report_id}>{report.report_id}</p>
                        {report.provider_occurred_at ? (
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            Gerado pelo portal em {formatDateTime(report.provider_occurred_at)}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Badge variant={report.status === "error" ? "destructive" : "outline"}>
                          {reportStatusLabel(report.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[320px]">
                        <Badge variant={reportStatusVariant(report)}>{reportAnnotationLabel(report.annotation_status)}</Badge>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {report.annotation_attempts === 0
                            ? "Ainda sem tentativa"
                            : `${report.annotation_attempts} tentativa(s)`}
                        </p>
                        {processingError ? (
                          <p className="mt-1 line-clamp-2 text-[11px] text-destructive">
                            {processingError}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDateTime(report.created_at)}</TableCell>
                      <TableCell className="text-right">
                        {canReplay ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="gap-1.5"
                            disabled={replayImportReport.isPending}
                            onClick={() => replayImportReport.mutate(report.id)}
                          >
                            {replaying
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <RotateCcw className="h-3.5 w-3.5" />}
                            Reprocessar
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ScrollArea>
        </div>
      </section>

      <section className="space-y-4 rounded-[8px] border border-white/[0.055] p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h4 className="font-medium">Configuração e destino dos leads</h4>
            <p className="text-sm text-muted-foreground">
              Contato do XML e destino padrão dos leads. A autenticação oficial dos webhooks é administrada pela Vimob.
            </p>
          </div>
          <Button className="gap-2" onClick={saveSettings} disabled={saveIntegration.isPending}>
            {saveIntegration.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar dados
          </Button>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Nome do contato" autoComplete="name" value={settingsDraft.contactName} onChange={(value) => updateSettingsDraft("contactName", value)} />
          <Field label="E-mail do contato" type="email" autoComplete="email" value={settingsDraft.contactEmail} onChange={(value) => updateSettingsDraft("contactEmail", value)} />
          <Field label="Telefone do contato" autoComplete="tel" value={settingsDraft.contactPhone} onChange={(value) => updateSettingsDraft("contactPhone", value)} />
          <Field label="Base URL do imóvel" type="url" autoComplete="url" value={settingsDraft.detailBaseURL} onChange={(value) => updateSettingsDraft("detailBaseURL", value)} />
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SelectField
            label="Pipeline de entrada"
            value={settingsDraft.defaultPipelineId || "none"}
            onValueChange={selectPipeline}
            items={pipelines.filter((pipeline) => pipeline.is_active !== false).map((pipeline) => ({ value: pipeline.id, label: pipeline.name }))}
            emptyLabel="Pipeline padrão"
          />
          <SelectField
            label="Etapa de entrada"
            value={settingsDraft.defaultStageId || "none"}
            onValueChange={(value) => updateSettingsDraft("defaultStageId", value === "none" ? "" : value)}
            items={stages.filter((stage) => stage.is_active !== false).map((stage) => ({ value: stage.id, label: stage.name }))}
            emptyLabel="Primeira etapa"
            disabled={!settingsDraft.defaultPipelineId}
          />
          <SelectField
            label="Responsável fixo"
            value={settingsDraft.defaultAssignedUserId || "none"}
            onValueChange={(value) => selectDestination("defaultAssignedUserId", value)}
            items={users.filter((user) => user.is_active).map((user) => ({ value: user.id, label: user.name || user.email }))}
            emptyLabel="Sem responsável fixo"
          />
          <SelectField
            label="Roleta de distribuição"
            value={settingsDraft.defaultRoundRobinId || "none"}
            onValueChange={(value) => selectDestination("defaultRoundRobinId", value)}
            items={roundRobins.filter((roundRobin) => roundRobin.is_active !== false).map((roundRobin) => ({ value: roundRobin.id, label: roundRobin.name }))}
            emptyLabel="Sem roleta"
          />
        </div>
      </section>

      <section className="space-y-4 rounded-[8px] border border-white/[0.055] p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h4 className="font-medium">Configuração dos imóveis</h4>
            <p className="text-sm text-muted-foreground">
              Consulte o estado e ajuste somente ID e produto. Disponibilizar ou retirar do XML é feito exclusivamente na Ficha 360.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button className="gap-2" onClick={saveSelectedPublications} disabled={savePublications.isPending}>
              {savePublications.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar IDs e produtos
            </Button>
          </div>
        </div>

        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={propertySearch}
            onChange={(event) => setPropertySearch(event.target.value)}
            placeholder="Buscar imóvel por código, título, cidade ou bairro"
            className="pl-9"
          />
        </div>

        <div className="overflow-hidden rounded-[8px] border border-white/[0.055]">
          <ScrollArea className="h-[420px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Imovel</TableHead>
                  <TableHead>Cidade</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead className="w-44">ID no portal</TableHead>
                  <TableHead className="w-44">Produto</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoadingProperties || isLoadingPublications ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32 text-center">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : properties.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                      Nenhum imóvel encontrado.
                    </TableCell>
                  </TableRow>
                ) : (
                  properties.map((property) => {
                    const draft = getPropertyDraft(property);
                    const publication = publicationsByPropertyId.get(property.id);
                    const canonicalManaged = publication?.canonical_managed === true;
                    const canonicalProductEditable = isCanonicalProductEditable(publication);
                    const legacyLive = !canonicalManaged && publication?.is_enabled === true;
                    return (
                      <TableRow key={property.id}>
                        <TableCell>
                          <div className="min-w-0">
                            <Link className="block truncate font-medium hover:underline" href={`/properties/${property.id}`}>
                              {property.title || property.code || "Imovel"}
                            </Link>
                            <p className="text-xs text-muted-foreground">{property.code || property.id}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="min-w-0">
                            <p className="truncate">{property.cidade || "-"}</p>
                            <p className="truncate text-xs text-muted-foreground">{property.bairro || "-"}</p>
                          </div>
                        </TableCell>
                        <TableCell>{getPropertyPrice(property)}</TableCell>
                        <TableCell>
                          <Input
                            value={draft.clientListingId}
                            maxLength={50}
                            disabled={canonicalManaged || legacyLive}
                            onChange={(event) => updatePublicationDraft(property, { clientListingId: event.target.value })}
                            className="h-9"
                          />
                        </TableCell>
                        <TableCell>
                          <Select
                            value={draft.publicationType}
                            disabled={legacyLive || (canonicalManaged && !canonicalProductEditable)}
                            onValueChange={(value) => updatePublicationDraft(property, { publicationType: value })}
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {publicationTypes.map((item) => (
                                <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="min-w-[230px]">
                          <PublicationStatusDetails
                            publication={publication}
                            status={publication?.is_enabled !== false ? publication?.status || "pending" : "disabled"}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </div>
      </section>
    </div>
  );
}

function PublicationStatusDetails({
  publication,
  status,
}: {
  publication?: GrupoOLXPublication;
  status: string;
}) {
  const issues = publicationIssueMessages(publication);
  const firstIssue = issues[0];
  const remainingIssues = Math.max(0, issues.length - 1);
  const canonicalManaged = publication?.canonical_managed === true;

  return (
    <div className="space-y-1.5">
      {canonicalManaged ? (
        <>
          <Badge variant={canonicalObservedStateVariant(publication.canonical_observed_state)}>
            {canonicalObservedStateLabel(publication.canonical_observed_state)}
          </Badge>
          <div className="space-y-0.5 text-[11px] leading-4 text-muted-foreground">
            <p>Estado desejado: {canonicalDesiredStateLabel(publication.canonical_desired_state)}</p>
            {publication.canonical_updated_at ? (
              <p>Atualizado na Ficha 360: {formatDateTime(publication.canonical_updated_at)}</p>
            ) : null}
          </div>
          <p className="text-[11px] font-medium leading-4 text-foreground">
            {"Gerencie na Ficha 360 > Publicação"}
          </p>
          {isCanonicalProductEditable(publication) ? (
            <p className="text-[11px] leading-4 text-muted-foreground">
              O produto pode ser alterado enquanto o imóvel está fora do XML; o ID do portal permanece fixo.
            </p>
          ) : (
            <p className="text-[11px] leading-4 text-muted-foreground">
              O ID do portal permanece fixo. Retire o imóvel completamente do XML para alterar o produto.
            </p>
          )}
        </>
      ) : (
        <>
          <Badge variant={publicationStatusVariant(status)}>{publicationStatusLabel(status)}</Badge>
          <p className="text-[11px] font-medium leading-4 text-foreground">
            {publication?.is_enabled
              ? "Configuração bloqueada enquanto o legado está no XML; gerencie na Ficha 360 > Publicação"
              : "Disponibilize no XML pela Ficha 360 > Publicação"}
          </p>
        </>
      )}
      {firstIssue ? (
        <p
          className="line-clamp-2 max-w-[260px] text-[11px] leading-4 text-destructive"
          title={issues.join("\n")}
        >
          {firstIssue}{remainingIssues > 0 ? ` (+${remainingIssues})` : ""}
        </p>
      ) : null}
      {publication?.last_exported_at || publication?.last_seen_in_feed_at ? (
        <div className="space-y-0.5 text-[11px] leading-4 text-muted-foreground">
          {publication.last_exported_at ? (
            <p>Gerado no XML: {formatDateTime(publication.last_exported_at)}</p>
          ) : null}
          {publication.last_seen_in_feed_at ? (
            <p>Visto no feed: {formatDateTime(publication.last_seen_in_feed_at)}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function EndpointField({ label, value, external }: { label: string; value: string; external?: boolean }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex min-w-0 gap-2">
        <Input value={value} readOnly className="min-w-0 font-mono text-xs" />
        <Button type="button" variant="outline" size="icon" onClick={() => copyToClipboard(value, label)} aria-label={`Copiar ${label}`}>
          <Copy className="h-4 w-4" />
        </Button>
        {external ? (
          <Button type="button" variant="outline" size="icon" asChild aria-label={`Abrir ${label}`}>
            <a href={value} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input type={type} autoComplete={autoComplete} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function SelectField({
  label,
  value,
  onValueChange,
  items,
  emptyLabel,
  disabled = false,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  items: Array<{ value: string; label: string }>;
  emptyLabel: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">{emptyLabel}</SelectItem>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function StatusLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[6px] bg-[var(--app-surface-soft)] px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
