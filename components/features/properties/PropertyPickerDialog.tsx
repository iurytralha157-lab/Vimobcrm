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
import { toast } from 'sonner';
import { normalizeSearchText, searchTextIncludes } from '@/lib/search-text';
import { useOrganizationModules } from '@/hooks/use-organization-modules';

interface Property {
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
}

interface PropertyPickerDialogProps {
  properties: Property[];
  selectedPropertyId?: string | null;
  onSelect: (property: Property) => void;
  trigger?: React.ReactNode;
  disabled?: boolean;
  isLoading?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSearchChange?: (search: string) => void;
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
        className: 'bg-amber-950/75 text-white dark:bg-amber-200/90 dark:text-amber-950',
        icon: Clock,
      };
    case 'vendido':
    case 'sold':
      return {
        label: 'Vendido',
        className: 'bg-zinc-900/75 text-white dark:bg-zinc-100/85 dark:text-zinc-950',
        icon: CheckCircle,
      };
    case 'alugado':
    case 'locado':
    case 'rented':
      return {
        label: 'Alugado',
        className: 'bg-sky-950/75 text-white dark:bg-sky-200/85 dark:text-sky-950',
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
  properties,
  selectedPropertyId,
  onSelect,
  trigger,
  disabled = false,
  isLoading = false,
  onOpenChange,
  onSearchChange,
}: PropertyPickerDialogProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [filterType, setFilterType] = useState('');
  const [filterPurpose, setFilterPurpose] = useState('');
  const [filterLocation, setFilterLocation] = useState('');
  const { profile, organization } = useAuth();
  const { hasModule } = useOrganizationModules();
  const hasPropertiesModule = hasModule('properties');
  const organizationId = organization?.id || profile?.organization_id;

  const { data: siteInfo } = useQuery({
    queryKey: ['org-site-info', organizationId],
    queryFn: async () => {
      if (!organizationId) return null;
      return getPropertySiteInfo(organizationId);
    },
    enabled: !!organizationId && hasPropertiesModule && open,
  });

  const selectedProperty = (properties || []).find(p => p.id === selectedPropertyId);

  const filteredProperties = (properties || []).filter(p => {
    const s = normalizeSearchText(search);
    if (s && !(
      searchTextIncludes(p.code, s) ||
      searchTextIncludes(p.title, s) ||
      searchTextIncludes(p.bairro, s)
    )) return false;
    if (filterType && p.tipo_de_imovel !== filterType) return false;
    if (filterPurpose && p.tipo_de_negocio !== filterPurpose) return false;
    if (filterLocation) {
      const loc = [p.bairro, p.cidade].filter(Boolean).join(', ');
      if (loc !== filterLocation) return false;
    }
    return true;
  });

  const handleOpen = () => {
    if (disabled) return;
    setSearch('');
    onSearchChange?.('');
    setFilterType('');
    setFilterPurpose('');
    setFilterLocation('');
    setShowFilters(false);
    setOpen(true);
    onOpenChange?.(true);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
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

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-4xl flex-col overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-0 text-[var(--app-text-primary)] shadow-none">
          <div className="flex flex-col gap-3 border-b border-[var(--app-border)] p-4 pr-12 sm:flex-row sm:items-center">
            <DialogTitle className="whitespace-nowrap text-sm font-normal">Selecionar imóvel</DialogTitle>
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Buscar por código ou nome..."
                className="h-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)] pl-8 text-xs font-light shadow-none focus-visible:ring-1 focus-visible:ring-primary/30"
                value={search}
                onChange={e => {
                  setSearch(e.target.value);
                  onSearchChange?.(e.target.value);
                }}
              />
            </div>
            <Button
              variant={showFilters ? 'secondary' : 'outline'}
              size="sm"
              className="h-8 shrink-0 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-xs font-light shadow-none hover:bg-[var(--app-surface-hover)]"
              onClick={() => setShowFilters(!showFilters)}
            >
              <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" />
              Filtros
            </Button>
          </div>

          {showFilters && (
            <div className="grid grid-cols-1 gap-2 border-b border-[var(--app-border)] bg-[var(--app-surface-soft)] px-4 py-3 sm:grid-cols-3">
              <select
                className="h-8 min-w-0 rounded-[6px] border-0 bg-[var(--app-surface)] px-3 text-xs text-foreground outline-none ring-1 ring-[var(--app-border)] focus:ring-primary"
                value={filterType}
                onChange={e => setFilterType(e.target.value)}
              >
                <option value="">Todos os tipos</option>
                {[...new Set((properties || []).map(p => p.tipo_de_imovel).filter(Boolean))].sort().map(t => (
                  <option key={t} value={t!}>{t}</option>
                ))}
              </select>
              <select
                className="h-8 min-w-0 rounded-[6px] border-0 bg-[var(--app-surface)] px-3 text-xs text-foreground outline-none ring-1 ring-[var(--app-border)] focus:ring-primary"
                value={filterPurpose}
                onChange={e => setFilterPurpose(e.target.value)}
              >
                <option value="">Todas finalidades</option>
                {[...new Set((properties || []).map(p => p.tipo_de_negocio).filter(Boolean))].sort().map(t => (
                  <option key={t} value={t!}>{t}</option>
                ))}
              </select>
              <select
                className="h-8 min-w-0 rounded-[6px] border-0 bg-[var(--app-surface)] px-3 text-xs text-foreground outline-none ring-1 ring-[var(--app-border)] focus:ring-primary"
                value={filterLocation}
                onChange={e => setFilterLocation(e.target.value)}
              >
                <option value="">Todas localizações</option>
                {[...new Set(
                  (properties || [])
                    .map(p => [p.bairro, p.cidade].filter(Boolean).join(', '))
                    .filter(v => v)
                )].sort().map(loc => (
                  <option key={loc} value={loc}>{loc}</option>
                ))}
              </select>
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-4 pb-4 pt-2">
            {filteredProperties.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                {isLoading ? (
                  <Loader2 className="mb-2 h-8 w-8 animate-spin opacity-60" />
                ) : (
                  <Building2 className="h-8 w-8 mb-2 opacity-40" />
                )}
                <p className="text-xs font-light">{isLoading ? 'Carregando imóveis...' : 'Nenhum imóvel encontrado'}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {filteredProperties.map(p => {
                  const statusBadge = getPropertyStatusBadge(p.status);
                  const StatusIcon = statusBadge?.icon;
                  const blockedMessage = getSelectionBlockedMessage(p.status);
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
                      aria-disabled={!!blockedMessage}
                      title={blockedMessage || undefined}
                      onClick={() => {
                        if (blockedMessage) {
                          toast.warning(blockedMessage);
                          return;
                        }
                        onSelect(p);
                        handleOpenChange(false);
                      }}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (blockedMessage || (event.key !== 'Enter' && event.key !== ' ')) return;
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
                          {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(p.preco))}
                        </p>
                      )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
