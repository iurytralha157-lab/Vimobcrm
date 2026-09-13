import type { CSSProperties, ReactNode } from "react";
import { Loader2, Trophy, type LucideIcon } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { TabsTrigger } from "@/components/ui/tabs";
import type { GamificationManualEntry } from "@/hooks/gamification";
import { cn } from "@/lib/utils";

export function ConfirmActionDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  isPending,
  destructive = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  isPending: boolean;
  destructive?: boolean;
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isPending) onOpenChange(nextOpen);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            className={cn(
              destructive &&
                "bg-destructive text-destructive-foreground hover:bg-destructive/90",
            )}
            disabled={isPending}
            aria-busy={isPending}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {isPending ? "Processando..." : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ManualEntryStatusBadge({
  entry,
}: {
  entry: GamificationManualEntry;
}) {
  let label = "Pendente de aprovação";
  let variant: "default" | "secondary" | "destructive" | "outline" =
    "secondary";

  if (entry.status === "rejected") {
    label = "Rejeitado";
    variant = "destructive";
  } else if (entry.status === "approved" && entry.awardStatus === "completed") {
    label = "Pontos concedidos";
    variant = "default";
  } else if (entry.status === "approved" && entry.awardStatus === "skipped") {
    label = "Aprovado sem pontuar";
    variant = "destructive";
  } else if (entry.status === "approved" && entry.awardStatus === "dead") {
    label = "Falha ao conceder pontos";
    variant = "destructive";
  } else if (
    entry.status === "approved" &&
    entry.awardStatus === "processing"
  ) {
    label = "Processando pontos";
    variant = "outline";
  } else if (entry.status === "approved") {
    label = "Aguardando pontuação";
    variant = "outline";
  }

  return <Badge variant={variant}>{label}</Badge>;
}

export function ConfigTab({
  value,
  icon: Icon,
  label,
}: {
  value: string;
  icon: LucideIcon;
  label: string;
}) {
  return (
    <TabsTrigger
      value={value}
      data-responsive-tab
      aria-label={label}
      title={label}
      className="h-8 shrink-0 gap-1.5 rounded-[6px] border-0 px-3 text-xs font-medium text-muted-foreground shadow-none transition-colors data-[state=active]:bg-[var(--app-surface-solid)] data-[state=active]:text-foreground data-[state=active]:shadow-none"
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="app-responsive-tab-label">{label}</span>
    </TabsTrigger>
  );
}

export function ArenaCelebration({ active }: { active: boolean }) {
  if (!active) return null;

  const colors = [
    "var(--chart-1)",
    "var(--chart-2)",
    "var(--chart-3)",
    "var(--chart-4)",
    "var(--chart-5)",
  ];

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-14 z-[70] flex justify-center overflow-hidden"
      aria-hidden="true"
    >
      <style>
        {`
          @keyframes arena-confetti {
            0% { opacity: 0; transform: translate3d(0, -12px, 0) rotate(0deg) scale(0.7); }
            12% { opacity: 1; }
            100% { opacity: 0; transform: translate3d(var(--arena-x), 150px, 0) rotate(520deg) scale(1); }
          }
        `}
      </style>
      <div className="relative h-44 w-[min(720px,92vw)]">
        {Array.from({ length: 24 }).map((_, index) => (
          <span
            key={index}
            className="absolute h-2.5 w-1.5 rounded-full"
            style={
              {
                left: `${8 + ((index * 17) % 84)}%`,
                top: `${(index * 11) % 28}px`,
                backgroundColor: colors[index % colors.length],
                animation: `arena-confetti ${1.25 + (index % 5) * 0.08}s ease-out ${index * 0.025}s forwards`,
                "--arena-x": `${(index % 2 === 0 ? 1 : -1) * (28 + (index % 6) * 10)}px`,
              } as CSSProperties
            }
          />
        ))}
      </div>
    </div>
  );
}

export function PanelTitle({
  icon: Icon,
  eyebrow,
  title,
  showIcon = true,
}: {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  showIcon?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-[10px] font-normal text-primary">{eyebrow}</p>
        <h2 className="mt-1 text-lg font-medium">{title}</h2>
      </div>
      {showIcon && <Icon className="h-5 w-5 shrink-0 text-primary" />}
    </div>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

export function EmptyPanel({
  title,
  compact = false,
}: {
  title: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center text-muted-foreground",
        compact ? "min-h-[120px]" : "min-h-[220px]",
      )}
    >
      <Trophy className="mb-3 h-8 w-8 opacity-35" />
      <p className="text-sm font-medium">{title}</p>
    </div>
  );
}
