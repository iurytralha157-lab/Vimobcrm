"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useToast } from "@/hooks/use-toast";
import { useWhatsAppQueryScope } from "@/hooks/use-whatsapp-query-scope";
import type { WhatsAppSessionList } from "@/hooks/use-whatsapp-sessions";
import {
  whatsappAPI,
  type WhatsAppAttendanceState,
} from "@/lib/api/whatsapp";
import {
  removeRevokedWhatsAppSession,
  whatsappQueryKeys,
  type WhatsAppQueryScope,
} from "@/lib/whatsapp-query-cache";
import { isWhatsAppAccessRevokedError } from "@/lib/whatsapp-access-error";

export type WhatsAppAttendanceTarget = {
  conversationId: string;
  expectedLeadId: string;
  sendSessionId: string;
};

type UseWhatsAppAttendanceOptions = {
  enabled?: boolean;
};

type AttendanceGateRequest = {
  target?: WhatsAppAttendanceTarget | null;
  prepareTarget?: () => Promise<WhatsAppAttendanceTarget>;
};

type PendingAttendanceRequest = AttendanceGateRequest & {
  identityKey: string;
  target: WhatsAppAttendanceTarget | null;
  resolve: (joined: boolean) => void;
};

type PendingAttendanceOperation = {
  identityKey: string;
  promise: Promise<boolean>;
};

const attendanceTargetKey = (target?: WhatsAppAttendanceTarget | null) => (
  target
    ? JSON.stringify([
        target.conversationId,
        target.expectedLeadId,
        target.sendSessionId,
      ])
    : null
);

const attendanceQueryOptions = (
  scope: WhatsAppQueryScope,
  target: WhatsAppAttendanceTarget,
) => ({
  queryKey: whatsappQueryKeys.attendance(
    scope,
    target.conversationId,
    target.expectedLeadId,
    target.sendSessionId,
  ),
  queryFn: async () => {
    if (!scope.organizationId || !scope.userId) {
      throw new Error("Usuário não autenticado.");
    }
    return whatsappAPI.getConversationAttendance(
      target.conversationId,
      {
        expectedLeadId: target.expectedLeadId,
        sendSessionId: target.sendSessionId,
      },
      scope.organizationId,
    );
  },
  staleTime: 15_000,
  gcTime: 10 * 60_000,
  retry: false,
});

export function useWhatsAppAttendance(
  target?: WhatsAppAttendanceTarget | null,
  options: UseWhatsAppAttendanceOptions = {},
) {
  const scope = useWhatsAppQueryScope();

  return useQuery({
    ...(target
      ? attendanceQueryOptions(scope, target)
      : {
          queryKey: whatsappQueryKeys.attendance(scope, null, null, null),
          queryFn: async (): Promise<WhatsAppAttendanceState | null> => null,
          staleTime: 15_000,
          gcTime: 10 * 60_000,
          retry: false,
        }),
    enabled: Boolean(
      target
      && scope.organizationId
      && scope.userId
      && (options.enabled ?? true)
    ),
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}

export function useJoinWhatsAppAttendance() {
  const queryClient = useQueryClient();
  const scope = useWhatsAppQueryScope();

  return useMutation({
    mutationFn: async (target: WhatsAppAttendanceTarget) => {
      if (!scope.organizationId || !scope.userId) {
        throw new Error("Usuário não autenticado.");
      }
      return whatsappAPI.joinConversationAttendance(
        target.conversationId,
        {
          expectedLeadId: target.expectedLeadId,
          sendSessionId: target.sendSessionId,
        },
        scope.organizationId,
      );
    },
    onSuccess: (attendance, target) => {
      queryClient.setQueryData(
        whatsappQueryKeys.attendance(
          scope,
          target.conversationId,
          target.expectedLeadId,
          target.sendSessionId,
        ),
        attendance,
      );
      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: whatsappQueryKeys.conversationsScope(scope),
        }),
        queryClient.invalidateQueries({
          queryKey: whatsappQueryKeys.messagesScope(scope),
        }),
        queryClient.invalidateQueries({
          queryKey: whatsappQueryKeys.paginatedMessagesScope(scope),
        }),
        queryClient.invalidateQueries({
          queryKey: whatsappQueryKeys.leadMessagesScope(scope),
        }),
        queryClient.invalidateQueries({
          queryKey: ['lead-history-v2', target.expectedLeadId],
        }),
      ]);
    },
  });
}

