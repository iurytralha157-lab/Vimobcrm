import { useState, useEffect, useLayoutEffect, useMemo, useRef, useId, type CSSProperties, type ReactNode } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { getClientRateLimitMessage } from '@/lib/client-action-rate-limit';
import { PropertyPickerDialog } from '@/components/features/properties/PropertyPickerDialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from '@/components/ui/drawer';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { useIsMobile } from '@/hooks/use-mobile';
import { LeadAttachmentsStatus } from '@/components/features/leads/LeadAttachmentsStatus';
import {
  Phone, Mail, MessageCircle, Loader2, X, Plus, User,
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
import { ptBR, enUS } from 'date-fns/locale';
import { useCompleteCadenceTask } from '@/hooks/use-lead-tasks';
import { useLeadCadenceState } from '@/hooks/leads/use-lead-cadence-state';
import { useLeadFeedbackDraft } from '@/hooks/leads/use-lead-feedback-draft';
import { useLeadAttachmentUploadDraft } from '@/hooks/leads/use-lead-attachment-upload-draft';
import { LeadAttachmentUploadRecovery } from '@/components/features/leads/lead-detail/LeadAttachmentUploadRecovery';
import { useRecordLeadFeedback } from '@/hooks/leads/use-record-lead-feedback';
import { useLeadMoveContract } from '@/hooks/leads/use-lead-move-contract';
import { useLeadOutcomeDraft } from '@/hooks/leads/use-lead-outcome-draft';
import { useLeadCardOutcomeDraft } from '@/hooks/leads/use-lead-card-outcome-draft';
import { useRecordLeadContactOutcome } from '@/hooks/leads/use-record-lead-contact-outcome';
import { useLeadDetailOperationScope } from '@/hooks/leads/use-lead-detail-operation-scope';
import { useLeadRequestScope, type LeadRequestOperation } from '@/hooks/leads/use-lead-request-scope';
import { useLeadStatusConfirmation } from '@/hooks/leads/use-lead-status-confirmation';
import { useLeadTagOptimism } from '@/hooks/leads/use-lead-tag-optimism';
import { isDefiniteLeadFieldRejection, useLeadFieldOptimism } from '@/hooks/leads/use-lead-field-optimism';
import { useCreateActivity } from '@/hooks/use-activities';
import { useLead, useUpdateLead, useAddLeadTag, useRemoveLeadTag } from '@/hooks/use-leads';
import type { Lead } from '@/hooks/use-leads';
import { useProperty } from '@/hooks/use-properties';
import { ScheduleEvent, EventType } from '@/hooks/use-schedule-events';
import { useLeadSchedulePreview } from '@/hooks/leads/use-lead-schedule-preview';
import { useLeadMeta } from '@/hooks/use-lead-meta';
import { useLeadAttachments, useUploadLeadAttachment, type LeadAttachment } from '@/hooks/use-lead-attachments';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { useFloatingChat } from '@/contexts/FloatingChatContext';
import { LeadUnifiedThread } from '@/components/features/leads/LeadUnifiedThread';
import { ReentryBadge } from '@/components/features/leads/ReentryBadge';
import { CopyLeadPhoneButton } from '@/components/features/leads/CopyLeadPhoneButton';
import { QueuePoolClaimButton } from '@/components/features/leads/QueuePoolClaimButton';
import { LeadCadencePanel } from '@/components/features/leads/LeadCadencePanel';
import { resolvedFirstResponse } from '@/components/features/leads/lead-detail/first-response';

import type { TaskOutcome } from '@/components/features/leads/TaskOutcomeDialog';
import { toast } from 'sonner';
import { formatPhoneForDisplay, normalizePhoneToE164 } from '@/lib/phone-utils';
import { TagSelectorPopoverContent } from '@/components/ui/tag-selector';
import { useDealStatusChange } from '@/hooks/use-deal-status-change';
import { useRecordFirstResponseOnAction } from '@/hooks/use-first-response';
import { formatResponseTime } from '@/hooks/use-lead-timeline';
import { useLeadHistory } from '@/hooks/use-lead-history';
import { useOrganizationModules } from '@/hooks/use-organization-modules';
import { useUserPermissions } from '@/hooks/use-user-permissions';
import { useTeams } from '@/hooks/use-teams';
import { appendOptimisticLeadHistoryEvent, removeOptimisticLeadHistoryEvent } from '@/hooks/use-optimistic-lead-history';
import { leadsAPI } from '@/lib/api/leads';
import { hydrateLeadDetail, mergeLeadDetailMutation } from '@/components/features/leads/lead-detail/hydrate-lead-detail';
import { LeadScheduleReadDialog } from '@/components/features/leads/lead-detail/LeadScheduleReadDialog';
import { canOperateLeadFromFreshRead, mergeLeadOperationCapability } from '@/lib/lead-operation-capability';
import pipelineDetailStyles from '@/components/features/leads/lead-detail/PipelineLeadDetail.module.css';
import { PipelineMobileLeadHeader } from '@/components/features/leads/lead-detail/PipelineMobileLeadHeader';
import { LeadTagPickerContent } from '@/components/features/leads/lead-detail/LeadTagPickerContent';
import { LeadDetailReadNotice } from '@/components/features/leads/lead-detail/LeadDetailReadNotice';
import { getLeadDetailReadState } from '@/components/features/leads/lead-detail/read-recovery';
import { LeadAssigneeCatalogNotice } from '@/components/features/leads/lead-detail/LeadAssigneeCatalogNotice';
import type { TagCatalog } from '@/lib/validation/tag-catalog';
import { VimobAPIError } from '@/lib/api/vimob-client';
import { getGlobalSignOutSessionId } from '@/lib/auth/global-sign-out';
import { getPipelineStageOutcome } from '@/lib/pipeline-stage-outcome';
import { capturePipelineMoveRevision, type PipelineMoveRevision } from '@/lib/pipeline-move-revision';
import { getLeadAssigneeAvailability } from '@/lib/lead-assignee-availability';
import { isAttendanceScheduleType, isFinalScheduleStatus } from '@/lib/schedule-outcome';
import { compareServerRevisions } from '@/lib/compare-server-revisions';
import { getDisplayInitial, normalizeDisplayName } from '@/lib/display-name';
import { mergeLeadServerResponse } from '@/lib/merge-lead-server-response';
import { requiresWonLeadFinancialReview, WON_LEAD_FINANCIAL_REVIEW_MESSAGE } from '@/components/features/leads/lead-detail/financial-review';
import { getLeadStatusFinancialReviewMessage } from '@/lib/lead-financial-review';
import { assertLeadFinancialFields } from '@/lib/validation/lead-financial-values';
import { replaceOwnedPropertyDraft, rollbackLeadPropertySelection } from '@/components/features/leads/lead-detail/property-selection-rollback';
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

type LeadStageMoveIntent = {
  stageId: string;
  revision: PipelineMoveRevision;
  operation: { isCurrent: () => boolean };
  requestOperation: LeadRequestOperation;
};

type LeadAssigneeSelection = {
  leadId: string;
  userId: string | null;
  expectedUpdatedAt: string;
  operation: { isCurrent: () => boolean };
  requestOperation: LeadRequestOperation;
};

function useIsLeadDetailTablet(maxWidth: number) {
  const [isTablet, setIsTablet] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(`(min-width: 768px) and (max-width: ${maxWidth}px)`);
    const sync = () => setIsTablet(media.matches);
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) sync();
    });
    media.addEventListener('change', sync);
    return () => {
      cancelled = true;
      media.removeEventListener('change', sync);
    };
  }, [maxWidth]);

  return isTablet;
}

