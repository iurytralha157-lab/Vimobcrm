import { useQuery } from '@tanstack/react-query';
import { usersAPI } from '@/lib/api/users';

export interface UserOrganization {
  organization_id: string;
  organization_name: string;
  organization_logo: string | null;
  member_role: string;
  is_active: boolean;
  joined_at: string;
  last_accessed_at: string | null;
}

export function useUserOrganizations(userId: string | undefined, activeOrgId?: string | null) {
  return useQuery({
    queryKey: ['user-organizations', userId],
    queryFn: async () => {
      if (!userId) return [];

      const orgs = await usersAPI.listUserOrganizations() as UserOrganization[];

      return orgs.sort((a, b) => {
        if (activeOrgId) {
          if (a.organization_id === activeOrgId) return -1;
          if (b.organization_id === activeOrgId) return 1;
        }
        return a.organization_name.localeCompare(b.organization_name);
      });
    },
    enabled: !!userId,
    staleTime: 1000 * 60 * 5,
  });
}
