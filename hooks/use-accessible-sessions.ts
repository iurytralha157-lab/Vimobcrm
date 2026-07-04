import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { whatsappAPI } from "@/lib/api/whatsapp";
import { WhatsAppSession } from "./use-whatsapp-sessions";

type UseAccessibleSessionsOptions = {
  enabled?: boolean;
};

export function useAccessibleSessions(options: UseAccessibleSessionsOptions = {}) {
  const { profile } = useAuth();
  const shouldFetch = options.enabled ?? true;

  return useQuery({
    queryKey: ["accessible-sessions", profile?.id, profile?.organization_id, profile?.role],
    queryFn: async (): Promise<WhatsAppSession[]> => {
      if (!profile?.id || !profile?.organization_id) {
        return [];
      }

      const response = await whatsappAPI.getSessions(profile.organization_id);
      const sessions = response.data as WhatsAppSession[];
      return sessions.sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
    },
    enabled: shouldFetch && !!profile?.id && !!profile?.organization_id,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}
