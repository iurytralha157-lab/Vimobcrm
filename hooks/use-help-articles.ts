'use client';

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { adminAPI, type AdminJSON } from '@/lib/api/admin';

export interface HelpArticleAnnotation {
  x: number;
  y: number;
  label: string;
  title?: string;
}

export interface HelpArticleStep {
  id: string;
  title: string;
  body: string;
  imageUrl?: string;
  imageAlt?: string;
  imageCaption?: string;
  actionLabel?: string;
  actionHref?: string;
  annotations?: HelpArticleAnnotation[];
}

export type HelpArticleVisibility = 'authenticated' | 'public' | 'all';

export const HELP_ARTICLE_MODULE_KEYS = [
  'getting-started',
  'pipeline',
  'contacts',
  'schedule',
  'conversations',
  'automations',
  'dashboard',
  'management',
  'users',
  'properties',
  'integrations',
  'notifications',
] as const;

const HELP_ARTICLE_MODULE_KEY_SET = new Set<string>(HELP_ARTICLE_MODULE_KEYS);
const HELP_ARTICLES_QUERY_KEY = ['help-articles'] as const;

export interface HelpArticle {
  id: string;
  category: string;
  slug: string;
  module_key: string;
  title: string;
  summary: string;
  content: string;
  visibility: HelpArticleVisibility;
  search_keywords: string[];
  route_href: string | null;
  action_label: string | null;
  steps: HelpArticleStep[];
  related_slugs: string[];
  estimated_minutes: number;
  video_url: string | null;
  image_url: string | null;
  display_order: number;
  is_active: boolean;
  last_reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type HelpArticleInput = Omit<
  HelpArticle,
  'id' | 'created_at' | 'updated_at'
>;

export type HelpArticleUpdateInput = Partial<HelpArticleInput>;

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function asNullableString(value: unknown) {
  const normalized = asString(value).trim();
  return normalized ? normalized : null;
}

function asNumber(value: unknown, fallback = 0) {
  const normalized = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(normalized) ? normalized : fallback;
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .map((item) => asString(item).trim())
      .filter(Boolean),
  ));
}

function asVisibility(value: unknown): HelpArticleVisibility {
  return value === 'public' || value === 'all' || value === 'authenticated'
    ? value
    : 'authenticated';
}

export function normalizeHelpArticleModuleKey(value: unknown) {
  const normalized = asString(value).trim();
  return HELP_ARTICLE_MODULE_KEY_SET.has(normalized)
    ? normalized
    : 'getting-started';
}

