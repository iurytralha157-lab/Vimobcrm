import type { DragStart, DropResult } from '@hello-pangea/dnd';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
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
import { getPipelineBoardLayout, PIPELINE_LAYOUT } from '@/config/pipeline-layout';
import type { PipelineLead, StageWithLeads } from '@/hooks/use-stages';
import { cn } from '@/lib/utils';

import { type StageCountMeta } from './model';
import { PipelineDragBoard, PipelineDropColumn, PipelineSortableLeadCard } from './PipelineDragBoard';
import styles from './PipelineBoard.module.css';
import { StageColumnMenu } from './StageColumnMenu';
import type { StageSettingsTab } from '@/components/features/pipelines/StageSettingsDialog';

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
  pendingMoveLeadIds?: ReadonlySet<string>;
  nowMs: number;
  editingStageId: string | null;
  editingStageName: string;
  savingStageNameId: string | null;
  loadMoreIsPending: boolean;
  loadingMoreStageId?: string;
  onDragStart: (start: DragStart) => void;
  onDragEnd: (result: DropResult) => void;
  onCriticalLoadRetry: () => void;
  onBoardRefresh: () => void;
  onMobileStageNavigation: (direction: 'previous' | 'next') => void;
  onEditingStageNameChange: (name: string) => void;
  onStartEditingStage: (stage: StageWithLeads) => void;
  onCommitStageName: (stageId: string) => void;
  onCancelEditingStage: () => void;
  onOpenStageSettings: (stage: StageWithLeads, tab: StageSettingsTab, returnFocusElement: HTMLButtonElement | null) => void;
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
  pendingMoveLeadIds,
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
  const boardRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const pendingSizeRef = useRef<{ width: number; height: number } | null>(null);
  const [boardSize, setBoardSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    // CSS containment would change the fixed-position coordinate system used
    // by Draggable. Measure the board directly, including sidebar/height changes.
    const element = boardRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const next = {
        width: Math.floor(entry.contentRect.width),
        height: Math.floor(entry.contentRect.height),
      };
      if (draggingRef.current) {
        // DnD has already captured its dimensions; apply this resize after drop.
        pendingSizeRef.current = next;
        return;
      }
      setBoardSize((current) => current.width === next.width && current.height === next.height ? current : next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const layout = getPipelineBoardLayout(boardSize.width, boardSize.height, isMobile, visibleStages.length);
  const layoutStyle = {
    '--pipeline-column-width': `${layout.columnWidth}px`,
    '--pipeline-column-gap': `${layout.columnGap}px`,
    '--pipeline-card-padding': `${layout.cardPadding}px`,
    '--pipeline-card-gap': `${layout.cardGap}px`,
    '--pipeline-list-padding': `${layout.listPadding}px`,
    '--pipeline-header-padding': `${layout.headerPadding}px`,
    '--pipeline-mobile-navigation-touch-size': `${PIPELINE_LAYOUT.mobileNavigationTouchSizePx}px`,
    '--pipeline-mobile-navigation-surface-size': `${PIPELINE_LAYOUT.mobileNavigationSurfaceSizePx}px`,
    '--pipeline-mobile-navigation-edge-inset': `${PIPELINE_LAYOUT.mobileNavigationEdgeInsetPx}px`,
    '--pipeline-mobile-navigation-stack-level': PIPELINE_LAYOUT.mobileNavigationStackLevel,
  } as CSSProperties;

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

      <div ref={boardRef} className={cn('relative flex min-h-0 flex-1 flex-col', styles.board)} style={layoutStyle}>
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

        <PipelineDragBoard
          stages={visibleStages}
          disabled={isDragDisabled || isMobile}
          onDragStart={(start) => {
            draggingRef.current = true;
            onDragStart(start);
          }}
          onDragEnd={(result) => {
            draggingRef.current = false;
            onDragEnd(result);
            if (pendingSizeRef.current) {
              setBoardSize(pendingSizeRef.current);
              pendingSizeRef.current = null;
            }
          }}
          renderOverlay={(leadId) => {
            const lead = visibleStages.flatMap(stage => stage.leads).find(item => item.id === leadId);
            // The body portal preserves the card's shell typography without inheriting shell layout.
            return lead ? <div style={{ ...layoutStyle, fontWeight: 'var(--app-font-weight-body)' }}
              className="[&_.font-light]:[font-weight:var(--app-font-weight-body)] [&_.font-normal]:[font-weight:var(--app-font-weight-body)] [&_.font-medium]:[font-weight:var(--app-font-weight-emphasis)] [&_h4]:[line-height:var(--app-line-height-title)]"><LeadCard lead={lead} index={0} onClick={onOpenLead} onAssignNow={onAssignLeadNow}
              isDragDisabled hasWhatsAppModule={hasWhatsAppModule} canViewWhatsApp={canViewWhatsApp}
              canOperateWhatsApp={canOperateWhatsApp} nowMs={nowMs} className={styles.leadCard}
              dragPresentation={{ innerRef: () => {}, isDragging: true }} /></div> : null;
          }}
        >
          <div
            className={cn(
              'min-h-0 flex-1 scrollbar-thin',
              isMobile
                ? 'overflow-x-visible overflow-y-auto px-1 pb-2'
                : 'overflow-x-auto overflow-y-auto px-2 pb-2',
            )}
          >
            <div className={cn('flex h-full', styles.columns, isMobile ? 'min-w-0' : 'min-w-max')}>
              {visibleStages.map((stage, stageIndex) => (
                <div
                  key={stage.id}
                  data-tour={stageIndex === 0 ? 'pipeline-column' : undefined}
                  className={cn(
                    'flex h-full flex-shrink-0 flex-col overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none',
                    isMobile ? styles.mobileColumn : styles.column,
                  )}
                >
                  <div data-pipeline-part="column-header" className={cn('flex shrink-0 items-center justify-between gap-1 border-b border-[var(--app-border)] px-2.5', styles.header)}>
                    <div className={cn('min-w-0 flex-1', styles.heading)}>
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
                          aria-label={`Nome da coluna ${stage.name}`}
                          className="h-7 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2 !text-[12px] font-normal text-foreground shadow-none focus-visible:ring-1 focus-visible:ring-primary/40"
                          autoFocus
                        />
                      ) : canEditPipeline ? (
                        <button
                          type="button"
                          className="min-w-0 flex-1 truncate text-left !text-[12px] font-normal text-foreground outline-none transition-colors hover:text-primary focus-visible:text-primary focus-visible:underline disabled:cursor-wait disabled:opacity-60"
                          onClick={() => onStartEditingStage(stage)}
                          disabled={Boolean(savingStageNameId)}
                          aria-label={`Renomear coluna ${stage.name}`}
                          title={stage.name}
                        >
                          {stage.name}
                        </button>
                      ) : (
                        <h3 title={stage.name} className="min-w-0 flex-1 truncate !text-[12px] font-normal text-foreground">
                          {stage.name}
                        </h3>
                      )}
                      {stage.is_qualified ? (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge
                                  variant="secondary"
                                  aria-label="Etapa de lead qualificado"
                                  tabIndex={0}
                                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border-0 bg-[var(--app-surface-hover)] p-0 text-[var(--app-text-primary)] shadow-none"
                                >
                                  <Target
                                    className="h-3 w-3 text-primary"
                                    aria-hidden="true"
                                  />
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent className="app-header-popover rounded-[8px] text-foreground">
                                <p className="text-[12px] font-light">
                                  Etapa qualificada desta pipeline
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                      ) : null}
                      <Badge
                        data-pipeline-part="stage-count"
                        variant="secondary"
                        className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-[4px] border-0 bg-[var(--app-surface-soft)] px-1.5 py-0 !text-[12px] font-light text-muted-foreground shadow-none"
                      >
                        {stageCountMetaMap.get(stage.id)?.total ??
                          stage.total_lead_count ??
                          stage.leads.length ??
                          0}
                        {stageCountMetaMap.get(stage.id)?.isCountEstimate ? '+' : ''}
                      </Badge>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <StageColumnMenu
                        stageName={stage.name}
                        isMobile={isMobile}
                        tourTarget={stageIndex === 0 ? 'pipeline-column-settings' : undefined}
                        onSelect={(tab, returnFocusElement) => onOpenStageSettings(stage, tab, returnFocusElement)}
                      />
                    </div>
                  </div>

                  <PipelineDropColumn stage={stage} className={cn('flex min-h-0 flex-1 flex-col overflow-y-auto', styles.leadList)}>
                          {isInitialLeadsLoading
                            ? Array.from({ length: 3 }).map((_, index) => (
                                <div
                                  key={index}
                                  className="h-24 w-full animate-pulse rounded-[6px] bg-[var(--app-surface-soft)]"
                                />
                              ))
                            : stage.leads.map((lead, index) => (
                                <PipelineSortableLeadCard
                                  key={lead.id}
                                  stageId={stage.id}
                                  tourTarget={
                                    stageIndex === 0 && index === 0
                                      ? 'pipeline-lead-card'
                                      : undefined
                                  }
                                  lead={lead}
                                  className={styles.leadCard}
                                  index={index}
                                  onClick={onOpenLead}
                                  onAssignNow={onAssignLeadNow}
                                  isDragDisabled={isDragDisabled || isMobile || lead.can_operate !== true}
                                  isMovePending={pendingMoveLeadIds?.has(lead.id) ?? false}
                                  hasWhatsAppModule={hasWhatsAppModule}
                                  canViewWhatsApp={canViewWhatsApp}
                                  canOperateWhatsApp={canOperateWhatsApp}
                                  nowMs={nowMs}
                                />
                              ))}
                  </PipelineDropColumn>
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
                        Carregar mais{!stageCountMetaMap.get(stage.id)?.isCountEstimate
                          && (stageCountMetaMap.get(stage.id)?.remaining ?? 0) > 0
                          ? ` (${stageCountMetaMap.get(stage.id)!.remaining} restantes)` : ''}
                      </Button>
                    </div>
                  )}
                </div>
              ))}

              {canShowColumnActions && (
                <button
                  type="button"
                  onClick={onCreateStage}
                  className={cn('group flex h-full flex-shrink-0 items-center justify-center rounded-[8px] border border-dashed border-[var(--app-border)] bg-transparent text-muted-foreground opacity-60 outline-none transition-colors duration-200 hover:border-primary/40 hover:bg-[var(--app-surface-soft)] hover:text-primary hover:opacity-100 focus-visible:ring-1 focus-visible:ring-primary/30', styles.column, styles.createColumn)}
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
        </PipelineDragBoard>
        {hasPipelineBoardError && (
          <div
            role="alert"
            className="mx-1 mt-2 flex min-w-0 shrink-0 flex-wrap items-center gap-2 rounded-[8px] bg-amber-500/12 px-16 py-2 text-[11px] font-light text-amber-700 ring-1 ring-amber-500/25 dark:text-amber-200 md:mx-2"
          >
            <div className="flex min-w-0 items-center gap-2">
              <RefreshCw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0">Os dados podem estar desatualizados.</span>
            </div>
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
        {isMobile && filteredStages.length > 1 && !hasCriticalLoadError && !isPipelineBoardTransitioning && (
          <nav className={styles.mobileNavigation} aria-label="Navegar entre as etapas da Pipeline">
            <button
              type="button"
              aria-label="Ver coluna anterior"
              className={styles.mobileNavigationButton}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onMobileStageNavigation('previous');
              }}
              disabled={!hasPreviousMobileStage}
            >
              <span className={styles.mobileNavigationSurface} aria-hidden="true">
                <ChevronLeft className="h-[18px] w-[18px]" />
              </span>
            </button>
            <button
              type="button"
              aria-label="Ver próxima coluna"
              className={styles.mobileNavigationButton}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onMobileStageNavigation('next');
              }}
              disabled={!hasNextMobileStage}
            >
              <span className={styles.mobileNavigationSurface} aria-hidden="true">
                <ChevronRight className="h-[18px] w-[18px]" />
              </span>
            </button>
          </nav>
        )}
      </div>
    </>
  );
}
