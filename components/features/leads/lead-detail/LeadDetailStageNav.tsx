import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, ChevronDown, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { LeadDetailStage } from '@/components/features/leads/lead-detail/types';
import { stageTooltipClassName } from '@/components/features/leads/lead-detail/utils';
import { cn } from '@/lib/utils';

/** Above this many stages the rail shows only short bars (names stay in tooltips and in the list). */
const MAX_LABELLED_STAGES = 10;
const ICON = { strokeWidth: 1.5 } as const;

type LeadDetailStageNavProps = {
  stages: LeadDetailStage[];
  activeStageId: string | null | undefined;
  leadName: string;
  /** Days in the current stage, when known. */
  daysInStage: number | null;
  mobile: boolean;
  disabled: boolean;
  portalClassName?: string;
  /** Stages that open their own dialog (e.g. lost reason) skip this confirmation. */
  needsConfirmation: (stage: LeadDetailStage) => boolean;
  onMove: (stageId: string) => void;
};

export function LeadDetailStageNav({
  stages, activeStageId, leadName, daysInStage, mobile, disabled, portalClassName, needsConfirmation, onMove,
}: LeadDetailStageNavProps) {
  const [listOpen, setListOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState<LeadDetailStage | null>(null);
  const currentIndex = stages.findIndex((stage) => stage.id === activeStageId);
  const current = currentIndex >= 0 ? stages[currentIndex] : null;
  const labelled = !mobile && stages.length <= MAX_LABELLED_STAGES;

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('pt-BR');
    return stages
      .map((stage, index) => ({ stage, index }))
      .filter(({ stage }) => !needle || stage.name.toLocaleLowerCase('pt-BR').includes(needle));
  }, [query, stages]);

  // A stage list that changes underneath an open confirmation must not move to a stale target.
  const pendingTarget = pending && stages.some((stage) => stage.id === pending.id) ? pending : null;

  const request = (stage: LeadDetailStage | undefined) => {
    if (!stage || disabled || stage.id === activeStageId) return;
    setListOpen(false);
    if (needsConfirmation(stage)) setPending(stage);
    else onMove(stage.id);
  };

  const confirm = () => {
    const target = pendingTarget;
    setPending(null);
    if (target && !disabled) onMove(target.id);
  };

  const stepButton = 'flex shrink-0 items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)] transition-colors hover:bg-[var(--app-surface-hover)] disabled:opacity-40 disabled:hover:bg-[var(--app-surface-soft)]';
  const stepSize = mobile ? 'h-10 w-10' : 'h-8 w-8';

  const list = (
    <Popover open={listOpen} onOpenChange={(open) => { setListOpen(open && !disabled); if (!open) setQuery(''); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={current ? `Etapa atual: ${current.name}. Escolher outra etapa` : 'Escolher etapa'}
          className={cn('flex min-w-0 items-center gap-1.5 rounded-[6px] bg-[var(--app-surface-soft)] px-2 text-xs font-light transition-colors hover:bg-[var(--app-surface-hover)] disabled:cursor-default', mobile ? 'h-10 flex-1' : 'h-8 max-w-[260px]')}
        >
          {current && (
            <span className="shrink-0 rounded-[4px] bg-primary/50 px-1 text-[10px] text-white">
              {currentIndex + 1}/{stages.length}
            </span>
          )}
          <span className="truncate text-[var(--app-text-primary)]">{current?.name || 'Sem etapa'}</span>
          {daysInStage !== null && <span className="shrink-0 text-[var(--app-text-tertiary)]">· {daysInStage}d</span>}
          <ChevronDown {...ICON} className="ml-auto h-3.5 w-3.5 shrink-0 text-[var(--app-text-tertiary)]" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className={cn('w-72 p-0', portalClassName)}>
        <p className="px-3 pt-3 text-[11px] text-[var(--app-text-tertiary)]">Mover para a etapa</p>
        <label className="m-2 flex h-9 items-center gap-2 rounded-[6px] bg-[var(--app-surface-soft)] px-2.5">
          <Search {...ICON} className="h-3.5 w-3.5 shrink-0 text-primary" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar etapa"
            aria-label="Buscar etapa"
            className={cn('min-w-0 flex-1 bg-transparent font-light outline-none placeholder:text-[var(--app-text-tertiary)]', mobile ? 'text-base' : 'text-xs')}
          />
        </label>
        <div role="listbox" aria-label="Etapas do funil" className="max-h-72 overflow-y-auto p-1">
          {filtered.map(({ stage, index }) => {
            const active = stage.id === activeStageId;
            return (
              <button
                key={stage.id}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => request(stage)}
                className={cn('flex w-full items-center gap-2 rounded-[6px] px-2 text-left text-xs font-light hover:bg-[var(--app-surface-soft)]', mobile ? 'min-h-10' : 'min-h-8', active && 'text-primary')}
              >
                <span className="w-5 shrink-0 text-[10px] text-[var(--app-text-tertiary)]">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate">{stage.name}</span>
                {active && <Check {...ICON} className="h-3.5 w-3.5 shrink-0" />}
              </button>
            );
          })}
          {filtered.length === 0 && <p className="px-2 py-3 text-xs text-[var(--app-text-tertiary)]">Nenhuma etapa encontrada.</p>}
        </div>
      </PopoverContent>
    </Popover>
  );

  const rail = (
    <TooltipProvider delayDuration={0}>
      <nav aria-label="Etapas do funil" data-lead-stage-stepper data-tour="lead-detail-stages" className="flex min-w-0 flex-1 items-start gap-1">
        {stages.map((stage, index) => {
          const active = stage.id === activeStageId;
          const past = currentIndex >= 0 && index < currentIndex;
          const bar = (
            <button
              key={stage.id}
              type="button"
              disabled={disabled}
              aria-label={`Mover para ${stage.name}`}
              aria-current={active ? 'step' : undefined}
              data-lead-stage-step
              onClick={() => request(stage)}
              className={cn('group flex min-w-0 flex-1 flex-col gap-1 text-left disabled:cursor-default', mobile ? 'py-2' : 'py-1')}
            >
              <span className={cn('block h-1 w-full rounded-full transition-colors', active ? 'bg-primary' : past ? 'bg-primary/50' : 'bg-[var(--app-surface-hover)] group-hover:bg-primary/25')} />
              {labelled && (
                <span className={cn('truncate text-[11px] font-light', active ? 'text-primary' : 'text-[var(--app-text-tertiary)]')}>{stage.name}</span>
              )}
            </button>
          );
          return labelled ? bar : (
            <Tooltip key={stage.id}>
              <TooltipTrigger asChild>{bar}</TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6} className={stageTooltipClassName}>{index + 1}. {stage.name}</TooltipContent>
            </Tooltip>
          );
        })}
      </nav>
    </TooltipProvider>
  );

  return (
    <div className="relative min-w-0">
      {mobile ? (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <button type="button" aria-label="Etapa anterior" disabled={disabled || currentIndex <= 0} onClick={() => request(stages[currentIndex - 1])} className={cn(stepButton, stepSize)}><ChevronLeft {...ICON} className="h-4 w-4" /></button>
            {list}
            <button type="button" aria-label="Próxima etapa" disabled={disabled || currentIndex < 0 || currentIndex >= stages.length - 1} onClick={() => request(stages[currentIndex + 1])} className={cn(stepButton, stepSize)}><ChevronRight {...ICON} className="h-4 w-4" /></button>
          </div>
          {rail}
        </div>
      ) : (
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" aria-label="Etapa anterior" disabled={disabled || currentIndex <= 0} onClick={() => request(stages[currentIndex - 1])} className={cn(stepButton, stepSize)}><ChevronLeft {...ICON} className="h-4 w-4" /></button>
          {list}
          <button type="button" aria-label="Próxima etapa" disabled={disabled || currentIndex < 0 || currentIndex >= stages.length - 1} onClick={() => request(stages[currentIndex + 1])} className={cn(stepButton, stepSize)}><ChevronRight {...ICON} className="h-4 w-4" /></button>
          {rail}
        </div>
      )}
      {pendingTarget && (
        <StageMoveConfirm
          mobile={mobile}
          leadName={leadName}
          from={current?.name || 'Sem etapa'}
          to={pendingTarget.name}
          onCancel={() => setPending(null)}
          onConfirm={confirm}
        />
      )}
    </div>
  );
}

