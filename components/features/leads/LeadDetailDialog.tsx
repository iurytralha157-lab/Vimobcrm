import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { PropertyPickerDialog } from '@/components/features/properties/PropertyPickerDialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InternationalPhoneInput } from '@/components/shared/forms/InternationalPhoneInput';
import { Textarea } from '@/components/ui/textarea';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Phone, Mail, MessageCircle, Loader2, X, Plus, Save, User,
  Calendar, FileEdit, Activity, Contact,
  ChevronDown, FileText, Paperclip
} from 'lucide-react';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from '@/lib/utils';
import { getTagColorStyleWithWhiteText } from '@/lib/tag-color';
import { commandSearchFilter } from '@/lib/search-text';
import { format } from 'date-fns';
import { ptBR, enUS } from 'date-fns/locale';
import { useCompleteCadenceTask } from '@/hooks/use-lead-tasks';
import { useLeadCadenceState } from '@/hooks/leads/use-lead-cadence-state';
import { useCreateActivity } from '@/hooks/use-activities';
import { useLead, useUpdateLead, useAddLeadTag, useRemoveLeadTag } from '@/hooks/use-leads';
import type { Lead } from '@/hooks/use-leads';
import { useProperties } from '@/hooks/use-properties';
import { useScheduleEvents, ScheduleEvent, EventType } from '@/hooks/use-schedule-events';
import { useLeadMeta } from '@/hooks/use-lead-meta';
import { useLeadAttachments, useUploadLeadAttachment, type LeadAttachment } from '@/hooks/use-lead-attachments';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { useFloatingChat } from '@/contexts/FloatingChatContext';
import { LeadUnifiedThread } from '@/components/features/leads/LeadUnifiedThread';
import { ReentryBadge } from '@/components/features/leads/ReentryBadge';
import { CopyLeadPhoneButton } from '@/components/features/leads/CopyLeadPhoneButton';
import { LeadCadencePanel } from '@/components/features/leads/LeadCadencePanel';

import type { TaskOutcome } from '@/components/features/leads/TaskOutcomeDialog';
import { toast } from 'sonner';
import { formatPhoneForDisplay, normalizePhoneToE164 } from '@/lib/phone-utils';
import { TagSelectorPopoverContent } from '@/components/ui/tag-selector';
import { useUpdateLeadCommission } from '@/hooks/use-update-commission';
import { useDealStatusChange } from '@/hooks/use-deal-status-change';
import { useCreateCall } from '@/hooks/use-telephony';
import { useRecordFirstResponseOnAction } from '@/hooks/use-first-response';
import { useOrganizationModules } from '@/hooks/use-organization-modules';
import { useUserPermissions } from '@/hooks/use-user-permissions';
import { useTeams } from '@/hooks/use-teams';
import type { UnifiedHistoryEvent } from '@/hooks/use-lead-history';
import { appendOptimisticHistoryEvent } from '@/hooks/use-optimistic-lead-history';
import { leadsAPI } from '@/lib/api/leads';
import { mergePreservingDefinedFields } from '@/lib/merge-preserving-defined';
import { VimobAPIError } from '@/lib/api/vimob-client';
import { getPipelineStageOutcome } from '@/lib/pipeline-stage-outcome';
import { isAttendanceScheduleType, isFinalScheduleStatus } from '@/lib/schedule-outcome';
import { useStageAutomations } from '@/hooks/use-stage-automations';
import { teamsAPI } from '@/lib/api/teams';
import type { LeadCadenceTaskState } from '@/lib/validation';
import {
  buildCampaignTrackingDetails,
  CampaignTrackingHover,
  CompactScheduleEventsList,
  getCadenceTaskType,
  getDealStatusTriggerClass,
  getErrorMessage,
  getLeadPropertyFallback,
  getLeadSourceLabel,
  getStageStepperStyle,
  hasTagId,
  InfoLine,
  LeadDetailOverlays,
  LeadProfileHover,
  mergePropertyFallback,
  OUTCOME_CADENCE_TASK_TYPES,
  stageTooltipClassName,
  useLeadDetailPipelineCache,
  type LeadDetailDialogProps,
  type LeadDetailLead,
  type ReopenStatusConfirmation,
  type AssigneeScheduleConfirmation,
  type SelectableLeadProperty,
} from './lead-detail';

export type { LeadDetailLead } from './lead-detail';

