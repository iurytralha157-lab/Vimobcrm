import type { DropResult } from '@hello-pangea/dnd';
import { DragDropContext, Droppable } from '@hello-pangea/dnd';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Target,
} from 'lucide-react';

import { LeadCard } from '@/components/features/leads/LeadCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { PIPELINE_STAGE_COLOR_FALLBACK } from '@/config/pipeline-stage-colors';
import type { PipelineLead, StageWithLeads } from '@/hooks/use-stages';
import { cn } from '@/lib/utils';

import {
  formatCompactCurrency,
  PIPELINE_AUTO_SCROLLER_OPTIONS,
  type StageCountMeta,
} from './model';

type PipelineBoardProps = {
  stages: StageWithLeads[];
  filteredStages: StageWithLeads[];
  visibleStages: StageWithLeads[];
  stageValueMap: Map<string, { totalValue: number }>;
  stageCountMetaMap: Map<string, StageCountMeta>;
  selectedPipelineId: string | null;
  isMobile: boolean;
  isLoading: boolean;
  isInitialLeadsLoading: boolean;
  isPipelineBoardTransitioning: boolean;
  leadsPlaceholderData: boolean;
  hasCriticalLoadError: boolean;
  hasPipelineBoardError: boolean;
  isRefreshing: boolean;
  pipelinesFetching: boolean;
  leadVisibilityFetching: boolean;
  hasPreviousMobileStage: boolean;
  hasNextMobileStage: boolean;
  canEditPipeline: boolean;
  hasWhatsAppModule: boolean;
  canViewWhatsApp: boolean;
  canOperateWhatsApp: boolean;
  canShowColumnActions: boolean;
  isDragDisabled: boolean;
  nowMs: number;
  editingStageId: string | null;
  editingStageName: string;
  savingStageNameId: string | null;
  loadMoreIsPending: boolean;
  loadingMoreStageId?: string;
  onDragStart: () => void;
  onDragEnd: (result: DropResult) => void;
  onCriticalLoadRetry: () => void;
  onBoardRefresh: () => void;
  onMobileStageNavigation: (direction: 'previous' | 'next') => void;
  onEditingStageNameChange: (name: string) => void;
  onStartEditingStage: (stage: StageWithLeads) => void;
  onCommitStageName: (stageId: string) => void;
  onCancelEditingStage: () => void;
  onOpenStageSettings: (stage: StageWithLeads) => void;
  onOpenLead: (lead: PipelineLead | { id: string }) => void;
  onAssignLeadNow: (leadId: string) => void;
  onLoadMore: (stageId: string) => void;
  onCreateStage: () => void;
  onCreatePipeline: () => void;
};

