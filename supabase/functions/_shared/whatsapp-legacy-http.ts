/** Status/notification traffic only. This helper never retries a request or
 * classifies an ambiguous POST as safe to repeat. The caller owns its dedupe. */
export const WHATSAPP_LEGACY_HTTP_TIMEOUT_MS = 5_000;

export class WhatsAppLegacyHttpTimeoutError extends Error {
  constructor() {
    super("WhatsApp upstream request timed out");
    this.name = "WhatsAppLegacyHttpTimeoutError";
  }
}

export async function withWhatsAppLegacyHttpDeadline<T>(
  input: string,
  init: RequestInit,
  consume: (response: Response) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  if (init.signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
  let response: Response | undefined;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: (() => void) | undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    cancel = () => { controller.abort(); reject(new DOMException("Request cancelled", "AbortError")); };
    init.signal?.addEventListener("abort", cancel, { once: true });
  });
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      expired = true;
      controller.abort();
      reject(new WhatsAppLegacyHttpTimeoutError());
    }, WHATSAPP_LEGACY_HTTP_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      (async () => {
        response = await fetch(input, { ...init, signal: controller.signal });
        if (controller.signal.aborted) throw new DOMException("Request cancelled", "AbortError");
        return await consume(response);
      })(),
      deadline,
      cancelled,
    ]);
  } catch (error) {
    if (expired) throw new WhatsAppLegacyHttpTimeoutError();
    throw error;
  } finally {
    clearTimeout(timer);
    if (cancel) init.signal?.removeEventListener("abort", cancel);
    // Also dispose an unread non-2xx body. A completed JSON body is already
    // consumed; abort is needed only for a pending/unread response.
    if (response && !response.bodyUsed) controller.abort();
  }
}
