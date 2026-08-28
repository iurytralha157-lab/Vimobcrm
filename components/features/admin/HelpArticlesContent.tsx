'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BookOpenText,
  Clock3,
  Copy,
  Eye,
  Filter,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { HELP_MODULES } from '@/components/features/help/help-modules';
import {
  HELP_ARTICLE_MODULE_KEYS,
  isHelpInternalHref,
  isHelpMediaPath,
  useHelpArticles,
  type HelpArticle,
  type HelpArticleAnnotation,
  type HelpArticleInput,
  type HelpArticleStep,
  type HelpArticleVisibility,
} from '@/hooks/use-help-articles';
import {
  filterAdminHelpArticles,
  hasAdminHelpArticleFilters,
  type AdminHelpArticleStatusFilter,
  type AdminHelpArticleVisibilityFilter,
} from '@/lib/help/admin-help-article-filters';
import { normalizeSearchText } from '@/lib/search-text';
import { cn } from '@/lib/utils';
import { helpArticleSlugSchema, helpArticleStepSchema } from '@/lib/validation';

type HelpArticleForm = {
  category: string;
  slug: string;
  moduleKey: string;
  title: string;
  summary: string;
  content: string;
  visibility: HelpArticleVisibility;
  searchKeywords: string;
  routeHref: string;
  actionLabel: string;
  steps: HelpArticleStep[];
  relatedSlugs: string;
  estimatedMinutes: string;
  videoUrl: string;
  imageUrl: string;
  displayOrder: string;
  isActive: boolean;
  lastReviewedAt: string;
};

type PreviewableArticle = Pick<
  HelpArticleInput,
  | 'category'
  | 'title'
  | 'summary'
  | 'content'
  | 'visibility'
  | 'route_href'
  | 'action_label'
  | 'steps'
  | 'estimated_minutes'
  | 'video_url'
  | 'image_url'
>;

