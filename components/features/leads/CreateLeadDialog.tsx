import { useState, useEffect, useCallback, useId, useMemo, useRef } from 'react';
import { maskCNPJ, maskCPF, maskPhone, maskRG } from '@/lib/masks';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { leadAttachmentsAPI } from '@/lib/api/lead-attachments';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TagSelector } from '@/components/ui/tag-selector';
import { Loader2, User, Briefcase, Building2, DollarSign, Trophy, XCircle, CircleDot, FileText, X, Home, Paperclip, Trash2, Plus } from 'lucide-react';
import { PropertyPickerDialog } from '@/components/features/properties/PropertyPickerDialog';
import { useAuth } from '@/contexts/AuthContext';
import { useUserPermissions } from '@/hooks/use-user-permissions';
import { useOrganizationUsers } from '@/hooks/use-users';
import { usePipelines, useStages } from '@/hooks/use-stages';
import { useProperties } from '@/hooks/use-properties';
import { useCreateLead, useLead, useLeadSensitiveProfile, useUpdateLead, type Lead } from '@/hooks/use-leads';
import { useTeams } from '@/hooks/use-teams';

type EditableLead = Omit<Partial<Lead>, 'tags' | 'stage' | 'assignee'> & {
  id: string;
  tags?: Array<{ id?: string; name?: string | null; color?: string | null }>;
};

interface CreateLeadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultStageId?: string | null;
  defaultPipelineId?: string | null;
  contactPhone?: string | null;
  contactName?: string | null;
  conversationId?: string | null;
  lead?: EditableLead | null;
  onSaved?: (lead: Lead) => void;
}

type LeadFormErrors = Partial<Record<
  'name' | 'contact' | 'phone' | 'email' | 'cpf' | 'cnpj' | 'birth_date' | 'assigned_user_id' | 'team_id' | 'pipeline_id' | 'stage_id' | 'lost_reason',
  string
>>;

const MAX_PENDING_ATTACHMENTS = 10;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

function formatCurrencyInput(value: string | number) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  }
  const digits = value.replace(/\D/g, '').slice(0, 15);
  if (!digits) return '';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(digits) / 100);
}

