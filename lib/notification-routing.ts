import type { Notification } from "@/hooks/use-notifications";

function normalizeText(value: string | null | undefined) {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function metadataString(metadata: Record<string, unknown> | null | undefined, key: string) {
  const value = metadata?.[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export function getNotificationRoute(notification: Pick<Notification, "title" | "content" | "type" | "lead_id" | "metadata">) {
  const title = normalizeText(notification.title);
  const content = normalizeText(notification.content);
  const text = `${title} ${content}`.trim();
  const scheduleEventId =
    metadataString(notification.metadata, "schedule_event_id") ||
    metadataString(notification.metadata, "event_id") ||
    metadataString(notification.metadata, "eventId") ||
    metadataString(notification.metadata, "task_id") ||
    metadataString(notification.metadata, "taskId");

  if (title.includes("atualize seu telefone")) {
    return "/settings?tab=account";
  }

  if (notification.lead_id) {
    return `/crm/pipelines?lead=${notification.lead_id}`;
  }

  if (
    notification.type === "lead" ||
    notification.type === "new_lead" ||
    text.includes("novo lead") ||
    text.includes("lead recebido") ||
    text.includes("lead atribuido") ||
    text.includes("lead atribuído")
  ) {
    return "/crm/pipelines";
  }

  if (
    notification.type === "task" ||
    notification.type === "schedule" ||
    text.includes("agendamento") ||
    text.includes("agenda") ||
    text.includes("lembrete") ||
    text.includes("atividade") ||
    text.includes("compromisso") ||
    text.includes("tarefa")
  ) {
    return scheduleEventId ? `/agenda?event=${scheduleEventId}` : "/agenda";
  }

  if (
    notification.type === "whatsapp" ||
    notification.type === "message" ||
    text.includes("whatsapp") ||
    text.includes("conexao desconect") ||
    text.includes("desconectado")
  ) {
    return "/settings?tab=whatsapp";
  }

  if (
    text.includes("missao") ||
    text.includes("gamificacao") ||
    text.includes("ranking") ||
    text.includes("subiu para") ||
    text.includes("pontos")
  ) {
    return "/gamificacao";
  }

  if (
    text.includes("negocio ganho") ||
    text.includes("negocio perdido") ||
    text.includes("mudou de etapa")
  ) {
    return "/crm/pipelines";
  }

  if (notification.type === "automation" || text.includes("automacao")) {
    return "/automations";
  }

  if (
    notification.type === "system" ||
    notification.type === "info" ||
    notification.type === "warning"
  ) {
    return "/settings";
  }

  return null;
}
