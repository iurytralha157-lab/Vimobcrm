"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AppLayout } from "@/components/shared/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
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
  Plus,
  Search,
  Loader2,
  Building2,
  AlertTriangle,
  RefreshCw,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  useInfiniteProperties,
  useUpdateProperty,
  useDeleteProperty,
  type Property,
  type PropertyFilters,
} from "@/hooks/use-properties";
import { PropertyCard } from "@/components/features/properties/PropertyCard";
import { PropertyHistoryDialog } from "@/components/features/properties/PropertyHistoryDialog";
import { PropertyPreviewDialog } from "@/components/features/properties/PropertyPreviewDialog";
import { PropertySectionTabs } from "@/components/features/properties/PropertySectionTabs";
import { VimobLoader } from "@/components/shared/loading";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/contexts/AuthContext";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useUsers } from "@/hooks/use-users";
import { usePropertyTypes } from "@/hooks/use-property-types";
import {
  usePropertyCities,
  usePropertyCondominiums,
  usePropertyNeighborhoods,
} from "@/hooks/use-property-locations";
import {
  canDeleteProperties,
  canManageProperties,
  canUpdatePropertyAvailability,
} from "@/lib/access/properties";
import { cn } from "@/lib/utils";
import { KpiCard, KpiRow } from "@/components/features/marketing/marketing-ui";
import { formatCount } from "@/components/features/marketing/marketing-format";
import { usePropertyCatalogStats } from "@/hooks/properties/use-property-catalog-stats";
import { findPropertyPerson, formatPropertyMoney, plural } from "@/components/features/properties/property-display";
import { ALL_FILTER_VALUE, PropertyFiltersPanel } from "@/components/features/properties/list/PropertyFiltersPanel";
import { LaunchDevelopmentsSection } from "@/components/features/properties/list/LaunchDevelopmentsSection";
import { getPresetFilters, type PropertyCatalogPreset } from "@/components/features/properties/list/property-catalog-presets";
import { getPropertySiteInfo } from "@/lib/api/property-support";
import { isPropertyWorkspaceConflict } from "@/lib/property-concurrency";
import { getPropertyNumericFilterErrors, getPropertyCatalogLocationId } from "@/lib/validation/property-filter-input";
import { formatPtBRNumber } from "@/lib/utils/formatting";

