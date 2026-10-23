/** Dashboard-only density; the shared shell and sidebar keep their dimensions. */
export const DASHBOARD_LAYOUT = {
  desktopBreakpointPx: 1024,
  desktopFirstRow: "grid h-[calc(100dvh-9rem)] min-h-[540px] shrink-0 grid-cols-12 gap-3 min-[1441px]:min-h-[620px] max-[1440px]:max-h-[600px] [@media(max-height:800px)]:min-h-[540px] [@media(max-height:800px)]:max-h-[600px]",
  mobileEvolution: "h-[clamp(280px,45dvh,360px)]",
  mobileFunnel: "h-[clamp(280px,42dvh,360px)]",
  mobileSources: "h-[clamp(320px,48dvh,390px)]",
} as const;
