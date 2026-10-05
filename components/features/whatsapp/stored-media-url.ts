type StoredMediaMessage = {
  media_url: string | null;
  media_status?: "pending" | "ready" | "failed" | null;
  media_storage_path?: string | null;
  media_error?: string | null;
};

export type StoredMediaURL = {
  url: string | null;
  refreshAt: number | null;
};

const STORED_MEDIA_LOAD_ERROR = "Não foi possível abrir a mídia armazenada. Tente novamente.";

export function hasStoredWhatsAppMedia(message: StoredMediaMessage): boolean {
  return message.media_status === "ready" && Boolean(message.media_storage_path);
}

export function shouldLoadStoredMediaURL(
  message: StoredMediaMessage,
  entry: StoredMediaURL | undefined,
  now: number,
): boolean {
  return hasStoredWhatsAppMedia(message)
    && (!entry || (entry.refreshAt !== null && entry.refreshAt <= now));
}

/** The provider URL is never a browser fallback for a file already in Storage. */
export function withStoredMediaURL<T extends StoredMediaMessage>(
  message: T,
  entry: StoredMediaURL | undefined,
): T {
  if (!hasStoredWhatsAppMedia(message)) return message;

  const signedURL = entry?.url ?? null;
  const failed = entry?.url === null;
  return {
    ...message,
    media_url: signedURL,
    media_status: failed ? "failed" : "ready",
    media_error: failed ? STORED_MEDIA_LOAD_ERROR : null,
  };
}
