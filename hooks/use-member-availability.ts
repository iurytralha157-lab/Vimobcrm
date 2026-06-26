import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { teamsAPI, type AvailabilityInput, type MemberAvailability } from '@/lib/api/teams';
import { toast } from 'sonner';

export type { AvailabilityInput, MemberAvailability };

const DAYS_OF_WEEK = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const DAYS_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export function getDayName(dayOfWeek: number, short = false): string {
  return short ? DAYS_SHORT[dayOfWeek] : DAYS_OF_WEEK[dayOfWeek];
}

export function useMemberAvailability(teamMemberId?: string) {
  return useQuery({
    queryKey: ['member-availability', teamMemberId],
    queryFn: async () => {
      if (!teamMemberId) return [];

      return teamsAPI.listMemberAvailability({ teamMemberId });
    },
    enabled: !!teamMemberId,
  });
}

export function useTeamMembersAvailability(teamMemberIds: string[]) {
  return useQuery({
    queryKey: ['team-members-availability', teamMemberIds],
    queryFn: async () => {
      if (!teamMemberIds.length) return [];

      return teamsAPI.listMemberAvailability({ teamMemberIds });
    },
    enabled: teamMemberIds.length > 0,
  });
}

export function useUpdateMemberAvailability() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: AvailabilityInput) => {
      return teamsAPI.updateMemberAvailability(input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['member-availability'] });
      queryClient.invalidateQueries({ queryKey: ['team-members-availability'] });
    },
    onError: (error) => {
      console.error('Error updating availability:', error);
      toast.error('Erro ao atualizar disponibilidade');
    },
  });
}

export function useBulkUpdateMemberAvailability() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ teamMemberId, availability }: {
      teamMemberId: string;
      availability: Array<{
        day_of_week: number;
        start_time?: string | null;
        end_time?: string | null;
        is_all_day?: boolean;
        is_active?: boolean;
      }>;
    }) => {
      return teamsAPI.replaceMemberAvailability({
        teamMemberId,
        availability: availability.map(a => ({
          day_of_week: a.day_of_week,
          start_time: a.is_all_day ? null : a.start_time,
          end_time: a.is_all_day ? null : a.end_time,
          is_all_day: a.is_all_day ?? false,
          is_active: a.is_active ?? false,
        })),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['member-availability'] });
      queryClient.invalidateQueries({ queryKey: ['team-members-availability'] });
      toast.success('Disponibilidade salva com sucesso');
    },
    onError: (error) => {
      console.error('Error saving availability:', error);
      toast.error('Erro ao salvar disponibilidade');
    },
  });
}

export function formatAvailabilitySummary(availability: MemberAvailability[]): string {
  if (!availability.length) return 'Não configurado';

  const activeDays = availability.filter(a => a.is_active);
  if (!activeDays.length) return 'Indisponível';

  const allAllDay = activeDays.every(a => a.is_all_day);
  const allSameTime = activeDays.every(
    a => a.start_time === activeDays[0]?.start_time && a.end_time === activeDays[0]?.end_time
  );

  // Check for consecutive days
  const dayNumbers = activeDays.map(a => a.day_of_week).sort((a, b) => a - b);
  const isWeekdays = dayNumbers.length === 5 &&
    dayNumbers.every((d, i) => d === i + 1); // Mon-Fri
  const isEveryDay = dayNumbers.length === 7;

  if (allAllDay) {
    if (isEveryDay) return '24h todos os dias';
    if (isWeekdays) return '24h (Seg-Sex)';
    return `24h (${activeDays.map(a => getDayName(a.day_of_week, true)).join(', ')})`;
  }

  if (allSameTime && activeDays[0]) {
    const timeRange = `${activeDays[0].start_time?.slice(0, 5)} - ${activeDays[0].end_time?.slice(0, 5)}`;
    if (isEveryDay) return `Todos os dias ${timeRange}`;
    if (isWeekdays) return `Seg-Sex ${timeRange}`;
    return `${activeDays.map(a => getDayName(a.day_of_week, true)).join(', ')} ${timeRange}`;
  }

  return `${activeDays.length} dias configurados`;
}
