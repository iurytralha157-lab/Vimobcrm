"use client";

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AppLayout } from '@/components/shared/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Plus,
  Search,
  Loader2,
  Building2,
  LayoutGrid,
  AlertTriangle,
  RefreshCw,
  SlidersHorizontal,
  X
} from 'lucide-react';
import { useInfiniteProperties, useUpdateProperty, useDeleteProperty, type Property, type PropertyFilters } from '@/hooks/use-properties';
import { PropertyCard } from '@/components/features/properties/PropertyCard';
import { PropertyHistoryDialog } from '@/components/features/properties/PropertyHistoryDialog';
import { PropertyPreviewDialog } from '@/components/features/properties/PropertyPreviewDialog';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAuth } from '@/contexts/AuthContext';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useUsers } from '@/hooks/use-users';
import { usePropertyTypes } from '@/hooks/use-property-types';
import { cn } from '@/lib/utils';
import { propertiesAPI } from '@/lib/api/properties';
import { getPropertySiteInfo } from '@/lib/api/property-support';
import { toast } from 'sonner';

const formatPrice = (value: number | null, tipo: string | null) => {
  if (!value) return 'Preço não informado';
  if (tipo === 'Aluguel') {
    return `R$ ${value.toLocaleString('pt-BR')}/mês`;
  }
  return `R$ ${value.toLocaleString('pt-BR')}`;
};

const GRID_OPTIONS = [
  { value: '2', label: '2' },
  { value: '3', label: '3' },
];

const ALL_FILTER_VALUE = '__all__';
const EMPTY_FILTERS: PropertyFilters = {};

type KpiFilter = 'total' | 'sale' | 'rental' | 'available' | 'reserved' | 'sold' | 'rented' | 'private';

type PropertyWithCreator = Property & {
  cadastrado_por?: string | null;
  created_by?: string | null;
  responsible_user_id?: string | null;
};

const getStatsFilters = (current: PropertyFilters) => ({
  tipo_de_imovel: current.tipo_de_imovel,
  cidade: current.cidade,
  bairro: current.bairro,
  responsavel_id: current.responsavel_id,
  quartos_min: current.quartos_min,
  suites_min: current.suites_min,
  banheiros_min: current.banheiros_min,
  valor_min: current.valor_min,
  valor_max: current.valor_max,
  aceita_permuta: current.aceita_permuta === 'true' ? true : current.aceita_permuta === 'false' ? false : undefined,
});

