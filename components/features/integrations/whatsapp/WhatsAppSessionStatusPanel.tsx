"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Smartphone,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  getWhatsAppStatusScopeCopy,
  summarizeWhatsAppSessionStatuses,
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

function formatStatusTimestamp(value: string | null) {
  if (!value) return "Ainda sem conexão confirmada";
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return "Horário indisponível";

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function StatusSummary({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Smartphone;
  label: string;
  value: number;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-[7px] bg-[var(--app-surface-soft)] px-3 py-2">
      <Icon className="h-4 w-4 shrink-0 text-[var(--app-text-tertiary)]" aria-hidden="true" />
      <span className="truncate text-xs text-[var(--app-text-secondary)]">
        {label}
      </span>
      <strong className="ml-auto text-sm font-medium text-[var(--app-text-primary)]">
        {value}
      </strong>
    </div>
  );
}

function SessionStatusRow({
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
    <li className="grid gap-3 rounded-[8px] border border-[var(--app-border)] bg-[var(--app-surface-solid)] p-3 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto] md:items-center">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar className="h-9 w-9 shrink-0">
          <AvatarFallback className="text-xs">{ownerInitial}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[var(--app-text-primary)]">
            {session.display_name}
          </p>
          <p className="truncate text-xs text-[var(--app-text-secondary)]">
            {phone || session.profile_name || "Número ainda não identificado"}
          </p>
          <p className="truncate text-[11px] text-[var(--app-text-tertiary)]">
            Responsável: {session.owner.name}
          </p>
        </div>
      </div>

      <div className="min-w-0">
        <Badge
          variant="outline"
          className={`rounded-[6px] text-[10px] font-medium ${statusToneClassName[status.tone]}`}
        >
          {status.label}
        </Badge>
        <p className="mt-1 truncate text-[11px] text-[var(--app-text-tertiary)]">
          Última conexão: {formatStatusTimestamp(session.last_connected_at)}
        </p>
        <p className="truncate text-[11px] text-[var(--app-text-tertiary)]">
          Estado atualizado: {formatStatusTimestamp(session.updated_at)}
        </p>
      </div>

      {session.capabilities.can_manage ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 rounded-[6px]"
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
      ) : (
        <span className="text-right text-[11px] text-[var(--app-text-tertiary)]">
          Somente visualização
        </span>
      )}
    </li>
  );
}

export function WhatsAppSessionStatusPanel() {
  const statuses = useWhatsAppSessionStatuses({ live: true });
  const verifyStatus = useVerifyWhatsAppSessionStatus();
  const response = statuses.data;
  const sessions = response?.data ?? [];
  const summary = summarizeWhatsAppSessionStatuses(sessions);

  const handleVerify = async (session: WhatsAppSessionStatusSummary) => {
    try {
      const providerStatus = await verifyStatus.mutateAsync(session.id);
      const presentation = getWhatsAppStatusPresentation(
        providerStatus.state || providerStatus.status,
      );
      toast({
        title: presentation.label,
        description: `A conexão “${session.display_name}” foi consultada diretamente no provedor.`,
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
      <CardHeader className="gap-3 p-4 pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base font-medium">
              <ShieldCheck className="h-5 w-5 text-emerald-600" aria-hidden="true" />
              Estado das conexões
            </CardTitle>
            <p className="mt-1 text-xs text-[var(--app-text-secondary)]">
              {response
                ? getWhatsAppStatusScopeCopy(response.meta.scope)
                : "Carregando somente os estados permitidos para o seu acesso."}
            </p>
            <p className="mt-1 text-[11px] text-[var(--app-text-tertiary)]">
              Esta tela não carrega conversas, mensagens, JIDs nem credenciais do provedor.
            </p>
          </div>
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

        {!statuses.isLoading && !statuses.isError ? (
          <div className="grid gap-2 sm:grid-cols-3">
            <StatusSummary icon={Smartphone} label="No seu escopo" value={summary.total} />
            <StatusSummary icon={CheckCircle2} label="Conectadas" value={summary.connected} />
            <StatusSummary icon={AlertTriangle} label="Precisam de atenção" value={summary.attention} />
          </div>
        ) : null}
      </CardHeader>

      <CardContent className="px-4 pb-4 pt-0">
        {statuses.isLoading ? (
          <div className="space-y-2" aria-label="Carregando estados do WhatsApp">
            <Skeleton className="h-20 w-full rounded-[8px]" />
            <Skeleton className="h-20 w-full rounded-[8px]" />
          </div>
        ) : statuses.isError ? (
          <div className="rounded-[8px] border border-red-200 bg-red-50 p-4 dark:border-red-900/70 dark:bg-red-950/40">
            <p className="text-sm font-medium text-red-700 dark:text-red-300">
              Não foi possível carregar os estados das conexões.
            </p>
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">
              Nenhum dado de conversa foi consultado. Tente atualizar novamente.
            </p>
          </div>
        ) : sessions.length === 0 ? (
          <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-6 text-center">
            <Smartphone className="mx-auto h-8 w-8 text-[var(--app-text-tertiary)]" aria-hidden="true" />
            <p className="mt-2 text-sm font-medium text-[var(--app-text-primary)]">
              Nenhuma conexão no seu escopo
            </p>
            <p className="mt-1 text-xs text-[var(--app-text-secondary)]">
              A lista será atualizada automaticamente quando uma conexão for criada.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {sessions.map((session) => (
              <SessionStatusRow
                key={session.id}
                session={session}
                verifyingSessionId={
                  verifyStatus.isPending ? verifyStatus.variables ?? null : null
                }
                onVerify={(item) => void handleVerify(item)}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
