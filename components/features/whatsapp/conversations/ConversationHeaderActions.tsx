import type { Ref } from "react";
import Link from "next/link";
import { Archive, Loader2, MoreVertical, PanelRightClose, PanelRightOpen, Phone, Search, Trash2, User, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FILTER_UI } from "@/config/filter-ui";
import { cn } from "@/lib/utils";

type ConversationHeaderActionsProps = {
  leadId?: string | null;
  compactLeadAction?: boolean;
  isGroup?: boolean;
  isArchived?: boolean;
  isArchiving?: boolean;
  canOperate?: boolean;
  showLeadPanel?: boolean;
  searchOpen?: boolean;
  phoneHref?: string;
  onToggleLeadPanel?: () => void;
  onReassignLead?: () => void;
  onSearch?: () => void;
  onCreateLead?: () => void;
  onArchive?: () => void;
  onDelete?: () => void;
  actionsButtonRef?: Ref<HTMLButtonElement>;
  searchButtonRef?: Ref<HTMLButtonElement>;
};

export function ConversationHeaderActions({ leadId, compactLeadAction = false, isGroup, isArchived, isArchiving = false, canOperate = false, showLeadPanel, searchOpen, phoneHref, onToggleLeadPanel, onReassignLead, onSearch, onCreateLead, onArchive, onDelete, actionsButtonRef, searchButtonRef }: ConversationHeaderActionsProps) {
  const canMutate = Boolean((canOperate && (onArchive || onDelete || onReassignLead || phoneHref)) || (!leadId && !isGroup && onCreateLead));
  const hasMenu = canMutate || Boolean(compactLeadAction && leadId);
  const actionClass = cn(FILTER_UI.trigger, "shrink-0 bg-[var(--app-surface-soft)] px-0 text-[12px] [@media(pointer:coarse)]:relative [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-w-9 [@media(pointer:coarse)]:bg-transparent! [@media(pointer:coarse)]:before:pointer-events-none [@media(pointer:coarse)]:before:absolute [@media(pointer:coarse)]:before:inset-x-0.5 [@media(pointer:coarse)]:before:h-8 [@media(pointer:coarse)]:before:rounded-[6px] [@media(pointer:coarse)]:before:bg-[var(--app-surface-soft)] [@media(pointer:coarse)]:hover:before:bg-[var(--app-surface-hover)] [@media(pointer:coarse)]:[&_svg]:relative [@media(pointer:coarse)]:[&_svg]:z-10 [@media(pointer:coarse)]:[&>span]:relative");
  const menuItemClass = "min-h-8 rounded-[6px] px-2 py-1 text-[12px] font-light";
  return (
    <div className="flex shrink-0 items-center gap-1.5 [@media(pointer:coarse)]:gap-0" aria-label="Ações da conversa">
      {leadId && !compactLeadAction && <Button type="button" variant="ghost" size="icon" className={actionClass + " w-8 xl:w-auto xl:px-2.5"} asChild><Link href={`/crm/pipelines?lead=${leadId}`} aria-label="Ver lead" title="Ver lead"><User className="h-3.5 w-3.5" aria-hidden="true" /><span className="hidden text-[11px] font-light xl:inline">Ver lead</span></Link></Button>}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" aria-label="Mais ações da conversa" data-conversation-actions disabled={!hasMenu} variant="ghost" size="icon" className={actionClass + " w-8"}>
            <MoreVertical className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        {hasMenu && <DropdownMenuContent align="end" className="w-56 bg-popover">
          {compactLeadAction && leadId && <DropdownMenuItem className={menuItemClass} asChild><Link href={`/crm/pipelines?lead=${leadId}`}><User className="mr-2 h-3.5 w-3.5" aria-hidden="true" />Ver lead</Link></DropdownMenuItem>}
          {canOperate && onReassignLead && !isGroup && <DropdownMenuItem className={menuItemClass} onClick={onReassignLead}><User className="mr-2 h-3.5 w-3.5" aria-hidden="true" />{leadId ? "Mudar vínculo da conversa" : "Vincular a lead"}</DropdownMenuItem>}
          {!leadId && !isGroup && onCreateLead && <DropdownMenuItem className={menuItemClass} onClick={onCreateLead}><UserPlus className="mr-2 h-3.5 w-3.5" aria-hidden="true" />Criar lead</DropdownMenuItem>}
          {canOperate && !leadId && !isGroup && phoneHref && <DropdownMenuItem className={menuItemClass} asChild><a href={`tel:${phoneHref}`}><Phone className="mr-2 h-3.5 w-3.5" aria-hidden="true" />Ligar para o contato</a></DropdownMenuItem>}
          {canOperate && (onArchive || onDelete) && (onReassignLead || (!leadId && onCreateLead)) && <DropdownMenuSeparator />}
          {canOperate && onArchive && <DropdownMenuItem className={menuItemClass} onClick={onArchive} disabled={isArchiving} aria-busy={isArchiving}>{isArchiving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Archive className="mr-2 h-3.5 w-3.5" aria-hidden="true" />}{isArchiving ? "Atualizando arquivo..." : isArchived ? "Desarquivar" : "Arquivar"}</DropdownMenuItem>}
          {canOperate && onDelete && <DropdownMenuItem onClick={onDelete} className={menuItemClass + " text-destructive"}><Trash2 className="mr-2 h-3.5 w-3.5" aria-hidden="true" />Remover</DropdownMenuItem>}
        </DropdownMenuContent>}
      </DropdownMenu>
      {onSearch && <Button ref={searchButtonRef} type="button" variant="ghost" size="icon" className={actionClass + " w-8"} onClick={onSearch} aria-label="Pesquisar nesta conversa" aria-pressed={searchOpen}><Search className="h-3.5 w-3.5" aria-hidden="true" /></Button>}
      {onToggleLeadPanel && <Button ref={actionsButtonRef} type="button" variant="ghost" size="icon" className={actionClass + " w-8"} onClick={onToggleLeadPanel} aria-label={showLeadPanel ? "Recolher dados do contato" : "Mostrar dados do contato"} aria-pressed={showLeadPanel}>{showLeadPanel ? <PanelRightClose className="h-3.5 w-3.5" aria-hidden="true" /> : <PanelRightOpen className="h-3.5 w-3.5" aria-hidden="true" />}</Button>}
    </div>
  );
}
