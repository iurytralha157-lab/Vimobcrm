import { useId, useState } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  getPipelineStageColorForeground,
  isPipelineStageColorDraft,
  normalizePipelineStageColor,
  PIPELINE_STAGE_COLOR_FALLBACK,
  PIPELINE_STAGE_COLOR_PRESETS,
} from '@/config/pipeline-stage-colors';
import { cn } from '@/lib/utils';

function StageColorInputs({
  value,
  onCommit,
  onDone,
}: {
  value: string;
  onCommit: (color: string) => void;
  onDone: () => void;
}) {
  const [draftState, setDraftState] = useState(() => ({
    source: value,
    value,
  }));
  const helpId = useId();
  const draft = draftState.source === value ? draftState.value : value;
  const normalizedDraft = normalizePipelineStageColor(draft);
  const isValid = normalizedDraft !== null;

  const commit = (color: string) => {
    const normalized = normalizePipelineStageColor(color);
    if (!normalized) return;

    setDraftState({ source: normalized, value: normalized });
    onCommit(normalized);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        <input
          type="color"
          value={value}
          onChange={(event) => commit(event.currentTarget.value)}
          aria-label="Abrir seletor nativo de cor"
          className="h-9 w-11 cursor-pointer rounded-[6px] border border-[var(--app-text-primary)] bg-[var(--app-surface-soft)] p-1 shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-text-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--app-surface-solid)] [&::-moz-color-swatch]:rounded-[4px] [&::-moz-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-[4px] [&::-webkit-color-swatch]:border-0"
        />
        <Input
          value={draft}
          onChange={(event) => {
            const nextValue = event.currentTarget.value;
            if (!isPipelineStageColorDraft(nextValue)) return;

            const normalized = normalizePipelineStageColor(nextValue);
            if (normalized) {
              commit(normalized);
            } else {
              setDraftState({ source: value, value: nextValue });
            }
          }}
          onBlur={() => {
            if (!isValid) setDraftState({ source: value, value });
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || !normalizedDraft) return;
            event.preventDefault();
            commit(normalizedDraft);
            onDone();
          }}
          aria-label="Código hexadecimal da cor"
          aria-describedby={helpId}
          aria-invalid={!isValid}
          autoCapitalize="off"
          autoComplete="off"
          spellCheck={false}
          placeholder="#RRGGBB"
          className="h-9 flex-1 rounded-[6px] border-0 bg-[var(--app-surface-soft)] font-mono text-xs font-normal text-[var(--app-text-primary)] shadow-none focus-visible:ring-2 focus-visible:ring-[var(--app-text-primary)]"
        />
      </div>
      <p
        id={helpId}
        aria-live="polite"
        className={cn(
          'text-[10px] font-light leading-4',
          isValid ? 'text-[var(--app-text-tertiary)]' : 'text-destructive',
        )}
      >
        {isValid ? 'Formato hexadecimal #RRGGBB' : 'Complete a cor no formato #RRGGBB'}
      </p>
    </div>
  );
}

export function StageColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const normalizedValue = normalizePipelineStageColor(value);
  const activeColor = normalizedValue || PIPELINE_STAGE_COLOR_FALLBACK;
  const hasValidValue = normalizedValue !== null;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          aria-label={hasValidValue
            ? `Selecionar cor da coluna. Cor atual ${activeColor}`
            : 'Selecionar cor da coluna. A cor atual é inválida.'}
          aria-invalid={!hasValidValue}
          className="h-10 w-full justify-start gap-3 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 font-light text-[var(--app-text-primary)] shadow-none hover:bg-[var(--app-surface-hover)] focus-visible:ring-2 focus-visible:ring-[var(--app-text-primary)]"
        >
          <span
            aria-hidden="true"
            className="h-6 w-6 rounded-[4px] border border-[var(--app-text-primary)]"
            style={{ backgroundColor: activeColor }}
          />
          <span className={cn(
            'text-xs font-normal',
            hasValidValue
              ? 'font-mono text-[var(--app-text-secondary)]'
              : 'font-light text-destructive',
          )}>
            {hasValidValue ? activeColor : 'Escolha uma cor válida'}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        aria-label="Escolher cor da coluna"
        className="w-64 rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-3 text-[var(--app-text-primary)] shadow-none"
        align="start"
      >
        <div className="space-y-3">
          <StageColorInputs
            value={activeColor}
            onCommit={onChange}
            onDone={() => setIsOpen(false)}
          />

          <div
            role="group"
            className="grid grid-cols-6 gap-1.5"
            aria-label="Cores predefinidas"
          >
            {PIPELINE_STAGE_COLOR_PRESETS.map((preset) => {
              const selected = activeColor === preset.value;
              return (
                <button
                  key={preset.value}
                  type="button"
                  title={`${preset.label} (${preset.value})`}
                  aria-label={`Usar ${preset.label}, ${preset.value}`}
                  aria-pressed={selected}
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-[6px] border-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-text-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--app-surface-solid)]',
                    selected
                      ? 'ring-2 ring-[var(--app-text-primary)] ring-offset-2 ring-offset-[var(--app-surface-solid)]'
                      : 'ring-1 ring-inset ring-[var(--app-text-primary)]',
                  )}
                  style={{
                    backgroundColor: preset.value,
                    color: getPipelineStageColorForeground(preset.value),
                  }}
                  onClick={() => {
                    onChange(preset.value);
                    setIsOpen(false);
                  }}
                >
                  {selected ? <Check className="h-3.5 w-3.5" strokeWidth={2} /> : null}
                </button>
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
