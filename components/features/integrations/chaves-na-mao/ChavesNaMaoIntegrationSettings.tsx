"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Copy,
  ExternalLink,
  FileCode2,
  Loader2,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Save,
  Search,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useActivateChavesNaMaoIntegration,
  useChavesNaMaoIntegration,
  useChavesNaMaoPublications,
  usePauseChavesNaMaoIntegration,
  useRegenerateChavesNaMaoFeedToken,
  useSaveChavesNaMaoIntegration,
  useSaveChavesNaMaoPublications,
} from "@/hooks/integrations/chaves-na-mao";
import { useProperties, type Property } from "@/hooks/use-properties";
import {
  getChavesNaMaoFeedURL,
  isChavesNaMaoHomologationRequired,
} from "@/lib/api";
import { getPublicErrorMessage } from "@/lib/api/vimob-error";
import type { ChavesNaMaoPublication } from "@/lib/validation";

const OFFICIAL_SETUP_GUIDE =
  "https://help.chavesnamao.com.br/support/solutions/articles/72000638008-como-integrar-minha-base-de-im%C3%B3veis-ao-chaves-na-m%C3%A3o-";
const OFFICIAL_XML_SPEC = "https://tecnologiacnm.github.io/cnm-xml-documentation/";
const EMPTY_PUBLICATIONS: ChavesNaMaoPublication[] = [];

type SettingsDraft = {
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  detailBaseURL: string;
};

type PublicationDraft = {
  clientListingId: string;
  publicationType: "STANDARD" | "FEATURED";
  isEnabled: boolean;
  dirty: boolean;
};

const emptySettingsDraft: SettingsDraft = {
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  detailBaseURL: "",
};

function settingValue(
  settings: Record<string, unknown> | null | undefined,
  key: string,
) {
  const value = settings?.[key];
  return typeof value === "string" ? value : "";
}

function integrationSettingsDraft(
  settings: Record<string, unknown> | null | undefined,
): SettingsDraft {
  return {
    contactName: settingValue(settings, "contact_name"),
    contactEmail: settingValue(settings, "contact_email"),
    contactPhone: settingValue(settings, "contact_phone"),
    detailBaseURL: settingValue(settings, "detail_base_url"),
  };
}

function propertyFromPublication(publication: ChavesNaMaoPublication) {
  return publication.property as Property;
}

function initialPublicationDraft(
  property: Property,
  publication?: ChavesNaMaoPublication,
): PublicationDraft {
  return {
    clientListingId:
      publication?.client_listing_id || property.code || property.id,
    publicationType:
      publication?.publication_type === "FEATURED" ? "FEATURED" : "STANDARD",
    isEnabled: publication?.is_enabled === true,
    dirty: false,
  };
}

function publicationStatusLabel(publication?: ChavesNaMaoPublication) {
  if (!publication) return "Não selecionado";
  if (!publication.is_enabled) return "Fora do XML";
  if (publication.status === "invalid") return "Bloqueado por validação";
  if (publication.status === "exported") return "Disponível no XML";
  if (publication.status === "valid") return "Pronto para o XML";
  if (publication.status === "error") return "Erro no processamento";
  return "Aguardando geração";
}

