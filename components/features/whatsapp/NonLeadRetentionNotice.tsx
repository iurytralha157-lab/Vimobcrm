"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Clock3, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function formatRemainingTime(remainingMs: number) {
  if (remainingMs <= 0) return "Prazo encerrado";
  const totalMinutes = Math.ceil(remainingMs / MINUTE_MS);
  const days = Math.floor(totalMinutes / (DAY_MS / MINUTE_MS));
  const hours = Math.floor((totalMinutes % (DAY_MS / MINUTE_MS)) / (HOUR_MS / MINUTE_MS));
  if (days > 0) {
    return `${days} ${days === 1 ? "dia" : "dias"} e ${hours} ${hours === 1 ? "hora" : "horas"} restantes`;
  }
  if (hours > 0) {
    const minutes = totalMinutes % (HOUR_MS / MINUTE_MS);
    return `${hours} ${hours === 1 ? "hora" : "horas"} e ${minutes} ${minutes === 1 ? "minuto" : "minutos"} restantes`;
  }
  return `${totalMinutes} ${totalMinutes === 1 ? "minuto" : "minutos"} restantes`;
}

type NonLeadRetentionNoticeProps = {
  expiresAt?: string | null;
  onCreateLead?: () => void;
  manageHref?: string;
  onManageClick?: () => void;
};

export function NonLeadRetentionNotice({
  expiresAt,
  onCreateLead,
  manageHref,
  onManageClick,
}: NonLeadRetentionNoticeProps) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (!expiresAt) return;
    const refresh = () => setNow(Date.now());
    refresh();
    const interval = window.setInterval(refresh, MINUTE_MS);
    return () => window.clearInterval(interval);
  }, [expiresAt]);

  if (!expiresAt) return null;
  const deadline = new Date(expiresAt).getTime();
  if (!Number.isFinite(deadline)) return null;
  const remaining = now === null ? null : deadline - now;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-foreground">
      <Clock3 className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          Prazo para criar ou vincular um lead: {remaining === null ? "7 dias" : formatRemainingTime(remaining)}
        </p>
        <p className="text-[11px] text-muted-foreground">
          O prazo começa na primeira mensagem recebida e não reinicia com novas mensagens. Se virar lead antes do vencimento, todo o histórico é preservado. Ao vencer, a conversa deixa de aparecer no CRM e a limpeza exclui sua cópia completa, inclusive mensagens e mídias. O WhatsApp original permanece.
        </p>
      </div>
      {remaining !== null && remaining <= 0 ? null : onCreateLead ? (
        <Button type="button" size="sm" variant="outline" className="h-7 shrink-0 text-[11px]" onClick={onCreateLead}>
          <UserPlus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Criar lead
        </Button>
      ) : manageHref ? (
        <Button type="button" size="sm" variant="outline" className="h-7 shrink-0 text-[11px]" asChild>
          <Link href={manageHref} onClick={onManageClick}>Abrir Conversas</Link>
        </Button>
      ) : null}
    </div>
  );
}
