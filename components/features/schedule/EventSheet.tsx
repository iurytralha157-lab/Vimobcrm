import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { format, differenceInMinutes, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Phone,
  Mail,
  MessageSquare,
  X,
  User,
  Search,
  Clock,
  Plus,
  Send,
  Building2,
  Users,
  CheckCircle,
  Trash2,
  Lock,
  Video,
  ClipboardList,
  Home,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn, getCurrentTimeForInput, getBrasiliaTime } from "@/lib/utils";
import { commandSearchFilter } from "@/lib/search-text";
import {
  useCreateScheduleEvent,
  useUpdateScheduleEvent,
  useDeleteScheduleEvent,
  EventType,
  ScheduleEvent,
  ScheduleEventVisibility,
} from "@/hooks/use-schedule-events";
import { useScheduleUsers } from "@/hooks/use-schedule-users";
import { useLeads } from "@/hooks/use-leads";
import { useProperties } from "@/hooks/use-properties";
import { useScheduleComments } from "@/hooks/use-schedule-comments";
import { useScheduleEventAssignees } from "@/hooks/use-schedule-event-assignees";
import { useTeams } from "@/hooks/use-teams";
import Link from "next/link";
import { PropertyPickerDialog } from "@/components/features/properties/PropertyPickerDialog";
import { PropertyPreviewDialog } from "@/components/features/properties/PropertyPreviewDialog";
import { useOrganizationModules } from "@/hooks/use-organization-modules";
import { useUserPermissions } from "@/hooks/use-user-permissions";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { scheduleClockInputSchema } from "@/lib/validation/schedule";
import { buildScheduleEventInterval } from "@/lib/schedule-event-draft";

const eventTypes: {
  type: EventType;
  label: string;
  icon: React.ElementType;
}[] = [
  { type: "call", label: "Ligação", icon: Phone },
  { type: "email", label: "E-mail", icon: Mail },
  { type: "meeting", label: "Reunião", icon: Video },
  { type: "task", label: "Tarefa", icon: ClipboardList },
  { type: "message", label: "Mensagem", icon: MessageSquare },
  { type: "visit", label: "Visita ao imóvel", icon: Home },
];

const timeOptions = Array.from({ length: 24 * 4 }, (_, index) => {
  const hours = Math.floor(index / 4);
  const minutes = (index % 4) * 15;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
});

const recurrenceOptions = [
  { value: "none", label: "Não se repete" },
  { value: "daily", label: "Diariamente" },
  { value: "weekly", label: "Semanal" },
  { value: "monthly", label: "Mensal" },
  { value: "yearly", label: "Anual" },
] as const;

const visibilityOptions: {
  value: ScheduleEventVisibility;
  label: string;
  description: string;
}[] = [
  {
    value: "default",
    label: "Padrão",
    description: "Quem não participa vê somente que o horário está ocupado.",
  },
  {
    value: "public",
    label: "Público",
    description: "Quem tem acesso à agenda vê os detalhes permitidos.",
  },
  {
    value: "private",
    label: "Privado",
    description: "Somente responsáveis e administradores veem o evento.",
  },
];

type RecurrenceRule = (typeof recurrenceOptions)[number]["value"];

const recurrenceLimitLabels: Partial<Record<RecurrenceRule, string>> = {
  daily: "Próximos 90 dias",
  weekly: "Próximas 52 semanas",
  monthly: "Próximos 24 meses",
  yearly: "Próximos 5 anos",
};

const agendaFieldClass =
  "rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] font-light text-[var(--app-text-primary)] shadow-none outline-none ring-0 placeholder:font-light placeholder:text-[var(--app-text-tertiary)] focus-visible:ring-1 focus-visible:ring-primary/30 focus-visible:ring-offset-0";
const agendaControlClass =
  "rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] font-light text-[var(--app-text-primary)] shadow-none outline-none ring-0 transition-colors hover:bg-[var(--app-surface-hover)] focus:ring-0 focus-visible:ring-1 focus-visible:ring-primary/30";
const agendaMutedTextClass = "text-[var(--app-text-tertiary)]";
const agendaPopoverClass =
  "app-header-popover rounded-[8px] border-0 bg-[var(--app-surface-solid)] text-[12px] font-light text-[var(--app-text-primary)] [&_[role=option]]:rounded-[6px] [&_[role=option]]:text-[12px] [&_[role=option]]:font-light";

