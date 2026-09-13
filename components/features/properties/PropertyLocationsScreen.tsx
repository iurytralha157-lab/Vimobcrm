"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/shared/layout/AppLayout";
import { PropertySectionTabs } from "@/components/features/properties/PropertySectionTabs";
import { Tabs } from "@/components/ui/tabs";
import { propertiesAPI } from "@/lib/api/properties";
import { canViewPropertyOwnerContacts } from "@/lib/access/properties";
import { searchTextIncludes } from "@/lib/search-text";
import { useAuth } from "@/contexts/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  usePropertyCities,
  useCreateCity,
  useUpdateCity,
  useDeleteCity,
  usePropertyNeighborhoods,
  useCreateNeighborhood,
  useUpdateNeighborhood,
  useDeleteNeighborhood,
  usePropertyCondominiums,
  useCreateCondominium,
  useUpdateCondominium,
  useDeleteCondominium,
  type PropertyCity,
  type PropertyCondominium,
  type PropertyNeighborhood,
} from "@/hooks/use-property-locations";
import {
  PROPERTY_OWNER_PAGE_SIZE,
  useCreatePropertyOwner,
  useDeactivatePropertyOwner,
  usePropertyOwnersPage,
  useUpdatePropertyOwner,
  type PropertyOwner,
} from "@/hooks/use-property-owners";
import { useInfiniteProperties } from "@/hooks/use-properties";
import {
  propertyCityInputSchema,
  propertyCityUpdateInputSchema,
  propertyCondominiumInputSchema,
  propertyCondominiumUpdateInputSchema,
  propertyNeighborhoodInputSchema,
  propertyNeighborhoodUpdateInputSchema,
} from "@/lib/validation";
import { toast } from "sonner";

import { AssignmentDialog } from "./property-locations/AssignmentDialog";
import { DeletionDialog } from "./property-locations/DeletionDialog";
import {
  CitiesPanel,
  CondominiumsPanel,
  NeighborhoodsPanel,
} from "./property-locations/LocationPanels";
import { LocationsNavigation } from "./property-locations/LocationsNavigation";
import { OwnerFormDialog } from "./property-locations/OwnerFormDialog";
import { OwnersPanel } from "./property-locations/OwnersPanel";
import {
  EMPTY_CITY_FORM,
  EMPTY_CONDOMINIUM_FORM,
  EMPTY_NEIGHBORHOOD_FORM,
  EMPTY_OWNER_FORM,
  buildCondominiumPayload,
  buildCondominiumUpdatePayload,
  catalogLocationsOnly,
  cityFormFromCity,
  condominiumFormFromCondominium,
  createCityAssignment,
  createNeighborhoodAssignment,
  createOwnerAssignment,
  neighborhoodFormFromNeighborhood,
  ownerFormFromOwner,
  parseCurrencyInput,
  propertyAssignmentInvalidationKeys,
  propertyLocationsHref,
  summarizePropertyAssignmentResults,
  type AssignmentTarget,
  type CityFormState,
  type CondominiumFormState,
  type LocationDeletionTarget,
  type NeighborhoodFormState,
  type OwnerFormState,
  type PropertyLocationsProps,
  type PropertyLocationsTab,
} from "./property-locations/model";

