import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type UIEvent } from 'react';
import type { StageWithLeads } from '@/hooks/use-stages';

export type PipelineBoardScrollMemory = {
  readonly left: number;
  readonly mobileStageId?: string;
  getColumnTop: (stageId: string) => number;
  rememberLeft: (value: number) => void;
  rememberColumnTop: (stageId: string, value: number) => void;
  rememberMobileStage: (stageId: string) => void;
};

// The QueryClient belongs to the current tab and access. Only UI offsets and
// column IDs are kept here; the canonical board key includes the session.
const positionsByClient = new WeakMap<QueryClient, Map<string, PipelineBoardScrollMemory>>();

export function getPipelineBoardScrollMemory(client: QueryClient, boardKey: string, isMobile: boolean) {
  let boards = positionsByClient.get(client);
  if (!boards) {
    boards = new Map();
    positionsByClient.set(client, boards);
  }
  const key = JSON.stringify([boardKey, isMobile]);
  let memory = boards.get(key);
  if (!memory) {
    let left = 0;
    let mobileStageId: string | undefined;
    const columns = new Map<string, number>();
    memory = {
      get left() { return left; },
      get mobileStageId() { return mobileStageId; },
      getColumnTop: stageId => columns.get(stageId) ?? 0,
      rememberLeft: value => { left = value; },
      rememberColumnTop: (stageId, value) => { columns.set(stageId, value); },
      rememberMobileStage: stageId => { mobileStageId = stageId; },
    };
    boards.set(key, memory);
  }
  return memory;
}

type PipelineBoardNavigationOptions = {
  filteredStages: StageWithLeads[];
  pipelineBoardQueryKeyId: string;
  isMobile: boolean;
  shouldLoadPipelineLeads: boolean;
};

export function usePipelineBoardNavigation({
  filteredStages,
  pipelineBoardQueryKeyId,
  isMobile,
  shouldLoadPipelineLeads,
}: PipelineBoardNavigationOptions) {
  const queryClient = useQueryClient();
  const scrollMemory = useMemo(
    () => shouldLoadPipelineLeads ? getPipelineBoardScrollMemory(queryClient, pipelineBoardQueryKeyId, isMobile) : null,
    [isMobile, pipelineBoardQueryKeyId, queryClient, shouldLoadPipelineLeads],
  );
  const [mobileStageSelection, setMobileStageSelection] = useState<{
    memory: typeof scrollMemory;
    stageId: string;
  } | null>(null);
  const activeMobileStageId = mobileStageSelection?.memory === scrollMemory
    ? mobileStageSelection?.stageId
    : scrollMemory?.mobileStageId;

  const visibleStages = useMemo<StageWithLeads[]>(() => {
    if (!isMobile) return filteredStages;
    const activeStage = filteredStages.find((stage) => stage.id === activeMobileStageId);
    return activeStage ? [activeStage] : filteredStages.slice(0, 1);
  }, [isMobile, filteredStages, activeMobileStageId]);

  const activeMobileStageIndex = useMemo(() => {
    if (!isMobile || filteredStages.length === 0) return -1;

    const activeStageId = activeMobileStageId || filteredStages[0].id;
    const index = filteredStages.findIndex((stage) => stage.id === activeStageId);
    return index >= 0 ? index : 0;
  }, [isMobile, filteredStages, activeMobileStageId]);

  const hasPreviousMobileStage = isMobile && activeMobileStageIndex > 0;
  const hasNextMobileStage = isMobile && activeMobileStageIndex >= 0 && activeMobileStageIndex < filteredStages.length - 1;

  const handleMobileStageNavigation = useCallback((direction: 'previous' | 'next') => {
    if (!isMobile || filteredStages.length === 0 || activeMobileStageIndex < 0) return;

    const nextIndex = direction === 'previous'
      ? Math.max(0, activeMobileStageIndex - 1)
      : Math.min(filteredStages.length - 1, activeMobileStageIndex + 1);

    if (nextIndex === activeMobileStageIndex) return;
    const stageId = filteredStages[nextIndex].id;
    scrollMemory?.rememberMobileStage(stageId);
    setMobileStageSelection({ memory: scrollMemory, stageId });
  }, [activeMobileStageIndex, filteredStages, isMobile, scrollMemory]);

  return { scrollMemory, visibleStages, hasPreviousMobileStage, hasNextMobileStage, handleMobileStageNavigation };
}

type RestoredOffset = { applied: number; pending: boolean };
const COLUMN_SELECTOR = '[data-pipeline-drop-column]';

export function usePipelineBoardScroll(
  memory: PipelineBoardScrollMemory | null,
  ready: boolean,
  visibleColumns: readonly unknown[],
  layoutWidth: number,
  layoutHeight: number,
) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const restored = useRef(new WeakMap<HTMLElement, RestoredOffset>());

  useLayoutEffect(() => {
    restored.current = new WeakMap();
  }, [memory, ready]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !memory || !ready) return;

    const restore = (element: HTMLElement, offset: number, axis: 'scrollTop' | 'scrollLeft') => {
      const previous = restored.current.get(element);
      if (previous && !previous.pending) return;
      element[axis] = offset;
      const applied = element[axis];
      // An incomplete column may not yet reach the saved position.
      restored.current.set(element, { applied, pending: Math.abs(applied - offset) > 1 });
    };

    restore(viewport, memory.left, 'scrollLeft');
    for (const column of viewport.querySelectorAll<HTMLElement>(COLUMN_SELECTOR)) {
      const stageId = column.dataset.pipelineDropColumn;
      if (stageId) restore(column, memory.getColumnTop(stageId), 'scrollTop');
    }
  }, [memory, ready, visibleColumns, layoutWidth, layoutHeight]);

  const onScrollCapture = (event: UIEvent<HTMLDivElement>) => {
    if (!memory || !ready || !(event.target instanceof HTMLElement)) return;
    const element = event.target;
    const isViewport = element === viewportRef.current;
    const stageId = element.dataset.pipelineDropColumn;
    if (!isViewport && !stageId) return;

    const offset = Math.max(0, isViewport ? element.scrollLeft : element.scrollTop);
    const previous = restored.current.get(element);
    // Keep the saved offset when the browser reports a temporary clamp.
    if (!previous || (previous.pending && offset === previous.applied)) return;
    restored.current.set(element, { applied: offset, pending: false });
    if (isViewport) memory.rememberLeft(offset);
    else if (stageId) memory.rememberColumnTop(stageId, offset);
  };

  return { viewportRef, onScrollCapture };
}
