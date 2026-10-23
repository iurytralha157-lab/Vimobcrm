import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useWhatsAppQueryScope } from "@/hooks/use-whatsapp-query-scope";
import { useWhatsAppIntentMutation } from "@/hooks/integrations/whatsapp/use-whatsapp-mutation-intent";
import { whatsappAPI } from "@/lib/api/whatsapp";

type UseWhatsAppSessionStatusesOptions = {
  enabled?: boolean;
  live?: boolean;
};

export function useWhatsAppSessionStatuses(
  options: UseWhatsAppSessionStatusesOptions = {},
) {
  const scope = useWhatsAppQueryScope();
  const live = options.live === true;

  return useQuery({
    queryKey: [
      "whatsapp-session-statuses",
      scope.organizationId,
      scope.userId,
    ],
    queryFn: ({ signal }) => whatsappAPI.getSessionStatuses(scope.organizationId, { expectedUserId: scope.userId, signal }),
    enabled:
      options.enabled !== false &&
      Boolean(scope.organizationId) &&
      Boolean(scope.userId),
    refetchInterval: live ? 15_000 : 60_000,
    refetchIntervalInBackground: false,
    staleTime: live ? 5_000 : 30_000,
    gcTime: 10 * 60_000,
    refetchOnReconnect: "always",
    refetchOnWindowFocus: live ? "always" : true,
  });
}

export function useVerifyWhatsAppSessionStatus() {
  const scope = useWhatsAppQueryScope();
  const queryClient = useQueryClient();

  return useWhatsAppIntentMutation({
    mutationFn: async (sessionId: string, intent) => {
      if (!scope.organizationId) {
        throw new Error("Selecione uma organização para verificar a conexão.");
      }
      return whatsappAPI.getConnectionStatus(sessionId, intent.scope.organizationId, intent);
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: [
          "whatsapp-session-statuses",
          scope.organizationId,
          scope.userId,
        ],
      }),
  });
}
