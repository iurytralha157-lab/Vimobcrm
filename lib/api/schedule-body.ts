export function normalizeScheduleEventBody<T extends Record<string, unknown>>(
  data: T,
) {
  return Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined),
  );
}
