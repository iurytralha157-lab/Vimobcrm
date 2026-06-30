import { useState, useEffect } from 'react';
import { Clock, Loader2, X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useMemberAvailability, useBulkUpdateMemberAvailability, getDayName, type MemberAvailability } from '@/hooks/use-member-availability';

interface MemberAvailabilityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamMemberId: string;
  memberName: string;
  memberAvatar?: string | null;
}

interface DaySchedule {
  day_of_week: number;
  is_active: boolean;
  is_all_day: boolean;
  start_time: string;
  end_time: string;
}

const TIME_OPTIONS = [
  '00:00', '00:30', '01:00', '01:30', '02:00', '02:30', '03:00', '03:30',
  '04:00', '04:30', '05:00', '05:30', '06:00', '06:30', '07:00', '07:30',
  '08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
  '12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30',
  '16:00', '16:30', '17:00', '17:30', '18:00', '18:30', '19:00', '19:30',
  '20:00', '20:30', '21:00', '21:30', '22:00', '22:30', '23:00', '23:30',
  '23:59'
];

const DEFAULT_START = '08:00';
const DEFAULT_END = '18:00';
const EMPTY_AVAILABILITY: MemberAvailability[] = [];

export function MemberAvailabilityDialog({
  open,
  onOpenChange,
  teamMemberId,
  memberName,
  memberAvatar,
}: MemberAvailabilityDialogProps) {
  const { data: existingAvailabilityData, isLoading } = useMemberAvailability(teamMemberId);
  const existingAvailability = existingAvailabilityData ?? EMPTY_AVAILABILITY;
  const bulkUpdate = useBulkUpdateMemberAvailability();

  const [schedules, setSchedules] = useState<DaySchedule[]>([]);
  const [globalAllDay, setGlobalAllDay] = useState(false);

  useEffect(() => {
    if (open) {
      const initialSchedules: DaySchedule[] = [];
      const hasExisting = existingAvailability.length > 0;

      for (let day = 0; day < 7; day++) {
        const existing = existingAvailability.find((item) => item.day_of_week === day);
        initialSchedules.push({
          day_of_week: day,
          is_active: existing ? existing.is_active : hasExisting ? false : day >= 1 && day <= 5,
          is_all_day: existing?.is_all_day ?? false,
          start_time: existing?.start_time?.slice(0, 5) || DEFAULT_START,
          end_time: existing?.end_time?.slice(0, 5) || DEFAULT_END,
        });
      }

      let cancelled = false;
      queueMicrotask(() => {
        if (cancelled) return;
        setSchedules(initialSchedules);
        const activeSchedules = initialSchedules.filter((schedule) => schedule.is_active);
        setGlobalAllDay(activeSchedules.length > 0 && activeSchedules.every((schedule) => schedule.is_all_day));
      });

      return () => {
        cancelled = true;
      };
    }
  }, [existingAvailability, open]);

  const toggleDay = (dayOfWeek: number) => {
    setSchedules((prev) =>
      prev.map((schedule) =>
        schedule.day_of_week === dayOfWeek ? { ...schedule, is_active: !schedule.is_active } : schedule
      )
    );
  };

  const updateDayTime = (dayOfWeek: number, field: 'start_time' | 'end_time', value: string) => {
    setSchedules((prev) =>
      prev.map((schedule) => (schedule.day_of_week === dayOfWeek ? { ...schedule, [field]: value } : schedule))
    );
  };

  const toggleGlobalAllDay = (checked: boolean) => {
    setGlobalAllDay(checked);
    setSchedules((prev) =>
      prev.map((schedule) => ({ ...schedule, is_all_day: schedule.is_active ? checked : schedule.is_all_day }))
    );
  };

  const toggleDayAllDay = (dayOfWeek: number, checked: boolean) => {
    setSchedules((prev) =>
      prev.map((schedule) => (schedule.day_of_week === dayOfWeek ? { ...schedule, is_all_day: checked } : schedule))
    );
    if (!checked) setGlobalAllDay(false);
  };

  const handleSave = async () => {
    await bulkUpdate.mutateAsync({
      teamMemberId,
      availability: schedules.map((schedule) => ({
        day_of_week: schedule.day_of_week,
        start_time: schedule.is_all_day ? null : `${schedule.start_time}:00`,
        end_time: schedule.is_all_day ? null : `${schedule.end_time}:00`,
        is_all_day: schedule.is_all_day,
        is_active: schedule.is_active,
      })),
    });
    onOpenChange(false);
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((part) => part[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const activeDays = schedules.filter((schedule) => schedule.is_active).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[92%] max-h-[85vh] overflow-hidden border-0 bg-black/82 p-0 text-white shadow-2xl backdrop-blur-xl sm:max-w-lg sm:rounded-[20px] [&>button]:hidden">
        <div className="p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Avatar className="h-9 w-9">
                <AvatarImage src={memberAvatar || undefined} />
                <AvatarFallback className="bg-primary text-primary-foreground">
                  {getInitials(memberName)}
                </AvatarFallback>
              </Avatar>
              <div>
                <DialogTitle className="text-left text-base">Disponibilidade</DialogTitle>
                <p className="text-xs text-white/50">{memberName}</p>
              </div>
            </div>
            <button
              type="button"
              className="rounded-full p-1.5 text-white/65 transition hover:bg-white/10 hover:text-white"
              onClick={() => onOpenChange(false)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-white/50" />
            </div>
          ) : (
            <div className="max-h-[55vh] space-y-3 overflow-y-auto overflow-x-hidden pr-1">
              <div className="flex items-center justify-between rounded-xl bg-white/10 p-3">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-primary" />
                  <div>
                    <span className="block text-sm font-medium">Marcar todos como 24h</span>
                    <span className="text-[10px] text-white/45">Define 24h para todos os dias ativos</span>
                  </div>
                </div>
                <Switch checked={globalAllDay} onCheckedChange={toggleGlobalAllDay} />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-white/45">Dias da semana</Label>
                  <Badge variant="secondary" className="border-0 bg-white/10 text-xs text-white">
                    {activeDays} {activeDays === 1 ? 'dia' : 'dias'} ativos
                  </Badge>
                </div>

                <div className="space-y-2">
                  {schedules.map((schedule) => (
                    <div
                      key={schedule.day_of_week}
                      className={`flex items-center gap-2 rounded-xl p-2 transition min-w-0 ${
                        schedule.is_active ? 'bg-primary/12' : 'bg-white/6 opacity-60'
                      }`}
                    >
                      <Switch
                        checked={schedule.is_active}
                        onCheckedChange={() => toggleDay(schedule.day_of_week)}
                        className="shrink-0"
                      />

                      <span className={`w-10 shrink-0 text-sm font-medium ${schedule.is_active ? '' : 'text-white/45'}`}>
                        {getDayName(schedule.day_of_week, true)}
                      </span>

                      {schedule.is_active ? (
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <div className="flex items-center gap-1">
                            <Switch
                              id={`all-day-${schedule.day_of_week}`}
                              checked={schedule.is_all_day}
                              onCheckedChange={(checked) => toggleDayAllDay(schedule.day_of_week, checked)}
                              className="scale-75"
                            />
                            <Label
                              htmlFor={`all-day-${schedule.day_of_week}`}
                              className="cursor-pointer text-[10px] font-bold uppercase text-white/45"
                            >
                              24h
                            </Label>
                          </div>

                          {!schedule.is_all_day ? (
                            <div className="flex min-w-0 flex-1 items-center gap-1">
                              <Select
                                value={schedule.start_time}
                                onValueChange={(value) => updateDayTime(schedule.day_of_week, 'start_time', value)}
                              >
                                <SelectTrigger className="h-7 min-w-0 flex-1 border-0 bg-white/10 px-2 text-xs text-white">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {TIME_OPTIONS.map((time) => (
                                    <SelectItem key={time} value={time} className="text-xs">
                                      {time}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <span className="shrink-0 text-xs text-white/45">–</span>
                              <Select
                                value={schedule.end_time}
                                onValueChange={(value) => updateDayTime(schedule.day_of_week, 'end_time', value)}
                              >
                                <SelectTrigger className="h-7 min-w-0 flex-1 border-0 bg-white/10 px-2 text-xs text-white">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {TIME_OPTIONS.map((time) => (
                                    <SelectItem key={time} value={time} className="text-xs">
                                      {time}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          ) : (
                            <div className="flex flex-1 justify-center">
                              <Badge variant="secondary" className="h-5 border-0 bg-white/10 px-2 py-0 text-[10px] text-white">
                                Dia inteiro
                              </Badge>
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-white/45">Não recebe leads</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <Button className="h-10 w-[30%] rounded-xl bg-white/10 text-white hover:bg-white/15" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button className="h-10 w-[70%] rounded-xl" onClick={handleSave} disabled={bulkUpdate.isPending}>
              {bulkUpdate.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
