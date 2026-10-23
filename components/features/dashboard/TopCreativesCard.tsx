"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ExternalLink, ImageOff, Images, Maximize2, Medal, Trophy, Video } from "lucide-react";

import { DashboardChartError } from "@/components/features/dashboard/DashboardChartError";
import { dashboardCreativeDisplayName } from "@/components/features/dashboard/creative-display";
import { getDashboardCreativeSafeUrl } from "@/components/features/dashboard/creative-thumbnail-url";
import { canOptimizeDashboardCreativeImage } from "@/components/features/dashboard/creative-image-optimization";
import { getDashboardStatsErrorDescription, getDashboardStatsFailureState, shouldDisplayCachedDashboardStats } from "@/components/features/dashboard/dashboard-stats-error";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useDashboardCreatives } from "@/hooks/use-dashboard-creatives";
import { useDashboardCreativeMedia } from "@/hooks/use-dashboard-creative-media";
import type {
  DashboardAPIFilters,
  DashboardCreativesResponse,
} from "@/lib/api/dashboard";
import { getDashboardFiltersQueryKey } from "@/lib/api/dashboard";

type TopCreativesCardProps = {
  filters: DashboardAPIFilters;
  filtersReady: boolean;
};

type TopCreative = DashboardCreativesResponse["creatives"][number];

