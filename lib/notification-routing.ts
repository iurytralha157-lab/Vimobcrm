import type { Notification } from "@/lib/api/notifications";
import { getSafeProtectedAppPath } from "@/lib/auth/post-login-redirect";

export type NotificationRouteAccess = {
  canViewWhatsApp?: boolean;
};

export type PushNotificationData = Record<string, unknown>;

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

function pushDataString(data: PushNotificationData, ...keys: string[]) {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function whatsAppConversationTarget(explicitTarget: string | null, data: PushNotificationData) {
  if (explicitTarget && /^\/crm\/conversas(?:[/?#]|$)/.test(explicitTarget)) return explicitTarget;
  const validID = (value: string | null) => value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : null;
  const conversationID = validID(pushDataString(data, 'whatsapp_conversation_id', 'conversation_id', 'conversationId'));
  const legacyLeadID = explicitTarget ? new URL(explicitTarget, 'https://vimob.internal').searchParams.get('leadId') : null;
  const leadID = validID(pushDataString(data, 'lead_id', 'leadId') || legacyLeadID);
  const params = new URLSearchParams();
  if (conversationID) params.set('conversation', conversationID);
  if (leadID) params.set('lead', leadID);
  return `/crm/conversas${params.size ? `?${params.toString()}` : ''}`;
}

/**
 * Resolves an OS push click to a protected in-app route. Payload URLs are
 * untrusted input: external/public/auth routes always fall back to the
 * notification center, and WhatsApp remains behind the active tenant access.
 */
export function getPushNotificationRoute(
  data: PushNotificationData,
  access: NotificationRouteAccess = {},
) {
  const explicitTarget = getSafeProtectedAppPath(
    pushDataString(data, "target_url", "targetUrl", "url"),
  );
  const type = normalizeText(pushDataString(data, "type", "event_type", "eventType"));
  const isWhatsAppTarget = explicitTarget === "/crm/conversas"
    || explicitTarget?.startsWith("/crm/conversas/")
    || explicitTarget?.startsWith("/crm/conversas?")
    || explicitTarget?.startsWith("/crm/conversas#");
  const isWhatsAppNotification = isWhatsAppTarget
    || type === "whatsapp"
    || type === "message"
    || type.startsWith("whatsapp_");

  if (isWhatsAppNotification) {
    if (!access.canViewWhatsApp) return "/notifications";
    return whatsAppConversationTarget(explicitTarget, { ...data, ...(data.metadata && typeof data.metadata === 'object' ? data.metadata : {}) });
  }

  if (explicitTarget) return explicitTarget;

  const leadId = pushDataString(data, "lead_id", "leadId");
  if (leadId) {
    return `/crm/pipelines?lead=${encodeURIComponent(leadId)}`;
  }

  if (type === "commission" || type === "financial") {
    return "/financeiro";
  }

  if (type === "task" || type === "schedule" || type === "reminder") {
    const eventId = pushDataString(
      data,
      "schedule_event_id",
      "scheduleEventId",
      "event_id",
      "eventId",
      "task_id",
      "taskId",
    );
    return eventId ? `/agenda?event=${encodeURIComponent(eventId)}` : "/agenda";
  }

  return "/notifications";
}

export function getNotificationRoute(
  notification: Pick<Notification, "title" | "content" | "type" | "lead_id" | "target_url" | "metadata">,
  access: NotificationRouteAccess = {},
) {
  const explicitTarget = getSafeProtectedAppPath(notification.target_url);
  const title = normalizeText(notification.title);
  const content = normalizeText(notification.content);
  const text = `${title} ${content}`.trim();
  const notificationType = notification.type.toLowerCase();
  const scheduleEventId =
    metadataString(notification.metadata, "schedule_event_id") ||
    metadataString(notification.metadata, "event_id") ||
    metadataString(notification.metadata, "eventId") ||
    metadataString(notification.metadata, "task_id") ||
    metadataString(notification.metadata, "taskId");

  if (title.includes("atualize seu telefone")) {
    return "/settings?tab=account";
  }

  const isWhatsAppNotification =
    notificationType === "whatsapp" ||
    notificationType === "message" ||
    text.includes("whatsapp") ||
    text.includes("conexao desconect") ||
    text.includes("desconectado");

  if (isWhatsAppNotification) {
    if (!access.canViewWhatsApp) return null;
    return whatsAppConversationTarget(explicitTarget, { ...notification.metadata, lead_id: notification.lead_id });
  }

  if (explicitTarget) return explicitTarget;

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
