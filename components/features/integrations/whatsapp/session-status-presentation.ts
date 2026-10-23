import type {
  WhatsAppSessionStatusScope,
  WhatsAppSessionStatusSummary,
} from "@/lib/api/whatsapp";

export type WhatsAppStatusTone =
  | "connected"
  | "waiting"
  | "disconnected"
  | "unknown";

export type WhatsAppStatusPresentation = {
  label: string;
  tone: WhatsAppStatusTone;
};

export const WHATSAPP_SESSION_ACTION_CLASS_NAME =
  "border-0 bg-primary/50 font-light text-primary-foreground shadow-none transition-colors hover:bg-primary hover:text-primary-foreground disabled:opacity-50";
export const WHATSAPP_SESSION_STATUS_SIZE_CLASS_NAME =
  "inline-flex h-8 w-[136px] shrink-0 items-center justify-center px-3 py-0 text-[12px] font-medium leading-none";

const statusBadgeToneClassName: Record<WhatsAppStatusTone, string> = {
  connected: "bg-emerald-600",
  waiting: "bg-amber-500",
  disconnected: "bg-red-500",
  unknown: "bg-slate-500",
};

export function getWhatsAppStatusPresentation(
  rawStatus: string,
): WhatsAppStatusPresentation {
  const status = rawStatus.trim().toLowerCase();

  if (status === "error") {
    return { label: "Erro", tone: "disconnected" };
  }
  if (["connected", "open", "online", "ready"].includes(status)) {
    return { label: "Conectado", tone: "connected" };
  }
  if (
    ["qr", "qrcode", "qr_ready", "pairing", "connecting"].includes(status)
  ) {
    return { label: "Aguardando conexão", tone: "waiting" };
  }
  if (
    [
      "close",
      "closed",
      "disconnected",
      "disconnect",
      "offline",
      "logout",
      "logged_out",
    ].includes(status)
  ) {
    return { label: "Desconectado", tone: "disconnected" };
  }

  return { label: "Status pendente", tone: "unknown" };
}

export function getWhatsAppStatusBadgeClassName(rawStatus: string) {
  const { tone } = getWhatsAppStatusPresentation(rawStatus);
  return `rounded-[6px] border-0 text-white shadow-none ${statusBadgeToneClassName[tone]}`;
}

export function getWhatsAppStatusScopeCopy(scope: WhatsAppSessionStatusScope) {
  if (scope === "organization") {
    return "Todas as conexões ativas da organização, sem acesso às conversas.";
  }
  if (scope === "team") {
    return "Somente suas conexões e as conexões de usuários das equipes que você lidera.";
  }
  return "Somente suas próprias conexões WhatsApp.";
}

export function summarizeWhatsAppSessionStatuses(
  sessions: readonly WhatsAppSessionStatusSummary[],
) {
  return sessions.reduce(
    (summary, session) => {
      const tone = getWhatsAppStatusPresentation(session.status).tone;
      summary.total += 1;
      if (tone === "connected") summary.connected += 1;
      else summary.attention += 1;
      return summary;
    },
    { total: 0, connected: 0, attention: 0 },
  );
}
