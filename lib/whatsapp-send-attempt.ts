export type SendAttemptLock = { current: boolean };

/** Keep the first user action in flight through attendance and the API send. */
export async function runWhatsAppSendAttempt(
  lock: SendAttemptLock,
  send: () => Promise<void>,
): Promise<boolean> {
  if (lock.current) return false;
  lock.current = true;
  try {
    await send();
    return true;
  } finally {
    lock.current = false;
  }
}