export function useWhatsAppAttendanceGate(
  target?: WhatsAppAttendanceTarget | null,
  options: UseWhatsAppAttendanceOptions & { identityKey?: string | null } = {},
) {
  const queryClient = useQueryClient();
  const scope = useWhatsAppQueryScope();
  const { toast } = useToast();
  const attendanceQuery = useWhatsAppAttendance(target, options);
  const joinAttendance = useJoinWhatsAppAttendance();
  const pendingRequestRef = useRef<PendingAttendanceRequest | null>(null);
  const pendingOperationRef = useRef<PendingAttendanceOperation | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [checkingIdentityKey, setCheckingIdentityKey] = useState<string | null>(null);
  const [accessRevokedTarget, setAccessRevokedTarget] = useState<{
    identityKey: string;
    sessionId: string;
  } | null>(null);
  const [lastJoinedState, setLastJoinedState] = useState<{
    targetKey: string;
    attendance: WhatsAppAttendanceState;
  } | null>(null);
  const targetKey = attendanceTargetKey(target);
  const requestIdentityKey = options.identityKey ?? targetKey ?? "none";
  const requestIdentityRef = useRef(requestIdentityKey);

  const settlePendingRequest = useCallback((joined: boolean) => {
    const pending = pendingRequestRef.current;
    if (!pending) return;
    pendingRequestRef.current = null;
    setDialogOpen(false);
    pending.resolve(joined);
  }, []);

  useLayoutEffect(() => {
    requestIdentityRef.current = requestIdentityKey;
    const pending = pendingRequestRef.current;
    if (pending && pending.identityKey !== requestIdentityKey) {
      settlePendingRequest(false);
    }
  }, [requestIdentityKey, settlePendingRequest]);

  useEffect(() => () => {
    const pending = pendingRequestRef.current;
    pendingRequestRef.current = null;
    pending?.resolve(false);
  }, []);

  const ensureJoined = useCallback((request: AttendanceGateRequest = {}) => {
    const operationIdentityKey = requestIdentityRef.current;
    const pendingOperation = pendingOperationRef.current;
    if (pendingOperation?.identityKey === operationIdentityKey) {
      return pendingOperation.promise;
    }

    const operation = (async () => {
      const requestedTarget = request.target === undefined ? target ?? null : request.target;

      if (requestedTarget) {
        setCheckingIdentityKey(operationIdentityKey);
        try {
          if (!scope.organizationId || !scope.userId) {
            throw new Error("Usuário não autenticado.");
          }
          // Every send performs a fresh authoritative read. A cached `joined`
          // must never survive a card rebind or attendance epoch change.
          const attendance = await whatsappAPI.getConversationAttendance(
            requestedTarget.conversationId,
            {
              expectedLeadId: requestedTarget.expectedLeadId,
              sendSessionId: requestedTarget.sendSessionId,
            },
            scope.organizationId,
          );
          queryClient.setQueryData(
            whatsappQueryKeys.attendance(
              scope,
              requestedTarget.conversationId,
              requestedTarget.expectedLeadId,
              requestedTarget.sendSessionId,
            ),
            attendance,
          );
          setAccessRevokedTarget(null);
          if (requestIdentityRef.current !== operationIdentityKey) return false;
          if (attendance.joined) return true;
        } catch (error) {
          if (isWhatsAppAccessRevokedError(error)) {
            setAccessRevokedTarget({
              identityKey: operationIdentityKey,
              sessionId: requestedTarget.sendSessionId,
            });
            queryClient.setQueryData<WhatsAppSessionList>(
              whatsappQueryKeys.sessions(scope),
              (sessions) => removeRevokedWhatsAppSession(sessions, requestedTarget.sendSessionId),
            );
            void queryClient.invalidateQueries({ queryKey: whatsappQueryKeys.sessionsScope(scope) });
            toast({
              title: "Acesso ao WhatsApp encerrado",
              description: "Você não tem mais acesso a este número. Inicie uma nova conversa pelo seu WhatsApp ou conecte um número.",
              variant: "destructive",
            });
            return false;
          }
          toast({
            title: "Não foi possível verificar o atendimento",
            description: "Atualize a conversa e tente novamente antes de enviar a mensagem.",
            variant: "destructive",
          });
          return false;
        } finally {
          setCheckingIdentityKey((current) => (
            current === operationIdentityKey ? null : current
          ));
        }
      } else if (!request.prepareTarget) {
        toast({
          title: "Conversa indisponível",
          description: "Não foi possível identificar o card e o WhatsApp deste atendimento.",
          variant: "destructive",
        });
        return false;
      }

      if (requestIdentityRef.current !== operationIdentityKey) return false;

      return new Promise<boolean>((resolve) => {
        pendingRequestRef.current = {
          identityKey: operationIdentityKey,
          target: requestedTarget,
          prepareTarget: request.prepareTarget,
          resolve,
        };
        setDialogOpen(true);
      });
    })();

    pendingOperationRef.current = {
      identityKey: operationIdentityKey,
      promise: operation,
    };
    void operation.finally(() => {
      if (pendingOperationRef.current?.promise === operation) {
        pendingOperationRef.current = null;
      }
    });
    return operation;
  }, [queryClient, scope, target, toast]);

  const confirmAttendance = useCallback(async () => {
    const pending = pendingRequestRef.current;
    if (!pending || joinAttendance.isPending) return;
    if (pending.identityKey !== requestIdentityRef.current) {
      settlePendingRequest(false);
      return;
    }

    let resolvedTarget: WhatsAppAttendanceTarget | null | undefined;
    try {
      resolvedTarget = pending.target ?? await pending.prepareTarget?.();
      if (!resolvedTarget) {
        throw new Error("Conversa indisponível para iniciar o atendimento.");
      }
      pending.target = resolvedTarget;
      pending.prepareTarget = undefined;
      if (pending.identityKey !== requestIdentityRef.current) {
        settlePendingRequest(false);
        return;
      }
      const attendance = await joinAttendance.mutateAsync(resolvedTarget);
      if (!attendance.joined) {
        throw new Error("A entrada no atendimento não foi confirmada.");
      }
      if (pending.identityKey !== requestIdentityRef.current) {
        settlePendingRequest(false);
        return;
      }
      setLastJoinedState({
        targetKey: attendanceTargetKey(resolvedTarget)!,
        attendance,
      });
      settlePendingRequest(true);
    } catch (error) {
      if (resolvedTarget && isWhatsAppAccessRevokedError(error)) {
        const revokedSessionId = resolvedTarget.sendSessionId;
        setAccessRevokedTarget({
          identityKey: pending.identityKey,
          sessionId: revokedSessionId,
        });
        queryClient.setQueryData<WhatsAppSessionList>(
          whatsappQueryKeys.sessions(scope),
          (sessions) => removeRevokedWhatsAppSession(sessions, revokedSessionId),
        );
        void queryClient.invalidateQueries({ queryKey: whatsappQueryKeys.sessionsScope(scope) });
        settlePendingRequest(false);
        toast({
          title: "Acesso ao WhatsApp encerrado",
          description: "Você não tem mais acesso a este número. Inicie uma nova conversa pelo seu WhatsApp ou conecte um número.",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Não foi possível entrar no atendimento",
        description: error instanceof Error && error.message.length < 180
          ? error.message
          : "Tente novamente antes de enviar a mensagem.",
        variant: "destructive",
      });
    }
  }, [joinAttendance, queryClient, scope, settlePendingRequest, toast]);

  const cancelAttendance = useCallback(() => {
    if (joinAttendance.isPending) return;
    settlePendingRequest(false);
  }, [joinAttendance.isPending, settlePendingRequest]);

  const attendance = useMemo(() => {
    if (attendanceQuery.data) return attendanceQuery.data;
    if (!lastJoinedState) return null;
    if (targetKey && lastJoinedState.targetKey === targetKey) {
      return lastJoinedState.attendance;
    }
    return null;
  }, [attendanceQuery.data, lastJoinedState, targetKey]);
  const isChecking = checkingIdentityKey === requestIdentityKey;

  return {
    attendance,
    entries: attendance?.entries ?? [],
    accessRevokedSessionId: accessRevokedTarget?.identityKey === requestIdentityKey
      ? accessRevokedTarget.sessionId
      : null,
    ensureJoined,
    isChecking,
    isJoining: joinAttendance.isPending,
    isResolving: isChecking || joinAttendance.isPending || dialogOpen,
    dialogProps: {
      open: dialogOpen,
      isJoining: joinAttendance.isPending,
      onConfirm: confirmAttendance,
      onCancel: cancelAttendance,
      onOpenChange: (open: boolean) => {
        if (!open) cancelAttendance();
      },
    },
  };
}
