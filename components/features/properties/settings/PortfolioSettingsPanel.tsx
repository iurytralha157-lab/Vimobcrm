"use client";

import { Panel } from "@/components/features/marketing/marketing-ui";
import { Label } from "@/components/ui/label";
import type { PortfolioSettings } from "@/lib/validation";

import { PortfolioSettingRowControl } from "./PortfolioSettingRowControl";
import {
  PORTFOLIO_SETTINGS_PENDING_NOTICE,
  type PortfolioGroupKey,
  type PropertySettingsGroup,
} from "./portfolio-settings-schema";

/** Stored preferences only: the notice stays visible on every group that has no effect yet. */
export function PortfolioSettingsPanel({
  group,
  values,
  disabled,
  onChange,
}: {
  group: PropertySettingsGroup;
  values: PortfolioSettings;
  disabled: boolean;
  onChange: (group: PortfolioGroupKey, key: string, value: unknown) => void;
}) {
  const groupValues = values[group.id] as Record<string, unknown>;
  return (
    <Panel title={group.label} aside={PORTFOLIO_SETTINGS_PENDING_NOTICE}>
      <ul className="divide-y divide-[var(--app-border)]">
        {group.rows.map((row) => {
          const fieldId = `portfolio-${group.id}-${row.key}`;
          return (
            <li key={row.key} className="flex flex-col gap-2 py-2.5 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="min-w-0">
                <Label htmlFor={fieldId} className="text-[13px] font-light text-[var(--app-text-primary)]">{row.label}</Label>
                <p className="text-[12px] font-light text-[var(--app-text-secondary)]">{row.hint}</p>
              </div>
              <PortfolioSettingRowControl
                row={row}
                fieldId={fieldId}
                value={groupValues[row.key]}
                disabled={disabled}
                onChange={(value) => onChange(group.id, row.key, value)}
              />
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
