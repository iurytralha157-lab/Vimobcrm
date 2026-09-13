"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useActiveOrganizationId } from "@/hooks/use-active-organization";
import {
  integrationsAPI,
  isChavesNaMaoHomologationRequired,
  type ChavesNaMaoIntegrationInput,
  type ChavesNaMaoPublicationInput,
} from "@/lib/api";
import { shouldRetryIntegrationQuery } from "@/lib/api/integration-query";
import { getErrorObjectMessage } from "@/lib/api/vimob-error";

const integrationQueryKey = (organizationId?: string | null) => [
  "chaves-na-mao-integration",
  organizationId,
];
const publicationsQueryKey = (organizationId?: string | null) => [
  "chaves-na-mao-publications",
  organizationId,
];

function shouldRetryChavesNaMaoQuery(failureCount: number, error: unknown) {
  if (isChavesNaMaoHomologationRequired(error)) return false;
  return shouldRetryIntegrationQuery(failureCount, error);
}

function requireHomologationOpen(homologationOpen: boolean) {
  if (!homologationOpen) {
    throw new Error(
      "A ativação permanece bloqueada até a homologação oficial do Chaves na Mão.",
    );
  }
}

function mutationErrorMessage(error: unknown) {
  if (isChavesNaMaoHomologationRequired(error)) {
    return "A homologação oficial ainda não foi liberada para esta organização.";
  }
  return getErrorObjectMessage(error, "Não foi possível concluir esta ação.");
}

function handleMutationError(
  error: unknown,
  refreshHomologationState: () => void,
) {
  if (isChavesNaMaoHomologationRequired(error)) {
    refreshHomologationState();
  }
  toast.error(mutationErrorMessage(error));
}

export function useChavesNaMaoIntegration(
  options: { enabled?: boolean } = {},
) {
  const organizationId = useActiveOrganizationId();
  return useQuery({
    queryKey: integrationQueryKey(organizationId),
    queryFn: () => integrationsAPI.getChavesNaMao(organizationId),
    enabled: !!organizationId && (options.enabled ?? true),
    refetchOnMount: "always",
    retry: shouldRetryChavesNaMaoQuery,
  });
}

export function useChavesNaMaoPublications(
  options: { enabled?: boolean } = {},
) {
  const organizationId = useActiveOrganizationId();
  return useQuery({
    queryKey: publicationsQueryKey(organizationId),
    queryFn: () => integrationsAPI.listChavesNaMaoPublications(organizationId),
    enabled: !!organizationId && (options.enabled ?? true),
    retry: shouldRetryChavesNaMaoQuery,
  });
}

export function useSaveChavesNaMaoIntegration(homologationOpen: boolean) {
  const organizationId = useActiveOrganizationId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ChavesNaMaoIntegrationInput) => {
      requireHomologationOpen(homologationOpen);
      return integrationsAPI.saveChavesNaMao(input, organizationId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: integrationQueryKey(organizationId) });
      toast.success("Configuração do feed salva.");
    },
    onError: (error) =>
      handleMutationError(error, () => {
        void queryClient.invalidateQueries({
          queryKey: integrationQueryKey(organizationId),
        });
      }),
  });
}

export function useActivateChavesNaMaoIntegration(homologationOpen: boolean) {
  const organizationId = useActiveOrganizationId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => {
      requireHomologationOpen(homologationOpen);
      return integrationsAPI.activateChavesNaMao(organizationId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: integrationQueryKey(organizationId) });
      toast.success("Feed Chaves na Mão ativado para homologação.");
    },
    onError: (error) =>
      handleMutationError(error, () => {
        void queryClient.invalidateQueries({
          queryKey: integrationQueryKey(organizationId),
        });
      }),
  });
}

export function usePauseChavesNaMaoIntegration(homologationOpen: boolean) {
  const organizationId = useActiveOrganizationId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => {
      requireHomologationOpen(homologationOpen);
      return integrationsAPI.pauseChavesNaMao(organizationId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: integrationQueryKey(organizationId) });
      toast.success("Feed Chaves na Mão pausado para drenagem.");
    },
    onError: (error) =>
      handleMutationError(error, () => {
        void queryClient.invalidateQueries({
          queryKey: integrationQueryKey(organizationId),
        });
      }),
  });
}

export function useRegenerateChavesNaMaoFeedToken(homologationOpen: boolean) {
  const organizationId = useActiveOrganizationId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => {
      requireHomologationOpen(homologationOpen);
      return integrationsAPI.regenerateChavesNaMaoFeedToken(organizationId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: integrationQueryKey(organizationId) });
      toast.success("URL privada do feed renovada.");
    },
    onError: (error) =>
      handleMutationError(error, () => {
        void queryClient.invalidateQueries({
          queryKey: integrationQueryKey(organizationId),
        });
      }),
  });
}

export function useSaveChavesNaMaoPublications(homologationOpen: boolean) {
  const organizationId = useActiveOrganizationId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (publications: ChavesNaMaoPublicationInput[]) => {
      requireHomologationOpen(homologationOpen);
      return integrationsAPI.saveChavesNaMaoPublications(
        { publications },
        organizationId,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: publicationsQueryKey(organizationId) });
      toast.success("Seleção de imóveis atualizada.");
    },
    onError: (error) =>
      handleMutationError(error, () => {
        void queryClient.invalidateQueries({
          queryKey: integrationQueryKey(organizationId),
        });
      }),
  });
}
