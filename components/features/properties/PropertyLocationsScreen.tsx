"use client";

import { Fragment, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/shared/layout/AppLayout';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { searchTextIncludes } from '@/lib/search-text';
import { propertiesAPI } from '@/lib/api/properties';
import { useAuth } from '@/contexts/AuthContext';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  usePropertyCities,
  useCreateCity,
  useDeleteCity,
  usePropertyNeighborhoods,
  useCreateNeighborhood,
  useDeleteNeighborhood,
  usePropertyCondominiums,
  useCreateCondominium,
  useDeleteCondominium,
  type PropertyCity,
  type PropertyNeighborhood,
} from '@/hooks/use-property-locations';
import {
  PROPERTY_OWNER_PAGE_SIZE,
  useCreatePropertyOwner,
  usePropertyOwnersPage,
  useUpdatePropertyOwner,
  type PropertyOwner,
} from '@/hooks/use-property-owners';
import { useInfiniteProperties } from '@/hooks/use-properties';
import {
  AlertTriangle,
  Building2,
  Check,
  Edit2,
  Link2,
  Loader2,
  Mail,
  Map,
  MapPinned,
  Phone,
  Plus,
  Search,
  Trash2,
  UserRound,
} from 'lucide-react';
import { toast } from 'sonner';

type PropertyLocationsProps = {
  initialTab?: 'cities' | 'neighborhoods' | 'condominiums' | 'owners';
};

type PropertyLocationsTab = NonNullable<PropertyLocationsProps['initialTab']>;

type OwnerFormState = {
  name: string;
  phone_residential: string;
  phone_commercial: string;
  cellphone: string;
  email: string;
  media_source: string;
  notify_email: boolean;
  notes: string;
};

type AssignmentTarget = {
  type: PropertyLocationsTab;
  id: string;
  title: string;
  subtitle?: string;
  payload: Parameters<typeof propertiesAPI.updateProperty>[1];
};

type LocationDeletionTarget = {
  type: 'city' | 'neighborhood' | 'condominium';
  id: string;
  name: string;
};

const EMPTY_OWNER_FORM: OwnerFormState = {
  name: '',
  phone_residential: '',
  phone_commercial: '',
  cellphone: '',
  email: '',
  media_source: '',
  notify_email: false,
  notes: '',
};

const UF_OPTIONS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS',
  'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC',
  'SP', 'SE', 'TO',
];

function parseCurrencyInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const normalized = trimmed.includes(',')
    ? trimmed.replace(/\./g, '').replace(',', '.')
    : trimmed;
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 ? amount : undefined;
}

function getOwnerContact(owner: PropertyOwner) {
  return owner.cellphone || owner.phone_residential || owner.phone_commercial || '';
}

function getOwnerPropertyCount(owner: PropertyOwner) {
  return owner.property_count ?? owner.properties?.length ?? 0;
}

function CounterBadge({
  count,
  loading = false,
}: {
  count: number;
  loading?: boolean;
}) {
  return (
    <span
      data-responsive-tab-badge
      className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-[6px] bg-primary px-1.5 text-[11px] font-medium text-primary-foreground"
    >
      {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : count}
    </span>
  );
}

function OwnerContactDetails({
  owner,
  visible,
}: {
  owner: PropertyOwner;
  visible: boolean;
}) {
  if (!visible) {
    return (
      <span className="text-sm text-muted-foreground">
        Contato oculto pela organização
      </span>
    );
  }

  const contact = getOwnerContact(owner);
  return (
    <div className="min-w-0 space-y-1 text-sm">
      {contact ? (
        <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
          <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="break-all">{contact}</span>
        </div>
      ) : null}
      {owner.email ? (
        <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
          <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="break-all">{owner.email}</span>
        </div>
      ) : null}
      {!contact && !owner.email ? (
        <span className="text-muted-foreground">Sem contato informado</span>
      ) : null}
    </div>
  );
}

