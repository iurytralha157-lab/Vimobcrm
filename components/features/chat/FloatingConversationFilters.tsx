import { Search, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CONVERSATION_LIST_UI } from "@/components/features/whatsapp";
import type { WhatsAppSession } from "@/hooks/use-whatsapp-sessions";
import { cn } from "@/lib/utils";

type FloatingConversationFiltersProps = {
  sharedFilterCount: number;
  sessions: WhatsAppSession[];
  selectedSessionId: string;
  onSessionChange: (sessionId: string) => void;
  searchTerm: string;
  onSearchChange: (value: string) => void;
  hideGroups: boolean;
  onHideGroupsChange: (value: boolean) => void;
  showArchived: boolean;
  onShowArchivedChange: (value: boolean) => void;
  onClearFilters: () => void;
};

export function FloatingConversationFilters({
  sharedFilterCount,
  sessions,
  selectedSessionId,
  onSessionChange,
  searchTerm,
  onSearchChange,
  hideGroups,
  onHideGroupsChange,
  showArchived,
  onShowArchivedChange,
  onClearFilters,
}: FloatingConversationFiltersProps) {
  const activeFilterCount = [
    selectedSessionId !== "all",
    hideGroups,
    showArchived,
    Boolean(searchTerm.trim()),
  ].filter(Boolean).length + sharedFilterCount;

  return (
    <div className="shrink-0 border-b border-black/[0.035] bg-[var(--app-surface-solid)] px-2.5 py-2 dark:border-white/[0.035]">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search aria-hidden="true" className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Buscar conversas"
            maxLength={180}
            placeholder="Buscar conversas..."
            value={searchTerm}
            onChange={e => onSearchChange(e.target.value)}
            className={CONVERSATION_LIST_UI.search}
            autoComplete="off"
          />
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              aria-label="Filtrar conversas"
              className={cn(
                "h-8 shrink-0 gap-1.5 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2 text-[11px] font-light text-[var(--app-text-secondary)] shadow-none hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)] [&_svg]:size-3.5",
                activeFilterCount > 0 && "bg-[var(--app-surface-hover)] text-primary",
              )}
            >
              <SlidersHorizontal aria-hidden="true" />
              <span>Filtros</span>
              {activeFilterCount > 0 && (
                <span className="flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[9px] leading-none text-primary-foreground">
                  {activeFilterCount}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={8}
            className="z-[70] w-[240px] rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-2.5 text-[var(--app-text-primary)] shadow-[0_8px_24px_rgba(0,0,0,0.08)]"
          >
            <div className="space-y-2">
              {sharedFilterCount > 0 && <p className="text-[11px] text-muted-foreground">{sharedFilterCount} filtro(s) geral(is) do CRM aplicado(s). Ajuste-os na Dashboard, Pipeline, Contatos ou WhatsApp.</p>}
              {sessions.length > 1 && (
                <div className="space-y-1.5">
                  <span className="text-[10px] font-medium text-muted-foreground">Conta</span>
                  <Select value={selectedSessionId} onValueChange={onSessionChange}>
                    <SelectTrigger className="h-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[11px] font-light shadow-none focus:ring-0">
                      <SelectValue placeholder="Selecione a conta" />
                    </SelectTrigger>
                    <SelectContent className="z-[80] bg-popover">
                      <SelectItem value="all">Todas as contas</SelectItem>
                      {sessions.map((session) => (
                        <SelectItem key={session.id} value={session.id}>
                          {session.display_name || session.instance_name || session.phone_number}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="grid gap-2">
                <label className="flex h-8 cursor-pointer items-center justify-between gap-2 rounded-[6px] bg-[var(--app-surface-soft)] px-2.5 text-[11px]">
                  <span>Ocultar grupos</span>
                  <Checkbox
                    className="h-3.5 w-3.5 rounded-[4px] border-primary/70 [&_svg]:h-3 [&_svg]:w-3"
                    checked={hideGroups}
                    onCheckedChange={(checked) => onHideGroupsChange(checked === true)}
                  />
                </label>
                <label className="flex h-8 cursor-pointer items-center justify-between gap-2 rounded-[6px] bg-[var(--app-surface-soft)] px-2.5 text-[11px]">
                  <span>Mostrar arquivadas</span>
                  <Checkbox
                    className="h-3.5 w-3.5 rounded-[4px] border-primary/70 [&_svg]:h-3 [&_svg]:w-3"
                    checked={showArchived}
                    onCheckedChange={(checked) => onShowArchivedChange(checked === true)}
                  />
                </label>
              </div>

              {activeFilterCount > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn("h-8 w-full rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2 text-[length:var(--app-font-size-caption)] font-light shadow-none hover:bg-[var(--app-surface-hover)]", CONVERSATION_LIST_UI.clear)}
                  onClick={onClearFilters}
                >
                  Limpar filtros
                </Button>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
