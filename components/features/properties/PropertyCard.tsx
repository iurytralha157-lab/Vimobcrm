import { Badge } from "@/components/ui/badge";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  History,
} from "lucide-react";
import { Property } from "@/hooks/use-properties";
import type { PropertySiteInfo } from "@/lib/api/property-support";
import { buildPropertySiteUrl } from "@/lib/property-site-url";
import { getSafePropertyImageSource } from "@/lib/property-media";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

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
  onOpenDetails?: (property: Property) => void;
  onHistory?: (property: Property) => void;
  onChangeStatus?: (
    id: string,
    status: "ativo" | "reservado" | "vendido" | "alugado",
  ) => void;
  onOpenPublication?: (id: string) => void;
  formatPrice: (value: number | null, tipo: string | null) => string;
  canEdit?: boolean;
  canUpdateAvailability?: boolean;
  canDelete?: boolean;
  siteInfo?: PropertySiteInfo | null;
}

function getPropertyMetadata(property: Property) {
  const raw = (property as PropertyWithMetadata).metadata;
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function metadataString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function isShareAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

export function PropertyCard({
  property,
  onEdit,
  onDelete,
  onPreview,
  onOpenDetails,
  onHistory,
  onChangeStatus,
  onOpenPublication,
  formatPrice,
  canEdit = false,
  canUpdateAvailability,
  canDelete,
  siteInfo,
}: PropertyCardProps) {
  const publication = property as PropertyWithPublication;
  const propertyMetadata = getPropertyMetadata(property);
  const displayPropertyType =
    property.tipo_de_imovel || (property as PropertyWithMetadata).tipo || "";
  const quadra = metadataString(propertyMetadata.quadra);
  const lote = metadataString(propertyMetadata.lote);
  const normalizedStatus = (property.status || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const isSold = normalizedStatus === "vendido";
  const isReserved = normalizedStatus === "reservado";
  const isRented =
    normalizedStatus === "alugado" || normalizedStatus === "locado";
  const isInactive =
    normalizedStatus === "inativo" || normalizedStatus === "inactive";
  const isPrivateStatus = [
    "privado",
    "private",
    "draft",
    "rascunho",
    "arquivado",
    "archived",
  ].includes(normalizedStatus);
  const isUnavailable = isSold || isReserved || isRented;
  const isSitePublished = Boolean(
    publication.published_on_site ?? publication.anunciar ?? false,
  );
  const isPrivate = (!isSitePublished && !isUnavailable) || isPrivateStatus;
  const propertyType = displayPropertyType
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const isLand = propertyType === "terreno" || propertyType === "lote";
  const displayArea = isLand
    ? property.area_total
    : property.area_util || property.area_total;
  const dealType = (property.tipo_de_negocio || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const titleIntent = (property.title || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const isRentalIntent =
    dealType === "aluguel" ||
    dealType === "locacao" ||
    dealType === "venda e aluguel" ||
    dealType === "venda e locacao" ||
    dealType === "temporada" ||
    titleIntent.includes("locacao") ||
    titleIntent.includes("aluguel") ||
    titleIntent.includes("alugar") ||
    (Number(property.valor_locacao) > 0 && property.preco == null);
  const isSaleIntent =
    dealType === "venda" ||
    dealType === "venda e aluguel" ||
    dealType === "venda e locacao" ||
    dealType === "lancamento" ||
    dealType === "lançamento";
  const displayPrice = isRentalIntent
    ? property.valor_locacao || property.preco
    : property.preco;
  const fallbackPhoto =
    Array.isArray(property.fotos) && typeof property.fotos[0] === "string"
      ? property.fotos[0]
      : null;
  const imageSrc = getSafePropertyImageSource(
    property.imagem_principal,
    fallbackPhoto,
  );
  const commissionPercentage = (property as PropertyWithCommission)
    .commission_percentage;
  const isPubliclyAvailable =
    isSitePublished && !isPrivateStatus && !isUnavailable && !isInactive;
  const propertySiteUrl = isPubliclyAvailable
    ? buildPropertySiteUrl(property.code, siteInfo)
    : null;
  const statusLabel = isSold
    ? "Vendido"
    : isRented
      ? "Alugado"
      : isReserved
        ? "Reservado"
        : isInactive
          ? "Inativo"
          : isPrivate
            ? "Privado"
            : null;
  const statusIcon = isSold
    ? CheckCircle
    : isRented
      ? KeyRound
      : isReserved
        ? Clock
        : isPrivate
          ? Lock
          : Clock;
  const StatusIcon = statusIcon;
  const statusBadgeClass =
    "bg-[var(--app-surface-solid)]/90 text-[var(--app-text-primary)]";
  const canRunAvailabilityActions = canUpdateAvailability ?? canEdit;
  const canDeleteProperty = canDelete ?? canEdit;
  const hasStatusActions = canRunAvailabilityActions && !!onChangeStatus;
  const hasPublicationAction = canRunAvailabilityActions && !!onOpenPublication;
  const hasAvailabilityActions = hasStatusActions || hasPublicationAction;

  const copyPropertyUrl = async () => {
    if (!propertySiteUrl) return false;

    try {
      await navigator.clipboard.writeText(propertySiteUrl);
      toast.success("Link do imóvel copiado!");
      return true;
    } catch {
      return false;
    }
  };

  const handleShareProperty = async (event?: {
    stopPropagation: () => void;
  }) => {
    event?.stopPropagation();
    if (!propertySiteUrl) {
      toast.info("Publique o imóvel no site para compartilhar o link.");
      return;
    }

    if (navigator.share) {
      try {
        await navigator.share({
          title: property.title || property.code || "Imovel",
          url: propertySiteUrl,
        });
        return;
      } catch (error) {
        if (isShareAbortError(error)) return;
        // The platform refused the native sheet; fall back below.
      }
    }

    const copied = await copyPropertyUrl();
    if (!copied) {
      window.open(propertySiteUrl, "_blank", "noopener,noreferrer");
      toast.info("Abrimos o link do imóvel em uma nova aba.");
    }
  };

  const openPropertySite = (event?: { stopPropagation: () => void }) => {
    event?.stopPropagation();
    if (!propertySiteUrl) return;
    window.open(propertySiteUrl, "_blank", "noopener,noreferrer");
  };

  const openProperty = () => (onOpenDetails ?? onPreview)(property);
  const propertyLabel = property.title || property.code || "imóvel";
  const menuItemClass =
    "h-8 gap-2 rounded-[6px] px-2.5 text-[12px] font-light text-[var(--app-text-secondary)] focus:bg-[var(--app-surface-hover)] focus:text-[var(--app-text-primary)]";
  const menuIconClass = "h-3.5 w-3.5 shrink-0";

  return (
    <article className="group overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none transition-colors hover:bg-[var(--app-surface-hover)]">
      <div className="relative aspect-[16/10] overflow-hidden bg-[var(--app-surface-soft)]">
        {imageSrc ? (
          <Image
            src={imageSrc}
            alt={property.title || ""}
            fill
            sizes="(max-width: 768px) 100vw, (max-width: 1536px) 50vw, 33vw"
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Building2 className="h-10 w-10 text-muted-foreground/30" />
          </div>
        )}

        <button
          type="button"
          aria-label={"Abrir ficha de " + propertyLabel}
          className="absolute inset-0 z-10 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
          onClick={openProperty}
        />

        {isUnavailable && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-[color-mix(in_srgb,var(--app-surface-solid)_74%,transparent)]">
            <Badge
              className={cn(
                "rounded-[6px] border-0 px-2.5 py-1 text-[10px] font-light shadow-none",
                statusBadgeClass,
              )}
            >
              <StatusIcon className="mr-1.5 h-3.5 w-3.5" />
              {statusLabel}
            </Badge>
          </div>
        )}

        <div className="pointer-events-none absolute left-0 top-0 z-20 flex flex-col items-start gap-1">
          {property.code && (
            <div className="rounded-br-[6px] bg-primary/50 px-3 py-1.5 font-mono text-[10px] font-light text-primary-foreground shadow-none">
              {property.code}
            </div>
          )}
          {property.destaque && (
            <Badge className="ml-2 rounded-[6px] border-0 bg-primary/50 px-2 py-1 text-[10px] font-light text-primary-foreground shadow-none">
              <Star className="mr-1 h-3 w-3" />
              Destaque
            </Badge>
          )}
        </div>

        <div className="pointer-events-none absolute right-2 top-2 z-30 flex items-center gap-1.5">
          {isPrivate && !isInactive && (
            <Badge className="rounded-[6px] border-0 bg-[var(--app-surface-solid)]/90 px-2 py-1 text-[10px] font-light text-[var(--app-text-primary)] shadow-none">
              <Lock className="mr-1 h-3 w-3" />
              Privado
            </Badge>
          )}
          {isInactive && (
            <Badge className="rounded-[6px] border-0 bg-[var(--app-surface-solid)]/90 px-2 py-1 text-[10px] font-light text-[var(--app-text-primary)] shadow-none">
              <Clock className="mr-1 h-3 w-3" />
              Inativo
            </Badge>
          )}
          {propertySiteUrl && (
            <button
              type="button"
              aria-label={"Compartilhar " + propertyLabel}
              title="Compartilhar link do site"
              className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground shadow-none transition-colors hover:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              onClick={handleShareProperty}
            >
              <Share2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {commissionPercentage != null && commissionPercentage > 0 && (
          <div className="pointer-events-none absolute bottom-2 right-2 z-20">
            <Badge className="rounded-[6px] border-0 bg-[var(--app-surface-solid)]/90 px-2 py-1 text-[10px] font-light text-[var(--app-text-secondary)] shadow-none">
              <Percent className="mr-1 h-3 w-3" />
              {commissionPercentage}%
            </Badge>
          </div>
        )}
      </div>

      <div className="relative p-3">
        <div className="mb-2 flex items-start justify-between gap-2">
          <Badge className="rounded-[6px] border-0 bg-primary/50 px-2 py-1 text-[10px] font-light text-primary-foreground shadow-none hover:bg-primary/50">
            {property.tipo_de_negocio}
          </Badge>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={"Ações de " + propertyLabel}
                className="h-8 w-8 shrink-0 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)] shadow-none hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              sideOffset={6}
              className="w-56 rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-1.5 text-[12px] font-light text-[var(--app-text-primary)] shadow-none"
            >
              {onOpenDetails && (
                <DropdownMenuItem
                  className={menuItemClass}
                  onClick={() => onOpenDetails(property)}
                >
                  <Building2 className={menuIconClass} />
                  Abrir ficha 360°
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                className={menuItemClass}
                onClick={() => onPreview(property)}
              >
                <Eye className={menuIconClass} />
                Visualização rápida
              </DropdownMenuItem>
              {onHistory && (
                <DropdownMenuItem
                  className={menuItemClass}
                  onClick={() => onHistory(property)}
                >
                  <History className={menuIconClass} />
                  Histórico
                </DropdownMenuItem>
              )}

              {propertySiteUrl && (
                <>
                  <DropdownMenuSeparator className="my-1 bg-[var(--app-border)]" />
                  <DropdownMenuItem
                    className={menuItemClass}
                    onClick={handleShareProperty}
                  >
                    <Share2 className={menuIconClass} />
                    Compartilhar link
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className={menuItemClass}
                    onClick={openPropertySite}
                  >
                    <ExternalLink className={menuIconClass} />
                    Abrir no site
                  </DropdownMenuItem>
                </>
              )}

              {(canEdit || hasAvailabilityActions) && (
                <DropdownMenuSeparator className="my-1 bg-[var(--app-border)]" />
              )}
              {canEdit && (
                <DropdownMenuItem
                  className={menuItemClass}
                  onClick={() => onEdit(property)}
                >
                  <Pencil className={menuIconClass} />
                  Editar
                </DropdownMenuItem>
              )}
              {hasStatusActions && (
                <>
                  {!isReserved && !isSold && !isRented && (
                    <DropdownMenuItem
                      className={menuItemClass}
                      onClick={() => onChangeStatus?.(property.id, "reservado")}
                    >
                      <Clock className={menuIconClass} />
                      Marcar como reservado
                    </DropdownMenuItem>
                  )}
                  {isSaleIntent && !isSold && (
                    <DropdownMenuItem
                      className={menuItemClass}
                      onClick={() => onChangeStatus?.(property.id, "vendido")}
                    >
                      <CheckCircle className={menuIconClass} />
                      Marcar como vendido
                    </DropdownMenuItem>
                  )}
                  {isRentalIntent && !isRented && (
                    <DropdownMenuItem
                      className={menuItemClass}
                      onClick={() => onChangeStatus?.(property.id, "alugado")}
                    >
                      <KeyRound className={menuIconClass} />
                      Marcar como alugado
                    </DropdownMenuItem>
                  )}
                  {(isUnavailable || isInactive || isPrivateStatus) && (
                    <DropdownMenuItem
                      className={menuItemClass}
                      onClick={() => onChangeStatus?.(property.id, "ativo")}
                    >
                      <RotateCcw className={menuIconClass} />
                      Voltar disponível
                    </DropdownMenuItem>
                  )}
                </>
              )}
              {hasPublicationAction && (
                <DropdownMenuItem
                  className={menuItemClass}
                  onClick={() => onOpenPublication?.(property.id)}
                >
                  <Globe className={menuIconClass} />
                  Gerenciar publicação
                </DropdownMenuItem>
              )}

              {canDeleteProperty && (
                <>
                  <DropdownMenuSeparator className="my-1 bg-[var(--app-border)]" />
                  <DropdownMenuItem
                    className={cn(
                      menuItemClass,
                      "text-destructive focus:bg-destructive/10 focus:text-destructive",
                    )}
                    onClick={() => onDelete(property.id)}
                  >
                    <Trash2 className={menuIconClass} />
                    Excluir
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <button
          type="button"
          aria-label={"Ver detalhes de " + propertyLabel}
          className="block w-full rounded-[6px] text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
          onClick={openProperty}
        >
          <h3 className="mb-1.5 line-clamp-2 text-[13px] font-light leading-[18px] text-[var(--app-text-primary)]">
            {property.title ||
              (displayPropertyType || "Imóvel") +
                " em " +
                (property.bairro ||
                  property.cidade ||
                  "localização não informada")}
          </h3>

          {(property.bairro || property.cidade || quadra || lote) && (
            <div className="mb-2.5 flex items-center gap-1.5 text-[11px] font-light text-[var(--app-text-tertiary)]">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">
                {[
                  property.bairro,
                  quadra ? "Quadra " + quadra : null,
                  lote ? "Lote " + lote : null,
                  property.cidade,
                ]
                  .filter(Boolean)
                  .join(", ")}
              </span>
            </div>
          )}

          <div className="mb-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-light text-[var(--app-text-tertiary)]">
            {property.quartos != null && property.quartos > 0 && (
              <span className="flex items-center gap-1">
                <Bed className="h-3 w-3" />
                {property.quartos}
              </span>
            )}
            {property.banheiros != null && property.banheiros > 0 && (
              <span className="flex items-center gap-1">
                <Bath className="h-3 w-3" />
                {property.banheiros}
              </span>
            )}
            {property.vagas != null && property.vagas > 0 && (
              <span className="flex items-center gap-1">
                <Car className="h-3 w-3" />
                {property.vagas}
              </span>
            )}
            {displayArea != null && displayArea > 0 && (
              <span className="flex items-center gap-1">
                <Ruler className="h-3 w-3" />
                {displayArea}m²{isLand ? " total" : ""}
              </span>
            )}
          </div>

          <p
            className={cn(
              "text-base font-normal leading-tight text-[var(--app-text-primary)]",
              isUnavailable && "text-[var(--app-text-tertiary)] line-through",
            )}
          >
            {formatPrice(
              displayPrice,
              isRentalIntent ? "Aluguel" : property.tipo_de_negocio,
            )}
          </p>
        </button>
      </div>
    </article>
  );
}
