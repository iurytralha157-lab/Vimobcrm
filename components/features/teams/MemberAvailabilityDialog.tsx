import { useState, useEffect, useRef, useReducer, type SetStateAction } from "react";
import { AlertTriangle, Clock, Copy, Loader2, RefreshCw, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useMemberAvailability,
  useBulkUpdateMemberAvailability,
  getDayName,
} from "@/hooks/use-member-availability";
import { isValidAvailabilityWeek, availabilityTimeOptions, toAvailabilityInput } from "./availability-week";
import { isAvailabilityClock } from "@/lib/teams/availability-clock";
import { getInitials } from "@/lib/user-display";
import { useActiveOrganizationId } from "@/hooks/use-active-organization";
import { VimobAPIError } from "@/lib/api/vimob-error";
import { toast } from "sonner";
import { availabilityDraftReducer, EMPTY_AVAILABILITY_DRAFT } from "./member-availability-draft";

interface MemberAvailabilityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamMemberId: string;
  memberName: string;
  memberAvatar?: string | null;
  readOnly?: boolean;
}

interface DaySchedule {
  day_of_week: number;
  is_active: boolean;
  is_all_day: boolean;
  start_time: string;
  end_time: string;
}

export function MemberAvailabilityDialog({
  open,
  onOpenChange,
  teamMemberId,
  memberName,
  memberAvatar,
  readOnly = false,
}: MemberAvailabilityDialogProps) {
  const organizationId = useActiveOrganizationId();
  const scopeKey = `${organizationId}:${teamMemberId}`;
  const scopeRef = useRef(scopeKey);
  const saveInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const availabilityQuery = useMemberAvailability(teamMemberId);
  const { data: snapshot, isLoading, isError, refetch } = availabilityQuery;
  const bulkUpdate = useBulkUpdateMemberAvailability();

  const [draft, dispatchDraft] = useReducer(availabilityDraftReducer, EMPTY_AVAILABILITY_DRAFT);
  const schedules = draft.scopeKey === scopeKey ? draft.schedules : [];
  const baseRevision = draft.scopeKey === scopeKey ? draft.revision : null;
  const legacyConfirmed = draft.scopeKey === scopeKey && draft.legacyConfirmed;
  const reviewReason = draft.scopeKey === scopeKey ? draft.reviewReason : null;
  const activeSchedules = schedules.filter((entry) => entry.is_active);
  const globalAllDay = activeSchedules.length > 0 && activeSchedules.every((entry) => entry.is_all_day);
  const setSchedules = (update: SetStateAction<DaySchedule[]>) => dispatchDraft({ type: "edit", scopeKey, update: typeof update === "function" ? update : () => update });
  const [saveConflict, setSaveConflict] = useState(false);

  useEffect(() => { scopeRef.current = scopeKey; }, [scopeKey]);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  useEffect(() => {
    if (!open) {
      let cancelled = false;
      queueMicrotask(() => { if (!cancelled) { dispatchDraft({ type: "close" }); setSaveConflict(false); } });
      return () => { cancelled = true; };
    }
    if (isLoading || isError || availabilityQuery.isFetching || !snapshot) return;
      let cancelled = false;
      queueMicrotask(() => {
        if (cancelled) return;
        dispatchDraft(open ? { type: "observe", scopeKey, snapshot } : { type: "close" });
      });

      return () => {
        cancelled = true;
      };
  }, [snapshot, availabilityQuery.isFetching, isError, isLoading, open, scopeKey]);

  const hasRevisionConflict = saveConflict || (baseRevision !== null && snapshot?.revision !== baseRevision);
  const handleReload = async () => {
    const requestedScope = scopeKey;
    const current = await refetch();
    if (current.isError || !current.data || !mountedRef.current || scopeRef.current !== requestedScope) return;
    dispatchDraft({ type: "reload", scopeKey: requestedScope, snapshot: current.data });
    setSaveConflict(false);
  };

  const toggleDay = (dayOfWeek: number) => {
    setSchedules((prev) =>
      prev.map((schedule) =>
        schedule.day_of_week === dayOfWeek
          ? { ...schedule, is_active: !schedule.is_active }
          : schedule,
      ),
    );
  };

  const updateDayTime = (
    dayOfWeek: number,
    field: "start_time" | "end_time",
    value: string,
  ) => {
    setSchedules((prev) =>
      prev.map((schedule) =>
        schedule.day_of_week === dayOfWeek
          ? { ...schedule, [field]: value }
          : schedule,
      ),
    );
  };

  const toggleGlobalAllDay = (checked: boolean) => {
    setSchedules((prev) =>
      prev.map((schedule) => ({
        ...schedule,
        is_all_day: schedule.is_active ? checked : schedule.is_all_day,
      })),
    );
  };

  const toggleDayAllDay = (dayOfWeek: number, checked: boolean) => {
    setSchedules((prev) =>
      prev.map((schedule) =>
        schedule.day_of_week === dayOfWeek
          ? { ...schedule, is_all_day: checked }
          : schedule,
      ),
    );
  };

  const applyDayToAllDays = (dayOfWeek: number) => {
    setSchedules((prev) => {
      const source = prev.find((schedule) => schedule.day_of_week === dayOfWeek);
      if (!source) return prev;
      return prev.map((schedule) =>
        schedule.is_active
          ? {
              ...schedule,
              is_all_day: source.is_all_day,
              start_time: source.start_time,
              end_time: source.end_time,
            }
          : schedule,
      );
    });
  };

  const handleSave = async () => {
    if (!organizationId || readOnly || saveInFlightRef.current || baseRevision === null || hasRevisionConflict || !isValidAvailabilityWeek(schedules) || !legacyConfirmed) return;
    saveInFlightRef.current = true;
    const requestedScope = scopeKey;
    try {
    await bulkUpdate.mutateAsync({
      teamMemberId,
      organizationId,
      expectedRevision: baseRevision,
      availability: toAvailabilityInput(schedules),
    });
    if (mountedRef.current && scopeRef.current === requestedScope) onOpenChange(false);
    } catch (error) {
      if (mountedRef.current && scopeRef.current === requestedScope && error instanceof VimobAPIError && error.code === "team_revision_conflict") {
        setSaveConflict(true);
        toast.error("A equipe mudou em outra sessão. Sua escala foi preservada; carregue a versão atual antes de salvar.");
        void refetch();
      }
    } finally { saveInFlightRef.current = false; }
  };

  const activeDays = schedules.filter((schedule) => schedule.is_active).length;

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!bulkUpdate.isPending) onOpenChange(value); }}>
      <DialogContent data-management-editor className="max-h-[calc(100dvh-24px)] w-[calc(100vw-24px)] overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-0 text-[12px] font-light text-[var(--app-text-primary)] shadow-none sm:max-h-[88dvh] sm:max-w-lg [&_button.absolute]:hidden">
        <div className="p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Avatar className="h-9 w-9 rounded-[6px]">
                <AvatarImage src={memberAvatar || undefined} />
                <AvatarFallback className="rounded-[6px] bg-primary/50 text-[12px] font-light text-white">
                  {getInitials(memberName)}
                </AvatarFallback>
              </Avatar>
              <div>
                <div className="flex items-center gap-2">
                  <DialogTitle className="text-left text-[14px] font-normal">
                    Disponibilidade
                  </DialogTitle>
                  {readOnly && (
                    <Badge
                      variant="secondary"
                      className="rounded-[4px] border-0 bg-[var(--app-surface-soft)] text-[9px] font-light text-[var(--app-text-tertiary)]"
                    >
                      Somente leitura
                    </Badge>
                  )}
                </div>
                <DialogDescription className="text-[12px] font-light text-[var(--app-text-tertiary)]">
                  {memberName}
                </DialogDescription>
              </div>
            </div>
            <button
              type="button"
              className="grid h-8 w-8 place-items-center rounded-[6px] text-[var(--app-text-secondary)] transition hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]"
              aria-label="Fechar disponibilidade"
              onClick={() => { if (!bulkUpdate.isPending) onOpenChange(false); }}
              disabled={bulkUpdate.isPending}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {hasRevisionConflict && !readOnly && (
            <div role="alert" className="mb-3 rounded-[6px] bg-amber-500/10 p-3 text-[11px] text-amber-700 dark:text-amber-300">
              <p>A equipe mudou em outra sessão. Sua escala permanece no formulário.</p>
              <Button type="button" variant="ghost" onClick={() => void handleReload()} disabled={availabilityQuery.isFetching || bulkUpdate.isPending} className="mt-1 h-8 px-2 text-[11px] font-light">
                Descartar rascunho e carregar versão atual
              </Button>
            </div>
          )}
          {isLoading || (!isError && baseRevision === null) ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-[var(--app-text-tertiary)]" />
            </div>
          ) : isError ? (
            <div className="flex min-h-48 flex-col items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)] px-4 text-center">
              <AlertTriangle className="mb-2 h-5 w-5 text-destructive" />
              <p className="text-[12px] font-normal">Não foi possível carregar a escala</p>
              <p className="mt-1 text-[10px] text-[var(--app-text-tertiary)]">
                Nenhum horário foi alterado. Tente carregar novamente.
              </p>
              <Button
                type="button"
                onClick={() => refetch()}
                className="mt-3 h-8 rounded-[6px] bg-primary/50 px-3 text-[11px] font-light text-white shadow-none hover:bg-primary"
              >
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Tentar novamente
              </Button>
            </div>
          ) : (
            <div className="max-h-[55vh] space-y-3 overflow-y-auto overflow-x-hidden pr-1">
              {reviewReason && (
                <div className="rounded-[6px] bg-amber-500/10 p-3 text-amber-700 dark:text-amber-300">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <p className="text-[12px] font-normal">
                        {reviewReason === "missing" ? "Sem escala configurada: recebe leads 24h" : "A escala salva precisa de revisão"}
                      </p>
                      <p className="mt-1 text-[10px] leading-4 opacity-80">
                        {readOnly
                          ? "A escala está ausente, incompleta ou contém horários inválidos."
                          : "Corrija os horários pendentes e revise os sete dias. Confirme a revisão antes de salvar a escala que controla a distribuição."}
                      </p>
                      {!readOnly && (
                        <label className="mt-2 flex cursor-pointer items-center gap-2 text-[10px]">
                          <input
                            type="checkbox"
                            checked={legacyConfirmed}
                            onChange={(event) => dispatchDraft({ type: "confirm", scopeKey, confirmed: event.target.checked })}
                            className="h-3.5 w-3.5 rounded-[4px] accent-primary"
                          />
                          Confirmo que revisei a escala.
                        </label>
                      )}
                    </div>
                  </div>
                </div>
              )}
              <div className="flex min-h-12 items-center justify-between rounded-[6px] bg-[var(--app-surface-soft)] px-3 py-2.5">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-[6px] bg-primary/50 text-white">
                    <Clock className="h-4 w-4" />
                  </span>
                  <span className="text-[12px] font-light leading-none">
                    Marcar todos como 24h
                  </span>
                </div>
                <Switch
                  checked={globalAllDay}
                  onCheckedChange={toggleGlobalAllDay}
                  disabled={readOnly || bulkUpdate.isPending}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-[12px] font-light text-[var(--app-text-tertiary)]">
                    Dias da semana
                  </Label>
                  <Badge
                    variant="secondary"
                    className="rounded-[4px] border-0 bg-[var(--app-surface-hover)] text-[10px] font-light text-[var(--app-text-secondary)]"
                  >
                    {activeDays} {activeDays === 1 ? "dia" : "dias"} ativos
                  </Badge>
                </div>

                <div className="space-y-2">
                  {schedules.map((schedule) => (
                    <div
                      key={schedule.day_of_week}
                      className={`flex items-center gap-2 min-w-0 rounded-[6px] p-2 transition ${
                        schedule.is_active
                          ? "bg-[var(--app-surface-hover)]"
                          : "bg-[var(--app-surface-soft)] opacity-60"
                      }`}
                    >
                      <Switch
                        checked={schedule.is_active}
                        onCheckedChange={() => toggleDay(schedule.day_of_week)}
                        className="shrink-0"
                        disabled={readOnly || bulkUpdate.isPending}
                      />

                      <span
                        className={`w-10 shrink-0 text-[12px] font-light ${schedule.is_active ? "" : "text-[var(--app-text-tertiary)]"}`}
                      >
                        {getDayName(schedule.day_of_week, true)}
                      </span>

                      {schedule.is_active ? (
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <div className="flex items-center gap-1">
                            <Switch
                              id={`all-day-${schedule.day_of_week}`}
                              checked={schedule.is_all_day}
                              onCheckedChange={(checked) =>
                                toggleDayAllDay(schedule.day_of_week, checked)
                              }
                              className="scale-75"
                              disabled={readOnly || bulkUpdate.isPending}
                            />
                            <Label
                              htmlFor={`all-day-${schedule.day_of_week}`}
                              className="cursor-pointer text-[10px] font-light text-[var(--app-text-tertiary)]"
                            >
                              24h
                            </Label>
                          </div>

                          {!schedule.is_all_day ? (
                            <div className="flex min-w-0 flex-1 items-center gap-1">
                              <Select
                                value={isAvailabilityClock(schedule.start_time) ? schedule.start_time : undefined}
                                onValueChange={(value) =>
                                  updateDayTime(
                                    schedule.day_of_week,
                                    "start_time",
                                    value,
                                  )
                                }
                                disabled={readOnly || bulkUpdate.isPending}
                              >
                                <SelectTrigger className="h-8 min-w-0 flex-1 rounded-[6px] border-0 bg-[var(--app-surface-solid)] px-2 text-[12px] font-light text-[var(--app-text-primary)] shadow-none">
                                  <SelectValue placeholder="Revisar horário" />
                                </SelectTrigger>
                                <SelectContent className="app-header-popover rounded-[8px] border-0 p-1">
                                  {availabilityTimeOptions(schedule.start_time).map((time) => (
                                    <SelectItem
                                      key={time}
                                      value={time}
                                      className="rounded-[6px] text-[12px] font-light"
                                    >
                                      {time}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <span className="shrink-0 text-xs text-[var(--app-text-tertiary)]">
                                -
                              </span>
                              <Select
                                value={isAvailabilityClock(schedule.end_time) ? schedule.end_time : undefined}
                                onValueChange={(value) =>
                                  updateDayTime(
                                    schedule.day_of_week,
                                    "end_time",
                                    value,
                                  )
                                }
                                disabled={readOnly || bulkUpdate.isPending}
                              >
                                <SelectTrigger className="h-8 min-w-0 flex-1 rounded-[6px] border-0 bg-[var(--app-surface-solid)] px-2 text-[12px] font-light text-[var(--app-text-primary)] shadow-none">
                                  <SelectValue placeholder="Revisar horário" />
                                </SelectTrigger>
                                <SelectContent className="app-header-popover rounded-[8px] border-0 p-1">
                                  {availabilityTimeOptions(schedule.end_time).map((time) => (
                                    <SelectItem
                                      key={time}
                                      value={time}
                                      className="rounded-[6px] text-[12px] font-light"
                                    >
                                      {time}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          ) : (
                            <div className="flex flex-1 justify-center">
                              <Badge
                                variant="secondary"
                                className="h-5 rounded-[6px] border-0 bg-[var(--app-surface-hover)] px-2 py-0 text-[10px] text-[var(--app-text-primary)]"
                              >
                                Dia inteiro
                              </Badge>
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-[12px] font-light text-[var(--app-text-tertiary)]">
                          Não recebe leads
                        </span>
                      )}

                      {schedule.is_active && !readOnly ? (
                        <button
                          type="button"
                          onClick={() => applyDayToAllDays(schedule.day_of_week)}
                          disabled={bulkUpdate.isPending}
                          className="grid h-7 w-7 shrink-0 place-items-center rounded-[6px] text-[var(--app-text-tertiary)] transition-colors hover:bg-[var(--app-surface-solid)] hover:text-[var(--app-text-primary)]"
                          title={`Aplicar horário de ${getDayName(schedule.day_of_week, true)} a todos os dias ativos`}
                          aria-label={`Aplicar horário de ${getDayName(schedule.day_of_week, true)} a todos os dias ativos`}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <Button
              className={`h-9 rounded-[6px] bg-[var(--app-surface-soft)] text-[12px] font-light text-[var(--app-text-primary)] shadow-none hover:bg-[var(--app-surface-hover)] ${readOnly ? "w-full" : "w-[36%]"}`}
              onClick={() => onOpenChange(false)}
              disabled={bulkUpdate.isPending}
            >
              {readOnly ? "Fechar" : "Cancelar"}
            </Button>
            {!readOnly && (
              <Button
                className="h-9 w-[64%] rounded-[6px] bg-primary/50 text-[12px] font-light text-white shadow-none hover:bg-primary"
                onClick={handleSave}
                disabled={
                  bulkUpdate.isPending ||
                  isLoading ||
                  isError ||
                  baseRevision === null ||
                  hasRevisionConflict ||
                  availabilityQuery.isFetching ||
                  !legacyConfirmed ||
                  !isValidAvailabilityWeek(schedules)
                }
              >
                {bulkUpdate.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Salvar
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
