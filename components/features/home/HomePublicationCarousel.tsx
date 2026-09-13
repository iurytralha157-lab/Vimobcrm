"use client";

import Image from "next/image";
import {
  AlertTriangle,
  BellRing,
  CalendarCheck2,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  Megaphone,
  MessageCircleMore,
  RefreshCw,
  Sparkles,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  Carousel,
  type CarouselApi,
  CarouselContent,
  CarouselItem,
} from "@/components/ui/carousel";
import { Skeleton } from "@/components/ui/skeleton";
import type { HomePublicationCard } from "@/lib/api/home";
import { cn } from "@/lib/utils";

type HomePublicationCarouselProps = {
  publications: HomePublicationCard[];
  isLoading: boolean;
  hasError?: boolean;
  onRetry?: () => void;
};

type PublicationVisual = {
  icon: LucideIcon;
  badge: string;
  artwork: string;
  detail: string;
};

const AUTO_ADVANCE_INTERVAL_MS = 8_000;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

const PUBLICATION_VISUALS: Record<
  HomePublicationCard["accent"],
  PublicationVisual
> = {
  orange: {
    icon: Sparkles,
    badge: "bg-primary/10 text-primary",
    artwork: "bg-primary/12 text-primary",
    detail: "bg-primary/20",
  },
  violet: {
    icon: Zap,
    badge: "bg-violet-500/10 text-violet-500",
    artwork: "bg-violet-500/10 text-violet-500",
    detail: "bg-violet-500/20",
  },
  blue: {
    icon: CalendarCheck2,
    badge: "bg-blue-500/10 text-blue-500",
    artwork: "bg-blue-500/10 text-blue-500",
    detail: "bg-blue-500/20",
  },
  emerald: {
    icon: MessageCircleMore,
    badge: "bg-emerald-500/10 text-emerald-500",
    artwork: "bg-emerald-500/10 text-emerald-500",
    detail: "bg-emerald-500/20",
  },
  amber: {
    icon: BellRing,
    badge: "bg-amber-500/10 text-amber-600",
    artwork: "bg-amber-500/10 text-amber-600",
    detail: "bg-amber-500/20",
  },
  slate: {
    icon: LayoutDashboard,
    badge: "bg-slate-500/10 text-slate-500",
    artwork: "bg-slate-500/10 text-slate-500",
    detail: "bg-slate-500/20",
  },
};

function PublicationArtwork({
  publication,
}: {
  publication: HomePublicationCard;
}) {
  const visual = PUBLICATION_VISUALS[publication.accent];
  const Icon = visual.icon;

  if (publication.imageUrl) {
    return (
      <div className="pointer-events-none absolute inset-0 sm:left-auto sm:w-[46%]">
        <Image
          src={publication.imageUrl}
          alt=""
          fill
          sizes="(max-width: 640px) 100vw, 450px"
          className="object-cover"
          unoptimized
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[var(--app-surface-solid)] via-[var(--app-surface-solid)]/90 to-[var(--app-surface-solid)]/35 sm:via-[var(--app-surface-solid)]/35 sm:to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--app-surface-solid)]/45 via-transparent to-transparent" />
      </div>
    );
  }

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 right-0 hidden w-[42%] overflow-hidden sm:block"
    >
      <div
        className={cn(
          "absolute -right-12 -top-14 h-48 w-48 rounded-full blur-2xl",
          visual.detail,
        )}
      />
      <div
        className={cn(
          "absolute right-10 top-1/2 flex h-24 w-24 -translate-y-1/2 items-center justify-center rounded-[18px]",
          visual.artwork,
        )}
      >
        <Icon className="h-10 w-10" strokeWidth={1.4} />
      </div>
      <div className="absolute bottom-7 right-28 h-9 w-9 rounded-[8px] bg-[var(--app-surface-soft)]" />
      <div
        className={cn(
          "absolute right-5 top-8 h-5 w-5 rounded-[6px]",
          visual.detail,
        )}
      />
    </div>
  );
}

function PublicationSlide({
  publication,
  index,
  total,
}: {
  publication: HomePublicationCard;
  index: number;
  total: number;
}) {
  const visual = PUBLICATION_VISUALS[publication.accent];

  return (
    <article
      aria-label={`${index + 1} de ${total}: ${publication.title}`}
      className="relative isolate flex min-h-[140px] overflow-hidden bg-[var(--app-surface-solid)] sm:min-h-[152px]"
    >
      <PublicationArtwork publication={publication} />

      <div
        className={cn(
          "relative z-10 flex w-full flex-col px-12 py-4 sm:max-w-[65%] sm:px-14 sm:py-4",
          publication.imageUrl && "max-w-[88%]",
        )}
      >
        <div
          className={cn(
            "inline-flex w-fit items-center gap-1.5 rounded-[6px] px-2.5 py-1 text-[10px] font-light uppercase tracking-[0.08em]",
            visual.badge,
          )}
        >
          <Megaphone className="h-3 w-3" strokeWidth={1.8} />
          Novidade
        </div>

        <h2 className="mt-2.5 max-w-xl text-balance text-[18px] font-normal leading-6 text-[var(--app-text-primary)] sm:text-[20px] sm:leading-7">
          {publication.title}
        </h2>
        <p className="mt-1.5 line-clamp-2 max-w-xl text-[12px] font-light leading-5 text-[var(--app-text-secondary)] sm:text-[13px]">
          {publication.body}
        </p>
      </div>
    </article>
  );
}

function PublicationCarouselSkeleton() {
  return (
    <section
      aria-label="Carregando novidades"
      className="overflow-hidden rounded-none bg-[var(--app-surface-solid)]"
    >
      <div className="min-h-[140px] px-12 py-4 sm:min-h-[152px] sm:px-14">
        <Skeleton className="h-6 w-24 rounded-[6px]" />
        <Skeleton className="mt-3 h-6 w-2/3" />
        <Skeleton className="mt-2 h-4 w-4/5" />
        <Skeleton className="mt-2 h-4 w-1/2" />
      </div>
    </section>
  );
}

