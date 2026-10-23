function revisionNanoseconds(value: string | null | undefined): bigint | null {
  if (!value) return null;
  const match = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.(\d{1,9}))?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  // Date.parse truncates after milliseconds. PostgreSQL revisions retain
  // microseconds and Go's RFC3339Nano can also include nanoseconds.
  const remainder = (match[1] || '').padEnd(9, '0').slice(3);
  return BigInt(milliseconds) * BigInt(1_000_000) + BigInt(remainder);
}

/** Compare server timestamps without changing the original CAS tokens. */
export function compareServerRevisions(
  left: string | null | undefined,
  right: string | null | undefined,
): -1 | 0 | 1 | null {
  const first = revisionNanoseconds(left);
  const second = revisionNanoseconds(right);
  if (first === null || second === null) return null;
  return first > second ? 1 : first < second ? -1 : 0;
}
