import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import { chromium } from '@playwright/test';
import ts from 'typescript';
import { buildReactBrowserHarness } from '../whatsapp-react-browser-test-harness.mjs';

// Real provider, hook, policy, audio engine, coordinator, QueryClient and Radix.
// AuthContext and query fixtures are synthetic. The final scenarios also run
// useNotifications itself, substituting only notificationsAPI.list transport.
const repository = process.cwd(), require = createRequire(import.meta.url), modules = {};
const origin = 'https://new-lead-sound-fixture.invalid', now = 1_800_000_000_000;
modules.auth = 'exports.useAuth=()=>window.h.auth;';
modules.api = 'exports.notificationsAPI={list:(params,intent)=>window.h.apiList(params,intent)};';
modules.notifications = `const {useInfiniteQuery}=require(${JSON.stringify(load('@tanstack/react-query'))});
exports.useNotifications=()=>{const a=window.h.auth;return useInfiniteQuery({
queryKey:['notifications',a.profile.id,a.activeOrganization.organizationId,25,false,[]],initialPageParam:null,
queryFn:async()=>{window.h.requests++;return{notifications:window.h.initialRows,nextCursor:null};},
getNextPageParam:page=>page.nextCursor||undefined,staleTime:Infinity,gcTime:Infinity});};`;
function load(name, parent = repository) {
  if (['react', 'react-dom', 'react-dom/client', 'scheduler'].includes(name)) return name;
  if (name === '@/contexts/AuthContext') return 'auth';
  if (name === '@/hooks/use-notifications') return 'notifications';
  if (name === '@/lib/api/notifications') return 'api';
  let file;
  if (name.startsWith('@/')) {
    const base = join(repository, name.slice(2));
    file = ['', '.ts', '.tsx', '.js', '/index.ts', '/index.tsx'].map(suffix => base + suffix)
      .find(candidate => existsSync(candidate) && statSync(candidate).isFile());
    if (!file) throw Error(`Missing fixture module ${name}`);
  } else file = require.resolve(name, { paths: [parent] });
  if (modules[file]) return file;
  modules[file] = ' ';
  const source = readFileSync(file, 'utf8');
  const compiled = /\.tsx?$/.test(file) ? ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText : source;
  modules[file] = compiled.replace(/require\(["']([^"']+)["']\)/g,
    (_, dependency) => `require(${JSON.stringify(load(dependency, dirname(file)))})`);
  return file;
}
const provider = load('@/components/features/notifications/NotificationSoundProvider');
const controls = load('@/components/features/notifications/NotificationSoundControls');
const menu = load('@/components/ui/dropdown-menu');
const coordinator = load('@/lib/notifications/lead-sound-coordinator');
const query = load('@tanstack/react-query');
const realNotifications = load(join(repository, 'hooks/use-notifications.ts'));
modules.notifications += `const synthetic=exports.useNotifications,actual=require(${JSON.stringify(realNotifications)});
exports.useNotifications=(...args)=>window.h.realQueries?actual.useNotifications(...args):synthetic(...args);`;
const script = buildReactBrowserHarness({ repository, modules, entry: `
const {NotificationSoundProvider,useNotificationSound}=require(${JSON.stringify(provider)});
const {NotificationSoundControls}=require(${JSON.stringify(controls)});
const {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent}=require(${JSON.stringify(menu)});
const {QueryClient,QueryClientProvider}=require(${JSON.stringify(query)});
const {claimNewLeadSound}=require(${JSON.stringify(coordinator)});
const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity,refetchOnWindowFocus:false}}});
const root=createRoot(document.getElementById('root')),options=window.initialFixture||{};
const h=window.h={now:${now},auth:{profile:{id:'user-a'},activeOrganization:{organizationId:'org-a'}},
 initialRows:options.rows||[],requests:0,starts:0,route:'pipeline',mounted:true,audioFail:options.audioFail,
 realQueries:options.realQueries===true,transport:[],apiRows:{},delayTransport:false,startedAt:performance.now(),
 audioHold:false,audioResolutions:[],contexts:[],sound:null,client,
 apiList(params,intent){const request={params,intent,elapsed:performance.now()-this.startedAt};this.transport.push(request);
   if(this.delayTransport)return new Promise(resolve=>{request.resolve=resolve;});
   return Promise.resolve({notifications:this.apiRows[intent.organizationId]||this.initialRows,nextCursor:null});},
 key(org=this.auth.activeOrganization.organizationId,user=this.auth.profile.id){return['notifications',user,org,25,false,[]];},
 page(rows,older=[],key=this.key()){this.now+=2100;client.setQueryData(key,{pages:[{notifications:rows,nextCursor:'older'},
   ...older.map(notifications=>({notifications,nextCursor:null}))],pageParams:[null,...older.map(()=> 'older')]});},
 render(patch={}){Object.assign(this,patch);flushSync(()=>root.render(React.createElement(QueryClientProvider,{client},
   this.mounted?React.createElement(NotificationSoundProvider,null,React.createElement(Surface,{route:this.route})):null)));},
 scope(org,user='user-a'){this.auth={profile:{id:user},activeOrganization:{organizationId:org}};this.render();},
 seedStorage(){return claimNewLeadSound({scope:'fixture',notificationId:'setup',now:this.now},()=>true);},
};
Date.now=()=>h.now;
if(options.muted!==undefined)localStorage.setItem('vimob:new-lead-sound:muted:v1:user-a',String(options.muted));
if(options.nativeAudio){
 const NativeAudioContext=window.AudioContext;
 window.AudioContext=class extends NativeAudioContext {
   constructor(){super();h.nativeAudio=this;const analyser=this.createAnalyser();analyser.fftSize=1024;analyser.connect(this.destination);this.probe=analyser;
     const waveform=new Float32Array(analyser.fftSize);h.peak=0;setInterval(()=>{analyser.getFloatTimeDomainData(waveform);for(const sample of waveform)h.peak=Math.max(h.peak,Math.abs(sample));},10);}
   createGain(){const gain=super.createGain(),connect=gain.connect.bind(gain);gain.connect=(target,...args)=>connect(target===this.destination?this.probe:target,...args);return gain;}
   createOscillator(){const oscillator=super.createOscillator(),start=oscillator.start.bind(oscillator);
     oscillator.start=(at)=>{h.firstNote??=at;return start(at);};return oscillator;}
 };
}else window.AudioContext=class {
 constructor(){this.state='suspended';this.currentTime=0;this.destination={};h.contexts.push(this);}
 async resume(){if(h.audioFail==='resume')throw Error('Blocked audio');
   if(h.audioHold)await new Promise(resolve=>h.audioResolutions.push(resolve));this.state='running';this.onstatechange?.();}
 createOscillator(){if(h.audioFail==='oscillator')throw Error('Device unavailable');return{frequency:{value:0},
   connect(){},disconnect(){},start(){h.starts++;},stop(){if(h.audioFail!=='completion')queueMicrotask(()=>this.onended?.());}};}
 createGain(){return{gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};}
};
function Surface({route}){const sound=useNotificationSound();React.useLayoutEffect(()=>{h.sound=sound;});
 return React.createElement(React.Fragment,null,React.createElement('div',{'data-route':route},route),
  React.createElement(DropdownMenu,null,
   React.createElement(DropdownMenuTrigger,{asChild:true},React.createElement('button',{'aria-label':'Abrir notificações'},'Avisos')),
   React.createElement(DropdownMenuContent,{'aria-label':'Notificações'},React.createElement(NotificationSoundControls,sound))));}
h.render();h.initialTransportCount=h.transport.length;
` });
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

