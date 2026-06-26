import { useMutation } from "@tanstack/react-query";
import { whatsappAPI } from "@/lib/api/whatsapp";

type EvolutionGoPayload = Record<string, unknown> & {
  session_id?: string;
  instance_id?: string;
  body?: Record<string, unknown>;
  organizationId?: string;
};

type EvolutionGoData = {
  data?: EvolutionGoData;
  labels?: unknown;
  [key: string]: unknown;
};

type EvolutionGoResponse<T = EvolutionGoData> = {
  ok: boolean;
  status?: number;
  data?: T;
  error?: string;
};

export async function callEvolutionGo<T = EvolutionGoData>(
  action: string,
  payload: EvolutionGoPayload = {},
): Promise<EvolutionGoResponse<T>> {
  if (!payload.session_id) {
    return { ok: false, error: "session_id is required" };
  }

  return whatsappAPI.providerAction<T>({
    action,
    session_id: payload.session_id,
    instance_id: payload.instance_id,
    body: payload.body,
  }, payload.organizationId) as Promise<EvolutionGoResponse<T>>;
}

export function useEvolutionGoAction<T = EvolutionGoData>() {
  return useMutation({
    mutationFn: ({ action, payload }: { action: string; payload?: EvolutionGoPayload }) =>
      callEvolutionGo<T>(action, payload),
  });
}

export const evolutionGo = {
  qr: (session_id: string) => callEvolutionGo("instance.qr", { session_id }),
  status: (session_id: string) => callEvolutionGo("instance.status", { session_id }),
  connect: (session_id: string) =>
    callEvolutionGo("instance.connect", { session_id, body: {} }),
  disconnect: (session_id: string) => callEvolutionGo("instance.disconnect", { session_id }),
  logout: (session_id: string) => callEvolutionGo("instance.logout", { session_id }),
  delete: (session_id: string) => callEvolutionGo("instance.delete", { session_id }),
  forceReconnect: (session_id: string) =>
    callEvolutionGo("instance.forceReconnect", { session_id }),

  sendText: (session_id: string, number: string, text: string, mentions?: string[]) =>
    callEvolutionGo("send.text", { session_id, body: { number, text, mentions } }),
  sendMedia: (
    session_id: string,
    number: string,
    base64: string,
    mediatype: "image" | "video" | "document" | "audio",
    mimetype: string,
    fileName?: string,
    caption?: string,
  ) =>
    callEvolutionGo("send.media", {
      session_id,
      body: { number, type: mediatype, url: base64, media: base64, mediatype, mimetype, fileName, filename: fileName, caption },
    }),
  sendAudio: (session_id: string, number: string, base64: string, mimetype = "audio/ogg") =>
    callEvolutionGo("send.audio", {
      session_id,
      body: { number, type: "audio", url: base64, media: base64, mimetype },
    }),

  archive: (session_id: string, jid: string) =>
    callEvolutionGo("chat.archive", { session_id, body: { jid } }),
  mute: (session_id: string, jid: string, duration?: number) =>
    callEvolutionGo("chat.mute", { session_id, body: { jid, duration } }),
  pin: (session_id: string, jid: string) =>
    callEvolutionGo("chat.pin", { session_id, body: { jid } }),
  historySync: (session_id: string, jid?: string) =>
    callEvolutionGo("chat.historySync", { session_id, body: { jid } }),

  labels: (session_id: string) => callEvolutionGo("label.list", { session_id }),
  addLabelToChat: (session_id: string, labelId: string, jid: string) =>
    callEvolutionGo("label.addChat", { session_id, body: { labelId, jid } }),

  myGroups: (session_id: string) => callEvolutionGo("group.myAll", { session_id }),
  groupInfo: (session_id: string, jid: string) =>
    callEvolutionGo("group.info", { session_id, body: { groupJid: jid } }),

  avatar: (session_id: string, jid: string) =>
    callEvolutionGo("user.avatar", { session_id, body: { number: jid.replace(/@.*/, "").replace(/\D/g, ""), preview: true } }),
  check: (session_id: string, numbers: string[]) =>
    callEvolutionGo("user.check", { session_id, body: { numbers } }),
  contacts: (session_id: string) => callEvolutionGo("user.contacts", { session_id }),

  markRead: (session_id: string, jid: string, messageIds: string[]) =>
    callEvolutionGo("message.markread", { session_id, body: { allowWhatsAppReadReceipt: true, jid, messageIds } }),
  deleteMsg: (session_id: string, jid: string, messageId: string) =>
    callEvolutionGo("message.delete", { session_id, body: { jid, messageId } }),
  editMsg: (session_id: string, jid: string, messageId: string, text: string) =>
    callEvolutionGo("message.edit", { session_id, body: { jid, messageId, text } }),
  react: (session_id: string, jid: string, messageId: string, emoji: string) =>
    callEvolutionGo("message.react", { session_id, body: { jid, messageId, emoji } }),
};
