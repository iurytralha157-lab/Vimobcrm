"use client";

import { useState } from "react";
import Image from "next/image";
import { Bath, BedDouble, Building2, Camera, Car, MapPin, Ruler } from "lucide-react";

import type { Property } from "@/hooks/use-properties";
import type { PropertySiteInfo } from "@/lib/api/property-support";
import { getSafePropertyImageSource } from "@/lib/property-media";
import { getPropertyMetadataString as metadataString } from "@/lib/property-display-utils";
import { buildPropertySiteUrl } from "@/lib/property-site-url";
import { cn } from "@/lib/utils";

import { PropertyCardMenu } from "./list/PropertyCardMenu";
import {
  PROPERTY_STATUS_LABELS,
  formatPropertyMoney,
  normalizeText,
  plural,
  pricePerSquareMeter,
  propertyDealLabel,
  propertyStatusKind,
} from "./property-display";
import { PropertyChip, ResponsibleAvatar, type PropertyChipTone } from "./property-ui";
import { getSitePublicationCardState, type SitePublication } from "./publication/site-publication-state";

type PropertyWithPublication = Property & {
  published_on_site?: boolean | null;
  anunciar?: boolean | null;
  site_publication?: SitePublication | null;
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
    expectedUpdatedAt: string,
  ) => void;
  onOpenPublication?: (id: string) => void;
  formatPrice: (value: number | null, tipo: string | null) => string;
  canEdit?: boolean;
  canUpdateAvailability?: boolean;
  canDelete?: boolean;
  siteInfo?: PropertySiteInfo | null;
  /** Responsible person resolved from the organization's users; omitted when unknown. */
  responsible?: { name: string; avatarUrl: string | null } | null;
  /** Load only the first visible catalog image eagerly to improve the list LCP. */
  prioritizeImage?: boolean;
}