function row(id, patch = {}) {
  return { id, user_id: 'user-a', organization_id: 'org-a', title: 'Lead sintético', content: null,
    type: 'lead', is_read: false, lead_id: `lead-${id}`, metadata: { event_key: 'new_lead_received' },
    created_at: new Date(now).toISOString(), ...patch };
}
async function open(t, options = {}, count = 1) {
  const context = await browser.newContext(), errors = [], pages = [];
  t.after(async () => { await context.close(); assert.deepEqual(errors, []); });
  for (let index = 0; index < count; index++) {
    const page = await context.newPage(); page.setDefaultTimeout(5000);
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.abort());
    await page.route(`${origin}/**`, route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }));
    await page.goto(origin); await page.evaluate(options => { window.initialFixture = options; }, options);
    await page.addScriptTag({ content: script }); await initialized(page); pages.push(page);
  }
  return pages;
}
async function initialized(page) {
  await page.waitForFunction(() => window.h?.sound && window.h.client.getQueryState(window.h.key())?.status === 'success');
}
async function unlock(page) {
  await page.keyboard.press('Shift'); await page.waitForFunction(() => window.h.sound.ready);
}
const starts = page => page.evaluate(() => window.h.starts);
async function total(pages) { return (await Promise.all(pages.map(starts))).reduce((sum, value) => sum + value, 0); }
async function sounded(pages, expected) {
  for (let index = 0; index < 150 && await total(pages) < expected; index++) await pages[0].waitForTimeout(20);
  assert.equal(await total(pages), expected);
}
async function publish(page, rows, older = []) {
  await page.evaluate(({ rows, older }) => window.h.page(rows, older), { rows, older });
}
async function openMenu(page) {
  await page.getByRole('button', { name: 'Abrir notificações' }).click(); await page.getByRole('menu').waitFor();
}
async function hint(page, reason, organizationId = 'org-a') {
  await page.evaluate(detail => window.dispatchEvent(new CustomEvent('vimob:lead-realtime-change', { detail })), { reason, organizationId });
}
async function holdWrites(page) {
  await page.evaluate(async () => {
    await window.h.seedStorage();
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('vimob-new-lead-sound-v1', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction(['claims', 'clocks'], 'readwrite'); let active = true;
        const keep = () => { const get = tx.objectStore('claims').get(['holder', 'holder']); get.onsuccess = () => { if (active) keep(); }; };
        window.h.releaseHold = () => { active = false; db.close(); }; keep(); resolve();
      };
    });
  });
}

