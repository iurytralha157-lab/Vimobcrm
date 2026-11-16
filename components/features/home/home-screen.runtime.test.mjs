import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(import.meta.dirname, '../../..');
const require = createRequire(path.join(root, 'package.json'));
const { chromium, expect } = require('@playwright/test');
const organizationId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const publicationId = '33333333-3333-4333-8333-333333333333';
let directory, browser, bundle;

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'vimob-home-screen-'));
  const entry = path.join(directory, 'fixture.tsx');
  const stubs = path.join(directory, 'stubs.tsx');
  const homeHooks = path.join(directory, 'hooks.ts');
  const api = path.join(directory, 'api.ts');
  const validation = path.join(directory, 'validation.ts');
  const loader = path.join(directory, 'loader.cjs');
  const fromRoot = (file) => JSON.stringify(path.join(root, file));

  await writeFile(stubs, `import React from 'react';
const auth = { activeOrganization: { organizationId: '${organizationId}' },
  organization: { subscription_status: 'active', status: 'active' },
  user: { id: '${userId}' }, profile: { id: '${userId}', name: 'Pessoa QA' }, isSuperAdmin: true };
export const useAuth = () => auth;
export const useOptionalActiveOrganizationId = () => auth.activeOrganization.organizationId;
export const useOrganizationModules = () => ({ hasModule: () => true, isLoading: false });
export const useUserPermissions = () => ({ hasPermission: () => true, isLoading: false });
export const AppLayout = ({ children, belowHeader }) => <main>{belowHeader}{children}</main>;
export const HomeAssistant = ({ firstName, quickActions }) => <section aria-label="Assistente">
  <h1>Olá, {firstName}</h1>
  {quickActions.map(action => <a key={action.href} href={action.href}>{action.label}</a>)}
</section>;
export const vimobAPIRequest = (route, options) => window.homeQA.request(route, options);
export default function Link({ href, children, ...props }) {
  return <a href={href} {...props}>{children}</a>;
}`);
  await writeFile(homeHooks, `export { useHomeNotices } from ${fromRoot('hooks/home/use-home-notices.ts')};
export { useHomePublications } from ${fromRoot('hooks/home/use-home.ts')};`);
  await writeFile(api, `export { homeAPI } from ${fromRoot('lib/api/home.ts')};`);
  await writeFile(validation, `export * from ${fromRoot('lib/validation/common.ts')};
export * from ${fromRoot('lib/validation/home.ts')};`);
  await writeFile(entry, `import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import HomeScreen from '@/components/features/home/HomeScreen';

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const homeQA = window.homeQA = {
  reads: [],
  request: async (route, options) => {
    homeQA.reads.push([route, options.organizationId]);
    if (route === '/v1/home/notices') return { data: [{
      id: 'notice:qa', source: 'announcement', severity: 'announcement',
      title: 'Comunicado QA', description: 'Aviso da plataforma', dismissible: false,
    }] };
    if (route === '/v1/home/publications') return { data: [{
      id: '${publicationId}', title: 'Novidade QA', body: 'Publicação da plataforma',
      ctaLabel: 'Abrir pipeline', ctaHref: '/crm/pipelines', imageUrl: null,
      cardSize: 'half', accent: 'orange', displayOrder: 0,
    }] };
    throw Error('Leitura inesperada na Home: ' + route);
  },
};
createRoot(document.getElementById('app')).render(<QueryClientProvider client={client}><HomeScreen/></QueryClientProvider>);`);
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});
module.exports=(source) => ts.transpileModule(source,{compilerOptions:{
  jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022
}}).outputText;`);
  const { webpack } = require('next/dist/compiled/webpack/webpack');
  await new Promise((resolve, reject) => {
    const compiler = webpack({
      mode: 'development',
      target: 'web',
      devtool: false,
      entry,
      output: { path: directory, filename: 'fixture.js' },
      plugins: [new webpack.NormalModuleReplacementPlugin(/(^|[/\\])vimob-client(\.ts)?$/, stubs)],
      resolve: {
        extensions: ['.tsx', '.ts', '.js'],
        modules: [path.join(root, 'node_modules'), 'node_modules'],
        alias: {
          '@/contexts/AuthContext$': stubs,
          '@/hooks/use-active-organization$': stubs,
          '@/hooks/use-organization-modules$': stubs,
          '@/hooks/use-user-permissions$': stubs,
          '@/hooks/home$': homeHooks,
          '@/lib/api$': api,
          '@/lib/validation$': validation,
          '@/components/shared/layout/AppLayout$': stubs,
          './HomeAssistant$': stubs,
          'next/link$': stubs,
          '@': root,
        },
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
    assert.ok(path.basename(target).startsWith('vimob-home-screen-'));
    await rm(target, { recursive: true, force: true });
  }
});

test('Home shows notices, publications and shortcuts with only its two active data queries', async () => {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.route('**/*', route => route.abort());
    await page.setContent('<html><body><div id="app"></div></body></html>');
    await page.evaluate(() => { globalThis.process = { env: { NODE_ENV: 'test' } }; });
    await page.addScriptTag({ content: bundle });
    await expect(page.getByRole('region', { name: 'Avisos importantes' })).toContainText('Comunicado QA');
    await expect(page.getByRole('region', { name: 'Novidades e comunicados' })).toContainText('Novidade QA');
    const assistant = page.getByRole('region', { name: 'Assistente' });
    await expect(assistant.getByRole('link', { name: 'Agenda' })).toHaveAttribute('href', '/agenda');
    await expect(page.getByRole('region', { name: 'Seu foco agora' })).toHaveCount(0);
    const reads = await page.evaluate(() => window.homeQA.reads);
    assert.deepEqual(reads.sort(), [
      ['/v1/home/notices', organizationId],
      ['/v1/home/publications', organizationId],
    ]);
  } catch (error) {
    throw new Error(JSON.stringify({
      errors,
      body: await page.locator('body').innerText(),
      reads: await page.evaluate(() => window.homeQA?.reads),
    }), { cause: error });
  } finally {
    await page.close();
  }
});
