"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Building2,
  ChevronRight,
  CircleAlert,
  FileText,
  Globe2,
  History,
  ImageIcon,
  KeyRound,
  Pencil,
  Share2,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";

import { AppLayout } from "@/components/shared/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useCreatePropertyKey,
  useCreatePropertyOwnership,
  useEndPropertyOwnership,
  useMovePropertyKey,
  usePropertyPublications,
  usePropertyWorkspace,
  useUpdatePropertyOwnership,
  useUpsertPropertyOffer,
} from "@/hooks/properties";
import { usePropertyHistory, useUpdateProperty } from "@/hooks/use-properties";
import {
  isPropertyEditAccessReady,
} from "@/lib/access/properties";
import { getPropertySiteInfo } from "@/lib/api/property-support";
import { buildPropertySiteUrl } from "@/lib/property-site-url";
import { useUsers } from "@/hooks/use-users";
import type {
  PropertyKeyMovementInput,
  PropertyOfferType,
  PropertyOfferUpsertInput,
  PropertyWorkspaceKey,
  PropertyWorkspaceOwnership,
} from "@/lib/validation";
import { Panel } from "@/components/features/marketing/marketing-ui";

import { PropertyKeyCreateDialog } from "./detail/PropertyKeyCreateDialog";
import { PropertyKeyMovementDialog } from "./detail/PropertyKeyMovementDialog";
import { PropertyOfferDialog } from "./detail/PropertyOfferDialog";
import {
  PropertyOwnershipDialog,
  type OwnershipSubmitInput,
} from "./detail/PropertyOwnershipDialog";
import { PropertyOwnershipEndDialog } from "./detail/PropertyOwnershipEndDialog";
import { PropertyWorkspaceActionsMenu } from "./detail/PropertyWorkspaceActionsMenu";
import { PropertyGallery } from "./detail/PropertyWorkspaceOverview";
import { PropertyWorkspaceSummary } from "./detail/PropertyWorkspaceSummary";
import { collectPropertyImages, localDateISO } from "./detail/property-workspace-model";
import { CommercialConditions, CommercialCosts, CommercialOffers } from "./detail/tabs/CommercialTab";
import { CommercialOwners, CommercialTeam } from "./detail/tabs/CommercialPeople";
import { HistoryTab } from "./detail/tabs/HistoryTab";
import { KeysTab, type ActionableKeyMovement } from "./detail/tabs/KeysTab";
import { OverviewTab } from "./detail/tabs/OverviewTab";
import { TechnicalTab } from "./detail/tabs/TechnicalTab";
import { PropertyAssetManager } from "./detail/PropertyAssetManager";
import { findPropertyPerson, normalizeText, propertyStatusKind } from "./property-display";
import { PROPERTY_PRIMARY_BUTTON_CLASS, PROPERTY_SECONDARY_BUTTON_CLASS, PropertyFieldGrid } from "./property-ui";
import { PropertyPublicationCenter } from "./publication";
import { getSitePublicationState } from "./publication/site-publication-state";

const WORKSPACE_TAB_TRIGGER_CLASS =
  "mx-0 h-6 shrink-0 gap-1 rounded-[6px] px-2.5 text-[11px] font-light shadow-none data-[state=active]:bg-[var(--app-surface-solid)] data-[state=active]:text-[var(--app-text-primary)] data-[state=active]:shadow-none sm:text-[12px]";
const WORKSPACE_TAB_ICON_CLASS = "h-3 w-3 shrink-0";

const WORKSPACE_TABS = [
  { value: "overview", label: "Visão geral", icon: FileText },
  { value: "technical", label: "Ficha técnica", icon: ShieldCheck },
  { value: "commercial", label: "Comercial", icon: WalletCards },
  { value: "media", label: "Mídia", icon: ImageIcon },
  { value: "publication", label: "Publicação", icon: Globe2 },
  { value: "keys", label: "Chaves", icon: KeyRound },
  { value: "history", label: "Histórico", icon: History },
] as const;

function isShareAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function WorkspaceLoading() {
  return (
    <AppLayout title="Ficha do imóvel">
      <div className="mx-auto max-w-[1500px] space-y-6 py-2">
        <Skeleton className="h-10 w-72" />
        <div className="grid gap-4 lg:grid-cols-12">
          <Skeleton className="aspect-[16/10] rounded-[8px] lg:col-span-7" />
          <div className="space-y-4 lg:col-span-5">
            <Skeleton className="h-32 rounded-[8px]" />
            <Skeleton className="h-32 rounded-[8px]" />
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

export type PropertyWorkspaceTab =
  | "overview"
  | "technical"
  | "commercial"
  | "media"
  | "publication"
  | "keys"
  | "history";

type PropertyWorkspaceScreenProps = {
  initialTab?: PropertyWorkspaceTab;
};

export function PropertyWorkspaceScreen({
  initialTab = "overview",
}: PropertyWorkspaceScreenProps) {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const {
    activeOrganization,
    organization,
    tenantContext,
  } = useAuth();
  const propertyId = typeof params.id === "string" ? params.id : null;
  const [activeTab, setActiveTab] =
    useState<PropertyWorkspaceTab>(initialTab);
  const workspaceQuery = usePropertyWorkspace(propertyId);
  const { data: users = [] } = useUsers({ scope: "filters" });
  const historyQuery = usePropertyHistory(propertyId, {
    enabled: activeTab === "history",
  });
  const updatePropertyMutation = useUpdateProperty();
  const offerMutation = useUpsertPropertyOffer(propertyId);
  const keyMutation = useCreatePropertyKey(propertyId);
  const movementMutation = useMovePropertyKey(propertyId);
  const normalizedResourcesAvailable =
    workspaceQuery.data?.meta.normalized_resources_available ?? true;
  const sitePublicationQuery = usePropertyPublications(
    propertyId,
    normalizedResourcesAvailable,
  );
  const createOwnershipMutation = useCreatePropertyOwnership(propertyId);
  const updateOwnershipMutation = useUpdatePropertyOwnership(propertyId);
  const endOwnershipMutation = useEndPropertyOwnership(propertyId);
  const [offerDialogOpen, setOfferDialogOpen] = useState(false);
  const [offerType, setOfferType] = useState<PropertyOfferType>("sale");
  const [keyDialogOpen, setKeyDialogOpen] = useState(false);
  const [movementDialogOpen, setMovementDialogOpen] = useState(false);
  const [movementType, setMovementType] =
    useState<ActionableKeyMovement>("checkout");
  const [selectedKey, setSelectedKey] = useState<PropertyWorkspaceKey | null>(
    null,
  );
  const [ownershipDialogOpen, setOwnershipDialogOpen] = useState(false);
  const [endOwnershipDialogOpen, setEndOwnershipDialogOpen] = useState(false);
  const [selectedOwnership, setSelectedOwnership] =
    useState<PropertyWorkspaceOwnership | null>(null);

  const response = workspaceQuery.data;
  const workspace = response?.data;
  const property = workspace?.property;
  const isEditAccessReady = isPropertyEditAccessReady({
    isEditing: true,
    propertyOrganizationId: property?.organization_id,
    activeOrganizationId: activeOrganization.organizationId,
    loadedOrganizationId: organization?.id,
    tenantOrganizationId: tenantContext?.organizationId,
    propertyEditPolicy: organization?.property_edit_policy,
  });
  const canEditProperty = Boolean(
    property &&
      isEditAccessReady &&
      property.can_edit === true,
  );
  const siteInfoQuery = useQuery({
    queryKey: ["org-site-info", property?.organization_id],
    queryFn: () => getPropertySiteInfo(property?.organization_id),
    enabled: Boolean(property?.organization_id),
    staleTime: 1000 * 60 * 5,
  });
  const orderedAssets = useMemo(
    () =>
      [...(workspace?.assets ?? [])].sort(
        (left, right) =>
          left.sort_order - right.sort_order ||
          left.created_at.localeCompare(right.created_at),
      ),
    [workspace?.assets],
  );
  const images = useMemo(
    () =>
      property
        ? collectPropertyImages(
            property,
            orderedAssets,
            Boolean(response?.meta.has_asset_photos),
          )
        : [],
    [property, orderedAssets, response?.meta.has_asset_photos],
  );
  const selectedOffer =
    workspace?.offers.find((offer) => offer.offer_type === offerType) ?? null;

  if (workspaceQuery.isLoading) return <WorkspaceLoading />;

  if (workspaceQuery.isError || !workspace || !property || !response) {
    return (
      <AppLayout title="Ficha do imóvel" borderless>
        <div className="property-workspace-surface mx-auto flex min-h-[55vh] max-w-2xl items-center p-6 text-[12px] font-light [&_button]:rounded-[6px] [&_button]:text-[12px] [&_button]:font-light">
          <Alert
            variant="destructive"
            className="rounded-[8px] border-0 bg-destructive/10"
          >
            <CircleAlert className="h-4 w-4" />
            <AlertTitle>Não foi possível abrir a ficha</AlertTitle>
            <AlertDescription className="mt-2">
              {workspaceQuery.error instanceof Error
                ? workspaceQuery.error.message
                : "O imóvel não existe ou não está disponível para o seu perfil."}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  type="button"
                  onClick={() => void workspaceQuery.refetch()}
                  disabled={workspaceQuery.isFetching}
                  className="h-9 rounded-[6px] bg-primary/50 px-3 text-[12px] font-light text-primary-foreground shadow-none hover:bg-primary"
                >
                  {workspaceQuery.isFetching
                    ? "Tentando novamente"
                    : "Tentar novamente"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.push("/properties")}
                >
                  Voltar para imóveis
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        </div>
      </AppLayout>
    );
  }

  const address = [
    property.endereco,
    property.numero,
    property.bairro,
    property.cidade,
    property.uf,
  ]
    .filter(Boolean)
    .join(", ");
  const primaryOffer =
    workspace.offers.find((offer) => offer.status === "active") ??
    workspace.offers[0];
  const title =
    property.title ||
    `${property.tipo_de_imovel || property.tipo || "Imóvel"} em ${property.bairro || property.cidade || "localização não informada"}`;
  const sitePublication = sitePublicationQuery.data?.data.publications.find(
    (publication) => publication.channel === "site",
  );
  const sitePublicationState = getSitePublicationState(
    sitePublication ?? property.site_publication,
    Boolean(property.published_on_site ?? property.anunciar),
    Boolean(property.site_publication) || !normalizedResourcesAvailable || sitePublicationQuery.isSuccess,
  );
  const statusKind = propertyStatusKind(property.status);
  const isSold = statusKind === "sold";
  const isReserved = statusKind === "reserved";
  const isRented = statusKind === "rented";
  const isInactive = statusKind === "inactive";
  const isPrivateStatus = statusKind === "draft" || statusKind === "archived";
  const isUnavailable = isSold || isReserved || isRented;
  const dealType = normalizeText(property.tipo_de_negocio);
  const titleIntent = normalizeText(property.title);
  const isRentalIntent =
    [
      "aluguel",
      "locacao",
      "venda e aluguel",
      "venda e locacao",
      "temporada",
    ].includes(dealType) ||
    titleIntent.includes("locacao") ||
    titleIntent.includes("aluguel") ||
    titleIntent.includes("alugar") ||
    (Number(property.valor_locacao) > 0 && property.preco == null);
  const isSaleIntent = [
    "venda",
    "venda e aluguel",
    "venda e locacao",
    "lancamento",
  ].includes(dealType);
  const isPubliclyAvailable =
    sitePublicationState.canOpenPublicSite &&
    !isPrivateStatus &&
    !isUnavailable &&
    !isInactive &&
    property.autorizado_comercializacao !== false;
  const propertySiteUrl = isPubliclyAvailable
    ? sitePublication?.public_url ||
      buildPropertySiteUrl(property.code, siteInfoQuery.data)
    : null;
  const today = localDateISO();
  const developmentLink = workspace.development_link;

  const copyPropertyUrl = async () => {
    if (!propertySiteUrl) return false;

    try {
      await navigator.clipboard.writeText(propertySiteUrl);
      toast.success("Link do imóvel copiado!");
      return true;
    } catch {
      return false;
    }
  };

  const handleShareProperty = async () => {
    if (!propertySiteUrl) {
      toast.info("Publique o imóvel no site para compartilhar o link.");
      return;
    }

    if (navigator.share) {
      try {
        await navigator.share({
          title: property.title || property.code || "Imóvel",
          url: propertySiteUrl,
        });
        return;
      } catch (error) {
        if (isShareAbortError(error)) return;
      }
    }

    if (!(await copyPropertyUrl())) {
      window.open(propertySiteUrl, "_blank", "noopener,noreferrer");
      toast.info("Abrimos o link do imóvel em uma nova aba.");
    }
  };

  const openPropertySite = () => {
    if (!propertySiteUrl) return;
    window.open(propertySiteUrl, "_blank", "noopener,noreferrer");
  };

  const selectTab = (nextTab: PropertyWorkspaceTab) => {
    setActiveTab(nextTab);
    if (propertyId) {
      router.replace(`/properties/${propertyId}?tab=${nextTab}`, { scroll: false });
    }
  };
  const primaryOwnership = workspace.ownerships.find((item) => item.is_primary && !item.valid_to) ?? workspace.ownerships.find((item) => !item.valid_to);
  const responsiblePerson = findPropertyPerson(users, property.responsible_user_id, property.cadastrado_por);
  const ownerDisplayName = property.third_party_kind === "partner" && property.partner_name
    ? property.partner_name
    : primaryOwnership?.owner.name ?? property.owner_name ?? null;

  const changePropertyStatus = (
    status: "ativo" | "reservado" | "vendido" | "alugado",
  ) => {
    if (updatePropertyMutation.isPending) return;

    void updatePropertyMutation
      .mutateAsync({
        id: property.id,
        status,
        expected_updated_at: property.updated_at,
      })
      .then(() => workspaceQuery.refetch())
      .catch(() => undefined);
  };

  const openOffer = (type: PropertyOfferType) => {
    setOfferType(type);
    setOfferDialogOpen(true);
  };

  const submitOffer = async (input: PropertyOfferUpsertInput) => {
    await offerMutation.mutateAsync({ offerType, input });
    setOfferDialogOpen(false);
  };

  const submitKey = async (
    input: Parameters<typeof keyMutation.mutateAsync>[0],
  ) => {
    await keyMutation.mutateAsync(input);
    setKeyDialogOpen(false);
  };

  const openMovement = (
    propertyKey: PropertyWorkspaceKey,
    type: ActionableKeyMovement,
  ) => {
    setSelectedKey(propertyKey);
    setMovementType(type);
    setMovementDialogOpen(true);
  };

  const submitMovement = async (input: PropertyKeyMovementInput) => {
    if (!selectedKey) return;
    await movementMutation.mutateAsync({ keyId: selectedKey.id, input });
    setMovementDialogOpen(false);
  };

  const openOwnership = (
    ownership: PropertyWorkspaceOwnership | null = null,
  ) => {
    setSelectedOwnership(ownership);
    setOwnershipDialogOpen(true);
  };

  const submitOwnership = async (command: OwnershipSubmitInput) => {
    if (command.mode === "create") {
      await createOwnershipMutation.mutateAsync(command.input);
    } else {
      await updateOwnershipMutation.mutateAsync({
        ownershipId: command.ownershipId,
        input: command.input,
      });
    }
    setOwnershipDialogOpen(false);
  };

  const openEndOwnership = (ownership: PropertyWorkspaceOwnership) => {
    setSelectedOwnership(ownership);
    setEndOwnershipDialogOpen(true);
  };

  const submitEndOwnership = async (
    input: Parameters<typeof endOwnershipMutation.mutateAsync>[0]["input"],
  ) => {
    if (!selectedOwnership) return;
    await endOwnershipMutation.mutateAsync({
      ownershipId: selectedOwnership.id,
      input,
    });
    setEndOwnershipDialogOpen(false);
  };

  return (
    <AppLayout title="Ficha do imóvel" borderless>
      <div className="property-workspace-surface min-h-full bg-transparent text-[12px] font-light">
        <div className="space-y-3">
          <header className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push("/properties")}
                className="-ml-2 h-8 gap-1.5 px-2 text-[12px] font-light text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-soft)]"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                Imóveis
              </Button>

              <div className="flex items-center gap-1.5">
                {propertySiteUrl && (
                  <Button type="button" variant="ghost" className={`${PROPERTY_SECONDARY_BUTTON_CLASS} bg-[var(--app-surface-solid)]`} onClick={() => void handleShareProperty()}>
                    <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Compartilhar
                  </Button>
                )}
                {canEditProperty && (
                  <Button
                    onClick={() => router.push(`/properties/${property.id}/edit`)}
                    className={PROPERTY_PRIMARY_BUTTON_CLASS}
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    Editar imóvel
                  </Button>
                )}

                {(propertySiteUrl || response.meta.can_manage) && (
                  <PropertyWorkspaceActionsMenu
                    label={`Ações do imóvel ${property.code || title}`}
                    canManage={response.meta.can_manage}
                    hasSiteUrl={Boolean(propertySiteUrl)}
                    statusKind={statusKind}
                    isSaleIntent={isSaleIntent}
                    isRentalIntent={isRentalIntent}
                    pending={updatePropertyMutation.isPending}
                    onOpenSite={openPropertySite}
                    onChangeStatus={changePropertyStatus}
                    onOpenPublication={() => selectTab("publication")}
                  />
                )}
              </div>
            </div>

            {developmentLink && response.meta.can_manage && (
              <button
                type="button"
                onClick={() =>
                  router.push(
                    `/properties/developments/${developmentLink.development.id}`,
                  )
                }
                className="group flex w-full items-center gap-3 rounded-[12px] border-0 bg-[var(--app-surface-solid)] px-3 py-2.5 text-left shadow-none transition-colors hover:bg-[var(--app-surface-hover)] sm:px-4"
              >
                <Building2 className="h-4 w-4 shrink-0 text-[var(--app-text-secondary)]" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-light text-[var(--app-text-tertiary)]">
                    Vinculado ao empreendimento
                  </span>
                  <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] font-light text-[var(--app-text-secondary)]">
                    <span className="text-[var(--app-text-primary)]">
                      {developmentLink.development.name}
                    </span>
                    <span aria-hidden="true">›</span>
                    <span>{developmentLink.phase.name}</span>
                    <span aria-hidden="true">›</span>
                    <span>{developmentLink.building.name}</span>
                    {developmentLink.floor_plan && (
                      <>
                        <span aria-hidden="true">›</span>
                        <span>{developmentLink.floor_plan.name}</span>
                      </>
                    )}
                    <span aria-hidden="true">›</span>
                    <span>Unidade {developmentLink.unit.unit_number}</span>
                  </span>
                </span>
                <span className="hidden shrink-0 items-center gap-1 text-[12px] font-light text-[var(--app-text-secondary)] sm:flex">
                  Abrir empreendimento
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
              </button>
            )}

            <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
              <PropertyGallery images={images} title={title} onViewAll={images.length > 0 && response?.meta.has_asset_photos ? () => selectTab("media") : undefined} />
              <PropertyWorkspaceSummary
                property={property}
                summary={workspace.summary}
                primaryOffer={primaryOffer}
                title={title}
                address={address}
                siteLabel={sitePublicationState.label}
                siteTone={sitePublicationState.tone}
                responsible={responsiblePerson}
                ownerName={ownerDisplayName}
              />
            </div>
          </header>

          <Tabs
            value={activeTab}
            onValueChange={(value) => selectTab(value as PropertyWorkspaceTab)}
            className="space-y-3"
          >
            <div
              data-collapse="compact"
              className="app-responsive-tab-list min-w-0 flex-1"
            >
              <TabsList
                data-responsive-tab-scroll
                aria-label="Seções da ficha do imóvel"
                className="inline-flex h-8 w-fit max-w-full justify-start overflow-x-auto rounded-[8px] bg-[var(--app-surface-soft)] p-1 text-[var(--app-text-secondary)] shadow-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {WORKSPACE_TABS.map(({ value, label, icon: Icon }) => (
                  <TabsTrigger
                    key={value}
                    value={value}
                    data-responsive-tab
                    aria-label={label}
                    title={label}
                    className={WORKSPACE_TAB_TRIGGER_CLASS}
                  >
                    <Icon aria-hidden="true" className={WORKSPACE_TAB_ICON_CLASS} />
                    <span className="app-responsive-tab-label">{label}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            <TabsContent value="overview">
              <OverviewTab workspace={workspace} onOpenTechnical={() => selectTab("technical")} />
            </TabsContent>

            <TabsContent value="technical">
              <TechnicalTab
                property={property}
                canEdit={canEditProperty}
                onEdit={() => router.push(`/properties/${property.id}/edit`)}
              />
            </TabsContent>

            <TabsContent value="commercial" className="space-y-3">
              {normalizedResourcesAvailable && (
                <CommercialOffers
                  offers={workspace.offers}
                  canManage={response.meta.can_manage}
                  onOpenOffer={openOffer}
                />
              )}
              <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
                <div className="min-w-0 space-y-3">
                  <CommercialCosts property={property} />
                  <CommercialConditions property={property} />
                </div>
                <div className="min-w-0 space-y-3">
                  <CommercialOwners
                    property={property}
                    ownerships={workspace.ownerships}
                    meta={response.meta}
                    normalizedResourcesAvailable={normalizedResourcesAvailable}
                    today={today}
                    onCreate={() => openOwnership()}
                    onEdit={openOwnership}
                    onEnd={openEndOwnership}
                  />
                  <CommercialTeam
                    responsible={responsiblePerson}
                    captor={findPropertyPerson(users, property.cadastrado_por)}
                    broker={findPropertyPerson(users, property.corretor_id)}
                    editPolicy={organization?.property_edit_policy}
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="media">
              <PropertyAssetManager propertyId={property.id} legacyPhotoCount={response.meta.has_asset_photos ? 0 : images.length} />
            </TabsContent>

            <TabsContent value="publication" className="space-y-3">
              {normalizedResourcesAvailable ? (
                <PropertyPublicationCenter
                  propertyId={property.id}
                  assets={orderedAssets}
                  hasAssetPhotos={Boolean(response.meta.has_asset_photos)}
                />
              ) : (
                <Panel title="Publicação">
                  <PropertyFieldGrid
                    columns={3}
                    fields={[
                      {
                        label: "Publicado no site",
                        value: (property.published_on_site ?? property.anunciar) == null
                          ? "Não informado"
                          : (property.published_on_site ?? property.anunciar) ? "Sim" : "Não",
                      },
                      {
                        label: "Destaque",
                        value: (property.is_featured ?? property.destaque) == null
                          ? "Não informado"
                          : (property.is_featured ?? property.destaque) ? "Sim" : "Não",
                      },
                      {
                        label: "Super destaque",
                        value: property.super_destaque == null ? "Não informado" : property.super_destaque ? "Sim" : "Não",
                      },
                      {
                        label: "Visibilidade do endereço",
                        value: property.address_visibility || property.public_address_visibility || "Não informado",
                      },
                    ]}
                  />
                </Panel>
              )}
            </TabsContent>

            <TabsContent value="keys">
              <KeysTab
                property={property}
                keys={workspace.keys}
                canManage={response.meta.can_manage}
                normalizedResourcesAvailable={normalizedResourcesAvailable}
                active={activeTab === "keys"}
                onCreateKey={() => setKeyDialogOpen(true)}
                onMove={openMovement}
              />
            </TabsContent>

            <TabsContent value="history">
              <HistoryTab
                workspace={workspace}
                canManage={response.meta.can_manage}
                normalizedResourcesAvailable={normalizedResourcesAvailable}
                events={historyQuery.data}
                loading={historyQuery.isLoading}
                error={historyQuery.isError}
                fetching={historyQuery.isFetching}
                onRetry={() => void historyQuery.refetch()}
                createdByName={findPropertyPerson(users, property.created_by, property.cadastrado_por)?.name ?? null}
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {normalizedResourcesAvailable && offerDialogOpen && (
        <PropertyOfferDialog
          open
          onOpenChange={setOfferDialogOpen}
          offerType={offerType}
          offer={selectedOffer}
          pending={offerMutation.isPending}
          onSubmit={submitOffer}
        />
      )}
      {normalizedResourcesAvailable && keyDialogOpen && (
        <PropertyKeyCreateDialog
          open
          onOpenChange={setKeyDialogOpen}
          pending={keyMutation.isPending}
          onSubmit={submitKey}
        />
      )}
      {normalizedResourcesAvailable && movementDialogOpen && (
        <PropertyKeyMovementDialog
          open
          onOpenChange={setMovementDialogOpen}
          movementType={movementType}
          propertyKey={selectedKey}
          pending={movementMutation.isPending}
          onSubmit={submitMovement}
        />
      )}
      {normalizedResourcesAvailable && ownershipDialogOpen && (
        <PropertyOwnershipDialog
          open
          onOpenChange={setOwnershipDialogOpen}
          ownership={selectedOwnership}
          canViewOwnerContacts={response.meta.can_view_owner_contacts}
          pending={
            createOwnershipMutation.isPending ||
            updateOwnershipMutation.isPending
          }
          onSubmit={submitOwnership}
        />
      )}
      {normalizedResourcesAvailable &&
        endOwnershipDialogOpen &&
        selectedOwnership && (
          <PropertyOwnershipEndDialog
            open
            onOpenChange={setEndOwnershipDialogOpen}
            ownership={selectedOwnership}
            pending={endOwnershipMutation.isPending}
            onSubmit={submitEndOwnership}
          />
        )}
    </AppLayout>
  );
}

export default PropertyWorkspaceScreen;
