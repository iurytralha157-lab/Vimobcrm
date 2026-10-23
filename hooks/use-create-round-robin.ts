import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { roundRobinsAPI } from '@/lib/api/round-robins';
import { useRef } from 'react';
import { createUUID } from '@/lib/client-id';
import { useActiveOrganizationId } from '@/hooks/use-active-organization';

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
  const organizationId = useActiveOrganizationId();
  const attempt = useRef<{ fingerprint: string; id: string } | null>(null);

  return useMutation({
    mutationFn: async (input: CreateRoundRobinInput) => {
      if (!organizationId) throw new Error('Organização não identificada');
      const fingerprint = JSON.stringify([organizationId, input]);
      if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, id: createUUID() };
      return roundRobinsAPI.createRoundRobin({
        creationAttemptId: attempt.current.id,
        name: input.name,
        strategy: input.strategy,
        rules: input.rules,
        members: input.members.map((member) => ({
          type: member.user_id ? 'user' : 'team',
          entityId: member.user_id || member.team_id,
          teamId: member.user_id ? member.team_id : undefined,
          weight: member.weight || 1,
        })),
      }, organizationId);
    },
    onSuccess: () => {
      attempt.current = null;
      queryClient.invalidateQueries({ queryKey: ['round-robins', organizationId] });
      toast.success('Fila de distribuicao criada!');
    },
    onError: (error) => {
      toast.error('Erro ao criar fila: ' + error.message);
    },
  });
}
