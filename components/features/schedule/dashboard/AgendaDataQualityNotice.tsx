import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ScheduleDashboardDataQuality } from "@/lib/validation/schedule-dashboard";

export function AgendaDataQualityNotice({ quality }: { quality?: ScheduleDashboardDataQuality }) {
  const missing = quality && (
    quality.missing_created_by > 0 || quality.missing_lead_source_snapshot > 0 ||
    quality.completed_without_performer > 0 || quality.completed_without_result_time > 0 ||
    quality.unknown_result_time_in_scope > 0
  );
  if (quality && !missing) return null;

  return (
    <div role="status" className="flex items-center justify-between gap-2 rounded-[7px] bg-amber-500/10 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-300">
      <span>{quality ? "Há dados históricos incompletos nesta leitura." : "Cobertura histórica não informada nesta leitura."}</span>
      <Popover>
        <PopoverTrigger asChild>
            <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0 text-current" title="Detalhes da qualidade dos dados da agenda" aria-label="Detalhes da qualidade dos dados da agenda">
              <Info className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
        </PopoverTrigger>
        <PopoverContent aria-label="Cobertura dos dados da agenda" align="end" className="app-header-popover max-h-[calc(100dvh-24px)] w-[min(360px,calc(100vw-24px))] space-y-1.5 overflow-y-auto rounded-[7px] border-0 p-3 text-[11px] leading-4">
            {quality ? (
              <>
                <p>No período, na base de data e nos filtros selecionados: {quality.period_events} eventos considerados.</p>
                <ul className="list-inside list-disc space-y-1">
                  <li>{quality.missing_created_by} sem registro de quem criou.</li>
                  <li>{quality.missing_lead_source_snapshot} com lead e sem origem histórica registrada.</li>
                  <li>{quality.completed_without_performer} realizados sem registro do executor.</li>
                  <li>{quality.completed_without_result_time} realizados sem data real de desfecho.</li>
                </ul>
                <p>{quality.unknown_result_time_in_scope} finalizados sem data de desfecho no escopo dos filtros. Como a data é desconhecida, essa contagem não é atribuída ao período selecionado.</p>
                <p>As contagens podem se sobrepor. O ranking considera responsáveis e participantes, não a autoria da execução.</p>
              </>
            ) : (
              <p>O serviço não informou a cobertura destes dados. Os indicadores não comprovam que o histórico esteja completo.</p>
            )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
