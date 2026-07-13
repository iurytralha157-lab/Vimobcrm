"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileCode2,
  Loader2,
  RefreshCw,
  Save,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  getGrupoOLXPublicURLs,
  useActivateGrupoOLXIntegration,
  useGrupoOLXIntegration,
  useGrupoOLXPublications,
  useRegenerateGrupoOLXFeedToken,
  useSaveGrupoOLXIntegration,
  useSaveGrupoOLXPublications,
  type GrupoOLXPublication,
} from "@/hooks/use-grupo-olx-integration";

type SettingsDraft = {
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  detailBaseURL: string;
  leadWebhookSecret: string;
};

type PublicationDraft = {
  clientListingId: string;
  publicationType: string;
  isEnabled: boolean;
};

const emptySettingsDraft: SettingsDraft = {
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  detailBaseURL: "",
  leadWebhookSecret: "",
};

const publicationTypes = [
  { value: "STANDARD", label: "Standard" },
  { value: "PREMIUM", label: "Premium" },
  { value: "SUPER_PREMIUM", label: "Super premium" },
];

function getSettingText(settings: Record<string, unknown> | null | undefined, key: string) {
  const value = settings?.[key];
  return typeof value === "string" ? value : "";
}

function settingsDraftFromIntegration(settings: Record<string, unknown> | null | undefined): SettingsDraft {
  return {
    contactName: getSettingText(settings, "contact_name"),
    contactEmail: getSettingText(settings, "contact_email"),
    contactPhone: getSettingText(settings, "contact_phone"),
    detailBaseURL: getSettingText(settings, "detail_base_url"),
    leadWebhookSecret: "",
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
    isEnabled: publication.is_enabled !== false,
  };
}

