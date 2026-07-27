import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { siteAPI } from "@/lib/api/site";
import { toast } from "sonner";

interface VerifyDomainResult {
  domain: string;
  verified: boolean;
  checked_at: string;
  reason?: 'challenge_unavailable' | 'challenge_mismatch';
}

export function useVerifyDomain() {
  const queryClient = useQueryClient();
  const { organization } = useAuth();

  return useMutation({
    mutationFn: async (domain: string): Promise<VerifyDomainResult> => {
      if (!organization?.id) throw new Error('Organização não encontrada.');
      if (!domain.trim()) throw new Error('Domínio não informado.');
      return siteAPI.verifyDomain(organization?.id);
    },
    onSuccess: (data) => {
      if (data.verified) {
        toast.success('Domínio verificado com sucesso!');
        queryClient.invalidateQueries({ queryKey: ['organization-site'] });
      }
    },
    onError: (error) => {
      console.error('Error verifying domain:', error);
      toast.error('Erro ao verificar domínio');
    },
  });
}
