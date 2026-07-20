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
import { toast } from 'sonner';
import { normalizeSearchText, searchTextIncludes } from '@/lib/search-text';

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
  const { profile } = useAuth();

  const { data: siteInfo } = useQuery({
    queryKey: ['org-site-info', profile?.organization_id],
    queryFn: async () => {
      if (!profile?.organization_id) return null;
      return getPropertySiteInfo(profile.organization_id);
    },
    enabled: !!profile?.organization_id && open,
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
        <DialogContent className="w-[95%] max-w-4xl max-h-[90vh] flex flex-col p-0 overflow-hidden">
          <div className="flex items-center gap-3 p-4 pr-12 pb-3 border-b">
            <DialogTitle className="text-sm font-semibold whitespace-nowrap">Selecionar Imóvel</DialogTitle>
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Buscar por código ou nome..."
                className="h-8 text-xs pl-8"
                value={search}
                onChange={e => {
                  setSearch(e.target.value);
                  onSearchChange?.(e.target.value);
                }}
              />
            </div>
            <Button
              variant={showFilters ? 'secondary' : 'ghost'}
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => setShowFilters(!showFilters)}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
            </Button>
          </div>

          {showFilters && (
            <div className="flex flex-wrap items-center gap-3 px-4 pt-4 pb-3 border-b">
              <select
                className="h-9 text-xs rounded-md border bg-background px-3 flex-1 min-w-[140px]"
                value={filterType}
                onChange={e => setFilterType(e.target.value)}
              >
                <option value="">Todos os tipos</option>
                {[...new Set((properties || []).map(p => p.tipo_de_imovel).filter(Boolean))].sort().map(t => (
                  <option key={t} value={t!}>{t}</option>
                ))}
              </select>
              <select
                className="h-9 text-xs rounded-md border bg-background px-3 flex-1 min-w-[140px]"
                value={filterPurpose}
                onChange={e => setFilterPurpose(e.target.value)}
              >
                <option value="">Todas finalidades</option>
                {[...new Set((properties || []).map(p => p.tipo_de_negocio).filter(Boolean))].sort().map(t => (
                  <option key={t} value={t!}>{t}</option>
                ))}
              </select>
              <select
                className="h-9 text-xs rounded-md border bg-background px-3 flex-1 min-w-[140px]"
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
                <p className="text-xs">{isLoading ? 'Carregando imoveis...' : 'Nenhum imóvel encontrado'}</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {filteredProperties.map(p => {
                  const statusBadge = getPropertyStatusBadge(p.status);
                  const StatusIcon = statusBadge?.icon;
                  const blockedMessage = getSelectionBlockedMessage(p.status);

                  return (
                    <div
                      key={p.id}
                      className={cn(
                        'flex flex-col rounded-xl border overflow-hidden text-left transition-all',
                        blockedMessage
                          ? 'cursor-not-allowed opacity-75'
                          : 'cursor-pointer hover:ring-2 hover:ring-primary/50',
                        selectedPropertyId === p.id && 'ring-2 ring-primary'
                      )}
                      aria-disabled={!!blockedMessage}
                      title={blockedMessage || undefined}
                      onClick={() => {
                        if (blockedMessage) {
                          toast.warning(blockedMessage);
                          return;
                        }
                        onSelect(p);
                        setOpen(false);
                      }}
                    >
                      <div className="relative aspect-[4/3] bg-[var(--app-surface-soft)]">
                      {p.imagem_principal ? (
                        <NextImage
                          src={p.imagem_principal}
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
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/25">
                          <Badge className={cn('border-0 px-2.5 py-1 text-[10px] font-semibold uppercase shadow-sm backdrop-blur-sm', statusBadge.className)}>
                            <StatusIcon className="h-3 w-3 mr-1" />
                            {statusBadge.label}
                          </Badge>
                        </div>
                      )}
                      {p.code && (
                        <Badge className="absolute top-1.5 left-1.5 text-[9px] px-1.5 py-0 h-4 bg-[#ff482a] text-white backdrop-blur-sm border-0">
                          {p.code}
                        </Badge>
                      )}
                      {p.code && (() => {
                        const url = buildPropertySiteUrl(p.code, siteInfo);
                        return url ? (
                          <button
                            className="absolute top-1.5 right-1.5 w-6 h-6 bg-black/60 hover:bg-black/80 backdrop-blur-sm rounded-full flex items-center justify-center transition-colors"
                            title="Ver no site"
                            onClick={(e) => {
                              e.stopPropagation();
                              window.open(url, '_blank');
                            }}
                          >
                            <ExternalLink className="h-3 w-3 text-white" />
                          </button>
                        ) : null;
                      })()}
                      </div>
                      <div className="p-2 space-y-0.5">
                      <p className="text-[11px] font-medium truncate">{p.title || 'Sem título'}</p>
                      {p.bairro && (
                        <p className="text-[10px] text-muted-foreground truncate">
                          {p.bairro}{p.cidade ? `, ${p.cidade}` : ''}
                        </p>
                      )}
                      {p.preco && (
                        <p className="text-[11px] font-semibold text-primary">
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
