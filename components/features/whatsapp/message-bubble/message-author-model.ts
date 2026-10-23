import { formatWhatsAppPersonName } from "@/lib/whatsapp-person-name";

export type MessageAuthorInput = {
  fromMe: boolean;
  senderName?: string | null;
  senderUserId?: string | null;
  viewerUserId?: string | null;
};

function authorUserId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) ? id : null;
}

function authorName(value: unknown): string {
  if (typeof value !== "string") return "";
  const name = value.trim().slice(0, 160);
  // Legacy/provider labels are relative to an account, not proof of the viewer.
  return /^(?:você|voce|you)$/iu.test(name) ? "" : formatWhatsAppPersonName(name).slice(0, 160);
}

/** fromMe identifies the WhatsApp account side; only CRM author IDs identify a viewer. */
export function getMessageAuthorPresentation({ fromMe, senderName, senderUserId, viewerUserId }: MessageAuthorInput) {
  const name = authorName(senderName);
  const authorId = authorUserId(senderUserId);
  const viewerId = authorUserId(viewerUserId);
  const isViewerAuthor = fromMe && authorId !== null && viewerId !== null && authorId === viewerId;
  const senderLabel = fromMe
    ? isViewerAuthor ? name ? `${name} (você)` : "Você"
      : name || (authorId ? viewerId ? "Outro usuário do CRM" : "Usuário do CRM" : "Autor não identificado")
    : name || "Contato";
  return {
    directionLabel: fromMe ? "Enviada" : "Recebida",
    senderLabel,
    bubbleSenderLabel: fromMe && !name && !authorId ? "Conta do WhatsApp" : senderLabel,
    isViewerAuthor,
  };
}
