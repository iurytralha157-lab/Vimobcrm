import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const require = createRequire(import.meta.url);
const { webpack } = require('next/dist/compiled/webpack/webpack.js');
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sources = process.env.VIMOB_FINAL_PUSH_BASELINE ? 'D:/Vimob/tmp/whatsapp-final-adjustments-20261012/media/baseline'
  : process.env.VIMOB_PUSH_DEVICE_BASELINE ? 'D:/Vimob/tmp/whatsapp-deep-fixes-20261012/media/baseline' : repository;
let directory, browser, bundle;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vimob-push-device-runtime-'));
  const paths = Object.fromEntries(['entry', 'loader', 'auth', 'settings', 'plugin', 'navigation', 'access', 'client'].map(name => [name, join(directory, `${name}.${name === 'loader' ? 'cjs' : 'js'}`)]));
  await writeFile(paths.loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;`);
  await writeFile(paths.auth, 'export const useAuth=()=>window.h.auth;');
  await writeFile(paths.settings, `export const settingsAPI={getPushConfig:async()=>({enabled:true,publicKey:window.h.publicKey}),savePushToken:(...args)=>window.h.request('save',args),deactivatePushToken:(...args)=>window.h.request('deactivate',args)};`);
  await writeFile(paths.plugin, 'export const PushNotifications={requestPermissions:async()=>({receive:"granted"}),register:async()=>{window.h.registrations++},addListener:async(event,callback)=>{const item={event,callback,removed:false};window.h.listeners.push(item);return {remove:async()=>{item.removed=true}}}};');
  await writeFile(paths.navigation, 'export const useRouter=()=>window.h.router;');
  await writeFile(paths.access, 'export const isTenantContextForOrganization=()=>true;export const getTenantEnabledModules=()=>["whatsapp"];export const getTenantPermissions=()=>["whatsapp_view"];');
  await writeFile(paths.client, 'export const getVimobAPIAccessTokenUserId=()=>window.h.auth.user?.id||null;export const getVimobAPIAccessTokenSessionId=()=>window.h.auth.sessionId||null;');
  await writeFile(paths.entry, `
    import React,{useEffect} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
    import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
    import {usePushNotifications} from ${JSON.stringify(join(sources, 'hooks/use-push-notifications.ts'))};
    import {useWebPush} from ${JSON.stringify(join(sources, 'hooks/use-web-push.ts'))};
    import {rememberCurrentPushEndpoint,deactivateCurrentPushEndpoint} from ${JSON.stringify(join(sources, 'lib/pwa/push-session.ts'))};
    import {usePushDeviceIntent} from ${JSON.stringify(join(sources, 'hooks/use-push-device-intent.ts'))};
    const root=createRoot(document.getElementById('root')),client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
    const actor=(id,sessionId='session-'+id)=>({user:{id},sessionId,profile:{id,organization_id:'org-a'},activeOrganization:{organizationId:'org-a'},tenantContext:{}});
    window.h={mode:'native',auth:actor('user-a'),requests:[],listeners:[],registrations:0,routes:[],unsubscribes:0,subscription:null,publicKey:'AQIDBA',errors:[],
      request(kind,args){return new Promise((resolve,reject)=>this.requests.push({kind,args,resolve,reject}))},
      emit(token){this.listeners.filter(item=>!item.removed&&item.event==='registration').forEach(item=>item.callback({value:token}))},
      render(id='user-a',mode=this.mode,organizationId='org-a',sessionId='session-'+id){this.auth=actor(id,sessionId);this.auth.activeOrganization.organizationId=organizationId;this.mode=mode;flushSync(()=>root.render(React.createElement(QueryClientProvider,{client},React.createElement(Host))))},
      unmount(){flushSync(()=>root.render(null))},remember(endpoint){rememberCurrentPushEndpoint(endpoint)},
      subscribe(){this.operation=this.value.subscribe().catch(error=>{this.errors.push(error.name);return {ok:false}})},
      unsubscribe(){this.operation=this.value.unsubscribe().catch(error=>{this.errors.push(error.name);return false})},
      makeSubscription(){return {endpoint:'https://push.example.test/device',options:{applicationServerKey:new Uint8Array([1,2,3,4]).buffer},toJSON(){return {endpoint:this.endpoint,keys:{p256dh:'synthetic',auth:'synthetic'}}},unsubscribe:async()=>{h.unsubscribes++;return true}}},
      resolveRequest(index){this.requests[index].resolve({ok:true,active:true})}
    };
    h.router={push:path=>h.routes.push(path)};
    const registration={scope:'https://crm.example.test/',active:{scriptURL:'https://crm.example.test/sw.js'},update:async()=>{},pushManager:{
      getSubscription:()=>h.mirror?new Promise(resolve=>{h.mirrorResolve=()=>{h.mirror=false;resolve(h.subscription)}}):Promise.resolve(h.subscription),
      subscribe:async()=>{h.subscription=h.makeSubscription();return h.subscription}
    }};
    Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{getRegistration:async()=>registration,register:async()=>registration,ready:Promise.resolve(registration)}});
    window.PushManager=function(){};window.Notification={permission:'granted',requestPermission:async()=> 'granted'};
    window.Capacitor={isNativePlatform:()=>h.mode==='native',getPlatform:()=> 'android'};
    function Native(){const value=usePushNotifications();useEffect(()=>{h.value=value});return React.createElement('div',null,'Native')}
    function Web(){const value=useWebPush();useEffect(()=>{h.value=value});return React.createElement('div',null,value.isReady?'Ready':'Loading')}
    function Logout(){const capture=usePushDeviceIntent(h.auth.user.id,h.auth.activeOrganization.organizationId);useEffect(()=>{h.beginLogout=()=>{h.logoutIntent=capture();h.operation=deactivateCurrentPushEndpoint(h.auth.activeOrganization.organizationId,{expectedUserId:h.logoutIntent.userId,expectedSessionId:h.logoutIntent.sessionId,signal:h.logoutIntent.signal,isCurrent:h.logoutIntent.isCurrent}).finally(h.logoutIntent.finish)}});return React.createElement('div',null,'Logout')}
    function Host(){return h.mode==='native'?React.createElement(Native):h.mode==='logout'?React.createElement(Logout):React.createElement(Web)}
  `);
  await new Promise((resolveBuild, rejectBuild) => {
    const compiler = webpack({ mode: 'development', target: 'web', entry: paths.entry, output: { path: directory, filename: 'push.js' },
      resolve: { extensions: ['.ts', '.tsx', '.js'], modules: [join(repository, 'node_modules'), 'node_modules'], alias: {
        '@/contexts/AuthContext': paths.auth, '@/lib/api/settings': paths.settings, '@capacitor/push-notifications': paths.plugin,
        'next/navigation': paths.navigation, '@/lib/access/tenant-navigation': paths.access, '@/lib/api/vimob-client': paths.client,
        '@/lib/pwa/push-session': join(sources, 'lib/pwa/push-session.ts'), '@/hooks/use-push-device-intent': join(sources, 'hooks/use-push-device-intent.ts'), '@': repository,
      } }, module: { parser: { javascript: { dynamicImportMode: 'eager' } }, rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: paths.loader }] } });
    compiler.run((error, stats) => compiler.close(() => error ? rejectBuild(error) : stats.hasErrors() ? rejectBuild(new Error(stats.toString({ all: false, errors: true }))) : resolveBuild()));
  });
  bundle = await readFile(join(directory, 'push.js'), 'utf8');
  browser = await chromium.launch({ headless: true });
}, { timeout: 90000 });
after(async () => {
  await browser?.close();
  if (directory) {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + '\\') || resolve(directory).startsWith(resolve(tmpdir()) + '/'));
    assert.ok(basename(directory).startsWith('vimob-push-device-runtime-'));
    await rm(directory, { recursive: true, force: true });
  }
});
async function open(t, mode = 'native') {
  const page = await browser.newPage();
  page.setDefaultTimeout(4000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().isNavigationRequest() ? route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }) : route.abort());
  await page.goto('https://crm.example.test');
  await page.addScriptTag({ content: bundle });
  await page.evaluate(mode => h.render('user-a', mode), mode);
  if (mode === 'native') await page.waitForFunction(() => h.registrations === 1);
  else if (mode === 'web') await page.getByText('Ready', { exact: true }).waitFor();
  t.after(async () => { await page.close(); assert.deepEqual(errors, []); });
  return page;
}
test('native old registration completion cannot remember a token over the new login', async t => {
  const page = await open(t);
  await page.evaluate(() => h.emit('token-a-synthetic'));
  await page.waitForFunction(() => h.requests.length === 1);
  await page.evaluate(() => h.render('user-b'));
  await page.waitForFunction(() => h.registrations === 2);
  await page.evaluate(() => { h.emit('token-b-synthetic'); h.resolveRequest(1); });
  await page.waitForFunction(() => sessionStorage.getItem('vimob-current-push-endpoint') === 'native:android:token-b-synthetic');
  await page.evaluate(() => h.resolveRequest(0));
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
  assert.equal(await page.evaluate(() => sessionStorage.getItem('vimob-current-push-endpoint')), 'native:android:token-b-synthetic');
  assert.equal(await page.evaluate(() => h.requests[0].args[2]?.expectedUserId), 'user-a');
  assert.equal(await page.evaluate(() => h.requests[0].args[2]?.signal.aborted), true);
});
test('native delayed deactivation cannot forget the current login token', async t => {
  const page = await open(t);
  await page.evaluate(() => { h.emit('token-a-synthetic'); h.resolveRequest(0); });
  await page.waitForFunction(() => sessionStorage.getItem('vimob-current-push-endpoint') === 'native:android:token-a-synthetic');
  await page.evaluate(() => { h.operation=h.value.deactivateToken(); h.render('user-b'); });
  await page.waitForFunction(() => h.registrations === 2);
  await page.evaluate(() => { h.emit('token-b-synthetic'); h.resolveRequest(2); });
  await page.waitForFunction(() => sessionStorage.getItem('vimob-current-push-endpoint') === 'native:android:token-b-synthetic');
  await page.evaluate(async () => { h.resolveRequest(1); await h.operation; });
  assert.equal(await page.evaluate(() => sessionStorage.getItem('vimob-current-push-endpoint')), 'native:android:token-b-synthetic');
});
test('a removed native listener cannot register again for the new actor', async t => {
  const page = await open(t);
  await page.evaluate(() => { h.oldListener=h.listeners.find(item=>item.event==='registration').callback;h.render('user-b'); });
  await page.waitForFunction(() => h.registrations === 2);
  await page.evaluate(() => h.oldListener({value:'late-old-token'}));
  assert.equal(await page.evaluate(() => h.requests.length), 0);
});
test('web save failure after identity change cannot unsubscribe the new binding', async t => {
  const page = await open(t, 'web');
  await page.evaluate(() => h.subscribe());
  await page.waitForFunction(() => h.requests.length === 1);
  await page.evaluate(() => { h.render('user-b'); h.remember(h.subscription.endpoint); h.requests[0].reject(new Error('stale auth')); });
  await page.waitForFunction(() => h.requests.length === 2);
  await page.evaluate(() => h.resolveRequest(1));
  await page.getByText('Ready', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => h.unsubscribes), 0);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('vimob-current-push-endpoint')), 'https://push.example.test/device');
  assert.equal(await page.evaluate(() => h.requests[0].args[2]?.signal.aborted), true);
  assert.equal(await page.evaluate(() => h.requests[1].args[2]?.expectedUserId), 'user-b');
});
test('web unsubscribe paused at mirror lookup cannot deactivate a newer actor', async t => {
  const page = await open(t, 'web');
  await page.evaluate(() => { h.subscription=h.makeSubscription(); h.mirror=true; h.unsubscribe(); });
  await page.waitForFunction(() => Boolean(h.mirrorResolve));
  await page.evaluate(() => { h.render('user-b'); h.remember(h.subscription.endpoint); h.mirrorResolve(); });
  await page.waitForFunction(() => h.requests.length === 1);
  assert.equal(await page.evaluate(() => h.requests.filter(item=>item.kind==='deactivate').length), 0);
  assert.equal(await page.evaluate(() => h.unsubscribes), 0);
  await page.evaluate(() => h.resolveRequest(0));
  await page.getByText('Ready', { exact: true }).waitFor();
});
test('A-B-A cannot revive a prior web registration or its cleanup', async t => {
  const page = await open(t, 'web');
  await page.evaluate(() => h.subscribe());
  await page.waitForFunction(() => h.requests.length === 1);
  await page.evaluate(() => { h.render('user-b'); h.render('user-a'); h.requests[0].reject(new Error('old visit')); });
  await page.waitForFunction(() => h.requests.length === 2);
  await page.evaluate(() => h.resolveRequest(1));
  await page.getByText('Ready', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => h.unsubscribes), 0);
  assert.equal(await page.evaluate(() => h.requests[0].args[2]?.signal.aborted), true);
});
test('unmount cancels native and web device requests without late local cleanup', async t => {
  for (const mode of ['native', 'web']) {
    const page = await open(t, mode);
    await page.evaluate(mode => mode==='native'?h.emit('token-a-synthetic'):h.subscribe(), mode);
    await page.waitForFunction(() => h.requests.length === 1);
    await page.evaluate(() => { h.unmount(); h.remember('new-binding'); h.resolveRequest(0); });
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
    assert.equal(await page.evaluate(() => h.requests[0].args[2]?.signal.aborted), true);
    assert.equal(await page.evaluate(() => h.unsubscribes), 0);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('vimob-current-push-endpoint')), 'new-binding');
  }
});
test('current native and web gestures still register and deactivate explicitly', async t => {
  const native = await open(t);
  await native.evaluate(() => { h.emit('token-a-synthetic'); h.resolveRequest(0); });
  await native.waitForFunction(() => sessionStorage.getItem('vimob-current-push-endpoint') === 'native:android:token-a-synthetic');
  await native.evaluate(() => { h.operation=h.value.deactivateToken();h.resolveRequest(1); });
  await native.evaluate(() => h.operation);
  assert.equal(await native.evaluate(() => sessionStorage.getItem('vimob-current-push-endpoint')), null);
  const web = await open(t, 'web');
  await web.evaluate(() => h.subscribe());
  await web.waitForFunction(() => h.requests.length === 1);
  await web.evaluate(() => h.resolveRequest(0));
  await web.waitForFunction(() => h.value.isSubscribed);
  await web.evaluate(() => h.unsubscribe());
  await web.waitForFunction(() => h.requests.length === 2);
  await web.evaluate(() => h.resolveRequest(1));
  await web.waitForFunction(() => h.value.isOptedOut && !h.value.isLoading);
  assert.equal(await web.evaluate(() => h.unsubscribes), 1);
});
test('the logout gesture generation aborts A-B-A before the deferred browser mirror can mutate', async t => {
  const page = await open(t, 'logout');
  await page.evaluate(() => { h.subscription=h.makeSubscription();h.remember(h.subscription.endpoint);h.mirror=true;h.beginLogout(); });
  await page.waitForFunction(() => Boolean(h.mirrorResolve));
  await page.evaluate(() => { h.render('user-b');h.render('user-a');h.remember(h.subscription.endpoint);h.mirrorResolve(); });
  // A stale helper must complete without waiting for a server mutation.
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
  assert.equal(await page.evaluate(() => h.logoutIntent.signal.aborted), true);
  assert.equal(await page.evaluate(() => h.requests.length), 0);
  assert.equal(await page.evaluate(() => h.unsubscribes), 0);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('vimob-current-push-endpoint')), 'https://push.example.test/device');
});
test('a current actor moving between two organizations cannot reuse the previous device gesture', async t => {
  for (const mode of ['native', 'web']) {
    await t.test(mode, async subcase => {
    const page = await open(subcase, mode);
    await page.evaluate(mode => mode==='native'?h.emit('token-org-a'):h.subscribe(), mode);
    await page.waitForFunction(() => h.requests.length === 1);
    await page.evaluate(mode => h.render('user-a', mode, 'org-b'), mode);
    if (mode === 'native') {
      await page.waitForFunction(() => h.registrations === 2);
      await page.evaluate(() => { h.emit('token-org-b');h.resolveRequest(1);h.resolveRequest(0); });
      await page.waitForFunction(() => sessionStorage.getItem('vimob-current-push-endpoint') === 'native:android:token-org-b');
    } else {
      await page.evaluate(() => { h.remember(h.subscription.endpoint);h.requests[0].reject(new Error('prior organization')); });
      await page.waitForFunction(() => h.requests.length === 2);
      await page.evaluate(() => h.resolveRequest(1));
      await page.getByText('Ready', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => h.unsubscribes), 0);
    }
    assert.equal(await page.evaluate(() => h.requests[0].args[1]), 'org-a');
    assert.equal(await page.evaluate(() => h.requests[0].args[2]?.signal.aborted), true);
    assert.equal(await page.evaluate(() => h.requests[1].args[1]), 'org-b');
    assert.equal(await page.evaluate(() => h.requests[1].args[2]?.expectedUserId), 'user-a');
    });
  }
});

test('same actor new SID cancels native registration and preserves the fresh session binding', async t => {
  const page = await open(t);
  await page.evaluate(() => h.emit('old-session-token'));
  await page.waitForFunction(() => h.requests.length === 1);
  await page.evaluate(() => h.render('user-a', 'native', 'org-a', 'session-two'));
  await page.waitForFunction(() => h.registrations === 2);
  await page.evaluate(() => { h.emit('new-session-token'); h.resolveRequest(1); });
  await page.waitForFunction(() => sessionStorage.getItem('vimob-current-push-endpoint') === 'native:android:new-session-token');
  await page.evaluate(() => h.resolveRequest(0));
  assert.equal(await page.evaluate(() => h.requests[0].args[2].signal.aborted), true);
  assert.equal(await page.evaluate(() => h.requests[0].args[2].expectedSessionId), 'session-user-a');
  assert.equal(await page.evaluate(() => h.requests[1].args[2].expectedSessionId), 'session-two');
  assert.equal(await page.evaluate(() => sessionStorage.getItem('vimob-current-push-endpoint')), 'native:android:new-session-token');
});

test('same actor new SID rejects a removed native action listener before navigation', async t => {
  const page = await open(t);
  await page.evaluate(() => { h.oldAction=h.listeners.find(item=>item.event==='pushNotificationActionPerformed').callback; h.render('user-a','native','org-a','session-two'); });
  await page.waitForFunction(() => h.registrations === 2);
  await page.evaluate(() => h.oldAction({notification:{data:{url:'/conversations'}}}));
  assert.deepEqual(await page.evaluate(() => h.routes), []);
});

test('same actor new SID cancels web save without removing the fresh binding', async t => {
  const page = await open(t, 'web');
  await page.evaluate(() => h.subscribe());
  await page.waitForFunction(() => h.requests.length === 1);
  await page.evaluate(() => { h.render('user-a','web','org-a','session-two'); h.remember(h.subscription.endpoint); h.requests[0].reject(new Error('old session')); });
  await page.waitForFunction(() => h.requests.length === 2);
  await page.evaluate(() => h.resolveRequest(1));
  await page.getByText('Ready', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => h.requests[0].args[2].signal.aborted), true);
  assert.equal(await page.evaluate(() => h.requests[1].args[2].expectedSessionId), 'session-two');
  assert.equal(await page.evaluate(() => h.unsubscribes), 0);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('vimob-current-push-endpoint')), 'https://push.example.test/device');
});

test('same SID refresh preserves a pending native or web registration', async t => {
  for (const mode of ['native', 'web']) await t.test(mode, async subcase => {
    const page = await open(subcase, mode);
    await page.evaluate(mode => mode==='native'?h.emit('same-session-token'):h.subscribe(), mode);
    await page.waitForFunction(() => h.requests.length === 1);
    await page.evaluate(mode => h.render('user-a',mode,'org-a','session-user-a'), mode);
    assert.equal(await page.evaluate(() => h.requests[0].args[2].signal.aborted), false);
    await page.evaluate(() => h.resolveRequest(0));
    await page.waitForFunction(() => Boolean(sessionStorage.getItem('vimob-current-push-endpoint')));
    assert.equal(await page.evaluate(() => h.requests.length), 1);
    if (mode === 'native') assert.equal(await page.evaluate(() => h.registrations), 1);
  });
});

test('same actor new SID cancels logout while the browser mirror is pending', async t => {
  const page = await open(t, 'logout');
  await page.evaluate(() => { h.subscription=h.makeSubscription(); h.remember(h.subscription.endpoint); h.mirror=true; h.beginLogout(); });
  await page.waitForFunction(() => Boolean(h.mirrorResolve));
  await page.evaluate(() => { h.render('user-a','logout','org-a','session-two'); h.remember('fresh-session-binding'); h.mirrorResolve(); });
  await page.evaluate(() => h.operation);
  assert.equal(await page.evaluate(() => h.logoutIntent.signal.aborted), true);
  assert.equal(await page.evaluate(() => h.requests.length), 0);
  assert.equal(await page.evaluate(() => h.unsubscribes), 0);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('vimob-current-push-endpoint')), 'fresh-session-binding');
});

test('an explicit web registration in B overrides an old organization-A optout for this account device', async t => {
  const page = await open(t, 'web');
  await page.evaluate(() => {
    localStorage.setItem('vimob-web-push-opt-out:user-a:org-a','1');
    h.render('user-a','web','org-b');
  });
  await page.getByText('Ready', { exact: true }).waitFor();
  await page.evaluate(() => h.subscribe());
  await page.waitForFunction(() => h.requests.length === 1);
  await page.evaluate(() => h.resolveRequest(0));
  await page.waitForFunction(() => h.value.isSubscribed && !h.value.isLoading);
  await page.evaluate(() => h.render('user-a','web','org-a'));
  await page.waitForFunction(() => h.requests.length === 2);
  assert.equal(await page.evaluate(() => h.requests[1].kind), 'save');
  assert.equal(await page.evaluate(() => h.requests[1].args[1]), 'org-a');
  await page.evaluate(() => h.resolveRequest(1));
  await page.getByText('Ready', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => h.value.isOptedOut), false);
  assert.equal(await page.evaluate(() => h.unsubscribes), 0);
  assert.equal(await page.evaluate(() => localStorage.getItem('vimob-web-push-opt-out:account:user-a')), '0');
});
