import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { LostReasonDialog } from "@/components/features/leads/LostReasonDialog";
import { PropertyPickerDialog } from "@/components/features/properties/PropertyPickerDialog";
import { EventForm } from "@/components/features/schedule/EventForm";
import { CopyLeadPhoneButton } from "@/components/features/leads/CopyLeadPhoneButton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Textarea } from "@/components/ui/textarea";
import {
  Building2,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  ExternalLink,
  FileEdit,
  FileText,
  Info,
  ListTodo,
  Loader2,
  Mail,
  MapPin,
  MessageCircle,
  Paperclip,
  Phone,
  Plus,
  User,
  UserPlus,
  X,
} from "lucide-react";
import { formatPhoneForDisplay } from "@/lib/phone-utils";
import { cn } from "@/lib/utils";
import { commandSearchFilter } from "@/lib/search-text";
import { format, type Locale } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useConversationLeadDetail } from "@/hooks/use-conversation-lead-detail";
import { useTags } from "@/hooks/use-tags";
import { useUpdateLead } from "@/hooks/use-leads";
import { useAddLeadTag, useRemoveLeadTag } from "@/hooks/use-leads";
import { useProperties } from "@/hooks/use-properties";
import { useUsers } from "@/hooks/use-users";
import { useLeadAttachments, useUploadLeadAttachment, type LeadAttachment } from "@/hooks/use-lead-attachments";
import { useScheduleEvents, type EventType, type ScheduleEvent } from "@/hooks/use-schedule-events";
import { useDealStatusChange } from "@/hooks/use-deal-status-change";
import { useAuth } from "@/contexts/AuthContext";
import { useUserPermissions } from "@/hooks/use-user-permissions";
import { leadsAPI } from "@/lib/api/leads";
import type { ConversationLeadDetail } from "@/lib/api/conversation-lead-detail";

interface ConversationLeadPanelProps {
  leadId: string;
  onClose: () => void;
  className?: string;
  contactPicture?: string | null;
}

const DEAL_STATUS_OPTIONS = [
  { value: "open", label: "Aberto", color: "hsl(var(--muted-foreground))" },
  { value: "won", label: "Ganho", color: "#16a34a" },
  { value: "lost", label: "Perdido", color: "hsl(var(--destructive))" },
];

const SOURCE_LABELS: Record<string, string> = {
  facebook: "Facebook",
  google: "Google",
  manual: "Manual",
  meta: "Meta",
  outro: "outro",
  site: "Site",
  whatsapp: "Whatsapp",
};

const sectionTitleClassName = "leading-none";
const sectionTitleStyle = {
  color: "var(--app-text-secondary)",
  fontSize: "11px",
  fontWeight: 400,
  letterSpacing: 0,
};
const panelSectionClassName = "min-w-0 rounded-[8px] bg-[var(--app-surface-soft)] p-3";

const scheduleEventTypeLabels: Record<EventType, string> = {
  call: "Ligacao",
  email: "E-mail",
  meeting: "Reuniao",
  task: "Tarefa",
  message: "Mensagem",
  visit: "Visita",
};

const scheduleEventTypeIcons: Record<EventType, typeof Phone> = {
  call: Phone,
  email: Mail,
  meeting: Calendar,
  task: ListTodo,
  message: MessageCircle,
  visit: MapPin,
};

type LeadTagRelation = {
  tag: {
    id: string;
    name: string;
    color: string;
  };
};

function InfoLine({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-3 text-xs">
      <span className="shrink-0 text-[var(--app-text-tertiary)]">{label}</span>
      <span className="flex min-w-0 flex-1 justify-end break-words text-right font-medium text-[var(--app-text-primary)]">{value}</span>
    </div>
  );
}

type ConversationLeadMeta = ConversationLeadDetail["meta"];

