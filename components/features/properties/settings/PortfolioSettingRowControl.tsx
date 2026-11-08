"use client";

import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

import { parseSettingsList, type PortfolioSettingRow } from "./portfolio-settings-schema";

const CONTROL_CLASS = "h-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] font-light shadow-none";

export function PortfolioSettingRowControl({
  row,
  fieldId,
  value,
  disabled,
  onChange,
}: {
  row: PortfolioSettingRow;
  fieldId: string;
  value: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
}) {
  if (row.type === "boolean") {
    return <Switch id={fieldId} checked={value === true} disabled={disabled} onCheckedChange={onChange} />;
  }
  if (row.type === "select") {
    return (
      <Select value={String(value ?? "")} disabled={disabled} onValueChange={onChange}>
        <SelectTrigger id={fieldId} className={`${CONTROL_CLASS} w-[150px]`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {row.options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
        </SelectContent>
      </Select>
    );
  }
  if (row.type === "list") {
    return (
      <Input
        id={fieldId}
        defaultValue={Array.isArray(value) ? value.join(", ") : ""}
        key={Array.isArray(value) ? value.join("|") : ""}
        disabled={disabled}
        placeholder={row.placeholder}
        onBlur={(event) => onChange(parseSettingsList(event.target.value))}
        className={`${CONTROL_CLASS} w-full sm:w-[240px]`}
      />
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <Input
        id={fieldId}
        type="number"
        inputMode="decimal"
        min={row.min}
        max={row.max}
        step={row.step ?? 1}
        value={typeof value === "number" ? value : ""}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
        className={`${CONTROL_CLASS} w-[84px] text-right tabular-nums`}
      />
      <span className="w-11 text-[12px] font-light text-[var(--app-text-secondary)]">{row.unit}</span>
    </div>
  );
}