test('the initial notification baseline stays silent before and after unlocking audio', async t => {
  const [page] = await open(t, { rows: [row('baseline')] });
  assert.equal(await starts(page), 0); await unlock(page);
  await publish(page, [row('baseline')]); assert.equal(await starts(page), 0);
  assert.equal(await page.evaluate(() => window.h.requests), 1);
});

test('only a new canonical event for the current recipient and organization plays', async t => {
  const [page] = await open(t); await unlock(page);
  await page.evaluate(row => {
    const key = window.h.key(); key[4] = true;
    window.h.client.setQueryData(key, { pages: [{ notifications: [row], nextCursor: null }], pageParams: [null] });
    const categorizedKey = window.h.key(); categorizedKey[5] = ['lead'];
    window.h.client.setQueryData(categorizedKey, { pages: [{ notifications: [row], nextCursor: null }], pageParams: [null] });
  }, row('filtered-query'));
  assert.equal(await starts(page), 0);
  const ignored = [row('foreign-org', { organization_id: 'org-b' }), row('foreign-user', { user_id: 'user-b' }),
    row('wrong-event', { metadata: { event_key: 'lead_assigned' } }), row('no-meta', { metadata: null }),
    row('read', { is_read: true }), row('no-lead', { lead_id: null }),
    row('old', { created_at: new Date(now - 120_000).toISOString() })];
  await publish(page, ignored); assert.equal(await starts(page), 0);
  await publish(page, [row('accepted'), ...ignored]); await sounded([page], 2);
});

test('minute reconciliation remains eligible while arrivals older than ninety seconds stay silent', async t => {
  const [page] = await open(t); await unlock(page);
  const delayed = row('minute-late', { created_at: new Date(now + 1000).toISOString() });
  await page.evaluate(value => { window.h.now = value; }, now + 61_000);
  await publish(page, [delayed]); await sounded([page], 2);
  await page.evaluate(value => { window.h.now = value; }, now + 92_000);
  await publish(page, [row('too-late', { created_at: delayed.created_at }), delayed]);
  assert.equal(await starts(page), 2);
});

