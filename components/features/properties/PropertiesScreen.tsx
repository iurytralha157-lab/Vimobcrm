"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AppLayout } from "@/components/shared/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
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
  ChevronDown,
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
import { VimobLoader } from "@/components/shared/loading";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/contexts/AuthContext";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useUsers } from "@/hooks/use-users";
import { usePropertyTypes } from "@/hooks/use-property-types";
import { usePropertyOwners } from "@/hooks/use-property-owners";
import {
  usePropertyCities,
  usePropertyCondominiums,
  usePropertyNeighborhoods,
} from "@/hooks/use-property-locations";
import {
  canDeleteProperties,
  canEditPropertyDetails,
  canManageProperties,
  canUpdatePropertyAvailability,
} from "@/lib/access/properties";
import { cn } from "@/lib/utils";
import { getPropertySiteInfo } from "@/lib/api/property-support";
import { getUserFilterLabel } from "@/lib/user-display";

const formatPrice = (value: number | null, tipo: string | null) => {
  if (!value) return "Preço não informado";
  const formatted = `R$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (tipo === "Aluguel") {
    return `${formatted}/mês`;
  }
  return formatted;
};

const ALL_FILTER_VALUE = "__all__";
const EMPTY_FILTERS: PropertyFilters = {};

type PropertyWithCreator = Property & {
  cadastrado_por?: string | null;
  created_by?: string | null;
  responsible_user_id?: string | null;
};

const getAvailabilityValue = (filters: PropertyFilters) => {
  if (filters.published_on_site === "false") return "private";
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

export default function Properties() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<PropertyFilters>(EMPTY_FILTERS);
  const [previewProperty, setPreviewProperty] = useState<Property | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [historyProperty, setHistoryProperty] = useState<Property | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const [deletePropertyTarget, setDeletePropertyTarget] =
    useState<Property | null>(null);
  const isMobile = useIsMobile();
  const { profile, organization, tenantContext, isSuperAdmin } = useAuth();
  const organizationId = organization?.id || profile?.organization_id;
  const propertyAccessContext = {
    userId: profile?.id,
    organizationId,
    isSuperAdmin,
    memberRole: tenantContext?.memberRole,
    permissions: tenantContext?.permissions,
  };
  const canUpdateAvailability = canUpdatePropertyAvailability(
    propertyAccessContext,
  );
  const canDeleteProperty = canDeleteProperties(propertyAccessContext);
  const canCreateProperty = canManageProperties(propertyAccessContext);
  const { data: users = [] } = useUsers({ scope: "filters" });
  const { data: propertyTypes = [] } = usePropertyTypes();
  const { data: propertyOwners = [] } = usePropertyOwners();
  const { data: cities = [] } = usePropertyCities();
  const selectedCity = cities.find((city) => city.name === filters.cidade);
  const { data: neighborhoods = [] } = usePropertyNeighborhoods(
    selectedCity?.id,
  );
  const { data: condominiums = [] } = usePropertyCondominiums();
  const { data: siteInfo = null } = useQuery({
    queryKey: ["org-site-info", organizationId],
    queryFn: async () => getPropertySiteInfo(organizationId),
    enabled: !!organizationId,
    staleTime: 1000 * 60 * 5,
  });

  const debouncedSearch = useDebouncedValue(search.trim(), 350);
  const debouncedFilters = useDebouncedValue(filters, 120);

  const {
    data,
    isLoading,
    isFetching,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteProperties(debouncedSearch, 24, debouncedFilters);

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

  const handleDelete = async (id: string) => {
    await deleteProperty.mutateAsync(id);
  };

  const confirmDelete = async () => {
    if (!deletePropertyTarget) return;
    try {
      await handleDelete(deletePropertyTarget.id);
      setDeletePropertyTarget(null);
    } catch {
      // The mutation already exposes the safe error message through the shared toast flow.
    }
  };

  const handleChangeStatus = async (
    id: string,
    status: "ativo" | "reservado" | "vendido" | "alugado",
  ) => {
    await updateProperty.mutateAsync({
      id,
      status,
    });
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
      bairro: undefined,
    }));
  };

  const updateNeighborhoodFilter = (value: string) => {
    const neighborhood = neighborhoods.find((item) => item.id === value);

    setFilters((current) => ({
      ...current,
      bairro: neighborhood ? neighborhood.name : undefined,
    }));
  };

  const clearFilters = () => {
    setSearch("");
    setFilters({});
  };

  const updateAvailabilityFilter = (value: string) => {
    setFilters((current) => {
      const next: PropertyFilters = {
        ...current,
        status: undefined,
        published_on_site: undefined,
      };

      if (value === "available") next.status = "ativo";
      if (value === "reserved") next.status = "reservado";
      if (value === "sold") next.status = "vendido";
      if (value === "rented") next.status = "alugado";
      if (value === "inactive") next.status = "inativo";
      if (value === "private") next.published_on_site = "false";

      return next;
    });
  };

  const activeFilterCount =
    Object.values(filters).filter(Boolean).length + (search.trim() ? 1 : 0);
  const availabilityValue = getAvailabilityValue(filters);
  const selectedResponsible = users.find(
    (user) => user.id === filters.responsavel_id,
  );
  const selectedOwner = propertyOwners.find(
    (owner) => owner.id === filters.owner_id,
  );
  const selectedNeighborhood = neighborhoods.find(
    (neighborhood) => neighborhood.name === filters.bairro,
  );
  const selectedCondominium = condominiums.find(
    (condominium) => condominium.id === filters.condominium_id,
  );
  const cityLabel = selectedCity
    ? `${selectedCity.name}${selectedCity.uf ? ` (${selectedCity.uf})` : ""}`
    : "Cidade";
  const neighborhoodLabel = selectedNeighborhood?.name || "Bairro";
  const modalidadeLabel =
    filters.tipo_de_negocio === "Aluguel"
      ? "Locação"
      : filters.tipo_de_negocio === "Venda e Aluguel"
        ? "Venda e locação"
        : filters.tipo_de_negocio || "Modalidade";
  const availabilityLabel =
    availabilityValue === "available"
      ? "Disponível"
      : availabilityValue === "reserved"
        ? "Reservado"
        : availabilityValue === "sold"
          ? "Vendido"
          : availabilityValue === "rented"
            ? "Alugado"
            : availabilityValue === "inactive"
              ? "Inativo"
              : availabilityValue === "private"
                ? "Privado / fora do site"
                : "Disponibilidade";
  const responsibleLabel = selectedResponsible
    ? getUserFilterLabel(selectedResponsible)
    : "Responsável";
  const permutaLabel =
    filters.aceita_permuta === "true"
      ? "Aceita permuta"
      : filters.aceita_permuta === "false"
        ? "Não aceita permuta"
        : "Permuta";
  const financingLabel =
    filters.aceita_financiamento === "true"
      ? "Aceita financiamento"
      : filters.aceita_financiamento === "false"
        ? "Não aceita financiamento"
        : "Financiamento";
  const ownerLabel = selectedOwner?.name || "Proprietário";
  const condominiumLabel = selectedCondominium?.name || "Condomínio";
  const furnitureLabel = filters.mobilia || "Mobília";
  const exclusiveLabel =
    filters.exclusividade === "true"
      ? "Com exclusividade"
      : filters.exclusividade === "false"
        ? "Sem exclusividade"
        : "Exclusividade";
  const signLabel =
    filters.placa_no_local === "true"
      ? "Com placa"
      : filters.placa_no_local === "false"
        ? "Sem placa"
        : "Placa no local";
  const featuredLabel =
    filters.destaque === "true"
      ? "Em destaque"
      : filters.destaque === "false"
        ? "Sem destaque"
        : "Destaque";

  const filtersPanel = (
    <aside
      data-tour="properties-filters-panel"
      aria-label="Filtros dos imóveis"
      className="properties-filter-panel flex h-full min-h-0 flex-col overflow-hidden rounded-[8px] bg-[var(--app-surface-solid)] p-0 shadow-none lg:h-fit lg:max-h-[calc(100dvh-96px)]"
    >
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[14px] font-normal">
            <span className="grid h-8 w-8 place-items-center rounded-[6px] bg-primary/50 text-primary-foreground">
              <SlidersHorizontal className="h-4 w-4" />
            </span>
            Filtros
            {activeFilterCount > 0 && (
              <span className="rounded-[4px] bg-primary/50 px-2 py-0.5 text-[10px] font-light text-primary-foreground">
                {activeFilterCount}
              </span>
            )}
          </h2>
        </div>
        {activeFilterCount > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="h-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-[12px] font-light text-[var(--app-text-secondary)] shadow-none hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]"
          >
            Limpar
          </Button>
        )}
      </div>

      <div className="app-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        <div
          data-tour="properties-filter-search"
          className="relative hidden lg:block"
        >
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--app-text-tertiary)]" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar endereço, nome, bairro ou código"
            className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] py-0 pl-9 pr-9 text-[12px] font-light shadow-none focus-visible:ring-1 focus-visible:ring-primary/30 focus-visible:ring-offset-0"
          />
          {isFilterUpdating && (
            <Loader2 className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-primary" />
          )}
        </div>

        <div className="grid grid-cols-1 gap-3">
          <div data-tour="properties-filter-modality">
            <Select
              value={filters.tipo_de_negocio || ALL_FILTER_VALUE}
              onValueChange={(value) => updateFilter("tipo_de_negocio", value)}
            >
              <SelectTrigger className="border-0 bg-[var(--app-surface-soft)]">
                <span
                  className={cn(
                    "truncate",
                    !filters.tipo_de_negocio && "text-muted-foreground",
                  )}
                >
                  {modalidadeLabel}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_FILTER_VALUE}>Todas</SelectItem>
                <SelectItem value="Venda">Venda</SelectItem>
                <SelectItem value="Aluguel">Locação</SelectItem>
                <SelectItem value="Venda e Aluguel">Venda e locação</SelectItem>
                <SelectItem value="Temporada">Temporada</SelectItem>
                <SelectItem value="Lançamento">Lançamento</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div data-tour="properties-filter-availability">
            <Select
              value={availabilityValue}
              onValueChange={updateAvailabilityFilter}
            >
              <SelectTrigger className="border-0 bg-[var(--app-surface-soft)]">
                <span
                  className={cn(
                    "truncate",
                    availabilityValue === ALL_FILTER_VALUE &&
                      "text-muted-foreground",
                  )}
                >
                  {availabilityLabel}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_FILTER_VALUE}>Todas</SelectItem>
                <SelectItem value="available">Disponível</SelectItem>
                <SelectItem value="reserved">Reservado</SelectItem>
                <SelectItem value="sold">Vendido</SelectItem>
                <SelectItem value="rented">Alugado</SelectItem>
                <SelectItem value="inactive">Inativo</SelectItem>
                <SelectItem value="private">Privado / fora do site</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div data-tour="properties-filter-type">
            <Select
              value={filters.tipo_de_imovel || ALL_FILTER_VALUE}
              onValueChange={(value) => updateFilter("tipo_de_imovel", value)}
            >
              <SelectTrigger className="border-0 bg-[var(--app-surface-soft)]">
                <span
                  className={cn(
                    "truncate",
                    !filters.tipo_de_imovel && "text-muted-foreground",
                  )}
                >
                  {filters.tipo_de_imovel || "Tipo"}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_FILTER_VALUE}>Todos</SelectItem>
                {propertyTypes.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div
            data-tour="properties-filter-location"
            className="grid grid-cols-2 gap-2"
          >
            <Select
              value={selectedCity?.id || ALL_FILTER_VALUE}
              onValueChange={updateCityFilter}
            >
              <SelectTrigger className="border-0 bg-[var(--app-surface-soft)]">
                <span
                  className={cn(
                    "truncate",
                    !filters.cidade && "text-muted-foreground",
                  )}
                >
                  {cityLabel}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_FILTER_VALUE}>Todas</SelectItem>
                {cities.map((city) => (
                  <SelectItem key={city.id} value={city.id}>
                    {city.name}
                    {city.uf ? ` (${city.uf})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={selectedNeighborhood?.id || ALL_FILTER_VALUE}
              onValueChange={updateNeighborhoodFilter}
            >
              <SelectTrigger className="border-0 bg-[var(--app-surface-soft)]">
                <span
                  className={cn(
                    "truncate",
                    !filters.bairro && "text-muted-foreground",
                  )}
                >
                  {neighborhoodLabel}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_FILTER_VALUE}>Todos</SelectItem>
                {neighborhoods.map((neighborhood) => (
                  <SelectItem key={neighborhood.id} value={neighborhood.id}>
                    {neighborhood.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div data-tour="properties-filter-responsible">
            <Select
              value={filters.responsavel_id || ALL_FILTER_VALUE}
              onValueChange={(value) => updateFilter("responsavel_id", value)}
            >
              <SelectTrigger className="border-0 bg-[var(--app-surface-soft)]">
                <span
                  className={cn(
                    "truncate",
                    !filters.responsavel_id && "text-muted-foreground",
                  )}
                >
                  {responsibleLabel}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_FILTER_VALUE}>Todos</SelectItem>
                {users.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {getUserFilterLabel(user)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div
            data-tour="properties-filter-value"
            className="grid grid-cols-2 gap-2"
          >
            <div>
              <Input
                value={filters.valor_min || ""}
                onChange={(event) =>
                  updateFilter("valor_min", event.target.value)
                }
                inputMode="numeric"
                placeholder="Valor mín."
                className="border-0 bg-[var(--app-surface-soft)]"
              />
            </div>
            <div>
              <Input
                value={filters.valor_max || ""}
                onChange={(event) =>
                  updateFilter("valor_max", event.target.value)
                }
                inputMode="numeric"
                placeholder="Valor máx."
                className="border-0 bg-[var(--app-surface-soft)]"
              />
            </div>
          </div>
        </div>

        <button
          data-tour="properties-filter-more"
          type="button"
          onClick={() => setAdvancedFiltersOpen((open) => !open)}
          className="flex h-10 w-full items-center justify-between rounded-md bg-[var(--app-surface-soft)] px-3 text-sm font-medium transition-colors hover:bg-[var(--app-surface-hover)]"
        >
          Mais filtros
          <ChevronDown
            className={cn(
              "h-4 w-4 transition-transform",
              advancedFiltersOpen && "rotate-180",
            )}
          />
        </button>

        {advancedFiltersOpen && (
          <div data-tour="properties-filter-more-panel" className="space-y-3">
            <div>
              <Select
                value={filters.owner_id || ALL_FILTER_VALUE}
                onValueChange={(value) => updateFilter("owner_id", value)}
              >
                <SelectTrigger className="border-0 bg-[var(--app-surface-soft)]">
                  <span
                    className={cn(
                      "truncate",
                      !filters.owner_id && "text-muted-foreground",
                    )}
                  >
                    {ownerLabel}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_FILTER_VALUE}>Todos</SelectItem>
                  {propertyOwners.map((owner) => (
                    <SelectItem key={owner.id} value={owner.id}>
                      {owner.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Select
                value={filters.condominium_id || ALL_FILTER_VALUE}
                onValueChange={(value) => updateFilter("condominium_id", value)}
              >
                <SelectTrigger className="border-0 bg-[var(--app-surface-soft)]">
                  <span
                    className={cn(
                      "truncate",
                      !filters.condominium_id && "text-muted-foreground",
                    )}
                  >
                    {condominiumLabel}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_FILTER_VALUE}>Todos</SelectItem>
                  {condominiums.map((condominium) => (
                    <SelectItem key={condominium.id} value={condominium.id}>
                      {condominium.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Select
                value={filters.mobilia || ALL_FILTER_VALUE}
                onValueChange={(value) => updateFilter("mobilia", value)}
              >
                <SelectTrigger className="border-0 bg-[var(--app-surface-soft)]">
                  <span
                    className={cn(
                      "truncate",
                      !filters.mobilia && "text-muted-foreground",
                    )}
                  >
                    {furnitureLabel}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_FILTER_VALUE}>Todas</SelectItem>
                  <SelectItem value="Mobiliado">Mobiliado</SelectItem>
                  <SelectItem value="Semi-mobiliado">Semi-mobiliado</SelectItem>
                  <SelectItem value="Sem mobília">Sem mobília</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Select
                  value={filters.quartos_min || ALL_FILTER_VALUE}
                  onValueChange={(value) => updateFilter("quartos_min", value)}
                >
                  <SelectTrigger className="border-0 bg-[var(--app-surface-soft)]">
                    <span
                      className={cn(
                        "truncate",
                        !filters.quartos_min && "text-muted-foreground",
                      )}
                    >
                      {filters.quartos_min
                        ? `${filters.quartos_min}+`
                        : "Quartos"}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_FILTER_VALUE}>Todos</SelectItem>
                    <SelectItem value="1">1+</SelectItem>
                    <SelectItem value="2">2+</SelectItem>
                    <SelectItem value="3">3+</SelectItem>
                    <SelectItem value="4">4+</SelectItem>
                    <SelectItem value="5">5+</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Select
                  value={filters.suites_min || ALL_FILTER_VALUE}
                  onValueChange={(value) => updateFilter("suites_min", value)}
                >
                  <SelectTrigger className="border-0 bg-[var(--app-surface-soft)]">
                    <span
                      className={cn(
                        "truncate",
                        !filters.suites_min && "text-muted-foreground",
                      )}
                    >
                      {filters.suites_min ? `${filters.suites_min}+` : "Suítes"}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_FILTER_VALUE}>Todos</SelectItem>
                    <SelectItem value="1">1+</SelectItem>
                    <SelectItem value="2">2+</SelectItem>
                    <SelectItem value="3">3+</SelectItem>
                    <SelectItem value="4">4+</SelectItem>
                    <SelectItem value="5">5+</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Select
                  value={filters.banheiros_min || ALL_FILTER_VALUE}
                  onValueChange={(value) =>
                    updateFilter("banheiros_min", value)
                  }
                >
                  <SelectTrigger className="border-0 bg-[var(--app-surface-soft)]">
                    <span
                      className={cn(
                        "truncate",
                        !filters.banheiros_min && "text-muted-foreground",
                      )}
                    >
                      {filters.banheiros_min
                        ? `${filters.banheiros_min}+`
                        : "Banheiros"}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_FILTER_VALUE}>Todos</SelectItem>
                    <SelectItem value="1">1+</SelectItem>
                    <SelectItem value="2">2+</SelectItem>
                    <SelectItem value="3">3+</SelectItem>
                    <SelectItem value="4">4+</SelectItem>
                    <SelectItem value="5">5+</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Select
                  value={filters.vagas_min || ALL_FILTER_VALUE}
                  onValueChange={(value) => updateFilter("vagas_min", value)}
                >
                  <SelectTrigger className="border-0 bg-[var(--app-surface-soft)]">
                    <span
                      className={cn(
                        "truncate",
                        !filters.vagas_min && "text-muted-foreground",
                      )}
                    >
                      {filters.vagas_min ? `${filters.vagas_min}+` : "Vagas"}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_FILTER_VALUE}>Todos</SelectItem>
                    <SelectItem value="1">1+</SelectItem>
                    <SelectItem value="2">2+</SelectItem>
                    <SelectItem value="3">3+</SelectItem>
                    <SelectItem value="4">4+</SelectItem>
                    <SelectItem value="5">5+</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Input
                value={filters.area_util_min || ""}
                onChange={(event) =>
                  updateFilter("area_util_min", event.target.value)
                }
                inputMode="numeric"
                placeholder="Área útil mín."
                className="border-0 bg-[var(--app-surface-soft)]"
              />
              <Input
                value={filters.area_util_max || ""}
                onChange={(event) =>
                  updateFilter("area_util_max", event.target.value)
                }
                inputMode="numeric"
                placeholder="Área útil máx."
                className="border-0 bg-[var(--app-surface-soft)]"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Input
                value={filters.area_total_min || ""}
                onChange={(event) =>
                  updateFilter("area_total_min", event.target.value)
                }
                inputMode="numeric"
                placeholder="Área total mín."
                className="border-0 bg-[var(--app-surface-soft)]"
              />
              <Input
                value={filters.area_total_max || ""}
                onChange={(event) =>
                  updateFilter("area_total_max", event.target.value)
                }
                inputMode="numeric"
                placeholder="Área total máx."
                className="border-0 bg-[var(--app-surface-soft)]"
              />
            </div>

            <div>
              <Select
                value={filters.aceita_financiamento || ALL_FILTER_VALUE}
                onValueChange={(value) =>
                  updateFilter("aceita_financiamento", value)
                }
              >
                <SelectTrigger className="border-0 bg-[var(--app-surface-soft)]">
                  <span
                    className={cn(
                      "truncate",
                      !filters.aceita_financiamento && "text-muted-foreground",
                    )}
                  >
                    {financingLabel}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_FILTER_VALUE}>Indiferente</SelectItem>
                  <SelectItem value="true">Aceita</SelectItem>
                  <SelectItem value="false">Não aceita</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Select
                value={filters.aceita_permuta || ALL_FILTER_VALUE}
                onValueChange={(value) => updateFilter("aceita_permuta", value)}
              >
                <SelectTrigger className="border-0 bg-[var(--app-surface-soft)]">
                  <span
                    className={cn(
                      "truncate",
                      !filters.aceita_permuta && "text-muted-foreground",
                    )}
                  >
                    {permutaLabel}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_FILTER_VALUE}>Indiferente</SelectItem>
                  <SelectItem value="true">Aceita</SelectItem>
                  <SelectItem value="false">Não aceita</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Select
                value={filters.exclusividade || ALL_FILTER_VALUE}
                onValueChange={(value) => updateFilter("exclusividade", value)}
              >
                <SelectTrigger className="border-0 bg-[var(--app-surface-soft)]">
                  <span
                    className={cn(
                      "truncate",
                      !filters.exclusividade && "text-muted-foreground",
                    )}
                  >
                    {exclusiveLabel}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_FILTER_VALUE}>Indiferente</SelectItem>
                  <SelectItem value="true">Com exclusividade</SelectItem>
                  <SelectItem value="false">Sem exclusividade</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Select
                value={filters.placa_no_local || ALL_FILTER_VALUE}
                onValueChange={(value) => updateFilter("placa_no_local", value)}
              >
                <SelectTrigger className="border-0 bg-[var(--app-surface-soft)]">
                  <span
                    className={cn(
                      "truncate",
                      !filters.placa_no_local && "text-muted-foreground",
                    )}
                  >
                    {signLabel}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_FILTER_VALUE}>Indiferente</SelectItem>
                  <SelectItem value="true">Com placa</SelectItem>
                  <SelectItem value="false">Sem placa</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Select
                value={filters.destaque || ALL_FILTER_VALUE}
                onValueChange={(value) => updateFilter("destaque", value)}
              >
                <SelectTrigger className="border-0 bg-[var(--app-surface-soft)]">
                  <span
                    className={cn(
                      "truncate",
                      !filters.destaque && "text-muted-foreground",
                    )}
                  >
                    {featuredLabel}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_FILTER_VALUE}>Indiferente</SelectItem>
                  <SelectItem value="true">Em destaque</SelectItem>
                  <SelectItem value="false">Sem destaque</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {isMobile && (
          <Button
            type="button"
            className="h-10 w-full rounded-[6px] bg-primary/50 text-[12px] font-light text-primary-foreground shadow-none hover:bg-primary"
            onClick={() => setFiltersOpen(false)}
          >
            Ver imóveis
          </Button>
        )}
      </div>
    </aside>
  );

  if (isLoading && !data) {
    return (
      <AppLayout title="Imóveis">
        <div className="grid min-h-[360px] place-items-center">
          <VimobLoader size="lg" label="Carregando imóveis..." />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Imóveis">
      <div className="properties-screen animate-in">
        <div className="grid gap-3 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
          <div className="hidden lg:sticky lg:top-0 lg:block lg:self-start">
            {filtersPanel}
          </div>

          <div className="min-w-0 space-y-3">
            <div className="app-card flex flex-col gap-2 p-2 sm:flex-row sm:items-center">
              <div
                data-tour="properties-filter-search"
                className="relative min-w-0 flex-1 sm:max-w-[420px] lg:hidden"
              >
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--app-text-tertiary)]" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar endereço, nome, bairro ou código"
                  className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] py-0 pl-9 pr-9 text-[12px] font-light shadow-none focus-visible:ring-1 focus-visible:ring-primary/30 focus-visible:ring-offset-0"
                />
                {isFilterUpdating && (
                  <Loader2 className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-primary" />
                )}
              </div>

              <div className="flex min-w-0 flex-1 items-center justify-between gap-2 sm:justify-end">
                <span className="min-w-0 truncate text-[12px] font-light text-[var(--app-text-secondary)] sm:mr-auto sm:pl-1">
                  {isFilterUpdating
                    ? "Atualizando carteira..."
                    : `${totalCount.toLocaleString("pt-BR")} imóveis`}
                </span>
                <Button
                  data-tour="properties-filter-button"
                  type="button"
                  variant="ghost"
                  onClick={() => setFiltersOpen(true)}
                  className="h-9 shrink-0 gap-1.5 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2.5 text-[12px] font-light text-[var(--app-text-primary)] shadow-none hover:bg-[var(--app-surface-hover)] lg:hidden"
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
                    className="h-9 shrink-0 rounded-[6px] bg-primary/50 px-3 text-[12px] font-light text-primary-foreground shadow-none hover:bg-primary"
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
              {isListUpdating && (
                <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[8px] bg-background/55">
                  <VimobLoader size="lg" label="Atualizando imóveis..." />
                </div>
              )}

              {error && (
                <div className="app-card-soft flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] bg-primary/50 text-primary-foreground">
                      <AlertTriangle className="h-4 w-4" />
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
                    <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-[6px] bg-primary/50 text-primary-foreground">
                      <Building2 className="h-5 w-5" />
                    </div>
                    <h3 className="mb-1 text-[14px] font-normal">
                      {activeFilterCount > 0
                        ? "Nenhum imóvel encontrado"
                        : "Nenhum imóvel cadastrado"}
                    </h3>
                    <p className="mb-4 text-[12px] font-light text-[var(--app-text-secondary)]">
                      {activeFilterCount > 0
                        ? "Ajuste os filtros para ampliar a busca."
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
                        className="h-9 rounded-[6px] bg-primary/50 text-[12px] font-light text-primary-foreground shadow-none hover:bg-primary"
                      >
                        <Plus className="mr-1.5 h-3.5 w-3.5" />
                        Cadastrar imóvel
                      </Button>
                    ) : null}
                  </CardContent>
                </Card>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {properties.map((property) => {
                  const propertyWithOwner = property as PropertyWithCreator;
                  const ownerIds = [
                    propertyWithOwner.cadastrado_por,
                    propertyWithOwner.created_by,
                    propertyWithOwner.responsible_user_id,
                  ].filter(Boolean);
                  const canEditProperty = canEditPropertyDetails({
                    ...propertyAccessContext,
                    ownerIds,
                  });

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
                    className="h-9 min-w-[200px] rounded-[6px] bg-primary/50 text-[12px] font-light text-primary-foreground shadow-none hover:bg-primary"
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
            {filtersPanel}
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
