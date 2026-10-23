import { resolveLeadSourceInput } from '@/lib/lead-source-options';

// These names are control values in Contacts filters, not usable source names.
const FILTER_SENTINELS = new Set(['all', '__all__', 'none', '__none__', 'null', 'undefined']);

export function resolveContactImportSource(value: string) {
  if (FILTER_SENTINELS.has(value.trim().toLocaleLowerCase('pt-BR'))) {
    return { success: false as const, error: 'A origem usa um valor reservado dos filtros. Escolha outro nome.' };
  }
  return resolveLeadSourceInput(value);
}
