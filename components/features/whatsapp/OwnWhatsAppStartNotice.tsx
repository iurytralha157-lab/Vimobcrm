"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import type { OwnWhatsAppStartNoticeState } from "@/lib/whatsapp-own-start";

export function OwnWhatsAppStartNotice({ notice, unavailableReason, onRetry, busy = false, onStart, onConnect }: {
  notice: OwnWhatsAppStartNoticeState | null;
  unavailableReason?: "read_only" | "sessions_failed";
  onRetry?: () => void;
  busy?: boolean;
  onStart?: () => void;
  onConnect?: () => void;
}) {
  if (unavailableReason) return (
    <div role="status" className="mx-3 my-2 flex items-center justify-center gap-2 rounded-md bg-primary/50 px-2 py-2 text-center text-[11px] leading-4 font-light text-white" data-whatsapp-unavailable={unavailableReason}>
      <span>{unavailableReason === "read_only" ? "Envios indisponíveis nesta prévia em somente leitura" : "Não foi possível verificar a conexão do WhatsApp"}</span>
      {unavailableReason === "sessions_failed" && onRetry && <button type="button" onClick={onRetry} className="rounded-md px-1 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50">Tentar novamente</button>}
    </div>
  );
  if (!notice) return null;
  const actionClass = "flex w-full items-center justify-center gap-2 rounded-md px-2 py-2 text-center text-[11px] leading-4 font-light text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50";

  return (
    <div className="mx-3 my-2 rounded-md bg-primary/50" data-whatsapp-own-start={notice.kind}>
      {notice.kind === "connect" ? (
        <Link href="/settings?tab=whatsapp" className={actionClass} onClick={onConnect}>
          Conecte o WhatsApp para iniciar o atendimento deste lead
        </Link>
      ) : (
        <button type="button" className={actionClass} onClick={onStart} disabled={busy || !onStart} aria-busy={busy}>
          {busy && <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
          {notice.resumeCapture ? "Iniciar atendimento neste WhatsApp" : "Iniciar conversa pelo seu WhatsApp"}
        </button>
      )}
    </div>
  );
}
