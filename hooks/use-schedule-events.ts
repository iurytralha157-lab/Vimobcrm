import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { invalidateScheduleDashboardCaches } from "@/hooks/schedule/invalidate-schedule-dashboard";
import { getFriendlyErrorMessage } from "@/lib/error-handler";
import {
  scheduleAPI,
  type CreateScheduleEventInput,
  type EventType,
  type RescheduleScheduleEventInput,
  type ScheduleEvent,
  type ScheduleOutcome,
  type ScheduleEventVisibility,
  type ScheduleRecurrenceFrequency,
  type UpdateScheduleEventInput,
} from "@/lib/api/schedule";

export type {
  EventType,
  ScheduleEvent,
  ScheduleEventVisibility,
  ScheduleRecurrenceFrequency,
  ScheduleOutcome,
};

interface UseScheduleEventsOptions {
  enabled?: boolean;
  eventId?: string;
  userId?: string;
  leadId?: string;
  startDate?: Date;
  endDate?: Date;
}

function invalidateScheduleCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  leadId?: string | null,
) {
  queryClient.invalidateQueries({ queryKey: ["schedule-events"] });
  invalidateScheduleDashboardCaches(queryClient);
  if (leadId) {
    queryClient.invalidateQueries({ queryKey: ["activities", leadId] });
    queryClient.invalidateQueries({ queryKey: ["activities"] });
    queryClient.invalidateQueries({ queryKey: ["recent-activities"] });
    queryClient.invalidateQueries({ queryKey: ["lead-history-v2", leadId] });
    queryClient.invalidateQueries({ queryKey: ["lead-timeline", leadId] });
  }
}

export function useScheduleEvents(options: UseScheduleEventsOptions = {}) {
  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId;

  return useQuery({
    queryKey: ["schedule-events", organizationId, options],
    queryFn: () =>
      scheduleAPI.getScheduleEvents({
        organizationId,
        eventId: options.eventId,
        userId: options.userId,
        leadId: options.leadId,
        startDate: options.startDate,
        endDate: options.endDate,
      }),
    enabled: !!organizationId && options.enabled !== false,
    staleTime: 1000 * 60 * 5,
  });
}

export function useScheduleCapabilities(options: { enabled?: boolean } = {}) {
  const { activeOrganization, profile } = useAuth();
  const organizationId = activeOrganization.organizationId;

  return useQuery({
    queryKey: ["schedule-capabilities", organizationId, profile?.id],
    queryFn: () => scheduleAPI.getCapabilities(organizationId),
    enabled: !!organizationId && !!profile?.id && options.enabled !== false,
    staleTime: 1000 * 60 * 5,
  });
}

export function useCreateScheduleEvent() {
  const queryClient = useQueryClient();
  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId;

  return useMutation({
    mutationFn: async (event: CreateScheduleEventInput) => {
      if (!organizationId) throw new Error("Organização não encontrada");
      return scheduleAPI.createScheduleEvent(organizationId, event);
    },
    onSuccess: (data) => {
      invalidateScheduleCaches(queryClient, data?.lead_id);
      queryClient.invalidateQueries({ queryKey: ["google-calendar-status"] });
      toast.success("Atividade criada com sucesso!");
    },
    onError: (error: Error) => {
      console.error("Error creating schedule event:", error);
      toast.error(getFriendlyErrorMessage(error));
    },
  });
}

export function useUpdateScheduleEvent() {
  const queryClient = useQueryClient();
  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId;

  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: Partial<
      Omit<
        ScheduleEvent,
        | "id"
        | "user"
        | "lead"
        | "property"
        | "completed_by_user"
        | "assignee_user_ids"
        | "is_masked"
        | "visibility"
        | "user_id"
      >
    > & {
      id: string;
      visibility?: ScheduleEventVisibility;
      user_id?: string;
      assignee_ids?: string[];
    }) => {
      if (!organizationId) throw new Error("Organização não encontrada");
      return scheduleAPI.updateScheduleEvent(
        id,
        toScheduleUpdateBody(updates),
        organizationId,
      );
    },
    onSuccess: (data) => {
      invalidateScheduleCaches(queryClient, data?.lead_id);
      queryClient.invalidateQueries({
        queryKey: ["schedule_assignees", organizationId, data?.id],
      });
      queryClient.invalidateQueries({ queryKey: ["google-calendar-status"] });
      toast.success("Atividade atualizada!");
    },
    onError: (error: Error) => {
      console.error("Error updating schedule event:", error);
      toast.error(getFriendlyErrorMessage(error));
    },
  });
}

