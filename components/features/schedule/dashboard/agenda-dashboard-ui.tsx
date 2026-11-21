import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";

import { NEUTRAL_SOFT, PANEL_SOFT } from "@/components/features/marketing/marketing-ui";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export type AgendaDashboardTab = "visao" | "compromissos";

export const EVENT_TYPE_LABELS: Record<string, string> = {
  visit: "Visita",
  meeting: "Reunião",
  call: "Ligação",
  email: "E-mail",
  message: "Mensagem",
  task: "Tarefa",
  __unknown__: "Outro",
};

export function getInitials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?"
  );
}

export function PersonAvatar({
  name,
  avatarUrl,
  className,
}: {
  name: string;
  avatarUrl?: string | null;
  className?: string;
}) {
  return (
    <Avatar className={cn("h-7 w-7 shrink-0", className)}>
      {avatarUrl ? <AvatarImage src={avatarUrl} alt={name} /> : null}
      <AvatarFallback className={cn("text-[10px] font-light text-[var(--app-text-primary)]", NEUTRAL_SOFT)}>
        {getInitials(name)}
      </AvatarFallback>
    </Avatar>
  );
}

export function EventTypePill({ type }: { type: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 rounded-[4px] px-1.5 py-0.5 text-[11px] font-light",
        type === "visit"
          ? "bg-primary/10 text-[var(--app-text-primary)]"
          : cn(NEUTRAL_SOFT, "text-[var(--app-text-secondary)]"),
      )}
    >
      {EVENT_TYPE_LABELS[type] ?? EVENT_TYPE_LABELS.__unknown__}
    </span>
  );
}

export function AgendaKpiCard({
  label,
  value,
  active = false,
  emphasis = false,
  onOpen,
  openLabel,
}: {
  label: string;
  value: string;
  active?: boolean;
  emphasis?: boolean;
  onOpen?: () => void;
  openLabel?: string;
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-[12px] bg-[var(--app-surface-solid)] p-3.5",
        active && "ring-1 ring-primary/50",
      )}
    >
      <div className="flex min-h-7 items-center justify-between gap-2 text-[12px] font-light text-[var(--app-text-secondary)]">
        <span className="truncate">{label}</span>
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            aria-label={openLabel ?? `Abrir ${label}`}
            aria-pressed={active || undefined}
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--app-text-primary)] transition-colors hover:bg-[var(--app-surface-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40",
              PANEL_SOFT,
            )}
          >
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <p className={cn(
        "mt-2 truncate text-[24px] font-normal tabular-nums leading-tight",
        emphasis ? "text-[var(--destructive)]" : "text-[var(--app-text-primary)]",
      )}>
        {value}
      </p>
    </div>
  );
}

export function AgendaTableHeader({ className, children }: { className: string; children: ReactNode }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "hidden gap-3 border-b border-[var(--app-border)] pb-2 text-[12px] font-light text-[var(--app-text-tertiary)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

function civilKey(value: Date, timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
  } catch {
    return value.toISOString().slice(0, 10);
  }
}

function formatInZone(value: Date, timeZone: string, options: Intl.DateTimeFormatOptions) {
  try {
    return new Intl.DateTimeFormat("pt-BR", { ...options, timeZone }).format(value);
  } catch {
    return new Intl.DateTimeFormat("pt-BR", options).format(value);
  }
}

function dayLabel(start: Date, timeZone: string, now: Date) {
  const key = civilKey(start, timeZone);
  const shift = (days: number) => civilKey(new Date(now.getTime() + days * 86_400_000), timeZone);
  if (key === civilKey(now, timeZone)) return "Hoje";
  if (key === shift(1)) return "Amanhã";
  if (key === shift(-1)) return "Ontem";
  return formatInZone(start, timeZone, { day: "2-digit", month: "2-digit" });
}

export function formatEventTime(iso: string, timeZone: string) {
  return formatInZone(new Date(iso), timeZone, { hour: "2-digit", minute: "2-digit" });
}

/** "Hoje, 14:30", "Amanhã, 10:00", "02/11, 10:00", read in the report timezone. */
export function formatEventWhen(iso: string, timeZone: string, isAllDay: boolean, now = new Date()) {
  const start = new Date(iso);
  return `${dayLabel(start, timeZone, now)}, ${isAllDay ? "dia inteiro" : formatEventTime(iso, timeZone)}`;
}
