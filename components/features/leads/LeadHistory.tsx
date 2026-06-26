import React from 'react';
import { useLeadHistory, UnifiedHistoryEvent } from '@/hooks/use-lead-history';
import { DateSeparator, shouldShowDateSeparator } from '@/components/features/whatsapp/DateSeparator';
import { formatResponseTime } from '@/hooks/use-lead-timeline';
import { formatDistanceToNow, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  Loader2,
  ArrowRight,
  UserCircle,
  MessageSquare,
  Phone,
  Mail,
  CheckCircle,
  UserPlus,
  UserCheck,
  Zap,
  Tag,
  FileText,
  Bot,
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Globe,
  Webhook,
  Target,
  Smartphone,
  PenLine,
  Eye,
  DollarSign,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

interface LeadHistoryProps {
  leadId: string;
  onEventClick?: (event: UnifiedHistoryEvent) => void;
}


// ─── Channel labels ───────────────────────────────────────────────────────────
const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  phone: 'Telefone',
  email: 'E-mail',
  stage_move: 'Movimentação',
};

// ─── Outcome config ───────────────────────────────────────────────────────────
const OUTCOME_CONFIG: Record<string, { label: string; variant: 'success' | 'warning' | 'error' | 'default'; Icon: React.ComponentType<{ className?: string }> }> = {
  contacted:       { label: 'Contatado',        variant: 'success', Icon: CheckCircle2 },
  interested:      { label: 'Interessado',       variant: 'success', Icon: CheckCircle2 },
  scheduled:       { label: 'Agendado',          variant: 'success', Icon: CheckCircle2 },
  proposal_sent:   { label: 'Proposta enviada',  variant: 'success', Icon: CheckCircle2 },
  not_interested:  { label: 'Sem interesse',     variant: 'error',   Icon: XCircle },
  no_answer:       { label: 'Sem resposta',      variant: 'warning', Icon: AlertCircle },
  busy:            { label: 'Ocupado',           variant: 'warning', Icon: AlertCircle },
  voicemail:       { label: 'Caixa postal',      variant: 'warning', Icon: AlertCircle },
  wrong_number:    { label: 'Número errado',     variant: 'error',   Icon: XCircle },
  bounced:         { label: 'Email inválido',    variant: 'error',   Icon: XCircle },
  rescheduled:     { label: 'Reagendado',        variant: 'warning', Icon: AlertCircle },
  callback:        { label: 'Ligar depois',      variant: 'warning', Icon: Clock },
};

const outcomeVariantClasses: Record<string, string> = {
  success: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  warning: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  error:   'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  default: 'bg-muted text-muted-foreground',
};

// ─── Icon registry ────────────────────────────────────────────────────────────
function getEventIcon(event: UnifiedHistoryEvent): React.ComponentType<{ className?: string }> {
  const meta = event.metadata || {};

  if (event.type === 'lead_created') {
    const src = meta.source || meta.source_label || '';
    if (src === 'meta_ads' || src === 'Meta Ads') return Target;
    if (src === 'whatsapp' || src === 'WhatsApp') return Smartphone;
    if (src === 'website' || src === 'Site') return Globe;
    if (src === 'webhook' || src === 'Webhook') return Webhook;
    if (src === 'manual') return PenLine;
    return UserPlus;
  }

  const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
    lead_assigned:           UserCheck,
    first_response:          Zap,
    whatsapp_message_sent:   MessageSquare,
    whatsapp_message_received: MessageSquare,
    call_initiated:          Phone,
    stage_changed:           ArrowRight,
    stage_change:            ArrowRight,
    note_created:            FileText,
    note:                    FileText,
    tag_added:               Tag,
    tag_removed:             Tag,
    sla_warning:             AlertTriangle,
    sla_overdue:             AlertTriangle,
    call:                    Phone,
    email:                   Mail,
    message:                 MessageSquare,
    automation_message:      Bot,
    task_completed:          CheckCircle,
    contact_updated:         UserCircle,
    commission_created:      DollarSign,
    commission_updated:      DollarSign,
    assignee_changed:        UserCheck,
    status_change:           ArrowRight,
    whatsapp:                MessageSquare,
    assignment:              UserCheck,
    lead_reentry:            UserPlus,
    automation_stage_move:   Bot,
    automation_tag_added:    Bot,
  };

  return iconMap[event.type] || Clock;
}

