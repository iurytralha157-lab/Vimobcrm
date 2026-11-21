import { AlertTriangle, CheckCircle2, Clock, Lock, UserRound } from "lucide-react";
import Link from "next/link";
import { AgendaRow } from "@/components/features/schedule/event-sheet/EventSheetPrimitives";
import type { ScheduleOutcome } from "@/hooks/use-schedule-events";
import { getScheduleOutcomeLabel } from "@/lib/schedule-outcome";
import { cn } from "@/lib/utils";
import { formatScheduleTimestamp } from "@/components/features/schedule/event-sheet/model";
import { getGoogleSyncFeedback } from "@/components/features/schedule/google-sync-presentation";

export function EventSheetFeedback({
  isCompleted,
  isMasked,
  status,
  googleSyncStatus,
  googleSyncTarget,
  outcome,
  outcomeNotes,
  performedByName,
  completedAt,
  attendanceOutcome,
  timeZone,
}: {
  isCompleted: boolean;
  isMasked: boolean;
  status?: string | null;
  googleSyncStatus?: string | null;
  googleSyncTarget?: "calendar" | "tasks" | null;
  outcome?: ScheduleOutcome | null;
  outcomeNotes?: string | null;
  performedByName?: string | null;
  completedAt?: string | null;
  attendanceOutcome: boolean;
  timeZone: string;
}) {
  const googleFeedback = getGoogleSyncFeedback({ target: googleSyncTarget, status: googleSyncStatus, isMasked });
  return (
    <>
      {googleFeedback && (
        <AgendaRow icon={googleFeedback.tone === "warning" ? <AlertTriangle size={18} /> : googleFeedback.tone === "pending" ? <Clock size={18} /> : <CheckCircle2 size={18} />} align="start">
          <div role={googleFeedback.tone === "warning" ? "alert" : "status"} className={cn(
            "rounded-[6px] px-3 py-2 text-[12px] leading-5",
            googleFeedback.tone === "warning" ? "bg-amber-500/10 text-amber-800 dark:text-amber-200"
              : "bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]",
          )}>
            <span className="font-medium">{googleFeedback.title}</span>
            <p>{googleFeedback.description}</p>
            {googleFeedback.requiresConnection && (
              <Link className="mt-1 inline-block font-medium underline" href="/settings?tab=integrations&integration=google-calendar">Abrir integração Google</Link>
            )}
          </div>
        </AgendaRow>
      )}

      {isCompleted && (
        <AgendaRow icon={<Lock size={18} />} align="center">
          <span
            className={cn(
              "inline-flex min-h-8 items-center rounded-[6px] px-3 py-1.5 text-[12px] font-light",
              status === "completed"
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                : outcome === "rescheduled"
                  ? "bg-blue-500/10 text-blue-700 dark:text-blue-300"
                  : status === "no_show"
                    ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                    : "bg-red-500/10 text-red-700 dark:text-red-300",
            )}
          >
            {outcome === "rescheduled"
              ? "Atividade remarcada, somente leitura"
              : status === "no_show"
                ? "Não comparecimento registrado, somente leitura"
                : status === "cancelled" || status === "canceled"
                  ? "Atividade cancelada, somente leitura"
                  : "Atividade concluída, somente leitura"}
          </span>
        </AgendaRow>
      )}

      {!isMasked && outcome && (
        <AgendaRow icon={<CheckCircle2 size={18} />} align="start">
          <div className="rounded-[6px] bg-[var(--app-surface-soft)] px-3 py-2 text-[12px] font-light text-[var(--app-text-primary)]">
            <span className="font-normal">
              Resultado: {getScheduleOutcomeLabel(outcome)}
            </span>
            {outcomeNotes && (
              <p className="mt-1 whitespace-pre-wrap text-[11px] leading-4 text-[var(--app-text-secondary)]">
                {outcomeNotes}
              </p>
            )}
          </div>
        </AgendaRow>
      )}

      {!isMasked && status === "completed" && performedByName && (
        <AgendaRow icon={<UserRound size={18} />} align="center">
          <span className="text-[11px] font-light text-[var(--app-text-secondary)]">
            {attendanceOutcome ? "Realizado" : "Concluído"} por{" "}
            <span className="font-normal text-[var(--app-text-primary)]">
              {performedByName}
            </span>
            {completedAt ? ` · ${formatScheduleTimestamp(completedAt, timeZone)}` : ""}
          </span>
        </AgendaRow>
      )}

      {isMasked && (
        <AgendaRow icon={<Lock size={18} />} align="center">
          <span className="inline-flex h-8 items-center rounded-[6px] bg-[var(--app-surface-soft)] px-3 text-[12px] font-light text-[var(--app-text-secondary)]">
            Informações privadas
          </span>
        </AgendaRow>
      )}
    </>
  );
}
