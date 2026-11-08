import { useState } from 'react';
import NextImage from 'next/image';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Building2, Search, SlidersHorizontal, ChevronRight, ExternalLink, Clock, CheckCircle, KeyRound, Loader2, type LucideIcon } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { getPropertySiteInfo } from '@/lib/api/property-support';
import { buildPropertySiteUrl } from '@/lib/property-site-url';
import { getSafePropertyImageSource } from '@/lib/property-media';
import { formatPropertyCurrency } from '@/lib/property-display-utils';
import { toast } from 'sonner';
import { useOrganizationModules } from '@/hooks/use-organization-modules';
import { useUserPermissions } from '@/hooks/use-user-permissions';
import { VimobAPIError } from '@/lib/api/vimob-error';
import { useProperty } from '@/hooks/use-properties';
import { usePropertyPickerSearch } from '@/hooks/properties/use-property-picker-search';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { usePropertyTypes } from '@/hooks/use-property-types';
import { usePropertyCities, usePropertyNeighborhoods } from '@/hooks/use-property-locations';
import { getPropertyCatalogLocationId } from '@/lib/validation/property-filter-input';
import formFieldStyles from './property-form/property-form-fields.module.css';

export interface PropertyPickerProperty {
  id: string;
  code?: string | null;
  title?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  preco?: number | null;
  imagem_principal?: string | null;
  tipo_de_imovel?: string | null;
  tipo_de_negocio?: string | null;
  commission_percentage?: number | null;
  status?: string | null;
  updated_at?: string | null;
}

interface PropertyPickerDialogProps {
  properties: PropertyPickerProperty[];
  selectedPropertyId?: string | null;
  onSelect: (property: PropertyPickerProperty) => void;
  trigger?: React.ReactNode;
  disabled?: boolean;
  isLoading?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSearchChange?: (search: string) => void;
  getBlockedReason?: (property: PropertyPickerProperty) => string | null;
}

type PropertyStatusBadge = {
  label: string;
  className: string;
  icon: LucideIcon;
};

