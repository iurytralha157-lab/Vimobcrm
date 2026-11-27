import { useState, useEffect, useMemo, useRef, useId, type ReactNode } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { getClientRateLimitMessage } from '@/lib/client-action-rate-limit';
import { PropertyPickerDialog } from '@/components/features/properties/PropertyPickerDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from '@/components/ui/drawer';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  ArrowLeftRight, Calendar, ChevronLeft, ChevronRight, Clock, Crosshair, FileEdit, FileText, Home, Mail, MessageCircle, Phone, Plus, RotateCw, UserRound, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getTagColorStyleWithWhiteText } from '@/lib/tag-color';
import { ptBR, enUS } from 'date-fns/locale';
import { useCompleteCadenceTask } from '@/hooks/use-lead-tasks';
import { useLeadCadenceState } from '@/hooks/leads/use-lead-cadence-state';
import { useLeadFeedbackDraft } from '@/hooks/leads/use-lead-feedback-draft';
import { useLeadAttachmentUploadDraft } from '@/hooks/leads/use-lead-attachment-upload-draft';
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
import { canOperateLeadFromFreshRead, leadProgressCapability, mergeLeadOperationCapability } from '@/lib/lead-operation-capability';
import pipelineDetailStyles from '@/components/features/leads/lead-detail/PipelineLeadDetail.module.css';
import { LeadTagPickerContent } from '@/components/features/leads/lead-detail/LeadTagPickerContent';
import { LeadDetailActions } from '@/components/features/leads/lead-detail/LeadDetailActions';
import { LeadDetailAssigneePicker } from '@/components/features/leads/lead-detail/LeadDetailAssigneePicker';
import { LeadDetailAttachments } from '@/components/features/leads/lead-detail/LeadDetailAttachments';
import { LeadDetailStageNav } from '@/components/features/leads/lead-detail/LeadDetailStageNav';
import { DesktopLeadLayout, MobileLeadLayout, type LeadDetailLayoutProps } from '@/components/features/leads/lead-detail/LeadDetailLayout';
import type { LeadDetailTab, LeadDetailTabId } from '@/components/features/leads/lead-detail/LeadDetailTabBar';
import { LeadOriginPanel } from '@/components/features/leads/lead-detail/LeadOriginPanel';
import { LeadProfileDetails } from '@/components/features/leads/lead-detail/LeadProfileDetails';
import { daysSince, describeRecentReentry, formatElapsedShort, isContactStale } from '@/components/features/leads/lead-detail/lead-detail-metrics';
import { formatDateSafely } from '@/components/features/leads/lead-detail/utils';
import { useCadenceOverdueCount } from '@/hooks/leads/use-cadence-overdue-count';
import { LeadDetailReadNotice } from '@/components/features/leads/lead-detail/LeadDetailReadNotice';
import { getLeadDetailReadState } from '@/components/features/leads/lead-detail/read-recovery';
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
  getCadenceTaskType,
  getDealStatusTriggerClass,
  getErrorMessage,
  getLeadPropertyFallback,
  getLeadSourceLabel,
  hasTagId,
  LeadDetailOverlays,
  LeadProfileHover,
  mergePropertyFallback,
  OUTCOME_CADENCE_TASK_TYPES,
  useLeadDetailPipelineCache,
  type LeadDetailDialogProps,
  type LeadDetailLead,
  type ReopenStatusConfirmation,
  type AssigneeScheduleConfirmation,
  type SelectableLeadProperty,
} from './lead-detail';

