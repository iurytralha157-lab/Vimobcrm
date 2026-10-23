import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, memo, type ComponentProps, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, pointerWithin, defaultDropAnimation,
  useDroppable, useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragStartEvent,
  type KeyboardSensorOptions, type KeyboardCoordinateGetter, type DropAnimationFunction, type DropAnimationFunctionArguments,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { DragStart, DropResult } from '@hello-pangea/dnd';
import { LeadCard } from '@/components/features/leads/LeadCard';
import type { StageWithLeads } from '@/hooks/use-stages';
import { pipelineLeadCardPropsEqual } from '@/lib/pipeline-lead-card-clock';

type CardProps = ComponentProps<typeof LeadCard> & { stageId: string };
type KeyboardTarget = { id: string; stageId: string; index: number; kind: string };
type Props = {
  stages: StageWithLeads[];
  disabled: boolean;
  onDragStart: (start: DragStart) => void;
  onDragEnd: (result: DropResult) => void;
  renderOverlay: (leadId: string) => ReactNode;
  children: ReactNode;
};

const collisions: CollisionDetection = args => {
  const hits = pointerWithin(args);
  if (args.pointerCoordinates) {
    const cards = hits.filter(hit => hit.data?.droppableContainer.data.current?.kind === 'lead');
    const columns = hits.filter(hit => hit.data?.droppableContainer.data.current?.kind === 'stage');
    if (cards.length) return cards.slice(0, 1);
    const column = columns[0];
    if (!column) return [];
    const stageId = column.data?.droppableContainer.data.current?.stageId;
    const rows = args.droppableContainers.filter(container => container.id !== args.active.id &&
      container.data.current?.kind === 'lead' && container.data.current.stageId === stageId);
    const rects = rows.map(row => args.droppableRects.get(row.id));
    if (rects.some(rect => !rect)) return [];
    const pointerY = args.pointerCoordinates.y;
    const pipelineInsertionIndex = rects.filter(rect => rect && pointerY > rect.top + rect.height / 2).length;
    return [{ ...column, data: { ...column.data, pipelineInsertionIndex } }];
  }
  return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter(container =>
    container.data.current?.kind === 'lead' || container.data.current?.kind === 'end' || container.data.current?.empty) });
};

