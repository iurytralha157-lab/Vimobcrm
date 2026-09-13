import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { getCurrentTimeForInput, getBrasiliaTime } from "@/lib/utils";
import {
  useCreateScheduleEvent,
  useCompleteScheduleEvent,
  useScheduleCapabilities,
  useRescheduleScheduleEvent,
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
import { PropertyPreviewDialog } from "@/components/features/properties/PropertyPreviewDialog";
import { useOrganizationModules } from "@/hooks/use-organization-modules";
import { useUserPermissions } from "@/hooks/use-user-permissions";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useAuth } from "@/contexts/AuthContext";
import { scheduleClockInputSchema } from "@/lib/validation/schedule";
import {
  buildScheduleEventInterval,
  buildScheduleEventTimingPatch,
} from "@/lib/schedule-event-draft";
import { EventAssigneesSection } from "@/components/features/schedule/event-sheet/EventAssigneesSection";
import { EventNotesAndComments } from "@/components/features/schedule/event-sheet/EventNotesAndComments";
import { EventRelationsSections } from "@/components/features/schedule/event-sheet/EventRelationsSections";
import { EventSheetActions } from "@/components/features/schedule/event-sheet/EventSheetActions";
import { EventSheetFeedback } from "@/components/features/schedule/event-sheet/EventSheetFeedback";
import { EventSheetHeader } from "@/components/features/schedule/event-sheet/EventSheetHeader";
import { EventTimingSection } from "@/components/features/schedule/event-sheet/EventTimingSection";
import { EventVisibilitySection } from "@/components/features/schedule/event-sheet/EventVisibilitySection";
import {
  ScheduleOutcomeDialog,
  type ScheduleOutcomeConfirmation,
} from "@/components/features/schedule/ScheduleOutcomeDialog";
import {
  getSimpleScheduleCompletionOutcome,
  DEFAULT_SCHEDULE_TIME_ZONE,
  isAttendanceScheduleType,
  scheduleStatusForOutcome,
  shouldPreserveAttendanceHistory,
} from "@/lib/schedule-outcome";
import {
  formatScheduleZonedTime,
  getLocalScheduleCivilDateKey,
  getScheduleCivilDateKey,
  scheduleCivilDateKeyToLocalDate,
  scheduleFutureCivilDateTimeToDate,
} from "@/lib/schedule-time-zone";
import {
  applyTeamSelection,
  buildDisplayAssignees,
  formatPropertyPrice,
  getAvailableAssignees,
  getClockRangeDurationMinutes,
  getDefaultDurationMinutes,
  getStoredDurationMinutes,
  isRecurrenceRule,
  type RecurrenceRule,
} from "@/components/features/schedule/event-sheet/model";

interface EventSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event?: ScheduleEvent | null;
  defaultUserId?: string;
  defaultDate?: Date;
  defaultTime?: string;
  defaultType?: EventType;
  leadId?: string;
  leadName?: string;
}

interface ScheduleDraftStart {
  date: Date;
  time: string;
  preferredStartTime: string | null;
}

function getNextScheduleQuarterHourDraft(
  value: Date | string | number,
  timeZone: string,
): ScheduleDraftStart | null {
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) return null;

  const quarterHour = 15 * 60 * 1000;
  const nextInstant = new Date(
    Math.floor(instant.getTime() / quarterHour) * quarterHour + quarterHour,
  );
  const civilDate = getScheduleCivilDateKey(nextInstant, timeZone);
  const date = civilDate ? scheduleCivilDateKeyToLocalDate(civilDate) : null;
  const time = formatScheduleZonedTime(nextInstant, timeZone);
  return date && scheduleClockInputSchema.safeParse(time).success
    ? { date, time, preferredStartTime: nextInstant.toISOString() }
    : null;
}

