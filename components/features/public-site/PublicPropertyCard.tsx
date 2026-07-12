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
  const image = property.imagem_principal || property.fotos?.[0] || "/placeholder.svg";
  const purpose = getPropertyPurpose(property);
  const type = property.tipo_imovel?.trim();

  return (
    <Link
      href={buildSiteHref(basePath, `/imoveis/${code}`)}
      className="group flex h-full flex-col overflow-hidden rounded-lg transition hover:-translate-y-1"
      style={{
        backgroundColor: tokens.card,
      }}
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-slate-200">
        <img
          src={image}
          alt={title}
          className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
          loading="lazy"
          decoding="async"
        />
        <span
          className="absolute left-3 top-3 rounded-md px-3 py-1 text-xs font-light uppercase tracking-wide text-white"
          style={{ backgroundColor: tokens.primary }}
        >
          {purpose}
        </span>
        <FavoriteButton
          organizationId={site.organization_id}
          propertyId={property.id}
          className="absolute right-3 top-3"
        />
      </div>

      <div className="flex flex-1 flex-col p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="inline-flex h-6 items-center rounded-md px-2.5 text-[11px] font-light uppercase tracking-wide text-white"
            style={{ backgroundColor: tokens.primary }}
          >
            {code}
          </span>
          {type ? (
            <span
              className="inline-flex h-6 items-center rounded-md px-2.5 text-[11px] font-light uppercase tracking-wide text-white"
              style={{ backgroundColor: tokens.primary }}
            >
              {type}
            </span>
          ) : null}
        </div>
        <h3 className="mt-2 min-h-12 text-base font-semibold leading-snug" style={{ color: tokens.foreground }}>
          {title}
        </h3>

        {location ? (
          <p className="mt-2 flex items-center gap-2 text-sm opacity-70" style={{ color: tokens.foreground }}>
            <MapPin className="h-4 w-4 shrink-0" />
            <span className="truncate">{location}</span>
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-3 text-sm opacity-75" style={{ color: tokens.foreground }}>
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
              {property.area_construida || property.area_total}m2
            </span>
          ) : null}
        </div>

        <div className="mt-auto pt-5">
          <p className="text-xl font-light" style={{ color: tokens.primary }}>
            {formatPrice(price)}
            {property.valor_aluguel && !property.valor_venda ? (
              <span className="ml-1 text-sm font-normal opacity-70">/mes</span>
            ) : null}
          </p>
        </div>
      </div>
    </Link>
  );
}
