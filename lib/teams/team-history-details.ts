import type { TeamHistoryEvent } from "@/lib/api/teams";
import { availabilityClockForEditor } from "@/lib/teams/availability-clock";
const DAYS_OF_WEEK = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];

export type TeamHistoryDetail = { label: string; before?: string; after: string };

function scheduleDescription(data: Record<string, unknown> | null | undefined): string {
  if (!data) return "Não configurado";
  if (data.is_active === false) return "Sem atendimento";
  if (data.is_all_day === true) return "24h";
  if (typeof data.start_time !== "string" || typeof data.end_time !== "string") return "Sem horário definido";
  const start = availabilityClockForEditor(data.start_time);
  const end = availabilityClockForEditor(data.end_time);
  if (!start || !end) return "Horário inválido ou incompleto";
  return `${start} – ${end}${start > end ? " (+1 dia)" : ""}`;
}

export function getTeamHistoryDetails(event: TeamHistoryEvent): TeamHistoryDetail[] {
  if (event.entity_type === "team_member_availability") {
    const day = event.new_data?.day_of_week ?? event.old_data?.day_of_week;
    return [{
      label: typeof day === "number" ? DAYS_OF_WEEK[day] || "Escala" : "Escala",
      before: event.action === "create" ? undefined : scheduleDescription(event.old_data),
      after: event.action === "delete" ? "Escala removida" : scheduleDescription(event.new_data),
    }];
  }
  const fields: Record<string, { label: string; describe: (value: unknown) => string }> = {
    name: { label: "Nome", describe: (value) => typeof value === "string" ? value : "Não informado" },
    logo_url: { label: "Logo", describe: (value) => value ? "Logo definida" : "Sem logo" },
    is_active: { label: "Situação", describe: (value) => value === false ? "Inativa" : "Ativa" },
    is_leader: { label: "Participação", describe: (value) => value === true ? "Líder" : "Membro" },
  };
  return Object.entries(fields).flatMap(([key, field]) => {
    const changed = Object.prototype.hasOwnProperty.call(event.diff || {}, key);
    if (!changed && event.action !== "create" && event.action !== "delete") return [];
    const data = event.action === "delete" ? event.old_data : event.new_data;
    if (!data || !Object.prototype.hasOwnProperty.call(data, key)) return [];
    return [{ label: field.label, before: changed ? field.describe(event.old_data?.[key]) : undefined, after: field.describe(data[key]) }];
  });
}
