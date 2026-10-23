import { filterTextSchema, MAX_LEAD_SOURCE_FILTER_LENGTH } from '@/lib/validation/filter-text';

export const MAX_DASHBOARD_SOURCE_FILTER_LENGTH = MAX_LEAD_SOURCE_FILTER_LENGTH;
export const dashboardSourceFilterTextSchema = filterTextSchema(MAX_DASHBOARD_SOURCE_FILTER_LENGTH, 1);
const standardSourceFilterTextSchema = filterTextSchema(120, 1);

/** Response labels stay complete; only values accepted by the query may be selected. */
export function getSourceFilterUnavailableReason(source: string | null | undefined, maxLength = MAX_DASHBOARD_SOURCE_FILTER_LENGTH): string | null {
  if (!source?.trim()) return 'Esta origem não possui um valor para filtrar.';
  if (source !== source.trim()) return 'Esta origem contém espaços nas extremidades e está disponível apenas para consulta.';
  if (source.trim().toLowerCase() === 'all') return 'Esta origem usa um valor reservado e está disponível apenas para consulta.';
  const schema = maxLength === MAX_DASHBOARD_SOURCE_FILTER_LENGTH ? dashboardSourceFilterTextSchema
    : maxLength === 120 ? standardSourceFilterTextSchema : filterTextSchema(maxLength, 1);
  if (!schema.safeParse(source).success) {
    return `Esta origem está disponível para consulta, mas excede os limites do filtro (${maxLength.toLocaleString('pt-BR')} caracteres).`;
  }
  return null;
}
