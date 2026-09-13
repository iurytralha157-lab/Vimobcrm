'use client';

import Link from 'next/link';
import { ArrowRight, Clock3 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import {
  isHelpInternalHref,
  isHelpMediaPath,
  type HelpArticleAnnotation,
} from '@/hooks/use-help-articles';
import { cn } from '@/lib/utils';

import {
  getHelpArticleVisibilityLabel,
  type PreviewableArticle,
} from './model';

function HelpArticleImage({
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

export function HelpArticlePreview({ article }: { article: PreviewableArticle }) {
  return (
    <article className="space-y-5">
      <header>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge className="rounded-[4px] border-0 bg-primary/10 text-primary">
            {article.category || 'Categoria'}
          </Badge>
          <Badge className="rounded-[4px] border-0 bg-[var(--app-surface-soft)] text-muted-foreground">
            {getHelpArticleVisibilityLabel(article.visibility)}
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
        <HelpArticleImage url={article.image_url} className="aspect-[16/8]" />
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
                  <HelpArticleImage
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
          Vídeo complementar:{' '}
          <span className="break-all text-[var(--app-text-primary)]">{article.video_url}</span>
        </div>
      ) : null}
    </article>
  );
}
