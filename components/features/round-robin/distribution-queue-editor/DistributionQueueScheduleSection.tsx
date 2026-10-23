'use client';

import { Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { createQueueOperatingSchedule, isQueueOperatingScheduleDraft, QUEUE_WEEKDAYS, queueScheduleError } from '@/lib/round-robin/operating-schedule';
import type { QueueOperatingDay, QueueOperatingSchedule } from '@/lib/validation/queue-runtime';

interface Props {
  schedule?: QueueOperatingSchedule;
  isLegacy: boolean;
  onChange: (schedule: QueueOperatingSchedule) => void;
  poolNotificationsEnabled?: boolean;
  onPoolNotificationsChange: (enabled: boolean) => void;
}

export function DistributionQueueScheduleSection({ schedule, isLegacy, onChange, poolNotificationsEnabled = false, onPoolNotificationsChange }: Props) {
  if (schedule !== undefined && !isQueueOperatingScheduleDraft(schedule)) return <section className="space-y-3"><p role="alert" className="text-[11px] text-destructive">A escala salva está em um formato inválido. Defina os horários para revisar a configuração antes de salvar.</p><Button type="button" variant="outline" onClick={() => onChange(createQueueOperatingSchedule())}>Revisar horário da fila</Button></section>;
  const error = queueScheduleError(schedule, !isLegacy);
  const setDay = (dayOfWeek: number, patch: Partial<QueueOperatingDay>) => {
    if (!schedule) return;
    onChange({ ...schedule, days: schedule.days.map((day) => day.day_of_week === dayOfWeek ? { ...day, ...patch } : day) });
  };
  return (
    <section data-tour="distribution-queue-schedule" className="space-y-3 text-[12px]">
      <h3 className="flex items-center gap-2 font-medium"><Clock className="h-4 w-4" aria-hidden="true" /> Horário semanal da fila</h3>
      <p className="text-[11px] leading-5 text-muted-foreground">A entrada de leads continua aberta. Fora destes horários, os leads aguardam no bolsão desta fila. A escala dos integrantes de equipes também é respeitada na distribuição automática.</p>
      {!schedule ? (
        <div className="space-y-3 rounded-[6px] bg-[var(--app-surface-soft)] p-3">
          <p className="text-[11px] text-muted-foreground">Esta fila ainda usa o funcionamento anterior. Seus horários serão preservados até você definir e salvar uma escala semanal.</p>
          <Button type="button" variant="outline" onClick={() => onChange(createQueueOperatingSchedule())}>Definir horário da fila</Button>
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="queue-operating-timezone">Fuso horário</Label>
            <Input id="queue-operating-timezone" value={schedule.timezone} maxLength={100} list="queue-operating-timezones" placeholder="Ex.: America/Sao_Paulo" onChange={(event) => onChange({ ...schedule, timezone: event.target.value })} className="h-10 border-0 bg-[var(--app-surface-soft)]" />
            <datalist id="queue-operating-timezones"><option value="America/Sao_Paulo" /><option value="America/Manaus" /><option value="America/Cuiaba" /><option value="America/Rio_Branco" /><option value="America/Noronha" /><option value="UTC" /></datalist>
          </div>
          <div className="space-y-2">
            {schedule.days.map((day) => (
              <div key={day.day_of_week} className="space-y-2 rounded-[6px] bg-[var(--app-surface-soft)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Label htmlFor={`queue-day-${day.day_of_week}`} className="flex items-center gap-2"><Switch id={`queue-day-${day.day_of_week}`} checked={day.is_active} onCheckedChange={(checked) => setDay(day.day_of_week, { is_active: checked })} />{QUEUE_WEEKDAYS[day.day_of_week]}</Label>
                  {day.is_active && <Label htmlFor={`queue-day-all-${day.day_of_week}`} className="flex items-center gap-2 text-[11px]"><Switch id={`queue-day-all-${day.day_of_week}`} checked={day.is_all_day} onCheckedChange={(checked) => setDay(day.day_of_week, { is_all_day: checked, start_time: null, end_time: null })} />Dia inteiro</Label>}
                </div>
                {day.is_active && !day.is_all_day && (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1"><Label className="text-[11px]" htmlFor={`queue-start-${day.day_of_week}`}>Início</Label><Input id={`queue-start-${day.day_of_week}`} type="time" value={day.start_time ?? ''} step={60} onChange={(event) => setDay(day.day_of_week, { start_time: event.target.value || null })} /></div>
                    <div className="space-y-1"><Label className="text-[11px]" htmlFor={`queue-end-${day.day_of_week}`}>Fim</Label><Input id={`queue-end-${day.day_of_week}`} type="time" value={day.end_time ?? ''} step={60} onChange={(event) => setDay(day.day_of_week, { end_time: event.target.value || null })} /></div>
                  </div>
                )}
                {day.is_active && !day.is_all_day && day.start_time && day.end_time && day.start_time > day.end_time && <p className="text-[10px] text-muted-foreground">Termina no dia seguinte.</p>}
              </div>
            ))}
          </div>
          {!schedule.days.some((day) => day.is_active) && <p className="text-[11px] text-muted-foreground">Todos os dias estão fechados; os leads recebidos aguardarão no bolsão desta fila.</p>}
          <p className="text-[10px] text-muted-foreground">O início está incluído; no horário de fim a fila fecha. Assumir um lead autorizado continua disponível fora da escala.</p>
          <div className="space-y-2 rounded-[6px] bg-[var(--app-surface-soft)] p-3">
            <Label htmlFor="queue-pool-notifications" className="flex items-center gap-2"><Switch id="queue-pool-notifications" checked={poolNotificationsEnabled} onCheckedChange={onPoolNotificationsChange} />Avisar participantes e líderes por WhatsApp</Label>
            <p className="text-[11px] leading-5 text-muted-foreground">Quando houver leads aguardando no bolsão, avisar somente os participantes e líderes autorizados desta fila. O envio depende da configuração de WhatsApp disponível.</p>
          </div>
        </>
      )}
      {error && <p role="alert" className="text-[11px] text-destructive">{error}</p>}
    </section>
  );
}
