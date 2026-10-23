import { useMutation, useQueryClient, type MutationFunctionContext, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { roundRobinsAPI } from '@/lib/api/round-robins';
import { useAuth } from '@/contexts/AuthContext';
import { useRef } from 'react';
import { createUUID } from '@/lib/client-id';
import type { DistributionQueueCondition, DistributionQueueSettings } from '@/lib/round-robin/distribution-queue-form';
import { queueMutationCollections } from '@/lib/round-robin/queue-snapshot';
import { captureQueryClientAccess } from '@/lib/access/query-client-access';

interface ScheduleDay {
  day: number;
  enabled: boolean;
  start: string;
  end: string;
}

interface QueueMember {
  isActive?: boolean;
  reenroll?: boolean;
  id?: string;
  type: 'user' | 'team';
  entityId: string;
  teamId?: string;
  weight: number;
  name?: string;
}

interface QueueSettings extends DistributionQueueSettings {
  ignore_availability?: boolean;
  auto_tag_ids?: string[];
  enable_redistribution?: boolean;
  redistribution_timeout_minutes?: number;
  redistribution_warning_minutes?: number;
  redistribution_max_attempts?: number;
  preserve_position?: boolean;
  require_checkin?: boolean;
  reentry_behavior?: 'redistribute' | 'keep_assignee';
  whatsapp_distribution_auto_reply_enabled?: boolean;
  whatsapp_distribution_auto_reply_message?: string;
  whatsapp_distribution_auto_reply_delay_seconds?: number;
}

type QueueSettingsWithSchedule = QueueSettings & {
  schedule?: ScheduleDay[];
};

interface CreateQueueInput {
  preserveRuleSnapshot?: boolean;
  preserveMemberSnapshot?: boolean;
  creationAttemptId?: string;
  expectedRevision?: number;
  name: string;
  strategy: 'simple' | 'weighted';
  target_pipeline_id: string;
  target_stage_id: string;
  is_active: boolean;
  settings: QueueSettings;
  schedule?: ScheduleDay[];
  conditions: DistributionQueueCondition[];
  members: QueueMember[];
}

function buildFullSettings(input: CreateQueueInput): QueueSettingsWithSchedule {
  return {
    ...input.settings,
    ...(input.schedule && input.schedule.length > 0
      ? {
          schedule: input.schedule.map((day) => ({
            day: day.day,
            enabled: day.enabled,
            start: day.start,
            end: day.end,
          })),
        }
      : {}),
  };
}

function toRoundRobinInput(input: CreateQueueInput, updating = false) {
  return {
    expectedRevision: input.expectedRevision,
    name: input.name,
    strategy: input.strategy,
    target_pipeline_id: input.target_pipeline_id || null,
    target_stage_id: input.target_stage_id || null,
    is_active: input.is_active,
    settings: buildFullSettings(input) as Record<string, unknown>,
    reentry_behavior: input.settings.reentry_behavior || 'redistribute',
    ...queueMutationCollections(input, updating),
  };
}

function useQueueMutationAccess(queryClient: QueryClient) {
  const accessByMutation = useRef(new WeakMap<MutationFunctionContext, () => boolean>());
  return {
    capture: (_variables: unknown, context: MutationFunctionContext) => {
      const isCurrentAccess = captureQueryClientAccess(queryClient);
      // TanStack shares this context only within one execution. Variables can
      // be reused by another mutation after the provider's SID visit changes.
      accessByMutation.current.set(context, isCurrentAccess);
      return isCurrentAccess;
    },
    requireCurrent: (context: MutationFunctionContext) => {
      if (!accessByMutation.current.get(context)?.()) {
        throw new Error('O contexto de acesso mudou. Reabra o formulário antes de salvar.');
      }
    },
  };
}

export function useCreateQueueAdvanced() {
  const queryClient = useQueryClient();
  const access = useQueueMutationAccess(queryClient);
  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId;
  const attempt = useRef<{ fingerprint: string; id: string } | null>(null);

  return useMutation({
    onMutate: access.capture,
    mutationFn: async (input: CreateQueueInput, context) => {
      access.requireCurrent(context);
      if (!organizationId) throw new Error('Organização não identificada');
      const payload = toRoundRobinInput(input);
      const fingerprint = JSON.stringify([organizationId, payload]);
      if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, id: createUUID() };
      return roundRobinsAPI.createRoundRobin({ ...payload, creationAttemptId: input.creationAttemptId || attempt.current.id }, organizationId);
    },
    onSuccess: (queue, _variables, isCurrentAccess) => {
      if (!isCurrentAccess?.()) return;
      attempt.current = null;
      queryClient.setQueryData(
        ['round-robin', organizationId, queue.id],
        queue,
      );
      queryClient.invalidateQueries({ queryKey: ['round-robins', organizationId] });
      queryClient.invalidateQueries({
        queryKey: ['round-robin', organizationId, queue.id],
      });
      queryClient.invalidateQueries({ queryKey: ['round-robin-rules', organizationId] });
      queryClient.invalidateQueries({ queryKey: ['round-robin-meta-forms', organizationId] });
      queryClient.invalidateQueries({
        queryKey: ['round-robin-history', organizationId, queue.id],
      });
      toast.success('Fila de distribuição criada!');
    },
    onError: (error, _variables, isCurrentAccess) => {
      if (!isCurrentAccess?.()) return;
      toast.error('Erro ao criar fila: ' + error.message);
    },
  });
}

export function useUpdateQueueAdvanced() {
  const queryClient = useQueryClient();
  const access = useQueueMutationAccess(queryClient);
  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId;

  return useMutation({
    onMutate: access.capture,
    mutationFn: async ({ id, ...input }: CreateQueueInput & { id: string }, context) => {
      access.requireCurrent(context);
      if (!organizationId) throw new Error('Organização não identificada');
      return roundRobinsAPI.updateRoundRobin(id, toRoundRobinInput(input, true), organizationId);
    },
    onSuccess: (queue, variables, isCurrentAccess) => {
      if (!isCurrentAccess?.()) return;
      queryClient.setQueryData(
        ['round-robin', organizationId, variables.id],
        queue,
      );
      queryClient.invalidateQueries({ queryKey: ['round-robins', organizationId] });
      queryClient.invalidateQueries({
        queryKey: ['round-robin', organizationId, variables.id],
      });
      queryClient.invalidateQueries({ queryKey: ['round-robin-rules', organizationId] });
      queryClient.invalidateQueries({ queryKey: ['round-robin-meta-forms', organizationId] });
      queryClient.invalidateQueries({
        queryKey: ['round-robin-history', organizationId, variables.id],
      });
      toast.success('Fila atualizada!');
    },
    onError: (error, _variables, isCurrentAccess) => {
      if (!isCurrentAccess?.()) return;
      toast.error('Erro ao atualizar fila: ' + error.message);
    },
  });
}