export function LeadDetailDialog({
  lead: leadProp,
  stages,
  onClose,
  onEdit,
  allTags,
  allUsers,
  allUsersState,
  variant = 'default',
  hideWhatsAppAction = false,
  verifiedRead,
  readAccessPending = false,
  readAccessBlocked = false,
}: LeadDetailDialogProps) {
  const lead = leadProp ?? ({} as LeadDetailLead);
  const { activeOrganization, profile, organization, user, session } = useAuth();
  const { language } = useLanguage();
  const mobileTabsId = useId();
  const isMobile = useIsMobile();
  const isTablet = useIsLeadDetailTablet(variant === 'contacts' ? 1199 : 1023);
  const dateLocale = language === 'pt-BR' ? ptBR : enUS;
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);
  const [assigneePopoverOpen, setAssigneePopoverOpen] = useState(false);
  const [localLead, setLocalLead] = useState<LeadDetailLead | null>(leadProp);
  const [isUpdatingAssignee, setIsUpdatingAssignee] = useState(false);
  const assigneeUpdatingRef = useRef(false);
  // Keep assignment intent beside this legacy action; extract detail actions into lead-detail after the CAS boundary is stable.
  const assigneeSelectionRef = useRef<LeadAssigneeSelection | null>(null);
  const [scheduleFormOpen, setScheduleFormOpen] = useState(false);
  const [editingScheduleEvent, setEditingScheduleEvent] = useState<ScheduleEvent | null>(null);
  const [readOnlyScheduleEvent, setReadOnlyScheduleEvent] = useState<ScheduleEvent | null>(null);
  const [scheduleDefaultType, setScheduleDefaultType] = useState<EventType>('call');
  const [activeTab, setActiveTab] = useState('activities');
  const [selectedTask, setSelectedTask] = useState<LeadCadenceTaskState | null>(null);
  const [taskInspectOnly, setTaskInspectOnly] = useState(false);
  const [roteiroDialogOpen, setRoteiroDialogOpen] = useState(false);
  const [outcomeDialogOpen, setOutcomeDialogOpen] = useState(false);
  const [taskForOutcome, setTaskForOutcome] = useState<LeadCadenceTaskState | null>(null);
  const [quickActionOutcomeOpen, setQuickActionOutcomeOpen] = useState(false);
  const [quickActionOutcomeType, setQuickActionOutcomeType] = useState<'call' | 'email'>('call');
  const [quickActionSubmitting, setQuickActionSubmitting] = useState(false);
  const quickActionSubmittingRef = useRef(false);
  const [cadenceActionPending, setCadenceActionPending] = useState(false);
  const cadenceActionPendingRef = useRef(false);
  const statusSubmittingRef = useRef(false);
  const feedbackSubmittingRef = useRef(false);
  const propertySaveOperationRef = useRef<{ isCurrent: () => boolean } | null>(null);
  const [selectedAttachment, setSelectedAttachment] = useState<LeadAttachment | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [reopenStatusConfirmation, setReopenStatusConfirmation] =
    useState<ReopenStatusConfirmation | null>(null);
  const [assigneeScheduleConfirmation, setAssigneeScheduleConfirmation] =
    useState<AssigneeScheduleConfirmation | null>(null);
  const handleCloseLeadDetail = () => {
    statusConfirmation.clear();
    assigneeSelectionRef.current = null;
    setAssigneeScheduleConfirmation(null);
    setReadOnlyScheduleEvent(null);
    onClose();
  };
  const v2LeadInfoScrollRef = useRef<HTMLDivElement>(null);
  const v2LeadWorkScrollRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const requestScope = useLeadRequestScope();
  const { openNewChat, openNewChatWithMessage } = useFloatingChat();
  const {
    refreshPipelineInBackground,
    restorePipelineCache,
    updatePipelineAssigneeCache,
    updatePipelineLeadCache,
  } = useLeadDetailPipelineCache();

  const leadId = leadProp?.id ?? null;
  const panelSessionId = getGlobalSignOutSessionId(session);
  useLayoutEffect(() => {
    if (!leadId) return;
    // A fresh snapshot of the same lead must not interrupt panel navigation.
    v2LeadInfoScrollRef.current?.scrollTo({ top: 0 });
    v2LeadWorkScrollRef.current?.scrollTo({ top: 0 });
  }, [leadId, leadProp?.organization_id, activeOrganization.organizationId, user?.id, panelSessionId]);
  const attachmentUploadDraft = useLeadAttachmentUploadDraft(activeOrganization.organizationId || null, leadId,
    user?.id || null, getGlobalSignOutSessionId(session));
  const isUploading = attachmentUploadDraft.draft?.phase === 'pending';
  const outcomeScopeKey = `${activeOrganization.organizationId}:${leadId}:${user?.id}:${getGlobalSignOutSessionId(session)}:${verifiedRead?.selectionVersion}`;
  const outcomeDraft = useLeadOutcomeDraft(`${outcomeScopeKey}:cadence:${taskForOutcome?.id || ''}`);
  const quickActionDraft = useLeadCardOutcomeDraft(activeOrganization.organizationId, user?.id,
    getGlobalSignOutSessionId(session), leadId || '', quickActionOutcomeType);
  const fullLeadQuery = useLead(leadId, { freshOnMount: true, verifiedRead });
  const detailReadState = getLeadDetailReadState({ leadId, organizationId: activeOrganization.organizationId,
    leadOrganizationId: leadProp?.organization_id, query: { data: fullLeadQuery.data, dataUpdatedAt: fullLeadQuery.dataUpdatedAt,
      isSuccess: fullLeadQuery.isSuccess, isFetching: fullLeadQuery.isFetching, isFetchedAfterMount: fullLeadQuery.isFetchedAfterMount,
      isError: fullLeadQuery.isError, error: fullLeadQuery.error }, verifiedRead });
  const retryLeadRead = () => {
    if (detailReadState.canRetry) void fullLeadQuery.refetch({ cancelRefetch: false });
  };
  const statusConfirmation = useLeadStatusConfirmation(leadId, fullLeadQuery.data,
    readAccessBlocked || readAccessPending || fullLeadQuery.isFetching || !fullLeadQuery.isSuccess);
  const leadHistoryQuery = useLeadHistory(leadId, { paginated: variant === 'pipeline' });
  const [lostReasonLocal, setLostReasonLocal] = useState(lead?.lost_reason || '');
  const [lostReasonDialogOpen, setLostReasonDialogOpen] = useState(false);
  const [pendingLostStageMove, setPendingLostStageMove] = useState<LeadStageMoveIntent | null>(null);
  const [stageMovePending, setStageMovePending] = useState(false);
  const stageMovePendingRef = useRef(false);
  const { draft: feedback, updateDraft: setFeedback, acknowledgeSavedDraft, getSubmission } = useLeadFeedbackDraft(
    leadProp?.organization_id || activeOrganization.organizationId || null, leadId, user?.id || null,
  );

  const handleSaveFeedback = async () => {
    if (!canOperateLead || !feedback.trim() || feedbackSubmittingRef.current) return;
    feedbackSubmittingRef.current = true;
    const submittedDraft = feedback;
    let operation: ReturnType<typeof captureDetailOperation> | undefined;
    let mutationStarted = false;
    try {
      operation = captureDetailOperation();
      const command = getSubmission(submittedDraft);
      mutationStarted = true;
      await recordLeadFeedback.mutateAsync({ ...command, leadId: lead.id });
      if (!operation.isCurrent()) return;
      acknowledgeSavedDraft(submittedDraft, command.commandId);
      if (operation.isCurrent()) toast.success('Feedback registrado com sucesso!');
    } catch (error) {
      if (!mutationStarted && operation?.isCurrent()) toast.error(`Não foi possível preparar o feedback: ${getErrorMessage(error)}`);
      // The mutation reports transport errors; keep the same command for retry.
    } finally {
      feedbackSubmittingRef.current = false;
    }
  };

  const [editForm, setEditForm] = useState({
    valor_interesse: '',
    commission_percentage: '',
    property_id: '',
  });

  // Sync edit form with lead data whenever lead changes
  useEffect(() => {
    if (!leadProp || isUpdatingAssignee) return;

    const fullLead = fullLeadQuery.data as LeadDetailLead | null | undefined;
    const hydratedLead = fullLead ? (
      compareServerRevisions(leadProp.updated_at, fullLead.updated_at) === 1
        ? hydrateLeadDetail(fullLead, leadProp) : hydrateLeadDetail(leadProp, fullLead)
    ) : leadProp;

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

    const valorStr = leadProp.valor_interesse ? leadProp.valor_interesse.toString() : '';
    const nextForm = {
      valor_interesse: valorStr,
      commission_percentage: leadProp.commission_percentage != null ? leadProp.commission_percentage.toString() : '',
      property_id: leadProp.interest_property_id || leadProp.property_id || '',
    };

    let isActive = true;
    queueMicrotask(() => {
      if (!isActive) return;
      setEditForm(nextForm);
    });

    return () => {
      isActive = false;
    };
  }, [leadProp, activeOrganization.organizationId, user?.id]);

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
  const cadenceOrganizationId =
    leadProp?.organization_id || activeOrganization.organizationId || null;
  const {
    data: leadCadenceState,
    isLoading: leadCadenceLoading,
    error: leadCadenceError,
    refetch: refetchLeadCadence,
  } = useLeadCadenceState(leadId, cadenceOrganizationId, leadProp?.stage_id);
  const { hasPermission } = useUserPermissions();
  const hasLeadOperatePermission = hasPermission('lead_operate');
  const poolReadOnly = Boolean(localLead?.queue_pool || fullLeadQuery.data?.queue_pool);
  const captureDetailOperation = useLeadDetailOperationScope(
    leadId, activeOrganization.organizationId, user?.id || null, queryClient, hasLeadOperatePermission && !readAccessBlocked && !detailReadState.hideDetails, getGlobalSignOutSessionId(session),
  );
  // A background refetch caused by the first response must not retire its own feedback.
  const captureCadenceFeedbackOperation = useLeadDetailOperationScope(
    leadId, activeOrganization.organizationId, user?.id || null, queryClient,
    !readAccessBlocked && !detailReadState.hideDetails && !poolReadOnly && hasLeadOperatePermission && fullLeadQuery.data?.can_operate === true,
    getGlobalSignOutSessionId(session),
  );
  const { hasModule } = useOrganizationModules();
  const updateLead = useUpdateLead();
  const recordLeadFeedback = useRecordLeadFeedback();
  const dealStatusChange = useDealStatusChange();
  const canOperateLead = detailReadState.kind === 'ready' && !readAccessBlocked && !poolReadOnly && !isUpdatingAssignee && !updateLead.isPending && !recordLeadFeedback.isPending && !dealStatusChange.isPending && !stageMovePending && !readAccessPending && canOperateLeadFromFreshRead(
    hasLeadOperatePermission,
    fullLeadQuery,
    verifiedRead,
  );
  const outcomeBlockedReason = canOperateLead ? undefined : detailReadState.blockedReason || (
    poolReadOnly ? 'Assuma o lead antes de registrar o resultado.' : !hasLeadOperatePermission
      ? 'Seu acesso a este lead permite apenas visualização.' : 'Aguarde a atualização em andamento para registrar o resultado.'
  );
  const moveContract = useLeadMoveContract(canOperateLead);
  const tagOptimism = useLeadTagOptimism({ leadId, organizationId: activeOrganization.organizationId,
    actorId: user?.id || null, sessionId: getGlobalSignOutSessionId(session), canOperate: canOperateLead, setLead: setLocalLead });
  const fieldOptimism = useLeadFieldOptimism({ leadId, organizationId: activeOrganization.organizationId,
    actorId: user?.id || null, sessionId: getGlobalSignOutSessionId(session), setLead: setLocalLead });
  const handleOpenLeadEdit = () => {
    if (!canOperateLead) return;
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
  const openLeadWhatsApp = (message?: string, canOpenCapturedAccess?: () => boolean) => {
    if (canOpenCapturedAccess && !canOpenCapturedAccess()) return false;
    const currentLead = localLead || lead;
    if (poolReadOnly) { toast.info('Assuma o lead antes de iniciar o atendimento.'); return false; }
    const preparedMessage = message?.trim() || '';
    const canOpenLeadWhatsApp = preparedMessage
      ? canOperateLeadWhatsApp
      : canViewLeadWhatsApp;

    if (!canOpenLeadWhatsApp) {
      toast.error('WhatsApp indisponível para este usuário.');
      return false;
    }
    if (!currentLead.phone) {
      toast.error('Cadastre um telefone antes de iniciar a conversa.');
      return false;
    }

    const phone = currentLead.phone;
    const leadName = currentLead.name || 'Lead';
    handleCloseLeadDetail();
    queueMicrotask(() => {
      if (canOpenCapturedAccess && !canOpenCapturedAccess()) return;
      if (preparedMessage) {
        openNewChatWithMessage(phone, preparedMessage, currentLead.id, leadName);
        return;
      }
      openNewChat(phone, leadName, currentLead.id);
    });
    return true;
  };
  const canViewProperties =
    hasPropertiesModule &&
    (hasPermission('property_view') || hasPermission('property_manage'));
  const canViewLeadSchedule = hasAgendaModule && hasPermission('schedule_view');
  const canManageLeadSchedule = hasAgendaModule && canOperateLead && hasPermission('schedule_manage');
  const selectedPropertyId = localLead?.interest_property_id || localLead?.property_id || editForm.property_id || null;
  const { data: persistedProperty } = useProperty(canViewProperties && leadProp ? selectedPropertyId : null);
  const propertyOptions = mergePropertyFallback(
    mergePropertyFallback([], persistedProperty || null),
    getLeadPropertyFallback(localLead),
  );
  const schedulePreview = useLeadSchedulePreview(leadId, canViewLeadSchedule);
  const {
    events: scheduleEvents,
    isPending: schedulePending,
    isError: scheduleError,
    refetch: refetchScheduleEvents,
  } = schedulePreview;
  const scheduleSummaryLabel = useMemo(() => {
    if (schedulePending && scheduleEvents.length === 0) return 'Carregando compromissos...';
    if (scheduleError && scheduleEvents.length === 0) return 'Não foi possível carregar os compromissos';
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
    ].filter(Boolean).join(' · ') + (schedulePreview.hasNextPage ? ' · lista parcial' : '');
  }, [scheduleEvents, schedulePending, scheduleError, schedulePreview.hasNextPage]);
  const leadMetaQuery = useLeadMeta(leadId);
  const leadMeta = leadMetaQuery.data;
  const completeCadenceTask = useCompleteCadenceTask();
  const addTag = useAddLeadTag();
  const removeTag = useRemoveLeadTag();
  const { data: stageAutomations = [] } = useStageAutomations();
  const { recordFirstResponse } = useRecordFirstResponseOnAction();
  const teamCatalog = useTeams({
    includeInactive: true,
    enabled: hasPermission('team_view'),
  });
  const teams = teamCatalog.data || [];
  const createActivityMutation = useCreateActivity();
  const recordContactOutcome = useRecordLeadContactOutcome();
  const { data: attachments = [], refetch: refetchAttachments, isLoading: attachmentsLoading, isError: attachmentsError, isFetching: attachmentsFetching } = useLeadAttachments(leadId);
  const uploadAttachment = useUploadLeadAttachment({ notifyOnError: false });

  const handleOpenAttachment = (attachment: LeadAttachment) => {
    // The viewer requests access to this item; opening never signs the whole list.
    setSelectedAttachment(attachment);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement> | { target: { files: File[] } }) => {
    const file = e.target.files?.[0];
    if (!canOperateLead || !file || !lead.id) return;

    const operation = captureDetailOperation();
    let receipt: ReturnType<typeof attachmentUploadDraft.begin>;
    try { receipt = attachmentUploadDraft.begin(file); }
    catch (error) { if (operation.isCurrent()) toast.error(getErrorMessage(error)); return; }
    if (!receipt) return;
    try {
      await uploadAttachment.mutateAsync({ leadId: lead.id, file });
      attachmentUploadDraft.acknowledge(receipt);
      void queryClient.invalidateQueries({ queryKey: ['lead-history-v2', lead.id] }).catch(() => { /* Upload is already acknowledged; history can refresh later. */ });
      if (operation.isCurrent()) toast.success('Documento enviado com sucesso!');
    } catch (error: unknown) {
      attachmentUploadDraft.retain(receipt);
      console.error('Erro fatal no upload de documento:', error);
      if (operation.isCurrent()) toast.error(getClientRateLimitMessage(error) || `Erro ao enviar: ${getErrorMessage(error)}`);
    } finally {
      if (operation.isCurrent()) {
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    }
  };

  const handleSelectInterestProperty = async (property: SelectableLeadProperty) => {
    if (!canOperateLead || propertySaveOperationRef.current?.isCurrent()) return;
    try {
      assertLeadFinancialFields({ valor_interesse: property.preco, commission_percentage: property.commission_percentage }, { numbersOnly: true });
    } catch {
      toast.error('O imóvel possui valores financeiros inválidos. Revise os dados do imóvel antes de selecioná-lo.');
      return;
    }
    const operation = captureDetailOperation();
    const previousLead = localLead ? { ...localLead } : lead;
    if (!previousLead.updated_at || (previousLead.organization_id && previousLead.organization_id !== activeOrganization.organizationId)) {
      toast.error('Abra o lead novamente para confirmar sua versão antes de selecionar o imóvel.');
      return;
    }
    propertySaveOperationRef.current = operation;
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

    const optimisticDraftFields = {
      property_id: property.id,
      valor_interesse: nextPropertyPrice !== null ? nextPropertyPrice.toString() : '',
      commission_percentage: nextPropertyCommission !== null ? nextPropertyCommission.toString() : previousEditForm.commission_percentage,
    };
    setEditForm((current) => ({ ...current, ...optimisticDraftFields }));
    setLocalLead((current) => current ? { ...current, ...nextLeadPatch } : current);
    const propertySnapshots = updatePipelineLeadCache(lead.id, nextLeadPatch);

    const timestamp = new Date().toISOString();
    const propertyContent = [propertyCode, propertyTitle].filter(Boolean).join(' - ') || 'Imovel selecionado';
    const optimisticHistoryId = appendOptimisticLeadHistoryEvent(queryClient, lead.id, {
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
      });

    const updateData: Partial<Lead> & { id: string; expectedUpdatedAt: string } = {
      id: lead.id,
      expectedUpdatedAt: previousLead.updated_at,
      property_id: property.id,
      interest_property_id: property.id,
      property_code: propertyCode,
      valor_interesse: nextPropertyPrice,
    };

    if (nextPropertyCommission !== null) {
      updateData.commission_percentage = nextPropertyCommission;
    }

    try {
      const savedLead = await updateLead.mutateAsync(updateData);
      removeOptimisticLeadHistoryEvent(queryClient, lead.id, optimisticHistoryId);
      if (!operation.isCurrent()) return;
      const cachedLead = queryClient.getQueryData<LeadDetailLead>([
        'lead', previousLead.organization_id || activeOrganization.organizationId, previousLead.id,
      ]);
      const canonicalLead = cachedLead ? mergeLeadDetailMutation(cachedLead, savedLead) : savedLead;
      setLocalLead((current) => current ? mergeLeadDetailMutation(current, canonicalLead) : current);
      setEditForm((current) => replaceOwnedPropertyDraft(current, optimisticDraftFields, {
        property_id: canonicalLead.interest_property_id || canonicalLead.property_id || '',
        valor_interesse: canonicalLead.valor_interesse != null ? canonicalLead.valor_interesse.toString() : '',
        commission_percentage: nextPropertyCommission === null ? optimisticDraftFields.commission_percentage
          : canonicalLead.commission_percentage != null ? canonicalLead.commission_percentage.toString() : '',
      }));
      if (requiresWonLeadFinancialReview(previousLead, savedLead)) {
        toast.warning(WON_LEAD_FINANCIAL_REVIEW_MESSAGE);
      }
    } catch {
      removeOptimisticLeadHistoryEvent(queryClient, lead.id, optimisticHistoryId);
      restorePipelineCache(propertySnapshots);
      // Reconcile even after close: a transport error cannot prove rollback.
      void queryClient.invalidateQueries({ queryKey: ['stages-with-leads', previousLead.organization_id || activeOrganization.organizationId] });
      void queryClient.invalidateQueries({ queryKey: ['lead', previousLead.organization_id || activeOrganization.organizationId, lead.id] });
      if (!operation.isCurrent()) return;
      setLocalLead((current) => current ? rollbackLeadPropertySelection(current, previousLead, nextLeadPatch) : current);
      setEditForm((current) => replaceOwnedPropertyDraft(current, optimisticDraftFields, previousEditForm));
    } finally {
      if (propertySaveOperationRef.current === operation) propertySaveOperationRef.current = null;
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
    if (!canOperateLead || quickActionSubmittingRef.current) return false;
    const operation = captureDetailOperation();
    let command: ReturnType<typeof quickActionDraft.getSubmission>;
    try {
      command = quickActionDraft.getSubmission(outcome, notes);
      if (!quickActionDraft.beginSubmission(command)) return false;
    } catch {
      if (operation.isCurrent()) toast.error('Não foi possível preparar o registro. Confira o resultado e as anotações.');
      return false;
    }
    quickActionSubmittingRef.current = true;
    setQuickActionSubmitting(true);
    try {
    const currentLead = localLead || lead;
    try {
      await recordContactOutcome.mutateAsync({ leadId: currentLead.id, ...command });

    } catch (error) {
      if (operation.isCurrent()) toast.error(`Não foi possível registrar a atividade: ${getErrorMessage(error)}`);
      throw error;
    }

    const draftAcknowledged = quickActionDraft.acknowledgeSavedCommand(command);
    if (!operation.isCurrent()) return false;
    const firstResponseParams = {
      leadId: currentLead.id,
      organizationId: currentLead.organization_id || activeOrganization.organizationId || '',
      channel: quickActionOutcomeType === 'call' ? 'phone' : 'email',
      actorUserId: profile?.id || null,
      firstResponseAt: currentLead.first_response_at,
      firstResponseIsAutomation: currentLead.first_response_is_automation,
    } satisfies Parameters<typeof recordFirstResponse>[0];
    try {
      await recordFirstResponse(firstResponseParams);
    } catch {
      if (!operation.isCurrent()) return false;
      toast.warning('Atividade salva, mas o tempo do primeiro contato não foi registrado.', {
        action: {
          label: 'Tentar registro',
          onClick: () => {
            if (!operation.isCurrent()) return;
            void recordFirstResponse(firstResponseParams)
              .then(() => { if (operation.isCurrent()) toast.success('Registro do primeiro contato verificado.'); })
              .catch(() => { if (operation.isCurrent()) toast.error('Não foi possível registrar o tempo do primeiro contato.'); });
          },
        },
      });
    }
    if (!operation.isCurrent()) return false;
    if (!draftAcknowledged) {
      toast.info('O resultado anterior foi confirmado. Suas novas anotações foram mantidas.');
      return false;
    }
    setQuickActionOutcomeOpen(false);
    return true;
    } finally {
      quickActionDraft.endSubmission(command);
      quickActionSubmittingRef.current = false;
      // This instance owns the busy flag even when its access epoch expires.
      // The ref prevents a newer attempt until this finally has completed.
      setQuickActionSubmitting(false);
    }
  };
  const handleEditScheduleEvent = (event: ScheduleEvent) => {
    if (!canViewLeadSchedule) return;
    if (!canManageLeadSchedule) { setReadOnlyScheduleEvent(event); return; }
    setEditingScheduleEvent(event);
    setScheduleFormOpen(true);
  };
  const handleCloseScheduleForm = () => {
    setScheduleFormOpen(false);
    setEditingScheduleEvent(null);
  };
  // A transient access failure hides all portals but retains the unsaved form and its original CAS revision.
  if (!leadProp || !localLead || readAccessBlocked) return null;

  const currentStageIndex = stages.findIndex(s => s.id === localLead.stage_id);
  const stageStepperStyle = getStageStepperStyle(stages.length);
  const assigneeName = localLead.assignee?.name || '';
  const leadTags = Array.isArray(localLead.tags) ? localLead.tags.filter(hasTagId) : [];
  const safeAllTags = Array.isArray(allTags) ? allTags.filter(Boolean) : [];
  const safeAllUsers = Array.isArray(allUsers) ? allUsers.filter(Boolean) : [];
  const canTransferLead = canOperateLead;
  const canUnassignLead = canOperateLead;
  const assigneeCatalogBlocked = Boolean(allUsersState?.loading || allUsersState?.error);
  const assignableUsers = canTransferLead ? safeAllUsers : [];
  const leadTagIds = leadTags.map((tag) => tag.id);
  const availableTags = safeAllTags.filter(t => !leadTagIds.includes(t.id));
  const isTagMutationPending = addTag.isPending || removeTag.isPending;

  const handleAddTag = async (tagId: string, catalogTag?: TagCatalog) => {
    if (!canOperateLead || isTagMutationPending) return;
    if (catalogTag && (catalogTag.id !== tagId || catalogTag.organization_id !== activeOrganization.organizationId)) return;
    const tagToAdd = catalogTag || safeAllTags.find(t => t.id === tagId);
    if (!tagToAdd || !localLead) return;

    const operation = captureDetailOperation();
    const receipt = tagOptimism.begin(localLead, tagToAdd, 'add', operation);
    if (!receipt) return;
    updatePipelineLeadCache(localLead.id, { tags: tagOptimism.project(localLead, receipt).tags });

    setTagPopoverOpen(false);
    tagOptimism.apply(receipt);

    try {
      await addTag.mutateAsync({
        leadId: lead.id,
        tagId
      });
      tagOptimism.complete(receipt);
    } catch (error) {
      tagOptimism.reject(receipt, error);
    }
  };

  const handleRemoveTag = async (tagId: string) => {
    if (!canOperateLead || !localLead || isTagMutationPending) return;

    const operation = captureDetailOperation();
    const receipt = tagOptimism.begin(localLead, leadTags.find(tag => tag.id === tagId) || { id: tagId }, 'remove', operation);
    if (!receipt) return;
    updatePipelineLeadCache(localLead.id, { tags: tagOptimism.project(localLead, receipt).tags });

    tagOptimism.apply(receipt);

    try {
      await removeTag.mutateAsync({
        leadId: lead.id,
        tagId
      });
      tagOptimism.complete(receipt);
    } catch (error) {
      tagOptimism.reject(receipt, error);
    }
  };

  const loadAssigneeAvailability = (teamMemberId: string) => {
    const teamMemberIds = [teamMemberId];
    const organizationId = lead.organization_id || activeOrganization.organizationId;

    return queryClient.fetchQuery({
      queryKey: ['lead-assignee-availability', organizationId, teamMemberIds],
      queryFn: ({ signal }) => teamsAPI.listMemberAvailability({ teamMemberIds, organizationId, signal }),
      staleTime: 60_000,
    });
  };

  const handleAssigneePopoverChange = (open: boolean) => {
    setAssigneePopoverOpen(open);
  };

  const handleAssignUser = async (
    userId: string | null,
    options?: { skipScheduleConfirmation?: boolean; selection?: LeadAssigneeSelection },
  ) => {
    if (isUpdatingAssignee || assigneeUpdatingRef.current) return;
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
    let selection = options?.selection || null;
    if (!selection && localLead.updated_at) {
      try {
        const requestOperation = requestScope.capture();
        selection = { leadId: lead.id, userId, expectedUpdatedAt: localLead.updated_at,
          operation: captureDetailOperation(), requestOperation };
      } catch { return; }
    }
    if (!selection) {
      toast.error('Atualize este lead antes de trocar o responsável.');
      void fullLeadQuery.refetch();
      return;
    }
    if (selection.leadId !== lead.id || selection.userId !== userId || !selection.operation.isCurrent() ||
      !selection.requestOperation.isCurrent() || selection.requestOperation.organizationId !== (lead.organization_id || activeOrganization.organizationId)) return;

    if ((localLead.assigned_user_id || null) === userId) {
      setAssigneePopoverOpen(false);
      return;
    }

    const { operation, requestOperation, expectedUpdatedAt } = selection;
    const mutationOperation = { isCurrent: () => operation.isCurrent() && requestOperation.isCurrent() };
    const selectedUser = userId ? assignableUsers.find(u => u.id === userId) : null;
    const optimisticLead: LeadDetailLead = mergeLeadOperationCapability(localLead, {
      ...localLead, assigned_user_id: userId,
      assignee: selectedUser ? { id: selectedUser.id, name: selectedUser.name, email: selectedUser.email, avatar_url: selectedUser.avatar_url } : undefined,
      can_operate: undefined,
    });
    const receipt = fieldOptimism.begin(localLead, { assigned_user_id: optimisticLead.assigned_user_id,
      assignee: optimisticLead.assignee, can_operate: optimisticLead.can_operate }, mutationOperation, expectedUpdatedAt);
    if (!receipt) return;
    assigneeUpdatingRef.current = true;
    setIsUpdatingAssignee(true);
    setAssigneePopoverOpen(false);

    let pipelineSnapshots: Array<[QueryKey, unknown]> = [];

    try {
      if (userId) {
        const teamMember = teams
          .flatMap((team) => team.members || [])
          .find((member) => member.user_id === userId);

        if (teamMember) {
          const availabilityList = await loadAssigneeAvailability(teamMember.id);
          if (!mutationOperation.isCurrent()) return;
          const scheduleAvailability = getLeadAssigneeAvailability(availabilityList, teamMember.id, new Date());
          const availability = scheduleAvailability.today;

          if (availability) {
            const isOutsideSchedule = !scheduleAvailability.available;

            if (isOutsideSchedule && !options?.skipScheduleConfirmation) {
              const startTime = availability.start_time || '00:00:00';
              const endTime = availability.end_time || '23:59:59';
              assigneeSelectionRef.current = selection;
              setAssigneeScheduleConfirmation({
                leadId: lead.id,
                userId,
                userName: selectedUser?.name || selectedUser?.email || 'Este usuário',
                description: `A escala de hoje é das ${startTime.slice(0, 5)} às ${endTime.slice(0, 5)} (${scheduleAvailability.timeZone}).`,
              });
              return;
            }
          } else if (!scheduleAvailability.available && !options?.skipScheduleConfirmation) {
            assigneeSelectionRef.current = selection;
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

      fieldOptimism.apply(receipt);
      if (fieldOptimism.isCurrent(receipt)) pipelineSnapshots = updatePipelineAssigneeCache(optimisticLead);

      const organizationId = requestOperation.organizationId;
      // Preserve the ACK of an already dispatched write when the popup closes.
      const writeIntent = { ...requestOperation.intent, signal: undefined, onRequestStart: () => {
        if (!mutationOperation.isCurrent()) throw new DOMException('A seleção do lead mudou.', 'AbortError');
      } };
      const { data, error } = await leadsAPI.assignLead(lead.id, userId, organizationId, writeIntent, expectedUpdatedAt);
      if (error) throw error;
      if (!requestOperation.canReconcileCapturedAccess()) {
        fieldOptimism.reject(receipt, new DOMException('O acesso foi encerrado.', 'AbortError'));
        return;
      }
      if (!data || data.id !== lead.id || (data.organization_id && data.organization_id !== organizationId)) {
        throw new VimobAPIError('Não foi possível confirmar a atualização do lead.', { status: 502, code: 'lead_write_unconfirmed' });
      }
      fieldOptimism.complete(receipt);

      const serverLead = data as LeadDetailLead;
      const persistedLead = mergeLeadDetailMutation(optimisticLead, serverLead);
      if (organizationId) {
        queryClient.setQueryData<Lead>(['lead', organizationId, lead.id], (current) => mergeLeadServerResponse(current, data));
      }
      updatePipelineLeadCache(lead.id, persistedLead);
      void queryClient.invalidateQueries({ queryKey: ['lead-history-v2', lead.id] });
      refreshPipelineInBackground(organizationId, lead.id, 'lead.assigned');

      if (!mutationOperation.isCurrent()) return;
      const latest = queryClient.getQueryData<Lead>(['lead', organizationId, lead.id]) || persistedLead;
      setLocalLead((current) => current?.id === lead.id ? mergeLeadDetailMutation(current, latest as LeadDetailLead) : current);
      void fullLeadQuery.refetch();

      toast.success(userId
        ? `Lead transferido para ${selectedUser?.name || selectedUser?.email || 'o novo responsável'}`
        : 'Responsável removido do lead');
    } catch (error: unknown) {
      if (isDefiniteLeadFieldRejection(error) && fieldOptimism.isCurrent(receipt)) restorePipelineCache(pipelineSnapshots);
      fieldOptimism.reject(receipt, error);
      if (!mutationOperation.isCurrent()) {
        if (requestOperation.canReconcileCapturedAccess()) {
          void queryClient.invalidateQueries({ queryKey: ['lead', requestOperation.organizationId, lead.id], exact: true, refetchType: 'active' });
          void queryClient.invalidateQueries({ queryKey: ['stages-with-leads', requestOperation.organizationId], refetchType: 'active' });
        }
        return;
      }
      if (error instanceof VimobAPIError && error.code === 'lead_changed') {
        setAssigneePopoverOpen(true);
        toast.error('Este lead foi atualizado em outra sessão. Confira o responsável atual e selecione novamente.');
      } else toast.error(`Não foi possível transferir o lead: ${getErrorMessage(error)}`);
    } finally {
      fieldOptimism.discard(receipt);
      assigneeUpdatingRef.current = false;
      setIsUpdatingAssignee(false);
    }
  };
  const handleConfirmAssignee = (confirmation: AssigneeScheduleConfirmation) => {
    const selection = assigneeSelectionRef.current;
    assigneeSelectionRef.current = null;
    setAssigneeScheduleConfirmation(null);
    if (!selection || selection.leadId !== confirmation.leadId || selection.userId !== confirmation.userId ||
      !selection.operation.isCurrent() || !selection.requestOperation.isCurrent()) {
      toast.error('Esta seleção expirou. Escolha o responsável novamente.');
      return;
    }
    void handleAssignUser(confirmation.userId, { skipScheduleConfirmation: true, selection });
  };
  const handleToggleCadenceTask = async (
    task: LeadCadenceTaskState,
    outcome = 'done',
    outcomeNotes = '',
  ) => {
    if (!canOperateLead || cadenceActionPendingRef.current) return false;
    let operation: ReturnType<typeof captureCadenceFeedbackOperation>;
    try {
      operation = captureCadenceFeedbackOperation();
    } catch {
      return false;
    }
    cadenceActionPendingRef.current = true;
    setCadenceActionPending(true);
    try {
    const completedTask = await completeCadenceTask.mutateAsync({
      leadId: lead.id,
      taskId: task.id,
      templateTaskId: task.template_task_id || undefined,
      outcome,
      outcomeNotes,
      organizationId: cadenceOrganizationId,
    });
    if (!operation.isCurrent()) return false;
    if (completedTask.id !== task.id || completedTask.lead_id !== lead.id || completedTask.is_done !== true ||
      completedTask.outcome !== outcome || (completedTask.outcome_notes || '').trim() !== outcomeNotes.trim()) {
      toast.warning('Não foi possível confirmar este resultado. A tarefa pode ter sido concluída em outra janela; suas anotações foram mantidas.');
      return false;
    }
    const firstContactChannel = task.type === 'call'
      ? 'phone'
      : task.type === 'email'
        ? 'email'
        : null;
    if (firstContactChannel) {
      const firstResponseParams = {
        leadId: lead.id,
        organizationId: lead.organization_id || activeOrganization.organizationId || '',
        channel: firstContactChannel,
        actorUserId: profile?.id || null,
        firstResponseAt: lead.first_response_at,
        firstResponseIsAutomation: lead.first_response_is_automation,
      } satisfies Parameters<typeof recordFirstResponse>[0];
      try {
        await recordFirstResponse(firstResponseParams);
      } catch {
        if (!operation.isCurrent()) return false;
        toast.warning('Tarefa concluída, mas o tempo do primeiro contato não foi registrado.', {
          action: {
            label: 'Tentar registro',
            onClick: () => {
              if (!operation.isCurrent()) return;
              void recordFirstResponse(firstResponseParams)
                .then(() => { if (operation.isCurrent()) toast.success('Registro do primeiro contato verificado.'); })
                .catch(() => { if (operation.isCurrent()) toast.error('Não foi possível registrar o tempo do primeiro contato.'); });
            },
          },
        });
      }
    }
    return operation.isCurrent();
    } catch (error) {
      if (!operation.isCurrent()) return false;
      throw error;
    } finally {
      cadenceActionPendingRef.current = false;
      setCadenceActionPending(false);
    }
  };

  // Handle outcome dialog confirmation
  const handleOutcomeConfirm = async (outcome: TaskOutcome, notes: string) => {
    if (!canOperateLead) return false;
    if (!taskForOutcome) return false;
    if (!await handleToggleCadenceTask(taskForOutcome, outcome, notes)) return false;
    outcomeDraft.updateDraft({ outcome: '', notes: '' });
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
    return true;
  };

  const handleCadenceTaskClick = (task: LeadCadenceTaskState) => {
    if (!canOperateLead || cadenceActionPendingRef.current) return;
    try { captureCadenceFeedbackOperation(); } catch { return; }
    const taskType = getCadenceTaskType(task.type);
    const isDone = task.is_done || task.status === 'completed';

    // Se já está feito, não faz nada (evitar toggle reverso sem querer)
    if (isDone || task.status !== 'pending' || leadCadenceState?.deal_status !== 'open') return;
    setTaskInspectOnly(false);

    // Preparar a mensagem e registrar seu resultado são ações independentes.
    if (task.observation || (taskType === 'message' && task.recommended_message)) {
      setSelectedTask(task);
      setRoteiroDialogOpen(true);
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
    if (!canOperateLead || taskInspectOnly || cadenceActionPendingRef.current) return;
    const currentTask = leadCadenceState?.tasks.find((task) => task.id === selectedTask?.id);
    if (!selectedTask || !currentTask || leadCadenceState?.lead_id !== lead.id ||
      leadCadenceState.deal_status !== 'open' || currentTask.is_done || currentTask.status !== 'pending') return;
    try { captureCadenceFeedbackOperation(); } catch { return; }
    if (action === 'message') {
      if (!currentTask.recommended_message) return;
      let canOpenCapturedAccess: () => boolean;
      try { canOpenCapturedAccess = requestScope.capture().canReconcileCapturedAccess; } catch { return; }
      const message = currentTask.recommended_message.replace(/{nome}/gi, lead.name || '').replace(/{empresa}/gi, lead.empresa || '').replace(/{email}/gi, lead.email || '');
      if (openLeadWhatsApp(message, canOpenCapturedAccess)) {
        setRoteiroDialogOpen(false);
        setSelectedTask(null);
      }
      return;
    }

    // Após o roteiro, respeitar a regra configurada pelo gestor.
    const selectedTaskType = getCadenceTaskType(currentTask.type);
    if (currentTask.outcome_required && OUTCOME_CADENCE_TASK_TYPES.includes(selectedTaskType)) {
      setTaskForOutcome(currentTask);
      setOutcomeDialogOpen(true);
      setRoteiroDialogOpen(false);
      setSelectedTask(null);
      return;
    }

    try {
      if (!await handleToggleCadenceTask(currentTask)) return;
      setRoteiroDialogOpen(false);
      setSelectedTask(null);
    } catch {
      // The mutation reports the error; keep the script open so the task can be retried.
    }
  };
  // Keep the original selection across the reason dialog; extract stage actions into lead-detail after this CAS fix.
  const captureStageMove = (stageId: string): LeadStageMoveIntent | null => {
    const revision = capturePipelineMoveRevision(localLead, localLead.stage_id ?? null);
    if (!revision) {
      toast.error('Atualize este lead antes de mudar de etapa.');
      void queryClient.invalidateQueries({ queryKey: ['lead', lead.organization_id || activeOrganization.organizationId, lead.id] });
      return null;
    }
    try {
      const requestOperation = requestScope.capture();
      if (requestOperation.organizationId !== (lead.organization_id || activeOrganization.organizationId)) return null;
      return { stageId, revision, operation: captureDetailOperation(), requestOperation };
    } catch { return null; }
  };

  const persistMoveToStage = async (move: LeadStageMoveIntent, lostReason?: string) => {
    const { stageId, revision, operation, requestOperation } = move;
    const mutationOperation = { isCurrent: () => operation.isCurrent() && requestOperation.isCurrent() };
    if (!mutationOperation.isCurrent() || !canOperateLead || stageId === localLead.stage_id || stageMovePendingRef.current || statusSubmittingRef.current) return false;

    const stage = stages.find(s => s.id === stageId);
    const submittedLead = localLead;
    let receipt: ReturnType<typeof fieldOptimism.begin> = null;
    stageMovePendingRef.current = true;
    setStageMovePending(true);

    try {
      const organizationId = requestOperation.organizationId;
      const guardedIntent = { ...requestOperation.intent, onRequestStart: () => {
        if (!mutationOperation.isCurrent()) throw new DOMException('A seleção do lead mudou.', 'AbortError');
      } };
      const preparation = { organizationId, intent: guardedIntent, isCurrent: mutationOperation.isCurrent };
      const moveStageContract = moveContract.getCurrent(preparation) ?? await moveContract.ensureCompatible(preparation);
      if (!mutationOperation.isCurrent()) return false;
      const latestRead = queryClient.getQueryData<Lead>(['lead', organizationId, lead.id]);
      if (latestRead?.can_operate === false) return false;
      receipt = fieldOptimism.begin(localLead, { stage_id: stageId, stage }, mutationOperation, revision.expectedUpdatedAt);
      if (!receipt) return false;
      fieldOptimism.apply(receipt);
      const { data: updatedLead, error } = await leadsAPI.moveLeadStage(lead.id, {
        stageId,
        expectedStageId: revision.sourceStageId,
        expectedUpdatedAt: revision.expectedUpdatedAt,
        lostReason,
      }, organizationId, { ...guardedIntent, signal: undefined }, moveStageContract);
      if (error) throw error;
      if (!requestOperation.canReconcileCapturedAccess()) {
        fieldOptimism.reject(receipt, new DOMException('O acesso foi encerrado.', 'AbortError'));
        return false;
      }
      if (!updatedLead || updatedLead.id !== lead.id || (updatedLead.organization_id && updatedLead.organization_id !== organizationId)) {
        throw new VimobAPIError('Não foi possível confirmar a atualização do lead.', { status: 502, code: 'lead_write_unconfirmed' });
      }
      fieldOptimism.complete(receipt);

      if (organizationId) {
        queryClient.setQueryData<Lead>(['lead', organizationId, lead.id], (current) => mergeLeadServerResponse(current, updatedLead));
      }
      updatePipelineLeadCache(lead.id, updatedLead);
      void queryClient.invalidateQueries({ queryKey: ['lead-history-v2', lead.id] });
      void queryClient.invalidateQueries({ queryKey: ['lead-cadence-state'] });
      refreshPipelineInBackground(organizationId, lead.id, 'lead.stage_moved');

      if (!mutationOperation.isCurrent()) return false;
      const latest = queryClient.getQueryData<Lead>(['lead', organizationId, lead.id]) || updatedLead;
      setLocalLead((current) => current?.id === lead.id ? mergeLeadDetailMutation(current, latest as LeadDetailLead) : current);

      const financialReview = getLeadStatusFinancialReviewMessage(submittedLead, updatedLead);
      if (financialReview) toast.warning(financialReview);
      else toast.success('Lead movido!');
      return true;
    } catch (error: unknown) {
      if (receipt) fieldOptimism.reject(receipt, error);
      if (!mutationOperation.isCurrent()) {
        if (requestOperation.canReconcileCapturedAccess()) {
          void queryClient.invalidateQueries({ queryKey: ['lead', requestOperation.organizationId, lead.id], exact: true, refetchType: 'active' });
          void queryClient.invalidateQueries({ queryKey: ['stages-with-leads', requestOperation.organizationId], refetchType: 'active' });
        }
        return false;
      }
      if (error instanceof VimobAPIError && ['lead_stage_changed', 'lead_changed'].includes(error.code || '')) {
        void queryClient.invalidateQueries({ queryKey: ['stages-with-leads', activeOrganization.organizationId] });
        void queryClient.invalidateQueries({ queryKey: ['lead', activeOrganization.organizationId, lead.id] });
        handleCloseLeadDetail();
        setPendingLostStageMove(null);
        setLostReasonDialogOpen(false);
        toast.error('Este lead foi atualizado em outra sessão. Abra novamente e confira os dados antes de mover.');
        return false;
      }
      if (
        !lostReason &&
        error instanceof VimobAPIError &&
        error.code === 'lead_lost_reason_required'
      ) {
        setPendingLostStageMove(move);
        setLostReasonDialogOpen(true);
      } else {
        toast.error(`Não foi possível mover o lead: ${getErrorMessage(error)}`);
      }
      return false;
    } finally {
      if (receipt) fieldOptimism.discard(receipt);
      stageMovePendingRef.current = false;
      setStageMovePending(false);
    }
  };

  const handleMoveToStage = async (stageId: string) => {
    if (!canOperateLead || stageId === localLead.stage_id) return;
    if (!statusConfirmation.restart()) return;
    const move = captureStageMove(stageId);
    if (!move) return;
    const stage = stages.find((item) => item.id === stageId);
    if (getPipelineStageOutcome(stage, stageAutomations) === 'lost') {
      setPendingLostStageMove(move);
      setLostReasonDialogOpen(true);
      return;
    }

    await persistMoveToStage(move);
  };

  // Centralized handler for deal status changes
  const handleDealStatusChange = async (
    newStatus: string,
    options?: { confirmation?: ReopenStatusConfirmation },
  ) => {
    if (!canOperateLead || statusSubmittingRef.current || dealStatusChange.isPending || stageMovePending) return;
    const previousStatus = options?.confirmation?.fromStatus || localLead?.deal_status || 'open';
    if (newStatus === previousStatus) return;

    // Intercept "lost" -> ask for reason via dialog
    if (newStatus === 'lost') {
      if (!statusConfirmation.begin('lost')) return;
      setReopenStatusConfirmation(null);
      setPendingLostStageMove(null);
      setLostReasonDialogOpen(true);
      return;
    }

    if (newStatus === 'open' && previousStatus !== 'open' && !options?.confirmation) {
      const intent = statusConfirmation.begin('open');
      if (!intent) return;
      setReopenStatusConfirmation({
        leadId: lead.id,
        leadName: localLead?.name || lead.name || 'Lead',
        fromStatus: previousStatus,
        intent,
      });
      return;
    }

    const confirmation = options?.confirmation
      ? statusConfirmation.resolve('open', options.confirmation.intent) : null;
    if (options?.confirmation && !confirmation) {
      toast.error('Esta confirmação expirou. Confira o lead e selecione o status novamente.');
      return;
    }
    if (!confirmation) statusConfirmation.clear();
    const currentLead = confirmation?.authorizedLead || localLead || lead;

    statusSubmittingRef.current = true;
    const operation = confirmation?.operation || captureDetailOperation();
    try {
      const currentInterestPropertyId =
        confirmation ? currentLead.interest_property_id || currentLead.property_id || null :
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
        authorizedLead: confirmation?.authorizedLead || fullLeadQuery.data || undefined,
        expectedUpdatedAt: confirmation?.expectedUpdatedAt || fullLeadQuery.data?.updated_at || undefined,
      });
      if (!operation.isCurrent()) return;
      if (confirmation) statusConfirmation.clear(confirmation);
      setReopenStatusConfirmation(null);
      const updatedLead = queryClient.getQueryData<Lead>(['lead', currentLead.organization_id || activeOrganization.organizationId, lead.id]) || result.lead;
      setLocalLead((current) => current?.id === lead.id
        ? mergeLeadDetailMutation(current, updatedLead as LeadDetailLead) : current);
      void queryClient.invalidateQueries({ queryKey: ['lead-cadence-state'] });
    } catch {
      // The hook restores only its own patch or reconciles an uncertain result.
    } finally {
      statusSubmittingRef.current = false;
    }
  };

  // Confirm lost with reason from dialog
  const handleConfirmLostReason = async (reason: string) => {
    if (!canOperateLead || statusSubmittingRef.current || dealStatusChange.isPending || stageMovePending) return;
    if (!statusConfirmation.isCurrent()) return;
    if (pendingLostStageMove) {
      const moved = await persistMoveToStage(pendingLostStageMove, reason);
      if (moved) {
        statusConfirmation.clear();
        setLostReasonLocal(reason);
        setPendingLostStageMove(null);
        setLostReasonDialogOpen(false);
      }
      return;
    }

    const confirmation = statusConfirmation.resolve('lost');
    if (!confirmation) {
      toast.error('Esta confirmação expirou. Confira o lead e selecione Perdido novamente.');
      return;
    }
    const currentLead = confirmation.authorizedLead;
    statusSubmittingRef.current = true;
    const operation = confirmation.operation;
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
        authorizedLead: confirmation.authorizedLead,
        expectedUpdatedAt: confirmation.expectedUpdatedAt,
      });
      if (!operation.isCurrent()) return;
      statusConfirmation.clear(confirmation);
      setLostReasonLocal(reason);
      setLostReasonDialogOpen(false);
      const updatedLead = queryClient.getQueryData<Lead>(['lead', currentLead.organization_id || activeOrganization.organizationId, lead.id]) || result.lead;
      setLocalLead((current) => current?.id === lead.id
        ? mergeLeadDetailMutation(current, updatedLead as LeadDetailLead) : current);
      void queryClient.invalidateQueries({ queryKey: ['lead-cadence-state'] });
    } catch {
      // Cache reconciliation belongs to the mutation hook, including after close.
    } finally {
      statusSubmittingRef.current = false;
    }
  };

  const leadSource = localLead?.source ?? lead.source ?? 'outros';
  const leadName = normalizeDisplayName(localLead?.name || lead.name, 'Lead');
  const canOpenLeadWhatsApp = !poolReadOnly && canViewLeadWhatsApp;
  const campaignTrackingDetails = buildCampaignTrackingDetails(leadMeta ?? null, localLead || lead);
  const firstResponse = resolvedFirstResponse(localLead, leadHistoryQuery.data);
  const firstResponseLabel = firstResponse
    ? `${typeof firstResponse.seconds === 'number' && firstResponse.seconds >= 0 ? formatResponseTime(firstResponse.seconds) : 'Tempo indisponível'}${firstResponse.isAutomation ? ' · automático' : ''}${firstResponse.fromHistory ? ' · histórico' : ''}`
    : leadHistoryQuery.isPending && !localLead.first_response_at
      ? 'Carregando...'
      : leadHistoryQuery.isError && !localLead.first_response_at
        ? 'Indisponível'
        : leadHistoryQuery.historyComplete === false ? 'Histórico parcial' : 'Não registrado';
  const renderScheduleEvents = () => (
    <>
      {scheduleError && (
        <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 rounded-[6px] bg-[var(--app-surface-solid)] px-2.5 py-2 text-[11px] text-[var(--app-text-secondary)]">
          <span>{scheduleEvents.length > 0 ? 'Não foi possível atualizar a agenda.' : 'Não foi possível carregar a agenda.'}</span>
          <Button type="button" variant="ghost" size="sm" className={cn('h-7 rounded-[5px] px-2 text-[11px]', (isMobile || isTablet) && 'h-10')} onClick={() => void refetchScheduleEvents()}>
            Tentar novamente
          </Button>
        </div>
      )}
      {schedulePending && scheduleEvents.length === 0 ? (
        <p role="status" className="mt-2 text-[11px] text-[var(--app-text-tertiary)]">Carregando compromissos...</p>
      ) : (scheduleEvents.length > 0 || !scheduleError) && (
        <CompactScheduleEventsList
          events={scheduleEvents}
          locale={dateLocale}
          onEditEvent={canViewLeadSchedule ? handleEditScheduleEvent : undefined}
        />
      )}
      {schedulePreview.hasNextPage && (
        <Button type="button" variant="ghost" className="mt-2 h-9 text-xs" disabled={schedulePreview.isFetchingNextPage} onClick={() => void schedulePreview.fetchNextPage()}>
          {schedulePreview.isFetchingNextPage ? 'Carregando...' : 'Ver mais compromissos'}
        </Button>
      )}
    </>
  );

  const MobileContentV2 = () => {
    const leadAvatarUrl = localLead.whatsapp_picture || localLead.whatsapp_avatar_url || localLead.contact_picture || null;
    const dealStatusLabel = localLead.deal_status === 'won' ? 'Ganho' : localLead.deal_status === 'lost' ? 'Perdido' : 'Aberto';
    const mobileActiveTab = ['summary', 'actions', 'history'].includes(activeTab) ? activeTab : 'summary';
    const contactRows: Array<{ label: string; value: ReactNode }> = [
      { label: 'Nome', value: <LeadProfileHover lead={localLead} canRevealSensitive={canOperateLead} variant={variant === 'pipeline' ? 'pipeline' : 'default'} /> },
      { label: 'Telefone', value: formatPhoneForDisplay(localLead.phone || '') },
      { label: 'Origem', value: getLeadSourceLabel(leadSource) },
      { label: 'Primeiro contato', value: firstResponseLabel },
      {
        label: 'Campanha',
        value: campaignTrackingDetails || leadMetaQuery.isPending || leadMetaQuery.isError ? <CampaignTrackingHover leadMeta={campaignTrackingDetails} variant={variant === 'pipeline' ? 'pipeline' : 'default'} loading={leadMetaQuery.isPending} error={leadMetaQuery.isError} onRetry={() => void leadMetaQuery.refetch()} /> : null
      },
    ]
      .filter((row) => Boolean(row.value));

    const mobileTabs = [
      { id: 'summary', label: 'Resumo', icon: Contact },
      { id: 'actions', label: 'Ações', icon: Activity, badge: scheduleEvents.length ? String(scheduleEvents.length) : undefined },
      { id: 'history', label: 'Histórico', icon: MessageCircle },
    ];
    // The shared primary-action rule fixes height at 2rem; keep mobile hit areas at 40px.
    const mobilePrimaryActionStyle = { height: '2.5rem' };
    const isCompactPipelineHeader = variant === 'pipeline' && isMobile;

    const headerStages = (
      <div
        data-lead-stage-stepper
        className="lead-detail-v2-scroll flex min-w-0 flex-1 items-center overflow-x-auto pb-0.5"
        style={{ ...stageStepperStyle, '--lead-stage-step-size': '2.5rem' } as CSSProperties}
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
                'lead-stage-step relative flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px] text-[11px] font-normal',
                isActive
                  ? (variant === 'pipeline' ? 'bg-primary/50 text-white' : 'bg-primary text-primary-foreground')
                  : isPast
                    ? (variant === 'pipeline' ? 'bg-primary/50 text-white' : 'bg-primary/10 text-primary')
                    : 'bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]',
              )}
            >
              {idx + 1}
            </button>
          );
        })}
      </div>
    );

    const headerCloseAction = (
      <button type="button" aria-label="Fechar detalhes do lead" title="Fechar" onClick={handleCloseLeadDetail} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)] transition-colors hover:bg-[var(--app-surface-hover)] focus-visible:ring-1 focus-visible:ring-primary/30">
        <X className="h-4 w-4" />
      </button>
    );

    const headerTags = (
      <div className={cn('flex flex-wrap gap-1.5', variant !== 'pipeline' && 'mt-1.5')}>
        {(variant === 'pipeline' ? leadTags : leadTags.slice(0, 4)).map((tag) => {
          const tagColor = tag.color?.trim() || null;
          return (
            <Badge
              key={tag.id}
              className={cn(
                'flex h-5 items-center gap-1 rounded-[4px] border-0 px-1.5 text-[10px] font-light',
                'text-white', variant === 'pipeline' && pipelineDetailStyles.tag,
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
        {variant !== 'pipeline' && leadTags.length > 4 && (
          <Badge variant="secondary" className="h-5 rounded-[4px] border-0 px-1.5 text-[10px]">
            +{leadTags.length - 4}
          </Badge>
        )}
        <Popover open={tagPopoverOpen} onOpenChange={(open) => (!open || (canOperateLead && !isTagMutationPending)) && setTagPopoverOpen(open)}>
          <PopoverTrigger asChild>
            <Button disabled={!canOperateLead || isTagMutationPending} variant="ghost" size="sm" className="h-5 rounded-[5px] border-0 bg-[var(--app-surface-soft)] px-1.5 text-[10px] disabled:hidden">
              <Plus className="mr-1 h-3 w-3" />
              Tag
            </Button>
          </PopoverTrigger>
          <PopoverContent className={cn('w-64 p-0', variant === 'pipeline' && pipelineDetailStyles.portal)} align="start">
            {variant === 'pipeline' ? (
              <LeadTagPickerContent leadId={localLead.id} assignedTagIds={leadTagIds} disabled={!canOperateLead || isTagMutationPending} enabled={tagPopoverOpen} onAddTag={tag => handleAddTag(tag.id, tag)} onClose={() => setTagPopoverOpen(false)} />
            ) : <TagSelectorPopoverContent availableTags={availableTags} onAddTag={handleAddTag} onClose={() => setTagPopoverOpen(false)} />}
          </PopoverContent>
        </Popover>
      </div>
    );

    const headerIdentity = (
      <div className={cn('flex items-start gap-2.5', variant === 'pipeline' && 'relative min-h-10 pr-11')}>
        <Avatar className="h-10 w-10 shrink-0 border-0">
          <AvatarImage src={leadAvatarUrl || undefined} alt={leadName} />
          <AvatarFallback className={cn('text-[12px] font-light', variant === 'pipeline' ? 'bg-primary/50 text-white' : 'bg-primary/12 text-primary')}>
            {getDisplayInitial(leadName) || <User className="h-5 w-5" />}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-[14px] font-normal leading-tight">{leadName}</h2>
            <ReentryBadge count={lead.reentry_count} lastEntryAt={lead.last_entry_at} />
            <QueuePoolClaimButton lead={localLead} compact disabled={fullLeadQuery.isFetching || readAccessPending} />
          </div>
          {localLead.phone && (
            <div className="mt-1 flex min-w-0 items-center gap-1.5">
              <p className="truncate text-xs text-[var(--app-text-tertiary)]">{formatPhoneForDisplay(localLead.phone)}</p>
              <CopyLeadPhoneButton phone={localLead.phone} className={cn('h-10 w-10 bg-transparent hover:bg-[var(--app-surface-soft)]', variant === 'pipeline' && 'absolute right-0 top-0')} />
            </div>
          )}
          {variant === 'pipeline' && !localLead.phone && localLead.email && <p className="mt-1 truncate text-xs text-[var(--app-text-tertiary)]">{localLead.email}</p>}

          {variant !== 'pipeline' && headerTags}
        </div>
      </div>
    );

    const headerAssignee = (
      <Popover open={assigneePopoverOpen} onOpenChange={handleAssigneePopoverChange}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            aria-label="Alterar responsável pelo lead"
             className="h-10 min-w-0 justify-start rounded-[6px] bg-[var(--app-surface-soft)] px-2.5 text-xs font-light text-[var(--app-text-secondary)]"
            disabled={!canTransferLead}
            onClick={(event) => event.stopPropagation()}
          >
            <User className="mr-1.5 h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{assigneeName || 'Sem responsável'}</span>
            {isUpdatingAssignee ? <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin" /> : <ChevronDown className="ml-auto h-3.5 w-3.5" />}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className={cn('app-header-popover w-[calc(100vw-2rem)] max-w-[380px] overflow-hidden border-0 bg-[var(--app-surface-solid)] p-1', variant === 'pipeline' && pipelineDetailStyles.portal)}
          align="start"
          collisionPadding={12}
          onWheelCapture={(event) => event.stopPropagation()}
          onTouchMoveCapture={(event) => event.stopPropagation()}
        >
          <Command filter={commandSearchFilter} className={cn("max-h-[min(72vh,430px)] border-none bg-transparent [&_[cmdk-input-wrapper]]:border-b-0 [&_[cmdk-input-wrapper]]:px-2", variant === 'pipeline' && pipelineDetailStyles.assigneeSearch)}>
            <CommandInput aria-label="Buscar responsável" placeholder="Buscar responsável..." className="h-10 border-none focus:ring-0" />
            <CommandList
              className="max-h-[min(58vh,340px)] overflow-y-auto overscroll-contain p-1 touch-pan-y scrollbar-thin [-webkit-overflow-scrolling:touch]"
              onWheelCapture={(event) => event.stopPropagation()}
              onTouchMoveCapture={(event) => event.stopPropagation()}
            >
              <LeadAssigneeCatalogNotice state={allUsersState} />
              {!assigneeCatalogBlocked && <CommandEmpty className="py-4 text-center text-sm text-muted-foreground">Nenhum encontrado.</CommandEmpty>}
              {!assigneeCatalogBlocked && <CommandGroup>
                <CommandItem onSelect={() => handleAssignUser(null)} className="min-h-10 cursor-pointer rounded-[6px] px-3 py-2">
                  Sem responsável
                </CommandItem>
                {assignableUsers.map((user) => (
                  <CommandItem key={user.id} onSelect={() => handleAssignUser(user.id)} className="min-h-10 cursor-pointer rounded-[6px] px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Avatar className="h-7 w-7">
                        <AvatarImage src={user.avatar_url || undefined} alt={user.name || user.email || 'Responsável'} />
                        <AvatarFallback className="text-[10px]">{(user.name || user.email || 'U')[0]}</AvatarFallback>
                      </Avatar>
                      <span className="truncate">{user.name || user.email}</span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    );

    const headerStatus = (
      <Select value={localLead.deal_status || 'open'} onValueChange={handleDealStatusChange} disabled={!canOperateLead || dealStatusChange.isPending || stageMovePending}>
        <SelectTrigger className={cn('h-10 w-[92px] gap-1 rounded-[6px] px-2 text-xs font-light', getDealStatusTriggerClass(localLead.deal_status))}>
          <SelectValue>{dealStatusLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent className={variant === 'pipeline' ? pipelineDetailStyles.portal : undefined}>
          <SelectItem value="open" className="min-h-10">Aberto</SelectItem>
          <SelectItem value="won" className="min-h-10">Ganho</SelectItem>
          <SelectItem value="lost" className="min-h-10">Perdido</SelectItem>
        </SelectContent>
      </Select>
    );

    const headerActions = (
      <div className="mt-2 grid grid-flow-col auto-cols-fr gap-2">
        {localLead.phone && (
          <Button disabled={!canOperateLead} variant="outline" size="sm" aria-label={`Ligar para ${leadName}`} title="Ligar" onClick={handleQuickPhone} className="h-10 rounded-[6px] border-0 bg-[var(--app-surface-soft)]">
            <Phone className="h-3.5 w-3.5" />
          </Button>
        )}
        {!hideWhatsAppAction && <Button disabled={!canOpenLeadWhatsApp || !localLead.phone} size="sm" onClick={handleQuickWhatsApp} className="h-10 rounded-[6px] px-2 text-xs">
          <MessageCircle className="mr-1 h-3.5 w-3.5" />
          Chat
        </Button>}
          {localLead.email && (
          <Button disabled={!canOperateLead} variant="outline" size="sm" aria-label={`Enviar e-mail para ${leadName}`} title="Enviar e-mail" onClick={handleQuickEmail} className="h-10 rounded-[6px] border-0 bg-[var(--app-surface-soft)]">
            <Mail className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    );

    return (
      <div className="lead-detail-dialog lead-detail-v2 flex h-full min-h-0 flex-col bg-[var(--app-surface-solid)] text-[var(--app-text-primary)]">
        <LeadDetailReadNotice state={detailReadState} onRetry={retryLeadRead} />
        {isCompactPipelineHeader ? (
          <PipelineMobileLeadHeader
            key={`${activeOrganization.organizationId}:${lead.id}`}
            stages={headerStages}
            closeAction={headerCloseAction}
            identity={headerIdentity}
            assignee={headerAssignee}
            status={headerStatus}
            tags={headerTags}
            actions={headerActions}
          />
        ) : (
          <div className="lead-mobile-drawer-header shrink-0 border-b border-[var(--app-border)] bg-[var(--app-surface-solid)] px-3 pb-3">
            <div className="mb-3 flex items-center gap-2">
              {headerStages}
              {headerCloseAction}
            </div>
            {headerIdentity}
            {variant === 'pipeline' && <div className="mt-2 max-h-[72px] overflow-y-auto overscroll-contain">{headerTags}</div>}
            <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              {headerAssignee}
              {headerStatus}
            </div>
            {headerActions}
          </div>
        )}

        <div className="shrink-0 border-b border-[var(--app-border)] bg-[var(--app-surface-solid)] px-3 py-2">
          <div role="tablist" aria-label="Seções dos detalhes do lead" aria-orientation="horizontal" className="grid grid-cols-3 gap-1 rounded-[7px] bg-[var(--app-surface-soft)] p-1"
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
              const currentIndex = tabs.indexOf(event.target as HTMLButtonElement);
              if (currentIndex < 0) return;
              event.preventDefault();
              const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
                : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
              setActiveTab(mobileTabs[nextIndex].id);
              tabs[nextIndex].focus();
            }}
          >
            {mobileTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = mobileActiveTab === tab.id;

              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                   id={`${mobileTabsId}-${tab.id}-tab`}
                   aria-controls={`${mobileTabsId}-${tab.id}-panel`}
                  aria-selected={isActive}
                   tabIndex={isActive ? 0 : -1}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'flex h-10 items-center justify-center gap-1.5 rounded-[5px] text-[11px] font-light transition-colors',
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
          <div role="tabpanel" id={`${mobileTabsId}-summary-panel`} aria-labelledby={`${mobileTabsId}-summary-tab`} hidden={mobileActiveTab !== 'summary'} tabIndex={0} className="h-full">
          {mobileActiveTab === 'summary' && (
            <div className="lead-detail-v2-scroll h-full overflow-y-auto p-3">
              <div className="space-y-3 pb-4">
                <section className="rounded-[8px] bg-[var(--app-surface-soft)] p-3">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-[12px] font-normal">Dados do contato</h3>
                    {canOperateLead && <Button variant="ghost" size="sm" className="lead-detail-subtle-action h-10 rounded-[5px] px-2 text-[10px]" onClick={handleOpenLeadEdit}>
                      <FileEdit className="h-3 w-3" />
                      Editar
                    </Button>}
                  </div>

                  <div className="space-y-2">
                    {contactRows.map((row) => (
                      <InfoLine key={row.label} label={row.label} value={row.value} />
                    ))}
                  </div>
                </section>

                {hasPropertiesModule && <PropertyPickerDialog
                  properties={propertyOptions}
                  selectedPropertyId={localLead.interest_property_id || editForm.property_id || null}
                  onSelect={(property) => void handleSelectInterestProperty(property)}
                  disabled={!canOperateLead || !canViewProperties}
                />}

                <section className="min-w-0 rounded-[6px] bg-[var(--app-surface-soft)] px-3">
                  <div className="flex h-8 items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2 text-[var(--app-text-secondary)]"><FileText className="h-3 w-3 shrink-0" aria-hidden="true" /><h3 className="leading-none" style={{ color: "var(--app-text-secondary)", fontSize: "11px", fontWeight: 400 }}>Documentação</h3></div>
                    {canOperateLead && (
                      <>
                        <Button variant="ghost" size="sm" className="lead-detail-subtle-action h-6 rounded-[6px] px-2 text-[10px] font-light" disabled={isUploading || Boolean(attachmentUploadDraft.draft)} onClick={() => fileInputRef.current?.click()}>
                          {isUploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />}
                          Anexar
                        </Button>
                        <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileUpload} />
                      </>
                    )}
                  </div>
                  {(attachmentsLoading || attachmentsError) && <div className="pb-3 pt-2"><LeadAttachmentsStatus loading={attachmentsLoading} error={attachmentsError} empty={attachments.length === 0} retrying={attachmentsFetching} onRetry={() => void refetchAttachments()} /></div>}
                  <LeadAttachmentUploadRecovery draft={attachmentUploadDraft.draft} canRetry={canOperateLead} checking={attachmentsFetching}
                    onCheck={() => void refetchAttachments()} onRetry={() => { if (attachmentUploadDraft.draft) void handleFileUpload({ target: { files: [attachmentUploadDraft.draft.file] } }); }} onClear={attachmentUploadDraft.clear} />
                  {attachments.length > 0 && (
                    <div className="space-y-2 pb-3 pt-2">
                      {attachments.map((doc) => (
                        <button
                          key={doc.id}
                          type="button"
                          className="flex min-h-10 w-full items-center gap-2 rounded-[6px] border-0 bg-[var(--app-surface-solid)] px-2 py-2 text-left text-xs font-light outline-none transition-colors hover:bg-[var(--app-surface-hover)] focus-visible:ring-1 focus-visible:ring-primary/30"
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
          </div>

          <div role="tabpanel" id={`${mobileTabsId}-actions-panel`} aria-labelledby={`${mobileTabsId}-actions-tab`} hidden={mobileActiveTab !== 'actions'} tabIndex={0} className="h-full">
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
                      className="lead-detail-primary-action lead-agenda-action h-10 shrink-0 rounded-[6px] border-0 bg-primary/50 px-2.5 text-primary-foreground shadow-none hover:bg-primary hover:text-primary-foreground"
                      style={mobilePrimaryActionStyle}
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
                  {renderScheduleEvents()}
                </section>}

                <LeadCadencePanel
                  appearance={variant === 'pipeline' ? 'pipeline' : 'default'}
                  state={leadCadenceState}
                  isLoading={leadCadenceLoading}
                  error={leadCadenceError}
                  isCompleting={cadenceActionPending || completeCadenceTask.isPending}
                  canOperate={canOperateLead}
                  onRetry={() => void refetchLeadCadence()}
                  onTaskClick={handleCadenceTaskClick}
                  onTaskInspect={(task) => { setTaskInspectOnly(true); setSelectedTask(task); setRoteiroDialogOpen(true); }}
                />

                <section className="rounded-[8px] bg-[var(--app-surface-soft)] p-3">
                  <Textarea
                    aria-label="Feedback do lead"
                    placeholder="Registre o feedback sobre atendimento, perfil ou próximos passos..."
                    value={feedback}
                    onChange={(event) => setFeedback(event.target.value)}
                    disabled={!canOperateLead}
                    rows={2}
                    className="h-16 min-h-16 resize-none rounded-[6px] border-0 bg-[var(--app-surface-solid)] px-2.5 text-xs font-light leading-4"
                  />
                  <div className="mt-2 flex justify-end">
                    <Button className="lead-detail-primary-action h-10 rounded-[6px] px-3" style={mobilePrimaryActionStyle} disabled={!canOperateLead || !feedback.trim() || updateLead.isPending} onClick={handleSaveFeedback}>
                      Registrar feedback
                    </Button>
                  </div>
                </section>
              </div>
            </div>
          )}
          </div>

          <div role="tabpanel" id={`${mobileTabsId}-history-panel`} aria-labelledby={`${mobileTabsId}-history-tab`} hidden={mobileActiveTab !== 'history'} tabIndex={0} className="h-full">
          {mobileActiveTab === 'history' && (
            <div className="h-full p-2">
              <LeadUnifiedThread
                historyPagination={variant === 'pipeline'}
                leadId={lead.id}
                leadName={leadName}
                leadAvatarUrl={leadAvatarUrl}
                leadCreatedAt={lead.created_at || null}
              />
            </div>
          )}
          </div>
        </div>
      </div>
    );
  };

  const DesktopContentV2 = () => {
    const leadAvatarUrl = localLead.whatsapp_picture || localLead.whatsapp_avatar_url || localLead.contact_picture || null;
    const dealStatusLabel = localLead.deal_status === 'won' ? 'Ganho' : localLead.deal_status === 'lost' ? 'Perdido' : 'Aberto';
    const contactRows: Array<{ label: string; value: ReactNode; icon?: ReactNode }> = [
      { label: 'Nome', value: <LeadProfileHover lead={localLead} canRevealSensitive={canOperateLead} variant={variant === 'pipeline' ? 'pipeline' : 'default'} /> },
      { label: 'Telefone', value: formatPhoneForDisplay(localLead.phone || '') },
      { label: 'Origem', value: getLeadSourceLabel(leadSource) },
      { label: 'Primeiro contato', value: firstResponseLabel },
      {
        label: 'Campanha',
        value: campaignTrackingDetails || leadMetaQuery.isPending || leadMetaQuery.isError ? <CampaignTrackingHover leadMeta={campaignTrackingDetails} variant={variant === 'pipeline' ? 'pipeline' : 'default'} loading={leadMetaQuery.isPending} error={leadMetaQuery.isError} onRetry={() => void leadMetaQuery.refetch()} /> : null
      },
    ]
      .filter((row) => Boolean(row.value));

    const desktopHeaderTags = (
      <div data-tour="lead-detail-tags" className="mt-2 flex flex-wrap gap-1.5">
        {leadTags.map((tag) => {
          const tagColor = tag.color?.trim() || null;
          return (
            <Badge
              key={tag.id}
              className={cn(
                'flex h-6 items-center gap-1 rounded-[5px] border-0 px-2 text-[10px] font-light',
                'text-white', variant === 'pipeline' && pipelineDetailStyles.tag,
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
        <Popover open={tagPopoverOpen} onOpenChange={(open) => (!open || (canOperateLead && !isTagMutationPending)) && setTagPopoverOpen(open)}>
          <PopoverTrigger asChild>
            <Button disabled={!canOperateLead || isTagMutationPending} variant="ghost" size="sm" className="h-6 rounded-[5px] border-0 bg-[var(--app-surface-soft)] px-2 text-[10px] disabled:hidden">
              <Plus className="mr-1 h-3 w-3" />
              Tag
            </Button>
          </PopoverTrigger>
          <PopoverContent className={cn('w-64 p-0', variant === 'pipeline' && pipelineDetailStyles.portal)} align="start">
              {variant === 'pipeline' ? (
                <LeadTagPickerContent leadId={localLead.id} assignedTagIds={leadTagIds} disabled={!canOperateLead || isTagMutationPending} enabled={tagPopoverOpen} onAddTag={tag => handleAddTag(tag.id, tag)} onClose={() => setTagPopoverOpen(false)} />
              ) : <TagSelectorPopoverContent availableTags={availableTags} onAddTag={handleAddTag} onClose={() => setTagPopoverOpen(false)} />}
          </PopoverContent>
        </Popover>
      </div>
    );

    return (
      <div className="lead-detail-dialog lead-detail-v2 flex h-full max-h-full flex-col bg-[var(--app-surface-solid)] text-[var(--app-text-primary)]">
        <LeadDetailReadNotice state={detailReadState} onRetry={retryLeadRead} />
        <div className="border-b border-transparent bg-[var(--app-surface-solid)] px-4 pt-4">
          <DialogHeader className="sr-only">
            <DialogTitle>{leadName}</DialogTitle>
            <DialogDescription>Dados, ações e histórico do lead.</DialogDescription>
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
                              ? (variant === 'pipeline' ? 'bg-primary/50 text-white' : 'bg-primary text-primary-foreground')
                              : isPast
                                ? (variant === 'pipeline' ? 'bg-primary/50 text-white' : 'bg-primary/10 text-primary')
                                : (variant === 'pipeline'
                                  ? 'bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)] hover:bg-muted'
                                  : 'bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)] hover:bg-primary/10 hover:text-primary'),
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

        <div className={cn('lead-detail-v2-grid grid min-h-0 flex-1 grid-cols-[280px_1fr_340px] xl:grid-cols-[330px_1fr_390px] grid-rows-[minmax(0,1fr)] gap-0 overflow-hidden', variant === 'contacts' && 'grid-cols-[minmax(220px,0.9fr)_minmax(0,1.1fr)_minmax(240px,1fr)] xl:grid-cols-[minmax(220px,0.9fr)_minmax(0,1.1fr)_minmax(240px,1fr)] [&>div]:min-w-0')}>
          <aside className="lead-detail-v2-column border-r border-[var(--app-border)]">
            <div ref={v2LeadInfoScrollRef} className={cn('lead-detail-v2-scroll h-full overflow-y-auto p-4', variant === 'pipeline' && pipelineDetailStyles.columnScroll)}>
              <section className="space-y-3">
                <div className={cn('flex items-start gap-3', variant === 'pipeline' && 'relative min-h-11 pr-11')}>
                  <Avatar className="h-11 w-11 shrink-0 border-0">
                    <AvatarImage src={leadAvatarUrl || undefined} alt={leadName} />
                    <AvatarFallback className={cn('text-[12px] font-light', variant === 'pipeline' ? 'bg-primary/50 text-white' : 'bg-primary/12 text-primary')}>
                      {getDisplayInitial(leadName) || <User className="h-5 w-5" />}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h2 className="truncate text-[14px] font-normal leading-tight">{leadName}</h2>
                      <ReentryBadge count={lead.reentry_count} lastEntryAt={lead.last_entry_at} />
                      <QueuePoolClaimButton lead={localLead} compact disabled={fullLeadQuery.isFetching || readAccessPending} />
                    </div>
                    {variant === 'pipeline' && (localLead.phone || localLead.email) && (
                      <div className="mt-1 flex min-w-0 items-center gap-1.5">
                        <p className="truncate text-xs text-[var(--app-text-tertiary)]">{localLead.phone ? formatPhoneForDisplay(localLead.phone) : localLead.email}</p>
                        {localLead.phone && <CopyLeadPhoneButton phone={localLead.phone} className="absolute right-0 top-0 h-10 w-10 bg-transparent hover:bg-[var(--app-surface-soft)]" />}
                      </div>
                    )}
                    {variant !== 'pipeline' && desktopHeaderTags}
                  </div>
                </div>
                {variant === 'pipeline' && desktopHeaderTags}

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
                      className={cn('w-[300px] overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-1 shadow-none', variant === 'pipeline' && pipelineDetailStyles.portal)}
                      align="start"
                      collisionPadding={12}
                      onWheelCapture={(event) => event.stopPropagation()}
                      onTouchMoveCapture={(event) => event.stopPropagation()}
                    >
                      <Command filter={commandSearchFilter} className={cn("max-h-[min(72vh,420px)] border-none bg-transparent [&_[cmdk-input-wrapper]]:border-b-0 [&_[cmdk-input-wrapper]]:px-2", variant === 'pipeline' && pipelineDetailStyles.assigneeSearch)}>
                        <CommandInput aria-label="Buscar responsável" placeholder="Buscar..." className="h-9 border-none focus:ring-0" />
                        <CommandList
                          className="max-h-[min(56vh,320px)] overflow-y-auto overscroll-contain p-1 touch-pan-y scrollbar-thin [-webkit-overflow-scrolling:touch]"
                          onWheelCapture={(event) => event.stopPropagation()}
                          onTouchMoveCapture={(event) => event.stopPropagation()}
                        >
                          <LeadAssigneeCatalogNotice state={allUsersState} />
                          {!assigneeCatalogBlocked && <CommandEmpty className="py-4 text-center text-sm text-muted-foreground">Nenhum encontrado.</CommandEmpty>}
                          {!assigneeCatalogBlocked && <CommandGroup>
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
                          </CommandGroup>}
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>

                  <div onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                    <Select value={localLead.deal_status || 'open'} onValueChange={handleDealStatusChange} disabled={!canOperateLead || dealStatusChange.isPending || stageMovePending}>
                      <SelectTrigger
                        className={cn(
                          'h-8 w-[92px] gap-1 rounded-[6px] px-2 text-xs font-light',
                          getDealStatusTriggerClass(localLead.deal_status),
                        )}
                      >
                        <SelectValue>{dealStatusLabel}</SelectValue>
                      </SelectTrigger>
                      <SelectContent className={variant === 'pipeline' ? pipelineDetailStyles.portal : undefined}>
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
                  {!hideWhatsAppAction && <Button disabled={!canOpenLeadWhatsApp || !localLead.phone} size="sm" onClick={handleQuickWhatsApp} className="h-8 rounded-[6px] px-2 text-xs">
                    <MessageCircle className="mr-1 h-3.5 w-3.5" />
                    Chat
                  </Button>}
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

                </div>

                {hasPropertiesModule && <PropertyPickerDialog
                  properties={propertyOptions}
                  selectedPropertyId={localLead.interest_property_id || editForm.property_id || null}
                  onSelect={(property) => void handleSelectInterestProperty(property)}
                  disabled={!canOperateLead || !canViewProperties}
                />}

                <div data-tour="lead-detail-documents" className="min-w-0 rounded-[6px] bg-[var(--app-surface-soft)] px-3">
                  <div className="flex h-8 items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2 text-[var(--app-text-secondary)]"><FileText className="h-3 w-3 shrink-0" aria-hidden="true" /><h3 className="leading-none" style={{ color: "var(--app-text-secondary)", fontSize: "11px", fontWeight: 400 }}>Documentação</h3></div>
                    {canOperateLead && (
                      <>
                        <Button variant="ghost" size="sm" className="lead-detail-subtle-action h-6 rounded-[6px] px-2 text-[10px] font-light" disabled={isUploading || Boolean(attachmentUploadDraft.draft)} onClick={() => fileInputRef.current?.click()}>
                          {isUploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />}
                          Anexar
                        </Button>
                        <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileUpload} />
                      </>
                    )}
                  </div>
                  {(attachmentsLoading || attachmentsError) && <div className="pb-3 pt-2"><LeadAttachmentsStatus loading={attachmentsLoading} error={attachmentsError} empty={attachments.length === 0} retrying={attachmentsFetching} onRetry={() => void refetchAttachments()} /></div>}
                  <LeadAttachmentUploadRecovery draft={attachmentUploadDraft.draft} canRetry={canOperateLead} checking={attachmentsFetching}
                    onCheck={() => void refetchAttachments()} onRetry={() => { if (attachmentUploadDraft.draft) void handleFileUpload({ target: { files: [attachmentUploadDraft.draft.file] } }); }} onClear={attachmentUploadDraft.clear} />
                  {attachments.length > 0 && (
                    <div className="max-h-44 space-y-2 overflow-y-auto pb-3 pr-1 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
            <div ref={v2LeadWorkScrollRef} className={cn('lead-detail-v2-scroll h-full overflow-y-auto p-4', variant === 'pipeline' && pipelineDetailStyles.columnScroll)}>
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
                      className="lead-detail-primary-action lead-agenda-action h-8 shrink-0 rounded-[6px] border-0 bg-primary/50 px-2.5 text-primary-foreground shadow-none hover:bg-primary hover:text-primary-foreground"
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
                  {renderScheduleEvents()}
                </section>}

                <LeadCadencePanel
                  appearance={variant === 'pipeline' ? 'pipeline' : 'default'}
                  state={leadCadenceState}
                  isLoading={leadCadenceLoading}
                  error={leadCadenceError}
                  isCompleting={cadenceActionPending || completeCadenceTask.isPending}
                  canOperate={canOperateLead}
                  onRetry={() => void refetchLeadCadence()}
                  onTaskClick={handleCadenceTaskClick}
                  onTaskInspect={(task) => { setTaskInspectOnly(true); setSelectedTask(task); setRoteiroDialogOpen(true); }}
                />

                <section data-tour="lead-detail-feedback" className="rounded-[8px] bg-[var(--app-surface-soft)] p-3">
                  <Textarea
                    aria-label="Feedback do lead"
                    placeholder="Registre o feedback sobre atendimento, perfil ou próximos passos..."
                    value={feedback}
                    onChange={(event) => setFeedback(event.target.value)}
                    disabled={!canOperateLead}
                    rows={2}
                    className="h-16 min-h-16 resize-none rounded-[6px] border-0 bg-[var(--app-surface-solid)] px-2.5 text-xs font-light leading-4"
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
              historyPagination={variant === 'pipeline'}
              leadId={lead.id}
              leadName={leadName}
              leadAvatarUrl={leadAvatarUrl}
              leadCreatedAt={lead.created_at || null}
            />
          </aside>
        </div>
      </div>
    );
  };

  const overlays = (<>
    {canViewLeadSchedule && readOnlyScheduleEvent && <LeadScheduleReadDialog event={readOnlyScheduleEvent} onClose={() => setReadOnlyScheduleEvent(null)} />}
    <LeadDetailOverlays
      outcomeScopeKey={outcomeScopeKey}
      outcomeDraft={outcomeDraft.draft}
      onOutcomeDraftChange={outcomeDraft.updateDraft}
      quickActionDraft={quickActionDraft.draft}
      onQuickActionDraftChange={quickActionDraft.updateDraft}
      outcomeBlockedReason={outcomeBlockedReason}
      quickActionBlockedReason={outcomeBlockedReason}
      onRetryOutcomeRead={detailReadState.canRetry ? retryLeadRead : undefined}
      outcomeReadRetrying={detailReadState.retrying}
      lead={lead}
      leadName={leadName}
      selectedTask={leadCadenceState?.tasks.find((task) => task.id === selectedTask?.id) || selectedTask}
      cadenceTimeZone={leadCadenceState?.time_zone}
      taskInspectOnly={taskInspectOnly || !canOperateLead || leadCadenceState?.deal_status !== 'open' ||
        !leadCadenceState.tasks.some((task) => task.id === selectedTask?.id && task.status === 'pending' && !task.is_done)}
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
      cadenceTaskPending={cadenceActionPending || completeCadenceTask.isPending}
      quickActionPending={quickActionSubmitting || recordContactOutcome.isPending || quickActionDraft.isSubmitting}
      reopenStatusConfirmation={reopenStatusConfirmation}
      onReopenStatusConfirmationChange={(confirmation) => {
        if (!confirmation && reopenStatusConfirmation && !statusConfirmation.clear(reopenStatusConfirmation.intent)) return;
        setReopenStatusConfirmation(confirmation);
      }}
      onConfirmReopen={(confirmation) => {
        void handleDealStatusChange('open', { confirmation });
      }}
      assigneeScheduleConfirmation={assigneeScheduleConfirmation}
      onAssigneeScheduleConfirmationChange={(confirmation) => {
        if (!confirmation) assigneeSelectionRef.current = null;
        setAssigneeScheduleConfirmation(confirmation);
      }}
      onConfirmAssignee={handleConfirmAssignee}
      dealStatusPending={dealStatusChange.isPending || stageMovePending}
      lostReasonDialogOpen={lostReasonDialogOpen}
      onLostReasonDialogOpenChange={(open) => {
        if (!open && !statusConfirmation.clear()) return;
        if (!open && !stageMovePending) setPendingLostStageMove(null);
        setLostReasonDialogOpen(open);
      }}
      onConfirmLostReason={handleConfirmLostReason}
      lostReasonDraft={statusConfirmation.draft}
      onLostReasonDraftChange={statusConfirmation.updateDraft}
      selectedAttachment={selectedAttachment}
      onSelectedAttachmentChange={setSelectedAttachment}
      hasAgendaModule={hasAgendaModule}
      scheduleFormOpen={scheduleFormOpen}
      onCloseScheduleForm={handleCloseScheduleForm}
      editingScheduleEvent={editingScheduleEvent}
      scheduleDefaultType={scheduleDefaultType}
    />
  </>);

  // Render mobile or desktop version - use JSX directly instead of component functions
  if (isMobile || isTablet) {
    return (
      <>
        <Drawer open={Boolean(leadProp)} onOpenChange={(open) => !open && handleCloseLeadDetail()}>
          <DrawerContent
            className="lead-mobile-drawer mx-auto w-full overflow-hidden rounded-t-[8px] border-0 bg-[var(--app-surface-solid)] p-0 text-[var(--app-text-primary)] shadow-none md:max-w-[760px]"
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
              {detailReadState.hideDetails ? 'Acesso ao lead' : leadName ? `Detalhes do lead ${leadName}` : 'Detalhes do lead'}
            </DrawerTitle>
            <DrawerDescription className="sr-only">Dados, ações e histórico do lead.</DrawerDescription>
            {detailReadState.hideDetails
              ? <LeadDetailReadNotice state={detailReadState} onRetry={retryLeadRead} onClose={handleCloseLeadDetail} />
              : <>{MobileContentV2()}</>}
          </DrawerContent>
        </Drawer>
        {!detailReadState.hideDetails && overlays}
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
          data-lead-detail-variant={variant}
          className={cn('lead-detail-dialog-content flex h-[92vh] max-h-[92vh] w-[96vw] max-w-[1180px] flex-col gap-0 overflow-hidden rounded-[8px] border-none bg-[var(--app-surface-solid)] p-0 text-[var(--app-text-primary)] shadow-none lg:h-[min(720px,84vh)] lg:max-h-[84vh] lg:w-[92vw] xl:w-[min(1180px,92vw)]', variant === 'pipeline' && pipelineDetailStyles.dialog)}
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
          {detailReadState.hideDetails ? <>
            <DialogHeader className="sr-only"><DialogTitle>Acesso ao lead</DialogTitle><DialogDescription>Confirme o acesso para visualizar os detalhes.</DialogDescription></DialogHeader>
            <LeadDetailReadNotice state={detailReadState} onRetry={retryLeadRead} onClose={handleCloseLeadDetail} />
          </> : <>{DesktopContentV2()}</>}
        </DialogContent>
      </Dialog>
      {!detailReadState.hideDetails && overlays}
    </>
  );
}
