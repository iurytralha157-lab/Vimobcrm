import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(import.meta.dirname, '../../..');
const require = createRequire(path.join(root, 'package.json'));
const { chromium, expect } = require('@playwright/test');
const orgA = '11111111-1111-4111-8111-111111111111', orgB = '22222222-2222-4222-8222-222222222222';
const userA = '33333333-3333-4333-8333-333333333333', userB = '44444444-4444-4444-8444-444444444444';
const leadId = '55555555-5555-4555-8555-555555555555';
let directory, browser, bundle;

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'vimob-home-focus-'));
  const entry = path.join(directory, 'fixture.tsx'), stubs = path.join(directory, 'stubs.tsx');
  const api = path.join(directory, 'api.ts'), hooks = path.join(directory, 'hooks.ts');
  const validation = path.join(directory, 'validation.ts'), loader = path.join(directory, 'loader.cjs');
  // Actual HomeScreen, HomeFocusList, overview hook, home API and Zod. Auth,
  // access capabilities, unrelated Home slots and transport are synthetic.
  await writeFile(stubs, `import React,{createContext,useContext}from'react';
export const Auth=createContext(null),useAuth=()=>useContext(Auth);
export const useOrganizationModules=()=>{const a=useAuth();return{hasModule:key=>key==='crm',isLoading:!!a.modulesLoading}};
export const useUserAccessScope=()=>{const a=useAuth();return{isAdmin:a.kind==='admin',isTeamLeader:a.kind==='leader',canViewAllLeads:a.kind==='admin'}};
export const useHomeNotices=()=>({data:[]}),useHomePublications=()=>({data:[{id:'slide-qa',imageUrl:'https://image.invalid/qa.png',displayOrder:0}],isLoading:false,isError:false,refetch:async()=>{}});
export const AppLayout=({children,belowHeader})=><main>{belowHeader}{children}</main>;
export const HomeAssistant=()=> <section aria-label="Assistente atual">Assistente preservado</section>;
export const HomeNoticeRail=()=> <aside>Avisos preservados</aside>;
export const HomePublicationCarousel=()=> <section aria-label="Novidades e comunicados">Carrossel preservado</section>;
export const vimobAPIRequest=(route,options)=>window.h.request(route,options);
export class VimobAPIError extends Error{};
`);
  await writeFile(hooks, `import{useHomeOverview as useRealHomeOverview}from${JSON.stringify(path.join(root, 'hooks/home/use-home-overview.ts'))};export function useHomeOverview(...args){const result=useRealHomeOverview(...args);window.h.overview=result;return result;}export{useHomeNotices,useHomePublications}from'./stubs';`);
  await writeFile(api, `export{homeAPI}from${JSON.stringify(path.join(root, 'lib/api/home.ts'))};export const getDashboardUpcomingTasks=async()=>[{id:'66666666-6666-4666-8666-666666666666',title:'Tarefa permitida',lead_id:'${leadId}',due_date:'2026-11-15T22:30:00Z'}];export const scheduleAPI={getScheduleEvents:async()=>[]};`);
  await writeFile(validation, `export*from${JSON.stringify(path.join(root, 'lib/validation/common.ts'))};export*from${JSON.stringify(path.join(root, 'lib/validation/home.ts'))};`);
  await writeFile(entry, `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{Auth}from'./stubs';import HomeScreen from'@/components/features/home/HomeScreen';
const h=window.h={reads:[],phase:'due',fail:false};const client=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});h.client=client;
h.request=async(route,options)=>{if(route!=='/v1/home/focus')throw Error('Unexpected API request '+route);h.reads.push({route,organizationId:options.organizationId,query:options.query});if(h.fail)throw Error('Synthetic service failure');const phase=h.phase;return{data:[{id:phase==='due'?'task:qa':'attention:qa',kind:phase==='due'?'task':'attention',obligation_key:'cadence_task:qa',lead_id:'${leadId}',lead_name:'Lead QA',title:'Cadência '+(options.organizationId==='${orgB}'?'B':'A'),description:'Funil QA · Entrada QA',due_at:'2026-11-15T22:20:00Z',status:phase,tone:phase==='warning'?'warning':phase==='breached'?'critical':'neutral',policy_type:'cadence_task',task_type:'task',target_url:'/crm/pipelines?lead=${leadId}'}]}};
function Fixture(){const[state,setState]=useState({org:'${orgA}',user:'${userA}',kind:'admin',allowed:true});h.update=patch=>setState(old=>({...old,...patch}));h.identity=state;
const permissions=state.allowed?['lead_view_own',...(state.focusDenied?['dashboard_view']:['attention_view']),...(state.kind==='admin'?['lead_view_all']:[])]:[];
const auth={kind:state.kind,activeOrganization:{organizationId:state.org},organization:{id:state.org,subscription_status:state.billingBlocked?'blocked':'active',status:'active'},user:{id:state.user},profile:{id:state.user,name:'Pessoa QA'},tenantContext:{organizationId:state.org,userId:state.user,memberRole:state.kind==='admin'?'admin':'user',permissions},loading:!!state.pending,modulesLoading:!!state.modulesLoading,isSuperAdmin:false};
return<Auth.Provider value={auth}><QueryClientProvider client={client}><HomeScreen/></QueryClientProvider></Auth.Provider>};createRoot(document.getElementById('app')).render(<Fixture/>);`);
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;`);
  const { webpack } = require('next/dist/compiled/webpack/webpack');
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode: 'development', target: 'web', devtool: false, entry, output: { path: directory, filename: 'fixture.js' }, plugins: [new webpack.NormalModuleReplacementPlugin(/(^|[/\\])vimob-client(\.ts)?$/, stubs)], resolve: { extensions: ['.tsx', '.ts', '.js'], modules: [path.join(root, 'node_modules'), 'node_modules'], alias: { '@/contexts/AuthContext$': stubs, '@/hooks/use-organization-modules$': stubs, '@/hooks/use-user-access-scope$': stubs, '@/hooks/home$': hooks, '@/lib/api$': api, '@/lib/validation$': validation, '@/components/shared/layout/AppLayout$': stubs, './HomeAssistant$': stubs, './HomeNoticeRail$': stubs, './HomePublicationCarousel$': stubs, '@': root } }, module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] } });
    compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors() ? reject(error || Error(stats.toString({ all: false, errors: true }))) : resolve()));
  });
  bundle = await readFile(path.join(directory, 'fixture.js'), 'utf8');
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
  if (!directory) return;
  const target = path.resolve(directory);
  assert.ok(target.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(target).startsWith('vimob-home-focus-'));
  await rm(target, { recursive: true, force: true });
});

async function fixture() {
  const page = await browser.newPage(), errors = [], network = [];
  page.setDefaultTimeout(3000);
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { globalThis.process = { env: { NODE_ENV: 'test' } }; });
  await page.route('**/*', route => {
    const url = route.request().url(); network.push(url);
    if (url === 'https://home-focus.invalid/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><div id="app"></div></body></html>' });
    if (url === 'https://home-focus.invalid/crm/pipelines?lead=' + leadId) return route.fulfill({ contentType: 'text/html', body: '<h1>Lead QA autorizado</h1>' });
    return route.abort();
  });
  await page.goto('https://home-focus.invalid/');
  await page.addScriptTag({ content: bundle });
  try { await page.getByRole('region', { name: 'Assistente atual' }).waitFor(); }
  catch (error) { throw new Error(JSON.stringify({ errors, body: await page.locator('body').innerText() }), { cause: error }); }
  return { page, errors, network };
}

test('Home mounts its real focus hook and cadence surface below the preserved Home content', async () => {
  const { page, errors } = await fixture();
  try {
    const focus = page.getByRole('region', { name: 'Seu foco agora' });
    await expect(focus).toBeVisible();
    await expect(focus.getByText('Cadência A', { exact: true })).toBeVisible();
    await expect(focus.getByRole('button', { name: 'Meu foco', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const order = await page.locator('section[aria-label="Novidades e comunicados"],section[aria-label="Assistente atual"],#home-focus').evaluateAll(nodes => nodes.map(node => node.id || node.getAttribute('aria-label')));
    assert.deepEqual(order, ['Novidades e comunicados', 'Assistente atual', 'home-focus']);
    const query = await page.evaluate(() => { const q = window.h.client.getQueryCache().getAll().find(q => q.queryKey[0] === 'home' && q.queryKey[1] === 'focus'); return { key: q.queryKey, interval: q.options.refetchInterval, background: q.options.refetchIntervalInBackground, enabled: q.options.enabled }; });
    assert.deepEqual(query.key, ['home', 'focus', orgA, userA, 'mine']);
    assert.equal(query.interval, 15000); assert.equal(query.background, false); assert.equal(query.enabled, true);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('cadence due, warning and breach are rendered by the real hook and link opens the lead', async () => {
  const { page, errors } = await fixture();
  try {
    const focus = page.getByRole('region', { name: 'Seu foco agora' });
    await expect(focus.getByText('Prioridade', { exact: true })).toBeVisible();
    await page.evaluate(async () => { window.h.phase = 'warning'; await window.h.client.invalidateQueries({ queryKey: ['home', 'focus'] }); });
    await expect(focus.getByText('Próximo do limite', { exact: true })).toBeVisible();
    await page.evaluate(async () => { window.h.phase = 'breached'; await window.h.client.invalidateQueries({ queryKey: ['home', 'focus'] }); });
    await expect(focus.getByText('Tempo excedido', { exact: true })).toBeVisible();
    const link = focus.getByRole('link', { name: /Cadência A/ });
    await expect(link).toHaveAttribute('href', '/crm/pipelines?lead=' + leadId);
    await link.click(); await page.waitForURL('https://home-focus.invalid/crm/pipelines?lead=' + leadId);
    await expect(page.getByRole('heading', { name: 'Lead QA autorizado' })).toBeVisible();
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('team and organization scopes follow current capabilities and revoked scope returns to mine', async () => {
  const { page, errors } = await fixture();
  try {
    const focus = page.getByRole('region', { name: 'Seu foco agora' });
    await focus.getByRole('button', { name: 'Organização', exact: true }).click();
    await expect(focus.getByRole('button', { name: 'Organização', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.waitForFunction(() => window.h.reads.at(-1)?.query.scope === 'organization');
    await page.evaluate(() => window.h.update({ kind: 'leader' }));
    await expect(focus.getByRole('button', { name: 'Organização', exact: true })).toHaveCount(0);
    await expect(focus.getByRole('button', { name: 'Meu foco', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await focus.getByRole('button', { name: 'Equipe', exact: true }).click();
    await page.waitForFunction(() => window.h.reads.at(-1)?.query.scope === 'team');
    await page.evaluate(() => window.h.update({ kind: 'regular' }));
    await expect(focus.getByRole('button', { name: 'Equipe', exact: true })).toHaveCount(0);
    await expect(focus.getByRole('button', { name: 'Organização', exact: true })).toHaveCount(0);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('a visible Home observes a new cadence warning through its 15-second polling without invalidation', async () => {
  const { page, errors } = await fixture();
  try {
    const focus = page.getByRole('region', { name: 'Seu foco agora' });
    await expect(focus.getByText('Prioridade', { exact: true })).toBeVisible();
    const reads = await page.evaluate(() => { window.h.phase = 'warning'; return window.h.reads.length; });
    await expect(focus.getByText('Próximo do limite', { exact: true })).toBeVisible({ timeout: 20000 });
    await expect(focus.getByText('Cadência', { exact: true })).toBeVisible();
    assert.ok(await page.evaluate(() => window.h.reads.length) > reads);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('the mounted Home keeps different tenant/actor feed keys separate', async () => {
  const { page, errors } = await fixture();
  try {
    const focus = page.getByRole('region', { name: 'Seu foco agora' });
    await expect(focus.getByText('Cadência A', { exact: true })).toBeVisible();
    await page.evaluate(({ org, user }) => window.h.update({ org, user, kind: 'regular' }), { org: orgB, user: userB });
    await expect(focus.getByText('Cadência B', { exact: true })).toBeVisible();
    await expect(focus.getByText('Cadência A', { exact: true })).toHaveCount(0);
    const keys = await page.evaluate(() => window.h.client.getQueryCache().getAll().filter(q => q.queryKey[0] === 'home' && q.queryKey[1] === 'focus').map(q => q.queryKey));
    assert.ok(keys.some(key => key[2] === orgA && key[3] === userA));
    assert.ok(keys.some(key => key[2] === orgB && key[3] === userB));
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('permission denial does not read the focus API and a transient failure can be retried', async () => {
  const { page, errors } = await fixture();
  try {
    await page.getByRole('region', { name: 'Seu foco agora' }).waitFor();
    await page.evaluate(async () => { window.h.update({ kind: 'regular', allowed: false }); });
    await expect(page.getByText('Seu acesso está pronto', { exact: true })).toBeVisible();
    const count = await page.evaluate(() => window.h.reads.length);
    await page.evaluate(async () => { await window.h.client.invalidateQueries({ queryKey: ['home', 'focus'] }); });
    assert.equal(await page.evaluate(() => window.h.reads.length), count);
    await page.evaluate(() => { window.h.fail = true; window.h.update({ allowed: true }); });
    await page.evaluate(async () => { await window.h.client.invalidateQueries({ queryKey: ['home', 'focus'] }); });
    const retry = page.getByRole('button', { name: 'Tentar novamente', exact: true });
    await expect(retry).toBeVisible();
    await page.evaluate(() => { window.h.fail = false; }); await retry.click();
    await expect(retry).toHaveCount(0);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('partial permission revocation hides cached attention while the permitted task fallback remains visible', async () => {
  const { page, errors } = await fixture();
  try {
    const focus = page.getByRole('region', { name: 'Seu foco agora' });
    await expect(focus.getByText('Cadência A', { exact: true })).toBeVisible();
    await page.evaluate(() => window.h.update({ kind: 'regular', focusDenied: true }));
    await expect(focus.getByText('Tarefa permitida', { exact: true })).toBeVisible();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(focus.getByText('Cadência A', { exact: true })).toHaveCount(0);
    assert.equal(await page.evaluate(() => window.h.overview.focusItems.some(item => item.title === 'Cadência A')), false);
    assert.equal(await page.evaluate(() => window.h.client.getQueryData(['home', 'focus', window.h.identity.org, window.h.identity.user, 'mine']).length), 1, 'revocation masks cached rows without deleting another authorized visit');
    await page.evaluate(() => window.h.update({ focusDenied: false }));
    await expect(focus.getByText('Cadência A', { exact: true })).toBeVisible();
    await expect(focus.getByText('Tarefa permitida', { exact: true })).toHaveCount(0);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('blocked billing and unresolved access do not map retained private cache', async () => {
  const { page, errors } = await fixture();
  try {
    const focus = page.getByRole('region', { name: 'Seu foco agora' });
    await expect(focus.getByText('Cadência A', { exact: true })).toBeVisible();
    for (const field of ['billingBlocked', 'pending', 'modulesLoading']) {
      await page.evaluate(field => window.h.update({ [field]: true }), field);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.evaluate(() => window.h.overview.focusItems.length), 0, field);
      await expect(focus.getByText('Cadência A', { exact: true })).toHaveCount(0);
      await page.evaluate(field => window.h.update({ [field]: false }), field);
      await expect(focus.getByText('Cadência A', { exact: true })).toBeVisible();
    }
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