function propertyMetadata(property: Property) {
  const raw = (property as PropertyWithMetadata).metadata;
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

/** The list only carries legacy galleries; asset-backed photos have no count here. */
function knownPhotoCount(property: Property) {
  const urls = [
    ...(property.image_urls ?? []),
    ...(Array.isArray(property.fotos) ? property.fotos.filter((item): item is string => typeof item === "string") : []),
  ];
  return new Set(urls.filter(Boolean)).size;
}

const SITE_TONES: Record<string, PropertyChipTone> = {
  success: "success",
  pending: "warning",
  error: "danger",
  neutral: "neutral",
};

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
  responsible,
  prioritizeImage = false,
}: PropertyCardProps) {
  const publication = property as PropertyWithPublication;
  const metadata = propertyMetadata(property);
  const displayPropertyType = property.tipo_de_imovel || (property as PropertyWithMetadata).tipo || "";
  const quadra = metadataString(metadata.quadra);
  const lote = metadataString(metadata.lote);
  const statusKind = propertyStatusKind(property.status);
  const isUnavailable = ["sold", "rented", "reserved"].includes(statusKind);
  const isSitePublished = Boolean(publication.published_on_site ?? publication.anunciar ?? false);
  const canonicalSiteState = publication.site_publication?.id
    ? getSitePublicationCardState(publication.site_publication, isSitePublished)
    : null;
  const propertyType = normalizeText(displayPropertyType);
  const isLand = propertyType === "terreno" || propertyType === "lote";
  const displayArea = isLand ? property.area_total : property.area_util || property.area_total;
  const dealType = normalizeText(property.tipo_de_negocio);
  const titleIntent = normalizeText(property.title);
  const isRentalIntent =
    ["aluguel", "locacao", "venda e aluguel", "venda e locacao", "temporada"].includes(dealType) ||
    titleIntent.includes("locacao") ||
    titleIntent.includes("aluguel") ||
    titleIntent.includes("alugar") ||
    (Number(property.valor_locacao) > 0 && property.preco == null);
  const isSaleIntent = ["venda", "venda e aluguel", "venda e locacao", "lancamento"].includes(dealType);
  const displayPrice = isRentalIntent ? property.valor_locacao || property.preco : property.preco;
  const fallbackPhoto =
    Array.isArray(property.fotos) && typeof property.fotos[0] === "string" ? property.fotos[0] : null;
  const imageSrc = getSafePropertyImageSource(property.imagem_principal, fallbackPhoto);
  const [failedImageSource, setFailedImageSource] = useState<string | null>(null);
  const isPubliclyAvailable =
    (canonicalSiteState?.canOpenPublicSite ?? isSitePublished) &&
    !isUnavailable &&
    !["inactive", "draft", "archived"].includes(statusKind);
  const propertySiteUrl = isPubliclyAvailable ? buildPropertySiteUrl(property.code, siteInfo) : null;
  const statusLabel = PROPERTY_STATUS_LABELS[statusKind];
  const perSquareMeter = pricePerSquareMeter(displayPrice, displayArea);
  const photoCount = knownPhotoCount(property);
  const ownerLabel =
    property.third_party_kind === "partner" && property.partner_name
      ? `Parceiro: ${property.partner_name}`
      : property.owner_name;
  const location = [
    property.bairro,
    quadra ? `Quadra ${quadra}` : null,
    lote ? `Lote ${lote}` : null,
    property.cidade,
  ].filter(Boolean).join(", ");
  const attributes = [
    property.quartos ? { icon: BedDouble, label: plural(property.quartos, "quarto", "quartos") } : null,
    property.suites ? { icon: Bath, label: plural(property.suites, "suíte", "suítes") } : null,
    property.vagas ? { icon: Car, label: plural(property.vagas, "vaga", "vagas") } : null,
    displayArea ? { icon: Ruler, label: `${displayArea} m²${isLand ? " total" : ""}` } : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));
  const openProperty = () => (onOpenDetails ?? onPreview)(property);
  const propertyLabel = property.title || property.code || "imóvel";

  return (
    <article className="group flex h-full min-w-0 flex-col overflow-hidden rounded-[12px] bg-[var(--app-surface-solid)]">
      <div className="relative aspect-[2/1] shrink-0 overflow-hidden bg-[var(--app-surface-soft)]">
        {imageSrc && failedImageSource !== imageSrc ? (
          <Image
            src={imageSrc}
            alt={property.title || ""}
            fill
            sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 25vw"
            className="object-cover"
            unoptimized
            loading={prioritizeImage ? "eager" : "lazy"}
            onError={() => setFailedImageSource(imageSrc)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Building2 className="h-10 w-10 text-[var(--app-text-tertiary)] opacity-40" aria-hidden="true" />
          </div>
        )}
        <button
          type="button"
          aria-label={`Abrir ficha de ${propertyLabel}`}
          className="absolute inset-0 z-10 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
          onClick={openProperty}
        />
        <div className="pointer-events-none absolute inset-x-2 top-2 z-20 flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-wrap gap-1">
            {property.code && (
              <PropertyChip tone="surface" data-property-card-code>
                {property.code}
              </PropertyChip>
            )}
            {property.tipo_de_negocio && (
              <PropertyChip tone="surface" data-property-card-deal-type>
                {propertyDealLabel(property.tipo_de_negocio)}
              </PropertyChip>
            )}
          </div>
          <PropertyChip tone="surface" data-property-card-status={statusLabel} className="shrink-0">
            {statusLabel}
          </PropertyChip>
        </div>
        {photoCount > 0 && (
          <PropertyChip tone="surface" className="pointer-events-none absolute bottom-2 right-2 z-20 gap-1">
            <Camera className="h-3 w-3" aria-hidden="true" />
            {photoCount}
          </PropertyChip>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col p-3.5">
        <button
          type="button"
          aria-label={`Ver detalhes de ${propertyLabel}`}
          onClick={openProperty}
          className="min-w-0 w-full rounded-[6px] text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
        >
          <div className="flex min-w-0 items-baseline justify-between gap-2">
            <p
              className={cn(
                "min-w-0 break-words text-[17px] font-normal leading-tight text-[var(--app-text-primary)] [overflow-wrap:anywhere]",
                isUnavailable && "text-[var(--app-text-tertiary)] line-through",
              )}
            >
              {formatPrice(displayPrice, isRentalIntent ? "Aluguel" : property.tipo_de_negocio)}
            </p>
            {perSquareMeter !== null && (
              <span className="shrink-0 whitespace-nowrap text-[11px] font-light text-[var(--app-text-tertiary)]">
                {formatPropertyMoney(perSquareMeter)}/m²
              </span>
            )}
          </div>
          <h3 className="mt-2 line-clamp-2 text-[13px] font-light leading-[18px] text-[var(--app-text-primary)]">
            {property.title ||
              `${displayPropertyType || "Imóvel"} em ${property.bairro || property.cidade || "localização não informada"}`}
          </h3>
          {location && (
            <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[12px] font-light text-[var(--app-text-secondary)]">
              <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{location}</span>
            </p>
          )}
        </button>

        {attributes.length > 0 && (
          <ul className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 border-t border-[var(--app-border)] pt-2.5 text-[12px] font-light text-[var(--app-text-secondary)]">
            {attributes.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-1">
                <Icon className="h-3 w-3" aria-hidden="true" />
                {label}
              </li>
            ))}
          </ul>
        )}

        {(ownerLabel || responsible) && (
          <div className="mt-2.5 flex min-h-7 items-center justify-between gap-2">
            {ownerLabel ? (
              <div className="min-w-0">
                <p className="text-[11px] font-light text-[var(--app-text-tertiary)]">Proprietário</p>
                <p className="truncate text-[12px] font-light text-[var(--app-text-primary)]">{ownerLabel}</p>
              </div>
            ) : <span />}
            {responsible && <ResponsibleAvatar name={responsible.name} avatarUrl={responsible.avatarUrl} />}
          </div>
        )}

        <div className="mt-auto flex items-center justify-between gap-2 pt-2.5">
          <div className="flex min-w-0 flex-wrap gap-1">
            {canonicalSiteState ? (
              <PropertyChip tone={SITE_TONES[canonicalSiteState.tone] ?? "neutral"}>{canonicalSiteState.label}</PropertyChip>
            ) : (
              <PropertyChip tone={isSitePublished ? "success" : "neutral"}>{isSitePublished ? "Site" : "Fora do site"}</PropertyChip>
            )}
            {property.portfolio_type === "third_party" && <PropertyChip tone="primary">Terceiro</PropertyChip>}
          </div>
          <PropertyCardMenu
            property={property}
            propertyLabel={propertyLabel}
            propertySiteUrl={propertySiteUrl}
            statusKind={statusKind}
            isSaleIntent={isSaleIntent}
            isRentalIntent={isRentalIntent}
            canEdit={canEdit}
            canRunAvailabilityActions={canUpdateAvailability ?? canEdit}
            canDelete={canDelete ?? canEdit}
            onEdit={onEdit}
            onDelete={onDelete}
            onPreview={onPreview}
            onOpenDetails={onOpenDetails}
            onHistory={onHistory}
            onChangeStatus={onChangeStatus}
            onOpenPublication={onOpenPublication}
          />
        </div>
      </div>
    </article>
  );
}
