import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { roundRobinsAPI } from '@/lib/api/round-robins';

interface ScheduleDay {
  day: number;
  enabled: boolean;
  start: string;
  end: string;
}

interface RuleCondition {
  id: string;
  type: 'source' | 'webhook' | 'whatsapp_session' | 'meta_form' | 'website_category' | 'campaign_contains' | 'tag' | 'city' | 'interest_property';
  values: string[];
}

interface QueueMember {
  id?: string;
  type: 'user' | 'team';
  entityId: string;
  weight: number;
  name?: string;
}

interface QueueSettings {
  enable_redistribution?: boolean;
  redistribution_timeout_minutes?: number;
  redistribution_warning_minutes?: number;
  redistribution_max_attempts?: number;
  preserve_position?: boolean;
  require_checkin?: boolean;
  reentry_behavior?: 'redistribute' | 'keep_assignee';
}

type QueueSettingsWithSchedule = QueueSettings & {
  schedule?: ScheduleDay[];
};

interface CreateQueueInput {
  name: string;
  strategy: 'simple' | 'weighted';
  target_pipeline_id: string;
  target_stage_id: string;
  is_active: boolean;
  settings: QueueSettings;
  schedule?: ScheduleDay[];
  conditions: RuleCondition[];
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

function toRoundRobinInput(input: CreateQueueInput) {
  return {
    name: input.name,
    strategy: input.strategy,
    target_pipeline_id: input.target_pipeline_id || null,
    target_stage_id: input.target_stage_id || null,
    is_active: input.is_active,
    settings: buildFullSettings(input) as Record<string, unknown>,
    reentry_behavior: input.settings.reentry_behavior || 'redistribute',
    conditions: input.conditions,
    members: input.members,
  };
}

export function useCreateQueueAdvanced() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateQueueInput) => {
      return roundRobinsAPI.createRoundRobin(toRoundRobinInput(input));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['round-robins'] });
      queryClient.invalidateQueries({ queryKey: ['round-robin-rules'] });
      toast.success('Fila de distribuicao criada!');
    },
    onError: (error) => {
      toast.error('Erro ao criar fila: ' + error.message);
    },
  });
}

export function useUpdateQueueAdvanced() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...input }: CreateQueueInput & { id: string }) => {
      return roundRobinsAPI.updateRoundRobin(id, toRoundRobinInput(input));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['round-robins'] });
      queryClient.invalidateQueries({ queryKey: ['round-robin-rules'] });
      toast.success('Fila atualizada!');
    },
    onError: (error) => {
      toast.error('Erro ao atualizar fila: ' + error.message);
    },
  });
}