export function isHelpInternalHref(value: string) {
  const normalized = value.trim();
  if (
    !normalized.startsWith('/')
    || normalized.startsWith('//')
    || normalized.length > 240
    || /[\\#\u0000-\u001f\u007f]/.test(normalized)
  ) {
    return false;
  }

  try {
    const decodedPath = decodeURIComponent(normalized.split('?')[0] || '');
    return !decodedPath
      .split('/')
      .some((segment) => segment === '.' || segment === '..');
  } catch {
    return false;
  }
}

export function isHelpMediaPath(value: string) {
  const normalized = value.trim();
  return (
    normalized.length <= 500
    && isHelpInternalHref(normalized)
    && (
      normalized.startsWith('/help/')
      || normalized.startsWith('/images/help/')
    )
  );
}

function normalizeInternalHref(value: unknown) {
  const normalized = asString(value).trim();
  return normalized && isHelpInternalHref(normalized) ? normalized : null;
}

function normalizeMediaPath(value: unknown) {
  const normalized = asString(value).trim();
  return normalized && isHelpMediaPath(normalized) ? normalized : null;
}

function normalizeAnnotation(value: unknown): HelpArticleAnnotation | null {
  const record = asRecord(value);
  const label = asString(record.label).trim();
  if (!label) return null;

  return {
    x: Math.min(100, Math.max(0, asNumber(record.x, 50))),
    y: Math.min(100, Math.max(0, asNumber(record.y, 50))),
    label,
    ...(asNullableString(record.title)
      ? { title: asNullableString(record.title) || undefined }
      : {}),
  };
}

function normalizeStep(
  value: unknown,
  articleId: string,
  index: number,
): HelpArticleStep {
  const record = asRecord(value);
  const annotations = Array.isArray(record.annotations)
    ? record.annotations
        .map(normalizeAnnotation)
        .filter((item): item is HelpArticleAnnotation => Boolean(item))
    : [];

  return {
    id: asString(record.id).trim() || `${articleId || 'article'}-step-${index + 1}`,
    title: asString(record.title).trim(),
    body: asString(record.body).trim(),
    ...(normalizeMediaPath(record.imageUrl ?? record.image_url)
      ? { imageUrl: normalizeMediaPath(record.imageUrl ?? record.image_url) || undefined }
      : {}),
    ...(asNullableString(record.imageAlt ?? record.image_alt)
      ? { imageAlt: asNullableString(record.imageAlt ?? record.image_alt) || undefined }
      : {}),
    ...(asNullableString(record.imageCaption ?? record.image_caption)
      ? { imageCaption: asNullableString(record.imageCaption ?? record.image_caption) || undefined }
      : {}),
    ...(asNullableString(record.actionLabel ?? record.action_label)
      ? { actionLabel: asNullableString(record.actionLabel ?? record.action_label) || undefined }
      : {}),
    ...(normalizeInternalHref(record.actionHref ?? record.action_href)
      ? { actionHref: normalizeInternalHref(record.actionHref ?? record.action_href) || undefined }
      : {}),
    ...(annotations.length > 0 ? { annotations } : {}),
  };
}

export function normalizeHelpArticle(value: unknown): HelpArticle {
  const record = asRecord(value);
  const id = asString(record.id).trim();
  const title = asString(record.title).trim();
  const content = asString(record.content).trim();
  const rawSteps = Array.isArray(record.steps) ? record.steps : [];

  return {
    id,
    category: asString(record.category, 'Geral').trim() || 'Geral',
    slug: asString(record.slug).trim(),
    module_key: normalizeHelpArticleModuleKey(record.module_key),
    title,
    summary: asString(record.summary).trim(),
    content,
    visibility: asVisibility(record.visibility),
    search_keywords: asStringArray(record.search_keywords),
    route_href: normalizeInternalHref(record.route_href),
    action_label: asNullableString(record.action_label),
    steps: rawSteps.map((step, index) => normalizeStep(step, id, index)),
    related_slugs: asStringArray(record.related_slugs),
    estimated_minutes: Math.min(60, Math.max(1, Math.round(asNumber(record.estimated_minutes, 3)))),
    video_url: normalizeMediaPath(record.video_url),
    image_url: normalizeMediaPath(record.image_url),
    display_order: Math.max(0, Math.round(asNumber(record.display_order, 0))),
    is_active: record.is_active === true,
    last_reviewed_at: asNullableString(record.last_reviewed_at),
    created_at: asString(record.created_at),
    updated_at: asString(record.updated_at),
  };
}

function sortHelpArticles(articles: HelpArticle[]) {
  return [...articles].sort((left, right) => (
    left.display_order - right.display_order
    || left.category.localeCompare(right.category, 'pt-BR')
    || left.title.localeCompare(right.title, 'pt-BR')
  ));
}

function normalizePayload(input: HelpArticleInput): AdminJSON {
  return {
    category: input.category.trim(),
    slug: input.slug.trim(),
    module_key: normalizeHelpArticleModuleKey(input.module_key),
    title: input.title.trim(),
    summary: input.summary.trim(),
    content: input.content.trim(),
    visibility: asVisibility(input.visibility),
    search_keywords: asStringArray(input.search_keywords),
    route_href: normalizeInternalHref(input.route_href),
    action_label: asNullableString(input.action_label),
    steps: input.steps.map((step, index) => normalizeStep(step, input.slug, index)),
    related_slugs: asStringArray(input.related_slugs),
    estimated_minutes: Math.min(60, Math.max(1, Math.round(input.estimated_minutes))),
    video_url: normalizeMediaPath(input.video_url),
    image_url: normalizeMediaPath(input.image_url),
    display_order: Math.max(0, Math.round(input.display_order)),
    is_active: input.is_active,
    last_reviewed_at: asNullableString(input.last_reviewed_at),
  };
}

function normalizeUpdatePayload(input: HelpArticleUpdateInput): AdminJSON {
  const payload: AdminJSON = {};

  if ('category' in input) payload.category = input.category?.trim();
  if ('slug' in input) payload.slug = input.slug?.trim();
  if ('module_key' in input) {
    payload.module_key = normalizeHelpArticleModuleKey(input.module_key);
  }
  if ('title' in input) payload.title = input.title?.trim();
  if ('summary' in input) payload.summary = input.summary?.trim();
  if ('content' in input) payload.content = input.content?.trim();
  if ('visibility' in input) payload.visibility = asVisibility(input.visibility);
  if ('search_keywords' in input) {
    payload.search_keywords = asStringArray(input.search_keywords);
  }
  if ('route_href' in input) payload.route_href = normalizeInternalHref(input.route_href);
  if ('action_label' in input) payload.action_label = asNullableString(input.action_label);
  if ('steps' in input) {
    payload.steps = (input.steps || []).map((step, index) => (
      normalizeStep(step, input.slug || 'article', index)
    ));
  }
  if ('related_slugs' in input) {
    payload.related_slugs = asStringArray(input.related_slugs);
  }
  if ('estimated_minutes' in input && input.estimated_minutes !== undefined) {
    payload.estimated_minutes = Math.min(60, Math.max(1, Math.round(input.estimated_minutes)));
  }
  if ('video_url' in input) payload.video_url = normalizeMediaPath(input.video_url);
  if ('image_url' in input) payload.image_url = normalizeMediaPath(input.image_url);
  if ('display_order' in input && input.display_order !== undefined) {
    payload.display_order = Math.max(0, Math.round(input.display_order));
  }
  if ('is_active' in input && input.is_active !== undefined) {
    payload.is_active = input.is_active === true;
  }
  if ('last_reviewed_at' in input) {
    payload.last_reviewed_at = asNullableString(input.last_reviewed_at);
  }

  return payload;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.';
}

export function useHelpArticles() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: HELP_ARTICLES_QUERY_KEY,
    queryFn: async () => {
      const items = await adminAPI.listTableRows('help_articles', 200);
      return sortHelpArticles(items.map(normalizeHelpArticle));
    },
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: 1,
  });

  const articles = useMemo(() => query.data || [], [query.data]);
  const activeArticles = useMemo(
    () => articles.filter((article) => article.is_active),
    [articles],
  );
  const articlesByCategory = useMemo(
    () => articles.reduce<Record<string, HelpArticle[]>>((accumulator, article) => {
      (accumulator[article.category] ||= []).push(article);
      return accumulator;
    }, {}),
    [articles],
  );

  const createArticle = useMutation({
    mutationFn: async (article: HelpArticleInput) => {
      const created = await adminAPI.createTableRow(
        'help_articles',
        normalizePayload(article),
      );
      return normalizeHelpArticle(created);
    },
    onSuccess: (createdArticle) => {
      toast.success('Artigo criado com sucesso.');
      queryClient.setQueryData<HelpArticle[]>(HELP_ARTICLES_QUERY_KEY, (current = []) => (
        sortHelpArticles([
          ...current.filter((article) => article.id !== createdArticle.id),
          createdArticle,
        ])
      ));
      void queryClient.invalidateQueries({ queryKey: HELP_ARTICLES_QUERY_KEY });
    },
    onError: (error) => {
      toast.error(`Erro ao criar artigo: ${getErrorMessage(error)}`);
    },
  });

  const updateArticle = useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: HelpArticleUpdateInput;
    }) => {
      const updated = await adminAPI.updateTableRow(
        'help_articles',
        id,
        normalizeUpdatePayload(updates),
      );
      return normalizeHelpArticle(updated);
    },
    onSuccess: (updatedArticle) => {
      toast.success('Artigo atualizado.');
      queryClient.setQueryData<HelpArticle[]>(HELP_ARTICLES_QUERY_KEY, (current = []) => (
        sortHelpArticles(current.map((article) => (
          article.id === updatedArticle.id ? updatedArticle : article
        )))
      ));
      void queryClient.invalidateQueries({ queryKey: HELP_ARTICLES_QUERY_KEY });
    },
    onError: (error) => {
      toast.error(`Erro ao atualizar artigo: ${getErrorMessage(error)}`);
    },
  });

  const deleteArticle = useMutation({
    mutationFn: (id: string) => adminAPI.deleteTableRow('help_articles', id),
    onSuccess: (_response, deletedArticleId) => {
      toast.success('Artigo excluído.');
      queryClient.setQueryData<HelpArticle[]>(HELP_ARTICLES_QUERY_KEY, (current = []) => (
        current.filter((article) => article.id !== deletedArticleId)
      ));
      void queryClient.invalidateQueries({ queryKey: HELP_ARTICLES_QUERY_KEY });
    },
    onError: (error) => {
      toast.error(`Erro ao excluir artigo: ${getErrorMessage(error)}`);
    },
  });

  return {
    articles,
    activeArticles,
    articlesByCategory,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    isFetching: query.isFetching,
    isRefetching: query.isRefetching,
    isStale: query.isStale,
    dataUpdatedAt: query.dataUpdatedAt,
    refetch: query.refetch,
    createArticle,
    updateArticle,
    deleteArticle,
  };
}
