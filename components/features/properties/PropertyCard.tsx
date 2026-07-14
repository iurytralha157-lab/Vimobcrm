import { Badge } from '@/components/ui/badge';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  MoreHorizontal,
  MapPin,
  Bed,
  Bath,
  Car,
  Ruler,
  Star,
  Building2,
  Pencil,
  Trash2,
  Eye,
  CheckCircle,
  Clock,
  Globe,
  Lock,
  Percent,
  Share2,
  ExternalLink,
  RotateCcw,
  KeyRound,
  History
} from 'lucide-react';
import { Property } from '@/hooks/use-properties';
import type { PropertySiteInfo } from '@/lib/api/property-support';
import { buildPropertySiteUrl } from '@/lib/property-site-url';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

type PropertyWithCommission = Property & {
  commission_percentage?: number | null;
};

type PropertyWithPublication = Property & {
  published_on_site?: boolean | null;
  anunciar?: boolean | null;
};

type PropertyWithMetadata = Property & {
  tipo?: string | null;
  metadata?: unknown;
};

interface PropertyCardProps {
  property: Property;
  onEdit: (property: Property) => void;
  onDelete: (id: string) => void;
  onPreview: (property: Property) => void;
  onHistory?: (property: Property) => void;
  onChangeStatus?: (id: string, status: 'ativo' | 'reservado' | 'vendido' | 'alugado') => void;
  onToggleVisibility?: (id: string, isPublic: boolean) => void;
  formatPrice: (value: number | null, tipo: string | null) => string;
  canEdit?: boolean;
  canUpdateAvailability?: boolean;
  canDelete?: boolean;
  siteInfo?: PropertySiteInfo | null;
}

function getPropertyMetadata(property: Property) {
  const raw = (property as PropertyWithMetadata).metadata;
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
}

function metadataString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

