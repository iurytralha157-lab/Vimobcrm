import { Button } from "@/components/ui/button";

/** A missing or invalid tenant time zone must not become a confirmed fallback. */
export function getConfirmedScheduleTimeZone(query: {
  isSuccess: boolean;
  data?: { timeZone?: string | null };
}) {
  const timeZone = query.isSuccess ? query.data?.timeZone?.trim() : undefined;
  if (!timeZone) return null;
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone }).format(0);
    return timeZone;
  } catch {
    return null;
  }
}

export function ScheduleTimeZoneStatus({ failed, retry, fetching = false }: {
  failed: boolean;
  retry: () => void;
  fetching?: boolean;
}) {
  return (
    <div role={failed ? "alert" : "status"} className="rounded-[6px] bg-[var(--app-surface-soft)] px-3 py-2 text-[12px] text-[var(--app-text-secondary)]">
      <p>{failed ? "Horários indisponíveis: não foi possível confirmar o fuso da agenda." : "Carregando os horários da agenda..."}</p>
      {failed && <Button variant="ghost" size="sm" disabled={fetching} className="mt-1 h-8 text-[12px]" onClick={retry}>Tentar novamente</Button>}
    </div>
  );
}
