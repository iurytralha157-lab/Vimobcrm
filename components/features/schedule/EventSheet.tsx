import { useState, useEffect, useMemo, useRef } from "react";
import { format, addMinutes, differenceInMinutes, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Phone, Mail, MessageSquare, X, User, Search, Clock, Plus, Send, Building2,
  Users, CheckCircle, Trash2, Lock, Video, ClipboardList, Home,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { cn, getCurrentTimeForInput, getBrasiliaTime } from "@/lib/utils";
import {
  useCreateScheduleEvent, useUpdateScheduleEvent, useDeleteScheduleEvent,
  EventType, ScheduleEvent, ScheduleEventVisibility,
} from "@/hooks/use-schedule-events";
import { useUsers } from "@/hooks/use-users";
import { useLeads } from "@/hooks/use-leads";
import { useProperties } from "@/hooks/use-properties";
import { useScheduleComments } from "@/hooks/use-schedule-comments";
import { useScheduleEventAssignees } from "@/hooks/use-schedule-event-assignees";
import { useTeams } from "@/hooks/use-teams";
import Link from "next/link";
import { PropertyPickerDialog } from "@/components/features/properties/PropertyPickerDialog";
import { PropertyPreviewDialog } from "@/components/features/properties/PropertyPreviewDialog";

const eventTypes: { type: EventType; label: string; icon: React.ElementType; color: string }[] = [
  { type: "call", label: "Ligação", icon: Phone, color: "#6366f1" },
  { type: "email", label: "E-mail", icon: Mail, color: "#f59e0b" },
  { type: "meeting", label: "Reunião", icon: Video, color: "#8b5cf6" },
  { type: "task", label: "Tarefa", icon: ClipboardList, color: "#f59e0b" },
  { type: "message", label: "Mensagem", icon: MessageSquare, color: "#22c55e" },
  { type: "visit", label: "Visita ao imóvel", icon: Home, color: "#ec4899" },
];

const timeOptions = Array.from({ length: 24 * 4 }, (_, index) => {
  const hours = Math.floor(index / 4);
  const minutes = (index % 4) * 15;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
});

const recurrenceOptions = [
  { value: "none", label: "Não se repete" },
  { value: "weekly", label: "Semanal" },
  { value: "monthly", label: "Mensal" },
  { value: "yearly", label: "Anual" },
] as const;

const visibilityOptions: { value: ScheduleEventVisibility; label: string }[] = [
  { value: "default", label: "Padrão" },
  { value: "public", label: "Público" },
  { value: "private", label: "Particular" },
];

type RecurrenceRule = (typeof recurrenceOptions)[number]["value"];

function isRecurrenceRule(value: string | null | undefined): value is RecurrenceRule {
  return value === "none" || value === "weekly" || value === "monthly" || value === "yearly";
}

const formatPropertyPrice = (value: number | null, tipo: string | null) => {
  if (!value) return "Pre\u00e7o n\u00e3o informado";
  if (tipo === "Aluguel") {
    return `R$ ${value.toLocaleString("pt-BR")}/m\u00eas`;
  }
  return `R$ ${value.toLocaleString("pt-BR")}`;
};

function getNextFutureQuarterHour() {
  const next = getBrasiliaTime();
  const nextQuarter = Math.floor(next.getMinutes() / 15) * 15 + 15;
  next.setMinutes(nextQuarter, 0, 0);
  return next;
}

function getInitialStartDate(defaultDate?: Date) {
  const now = getBrasiliaTime();
  const fallback = getNextFutureQuarterHour();
  if (!defaultDate) return fallback;

  const selected = new Date(defaultDate);
  const hasExplicitTime = selected.getHours() !== 0 || selected.getMinutes() !== 0 || selected.getSeconds() !== 0;

  if (isSameDay(selected, now) && (!hasExplicitTime || selected <= now)) {
    return fallback;
  }

  return selected;
}

interface EventSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event?: ScheduleEvent | null;
  defaultUserId?: string;
  defaultDate?: Date;
  defaultType?: EventType;
  leadId?: string;
  leadName?: string;
}