const dragTransition = { duration: 160, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' };
const ReducedDragMotion = createContext(false);
const reducedMotionQuery = '(prefers-reduced-motion: reduce)';
const readReducedMotion = () => typeof window !== 'undefined' && window.matchMedia(reducedMotionQuery).matches;
const serverReducedMotion = () => false;
const subscribeReducedMotion = (notify: () => void) => {
  const query = window.matchMedia(reducedMotionQuery);
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
};

// Keep dnd-kit's measured drop geometry, but retire the visual clone when a
// rollback replaces its destination node. No persistence waits for this effect.
function settlePipelineDrop({ active, dragOverlay, transform, ...rest }: DropAnimationFunctionArguments,
  cancellation: { current: (() => void) | null }) {
  if (typeof dragOverlay.node.animate !== 'function') return;
  const final = {
    x: transform.x - (dragOverlay.rect.left - active.rect.left),
    y: transform.y - (dragOverlay.rect.top - active.rect.top),
    scaleX: transform.scaleX === 1 ? 1 : active.rect.width * transform.scaleX / dragOverlay.rect.width,
    scaleY: transform.scaleY === 1 ? 1 : active.rect.height * transform.scaleY / dragOverlay.rect.height,
  };
  const keyframes = defaultDropAnimation.keyframes({ ...rest, active, dragOverlay, transform: { initial: transform, final } });
  if (JSON.stringify(keyframes[0]) === JSON.stringify(keyframes.at(-1))) return;
  const animation = dragOverlay.node.animate(keyframes, { ...dragTransition, fill: 'forwards' });
  const restore = defaultDropAnimation.sideEffects?.({ ...rest, active, dragOverlay });
  return new Promise<void>(resolve => {
    let frame = 0, completed = false;
    const complete = () => {
      if (completed) return;
      completed = true;
      cancelAnimationFrame(frame);
      dragOverlay.node.style.visibility = 'hidden';
      restore?.();
      if (cancellation.current === cancel) cancellation.current = null;
      resolve();
    };
    const cancel = () => { animation.cancel(); complete(); };
    const checkDestination = () => {
      if (!active.node.isConnected || rest.draggableNodes.get(active.id)?.node.current !== active.node) {
        cancel();
        return;
      }
      frame = requestAnimationFrame(checkDestination);
    };
    cancellation.current = cancel;
    animation.addEventListener('finish', complete, { once: true });
    animation.addEventListener('cancel', complete, { once: true });
    frame = requestAnimationFrame(checkDestination);
  });
}

// Navigate by the column/row identities, so the card's decorative rotation
// cannot turn a tiny difference in x into an unintended move within its column.
const pipelineKeyboardCoordinates = (selection: { current: KeyboardTarget | null }): KeyboardCoordinateGetter => (event, { context }) => {
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) return;
  event.preventDefault();
  const containers = context.droppableContainers.getEnabled();
  const selected = selection.current && containers.find(item => item.id === selection.current?.id)?.data.current;
  if (selection.current && !selected) return;
  const current = selected ?? context.over?.data.current ?? context.active?.data.current;
  if (typeof current?.stageId !== 'string') return;
  const columns = containers.filter(item => item.data.current?.kind === 'stage')
    .sort((a, b) => (context.droppableRects.get(a.id)?.left ?? 0) - (context.droppableRects.get(b.id)?.left ?? 0));
  const columnIndex = columns.findIndex(item => item.data.current?.stageId === current.stageId);
  const horizontal = event.code === 'ArrowLeft' || event.code === 'ArrowRight';
  const column = columns[columnIndex + (horizontal ? event.code === 'ArrowRight' ? 1 : -1 : 0)];
  if (!column) return;
  const rows = containers.filter(item => item.data.current?.kind === 'lead' && item.data.current.stageId === column.data.current?.stageId)
    .sort((a, b) => Number(a.data.current?.index) - Number(b.data.current?.index));
  const currentIndex = typeof current.index === 'number' ? current.index : 0;
  const rowIndex = horizontal ? Math.min(currentIndex, rows.length) : currentIndex + (event.code === 'ArrowDown' ? 1 : -1);
  const end = containers.find(item => item.data.current?.kind === 'end' && item.data.current.stageId === column.data.current?.stageId);
  const target = rows.length ? rows[rowIndex] ?? (rowIndex === rows.length ? end : undefined) : horizontal ? column : undefined;
  if (!target) return;
  const rect = context.droppableRects.get(target.id);
  if (!rect) return;
  // The sensor's context.over is updated on React's next layout pass. Keep the
  // requested identity immediately so fast arrows/confirm cannot reuse a row.
  selection.current = { id: String(target.id), stageId: String(column.data.current?.stageId), index: Math.max(rowIndex, 0), kind: String(target.data.current?.kind) };
  const activeRect = context.collisionRect;
  // Center the active card on the selected target. Different card heights and
  // the zero-height terminal slot must not select an adjacent row by distance.
  return {
    x: rect.left + (rect.width - (activeRect?.width ?? rect.width)) / 2,
    y: rect.top + (rect.height - (activeRect?.height ?? rect.height)) / 2,
  };
};