function metaText(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function hasLeadTrackingData(leadMeta: ConversationLeadMeta | null | undefined) {
  if (!leadMeta) return false;
  return [
    leadMeta.campaign_name,
    leadMeta.ad_name,
    leadMeta.form_name,
    leadMeta.utm_campaign,
    leadMeta.utm_medium,
    leadMeta.utm_source,
    leadMeta.contact_notes,
    leadMeta.creative_url,
    leadMeta.creative_video_url,
  ].some((value) => Boolean(metaText(value)));
}

function CampaignTrackingHover({
  leadMeta,
  fallbackLabel,
}: {
  leadMeta: ConversationLeadMeta | null | undefined;
  fallbackLabel: string;
}) {
  if (!hasLeadTrackingData(leadMeta)) return <>{fallbackLabel}</>;

  const displayName =
    metaText(leadMeta?.campaign_name) ||
    metaText(leadMeta?.utm_campaign) ||
    metaText(leadMeta?.ad_name) ||
    metaText(leadMeta?.form_name) ||
    fallbackLabel;
  const mainRows = [
    ["Campanha", leadMeta?.campaign_name || leadMeta?.utm_campaign],
    ["Conjunto", null],
    ["Anuncio", leadMeta?.ad_name],
    ["Formulario", leadMeta?.form_name],
    ["Plataforma", fallbackLabel],
    ["Origem", leadMeta?.utm_source],
  ] as const;
  const utmRows = [
    ["utm_source", leadMeta?.utm_source],
    ["utm_medium", leadMeta?.utm_medium],
    ["utm_campaign", leadMeta?.utm_campaign],
  ] as const;
  const links = [
    ["Criativo", leadMeta?.creative_url],
    ["Video", leadMeta?.creative_video_url],
  ] as const;
  const DetailRow = ({ label, value }: { label: string; value: unknown }) => {
    const text = metaText(value);
    if (!text) return null;

    return (
      <div className="grid grid-cols-[100px_minmax(0,1fr)] gap-2 text-left text-[11px] leading-snug">
        <span className="text-[var(--app-text-tertiary)]">{label}</span>
        <span className="break-words text-left font-medium text-[var(--app-text-primary)]">{text}</span>
      </div>
    );
  };
  const hasUtms = utmRows.some(([, value]) => Boolean(metaText(value)));
  const hasLinks = links.some(([, value]) => Boolean(metaText(value)));

  return (
    <HoverCard openDelay={100} closeDelay={420}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className="group inline-flex min-w-0 max-w-[180px] items-center justify-end gap-1 overflow-hidden whitespace-nowrap text-right font-medium text-[var(--app-text-primary)] outline-none transition-colors hover:text-primary focus-visible:text-primary"
          title={displayName}
        >
          <span className="min-w-0 truncate underline decoration-dotted decoration-[var(--app-text-tertiary)] underline-offset-4 group-hover:decoration-primary group-focus-visible:decoration-primary">
            {displayName}
          </span>
          <Info className="h-3 w-3 shrink-0 text-[var(--app-text-tertiary)] transition-colors group-hover:text-primary group-focus-visible:text-primary" />
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        side="left"
        align="center"
        sideOffset={4}
        className="vimob-popover-content z-[100] w-[min(420px,calc(100vw-2rem))] rounded-[8px] border-0 p-0 text-left text-[var(--app-text-primary)] shadow-[0_22px_70px_rgba(0,0,0,0.28)] dark:shadow-[0_22px_70px_rgba(0,0,0,0.58)]"
      >
        <div className="border-b border-[var(--app-border)] px-3 py-2 text-left">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-primary">Rastreamento de Campanha</p>
        </div>

        <div className="max-h-[420px] space-y-3 overflow-y-auto p-3 text-left">
          <div className="space-y-1.5">
            {mainRows.map(([label, value]) => (
              <DetailRow key={label} label={label} value={value} />
            ))}
          </div>

          {hasUtms && (
            <div className="space-y-1.5 border-t border-[var(--app-border)] pt-3 text-left">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--app-text-tertiary)]">UTMs</p>
              {utmRows.map(([label, value]) => (
                <DetailRow key={label} label={label} value={value} />
              ))}
            </div>
          )}

          {leadMeta?.contact_notes && (
            <div className="border-t border-[var(--app-border)] pt-3 text-left">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--app-text-tertiary)]">Observações</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-snug text-[var(--app-text-secondary)]">
                {leadMeta.contact_notes}
              </p>
            </div>
          )}

          {hasLinks && (
            <div className="flex flex-wrap gap-2 border-t border-[var(--app-border)] pt-3 text-left">
              {links.map(([label, value]) => {
                const href = metaText(value);
                if (!href) return null;
                return (
                  <a
                    key={label}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-[6px] bg-[var(--app-surface-soft)] px-2 py-1 text-[11px] font-medium text-[var(--app-text-secondary)] transition-colors hover:text-primary"
                  >
                    <span>{label}</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                );
              })}
            </div>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

function getScheduleEventType(value?: string | null): EventType {
  return value === "email" ||
    value === "meeting" ||
    value === "task" ||
    value === "message" ||
    value === "visit"
    ? value
    : "call";
}

function getScheduleStatusLabel(status?: string | null, isLate = false) {
  if (status === "completed") return "Concluido";
  if (status === "cancelled" || status === "canceled") return "Cancelado";
  if (status === "no_show") return "Nao compareceu";
  if (isLate) return "Atrasado";
  return "Em aberto";
}

function getScheduleStatusClass(status?: string | null, isLate = false) {
  if (status === "completed") return "bg-emerald-500/12 text-emerald-500";
  if (status === "cancelled" || status === "canceled") return "bg-red-500/12 text-red-500";
  if (status === "no_show") return "bg-amber-500/12 text-amber-500";
  if (isLate) return "bg-red-500/12 text-red-500";
  return "bg-primary/12 text-primary";
}

function getScheduleDateLabel(event: ScheduleEvent, locale: Locale) {
  const startDate = new Date(event.start_time);
  const endDate = new Date(event.end_time);
  const dateLabel = format(startDate, "dd/MM", { locale });
  const startTime = format(startDate, "HH:mm", { locale });
  const endTime = format(endDate, "HH:mm", { locale });

  if (event.is_all_day) return `${dateLabel} - dia todo`;
  if (event.end_time && startTime !== endTime) return `${dateLabel} ${startTime}-${endTime}`;
  return `${dateLabel} ${startTime}`;
}

function CompactScheduleEventsList({
  events,
  locale,
  onEditEvent,
}: {
  events: ScheduleEvent[];
  locale: Locale;
  onEditEvent?: (event: ScheduleEvent) => void;
}) {
  const [currentTime] = useState(() => Date.now());
  const sortedEvents = [...events].sort((left, right) => {
    const leftCompleted = left.status === "completed";
    const rightCompleted = right.status === "completed";
    if (leftCompleted !== rightCompleted) return leftCompleted ? 1 : -1;
    return new Date(left.start_time).getTime() - new Date(right.start_time).getTime();
  });

  if (sortedEvents.length === 0) {
    return (
      <p className="mt-3 rounded-[6px] bg-[var(--app-surface-solid)] px-3 py-2 text-xs text-[var(--app-text-tertiary)]">
        Nenhum compromisso agendado
      </p>
    );
  }

  return (
    <div
      className={cn(
        "mt-3 space-y-1.5 overflow-y-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        sortedEvents.length > 2 ? "h-[148px]" : "max-h-[148px]",
      )}
    >
      {sortedEvents.map((event) => {
        const eventType = getScheduleEventType(event.event_type);
        const EventIcon = scheduleEventTypeIcons[eventType] || Calendar;
        const isCompleted = event.status === "completed";
        const isLate = !isCompleted && new Date(event.start_time).getTime() < currentTime;

        return (
          <button
            key={event.id}
            type="button"
            disabled={!onEditEvent}
            onClick={() => onEditEvent?.(event)}
            className={cn(
              "flex w-full items-center gap-2 rounded-[6px] bg-[var(--app-surface-solid)] px-2.5 py-1.5 text-left transition-colors hover:bg-primary/10 disabled:cursor-default disabled:hover:bg-[var(--app-surface-solid)]",
              isCompleted && "opacity-65",
            )}
          >
            <span
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px]",
                isCompleted ? "bg-emerald-500/18 text-emerald-500" : "bg-primary/12 text-primary",
              )}
            >
              {isCompleted ? <Check className="h-3 w-3" /> : <EventIcon className="h-3 w-3" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className={cn("block truncate text-[11px] font-medium leading-tight", isCompleted && "line-through")}>
                {event.title || scheduleEventTypeLabels[eventType]}
              </span>
              <span className="mt-px flex min-w-0 flex-wrap items-center gap-1 text-[10.5px] font-medium leading-tight text-[var(--app-text-secondary)]">
                <span className="font-semibold text-[var(--app-text-primary)]">{scheduleEventTypeLabels[eventType]}</span>
                <span>-</span>
                <span>{getScheduleDateLabel(event, locale)}</span>
                {!isCompleted && (
                  <span className={cn("rounded-[4px] px-1.5 py-0.5 font-medium", getScheduleStatusClass(event.status, isLate))}>
                    {getScheduleStatusLabel(event.status, isLate)}
                  </span>
                )}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function getDealStatusTriggerClass(status?: string | null) {
  if (status === "won") {
    return "border-0 bg-emerald-500 text-white hover:bg-emerald-600";
  }

  if (status === "lost") {
    return "border-0 bg-destructive text-destructive-foreground hover:bg-destructive/90";
  }

  return "border-0 bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-hover)]";
}

function formatSource(source?: string | null) {
  if (!source) return "outro";
  return SOURCE_LABELS[source.toLowerCase()] || source;
}

function formatPropertyLabel(property?: { code?: string | null; title?: string | null } | null) {
  if (!property) return "Nenhum";

  const code = property.code || "";
  const title = property.title || "Sem título";
  const full = code ? `${code} - ${title}` : title;

  return full.length > code.length + 13 ? `${full.slice(0, code.length + 13)}...` : full;
}

function getAttachmentLabel(attachment: LeadAttachment) {
  return attachment.file_name || "Documento";
}

export function ConversationLeadPanel({ leadId, className, contactPicture }: ConversationLeadPanelProps) {
  const queryClient = useQueryClient();
  const { profile, organization } = useAuth();
  const { hasPermission } = useUserPermissions();
  const canOperateLead = hasPermission("lead_operate");
  const canViewProperties = hasPermission("property_view") || hasPermission("property_manage");
  const canViewSchedule = hasPermission("schedule_view");
  const canManageSchedule = canOperateLead && hasPermission("schedule_manage");
  const organizationId = profile?.organization_id || organization?.id || undefined;
  const { data: lead, isLoading } = useConversationLeadDetail(leadId);
  const { data: allTags } = useTags();
  const { data: properties = [] } = useProperties(undefined, {}, { enabled: canViewProperties });
  const { data: users = [] } = useUsers();
  const { data: attachments = [] } = useLeadAttachments(leadId);
  const { data: scheduleEvents = [] } = useScheduleEvents({ leadId, enabled: canViewSchedule });
  const uploadAttachment = useUploadLeadAttachment();
  const updateLead = useUpdateLead();
  const addTag = useAddLeadTag();
  const removeTag = useRemoveLeadTag();
  const dealStatusChange = useDealStatusChange();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [assigneePopoverOpen, setAssigneePopoverOpen] = useState(false);
  const [isAssigning, setIsAssigning] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [lostReasonDialogOpen, setLostReasonDialogOpen] = useState(false);
  const [scheduleFormOpen, setScheduleFormOpen] = useState(false);
  const [editingScheduleEvent, setEditingScheduleEvent] = useState<ScheduleEvent | null>(null);
  const [scheduleDefaultType, setScheduleDefaultType] = useState<EventType>("visit");

  if (isLoading) {
    return (
      <div className={cn("flex items-center justify-center", className)}>
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!lead) return null;

  const leadTags = (lead.tags || []) as LeadTagRelation[];
  const leadTagIds = leadTags.map((lt) => lt.tag.id);
  const availableTagsToAdd = (allTags || []).filter((tag) => !leadTagIds.includes(tag.id));
  const selectedPropertyId = lead.interest_property_id || lead.property_id || null;
  const selectedProperty = properties.find((property) => property.id === selectedPropertyId);
  const currentAssignee = users.find((user) => user.id === lead.assigned_user_id);
  const assigneeName = currentAssignee?.name || currentAssignee?.email || "Sem responsável";
  const canAssignAnyLead = canOperateLead;
  const canAssignCurrentLead = canOperateLead;
  const dealStatus = lead.deal_status || "open";
  const dealStatusLabel = dealStatus === "won" ? "Ganho" : dealStatus === "lost" ? "Perdido" : "Aberto";
  const phoneDigits = lead.phone?.replace(/\D/g, "") || "";
  const sourceLabel = formatSource(lead.source);
  const sourceValue = hasLeadTrackingData(lead.meta) ? (
    <CampaignTrackingHover leadMeta={lead.meta} fallbackLabel={sourceLabel} />
  ) : sourceLabel;
  const contactRows = [
    { label: "Nome", value: lead.name },
    { label: "Telefone", value: lead.phone ? formatPhoneForDisplay(lead.phone) : null },
    { label: "E-mail", value: lead.email },
    { label: "Origem", value: sourceValue },
    { label: "Criado em", value: lead.created_at ? format(new Date(lead.created_at), "dd/MM/yy HH:mm") : null },
  ].filter((row) => Boolean(row.value));

  const refreshLeadData = () => {
    void queryClient.invalidateQueries({ queryKey: ["conversation-lead-detail"] });
    void queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] });
    void queryClient.invalidateQueries({ queryKey: ["leads"] });
    void queryClient.invalidateQueries({ queryKey: ["stages-with-leads"] });
  };

  const handleDealStatusChange = (newStatus: string) => {
    if (!canOperateLead) return;
    if (newStatus === dealStatus) return;

    if (newStatus === "lost") {
      setLostReasonDialogOpen(true);
      return;
    }

    dealStatusChange.mutate(
      {
        leadId,
        newStatus: newStatus as "open" | "won" | "lost",
        organizationId: organizationId || "",
        organizationName: organization?.name || null,
        userId: lead.assigned_user_id ?? null,
        propertyId: lead.interest_property_id || lead.property_id || null,
        valorInteresse: lead.valor_interesse ?? null,
        commissionPercentage: lead.commission_percentage ?? null,
        leadName: lead.name || "Lead",
      },
      { onSuccess: refreshLeadData },
    );
  };

  const handleConfirmLostReason = async (reason: string) => {
    if (!canOperateLead) return;
    await dealStatusChange.mutateAsync({
      leadId,
      newStatus: "lost",
      organizationId: organizationId || "",
      organizationName: organization?.name || null,
      userId: lead.assigned_user_id ?? null,
      propertyId: lead.interest_property_id || lead.property_id || null,
      valorInteresse: lead.valor_interesse ?? null,
      commissionPercentage: lead.commission_percentage ?? null,
      leadName: lead.name || "Lead",
      lostReason: reason,
    });
    refreshLeadData();
    setLostReasonDialogOpen(false);
  };

  const handleAssignUser = async (userId: string | null) => {
    if (userId === lead.assigned_user_id) {
      setAssigneePopoverOpen(false);
      return;
    }
    if (!canAssignCurrentLead) {
      toast.error("Você só pode trocar o responsável dos seus próprios leads");
      setAssigneePopoverOpen(false);
      return;
    }
    if (!userId && !canAssignAnyLead) {
      toast.error("Você só pode transferir seus leads para outro usuário");
      setAssigneePopoverOpen(false);
      return;
    }

    setIsAssigning(true);
    setAssigneePopoverOpen(false);

    try {
      const { error } = await leadsAPI.assignLead(lead.id, userId, organizationId);
      if (error) throw error;
      refreshLeadData();
      toast.success("Responsável atualizado");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido";
      toast.error(`Erro ao atualizar responsável: ${message}`);
    } finally {
      setIsAssigning(false);
    }
  };

  const handlePropertySelect = async (property: { id: string; preco?: number | null; commission_percentage?: number | null }) => {
    if (!canOperateLead || !canViewProperties) return;
    const nextUpdate: {
      id: string;
      property_id: string;
      interest_property_id: string;
      valor_interesse?: number | null;
      commission_percentage?: number | null;
    } = {
      id: lead.id,
      property_id: property.id,
      interest_property_id: property.id,
    };

    if (typeof property.preco === "number") {
      nextUpdate.valor_interesse = property.preco;
    }

    if (typeof property.commission_percentage === "number") {
      nextUpdate.commission_percentage = property.commission_percentage;
    }

    await updateLead.mutateAsync(nextUpdate);
    refreshLeadData();
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!canOperateLead) return;
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);

    try {
      await uploadAttachment.mutateAsync({ leadId: lead.id, file });
      toast.success("Documento enviado com sucesso!");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido";
      toast.error(`Erro ao enviar: ${message}`);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSaveFeedback = async () => {
    if (!canOperateLead) return;
    const savedFeedback = feedback.trim();
    if (!savedFeedback) return;

    try {
      await updateLead.mutateAsync({ id: lead.id, feedback: savedFeedback });
      setFeedback("");
      toast.success("Feedback registrado com sucesso!");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido";
      toast.error(`Erro ao registrar feedback: ${message}`);
    }
  };

  const handleOpenScheduleForm = () => {
    if (!canManageSchedule) return;
    setEditingScheduleEvent(null);
    setScheduleDefaultType("visit");
    setScheduleFormOpen(true);
  };

  const handleEditScheduleEvent = (event: ScheduleEvent) => {
    if (!canManageSchedule) return;
    setEditingScheduleEvent(event);
    setScheduleFormOpen(true);
  };

  const handleCloseScheduleForm = () => {
    setScheduleFormOpen(false);
    setEditingScheduleEvent(null);
  };

  return (
    <div
      className={cn(
        "lead-detail-dialog lead-detail-v2 flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl bg-[var(--app-surface-solid)] text-[var(--app-text-primary)]",
        className,
      )}
    >
      <div className="relative min-w-0 shrink-0 border-b border-[var(--app-border)] bg-[var(--app-surface-solid)] px-4 pb-3 pt-4">
        <div className="flex items-start gap-2.5">
          <Avatar className="h-12 w-12 shrink-0 border-0">
            <AvatarImage src={contactPicture || undefined} alt={lead.name || "Lead"} />
            <AvatarFallback className="bg-primary text-base font-semibold text-white">
              {lead.name?.[0]?.toUpperCase() || <User className="h-5 w-5" />}
            </AvatarFallback>
          </Avatar>

          <div className="min-w-0 flex-1 overflow-hidden">
            <h2 className="truncate text-base font-semibold leading-tight">{lead.name || "Lead"}</h2>
            {lead.phone && (
              <div className="mt-1 flex min-w-0 items-center gap-1.5">
                <p className="truncate text-xs text-[var(--app-text-tertiary)]">{formatPhoneForDisplay(lead.phone)}</p>
                <CopyLeadPhoneButton phone={lead.phone} className="h-6 w-6 bg-transparent hover:bg-[var(--app-surface-soft)] md:hidden" />
              </div>
            )}

            <div className="mt-2 flex flex-wrap gap-1.5">
              {leadTags.slice(0, 4).map((leadTag) => (
                <Badge
                  key={leadTag.tag.id}
                  className="flex h-5 items-center gap-1 rounded-[4px] border-0 px-1.5 text-[10px]"
                  style={{ backgroundColor: leadTag.tag.color, color: "#fff" }}
                >
                  <span className="max-w-[82px] truncate">{leadTag.tag.name || "Tag"}</span>
                  <button
                    type="button"
                    disabled={!canOperateLead}
                    className="rounded-[3px] p-0.5 hover:bg-black/10 disabled:hidden"
                    onClick={() => removeTag.mutate({ leadId, tagId: leadTag.tag.id })}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </Badge>
              ))}
              {leadTags.length > 4 && (
                <Badge variant="secondary" className="h-5 rounded-[4px] border-0 px-1.5 text-[10px]">
                  +{leadTags.length - 4}
                </Badge>
              )}
              {canOperateLead && availableTagsToAdd.length > 0 && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-5 rounded-[5px] border-0 bg-[var(--app-surface-soft)] px-1.5 text-[10px]"
                    >
                      <Plus className="mr-1 h-3 w-3" />
                      Tag
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 p-1" align="start">
                    <div className="max-h-64 overflow-y-auto">
                      {availableTagsToAdd.map((tag) => (
                        <button
                          key={tag.id}
                          type="button"
                          className="flex w-full items-center gap-2 rounded-[6px] px-2 py-2 text-left text-xs hover:bg-accent"
                          onClick={() => addTag.mutate({ leadId, tagId: tag.id })}
                        >
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
                          <span className="truncate">{tag.name}</span>
                        </button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              )}
            </div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          <Popover open={assigneePopoverOpen} onOpenChange={setAssigneePopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                disabled={!canAssignCurrentLead || isAssigning}
                className="h-8 min-w-0 justify-start rounded-[6px] bg-[var(--app-surface-soft)] px-2.5 text-xs text-[var(--app-text-secondary)]"
              >
                <User className="mr-1.5 h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{assigneeName}</span>
                {isAssigning ? <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin" /> : <ChevronDown className="ml-auto h-3.5 w-3.5" />}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[300px] overflow-hidden border-0 bg-[var(--app-surface-solid)] p-1 shadow-2xl" align="start" collisionPadding={12}>
              <Command filter={commandSearchFilter} className="max-h-[min(72vh,430px)] border-none bg-transparent [&_[cmdk-input-wrapper]]:border-b-0 [&_[cmdk-input-wrapper]]:px-2">
                <CommandInput placeholder="Buscar responsável..." className="h-10 border-none focus:ring-0" />
                <CommandList className="max-h-[min(58vh,340px)] overflow-y-auto overscroll-contain p-1 touch-pan-y scrollbar-thin">
                  <CommandEmpty className="py-4 text-center text-sm text-muted-foreground">Nenhum encontrado.</CommandEmpty>
                  <CommandGroup>
                    {canAssignAnyLead && (
                    <CommandItem onSelect={() => void handleAssignUser(null)} className="cursor-pointer rounded-[6px] px-3 py-2">
                      Sem responsável
                    </CommandItem>
                    )}
                    {users.map((user) => (
                      <CommandItem key={user.id} onSelect={() => void handleAssignUser(user.id)} className="cursor-pointer rounded-[6px] px-3 py-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <Avatar className="h-7 w-7">
                            <AvatarImage src={user.avatar_url || undefined} />
                            <AvatarFallback className="text-[10px]">{(user.name || user.email || "U")[0]}</AvatarFallback>
                          </Avatar>
                          <span className="truncate">{user.name || user.email}</span>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          <Select value={dealStatus} onValueChange={handleDealStatusChange} disabled={!canOperateLead}>
            <SelectTrigger className={cn("h-8 w-[92px] gap-1 rounded-[6px] px-2 text-xs font-medium", getDealStatusTriggerClass(dealStatus))}>
              <SelectValue>{dealStatusLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {DEAL_STATUS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  <span className="flex items-center gap-2">
                    <CircleDot className="h-3.5 w-3.5" style={{ color: option.color }} />
                    {option.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!phoneDigits}
            onClick={() => window.open(`tel:${phoneDigits}`, "_blank")}
            className="h-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)]"
          >
            <Phone className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!lead.email}
            onClick={() => lead.email && window.open(`mailto:${lead.email}`, "_blank")}
            className="h-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)]"
          >
            <Mail className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <ScrollArea className="min-h-0 min-w-0 flex-1">
        <div className="min-w-0 space-y-3 p-3 pb-4">
          <section className={panelSectionClassName}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className={sectionTitleClassName} style={sectionTitleStyle}>Dados do contato</h3>
              <Button variant="ghost" size="sm" className="lead-detail-subtle-action h-7 rounded-[5px] px-2 text-[10px]" asChild>
                <Link href={`/crm/pipelines?lead=${lead.id}`}>
                  <FileEdit className="h-3 w-3" />
                  Editar
                </Link>
              </Button>
            </div>

            <div className="space-y-2">
              {contactRows.map((row) => (
                <InfoLine key={row.label} label={row.label} value={row.value} />
              ))}
            </div>
          </section>

          <PropertyPickerDialog
            properties={properties}
            selectedPropertyId={selectedPropertyId}
            onSelect={(property) => void handlePropertySelect(property)}
            disabled={!canOperateLead || !canViewProperties}
            trigger={
              <Button
                type="button"
                variant="ghost"
                disabled={!canOperateLead || !canViewProperties}
                className="h-10 w-full min-w-0 justify-between rounded-[8px] border-0 bg-[var(--app-surface-soft)] px-3 text-xs text-[var(--app-text-secondary)] shadow-none hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{formatPropertyLabel(selectedProperty)}</span>
                </div>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </Button>
            }
          />

          <section className={panelSectionClassName}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className={sectionTitleClassName} style={sectionTitleStyle}>Documentação</h3>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="lead-detail-subtle-action h-7 rounded-[5px] px-2 text-[10px]"
                disabled={!canOperateLead || isUploading || uploadAttachment.isPending}
                onClick={() => fileInputRef.current?.click()}
              >
                {isUploading || uploadAttachment.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />}
                Anexar
              </Button>
              <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileUpload} />
            </div>

            {attachments.length > 0 && (
              <div className="space-y-2">
                {attachments.slice(0, 4).map((attachment) => (
                  <button
                    key={attachment.id}
                    type="button"
                    className="flex w-full items-center gap-2 rounded-[6px] border-0 bg-[var(--app-surface-solid)] px-2 py-2 text-left text-xs outline-none ring-0 hover:bg-[var(--app-surface-hover)] focus:outline-none focus-visible:outline-none focus-visible:ring-0"
                    onClick={() => window.open(attachment.file_url, "_blank")}
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0 text-primary" />
                    <span className="truncate">{getAttachmentLabel(attachment)}</span>
                  </button>
                ))}
                {attachments.length > 4 && (
                  <p className="px-1 text-[10px] text-[var(--app-text-tertiary)]">+{attachments.length - 4} documento(s)</p>
                )}
              </div>
            )}
          </section>

          <section className={cn("lead-agenda-card", panelSectionClassName)}>
            <div className="flex items-center justify-between gap-3">
              <div className="lead-agenda-summary min-w-0">
                <h3 className={sectionTitleClassName} style={sectionTitleStyle}>Agenda</h3>
                <p className="text-[10px] text-[var(--app-text-tertiary)]">{scheduleEvents.length} compromisso(s)</p>
              </div>
              <Button
                size="sm"
                disabled={!canManageSchedule}
                className="lead-detail-primary-action lead-agenda-action h-8 shrink-0 rounded-[6px] px-2.5"
                onClick={handleOpenScheduleForm}
              >
                <Calendar className="h-3.5 w-3.5" />
                Agendar
              </Button>
            </div>
            <CompactScheduleEventsList
              events={scheduleEvents}
              locale={ptBR}
              onEditEvent={canManageSchedule ? handleEditScheduleEvent : undefined}
            />
          </section>

          <section className={panelSectionClassName}>
            <Textarea
              placeholder="Registre o feedback sobre atendimento, perfil ou próximos passos..."
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
              disabled={!canOperateLead}
              className="min-h-[92px] resize-none rounded-[6px] border-0 bg-[var(--app-surface-solid)] text-xs"
            />
            <div className="mt-2 flex justify-end">
              <Button className="lead-detail-primary-action h-8 rounded-[6px] px-3" disabled={!canOperateLead || !feedback.trim() || updateLead.isPending} onClick={handleSaveFeedback}>
                Registrar feedback
              </Button>
            </div>
          </section>
        </div>
      </ScrollArea>

      {canManageSchedule && <EventForm
        open={scheduleFormOpen}
        onOpenChange={(open) => {
          if (!open) handleCloseScheduleForm();
          else setScheduleFormOpen(true);
        }}
        event={editingScheduleEvent}
        leadId={lead.id}
        leadName={lead.name}
        defaultUserId={lead.assigned_user_id || profile?.id || undefined}
        defaultType={scheduleDefaultType}
      />}

      <LostReasonDialog
        open={lostReasonDialogOpen}
        onOpenChange={setLostReasonDialogOpen}
        onConfirm={handleConfirmLostReason}
        leadName={lead.name}
        loading={dealStatusChange.isPending}
      />
    </div>
  );
}

interface ConversationUnregisteredPanelProps {
  contactName?: string | null;
  contactPhone?: string | null;
  contactPicture?: string | null;
  isGroup?: boolean;
  onCreateLead: () => void;
  className?: string;
}

export function ConversationUnregisteredPanel({
  contactName,
  contactPhone,
  contactPicture,
  isGroup,
  onCreateLead,
  className,
}: ConversationUnregisteredPanelProps) {
  const displayName =
    contactName && contactName !== contactPhone
      ? contactName
      : formatPhoneForDisplay(contactPhone || "") || "Contato";

  return (
    <aside
      className={cn(
        "lead-detail-dialog lead-detail-v2 flex h-full min-h-0 flex-col overflow-hidden rounded-2xl bg-[var(--app-surface-solid)] text-[var(--app-text-primary)]",
        className,
      )}
    >
      <div className="flex shrink-0 flex-col items-center border-b border-[var(--app-border)] px-4 py-5 text-center">
        <Avatar className="h-14 w-14 border-0">
          <AvatarImage src={contactPicture || undefined} alt={displayName} />
          <AvatarFallback className="bg-[var(--app-surface-soft)] text-base font-medium text-[var(--app-text-secondary)]">
            {isGroup ? <User className="h-5 w-5" /> : displayName[0]?.toUpperCase() || "?"}
          </AvatarFallback>
        </Avatar>
        <h2 className="mt-3 max-w-full truncate text-sm font-medium">{displayName}</h2>
        {contactPhone && (
          <p className="mt-1 text-xs text-[var(--app-text-tertiary)]">{formatPhoneForDisplay(contactPhone)}</p>
        )}
        <Badge className="mt-3 rounded-[5px] border-0 bg-amber-500/14 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-300">
          Não cadastrado
        </Badge>
      </div>

      <div className="flex flex-1 flex-col justify-center gap-4 px-4 py-5 text-center">
        <div className="rounded-[8px] bg-[var(--app-surface-soft)] px-3 py-4">
          <p className="text-sm font-medium text-[var(--app-text-primary)]">Criar lead para esta conversa</p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--app-text-tertiary)]">
            Vincule este contato para acompanhar etapa, responsavel, agenda, documentacao e historico comercial.
          </p>
        </div>

        <Button className="lead-detail-primary-action h-8 rounded-[6px] px-3" onClick={onCreateLead}>
          <UserPlus className="h-3.5 w-3.5" />
          Cadastrar lead
        </Button>
      </div>
    </aside>
  );
}
