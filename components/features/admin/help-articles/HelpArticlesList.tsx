'use client';

import { BookOpenText, Eye, Loader2, Pencil, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import type { HelpArticle } from '@/hooks/use-help-articles';
import { cn } from '@/lib/utils';

import { formatHelpArticleUpdatedAt, getHelpArticleVisibilityLabel } from './model';

type HelpArticlesListProps = {
  articles: HelpArticle[];
  totalArticleCount: number;
  isLoading: boolean;
  isError: boolean;
  isRefreshing: boolean;
  isMutating: boolean;
  pendingArticleId: string | null | undefined;
  hasActiveFilters: boolean;
  onRefresh: () => void;
  onClearFilters: () => void;
  onCreate: () => void;
  onPreview: (article: HelpArticle) => void;
  onEdit: (article: HelpArticle) => void;
  onDelete: (article: HelpArticle) => void;
  onToggleActive: (article: HelpArticle, active: boolean) => void;
};

export function HelpArticlesList({
  articles,
  totalArticleCount,
  isLoading,
  isError,
  isRefreshing,
  isMutating,
  pendingArticleId,
  hasActiveFilters,
  onRefresh,
  onClearFilters,
  onCreate,
  onPreview,
  onEdit,
  onDelete,
  onToggleActive,
}: HelpArticlesListProps) {
  if (isLoading) {
    return (
      <div
        className="app-card flex min-h-64 items-center justify-center text-sm text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Carregando artigos...
      </div>
    );
  }

  if (isError && totalArticleCount === 0) {
    return (
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
          onClick={onRefresh}
        >
          <RefreshCw className={cn('h-4 w-4', isRefreshing && 'animate-spin')} />
          {isRefreshing ? 'Tentando...' : 'Tentar novamente'}
        </Button>
      </div>
    );
  }

  if (articles.length === 0) {
    return (
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
          <Button
            type="button"
            variant="ghost"
            className="mt-4 bg-[var(--app-surface-soft)]"
            onClick={onClearFilters}
          >
            <X className="h-4 w-4" />
            Limpar filtros
          </Button>
        ) : (
          <Button
            type="button"
            className="mt-4 bg-primary text-primary-foreground"
            onClick={onCreate}
            disabled={isMutating}
          >
            <Plus className="h-4 w-4" />
            Criar artigo
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {articles.map((article) => (
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
                <span>{getHelpArticleVisibilityLabel(article.visibility)}</span>
                <span>{article.steps.length} passo(s)</span>
                <span>{article.estimated_minutes} min</span>
                <span>{formatHelpArticleUpdatedAt(article.updated_at)}</span>
              </div>
            </div>
          </div>

          <div className="flex w-full flex-wrap items-center gap-2 xl:w-auto xl:justify-end">
            <label className="flex h-9 items-center gap-2 rounded-[6px] bg-[var(--app-surface-soft)] px-3 text-xs font-medium">
              <Switch
                checked={article.is_active}
                disabled={isMutating}
                onCheckedChange={(checked) => onToggleActive(article, checked)}
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
              onClick={() => onPreview(article)}
            >
              <Eye className="h-3.5 w-3.5" />
              Prévia
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9 flex-1 rounded-[6px] bg-[var(--app-surface-soft)] sm:flex-none"
              onClick={() => onEdit(article)}
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
              onClick={() => onDelete(article)}
              disabled={isMutating}
              aria-label={`Excluir ${article.title}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </article>
      ))}
    </div>
  );
}
