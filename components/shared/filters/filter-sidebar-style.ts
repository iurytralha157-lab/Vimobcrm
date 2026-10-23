/** Local presentation rules; never target another dialog or filter surface. */
export const FILTER_SIDEBAR_STYLE = String.raw`
.vimob-filter-sidebar[data-filter-sidebar],
.vimob-popover-content[data-filter-layer^="sidebar-"],
.vimob-select-content[data-filter-layer^="sidebar-"] {
  min-width: 0 !important;
  max-width: min(400px, calc(100vw - 24px));
  --filter-sidebar-surface: rgb(24 24 24 / 0.86);
  --filter-sidebar-control: rgb(255 255 255 / 0.055);
  --filter-sidebar-hover: rgb(255 255 255 / 0.085);
  --app-text-tertiary: var(--app-text-secondary);
  --muted-foreground: var(--app-text-secondary);
}

.light :is(.vimob-filter-sidebar[data-filter-sidebar], .vimob-popover-content[data-filter-layer^="sidebar-"], .vimob-select-content[data-filter-layer^="sidebar-"]) {
  --filter-sidebar-surface: rgb(255 255 255 / 0.86);
  --filter-sidebar-control: rgb(21 21 21 / 0.045);
  --filter-sidebar-hover: rgb(21 21 21 / 0.075);
}

.vimob-filter-sidebar.vimob-dialog-content[data-filter-sidebar] {
  display: flex;
  flex-direction: column;
  gap: 0;
  width: min(400px, 90vw);
  max-width: 90vw;
  height: 100dvh;
  max-height: 100dvh;
  padding: 0;
  overflow: hidden;
  border: 0 !important;
  outline: none !important;
  border-radius: 0 !important;
  background: var(--filter-sidebar-surface) !important;
  backdrop-filter: blur(12px) saturate(1.02) !important;
  box-shadow: -8px 0 28px rgb(0 0 0 / 0.08) !important;
}

.vimob-filter-sidebar-overlay { background: rgb(15 23 42 / 0.16) !important; backdrop-filter: blur(1px); }
.dark .vimob-filter-sidebar-overlay { background: rgb(0 0 0 / 0.3) !important; }

.vimob-filter-sidebar[data-filter-sidebar] > button[data-radix-dialog-close],
.vimob-filter-sidebar[data-filter-sidebar] > button:last-child {
  display: none;
}

.vimob-filter-sidebar[data-filter-sidebar] :where(input:not([type="checkbox"]):not([type="radio"]):not([type="file"]), button[role="combobox"], button[data-filter-active]) {
  background: var(--filter-sidebar-control) !important;
  border: 0 !important;
  outline: none !important;
  box-shadow: none !important;
}

.vimob-filter-sidebar[data-filter-sidebar] [data-filter-active="true"] {
  background: color-mix(in srgb, var(--primary) 50%, transparent) !important;
  color: #fff !important;
}

.vimob-filter-sidebar[data-filter-sidebar] :is(input, button[role="combobox"], button[data-filter-active]):focus-visible {
  box-shadow: 0 0 0 1px var(--primary) !important;
}

.vimob-filter-sidebar [data-filter-search-container] { position: relative; }
.vimob-filter-sidebar [data-filter-search-icon] { top: 50% !important; translate: 0 -50% !important; transform: none !important; pointer-events: none; }
.vimob-filter-sidebar-body :is(.border-t, .border-b) { border-width: 0 !important; }
.vimob-filter-sidebar [data-filter-chip] { color: var(--app-text-primary) !important; }

.vimob-popover-content[data-filter-layer^="sidebar-"],
.vimob-select-content[data-filter-layer^="sidebar-"] {
  border: 0 !important;
  outline: none !important;
  background: var(--filter-sidebar-surface) !important;
  backdrop-filter: blur(12px) saturate(1.02) !important;
}
.vimob-popover-content[data-filter-layer^="sidebar-"]:not([data-filter-calendar]) { width: var(--radix-popover-trigger-width) !important; }
.vimob-select-content[data-filter-layer^="sidebar-"] { width: var(--radix-select-trigger-width) !important; }
:is(.vimob-popover-content, .vimob-select-content)[data-filter-layer^="sidebar-"] :is([cmdk-input-wrapper], .border-t, .border-b) { border-width: 0 !important; }
:is(.vimob-popover-content, .vimob-select-content)[data-filter-layer^="sidebar-"] :is([role="separator"], [cmdk-separator]) { display: none; }

.vimob-filter-sidebar-header {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) 12px max(16px, env(safe-area-inset-left));
  border: 0;
  background: transparent;
}

.vimob-filter-sidebar-heading { display: flex; min-width: 0; flex-direction: column; gap: 4px; }
.vimob-filter-sidebar[data-filter-sidebar] .vimob-filter-sidebar-title { margin: 0; font-size: 14px; line-height: 20px; font-weight: var(--app-font-weight-body) !important; }
.vimob-filter-sidebar-close { width: 36px; height: 36px; flex: none; color: var(--app-text-secondary) !important; background: var(--filter-sidebar-control) !important; }
.vimob-filter-sidebar-close:hover { background: var(--filter-sidebar-hover) !important; }

.vimob-filter-sidebar-body {
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  padding: 16px max(16px, env(safe-area-inset-right)) 16px max(16px, env(safe-area-inset-left));
}

.vimob-filter-sidebar-footer {
  position: sticky;
  bottom: 0;
  z-index: 1;
  display: flex;
  flex: none;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 12px max(16px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
  border: 0;
  background: transparent;
}

.vimob-filter-sidebar-dock { position: relative; width: 56px; height: 56px; flex: 0 0 56px; }
.vimob-filter-sidebar-dock button[aria-controls="floating-whatsapp-chat"] { border-radius: 9999px !important; }
.vimob-filter-sidebar-actions { display: flex; min-width: 0; flex: 1; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; }
.vimob-filter-sidebar-actions > button { min-height: 36px; font-size: 12px; }
.vimob-filter-sidebar-actions > button:not([data-filter-sidebar-complete]) { background: var(--filter-sidebar-control); color: var(--app-text-secondary); }
.vimob-filter-sidebar-actions > button:not([data-filter-sidebar-complete]):hover { background: var(--filter-sidebar-hover); }
.vimob-filter-sidebar [data-filter-sidebar-complete] { background: color-mix(in srgb, var(--primary) 50%, #303030) !important; color: #fff !important; }
.vimob-filter-sidebar [data-filter-sidebar-complete]:is(:hover, :active) { background: color-mix(in srgb, var(--primary) 50%, #151515) !important; }

@media (max-width: 767px) {
  .vimob-filter-sidebar-close { width: 44px; height: 44px; }
  .vimob-filter-sidebar-actions > button { min-height: 44px; }
}

@media (prefers-reduced-motion: reduce) {
  .vimob-filter-sidebar, .vimob-filter-sidebar-overlay { animation: none !important; transition: none !important; }
}

`;
