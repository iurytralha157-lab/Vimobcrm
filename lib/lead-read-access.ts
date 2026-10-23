export function isDefinitiveLeadReadDenial(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('status' in error)) return false;
  return error.status === 403 || error.status === 404;
}

/** A transient network error may keep a snapshot; a definitive denial may not. */
export function visibleLeadRead<T>(data: T, error: unknown): T | null {
  return isDefinitiveLeadReadDenial(error) ? null : data;
}
