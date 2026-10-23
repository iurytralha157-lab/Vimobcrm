import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// Real React/QueryClient and production hooks. Auth/API are deferred synthetic
// boundaries; Chromium aborts every external request and starts no app service.
const require = createRequire(import.meta.url);
const { webpack } = require('next/dist/compiled/webpack/webpack.js');
const repository = dirname(dirname(fileURLToPath(import.meta.url)));
let directory, browser, bundle;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vimob-wa-session-intent-'));
  const aliases = {};
  const mock = async (name, source) => {
    const file = join(directory, `${Object.keys(aliases).length}.js`);
    await writeFile(file, source); aliases[name] = file;
  };
  await mock('@/contexts/AuthContext', 'export const useAuth=()=>({profile:{id:window.h.scope.userId,name:"Synthetic",organization_id:window.h.originalOrganizationId},activeOrganization:{organizationId:window.h.scope.organizationId}});');
  await mock('@/hooks/use-whatsapp-query-scope', 'export const useWhatsAppQueryScope=()=>window.h.scope;');
  await mock('@/hooks/use-accessible-sessions', 'export const useAccessibleSessions=()=>({data:window.h.sessions});');
  await mock('@/hooks/use-toast', 'export const toast=x=>window.h.toasts.push(x);export const useToast=()=>({toast});');
  await mock('sonner', 'export const toast={info:x=>window.h.toasts.push(x),loading:x=>{window.h.toasts.push(x);return 1},success:x=>window.h.toasts.push(x),error:x=>window.h.toasts.push(x),dismiss:()=>window.h.dismissed++,promise:()=>{}};');
  await mock('@/lib/api/whatsapp', 'export const whatsappAPI=new Proxy({}, {get:(_,name)=>(...args)=>window.h.request(name,args)});');
  await mock('@/services/NotificationService', 'export const notificationService={send:(payload,intent)=>window.h.request("notification",[payload,intent])};');
  if (process.env.WHATSAPP_MUTATION_INTENT_BASELINE) aliases['@/hooks/integrations/whatsapp/use-whatsapp-mutation-intent'] = process.env.WHATSAPP_MUTATION_INTENT_BASELINE;
  const loader = join(directory, 'loader.cjs'), entry = join(directory, 'entry.js');
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;`);
  const sessionsSource = process.env.WHATSAPP_SESSION_ACTOR_BASELINE || join(repository, 'hooks/use-whatsapp-sessions.ts');
  await writeFile(entry, `
    import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
    import {QueryClient,QueryClientProvider,MutationCache} from '@tanstack/react-query';
    import {useWhatsAppIntentMutation} from '@/hooks/integrations/whatsapp/use-whatsapp-mutation-intent';
    import * as sessions from ${JSON.stringify(sessionsSource)};
    import * as contacts from ${JSON.stringify(join(repository, 'hooks/use-whatsapp-contacts.ts'))};
    import * as groups from ${JSON.stringify(join(repository, 'hooks/use-whatsapp-groups.ts'))};
    import * as labels from ${JSON.stringify(join(repository, 'hooks/use-whatsapp-labels.ts'))};
    import {useVerifyWhatsAppSessionStatus} from ${JSON.stringify(join(repository, 'hooks/integrations/whatsapp/use-whatsapp-session-statuses.ts'))};
    import {useJoinWhatsAppAttendance} from ${JSON.stringify(join(repository, 'hooks/use-whatsapp-attendance.ts'))};
    import {useWhatsAppHealthMonitor} from ${JSON.stringify(join(repository, 'hooks/use-whatsapp-health-monitor.ts'))};
    import {useHasWhatsAppAccess} from ${JSON.stringify(join(repository, 'hooks/use-whatsapp-access.ts'))};
    import {whatsappQueryKeys as keys,getWhatsAppSendFailureStatus} from ${JSON.stringify(join(repository, 'lib/whatsapp-query-cache.ts'))};
    const root=createRoot(document.getElementById('root'));
    const h=window.h={scope:{organizationId:'org-a',userId:'user-a',accessScope:'allowed'},originalOrganizationId:'org-a',authUser:'user-a',requests:[],http:[],toasts:[],dismissed:0,callbacks:0,deferAuth:false,ignoreAbort:false,globalDelay:false,globalWaiters:[],cancelWaiters:[],readers:false,live:false,optionsVersion:1,optionCallbacks:[],
      session:{id:'session-a',organization_id:'org-a',owner_user_id:'user-a',provider:'evolution_go',is_active:true,status:'connected',instance_name:'synthetic',display_name:'Synthetic',updated_at:'2026-10-11T00:00:00Z'},sessions:[],
      render(scope=this.scope){this.scope={...scope};this.authUser=scope.userId;if(this.sessions.length)client.setQueryData(keys.sessions(scope),this.sessions);flushSync(()=>root.render(React.createElement(QueryClientProvider,{client},React.createElement(Hooks))));},
      unmount(){flushSync(()=>root.render(null));},
      request(name,args){const last=args.at(-1);const intent=last&&typeof last==='object'&&('expectedUserId'in last||'signal'in last)?last:{};const expected=intent.expectedUserId===undefined?this.authUser:intent.expectedUserId;
        return new Promise((resolve,reject)=>{const r={name,args,intent,expected,resolve,reject,aborted:false,started:false};this.requests.push(r);
          const abort=()=>{r.aborted=true;if(!this.ignoreAbort)reject(intent.signal.reason||new DOMException('Aborted','AbortError'));};
          if(intent.signal?.aborted){abort();return}intent.signal?.addEventListener('abort',abort,{once:true});
          r.begin=()=>{if(intent.signal?.aborted){abort();return}if(expected!==this.authUser){const e=new Error('Identity changed');e.code='api_request_identity_changed';e.status=409;reject(e);return}
            try{intent.onRequestStart?.();r.started=true;this.http.push({name,expected,args})}catch(error){reject(error)}};
          if(!this.deferAuth)r.begin();
        });},
      releaseAuth(){for(const r of this.requests)if(!r.started&&!r.aborted)r.begin();},
      finish(index=0){const r=this.requests[index];const response=r.name==='createSession'||r.name==='recreateSession'?{session:{...this.session}}:r.name==='getSessions'?{data:[{...this.session}],meta:{}}:r.name==='joinConversationAttendance'?{joined:true}:r.name==='getConnectionStatus'?{connected:true,status:'connected'}:{data:{},ok:true,qrcode:'synthetic-qr'};r.resolve(response);},
      mutate(name,input,withCallbacks=false){this.outcome=null;this.operations[name].mutateAsync(input,withCallbacks?{onSuccess:()=>this.callbacks++,onError:()=>this.callbacks++,onSettled:()=>this.callbacks++}:undefined).then(()=>this.outcome={ok:true},e=>this.outcome={ok:false,code:e.code,status:getWhatsAppSendFailureStatus(e)});},
      delayCancel(){client.cancelQueries=()=>new Promise(resolve=>this.cancelWaiters.push(resolve));},releaseCancel(){for(const resolve of this.cancelWaiters.splice(0))resolve();},releaseGlobal(){for(const resolve of this.globalWaiters.splice(0))resolve();},
      seed(scope=this.scope){client.setQueryData(keys.sessions(scope),[{...this.session}]);client.setQueryData(keys.accessibleSessions(scope),[{...this.session}]);},
      cachedStatus(scope=this.scope){return client.getQueryData(keys.sessions(scope))?.[0]?.status;},
    };
    const client=h.client=new QueryClient({mutationCache:new MutationCache({onMutate:()=>h.globalDelay?new Promise(resolve=>h.globalWaiters.push(resolve)):undefined}),defaultOptions:{queries:{retry:false,gcTime:Infinity},mutations:{retry:false}}});
    function Hooks(){h.operations={create:sessions.useCreateWhatsAppSession(),delete:sessions.useDeleteWhatsAppSession(),logout:sessions.useLogoutSession(),qr:sessions.useGetQRCode(),status:sessions.useGetConnectionStatus(),grant:sessions.useGrantSessionAccess(),revoke:sessions.useRevokeSessionAccess(),recreate:sessions.useRecreateWhatsAppInstance(),notification:sessions.useToggleNotificationSession(),ai:sessions.useToggleAIAutoReplySession(),verify:useVerifyWhatsAppSessionStatus(),attendance:useJoinWhatsAppAttendance(),check:contacts.useCheckWhatsAppNumber(),avatar:contacts.useFetchAvatar(),syncAvatars:contacts.useSyncContactsAvatars(),history:contacts.useHistorySync(),syncGroups:groups.useSyncGroups(),groupInfo:groups.useGroupInfo(),invite:groups.useGroupInviteLink(),updateGroup:groups.useUpdateGroup(),syncLabels:labels.useSyncLabels(),label:labels.useAssignLabel()};
      const version=h.optionsVersion;h.operations.custom=useWhatsAppIntentMutation({mutationFn:(value,intent)=>h.request('custom',[{value,version},intent]),onSuccess:()=>h.optionCallbacks.push(version)});
      sessions.useWhatsAppSessions({enabled:h.readers});sessions.useWhatsAppSession(h.readers?'session-a':null);sessions.useSessionAccess(h.readers?'session-a':null);groups.useWhatsAppGroups(h.readers?'session-a':undefined);labels.useWhatsAppLabels(h.readers?'session-a':undefined);labels.useChatLabels(h.readers?'conversation-a':undefined);useHasWhatsAppAccess({enabled:h.readers});
      sessions.useWhatsAppLiveStatusSync(h.sessions,{enabled:h.live});h.health=useWhatsAppHealthMonitor();return React.createElement('div',null,'Synthetic');}
    h.render();h.seed();
  `);
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode: 'development', target: 'web', entry, output: { path: directory, filename: 'bundle.js', publicPath: '' },
      plugins: [new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 })],
      resolve: { extensions: ['.ts', '.tsx', '.js'], modules: [join(repository, 'node_modules'), 'node_modules'], alias: { ...aliases, '@': repository } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] } });
    compiler.run((error, stats) => compiler.close(() => error ? reject(error) : stats.hasErrors() ? reject(new Error(stats.toString({ all: false, errors: true }))) : resolve()));
  });
  bundle = await readFile(join(directory, 'bundle.js'), 'utf8');
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); if (directory) await rm(directory, { recursive: true, force: true }); });

async function fixture(t) {
  const page = await browser.newPage(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.abort());
  await page.setContent('<div id="root"></div>'); await page.addScriptTag({ content: bundle });
  t.after(async () => { await page.close(); assert.deepEqual(errors, []); });
  assert.equal(await page.evaluate(() => typeof window.h), 'object', errors.join(' | '));
  return page;
}
const scopeB = { organizationId: 'org-a', userId: 'user-b', accessScope: 'allowed' };
const scopeOtherOrg = { organizationId: 'org-b', userId: 'user-a', accessScope: 'allowed' };
const waitOutcome = page => page.waitForFunction(() => window.h.outcome !== null);

test('create gesture cannot cross an async global onMutate to another actor', async t => {
  const page = await fixture(t); await page.evaluate(() => { h.globalDelay = true; h.mutate('create', { displayName: 'Synthetic', provider: 'evolution_go' }); });
  await page.waitForFunction(() => h.globalWaiters.length === 1); await page.evaluate(scope => { h.render(scope); h.releaseGlobal(); }, scopeB);
  await page.waitForFunction(() => h.outcome !== null || h.requests.length > 0);
  assert.equal(await page.evaluate(() => h.http.length), 0); assert.equal(await page.evaluate(() => h.outcome?.code), 'whatsapp_send_context_changed');
});

test('create auth wait is aborted before any HTTP after actor change', async t => {
  const page = await fixture(t); await page.evaluate(() => { h.deferAuth = true; h.mutate('create', { displayName: 'Synthetic' }); });
  await page.waitForFunction(() => h.requests.length === 1); await page.evaluate(scope => { h.render(scope); h.releaseAuth(); }, scopeB); await waitOutcome(page);
  assert.deepEqual(await page.evaluate(() => [h.requests[0].expected, h.requests[0].aborted, h.http.length, h.outcome.code]), ['user-a', true, 0, 'whatsapp_send_context_changed']);
});

test('delete cache cancellation cannot remove another actor cache or start DELETE', async t => {
  const page = await fixture(t); await page.evaluate(scope => { h.seed(scope); h.delayCancel(); h.mutate('delete', h.session); }, scopeB);
  await page.waitForFunction(() => h.cancelWaiters.length >= 2); await page.evaluate(scope => { h.render(scope); h.releaseCancel(); }, scopeB);
  await page.waitForFunction(() => h.outcome !== null || h.requests.length > 0);
  assert.deepEqual(await page.evaluate(scope => [h.http.length, h.cachedStatus(scope), h.outcome?.code], scopeB), [0, 'connected', 'whatsapp_send_context_changed']);
});

test('logout during cancelQueries remains cancelled through actor A to B to A', async t => {
  const page = await fixture(t); await page.evaluate(() => { h.delayCancel(); h.mutate('logout', h.session); }); await page.waitForFunction(() => h.cancelWaiters.length >= 2);
  await page.evaluate(scope => { const original = h.scope; h.render(scope); h.render(original); h.releaseCancel(); }, scopeB);
  await page.waitForFunction(() => h.outcome !== null || h.requests.length > 0);
  assert.deepEqual(await page.evaluate(() => [h.http.length, h.cachedStatus(), h.outcome?.code]), [0, 'connected', 'whatsapp_send_context_changed']);
});

test('post-HTTP stale grant resolution cannot toast or run caller callbacks in B', async t => {
  const page = await fixture(t); await page.evaluate(() => { h.ignoreAbort = true; h.mutate('grant', { sessionId: 'session-a', userId: 'recipient' }, true); });
  await page.waitForFunction(() => h.http.length === 1); await page.evaluate(scope => { h.render(scope); h.finish(); }, scopeB); await waitOutcome(page);
  assert.deepEqual(await page.evaluate(() => [h.toasts.length, h.callbacks, h.outcome.status]), [0, 0, 'confirming']);
});

test('unmount during QR auth wait prevents its POST and never returns QR', async t => {
  const page = await fixture(t); await page.evaluate(() => { h.deferAuth = true; h.mutate('qr', { provider: 'evolution_go', sessionId: 'session-a', instanceName: 'synthetic' }); });
  await page.waitForFunction(() => h.requests.length === 1); await page.evaluate(() => { h.unmount(); h.releaseAuth(); }); await waitOutcome(page);
  assert.deepEqual(await page.evaluate(() => [h.http.length, h.outcome.ok, h.outcome.code]), [0, false, 'whatsapp_send_context_changed']);
});

test('a post-HTTP unmount is uncertain rather than a definitive safe failure', async t => {
  const page = await fixture(t); await page.evaluate(() => h.mutate('create', { displayName: 'Synthetic' })); await page.waitForFunction(() => h.http.length === 1);
  await page.evaluate(() => h.unmount()); await waitOutcome(page);
  assert.deepEqual(await page.evaluate(() => [h.outcome.status, h.toasts.length]), ['confirming', 0]);
});

test('live status aborts old actor probe and starts only the new actor session', async t => {
  const page = await fixture(t); await page.evaluate(() => { h.deferAuth = true; h.live = true; h.sessions = [h.session]; h.render(); }); await page.waitForFunction(() => h.requests.length === 1);
  await page.evaluate(scope => { h.sessions = [{ ...h.session, id: 'session-b', owner_user_id: 'user-b' }]; h.render(scope); }, scopeB); await page.waitForFunction(() => h.requests.length === 2);
  await page.evaluate(() => { h.releaseAuth(); h.finish(1); });
  assert.deepEqual(await page.evaluate(() => [h.requests[0].expected, h.requests[0].aborted, h.http.map(x => x.expected), h.http.map(x => x.args[0])]), ['user-a', true, ['user-b'], ['session-b']]);
});

test('health sequence stops after context change without checking the next old session', async t => {
  const page = await fixture(t); await page.evaluate(() => { h.deferAuth = true; h.sessions = [h.session, { ...h.session, id: 'session-old-2' }]; h.render(); h.health.checkNow(); }); await page.waitForFunction(() => h.requests.length === 1);
  await page.evaluate(scope => { h.render(scope); h.releaseAuth(); }, scopeB); await page.waitForFunction(() => h.dismissed === 1);
  assert.deepEqual(await page.evaluate(() => [h.requests.length, h.requests[0].aborted, h.http.length]), [1, true, 0]);
});

test('health in secondary organization issues no operational provider request', async t => {
  const page = await fixture(t); await page.evaluate(scope => { h.sessions = [h.session]; h.render(scope); h.health.checkNow(); }, scopeOtherOrg);
  assert.equal(await page.evaluate(() => h.requests.length), 0);
});

test('all enabled session/access/group/label queries bind the query actor and signal', async t => {
  const page = await fixture(t); await page.evaluate(() => { h.deferAuth = true; h.readers = true; h.render(); }); await page.waitForFunction(() => h.requests.length >= 6);
  const read = await page.evaluate(() => h.requests.map(x => ({ name: x.name, expected: x.expected, signal: !!x.intent.signal })));
  assert.ok(read.some(x => x.name === 'getSessionAccess')); assert.ok(read.some(x => x.name === 'getLabels'));
  assert.ok(read.every(x => x.expected === 'user-a' && x.signal));
  await page.evaluate(scope => h.render(scope), scopeB); await page.waitForFunction(() => h.requests.some(x => x.expected === 'user-b'));
  assert.equal(await page.evaluate(() => h.requests.filter(x => x.expected === 'user-a').every(x => x.aborted)), true);
});

test('logout notification keeps the actor while its own auth resolution waits', async t => {
  const page = await fixture(t); await page.evaluate(() => h.mutate('logout', h.session)); await page.waitForFunction(() => h.requests.length === 1);
  await page.evaluate(() => { h.deferAuth = true; h.finish(); }); await page.waitForFunction(() => h.requests.length === 2);
  assert.equal(await page.evaluate(() => h.requests[1].name), 'notification'); assert.equal(await page.evaluate(() => h.requests[1].expected), 'user-a');
  await page.evaluate(scope => { h.render(scope); h.releaseAuth(); }, scopeB); await waitOutcome(page);
  assert.deepEqual(await page.evaluate(() => [h.http.length, h.requests[1].aborted, h.outcome.status]), [1, true, 'confirming']);
});

test('mutation functions remain stable across equal-scope render and mutation state updates', async t => {
  const page = await fixture(t); await page.evaluate(() => { h.originalFunctions = [h.operations.create.mutate, h.operations.create.mutateAsync, h.operations.custom.mutate, h.operations.custom.mutateAsync]; h.render({ ...h.scope }); });
  const identity = () => h.originalFunctions.every((fn, index) => fn === [h.operations.create.mutate, h.operations.create.mutateAsync, h.operations.custom.mutate, h.operations.custom.mutateAsync][index]);
  assert.equal(await page.evaluate(identity), true);
  await page.evaluate(() => h.mutate('custom', 'synthetic')); await page.waitForFunction(() => h.requests.length === 1);
  assert.equal(await page.evaluate(identity), true);
  await page.evaluate(() => h.finish()); await waitOutcome(page);
  assert.equal(await page.evaluate(identity), true);
});

test('stable functions use latest options for a new gesture and preserve original options during an async wait', async t => {
  const page = await fixture(t); await page.evaluate(() => { h.globalDelay = true; h.mutate('custom', 'first'); }); await page.waitForFunction(() => h.globalWaiters.length === 1);
  await page.evaluate(() => { h.optionsVersion = 2; h.render({ ...h.scope }); h.globalDelay = false; h.releaseGlobal(); }); await page.waitForFunction(() => h.requests.length === 1);
  assert.equal(await page.evaluate(() => h.requests[0].args[0].version), 1);
  await page.evaluate(() => h.finish()); await waitOutcome(page);
  assert.deepEqual(await page.evaluate(() => h.optionCallbacks), [1]);
  await page.evaluate(() => h.mutate('custom', 'second')); await page.waitForFunction(() => h.requests.length === 2);
  assert.equal(await page.evaluate(() => h.requests[1].args[0].version), 2);
  await page.evaluate(() => h.finish(1)); await waitOutcome(page);
  assert.deepEqual(await page.evaluate(() => h.optionCallbacks), [1, 2]);
});

test('an old custom callback remains denied after permission scope changes', async t => {
  const page = await fixture(t); await page.evaluate(() => { h.ignoreAbort = true; h.mutate('custom', 'old'); }); await page.waitForFunction(() => h.http.length === 1);
  await page.evaluate(() => { h.optionsVersion = 2; h.render({ ...h.scope, accessScope: 'revoked' }); h.finish(); }); await waitOutcome(page);
  assert.deepEqual(await page.evaluate(() => [h.optionCallbacks, h.outcome.status]), [[], 'confirming']);
});

const cases = [
  ['grant', { sessionId: 'session-a', userId: 'recipient' }], ['revoke', { sessionId: 'session-a', userId: 'recipient' }],
  ['recreate', { id: 'session-a', provider: 'evolution_go' }], ['notification', { sessionId: 'session-a', enabled: true }],
  ['ai', { sessionId: 'session-a', enabled: true }], ['verify', 'session-a'],
  ['attendance', { conversationId: 'conversation-a', expectedLeadId: 'lead-a', sendSessionId: 'session-a' }],
  ['check', { sessionId: 'session-a', numbers: ['+5511999999999'] }], ['avatar', { sessionId: 'session-a', jid: 'synthetic@s.whatsapp.net' }],
  ['syncAvatars', 'session-a'], ['history', { sessionId: 'session-a' }], ['syncGroups', 'session-a'],
  ['groupInfo', { sessionId: 'session-a', jid: 'synthetic@g.us' }], ['invite', { sessionId: 'session-a', jid: 'synthetic@g.us' }],
  ['updateGroup', { sessionId: 'session-a', jid: 'synthetic@g.us', field: 'name', value: 'Synthetic' }],
  ['syncLabels', 'session-a'], ['label', { sessionId: 'session-a', remoteJid: 'synthetic@s.whatsapp.net', labelId: 'label-a', conversationId: 'conversation-a', add: true }],
];
for (const [name, input] of cases) test(`normal ${name} preserves public input and binds the gesture actor`, async t => {
  const page = await fixture(t); await page.evaluate(({ name, input }) => h.mutate(name, input), { name, input }); await page.waitForFunction(() => h.requests.length === 1);
  assert.deepEqual(await page.evaluate(() => [h.requests[0].expected, !!h.requests[0].intent.signal, h.http.length]), ['user-a', true, 1]);
  await page.evaluate(() => h.finish()); await waitOutcome(page); assert.equal(await page.evaluate(() => h.outcome.ok), true);
});
