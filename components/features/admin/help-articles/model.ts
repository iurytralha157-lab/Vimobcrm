import {
  HELP_ARTICLE_MODULE_KEYS,
  isHelpInternalHref,
  isHelpMediaPath,
  type HelpArticle,
  type HelpArticleInput,
  type HelpArticleStep,
  type HelpArticleVisibility,
} from '@/hooks/use-help-articles';
import { normalizeSearchText } from '@/lib/search-text';
import { helpArticleSlugSchema, helpArticleStepSchema } from '@/lib/validation';

export type HelpArticleForm = {
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

export type PreviewableArticle = Pick<
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

export type VisibilityOption = {
  value: HelpArticleVisibility;
  label: string;
  description: string;
};

export const VISIBILITY_OPTIONS: VisibilityOption[] = [
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

export function createClientId(prefix: string) {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createEmptyStep(): HelpArticleStep {
  return {
    id: createClientId('step'),
    title: '',
    body: '',
    annotations: [],
  };
}

export function createEmptyForm(displayOrder: number): HelpArticleForm {
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

export function articleToForm(article: HelpArticle): HelpArticleForm {
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

export function slugifyHelpArticle(value: string) {
  return normalizeSearchText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

export function splitHelpArticleList(value: string) {
  return Array.from(new Set(
    value
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean),
  ));
}

export function toHelpArticleReviewedAt(value: string) {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function formToHelpArticleInput(form: HelpArticleForm): HelpArticleInput {
  return {
    category: form.category.trim(),
    slug: form.slug.trim(),
    module_key: form.moduleKey.trim(),
    title: form.title.trim(),
    summary: form.summary.trim(),
    content: form.content.trim(),
    visibility: form.visibility,
    search_keywords: splitHelpArticleList(form.searchKeywords),
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
    related_slugs: splitHelpArticleList(form.relatedSlugs),
    estimated_minutes: Math.max(1, Math.round(Number(form.estimatedMinutes) || 1)),
    video_url: form.videoUrl.trim() || null,
    image_url: form.imageUrl.trim() || null,
    display_order: Math.max(0, Math.round(Number(form.displayOrder) || 0)),
    is_active: form.isActive,
    last_reviewed_at: toHelpArticleReviewedAt(form.lastReviewedAt),
  };
}

export function validateHelpArticleForm(form: HelpArticleForm) {
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
  if (form.lastReviewedAt && !toHelpArticleReviewedAt(form.lastReviewedAt)) {
    return 'Informe uma data de revisão válida.';
  }
  const searchKeywords = splitHelpArticleList(form.searchKeywords);
  if (searchKeywords.length > 40) {
    return 'Use no máximo 40 palavras-chave.';
  }
  if (searchKeywords.some((keyword) => keyword.length > 80)) {
    return 'Cada palavra-chave deve ter no máximo 80 caracteres.';
  }
  const relatedSlugs = splitHelpArticleList(form.relatedSlugs);
  if (relatedSlugs.length > 20) {
    return 'Relacione no máximo 20 artigos.';
  }
  if (relatedSlugs.some((slug) => !helpArticleSlugSchema.safeParse(slug).success)) {
    return 'Use apenas slugs válidos nos artigos relacionados.';
  }
  if (relatedSlugs.includes(form.slug.trim())) {
    return 'Um artigo não pode ser relacionado a ele mesmo.';
  }
  const normalizedSteps = formToHelpArticleInput(form).steps;
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

export function formatHelpArticleUpdatedAt(value: string) {
  if (!value) return 'Sem revisão registrada';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sem revisão registrada';
  return `Atualizado em ${date.toLocaleDateString('pt-BR')}`;
}

export function getHelpArticleVisibilityLabel(visibility: HelpArticleVisibility) {
  return VISIBILITY_OPTIONS.find((option) => option.value === visibility)?.label
    || 'Somente clientes';
}
