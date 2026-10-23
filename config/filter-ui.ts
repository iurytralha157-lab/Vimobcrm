/** Shared density and viewport limits for existing CRM filter surfaces. */
export const FILTER_UI = {
  trigger:
    "h-8 gap-1.5 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2.5 text-[10px] font-light normal-case tracking-normal text-[var(--app-text-secondary)] shadow-none transition-colors hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)] focus-visible:ring-1 focus-visible:ring-primary/30 [&_svg]:size-3.5",
  control:
    "h-9 w-full min-w-0 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2.5 py-0 text-[12px] font-light text-[var(--app-text-primary)] shadow-none transition-colors hover:bg-[var(--app-surface-hover)] focus-visible:ring-1 focus-visible:ring-primary/30 [&_svg]:size-3.5",
  panelViewport:
    "max-w-[calc(100vw-24px)] max-h-[min(80dvh,var(--radix-popover-content-available-height))] overflow-y-auto overscroll-contain",
  option:
    "rounded-[6px] text-[12px] font-light data-[selected=true]:bg-[var(--app-surface-hover)]",
  icon: "h-3.5 w-3.5 shrink-0",
  collisionPadding: 12,
} as const;