export default function PropertyLocations({
  initialTab = "cities",
}: PropertyLocationsProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const {
    activeOrganization,
    organization,
    profile,
    tenantContext,
    isSuperAdmin,
  } = useAuth();
  const organizationId = activeOrganization.organizationId || undefined;
  const canSeeOwnerContact = canViewPropertyOwnerContacts({
    userId: profile?.id,
    organizationId,
    isSuperAdmin,
    memberRole: tenantContext?.memberRole,
    permissions: tenantContext?.permissions,
    propertyOwnerContactVisibility:
      organization?.property_owner_contact_visibility,
  });

  const tab: PropertyLocationsTab = initialTab;
  const [search, setSearch] = useState("");
  const [debouncedOwnerSearch, setDebouncedOwnerSearch] = useState("");
  const [legacyOwnerPagination, setLegacyOwnerPagination] = useState({
    key: "",
    count: PROPERTY_OWNER_PAGE_SIZE,
  });
  const [selectedCityId, setSelectedCityId] = useState<string>("");
  const [selectedNeighborhoodId, setSelectedNeighborhoodId] =
    useState<string>("");
  const [propertySearch, setPropertySearch] = useState("");
  const [debouncedPropertySearch, setDebouncedPropertySearch] = useState("");

  const [cityDialog, setCityDialog] = useState(false);
  const [neighborhoodDialog, setNeighborhoodDialog] = useState(false);
  const [condominiumDialog, setCondominiumDialog] = useState(false);
  const [editingCity, setEditingCity] = useState<PropertyCity | null>(null);
  const [editingNeighborhood, setEditingNeighborhood] =
    useState<PropertyNeighborhood | null>(null);
  const [editingCondominium, setEditingCondominium] =
    useState<PropertyCondominium | null>(null);
  const [ownerDialog, setOwnerDialog] = useState(false);
  const [editingOwner, setEditingOwner] = useState<PropertyOwner | null>(null);
  const [ownerForm, setOwnerForm] = useState<OwnerFormState>(EMPTY_OWNER_FORM);
  const [expandedOwnerId, setExpandedOwnerId] = useState<string | null>(null);

  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [assignmentTarget, setAssignmentTarget] =
    useState<AssignmentTarget | null>(null);
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<string[]>([]);
  const [assigningProperties, setAssigningProperties] = useState(false);
  const [deletionTarget, setDeletionTarget] =
    useState<LocationDeletionTarget | null>(null);

  const [cityForm, setCityForm] =
    useState<CityFormState>(EMPTY_CITY_FORM);
  const [neighborhoodForm, setNeighborhoodForm] =
    useState<NeighborhoodFormState>(EMPTY_NEIGHBORHOOD_FORM);
  const [condominiumForm, setCondominiumForm] = useState<CondominiumFormState>(
    EMPTY_CONDOMINIUM_FORM,
  );

  const citiesQuery = usePropertyCities({
    enabled:
      tab !== "owners" || cityDialog || neighborhoodDialog || condominiumDialog,
  });
  const neighborhoodsQuery = usePropertyNeighborhoods(
    selectedCityId || undefined,
    {
      enabled:
        tab === "neighborhoods" ||
        tab === "condominiums" ||
        neighborhoodDialog ||
        condominiumDialog,
    },
  );
  const condominiumsQuery = usePropertyCondominiums(
    selectedNeighborhoodId || undefined,
    {
      enabled: tab === "condominiums" || condominiumDialog,
    },
  );
  const { data: cities = [], isLoading: loadingCities } = citiesQuery;
  const { data: neighborhoods = [], isLoading: loadingNeighborhoods } =
    neighborhoodsQuery;
  const { data: condominiums = [], isLoading: loadingCondominiums } =
    condominiumsQuery;
  const ownersQuery = usePropertyOwnersPage(debouncedOwnerSearch, {
    enabled: tab === "owners",
  });
  const propertiesQuery = useInfiniteProperties(
    debouncedPropertySearch,
    50,
    {},
    { enabled: assignmentOpen },
  );
  const properties =
    propertiesQuery.data?.pages.flatMap((page) => page.properties) ?? [];
  const loadingProperties =
    propertiesQuery.isLoading || propertiesQuery.isPlaceholderData;
  const propertyTotalCount =
    propertiesQuery.data?.pages[0]?.totalCount ?? properties.length;

  const createCity = useCreateCity();
  const updateCity = useUpdateCity();
  const deleteCity = useDeleteCity();
  const createNeighborhood = useCreateNeighborhood();
  const updateNeighborhood = useUpdateNeighborhood();
  const deleteNeighborhood = useDeleteNeighborhood();
  const createCondominium = useCreateCondominium();
  const updateCondominium = useUpdateCondominium();
  const deleteCondominium = useDeleteCondominium();
  const createOwner = useCreatePropertyOwner();
  const updateOwner = useUpdatePropertyOwner();
  const deactivateOwner = useDeactivatePropertyOwner();
  const deletionPending =
    deleteCity.isPending ||
    deleteNeighborhood.isPending ||
    deleteCondominium.isPending ||
    deactivateOwner.isPending;
  const citySavePending = createCity.isPending || updateCity.isPending;
  const neighborhoodSavePending =
    createNeighborhood.isPending || updateNeighborhood.isPending;
  const condominiumSavePending =
    createCondominium.isPending || updateCondominium.isPending;
  const catalogCities = useMemo(() => catalogLocationsOnly(cities), [cities]);
  const catalogNeighborhoods = useMemo(
    () => catalogLocationsOnly(neighborhoods),
    [neighborhoods],
  );

  const filteredCities = useMemo(
    () => cities.filter((city) => searchTextIncludes(city.name, search)),
    [cities, search],
  );
  const filteredNeighborhoods = useMemo(
    () =>
      neighborhoods.filter((neighborhood) =>
        searchTextIncludes(neighborhood.name, search),
      ),
    [neighborhoods, search],
  );
  const filteredCondominiums = useMemo(
    () =>
      condominiums.filter((condominium) =>
        searchTextIncludes(condominium.name, search),
      ),
    [condominiums, search],
  );

  useEffect(() => {
    const timeout = window.setTimeout(
      () => setDebouncedOwnerSearch(search.trim()),
      250,
    );
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    const timeout = window.setTimeout(
      () => setDebouncedPropertySearch(propertySearch.trim()),
      250,
    );
    return () => window.clearTimeout(timeout);
  }, [propertySearch]);

  const ownerPages = ownersQuery.data?.pages;
  const legacyOwners = ownerPages?.[0]?.legacyOwners;
  const serverOwners = ownerPages?.flatMap((page) => page.owners) ?? [];
  const legacyOwnerPageKey = `${organizationId || ""}:${debouncedOwnerSearch}`;
  const legacyOwnerVisibleCount =
    legacyOwnerPagination.key === legacyOwnerPageKey
      ? legacyOwnerPagination.count
      : PROPERTY_OWNER_PAGE_SIZE;
  const filteredLegacyOwners = useMemo(() => {
    return (legacyOwners ?? []).filter((owner) =>
      [
        owner.name,
        canSeeOwnerContact ? owner.cellphone : null,
        canSeeOwnerContact ? owner.phone_residential : null,
        canSeeOwnerContact ? owner.phone_commercial : null,
        owner.email,
        owner.media_source,
      ].some((value) => searchTextIncludes(value, debouncedOwnerSearch)),
    );
  }, [legacyOwners, debouncedOwnerSearch, canSeeOwnerContact]);
  const filteredOwners = legacyOwners
    ? filteredLegacyOwners.slice(0, legacyOwnerVisibleCount)
    : serverOwners;
  const ownerTotalCount = legacyOwners
    ? filteredLegacyOwners.length
    : (ownerPages?.[0]?.totalCount ?? serverOwners.length);
  const loadingOwners = ownersQuery.isLoading;
  const hasMoreOwners = legacyOwners
    ? filteredOwners.length < filteredLegacyOwners.length
    : ownersQuery.hasNextPage;

  const pageTitle = useMemo(() => {
    if (tab === "condominiums") return "Condomínios";
    if (tab === "owners") return "Proprietários";
    return "Localidades";
  }, [tab]);
  const activePropertySection =
    tab === "condominiums"
      ? "condominiums"
      : tab === "owners"
        ? "owners"
        : "locations";

  const handleTabChange = (value: string) => {
    router.push(
      propertyLocationsHref(
        value as PropertyLocationsTab,
        window.location.search,
      ),
    );
  };

  const handleCityDialogOpenChange = (open: boolean) => {
    if (!open) {
      setEditingCity(null);
      setCityForm(EMPTY_CITY_FORM);
    } else if (!editingCity) {
      setCityForm(EMPTY_CITY_FORM);
    }
    setCityDialog(open);
  };

  const openCityDialog = (city: PropertyCity) => {
    setEditingCity(city);
    setCityForm(cityFormFromCity(city));
    setCityDialog(true);
  };

  const handleSaveCity = async () => {
    if (!cityForm.name.trim()) {
      toast.error("Nome da cidade é obrigatório");
      return;
    }
    try {
      if (editingCity) {
        const parsedInput = propertyCityUpdateInputSchema.safeParse({
          name: cityForm.name,
          uf: cityForm.uf || null,
          expected_updated_at: editingCity.updated_at,
        });
        if (!parsedInput.success) {
          toast.error(
            `Revise os dados da cidade: ${parsedInput.error.issues[0]?.message || "dados inválidos"}`,
          );
          return;
        }
        await updateCity.mutateAsync({
          id: editingCity.id,
          data: parsedInput.data,
        });
      } else {
        const parsedInput = propertyCityInputSchema.safeParse({
          name: cityForm.name,
          uf: cityForm.uf || undefined,
        });
        if (!parsedInput.success) {
          toast.error(
            `Revise os dados da cidade: ${parsedInput.error.issues[0]?.message || "dados inválidos"}`,
          );
          return;
        }
        await createCity.mutateAsync(parsedInput.data);
      }
      handleCityDialogOpenChange(false);
    } catch {
      // The mutation hook keeps the dialog open and reports the domain error.
    }
  };

  const handleNeighborhoodDialogOpenChange = (open: boolean) => {
    if (!open) {
      setEditingNeighborhood(null);
      setNeighborhoodForm(EMPTY_NEIGHBORHOOD_FORM);
    } else if (!editingNeighborhood) {
      setNeighborhoodForm(EMPTY_NEIGHBORHOOD_FORM);
    }
    setNeighborhoodDialog(open);
  };

  const openNeighborhoodDialog = (neighborhood: PropertyNeighborhood) => {
    setEditingNeighborhood(neighborhood);
    setNeighborhoodForm(neighborhoodFormFromNeighborhood(neighborhood));
    setNeighborhoodDialog(true);
  };

  const handleSaveNeighborhood = async () => {
    if (!neighborhoodForm.name.trim() || !neighborhoodForm.city_id) {
      toast.error("Nome e cidade são obrigatórios");
      return;
    }
    try {
      if (editingNeighborhood) {
        const parsedInput =
          propertyNeighborhoodUpdateInputSchema.safeParse({
            ...neighborhoodForm,
            expected_updated_at: editingNeighborhood.updated_at,
          });
        if (!parsedInput.success) {
          toast.error(
            `Revise os dados do bairro: ${parsedInput.error.issues[0]?.message || "dados inválidos"}`,
          );
          return;
        }
        await updateNeighborhood.mutateAsync({
          id: editingNeighborhood.id,
          data: parsedInput.data,
        });
      } else {
        const parsedInput =
          propertyNeighborhoodInputSchema.safeParse(neighborhoodForm);
        if (!parsedInput.success) {
          toast.error(
            `Revise os dados do bairro: ${parsedInput.error.issues[0]?.message || "dados inválidos"}`,
          );
          return;
        }
        await createNeighborhood.mutateAsync(parsedInput.data);
      }
      handleNeighborhoodDialogOpenChange(false);
    } catch {
      // The mutation hook keeps the dialog open and reports the domain error.
    }
  };

  const handleCondominiumDialogOpenChange = (open: boolean) => {
    if (!open) {
      setEditingCondominium(null);
      setCondominiumForm(EMPTY_CONDOMINIUM_FORM);
    } else if (!editingCondominium) {
      setCondominiumForm(EMPTY_CONDOMINIUM_FORM);
    }
    setCondominiumDialog(open);
  };

  const openCondominiumDialog = (condominium: PropertyCondominium) => {
    const nextForm = condominiumFormFromCondominium(condominium);
    setEditingCondominium(condominium);
    setCondominiumForm(nextForm);
    setSelectedCityId(nextForm.city_id);
    setCondominiumDialog(true);
  };

  const handleSaveCondominium = async () => {
    if (!condominiumForm.name.trim()) {
      toast.error("Nome do condomínio é obrigatório");
      return;
    }
    const condominiumFee = parseCurrencyInput(
      condominiumForm.default_condominium_fee,
    );
    if (
      condominiumForm.default_condominium_fee.trim() &&
      condominiumFee === undefined
    ) {
      toast.error("Informe uma taxa de condomínio válida");
      return;
    }
    try {
      if (editingCondominium) {
        const parsedInput = propertyCondominiumUpdateInputSchema.safeParse(
          {
            ...buildCondominiumUpdatePayload(condominiumForm, condominiumFee),
            expected_updated_at: editingCondominium.updated_at,
          },
        );
        if (!parsedInput.success) {
          toast.error(
            `Revise os dados do condomínio: ${parsedInput.error.issues[0]?.message || "dados inválidos"}`,
          );
          return;
        }
        await updateCondominium.mutateAsync({
          id: editingCondominium.id,
          data: parsedInput.data,
        });
      } else {
        const parsedInput = propertyCondominiumInputSchema.safeParse(
          buildCondominiumPayload(condominiumForm, condominiumFee),
        );
        if (!parsedInput.success) {
          toast.error(
            `Revise os dados do condomínio: ${parsedInput.error.issues[0]?.message || "dados inválidos"}`,
          );
          return;
        }
        await createCondominium.mutateAsync(parsedInput.data);
      }
      handleCondominiumDialogOpenChange(false);
    } catch {
      // The mutation hook keeps the dialog open and reports the domain error.
    }
  };

  const handleDeleteLocation = async () => {
    if (!deletionTarget) return;
    try {
      if (deletionTarget.type === "city") {
        await deleteCity.mutateAsync(deletionTarget);
      } else if (deletionTarget.type === "neighborhood") {
        await deleteNeighborhood.mutateAsync(deletionTarget);
      } else if (deletionTarget.type === "condominium") {
        await deleteCondominium.mutateAsync(deletionTarget);
      } else {
        await deactivateOwner.mutateAsync({
          id: deletionTarget.id,
          expected_updated_at: deletionTarget.expected_updated_at,
        });
      }
      setDeletionTarget(null);
    } catch {
      // The mutation hook reports the domain error and refreshes the catalog.
      // Close the confirmation so a retry can only use the refreshed row.
      setDeletionTarget(null);
    }
  };

  const openOwnerDialog = (owner?: PropertyOwner) => {
    setEditingOwner(owner || null);
    setOwnerForm(ownerFormFromOwner(owner));
    setOwnerDialog(true);
  };

  const handleSaveOwner = async () => {
    if (!ownerForm.name.trim()) {
      toast.error("Nome do proprietário é obrigatório");
      return;
    }

    try {
      if (editingOwner) {
        await updateOwner.mutateAsync({
          id: editingOwner.id,
          ...ownerForm,
          expected_updated_at: editingOwner.updated_at,
        });
      } else {
        await createOwner.mutateAsync(ownerForm);
      }
      setOwnerDialog(false);
      setEditingOwner(null);
      setOwnerForm(EMPTY_OWNER_FORM);
    } catch {
      // The mutation hook keeps the dialog open and reports the domain error.
    }
  };

  const openAssignmentDialog = (target: AssignmentTarget) => {
    setAssignmentTarget(target);
    setPropertySearch("");
    setDebouncedPropertySearch("");
    setSelectedPropertyIds([]);
    setAssignmentOpen(true);
  };

  const handleLoadMoreOwners = () => {
    if (legacyOwners) {
      setLegacyOwnerPagination((current) => ({
        key: legacyOwnerPageKey,
        count:
          current.key === legacyOwnerPageKey
            ? current.count + PROPERTY_OWNER_PAGE_SIZE
            : PROPERTY_OWNER_PAGE_SIZE * 2,
      }));
      return;
    }
    void ownersQuery.fetchNextPage();
  };

  const togglePropertySelection = (propertyId: string) => {
    setSelectedPropertyIds((current) =>
      current.includes(propertyId)
        ? current.filter((id) => id !== propertyId)
        : [...current, propertyId],
    );
  };

  const handleAssignProperties = async () => {
    if (!assignmentTarget || !organizationId) return;
    if (selectedPropertyIds.length === 0) {
      toast.error("Selecione pelo menos um imóvel");
      return;
    }

    setAssigningProperties(true);
    try {
      const assignmentResults: PromiseSettledResult<unknown>[] = [];
      for (const propertyId of selectedPropertyIds) {
        try {
          const expectedUpdatedAt = properties.find(
            (property) => property.id === propertyId,
          )?.updated_at;
          if (!expectedUpdatedAt) {
            throw new Error("A versão atual do imóvel não está disponível");
          }
          await propertiesAPI.updateProperty(
            propertyId,
            {
              ...assignmentTarget.payload,
              expected_updated_at: expectedUpdatedAt,
            },
            organizationId,
          );
          assignmentResults.push({ status: "fulfilled", value: undefined });
        } catch (reason) {
          assignmentResults.push({ status: "rejected", reason });
        }
      }
      const { succeededIds, failedIds } = summarizePropertyAssignmentResults(
        selectedPropertyIds,
        assignmentResults,
      );

      if (succeededIds.length > 0) {
        await Promise.all(
          propertyAssignmentInvalidationKeys(organizationId, succeededIds).map(
            (queryKey) => queryClient.invalidateQueries({ queryKey }),
          ),
        );
      }

      if (failedIds.length === 0) {
        toast.success(
          `${succeededIds.length} ${succeededIds.length === 1 ? "imóvel vinculado" : "imóveis vinculados"} com sucesso!`,
        );
        setAssignmentOpen(false);
        setSelectedPropertyIds([]);
      } else if (succeededIds.length > 0) {
        setSelectedPropertyIds(failedIds);
        toast.warning(
          `${succeededIds.length} ${succeededIds.length === 1 ? "imóvel foi vinculado" : "imóveis foram vinculados"}, mas ${failedIds.length} ${failedIds.length === 1 ? "falhou e continua selecionado" : "falharam e continuam selecionados"} para nova tentativa.`,
        );
      } else {
        toast.error(
          `Nenhum imóvel foi vinculado. ${failedIds.length === 1 ? "O item continua selecionado" : "Os itens continuam selecionados"} para nova tentativa.`,
        );
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível atualizar a carteira após os vínculos",
      );
    } finally {
      setAssigningProperties(false);
    }
  };

  return (
    <AppLayout title={pageTitle}>
      <div className="space-y-3 animate-in">
        <PropertySectionTabs activeSection={activePropertySection} />

        <Tabs value={tab} onValueChange={handleTabChange}>
          <LocationsNavigation
            search={search}
            onSearchChange={setSearch}
            citiesCount={cities.length}
            neighborhoodsCount={neighborhoods.length}
            condominiumsCount={condominiums.length}
            ownersCount={ownerTotalCount}
            loadingCities={loadingCities}
            loadingNeighborhoods={loadingNeighborhoods}
            loadingCondominiums={loadingCondominiums}
            loadingOwners={loadingOwners}
          />

          <CitiesPanel
            cities={filteredCities}
            sourceCount={cities.length}
            query={{
              loading: loadingCities,
              isError: citiesQuery.isError,
              isFetching: citiesQuery.isFetching,
              onRetry: () => void citiesQuery.refetch(),
            }}
            dialogOpen={cityDialog}
            onDialogOpenChange={handleCityDialogOpenChange}
            editing={!!editingCity}
            savePending={citySavePending}
            form={cityForm}
            setForm={setCityForm}
            onSave={() => void handleSaveCity()}
            onAssign={(city) =>
              openAssignmentDialog(createCityAssignment(city))
            }
            onEdit={openCityDialog}
            onDelete={setDeletionTarget}
          />
          <NeighborhoodsPanel
            neighborhoods={filteredNeighborhoods}
            sourceCount={neighborhoods.length}
            catalogCities={catalogCities}
            selectedCityId={selectedCityId}
            onSelectedCityChange={setSelectedCityId}
            query={{
              loading: loadingNeighborhoods,
              isError: neighborhoodsQuery.isError,
              isFetching: neighborhoodsQuery.isFetching,
              onRetry: () => void neighborhoodsQuery.refetch(),
            }}
            dialogOpen={neighborhoodDialog}
            onDialogOpenChange={handleNeighborhoodDialogOpenChange}
            editing={!!editingNeighborhood}
            savePending={neighborhoodSavePending}
            form={neighborhoodForm}
            setForm={setNeighborhoodForm}
            onSave={() => void handleSaveNeighborhood()}
            onAssign={(neighborhood) =>
              openAssignmentDialog(createNeighborhoodAssignment(neighborhood))
            }
            onEdit={openNeighborhoodDialog}
            onDelete={setDeletionTarget}
          />
          <CondominiumsPanel
            condominiums={filteredCondominiums}
            sourceCount={condominiums.length}
            catalogCities={catalogCities}
            catalogNeighborhoods={catalogNeighborhoods}
            selectedNeighborhoodId={selectedNeighborhoodId}
            onSelectedNeighborhoodChange={setSelectedNeighborhoodId}
            onSelectedCityChange={setSelectedCityId}
            query={{
              loading: loadingCondominiums,
              isError: condominiumsQuery.isError,
              isFetching: condominiumsQuery.isFetching,
              onRetry: () => void condominiumsQuery.refetch(),
            }}
            dialogOpen={condominiumDialog}
            onDialogOpenChange={handleCondominiumDialogOpenChange}
            editing={!!editingCondominium}
            savePending={condominiumSavePending}
            form={condominiumForm}
            setForm={setCondominiumForm}
            onSave={() => void handleSaveCondominium()}
            onEdit={openCondominiumDialog}
            onDelete={setDeletionTarget}
          />
          <OwnersPanel
            owners={filteredOwners}
            loading={loadingOwners}
            isError={ownersQuery.isError}
            isFetching={ownersQuery.isFetching}
            onRetry={() => void ownersQuery.refetch()}
            ownerTotalCount={ownerTotalCount}
            debouncedSearch={debouncedOwnerSearch}
            isMobile={isMobile}
            canSeeOwnerContact={canSeeOwnerContact}
            expandedOwnerId={expandedOwnerId}
            onExpandedOwnerChange={setExpandedOwnerId}
            onAssign={(owner) =>
              openAssignmentDialog(createOwnerAssignment(owner))
            }
            onEdit={openOwnerDialog}
            onDeactivate={(owner) =>
              setDeletionTarget({
                type: "owner",
                id: owner.id,
                name: owner.name,
                expected_updated_at: owner.updated_at,
              })
            }
            hasMore={hasMoreOwners}
            isFetchNextPageError={ownersQuery.isFetchNextPageError}
            isFetchingNextPage={ownersQuery.isFetchingNextPage}
            onLoadMore={handleLoadMoreOwners}
            onCreate={() => openOwnerDialog()}
          />
        </Tabs>

        <OwnerFormDialog
          open={ownerDialog}
          onOpenChange={setOwnerDialog}
          editing={Boolean(editingOwner)}
          form={ownerForm}
          setForm={setOwnerForm}
          pending={createOwner.isPending || updateOwner.isPending}
          onSave={() => void handleSaveOwner()}
        />
        <AssignmentDialog
          open={assignmentOpen}
          onOpenChange={setAssignmentOpen}
          target={assignmentTarget}
          search={propertySearch}
          onSearchChange={setPropertySearch}
          properties={properties}
          selectedPropertyIds={selectedPropertyIds}
          onToggleProperty={togglePropertySelection}
          loading={loadingProperties}
          isError={propertiesQuery.isError}
          isFetching={propertiesQuery.isFetching}
          onRetry={() => void propertiesQuery.refetch()}
          hasNextPage={propertiesQuery.hasNextPage}
          isFetchNextPageError={propertiesQuery.isFetchNextPageError}
          isFetchingNextPage={propertiesQuery.isFetchingNextPage}
          onFetchNextPage={() => void propertiesQuery.fetchNextPage()}
          propertyTotalCount={propertyTotalCount}
          assigning={assigningProperties}
          onAssign={() => void handleAssignProperties()}
        />
        <DeletionDialog
          target={deletionTarget}
          pending={deletionPending}
          onOpenChange={() => setDeletionTarget(null)}
          onConfirm={() => void handleDeleteLocation()}
        />
      </div>
    </AppLayout>
  );
}
