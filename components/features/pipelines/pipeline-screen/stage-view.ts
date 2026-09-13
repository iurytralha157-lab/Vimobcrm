import type { PipelineLead, StageWithLeads } from '@/hooks/use-stages';
import { normalizeSearchText, searchTextIncludes } from '@/lib/search-text';

type FilterPipelineStagesInput = {
  stages: StageWithLeads[];
  searchQuery: string;
  deferredSearch: string;
  serverSearchResults: PipelineLead[];
};

export function filterPipelineStages({
  stages,
  searchQuery,
  deferredSearch,
  serverSearchResults,
}: FilterPipelineStagesInput): StageWithLeads[] {
  return stages.map((stage) => {
    let stageLeads = [...(stage.leads || [])];
    const normalizedSearch = searchQuery ? normalizeSearchText(searchQuery) : '';
    const matchesCurrentSearch = (lead: PipelineLead) => {
      if (!normalizedSearch) return true;
      const nameMatch = searchTextIncludes(lead.name, normalizedSearch);
      const phoneMatch = (lead.phone || '').includes(normalizedSearch);
      const emailMatch = searchTextIncludes(lead.email, normalizedSearch);
      return nameMatch || phoneMatch || emailMatch;
    };

    if (searchQuery) {
      stageLeads = stageLeads.filter(matchesCurrentSearch);
    }

    if (deferredSearch && serverSearchResults.length > 0) {
      const loadedIds = new Set(stageLeads.map((lead) => lead.id));
      const extraLeads = serverSearchResults.filter(
        (lead) =>
          lead.stage_id === stage.id &&
          !loadedIds.has(lead.id) &&
          matchesCurrentSearch(lead),
      );
      stageLeads = [...stageLeads, ...extraLeads];
    }

    return {
      ...stage,
      leads: stageLeads,
    };
  });
}