export function EventSheet({
  open, onOpenChange, event, defaultUserId, defaultDate, defaultType, leadId, leadName,
}: EventSheetProps) {
  const { data: users = [] } = useUsers();
  const { data: teams = [] } = useTeams();
  const createEvent = useCreateScheduleEvent();
  const updateEvent = useUpdateScheduleEvent();
  const deleteEvent = useDeleteScheduleEvent();

  const isExisting = !!event;
  const isCompleted = event?.status === "completed";
  const isMasked = Boolean(event?.is_masked);
  const [isEditing, setIsEditing] = useState(false);
  const locked = isMasked || isCompleted || (isExisting && !isEditing);

  const [selectedType, setSelectedType] = useState<EventType>("task");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [primaryUserId, setPrimaryUserId] = useState("");
  const [visibility, setVisibility] = useState<ScheduleEventVisibility>("default");
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState(30);
  const [isAllDay, setIsAllDay] = useState(false);
  const durationTouched = useRef(false);
  const [recurrenceRule, setRecurrenceRule] = useState<"none" | "weekly" | "monthly" | "yearly">("none");

  const [leadSearch, setLeadSearch] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [selectedLeadName, setSelectedLeadName] = useState<string | null>(null);
  const [showLeadSelector, setShowLeadSelector] = useState(false);
  const { data: searchedLeads = [] } = useLeads({ search: leadSearch, limit: 20 });

  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
  const [selectedPropertyLabel, setSelectedPropertyLabel] = useState<string | null>(null);
  const [propertyPreviewOpen, setPropertyPreviewOpen] = useState(false);
  const { data: allProperties = [] } = useProperties();
  const previewProperty = useMemo(
    () => (selectedPropertyId ? allProperties.find((property) => property.id === selectedPropertyId) || null : null),
    [allProperties, selectedPropertyId],
  );

  const [showAssigneePicker, setShowAssigneePicker] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [pendingAssigneeIds, setPendingAssigneeIds] = useState<string[]>([]);
  const { assignees, addAssignee, removeAssignee } = useScheduleEventAssignees(event?.id);
  const { comments, addComment, isAdding } = useScheduleComments(isMasked ? undefined : event?.id);
  const [commentText, setCommentText] = useState("");

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
    if (event) {
      setIsEditing(false);
      setSelectedType((event.event_type as EventType) || "task");
      setTitle(event.title || "");
      setDescription(event.description || "");
      setLocation(event.location || "");
      setPrimaryUserId(event.user_id || defaultUserId || "");
      setVisibility(event.visibility || "default");
      setDate(event.start_time ? new Date(event.start_time) : getBrasiliaTime());
      setTime(event.start_time ? format(new Date(event.start_time), "HH:mm") : getCurrentTimeForInput());
      setIsAllDay(Boolean(event.is_all_day));
      setSelectedLeadId(event.lead_id || null);
      setSelectedLeadName(event.lead?.name || null);
      setSelectedPropertyId(event.property_id || null);
      setSelectedPropertyLabel(
        event.property
          ? `${event.property.code ? `${event.property.code} · ` : ""}${event.property.title || "Imóvel"}`
          : null
      );
      setRecurrenceRule(isRecurrenceRule(event.recurrence_rule) ? event.recurrence_rule : "none");
      if (event.start_time && event.end_time) {
        const d = differenceInMinutes(new Date(event.end_time), new Date(event.start_time));
        setDuration(d > 0 ? d : 30);
      }
    } else {
      setIsEditing(true);
      setSelectedType(defaultType || "task");
      setTitle("");
      setDescription("");
      setLocation("");
      setPrimaryUserId(defaultUserId || "");
      setVisibility("default");
      const initialStart = getInitialStartDate(defaultDate);
      setDate(initialStart);
      setTime(format(initialStart, "HH:mm"));
      setIsAllDay(false);
      setSelectedLeadId(leadId || null);
      setSelectedLeadName(leadName || null);
      setSelectedPropertyId(null);
      setSelectedPropertyLabel(null);
      setDuration(30);
      setRecurrenceRule("none");
      durationTouched.current = false;
    }
    setSelectedTeamId("");
    setPendingAssigneeIds([]);
    setCommentText("");
    });
  }, [open, event, defaultUserId, defaultDate, defaultType, leadId, leadName]);

  useEffect(() => {
    if (locked || durationTouched.current) return;
    setDuration(selectedType === "visit" || selectedType === "meeting" ? 60 : 30);
  }, [selectedType, locked]);

  const typeConf = eventTypes.find((t) => t.type === selectedType) || eventTypes[3];
  const TypeIcon = typeConf.icon;

  const endTimePreview = useMemo(() => {
    if (!date || !time) return "";
    const [hh, mm] = time.split(":").map(Number);
    if (Number.isNaN(hh) || Number.isNaN(mm)) return "";
    const start = new Date(date);
    start.setHours(hh, mm, 0, 0);
    return format(addMinutes(start, duration), "HH:mm");
  }, [date, time, duration]);

  const handleEndTimeChange = (value: string) => {
    if (!date || !time) return;
    const [startHour, startMinute] = time.split(":").map(Number);
    const [endHour, endMinute] = value.split(":").map(Number);
    if ([startHour, startMinute, endHour, endMinute].some(Number.isNaN)) return;

    const start = new Date(date);
    start.setHours(startHour, startMinute, 0, 0);
    const end = new Date(date);
    end.setHours(endHour, endMinute, 0, 0);
    const nextDuration = differenceInMinutes(end, start);
    setDuration(nextDuration > 0 ? nextDuration : nextDuration + 24 * 60);
    durationTouched.current = true;
  };

  const allAssignees = useMemo(() => {
    if (isMasked) return [];

    const list: { id: string; name: string; avatar_url: string | null; primary: boolean; pending?: boolean }[] = [];
    const primary = users.find((u) => u.id === primaryUserId);
    if (primary) list.push({ ...primary, primary: true });

    assignees.forEach((a) => {
      if (a.id !== primaryUserId) list.push({ ...a, primary: false });
    });

    pendingAssigneeIds.forEach((id) => {
      const u = users.find((user) => user.id === id);
      if (u && !list.some((item) => item.id === u.id)) {
        list.push({ ...u, primary: false, pending: true });
      }
    });

    return list;
  }, [isMasked, users, primaryUserId, assignees, pendingAssigneeIds]);

  const availableUsers = users.filter(
    (u) => u.id !== primaryUserId && !assignees.some((a) => a.id === u.id) && !pendingAssigneeIds.includes(u.id),
  );

  const handleTeamSelect = (teamId: string) => {
    setSelectedTeamId(teamId);
    const team = teams.find((item) => item.id === teamId);
    if (!team) return;

    const memberIds = (team.members || [])
      .map((member) => member.user?.id || member.user_id)
      .filter((id): id is string => Boolean(id));

    const nextPending = memberIds.filter(
      (id) => id !== primaryUserId && !assignees.some((assignee) => assignee.id === id) && !pendingAssigneeIds.includes(id),
    );

    if (!primaryUserId && memberIds[0]) {
      setPrimaryUserId(memberIds[0]);
    }
    if (nextPending.length > 0) {
      setPendingAssigneeIds((prev) => Array.from(new Set([...prev, ...nextPending])));
    }
  };

  const handleSubmit = async () => {
    if (isMasked) return;
    if (!title.trim() || !date || !primaryUserId) return;
    const [hh, mm] = time.split(":").map(Number);
    const start = new Date(date);
    if (isAllDay) {
      start.setHours(0, 0, 0, 0);
    } else {
      start.setHours(hh, mm, 0, 0);
    }
    const end = isAllDay ? new Date(start) : addMinutes(start, duration);
    if (isAllDay) {
      end.setHours(23, 59, 59, 999);
    }

    const basePayload = {
      title: title.trim(),
      description: description.trim() || undefined,
      event_type: selectedType,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      is_all_day: isAllDay,
      user_id: primaryUserId,
      lead_id: selectedLeadId || undefined,
      property_id: selectedPropertyId,
      location: location.trim() || undefined,
      visibility,
    };

    if (event) {
      await updateEvent.mutateAsync({ id: event.id, ...basePayload });
    } else {
      await createEvent.mutateAsync({
        ...basePayload,
        recurrence_rule: recurrenceRule,
        assignee_ids: pendingAssigneeIds,
      });
    }
    onOpenChange(false);
  };

  const handleMarkDone = async () => {
    if (!event || isMasked) return;
    await updateEvent.mutateAsync({ id: event.id, status: "completed" });
    onOpenChange(false);
  };

  const handleDelete = async () => {
    if (!event || isMasked) return;
    await deleteEvent.mutateAsync({ id: event.id });
    onOpenChange(false);
  };

  const handleSendComment = () => {
    if (isMasked || !commentText.trim() || isAdding) return;
    addComment(commentText.trim());
    setCommentText("");
  };

  const isLoading = createEvent.isPending || updateEvent.isPending || deleteEvent.isPending;
  const canSubmit = !locked && title.trim() && date && primaryUserId;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        overlayClassName="bg-black/35"
        className="!h-auto !w-[calc(100vw-24px)] !max-w-[560px] flex max-h-[78vh] flex-col overflow-hidden rounded-[24px] border-0 bg-[#090909]/78 p-0 text-white shadow-[0_24px_80px_rgba(0,0,0,0.62)] backdrop-blur-2xl [&>button.absolute.right-4.top-4]:hidden sm:inset-y-auto sm:right-auto sm:left-1/2 sm:top-1/2 sm:!w-[min(560px,calc(100vw-40px))] sm:!-translate-x-1/2 sm:!-translate-y-1/2 sm:!max-w-[560px]"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>{isExisting ? "Detalhes da atividade" : "Nova atividade"}</SheetTitle>
        </SheetHeader>

        <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-6 pb-1 pt-4 sm:grid-cols-[minmax(0,1fr)_158px_auto] sm:px-8">
          {locked ? (
            <h2 className="min-h-9 rounded-lg bg-[#202020] px-4 py-2 text-sm font-medium leading-tight text-zinc-100">{title || "Sem titulo"}</h2>
          ) : (
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Adicionar titulo"
              className="h-9 rounded-lg border-0 bg-[#202020] px-4 text-sm font-medium text-white shadow-none focus-visible:ring-0 placeholder:text-zinc-500"
            />
          )}
          <div className="col-span-2 min-w-0 sm:col-span-1">
            {locked ? (
              <FieldPill className="h-9 w-full justify-center px-3 text-xs">
                <TypeIcon className="h-3.5 w-3.5" />
                {typeConf.label}
              </FieldPill>
            ) : (
              <Select value={selectedType} onValueChange={(value: EventType) => setSelectedType(value)}>
                <SelectTrigger className="h-9 w-full border-0 bg-[#202020] px-3 text-xs font-semibold leading-none text-zinc-100 shadow-none focus:ring-0 [&>span]:!flex [&>span]:items-center [&>span]:gap-2 [&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:text-zinc-400">
                  <span className="min-w-0">
                    <TypeIcon className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                    <span className="truncate">{typeConf.label}</span>
                  </span>
                </SelectTrigger>
                <SelectContent className="border-white/10 bg-[#202020] text-zinc-100">
                  {eventTypes.map(({ type, label, icon: Icon }) => (
                    <SelectItem key={type} value={type}>
                      <span className="inline-flex items-center gap-2">
                        <Icon className="h-4 w-4" />
                        {label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="row-start-1 shrink-0 rounded-full p-1.5 text-zinc-400 transition hover:bg-white/10 hover:text-white sm:col-start-3"
            aria-label="Fechar"
          >
            <X size={22} strokeWidth={1.7} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:px-8">
          <div className="hidden">
            {locked ? (
              <h2 className="border-b border-primary/70 pb-2 text-[22px] font-normal leading-tight">{title || "Sem título"}</h2>
            ) : (
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Adicionar título"
                className="h-10 rounded-lg border-0 bg-[#202020] px-4 text-base font-medium text-white shadow-none focus-visible:ring-1 focus-visible:ring-primary/70 placeholder:text-zinc-500"
              />
            )}
          </div>

          <div className="hidden">
            <button
              type="button"
              disabled={locked}
              onClick={() => selectedType === "task" && setSelectedType("meeting")}
              className={cn(
                "h-9 rounded-lg px-3 text-sm font-semibold transition",
                selectedType !== "task" ? "bg-sky-700 text-white" : "bg-white/5 text-zinc-300 hover:bg-white/10",
              )}
            >
              Evento
            </button>
            <button
              type="button"
              disabled={locked}
              onClick={() => setSelectedType("task")}
              className={cn(
                "h-9 rounded-lg px-3 text-sm font-semibold transition",
                selectedType === "task" ? "bg-sky-700 text-white" : "bg-white/5 text-zinc-300 hover:bg-white/10",
              )}
            >
              Tarefa
            </button>
            <button
              type="button"
              disabled
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-white/5 px-3 text-sm font-semibold text-zinc-300 opacity-80"
            >
              Agendamento de horários
              <span className="rounded-full bg-blue-300/20 px-1.5 py-0.5 text-[10px] font-bold text-blue-200">Novo</span>
            </button>

            {!locked && (
              <Select value={selectedType} onValueChange={(value: EventType) => setSelectedType(value)}>
                <SelectTrigger className="h-9 w-[150px] border-0 bg-white/10 text-sm text-white">
                  <TypeIcon className="mr-2 h-4 w-4" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {eventTypes.map(({ type, label }) => (
                    <SelectItem key={type} value={type}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {isCompleted && (
            <AgendaRow icon={<Lock size={18} />} align="center">
              <span className="inline-flex h-8 items-center rounded-lg bg-emerald-500/15 px-3 text-sm font-semibold text-emerald-300">Atividade concluída, somente leitura</span>
            </AgendaRow>
          )}

          {isMasked && (
            <AgendaRow icon={<Lock size={18} />} align="center">
              <span className="inline-flex h-8 items-center rounded-lg bg-white/10 px-3 text-sm font-semibold text-zinc-300">Informacoes privadas</span>
            </AgendaRow>
          )}

          <AgendaRow icon={<Clock size={19} />} align={locked ? "center" : "start"}>
            {locked ? (
              <div className="text-sm font-semibold text-zinc-100">
                {date ? format(date, "EEEE, dd 'de' MMMM", { locale: ptBR }) : "-"} · {time} - {endTimePreview || "-"}
              </div>
            ) : (
              <div className="space-y-1">
                <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_76px_12px_76px]">
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="min-h-10 rounded-none bg-transparent px-0 text-left text-base font-medium leading-tight text-zinc-200 transition hover:text-primary focus-visible:text-primary active:text-primary"
                      >
                        {date ? format(date, "EEEE, dd 'de' MMMM", { locale: ptBR }) : "Selecionar data"}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={date} onSelect={setDate} locale={ptBR} />
                    </PopoverContent>
                  </Popover>
                  <TimePicker value={time} onChange={setTime} disabled={isAllDay} />
                  <span className="hidden text-center text-zinc-400 sm:block">-</span>
                  <TimePicker value={endTimePreview || time} onChange={handleEndTimeChange} disabled={isAllDay} />
                </div>

                <div className="flex flex-wrap items-center gap-3 pl-0.5 text-xs text-zinc-500">
                  <label className="inline-flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={isAllDay}
                      onChange={(event) => setIsAllDay(event.target.checked)}
                      className="h-4 w-4 rounded-sm bg-transparent accent-primary"
                    />
                    Dia inteiro
                  </label>
                  <Select
                    value={recurrenceRule}
                    onValueChange={(value) => {
                      if (isRecurrenceRule(value)) setRecurrenceRule(value);
                    }}
                  >
                    <SelectTrigger className="h-6 w-[126px] border-0 bg-transparent px-0 text-xs text-zinc-500 shadow-none hover:text-zinc-300 focus:ring-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {recurrenceOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </AgendaRow>

          <AgendaRow icon={<Users size={18} />} label="Responsáveis" inline>
            <div className="flex min-h-10 flex-wrap items-center gap-2">
              {isMasked ? (
                <span className="text-sm text-zinc-400">Informacao privada</span>
              ) : allAssignees.length > 0 ? (
                allAssignees.map((a) => (
                  <div key={a.id} className="group relative">
                    <Avatar className="h-8 w-8" title={a.name}>
                      <AvatarImage src={a.avatar_url || undefined} />
                      <AvatarFallback className="bg-primary/20 text-[10px] font-bold text-primary">
                        {a.name.split(" ").slice(0, 2).map((p) => p[0]).join("").toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    {!locked && !a.primary && (
                      <button
                        onClick={() => {
                          if (a.pending) setPendingAssigneeIds((prev) => prev.filter((id) => id !== a.id));
                          else removeAssignee(a.id);
                        }}
                        className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground opacity-0 transition-opacity group-hover:opacity-100"
                        aria-label="Remover responsável"
                      >
                        <X size={8} strokeWidth={3} />
                      </button>
                    )}
                  </div>
                ))
              ) : (
                <span className="text-sm text-zinc-400">Adicionar convidados</span>
              )}
              {!locked && availableUsers.length > 0 && (
                <Popover open={showAssigneePicker} onOpenChange={setShowAssigneePicker}>
                  <PopoverTrigger asChild>
                      <button type="button" className="flex h-8 w-8 items-center justify-center rounded-full bg-[#202020] text-zinc-300 transition hover:bg-[#2a2a2a] hover:text-primary">
                      <Plus size={14} />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[260px] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Adicionar responsável..." />
                      <CommandList>
                        <CommandEmpty>Sem usuários disponíveis.</CommandEmpty>
                        <CommandGroup>
                          {availableUsers.map((u) => (
                            <CommandItem
                              key={u.id}
                              onSelect={() => {
                                if (isExisting) addAssignee(u.id);
                                else if (!primaryUserId) setPrimaryUserId(u.id);
                                else if (!pendingAssigneeIds.includes(u.id)) setPendingAssigneeIds((prev) => [...prev, u.id]);
                                setShowAssigneePicker(false);
                              }}
                            >
                              <Avatar className="mr-2 h-5 w-5">
                                <AvatarImage src={u.avatar_url || undefined} />
                                <AvatarFallback className="text-[10px]">{u.name.split(" ").slice(0, 2).map((p) => p[0]).join("")}</AvatarFallback>
                              </Avatar>
                              <span className="text-sm">{u.name}</span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              )}
              {!locked && teams.length > 0 && (
                <Select value={selectedTeamId} onValueChange={handleTeamSelect}>
                  <SelectTrigger className="h-8 w-[132px] border-0 bg-[#202020] px-3 text-xs text-zinc-300 shadow-none focus:ring-0">
                    <SelectValue placeholder="Equipe" />
                  </SelectTrigger>
                  <SelectContent className="border-white/10 bg-[#202020] text-zinc-100">
                    {teams.map((team) => (
                      <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            {!locked && !primaryUserId && (
              <Select value={primaryUserId} onValueChange={setPrimaryUserId}>
                <SelectTrigger className="mt-2 h-10 border-0 bg-[#202020] text-sm text-white">
                  <SelectValue placeholder="Responsável principal..." />
                </SelectTrigger>
              <SelectContent>{users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent>
            </Select>
          )}
        </AgendaRow>

          <AgendaRow icon={<Lock size={18} />} label="Visibilidade" inline>
            {locked ? (
              <FieldPill className="h-9 px-3 text-xs">
                {visibilityOptions.find((option) => option.value === visibility)?.label || "Padrão"}
              </FieldPill>
            ) : (
              <div className="inline-flex h-9 rounded-lg bg-[#202020] p-1">
                {visibilityOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setVisibility(option.value)}
                    className={cn(
                      "rounded-md px-3 text-xs font-semibold transition",
                      visibility === option.value
                        ? "bg-primary text-primary-foreground"
                        : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100",
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </AgendaRow>

          <AgendaRow icon={<User size={18} />} label="Lead/cliente" inline>
            {selectedLeadId ? (
              <div className="flex items-center justify-between gap-2">
                {isExisting ? (
                  <Link href={`/crm/pipelines?lead=${selectedLeadId}`} className="truncate text-sm font-medium text-primary hover:text-primary/80">
                    {selectedLeadName || "Lead vinculado"}
                  </Link>
                ) : (
                  <span className="truncate text-sm text-zinc-100">{selectedLeadName}</span>
                )}
                {!locked && (
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => { setSelectedLeadId(null); setSelectedLeadName(null); }}>
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
            ) : !locked ? (
              <Popover open={showLeadSelector} onOpenChange={setShowLeadSelector}>
                <PopoverTrigger asChild>
                  <button type="button" className="inline-flex h-10 w-full items-center gap-2 rounded-lg bg-[#202020] px-4 text-left text-sm text-zinc-400 hover:text-white">
                    <Search className="h-4 w-4" />
                    Buscar por nome, tel...
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-[360px] p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput placeholder="Buscar por nome, telefone ou e-mail..." value={leadSearch} onValueChange={setLeadSearch} />
                    <CommandList>
                      <CommandEmpty>Nenhum lead encontrado.</CommandEmpty>
                      <CommandGroup>
                        {searchedLeads.map((l) => (
                          <CommandItem
                            key={l.id}
                            value={l.id}
                            onSelect={() => {
                              setSelectedLeadId(l.id);
                              setSelectedLeadName(l.name);
                              setShowLeadSelector(false);
                              setLeadSearch("");
                            }}
                          >
                            <User className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <div className="flex min-w-0 flex-col">
                              <span className="truncate text-sm font-medium">{l.name}</span>
                              <span className="truncate text-[10px] text-muted-foreground">{[l.phone, l.email].filter(Boolean).join(" · ") || "Sem contato"}</span>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            ) : (
              <span className="text-sm text-zinc-400">{isMasked ? "Informacao privada" : "Sem lead"}</span>
            )}
          </AgendaRow>

          <AgendaRow icon={<Building2 size={18} />} label="Imóvel vinculado" inline>
            {selectedPropertyId ? (
              <div className="flex items-center justify-between gap-2">
                <button type="button" onClick={() => setPropertyPreviewOpen(true)} className="truncate text-left text-sm font-medium text-primary hover:text-primary/80">
                  {selectedPropertyLabel || "Imóvel selecionado"}
                </button>
                {!locked && (
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => { setSelectedPropertyId(null); setSelectedPropertyLabel(null); }}>
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
            ) : !locked ? (
              <PropertyPickerDialog
                properties={allProperties}
                selectedPropertyId={selectedPropertyId}
                onSelect={(p) => {
                  setSelectedPropertyId(p.id);
                  setSelectedPropertyLabel(`${p.code ? `${p.code} · ` : ""}${p.title || "Imóvel"}`);
                }}
                trigger={(
                  <button type="button" className="inline-flex h-10 w-full items-center gap-2 rounded-lg bg-[#202020] px-4 text-left text-sm text-zinc-400 hover:text-white">
                    <Search className="h-4 w-4" />
                    Buscar imóvel
                  </button>
                )}
              />
            ) : (
              <span className="text-sm text-zinc-400">{isMasked ? "Informacao privada" : "Sem imóvel"}</span>
            )}
          </AgendaRow>

          <AgendaRow icon={<MessageSquare size={19} />}>
            {locked ? (
              <p className="text-sm text-zinc-300">{description || (isMasked ? "Informacao privada" : "Sem descrição")}</p>
            ) : (
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Adicione observações"
                rows={4}
                className="min-h-[132px] resize-none rounded-lg border-0 bg-[#202020] px-4 py-3 text-sm text-white shadow-none focus-visible:ring-0 placeholder:text-zinc-500"
              />
            )}
          </AgendaRow>

          <div className="hidden">
            <span className="text-sm font-medium text-blue-300">Adicionar um anexo</span>
          </div>

          <div className="hidden">
            <div className="flex flex-wrap gap-2">
              <Select value={primaryUserId} onValueChange={setPrimaryUserId} disabled={locked}>
                <SelectTrigger className="h-10 w-[150px] border-0 bg-white/10 text-sm text-white">
                  <SelectValue placeholder="Responsável" />
                </SelectTrigger>
                <SelectContent>{users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent>
              </Select>
              <button
                type="button"
                className="flex h-10 items-center gap-2 rounded-md bg-white/10 px-4 text-sm text-white"
                disabled={locked}
              >
                <span className="h-4 w-4 rounded-full" style={{ background: typeConf.color }} />
              </button>
            </div>
          </div>

          {isExisting && (
            <AgendaRow icon={<MessageSquare size={19} />}>
              <div className="space-y-3">
                {isMasked ? (
                  <p className="text-sm text-zinc-400">Comentarios privados</p>
                ) : (
                  <>
                    {comments.length === 0 && <p className="text-sm text-zinc-400">Nenhum comentário</p>}
                    {comments.map((c) => (
                      <div key={c.id} className="flex gap-2">
                        <Avatar className="h-6 w-6 shrink-0">
                          <AvatarImage src={c.user?.avatar_url || undefined} />
                          <AvatarFallback className="text-[10px]">{(c.user?.name || "U").split(" ").slice(0, 2).map((p) => p[0]).join("")}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="mb-0.5 text-[10px] text-zinc-400">
                            <span className="font-medium text-zinc-100">{c.user?.name || "Usuário"}</span>
                            {" · "}{format(new Date(c.created_at), "dd/MM HH:mm", { locale: ptBR })}
                          </div>
                          <div className="rounded-lg bg-white/10 px-2.5 py-1.5 text-xs text-zinc-100">{c.content}</div>
                        </div>
                      </div>
                    ))}
                    <div className="flex gap-2">
                      <Input
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSendComment()}
                        placeholder="Comentário..."
                        className="h-9 border-0 bg-white/10 text-xs text-white"
                        disabled={isAdding}
                      />
                      <Button size="icon" onClick={handleSendComment} disabled={isAdding || !commentText.trim()} className="h-9 w-9 shrink-0">
                        <Send size={13} />
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </AgendaRow>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 px-5 py-4">
          {isExisting && !isMasked ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 hover:text-white">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Excluir atividade?</AlertDialogTitle>
                  <AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Excluir</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : (
            <span />
          )}

          <div className="ml-auto flex flex-1 flex-wrap items-center justify-end gap-2">
            {isExisting && !isMasked && !isCompleted && (
              <Button variant="ghost" size="sm" onClick={handleMarkDone} disabled={isLoading} className="gap-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 hover:text-white">
                <CheckCircle size={13} /> Concluir
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => (isExisting && !isMasked ? setIsEditing((value) => !value) : onOpenChange(false))} disabled={isLoading || isCompleted} className={cn("rounded-lg font-semibold", !locked ? "order-1 h-11 flex-[3] bg-[#202020] text-zinc-100 hover:bg-[#2a2a2a] hover:text-white" : "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground")}>
              {isExisting && !isMasked && !isEditing ? "Editar" : "Cancelar"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => (isExisting ? setIsEditing(true) : onOpenChange(false))} disabled={isLoading || isCompleted} className="hidden">
              Mais opções
            </Button>
            {!locked && (
              <Button size="sm" onClick={handleSubmit} disabled={!canSubmit || isLoading} className="order-2 h-11 flex-[7] rounded-lg bg-primary px-7 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
                {isLoading ? "Salvando..." : isExisting ? "Salvar" : "Adicionar"}
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
      </Sheet>
      <PropertyPreviewDialog
        property={previewProperty}
        open={propertyPreviewOpen}
        onOpenChange={setPropertyPreviewOpen}
        formatPrice={formatPropertyPrice}
      />
    </>
  );
}

function AgendaRow({
  icon,
  label,
  children,
  className,
  inline = false,
  align = "start",
}: {
  icon: React.ReactNode;
  label?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  inline?: boolean;
  align?: "start" | "center";
}) {
  if (inline) {
    return (
      <div className={cn("grid grid-cols-[28px_104px_minmax(0,1fr)] items-center gap-2 py-1.5 sm:grid-cols-[30px_124px_minmax(0,1fr)]", className)}>
        <div className="flex justify-center text-zinc-400">{icon}</div>
        <div className="min-w-0 text-sm font-medium text-zinc-400">{label}</div>
        <div className="min-w-0">{children}</div>
      </div>
    );
  }

  return (
    <div className={cn("grid grid-cols-[30px_1fr] gap-3", align === "center" ? "items-center py-1.5" : "items-start py-2", className)}>
      <div className={cn("flex justify-center text-zinc-400", align === "start" && "pt-2")}>{icon}</div>
      <div className="min-w-0">
        {label && <div className="mb-1.5 text-sm font-medium text-zinc-400">{label}</div>}
        {children}
      </div>
    </div>
  );
}

function FieldPill({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("inline-flex h-10 items-center gap-2 rounded-lg bg-[#202020] px-4 text-sm text-zinc-200", className)}>
      {children}
    </div>
  );
}

function TimePicker({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="inline-flex h-10 min-w-[76px] items-center justify-center rounded-lg bg-[#202020] px-3 text-sm font-semibold text-zinc-100 transition hover:bg-[#2a2a2a] disabled:opacity-50"
        >
          {value || "--:--"}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[190px] border-0 bg-[#202020] p-2 text-zinc-100 shadow-2xl" align="center">
        <Input
          type="time"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="mb-2 h-9 border-0 bg-[#303030] text-sm text-white focus-visible:ring-0"
        />
        <div className="grid max-h-[190px] grid-cols-2 gap-1 overflow-y-auto pr-1">
          {timeOptions.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onChange(option)}
              className={cn(
                "rounded-md px-2 py-1.5 text-sm transition hover:bg-primary/80 hover:text-primary-foreground",
                option === value ? "bg-primary text-primary-foreground" : "bg-white/5 text-zinc-200",
              )}
            >
              {option}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