function CreativeThumbnail({ creative, displayName, onUnavailable, onAvailable }: {
  creative: TopCreative;
  displayName: string;
  onUnavailable: () => void;
  onAvailable: () => void;
}) {
  const [sourceIndex, setSourceIndex] = useState(0);
  const [optimizationFailed, setOptimizationFailed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageSources = [creative.thumbnailUrl, creative.imageUrl]
    .map(getDashboardCreativeSafeUrl)
    .filter((source): source is string => Boolean(source))
    .filter((source, index, sources) => sources.indexOf(source) === index);
  const imageUrl = imageSources[sourceIndex] ?? null;

  useEffect(() => {
    if (imageSources.length > 0 || !containerRef.current) return;
    const container = containerRef.current;
    if (typeof IntersectionObserver === "undefined") {
      onUnavailable();
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        onUnavailable();
        observer.disconnect();
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [imageSources.length, onUnavailable]);

  return (
    <div ref={containerRef} className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-[6px] bg-[var(--app-surface-soft)]">
      {imageUrl ? (
        <Image
          src={imageUrl}
          alt={`Miniatura de ${displayName}`}
          fill
          sizes="56px"
          loading="lazy"
          unoptimized={optimizationFailed || !canOptimizeDashboardCreativeImage(imageUrl)}
          quality={75}
          referrerPolicy="no-referrer"
          className="object-contain"
          onLoad={onAvailable}
          onError={() => {
            if (!optimizationFailed && canOptimizeDashboardCreativeImage(imageUrl)) {
              setOptimizationFailed(true);
              return;
            }
            if (sourceIndex + 1 >= imageSources.length) onUnavailable();
            setOptimizationFailed(false);
            setSourceIndex(sourceIndex + 1);
          }}
        />
      ) : (
        <div className="flex flex-col items-center gap-1 px-2 text-center text-[10px] leading-3 text-[var(--app-text-tertiary)]">
          <ImageOff className="h-5 w-5" aria-hidden="true" />
          <span>Miniatura indisponível</span>
        </div>
      )}
      {creative.isVideo || creative.videoUrl ? (
        <span className="absolute bottom-1 right-1 flex items-center gap-1 rounded-[4px] bg-[var(--app-surface-solid)] px-1.5 py-0.5 text-[10px] text-[var(--app-text-primary)]">
          <Video className="h-3 w-3" aria-hidden="true" />
          Vídeo
        </span>
      ) : null}
    </div>
  );
}

function CreativeRow({ creative, rank, filters, rankingUpdatedAt, onRetryRanking }: {
  creative: TopCreative;
  rank: number;
  filters: DashboardAPIFilters;
  rankingUpdatedAt: number;
  onRetryRanking?: () => void;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [unavailableVersion, setUnavailableVersion] = useState<string | null>(null);
  const [refreshHint, setRefreshHint] = useState<string | null>(null);
  const mediaVersion = JSON.stringify([creative.thumbnailUrl, creative.imageUrl, creative.videoUrl, creative.instagramUrl, creative.permalinkUrl]);
  const { data: currentMedia, dataUpdatedAt: mediaUpdatedAt = 0, isError: mediaError, isAccessBlocked: mediaAccessBlocked, error: mediaQueryError, isFetching: mediaFetching, requestRefresh: refreshMedia } = useDashboardCreativeMedia(filters, creative.key, mediaVersion, rankingUpdatedAt);
  const mediaAccessDenied = mediaAccessBlocked || (mediaError && !shouldDisplayCachedDashboardStats(mediaQueryError));
  const displayCreative = mediaAccessDenied ? {
    ...creative, thumbnailUrl: null, imageUrl: null, videoUrl: null, instagramUrl: null, permalinkUrl: null,
  } : currentMedia ? {
    ...creative,
    thumbnailUrl: currentMedia.thumbnailUrl ?? currentMedia.imageUrl ?? creative.thumbnailUrl,
    imageUrl: currentMedia.imageUrl ?? currentMedia.thumbnailUrl ?? creative.imageUrl,
    videoUrl: currentMedia.videoUrl ?? creative.videoUrl,
    instagramUrl: currentMedia.instagramUrl ?? creative.instagramUrl,
    permalinkUrl: currentMedia.permalinkUrl ?? creative.permalinkUrl,
  } : creative;
  const displayMediaVersion = JSON.stringify([displayCreative.thumbnailUrl, displayCreative.imageUrl]);
  const displayMediaGeneration = currentMedia ? mediaUpdatedAt : rankingUpdatedAt;
  const requestRefresh = useCallback(() => {
    setUnavailableVersion(displayMediaVersion);
    if (!mediaAccessDenied) refreshMedia(displayMediaVersion);
  }, [displayMediaVersion, mediaAccessDenied, refreshMedia]);
  const retryRefresh = useCallback(() => {
    setRefreshHint(refreshMedia(displayMediaVersion, true) ? null : "Atualização recente. Tente novamente em instantes.");
  }, [displayMediaVersion, refreshMedia]);
  if (mediaAccessDenied) {
    return <div role="alert" className="rounded-[6px] bg-[var(--app-surface-soft)] p-3 text-[11px] text-[var(--app-text-secondary)]">
      <p>{getDashboardStatsErrorDescription(mediaQueryError)}</p>
      <button type="button" onClick={() => { onRetryRanking?.(); retryRefresh(); }} className="mt-1 min-h-7 rounded-[4px] px-1 py-1 text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">Tentar novamente</button>
    </div>;
  }
  const mediaStaleNotice = mediaError ? <p role="status" className="pb-2 text-[11px] text-[var(--app-text-secondary)]">Não foi possível atualizar a mídia. Exibindo os dados do ranking.</p> : null;
  const refreshControl = unavailableVersion === displayMediaVersion && !mediaAccessDenied ? (
    <p role="status" className="pb-2 text-[11px] text-[var(--app-text-secondary)]">
      {mediaFetching ? "Atualizando miniatura…" : <><button type="button" onClick={retryRefresh} className="min-h-7 rounded-[4px] px-1 py-1 text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">Atualizar miniatura</button>{refreshHint ? <span className="ml-1">{refreshHint}</span> : null}</>}
    </p>
  ) : null;
  const displayName = dashboardCreativeDisplayName(
    displayCreative.name,
    displayCreative.creativeId,
    displayCreative.adId,
    displayCreative.attributionLevel === "ad",
  );
  const campaignLabel = displayCreative.campaignName
    ? `${displayCreative.campaignName}${displayCreative.campaignCount > 1 ? ` +${displayCreative.campaignCount - 1}` : ""}`
    : displayCreative.campaignCount > 1
      ? `${displayCreative.campaignCount} campanhas`
      : "Campanha não identificada";
  const isVideo = displayCreative.isVideo || Boolean(displayCreative.videoUrl);
  const videoDestination = isVideo
    ? getDashboardCreativeSafeUrl(displayCreative.permalinkUrl)
      ?? getDashboardCreativeSafeUrl(displayCreative.instagramUrl)
      ?? getDashboardCreativeSafeUrl(displayCreative.videoUrl)
    : null;
  const imageSource = !isVideo
    ? getDashboardCreativeSafeUrl(displayCreative.imageUrl)
      ?? getDashboardCreativeSafeUrl(displayCreative.thumbnailUrl)
    : null;
  const actionLabel = `${rank}º lugar, ${displayName}, ${campaignLabel}, ${displayCreative.leadCount} ${displayCreative.leadCount === 1 ? "lead" : "leads"}. ${isVideo ? "Abrir vídeo" : "Visualizar imagem"}`;
  const rowClassName = "flex min-w-0 w-full gap-3 py-2 text-left";
  const interactiveClassName = `${rowClassName} rounded-[6px] transition-colors hover:bg-[var(--app-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary`;

  const content = (
    <>
      <CreativeThumbnail
        key={`${displayMediaVersion}|${displayMediaGeneration}`}
        creative={displayCreative}
        displayName={displayName}
        onUnavailable={requestRefresh}
        onAvailable={() => { setUnavailableVersion(null); setRefreshHint(null); }}
      />
      <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5 pr-1">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[10px] font-medium text-[var(--app-text-secondary)]">
            <span className="inline-flex items-center gap-1 rounded-[4px] bg-primary px-1.5 py-0.5 text-primary-foreground">
              {rank === 1 ? <Trophy className="h-3 w-3" aria-hidden="true" /> : null}
              {rank === 2 ? <Medal className="h-3 w-3" aria-hidden="true" /> : null}
              {rank}º lugar
            </span>
            <span>{displayCreative.attributionLevel === "ad" ? "Anúncio" : "Criativo"}</span>
          </div>
          <p className="line-clamp-1 break-words text-[12px] font-medium leading-4 text-[var(--app-text-primary)]" title={displayName}>
            {displayName}
          </p>
          <p className="mt-0.5 line-clamp-1 break-words text-[10px] leading-3 text-[var(--app-text-secondary)]" title={campaignLabel}>
            {campaignLabel}
          </p>
        </div>
        <p className="mt-1 flex items-center gap-1 text-[11px] text-[var(--app-text-secondary)]">
          <strong className="font-medium tabular-nums text-[var(--app-text-primary)]">{displayCreative.leadCount.toLocaleString("pt-BR")}</strong>{" "}
          {displayCreative.leadCount === 1 ? "lead" : "leads"}
          {videoDestination ? <ExternalLink className="ml-auto h-3 w-3 shrink-0 text-primary" aria-hidden="true" /> : null}
          {imageSource ? <Maximize2 className="ml-auto h-3 w-3 shrink-0 text-primary" aria-hidden="true" /> : null}
        </p>
      </div>
    </>
  );

  if (videoDestination) {
    return <><a href={videoDestination} target="_blank" rel="noopener noreferrer" aria-label={actionLabel} className={interactiveClassName}>{content}</a>{mediaStaleNotice}{refreshControl}</>;
  }
  if (imageSource) {
    return <>
      <button type="button" onClick={() => setPreviewOpen(true)} aria-label={actionLabel} className={interactiveClassName}>{content}</button>
      {mediaStaleNotice}
      {refreshControl}
      {previewOpen ? (
        <CreativeImageDialog
          key={`${displayCreative.key}|${displayMediaVersion}|${displayMediaGeneration}`}
          creative={displayCreative}
          onClose={() => setPreviewOpen(false)}
          onUnavailable={requestRefresh}
          onRetry={retryRefresh}
          isRefreshing={mediaFetching}
          refreshHint={refreshHint}
        />
      ) : null}
    </>;
  }
  return <><div className={rowClassName}>{content}</div>{mediaStaleNotice}{refreshControl}</>;
}

function CreativeImageDialog({ creative, onClose, onUnavailable, onRetry, isRefreshing, refreshHint }: { creative: TopCreative | null; onClose: () => void; onUnavailable: () => void; onRetry: () => void; isRefreshing: boolean; refreshHint: string | null }) {
  const [sourceIndex, setSourceIndex] = useState(0);
  const [optimizationFailed, setOptimizationFailed] = useState(false);
  const imageSources = creative
    ? [creative.imageUrl, creative.thumbnailUrl]
      .map(getDashboardCreativeSafeUrl)
      .filter((source): source is string => Boolean(source))
      .filter((source, index, sources) => sources.indexOf(source) === index)
    : [];
  const imageUrl = imageSources[sourceIndex] ?? null;
  const originalImageUrl = imageSources[0] ?? null;
  const postUrl = creative
    ? getDashboardCreativeSafeUrl(creative.permalinkUrl)
      ?? getDashboardCreativeSafeUrl(creative.instagramUrl)
    : null;
  const title = creative
    ? dashboardCreativeDisplayName(creative.name, creative.creativeId, creative.adId, creative.attributionLevel === "ad")
    : "Imagem do criativo";

  return (
    <Dialog open={Boolean(creative && imageSources.length)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] w-[min(96vw,860px)] max-w-[860px] overflow-y-auto rounded-[8px] p-4 sm:p-5">
        <DialogHeader className="min-w-0 pr-6 text-left">
          <DialogTitle className="break-words text-[15px] font-medium leading-5">{title}</DialogTitle>
          <DialogDescription className="break-words text-[11px]">
            {creative?.campaignName ?? "Campanha não identificada"} · {creative?.leadCount.toLocaleString("pt-BR") ?? 0} {creative?.leadCount === 1 ? "lead" : "leads"}
          </DialogDescription>
        </DialogHeader>
        <div className="relative flex h-[58vh] min-h-[240px] max-h-[650px] items-center justify-center overflow-hidden rounded-[6px] bg-[var(--app-surface-soft)]">
          {imageUrl ? (
            <Image src={imageUrl} alt={`Imagem de ${title}`} fill sizes="(max-width: 640px) 96vw, 860px" quality={75} unoptimized={optimizationFailed || !canOptimizeDashboardCreativeImage(imageUrl)} referrerPolicy="no-referrer" className="object-contain" onError={() => {
              if (!optimizationFailed && canOptimizeDashboardCreativeImage(imageUrl)) { setOptimizationFailed(true); return; }
              if (sourceIndex + 1 >= imageSources.length) onUnavailable();
              setOptimizationFailed(false);
              setSourceIndex((current) => current + 1);
            }} />
          ) : (
            <div role="status" className="flex flex-col items-center gap-2 px-3 text-center text-[12px] text-[var(--app-text-secondary)]">
              <p className="flex items-center gap-2"><ImageOff className="h-4 w-4" aria-hidden="true" />Imagem indisponível</p>
              <button type="button" onClick={onRetry} disabled={isRefreshing} className="min-h-9 rounded-[6px] px-3 text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50">{isRefreshing ? "Atualizando imagem…" : "Atualizar imagem"}</button>
              {refreshHint ? <p className="text-[11px]">{refreshHint}</p> : null}
            </div>
          )}
        </div>
        {originalImageUrl || postUrl ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {originalImageUrl ? (
              <a href={originalImageUrl} target="_blank" rel="noopener noreferrer" className="inline-flex w-fit items-center gap-1 text-[11px] font-medium text-primary underline-offset-2 hover:underline">
                Abrir imagem em nova aba <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            ) : null}
            {postUrl && postUrl !== originalImageUrl ? (
              <a href={postUrl} target="_blank" rel="noopener noreferrer" className="inline-flex w-fit items-center gap-1 text-[11px] font-medium text-primary underline-offset-2 hover:underline">
                Abrir publicação <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function TopCreativesSkeleton() {
  return (
    <div aria-label="Carregando criativos com mais leads" className="space-y-1">
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="flex gap-3 py-2">
          <Skeleton className="h-14 w-14 shrink-0 rounded-[6px]" />
          <div className="flex min-w-0 flex-1 flex-col justify-between py-1">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function TopCreativesCard({ filters, filtersReady }: TopCreativesCardProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const [nearViewport, setNearViewport] = useState(false);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    if (typeof IntersectionObserver === "undefined") {
      let cancelled = false;
      queueMicrotask(() => {
        if (!cancelled) setNearViewport(true);
      });
      return () => { cancelled = true; };
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setNearViewport(true);
        observer.disconnect();
      }
    }, { rootMargin: "320px 0px" });
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  const { data, dataUpdatedAt = 0, isPending, isError, isAccessBlocked, error, refetch } = useDashboardCreatives(filters, {
    enabled: filtersReady && nearViewport,
  });
  const failureState = isAccessBlocked ? "unavailable" : getDashboardStatsFailureState(data !== undefined, isError, error);
  const visibleData = failureState === "unavailable" ? undefined : data;
  const loading = !visibleData && (!filtersReady || !nearViewport || isPending);
  const filterScope = JSON.stringify(getDashboardFiltersQueryKey(filters));

  return (
    <section ref={sectionRef} aria-labelledby="dashboard-creatives-title" className="h-full min-w-0">
      <Card className="h-full min-w-0 overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
        <CardHeader className="px-3 pb-2 pt-3">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <CardTitle id="dashboard-creatives-title" className="flex min-w-0 items-center gap-2 text-[13px] font-light text-[var(--app-text-primary)]">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
                <Images className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              <span className="min-w-0 leading-4">Criativos que mais geraram leads</span>
            </CardTitle>
            {visibleData?.creatives.length ? (
              <span className="shrink-0 rounded-[6px] bg-[var(--app-surface-soft)] px-2 py-1 text-[10px] text-[var(--app-text-secondary)]">
                Top {visibleData.creatives.length}
              </span>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="px-3 pb-3 pt-1">
          {failureState === "stale" ? <p role="status" className="mb-2 text-[11px] text-[var(--app-text-secondary)]">Não foi possível atualizar. Exibindo a última consulta. <button type="button" className="text-primary underline" onClick={() => void refetch()}>Tentar novamente</button></p> : null}
          {failureState === "unavailable" ? (
            <DashboardChartError message={getDashboardStatsErrorDescription(error)} onRetry={() => void refetch()} />
          ) : loading ? (
            <TopCreativesSkeleton />
          ) : !visibleData?.creatives.length ? (
            <p className="py-8 text-center text-[12px] font-light text-[var(--app-text-secondary)]">
              Nenhum criativo ou anúncio identificado para os filtros selecionados.
            </p>
          ) : (
            <div role="region" aria-label="Ranking de criativos, lista rolável" tabIndex={visibleData.creatives.length > 5 ? 0 : undefined} className="app-scrollbar max-h-[330px] overflow-y-auto overscroll-contain rounded-[6px] pr-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
              <div role="list" aria-label="Criativos com mais leads">
                {visibleData.creatives.map((creative, index) => (
                  <div key={`${filterScope}:${creative.key}`} role="listitem" className="border-b border-[var(--app-border)] last:border-b-0">
                    <CreativeRow creative={creative} rank={index + 1} filters={filters} rankingUpdatedAt={dataUpdatedAt} onRetryRanking={() => void refetch()} />
                  </div>
                ))}
              </div>
            </div>
          )}
          {visibleData?.creatives.length ? (
            <p className="mt-2 text-[10px] font-light text-[var(--app-text-tertiary)]">
              Leads distintos por criativo. Reentradas podem aparecer em mais de um; criativos sem leads atribuídos ficam fora do ranking.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