export function PropertyCard({
  property,
  onEdit,
  onDelete,
  onPreview,
  onHistory,
  onChangeStatus,
  onToggleVisibility,
  formatPrice,
  canEdit = false,
  canUpdateAvailability,
  canDelete,
  siteInfo,
}: PropertyCardProps) {
  const publication = property as PropertyWithPublication;
  const propertyMetadata = getPropertyMetadata(property);
  const displayPropertyType = property.tipo_de_imovel || (property as PropertyWithMetadata).tipo || '';
  const quadra = metadataString(propertyMetadata.quadra);
  const lote = metadataString(propertyMetadata.lote);
  const normalizedStatus = (property.status || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const isSold = normalizedStatus === 'vendido';
  const isReserved = normalizedStatus === 'reservado';
  const isRented = normalizedStatus === 'alugado' || normalizedStatus === 'locado';
  const isInactive = normalizedStatus === 'inativo' || normalizedStatus === 'inactive';
  const isPrivateStatus = ['privado', 'private', 'draft', 'rascunho', 'arquivado', 'archived'].includes(normalizedStatus);
  const isUnavailable = isSold || isReserved || isRented;
  const isSitePublished = Boolean(publication.published_on_site ?? publication.anunciar ?? true);
  const isPrivate = (!isSitePublished && !isUnavailable) || isPrivateStatus;
  const propertyType = displayPropertyType.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const isLand = propertyType === 'terreno' || propertyType === 'lote';
  const displayArea = isLand ? property.area_total : (property.area_util || property.area_total);
  const dealType = (property.tipo_de_negocio || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const titleIntent = (property.title || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const isRentalIntent =
    dealType === 'aluguel' ||
    dealType === 'locacao' ||
    dealType === 'venda e aluguel' ||
    dealType === 'venda e locacao' ||
    dealType === 'temporada' ||
    titleIntent.includes('locacao') ||
    titleIntent.includes('aluguel') ||
    titleIntent.includes('alugar') ||
    (Number(property.valor_locacao) > 0 && property.preco == null);
  const isSaleIntent =
    dealType === 'venda' ||
    dealType === 'venda e aluguel' ||
    dealType === 'venda e locacao' ||
    dealType === 'lancamento' ||
    dealType === 'lançamento';
  const displayPrice = isRentalIntent
    ? property.valor_locacao || property.preco
    : property.preco;
  const fallbackPhoto = Array.isArray(property.fotos) && typeof property.fotos[0] === 'string'
    ? property.fotos[0]
    : null;
  const imageSrc = property.imagem_principal || fallbackPhoto;
  const commissionPercentage = (property as PropertyWithCommission).commission_percentage;
  const isPubliclyAvailable = isSitePublished && !isPrivateStatus && !isUnavailable && !isInactive;
  const propertySiteUrl = isPubliclyAvailable ? buildPropertySiteUrl(property.code, siteInfo) : null;
  const statusLabel = isSold ? 'Vendido' : isRented ? 'Alugado' : isReserved ? 'Reservado' : isInactive ? 'Inativo' : isPrivate ? 'Privado' : null;
  const statusIcon = isSold ? CheckCircle : isRented ? KeyRound : isReserved ? Clock : isPrivate ? Lock : Clock;
  const StatusIcon = statusIcon;
  const statusBadgeClass = isSold
    ? 'bg-zinc-900/75 text-white dark:bg-zinc-100/85 dark:text-zinc-950'
    : isRented
      ? 'bg-sky-950/75 text-white dark:bg-sky-200/85 dark:text-sky-950'
      : isReserved
        ? 'bg-amber-950/75 text-white dark:bg-amber-200/90 dark:text-amber-950'
        : 'bg-black/70 text-white';
  const canRunAvailabilityActions = canUpdateAvailability ?? canEdit;
  const canDeleteProperty = canDelete ?? canEdit;
  const hasStatusActions = canRunAvailabilityActions && !!onChangeStatus;
  const hasVisibilityAction = canRunAvailabilityActions && !!onToggleVisibility && !isUnavailable;
  const hasAvailabilityActions = hasStatusActions || hasVisibilityAction;

  const copyPropertyUrl = async () => {
    if (!propertySiteUrl) return false;

    try {
      await navigator.clipboard.writeText(propertySiteUrl);
      toast.success('Link do imóvel copiado!');
      return true;
    } catch {
      return false;
    }
  };

  const handleShareProperty = async (event?: { stopPropagation: () => void }) => {
    event?.stopPropagation();
    if (!propertySiteUrl) {
      toast.info('Publique o imóvel no site para compartilhar o link.');
      return;
    }

    if (navigator.share) {
      try {
        await navigator.share({
          title: property.title || property.code || 'Imovel',
          url: propertySiteUrl,
        });
        return;
      } catch {
        // User cancelled or the platform refused the native sheet; fall back below.
      }
    }

    const copied = await copyPropertyUrl();
    if (!copied) {
      window.open(propertySiteUrl, '_blank', 'noopener,noreferrer');
      toast.info('Abrimos o link do imóvel em uma nova aba.');
    }
  };

  const openPropertySite = (event?: { stopPropagation: () => void }) => {
    event?.stopPropagation();
    if (!propertySiteUrl) return;
    window.open(propertySiteUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <Card
      className="app-card overflow-hidden card-hover group cursor-pointer"
      role="button"
      tabIndex={0}
      onClick={() => onPreview(property)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onPreview(property);
        }
      }}
    >
      <div className="relative aspect-[4/3] bg-[var(--app-surface-soft)]">
        {imageSrc ? (
          <Image
            src={imageSrc}
            alt={property.title || ''}
            fill
            sizes="(max-width: 768px) 100vw, 33vw"
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Building2 className="h-12 w-12 text-muted-foreground/30" />
          </div>
        )}

        {isUnavailable && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/25">
            <Badge className={cn("rounded-[6px] border-0 px-3 py-1.5 text-xs font-semibold uppercase shadow-sm backdrop-blur-sm", statusBadgeClass)}>
              <StatusIcon className="h-3.5 w-3.5 mr-1.5" />
              {statusLabel}
            </Badge>
          </div>
        )}

        {/* Top left badges */}
        <div className="absolute top-0 left-0 flex flex-col items-start gap-1">
          {property.code && (
            <div className="rounded-br-md bg-primary px-4 py-2 font-mono text-xs font-semibold text-primary-foreground shadow-sm">
              {property.code}
            </div>
          )}
          {property.destaque && (
            <Badge className="ml-2 bg-warning text-warning-foreground">
              <Star className="h-3 w-3 mr-1" />
              Destaque
            </Badge>
          )}
        </div>

        {/* Top right badges */}
        <div className="absolute right-2 top-2 flex items-start gap-1">
          {isPrivate && !isInactive && (
            <Badge variant="secondary" className="rounded-[6px] bg-black/70 text-white">
              <Lock className="h-3 w-3 mr-1" />
              Privado
            </Badge>
          )}
          {isInactive && (
            <Badge variant="secondary" className="rounded-[6px] bg-black/70 text-white">
              <Clock className="h-3 w-3 mr-1" />
              Inativo
            </Badge>
          )}
          {propertySiteUrl && (
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-md bg-black/65 text-white shadow-sm backdrop-blur-sm transition-colors hover:bg-black/80"
              title="Compartilhar link do site"
              onClick={handleShareProperty}
            >
              <Share2 className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Commission badge bottom right */}
        {commissionPercentage != null && commissionPercentage > 0 && (
          <div className="absolute bottom-2 right-2">
            <Badge variant="outline" className="bg-background/90 backdrop-blur-sm">
              <Percent className="h-3 w-3 mr-1" />
              {commissionPercentage}%
            </Badge>
          </div>
        )}
      </div>
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-2">
          <Badge className="rounded-[6px] border-0 bg-primary text-primary-foreground hover:bg-primary/90">
            {property.tipo_de_negocio}
          </Badge>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={(event) => event.stopPropagation()}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
              <DropdownMenuItem onClick={() => onPreview(property)}>
                <Eye className="h-4 w-4 mr-2" />
                Visualizar
              </DropdownMenuItem>
              {onHistory && (
                <DropdownMenuItem onClick={() => onHistory(property)}>
                  <History className="h-4 w-4 mr-2" />
                  Historico
                </DropdownMenuItem>
              )}
              {propertySiteUrl && (
                <>
                  <DropdownMenuItem onClick={handleShareProperty}>
                    <Share2 className="h-4 w-4 mr-2" />
                    Compartilhar link
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={openPropertySite}>
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Abrir no site
                  </DropdownMenuItem>
                </>
              )}
              {canEdit && (
                <DropdownMenuItem onClick={() => onEdit(property)}>
                  <Pencil className="h-4 w-4 mr-2" />
                  Editar
                </DropdownMenuItem>
              )}
              {canEdit && (hasAvailabilityActions || canDeleteProperty) && <DropdownMenuSeparator />}
              {hasStatusActions && (
                <>
                  {!isReserved && !isSold && !isRented && (
                    <DropdownMenuItem onClick={() => onChangeStatus?.(property.id, 'reservado')}>
                      <Clock className="h-4 w-4 mr-2 text-amber-500" />
                      Marcar como Reservado
                    </DropdownMenuItem>
                  )}
                  {isSaleIntent && !isSold && (
                    <DropdownMenuItem onClick={() => onChangeStatus?.(property.id, 'vendido')}>
                      <CheckCircle className="h-4 w-4 mr-2 text-success" />
                      Marcar como Vendido
                    </DropdownMenuItem>
                  )}
                  {isRentalIntent && !isRented && (
                    <DropdownMenuItem onClick={() => onChangeStatus?.(property.id, 'alugado')}>
                      <KeyRound className="h-4 w-4 mr-2 text-sky-500" />
                      Marcar como Alugado
                    </DropdownMenuItem>
                  )}
                  {(isUnavailable || isInactive || isPrivateStatus) && (
                    <DropdownMenuItem onClick={() => onChangeStatus?.(property.id, 'ativo')}>
                      <RotateCcw className="h-4 w-4 mr-2" />
                      Voltar disponível
                    </DropdownMenuItem>
                  )}
                </>
              )}
              {hasVisibilityAction && (
                <DropdownMenuItem onClick={() => onToggleVisibility?.(property.id, !isSitePublished)}>
                  {isSitePublished ? (
                    <>
                      <Lock className="h-4 w-4 mr-2" />
                      Remover do site
                    </>
                  ) : (
                    <>
                      <Globe className="h-4 w-4 mr-2" />
                      Publicar no site
                    </>
                  )}
                </DropdownMenuItem>
              )}
              {hasAvailabilityActions && canDeleteProperty && <DropdownMenuSeparator />}
              {canDeleteProperty && (
                <>
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => onDelete(property.id)}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Excluir
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <h3 className="font-medium text-sm line-clamp-2 mb-2">
          {property.title || `${displayPropertyType || 'Imóvel'} em ${property.bairro || property.cidade || 'localização não informada'}`}
        </h3>

        {(property.bairro || property.cidade || quadra || lote) && (
          <div className="flex items-center gap-1 text-muted-foreground text-sm mb-3">
            <MapPin className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">
              {[
                property.bairro,
                quadra ? `Quadra ${quadra}` : null,
                lote ? `Lote ${lote}` : null,
                property.cidade,
              ].filter(Boolean).join(', ')}
            </span>
          </div>
        )}

        <div className="flex items-center gap-3 text-muted-foreground text-xs mb-3 flex-wrap">
          {property.quartos && property.quartos > 0 && (
            <div className="flex items-center gap-1">
              <Bed className="h-3 w-3" />
              <span>{property.quartos}</span>
            </div>
          )}
          {property.banheiros && property.banheiros > 0 && (
            <div className="flex items-center gap-1">
              <Bath className="h-3 w-3" />
              <span>{property.banheiros}</span>
            </div>
          )}
          {property.vagas && property.vagas > 0 && (
            <div className="flex items-center gap-1">
              <Car className="h-3 w-3" />
              <span>{property.vagas}</span>
            </div>
          )}
          {displayArea != null && displayArea > 0 && (
            <div className="flex items-center gap-1">
              <Ruler className="h-3 w-3" />
              <span>{displayArea}m²{isLand ? ' total' : ''}</span>
            </div>
          )}
        </div>

        <p className={`text-lg font-bold ${isUnavailable ? 'text-muted-foreground line-through' : 'text-primary'}`}>
          {formatPrice(displayPrice, isRentalIntent ? 'Aluguel' : property.tipo_de_negocio)}
        </p>
      </CardContent>
    </Card>
  );
}
