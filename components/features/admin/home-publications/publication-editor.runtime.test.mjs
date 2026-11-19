import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(import.meta.dirname, '../../../..');
const require = createRequire(path.join(root, 'package.json'));
const { chromium, expect } = require('@playwright/test');
const labels = ['desktop — tema claro', 'celular — tema claro', 'desktop — tema escuro', 'celular — tema escuro'];
const publication = {
  id: '11111111-1111-4111-8111-111111111111', title: 'Banner QA', body: 'Texto preservado',
  ctaLabel: 'Abrir ajuda', ctaHref: '/suporte', cardSize: 'wide', accent: 'orange',
  displayOrder: 30, isActive: true, startsAt: '2026-11-01T09:00:00.000Z', endsAt: '2026-12-01T09:00:00.000Z',
  targetType: 'roles', targetRoles: ['admin'], targetOrganizationIds: [], targetUserIds: [],
  imageUrl: 'https://images.example.test/desktop.png', mobileImageUrl: 'https://images.example.test/mobile.png',
  darkImageUrl: 'https://images.example.test/desktop-dark.png', darkMobileImageUrl: 'https://images.example.test/mobile-dark.png',
  createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z',
};
let directory, browser, bundle;

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'vimob-publication-editor-'));
  const hooks = path.join(directory, 'hooks.ts');
  const validation = path.join(directory, 'validation.ts');
  const entry = path.join(directory, 'fixture.tsx');
  const loader = path.join(directory, 'loader.cjs');
  await writeFile(hooks, `
const qa = () => window.bannerEditorQA;
const mutation = (run) => ({ isPending: false, mutateAsync: run });
export const useAdminHomePublications = () => ({ data: [qa().initial], isLoading: false });
export const useCreateHomePublication = () => mutation(async input => {
  qa().calls.push(['create', input]); qa().record = { ...qa().record, ...input }; return qa().record;
});
export const useUpdateHomePublication = () => mutation(async ({ id, input }) => {
  qa().calls.push(['update', input]); qa().record = { ...qa().record, ...input }; return qa().record;
});
const upload = (variant, field) => mutation(async ({ id, file }) => {
  qa().calls.push(['upload', variant]);
  if (qa().failVariant === variant) { qa().failVariant = null; throw Error('upload failed'); }
  qa().record = { ...qa().record, [field]: 'https://images.example.test/new-' + variant + '.png' };
  return qa().record;
});
const remove = (variant, field) => mutation(async id => {
  qa().calls.push(['remove', variant]); qa().record = { ...qa().record, [field]: null };
  return { publication: qa().record };
});
export const useUploadHomePublicationImage = () => upload('desktop', 'imageUrl');
export const useUploadHomePublicationMobileImage = () => upload('mobile', 'mobileImageUrl');
export const useUploadHomePublicationDarkImage = (mobile = false) => mobile
  ? upload('mobile-dark', 'darkMobileImageUrl') : upload('desktop-dark', 'darkImageUrl');
export const useDeleteHomePublicationImage = () => remove('desktop', 'imageUrl');
export const useDeleteHomePublicationMobileImage = () => remove('mobile', 'mobileImageUrl');
export const useDeleteHomePublicationDarkImage = (mobile = false) => mobile
  ? remove('mobile-dark', 'darkMobileImageUrl') : remove('desktop-dark', 'darkImageUrl');
export const useDeleteHomePublication = () => mutation(async () => {});
export const useReorderHomePublications = () => mutation(async () => {});
export const useHomePublicationOrganizations = () => ({ data: [], isLoading: false });
export const useHomePublicationUsers = () => ({ data: [], isLoading: false });
`);
  await writeFile(validation, `export * from ${JSON.stringify(path.join(root, 'lib/validation/common.ts'))};
export * from ${JSON.stringify(path.join(root, 'lib/validation/home.ts'))};`);
  await writeFile(entry, `import React from 'react';
import { createRoot } from 'react-dom/client';
import { HomePublicationsContent } from '@/components/features/admin/HomePublicationsContent';
const initial = ${JSON.stringify(publication)};
window.bannerEditorQA = { initial, record: { ...initial }, calls: [], failVariant: null };
createRoot(document.getElementById('app')).render(<HomePublicationsContent/>);`);
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});
module.exports=(source) => ts.transpileModule(source,{compilerOptions:{
jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022
}}).outputText;`);
  const { webpack } = require('next/dist/compiled/webpack/webpack');
  await new Promise((resolve, reject) => {
    const compiler = webpack({
      mode: 'development', target: 'web', devtool: false, entry,
      output: { path: directory, filename: 'fixture.js' },
      resolve: {
        extensions: ['.tsx', '.ts', '.js'], modules: [path.join(root, 'node_modules'), 'node_modules'],
        alias: { '@/hooks/home$': hooks, '@/lib/validation$': validation, '@': root },
      },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] },
    });
    compiler.run((error, stats) => compiler.close(() =>
      error || stats.hasErrors() ? reject(error || Error(stats.toString({ all: false, errors: true }))) : resolve()));
  });
  bundle = await readFile(path.join(directory, 'fixture.js'), 'utf8');
  browser = await chromium.launch({ headless: true });
}, { timeout: 180_000 });

after(async () => {
  await browser?.close();
  if (directory) {
    const target = path.resolve(directory);
    assert.equal(path.dirname(target), path.resolve(tmpdir()));
    assert.ok(path.basename(target).startsWith('vimob-publication-editor-'));
    await rm(target, { recursive: true, force: true });
  }
});

async function openEditor() {
  const page = await browser.newPage();
  page.setDefaultTimeout(7_000);
  await page.route('**/*', route => route.abort());
  await page.setContent(`<html><head><style>
    svg { width: 16px; height: 16px; }
    img { position: static !important; width: 160px !important; height: 96px !important; }
    [role="dialog"] { position: fixed; inset: 0; z-index: 10; overflow-y: auto; background: white; }
  </style></head><body><div id="app"></div></body></html>`);
  await page.evaluate(() => { globalThis.process = { env: { NODE_ENV: 'test' } }; });
  await page.addScriptTag({ content: bundle });
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  return page;
}

test('four independent image fields preview, remove selection, restore saved image and cancel without writes', async () => {
  const page = await openEditor();
  try {
    for (const label of labels) await expect(page.getByLabel(`Imagem para ${label}`, { exact: true })).toHaveCount(1);
    await expect(page.getByRole('dialog').getByRole('img', { name: publication.title })).toHaveCount(4);
    await page.getByLabel('Imagem para desktop — tema escuro', { exact: true }).setInputFiles({ name: 'nova.png', mimeType: 'image/png', buffer: Buffer.from('image') });
    await page.getByRole('button', { name: 'Remover seleção Desktop — tema escuro', exact: true }).click();
    await expect(page.getByRole('dialog').locator('img[src="https://images.example.test/desktop-dark.png"]')).toHaveCount(1);
    await page.getByRole('button', { name: 'Remover imagem Celular — tema escuro', exact: true }).click();
    await expect(page.getByRole('dialog').locator('img')).toHaveCount(3);
    await page.getByRole('button', { name: 'Restaurar imagem Celular — tema escuro atual', exact: true }).click();
    await expect(page.getByRole('dialog').locator('img')).toHaveCount(4);
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.bannerEditorQA.calls), []);
  } finally { await page.close(); }
});

test('partial upload failure retains only the unfinished selection and retry preserves audience, schedule and order', async () => {
  const page = await openEditor();
  try {
    await page.evaluate(() => { window.bannerEditorQA.failVariant = 'mobile-dark'; });
    for (const label of labels) {
      await page.getByLabel(`Imagem para ${label}`, { exact: true }).setInputFiles({ name: 'nova.png', mimeType: 'image/png', buffer: Buffer.from('image') });
    }
    await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('O rascunho continua pausado');
    await expect(page.getByRole('button', { name: /^Remover seleção/ })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Remover seleção Celular — tema escuro', exact: true })).toHaveCount(1);
    assert.equal(await page.evaluate(() => window.bannerEditorQA.record.isActive), false);
    await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const result = await page.evaluate(() => ({ calls: window.bannerEditorQA.calls, record: window.bannerEditorQA.record }));
    assert.deepEqual(result.calls.filter(call => call[0] === 'upload').map(call => call[1]), ['desktop', 'mobile', 'desktop-dark', 'mobile-dark', 'mobile-dark']);
    assert.equal(result.calls.filter(call => call[0] === 'create').length, 0);
    assert.equal(result.record.isActive, true);
    for (const field of ['displayOrder', 'startsAt', 'endsAt', 'targetType']) assert.equal(result.record[field], publication[field]);
    assert.deepEqual(result.record.targetRoles, publication.targetRoles);
    assert.equal(result.record.id, publication.id);
  } finally { await page.close(); }
});
