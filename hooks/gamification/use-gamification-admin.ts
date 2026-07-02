'use client';

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { useAuth } from '@/contexts/AuthContext';
import { gamificationAPI, type GamificationMissionInput } from '@/lib/api/gamification';

export function useGamificationAdmin(enabled = true) {
  const { organization } = useAuth();
  const organizationId = organization?.id;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['gamification-admin', organizationId],
    queryFn: () => gamificationAPI.getAdminSnapshot(organizationId),
    enabled: enabled && !!organizationId,
    staleTime: 1000 * 60,
  });

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['gamification-admin', organizationId] }),
      queryClient.invalidateQueries({ queryKey: ['gamification-overview', organizationId] }),
    ]);
  };

  const upsertRule = useMutation({
    mutationFn: (input: { actionType: string; points: number; isActive?: boolean }) =>
      gamificationAPI.upsertRule(input.actionType, { points: input.points, isActive: input.isActive }, organizationId),
    onSuccess: async () => {
      await invalidate();
      toast.success('Regra atualizada.');
    },
  });

  const setParticipant = useMutation({
    mutationFn: (input: { userId: string; participates: boolean }) =>
      gamificationAPI.setParticipant(input.userId, input.participates, organizationId),
    onSuccess: async () => {
      await invalidate();
      toast.success('Participacao atualizada.');
    },
  });

  const createMission = useMutation({
    mutationFn: (input: GamificationMissionInput) => gamificationAPI.createMission(input, organizationId),
    onSuccess: async () => {
      await invalidate();
      toast.success('Missao criada.');
    },
  });

  const updateMission = useMutation({
    mutationFn: (input: { id: string; mission: GamificationMissionInput }) =>
      gamificationAPI.updateMission(input.id, input.mission, organizationId),
    onSuccess: async () => {
      await invalidate();
      toast.success('Missao atualizada.');
    },
  });

  const deleteMission = useMutation({
    mutationFn: (id: string) => gamificationAPI.deleteMission(id, organizationId),
    onSuccess: async () => {
      await invalidate();
      toast.success('Missao removida.');
    },
  });

  const createManualEntry = useMutation({
    mutationFn: (input: { actionKey: string; quantity: number; notes: string }) =>
      gamificationAPI.createManualEntry(input, organizationId),
    onSuccess: async () => {
      await invalidate();
      toast.success('Solicitacao enviada para aprovacao.');
    },
  });

  const decideManualEntry = useMutation({
    mutationFn: (input: { id: string; status: 'approved' | 'rejected'; reason?: string }) =>
      gamificationAPI.decideManualEntry(input.id, { status: input.status, reason: input.reason }, organizationId),
    onSuccess: async () => {
      await invalidate();
      toast.success('Solicitacao atualizada.');
    },
  });

  const resetSeason = useMutation({
    mutationFn: (input: { name: string; reason: string }) => gamificationAPI.resetSeason(input, organizationId),
    onSuccess: async () => {
      await invalidate();
      toast.success('Nova temporada iniciada.');
    },
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
