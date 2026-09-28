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
    <div className="flex min-w-0 items-start justify-between gap-3 text-xs leading-4">
      <span className="flex min-w-0 items-center gap-1.5 text-[var(--app-text-secondary)]">
        {icon}
        {label}
      </span>
      <span className="min-w-0 max-w-[60%] break-words text-right font-normal text-[var(--app-text-primary)] [overflow-wrap:anywhere]">
        {value}
      </span>
    </div>
  );
}
