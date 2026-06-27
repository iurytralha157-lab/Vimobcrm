import { useState, useEffect, useRef } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { PropertyPickerDialog } from '@/components/features/properties/PropertyPickerDialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PhoneInput } from '@/components/ui/phone-input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AnimatedTabNav } from '@/components/ui/animated-tab-nav';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Phone, Mail, MessageCircle, Building2, Loader2, CheckCircle, X, Plus, Save, User,
  Briefcase, MapPin, DollarSign, Clock, ChevronRight, Calendar, Target,
  Lightbulb, FileEdit, Zap, Bot, Check, Activity, ListTodo, Contact,
  Handshake, History, ChevronDown, Trophy, XCircle, CircleDot, UserCheck,
  RotateCcw, FileText, Download, Paperclip, BarChart3, Search
} from 'lucide-react';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { ptBR, enUS } from 'date-fns/locale';
import { useLeadTasks, useCompleteCadenceTask } from '@/hooks/use-lead-tasks';
import { useCadenceTemplates } from '@/hooks/use-cadences';
import type { CadenceTaskTemplate } from '@/hooks/use-cadences';
import { useCreateActivity } from '@/hooks/use-activities';
import { useUpdateLead, useAddLeadTag, useRemoveLeadTag } from '@/hooks/use-leads';
import type { Lead } from '@/hooks/use-leads';
import type { Tag } from '@/hooks/use-tags';
import type { User as AppUser } from '@/hooks/use-users';
import type { PipelineLead } from '@/hooks/use-stages';
import { useProperties } from '@/hooks/use-properties';
import { useScheduleEvents, ScheduleEvent, EventType } from '@/hooks/use-schedule-events';
import { useLeadMeta } from '@/hooks/use-lead-meta';
import { useLeadAttachments, useUploadLeadAttachment } from '@/hooks/use-lead-attachments';
import { useLanguage } from '@/contexts/LanguageContext';
import { useFloatingChat } from '@/contexts/FloatingChatContext';
import { useAuth } from '@/contexts/AuthContext';
import { LeadHistory } from '@/components/features/leads/LeadHistory';
import { LeadTrackingSection } from '@/components/features/leads/LeadTrackingSection';
import { LeadJourneySection } from '@/components/features/leads/LeadJourneySection';

import { LeadMessagesTab } from '@/components/features/leads/LeadMessagesTab';
import { ReentryBadge } from '@/components/features/leads/ReentryBadge';
import { LostReasonDialog } from '@/components/features/leads/LostReasonDialog';
import { SdrDistributionButton } from '@/components/features/leads/SdrDistributionButton';

import { TaskOutcomeDialog, TaskOutcome } from '@/components/features/leads/TaskOutcomeDialog';
import { formatResponseTime } from '@/hooks/use-lead-timeline';
import { EventsList } from '@/components/features/schedule/EventsList';
import { EventSheet } from '@/components/features/schedule/EventSheet';
import { toast } from 'sonner';
import { formatPhoneForDisplay } from '@/lib/phone-utils';
import { TagSelectorPopoverContent } from '@/components/ui/tag-selector';
import { useUpdateLeadCommission } from '@/hooks/use-update-commission';
import { useDealStatusChange } from '@/hooks/use-deal-status-change';
import { useCreateCall } from '@/hooks/use-telephony';
import { useRecordFirstResponseOnAction } from '@/hooks/use-first-response';
import { useUserAccessScope } from '@/hooks/use-user-access-scope';
import { useTeams } from '@/hooks/use-teams';
import type { UnifiedHistoryEvent } from '@/hooks/use-lead-history';
import { leadsAPI } from '@/lib/api/leads';
import { teamsAPI } from '@/lib/api/teams';
const sourceLabels: Record<string, string> = {
  meta: 'Meta Ads',
  site: 'Site',
  manual: 'Manual',
  facebook: 'Facebook',
  instagram: 'Instagram',
  import: 'Importação',
  google: 'Google Ads',
  indicacao: 'Indicação',
  whatsapp: 'WhatsApp',
  outros: 'Outros'
};
const sourceIcons: Record<string, typeof MessageCircle> = {
  meta: MessageCircle,
  facebook: MessageCircle,
  instagram: MessageCircle,
  whatsapp: MessageCircle
};
const taskTypeLabels: Record<string, string> = {
  call: 'Ligação',
  message: 'Mensagem',
  email: 'Email',
  note: 'Observação'
};
const activityTypeIcons: Record<string, typeof Phone> = {
  call: Phone,
  message: MessageCircle,
  email: Mail,
  note: Building2,
  lead_created: Plus,
  stage_change: ChevronRight,
  assignee_changed: UserCheck,
  status_change: Target,
  lead_reentry: RotateCcw,
  proposal_sent: FileText
};
type LeadDetailStage = {
  id: string;
  name: string;
  color?: string | null;
  stage_key?: string | null;
  pipeline_id?: string | null;
  position?: number | null;
};

type CadenceTaskType = 'call' | 'message' | 'email' | 'note';

const OUTCOME_CADENCE_TASK_TYPES: CadenceTaskType[] = ['call', 'message', 'email'];

type LeadDetailTag = {
  id?: string;
  name?: string | null;
  color?: string | null;
};

type RenderableLeadTag = LeadDetailTag & { id: string };

type LeadDetailAssignee = {
  id: string;
  name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
};

type LeadDetailLead = Omit<PipelineLead, 'stage' | 'assignee' | 'tags'> & Omit<Partial<Lead>, 'stage' | 'assignee' | 'tags'> & {
  whatsapp_picture?: string | null;
  whatsapp_avatar_url?: string | null;
  contact_picture?: string | null;
  assignee?: LeadDetailAssignee | null;
  property?: { id?: string; code?: string | null; title?: string | null; preco?: number | null } | null;
  stage?: LeadDetailStage | null;
  tags?: LeadDetailTag[];
};

type PipelineCacheStage = LeadDetailStage & {
  leads?: LeadDetailLead[];
  total_lead_count?: number | null;
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return 'Erro desconhecido';
}

function getCadenceTaskType(type?: string | null): CadenceTaskType {
  return type === 'message' || type === 'email' || type === 'note' ? type : 'call';
}

function hasTagId(tag: LeadDetailTag | null | undefined): tag is RenderableLeadTag {
  return typeof tag?.id === 'string' && tag.id.length > 0;
}

function getTagColor(tag: LeadDetailTag) {
  return tag.color || '#64748b';
}

