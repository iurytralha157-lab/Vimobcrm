import type { ElementType } from "react";
import { AlertTriangle, ShieldCheck } from "lucide-react";

export function AdminWarning({ message }: { message: string | null | undefined }) {
  if (!message) return null;

  return (
    <div className="flex items-start gap-3 rounded-[8px] bg-destructive/10 p-4 text-sm text-destructive">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <p className="font-medium">Dados indisponíveis no momento</p>
        <p className="mt-1 text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}

export function KpiCard({
  title,
  value,
  icon: Icon,
  helper,
}: {
  title: string;
  value: string | number;
  icon: ElementType;
  helper?: string;
}) {
  return (
    <div className="app-card card-hover min-h-[108px] p-3 sm:min-h-0 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-light leading-snug text-muted-foreground sm:text-xs">{title}</p>
          <p className="mt-2 truncate text-xl font-medium sm:text-2xl">{value}</p>
          {helper ? <p className="mt-1 text-[11px] leading-snug text-muted-foreground sm:text-xs">{helper}</p> : null}
        </div>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-primary/12 text-primary sm:h-10 sm:w-10">
          <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
        </span>
      </div>
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="app-card flex min-h-[260px] flex-col items-center justify-center p-8 text-center">
      <ShieldCheck className="mb-4 h-10 w-10 text-muted-foreground/50" />
      <h3 className="text-base font-medium">{title}</h3>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
