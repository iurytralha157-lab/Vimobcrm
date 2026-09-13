'use client';

import { ArrowDown, ArrowUp, Copy, MapPin, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { HelpArticleAnnotation, HelpArticleStep } from '@/hooks/use-help-articles';

function AnnotationEditor({
  annotations,
  onChange,
}: {
  annotations: HelpArticleAnnotation[];
  onChange: (annotations: HelpArticleAnnotation[]) => void;
}) {
  const updateAnnotation = <Key extends keyof HelpArticleAnnotation>(
    index: number,
    key: Key,
    value: HelpArticleAnnotation[Key],
  ) => {
    onChange(annotations.map((annotation, annotationIndex) => (
      annotationIndex === index ? { ...annotation, [key]: value } : annotation
    )));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-[var(--app-text-primary)]">Marcadores da imagem</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Posições em porcentagem, de 0 a 100.</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 bg-[var(--app-surface-solid)] text-xs"
          onClick={() => onChange([
            ...annotations,
            { x: 50, y: 50, label: String(annotations.length + 1) },
          ])}
        >
          <MapPin className="h-3.5 w-3.5" />
          Marcador
        </Button>
      </div>

      {annotations.map((annotation, index) => (
        <div
          key={`${annotation.label}-${index}`}
          className="grid gap-2 rounded-[8px] bg-[var(--app-surface-solid)] p-2 sm:grid-cols-[64px_64px_80px_1fr_36px]"
        >
          <label className="space-y-1">
            <span className="text-[10px] text-muted-foreground">X (%)</span>
            <Input
              type="number"
              min={0}
              max={100}
              value={annotation.x}
              onChange={(event) => updateAnnotation(
                index,
                'x',
                Math.min(100, Math.max(0, Number(event.target.value) || 0)),
              )}
              className="h-8 border-0 bg-[var(--app-surface-soft)] px-2 text-xs"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] text-muted-foreground">Y (%)</span>
            <Input
              type="number"
              min={0}
              max={100}
              value={annotation.y}
              onChange={(event) => updateAnnotation(
                index,
                'y',
                Math.min(100, Math.max(0, Number(event.target.value) || 0)),
              )}
              className="h-8 border-0 bg-[var(--app-surface-soft)] px-2 text-xs"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] text-muted-foreground">Rótulo</span>
            <Input
              value={annotation.label}
              onChange={(event) => updateAnnotation(index, 'label', event.target.value)}
              className="h-8 border-0 bg-[var(--app-surface-soft)] px-2 text-xs"
              placeholder="1"
              required
              maxLength={80}
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] text-muted-foreground">Explicação</span>
            <Input
              value={annotation.title || ''}
              onChange={(event) => updateAnnotation(index, 'title', event.target.value)}
              className="h-8 border-0 bg-[var(--app-surface-soft)] px-2 text-xs"
              placeholder="Clique neste botão"
              maxLength={180}
            />
          </label>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remover marcador ${index + 1}`}
            className="mt-auto h-9 w-9 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => onChange(annotations.filter((_, itemIndex) => itemIndex !== index))}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
    </div>
  );
}

export function HelpArticleStepEditor({
  step,
  index,
  total,
  onChange,
  onMove,
  onDuplicate,
  onRemove,
}: {
  step: HelpArticleStep;
  index: number;
  total: number;
  onChange: (step: HelpArticleStep) => void;
  onMove: (direction: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const updateStep = <Key extends keyof HelpArticleStep>(
    key: Key,
    value: HelpArticleStep[Key],
  ) => onChange({ ...step, [key]: value });

  return (
    <section className="rounded-[8px] bg-[var(--app-surface-soft)] p-3 sm:p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] bg-primary text-xs font-medium text-primary-foreground">
            {index + 1}
          </span>
          <p className="truncate text-sm font-medium">
            {step.title || `Novo passo ${index + 1}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 bg-[var(--app-surface-solid)]"
            disabled={index === 0}
            onClick={() => onMove(-1)}
            aria-label={`Subir passo ${index + 1}`}
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 bg-[var(--app-surface-solid)]"
            disabled={index === total - 1}
            onClick={() => onMove(1)}
            aria-label={`Descer passo ${index + 1}`}
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 bg-[var(--app-surface-solid)]"
            onClick={onDuplicate}
            aria-label={`Duplicar passo ${index + 1}`}
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={onRemove}
            aria-label={`Remover passo ${index + 1}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Título do passo</span>
          <Input
            value={step.title}
            onChange={(event) => updateStep('title', event.target.value)}
            className="border-0 bg-[var(--app-surface-solid)]"
            placeholder="Ex.: Abra o menu Configurações"
            required
            maxLength={180}
          />
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Instrução</span>
          <Textarea
            value={step.body}
            onChange={(event) => updateStep('body', event.target.value)}
            className="min-h-24 resize-y border-0 bg-[var(--app-surface-solid)]"
            placeholder="Explique exatamente o que a pessoa deve fazer e o que encontrará."
            required
            maxLength={5000}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">URL do print</span>
            <Input
              value={step.imageUrl || ''}
              onChange={(event) => updateStep('imageUrl', event.target.value)}
              className="border-0 bg-[var(--app-surface-solid)]"
              placeholder="/help/screenshots/exemplo.png"
              maxLength={500}
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Texto alternativo</span>
            <Input
              value={step.imageAlt || ''}
              onChange={(event) => updateStep('imageAlt', event.target.value)}
              className="border-0 bg-[var(--app-surface-solid)]"
              placeholder="Descreva o que aparece no print"
              required={Boolean(step.imageUrl)}
              maxLength={300}
            />
          </label>
        </div>
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Legenda do print</span>
          <Input
            value={step.imageCaption || ''}
            onChange={(event) => updateStep('imageCaption', event.target.value)}
            className="border-0 bg-[var(--app-surface-solid)]"
            placeholder="Texto curto exibido abaixo da imagem"
            maxLength={500}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Botão deste passo</span>
            <Input
              value={step.actionLabel || ''}
              onChange={(event) => updateStep('actionLabel', event.target.value)}
              className="border-0 bg-[var(--app-surface-solid)]"
              placeholder="Abrir configurações"
              maxLength={80}
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Destino do botão</span>
            <Input
              value={step.actionHref || ''}
              onChange={(event) => updateStep('actionHref', event.target.value)}
              className="border-0 bg-[var(--app-surface-solid)]"
              placeholder="/settings?tab=users"
              maxLength={240}
            />
          </label>
        </div>

        {step.imageUrl ? (
          <AnnotationEditor
            annotations={step.annotations || []}
            onChange={(annotations) => updateStep('annotations', annotations)}
          />
        ) : null}
      </div>
    </section>
  );
}
