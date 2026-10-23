export const MAX_SHARED_REPORT_RANGE_DAYS = 5 * 366;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** Match the API's elapsed-duration bound without changing shared filter state. */
export function validateDateRangeLimit(
  range: { from: Date; to: Date } | null | undefined,
  maxDays: number,
): string | null {
  if (!range) return null;
  if (!Number.isFinite(maxDays) || maxDays <= 0) {
    return "O limite do período é inválido.";
  }
  if (!(range.from instanceof Date) || !(range.to instanceof Date)) {
    return "Selecione um período válido.";
  }
  const from = range.from.getTime();
  const to = range.to.getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return "Selecione um período válido.";
  }
  if (to <= from) {
    return "A data final deve ser posterior à data inicial.";
  }
  if (to - from <= maxDays * MILLISECONDS_PER_DAY) return null;
  return maxDays === MAX_SHARED_REPORT_RANGE_DAYS
    ? "Este relatório permite um período de até cinco anos. Reduza o intervalo ou limpe o período para consultar todos os dados."
    : `Este filtro permite um período de até ${maxDays.toLocaleString("pt-BR")} ${maxDays === 1 ? "dia" : "dias"}. Reduza o intervalo ou limpe o período.`;
}
