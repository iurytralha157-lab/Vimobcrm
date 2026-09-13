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

export function getWhatsAppStatusPresentation(
  rawStatus: string,
): WhatsAppStatusPresentation {
  const status = rawStatus.trim().toLowerCase();

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