function statusLabel(status?: string | null) {
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

  const { data: integration, isLoading: isLoadingIntegration } = useGrupoOLXIntegration();
  const { data: publications = [], isLoading: isLoadingPublications } = useGrupoOLXPublications();
  const { data: properties = [], isLoading: isLoadingProperties } = useProperties(propertySearch);
  const saveIntegration = useSaveGrupoOLXIntegration();
  const activateIntegration = useActivateGrupoOLXIntegration();
  const regenerateFeedToken = useRegenerateGrupoOLXFeedToken();
  const savePublications = useSaveGrupoOLXPublications();

  const urls = useMemo(() => getGrupoOLXPublicURLs(integration), [integration]);
  const publicationsByPropertyId = useMemo(() => {
    const map = new Map<string, GrupoOLXPublication>();
    publications.forEach((publication) => {
      if (publication.property_id) map.set(publication.property_id, publication);
    });
    return map;
  }, [publications]);
  const connected = integration?.status === "connected";
  const activeCount = Object.values(publicationDraft).filter((item) => item.isEnabled).length;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Sincroniza o formulario quando a integracao carregada muda.
    setSettingsDraft(settingsDraftFromIntegration(integration?.settings));
  }, [integration?.settings, integration?.updated_at]);

  useEffect(() => {
    const nextDraft: Record<string, PublicationDraft> = {};
    publications.forEach((publication) => {
      if (publication.property_id) {
        nextDraft[publication.property_id] = getPublicationDraft(publication);
      }
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Mantem o rascunho local alinhado ao backend.
    setPublicationDraft(nextDraft);
  }, [publications]);

  const updateSettingsDraft = (field: keyof SettingsDraft, value: string) => {
    setSettingsDraft((current) => ({ ...current, [field]: value }));
  };

  const getPropertyDraft = (property: Property) => {
    const existing = publicationDraft[property.id];
    if (existing) return existing;
    return {
      clientListingId: property.code || property.id,
      publicationType: "STANDARD",
      isEnabled: false,
    };
  };

  const updatePublicationDraft = (property: Property, patch: Partial<PublicationDraft>) => {
    setPublicationDraft((current) => {
      const previous = current[property.id] || getPropertyDraft(property);
      return {
        ...current,
        [property.id]: {
          ...previous,
          ...patch,
          clientListingId: (patch.clientListingId ?? previous.clientListingId ?? property.code ?? property.id).slice(0, 50),
          publicationType: patch.publicationType ?? previous.publicationType ?? "STANDARD",
        },
      };
    });
  };

  const saveSettings = () => {
    saveIntegration.mutate({
      isActive: integration?.is_active !== false,
      leadWebhookSecret: settingsDraft.leadWebhookSecret.trim() || undefined,
      settings: {
        contact_name: settingsDraft.contactName.trim(),
        contact_email: settingsDraft.contactEmail.trim(),
        contact_phone: settingsDraft.contactPhone.trim(),
        detail_base_url: settingsDraft.detailBaseURL.trim(),
      },
    });
  };

  const saveSelectedPublications = () => {
    const existingIds = new Set(publications.map((publication) => publication.property_id).filter(Boolean) as string[]);
    const payload = Object.entries(publicationDraft)
      .filter(([propertyId, draft]) => draft.isEnabled || existingIds.has(propertyId))
      .map(([propertyId, draft]) => ({
        propertyId,
        clientListingId: draft.clientListingId.trim() || undefined,
        publicationType: draft.publicationType || "STANDARD",
        isEnabled: draft.isEnabled,
      }));

    if (payload.length === 0) {
      toast.info("Nenhum imóvel selecionado para publicar.");
      return;
    }

    savePublications.mutate(payload);
  };

  const toggleAllVisible = (checked: boolean) => {
    setPublicationDraft((current) => {
      const next = { ...current };
      properties.forEach((property) => {
        const previous = next[property.id] || getPropertyDraft(property);
        next[property.id] = {
          ...previous,
          isEnabled: checked,
          clientListingId: previous.clientListingId || property.code || property.id,
          publicationType: previous.publicationType || "STANDARD",
        };
      });
      return next;
    });
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
            <h3 className="text-lg font-semibold">Grupo OLX / Canal Pro</h3>
            <Badge variant={connected ? "default" : "outline"}>{statusLabel(integration?.status)}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            XML VRSync para Zap, Viva Real e OLX, com entrada de leads por webhook.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => activateIntegration.mutate()}
            disabled={activateIntegration.isPending}
          >
            {activateIntegration.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Ativar
          </Button>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => regenerateFeedToken.mutate()}
            disabled={!integration || regenerateFeedToken.isPending}
          >
            {regenerateFeedToken.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Regenerar XML
          </Button>
        </div>
      </div>

      {integration?.last_error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{integration.last_error}</AlertDescription>
        </Alert>
      ) : null}

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
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h4 className="font-medium">Dados enviados no XML</h4>
            <p className="text-sm text-muted-foreground">Contato comercial, URL pública do imóvel e segredo opcional do webhook.</p>
          </div>
          <Button className="gap-2" onClick={saveSettings} disabled={saveIntegration.isPending}>
            {saveIntegration.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar dados
          </Button>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <Field label="Nome do contato" value={settingsDraft.contactName} onChange={(value) => updateSettingsDraft("contactName", value)} />
          <Field label="E-mail do contato" type="email" value={settingsDraft.contactEmail} onChange={(value) => updateSettingsDraft("contactEmail", value)} />
          <Field label="Telefone do contato" value={settingsDraft.contactPhone} onChange={(value) => updateSettingsDraft("contactPhone", value)} />
          <Field label="Base URL do imóvel" value={settingsDraft.detailBaseURL} onChange={(value) => updateSettingsDraft("detailBaseURL", value)} />
          <Field label="Segredo webhook" type="password" value={settingsDraft.leadWebhookSecret} placeholder={integration?.lead_webhook_secret_configured ? "Ja configurado" : "Opcional"} onChange={(value) => updateSettingsDraft("leadWebhookSecret", value)} />
        </div>
      </section>

      <section className="space-y-4 rounded-[8px] border border-white/[0.055] p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h4 className="font-medium">Imóveis publicados</h4>
            <p className="text-sm text-muted-foreground">Selecione os imóveis que entram no XML do Grupo OLX.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => toggleAllVisible(true)}>Marcar busca</Button>
            <Button variant="outline" onClick={() => toggleAllVisible(false)}>Desmarcar busca</Button>
            <Button className="gap-2" onClick={saveSelectedPublications} disabled={savePublications.isPending}>
              {savePublications.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar imóveis
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
                  <TableHead className="w-12" />
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
                    <TableCell colSpan={7} className="h-32 text-center">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : properties.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                      Nenhum imóvel encontrado.
                    </TableCell>
                  </TableRow>
                ) : (
                  properties.map((property) => {
                    const draft = getPropertyDraft(property);
                    const publication = publicationsByPropertyId.get(property.id);
                    return (
                      <TableRow key={property.id}>
                        <TableCell>
                          <Checkbox
                            checked={draft.isEnabled}
                            onCheckedChange={(checked) => updatePublicationDraft(property, { isEnabled: checked === true })}
                            aria-label={`Publicar ${property.title || property.code || property.id}`}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="min-w-0">
                            <p className="truncate font-medium">{property.title || property.code || "Imovel"}</p>
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
                            onChange={(event) => updatePublicationDraft(property, { clientListingId: event.target.value })}
                            className="h-9"
                          />
                        </TableCell>
                        <TableCell>
                          <Select
                            value={draft.publicationType}
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
                        <TableCell>
                          <Badge variant={draft.isEnabled ? "default" : "outline"}>
                            {draft.isEnabled ? statusLabel(publication?.status || "pending_setup") : "Fora do XML"}
                          </Badge>
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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
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