export function useCompleteScheduleEvent() {
  const queryClient = useQueryClient();
  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId;

  return useMutation({
    mutationFn: async ({
      id,
      status,
      outcome,
      outcomeNotes,
      performedBy,
    }: {
      id: string;
      status: string;
      outcome?: ScheduleOutcome | null;
      outcomeNotes?: string | null;
      performedBy?: string | null;
    }) => {
      if (!organizationId) throw new Error("Organização não encontrada");
      return scheduleAPI.completeScheduleEvent(
        id,
        {
          status,
          outcome,
          outcome_notes: outcomeNotes,
          performed_by: performedBy,
        },
        organizationId,
      );
    },
    onSuccess: (data) => {
      invalidateScheduleCaches(queryClient, data?.lead_id);
      queryClient.invalidateQueries({ queryKey: ["google-calendar-status"] });
      const message =
        data.status === "completed"
          ? "Resultado da atividade registrado!"
          : data.status === "no_show"
            ? "Não comparecimento registrado."
            : data.status === "cancelled" || data.status === "canceled"
              ? "Cancelamento registrado."
              : "Atividade reaberta";
      toast.success(message);
    },
    onError: (error: Error) => {
      console.error("Error completing schedule event:", error);
      toast.error(getFriendlyErrorMessage(error));
    },
  });
}

export function useRescheduleScheduleEvent() {
  const queryClient = useQueryClient();
  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId;

  return useMutation({
    mutationFn: async ({
      id,
      ...input
    }: RescheduleScheduleEventInput & { id: string }) => {
      if (!organizationId) throw new Error("Organização não encontrada");
      return scheduleAPI.rescheduleScheduleEvent(id, input, organizationId);
    },
    onSuccess: (data) => {
      const leadId = data.new_event?.lead_id || data.previous_event?.lead_id;
      invalidateScheduleCaches(queryClient, leadId);
      queryClient.invalidateQueries({ queryKey: ["google-calendar-status"] });
      toast.success("Compromisso remarcado e novo horário criado!");
    },
    onError: (error: Error) => {
      console.error("Error rescheduling schedule event:", error);
      toast.error(getFriendlyErrorMessage(error));
    },
  });
}

export function useDeleteScheduleEvent() {
  const queryClient = useQueryClient();
  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId;

  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      if (!organizationId) throw new Error("Organização não encontrada");
      return scheduleAPI.deleteScheduleEvent(id, organizationId);
    },
    onSuccess: (data) => {
      invalidateScheduleCaches(queryClient, data?.lead_id);
      queryClient.invalidateQueries({ queryKey: ["google-calendar-status"] });
      toast.success("Atividade removida!");
    },
    onError: (error: Error) => {
      console.error("Error deleting schedule event:", error);
      toast.error(getFriendlyErrorMessage(error));
    },
  });
}

function toScheduleUpdateBody(
  updates: Record<string, unknown>,
): UpdateScheduleEventInput {
  const allowedKeys = new Set([
    "title",
    "description",
    "event_type",
    "start_time",
    "end_time",
    "is_all_day",
    "user_id",
    "lead_id",
    "property_id",
    "team_id",
    "location",
    "status",
    "visibility",
    "reminder_minutes",
    "recurrence_rule",
    "assignee_ids",
  ]);

  return Object.fromEntries(
    Object.entries(updates).filter(
      ([key, value]) => allowedKeys.has(key) && value !== undefined,
    ),
  ) as UpdateScheduleEventInput;
}
