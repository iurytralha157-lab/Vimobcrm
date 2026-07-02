import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { whatsappAPI } from "@/lib/api/whatsapp";
import { WhatsAppSession } from "./use-whatsapp-sessions";

export function useAccessibleSessions() {
  const { profile } = useAuth();

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
    enabled: !!profile?.id && !!profile?.organization_id,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    staleTime: 5_000,
    retry: false,
    refetchOnWindowFocus: true,
  });
}