function normalizePropertyStatus(status?: string | null) {
  return (status || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function getPropertyStatusBadge(status?: string | null): PropertyStatusBadge | null {
  switch (normalizePropertyStatus(status)) {
    case 'reservado':
    case 'reserved':
      return {
        label: 'Reservado',
        className: 'bg-[var(--app-surface-solid)] text-warning',
        icon: Clock,
      };
    case 'vendido':
    case 'sold':
      return {
        label: 'Vendido',
        className: 'bg-[var(--app-surface-solid)] text-[var(--app-text-primary)]',
        icon: CheckCircle,
      };
    case 'alugado':
    case 'locado':
    case 'rented':
      return {
        label: 'Alugado',
        className: 'bg-[var(--app-surface-solid)] text-[var(--app-text-primary)]',
        icon: KeyRound,
      };
    default:
      return null;
  }
}

function getSelectionBlockedMessage(status?: string | null) {
  switch (normalizePropertyStatus(status)) {
    case 'vendido':
    case 'sold':
      return 'Imovel vendido nao pode ser selecionado.';
    case 'alugado':
    case 'locado':
    case 'rented':
      return 'Imovel alugado nao pode ser selecionado.';
    default:
      return null;
  }
}

export function PropertyPickerDialog({
  selectedPropertyId,
  onSelect,
  trigger,
  disabled = false,
  isLoading = false,
  open: controlledOpen,
  onOpenChange,
  onSearchChange,
  getBlockedReason,
}: PropertyPickerDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [filterType, setFilterType] = useState('');
  const [filterPurpose, setFilterPurpose] = useState('');
  const [filterLocation, setFilterLocation] = useState('');
  const { user, activeOrganization } = useAuth();
  const { hasModule } = useOrganizationModules();
  const { hasPermission, isLoading: permissionsLoading } = useUserPermissions();
  const hasPropertiesModule = hasModule('properties');
  const organizationId = activeOrganization.organizationId;
  const accessLoading = permissionsLoading || activeOrganization.status !== 'ready';
  const canReadProperties = Boolean(user?.id && organizationId && !accessLoading && hasPropertiesModule
    && (hasPermission('property_view') || hasPermission('property_manage')));
  const { data: persistedProperty } = useProperty(canReadProperties ? selectedPropertyId || null : null);
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const { data: propertyTypes = [] } = usePropertyTypes({ enabled: open && canReadProperties && !disabled });
  const { data: cities = [] } = usePropertyCities({ enabled: open && canReadProperties && !disabled });
  const { data: neighborhoods = [] } = usePropertyNeighborhoods(undefined, { enabled: open && canReadProperties && !disabled });
  const locationOptions = [
    ...cities.map(city => ({ value: `city:${city.id}`, label: `${city.name}${city.uf ? ` (${city.uf})` : ''}`, cidade: city.name, uf: city.uf || undefined, city_id: getPropertyCatalogLocationId(city), bairro: undefined as string | undefined, neighborhood_id: undefined as string | undefined })),
    ...neighborhoods.map(item => ({ value: `neighborhood:${item.id}`, label: [item.name, item.city?.name, item.city?.uf].filter(Boolean).join(', '), cidade: item.city?.name, uf: item.city?.uf || undefined, city_id: getPropertyCatalogLocationId(item.city), bairro: item.name, neighborhood_id: getPropertyCatalogLocationId(item) })),
  ];
  const selectedLocation = locationOptions.find(item => item.value === filterLocation);
  const activeFilterCount = [filterType, filterPurpose, selectedLocation].filter(Boolean).length;
  const remoteProperties = usePropertyPickerSearch({ search: debouncedSearch, filters: {
    tipo_de_imovel: filterType || undefined,
    tipo_de_negocio: filterPurpose || undefined,
    cidade: selectedLocation?.cidade, bairro: selectedLocation?.bairro,
    city_id: selectedLocation?.city_id, neighborhood_id: selectedLocation?.neighborhood_id, uf: selectedLocation?.uf,
  }, enabled: open && canReadProperties && !disabled });
  const pickerUpdating = remoteProperties.isFetching || search.trim() !== debouncedSearch;
  const pickerLoading = isLoading || remoteProperties.isLoading || pickerUpdating;

  const { data: siteInfo } = useQuery({
    queryKey: ['org-site-info', organizationId],
    queryFn: async () => {
      if (!organizationId) return null;
      return getPropertySiteInfo(organizationId);
    },
    enabled: canReadProperties && open && !disabled,
  });

  const filteredProperties = remoteProperties.isError ? [] : remoteProperties.properties;
  // The current scoped lookup is authoritative; caller snapshots can belong to
  // an organization that was active before a tenant transition.
  const selectedProperty = canReadProperties ? persistedProperty || filteredProperties.find(p => p.id === selectedPropertyId) : null;
  const pickerError = remoteProperties.error instanceof VimobAPIError && remoteProperties.error.status === 403
    ? 'Seu acesso aos imóveis não foi autorizado. Confira as permissões e tente novamente.'
    : 'Não foi possível carregar os imóveis. Tente novamente.';

  const handleOpen = () => {
    if (disabled || !canReadProperties) return;
    setSearch('');
    onSearchChange?.('');
    setFilterType('');
    setFilterPurpose('');
    setFilterLocation('');
    setShowFilters(false);
    if (controlledOpen === undefined) setInternalOpen(true);
    onOpenChange?.(true);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  const getDisplayLabel = () => {
    if (!selectedProperty) return 'Selecionar imóvel';
    const code = selectedProperty.code || '';
    const title = selectedProperty.title || 'Sem título';
    const full = code ? `${code} - ${title}` : title;
    return full.length > (code.length + 13) ? full.slice(0, code.length + 13) + '...' : full;
  };

  if (!hasPropertiesModule) return null;
  if (!canReadProperties) return accessLoading ? (
    <Button variant="ghost" className="h-10 w-full justify-start text-xs text-muted-foreground" disabled>
      Carregando acesso aos imóveis...
    </Button>
  ) : null;

  return (
    <>
      {trigger ? (
        <div onClick={handleOpen} aria-disabled={disabled}>{trigger}</div>
      ) : (
        <Button
          variant="ghost"
          className="h-10 w-full justify-between rounded-[8px] border-0 bg-[var(--app-surface-soft)] px-3 text-xs text-[var(--app-text-secondary)] shadow-none hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]"
          onClick={handleOpen}
          disabled={disabled}
        >
          <div className="flex items-center gap-2 min-w-0">
            <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="truncate">{getDisplayLabel()}</span>
          </div>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        </Button>
      )}

      <Dialog open={open && !disabled} onOpenChange={handleOpenChange}>
        <DialogContent className={cn("flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-4xl flex-col overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-0 text-[var(--app-text-primary)] shadow-none", formFieldStyles.surface)}>
          <div className="flex flex-col gap-3 border-b border-[var(--app-border)] p-4 pr-12 sm:flex-row sm:items-center">
            <DialogTitle className="whitespace-nowrap text-sm font-normal">Selecionar imóvel</DialogTitle>
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Buscar por código, nome ou localização..."
                maxLength={120}
                aria-label="Buscar imóveis"
                className="h-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)] pl-8 text-xs font-light shadow-none focus-visible:ring-1 focus-visible:ring-primary/30"
                value={search}
                onChange={e => {
                  setSearch(e.target.value);
                  onSearchChange?.(e.target.value);
                }}
              />
            </div>
            <Button
              variant={showFilters || activeFilterCount > 0 ? 'secondary' : 'outline'}
              size="sm"
              className="h-8 shrink-0 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-xs font-light shadow-none hover:bg-[var(--app-surface-hover)]"
              onClick={() => setShowFilters(!showFilters)}
              aria-expanded={showFilters}
              aria-controls={showFilters ? "property-picker-filters" : undefined}
              aria-label={`Filtros de imóveis${activeFilterCount ? `, ${activeFilterCount} ${activeFilterCount === 1 ? 'ativo' : 'ativos'}` : ''}`}
            >
              <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" />
              Filtros
              {activeFilterCount > 0 && <Badge variant="secondary" className="ml-1.5 px-1.5 text-[10px]">{activeFilterCount}</Badge>}
            </Button>
          </div>

          {showFilters && (
            <div id="property-picker-filters" className="grid grid-cols-1 gap-2 border-b border-[var(--app-border)] bg-[var(--app-surface-soft)] px-4 py-3 sm:grid-cols-3">
              <select
                className="h-8 min-w-0 rounded-[6px] border-0 bg-[var(--app-surface)] px-3 text-xs text-foreground outline-none ring-1 ring-[var(--app-border)] focus:ring-primary"
                value={filterType}
                aria-label="Tipo de imóvel"
                onChange={e => setFilterType(e.target.value)}
              >
                <option value="">Todos os tipos</option>
                {propertyTypes.map(t => (
                  <option key={t} value={t!}>{t}</option>
                ))}
              </select>
              <select
                className="h-8 min-w-0 rounded-[6px] border-0 bg-[var(--app-surface)] px-3 text-xs text-foreground outline-none ring-1 ring-[var(--app-border)] focus:ring-primary"
                value={filterPurpose}
                aria-label="Finalidade do imóvel"
                onChange={e => setFilterPurpose(e.target.value)}
              >
                <option value="">Todas finalidades</option>
                {['Venda', 'Aluguel', 'Venda e Aluguel', 'Temporada', 'Lançamento'].map(t => (
                  <option key={t} value={t!}>{t}</option>
                ))}
              </select>
              <select
                className="h-8 min-w-0 rounded-[6px] border-0 bg-[var(--app-surface)] px-3 text-xs text-foreground outline-none ring-1 ring-[var(--app-border)] focus:ring-primary"
                value={filterLocation}
                aria-label="Localização do imóvel"
                onChange={e => setFilterLocation(e.target.value)}
              >
                <option value="">Todas localizações</option>
                {locationOptions.map(loc => (
                  <option key={loc.value} value={loc.value}>{loc.label}</option>
                ))}
              </select>
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-4 pb-4 pt-2">
            {pickerUpdating && <p role="status" className="py-2 text-[12px] text-muted-foreground">Atualizando imóveis...</p>}
            {remoteProperties.isError ? (
              <div role="alert" className="space-y-2 py-6 text-[12px] text-muted-foreground">
                <p>{pickerError}</p>
                <Button variant="ghost" size="sm" disabled={pickerUpdating} onClick={() => void remoteProperties.refetch()}>Tentar novamente</Button>
              </div>
            ) : filteredProperties.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                {pickerLoading ? (
                  <Loader2 className="mb-2 h-8 w-8 animate-spin opacity-60" />
                ) : (
                  <Building2 className="h-8 w-8 mb-2 opacity-40" />
                )}
                <p className="text-xs font-light">{pickerLoading ? 'Carregando imóveis...' : 'Nenhum imóvel encontrado'}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {filteredProperties.map(p => {
                  const statusBadge = getPropertyStatusBadge(p.status);
                  const StatusIcon = statusBadge?.icon;
                  const blockedMessage = getBlockedReason
                    ? getBlockedReason(p)
                    : getSelectionBlockedMessage(p.status);
                  const imageSource = getSafePropertyImageSource(p.imagem_principal);

                  return (
                    <div
                      key={p.id}
                      role="button"
                      tabIndex={blockedMessage ? -1 : 0}
                      aria-label={`Selecionar ${p.code ? `${p.code} - ` : ''}${p.title || 'imóvel'}`}
                      aria-pressed={selectedPropertyId === p.id}
                      className={cn(
                        'flex flex-col overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-soft)] text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40',
                        blockedMessage
                          ? 'cursor-not-allowed opacity-75'
                          : 'cursor-pointer hover:bg-[var(--app-surface-hover)]',
                        selectedPropertyId === p.id && 'ring-1 ring-primary'
                      )}
                      aria-disabled={!!blockedMessage || pickerUpdating}
                      title={blockedMessage || undefined}
                      onClick={() => {
                        if (disabled || !canReadProperties || pickerUpdating) return;
                        if (blockedMessage) {
                          toast.warning(blockedMessage);
                          return;
                        }
                        onSelect(p);
                        handleOpenChange(false);
                      }}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (disabled || !canReadProperties || pickerUpdating || blockedMessage || (event.key !== 'Enter' && event.key !== ' ')) return;
                        event.preventDefault();
                        onSelect(p);
                        handleOpenChange(false);
                      }}
                    >
                      <div className="relative aspect-[4/3] bg-[var(--app-surface-soft)]">
                      {imageSource ? (
                        <NextImage
                          src={imageSource}
                          alt={p.title || 'Imóvel'}
                          fill
                          sizes="220px"
                          className="object-cover"
                          unoptimized
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Building2 className="h-6 w-6 text-muted-foreground/40" />
                        </div>
                      )}
                      {statusBadge && StatusIcon && (
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[var(--app-surface-solid)]/75">
                          <Badge className={cn('rounded-[4px] border-0 px-2.5 py-1 text-[10px] font-light shadow-none', statusBadge.className)}>
                            <StatusIcon className="h-3 w-3 mr-1" />
                            {statusBadge.label}
                          </Badge>
                        </div>
                      )}
                      {p.code && (
                        <Badge className="absolute left-1.5 top-1.5 h-4 rounded-[4px] border-0 bg-primary px-1.5 py-0 text-[9px] font-light text-primary-foreground shadow-none">
                          {p.code}
                        </Badge>
                      )}
                      {p.code && (() => {
                        const url = buildPropertySiteUrl(p.code, siteInfo);
                        return url ? (
                          <button
                            type="button"
                            aria-label={`Abrir ${p.code} no site`}
                            className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-[6px] bg-[var(--app-surface-solid)] text-primary shadow-none transition-colors hover:bg-[var(--app-surface-hover)]"
                            title="Ver no site"
                            onClick={(e) => {
                              e.stopPropagation();
                              window.open(url, '_blank', 'noopener,noreferrer');
                            }}
                          >
                            <ExternalLink className="h-3 w-3" />
                          </button>
                        ) : null;
                      })()}
                      </div>
                      <div className="p-2 space-y-0.5">
                      <p className="truncate text-[11px] font-normal">{p.title || 'Sem título'}</p>
                      {p.bairro && (
                        <p className="text-[10px] text-muted-foreground truncate">
                          {p.bairro}{p.cidade ? `, ${p.cidade}` : ''}
                        </p>
                      )}
                      {p.preco && (
                        <p className="text-[11px] font-normal text-primary">
                          {formatPropertyCurrency(Number(p.preco))}
                        </p>
                      )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          {!remoteProperties.isError && remoteProperties.hasNextPage && <Button variant="ghost" className="mx-4 mb-3 h-9" disabled={pickerUpdating} onClick={() => void remoteProperties.fetchNextPage()}>Carregar mais imóveis</Button>}
        </DialogContent>
      </Dialog>
    </>
  );
}