/** dnd-kit observes both the column and board scroll ancestors; the screen's mutation contract stays unchanged. */
export function PipelineDragBoard({ stages, disabled, onDragStart, onDragEnd, renderOverlay, children }: Props) {
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, readReducedMotion, serverReducedMotion);
  const dropCancellation = useRef<(() => void) | null>(null);
  const dropAnimation = useCallback<DropAnimationFunction>(args => settlePipelineDrop(args, dropCancellation), []);
  useEffect(() => () => dropCancellation.current?.(), []);
  useEffect(() => { if (reducedMotion) dropCancellation.current?.(); }, [reducedMotion]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const source = useRef<DragStart | null>(null);
  const keyboardTarget = useRef<KeyboardTarget | null>(null);
  const pointerOptions = useMemo(() => ({ activationConstraint: { distance: 6 } }), []);
  const keyboardOptions = useMemo<KeyboardSensorOptions>(() => ({ coordinateGetter: (event, context) => pipelineKeyboardCoordinates(keyboardTarget)(event, context),
    keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] }, scrollBehavior: 'auto' }), []);
  const sensors = useSensors(
    useSensor(PointerSensor, pointerOptions),
    useSensor(KeyboardSensor, keyboardOptions),
  );
  const begin = (event: DragStartEvent) => {
    const id = String(event.active.id);
    const stage = stages.find(item => item.leads.some(lead => lead.id === id));
    const index = stage?.leads.findIndex(lead => lead.id === id) ?? -1;
    if (disabled || !stage || index < 0 || stage.leads[index].can_operate !== true) return;
    dropCancellation.current?.();
    const start: DragStart = { draggableId: id, type: 'DEFAULT', source: { droppableId: stage.id, index }, mode: event.activatorEvent.type === 'keydown' ? 'SNAP' : 'FLUID' };
    keyboardTarget.current = start.mode === 'SNAP' ? { id, stageId: stage.id, index, kind: 'lead' } : null;
    source.current = start; setActiveId(id); onDragStart(start);
  };
  const finish = (event?: DragEndEvent) => {
    const start = source.current; source.current = null; setActiveId(null);
    const selected = keyboardTarget.current; keyboardTarget.current = null;
    if (!start) return;
    let destination: DropResult['destination'] = null;
    const current = stages.find(stage => stage.id === start.source.droppableId)?.leads.find(lead => lead.id === start.draggableId);
    const data = start.mode === 'SNAP' && selected ? selected : event?.over?.data.current;
    const target = stages.find(stage => stage.id === data?.stageId);
    if (event && !disabled && current?.can_operate === true && target) {
      const targetId = start.mode === 'SNAP' && selected ? selected.id : String(event.over!.id);
      let index = data?.kind === 'lead' ? target.leads.findIndex(lead => lead.id === targetId) : target.leads.length;
      if (start.mode === 'FLUID' && data?.kind === 'stage') {
        const gapIndex = event.collisions?.find(collision => collision.id === event.over!.id)?.data?.pipelineInsertionIndex;
        index = typeof gapIndex === 'number' && Number.isInteger(gapIndex) && gapIndex >= 0 ? gapIndex : -1;
      }
      if (index >= 0) {
        if (start.mode === 'FLUID' && target.id !== start.source.droppableId && data?.kind === 'lead') {
          const rect = event.active.rect.current.translated;
          if (rect && rect.top + rect.height / 2 > event.over!.rect.top + event.over!.rect.height / 2) index += 1;
        }
        destination = { droppableId: target.id, index: Math.min(index, target.leads.length - (target.id === start.source.droppableId ? 1 : 0)) };
      }
    }
    onDragEnd({ ...start, destination, combine: null, reason: event ? 'DROP' : 'CANCEL' });
  };
  const detectCollision: CollisionDetection = args => {
    if (!args.pointerCoordinates && keyboardTarget.current) {
      const selected = args.droppableContainers.find(item => item.id === keyboardTarget.current?.id);
      if (selected && args.droppableRects.has(selected.id)) return [{ id: selected.id }];
      return [];
    }
    return collisions(args);
  };
  return <DndContext sensors={sensors} collisionDetection={detectCollision}
    autoScroll={{ threshold: { x: 0.12, y: 0.18 }, acceleration: 8, interval: 10 }}
    onDragStart={begin} onDragEnd={event => finish(event)} onDragCancel={() => finish()}
    accessibility={{ screenReaderInstructions: { draggable: 'Para mover o lead, pressione Espaço. Use as setas para escolher a posição. Pressione Espaço para confirmar ou Escape para cancelar.' },
      announcements: { onDragStart: ({ active }) => `Movendo lead ${String(active.id)}.`, onDragOver: ({ over }) => over ? 'Nova posição selecionada.' : 'Fora das colunas.', onDragEnd: () => 'Arraste encerrado.', onDragCancel: () => 'Movimento cancelado.' } }}>
    <ReducedDragMotion.Provider value={reducedMotion}>{children}</ReducedDragMotion.Provider>
    {typeof document !== 'undefined' && createPortal(<DragOverlay dropAnimation={reducedMotion ? null : dropAnimation} transition={reducedMotion ? 'none' : undefined} style={{ pointerEvents: 'none' }} zIndex={60}>
      {activeId ? <div inert style={{ pointerEvents: 'none' }}>{renderOverlay(activeId)}</div> : null}
    </DragOverlay>, document.body)}
  </DndContext>;
}

