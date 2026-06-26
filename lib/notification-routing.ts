import type { Notification } from "@/hooks/use-notifications";

function normalizeText(value: string | null | undefined) {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function getNotificationRoute(notification: Pick<Notification, "title" | "content" | "type" | "lead_id">) {
  const title = normalizeText(notification.title);
  const content = normalizeText(notification.content);
  const text = `${title} ${content}`.trim();

  if (title.includes("atualize seu telefone")) {
    return "/settings?tab=account";
  }

  if (notification.lead_id) {
    return `/crm/pipelines?lead=${notification.lead_id}`;
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
    notification.type === "task" ||
    text.includes("agendamento") ||
    text.includes("agenda") ||
    text.includes("lembrete")
  ) {
    return "/agenda";
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

  return null;
}
