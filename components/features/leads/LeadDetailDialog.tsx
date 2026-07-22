import { useState, useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AnimatedTabNav } from '@/components/ui/animated-tab-nav';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Phone, Mail, MessageCircle, Building2, Loader2, X, Plus, Save, User,
  Briefcase, MapPin, DollarSign, Clock, ChevronRight, Calendar, Target,
  Lightbulb, FileEdit, Zap, Bot, Check, Activity, ListTodo, Contact,
  Handshake, History, ChevronDown, Trophy, XCircle, CircleDot, UserCheck,
  RotateCcw, FileText, Download, Paperclip, BarChart3, Info, Eye, EyeOff, ExternalLink
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
import { commandSearchFilter } from '@/lib/search-text';
import { format, type Locale } from 'date-fns';
import { ptBR, enUS } from 'date-fns/locale';
import { useLeadTasks, useCompleteCadenceTask } from '@/hooks/use-lead-tasks';
import { useCadenceTemplates } from '@/hooks/use-cadences';
import type { CadenceTaskTemplate } from '@/hooks/use-cadences';
import { useCreateActivity } from '@/hooks/use-activities';
import { useLead, useUpdateLead, useAddLeadTag, useLeadSensitiveProfile, useRemoveLeadTag } from '@/hooks/use-leads';
import type { Lead } from '@/hooks/use-leads';
import type { Tag } from '@/hooks/use-tags';
import type { User as AppUser } from '@/hooks/use-users';
import type { PipelineLead } from '@/hooks/use-stages';
import { useProperties } from '@/hooks/use-properties';
import { useScheduleEvents, ScheduleEvent, EventType } from '@/hooks/use-schedule-events';
import { useLeadMeta, type LeadMeta } from '@/hooks/use-lead-meta';
import { useLeadAttachments, useUploadLeadAttachment, type LeadAttachment } from '@/hooks/use-lead-attachments';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { LeadHistory } from '@/components/features/leads/LeadHistory';
import { LeadTrackingSection } from '@/components/features/leads/LeadTrackingSection';
import { LeadJourneySection } from '@/components/features/leads/LeadJourneySection';

