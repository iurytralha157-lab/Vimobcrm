import { useState } from "react";
import { MessageCircle, Search } from "lucide-react";

import { SharedFilters } from "@/components/shared/SharedFilters";
import { CONVERSATION_LIST_UI } from "@/components/features/whatsapp/conversation-list-ui";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DatePreset } from "@/hooks/use-dashboard-filters";
import type { WhatsAppSession } from "@/hooks/use-whatsapp-sessions";
import type { WhatsAppConversationFilterOptions } from "@/lib/api/whatsapp";
import { cn } from "@/lib/utils";

import type { ConversationPlatform } from "./conversation-model";

type ConversationFiltersProps = {
  layout: "mobile" | "desktop";
  activePlatform: ConversationPlatform;
  onSelectWhatsApp: () => void;
  sessions?: WhatsAppSession[];
  currentChannelValue: string;
  onChannelChange: (value: string) => void;
  options?: WhatsAppConversationFilterOptions;
  optionsHasMore: boolean;
  optionsLoadingMore: boolean;
  onLoadMoreOptions: () => void;
  optionsLoading: boolean;
  optionsError: boolean;
  optionsRetrying: boolean;
  onRetryOptions: () => void;
  onFiltersOpenChange: (open: boolean) => void;
  activeFilterCount: number;
  pipelineId: string | null;
  onPipelineChange: (id: string | null) => void;
  teamId: string | null;
  onTeamChange: (id: string | null) => void;
  userId: string | null;
  onUserChange: (id: string | null) => void;
  leadSource: string | null;
  onLeadSourceChange: (source: string | null) => void;
  tagIds: string[];
  onTagsChange: (ids: string[]) => void;
  dealStatus: string | null;
  onDealStatusChange: (status: string | null) => void;
  pageId: string | null;
  onPageChange: (id: string | null) => void;
  campaignIds: string[];
  onCampaignsChange: (ids: string[]) => void;
  adSetId: string | null;
  onAdSetChange: (id: string | null) => void;
  adId: string | null;
  onAdChange: (id: string | null) => void;
  datePreset: DatePreset | null;
  onDatePresetChange: (preset: DatePreset | null) => void;
  customDateRange: { from: Date; to: Date } | null;
  onCustomDateRangeChange: (range: { from: Date; to: Date } | null) => void;
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
  currentChannelValue,
  onChannelChange,
  options,
  optionsHasMore,
  optionsLoadingMore,
  onLoadMoreOptions,
  optionsLoading,
  optionsError,
  optionsRetrying,
  onRetryOptions,
  onFiltersOpenChange,
  activeFilterCount,
  pipelineId,
  onPipelineChange,
  teamId,
  onTeamChange,
  userId,
  onUserChange,
  leadSource,
  onLeadSourceChange,
  tagIds,
  onTagsChange,
  dealStatus,
  onDealStatusChange,
  pageId,
  onPageChange,
  campaignIds,
  onCampaignsChange,
  adSetId,
  onAdSetChange,
  adId,
  onAdChange,
  datePreset,
  onDatePresetChange,
  customDateRange,
  onCustomDateRangeChange,
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const isWhatsApp = activePlatform === "whatsapp";

  const advancedContent = (layerScope: string) => isWhatsApp ? (
    <>
      {optionsHasMore && (
        <Button type="button" variant="ghost" size="sm" onClick={onLoadMoreOptions} disabled={optionsLoadingMore} aria-busy={optionsLoadingMore} className="h-8 rounded-[6px] text-xs font-light">
          {optionsLoadingMore ? 'Carregando opções...' : 'Carregar mais opções'}
        </Button>
      )}
      {withoutLeadOnly && (
        <p role="status" className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
          Filtros de lead pausados enquanto você consulta conversas sem lead.
        </p>
      )}
      {(sessions?.length ?? 0) > 1 && (
        <Select value={currentChannelValue} onValueChange={onChannelChange}>
          <SelectTrigger aria-label="Filtrar por conta WhatsApp" data-filter-active={currentChannelValue !== "whatsapp-all"} className="h-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] shadow-none">
            <SelectValue placeholder="Todas as contas" />
          </SelectTrigger>
          <SelectContent data-filter-layer={layerScope} className="z-[140] bg-popover">
            <SelectItem value="whatsapp-all">Todas as contas</SelectItem>
            {sessions?.map((session) => (
              <SelectItem key={session.id} value={`whatsapp-${session.id}`}>
                {session.display_name || session.instance_name || session.phone_number}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <div className="grid gap-2 border-b border-[var(--app-border)] pb-2">
        <label data-tour="conversations-archived" data-filter-active={showArchived} className="flex h-8 cursor-pointer items-center justify-between gap-2 rounded-[6px] bg-[var(--app-surface-soft)] px-2.5 text-[11px]">
          <span>Arquivadas</span>
          <Checkbox checked={showArchived} onCheckedChange={(checked) => onShowArchivedChange(checked === true)} />
        </label>
        <label data-filter-active={onlyLeads} className="flex h-8 cursor-pointer items-center justify-between gap-2 rounded-[6px] bg-[var(--app-surface-soft)] px-2.5 text-[11px]">
          <span>Somente leads</span>
          <Checkbox checked={onlyLeads} onCheckedChange={(checked) => onOnlyLeadsChange(checked === true)} />
        </label>
        <label data-filter-active={withoutLeadOnly} className="flex h-8 cursor-pointer items-center justify-between gap-2 rounded-[6px] bg-[var(--app-surface-soft)] px-2.5 text-[11px]">
          <span>Sem lead</span>
          <Checkbox checked={withoutLeadOnly} onCheckedChange={(checked) => onWithoutLeadOnlyChange(checked === true)} />
        </label>
        <label data-filter-active={pendingReplyOnly} className="flex h-8 cursor-pointer items-center justify-between gap-2 rounded-[6px] bg-[var(--app-surface-soft)] px-2.5 text-[11px]">
          <span>Sem resposta</span>
          <Checkbox checked={pendingReplyOnly} onCheckedChange={(checked) => onPendingReplyOnlyChange(checked === true)} />
        </label>
      </div>
    </>
  ) : null;

  return (
    <div className={cn(
      "space-y-2 border-b border-[var(--app-border)] bg-[var(--app-surface)] p-2.5",
      isMobile && "shrink-0",
    )}>
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          data-tour="conversations-channel"
          variant="outline"
          size="sm"
          className={cn(
            "h-8 shrink-0 gap-1 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2 text-[length:var(--app-font-size-caption)] font-light shadow-none",
            isWhatsApp && CONVERSATION_LIST_UI.selectedChannel,
          )}
          onClick={onSelectWhatsApp}
        >
          <MessageCircle className="h-3.5 w-3.5" />
          WhatsApp
        </Button>
        {isWhatsApp && (
          <SharedFilters
            datePreset={datePreset}
            onDatePresetChange={(preset) => { onDatePresetChange(preset); if (preset) onWithoutLeadOnlyChange(false); }}
            customDateRange={customDateRange}
            onCustomDateRangeChange={(range) => { onCustomDateRangeChange(range); if (range) onWithoutLeadOnlyChange(false); }}
            defaultDatePreset={null}
            datePosition="start"
            dateLabel="Criação do lead"
            teamId={teamId}
            onTeamChange={(id) => { onTeamChange(id); if (id) onWithoutLeadOnlyChange(false); }}
            userId={userId}
            onUserChange={(id) => { onUserChange(id); if (id) onWithoutLeadOnlyChange(false); }}
            scopeTeams={options?.teams ?? []}
            scopeUsers={options?.users ?? []}
            scopeOptionsReady={Boolean(options) && !optionsLoading}
            scopeOptionsLoading={optionsLoading}
            showEmptyScopeFilters
            includeUnassignedUserOption
            pipelineId={pipelineId}
            onPipelineChange={(id) => { onPipelineChange(id); if (id) onWithoutLeadOnlyChange(false); }}
            pipelines={options?.pipelines ?? []}
            source={leadSource}
            onSourceChange={(source) => { onLeadSourceChange(source); if (source) onWithoutLeadOnlyChange(false); }}
            dynamicSources={options?.sources.map((source) => ({ value: source, label: source })) ?? []}
            isLoadingSources={optionsLoading}
            pageId={pageId}
            onPageChange={(id) => { onPageChange(id); onCampaignsChange([]); if (id) onWithoutLeadOnlyChange(false); }}
            pages={options?.pages ?? []}
            isLoadingPages={optionsLoading}
            campaignId={null}
            onCampaignChange={() => {}}
            campaignIds={campaignIds}
            onCampaignsChange={(ids) => { onCampaignsChange(ids); if (ids.length) onWithoutLeadOnlyChange(false); }}
            campaigns={options?.campaigns ?? []}
            isLoadingCampaigns={optionsLoading}
            hasCampaignsError={optionsError}
            adSetId={adSetId}
            onAdSetChange={(id) => { onAdSetChange(id); if (id) onWithoutLeadOnlyChange(false); }}
            adId={adId}
            onAdChange={(id) => { onAdChange(id); if (id) onWithoutLeadOnlyChange(false); }}
            adSets={options?.adSets ?? []}
            ads={options?.ads ?? []}
            tagIds={tagIds}
            onTagsChange={(ids) => { onTagsChange(ids); if (ids.length) onWithoutLeadOnlyChange(false); }}
            tags={options?.tags.map((tag) => ({ ...tag, color: tag.color || "#6b7280" })) ?? []}
            isLoadingTags={optionsLoading}
            hasTagsError={optionsError}
            dealStatus={dealStatus}
            onDealStatusChange={(status) => { onDealStatusChange(status); if (status) onWithoutLeadOnlyChange(false); }}
            searchQuery=""
            onSearchChange={() => {}}
            hideSearch
            onClear={onClearFilters}
            hasActiveFilters={activeFilterCount > 0}
            hasAdvancedContentFilters={showArchived || onlyLeads || withoutLeadOnly || pendingReplyOnly || currentChannelValue !== "whatsapp-all"}
            advancedContent={advancedContent}
            leadFiltersPaused={withoutLeadOnly}
            advancedFilterCount={[showArchived, onlyLeads, withoutLeadOnly, pendingReplyOnly, currentChannelValue !== "whatsapp-all", Boolean(searchTerm.trim())].filter(Boolean).length}
            hasDynamicOptionsError={optionsError || (filtersOpen && !optionsLoading && !options)}
            isRetryingDynamicOptions={optionsRetrying}
            onRetryDynamicOptions={onRetryOptions}
            onFiltersOpenChange={(open) => { setFiltersOpen(open); onFiltersOpenChange(open); }}
            loadDynamicOptions={filtersOpen}
            tourPrefix="conversations"
            triggerClassName="min-w-0 shrink-0"
            clearButtonClassName={CONVERSATION_LIST_UI.clear}
          />
        )}
      </div>

      <div data-tour="conversations-search" className="relative">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Buscar conversas"
          placeholder={isWhatsApp ? "Nome, telefone ou última mensagem..." : "Buscar no Instagram/Meta..."}
          maxLength={180}
          value={searchTerm}
          onChange={(event) => onSearchTermChange(event.target.value)}
          className={CONVERSATION_LIST_UI.search}
        />
      </div>
    </div>
  );
}
