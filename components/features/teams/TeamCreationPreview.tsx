import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Crown, Users } from "lucide-react";
import { getInitials } from "@/lib/user-display";
import { isAvailabilityClock } from "@/lib/teams/availability-clock";
import {
  DAYS_SHORT,
  type DaySchedule,
} from "@/components/features/teams/availability-week";

type PreviewMember = {
  id: string;
  name: string;
  avatarUrl?: string | null;
  isLeader: boolean;
  week: DaySchedule[];
};

interface TeamCreationPreviewProps {
  name: string;
  logoUrl?: string | null;
  members: PreviewMember[];
}

export function TeamCreationPreview({
  name,
  logoUrl,
  members,
}: TeamCreationPreviewProps) {
  return (
    <div className="space-y-4 text-[12px] font-light">
      <div className="flex items-center gap-3 rounded-[8px] bg-[var(--app-surface-solid)] p-3">
        <Avatar className="h-10 w-10 rounded-[6px]">
          <AvatarImage src={logoUrl || undefined} />
          <AvatarFallback className="rounded-[6px] bg-primary/50 text-white">
            {getInitials(name || "Equipe", { fallback: "?" })}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="break-words font-normal">{name.trim() || "Nome da equipe"}</p>
          <p className="mt-1 text-[11px] text-[var(--app-text-tertiary)]">
            {members.length} {members.length === 1 ? "membro selecionado" : "membros selecionados"}
          </p>
        </div>
      </div>
      {members.length === 0 ? (
        <div className="rounded-[8px] bg-[var(--app-surface-solid)] p-4 text-center text-[var(--app-text-tertiary)]">
          <Users className="mx-auto mb-2 h-5 w-5" aria-hidden="true" />
          Os membros e a escala aparecem aqui conforme você configura a equipe.
        </div>
      ) : (
        <ul className="space-y-3">
          {members.map((member) => (
            <li key={member.id} className="rounded-[8px] bg-[var(--app-surface-solid)] p-3">
              <div className="mb-2 flex items-center gap-2">
                <Avatar className="h-7 w-7 rounded-[6px]">
                  <AvatarImage src={member.avatarUrl || undefined} />
                  <AvatarFallback className="rounded-[6px] bg-primary/50 text-[10px] text-white">
                    {getInitials(member.name, { fallback: "?" })}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 break-words">{member.name}</span>
                {member.isLeader && (
                  <span className="inline-flex shrink-0 items-center gap-1 text-[10px]">
                    <Crown className="h-3 w-3" aria-hidden="true" /> Líder
                  </span>
                )}
              </div>
              <dl className="space-y-1 text-[10px] text-[var(--app-text-secondary)]">
                {member.week.map((day) => (
                  <div key={day.day_of_week} className="flex justify-between gap-2">
                    <dt>{DAYS_SHORT[day.day_of_week]}</dt>
                    <dd>
                      {!day.is_active
                        ? "Sem atendimento"
                        : day.is_all_day
                          ? "24h"
                          : !isAvailabilityClock(day.start_time) || !isAvailabilityClock(day.end_time)
                            ? "Revisar horário"
                            : `${day.start_time} – ${day.end_time}${day.start_time > day.end_time ? " (+1 dia)" : ""}`}
                    </dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[10px] leading-4 text-[var(--app-text-tertiary)]">
        Prévia dos membros e horários configurados. A distribuição depende das regras de cada fila.
      </p>
    </div>
  );
}
