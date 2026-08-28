"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppLayout } from '@/components/shared/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  AlertTriangle,
  Search,
  Loader2,
  Home,
  Building2
} from 'lucide-react';
import { useDeleteProperty, useInfiniteProperties, useUpdateProperty, Property } from '@/hooks/use-properties';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { PropertyCard } from '@/components/features/properties/PropertyCard';
import { PropertyPreviewDialog } from '@/components/features/properties/PropertyPreviewDialog';
import { getPropertySiteInfo } from '@/lib/api/property-support';
import { canDeleteProperties, canEditPropertyDetails, canUpdatePropertyAvailability } from '@/lib/access/properties';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';

const RENTAL_PAGE_SIZE = 24;

const formatPrice = (value: number | null, tipo: string | null) => {
  if (!value) return 'Preço não informado';
  const formatted = `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const normalized = (tipo || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (normalized === 'aluguel' || normalized === 'locacao' || normalized === 'venda e aluguel' || normalized === 'venda e locacao' || normalized === 'temporada') {
    return `${formatted}/mês`;
  }
  return formatted;
};

type PropertyWithCreator = Property & {
  cadastrado_por?: string | null;
  created_by?: string | null;
  responsible_user_id?: string | null;
};

export default function PropertyRentals() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [previewProperty, setPreviewProperty] = useState<Property | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const { profile, organization, tenantContext, isSuperAdmin } = useAuth();
  const organizationId = organization?.id || profile?.organization_id;
  const propertyAccessContext = {
    userId: profile?.id,
    organizationId,
    isSuperAdmin,
    memberRole: tenantContext?.memberRole,
    permissions: tenantContext?.permissions,
  };
  const canUpdateAvailability = canUpdatePropertyAvailability(propertyAccessContext);
  const canDeleteProperty = canDeleteProperties(propertyAccessContext);
  const updateProperty = useUpdateProperty();
  const deleteProperty = useDeleteProperty();

  const debouncedSearch = useDebouncedValue(search, 300);
  const annualRentalsQuery = useInfiniteProperties(
    debouncedSearch,
    RENTAL_PAGE_SIZE,
    { tipo_de_negocio: 'locacao' },
  );
  const seasonalRentalsQuery = useInfiniteProperties(
    debouncedSearch,
    RENTAL_PAGE_SIZE,
    { tipo_de_negocio: 'temporada' },
  );
  const { data: siteInfo = null } = useQuery({
    queryKey: ['org-site-info', organizationId],
    queryFn: async () => getPropertySiteInfo(organizationId),
    enabled: !!organizationId,
    staleTime: 1000 * 60 * 5,
  });

  const annualProperties = annualRentalsQuery.data?.pages.flatMap((page) => page.properties) ?? [];
  const seasonalProperties = seasonalRentalsQuery.data?.pages.flatMap((page) => page.properties) ?? [];
  const properties = Array.from(
    new Map([...annualProperties, ...seasonalProperties].map((property) => [property.id, property])).values(),
  );
  const totalProperties =
    (annualRentalsQuery.data?.pages[0]?.totalCount ?? annualProperties.length) +
    (seasonalRentalsQuery.data?.pages[0]?.totalCount ?? seasonalProperties.length);
  const rentalsLoading = annualRentalsQuery.isLoading || seasonalRentalsQuery.isLoading;
  const rentalsInitialError =
    properties.length === 0 && (annualRentalsQuery.isError || seasonalRentalsQuery.isError);
  const rentalsPartialError =
    !rentalsInitialError && (annualRentalsQuery.isError || seasonalRentalsQuery.isError);
  const rentalsHasNextPage = annualRentalsQuery.hasNextPage || seasonalRentalsQuery.hasNextPage;
  const rentalsNextPageError =
    annualRentalsQuery.isFetchNextPageError || seasonalRentalsQuery.isFetchNextPageError;
  const rentalsFetchingNextPage =
    annualRentalsQuery.isFetchingNextPage || seasonalRentalsQuery.isFetchingNextPage;

  const stats = {
    total: totalProperties,
    ativos: properties.filter(p => p.status === 'ativo').length,
    destaque: properties.filter(p => p.destaque).length,
  };

  const handleOpenPublication = (id: string) => {
    router.push(`/properties/${id}?tab=publication`);
  };

  const handleChangeStatus = async (id: string, status: 'ativo' | 'reservado' | 'vendido' | 'alugado') => {
    try {
      await updateProperty.mutateAsync({ id, status });
    } catch {
      // The mutation hook reports the error without leaking an unhandled rejection.
    }
  };

  if (rentalsLoading) {
    return (
      <AppLayout title="Imóveis para Aluguel">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Imóveis para Aluguel">
      <div className="space-y-4 animate-in">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar imóveis para aluguel..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        {/* Stats */}
        {!rentalsInitialError ? <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Card className="app-card rounded-[8px] border-0 shadow-none">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-[6px] bg-primary/10 flex items-center justify-center">
                <Home className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-normal">{stats.total}</p>
                <p className="text-sm font-light text-muted-foreground">Total para aluguel</p>
              </div>
            </CardContent>
          </Card>
          <Card className="app-card rounded-[8px] border-0 shadow-none">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-[6px] bg-success/10 flex items-center justify-center">
                <Building2 className="h-5 w-5 text-success" />
              </div>
              <div>
                <p className="text-2xl font-normal">{stats.ativos}</p>
                <p className="text-sm font-light text-muted-foreground">Ativos carregados</p>
              </div>
            </CardContent>
          </Card>
          <Card className="app-card rounded-[8px] border-0 shadow-none">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-[6px] bg-warning/10 flex items-center justify-center">
                <Building2 className="h-5 w-5 text-warning" />
              </div>
              <div>
                <p className="text-2xl font-normal">{stats.destaque}</p>
                <p className="text-sm font-light text-muted-foreground">Destaques carregados</p>
              </div>
            </CardContent>
          </Card>
        </div> : null}

        {rentalsInitialError ? (
          <Card className="app-card rounded-[8px] border-0 shadow-none">
            <CardContent className="flex min-h-52 flex-col items-center justify-center px-4 py-8 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-[6px] bg-destructive/10 text-destructive">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              </span>
              <h3 className="mt-3 text-sm font-normal">Não foi possível carregar os imóveis para aluguel</h3>
              <p className="mt-1 text-xs font-light text-muted-foreground">Verifique sua conexão e tente novamente.</p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void Promise.allSettled([
                  annualRentalsQuery.refetch(),
                  seasonalRentalsQuery.refetch(),
                ])}
                disabled={annualRentalsQuery.isFetching || seasonalRentalsQuery.isFetching}
                className="mt-4 h-8 rounded-[6px] bg-[var(--app-surface-soft)] px-3 text-xs font-light shadow-none"
              >
                {annualRentalsQuery.isFetching || seasonalRentalsQuery.isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
                Tentar novamente
              </Button>
            </CardContent>
          </Card>
        ) : properties.length === 0 ? (
          <Card className="app-card rounded-[8px] border-0 shadow-none">
            <CardContent className="py-12 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-[8px] bg-[var(--app-surface-soft)]">
                <Home className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="mb-2 text-sm font-normal">Nenhum imóvel para aluguel</h3>
              <p className="text-sm font-light text-muted-foreground">
                Cadastre imóveis com tipo de negócio &quot;Aluguel&quot; para vê-los aqui
              </p>
            </CardContent>
          </Card>
        ) : null}

        {rentalsPartialError ? (
          <div className="flex items-center gap-2 rounded-[6px] bg-destructive/10 px-3 py-2 text-xs font-light text-destructive" role="status">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Parte do catálogo não pôde ser atualizada. Os imóveis disponíveis continuam visíveis.
          </div>
        ) : null}

        {/* Properties Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {properties.map((property) => {
            const propertyWithOwner = property as PropertyWithCreator;

            return (
              <PropertyCard
                key={property.id}
                property={property}
                onEdit={(item) => router.push(`/properties/${item.id}/edit`)}
                onDelete={(id) => deleteProperty.mutate(id)}
                onPreview={(p) => {
                  setPreviewProperty(p);
                  setPreviewOpen(true);
                }}
                onChangeStatus={handleChangeStatus}
                onOpenPublication={handleOpenPublication}
                formatPrice={formatPrice}
                canEdit={canEditPropertyDetails({
                  ...propertyAccessContext,
                  ownerIds: [
                    propertyWithOwner.cadastrado_por,
                    propertyWithOwner.created_by,
                    propertyWithOwner.responsible_user_id,
                  ],
                })}
                canUpdateAvailability={canUpdateAvailability}
                canDelete={canDeleteProperty}
                siteInfo={siteInfo}
              />
            );
          })}
        </div>

        {properties.length > 0 && (rentalsHasNextPage || rentalsNextPageError) ? (
          <div className="flex flex-col items-center gap-2 py-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void Promise.allSettled([
                ...(annualRentalsQuery.hasNextPage || annualRentalsQuery.isFetchNextPageError
                  ? [annualRentalsQuery.fetchNextPage()]
                  : []),
                ...(seasonalRentalsQuery.hasNextPage || seasonalRentalsQuery.isFetchNextPageError
                  ? [seasonalRentalsQuery.fetchNextPage()]
                  : []),
              ])}
              disabled={rentalsFetchingNextPage}
              className="h-8 rounded-[6px] bg-[var(--app-surface-soft)] px-3 text-xs font-light shadow-none"
            >
              {rentalsFetchingNextPage ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
              {rentalsFetchingNextPage
                ? 'Carregando...'
                : rentalsNextPageError
                  ? 'Tentar carregar mais'
                  : 'Carregar mais imóveis'}
            </Button>
            {rentalsNextPageError ? (
              <p className="text-xs font-light text-destructive" role="status">
                Não foi possível carregar a próxima página.
              </p>
            ) : null}
          </div>
        ) : null}

        {/* Preview Dialog */}
        <PropertyPreviewDialog
          property={previewProperty}
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          formatPrice={formatPrice}
          siteInfo={siteInfo}
          canUpdateAvailability={canUpdateAvailability}
        />
      </div>
    </AppLayout>
  );
}