test('two tabs receiving the same cache arrival produce one sound, then replay and pagination stay quiet', async t => {
  const pages = await open(t, {}, 2); await Promise.all(pages.map(unlock));
  await Promise.all(pages.map(page => publish(page, [row('shared')]))); await sounded(pages, 2);
  await Promise.all(pages.map(page => publish(page, [row('shared', { is_read: true })], [[row('older-page')]])));
  await Promise.all(pages.map(page => publish(page, [row('shared')])));
  await pages[0].waitForTimeout(100); assert.equal(await total(pages), 2);
});

test('mute synchronizes tabs, survives reload, and a manual test does not unmute', async t => {
  const pages = await open(t, {}, 2); await Promise.all(pages.map(unlock));
  await openMenu(pages[0]); await pages[0].getByRole('menuitem', { name: 'Silenciar som de novos leads' }).click();
  await pages[1].waitForFunction(() => window.h.sound.muted);
  await Promise.all(pages.map(page => publish(page, [row('muted-arrival')]))); assert.equal(await total(pages), 0);
  await pages[1].reload(); await pages[1].addScriptTag({ content: script }); await initialized(pages[1]);
  assert.equal(await pages[1].evaluate(() => window.h.sound.muted), true);
  await openMenu(pages[1]); await pages[1].getByRole('menuitem', { name: 'Testar som' }).click();
  await pages[1].getByRole('status').filter({ hasText: 'Som reproduzido.' }).waitFor();
  assert.equal(await pages[1].evaluate(() => window.h.sound.muted), true); assert.equal(await total(pages), 2);
  await publish(pages[1], [row('still-muted')]); assert.equal(await total(pages), 2);
});

test('enabling audio never replays arrivals observed while muted', async t => {
  const [page] = await open(t, { muted: true }); await publish(page, [row('observed-muted')]);
  await openMenu(page); await page.getByRole('menuitem', { name: 'Ativar som de novos leads' }).click();
  await page.waitForFunction(() => window.h.sound.ready && !window.h.sound.muted);
  await publish(page, [row('observed-muted')]); assert.equal(await starts(page), 0);
  await publish(page, [row('after-enable'), row('observed-muted')]); await sounded([page], 2);
});

test('audio rejection and device errors leave the test control usable and allow recovery', async t => {
  const [page] = await open(t, { audioFail: 'resume' }); await openMenu(page);
  const button = page.getByRole('menuitem', { name: 'Testar som' }); await button.click();
  await page.getByRole('status').filter({ hasText: 'Não foi possível reproduzir' }).waitFor();
  assert.equal(await button.isDisabled(), false); assert.equal(await starts(page), 0);
  await publish(page, [row('blocked-audio')]); assert.equal(await starts(page), 0);
  await page.evaluate(() => { window.h.audioFail = 'oscillator'; }); await button.click();
  assert.equal(await button.isDisabled(), false); assert.equal(await starts(page), 0);
  await page.evaluate(() => { window.h.audioFail = undefined; }); await button.click();
  await page.getByRole('status').filter({ hasText: 'Som reproduzido.' }).waitFor(); await sounded([page], 2);
  await publish(page, [row('recovered')]); await sounded([page], 4);
});

test('Chromium renders an audible-level PCM signal before confirming the manual tone and for a new lead', async t => {
  const [page] = await open(t, { nativeAudio: true });
  await openMenu(page);
  await page.evaluate(() => {
    const status = document.querySelector('[role="status"]');
    new MutationObserver((_, observer) => {
      if (!status.textContent.includes('Som reproduzido.')) return;
      window.h.confirmedAfter = window.h.nativeAudio.currentTime - window.h.firstNote;
      observer.disconnect();
    }).observe(status, { childList: true, characterData: true, subtree: true });
  });
  await page.getByRole('menuitem', { name: 'Testar som' }).click();
  await page.getByRole('status').filter({ hasText: 'Som reproduzido.' }).waitFor();
  assert.ok(await page.evaluate(() => window.h.confirmedAfter) >= .35, 'wait for the native tone before confirming');
  assert.ok(await page.evaluate(() => window.h.peak) > .12, 'the manual tone reaches the Chromium output graph');
  await page.evaluate(() => { window.h.peak = 0; });
  await publish(page, [row('native-signal')]);
  await page.waitForFunction(() => window.h.peak > .12);
});