export function PipelineDropColumn({ stage, className, children }: { stage: StageWithLeads; className: string; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `pipeline-stage:${stage.id}`, data: { kind: 'stage', stageId: stage.id, empty: stage.leads.length === 0 } });
  const { setNodeRef: setEndRef } = useDroppable({ id: `pipeline-end:${stage.id}`, data: { kind: 'end', stageId: stage.id, index: stage.leads.length } });
  const items = useMemo(() => stage.leads.map(lead => lead.id), [stage.leads]);
  return <SortableContext items={items} strategy={verticalListSortingStrategy}>
    <div ref={setNodeRef} data-pipeline-drop-column={stage.id} className={className} style={isOver ? { backgroundColor: 'var(--app-surface-soft)' } : undefined}>
      {children}
      {/* A measured terminal position for the keyboard, with no card/gap height. */}
      <div ref={setEndRef} data-pipeline-drop-end={stage.id} aria-hidden style={{ height: 0, flexShrink: 0,
        marginTop: stage.leads.length ? 'calc(-1 * var(--pipeline-card-gap, 6px))' : undefined }} />
    </div>
  </SortableContext>;
}

export const PipelineSortableLeadCard = memo(function PipelineSortableLeadCard({ stageId, ...props }: CardProps) {
  const reducedMotion = useContext(ReducedDragMotion);
  const disabled = props.isDragDisabled || props.lead.can_operate !== true || Boolean(props.lead.queue_pool && !props.lead.assigned_user_id);
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: props.lead.id, disabled: { draggable: disabled, droppable: false }, data: { kind: 'lead', stageId, index: props.index }, transition: reducedMotion ? null : dragTransition });
  const suppressPointerClick = useRef(false);
  useLayoutEffect(() => { if (isDragging) suppressPointerClick.current = true; }, [isDragging]);
  const preparePointerClick = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!isDragging && event.isPrimary && event.button === 0) suppressPointerClick.current = false;
  }, [isDragging]);
  const guardPointerClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    // Escape can end the sensor before mouseup; that residual click must not open the lead.
    if (event.detail > 0 && suppressPointerClick.current) {
      suppressPointerClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    }
  }, []);
  const transformStyle = CSS.Transform.toString(transform);
  const presentation = useMemo(() => ({ innerRef: setNodeRef,
    handleProps: { ...(disabled ? {} : { ...attributes, ...listeners }), onPointerDownCapture: preparePointerClick, onClickCapture: guardPointerClick }, handleRef: setActivatorNodeRef,
    style: { transform: transformStyle, transition: reducedMotion ? 'none' : transition, opacity: isDragging ? 0.25 : undefined },
    isDragging, decorateDragging: false,
  }), [setNodeRef, setActivatorNodeRef, attributes, listeners, transformStyle, transition, isDragging, disabled, reducedMotion, preparePointerClick, guardPointerClick]);
  return <LeadCard {...props} dragPresentation={presentation} />;
}, pipelineLeadCardPropsEqual);
