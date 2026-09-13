import { MessageCircle, Search, SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { MetaIntegration } from "@/hooks/use-meta-integration";
import type { WhatsAppSession } from "@/hooks/use-whatsapp-sessions";
import { cn } from "@/lib/utils";

import type { ConversationPlatform } from "./conversation-model";

type ConversationFiltersProps = {
  layout: "mobile" | "desktop";
  activePlatform: ConversationPlatform;
  onSelectWhatsApp: () => void;
  sessions?: WhatsAppSession[];
  metaIntegrations?: MetaIntegration[];
  currentChannelValue: string;
  onChannelChange: (value: string) => void;
  activeFilterCount: number;
  hideGroups: boolean;
  onHideGroupsChange: (checked: boolean) => void;
  showArchived: boolean;
  onShowArchivedChange: (checked: boolean) => void;
  onlyLeads: boolean;
  onOnlyLeadsChange: (checked: boolean) => void;
  withoutLeadOnly: boolean;
  onWithoutLeadOnlyChange: (checked: boolean) => void;
  pendingReplyOnly: boolean;
  onPendingReplyOnlyChange: (checked: boolean) => void;
  onClearFilters: () => void;
  searchTerm: string;
  onSearchTermChange: (value: string) => void;
};

export function ConversationFilters({
  layout,
  activePlatform,
  onSelectWhatsApp,
  sessions,
  metaIntegrations,
  currentChannelValue,
  onChannelChange,
  activeFilterCount,
  hideGroups,
  onHideGroupsChange,
  showArchived,
  onShowArchivedChange,
  onlyLeads,
  onOnlyLeadsChange,
  withoutLeadOnly,
  onWithoutLeadOnlyChange,
  pendingReplyOnly,
  onPendingReplyOnlyChange,
  onClearFilters,
  searchTerm,
  onSearchTermChange,
}: ConversationFiltersProps) {
  const isMobile = layout === "mobile";

  return (
    <div className={cn(
      "space-y-2 border-b border-[var(--app-border)] bg-[var(--app-surface)] p-2.5",
      isMobile && "shrink-0",
    )}>
      <div className="flex items-center gap-2">
        <div data-tour="conversations-channel" className="flex min-w-0 flex-1 gap-1 rounded-[6px] bg-[var(--app-surface-soft)] p-0.5">
          <Button
            variant={activePlatform === "whatsapp" ? "secondary" : "ghost"}
            size="sm"
            className={cn(
              "h-7 flex-1 gap-1.5 rounded-[6px] border-0 text-[11px] shadow-none",
              activePlatform === "whatsapp" && "bg-[var(--app-surface-hover)] text-primary",
            )}
            onClick={onSelectWhatsApp}
          >
            <MessageCircle className="h-3.5 w-3.5" />
            <span className="text-[11px] font-medium">WhatsApp</span>
          </Button>
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              data-tour="conversations-filters"
              variant="ghost"
              className={cn(
                "h-8 shrink-0 gap-1.5 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2 text-[12px] font-light text-foreground shadow-none hover:bg-[var(--app-surface-hover)]",
                activeFilterCount > 0 && "bg-[var(--app-surface-hover)] text-primary",
              )}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span>Filtros</span>
              {activeFilterCount > 0 && (
                <span className="flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[9px] leading-none text-primary-foreground">
                  {activeFilterCount}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align={isMobile ? "end" : "start"}
            side={isMobile ? "bottom" : "right"}
            sideOffset={isMobile ? 8 : 10}
            className={cn(
              "rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-2.5 text-[var(--app-text-primary)] shadow-none",
              isMobile ? "w-[min(90vw,300px)]" : "w-[260px]",
            )}
          >
            <div className="space-y-2">
              {activePlatform === "whatsapp" && sessions && sessions.length > 1 && (
                <div className="space-y-1.5">
                  <span className="text-[10px] font-medium text-muted-foreground">Conta</span>
                  <Select value={currentChannelValue} onValueChange={onChannelChange}>
                    <SelectTrigger className="h-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[11px] shadow-none focus:ring-0">
                      <SelectValue placeholder="Selecione a conta WhatsApp" />
                    </SelectTrigger>
                    <SelectContent className="z-[70] bg-popover">
                      <SelectGroup>
                        <SelectItem value="whatsapp-all">Todas as contas</SelectItem>
                        {sessions.map((session) => (
                          <SelectItem key={session.id} value={`whatsapp-${session.id}`}>
                            {session.display_name || session.instance_name || session.phone_number}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {activePlatform === "whatsapp" && (
                <div className="grid gap-2">
                  <label data-tour="conversations-hide-groups" className="flex h-8 cursor-pointer items-center justify-between gap-2 rounded-[6px] bg-[var(--app-surface-soft)] px-2.5 text-[11px]">
                    <span>Ocultar grupos</span>
                    <Checkbox className="h-3.5 w-3.5 rounded-[4px] border-primary/70 [&_svg]:h-3 [&_svg]:w-3" checked={hideGroups} onCheckedChange={(checked) => onHideGroupsChange(checked === true)} />
                  </label>
                  <label data-tour="conversations-archived" className="flex h-8 cursor-pointer items-center justify-between gap-2 rounded-[6px] bg-[var(--app-surface-soft)] px-2.5 text-[11px]">
                    <span>Arquivadas</span>
                    <Checkbox className="h-3.5 w-3.5 rounded-[4px] border-primary/70 [&_svg]:h-3 [&_svg]:w-3" checked={showArchived} onCheckedChange={(checked) => onShowArchivedChange(checked === true)} />
                  </label>
                  <label className="flex h-8 cursor-pointer items-center justify-between gap-2 rounded-[6px] bg-[var(--app-surface-soft)] px-2.5 text-[11px]">
                    <span>Somente leads</span>
                    <Checkbox className="h-3.5 w-3.5 rounded-[4px] border-primary/70 [&_svg]:h-3 [&_svg]:w-3" checked={onlyLeads} onCheckedChange={(checked) => onOnlyLeadsChange(checked === true)} />
                  </label>
                  <label className="flex h-8 cursor-pointer items-center justify-between gap-2 rounded-[6px] bg-[var(--app-surface-soft)] px-2.5 text-[11px]">
                    <span>Sem lead</span>
                    <Checkbox className="h-3.5 w-3.5 rounded-[4px] border-primary/70 [&_svg]:h-3 [&_svg]:w-3" checked={withoutLeadOnly} onCheckedChange={(checked) => onWithoutLeadOnlyChange(checked === true)} />
                  </label>
                  <label className="flex h-8 cursor-pointer items-center justify-between gap-2 rounded-[6px] bg-[var(--app-surface-soft)] px-2.5 text-[11px]">
                    <span>Sem resposta</span>
                    <Checkbox className="h-3.5 w-3.5 rounded-[4px] border-primary/70 [&_svg]:h-3 [&_svg]:w-3" checked={pendingReplyOnly} onCheckedChange={(checked) => onPendingReplyOnlyChange(checked === true)} />
                  </label>
                </div>
              )}

              {activeFilterCount > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-full rounded-[6px] border-0 bg-primary/10 px-2 text-[11px] font-medium text-primary shadow-none hover:bg-primary/15 hover:text-primary"
                  onClick={onClearFilters}
                >
                  Limpar filtros
                </Button>
              )}
            </div>
          </PopoverContent>
        </Popover>

        {!isMobile && false && activePlatform === "whatsapp" && (sessions?.length ?? 0) > 1 && (
          <Select value={currentChannelValue} onValueChange={onChannelChange}>
            <SelectTrigger className="h-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] font-light focus:ring-0">
              <SelectValue placeholder="Selecione a conta WhatsApp" />
            </SelectTrigger>
            <SelectContent className="bg-popover z-50">
              <SelectGroup>
                <SelectItem value="whatsapp-all">Todas as contas WhatsApp</SelectItem>
                {(sessions ?? []).map((session) => (
                  <SelectItem key={session.id} value={`whatsapp-${session.id}`}>
                    {session.display_name || session.instance_name || session.phone_number}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        )}

        {!isMobile && false && activePlatform !== "whatsapp" && (metaIntegrations?.length ?? 0) > 1 && (
          <Select value={currentChannelValue} onValueChange={onChannelChange}>
            <SelectTrigger className="h-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] font-light focus:ring-0">
              <SelectValue placeholder="Selecione a página" />
            </SelectTrigger>
            <SelectContent className="bg-popover z-50">
              <SelectGroup>
                <SelectItem value="meta-all">Todas as páginas</SelectItem>
                {(metaIntegrations ?? []).map((integration) => (
                  <SelectItem key={integration.id} value={`meta-${integration.page_id}`}>
                    {integration.page_name || integration.page_id}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        )}
      </div>

      <div data-tour="conversations-search" className="relative">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Buscar conversas"
          placeholder={activePlatform === "whatsapp" ? "Buscar conversas..." : "Buscar no Instagram/Meta..."}
          value={searchTerm}
          onChange={(event) => onSearchTermChange(event.target.value)}
          className="h-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)] py-0 pl-8 pr-3 text-xs shadow-none focus-visible:ring-1 focus-visible:ring-white/[0.09] focus-visible:ring-offset-0"
        />
      </div>

      {!isMobile && false && activePlatform === "whatsapp" && (
        <div className="flex items-center justify-between gap-2">
          <label data-tour="conversations-hide-groups" className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <Checkbox checked={hideGroups} onCheckedChange={(checked) => onHideGroupsChange(checked === true)} />
            <span>Ocultar grupos</span>
          </label>
          <label data-tour="conversations-archived" className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <Checkbox checked={showArchived} onCheckedChange={(checked) => onShowArchivedChange(checked === true)} />
            <span>Arquivadas</span>
          </label>
        </div>
      )}
    </div>
  );
}