function parseCurrencyInput(value: string) {
  const digits = value.replace(/\D/g, '');
  return digits ? Number(digits) / 100 : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function metadataText(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === 'string' ? value : '';
}

function omitBasicErrors(errors: LeadFormErrors) {
  const next = { ...errors };
  delete next.name;
  delete next.contact;
  delete next.phone;
  delete next.email;
  return next;
}

const dealStatusOptions = [
  { value: 'open', label: 'Aberto', icon: CircleDot, color: 'text-blue-500' },
  { value: 'won', label: 'Ganho', icon: Trophy, color: 'text-green-500' },
  { value: 'lost', label: 'Perdido', icon: XCircle, color: 'text-red-500' },
];

export function CreateLeadDialog({
  open,
  onOpenChange,
  defaultStageId,
  defaultPipelineId,
  contactPhone,
  contactName,
  conversationId,
  lead: leadSummary,
  onSaved,
}: CreateLeadDialogProps) {
  const { profile, organization } = useAuth();
  const fieldIdPrefix = useId();
  const { hasPermission } = useUserPermissions();
  const { data: allUsers = [] } = useOrganizationUsers();
  const allAssignableUsers = hasPermission('lead_operate') ? allUsers : allUsers.filter(u => u.id === profile?.id);
  const canSelectTeam = hasPermission('lead_view_all') || hasPermission('lead_view_team');
  const { data: teams = [] } = useTeams({ enabled: open && canSelectTeam });
  const canViewProperties = hasPermission('property_view') || hasPermission('property_manage');
  const { data: pipelines = [] } = usePipelines();
  const { data: properties = [] } = useProperties(undefined, {}, { enabled: canViewProperties && open });
  const createLead = useCreateLead();
  const updateLead = useUpdateLead();
  const isEditMode = Boolean(leadSummary?.id);
  const { data: persistedLead, isLoading: isLoadingPersistedLead } = useLead(isEditMode ? leadSummary?.id || null : null);
  const {
    data: sensitiveProfile,
    isLoading: isLoadingSensitiveProfile,
    isError: sensitiveProfileError,
  } = useLeadSensitiveProfile(isEditMode ? leadSummary?.id || null : null, { enabled: open && isEditMode });
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
  const [activeTab, setActiveTab] = useState('basic');
  const [draftRestored, setDraftRestored] = useState(false);

  const draftKey = !isEditMode && organization?.id ? `lead-draft-${organization.id}` : null;

  const getEmptyFormData = useCallback(() => {
    const metadata = asRecord(editableLead?.metadata);
    const nestedProfile = asRecord(metadata.profile);
    const profileMetadata = Object.keys(nestedProfile).length > 0 ? nestedProfile : metadata;
    const primaryPropertyId = editableLead?.interest_property_id || editableLead?.property_id || '';
    const metadataPropertyIds = Array.isArray(metadata.interestPropertyIds)
      ? metadata.interestPropertyIds.filter((value): value is string => typeof value === 'string')
      : [];
    const interestPropertyIds = metadataPropertyIds.length > 0
      ? metadataPropertyIds
      : primaryPropertyId ? [primaryPropertyId] : [];

    return ({
    name: editableLead?.name || '',
    phone: editableLead?.phone || '',
    phone2: '',
    email: editableLead?.email || '',
    message: editableLead?.message || '',
    feedback: editableLead?.feedback || '',
    source: editableLead?.source || '',
    person_type: (metadataText(profileMetadata, 'personType') === 'company' ? 'company' : 'individual') as 'individual' | 'company',
    gender: (['male', 'female', 'other'].includes(metadataText(profileMetadata, 'gender')) ? metadataText(profileMetadata, 'gender') : '') as '' | 'male' | 'female' | 'other',
    social_name: metadataText(profileMetadata, 'socialName'),
    cpf: maskCPF(sensitiveProfile?.cpf || metadataText(profileMetadata, 'cpf')),
    rg: maskRG(sensitiveProfile?.rg || metadataText(profileMetadata, 'rg')),
    birth_date: metadataText(profileMetadata, 'birthDate'),
    cnpj: maskCNPJ(metadataText(profileMetadata, 'cnpj')),
    corporate_name: metadataText(profileMetadata, 'corporateName'),
    trade_name: metadataText(profileMetadata, 'tradeName'),
    state_registration: metadataText(profileMetadata, 'stateRegistration'),
    is_portability: false,
    mother_name: '',
    uf: '',
    cidade: '',
    bairro: '',
    endereco: '',
    numero: '',
    cep: '',
    plan_id: '',
    due_day: '',
    payment_method: '',
    cargo: editableLead?.cargo || '',
    empresa: editableLead?.empresa || '',
    profissao: editableLead?.profissao || '',
    renda_familiar: editableLead?.renda_familiar || '',
    faixa_valor_imovel: editableLead?.faixa_valor_imovel || '',
    valor_interesse: editableLead?.valor_interesse == null ? '' : formatCurrencyInput(editableLead.valor_interesse),
    assigned_user_id: editableLead?.assigned_user_id || profile?.id || '',
    team_id: editableLead?.team_id || '',
    pipeline_id: editableLead?.pipeline_id || defaultPipelineId || '',
    stage_id: editableLead?.stage_id || defaultStageId || '',
    property_id: primaryPropertyId,
    interest_property_ids: interestPropertyIds,
    deal_status: editableLead?.deal_status || 'open',
    lost_reason: editableLead?.lost_reason || '',
    tag_ids: (editableLead?.tags || []).flatMap((tag) => tag.id ? [tag.id] : []),
    conversation_id: '',
  });
  }, [editableLead, profile?.id, defaultPipelineId, defaultStageId, sensitiveProfile?.cpf, sensitiveProfile?.rg]);

  const [formData, setFormData] = useState(getEmptyFormData);
  const finalTab = isEditMode ? 'interest' : 'management';
  const [pendingAttachments, setPendingAttachments] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
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

  const isFormEmpty = useCallback((data: typeof formData) => {
    return !data.name.trim()
      && !data.phone
      && !data.phone2
      && !data.email.trim()
      && !data.message.trim()
      && !data.feedback.trim()
      && !data.source
      && data.person_type === 'individual'
      && !data.gender
      && !data.social_name
      && !data.cpf
      && !data.rg
      && !data.birth_date
      && !data.cnpj
      && !data.corporate_name
      && !data.trade_name
      && !data.state_registration
      && !data.mother_name
      && !data.uf
      && !data.cidade
      && !data.bairro
      && !data.endereco
      && !data.numero
      && !data.cep
      && !data.plan_id
      && !data.due_day
      && !data.payment_method
      && !data.cargo
      && !data.empresa
      && !data.profissao
      && !data.renda_familiar
      && !data.faixa_valor_imovel
      && !data.valor_interesse
      && !data.lost_reason
      && !data.property_id
      && data.interest_property_ids.length === 0
      && data.tag_ids.length === 0
      && !data.is_portability;
  }, []);

  // Save draft to localStorage with debounce
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!open || !draftKey) return;

    if (isFormEmpty(formData)) {
      localStorage.removeItem(draftKey);
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
  }, [formData, activeTab, open, draftKey, isFormEmpty]);

  // Restore draft or reset form when dialog opens
  /* eslint-disable react-hooks/set-state-in-effect -- Syncs the controlled dialog opening with local draft form state. */
  useEffect(() => {
    if (open) {
      setDraftRestored(false);
      setErrors({});
      setDialogPosition({ x: 0, y: 0 });
      dialogPositionRef.current = { x: 0, y: 0 };

      if (isEditMode) {
        if (isLoadingEditLead || !editableLead) return;
        setPendingAttachments([]);
        setFormData(getEmptyFormData());
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
              setFormData({ ...getEmptyFormData(), ...parsed.formData });
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
  }, [open, pipelines, defaultStageId, defaultPipelineId, draftKey, getEmptyFormData, isFormEmpty, contactPhone, contactName, conversationId, isEditMode, isLoadingEditLead, editableLead]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const discardDraft = useCallback(() => {
    if (draftKey) localStorage.removeItem(draftKey);
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
  }, [draftKey, pipelines, defaultPipelineId, defaultStageId, getEmptyFormData]);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen && draftKey && !isFormEmpty(formData)) {
      try {
        localStorage.setItem(draftKey, JSON.stringify({ formData, activeTab }));
      } catch { /* quota exceeded - ignore */ }
    }

    onOpenChange(nextOpen);
  }, [activeTab, draftKey, formData, isFormEmpty, onOpenChange]);

  // Prevent accidental close on backdrop click when form has data
  const handleInteractOutside = useCallback((e: Event) => {
    if (dragStateRef.current || Date.now() < suppressOutsideCloseUntilRef.current || !isFormEmpty(formData) || pendingAttachments.length > 0) {
      e.preventDefault();
    }
  }, [formData, isFormEmpty, pendingAttachments.length]);

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
  /* eslint-disable react-hooks/set-state-in-effect -- Uses async stage data to select the first available stage. */
  useEffect(() => {
    if (formData.pipeline_id && stages.length > 0 && !formData.stage_id) {
      setFormData(prev => ({ ...prev, stage_id: stages[0].id }));
    }
  }, [formData.pipeline_id, formData.stage_id, stages]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    return () => {
      if (dragFrameRef.current) {
        window.cancelAnimationFrame(dragFrameRef.current);
      }
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
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
      return;
    }

    if (!validateBasicStep()) return;
    if (!validateProfileStep()) return;
    if (!isEditMode && !validateManagementStep()) return;
    if (isEditMode && sensitiveProfileError) {
      toast.error('Não foi possível carregar CPF e RG com segurança. Reabra o formulário e tente novamente.');
      return;
    }

    setIsSubmitting(true);
    try {
      const initialFeedback = formData.feedback.trim() || (!isEditMode ? formData.message.trim() : '');
      const currentFeedback = editableLead?.feedback?.trim() || '';
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

      const savedLead = isEditMode && editableLead
        ? await updateLead.mutateAsync({
          id: editableLead.id,
          name: formData.name,
          phone: formData.phone || null,
          email: formData.email || null,
          feedback: initialFeedback === currentFeedback ? undefined : initialFeedback || null,
          source: formData.source || 'manual',
          cargo: formData.cargo || null,
          empresa: formData.empresa || null,
          profissao: formData.profissao || null,
          renda_familiar: formData.renda_familiar || null,
          faixa_valor_imovel: formData.faixa_valor_imovel || null,
          valor_interesse: parseCurrencyInput(formData.valor_interesse) ?? null,
          property_id: primaryPropertyId,
          interest_property_id: primaryPropertyId,
          interest_property_ids: formData.interest_property_ids,
          profile: profileInput,
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
          cargo: formData.cargo || undefined,
          empresa: formData.empresa || undefined,
          profissao: formData.profissao || undefined,
          renda_familiar: formData.renda_familiar || undefined,
          faixa_valor_imovel: formData.faixa_valor_imovel || undefined,
          valor_interesse: parseCurrencyInput(formData.valor_interesse),
          property_id: primaryPropertyId || undefined,
          interest_property_ids: formData.interest_property_ids.length > 0 ? formData.interest_property_ids : undefined,
          deal_status: formData.deal_status || 'open',
          lost_reason: formData.deal_status === 'lost' ? formData.lost_reason || undefined : undefined,
          profile: profileInput,
        });

      let failedAttachments = 0;
      for (const file of pendingAttachments) {
        try {
          await leadAttachmentsAPI.upload(savedLead.id, file);
        } catch {
          failedAttachments += 1;
        }
      }

      if (failedAttachments > 0) {
        toast.warning(`Lead ${isEditMode ? 'atualizado' : 'criado'}, mas ${failedAttachments} documento(s) não foram enviados.`);
      } else if (pendingAttachments.length > 0) {
        toast.success(`${pendingAttachments.length} documento(s) anexado(s).`);
      }

      // Clear draft on success
      if (draftKey) localStorage.removeItem(draftKey);
      setPendingAttachments([]);
      setDraftRestored(false);
      setErrors({});
      if (isEditMode) toast.success('Lead atualizado com sucesso!');
      onSaved?.(savedLead as Lead);
      onOpenChange(false);
    } catch {
      // Error handled by mutation
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateField = <K extends keyof typeof formData>(field: K, value: (typeof formData)[K]) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setErrors(prev => {
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

  const phoneDigits = formData.phone.replace(/\D/g, '');
  const hasValidPhone = !formData.phone || phoneDigits.length >= 10;
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
    if (!files) return;
    const incoming = Array.from(files);
    const oversized = incoming.filter((file) => file.size > MAX_ATTACHMENT_BYTES);
    if (oversized.length > 0) {
      toast.error('Cada documento pode ter no máximo 25 MB.');
    }

    setPendingAttachments((current) => {
      const keys = new Set(current.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
      const valid = incoming.filter((file) => file.size <= MAX_ATTACHMENT_BYTES && !keys.has(`${file.name}:${file.size}:${file.lastModified}`));
      const next = [...current, ...valid].slice(0, MAX_PENDING_ATTACHMENTS);
      if (current.length + valid.length > MAX_PENDING_ATTACHMENTS) {
        toast.warning(`Você pode anexar até ${MAX_PENDING_ATTACHMENTS} documentos por cadastro.`);
      }
      return next;
    });
  };
  const fieldIds = {
    name: `${fieldIdPrefix}-lead-name`,
    contact: `${fieldIdPrefix}-lead-contact`,
    phone: `${fieldIdPrefix}-lead-phone`,
    email: `${fieldIdPrefix}-lead-email`,
  };
  const describedBy = (...ids: Array<string | false | null | undefined>) => ids.filter(Boolean).join(' ') || undefined;
  const leadDialogSurfaceClass = cn(
    "!left-1/2 !right-auto !top-1/2 !bottom-auto !h-auto max-h-[88vh] !w-[96vw] !border-0 bg-[var(--app-surface)] !p-0 text-[var(--app-text-primary)] shadow-[0_24px_80px_rgba(0,0,0,0.34)] backdrop-blur-2xl sm:!w-[720px] sm:!max-w-[720px]",
    "!duration-0 !transition-none flex flex-col overflow-hidden rounded-none will-change-transform sm:rounded-[24px]",
    "data-[state=open]:!animate-none data-[state=closed]:!animate-none data-[state=closed]:!slide-out-to-right data-[state=open]:!slide-in-from-right",
    "[&_label]:text-[var(--app-text-secondary)] [&_label]:font-medium",
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
      nextErrors.phone = 'Telefone invalido. Informe DDD + numero (min. 10 digitos).';
    }

    if (formData.email.trim() && !hasValidEmail) {
      nextErrors.email = 'Email invalido. Use o formato nome@dominio.com';
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

    if (formData.deal_status === 'lost' && !formData.lost_reason.trim()) {
      setErrors((previous) => ({ ...previous, lost_reason: 'Informe o motivo da perda' }));
      toast.error('Informe o motivo da perda');
      setActiveTab('management');
      return false;
    }

    return true;
  };

  const handleFormKeyDown = (e: React.KeyboardEvent<HTMLFormElement>) => {
    if (e.key !== 'Enter' || e.defaultPrevented || activeTab === finalTab) return;

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

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        data-tour="pipeline-new-lead"
        ref={dialogContentRef}
        side="right"
        className={leadDialogSurfaceClass}
        overlayClassName="!bg-black/18 !backdrop-blur-[1px]"
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
          <SheetTitle className="flex items-center gap-2 pr-9 text-[15px] font-semibold text-[var(--app-text-primary)]">
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

        {/* Draft restored banner */}
        {draftRestored && (
          <div className="mx-6 mt-2 flex items-center justify-between gap-2 rounded-xl bg-[var(--app-surface-soft)] px-3 py-2">
            <div className="flex items-center gap-2 text-sm text-[var(--app-text-secondary)]">
              <FileText className="h-4 w-4 flex-shrink-0" />
              <span>Rascunho restaurado</span>
            </div>
            <button
              type="button"
              onClick={discardDraft}
              className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80"
            >
              <X className="h-3 w-3" />
              Descartar
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} onKeyDown={handleFormKeyDown} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="px-6 pb-4 pt-3">
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList data-tour="lead-form-tabs" className={cn('mb-5 grid h-10 w-full rounded-xl bg-[var(--app-surface-soft)] p-1', isEditMode ? 'grid-cols-3' : 'grid-cols-4')}>
                  <TabsTrigger data-tour="lead-form-tab-basic" value="basic" className="rounded-lg text-xs text-[var(--app-text-tertiary)] data-[state=active]:bg-primary data-[state=active]:text-white">Contato</TabsTrigger>
                  <TabsTrigger data-tour="lead-form-tab-profile" value="profile" className="rounded-lg text-xs text-[var(--app-text-tertiary)] data-[state=active]:bg-primary data-[state=active]:text-white">Pessoa</TabsTrigger>
                  <TabsTrigger data-tour="lead-form-tab-interest" value="interest" className="rounded-lg text-xs text-[var(--app-text-tertiary)] data-[state=active]:bg-primary data-[state=active]:text-white">Interesse</TabsTrigger>
                  {!isEditMode && <TabsTrigger data-tour="lead-form-tab-management" value="management" className="rounded-lg text-xs text-[var(--app-text-tertiary)] data-[state=active]:bg-primary data-[state=active]:text-white">Gestão</TabsTrigger>}
                </TabsList>

                {/* Basic Info Tab */}
                <TabsContent data-tour="lead-form-basic" value="basic" className="space-y-4 mt-0">
                    <div className="space-y-4">
                      {/* Real Estate: Basic Info - Clean Layout */}
                      <div className="space-y-1.5">
                        <Label htmlFor={fieldIds.name} className="text-sm font-medium">
                          {formData.person_type === 'company' ? 'Nome do contato / responsável *' : 'Nome completo *'}
                        </Label>
                        <Input
                          id={fieldIds.name}
                          value={formData.name}
                          onChange={(e) => updateField('name', e.target.value)}
                          placeholder={formData.person_type === 'company' ? 'Pessoa responsável pelo contato' : 'Nome do lead'}
                          required
                          aria-invalid={Boolean(errors.name)}
                          aria-describedby={errors.name ? `${fieldIds.name}-error` : undefined}
                        />
                        {errors.name ? (
                          <p id={`${fieldIds.name}-error`} className="text-xs font-medium text-destructive" role="alert">
                            {errors.name}
                          </p>
                        ) : null}
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label htmlFor={fieldIds.phone} className="text-sm font-medium">Telefone</Label>
                          <Input
                            id={fieldIds.phone}
                            value={formData.phone}
                            onChange={(e) => updateField('phone', maskPhone(e.target.value))}
                            placeholder="(00) 00000-0000"
                            inputMode="tel"
                            maxLength={15}
                            aria-invalid={Boolean(errors.phone || errors.contact)}
                            aria-describedby={describedBy(
                              errors.phone && `${fieldIds.phone}-error`,
                              errors.contact && `${fieldIds.contact}-error`,
                            )}
                          />
                          {errors.phone ? (
                            <p id={`${fieldIds.phone}-error`} className="text-xs font-medium text-destructive" role="alert">
                              {errors.phone}
                            </p>
                          ) : null}
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor={fieldIds.email} className="text-sm font-medium">Email</Label>
                          <Input
                            id={fieldIds.email}
                            type="email"
                            value={formData.email}
                            onChange={(e) => updateField('email', e.target.value)}
                            placeholder="email@exemplo.com"
                            pattern="^[^\s@]+@[^\s@]+\.[^\s@]{2,}$"
                            aria-invalid={Boolean(errors.email || errors.contact)}
                            aria-describedby={describedBy(
                              errors.email && `${fieldIds.email}-error`,
                              errors.contact && `${fieldIds.contact}-error`,
                            )}
                            title="Informe um email válido (ex: nome@dominio.com)"
                          />
                          {errors.email ? (
                            <p id={`${fieldIds.email}-error`} className="text-xs font-medium text-destructive" role="alert">
                              {errors.email}
                            </p>
                          ) : null}
                        </div>
                      </div>
                      {errors.contact ? (
                        <p id={`${fieldIds.contact}-error`} className="-mt-2 text-xs font-medium text-destructive" role="alert">
                          {errors.contact}
                        </p>
                      ) : null}

                      <div className="space-y-1.5">
                        <Label className="text-sm font-medium">Origem</Label>
                        <Select
                          value={formData.source || "__none__"}
                          onValueChange={(v) => updateField('source', v === "__none__" ? '' : v)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Como conheceu?" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">Não informado</SelectItem>
                            <SelectItem value="manual">Manual</SelectItem>
                            <SelectItem value="site">Site</SelectItem>
                            <SelectItem value="indicacao">Indicação</SelectItem>
                            <SelectItem value="portais">Portais</SelectItem>
                            <SelectItem value="whatsapp">WhatsApp</SelectItem>
                            <SelectItem value="facebook">Facebook</SelectItem>
                            <SelectItem value="instagram">Instagram</SelectItem>
                            <SelectItem value="google">Google</SelectItem>
                            <SelectItem value="google_ads">Google Ads</SelectItem>
                            <SelectItem value="meta">Meta Ads</SelectItem>
                            <SelectItem value="meta_ads">Meta Ads</SelectItem>
                            <SelectItem value="import">Importação</SelectItem>
                            <SelectItem value="webhook">Webhook</SelectItem>
                            <SelectItem value="outros">Outros</SelectItem>
                            <SelectItem value="outro">Outro</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-sm font-medium">Observações / feedback inicial</Label>
                        <Textarea
                          value={formData.feedback}
                          onChange={(e) => updateField('feedback', e.target.value)}
                          placeholder="Contexto do atendimento, necessidades ou próximos passos..."
                          rows={4}
                        />
                        <p className="text-xs text-[var(--app-text-tertiary)]">Este texto entra no histórico como o primeiro feedback do lead.</p>
                      </div>
                    </div>
                </TabsContent>

                {/* Profile/Contract Tab */}
                <TabsContent data-tour="lead-form-profile" value="profile" className="mt-0 space-y-5">
                  <div className="space-y-2">
                    <Label>Tipo de pessoa</Label>
                    <div className="grid grid-cols-2 gap-2 rounded-xl bg-[var(--app-surface-soft)] p-1">
                      {([
                        ['individual', 'Pessoa física'],
                        ['company', 'Pessoa jurídica'],
                      ] as const).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => updateField('person_type', value)}
                          className={cn(
                            'h-9 rounded-lg text-xs font-medium transition-colors',
                            formData.person_type === value
                              ? 'bg-primary text-white shadow-sm'
                              : 'text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-hover)]',
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {formData.person_type === 'individual' ? (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Gênero</Label>
                        <Select value={formData.gender || '__none__'} onValueChange={(value) => updateField('gender', value === '__none__' ? '' : value as typeof formData.gender)}>
                          <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">Não informado</SelectItem>
                            <SelectItem value="male">Masculino</SelectItem>
                            <SelectItem value="female">Feminino</SelectItem>
                            <SelectItem value="other">Outro</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Nome social</Label>
                        <Input value={formData.social_name} onChange={(e) => updateField('social_name', e.target.value)} placeholder="Como prefere ser chamado(a)" />
                      </div>
                      <div className="space-y-2">
                        <Label>Data de nascimento</Label>
                        <Input type="date" value={formData.birth_date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => updateField('birth_date', e.target.value)} aria-invalid={Boolean(errors.birth_date)} />
                        {errors.birth_date && <p className="text-xs font-medium text-destructive">{errors.birth_date}</p>}
                      </div>
                      <div className="space-y-2">
                        <Label>CPF</Label>
                        <Input value={formData.cpf} onChange={(e) => updateField('cpf', maskCPF(e.target.value))} placeholder="000.000.000-00" inputMode="numeric" aria-invalid={Boolean(errors.cpf)} />
                        {errors.cpf && <p className="text-xs font-medium text-destructive">{errors.cpf}</p>}
                      </div>
                      <div className="space-y-2">
                        <Label>RG</Label>
                        <Input value={formData.rg} onChange={(e) => updateField('rg', maskRG(e.target.value))} placeholder="00.000.000-0" inputMode="numeric" />
                      </div>
                      <div className="space-y-2">
                        <Label>Profissão</Label>
                        <Input value={formData.profissao} onChange={(e) => updateField('profissao', e.target.value)} placeholder="Área de atuação" />
                      </div>
                      <div className="space-y-2 sm:col-span-2">
                        <Label className="flex items-center gap-2"><DollarSign className="h-3.5 w-3.5" />Renda</Label>
                        <Input value={formData.renda_familiar} onChange={(e) => updateField('renda_familiar', formatCurrencyInput(e.target.value))} placeholder="R$ 0,00" inputMode="decimal" />
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2 sm:col-span-2">
                        <Label>Razão social</Label>
                        <Input value={formData.corporate_name} onChange={(e) => updateField('corporate_name', e.target.value)} placeholder="Razão social da empresa" />
                      </div>
                      <div className="space-y-2">
                        <Label>Nome fantasia</Label>
                        <Input value={formData.trade_name} onChange={(e) => updateField('trade_name', e.target.value)} placeholder="Nome comercial" />
                      </div>
                      <div className="space-y-2">
                        <Label>CNPJ</Label>
                        <Input value={formData.cnpj} onChange={(e) => updateField('cnpj', maskCNPJ(e.target.value))} placeholder="00.000.000/0000-00" inputMode="numeric" aria-invalid={Boolean(errors.cnpj)} />
                        {errors.cnpj && <p className="text-xs font-medium text-destructive">{errors.cnpj}</p>}
                      </div>
                      <div className="space-y-2 sm:col-span-2">
                        <Label>Inscrição estadual</Label>
                        <Input value={formData.state_registration} onChange={(e) => updateField('state_registration', e.target.value)} placeholder="Opcional" />
                      </div>
                    </div>
                  )}

                  <div className="grid gap-4 border-t border-[var(--app-border)] pt-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label className="flex items-center gap-2"><Briefcase className="h-3.5 w-3.5" />Cargo</Label>
                      <Input value={formData.cargo} onChange={(e) => updateField('cargo', e.target.value)} placeholder="Ex: Gerente, Diretor..." />
                    </div>
                    <div className="space-y-2">
                      <Label className="flex items-center gap-2"><Building2 className="h-3.5 w-3.5" />Empresa</Label>
                      <Input value={formData.empresa} onChange={(e) => updateField('empresa', e.target.value)} placeholder="Nome da empresa" />
                    </div>
                  </div>
                </TabsContent>

                <TabsContent data-tour="lead-form-interest" value="interest" className="mt-0 space-y-5">
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2"><DollarSign className="h-3.5 w-3.5" />Valor de interesse</Label>
                    <Input value={formData.valor_interesse} onChange={(e) => updateField('valor_interesse', formatCurrencyInput(e.target.value))} placeholder="R$ 0,00" inputMode="decimal" />
                    <p className="text-xs text-[var(--app-text-tertiary)]">Digite somente os números; a moeda é formatada automaticamente.</p>
                  </div>

                  <div className="space-y-3">
                    <Label className="flex items-center gap-2"><Home className="h-3.5 w-3.5" />Imóveis de interesse</Label>
                    {selectedInterestProperties.map((property, index) => (
                      <div key={property.id} className="flex items-center gap-3 rounded-xl bg-[var(--app-surface-soft)] px-3 py-2.5">
                        <Building2 className="h-4 w-4 shrink-0 text-primary" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-[var(--app-text-primary)]">{[property.code, property.title].filter(Boolean).join(' - ')}</p>
                          <p className="truncate text-xs text-[var(--app-text-tertiary)]">{[property.bairro, property.cidade].filter(Boolean).join(' · ')}{index === 0 ? ' · Principal' : ''}</p>
                        </div>
                        <button
                          type="button"
                          aria-label={`Remover ${property.title || property.code || 'imóvel'}`}
                          onClick={() => {
                            setFormData((previous) => {
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
                          }}
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[var(--app-text-tertiary)] hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                    <PropertyPickerDialog
                      properties={properties.map((p) => ({
                        id: p.id, code: p.code, title: p.title, bairro: p.bairro, cidade: p.cidade,
                        preco: p.preco, imagem_principal: p.imagem_principal, tipo_de_imovel: p.tipo_de_imovel,
                        tipo_de_negocio: p.tipo_de_negocio, commission_percentage: p.commission_percentage, status: p.status,
                      }))}
                      selectedPropertyId={null}
                      disabled={!canViewProperties}
                      onSelect={(property) => {
                        setFormData((previous) => {
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
                      }}
                      trigger={(
                        <button type="button" disabled={!canViewProperties} className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-primary/40 bg-primary/10 px-3 text-xs font-medium text-primary hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50">
                          <Plus className="h-3.5 w-3.5" />{selectedInterestProperties.length > 0 ? 'Adicionar outro imóvel' : 'Adicionar imóvel'}
                        </button>
                      )}
                    />
                    {!canViewProperties && <p className="text-xs text-[var(--app-text-tertiary)]">Seu perfil não possui acesso aos imóveis.</p>}
                  </div>

                  {!isEditMode && <div className="space-y-3 border-t border-[var(--app-border)] pt-4">
                    <div>
                      <Label className="flex items-center gap-2"><Paperclip className="h-3.5 w-3.5" />Documentos</Label>
                      <p className="mt-1 text-xs text-[var(--app-text-tertiary)]">Até 10 arquivos de 25 MB. O envio acontece depois que o lead é criado.</p>
                    </div>
                    <Input
                      id={`${fieldIdPrefix}-lead-attachments`}
                      type="file"
                      multiple
                      accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp"
                      className="sr-only"
                      onChange={(event) => {
                        handleAttachmentSelection(event.target.files);
                        event.currentTarget.value = '';
                      }}
                    />
                    <label htmlFor={`${fieldIdPrefix}-lead-attachments`} className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-primary/40 bg-primary/10 text-xs font-medium text-primary hover:bg-primary/15">
                      <Plus className="h-3.5 w-3.5" />Adicionar documentos
                    </label>
                    {pendingAttachments.map((file) => (
                      <div key={`${file.name}:${file.size}:${file.lastModified}`} className="flex items-center gap-3 rounded-xl bg-[var(--app-surface-soft)] px-3 py-2">
                        <FileText className="h-4 w-4 shrink-0 text-primary" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-[var(--app-text-primary)]">{file.name}</p>
                          <p className="text-[11px] text-[var(--app-text-tertiary)]">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
                        </div>
                        <button type="button" aria-label={`Remover ${file.name}`} onClick={() => setPendingAttachments((current) => current.filter((item) => item !== file))} className="grid h-8 w-8 place-items-center rounded-lg text-[var(--app-text-tertiary)] hover:bg-destructive/10 hover:text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>}
                </TabsContent>

                {/* Management Tab */}
                {!isEditMode && <TabsContent data-tour="lead-form-management" value="management" className="space-y-4 mt-0">
                  <div className="grid gap-4 sm:grid-cols-2">
                    {canSelectTeam && (
                      <div className="space-y-2">
                        <Label className="flex items-center gap-2">
                          <Building2 className="h-3.5 w-3.5" />
                          Escopo do lead
                        </Label>
                        <Select
                          value={formData.team_id || 'personal'}
                          onValueChange={(value) => {
                            const nextTeamId = value === 'personal' ? '' : value;
                            const nextTeam = teams.find((team) => team.id === nextTeamId);
                            const memberIds = new Set((nextTeam?.members || []).map((member) => member.user_id));
                            const currentAssigneeIsValid = !nextTeamId || memberIds.has(formData.assigned_user_id);
                            const fallbackAssignee = allAssignableUsers.find((user) => memberIds.has(user.id))?.id || '';
                            setFormData((previous) => ({
                              ...previous,
                              team_id: nextTeamId,
                              assigned_user_id: currentAssigneeIsValid ? previous.assigned_user_id : fallbackAssignee,
                            }));
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione o escopo" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="personal">Pessoal</SelectItem>
                            {teams.filter((team) => team.is_active !== false).map((team) => (
                              <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <div className="space-y-2">
                      <Label className="flex items-center gap-2">
                        <User className="h-3.5 w-3.5" />
                        Responsável
                      </Label>
                      <Select
                        value={formData.assigned_user_id}
                        onValueChange={(v) => updateField('assigned_user_id', v)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione o responsável" />
                        </SelectTrigger>
                        <SelectContent>
                          {users.map(user => (
                            <SelectItem key={user.id} value={user.id}>
                              {user.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Status do Negócio</Label>
                      <Select
                        value={formData.deal_status}
                        onValueChange={(v) => updateField('deal_status', v)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {dealStatusOptions.map(opt => (
                            <SelectItem key={opt.value} value={opt.value}>
                              <div className="flex items-center gap-2">
                                <opt.icon className={`h-3.5 w-3.5 ${opt.color}`} />
                                {opt.label}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {formData.deal_status === 'lost' && (
                        <div className="mt-3 space-y-1.5">
                          <Label htmlFor={`${fieldIdPrefix}-lost-reason`}>Motivo da perda *</Label>
                          <Input
                            id={`${fieldIdPrefix}-lost-reason`}
                            value={formData.lost_reason}
                            onChange={(event) => updateField('lost_reason', event.target.value)}
                            placeholder="Ex.: sem retorno, valor ou desistência"
                            maxLength={300}
                            aria-invalid={Boolean(errors.lost_reason)}
                          />
                          {errors.lost_reason && (
                            <p className="text-xs font-medium text-destructive" role="alert">{errors.lost_reason}</p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Pipeline</Label>
                      <Select
                        value={formData.pipeline_id}
                        onValueChange={(v) => {
                          updateField('pipeline_id', v);
                          updateField('stage_id', '');
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione a pipeline" />
                        </SelectTrigger>
                        <SelectContent>
                          {pipelines.map(p => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Estágio</Label>
                      <Select
                        value={formData.stage_id}
                        onValueChange={(v) => updateField('stage_id', v)}
                        disabled={!formData.pipeline_id}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione o estágio" />
                        </SelectTrigger>
                        <SelectContent>
                          {stages.map(s => (
                            <SelectItem key={s.id} value={s.id}>
                              <div className="flex items-center gap-2">
                                <div
                                  className="h-2.5 w-2.5 rounded-full"
                                  style={{ backgroundColor: s.color || "#6b7280" }}
                                />
                                {s.name}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>


                  <div className="space-y-2">
                    <Label>Tags</Label>
                    <TagSelector
                      selectedTagIds={formData.tag_ids}
                      onSelectTag={(tagId) => {
                        if (!formData.tag_ids.includes(tagId)) {
                          updateField('tag_ids', [...formData.tag_ids, tagId]);
                        }
                      }}
                      onRemoveTag={(tagId) => {
                        updateField('tag_ids', formData.tag_ids.filter(id => id !== tagId));
                      }}
                      placeholder="Adicionar tags..."
                    />
                  </div>
                </TabsContent>}
              </Tabs>
            </div>
          </div>

          <div className="flex shrink-0 gap-2 px-6 pb-6 pt-3">
            <Button type="button" className="h-10 w-[40%] border-0 bg-[var(--app-surface-soft)] text-[var(--app-text-primary)] hover:bg-[var(--app-surface-hover)]" onClick={() => handleOpenChange(false)}>
              Cancelar
            </Button>
            {activeTab !== finalTab ? (
              <Button
                key="btn-avancar"
                type="button"
                className="h-10 w-[60%] bg-primary text-white hover:bg-primary/90"
                onClick={() => {
                  if (activeTab === 'basic') {
                    if (!validateBasicStep()) return;
                    setActiveTab('profile');
                  }
                  else if (activeTab === 'profile') {
                    if (!validateProfileStep()) return;
                    setActiveTab('interest');
                  }
                  else if (activeTab === 'interest' && !isEditMode) setActiveTab('management');
                }}
              >
                Avançar
              </Button>
            ) : (
              <Button
                data-tour="lead-form-submit"
                key="btn-submit"
                type="submit"
                className="h-10 w-[60%] bg-primary text-white hover:bg-primary/90"
                disabled={isSubmitting || isLoadingEditLead || sensitiveProfileError || !hasRequiredLeadIdentity || (!isEditMode && !hasRequiredManagement)}
              >
                {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {isSubmitting
                  ? isEditMode ? 'Salvando...' : 'Criando...'
                  : isEditMode ? 'Salvar alterações' : 'Criar Lead'}
              </Button>
            )}
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
