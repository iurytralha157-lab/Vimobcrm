"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Heart } from "lucide-react";

import { publicSiteAPI } from "@/lib/api/public-site";
import type { PublicPropertiesData, PublicProperty, PublicSiteConfig } from "@/lib/api/public-site-server";
import { PublicPropertyCard } from "./PublicPropertyCard";
import { buildSiteHref, getThemeTokens } from "./public-site-utils";
import { getPublicFavoriteIds } from "./FavoriteButton";

type PublicFavoritesClientProps = Readonly<{
  basePath: string;
  site: PublicSiteConfig;
}>;

export function PublicFavoritesClient({ basePath, site }: PublicFavoritesClientProps) {
  const tokens = getThemeTokens(site);
  const favoriteKey = useSyncExternalStore(subscribeFavorites, () => getPublicFavoriteIds(site.organization_id).join(","), () => "");
  const favoriteIds = useMemo(() => (favoriteKey ? favoriteKey.split(",").filter(Boolean) : []), [favoriteKey]);
  const [properties, setProperties] = useState<PublicProperty[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadFavorites() {
      if (!favoriteKey) {
        setProperties([]);
        return;
      }

      setLoading(true);
      try {
        const data = await publicSiteAPI.getData<PublicPropertiesData>({
          endpoint: "properties",
          ids: favoriteKey,
          limit: Math.min(favoriteIds.length, 60) || 1,
          organization_id: site.organization_id,
        });
        if (!active) return;

        const byId = new Map(data.properties.map((property) => [property.id, property]));
        setProperties(favoriteIds.map((id) => byId.get(id)).filter((property): property is PublicProperty => Boolean(property)));
      } catch {
        if (active) setProperties([]);
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadFavorites();

    return () => {
      active = false;
    };
  }, [favoriteIds, favoriteKey, site.organization_id]);

  const hasFavorites = favoriteIds.length > 0;
  const missingCount = useMemo(() => Math.max(0, favoriteIds.length - properties.length), [favoriteIds.length, properties.length]);

  if (!hasFavorites) {
    return (
      <FavoriteEmptyState
        basePath={basePath}
        description="Abra os imóveis e toque no coração para montar sua lista neste navegador."
        iconColor={tokens.primary}
        title="Nenhum favorito salvo ainda"
      />
    );
  }

  if (loading && properties.length === 0) {
    return (
      <div className="flex min-h-56 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-current/15 border-t-current" style={{ color: tokens.primary }} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {properties.length > 0 ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {properties.map((property) => (
            <PublicPropertyCard key={property.id} basePath={basePath} property={property} site={site} />
          ))}
        </div>
      ) : (
        <FavoriteEmptyState
          basePath={basePath}
          description="Os imóveis salvos podem ter sido removidos, vendidos ou retirados do site."
          iconColor={tokens.primary}
          title="Favoritos indisponíveis"
        />
      )}

      {missingCount > 0 ? (
        <p className="text-center text-sm font-light opacity-64">
          {missingCount} favorito(s) não estão mais disponíveis no site.
        </p>
      ) : null}
    </div>
  );
}

function subscribeFavorites(onStoreChange: () => void) {
  window.addEventListener("vimob:favorites-changed", onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener("vimob:favorites-changed", onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

function FavoriteEmptyState({
  basePath,
  description,
  iconColor,
  title,
}: Readonly<{
  basePath: string;
  description: string;
  iconColor: string;
  title: string;
}>) {
  return (
    <div className="mx-auto max-w-2xl rounded-[10px] bg-[var(--site-card)] p-8 text-center">
      <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-[10px] bg-white/8" style={{ color: iconColor }}>
        <Heart className="h-5 w-5" />
      </span>
      <h2 className="mt-5 text-2xl font-light">{title}</h2>
      <p className="mx-auto mt-3 max-w-lg text-sm font-light leading-6 opacity-70">{description}</p>
      <Link
        href={buildSiteHref(basePath, "/imoveis")}
        className="mt-6 inline-flex h-11 items-center justify-center rounded-[10px] px-5 text-sm font-light text-white"
        style={{ backgroundColor: iconColor }}
      >
        Ver imóveis
      </Link>
    </div>
  );
}