function OwnerPropertyPreview({ owner }: { owner: PropertyOwner }) {
  const ownerProperties = owner.properties ?? [];
  if (ownerProperties.length === 0) {
    return (
      <span className="text-sm text-muted-foreground">
        Nenhum imóvel vinculado
      </span>
    );
  }

  return (
    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
      {ownerProperties.map((property) => (
        <div
          key={property.id}
          className="rounded-[6px] bg-card px-3 py-2"
        >
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{property.code || "Sem código"}</span>
            {property.tipo_de_negocio ? (
              <span className="rounded-[6px] bg-muted px-2 py-0.5 text-xs">
                {property.tipo_de_negocio}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {property.title || "Imóvel sem título"}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {[property.bairro, property.cidade].filter(Boolean).join(" - ") ||
              "Localização não informada"}
          </p>
        </div>
      ))}
    </div>
  );
}

export default function PropertyLocations({ initialTab = 'cities' }: PropertyLocationsProps) {
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const { profile, organization, isSuperAdmin, userOrganizations } = useAuth();
  const organizationId = organization?.id || profile?.organization_id || undefined;
  const activeMemberRole = userOrganizations.find((org) => org.organization_id === organizationId)?.member_role;
  const canSeeOwnerContact =
    organization?.property_owner_contact_visibility !== 'hidden' ||
    isSuperAdmin ||
    ['owner', 'admin', 'manager'].includes(activeMemberRole || '');

  const [tab, setTab] = useState<PropertyLocationsTab>(initialTab);
  const [search, setSearch] = useState('');
  const [debouncedOwnerSearch, setDebouncedOwnerSearch] = useState('');
  const [legacyOwnerPagination, setLegacyOwnerPagination] = useState({
    key: '',
    count: PROPERTY_OWNER_PAGE_SIZE,
  });
  const [selectedCityId, setSelectedCityId] = useState<string>('');
  const [selectedNeighborhoodId, setSelectedNeighborhoodId] = useState<string>('');
  const [propertySearch, setPropertySearch] = useState('');
  const [debouncedPropertySearch, setDebouncedPropertySearch] = useState('');

  const [cityDialog, setCityDialog] = useState(false);
  const [neighborhoodDialog, setNeighborhoodDialog] = useState(false);
  const [condominiumDialog, setCondominiumDialog] = useState(false);
  const [ownerDialog, setOwnerDialog] = useState(false);
  const [editingOwner, setEditingOwner] = useState<PropertyOwner | null>(null);
  const [ownerForm, setOwnerForm] = useState<OwnerFormState>(EMPTY_OWNER_FORM);
  const [expandedOwnerId, setExpandedOwnerId] = useState<string | null>(null);

  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [assignmentTarget, setAssignmentTarget] = useState<AssignmentTarget | null>(null);
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<string[]>([]);
  const [assigningProperties, setAssigningProperties] = useState(false);
  const [deletionTarget, setDeletionTarget] = useState<LocationDeletionTarget | null>(null);

  const [cityForm, setCityForm] = useState({ name: '', uf: '' });
  const [neighborhoodForm, setNeighborhoodForm] = useState({ name: '', city_id: '' });
  const [condominiumForm, setCondominiumForm] = useState({
    name: '',
    city_id: '',
    neighborhood_id: '',
    address: '',
    photo_url: '',
    cep: '',
    number: '',
    complement: '',
    default_condominium_fee: '',
    has_concierge: false,
    concierge_type: '',
    notes: '',
  });

  const citiesQuery = usePropertyCities({
    enabled: tab !== 'owners' || cityDialog || neighborhoodDialog || condominiumDialog,
  });
  const neighborhoodsQuery = usePropertyNeighborhoods(selectedCityId || undefined, {
    enabled:
      tab === 'neighborhoods' ||
      tab === 'condominiums' ||
      neighborhoodDialog ||
      condominiumDialog,
  });
  const condominiumsQuery = usePropertyCondominiums(selectedNeighborhoodId || undefined, {
    enabled: tab === 'condominiums' || condominiumDialog,
  });
  const { data: cities = [], isLoading: loadingCities } = citiesQuery;
  const { data: neighborhoods = [], isLoading: loadingNeighborhoods } = neighborhoodsQuery;
  const { data: condominiums = [], isLoading: loadingCondominiums } = condominiumsQuery;
  const ownersQuery = usePropertyOwnersPage(debouncedOwnerSearch, { enabled: tab === 'owners' });
  const propertiesQuery = useInfiniteProperties(
    debouncedPropertySearch,
    50,
    {},
    { enabled: assignmentOpen },
  );
  const properties = propertiesQuery.data?.pages.flatMap((page) => page.properties) ?? [];
  const loadingProperties = propertiesQuery.isLoading || propertiesQuery.isPlaceholderData;
  const propertyTotalCount = propertiesQuery.data?.pages[0]?.totalCount ?? properties.length;

  const createCity = useCreateCity();
  const deleteCity = useDeleteCity();
  const createNeighborhood = useCreateNeighborhood();
  const deleteNeighborhood = useDeleteNeighborhood();
  const createCondominium = useCreateCondominium();
  const deleteCondominium = useDeleteCondominium();
  const createOwner = useCreatePropertyOwner();
  const updateOwner = useUpdatePropertyOwner();
  const deletionPending = deleteCity.isPending || deleteNeighborhood.isPending || deleteCondominium.isPending;

  const filteredCities = useMemo(
    () => cities.filter((city) => searchTextIncludes(city.name, search)),
    [cities, search],
  );

  const filteredNeighborhoods = useMemo(
    () => neighborhoods.filter((neighborhood) => searchTextIncludes(neighborhood.name, search)),
    [neighborhoods, search],
  );

  const filteredCondominiums = useMemo(
    () => condominiums.filter((condominium) => searchTextIncludes(condominium.name, search)),
    [condominiums, search],
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedOwnerSearch(search.trim()), 250);
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedPropertySearch(propertySearch.trim()), 250);
    return () => window.clearTimeout(timeout);
  }, [propertySearch]);

  const ownerPages = ownersQuery.data?.pages;
  const legacyOwners = ownerPages?.[0]?.legacyOwners;
  const serverOwners = ownerPages?.flatMap((page) => page.owners) ?? [];
  const legacyOwnerPageKey = `${organizationId || ''}:${debouncedOwnerSearch}`;
  const legacyOwnerVisibleCount = legacyOwnerPagination.key === legacyOwnerPageKey
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
    : ownerPages?.[0]?.totalCount ?? serverOwners.length;
  const loadingOwners = ownersQuery.isLoading;
  const hasMoreOwners = legacyOwners
    ? filteredOwners.length < filteredLegacyOwners.length
    : ownersQuery.hasNextPage;

  const selectedPropertySet = useMemo(() => new Set(selectedPropertyIds), [selectedPropertyIds]);
  const pageTitle = useMemo(() => {
    if (tab === 'condominiums') return 'Condomínios';
    if (tab === 'owners') return 'Proprietários';
    return 'Localidades';
  }, [tab]);

  const handleCreateCity = async () => {
    if (!cityForm.name.trim()) {
      toast.error('Nome da cidade é obrigatório');
      return;
    }
    try {
      await createCity.mutateAsync({
        name: cityForm.name.trim(),
        uf: cityForm.uf.trim().toUpperCase() || undefined,
      });
      setCityForm({ name: '', uf: '' });
      setCityDialog(false);
    } catch {
      // The mutation hook keeps the dialog open and reports the domain error.
    }
  };

  const handleCreateNeighborhood = async () => {
    if (!neighborhoodForm.name.trim() || !neighborhoodForm.city_id) {
      toast.error('Nome e cidade são obrigatórios');
      return;
    }
    try {
      await createNeighborhood.mutateAsync(neighborhoodForm);
      setNeighborhoodForm({ name: '', city_id: '' });
      setNeighborhoodDialog(false);
    } catch {
      // The mutation hook keeps the dialog open and reports the domain error.
    }
  };

  const handleCreateCondominium = async () => {
    if (!condominiumForm.name.trim()) {
      toast.error('Nome do condomínio é obrigatório');
      return;
    }
    const condominiumFee = parseCurrencyInput(condominiumForm.default_condominium_fee);
    if (condominiumForm.default_condominium_fee.trim() && condominiumFee === undefined) {
      toast.error('Informe uma taxa de condomínio válida');
      return;
    }
    try {
      await createCondominium.mutateAsync({
        name: condominiumForm.name.trim(),
        city_id: condominiumForm.city_id || undefined,
        neighborhood_id: condominiumForm.neighborhood_id || undefined,
        address: condominiumForm.address.trim() || undefined,
        photo_url: condominiumForm.photo_url.trim() || undefined,
        cep: condominiumForm.cep.trim() || undefined,
        number: condominiumForm.number.trim() || undefined,
        complement: condominiumForm.complement.trim() || undefined,
        default_condominium_fee: condominiumFee,
        has_concierge: condominiumForm.has_concierge,
        concierge_type: condominiumForm.concierge_type.trim() || undefined,
        notes: condominiumForm.notes.trim() || undefined,
      });
      setCondominiumForm({
        name: '',
        city_id: '',
        neighborhood_id: '',
        address: '',
        photo_url: '',
        cep: '',
        number: '',
        complement: '',
        default_condominium_fee: '',
        has_concierge: false,
        concierge_type: '',
        notes: '',
      });
      setCondominiumDialog(false);
    } catch {
      // The mutation hook keeps the dialog open and reports the domain error.
    }
  };

  const handleDeleteLocation = async () => {
    if (!deletionTarget) return;
    try {
      if (deletionTarget.type === 'city') {
        await deleteCity.mutateAsync(deletionTarget.id);
      } else if (deletionTarget.type === 'neighborhood') {
        await deleteNeighborhood.mutateAsync(deletionTarget.id);
      } else {
        await deleteCondominium.mutateAsync(deletionTarget.id);
      }
      setDeletionTarget(null);
    } catch {
      // The mutation hook reports the error and the confirmation remains open.
    }
  };

  const openOwnerDialog = (owner?: PropertyOwner) => {
    setEditingOwner(owner || null);
    setOwnerForm(owner ? {
      name: owner.name || '',
      phone_residential: owner.phone_residential || '',
      phone_commercial: owner.phone_commercial || '',
      cellphone: owner.cellphone || '',
      email: owner.email || '',
      media_source: owner.media_source || '',
      notify_email: !!owner.notify_email,
      notes: owner.notes || '',
    } : EMPTY_OWNER_FORM);
    setOwnerDialog(true);
  };

  const handleSaveOwner = async () => {
    if (!ownerForm.name.trim()) {
      toast.error('Nome do proprietário é obrigatório');
      return;
    }

    if (editingOwner) {
      await updateOwner.mutateAsync({ id: editingOwner.id, ...ownerForm });
    } else {
      await createOwner.mutateAsync(ownerForm);
    }
    setOwnerDialog(false);
    setEditingOwner(null);
    setOwnerForm(EMPTY_OWNER_FORM);
  };

  const cityAssignment = (city: PropertyCity): AssignmentTarget => ({
    type: 'cities',
    id: city.id,
    title: city.name,
    subtitle: city.uf ? `Cidade - ${city.uf}` : 'Cidade',
    payload: {
      city_id: city.id,
      cidade: city.name,
      uf: city.uf || null,
    },
  });

  const neighborhoodAssignment = (neighborhood: PropertyNeighborhood): AssignmentTarget => ({
    type: 'neighborhoods',
    id: neighborhood.id,
    title: neighborhood.name,
    subtitle: neighborhood.city?.name || 'Bairro',
    payload: {
      neighborhood_id: neighborhood.id,
      bairro: neighborhood.name,
      city_id: neighborhood.city_id || null,
      cidade: neighborhood.city?.name || null,
      uf: neighborhood.city?.uf || null,
    },
  });

  const ownerAssignment = (owner: PropertyOwner): AssignmentTarget => ({
    type: 'owners',
    id: owner.id,
    title: owner.name,
    subtitle: 'Proprietário',
    payload: {
      owner_id: owner.id,
      owner_name: owner.name,
      owner_phone_residential: owner.phone_residential,
      owner_phone_commercial: owner.phone_commercial,
      owner_cellphone: owner.cellphone,
      owner_email: owner.email,
      owner_media_source: owner.media_source,
      owner_notify_email: owner.notify_email,
    },
  });

  const openAssignmentDialog = (target: AssignmentTarget) => {
    setAssignmentTarget(target);
    setPropertySearch('');
    setDebouncedPropertySearch('');
    setSelectedPropertyIds([]);
    setAssignmentOpen(true);
  };

  const handleLoadMoreOwners = () => {
    if (legacyOwners) {
      setLegacyOwnerPagination((current) => ({
        key: legacyOwnerPageKey,
        count: current.key === legacyOwnerPageKey
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
      toast.error('Selecione pelo menos um imóvel');
      return;
    }

    setAssigningProperties(true);
    try {
      for (const propertyId of selectedPropertyIds) {
        await propertiesAPI.updateProperty(propertyId, assignmentTarget.payload, organizationId);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['properties'] }),
        queryClient.invalidateQueries({ queryKey: ['properties-infinite'] }),
        queryClient.invalidateQueries({ queryKey: ['property-owners'] }),
        queryClient.invalidateQueries({ queryKey: ['property-cities'] }),
        queryClient.invalidateQueries({ queryKey: ['property-neighborhoods'] }),
        queryClient.invalidateQueries({ queryKey: ['property-condominiums'] }),
      ]);
      toast.success('Imóveis vinculados com sucesso!');
      setAssignmentOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível vincular os imóveis');
    } finally {
      setAssigningProperties(false);
    }
  };

  return (
    <AppLayout title={pageTitle}>
      <div className="space-y-4 animate-in">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 border-0 pl-9 text-sm shadow-none"
          />
        </div>

        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as PropertyLocationsTab)}
        >
          <div
            data-collapse="compact"
            className="app-responsive-tab-list min-w-0 flex-1"
          >
            <TabsList
              data-responsive-tab-scroll
              aria-label="Cadastros de imóveis"
              className="flex w-fit max-w-full flex-nowrap justify-start overflow-x-auto rounded-[8px] border-0 bg-muted/40 p-1 shadow-none"
            >
              <TabsTrigger
                value="cities"
                data-responsive-tab
                aria-label="Cidades"
                title="Cidades"
                className="h-8 shrink-0 gap-2 rounded-[6px] border-0 shadow-none data-[state=active]:shadow-none"
              >
                <MapPinned
                  aria-hidden="true"
                  className="h-3.5 w-3.5 shrink-0"
                />
                <span className="app-responsive-tab-label">Cidades</span>
                <CounterBadge count={cities.length} loading={loadingCities} />
              </TabsTrigger>
              <TabsTrigger
                value="neighborhoods"
                data-responsive-tab
                aria-label="Bairros"
                title="Bairros"
                className="h-8 shrink-0 gap-2 rounded-[6px] border-0 shadow-none data-[state=active]:shadow-none"
              >
                <Map aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                <span className="app-responsive-tab-label">Bairros</span>
                <CounterBadge
                  count={neighborhoods.length}
                  loading={loadingNeighborhoods}
                />
              </TabsTrigger>
              <TabsTrigger
                value="condominiums"
                data-responsive-tab
                aria-label="Condomínios"
                title="Condomínios"
                className="h-8 shrink-0 gap-2 rounded-[6px] border-0 shadow-none data-[state=active]:shadow-none"
              >
                <Building2
                  aria-hidden="true"
                  className="h-3.5 w-3.5 shrink-0"
                />
                <span className="app-responsive-tab-label">Condomínios</span>
                <CounterBadge
                  count={condominiums.length}
                  loading={loadingCondominiums}
                />
              </TabsTrigger>
              <TabsTrigger
                value="owners"
                data-responsive-tab
                aria-label="Proprietários"
                title="Proprietários"
                className="h-8 shrink-0 gap-2 rounded-[6px] border-0 shadow-none data-[state=active]:shadow-none"
              >
                <UserRound
                  aria-hidden="true"
                  className="h-3.5 w-3.5 shrink-0"
                />
                <span className="app-responsive-tab-label">Proprietários</span>
                <CounterBadge count={ownerTotalCount} loading={loadingOwners} />
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="cities" className="mt-4">
            <section className="rounded-[8px] bg-card p-4">
              <div className="mb-4 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
                <h2 className="text-base font-medium">Cidades cadastradas</h2>
                <Dialog
                  open={cityDialog}
                  onOpenChange={(nextOpen) => {
                    if (!createCity.isPending) setCityDialog(nextOpen);
                  }}
                >
                  <DialogTrigger asChild>
                    <Button size="sm">
                      <Plus className="mr-2 h-4 w-4" />
                      Nova cidade
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="border-0">
                    <DialogHeader>
                      <DialogTitle>Nova cidade</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 pt-4">
                      <div className="space-y-2">
                        <Label>Nome da cidade *</Label>
                        <Input
                          value={cityForm.name}
                          onChange={(e) =>
                            setCityForm((prev) => ({
                              ...prev,
                              name: e.target.value,
                            }))
                          }
                          placeholder="Ex: São Paulo"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>UF</Label>
                        <Select
                          value={cityForm.uf}
                          onValueChange={(value) =>
                            setCityForm((prev) => ({ ...prev, uf: value }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione o estado" />
                          </SelectTrigger>
                          <SelectContent>
                            {UF_OPTIONS.map((uf) => (
                              <SelectItem key={uf} value={uf}>
                                {uf}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex justify-end gap-2 pt-4">
                        <Button
                          variant="secondary"
                          onClick={() => setCityDialog(false)}
                          disabled={createCity.isPending}
                        >
                          Cancelar
                        </Button>
                        <Button
                          onClick={handleCreateCity}
                          disabled={createCity.isPending}
                        >
                          {createCity.isPending ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : null}
                          Cadastrar
                        </Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>

              {loadingCities ? (
                <LoadingState />
              ) : citiesQuery.isError && cities.length === 0 ? (
                <LocationErrorState
                  label="as cidades"
                  loading={citiesQuery.isFetching}
                  onRetry={() => void citiesQuery.refetch()}
                />
              ) : filteredCities.length === 0 ? (
                <EmptyState text="Nenhuma cidade cadastrada" />
              ) : (
                <div className="overflow-x-auto">
                  <Table className="min-w-[520px] [&_tr]:border-border/40">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Cidade</TableHead>
                        <TableHead>UF</TableHead>
                        <TableHead className="w-44 text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredCities.map((city) => (
                        <TableRow key={city.id}>
                          <TableCell className="font-medium">
                            {city.name}
                          </TableCell>
                          <TableCell>
                            {city.uf ? (
                              <span className="rounded-[6px] bg-muted px-2 py-1 text-xs">
                                {city.uf}
                              </span>
                            ) : (
                              "-"
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  openAssignmentDialog(cityAssignment(city))
                                }
                              >
                                <Link2 className="mr-2 h-4 w-4" />
                                Imóveis
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-destructive hover:text-destructive"
                                aria-label={`Excluir cidade ${city.name}`}
                                onClick={() =>
                                  setDeletionTarget({
                                    type: 'city',
                                    id: city.id,
                                    name: city.name,
                                  })
                                }
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>
          </TabsContent>

          <TabsContent value="neighborhoods" className="mt-4">
            <section className="rounded-[8px] bg-card p-4">
              <div className="mb-4 flex flex-col justify-between gap-3 md:flex-row md:items-center">
                <div className="flex w-full flex-col items-start gap-3 sm:flex-row sm:items-center md:w-auto">
                  <h2 className="text-base font-medium">Bairros</h2>
                  <Select
                    value={selectedCityId || "__all__"}
                    onValueChange={(value) =>
                      setSelectedCityId(value === "__all__" ? "" : value)
                    }
                  >
                    <SelectTrigger className="h-9 w-full border-0 shadow-none sm:w-48">
                      <SelectValue placeholder="Filtrar por cidade" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">Todas as cidades</SelectItem>
                      {cities.map((city) => (
                        <SelectItem key={city.id} value={city.id}>
                          {city.name} {city.uf ? `(${city.uf})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Dialog
                  open={neighborhoodDialog}
                  onOpenChange={(nextOpen) => {
                    if (!createNeighborhood.isPending) setNeighborhoodDialog(nextOpen);
                  }}
                >
                  <DialogTrigger asChild>
                    <Button size="sm">
                      <Plus className="mr-2 h-4 w-4" />
                      Novo bairro
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="border-0">
                    <DialogHeader>
                      <DialogTitle>Novo bairro</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 pt-4">
                      <div className="space-y-2">
                        <Label>Cidade *</Label>
                        <Select
                          value={neighborhoodForm.city_id}
                          onValueChange={(value) =>
                            setNeighborhoodForm((prev) => ({
                              ...prev,
                              city_id: value,
                            }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione a cidade" />
                          </SelectTrigger>
                          <SelectContent>
                            {cities.map((city) => (
                              <SelectItem key={city.id} value={city.id}>
                                {city.name} {city.uf ? `(${city.uf})` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Nome do bairro *</Label>
                        <Input
                          value={neighborhoodForm.name}
                          onChange={(e) =>
                            setNeighborhoodForm((prev) => ({
                              ...prev,
                              name: e.target.value,
                            }))
                          }
                          placeholder="Ex: Centro"
                        />
                      </div>
                      <div className="flex justify-end gap-2 pt-4">
                        <Button
                          variant="secondary"
                          onClick={() => setNeighborhoodDialog(false)}
                          disabled={createNeighborhood.isPending}
                        >
                          Cancelar
                        </Button>
                        <Button
                          onClick={handleCreateNeighborhood}
                          disabled={createNeighborhood.isPending}
                        >
                          {createNeighborhood.isPending ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : null}
                          Cadastrar
                        </Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>

              {loadingNeighborhoods ? (
                <LoadingState />
              ) : neighborhoodsQuery.isError && neighborhoods.length === 0 ? (
                <LocationErrorState
                  label="os bairros"
                  loading={neighborhoodsQuery.isFetching}
                  onRetry={() => void neighborhoodsQuery.refetch()}
                />
              ) : filteredNeighborhoods.length === 0 ? (
                <EmptyState text="Nenhum bairro cadastrado" />
              ) : (
                <div className="overflow-x-auto">
                  <Table className="min-w-[560px] [&_tr]:border-border/40">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Bairro</TableHead>
                        <TableHead>Cidade</TableHead>
                        <TableHead className="w-44 text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredNeighborhoods.map((neighborhood) => (
                        <TableRow key={neighborhood.id}>
                          <TableCell className="font-medium">
                            {neighborhood.name}
                          </TableCell>
                          <TableCell>
                            {neighborhood.city?.name}
                            {neighborhood.city?.uf
                              ? ` (${neighborhood.city.uf})`
                              : ""}
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  openAssignmentDialog(
                                    neighborhoodAssignment(neighborhood),
                                  )
                                }
                              >
                                <Link2 className="mr-2 h-4 w-4" />
                                Imóveis
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-destructive hover:text-destructive"
                                aria-label={`Excluir bairro ${neighborhood.name}`}
                                onClick={() =>
                                  setDeletionTarget({
                                    type: 'neighborhood',
                                    id: neighborhood.id,
                                    name: neighborhood.name,
                                  })
                                }
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>
          </TabsContent>

          <TabsContent value="condominiums" className="mt-4">
            <section className="rounded-[8px] bg-card p-4">
              <div className="mb-4 flex flex-col justify-between gap-3 md:flex-row md:items-center">
                <div className="flex w-full flex-col items-start gap-3 sm:flex-row sm:items-center md:w-auto">
                  <h2 className="text-base font-medium">Condomínios</h2>
                  <Select
                    value={selectedNeighborhoodId || "__all__"}
                    onValueChange={(value) =>
                      setSelectedNeighborhoodId(
                        value === "__all__" ? "" : value,
                      )
                    }
                  >
                    <SelectTrigger className="h-9 w-full border-0 shadow-none sm:w-48">
                      <SelectValue placeholder="Filtrar por bairro" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">Todos os bairros</SelectItem>
                      {neighborhoods.map((neighborhood) => (
                        <SelectItem
                          key={neighborhood.id}
                          value={neighborhood.id}
                        >
                          {neighborhood.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Dialog
                  open={condominiumDialog}
                  onOpenChange={(nextOpen) => {
                    if (!createCondominium.isPending) setCondominiumDialog(nextOpen);
                  }}
                >
                  <DialogTrigger asChild>
                    <Button size="sm">
                      <Plus className="mr-2 h-4 w-4" />
                      Novo condomínio
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-h-[90vh] overflow-y-auto border-0">
                    <DialogHeader>
                      <DialogTitle>Novo condomínio</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 pt-4">
                      <div className="space-y-2">
                        <Label>Nome do condomínio *</Label>
                        <Input
                          value={condominiumForm.name}
                          onChange={(e) =>
                            setCondominiumForm((prev) => ({
                              ...prev,
                              name: e.target.value,
                            }))
                          }
                          placeholder="Ex: Residencial das Flores"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Cidade</Label>
                        <Select
                          value={condominiumForm.city_id}
                          onValueChange={(value) => {
                            setSelectedCityId(value);
                            setCondominiumForm((prev) => ({
                              ...prev,
                              city_id: value,
                              neighborhood_id: "",
                            }));
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione a cidade" />
                          </SelectTrigger>
                          <SelectContent>
                            {cities.map((city) => (
                              <SelectItem key={city.id} value={city.id}>
                                {city.name} {city.uf ? `(${city.uf})` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Bairro</Label>
                        <Select
                          value={condominiumForm.neighborhood_id}
                          onValueChange={(value) =>
                            setCondominiumForm((prev) => ({
                              ...prev,
                              neighborhood_id: value,
                            }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione o bairro" />
                          </SelectTrigger>
                          <SelectContent>
                            {neighborhoods.map((neighborhood) => (
                              <SelectItem
                                key={neighborhood.id}
                                value={neighborhood.id}
                              >
                                {neighborhood.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Endereço</Label>
                        <Input
                          value={condominiumForm.address}
                          onChange={(e) =>
                            setCondominiumForm((prev) => ({
                              ...prev,
                              address: e.target.value,
                            }))
                          }
                          placeholder="Ex: Rua das Flores, 123"
                        />
                      </div>
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        <TextField
                          label="CEP"
                          value={condominiumForm.cep}
                          onChange={(value) =>
                            setCondominiumForm((prev) => ({
                              ...prev,
                              cep: value,
                            }))
                          }
                          placeholder="00000-000"
                        />
                        <TextField
                          label="Número"
                          value={condominiumForm.number}
                          onChange={(value) =>
                            setCondominiumForm((prev) => ({
                              ...prev,
                              number: value,
                            }))
                          }
                          placeholder="123"
                        />
                        <TextField
                          label="Complemento"
                          value={condominiumForm.complement}
                          onChange={(value) =>
                            setCondominiumForm((prev) => ({
                              ...prev,
                              complement: value,
                            }))
                          }
                          placeholder="Bloco, portaria..."
                        />
                      </div>
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <TextField
                          label="Taxa padrão do condomínio (R$)"
                          value={condominiumForm.default_condominium_fee}
                          onChange={(value) =>
                            setCondominiumForm((prev) => ({
                              ...prev,
                              default_condominium_fee: value.replace(/[^\d.,]/g, ""),
                            }))
                          }
                          placeholder="800"
                        />
                        <TextField
                          label="Foto do condomínio (URL)"
                          value={condominiumForm.photo_url}
                          onChange={(value) =>
                            setCondominiumForm((prev) => ({
                              ...prev,
                              photo_url: value,
                            }))
                          }
                          placeholder="https://..."
                        />
                      </div>
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div className="flex items-center justify-between gap-3 rounded-[6px] bg-[var(--app-surface-soft)] p-3">
                          <Label>Tem portaria</Label>
                          <Switch
                            checked={condominiumForm.has_concierge}
                            onCheckedChange={(checked) =>
                              setCondominiumForm((prev) => ({
                                ...prev,
                                has_concierge: checked,
                              }))
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Tipo de portaria</Label>
                          <Select
                            value={condominiumForm.concierge_type || undefined}
                            onValueChange={(value) =>
                              setCondominiumForm((prev) => ({
                                ...prev,
                                concierge_type: value,
                              }))
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Selecione..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="24h">24h</SelectItem>
                              <SelectItem value="comercial">
                                Horário comercial
                              </SelectItem>
                              <SelectItem value="remota">Remota</SelectItem>
                              <SelectItem value="sem_portaria">
                                Sem portaria
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <TextField
                        label="Observações internas"
                        value={condominiumForm.notes}
                        onChange={(value) =>
                          setCondominiumForm((prev) => ({
                            ...prev,
                            notes: value,
                          }))
                        }
                        placeholder="Acesso, referência, regras internas..."
                      />
                      <div className="flex justify-end gap-2 pt-4">
                        <Button
                          variant="secondary"
                          onClick={() => setCondominiumDialog(false)}
                          disabled={createCondominium.isPending}
                        >
                          Cancelar
                        </Button>
                        <Button
                          onClick={handleCreateCondominium}
                          disabled={createCondominium.isPending}
                        >
                          {createCondominium.isPending ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : null}
                          Cadastrar
                        </Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>

              {loadingCondominiums ? (
                <LoadingState />
              ) : condominiumsQuery.isError && condominiums.length === 0 ? (
                <LocationErrorState
                  label="os condomínios"
                  loading={condominiumsQuery.isFetching}
                  onRetry={() => void condominiumsQuery.refetch()}
                />
              ) : filteredCondominiums.length === 0 ? (
                <EmptyState text="Nenhum condomínio cadastrado" />
              ) : (
                <div className="overflow-x-auto">
                  <Table className="min-w-[760px] [&_tr]:border-border/40">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Condomínio</TableHead>
                        <TableHead>Bairro</TableHead>
                        <TableHead>Cidade</TableHead>
                        <TableHead>Taxa</TableHead>
                        <TableHead>Portaria</TableHead>
                        <TableHead className="w-44 text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredCondominiums.map((condominium) => (
                        <TableRow key={condominium.id}>
                          <TableCell className="font-medium">
                            {condominium.name}
                          </TableCell>
                          <TableCell>
                            {condominium.neighborhood?.name || "-"}
                          </TableCell>
                          <TableCell>
                            {condominium.city?.name}
                            {condominium.city?.uf
                              ? ` (${condominium.city.uf})`
                              : ""}
                          </TableCell>
                          <TableCell>
                            {condominium.default_condominium_fee != null
                              ? `R$ ${Number(condominium.default_condominium_fee).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                              : "-"}
                          </TableCell>
                          <TableCell>
                            {condominium.has_concierge
                              ? condominium.concierge_type || "Sim"
                              : "-"}
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-destructive hover:text-destructive"
                                aria-label={`Excluir condomínio ${condominium.name}`}
                                onClick={() =>
                                  setDeletionTarget({
                                    type: 'condominium',
                                    id: condominium.id,
                                    name: condominium.name,
                                  })
                                }
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>
          </TabsContent>

          <TabsContent value="owners" className="mt-4">
            <section className="rounded-[8px] bg-card p-4">
              <div className="mb-4 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
                <div>
                  <h2 className="text-base font-medium">Proprietários</h2>
                  <p className="text-xs text-muted-foreground" aria-live="polite">
                    {loadingOwners
                      ? "Carregando proprietários..."
                      : `${ownerTotalCount} ${ownerTotalCount === 1 ? "proprietário" : "proprietários"}`}
                  </p>
                </div>
                <Button size="sm" onClick={() => openOwnerDialog()}>
                  <Plus className="mr-2 h-4 w-4" />
                  Novo proprietário
                </Button>
              </div>

              {loadingOwners ? (
                <LoadingState />
              ) : ownersQuery.isError && filteredOwners.length === 0 ? (
                <OwnerErrorState
                  loading={ownersQuery.isFetching}
                  onRetry={() => void ownersQuery.refetch()}
                />
              ) : filteredOwners.length === 0 ? (
                <EmptyState
                  text={
                    debouncedOwnerSearch
                      ? "Nenhum proprietário encontrado"
                      : "Nenhum proprietário cadastrado"
                  }
                />
              ) : (
                <>
                  {!isMobile ? (
                  <div className="overflow-x-auto">
                    <Table className="min-w-[760px] [&_tr]:border-border/40">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Proprietário</TableHead>
                          <TableHead>Contato</TableHead>
                          <TableHead>Imóveis vinculados</TableHead>
                          <TableHead className="w-48 text-right">Ações</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredOwners.map((owner) => {
                          const propertyCount = getOwnerPropertyCount(owner);
                          const expanded = expandedOwnerId === owner.id;

                          return (
                            <Fragment key={owner.id}>
                              <TableRow>
                                <TableCell className="min-w-56">
                                  <div className="font-medium">{owner.name}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {owner.media_source || "Origem não informada"}
                                  </div>
                                </TableCell>
                                <TableCell className="min-w-52">
                                  <OwnerContactDetails owner={owner} visible={canSeeOwnerContact} />
                                </TableCell>
                                <TableCell>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 rounded-[6px] bg-muted px-2.5 text-xs font-medium hover:bg-muted/80"
                                    onClick={() =>
                                      setExpandedOwnerId(expanded ? null : owner.id)
                                    }
                                    disabled={propertyCount === 0}
                                    aria-expanded={expanded}
                                    aria-controls={`owner-properties-${owner.id}`}
                                  >
                                    {propertyCount} {propertyCount === 1 ? "imóvel" : "imóveis"}
                                  </Button>
                                </TableCell>
                                <TableCell>
                                  <div className="flex justify-end gap-1">
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => openAssignmentDialog(ownerAssignment(owner))}
                                      aria-label={`Vincular imóveis a ${owner.name}`}
                                    >
                                      <Link2 className="mr-2 h-4 w-4" aria-hidden="true" />
                                      Imóveis
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => openOwnerDialog(owner)}
                                      aria-label={`Editar ${owner.name}`}
                                    >
                                      <Edit2 className="h-4 w-4" aria-hidden="true" />
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                              {expanded ? (
                                <TableRow id={`owner-properties-${owner.id}`}>
                                  <TableCell colSpan={4} className="bg-muted/20 p-4">
                                    <OwnerPropertyPreview owner={owner} />
                                  </TableCell>
                                </TableRow>
                              ) : null}
                            </Fragment>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                  ) : (
                  <div className="space-y-2">
                    {filteredOwners.map((owner) => {
                      const propertyCount = getOwnerPropertyCount(owner);
                      const expanded = expandedOwnerId === owner.id;
                      return (
                        <article
                          key={owner.id}
                          className="rounded-[8px] bg-[var(--app-surface-soft)] p-3"
                        >
                          <div className="min-w-0">
                            <h3 className="truncate text-sm font-medium">{owner.name}</h3>
                            <p className="truncate text-xs text-muted-foreground">
                              {owner.media_source || "Origem não informada"}
                            </p>
                          </div>
                          <div className="mt-3">
                            <OwnerContactDetails owner={owner} visible={canSeeOwnerContact} />
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="col-span-2 h-8 justify-center rounded-[6px] bg-muted px-2.5 text-xs font-medium hover:bg-muted/80"
                              onClick={() => setExpandedOwnerId(expanded ? null : owner.id)}
                              disabled={propertyCount === 0}
                              aria-expanded={expanded}
                              aria-controls={`owner-properties-mobile-${owner.id}`}
                            >
                              {propertyCount} {propertyCount === 1 ? "imóvel" : "imóveis"}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => openAssignmentDialog(ownerAssignment(owner))}
                              aria-label={`Vincular imóveis a ${owner.name}`}
                            >
                              <Link2 className="h-4 w-4" aria-hidden="true" />
                              Imóveis
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => openOwnerDialog(owner)}
                              aria-label={`Editar ${owner.name}`}
                            >
                              <Edit2 className="h-4 w-4" aria-hidden="true" />
                              Editar
                            </Button>
                          </div>
                          {expanded ? (
                            <div
                              id={`owner-properties-mobile-${owner.id}`}
                              className="mt-3 border-t border-border/40 pt-3"
                            >
                              <OwnerPropertyPreview owner={owner} />
                            </div>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                  )}

                  <div className="flex flex-col items-center gap-2 pt-4">
                    <p className="text-xs text-muted-foreground">
                      Exibindo {filteredOwners.length} de {ownerTotalCount}
                    </p>
                    {hasMoreOwners || ownersQuery.isFetchNextPageError ? (
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleLoadMoreOwners}
                        disabled={ownersQuery.isFetchingNextPage}
                        className="h-8 rounded-[6px] px-3 text-xs font-light shadow-none"
                      >
                        {ownersQuery.isFetchingNextPage ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        ) : null}
                        {ownersQuery.isFetchingNextPage
                          ? "Carregando..."
                          : ownersQuery.isFetchNextPageError
                            ? "Tentar carregar mais"
                            : "Carregar mais"}
                      </Button>
                    ) : null}
                    {ownersQuery.isFetchNextPageError ? (
                      <p className="flex items-center gap-2 text-xs text-destructive" role="status">
                        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                        Não foi possível carregar a próxima página.
                      </p>
                    ) : null}
                  </div>
                </>
              )}
            </section>
          </TabsContent>
        </Tabs>

        <Dialog open={ownerDialog} onOpenChange={setOwnerDialog}>
          <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto border-0">
            <DialogHeader>
              <DialogTitle>
                {editingOwner ? "Editar proprietário" : "Novo proprietário"}
              </DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-1 gap-4 pt-4 md:grid-cols-2">
              <TextField
                label="Nome *"
                value={ownerForm.name}
                onChange={(value) =>
                  setOwnerForm((prev) => ({ ...prev, name: value }))
                }
                placeholder="Nome completo"
              />
              <TextField
                label="E-mail"
                value={ownerForm.email}
                onChange={(value) =>
                  setOwnerForm((prev) => ({ ...prev, email: value }))
                }
                placeholder="email@exemplo.com"
              />
              <TextField
                label="Celular"
                value={ownerForm.cellphone}
                onChange={(value) =>
                  setOwnerForm((prev) => ({ ...prev, cellphone: value }))
                }
                placeholder="(00) 00000-0000"
              />
              <TextField
                label="Origem"
                value={ownerForm.media_source}
                onChange={(value) =>
                  setOwnerForm((prev) => ({ ...prev, media_source: value }))
                }
                placeholder="Indicação, site..."
              />
              <TextField
                label="Tel. residencial"
                value={ownerForm.phone_residential}
                onChange={(value) =>
                  setOwnerForm((prev) => ({
                    ...prev,
                    phone_residential: value,
                  }))
                }
                placeholder="(00) 0000-0000"
              />
              <TextField
                label="Tel. comercial"
                value={ownerForm.phone_commercial}
                onChange={(value) =>
                  setOwnerForm((prev) => ({ ...prev, phone_commercial: value }))
                }
                placeholder="(00) 0000-0000"
              />
              <div className="flex items-center justify-between rounded-[6px] bg-[var(--app-surface-soft)] p-3 md:col-span-2">
                <Label>Enviar avisos por e-mail</Label>
                <Switch
                  checked={ownerForm.notify_email}
                  onCheckedChange={(checked) =>
                    setOwnerForm((prev) => ({ ...prev, notify_email: checked }))
                  }
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Observações</Label>
                <Textarea
                  value={ownerForm.notes}
                  onChange={(event) =>
                    setOwnerForm((prev) => ({
                      ...prev,
                      notes: event.target.value,
                    }))
                  }
                  placeholder="Observações internas..."
                  className="min-h-24 border-0 shadow-none"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="secondary" onClick={() => setOwnerDialog(false)}>
                Cancelar
              </Button>
              <Button
                onClick={handleSaveOwner}
                disabled={createOwner.isPending || updateOwner.isPending}
              >
                {createOwner.isPending || updateOwner.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Salvar
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog
          open={assignmentOpen}
          onOpenChange={(nextOpen) => {
            if (!assigningProperties) setAssignmentOpen(nextOpen);
          }}
        >
          <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto border-0">
            <DialogHeader>
              <DialogTitle>Vincular imóveis</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="rounded-[8px] bg-muted/40 p-3">
                <p className="text-sm font-medium">{assignmentTarget?.title}</p>
                {assignmentTarget?.subtitle ? (
                  <p className="text-xs text-muted-foreground">
                    {assignmentTarget.subtitle}
                  </p>
                ) : null}
              </div>
              <div className="relative max-w-sm">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={propertySearch}
                  onChange={(event) => setPropertySearch(event.target.value)}
                  placeholder="Buscar imóveis..."
                  disabled={assigningProperties}
                  className="h-9 border-0 pl-9 text-sm shadow-none"
                />
              </div>
              <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
                {loadingProperties ? (
                  <LoadingState />
                ) : propertiesQuery.isError && properties.length === 0 ? (
                  <div className="flex min-h-40 flex-col items-center justify-center px-4 py-6 text-center">
                    <AlertTriangle className="h-5 w-5 text-primary" aria-hidden="true" />
                    <p className="mt-2 text-sm font-medium">Não foi possível carregar os imóveis</p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void propertiesQuery.refetch()}
                      disabled={propertiesQuery.isFetching}
                      className="mt-3 h-8 rounded-[6px] bg-[var(--app-surface-soft)] px-3 text-xs font-light shadow-none"
                    >
                      {propertiesQuery.isFetching ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : null}
                      Tentar novamente
                    </Button>
                  </div>
                ) : properties.length === 0 ? (
                  <EmptyState text="Nenhum imóvel encontrado" />
                ) : (
                  <>
                    {properties.map((property) => {
                      const checked = selectedPropertySet.has(property.id);
                      const propertyLabel = property.code || property.title || "imóvel sem código";
                      return (
                        <button
                          key={property.id}
                          type="button"
                          aria-pressed={checked}
                          aria-label={`${checked ? "Remover" : "Selecionar"} ${propertyLabel}`}
                          onClick={() => togglePropertySelection(property.id)}
                          disabled={assigningProperties}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-[6px] bg-muted/35 p-3 text-left transition hover:bg-muted/55 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30",
                            checked && "bg-primary/10",
                          )}
                        >
                          <span
                            aria-hidden="true"
                            className={cn(
                              "flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border border-border/70 bg-background text-primary-foreground",
                              checked && "border-primary bg-primary",
                            )}
                          >
                            {checked ? <Check className="h-3 w-3" /> : null}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                              <span>{property.code || "Sem código"}</span>
                              <span className="rounded-[6px] bg-background/70 px-2 py-0.5 text-xs">
                                {property.tipo_de_negocio || property.finalidade || "Imóvel"}
                              </span>
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {property.title ||
                                property.tipo_de_imovel ||
                                property.tipo_de_negocio ||
                                "Imóvel sem título"}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {[property.bairro, property.cidade].filter(Boolean).join(" - ") ||
                                "Localização não informada"}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                    {propertiesQuery.hasNextPage || propertiesQuery.isFetchNextPageError ? (
                      <div className="flex flex-col items-center gap-2 py-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => void propertiesQuery.fetchNextPage()}
                          disabled={propertiesQuery.isFetchingNextPage}
                          className="h-8 rounded-[6px] bg-[var(--app-surface-soft)] px-3 text-xs font-light shadow-none"
                        >
                          {propertiesQuery.isFetchingNextPage ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                          ) : null}
                          {propertiesQuery.isFetchingNextPage
                            ? "Carregando..."
                            : propertiesQuery.isFetchNextPageError
                              ? "Tentar carregar mais"
                              : "Carregar mais imóveis"}
                        </Button>
                        {propertiesQuery.isFetchNextPageError ? (
                          <p className="text-xs text-destructive" role="status">
                            Não foi possível carregar a próxima página.
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                )}
              </div>
              <div className="flex items-center justify-between gap-3 pt-2">
                <div className="text-xs text-muted-foreground">
                  <p>{selectedPropertyIds.length} imóvel(is) selecionado(s)</p>
                  <p>Exibindo {properties.length} de {propertyTotalCount}</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => setAssignmentOpen(false)}
                    disabled={assigningProperties}
                  >
                    Cancelar
                  </Button>
                  <Button
                    onClick={handleAssignProperties}
                    disabled={assigningProperties}
                  >
                    {assigningProperties ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    Vincular selecionados
                  </Button>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <AlertDialog
          open={Boolean(deletionTarget)}
          onOpenChange={(nextOpen) => {
            if (!nextOpen && !deletionPending) setDeletionTarget(null);
          }}
        >
          <AlertDialogContent className="rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-base font-normal">
                Excluir {deletionTarget?.name}?
              </AlertDialogTitle>
              <AlertDialogDescription className="text-xs font-light">
                Esta ação é permanente e pode ser impedida caso existam imóveis ou cadastros vinculados.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deletionPending} className="rounded-[6px] shadow-none">
                Cancelar
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={deletionPending}
                onClick={(event) => {
                  event.preventDefault();
                  void handleDeleteLocation();
                }}
                className="rounded-[6px] bg-destructive text-destructive-foreground shadow-none hover:bg-destructive/90"
              >
                {deletionPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                {deletionPending ? 'Excluindo...' : 'Excluir'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AppLayout>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="border-0 shadow-none" />
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-8">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

function LocationErrorState({
  label,
  loading,
  onRetry,
}: {
  label: string;
  loading: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center px-4 py-8 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-[6px] bg-destructive/10 text-destructive">
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
      </span>
      <p className="mt-3 text-sm font-normal">Não foi possível carregar {label}</p>
      <p className="mt-1 text-xs font-light text-muted-foreground">
        Verifique sua conexão e tente novamente.
      </p>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onRetry}
        disabled={loading}
        className="mt-4 h-8 rounded-[6px] bg-[var(--app-surface-soft)] px-3 text-xs font-light shadow-none hover:bg-[var(--app-surface-hover)]"
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
        Tentar novamente
      </Button>
    </div>
  );
}

function OwnerErrorState({
  loading,
  onRetry,
}: {
  loading: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="flex min-h-44 flex-col items-center justify-center px-4 py-8 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-[6px] bg-primary/10 text-primary">
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
      </span>
      <p className="mt-3 text-sm font-medium">Não foi possível carregar os proprietários</p>
      <p className="mt-1 max-w-sm text-xs text-muted-foreground">
        Verifique sua conexão e tente novamente.
      </p>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onRetry}
        disabled={loading}
        className="mt-4 h-8 rounded-[6px] bg-[var(--app-surface-soft)] px-3 text-xs font-light shadow-none hover:bg-[var(--app-surface-hover)]"
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
        Tentar novamente
      </Button>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="py-8 text-center text-sm text-muted-foreground">{text}</div>;
}
