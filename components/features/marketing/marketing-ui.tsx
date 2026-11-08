import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { MetaCreativePreview } from "@/components/features/meta";
import { cn } from "@/lib/utils";

export const NEUTRAL_SOFT = "bg-[color-mix(in_srgb,var(--app-text-primary)_11%,transparent)]";
export const NEUTRAL_STRONG = "bg-[color-mix(in_srgb,var(--app-text-primary)_27%,transparent)]";
export const INK = "bg-[var(--app-text-primary)]";
export const PANEL_SOFT = "bg-[color-mix(in_srgb,var(--app-text-primary)_4%,transparent)]";

export function KpiRow({ children }: { children: ReactNode }) {
  return <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</section>;
}

export function KpiCard({
  label,
  value,
  note,
  href,
  spark,
}: {
  label: string;
  value: string;
  note?: ReactNode;
  href?: string;
  spark?: number[];
}) {
  return (
    <div className="min-w-0 rounded-[12px] bg-[var(--app-surface-solid)] p-3.5">
      <div className="flex min-h-7 items-center justify-between gap-2 text-[12px] font-light text-[var(--app-text-secondary)]">
        <span className="truncate">{label}</span>
        {href ? (
          <Link
            href={href}
            scroll={false}
            aria-label={`Abrir ${label}`}
            className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--app-text-primary)]", PANEL_SOFT)}
          >
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        ) : null}
      </div>
      <p className="mt-2 whitespace-nowrap text-[24px] font-normal tabular-nums leading-tight text-[var(--app-text-primary)]">
        {value}
      </p>
      {spark ? <Sparkline values={spark} /> : null}
      {note ? (
        <p className="mt-2 border-t border-[var(--app-border)] pt-2 text-[10px] font-light text-[var(--app-text-tertiary)]">
          {note}
        </p>
      ) : null}
    </div>
  );
}

/** The most recent quarter of the period is highlighted. */
function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(...values, 0);
  if (max <= 0) return <div className="mt-1.5 h-[22px]" aria-hidden="true" />;
  const recentFrom = Math.floor(values.length * 0.75);
  return (
    <div className="mt-1.5 flex h-[22px] items-end gap-px" aria-hidden="true">
      {values.map((value, index) => (
        <span
          key={index}
          className={cn("min-w-0 flex-1", index >= recentFrom ? "bg-primary" : NEUTRAL_SOFT)}
          style={{ height: `${Math.max(4, (value / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

export function Panel({
  title,
  aside,
  children,
  className,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("min-w-0 rounded-[12px] bg-[var(--app-surface-solid)] p-4", className)}>
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-[14px] font-normal text-[var(--app-text-primary)]">{title}</h2>
        {aside ? <div className="text-[12px] font-light text-[var(--app-text-secondary)]">{aside}</div> : null}
      </header>
      {children}
    </section>
  );
}

export function StatTile({
  label,
  value,
  note,
  highlight = false,
}: {
  label: string;
  value: string;
  note?: string;
  highlight?: boolean;
}) {
  return (
    <div className={cn("min-w-0 rounded-[8px] px-3 py-2.5", highlight ? "bg-primary/10" : PANEL_SOFT)}>
      <p className="truncate text-[12px] font-light text-[var(--app-text-secondary)]">{label}</p>
      <p className="whitespace-nowrap text-[20px] font-normal tabular-nums leading-snug text-[var(--app-text-primary)]">
        {value}
      </p>
      {note ? <p className="truncate text-[10px] font-light text-[var(--app-text-tertiary)]">{note}</p> : null}
    </div>
  );
}

export function ProgressRow({
  label,
  value,
  percent,
  highlight = false,
  ink = false,
  note,
}: {
  label: string;
  value: string;
  percent: number;
  highlight?: boolean;
  ink?: boolean;
  note?: string;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,110px)_minmax(0,1fr)_auto] items-center gap-3 text-[12px] font-light">
      <span className="truncate text-[var(--app-text-secondary)]">{label}</span>
      <span className={cn("h-3 overflow-hidden rounded-[3px]", NEUTRAL_SOFT)}>
        <span
          className={cn("block h-full rounded-[3px]", ink ? INK : highlight ? "bg-primary" : NEUTRAL_STRONG)}
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </span>
      <span className="whitespace-nowrap text-right tabular-nums text-[var(--app-text-primary)]">
        {value}
        {note ? <span className="ml-2 text-[var(--app-text-tertiary)]">{note}</span> : null}
      </span>
    </div>
  );
}

export function SegmentedBar({ items }: { items: Array<{ key: string; value: number; className: string }> }) {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.value), 0);
  if (total <= 0) return <div className={cn("h-8 rounded-[6px]", NEUTRAL_SOFT)} aria-hidden="true" />;
  return (
    <div className="flex h-8 gap-0.5 overflow-hidden rounded-[6px]" aria-hidden="true">
      {items.filter((item) => item.value > 0).map((item) => (
        <span key={item.key} className={item.className} style={{ width: `${(item.value / total) * 100}%` }} />
      ))}
    </div>
  );
}

export const SEGMENT_COLORS = [
  "bg-primary",
  INK,
  "bg-primary/60",
  NEUTRAL_STRONG,
  "bg-primary/30",
  NEUTRAL_SOFT,
];

export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-[12px] font-light text-[var(--app-text-tertiary)]">{children}</p>;
}

export function ProviderBadge({ provider = "meta" }: { provider?: string }) {
  const isGoogle = provider.toLowerCase().includes("google");
  return (
    <span
      aria-label={isGoogle ? "Google" : "Meta"}
      className={cn(
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-normal text-white",
        isGoogle ? "bg-[#151515]" : "bg-[#1877f2]",
      )}
    >
      {isGoogle ? "G" : "M"}
    </span>
  );
}

export function StatusPill({ label, active }: { label: string; active: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-[4px] px-1.5 py-0.5 text-[11px] font-light",
        active ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : cn(NEUTRAL_SOFT, "text-[var(--app-text-secondary)]"),
      )}
    >
      {label}
    </span>
  );
}

export interface CreativeMedia {
  name: string;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
  permalinkUrl: string | null;
}

export function CreativeImage({ media, className, size = "gallery" }: { media: CreativeMedia; className?: string; size?: "sm" | "gallery" }) {
  return (
    <MetaCreativePreview
      creative={{
        name: media.name,
        type: media.videoUrl ? "video" : "image",
        thumbnailUrl: media.thumbnailUrl,
        creativeUrl: media.imageUrl,
        videoUrl: media.videoUrl,
        permalinkUrl: media.permalinkUrl,
      }}
      size={size}
      showAction={false}
      className={className}
    />
  );
}

export function safeExternalUrl(value: string | null | undefined) {
  const candidate = value?.trim();
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