test('a started tone that never completes does not report success or trap the test control', async t => {
  const [page] = await open(t, { audioFail: 'completion' });
  await openMenu(page);
  const button = page.getByRole('menuitem', { name: 'Testar som' });
  await button.click();
  await sounded([page], 2);
  await page.getByRole('status').filter({ hasText: 'Não foi possível reproduzir' }).waitFor();
  assert.equal(await button.isDisabled(), false);
  await page.evaluate(() => { window.h.audioFail = undefined; });
  await button.click();
  await page.getByRole('status').filter({ hasText: 'Som reproduzido.' }).waitFor();
  await sounded([page], 4);
});

test('scope replacement and unmount fence queued sound claims and obsolete callbacks', async t => {
  const [page] = await open(t); await unlock(page); await holdWrites(page);
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction; window.h.transactions = 0;
    IDBDatabase.prototype.transaction = function (...args) { window.h.transactions++; return original.apply(this, args); };
    window.h.savedMute = window.h.sound.onMutedChange; window.h.savedTest = window.h.sound.onTest;
  });
  await publish(page, [row('queued-old-scope')]); await page.waitForFunction(() => window.h.transactions > 0);
  await page.evaluate(() => { window.h.scope('org-b'); window.h.savedMute(true); window.h.releaseHold(); }); await initialized(page);
  assert.equal(await page.evaluate(() => window.h.savedTest()), false);
  await page.waitForTimeout(100); assert.equal(await starts(page), 0); assert.equal(await page.evaluate(() => window.h.sound.muted), false);
  await page.evaluate(() => { window.h.scope('org-a'); }); await initialized(page);
  await publish(page, [row('current-scope'), row('queued-old-scope')]); await sounded([page], 2);
  await page.evaluate(() => { window.h.savedTest = window.h.sound.onTest; window.h.savedMute = window.h.sound.onMutedChange; window.h.render({ mounted: false }); });
  assert.equal(await page.evaluate(() => window.h.savedTest()), false);
  await page.evaluate(() => window.h.savedMute(true)); assert.equal(await starts(page), 2);
  assert.equal(await page.evaluate(() => localStorage.getItem('vimob:new-lead-sound:muted:v1:user-a')), null);
});

test('a pending manual activation cannot sound after the user changes organization', async t => {
  const [page] = await open(t);
  await page.evaluate(() => { window.h.audioHold = true; window.h.pendingTest = window.h.sound.onTest(); });
  await page.waitForFunction(() => window.h.audioResolutions.length > 0);
  await page.evaluate(() => { window.h.scope('org-b'); window.h.audioHold = false; window.h.audioResolutions.splice(0).forEach(resolve => resolve()); });
  assert.equal(await page.evaluate(() => window.h.pendingTest), false); assert.equal(await starts(page), 0);
});

test('navigation changes children without resetting the provider baseline or query', async t => {
  const [page] = await open(t); await unlock(page);
  await publish(page, [row('before-navigation')]); await sounded([page], 2);
  await page.evaluate(() => window.h.render({ route: 'contacts' }));
  await publish(page, [row('after-navigation'), row('before-navigation')]); await sounded([page], 4);
  assert.equal(await page.evaluate(() => window.h.requests), 1);
  assert.equal(await page.locator('[data-route]').textContent(), 'contacts');
});

test('keyboard mute and test actions retain the real Radix menu and focus', async t => {
  const [page] = await open(t);
  await page.getByRole('button', { name: 'Abrir notificações' }).focus(); await page.keyboard.press('Enter');
  await page.getByRole('menu').waitFor(); await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.h.sound.muted); assert.equal(await page.getByRole('menu').isVisible(), true);
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Testar som');
  await page.keyboard.press('Space'); await page.getByRole('status').filter({ hasText: 'Som reproduzido.' }).waitFor();
  assert.equal(await page.getByRole('menu').isVisible(), true); assert.equal(await page.evaluate(() => window.h.sound.muted), true);
  assert.equal(await starts(page), 2);
});

