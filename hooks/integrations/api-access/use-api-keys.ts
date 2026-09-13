"use client";

import { useQuery } from "@tanstack/react-query";
import { useActiveOrganizationId } from "@/hooks/use-active-organization";
import { settingsAPI, type OrganizationApiKey } from "@/lib/api/settings";
import { shouldRetryIntegrationQuery } from "@/lib/api/integration-query";

export function useAPIKeys(options: { enabled?: boolean } = {}) {
  const organizationId = useActiveOrganizationId();

  return useQuery<OrganizationApiKey[]>({
    queryKey: ["api-keys", organizationId],
    queryFn: () => settingsAPI.listApiKeys(organizationId),
    enabled: !!organizationId && (options.enabled ?? true),
    refetchOnMount: "always",
    retry: shouldRetryIntegrationQuery,
  });
}
