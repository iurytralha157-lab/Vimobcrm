import { ContactLeadActionMenuItems, type ContactLeadActionKind } from "@/components/features/contacts/contacts-screen/ContactLeadActionMenuItems";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import type { Contact } from "@/hooks/use-contacts-list";
import { ReentryBadge } from "@/components/features/leads/ReentryBadge";
import { normalizePhoneToE164 } from "@/lib/phone-utils";
import { getInitials } from "@/lib/user-display";
import { normalizeDisplayName } from "@/lib/display-name";

const dealStatusConfig = {
  open: {
    label: "Aberto",
    icon: CircleDot,
    className: "bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]",
  },
  won: {
    label: "Ganho",
    icon: Trophy,
    className:
      "bg-[var(--lead-status-won-bg)] text-[var(--lead-status-won-fg)]",
  },
  lost: {
    label: "Perdido",
    icon: XCircle,
    className:
      "bg-[var(--lead-status-lost-bg)] text-[var(--lead-status-lost-fg)]",
  },
};

interface ContactCardProps {
  contact: Contact;
  sourceLabels: Record<string, string>;
  onViewDetails?: () => void;
  onWhatsApp?: () => void;
  onDelete?: () => void;
  onLeadAction?: (kind: ContactLeadActionKind) => void;
  selected?: boolean;
  selectionDisabled?: boolean;
  onSelect?: () => void;
}

