import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { whatsappAPI } from "@/lib/api/whatsapp";

export function useHasWhatsAppAccess() {
  const { profile } = useAuth();

  return useQuery({
    queryKey: ["whatsapp-access-check", profile?.id, profile?.organization_id, profile?.role],
    queryFn: async () => {
      if (!profile?.id || !profile?.organization_id) return false;
      const response = await whatsappAPI.getSessions(profile.organization_id);
      return response.data.length > 0;
    },
    enabled: !!profile?.id && !!profile?.organization_id,
    staleTime: 1000 * 60 * 2,
  });
}
