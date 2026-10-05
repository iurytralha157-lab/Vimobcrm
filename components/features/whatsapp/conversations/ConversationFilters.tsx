import { useState } from "react";
import { MessageCircle, Search } from "lucide-react";

import { SharedFilters } from "@/components/shared/SharedFilters";
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

  const advancedContent = isWhatsApp ? (
    <>
      {(sessions?.length ?? 0) > 1 && (
        <Select value={currentChannelValue} onValueChange={onChannelChange}>
          <SelectTrigger aria-label="Filtrar por conta WhatsApp" className="h-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] shadow-none">
            <SelectValue placeholder="Todas as contas" />
          </SelectTrigger>
          <SelectContent className="z-[140] bg-popover">
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
        <label data-tour="conversations-archived" className="flex h-8 cursor-pointer items-center justify-between gap-2 rounded-[6px] bg-[var(--app-surface-soft)] px-2.5 text-[11px]">
          <span>Arquivadas</span>
          <Checkbox checked={showArchived} onCheckedChange={(checked) => onShowArchivedChange(checked === true)} />
        </label>
        <label className="flex h-8 cursor-pointer items-center justify-between gap-2 rounded-[6px] bg-[var(--app-surface-soft)] px-2.5 text-[11px]">
          <span>Somente leads</span>
          <Checkbox checked={onlyLeads} onCheckedChange={(checked) => onOnlyLeadsChange(checked === true)} />
        </label>
        <label className="flex h-8 cursor-pointer items-center justify-between gap-2 rounded-[6px] bg-[var(--app-surface-soft)] px-2.5 text-[11px]">
          <span>Sem lead</span>
          <Checkbox checked={withoutLeadOnly} onCheckedChange={(checked) => onWithoutLeadOnlyChange(checked === true)} />
        </label>
        <label className="flex h-8 cursor-pointer items-center justify-between gap-2 rounded-[6px] bg-[var(--app-surface-soft)] px-2.5 text-[11px]">
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
            "h-8 shrink-0 gap-1 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2 text-[10px] font-light shadow-none",
            isWhatsApp && "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground",
          )}
          onClick={onSelectWhatsApp}
        >
          <MessageCircle className="h-3.5 w-3.5" />
          WhatsApp
        </Button>
        {isWhatsApp && (
          <SharedFilters
            datePreset={datePreset}
            onDatePresetChange={onDatePresetChange}
            customDateRange={customDateRange}
            onCustomDateRangeChange={onCustomDateRangeChange}
            defaultDatePreset={null}
            datePosition="start"
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
            adSetId={null}
            onAdSetChange={() => {}}
            adId={null}
            onAdChange={() => {}}
            showAdFilters={false}
            tagIds={tagIds}
            onTagsChange={(ids) => { onTagsChange(ids); if (ids.length) onWithoutLeadOnlyChange(false); }}
            tags={options?.tags.map((tag) => ({ ...tag, color: "#ff4b3a" })) ?? []}
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
            hasDynamicOptionsError={optionsError || (filtersOpen && !optionsLoading && !options)}
            isRetryingDynamicOptions={optionsRetrying}
            onRetryDynamicOptions={onRetryOptions}
            onFiltersOpenChange={(open) => { setFiltersOpen(open); onFiltersOpenChange(open); }}
            loadDynamicOptions={filtersOpen}
            tourPrefix="conversations"
            triggerClassName="min-w-0 shrink-0 border-0 bg-[var(--app-surface-soft)] px-2 text-[10px] text-[var(--app-text-primary)] hover:bg-[var(--app-surface-hover)]"
          />
        )}
      </div>

      <div data-tour="conversations-search" className="relative">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Buscar conversas"
          placeholder={isWhatsApp ? "Buscar conversas..." : "Buscar no Instagram/Meta..."}
          value={searchTerm}
          onChange={(event) => onSearchTermChange(event.target.value)}
          className="h-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)] py-0 pl-8 pr-3 text-xs shadow-none focus-visible:ring-1 focus-visible:ring-white/[0.09] focus-visible:ring-offset-0"
        />
      </div>
    </div>
  );
}
