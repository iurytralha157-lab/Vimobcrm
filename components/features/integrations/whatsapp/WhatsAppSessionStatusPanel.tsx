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
import type { WhatsAppSession, WhatsAppSessionStatusSummary } from "@/lib/api/whatsapp";
import { formatWhatsAppContactPhoneForDisplay } from "@/lib/phone-utils";
import { WhatsAppActionTooltip } from "@/components/features/integrations/whatsapp/WhatsAppActionTooltip";

import {
  getWhatsAppStatusBadgeClassName,
  getWhatsAppStatusPresentation,
  WHATSAPP_SESSION_ACTION_CLASS_NAME,
  WHATSAPP_SESSION_STATUS_SIZE_CLASS_NAME,
} from "@/components/features/integrations/whatsapp/session-status-presentation";
import {
  getUnifiedWhatsAppStatusRows,
  WHATSAPP_SESSION_LIST_COLUMNS_CLASS_NAME,
  WHATSAPP_SESSION_LIST_ROW_CLASS_NAME,
  WHATSAPP_SESSION_LIST_ROW_STYLE,
} from "@/components/features/integrations/whatsapp/session-list-presentation";

function SessionStatusRow({
  session,
  verifyingSessionId,
  onVerify,
  onRefresh,
  refreshing,
  embedded,
  allowProviderVerification,
}: {
  session: WhatsAppSessionStatusSummary;
  verifyingSessionId: string | null;
  onVerify: (session: WhatsAppSessionStatusSummary) => void;
  onRefresh: () => void;
  refreshing: boolean;
  embedded: boolean;
  allowProviderVerification: boolean;
}) {
  const status = getWhatsAppStatusPresentation(session.status);
  const phone = formatWhatsAppContactPhoneForDisplay(session.phone_number);
  const phoneLabel = phone || session.profile_name || "Número não identificado";
  const ownerInitial = session.owner.name.trim().slice(0, 1).toUpperCase() || "U";
  const verifying = verifyingSessionId === session.id;
  const canVerify = allowProviderVerification && session.capabilities.can_manage;
  const refreshingRow = canVerify ? verifying : refreshing;
  const RowRoot = embedded ? "div" : "li";

  return (
    <RowRoot
      role={embedded ? "listitem" : undefined}
      data-whatsapp-status-panel={embedded || undefined}
      data-whatsapp-session-id={session.id}
      data-whatsapp-row-kind="status"
      data-whatsapp-owner-id={session.owner.id}
      className={WHATSAPP_SESSION_LIST_ROW_CLASS_NAME}
      style={WHATSAPP_SESSION_LIST_ROW_STYLE}
    >
      <div data-whatsapp-column="identity" className="col-start-1 row-start-1 flex min-w-0 items-center gap-2.5">
        <Avatar className="h-9 w-9 shrink-0 rounded-[6px]">
          {session.owner.avatar_url ? (
            <AvatarImage src={session.owner.avatar_url} alt={session.owner.name} className="rounded-[6px]" />
          ) : null}
          <AvatarFallback className="rounded-[6px] bg-primary/50 text-[12px] font-light text-white">{ownerInitial}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p
            title={session.owner.name}
            className="min-w-0 truncate text-[13px] font-light text-[var(--app-text-primary)]"
          >
            {session.owner.name}
          </p>
        </div>
      </div>
      <span
        data-whatsapp-column="connection"
        title={session.display_name}
        className="col-start-1 row-start-2 min-w-0 truncate text-[12px] font-light text-[var(--app-text-secondary)] @min-[840px]:col-start-2 @min-[840px]:row-start-1"
      >
        <span className="sr-only">Conexão: </span>
        {session.display_name}
      </span>
      <span
        data-whatsapp-column="phone"
        title={phoneLabel}
        className="col-start-1 row-start-3 min-w-0 truncate text-[12px] font-light text-[var(--app-text-secondary)] @min-[840px]:col-start-3 @min-[840px]:row-start-1"
      >
        <span className="sr-only">Número: </span>
        {phoneLabel}
      </span>
      <div data-whatsapp-column="status" className="col-start-2 row-start-1 flex min-w-0 justify-end @min-[840px]:col-start-4">
        <Badge
          variant="outline"
          title={status.label}
          className={`${WHATSAPP_SESSION_STATUS_SIZE_CLASS_NAME} ${getWhatsAppStatusBadgeClassName(session.status)}`}
        >
          <span className="min-w-0 truncate">{status.label}</span>
        </Badge>
      </div>
      <div data-whatsapp-column="actions" className="col-start-2 row-start-3 flex justify-end @min-[840px]:col-start-5 @min-[840px]:row-start-1">
        <WhatsAppActionTooltip label={`Atualizar status de ${session.display_name}`}>
        <Button
          type="button"
          size="sm"
          aria-label={`Atualizar status de ${session.display_name}`}
          data-whatsapp-refresh-kind={canVerify ? "provider" : "scoped-read"}
          className={`h-8 w-8 shrink-0 rounded-[6px] p-0 ${WHATSAPP_SESSION_ACTION_CLASS_NAME}`}
          disabled={refreshingRow}
          onClick={() => {
            if (canVerify) onVerify(session);
            else onRefresh();
          }}
        >
          {refreshingRow ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </Button>
        </WhatsAppActionTooltip>
      </div>
    </RowRoot>
  );
}

export function WhatsAppSessionStatusPanel({
  excludedSessionIds = [],
  embedded = false,
  additionalSessions = [],
  viewerUserId,
  allowProviderVerification = true,
}: {
  excludedSessionIds?: readonly string[];
  embedded?: boolean;
  additionalSessions?: readonly WhatsAppSession[];
  viewerUserId?: string;
  allowProviderVerification?: boolean;
}) {
  const statuses = useWhatsAppSessionStatuses({ enabled: !embedded, live: true });
  const verifyStatus = useVerifyWhatsAppSessionStatus();
  const response = statuses.data;
  const excludedIds = new Set(excludedSessionIds);
  const allSessions = getUnifiedWhatsAppStatusRows(
    response?.data ?? [],
    additionalSessions,
    viewerUserId,
  );
  const sessions = allSessions.filter(
    (session) => !excludedIds.has(session.id),
  );

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

  if (
    statuses.isSuccess &&
    sessions.length === 0 &&
    excludedIds.size > 0 &&
    allSessions.length > 0
  ) {
    return null;
  }

  if (
    embedded &&
    sessions.length === 0 &&
    excludedIds.size > 0 &&
    !statuses.isLoading &&
    !statuses.isError
  ) {
    return null;
  }

  const loading = (
    <div role={embedded ? "listitem" : undefined} className="space-y-2 px-2.5 py-2.5" aria-label="Carregando estados do WhatsApp">
      <Skeleton className="h-14 w-full rounded-[6px]" />
      <Skeleton className="h-14 w-full rounded-[6px]" />
      <Skeleton className="h-14 w-full rounded-[6px]" />
    </div>
  );
  const error = (
    <div role={embedded ? "listitem" : undefined} className="m-2.5 rounded-[6px] border border-red-200 bg-red-50 p-4 dark:border-red-900/70 dark:bg-red-950/40">
      <p className="text-sm font-medium text-red-700 dark:text-red-300">
        Não foi possível carregar os estados das conexões.
      </p>
      <p className="mt-1 text-xs text-red-600 dark:text-red-400">
        Tente atualizar novamente.
      </p>
      <Button
        type="button"
        size="sm"
        className={`mt-3 h-8 gap-1.5 rounded-[6px] px-3 text-xs ${WHATSAPP_SESSION_ACTION_CLASS_NAME}`}
        disabled={statuses.isFetching}
        onClick={() => void statuses.refetch()}
      >
        <RefreshCw className={`h-3.5 w-3.5 ${statuses.isFetching ? "animate-spin" : ""}`} aria-hidden="true" />
        Tentar novamente
      </Button>
    </div>
  );
  const empty = (
    <div role={embedded ? "listitem" : undefined} className="flex flex-col items-center gap-2 px-2.5 py-6 text-center">
      <Smartphone className="h-6 w-6 text-[var(--app-text-tertiary)]" aria-hidden="true" />
      <p className="text-xs font-light text-[var(--app-text-secondary)]">Nenhuma conexão encontrada</p>
    </div>
  );
  const rows = sessions.map((session) => (
    <SessionStatusRow
      key={session.id}
      session={session}
      embedded={embedded}
      allowProviderVerification={allowProviderVerification}
      refreshing={statuses.isFetching}
      verifyingSessionId={
        verifyStatus.isPending ? verifyStatus.variables ?? null : null
      }
      onVerify={(item) => void handleVerify(item)}
      onRefresh={() => void statuses.refetch()}
    />
  ));

  if (embedded) {
    return (
      <>
        {statuses.isLoading && sessions.length === 0 ? loading : null}
        {statuses.isError ? error : null}
        {rows}
        {!statuses.isLoading && !statuses.isError && sessions.length === 0 ? empty : null}
      </>
    );
  }

  return (
    <Card data-whatsapp-status-panel className="@container min-w-0 rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
      <CardContent className="p-0">
        {statuses.isLoading ? loading : statuses.isError ? error : sessions.length === 0 ? empty : (
          <>
            <div
              aria-hidden="true"
              className={`crm-management-sticky-header hidden h-8 items-center gap-x-2.5 bg-[var(--app-surface-soft)] px-2.5 text-[10px] font-light text-[var(--app-text-secondary)] @min-[840px]:grid ${WHATSAPP_SESSION_LIST_COLUMNS_CLASS_NAME}`}
            >
              <span>Usuário</span>
              <span>Conexão</span>
              <span>Número</span>
              <span className="text-right">Status</span>
              <span className="text-right">Ações</span>
            </div>
            <ul aria-label="Status das conexões WhatsApp">
              {rows}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
