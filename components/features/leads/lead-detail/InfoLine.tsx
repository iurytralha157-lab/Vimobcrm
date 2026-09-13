import type { ReactNode } from 'react';

export function InfoLine({
  label,
  value,
  icon,
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 text-xs">
      <span className="flex min-w-0 items-center gap-1.5 text-[var(--app-text-tertiary)]">
        {icon}
        {label}
      </span>
      <span className="max-w-[60%] truncate text-right font-normal text-[var(--app-text-primary)]">
        {value}
      </span>
    </div>
  );
}
