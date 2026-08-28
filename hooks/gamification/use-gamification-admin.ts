'use client';

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { useAuth } from '@/contexts/AuthContext';
import { getFriendlyErrorMessage } from '@/lib/error-handler';
import { gamificationAPI, type GamificationActionType, type GamificationMissionInput } from '@/lib/api/gamification';

function getErrorMessage(error: unknown) {
  return getFriendlyErrorMessage(error);
}

function showMutationError(action: string, error: unknown) {
  toast.error(action, { description: getErrorMessage(error) });
}

export function useGamificationAdmin(enabled = true) {
  const { organization } = useAuth();
  const organizationId = organization?.id;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['gamification-admin', organizationId],
    queryFn: () => gamificationAPI.getAdminSnapshot(organizationId),
    enabled: enabled && !!organizationId,
    staleTime: 1000 * 60,
    refetchInterval: (currentQuery) => {
      const snapshot = currentQuery.state.data;
      const visibleEntries = [
        ...(snapshot?.myManualEntries ?? []),
        ...(snapshot?.pendingManualEntries ?? []),
      ];
      const hasPendingAward = visibleEntries.some((entry) =>
        entry.status === 'approved'
        && (!entry.awardStatus || entry.awardStatus === 'pending' || entry.awardStatus === 'processing'));
      if (hasPendingAward) return 5_000;

      const hasPendingDecision = visibleEntries.some((entry) => entry.status === 'pending');
      return hasPendingDecision ? 60_000 : false;
    },
    refetchIntervalInBackground: false,
  });

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['gamification-admin', organizationId] }),
      queryClient.invalidateQueries({ queryKey: ['gamification-overview', organizationId] }),
      queryClient.invalidateQueries({ queryKey: ['gamification-ranking', organizationId] }),
      queryClient.invalidateQueries({ queryKey: ['gamification-events', organizationId] }),
    ]);
  };

  const upsertRule = useMutation({
    mutationFn: (input: { actionType: GamificationActionType; points: number; isActive?: boolean }) =>
      gamificationAPI.upsertRule(input.actionType, { points: input.points, isActive: input.isActive }, organizationId),
    onSuccess: async () => {
      await invalidate();
      toast.success('Regra atualizada.');
    },
    onError: (error) => showMutationError('Não foi possível atualizar a regra.', error),
  });

  const setParticipant = useMutation({
    mutationFn: (input: { userId: string; participates: boolean }) =>
      gamificationAPI.setParticipant(input.userId, input.participates, organizationId),
    onSuccess: async () => {
      await invalidate();
      toast.success('Participação atualizada.');
    },
    onError: (error) => showMutationError('Não foi possível atualizar a participação.', error),
  });

  const createMission = useMutation({
    mutationFn: (input: GamificationMissionInput) => gamificationAPI.createMission(input, organizationId),
    onSuccess: async () => {
      await invalidate();
      toast.success('Missão criada.');
    },
    onError: (error) => showMutationError('Não foi possível criar a missão.', error),
  });

  const updateMission = useMutation({
    mutationFn: (input: { id: string; mission: GamificationMissionInput }) =>
      gamificationAPI.updateMission(input.id, input.mission, organizationId),
    onSuccess: async () => {
      await invalidate();
      toast.success('Missão atualizada.');
    },
    onError: (error) => showMutationError('Não foi possível atualizar a missão.', error),
  });

  const deleteMission = useMutation({
    mutationFn: (id: string) => gamificationAPI.deleteMission(id, organizationId),
    onSuccess: async () => {
      await invalidate();
      toast.success('Missão removida.');
    },
    onError: (error) => showMutationError('Não foi possível remover a missão.', error),
  });

  const createManualEntry = useMutation({
    mutationFn: (input: { actionKey: GamificationActionType; quantity: number; notes: string }) =>
      gamificationAPI.createManualEntry(input, organizationId),
    onSuccess: async () => {
      await invalidate();
      toast.success('Solicitação enviada para aprovação.');
    },
    onError: (error) => showMutationError('Não foi possível enviar a solicitação.', error),
  });

  const decideManualEntry = useMutation({
    mutationFn: (input: { id: string; status: 'approved' | 'rejected'; reason?: string }) =>
      gamificationAPI.decideManualEntry(input.id, { status: input.status, reason: input.reason }, organizationId),
    onSuccess: async () => {
      await invalidate();
      toast.success('Solicitação atualizada.');
    },
    onError: (error) => showMutationError('Não foi possível atualizar a solicitação.', error),
  });

  const resetSeason = useMutation({
    mutationFn: (input: { name: string; reason: string }) => gamificationAPI.resetSeason(input, organizationId),
    onSuccess: async () => {
      await invalidate();
      toast.success('Nova temporada iniciada.');
    },
    onError: (error) => showMutationError('Não foi possível iniciar a temporada.', error),
  });

  return useMemo(
    () => ({
      ...query,
      snapshot: query.data,
      upsertRule,
      setParticipant,
      createMission,
      updateMission,
      deleteMission,
      createManualEntry,
      decideManualEntry,
      resetSeason,
    }),
    [
      query,
      upsertRule,
      setParticipant,
      createMission,
      updateMission,
      deleteMission,
      createManualEntry,
      decideManualEntry,
      resetSeason,
    ],
  );
}