test('real notifications hook delays its silent baseline, then scoped hints refetch with the actual transport intent', async t => {
  const baseline = row('real-baseline'), fresh = row('real-hint');
  const [page] = await open(t, { realQueries: true, rows: [baseline] });
  assert.equal(await page.evaluate(() => window.h.initialTransportCount), 0);
  assert.ok(await page.evaluate(() => window.h.transport[0].elapsed >= 2450));
  assert.equal(await starts(page), 0); await unlock(page); assert.equal(await starts(page), 0);
  assert.deepEqual(await page.evaluate(() => {
    const { params, intent } = window.h.transport[0];
    return { params: { userId: params.userId, limit: params.limit, cursor: params.cursor },
      user: intent.expectedUserId, org: intent.organizationId, signal: intent.signal instanceof AbortSignal };
  }), { params: { userId: 'user-a', limit: 25, cursor: null }, user: 'user-a', org: 'org-a', signal: true });
  await hint(page, 'lead.assigned', 'org-b'); await hint(page, 'lead.note_updated');
  await page.waitForTimeout(600); assert.equal(await page.evaluate(() => window.h.transport.length), 1);
  await page.evaluate(rows => {
    window.h.apiRows['org-a'] = rows; window.h.now += 2100;
    for (const reason of ['lead.meta_webhook_received', 'lead.assigned']) {
      window.dispatchEvent(new CustomEvent('vimob:lead-realtime-change', { detail: { organizationId: 'org-a', reason } }));
    }
  }, [fresh, baseline]);
  await page.waitForFunction(() => window.h.transport.length === 2); await sounded([page], 2);
  await page.evaluate(rows => { window.h.apiRows['org-a'] = rows; window.h.now += 2100; },
    [row('generic-only', { metadata: { event_key: 'lead_updated' } }), fresh, baseline]);
  await hint(page, 'lead.updated'); await page.waitForFunction(() => window.h.transport.length === 3);
  assert.equal(await starts(page), 2, 'a managed-queue hint alone never authorizes sound');
  await page.evaluate(rows => { window.h.apiRows['org-a'] = rows; window.h.now += 2100; }, [row('managed-arrival'), fresh, baseline]);
  await hint(page, 'lead.updated'); await page.waitForFunction(() => window.h.transport.length === 4); await sounded([page], 4);
  assert.deepEqual(await page.evaluate(() => window.h.transport.map(request => [request.intent.organizationId, request.intent.expectedUserId])),
    Array.from({ length: 4 }, () => ['org-a', 'user-a']));
});

test('the real query aborts a pending refetch on organization change and ignores its late response', async t => {
  const [page] = await open(t, { realQueries: true }); await unlock(page);
  await page.evaluate(() => { window.h.delayTransport = true; }); await hint(page, 'lead.assigned');
  await page.waitForFunction(() => window.h.transport.length === 2);
  await page.evaluate(() => window.h.scope('org-b'));
  await page.waitForFunction(() => window.h.transport[1].intent.signal.aborted);
  await page.evaluate(row => {
    window.h.delayTransport = false;
    window.h.transport[1].resolve({ notifications: [row], nextCursor: null });
  }, row('late-old-org'));
  await initialized(page); assert.equal(await starts(page), 0);
  assert.deepEqual(await page.evaluate(() => window.h.transport.map(request => request.intent.organizationId)), ['org-a', 'org-a', 'org-b']);
  await page.evaluate(row => { window.h.apiRows['org-b'] = [row]; window.h.now += 2100; }, row('new-org', { organization_id: 'org-b' }));
  await hint(page, 'lead.assigned', 'org-b'); await page.waitForFunction(() => window.h.transport.length === 4); await sounded([page], 2);
  assert.equal(await page.evaluate(() => window.h.transport[3].intent.organizationId), 'org-b');
});
