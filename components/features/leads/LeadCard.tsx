import { useState, memo, type CSSProperties } from 'react';
import { useTheme } from 'next-themes';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Phone, Mail, MessageCircle, Clock, User, Zap, Trophy, XCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Draggable } from '@hello-pangea/dnd';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useFloatingChat } from '@/contexts/FloatingChatContext';
import { formatPhoneForDisplay } from '@/lib/phone-utils';
import { SlaBadge } from './SlaBadge';
import { useRecordFirstResponseOnAction } from '@/hooks/use-first-response';
import { useCreateActivity } from '@/hooks/use-activities';
import { TaskOutcomeDialog, TaskOutcome } from '@/components/features/leads/TaskOutcomeDialog';
import { useAuth } from '@/contexts/AuthContext';
import { ReentryBadge } from '@/components/features/leads/ReentryBadge';

// Deal status labels and colors
const dealStatusConfig = {
  open: {
    label: 'Aberto',
    color: 'bg-muted text-muted-foreground',
    icon: null
  },
  won: {
    label: 'Ganho',
    color: 'bg-[var(--lead-status-won-bg)] text-[var(--lead-status-won-fg)]',
    icon: Trophy
  },
  lost: {
    label: 'Perdido',
    color: 'bg-[var(--lead-status-lost-bg)] text-[var(--lead-status-lost-fg)]',
    icon: XCircle
  }
};

type LeadTag = {
  name?: string | null;
  color?: string | null;
};

type LeadInterest = {
  code?: string | null;
  title?: string | null;
  name?: string | null;
  preco?: number | null;
  price?: number | null;
};

type LeadCardLead = {
  id: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  organization_id?: string | null;
  assigned_user_id?: string | null;
  created_at?: string | null;
  stage_entered_at?: string | null;
  first_response_at?: string | null;
  first_response_seconds?: number | null;
  sla_status?: string | null;
  sla_seconds_elapsed?: number | null;
  whatsapp_avatar_url?: string | null;
  whatsapp_picture?: string | null;
  contact_picture?: string | null;
  interest_property?: LeadInterest | null;
  property?: LeadInterest | null;
  valor_interesse?: number | null;
  source?: string | null;
  lead_meta?: Array<{
    platform?: string | null;
    campaign_name?: string | null;
  }> | null;
  tags?: LeadTag[] | null;
  unread_count?: number | null;
  has_whatsapp_messages?: boolean | null;
  reentry_count?: number | null;
  last_entry_at?: string | null;
  deal_status?: string | null;
  assignee?: {
    avatar_url?: string | null;
    name?: string | null;
  } | null;
};

interface LeadCardProps {
  lead: LeadCardLead;
  onClick: () => void;
  index: number;
  onAssignNow: (leadId: string) => void;
  isDragDisabled: boolean;
  tourTarget?: string;
}

