import type { ContactExportFilters } from '@/lib/export-contacts';

const filterLabels: Partial<Record<keyof ContactExportFilters, string>> = {
  search: 'Busca', teamId: 'Equipe', pipelineId: 'Pipeline', stageId: 'Estágio',
  assigneeId: 'Responsável', unassigned: 'Sem responsável', tagIds: 'Tags', tagId: 'Tag',
  source: 'Origem', pageId: 'Página', campaignId: 'Campanha', campaignIds: 'Campanhas',
  adSetId: 'Conjunto', adId: 'Anúncio', dealStatus: 'Status do negócio',
  createdFrom: 'Data inicial', createdTo: 'Data final',
};

const statuses: Record<string, string> = { open: 'Aberto', won: 'Ganho', lost: 'Perdido' };

export function getContactExportFilterPreview(
  filters: ContactExportFilters,
  resolvedValues: Partial<Record<keyof ContactExportFilters, string>> = {},
) {
  return Object.entries(filters).flatMap(([rawKey, value]) => {
    const key = rawKey as keyof ContactExportFilters;
    if (Array.isArray(value) ? value.length === 0 : !value) return [];
    let text = Array.isArray(value) ? value.join(', ') : value === true ? 'Sim' : String(value);
    if (key === 'dealStatus') text = statuses[text] ?? text;
    if (key === 'createdFrom' || key === 'createdTo') {
      const date = new Date(text);
      if (!Number.isNaN(date.getTime())) {
        text = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
      }
    }
    return [{ key, label: filterLabels[key] ?? 'Filtro', value: resolvedValues[key] ?? text }];
  });
}
