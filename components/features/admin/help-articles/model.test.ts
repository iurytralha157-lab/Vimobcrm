import assert from 'node:assert/strict';
import test from 'node:test';

import type { HelpArticle } from '@/hooks/use-help-articles';

import type { HelpArticleForm } from './model';

process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'local-test-anon-key';

const loadModel = () => import('./model');

async function createValidForm(): Promise<HelpArticleForm> {
  const { createEmptyForm } = await loadModel();
  return {
    ...createEmptyForm(20),
    category: 'Automações',
    slug: 'como-criar-automacao',
    title: 'Como criar uma automação',
    summary: 'Aprenda a criar uma automação.',
    content: 'Abra o editor e configure o fluxo.',
  };
}

test('normaliza o slug do artigo para o contrato público', async () => {
  const { slugifyHelpArticle } = await loadModel();
  assert.equal(
    slugifyHelpArticle('  Como criar uma Automação?  '),
    'como-criar-uma-automacao',
  );
});

test('converte o formulário em payload normalizado sem perder metadados do passo', async () => {
  const { formToHelpArticleInput } = await loadModel();
  const form = await createValidForm();
  form.searchKeywords = ' fluxo, gatilho\nfluxo ';
  form.relatedSlugs = 'primeiros-passos, configurar-whatsapp';
  form.estimatedMinutes = '4';
  form.displayOrder = '30';
  form.steps = [{
    id: 'step-1',
    title: ' Abra o editor ',
    body: ' Configure o fluxo ',
    imageUrl: ' /help/screenshots/editor.png ',
    imageAlt: ' Editor aberto ',
    annotations: [{ x: 40, y: 60, label: ' 1 ', title: ' Botão criar ' }],
  }];

  const input = formToHelpArticleInput(form);

  assert.deepEqual(input.search_keywords, ['fluxo', 'gatilho']);
  assert.deepEqual(input.related_slugs, ['primeiros-passos', 'configurar-whatsapp']);
  assert.equal(input.steps[0]?.title, 'Abra o editor');
  assert.equal(input.steps[0]?.annotations?.[0]?.title, 'Botão criar');
  assert.equal(input.estimated_minutes, 4);
  assert.equal(input.display_order, 30);
});

test('valida relações próprias e acessibilidade de imagens antes da mutação', async () => {
  const { validateHelpArticleForm } = await loadModel();
  const selfRelated = await createValidForm();
  selfRelated.relatedSlugs = selfRelated.slug;
  assert.equal(validateHelpArticleForm(selfRelated), 'Um artigo não pode ser relacionado a ele mesmo.');

  const inaccessibleImage = await createValidForm();
  inaccessibleImage.steps = [{
    id: 'step-1',
    title: 'Abra o editor',
    body: 'Configure o fluxo.',
    imageUrl: '/help/screenshots/editor.png',
  }];
  assert.equal(
    validateHelpArticleForm(inaccessibleImage),
    'Informe o texto alternativo da imagem do passo 1.',
  );

  assert.equal(validateHelpArticleForm(await createValidForm()), null);
});

test('cria formulário editável com cópia isolada das anotações persistidas', async () => {
  const { articleToForm } = await loadModel();
  const article = {
    id: 'article-1',
    category: 'Automações',
    slug: 'como-criar-automacao',
    module_key: 'automations',
    title: 'Como criar uma automação',
    summary: 'Resumo',
    content: 'Conteúdo',
    visibility: 'authenticated',
    search_keywords: [],
    route_href: null,
    action_label: null,
    steps: [{
      id: 'step-1',
      title: 'Abra o editor',
      body: 'Configure o fluxo.',
      annotations: [{ x: 10, y: 20, label: '1' }],
    }],
    related_slugs: [],
    estimated_minutes: 3,
    video_url: null,
    image_url: null,
    display_order: 10,
    is_active: true,
    last_reviewed_at: null,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
  } satisfies HelpArticle;

  const form = articleToForm(article);
  form.steps[0]?.annotations?.splice(0, 1);

  assert.equal(article.steps[0]?.annotations?.length, 1);
});