import { LeadMessagesTab } from '@/components/features/leads/LeadMessagesTab';
import { LeadUnifiedThread } from '@/components/features/leads/LeadUnifiedThread';
import { ReentryBadge } from '@/components/features/leads/ReentryBadge';
import { LostReasonDialog } from '@/components/features/leads/LostReasonDialog';
import { LeadAttachmentViewer } from '@/components/features/leads/LeadAttachmentViewer';
import { SdrDistributionButton } from '@/components/features/leads/SdrDistributionButton';
import { CopyLeadPhoneButton } from '@/components/features/leads/CopyLeadPhoneButton';

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
import { useUserPermissions } from '@/hooks/use-user-permissions';
import { useTeams } from '@/hooks/use-teams';
import type { UnifiedHistoryEvent } from '@/hooks/use-lead-history';
import { appendOptimisticHistoryEvent } from '@/hooks/use-optimistic-lead-history';
import { leadsAPI } from '@/lib/api/leads';
import { teamsAPI } from '@/lib/api/teams';
import { maskCPF, maskRG } from '@/lib/masks';
const sourceLabels: Record<string, string> = {
  meta: 'Meta Ads',
  meta_ads: 'Meta Ads',
  site: 'Site',
  website: 'Site',
  manual: 'Manual',
  facebook: 'Facebook',
  instagram: 'Instagram',
  import: 'Importação',
  google: 'Google Ads',
  google_ads: 'Google Ads',
  indicacao: 'Indicação',
  whatsapp: 'WhatsApp',
  webhook: 'Webhook',
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
const scheduleEventTypeLabels: Record<EventType, string> = {
  call: 'Ligação',
  email: 'E-mail',
  meeting: 'Reunião',
  task: 'Tarefa',
  message: 'Mensagem',
  visit: 'Visita'
};
const scheduleEventTypeIcons: Record<EventType, typeof Phone> = {
  call: Phone,
  email: Mail,
  meeting: Calendar,
  task: ListTodo,
  message: MessageCircle,
  visit: MapPin
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

export type LeadDetailLead = Omit<PipelineLead, 'stage' | 'assignee' | 'tags'> & Omit<Partial<Lead>, 'stage' | 'assignee' | 'tags'> & {
  whatsapp_picture?: string | null;
  whatsapp_avatar_url?: string | null;
  contact_picture?: string | null;
  assignee?: LeadDetailAssignee | null;
  property?: { id?: string; code?: string | null; title?: string | null; preco?: number | null } | null;
  interest_property?: { id?: string; code?: string | null; title?: string | null; preco?: number | null } | null;
  stage?: LeadDetailStage | null;
  tags?: LeadDetailTag[];
};

type CampaignTrackingDetails = Omit<Partial<LeadMeta>, 'lead_id' | 'created_at'> & {
  lead_id?: string | null;
  created_at?: string | null;
  page_name?: string | null;
  leadgen_id?: string | null;
};

type SelectableLeadProperty = {
  id: string;
  title?: string | null;
  code?: string | null;
  codigo?: string | null;
  reference?: string | null;
  preco?: number | null;
  commission_percentage?: number | null;
};

function getLeadPropertyFallback(lead: LeadDetailLead | null): SelectableLeadProperty | null {
  const property = lead?.interest_property || lead?.property || null;
  const propertyId = lead?.interest_property_id || lead?.property_id || property?.id || null;

  if (!propertyId) return null;

  return {
    id: propertyId,
    title: property?.title || null,
    code: property?.code || null,
    preco: typeof property?.preco === 'number' ? property.preco : null,
    commission_percentage: typeof lead?.commission_percentage === 'number' ? lead.commission_percentage : null,
  };
}

function mergePropertyFallback(
  properties: SelectableLeadProperty[],
  fallback: SelectableLeadProperty | null,
) {
  if (!fallback || properties.some((property) => property.id === fallback.id)) return properties;
  return [fallback, ...properties];
}

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
  onEdit?: (lead: LeadDetailLead) => void;
  allTags: Tag[];
  allUsers: AppUser[];
  refetchStages: () => void;
}

function InfoLine({ label, value, icon }: { label: string; value: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 text-xs">
      <span className="flex min-w-0 items-center gap-1.5 text-[var(--app-text-tertiary)]">
        {icon}
        {label}
      </span>
      <span className="max-w-[60%] truncate text-right font-medium text-[var(--app-text-primary)]">
        {value}
      </span>
    </div>
  );
}

function metaText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function firstTrackingText(...values: unknown[]) {
  for (const value of values) {
    const text = metaText(value);
    if (text) return text;
  }

  return null;
}

function trackingRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeTrackingKey(value: unknown) {
  return metaText(value)?.toLowerCase().replace(/[\s-]+/g, '_') || '';
}

function isTrackedLeadSource(value: unknown) {
  return ['meta', 'meta_ads', 'facebook', 'instagram', 'google', 'google_ads'].includes(
    normalizeTrackingKey(value),
  );
}

function trackingSourceLabel(value: unknown) {
  const key = normalizeTrackingKey(value);
  return sourceLabels[key] || metaText(value);
}

function buildCampaignTrackingDetails(
  leadMeta: LeadMeta | null | undefined,
  lead: LeadDetailLead | null | undefined,
): CampaignTrackingDetails | null {
  if (!lead && !leadMeta) return null;

  const boardMeta = Array.isArray(lead?.lead_meta)
    ? lead.lead_meta.find((meta) => (
      metaText(meta?.campaign_name) ||
      metaText(meta?.campaign_id) ||
      metaText(meta?.adset_name) ||
      metaText(meta?.adset_id) ||
      metaText(meta?.ad_name) ||
      metaText(meta?.ad_id) ||
      metaText(meta?.platform)
    ))
    : null;

  const source = metaText(lead?.source);
  const inferredPlatform = isTrackedLeadSource(source) ? normalizeTrackingKey(source) : null;
  const leadRecord = trackingRecord(lead);
  const boardMetaRecord = trackingRecord(boardMeta);
  const rawPayload = trackingRecord(leadMeta?.raw_payload);
  const rawDetails = trackingRecord(rawPayload?.lead_details);

  const details: CampaignTrackingDetails = {
    lead_id: firstTrackingText(leadMeta?.lead_id, lead?.id),
    campaign_name: firstTrackingText(leadMeta?.campaign_name, boardMeta?.campaign_name, rawDetails?.campaign_name, rawPayload?.campaign_name),
    campaign_id: firstTrackingText(leadMeta?.campaign_id, boardMeta?.campaign_id, lead?.meta_campaign_id),
    adset_name: firstTrackingText(leadMeta?.adset_name, boardMeta?.adset_name, rawDetails?.adset_name, rawPayload?.adset_name),
    adset_id: firstTrackingText(leadMeta?.adset_id, boardMeta?.adset_id, lead?.meta_adset_id),
    ad_name: firstTrackingText(leadMeta?.ad_name, boardMeta?.ad_name, rawDetails?.ad_name, rawPayload?.ad_name),
    ad_id: firstTrackingText(leadMeta?.ad_id, boardMeta?.ad_id, lead?.meta_ad_id),
    form_name: firstTrackingText(leadMeta?.form_name, boardMetaRecord?.form_name, rawDetails?.form_name, rawPayload?.form_name, leadRecord?.utm_term),
    form_id: firstTrackingText(leadMeta?.form_id, rawDetails?.form_id, rawPayload?.form_id, lead?.meta_form_id),
    page_id: firstTrackingText(leadMeta?.page_id, rawDetails?.page_id, rawPayload?.page_id),
    page_name: firstTrackingText(rawDetails?.page_name, rawPayload?.page_name),
    leadgen_id: firstTrackingText(rawDetails?.leadgen_id, rawPayload?.leadgen_id),
    platform: firstTrackingText(leadMeta?.platform, boardMeta?.platform, rawDetails?.platform, rawPayload?.platform, inferredPlatform),
    source_type: firstTrackingText(leadMeta?.source_type, source),
    created_at: firstTrackingText(leadMeta?.created_at, lead?.created_at),
    utm_source: firstTrackingText(leadMeta?.utm_source, lead?.utm_source),
    utm_medium: firstTrackingText(leadMeta?.utm_medium, lead?.utm_medium),
    utm_campaign: firstTrackingText(leadMeta?.utm_campaign, lead?.utm_campaign),
    utm_content: firstTrackingText(leadMeta?.utm_content, lead?.utm_content),
    utm_term: firstTrackingText(leadMeta?.utm_term, lead?.utm_term),
    contact_notes: firstTrackingText(leadMeta?.contact_notes),
    creative_url: firstTrackingText(leadMeta?.creative_url),
    creative_video_url: firstTrackingText(leadMeta?.creative_video_url),
    creative_instagram_url: firstTrackingText(leadMeta?.creative_instagram_url),
  };

  return hasLeadTrackingData(details) ? details : null;
}

function hasLeadTrackingData(leadMeta: CampaignTrackingDetails | null | undefined) {
  if (!leadMeta) return false;

  return [
    leadMeta.campaign_name,
    leadMeta.campaign_id,
    leadMeta.adset_name,
    leadMeta.adset_id,
    leadMeta.ad_name,
    leadMeta.ad_id,
    leadMeta.form_name,
    leadMeta.form_id,
    leadMeta.page_id,
    leadMeta.page_name,
    leadMeta.leadgen_id,
    leadMeta.utm_source,
    leadMeta.utm_medium,
    leadMeta.utm_campaign,
    leadMeta.utm_content,
    leadMeta.utm_term,
    leadMeta.creative_url,
    leadMeta.creative_video_url,
    leadMeta.creative_instagram_url,
    leadMeta.contact_notes,
  ].some((value) => Boolean(metaText(value))) || isTrackedLeadSource(leadMeta.platform) || isTrackedLeadSource(leadMeta.source_type);
}

function CampaignTrackingHover({ leadMeta }: { leadMeta: CampaignTrackingDetails | null | undefined }) {
  if (!hasLeadTrackingData(leadMeta)) return null;

  const sourceLabel = trackingSourceLabel(leadMeta?.platform) || trackingSourceLabel(leadMeta?.source_type);
  const displayName =
    metaText(leadMeta?.campaign_name) ||
    metaText(leadMeta?.utm_campaign) ||
    metaText(leadMeta?.ad_name) ||
    metaText(leadMeta?.form_name) ||
    sourceLabel ||
    'Campanha registrada';

  const mainRows = [
    ['Campanha', metaText(leadMeta?.campaign_name) || metaText(leadMeta?.utm_campaign)],
    ['Conjunto', leadMeta?.adset_name],
    ['Anuncio', leadMeta?.ad_name],
    ['Formulario', leadMeta?.form_name],
    ['ID do formulário', leadMeta?.form_id],
    ['Página', leadMeta?.page_name || leadMeta?.page_id],
    ['Leadgen', leadMeta?.leadgen_id],
    ['Plataforma', trackingSourceLabel(leadMeta?.platform) || leadMeta?.platform],
    ['Origem', trackingSourceLabel(leadMeta?.source_type) || leadMeta?.utm_source],
    ['Capturado em', leadMeta?.created_at ? format(new Date(leadMeta.created_at), "dd/MM/yyyy 'as' HH:mm", { locale: ptBR }) : null],
  ] as const;

  const utmRows = [
    ['utm_source', leadMeta?.utm_source],
    ['utm_medium', leadMeta?.utm_medium],
    ['utm_campaign', leadMeta?.utm_campaign],
    ['utm_content', leadMeta?.utm_content],
    ['utm_term', leadMeta?.utm_term],
  ] as const;

  const links = [
    ['Criativo', leadMeta?.creative_url],
    ['Video', leadMeta?.creative_video_url],
    ['Instagram', leadMeta?.creative_instagram_url],
  ] as const;

  const DetailRow = ({ label, value }: { label: string; value: unknown }) => {
    const text = metaText(value);
    if (!text) return null;

    return (
      <div className="grid grid-cols-[100px_minmax(0,1fr)] gap-2 text-[11px] leading-snug text-left">
        <span className="text-[var(--app-text-tertiary)]">{label}</span>
        <span className="break-words font-medium text-[var(--app-text-primary)] text-left">{text}</span>
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
          className="group inline-flex min-w-0 max-w-full items-center justify-end gap-1 text-right font-medium text-[var(--app-text-primary)] outline-none transition-colors hover:text-primary focus-visible:text-primary"
        >
          <span className="truncate underline decoration-dotted decoration-[var(--app-text-tertiary)] underline-offset-4 group-hover:decoration-primary group-focus-visible:decoration-primary">
            {displayName}
          </span>
          <Info className="h-3 w-3 shrink-0 text-[var(--app-text-tertiary)] transition-colors group-hover:text-primary group-focus-visible:text-primary" />
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        side="right"
        align="center"
        sideOffset={4}
        avoidCollisions={false}
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

function LeadProfileHover({
  lead,
  canRevealSensitive,
}: {
  lead: LeadDetailLead;
  canRevealSensitive: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [revealSensitive, setRevealSensitive] = useState(false);
  const queryClient = useQueryClient();
  const { profile, organization } = useAuth();
  const organizationId = organization?.id || profile?.organization_id || undefined;
  const sensitiveProfile = useLeadSensitiveProfile(lead.id, {
    enabled: canRevealSensitive && revealSensitive,
  });
  const metadata = trackingRecord(lead.metadata) || {};
  const nestedProfile = trackingRecord(metadata.profile);
  const profileData = nestedProfile && Object.keys(nestedProfile).length > 0 ? nestedProfile : metadata;
  const text = (key: string) => metaText(profileData[key]);
  const personType = text('personType');
  const gender = text('gender');
  const hasCPF = metadata.hasCPF === true || profileData.hasCPF === true;
  const hasRG = metadata.hasRG === true || profileData.hasRG === true;
  const birthDate = text('birthDate');
  const birthDateLabel = birthDate
    ? format(new Date(`${birthDate}T00:00:00`), 'dd/MM/yyyy', { locale: ptBR })
    : null;
  const interestValue = typeof lead.valor_interesse === 'number'
    ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(lead.valor_interesse)
    : null;
  const interestProperty = lead.interest_property || lead.property;
  const propertyLabel = [interestProperty?.code, interestProperty?.title].filter(Boolean).join(' - ') || null;
  const rows = [
    ['Nome', lead.name],
    ['Nome social', text('socialName')],
    ['Telefone', formatPhoneForDisplay(lead.phone || '')],
    ['E-mail', lead.email],
    ['Tipo', personType === 'company' ? 'Pessoa jurídica' : personType === 'individual' ? 'Pessoa física' : null],
    ['Gênero', gender === 'male' ? 'Masculino' : gender === 'female' ? 'Feminino' : gender === 'other' ? 'Outro' : null],
    ['Nascimento', birthDateLabel],
    ['Profissão', lead.profissao],
    ['Cargo', lead.cargo],
    ['Empresa', lead.empresa],
    ['Renda', lead.renda_familiar],
    ['Razão social', text('corporateName')],
    ['Nome fantasia', text('tradeName')],
    ['CNPJ', text('cnpj')],
    ['Inscrição estadual', text('stateRegistration')],
    ['Valor de interesse', interestValue],
    ['Imóvel de interesse', propertyLabel],
  ].filter((row): row is [string, string] => Boolean(row[1]));

  const clearSensitiveData = () => {
    setRevealSensitive(false);
    if (organizationId) {
      queryClient.removeQueries({
        queryKey: ['lead-sensitive-profile', organizationId, lead.id],
        exact: true,
      });
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) clearSensitiveData();
  };

  const sensitiveValue = (kind: 'cpf' | 'rg') => {
    if (!revealSensitive) return '••••••••••••';
    if (sensitiveProfile.isLoading || sensitiveProfile.isFetching) return 'Carregando...';
    const value = sensitiveProfile.data?.[kind];
    if (!value) return 'Não informado';
    return kind === 'cpf' ? maskCPF(value) : maskRG(value);
  };

  return (
    <HoverCard open={open} onOpenChange={handleOpenChange} openDelay={100} closeDelay={420}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className="group inline-flex min-w-0 max-w-full items-center justify-end gap-1 text-right font-medium text-[var(--app-text-primary)] outline-none transition-colors hover:text-primary focus-visible:text-primary"
        >
          <span className="truncate underline decoration-dotted decoration-[var(--app-text-tertiary)] underline-offset-4 group-hover:decoration-primary">
            {lead.name || 'Lead'}
          </span>
          <Info className="h-3 w-3 shrink-0 text-[var(--app-text-tertiary)] group-hover:text-primary" />
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        side="right"
        align="start"
        sideOffset={4}
        className="vimob-popover-content z-[110] w-[min(420px,calc(100vw-2rem))] rounded-[8px] border-0 p-0 text-left text-[var(--app-text-primary)] shadow-[0_22px_70px_rgba(0,0,0,0.28)]"
      >
        <div className="border-b border-[var(--app-border)] px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-primary">Ficha do lead</p>
        </div>
        <div className="max-h-[430px] space-y-3 overflow-y-auto p-3">
          <div className="space-y-1.5">
            {rows.map(([label, value]) => (
              <div key={label} className="grid grid-cols-[118px_minmax(0,1fr)] gap-2 text-[11px] leading-snug">
                <span className="text-[var(--app-text-tertiary)]">{label}</span>
                <span className="break-words font-medium text-[var(--app-text-primary)]">{value}</span>
              </div>
            ))}
          </div>

          {(hasCPF || hasRG) && (
            <div className="space-y-1.5 border-t border-[var(--app-border)] pt-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--app-text-tertiary)]">Documentos protegidos</p>
                {canRevealSensitive && (
                  <button
                    type="button"
                    onClick={() => revealSensitive ? clearSensitiveData() : setRevealSensitive(true)}
                    className="inline-flex items-center gap-1 rounded-[5px] bg-[var(--app-surface-soft)] px-2 py-1 text-[10px] font-medium text-primary"
                  >
                    {revealSensitive ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    {revealSensitive ? 'Ocultar' : 'Revelar'}
                  </button>
                )}
              </div>
              {hasCPF && <InfoLine label="CPF" value={sensitiveValue('cpf')} />}
              {hasRG && <InfoLine label="RG" value={sensitiveValue('rg')} />}
              {sensitiveProfile.isError && (
                <p className="text-[10px] text-destructive">Não foi possível liberar os documentos.</p>
              )}
            </div>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

function getDealStatusTriggerClass(status?: string | null) {
  if (status === 'won') {
    return '!border-0 !bg-emerald-600 !text-white !shadow-none !ring-0 !ring-offset-0 transition-colors hover:!bg-emerald-700 data-[state=open]:!bg-emerald-700 focus:!ring-0 focus-visible:!ring-1 focus-visible:!ring-emerald-500/40 focus-visible:!ring-offset-0';
  }

  if (status === 'lost') {
    return '!border-0 !bg-red-600 !text-white !shadow-none !ring-0 !ring-offset-0 transition-colors hover:!bg-red-700 data-[state=open]:!bg-red-700 focus:!ring-0 focus-visible:!ring-1 focus-visible:!ring-red-500/40 focus-visible:!ring-offset-0';
  }

  return '!border-0 !bg-[var(--app-surface-soft)] !text-[var(--app-text-primary)] !shadow-none !ring-0 !ring-offset-0 transition-colors hover:!bg-[var(--app-surface-hover)] data-[state=open]:!bg-[var(--app-surface-hover)] focus:!ring-0 focus-visible:!ring-1 focus-visible:!ring-[var(--app-border-strong)] focus-visible:!ring-offset-0';
}

function formatCadenceStageLabel(name?: string | null) {
  const trimmed = name?.trim();
  if (!trimmed) return '';

  const words = trimmed.split(/\s+/);
  const firstWord = words[0]
    ?.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const secondWord = words[1]
    ?.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (firstWord === 'cadencia') {
    const start = secondWord === 'de' ? 2 : 1;
    const label = words.slice(start).join(' ').trim();
    return normalizeCadenceLabel(label);
  }

  return normalizeCadenceLabel(trimmed);
}

function normalizeCadenceLabel(label: string) {
  const normalized = label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (normalized === 'contactados') return 'Contatados';
  return label;
}

function getScheduleEventType(value?: string | null): EventType {
  return value === 'email' ||
    value === 'meeting' ||
    value === 'task' ||
    value === 'message' ||
    value === 'visit'
    ? value
    : 'call';
}

function getScheduleStatusLabel(status?: string | null, isLate = false) {
  if (status === 'completed') return 'Concluído';
  if (status === 'cancelled' || status === 'canceled') return 'Cancelado';
  if (status === 'no_show') return 'Não compareceu';
  if (isLate) return 'Atrasado';
  return 'Em aberto';
}

function getScheduleStatusClass(status?: string | null, isLate = false) {
  if (status === 'completed') return 'bg-emerald-500/12 text-emerald-500';
  if (status === 'cancelled' || status === 'canceled') return 'bg-red-500/12 text-red-500';
  if (status === 'no_show') return 'bg-amber-500/12 text-amber-500';
  if (isLate) return 'bg-red-500/12 text-red-500';
  return 'bg-primary/12 text-primary';
}

function getScheduleDateLabel(event: ScheduleEvent, locale: Locale) {
  const startDate = new Date(event.start_time);
  const endDate = new Date(event.end_time);
  const dateLabel = format(startDate, 'dd/MM', { locale });
  const startTime = format(startDate, 'HH:mm', { locale });
  const endTime = format(endDate, 'HH:mm', { locale });

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
    const leftCompleted = left.status === 'completed';
    const rightCompleted = right.status === 'completed';
    if (leftCompleted !== rightCompleted) return leftCompleted ? 1 : -1;
    return new Date(left.start_time).getTime() - new Date(right.start_time).getTime();
  });

  if (sortedEvents.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        'mt-3 space-y-1.5 overflow-y-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        sortedEvents.length > 2 ? 'h-[148px]' : 'max-h-[148px]',
      )}
    >
      {sortedEvents.map((event) => {
        const eventType = getScheduleEventType(event.event_type);
        const EventIcon = scheduleEventTypeIcons[eventType] || Calendar;
        const isCompleted = event.status === 'completed';
        const isLate = !isCompleted && new Date(event.start_time).getTime() < currentTime;

        return (
          <button
            key={event.id}
            type="button"
            disabled={!onEditEvent}
            onClick={() => onEditEvent?.(event)}
            className={cn(
              'flex w-full items-center gap-2 rounded-[6px] bg-[var(--app-surface-solid)] px-2.5 py-1.5 text-left transition-colors hover:bg-primary/10 disabled:cursor-default disabled:hover:bg-[var(--app-surface-solid)]',
              isCompleted && 'opacity-65',
            )}
          >
            <span
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px]',
                isCompleted ? 'bg-emerald-500/18 text-emerald-500' : 'bg-primary/12 text-primary',
              )}
            >
              {isCompleted ? <Check className="h-3 w-3" /> : <EventIcon className="h-3 w-3" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className={cn('block truncate text-[11px] font-medium leading-tight', isCompleted && 'line-through')}>
                {event.title || scheduleEventTypeLabels[eventType]}
              </span>
              <span className="mt-px flex min-w-0 flex-wrap items-center gap-1 text-[10.5px] font-medium leading-tight text-[var(--app-text-secondary)]">
                <span className="font-semibold text-[var(--app-text-primary)]">{scheduleEventTypeLabels[eventType]}</span>
                <span>-</span>
                <span>{getScheduleDateLabel(event, locale)}</span>
                {!isCompleted && (
                  <span className={cn('rounded-[4px] px-1.5 py-0.5 font-medium', getScheduleStatusClass(event.status, isLate))}>
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

function getStageStepperStyle(stageCount: number): CSSProperties {
  if (stageCount > 32) {
    return {
      '--lead-stage-step-size': '1.35rem',
      '--lead-stage-step-font-size': '0.625rem',
      '--lead-stage-step-gap': '0.25rem',
    } as CSSProperties;
  }

  if (stageCount > 20) {
    return {
      '--lead-stage-step-size': '1.55rem',
      '--lead-stage-step-font-size': '0.6875rem',
      '--lead-stage-step-gap': '0.25rem',
    } as CSSProperties;
  }

  return {
    '--lead-stage-step-size': '2rem',
    '--lead-stage-step-font-size': '0.75rem',
    '--lead-stage-step-gap': '0.375rem',
  } as CSSProperties;
}

const stageTooltipClassName = 'max-w-[18rem] text-[11px] font-normal leading-snug tracking-normal';

export function LeadDetailDialog({
  lead: leadProp,
  stages,
  onClose,
  onEdit,
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
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);
  const [assigneePopoverOpen, setAssigneePopoverOpen] = useState(false);
  const [localLead, setLocalLead] = useState<LeadDetailLead | null>(leadProp);
  const [isUpdatingAssignee, setIsUpdatingAssignee] = useState(false);
  const [isEditingContact, setIsEditingContact] = useState(false);
  const [scheduleFormOpen, setScheduleFormOpen] = useState(false);
  const [editingScheduleEvent, setEditingScheduleEvent] = useState<ScheduleEvent | null>(null);
  const [scheduleDefaultType, setScheduleDefaultType] = useState<EventType>('call');
  const [activeTab, setActiveTab] = useState('activities');
  const [composerRequest, setComposerRequest] = useState<{ id: number; text?: string } | null>(null);
  const [stagePopoverOpen, setStagePopoverOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<CadenceTaskTemplate | null>(null);
  const [roteiroDialogOpen, setRoteiroDialogOpen] = useState(false);
  const [outcomeDialogOpen, setOutcomeDialogOpen] = useState(false);
  const [taskForOutcome, setTaskForOutcome] = useState<CadenceTaskTemplate | null>(null);
  const [quickActionOutcomeOpen, setQuickActionOutcomeOpen] = useState(false);
  const [quickActionOutcomeType, setQuickActionOutcomeType] = useState<'call' | 'email'>('call');
  const [selectedHistoryEvent, setSelectedHistoryEvent] = useState<UnifiedHistoryEvent | null>(null);
  const [historyEventDialogOpen, setHistoryEventDialogOpen] = useState(false);
  const [selectedAttachment, setSelectedAttachment] = useState<LeadAttachment | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [shouldLoadLeadProperties, setShouldLoadLeadProperties] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [reopenStatusConfirmation, setReopenStatusConfirmation] = useState<{
    leadId: string;
    leadName: string;
    fromStatus: 'won' | 'lost' | string;
  } | null>(null);
  const v2LeadInfoScrollRef = useRef<HTMLDivElement>(null);
  const v2LeadWorkScrollRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const leadId = leadProp?.id ?? null;
  const fullLeadQuery = useLead(leadId);
  const [lostReasonLocal, setLostReasonLocal] = useState(lead?.lost_reason || '');
  const [lostReasonDialogOpen, setLostReasonDialogOpen] = useState(false);
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

    const fullLead = fullLeadQuery.data as LeadDetailLead | null | undefined;
    const hydratedLead: LeadDetailLead = fullLead
      ? {
          ...leadProp,
          ...fullLead,
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
  const { profile, organization } = useAuth();
  const { hasPermission } = useUserPermissions();
  const canOperateLead = hasPermission('lead_operate');
  const handleOpenLeadEdit = () => {
    if (!canOperateLead) return;
    setIsEditingContact(false);
    onEdit?.(localLead || lead);
  };
  const canViewProperties = hasPermission('property_view') || hasPermission('property_manage');
  const canViewLeadSchedule = hasPermission('schedule_view');
  const canManageLeadSchedule = canOperateLead && hasPermission('schedule_manage');
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
      valor_interesse: nextPropertyPrice ?? lead.valor_interesse,
      commission_percentage: nextPropertyCommission ?? lead.commission_percentage,
    };

    setEditForm((current) => ({
      ...current,
      property_id: property.id,
      valor_interesse: nextPropertyPrice ? nextPropertyPrice.toString() : current.valor_interesse,
      commission_percentage: nextPropertyCommission ? nextPropertyCommission.toString() : current.commission_percentage,
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
      valor_interesse: nextPropertyPrice || lead.valor_interesse,
    };

    if (nextPropertyCommission !== null) {
      updateData.commission_percentage = nextPropertyCommission;
    }

    try {
      await updateLead.mutateAsync(updateData);
      refreshPipelineInBackground();
    } catch (error) {
      setLocalLead(lead);
      updatePipelineLeadCache(lead.id, lead);
      queryClient.setQueryData(historyQueryKey, previousHistory);
      throw error;
    }
  };

  // Quick action handlers for phone/email with outcome dialog
  const handleQuickPhone = () => {
    if (!canOperateLead || !lead.phone) return;

    // 1. Log initiation immediately in history
    createActivityMutation.mutate({
      lead_id: lead.id,
      type: 'call_initiated',
      content: 'Ligação iniciada',
      metadata: { phone: lead.phone, channel: 'phone' },
    });

    window.open(`tel:${lead.phone.replace(/\D/g, '')}`, '_blank');
    setQuickActionOutcomeType('call');
    setQuickActionOutcomeOpen(true);
  };

  const handleQuickWhatsApp = () => {
    if (!canOperateLead) return;
    setActiveTab(isMobile ? 'history' : 'activities');
    setComposerRequest((current) => ({ id: (current?.id || 0) + 1 }));
  };

  const handleQuickEmail = () => {
    if (!canOperateLead || !lead.email) return;
    const gmailUrl = `https://mail.google.com/mail/view=cm&fs=1&tf=1&to=${encodeURIComponent(lead.email)}`;
    window.open(gmailUrl, '_blank');
    setQuickActionOutcomeType('email');
    setQuickActionOutcomeOpen(true);
  };

  const handleQuickActionOutcomeConfirm = async (outcome: TaskOutcome, notes: string) => {
    if (!canOperateLead) return;
    // 1. Log in the 'activities' table for visual history
    await createActivityMutation.mutateAsync({
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

    await recordFirstResponse({
      leadId: lead.id,
      organizationId: lead.organization_id || profile?.organization_id || organization?.id || '',
      channel: quickActionOutcomeType === 'call' ? 'phone' : 'email',
      actorUserId: profile?.id || null,
      firstResponseAt: lead.first_response_at,
    });

    setQuickActionOutcomeOpen(false);
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

  const currentStage = localLead.stage || stages.find(s => s.id === localLead.stage_id);
  const currentStageIndex = stages.findIndex(s => s.id === localLead.stage_id);
  const stageStepperStyle = getStageStepperStyle(stages.length);
  const assigneeName = localLead.assignee?.name || '';
  const assigneeEmail = localLead.assignee?.email || '';
  const interestValue = Number(lead.valor_interesse || 0);
  const leadTags = Array.isArray(localLead.tags) ? localLead.tags.filter(hasTagId) : [];
  const safeAllTags = Array.isArray(allTags) ? allTags.filter(Boolean) : [];
  const safeAllUsers = Array.isArray(allUsers) ? allUsers.filter(Boolean) : [];
  const canTransferLead = canOperateLead;
  const canUnassignLead = canOperateLead;
  const assignableUsers = canTransferLead ? safeAllUsers : [];
  const safeLeadTasks = Array.isArray(leadTasks) ? leadTasks.filter(Boolean) : [];
  const safeCadenceTemplates = Array.isArray(cadenceTemplates) ? cadenceTemplates.filter(Boolean) : [];
  const originLabels = {
    title: t?.leads?.origin?.title || 'Origem',
    source: t?.leads?.origin?.source || 'Fonte',
    createdAt: t?.leads?.origin?.createdAt || 'Criado em'
  };

  // Prefer the stage UUID because stage keys are shared across pipelines and older stage payloads may omit them.
  const cadenceCandidates = safeCadenceTemplates
    .filter((template) => template.is_active !== false)
    .map((template) => {
      const exactStage = Boolean(localLead.stage_id && template.stage_id === localLead.stage_id);
      const samePipeline = Boolean(localLead.pipeline_id && template.pipeline_id === localLead.pipeline_id);
      const sameStageKey = Boolean(currentStage?.stage_key && template.stage_key === currentStage.stage_key);
      const activeTaskMatches = (template.tasks || []).filter((templateTask) =>
        safeLeadTasks.some((leadTask) =>
          leadTask.title === templateTask.title
          && leadTask.day_offset === templateTask.day_offset
          && leadTask.type === templateTask.type
        )
      ).length;
      const stageScore = exactStage ? 400 : samePipeline && sameStageKey ? 300 : sameStageKey ? 200 : 0;
      const score = activeTaskMatches > 0 ? 10_000 + activeTaskMatches : stageScore;
      return { template, score, taskCount: Array.isArray(template.tasks) ? template.tasks.length : 0 };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || right.taskCount - left.taskCount);
  const stageTemplate = cadenceCandidates[0]?.template;
  const templateTasks = Array.isArray(stageTemplate?.tasks) ? stageTemplate.tasks.filter(Boolean) : [];
  const cadenceStageLabel = formatCadenceStageLabel(stageTemplate?.name);
  const cadenceTitle = cadenceStageLabel ? `Cadencia / ${cadenceStageLabel}` : 'Cadencia';

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
      const filterUserId = keyParts[3] as string | null | undefined;
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
    if (!canOperateLead) return;
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
    if (!canOperateLead || !localLead) return;

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

  const loadAssigneeAvailability = () => {
    const teamMemberIds = teams
      .flatMap((team) => team.members || [])
      .map((member) => member.id)
      .filter(Boolean)
      .sort();
    const organizationId = lead.organization_id || profile?.organization_id || organization?.id;

    if (teamMemberIds.length === 0) return Promise.resolve([]);

    return queryClient.fetchQuery({
      queryKey: ['lead-assignee-availability', organizationId, teamMemberIds],
      queryFn: () => teamsAPI.listMemberAvailability({ teamMemberIds, organizationId }),
      staleTime: 60_000,
    });
  };

  const handleAssigneePopoverChange = (open: boolean) => {
    setAssigneePopoverOpen(open);
    if (open) void loadAssigneeAvailability();
  };

  const handleAssignUser = async (userId: string | null) => {
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

            if (isOutsideSchedule) {
              const startTime = availability.start_time || '00:00:00';
              const endTime = availability.end_time || '23:59:59';
              const confirmAssign = window.confirm(
                `Atenção: Este usuário está fora do seu horário de escala (${startTime.slice(0, 5)} - ${endTime.slice(0, 5)}). Deseja atribuir mesmo assim?`
              );
              if (!confirmAssign) return;
            }
          } else {
            const confirmAssign = window.confirm(
              'Atenção: Este usuário não tem escala ativa para hoje. Deseja atribuir mesmo assim?'
            );
            if (!confirmAssign) return;
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

      const organizationId = lead.organization_id || profile?.organization_id || organization?.id;
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
      refreshPipelineInBackground();

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
  const handleToggleCadenceTask = async (task: CadenceTaskTemplate, outcome = 'done', outcomeNotes = '') => {
    if (!canOperateLead) return;
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
        organizationId: lead.organization_id || profile?.organization_id || organization?.id || '',
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
      setEditingScheduleEvent(null);
      setScheduleDefaultType('visit');
      setScheduleFormOpen(true);
    }

    setTaskForOutcome(null);
  };

  const handleCadenceTaskClick = (task: CadenceTaskTemplate) => {
    if (!canOperateLead) return;
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
    if (taskType === 'message' && task.recommended_message) {
      // Substituir variáveis na mensagem
      const message = task.recommended_message.replace(/{nome}/gi, lead.name || '').replace(/{empresa}/gi, lead.empresa || '').replace(/{email}/gi, lead.email || '');
      setActiveTab(isMobile ? 'history' : 'activities');
      setComposerRequest((current) => ({ id: (current?.id || 0) + 1, text: message }));
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
    if (!canOperateLead) return;
    if (!selectedTask) return;
    if (action === 'message' && selectedTask.recommended_message) {
      const message = selectedTask.recommended_message.replace(/{nome}/gi, lead.name || '').replace(/{empresa}/gi, lead.empresa || '').replace(/{email}/gi, lead.email || '');
      setActiveTab(isMobile ? 'history' : 'activities');
      setComposerRequest((current) => ({ id: (current?.id || 0) + 1, text: message }));
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
    }
  };
  const handleMoveToStage = async (stageId: string) => {
    if (!canOperateLead || stageId === localLead.stage_id) return;

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

      const organizationId = lead.organization_id || profile?.organization_id || organization?.id;
      const { data: updatedLead, error } = await leadsAPI.moveLeadStage(lead.id, {
        stageId,
      }, organizationId);
      if (error) throw error;

      setLocalLead((current) => current ? { ...current, ...updatedLead } : current);
      updatePipelineLeadCache(lead.id, updatedLead);
      void queryClient.invalidateQueries({ queryKey: ['lead-history-v2', lead.id] });
      refreshPipelineInBackground();

      // Se moveu para estágio de Proposta, registrar atividade de gamificação
      if (isProposal) {
        createActivityMutation.mutate({
          lead_id: lead.id,
          type: 'proposal_sent',
          content: 'Lead movido para estágio de Proposta',
        });
      }

      toast.success('Lead movido!');

      // Se a automação da coluna mudou para perdido, abrir diálogo para salvar o motivo
      if (updatedLead && updatedLead.deal_status === 'lost') {
        setLostReasonDialogOpen(true);
      }
    } catch {
      setLocalLead(previousLead);
    }
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

    // Validation when marking as "won"
    if (newStatus === 'won') {
      if (currentLead?.is_own_resource !== true) {
        toast.warning('Confirme se o cliente possui recurso próprio', {
          description: 'A regra de fechamento exige a verificação de recurso próprio para finalizar o contrato.',
          duration: 6000,
        });
      }
    }

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
        organizationId: profile?.organization_id || organization?.id || '',
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
    } catch {
      if (previousLead) setLocalLead(previousLead);
    }
  };

  // Confirm lost with reason from dialog
  const handleConfirmLostReason = async (reason: string) => {
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
        organizationId: profile?.organization_id || organization?.id || '',
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
    } catch {
      if (previousLead) setLocalLead(previousLead);
      else if (localLead) setLocalLead({ ...localLead, deal_status: previousStatus });
    }
  };

  const leadSource = localLead?.source ?? lead.source ?? 'outros';
  const SourceIcon = sourceIcons[leadSource] || Target;
  const leadName = localLead?.name || lead.name || 'Lead';
  const campaignTrackingDetails = buildCampaignTrackingDetails(leadMeta ?? null, localLead || lead);
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
                    className="flex h-5 items-center gap-1 rounded-[4px] border-0 py-0 pr-1 text-[10px] leading-none"
                    style={{
                      backgroundColor: tagColor,
                      color: '#FFFFFF',
                      borderColor: tagColor
                    }}
                  >
                    <div className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: tagColor }} />
                    {tag.name || 'Tag'}
                    <button disabled={!canOperateLead} onClick={() => handleRemoveTag(tag.id)} className="ml-0.5 rounded-[3px] p-0.5 hover:bg-black/10 disabled:hidden">
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
              <Popover open={tagPopoverOpen} onOpenChange={(open) => canOperateLead && setTagPopoverOpen(open)}>
                <PopoverTrigger asChild>
                  <Button disabled={!canOperateLead} variant="ghost" size="sm" className="h-5 w-5 shrink-0 rounded-[6px] border-0 bg-[var(--app-surface-soft)] p-0 disabled:hidden">
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
            <Button disabled={!canOperateLead} variant="outline" size="sm" onClick={handleQuickPhone} className="h-9 flex-1 rounded-[6px] border-0 bg-[var(--app-surface-soft)]">
              <Phone className="h-4 w-4 mr-1.5" />
              Ligar
            </Button>
          )}
          <Button disabled={!canOperateLead} size="sm" onClick={handleQuickWhatsApp} className="h-9 flex-1 rounded-[6px]">
            <MessageCircle className="h-4 w-4 mr-1.5" />
            Chat
          </Button>
          {lead.email && (
            <Button disabled={!canOperateLead} variant="outline" size="sm" onClick={handleQuickEmail} className="h-9 w-9 shrink-0 rounded-[6px] border-0 bg-[var(--app-surface-soft)] p-0">
              <Mail className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Row 3 - Estágio + Deal Status lado a lado */}
        <div className="flex items-center gap-2 flex-wrap">
          {lead.is_own_resource && (
            <Badge variant="secondary" className="rounded-[4px] border-none bg-amber-100 px-2 text-[10px] font-bold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
              <DollarSign className="h-3 w-3 mr-0.5" />
              Recurso Próprio
            </Badge>
          )}
          {/* Stage pill */}
          <Popover open={stagePopoverOpen} onOpenChange={(open) => canOperateLead && setStagePopoverOpen(open)}>

            <PopoverTrigger asChild>
              <button disabled={!canOperateLead} className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden rounded-[6px] bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary disabled:cursor-default disabled:opacity-70">
                <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse shrink-0" />
                <span className="truncate">{currentStage?.name || 'Sem estágio'}</span>
                <ChevronDown className="h-3 w-3 shrink-0 ml-auto" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-[calc(100vw-2rem)] max-w-sm border-0 bg-[var(--app-surface-solid)] p-2 text-[var(--app-text-primary)] shadow-[0_14px_34px_rgba(0,0,0,0.22)]" align="start" collisionPadding={12}>
              <div className="max-h-[min(70vh,22rem)] space-y-1 overflow-y-auto overscroll-contain pr-1 touch-pan-y scrollbar-thin">
                {stages.map((stage, idx) => {
                  const isActive = stage.id === localLead.stage_id;
                  const isPast = idx < currentStageIndex;
                  return (
                    <button key={stage.id} disabled={!canOperateLead} onClick={() => handleMoveToStage(stage.id)} className={cn("flex w-full items-center gap-3 rounded-[6px] px-3 py-2.5 text-left transition-all disabled:cursor-default", isActive ? "bg-primary text-primary-foreground" : isPast ? "bg-primary/10 text-primary hover:bg-primary/20" : "hover:bg-accent")}>
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
          <Select value={localLead.deal_status || 'open'} onValueChange={handleDealStatusChange} disabled={!canOperateLead}>
              <SelectTrigger
                className={cn(
                  "h-auto w-auto shrink-0 gap-1.5 rounded-[6px] px-3 py-1.5 text-xs font-medium",
                  getDealStatusTriggerClass(localLead.deal_status)
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
        {localLead.deal_status === 'lost' && (
          <Input
            value={lostReasonLocal}
            onChange={(e) => setLostReasonLocal(e.target.value)}
            onBlur={async (e) => {
              if (!canOperateLead) return;
              if (e.target.value !== (lead.lost_reason || '')) {
                await updateLead.mutateAsync({ id: lead.id, lost_reason: e.target.value });
                refetchStages();
              }
            }}
            placeholder="Motivo da perda..."
            disabled={!canOperateLead}
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
                    <div className="h-7 w-7 rounded-lg bg-primary flex items-center justify-center shadow-sm shadow-primary/20">
                      <ListTodo className="h-3.5 w-3.5 text-primary-foreground" />
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
                            "h-8 w-8 rounded-lg flex items-center justify-center shrink-0 shadow-sm",
                            isDone ? "bg-emerald-500 shadow-emerald-500/20" : "bg-primary shadow-primary/20"
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
                <Textarea
                  placeholder="Feedback sobre o lead..."
                  className="min-h-[120px] rounded-xl resize-none text-sm"
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  disabled={!canOperateLead}
                />
                <div className="flex justify-end">
                  <Button
                    className="lead-detail-primary-action rounded-[6px] px-3"
                    size="sm"
                    disabled={!canOperateLead || !feedback.trim() || updateLead.isPending}
                    onClick={handleSaveFeedback}
                  >
                    Registrar feedback
                  </Button>
                </div>
              </div>

            </div>
          )}


          {/* Schedule Tab */}
          {activeTab === 'schedule' && <div className="space-y-4">
              <div className="flex justify-end">
                <Button variant="default" disabled={!canManageLeadSchedule} onClick={() => {
                  setEditingScheduleEvent(null);
                  setScheduleDefaultType('call');
                  setScheduleFormOpen(true);
                }} className="lead-detail-primary-action rounded-[6px] px-3">
                  <Plus className="h-3.5 w-3.5" />
                  Novo agendamento
                </Button>
              </div>

              <EventsList
                events={scheduleEvents}
                canManage={canManageLeadSchedule}
                onEditEvent={canManageLeadSchedule ? handleEditScheduleEvent : undefined}
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
                {canOperateLead && <Button variant="ghost" size="sm" onClick={handleOpenLeadEdit} className="lead-detail-subtle-action h-8 rounded-[6px] px-3">
                    <FileEdit className="h-3.5 w-3.5" />
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
                <Popover open={assigneePopoverOpen} onOpenChange={handleAssigneePopoverChange}>
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
                  <PopoverContent
                    className="w-[calc(100vw-2rem)] max-w-[380px] overflow-hidden border-0 bg-[var(--app-surface-solid)] p-1 shadow-2xl"
                    align="start"
                    collisionPadding={12}
                    onWheelCapture={(event) => event.stopPropagation()}
                    onTouchMoveCapture={(event) => event.stopPropagation()}
                  >
                    <Command filter={commandSearchFilter} className="max-h-[min(72vh,460px)] border-none bg-transparent [&_[cmdk-input-wrapper]]:border-b-0 [&_[cmdk-input-wrapper]]:px-2">
                      <CommandInput placeholder="Buscar responsável..." className="h-10 border-none focus:ring-0" />
                      <CommandList
                        className="max-h-[min(58vh,360px)] overflow-y-auto overscroll-contain p-1 touch-pan-y scrollbar-thin [-webkit-overflow-scrolling:touch]"
                        onWheelCapture={(event) => event.stopPropagation()}
                        onTouchMoveCapture={(event) => event.stopPropagation()}
                      >
                        <CommandEmpty className="py-6 text-center text-sm text-muted-foreground">
                          Nenhum usuário encontrado.
                        </CommandEmpty>
                        <CommandGroup heading="Ações">
                          <CommandItem
                            onSelect={() => {
                              handleAssignUser(null);
                              setAssigneePopoverOpen(false);
                            }}
                            className="flex cursor-pointer items-center gap-3 rounded-[6px] px-3 py-2.5"
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
                                  "my-0.5 flex cursor-pointer items-center gap-3 rounded-[6px] px-3 py-2.5 transition-all",
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
                    value={localLead.deal_status || 'open'}
                    onValueChange={handleDealStatusChange}
                    disabled={!canOperateLead}
                  >
                    <SelectTrigger className={cn('rounded-xl', getDealStatusTriggerClass(localLead.deal_status))}>
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
                {localLead.deal_status === 'lost' && (
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
                    properties={propertyOptions}
                    selectedPropertyId={localLead.interest_property_id || editForm.property_id || null}
                    onSelect={(property) => void handleSelectInterestProperty(property)}
                    disabled={!canOperateLead || !canViewProperties}
                    isLoading={propertyPickerLoading}
                    onOpenChange={handlePropertyPickerOpenChange}
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
              {localLead.deal_status === 'won' && interestValue > 0 && (
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

              {localLead.deal_status !== 'won' && interestValue > 0 && (
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

  void MobileContent; // Legacy mobile kept available while the V2 layout is validated.

  const MobileContentV2 = () => {
    const leadAvatarUrl = lead.whatsapp_picture || lead.whatsapp_avatar_url || lead.contact_picture || null;
    const dealStatusLabel = localLead.deal_status === 'won' ? 'Ganho' : localLead.deal_status === 'lost' ? 'Perdido' : 'Aberto';
    const mobileActiveTab = ['summary', 'actions', 'history'].includes(activeTab) ? activeTab : 'summary';
    const contactRows: Array<{ label: string; value: ReactNode }> = [
      { label: 'Nome', value: <LeadProfileHover lead={localLead} canRevealSensitive={canOperateLead} /> },
      { label: 'Telefone', value: formatPhoneForDisplay(localLead.phone || '') },
      { label: 'Origem', value: sourceLabels[leadSource] || leadSource },
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
                    data-lead-stage-step
                    onClick={() => handleMoveToStage(stage.id)}
                    className={cn(
                      'lead-stage-step relative flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-[11px] font-medium',
                      isActive
                        ? 'bg-primary text-white'
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
            <button type="button" onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)]">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-start gap-2.5">
            <Avatar className="h-10 w-10 shrink-0 border-0">
              <AvatarImage src={leadAvatarUrl || undefined} alt={leadName} />
              <AvatarFallback className="bg-primary text-sm font-semibold text-white">
                {leadName?.[0]?.toUpperCase() || <User className="h-5 w-5" />}
              </AvatarFallback>
            </Avatar>

            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <h2 className="truncate text-base font-semibold leading-tight">{leadName}</h2>
                <ReentryBadge count={lead.reentry_count} lastEntryAt={lead.last_entry_at} />
              </div>
              {lead.phone && (
                <div className="mt-1 flex min-w-0 items-center gap-1.5">
                  <p className="truncate text-xs text-[var(--app-text-tertiary)]">{formatPhoneForDisplay(lead.phone)}</p>
                  <CopyLeadPhoneButton phone={lead.phone} className="h-6 w-6 bg-transparent hover:bg-[var(--app-surface-soft)]" />
                </div>
              )}

              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {leadTags.slice(0, 4).map((tag) => {
                  const tagColor = getTagColor(tag);
                  return (
                    <Badge
                      key={tag.id}
                      className="flex h-5 items-center gap-1 rounded-[4px] border-0 px-1.5 text-[10px]"
                      style={{ backgroundColor: tagColor, color: '#fff' }}
                    >
                      <span className="max-w-[82px] truncate">{tag.name || 'Tag'}</span>
                      <button disabled={!canOperateLead} type="button" className="rounded-[3px] p-0.5 hover:bg-black/10 disabled:hidden" onClick={() => handleRemoveTag(tag.id)}>
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
                <Popover open={tagPopoverOpen} onOpenChange={(open) => canOperateLead && setTagPopoverOpen(open)}>
                  <PopoverTrigger asChild>
                    <Button disabled={!canOperateLead} variant="ghost" size="sm" className="h-5 rounded-[5px] border-0 bg-[var(--app-surface-soft)] px-1.5 text-[10px] disabled:hidden">
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
                  className="h-8 min-w-0 justify-start rounded-[6px] bg-[var(--app-surface-soft)] px-2.5 text-xs text-[var(--app-text-secondary)]"
                  disabled={!canTransferLead}
                  onClick={(event) => event.stopPropagation()}
                >
                  <User className="mr-1.5 h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{assigneeName || 'Sem responsável'}</span>
                  {isUpdatingAssignee ? <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin" /> : <ChevronDown className="ml-auto h-3.5 w-3.5" />}
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="w-[calc(100vw-2rem)] max-w-[380px] overflow-hidden border-0 bg-[var(--app-surface-solid)] p-1 shadow-2xl"
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
                              <AvatarImage src={user.avatar_url || undefined} />
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
              <SelectTrigger className={cn('h-8 w-[92px] gap-1 rounded-[6px] px-2 text-xs font-medium', getDealStatusTriggerClass(localLead.deal_status))}>
                <SelectValue>{dealStatusLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Aberto</SelectItem>
                <SelectItem value="won">Ganho</SelectItem>
                <SelectItem value="lost">Perdido</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="mt-2 grid grid-cols-3 gap-2">
            {lead.phone && (
              <Button disabled={!canOperateLead} variant="outline" size="sm" onClick={handleQuickPhone} className="h-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)]">
                <Phone className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button disabled={!canOperateLead} size="sm" onClick={handleQuickWhatsApp} className="h-8 rounded-[6px] px-2 text-xs">
              <MessageCircle className="mr-1 h-3.5 w-3.5" />
              Chat
            </Button>
            {lead.email && (
              <Button disabled={!canOperateLead} variant="outline" size="sm" onClick={handleQuickEmail} className="h-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)]">
                <Mail className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        <div className="shrink-0 border-b border-[var(--app-border)] bg-[var(--app-surface-solid)] px-3 py-2">
          <div className="grid grid-cols-3 gap-1 rounded-[7px] bg-[var(--app-surface-soft)] p-1">
            {mobileTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = mobileActiveTab === tab.id;

              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'flex h-8 items-center justify-center gap-1.5 rounded-[5px] text-[11px] font-medium transition-colors',
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
                    <h3 className="text-xs font-semibold">Dados do contato</h3>
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
                      <Input value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} className="h-8 rounded-[6px]" placeholder="Nome" />
                      <PhoneInput value={editForm.phone} onChange={(value) => setEditForm({ ...editForm, phone: value })} />
                      <Input value={editForm.email} onChange={(event) => setEditForm({ ...editForm, email: event.target.value })} className="h-8 rounded-[6px]" placeholder="E-mail" />
                      <div className="grid grid-cols-2 gap-2">
                        <Input value={editForm.cargo} onChange={(event) => setEditForm({ ...editForm, cargo: event.target.value })} className="h-8 rounded-[6px]" placeholder="Cargo" />
                        <Input value={editForm.empresa} onChange={(event) => setEditForm({ ...editForm, empresa: event.target.value })} className="h-8 rounded-[6px]" placeholder="Empresa" />
                      </div>
                      <Button size="sm" className="h-8 w-full rounded-[6px]" onClick={handleSaveContact}>
                        <Save className="mr-1.5 h-3.5 w-3.5" />
                        Salvar dados
                      </Button>
                    </div>
                  )}
                </section>

                <PropertyPickerDialog
                  properties={propertyOptions}
                  selectedPropertyId={localLead.interest_property_id || editForm.property_id || null}
                  onSelect={(property) => void handleSelectInterestProperty(property)}
                  disabled={!canOperateLead || !canViewProperties}
                  isLoading={propertyPickerLoading}
                  onOpenChange={handlePropertyPickerOpenChange}
                />

                <section className="rounded-[8px] bg-[var(--app-surface-soft)] p-3">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-xs font-semibold">Documentação</h3>
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
                          className="flex w-full items-center gap-2 rounded-[6px] border-0 bg-[var(--app-surface-solid)] px-2 py-2 text-left text-xs outline-none ring-0 focus:outline-none focus-visible:outline-none focus-visible:ring-0"
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


                <section className="lead-agenda-card rounded-[8px] bg-[var(--app-surface-soft)] p-3">
                  <div className="flex items-center justify-between">
                    <div className="lead-agenda-summary min-w-0">
                      <h3 className="text-xs font-semibold">Agenda</h3>
                      <p className="text-[10px] text-[var(--app-text-tertiary)]">{scheduleEvents.length} compromisso(s)</p>
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
                </section>

                <section className="rounded-[8px] bg-[var(--app-surface-soft)] p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="min-w-0">
                      <h3 className="truncate text-xs font-semibold">{cadenceTitle}</h3>
                    </div>
                    {totalTasksCount > 0 && (
                      <Badge variant="outline" className="rounded-[5px] border-0 bg-[var(--app-surface-solid)] text-[10px]">
                        {completedTasksCount}/{totalTasksCount}
                      </Badge>
                    )}
                  </div>
                  {leadTasksLoading ? (
                    <div className="flex items-center justify-center py-5">
                      <Loader2 className="h-4 w-4 animate-spin text-[var(--app-text-tertiary)]" />
                    </div>
                  ) : templateTasks.length === 0 ? (
                    <p className="rounded-[6px] bg-[var(--app-surface-solid)] px-3 py-2 text-xs text-[var(--app-text-tertiary)]">
                      Nenhuma cadência configurada para esta etapa
                    </p>
                  ) : (
                    <div className="max-h-[320px] space-y-1.5 overflow-y-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      {templateTasks.map((task) => {
                        const taskType = getCadenceTaskType(task.type);
                        const existingTask = leadTasksMap.get(`${task.title}-${task.day_offset}-${task.type}`);
                        const isDone = existingTask?.is_done || false;
                        const TaskIcon = activityTypeIcons[taskType] || Clock;

                        return (
                          <button
                            key={task.id}
                            type="button"
                            onClick={() => handleCadenceTaskClick(task)}
                            className={cn(
                              'flex w-full items-center gap-2 rounded-[6px] bg-[var(--app-surface-solid)] px-2.5 py-2 text-left transition-colors hover:bg-primary/10',
                              isDone && 'opacity-65',
                            )}
                          >
                            <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] shadow-sm', isDone ? 'bg-emerald-500 text-white shadow-emerald-500/20' : 'bg-primary text-primary-foreground shadow-primary/20')}>
                              {isDone ? <Check className="h-3 w-3" /> : <TaskIcon className="h-3 w-3" />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className={cn('block truncate text-xs font-medium', isDone && 'line-through')}>
                                {task.title}
                              </span>
                              <span className="block text-[10px] text-[var(--app-text-tertiary)]">
                                {taskTypeLabels[taskType]} - Dia {task.day_offset}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>

                <section className="rounded-[8px] bg-[var(--app-surface-soft)] p-3">
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
            </div>
          )}

          {mobileActiveTab === 'history' && (
            <div className="h-full p-2">
              <LeadUnifiedThread
                leadId={lead.id}
                leadName={leadName}
                leadAvatarUrl={leadAvatarUrl}
                leadPhone={lead.phone || null}
                whatsappVerified={lead.whatsapp_verified ?? null}
                leadCreatedAt={lead.created_at || null}
                composerRequest={composerRequest}
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
      { label: 'Origem', value: sourceLabels[leadSource] || leadSource },
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
                          data-lead-stage-step
                          onClick={() => handleMoveToStage(stage.id)}
                          className={cn(
                            'lead-stage-step group relative flex h-8 w-8 items-center justify-center rounded-[6px] text-xs font-medium transition-colors',
                            isActive
                              ? 'bg-primary text-white'
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
                    <AvatarFallback className="bg-primary text-sm font-semibold text-white">
                      {leadName?.[0]?.toUpperCase() || <User className="h-5 w-5" />}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h2 className="truncate text-base font-semibold leading-tight">{leadName}</h2>
                      <ReentryBadge count={lead.reentry_count} lastEntryAt={lead.last_entry_at} />
                    </div>
                    <div data-tour="lead-detail-tags" className="mt-2 flex flex-wrap gap-1.5">
                      {leadTags.map((tag) => {
                        const tagColor = getTagColor(tag);
                        return (
                          <Badge
                            key={tag.id}
                            className="flex h-6 items-center gap-1 rounded-[5px] border-0 px-2 text-[10px]"
                            style={{ backgroundColor: tagColor, color: '#fff' }}
                          >
                            {tag.name || 'Tag'}
                            <button disabled={!canOperateLead} type="button" className="rounded-[3px] p-0.5 hover:bg-black/10 disabled:hidden" onClick={() => handleRemoveTag(tag.id)}>
                              <X className="h-2.5 w-2.5" />
                            </button>
                          </Badge>
                        );
                      })}
                      <Popover open={tagPopoverOpen} onOpenChange={(open) => canOperateLead && setTagPopoverOpen(open)}>
                        <PopoverTrigger asChild>
                          <Button disabled={!canOperateLead} variant="ghost" size="sm" className="h-6 rounded-[5px] border-0 bg-[var(--app-surface-soft)] px-2 text-[10px] disabled:hidden">
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
                        className="h-8 min-w-0 justify-start rounded-[6px] bg-[var(--app-surface-soft)] px-3 text-xs text-[var(--app-text-secondary)]"
                        disabled={!canTransferLead}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <User className="mr-1.5 h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{assigneeName || 'Sem responsavel'}</span>
                        {isUpdatingAssignee ? <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin" /> : <ChevronDown className="ml-auto h-3.5 w-3.5" />}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      className="w-[300px] overflow-hidden border-0 bg-[var(--app-surface-solid)] p-1 shadow-[0_18px_50px_rgba(0,0,0,0.16)]"
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
                              Sem responsavel
                            </CommandItem>
                            {assignableUsers.map((user) => (
                              <CommandItem key={user.id} onSelect={() => handleAssignUser(user.id)} className="cursor-pointer rounded-[6px] px-3 py-2">
                                <div className="flex min-w-0 items-center gap-2">
                                  <Avatar className="h-7 w-7">
                                    <AvatarImage src={user.avatar_url || undefined} />
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
                          'h-8 w-[92px] gap-1 rounded-[6px] px-2 text-xs font-medium',
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

                <div className="grid grid-cols-3 gap-2">
                  {lead.phone && (
                    <Button disabled={!canOperateLead} variant="outline" size="sm" onClick={handleQuickPhone} className="h-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)]">
                      <Phone className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button disabled={!canOperateLead} size="sm" onClick={handleQuickWhatsApp} className="h-8 rounded-[6px] px-2 text-xs">
                    <MessageCircle className="mr-1 h-3.5 w-3.5" />
                    Chat
                  </Button>
                  {lead.email && (
                    <Button disabled={!canOperateLead} variant="outline" size="sm" onClick={handleQuickEmail} className="h-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)]">
                      <Mail className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>

                <div data-tour="lead-detail-contact" className="rounded-[8px] bg-[var(--app-surface-soft)] p-3">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-xs font-semibold">Dados do contato</h3>
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
                      <Input value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} className="h-8 rounded-[6px]" placeholder="Nome" />
                      <PhoneInput value={editForm.phone} onChange={(value) => setEditForm({ ...editForm, phone: value })} />
                      <Input value={editForm.email} onChange={(event) => setEditForm({ ...editForm, email: event.target.value })} className="h-8 rounded-[6px]" placeholder="E-mail" />
                      <div className="grid grid-cols-2 gap-2">
                        <Input value={editForm.cargo} onChange={(event) => setEditForm({ ...editForm, cargo: event.target.value })} className="h-8 rounded-[6px]" placeholder="Cargo" />
                        <Input value={editForm.empresa} onChange={(event) => setEditForm({ ...editForm, empresa: event.target.value })} className="h-8 rounded-[6px]" placeholder="Empresa" />
                      </div>
                      <Button size="sm" className="h-8 w-full rounded-[6px]" onClick={handleSaveContact}>
                        <Save className="mr-1.5 h-3.5 w-3.5" />
                        Salvar dados
                      </Button>
                    </div>
                  )}
                </div>

                <PropertyPickerDialog
                  properties={propertyOptions}
                  selectedPropertyId={localLead.interest_property_id || editForm.property_id || null}
                  onSelect={(property) => void handleSelectInterestProperty(property)}
                  disabled={!canOperateLead || !canViewProperties}
                  isLoading={propertyPickerLoading}
                  onOpenChange={handlePropertyPickerOpenChange}
                />

                <div data-tour="lead-detail-documents" className="rounded-[8px] bg-[var(--app-surface-soft)] p-3">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-xs font-semibold">Documentacao</h3>
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
                          className="flex w-full items-center gap-2 rounded-[6px] border-0 bg-[var(--app-surface-solid)] px-2 py-2 text-left text-xs outline-none ring-0 focus:outline-none focus-visible:outline-none focus-visible:ring-0"
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


                <section data-tour="lead-detail-agenda" className="lead-agenda-card rounded-[8px] bg-[var(--app-surface-soft)] p-3">
                  <div className="flex items-center justify-between">
                    <div className="lead-agenda-summary min-w-0">
                      <h3 className="text-xs font-semibold">Agenda</h3>
                      <p className="text-[10px] text-[var(--app-text-tertiary)]">{scheduleEvents.length} compromisso(s)</p>
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
                </section>

                <section data-tour="lead-detail-cadence" className="rounded-[8px] bg-[var(--app-surface-soft)] p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="min-w-0">
                      <h3 className="truncate text-xs font-semibold">{cadenceTitle}</h3>
                    </div>
                    {totalTasksCount > 0 && (
                      <Badge variant="outline" className="rounded-[5px] border-0 bg-[var(--app-surface-solid)] text-[10px]">
                        {completedTasksCount}/{totalTasksCount}
                      </Badge>
                    )}
                  </div>
                  {leadTasksLoading ? (
                    <div className="flex items-center justify-center py-5">
                      <Loader2 className="h-4 w-4 animate-spin text-[var(--app-text-tertiary)]" />
                    </div>
                  ) : templateTasks.length === 0 ? (
                    <p className="rounded-[6px] bg-[var(--app-surface-solid)] px-3 py-2 text-xs text-[var(--app-text-tertiary)]">
                      Nenhuma cadencia configurada para esta etapa
                    </p>
                  ) : (
                    <div className="max-h-[320px] space-y-1.5 overflow-y-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      {templateTasks.map((task) => {
                        const taskType = getCadenceTaskType(task.type);
                        const existingTask = leadTasksMap.get(`${task.title}-${task.day_offset}-${task.type}`);
                        const isDone = existingTask?.is_done || false;
                        const TaskIcon = activityTypeIcons[taskType] || Clock;

                        return (
                          <button
                            key={task.id}
                            type="button"
                            onClick={() => handleCadenceTaskClick(task)}
                            className={cn(
                              'flex w-full items-center gap-2 rounded-[6px] bg-[var(--app-surface-solid)] px-2.5 py-1.5 text-left transition-colors hover:bg-primary/10',
                              isDone && 'opacity-65',
                            )}
                          >
                            <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] shadow-sm', isDone ? 'bg-emerald-500 text-white shadow-emerald-500/20' : 'bg-primary text-primary-foreground shadow-primary/20')}>
                              {isDone ? <Check className="h-3 w-3" /> : <TaskIcon className="h-3 w-3" />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className={cn('block truncate text-xs font-medium', isDone && 'line-through')}>
                                {task.title}
                              </span>
                              <span className="block text-[10px] text-[var(--app-text-tertiary)]">
                                {taskTypeLabels[taskType]} - Dia {task.day_offset}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>

                <section data-tour="lead-detail-feedback" className="rounded-[8px] bg-[var(--app-surface-soft)] p-3">
                  <Textarea
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
              leadPhone={lead.phone || null}
              whatsappVerified={lead.whatsapp_verified ?? null}
              leadCreatedAt={lead.created_at || null}
              composerRequest={composerRequest}
            />
          </aside>
        </div>
      </div>
    );
  };

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
              value={localLead.deal_status || 'open'}
              onValueChange={handleDealStatusChange}
              disabled={!canOperateLead}
            >
              <SelectTrigger
                className={cn(
                  "h-7 w-auto gap-1.5 rounded-[6px] px-3 text-xs font-medium",
                  getDealStatusTriggerClass(localLead.deal_status)
                )}
              >
                {localLead.deal_status === 'won' && <Trophy className="h-3 w-3" />}
                {localLead.deal_status === 'lost' && <XCircle className="h-3 w-3" />}
                {(!localLead.deal_status || localLead.deal_status === 'open') && <CircleDot className="h-3 w-3" />}
                <span>
                  {localLead.deal_status === 'won' ? 'Ganho' : localLead.deal_status === 'lost' ? 'Perdido' : 'Aberto'}
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
                  <button disabled={!canOperateLead} onClick={() => handleRemoveTag(tag.id)} className="ml-0.5 rounded-[3px] p-0.5 transition-colors hover:bg-black/10 disabled:hidden">
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              );
            })}
            <Popover open={tagPopoverOpen} onOpenChange={(open) => canOperateLead && setTagPopoverOpen(open)}>
              <PopoverTrigger asChild>
                <Button disabled={!canOperateLead} variant="ghost" size="sm" className="h-7 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2 text-xs text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary disabled:hidden">
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
                <Popover open={assigneePopoverOpen} onOpenChange={handleAssigneePopoverChange}>
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
                  <PopoverContent
                    className="w-[300px] overflow-hidden border-0 bg-[var(--app-surface-solid)] p-1 shadow-[0_18px_50px_rgba(0,0,0,0.16)]"
                    align="start"
                    collisionPadding={12}
                    onWheelCapture={(event) => event.stopPropagation()}
                    onTouchMoveCapture={(event) => event.stopPropagation()}
                  >
                    <Command filter={commandSearchFilter} className="max-h-[min(70vh,430px)] border-none bg-transparent [&_[cmdk-input-wrapper]]:border-b-0 [&_[cmdk-input-wrapper]]:px-2">
                      <CommandInput placeholder="Buscar..." className="h-10 border-none focus:ring-0" />
                      <CommandList
                        className="max-h-[min(58vh,350px)] overflow-y-auto overscroll-contain p-1 touch-pan-y scrollbar-thin [-webkit-overflow-scrolling:touch]"
                        onWheelCapture={(event) => event.stopPropagation()}
                        onTouchMoveCapture={(event) => event.stopPropagation()}
                      >
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
                              "flex cursor-pointer items-center gap-2.5 rounded-[6px] px-3 py-2.5 transition-colors",
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
                                  "my-0.5 flex cursor-pointer items-center gap-2.5 rounded-[6px] px-3 py-2.5 transition-all",
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
              {lead.phone &&
                  <Button disabled={!canOperateLead} variant="outline" size="sm" onClick={handleQuickPhone} className="h-9 w-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] p-0 transition-colors hover:bg-primary/10 hover:text-primary">
                    <Phone className="h-4 w-4" />
                  </Button>
              }
              <Button disabled={!canOperateLead} size="sm" onClick={handleQuickWhatsApp} className="h-9 rounded-[6px] bg-primary px-4 text-white transition-opacity hover:bg-primary hover:opacity-90">
                <MessageCircle className="h-4 w-4 mr-1.5" />
                Chat
              </Button>
              {lead.email && <Button disabled={!canOperateLead} variant="outline" size="sm" onClick={handleQuickEmail} className="h-9 w-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] p-0 transition-colors hover:bg-primary/10 hover:text-primary">
                  <Mail className="h-4 w-4" />
                </Button>}
            </div>
          </div>
        </DialogHeader>


        {/* Pipeline Timeline - Stage Stepper */}
        <div className="mt-3 overflow-hidden">
          <ScrollArea className="w-full" type="scroll">
            <TooltipProvider delayDuration={0}>
              <nav data-lead-stage-stepper className="stage-tab-nav" style={stageStepperStyle}>
                {stages.map((stage, idx) => {
                  const isActive = stage.id === lead.stage_id;
                  const isPast = idx < currentStageIndex;
                  return (
                    <Tooltip key={stage.id}>
                      <TooltipTrigger asChild>
                        <button
                          disabled={!canOperateLead}
                          onClick={() => handleMoveToStage(stage.id)}
                          aria-label={`Mover para ${stage.name}`}
                          data-lead-stage-step
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
                      <TooltipContent side="top" align="center" sideOffset={8} className={stageTooltipClassName}>
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
                  <h3 className="font-semibold">{cadenceTitle}</h3>
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
                            "h-9 w-9 rounded-xl flex items-center justify-center shrink-0 shadow-sm transition-transform group-hover:scale-105",
                            isDone ? "bg-emerald-500 shadow-emerald-500/20" : "bg-primary shadow-primary/20"
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
                <div className="space-y-3">
                  <Textarea
                    placeholder="Digite aqui o feedback sobre o atendimento ou perfil do lead..."
                    className="min-h-[150px] rounded-xl resize-none focus-visible:ring-primary/20"
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    disabled={!canOperateLead}
                  />
                  <div className="flex justify-end">
                    <Button
                      className="lead-detail-primary-action rounded-[6px] px-3"
                      disabled={!canOperateLead || !feedback.trim() || updateLead.isPending}
                      onClick={handleSaveFeedback}
                    >
                      Registrar feedback
                    </Button>
                  </div>
                </div>

              </div>
            </div>
          </TabsContent>

          {/* Schedule Tab */}
          <TabsContent value="schedule" className="p-6 mt-0">
            <div className="space-y-4">
              <div className="flex justify-end">
                <Button variant="default" disabled={!canManageLeadSchedule} onClick={() => {
                  setEditingScheduleEvent(null);
                  setScheduleDefaultType('call');
                  setScheduleFormOpen(true);
                }} className="lead-detail-primary-action rounded-[6px] px-3">
                  <Plus className="h-3.5 w-3.5" />
                  Novo agendamento
                </Button>
              </div>

              <EventsList
                events={scheduleEvents}
                canManage={canManageLeadSchedule}
                onEditEvent={canManageLeadSchedule ? handleEditScheduleEvent : undefined}
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
                      {canOperateLead ? <Button variant="ghost" size="sm" onClick={handleOpenLeadEdit} className="lead-detail-subtle-action h-8 rounded-[6px] px-3">
                        <FileEdit className="h-3.5 w-3.5" />
                        Editar
                      </Button> : null}
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
                        {canOperateLead && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              className="lead-detail-subtle-action h-8 gap-1 px-3"
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

                      {attachments.length > 0 && (
                        <div className="rounded-xl bg-white/[0.035] border border-white/[0.055] p-3 flex flex-col">
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
                                      onClick={() => void handleOpenAttachment(doc)}
                                      title="Visualizar"
                                    >
                                      <Eye className="h-3.5 w-3.5 text-muted-foreground" />
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
                        </div>
                      )}
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
                    value={localLead.deal_status || 'open'}
                    onValueChange={handleDealStatusChange}
                    disabled={!canOperateLead}
                  >
                    <SelectTrigger className={cn('rounded-xl', getDealStatusTriggerClass(localLead.deal_status))}>
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
                {localLead.deal_status === 'lost' && (
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
                    properties={propertyOptions}
                    selectedPropertyId={localLead.interest_property_id || editForm.property_id || null}
                    onSelect={(property) => void handleSelectInterestProperty(property)}
                    disabled={!canOperateLead || !canViewProperties}
                    isLoading={propertyPickerLoading}
                    onOpenChange={handlePropertyPickerOpenChange}
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
              {localLead.deal_status === 'won' && interestValue > 0 && (
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

              {localLead.deal_status !== 'won' && interestValue > 0 && (
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

  const ReopenLeadDialog = () => {
    const fromStatusLabel = reopenStatusConfirmation?.fromStatus === 'won'
      ? 'ganho'
      : reopenStatusConfirmation?.fromStatus === 'lost'
        ? 'perdido'
        : 'finalizado';

    return (
      <AlertDialog
        open={Boolean(reopenStatusConfirmation)}
        onOpenChange={(open) => {
          if (!open) setReopenStatusConfirmation(null);
        }}
      >
        <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-md rounded-[8px] border-0 bg-[var(--app-surface-solid)] text-[var(--app-text-primary)] shadow-none">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar reabertura do lead?</AlertDialogTitle>
            <AlertDialogDescription>
              {reopenStatusConfirmation?.leadName || 'Este lead'} está marcado como {fromStatusLabel}. Ao confirmar, ele volta para Aberto e pode entrar novamente no fluxo comercial.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="rounded-[6px] border-0 bg-black/[0.06] font-normal text-[var(--app-text-secondary)] hover:bg-black/[0.1] hover:text-[var(--app-text-primary)] dark:bg-white/[0.08] dark:hover:bg-white/[0.12]"
              disabled={dealStatusChange.isPending}
            >
              Não reabrir
            </AlertDialogCancel>
            <AlertDialogAction
              className="rounded-[6px] bg-primary font-normal tracking-normal text-primary-foreground antialiased hover:bg-primary/90"
              disabled={dealStatusChange.isPending || !reopenStatusConfirmation}
              onClick={() => {
                const confirmation = reopenStatusConfirmation;
                if (!confirmation) return;

                void handleDealStatusChange('open', {
                  skipReopenConfirmation: true,
                  previousStatusOverride: confirmation.fromStatus,
                });
              }}
            >
              {dealStatusChange.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Reabrindo...
                </>
              ) : (
                'Sim, reabrir lead'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  };

  // Render mobile or desktop version - use JSX directly instead of component functions
  if (isMobile) {
    return (
      <>
        <Drawer open={!!lead} onOpenChange={() => onClose()} dismissible={!isEditingContact}>
          <DrawerContent
            className="lead-mobile-drawer mx-auto w-full overflow-hidden rounded-t-[10px] border-0 bg-[var(--app-surface-solid)] p-0 text-[var(--app-text-primary)] shadow-[0_18px_42px_rgba(0,0,0,0.28)]"
            showHandle={false}
            onOpenAutoFocus={(event) => event.preventDefault()}
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
        {RoteiroDialog()}
        {OutcomeDialogComponent()}
        {ReopenLeadDialog()}
        <LostReasonDialog
          open={lostReasonDialogOpen}
          onOpenChange={setLostReasonDialogOpen}
          onConfirm={handleConfirmLostReason}
          leadName={leadName}
          loading={dealStatusChange.isPending}
        />
        <LeadAttachmentViewer
          key={selectedAttachment ? `${selectedAttachment.id}:${selectedAttachment.file_url}` : 'no-attachment'}
          attachment={selectedAttachment}
          open={Boolean(selectedAttachment)}
          onOpenChange={(open) => {
            if (!open) setSelectedAttachment(null);
          }}
        />
      </>
    );
  }
  const useLeadDetailV2 = true;

  return (
    <>
      <Dialog
        open={!!lead}
        onOpenChange={(open) => {
          if (!open && document.documentElement.dataset.setupGuideActiveStep === 'pipeline') return;
          if (!open) onClose();
        }}
      >
        <DialogContent
          data-tour="lead-detail-dialog"
          className="lead-detail-dialog-content h-[92vh] lg:h-[min(720px,84vh)] w-[96vw] lg:w-[92vw] xl:w-[min(1180px,92vw)] max-w-[1180px] max-h-[92vh] lg:max-h-[84vh] overflow-hidden rounded-[8px] border-none bg-[var(--app-surface-solid)] p-0 text-[var(--app-text-primary)] shadow-none animate-scale-in flex flex-col gap-0"
          style={{ border: 'none', outline: 'none' }}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => event.preventDefault()}
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
          {useLeadDetailV2 ? DesktopContentV2() : DesktopContent()}
        </DialogContent>
      </Dialog>
      {RoteiroDialog()}
      {OutcomeDialogComponent()}
      {ReopenLeadDialog()}
      <LostReasonDialog
        open={lostReasonDialogOpen}
        onOpenChange={setLostReasonDialogOpen}
        onConfirm={handleConfirmLostReason}
        leadName={leadName}
        loading={dealStatusChange.isPending}
      />
      <LeadAttachmentViewer
        key={selectedAttachment ? `${selectedAttachment.id}:${selectedAttachment.file_url}` : 'no-attachment'}
        attachment={selectedAttachment}
        open={Boolean(selectedAttachment)}
        onOpenChange={(open) => {
          if (!open) setSelectedAttachment(null);
        }}
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
                {selectedHistoryEvent.content || metaText(selectedHistoryEvent.metadata?.outcome_notes) || "Nenhum detalhe adicional disponível."}
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