export function LeadDetailDialog({
  lead: leadProp,
  stages,
  onClose,
  onEdit,
  allTags,
  allUsers,
}: LeadDetailDialogProps) {
  const lead = leadProp ?? ({} as LeadDetailLead);
  const { language } = useLanguage();
  const isMobile = useIsMobile();
  const dateLocale = language === 'pt-BR' ? ptBR : enUS;
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);
  const [assigneePopoverOpen, setAssigneePopoverOpen] = useState(false);
  const [localLead, setLocalLead] = useState<LeadDetailLead | null>(leadProp);
  const [isUpdatingAssignee, setIsUpdatingAssignee] = useState(false);
  const [isEditingContact, setIsEditingContact] = useState(false);
  const [scheduleFormOpen, setScheduleFormOpen] = useState(false);
  const [editingScheduleEvent, setEditingScheduleEvent] = useState<ScheduleEvent | null>(null);
  const [scheduleDefaultType, setScheduleDefaultType] = useState<EventType>('call');
  const [activeTab, setActiveTab] = useState('activities');
  const [selectedTask, setSelectedTask] = useState<LeadCadenceTaskState | null>(null);
  const [roteiroDialogOpen, setRoteiroDialogOpen] = useState(false);
  const [outcomeDialogOpen, setOutcomeDialogOpen] = useState(false);
  const [taskForOutcome, setTaskForOutcome] = useState<LeadCadenceTaskState | null>(null);
  const [quickActionOutcomeOpen, setQuickActionOutcomeOpen] = useState(false);
  const [quickActionOutcomeType, setQuickActionOutcomeType] = useState<'call' | 'email'>('call');
  const [selectedAttachment, setSelectedAttachment] = useState<LeadAttachment | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [shouldLoadLeadProperties, setShouldLoadLeadProperties] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [reopenStatusConfirmation, setReopenStatusConfirmation] =
    useState<ReopenStatusConfirmation | null>(null);
  const [assigneeScheduleConfirmation, setAssigneeScheduleConfirmation] =
    useState<AssigneeScheduleConfirmation | null>(null);
  const handleCloseLeadDetail = () => {
    setAssigneeScheduleConfirmation(null);
    onClose();
  };
  const v2LeadInfoScrollRef = useRef<HTMLDivElement>(null);
  const v2LeadWorkScrollRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const { openNewChat, openNewChatWithMessage } = useFloatingChat();
  const {
    refreshPipelineInBackground,
    restorePipelineCache,
    updatePipelineAssigneeCache,
    updatePipelineLeadCache,
  } = useLeadDetailPipelineCache();

  const leadId = leadProp?.id ?? null;
  const fullLeadQuery = useLead(leadId);
  const [lostReasonLocal, setLostReasonLocal] = useState(lead?.lost_reason || '');
  const [lostReasonDialogOpen, setLostReasonDialogOpen] = useState(false);
  const [pendingLostStageId, setPendingLostStageId] = useState<string | null>(null);
  const [stageMovePending, setStageMovePending] = useState(false);
  const [feedback, setFeedback] = useState('');

  const handleSaveFeedback = async () => {
    if (!canOperateLead || !feedback.trim()) return;
    const savedFeedback = feedback.trim();
    try {
      await updateLead.mutateAsync({
        id: lead.id,
        feedback: savedFeedback,
      });

      setFeedback('');
      toast.success('Feedback registrado com sucesso!');
    } catch {
      toast.error('Erro ao registrar feedback');
    }
  };

  const [editForm, setEditForm] = useState({
    name: '',
    phone: '',
    email: '',
    cargo: '',
    empresa: '',
    endereco: '',
    numero: '',
    complemento: '',
    bairro: '',
    cidade: '',
    uf: '',
    cep: '',
    valor_interesse: '',
    commission_percentage: '',
    property_id: '',
    message: '',
    renda_familiar: '',
    trabalha: false,
    profissao: '',
    faixa_valor_imovel: '',
    finalidade_compra: '',
    procura_financiamento: false
  });

  // Sync edit form with lead data whenever lead changes
  useEffect(() => {
    if (!leadProp || isUpdatingAssignee) return;

    const fullLead = fullLeadQuery.data as LeadDetailLead | null | undefined;
    const hydratedLead: LeadDetailLead = fullLead
      ? {
          ...mergePreservingDefinedFields(leadProp, fullLead, [
            'initial_message',
            'last_contact_at',
            'next_follow_up_at',
            'priority',
            'status',
          ]),
          assignee: fullLead.assignee ?? (
            fullLead.assigned_user_id === leadProp.assigned_user_id
              ? leadProp.assignee
              : undefined
          ),
          interest_property: leadProp.interest_property ?? fullLead.interest_property,
          property: leadProp.property ?? fullLead.property,
          stage: leadProp.stage ?? fullLead.stage,
          tags: leadProp.tags ?? fullLead.tags,
          tasks_count: leadProp.tasks_count ?? fullLead.tasks_count,
          whatsapp_avatar_url: leadProp.whatsapp_avatar_url ?? fullLead.whatsapp_avatar_url,
        }
      : leadProp;

    let isActive = true;
    queueMicrotask(() => {
      if (isActive) setLocalLead(hydratedLead);
    });

    return () => {
      isActive = false;
    };
  }, [leadProp, fullLeadQuery.data, isUpdatingAssignee]);

  useEffect(() => {
    if (!leadProp) return;

    v2LeadInfoScrollRef.current?.scrollTo({ top: 0 });
    v2LeadWorkScrollRef.current?.scrollTo({ top: 0 });

    const valorStr = leadProp.valor_interesse ? leadProp.valor_interesse.toString() : '';
    const nextForm = {
      name: leadProp.name || '',
      phone: leadProp.phone || '',
      email: leadProp.email || '',
      cargo: leadProp.cargo || '',
      empresa: leadProp.empresa || '',
      endereco: leadProp.endereco || '',
      numero: leadProp.numero || '',
      complemento: leadProp.complemento || '',
      bairro: leadProp.bairro || '',
      cidade: leadProp.cidade || '',
      uf: leadProp.uf || '',
      cep: leadProp.cep || '',
      valor_interesse: valorStr,
      commission_percentage: leadProp.commission_percentage != null ? leadProp.commission_percentage.toString() : '',
      property_id: leadProp.interest_property_id || leadProp.property_id || '',
      message: leadProp.message || '',
      renda_familiar: leadProp.renda_familiar || '',
      trabalha: leadProp.trabalha || false,
      profissao: leadProp.profissao || '',
      faixa_valor_imovel: leadProp.faixa_valor_imovel || '',
      finalidade_compra: leadProp.finalidade_compra || '',
      procura_financiamento: leadProp.procura_financiamento || false
    };

    let isActive = true;
    queueMicrotask(() => {
      if (isActive) setEditForm(nextForm);
    });

    return () => {
      isActive = false;
    };
  }, [leadProp]);

  // Separate effect to initialize lost_reason when lead first loads
  useEffect(() => {
    if (leadProp?.lost_reason === undefined || lostReasonLocal !== '') return;

    let isActive = true;
    const nextLostReason = leadProp.lost_reason || '';
    queueMicrotask(() => {
      if (isActive) setLostReasonLocal(nextLostReason);
    });

    return () => {
      isActive = false;
    };
  }, [leadProp?.lost_reason, lostReasonLocal]);
  const { activeOrganization, profile, organization } = useAuth();
  const cadenceOrganizationId =
    leadProp?.organization_id || activeOrganization.organizationId || null;
  const {
    data: leadCadenceState,
    isLoading: leadCadenceLoading,
    error: leadCadenceError,
    refetch: refetchLeadCadence,
  } = useLeadCadenceState(leadId, cadenceOrganizationId, leadProp?.stage_id);
  const { hasPermission } = useUserPermissions();
  const { hasModule } = useOrganizationModules();
  const canOperateLead = hasPermission('lead_operate');
  const handleOpenLeadEdit = () => {
    if (!canOperateLead) return;
    setIsEditingContact(false);
    onEdit?.(localLead || lead);
  };
  const hasPropertiesModule = hasModule('properties');
  const hasAgendaModule = hasModule('agenda');
  const hasLeadWhatsAppModule = hasModule('whatsapp');
  const canViewLeadWhatsApp =
    hasLeadWhatsAppModule &&
    (hasPermission('whatsapp_view') || hasPermission('whatsapp_operate'));
  const canOperateLeadWhatsApp =
    hasLeadWhatsAppModule && hasPermission('whatsapp_operate');
  const openLeadWhatsApp = (message?: string) => {
    const currentLead = localLead || lead;
    const preparedMessage = message?.trim() || '';
    const canOpenLeadWhatsApp = preparedMessage
      ? canOperateLeadWhatsApp
      : canViewLeadWhatsApp;

    if (!canOpenLeadWhatsApp) {
      toast.error('WhatsApp indisponível para este usuário.');
      return;
    }
    if (!currentLead.phone) {
      toast.error('Cadastre um telefone antes de iniciar a conversa.');
      return;
    }

    const phone = currentLead.phone;
    const leadName = currentLead.name || 'Lead';
    handleCloseLeadDetail();
    queueMicrotask(() => {
      if (preparedMessage) {
        openNewChatWithMessage(phone, preparedMessage, currentLead.id, leadName);
        return;
      }
      openNewChat(phone, leadName, currentLead.id);
    });
  };
  const canViewProperties =
    hasPropertiesModule &&
    (hasPermission('property_view') || hasPermission('property_manage'));
  const canViewLeadSchedule = hasAgendaModule && hasPermission('schedule_view');
  const canManageLeadSchedule = hasAgendaModule && canOperateLead && hasPermission('schedule_manage');
  const {
    data: loadedProperties = [],
    isLoading: propertiesLoading,
    isFetching: propertiesFetching,
  } = useProperties(undefined, {}, { enabled: canViewProperties && shouldLoadLeadProperties });
  const propertyOptions = mergePropertyFallback(loadedProperties, getLeadPropertyFallback(localLead));
  const propertyPickerLoading = shouldLoadLeadProperties && (propertiesLoading || (propertiesFetching && loadedProperties.length === 0));
  const handlePropertyPickerOpenChange = (open: boolean) => {
    if (open) setShouldLoadLeadProperties(true);
  };
  const {
    data: scheduleEvents = []
  } = useScheduleEvents({
    leadId: leadId || undefined,
    enabled: canViewLeadSchedule,
  });
  const scheduleSummaryLabel = useMemo(() => {
    if (scheduleEvents.length === 0) return 'Nenhum compromisso';
    const appointments = scheduleEvents.filter((event) =>
      isAttendanceScheduleType(event.event_type),
    );
    const simpleCommitmentsCount = scheduleEvents.length - appointments.length;
    const openCount = appointments.filter((event) => !isFinalScheduleStatus(event.status)).length;
    const completedCount = appointments.filter((event) => event.status === 'completed').length;
    const noShowCount = appointments.filter((event) => event.status === 'no_show').length;
    const rescheduledCount = appointments.filter((event) => event.outcome === 'rescheduled').length;
    const appointmentTotalLabel = appointments.length === 1
      ? appointments[0]?.event_type === 'visit' ? '1 visita' : '1 reunião'
      : `${appointments.length} visitas/reuniões`;
    return [
      appointments.length > 0
        ? appointmentTotalLabel
        : 'Nenhuma visita/reunião',
      openCount > 0 ? `${openCount} em aberto` : null,
      completedCount > 0 ? `${completedCount} realizada${completedCount === 1 ? '' : 's'}` : null,
      noShowCount > 0 ? `${noShowCount} no-show` : null,
      rescheduledCount > 0 ? `${rescheduledCount} remarcada${rescheduledCount === 1 ? '' : 's'}` : null,
      simpleCommitmentsCount > 0
        ? `+ ${simpleCommitmentsCount} compromisso${simpleCommitmentsCount === 1 ? '' : 's'} simples`
        : null,
    ].filter(Boolean).join(' · ');
  }, [scheduleEvents]);
  const { data: leadMeta } = useLeadMeta(leadId);
  const completeCadenceTask = useCompleteCadenceTask();
  const updateLead = useUpdateLead();
  const addTag = useAddLeadTag();
  const removeTag = useRemoveLeadTag();
  const updateCommission = useUpdateLeadCommission();
  const dealStatusChange = useDealStatusChange();
  const { data: stageAutomations = [] } = useStageAutomations();
  const { recordFirstResponse } = useRecordFirstResponseOnAction();
  const { data: teams = [] } = useTeams({
    includeInactive: true,
    enabled: hasPermission('team_view'),
  });
  const createCallMutation = useCreateCall();
  const createActivityMutation = useCreateActivity();
  const { data: attachments = [], refetch: refetchAttachments } = useLeadAttachments(leadId);
  const uploadAttachment = useUploadLeadAttachment();

  const handleOpenAttachment = async (attachment: LeadAttachment) => {
    try {
      const refreshed = await refetchAttachments();
      const freshAttachment = refreshed.data?.find((item) => item.id === attachment.id);
      setSelectedAttachment(freshAttachment || attachment);
    } catch {
      setSelectedAttachment(attachment);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!canOperateLead || !file || !lead.id) return;

    setIsUploading(true);
    try {
      await uploadAttachment.mutateAsync({ leadId: lead.id, file });
      await queryClient.invalidateQueries({ queryKey: ['lead-history-v2', lead.id] });
      toast.success('Documento enviado com sucesso!');
    } catch (error: unknown) {
      console.error('Erro fatal no upload de documento:', error);
      toast.error(`Erro ao enviar: ${getErrorMessage(error)}`);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSelectInterestProperty = async (property: SelectableLeadProperty) => {
    if (!canOperateLead) return;
    const previousLead = localLead ? { ...localLead } : lead;
    const previousEditForm = { ...editForm };
    const nextPropertyPrice = typeof property.preco === 'number' ? property.preco : null;
    const nextPropertyCommission =
      typeof property.commission_percentage === 'number' ? property.commission_percentage : null;
    const propertyTitle = property.title || null;
    const propertyCode = property.code || property.codigo || property.reference || null;
    const selectedProperty = {
      id: property.id,
      code: propertyCode,
      title: propertyTitle,
      preco: nextPropertyPrice,
    };
    const nextLeadPatch: Partial<LeadDetailLead> = {
      property_id: property.id,
      interest_property_id: property.id,
      property_code: propertyCode,
      property: selectedProperty,
      interest_property: selectedProperty,
      valor_interesse: nextPropertyPrice,
      commission_percentage: nextPropertyCommission ?? localLead?.commission_percentage ?? lead.commission_percentage,
    };

    setEditForm((current) => ({
      ...current,
      property_id: property.id,
      valor_interesse: nextPropertyPrice !== null ? nextPropertyPrice.toString() : '',
      commission_percentage: nextPropertyCommission !== null ? nextPropertyCommission.toString() : current.commission_percentage,
    }));
    setLocalLead((current) => current ? { ...current, ...nextLeadPatch } : current);
    updatePipelineLeadCache(lead.id, nextLeadPatch);

    const historyQueryKey = ['lead-history-v2', lead.id] as const;
    const previousHistory = queryClient.getQueryData<UnifiedHistoryEvent[]>(historyQueryKey);
    const timestamp = new Date().toISOString();
    const propertyContent = [propertyCode, propertyTitle].filter(Boolean).join(' - ') || 'Imovel selecionado';
    queryClient.setQueryData<UnifiedHistoryEvent[]>(historyQueryKey, (current) =>
      appendOptimisticHistoryEvent(current, {
        id: `optimistic-property-${lead.id}-${property.id}-${timestamp}`,
        type: 'property_selected',
        label: propertyCode || propertyTitle
          ? `Imovel selecionado: ${propertyCode || propertyTitle}`
          : 'Imovel selecionado',
        content: propertyContent,
        timestamp,
        actor: profile?.id
          ? {
              id: profile.id,
              name: profile.name || profile.email || 'Usuario',
              avatar_url: profile.avatar_url || null,
            }
          : null,
        source: 'activity',
        metadata: {
          property_id: property.id,
          property_title: propertyTitle,
          property_code: propertyCode,
          property_price: nextPropertyPrice,
          commission_percentage: nextPropertyCommission,
          origin: 'lead_update',
        },
      }),
    );

    const updateData: Partial<Lead> & { id: string } = {
      id: lead.id,
      property_id: property.id,
      interest_property_id: property.id,
      property_code: propertyCode,
      valor_interesse: nextPropertyPrice,
    };

    if (nextPropertyCommission !== null) {
      updateData.commission_percentage = nextPropertyCommission;
    }

    try {
      await updateLead.mutateAsync(updateData);
    } catch {
      setLocalLead(previousLead);
      setEditForm(previousEditForm);
      updatePipelineLeadCache(lead.id, previousLead);
      queryClient.setQueryData(historyQueryKey, previousHistory);
    }
  };

  // Quick action handlers for phone/email with outcome dialog
  const handleQuickPhone = () => {
    const currentLead = localLead || lead;
    if (!canOperateLead || !currentLead.phone) return;
    const phoneHref = normalizePhoneToE164(currentLead.phone);
    if (!phoneHref) return;

    // 1. Log initiation immediately in history
    createActivityMutation.mutate({
      lead_id: currentLead.id,
      type: 'call_initiated',
      content: 'Ligação iniciada',
      metadata: { phone: currentLead.phone, channel: 'phone' },
    });

    window.open(`tel:${phoneHref}`, '_blank', 'noopener,noreferrer');
    setQuickActionOutcomeType('call');
    setQuickActionOutcomeOpen(true);
  };

  const handleQuickWhatsApp = () => {
    openLeadWhatsApp();
  };

  const handleQuickEmail = () => {
    const currentLead = localLead || lead;
    if (!canOperateLead || !currentLead.email) return;
    const gmailUrl = `https://mail.google.com/mail/view=cm&fs=1&tf=1&to=${encodeURIComponent(currentLead.email)}`;
    window.open(gmailUrl, '_blank', 'noopener,noreferrer');
    setQuickActionOutcomeType('email');
    setQuickActionOutcomeOpen(true);
  };

  const handleQuickActionOutcomeConfirm = async (outcome: TaskOutcome, notes: string) => {
    if (!canOperateLead) return;
    const currentLead = localLead || lead;
    try {
      // 1. Log in the 'activities' table for visual history
      await createActivityMutation.mutateAsync({
        lead_id: currentLead.id,
        type: quickActionOutcomeType === 'call' ? 'call' : 'email',
        content: quickActionOutcomeType === 'call' ? 'Tentativa de ligação' : 'Email enviado',
        metadata: { outcome, notes, channel: quickActionOutcomeType },
      });

    // 2. If it's a call, also register it in 'telephony_calls' for gamification & metrics
    if (quickActionOutcomeType === 'call') {
      // Use fire-and-forget logic or separate mutation to not block UI/history
      createCallMutation.mutate({
        lead_id: currentLead.id,
        phone_to: currentLead.phone || '',
        direction: 'outbound',
        notes: notes,
        organization_id: currentLead.organization_id || activeOrganization.organizationId || ''
      });
    }

    await recordFirstResponse({
      leadId: currentLead.id,
      organizationId: currentLead.organization_id || activeOrganization.organizationId || '',
      channel: quickActionOutcomeType === 'call' ? 'phone' : 'email',
      actorUserId: profile?.id || null,
      firstResponseAt: currentLead.first_response_at,
    });

      setQuickActionOutcomeOpen(false);
    } catch (error) {
      toast.error(`Não foi possível registrar a atividade: ${getErrorMessage(error)}`);
      throw error;
    }
  };
  const handleEditScheduleEvent = (event: ScheduleEvent) => {
    if (!canManageLeadSchedule) return;
    setEditingScheduleEvent(event);
    setScheduleFormOpen(true);
  };
  const handleCloseScheduleForm = () => {
    setScheduleFormOpen(false);
    setEditingScheduleEvent(null);
  };
  if (!leadProp || !localLead) return null;

  const currentStageIndex = stages.findIndex(s => s.id === localLead.stage_id);
  const stageStepperStyle = getStageStepperStyle(stages.length);
  const assigneeName = localLead.assignee?.name || '';
  const leadTags = Array.isArray(localLead.tags) ? localLead.tags.filter(hasTagId) : [];
  const safeAllTags = Array.isArray(allTags) ? allTags.filter(Boolean) : [];
  const safeAllUsers = Array.isArray(allUsers) ? allUsers.filter(Boolean) : [];
  const canTransferLead = canOperateLead;
  const canUnassignLead = canOperateLead;
  const assignableUsers = canTransferLead ? safeAllUsers : [];
  const leadTagIds = leadTags.map((tag) => tag.id);
  const availableTags = safeAllTags.filter(t => !leadTagIds.includes(t.id));
  const isTagMutationPending = addTag.isPending || removeTag.isPending;

  const handleAddTag = async (tagId: string) => {
    if (!canOperateLead || isTagMutationPending) return;
    const tagToAdd = safeAllTags.find(t => t.id === tagId);
    if (!tagToAdd || !localLead) return;

    const nextTags = [
      ...leadTags,
      {
        id: tagToAdd.id,
        name: tagToAdd.name,
        color: tagToAdd.color,
      },
    ];
    const previousLead: LeadDetailLead = { ...localLead, tags: localLead.tags ? [...localLead.tags] : [] };
    const updatedLead: LeadDetailLead = { ...localLead, tags: nextTags };
    const pipelineSnapshots = updatePipelineLeadCache(localLead.id, { tags: nextTags });

    setTagPopoverOpen(false);
    setLocalLead(updatedLead);

    try {
      await addTag.mutateAsync({
        leadId: lead.id,
        tagId
      });
    } catch {
      setLocalLead(previousLead);
      restorePipelineCache(pipelineSnapshots);
    }
  };

  const handleRemoveTag = async (tagId: string) => {
    if (!canOperateLead || !localLead || isTagMutationPending) return;

    const nextTags = leadTags.filter((tag) => tag.id !== tagId);
    const previousLead: LeadDetailLead = { ...localLead, tags: localLead.tags ? [...localLead.tags] : [] };
    const updatedLead: LeadDetailLead = { ...localLead, tags: nextTags };
    const pipelineSnapshots = updatePipelineLeadCache(localLead.id, { tags: nextTags });

    setLocalLead(updatedLead);

    try {
      await removeTag.mutateAsync({
        leadId: lead.id,
        tagId
      });
    } catch {
      setLocalLead(previousLead);
      restorePipelineCache(pipelineSnapshots);
    }
  };

  const loadAssigneeAvailability = () => {
    const teamMemberIds = teams
      .flatMap((team) => team.members || [])
      .map((member) => member.id)
      .filter(Boolean)
      .sort();
    const organizationId = lead.organization_id || activeOrganization.organizationId;

    if (teamMemberIds.length === 0) return Promise.resolve([]);

    return queryClient.fetchQuery({
      queryKey: ['lead-assignee-availability', organizationId, teamMemberIds],
      queryFn: () => teamsAPI.listMemberAvailability({ teamMemberIds, organizationId }),
      staleTime: 60_000,
    });
  };

  const handleAssigneePopoverChange = (open: boolean) => {
    setAssigneePopoverOpen(open);
    if (open) void loadAssigneeAvailability().catch(() => undefined);
  };

  const handleAssignUser = async (
    userId: string | null,
    options?: { skipScheduleConfirmation?: boolean },
  ) => {
    if (isUpdatingAssignee) return;
    if (!canTransferLead) {
      toast.error('Você não tem permissão para trocar o responsável deste lead');
      return;
    }
    if (!userId && !canUnassignLead) {
      toast.error('Você só pode transferir seus leads para outro usuário');
      return;
    }
    if (userId && !assignableUsers.some((candidate) => candidate.id === userId)) {
      toast.error('Você só pode transferir leads para usuários permitidos');
      return;
    }

    if (!localLead) return;

    if ((localLead.assigned_user_id || null) === userId) {
      setAssigneePopoverOpen(false);
      return;
    }

    const previousLead: LeadDetailLead = { ...localLead };
    const selectedUser = userId ? assignableUsers.find(u => u.id === userId) : null;
    setIsUpdatingAssignee(true);
    setAssigneePopoverOpen(false);

    let pipelineSnapshots: Array<[QueryKey, unknown]> = [];

    try {
      if (userId) {
        const currentDay = new Date().getDay();
        const currentTime = format(new Date(), 'HH:mm:ss');
        const teamMember = teams
          .flatMap((team) => team.members || [])
          .find((member) => member.user_id === userId);

        if (teamMember) {
          const availabilityList = await loadAssigneeAvailability();
          const availability = availabilityList.find((item) =>
            item.team_member_id === teamMember.id && item.day_of_week === currentDay && item.is_active
          );

          if (availability) {
            const isOutsideSchedule = !availability.is_all_day &&
              (currentTime < (availability.start_time || '00:00:00') ||
               currentTime > (availability.end_time || '23:59:59'));

            if (isOutsideSchedule && !options?.skipScheduleConfirmation) {
              const startTime = availability.start_time || '00:00:00';
              const endTime = availability.end_time || '23:59:59';
              setAssigneeScheduleConfirmation({
                leadId: lead.id,
                userId,
                userName: selectedUser?.name || selectedUser?.email || 'Este usuário',
                description: `A escala de hoje é das ${startTime.slice(0, 5)} às ${endTime.slice(0, 5)}.`,
              });
              return;
            }
          } else if (!options?.skipScheduleConfirmation) {
            setAssigneeScheduleConfirmation({
              leadId: lead.id,
              userId,
              userName: selectedUser?.name || selectedUser?.email || 'Este usuário',
              description: 'Não há uma escala ativa para hoje.',
            });
            return;
          }
        }
      }

      const optimisticLead: LeadDetailLead = {
        ...localLead,
        assigned_user_id: userId,
        assignee: selectedUser ? {
          id: selectedUser.id,
          name: selectedUser.name,
          email: selectedUser.email,
          avatar_url: selectedUser.avatar_url
        } : undefined
      };

      setLocalLead(optimisticLead);
      pipelineSnapshots = updatePipelineAssigneeCache(optimisticLead);

      const organizationId = lead.organization_id || activeOrganization.organizationId || undefined;
      const { data, error } = await leadsAPI.assignLead(lead.id, userId, organizationId);
      if (error) throw error;

      const serverLead = data as LeadDetailLead;
      const persistedLead: LeadDetailLead = {
        ...optimisticLead,
        ...serverLead,
        assignee: serverLead.assignee ?? (
          serverLead.assigned_user_id === optimisticLead.assigned_user_id
            ? optimisticLead.assignee
            : undefined
        ),
      };

      setLocalLead(persistedLead);
      if (organizationId) {
        queryClient.setQueryData(['lead', organizationId, lead.id], persistedLead);
      }
      updatePipelineLeadCache(lead.id, persistedLead);
      void queryClient.invalidateQueries({ queryKey: ['lead-history-v2', lead.id] });
      refreshPipelineInBackground(organizationId, lead.id, 'lead.assigned');

      toast.success(userId
        ? `Lead transferido para ${selectedUser?.name || selectedUser?.email || 'o novo responsável'}`
        : 'Responsável removido do lead');
    } catch (error: unknown) {
      setLocalLead(previousLead);
      restorePipelineCache(pipelineSnapshots);
      toast.error(`Não foi possível transferir o lead: ${getErrorMessage(error)}`);
    } finally {
      setIsUpdatingAssignee(false);
    }
  };
  const handleToggleCadenceTask = async (
    task: LeadCadenceTaskState,
    outcome = 'done',
    outcomeNotes = '',
  ) => {
    if (!canOperateLead) return;
    await completeCadenceTask.mutateAsync({
      leadId: lead.id,
      taskId: task.id,
      templateTaskId: task.template_task_id || undefined,
      outcome,
      outcomeNotes,
      organizationId: cadenceOrganizationId,
    });
    const firstContactChannel = task.type === 'call'
      ? 'phone'
      : task.type === 'message'
        ? 'whatsapp'
        : task.type === 'email'
          ? 'email'
          : null;
    if (firstContactChannel) {
      await recordFirstResponse({
        leadId: lead.id,
        organizationId: lead.organization_id || activeOrganization.organizationId || '',
        channel: firstContactChannel,
        actorUserId: profile?.id || null,
        firstResponseAt: lead.first_response_at,
      });
    }
  };

  // Handle outcome dialog confirmation
  const handleOutcomeConfirm = async (outcome: TaskOutcome, notes: string) => {
    if (!canOperateLead) return;
    if (!taskForOutcome) return;
    await handleToggleCadenceTask(taskForOutcome, outcome, notes);
    setOutcomeDialogOpen(false);

    // Se agendou visita/reunião, abrir o formulário de agenda automaticamente
    if (outcome === 'scheduled') {
      if (canManageLeadSchedule) {
        const taskType = getCadenceTaskType(taskForOutcome.type);
        setEditingScheduleEvent(null);
        setScheduleDefaultType(taskType === 'call' ? 'call' : 'visit');
        setScheduleFormOpen(true);
      } else {
        toast.warning(
          hasAgendaModule
            ? 'Resultado registrado, mas você não tem permissão para criar o compromisso na agenda.'
            : 'Resultado registrado, mas o módulo de Agenda não está disponível nesta organização.',
        );
      }
    }

    setTaskForOutcome(null);
  };

  const handleCadenceTaskClick = (task: LeadCadenceTaskState) => {
    if (!canOperateLead) return;
    const taskType = getCadenceTaskType(task.type);
    const isDone = task.is_done || task.status === 'completed';

    // Se já está feito, não faz nada (evitar toggle reverso sem querer)
    if (isDone || task.status !== 'pending' || leadCadenceState?.deal_status !== 'open') return;

    // Se tem observação/roteiro, abrir o popup de roteiro primeiro
    if (task.observation) {
      setSelectedTask(task);
      setRoteiroDialogOpen(true);
      return;
    }

    // Se for tarefa de mensagem com mensagem recomendada e tem telefone
    if (taskType === 'message' && task.recommended_message) {
      // Substituir variáveis na mensagem
      const message = task.recommended_message.replace(/{nome}/gi, lead.name || '').replace(/{empresa}/gi, lead.empresa || '').replace(/{email}/gi, lead.email || '');
      openLeadWhatsApp(message);
      return;
    }

    // O gestor escolhe quais tarefas realmente exigem um resultado operacional.
    if (task.outcome_required && OUTCOME_CADENCE_TASK_TYPES.includes(taskType)) {
      setTaskForOutcome(task);
      setOutcomeDialogOpen(true);
    } else {
      // Sem resultado obrigatório, concluir diretamente mantém o fluxo leve.
      void handleToggleCadenceTask(task).catch(() => undefined);
    }
  };
  const handleRoteiroAction = async (action: 'complete' | 'message') => {
    if (!canOperateLead) return;
    if (!selectedTask) return;
    if (action === 'message' && selectedTask.recommended_message) {
      const message = selectedTask.recommended_message.replace(/{nome}/gi, lead.name || '').replace(/{empresa}/gi, lead.empresa || '').replace(/{email}/gi, lead.email || '');
      setRoteiroDialogOpen(false);
      setSelectedTask(null);
      openLeadWhatsApp(message);
      return;
    }

    // Após o roteiro, respeitar a regra configurada pelo gestor.
    const selectedTaskType = getCadenceTaskType(selectedTask.type);
    if (selectedTask.outcome_required && OUTCOME_CADENCE_TASK_TYPES.includes(selectedTaskType)) {
      setTaskForOutcome(selectedTask);
      setOutcomeDialogOpen(true);
      setRoteiroDialogOpen(false);
      setSelectedTask(null);
      return;
    }

    try {
      await handleToggleCadenceTask(selectedTask);
      setRoteiroDialogOpen(false);
      setSelectedTask(null);
    } catch {
      // The mutation reports the error; keep the script open so the task can be retried.
    }
  };
  const handleSaveContact = async () => {
    if (!canOperateLead) return;
    try {
      const newValorInteresse = editForm.valor_interesse ? parseFloat(editForm.valor_interesse) : null;
      const newCommissionPercentage = editForm.commission_percentage ? parseFloat(editForm.commission_percentage) : null;

      await updateLead.mutateAsync({
        id: lead.id,
        name: editForm.name,
        phone: editForm.phone || null,
        email: editForm.email || null,
        cargo: editForm.cargo || null,
        empresa: editForm.empresa || null,
        endereco: editForm.endereco || null,
        numero: editForm.numero || null,
        complemento: editForm.complemento || null,
        bairro: editForm.bairro || null,
        cidade: editForm.cidade || null,
        uf: editForm.uf || null,
        cep: editForm.cep || null,
        valor_interesse: newValorInteresse,
        commission_percentage: newCommissionPercentage,
        property_id: editForm.property_id || null,
        message: editForm.message || null,
        renda_familiar: editForm.renda_familiar || null,
        trabalha: editForm.trabalha || null,
        profissao: editForm.profissao || null,
        faixa_valor_imovel: editForm.faixa_valor_imovel || null,
        finalidade_compra: editForm.finalidade_compra || null,
        procura_financiamento: editForm.procura_financiamento || null
      });


      // If lead is already "won" and valores changed, update the commission
      if (lead.deal_status === 'won' && newValorInteresse && newCommissionPercentage) {
        const oldValor = lead.valor_interesse || 0;
        const oldPercentage = lead.commission_percentage || 0;

        if (newValorInteresse !== oldValor || newCommissionPercentage !== oldPercentage) {
          updateCommission.mutate({
            leadId: lead.id,
            valorInteresse: newValorInteresse,
            commissionPercentage: newCommissionPercentage
          });
        }
      }

      setIsEditingContact(false);
      toast.success('Dados salvos com sucesso!');
    } catch (error) {
      console.error('Erro ao salvar dados do lead:', error);
    }
  };
  const persistMoveToStage = async (stageId: string, lostReason?: string) => {
    if (!canOperateLead || stageId === localLead.stage_id || stageMovePending) return false;

    const previousLead = { ...localLead };
    const stage = stages.find(s => s.id === stageId);
    setStageMovePending(true);
    setLocalLead({
      ...localLead,
      stage_id: stageId,
      stage: stage || localLead.stage,
    });

    try {
      const isProposal = stage?.name?.toLowerCase().includes('proposta');

      const organizationId = lead.organization_id || activeOrganization.organizationId || undefined;
      const { data: updatedLead, error } = await leadsAPI.moveLeadStage(lead.id, {
        stageId,
        lostReason,
      }, organizationId);
      if (error) throw error;

      setLocalLead((current) => current ? { ...current, ...updatedLead } : current);
      updatePipelineLeadCache(lead.id, updatedLead);
      void queryClient.invalidateQueries({ queryKey: ['lead-history-v2', lead.id] });
      void queryClient.invalidateQueries({ queryKey: ['lead-cadence-state'] });
      refreshPipelineInBackground(organizationId, lead.id, 'lead.stage_moved');

      // Se moveu para estágio de Proposta, registrar atividade de gamificação
      if (isProposal) {
        createActivityMutation.mutate({
          lead_id: lead.id,
          type: 'proposal_sent',
          content: 'Lead movido para estágio de Proposta',
        });
      }

      toast.success('Lead movido!');
      return true;
    } catch (error: unknown) {
      setLocalLead(previousLead);
      if (
        !lostReason &&
        error instanceof VimobAPIError &&
        error.code === 'lead_lost_reason_required'
      ) {
        setPendingLostStageId(stageId);
        setLostReasonDialogOpen(true);
      } else {
        toast.error(`Não foi possível mover o lead: ${getErrorMessage(error)}`);
      }
      return false;
    } finally {
      setStageMovePending(false);
    }
  };

  const handleMoveToStage = async (stageId: string) => {
    if (!canOperateLead || stageId === localLead.stage_id) return;
    const stage = stages.find((item) => item.id === stageId);
    if (getPipelineStageOutcome(stage, stageAutomations) === 'lost') {
      setPendingLostStageId(stageId);
      setLostReasonDialogOpen(true);
      return;
    }

    await persistMoveToStage(stageId);
  };

  // Centralized handler for deal status changes
  const handleDealStatusChange = async (
    newStatus: string,
    options?: { skipReopenConfirmation?: boolean; previousStatusOverride?: string },
  ) => {
    if (!canOperateLead) return;
    const previousStatus = options?.previousStatusOverride || localLead?.deal_status || 'open';
    if (newStatus === previousStatus) return;

    // Intercept "lost" -> ask for reason via dialog
    if (newStatus === 'lost') {
      setReopenStatusConfirmation(null);
      setLostReasonDialogOpen(true);
      return;
    }

    if (newStatus === 'open' && previousStatus !== 'open' && !options?.skipReopenConfirmation) {
      setReopenStatusConfirmation({
        leadId: lead.id,
        leadName: localLead?.name || lead.name || 'Lead',
        fromStatus: previousStatus,
      });
      return;
    } else {
      setReopenStatusConfirmation(null);
    }

    const currentLead = localLead || lead;

    const previousLead = localLead ? { ...localLead } : null;
    const statusChangedAt = new Date().toISOString();

    if (localLead) {
      setLocalLead({
        ...localLead,
        deal_status: newStatus as 'open' | 'won' | 'lost',
        lost_reason: newStatus === 'lost' ? localLead.lost_reason : null,
        won_at: newStatus === 'won' ? statusChangedAt : null,
        lost_at: newStatus === 'lost' ? statusChangedAt : null,
      });
    }

    try {
      const currentInterestPropertyId =
        currentLead?.interest_property_id ||
        currentLead?.property_id ||
        lead.interest_property_id ||
        lead.property_id ||
        null;

      const result = await dealStatusChange.mutateAsync({
        leadId: lead.id,
        newStatus: newStatus as 'open' | 'won' | 'lost',
        organizationId: activeOrganization.organizationId || '',
        organizationName: organization?.name || null,
        userId: currentLead?.assigned_user_id ?? null,
        propertyId: currentInterestPropertyId,
        valorInteresse: currentLead?.valor_interesse ?? null,
        commissionPercentage: currentLead?.commission_percentage ?? null,
        leadName: currentLead?.name || lead.name || 'Lead',
      });
      const updatedLead = result.lead as Partial<LeadDetailLead>;
      setLocalLead((current) => current ? {
        ...current,
        ...updatedLead,
        assignee: updatedLead.assignee === undefined ? current.assignee : updatedLead.assignee,
        tags: updatedLead.tags === undefined ? current.tags : updatedLead.tags,
        stage: updatedLead.stage === undefined ? current.stage : updatedLead.stage,
      } : current);
      void queryClient.invalidateQueries({ queryKey: ['lead-cadence-state'] });
    } catch {
      if (previousLead) setLocalLead(previousLead);
    }
  };

  // Confirm lost with reason from dialog
  const handleConfirmLostReason = async (reason: string) => {
    if (pendingLostStageId) {
      const moved = await persistMoveToStage(pendingLostStageId, reason);
      if (moved) {
        setLostReasonLocal(reason);
        setPendingLostStageId(null);
        setLostReasonDialogOpen(false);
      }
      return;
    }

    const previousStatus = localLead?.deal_status || 'open';
    const currentLead = localLead || lead;
    const previousLead = localLead ? { ...localLead } : null;
    if (localLead) {
      setLocalLead({
        ...localLead,
        deal_status: 'lost',
        lost_reason: reason,
        won_at: null,
        lost_at: new Date().toISOString(),
      });
    }

    try {
      const result = await dealStatusChange.mutateAsync({
        leadId: lead.id,
        newStatus: 'lost',
        organizationId: activeOrganization.organizationId || '',
        organizationName: organization?.name || null,
        userId: currentLead?.assigned_user_id ?? null,
        propertyId: currentLead?.interest_property_id || currentLead?.property_id || null,
        valorInteresse: currentLead?.valor_interesse ?? null,
        commissionPercentage: currentLead?.commission_percentage ?? null,
        leadName: currentLead?.name || lead.name || 'Lead',
        lostReason: reason,
      });
      setLostReasonLocal(reason);
      setLostReasonDialogOpen(false);
      const updatedLead = result.lead as Partial<LeadDetailLead>;
      setLocalLead((current) => current ? {
        ...current,
        ...updatedLead,
        assignee: updatedLead.assignee === undefined ? current.assignee : updatedLead.assignee,
        tags: updatedLead.tags === undefined ? current.tags : updatedLead.tags,
        stage: updatedLead.stage === undefined ? current.stage : updatedLead.stage,
      } : current);
      void queryClient.invalidateQueries({ queryKey: ['lead-cadence-state'] });
    } catch {
      if (previousLead) setLocalLead(previousLead);
      else if (localLead) setLocalLead({ ...localLead, deal_status: previousStatus });
    }
  };

  const leadSource = localLead?.source ?? lead.source ?? 'outros';
  const leadName = localLead?.name || lead.name || 'Lead';
  const canOpenLeadWhatsApp = canViewLeadWhatsApp;
  const campaignTrackingDetails = buildCampaignTrackingDetails(leadMeta ?? null, localLead || lead);

  const MobileContentV2 = () => {
    const leadAvatarUrl = lead.whatsapp_picture || lead.whatsapp_avatar_url || lead.contact_picture || null;
    const dealStatusLabel = localLead.deal_status === 'won' ? 'Ganho' : localLead.deal_status === 'lost' ? 'Perdido' : 'Aberto';
    const mobileActiveTab = ['summary', 'actions', 'history'].includes(activeTab) ? activeTab : 'summary';
    const contactRows: Array<{ label: string; value: ReactNode }> = [
      { label: 'Nome', value: <LeadProfileHover lead={localLead} canRevealSensitive={canOperateLead} /> },
      { label: 'Telefone', value: formatPhoneForDisplay(localLead.phone || '') },
      { label: 'Origem', value: getLeadSourceLabel(leadSource) },
      {
        label: 'Campanha',
        value: campaignTrackingDetails ? <CampaignTrackingHover leadMeta={campaignTrackingDetails} /> : null
      },
    ]
      .filter((row) => Boolean(row.value));

    const mobileTabs = [
      { id: 'summary', label: 'Resumo', icon: Contact },
      { id: 'actions', label: 'Ações', icon: Activity, badge: scheduleEvents.length ? String(scheduleEvents.length) : undefined },
      { id: 'history', label: 'Histórico', icon: MessageCircle },
    ];

    return (
      <div className="lead-detail-dialog lead-detail-v2 flex h-full min-h-0 flex-col bg-[var(--app-surface-solid)] text-[var(--app-text-primary)]">
        <div className="lead-mobile-drawer-header shrink-0 border-b border-[var(--app-border)] bg-[var(--app-surface-solid)] px-3 pb-3">
          <div className="mb-3 flex items-center gap-2">
            <div
              data-lead-stage-stepper
              className="lead-detail-v2-scroll flex min-w-0 flex-1 items-center overflow-x-auto pb-0.5"
              style={stageStepperStyle}
            >
              {stages.map((stage, idx) => {
                const isActive = stage.id === localLead.stage_id;
                const isPast = idx < currentStageIndex;

                return (
                  <button
                    key={stage.id}
                    type="button"
                    disabled={!canOperateLead}
                    aria-label={`Mover para ${stage.name}`}
                    aria-current={isActive ? 'step' : undefined}
                    data-lead-stage-step
                    onClick={() => handleMoveToStage(stage.id)}
                    className={cn(
                      'lead-stage-step relative flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-[11px] font-normal',
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : isPast
                          ? 'bg-primary/10 text-primary'
                          : 'bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]',
                    )}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>
            <button type="button" aria-label="Fechar detalhes do lead" title="Fechar" onClick={handleCloseLeadDetail} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)] transition-colors hover:bg-[var(--app-surface-hover)] focus-visible:ring-1 focus-visible:ring-primary/30">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-start gap-2.5">
            <Avatar className="h-10 w-10 shrink-0 border-0">
              <AvatarImage src={leadAvatarUrl || undefined} alt={leadName} />
              <AvatarFallback className="bg-primary/12 text-[12px] font-light text-primary">
                {leadName?.[0]?.toUpperCase() || <User className="h-5 w-5" />}
              </AvatarFallback>
            </Avatar>

            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <h2 className="truncate text-[14px] font-normal leading-tight">{leadName}</h2>
                <ReentryBadge count={lead.reentry_count} lastEntryAt={lead.last_entry_at} />
              </div>
              {localLead.phone && (
                <div className="mt-1 flex min-w-0 items-center gap-1.5">
                  <p className="truncate text-xs text-[var(--app-text-tertiary)]">{formatPhoneForDisplay(localLead.phone)}</p>
                  <CopyLeadPhoneButton phone={localLead.phone} className="h-6 w-6 bg-transparent hover:bg-[var(--app-surface-soft)]" />
                </div>
              )}

              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {leadTags.slice(0, 4).map((tag) => {
                  const tagColor = tag.color?.trim() || null;
                  return (
                    <Badge
                      key={tag.id}
                      className={cn(
                        'flex h-5 items-center gap-1 rounded-[4px] border-0 px-1.5 text-[10px] font-light',
                        'text-white',
                      )}
                      style={getTagColorStyleWithWhiteText(tagColor)}
                    >
                      <span className="max-w-[82px] truncate">{tag.name || 'Tag'}</span>
                      <button disabled={!canOperateLead || isTagMutationPending} type="button" aria-label={`Remover tag ${tag.name || 'Tag'}`} title="Remover tag" className="rounded-[3px] p-0.5 hover:bg-primary-foreground/15 disabled:hidden" onClick={() => handleRemoveTag(tag.id)}>
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </Badge>
                  );
                })}
                {leadTags.length > 4 && (
                  <Badge variant="secondary" className="h-5 rounded-[4px] border-0 px-1.5 text-[10px]">
                    +{leadTags.length - 4}
                  </Badge>
                )}
                <Popover open={tagPopoverOpen} onOpenChange={(open) => canOperateLead && !isTagMutationPending && setTagPopoverOpen(open)}>
                  <PopoverTrigger asChild>
                    <Button disabled={!canOperateLead || isTagMutationPending} variant="ghost" size="sm" className="h-5 rounded-[5px] border-0 bg-[var(--app-surface-soft)] px-1.5 text-[10px] disabled:hidden">
                      <Plus className="mr-1 h-3 w-3" />
                      Tag
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 p-0" align="start">
                    <TagSelectorPopoverContent availableTags={availableTags} onAddTag={handleAddTag} onClose={() => setTagPopoverOpen(false)} />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <Popover open={assigneePopoverOpen} onOpenChange={handleAssigneePopoverChange}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  aria-label="Alterar responsável pelo lead"
                  className="h-8 min-w-0 justify-start rounded-[6px] bg-[var(--app-surface-soft)] px-2.5 text-xs font-light text-[var(--app-text-secondary)]"
                  disabled={!canTransferLead}
                  onClick={(event) => event.stopPropagation()}
                >
                  <User className="mr-1.5 h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{assigneeName || 'Sem responsável'}</span>
                  {isUpdatingAssignee ? <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin" /> : <ChevronDown className="ml-auto h-3.5 w-3.5" />}
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="app-header-popover w-[calc(100vw-2rem)] max-w-[380px] overflow-hidden border-0 bg-[var(--app-surface-solid)] p-1"
                align="start"
                collisionPadding={12}
                onWheelCapture={(event) => event.stopPropagation()}
                onTouchMoveCapture={(event) => event.stopPropagation()}
              >
                <Command filter={commandSearchFilter} className="max-h-[min(72vh,430px)] border-none bg-transparent [&_[cmdk-input-wrapper]]:border-b-0 [&_[cmdk-input-wrapper]]:px-2">
                  <CommandInput placeholder="Buscar responsável..." className="h-10 border-none focus:ring-0" />
                  <CommandList
                    className="max-h-[min(58vh,340px)] overflow-y-auto overscroll-contain p-1 touch-pan-y scrollbar-thin [-webkit-overflow-scrolling:touch]"
                    onWheelCapture={(event) => event.stopPropagation()}
                    onTouchMoveCapture={(event) => event.stopPropagation()}
                  >
                    <CommandEmpty className="py-4 text-center text-sm text-muted-foreground">Nenhum encontrado.</CommandEmpty>
                    <CommandGroup>
                      <CommandItem onSelect={() => handleAssignUser(null)} className="cursor-pointer rounded-[6px] px-3 py-2">
                        Sem responsável
                      </CommandItem>
                      {assignableUsers.map((user) => (
                        <CommandItem key={user.id} onSelect={() => handleAssignUser(user.id)} className="cursor-pointer rounded-[6px] px-3 py-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <Avatar className="h-7 w-7">
                              <AvatarImage src={user.avatar_url || undefined} alt={user.name || user.email || 'Responsável'} />
                              <AvatarFallback className="text-[10px]">{(user.name || user.email || 'U')[0]}</AvatarFallback>
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

            <Select value={localLead.deal_status || 'open'} onValueChange={handleDealStatusChange} disabled={!canOperateLead}>
              <SelectTrigger className={cn('h-8 w-[92px] gap-1 rounded-[6px] px-2 text-xs font-light', getDealStatusTriggerClass(localLead.deal_status))}>
                <SelectValue>{dealStatusLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Aberto</SelectItem>
                <SelectItem value="won">Ganho</SelectItem>
                <SelectItem value="lost">Perdido</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="mt-2 grid grid-flow-col auto-cols-fr gap-2">
            {localLead.phone && (
              <Button disabled={!canOperateLead} variant="outline" size="sm" aria-label={`Ligar para ${leadName}`} title="Ligar" onClick={handleQuickPhone} className="h-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)]">
                <Phone className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button disabled={!canOpenLeadWhatsApp || !localLead.phone} size="sm" onClick={handleQuickWhatsApp} className="h-8 rounded-[6px] px-2 text-xs">
              <MessageCircle className="mr-1 h-3.5 w-3.5" />
              Chat
            </Button>
              {localLead.email && (
              <Button disabled={!canOperateLead} variant="outline" size="sm" aria-label={`Enviar e-mail para ${leadName}`} title="Enviar e-mail" onClick={handleQuickEmail} className="h-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)]">
                <Mail className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        <div className="shrink-0 border-b border-[var(--app-border)] bg-[var(--app-surface-solid)] px-3 py-2">
          <div role="tablist" aria-label="Seções dos detalhes do lead" className="grid grid-cols-3 gap-1 rounded-[7px] bg-[var(--app-surface-soft)] p-1">
            {mobileTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = mobileActiveTab === tab.id;

              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'flex h-8 items-center justify-center gap-1.5 rounded-[5px] text-[11px] font-light transition-colors',
                    isActive ? 'bg-[var(--app-surface-solid)] text-[var(--app-text-primary)]' : 'text-[var(--app-text-secondary)]',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {tab.label}
                  {tab.badge && <span className="rounded-[4px] bg-primary/15 px-1 text-[9px] text-primary">{tab.badge}</span>}
                </button>
              );
            })}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {mobileActiveTab === 'summary' && (
            <div className="lead-detail-v2-scroll h-full overflow-y-auto p-3">
              <div className="space-y-3 pb-4">
                <section className="rounded-[8px] bg-[var(--app-surface-soft)] p-3">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-[12px] font-normal">Dados do contato</h3>
                    {canOperateLead && <Button variant="ghost" size="sm" className="lead-detail-subtle-action h-7 rounded-[5px] px-2 text-[10px]" onClick={handleOpenLeadEdit}>
                      <FileEdit className="h-3 w-3" />
                      Editar
                    </Button>}
                  </div>

                  <div className="space-y-2">
                    {contactRows.map((row) => (
                      <InfoLine key={row.label} label={row.label} value={row.value} />
                    ))}
                  </div>



                  {isEditingContact && (
                    <div className="mt-3 space-y-2">
                      <Input aria-label="Nome" value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} className="h-8 rounded-[6px]" placeholder="Nome" />
                      <div role="group" aria-label="Telefone"><InternationalPhoneInput value={editForm.phone} onChange={(value) => setEditForm({ ...editForm, phone: value })} /></div>
                      <Input aria-label="E-mail" type="email" value={editForm.email} onChange={(event) => setEditForm({ ...editForm, email: event.target.value })} className="h-8 rounded-[6px]" placeholder="E-mail" />
                      <div className="grid grid-cols-2 gap-2">
                        <Input aria-label="Cargo" value={editForm.cargo} onChange={(event) => setEditForm({ ...editForm, cargo: event.target.value })} className="h-8 rounded-[6px]" placeholder="Cargo" />
                        <Input aria-label="Empresa" value={editForm.empresa} onChange={(event) => setEditForm({ ...editForm, empresa: event.target.value })} className="h-8 rounded-[6px]" placeholder="Empresa" />
                      </div>
                      <Button size="sm" className="h-8 w-full rounded-[6px]" onClick={handleSaveContact}>
                        <Save className="mr-1.5 h-3.5 w-3.5" />
                        Salvar dados
                      </Button>
                    </div>
                  )}
                </section>

                {hasPropertiesModule && <PropertyPickerDialog
                  properties={propertyOptions}
                  selectedPropertyId={localLead.interest_property_id || editForm.property_id || null}
                  onSelect={(property) => void handleSelectInterestProperty(property)}
                  disabled={!canOperateLead || !canViewProperties}
                  isLoading={propertyPickerLoading}
                  onOpenChange={handlePropertyPickerOpenChange}
                />}

                <section className="rounded-[8px] bg-[var(--app-surface-soft)] p-3">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-[12px] font-normal">Documentação</h3>
                    {canOperateLead && (
                      <>
                        <Button variant="ghost" size="sm" className="lead-detail-subtle-action h-7 rounded-[5px] px-2 text-[10px]" disabled={isUploading} onClick={() => fileInputRef.current?.click()}>
                          {isUploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />}
                          Anexar
                        </Button>
                        <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileUpload} />
                      </>
                    )}
                  </div>
                  {attachments.length > 0 && (
                    <div className="space-y-2">
                      {attachments.map((doc) => (
                        <button
                          key={doc.id}
                          type="button"
                          className="flex w-full items-center gap-2 rounded-[6px] border-0 bg-[var(--app-surface-solid)] px-2 py-2 text-left text-xs font-light outline-none transition-colors hover:bg-[var(--app-surface-hover)] focus-visible:ring-1 focus-visible:ring-primary/30"
                          onClick={() => void handleOpenAttachment(doc)}
                        >
                          <FileText className="h-3.5 w-3.5 text-primary" />
                          <span className="truncate">{doc.file_name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </div>
          )}

          {mobileActiveTab === 'actions' && (
            <div className="lead-detail-v2-scroll h-full overflow-y-auto p-3">
              <div className="space-y-3 pb-4">


                {canViewLeadSchedule && <section className="lead-agenda-card rounded-[8px] bg-[var(--app-surface-soft)] p-3">
                  <div className="flex items-center justify-between">
                    <div className="lead-agenda-summary min-w-0">
                      <h3 className="text-[12px] font-normal">Agenda</h3>
                      <p className="text-[10px] text-[var(--app-text-tertiary)]">{scheduleSummaryLabel}</p>
                    </div>
                    <Button
                      size="sm"
                      disabled={!canManageLeadSchedule}
                      className="lead-detail-primary-action lead-agenda-action h-8 shrink-0 rounded-[6px] px-2.5"
                      onClick={() => {
                        setEditingScheduleEvent(null);
                        setScheduleDefaultType('visit');
                        setScheduleFormOpen(true);
                      }}
                    >
                      <Calendar className="h-3.5 w-3.5" />
                      Agendar
                    </Button>
                  </div>
                  <CompactScheduleEventsList
                    events={scheduleEvents}
                    locale={dateLocale}
                    onEditEvent={canManageLeadSchedule ? handleEditScheduleEvent : undefined}
                  />
                </section>}

                <LeadCadencePanel
                  state={leadCadenceState}
                  isLoading={leadCadenceLoading}
                  error={leadCadenceError}
                  isCompleting={completeCadenceTask.isPending}
                  canOperate={canOperateLead}
                  onRetry={() => void refetchLeadCadence()}
                  onTaskClick={handleCadenceTaskClick}
                />

                <section className="rounded-[8px] bg-[var(--app-surface-soft)] p-3">
                  <Textarea
                    aria-label="Feedback do lead"
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
            </div>
          )}

          {mobileActiveTab === 'history' && (
            <div className="h-full p-2">
              <LeadUnifiedThread
                leadId={lead.id}
                leadName={leadName}
                leadAvatarUrl={leadAvatarUrl}
                leadPhone={localLead.phone || null}
                whatsappVerified={localLead.whatsapp_verified ?? null}
                leadCreatedAt={lead.created_at || null}
                readOnly
              />
            </div>
          )}
        </div>
      </div>
    );
  };

  const DesktopContentV2 = () => {
    const leadAvatarUrl = lead.whatsapp_picture || lead.whatsapp_avatar_url || lead.contact_picture || null;
    const dealStatusLabel = localLead.deal_status === 'won' ? 'Ganho' : localLead.deal_status === 'lost' ? 'Perdido' : 'Aberto';
    const contactRows: Array<{ label: string; value: ReactNode; icon?: ReactNode }> = [
      { label: 'Nome', value: <LeadProfileHover lead={localLead} canRevealSensitive={canOperateLead} /> },
      { label: 'Telefone', value: formatPhoneForDisplay(localLead.phone || '') },
      { label: 'Origem', value: getLeadSourceLabel(leadSource) },
      {
        label: 'Campanha',
        value: campaignTrackingDetails ? <CampaignTrackingHover leadMeta={campaignTrackingDetails} /> : null
      },
    ]
      .filter((row) => Boolean(row.value));

    return (
      <div className="lead-detail-dialog lead-detail-v2 flex h-full max-h-full flex-col bg-[var(--app-surface-solid)] text-[var(--app-text-primary)]">
        <div className="border-b border-transparent bg-[var(--app-surface-solid)] px-4 pt-4">
          <DialogHeader className="sr-only">
            <DialogTitle>{leadName}</DialogTitle>
          </DialogHeader>

          <ScrollArea className="w-full" type="scroll">
            <TooltipProvider delayDuration={0}>
              <nav
                data-tour="lead-detail-stages"
                data-lead-stage-stepper
                className="lead-stage-rail flex min-w-max items-center pb-3"
                style={stageStepperStyle}
              >
                {stages.map((stage, idx) => {
                  const isActive = stage.id === localLead.stage_id;
                  const isPast = idx < currentStageIndex;

                  return (
                    <Tooltip key={stage.id}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          disabled={!canOperateLead}
                          aria-label={`Mover para ${stage.name}`}
                          aria-current={isActive ? 'step' : undefined}
                          data-lead-stage-step
                          onClick={() => handleMoveToStage(stage.id)}
                          className={cn(
                            'lead-stage-step group relative flex h-8 w-8 items-center justify-center rounded-[6px] text-xs font-normal transition-colors',
                            isActive
                              ? 'bg-primary text-primary-foreground'
                              : isPast
                                ? 'bg-primary/10 text-primary'
                                : 'bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)] hover:bg-primary/10 hover:text-primary',
                          )}
                        >
                          {idx + 1}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" align="center" sideOffset={8} className={stageTooltipClassName}>
                        {stage.name}
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </nav>
            </TooltipProvider>
            <ScrollBar orientation="horizontal" className="h-1" />
          </ScrollArea>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[280px_1fr_340px] xl:grid-cols-[330px_1fr_390px] grid-rows-[minmax(0,1fr)] gap-0 overflow-hidden">
          <aside className="lead-detail-v2-column border-r border-[var(--app-border)]">
            <div ref={v2LeadInfoScrollRef} className="lead-detail-v2-scroll h-full overflow-y-auto p-4">
              <section className="space-y-3">
                <div className="flex items-start gap-3">
                  <Avatar className="h-11 w-11 shrink-0 border-0">
                    <AvatarImage src={leadAvatarUrl || undefined} alt={leadName} />
                    <AvatarFallback className="bg-primary/12 text-[12px] font-light text-primary">
                      {leadName?.[0]?.toUpperCase() || <User className="h-5 w-5" />}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h2 className="truncate text-[14px] font-normal leading-tight">{leadName}</h2>
                      <ReentryBadge count={lead.reentry_count} lastEntryAt={lead.last_entry_at} />
                    </div>
                    <div data-tour="lead-detail-tags" className="mt-2 flex flex-wrap gap-1.5">
                      {leadTags.map((tag) => {
                        const tagColor = tag.color?.trim() || null;
                        return (
                          <Badge
                            key={tag.id}
                            className={cn(
                              'flex h-6 items-center gap-1 rounded-[5px] border-0 px-2 text-[10px] font-light',
                              'text-white',
                            )}
                            style={getTagColorStyleWithWhiteText(tagColor)}
                          >
                            {tag.name || 'Tag'}
                            <button disabled={!canOperateLead || isTagMutationPending} type="button" aria-label={`Remover tag ${tag.name || 'Tag'}`} title="Remover tag" className="rounded-[3px] p-0.5 hover:bg-primary-foreground/15 disabled:hidden" onClick={() => handleRemoveTag(tag.id)}>
                              <X className="h-2.5 w-2.5" />
                            </button>
                          </Badge>
                        );
                      })}
                      <Popover open={tagPopoverOpen} onOpenChange={(open) => canOperateLead && !isTagMutationPending && setTagPopoverOpen(open)}>
                        <PopoverTrigger asChild>
                          <Button disabled={!canOperateLead || isTagMutationPending} variant="ghost" size="sm" className="h-6 rounded-[5px] border-0 bg-[var(--app-surface-soft)] px-2 text-[10px] disabled:hidden">
                            <Plus className="mr-1 h-3 w-3" />
                            Tag
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-64 p-0" align="start">
                          <TagSelectorPopoverContent availableTags={availableTags} onAddTag={handleAddTag} onClose={() => setTagPopoverOpen(false)} />
                        </PopoverContent>
                      </Popover>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                  <Popover open={assigneePopoverOpen} onOpenChange={handleAssigneePopoverChange}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="ghost"
                        aria-label="Alterar responsável pelo lead"
                        className="h-8 min-w-0 justify-start rounded-[6px] bg-[var(--app-surface-soft)] px-3 text-xs font-light text-[var(--app-text-secondary)]"
                        disabled={!canTransferLead}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <User className="mr-1.5 h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{assigneeName || 'Sem responsável'}</span>
                        {isUpdatingAssignee ? <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin" /> : <ChevronDown className="ml-auto h-3.5 w-3.5" />}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      className="w-[300px] overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-1 shadow-none"
                      align="start"
                      collisionPadding={12}
                      onWheelCapture={(event) => event.stopPropagation()}
                      onTouchMoveCapture={(event) => event.stopPropagation()}
                    >
                      <Command filter={commandSearchFilter} className="max-h-[min(72vh,420px)] border-none bg-transparent [&_[cmdk-input-wrapper]]:border-b-0 [&_[cmdk-input-wrapper]]:px-2">
                        <CommandInput placeholder="Buscar..." className="h-9 border-none focus:ring-0" />
                        <CommandList
                          className="max-h-[min(56vh,320px)] overflow-y-auto overscroll-contain p-1 touch-pan-y scrollbar-thin [-webkit-overflow-scrolling:touch]"
                          onWheelCapture={(event) => event.stopPropagation()}
                          onTouchMoveCapture={(event) => event.stopPropagation()}
                        >
                          <CommandEmpty className="py-4 text-center text-sm text-muted-foreground">Nenhum encontrado.</CommandEmpty>
                          <CommandGroup>
                            <CommandItem onSelect={() => handleAssignUser(null)} className="cursor-pointer rounded-[6px] px-3 py-2">
                              Sem responsável
                            </CommandItem>
                            {assignableUsers.map((user) => (
                              <CommandItem key={user.id} onSelect={() => handleAssignUser(user.id)} className="cursor-pointer rounded-[6px] px-3 py-2">
                                <div className="flex min-w-0 items-center gap-2">
                                  <Avatar className="h-7 w-7">
                                    <AvatarImage src={user.avatar_url || undefined} alt={user.name || user.email || 'Responsável'} />
                                    <AvatarFallback className="text-[10px]">{(user.name || user.email || 'U')[0]}</AvatarFallback>
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

                  <div onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                    <Select value={localLead.deal_status || 'open'} onValueChange={handleDealStatusChange} disabled={!canOperateLead}>
                      <SelectTrigger
                        className={cn(
                          'h-8 w-[92px] gap-1 rounded-[6px] px-2 text-xs font-light',
                          getDealStatusTriggerClass(localLead.deal_status),
                        )}
                      >
                        <SelectValue>{dealStatusLabel}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="open">Aberto</SelectItem>
                        <SelectItem value="won">Ganho</SelectItem>
                        <SelectItem value="lost">Perdido</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-flow-col auto-cols-fr gap-2">
                  {localLead.phone && (
                    <Button disabled={!canOperateLead} variant="outline" size="sm" aria-label={`Ligar para ${leadName}`} title="Ligar" onClick={handleQuickPhone} className="h-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)]">
                      <Phone className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button disabled={!canOpenLeadWhatsApp || !localLead.phone} size="sm" onClick={handleQuickWhatsApp} className="h-8 rounded-[6px] px-2 text-xs">
                    <MessageCircle className="mr-1 h-3.5 w-3.5" />
                    Chat
                  </Button>
                  {localLead.email && (
                    <Button disabled={!canOperateLead} variant="outline" size="sm" aria-label={`Enviar e-mail para ${leadName}`} title="Enviar e-mail" onClick={handleQuickEmail} className="h-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)]">
                      <Mail className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>

                <div data-tour="lead-detail-contact" className="rounded-[8px] bg-[var(--app-surface-soft)] p-3">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-[12px] font-normal">Dados do contato</h3>
                    {canOperateLead && <Button variant="ghost" size="sm" className="lead-detail-subtle-action h-7 rounded-[5px] px-2 text-[10px]" onClick={handleOpenLeadEdit}>
                      <FileEdit className="h-3 w-3" />
                      Editar
                    </Button>}
                  </div>

                  <div className="space-y-2">
                    {contactRows.map((row) => (
                      <InfoLine key={row.label} label={row.label} value={row.value} icon={row.icon} />
                    ))}
                  </div>

                  {isEditingContact && (
                    <div className="mt-3 space-y-2">
                      <Input aria-label="Nome" value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} className="h-8 rounded-[6px]" placeholder="Nome" />
                      <div role="group" aria-label="Telefone"><InternationalPhoneInput value={editForm.phone} onChange={(value) => setEditForm({ ...editForm, phone: value })} /></div>
                      <Input aria-label="E-mail" type="email" value={editForm.email} onChange={(event) => setEditForm({ ...editForm, email: event.target.value })} className="h-8 rounded-[6px]" placeholder="E-mail" />
                      <div className="grid grid-cols-2 gap-2">
                        <Input aria-label="Cargo" value={editForm.cargo} onChange={(event) => setEditForm({ ...editForm, cargo: event.target.value })} className="h-8 rounded-[6px]" placeholder="Cargo" />
                        <Input aria-label="Empresa" value={editForm.empresa} onChange={(event) => setEditForm({ ...editForm, empresa: event.target.value })} className="h-8 rounded-[6px]" placeholder="Empresa" />
                      </div>
                      <Button size="sm" className="h-8 w-full rounded-[6px]" onClick={handleSaveContact}>
                        <Save className="mr-1.5 h-3.5 w-3.5" />
                        Salvar dados
                      </Button>
                    </div>
                  )}
                </div>

                {hasPropertiesModule && <PropertyPickerDialog
                  properties={propertyOptions}
                  selectedPropertyId={localLead.interest_property_id || editForm.property_id || null}
                  onSelect={(property) => void handleSelectInterestProperty(property)}
                  disabled={!canOperateLead || !canViewProperties}
                  isLoading={propertyPickerLoading}
                  onOpenChange={handlePropertyPickerOpenChange}
                />}

                <div data-tour="lead-detail-documents" className="rounded-[8px] bg-[var(--app-surface-soft)] p-3">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-[12px] font-normal">Documentação</h3>
                    {canOperateLead && (
                      <>
                        <Button variant="ghost" size="sm" className="lead-detail-subtle-action h-7 rounded-[5px] px-2 text-[10px]" disabled={isUploading} onClick={() => fileInputRef.current?.click()}>
                          {isUploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />}
                          Anexar
                        </Button>
                        <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileUpload} />
                      </>
                    )}
                  </div>
                  {attachments.length > 0 && (
                    <div className="max-h-44 space-y-2 overflow-y-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      {attachments.map((doc) => (
                        <button
                          key={doc.id}
                          type="button"
                            className="flex w-full items-center gap-2 rounded-[6px] border-0 bg-[var(--app-surface-solid)] px-2 py-2 text-left text-xs font-light outline-none transition-colors hover:bg-[var(--app-surface-hover)] focus-visible:ring-1 focus-visible:ring-primary/30"
                          onClick={() => void handleOpenAttachment(doc)}
                        >
                          <FileText className="h-3.5 w-3.5 text-primary" />
                          <span className="truncate">{doc.file_name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

              </section>
            </div>
          </aside>

          <main className="lead-detail-v2-column">
            <div ref={v2LeadWorkScrollRef} className="lead-detail-v2-scroll h-full overflow-y-auto p-4">
              <div className="space-y-4">


                {canViewLeadSchedule && <section data-tour="lead-detail-agenda" className="lead-agenda-card rounded-[8px] bg-[var(--app-surface-soft)] p-3">
                  <div className="flex items-center justify-between">
                    <div className="lead-agenda-summary min-w-0">
                      <h3 className="text-[12px] font-normal">Agenda</h3>
                      <p className="text-[10px] text-[var(--app-text-tertiary)]">{scheduleSummaryLabel}</p>
                    </div>
                    <Button
                      size="sm"
                      disabled={!canManageLeadSchedule}
                      className="lead-detail-primary-action lead-agenda-action h-8 shrink-0 rounded-[6px] px-2.5"
                      onClick={() => {
                        setEditingScheduleEvent(null);
                        setScheduleDefaultType('visit');
                        setScheduleFormOpen(true);
                      }}
                    >
                      <Calendar className="h-3.5 w-3.5" />
                      Agendar
                    </Button>
                  </div>
                  <CompactScheduleEventsList
                    events={scheduleEvents}
                    locale={dateLocale}
                    onEditEvent={canManageLeadSchedule ? handleEditScheduleEvent : undefined}
                  />
                </section>}

                <LeadCadencePanel
                  state={leadCadenceState}
                  isLoading={leadCadenceLoading}
                  error={leadCadenceError}
                  isCompleting={completeCadenceTask.isPending}
                  canOperate={canOperateLead}
                  onRetry={() => void refetchLeadCadence()}
                  onTaskClick={handleCadenceTaskClick}
                />

                <section data-tour="lead-detail-feedback" className="rounded-[8px] bg-[var(--app-surface-soft)] p-3">
                  <Textarea
                    aria-label="Feedback do lead"
                    placeholder="Registre o feedback sobre atendimento, perfil ou próximos passos..."
                    value={feedback}
                    onChange={(event) => setFeedback(event.target.value)}
                    disabled={!canOperateLead}
                    className="min-h-[74px] resize-none rounded-[6px] border-0 bg-[var(--app-surface-solid)] text-xs"
                  />
                  <div className="mt-2 flex justify-end">
                    <Button
                      className="lead-detail-primary-action h-8 rounded-[6px] px-3"
                      disabled={!canOperateLead || !feedback.trim() || updateLead.isPending}
                      onClick={handleSaveFeedback}
                    >
                      Registrar feedback
                    </Button>
                  </div>
                </section>
              </div>
            </div>
          </main>

          <aside data-tour="lead-detail-history" className="lead-detail-v2-column border-l border-[var(--app-border)]">
            <LeadUnifiedThread
              leadId={lead.id}
              leadName={leadName}
              leadAvatarUrl={leadAvatarUrl}
              leadPhone={localLead.phone || null}
              whatsappVerified={localLead.whatsapp_verified ?? null}
              leadCreatedAt={lead.created_at || null}
              readOnly
            />
          </aside>
        </div>
      </div>
    );
  };

  const overlays = (
    <LeadDetailOverlays
      lead={lead}
      leadName={leadName}
      selectedTask={selectedTask}
      roteiroDialogOpen={roteiroDialogOpen}
      onRoteiroDialogOpenChange={setRoteiroDialogOpen}
      onRoteiroAction={handleRoteiroAction}
      taskForOutcome={taskForOutcome}
      outcomeDialogOpen={outcomeDialogOpen}
      onOutcomeDialogOpenChange={setOutcomeDialogOpen}
      onOutcomeConfirm={handleOutcomeConfirm}
      quickActionOutcomeOpen={quickActionOutcomeOpen}
      quickActionOutcomeType={quickActionOutcomeType}
      onQuickActionOutcomeOpenChange={setQuickActionOutcomeOpen}
      onQuickActionOutcomeConfirm={handleQuickActionOutcomeConfirm}
      cadenceTaskPending={completeCadenceTask.isPending}
      quickActionPending={createActivityMutation.isPending}
      reopenStatusConfirmation={reopenStatusConfirmation}
      onReopenStatusConfirmationChange={setReopenStatusConfirmation}
      onConfirmReopen={(confirmation) => {
        void handleDealStatusChange('open', {
          skipReopenConfirmation: true,
          previousStatusOverride: confirmation.fromStatus,
        });
      }}
      assigneeScheduleConfirmation={assigneeScheduleConfirmation}
      onAssigneeScheduleConfirmationChange={setAssigneeScheduleConfirmation}
      onConfirmAssignee={(confirmation) => {
        setAssigneeScheduleConfirmation(null);
        void handleAssignUser(confirmation.userId, { skipScheduleConfirmation: true });
      }}
      dealStatusPending={dealStatusChange.isPending || stageMovePending}
      lostReasonDialogOpen={lostReasonDialogOpen}
      onLostReasonDialogOpenChange={(open) => {
        if (!open && !stageMovePending) setPendingLostStageId(null);
        setLostReasonDialogOpen(open);
      }}
      onConfirmLostReason={handleConfirmLostReason}
      selectedAttachment={selectedAttachment}
      onSelectedAttachmentChange={setSelectedAttachment}
      hasAgendaModule={hasAgendaModule}
      scheduleFormOpen={scheduleFormOpen}
      onCloseScheduleForm={handleCloseScheduleForm}
      editingScheduleEvent={editingScheduleEvent}
      scheduleDefaultType={scheduleDefaultType}
    />
  );

  // Render mobile or desktop version - use JSX directly instead of component functions
  if (isMobile) {
    return (
      <>
        <Drawer open={Boolean(leadProp)} onOpenChange={(open) => !open && handleCloseLeadDetail()} dismissible={!isEditingContact}>
          <DrawerContent
            className="lead-mobile-drawer mx-auto w-full overflow-hidden rounded-t-[8px] border-0 bg-[var(--app-surface-solid)] p-0 text-[var(--app-text-primary)] shadow-none"
            showHandle={false}
            onInteractOutside={(event) => {
              const target = event.target as HTMLElement | null;
              const isInsideAnotherDialog = target?.closest('.vimob-dialog-content');
              if (
                target?.closest('[data-radix-popper-content-wrapper], [role="listbox"]') ||
                isInsideAnotherDialog
              ) {
                event.preventDefault();
              }
            }}
          >
            <DrawerTitle className="sr-only">
              {leadName ? `Detalhes do lead ${leadName}` : 'Detalhes do lead'}
            </DrawerTitle>
            {MobileContentV2()}
          </DrawerContent>
        </Drawer>
        {overlays}
      </>
    );
  }
  return (
    <>
      <Dialog
        open={Boolean(leadProp)}
        onOpenChange={(open) => {
          if (!open && document.documentElement.dataset.setupGuideActiveStep === 'pipeline') return;
          if (!open) handleCloseLeadDetail();
        }}
      >
        <DialogContent
          data-tour="lead-detail-dialog"
          className="lead-detail-dialog-content flex h-[92vh] max-h-[92vh] w-[96vw] max-w-[1180px] flex-col gap-0 overflow-hidden rounded-[8px] border-none bg-[var(--app-surface-solid)] p-0 text-[var(--app-text-primary)] shadow-none lg:h-[min(720px,84vh)] lg:max-h-[84vh] lg:w-[92vw] xl:w-[min(1180px,92vw)]"
          style={{ border: 'none', outline: 'none' }}
          onInteractOutside={(event) => {
            const target = event.target as Element | null;
            const isInsideAnotherDialog = target?.closest?.('.vimob-dialog-content') && !target?.closest?.('.lead-detail-dialog-content');
            if (
              target?.closest?.('[data-radix-popper-content-wrapper], [role="listbox"]') ||
              isInsideAnotherDialog
            ) {
              event.preventDefault();
            }
          }}
        >
          {/* Inline JSX instead of <DesktopContent /> to prevent re-mounting */}
          {DesktopContentV2()}
        </DialogContent>
      </Dialog>
      {overlays}
    </>
  );
}