export default function Properties() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<PropertyFilters>(EMPTY_FILTERS);
  const [previewProperty, setPreviewProperty] = useState<Property | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [historyProperty, setHistoryProperty] = useState<Property | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [gridCols, setGridCols] = useState('3');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [activeKpiFilter, setActiveKpiFilter] = useState<KpiFilter>('total');
  const isMobile = useIsMobile();
  const { profile, organization, isSuperAdmin } = useAuth();
  const isAdmin = profile?.role === 'admin' || isSuperAdmin;
  const organizationId = organization?.id || profile?.organization_id;
  const { data: users = [] } = useUsers();
  const { data: propertyTypes = [] } = usePropertyTypes();
  const { data: siteInfo = null } = useQuery({
    queryKey: ['org-site-info', organizationId],
    queryFn: async () => getPropertySiteInfo(organizationId),
    enabled: !!organizationId,
    staleTime: 1000 * 60 * 5,
  });

  const debouncedSearch = useDebouncedValue(search.trim(), 350);
  const debouncedFilters = useDebouncedValue(filters, 350);
  const statsFilters = useMemo(() => getStatsFilters(debouncedFilters), [debouncedFilters]);

  const {
    data,
    isLoading,
    isFetching,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage
  } = useInfiniteProperties(debouncedSearch, 24, debouncedFilters);

  const properties = data?.pages.flatMap(page => page.properties) || [];
  const totalCount = data?.pages[0]?.totalCount || 0;
  const { data: statsData, isFetching: isStatsFetching } = useQuery({
    queryKey: ['properties-stats', organizationId, debouncedSearch, statsFilters],
    queryFn: async () => {
      if (!organizationId) {
        return {
          total: 0,
          sale: 0,
          rental: 0,
          available: 0,
          reserved: 0,
          sold: 0,
          rented: 0,
          private: 0,
        };
      }

      return propertiesAPI.getPropertyStats(organizationId, {
        search: debouncedSearch,
        ...statsFilters,
      });
    },
    enabled: !!organizationId,
    staleTime: 1000 * 30,
    placeholderData: keepPreviousData,
  });
  const updateProperty = useUpdateProperty();
  const deleteProperty = useDeleteProperty();

  const openEdit = (property: Property) => {
    router.push(`/properties/${property.id}/edit`);
  };

  const handleDelete = async (id: string) => {
    await deleteProperty.mutateAsync(id);
  };

  const handleChangeStatus = async (id: string, status: 'ativo' | 'reservado' | 'vendido' | 'alugado') => {
    await updateProperty.mutateAsync({
      id,
      status,
      ...(status === 'ativo' ? { anunciar: true } : { anunciar: false }),
    });
    const labels = {
      ativo: 'disponivel',
      reservado: 'reservado',
      vendido: 'vendido',
      alugado: 'alugado',
    };
    toast.success(`Imovel marcado como ${labels[status]}!`);
  };

  const handleToggleVisibility = async (id: string, isPublic: boolean) => {
    await updateProperty.mutateAsync({
      id,
      anunciar: isPublic
    });
    toast.success(isPublic ? 'Imovel publicado no site!' : 'Imovel removido do site!');
  };

  const stats = {
    total: statsData?.total ?? totalCount,
    venda: statsData?.sale ?? 0,
    locacao: statsData?.rental ?? 0,
    disponiveis: statsData?.available ?? 0,
    reservados: statsData?.reserved ?? 0,
    vendidos: statsData?.sold ?? 0,
    alugados: statsData?.rented ?? 0,
    privados: statsData?.private ?? 0,
  };
  const isFilterSettling = search.trim() !== debouncedSearch || filters !== debouncedFilters;
  const isListUpdating = Boolean(data) && !isFetchingNextPage && (isFetching || isFilterSettling);
  const isFilterUpdating = isListUpdating || isStatsFetching || isFilterSettling;
  const propertyListErrorMessage = error instanceof Error ? error.message : '';
  const isMissingPropertiesSchema =
    propertyListErrorMessage.includes('properties') &&
    (propertyListErrorMessage.includes('does not exist') || propertyListErrorMessage.includes('schema cache'));

  const getGridClasses = () => {
    if (isMobile) return 'grid-cols-1';
    switch (gridCols) {
      case '2': return 'grid-cols-1 sm:grid-cols-2';
      case '3': return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';
      default: return 'grid-cols-1 sm:grid-cols-2';
    }
  };

  const updateFilter = (field: keyof PropertyFilters, value: string) => {
    setActiveKpiFilter('total');
    setFilters((current) => ({
      ...current,
      [field]: value && value !== ALL_FILTER_VALUE ? value : undefined,
    }));
  };

  const clearFilters = () => {
    setSearch('');
    setFilters({});
    setActiveKpiFilter('total');
  };

  const applyKpiFilter = (filter: KpiFilter) => {
    setActiveKpiFilter(filter);
    setFilters((current) => {
      const next: PropertyFilters = {
        ...current,
        status: undefined,
        tipo_de_negocio: undefined,
        published_on_site: undefined,
      };

      if (filter === 'sale') next.tipo_de_negocio = 'Venda';
      if (filter === 'rental') next.tipo_de_negocio = 'Aluguel';
      if (filter === 'available') next.status = 'ativo';
      if (filter === 'reserved') next.status = 'reservado';
      if (filter === 'sold') next.status = 'vendido';
      if (filter === 'rented') next.status = 'alugado';
      if (filter === 'private') next.published_on_site = 'false';

      return next;
    });
  };

  const activeFilterCount = Object.values(filters).filter(Boolean).length + (search.trim() ? 1 : 0);

  if (isLoading && !data) {
    return (
      <AppLayout title="Imóveis">
        <div className="grid min-h-[360px] place-items-center">
          <div className="app-card flex w-full max-w-md flex-col items-center justify-center p-8 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
              <Building2 className="h-6 w-6 text-primary" />
            </div>
            <h2 className="text-lg font-semibold">Carregando carteira de imóveis</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Estamos buscando os imóveis cadastrados da sua organização.
            </p>
            <Loader2 className="mt-5 h-5 w-5 animate-spin text-primary" />
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Imóveis">
      <div className="space-y-4 sm:space-y-6 animate-in">
        {/* Header */}
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div data-tour="properties-stats" className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
            {[
              { key: 'total' as const, label: 'Total', value: stats.total },
              { key: 'sale' as const, label: 'À venda', value: stats.venda },
              { key: 'rental' as const, label: 'Locação', value: stats.locacao },
              { key: 'available' as const, label: 'Disponíveis', value: stats.disponiveis },
              { key: 'reserved' as const, label: 'Reservados', value: stats.reservados },
              { key: 'sold' as const, label: 'Vendidos', value: stats.vendidos },
              { key: 'rented' as const, label: 'Alugados', value: stats.alugados },
              { key: 'private' as const, label: 'Privados', value: stats.privados },
            ].map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => applyKpiFilter(item.key)}
                className={cn(
                  "h-11 min-w-[92px] shrink-0 rounded-md border-0 bg-[var(--app-surface-soft)] px-3 text-left transition-colors hover:bg-[var(--app-surface-hover)]",
                  activeKpiFilter === item.key && "bg-primary/10 text-primary"
                )}
              >
                <span className="block text-base font-semibold leading-none">{item.value}</span>
                <span className="mt-1 block truncate text-[11px] leading-none text-muted-foreground">{item.label}</span>
              </button>
            ))}
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <Button
              data-tour="properties-filter-button"
              type="button"
              variant="ghost"
              onClick={() => setFiltersOpen((open) => !open)}
              className={cn(
                "h-10 gap-2 border-0 bg-[var(--app-surface-soft)] px-3 text-xs font-semibold uppercase tracking-normal text-foreground hover:bg-[var(--app-surface-hover)]",
                filtersOpen && "bg-[var(--app-surface-hover)] text-primary"
              )}
            >
              {isFilterUpdating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <SlidersHorizontal className="h-4 w-4" />
              )}
              {activeFilterCount > 0 ? `Filtros (${activeFilterCount})` : 'Filtros'}
            </Button>
            {activeFilterCount > 0 && (
              <Button
                type="button"
                variant="ghost"
                onClick={clearFilters}
                className="h-10 border-0 bg-[var(--app-surface-soft)] px-3 text-xs font-semibold text-muted-foreground hover:bg-[var(--app-surface-hover)] hover:text-foreground"
              >
                <X className="h-4 w-4" />
                Limpar
              </Button>
            )}

            {!isMobile && (
              <div className="flex items-center gap-2">
                <LayoutGrid className="h-4 w-4 text-muted-foreground" />
                <Select value={gridCols} onValueChange={setGridCols}>
                  <SelectTrigger className="w-16 border-0 bg-[var(--app-surface-soft)]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GRID_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <Button data-tour="properties-new-button" onClick={() => router.push('/properties/new')} className="flex-1 sm:flex-none">
              <Plus className="h-4 w-4 mr-2" />
              {isMobile ? 'Novo' : 'Novo Imóvel'}
            </Button>
          </div>
        </div>

        {filtersOpen && (
          <div className="relative z-[90] h-0">
            <section
              data-tour="properties-filters-panel"
              aria-label="Filtros dos imóveis"
              className="absolute right-0 top-2 flex max-h-[calc(100dvh-280px)] w-[min(720px,calc(100vw-24px))] max-w-full flex-col overflow-hidden rounded-[8px] border border-white/[0.055] bg-[var(--app-surface-solid)] shadow-[0_18px_50px_rgba(0,0,0,0.22)] sm:max-h-[min(620px,calc(100dvh-132px))]"
            >
              <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <SlidersHorizontal className="h-4 w-4 text-primary" />
                  Filtros
                </h2>
              </div>
              {activeFilterCount > 0 && (
                <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
                  Limpar
                </Button>
              )}
              {isFilterUpdating && (
                <span className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  Atualizando
                </span>
              )}
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-4">
              <div className="space-y-2">
                <Label>Pesquisar</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Código, título, bairro..."
                    className="pl-9 pr-9"
                  />
                  {isFetching && !isFetchingNextPage && (
                    <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <div className="space-y-2">
                  <Label>Modalidade</Label>
                  <Select value={filters.tipo_de_negocio || ALL_FILTER_VALUE} onValueChange={(value) => updateFilter('tipo_de_negocio', value)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_FILTER_VALUE}>Todas</SelectItem>
                      <SelectItem value="Venda">Venda</SelectItem>
                      <SelectItem value="Aluguel">Locação</SelectItem>
                      <SelectItem value="Venda e Aluguel">Venda e Locação</SelectItem>
                      <SelectItem value="Temporada">Temporada</SelectItem>
                      <SelectItem value="Lançamento">Lançamento</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select value={filters.status || ALL_FILTER_VALUE} onValueChange={(value) => updateFilter('status', value)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_FILTER_VALUE}>Todos</SelectItem>
                      <SelectItem value="ativo">Disponíveis</SelectItem>
                      <SelectItem value="reservado">Reservados</SelectItem>
                      <SelectItem value="vendido">Vendidos</SelectItem>
                      <SelectItem value="alugado">Alugados</SelectItem>
                      <SelectItem value="inativo">Inativos</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Tipo</Label>
                  <Select value={filters.tipo_de_imovel || ALL_FILTER_VALUE} onValueChange={(value) => updateFilter('tipo_de_imovel', value)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_FILTER_VALUE}>Todos</SelectItem>
                      {propertyTypes.map((type) => (
                        <SelectItem key={type} value={type}>{type}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Responsável</Label>
                  <Select value={filters.responsavel_id || ALL_FILTER_VALUE} onValueChange={(value) => updateFilter('responsavel_id', value)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_FILTER_VALUE}>Todos</SelectItem>
                      {users.map((user) => (
                        <SelectItem key={user.id} value={user.id}>{user.name || user.email}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Permuta</Label>
                  <Select value={filters.aceita_permuta || ALL_FILTER_VALUE} onValueChange={(value) => updateFilter('aceita_permuta', value)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_FILTER_VALUE}>Todos</SelectItem>
                      <SelectItem value="true">Aceita permuta</SelectItem>
                      <SelectItem value="false">Não aceita permuta</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Cidade</Label>
                  <Input value={filters.cidade || ''} onChange={(event) => updateFilter('cidade', event.target.value)} placeholder="Cidade" />
                </div>

                <div className="space-y-2">
                  <Label>Bairro</Label>
                  <Input value={filters.bairro || ''} onChange={(event) => updateFilter('bairro', event.target.value)} placeholder="Bairro" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
                <div className="space-y-2">
                  <Label>Quartos</Label>
                  <Input value={filters.quartos_min || ''} onChange={(event) => updateFilter('quartos_min', event.target.value)} inputMode="numeric" placeholder="0" />
                </div>
                <div className="space-y-2">
                  <Label>Suítes</Label>
                  <Input value={filters.suites_min || ''} onChange={(event) => updateFilter('suites_min', event.target.value)} inputMode="numeric" placeholder="0" />
                </div>
                <div className="space-y-2">
                  <Label>Banhos</Label>
                  <Input value={filters.banheiros_min || ''} onChange={(event) => updateFilter('banheiros_min', event.target.value)} inputMode="numeric" placeholder="0" />
                </div>
                <div className="space-y-2">
                  <Label>Valor mín.</Label>
                  <Input value={filters.valor_min || ''} onChange={(event) => updateFilter('valor_min', event.target.value)} inputMode="numeric" placeholder="R$" />
                </div>
                <div className="space-y-2">
                  <Label>Valor máx.</Label>
                  <Input value={filters.valor_max || ''} onChange={(event) => updateFilter('valor_max', event.target.value)} inputMode="numeric" placeholder="R$" />
                </div>
              </div>
            </div>
            </section>
          </div>
        )}

        <div data-tour="properties-list" className="space-y-4">
            {isListUpdating && (
              <div className="app-card-soft flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                Atualizando imóveis...
              </div>
            )}
            {error && isMissingPropertiesSchema && (
              <div className="app-card-soft flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 text-primary" />
                  <div>
                    <h2 className="text-sm font-semibold">Carteira aguardando configuração</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      A estrutura de imóveis ainda precisa ser criada no Supabase para ativar listagem e cadastro reais.
                    </p>
                  </div>
                </div>
                <Button variant="outline" onClick={() => refetch()} className="shrink-0">
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Tentar novamente
                </Button>
              </div>
            )}

            {/* Empty State */}
            {properties.length === 0 && (
              <Card className="app-card">
                <CardContent className="py-12 text-center">
                  <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-[var(--app-surface-soft)]">
                    <Building2 className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="font-medium mb-2">
                    {activeFilterCount > 0 ? 'Nenhum imóvel encontrado' : 'Nenhum imóvel cadastrado'}
                  </h3>
                  <p className="text-muted-foreground mb-4">
                    {activeFilterCount > 0
                      ? 'Ajuste os filtros para ampliar a busca.'
                      : 'Cadastre seu primeiro imóvel para começar'}
                  </p>
                  {activeFilterCount > 0 ? (
                    <Button variant="outline" onClick={clearFilters}>
                      <X className="h-4 w-4 mr-2" />
                      Limpar filtros
                    </Button>
                  ) : (
                    <Button onClick={() => router.push('/properties/new')}>
                      <Plus className="h-4 w-4 mr-2" />
                      Cadastrar imóvel
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Properties Grid */}
            <div className={`grid ${getGridClasses()} gap-4`}>
              {properties.map((property) => {
                const propertyWithOwner = property as PropertyWithCreator;
                const activeUserId = profile?.id;
                const ownerIds = [
                  propertyWithOwner.cadastrado_por,
                  propertyWithOwner.created_by,
                  propertyWithOwner.responsible_user_id,
                ].filter(Boolean);
                const canEditProperty =
                  isAdmin ||
                  organization?.property_edit_policy === 'everyone' ||
                  (!!activeUserId && ownerIds.includes(activeUserId));
                return (
                  <PropertyCard
                    key={property.id}
                    property={property}
                    onEdit={openEdit}
                    onDelete={handleDelete}
                    onChangeStatus={handleChangeStatus}
                    onToggleVisibility={handleToggleVisibility}
                    onPreview={(p) => {
                      setPreviewProperty(p);
                      setPreviewOpen(true);
                    }}
                    onHistory={(p) => {
                      setHistoryProperty(p);
                      setHistoryOpen(true);
                    }}
                    formatPrice={formatPrice}
                    canEdit={canEditProperty}
                    siteInfo={siteInfo}
                  />
                );
              })}
            </div>

            {/* Load More */}
            {hasNextPage && (
              <div className="flex justify-center py-8">
                <Button
                  variant="outline"
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className="min-w-[200px]"
                >
                  {isFetchingNextPage ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Carregando...
                    </>
                  ) : (
                    'Carregar mais imóveis'
                  )}
                </Button>
              </div>
            )}
          </div>

        {/* Preview Dialog */}
        <PropertyPreviewDialog
          property={previewProperty}
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          formatPrice={formatPrice}
        />
        <PropertyHistoryDialog
          property={historyProperty}
          open={historyOpen}
          onOpenChange={setHistoryOpen}
        />
      </div>
    </AppLayout>
  );
}
