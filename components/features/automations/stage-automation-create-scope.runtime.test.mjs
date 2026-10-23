import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// React, React Query, scope helper, API and Zod are real. Auth and transport
// are synthetic; the browser has no access to the CRM, Supabase or a provider.
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const organizationId = '33333333-3333-4333-8333-333333333333';
const actorId = '44444444-4444-4444-8444-444444444444';
const stageId = '22222222-2222-4222-8222-222222222222';
let directory, browser, page, bundle;
const errors = [];

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'vimob-automation-create-scope-'));
  const stub = path.join(directory, 'synthetic.tsx');
  const entry = path.join(directory, 'fixture.tsx');
  const loader = path.join(directory, 'loader.cjs');
  const validation = path.join(directory, 'validation.ts');
  await writeFile(validation, `export * from ${JSON.stringify(path.join(root, 'lib/validation/auxiliary.ts'))};export * from ${JSON.stringify(path.join(root, 'lib/validation/common.ts'))};export * from ${JSON.stringify(path.join(root, 'lib/validation/stage-automation-revision.ts'))};`);
  await writeFile(stub, `import React,{createContext,useContext}from'react';
    export const Auth=createContext(null),useAuth=()=>useContext(Auth);
    export const toast=Object.fromEntries(['success','error'].map(kind=>[kind,message=>window.h.toasts.push({kind,message})]));
    export const vimobAPIRequest=(url,options)=>window.h.request(url,options);
    export const useWhatsAppQueryScope=()=>({organizationId:'synthetic',userId:'synthetic',accessScope:'synthetic'});
    export const useOrganizationUsers=()=>({data:[],isPending:false,isError:false});
    export const useStageInactivityAutomation=()=>{const auth=useAuth();return{scopeKey:JSON.stringify([auth.activeOrganization.organizationId,auth.user?.id,auth.session?JSON.parse(atob(auth.session.access_token.split('.')[1])).session_id:null,auth.tenantContext]),isPending:false}};
  `);
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;`);
  await writeFile(entry, `import React,{useState}from'react';import{createRoot}from'react-dom/client';
    import{useQueryClient}from'@tanstack/react-query';import{QueryProvider}from'@/components/providers/query-provider';
    import{useCreateStageAutomation}from'@/hooks/use-stage-automations';import{Auth}from'./synthetic';
    import{AutomationForm}from'@/components/features/automations/AutomationForm';
    import{VimobAPIError}from'@/lib/api/vimob-error';
    const h=window.h={requests:[],invalidations:[],toasts:[],callbacks:[],finishes:0,formSuccesses:0,editorStates:[],input:{stage_id:'${stageId}',automation_type:'change_deal_status_on_enter',deal_status:'won'}};
    h.row=()=>({id:'11111111-1111-4111-8111-111111111111',organization_id:'${organizationId}',stage_id:'${stageId}',trigger_type:'on_enter',config:{automation_type:'change_deal_status_on_enter',action_config:{deal_status:'won'}},is_active:true,created_at:'2026-10-20T10:00:00.123456Z',updated_at:'2026-10-20T10:00:00.123456Z',...h.responsePatch});
    h.clients=new WeakSet();h.setup=client=>{h.client=client;if(h.clients.has(client))return;h.clients.add(client);
      client.setDefaultOptions({queries:{retry:false,gcTime:Infinity},mutations:{retry:2,retryDelay:0}});
      client.getMutationCache().config.onMutate=()=>h.beforeGate?new Promise(resolve=>h.releaseBefore=resolve):undefined;client.getMutationCache().config.onSettled=()=>{h.finishes++};
      for(const key of [['stage-automations','${stageId}','${organizationId}','${actorId}','a'],['stage-automations',undefined,'${organizationId}','${actorId}','a'],['stage-automations','${stageId}','77777777-7777-4777-8777-777777777777','${actorId}','b'],['stage-automations','${stageId}','${organizationId}','55555555-5555-4555-8555-555555555555','b']])client.setQueryData(key,[]);
      const invalidate=client.invalidateQueries.bind(client);client.invalidateQueries=(filters,...rest)=>{h.invalidations.push({keys:client.getQueryCache().findAll(filters).map(query=>query.queryKey),refetchType:filters.refetchType});return invalidate(filters,...rest)};
    };
    h.request=async(url,options)=>{
      if(!options.method||options.method==='GET')return{data:[]};
      if(options.signal?.aborted||(options.expectedUserId!==undefined&&options.expectedUserId!==h.scope.actor)||(options.expectedSessionId!==undefined&&options.expectedSessionId!==h.scope.sid))throw new VimobAPIError('Retired request',{status:409,code:'api_request_identity_changed'});
      h.signal=options.signal;h.requests.push({url,method:options.method,organizationId:options.organizationId,body:options.body,expectedUserId:options.expectedUserId,expectedSessionId:options.expectedSessionId,hasSignal:Boolean(options.signal),retry:options.retry});
      // Ignore abort deliberately: the hook must fence even a late ACK or error
      // from a transport/proxy that can no longer be interrupted.
      if(h.replyGate)return await new Promise((resolve,reject)=>{h.reply=()=>resolve({data:h.row()});h.failReply=()=>reject(new VimobAPIError('Synthetic rejected save',{status:503,code:'synthetic_failure'}))});
      if(h.failNow)throw new VimobAPIError('Synthetic rejected save',{status:503,code:'synthetic_failure'});
      return{data:h.row()};
    };
    function Content(){const[form,setForm]=useState(false);h.openForm=()=>setForm(true);h.setup(useQueryClient());const mutation=useCreateStageAutomation();h.status=mutation.status;h.captureScopeGuard=mutation.captureScopeGuard;
      h.start=(mode='async')=>{const options=Object.fromEntries(['onSuccess','onError','onSettled'].map(name=>[name,(...args)=>h.callbacks.push({name,stage:args[1]?.stage_id||args[2]?.stage_id})]));
        try{const result=mode==='mutate'?mutation.mutate(h.input,options):mutation.mutateAsync(h.input,options);if(mode!=='mutate')result.then(value=>h.outcome={ok:true,stage:value.stage_id},error=>h.outcome={ok:false,code:error.code,message:error.message})}
        catch(error){h.outcome={ok:false,code:error.code,message:error.message}}
      };return <><span>ready</span>{form&&<AutomationForm stageId='${stageId}' pipelineId='66666666-6666-4666-8666-666666666666' onSuccess={()=>h.formSuccesses++} onEditorStateChange={state=>h.editorStates.push(state)}/>}</>}
    function Fixture(){const[scope,setScope]=useState({org:'${organizationId}',actor:'${actorId}',sid:'sid-a',permissions:['automations_view','automations_manage'],modules:['automations'],nonce:0}),[shown,setShown]=useState(true);h.scope=scope;h.change=patch=>setScope(old=>({...old,...patch}));h.close=()=>setShown(false);
      const user=scope.actor?{id:scope.actor}:null;
      const auth={activeOrganization:{organizationId:scope.org},user,session:scope.sid&&user?{access_token:'header.'+btoa(JSON.stringify({sub:scope.actor,session_id:scope.sid,iat:scope.nonce}))+'.synthetic'}:null,tenantContext:{organizationId:scope.org,permissions:scope.permissions,enabledModules:scope.modules,isSuperAdmin:false,memberRole:'user'}};
      return <Auth.Provider value={auth}><QueryProvider>{shown&&<Content/>}</QueryProvider></Auth.Provider>}
    createRoot(document.getElementById('app')).render(<Fixture/>);
  `);
  const { webpack } = require('next/dist/compiled/webpack/webpack');
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode: 'development', target: 'web', devtool: false, entry,
      output: { path: directory, filename: 'fixture.js' },
      plugins: [new webpack.NormalModuleReplacementPlugin(/(^|[/\\])vimob-client(\.ts)?$/, stub)],
      resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@/contexts/AuthContext$': stub, '@/hooks/use-whatsapp-query-scope$': stub, '@/hooks/use-users$': stub, '@/hooks/use-stage-inactivity-automation$': stub, '@/lib/api/vimob-client$': stub, '@/lib/validation$': validation, 'sonner$': stub, '@': root }, modules: [path.join(root, 'node_modules'), 'node_modules'] },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] } });
    compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors() ? reject(error || new Error(stats.toString({ all: false, errors: true }))) : resolve()));
  });
  bundle = await readFile(path.join(directory, 'fixture.js'), 'utf8');
  browser = await chromium.launch({ headless: true });
}, { timeout: 180_000 });

beforeEach(async () => {
  page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.stack || error.message));
  page.setDefaultTimeout(5_000);
  await page.route('**/*', route => route.request().url() === 'https://automation-create.invalid/'
    ? route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }) : route.abort());
  await page.goto('https://automation-create.invalid/');
  await page.addScriptTag({ content: 'window.process={env:{NODE_ENV:"test"}};' });
  await page.addScriptTag({ content: bundle });
  await page.getByText('ready', { exact: true }).waitFor();
});
afterEach(async () => { await page?.close(); });
after(async () => {
  await browser?.close();
  if (directory) {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert(path.basename(directory).startsWith('vimob-automation-create-scope-'));
    await rm(directory, { recursive: true, force: true });
  }
  assert.deepEqual(errors, []);
});

const replacements = [
  ['SID', [{ sid: 'sid-b' }]],
  ['actor', [{ actor: '55555555-5555-4555-8555-555555555555' }]],
  ['organization', [{ org: '77777777-7777-4777-8777-777777777777' }]],
  ['logout', [{ actor: null, sid: null }]],
  ['permission', [{ permissions: ['automations_view'] }]],
  ['module', [{ modules: [] }]],
  ['ABA', [{ sid: 'sid-b' }, { sid: 'sid-a' }]],
  ['unmount', null],
];
async function replace(patches) {
  if (!patches) { await page.evaluate(() => window.h.close()); await page.getByText('ready', { exact: true }).waitFor({ state: 'detached' }); return; }
  for (const patch of patches) {
    await page.evaluate(patch => window.h.change(patch), patch);
    await page.waitForFunction(patch => Object.entries(patch).every(([key, value]) => JSON.stringify(window.h.scope[key]) === JSON.stringify(value)), patch);
  }
}
async function finish(mode) {
  await page.waitForFunction(mode => mode === 'mutate' ? window.h.finishes > 0 : Boolean(window.h.outcome), mode);
  return page.evaluate(() => ({ requests: window.h.requests, invalidations: window.h.invalidations, callbacks: window.h.callbacks, toasts: window.h.toasts, outcome: window.h.outcome, aborted: window.h.signal?.aborted }));
}

for (const mode of ['async', 'mutate']) {
  for (const [name, patches] of replacements) {
    test(`${mode}: creation cannot start after retirement during onMutate: ${name}`, async () => {
      await page.evaluate(mode => { window.h.beforeGate = true; window.h.start(mode); }, mode);
      await page.waitForFunction(() => window.h.releaseBefore);
      await replace(patches);
      await page.evaluate(() => window.h.releaseBefore());
      const state = await finish(mode);
      assert.equal(state.requests.length, 0);
      assert.deepEqual(state.callbacks, []);
      assert.deepEqual(state.toasts, []);
      if (patches) assert.deepEqual(state.invalidations, []);
      else { assert.equal(state.invalidations.length, 1); assert.equal(state.invalidations[0].refetchType, 'none'); }
      if (mode === 'async') assert.equal(state.outcome.ok, false);
    });
    test(`${mode}: late accepted ACK cannot affect a retired editor: ${name}`, async () => {
      await page.evaluate(mode => { window.h.replyGate = true; window.h.start(mode); }, mode);
      await page.waitForFunction(() => window.h.reply);
      await replace(patches);
      await page.evaluate(() => window.h.reply());
      const state = await finish(mode);
      assert.equal(state.requests.length, 1);
      assert.equal(state.aborted, true);
      assert.deepEqual(state.callbacks, []);
      assert.deepEqual(state.toasts, []);
      if (patches) assert.deepEqual(state.invalidations, []);
      else { assert.equal(state.invalidations.length, 1); assert.equal(state.invalidations[0].refetchType, 'none'); }
      if (mode === 'async') assert.equal(state.outcome.ok, false);
    });
  }
  test(`${mode}: late transport error has no retired callbacks or notices`, async () => {
    await page.evaluate(mode => { window.h.replyGate = true; window.h.start(mode); }, mode);
    await page.waitForFunction(() => window.h.failReply);
    await replace([{ sid: 'sid-b' }]);
    await page.evaluate(() => window.h.failReply());
    const state = await finish(mode);
    assert.equal(state.requests.length, 1);
    assert.deepEqual(state.callbacks, []);
    assert.deepEqual(state.toasts, []);
    assert.deepEqual(state.invalidations, []);
    if (mode === 'async') assert.equal(state.outcome.ok, false);
  });
  test(`${mode}: current creation retains callbacks, pins and tenant-only invalidation`, async () => {
    await page.evaluate(mode => window.h.start(mode), mode);
    const state = await finish(mode);
    assert.equal(state.requests.length, 1);
    assert.deepEqual(state.requests[0], { url: '/v1/stage-automations', method: 'POST', organizationId, body: { stage_id: stageId, automation_type: 'change_deal_status_on_enter', deal_status: 'won' }, expectedUserId: actorId, expectedSessionId: 'sid-a', hasSignal: true, retry: false });
    assert.deepEqual(state.callbacks.map(item => item.name), ['onSuccess', 'onSettled']);
    assert.equal(state.toasts.filter(item => item.kind === 'success').length, 1);
    assert.equal(state.invalidations.length, 1);
    assert(state.invalidations[0].keys.every(key => key[2] === organizationId && key[3] === actorId));
    if (mode === 'async') assert.equal(state.outcome.ok, true);
  });
  test(`${mode}: current error is visible once and never automatically retried`, async () => {
    await page.evaluate(mode => { window.h.failNow = true; window.h.start(mode); }, mode);
    const state = await finish(mode);
    assert.equal(state.requests.length, 1);
    assert.deepEqual(state.callbacks.map(item => item.name), ['onError', 'onSettled']);
    assert.equal(state.toasts.filter(item => item.kind === 'error').length, 1);
    if (mode === 'async') assert.equal(state.outcome.ok, false);
  });
}

for (const gate of ['before', 'reply']) test(`same-SID token refresh retains the active creation: ${gate}`, async () => {
  await page.evaluate(gate => { window.h[gate === 'before' ? 'beforeGate' : 'replyGate'] = true; window.h.start(); }, gate);
  await page.waitForFunction(gate => window.h[gate === 'before' ? 'releaseBefore' : 'reply'], gate);
  await replace([{ nonce: 1 }]);
  await page.evaluate(gate => window.h[gate === 'before' ? 'releaseBefore' : 'reply'](), gate);
  const state = await finish('async');
  assert.equal(state.requests.length, 1);
  assert.equal(state.requests[0].expectedSessionId, 'sid-a');
  assert.equal(state.outcome.ok, true);
  assert.deepEqual(state.callbacks.map(item => item.name), ['onSuccess', 'onSettled']);
});

for (const patch of [{ organization_id: '77777777-7777-4777-8777-777777777777' }, { stage_id: '88888888-8888-4888-8888-888888888888' }]) test(`response from another scope is rejected: ${JSON.stringify(patch)}`, async () => {
  await page.evaluate(patch => { window.h.responsePatch = patch; window.h.start(); }, patch);
  const state = await finish('async');
  assert.equal(state.requests.length, 1);
  assert.equal(state.outcome.ok, false);
  assert.equal(state.toasts.filter(item => item.kind === 'success').length, 0);
  assert.deepEqual(state.callbacks.map(item => item.name), ['onError', 'onSettled']);
});

test('a retired pending observer resets and its ACK cannot unlock a new creation', async () => {
  await page.evaluate(() => { window.h.replyGate = true; window.h.start(); });
  await page.waitForFunction(() => window.h.reply);
  await page.evaluate(() => { window.h.replyA = window.h.reply; });
  await replace([{ sid: 'sid-b' }]);
  await page.waitForFunction(() => window.h.status === 'idle');
  await page.evaluate(() => { window.h.start(); });
  await page.waitForFunction(() => window.h.requests.length === 2 && window.h.status === 'pending');
  await page.evaluate(() => window.h.replyA());
  await page.waitForFunction(() => window.h.finishes === 1);
  assert.equal(await page.evaluate(() => window.h.status), 'pending');
  assert.deepEqual(await page.evaluate(() => window.h.toasts), []);
  assert.deepEqual(await page.evaluate(() => window.h.callbacks), []);
  await page.evaluate(() => window.h.reply());
  await page.waitForFunction(() => window.h.status === 'success');
  assert.equal(await page.evaluate(() => window.h.toasts.filter(item => item.kind === 'success').length), 1);
  assert.deepEqual(await page.evaluate(() => window.h.callbacks.map(item => item.name)), ['onSuccess', 'onSettled']);
});

async function prepareForm() {
  await page.evaluate(() => window.h.openForm());
  await page.getByLabel('Tipo de Automação', { exact: true }).click();
  await page.getByRole('option', { name: 'Alterar status (Ganho/Perdido)', exact: true }).click();
}

for (const gate of ['before', 'reply']) for (const [name, patches] of replacements.filter(([name]) => ['SID', 'actor', 'organization', 'unmount'].includes(name))) {
  test(`real create form cannot finish a retired editor: ${gate}/${name}`, async () => {
    await prepareForm();
    await page.evaluate(gate => { window.h[gate === 'before' ? 'beforeGate' : 'replyGate'] = true; }, gate);
    await page.getByRole('button', { name: 'Criar Automação', exact: true }).click();
    await page.waitForFunction(gate => window.h[gate === 'before' ? 'releaseBefore' : 'reply'], gate);
    await replace(patches);
    await page.evaluate(gate => window.h[gate === 'before' ? 'releaseBefore' : 'reply'](), gate);
    await page.waitForFunction(() => window.h.finishes === 1);
    assert.equal(await page.evaluate(() => window.h.formSuccesses), 0);
    assert.deepEqual(await page.evaluate(() => window.h.toasts), []);
    assert.equal(await page.evaluate(() => window.h.requests.length), gate === 'before' ? 0 : 1);
    if (patches) assert.deepEqual(await page.evaluate(() => window.h.invalidations), []);
  });
}

test('real create form keeps its current success callback and releases its saving state', async () => {
  await prepareForm();
  await page.getByRole('button', { name: 'Criar Automação', exact: true }).click();
  await page.waitForFunction(() => window.h.formSuccesses === 1);
  assert.equal(await page.getByRole('button', { name: 'Criar Automação', exact: true }).isEnabled(), true);
  assert.equal(await page.evaluate(() => window.h.editorStates.at(-1).isSaving), false);
});

test('real create form ignores an old error without changing the new editor draft', async () => {
  await prepareForm();
  await page.evaluate(() => { window.h.replyGate = true; });
  await page.getByRole('button', { name: 'Criar Automação', exact: true }).click();
  await page.waitForFunction(() => window.h.failReply);
  await replace([{ sid: 'sid-b' }]);
  await page.getByLabel('Tipo de Automação', { exact: true }).click();
  await page.getByRole('option', { name: 'Alterar status (Ganho/Perdido)', exact: true }).click();
  await page.getByLabel('Novo Status do Deal', { exact: true }).click();
  await page.getByRole('option', { name: 'Perdido', exact: true }).click();
  await page.evaluate(() => window.h.failReply());
  await page.waitForFunction(() => window.h.finishes === 1);
  assert.equal(await page.getByLabel('Novo Status do Deal', { exact: true }).innerText(), 'Perdido');
  assert.equal(await page.getByRole('button', { name: 'Criar Automação', exact: true }).isEnabled(), true);
  assert.equal(await page.evaluate(() => window.h.formSuccesses), 0);
  assert.deepEqual(await page.evaluate(() => window.h.toasts), []);
  assert.equal(await page.getByRole('alert').count(), 0);
});

test('stale real form submit handler cannot mark the replacement editor as saving', async () => {
  await prepareForm();
  await page.locator('form').evaluate(form => {
    const props = Object.keys(form).find(key => key.startsWith('__reactProps'));
    window.h.oldSubmit = form[props].onSubmit;
  });
  await replace([{ sid: 'sid-b' }]);
  const before = await page.evaluate(() => window.h.editorStates);
  await page.evaluate(() => window.h.oldSubmit(new Event('submit', { cancelable: true })));
  assert.deepEqual(await page.evaluate(() => window.h.editorStates), before);
  assert.deepEqual(await page.evaluate(() => window.h.toasts), []);
  assert.equal(await page.evaluate(() => window.h.requests.length), 0);
});

test('a stale guard factory cannot adopt a newer session visit', async () => {
  await page.evaluate(() => { window.h.oldGuardFactory = window.h.captureScopeGuard; });
  await replace([{ sid: 'sid-b' }]);
  assert.equal(await page.evaluate(() => window.h.oldGuardFactory()()), false);
  assert.equal(await page.evaluate(() => window.h.captureScopeGuard()()), true);
});