// ─── Color registry ───────────────────────────────────────────────────────────
function getEventColors(event: UnifiedHistoryEvent): { text: string; bg: string } {
  const meta = event.metadata || {};

  if (event.type === 'lead_created') {
    const src = meta.source || meta.source_label || '';
    if (src === 'meta_ads' || src === 'Meta Ads') return { text: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-500/15' };
    if (src === 'whatsapp' || src === 'WhatsApp') return { text: 'text-green-600 dark:text-green-400', bg: 'bg-green-500/15' };
    if (src === 'website' || src === 'Site') return { text: 'text-indigo-600 dark:text-indigo-400', bg: 'bg-indigo-500/15' };
    if (src === 'webhook' || src === 'Webhook') return { text: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-500/15' };
    return { text: 'text-green-600 dark:text-green-400', bg: 'bg-green-500/15' };
  }

  const colorMap: Record<string, { text: string; bg: string }> = {
    lead_assigned:             { text: 'text-blue-600 dark:text-blue-400',   bg: 'bg-blue-500/15' },
    assignee_changed:          { text: 'text-blue-600 dark:text-blue-400',   bg: 'bg-blue-500/15' },
    first_response:            { text: 'text-yellow-600 dark:text-yellow-400', bg: 'bg-yellow-500/15' },
    whatsapp_message_sent:     { text: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-500/15' },
    whatsapp_message_received: { text: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-500/15' },
    call_initiated:            { text: 'text-teal-600 dark:text-teal-400',   bg: 'bg-teal-500/15' },
    stage_changed:             { text: 'text-muted-foreground',              bg: 'bg-muted' },
    stage_change:              { text: 'text-muted-foreground',              bg: 'bg-muted' },
    note_created:              { text: 'text-indigo-600 dark:text-indigo-400', bg: 'bg-indigo-500/15' },
    note:                      { text: 'text-indigo-600 dark:text-indigo-400', bg: 'bg-indigo-500/15' },
    tag_added:                 { text: 'text-pink-600 dark:text-pink-400',   bg: 'bg-pink-500/15' },
    tag_removed:               { text: 'text-muted-foreground',              bg: 'bg-muted' },
    sla_warning:               { text: 'text-yellow-600 dark:text-yellow-400', bg: 'bg-yellow-500/15' },
    sla_overdue:               { text: 'text-red-600 dark:text-red-400',     bg: 'bg-red-500/15' },
    call:                      { text: 'text-teal-600 dark:text-teal-400',   bg: 'bg-teal-500/15' },
    email:                     { text: 'text-blue-600 dark:text-blue-400',   bg: 'bg-blue-500/15' },
    message:                   { text: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-500/15' },
    automation_message:        { text: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-500/15' },
    automation_stage_move:     { text: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-500/15' },
    automation_tag_added:      { text: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-500/15' },
    task_completed:            { text: 'text-green-600 dark:text-green-400', bg: 'bg-green-500/15' },
    contact_updated:           { text: 'text-blue-600 dark:text-blue-400',   bg: 'bg-blue-500/15' },
    commission_created:        { text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/15' },
    commission_updated:        { text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/15' },
    status_change:             { text: 'text-muted-foreground',              bg: 'bg-muted' },
    whatsapp:                  { text: 'text-green-600 dark:text-green-400', bg: 'bg-green-500/15' },
    assignment:                { text: 'text-blue-600 dark:text-blue-400',   bg: 'bg-blue-500/15' },
    lead_reentry:              { text: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/15' },
  };

  return colorMap[event.type] || { text: 'text-muted-foreground', bg: 'bg-muted' };
}

export function LeadHistory({ leadId, onEventClick }: LeadHistoryProps) {
  const { data: events = [], isLoading } = useLeadHistory(leadId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        Nenhum histórico disponível
      </div>
    );
  }

  // Find first_response event
  const firstResponseEvent = events.find(e => e.type === 'first_response');

  return (
    <div>
      {/* First Response Banner */}
      {firstResponseEvent && (
        <div className="mb-4 p-3 rounded-lg border border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20 flex items-center gap-2 flex-wrap">
          <Zap className="h-4 w-4 text-yellow-600 dark:text-yellow-400 shrink-0" />
          <span className="text-sm font-medium text-yellow-700 dark:text-yellow-300">
            Primeiro contato:{' '}
            {firstResponseEvent.firstResponseSeconds != null
              ? formatResponseTime(firstResponseEvent.firstResponseSeconds)
              : firstResponseEvent.content || '—'}
          </span>
          {firstResponseEvent.isAutomation && (
            <Badge variant="outline" className="text-xs gap-1">
              <Bot className="h-3 w-3" />
              Automação
            </Badge>
          )}
          {firstResponseEvent.channel && (
            <Badge variant="secondary" className="text-xs">
              {CHANNEL_LABELS[firstResponseEvent.channel] || firstResponseEvent.channel}
            </Badge>
          )}
        </div>
      )}

      {/* Timeline */}
      <div className="space-y-0">
        {(() => {
          const filteredEvents = events.filter(e => e.type !== 'first_response');
          return filteredEvents.map((event, index) => {
          const prevEvent = index > 0 ? filteredEvents[index - 1] : null;
          const showSeparator = shouldShowDateSeparator(event.timestamp, prevEvent?.timestamp ?? null);
          const Icon = getEventIcon(event);
          const colors = getEventColors(event);
          const isLastEvent = index === filteredEvents.length - 1;
          const isFirst = index === 0;
          const isFirstResponse = event.type === 'first_response';
          const metadata = event.metadata || {};
          const outcome = metadata?.outcome as string | undefined;
          const outcomeNotes = metadata?.outcome_notes as string | undefined;
          const outcomeConfig = outcome ? OUTCOME_CONFIG[outcome] : null;

          return (
            <React.Fragment key={event.id}>
              {showSeparator && (
                <DateSeparator date={new Date(event.timestamp)} className="py-2" />
              )}
            <div className="relative flex gap-3 pl-9">
              {/* Connector line (not on last event) */}
              {!isLastEvent && (
                <div className="absolute left-3.5 top-7 bottom-0 w-px bg-border" />
              )}

              {/* Icon bubble */}
              <div
                className={cn(
                  'absolute left-0 w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5',
                  colors.bg,
                  isFirst && 'ring-2 ring-primary/30',
                  isFirstResponse && 'ring-2 ring-yellow-400 dark:ring-yellow-600'
                )}
              >
                <Icon className={cn('h-3.5 w-3.5', colors.text)} />
              </div>

              {/* Content */}
              <div
                className={cn(
                  'flex-1 pb-4 min-w-0',
                  isFirstResponse && 'bg-yellow-50/50 dark:bg-yellow-900/10 -mx-2 px-2 py-1 rounded-lg mb-1'
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    {/* Label row */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className={cn(
                        'text-sm font-medium leading-tight',
                        isFirstResponse && 'text-yellow-700 dark:text-yellow-300'
                      )}>
                        {event.label}
                      </p>

                      {/* Outcome badge */}
                      {outcomeConfig && (
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-[10px] px-1.5 py-0 gap-1 border-0 h-4',
                            outcomeVariantClasses[outcomeConfig.variant]
                          )}
                        >
                          <outcomeConfig.Icon className="h-2.5 w-2.5" />
                          {outcomeConfig.label}
                        </Badge>
                      )}

                      {event.isAutomation && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1 h-4">
                          <Bot className="h-2.5 w-2.5" />
                          Auto
                        </Badge>
                      )}

                      {event.channel && event.type !== 'first_response' && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                          {CHANNEL_LABELS[event.channel] || event.channel}
                        </Badge>
                      )}

                      {/* Sistema badge: only for timeline events with no human actor and no automation, and not for creation/reentry */}
                      {event.source === 'timeline' &&
                       !event.actor &&
                       !event.isAutomation &&
                       event.type !== 'lead_created' &&
                       event.type !== 'lead_reentry' && (
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1.5 py-0 h-4 bg-muted text-muted-foreground border-transparent opacity-60"
                        >
                          Auto
                        </Badge>
                      )}
                    </div>

                    {/* Outcome notes */}
                    {outcomeNotes && (
                      <p className="text-xs text-muted-foreground mt-0.5 italic">
                        &quot;{outcomeNotes}&quot;
                      </p>
                    )}

                    {/* Content / detail */}
                    {event.content && !outcomeNotes && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {(() => {
                          const mentionRegex = /(@\d{7,}|@[\w\u00C0-\u017F]+(?:\s[\w\u00C0-\u017F]+){0,2})/g;
                          const parts = event.content.split(mentionRegex);

                          if (parts.length === 1) return event.content;

                          return parts.map((part, index) => {
                            if (part.match(mentionRegex)) {
                              return (
                                <span
                                  key={index}
                                  className="font-semibold text-primary px-1 bg-primary/10 rounded"
                                >
                                  {part}
                                </span>
                              );
                            }
                            return part;
                          });
                        })()}
                      </p>
                    )}

                    {/* Stage transition from metadata when content not set */}
                    {!event.content && !outcome && (metadata.from_stage || metadata.old_stage_name) && (metadata.to_stage || metadata.new_stage_name) && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                        {metadata.from_stage || metadata.old_stage_name}
                        <ArrowRight className="h-3 w-3" />
                        {metadata.to_stage || metadata.new_stage_name}
                      </span>
                    )}
                  </div>

                  {/* Timestamp */}
                  <div className="text-right shrink-0">
                    <p className="text-[10px] text-muted-foreground leading-tight">
                      {formatDistanceToNow(new Date(event.timestamp), { addSuffix: true, locale: ptBR })}
                    </p>
                    <p className="text-[10px] text-muted-foreground leading-tight">
                      {format(new Date(event.timestamp), 'dd/MM HH:mm', { locale: ptBR })}
                    </p>
                  </div>
                </div>

                {/* Actor and Action */}
                <div className="flex items-center justify-between gap-2 mt-1">
                  {event.actor && (
                    <div className="flex items-center gap-1.5">
                      <Avatar className="h-4 w-4">
                        <AvatarImage src={event.actor.avatar_url || undefined} />
                        <AvatarFallback className="text-[8px]">
                          {event.actor.name?.[0] || '?'}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-[10px] text-muted-foreground">
                        {event.actor.name}
                      </span>
                    </div>
                  )}

                  {onEventClick && (event.type === 'note' || (event.content?.length ?? 0) > 50) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[10px] rounded-full hover:bg-primary/10 hover:text-primary transition-colors ml-auto"
                      onClick={() => onEventClick(event)}
                    >
                      <Eye className="h-3 w-3 mr-1" />
                      Ver detalhe
                    </Button>
                  )}
                </div>

              </div>
            </div>
            </React.Fragment>
          );
        });
        })()}
      </div>
    </div>
  );
}
