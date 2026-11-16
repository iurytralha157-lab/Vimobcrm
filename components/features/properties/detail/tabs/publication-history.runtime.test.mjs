import assert from 'node:assert/strict';
import { before, beforeEach, afterEach, after, test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { chromium, expect } from '@playwright/test';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '../../../../..');
const ts = require('typescript'), React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const actor = '30000000-0000-4000-8000-000000000001';
const workspace = { property: { id: '20000000-0000-4000-8000-000000000001', title: 'Imóvel sintético', code: 'QA001' }, recent_key_movements: [], offers: [], ownerships: [] };
const event = (action = 'publish', status = 'succeeded', title = 'Solicitação de publicação no Site — Concluída') => ({
  id: `publication-job:${action}`, type: 'property_publication_job', title, created_at: '2026-11-15T20:30:00Z',
  metadata: { job_id: action, action, channel: 'site', status, version: 1, attempts: 1, max_attempts: 12, requested_by: actor, completed_at: null },
});
const legacy = { id: 'legacy-1', type: 'property_publication_changed', title: 'Publicação legada preservada', created_at: '2026-11-15T19:00:00Z', metadata: {} };
let directory, browser, page, bundle;
const errors = [];

// Actual dialog presentation, React SSR; unrelated primitives and hook transport are inert.
async function dialogSSR(events, users = [{ id: actor, name: 'Solicitante sintético' }]) {
  const node = ({ children }) => React.createElement('div', null, children);
  const dependencies = {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
    'lucide-react': Object.fromEntries(['AlertCircle', 'Bot', 'Clock', 'History', 'RefreshCw'].map(name => [name, () => null])),
    '@/components/ui/avatar': { Avatar: node, AvatarFallback: node, AvatarImage: () => null },
    '@/components/ui/button': { Button: node }, '@/components/ui/scroll-area': { ScrollArea: node }, '@/components/ui/skeleton': { Skeleton: node },
    '@/components/ui/dialog': Object.fromEntries(['Dialog', 'DialogContent', 'DialogDescription', 'DialogHeader', 'DialogTitle'].map(name => [name, node])),
    '@/hooks/use-properties': { usePropertyHistory: () => ({ data: events }) },
    '@/hooks/use-users': { useUsers: () => ({ data: users }) },
    '@/lib/property-display-utils': { getNullablePropertyMetadataString: value => typeof value === 'string' ? value.trim() || null : null },
    '@/lib/user-display': { getInitials: () => 'SS' },
  };
  const source = await readFile(path.join(root, 'components/features/properties/PropertyHistoryDialog.tsx'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const evaluated = { exports: {} };
  vm.runInNewContext(compiled, { module: evaluated, exports: evaluated.exports, require: name => {
    assert.ok(Object.hasOwn(dependencies, name), `unexpected dialog dependency ${name}`); return dependencies[name];
  } });
  return renderToStaticMarkup(React.createElement(evaluated.exports.PropertyHistoryDialog, { property: workspace.property, open: true, onOpenChange() {} }));
}

test('SSR real do diálogo identifica a solicitação e o solicitante, sem inventar edição', async () => {
  const html = await dialogSSR([event()]);
  assert.match(html, /Solicitação de publicação no Site — Concluída/);
  assert.match(html, /Solicitante: Solicitante sintético/);
  assert.doesNotMatch(html, /Editou o imóvel/);
});
test('SSR mantém o evento legado e a semântica anterior', async () => {
  assert.match(await dialogSSR([legacy]), /Alterou o imóvel/);
});
test('SSR não usa e-mail para identificar solicitante sem nome ou usuário removido', async () => {
  for (const users of [[], [{ id: actor, email: 'private@synthetic.invalid' }]]) {
    const html = await dialogSSR([event()], users);
    assert.match(html, /Solicitante: Sistema/);
    assert.doesNotMatch(html, /private@synthetic.invalid/);
  }
});

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'vimob-property-publication-history-'));
  const stub = path.join(directory, 'stub.tsx'), entry = path.join(directory, 'entry.tsx'), loader = path.join(directory, 'loader.cjs');
  await writeFile(stub, `import React,{createContext,useContext}from'react';export const Events=createContext([]),usePropertyHistory=()=>({data:useContext(Events),isLoading:false,isError:false});export const useUsers=()=>({data:[{id:${JSON.stringify(actor)},name:'Solicitante sintético'}]});export const MetaCreativePreview=()=>null;`);
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;`);
  await writeFile(entry, `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{Events}from'./stub';
    import{HistoryTab}from'@/components/features/properties/detail/tabs/HistoryTab';import{PropertyHistoryDialog}from'@/components/features/properties/PropertyHistoryDialog';
    import{apiPropertyHistoryResponseSchema}from'@/lib/validation/properties';
    function Fixture(){const[events,setEvents]=useState([]),[open,setOpen]=useState(false);window.h={set:rows=>setEvents(apiPropertyHistoryResponseSchema.parse({data:rows}).data)};
      return<Events.Provider value={events}><button onClick={()=>setOpen(true)}>Abrir diálogo</button><section data-testid="timeline"><HistoryTab workspace={${JSON.stringify(workspace)}} canManage={false} normalizedResourcesAvailable events={events} loading={false} error={false} fetching={false} onRetry={()=>{}} createdByName={null}/></section><PropertyHistoryDialog property={${JSON.stringify(workspace.property)}} open={open} onOpenChange={setOpen}/></Events.Provider>};createRoot(document.getElementById('app')).render(<Fixture/>);`);
  const { webpack } = require('next/dist/compiled/webpack/webpack');
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode: 'development', target: 'web', devtool: false, entry, output: { path: directory, filename: 'fixture.js' },
      plugins: [new webpack.DefinePlugin({ 'process.env': '{}' })],
      resolve: { extensions: ['.tsx', '.ts', '.js'], modules: [path.join(root, 'node_modules'), 'node_modules'], alias: {
        '@/hooks/use-properties$': stub, '@/hooks/use-users$': stub, '@/components/features/meta$': stub, '@': root,
      } }, module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] } });
    compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors() ? reject(error || Error(stats.toString({ all: false, errors: true }))) : resolve()));
  });
  bundle = await readFile(path.join(directory, 'fixture.js'), 'utf8');
  browser = await chromium.launch({ headless: true });
});
beforeEach(async () => {
  page = await browser.newPage(); page.setDefaultTimeout(5000); page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url() === 'https://property-history.invalid/'
    ? route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }) : route.abort());
  await page.goto('https://property-history.invalid/'); await page.addScriptTag({ content: bundle });
  await page.getByRole('button', { name: 'Abrir diálogo' }).waitFor();
});
afterEach(async () => { await page?.close(); });
after(async () => {
  await browser?.close();
  if (directory) { const target = path.resolve(directory); assert.equal(path.dirname(target), path.resolve(tmpdir())); assert(path.basename(target).startsWith('vimob-property-publication-history-')); await rm(target, { recursive: true, force: true }); }
  assert.deepEqual(errors, []);
});
async function set(events) { await page.evaluate(rows => window.h.set(rows), events); }

test('filtro Publicação real mantém publicar e retirar versão1, além de evento legado', async () => {
  await set([event(), event('unpublish', 'succeeded', 'Solicitação de remoção no Site — Concluída'), legacy,
    { ...legacy, id: 'price', type: 'property_price_updated', title: 'Preço alterado' }]);
  const timeline = page.getByTestId('timeline');
  await timeline.getByRole('tab', { name: 'Publicação', exact: true }).click();
  await expect(timeline.getByRole('listitem')).toHaveCount(3);
  await expect(timeline).toContainText('Solicitação de publicação no Site — Concluída');
  await expect(timeline).toContainText('Solicitação de remoção no Site — Concluída');
  await expect(timeline).toContainText('Publicação legada preservada');
  await expect(timeline).not.toContainText('Preço alterado');
  await timeline.getByRole('tab', { name: 'Tudo', exact: true }).click();
  await expect(timeline.getByRole('listitem')).toHaveCount(4);
});
for (const [status, label] of [['pending', 'Na fila'], ['processing', 'Processando'], ['retry', 'Nova tentativa agendada'], ['dead', 'Falhou'], ['superseded', 'Substituída']]) {
  test(`diálogo real apresenta ${status} sem afirmar conclusão`, async () => {
    const title = `Solicitação de publicação no Site — ${label}`;
    await set([event('publish', status, title)]);
    await page.getByRole('button', { name: 'Abrir diálogo' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(title);
    await expect(dialog).toContainText('Solicitante: Solicitante sintético');
    await expect(dialog).not.toContainText('Editou o imóvel');
    await expect(dialog).not.toContainText('Concluída');
  });
}
test('API antiga sem jobs mantém estado vazio somente no filtro Publicação', async () => {
  await set([{ ...legacy, type: 'property_updated', title: 'Cadastro atualizado' }]);
  const timeline = page.getByTestId('timeline');
  await timeline.getByRole('tab', { name: 'Publicação', exact: true }).click();
  await expect(timeline).toContainText('Nenhuma alteração registrada.');
  await timeline.getByRole('tab', { name: 'Tudo', exact: true }).click();
  await expect(timeline).toContainText('Cadastro atualizado');
});
