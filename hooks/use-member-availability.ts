import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useActiveOrganizationId } from "@/hooks/use-active-organization";
import { VimobAPIError } from "@/lib/api/vimob-error";
import { useEffect, useRef } from "react";
import { availabilityClockForEditor } from "@/lib/teams/availability-clock";
import {
  teamsAPI,
  type AvailabilityInput,
  type MemberAvailability,
} from "@/lib/api/teams";

export type { AvailabilityInput, MemberAvailability };

const DAYS_OF_WEEK = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
];
const DAYS_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export function getDayName(dayOfWeek: number, short = false): string {
  return short ? DAYS_SHORT[dayOfWeek] : DAYS_OF_WEEK[dayOfWeek];
}

export function useMemberAvailability(teamMemberId?: string) {
  const organizationId = useActiveOrganizationId();

  return useQuery({
    queryKey: ["member-availability", organizationId, teamMemberId],
    queryFn: ({ signal }) => teamsAPI.getMemberAvailabilitySnapshot(teamMemberId as string, organizationId, signal),
    enabled: Boolean(organizationId && teamMemberId),
    staleTime: 0,
    refetchOnMount: "always",
  });
}

export function useTeamMembersAvailability(teamMemberIds: string[]) {
  const organizationId = useActiveOrganizationId();
  const stableMemberIds = [...new Set(teamMemberIds)].sort();

  return useQuery({
    queryKey: ["team-members-availability", organizationId, stableMemberIds],
    queryFn: async () => {
      if (!stableMemberIds.length) return [];

      return teamsAPI.listMemberAvailability({
        teamMemberIds: stableMemberIds,
        organizationId,
      });
    },
    enabled: Boolean(organizationId && stableMemberIds.length > 0),
  });
}

export function useUpdateMemberAvailability() {
  const organizationId = useActiveOrganizationId();
  const queryClient = useQueryClient();
  const currentScope = useRef(organizationId);
  useEffect(() => { currentScope.current = organizationId; return () => { currentScope.current = null; }; }, [organizationId]);

  return useMutation({
    mutationFn: async ({ organizationId: requestedOrganizationId, ...input }: AvailabilityInput & { organizationId: string }) => {
      return teamsAPI.updateMemberAvailability(input, requestedOrganizationId);
    },
    onSuccess: (_, variables) => {
      const organizationId = variables.organizationId;
      queryClient.invalidateQueries({
        queryKey: ["member-availability", organizationId],
      });
      queryClient.invalidateQueries({
        queryKey: ["team-members-availability", organizationId],
      });
      queryClient.invalidateQueries({ queryKey: ["teams", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["team", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["team-history", organizationId] });
    },
    onError: (error, variables) => {
      if (currentScope.current !== variables.organizationId) return;
      console.error("Error updating availability:", error);
      toast.error("Erro ao atualizar disponibilidade");
    },
  });
}

export function useBulkUpdateMemberAvailability() {
  const organizationId = useActiveOrganizationId();
  const queryClient = useQueryClient();
  const currentScope = useRef(organizationId);
  useEffect(() => { currentScope.current = organizationId; return () => { currentScope.current = null; }; }, [organizationId]);

  return useMutation({
    mutationFn: async ({
      teamMemberId,
      expectedRevision,
      organizationId: requestedOrganizationId,
      availability,
    }: {
      teamMemberId: string;
      expectedRevision: number;
      organizationId: string;
      availability: Array<{
        day_of_week: number;
        start_time?: string | null;
        end_time?: string | null;
        is_all_day?: boolean;
        is_active?: boolean;
      }>;
    }) => {
      return teamsAPI.replaceMemberAvailability(
        {
          teamMemberId,
          expected_revision: expectedRevision,
          availability: availability.map((entry) => ({
            day_of_week: entry.day_of_week,
            start_time: entry.is_all_day ? null : entry.start_time,
            end_time: entry.is_all_day ? null : entry.end_time,
            is_all_day: entry.is_all_day ?? false,
            is_active: entry.is_active ?? false,
          })),
        },
        requestedOrganizationId,
      );
    },
    onSuccess: (snapshot, variables) => {
      const organizationId = variables.organizationId;
      if (currentScope.current === organizationId) queryClient.setQueryData(["member-availability", organizationId, variables.teamMemberId], snapshot);
      queryClient.invalidateQueries({
        queryKey: ["member-availability", organizationId],
      });
      queryClient.invalidateQueries({
        queryKey: ["team-members-availability", organizationId],
      });
      queryClient.invalidateQueries({ queryKey: ["teams", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["team", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["team-history", organizationId] });
      if (currentScope.current === organizationId) toast.success("Disponibilidade salva com sucesso");
    },
    onError: (error, variables) => {
      if (currentScope.current !== variables.organizationId) return;
      if (error instanceof VimobAPIError && error.code === "team_revision_conflict") return;
      console.error("Error saving availability:", error);
      toast.error("Erro ao salvar disponibilidade");
    },
  });
}

export function formatAvailabilitySummary(
  availability: MemberAvailability[],
): string {
  if (!availability.length) return "Escala não configurada";

  const activeDays = availability.filter((entry) => entry.is_active);
  if (!activeDays.length) return "Indisponível";

  const allAllDay = activeDays.every((entry) => entry.is_all_day);
  const allSameTime = activeDays.every(
    (entry) =>
      entry.start_time === activeDays[0]?.start_time &&
      entry.end_time === activeDays[0]?.end_time,
  );

  const dayNumbers = activeDays
    .map((entry) => entry.day_of_week)
    .sort((left, right) => left - right);
  const isWeekdays =
    dayNumbers.length === 5 &&
    dayNumbers.every((day, index) => day === index + 1);
  const isEveryDay = dayNumbers.length === 7;

  if (allAllDay) {
    if (isEveryDay) return "24h todos os dias";
    if (isWeekdays) return "24h (Seg-Sex)";
    return `24h (${activeDays
      .map((entry) => getDayName(entry.day_of_week, true))
      .join(", ")})`;
  }

  if (allSameTime && activeDays[0]) {
    const start = availabilityClockForEditor(activeDays[0].start_time);
    const end = availabilityClockForEditor(activeDays[0].end_time);
    if (!start || !end) return "Escala precisa de revisão";
    const timeRange = `${start} - ${end}`;
    if (isEveryDay) return `Todos os dias ${timeRange}`;
    if (isWeekdays) return `Seg-Sex ${timeRange}`;
    return `${activeDays
      .map((entry) => getDayName(entry.day_of_week, true))
      .join(", ")} ${timeRange}`;
  }

  return `${activeDays.length} dias configurados`;
}
