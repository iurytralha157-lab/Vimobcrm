import { useQuery } from '@tanstack/react-query';
import { publicSiteAPI } from '@/lib/api/public-site';
import type { SiteSearchFilter } from './use-site-search-filters';

export function usePublicSearchFilters(organizationId: string | null) {
  return useQuery({
    queryKey: ['public-search-filters', organizationId],
    queryFn: async () => {
      const response = await publicSiteAPI.listSearchFilters<SiteSearchFilter[]>(organizationId!);
      return response.data || [];
    },
    enabled: !!organizationId,
  });
}

// Default filters when none configured
export const DEFAULT_SEARCH_FILTERS = [
  { filter_key: 'search', label: 'Buscar', position: 0 },
  { filter_key: 'tipo', label: 'Tipo de Imóvel', position: 1 },
  { filter_key: 'finalidade', label: 'Finalidade', position: 2 },
];
