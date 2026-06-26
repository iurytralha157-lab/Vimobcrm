import { useMutation, useQueryClient } from '@tanstack/react-query';

interface UpdateCommissionParams {
  leadId: string;
  valorInteresse: number;
  commissionPercentage: number;
}

export function useUpdateLeadCommission() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: UpdateCommissionParams) => {
      void params;
      return null;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['commissions'] });
      queryClient.invalidateQueries({ queryKey: ['financial-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['enhanced-dashboard-stats'] });
      queryClient.invalidateQueries({ queryKey: ['top-brokers'] });
    },
    onError: (error) => {
      console.error('Error updating commission:', error);
    },
  });
}
