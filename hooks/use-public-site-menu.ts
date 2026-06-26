import { useQuery } from '@tanstack/react-query';
import { publicSiteAPI } from '@/lib/api/public-site';
import type { SiteMenuItem } from './use-site-menu';

export function usePublicSiteMenu(organizationId: string | null) {
  return useQuery({
    queryKey: ['public-site-menu', organizationId],
    queryFn: async () => {
      const response = await publicSiteAPI.listMenuItems<SiteMenuItem[]>(organizationId!);
      return response.data || [];
    },
    enabled: !!organizationId,
  });
}