function isRecurrenceRule(
  value: string | null | undefined,
): value is RecurrenceRule {
  return (
    value === "none" ||
    value === "daily" ||
    value === "weekly" ||
    value === "monthly" ||
    value === "yearly"
  );
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

function formatScheduleTimestamp(value: string | null | undefined) {
  if (!value) return 'Data indisponível';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Data indisponível'
    : format(date, 'dd/MM HH:mm', { locale: ptBR });
}

function getInitialStartDate(defaultDate?: Date) {
  const now = getBrasiliaTime();
  const fallback = getNextFutureQuarterHour();
  if (!defaultDate) return fallback;

  const selected = new Date(defaultDate);
  if (Number.isNaN(selected.getTime())) return fallback;
  const hasExplicitTime =
    selected.getHours() !== 0 ||
    selected.getMinutes() !== 0 ||
    selected.getSeconds() !== 0;

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
  open,
  onOpenChange,
  event,
  defaultUserId,
  defaultDate,
  defaultType,
  leadId,
  leadName,
}: EventSheetProps) {
  const { hasPermission } = useUserPermissions();
  const { hasModule } = useOrganizationModules();
  const hasAgendaModule = hasModule("agenda");
  const canManageSchedule =
    hasAgendaModule && hasPermission("schedule_manage");
  const canViewProperties =
    hasModule("properties") &&
    (hasPermission("property_view") || hasPermission("property_manage"));
  const isExisting = !!event;
  const isCompleted = event?.status === "completed";
  const isMasked = Boolean(event?.is_masked);
  const [isEditing, setIsEditing] = useState(false);
  const { data: users = [] } = useScheduleUsers({
    enabled: open && hasAgendaModule,
  });
  const { data: teams = [] } = useTeams({
    enabled: open && canManageSchedule && !isMasked && isEditing,
  });
  const createEvent = useCreateScheduleEvent();
  const updateEvent = useUpdateScheduleEvent();
  const deleteEvent = useDeleteScheduleEvent();

  const locked =
    !canManageSchedule || isMasked || isCompleted || (isExisting && !isEditing);

  const [selectedType, setSelectedType] = useState<EventType>("task");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [primaryUserId, setPrimaryUserId] = useState("");
  const [visibility, setVisibility] =
    useState<ScheduleEventVisibility>("default");
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState(30);
  const [isAllDay, setIsAllDay] = useState(false);
  const durationTouched = useRef(false);
  const [recurrenceRule, setRecurrenceRule] = useState<RecurrenceRule>("none");

  const [leadSearch, setLeadSearch] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [selectedLeadName, setSelectedLeadName] = useState<string | null>(null);
  const [showLeadSelector, setShowLeadSelector] = useState(false);
  const { data: searchedLeads = [] } = useLeads(
    { search: leadSearch, limit: 20 },
    { enabled: open && hasAgendaModule && showLeadSelector },
  );

  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(
    null,
  );
  const [selectedPropertyLabel, setSelectedPropertyLabel] = useState<
    string | null
  >(null);
  const [propertyPreviewOpen, setPropertyPreviewOpen] = useState(false);
  const [propertyPickerOpen, setPropertyPickerOpen] = useState(false);
  const [propertySearch, setPropertySearch] = useState("");
  const deferredPropertySearch = useDebouncedValue(propertySearch.trim(), 300);
  const {
    data: allProperties = [],
    isLoading: propertiesInitialLoading,
    isFetching: propertiesFetching,
  } = useProperties(
    deferredPropertySearch,
    {},
    {
      enabled:
        hasAgendaModule &&
        canViewProperties &&
        (propertyPickerOpen || propertyPreviewOpen),
      limit: 50,
    },
  );
  const propertiesLoading = propertiesInitialLoading || propertiesFetching;
  const previewProperty = useMemo(
    () =>
      selectedPropertyId
        ? allProperties.find(
            (property) => property.id === selectedPropertyId,
          ) || null
        : null,
    [allProperties, selectedPropertyId],
  );

  const [showAssigneePicker, setShowAssigneePicker] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [draftAssigneeIds, setDraftAssigneeIds] = useState<string[]>([]);
  const [assigneeDraftReady, setAssigneeDraftReady] = useState(true);
  const assigneeFallbackHydratedForEvent = useRef<string | null>(null);
  const {
    assignees,
    isLoading: assigneesLoading,
    isFetching: assigneesFetching,
    isError: assigneesError,
    refetch: refetchAssignees,
  } = useScheduleEventAssignees(
    open && hasAgendaModule ? event?.id : undefined,
  );
  const { comments, addComment, isAdding } = useScheduleComments(
    open && hasAgendaModule && !isMasked ? event?.id : undefined,
  );
  const [commentText, setCommentText] = useState("");

  const assignableUserIds = useMemo(
    () => new Set(users.map((user) => user.id)),
    [users],
  );
  const assignableTeams = useMemo(
    () =>
      teams
        .map((team) => ({
          ...team,
          members: (team.members || []).filter((member) =>
            assignableUserIds.has(member.user?.id || member.user_id),
          ),
        }))
        .filter((team) => team.members.length > 0),
    [assignableUserIds, teams],
  );

  useEffect(() => {
    if (open && !hasAgendaModule) onOpenChange(false);
  }, [hasAgendaModule, onOpenChange, open]);

  const resetDraft = useCallback(() => {
    if (event) {
      const parsedStartDate = event.start_time
        ? new Date(event.start_time)
        : getBrasiliaTime();
      const safeStartDate = Number.isNaN(parsedStartDate.getTime())
        ? getBrasiliaTime()
        : parsedStartDate;
      let nextDuration =
        event.event_type === "visit" || event.event_type === "meeting"
          ? 60
          : 30;
      if (event.start_time && event.end_time) {
        const parsedEndDate = new Date(event.end_time);
        if (!Number.isNaN(parsedEndDate.getTime())) {
          const parsedDuration = differenceInMinutes(
            parsedEndDate,
            safeStartDate,
          );
          if (parsedDuration > 0) nextDuration = parsedDuration;
        }
      }
      setIsEditing(false);
      setSelectedType((event.event_type as EventType) || "task");
      setTitle(event.title || "");
      setDescription(event.description || "");
      setLocation(event.location || "");
      setPrimaryUserId(event.user_id || defaultUserId || "");
      setVisibility(event.visibility || "default");
      setDate(safeStartDate);
      setTime(
        event.start_time
          ? format(safeStartDate, "HH:mm")
          : getCurrentTimeForInput(),
      );
      setIsAllDay(Boolean(event.is_all_day));
      setSelectedLeadId(event.lead_id || null);
      setSelectedLeadName(event.lead?.name || null);
      setSelectedPropertyId(event.property_id || null);
      setSelectedPropertyLabel(
        event.property
          ? `${event.property.code ? `${event.property.code} · ` : ""}${event.property.title || "Imóvel"}`
          : null,
      );
      setRecurrenceRule(
        isRecurrenceRule(event.recurrence_rule)
          ? event.recurrence_rule
          : "none",
      );
      setDuration(nextDuration);
      const embeddedAssigneeIds = event.assignee_user_ids;
      const hasEmbeddedAssignees = Array.isArray(embeddedAssigneeIds);
      setDraftAssigneeIds(
        hasEmbeddedAssignees
          ? embeddedAssigneeIds.filter((userId) => userId !== event.user_id)
          : [],
      );
      setAssigneeDraftReady(hasEmbeddedAssignees);
      assigneeFallbackHydratedForEvent.current = hasEmbeddedAssignees
        ? event.id
        : null;
      durationTouched.current = false;
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
      setDraftAssigneeIds([]);
      setAssigneeDraftReady(true);
      assigneeFallbackHydratedForEvent.current = null;
      durationTouched.current = false;
    }
    setSelectedTeamId("");
    setCommentText("");
    setLeadSearch("");
    setPropertySearch("");
    setShowLeadSelector(false);
    setShowAssigneePicker(false);
    setPropertyPickerOpen(false);
  }, [
    defaultDate,
    defaultType,
    defaultUserId,
    event,
    leadId,
    leadName,
  ]);

  useEffect(() => {
    if (!open || !hasAgendaModule) return;
    queueMicrotask(resetDraft);
  }, [hasAgendaModule, open, resetDraft]);

  useEffect(() => {
    if (
      !open ||
      !event ||
      Array.isArray(event.assignee_user_ids) ||
      assigneeDraftReady ||
      assigneesLoading ||
      assigneesFetching ||
      assigneesError ||
      assigneeFallbackHydratedForEvent.current === event.id
    ) {
      return;
    }

    queueMicrotask(() => {
      setDraftAssigneeIds(
        assignees
          .map((assignee) => assignee.id)
          .filter((userId) => userId !== event.user_id),
      );
      setAssigneeDraftReady(true);
      assigneeFallbackHydratedForEvent.current = event.id;
    });
  }, [
    assignees,
    assigneeDraftReady,
    assigneesError,
    assigneesFetching,
    assigneesLoading,
    event,
    open,
  ]);

  useEffect(() => {
    if (locked || durationTouched.current) return;
    setDuration(
      selectedType === "visit" || selectedType === "meeting" ? 60 : 30,
    );
  }, [selectedType, locked]);

  const typeConf =
    eventTypes.find((t) => t.type === selectedType) || eventTypes[3];
  const TypeIcon = typeConf.icon;

  const endTimePreview = useMemo(() => {
    const interval = buildScheduleEventInterval({
      date,
      time,
      isAllDay: false,
      durationMinutes: duration,
    });
    return interval ? format(new Date(interval.endTime), "HH:mm") : "";
  }, [date, time, duration]);

  const handleEndTimeChange = (value: string) => {
    if (!date || !time) return;
    if (
      !scheduleClockInputSchema.safeParse(time).success ||
      !scheduleClockInputSchema.safeParse(value).success
    ) {
      return;
    }
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

  const eventUserId = event?.user?.id;
  const eventUserName = event?.user?.name;
  const eventUserAvatarURL = event?.user?.avatar_url || null;

  const allAssignees = useMemo(() => {
    if (isMasked) return [];

    const list: {
      id: string;
      name: string;
      avatar_url: string | null;
      primary: boolean;
    }[] = [];
    const primary =
      users.find((u) => u.id === primaryUserId) ||
      (eventUserId === primaryUserId && eventUserName
        ? {
            id: eventUserId,
            name: eventUserName,
            avatar_url: eventUserAvatarURL,
          }
        : null);
    if (primary) list.push({ ...primary, primary: true });

    draftAssigneeIds.forEach((id) => {
      const user =
        assignees.find((assignee) => assignee.id === id) ||
        users.find((candidate) => candidate.id === id);
      if (user && user.id !== primaryUserId && !list.some((item) => item.id === user.id)) {
        list.push({ ...user, primary: false });
      }
    });

    return list;
  }, [
    eventUserAvatarURL,
    eventUserId,
    eventUserName,
    isMasked,
    users,
    primaryUserId,
    assignees,
    draftAssigneeIds,
  ]);

  const availableUsers = users.filter(
    (u) =>
      u.id !== primaryUserId &&
      !draftAssigneeIds.includes(u.id),
  );

  const handleTeamSelect = (teamId: string) => {
    setSelectedTeamId(teamId);
    const team = assignableTeams.find((item) => item.id === teamId);
    if (!team) return;

    const memberIds = (team.members || [])
      .map((member) => member.user?.id || member.user_id)
      .filter((id): id is string => Boolean(id));

    const nextPending = memberIds.filter(
      (id) =>
        id !== primaryUserId &&
        !draftAssigneeIds.includes(id),
    );

    if (!primaryUserId && memberIds[0]) {
      setPrimaryUserId(memberIds[0]);
    }
    if (nextPending.length > 0) {
      setDraftAssigneeIds((prev) =>
        Array.from(new Set([...prev, ...nextPending])),
      );
    }
  };

  const handleSubmit = async () => {
    if (!canManageSchedule || isMasked) return;
    if (isExisting && !assigneeDraftReady) return;
    if (!title.trim() || !date || !primaryUserId) return;
    const interval = buildScheduleEventInterval({
      date,
      time,
      isAllDay,
      durationMinutes: duration,
    });
    if (!interval) return;

    const assigneeIds = draftAssigneeIds.filter(
      (userId) => userId !== primaryUserId,
    );

    const basePayload = {
      title: title.trim(),
      description: description.trim() || undefined,
      event_type: selectedType,
      start_time: interval.startTime,
      end_time: interval.endTime,
      is_all_day: isAllDay,
      user_id: primaryUserId,
      lead_id: selectedLeadId || undefined,
      property_id: selectedPropertyId,
      location: location.trim() || undefined,
      visibility,
      assignee_ids: assigneeIds,
    };

    try {
      if (event) {
        await updateEvent.mutateAsync({
          id: event.id,
          ...basePayload,
          description: description.trim() || null,
          lead_id: selectedLeadId,
          location: location.trim() || null,
        });
      } else {
        await createEvent.mutateAsync({
          ...basePayload,
          recurrence_rule: recurrenceRule,
        });
      }
      onOpenChange(false);
    } catch {
      // The owning mutation reports the error; keep the form open with its draft intact.
    }
  };

  const handleMarkDone = async () => {
    if (!canManageSchedule || !event || isMasked) return;
    try {
      await updateEvent.mutateAsync({ id: event.id, status: "completed" });
      onOpenChange(false);
    } catch {
      // The owning mutation reports the error; keep the activity open.
    }
  };

  const handleReopen = async () => {
    if (!canManageSchedule || !event || isMasked) return;
    try {
      await updateEvent.mutateAsync({ id: event.id, status: "scheduled" });
      onOpenChange(false);
    } catch {
      // The owning mutation reports the error; keep the activity open.
    }
  };

  const handleDelete = async () => {
    if (!canManageSchedule || !event || isMasked) return;
    try {
      await deleteEvent.mutateAsync({ id: event.id });
      onOpenChange(false);
    } catch {
      // The owning mutation reports the error; keep the activity open.
    }
  };

  const handleSendComment = () => {
    if (!canManageSchedule || isMasked || !commentText.trim() || isAdding)
      return;
    const submittedComment = commentText.trim();
    addComment(submittedComment, {
      onSuccess: () => {
        setCommentText((current) =>
          current.trim() === submittedComment ? "" : current,
        );
      },
    });
  };

  const isLoading =
    createEvent.isPending || updateEvent.isPending || deleteEvent.isPending;
  const handleSheetOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isLoading) return;
    onOpenChange(nextOpen);
  };
  const hasValidTime = Boolean(
    buildScheduleEventInterval({
      date,
      time,
      isAllDay,
      durationMinutes: duration,
    }),
  );
  const canSubmit =
    !locked &&
    title.trim() &&
    date &&
    primaryUserId &&
    hasValidTime &&
    (!isExisting || assigneeDraftReady);

  if (!hasAgendaModule) return null;

  return (
    <>
      <Sheet open={open} onOpenChange={handleSheetOpenChange}>
        <SheetContent
          data-tour="agenda-event-sheet"
          side="right"
          overlayClassName="bg-black/35"
          className="!h-[100dvh] !w-full !max-w-none flex !max-h-[100dvh] flex-col overflow-hidden rounded-none border-0 bg-[var(--app-surface-solid)] p-0 text-[var(--app-text-primary)] !shadow-none [&>button.absolute.right-4.top-4]:hidden sm:inset-y-auto sm:right-auto sm:left-1/2 sm:top-1/2 sm:!h-auto sm:!max-h-[88dvh] sm:!w-[min(560px,calc(100vw-40px))] sm:!-translate-x-1/2 sm:!-translate-y-1/2 sm:!max-w-[560px] sm:rounded-[8px] sm:!shadow-none"
          onEscapeKeyDown={(event) => {
            if (isLoading) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            const target = event.target as HTMLElement | null;
            if (
              target?.closest(
                '[data-radix-popper-content-wrapper], [role="listbox"]',
              )
            ) {
              event.preventDefault();
            }
          }}
        >
          <SheetHeader className="sr-only">
            <SheetTitle>
              {isExisting ? "Detalhes da atividade" : "Nova atividade"}
            </SheetTitle>
            <SheetDescription>
              {isExisting
                ? "Consulte ou edite os dados, responsáveis e vínculos desta atividade."
                : "Preencha os dados para adicionar uma atividade à agenda."}
            </SheetDescription>
          </SheetHeader>

          <div className="grid shrink-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-2 border-b border-[var(--app-border)] px-4 pb-3 pt-3 sm:grid-cols-[minmax(0,1fr)_158px_auto] sm:border-b-0 sm:px-8 sm:pb-1 sm:pt-4">
            <div className="col-start-2 row-start-1 min-w-0 sm:col-start-1">
              {locked ? (
                <h2
                  className={cn(
                    "min-h-10 px-3 py-2.5 text-[12px] font-light leading-tight sm:min-h-9 sm:py-2",
                    agendaFieldClass,
                  )}
                >
                  {title || "Sem título"}
                </h2>
              ) : (
                <Input
                  data-tour="agenda-event-title"
                  aria-label="Título da atividade"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Adicionar título"
                  className={cn(
                    "h-10 px-3 text-[12px] font-light sm:h-9",
                    agendaFieldClass,
                  )}
                />
              )}
            </div>
            <div className="col-span-2 min-w-0 sm:col-span-1">
              {locked ? (
                <FieldPill className="h-10 w-full justify-center px-3 text-xs sm:h-9">
                  <TypeIcon className="h-3.5 w-3.5" />
                  {typeConf.label}
                </FieldPill>
              ) : (
                <Select
                  value={selectedType}
                  onValueChange={(value: EventType) => setSelectedType(value)}
                >
                  <SelectTrigger
                    data-tour="agenda-event-type"
                    aria-label="Tipo da atividade"
                    className={cn(
                      "h-10 w-full px-3 text-[12px] font-light leading-none sm:h-9 [&>span]:!flex [&>span]:items-center [&>span]:gap-2 [&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:text-[var(--app-text-tertiary)]",
                      agendaControlClass,
                    )}
                  >
                    <span className="min-w-0">
                      <TypeIcon className="h-3.5 w-3.5 shrink-0 text-[var(--app-text-tertiary)]" />
                      <span className="truncate">{typeConf.label}</span>
                    </span>
                  </SelectTrigger>
                  <SelectContent className={agendaPopoverClass}>
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
              onClick={() => handleSheetOpenChange(false)}
              disabled={isLoading}
              className="col-start-1 row-start-1 shrink-0 rounded-[6px] p-2 text-[var(--app-text-tertiary)] transition hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)] sm:col-start-3 sm:p-1.5"
              aria-label="Fechar"
            >
              <X size={18} strokeWidth={1.7} />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:px-8 sm:pb-2 sm:pt-0">
            {isCompleted && (
              <AgendaRow icon={<Lock size={18} />} align="center">
                <span className="inline-flex h-8 items-center rounded-[6px] bg-emerald-500/10 px-3 text-[12px] font-light text-emerald-600 dark:text-emerald-300">
                  Atividade concluída, somente leitura
                </span>
              </AgendaRow>
            )}

            {isMasked && (
              <AgendaRow icon={<Lock size={18} />} align="center">
                <span className="inline-flex h-8 items-center rounded-[6px] bg-[var(--app-surface-soft)] px-3 text-[12px] font-light text-[var(--app-text-secondary)]">
                  Informações privadas
                </span>
              </AgendaRow>
            )}

            <AgendaRow
              dataTour="agenda-event-date"
              icon={<Clock size={19} />}
              align={locked ? "center" : "start"}
            >
              {locked ? (
                <div className="text-[12px] font-light text-[var(--app-text-primary)]">
                  {date
                    ? format(date, "EEEE, dd 'de' MMMM", { locale: ptBR })
                    : "-"}{" "}
                  · {time} - {endTimePreview || "-"}
                </div>
              ) : (
                <div className="space-y-2 sm:space-y-1">
                  <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_76px_12px_76px] sm:items-center">
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          aria-label={date
                            ? `Data da atividade: ${format(date, "dd/MM/yyyy")}`
                            : "Selecionar data da atividade"}
                          className="col-span-2 h-10 rounded-[6px] bg-[var(--app-surface-soft)] px-3 text-left text-[12px] font-light leading-tight text-[var(--app-text-secondary)] transition hover:bg-[var(--app-surface-hover)] hover:text-primary focus-visible:text-primary active:text-primary sm:col-span-1 sm:h-9"
                        >
                          {date
                            ? format(date, "EEEE, dd 'de' MMMM", {
                                locale: ptBR,
                              })
                            : "Selecionar data"}
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        className={cn("w-auto p-0", agendaPopoverClass)}
                        align="start"
                      >
                        <Calendar
                          mode="single"
                          selected={date}
                          onSelect={setDate}
                          locale={ptBR}
                        />
                      </PopoverContent>
                    </Popover>
                    <div className="min-w-0 space-y-1 sm:space-y-0">
                      <span className="text-[11px] font-light text-[var(--app-text-tertiary)] sm:sr-only">
                        Início
                      </span>
                      <TimePicker
                        ariaLabel="Horário de início"
                        value={time}
                        onChange={setTime}
                        disabled={isAllDay}
                      />
                    </div>
                    <span className="hidden text-center text-[var(--app-text-tertiary)] sm:block">
                      -
                    </span>
                    <div className="min-w-0 space-y-1 sm:space-y-0">
                      <span className="text-[11px] font-light text-[var(--app-text-tertiary)] sm:sr-only">
                        Fim
                      </span>
                      <TimePicker
                        ariaLabel="Horário de fim"
                        value={endTimePreview || time}
                        onChange={handleEndTimeChange}
                        disabled={isAllDay}
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 pl-0.5 text-xs text-[var(--app-text-tertiary)]">
                    <label
                      data-tour="agenda-event-all-day"
                      className="inline-flex items-center gap-1.5"
                    >
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
                      disabled={isExisting}
                      onValueChange={(value) => {
                        if (isRecurrenceRule(value)) setRecurrenceRule(value);
                      }}
                    >
                      <SelectTrigger
                        data-tour="agenda-event-recurrence"
                        aria-label="Recorrência"
                        className="h-7 w-[132px] rounded-[6px] border-0 bg-transparent px-1.5 text-[12px] font-light text-[var(--app-text-tertiary)] shadow-none hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)] focus:ring-0"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {recurrenceOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {recurrenceRule !== "none" && (
                      <span
                        data-tour="agenda-event-recurrence-limit"
                        className="text-[11px] text-[var(--app-text-tertiary)]"
                      >
                        {recurrenceLimitLabels[recurrenceRule]}
                      </span>
                    )}
                    {isExisting && (
                      <span className="text-[11px] text-[var(--app-text-tertiary)]">
                        Definida na criação
                      </span>
                    )}
                  </div>
                </div>
              )}
            </AgendaRow>

            <AgendaRow
              dataTour="agenda-event-assignees"
              icon={<Users size={18} />}
              label="Responsáveis"
              inline
            >
              <div className="flex min-h-10 w-full flex-wrap items-center gap-2">
                {isMasked ? (
                  <span className="text-[12px] font-light text-[var(--app-text-tertiary)]">
                    Informação privada
                  </span>
                ) : !assigneeDraftReady ? (
                  <div className="flex items-center gap-2 text-[12px] font-light text-[var(--app-text-tertiary)]">
                    <span>
                      {assigneesError
                        ? "Não foi possível carregar os responsáveis."
                        : "Carregando responsáveis..."}
                    </span>
                    {assigneesError && (
                      <button
                        type="button"
                        onClick={() => void refetchAssignees()}
                        disabled={assigneesFetching}
                        className="rounded-[6px] bg-[var(--app-surface-soft)] px-2 py-1 text-primary transition-colors hover:bg-[var(--app-surface-hover)] disabled:opacity-50"
                      >
                        Tentar novamente
                      </button>
                    )}
                  </div>
                ) : allAssignees.length > 0 ? (
                  allAssignees.map((a) => (
                    <div key={a.id} className="group relative">
                      <Avatar className="h-8 w-8" title={a.name}>
                        <AvatarImage
                          src={a.avatar_url || undefined}
                          alt={a.name}
                        />
                        <AvatarFallback className="bg-primary/12 text-[10px] font-light text-primary">
                          {a.name
                            .split(" ")
                            .slice(0, 2)
                            .map((p) => p[0])
                            .join("")
                            .toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      {!locked && !a.primary && (
                        <button
                          type="button"
                          onClick={() =>
                            setDraftAssigneeIds((current) =>
                              current.filter((id) => id !== a.id),
                            )
                          }
                          className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                          aria-label="Remover responsável"
                        >
                          <X size={8} strokeWidth={3} />
                        </button>
                      )}
                    </div>
                  ))
                ) : (
                  <span className="text-[12px] font-light text-[var(--app-text-tertiary)]">
                    Adicionar convidados
                  </span>
                )}
                {!locked && assigneeDraftReady && availableUsers.length > 0 && (
                  <Popover
                    open={showAssigneePicker}
                    onOpenChange={setShowAssigneePicker}
                  >
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        aria-label="Adicionar responsável"
                        className={cn(
                          "flex h-8 w-8 items-center justify-center rounded-[6px] text-[var(--app-text-secondary)] hover:text-primary",
                          agendaControlClass,
                        )}
                      >
                        <Plus size={14} />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      className={cn("w-[260px] p-0", agendaPopoverClass)}
                      align="start"
                    >
                      <Command
                        filter={commandSearchFilter}
                        className="bg-transparent [&_[cmdk-input-wrapper]]:border-b-0"
                      >
                        <CommandInput placeholder="Adicionar responsável..." />
                        <CommandList>
                          <CommandEmpty>Sem usuários disponíveis.</CommandEmpty>
                          <CommandGroup>
                            {availableUsers.map((u) => (
                              <CommandItem
                                key={u.id}
                                onSelect={() => {
                                  if (!primaryUserId)
                                    setPrimaryUserId(u.id);
                                  else if (!draftAssigneeIds.includes(u.id))
                                    setDraftAssigneeIds((prev) => [
                                      ...prev,
                                      u.id,
                                    ]);
                                  setShowAssigneePicker(false);
                                }}
                              >
                                <Avatar className="mr-2 h-5 w-5">
                                  <AvatarImage
                                    src={u.avatar_url || undefined}
                                    alt={u.name}
                                  />
                                  <AvatarFallback className="bg-primary/12 text-[10px] font-light text-primary">
                                    {u.name
                                      .split(" ")
                                      .slice(0, 2)
                                      .map((p) => p[0])
                                      .join("")}
                                  </AvatarFallback>
                                </Avatar>
                                <span className="text-[12px] font-light">
                                  {u.name}
                                </span>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                )}
                {!locked && assigneeDraftReady && assignableTeams.length > 0 && (
                  <Select
                    value={selectedTeamId}
                    onValueChange={handleTeamSelect}
                  >
                    <SelectTrigger
                      aria-label="Adicionar equipe responsável"
                      className={cn(
                        "h-10 min-w-[132px] flex-1 px-3 text-[12px] font-light sm:h-9 sm:flex-none",
                        agendaControlClass,
                      )}
                    >
                      <SelectValue placeholder="Equipe" />
                    </SelectTrigger>
                    <SelectContent className={agendaPopoverClass}>
                      {assignableTeams.map((team) => (
                        <SelectItem key={team.id} value={team.id}>
                          {team.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              {!locked && assigneeDraftReady && !primaryUserId && (
                <Select value={primaryUserId} onValueChange={setPrimaryUserId}>
                  <SelectTrigger
                    aria-label="Responsável principal"
                    className={cn(
                      "mt-2 h-10 text-[12px] font-light sm:h-9",
                      agendaControlClass,
                    )}
                  >
                    <SelectValue placeholder="Responsável principal..." />
                  </SelectTrigger>
                  <SelectContent className={agendaPopoverClass}>
                    {users.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </AgendaRow>

            <AgendaRow
              dataTour="agenda-event-visibility"
              icon={<Lock size={18} />}
              label="Visibilidade"
              inline
            >
              <div className="flex w-full flex-col items-start gap-1.5">
                {locked ? (
                  <FieldPill className="h-9 px-3 text-xs">
                    {visibilityOptions.find(
                      (option) => option.value === visibility,
                    )?.label || "Padrão"}
                  </FieldPill>
                ) : (
                  <div className="grid h-10 w-full grid-cols-3 rounded-[6px] bg-[var(--app-surface-soft)] p-1 sm:inline-flex sm:h-9 sm:w-auto">
                    {visibilityOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setVisibility(option.value)}
                        title={option.description}
                        aria-label={`${option.label}: ${option.description}`}
                        aria-pressed={visibility === option.value}
                        className={cn(
                          "min-w-0 rounded-[6px] px-2 text-[12px] font-light transition sm:px-3",
                          visibility === option.value
                            ? "bg-primary text-primary-foreground hover:bg-primary/90"
                            : "text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]",
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                )}
                <p className="text-xs leading-4 text-[var(--app-text-tertiary)]">
                  {
                    visibilityOptions.find(
                      (option) => option.value === visibility,
                    )?.description
                  }
                </p>
              </div>
            </AgendaRow>

            <AgendaRow icon={<User size={18} />} label="Lead/cliente" inline>
              {selectedLeadId ? (
                <div className="flex items-center justify-between gap-2">
                  {isExisting ? (
                    <Link
                      href={`/crm/pipelines?lead=${selectedLeadId}`}
                      className="truncate text-[12px] font-light text-primary hover:text-primary/80"
                    >
                      {selectedLeadName || "Lead vinculado"}
                    </Link>
                  ) : (
                    <span className="truncate text-[12px] font-light text-[var(--app-text-primary)]">
                      {selectedLeadName}
                    </span>
                  )}
                  {!locked && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      aria-label="Remover lead vinculado"
                      onClick={() => {
                        setSelectedLeadId(null);
                        setSelectedLeadName(null);
                      }}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              ) : !locked ? (
                <Popover
                  open={showLeadSelector}
                  onOpenChange={setShowLeadSelector}
                >
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        "inline-flex h-10 w-full items-center gap-2 px-3 text-left text-[12px] font-light sm:h-9",
                        agendaControlClass,
                        agendaMutedTextClass,
                      )}
                    >
                      <Search className="h-4 w-4" />
                      Buscar por nome, tel...
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    className={cn(
                      "w-[min(360px,calc(100vw-32px))] p-0",
                      agendaPopoverClass,
                    )}
                    align="start"
                  >
                    <Command
                      shouldFilter={false}
                      className="bg-transparent [&_[cmdk-input-wrapper]]:border-b-0"
                    >
                      <CommandInput
                        placeholder="Buscar por nome, telefone ou e-mail..."
                        value={leadSearch}
                        onValueChange={setLeadSearch}
                      />
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
                                <span className="truncate text-[12px] font-light">
                                  {l.name}
                                </span>
                                <span className="truncate text-[10px] text-muted-foreground">
                                  {[l.phone, l.email]
                                    .filter(Boolean)
                                    .join(" · ") || "Sem contato"}
                                </span>
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              ) : (
                <span className="text-[12px] font-light text-[var(--app-text-tertiary)]">
                  {isMasked ? "Informação privada" : "Sem lead"}
                </span>
              )}
            </AgendaRow>

            {canViewProperties && (
              <AgendaRow
                dataTour="agenda-event-property"
                icon={<Building2 size={18} />}
                label="Imóvel vinculado"
                inline
              >
                {selectedPropertyId ? (
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setPropertyPreviewOpen(true)}
                      className="truncate text-left text-[12px] font-light text-primary hover:text-primary/80"
                    >
                      {selectedPropertyLabel || "Imóvel selecionado"}
                    </button>
                    {!locked && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        aria-label="Remover imóvel vinculado"
                        onClick={() => {
                          setSelectedPropertyId(null);
                          setSelectedPropertyLabel(null);
                        }}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                ) : !locked ? (
                  <PropertyPickerDialog
                    properties={allProperties}
                    selectedPropertyId={selectedPropertyId}
                    isLoading={propertiesLoading}
                    onOpenChange={(nextOpen) => {
                      setPropertyPickerOpen(nextOpen);
                      if (!nextOpen) setPropertySearch("");
                    }}
                    onSearchChange={setPropertySearch}
                    onSelect={(p) => {
                      setSelectedPropertyId(p.id);
                      setSelectedPropertyLabel(
                        `${p.code ? `${p.code} · ` : ""}${p.title || "Imóvel"}`,
                      );
                    }}
                    trigger={
                      <button
                        type="button"
                        className={cn(
                          "inline-flex h-10 w-full items-center gap-2 px-3 text-left text-[12px] font-light sm:h-9",
                          agendaControlClass,
                          agendaMutedTextClass,
                        )}
                      >
                        <Search className="h-4 w-4" />
                        Buscar imóvel
                      </button>
                    }
                  />
                ) : (
                  <span className="text-[12px] font-light text-[var(--app-text-tertiary)]">
                    {isMasked ? "Informação privada" : "Sem imóvel"}
                  </span>
                )}
              </AgendaRow>
            )}

            <AgendaRow
              dataTour="agenda-event-notes"
              icon={<MessageSquare size={19} />}
              label="Observações"
            >
              {locked ? (
                <p className="text-[12px] font-light leading-[18px] text-[var(--app-text-secondary)]">
                  {description ||
                    (isMasked ? "Informação privada" : "Sem descrição")}
                </p>
              ) : (
                <Textarea
                  aria-label="Observações"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Adicione observações"
                  rows={4}
                  className={cn(
                    "min-h-[112px] resize-none px-3 py-3 text-[12px] font-light sm:min-h-[132px]",
                    agendaFieldClass,
                  )}
                />
              )}
            </AgendaRow>

            {isExisting && (
              <AgendaRow icon={<MessageSquare size={19} />}>
                <div className="space-y-3">
                  {isMasked ? (
                    <p className="text-[12px] font-light text-[var(--app-text-tertiary)]">
                      Comentários privados
                    </p>
                  ) : (
                    <>
                      {comments.length === 0 && (
                        <p className="text-[12px] font-light text-[var(--app-text-tertiary)]">
                          Nenhum comentário
                        </p>
                      )}
                      {comments.map((c) => (
                        <div key={c.id} className="flex gap-2">
                          <Avatar className="h-6 w-6 shrink-0">
                            <AvatarImage
                              src={c.user?.avatar_url || undefined}
                              alt={c.user?.name || "Usuário"}
                            />
                            <AvatarFallback className="bg-primary/12 text-[10px] font-light text-primary">
                              {(c.user?.name || "U")
                                .split(" ")
                                .slice(0, 2)
                                .map((p) => p[0])
                                .join("")}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <div className="mb-0.5 text-[10px] text-[var(--app-text-tertiary)]">
                              <span className="font-light text-[var(--app-text-primary)]">
                                {c.user?.name || "Usuário"}
                              </span>
                              {" · "}
                              {formatScheduleTimestamp(c.created_at)}
                            </div>
                            <div className="rounded-[6px] bg-[var(--app-surface-soft)] px-2.5 py-1.5 text-[12px] font-light leading-[18px] text-[var(--app-text-primary)]">
                              {c.content}
                            </div>
                          </div>
                        </div>
                      ))}
                      <div className="flex gap-2">
                        <Input
                          value={commentText}
                          onChange={(e) => setCommentText(e.target.value)}
                          onKeyDown={(e) =>
                            e.key === "Enter" && handleSendComment()
                          }
                          placeholder="Comentário..."
                          className={cn(
                            "h-9 text-[12px] font-light",
                            agendaFieldClass,
                          )}
                          disabled={!canManageSchedule || isAdding}
                        />
                        <Button
                          size="icon"
                          onClick={handleSendComment}
                          disabled={
                            !canManageSchedule ||
                            isAdding ||
                            !commentText.trim()
                          }
                          className="h-9 w-9 shrink-0 rounded-[6px] border-0 bg-primary text-primary-foreground shadow-none hover:bg-primary/90 hover:text-primary-foreground"
                          aria-label="Enviar comentário"
                        >
                          <Send size={13} />
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              </AgendaRow>
            )}
          </div>

          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--app-border)] px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 sm:border-t-0 sm:px-5 sm:py-4">
            {canManageSchedule && isExisting && !isMasked ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-10 w-10 rounded-[6px] border-0 bg-destructive/10 p-0 text-destructive shadow-none hover:bg-destructive/15 hover:text-destructive sm:h-9 sm:w-9"
                    aria-label="Excluir atividade"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="rounded-[8px] border-0 bg-[var(--app-surface-solid)] !shadow-none">
                  <AlertDialogHeader>
                    <AlertDialogTitle className="text-[14px] font-light">
                      Excluir atividade?
                    </AlertDialogTitle>
                    <AlertDialogDescription className="text-[12px] font-light leading-[18px]">
                      Esta ação não pode ser desfeita.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] font-light shadow-none hover:bg-[var(--app-surface-hover)]">
                      Cancelar
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDelete}
                      className="h-9 rounded-[6px] border-0 bg-destructive/15 text-[12px] font-light text-destructive shadow-none hover:bg-destructive hover:text-destructive-foreground"
                    >
                      Excluir
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : (
              <span />
            )}

            <div className="ml-auto flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
              {canManageSchedule && isExisting && !isMasked && !isCompleted && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleMarkDone}
                  disabled={isLoading}
                  className="h-10 gap-1.5 rounded-[6px] border-0 bg-emerald-500/15 px-3 text-[12px] font-light text-emerald-600 shadow-none hover:bg-emerald-500/25 hover:text-emerald-700 dark:text-emerald-300 dark:hover:text-emerald-200 sm:h-9"
                >
                  <CheckCircle size={13} /> Concluir
                </Button>
              )}
              {canManageSchedule && isExisting && !isMasked && isCompleted && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleReopen}
                  disabled={isLoading}
                  className="h-10 gap-1.5 rounded-[6px] border-0 bg-amber-500/15 px-3 text-[12px] font-light text-amber-700 shadow-none hover:bg-amber-500/25 hover:text-amber-800 dark:text-amber-300 dark:hover:text-amber-200 sm:h-9"
                >
                  <Clock size={13} /> Reabrir
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (
                    canManageSchedule &&
                    isExisting &&
                    !isMasked &&
                    !isCompleted
                  ) {
                    if (isEditing) resetDraft();
                    else setIsEditing(true);
                    return;
                  }
                  onOpenChange(false);
                }}
                disabled={isLoading}
                className={cn(
                  "h-10 min-w-0 rounded-[6px] border-0 text-[12px] font-light shadow-none sm:h-9",
                  !locked
                    ? "order-1 flex-[3] bg-[var(--app-surface-soft)] text-[var(--app-text-primary)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]"
                    : "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground",
                )}
              >
                {canManageSchedule && isExisting && !isMasked
                  ? isEditing
                    ? "Cancelar"
                    : "Editar"
                  : "Fechar"}
              </Button>
              {!locked && (
                <Button
                  size="sm"
                  onClick={handleSubmit}
                  disabled={!canSubmit || isLoading}
                  className="order-2 h-10 min-w-0 flex-[7] rounded-[6px] border-0 bg-primary px-5 text-[12px] font-light text-primary-foreground shadow-none hover:bg-primary/90 hover:text-primary-foreground sm:h-9 sm:px-7"
                >
                  {isLoading
                    ? "Salvando..."
                    : isExisting
                      ? "Salvar"
                      : "Adicionar"}
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
  dataTour,
  inline = false,
  align = "start",
}: {
  icon: React.ReactNode;
  label?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  dataTour?: string;
  inline?: boolean;
  align?: "start" | "center";
}) {
  if (inline) {
    return (
      <div
        data-tour={dataTour}
        className={cn(
          "grid grid-cols-[24px_minmax(0,1fr)] items-start gap-x-3 gap-y-1 py-2 sm:grid-cols-[30px_124px_minmax(0,1fr)] sm:items-center sm:gap-2 sm:py-1.5",
          className,
        )}
      >
        <div className="flex justify-center pt-0.5 text-[var(--app-text-tertiary)] sm:pt-0">
          {icon}
        </div>
        <div className="min-w-0 text-[12px] font-light text-[var(--app-text-secondary)]">
          {label}
        </div>
        <div className="col-start-2 min-w-0 sm:col-start-3 sm:row-start-1">
          {children}
        </div>
      </div>
    );
  }

  return (
    <div
      data-tour={dataTour}
      className={cn(
        "grid grid-cols-[24px_minmax(0,1fr)] gap-3 sm:grid-cols-[30px_minmax(0,1fr)]",
        align === "center" ? "items-center py-1.5" : "items-start py-2",
        className,
      )}
    >
      <div
        className={cn(
          "flex justify-center text-[var(--app-text-tertiary)]",
          align === "start" && "pt-2",
        )}
      >
        {icon}
      </div>
      <div className="min-w-0">
        {label && (
          <div className="mb-1.5 text-[12px] font-light text-[var(--app-text-secondary)]">
            {label}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

function FieldPill({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex h-10 items-center gap-2 rounded-[6px] bg-[var(--app-surface-soft)] px-3 text-[12px] font-light text-[var(--app-text-primary)] sm:h-9",
        className,
      )}
    >
      {children}
    </div>
  );
}

function TimePicker({
  value,
  disabled,
  onChange,
  ariaLabel,
}: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={`${ariaLabel}: ${value || "não definido"}`}
          className="inline-flex h-10 w-full min-w-[76px] items-center justify-center rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-[12px] font-light text-[var(--app-text-primary)] shadow-none transition hover:bg-[var(--app-surface-hover)] disabled:opacity-50 sm:h-9 sm:w-auto"
        >
          {value || "--:--"}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className={cn("w-[190px] p-2", agendaPopoverClass)}
        align="center"
      >
        <Input
          type="time"
          aria-label={ariaLabel}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={cn("mb-2 h-9 text-[12px] font-light", agendaFieldClass)}
        />
        <div className="grid max-h-[190px] grid-cols-2 gap-1 overflow-y-auto pr-1">
          {timeOptions.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={option === value}
              onClick={() => onChange(option)}
              className={cn(
                "rounded-[6px] px-2 py-1.5 text-[12px] font-light transition hover:bg-primary hover:text-primary-foreground",
                option === value
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]",
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
