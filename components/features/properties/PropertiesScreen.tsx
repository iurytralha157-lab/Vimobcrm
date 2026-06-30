"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
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
  Star,
  Building2,
  CheckCircle,
  LayoutGrid,
  AlertTriangle,
  RefreshCw,
  SlidersHorizontal,
  X
} from 'lucide-react';
import { useInfiniteProperties, useUpdateProperty, useDeleteProperty, type Property, type PropertyFilters } from '@/hooks/use-properties';
import { PropertyCard } from '@/components/features/properties/PropertyCard';
import { PropertyPreviewDialog } from '@/components/features/properties/PropertyPreviewDialog';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAuth } from '@/contexts/AuthContext';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useUsers } from '@/hooks/use-users';
import { usePropertyTypes } from '@/hooks/use-property-types';
import { cn } from '@/lib/utils';
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

type PropertyWithCreator = Property & {
  cadastrado_por?: string | null;
};

export default function Properties() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<PropertyFilters>(EMPTY_FILTERS);
  const [previewProperty, setPreviewProperty] = useState<Property | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [gridCols, setGridCols] = useState('3');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const isMobile = useIsMobile();
  const { profile, isSuperAdmin } = useAuth();
  const isAdmin = profile?.role === 'admin' || isSuperAdmin;
  const { data: users = [] } = useUsers();
  const { data: propertyTypes = [] } = usePropertyTypes();

  const debouncedSearch = useDebouncedValue(search.trim(), 350);
  const debouncedFilters = useDebouncedValue(filters, 350);

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
  const updateProperty = useUpdateProperty();
  const deleteProperty = useDeleteProperty();

  const openEdit = (property: Property) => {
    router.push(`/properties/${property.id}/edit`);
  };

  const handleDelete = async (id: string) => {
    await deleteProperty.mutateAsync(id);
  };

  const handleMarkSold = async (id: string) => {
    await updateProperty.mutateAsync({ id, status: 'vendido' });
    toast.success('Imóvel marcado como vendido!');
  };

  const handleToggleVisibility = async (id: string, isPublic: boolean) => {
    await updateProperty.mutateAsync({
      id,
      status: isPublic ? 'ativo' : 'privado'
    });
    toast.success(isPublic ? 'Imóvel agora é público!' : 'Imóvel agora é privado!');
  };

  const stats = {
    total: totalCount,
    destaque: properties.filter(p => p.destaque).length,
    vendidos: properties.filter(p => p.status === 'vendido').length,
    venda: properties.filter(p => p.tipo_de_negocio === 'Venda' && p.status !== 'vendido').length,
    aluguel: properties.filter(p => p.tipo_de_negocio === 'Aluguel').length,
  };
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
    setFilters((current) => ({
      ...current,
      [field]: value && value !== ALL_FILTER_VALUE ? value : undefined,
    }));
  };

  const clearFilters = () => {
    setSearch('');
    setFilters({});
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
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setFiltersOpen((open) => !open)}
              className={cn(
                "h-10 gap-2 border-0 bg-[var(--app-surface-soft)] px-3 text-xs font-semibold uppercase tracking-normal text-foreground hover:bg-[var(--app-surface-hover)]",
                filtersOpen && "bg-[var(--app-surface-hover)] text-primary"
              )}
            >
              <SlidersHorizontal className="h-4 w-4" />
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
          </div>
          <div className="flex gap-2 w-full sm:w-auto">
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
            <Button onClick={() => router.push('/properties/new')} className="flex-1 sm:flex-none">
              <Plus className="h-4 w-4 mr-2" />
              {isMobile ? 'Novo' : 'Novo Imóvel'}
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 sm:gap-3">
          <Card className="app-card">
            <CardContent className="min-h-[64px] p-2.5 sm:p-3 flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Building2 className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-lg sm:text-xl font-bold leading-none">{stats.total}</p>
                <p className="mt-1 text-xs text-muted-foreground truncate">Total</p>
              </div>
            </CardContent>
          </Card>
          <Card className="app-card">
            <CardContent className="min-h-[64px] p-2.5 sm:p-3 flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-lg bg-warning/10 flex items-center justify-center flex-shrink-0">
                <Star className="h-4 w-4 text-warning" />
              </div>
              <div className="min-w-0">
                <p className="text-lg sm:text-xl font-bold leading-none">{stats.destaque}</p>
                <p className="mt-1 text-xs text-muted-foreground truncate">Destaque</p>
              </div>
            </CardContent>
          </Card>
          <Card className="app-card">
            <CardContent className="min-h-[64px] p-2.5 sm:p-3 flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-lg bg-success/10 flex items-center justify-center flex-shrink-0">
                <CheckCircle className="h-4 w-4 text-success" />
              </div>
              <div className="min-w-0">
                <p className="text-lg sm:text-xl font-bold leading-none">{stats.vendidos}</p>
                <p className="mt-1 text-xs text-muted-foreground truncate">Vendidos</p>
              </div>
            </CardContent>
          </Card>
          <Card className="app-card">
            <CardContent className="min-h-[64px] p-2.5 sm:p-3 flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-lg bg-chart-1/10 flex items-center justify-center flex-shrink-0">
                <Building2 className="h-4 w-4 text-chart-1" />
              </div>
              <div className="min-w-0">
                <p className="text-lg sm:text-xl font-bold leading-none">{stats.venda}</p>
                <p className="mt-1 text-xs text-muted-foreground truncate">À venda</p>
              </div>
            </CardContent>
          </Card>
          <Card className="app-card col-span-2 sm:col-span-1">
            <CardContent className="min-h-[64px] p-2.5 sm:p-3 flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-lg bg-chart-2/10 flex items-center justify-center flex-shrink-0">
                <Building2 className="h-4 w-4 text-chart-2" />
              </div>
              <div className="min-w-0">
                <p className="text-lg sm:text-xl font-bold leading-none">{stats.aluguel}</p>
                <p className="mt-1 text-xs text-muted-foreground truncate">Aluguel</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {filtersOpen && (
          <section className="app-card p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <SlidersHorizontal className="h-4 w-4 text-primary" />
                  Filtros
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">Refine a carteira sem sair da página.</p>
              </div>
              {activeFilterCount > 0 && (
                <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
                  Limpar
                </Button>
              )}
            </div>

            <div className="space-y-4">
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
        )}

        <div className="space-y-4">
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
                const propertyCreatorId = (property as PropertyWithCreator).cadastrado_por;
                const canEditProperty = isAdmin || propertyCreatorId === profile?.id;
                return (
                  <PropertyCard
                    key={property.id}
                    property={property}
                    onEdit={openEdit}
                    onDelete={handleDelete}
                    onMarkSold={handleMarkSold}
                    onToggleVisibility={handleToggleVisibility}
                    onPreview={(p) => {
                      setPreviewProperty(p);
                      setPreviewOpen(true);
                    }}
                    formatPrice={formatPrice}
                    canEdit={canEditProperty}
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
      </div>
    </AppLayout>
  );
}
