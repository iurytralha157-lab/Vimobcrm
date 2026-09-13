'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import {
  HelpArticleDeleteDialog,
  HelpArticleEditorDialog,
  HelpArticlePreviewDialog,
  HelpArticlesList,
  HelpArticlesToolbar,
  articleToForm,
  createClientId,
  createEmptyForm,
  formToHelpArticleInput,
  slugifyHelpArticle,
  validateHelpArticleForm,
  type HelpArticleForm,
} from '@/components/features/admin/help-articles';
import {
  useHelpArticles,
  type HelpArticle,
  type HelpArticleStep,
} from '@/hooks/use-help-articles';
import {
  filterAdminHelpArticles,
  hasAdminHelpArticleFilters,
  type AdminHelpArticleStatusFilter,
  type AdminHelpArticleVisibilityFilter,
} from '@/lib/help/admin-help-article-filters';

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

  const handleTitleChange = (title: string) => {
    setFormError(null);
    setForm((current) => ({
      ...current,
      title,
      slug: slugEdited ? current.slug : slugifyHelpArticle(title),
    }));
  };

  const handleSlugChange = (slug: string) => {
    setSlugEdited(true);
    updateForm('slug', slugifyHelpArticle(slug));
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
    const validationError = validateHelpArticleForm(form);
    if (validationError) {
      setFormError(validationError);
      toast.error(validationError);
      return;
    }

    setFormError(null);
    const input = formToHelpArticleInput(form);
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

  return (
    <div className="space-y-4">
      <HelpArticlesToolbar
        articleCount={articles.length}
        activeCount={activeCount}
        categoriesCount={categoriesCount}
        search={search}
        categoryFilter={categoryFilter}
        categoryOptions={categoryOptions}
        statusFilter={statusFilter}
        visibilityFilter={visibilityFilter}
        hasActiveFilters={hasActiveFilters}
        isMutating={isMutating}
        isLoading={isLoading}
        isFetching={isFetching}
        isStale={isStale}
        isRefreshing={isRefreshing}
        hasBackgroundError={hasBackgroundError}
        lastUpdatedLabel={lastUpdatedLabel}
        onSearchChange={setSearch}
        onCategoryFilterChange={setCategoryFilter}
        onStatusFilterChange={setStatusFilter}
        onVisibilityFilterChange={setVisibilityFilter}
        onClearFilters={clearFilters}
        onRefresh={() => void handleRefetch()}
        onCreate={openCreate}
      />

      <HelpArticlesList
        articles={filteredArticles}
        totalArticleCount={articles.length}
        isLoading={isLoading}
        isError={isError}
        isRefreshing={isRefreshing}
        isMutating={isMutating}
        pendingArticleId={pendingArticleId}
        hasActiveFilters={hasActiveFilters}
        onRefresh={() => void handleRefetch()}
        onClearFilters={clearFilters}
        onCreate={openCreate}
        onPreview={setPreviewArticle}
        onEdit={openEdit}
        onDelete={setArticleToDelete}
        onToggleActive={(article, active) => void handleToggleActive(article, active)}
      />

      <HelpArticleEditorDialog
        open={editorOpen}
        editingArticle={editingArticle}
        form={form}
        formError={formError}
        isSaving={isSaving}
        onOpenChange={handleEditorOpenChange}
        onSubmit={() => void handleSave()}
        onTitleChange={handleTitleChange}
        onSlugChange={handleSlugChange}
        onFormChange={updateForm}
        onStepChange={updateStep}
        onStepMove={moveStep}
        onStepDuplicate={duplicateStep}
      />

      <HelpArticlePreviewDialog
        article={previewArticle}
        onClose={() => setPreviewArticle(null)}
      />

      <HelpArticleDeleteDialog
        article={articleToDelete}
        isDeleting={deleteArticle.isPending}
        onClose={() => setArticleToDelete(null)}
        onConfirm={() => void handleDelete()}
      />
    </div>
  );
}