function PublicationCarouselUnavailable({ onRetry }: { onRetry?: () => void }) {
  return (
    <section
      aria-label="Comunicados indisponíveis"
      role="status"
      className="flex min-h-[140px] items-center justify-between gap-4 overflow-hidden rounded-none bg-[var(--app-surface-solid)] px-5 py-4 sm:min-h-[152px] sm:px-8"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[8px] bg-destructive/10 text-destructive">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[14px] font-normal text-[var(--app-text-primary)]">
            Comunicados indisponíveis
          </h2>
          <p className="mt-1 text-[12px] font-light text-[var(--app-text-secondary)]">
            Não foi possível carregar os comunicados reais desta organização.
          </p>
        </div>
      </div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-[11px] font-light text-[var(--app-text-secondary)] shadow-none transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Tentar novamente
        </button>
      ) : null}
    </section>
  );
}

export function HomePublicationCarousel({
  publications,
  isLoading,
  hasError = false,
  onRetry,
}: HomePublicationCarouselProps) {
  const [api, setApi] = useState<CarouselApi>();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [slideCount, setSlideCount] = useState(0);
  const [isHovering, setIsHovering] = useState(false);
  const [isFocusWithin, setIsFocusWithin] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [isDocumentVisible, setIsDocumentVisible] = useState(true);

  const syncCarouselState = useCallback((carouselApi: CarouselApi) => {
    if (!carouselApi) return;
    setSelectedIndex(carouselApi.selectedScrollSnap());
    setSlideCount(carouselApi.scrollSnapList().length);
  }, []);

  useEffect(() => {
    if (!api) return undefined;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) syncCarouselState(api);
    });
    api.on("select", syncCarouselState);
    api.on("reInit", syncCarouselState);

    return () => {
      cancelled = true;
      api.off("select", syncCarouselState);
      api.off("reInit", syncCarouselState);
    };
  }, [api, syncCarouselState]);

  useEffect(() => {
    const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY);
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);
    updatePreference();
    mediaQuery.addEventListener("change", updatePreference);
    return () => mediaQuery.removeEventListener("change", updatePreference);
  }, []);

  useEffect(() => {
    const updateVisibility = () =>
      setIsDocumentVisible(document.visibilityState === "visible");
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    return () =>
      document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  const autoplayPaused =
    prefersReducedMotion || isHovering || isFocusWithin || !isDocumentVisible;

  useEffect(() => {
    if (!api || slideCount <= 1 || autoplayPaused) return undefined;
    const interval = window.setInterval(
      () => api.scrollNext(),
      AUTO_ADVANCE_INTERVAL_MS,
    );
    return () => window.clearInterval(interval);
  }, [api, autoplayPaused, slideCount]);

  if (isLoading) return <PublicationCarouselSkeleton />;
  if (hasError) return <PublicationCarouselUnavailable onRetry={onRetry} />;
  if (publications.length === 0) return null;

  const hasMultipleSlides = publications.length > 1;
  const activePublication = publications[selectedIndex] || publications[0];

  return (
    <section
      aria-label="Novidades e comunicados"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.currentTarget !== event.target) return;
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          api?.scrollPrev();
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          api?.scrollNext();
        }
      }}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      onFocusCapture={() => setIsFocusWithin(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsFocusWithin(false);
        }
      }}
      className="relative overflow-hidden rounded-none bg-[var(--app-surface-solid)] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30"
    >
      <p
        className="sr-only"
        aria-live={autoplayPaused ? "polite" : "off"}
        aria-atomic="true"
      >
        Comunicado {selectedIndex + 1} de {publications.length}:{" "}
        {activePublication.title}.
      </p>

      <Carousel
        opts={{ align: "start", loop: hasMultipleSlides }}
        setApi={setApi}
        aria-label="Carrossel de novidades da Página inicial"
      >
        <CarouselContent className="-ml-0">
          {publications.map((publication, index) => (
            <CarouselItem key={publication.id} className="pl-0">
              <PublicationSlide
                publication={publication}
                index={index}
                total={publications.length}
              />
            </CarouselItem>
          ))}
        </CarouselContent>

        {hasMultipleSlides ? (
          <>
            <button
              type="button"
              aria-label="Comunicado anterior"
              onClick={() => api?.scrollPrev()}
              className="absolute left-2 top-1/2 z-20 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-[6px] border-0 bg-[var(--app-surface-solid)]/80 text-[var(--app-text-secondary)] shadow-none outline-none transition-[background-color,color,transform] hover:bg-primary hover:text-primary-foreground focus-visible:bg-primary focus-visible:text-primary-foreground focus-visible:ring-2 focus-visible:ring-primary/30 active:scale-95 active:bg-primary active:text-primary-foreground"
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={1.8} />
            </button>
            <button
              type="button"
              aria-label="Próximo comunicado"
              onClick={() => api?.scrollNext()}
              className="absolute right-2 top-1/2 z-20 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-[6px] border-0 bg-[var(--app-surface-solid)]/80 text-[var(--app-text-secondary)] shadow-none outline-none transition-[background-color,color,transform] hover:bg-primary hover:text-primary-foreground focus-visible:bg-primary focus-visible:text-primary-foreground focus-visible:ring-2 focus-visible:ring-primary/30 active:scale-95 active:bg-primary active:text-primary-foreground"
            >
              <ChevronRight className="h-4 w-4" strokeWidth={1.8} />
            </button>
          </>
        ) : null}
      </Carousel>
    </section>
  );
}