function formatDateTime(value?: string | null) {
  if (!value) return "Nunca";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Nunca";
  return date.toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export function ChavesNaMaoIntegrationSettings() {
  const [settingsDraft, setSettingsDraft] =
    useState<SettingsDraft>(emptySettingsDraft);
  const [propertySearch, setPropertySearch] = useState("");
  const [publicationDrafts, setPublicationDrafts] = useState<
    Record<string, PublicationDraft>
  >({});
  const [confirmation, setConfirmation] = useState<"pause" | "token" | null>(
    null,
  );

  const integrationQuery = useChavesNaMaoIntegration();
  const homologationRequired = isChavesNaMaoHomologationRequired(
    integrationQuery.error,
  );
  const homologationOpen =
    integrationQuery.isSuccess && !integrationQuery.isError;
  const integration = integrationQuery.data;
  const persistedSettings = useMemo(
    () => integrationSettingsDraft(integration?.settings),
    [integration],
  );
  const publicationsQuery = useChavesNaMaoPublications({
    enabled: homologationOpen,
  });
  const shouldSearchProperties =
    homologationOpen && propertySearch.trim().length >= 2;
  const { data: propertySearchResults = [], isLoading: propertiesLoading } =
    useProperties(propertySearch, {}, { enabled: shouldSearchProperties });
  const publications = publicationsQuery.data ?? EMPTY_PUBLICATIONS;
  const publicationsByPropertyId = useMemo(
    () =>
      new Map(
        publications.map((publication) => [
          publication.property_id,
          publication,
        ]),
      ),
    [publications],
  );
  const visibleProperties = useMemo(() => {
    if (shouldSearchProperties) return propertySearchResults;
    return publications.map(propertyFromPublication);
  }, [propertySearchResults, publications, shouldSearchProperties]);

  const saveIntegration = useSaveChavesNaMaoIntegration(homologationOpen);
  const activateIntegration =
    useActivateChavesNaMaoIntegration(homologationOpen);
  const pauseIntegration = usePauseChavesNaMaoIntegration(homologationOpen);
  const regenerateFeedToken =
    useRegenerateChavesNaMaoFeedToken(homologationOpen);
  const savePublications =
    useSaveChavesNaMaoPublications(homologationOpen);
  const feedURL = getChavesNaMaoFeedURL(integration);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Mantem o formulario alinhado ao snapshot validado do backend.
    setSettingsDraft(persistedSettings);
  }, [persistedSettings]);

  useEffect(() => {
    const next: Record<string, PublicationDraft> = {};
    publications.forEach((publication) => {
      next[publication.property_id] = initialPublicationDraft(
        propertyFromPublication(publication),
        publication,
      );
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Reconstroi rascunhos somente apos leitura validada das publicacoes.
    setPublicationDrafts(next);
  }, [publications]);

  const canActivate = Boolean(
    homologationOpen &&
      integration &&
      persistedSettings.contactName.trim() &&
      persistedSettings.contactEmail.trim() &&
      /^https:\/\//i.test(persistedSettings.detailBaseURL.trim()),
  );

  const updatePublication = (
    property: Property,
    patch: Partial<PublicationDraft>,
  ) => {
    setPublicationDrafts((current) => ({
      ...current,
      [property.id]: {
        ...(current[property.id] ||
          initialPublicationDraft(
            property,
            publicationsByPropertyId.get(property.id),
          )),
        ...patch,
        dirty: true,
      },
    }));
  };

  const handleSaveSettings = () => {
    if (!homologationOpen) return;
    saveIntegration.mutate({
      settings: {
        contact_name: settingsDraft.contactName.trim(),
        contact_email: settingsDraft.contactEmail.trim(),
        contact_phone: settingsDraft.contactPhone.trim(),
        detail_base_url: settingsDraft.detailBaseURL.trim(),
      },
    });
  };

  const handleSavePublications = () => {
    if (!homologationOpen) return;
    const changed = Object.entries(publicationDrafts).flatMap(
      ([propertyId, draft]) => {
      if (!draft?.dirty) return [];
      return [
        {
          propertyId,
          clientListingId: draft.clientListingId.trim() || propertyId,
          publicationType: draft.publicationType,
          isEnabled: draft.isEnabled,
        },
      ];
      },
    );
    if (changed.length === 0) {
      toast.info("Nenhuma alteração de imóvel para salvar.");
      return;
    }
    savePublications.mutate(changed);
  };

  const handleConfirmation = () => {
    const action = confirmation;
    setConfirmation(null);
    if (!homologationOpen) return;
    if (action === "pause") pauseIntegration.mutate();
    if (action === "token") regenerateFeedToken.mutate();
  };

  if (integrationQuery.isLoading) {
    return (
      <div className="flex min-h-[260px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-medium">Chaves na Mão</h3>
            <Badge variant={homologationOpen ? "outline" : "secondary"}>
              {homologationOpen
                ? integration?.status === "connected"
                  ? "Feed conectado"
                  : "Homologação liberada"
                : "Homologação pendente"}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Canal independente para publicação por XML. Ele não reutiliza o
            Canal Pro e não recebe leads enquanto não existir contrato oficial.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {integrationQuery.isError && !homologationRequired ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => void integrationQuery.refetch()}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Tentar novamente
            </Button>
          ) : null}
          {integration?.is_active ? (
            <Button
              type="button"
              variant="outline"
              disabled={!homologationOpen || pauseIntegration.isPending}
              onClick={() => setConfirmation("pause")}
            >
              <PauseCircle className="mr-2 h-4 w-4" />
              Pausar feed
            </Button>
          ) : (
            <Button
              type="button"
              disabled={
                !canActivate ||
                saveIntegration.isPending ||
                activateIntegration.isPending
              }
              onClick={() => activateIntegration.mutate()}
            >
              <PlayCircle className="mr-2 h-4 w-4" />
              Ativar para homologação
            </Button>
          )}
        </div>
      </div>

      {!homologationOpen ? (
        <Alert className="border-amber-500/30 bg-amber-500/10">
          <ShieldAlert className="h-4 w-4 text-amber-700 dark:text-amber-300" />
          <AlertTitle>Ativação bloqueada com segurança</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>
              {homologationRequired
                ? "O servidor confirmou que o gate de homologação está fechado. Nenhuma configuração, ativação ou publicação pode ser gravada."
                : getPublicErrorMessage(
                    integrationQuery.error,
                    "Não foi possível confirmar a homologação. Por segurança, todas as ações permanecem bloqueadas.",
                  )}
            </p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>Assinar o contrato do portal e confirmar o Vimob como integrador.</li>
              <li>Receber conta, critérios e credenciais de homologação por canal seguro.</li>
              <li>Validar o XML com o portal antes de liberar o ambiente.</li>
            </ol>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" asChild>
                <a href={OFFICIAL_SETUP_GUIDE} target="_blank" rel="noreferrer">
                  Manual oficial
                  <ExternalLink className="ml-2 h-3.5 w-3.5" />
                </a>
              </Button>
              <Button type="button" variant="outline" size="sm" asChild>
                <a href={OFFICIAL_XML_SPEC} target="_blank" rel="noreferrer">
                  Especificação XML
                  <ExternalLink className="ml-2 h-3.5 w-3.5" />
                </a>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Entrada de leads não disponível</AlertTitle>
        <AlertDescription>
          O portal não publica hoje um contrato imobiliário completo de webhook
          de leads. Por isso esta tela configura somente o feed de imóveis e não
          mostra token, destino ou promessa de distribuição de leads.
        </AlertDescription>
      </Alert>

      <section className="space-y-4 rounded-[8px] border border-white/[0.055] p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h4 className="font-medium">Dados do feed XML</h4>
            <p className="text-sm text-muted-foreground">
              Preencha somente após o portal liberar o ambiente de homologação.
            </p>
          </div>
          <Button
            type="button"
            className="gap-2"
            disabled={!homologationOpen || saveIntegration.isPending}
            onClick={handleSaveSettings}
          >
            {saveIntegration.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Salvar dados
          </Button>
        </div>

        <fieldset
          disabled={!homologationOpen}
          className="grid gap-3 md:grid-cols-2"
        >
          <TextField
            label="Nome do contato"
            value={settingsDraft.contactName}
            onChange={(contactName) =>
              setSettingsDraft((current) => ({ ...current, contactName }))
            }
          />
          <TextField
            label="E-mail do contato"
            type="email"
            value={settingsDraft.contactEmail}
            onChange={(contactEmail) =>
              setSettingsDraft((current) => ({ ...current, contactEmail }))
            }
          />
          <TextField
            label="Telefone do contato"
            value={settingsDraft.contactPhone}
            onChange={(contactPhone) =>
              setSettingsDraft((current) => ({ ...current, contactPhone }))
            }
          />
          <TextField
            label="URL pública base dos imóveis"
            type="url"
            placeholder="https://imobiliaria.com.br/imoveis"
            value={settingsDraft.detailBaseURL}
            onChange={(detailBaseURL) =>
              setSettingsDraft((current) => ({ ...current, detailBaseURL }))
            }
          />
        </fieldset>
      </section>

      {homologationOpen ? (
        <section className="space-y-4 rounded-[8px] border border-white/[0.055] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="font-medium">URL privada do XML</h4>
              <p className="text-sm text-muted-foreground">
                Envie esta URL somente ao canal oficial informado no contrato.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={!feedURL || regenerateFeedToken.isPending}
              onClick={() => setConfirmation("token")}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Renovar URL
            </Button>
          </div>
          {feedURL ? <FeedURLField value={feedURL} /> : (
            <p className="rounded-[6px] bg-[var(--app-surface-soft)] p-3 text-sm text-muted-foreground">
              A URL será gerada após salvar os dados e ativar o feed.
            </p>
          )}
          <div className="grid gap-2 text-xs sm:grid-cols-2">
            <StatusLine
              label="Último acesso do portal"
              value={formatDateTime(integration?.last_feed_accessed_at)}
            />
            <StatusLine
              label="Último resultado"
              value={integration?.last_sync_status || "Ainda não processado"}
            />
          </div>
        </section>
      ) : null}

      <section className="space-y-4 rounded-[8px] border border-white/[0.055] p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h4 className="font-medium">Imóveis do feed</h4>
            <p className="text-sm text-muted-foreground">
              Selecione imóveis, defina a referência e escolha o destaque aceito
              pelo XML oficial.
            </p>
          </div>
          <Button
            type="button"
            className="gap-2"
            disabled={!homologationOpen || savePublications.isPending}
            onClick={handleSavePublications}
          >
            {savePublications.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Salvar seleção
          </Button>
        </div>

        <div className="relative max-w-lg">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={propertySearch}
            disabled={!homologationOpen}
            onChange={(event) => setPropertySearch(event.target.value)}
            placeholder="Buscar imóvel por código, título, cidade ou bairro"
            className="pl-9"
          />
        </div>

        <div className="overflow-x-auto rounded-[8px] border border-white/[0.055]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Imóvel</TableHead>
                <TableHead className="min-w-40">Referência no portal</TableHead>
                <TableHead className="min-w-36">Destaque</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">No XML</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!homologationOpen ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-sm text-muted-foreground">
                    A seleção será liberada somente após a homologação.
                  </TableCell>
                </TableRow>
              ) : propertiesLoading || publicationsQuery.isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : visibleProperties.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-sm text-muted-foreground">
                    {propertySearch.trim().length > 0 && propertySearch.trim().length < 2
                      ? "Digite pelo menos 2 caracteres para buscar."
                      : "Nenhum imóvel selecionado ou encontrado."}
                  </TableCell>
                </TableRow>
              ) : (
                visibleProperties.map((property) => {
                  const publication = publicationsByPropertyId.get(property.id);
                  const draft =
                    publicationDrafts[property.id] ||
                    initialPublicationDraft(property, publication);
                  return (
                    <TableRow key={property.id}>
                      <TableCell>
                        <Link
                          href={`/properties/${property.id}`}
                          className="font-medium hover:underline"
                        >
                          {property.title || property.code || "Imóvel"}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {property.code || property.id}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Input
                          value={draft.clientListingId}
                          maxLength={50}
                          onChange={(event) =>
                            updatePublication(property, {
                              clientListingId: event.target.value,
                            })
                          }
                          className="h-9"
                        />
                      </TableCell>
                      <TableCell>
                        <Select
                          value={draft.publicationType}
                          onValueChange={(publicationType) =>
                            updatePublication(property, {
                              publicationType: publicationType as
                                | "STANDARD"
                                | "FEATURED",
                            })
                          }
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="STANDARD">Padrão</SelectItem>
                            <SelectItem value="FEATURED">Destaque</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            publication?.status === "invalid" ||
                            publication?.status === "error"
                              ? "destructive"
                              : "outline"
                          }
                        >
                          {publicationStatusLabel(publication)}
                        </Badge>
                        {publication?.last_error ? (
                          <p className="mt-1 max-w-64 text-[11px] text-destructive">
                            {publication.last_error}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right">
                        <Switch
                          checked={draft.isEnabled}
                          onCheckedChange={(isEnabled) =>
                            updatePublication(property, { isEnabled })
                          }
                          aria-label={`${draft.isEnabled ? "Retirar" : "Incluir"} ${property.title || property.code || "imóvel"} no XML`}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      <AlertDialog
        open={confirmation !== null}
        onOpenChange={(open) => !open && setConfirmation(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmation === "token" ? "Renovar a URL do XML?" : "Pausar o feed?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmation === "token"
                ? "A URL anterior deixa de funcionar. Atualize o portal com a nova URL pelo canal oficial."
                : "O token será preservado e o portal receberá um XML vazio para retirar os anúncios com segurança."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmation}>
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function FeedURLField({ value }: { value: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("URL do XML copiada.");
    } catch {
      toast.error("Não foi possível copiar a URL.");
    }
  };
  return (
    <div className="flex min-w-0 gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-2 rounded-[6px] bg-[var(--app-surface-soft)] px-3">
        <FileCode2 className="h-4 w-4 shrink-0 text-muted-foreground" />
        <code className="truncate text-xs">{value}</code>
      </div>
      <Button type="button" variant="outline" size="icon" onClick={copy}>
        <Copy className="h-4 w-4" />
        <span className="sr-only">Copiar URL do XML</span>
      </Button>
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