export function PipelineBoard({
  stages,
  filteredStages,
  visibleStages,
  stageValueMap,
  stageCountMetaMap,
  selectedPipelineId,
  isMobile,
  isLoading,
  isInitialLeadsLoading,
  isPipelineBoardTransitioning,
  leadsPlaceholderData,
  hasCriticalLoadError,
  hasPipelineBoardError,
  isRefreshing,
  pipelinesFetching,
  leadVisibilityFetching,
  hasPreviousMobileStage,
  hasNextMobileStage,
  canEditPipeline,
  hasWhatsAppModule,
  canViewWhatsApp,
  canOperateWhatsApp,
  canShowColumnActions,
  isDragDisabled,
  nowMs,
  editingStageId,
  editingStageName,
  savingStageNameId,
  loadMoreIsPending,
  loadingMoreStageId,
  onDragStart,
  onDragEnd,
  onCriticalLoadRetry,
  onBoardRefresh,
  onMobileStageNavigation,
  onEditingStageNameChange,
  onStartEditingStage,
  onCommitStageName,
  onCancelEditingStage,
  onOpenStageSettings,
  onOpenLead,
  onAssignLeadNow,
  onLoadMore,
  onCreateStage,
  onCreatePipeline,
}: PipelineBoardProps) {
  return (
    <>
      {!hasCriticalLoadError && stages.length === 0 && (
        <Card
          role="status"
          aria-live="polite"
          className="app-card mx-2 rounded-[8px] shadow-none"
        >
          <CardContent className="py-12 text-center">
            <h3 className="mb-1 text-[14px] font-normal text-foreground">
              {isLoading
                ? 'Carregando estrutura do pipeline'
                : selectedPipelineId
                  ? 'Nenhum estágio configurado'
                  : 'Nenhuma pipeline configurada'}
            </h3>
            <p className="text-[12px] font-light leading-[18px] text-muted-foreground">
              {isLoading
                ? 'Buscando pipelines e colunas disponíveis.'
                : selectedPipelineId
                  ? 'Configure os estágios do pipeline nas configurações'
                  : 'Crie uma pipeline antes de adicionar colunas.'}
            </p>
            {!isLoading && !selectedPipelineId && canEditPipeline && (
              <Button
                type="button"
                size="sm"
                className="mt-4 h-9 rounded-[6px] bg-primary/50 px-4 text-[12px] font-light text-white shadow-none hover:bg-primary"
                onClick={onCreatePipeline}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Criar primeira pipeline
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <div className="relative flex min-h-0 flex-1 flex-col">
        {hasCriticalLoadError && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-[var(--app-bg)] px-4">
            <div
              role="alert"
              className="app-card flex w-full max-w-md flex-col items-center gap-3 rounded-[8px] px-5 py-8 text-center shadow-none"
            >
              <RefreshCw className="h-6 w-6 text-destructive" aria-hidden="true" />
              <div className="space-y-1">
                <h3 className="text-[14px] font-normal text-[var(--app-text-primary)]">
                  Não foi possível carregar a pipeline
                </h3>
                <p className="text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
                  Verifique sua conexão e tente novamente. Nenhum dado foi tratado como lista vazia.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                className="h-9 rounded-[6px] bg-primary/50 px-3 text-[12px] font-light text-white shadow-none hover:bg-primary"
                onClick={onCriticalLoadRetry}
                disabled={isRefreshing || pipelinesFetching || leadVisibilityFetching}
              >
                {(isRefreshing || pipelinesFetching || leadVisibilityFetching) && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                )}
                Tentar novamente
              </Button>
            </div>
          </div>
        )}

        {isPipelineBoardTransitioning && (
          <div
            role="status"
            aria-live="polite"
            aria-busy="true"
            className="absolute inset-0 z-30 flex items-center justify-center bg-[var(--app-bg)]/70"
          >
            <div className="flex items-center gap-2 rounded-[8px] bg-[var(--app-surface-solid)] px-4 py-3 text-[12px] font-light text-[var(--app-text-primary)] shadow-none">
              <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
              <span>
                {leadsPlaceholderData ? 'Carregando pipeline...' : 'Carregando leads...'}
              </span>
            </div>
          </div>
        )}

        {hasPipelineBoardError && (
          <div
            role="alert"
            className="absolute right-3 top-2 z-30 flex max-w-[calc(100%-24px)] flex-wrap items-center gap-2 rounded-[8px] bg-amber-500/12 px-3 py-2 text-[11px] font-light text-amber-700 ring-1 ring-amber-500/25 dark:text-amber-200"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Os dados podem estar desatualizados.</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 rounded-[6px] bg-[var(--app-surface-solid)] px-2.5 text-[11px] font-light text-[var(--app-text-primary)] shadow-none hover:bg-[var(--app-surface-hover)]"
              onClick={onBoardRefresh}
              disabled={isRefreshing}
            >
              {isRefreshing ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              )}
              Tentar novamente
            </Button>
          </div>
        )}

        <DragDropContext
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          autoScrollerOptions={PIPELINE_AUTO_SCROLLER_OPTIONS}
        >
          <div
            className={cn(
              'min-h-0 flex-1 scrollbar-thin',
              isMobile
                ? 'overflow-x-visible overflow-y-auto px-1 pb-2'
                : 'overflow-x-auto overflow-y-auto px-2 pb-2',
            )}
          >
            <div className={cn('flex h-full gap-3', isMobile ? 'min-w-0' : 'min-w-max')}>
              {visibleStages.map((stage, stageIndex) => (
                <div
                  key={stage.id}
                  data-tour={stageIndex === 0 ? 'pipeline-column' : undefined}
                  className={cn(
                    'flex h-full flex-shrink-0 flex-col overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none',
                    isMobile ? 'w-full min-w-0' : 'w-[280px] sm:w-72',
                  )}
                >
                  <div className="flex shrink-0 items-center justify-between border-b border-[var(--app-border)] px-3 py-2">
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                      <div
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{
                          backgroundColor:
                            stage.color || PIPELINE_STAGE_COLOR_FALLBACK,
                        }}
                      />
                      {editingStageId === stage.id && canEditPipeline ? (
                        <Input
                          value={editingStageName}
                          onChange={(event) =>
                            onEditingStageNameChange(event.target.value)
                          }
                          onBlur={() => onCommitStageName(stage.id)}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                              event.preventDefault();
                              onCancelEditingStage();
                              return;
                            }
                            if (event.key !== 'Enter') return;
                            event.preventDefault();
                            onCommitStageName(stage.id);
                            event.currentTarget.blur();
                          }}
                          disabled={savingStageNameId === stage.id}
                          aria-busy={savingStageNameId === stage.id}
                          className="h-7 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2 !text-[13px] font-normal text-foreground shadow-none focus-visible:ring-1 focus-visible:ring-primary/40"
                          autoFocus
                        />
                      ) : canEditPipeline ? (
                        <button
                          type="button"
                          className="min-w-0 flex-1 truncate text-left !text-[13px] font-normal text-foreground outline-none transition-colors hover:text-primary focus-visible:text-primary focus-visible:underline disabled:cursor-wait disabled:opacity-60"
                          onClick={() => onStartEditingStage(stage)}
                          disabled={Boolean(savingStageNameId)}
                          aria-label={`Renomear coluna ${stage.name}`}
                        >
                          {stage.name}
                        </button>
                      ) : (
                        <h3 className="min-w-0 flex-1 truncate !text-[13px] font-normal text-foreground">
                          {stage.name}
                        </h3>
                      )}
                      <Badge
                        variant="secondary"
                        className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-[4px] border-0 bg-[var(--app-surface-soft)] px-1.5 py-0 !text-[11px] font-light text-muted-foreground shadow-none"
                      >
                        {stageCountMetaMap.get(stage.id)?.total ??
                          stage.total_lead_count ??
                          stage.leads.length ??
                          0}
                      </Badge>
                      {stage.is_qualified ? (
                        <div className="order-last basis-full pl-4">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge
                                  variant="secondary"
                                  aria-label="Etapa de lead qualificado"
                                  className="flex h-[19px] w-fit items-center gap-1 rounded-[4px] border-0 bg-[var(--app-surface-hover)] px-1.5 py-0 !text-[10px] font-normal text-[var(--app-text-primary)] shadow-none"
                                >
                                  <Target
                                    className="h-2.5 w-2.5 text-primary"
                                    aria-hidden="true"
                                  />
                                  Qualificado
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent className="app-header-popover rounded-[8px] text-foreground">
                                <p className="text-[11px] font-light">
                                  Etapa qualificada desta pipeline
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                      ) : null}
                      {(stageValueMap.get(stage.id)?.totalValue || 0) > 0 ? (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge
                                variant="secondary"
                                className="flex h-[18px] shrink-0 items-center rounded-[4px] border-0 bg-primary/50 px-1.5 py-0 !text-[11px] font-light text-white shadow-none"
                              >
                                {formatCompactCurrency(
                                  stageValueMap.get(stage.id)?.totalValue || 0,
                                )}
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent className="app-header-popover rounded-[8px] text-foreground">
                              <p className="text-[11px] font-light">
                                Valor total dos leads neste estágio
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        data-tour={
                          stageIndex === 0 ? 'pipeline-column-settings' : undefined
                        }
                        aria-label={`Configurar coluna ${stage.name}`}
                        variant="ghost"
                        size="icon"
                        className={cn(
                          'shrink-0 rounded-[6px] text-muted-foreground hover:bg-[var(--app-surface-hover)] hover:text-foreground',
                          isMobile ? 'h-10 w-10' : 'h-6 w-6',
                        )}
                        onClick={() => onOpenStageSettings(stage)}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                      {isMobile && filteredStages.length > 1 && (
                        <>
                          <button
                            type="button"
                            aria-label="Ver coluna anterior"
                            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground outline-none transition-colors hover:bg-primary focus-visible:ring-2 focus-visible:ring-primary/35 disabled:cursor-not-allowed disabled:opacity-35"
                            onClick={() => onMobileStageNavigation('previous')}
                            disabled={!hasPreviousMobileStage}
                          >
                            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            aria-label="Ver próxima coluna"
                            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground outline-none transition-colors hover:bg-primary focus-visible:ring-2 focus-visible:ring-primary/35 disabled:cursor-not-allowed disabled:opacity-35"
                            onClick={() => onMobileStageNavigation('next')}
                            disabled={!hasNextMobileStage}
                          >
                            <ChevronRight className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  <Droppable droppableId={stage.id}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className="flex min-h-0 flex-1 flex-col overflow-hidden"
                      >
                        <div
                          className={cn(
                            'flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
                            snapshot.isDraggingOver && 'bg-[var(--app-surface-soft)]',
                          )}
                        >
                          {isInitialLeadsLoading
                            ? Array.from({ length: 3 }).map((_, index) => (
                                <div
                                  key={index}
                                  className="h-24 w-full animate-pulse rounded-[6px] bg-[var(--app-surface-soft)]"
                                />
                              ))
                            : stage.leads.map((lead, index) => (
                                <LeadCard
                                  key={lead.id}
                                  tourTarget={
                                    stageIndex === 0 && index === 0
                                      ? 'pipeline-lead-card'
                                      : undefined
                                  }
                                  lead={lead}
                                  index={index}
                                  onClick={onOpenLead}
                                  onAssignNow={onAssignLeadNow}
                                  isDragDisabled={isDragDisabled || isMobile}
                                  hasWhatsAppModule={hasWhatsAppModule}
                                  canViewWhatsApp={canViewWhatsApp}
                                  canOperateWhatsApp={canOperateWhatsApp}
                                  nowMs={nowMs}
                                />
                              ))}
                          {provided.placeholder}
                        </div>
                      </div>
                    )}
                  </Droppable>
                  {stageCountMetaMap.get(stage.id)?.canLoadMore && (
                    <div className="px-2 pb-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full rounded-[6px] text-[12px] font-light text-muted-foreground shadow-none hover:bg-[var(--app-surface-hover)] hover:text-foreground"
                        onClick={() => onLoadMore(stage.id)}
                        disabled={loadMoreIsPending}
                      >
                        {loadMoreIsPending && loadingMoreStageId === stage.id ? (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" />
                        ) : (
                          <ChevronDown className="mr-1 h-3 w-3" />
                        )}
                        Carregar mais ({stageCountMetaMap.get(stage.id)?.remaining ?? 0}{' '}
                        restantes)
                      </Button>
                    </div>
                  )}
                </div>
              ))}

              {canShowColumnActions && (
                <button
                  type="button"
                  onClick={onCreateStage}
                  className="group flex h-full min-h-[360px] w-[280px] flex-shrink-0 items-center justify-center rounded-[8px] border border-dashed border-[var(--app-border)] bg-transparent text-muted-foreground opacity-60 outline-none transition-colors duration-200 hover:border-primary/40 hover:bg-[var(--app-surface-soft)] hover:text-primary hover:opacity-100 focus-visible:ring-1 focus-visible:ring-primary/30 sm:w-72"
                  aria-label="Criar nova coluna"
                >
                  <span className="inline-flex items-center gap-2 rounded-[6px] bg-[var(--app-surface-solid)] px-4 py-2 text-[12px] font-light transition-colors group-hover:bg-primary/10">
                    <Plus className="h-4 w-4" />
                    Criar nova coluna
                  </span>
                </button>
              )}
            </div>
          </div>
        </DragDropContext>
      </div>
    </>
  );
}