function getInitialScheduleDraft({
  defaultDate,
  defaultTime,
  now,
  timeZone,
}: {
  defaultDate?: Date;
  defaultTime?: string;
  now: Date;
  timeZone: string;
}): ScheduleDraftStart {
  const fallback = getNextScheduleQuarterHourDraft(now, timeZone);
  const currentCivilDate = getScheduleCivilDateKey(now, timeZone);
  const currentDate = currentCivilDate
    ? scheduleCivilDateKeyToLocalDate(currentCivilDate)
    : null;
  const currentTime = formatScheduleZonedTime(now, timeZone);
  const safeFallback =
    fallback ||
    (currentDate && scheduleClockInputSchema.safeParse(currentTime).success
      ? {
          date: currentDate,
          time: currentTime,
          preferredStartTime: now.toISOString(),
        }
      : {
          date: getBrasiliaTime(),
          time: getCurrentTimeForInput(),
          preferredStartTime: null,
        });

  if (!defaultDate || Number.isNaN(defaultDate.getTime())) return safeFallback;

  const civilDate = getLocalScheduleCivilDateKey(defaultDate);
  const date = scheduleCivilDateKeyToLocalDate(civilDate);
  if (!date) return safeFallback;

  const parsedDefaultTime = scheduleClockInputSchema.safeParse(defaultTime);
  const localClock = `${String(defaultDate.getHours()).padStart(2, "0")}:${String(
    defaultDate.getMinutes(),
  ).padStart(2, "0")}`;
  const time = parsedDefaultTime.success ? parsedDefaultTime.data : localClock;
  const hasExplicitTime =
    parsedDefaultTime.success ||
    defaultDate.getHours() !== 0 ||
    defaultDate.getMinutes() !== 0 ||
    defaultDate.getSeconds() !== 0;

  if (civilDate === currentCivilDate) {
    if (!hasExplicitTime) return safeFallback;
    const futureStart = scheduleFutureCivilDateTimeToDate(
      civilDate,
      time,
      timeZone,
      now,
    );
    if (!futureStart) return safeFallback;
    return {
      date,
      time,
      preferredStartTime: futureStart.toISOString(),
    };
  }

  return { date, time, preferredStartTime: null };
}

