import { useState, useEffect, useLayoutEffect, useCallback, useId, useMemo, useRef, type ReactNode } from 'react';
import { isValidE164Phone } from '@/lib/phone-utils';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { leadAttachmentsAPI } from '@/lib/api/lead-attachments';
import { buildLeadEditFields, changedLeadFields, getLeadDraftKey, shouldInitializeLeadForm, uploadLeadFiles } from '@/lib/lead-edit-session';
import { LeadAttachmentRecovery } from '@/components/features/leads/LeadAttachmentRecovery';
import { captureLeadRequestIntent } from '@/lib/lead-request-intent';
import { getGlobalSignOutSessionId } from '@/lib/auth/global-sign-out';
import { contactImportScopeKey, createLeadImportScope } from '@/lib/lead-import-scope';
import { isDefinitiveLeadReadDenial } from '@/lib/lead-read-access';
import { requiresWonLeadFinancialReview, WON_LEAD_FINANCIAL_REVIEW_MESSAGE } from '@/components/features/leads/lead-detail/financial-review';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FormWizardLayout } from '@/components/shared/forms/FormWizardLayout';
import { FORM_WIZARD_DIALOG_CLASS_NAME, FORM_WIZARD_PRIMARY_BUTTON_CLASS_NAME, FORM_WIZARD_SECONDARY_BUTTON_CLASS_NAME } from '@/config/form-wizard';
import { LeadDraftPreview } from '@/components/features/leads/LeadDraftPreview';
import { Briefcase, Building2, FileText, Home, Loader2, User, X } from 'lucide-react';
import type { PropertyPickerProperty } from '@/components/features/properties/PropertyPickerDialog';
import { useAuth } from '@/contexts/AuthContext';
import { useOrganizationModules } from '@/hooks/use-organization-modules';
import { useUserPermissions } from '@/hooks/use-user-permissions';
import { useOrganizationUsers } from '@/hooks/use-users';
import { usePipelines, useStages } from '@/hooks/use-stages';
import { useSelectedProperties } from '@/hooks/properties/use-selected-properties';
import { useCreateLead, useLead, useLeadSensitiveProfile, useUpdateLead, type Lead } from '@/hooks/use-leads';
import { useTeams } from '@/hooks/use-teams';
import { LeadContactFields } from '@/components/features/leads/lead-form/LeadContactFields';
import { LeadProfileFields } from '@/components/features/leads/lead-form/LeadProfileFields';
import { LeadInterestFields } from '@/components/features/leads/lead-form/LeadInterestFields';
import { LeadManagementFields, dealStatusOptions } from '@/components/features/leads/lead-form/LeadManagementFields';
import { buildLeadFormData, formatCurrencyInput, isFormEmpty, parseCurrencyInput, type EditableLead, type LeadFormErrors } from '@/components/features/leads/lead-form/lead-form-data';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function removeLeadDraft(key: string | null) {
  if (!key) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
}

interface CreateLeadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultStageId?: string | null;
  defaultPipelineId?: string | null;
  contactPhone?: string | null;
  contactName?: string | null;
  conversationId?: string | null;
  expectedPreviousLeadId?: string | null;
  confirmHistoryLink?: true;
  futureOnly?: true;
  lead?: EditableLead | null;
  onSaved?: (lead: Lead) => void;
  onCreated?: (leadId: string) => void;
  accessBlocked?: boolean;
  accessPending?: boolean;
}

const MAX_PENDING_ATTACHMENTS = 10;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

function omitBasicErrors(errors: LeadFormErrors) {
  const next = { ...errors };
  delete next.name;
  delete next.contact;
  delete next.phone;
  delete next.email;
  return next;
}