function StageMoveConfirm({ mobile, leadName, from, to, onCancel, onConfirm }: {
  mobile: boolean; leadName: string; from: string; to: string; onCancel: () => void; onConfirm: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { confirmRef.current?.focus(); }, []);
  const body = (
    <div
      role="alertdialog"
      aria-modal={mobile || undefined}
      aria-label="Confirmar mudança de etapa"
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onCancel(); } }}
      className={cn('bg-[var(--app-surface-solid)] p-4 text-[var(--app-text-primary)]', mobile ? 'rounded-t-[12px] pb-6' : 'vimob-popover-content w-[340px] rounded-[8px]')}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-white">
          <ArrowRight strokeWidth={1.5} className="h-4 w-4" />
        </span>
        <p className="text-sm font-light leading-snug">
          Mover <span className="font-normal">{leadName}</span> de <span className="font-normal">{from}</span> para <span className="font-normal text-primary">{to}</span>?
        </p>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={cn('rounded-[6px] bg-[var(--app-surface-soft)] px-3 text-xs font-light hover:bg-[var(--app-surface-hover)]', mobile ? 'h-11 flex-1' : 'h-8')}>Cancelar</button>
        <button ref={confirmRef} type="button" onClick={onConfirm} className={cn('rounded-[6px] bg-primary px-3 text-xs font-light text-primary-foreground hover:bg-primary/90', mobile ? 'h-11 flex-1' : 'h-8')}>Mover lead</button>
      </div>
    </div>
  );
  if (!mobile) return <div className="absolute left-0 top-full z-30 mt-2">{body}</div>;
  // Inside the mobile drawer: a sheet that rises from the bottom over a dimmed card.
  return (
    <div className="fixed inset-0 z-[120] flex flex-col justify-end bg-black/40" onClick={onCancel}>
      <div onClick={(event) => event.stopPropagation()}>{body}</div>
    </div>
  );
}
