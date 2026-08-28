import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
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
  onDelete?: () => void;
}

function getInitials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function getTagForegroundClass(backgroundColor: string) {
  const match = backgroundColor
    .trim()
    .match(/^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i);
  if (!match) return "text-white";

  const value =
    match[1].length === 3
      ? match[1]
          .split("")
          .map((character) => character + character)
          .join("")
      : match[1].slice(0, 6);
  const channels = [0, 2, 4].map(
    (offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255,
  );
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4,
  );
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;

  return luminance > 0.179 ? "text-slate-950" : "text-white";
}

export function ContactCard({
  contact,
  sourceLabels,
  onViewDetails,
  onDelete,
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
      <div className="grid grid-cols-[36px_minmax(0,1fr)_32px] items-start gap-2.5">
        <Avatar className="h-9 w-9 rounded-[6px] [&_img]:rounded-[6px]">
          <AvatarImage
            src={contact.whatsapp_avatar_url || undefined}
            alt={contact.name}
          />
          <AvatarFallback className="rounded-[6px] bg-primary/50 text-[11px] font-light text-primary-foreground transition-colors group-hover:bg-primary group-focus-within:bg-primary">
            {getInitials(contact.name)}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <button
              type="button"
              className="min-w-0 flex-1 truncate rounded-[3px] text-left text-[13px] font-medium leading-5 text-[var(--app-text-primary)] outline-none hover:text-primary focus-visible:ring-1 focus-visible:ring-primary/30"
              onClick={(event) => {
                event.stopPropagation();
                onViewDetails?.();
              }}
            >
              {contact.name}
            </button>
            <ReentryBadge
              count={contact.reentry_count}
              lastEntryAt={contact.last_entry_at}
            />
            <Badge
              variant="secondary"
              className={cn(
                "h-5 gap-1 rounded-[4px] border-0 px-1.5 text-[9px] font-light whitespace-nowrap",
                dealStatusConfig[status].className,
              )}
            >
              <StatusIcon className="h-2.5 w-2.5" />
              {dealStatusConfig[status].label}
            </Badge>
          </div>

          {(contact.phone || contact.email) && (
            <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] font-light text-[var(--app-text-secondary)]">
              {contact.phone && (
                <a
                  href={`tel:${normalizePhoneToE164(contact.phone) || contact.phone}`}
                  className="flex min-w-0 items-center gap-1.5 hover:text-[var(--app-text-primary)]"
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
                  onClick={(event) => event.stopPropagation()}
                >
                  <Mail className="h-3 w-3 shrink-0 text-[var(--app-text-tertiary)]" />
                  <span className="max-w-[180px] truncate">
                    {contact.email}
                  </span>
                </a>
              )}
            </div>
          )}

          <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5">
            {contact.stage_name && (
              <Badge
                variant="secondary"
                className="max-w-[150px] gap-1.5 truncate rounded-[4px] border-0 bg-[var(--app-surface-soft)] px-1.5 py-0.5 text-[9px] font-light text-[var(--app-text-secondary)]"
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: contact.stage_color || undefined }}
                  aria-hidden="true"
                />
                {contact.stage_name}
              </Badge>
            )}

            {contact.source && (
              <Badge
                variant="secondary"
                className="max-w-[120px] truncate rounded-[4px] border-0 bg-[var(--app-surface-soft)] px-1.5 py-0.5 text-[9px] font-light text-[var(--app-text-secondary)]"
              >
                {sourceLabels[contact.source] || contact.source}
              </Badge>
            )}

            {contact.assignee_name ? (
              <span className="inline-flex min-w-0 items-center gap-1 text-[10px] font-light text-[var(--app-text-secondary)]">
                <UserCircle className="h-3 w-3 shrink-0" />
                <span className="max-w-[90px] truncate">
                  {contact.assignee_name.split(" ")[0]}
                </span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] font-light text-[var(--app-text-tertiary)]">
                <UserCircle className="h-3 w-3" />
                Sem responsável
              </span>
            )}

            <time
              dateTime={contact.created_at}
              className="ml-auto inline-flex items-center gap-1 text-[10px] font-light text-[var(--app-text-tertiary)]"
            >
              <Calendar className="h-3 w-3" />
              {format(new Date(contact.created_at), "dd/MM/yy", {
                locale: ptBR,
              })}
            </time>
          </div>

          {contact.tags && contact.tags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {contact.tags.slice(0, 2).map((tag) => (
                <Badge
                  key={tag.id}
                  variant="secondary"
                  className={cn(
                    "h-5 rounded-[4px] border-0 px-1.5 text-[9px] font-light",
                    getTagForegroundClass(tag.color),
                  )}
                  style={{ backgroundColor: tag.color }}
                >
                  {tag.name}
                </Badge>
              ))}
              {contact.tags.length > 2 && (
                <Badge
                  variant="secondary"
                  className="h-5 rounded-[4px] border-0 bg-[var(--app-surface-soft)] px-1.5 text-[9px] font-light text-[var(--app-text-secondary)]"
                >
                  +{contact.tags.length - 2}
                </Badge>
              )}
            </div>
          )}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Ações de ${contact.name}`}
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
              onClick={onViewDetails}
              className="cursor-pointer gap-2 rounded-[4px] px-2.5 py-2 text-[14px] font-light text-[var(--app-text-primary)] transition-colors focus:bg-[var(--app-surface-hover)] focus:text-[var(--app-text-primary)]"
            >
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-[var(--app-text-tertiary)]" />
              Ver detalhes
            </DropdownMenuItem>
            {contact.phone && (
              <DropdownMenuItem
                asChild
                className="cursor-pointer gap-2 rounded-[4px] px-2.5 py-2 text-[14px] font-light text-[var(--app-text-primary)] transition-colors focus:bg-[var(--app-surface-hover)] focus:text-[var(--app-text-primary)]"
              >
                <a
                  href={`https://wa.me/${contact.phone.replace(/\D/g, "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <MessageCircle className="h-3.5 w-3.5 shrink-0 text-[var(--app-text-tertiary)]" />
                  WhatsApp
                </a>
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

      {isLost && contact.lost_reason && (
        <div className="ml-[46px] mt-2 flex items-start gap-1.5 rounded-[4px] bg-red-500/10 px-2 py-1.5">
          <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-red-600 dark:text-red-400" />
          <p className="line-clamp-2 text-[10px] font-light leading-4 text-red-700 dark:text-red-300">
            <span className="font-medium">Motivo:</span> {contact.lost_reason}
          </p>
        </div>
      )}

      {contact.last_interaction_at && (
        <div className="ml-[46px] mt-2 flex min-w-0 items-center gap-1.5 text-[10px] font-light text-[var(--app-text-tertiary)]">
          {contact.last_interaction_channel === "whatsapp" && (
            <MessageCircle className="h-3 w-3 shrink-0" />
          )}
          <span className="min-w-0 flex-1 truncate">
            {contact.last_interaction_preview || "Interação registrada"}
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
