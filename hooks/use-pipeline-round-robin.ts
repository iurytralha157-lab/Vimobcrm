import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { pipelinesAPI } from '@/lib/api/pipelines';

export function useUpdatePipelineRoundRobin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ pipelineId, roundRobinId }: { pipelineId: string; roundRobinId: string | null }) => {
      return pipelinesAPI.setPipelineRoundRobin(pipelineId, roundRobinId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipelines'] });
      queryClient.invalidateQueries({ queryKey: ['round-robins'] });
      toast.success('Round-robin padrao atualizado!');
    },
    onError: (error: Error) => {
      toast.error('Erro ao atualizar: ' + error.message);
    },
  });
}
