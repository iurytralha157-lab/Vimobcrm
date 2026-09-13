import {
  AlertCircle,
  Globe2,
  LocateFixed,
  MapPin,
  RefreshCw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { VisitorMap } from "@/components/features/site/VisitorMap";
import { getLocationLabel } from "@/components/features/site/analytics/location-format";
import type { LocationData } from "@/hooks/use-lead-analytics";
import { cn } from "@/lib/utils";

interface SiteVisitorOriginsCardProps {
  locations: LocationData[];
  isPending: boolean;
  isError: boolean;
  hasStaleError: boolean;
  isFetching: boolean;
  onRetry: () => void;
}

function hasCoordinates(location: LocationData) {
  return Number.isFinite(location.lat) && Number.isFinite(location.lng);
}

export function SiteVisitorOriginsCard({
  locations,
  isPending,
  isError,
  hasStaleError,
  isFetching,
  onRetry,
}: SiteVisitorOriginsCardProps) {
  const rankedLocations = [...locations]
    .filter((location) => location.sessions > 0)
    .sort((a, b) => b.sessions - a.sessions);
  const preciseLocationCount = rankedLocations.filter(hasCoordinates).length;
  const approximateLocationCount =
    rankedLocations.length - preciseLocationCount;
  const largestLocation = rankedLocations[0]?.sessions || 1;

  return (
    <Card
      className="app-card overflow-hidden"
      data-testid="site-visitor-origins-card"
    >
      <CardHeader className="border-b border-[var(--app-border)] pb-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm font-normal text-[var(--app-text-primary)]">
              <Globe2 className="h-4 w-4 text-primary" aria-hidden="true" />
              Origem geográfica das visitas
            </CardTitle>
            <p className="mt-1 text-xs font-light text-[var(--app-text-tertiary)]">
              Entenda de onde vêm as sessões e onde concentrar campanhas e
              atendimento.
            </p>
          </div>
          {!isPending && !isError && rankedLocations.length > 0 ? (
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-emerald-500/[0.09] px-2.5 py-1 text-[11px] font-normal text-emerald-700 dark:text-emerald-300">
              <LocateFixed className="h-3 w-3" aria-hidden="true" />
              {rankedLocations.length}{" "}
              {rankedLocations.length === 1
                ? "origem identificada"
                : "origens identificadas"}
            </span>
          ) : null}
        </div>
      </CardHeader>

      {hasStaleError ? (
        <div
          role="status"
          className="flex flex-col gap-2 border-b border-amber-500/15 bg-amber-500/[0.07] px-4 py-2.5 text-[11px] text-[var(--app-text-secondary)] sm:flex-row sm:items-center sm:justify-between"
        >
          <span>
            O mapa mantém o último recorte válido, mas a atualização das
            localizações falhou.
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRetry}
            disabled={isFetching}
            className="h-7 w-fit gap-1.5 rounded-[6px] bg-[var(--app-surface-solid)] px-2.5 text-[10px] shadow-none hover:bg-[var(--app-surface-hover)]"
          >
            <RefreshCw
              className={cn("h-3 w-3", isFetching && "animate-spin")}
              aria-hidden="true"
            />
            {isFetching ? "Atualizando" : "Atualizar mapa"}
          </Button>
        </div>
      ) : null}

      <CardContent className="p-0">
        {isPending ? (
          <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(270px,0.55fr)]">
            <Skeleton className="h-[350px] rounded-[8px]" />
            <div className="space-y-3">
              <Skeleton className="h-20 rounded-[8px]" />
              {[1, 2, 3, 4].map((item) => (
                <Skeleton key={item} className="h-12 rounded-[8px]" />
              ))}
            </div>
          </div>
        ) : isError ? (
          <div className="flex min-h-[300px] flex-col items-center justify-center px-6 py-10 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-amber-500/[0.09] text-amber-600 dark:text-amber-300">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
            </span>
            <p className="mt-3 text-sm font-normal text-[var(--app-text-primary)]">
              Não foi possível carregar a origem geográfica
            </p>
            <p className="mt-1 max-w-md text-xs font-light leading-5 text-[var(--app-text-tertiary)]">
              As demais métricas continuam disponíveis. Tente atualizar apenas
              esta análise.
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onRetry}
              disabled={isFetching}
              className="mt-4 h-8 gap-1.5 rounded-[6px] bg-[var(--app-surface-soft)] px-3 text-xs shadow-none hover:bg-[var(--app-surface-hover)]"
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", isFetching && "animate-spin")}
                aria-hidden="true"
              />
              {isFetching ? "Atualizando" : "Tentar novamente"}
            </Button>
          </div>
        ) : rankedLocations.length === 0 ? (
          <div className="flex min-h-[300px] flex-col items-center justify-center px-6 py-10 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-[var(--app-surface-soft)] text-[var(--app-text-tertiary)]">
              <MapPin className="h-4 w-4" aria-hidden="true" />
            </span>
            <p className="mt-3 text-sm font-normal text-[var(--app-text-primary)]">
              Ainda não há localização disponível
            </p>
            <p className="mt-1 max-w-md text-xs font-light leading-5 text-[var(--app-text-tertiary)]">
              O mapa será preenchido quando o provedor do site informar o país
              ou as coordenadas aproximadas das novas sessões.
            </p>
          </div>
        ) : (
          <div className="grid min-w-0 lg:grid-cols-[minmax(0,1.45fr)_minmax(270px,0.55fr)]">
            <div className="min-w-0 p-3 sm:p-4">
              <div className="h-[350px] min-w-0">
                <VisitorMap locations={rankedLocations} />
              </div>
              <p className="mt-2 flex items-start gap-1.5 text-[10px] font-light leading-4 text-[var(--app-text-tertiary)]">
                <MapPin
                  className="mt-0.5 h-3 w-3 shrink-0"
                  aria-hidden="true"
                />
                Coordenadas são aproximadas. Quando só o país é informado e há
                um centro cadastrado, o ponto representa o centro do país; os
                demais registros permanecem na lista.
              </p>
            </div>

            <aside className="border-t border-[var(--app-border)] p-4 lg:border-l lg:border-t-0">
              <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-3.5">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-[var(--app-text-secondary)]">
                    Precisão disponível
                  </span>
                  <MapPin
                    className="h-3.5 w-3.5 text-[var(--app-text-tertiary)]"
                    aria-hidden="true"
                  />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
                  <div>
                    <p className="text-[var(--app-text-tertiary)]">
                      Coordenadas
                    </p>
                    <p className="mt-0.5 text-xs font-normal text-[var(--app-text-primary)]">
                      {preciseLocationCount.toLocaleString("pt-BR")}{" "}
                      {preciseLocationCount === 1 ? "origem" : "origens"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[var(--app-text-tertiary)]">
                      Sem coordenadas
                    </p>
                    <p className="mt-0.5 text-xs font-normal text-[var(--app-text-primary)]">
                      {approximateLocationCount.toLocaleString("pt-BR")}{" "}
                      {approximateLocationCount === 1 ? "origem" : "origens"}
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-normal text-[var(--app-text-primary)]">
                    Principais origens
                  </p>
                  <span className="text-[10px] text-[var(--app-text-tertiary)]">
                    sessões
                  </span>
                </div>
                <div className="mt-2 space-y-1">
                  {rankedLocations.slice(0, 6).map((location, index) => {
                    const relativeWidth = Math.max(
                      4,
                      Math.round((location.sessions * 100) / largestLocation),
                    );
                    return (
                      <div
                        key={[
                          location.city,
                          location.region,
                          location.country,
                          index,
                        ].join(":")}
                        className="rounded-[7px] px-2 py-2 hover:bg-[var(--app-surface-soft)]"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)] text-[10px] text-[var(--app-text-secondary)]">
                            {index + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-[11px] text-[var(--app-text-secondary)]">
                                {getLocationLabel(location)}
                              </span>
                              <span className="shrink-0 text-[11px] font-normal text-[var(--app-text-primary)]">
                                {location.sessions.toLocaleString("pt-BR")}
                              </span>
                            </div>
                            <div className="mt-1 h-1 overflow-hidden rounded-full bg-[var(--app-surface-soft)]">
                              <div
                                className="h-full rounded-full bg-primary/60"
                                style={{ width: String(relativeWidth) + "%" }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </aside>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
