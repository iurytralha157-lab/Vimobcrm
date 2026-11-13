import assert from 'node:assert/strict';
import { before, after, beforeEach, afterEach, test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// Real React/QueryProvider/hooks/API/Zod/editor; synthetic Auth and transport.
// All requests are blocked outside the in-memory test document.
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const org = '33333333-3333-4333-8333-333333333333', actor = '44444444-4444-4444-8444-444444444444';
const stage = '22222222-2222-4222-8222-222222222222', pipeline = '66666666-6666-4666-8666-666666666666';
let directory, browser, page, bundle;
const pageErrors = [];

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'vimob-rules-access-'));
  const stub = path.join(directory, 'synthetic.tsx'), entry = path.join(directory, 'entry.tsx'), loader = path.join(directory, 'loader.cjs');
  const validation = path.join(directory, 'validation.ts');
  await writeFile(validation, `export * from ${JSON.stringify(path.join(root, 'lib/validation/cadences.ts'))};export * from ${JSON.stringify(path.join(root, 'lib/validation/common.ts'))};`);
  await writeFile(stub, `import React,{createContext,useContext}from'react';export const Auth=createContext(null),useAuth=()=>useContext(Auth);
    export{VimobAPIError}from${JSON.stringify(path.join(root, 'lib/api/vimob-error.ts'))};
    export const vimobAPIRequest=(url,options)=>window.h.request(url,options);
    export const useWhatsAppQueryScope=()=>({organizationId:'test',userId:'test',accessScope:'test'});
    export const toast=Object.fromEntries(['success','error'].map(kind=>[kind,message=>window.h.toasts.push({kind,message})]));
    export const useUserPermissions=()=>({hasPermission:()=>true});export const isLocalReadOnlyMode=()=>false;
    export const useAttentionSettings=()=>({data:{engineMode:'enabled',notificationsEnabled:true},isPending:false,isError:false});
    export const useAttentionPolicies=()=>({data:[],isPending:false,isError:false});
  `);
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;`);
  await writeFile(entry, `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{useQueryClient}from'@tanstack/react-query';
    import{Auth,VimobAPIError}from'./synthetic';import{QueryProvider}from'@/components/providers/query-provider';
    import{useUpdateStageOperationalRules,stageOperationalRulesQueryKey}from'@/hooks/cadences/use-stage-operational-rules';
    import{StageOperationalRules}from'@/components/features/cadences/StageOperationalRules';
    const h=window.h={requests:[],invalidations:[],toasts:[],callbacks:[],finishes:0,replies:[],gates:[],editorStates:[],org:'${org}',stage:'${stage}'};
    h.initial={stage_id:'${stage}',pipeline_id:'${pipeline}',revision:1,cadence:{enabled:true,tasks:[{id:'11111111-1111-4111-8111-111111111111',position:0,type:'call',title:'Initial task',due_minutes:60,is_required:true,outcome_required:true}]},attention:{source_mode:'inherit',mode:'disabled',warning_minutes:0,business_hours_only:false},lifecycle:{on_stage_move:'skip_pending',on_won:'cancel_pending',on_lost:'cancel_pending',on_reopen:'new_cycle'}};
    h.input=structuredClone(h.initial);h.row=()=>({...structuredClone(h.initial),revision:2,...h.responsePatch});h.key=()=>stageOperationalRulesQueryKey(h.scope.org,h.scope.stage);
    h.clients=new WeakSet();h.setup=client=>{h.client=client;if(h.clients.has(client))return;h.clients.add(client);client.setDefaultOptions({queries:{retry:false,gcTime:Infinity},mutations:{retry:2,retryDelay:0}});
      client.getMutationCache().config.onMutate=()=>h.beforeGate?new Promise(resolve=>h.gates.push(resolve)):undefined;client.getMutationCache().config.onSuccess=()=>h.successGate?new Promise(resolve=>h.releaseSuccess=resolve):undefined;client.getMutationCache().config.onSettled=()=>{h.finishes++;return h.settledGate?new Promise(resolve=>h.releaseSettled=resolve):undefined};
      client.setQueryData(stageOperationalRulesQueryKey('${org}','${stage}'),h.initial);
      for(const key of [['cadence-templates'],['cadence-templates','unrelated'],['attention','items','${org}','mine'],['attention','items','77777777-7777-4777-8777-777777777777','mine'],['home','focus','${org}','${actor}','mine'],['home','focus','${org}','55555555-5555-4555-8555-555555555555','mine'],['home','focus','77777777-7777-4777-8777-777777777777','${actor}','mine']])client.setQueryData(key,[]);
      for(const key of [['lead-cadence-state','${org}','lead-a','${stage}'],['lead-cadence-state','${org}','lead-b','other-stage'],['lead-cadence-state','other-org','lead-c','${stage}']])client.setQueryData(key,[]);
      const invalidate=client.invalidateQueries.bind(client);client.invalidateQueries=(filters,...rest)=>{h.invalidations.push({keys:client.getQueryCache().findAll(filters).map(query=>query.queryKey),refetchType:filters.refetchType});return invalidate(filters,...rest)};
    };
    h.seed=revision=>{const rules={...structuredClone(h.initial),revision};rules.cadence.tasks[0].title='R'+revision+' task';h.readRules=rules;h.client.setQueryData(h.key(),rules)};
    h.readRequests=[];h.refetch=()=>h.client.refetchQueries({queryKey:h.key(),exact:true},{throwOnError:true}).then(()=>h.readOutcome={ok:true},error=>h.readOutcome={ok:false,code:error.code});
    h.request=async(url,options={})=>{if(!options.method||options.method==='GET'){h.readRequests.push({expectedUserId:options.expectedUserId,expectedSessionId:options.expectedSessionId,hasSignal:Boolean(options.signal)});const data=structuredClone(h.readRules||h.initial);if(h.readGate)return await new Promise(resolve=>h.releaseRead=()=>resolve({data}));return{data}};
      if(options.signal?.aborted||(options.expectedUserId!==undefined&&options.expectedUserId!==h.scope.actor)||(options.expectedSessionId!==undefined&&options.expectedSessionId!==h.scope.sid))throw new VimobAPIError('Retired request',{status:409,code:'api_request_identity_changed'});
      h.signal=options.signal;h.requests.push({url,method:options.method,organizationId:options.organizationId,body:structuredClone(options.body),expectedUserId:options.expectedUserId,expectedSessionId:options.expectedSessionId,hasSignal:Boolean(options.signal),retry:options.retry});
      if(h.replyGate)return await new Promise((resolve,reject)=>h.replies.push({resolve:()=>resolve({data:h.row()}),reject:()=>reject(new VimobAPIError('Synthetic save failed',{status:503,code:'synthetic_failure'}))}));
      if(h.failNow)throw new VimobAPIError('Synthetic save failed',{status:503,code:'synthetic_failure'});return{data:h.row()};
    };
    function Content(){const[editor,setEditor]=useState(false);h.openEditor=()=>setEditor(true);h.setup(useQueryClient());const mutation=useUpdateStageOperationalRules(h.scope.stage);h.status=mutation.status;h.guardFactory=mutation.captureScopeGuard;
      h.start=(mode='async')=>{h.oldClient=h.client;try{const options=Object.fromEntries(['onSuccess','onError','onSettled'].map(name=>[name,()=>h.callbacks.push(name)]));const promise=mode==='mutate'?mutation.mutate(h.input,options):mutation.mutateAsync(h.input,options);if(mode!=='mutate')promise.then(value=>h.outcome={ok:true,revision:value.revision},error=>h.outcome={ok:false,code:error.code})}catch(error){h.outcome={ok:false,code:error.code}}};
      return <><span>ready</span>{editor&&<StageOperationalRules stageId={h.scope.stage} stageName='Synthetic column' canEdit onEditorStateChange={state=>h.editorStates.push(state)}/>}</>}
    function Fixture(){const[scope,setScope]=useState({org:'${org}',actor:'${actor}',sid:'sid-a',stage:'${stage}',permissions:['pipeline_manage'],modules:['automations'],nonce:0}),[shown,setShown]=useState(true);h.scope=scope;h.change=patch=>setScope(old=>({...old,...patch}));h.close=()=>setShown(false);
      const user=scope.actor?{id:scope.actor}:null,auth={activeOrganization:{organizationId:scope.org},user,session:scope.sid&&user?{access_token:'header.'+btoa(JSON.stringify({sub:scope.actor,session_id:scope.sid,iat:scope.nonce}))+'.synthetic'}:null,tenantContext:{organizationId:scope.org,permissions:scope.permissions,enabledModules:scope.modules,isSuperAdmin:false,memberRole:'user'}};
      return <Auth.Provider value={auth}><QueryProvider>{shown&&<Content/>}</QueryProvider></Auth.Provider>};createRoot(document.getElementById('app')).render(<Fixture/>);
  `);
  const { webpack } = require('next/dist/compiled/webpack/webpack');
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode: 'development', target: 'web', devtool: false, entry, output: { path: directory, filename: 'fixture.js' },
      plugins: [new webpack.NormalModuleReplacementPlugin(/(^|[/\\])vimob-client(\.ts)?$/, stub)],
      resolve: { extensions: ['.tsx', '.ts', '.js'], modules: [path.join(root, 'node_modules'), 'node_modules'], alias: { '@/contexts/AuthContext$': stub, '@/hooks/use-whatsapp-query-scope$': stub, '@/hooks/use-user-permissions$': stub, '@/hooks/attention$': stub, '@/lib/local-read-only$': stub, '@/lib/api/vimob-client$': stub, '@/lib/validation$': validation, 'sonner$': stub, '@': root } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] } });
    compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors() ? reject(error || Error(stats.toString({ all: false, errors: true }))) : resolve()));
  });
  bundle = await readFile(path.join(directory, 'fixture.js'), 'utf8');browser = await chromium.launch({ headless: true });
}, { timeout: 180_000 });
beforeEach(async () => {
  page = await browser.newPage();page.setDefaultTimeout(5_000);page.on('pageerror', error => pageErrors.push(error.stack || error.message));
  await page.route('**/*', route => route.request().url() === 'https://rules-access.invalid/' ? route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }) : route.abort());
  await page.goto('https://rules-access.invalid/');await page.addScriptTag({ content: 'window.process={env:{NODE_ENV:"test"}};' });await page.addScriptTag({ content: bundle });await page.getByText('ready', { exact: true }).waitFor();
});
afterEach(async () => { await page?.close(); });
after(async () => {
  await browser?.close();if (directory) { assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));assert(path.basename(directory).startsWith('vimob-rules-access-'));await rm(directory, { recursive: true, force: true }); }assert.deepEqual(pageErrors, []);
});
const replacements = [['SID', [{ sid: 'sid-b' }]], ['actor', [{ actor: '55555555-5555-4555-8555-555555555555' }]], ['org', [{ org: '77777777-7777-4777-8777-777777777777' }]], ['logout', [{ actor: null, sid: null }]], ['permission', [{ permissions: [] }]], ['module', [{ modules: [] }]], ['ABA', [{ sid: 'sid-b' }, { sid: 'sid-a' }]]];
async function replace(patches) { for (const patch of patches) { await page.evaluate(patch => window.h.change(patch), patch);await page.waitForFunction(patch => Object.entries(patch).every(([key, value]) => JSON.stringify(window.h.scope[key]) === JSON.stringify(value)), patch); } }
async function finish(mode = 'async', count = 1) { await page.waitForFunction(({ mode, count }) => mode === 'mutate' ? window.h.finishes >= count : Boolean(window.h.outcome), { mode, count });return page.evaluate(() => ({ requests: window.h.requests, invalidations: window.h.invalidations, toasts: window.h.toasts, callbacks: window.h.callbacks, outcome: window.h.outcome, cached: window.h.client.getQueryData(window.h.key()) })); }

test('late R2 ACK cannot replace a current R3 cache or report it as a current save', async () => {
  await page.evaluate(() => { window.h.replyGate = true;window.h.start(); });await page.waitForFunction(() => window.h.replies.length === 1);
  await page.evaluate(() => { window.h.seed(3);window.h.replies[0].resolve(); });const state = await finish();assert.equal(state.cached.revision, 3);assert.equal(state.outcome.ok, false);assert.equal(state.toasts.filter(item => item.kind === 'success').length, 0);
});
for (const mode of ['async', 'mutate']) for (const [name, patches] of replacements) for (const gate of ['before', 'reply']) test(`${mode}: retired ${name} cannot affect rules during ${gate}`, async () => {
  await page.evaluate(({ mode, gate }) => { window.h[gate === 'before' ? 'beforeGate' : 'replyGate'] = true;window.h.start(mode); }, { mode, gate });
  await page.waitForFunction(gate => window.h[gate === 'before' ? 'gates' : 'replies'].length === 1, gate);await replace(patches);
  await page.evaluate(({ gate }) => { if (window.h.oldClient !== window.h.client) window.h.oldClient.removeQueries({ queryKey: ['cadences', 'stage-operational-rules'] });window.h.seed(3);if (gate === 'before') window.h.gates[0]();else window.h.replies[0].resolve(); }, { gate });
  const state = await finish(mode);assert.equal(state.requests.length, gate === 'before' ? 0 : 1);assert.equal(state.cached.revision, 3);assert.deepEqual(state.toasts, []);assert.deepEqual(state.callbacks, []);assert.deepEqual(state.invalidations, []);
  if (mode === 'async') assert.equal(state.outcome.ok, false);
  if (name === 'actor' || name === 'org') assert.equal(await page.evaluate(() => window.h.oldClient.getQueryData(['cadences', 'stage-operational-rules', window.h.org, window.h.stage])), undefined);
});
test('input tasks and nested attention are snapshotted before global onMutate', async () => {
  await page.evaluate(() => { window.h.beforeGate = true;window.h.start(); });await page.waitForFunction(() => window.h.gates.length === 1);
  await page.evaluate(() => { window.h.input.cadence.tasks[0].title = 'Unexpected later edit';window.h.input.attention.warning_minutes = 12;window.h.gates[0](); });const state = await finish();assert.equal(state.requests[0].body.cadence.tasks[0].title, 'Initial task');assert.equal(state.requests[0].body.attention.warning_minutes, 0);
});
test('current save preserves pins, callbacks and tenant-only derived invalidations', async () => {
  await page.evaluate(() => window.h.start());const state = await finish();assert.equal(state.outcome.ok, true);assert.equal(state.cached.revision, 2);assert.equal(state.requests[0].expectedUserId, actor);assert.equal(state.requests[0].expectedSessionId, 'sid-a');assert.equal(state.requests[0].hasSignal, true);assert.equal(state.requests[0].retry, false);assert.deepEqual(state.callbacks, ['onSuccess', 'onSettled']);
  const keys = state.invalidations.flatMap(item => item.keys);
  assert.deepEqual(keys.filter(key => key[0] === 'lead-cadence-state'), [['lead-cadence-state', org, 'lead-a', stage]]);
  assert(keys.filter(key => key[0] !== 'lead-cadence-state').every(key => key[0] === 'cadence-templates' ? key.length === 1 : key[2] === org && (key[0] !== 'home' || key[3] === actor)));
});
for (const gate of ['before', 'reply']) test(`same-SID token refresh preserves the save during ${gate}`, async () => {
  await page.evaluate(gate => { window.h[gate === 'before' ? 'beforeGate' : 'replyGate'] = true;window.h.start(); }, gate);await page.waitForFunction(gate => window.h[gate === 'before' ? 'gates' : 'replies'].length === 1, gate);await replace([{ nonce: 1 }]);await page.evaluate(gate => gate === 'before' ? window.h.gates[0]() : window.h.replies[0].resolve(), gate);assert.equal((await finish()).outcome.ok, true);
});
for (const patch of [{ stage_id: '88888888-8888-4888-8888-888888888888' }, { pipeline_id: '88888888-8888-4888-8888-888888888888' }]) test('a response for another identity is rejected: ' + JSON.stringify(patch), async () => {
  await page.evaluate(patch => { window.h.responsePatch = patch;window.h.start(); }, patch);const state = await finish();assert.equal(state.outcome.ok, false);assert.equal(state.cached.revision, 1);assert.equal(state.toasts.filter(item => item.kind === 'success').length, 0);
});
test('equal revision keeps the already-confirmed snapshot', async () => {
  await page.evaluate(() => { window.h.seed(2);window.h.start(); });const state = await finish();assert.equal(state.outcome.ok, true);assert.equal(state.cached.cadence.tasks[0].title, 'R2 task');
});
test('normal editor close reconciles an accepted ACK without refetch or notifications', async () => {
  await page.evaluate(() => { window.h.replyGate = true;window.h.start(); });await page.waitForFunction(() => window.h.replies.length === 1);await page.evaluate(() => window.h.close());await page.getByText('ready', { exact: true }).waitFor({ state: 'detached' });await page.evaluate(() => window.h.replies[0].resolve());const state = await finish();assert.equal(state.cached.revision, 2);assert.deepEqual(state.toasts, []);assert.deepEqual(state.callbacks, []);assert(state.invalidations.every(item => item.refetchType === 'none'));
});
test('late error after retirement has no callbacks, cache or notices', async () => {
  await page.evaluate(() => { window.h.replyGate = true;window.h.start(); });await page.waitForFunction(() => window.h.replies.length === 1);await replace([{ sid: 'sid-b' }]);await page.evaluate(() => window.h.replies[0].reject());const state = await finish();assert.equal(state.outcome.ok, false);assert.deepEqual(state.toasts, []);assert.deepEqual(state.callbacks, []);assert.deepEqual(state.invalidations, []);
});
test('current transport error is visible once without automatic retry', async () => {
  await page.evaluate(() => { window.h.failNow = true;window.h.start(); });const state = await finish();assert.equal(state.requests.length, 1);assert.equal(state.outcome.ok, false);assert.equal(state.toasts.filter(item => item.kind === 'error').length, 1);
});

for (const revision of [0, 1]) test('an ACK must advance the submitted revision: ' + revision, async () => {
  await page.evaluate(revision => { window.h.responsePatch = { revision };window.h.start(); }, revision);const state = await finish();assert.equal(state.outcome.ok, false);assert.equal(state.cached.revision, 1);assert.equal(state.toasts.filter(item => item.kind === 'success').length, 0);
});
for (const mode of ['async', 'mutate']) for (const boundary of ['success', 'settled']) test(mode + ': R3 arriving during global ' + boundary + ' cannot be returned as R2 success', async () => {
  await page.evaluate(({ mode, boundary }) => { window.h[boundary + 'Gate'] = true;window.h.start(mode); }, { mode, boundary });await page.waitForFunction(boundary => window.h[boundary === 'success' ? 'releaseSuccess' : 'releaseSettled'], boundary);
  await page.evaluate(boundary => { window.h.seed(3);window.h[boundary === 'success' ? 'releaseSuccess' : 'releaseSettled']();window.h[boundary + 'Gate'] = false; }, boundary);
  const state = await finish(mode);assert.equal(state.cached.revision, 3);if (mode === 'async') assert.equal(state.outcome.ok, false);if (boundary === 'success') { assert.equal(state.toasts.filter(item => item.kind === 'success').length, 0);assert(!state.callbacks.includes('onSuccess')); } else assert.deepEqual(state.callbacks, []);
});
async function editor() { await page.evaluate(() => window.h.openEditor());await page.getByLabel('Título da tarefa', { exact: true }).waitFor(); }
async function title(value) { await page.getByLabel('Título da tarefa', { exact: true }).fill(value); }
for (const outcome of ['resolve', 'reject']) test('real editor ' + outcome + ' from A cannot unlock pending editor B', async () => {
  await editor();await title('Draft A');await page.evaluate(() => { window.h.replyGate = true; });await page.getByRole('button', { name: 'Salvar regras', exact: true }).click();await page.waitForFunction(() => window.h.replies.length === 1);
  await replace([{ sid: 'sid-b' }]);await title('Draft B');await page.getByRole('button', { name: 'Salvar regras', exact: true }).click();await page.waitForFunction(() => window.h.replies.length === 2);
  await page.waitForFunction(() => Array.from(document.querySelectorAll('input')).find(input => input.id.startsWith('task-title-'))?.matches(':disabled'));
  await page.evaluate(outcome => window.h.replies[0][outcome](), outcome);await page.waitForFunction(() => window.h.finishes === 1);
  assert.equal(await page.getByLabel('Título da tarefa', { exact: true }).inputValue(), 'Draft B');assert.equal(await page.getByLabel('Título da tarefa', { exact: true }).isDisabled(), true);assert.equal(await page.evaluate(() => window.h.editorStates.at(-1).isSaving), true);assert.deepEqual(await page.evaluate(() => window.h.toasts), []);
  await page.evaluate(() => window.h.replies[1].resolve());await page.waitForFunction(() => window.h.finishes === 2);assert.equal(await page.getByLabel('Título da tarefa', { exact: true }).isEnabled(), true);assert.equal(await page.evaluate(() => window.h.editorStates.at(-1).isSaving), false);
});
test('an old real editor submit and guard factory cannot adopt the replacement visit', async () => {
  await editor();await title('Old draft');await page.locator('form').evaluate(form => { const props = Object.keys(form).find(key => key.startsWith('__reactProps'));window.h.oldSubmit = form[props].onSubmit; });await page.evaluate(() => { window.h.oldGuard = window.h.guardFactory; });
  await replace([{ sid: 'sid-b' }]);await title('New draft');const before = await page.evaluate(() => window.h.editorStates);await page.evaluate(() => window.h.oldSubmit(new Event('submit', { cancelable: true })));
  assert.deepEqual(await page.evaluate(() => window.h.editorStates), before);assert.equal(await page.evaluate(() => window.h.oldGuard()()), false);assert.equal(await page.evaluate(() => window.h.requests.length), 0);assert.equal(await page.getByLabel('Título da tarefa', { exact: true }).inputValue(), 'New draft');
});
test('explicit reload blocks typing and both captured submit/reload overlap', async () => {
  await editor();await title('Unsaved draft');await page.locator('form').evaluate(form => { const props = Object.keys(form).find(key => key.startsWith('__reactProps'));window.h.oldSubmit = form[props].onSubmit; });await page.evaluate(() => window.h.seed(3));await page.getByRole('button', { name: 'Carregar versão atual', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Carregar versão atual', exact: true }).evaluate(button => { const props = Object.keys(button).find(key => key.startsWith('__reactProps'));window.h.oldReload = button[props].onClick; });await page.evaluate(() => { window.h.readGate = true; });await page.getByRole('button', { name: 'Carregar versão atual', exact: true }).click();await page.waitForFunction(() => window.h.releaseRead);
  assert.equal(await page.getByLabel('Título da tarefa', { exact: true }).isDisabled(), true);await page.getByLabel('Título da tarefa', { exact: true }).evaluate(input => { const props = Object.keys(input).find(key => key.startsWith('__reactProps'));input[props].onChange({ target: { value: 'Typing during reload' } }); });
  await page.evaluate(() => { window.h.oldReload();void window.h.oldSubmit(new Event('submit', { cancelable: true })); });assert.equal(await page.evaluate(() => window.h.readRequests.length), 1);assert.equal(await page.evaluate(() => window.h.requests.length), 0);assert.equal(await page.getByLabel('Título da tarefa', { exact: true }).inputValue(), 'Unsaved draft');
  await page.evaluate(() => window.h.releaseRead());await page.waitForFunction(() => window.h.client.getQueryState(window.h.key()).fetchStatus === 'idle');await page.getByLabel('Título da tarefa', { exact: true }).waitFor();assert.equal(await page.getByLabel('Título da tarefa', { exact: true }).inputValue(), 'R3 task');
});
test('GET R2 cannot regress R3 at the actual Query.setData commit boundary', async () => {
  await editor();await page.evaluate(() => { const h = window.h, query = h.client.getQueryCache().find({ queryKey: h.key(), exact: true }), commit = query.setData.bind(query);h.readRules = { ...structuredClone(h.initial), revision: 2 };h.injectAtCommit = true;query.setData = (...args) => { if (h.injectAtCommit) { h.injectAtCommit = false;h.seed(3); }return commit(...args); };void h.refetch(); });await page.waitForFunction(() => window.h.readOutcome);
  assert.equal(await page.evaluate(() => window.h.client.getQueryData(window.h.key()).revision), 3);assert.equal(await page.evaluate(() => window.h.readRequests[0].expectedSessionId), 'sid-a');assert.equal(await page.evaluate(() => window.h.readRequests[0].hasSignal), true);
});
test('GET completing after SID retirement preserves the new rules snapshot', async () => {
  await editor();await page.evaluate(() => { window.h.readGate = true;window.h.readRules = { ...structuredClone(window.h.initial), revision: 2 };void window.h.refetch(); });await page.waitForFunction(() => window.h.releaseRead);await replace([{ sid: 'sid-b' }]);await page.evaluate(() => { window.h.seed(3);window.h.releaseRead(); });await page.waitForFunction(() => window.h.readOutcome);assert.equal(await page.evaluate(() => window.h.client.getQueryData(window.h.key()).revision), 3);assert.deepEqual(await page.evaluate(() => window.h.toasts), []);
});
test('GET survives a token refresh in the same SID', async () => {
  await editor();await page.evaluate(() => { window.h.readGate = true;window.h.readRules = { ...structuredClone(window.h.initial), revision: 2 };void window.h.refetch(); });await page.waitForFunction(() => window.h.releaseRead);await replace([{ nonce: 1 }]);await page.evaluate(() => window.h.releaseRead());await page.waitForFunction(() => window.h.readOutcome);assert.equal(await page.evaluate(() => window.h.client.getQueryData(window.h.key()).revision), 2);assert.equal(await page.evaluate(() => window.h.readOutcome.ok), true);
});
test('session retirement during global success has no late notice or cache effect', async () => {
  await page.evaluate(() => { window.h.successGate = true;window.h.start(); });await page.waitForFunction(() => window.h.releaseSuccess);await replace([{ sid: 'sid-b' }]);await page.evaluate(() => { window.h.seed(3);window.h.releaseSuccess(); });const state = await finish();assert.equal(state.outcome.ok, false);assert.equal(state.cached.revision, 3);assert.deepEqual(state.toasts, []);assert.deepEqual(state.callbacks, []);assert.deepEqual(state.invalidations, []);
});
test('an old explicit reload cannot alter or restart the replacement editor', async () => {
  await editor();await title('Old dirty draft');await page.evaluate(() => window.h.seed(3));await page.getByRole('button', { name: 'Carregar versão atual', exact: true }).waitFor();await page.getByRole('button', { name: 'Carregar versão atual', exact: true }).evaluate(button => { const props = Object.keys(button).find(key => key.startsWith('__reactProps'));window.h.oldReload = button[props].onClick; });
  await page.evaluate(() => { window.h.readGate = true; });await page.getByRole('button', { name: 'Carregar versão atual', exact: true }).click();await page.waitForFunction(() => window.h.releaseRead);await replace([{ sid: 'sid-b' }]);await title('New dirty draft');await page.evaluate(() => window.h.releaseRead());await page.waitForFunction(() => window.h.client.getQueryState(window.h.key()).fetchStatus === 'idle');
  const before = await page.evaluate(() => ({ reads: window.h.readRequests.length, states: window.h.editorStates }));await page.evaluate(() => window.h.oldReload());assert.deepEqual(await page.evaluate(() => ({ reads: window.h.readRequests.length, states: window.h.editorStates })), before);assert.equal(await page.getByLabel('Título da tarefa', { exact: true }).inputValue(), 'New dirty draft');assert.deepEqual(await page.evaluate(() => window.h.toasts), []);
});