export function CreateLeadDialog({
  open,
  onOpenChange,
  defaultStageId,
  defaultPipelineId,
  contactPhone,
  contactName,
  conversationId,
  expectedPreviousLeadId,
  confirmHistoryLink,
  futureOnly,
  lead: leadSummary,
  onSaved,
  onCreated,
  accessBlocked = false,
  accessPending = false,
}: CreateLeadDialogProps) {
  const { activeOrganization, profile, user, session } = useAuth();
  const [submissionScope] = useState(createLeadImportScope);
  const submissionScopeKey = open && !accessBlocked ? JSON.stringify([contactImportScopeKey(activeOrganization.organizationId, user?.id, getGlobalSignOutSessionId(session)), leadSummary?.id ?? null]) : null;
  useLayoutEffect(() => submissionScope.activate(submissionScopeKey), [submissionScope, submissionScopeKey]);
  const fieldIdPrefix = useId();
  const { hasPermission } = useUserPermissions();
  const canUploadAttachments = hasPermission('lead_operate');
  const { hasModule } = useOrganizationModules();
  const { data: allUsers = [] } = useOrganizationUsers();
  const allAssignableUsers = hasPermission('lead_operate') ? allUsers : allUsers.filter(u => u.id === profile?.id);
  const canSelectTeam = hasPermission('lead_view_all') || hasPermission('lead_view_team');
  const { data: teams = [] } = useTeams({ enabled: open && canSelectTeam });
  const hasPropertiesModule = hasModule('properties');
  const canViewProperties =
    hasPropertiesModule &&
    (hasPermission('property_view') || hasPermission('property_manage'));
  const [activeTab, setActiveTab] = useState('basic');
  const { data: pipelines = [] } = usePipelines();
  const [pickedProperties, setPickedProperties] = useState<{ organizationId: string | null | undefined; items: PropertyPickerProperty[] }>({ organizationId: activeOrganization.organizationId, items: [] });
  const createLead = useCreateLead();
  const updateLead = useUpdateLead();
  const isEditMode = Boolean(leadSummary?.id);
  const { data: persistedLead, isLoading: isLoadingPersistedLead, error: persistedLeadError } = useLead(isEditMode ? leadSummary?.id || null : null);
  const editReadDenied = isEditMode && (isDefinitiveLeadReadDenial(persistedLeadError) || persistedLead?.can_operate === false || !hasPermission('lead_operate'));
  const {
    data: sensitiveProfile,
    isLoading: isLoadingSensitiveProfile,
    isError: sensitiveProfileError,
  } = useLeadSensitiveProfile(isEditMode ? leadSummary?.id || null : null, { enabled: open && isEditMode && !editReadDenied });
  const isLoadingEditLead = isEditMode && (isLoadingPersistedLead || isLoadingSensitiveProfile);
  const editableLead = useMemo<EditableLead | null>(() => {
    if (!isEditMode || !leadSummary) return null;
    if (!persistedLead) return leadSummary;
    return {
      ...leadSummary,
      ...persistedLead,
      tags: leadSummary.tags?.length ? leadSummary.tags : persistedLead.tags,
    };
  }, [isEditMode, leadSummary, persistedLead]);

  // Form state
  const [draftRestored, setDraftRestored] = useState(false);

  const draftKey = !isEditMode ? getLeadDraftKey(user?.id, activeOrganization.organizationId, defaultPipelineId, defaultStageId) : null;

  const getEmptyFormData = useCallback(() => buildLeadFormData({
    editableLead,
    currentUserProfileId: profile?.id,
    defaultPipelineId,
    defaultStageId,
    cpf: sensitiveProfile?.cpf,
    rg: sensitiveProfile?.rg,
  }), [editableLead, profile?.id, defaultPipelineId, defaultStageId, sensitiveProfile?.cpf, sensitiveProfile?.rg]);

  const [formData, setFormData] = useState(getEmptyFormData);
  const initializedFormRef = useRef<string | null>(null);
  const editBaseFormRef = useRef(formData);
  const editBaseLeadRef = useRef<Lead | null>(null);
  const [editBaseVersion, setEditBaseVersion] = useState<Lead['updated_at']>();
  const [reloadEditOpen, setReloadEditOpen] = useState(false);
  const [attachmentRecovery, setAttachmentRecovery] = useState<{ leadId: string; files: File[]; canUpload: boolean; onFinish: () => void } | null>(null);
  const { properties: selectedProperties, isLoading: propertiesLoading } = useSelectedProperties(
    formData.interest_property_ids, canViewProperties && open,
  );
  const properties = [...new Map([...selectedProperties, ...(pickedProperties.organizationId === activeOrganization.organizationId ? pickedProperties.items : [])].map(property => [property.id, property])).values()];
  const finalTab = isEditMode ? 'interest' : 'management';
  const [pendingAttachments, setPendingAttachments] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Keep the retained lifetime pin here; extract this legacy form's submission controller into hooks/leads separately.
  const submissionAttemptRef = useRef<object | null>(null);
  const submissionMountedRef = useRef(false);
  useLayoutEffect(() => {
    submissionMountedRef.current = true;
    return () => { submissionMountedRef.current = false; };
  }, []);
  const selectedTeam = teams.find((team) => team.id === formData.team_id);
  const selectedTeamUserIds = new Set((selectedTeam?.members || []).map((member) => member.user_id));
  const users = formData.team_id
    ? allAssignableUsers.filter((user) => selectedTeamUserIds.has(user.id))
    : allAssignableUsers;
  const [errors, setErrors] = useState<LeadFormErrors>({});
  const [dialogPosition, setDialogPosition] = useState({ x: 0, y: 0 });
  const dialogContentRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const dialogPositionRef = useRef({ x: 0, y: 0 });
  const dragFrameRef = useRef<number | null>(null);
  const suppressOutsideCloseUntilRef = useRef(0);

  // Get stages for selected pipeline
  const { data: stages = [] } = useStages(formData.pipeline_id || undefined);

  // Save draft to localStorage with debounce
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!open || !draftKey) return;

    if (isFormEmpty(formData)) {
      removeLeadDraft(draftKey);
      return;
    }

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(draftKey, JSON.stringify({ formData, activeTab }));
      } catch { /* quota exceeded - ignore */ }
    }, 500);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [formData, activeTab, open, draftKey]);

  // Restore draft or reset form when dialog opens
  /* eslint-disable react-hooks/set-state-in-effect -- Syncs the controlled dialog opening with local draft form state. */
  useEffect(() => {
    if (!open) { initializedFormRef.current = null; return; }
    const identity = `${activeOrganization.organizationId}:${user?.id}:${leadSummary?.id || 'new'}:${draftKey || ''}:${conversationId || ''}`;
    const ready = isEditMode ? !isLoadingEditLead && !!persistedLead : pipelines.length > 0;
    if (!shouldInitializeLeadForm(initializedFormRef.current, identity, ready)) return;
    initializedFormRef.current = identity;
    setAttachmentRecovery(null);
    if (open) {
      setDraftRestored(false);
      setErrors({});
      setDialogPosition({ x: 0, y: 0 });
      dialogPositionRef.current = { x: 0, y: 0 };

      if (isEditMode) {
        if (isLoadingEditLead || !editableLead) return;
        const initial = getEmptyFormData();
        editBaseFormRef.current = initial;
        editBaseLeadRef.current = persistedLead ?? null;
        setEditBaseVersion(persistedLead?.updated_at);
        setPendingAttachments([]);
        setFormData(initial);
        setActiveTab('basic');
        return;
      }

      if (contactPhone || contactName || conversationId) {
        const defaultPipeline = pipelines.find(p => p.is_default) || pipelines[0];
        setFormData({
          ...getEmptyFormData(),
          name: contactName || '',
          phone: contactPhone || '',
          conversation_id: conversationId || '',
          source: 'whatsapp',
          pipeline_id: defaultPipelineId || defaultPipeline?.id || '',
          stage_id: defaultStageId || '',
        });
        setActiveTab('basic');
        return;
      }

      if (draftKey) {
        try {
          const saved = localStorage.getItem(draftKey);
          if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed.formData && !isFormEmpty(parsed.formData)) {
              // A draft from a previous WhatsApp flow cannot restore a binding
              // into an ordinary lead creation without a fresh confirmation.
              setFormData({ ...getEmptyFormData(), ...parsed.formData, conversation_id: '' });
              if (parsed.activeTab) setActiveTab(parsed.activeTab);
              setDraftRestored(true);
              return;
            }
          }
        } catch { /* corrupted data - ignore */ }
      }

      setActiveTab('basic');
      const defaultPipeline = pipelines.find(p => p.is_default) || pipelines[0];
      setFormData({
        ...getEmptyFormData(),
        pipeline_id: defaultPipelineId || defaultPipeline?.id || '',
        stage_id: defaultStageId || '',
      });
    }
  }, [open, pipelines, defaultStageId, defaultPipelineId, draftKey, getEmptyFormData, contactPhone, contactName, conversationId, isEditMode, isLoadingEditLead, editableLead, persistedLead, activeOrganization.organizationId, user?.id, leadSummary?.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const discardDraft = useCallback(() => {
    if (submissionAttemptRef.current || isSubmitting) return;
    removeLeadDraft(draftKey);
    setPendingAttachments([]);
    setDraftRestored(false);
    setActiveTab('basic');
    setErrors({});
    const defaultPipeline = pipelines.find(p => p.is_default) || pipelines[0];
    setFormData({
      ...getEmptyFormData(),
      pipeline_id: defaultPipelineId || defaultPipeline?.id || '',
      stage_id: defaultStageId || '',
    });
  }, [draftKey, pipelines, defaultPipelineId, defaultStageId, getEmptyFormData, isSubmitting, setPendingAttachments, setErrors]);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen && (submissionAttemptRef.current || isSubmitting)) return;
    if (!nextOpen && attachmentRecovery) { attachmentRecovery.onFinish(); return; }
    if (!nextOpen && draftKey && !isFormEmpty(formData)) {
      try {
        localStorage.setItem(draftKey, JSON.stringify({ formData, activeTab }));
      } catch { /* quota exceeded - ignore */ }
    }

    onOpenChange(nextOpen);
  }, [activeTab, draftKey, formData, onOpenChange, isSubmitting, attachmentRecovery]);

  // Prevent accidental close on backdrop click when form has data
  const handleInteractOutside = useCallback((e: Event) => {
    if (dragStateRef.current || Date.now() < suppressOutsideCloseUntilRef.current || !isFormEmpty(formData) || pendingAttachments.length > 0) {
      e.preventDefault();
    }
  }, [formData, pendingAttachments.length]);

  const handleDragStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    suppressOutsideCloseUntilRef.current = Date.now() + 1000;

    dragStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: dialogPositionRef.current.x,
      originY: dialogPositionRef.current.y,
    };

    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const clampDialogPosition = useCallback((position: { x: number; y: number }) => {
    const dialog = dialogContentRef.current;
    if (!dialog) return position;

    const margin = 12;
    const rect = dialog.getBoundingClientRect();
    const maxX = Math.max(0, window.innerWidth / 2 - rect.width / 2 - margin);
    const maxY = Math.max(0, window.innerHeight / 2 - rect.height / 2 - margin);

    return {
      x: Math.min(maxX, Math.max(-maxX, position.x)),
      y: Math.min(maxY, Math.max(-maxY, position.y)),
    };
  }, []);

  const handleDragMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState) return;

    if ((event.buttons & 1) === 0) {
      dragStateRef.current = null;
      suppressOutsideCloseUntilRef.current = Date.now() + 250;
      setDialogPosition(dialogPositionRef.current);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      return;
    }

    dialogPositionRef.current = clampDialogPosition({
      x: dragState.originX + event.clientX - dragState.startX,
      y: dragState.originY + event.clientY - dragState.startY,
    });

    if (dragFrameRef.current) return;

    dragFrameRef.current = window.requestAnimationFrame(() => {
      dragFrameRef.current = null;
      if (!dialogContentRef.current) return;

      const { x, y } = dialogPositionRef.current;
      dialogContentRef.current.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
    });
  }, [clampDialogPosition]);

  const handleDragEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    dragStateRef.current = null;
    suppressOutsideCloseUntilRef.current = Date.now() + 250;
    setDialogPosition(dialogPositionRef.current);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  // Update stage when pipeline changes
  useEffect(() => {
    if (submissionAttemptRef.current || isSubmitting) return;
    if (formData.pipeline_id && stages.length > 0 && !formData.stage_id) {
      setFormData(prev => submissionAttemptRef.current || isSubmitting ? prev : ({ ...prev, stage_id: stages[0].id }));
    }
  }, [formData.pipeline_id, formData.stage_id, stages, isSubmitting]);

  useEffect(() => {
    return () => {
      if (dragFrameRef.current) {
        window.cancelAnimationFrame(dragFrameRef.current);
      }
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (accessBlocked || accessPending || submissionAttemptRef.current || isSubmitting || attachmentRecovery || editReadDenied) return;
    const isCurrentSubmission = submissionScope.capture(submissionScopeKey);
    if (!isCurrentSubmission()) return;

    if (activeTab === 'basic') {
      if (validateBasicStep()) setActiveTab('profile');
      return;
    }

    if (activeTab === 'profile') {
      if (validateProfileStep()) setActiveTab('interest');
      return;
    }

    if (activeTab === 'interest' && !isEditMode) {
      setActiveTab('management');
      return;
    }

    if (!validateBasicStep()) return;
    if (!validateProfileStep()) return;
    if (!isEditMode && !validateManagementStep()) return;
    if (isEditMode && sensitiveProfileError) {
      toast.error('Não foi possível carregar CPF e RG com segurança. Reabra o formulário e tente novamente.');
      return;
    }
    if (isEditMode && !editBaseLeadRef.current?.updated_at) {
      toast.error('Não foi possível confirmar a versão atual do contato. Reabra a edição.');
      return;
    }
    const editChanges = isEditMode ? changedLeadFields(buildLeadEditFields(editBaseFormRef.current, parseCurrencyInput), buildLeadEditFields(formData, parseCurrencyInput)) : null;
    if (isEditMode && editBaseLeadRef.current && Object.keys(editChanges || {}).length === 0 && pendingAttachments.length === 0) {
      onSaved?.(editBaseLeadRef.current);
      onOpenChange(false);
      return;
    }

    const submittedEditBaseLead = isEditMode && editBaseLeadRef.current ? { ...editBaseLeadRef.current } : null;
    const submissionAttempt = {};
    submissionAttemptRef.current = submissionAttempt;
    setIsSubmitting(true);
    try {
      const requestIntent = captureLeadRequestIntent(user?.id, getGlobalSignOutSessionId(session));
      const initialFeedback = formData.feedback.trim() || (!isEditMode ? formData.message.trim() : '');
      const primaryPropertyId = formData.interest_property_ids[0] || formData.property_id || null;
      const profileInput = {
        personType: formData.person_type,
        gender: formData.gender || undefined,
        socialName: formData.social_name || undefined,
        birthDate: formData.birth_date || undefined,
        cpf: formData.cpf || undefined,
        rg: formData.rg || undefined,
        cnpj: formData.cnpj || undefined,
        corporateName: formData.corporate_name || undefined,
        tradeName: formData.trade_name || undefined,
        stateRegistration: formData.state_registration || undefined,
      };

      const savedResult = isEditMode && editableLead
        ? Object.keys(editChanges || {}).length === 0 ? editBaseLeadRef.current! : await updateLead.mutateAsync({
          id: editableLead.id,
          ...editChanges,
          expectedUpdatedAt: editBaseLeadRef.current?.updated_at,
        })
        : await createLead.mutateAsync({
          name: formData.name,
          phone: formData.phone || undefined,
          email: formData.email || undefined,
          message: initialFeedback || undefined,
          feedback: initialFeedback || undefined,
          pipeline_id: formData.pipeline_id || undefined,
          stage_id: formData.stage_id || undefined,
          assigned_user_id: formData.assigned_user_id || undefined,
          team_id: formData.team_id || undefined,
          tag_ids: formData.tag_ids.length > 0 ? formData.tag_ids : undefined,
          source: formData.source || 'manual',
          conversation_id: formData.conversation_id || undefined,
          expected_previous_lead_id: formData.conversation_id
            ? expectedPreviousLeadId || undefined
            : undefined,
          confirm_history_link: formData.conversation_id
            ? confirmHistoryLink
            : undefined,
          future_only: formData.conversation_id ? futureOnly : undefined,
          cargo: formData.cargo || undefined,
          empresa: formData.empresa || undefined,
          profissao: formData.profissao || undefined,
          renda_familiar: formData.renda_familiar || undefined,
          valor_interesse: parseCurrencyInput(formData.valor_interesse),
          property_id: primaryPropertyId || undefined,
          interest_property_ids: formData.interest_property_ids.length > 0 ? formData.interest_property_ids : undefined,
          deal_status: formData.deal_status || 'open',
          lost_reason: formData.deal_status === 'lost' ? formData.lost_reason || undefined : undefined,
          profile: profileInput,
        });

      const savedLead = 'lead' in savedResult ? savedResult.lead : savedResult;
      if (!isCurrentSubmission()) return;
      const canUploadSavedLead = canUploadAttachments && savedLead?.can_operate === true;
      const failedFiles = canUploadSavedLead ? await uploadLeadFiles(pendingAttachments, (file) => leadAttachmentsAPI.upload(savedResult.id, file, activeOrganization.organizationId, requestIntent), isCurrentSubmission) : pendingAttachments;
      if (!isCurrentSubmission()) return;
      if (failedFiles.length > 0) {
        toast.warning(`Lead ${isEditMode ? 'atualizado' : 'criado'}, mas ${failedFiles.length} documento(s) não foram enviados.`);
      } else if (pendingAttachments.length > 0) {
        toast.success(`${pendingAttachments.length} documento(s) anexado(s).`);
      }

      // Clear draft on success
      removeLeadDraft(draftKey);
      setPendingAttachments(failedFiles);
      setDraftRestored(false);
      setErrors({});
      if (isEditMode) {
        if (submittedEditBaseLead && savedLead && requiresWonLeadFinancialReview(submittedEditBaseLead, savedLead)) {
          toast.warning(WON_LEAD_FINANCIAL_REVIEW_MESSAGE);
        } else toast.success('Lead atualizado com sucesso!');
      }
      let finished = false;
      const finish = () => {
        if (finished || !isCurrentSubmission()) return;
        finished = true;
        setAttachmentRecovery(null);
        setPendingAttachments([]);
        if (savedLead) onSaved?.(savedLead as Lead);
        if (!isEditMode) onCreated?.(savedResult.id);
        onOpenChange(false);
      };
      if (failedFiles.length > 0) {
        setAttachmentRecovery({ leadId: savedResult.id, files: failedFiles, canUpload: canUploadSavedLead, onFinish: finish });
      } else finish();
    } catch {
      // Error handled by mutation
    } finally {
      if (submissionAttemptRef.current === submissionAttempt) {
        submissionAttemptRef.current = null;
        if (submissionMountedRef.current) setIsSubmitting(false);
      }
    }
  };

  const updateField = <K extends keyof typeof formData>(field: K, value: (typeof formData)[K]) => {
    if (submissionAttemptRef.current || isSubmitting) return;
    setFormData(prev => submissionAttemptRef.current || isSubmitting ? prev : ({ ...prev, [field]: value }));
    setErrors(prev => {
      if (submissionAttemptRef.current || isSubmitting) return prev;
      let changed = false;
      const next = { ...prev };
      const remove = (key: keyof LeadFormErrors) => {
        if (next[key]) {
          delete next[key];
          changed = true;
        }
      };

      if (field === 'name') remove('name');
      if (field === 'phone') {
        remove('phone');
        remove('contact');
      }
      if (field === 'email') {
        remove('email');
        remove('contact');
      }
      if (field === 'cpf') remove('cpf');
      if (field === 'cnpj') remove('cnpj');
      if (field === 'birth_date') remove('birth_date');
      if (field === 'assigned_user_id') remove('assigned_user_id');
      if (field === 'pipeline_id') {
        remove('pipeline_id');
        remove('stage_id');
      }
      if (field === 'stage_id') remove('stage_id');
      if (field === 'lost_reason' || field === 'deal_status') remove('lost_reason');

      return changed ? next : prev;
    });
  };

  const handleStepChange = (step: string) => {
    if (submissionAttemptRef.current || isSubmitting) return;
    setActiveTab(step);
  };

  // React capture also covers selectors rendered in portals outside the fieldset.
  const handleDraftInteractionCapture = (event: React.SyntheticEvent) => {
    if (!submissionAttemptRef.current && !isSubmitting) return;
    if (event.type === 'keydown' && ['Tab', 'Escape'].includes((event as React.KeyboardEvent).key)) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const hasValidPhone = !formData.phone || isValidE164Phone(formData.phone);
  const hasValidEmail = !formData.email.trim() || EMAIL_REGEX.test(formData.email.trim());
  const hasContactChannel = (!!formData.phone && hasValidPhone) || (!!formData.email.trim() && hasValidEmail);
  const hasRequiredLeadIdentity = !!formData.name.trim() && hasContactChannel;
  const hasRequiredManagement = !!formData.assigned_user_id
    && !!formData.pipeline_id
    && !!formData.stage_id
    && (formData.deal_status !== 'lost' || !!formData.lost_reason.trim());
  const selectedInterestProperties = formData.interest_property_ids
    .map((propertyId) => properties.find((property) => property.id === propertyId))
    .filter((property): property is NonNullable<typeof property> => Boolean(property));
  const handleAttachmentSelection = (files: FileList | null) => {
    if (submissionAttemptRef.current || isSubmitting || !files || !canUploadAttachments) return;
    const incoming = Array.from(files);
    const oversized = incoming.filter((file) => file.size > MAX_ATTACHMENT_BYTES);
    if (oversized.length > 0) {
      toast.error('Cada documento pode ter no máximo 25 MB.');
    }

    setPendingAttachments((current) => {
      if (submissionAttemptRef.current || isSubmitting) return current;
      const keys = new Set(current.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
      const valid = incoming.filter((file) => file.size <= MAX_ATTACHMENT_BYTES && !keys.has(`${file.name}:${file.size}:${file.lastModified}`));
      const next = [...current, ...valid].slice(0, MAX_PENDING_ATTACHMENTS);
      if (current.length + valid.length > MAX_PENDING_ATTACHMENTS) {
        toast.warning(`Você pode anexar até ${MAX_PENDING_ATTACHMENTS} documentos por cadastro.`);
      }
      return next;
    });
  };

  const handleRemoveProperty = (property: PropertyPickerProperty) => {
    if (submissionAttemptRef.current || isSubmitting) return;
    setFormData((previous) => {
      if (submissionAttemptRef.current || isSubmitting) return previous;
      const nextIds = previous.interest_property_ids.filter((id) => id !== property.id);
      const nextPrimary = properties.find((candidate) => candidate.id === nextIds[0]);
      return {
        ...previous,
        interest_property_ids: nextIds,
        property_id: nextIds[0] || '',
        valor_interesse: previous.property_id === property.id
          ? (nextPrimary?.preco != null ? formatCurrencyInput(nextPrimary.preco) : '')
          : previous.valor_interesse,
      };
    });
  };

  const handleSelectProperty = (property: PropertyPickerProperty) => {
    if (submissionAttemptRef.current || isSubmitting) return;
    setPickedProperties(previous => submissionAttemptRef.current || isSubmitting ? previous : ({
      organizationId: activeOrganization.organizationId,
      items: [
        ...(previous.organizationId === activeOrganization.organizationId ? previous.items.filter(item => item.id !== property.id) : []),
        property,
      ],
    }));
    setFormData((previous) => {
      if (submissionAttemptRef.current || isSubmitting) return previous;
      if (previous.interest_property_ids.includes(property.id)) return previous;
      const nextIds = [...previous.interest_property_ids, property.id];
      const becomesPrimary = !previous.property_id;
      return {
        ...previous,
        interest_property_ids: nextIds,
        property_id: previous.property_id || property.id,
        valor_interesse: becomesPrimary
          ? (property.preco != null ? formatCurrencyInput(property.preco) : '')
          : previous.valor_interesse,
      };
    });
  };

  const handleRemoveAttachment = (file: File) => {
    if (submissionAttemptRef.current || isSubmitting) return;
    setPendingAttachments((current) => submissionAttemptRef.current || isSubmitting ? current : current.filter((item) => item !== file));
  };

  const handleScopeChange = (value: string) => {
    if (submissionAttemptRef.current || isSubmitting) return;
    const nextTeamId = value === 'personal' ? '' : value;
    const nextTeam = teams.find((team) => team.id === nextTeamId);
    const memberIds = new Set((nextTeam?.members || []).map((member) => member.user_id));
    const currentAssigneeIsValid = !nextTeamId || memberIds.has(formData.assigned_user_id);
    const fallbackAssignee = allAssignableUsers.find((user) => memberIds.has(user.id))?.id || '';
    setFormData((previous) => submissionAttemptRef.current || isSubmitting ? previous : ({
      ...previous,
      team_id: nextTeamId,
      assigned_user_id: currentAssigneeIsValid ? previous.assigned_user_id : fallbackAssignee,
    }));
  };

  const leadDialogSurfaceClass = cn(
    isEditMode
      ? cn(FORM_WIZARD_DIALOG_CLASS_NAME, "!max-w-[1440px] !w-[calc(100vw-24px)]")
      : "!h-auto max-h-[88dvh] !w-[min(96vw,720px)] !max-w-[720px] rounded-[8px] bg-[var(--app-surface)] shadow-none",
    "!left-1/2 !right-auto !top-1/2 !bottom-auto !border-0 !p-0 text-[var(--app-text-primary)]",
    "!duration-0 !transition-none flex flex-col overflow-hidden will-change-transform",
    "data-[state=open]:!animate-none data-[state=closed]:!animate-none data-[state=closed]:!slide-out-to-right data-[state=open]:!slide-in-from-right",
    "[&_label]:text-[12px] [&_label]:font-light [&_label]:text-[var(--app-text-secondary)]",
    "[&_input]:h-10 [&_input]:border-0 [&_input]:bg-[var(--app-surface-soft)] [&_input]:text-[var(--app-text-primary)] [&_input]:placeholder:text-[var(--app-text-tertiary)] [&_input]:shadow-none [&_input]:ring-0",
    "[&_textarea]:border-0 [&_textarea]:bg-[var(--app-surface-soft)] [&_textarea]:text-[var(--app-text-primary)] [&_textarea]:placeholder:text-[var(--app-text-tertiary)] [&_textarea]:shadow-none [&_textarea]:ring-0",
    "[&_button[role=combobox]]:h-10 [&_button[role=combobox]]:border-0 [&_button[role=combobox]]:bg-[var(--app-surface-soft)] [&_button[role=combobox]]:text-[var(--app-text-primary)] [&_button[role=combobox]]:shadow-none",
    "[&_[data-radix-collection-item]]:text-sm",
    "[&_input:focus-visible]:ring-1 [&_input:focus-visible]:ring-primary/70",
    "[&_textarea:focus-visible]:ring-1 [&_textarea:focus-visible]:ring-primary/70",
    "[&_button[role=combobox]:focus-visible]:ring-1 [&_button[role=combobox]:focus-visible]:ring-primary/70",
  );

  const validateBasicStep = () => {
    const nextErrors: LeadFormErrors = {};

    if (!formData.name.trim()) {
      nextErrors.name = 'Informe o nome do lead';
    }

    if (!formData.phone && !formData.email.trim()) {
      nextErrors.contact = 'Informe pelo menos um telefone ou email';
    }

    if (formData.phone && !hasValidPhone) {
      nextErrors.phone = 'Telefone inválido. Informe DDI + DDD + número (ex.: +55 11 99999-9999).';
    }

    if (formData.email.trim() && !hasValidEmail) {
      nextErrors.email = 'E-mail inválido. Use o formato nome@dominio.com';
    }

    const firstError = nextErrors.name || nextErrors.contact || nextErrors.phone || nextErrors.email;
    if (firstError) {
      setErrors(prev => ({ ...omitBasicErrors(prev), ...nextErrors }));
      toast.error(firstError);
      setActiveTab('basic');
      return false;
    }

    setErrors(prev => omitBasicErrors(prev));
    return true;
  };

  const validateProfileStep = () => {
    const nextErrors: LeadFormErrors = {};
    const cpfDigits = formData.cpf.replace(/\D/g, '');
    const cnpjDigits = formData.cnpj.replace(/\D/g, '');

    if (formData.person_type === 'individual' && formData.cpf && cpfDigits.length !== 11) {
      nextErrors.cpf = 'CPF incompleto';
    }
    if (formData.person_type === 'company' && formData.cnpj && cnpjDigits.length !== 14) {
      nextErrors.cnpj = 'CNPJ incompleto';
    }
    if (formData.birth_date) {
      const birthDate = new Date(`${formData.birth_date}T00:00:00`);
      if (Number.isNaN(birthDate.getTime()) || birthDate > new Date()) {
        nextErrors.birth_date = 'Data de nascimento inválida';
      }
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors((previous) => ({ ...previous, ...nextErrors }));
      toast.error(Object.values(nextErrors)[0]);
      setActiveTab('profile');
      return false;
    }

    setErrors((previous) => {
      const next = { ...previous };
      delete next.cpf;
      delete next.cnpj;
      delete next.birth_date;
      return next;
    });
    return true;
  };

  const validateManagementStep = () => {
    if (!formData.assigned_user_id) {
      toast.error('Selecione o responsável');
      setActiveTab('management');
      return false;
    }

    if (!formData.pipeline_id) {
      toast.error('Selecione a pipeline');
      setActiveTab('management');
      return false;
    }

    if (!formData.stage_id) {
      toast.error('Selecione o estágio');
      setActiveTab('management');
      return false;
    }

    if (formData.deal_status === 'won' && !hasPermission('lead_operate')) {
      toast.error('Seu perfil não possui permissão para registrar um negócio ganho.');
      setActiveTab('management');
      return false;
    }

    if (formData.deal_status === 'lost' && !formData.lost_reason.trim()) {
      setErrors((previous) => ({ ...previous, lost_reason: 'Informe o motivo da perda' }));
      toast.error('Informe o motivo da perda');
      setActiveTab('management');
      return false;
    }

    return true;
  };

  const handleFormKeyDown = (e: React.KeyboardEvent<HTMLFormElement>) => {
    if (e.key !== 'Enter' || e.defaultPrevented) return;
    if (submissionAttemptRef.current || isSubmitting) { e.preventDefault(); return; }
    if (activeTab === finalTab) return;

    const target = e.target as HTMLElement;
    if (
      target.tagName === 'TEXTAREA'
      || target.tagName === 'BUTTON'
      || target.closest('[role="combobox"]')
    ) {
      return;
    }

    e.preventDefault();

    if (activeTab === 'basic') {
      if (validateBasicStep()) setActiveTab('profile');
      return;
    }

    if (activeTab === 'profile') {
      if (validateProfileStep()) setActiveTab('interest');
      return;
    }

    if (activeTab === 'interest' && !isEditMode) {
      setActiveTab('management');
    }
  };

  // Preserve form/attachment state in memory while Pipeline revalidates, without rendering private data.
  if (accessBlocked) return null;

  const formSteps = [
    { id: 'basic', label: 'Contato', icon: User, disabled: isSubmitting, tourId: 'lead-form-tab-basic', buttonId: `${fieldIdPrefix}-tab-basic`, panelId: `${fieldIdPrefix}-panel-basic` },
    { id: 'profile', label: 'Pessoa', icon: Briefcase, disabled: isSubmitting, tourId: 'lead-form-tab-profile', buttonId: `${fieldIdPrefix}-tab-profile`, panelId: `${fieldIdPrefix}-panel-profile` },
    { id: 'interest', label: 'Interesse', icon: Home, disabled: isSubmitting, tourId: 'lead-form-tab-interest', buttonId: `${fieldIdPrefix}-tab-interest`, panelId: `${fieldIdPrefix}-panel-interest` },
    ...(!isEditMode ? [{ id: 'management', label: 'Gestão', icon: Building2, disabled: isSubmitting, tourId: 'lead-form-tab-management', buttonId: `${fieldIdPrefix}-tab-management`, panelId: `${fieldIdPrefix}-panel-management` }] : []),
  ];
  const editPanelLink = (step: string) => isEditMode
    ? { id: `${fieldIdPrefix}-panel-${step}`, 'aria-labelledby': `${fieldIdPrefix}-tab-${step}` }
    : {};
  const createPrimaryButtonClassName = "h-10 rounded-[6px] bg-primary text-[12px] font-light text-primary-foreground shadow-none hover:bg-primary/90 disabled:opacity-40";
  const formActions = (
    <>
      <Button type="button" className={isEditMode
        ? FORM_WIZARD_SECONDARY_BUTTON_CLASS_NAME
        : "h-10 border-0 bg-[var(--app-surface-soft)] text-[var(--app-text-primary)] hover:bg-[var(--app-surface-hover)]"} disabled={isSubmitting} onClick={() => {
        if (submissionAttemptRef.current || isSubmitting) return;
        if (!isEditMode || activeTab === 'basic') handleOpenChange(false);
        else if (activeTab === 'profile') setActiveTab('basic');
        else if (activeTab === 'interest') setActiveTab('profile');
        else setActiveTab('interest');
      }}>
        {!isEditMode || activeTab === 'basic' ? 'Cancelar' : 'Voltar'}
      </Button>
      {activeTab !== finalTab ? <Button
        key="btn-avancar"
        type="button"
        className={isEditMode ? FORM_WIZARD_PRIMARY_BUTTON_CLASS_NAME : createPrimaryButtonClassName}
        disabled={isSubmitting || isLoadingEditLead}
        onClick={() => {
          if (submissionAttemptRef.current || isSubmitting) return;
          if (activeTab === 'basic' && validateBasicStep()) setActiveTab('profile');
          else if (activeTab === 'profile' && validateProfileStep()) setActiveTab('interest');
          else if (activeTab === 'interest' && !isEditMode) setActiveTab('management');
        }}
      >Avançar</Button> : <Button
        key="btn-submit"
        data-tour="lead-form-submit"
        type="submit"
        className={isEditMode ? FORM_WIZARD_PRIMARY_BUTTON_CLASS_NAME : createPrimaryButtonClassName}
        disabled={accessPending || isSubmitting || isLoadingEditLead || sensitiveProfileError || !hasRequiredLeadIdentity || (!isEditMode && !hasRequiredManagement)}
      >
        {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {isSubmitting ? isEditMode ? 'Salvando...' : 'Criando...' : isEditMode ? 'Salvar alterações' : 'Criar Lead'}
      </Button>}
    </>
  );

  const renderFormLayout = (fields: ReactNode) => {
    if (!isEditMode) {
      return (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="px-6 pb-4 pt-3">{fields}</div>
          </div>
          <div className="grid shrink-0 grid-cols-[2fr_3fr] gap-2 px-6 pb-6 pt-3">{formActions}</div>
        </>
      );
    }

    return (
      <FormWizardLayout
        navTourId="lead-form-tabs"
        steps={formSteps}
        activeStep={activeTab}
        onStepChange={handleStepChange}
        asideTitle="Card do lead"
        aside={<LeadDraftPreview
          name={formData.name}
          phone={formData.phone}
          email={formData.email}
          personType={formData.person_type}
          corporateName={formData.corporate_name}
          profileSummary={[
            ...(formData.person_type === 'individual' ? [
              { label: 'Nome social', value: formData.social_name },
              { label: 'Profissão', value: formData.profissao },
              { label: 'Renda', value: formData.renda_familiar },
            ] : [{ label: 'Nome fantasia', value: formData.trade_name }]),
            { label: 'Cargo', value: formData.cargo },
            { label: 'Empresa', value: formData.empresa },
          ]}
          tagCount={formData.tag_ids.length}
          source={formData.source}
          feedback={formData.feedback}
          value={formData.valor_interesse}
          properties={canViewProperties ? selectedInterestProperties : []}
          interestCount={canViewProperties ? formData.interest_property_ids.length : 0}
          pipeline={pipelines.find((pipeline) => pipeline.id === formData.pipeline_id)?.name || ''}
          stage={stages.find((stage) => stage.id === formData.stage_id)?.name || ''}
          team={canSelectTeam ? selectedTeam?.name || (formData.team_id ? '' : 'Pessoal') : ''}
          assignee={allAssignableUsers.find((user) => user.id === formData.assigned_user_id)?.name || ''}
          dealStatus={dealStatusOptions.find((option) => option.value === formData.deal_status)?.label || 'Aberto'}
          lostReason={formData.deal_status === 'lost' ? formData.lost_reason : ''}
          attachmentNames={pendingAttachments.map((file) => file.name)}
          isEditMode={isEditMode}
        />}
        footer={<div className="flex w-full items-center justify-end gap-2">{formActions}</div>}
      >
        {fields}
      </FormWizardLayout>
    );
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        data-tour="pipeline-new-lead"
        ref={dialogContentRef}
        side="right"
        className={leadDialogSurfaceClass}
        overlayClassName="!bg-black/18"
        onInteractOutside={handleInteractOutside}
        style={{
          transform: `translate(calc(-50% + ${dialogPosition.x}px), calc(-50% + ${dialogPosition.y}px))`,
        }}
      >
        <SheetHeader
          className="shrink-0 cursor-move select-none px-6 pb-0 pt-5"
          onPointerDown={handleDragStart}
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
          onPointerCancel={handleDragEnd}
        >
          <SheetTitle className="flex items-center gap-2 pr-9 text-[14px] font-normal text-[var(--app-text-primary)]">
            <User className="h-4 w-4 text-primary" />
            <span>{isEditMode ? 'Editar Lead' : 'Novo Lead'}</span>
          </SheetTitle>
        </SheetHeader>

        {isEditMode && isLoadingEditLead && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-[var(--app-surface)]/95">
            <div className="flex items-center gap-2 text-sm text-[var(--app-text-secondary)]">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              Carregando dados do lead...
            </div>
          </div>
        )}

        {isEditMode && editBaseVersion !== undefined && persistedLead?.updated_at !== editBaseVersion && !attachmentRecovery && <div role="status" className="mx-6 mt-2 flex flex-wrap items-center justify-between gap-2 rounded-[8px] bg-[var(--app-surface-soft)] px-3 py-2 text-sm">
          <span>O contato recebeu uma atualização. Sua edição foi preservada.</span>
          <Button type="button" variant="outline" disabled={isSubmitting} onClick={() => {
            if (!submissionAttemptRef.current && !isSubmitting) setReloadEditOpen(true);
          }}>Recarregar dados atuais</Button>
        </div>}
        {/* Draft restored banner */}
        {draftRestored && (
          <div className="mx-6 mt-2 flex items-center justify-between gap-2 rounded-[8px] bg-[var(--app-surface-soft)] px-3 py-2">
            <div className="flex items-center gap-2 text-sm text-[var(--app-text-secondary)]">
              <FileText className="h-4 w-4 flex-shrink-0" />
              <span>Rascunho restaurado</span>
            </div>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={discardDraft}
              className="flex items-center gap-1 text-[12px] font-light text-primary hover:text-primary/80"
            >
              <X className="h-3 w-3" />
              Descartar
            </button>
          </div>
        )}

        {editReadDenied ? <div role="alert" className="p-6 text-sm">Você não pode mais editar este contato ou ele foi excluído. Feche a edição e atualize a lista.</div> : attachmentRecovery ? <LeadAttachmentRecovery {...attachmentRecovery} canUpload={attachmentRecovery.canUpload && canUploadAttachments} onRunningChange={setIsSubmitting} /> : <form onSubmit={handleSubmit} onKeyDown={handleFormKeyDown} aria-busy={isSubmitting} onPointerDownCapture={handleDraftInteractionCapture} onClickCapture={handleDraftInteractionCapture} onChangeCapture={handleDraftInteractionCapture} onKeyDownCapture={handleDraftInteractionCapture} className="flex flex-col flex-1 min-h-0">
          {renderFormLayout(
              <fieldset disabled={isSubmitting} className="m-0 min-w-0 border-0 p-0">
              <Tabs value={activeTab} onValueChange={handleStepChange} className="w-full">
                {!isEditMode && (
                  <TabsList aria-label="Etapas do formulário" data-tour="lead-form-tabs" className="mb-5 grid h-8 w-full grid-cols-4 rounded-[8px] bg-[var(--app-surface-soft)] p-1">
                    {formSteps.map((step) => (
                      <TabsTrigger key={step.id} value={step.id} disabled={step.disabled} data-tour={step.tourId} className="mx-0 h-6 rounded-[6px] px-1 text-[12px] font-light text-[var(--app-text-secondary)] shadow-none data-[state=active]:bg-[var(--app-surface-solid)] data-[state=active]:text-[var(--app-text-primary)] data-[state=active]:shadow-none">
                        {step.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                )}

                {/* Basic Info Tab */}
                <TabsContent {...editPanelLink('basic')} data-tour="lead-form-basic" value="basic" className="space-y-4 mt-0">
                  <LeadContactFields
                    formData={formData}
                    errors={errors}
                    fieldIdPrefix={fieldIdPrefix}
                    sourceKey={`${editableLead?.id || 'new'}-${open ? 'open' : 'closed'}`}
                    isSubmitting={isSubmitting}
                    updateField={updateField}
                  />
                </TabsContent>

                {/* Profile/Contract Tab */}
                <TabsContent {...editPanelLink('profile')} data-tour="lead-form-profile" value="profile" className="mt-0 space-y-5">
                  <LeadProfileFields formData={formData} errors={errors} isSubmitting={isSubmitting} updateField={updateField} />
                </TabsContent>

                <TabsContent {...editPanelLink('interest')} data-tour="lead-form-interest" value="interest" className="mt-0 space-y-5">
                  <LeadInterestFields
                    interestValue={formData.valor_interesse}
                    updateField={updateField}
                    isSubmitting={isSubmitting}
                    hasPropertiesModule={hasPropertiesModule}
                    canViewProperties={canViewProperties}
                    propertiesLoading={propertiesLoading}
                    selectedInterestProperties={selectedInterestProperties}
                    properties={properties}
                    onSelectProperty={handleSelectProperty}
                    onRemoveProperty={handleRemoveProperty}
                    isEditMode={isEditMode}
                    fieldIdPrefix={fieldIdPrefix}
                    canUploadAttachments={canUploadAttachments}
                    pendingAttachments={pendingAttachments}
                    onSelectAttachments={handleAttachmentSelection}
                    onRemoveAttachment={handleRemoveAttachment}
                  />
                </TabsContent>

                {/* Management Tab */}
                {!isEditMode && <TabsContent {...editPanelLink('management')} data-tour="lead-form-management" value="management" className="space-y-4 mt-0">
                  <LeadManagementFields
                    formData={formData}
                    errors={errors}
                    isSubmitting={isSubmitting}
                    canSelectTeam={canSelectTeam}
                    canUploadAttachments={canUploadAttachments}
                    fieldIdPrefix={fieldIdPrefix}
                    teams={teams}
                    users={users}
                    pipelines={pipelines}
                    stages={stages}
                    onScopeChange={handleScopeChange}
                    updateField={updateField}
                  />
                </TabsContent>}
              </Tabs>
              </fieldset>
          )}
        </form>}
        <AlertDialog open={reloadEditOpen} onOpenChange={setReloadEditOpen}>
          <AlertDialogContent>
            <AlertDialogHeader><AlertDialogTitle>Recarregar o contato?</AlertDialogTitle><AlertDialogDescription>As alterações ainda não salvas deste formulário serão descartadas. Os dados atuais do contato serão carregados.</AlertDialogDescription></AlertDialogHeader>
            <AlertDialogFooter><AlertDialogCancel>Manter minha edição</AlertDialogCancel><AlertDialogAction disabled={isSubmitting} onClick={() => {
              if (submissionAttemptRef.current || isSubmitting || !persistedLead || isLoadingEditLead) return;
              const initial = getEmptyFormData();
              editBaseFormRef.current = initial;
              editBaseLeadRef.current = persistedLead;
              setEditBaseVersion(persistedLead.updated_at);
              setFormData(initial);
              setPendingAttachments([]);
              setErrors({});
              setActiveTab('basic');
            }}>Recarregar e descartar edição</AlertDialogAction></AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}
