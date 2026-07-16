import { cn } from "@/lib/utils";

type ChartTooltipValue = string | number | null | undefined;

interface ChartTooltipPayloadEntry {
  color?: string;
  fill?: string;
  name?: string | number;
  value?: ChartTooltipValue;
  [key: string]: unknown;
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: ChartTooltipPayloadEntry[];
  label?: string;
  title?: string;
  valueFormatter?: (value: ChartTooltipValue, entry: ChartTooltipPayloadEntry) => string;
  nameFormatter?: (name: string, entry: ChartTooltipPayloadEntry) => string;
  className?: string;
  showTotal?: boolean;
}

export function DashboardChartTooltip({
  active,
  payload,
  label,
  title,
  valueFormatter,
  nameFormatter,
  className,
  showTotal = false
}: ChartTooltipProps) {
  if (!active || !payload || !payload.length) return null;

  const displayTitle = title || label;

  return (
    <div className={cn(
      "min-w-[140px] rounded-xl border-0 bg-[var(--app-surface-solid)] p-3 text-[#232323] shadow-[0_8px_20px_rgba(0,0,0,0.18)] animate-in fade-in zoom-in duration-200",
      className
    )}>
      {displayTitle && (
        <p className="mb-2 text-[10px] font-light uppercase tracking-wider text-[#272727]">
          {displayTitle}
        </p>
      )}
      <div className="space-y-1.5">
        {payload.map((entry, index) => {
          const entryName = String(entry.name ?? '');

          return (
            <div key={index} className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: entry.color || entry.fill }}
                />
                <span className="py-0 pb-0 pt-[2px] text-[11px] font-light text-[#272727]/70">
                  {nameFormatter ? nameFormatter(entryName, entry) : entryName}
                </span>
              </div>
              <span className="pt-[2px] text-[11px] font-medium tabular-nums text-[#232323]">
                {valueFormatter ? valueFormatter(entry.value, entry) : entry.value}
              </span>
            </div>
          );
        })}

        {showTotal && payload.length > 1 && (
          <div className="mt-1.5 flex items-center justify-between gap-4 pt-1.5">
            <span className="text-[11px] font-light uppercase tracking-wider text-[#272727]/70">Total</span>
            <span className="text-[11px] font-medium tabular-nums text-[#232323]">
              {payload.reduce((acc, entry) => acc + (Number(entry.value) || 0), 0)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