const formatPrice = (value: number | null, tipo: string | null) => {
  if (!value) return "Preço não informado";
  const formatted = formatPropertyMoney(value);
  const normalizedType = (tipo || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (normalizedType === "temporada") {
    return `${formatted}/diária`;
  }
  if (
    ["aluguel", "locacao", "venda e aluguel", "venda e locacao"].includes(
      normalizedType,
    )
  ) {
    return `${formatted}/mês`;
  }
  return formatted;
};

export type { PropertyCatalogPreset };

type PropertiesScreenProps = {
  preset?: PropertyCatalogPreset;
};

const getStatusFilterValue = (filters: PropertyFilters) => {
  if (filters.status === "ativo" || filters.status === "active")
    return "available";
  if (filters.status === "reservado" || filters.status === "reserved")
    return "reserved";
  if (filters.status === "vendido" || filters.status === "sold") return "sold";
  if (filters.status === "alugado" || filters.status === "rented")
    return "rented";
  if (filters.status === "inativo" || filters.status === "inactive")
    return "inactive";
  return ALL_FILTER_VALUE;
};

const getSiteVisibilityValue = (filters: PropertyFilters) => {
  if (filters.published_on_site === "true") return "published";
  if (filters.published_on_site === "false") return "unpublished";
  return ALL_FILTER_VALUE;
};

export default function Properties({ preset = "all" }: PropertiesScreenProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<PropertyFilters>(() =>
    getPresetFilters(preset),
  );
  const [previewProperty, setPreviewProperty] = useState<Property | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [historyProperty, setHistoryProperty] = useState<Property | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [deletePropertyTarget, setDeletePropertyTarget] =
    useState<Property | null>(null);
  const isMobile = useIsMobile();
  const {
    activeOrganization,
    organization,
    profile,
    tenantContext,
    isSuperAdmin,
  } = useAuth();
  const organizationId = activeOrganization.organizationId;
  const propertyAccessContext = {
    userId: profile?.id,
    organizationId,
    isSuperAdmin,
    memberRole: tenantContext?.memberRole,
    permissions: tenantContext?.permissions,
    propertyEditPolicy: organization?.property_edit_policy,
  };
  const canUpdateAvailability = canUpdatePropertyAvailability(
    propertyAccessContext,
  );
  const canDeleteProperty = canDeleteProperties(propertyAccessContext);
  const canCreateProperty = canManageProperties(propertyAccessContext);
  const { data: users = [] } = useUsers({ scope: "filters" });
  const { data: propertyTypes = [] } = usePropertyTypes();
  const { data: cities = [] } = usePropertyCities();
  const selectedCity = cities.find((city) => filters.city_id
    ? city.id === filters.city_id
    : city.name === filters.cidade && (!filters.uf || city.uf === filters.uf));
  // Keep the full read-only location set in cache. Legacy cities are discovered
  // from property text and do not have a writable catalog id, so filtering the
  // API by their synthetic id would incorrectly make their neighborhoods look
  // empty in the main property catalog.
  const { data: allNeighborhoods = [] } = usePropertyNeighborhoods();
  const neighborhoods = selectedCity
    ? allNeighborhoods.filter(
        (neighborhood) =>
          neighborhood.city?.name?.trim().toLocaleLowerCase("pt-BR") ===
          selectedCity.name.trim().toLocaleLowerCase("pt-BR") &&
          (!selectedCity.uf || neighborhood.city?.uf === selectedCity.uf),
      )
    : allNeighborhoods;
  const { data: condominiums = [] } = usePropertyCondominiums();
  const { data: siteInfo = null } = useQuery({
    queryKey: ["org-site-info", organizationId],
    queryFn: async () => getPropertySiteInfo(organizationId),
    enabled: !!organizationId,
    staleTime: 1000 * 60 * 5,
  });

  const debouncedSearch = useDebouncedValue(search.trim(), 350);
  const debouncedFilters = useDebouncedValue(filters, 120);
  const numericFilterErrors = getPropertyNumericFilterErrors(filters);
  const hasInvalidNumericFilters = Object.keys(numericFilterErrors).length > 0;

  const {
    data,
    isLoading,
    isFetching,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteProperties(debouncedSearch, 24, debouncedFilters, {
    enabled: !hasInvalidNumericFilters,
  });

  const statsQuery = usePropertyCatalogStats(debouncedSearch, debouncedFilters, {
    enabled: !hasInvalidNumericFilters,
  });

  const properties = data?.pages.flatMap((page) => page.properties) || [];
  const totalCount = data?.pages[0]?.totalCount || 0;
  const updateProperty = useUpdateProperty();
  const deleteProperty = useDeleteProperty();

  const openEdit = (property: Property) => {
    router.push(`/properties/${property.id}/edit`);
  };

  const openDetails = (property: Property) => {
    router.push(`/properties/${property.id}`);
  };

  const handleDelete = async (property: Property) => {
    await deleteProperty.mutateAsync({
      id: property.id,
      expected_updated_at: property.updated_at,
    });
  };

  const confirmDelete = async () => {
    if (!deletePropertyTarget) return;
    try {
      await handleDelete(deletePropertyTarget);
      setDeletePropertyTarget(null);
    } catch (error) {
      if (isPropertyWorkspaceConflict(error)) {
        setDeletePropertyTarget(null);
      }
      // The mutation already exposes the safe error message through the shared toast flow.
    }
  };

  const handleChangeStatus = async (
    id: string,
    status: "ativo" | "reservado" | "vendido" | "alugado",
    expectedUpdatedAt: string,
  ) => {
    try {
      await updateProperty.mutateAsync({
        id,
        status,
        expected_updated_at: expectedUpdatedAt,
      });
    } catch {
      // The mutation hook reports the error without leaking a rejected event promise.
    }
  };

  const handleOpenPublication = (id: string) => {
    router.push(`/properties/${id}?tab=publication`);
  };

  const isFilterSettling =
    search.trim() !== debouncedSearch || filters !== debouncedFilters;
  const isListUpdating =
    Boolean(data) && !isFetchingNextPage && (isFetching || isFilterSettling);
  const isFilterUpdating = isListUpdating || isFilterSettling;
  const propertyListErrorMessage = error instanceof Error ? error.message : "";
  const isMissingPropertiesSchema =
    propertyListErrorMessage.includes("properties") &&
    (propertyListErrorMessage.includes("does not exist") ||
      propertyListErrorMessage.includes("schema cache"));

  const updateFilter = (field: keyof PropertyFilters, value: string) => {
    setFilters((current) => ({
      ...current,
      [field]: value && value !== ALL_FILTER_VALUE ? value : undefined,
    }));
  };

  const updateCityFilter = (value: string) => {
    const city = cities.find((item) => item.id === value);

    setFilters((current) => ({
      ...current,
      cidade: city ? city.name : undefined,
      city_id: getPropertyCatalogLocationId(city),
      uf: city?.uf || undefined,
      bairro: undefined,
      neighborhood_id: undefined,
    }));
  };

  const updateNeighborhoodFilter = (value: string) => {
    const neighborhood = neighborhoods.find((item) => item.id === value);

    setFilters((current) => ({
      ...current,
      bairro: neighborhood ? neighborhood.name : undefined,
      neighborhood_id: getPropertyCatalogLocationId(neighborhood),
    }));
  };

  const clearFilters = () => {
    setSearch("");
    setFilters(getPresetFilters(preset));
  };

  const updateStatusFilter = (value: string) => {
    setFilters((current) => {
      const next: PropertyFilters = {
        ...current,
        status: undefined,
      };

      if (value === "available") next.status = "ativo";
      if (value === "reserved") next.status = "reservado";
      if (value === "sold") next.status = "vendido";
      if (value === "rented") next.status = "alugado";
      if (value === "inactive") next.status = "inativo";
      return next;
    });
  };

  const updateSiteVisibilityFilter = (value: string) => {
    setFilters((current) => ({
      ...current,
      published_on_site:
        value === "published" ? "true" : value === "unpublished" ? "false" : undefined,
    }));
  };

  const activeFilterCount =
    Object.entries(filters).filter(([key, value]) => {
      if (!value) return false;
      if (key === "city_id" || key === "neighborhood_id" || key === "uf") return false;
      return getPresetFilters(preset)[key as keyof PropertyFilters] !== value;
    }).length + (search.trim() ? 1 : 0);
  const statusFilterValue = getStatusFilterValue(filters);
  const siteVisibilityValue = getSiteVisibilityValue(filters);
  const selectedNeighborhood = neighborhoods.find(
    (neighborhood) => filters.neighborhood_id ? neighborhood.id === filters.neighborhood_id : neighborhood.name === filters.bairro,
  );
  const isRentalCatalog = preset === "rentals";
  const isLaunchCatalog = preset === "launches";
  const isReadyCatalog = preset === "ready";
  const isThirdPartyCatalog = preset === "third_party";
  const activeSection = isRentalCatalog
    ? "rentals"
    : isLaunchCatalog
      ? "developments"
      : isReadyCatalog
        ? "ready"
        : isThirdPartyCatalog
          ? "third_party"
          : "all";
  const pageTitle = isRentalCatalog
    ? "Imóveis para locação e temporada"
    : isLaunchCatalog
      ? "Imóveis em lançamento"
      : isReadyCatalog
        ? "Imóveis prontos"
        : isThirdPartyCatalog
          ? "Imóveis de terceiros"
          : "Imóveis";
  const searchPlaceholder = isRentalCatalog
    ? "Buscar imóveis para locação ou temporada"
    : isLaunchCatalog
      ? "Buscar imóveis em lançamento"
      : "Buscar por endereço, nome, bairro ou código";
  const stats = statsQuery.data;
  if (isLoading && !data) {
    return (
      <AppLayout title={pageTitle}>
        <div className="space-y-3">
          <PropertySectionTabs activeSection={activeSection} />
          <div className="grid min-h-[360px] place-items-center">
            <VimobLoader size="lg" label="Carregando imóveis..." />
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title={pageTitle}>
      <div className="properties-screen animate-in space-y-3">
        <PropertySectionTabs activeSection={activeSection} />
        {isLaunchCatalog ? (
          <LaunchDevelopmentsSection canManageCatalog={canCreateProperty} />
        ) : (
          <KpiRow>
            <KpiCard
              label="Na carteira"
              value={formatCount(stats?.total)}
              note={stats ? `${plural(stats.sale, "de venda", "de venda")} · ${plural(stats.rental, "de locação", "de locação")}` : undefined}
            />
            <KpiCard
              label="Disponíveis"
              value={formatCount(stats?.available)}
              note={stats ? plural(stats.reserved, "reservado", "reservados") : undefined}
            />
            <KpiCard
              label="Publicados no site"
              value={formatCount(stats ? stats.total - stats.private : undefined)}
              note={stats ? `${formatCount(stats.private)} fora do site` : undefined}
            />
            <KpiCard
              label="Vendidos e alugados"
              value={formatCount(stats ? stats.sold + stats.rented : undefined)}
              note={stats ? `${plural(stats.sold, "vendido", "vendidos")} · ${plural(stats.rented, "alugado", "alugados")}` : undefined}
            />
          </KpiRow>
        )}
        <div className="min-w-0 space-y-3">
            <div className="app-toolbar flex flex-col gap-2 p-2 sm:flex-row sm:items-center">
              <div
                data-tour="properties-filter-search"
                className="relative w-full min-w-0 flex-1"
              >
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--app-text-tertiary)]" />
                <Input
                  value={search}
                  maxLength={120}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={searchPlaceholder}
                  className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] py-0 pl-9 pr-9 text-[12px] font-light shadow-none focus-visible:ring-1 focus-visible:ring-primary/30 focus-visible:ring-offset-0"
                />
                {isFilterUpdating && (
                  <Loader2 className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-primary" />
                )}
              </div>

              <div className="flex w-full min-w-0 items-center justify-between gap-2 sm:ml-auto sm:w-auto sm:justify-end">
                <span className="min-w-0 truncate text-[12px] font-light text-[var(--app-text-secondary)] sm:pl-1">
                  {hasInvalidNumericFilters ? "Revise os filtros numéricos" : isFilterUpdating
                    ? "Atualizando carteira..."
                    : `${formatPtBRNumber(totalCount)} ${isRentalCatalog ? "imóveis para locação ou temporada" : isLaunchCatalog ? "imóveis em lançamento" : "imóveis"}`}
                </span>
                <Button
                  data-tour="properties-filter-button"
                  type="button"
                  variant="ghost"
                  onClick={() => setFiltersOpen(true)}
                  className="h-8 shrink-0 gap-1.5 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2.5 text-[12px] font-light text-[var(--app-text-primary)] shadow-none hover:bg-[var(--app-surface-hover)]"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  {activeFilterCount > 0
                    ? `Filtros (${activeFilterCount})`
                    : "Filtros"}
                </Button>
                {canCreateProperty && (
                  <Button
                    data-tour="properties-new-button"
                    onClick={() => router.push("/properties/new")}
                    className="h-8 shrink-0 rounded-[6px] bg-primary px-3 text-[12px] font-light text-primary-foreground shadow-none hover:bg-primary/90"
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    {isMobile ? "Novo" : "Novo imóvel"}
                  </Button>
                )}
              </div>
            </div>

            <div
              data-tour="properties-list"
              className="relative min-h-[360px] min-w-0 space-y-3"
            >
              {hasInvalidNumericFilters && <p role="alert" className="rounded-[6px] bg-destructive/10 p-3 text-[12px] text-destructive">Os resultados ainda não foram atualizados. Corrija os valores no painel de filtros.</p>}
              {isListUpdating && (
                <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[8px] bg-background/55">
                  <VimobLoader size="lg" label="Atualizando imóveis..." />
                </div>
              )}

              {error && (
                <div className="app-card-soft flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] bg-destructive/10 text-destructive">
                      <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div>
                      <h2 className="text-[14px] font-normal">
                        {isMissingPropertiesSchema
                          ? "Carteira aguardando configuração"
                          : "Não foi possível carregar os imóveis"}
                      </h2>
                      <p className="mt-1 text-[12px] font-light leading-[18px] text-[var(--app-text-secondary)]">
                        {isMissingPropertiesSchema
                          ? "A estrutura de imóveis ainda precisa ser criada para ativar a carteira real."
                          : "Tente novamente para atualizar a carteira."}
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => refetch()}
                    className="h-9 shrink-0 rounded-[6px] border-0 bg-[var(--app-surface-solid)] text-[12px] font-light shadow-none hover:bg-[var(--app-surface-hover)]"
                  >
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                    Tentar novamente
                  </Button>
                </div>
              )}

              {!error && properties.length === 0 && (
                <Card className="app-card">
                  <CardContent className="py-12 text-center">
                    <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]">
                      <Building2 className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <h3 className="mb-1 text-[14px] font-normal">
                      {activeFilterCount > 0
                        ? "Nenhum imóvel encontrado"
                        : isRentalCatalog
                          ? "Nenhum imóvel para locação ou temporada"
                          : isLaunchCatalog
                            ? "Nenhum imóvel em lançamento"
                            : isReadyCatalog
                              ? "Nenhum imóvel pronto"
                              : isThirdPartyCatalog
                                ? "Nenhum imóvel de terceiro"
                                : "Nenhum imóvel cadastrado"}
                    </h3>
                    <p className="mb-4 text-[12px] font-light text-[var(--app-text-secondary)]">
                      {activeFilterCount > 0
                        ? "Ajuste os filtros para ampliar a busca."
                        : isRentalCatalog
                          ? "Cadastre um imóvel para locação ou temporada para vê-lo aqui."
                          : isLaunchCatalog
                            ? "Cadastre um imóvel com modalidade de lançamento para vê-lo aqui."
                            : isThirdPartyCatalog
                              ? "Cadastre um imóvel de parceiro ou proprietário particular para vê-lo aqui."
                              : "Cadastre o primeiro imóvel para começar a carteira."}
                    </p>
                    {activeFilterCount > 0 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={clearFilters}
                        className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] font-light shadow-none hover:bg-[var(--app-surface-hover)]"
                      >
                        <X className="mr-1.5 h-3.5 w-3.5" />
                        Limpar filtros
                      </Button>
                    ) : canCreateProperty ? (
                      <Button
                        type="button"
                        onClick={() => router.push("/properties/new")}
                        className="h-9 rounded-[6px] bg-primary text-[12px] font-light text-primary-foreground shadow-none hover:bg-primary/90"
                      >
                        <Plus className="mr-1.5 h-3.5 w-3.5" />
                        Cadastrar imóvel
                      </Button>
                    ) : null}
                  </CardContent>
                </Card>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {properties.map((property, index) => {
                  const canEditProperty = property.can_edit;

                  return (
                    <PropertyCard
                      key={property.id}
                      property={property}
                      onEdit={openEdit}
                      onOpenDetails={openDetails}
                      onDelete={() => setDeletePropertyTarget(property)}
                      onChangeStatus={handleChangeStatus}
                      onOpenPublication={handleOpenPublication}
                      onPreview={(selectedProperty) => {
                        setPreviewProperty(selectedProperty);
                        setPreviewOpen(true);
                      }}
                      onHistory={(selectedProperty) => {
                        setHistoryProperty(selectedProperty);
                        setHistoryOpen(true);
                      }}
                      formatPrice={formatPrice}
                      canEdit={canEditProperty}
                      canUpdateAvailability={canUpdateAvailability}
                      canDelete={canDeleteProperty}
                      siteInfo={siteInfo}
                      responsible={findPropertyPerson(users, property.responsible_user_id, property.cadastrado_por)}
                      prioritizeImage={index === 0}
                    />
                  );
                })}
              </div>

              {hasNextPage && (
                <div className="flex justify-center py-6">
                  <Button
                    type="button"
                    onClick={() => fetchNextPage()}
                    disabled={isFetchingNextPage}
                    className="h-9 min-w-[200px] rounded-[6px] bg-[var(--app-surface-solid)] text-[12px] font-light text-[var(--app-text-primary)] shadow-none hover:bg-[var(--app-surface-hover)]"
                  >
                    {isFetchingNextPage ? (
                      <>
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        Carregando...
                      </>
                    ) : (
                      "Carregar mais imóveis"
                    )}
                  </Button>
                </div>
              )}
            </div>
        </div>

        <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
          <SheetContent
            side={isMobile ? "bottom" : "right"}
            className={cn(
              "overflow-hidden border-0 bg-[var(--app-surface-solid)] p-0 shadow-none",
              isMobile
                ? "h-[92dvh] rounded-t-[8px]"
                : "w-[380px] rounded-l-[8px] sm:max-w-[380px]",
            )}
          >
            <SheetTitle className="sr-only">Filtros dos imóveis</SheetTitle>
            <PropertyFiltersPanel
              preset={preset}
              filters={filters}
              activeFilterCount={activeFilterCount}
              numericFilterErrors={numericFilterErrors}
              statusFilterValue={statusFilterValue}
              siteVisibilityValue={siteVisibilityValue}
              propertyTypes={propertyTypes}
              cities={cities}
              selectedCityId={selectedCity?.id || null}
              neighborhoods={neighborhoods}
              selectedNeighborhoodId={selectedNeighborhood?.id || null}
              hasSelectedCity={Boolean(selectedCity)}
              condominiums={condominiums}
              users={users}
              isMobile={isMobile}
              updateFilter={updateFilter}
              updateCityFilter={updateCityFilter}
              updateNeighborhoodFilter={updateNeighborhoodFilter}
              updateStatusFilter={updateStatusFilter}
              updateSiteVisibilityFilter={updateSiteVisibilityFilter}
              clearFilters={clearFilters}
              onClose={() => setFiltersOpen(false)}
            />
          </SheetContent>
        </Sheet>

        <PropertyPreviewDialog
          property={previewProperty}
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          formatPrice={formatPrice}
          siteInfo={siteInfo}
          canUpdateAvailability={canUpdateAvailability}
        />
        <PropertyHistoryDialog
          property={historyProperty}
          open={historyOpen}
          onOpenChange={setHistoryOpen}
        />

        <AlertDialog
          open={Boolean(deletePropertyTarget)}
          onOpenChange={(nextOpen) => {
            if (!nextOpen && !deleteProperty.isPending)
              setDeletePropertyTarget(null);
          }}
        >
          <AlertDialogContent className="w-[calc(100vw-24px)] max-w-[440px] rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-5 shadow-none">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-[14px] font-normal">
                Excluir imóvel?
              </AlertDialogTitle>
              <AlertDialogDescription className="text-[12px] font-light leading-[18px] text-[var(--app-text-secondary)]">
                {deletePropertyTarget
                  ? `O imóvel ${deletePropertyTarget.code || deletePropertyTarget.title || ""} será removido da carteira. Esta ação não pode ser desfeita.`
                  : "Esta ação não pode ser desfeita."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] font-light shadow-none hover:bg-[var(--app-surface-hover)]">
                Cancelar
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={(event) => {
                  event.preventDefault();
                  void confirmDelete();
                }}
                disabled={deleteProperty.isPending}
                className="h-9 rounded-[6px] bg-destructive/70 text-[12px] font-light text-destructive-foreground shadow-none hover:bg-destructive"
              >
                {deleteProperty.isPending && (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                )}
                Excluir imóvel
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AppLayout>
  );
}
