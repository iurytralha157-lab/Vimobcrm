import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { roundRobinsAPI } from '@/lib/api/round-robins';

interface RoundRobinRule {
  match_type: string;
  match_value: string;
}

interface RoundRobinMember {
  user_id?: string;
  team_id?: string;
  weight?: number;
}

interface CreateRoundRobinInput {
  name: string;
  strategy: 'simple' | 'weighted';
  rules: RoundRobinRule[];
  members: RoundRobinMember[];
}

export function useCreateRoundRobin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateRoundRobinInput) => {
      return roundRobinsAPI.createRoundRobin({
        name: input.name,
        strategy: input.strategy,
        rules: input.rules,
        members: input.members.map((member) => ({
          type: member.team_id ? 'team' : 'user',
          entityId: member.team_id || member.user_id,
          weight: member.weight || 1,
        })),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['round-robins'] });
      toast.success('Fila de distribuicao criada!');
    },
    onError: (error) => {
      toast.error('Erro ao criar fila: ' + error.message);
    },
  });
}
