"use client";

import {
  AlertTriangle,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Megaphone,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import type { HomeNotice, HomeNoticeSeverity } from "@/lib/validation";
import { cn } from "@/lib/utils";

type HomeNoticeRailProps = {
  notices: HomeNotice[];
};

const NOTICE_PRIORITY: Record<HomeNoticeSeverity, number> = {
  critical: 0,
  warning: 1,
  announcement: 2,
};

const NOTICE_LABEL: Record<HomeNoticeSeverity, string> = {
  critical: "Atenção",
  warning: "Aviso",
  announcement: "Comunicado",
};

const NOTICE_STYLES: Record<
  HomeNoticeSeverity,
  {
    rail: string;
    icon: string;
    action: string;
  }
> = {
  critical: {
    rail: "bg-red-500/10",
    icon: "bg-red-500/65",
    action: "bg-red-500/55 hover:bg-red-500 focus-visible:bg-red-500",
  },
  warning: {
    rail: "bg-amber-400/15",
    icon: "bg-amber-500/70",
    action: "bg-amber-500/60 hover:bg-amber-500 focus-visible:bg-amber-500",
  },
  announcement: {
    rail: "bg-primary/10",
    icon: "bg-primary/60",
    action: "bg-primary/50 hover:bg-primary focus-visible:bg-primary",
  },
};

function isExternalURL(value: string) {
  return /^https?:\/\//i.test(value);
}

function getSafeActionURL(value?: string | null) {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (normalized.startsWith("/") && !normalized.startsWith("//")) {
    return normalized;
  }
  try {
    const parsed = new URL(normalized);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? normalized
      : undefined;
  } catch {
    return undefined;
  }
}

export function HomeNoticeRail({ notices }: HomeNoticeRailProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(
    () => new Set(),
  );

  const orderedNotices = useMemo(
    () =>
      notices
        .slice()
        .sort(
          (left, right) =>
            NOTICE_PRIORITY[left.severity] - NOTICE_PRIORITY[right.severity],
        ),
    [notices],
  );

  const primaryNoticeKey = orderedNotices[0]
    ? [orderedNotices[0].id, orderedNotices[0].severity].join(":")
    : "";
  const previousPrimaryNoticeKey = useRef(primaryNoticeKey);

  useEffect(() => {
    if (previousPrimaryNoticeKey.current === primaryNoticeKey) return;
    previousPrimaryNoticeKey.current = primaryNoticeKey;
    setActiveIndex(0);
  }, [primaryNoticeKey]);

  const visibleNotices = useMemo(
    () => orderedNotices.filter((notice) => !dismissedIds.has(notice.id)),
    [dismissedIds, orderedNotices],
  );

  const currentIndex =
    visibleNotices.length > 0 ? activeIndex % visibleNotices.length : 0;
  const activeNotice = visibleNotices[currentIndex];

  useEffect(() => {
    if (!activeNotice?.dismissible || !activeNotice.display_duration_seconds)
      return undefined;

    const timeout = window.setTimeout(() => {
      setDismissedIds((current) => new Set(current).add(activeNotice.id));
    }, activeNotice.display_duration_seconds * 1000);

    return () => window.clearTimeout(timeout);
  }, [
    activeNotice?.dismissible,
    activeNotice?.display_duration_seconds,
    activeNotice?.id,
  ]);

  if (!activeNotice) return null;

  const styles = NOTICE_STYLES[activeNotice.severity];
  const hasMultiple = visibleNotices.length > 1;
  const actionURL = getSafeActionURL(activeNotice.action_url);
  const actionLabel = activeNotice.action_label?.trim();
  const Icon =
    activeNotice.source === "announcement" ? Megaphone : AlertTriangle;

  const goPrevious = () => {
    setActiveIndex(() =>
      currentIndex <= 0 ? visibleNotices.length - 1 : currentIndex - 1,
    );
  };

  const goNext = () => {
    setActiveIndex(() =>
      currentIndex >= visibleNotices.length - 1 ? 0 : currentIndex + 1,
    );
  };

  const actionClassName = cn(
    "inline-flex h-8 w-8 shrink-0 items-center justify-center gap-1.5 rounded-[6px] px-0 text-[12px] font-light text-primary-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-current/30 sm:w-auto sm:px-3",
    styles.action,
  );

  return (
    <section
      aria-label="Avisos importantes"
      aria-live={activeNotice.severity === "critical" ? "assertive" : "polite"}
      className={cn(
        "flex min-h-14 w-full items-center gap-2 rounded-none px-5 py-2 shadow-none sm:min-h-12 sm:gap-3 md:px-8",
        styles.rail,
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] text-primary-foreground sm:h-10 sm:w-10",
          styles.icon,
        )}
      >
        <Icon className="h-4 w-4" strokeWidth={1.8} />
      </div>

      <div className="min-w-0 flex-1 py-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="sr-only">
            {NOTICE_LABEL[activeNotice.severity]}:{" "}
          </span>
          <p className="truncate text-[13px] font-normal leading-[18px] text-[var(--app-text-primary)] sm:text-sm">
            {activeNotice.title}
          </p>
          {hasMultiple ? (
            <span className="hidden shrink-0 text-[10px] font-light text-[var(--app-text-tertiary)] sm:inline">
              {currentIndex + 1} de {visibleNotices.length}
            </span>
          ) : null}
        </div>
        <p className="line-clamp-2 text-[12px] font-light leading-[18px] text-[var(--app-text-secondary)] sm:line-clamp-1">
          {activeNotice.description}
        </p>
      </div>

      {actionURL && actionLabel ? (
        isExternalURL(actionURL) ? (
          <a
            href={actionURL}
            target="_blank"
            rel="noreferrer"
            className={actionClassName}
            aria-label={actionLabel}
          >
            <span className="hidden sm:inline">{actionLabel}</span>
            <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.8} />
          </a>
        ) : (
          <Link
            href={actionURL}
            className={actionClassName}
            aria-label={actionLabel}
          >
            <span className="hidden sm:inline">{actionLabel}</span>
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.8} />
          </Link>
        )
      ) : null}

      {hasMultiple ? (
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={goPrevious}
            className="flex h-8 w-8 items-center justify-center rounded-[6px] text-[var(--app-text-secondary)] transition-colors hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            aria-label="Aviso anterior"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            onClick={goNext}
            className="flex h-8 w-8 items-center justify-center rounded-[6px] text-[var(--app-text-secondary)] transition-colors hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            aria-label="Próximo aviso"
          >
            <ChevronRight className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </div>
      ) : null}

      {activeNotice.dismissible ? (
        <button
          type="button"
          onClick={() =>
            setDismissedIds((current) => new Set(current).add(activeNotice.id))
          }
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] text-[var(--app-text-secondary)] transition-colors hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          aria-label="Fechar comunicado"
        >
          <X className="h-4 w-4" strokeWidth={1.8} />
        </button>
      ) : null}
    </section>
  );
}
