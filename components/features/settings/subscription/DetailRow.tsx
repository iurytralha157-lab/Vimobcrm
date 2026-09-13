import type { ReactNode } from "react";

type DetailRowProps = {
  label: string;
  children: ReactNode;
};

export function DetailRow({ label, children }: DetailRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <div className="min-w-0 text-right text-foreground">{children}</div>
    </div>
  );
}
