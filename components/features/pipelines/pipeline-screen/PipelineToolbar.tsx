import {
  BellRing,
  Check,
  ChevronDown,
  LayoutGrid,
  Plus,
  RefreshCw,
  Settings,
  Trash2,
} from 'lucide-react';

import { SharedFilters } from '@/components/shared/SharedFilters';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { DatePreset } from '@/hooks/use-dashboard-filters';
import { cn } from '@/lib/utils';

import type { PipelineSummary } from './model';

type FilterOption = { id: string; name: string };
type SourceOption = { value: string; label: string };
type TagOption = { id: string; name: string; color: string };

type PipelineToolbarProps = {
  pipelines: PipelineSummary[];
  selectedPipelineId: string | null;
  currentPipeline?: PipelineSummary;
  canEditPipeline: boolean;
  canManageAttention: boolean;
  canShowPipelineSettings: boolean;
  canCreateLeads: boolean;
  isMobile: boolean;
  isRefreshing: boolean;
  hasCriticalLoadError: boolean;
  datePreset: DatePreset | null;
  onDatePresetChange: (preset: DatePreset) => void;
  onClearDatePreset: () => void;
  customDateRange: { from: Date; to: Date } | null;
  onCustomDateRangeChange: (range: { from: Date; to: Date } | null) => void;
  teamId: string | null;
  onTeamChange: (teamId: string | null) => void;
  userId: string | null;
  onUserChange: (userId: string | null) => void;
  source: string | null;
  onSourceChange: (source: string | null) => void;
  campaignId: string | null;
  onCampaignChange: (id: string | null) => void;
  adSetId: string | null;
  onAdSetChange: (id: string | null) => void;
  adId: string | null;
  onAdChange: (id: string | null) => void;
  tagIds: string[];
  onTagsChange: (tagIds: string[]) => void;
  dealStatus: string | null;
  onDealStatusChange: (status: string | null) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onClearFilters: () => void;
  hasActiveFilters: boolean;
  dynamicSources: SourceOption[];
  campaigns: FilterOption[];
  adSets: FilterOption[];
  ads: FilterOption[];
  tags: TagOption[];
  isLoadingSources: boolean;
  isLoadingCampaigns: boolean;
  isLoadingAdSets: boolean;
  isLoadingAds: boolean;
  isLoadingTags: boolean;
  hasTagsError: boolean;
  hasDynamicOptionsError: boolean;
  isRetryingDynamicOptions: boolean;
  shouldLoadFilterOptions: boolean;
  onEnableFilterOptions: () => void;
  onRetryDynamicOptions: () => void;
  onSelectPipeline: (pipelineId: string) => void;
  onRequestDeletePipeline: (pipeline: { id: string; name: string }) => void;
  onRequestNewPipeline: () => void;
  onRequestAttentionSettings: () => void;
  onRequestStagesEditor: () => void;
  onRefresh: () => void;
  onCreateLead: () => void;
};