export type { LeadDetailLead, LeadDetailNavigation } from './lead-detail';

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
  navigation,
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
  const [scheduleInitialOutcome, setScheduleInitialOutcome] = useState<'pick' | 'rescheduled' | undefined>(undefined);
  const [scheduleDefaults, setScheduleDefaults] = useState<{ date: Date; time: string; title: string } | null>(null);
  // "Agendar próximo contato": days from today, or null when not requested.
  const [nextContactDays, setNextContactDays] = useState<number | null>(null);
  // The "entrou de novo" notice can be closed for the re-entry it describes.
  const [dismissedReentryAt, setDismissedReentryAt] = useState<string | null>(null);
  const [detailTabState, setDetailTabState] = useState<{ leadId: string | null; tab: LeadDetailTabId }>({ leadId: null, tab: 'atividades' });
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
  // Another lead opened in the same card starts on Atividades again.
  const detailTab: LeadDetailTabId = detailTabState.leadId === leadId ? detailTabState.tab : 'atividades';
  const setDetailTab = (tab: LeadDetailTabId) => setDetailTabState({ leadId, tab });
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
    if (!canProgressLead || !feedback.trim() || feedbackSubmittingRef.current) return;
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
      if (operation.isCurrent() && nextContactDays !== null && canManageLeadSchedule) {
        // The agenda form opens prefilled; nothing is scheduled until the user confirms it there.
        const date = new Date();
        date.setHours(0, 0, 0, 0);
        date.setDate(date.getDate() + nextContactDays);
        setNextContactDays(null);
        setScheduleInitialOutcome(undefined);
        setEditingScheduleEvent(null);
        setScheduleDefaultType('call');
        setScheduleDefaults({ date, time: '09:00', title: `Retornar contato com ${normalizeDisplayName(localLead?.name || lead.name, 'o lead')}` });
        setScheduleFormOpen(true);
      }
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
  const cadenceStageId = fullLeadQuery.data ? fullLeadQuery.data.stage_id : leadProp?.stage_id;
  const {
    data: leadCadenceState,
    isLoading: leadCadenceLoading,
    error: leadCadenceError,
    refetch: refetchLeadCadence,
  } = useLeadCadenceState(leadId, cadenceOrganizationId, cadenceStageId);
  const cadenceOverdueCount = useCadenceOverdueCount(leadCadenceState);
  // One clock per opened card keeps the "dias"/"últ. contato" tiles stable while it is open.
  const [detailOpenedAt] = useState(() => Date.now());
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
  const canUseLeadActions = detailReadState.kind === 'ready' && !readAccessBlocked && !poolReadOnly && !isUpdatingAssignee && !updateLead.isPending && !recordLeadFeedback.isPending && !dealStatusChange.isPending && !stageMovePending && !readAccessPending;
  const canOperateLead = canUseLeadActions && canOperateLeadFromFreshRead(
    hasLeadOperatePermission,
    fullLeadQuery,
    verifiedRead,
  );
  const canProgressLead = canUseLeadActions && canOperateLeadFromFreshRead(
    hasLeadOperatePermission,
    fullLeadQuery,
    verifiedRead,
    'progress',
  );
  const outcomeBlockedReason = detailReadState.blockedReason || (
    poolReadOnly ? 'Assuma o lead antes de registrar o resultado.' : !hasLeadOperatePermission
      ? 'Seu acesso a este lead permite apenas visualização.' : 'Aguarde a atualização em andamento para registrar o resultado.'
  );
  const moveContract = useLeadMoveContract(canProgressLead);
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
  const { data: persistedProperty, isSuccess: hasLoadedProperty } = useProperty(canViewProperties && leadProp ? selectedPropertyId : null);
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
    if (!canProgressLead || !currentLead.phone) return;
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
    if (!canProgressLead || !currentLead.email) return;
    const gmailUrl = `https://mail.google.com/mail/view=cm&fs=1&tf=1&to=${encodeURIComponent(currentLead.email)}`;
    window.open(gmailUrl, '_blank', 'noopener,noreferrer');
    setQuickActionOutcomeType('email');
    setQuickActionOutcomeOpen(true);
  };

  const handleQuickActionOutcomeConfirm = async (outcome: TaskOutcome, notes: string) => {
    if (!canProgressLead || quickActionSubmittingRef.current) return false;
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
  const handleEditScheduleEvent = (event: ScheduleEvent, initialOutcome?: 'pick' | 'rescheduled') => {
    if (!canViewLeadSchedule) return;
    if (!canManageLeadSchedule) { setReadOnlyScheduleEvent(event); return; }
    setScheduleInitialOutcome(initialOutcome);
    setScheduleDefaults(null);
    setEditingScheduleEvent(event);
    setScheduleFormOpen(true);
  };
  const handleCloseScheduleForm = () => {
    setScheduleFormOpen(false);
    setEditingScheduleEvent(null);
    setScheduleInitialOutcome(undefined);
    setScheduleDefaults(null);
  };
  // A transient access failure hides all portals but retains the unsaved form and its original CAS revision.
  if (!leadProp || !localLead || readAccessBlocked) return null;

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
      can_progress: undefined,
    });
    const receipt = fieldOptimism.begin(localLead, { assigned_user_id: optimisticLead.assigned_user_id,
      assignee: optimisticLead.assignee, can_operate: optimisticLead.can_operate,
      can_progress: optimisticLead.can_progress }, mutationOperation, expectedUpdatedAt);
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
    if (!mutationOperation.isCurrent() || !canProgressLead || stageId === localLead.stage_id || stageMovePendingRef.current || statusSubmittingRef.current) return false;

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
      if (leadProgressCapability(latestRead) === false) return false;
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
      void queryClient.invalidateQueries({ queryKey: ['lead-cadence-state', organizationId, lead.id] });
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
    if (!canProgressLead || stageId === localLead.stage_id) return;
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
      void queryClient.invalidateQueries({ queryKey: ['lead-cadence-state', currentLead.organization_id || activeOrganization.organizationId, lead.id] });
    } catch {
      // The hook restores only its own patch or reconciles an uncertain result.
    } finally {
      statusSubmittingRef.current = false;
    }
  };

  // Confirm lost with reason from dialog
  const handleConfirmLostReason = async (reason: string) => {
    if (!(pendingLostStageMove ? canProgressLead : canOperateLead) || statusSubmittingRef.current || dealStatusChange.isPending || stageMovePending) return;
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
      void queryClient.invalidateQueries({ queryKey: ['lead-cadence-state', currentLead.organization_id || activeOrganization.organizationId, lead.id] });
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
  const openVisitForm = () => {
    setScheduleInitialOutcome(undefined);
    setScheduleDefaults(null);
    setEditingScheduleEvent(null);
    setScheduleDefaultType('visit');
    setScheduleFormOpen(true);
  };
  const currentStageName = stages.find((stage) => stage.id === localLead.stage_id)?.name || 'sem etapa';
  const renderAssigneePicker = (mobile: boolean) => (
    <LeadDetailAssigneePicker mobile={mobile} open={assigneePopoverOpen} disabled={!canTransferLead}
      updating={isUpdatingAssignee} assigneeName={assigneeName} users={assignableUsers}
      catalogState={allUsersState} catalogBlocked={assigneeCatalogBlocked}
      portalClassName={variant === 'pipeline' ? pipelineDetailStyles.portal : undefined}
      searchClassName={variant === 'pipeline' ? pipelineDetailStyles.assigneeSearch : undefined}
      onOpenChange={handleAssigneePopoverChange} onSelect={handleAssignUser} />
  );
  const renderInterestProperty = () => {
    if (!hasPropertiesModule) return null;
    const status = persistedProperty?.status?.trim().toLowerCase();
    const showInactiveNotice = variant === 'pipeline' && canOperateLead && canViewProperties &&
      hasLoadedProperty && persistedProperty?.id === selectedPropertyId &&
      persistedProperty.organization_id === activeOrganization.organizationId &&
      localLead.deal_status !== 'won' && (status === 'inactive' || status === 'inativo');
    return (
      <>
        <PropertyPickerDialog
          properties={propertyOptions}
          selectedPropertyId={selectedPropertyId}
          onSelect={(property) => void handleSelectInterestProperty(property)}
          disabled={!canOperateLead || !canViewProperties}
        />
        {showInactiveNotice && (
          <p className="rounded-[8px] bg-[var(--app-surface-soft)] px-3 py-2 text-xs text-muted-foreground">
            O imóvel selecionado está inativo. Você pode registrar a venda. O cadastro continuará inativo.
          </p>
        )}
      </>
    );
  };
  const renderAttachments = (mobile: boolean) => (
    <LeadDetailAttachments mobile={mobile} canOperate={canOperateLead} attachments={attachments}
      loading={attachmentsLoading} error={attachmentsError} fetching={attachmentsFetching} uploading={isUploading}
      inputRef={fileInputRef} uploadDraft={attachmentUploadDraft.draft} onUpload={handleFileUpload}
      onOpen={handleOpenAttachment} onRefetch={() => void refetchAttachments()} onClearDraft={attachmentUploadDraft.clear} />
  );
  const renderActionSections = (mobile: boolean, split = false) => (
    <LeadDetailActions
      mobile={mobile}
      split={split}
      schedule={{
        visible: canViewLeadSchedule, manageable: canManageLeadSchedule, events: scheduleEvents,
        summary: scheduleSummaryLabel, locale: dateLocale, error: scheduleError, pending: schedulePending,
        hasNextPage: schedulePreview.hasNextPage, fetchingNextPage: schedulePreview.isFetchingNextPage,
        onRefetch: () => void refetchScheduleEvents(),
        onFetchNextPage: () => void schedulePreview.fetchNextPage(),
        onEditEvent: (event) => handleEditScheduleEvent(event),
        onResolveEvent: handleEditScheduleEvent,
        onSchedule: openVisitForm,
      }}
      cadence={{
        appearance: variant === 'pipeline' ? 'pipeline' : 'default',
        state: leadCadenceState, isLoading: leadCadenceLoading, error: leadCadenceError,
        isCompleting: cadenceActionPending || completeCadenceTask.isPending, canOperate: canOperateLead,
        onRetry: () => void refetchLeadCadence(), onTaskClick: handleCadenceTaskClick,
        onTaskInspect: (task) => { setTaskInspectOnly(true); setSelectedTask(task); setRoteiroDialogOpen(true); },
      }}
      feedback={{ value: feedback, canProgress: canProgressLead, pending: updateLead.isPending, onChange: setFeedback, onSave: handleSaveFeedback, nextContact: canManageLeadSchedule ? { days: nextContactDays, onChange: setNextContactDays } : undefined }}
    />
  );

  const renderTagList = (mobile: boolean) => (
    <div className="flex flex-wrap gap-1.5">
      {leadTags.map((tag) => (
        <Badge
          key={tag.id}
          className={cn('flex h-6 items-center gap-1 rounded-[5px] border-0 px-2 text-[10px] font-light text-white', variant === 'pipeline' && pipelineDetailStyles.tag)}
          style={getTagColorStyleWithWhiteText(tag.color?.trim() || null)}
        >
          <span className={mobile ? 'max-w-[140px] truncate' : undefined}>{tag.name || 'Tag'}</span>
          <button disabled={!canOperateLead || isTagMutationPending} type="button" aria-label={`Remover tag ${tag.name || 'Tag'}`} title="Remover tag" className="rounded-[3px] p-0.5 hover:bg-primary-foreground/15 disabled:hidden" onClick={() => handleRemoveTag(tag.id)}>
            <X className="h-2.5 w-2.5" />
          </button>
        </Badge>
      ))}
      <Popover open={tagPopoverOpen} onOpenChange={(open) => (!open || (canOperateLead && !isTagMutationPending)) && setTagPopoverOpen(open)}>
        <PopoverTrigger asChild>
          <Button disabled={!canOperateLead || isTagMutationPending} variant="ghost" size="sm" className={cn('rounded-[5px] border-0 px-2 text-[10px] font-light disabled:hidden', mobile ? 'h-8 bg-[var(--app-surface-soft)]' : 'h-6 bg-[var(--app-surface-solid)]')}>
            <Plus strokeWidth={1.5} className="mr-1 h-3 w-3" />
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

  const renderLeadLayout = (mobile: boolean) => {
    const leadAvatarUrl = localLead.whatsapp_picture || localLead.whatsapp_avatar_url || localLead.contact_picture || null;
    const dealStatusLabel = localLead.deal_status === 'won' ? 'Ganho' : localLead.deal_status === 'lost' ? 'Perdido' : 'Aberto';
    const profileVariant = variant === 'pipeline' ? 'pipeline' : 'default';
    const portalClassName = variant === 'pipeline' ? pipelineDetailStyles.portal : undefined;
    const firstName = leadName.split(/\s+/)[0] || leadName;
    const actionHeight = mobile ? 'h-11' : 'h-8';
    // Desktop chips sit on the grey identity block; on mobile they sit on the white card.
    const chipBg = mobile ? 'bg-[var(--app-surface-soft)]' : 'bg-[var(--app-surface-solid)]';
    const campaignValue = campaignTrackingDetails || leadMetaQuery.isPending || leadMetaQuery.isError
      ? <CampaignTrackingHover leadMeta={campaignTrackingDetails} variant={profileVariant} loading={leadMetaQuery.isPending} error={leadMetaQuery.isError} onRetry={() => void leadMetaQuery.refetch()} />
      : null;
    const contactRows: Array<{ label: string; value: ReactNode }> = [
      { label: 'Nome', value: <LeadProfileHover lead={localLead} canRevealSensitive={canOperateLead} variant={profileVariant} /> },
      { label: 'Telefone', value: formatPhoneForDisplay(localLead.phone || '') },
      { label: 'E-mail', value: localLead.email || null },
      { label: 'Origem', value: getLeadSourceLabel(leadSource) },
      { label: 'Entrou em', value: localLead.created_at ? formatDateSafely(localLead.created_at, 'dd/MM/yyyy', ptBR, '') : null },
      { label: 'Primeiro contato', value: firstResponseLabel },
      { label: 'Campanha', value: campaignValue },
    ].filter((row) => Boolean(row.value));

    const daysInFunnel = daysSince(localLead.created_at, detailOpenedAt);
    const firstResponseSeconds = firstResponse && typeof firstResponse.seconds === 'number' && firstResponse.seconds >= 0 ? firstResponse.seconds : null;
    const tiles = [
      { value: daysInFunnel === null ? '—' : `${daysInFunnel} ${daysInFunnel === 1 ? 'dia' : 'dias'}`, label: 'no funil' },
      { value: formatElapsedShort(localLead.last_contact_at, detailOpenedAt) ?? '—', label: 'últ. contato', alert: isContactStale(localLead.last_contact_at, detailOpenedAt) },
      { value: firstResponseSeconds === null ? '—' : formatResponseTime(firstResponseSeconds), label: '1º contato' },
    ];

    const status = (
      <div onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
        <Select value={localLead.deal_status || 'open'} onValueChange={handleDealStatusChange} disabled={!canOperateLead || dealStatusChange.isPending || stageMovePending}>
          <SelectTrigger aria-label="Status do negócio" className={cn('gap-1 rounded-[6px] border-0 px-2.5 text-xs font-light', mobile ? 'h-10 w-[110px]' : 'h-8 w-full', getDealStatusTriggerClass(localLead.deal_status), !mobile && (localLead.deal_status || 'open') === 'open' && '!bg-[var(--app-surface-solid)]')}>
            <SelectValue>{dealStatusLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent className={portalClassName}>
            <SelectItem value="open" className={mobile ? 'min-h-10' : undefined}>Aberto</SelectItem>
            <SelectItem value="won" className={mobile ? 'min-h-10' : undefined}>Ganho</SelectItem>
            <SelectItem value="lost" className={mobile ? 'min-h-10' : undefined}>Perdido</SelectItem>
          </SelectContent>
        </Select>
      </div>
    );

    const quickActions = (
      <div className="flex gap-2">
        {localLead.phone && (
          <Button disabled={!canProgressLead} variant="ghost" size="sm" aria-label={`Ligar para ${leadName}`} title="Ligar" onClick={handleQuickPhone} className={cn('w-12 shrink-0 rounded-[6px] border-0 shadow-none', chipBg, actionHeight)}>
            <Phone strokeWidth={1.5} className="h-4 w-4" />
          </Button>
        )}
        {!hideWhatsAppAction && (
          <Button disabled={!canOpenLeadWhatsApp || !localLead.phone} size="sm" onClick={handleQuickWhatsApp} className={cn('min-w-0 flex-1 rounded-[6px] border-0 px-2 text-xs font-light shadow-none', actionHeight)}>
            <MessageCircle strokeWidth={1.5} className="mr-1 h-4 w-4" />
            WhatsApp
          </Button>
        )}
        {mobile && canManageLeadSchedule && (
          <Button variant="ghost" size="sm" aria-label="Agendar visita" title="Agendar visita" onClick={openVisitForm} className={cn('w-12 shrink-0 rounded-[6px] border-0 shadow-none', chipBg, actionHeight)}>
            <Calendar strokeWidth={1.5} className="h-4 w-4" />
          </Button>
        )}
        {localLead.email && (
          <Button disabled={!canProgressLead} variant="ghost" size="sm" aria-label={`Enviar e-mail para ${leadName}`} title="Enviar e-mail" onClick={handleQuickEmail} className={cn('w-12 shrink-0 rounded-[6px] border-0 shadow-none', chipBg, actionHeight)}>
            <Mail strokeWidth={1.5} className="h-4 w-4" />
          </Button>
        )}
      </div>
    );

    const tabs: LeadDetailTab[] = [
      { id: 'atividades', label: 'Atividades', icon: Clock, alert: cadenceOverdueCount || undefined },
      ...(hasPropertiesModule ? [{ id: 'imoveis' as const, label: 'Imóveis', icon: Home }] : []),
      { id: 'arquivos', label: 'Arquivos', icon: FileText, count: attachments.length || undefined },
      { id: 'dados', label: mobile ? 'Dados' : 'Dados do lead', icon: UserRound },
      { id: 'transferir', label: 'Transferir', icon: ArrowLeftRight },
      { id: 'origem', label: 'Origem', icon: Crosshair },
    ];
    const activeTab = tabs.some((tab) => tab.id === detailTab) ? detailTab : 'atividades';

    const history = (
      <LeadUnifiedThread
        historyPagination={variant === 'pipeline'}
        leadId={lead.id}
        leadName={leadName}
        leadAvatarUrl={leadAvatarUrl}
        leadCreatedAt={lead.created_at || null}
      />
    );

    const panels: Record<LeadDetailTabId, ReactNode> = {
      atividades: mobile ? (
        <div className="space-y-3">
          {renderActionSections(true)}
          <div data-tour="lead-detail-history" className="h-[calc(100dvh-120px)] min-h-[420px] overflow-hidden rounded-[8px] bg-[var(--app-surface-soft)]">{history}</div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="lead-detail-v2-scroll max-h-[48%] shrink-0 space-y-3 overflow-y-auto">{renderActionSections(false, true)}</div>
          <div data-tour="lead-detail-history" className="min-h-[260px] flex-1 overflow-hidden rounded-[8px] bg-[var(--app-surface-soft)]">{history}</div>
        </div>
      ),
      imoveis: (
        <section className="space-y-2 rounded-[8px] bg-[var(--app-surface-soft)] p-3">
          <h3 className="text-[11px] font-normal uppercase tracking-[0.06em] text-[var(--app-text-tertiary)]">Imóvel de interesse</h3>
          <p className="text-xs font-light text-[var(--app-text-secondary)]">O imóvel vinculado aparece no card, na agenda e nas propostas deste lead.</p>
          {renderInterestProperty()}
        </section>
      ),
      arquivos: renderAttachments(mobile),
      dados: (
        <section className="rounded-[8px] bg-[var(--app-surface-soft)]">
          <div className="flex items-center justify-between px-3 pt-3">
            <h3 className="text-[11px] font-normal uppercase tracking-[0.06em] text-[var(--app-text-tertiary)]">Ficha do lead</h3>
            {!mobile && canOperateLead && (
              <button type="button" onClick={handleOpenLeadEdit} className="lead-detail-subtle-action inline-flex h-7 items-center gap-1 rounded-[6px] bg-[var(--app-surface-solid)] px-2 text-[11px] font-light hover:text-primary">
                <FileEdit strokeWidth={1.5} className="h-3.5 w-3.5" />
                Editar
              </button>
            )}
          </div>
          <LeadProfileDetails lead={localLead} canRevealSensitive={canOperateLead} />
        </section>
      ),
      transferir: (
        <section className="space-y-3 rounded-[8px] bg-[var(--app-surface-soft)] p-3">
          <div>
            <h3 className="text-[11px] font-normal uppercase tracking-[0.06em] text-[var(--app-text-tertiary)]">Trocar responsável</h3>
            <p className="mt-1 text-xs font-light text-[var(--app-text-secondary)]">
              Hoje em {currentStageName} com {assigneeName || 'ninguém'}.{!canTransferLead && ' Você não tem permissão para transferir este lead.'}
            </p>
          </div>
          {renderAssigneePicker(mobile)}
        </section>
      ),
      origem: (
        <LeadOriginPanel
          leadFirstName={firstName}
          source={leadSource}
          createdAt={localLead.created_at}
          tracking={campaignTrackingDetails}
          trackingLoading={leadMetaQuery.isPending}
          trackingError={leadMetaQuery.isError}
          onRetryTracking={() => void leadMetaQuery.refetch()}
          historyEvents={leadHistoryQuery.data}
          historyComplete={leadHistoryQuery.historyComplete !== false}
        />
      ),
    };

    const reentryLabel = dismissedReentryAt === (lead.last_entry_at ?? null) ? null
      : describeRecentReentry(lead.reentry_count, lead.last_entry_at, detailOpenedAt);
    const reentryNotice = reentryLabel ? (
      <div role="status" className="flex items-center gap-3 rounded-[8px] bg-primary/10 px-3 py-2">
        <RotateCw strokeWidth={1.5} className="h-4 w-4 shrink-0 text-primary" />
        <p className="min-w-0 flex-1 text-xs font-light">
          <span className="font-normal">{firstName}</span> entrou de novo {reentryLabel}. O lead não foi duplicado.
        </p>
        <button type="button" onClick={() => setDetailTab('origem')} className={cn('shrink-0 rounded-[6px] bg-[var(--app-surface-solid)] px-2.5 text-xs font-light hover:text-primary', mobile ? 'h-10' : 'h-7')}>Ver origem</button>
        <button type="button" aria-label="Fechar aviso de reentrada" onClick={() => setDismissedReentryAt(lead.last_entry_at ?? null)} className={cn('flex shrink-0 items-center justify-center rounded-[6px] hover:bg-[var(--app-surface-hover)]', mobile ? 'h-10 w-10' : 'h-7 w-7')}>
          <X strokeWidth={1.5} className="h-3.5 w-3.5" />
        </button>
      </div>
    ) : null;
    const navButton = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)] transition-colors hover:bg-[var(--app-surface-hover)] disabled:opacity-40 disabled:hover:bg-[var(--app-surface-soft)]';
    const leadNavigation = !mobile && navigation ? (
      <div className="flex shrink-0 items-center gap-1.5">
        <button type="button" aria-label="Lead anterior" disabled={!navigation.onPrevious} onClick={navigation.onPrevious} className={navButton}><ChevronLeft strokeWidth={1.5} className="h-4 w-4" /></button>
        <span className="whitespace-nowrap text-xs font-light text-[var(--app-text-tertiary)]">{navigation.position} de {navigation.total} em {navigation.stageName}</span>
        <button type="button" aria-label="Próximo lead" disabled={!navigation.onNext} onClick={navigation.onNext} className={navButton}><ChevronRight strokeWidth={1.5} className="h-4 w-4" /></button>
      </div>
    ) : undefined;

    const layoutProps: LeadDetailLayoutProps = {
      leadNavigation,
      notice: reentryNotice,
      readNotice: <LeadDetailReadNotice state={detailReadState} onRetry={retryLeadRead} />,
      stageNav: (
        <LeadDetailStageNav
          stages={stages}
          activeStageId={localLead.stage_id}
          leadName={firstName}
          daysInStage={daysSince(localLead.stage_entered_at, detailOpenedAt)}
          mobile={mobile}
          disabled={!canProgressLead}
          portalClassName={portalClassName}
          needsConfirmation={(stage) => getPipelineStageOutcome(stage, stageAutomations) !== 'lost'}
          onMove={(stageId) => void handleMoveToStage(stageId)}
        />
      ),
      // The picker's open state is shared: only one instance may exist at a time.
      assignee: activeTab === 'transferir' ? (
        <div className={cn('flex min-w-0 items-center rounded-[6px] bg-[var(--app-surface-soft)] px-3 text-xs font-light text-[var(--app-text-secondary)]', mobile ? 'h-10' : 'h-8')}>
          <span className="truncate">{assigneeName || 'Sem responsável'}</span>
        </div>
      ) : renderAssigneePicker(mobile),
      closeButton: (
        <button type="button" aria-label="Fechar detalhes do lead" title="Fechar" onClick={handleCloseLeadDetail} className={cn('flex shrink-0 items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)] transition-colors hover:bg-[var(--app-surface-hover)]', mobile ? 'h-10 w-10' : 'h-8 w-8')}>
          {mobile ? <ChevronLeft strokeWidth={1.5} className="h-5 w-5" /> : <X strokeWidth={1.5} className="h-4 w-4" />}
        </button>
      ),
      scrollKey: `${activeOrganization.organizationId}:${lead.id}:${user?.id}:${panelSessionId}`,
      identity: {
        name: leadName,
        initial: getDisplayInitial(leadName),
        avatarUrl: leadAvatarUrl,
        contactLine: localLead.phone ? formatPhoneForDisplay(localLead.phone) : localLead.email || null,
        badges: (
          <>
            <ReentryBadge count={lead.reentry_count} lastEntryAt={lead.last_entry_at} />
            <QueuePoolClaimButton lead={localLead} compact disabled={fullLeadQuery.isFetching || readAccessPending} />
          </>
        ),
        copyPhone: localLead.phone ? <CopyLeadPhoneButton phone={localLead.phone} className={cn('shrink-0 bg-transparent hover:bg-[var(--app-surface-hover)]', mobile ? 'h-10 w-10' : 'h-8 w-8')} /> : null,
      },
      tiles,
      tags: renderTagList(mobile),
      status,
      quickActions,
      interestProperty: hasPropertiesModule && activeTab !== 'imoveis' ? renderInterestProperty() : null,
      contact: { rows: contactRows, onEdit: canOperateLead ? handleOpenLeadEdit : undefined },
      tabIdPrefix: mobileTabsId,
      tabs,
      activeTab,
      onTabChange: setDetailTab,
      tabActions: canManageLeadSchedule ? (
        <Button size="sm" variant="ghost" onClick={openVisitForm} className="h-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-xs font-light shadow-none">
          <Calendar strokeWidth={1.5} className="h-4 w-4" />
          Agendar visita
        </Button>
      ) : undefined,
      panel: panels[activeTab],
      panelScrolls: activeTab !== 'atividades',
    };

    return mobile ? <MobileLeadLayout {...layoutProps} /> : (
      <>
        <DialogHeader className="sr-only">
          <DialogTitle>{leadName}</DialogTitle>
          <DialogDescription>Dados, ações e histórico do lead.</DialogDescription>
        </DialogHeader>
        <DesktopLeadLayout {...layoutProps} />
      </>
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
      outcomeBlockedReason={canOperateLead ? undefined : outcomeBlockedReason}
      quickActionBlockedReason={canProgressLead ? undefined : outcomeBlockedReason}
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
      scheduleInitialOutcome={scheduleInitialOutcome}
      scheduleDefaults={scheduleDefaults}
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
              : <>{renderLeadLayout(true)}</>}
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
          </> : renderLeadLayout(false)}
        </DialogContent>
      </Dialog>
      {!detailReadState.hideDetails && overlays}
    </>
  );
}
