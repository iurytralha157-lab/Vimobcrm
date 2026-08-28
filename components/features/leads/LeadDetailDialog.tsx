import { useState, useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
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
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Phone, Mail, MessageCircle, Loader2, X, Plus, Save, User,
  MapPin, Calendar, Lightbulb, FileEdit, Check, Activity, ListTodo, Contact,
  ChevronDown, FileText, Paperclip, Info, Eye, EyeOff, ExternalLink
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
import { commandSearchFilter } from '@/lib/search-text';
import { format, type Locale } from 'date-fns';
import { ptBR, enUS } from 'date-fns/locale';
import { useCompleteCadenceTask } from '@/hooks/use-lead-tasks';
import { useLeadCadenceState } from '@/hooks/leads/use-lead-cadence-state';
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
import { LeadUnifiedThread } from '@/components/features/leads/LeadUnifiedThread';
import { ReentryBadge } from '@/components/features/leads/ReentryBadge';
import { LostReasonDialog } from '@/components/features/leads/LostReasonDialog';
import { LeadAttachmentViewer } from '@/components/features/leads/LeadAttachmentViewer';
import { CopyLeadPhoneButton } from '@/components/features/leads/CopyLeadPhoneButton';
import { LeadCadencePanel } from '@/components/features/leads/LeadCadencePanel';

import { TaskOutcomeDialog, TaskOutcome } from '@/components/features/leads/TaskOutcomeDialog';
import { EventSheet } from '@/components/features/schedule/EventSheet';
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
import { teamsAPI } from '@/lib/api/teams';
import { maskCPF, maskRG } from '@/lib/masks';
import type { LeadCadenceTaskState } from '@/lib/validation';
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

function getTagForegroundClass(backgroundColor: string) {
  const match = backgroundColor.trim().match(/^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i);
  if (!match) return 'text-primary-foreground';

  const value = match[1].length === 3
    ? match[1].split('').map((character) => character + character).join('')
    : match[1].slice(0, 6);
  const channels = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255);
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  const luminance = (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);

  return luminance > 0.179 ? 'text-slate-950' : 'text-white';
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
      <span className="max-w-[60%] truncate text-right font-normal text-[var(--app-text-primary)]">
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

function safeExternalUrl(value: unknown): string | null {
  const candidate = metaText(value);
  if (!candidate) return null;
  if (candidate.startsWith('/') && !candidate.startsWith('//')) return candidate;

  try {
    const url = new URL(candidate);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function formatDateSafely(
  value: string | Date,
  pattern: string,
  locale: Locale,
  fallback: string,
) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : format(date, pattern, { locale });
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
  const [open, setOpen] = useState(false);
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
    ['Capturado em', leadMeta?.created_at
      ? formatDateSafely(leadMeta.created_at, "dd/MM/yyyy 'às' HH:mm", ptBR, leadMeta.created_at)
      : null],
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
        <span className="break-words text-left font-normal text-[var(--app-text-primary)]">{text}</span>
      </div>
    );
  };

  const hasUtms = utmRows.some(([, value]) => Boolean(metaText(value)));
  const hasLinks = links.some(([, value]) => Boolean(metaText(value)));

  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={100} closeDelay={420}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          className="group inline-flex min-w-0 max-w-full items-center justify-end gap-1 text-right font-normal text-[var(--app-text-primary)] outline-none transition-colors hover:text-primary focus-visible:text-primary"
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
        collisionPadding={12}
        className="vimob-popover-content z-[100] w-[min(420px,calc(100vw-2rem))] rounded-[8px] border-0 p-0 text-left text-[var(--app-text-primary)] shadow-none"
      >
        <div className="border-b border-[var(--app-border)] px-3 py-2 text-left">
          <p className="text-[11px] font-normal text-primary">Rastreamento de campanha</p>
        </div>

        <div className="max-h-[420px] space-y-3 overflow-y-auto p-3 text-left">
          <div className="space-y-1.5">
            {mainRows.map(([label, value]) => (
              <DetailRow key={label} label={label} value={value} />
            ))}
          </div>

          {hasUtms && (
            <div className="space-y-1.5 border-t border-[var(--app-border)] pt-3 text-left">
              <p className="text-[11px] font-normal text-[var(--app-text-tertiary)]">UTMs</p>
              {utmRows.map(([label, value]) => (
                <DetailRow key={label} label={label} value={value} />
              ))}
            </div>
          )}

          {leadMeta?.contact_notes && (
            <div className="border-t border-[var(--app-border)] pt-3 text-left">
              <p className="text-[11px] font-normal text-[var(--app-text-tertiary)]">Observações</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-snug text-[var(--app-text-secondary)]">
                {leadMeta.contact_notes}
              </p>
            </div>
          )}

          {hasLinks && (
            <div className="flex flex-wrap gap-2 border-t border-[var(--app-border)] pt-3 text-left">
              {links.map(([label, value]) => {
                const href = safeExternalUrl(value);
                if (!href) return null;
                return (
                  <a
                    key={label}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-[6px] bg-[var(--app-surface-soft)] px-2 py-1 text-[11px] font-light text-[var(--app-text-secondary)] transition-colors hover:bg-[var(--app-surface-hover)] hover:text-primary"
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
    ? formatDateSafely(`${birthDate}T00:00:00`, 'dd/MM/yyyy', ptBR, birthDate)
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
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          className="group inline-flex min-w-0 max-w-full items-center justify-end gap-1 text-right font-normal text-[var(--app-text-primary)] outline-none transition-colors hover:text-primary focus-visible:text-primary"
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
        collisionPadding={12}
        className="vimob-popover-content z-[110] w-[min(420px,calc(100vw-2rem))] rounded-[8px] border-0 p-0 text-left text-[var(--app-text-primary)] shadow-none"
      >
        <div className="border-b border-[var(--app-border)] px-3 py-2">
          <p className="text-[11px] font-normal text-primary">Ficha do lead</p>
        </div>
        <div className="max-h-[430px] space-y-3 overflow-y-auto p-3">
          <div className="space-y-1.5">
            {rows.map(([label, value]) => (
              <div key={label} className="grid grid-cols-[118px_minmax(0,1fr)] gap-2 text-[11px] leading-snug">
                <span className="text-[var(--app-text-tertiary)]">{label}</span>
                <span className="break-words font-normal text-[var(--app-text-primary)]">{value}</span>
              </div>
            ))}
          </div>

          {(hasCPF || hasRG) && (
            <div className="space-y-1.5 border-t border-[var(--app-border)] pt-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-normal text-[var(--app-text-tertiary)]">Documentos protegidos</p>
                {canRevealSensitive && (
                  <button
                    type="button"
                    onClick={() => revealSensitive ? clearSensitiveData() : setRevealSensitive(true)}
                    className="inline-flex items-center gap-1 rounded-[5px] bg-[var(--app-surface-soft)] px-2 py-1 text-[10px] font-light text-primary transition-colors hover:bg-[var(--app-surface-hover)]"
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
  if (Number.isNaN(startDate.getTime())) return 'Data inválida';

  const dateLabel = formatDateSafely(startDate, 'dd/MM', locale, 'Data inválida');
  const startTime = formatDateSafely(startDate, 'HH:mm', locale, '--:--');
  const endTime = formatDateSafely(endDate, 'HH:mm', locale, startTime);

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
              <span className={cn('block truncate text-[11px] font-normal leading-tight', isCompleted && 'line-through')}>
                {event.title || scheduleEventTypeLabels[eventType]}
              </span>
              <span className="mt-px flex min-w-0 flex-wrap items-center gap-1 text-[10.5px] font-light leading-tight text-[var(--app-text-secondary)]">
                <span className="font-normal text-[var(--app-text-primary)]">{scheduleEventTypeLabels[eventType]}</span>
                <span>-</span>
                <span>{getScheduleDateLabel(event, locale)}</span>
                {!isCompleted && (
                  <span className={cn('rounded-[4px] px-1.5 py-0.5 font-light', getScheduleStatusClass(event.status, isLate))}>
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
  const [composerRequest, setComposerRequest] = useState<{ id: number; text?: string } | null>(null);
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
  const [reopenStatusConfirmation, setReopenStatusConfirmation] = useState<{
    leadId: string;
    leadName: string;
    fromStatus: 'won' | 'lost' | string;
  } | null>(null);
  const [assigneeScheduleConfirmation, setAssigneeScheduleConfirmation] = useState<{
    leadId: string;
    userId: string;
    userName: string;
    description: string;
  } | null>(null);
  const handleCloseLeadDetail = () => {
    setAssigneeScheduleConfirmation(null);
    onClose();
  };
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
    procura_financiamento: false
  });

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
  const { profile, organization } = useAuth();
  const cadenceOrganizationId =
    leadProp?.organization_id || profile?.organization_id || organization?.id || null;
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
  const canUseLeadWhatsApp =
    canOperateLead && hasModule('whatsapp') && hasPermission('whatsapp_operate');
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
  const { data: leadMeta } = useLeadMeta(leadId);
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
      refreshPipelineInBackground();
    } catch {
      setLocalLead(previousLead);
      setEditForm(previousEditForm);
      updatePipelineLeadCache(lead.id, previousLead);
      queryClient.setQueryData(historyQueryKey, previousHistory);
    }
  };

  // Quick action handlers for phone/email with outcome dialog
  const handleQuickPhone = () => {
    if (!canOperateLead || !lead.phone) return;
    const phoneHref = normalizePhoneToE164(lead.phone);
    if (!phoneHref) return;

    // 1. Log initiation immediately in history
    createActivityMutation.mutate({
      lead_id: lead.id,
      type: 'call_initiated',
      content: 'Ligação iniciada',
      metadata: { phone: lead.phone, channel: 'phone' },
    });

    window.open(`tel:${phoneHref}`, '_blank', 'noopener,noreferrer');
    setQuickActionOutcomeType('call');
    setQuickActionOutcomeOpen(true);
  };

  const handleQuickWhatsApp = () => {
    if (!canUseLeadWhatsApp) return;
    setActiveTab(isMobile ? 'history' : 'activities');
    setComposerRequest((current) => ({ id: (current?.id || 0) + 1 }));
  };

  const handleQuickEmail = () => {
    if (!canOperateLead || !lead.email) return;
    const gmailUrl = `https://mail.google.com/mail/view=cm&fs=1&tf=1&to=${encodeURIComponent(lead.email)}`;
    window.open(gmailUrl, '_blank', 'noopener,noreferrer');
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
      setActiveTab(isMobile ? 'history' : 'activities');
      setComposerRequest((current) => ({ id: (current?.id || 0) + 1, text: message }));
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
      setActiveTab(isMobile ? 'history' : 'activities');
      setComposerRequest((current) => ({ id: (current?.id || 0) + 1, text: message }));
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
      refetchStages();
      toast.success('Dados salvos com sucesso!');
    } catch (error) {
      console.error('Erro ao salvar dados do lead:', error);
    }
  };
  const handleMoveToStage = async (stageId: string) => {
    if (!canOperateLead || stageId === localLead.stage_id) return;

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
      void queryClient.invalidateQueries({ queryKey: ['lead-cadence-state'] });
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
    } catch (error: unknown) {
      setLocalLead(previousLead);
      toast.error(`Não foi possível mover o lead: ${getErrorMessage(error)}`);
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
      void queryClient.invalidateQueries({ queryKey: ['lead-cadence-state'] });
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
      void queryClient.invalidateQueries({ queryKey: ['lead-cadence-state'] });
    } catch {
      if (previousLead) setLocalLead(previousLead);
      else if (localLead) setLocalLead({ ...localLead, deal_status: previousStatus });
    }
  };

  const leadSource = localLead?.source ?? lead.source ?? 'outros';
  const leadName = localLead?.name || lead.name || 'Lead';
  const campaignTrackingDetails = buildCampaignTrackingDetails(leadMeta ?? null, localLead || lead);

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
              {lead.phone && (
                <div className="mt-1 flex min-w-0 items-center gap-1.5">
                  <p className="truncate text-xs text-[var(--app-text-tertiary)]">{formatPhoneForDisplay(lead.phone)}</p>
                  <CopyLeadPhoneButton phone={lead.phone} className="h-6 w-6 bg-transparent hover:bg-[var(--app-surface-soft)]" />
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
                        tagColor
                          ? getTagForegroundClass(tagColor)
                          : 'bg-[var(--app-surface-hover)] text-[var(--app-text-primary)]',
                      )}
                      style={tagColor ? { backgroundColor: tagColor } : undefined}
                    >
                      <span className="max-w-[82px] truncate">{tag.name || 'Tag'}</span>
                      <button disabled={!canOperateLead} type="button" aria-label={`Remover tag ${tag.name || 'Tag'}`} title="Remover tag" className="rounded-[3px] p-0.5 hover:bg-primary-foreground/15 disabled:hidden" onClick={() => handleRemoveTag(tag.id)}>
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
            {lead.phone && (
              <Button disabled={!canOperateLead} variant="outline" size="sm" aria-label={`Ligar para ${leadName}`} title="Ligar" onClick={handleQuickPhone} className="h-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)]">
                <Phone className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button disabled={!canUseLeadWhatsApp} size="sm" onClick={handleQuickWhatsApp} className="h-8 rounded-[6px] px-2 text-xs">
              <MessageCircle className="mr-1 h-3.5 w-3.5" />
              Chat
            </Button>
            {lead.email && (
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


                {hasAgendaModule && <section className="lead-agenda-card rounded-[8px] bg-[var(--app-surface-soft)] p-3">
                  <div className="flex items-center justify-between">
                    <div className="lead-agenda-summary min-w-0">
                      <h3 className="text-[12px] font-normal">Agenda</h3>
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
                              tagColor
                                ? getTagForegroundClass(tagColor)
                                : 'bg-[var(--app-surface-hover)] text-[var(--app-text-primary)]',
                            )}
                            style={tagColor ? { backgroundColor: tagColor } : undefined}
                          >
                            {tag.name || 'Tag'}
                            <button disabled={!canOperateLead} type="button" aria-label={`Remover tag ${tag.name || 'Tag'}`} title="Remover tag" className="rounded-[3px] p-0.5 hover:bg-primary-foreground/15 disabled:hidden" onClick={() => handleRemoveTag(tag.id)}>
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
                  {lead.phone && (
                    <Button disabled={!canOperateLead} variant="outline" size="sm" aria-label={`Ligar para ${leadName}`} title="Ligar" onClick={handleQuickPhone} className="h-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)]">
                      <Phone className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button disabled={!canUseLeadWhatsApp} size="sm" onClick={handleQuickWhatsApp} className="h-8 rounded-[6px] px-2 text-xs">
                    <MessageCircle className="mr-1 h-3.5 w-3.5" />
                    Chat
                  </Button>
                  {lead.email && (
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


                {hasAgendaModule && <section data-tour="lead-detail-agenda" className="lead-agenda-card rounded-[8px] bg-[var(--app-surface-soft)] p-3">
                  <div className="flex items-center justify-between">
                    <div className="lead-agenda-summary min-w-0">
                      <h3 className="text-[12px] font-normal">Agenda</h3>
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

  // Roteiro Dialog
  const RoteiroDialog = () => {
    if (!selectedTask) return null;

    return <Dialog open={roteiroDialogOpen} onOpenChange={setRoteiroDialogOpen}>
      <DialogContent className="w-[calc(100vw-2rem)] rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-4 text-[var(--app-text-primary)] shadow-none sm:w-full sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-normal">
            <div className="flex h-8 w-8 items-center justify-center rounded-[6px] bg-amber-500/12">
              <Lightbulb className="h-4 w-4 text-amber-600" />
            </div>
            {selectedTask.title || 'Roteiro'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-[8px] border-0 bg-amber-500/10 p-3">
            <div className="flex items-start gap-3">
              <Lightbulb className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <p className="text-sm text-amber-800 dark:text-amber-200 whitespace-pre-wrap leading-relaxed">
                {selectedTask.observation}
              </p>
            </div>
          </div>

          {selectedTask.recommended_message && <div className="rounded-[8px] border-0 bg-primary/5 p-3">
              <div className="flex items-start gap-3">
                <MessageCircle className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="mb-1 text-xs font-normal text-primary">Mensagem sugerida:</p>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {selectedTask.recommended_message.replace(/{nome}/gi, lead.name || '').replace(/{empresa}/gi, lead.empresa || '').replace(/{email}/gi, lead.email || '')}
                  </p>
                </div>
              </div>
            </div>}

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button className="h-8 flex-1 rounded-[6px] text-[11px] font-light" disabled={completeCadenceTask.isPending} onClick={() => void handleRoteiroAction('complete')}>
              <Check className="h-4 w-4 mr-2" />
              Marcar como feito
            </Button>
            {selectedTask.recommended_message && lead.phone && <Button variant="outline" className="h-8 flex-1 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[11px] font-light shadow-none" disabled={completeCadenceTask.isPending} onClick={() => void handleRoteiroAction('message')}>
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
            <AlertDialogTitle className="font-normal">Confirmar reabertura do lead?</AlertDialogTitle>
            <AlertDialogDescription>
              {reopenStatusConfirmation?.leadName || 'Este lead'} está marcado como {fromStatusLabel}. Ao confirmar, ele volta para Aberto e pode entrar novamente no fluxo comercial.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="rounded-[6px] border-0 bg-[var(--app-surface-soft)] font-light text-[var(--app-text-secondary)] shadow-none hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]"
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

  const AssigneeScheduleDialog = () => {
    const confirmation = assigneeScheduleConfirmation?.leadId === lead.id
      ? assigneeScheduleConfirmation
      : null;

    return (
      <AlertDialog
        open={Boolean(confirmation)}
        onOpenChange={(open) => {
          if (!open) setAssigneeScheduleConfirmation(null);
        }}
      >
        <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-md rounded-[8px] border-0 bg-[var(--app-surface-solid)] text-[var(--app-text-primary)] shadow-none">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-normal">Responsável fora da escala</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmation?.userName || 'Este usuário'} está fora da disponibilidade configurada.{' '}
              {confirmation?.description} Deseja atribuir o lead mesmo assim?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-[6px] border-0 bg-[var(--app-surface-soft)] font-light text-[var(--app-text-secondary)] shadow-none hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              className="rounded-[6px] bg-primary font-normal tracking-normal text-primary-foreground antialiased hover:bg-primary/90"
              disabled={!confirmation}
              onClick={() => {
                if (!confirmation) return;
                setAssigneeScheduleConfirmation(null);
                void handleAssignUser(confirmation.userId, { skipScheduleConfirmation: true });
              }}
            >
              Atribuir mesmo assim
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
        {RoteiroDialog()}
        {OutcomeDialogComponent()}
        {ReopenLeadDialog()}
        {AssigneeScheduleDialog()}
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
        {hasAgendaModule && <EventSheet
          open={scheduleFormOpen}
          onOpenChange={(open) => !open && handleCloseScheduleForm()}
          leadId={lead.id}
          leadName={leadName}
          event={editingScheduleEvent}
          defaultUserId={lead.assigned_user_id ?? undefined}
          defaultType={scheduleDefaultType}
        />}
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
      {RoteiroDialog()}
      {OutcomeDialogComponent()}
      {ReopenLeadDialog()}
      {AssigneeScheduleDialog()}
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
      {/* Formulário de agendamento (global para o card) */}
      {hasAgendaModule && <EventSheet
        open={scheduleFormOpen}
        onOpenChange={open => !open && handleCloseScheduleForm()}
        leadId={lead.id}
        leadName={leadName}
        event={editingScheduleEvent}
        defaultUserId={lead.assigned_user_id ?? undefined}
        defaultType={scheduleDefaultType}
      />}
    </>
  );
}
