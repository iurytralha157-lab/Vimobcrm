import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  MoreHorizontal,
  Phone,
  Mail,
  ExternalLink,
  UserCircle,
  Calendar,
  MessageCircle,
  Trophy,
  XCircle,
  CircleDot,
  Trash2,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import type { Contact } from '@/hooks/use-contacts-list';
import { ReentryBadge } from '@/components/features/leads/ReentryBadge';

// Deal status configuration
const dealStatusConfig = {
  open: { label: 'Aberto', icon: CircleDot, className: 'bg-[var(--app-surface-soft)] text-muted-foreground' },
  won: { label: 'Ganho', icon: Trophy, className: 'bg-[var(--lead-status-won-bg)] text-[var(--lead-status-won-fg)]' },
  lost: { label: 'Perdido', icon: XCircle, className: 'bg-[var(--lead-status-lost-bg)] text-[var(--lead-status-lost-fg)]' },
};

interface ContactCardProps {
  contact: Contact;
  sourceLabels: Record<string, string>;
  onViewDetails?: () => void;
  onDelete?: () => void;
}

export function ContactCard({ contact, sourceLabels, onViewDetails, onDelete }: ContactCardProps) {
  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const isLost = contact.deal_status === 'lost';
  const isWon = contact.deal_status === 'won';
  const status = contact.deal_status || 'open';
  const StatusIcon = dealStatusConfig[status]?.icon || CircleDot;

  return (
    <div
      className={cn(
        "space-y-3 p-4 transition-colors cursor-pointer hover:bg-white/[0.045]",
        isLost && "bg-[var(--lead-status-lost-card)] hover:bg-[var(--lead-status-lost-card-hover)]",
        isWon && "bg-[var(--lead-status-won-card)] hover:bg-[var(--lead-status-won-card-hover)]"
      )}
      onClick={onViewDetails}
    >
      {/* Header: Name + Actions */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <Avatar className="h-10 w-10 shrink-0">
            <AvatarImage src={contact.whatsapp_avatar_url || undefined} alt={contact.name} />
            <AvatarFallback className="bg-primary text-primary-foreground text-xs">
              {getInitials(contact.name)}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <p className="font-medium truncate">{contact.name}</p>
              <ReentryBadge count={contact.reentry_count} lastEntryAt={contact.last_entry_at} />
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-1 text-sm text-muted-foreground">
              {contact.phone && (
                <a
                  href={`tel:${contact.phone}`}
                  className="flex items-center gap-1 hover:text-foreground"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Phone className="h-3 w-3" />
                  <span className="truncate max-w-[120px]">{contact.phone}</span>
                </a>
              )}
              {contact.email && (
                <a
                  href={`mailto:${contact.email}`}
                  className="flex items-center gap-1 hover:text-foreground"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Mail className="h-3 w-3" />
                  <span className="truncate max-w-[140px]">{contact.email}</span>
                </a>
              )}
            </div>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={(e) => e.stopPropagation()}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onViewDetails}>
              <ExternalLink className="h-4 w-4 mr-2" />
              Ver detalhes
            </DropdownMenuItem>
            {contact.phone && (
              <DropdownMenuItem asChild>
                <a href={`https://wa.me/${contact.phone.replace(/\D/g, '')}`} target="_blank">
                  <Phone className="h-4 w-4 mr-2" />
                  WhatsApp
                </a>
              </DropdownMenuItem>
            )}
            {contact.email && (
              <DropdownMenuItem asChild>
                <a href={`mailto:${contact.email}`}>
                  <Mail className="h-4 w-4 mr-2" />
                  Enviar email
                </a>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onDelete?.();
              }}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Excluir contato
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Status + Stage + Assignee Row */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Deal Status Badge */}
        <Badge
          variant="secondary"
          className={cn("gap-1 rounded-md border-0 px-2 py-0.5 text-xs font-medium whitespace-nowrap", dealStatusConfig[status]?.className)}
        >
          <StatusIcon className="h-3 w-3" />
          {dealStatusConfig[status]?.label}
        </Badge>

        {contact.stage_name && (
          <Badge
            variant="outline"
            className="gap-1.5 text-xs"
            style={{
              borderColor: contact.stage_color || undefined,
              color: contact.stage_color || undefined
            }}
          >
            <div
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: contact.stage_color || undefined }}
            />
            {contact.stage_name}
          </Badge>
        )}

        <div className="h-4 w-px bg-white/[0.045]" />

        {contact.assignee_name ? (
          <div className="flex items-center gap-1.5">
            <Avatar className="h-5 w-5">
              <AvatarImage src={contact.assignee_avatar || undefined} />
              <AvatarFallback className="text-[8px] bg-primary text-primary-foreground">
                {getInitials(contact.assignee_name)}
              </AvatarFallback>
            </Avatar>
            <span className="text-sm text-muted-foreground">{contact.assignee_name.split(' ')[0]}</span>
          </div>
        ) : (
          <span className="text-muted-foreground text-sm flex items-center gap-1">
            <UserCircle className="h-3.5 w-3.5" />
            Sem responsável
          </span>
        )}
      </div>

      {/* Lost Reason - shown when lost */}
      {isLost && contact.lost_reason && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/15 bg-red-500/10 px-3 py-2">
          <XCircle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
          <p className="text-xs text-red-700 dark:text-red-300">
            <span className="font-medium">Motivo:</span> {contact.lost_reason}
          </p>
        </div>
      )}

      {/* Tags + Source + Date Row */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Tags */}
        {contact.tags && contact.tags.length > 0 && (
          <div className="flex gap-1">
            {contact.tags.slice(0, 2).map(tag => (
              <Badge
                key={tag.id}
                variant="secondary"
                className="text-xs"
                style={{ backgroundColor: tag.color, color: '#FFFFFF' }}
              >
                {tag.name}
              </Badge>
            ))}
            {contact.tags.length > 2 && (
              <Badge variant="secondary" className="text-xs">
                +{contact.tags.length - 2}
              </Badge>
            )}
          </div>
        )}

        {/* Source */}
        <Badge variant="outline" className="text-xs">
          {sourceLabels[contact.source] || contact.source}
        </Badge>

        {/* Date */}
        <div className="flex items-center gap-1 text-xs text-muted-foreground ml-auto">
          <Calendar className="h-3 w-3" />
          {format(new Date(contact.created_at), 'dd/MM/yy', { locale: ptBR })}
        </div>
      </div>

      {/* Last Interaction */}
      {contact.last_interaction_at && (
        <div className="border-t border-white/[0.045] pt-2">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {contact.last_interaction_channel === 'whatsapp' && (
              <MessageCircle className="h-3 w-3" />
            )}
            <span className="truncate flex-1">
              {contact.last_interaction_preview || 'Interação registrada'}
            </span>
            <span className="shrink-0">
              {formatDistanceToNow(new Date(contact.last_interaction_at), {
                addSuffix: true,
                locale: ptBR
              })}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
