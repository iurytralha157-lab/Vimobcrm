import type { ReactNode } from "react";

import { PANEL_SOFT } from "@/components/features/marketing/marketing-ui";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type PropertyChipTone = "surface" | "neutral" | "success" | "warning" | "danger" | "primary";

const CHIP_TONES: Record<PropertyChipTone, string> = {
  surface: "bg-[var(--app-surface-solid)] text-[var(--app-text-primary)]",
  neutral: "bg-[color-mix(in_srgb,var(--app-text-primary)_8%,transparent)] text-[var(--app-text-secondary)]",
  success: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  warning: "bg-warning/15 text-warning",
  danger: "bg-destructive/10 text-destructive",
  primary: "bg-primary/10 text-primary",
};

export function PropertyChip({
  tone = "neutral",
  className,
  children,
  ...rest
}: {
  tone?: PropertyChipTone;
  className?: string;
  children: ReactNode;
} & Record<`data-${string}`, unknown>) {
  return (
    <span
      {...rest}
      className={cn(
        "inline-flex max-w-full items-center truncate rounded-[4px] px-1.5 py-0.5 text-[11px] font-light leading-4",
        CHIP_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function personInitials(name: string) {
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
      {avatarUrl ? <AvatarImage src={avatarUrl} alt={name} loading="lazy" /> : null}
      <AvatarFallback className="bg-[color-mix(in_srgb,var(--app-text-primary)_10%,transparent)] text-[10px] font-light text-[var(--app-text-primary)]">
        {personInitials(name)}
      </AvatarFallback>
    </Avatar>
  );
}

/** Responsible person: always an avatar, with the name on hover and focus. */
export function ResponsibleAvatar({
  name,
  avatarUrl,
  role = "Responsável",
  className,
}: {
  name: string;
  avatarUrl?: string | null;
  role?: string;
  className?: string;
}) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            role="img"
            aria-label={`${role}: ${name}`}
            data-property-responsible-avatar
            className="inline-flex shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <PersonAvatar name={name} avatarUrl={avatarUrl} className={className} />
          </span>
        </TooltipTrigger>
        <TooltipContent className="text-[12px] font-light">
          {role}: {name}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export type PropertyFieldEntry = { label: string; value: ReactNode };

export const isFilled = (value: unknown) =>
  value !== null && value !== undefined && value !== "" && !(Array.isArray(value) && value.length === 0);

/** Label over value. Empty values are dropped by the caller or by `filledFields`. */
export function PropertyField({ label, value, className }: PropertyFieldEntry & { className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-[11px] font-light text-[var(--app-text-tertiary)]">{label}</dt>
      <dd className="mt-0.5 break-words text-[13px] font-light text-[var(--app-text-primary)]">{value}</dd>
    </div>
  );
}

export function filledFields(entries: Array<{ label: string; value: ReactNode | null | undefined }>) {
  return entries.filter((entry): entry is PropertyFieldEntry => isFilled(entry.value));
}

const FIELD_COLUMNS = {
  2: "grid-cols-2",
  3: "grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-2 lg:grid-cols-4",
  5: "grid-cols-2 lg:grid-cols-5",
} as const;

export function PropertyFieldGrid({
  fields,
  columns = 4,
}: {
  fields: PropertyFieldEntry[];
  columns?: keyof typeof FIELD_COLUMNS;
}) {
  return (
    <dl className={cn("grid gap-x-4 gap-y-3", FIELD_COLUMNS[columns])}>
      {fields.map((field) => (
        <PropertyField key={field.label} {...field} />
      ))}
    </dl>
  );
}

/** Pill row used to switch media categories, movement types and history groups. */
export function PropertyChipTabs<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
  ariaLabel: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex max-w-full gap-0.5 overflow-x-auto rounded-[8px] bg-[var(--app-surface-soft)] p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            "h-7 shrink-0 rounded-[6px] px-2.5 text-[12px] font-light transition-colors",
            option.value === value
              ? "bg-[var(--app-surface-solid)] text-[var(--app-text-primary)]"
              : "text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function PropertyTile({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2 rounded-[8px] px-3 py-2 text-[13px] font-light text-[var(--app-text-primary)]", PANEL_SOFT)}>
      {icon}
      <span className="truncate">{children}</span>
    </div>
  );
}

export const PROPERTY_SECONDARY_BUTTON_CLASS =
  "h-8 gap-1.5 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2.5 text-[12px] font-light text-[var(--app-text-primary)] shadow-none hover:bg-[var(--app-surface-hover)]";
export const PROPERTY_PRIMARY_BUTTON_CLASS =
  "h-8 gap-1.5 rounded-[6px] bg-primary px-3 text-[12px] font-light text-primary-foreground shadow-none hover:bg-primary/90";
