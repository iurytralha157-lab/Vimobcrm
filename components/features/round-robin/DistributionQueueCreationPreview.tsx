import { ArrowDown, UsersRound } from "lucide-react";
import type { DistributionQueueFormData } from "@/lib/round-robin/distribution-queue-form";
import { isQueueOperatingScheduleDraft, QUEUE_WEEKDAYS } from "@/lib/round-robin/operating-schedule";

interface DistributionQueueCreationPreviewProps {
  formData: DistributionQueueFormData;
  pipelineName?: string;
  stageName?: string;
  criteria: { id: string; label: string; values: string[] }[];
  tagNames: string[];
  teamMembersById?: Record<string, string[]>;
}

export function DistributionQueueCreationPreview({
  formData,
  pipelineName,
  stageName,
  criteria,
  tagNames,
  teamMembersById = {},
}: DistributionQueueCreationPreviewProps) {
  const totalWeight = formData.members.reduce((sum, member) => sum + (member.isActive !== false ? member.weight : 0), 0);
  const hasWhatsAppCampaign = formData.conditions.some(
    (condition) => condition.type === "whatsapp_message_contains",
  );

  return (
    <div className="space-y-3 text-[12px] font-light">
      <p className="break-words font-normal">{formData.name.trim() || "Nome da fila"}</p>
      <section className="space-y-2 rounded-[8px] bg-[var(--app-surface-solid)] p-3">
        <h3 className="font-normal">Entrada</h3>
        {criteria.length === 0 ? (
          <p className="text-[11px] text-[var(--app-text-tertiary)]">Selecione os critérios de entrada.</p>
        ) : criteria.map((criterion) => (
          <div key={criterion.id} className="text-[11px]">
            <p className="text-[var(--app-text-secondary)]">{criterion.label}</p>
            <p className="mt-0.5 break-words">{criterion.values.join(", ") || "Ainda não preenchido"}</p>
          </div>
        ))}
      </section>
      <ArrowDown className="mx-auto h-4 w-4 text-[var(--app-text-tertiary)]" aria-hidden="true" />
      <section className="rounded-[8px] bg-[var(--app-surface-solid)] p-3">
        <h3 className="font-normal">Destino</h3>
        <p className="mt-1 break-words">{pipelineName || "Selecione um pipeline"}</p>
        <p className="mt-0.5 text-[11px] text-[var(--app-text-tertiary)]">{stageName || "Selecione o estágio inicial"}</p>
      </section>
      <ArrowDown className="mx-auto h-4 w-4 text-[var(--app-text-tertiary)]" aria-hidden="true" />
      <section className="space-y-2 rounded-[8px] bg-[var(--app-surface-solid)] p-3">
        <h3 className="flex items-center gap-2 font-normal"><UsersRound className="h-4 w-4" aria-hidden="true" /> Participantes</h3>
        {formData.members.length === 0 ? (
          <p className="text-[11px] text-[var(--app-text-tertiary)]">Adicione pessoas ou equipes.</p>
        ) : (
          <ol className="space-y-2">
            {formData.members.map((member, index) => (
              <li key={member.id || `${member.type}:${member.entityId}`} className="flex items-start justify-between gap-2 text-[11px]">
                <span className="min-w-0 break-words">
                  {index + 1}. {member.name || (member.type === "team" ? "Equipe" : "Corretor")}
                  {member.isActive === false && <span className="block text-destructive">Participação inativa ou vínculo indisponível</span>}
                  <span className="block text-[10px] text-[var(--app-text-tertiary)]">{member.type === "team" ? "Conforme membros e escala da equipe" : member.teamId ? "Contexto de equipe preservado" : "Participação direta"}</span>
                  {member.type === "team" && teamMembersById[member.entityId]?.length > 0 && (
                    <span className="mt-1 block text-[10px] text-[var(--app-text-secondary)]">
                      {teamMembersById[member.entityId].join(", ")}
                    </span>
                  )}
                </span>
                {formData.strategy === "weighted" && (
                  <span className="shrink-0 tabular-nums">{member.isActive !== false && totalWeight > 0 ? Math.round(member.weight / totalWeight * 100) : 0}%</span>
                )}
              </li>
            ))}
          </ol>
        )}
        <p className="text-[10px] leading-4 text-[var(--app-text-tertiary)]">
          {formData.strategy === "weighted" ? "Proporção teórica dos pesos configurados." : "Ordem configurada dos participantes."} O próximo responsável é definido quando o lead entrar.
        </p>
      </section>
      <section className="space-y-1 rounded-[8px] bg-[var(--app-surface-solid)] p-3">
        <h3 className="font-normal">Horário da fila</h3>
        {isQueueOperatingScheduleDraft(formData.settings.operating_schedule) ? <>
          <p className="text-[11px]">{formData.settings.operating_schedule.timezone || 'Selecione o fuso horário.'}</p>
          {formData.settings.operating_schedule.days.filter((day) => day.is_active).map((day) => <p key={day.day_of_week} className="text-[11px]">{QUEUE_WEEKDAYS[day.day_of_week]}: {day.is_all_day ? 'Dia inteiro' : `${day.start_time || '—'} a ${day.end_time || '—'}${day.start_time && day.end_time && day.start_time > day.end_time ? ' do dia seguinte' : ''}`}</p>)}
          {!formData.settings.operating_schedule.days.some((day) => day.is_active) && <p className="text-[11px]">Distribuição automática fechada todos os dias.</p>}
          <p className="text-[10px] text-muted-foreground">Fora do horário, a entrada permanece ativa e os leads aguardam no bolsão da fila.</p>
          {formData.settings.pool_notifications?.enabled && <p className="text-[10px] text-muted-foreground">Aviso por WhatsApp somente aos participantes e líderes autorizados da fila, quando houver configuração disponível.</p>}
        </> : <p className="text-[11px] text-muted-foreground">{formData.settings.operating_schedule === undefined ? 'Funcionamento anterior preservado; escala semanal ainda não definida.' : 'Escala inválida; revise o horário da fila.'}</p>}
      </section>
      {tagNames.length > 0 && (
        <section className="rounded-[8px] bg-[var(--app-surface-solid)] p-3"><h3 className="font-normal">Tags automáticas</h3><p className="mt-1 break-words text-[11px]">{tagNames.join(", ")}</p></section>
      )}
      {formData.settings.enable_redistribution && (
        <section className="rounded-[8px] bg-[var(--app-surface-solid)] p-3"><h3 className="font-normal">Redistribuição</h3><p className="mt-1 text-[11px]">Após {formData.settings.redistribution_timeout_minutes ?? 20} minutos sem atendimento.</p></section>
      )}
      {hasWhatsAppCampaign && formData.settings.whatsapp_distribution_auto_reply_enabled && (
        <section className="rounded-[8px] bg-[var(--app-surface-solid)] p-3"><h3 className="font-normal">Resposta no WhatsApp</h3><p className="mt-2 whitespace-pre-wrap break-words rounded-[6px] bg-[var(--app-surface-soft)] p-2 text-[11px]">{formData.settings.whatsapp_distribution_auto_reply_message}</p></section>
      )}
    </div>
  );
}