function createClientId(prefix: string) {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createEmptyStep(): HelpArticleStep {
  return {
    id: createClientId('step'),
    title: '',
    body: '',
    annotations: [],
  };
}

function createEmptyForm(displayOrder: number): HelpArticleForm {
  return {
    category: '',
    slug: '',
    moduleKey: 'getting-started',
    title: '',
    summary: '',
    content: '',
    visibility: 'authenticated',
    searchKeywords: '',
    routeHref: '',
    actionLabel: '',
    steps: [],
    relatedSlugs: '',
    estimatedMinutes: '3',
    videoUrl: '',
    imageUrl: '',
    displayOrder: String(displayOrder),
    isActive: false,
    lastReviewedAt: '',
  };
}

function articleToForm(article: HelpArticle): HelpArticleForm {
  return {
    category: article.category,
    slug: article.slug,
    moduleKey: article.module_key,
    title: article.title,
    summary: article.summary,
    content: article.content,
    visibility: article.visibility,
    searchKeywords: article.search_keywords.join(', '),
    routeHref: article.route_href || '',
    actionLabel: article.action_label || '',
    steps: article.steps.map((step) => ({
      ...step,
      annotations: step.annotations?.map((annotation) => ({ ...annotation })) || [],
    })),
    relatedSlugs: article.related_slugs.join(', '),
    estimatedMinutes: String(article.estimated_minutes),
    videoUrl: article.video_url || '',
    imageUrl: article.image_url || '',
    displayOrder: String(article.display_order),
    isActive: article.is_active,
    lastReviewedAt: article.last_reviewed_at?.slice(0, 10) || '',
  };
}

function slugify(value: string) {
  return normalizeSearchText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function splitList(value: string) {
  return Array.from(new Set(
    value
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean),
  ));
}

function toReviewedAt(value: string) {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function formToInput(form: HelpArticleForm): HelpArticleInput {
  return {
    category: form.category.trim(),
    slug: form.slug.trim(),
    module_key: form.moduleKey.trim(),
    title: form.title.trim(),
    summary: form.summary.trim(),
    content: form.content.trim(),
    visibility: form.visibility,
    search_keywords: splitList(form.searchKeywords),
    route_href: form.routeHref.trim() || null,
    action_label: form.actionLabel.trim() || null,
    steps: form.steps.map((step) => ({
      ...step,
      title: step.title.trim(),
      body: step.body.trim(),
      imageUrl: step.imageUrl?.trim() || undefined,
      imageAlt: step.imageAlt?.trim() || undefined,
      imageCaption: step.imageCaption?.trim() || undefined,
      actionLabel: step.actionLabel?.trim() || undefined,
      actionHref: step.actionHref?.trim() || undefined,
      annotations: step.annotations?.map((annotation) => ({
        ...annotation,
        label: annotation.label.trim(),
        title: annotation.title?.trim() || undefined,
      })).filter((annotation) => annotation.label) || [],
    })),
    related_slugs: splitList(form.relatedSlugs),
    estimated_minutes: Math.max(1, Math.round(Number(form.estimatedMinutes) || 1)),
    video_url: form.videoUrl.trim() || null,
    image_url: form.imageUrl.trim() || null,
    display_order: Math.max(0, Math.round(Number(form.displayOrder) || 0)),
    is_active: form.isActive,
    last_reviewed_at: toReviewedAt(form.lastReviewedAt),
  };
}

function validateForm(form: HelpArticleForm) {
  if (form.title.trim().length < 4) return 'Informe um título com pelo menos 4 caracteres.';
  if (form.title.trim().length > 180) return 'O título deve ter no máximo 180 caracteres.';
  if (form.category.trim().length < 2) {
    return 'Informe uma categoria com pelo menos 2 caracteres.';
  }
  if (form.category.trim().length > 80) return 'A categoria deve ter no máximo 80 caracteres.';
  if (!HELP_ARTICLE_MODULE_KEYS.some((moduleKey) => moduleKey === form.moduleKey)) {
    return 'Selecione uma área válida da Central de Ajuda.';
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.slug.trim())) {
    return 'Use um slug em letras minúsculas, números e hífens.';
  }
  if (form.slug.trim().length > 180) return 'O slug deve ter no máximo 180 caracteres.';
  if (!form.summary.trim()) return 'Escreva um resumo curto para os resultados de busca.';
  if (form.summary.trim().length > 320) return 'O resumo deve ter no máximo 320 caracteres.';
  if (!form.content.trim()) return 'Adicione uma introdução para o artigo.';
  if (form.content.trim().length > 20000) {
    return 'A introdução deve ter no máximo 20.000 caracteres.';
  }
  if (form.steps.length > 40) return 'Use no máximo 40 passos por artigo.';
  if (form.routeHref && !isHelpInternalHref(form.routeHref)) {
    return 'O destino principal deve ser um caminho interno iniciado por /.';
  }
  if (Boolean(form.actionLabel.trim()) !== Boolean(form.routeHref.trim())) {
    return 'Informe juntos o texto e o destino do botão principal.';
  }
  if (form.actionLabel.trim().length > 80) {
    return 'O texto do botão principal deve ter no máximo 80 caracteres.';
  }
  if (form.imageUrl && !isHelpMediaPath(form.imageUrl)) {
    return 'A imagem de capa deve começar com /help/ ou /images/help/.';
  }
  if (form.videoUrl && !isHelpMediaPath(form.videoUrl)) {
    return 'O vídeo deve começar com /help/ ou /images/help/.';
  }
  const estimatedMinutes = Number(form.estimatedMinutes);
  if (!Number.isInteger(estimatedMinutes) || estimatedMinutes < 1 || estimatedMinutes > 60) {
    return 'O tempo de leitura deve ficar entre 1 e 60 minutos.';
  }
  const displayOrder = Number(form.displayOrder);
  if (!Number.isInteger(displayOrder) || displayOrder < 0) {
    return 'A ordem deve ser um número inteiro igual ou maior que zero.';
  }
  if (form.lastReviewedAt && !toReviewedAt(form.lastReviewedAt)) {
    return 'Informe uma data de revisão válida.';
  }
  const searchKeywords = splitList(form.searchKeywords);
  if (searchKeywords.length > 40) {
    return 'Use no máximo 40 palavras-chave.';
  }
  if (searchKeywords.some((keyword) => keyword.length > 80)) {
    return 'Cada palavra-chave deve ter no máximo 80 caracteres.';
  }
  const relatedSlugs = splitList(form.relatedSlugs);
  if (relatedSlugs.length > 20) {
    return 'Relacione no máximo 20 artigos.';
  }
  if (relatedSlugs.some((slug) => !helpArticleSlugSchema.safeParse(slug).success)) {
    return 'Use apenas slugs válidos nos artigos relacionados.';
  }
  if (relatedSlugs.includes(form.slug.trim())) {
    return 'Um artigo não pode ser relacionado a ele mesmo.';
  }
  const normalizedSteps = formToInput(form).steps;
  for (const [index, step] of form.steps.entries()) {
    if (!step.title.trim() || !step.body.trim()) {
      return `Preencha título e instrução do passo ${index + 1}.`;
    }
    if (step.title.trim().length > 180) {
      return `O título do passo ${index + 1} deve ter no máximo 180 caracteres.`;
    }
    if (step.body.trim().length > 5000) {
      return `A instrução do passo ${index + 1} deve ter no máximo 5.000 caracteres.`;
    }
    if (step.imageUrl && !step.imageAlt?.trim()) {
      return `Informe o texto alternativo da imagem do passo ${index + 1}.`;
    }
    if (step.imageUrl && !isHelpMediaPath(step.imageUrl)) {
      return `O print do passo ${index + 1} deve começar com /help/ ou /images/help/.`;
    }
    if (step.actionLabel?.trim() && !step.actionHref?.trim()) {
      return `Informe o destino do botão do passo ${index + 1}.`;
    }
    if (step.actionHref && !isHelpInternalHref(step.actionHref)) {
      return `O botão do passo ${index + 1} deve usar um caminho interno iniciado por /.`;
    }
    if ((step.annotations?.length || 0) > 20) {
      return `Use no máximo 20 marcadores no passo ${index + 1}.`;
    }
    if (step.annotations?.some((annotation) => !annotation.label.trim())) {
      return `Preencha o rótulo de todos os marcadores do passo ${index + 1}.`;
    }
    const parsedStep = helpArticleStepSchema.safeParse(normalizedSteps[index]);
    if (!parsedStep.success) {
      return `Passo ${index + 1}: ${parsedStep.error.issues[0]?.message || 'revise os campos informados.'}`;
    }
  }
  return null;
}

function formatUpdatedAt(value: string) {
  if (!value) return 'Sem revisão registrada';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sem revisão registrada';
  return `Atualizado em ${date.toLocaleDateString('pt-BR')}`;
}

const VISIBILITY_OPTIONS: Array<{
  value: HelpArticleVisibility;
  label: string;
  description: string;
}> = [
  {
    value: 'authenticated',
    label: 'Somente clientes',
    description: 'Aparece apenas na Central de Ajuda dentro do CRM.',
  },
  {
    value: 'public',
    label: 'Somente público',
    description: 'Aparece apenas na Central pública, sem exigir login.',
  },
  {
    value: 'all',
    label: 'Público e clientes',
    description: 'O mesmo artigo fica disponível dentro e fora do CRM.',
  },
];

function getVisibilityLabel(visibility: HelpArticleVisibility) {
  return VISIBILITY_OPTIONS.find((option) => option.value === visibility)?.label
    || 'Somente clientes';
}

function ArticleImage({
  url,
  annotations = [],
  alt = 'Prévia da imagem cadastrada',
  className,
}: {
  url: string;
  annotations?: HelpArticleAnnotation[];
  alt?: string;
  className?: string;
}) {
  return (
    <div
      role="img"
      aria-label={alt}
      className={cn(
        'relative overflow-hidden rounded-[8px] bg-[var(--app-surface-soft)] bg-cover bg-center',
        className,
      )}
      style={{
        backgroundImage: `linear-gradient(180deg, rgba(10,10,10,.02), rgba(10,10,10,.15)), url(${JSON.stringify(url)})`,
      }}
    >
      {annotations.map((annotation, index) => (
        <span
          key={`${annotation.label}-${index}`}
          title={annotation.title || annotation.label}
          className="absolute flex h-7 min-w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-primary px-2 text-[11px] font-medium text-primary-foreground"
          style={{ left: `${annotation.x}%`, top: `${annotation.y}%` }}
        >
          {annotation.label}
        </span>
      ))}
    </div>
  );
}

function ArticlePreview({ article }: { article: PreviewableArticle }) {
  return (
    <article className="space-y-5">
      <header>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge className="rounded-[4px] border-0 bg-primary/10 text-primary">{article.category || 'Categoria'}</Badge>
          <Badge className="rounded-[4px] border-0 bg-[var(--app-surface-soft)] text-muted-foreground">
            {getVisibilityLabel(article.visibility)}
          </Badge>
          <span className="inline-flex items-center gap-1">
            <Clock3 className="h-3.5 w-3.5" />
            {article.estimated_minutes || 1} min
          </span>
        </div>
        <h2 className="mt-3 text-xl font-medium leading-tight text-[var(--app-text-primary)]">
          {article.title || 'Título do artigo'}
        </h2>
        <p className="mt-2 text-sm leading-6 text-[var(--app-text-secondary)]">
          {article.summary || 'O resumo aparecerá aqui nos resultados e no início do artigo.'}
        </p>
      </header>

      {article.image_url && isHelpMediaPath(article.image_url) ? (
        <ArticleImage url={article.image_url} className="aspect-[16/8]" />
      ) : null}

      {article.content ? (
        <p className="whitespace-pre-line text-sm leading-7 text-[var(--app-text-secondary)]">
          {article.content}
        </p>
      ) : null}

      {article.route_href && article.action_label && isHelpInternalHref(article.route_href) ? (
        <Link
          href={article.route_href}
          target="_blank"
          rel="noopener noreferrer"
          prefetch={false}
          className="inline-flex h-9 items-center gap-2 rounded-[6px] bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          {article.action_label}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      ) : null}

      {article.steps.length > 0 ? (
        <ol className="space-y-5">
          {article.steps.map((step, index) => (
            <li key={step.id} className="rounded-[8px] bg-[var(--app-surface-soft)] p-4">
              <div className="flex items-start gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] bg-primary text-xs font-medium text-primary-foreground">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-medium text-[var(--app-text-primary)]">
                    {step.title || `Passo ${index + 1}`}
                  </h3>
                  <p className="mt-1 whitespace-pre-line text-sm leading-6 text-[var(--app-text-secondary)]">
                    {step.body || 'A instrução deste passo aparecerá aqui.'}
                  </p>
                </div>
              </div>
              {step.imageUrl && isHelpMediaPath(step.imageUrl) ? (
                <div className="mt-4">
                  <ArticleImage
                    url={step.imageUrl}
                    annotations={step.annotations}
                    alt={step.imageAlt || `Imagem do passo ${index + 1}`}
                    className="aspect-video"
                  />
                  {step.imageCaption ? (
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">
                      {step.imageCaption}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {step.actionLabel && step.actionHref && isHelpInternalHref(step.actionHref) ? (
                <Link
                  href={step.actionHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  prefetch={false}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-[6px] px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10"
                >
                  {step.actionLabel}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}

      {article.video_url ? (
        <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-3 text-xs text-muted-foreground">
          Vídeo complementar: <span className="break-all text-[var(--app-text-primary)]">{article.video_url}</span>
        </div>
      ) : null}
    </article>
  );
}

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

function StepEditor({
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

export function HelpArticlesContent() {
  const {
    articles,
    isLoading,
    isError,
    isFetching,
    isRefetching,
    isStale,
    dataUpdatedAt,
    refetch,
    createArticle,
    updateArticle,
    deleteArticle,
  } = useHelpArticles();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<AdminHelpArticleStatusFilter>('all');
  const [visibilityFilter, setVisibilityFilter] = useState<AdminHelpArticleVisibilityFilter>('any');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingArticle, setEditingArticle] = useState<HelpArticle | null>(null);
  const [previewArticle, setPreviewArticle] = useState<HelpArticle | null>(null);
  const [articleToDelete, setArticleToDelete] = useState<HelpArticle | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [slugEdited, setSlugEdited] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState<HelpArticleForm>(() => createEmptyForm(10));

  const categoryOptions = useMemo(() => (
    Array.from(new Set(articles.map((article) => article.category)))
      .sort((left, right) => left.localeCompare(right, 'pt-BR'))
  ), [articles]);
  const filteredArticles = useMemo(() => filterAdminHelpArticles(articles, {
    search,
    category: categoryFilter,
    status: statusFilter,
    visibility: visibilityFilter,
  }), [articles, categoryFilter, search, statusFilter, visibilityFilter]);

  const activeCount = articles.filter((article) => article.is_active).length;
  const categoriesCount = new Set(articles.map((article) => article.category)).size;
  const isSaving = createArticle.isPending || updateArticle.isPending;
  const isMutating = isSaving || deleteArticle.isPending;
  const pendingArticleId = updateArticle.isPending ? updateArticle.variables?.id : null;
  const hasActiveFilters = hasAdminHelpArticleFilters({
    search,
    category: categoryFilter,
    status: statusFilter,
    visibility: visibilityFilter,
  });
  const hasBackgroundError = isError && articles.length > 0;
  const lastUpdatedLabel = dataUpdatedAt > 0
    ? new Date(dataUpdatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : null;
  const isRefreshing = isRetrying || isRefetching;

  const updateForm = <Key extends keyof HelpArticleForm>(
    key: Key,
    value: HelpArticleForm[Key],
  ) => {
    setFormError(null);
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleEditorOpenChange = (open: boolean) => {
    if (!open && isSaving) return;
    setEditorOpen(open);
    if (!open) setFormError(null);
  };

  const handleRefetch = async () => {
    if (isRetrying || isRefetching) return;
    setIsRetrying(true);
    try {
      await refetch();
    } finally {
      setIsRetrying(false);
    }
  };

  const clearFilters = () => {
    setSearch('');
    setCategoryFilter('');
    setStatusFilter('all');
    setVisibilityFilter('any');
  };

  const openCreate = () => {
    const nextOrder = articles.length > 0
      ? Math.max(...articles.map((article) => article.display_order)) + 10
      : 10;
    setEditingArticle(null);
    setSlugEdited(false);
    setFormError(null);
    setForm(createEmptyForm(nextOrder));
    setEditorOpen(true);
  };

  const openEdit = (article: HelpArticle) => {
    setEditingArticle(article);
    setSlugEdited(true);
    setFormError(null);
    setForm(articleToForm(article));
    setEditorOpen(true);
  };

  const updateStep = (index: number, step: HelpArticleStep) => {
    updateForm(
      'steps',
      form.steps.map((item, itemIndex) => itemIndex === index ? step : item),
    );
  };

  const moveStep = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= form.steps.length) return;
    const nextSteps = [...form.steps];
    [nextSteps[index], nextSteps[targetIndex]] = [nextSteps[targetIndex], nextSteps[index]];
    updateForm('steps', nextSteps);
  };

  const duplicateStep = (index: number) => {
    const source = form.steps[index];
    const duplicated: HelpArticleStep = {
      ...source,
      id: createClientId('step'),
      title: source.title ? `${source.title} (cópia)` : '',
      annotations: source.annotations?.map((annotation) => ({ ...annotation })) || [],
    };
    const nextSteps = [...form.steps];
    nextSteps.splice(index + 1, 0, duplicated);
    updateForm('steps', nextSteps);
  };

  const handleSave = async () => {
    if (isMutating) return;
    const validationError = validateForm(form);
    if (validationError) {
      setFormError(validationError);
      toast.error(validationError);
      return;
    }

    setFormError(null);
    const input = formToInput(form);
    try {
      if (editingArticle) {
        await updateArticle.mutateAsync({
          id: editingArticle.id,
          updates: input,
        });
      } else {
        await createArticle.mutateAsync(input);
      }
      setEditorOpen(false);
    } catch {
      setFormError('Não foi possível salvar o artigo. Revise os dados e tente novamente.');
      // O hook apresenta a mensagem específica.
    }
  };

  const handleToggleActive = async (article: HelpArticle, isActive: boolean) => {
    if (isMutating) return;
    try {
      await updateArticle.mutateAsync({
        id: article.id,
        updates: { is_active: isActive },
      });
    } catch {
      // O hook apresenta a mensagem específica.
    }
  };

  const handleDelete = async () => {
    if (!articleToDelete || isMutating) return;
    const articleId = articleToDelete.id;
    try {
      await deleteArticle.mutateAsync(articleId);
      setArticleToDelete(null);
    } catch {
      // O hook apresenta a mensagem específica.
    }
  };

  const livePreview = formToInput(form);

  return (
    <div className="space-y-4">
      <section className="app-toolbar p-3 sm:p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="app-section-title">Artigos da Central de Ajuda</h1>
              <Badge className="rounded-[4px] border-0 bg-[var(--app-surface-soft)] text-muted-foreground">
                {articles.length} artigos
              </Badge>
              <Badge className="rounded-[4px] border-0 bg-primary/10 text-primary">
                {activeCount} publicados
              </Badge>
              <Badge className="rounded-[4px] border-0 bg-[var(--app-surface-soft)] text-muted-foreground">
                {categoriesCount} categorias
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Escreva guias pesquisáveis, organize passos e marque pontos importantes nos prints.
            </p>
          </div>

          <div className="flex items-center gap-2 self-start lg:self-auto">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => void handleRefetch()}
              disabled={isRefreshing}
              className="h-9 w-9 rounded-[6px] bg-[var(--app-surface-soft)]"
              aria-label="Atualizar lista de artigos"
            >
              <RefreshCw className={cn('h-4 w-4', isRefreshing && 'animate-spin')} />
            </Button>
            <Button
              type="button"
              onClick={openCreate}
              disabled={isMutating}
              className="h-9 shrink-0 rounded-[6px] bg-primary text-primary-foreground shadow-none hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
              Novo artigo
            </Button>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2 xl:flex-row xl:items-center">
          <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-[6px] bg-[var(--app-surface-soft)] px-3 xl:max-w-xl">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por título, categoria, slug ou palavra-chave"
              aria-label="Buscar artigos da Central de Ajuda"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {search ? (
              <button
                type="button"
                className="rounded-[6px] p-1 text-muted-foreground hover:bg-[var(--app-surface-hover)] hover:text-foreground"
                onClick={() => setSearch('')}
                aria-label="Limpar busca"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:flex xl:flex-wrap xl:items-center" role="group" aria-label="Filtros dos artigos">
            <div className="hidden h-10 items-center text-muted-foreground xl:flex" aria-hidden="true">
              <Filter className="h-4 w-4" />
            </div>
            <label>
              <span className="sr-only">Filtrar por categoria</span>
              <select
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
                className="h-10 w-full rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-sm outline-none focus:ring-2 focus:ring-primary/35 xl:w-auto xl:max-w-52"
              >
                <option value="">Todas as categorias</option>
                {categoryOptions.map((category) => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Filtrar por publicação</span>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as AdminHelpArticleStatusFilter)}
                className="h-10 w-full rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-sm outline-none focus:ring-2 focus:ring-primary/35 xl:w-auto"
              >
                <option value="all">Todos os estados</option>
                <option value="published">Publicados</option>
                <option value="draft">Rascunhos</option>
              </select>
            </label>
            <label>
              <span className="sr-only">Filtrar por audiência</span>
              <select
                value={visibilityFilter}
                onChange={(event) => setVisibilityFilter(event.target.value as AdminHelpArticleVisibilityFilter)}
                className="h-10 w-full rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-sm outline-none focus:ring-2 focus:ring-primary/35 xl:w-auto"
              >
                <option value="any">Todas as audiências</option>
                {VISIBILITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            {hasActiveFilters ? (
              <Button
                type="button"
                variant="ghost"
                className="h-10 rounded-[6px] bg-[var(--app-surface-soft)] px-3"
                onClick={clearFilters}
              >
                <X className="h-3.5 w-3.5" />
                Limpar filtros
              </Button>
            ) : null}
          </div>
        </div>

        {!isLoading ? (
          <p
            className={cn(
              'mt-3 text-xs',
              hasBackgroundError ? 'text-warning' : 'text-muted-foreground',
            )}
            role={hasBackgroundError ? 'alert' : 'status'}
            aria-live="polite"
          >
            {hasBackgroundError
              ? 'Não foi possível atualizar agora. Os artigos já carregados continuam disponíveis.'
              : isFetching
                ? 'Atualizando artigos...'
                : isStale
                  ? `Dados em cache${lastUpdatedLabel ? ` desde ${lastUpdatedLabel}` : ''}. Atualize para conferir mudanças recentes.`
                  : lastUpdatedLabel
                    ? `Atualizado às ${lastUpdatedLabel}.`
                    : 'Lista pronta.'}
          </p>
        ) : null}
      </section>

      {isLoading ? (
        <div
          className="app-card flex min-h-64 items-center justify-center text-sm text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Carregando artigos...
        </div>
      ) : isError && articles.length === 0 ? (
        <div className="app-card flex min-h-64 flex-col items-center justify-center p-6 text-center" role="alert">
          <BookOpenText className="h-8 w-8 text-muted-foreground" strokeWidth={1.5} />
          <p className="mt-3 text-sm font-medium">Não foi possível carregar os artigos</p>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Verifique a estrutura conectada e tente novamente.
          </p>
          <Button
            type="button"
            variant="ghost"
            className="mt-4 bg-[var(--app-surface-soft)]"
            disabled={isRefreshing}
            onClick={() => void handleRefetch()}
          >
            <RefreshCw className={cn('h-4 w-4', isRefreshing && 'animate-spin')} />
            {isRefreshing ? 'Tentando...' : 'Tentar novamente'}
          </Button>
        </div>
      ) : filteredArticles.length === 0 ? (
        <div className="app-card flex min-h-64 flex-col items-center justify-center p-6 text-center">
          <Search className="h-8 w-8 text-muted-foreground" strokeWidth={1.5} />
          <p className="mt-3 text-sm font-medium">
            {hasActiveFilters ? 'Nenhum artigo encontrado' : 'Nenhum artigo cadastrado'}
          </p>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            {hasActiveFilters
              ? 'Ajuste os filtros ou limpe a busca para ver todos os artigos.'
              : 'Crie o primeiro guia para alimentar a Central de Ajuda e a busca da Página Inicial.'}
          </p>
          {hasActiveFilters ? (
            <Button type="button" variant="ghost" className="mt-4 bg-[var(--app-surface-soft)]" onClick={clearFilters}>
              <X className="h-4 w-4" />
              Limpar filtros
            </Button>
          ) : (
            <Button type="button" className="mt-4 bg-primary text-primary-foreground" onClick={openCreate} disabled={isMutating}>
              <Plus className="h-4 w-4" />
              Criar artigo
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredArticles.map((article) => (
            <article
              key={article.id}
              className="app-card flex flex-col gap-4 p-4 xl:flex-row xl:items-center"
            >
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-[var(--app-surface-soft)] text-primary">
                  <BookOpenText className="h-5 w-5" strokeWidth={1.7} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-sm font-medium">{article.title}</h2>
                    <Badge className={cn(
                      'rounded-[4px] border-0',
                      article.is_active
                        ? 'bg-success/10 text-success'
                        : 'bg-[var(--app-surface-soft)] text-muted-foreground',
                    )}>
                      {article.is_active ? 'Publicado' : 'Rascunho'}
                    </Badge>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm leading-5 text-muted-foreground">
                    {article.summary || article.content}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>{article.category}</span>
                    {article.module_key ? <span>Módulo: {article.module_key}</span> : null}
                    <span>{getVisibilityLabel(article.visibility)}</span>
                    <span>{article.steps.length} passo(s)</span>
                    <span>{article.estimated_minutes} min</span>
                    <span>{formatUpdatedAt(article.updated_at)}</span>
                  </div>
                </div>
              </div>

              <div className="flex w-full flex-wrap items-center gap-2 xl:w-auto xl:justify-end">
                <label className="flex h-9 items-center gap-2 rounded-[6px] bg-[var(--app-surface-soft)] px-3 text-xs font-medium">
                  <Switch
                    checked={article.is_active}
                    disabled={isMutating}
                    onCheckedChange={(checked) => void handleToggleActive(article, checked)}
                    aria-label={`${article.is_active ? 'Desativar' : 'Ativar'} artigo ${article.title}`}
                  />
                  {pendingArticleId === article.id ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      Salvando
                    </>
                  ) : article.is_active ? 'Ativo' : 'Inativo'}
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9 flex-1 rounded-[6px] bg-[var(--app-surface-soft)] sm:flex-none"
                  onClick={() => setPreviewArticle(article)}
                >
                  <Eye className="h-3.5 w-3.5" />
                  Prévia
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9 flex-1 rounded-[6px] bg-[var(--app-surface-soft)] sm:flex-none"
                  onClick={() => openEdit(article)}
                  disabled={isMutating}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Editar
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-[6px] text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setArticleToDelete(article)}
                  disabled={isMutating}
                  aria-label={`Excluir ${article.title}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}

      <Dialog open={editorOpen} onOpenChange={handleEditorOpenChange}>
        <DialogContent
          className="max-h-[94dvh] w-[calc(100vw-1rem)] max-w-[1240px] overflow-hidden rounded-[8px] p-0 shadow-none sm:w-[calc(100vw-2rem)] sm:max-w-[1240px]"
          aria-busy={isSaving}
        >
          <DialogHeader className="px-4 pb-3 pt-4 sm:px-5">
            <DialogTitle className="flex items-center gap-2 text-base">
              <BookOpenText className="h-4 w-4 text-primary" />
              {editingArticle ? 'Editar artigo' : 'Novo artigo'}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Configure o conteúdo, a audiência, os passos, os links e o estado de publicação do artigo.
            </DialogDescription>
          </DialogHeader>

          <form
            className="contents"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSave();
            }}
          >
          <fieldset className="contents" disabled={isSaving}>
            <ScrollArea className="max-h-[calc(94dvh-132px)]">
            <div className="grid gap-4 px-4 pb-5 sm:px-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
              <div className="space-y-4">
                <section className="rounded-[8px] bg-[var(--app-surface-soft)] p-3 sm:p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1.5">
                      <span className="text-xs font-medium text-muted-foreground">Título</span>
                      <Input
                        value={form.title}
                        onChange={(event) => {
                          const title = event.target.value;
                          setFormError(null);
                          setForm((current) => ({
                            ...current,
                            title,
                            slug: slugEdited ? current.slug : slugify(title),
                          }));
                        }}
                        className="border-0 bg-[var(--app-surface-solid)]"
                        placeholder="Como criar uma automação?"
                        required
                        minLength={4}
                        maxLength={180}
                      />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-xs font-medium text-muted-foreground">Slug</span>
                      <Input
                        value={form.slug}
                        onChange={(event) => {
                          setSlugEdited(true);
                          updateForm('slug', slugify(event.target.value));
                        }}
                        className="border-0 bg-[var(--app-surface-solid)] font-mono text-xs"
                        placeholder="como-criar-uma-automacao"
                        required
                        maxLength={180}
                        pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                      />
                    </label>
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1.5">
                      <span className="text-xs font-medium text-muted-foreground">Categoria</span>
                      <Input
                        value={form.category}
                        onChange={(event) => updateForm('category', event.target.value)}
                        className="border-0 bg-[var(--app-surface-solid)]"
                        placeholder="Automações"
                        required
                        minLength={2}
                        maxLength={80}
                      />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-xs font-medium text-muted-foreground">Módulo relacionado</span>
                      <select
                        value={form.moduleKey}
                        onChange={(event) => updateForm('moduleKey', event.target.value)}
                        className="h-10 w-full rounded-[8px] border-0 bg-[var(--app-surface-solid)] px-3 text-sm outline-none focus:ring-2 focus:ring-primary/35"
                      >
                        {HELP_MODULES.map((module) => (
                          <option key={module.key} value={module.key}>
                            {module.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <label className="mt-3 block space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">Resumo para busca</span>
                    <Textarea
                      value={form.summary}
                      onChange={(event) => updateForm('summary', event.target.value)}
                      className="min-h-20 resize-y border-0 bg-[var(--app-surface-solid)]"
                      placeholder="Explique em uma frase o que a pessoa aprenderá neste artigo."
                      required
                      maxLength={320}
                    />
                  </label>

                  <label className="mt-3 block space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">Introdução do artigo</span>
                    <Textarea
                      value={form.content}
                      onChange={(event) => updateForm('content', event.target.value)}
                      className="min-h-32 resize-y border-0 bg-[var(--app-surface-solid)]"
                      placeholder="Contextualize o recurso, quando usar e o resultado esperado."
                      required
                      maxLength={20000}
                    />
                  </label>

                  <label className="mt-3 block space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">Palavras-chave</span>
                    <Input
                      value={form.searchKeywords}
                      onChange={(event) => updateForm('searchKeywords', event.target.value)}
                      className="border-0 bg-[var(--app-surface-solid)]"
                      placeholder="automação, fluxo, gatilho, condição"
                    />
                    <span className="block text-[11px] text-muted-foreground">
                      Separe termos e sinônimos por vírgula.
                    </span>
                  </label>

                  <div className="mt-3 space-y-2">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Quem pode acessar</p>
                      <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">
                        A audiência define em qual Central de Ajuda este artigo será publicado.
                      </p>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {VISIBILITY_OPTIONS.map((option) => {
                        const selected = form.visibility === option.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => updateForm('visibility', option.value)}
                            className={cn(
                              'rounded-[8px] p-3 text-left transition-colors',
                              selected
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-[var(--app-surface-solid)] hover:bg-[var(--app-surface-hover)]',
                            )}
                          >
                            <span className="block text-xs font-medium">{option.label}</span>
                            <span className={cn(
                              'mt-1 block text-[11px] leading-4',
                              selected
                                ? 'text-primary-foreground/80'
                                : 'text-muted-foreground',
                            )}>
                              {option.description}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </section>

                <section className="rounded-[8px] bg-[var(--app-surface-soft)] p-3 sm:p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-medium">Passo a passo</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Cada passo pode ter print, marcador e link direto para o CRM.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="shrink-0 bg-[var(--app-surface-solid)]"
                      onClick={() => updateForm('steps', [...form.steps, createEmptyStep()])}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Passo
                    </Button>
                  </div>

                  <div className="mt-4 space-y-3">
                    {form.steps.length === 0 ? (
                      <button
                        type="button"
                        onClick={() => updateForm('steps', [createEmptyStep()])}
                        className="flex min-h-24 w-full flex-col items-center justify-center rounded-[8px] bg-[var(--app-surface-solid)] px-4 text-center transition-colors hover:bg-[var(--app-surface-hover)]"
                      >
                        <Plus className="h-5 w-5 text-primary" />
                        <span className="mt-2 text-sm font-medium">Adicionar o primeiro passo</span>
                        <span className="mt-1 text-xs text-muted-foreground">
                          Use passos para explicar ações com clareza e incluir prints.
                        </span>
                      </button>
                    ) : (
                      form.steps.map((step, index) => (
                        <StepEditor
                          key={step.id}
                          step={step}
                          index={index}
                          total={form.steps.length}
                          onChange={(updatedStep) => updateStep(index, updatedStep)}
                          onMove={(direction) => moveStep(index, direction)}
                          onDuplicate={() => duplicateStep(index)}
                          onRemove={() => updateForm(
                            'steps',
                            form.steps.filter((_, itemIndex) => itemIndex !== index),
                          )}
                        />
                      ))
                    )}
                  </div>
                </section>

                <section className="rounded-[8px] bg-[var(--app-surface-soft)] p-3 sm:p-4">
                  <h3 className="text-sm font-medium">Links e mídia</h3>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1.5">
                      <span className="text-xs font-medium text-muted-foreground">Botão principal</span>
                      <Input
                        value={form.actionLabel}
                        onChange={(event) => updateForm('actionLabel', event.target.value)}
                        className="border-0 bg-[var(--app-surface-solid)]"
                        placeholder="Abrir Automações"
                        maxLength={80}
                      />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-xs font-medium text-muted-foreground">Destino principal</span>
                      <Input
                        value={form.routeHref}
                        onChange={(event) => updateForm('routeHref', event.target.value)}
                        className="border-0 bg-[var(--app-surface-solid)]"
                        placeholder="/automations"
                        maxLength={240}
                      />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-xs font-medium text-muted-foreground">Imagem de capa</span>
                      <Input
                        value={form.imageUrl}
                        onChange={(event) => updateForm('imageUrl', event.target.value)}
                        className="border-0 bg-[var(--app-surface-solid)]"
                        placeholder="/help/capas/exemplo.webp"
                        maxLength={500}
                      />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-xs font-medium text-muted-foreground">Vídeo complementar</span>
                      <Input
                        value={form.videoUrl}
                        onChange={(event) => updateForm('videoUrl', event.target.value)}
                        className="border-0 bg-[var(--app-surface-solid)]"
                        placeholder="/help/videos/exemplo.mp4"
                        maxLength={500}
                      />
                    </label>
                  </div>
                  <label className="mt-3 block space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">Artigos relacionados</span>
                    <Input
                      value={form.relatedSlugs}
                      onChange={(event) => updateForm('relatedSlugs', event.target.value)}
                      className="border-0 bg-[var(--app-surface-solid)]"
                      placeholder="como-conectar-whatsapp, como-criar-um-lead"
                    />
                    <span className="block text-[11px] text-muted-foreground">
                      Informe os slugs separados por vírgula.
                    </span>
                  </label>
                </section>

                <section className="rounded-[8px] bg-[var(--app-surface-soft)] p-3 sm:p-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <label className="space-y-1.5">
                      <span className="text-xs font-medium text-muted-foreground">Tempo de leitura</span>
                      <Input
                        type="number"
                        min={1}
                        max={60}
                        step={1}
                        value={form.estimatedMinutes}
                        onChange={(event) => updateForm('estimatedMinutes', event.target.value)}
                        className="border-0 bg-[var(--app-surface-solid)]"
                        required
                      />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-xs font-medium text-muted-foreground">Ordem</span>
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        value={form.displayOrder}
                        onChange={(event) => updateForm('displayOrder', event.target.value)}
                        className="border-0 bg-[var(--app-surface-solid)]"
                        required
                      />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-xs font-medium text-muted-foreground">Última revisão</span>
                      <Input
                        type="date"
                        value={form.lastReviewedAt}
                        onChange={(event) => updateForm('lastReviewedAt', event.target.value)}
                        className="border-0 bg-[var(--app-surface-solid)]"
                      />
                    </label>
                  </div>
                  <label className="mt-3 flex items-center justify-between gap-3 rounded-[8px] bg-[var(--app-surface-solid)] p-3">
                    <span>
                      <span className="block text-sm font-medium">Publicar artigo</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        Desative para manter como rascunho.
                      </span>
                    </span>
                    <Switch
                      checked={form.isActive}
                      onCheckedChange={(checked) => updateForm('isActive', checked)}
                      aria-label="Publicar artigo"
                    />
                  </label>
                </section>
              </div>

              <aside className="xl:sticky xl:top-0 xl:self-start">
                <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-4">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Eye className="h-4 w-4 text-primary" />
                      <h3 className="text-sm font-medium">Prévia do artigo</h3>
                    </div>
                    <Badge className={cn(
                      'rounded-[4px] border-0',
                      form.isActive
                        ? 'bg-success/10 text-success'
                        : 'bg-[var(--app-surface-solid)] text-muted-foreground',
                    )}>
                      {form.isActive ? 'Publicado' : 'Rascunho'}
                    </Badge>
                  </div>
                  <div className="rounded-[8px] bg-[var(--app-surface-solid)] p-4">
                    <ArticlePreview article={livePreview} />
                  </div>
                </div>
              </aside>
            </div>
            </ScrollArea>
          </fieldset>

          {formError ? (
            <div className="mx-4 mb-3 rounded-[8px] bg-destructive/10 px-3 py-2 text-sm text-destructive sm:mx-5" role="alert">
              {formError}
            </div>
          ) : null}

          <DialogFooter className="bg-[var(--app-surface-solid)] px-4 py-3 sm:px-5">
            <Button
              type="button"
              variant="ghost"
              className="bg-[var(--app-surface-soft)]"
              onClick={() => handleEditorOpenChange(false)}
              disabled={isSaving}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              disabled={isSaving}
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {editingArticle ? 'Salvar alterações' : 'Criar artigo'}
            </Button>
          </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(previewArticle)} onOpenChange={(open) => {
        if (!open) setPreviewArticle(null);
      }}>
        <DialogContent className="max-h-[92dvh] max-w-3xl overflow-hidden rounded-[8px] p-0 shadow-none">
          <DialogHeader className="px-5 pb-3 pt-5">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Eye className="h-4 w-4 text-primary" />
              Prévia do artigo
            </DialogTitle>
            <DialogDescription className="sr-only">
              Visualização do artigo como será apresentado na Central de Ajuda.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[calc(92dvh-74px)]">
            <div className="px-5 pb-6">
              {previewArticle ? <ArticlePreview article={previewArticle} /> : null}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(articleToDelete)} onOpenChange={(open) => {
        if (!open && deleteArticle.isPending) return;
        if (!open) setArticleToDelete(null);
      }}>
        <AlertDialogContent className="rounded-[8px] shadow-none" aria-busy={deleteArticle.isPending}>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir artigo?</AlertDialogTitle>
            <AlertDialogDescription>
              “{articleToDelete?.title}” será removido da Central de Ajuda e deixará de aparecer nas buscas. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteArticle.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteArticle.isPending}
              onClick={(event) => {
                event.preventDefault();
                void handleDelete();
              }}
            >
              {deleteArticle.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Excluir artigo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
