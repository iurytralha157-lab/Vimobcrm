import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// Actual picker, useTags/useCreateTag, operation fence, React Query and Radix.
// Only auth/permission input and the transport are synthetic; no real network.
const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
let directory, browser, page, bundle, styles;
const errors = [];

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vimob-lead-tag-picker-'));
  const stub = join(directory, 'stub.tsx'), api = join(directory, 'api.ts'), entry = join(directory, 'entry.tsx'), loader = join(directory, 'loader.cjs');
  await writeFile(stub, `import{createContext,useContext}from'react';export const Auth=createContext(null);export const useAuth=()=>useContext(Auth);export const useUserPermissions=()=>{const auth=useAuth();return{hasPermission:key=>auth.permissions.includes(key)}};`);
  await writeFile(api, `export const tagsAPI={list:org=>window.h.request('list',{org}),catalog:(org,options)=>window.h.request('catalog',{org,options}),create:(input,org)=>window.h.request('create',{org,input})};`);
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;`);
  await writeFile(entry, `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';
    import{LeadTagPickerContent}from'@/components/features/leads/lead-detail/LeadTagPickerContent';import{TagSelector,InlineTagSelector,TagSelectorPopoverContent}from'@/components/ui/tag-selector';import{useTags}from'@/hooks/use-tags';import{Popover,PopoverContent,PopoverTrigger}from'@/components/ui/popover';import{Auth}from'./stub';
    const token=(uid,sid)=>'header.'+btoa(JSON.stringify({sub:uid,session_id:sid}))+'.synthetic';
    const h=window.h={requests:[],added:[],removed:[],toggled:[],closed:0};h.request=(kind,input)=>new Promise((resolve,reject)=>h.requests.push({kind,input,resolve,reject}));
    const client=h.client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity},mutations:{retry:false}}});
    function LegacyPopover({assigned,add,close}){const{data=[]}=useTags();return <TagSelectorPopoverContent availableTags={data.filter(tag=>!assigned.includes(tag.id))} onAddTag={add} onClose={close}/>}
    function Fixture(){const[scope,setScope]=useState({org:'org-a',uid:'user-a',sid:'sid-a',permissions:['tag_manage']}),[assigned,setAssigned]=useState(['assigned']),[shown,setShown]=useState(false),[disabled,setDisabled]=useState(false),[lead,setLead]=useState('lead-a'),[kind,setKind]=useState('modern');
      h.scope=scope;h.currentLead=lead;h.replace=patch=>setScope(old=>({...old,...patch}));h.assigned=setAssigned;h.disable=setDisabled;h.show=setShown;h.lead=setLead;h.kind=kind;h.pickKind=setKind;h.selection=assigned;
      const add=id=>{h.added.push(id);setAssigned(old=>old.includes(id)?old:[...old,id])},remove=id=>{h.removed.push(id);setAssigned(old=>old.filter(value=>value!==id))},toggle=id=>{h.toggled.push(id);setAssigned(old=>old.includes(id)?old.filter(value=>value!==id):[...old,id])},close=()=>{h.closed++;setShown(false)};
      return <Auth.Provider value={{activeOrganization:{organizationId:scope.org},user:{id:scope.uid},session:{access_token:token(scope.uid,scope.sid)},permissions:scope.permissions}}><QueryClientProvider client={client}>
        {kind==='selector'?<TagSelector selectedTagIds={assigned} onSelectTag={add} onRemoveTag={remove} placeholder='Adicionar tag'/>:kind==='inline'?<InlineTagSelector selectedTagIds={assigned} onToggleTag={toggle}/>:<Popover open={shown} onOpenChange={setShown}><PopoverTrigger asChild><button>Adicionar tag</button></PopoverTrigger><PopoverContent className='w-64 max-w-[calc(100vw-24px)] p-0' align='start' collisionPadding={12}>
          {kind==='popover'?<LegacyPopover assigned={assigned} add={add} close={close}/>:
          <LeadTagPickerContent leadId={lead} assignedTagIds={assigned} disabled={disabled} onAddTag={tag=>{h.added.push(tag);if(h.rejectAddition)return Promise.reject(Error('Synthetic association rejection'));if(h.deferAddition)return new Promise(resolve=>{h.finishAddition=resolve})}} onClose={()=>{h.closed++;setShown(false)}}/>
          }</PopoverContent></Popover>}</QueryClientProvider></Auth.Provider>}
    createRoot(document.getElementById('app')).render(<Fixture/>);`);
  const { webpack } = require('next/dist/compiled/webpack/webpack');
  await new Promise((done, reject) => {
    const compiler = webpack({ mode: 'development', target: 'web', devtool: false, entry, output: { path: directory, filename: 'fixture.js' },
      resolve: { extensions: ['.tsx', '.ts', '.js'], modules: [join(root, 'node_modules'), 'node_modules'], alias: { '@/contexts/AuthContext$': stub, '@/hooks/use-user-permissions$': stub, '@/lib/api/tags$': api, '@': root } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] } });
    compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors() ? reject(error || Error(stats.toString({ all: false, errors: true }))) : done()));
  });
  bundle = await readFile(join(directory, 'fixture.js'), 'utf8');
  const postcss = require('postcss'), tailwind = require('@tailwindcss/postcss');
  const globals = (await readFile(join(root, 'app/globals.css'), 'utf8')).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);');
  const sources = ['components/features/leads/lead-detail/LeadTagPickerContent.tsx', 'components/ui'].map(path => `@source "${join(root, path).replaceAll('\\', '/')}";`).join('\n');
  styles = (await postcss([tailwind({ base: root })]).process(`${globals}\n${sources}`, { from: join(root, 'app/globals.css') })).css;
  browser = await chromium.launch({ headless: true });
}, { timeout: 120_000 });

beforeEach(async () => {
  page = await browser.newPage({ viewport: { width: 360, height: 640 } }); page.setDefaultTimeout(5_000);
  page.on('pageerror', error => errors.push(error.message)); await page.route('**/*', route => route.abort());
  await page.setContent('<html class="light"><body><div id="app"></div></body></html>');
  await page.addStyleTag({ content: styles }); await page.addScriptTag({ content: bundle });
  await page.getByRole('button', { name: 'Adicionar tag' }).waitFor();
});
afterEach(async () => page?.close());
after(async () => {
  await browser?.close();
  if (directory) { const target = resolve(directory); assert.equal(dirname(target), resolve(tmpdir())); assert(target.split(/[/\\]/).at(-1).startsWith('vimob-lead-tag-picker-')); await rm(target, { recursive: true, force: true }); }
  assert.deepEqual(errors, []);
});

const tags = [
  { id: 'assigned', name: 'Já atribuída', color: '#287a56', organization_id: 'org-a' },
  { id: 'available', name: 'Visitação', color: '#f97316', organization_id: 'org-a' },
];
async function open() { await page.getByRole('button', { name: 'Adicionar tag' }).click(); await page.getByRole('textbox', { name: 'Buscar tags' }).waitFor(); await page.waitForFunction(() => window.h.requests.length > 0); }
async function respond(index = 0, data = tags) { await page.evaluate(({ index, data }) => window.h.requests[index].resolve(data), { index, data }); }
async function reject(index = 0) { await page.evaluate(index => window.h.requests[index].reject(Object.assign(Error('Synthetic rejection'), { status: 400 })), index); }
async function requestCount() { return page.evaluate(() => window.h.requests.length); }
async function replace(patch) { await page.evaluate(patch => window.h.replace(patch), patch); await page.waitForFunction(patch => Object.entries(patch).every(([key, value]) => JSON.stringify(window.h.scope[key]) === JSON.stringify(value)), patch); }

test('catalog loads only on opening; loading is not empty and the mobile search stays 16px', async () => {
  assert.equal(await requestCount(), 0); await open();
  await page.getByText('Carregando tags...', { exact: true }).waitFor();
  assert.equal(await page.getByText('Nenhuma tag cadastrada nesta organização.', { exact: true }).count(), 0);
  assert.equal(await page.getByRole('textbox', { name: 'Buscar tags' }).evaluate(node => getComputedStyle(node).fontSize), '16px');
  const input = await page.evaluate(() => ({ org: window.h.requests[0].input.org, user: window.h.requests[0].input.options.expectedUserId, session: window.h.requests[0].input.options.expectedSessionId }));
  assert.deepEqual(input, { org: 'org-a', user: 'user-a', session: 'sid-a' });
});

test('assigned tags remain searchable and checked; an existing available tag adds its catalog DTO once', async () => {
  await open(); await respond();
  assert.equal(await page.getByRole('button', { name: 'Já atribuída, já adicionada' }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Já atribuída, já adicionada' }).getAttribute('aria-pressed'), 'true');
  if (process.env.PIPELINE_VISUAL_ARTIFACT_DIR) {
    await mkdir(process.env.PIPELINE_VISUAL_ARTIFACT_DIR, { recursive: true });
    await page.locator('.vimob-popover-content').screenshot({ path: join(process.env.PIPELINE_VISUAL_ARTIFACT_DIR, 'lead-tags-mobile-360.png'), animations: 'disabled' });
  }
  await page.getByRole('textbox', { name: 'Buscar tags' }).fill('VISITACAO');
  await page.getByRole('button', { name: 'Visitação', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.h.added), [tags[1]]); assert.equal(await page.evaluate(() => window.h.closed), 1);
  assert.equal(await page.evaluate(() => window.h.requests.some(request => request.kind === 'create')), false);
});

test('all assigned is distinguished from an empty organization and cannot create duplicate names', async () => {
  await open(); await respond(0, [tags[0]]); await page.getByText('Todas as tags já estão neste lead.', { exact: true }).waitFor();
  assert.equal(await page.getByText('Nenhuma tag cadastrada nesta organização.', { exact: true }).count(), 0);
  await page.getByRole('textbox', { name: 'Buscar tags' }).fill('ja atribuida');
  assert.equal(await page.getByRole('button', { name: 'Criar nova tag', exact: true }).isDisabled(), true);
  assert.equal(await page.evaluate(() => window.h.added.length), 0);
});

test('association rejection remains owned by the lead action without an unhandled picker promise', async () => {
  await open(); await respond(); await page.evaluate(() => { window.h.rejectAddition = true; });
  await page.getByRole('button', { name: 'Visitação', exact: true }).click();
  await page.getByRole('textbox', { name: 'Buscar tags' }).waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => window.h.added.length), 1); assert.equal(await page.evaluate(() => window.h.closed), 1);
});

test('failed reads show retry rather than no tags or create; retry recovers the real query', async () => {
  await open(); await reject(); await page.getByRole('alert').waitFor();
  assert.equal(await page.getByRole('alert').innerText(), 'Não foi possível carregar as tags.');
  assert.equal(await page.getByText('Nenhuma tag cadastrada nesta organização.', { exact: true }).count(), 0);
  await page.getByRole('textbox', { name: 'Buscar tags' }).fill('Nova');
  assert.equal(await page.getByRole('button', { name: 'Criar "Nova"', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: 'Tentar novamente' }).click(); await page.waitForFunction(() => window.h.requests.length === 2); await respond(1);
  await page.getByRole('textbox', { name: 'Buscar tags' }).fill(''); await page.getByRole('button', { name: 'Visitação', exact: true }).waitFor();
  assert.equal(await page.getByRole('alert').count(), 0);
});

test('successful empty and unmatched searches have different messages; Enter never creates', async () => {
  await open(); await respond(0, []); await page.getByText('Nenhuma tag cadastrada nesta organização.', { exact: true }).waitFor();
  await page.getByRole('textbox', { name: 'Buscar tags' }).fill('Nova'); await page.getByRole('textbox', { name: 'Buscar tags' }).press('Enter');
  assert.equal(await requestCount(), 1); await page.getByRole('button', { name: 'Criar "Nova"', exact: true }).click();
  await page.waitForFunction(() => window.h.requests.some(request => request.kind === 'create'));
  await page.evaluate(tag => window.h.requests.find(request => request.kind === 'create').resolve(tag), { ...tags[1], name: 'Nova' });
  await page.waitForFunction(() => window.h.added.length === 1); assert.equal(await page.evaluate(() => window.h.added[0].name), 'Nova');
});

test('no match is explicit and creation is hidden without tag management permission', async () => {
  await replace({ permissions: [] }); await open(); await respond();
  await page.getByRole('textbox', { name: 'Buscar tags' }).fill('Inexistente'); await page.getByText('Nenhuma tag encontrada.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: /Criar/ }).count(), 0);
  await page.getByRole('textbox', { name: 'Buscar tags' }).press('Enter'); assert.equal(await requestCount(), 1);
});

test('finishing an old create association cannot close a reopened picker', async () => {
  await open(); await respond(); await page.evaluate(() => { window.h.deferAddition = true; });
  await page.getByRole('textbox', { name: 'Buscar tags' }).fill('Nova');
  await page.getByRole('button', { name: 'Criar "Nova"', exact: true }).click();
  await page.waitForFunction(() => window.h.requests.some(request => request.kind === 'create'));
  await page.evaluate(tag => window.h.requests.find(request => request.kind === 'create').resolve(tag), { ...tags[1], name: 'Nova' });
  await page.getByRole('textbox', { name: 'Buscar tags' }).waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => window.h.closed), 1);
  await page.getByRole('button', { name: 'Adicionar tag' }).click(); await page.getByRole('textbox', { name: 'Buscar tags' }).waitFor();
  await page.evaluate(async () => { window.h.finishAddition(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  assert.equal(await page.getByRole('textbox', { name: 'Buscar tags' }).isVisible(), true); assert.equal(await page.evaluate(() => window.h.closed), 1);
});

for (const patch of [{ org: 'org-b' }, { uid: 'user-b', sid: 'sid-b' }, { sid: 'sid-b' }]) test('catalog scope replacement never displays old tags: ' + JSON.stringify(patch), async () => {
  await open(); await respond(); await page.getByRole('button', { name: 'Visitação', exact: true }).waitFor();
  await replace(patch); await page.getByText('Carregando tags...', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Visitação', exact: true }).count(), 0);
});

for (const replacement of ['close', 'organization', 'session', 'permission', 'lead']) test('late explicit creation cannot attach to retired ' + replacement + ' scope', async () => {
  await open(); await respond(); await page.getByRole('textbox', { name: 'Buscar tags' }).fill('Nova');
  await page.getByRole('button', { name: 'Criar "Nova"', exact: true }).click(); await page.waitForFunction(() => window.h.requests.some(request => request.kind === 'create'));
  if (replacement === 'close') { await page.evaluate(() => window.h.show(false)); await page.getByRole('textbox', { name: 'Buscar tags' }).waitFor({ state: 'detached' }); }
  if (replacement === 'organization') await replace({ org: 'org-b' });
  if (replacement === 'session') await replace({ sid: 'sid-b' });
  if (replacement === 'permission') await replace({ permissions: [] });
  if (replacement === 'lead') { await page.evaluate(() => window.h.lead('lead-b')); await page.waitForFunction(() => window.h.currentLead === 'lead-b'); }
  await page.evaluate(tag => window.h.requests.find(request => request.kind === 'create').resolve(tag), { ...tags[1], name: 'Nova' });
  await page.waitForTimeout(75); assert.equal(await page.evaluate(() => window.h.added.length), 0); assert.equal(await page.evaluate(() => window.h.closed), 0);
});

const legacyKinds = ['selector', 'inline', 'popover'];
async function legacy(kind) {
  await page.evaluate(kind => window.h.pickKind(kind), kind);
  await page.waitForFunction(kind => window.h.kind === kind, kind);
  if (kind === 'popover') await page.getByRole('button', { name: 'Adicionar tag', exact: true }).click();
  await page.waitForFunction(() => window.h.requests.some(request => request.kind === 'list'));
  const index = await page.evaluate(() => window.h.requests.findIndex(request => request.kind === 'list'));
  await respond(index);
  if (kind === 'selector') await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
  await page.getByText('Visitação', { exact: true }).waitFor();
}
function legacyInput(kind) {
  return kind === 'inline' ? page.getByPlaceholder('Nome da nova tag...') : page.getByRole('textbox', { name: /^Buscar/ });
}
function legacyCreateButton(kind) {
  return kind === 'inline'
    ? page.getByPlaceholder('Nome da nova tag...').locator('..').getByRole('button')
    : page.getByRole('button', { name: /^Criar/ });
}
async function createRequestCount() {
  return page.evaluate(() => window.h.requests.filter(request => request.kind === 'create').length);
}

for (const kind of legacyKinds) {
  test(`${kind}: no tag_manage hides global creation but keeps catalog selection`, async () => {
    await replace({ permissions: [] }); await legacy(kind);
    if (kind === 'inline') assert.equal(await legacyInput(kind).count(), 0);
    else {
      assert.equal(await page.getByRole('button', { name: /^Criar/ }).count(), 0);
      assert.equal(await legacyInput(kind).getAttribute('placeholder'), 'Buscar tag...');
    }
    assert.equal(await page.getByText('Visitação', { exact: true }).isVisible(), true);
    assert.equal(await createRequestCount(), 0);
  });

  test(`${kind}: Enter without tag_manage cannot submit a create request`, async () => {
    await replace({ permissions: [] }); await legacy(kind);
    const input = legacyInput(kind);
    if (await input.count()) { await input.fill('Sem permissão'); await input.press('Enter'); }
    await page.waitForTimeout(50);
    assert.equal(await createRequestCount(), 0);
    assert.deepEqual(await page.evaluate(() => window.h.selection), ['assigned']);
  });

  test(`${kind}: an existing tag remains selectable without tag_manage`, async () => {
    await replace({ permissions: [] }); await legacy(kind);
    await page.getByText('Visitação', { exact: true }).click();
    await page.waitForFunction(() => window.h.selection.includes('available'));
    assert.equal(await createRequestCount(), 0);
  });

  for (const gesture of ['button', 'Enter']) test(`${kind}: tag_manage preserves creation by ${gesture}`, async () => {
    await legacy(kind); await legacyInput(kind).fill('  Nova permitida  ');
    if (gesture === 'Enter') await legacyInput(kind).press('Enter');
    else await legacyCreateButton(kind).click();
    await page.waitForFunction(() => window.h.requests.some(request => request.kind === 'create'));
    const request = await page.evaluate(() => window.h.requests.find(request => request.kind === 'create').input);
    assert.equal(request.org, 'org-a'); assert.equal(request.input.name, 'Nova permitida');
    assert.equal(await createRequestCount(), 1);
    await page.evaluate(tag => window.h.requests.find(request => request.kind === 'create').resolve(tag), { ...tags[1], id: 'created', name: 'Nova permitida' });
    await page.waitForFunction(() => window.h.selection.includes('created'));
  });

  test(`${kind}: revoking permission in an open picker blocks Enter without removing associations`, async () => {
    await legacy(kind); await legacyInput(kind).fill('Nova revogada');
    await replace({ permissions: [] });
    if (kind === 'inline') assert.equal(await legacyInput(kind).count(), 0);
    else {
      await legacyInput(kind).press('Enter');
      assert.equal(await page.getByRole('button', { name: /^Criar/ }).count(), 0);
    }
    await page.waitForTimeout(50);
    assert.equal(await createRequestCount(), 0);
    assert.deepEqual(await page.evaluate(() => window.h.selection), ['assigned']);
    await replace({ permissions: ['tag_manage'] });
    assert.equal(await legacyInput(kind).isVisible(), true);
    assert.equal(await createRequestCount(), 0, 'restoring permission does not submit automatically');
  });

  test(`${kind}: another tenant without tag_manage cannot inherit the old creation affordance`, async () => {
    await legacy(kind); await legacyInput(kind).fill('Rascunho do tenant A');
    await replace({ org: 'org-b', permissions: [] });
    await page.waitForFunction(() => window.h.requests.some(request => request.kind === 'list' && request.input.org === 'org-b'));
    const index = await page.evaluate(() => window.h.requests.findIndex(request => request.kind === 'list' && request.input.org === 'org-b'));
    await respond(index, []);
    if (kind === 'inline') {
      assert.equal(await legacyInput(kind).count(), 0);
      await page.getByText('Nenhuma tag disponível.', { exact: true }).waitFor();
    } else {
      assert.equal(await page.getByRole('button', { name: /^Criar/ }).count(), 0);
      await legacyInput(kind).press('Enter');
    }
    assert.equal(await createRequestCount(), 0);
    assert.deepEqual(await page.evaluate(() => window.h.selection), ['assigned']);
  });
}

for (const kind of ['selector', 'inline']) test(`${kind}: removal of an existing association does not require global tag management`, async () => {
  await replace({ permissions: [] }); await legacy(kind);
  if (kind === 'selector') {
    await page.keyboard.press('Escape');
    await page.getByText('Já atribuída', { exact: true }).getByRole('button').click();
  } else await page.getByText('Já atribuída', { exact: true }).click();
  await page.waitForFunction(() => !window.h.selection.includes('assigned'));
  assert.equal(await createRequestCount(), 0);
});
