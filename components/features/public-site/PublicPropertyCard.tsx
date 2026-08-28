/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { Bath, BedDouble, Car, MapPin, Maximize2 } from "lucide-react";

import type { PublicProperty, PublicSiteConfig } from "@/lib/api/public-site-server";
import {
  buildSiteHref,
  formatPrice,
  getPropertyCode,
  getPropertyLocation,
  getPropertyPrice,
  getPropertyPurpose,
  getPropertyTitle,
  getThemeTokens,
  normalizePublicImageUrl,
} from "./public-site-utils";
import { FavoriteButton } from "./FavoriteButton";

export function PublicPropertyCard({
  basePath,
  property,
  site,
}: Readonly<{
  basePath: string;
  property: PublicProperty;
  site: PublicSiteConfig;
}>) {
  const tokens = getThemeTokens(site);
  const title = getPropertyTitle(property);
  const code = getPropertyCode(property);
  const price = getPropertyPrice(property);
  const location = getPropertyLocation(property);
  const image = normalizePublicImageUrl(
    property.imagem_principal || property.fotos?.[0],
    "/placeholder.svg",
  );
  const purpose = getPropertyPurpose(property);
  const type = property.tipo_imovel?.trim();
  const propertyHref = buildSiteHref(basePath, `/imoveis/${encodeURIComponent(code)}`);

  return (
    <article
      className="flex h-full flex-col overflow-hidden rounded-lg"
      style={{
        backgroundColor: tokens.card,
        color: tokens.cardForeground,
      }}
    >
      <div className="relative aspect-[4/3] overflow-hidden" style={{ backgroundColor: tokens.secondary }}>
        <Link
          href={propertyHref}
          aria-label={`Ver detalhes de ${title}`}
          className="block h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--site-accent)]"
        >
          <img
            src={image}
            alt={`Foto principal de ${title}`}
            className="h-full w-full object-cover"
            loading="lazy"
            decoding="async"
          />
        </Link>
        <span
          className="pointer-events-none absolute left-3 top-3 rounded-md px-3 py-1 text-xs font-light"
          style={{ backgroundColor: tokens.primary, color: tokens.primaryForeground }}
        >
          {purpose}
        </span>
        <FavoriteButton
          organizationId={site.organization_id}
          propertyId={property.id}
          className="absolute right-3 top-3 bg-[var(--site-inverse)] text-[var(--site-inverse-fg)] hover:[transform:none] hover:bg-[var(--site-inverse-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--site-accent)] focus-visible:ring-offset-2"
        />
      </div>

      <div className="flex flex-1 flex-col p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="inline-flex h-6 items-center rounded-md px-2.5 text-xs font-light"
            style={{ backgroundColor: tokens.primary, color: tokens.primaryForeground }}
          >
            {code}
          </span>
          {type ? (
            <span
              className="inline-flex h-6 items-center rounded-md px-2.5 text-xs font-light"
              style={{ backgroundColor: tokens.primary, color: tokens.primaryForeground }}
            >
              {type}
            </span>
          ) : null}
        </div>
        <h3 className="mt-2 min-h-10 text-sm font-normal leading-5">
          <Link
            href={propertyHref}
            className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--site-accent)]"
          >
            {title}
          </Link>
        </h3>

        {location ? (
          <p className="mt-2 flex items-center gap-2 text-xs font-light opacity-70">
            <MapPin className="h-4 w-4 shrink-0" />
            <span className="truncate">{location}</span>
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-3 text-xs font-light opacity-75">
          {property.quartos ? (
            <span className="inline-flex items-center gap-1">
              <BedDouble className="h-4 w-4" />
              {property.quartos}
            </span>
          ) : null}
          {property.banheiros ? (
            <span className="inline-flex items-center gap-1">
              <Bath className="h-4 w-4" />
              {property.banheiros}
            </span>
          ) : null}
          {property.vagas ? (
            <span className="inline-flex items-center gap-1">
              <Car className="h-4 w-4" />
              {property.vagas}
            </span>
          ) : null}
          {property.area_construida || property.area_total ? (
            <span className="inline-flex items-center gap-1">
              <Maximize2 className="h-4 w-4" />
              {property.area_construida || property.area_total} m²
            </span>
          ) : null}
        </div>

        <div className="mt-auto pt-5">
          <p className="text-sm font-normal" style={{ color: tokens.primary }}>
            {formatPrice(price)}
            {property.valor_aluguel && !property.valor_venda ? (
              <span className="ml-1 text-xs font-light opacity-70">/mês</span>
            ) : null}
          </p>
        </div>
      </div>
    </article>
  );
}
