"use client";

import { Loader2, RefreshCw, Smartphone } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useVerifyWhatsAppSessionStatus,
  useWhatsAppSessionStatuses,
} from "@/hooks/integrations/whatsapp";
import { toast } from "@/hooks/use-toast";
import type { WhatsAppSessionStatusSummary } from "@/lib/api/whatsapp";
import { formatWhatsAppContactPhoneForDisplay } from "@/lib/phone-utils";

import {
  getWhatsAppStatusPresentation,
  type WhatsAppStatusTone,
} from "./session-status-presentation";

const statusToneClassName: Record<WhatsAppStatusTone, string> = {
  connected:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300",
  waiting:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-300",
  disconnected:
    "border-red-200 bg-red-50 text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300",
  unknown:
    "border-[var(--app-border)] bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]",
};

function SessionStatusCard({
  session,
  verifyingSessionId,
  onVerify,
}: {
  session: WhatsAppSessionStatusSummary;
  verifyingSessionId: string | null;
  onVerify: (session: WhatsAppSessionStatusSummary) => void;
}) {
  const status = getWhatsAppStatusPresentation(session.status);
  const phone = formatWhatsAppContactPhoneForDisplay(session.phone_number);
  const ownerInitial = session.owner.name.trim().slice(0, 1).toUpperCase() || "U";
  const verifying = verifyingSessionId === session.id;

  return (
    <Card className="border">
      <CardContent className="space-y-2.5 p-3">
        <div className="flex items-center gap-2.5">
          <Avatar className="h-9 w-9 shrink-0">
            {session.owner.avatar_url ? (
              <AvatarImage src={session.owner.avatar_url} alt={session.owner.name} />
            ) : null}
            <AvatarFallback className="text-xs">{ownerInitial}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium leading-tight text-[var(--app-text-primary)]">
              {session.owner.name}
            </p>
            <p className="truncate text-xs leading-tight text-[var(--app-text-secondary)]">
              {session.display_name}
            </p>
          </div>
          <Badge
            variant="outline"
            className={`shrink-0 rounded-[6px] text-[10px] font-medium ${statusToneClassName[status.tone]}`}
          >
            {status.label}
          </Badge>
        </div>

        <div className="flex items-center justify-between gap-2 border-y border-[var(--app-border)] py-1.5">
          <span className="truncate text-xs text-[var(--app-text-tertiary)]">
            {phone || session.profile_name || "Número não identificado"}
          </span>
        </div>

        {session.capabilities.can_manage ? (
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 rounded-[6px] px-3 text-xs"
              disabled={verifying}
              onClick={() => onVerify(session)}
            >
              {verifying ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              Verificar
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function WhatsAppSessionStatusPanel() {
  const statuses = useWhatsAppSessionStatuses({ live: true });
  const verifyStatus = useVerifyWhatsAppSessionStatus();
  const response = statuses.data;
  const sessions = response?.data ?? [];

  const handleVerify = async (session: WhatsAppSessionStatusSummary) => {
    try {
      const providerStatus = await verifyStatus.mutateAsync(session.id);
      const presentation = getWhatsAppStatusPresentation(
        providerStatus.state || providerStatus.status,
      );
      toast({
        title: presentation.label,
        description: `A conexão "${session.display_name}" foi consultada diretamente no provedor.`,
      });
      await statuses.refetch();
    } catch (error) {
      toast({
        title: "Não foi possível verificar",
        description:
          error instanceof Error
            ? error.message
            : "O estado anterior foi preservado. Tente novamente em instantes.",
        variant: "destructive",
      });
    }
  };

  return (
    <Card className="border-0 bg-[var(--app-surface-solid)] shadow-none">
      <CardContent className="space-y-3 p-4">
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 rounded-[6px]"
            disabled={statuses.isFetching}
            onClick={() => void statuses.refetch()}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${statuses.isFetching ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            Atualizar status
          </Button>
        </div>

        {statuses.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Carregando estados do WhatsApp">
            <Skeleton className="h-24 w-full rounded-[8px]" />
            <Skeleton className="h-24 w-full rounded-[8px]" />
            <Skeleton className="h-24 w-full rounded-[8px]" />
          </div>
        ) : statuses.isError ? (
          <div className="rounded-[8px] border border-red-200 bg-red-50 p-4 dark:border-red-900/70 dark:bg-red-950/40">
            <p className="text-sm font-medium text-red-700 dark:text-red-300">
              Não foi possível carregar os estados das conexões.
            </p>
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">
              Tente atualizar novamente.
            </p>
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-[8px] bg-[var(--app-surface-soft)] p-6 text-center">
            <Smartphone className="h-6 w-6 text-[var(--app-text-tertiary)]" aria-hidden="true" />
            <p className="text-xs text-[var(--app-text-secondary)]">Nenhuma conexão encontrada</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sessions.map((session) => (
              <SessionStatusCard
                key={session.id}
                session={session}
                verifyingSessionId={
                  verifyStatus.isPending ? verifyStatus.variables ?? null : null
                }
                onVerify={(item) => void handleVerify(item)}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