export function PipelineToolbar({
  pipelines,
  selectedPipelineId,
  currentPipeline,
  canEditPipeline,
  canManageAttention,
  canShowPipelineSettings,
  canCreateLeads,
  isMobile,
  isRefreshing,
  hasCriticalLoadError,
  datePreset,
  onDatePresetChange,
  onClearDatePreset,
  customDateRange,
  onCustomDateRangeChange,
  teamId,
  onTeamChange,
  userId,
  onUserChange,
  source,
  onSourceChange,
  campaignId,
  onCampaignChange,
  adSetId,
  onAdSetChange,
  adId,
  onAdChange,
  tagIds,
  onTagsChange,
  dealStatus,
  onDealStatusChange,
  searchQuery,
  onSearchChange,
  onClearFilters,
  hasActiveFilters,
  dynamicSources,
  campaigns,
  adSets,
  ads,
  tags,
  isLoadingSources,
  isLoadingCampaigns,
  isLoadingAdSets,
  isLoadingAds,
  isLoadingTags,
  hasTagsError,
  hasDynamicOptionsError,
  isRetryingDynamicOptions,
  shouldLoadFilterOptions,
  onEnableFilterOptions,
  onRetryDynamicOptions,
  onSelectPipeline,
  onRequestDeletePipeline,
  onRequestNewPipeline,
  onRequestAttentionSettings,
  onRequestStagesEditor,
  onRefresh,
  onCreateLead,
}: PipelineToolbarProps) {
  return (
    <div className={cn('flex flex-col gap-2 px-2 pt-2', isMobile ? 'mb-2' : 'mb-4')}>
      <div className="flex flex-row items-center justify-between gap-2 lg:gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-10 min-w-0 items-center overflow-hidden rounded-[8px] bg-[var(--app-surface-solid)] p-1 text-[var(--app-text-primary)] shadow-none">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  data-tour="pipeline-selector"
                  variant="ghost"
                  className="h-8 min-w-0 gap-2 rounded-[6px] border-0 bg-transparent px-2.5 text-[12px] font-light text-[var(--app-text-primary)] shadow-none transition-colors hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)] focus-visible:ring-1 focus-visible:ring-primary/30"
                >
                  <LayoutGrid className="h-4 w-4 text-primary" />
                  <span className="max-w-[96px] truncate sm:max-w-[200px]">
                    {currentPipeline?.name || 'Pipeline'}
                  </span>
                  <ChevronDown className="h-3 w-3 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                sideOffset={8}
                collisionPadding={12}
                className="app-header-popover w-64 overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-0 text-[var(--app-text-primary)]"
              >
                <p className="px-3 pb-1.5 pt-3 text-[10px] font-light text-muted-foreground">
                  Suas pipelines
                </p>
                <div className="pipeline-selector-scroll max-h-[320px] overflow-y-auto px-1 pb-1">
                  {pipelines.map((pipeline) => (
                    <div
                      key={pipeline.id}
                      role="none"
                      className="group flex min-w-0 items-center gap-1"
                    >
                      <DropdownMenuItem
                        onSelect={() => onSelectPipeline(pipeline.id)}
                        className={cn(
                          'flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-2 rounded-[6px] px-2 py-2 text-[12px] font-light text-muted-foreground outline-none hover:bg-[var(--app-surface-hover)] focus:bg-[var(--app-surface-hover)] focus:text-foreground',
                          pipeline.id === selectedPipelineId &&
                            'bg-[var(--app-surface-soft)] font-normal text-primary focus:text-primary',
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">{pipeline.name}</span>
                        {pipeline.id === selectedPipelineId && (
                          <Check className="h-3.5 w-3.5 shrink-0" />
                        )}
                      </DropdownMenuItem>
                      {canEditPipeline && (
                        <DropdownMenuItem
                          aria-label={`Excluir pipeline ${pipeline.name}`}
                          title={`Excluir pipeline ${pipeline.name}`}
                          onSelect={() =>
                            onRequestDeletePipeline({
                              id: pipeline.id,
                              name: pipeline.name,
                            })
                          }
                          className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-[6px] p-0 text-muted-foreground opacity-100 outline-none transition-colors hover:bg-destructive/10 hover:text-destructive focus:bg-destructive/10 focus:text-destructive sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          <span className="sr-only">Excluir pipeline {pipeline.name}</span>
                        </DropdownMenuItem>
                      )}
                    </div>
                  ))}
                </div>
                {canEditPipeline && (
                  <>
                    <DropdownMenuSeparator className="my-1 bg-[var(--app-border)]" />
                    <DropdownMenuItem
                      onClick={onRequestNewPipeline}
                      className="cursor-pointer rounded-[6px] bg-primary/10 py-2 text-[12px] font-light text-primary hover:bg-primary/15 focus:bg-primary/15 focus:text-primary"
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Nova Pipeline
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {canShowPipelineSettings && (
              <>
                <div className="h-4 w-px bg-[var(--app-border)]" aria-hidden="true" />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-[6px] border-0 bg-transparent text-muted-foreground shadow-none transition-colors hover:bg-[var(--app-surface-hover)] hover:text-foreground focus-visible:ring-1 focus-visible:ring-primary/30"
                      disabled={!selectedPipelineId}
                      title="Configurar pipeline"
                      aria-label="Configurar pipeline"
                    >
                      <Settings className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    className="app-header-popover w-56 rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-1"
                  >
                    {canManageAttention && (
                      <DropdownMenuItem
                        onSelect={onRequestAttentionSettings}
                        className="cursor-pointer rounded-[6px] px-2.5 py-2 text-[12px] font-light focus:bg-[var(--app-surface-hover)]"
                      >
                        <BellRing className="mr-2 h-3.5 w-3.5 text-primary" />
                        Prioridades e atenção
                      </DropdownMenuItem>
                    )}
                    {canEditPipeline && (
                      <DropdownMenuItem
                        onSelect={onRequestStagesEditor}
                        className="cursor-pointer rounded-[6px] px-2.5 py-2 text-[12px] font-light focus:bg-[var(--app-surface-hover)]"
                      >
                        <LayoutGrid className="mr-2 h-3.5 w-3.5 text-[var(--app-text-secondary)]" />
                        Gerenciar colunas
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-nowrap items-center justify-end gap-2">
          <Button
            data-tour="pipeline-refresh"
            variant="outline"
            size="icon"
            className={cn(
              'h-8 w-8 shrink-0 rounded-[6px] border-0 bg-[var(--app-surface-solid)] text-muted-foreground shadow-none transition-colors hover:bg-[var(--app-surface-hover)] hover:text-foreground',
              isRefreshing && 'bg-primary/10 text-primary',
            )}
            onClick={onRefresh}
            disabled={isRefreshing || !selectedPipelineId || hasCriticalLoadError}
            title="Atualizar pipeline"
            aria-label="Atualizar pipeline"
          >
            <RefreshCw
              className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')}
            />
          </Button>

          <div data-tour="pipeline-filters">
            <SharedFilters
              datePreset={datePreset}
              onDatePresetChange={onDatePresetChange}
              onClearDatePreset={onClearDatePreset}
              customDateRange={customDateRange}
              onCustomDateRangeChange={onCustomDateRangeChange}
              defaultDatePreset={null}
              teamId={teamId}
              onTeamChange={onTeamChange}
              userId={userId}
              onUserChange={onUserChange}
              source={source}
              onSourceChange={onSourceChange}
              campaignId={campaignId}
              onCampaignChange={onCampaignChange}
              adSetId={adSetId}
              onAdSetChange={onAdSetChange}
              adId={adId}
              onAdChange={onAdChange}
              tagIds={tagIds}
              onTagsChange={onTagsChange}
              dealStatus={dealStatus}
              onDealStatusChange={onDealStatusChange}
              searchQuery={searchQuery}
              onSearchChange={onSearchChange}
              onClear={onClearFilters}
              hasActiveFilters={hasActiveFilters}
              dynamicSources={dynamicSources}
              campaigns={campaigns}
              adSets={adSets}
              ads={ads}
              tags={tags}
              isLoadingSources={isLoadingSources}
              isLoadingCampaigns={isLoadingCampaigns}
              isLoadingAdSets={isLoadingAdSets}
              isLoadingAds={isLoadingAds}
              isLoadingTags={isLoadingTags}
              hasTagsError={hasTagsError}
              hasDynamicOptionsError={hasDynamicOptionsError}
              isRetryingDynamicOptions={isRetryingDynamicOptions}
              onRetryDynamicOptions={onRetryDynamicOptions}
              loadDynamicOptions={shouldLoadFilterOptions}
              onFiltersOpenChange={(open) => {
                if (open) onEnableFilterOptions();
              }}
              tourPrefix="pipeline"
              mobileIconOnly
              triggerClassName="!text-[10px] !font-light !leading-[15px]"
            />
          </div>

          {!isMobile && canCreateLeads && (
            <Button
              data-tour="pipeline-new-lead"
              size="sm"
              className="h-8 rounded-[6px] bg-primary/50 px-4 text-[12px] font-light text-white shadow-none transition-colors hover:bg-primary focus-visible:ring-1 focus-visible:ring-primary/40"
              onClick={onCreateLead}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Novo Lead
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