// Formata tempo sempre em horas (ex: "30min", "2h", "72h")
const formatShortTime = (date: Date): string => {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHrs = Math.floor(diffMs / 3600000);
  if (diffHrs === 0) {
    const diffMins = Math.floor(diffMs / 60000);
    return `${diffMins}min`;
  }
  return `${diffHrs}h`;
};
export const LeadCard = memo(function LeadCard({
  lead,
  onClick,
  index,
  onAssignNow,
  isDragDisabled = false,
  tourTarget,
}: LeadCardProps) {
  const { openNewChat } = useFloatingChat();
  const { resolvedTheme } = useTheme();
  const { profile } = useAuth();
  const { recordFirstResponse } = useRecordFirstResponseOnAction();
  const createActivity = useCreateActivity();
  const [outcomeDialogOpen, setOutcomeDialogOpen] = useState(false);
  const [outcomeType, setOutcomeType] = useState<'call' | 'email'>('call');
  const leadName = lead.name || 'Lead';
  const unreadCount = lead.unread_count ?? 0;
  const stageTime = lead.stage_entered_at ? formatShortTime(new Date(lead.stage_entered_at)) : '-';
  const hasPhone = !!lead.phone;
  const hasEmail = !!lead.email;
  const leadAvatarUrl = lead.whatsapp_avatar_url || lead.whatsapp_picture || lead.contact_picture || null;

  // Get interest value from: interest property, legacy valor_interesse, or property
  const interestPropertyPrice = lead.interest_property?.preco;
  const valorInteresse = interestPropertyPrice || lead.valor_interesse || lead.property?.preco || 0;
  const interestLabel = lead.interest_property?.code || lead.interest_property?.title ||
                        lead.property?.code || lead.property?.title || null;

  // Verifica se o lead tem tags de prioridade alta
  const hasHighPriority = lead.tags?.some((tag) => {
    const tagName = tag.name?.toLowerCase() || '';
    return tagName.includes('urgente') || tagName.includes('vip') || tagName.includes('prioridade') || tagName.includes('hot');
  });

  // Esquema de cores dinâmico baseado na prioridade
  const iconColors = hasHighPriority ? {
    phone: "bg-[var(--lead-action-phone-priority-bg)] text-[var(--lead-action-phone-priority-fg)] hover:bg-[var(--lead-action-phone-priority-hover)]",
    whatsapp: "bg-[var(--lead-action-whatsapp-priority-bg)] text-[var(--lead-action-whatsapp-priority-fg)] hover:bg-[var(--lead-action-whatsapp-priority-hover)]",
    email: "bg-[var(--lead-action-email-priority-bg)] text-[var(--lead-action-email-priority-fg)] hover:bg-[var(--lead-action-email-priority-hover)]"
  } : {
    phone: "bg-[var(--lead-action-phone-bg)] text-[var(--lead-action-phone-fg)] hover:bg-[var(--lead-action-phone-hover)]",
    whatsapp: "bg-[var(--lead-action-whatsapp-bg)] text-[var(--lead-action-whatsapp-fg)] hover:bg-[var(--lead-action-whatsapp-hover)]",
    email: "bg-[var(--lead-action-email-bg)] text-[var(--lead-action-email-fg)] hover:bg-[var(--lead-action-email-hover)]"
  };
  const formatCurrency = (value: number) => {
    if (value >= 1_000_000) {
      const v = value / 1_000_000;
      const formatted = v.toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: v % 1 === 0 ? 0 : 1 });
      return `R$${formatted}M`;
    } else if (value >= 1_000) {
      const v = value / 1_000;
      const formatted = v.toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 0 });
      return `R$${formatted}K`;
    }
    return `R$${value.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
  };
  const handlePhoneClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (lead.phone) {
      recordFirstResponse({
        leadId: lead.id,
        organizationId: lead.organization_id || profile?.organization_id || '',
        channel: 'phone',
        actorUserId: profile?.id || null,
        firstResponseAt: lead.first_response_at,
      });
      window.open(`tel:${lead.phone.replace(/\D/g, '')}`, '_blank');
      setOutcomeType('call');
      setOutcomeDialogOpen(true);
    }
  };
  const handleWhatsAppClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (lead.phone) {
      openNewChat(lead.phone, leadName, lead.id);
    }
  };
  const handleEmailClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (lead.email) {
      const gmailUrl = `https://mail.google.com/mail/view=cm&fs=1&tf=1&to=${encodeURIComponent(lead.email)}`;
      window.open(gmailUrl, '_blank');
      setOutcomeType('email');
      setOutcomeDialogOpen(true);
    }
  };

  const handleOutcomeConfirm = (outcome: TaskOutcome, notes: string) => {
    createActivity.mutate({
      lead_id: lead.id,
      type: outcomeType === 'call' ? 'call' : 'email',
      content: outcomeType === 'call' ? 'Tentativa de ligação' : 'Email enviado',
      metadata: { outcome, notes, channel: outcomeType },
    });
    setOutcomeDialogOpen(false);
  };
  const isLost = lead.deal_status === 'lost';
  const isWon = lead.deal_status === 'won';
  const leadToneVars = (
    resolvedTheme === 'light'
      ? {
          '--lead-value-bg': '#bbf7d0',
          '--lead-value-fg': '#047857',
          '--lead-status-won-bg': '#bbf7d0',
          '--lead-status-won-fg': '#047857',
          '--lead-status-lost-bg': '#fee2e2',
          '--lead-status-lost-fg': '#b91c1c',
        }
      : {
          '--lead-value-bg': '#063f2b',
          '--lead-value-fg': '#34d399',
          '--lead-status-won-bg': '#063f2b',
          '--lead-status-won-fg': '#34d399',
          '--lead-status-lost-bg': '#4a1111',
          '--lead-status-lost-fg': '#f87171',
        }
  ) as CSSProperties;
  const hasLeadLabels = Boolean(
    (lead.deal_status && lead.deal_status !== 'open')
    || (lead.tags && lead.tags.length > 0)
  );

  // Verificar se o lead foi criado há menos de 10 segundos (aguardando atribuição via round-robin)
  const isRecentlyCreated = lead.created_at &&
    !lead.assigned_user_id &&
    (Date.now() - new Date(lead.created_at).getTime()) < 10000;

  return <>
    <Draggable draggableId={lead.id} index={index} isDragDisabled={isDragDisabled}>
      {(provided, snapshot) => {
        const { style, ...draggableProps } = provided.draggableProps;
        const cardStyle = { ...(style as CSSProperties), ...leadToneVars };

        return (
        <div data-tour={tourTarget} ref={provided.innerRef} {...draggableProps} {...provided.dragHandleProps} style={cardStyle} className={cn("bg-[var(--app-lead-card)] rounded-lg p-3 transition-all duration-200 group hover:bg-[var(--app-lead-card-hover)] hover:-translate-y-0.5 relative", isDragDisabled ? "cursor-default" : "cursor-pointer", snapshot.isDragging && "rotate-1 scale-[1.02] ring-1 ring-primary/45", isLost && "bg-destructive/5 hover:bg-destructive/10", isWon && "bg-emerald-500/5")} onClick={onClick}>
          {/* Deal Status Badge + Tags */}
          {hasLeadLabels && (
            <div className="mb-2 flex flex-wrap items-center gap-1">
              {/* Deal Status Badge */}
              {lead.deal_status && lead.deal_status !== 'open' && <span className={cn("text-[9px] px-1.5 py-0.5 font-medium flex items-center gap-0.5 rounded", dealStatusConfig[lead.deal_status as keyof typeof dealStatusConfig].color)}>
                  {dealStatusConfig[lead.deal_status as keyof typeof dealStatusConfig].icon && (() => {
              const Icon = dealStatusConfig[lead.deal_status as keyof typeof dealStatusConfig].icon;
              return Icon ? <Icon className="h-2.5 w-2.5" /> : null;
            })()}
                  {dealStatusConfig[lead.deal_status as keyof typeof dealStatusConfig].label}
                </span>}

              {/* Tags - primeira tag em destaque */}
              {lead.tags && lead.tags.length > 0 ? (
                  <>
                    <span className="text-[9px] px-1.5 py-0.5 font-medium rounded-full border" style={{
                      backgroundColor: lead.tags[0].color || '#6b7280',
                      color: '#FFFFFF',
                      borderColor: lead.tags[0].color || '#6b7280'
                    }}>
                      {lead.tags[0].name}
                    </span>
                    {lead.tags.length > 1 && <span className="text-[10px] text-muted-foreground">+{lead.tags.length - 1}</span>}
                  </>
                ) : null}
            </div>
          )}



          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className="relative shrink-0">
                <Avatar className="h-8 w-8">
                  <AvatarImage src={leadAvatarUrl || undefined} alt={leadName} />
                  <AvatarFallback className="bg-muted text-muted-foreground text-xs font-medium">
                    {leadName[0]?.toUpperCase() || <User className="h-4 w-4" />}
                  </AvatarFallback>
                </Avatar>
                {/* Indicador de mensagens não lidas */}
                {unreadCount > 0 && <span className="absolute -top-1 -right-1 h-4 min-w-4 flex items-center justify-center px-1 text-[9px] font-bold bg-primary text-primary-foreground rounded-full">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <h4 className="font-semibold text-sm truncate text-foreground">{leadName}</h4>
                  <ReentryBadge count={lead.reentry_count} lastEntryAt={lead.last_entry_at} />
                </div>
                {lead.phone && <p className="text-[11px] text-muted-foreground truncate">{formatPhoneForDisplay(lead.phone)}</p>}
              </div>
            </div>

            {/* Arraste agora habilitado no card inteiro via dragHandleProps acima */}
          </div>

          {/* Source indicator: Meta campaign, Google campaign, or Website property */}
          {(() => {
            const meta = lead.lead_meta?.[0];
            const platform = meta?.platform?.toLowerCase();
            const source = lead.source?.toLowerCase();
            const campaignName = meta?.campaign_name;
            const interestProp = lead.interest_property;

            // Meta campaign
            if (platform === 'meta' || platform === 'facebook' || source === 'meta' || source === 'facebook') {
              if (!campaignName) return null;
              return (
                <div className="flex items-center gap-1.5 -mt-1 mb-1 min-w-0">
                  <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="#1877F2">
                    <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.018 1.793-4.684 4.533-4.684 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.93-1.956 1.886v2.273h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/>
                  </svg>
                  <span className="text-[10px] text-muted-foreground/80 truncate leading-none">{campaignName}</span>
                </div>
              );
            }

            // Google campaign
            if (platform === 'google' || source === 'google') {
              if (!campaignName) return null;
              return (
                <div className="flex items-center gap-1.5 -mt-1 mb-1 min-w-0">
                  <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 001 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  <span className="text-[10px] text-muted-foreground/80 truncate leading-none">{campaignName}</span>
                </div>
              );
            }

            // Website / property interest
            if ((source === 'site' || source === 'website') && interestProp) {
              const label = interestProp.code
                ?
                 `${interestProp.code} · ${(interestProp.title || '').substring(0, 20)}${(interestProp.title || '').length > 20 ? '…' : ''}`
                : (interestProp.title || '').substring(0, 30);
              return (
                <div className="flex items-center gap-1.5 -mt-1 mb-1 min-w-0">
                  <svg className="h-3 w-3 shrink-0 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                  </svg>
                  <span className="text-[10px] text-muted-foreground/80 truncate leading-none">{label}</span>
                </div>
              );
            }

            // Generic source
            if (lead.source) {
              return (
                <div className="flex items-center gap-1.5 -mt-1 mb-1 min-w-0">
                  <div className="h-3 w-3 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                    <Zap className="h-2 w-2 text-primary" />
                  </div>
                  <span className="text-[10px] text-muted-foreground/80 truncate leading-none capitalize">{lead.source}</span>
                </div>
              );
            }

            return null;
          })()}

          {/* Separador */}
          <div className="my-2 -mx-3 border-t border-[var(--app-lead-card-divider)]" />

          {/* Linha de ações rápidas e infos */}
          <TooltipProvider delayDuration={100}>
            <div className="flex items-center gap-1.5 flex-wrap">
              {/* Avatar do responsável ou badge "Sem responsável" / "Atribuindo..." */}
              {lead.assignee ? <Tooltip>
                  <TooltipTrigger asChild>
                    <Avatar className="h-6 w-6 shrink-0">
                      <AvatarImage src={lead.assignee.avatar_url || undefined} />
                      <AvatarFallback className="text-[10px] bg-primary text-primary-foreground">
                        {lead.assignee.name?.[0] || ''}
                      </AvatarFallback>
                    </Avatar>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    {lead.assignee.name}
                  </TooltipContent>
                </Tooltip> : isRecentlyCreated ? (
                  <Badge variant="secondary" className="text-[9px] px-1.5 py-0.5 animate-pulse">
                    <Loader2 className="h-2 w-2 mr-1 animate-spin" />
                    Atribuindo...
                  </Badge>
                ) : <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="destructive" className="text-[9px] px-1.5 py-0.5 cursor-pointer hover:bg-destructive/90 transition-colors" onClick={e => {
                e.stopPropagation();
                onAssignNow?.(lead.id);
              }}>
                      Sem responsável
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    Clique para atribuir via round-robin
                  </TooltipContent>
                </Tooltip>}

              {/* Ícones de ação */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button onMouseDown={e => e.stopPropagation()} onClick={handlePhoneClick} disabled={!hasPhone} className={cn("h-6 w-6 rounded-full flex items-center justify-center transition-colors", hasPhone ? iconColors.phone : "bg-[var(--app-surface-soft)] text-[var(--app-text-tertiary)] opacity-60 cursor-not-allowed")}>
                    <Phone className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {hasPhone ? `Ligar: ${formatPhoneForDisplay(lead.phone || '')}` : 'Sem telefone'}
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button onMouseDown={e => e.stopPropagation()} onClick={handleWhatsAppClick} disabled={!hasPhone} className={cn("h-6 w-6 rounded-full flex items-center justify-center transition-colors", hasPhone ? iconColors.whatsapp : "bg-[var(--app-surface-soft)] text-[var(--app-text-tertiary)] opacity-60 cursor-not-allowed")}>
                    <MessageCircle className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {hasPhone ? (lead.has_whatsapp_messages ? 'Ver Mensagens' : 'Enviar WhatsApp') : 'Sem telefone'}
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button onMouseDown={e => e.stopPropagation()} onClick={handleEmailClick} disabled={!hasEmail} className={cn("h-6 w-6 rounded-full flex items-center justify-center transition-colors", hasEmail ? iconColors.email : "bg-[var(--app-surface-soft)] text-[var(--app-text-tertiary)] opacity-60 cursor-not-allowed")}>
                    <Mail className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {hasEmail ? `Email: ${lead.email}` : 'Sem email'}
                </TooltipContent>
              </Tooltip>

              {/* Valor do imóvel/interesse */}
              {valorInteresse > 0 && <Tooltip>
                  <TooltipTrigger asChild>
                    <div className={cn(
                      "text-[10px] font-semibold px-1.5 py-0.5 rounded",
                      "bg-[var(--lead-value-bg)] text-[var(--lead-value-fg)]"
                    )}>
                      {formatCurrency(valorInteresse)}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    {interestLabel ? (
                      <div className="space-y-0.5">
                        <div className="font-medium">{interestLabel}</div>
                        <div>R${valorInteresse.toLocaleString('pt-BR')}</div>
                      </div>
                    ) : (
                      <>Valor: R${valorInteresse.toLocaleString('pt-BR')}</>
                    )}
                  </TooltipContent>
                </Tooltip>}

              {/* SLA Badge - shows warning/overdue status */}
              {lead.assigned_user_id && !lead.first_response_seconds && (
                <SlaBadge slaStatus={lead.sla_status ?? null} slaSecondsElapsed={lead.sla_seconds_elapsed ?? null} firstResponseAt={lead.first_response_at ?? null} />
              )}


              {/* Tempo no estágio */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground ml-auto">
                    <Clock className="h-3 w-3" />
                    {stageTime}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  Tempo neste estágio
                </TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>
        </div>
        );
      }}
    </Draggable>

    {/* Outcome Dialog for Phone/Email */}
    <TaskOutcomeDialog
      open={outcomeDialogOpen}
      onOpenChange={setOutcomeDialogOpen}
      taskType={outcomeType}
      taskTitle={outcomeType === 'call' ? 'Tentativa de ligação' : 'Email enviado'}
      onConfirm={handleOutcomeConfirm}
      isLoading={createActivity.isPending}
    />
  </>;
});
