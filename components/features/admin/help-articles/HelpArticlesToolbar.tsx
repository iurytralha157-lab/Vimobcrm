'use client';

import { Filter, Plus, RefreshCw, Search, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type {
  AdminHelpArticleStatusFilter,
  AdminHelpArticleVisibilityFilter,
} from '@/lib/help/admin-help-article-filters';
import { cn } from '@/lib/utils';

import { VISIBILITY_OPTIONS } from './model';

type HelpArticlesToolbarProps = {
  articleCount: number;
  activeCount: number;
  categoriesCount: number;
  search: string;
  categoryFilter: string;
  categoryOptions: string[];
  statusFilter: AdminHelpArticleStatusFilter;
  visibilityFilter: AdminHelpArticleVisibilityFilter;
  hasActiveFilters: boolean;
  isMutating: boolean;
  isLoading: boolean;
  isFetching: boolean;
  isStale: boolean;
  isRefreshing: boolean;
  hasBackgroundError: boolean;
  lastUpdatedLabel: string | null;
  onSearchChange: (value: string) => void;
  onCategoryFilterChange: (value: string) => void;
  onStatusFilterChange: (value: AdminHelpArticleStatusFilter) => void;
  onVisibilityFilterChange: (value: AdminHelpArticleVisibilityFilter) => void;
  onClearFilters: () => void;
  onRefresh: () => void;
  onCreate: () => void;
};

export function HelpArticlesToolbar({
  articleCount,
  activeCount,
  categoriesCount,
  search,
  categoryFilter,
  categoryOptions,
  statusFilter,
  visibilityFilter,
  hasActiveFilters,
  isMutating,
  isLoading,
  isFetching,
  isStale,
  isRefreshing,
  hasBackgroundError,
  lastUpdatedLabel,
  onSearchChange,
  onCategoryFilterChange,
  onStatusFilterChange,
  onVisibilityFilterChange,
  onClearFilters,
  onRefresh,
  onCreate,
}: HelpArticlesToolbarProps) {
  return (
    <section className="app-toolbar p-3 sm:p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="app-section-title">Artigos da Central de Ajuda</h1>
            <Badge className="rounded-[4px] border-0 bg-[var(--app-surface-soft)] text-muted-foreground">
              {articleCount} artigos
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
            onClick={onRefresh}
            disabled={isRefreshing}
            className="h-9 w-9 rounded-[6px] bg-[var(--app-surface-soft)]"
            aria-label="Atualizar lista de artigos"
          >
            <RefreshCw className={cn('h-4 w-4', isRefreshing && 'animate-spin')} />
          </Button>
          <Button
            type="button"
            onClick={onCreate}
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
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Buscar por título, categoria, slug ou palavra-chave"
            aria-label="Buscar artigos da Central de Ajuda"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {search ? (
            <button
              type="button"
              className="rounded-[6px] p-1 text-muted-foreground hover:bg-[var(--app-surface-hover)] hover:text-foreground"
              onClick={() => onSearchChange('')}
              aria-label="Limpar busca"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        <div
          className="grid gap-2 sm:grid-cols-2 xl:flex xl:flex-wrap xl:items-center"
          role="group"
          aria-label="Filtros dos artigos"
        >
          <div className="hidden h-10 items-center text-muted-foreground xl:flex" aria-hidden="true">
            <Filter className="h-4 w-4" />
          </div>
          <label>
            <span className="sr-only">Filtrar por categoria</span>
            <select
              value={categoryFilter}
              onChange={(event) => onCategoryFilterChange(event.target.value)}
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
              onChange={(event) => onStatusFilterChange(
                event.target.value as AdminHelpArticleStatusFilter,
              )}
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
              onChange={(event) => onVisibilityFilterChange(
                event.target.value as AdminHelpArticleVisibilityFilter,
              )}
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
              onClick={onClearFilters}
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
  );
}
