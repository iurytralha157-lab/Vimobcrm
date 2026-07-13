import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { whatsappAPI } from "@/lib/api/whatsapp";

export function useHasWhatsAppAccess(options?: { enabled?: boolean }) {
  const { profile, organization } = useAuth();
  const organizationId = organization?.id ?? profile?.organization_id;
  const shouldFetch = options?.enabled ?? true;

  return useQuery({
    queryKey: ["whatsapp-access-check", profile?.id, organizationId],
    queryFn: async () => {
      if (!profile?.id || !organizationId) return false;
      const response = await whatsappAPI.getSessions(organizationId);
      return response.data.length > 0;
    },
    enabled: shouldFetch && !!profile?.id && !!organizationId,
    staleTime: 1000 * 60 * 2,
    gcTime: 1000 * 60 * 10,
    refetchOnWindowFocus: false,
  });
}
