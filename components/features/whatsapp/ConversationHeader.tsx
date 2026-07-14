import Link from "next/link";
import {
  Archive,
  ArrowRight,
  MoreVertical,
  Phone,
  Trash2,
  User,
  UserPlus,
  Users,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatPhoneForDisplay } from "@/lib/phone-utils";
import { cn } from "@/lib/utils";

interface LeadTag {
  tag: {
    id: string;
    name: string;
    color: string;
  };
}

interface ConversationHeaderProps {
  contactName?: string | null;
  contactPhone?: string | null;
  contactPicture?: string | null;
  contactPresence?: string | null;
  isGroup?: boolean;
  isArchived?: boolean;
  leadId?: string | null;
  leadTags?: LeadTag[];
  leadAssigneeName?: string | null;
  leadAssigneeIsCurrentUser?: boolean;
  pipelineName?: string | null;
  stageName?: string | null;
  stageColor?: string | null;
  conversationId?: string | null;
  sessionId?: string | null;
  remoteJid?: string | null;
  onArchive?: () => void;
  onDelete?: () => void;
  onCreateLead?: () => void;
  onToggleLeadPanel?: () => void;
  showLeadPanel?: boolean;
  className?: string;
}

export function ConversationHeader({
  contactName,
  contactPhone,
  contactPicture,
  contactPresence,
  isGroup,
  isArchived,
  leadId,
  pipelineName,
  stageName,
  stageColor,
  onArchive,
  onDelete,
  onCreateLead,
  className,
}: ConversationHeaderProps) {
  const displayName =
    contactName && contactName !== contactPhone
      ? contactName
      : formatPhoneForDisplay(contactPhone || "");
  const hasLeadContext = Boolean(leadId);

  const presenceIndicator = (() => {
    switch (contactPresence) {
      case "composing":
        return (
          <span className="flex items-center gap-1 text-xs text-primary">
            <span className="flex gap-0.5">
              <span className="h-1 w-1 animate-bounce rounded-full bg-primary" style={{ animationDelay: "0ms" }} />
              <span className="h-1 w-1 animate-bounce rounded-full bg-primary" style={{ animationDelay: "150ms" }} />
              <span className="h-1 w-1 animate-bounce rounded-full bg-primary" style={{ animationDelay: "300ms" }} />
            </span>
            digitando...
          </span>
        );
      case "recording":
        return (
          <span className="flex items-center gap-1 text-xs text-primary">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
            gravando audio...
          </span>
        );
      default:
        return contactName && contactName !== contactPhone ? (
          <span className="truncate text-xs text-muted-foreground">
            {formatPhoneForDisplay(contactPhone || "")}
          </span>
        ) : null;
    }
  })();

  return (
    <header
      className={cn(
        "flex min-h-[3.25rem] shrink-0 items-center justify-between border-b border-white/[0.055] bg-[var(--app-surface)] px-4 py-2 transition-all duration-200",
        className,
      )}
    >
      {hasLeadContext ? (
        <div className="flex min-w-0 flex-1 items-center">
          {(pipelineName || stageName) && (
            <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-[var(--app-text-secondary)]">
              {pipelineName && <span className="max-w-[180px] truncate">{pipelineName}</span>}
              {pipelineName && stageName && <ArrowRight className="h-3 w-3 shrink-0 text-[var(--app-text-tertiary)]" />}
              {stageName && (
                <Badge
                  variant="outline"
                  className="h-5 max-w-[130px] rounded-[5px] border-0 bg-[var(--app-surface-soft)] px-1.5 text-[10px] font-medium"
                  style={stageColor ? { color: stageColor } : undefined}
                >
                  <span className="truncate">{stageName}</span>
                </Badge>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="flex min-w-0 items-center gap-3">
          <div className="relative">
            <Avatar className="h-10 w-10 ring-2 ring-background">
              <AvatarImage src={contactPicture || undefined} />
              <AvatarFallback className="bg-primary text-primary-foreground">
                {isGroup ? <Users className="h-5 w-5" /> : displayName?.[0]?.toUpperCase() || "?"}
              </AvatarFallback>
            </Avatar>
            {contactPresence === "available" && (
              <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-background bg-green-500" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-sm font-semibold">{displayName}</h2>
              {isGroup && (
                <Badge variant="secondary" className="h-4 shrink-0 px-1.5 text-[10px]">
                  Grupo
                </Badge>
              )}
            </div>
            {presenceIndicator}
          </div>
        </div>
      )}

      <div className="flex shrink-0 items-center gap-1">
        {leadId ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 rounded-[6px] px-2 text-[11px] font-medium text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]"
            asChild
          >
            <Link href={`/crm/pipelines?lead=${leadId}`}>
              <User className="mr-1 h-3 w-3" />
              Ver Lead
            </Link>
          </Button>
        ) : (
          <>
            {onCreateLead && !isGroup && (
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={onCreateLead}>
                <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                Criar Lead
              </Button>
            )}

            <Button variant="ghost" size="icon" className="h-8 w-8">
              <Phone className="h-4 w-4" />
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48 bg-popover">
                <DropdownMenuItem onClick={onArchive}>
                  <Archive className="mr-2 h-4 w-4" />
                  {isArchived ? "Desarquivar" : "Arquivar"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onDelete} className="text-destructive">
                  <Trash2 className="mr-2 h-4 w-4" />
                  Remover
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>
    </header>
  );
}
