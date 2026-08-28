"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Heart } from "lucide-react";

import { publicSiteAPI } from "@/lib/api/public-site";
import type { PublicPropertiesData, PublicProperty, PublicSiteConfig } from "@/lib/api/public-site-server";
import { PublicPropertyCard } from "./PublicPropertyCard";
import { buildSiteHref } from "./public-site-utils";
import { getPublicFavoriteIds } from "./FavoriteButton";

const MAX_FAVORITES_PER_REQUEST = 60;
const SAFE_PROPERTY_ID_PATTERN = /^[\w-]{1,100}$/;

type PublicFavoritesClientProps = Readonly<{
  basePath: string;
  site: PublicSiteConfig;
}>;

export function PublicFavoritesClient({ basePath, site }: PublicFavoritesClientProps) {
  const favoriteKey = useSyncExternalStore(subscribeFavorites, () => getPublicFavoriteIds(site.organization_id).join(","), () => "");
  const favoriteIds = useMemo(
    () => favoriteKey
      .split(",")
      .map((id) => id.trim())
      .filter((id, index, values) => SAFE_PROPERTY_ID_PATTERN.test(id) && values.indexOf(id) === index)
      .slice(0, MAX_FAVORITES_PER_REQUEST),
    [favoriteKey],
  );
  const requestIds = useMemo(() => favoriteIds.join(","), [favoriteIds]);
  const [properties, setProperties] = useState<PublicProperty[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let active = true;

    async function loadFavorites() {
      if (!requestIds) {
        setProperties([]);
        setLoadError(false);
        setLoading(false);
        return;
      }

      setLoading(true);
      setLoadError(false);
      setProperties((current) => current.filter((property) => favoriteIds.includes(property.id)));
      try {
        const data = await publicSiteAPI.getData<PublicPropertiesData>({
          endpoint: "properties",
          ids: requestIds,
          limit: favoriteIds.length,
          organization_id: site.organization_id,
        });
        if (!active) return;

        const byId = new Map(data.properties.map((property) => [property.id, property]));
        setProperties(favoriteIds.map((id) => byId.get(id)).filter((property): property is PublicProperty => Boolean(property)));
      } catch {
        if (active) setLoadError(true);
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadFavorites();

    return () => {
      active = false;
    };
  }, [favoriteIds, requestIds, retryCount, site.organization_id]);

  const hasFavorites = favoriteIds.length > 0;
  const missingCount = useMemo(() => Math.max(0, favoriteIds.length - properties.length), [favoriteIds.length, properties.length]);

  if (!hasFavorites) {
    return (
      <FavoriteEmptyState
        basePath={basePath}
        description="Abra os imóveis e toque no coração para montar sua lista neste navegador."
        title="Nenhum favorito salvo ainda"
      />
    );
  }

  if (loading && properties.length === 0) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="mx-auto flex min-h-56 max-w-2xl items-center justify-center rounded-lg bg-[var(--site-card)] p-8 text-center text-xs font-light text-[var(--site-card-fg)]"
      >
        Carregando favoritos…
      </div>
    );
  }

  if (loadError && properties.length === 0) {
    return <FavoriteLoadError onRetry={() => setRetryCount((current) => current + 1)} />;
  }

  return (
    <div className="space-y-6">
      {loadError ? (
        <div
          role="alert"
          className="flex flex-col items-start justify-between gap-3 rounded-lg bg-[var(--site-card)] p-4 text-xs font-light text-[var(--site-card-fg)] sm:flex-row sm:items-center"
        >
          <p>Não foi possível atualizar a lista. Os últimos favoritos carregados continuam visíveis.</p>
          <button
            type="button"
            onClick={() => setRetryCount((current) => current + 1)}
            className="inline-flex h-9 shrink-0 items-center justify-center rounded-md bg-[var(--site-primary)] px-3 text-xs font-light text-[var(--site-primary-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--site-accent)] focus-visible:ring-offset-2"
          >
            Tentar novamente
          </button>
        </div>
      ) : null}

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
          title="Favoritos indisponíveis"
        />
      )}

      {!loadError && !loading && missingCount > 0 ? (
        <p className="text-center text-xs font-light opacity-65">
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
  title,
}: Readonly<{
  basePath: string;
  description: string;
  title: string;
}>) {
  return (
    <div className="mx-auto max-w-2xl rounded-lg bg-[var(--site-card)] p-8 text-center text-[var(--site-card-fg)]">
      <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-md bg-[var(--site-secondary)] text-[var(--site-secondary-fg)]">
        <Heart className="h-5 w-5" />
      </span>
      <h2 className="mt-5 text-sm font-normal">{title}</h2>
      <p className="mx-auto mt-3 max-w-lg text-xs font-light leading-5 opacity-70">{description}</p>
      <Link
        href={buildSiteHref(basePath, "/imoveis")}
        className="mt-6 inline-flex h-10 items-center justify-center rounded-md bg-[var(--site-primary)] px-5 text-xs font-light text-[var(--site-primary-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--site-accent)] focus-visible:ring-offset-2"
      >
        Ver imóveis
      </Link>
    </div>
  );
}

function FavoriteLoadError({ onRetry }: Readonly<{ onRetry: () => void }>) {
  return (
    <div
      role="alert"
      className="mx-auto max-w-2xl rounded-lg bg-[var(--site-card)] p-8 text-center text-[var(--site-card-fg)]"
    >
      <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-md bg-[var(--site-secondary)] text-[var(--site-secondary-fg)]">
        <Heart className="h-5 w-5" />
      </span>
      <h2 className="mt-5 text-sm font-normal">Não foi possível carregar os favoritos</h2>
      <p className="mx-auto mt-3 max-w-lg text-xs font-light leading-5 opacity-70">
        Verifique sua conexão e tente novamente.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-6 inline-flex h-10 items-center justify-center rounded-md bg-[var(--site-primary)] px-5 text-xs font-light text-[var(--site-primary-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--site-accent)] focus-visible:ring-offset-2"
      >
        Tentar novamente
      </button>
    </div>
  );
}
