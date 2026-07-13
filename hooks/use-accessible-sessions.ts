import { useQuery } from "@tanstack/react-query";
import { whatsappAPI } from "@/lib/api/whatsapp";
import { WhatsAppSession } from "./use-whatsapp-sessions";
import { useWhatsAppQueryScope } from "./use-whatsapp-query-scope";
import { whatsappQueryKeys } from "@/lib/whatsapp-query-cache";

type UseAccessibleSessionsOptions = {
  enabled?: boolean;
};

export function useAccessibleSessions(options: UseAccessibleSessionsOptions = {}) {
  const scope = useWhatsAppQueryScope();
  const shouldFetch = options.enabled ?? true;

  return useQuery({
    queryKey: whatsappQueryKeys.accessibleSessions(scope),
    queryFn: async (): Promise<WhatsAppSession[]> => {
      if (!scope.userId || !scope.organizationId) {
        return [];
      }

      const response = await whatsappAPI.getSessions(scope.organizationId);
      const sessions = response.data as WhatsAppSession[];
      return sessions.sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
    },
    enabled: shouldFetch && !!scope.userId && !!scope.organizationId,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });
}
