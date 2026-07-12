import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { DEFAULT_ENABLED_MODULE_KEYS, type SystemModuleKey } from '@/config/constants';
import { settingsAPI, type OrganizationModule } from '@/lib/api/settings';
import {
  getTenantEnabledModules,
  hasDefaultModule,
  isTenantContextForOrganization,
} from '@/lib/access/tenant-navigation';

export type ModuleName = SystemModuleKey;

// Default modules that are enabled if no explicit record exists
export const DEFAULT_ENABLED_MODULES: ModuleName[] = [...DEFAULT_ENABLED_MODULE_KEYS];

export function useOrganizationModules() {
  const { organization, profile, tenantContext, loading: authLoading } = useAuth();
  const orgId = organization?.id || profile?.organization_id;
  const hasCurrentTenantContext = isTenantContextForOrganization(orgId, tenantContext);

  const {
    data: modules = [],
    error,
    isLoading: modulesLoading,
    isSuccess: modulesLoaded,
    refetch,
  } = useQuery({
    queryKey: ['organization-modules', orgId],
    queryFn: async () => {
      if (!orgId) return [];
      return settingsAPI.listModules(orgId);
    },
    enabled: !authLoading && !!orgId,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 15,
    refetchOnWindowFocus: false,
  });

  const isLoading = authLoading || (!!orgId && !hasCurrentTenantContext && modulesLoading);

  // Check if a specific module is enabled
  const hasModule = (moduleName: ModuleName): boolean => {
    // Super admins need to enable modules explicitly to see them as a regular user would,
    // but we can keep the logic flexible. Based on user request, we want them disabled by default.
    // if (isSuperAdmin && orgId) return true;


    // If no organization, no modules available
    if (!orgId) return false;

    // The authenticated tenant context already contains the effective module list.
    // Use it until the detailed settings query is available.
    if (!modulesLoaded && hasCurrentTenantContext && tenantContext) {
      return getTenantEnabledModules(tenantContext).includes(moduleName);
    }

    // Keep conservative defaults only when the context could not be resolved yet.
    if (!modulesLoaded) return hasDefaultModule(moduleName);

    // Find the module in the list
    const moduleRecord = modules.find(m => m.module_name === moduleName);

    // If found in list, use its value
    if (moduleRecord) {
      return moduleRecord.is_enabled ?? false;
    }

    // If not found in list, check defaults
    return DEFAULT_ENABLED_MODULES.includes(moduleName);
  };

  // Get list of all enabled modules
  const enabledModules = (): ModuleName[] => {
    if (!orgId) return [];

    if (!modulesLoaded && hasCurrentTenantContext && tenantContext) {
      return getTenantEnabledModules(tenantContext);
    }

    // Start with default list
    let list = [...DEFAULT_ENABLED_MODULES];

    // Apply database settings
    if (modules.length > 0) {
      (modules as OrganizationModule[]).forEach(m => {
        const name = m.module_name as ModuleName;
        if (m.is_enabled) {
          if (!list.includes(name)) list.push(name);
        } else {
          list = list.filter(item => item !== name);
        }
      });
    }

    return list;
  };

  return {
    modules,
    error,
    isLoading,
    hasModule,
    enabledModules,
    refetch,
  };
}
