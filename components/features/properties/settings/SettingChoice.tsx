"use client";

import { PropertyChip } from "../property-ui";

/** Settings that already change behaviour; marked so they read apart from stored preferences. */
export function SettingChoice({
  label,
  description,
  options,
  selected,
  onSelect,
}: {
  label: string;
  description: string;
  options: Array<{ value: string; label: string; description: string }>;
  selected: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[13px] font-light text-[var(--app-text-primary)]">{label}</h3>
        <PropertyChip tone="success">Já existe</PropertyChip>
      </div>
      <p className="text-[12px] font-light text-[var(--app-text-secondary)]">{description}</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {options.map((option) => (
          <PolicyOption
            key={option.value}
            value={option.value}
            label={option.label}
            description={option.description}
            selected={selected === option.value}
            onSelect={() => onSelect(option.value)}
          />
        ))}
      </div>
    </div>
  );
}

function PolicyOption({
  value,
  label,
  description,
  selected,
  onSelect,
}: {
  value: string;
  label: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      data-value={value}
      onClick={onSelect}
      className={`flex w-full cursor-pointer items-start gap-3 rounded-[8px] p-3 text-left transition ${
        selected
          ? "bg-primary/10 text-[var(--app-text-primary)]"
          : "bg-[var(--app-surface-soft)] text-[var(--app-text-primary)] hover:bg-[var(--app-surface-hover)]"
      }`}
    >
      <span
        className={`mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full ${
          selected ? "bg-primary" : "bg-muted-foreground/35"
        }`}
      />
      <span className="space-y-0.5">
        <span className="block text-[13px] font-light">{label}</span>
        <span className="block text-[12px] font-light leading-[18px] text-[var(--app-text-secondary)]">{description}</span>
      </span>
    </button>
  );
}