interface LeadDetailDialogProps {
  lead: LeadDetailLead | null;
  stages: LeadDetailStage[];
  onClose: () => void;
  allTags: Tag[];
  allUsers: AppUser[];
  refetchStages: () => void;
}
export function LeadDetailDialog({
  lead: leadProp,
  stages,
  onClose,
  allTags,
  allUsers,
  refetchStages
}: LeadDetailDialogProps) {
  const lead = leadProp ?? ({} as LeadDetailLead);
  const {
    t,
    language
  } = useLanguage();
  const isMobile = useIsMobile();
  const dateLocale = language === 'pt-BR' ? ptBR : enUS;
  const {
    openNewChat,
    openNewChatWithMessage
  } = useFloatingChat();
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);
  const [assigneePopoverOpen, setAssigneePopoverOpen] = useState(false);
  const [localLead, setLocalLead] = useState<LeadDetailLead | null>(leadProp);
  const [isUpdatingAssignee, setIsUpdatingAssignee] = useState(false);
  const [isEditingContact, setIsEditingContact] = useState(false);
  const [scheduleFormOpen, setScheduleFormOpen] = useState(false);
  const [editingScheduleEvent, setEditingScheduleEvent] = useState<ScheduleEvent | null>(null);
  const [scheduleDefaultType, setScheduleDefaultType] = useState<EventType>('call');
  const [activeTab, setActiveTab] = useState('activities');
  const [stagePopoverOpen, setStagePopoverOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<CadenceTaskTemplate | null>(null);
  const [roteiroDialogOpen, setRoteiroDialogOpen] = useState(false);
  const [outcomeDialogOpen, setOutcomeDialogOpen] = useState(false);
  const [taskForOutcome, setTaskForOutcome] = useState<CadenceTaskTemplate | null>(null);
  const [quickActionOutcomeOpen, setQuickActionOutcomeOpen] = useState(false);
  const [quickActionOutcomeType, setQuickActionOutcomeType] = useState<'call' | 'email'>('call');
  const [selectedHistoryEvent, setSelectedHistoryEvent] = useState<UnifiedHistoryEvent | null>(null);
  const [historyEventDialogOpen, setHistoryEventDialogOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const leadId = leadProp?.id ?? null;
  const [lostReasonLocal, setLostReasonLocal] = useState(lead?.lost_reason || '');
  const [lostReasonDialogOpen, setLostReasonDialogOpen] = useState(false);
  const [feedback, setFeedback] = useState('');

  const handleSaveFeedback = async () => {
    if (!feedback.trim()) return;
    try {
      // Registrar no histórico como uma nota
      await createActivityMutation.mutateAsync({
        lead_id: lead.id,
        type: 'note',
        content: feedback,
      });

      // Também podemos salvar como o feedback mais recente no lead
      // (Isso requer a coluna 'feedback' que você solicitou via SQL)
      try {
        await updateLead.mutateAsync({
          id: lead.id,
          feedback: feedback
        });
      } catch {
        // Se a coluna ainda não existir, apenas ignoramos o erro de persistência única
        console.log("Coluna 'feedback' ainda não existe na tabela leads");
      }

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
    procura_financiamento: false,
    is_own_resource: false
  });


  // Currency formatting helpers
  const formatCurrencyDisplay = (value: string): string => {
    if (!value) return '';
    const numbers = value.replace(/\D/g, '');
    if (!numbers) return '';
    return Number(numbers).toLocaleString('pt-BR');
  };

  const parseCurrencyInput = (value: string): string => {
    return value.replace(/\D/g, '');
  };

  // Sync edit form with lead data whenever lead changes
  useEffect(() => {
    if (!leadProp || isUpdatingAssignee) return;

    let isActive = true;
    queueMicrotask(() => {
      if (isActive) setLocalLead(leadProp);
    });

    return () => {
      isActive = false;
    };
  }, [leadProp, isUpdatingAssignee]);

  useEffect(() => {
    if (!leadProp) return;

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
      procura_financiamento: leadProp.procura_financiamento || false,
      is_own_resource: leadProp.is_own_resource || false
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
  const {
    data: leadTasks = [],
    isLoading: leadTasksLoading
  } = useLeadTasks(leadId || undefined);
  const {
    data: cadenceTemplates = []
  } = useCadenceTemplates();
  const {
    data: properties = []
  } = useProperties();
  const {
    data: scheduleEvents = []
  } = useScheduleEvents({
    leadId: leadId || undefined
  });
  const {
    data: leadMeta,
    isLoading: leadMetaLoading
  } = useLeadMeta(leadId);
  const completeCadenceTask = useCompleteCadenceTask();
  const updateLead = useUpdateLead();
  const addTag = useAddLeadTag();
  const removeTag = useRemoveLeadTag();
  const updateCommission = useUpdateLeadCommission();
  const dealStatusChange = useDealStatusChange();
  const { recordFirstResponse } = useRecordFirstResponseOnAction();
  const { profile, organization } = useAuth();
  const accessScope = useUserAccessScope();
  const { data: teams = [] } = useTeams({ includeInactive: true });
  const createCallMutation = useCreateCall();
  const createActivityMutation = useCreateActivity();
  const { data: attachments = [] } = useLeadAttachments(leadId);
  const uploadAttachment = useUploadLeadAttachment();

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !lead.id) return;

    setIsUploading(true);
    try {
      await uploadAttachment.mutateAsync({ leadId: lead.id, file });
      toast.success('Documento enviado com sucesso!');
    } catch (error: unknown) {
      console.error('Erro fatal no upload de documento:', error);
      toast.error(`Erro ao enviar: ${getErrorMessage(error)}`);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Quick action handlers for phone/email with outcome dialog
  const handleQuickPhone = () => {
    if (!lead.phone) return;

    // 1. Log initiation immediately in history
    createActivityMutation.mutate({
      lead_id: lead.id,
      type: 'call_initiated',
      content: 'Ligação iniciada',
      metadata: { phone: lead.phone, channel: 'phone' },
    });

    recordFirstResponse({
      leadId: lead.id,
      organizationId: lead.organization_id || profile?.organization_id || organization?.id || '',
      channel: 'phone',
      actorUserId: profile?.id || null,
      firstResponseAt: lead.first_response_at,
    });

    window.open(`tel:${lead.phone.replace(/\D/g, '')}`, '_blank');
    setQuickActionOutcomeType('call');
    setQuickActionOutcomeOpen(true);
  };

  const handleQuickWhatsApp = () => {
    if (!lead.phone) return;
    openNewChat(lead.phone, lead.name, lead.id);
  };

  const handleQuickEmail = () => {
    if (!lead.email) return;
    const gmailUrl = `https://mail.google.com/mail/view=cm&fs=1&tf=1&to=${encodeURIComponent(lead.email)}`;
    window.open(gmailUrl, '_blank');
    setQuickActionOutcomeType('email');
    setQuickActionOutcomeOpen(true);
  };

  const handleQuickActionOutcomeConfirm = (outcome: TaskOutcome, notes: string) => {
    // 1. Log in the 'activities' table for visual history
    createActivityMutation.mutate({
      lead_id: lead.id,
      type: quickActionOutcomeType === 'call' ? 'call' : 'email',
      content: quickActionOutcomeType === 'call' ? 'Tentativa de ligação' : 'Email enviado',
      metadata: { outcome, notes, channel: quickActionOutcomeType },
    });

    // 2. If it's a call, also register it in 'telephony_calls' for gamification & metrics
    if (quickActionOutcomeType === 'call') {
      // Use fire-and-forget logic or separate mutation to not block UI/history
      createCallMutation.mutate({
        lead_id: lead.id,
        phone_to: lead.phone || '',
        direction: 'outbound',
        notes: notes,
        organization_id: lead.organization_id || profile?.organization_id || organization?.id || ''
      });
    }

    setQuickActionOutcomeOpen(false);
  };
  const handleEditScheduleEvent = (event: ScheduleEvent) => {
    setEditingScheduleEvent(event);
    setScheduleFormOpen(true);
  };
  const handleCloseScheduleForm = () => {
    setScheduleFormOpen(false);
    setEditingScheduleEvent(null);
  };
  if (!leadProp || !localLead) return null;

  const currentStage = localLead.stage || stages.find(s => s.id === localLead.stage_id);
  const currentStageIndex = stages.findIndex(s => s.id === localLead.stage_id);
  const assigneeName = localLead.assignee?.name || '';
  const assigneeEmail = localLead.assignee?.email || '';
  const interestValue = Number(lead.valor_interesse || 0);
  const leadTags = Array.isArray(localLead.tags) ? localLead.tags.filter(hasTagId) : [];
  const safeAllTags = Array.isArray(allTags) ? allTags.filter(Boolean) : [];
  const safeAllUsers = Array.isArray(allUsers) ? allUsers.filter(Boolean) : [];
  const canTransferLead = accessScope.canTransferAnyLead || (
    accessScope.isTeamLeader &&
    (
      (!!localLead.pipeline_id && accessScope.ledPipelineIds.includes(localLead.pipeline_id)) ||
      (!!localLead.assigned_user_id && accessScope.ledUserIds.includes(localLead.assigned_user_id))
    )
  );
  const assignableUsers = accessScope.canTransferAnyLead
    ? safeAllUsers
    : accessScope.isTeamLeader
      ? safeAllUsers.filter((candidate) => accessScope.ledUserIds.includes(candidate.id))
      : [];
  const safeLeadTasks = Array.isArray(leadTasks) ? leadTasks.filter(Boolean) : [];
  const safeCadenceTemplates = Array.isArray(cadenceTemplates) ? cadenceTemplates.filter(Boolean) : [];
  const originLabels = {
    title: t?.leads?.origin?.title || 'Origem',
    source: t?.leads?.origin?.source || 'Fonte',
    createdAt: t?.leads?.origin?.createdAt || 'Criado em'
  };

  // Find cadence template for this lead's stage
  const stageTemplate = safeCadenceTemplates.find(t => t.stage_key === currentStage?.stage_key);
  const templateTasks = Array.isArray(stageTemplate?.tasks) ? stageTemplate.tasks.filter(Boolean) : [];

  // Map lead tasks by a key to check if completed
  const leadTasksMap = new Map(safeLeadTasks.map(t => [`${t.title || ''}-${t.day_offset || 0}-${t.type || ''}`, t]));
  const completedTasksCount = safeLeadTasks.filter(t => t.is_done).length;
  const totalTasksCount = templateTasks.length;
  const leadTagIds = leadTags.map((tag) => tag.id);
  const availableTags = safeAllTags.filter(t => !leadTagIds.includes(t.id));

  const updatePipelineAssigneeCache = (nextLead: LeadDetailLead) => {
    const snapshots = queryClient.getQueriesData<PipelineCacheStage[]>({ queryKey: ['stages-with-leads'] });
    const nextUpdatedAt = new Date().toISOString();

    snapshots.forEach(([queryKey, cachedData]) => {
      if (!Array.isArray(cachedData)) return;

      const keyParts = Array.isArray(queryKey) ? queryKey : [];
      const filterUserId = keyParts[2] as string | null | undefined;
      const shouldKeepInFilteredView =
        !filterUserId || filterUserId === 'all' || filterUserId === nextLead.assigned_user_id;

      let changed = false;
      const nextStages = cachedData.map((stage) => {
        if (!Array.isArray(stage?.leads)) return stage;

        let stageChanged = false;
        const nextLeads = stage.leads.reduce<LeadDetailLead[]>((acc, stageLead) => {
          if (stageLead?.id !== nextLead.id) {
            acc.push(stageLead);
            return acc;
          }

          changed = true;
          stageChanged = true;

          if (!shouldKeepInFilteredView) return acc;

          acc.push({
            ...stageLead,
            assigned_user_id: nextLead.assigned_user_id,
            assignee: nextLead.assignee || undefined,
            updated_at: nextUpdatedAt
          });
          return acc;
        }, []);

        if (!stageChanged) return stage;

        const totalLeadCount = Number(stage.total_lead_count ?? stage.leads.length);
        return {
          ...stage,
          leads: nextLeads,
          total_lead_count: shouldKeepInFilteredView
            ? totalLeadCount
            : Math.max(totalLeadCount - 1, 0)
        };
      });

      if (changed) {
        queryClient.setQueryData(queryKey, nextStages);
      }
    });

    return snapshots;
  };

  const updatePipelineLeadCache = (leadIdToUpdate: string, patch: Partial<LeadDetailLead>) => {
    const snapshots = queryClient.getQueriesData<PipelineCacheStage[]>({ queryKey: ['stages-with-leads'] });
    const nextUpdatedAt = new Date().toISOString();

    snapshots.forEach(([queryKey, cachedData]) => {
      if (!Array.isArray(cachedData)) return;

      let changed = false;
      const nextStages = cachedData.map((stage) => {
        if (!Array.isArray(stage?.leads)) return stage;

        let stageChanged = false;
        const nextLeads = stage.leads.map((stageLead) => {
          if (stageLead?.id !== leadIdToUpdate) return stageLead;

          changed = true;
          stageChanged = true;
          return {
            ...stageLead,
            ...patch,
            updated_at: nextUpdatedAt,
          };
        });

        return stageChanged ? { ...stage, leads: nextLeads } : stage;
      });

      if (changed) {
        queryClient.setQueryData(queryKey, nextStages);
      }
    });

    return snapshots;
  };

  const restorePipelineCache = (snapshots: Array<[QueryKey, unknown]>) => {
    snapshots.forEach(([queryKey, data]) => {
      queryClient.setQueryData(queryKey, data);
    });
  };

  const refreshPipelineInBackground = () => {
    queryClient.invalidateQueries({ queryKey: ['stages-with-leads'], refetchType: 'inactive' });
    refetchStages();
  };

  const handleAddTag = async (tagId: string) => {
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
      refreshPipelineInBackground();
    } catch {
      setLocalLead(previousLead);
      restorePipelineCache(pipelineSnapshots);
    }
  };

  const handleRemoveTag = async (tagId: string) => {
    if (!localLead) return;

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
      refreshPipelineInBackground();
    } catch {
      setLocalLead(previousLead);
      restorePipelineCache(pipelineSnapshots);
    }
  };

  const handleAssignUser = async (userId: string | null) => {
    if (!canTransferLead) {
      toast.error('Você não tem permissão para trocar o responsável deste lead');
      return;
    }
    if (userId && !assignableUsers.some((candidate) => candidate.id === userId)) {
      toast.error('Você só pode transferir leads para usuários permitidos');
      return;
    }

    if (!localLead) return;

    // UI Otimista
    const previousLead: LeadDetailLead = { ...localLead };
    const selectedUser = userId ? assignableUsers.find(u => u.id === userId) : null;

    const updatedLead: LeadDetailLead = {
      ...localLead,
      assigned_user_id: userId,
      assignee: selectedUser ? {
        id: selectedUser.id,
        name: selectedUser.name,
        email: selectedUser.email,
        avatar_url: selectedUser.avatar_url
      } : undefined
    };

    setLocalLead(updatedLead);
    const pipelineSnapshots = updatePipelineAssigneeCache(updatedLead);
    setIsUpdatingAssignee(true);
    setAssigneePopoverOpen(false);

    if (!userId) {
      try {
        const { error } = await leadsAPI.assignLead(lead.id, null, lead.organization_id || profile?.organization_id || organization?.id);
        if (error) throw error;
        refreshPipelineInBackground();
      } catch {
        setLocalLead(previousLead);
        restorePipelineCache(pipelineSnapshots);
      } finally {
        setIsUpdatingAssignee(false);
      }
      return;
    }

    try {
      // Check user availability before assigning
      const currentDay = new Date().getDay();
      const currentTime = format(new Date(), 'HH:mm:ss');

      const teamMember = teams
        .flatMap((team) => team.members || [])
        .find((member) => member.user_id === userId);

      if (teamMember) {
        const availabilityList = await teamsAPI.listMemberAvailability({
          teamMemberId: teamMember.id,
          organizationId: lead.organization_id || profile?.organization_id || organization?.id,
        });
        const availability = availabilityList.find((item) => item.day_of_week === currentDay && item.is_active);

        if (availability) {
          const isOutsideSchedule = !availability.is_all_day &&
            (currentTime < (availability.start_time || '00:00:00') ||
             currentTime > (availability.end_time || '23:59:59'));

          if (isOutsideSchedule) {
            const startTime = availability.start_time || '00:00:00';
            const endTime = availability.end_time || '23:59:59';
            const confirmAssign = window.confirm(
              `Atenção: Este usuário está fora do seu horário de escala (${startTime.slice(0, 5)} - ${endTime.slice(0, 5)}). Deseja atribuir mesmo assim`
            );
            if (!confirmAssign) {
              setLocalLead(previousLead);
              restorePipelineCache(pipelineSnapshots);
              setIsUpdatingAssignee(false);
              return;
            }
          }
        } else {
          const confirmAssign = window.confirm(
            'Atenção: Este usuário não tem escala ativa para hoje. Deseja atribuir mesmo assim'
          );
          if (!confirmAssign) {
            setLocalLead(previousLead);
            restorePipelineCache(pipelineSnapshots);
            setIsUpdatingAssignee(false);
            return;
          }
        }
      }

      const { error } = await leadsAPI.assignLead(lead.id, userId, lead.organization_id || profile?.organization_id || organization?.id);
      if (error) throw error;
      refreshPipelineInBackground();
    } catch {
      setLocalLead(previousLead);
      restorePipelineCache(pipelineSnapshots);
    } finally {
      setIsUpdatingAssignee(false);
    }
  };
  const handleToggleCadenceTask = async (task: CadenceTaskTemplate, outcome = 'done', outcomeNotes = '') => {
    await completeCadenceTask.mutateAsync({
      leadId: lead.id,
      templateTaskId: task.id,
      dayOffset: task.day_offset,
      type: getCadenceTaskType(task.type),
      title: task.title,
      description: task.description || undefined,
      outcome,
      outcomeNotes
    });
    const firstContactChannel = task.type === 'call' ? 'phone' : task.type === 'message' ? 'whatsapp' : null;
    if (firstContactChannel) {
      await recordFirstResponse({
        leadId: lead.id,
        organizationId: lead.organization_id || profile?.organization_id || organization?.id || '',
        channel: firstContactChannel,
        actorUserId: profile?.id || null,
        firstResponseAt: lead.first_response_at,
      });
    }
  };

  // Handle outcome dialog confirmation
  const handleOutcomeConfirm = async (outcome: TaskOutcome, notes: string) => {
    if (!taskForOutcome) return;
    await handleToggleCadenceTask(taskForOutcome, outcome, notes);
    setOutcomeDialogOpen(false);

    // Se agendou visita/reunião, abrir o formulário de agenda automaticamente
    if (outcome === 'scheduled') {
      setEditingScheduleEvent(null);
      setScheduleDefaultType('visit');
      setScheduleFormOpen(true);
    }

    setTaskForOutcome(null);
  };

  const handleCadenceTaskClick = (task: CadenceTaskTemplate) => {
    const taskType = getCadenceTaskType(task.type);
    const existingTask = leadTasksMap.get(`${task.title}-${task.day_offset}-${task.type}`);
    const isDone = existingTask?.is_done;

    // Se já está feito, não faz nada (evitar toggle reverso sem querer)
    if (isDone) return;

    // Se tem observação/roteiro, abrir o popup de roteiro primeiro
    if (task.observation) {
      setSelectedTask(task);
      setRoteiroDialogOpen(true);
      return;
    }

    // Se for tarefa de mensagem com mensagem recomendada e tem telefone
    if (taskType === 'message' && task.recommended_message && lead.phone) {
      // Substituir variáveis na mensagem
      const message = task.recommended_message.replace(/{nome}/gi, lead.name || '').replace(/{empresa}/gi, lead.empresa || '').replace(/{email}/gi, lead.email || '');
      recordFirstResponse({
        leadId: lead.id,
        organizationId: lead.organization_id || profile?.organization_id || organization?.id || '',
        channel: 'whatsapp',
        actorUserId: profile?.id || null,
        firstResponseAt: lead.first_response_at,
      });
      openNewChatWithMessage(lead.phone, message, lead.id, lead.name);
    }

    // Para call, message, email - abrir dialog de outcome
    if (OUTCOME_CADENCE_TASK_TYPES.includes(taskType)) {
      setTaskForOutcome(task);
      setOutcomeDialogOpen(true);
    } else {
      // Para note ou outros tipos, apenas completar
      handleToggleCadenceTask(task);
    }
  };
  const handleRoteiroAction = (action: 'complete' | 'message') => {
    if (!selectedTask) return;
    if (action === 'message' && selectedTask.recommended_message && lead.phone) {
      const message = selectedTask.recommended_message.replace(/{nome}/gi, lead.name || '').replace(/{empresa}/gi, lead.empresa || '').replace(/{email}/gi, lead.email || '');
      recordFirstResponse({
        leadId: lead.id,
        organizationId: lead.organization_id || profile?.organization_id || organization?.id || '',
        channel: 'whatsapp',
        actorUserId: profile?.id || null,
        firstResponseAt: lead.first_response_at,
      });
      openNewChatWithMessage(lead.phone, message, lead.id, lead.name);
    }

    // Após roteiro, abrir dialog de outcome se for call/message/email
    const selectedTaskType = getCadenceTaskType(selectedTask.type);
    if (OUTCOME_CADENCE_TASK_TYPES.includes(selectedTaskType)) {
      setTaskForOutcome(selectedTask);
      setOutcomeDialogOpen(true);
    } else {
      handleToggleCadenceTask(selectedTask);
    }
    setRoteiroDialogOpen(false);
    setSelectedTask(null);
  };
  const resetContactEditForm = () => {
    setEditForm({
      name: lead.name || '',
      phone: lead.phone || '',
      email: lead.email || '',
      cargo: lead.cargo || '',
      empresa: lead.empresa || '',
      endereco: lead.endereco || '',
      numero: lead.numero || '',
      complemento: lead.complemento || '',
      bairro: lead.bairro || '',
      cidade: lead.cidade || '',
      uf: lead.uf || '',
      cep: lead.cep || '',
      valor_interesse: lead.valor_interesse ? lead.valor_interesse.toString() : '',
      commission_percentage: lead.commission_percentage != null ? lead.commission_percentage.toString() : '',
      property_id: lead.interest_property_id || lead.property_id || '',
      message: lead.message || '',
      renda_familiar: lead.renda_familiar || '',
      trabalha: lead.trabalha || false,
      profissao: lead.profissao || '',
      faixa_valor_imovel: lead.faixa_valor_imovel || '',
      finalidade_compra: lead.finalidade_compra || '',
      procura_financiamento: lead.procura_financiamento || false,
      is_own_resource: lead.is_own_resource || false
    });
  };
  const handleSaveContact = async () => {
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
        procura_financiamento: editForm.procura_financiamento || null,
        is_own_resource: editForm.is_own_resource
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
      refetchStages();
      toast.success('Dados salvos com sucesso!');
    } catch (error) {
      console.error('Erro ao salvar dados do lead:', error);
      toast.error('Erro ao salvar dados. Tente novamente.');
    }
  };
  const handleMoveToStage = async (stageId: string) => {
    if (stageId === localLead.stage_id) return;

    setStagePopoverOpen(false);
    const previousLead = { ...localLead };
    const stage = stages.find(s => s.id === stageId);
    setLocalLead({
      ...localLead,
      stage_id: stageId,
      stage: stage || localLead.stage,
    });

    try {
      const isProposal = stage?.name?.toLowerCase().includes('proposta');

      await updateLead.mutateAsync({
        id: lead.id,
        stage_id: stageId
      });

      // Se moveu para estágio de Proposta, registrar atividade de gamificação
      if (isProposal) {
        await createActivityMutation.mutateAsync({
          lead_id: lead.id,
          type: 'proposal_sent',
          content: 'Lead movido para estágio de Proposta',
        });
      }

      refetchStages();
      toast.success('Lead movido!');
    } catch {
      setLocalLead(previousLead);
    }
  };

  // Centralized handler for deal status changes
  const handleDealStatusChange = async (newStatus: string) => {
    const previousStatus = lead.deal_status;
    if (newStatus === previousStatus) return;

    // Intercept "lost" -> ask for reason via dialog
    if (newStatus === 'lost') {
      setLostReasonDialogOpen(true);
      return;
    }

    // Validation when marking as "won"
    if (newStatus === 'won') {
      const valorInteresse = lead.valor_interesse || 0;

      if (!lead.is_own_resource) {
        toast.warning('Confirme se o cliente possui recurso próprio', {
          description: 'A regra de fechamento exige a verificação de recurso próprio para finalizar o contrato.',
          duration: 6000,
        });
      }

      if (valorInteresse <= 0) {
        toast.warning('Valor de interesse não preenchido', {
          description: 'Recomendamos preencher o valor antes de marcar como ganho para gerar comissões automaticamente.',
          duration: 6000,
        });
      }
    }


    await dealStatusChange.mutateAsync({
      leadId: lead.id,
      newStatus: newStatus as 'open' | 'won' | 'lost',
      organizationId: profile?.organization_id || organization?.id || '',
      organizationName: organization?.name || null,
      userId: lead.assigned_user_id ?? null,
      propertyId: lead.property_id ?? null,
      valorInteresse: lead.valor_interesse ?? null,
      commissionPercentage: lead.commission_percentage ?? null,
      leadName: lead.name || 'Lead',
    });

    refetchStages();
  };

  // Confirm lost with reason from dialog
  const handleConfirmLostReason = async (reason: string) => {
    await dealStatusChange.mutateAsync({
      leadId: lead.id,
      newStatus: 'lost',
      organizationId: profile?.organization_id || organization?.id || '',
      organizationName: organization?.name || null,
      userId: lead.assigned_user_id ?? null,
      propertyId: lead.property_id ?? null,
      valorInteresse: lead.valor_interesse ?? null,
      commissionPercentage: lead.commission_percentage ?? null,
      leadName: lead.name || 'Lead',
      lostReason: reason,
    });
    setLostReasonLocal(reason);
    setLostReasonDialogOpen(false);
    refetchStages();
  };

  const leadSource = lead.source ?? 'outros';
  const SourceIcon = sourceIcons[leadSource] || Target;
  const leadName = lead.name || 'Lead';
  // State for roteiro dialog is now at top of component

  // Tabs configuration
  const tabs = [{
    id: 'activities',
    label: 'Atividades',
    icon: Activity
  }, {
    id: 'contact',
    label: 'Contato',
    icon: Contact
  }, {
    id: 'deal',
    label: 'Negócio',
    icon: Handshake
  }, {
    id: 'schedule',
    label: 'Agenda',
    icon: Calendar,
    badge: scheduleEvents.length > 0 ? scheduleEvents.length.toString() : null
  }, {
    id: 'history',
    label: 'Histórico',
    icon: History
  }];

  // Mobile content - defined as JSX variable (NOT a component function) to prevent re-mounting
  const MobileContent = () => (<div className="lead-detail-dialog flex h-full flex-col bg-[var(--app-surface-solid)] text-[var(--app-text-primary)]">
      {/* Mobile Header - Compact */}
      <div className="relative px-4 pt-4 pb-3 border-b border-white/[0.055] bg-[var(--app-surface)]">
        {/* Close button */}
        <button onClick={onClose} className="absolute right-3 top-3 h-8 w-8 rounded-full bg-white/[0.07] flex items-center justify-center z-10">
          <X className="h-4 w-4" />
        </button>

        {/* Row 1 - Avatar + Nome + Tags */}
        <div className="flex items-center gap-2.5 mb-3 pr-10">
          <Avatar className="h-11 w-11 shrink-0 border-2 border-primary/20">
            <AvatarImage src={lead.whatsapp_picture || undefined} alt={lead.name} />
            <AvatarFallback className="bg-primary text-primary-foreground font-semibold text-base">
              {lead.name?.[0]?.toUpperCase() || <User className="h-5 w-5" />}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-base truncate leading-tight">{lead.name}</h2>
              <ReentryBadge count={lead.reentry_count} lastEntryAt={lead.last_entry_at} />
            </div>
            {/* Tags inline */}
            <div className="flex items-center gap-1 mt-1 flex-wrap">
              {leadTags.slice(0, 3).map((tag) => {
                const tagColor = getTagColor(tag);
                return (
                  <Badge
                    key={tag.id}
                    className="flex items-center gap-1 pr-1 py-0 text-[10px] rounded-full h-5 leading-none"
                    style={{
                      backgroundColor: tagColor,
                      color: '#FFFFFF',
                      borderColor: tagColor
                    }}
                  >
                    <div className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: tagColor }} />
                    {tag.name || 'Tag'}
                    <button onClick={() => handleRemoveTag(tag.id)} className="ml-0.5 p-0.5 hover:bg-black/10 rounded-full">
                      <X className="h-2 w-2" />
                    </button>
                  </Badge>
                );
              })}
              {leadTags.length > 3 && (
                <Badge variant="secondary" className="text-[10px] py-0 h-5">
                  +{leadTags.length - 3}
                </Badge>
              )}
              <Popover open={tagPopoverOpen} onOpenChange={setTagPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-5 w-5 p-0 rounded-full border border-dashed shrink-0">
                    <Plus className="h-3 w-3" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-0" align="start">
                  <TagSelectorPopoverContent
                    availableTags={availableTags}
                    onAddTag={handleAddTag}
                    onClose={() => setTagPopoverOpen(false)}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </div>

        {/* Row 2 - Ações rápidas */}
        <div className="flex items-center gap-2 mb-3">
          {lead.phone && (
            <>
              <Button variant="outline" size="sm" onClick={handleQuickPhone} className="h-9 flex-1 rounded-full border-0 bg-[var(--app-surface-soft)]">
                <Phone className="h-4 w-4 mr-1.5" />
                Ligar
              </Button>
              <Button size="sm" onClick={handleQuickWhatsApp} className="h-9 flex-1 rounded-full">
                <MessageCircle className="h-4 w-4 mr-1.5" />
                Chat
              </Button>
            </>
          )}
          {lead.email && (
            <Button variant="outline" size="sm" onClick={handleQuickEmail} className="h-9 w-9 shrink-0 rounded-full border-0 bg-[var(--app-surface-soft)] p-0">
              <Mail className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Row 3 - Estágio + Deal Status lado a lado */}
        <div className="flex items-center gap-2 flex-wrap">
          {lead.is_own_resource && (
            <Badge variant="secondary" className="bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-none px-2 rounded-full text-[10px] font-bold">
              <DollarSign className="h-3 w-3 mr-0.5" />
              Recurso Próprio
            </Badge>
          )}
          {/* Stage pill */}
          <Popover open={stagePopoverOpen} onOpenChange={setStagePopoverOpen}>

            <PopoverTrigger asChild>
              <button className="flex-1 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-medium min-w-0 overflow-hidden">
                <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse shrink-0" />
                <span className="truncate">{currentStage?.name || 'Sem estágio'}</span>
                <ChevronDown className="h-3 w-3 shrink-0 ml-auto" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-[calc(100vw-2rem)] max-w-sm border-0 bg-[var(--app-surface-solid)] p-2 text-[var(--app-text-primary)] shadow-[0_14px_34px_rgba(0,0,0,0.22)]" align="start">
              <div className="max-h-64 space-y-1 overflow-y-auto overscroll-contain pr-1 touch-pan-y scrollbar-thin">
                {stages.map((stage, idx) => {
                  const isActive = stage.id === localLead.stage_id;
                  const isPast = idx < currentStageIndex;
                  return (
                    <button key={stage.id} onClick={() => handleMoveToStage(stage.id)} className={cn("w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all", isActive ? "bg-primary text-primary-foreground" : isPast ? "bg-primary/10 text-primary hover:bg-primary/20" : "hover:bg-accent")}>
                      {isPast && <Check className="h-4 w-4 shrink-0" />}
                      {isActive && <div className="h-2 w-2 rounded-full bg-primary-foreground animate-pulse" />}
                      {!isPast && !isActive && <div className="h-2 w-2 rounded-full bg-muted" />}
                      <span className="font-medium">{stage.name}</span>
                    </button>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>

          {/* Deal Status pill */}
          <Select value={lead.deal_status || 'open'} onValueChange={handleDealStatusChange}>
            <SelectTrigger
              className={cn(
                "h-auto w-auto rounded-full px-3 py-1.5 text-xs font-medium border-0 shrink-0 gap-1.5",
                lead.deal_status === 'won' && "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
                lead.deal_status === 'lost' && "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
                (!lead.deal_status || lead.deal_status === 'open') && "bg-muted text-muted-foreground"
              )}
            >
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">
                <span className="flex items-center gap-2">
                  <CircleDot className="h-4 w-4 text-muted-foreground" />
                  Aberto
                </span>
              </SelectItem>
              <SelectItem value="won">
                <span className="flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-emerald-600" />
                  Ganho
                </span>
              </SelectItem>
              <SelectItem value="lost">
                <span className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-red-600" />
                  Perdido
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Lost reason input (when status = lost) */}
        {lead.deal_status === 'lost' && (
          <Input
            value={lostReasonLocal}
            onChange={(e) => setLostReasonLocal(e.target.value)}
            onBlur={async (e) => {
              if (e.target.value !== (lead.lost_reason || '')) {
                await updateLead.mutateAsync({ id: lead.id, lost_reason: e.target.value });
                refetchStages();
              }
            }}
            placeholder="Motivo da perda..."
            className="mt-2 rounded-xl text-sm border-red-200 dark:border-red-800"
          />
        )}
      </div>

      {/* Mobile Tabs - Animated */}
      <div className="sticky top-0 z-10 border-b border-transparent bg-[var(--app-surface-solid)]">
        <div className="overflow-x-auto px-3 py-2 scrollbar-hide">
          <AnimatedTabNav
            tabs={tabs.map(tab => ({
              value: tab.id,
              label: tab.label,
              icon: tab.icon,
              badge: tab.badge || undefined,
            }))}
            activeTab={activeTab}
            onTabChange={setActiveTab}
          />
        </div>
      </div>

      {/* Mobile Tab Content */}
      <div className="flex-1 overflow-y-auto" id="mobile-lead-scroll">
        <div className={cn("p-4", isEditingContact && activeTab === 'contact' ? "pb-4" : "pb-8")}>
          {/* Activities Tab */}
          {activeTab === 'activities' && (
            <div className="space-y-6">
              {/* Cadência Section */}
              <div className="rounded-xl bg-white/[0.035] border border-white/[0.055] p-4 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center">
                      <ListTodo className="h-3.5 w-3.5 text-primary" />
                    </div>
                    <h3 className="font-medium text-sm">Cadência de atividades</h3>
                  </div>
                  {totalTasksCount > 0 && (
                    <Badge variant="outline" className="text-[10px]">
                      {completedTasksCount}/{totalTasksCount}
                    </Badge>
                  )}
                </div>

                {leadTasksLoading ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  </div>
                ) : templateTasks.length > 0 ? (
                  <div className="space-y-2">
                    {templateTasks.map((task) => {
                      const taskType = getCadenceTaskType(task.type);
                      const existingTask = leadTasksMap.get(`${task.title}-${task.day_offset}-${task.type}`);
                      const isDone = existingTask?.is_done || false;
                      const TaskIcon = activityTypeIcons[taskType] || Clock;
                      return (
                        <div
                          key={task.id}
                          onClick={() => handleCadenceTaskClick(task)}
                          className={cn(
                            "flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all active:scale-[0.98]",
                            isDone ? "bg-white/[0.045] border-white/[0.055]" : "hover:bg-white/[0.045] hover:border-primary/20",
                            taskType === 'message' && task.recommended_message && !isDone && "border-primary/30 bg-primary/5"
                          )}
                        >
                          <div className={cn(
                            "h-8 w-8 rounded-lg flex items-center justify-center shrink-0",
                            isDone ? "bg-gradient-to-br from-green-500 to-emerald-600" : "bg-gradient-to-br from-primary/80 to-primary"
                          )}>
                            {isDone ? <Check className="h-3.5 w-3.5 text-white" /> : <TaskIcon className="h-3.5 w-3.5 text-white" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={cn("text-sm font-medium truncate", isDone && "line-through text-muted-foreground")}>
                              {task.title}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {taskTypeLabels[taskType]} • Dia {task.day_offset}
                            </p>
                          </div>
                          {!isDone && <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-6 border border-dashed rounded-xl">
                    <p className="text-xs text-muted-foreground">Nenhuma cadência</p>
                  </div>
                )}
              </div>

              {/* Feedback Section */}
              <div className="rounded-xl bg-white/[0.035] border border-white/[0.055] p-4 shadow-sm space-y-4">
                <div className="flex items-center gap-2">
                  <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center">
                    <MessageCircle className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <h3 className="font-medium text-sm">Feedback do Lead</h3>
                </div>
                <Textarea
                  placeholder="Feedback sobre o lead..."
                  className="min-h-[120px] rounded-xl resize-none text-sm"
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                />
                <Button
                  className="w-full rounded-xl"
                  size="sm"
                  disabled={!feedback.trim() || createActivityMutation.isPending}
                  onClick={handleSaveFeedback}
                >
                  {createActivityMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Save className="h-4 w-4 mr-2" />
                  )}
                  Registrar Feedback
                </Button>
              </div>

            </div>
          )}


          {/* Schedule Tab */}
          {activeTab === 'schedule' && <div className="space-y-4">
              <div className="flex justify-end">
                <Button variant="default" onClick={() => {
                  setEditingScheduleEvent(null);
                  setScheduleDefaultType('call');
                  setScheduleFormOpen(true);
                }} className="rounded-xl h-11 px-6">
                  <Plus className="h-4 w-4 mr-2" />
                  Novo agendamento
                </Button>
              </div>

              <EventsList
                events={scheduleEvents}
                onEditEvent={handleEditScheduleEvent}
                onAddEvent={() => {
                  setEditingScheduleEvent(null);
                  setScheduleDefaultType('call');
                  setScheduleFormOpen(true);
                }}
              />
            </div>}

          {/* Contact Tab */}
          {activeTab === 'contact' && (
            <div className="space-y-4">
                {/* Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Contact className="h-3.5 w-3.5 text-primary" />
                    </div>
                    <h3 className="font-medium text-sm">Dados do contato</h3>
                  </div>
                {!isEditingContact && <Button variant="ghost" size="sm" onClick={() => {
                    setActiveTab('contact');
                    setIsEditingContact(true);
                  }} className="h-8 px-3 rounded-full">
                    <FileEdit className="h-3.5 w-3.5 mr-1" />
                    Editar
                  </Button>}
                </div>

              {/* Contact Info */}
              <div className="rounded-xl bg-white/[0.035] border border-white/[0.055] p-4 space-y-4">
                {isEditingContact ? (
                  <Accordion type="multiple" defaultValue={["personal"]} className="space-y-2">
                    {/* Informações Pessoais */}
                    <AccordionItem value="personal" className="border rounded-xl px-3">
                      <AccordionTrigger className="py-3 text-sm font-medium hover:no-underline">
                        <span className="flex items-center gap-2">
                          <User className="h-4 w-4 text-primary" />
                          Informações Pessoais
                        </span>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-3">
                          <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Nome</Label>
                            <Input value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} placeholder="Nome completo" onFocus={e => setTimeout(() => e.target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300)} />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">Telefone</Label>
                              <PhoneInput value={editForm.phone} onChange={value => setEditForm({ ...editForm, phone: value })} />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">Email</Label>
                              <Input value={editForm.email} onChange={e => setEditForm({ ...editForm, email: e.target.value })} placeholder="email@exemplo.com" type="email" onFocus={e => setTimeout(() => e.target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300)} />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">Cargo</Label>
                              <Input value={editForm.cargo} onChange={e => setEditForm({ ...editForm, cargo: e.target.value })} placeholder="Cargo" onFocus={e => setTimeout(() => e.target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300)} />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">Empresa</Label>
                              <Input value={editForm.empresa} onChange={e => setEditForm({ ...editForm, empresa: e.target.value })} placeholder="Empresa" onFocus={e => setTimeout(() => e.target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300)} />
                            </div>
                          </div>
                        </div>
                      </AccordionContent>
                    </AccordionItem>

                    {/* Endereço */}
                    <AccordionItem value="address" className="border rounded-xl px-3">
                      <AccordionTrigger className="py-3 text-sm font-medium hover:no-underline">
                        <span className="flex items-center gap-2">
                          <MapPin className="h-4 w-4 text-primary" />
                          Endereço
                        </span>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-3">
                          <Input value={editForm.endereco} onChange={e => setEditForm({ ...editForm, endereco: e.target.value })} placeholder="Endereço" onFocus={e => setTimeout(() => e.target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300)} />
                          <div className="grid grid-cols-3 gap-2">
                            <Input value={editForm.numero} onChange={e => setEditForm({ ...editForm, numero: e.target.value })} placeholder="Nº" onFocus={e => setTimeout(() => e.target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300)} />
                            <Input value={editForm.complemento} onChange={e => setEditForm({ ...editForm, complemento: e.target.value })} placeholder="Compl." className="col-span-2" onFocus={e => setTimeout(() => e.target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300)} />
                          </div>
                          <Input value={editForm.bairro} onChange={e => setEditForm({ ...editForm, bairro: e.target.value })} placeholder="Bairro" onFocus={e => setTimeout(() => e.target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300)} />
                          <div className="grid grid-cols-3 gap-2">
                            <Input value={editForm.cidade} onChange={e => setEditForm({ ...editForm, cidade: e.target.value })} placeholder="Cidade" className="col-span-2" onFocus={e => setTimeout(() => e.target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300)} />
                            <Input value={editForm.uf} onChange={e => setEditForm({ ...editForm, uf: e.target.value })} placeholder="UF" maxLength={2} onFocus={e => setTimeout(() => e.target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300)} />
                          </div>
                          <Input value={editForm.cep} onChange={e => setEditForm({ ...editForm, cep: e.target.value })} placeholder="CEP" onFocus={e => setTimeout(() => e.target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300)} />
                        </div>
                      </AccordionContent>
                    </AccordionItem>

                    {/* Perfil do Comprador */}
                    <AccordionItem value="financial" className="border rounded-xl px-3">
                      <AccordionTrigger className="py-3 text-sm font-medium hover:no-underline">
                        <span className="flex items-center gap-2">
                          <DollarSign className="h-4 w-4 text-primary" />
                          Perfil do Comprador
                        </span>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-3">
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">Renda Familiar</Label>
                              <Select value={editForm.renda_familiar || 'none'} onValueChange={v => setEditForm({ ...editForm, renda_familiar: v === 'none' ? '' : v })}>
                                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">Não informado</SelectItem>
                                  <SelectItem value="ate_3k">Até R$ 3.000</SelectItem>
                                  <SelectItem value="3k_5k">R$ 3.000 - R$ 5.000</SelectItem>
                                  <SelectItem value="5k_10k">R$ 5.000 - R$ 10.000</SelectItem>
                                  <SelectItem value="10k_15k">R$ 10.000 - R$ 15.000</SelectItem>
                                  <SelectItem value="15k_25k">R$ 15.000 - R$ 25.000</SelectItem>
                                  <SelectItem value="acima_25k">Acima de R$ 25.000</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">Trabalha</Label>
                              <Select value={editForm.trabalha ? 'sim' : 'nao'} onValueChange={v => setEditForm({ ...editForm, trabalha: v === 'sim' })}>
                                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="nao">Não</SelectItem>
                                  <SelectItem value="sim">Sim</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">Profissão</Label>
                              <Input value={editForm.profissao} onChange={e => setEditForm({ ...editForm, profissao: e.target.value })} placeholder="Ex: Engenheiro, Médico..." onFocus={e => setTimeout(() => e.target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300)} />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">Faixa do Imóvel</Label>
                              <Select value={editForm.faixa_valor_imovel || 'none'} onValueChange={v => setEditForm({ ...editForm, faixa_valor_imovel: v === 'none' ? '' : v })}>
                                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">Não informado</SelectItem>
                                  <SelectItem value="ate_200k">Até R$ 200.000</SelectItem>
                                  <SelectItem value="200k_400k">R$ 200.000 - R$ 400.000</SelectItem>
                                  <SelectItem value="400k_600k">R$ 400.000 - R$ 600.000</SelectItem>
                                  <SelectItem value="600k_1m">R$ 600.000 - R$ 1.000.000</SelectItem>
                                  <SelectItem value="1m_2m">R$ 1.000.000 - R$ 2.000.000</SelectItem>
                                  <SelectItem value="acima_2m">Acima de R$ 2.000.000</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">Finalidade da Compra</Label>
                              <Input value={editForm.finalidade_compra} onChange={e => setEditForm({ ...editForm, finalidade_compra: e.target.value })} placeholder="Ex: Moradia, Investimento..." onFocus={e => setTimeout(() => e.target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300)} />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">Procura Financiamento</Label>
                              <Select value={editForm.procura_financiamento ? 'sim' : 'nao'} onValueChange={v => setEditForm({ ...editForm, procura_financiamento: v === 'sim' })}>
                                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="nao">Não</SelectItem>
                                  <SelectItem value="sim">Sim</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                ) : <>
                    <div className="flex items-center gap-3 p-2.5 rounded-lg bg-background/50">
                      <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                        <User className="h-4 w-4 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground">Nome</p>
                        <p className="text-sm font-medium truncate">{lead.name}</p>
                      </div>
                    </div>
                    {lead.phone && <div className="flex items-center gap-3 p-2.5 rounded-lg bg-background/50">
                        <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                          <Phone className="h-4 w-4 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs text-muted-foreground">Telefone</p>
                          <p className="text-sm font-medium truncate">{formatPhoneForDisplay(lead.phone)}</p>
                        </div>
                      </div>}
                    {lead.email && <div className="flex items-center gap-3 p-2.5 rounded-lg bg-background/50">
                        <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                          <Mail className="h-4 w-4 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs text-muted-foreground">Email</p>
                          <p className="text-sm font-medium truncate">{lead.email}</p>
                        </div>
                      </div>}
                    {(lead.cargo || lead.empresa) && <div className="flex items-center gap-3 p-2.5 rounded-lg bg-background/50">
                        <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                          <Briefcase className="h-4 w-4 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs text-muted-foreground">Profissional</p>
                          <p className="text-sm font-medium truncate">
                            {[lead.cargo, lead.empresa].filter(Boolean).join(' • ')}
                          </p>
                        </div>
                      </div>}
                  </>}
              </div>

              {/* Address - Read only */}
              {!isEditingContact && (lead.endereco || lead.bairro || lead.cidade) && <div className="rounded-xl bg-white/[0.035] border border-white/[0.055] p-4">
                  <Label className="text-sm font-medium flex items-center gap-2 mb-3">
                    <MapPin className="h-4 w-4 text-primary" />
                    Endereço
                  </Label>
                  <div className="flex items-center gap-3 p-2.5 rounded-lg bg-background/50">
                    <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <MapPin className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm">
                        {[lead.endereco, lead.numero && `nº ${lead.numero}`, lead.complemento].filter(Boolean).join(', ')}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {[lead.bairro, lead.cidade, lead.uf].filter(Boolean).join(' - ')}
                        {lead.cep && ` • ${lead.cep}`}
                      </p>
                    </div>
                  </div>
                </div>}

              {/* Responsável */}
              <div className="rounded-xl bg-white/[0.035] border border-white/[0.055] p-4">
                <Label className="text-sm font-medium flex items-center gap-2 mb-3">
                  <User className="h-4 w-4 text-primary" />
                  Responsável
                </Label>
                <Popover open={assigneePopoverOpen} onOpenChange={setAssigneePopoverOpen}>
                  <PopoverTrigger asChild>
                    <button
                      disabled={!canTransferLead}
                      className="w-full flex items-center gap-3 p-3 rounded-xl border border-white/[0.055] hover:border-primary/30 hover:bg-white/[0.045] transition-all disabled:cursor-default disabled:hover:border-white/[0.055] disabled:hover:bg-transparent"
                    >
                      <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center relative overflow-hidden">
                        {assigneeName ? (
                          <>
                            <span className="text-sm font-semibold text-primary">
                              {assigneeName.split(' ').map((n: string) => n[0]).join('').substring(0, 2)}
                            </span>
                            {isUpdatingAssignee && (
                              <div className="absolute inset-0 bg-background/50 flex items-center justify-center">
                                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                              </div>
                            )}
                          </>
                        ) : <User className="h-5 w-5 text-muted-foreground" />}
                      </div>
                      <div className="flex-1 text-left min-w-0">
                        <p className="font-medium truncate">{assigneeName || 'Sem responsável'}</p>
                        {assigneeEmail && <p className="text-xs text-muted-foreground truncate">{assigneeEmail}</p>}
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[320px] sm:w-[380px] p-0 shadow-2xl border-primary/20" align="start">
                    <Command className="border-none">
                      <div className="flex items-center border-b px-3">
                        <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                        <CommandInput placeholder="Buscar responsável..." className="border-none focus:ring-0 h-11" />
                      </div>
                      <CommandList className="max-h-[450px] p-1 overflow-y-auto">
                        <CommandEmpty className="py-6 text-center text-sm text-muted-foreground">
                          Nenhum usuário encontrado.
                        </CommandEmpty>
                        <CommandGroup heading="Ações">
                          <CommandItem
                            onSelect={() => {
                              handleAssignUser(null);
                              setAssigneePopoverOpen(false);
                            }}
                            className="flex items-center gap-3 px-3 py-2.5 cursor-pointer rounded-lg"
                          >
                            <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                              <X className="h-5 w-5 text-muted-foreground" />
                            </div>
                            <div className="flex-1">
                              <p className="font-medium text-sm">Remover responsável</p>
                              <p className="text-[10px] text-muted-foreground">O lead ficará sem atribuição</p>
                            </div>
                          </CommandItem>
                        </CommandGroup>

                        <CommandGroup heading="Usuários">
                          {assignableUsers.map(user => {
                            const displayName = user.name || user.email || 'Usuário';
                            const initials = displayName.split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase();

                            return (
                              <CommandItem
                                key={user.id}
                                onSelect={() => {
                                  handleAssignUser(user.id);
                                  setAssigneePopoverOpen(false);
                                }}
                                className={cn(
                                  "flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-all rounded-lg my-0.5",
                                  user.id === localLead.assigned_user_id && "bg-primary/10 shadow-sm"
                                )}
                              >
                                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 border border-primary/5">
                                  {user.avatar_url ? (
                                    <Avatar className="h-10 w-10 rounded-lg">
                                      <AvatarImage src={user.avatar_url} alt={displayName} />
                                      <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                                        {initials}
                                      </AvatarFallback>
                                    </Avatar>
                                  ) : (
                                    <span className="text-sm font-semibold text-primary">
                                      {initials}
                                    </span>
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="font-semibold truncate text-sm">{displayName}</p>
                                  {user.email && <p className="text-[11px] text-muted-foreground truncate opacity-70">{user.email}</p>}
                                </div>
                                {user.id === localLead.assigned_user_id && (
                                  <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center ml-auto">
                                    <Check className="h-4 w-4 text-primary shrink-0" />
                                  </div>
                                )}
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                {canTransferLead && (
                  <div className="mt-2">
                    <SdrDistributionButton lead={lead} refetchStages={refetchStages} />
                  </div>
                )}
              </div>

              {/* Origem */}
              <div className="rounded-xl bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/20 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-7 w-7 rounded-lg bg-primary/20 flex items-center justify-center">
                    <Target className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <Label className="text-sm font-medium">{originLabels.title}</Label>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between p-2 rounded-lg">
                    <span className="text-sm text-muted-foreground">{originLabels.source}</span>
                    <div className="flex items-center gap-1.5">
                      <SourceIcon className="h-3.5 w-3.5 text-primary" />
                      <span className="text-sm font-medium">{sourceLabels[leadSource] || leadSource}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-lg">
                    <span className="text-sm text-muted-foreground">{originLabels.createdAt}</span>
                    <span className="text-sm font-medium">
                      {lead.created_at ? format(new Date(lead.created_at), 'dd/MM/yy HH:mm', {
                    locale: dateLocale
                  }) : '-'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Rastreamento / Tracking Section */}
              <LeadTrackingSection leadMeta={leadMeta ?? null} isLoading={leadMetaLoading} />
              <LeadJourneySection leadId={lead.id} />

            </div>
          )}

          {/* Messages Tab */}
          {activeTab === 'messages' && (
            <div className="space-y-4">
              <div className="rounded-xl bg-white/[0.035] border border-white/[0.055] p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-7 w-7 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                    <MessageCircle className="h-4 w-4 text-emerald-500" />
                  </div>
                  <Label className="text-sm font-medium">Histórico de Mensagens WhatsApp</Label>
                </div>
                <LeadMessagesTab leadId={lead.id} leadName={leadName} />
              </div>
            </div>
          )}

          {/* Deal Tab */}
          {activeTab === 'deal' && <div className="space-y-4">
              {/* Deal Status Section */}
              <div className="rounded-xl bg-white/[0.035] border border-white/[0.055] p-4 space-y-4">
                <div>
                  <Label className="text-xs text-muted-foreground mb-2 block">Status do Negócio</Label>
                  <Select
                    value={lead.deal_status || 'open'}
                    onValueChange={handleDealStatusChange}
                  >
                    <SelectTrigger className="rounded-xl">
                      <SelectValue placeholder="Selecionar status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">
                        <span className="flex items-center gap-2">
                          <CircleDot className="h-4 w-4 text-muted-foreground" />
                          Aberto
                        </span>
                      </SelectItem>
                      <SelectItem value="won">
                        <span className="flex items-center gap-2">
                          <Trophy className="h-4 w-4 text-emerald-600" />
                          Ganho
                        </span>
                      </SelectItem>
                      <SelectItem value="lost">
                        <span className="flex items-center gap-2">
                          <XCircle className="h-4 w-4 text-red-600" />
                          Perdido
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Lost Reason - show only when status is lost */}
                {lead.deal_status === 'lost' && (
                  <div>
                    <Label className="text-xs text-muted-foreground mb-2 block">Motivo da Perda</Label>
                    <Input
                      value={lostReasonLocal}
                      onChange={(e) => setLostReasonLocal(e.target.value)}
                      onBlur={async (e) => {
                        if (e.target.value !== (lead.lost_reason || '')) {
                          await updateLead.mutateAsync({
                            id: lead.id,
                            lost_reason: e.target.value
                          });
                          refetchStages();
                        }
                      }}
                      placeholder="Ex: Preço alto, escolheu concorrente..."
                      className="rounded-xl"
                    />
                  </div>
                )}
              </div>

              <div className="rounded-xl bg-white/[0.035] border border-white/[0.055] p-4 space-y-4">
                <div>
                  <Label className="text-xs text-muted-foreground mb-2 block">Imóvel de interesse</Label>
                  <PropertyPickerDialog
                    properties={properties}
                    selectedPropertyId={lead.interest_property_id}
                    onSelect={(p) => {
                      const propertyPrice = p.preco || null;
                      setEditForm({
                        ...editForm,
                        valor_interesse: propertyPrice ? propertyPrice.toString() : editForm.valor_interesse
                      });
                      updateLead.mutateAsync({
                        id: lead.id,
                        interest_property_id: p.id,
                        valor_interesse: propertyPrice || lead.valor_interesse
                      }).then(() => refetchStages());
                    }}
                  />
                </div>

                <div>
                  <Label className="text-xs text-muted-foreground mb-2 block">Valor de interesse</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input type="number" value={editForm.valor_interesse} onChange={e => setEditForm({
                      ...editForm,
                      valor_interesse: e.target.value
                    })} onBlur={() => {
                      if (editForm.valor_interesse !== (lead.valor_interesse != null ? lead.valor_interesse.toString() : '')) {
                        updateLead.mutateAsync({
                          id: lead.id,
                              valor_interesse: editForm.valor_interesse ? parseFloat(editForm.valor_interesse) : null
                        });
                      }
                    }} placeholder="0,00" className="pl-9 rounded-xl" />
                  </div>
                </div>
              </div>

              {/* Deal Status Summary Card */}
              {lead.deal_status === 'won' && interestValue > 0 && (
                <div className="rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-950/30 dark:to-emerald-900/30 border border-emerald-200 dark:border-emerald-800 p-4">
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center">
                      <Trophy className="h-6 w-6 text-white" />
                    </div>
                    <div>
                      <p className="text-xl font-bold text-emerald-700 dark:text-emerald-300">
                        R$ {interestValue.toLocaleString('pt-BR')}
                      </p>
                      <p className="text-sm text-emerald-600 dark:text-emerald-400">Negócio Fechado!</p>
                    </div>
                  </div>
                </div>
              )}

              {lead.deal_status !== 'won' && interestValue > 0 && (
                <div className="rounded-xl bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/20 p-4">
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center">
                      <DollarSign className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                      <p className="text-xl font-bold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
                        R$ {interestValue.toLocaleString('pt-BR')}
                      </p>
                      <p className="text-sm text-muted-foreground">Valor de interesse</p>
                    </div>
                  </div>
                </div>
              )}
            </div>}

          {/* History Tab */}

          {/* History Tab */}
          {activeTab === 'history' && (
            <div className="space-y-4">
              <LeadHistory leadId={lead.id} onEventClick={(event) => {
                setSelectedHistoryEvent(event);
                setHistoryEventDialogOpen(true);
              }} />
            </div>
          )}
        </div>
      </div>

      {/* Sticky Footer - Save/Cancel buttons */}
      {isEditingContact && activeTab === 'contact' && (
        <div className="border-t bg-background p-3 flex gap-2 shrink-0">
          <Button variant="outline" className="flex-1 rounded-xl" onClick={() => {
            resetContactEditForm();
            setIsEditingContact(false);
          }}>
            Cancelar
          </Button>
          <Button className="flex-1 rounded-xl" onClick={handleSaveContact}>
            <Save className="h-4 w-4 mr-1.5" />
            Salvar
          </Button>
        </div>
      )}
    </div>);

  // Desktop content - defined as JSX variable (NOT a component function) to prevent re-mounting
  const DesktopContent = () => (
    <div className="lead-detail-dialog flex h-full max-h-[84vh] flex-col bg-[var(--app-surface-solid)] text-[var(--app-text-primary)]">
      <div className="relative overflow-hidden border-b border-[var(--app-border)] bg-[var(--app-surface-solid)] p-5">

        <DialogHeader className="relative mb-4">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <Badge variant="outline" className="rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-xs font-normal text-[var(--app-text-secondary)]">
              {currentStage?.name || 'Sem estágio'}
            </Badge>
            <span className="text-muted-foreground/50">•</span>
            <div className="flex items-center gap-1.5">
              <SourceIcon className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs text-muted-foreground">{sourceLabels[leadSource] || leadSource}</span>
            </div>
            <span className="text-muted-foreground/50">•</span>
            {/* Deal Status Badge */}
            <Select
              value={lead.deal_status || 'open'}
              onValueChange={handleDealStatusChange}
            >
              <SelectTrigger
                className={cn(
                  "h-7 w-auto gap-1.5 rounded-[6px] border-0 px-3 text-xs font-medium",
                  lead.deal_status === 'won' && "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300",
                  lead.deal_status === 'lost' && "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",
                  (!lead.deal_status || lead.deal_status === 'open') && "bg-muted text-muted-foreground"
                )}
              >
                {lead.deal_status === 'won' && <Trophy className="h-3 w-3" />}
                {lead.deal_status === 'lost' && <XCircle className="h-3 w-3" />}
                {(!lead.deal_status || lead.deal_status === 'open') && <CircleDot className="h-3 w-3" />}
                <span>
                  {lead.deal_status === 'won' ? 'Ganho' : lead.deal_status === 'lost' ? 'Perdido' : 'Aberto'}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">
                  <span className="flex items-center gap-2">
                    <CircleDot className="h-4 w-4 text-muted-foreground" />
                    Aberto
                  </span>
                </SelectItem>
                <SelectItem value="won">
                  <span className="flex items-center gap-2">
                    <Trophy className="h-4 w-4 text-emerald-600" />
                    Ganho
                  </span>
                </SelectItem>
                <SelectItem value="lost">
                  <span className="flex items-center gap-2">
                    <XCircle className="h-4 w-4 text-red-600" />
                    Perdido
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
            {leadTags.map((tag) => {
              const tagColor = getTagColor(tag);
              return (
                <Badge
                  key={tag.id}
                  className="flex items-center gap-1 rounded-[6px] py-1 pr-1.5 text-[11px]"
                  style={{ backgroundColor: tagColor, color: '#FFFFFF', borderColor: tagColor }}
                >
                  {tag.name || 'Tag'}
                  <button onClick={() => handleRemoveTag(tag.id)} className="ml-0.5 hover:bg-black/10 rounded-full p-0.5 transition-colors">
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              );
            })}
            <Popover open={tagPopoverOpen} onOpenChange={setTagPopoverOpen}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2 text-xs text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary">
                  <Plus className="h-3 w-3 mr-1" />
                  Tag
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-0" align="start">
                <TagSelectorPopoverContent
                  availableTags={availableTags}
                  onAddTag={handleAddTag}
                  onClose={() => setTagPopoverOpen(false)}
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="flex items-center gap-4">
            {/* Premium Avatar with ring */}
            <div className="relative">

              <Avatar className="relative h-14 w-14 border-0">
                <AvatarImage src={lead.whatsapp_picture || undefined} alt={lead.name} />
                <AvatarFallback className="bg-primary text-primary-foreground text-lg font-semibold">
                  {lead.name?.[0]?.toUpperCase() || <User className="h-7 w-7" />}
                </AvatarFallback>
              </Avatar>
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <DialogTitle className="text-xl font-semibold truncate">{localLead.name}</DialogTitle>
                <ReentryBadge count={lead.reentry_count} lastEntryAt={lead.last_entry_at} />
                {lead.first_response_seconds != null && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-gradient-to-r from-amber-500/10 via-yellow-500/10 to-orange-500/10 border border-yellow-500/20 text-amber-600 dark:text-amber-400 whitespace-nowrap shrink-0">
                    <Zap className="h-3 w-3" />
                    Primeiro contato: {formatResponseTime(lead.first_response_seconds)}
                    {lead.first_response_is_automation && (
                      <span className="text-[9px] ml-0.5 opacity-70 flex items-center gap-0.5">
                        <Bot className="h-2.5 w-2.5" />
                        Auto
                      </span>
                    )}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-1">
                {lead.empresa && <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5" />
                    <span className="truncate">{lead.empresa}</span>
                  </p>}
                {/* Assignee Selector */}
                <Popover open={assigneePopoverOpen} onOpenChange={setAssigneePopoverOpen}>
                  <PopoverTrigger asChild>
                    <button
                      disabled={!canTransferLead}
                    className="relative flex items-center gap-1.5 overflow-hidden rounded-[6px] px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-[var(--app-surface-soft)] hover:text-foreground disabled:cursor-default disabled:hover:bg-transparent"
                    >
                      <User className="h-3.5 w-3.5" />
                      <span>{assigneeName || 'Sem responsável'}</span>
                      {isUpdatingAssignee ? (
                        <Loader2 className="h-3 w-3 animate-spin text-primary" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      )}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[300px] border-0 p-0 shadow-[0_18px_50px_rgba(0,0,0,0.16)]" align="start">
                    <Command className="border-none">
                      <div className="flex items-center border-b px-3">
                        <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                        <CommandInput placeholder="Buscar..." className="border-none focus:ring-0 h-10" />
                      </div>
                      <CommandList className="max-h-[350px] p-1 overflow-y-auto">
                        <CommandEmpty className="py-4 text-center text-sm text-muted-foreground">
                          Nenhum encontrado.
                        </CommandEmpty>
                        <CommandGroup>
                          <CommandItem
                            onSelect={() => {
                              handleAssignUser(null);
                              setAssigneePopoverOpen(false);
                            }}
                            className={cn(
                              "flex items-center gap-2.5 px-3 py-2.5 cursor-pointer transition-colors rounded-lg",
                              !localLead.assigned_user_id && "bg-accent"
                            )}
                          >
                            <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center shrink-0">
                              <User className="h-3.5 w-3.5 text-muted-foreground" />
                            </div>
                            <span className="text-muted-foreground text-sm font-medium">Sem responsável</span>
                          </CommandItem>
                          {assignableUsers.map((user) => {
                            const displayName = user.name || user.email || 'Usuário';
                            const initial = displayName[0]?.toUpperCase() || 'U';

                            return (
                              <CommandItem
                                key={user.id}
                                onSelect={() => {
                                  handleAssignUser(user.id);
                                  setAssigneePopoverOpen(false);
                                }}
                                className={cn(
                                  "flex items-center gap-2.5 px-3 py-2.5 cursor-pointer transition-all rounded-lg my-0.5",
                                  localLead.assigned_user_id === user.id && "bg-primary/10"
                                )}
                              >
                                <Avatar className="h-8 w-8 shrink-0 border-0">
                                  <AvatarImage src={user.avatar_url || undefined} alt={displayName} />
                                  <AvatarFallback className="text-[10px] bg-primary/10 text-primary font-bold">
                                    {initial}
                                  </AvatarFallback>
                                </Avatar>
                                <span className="text-sm font-medium truncate">{displayName}</span>
                                {localLead.assigned_user_id === user.id && (
                                  <div className="h-5 w-5 rounded-full bg-primary/20 flex items-center justify-center ml-auto">
                                    <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                                  </div>
                                )}
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>

                {canTransferLead && <SdrDistributionButton lead={lead} refetchStages={refetchStages} />}
              </div>
            </div>

            {/* Quick Actions - Premium pills */}
            <div className="flex items-center gap-2 shrink-0">
              {lead.phone && <>
                  <Button variant="outline" size="sm" onClick={handleQuickPhone} className="h-9 w-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] p-0 transition-colors hover:bg-primary/10 hover:text-primary">
                    <Phone className="h-4 w-4" />
                  </Button>
                  <Button size="sm" onClick={handleQuickWhatsApp} className="h-9 rounded-[6px] bg-primary px-4 text-white transition-opacity hover:bg-primary hover:opacity-90">
                    <MessageCircle className="h-4 w-4 mr-1.5" />
                    Chat
                  </Button>
                </>}
              {lead.email && <Button variant="outline" size="sm" onClick={handleQuickEmail} className="h-9 w-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] p-0 transition-colors hover:bg-primary/10 hover:text-primary">
                  <Mail className="h-4 w-4" />
                </Button>}
            </div>
          </div>
        </DialogHeader>


        {/* Pipeline Timeline - Stage Stepper */}
        <div className="mt-3 overflow-hidden">
          <ScrollArea className="w-full" type="scroll">
            <TooltipProvider delayDuration={0}>
              <nav className="stage-tab-nav">
                {stages.map((stage, idx) => {
                  const isActive = stage.id === lead.stage_id;
                  const isPast = idx < currentStageIndex;
                  return (
                    <Tooltip key={stage.id}>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => handleMoveToStage(stage.id)}
                          aria-label={`Mover para ${stage.name}`}
                          title={stage.name}
                          className={cn(
                            "stage-tab-link",
                            isActive && "active",
                            isPast && !isActive && "past"
                          )}
                          type="button"
                        >
                          <span className="stage-tab-icon">
                            {isPast && !isActive ? (
                              <Check className="h-3 w-3" />
                            ) : (
                              <span>{idx + 1}</span>
                            )}
                          </span>
                          <span className="stage-tab-title sr-only">
                            {stage.name}
                          </span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="text-xs font-medium">
                        {stage.name}
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </nav>
            </TooltipProvider>
            <ScrollBar orientation="horizontal" className="h-1.5" />
          </ScrollArea>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          {/* Premium Tabs */}
          <div className="sticky top-0 z-30 border-b border-[var(--app-border)] bg-[var(--app-surface-solid)] px-6">
            <TabsList className="-mb-px h-12 justify-start gap-1 bg-transparent p-0">
              {tabs.map(tab => {
              const Icon = tab.icon;
              return <TabsTrigger key={tab.id} value={tab.id} className="h-10 gap-2 rounded-[6px] px-4 text-muted-foreground transition-colors data-[state=active]:bg-[var(--app-surface-soft)] data-[state=active]:text-[var(--app-text-primary)]">
                    <Icon className="h-4 w-4" />
                    {tab.label}
                    {tab.badge && <Badge variant="secondary" className="h-5 px-1.5 text-[10px] ml-1">
                        {tab.badge}
                      </Badge>}
                  </TabsTrigger>;
            })}
            </TabsList>
          </div>

          {/* Atividades Tab */}
          <TabsContent value="activities" className="p-6 mt-0">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Coluna Esquerda: Cadência */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <ListTodo className="h-4 w-4 text-primary" />
                  </div>
                  <h3 className="font-semibold">Cadência de atividades</h3>
                  {totalTasksCount > 0 && (
                    <Badge variant="outline" className="font-normal ml-auto">
                      {completedTasksCount}/{totalTasksCount}
                    </Badge>
                  )}
                </div>

                {leadTasksLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-primary/20" />
                  </div>
                ) : templateTasks.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1.5">
                      <CheckCircle className="h-3 w-3" />
                      Cadência atual: <span className="font-medium text-foreground">{stageTemplate?.name}</span>
                    </p>
                    {templateTasks.map((task) => {
                      const taskType = getCadenceTaskType(task.type);
                      const existingTask = leadTasksMap.get(`${task.title}-${task.day_offset}-${task.type}`);
                      const isDone = existingTask?.is_done || false;
                      const TaskIcon = activityTypeIcons[taskType] || Clock;
                      return (
                        <div
                          key={task.id}
                          className={cn(
                            "group flex items-center gap-3 p-3.5 rounded-xl border cursor-pointer transition-all",
                            isDone ? "bg-white/[0.045] border-white/[0.055]" : "hover:bg-white/[0.045] hover:border-primary/20 hover:shadow-sm hover:-translate-y-0.5",
                            taskType === 'message' && task.recommended_message && !isDone && "border-primary/30 bg-primary/5"
                          )}
                          onClick={() => handleCadenceTaskClick(task)}
                        >
                          <div className={cn(
                            "h-9 w-9 rounded-xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-105",
                            isDone ? "bg-gradient-to-br from-green-500 to-emerald-600" : "bg-gradient-to-br from-primary/80 to-primary"
                          )}>
                            {isDone ? <Check className="h-4 w-4 text-white" /> : <TaskIcon className="h-4 w-4 text-white" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={cn("text-sm font-medium truncate", isDone && "line-through text-muted-foreground")}>
                              {task.title}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {taskTypeLabels[taskType]} • Dia {task.day_offset}
                            </p>
                          </div>
                          {!isDone && <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-10 border border-dashed rounded-xl bg-muted/20">
                    <ListTodo className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                    <p className="font-medium text-muted-foreground">Nenhuma cadência configurada</p>
                  </div>
                )}
              </div>

              {/* Coluna Direita: Feedback */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <MessageCircle className="h-4 w-4 text-primary" />
                  </div>
                  <h3 className="font-semibold">Feedback do Lead</h3>
                </div>

                <div className="space-y-3">
                  <Textarea
                    placeholder="Digite aqui o feedback sobre o atendimento ou perfil do lead..."
                    className="min-h-[150px] rounded-xl resize-none focus-visible:ring-primary/20"
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                  />
                  <Button
                    className="w-full rounded-xl"
                    disabled={!feedback.trim() || createActivityMutation.isPending}
                    onClick={handleSaveFeedback}
                  >
                    {createActivityMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Save className="h-4 w-4 mr-2" />
                    )}
                    Registrar Feedback
                  </Button>
                </div>

              </div>
            </div>
          </TabsContent>

          {/* Schedule Tab */}
          <TabsContent value="schedule" className="p-6 mt-0">
            <div className="space-y-4">
              <div className="flex justify-end">
                <Button variant="default" onClick={() => {
                  setEditingScheduleEvent(null);
                  setScheduleDefaultType('call');
                  setScheduleFormOpen(true);
                }} className="rounded-xl h-11 px-6">
                  <Plus className="h-4 w-4 mr-2" />
                  Novo agendamento
                </Button>
              </div>

              <EventsList
                events={scheduleEvents}
                onEditEvent={handleEditScheduleEvent}
                onAddEvent={() => {
                  setEditingScheduleEvent(null);
                  setScheduleDefaultType('call');
                  setScheduleFormOpen(true);
                }}
              />
            </div>
          </TabsContent>

          {/* Contact Tab */}
          <TabsContent value="contact" className="p-6 mt-0">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Coluna 1: Dados do Contato + Documentação */}
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Contact className="h-3.5 w-3.5 text-primary" />
                      </div>
                      <h3 className="font-medium text-sm">Dados do contato</h3>
                    </div>
                      {!isEditingContact ? <Button variant="ghost" size="sm" onClick={() => {
                        setActiveTab('contact');
                        setIsEditingContact(true);
                      }} className="h-8 px-3 rounded-full">
                        <FileEdit className="h-3.5 w-3.5 mr-1" />
                        Editar
                      </Button> : <div className="flex gap-2">
                        <Button variant="ghost" size="sm" onClick={() => {
                          resetContactEditForm();
                          setIsEditingContact(false);
                        }} className="h-8 px-3 rounded-full">
                          Cancelar
                        </Button>
                        <Button size="sm" onClick={handleSaveContact} className="h-8 px-3 rounded-full">
                          <Save className="h-3.5 w-3.5 mr-1" />
                          Salvar
                        </Button>
                      </div>}
                  </div>

                  <div className="rounded-xl bg-white/[0.035] border border-white/[0.055] p-4 space-y-4">
                    {isEditingContact ? (
                      <div className="space-y-3">
                        <Label className="text-sm font-medium flex items-center gap-2">
                          <User className="h-4 w-4 text-primary" />
                          Informações Pessoais
                        </Label>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5 col-span-2">
                            <Label className="text-xs text-muted-foreground">Nome</Label>
                            <Input value={editForm.name} onChange={e => setEditForm({
                              ...editForm,
                              name: e.target.value
                            })} placeholder="Nome completo" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Telefone</Label>
                            <PhoneInput value={editForm.phone} onChange={value => setEditForm({
                              ...editForm,
                              phone: value
                            })} />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Email</Label>
                            <Input value={editForm.email} onChange={e => setEditForm({
                              ...editForm,
                              email: e.target.value
                            })} placeholder="email@exemplo.com" type="email" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Cargo</Label>
                            <Input value={editForm.cargo} onChange={e => setEditForm({
                              ...editForm,
                              cargo: e.target.value
                            })} placeholder="Cargo" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Empresa</Label>
                            <Input value={editForm.empresa} onChange={e => setEditForm({
                              ...editForm,
                              empresa: e.target.value
                            })} placeholder="Empresa" />
                          </div>
                        </div>

                        {/* Perfil Financeiro */}
                        <div className="space-y-3 pt-3 border-t">
                          <Label className="text-sm font-medium flex items-center gap-2">
                            <DollarSign className="h-4 w-4 text-primary" />
                            Perfil Financeiro
                          </Label>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">Renda Familiar</Label>
                              <Select value={editForm.renda_familiar || 'none'} onValueChange={v => setEditForm({
                                ...editForm,
                                renda_familiar: v === 'none' ? '' : v
                              })}>
                                <SelectTrigger>
                                  <SelectValue placeholder="Selecione" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">Não informado</SelectItem>
                                  <SelectItem value="ate_3k">Até R$ 3.000</SelectItem>
                                  <SelectItem value="3k_5k">R$ 3.000 - R$ 5.000</SelectItem>
                                  <SelectItem value="5k_10k">R$ 5.000 - R$ 10.000</SelectItem>
                                  <SelectItem value="10k_15k">R$ 10.000 - R$ 15.000</SelectItem>
                                  <SelectItem value="15k_25k">R$ 15.000 - R$ 25.000</SelectItem>
                                  <SelectItem value="acima_25k">Acima de R$ 25.000</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">Trabalha</Label>
                              <Select value={editForm.trabalha ? 'sim' : 'nao'} onValueChange={v => setEditForm({
                                ...editForm,
                                trabalha: v === 'sim'
                              })}>
                                <SelectTrigger>
                                  <SelectValue placeholder="Selecione" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="nao">Não</SelectItem>
                                  <SelectItem value="sim">Sim</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">Profissão</Label>
                              <Input value={editForm.profissao} onChange={e => setEditForm({
                                ...editForm,
                                profissao: e.target.value
                              })} placeholder="Ex: Engenheiro, Médico..." />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">Faixa do Imóvel</Label>
                              <Select value={editForm.faixa_valor_imovel || 'none'} onValueChange={v => setEditForm({
                                ...editForm,
                                faixa_valor_imovel: v === 'none' ? '' : v
                              })}>
                                <SelectTrigger>
                                  <SelectValue placeholder="Selecione" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">Não informado</SelectItem>
                                  <SelectItem value="ate_200k">Até R$ 200.000</SelectItem>
                                  <SelectItem value="200k_400k">R$ 200.000 - R$ 400.000</SelectItem>
                                  <SelectItem value="400k_600k">R$ 400.000 - R$ 600.000</SelectItem>
                                  <SelectItem value="600k_1m">R$ 600.000 - R$ 1.000.000</SelectItem>
                                  <SelectItem value="1m_2m">R$ 1.000.000 - R$ 2.000.000</SelectItem>
                                  <SelectItem value="acima_2m">Acima de R$ 2.000.000</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">Finalidade da Compra</Label>
                              <Input value={editForm.finalidade_compra} onChange={e => setEditForm({
                                ...editForm,
                                finalidade_compra: e.target.value
                              })} placeholder="Ex: Moradia, Investimento..." />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">Procura Financiamento</Label>
                              <Select value={editForm.procura_financiamento ? 'sim' : 'nao'} onValueChange={v => setEditForm({
                                ...editForm,
                                procura_financiamento: v === 'sim'
                              })}>
                                <SelectTrigger>
                                  <SelectValue placeholder="Selecione" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="nao">Não</SelectItem>
                                  <SelectItem value="sim">Sim</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          <div className="flex items-center space-x-2 pt-2">
                            <Checkbox
                              id="is_own_resource_edit"
                              checked={editForm.is_own_resource}
                              onCheckedChange={(checked) => setEditForm({ ...editForm, is_own_resource: !!checked })}
                            />
                            <Label htmlFor="is_own_resource_edit" className="text-xs font-medium cursor-pointer">
                              Possui Recurso Próprio para Fechamento
                            </Label>
                          </div>
                        </div>

                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex items-center gap-3 p-2.5 rounded-lg bg-background/50">
                          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                            <User className="h-4 w-4 text-primary" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs text-muted-foreground">Nome</p>
                            <p className="text-sm font-medium truncate">{lead.name}</p>
                          </div>
                        </div>
                        {lead.phone && <div className="flex items-center gap-3 p-2.5 rounded-lg bg-background/50">
                          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                            <Phone className="h-4 w-4 text-primary" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs text-muted-foreground">Telefone</p>
                            <p className="text-sm font-medium truncate">{formatPhoneForDisplay(lead.phone)}</p>
                          </div>
                        </div>}
                        {lead.email && <div className="flex items-center gap-3 p-2.5 rounded-lg bg-background/50">
                          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                            <Mail className="h-4 w-4 text-primary" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs text-muted-foreground">Email</p>
                            <p className="text-sm font-medium truncate">{lead.email}</p>
                          </div>
                        </div>}
                        {(lead.cargo || lead.empresa) && <div className="flex items-center gap-3 p-2.5 rounded-lg bg-background/50">
                          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                            <Briefcase className="h-4 w-4 text-primary" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs text-muted-foreground">Profissional</p>
                            <p className="text-sm font-medium truncate">
                              {[lead.cargo, lead.empresa].filter(Boolean).join(' • ')}
                            </p>
                          </div>
                        </div>}
                      </div>
                    )}
                  </div>

                  {/* Documentação Section */}
                  {!isEditingContact && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center">
                            <FileText className="h-3.5 w-3.5 text-primary" />
                          </div>
                          <h3 className="font-medium text-sm">Documentação</h3>
                        </div>
                        {(profile?.role === 'admin' || profile?.id === lead.assigned_user_id) && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 gap-1.5 px-3"
                              disabled={isUploading}
                              onClick={() => fileInputRef.current?.click()}
                            >
                              {isUploading ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Paperclip className="h-3.5 w-3.5" />
                              )}
                              {isUploading ? 'Enviando...' : 'Anexar'}
                            </Button>
                            <input
                              type="file"
                              ref={fileInputRef}
                              onChange={handleFileUpload}
                              className="hidden"
                            />
                          </>
                        )}
                      </div>

                      <div className="rounded-xl bg-white/[0.035] border border-white/[0.055] p-3 min-h-[100px] flex flex-col">
                        {attachments.length === 0 ? (
                          <div className="flex-1 flex flex-col items-center justify-center py-4 text-muted-foreground gap-2">
                            <FileText className="h-8 w-8 opacity-20" />
                            <p className="text-xs">Nenhum documento anexado</p>
                          </div>
                        ) : (
                          <div className="grid gap-2">
                            {attachments.map((doc) => {
                              const truncateFileName = (name: string, maxLength: number = 20) => {
                                if (name.length <= maxLength) return name;
                                const lastDotIndex = name.lastIndexOf('.');
                                if (lastDotIndex === -1) return name.substring(0, maxLength) + '...';

                                const extension = name.substring(lastDotIndex);
                                const nameWithoutExtension = name.substring(0, lastDotIndex);
                                return `${nameWithoutExtension.substring(0, maxLength)}...${extension}`;
                              };

                              return (
                                <div
                                  key={doc.id}
                                  className="flex items-center gap-3 p-2.5 rounded-lg bg-background/50 hover:bg-accent transition-colors group"
                                >
                                  <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                                    <FileText className="h-4 w-4 text-primary" />
                                  </div>
                                  <div className="min-w-0 flex-1 overflow-hidden">
                                    <p className="text-sm font-medium truncate w-full" title={doc.file_name}>
                                      {truncateFileName(doc.file_name)}
                                    </p>
                                    <p className="text-[10px] text-muted-foreground">
                                      {format(new Date(doc.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-1 shrink-0 ml-auto">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7"
                                      onClick={() => window.open(doc.file_url, '_blank')}
                                      title="Visualizar"
                                    >
                                      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7"
                                      onClick={() => {
                                        const link = document.createElement('a');
                                        link.href = doc.file_url;
                                        link.download = doc.file_name;
                                        link.target = '_blank';
                                        link.click();
                                      }}
                                      title="Baixar"
                                    >
                                      <Download className="h-3.5 w-3.5 text-muted-foreground" />
                                    </Button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Coluna 2: Rastreamento + Jornada */}
                <div className="space-y-6">
                  <div className="rounded-xl bg-white/[0.035] border border-white/[0.055] p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center">
                          <BarChart3 className="h-3.5 w-3.5 text-primary" />
                        </div>
                        <h3 className="font-medium text-sm">Rastreamento</h3>
                      </div>
                    </div>
              <LeadTrackingSection leadMeta={leadMeta ?? null} isLoading={leadMetaLoading} />
                    <LeadJourneySection leadId={lead.id} />
                  </div>
                </div>
              </div>
          </TabsContent>

          {/* Deal Tab */}
          <TabsContent value="deal" className="p-6 mt-0">
            <div className="space-y-4">
              {/* Deal Status Section */}
              <div className="rounded-xl bg-white/[0.035] border border-white/[0.055] p-4 space-y-4">
                <div>
                  <Label className="text-xs text-muted-foreground mb-2 block">Status do Negócio</Label>
                  <Select
                    value={lead.deal_status || 'open'}
                    onValueChange={handleDealStatusChange}
                  >
                    <SelectTrigger className="rounded-xl">
                      <SelectValue placeholder="Selecionar status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">
                        <span className="flex items-center gap-2">
                          <CircleDot className="h-4 w-4 text-muted-foreground" />
                          Aberto
                        </span>
                      </SelectItem>
                      <SelectItem value="won">
                        <span className="flex items-center gap-2">
                          <Trophy className="h-4 w-4 text-emerald-600" />
                          Ganho
                        </span>
                      </SelectItem>
                      <SelectItem value="lost">
                        <span className="flex items-center gap-2">
                          <XCircle className="h-4 w-4 text-red-600" />
                          Perdido
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Lost Reason - show only when status is lost */}
                {lead.deal_status === 'lost' && (
                  <div>
                    <Label className="text-xs text-muted-foreground mb-2 block">Motivo da Perda</Label>
                    <Input
                      value={lostReasonLocal}
                      onChange={(e) => setLostReasonLocal(e.target.value)}
                      onBlur={async (e) => {
                        if (e.target.value !== (lead.lost_reason || '')) {
                          await updateLead.mutateAsync({
                            id: lead.id,
                            lost_reason: e.target.value
                          });
                          refetchStages();
                        }
                      }}
                      placeholder="Ex: Preço alto, escolheu concorrente..."
                      className="rounded-xl"
                    />
                  </div>
                )}
              </div>

              <div className="rounded-xl bg-white/[0.035] border border-white/[0.055] p-4 space-y-4">
                <div>
                  <Label className="text-xs text-muted-foreground mb-2 block">Imóvel de interesse</Label>
                  <PropertyPickerDialog
                    properties={properties}
                    selectedPropertyId={lead.interest_property_id || editForm.property_id || null}
                    onSelect={(p) => {
                      const propertyPrice = p.preco || null;
                      const propertyCommission = p.commission_percentage || null;
                      setEditForm({
                        ...editForm,
                        property_id: p.id,
                        valor_interesse: propertyPrice ? propertyPrice.toString() : editForm.valor_interesse,
                        commission_percentage: propertyCommission ? propertyCommission.toString() : editForm.commission_percentage
                      });
                      const updateData: Partial<Lead> & { id: string } = {
                        id: lead.id,
                        interest_property_id: p.id
                      };
                      if (propertyPrice) {
                        updateData.valor_interesse = propertyPrice;
                      }
                      if (propertyCommission) {
                        updateData.commission_percentage = propertyCommission;
                      }
                      updateLead.mutateAsync(updateData).then(() => refetchStages());
                    }}
                  />
                </div>

                {/* Value and Commission fields side by side */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-2 block">Valor de interesse</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">R$</span>
                      <Input
                        value={formatCurrencyDisplay(editForm.valor_interesse)}
                        onChange={e => setEditForm({
                          ...editForm,
                          valor_interesse: parseCurrencyInput(e.target.value)
                        })}
                        onBlur={() => {
                          const newValue = editForm.valor_interesse ? parseFloat(editForm.valor_interesse) : null;
                          if (newValue !== lead.valor_interesse) {
                            updateLead.mutateAsync({
                              id: lead.id,
                              valor_interesse: newValue
                            });
                          }
                        }}
                        placeholder="0"
                        className="pl-9 rounded-xl"
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-2 block">Comissão (%)</Label>
                    <div className="relative">
                      <Input
                        type="number"
                        step="0.1"
                        min="0"
                        max="100"
                        value={editForm.commission_percentage}
                        onChange={e => setEditForm({
                          ...editForm,
                          commission_percentage: e.target.value
                        })}
                        onBlur={() => {
                          const newValue = editForm.commission_percentage ? parseFloat(editForm.commission_percentage) : null;
                          if (newValue !== lead.commission_percentage) {
                            updateLead.mutateAsync({
                              id: lead.id,
                              commission_percentage: newValue
                            });
                          }
                        }}
                        placeholder="0"
                        className="pr-7 rounded-xl"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                    </div>
                  </div>
                </div>

                {/* Commission Value Card */}
                {parseFloat(editForm.valor_interesse) > 0 && parseFloat(editForm.commission_percentage) > 0 && (
                  <div className="p-4 bg-gradient-to-br from-orange-50 to-amber-50 dark:from-orange-950/30 dark:to-amber-950/30 border border-orange-200 dark:border-orange-800 rounded-xl">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center">
                        <DollarSign className="h-5 w-5 text-white" />
                      </div>
                      <div>
                        <p className="text-lg font-bold text-orange-700 dark:text-orange-300">
                          Comissão: R$ {(parseFloat(editForm.valor_interesse) * parseFloat(editForm.commission_percentage) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                        <p className="text-xs text-orange-600 dark:text-orange-400">
                          {editForm.commission_percentage}% de R$ {parseFloat(editForm.valor_interesse).toLocaleString('pt-BR')}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Deal Status Summary Card */}
              {lead.deal_status === 'won' && interestValue > 0 && (
                <div className="rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-950/30 dark:to-emerald-900/30 border border-emerald-200 dark:border-emerald-800 p-4">
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center">
                      <Trophy className="h-6 w-6 text-white" />
                    </div>
                    <div>
                      <p className="text-xl font-bold text-emerald-700 dark:text-emerald-300">
                        R$ {interestValue.toLocaleString('pt-BR')}
                      </p>
                      <p className="text-sm text-emerald-600 dark:text-emerald-400">Negócio Fechado!</p>
                    </div>
                  </div>
                </div>
              )}

              {lead.deal_status !== 'won' && interestValue > 0 && (
                <div className="rounded-xl bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/20 p-4">
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center">
                      <DollarSign className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                      <p className="text-xl font-bold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
                        R$ {interestValue.toLocaleString('pt-BR')}
                      </p>
                      <p className="text-sm text-muted-foreground">Valor de interesse</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </TabsContent>

          {/* History Tab */}
          <TabsContent value="history" className="p-6 mt-0">
            <div className="space-y-4">
              <LeadHistory leadId={lead.id} onEventClick={(event) => {
                setSelectedHistoryEvent(event);
                setHistoryEventDialogOpen(true);
              }} />
            </div>
          </TabsContent>
        </Tabs>
      </ScrollArea>
    </div>);

  // Roteiro Dialog
  const RoteiroDialog = () => {
    if (!selectedTask) return null;

    return <Dialog open={roteiroDialogOpen} onOpenChange={setRoteiroDialogOpen}>
      <DialogContent className="w-[90%] sm:max-w-md sm:w-full rounded-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
              <Lightbulb className="h-4 w-4 text-amber-600" />
            </div>
            {selectedTask.title || 'Roteiro'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800">
            <div className="flex items-start gap-3">
              <Lightbulb className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <p className="text-sm text-amber-800 dark:text-amber-200 whitespace-pre-wrap leading-relaxed">
                {selectedTask.observation}
              </p>
            </div>
          </div>

          {selectedTask.recommended_message && <div className="p-4 bg-primary/5 rounded-xl border border-primary/20">
              <div className="flex items-start gap-3">
                <MessageCircle className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-medium text-primary mb-1">Mensagem sugerida:</p>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {selectedTask.recommended_message.replace(/{nome}/gi, lead.name || '').replace(/{empresa}/gi, lead.empresa || '').replace(/{email}/gi, lead.email || '')}
                  </p>
                </div>
              </div>
            </div>}

          <div className="flex gap-2">
            <Button className="flex-1" onClick={() => handleRoteiroAction('complete')}>
              <Check className="h-4 w-4 mr-2" />
              Marcar como feito
            </Button>
            {selectedTask.recommended_message && lead.phone && <Button variant="outline" className="flex-1" onClick={() => handleRoteiroAction('message')}>
                <MessageCircle className="h-4 w-4 mr-2" />
                Enviar mensagem
              </Button>}
          </div>
        </div>
      </DialogContent>
    </Dialog>;
  };

  // Outcome Dialog component (for cadence tasks)
  const OutcomeDialogComponent = () => (
    <>
      {taskForOutcome && (
        <TaskOutcomeDialog
          open={outcomeDialogOpen}
          onOpenChange={setOutcomeDialogOpen}
          taskType={getCadenceTaskType(taskForOutcome.type)}
          taskTitle={taskForOutcome.title || ''}
          onConfirm={handleOutcomeConfirm}
          isLoading={completeCadenceTask.isPending}
        />
      )}
      {/* Quick Action Outcome Dialog (for phone/email buttons) */}
      <TaskOutcomeDialog
        open={quickActionOutcomeOpen}
        onOpenChange={setQuickActionOutcomeOpen}
        taskType={quickActionOutcomeType}
        taskTitle={quickActionOutcomeType === 'call' ? 'Tentativa de ligação' : 'Email enviado'}
        onConfirm={handleQuickActionOutcomeConfirm}
        isLoading={createActivityMutation.isPending}
      />
    </>
  );

  // Render mobile or desktop version - use JSX directly instead of component functions
  if (isMobile) {
    return (
      <>
        <Drawer open={!!lead} onOpenChange={() => onClose()} dismissible={!isEditingContact}>
          <DrawerContent className="mx-auto h-[95vh] max-h-[95vh] w-[95%] overflow-hidden rounded-t-xl border-0 bg-[var(--app-surface-solid)] p-0 text-[var(--app-text-primary)] shadow-[0_18px_42px_rgba(0,0,0,0.28)]" showHandle={!isEditingContact}>
            <DrawerTitle className="sr-only">
              {leadName ? `Detalhes do lead ${leadName}` : 'Detalhes do lead'}
            </DrawerTitle>
            {/* Inline JSX instead of <MobileContent /> to prevent re-mounting */}
            {MobileContent()}
          </DrawerContent>
        </Drawer>
        {RoteiroDialog()}
        {OutcomeDialogComponent()}
        <LostReasonDialog
          open={lostReasonDialogOpen}
          onOpenChange={setLostReasonDialogOpen}
          onConfirm={handleConfirmLostReason}
          leadName={leadName}
          loading={dealStatusChange.isPending}
        />
      </>
    );
  }
  return (
    <>
      <Dialog open={!!lead} onOpenChange={() => onClose()}>
        <DialogContent className="w-[min(1180px,92vw)] max-w-[1180px] max-h-[84vh] overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-0 text-[var(--app-text-primary)] shadow-none animate-scale-in">
          {/* Inline JSX instead of <DesktopContent /> to prevent re-mounting */}
          {DesktopContent()}
        </DialogContent>
      </Dialog>
      {RoteiroDialog()}
      {OutcomeDialogComponent()}
      <LostReasonDialog
        open={lostReasonDialogOpen}
        onOpenChange={setLostReasonDialogOpen}
        onConfirm={handleConfirmLostReason}
        leadName={leadName}
        loading={dealStatusChange.isPending}
      />
      <Dialog open={historyEventDialogOpen} onOpenChange={setHistoryEventDialogOpen}>
        <DialogContent className="max-w-lg rounded-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5 text-primary" />
              Detalhes da Atividade
            </DialogTitle>
          </DialogHeader>
          {selectedHistoryEvent && (
            <div className="space-y-4 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="rounded-full">
                    {selectedHistoryEvent.label}
                  </Badge>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(selectedHistoryEvent.timestamp), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(selectedHistoryEvent.timestamp), "HH:mm", { locale: ptBR })}
                  </p>
                </div>
              </div>

              <div className="bg-white/[0.035] p-4 rounded-xl border border-white/[0.055] italic text-sm text-foreground/90 whitespace-pre-wrap">
                {selectedHistoryEvent.content || selectedHistoryEvent.metadata?.outcome_notes || "Nenhum detalhe adicional disponível."}
              </div>

              {selectedHistoryEvent.actor && (
                <div className="flex items-center gap-2 pt-2 border-t">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={selectedHistoryEvent.actor.avatar_url || undefined} />
                    <AvatarFallback>{selectedHistoryEvent.actor.name?.[0]}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-medium">{selectedHistoryEvent.actor.name}</p>
                    <p className="text-[10px] text-muted-foreground">Responsável pelo registro</p>
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => setHistoryEventDialogOpen(false)} className="rounded-xl">
              Fechar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Formulário de agendamento (global para o card) */}
      <EventSheet
        open={scheduleFormOpen}
        onOpenChange={open => !open && handleCloseScheduleForm()}
        leadId={lead.id}
        leadName={leadName}
        event={editingScheduleEvent}
        defaultUserId={lead.assigned_user_id ?? undefined}
        defaultType={scheduleDefaultType}
      />
    </>
  );
}