export function EventSheet({
  open,
  onOpenChange,
  event,
  defaultUserId,
  defaultDate,
  defaultTime,
  defaultType,
  leadId,
  leadName,
}: EventSheetProps) {
  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId;
  const { hasPermission } = useUserPermissions();
  const { hasModule } = useOrganizationModules();
  const hasAgendaModule = hasModule("agenda");
  const canManageSchedule = hasAgendaModule && hasPermission("schedule_manage");
  const scheduleCapabilitiesQuery = useScheduleCapabilities({
    enabled: open && hasAgendaModule,
  });
  const scheduleCapabilities = scheduleCapabilitiesQuery.data;
  const scheduleTimeZone =
    scheduleCapabilities?.timeZone || DEFAULT_SCHEDULE_TIME_ZONE;
  const scheduleTimeZoneReady =
    scheduleCapabilitiesQuery.isSuccess &&
    Boolean(scheduleCapabilities?.timeZone);
  const canViewProperties =
    hasModule("properties") &&
    (hasPermission("property_view") || hasPermission("property_manage"));
  const isExisting = !!event;
  const isCompleted = [
    "completed",
    "no_show",
    "cancelled",
    "canceled",
  ].includes(event?.status || "");
  const canReopen =
    !isAttendanceScheduleType(event?.event_type) &&
    (event?.status === "completed" ||
      ((event?.status === "cancelled" || event?.status === "canceled") &&
        event?.outcome !== "rescheduled"));
  const isMasked = Boolean(event?.is_masked);
  const outcomeEventType: EventType = [
    "call",
    "email",
    "meeting",
    "task",
    "message",
    "visit",
  ].includes(event?.event_type || "")
    ? (event?.event_type as EventType)
    : "task";
  const requiresAttendanceOutcome = isAttendanceScheduleType(outcomeEventType);
  const preservesAppointmentTiming = isExisting && requiresAttendanceOutcome;
  const hasAttendanceHistoryLink =
    requiresAttendanceOutcome &&
    Boolean(event?.rescheduled_from_event_id || event?.rescheduled_to_event_id);
  const preservesAttendanceHistory =
    shouldPreserveAttendanceHistory(outcomeEventType, event?.status) ||
    hasAttendanceHistoryLink;
  const [isEditing, setIsEditing] = useState(false);
  const { data: users = [] } = useScheduleUsers({
    enabled: open && hasAgendaModule,
  });
  const outcomeUsers =
    event?.user_id && !users.some((user) => user.id === event.user_id)
      ? [
          {
            id: event.user_id,
            name: event.user?.name || "Responsável do evento",
            avatar_url: event.user?.avatar_url || null,
          },
          ...users,
        ]
      : users;
  const { data: teams = [] } = useTeams({
    enabled: open && canManageSchedule && !isMasked && isEditing,
  });
  const createEvent = useCreateScheduleEvent();
  const updateEvent = useUpdateScheduleEvent();
  const completeEvent = useCompleteScheduleEvent();
  const rescheduleEvent = useRescheduleScheduleEvent();
  const deleteEvent = useDeleteScheduleEvent();
  const [outcomeDialogOpen, setOutcomeDialogOpen] = useState(false);

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
  const [preferredStartTime, setPreferredStartTime] = useState<string | null>(
    null,
  );
  const [reminderMinutes, setReminderMinutes] = useState<number | null>(30);
  const durationTouched = useRef(false);
  const initializedDraftIdentityRef = useRef<string | null>(null);
  const [initializedDraftIdentity, setInitializedDraftIdentity] = useState<
    string | null
  >(null);
  const [recurrenceRule, setRecurrenceRule] = useState<RecurrenceRule>("none");

  const draftIdentity = event?.id
    ? `${organizationId || "none"}:event:${event.id}`
    : `${organizationId || "none"}:new:${leadId || ""}:${defaultDate?.getTime() ?? ""}:${defaultTime || ""}:${defaultType || ""}`;
  const draftOrganizationIdRef = useRef(organizationId);

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

  useEffect(() => {
    if (draftOrganizationIdRef.current === organizationId) return;
    draftOrganizationIdRef.current = organizationId;
    initializedDraftIdentityRef.current = null;
    queueMicrotask(() => {
      setInitializedDraftIdentity(null);
      setPreferredStartTime(null);
      if (open) onOpenChange(false);
    });
  }, [onOpenChange, open, organizationId]);

  const resetDraft = useCallback(() => {
    if (event) {
      const parsedStartDate = event.start_time
        ? new Date(event.start_time)
        : getBrasiliaTime();
      const displayDateKey = getScheduleCivilDateKey(
        event.start_time || Date.now(),
        scheduleTimeZone,
      );
      const displayStartDate = displayDateKey
        ? scheduleCivilDateKeyToLocalDate(displayDateKey)
        : null;
      const safeStartDate =
        displayStartDate ||
        (Number.isNaN(parsedStartDate.getTime())
          ? getBrasiliaTime()
          : parsedStartDate);
      const nextDuration = getStoredDurationMinutes({
        start: parsedStartDate,
        end:
          event.start_time && event.end_time ? new Date(event.end_time) : null,
        eventType: event.event_type,
      });
      setIsEditing(false);
      setSelectedType((event.event_type as EventType) || "task");
      setTitle(event.title || "");
      setDescription(event.description || "");
      setLocation(event.location || "");
      setPrimaryUserId(event.user_id || defaultUserId || "");
      setVisibility(event.visibility || "default");
      setDate(safeStartDate);
      setPreferredStartTime(event.start_time || null);
      setTime(
        event.start_time
          ? formatScheduleZonedTime(event.start_time, scheduleTimeZone)
          : getCurrentTimeForInput(),
      );
      setIsAllDay(Boolean(event.is_all_day));
      setReminderMinutes(event.reminder_minutes ?? null);
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
      const initialStart = getInitialScheduleDraft({
        defaultDate,
        defaultTime,
        now: new Date(),
        timeZone: scheduleTimeZone,
      });
      setDate(initialStart.date);
      setTime(initialStart.time);
      setPreferredStartTime(initialStart.preferredStartTime);
      setIsAllDay(false);
      setReminderMinutes(30);
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
    setSelectedTeamId(event?.team_id || "");
    setOutcomeDialogOpen(false);
    setCommentText("");
    setLeadSearch("");
    setPropertySearch("");
    setShowLeadSelector(false);
    setShowAssigneePicker(false);
    setPropertyPickerOpen(false);
  }, [
    defaultDate,
    defaultTime,
    defaultType,
    defaultUserId,
    event,
    leadId,
    leadName,
    scheduleTimeZone,
  ]);

  useEffect(() => {
    if (!open) {
      initializedDraftIdentityRef.current = null;
      queueMicrotask(() => setInitializedDraftIdentity(null));
      return;
    }
    if (
      !hasAgendaModule ||
      !scheduleTimeZoneReady ||
      initializedDraftIdentityRef.current === draftIdentity
    ) {
      return;
    }

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled || initializedDraftIdentityRef.current === draftIdentity) {
        return;
      }
      initializedDraftIdentityRef.current = draftIdentity;
      resetDraft();
      setInitializedDraftIdentity(draftIdentity);
    });
    return () => {
      cancelled = true;
    };
  }, [draftIdentity, hasAgendaModule, open, resetDraft, scheduleTimeZoneReady]);

  const draftReady =
    scheduleTimeZoneReady && initializedDraftIdentity === draftIdentity;
  const draftLocked = locked || !draftReady;

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
    setDuration(getDefaultDurationMinutes(selectedType));
  }, [selectedType, locked]);

  const endTimePreview = useMemo(() => {
    const interval = buildScheduleEventInterval({
      date,
      time,
      isAllDay: false,
      durationMinutes: duration,
      timeZone: scheduleTimeZone,
      preferredStartTime,
    });
    return interval
      ? formatScheduleZonedTime(interval.endTime, scheduleTimeZone)
      : "";
  }, [date, duration, preferredStartTime, scheduleTimeZone, time]);

  const handleDateChange = (value: Date | undefined) => {
    setPreferredStartTime(null);
    setDate(value);
  };

  const handleTimeChange = (value: string) => {
    setPreferredStartTime(null);
    setTime(value);
  };

  const handleAllDayChange = (value: boolean) => {
    setPreferredStartTime(null);
    setIsAllDay(value);
  };

  const handleEndTimeChange = (value: string) => {
    if (!date || !time) return;
    if (
      !scheduleClockInputSchema.safeParse(time).success ||
      !scheduleClockInputSchema.safeParse(value).success
    ) {
      return;
    }
    const nextDuration = getClockRangeDurationMinutes({
      date,
      startTime: time,
      endTime: value,
      timeZone: scheduleTimeZone,
      preferredStartTime,
    });
    if (nextDuration === null) return;
    setDuration(nextDuration);
    durationTouched.current = true;
  };

  const eventUserId = event?.user?.id;
  const eventUserName = event?.user?.name;
  const eventUserAvatarURL = event?.user?.avatar_url || null;

  const allAssignees = useMemo(
    () =>
      buildDisplayAssignees({
        users,
        loadedAssignees: assignees,
        draftAssigneeIds,
        primaryUserId,
        eventUser:
          eventUserId && eventUserName
            ? {
                id: eventUserId,
                name: eventUserName,
                avatar_url: eventUserAvatarURL,
              }
            : null,
        isMasked,
      }),
    [
      eventUserAvatarURL,
      eventUserId,
      eventUserName,
      isMasked,
      users,
      primaryUserId,
      assignees,
      draftAssigneeIds,
    ],
  );

  const availableUsers = getAvailableAssignees(
    users,
    primaryUserId,
    draftAssigneeIds,
  );

  const handleTeamSelect = (teamId: string) => {
    setSelectedTeamId(teamId);
    const team = assignableTeams.find((item) => item.id === teamId);
    if (!team) return;

    const memberIds = (team.members || [])
      .map((member) => member.user?.id || member.user_id)
      .filter((id): id is string => Boolean(id));

    const selection = applyTeamSelection({
      memberIds,
      primaryUserId,
      draftAssigneeIds,
    });
    if (selection.primaryUserId !== primaryUserId) {
      setPrimaryUserId(selection.primaryUserId);
    }
    if (selection.draftAssigneeIds.length !== draftAssigneeIds.length) {
      const pendingIds = selection.draftAssigneeIds.filter(
        (userId) => !draftAssigneeIds.includes(userId),
      );
      setDraftAssigneeIds((current) =>
        Array.from(new Set([...current, ...pendingIds])),
      );
    }
  };

  const handleSubmit = async () => {
    if (!canManageSchedule || isMasked || !draftReady) return;
    if (isExisting && !assigneeDraftReady) return;
    if (!title.trim() || !date || !primaryUserId) return;
    const interval = buildScheduleEventInterval({
      date,
      time,
      isAllDay,
      durationMinutes: duration,
      timeZone: scheduleTimeZone,
      preferredStartTime,
    });
    if (!interval) return;

    const assigneeIds = draftAssigneeIds.filter(
      (userId) => userId !== primaryUserId,
    );
    const reminderMinutesPayload =
      event &&
      typeof reminderMinutes === "number" &&
      reminderMinutes > 120 &&
      reminderMinutes === event.reminder_minutes
        ? undefined
        : reminderMinutes;

    const sharedPayload = {
      title: title.trim(),
      description: description.trim() || undefined,
      event_type: selectedType,
      user_id: primaryUserId,
      lead_id: selectedLeadId || undefined,
      property_id: selectedPropertyId,
      team_id: selectedTeamId || null,
      location: location.trim() || undefined,
      visibility,
      assignee_ids: assigneeIds,
    };

    try {
      if (event) {
        await updateEvent.mutateAsync({
          id: event.id,
          ...sharedPayload,
          ...buildScheduleEventTimingPatch({
            preserveAppointmentTiming: preservesAppointmentTiming,
            startTime: interval.startTime,
            endTime: interval.endTime,
            isAllDay,
            reminderMinutes: reminderMinutesPayload,
          }),
          description: description.trim() || null,
          lead_id: selectedLeadId,
          location: location.trim() || null,
        });
      } else {
        await createEvent.mutateAsync({
          ...sharedPayload,
          start_time: interval.startTime,
          end_time: interval.endTime,
          is_all_day: isAllDay,
          reminder_minutes: reminderMinutesPayload,
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
    if (requiresAttendanceOutcome) {
      setOutcomeDialogOpen(true);
      return;
    }

    try {
      await completeEvent.mutateAsync({
        id: event.id,
        status: "completed",
        outcome: getSimpleScheduleCompletionOutcome(event.event_type),
      });
      onOpenChange(false);
    } catch {
      // The owning mutation reports the error; keep the activity open.
    }
  };

  const handleOutcomeConfirm = async ({
    outcome,
    notes,
    performedBy,
    reschedule,
  }: ScheduleOutcomeConfirmation) => {
    if (!canManageSchedule || !event || isMasked) return;
    try {
      if (outcome === "rescheduled") {
        if (!reschedule) return;
        await rescheduleEvent.mutateAsync({
          id: event.id,
          start_time: reschedule.startTime,
          end_time: reschedule.endTime,
          is_all_day: reschedule.isAllDay,
          reminder_minutes: reschedule.reminderMinutes,
          outcome_notes: notes || null,
        });
        setOutcomeDialogOpen(false);
        onOpenChange(false);
        return;
      }
      await completeEvent.mutateAsync({
        id: event.id,
        status: scheduleStatusForOutcome(outcome),
        outcome,
        outcomeNotes: notes || null,
        performedBy,
      });
      setOutcomeDialogOpen(false);
      onOpenChange(false);
    } catch {
      // The owning mutation reports the error; keep the result dialog open.
    }
  };

  const handleReopen = async () => {
    if (!canManageSchedule || !event || isMasked) return;
    try {
      await completeEvent.mutateAsync({ id: event.id, status: "scheduled" });
      onOpenChange(false);
    } catch {
      // The owning mutation reports the error; keep the activity open.
    }
  };

  const handleDelete = async () => {
    if (!canManageSchedule || !event || isMasked || preservesAttendanceHistory)
      return;
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
    createEvent.isPending ||
    updateEvent.isPending ||
    completeEvent.isPending ||
    rescheduleEvent.isPending ||
    deleteEvent.isPending;
  const handleSheetOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && (isLoading || outcomeDialogOpen)) return;
    onOpenChange(nextOpen);
  };
  const hasValidTime = Boolean(
    buildScheduleEventInterval({
      date,
      time,
      isAllDay,
      durationMinutes: duration,
      timeZone: scheduleTimeZone,
      preferredStartTime,
    }),
  );
  const canSubmit =
    !draftLocked &&
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
              outcomeDialogOpen ||
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

          <EventSheetHeader
            locked={draftLocked}
            typeLocked={hasAttendanceHistoryLink}
            title={title}
            selectedType={selectedType}
            isLoading={isLoading}
            onTitleChange={setTitle}
            onTypeChange={setSelectedType}
            onClose={() => handleSheetOpenChange(false)}
          />

          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:px-8 sm:pb-2 sm:pt-0">
            <EventSheetFeedback
              isCompleted={isCompleted}
              isMasked={isMasked}
              status={event?.status}
              outcome={event?.outcome}
              outcomeNotes={event?.outcome_notes}
              performedByName={
                event?.performed_by_user?.name ||
                (event?.performed_by === event?.completed_by
                  ? event?.completed_by_user?.name
                  : null)
              }
              completedAt={event?.completed_at}
              attendanceOutcome={requiresAttendanceOutcome}
            />
            <EventTimingSection
              locked={draftLocked}
              timingLocked={preservesAppointmentTiming}
              date={date}
              time={time}
              endTimePreview={endTimePreview}
              isAllDay={isAllDay}
              recurrenceRule={recurrenceRule}
              reminderMinutes={reminderMinutes}
              isExisting={isExisting}
              onDateChange={handleDateChange}
              onTimeChange={handleTimeChange}
              onEndTimeChange={handleEndTimeChange}
              onAllDayChange={handleAllDayChange}
              onRecurrenceChange={setRecurrenceRule}
              onReminderChange={setReminderMinutes}
            />

            <EventAssigneesSection
              isMasked={isMasked}
              locked={draftLocked}
              assigneeDraftReady={assigneeDraftReady}
              assigneesError={assigneesError}
              assigneesFetching={assigneesFetching}
              allAssignees={allAssignees}
              availableUsers={availableUsers}
              users={users}
              assignableTeams={assignableTeams}
              showAssigneePicker={showAssigneePicker}
              selectedTeamId={selectedTeamId}
              primaryUserId={primaryUserId}
              onRetry={() => void refetchAssignees()}
              onRemoveAssignee={(userId) =>
                setDraftAssigneeIds((current) =>
                  current.filter((id) => id !== userId),
                )
              }
              onAssigneePickerChange={setShowAssigneePicker}
              onAddAssignee={(userId) => {
                if (!primaryUserId) setPrimaryUserId(userId);
                else if (!draftAssigneeIds.includes(userId)) {
                  setDraftAssigneeIds((current) => [...current, userId]);
                }
                setShowAssigneePicker(false);
              }}
              onTeamSelect={handleTeamSelect}
              onPrimaryUserChange={setPrimaryUserId}
            />

            <EventVisibilitySection
              locked={draftLocked}
              visibility={visibility}
              onVisibilityChange={setVisibility}
            />

            <EventRelationsSections
              locked={draftLocked}
              isExisting={isExisting}
              isMasked={isMasked}
              selectedLeadId={selectedLeadId}
              selectedLeadName={selectedLeadName}
              showLeadSelector={showLeadSelector}
              leadSearch={leadSearch}
              searchedLeads={searchedLeads}
              canViewProperties={canViewProperties}
              selectedPropertyId={selectedPropertyId}
              selectedPropertyLabel={selectedPropertyLabel}
              allProperties={allProperties}
              propertiesLoading={propertiesLoading}
              onRemoveLead={() => {
                setSelectedLeadId(null);
                setSelectedLeadName(null);
              }}
              onLeadSelectorChange={setShowLeadSelector}
              onLeadSearchChange={setLeadSearch}
              onLeadSelect={(selectedLead) => {
                setSelectedLeadId(selectedLead.id);
                setSelectedLeadName(selectedLead.name);
                setShowLeadSelector(false);
                setLeadSearch("");
              }}
              onPropertyPreview={() => setPropertyPreviewOpen(true)}
              onRemoveProperty={() => {
                setSelectedPropertyId(null);
                setSelectedPropertyLabel(null);
              }}
              onPropertyPickerOpenChange={(nextOpen) => {
                setPropertyPickerOpen(nextOpen);
                if (!nextOpen) setPropertySearch("");
              }}
              onPropertySearchChange={setPropertySearch}
              onPropertySelect={(property) => {
                setSelectedPropertyId(property.id);
                setSelectedPropertyLabel(
                  `${property.code ? `${property.code} · ` : ""}${property.title || "Imóvel"}`,
                );
              }}
            />

            <EventNotesAndComments
              locked={draftLocked}
              isMasked={isMasked}
              isExisting={isExisting}
              description={description}
              comments={comments}
              commentText={commentText}
              canManageSchedule={canManageSchedule}
              isAdding={isAdding}
              onDescriptionChange={setDescription}
              onCommentChange={setCommentText}
              onSendComment={handleSendComment}
            />
          </div>

          <EventSheetActions
            canManageSchedule={canManageSchedule}
            isExisting={isExisting}
            isMasked={isMasked}
            isCompleted={isCompleted}
            canReopen={canReopen}
            canDelete={!preservesAttendanceHistory}
            requiresAttendanceOutcome={requiresAttendanceOutcome}
            isLoading={isLoading}
            locked={locked}
            isEditing={isEditing}
            canSubmit={Boolean(canSubmit)}
            onDelete={() => void handleDelete()}
            onMarkDone={() => void handleMarkDone()}
            onReopen={() => void handleReopen()}
            onReset={resetDraft}
            onStartEditing={() => {
              if (draftReady) setIsEditing(true);
            }}
            onClose={() => onOpenChange(false)}
            onSubmit={() => void handleSubmit()}
          />
        </SheetContent>
      </Sheet>
      {event && outcomeDialogOpen && (
        <ScheduleOutcomeDialog
          open={outcomeDialogOpen}
          onOpenChange={setOutcomeDialogOpen}
          eventType={outcomeEventType}
          users={outcomeUsers}
          defaultPerformerId={event.user_id || outcomeUsers[0]?.id}
          eventStartTime={event.start_time}
          eventEndTime={event.end_time}
          eventIsAllDay={event.is_all_day}
          eventReminderMinutes={event.reminder_minutes}
          timeZone={scheduleTimeZone}
          isLoading={completeEvent.isPending || rescheduleEvent.isPending}
          onConfirm={handleOutcomeConfirm}
        />
      )}
      <PropertyPreviewDialog
        property={previewProperty}
        open={propertyPreviewOpen}
        onOpenChange={setPropertyPreviewOpen}
        formatPrice={formatPropertyPrice}
      />
    </>
  );
}
