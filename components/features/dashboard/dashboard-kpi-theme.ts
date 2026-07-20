import type { CSSProperties } from "react";

const DASHBOARD_KPI_COLOR_VARIABLES = {
  leads: "--dashboard-kpi-leads",
  open: "--dashboard-kpi-open",
  lost: "--dashboard-kpi-lost",
  won: "--dashboard-kpi-won",
  visits: "--dashboard-kpi-visits",
  vgv: "--dashboard-kpi-vgv",
  response: "--dashboard-kpi-response",
  properties: "--dashboard-kpi-properties",
  site: "--dashboard-kpi-site",
} as const;

export type DashboardKPIAccent = keyof typeof DASHBOARD_KPI_COLOR_VARIABLES;

export function getDashboardKPIValueStyle(accent: DashboardKPIAccent): CSSProperties {
  return {
    color: `var(${DASHBOARD_KPI_COLOR_VARIABLES[accent]})`,
  };
}