export function ContactCard({
  contact,
  sourceLabels,
  onViewDetails,
  onWhatsApp,
  onDelete,
  onLeadAction,
  selected,
  selectionDisabled,
  onSelect,
}: ContactCardProps) {
  const isLost = contact.deal_status === "lost";
  const isWon = contact.deal_status === "won";
  const status: keyof typeof dealStatusConfig = isLost
    ? "lost"
    : isWon
      ? "won"
      : "open";
  const StatusIcon = dealStatusConfig[status].icon;

  return (
    <div
      role="article"
      className={cn(
        "group cursor-pointer rounded-[6px] border-b border-border/30 px-2 py-2.5 transition-colors last:border-b-0 hover:bg-[var(--app-surface-hover)] focus-within:bg-[var(--app-surface-hover)]",
        isLost &&
          "bg-[var(--lead-status-lost-card)] hover:bg-[var(--lead-status-lost-card-hover)]",
        isWon &&
          "bg-[var(--lead-status-won-card)] hover:bg-[var(--lead-status-won-card-hover)]",
      )}
      onClick={onViewDetails}
    >
      <div className={cn('grid items-start gap-2', onSelect ? 'grid-cols-[24px_36px_minmax(0,1fr)_32px]' : 'grid-cols-[36px_minmax(0,1fr)_32px]')}>
        {onSelect && <label htmlFor={`contact-select-${contact.id}`} className="flex min-h-9 cursor-pointer items-center justify-center" onClick={(event) => event.stopPropagation()}><Checkbox id={`contact-select-${contact.id}`} aria-label={`Selecionar ${normalizeDisplayName(contact.name)}`} checked={selected} disabled={selectionDisabled} onCheckedChange={onSelect} /></label>}
        <Avatar className="h-9 w-9 shrink-0 rounded-[6px] [&_img]:rounded-[6px]">
          <AvatarImage
            src={contact.whatsapp_avatar_url || undefined}
            alt={normalizeDisplayName(contact.name)}
          />
          <AvatarFallback className="rounded-[6px] bg-primary/50 text-[11px] font-light text-primary-foreground transition-colors group-hover:bg-primary group-focus-within:bg-primary">
            {getInitials(contact.name)}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0">
          <button
            type="button"
            className="block w-full min-w-0 rounded-[3px] text-left text-[13px] font-medium leading-5 text-[var(--app-text-primary)] outline-none hover:text-primary focus-visible:ring-1 focus-visible:ring-primary/30"
            title={normalizeDisplayName(contact.name)}
            onClick={(event) => {
              event.stopPropagation();
              onViewDetails?.();
            }}
          >
            <span className="line-clamp-2 break-words [overflow-wrap:anywhere]">{normalizeDisplayName(contact.name)}</span>
          </button>

          {(contact.phone || contact.email) && (
            <div className="mt-0.5 grid min-w-0 gap-0.5 text-[11px] font-light leading-4 text-[var(--app-text-secondary)]">
              {contact.phone && (
                <a
                  href={`tel:${normalizePhoneToE164(contact.phone) || contact.phone}`}
                  className="flex min-w-0 items-center gap-1.5 hover:text-[var(--app-text-primary)]"
                  title={contact.phone}
                  onClick={(event) => event.stopPropagation()}
                >
                  <Phone className="h-3 w-3 shrink-0 text-[var(--app-text-tertiary)]" />
                  <span className="truncate">{contact.phone}</span>
                </a>
              )}
              {contact.email && (
                <a
                  href={`mailto:${contact.email}`}
                  className="flex min-w-0 items-center gap-1.5 hover:text-[var(--app-text-primary)]"
                  title={contact.email}
                  onClick={(event) => event.stopPropagation()}
                >
                  <Mail className="h-3 w-3 shrink-0 text-[var(--app-text-tertiary)]" />
                  <span className="min-w-0 truncate">
                    {contact.email}
                  </span>
                </a>
              )}
            </div>
          )}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Ações de ${normalizeDisplayName(contact.name)}`}
              className="h-8 w-8 shrink-0 rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)] shadow-none transition-colors hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)] focus-visible:ring-1 focus-visible:ring-[var(--app-border-strong)] data-[state=open]:bg-[var(--app-surface-hover)] data-[state=open]:text-[var(--app-text-primary)]"
              onClick={(event) => event.stopPropagation()}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={8}
            collisionPadding={12}
            className="app-header-popover w-52 p-2"
          >
            <DropdownMenuItem
              onClick={(event) => {
                event.stopPropagation();
                onViewDetails?.();
              }}
              className="cursor-pointer gap-2 rounded-[4px] px-2.5 py-2 text-[14px] font-light text-[var(--app-text-primary)] transition-colors focus:bg-[var(--app-surface-hover)] focus:text-[var(--app-text-primary)]"
            >
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-[var(--app-text-tertiary)]" />
              Ver detalhes
            </DropdownMenuItem>
            {contact.phone && onWhatsApp && (
              <DropdownMenuItem
                onClick={(event) => {
                  event.stopPropagation();
                  onWhatsApp?.();
                }}
                className="cursor-pointer gap-2 rounded-[4px] px-2.5 py-2 text-[14px] font-light text-[var(--app-text-primary)] transition-colors focus:bg-[var(--app-surface-hover)] focus:text-[var(--app-text-primary)]"
              >
                <MessageCircle className="h-3.5 w-3.5 shrink-0 text-[var(--app-text-tertiary)]" />
                WhatsApp
              </DropdownMenuItem>
            )}
            {contact.email && (
              <DropdownMenuItem
                asChild
                className="cursor-pointer gap-2 rounded-[4px] px-2.5 py-2 text-[14px] font-light text-[var(--app-text-primary)] transition-colors focus:bg-[var(--app-surface-hover)] focus:text-[var(--app-text-primary)]"
              >
                <a href={`mailto:${contact.email}`}>
                  <Mail className="h-3.5 w-3.5 shrink-0 text-[var(--app-text-tertiary)]" />
                  Enviar e-mail
                </a>
              </DropdownMenuItem>
            )}
            {onLeadAction && (
              <>
                <DropdownMenuSeparator className="mx-0 my-1 bg-border/30" />
                <ContactLeadActionMenuItems onSelect={onLeadAction} />
              </>
            )}
            {onDelete && (
              <>
                <DropdownMenuSeparator className="mx-0 my-1 bg-border/30" />
                <DropdownMenuItem
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete();
                  }}
                  className="cursor-pointer gap-2 rounded-[4px] px-2.5 py-2 text-[14px] font-light text-destructive transition-colors focus:bg-destructive/10 focus:text-destructive data-[highlighted]:!bg-destructive/10 data-[highlighted]:!text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5 shrink-0 text-destructive" />
                  Excluir contato
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mt-2.5 space-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Badge
            variant="secondary"
            className={cn(
              "h-5 shrink-0 gap-1 rounded-[4px] border-0 px-1.5 text-[10px] font-light whitespace-nowrap",
              dealStatusConfig[status].className,
            )}
          >
            <StatusIcon className="h-2.5 w-2.5 shrink-0" />
            {dealStatusConfig[status].label}
          </Badge>
          <ReentryBadge count={contact.reentry_count} lastEntryAt={contact.last_entry_at} />
          {(contact.stage_name || contact.pipeline_name) && (
            <Badge
              variant="secondary"
              tabIndex={0}
              aria-label={`${contact.stage_name || "Sem estágio"}. Funil: ${contact.pipeline_name || "Sem funil"}`}
              title={`${contact.stage_name || "Sem estágio"} · Funil: ${contact.pipeline_name || "Sem funil"}`}
              className="h-5 min-w-0 max-w-[min(100%,180px)] rounded-[4px] border-0 bg-[var(--app-surface-soft)] px-1.5 text-[10px] font-light text-[var(--app-text-secondary)] outline-none focus-visible:ring-1 focus-visible:ring-primary/30"
            >
              <span className="min-w-0 truncate">{contact.stage_name || "Sem estágio"}</span>
            </Badge>
          )}
          {contact.source && (
            <Badge
              variant="secondary"
              title={sourceLabels[contact.source] || contact.source}
              className="h-5 min-w-0 max-w-[min(100%,180px)] rounded-[4px] border-0 bg-[var(--app-surface-soft)] px-1.5 text-[10px] font-light text-[var(--app-text-secondary)]"
            >
              <span className="min-w-0 truncate">{sourceLabels[contact.source] || contact.source}</span>
            </Badge>
          )}
        </div>

        {contact.tags && contact.tags.length > 0 && (
          <div className="flex min-w-0 flex-wrap gap-1">
            {contact.tags.slice(0, 2).map((tag) => (
              <Badge
                key={tag.id}
                variant="secondary"
                className="h-5 min-w-0 max-w-full rounded-[4px] border-0 px-1.5 py-0 text-[10px] font-light leading-[14px]"
                title={tag.name}
                style={{ backgroundColor: tag.color, color: "#ffffff" }}
              >
                <span className="min-w-0 truncate">{tag.name}</span>
              </Badge>
            ))}
            {contact.tags.length > 2 && (
              <Badge variant="secondary" className="h-5 shrink-0 rounded-[4px] border-0 bg-[var(--app-surface-soft)] px-1.5 text-[9px] font-light text-[var(--app-text-secondary)]">
                +{contact.tags.length - 2}
              </Badge>
            )}
          </div>
        )}

        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 text-[10px] font-light text-[var(--app-text-tertiary)]">
          <div className="flex shrink-0 items-center gap-2">
            <span>Resp.</span>
            <div role="img" aria-label={`Responsável: ${contact.assignee_name || "Sem responsável"}`} title={contact.assignee_name || "Sem responsável"} tabIndex={0} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] outline-none focus-visible:ring-1 focus-visible:ring-primary/30">
              {contact.assignee_name ? (
                <Avatar className="h-7 w-7 rounded-[6px] [&_img]:rounded-[6px]">
                  <AvatarImage src={contact.assignee_avatar || undefined} alt={contact.assignee_name} />
                  <AvatarFallback className="rounded-[6px] bg-primary/50 text-[10px] font-light text-primary-foreground">{getInitials(contact.assignee_name)}</AvatarFallback>
                </Avatar>
              ) : (
                <span className="flex h-7 w-7 items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)]"><UserCircle className="h-3.5 w-3.5" aria-hidden="true" /></span>
              )}
            </div>
          </div>
          <div className="ml-auto flex items-center justify-end gap-1.5 whitespace-nowrap">
            <span>Criado em</span>
            <time dateTime={contact.created_at} className="inline-flex items-center gap-1 text-[var(--app-text-secondary)]" title={format(new Date(contact.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}>
              <Calendar className="h-3 w-3 shrink-0" aria-hidden="true" />
              {format(new Date(contact.created_at), "dd/MM/yy", { locale: ptBR })}
            </time>
          </div>
        </div>
      </div>

      {isLost && contact.lost_reason && (
        <div className="mt-2 flex min-w-0 items-start gap-1.5 rounded-[4px] bg-red-500/10 px-2 py-1.5">
          <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-red-600 dark:text-red-400" />
          <p className="min-w-0 line-clamp-2 break-words text-[10px] font-light leading-4 text-red-700 dark:text-red-300 [overflow-wrap:anywhere]" title={contact.lost_reason}>
            <span className="font-medium">Motivo:</span> {contact.lost_reason}
          </p>
        </div>
      )}

      {contact.last_interaction_at && (
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] font-light text-[var(--app-text-tertiary)]">
          {contact.last_interaction_channel === "whatsapp" && (
            <MessageCircle className="h-3 w-3 shrink-0" />
          )}
          <span className="min-w-0 flex-1 truncate" title={contact.last_interaction_preview || "Última entrada"}>
            {contact.last_interaction_preview || "Última entrada"}
          </span>
          <span className="shrink-0">
            {formatDistanceToNow(new Date(contact.last_interaction_at), {
              addSuffix: true,
              locale: ptBR,
            })}
          </span>
        </div>
      )}
    </div>
  );
}
