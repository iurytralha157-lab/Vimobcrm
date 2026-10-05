import { LogIn } from "lucide-react";

import type { WhatsAppAttendanceEntry } from "@/lib/api/whatsapp";

type AttendanceTimelineEventsProps = {
  entries?: WhatsAppAttendanceEntry[];
};

const attendanceDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function AttendanceTimelineEvents({ entries = [] }: AttendanceTimelineEventsProps) {
  if (entries.length === 0) return null;

  return (
    <div data-attendance-events className="space-y-1.5 py-1">
      {[...entries]
        .sort((left, right) => new Date(left.markerAt ?? left.joinedAt).getTime() - new Date(right.markerAt ?? right.joinedAt).getTime())
        .map((entry) => (
          <div key={entry.id} className="flex justify-center px-2">
            <div className="inline-flex max-w-full items-center gap-1.5 rounded-[6px] bg-primary/8 px-2.5 py-1 text-[10px] leading-4 text-[var(--app-text-secondary)]">
              <LogIn className="h-3 w-3 shrink-0 text-primary" aria-hidden="true" />
              <span className="truncate">
                <strong className="font-medium text-[var(--app-text-primary)]">{entry.userName}</strong>
                {entry.markerKind === "started" ? " iniciou uma conversa" : " entrou na conversa"}
              </span>
              <time className="shrink-0 text-[var(--app-text-tertiary)]" dateTime={entry.markerAt ?? entry.joinedAt}>
                {attendanceDateFormatter.format(new Date(entry.markerAt ?? entry.joinedAt))}
              </time>
            </div>
          </div>
        ))}
    </div>
  );
}
