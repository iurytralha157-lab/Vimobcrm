"use client";

import { useQueries } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useUserPermissions } from "@/hooks/use-user-permissions";
import { useOptionalActiveOrganizationId } from "@/hooks/use-active-organization";
import { useOrganizationModules } from "@/hooks/use-organization-modules";
import { useTenantQueryAccessSignature } from "@/hooks/shared/use-tenant-query-access-signature";
import { propertiesAPI } from "@/lib/api/properties";

/** Fetch selected IDs directly; a selection must not depend on the first list page. */
export function useSelectedProperties(ids: readonly string[], enabled = true) {
  const { user } = useAuth();
  const { hasPermission } = useUserPermissions();
  const organizationId = useOptionalActiveOrganizationId();
  const accessSignature = useTenantQueryAccessSignature();
  const { hasModule } = useOrganizationModules();
  const allowed = Boolean(enabled && user?.id && organizationId && hasModule("properties")
    && (hasPermission("property_view") || hasPermission("property_manage")));
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const queries = useQueries({
    queries: uniqueIds.map((id) => ({
      queryKey: ["property", organizationId, id, accessSignature],
      enabled: allowed,
      queryFn: async () => {
        if (!organizationId || !allowed) return null;
        return (await propertiesAPI.getProperty(id, organizationId)).data;
      },
      staleTime: 30_000,
    })),
  });
  return {
    properties: allowed ? queries.flatMap((query) => query.data ? [query.data] : []) : [],
    isLoading: allowed && queries.some((query) => query.isLoading),
  };
}
