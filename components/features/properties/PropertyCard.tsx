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
  Globe,
  Lock,
  Percent
} from 'lucide-react';
import { Property } from '@/hooks/use-properties';

type PropertyWithCommission = Property & {
  commission_percentage?: number | null;
};

interface PropertyCardProps {
  property: Property;
  onEdit: (property: Property) => void;
  onDelete: (id: string) => void;
  onPreview: (property: Property) => void;
  onMarkSold?: (id: string) => void;
  onToggleVisibility?: (id: string, isPublic: boolean) => void;
  formatPrice: (value: number | null, tipo: string | null) => string;
  canEdit?: boolean;
}

export function PropertyCard({
  property,
  onEdit,
  onDelete,
  onPreview,
  onMarkSold,
  onToggleVisibility,
  formatPrice,
  canEdit = false,
}: PropertyCardProps) {
  const isSold = property.status === 'vendido';
  const isPublic = property.status !== 'privado';
  const propertyType = (property.tipo_de_imovel || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const isLand = propertyType === 'terreno' || propertyType === 'lote';
  const displayArea = isLand ? property.area_total : (property.area_util || property.area_total);
  const dealType = (property.tipo_de_negocio || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const displayPrice = dealType === 'aluguel' || dealType === 'locacao' || dealType === 'temporada'
    ? property.valor_locacao || property.preco
    : property.preco;
  const fallbackPhoto = Array.isArray(property.fotos) && typeof property.fotos[0] === 'string'
    ? property.fotos[0]
    : null;
  const imageSrc = property.imagem_principal || fallbackPhoto;
  const commissionPercentage = (property as PropertyWithCommission).commission_percentage;

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

        {/* Sold overlay */}
        {isSold && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
            <Badge className="bg-success text-success-foreground text-lg px-4 py-2">
              <CheckCircle className="h-5 w-5 mr-2" />
              VENDIDO
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
          {!isPublic && (
            <Badge variant="secondary" className="ml-2 bg-black/70 text-muted-foreground">
              <Lock className="h-3 w-3 mr-1" />
              Privado
            </Badge>
          )}
        </div>

        {/* Top right badges */}
        <div className="absolute top-2 right-2 flex gap-1">
          {property.status === 'inativo' && (
            <Badge variant="outline" className="bg-background">Inativo</Badge>
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
          <Badge variant={property.tipo_de_negocio === 'Venda' ? 'default' : 'secondary'}>
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
              {canEdit && (
                <DropdownMenuItem onClick={() => onEdit(property)}>
                  <Pencil className="h-4 w-4 mr-2" />
                  Editar
                </DropdownMenuItem>
              )}
              {canEdit && <DropdownMenuSeparator />}
              {canEdit && onMarkSold && !isSold && (
                <DropdownMenuItem onClick={() => onMarkSold(property.id)}>
                  <CheckCircle className="h-4 w-4 mr-2 text-success" />
                  Marcar como Vendido
                </DropdownMenuItem>
              )}
              {canEdit && onToggleVisibility && (
                <DropdownMenuItem onClick={() => onToggleVisibility(property.id, !isPublic)}>
                  {isPublic ? (
                    <>
                      <Lock className="h-4 w-4 mr-2" />
                      Tornar Privado
                    </>
                  ) : (
                    <>
                      <Globe className="h-4 w-4 mr-2" />
                      Tornar Público
                    </>
                  )}
                </DropdownMenuItem>
              )}
              {canEdit && (
                <>
                  <DropdownMenuSeparator />
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
          {property.title || `${property.tipo_de_imovel} em ${property.bairro}`}
        </h3>

        {(property.bairro || property.cidade) && (
          <div className="flex items-center gap-1 text-muted-foreground text-sm mb-3">
            <MapPin className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{[property.bairro, property.cidade].filter(Boolean).join(', ')}</span>
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

        <p className={`text-lg font-bold ${isSold ? 'text-muted-foreground line-through' : 'text-primary'}`}>
          {formatPrice(displayPrice, property.tipo_de_negocio)}
        </p>
      </CardContent>
    </Card>
  );
}
