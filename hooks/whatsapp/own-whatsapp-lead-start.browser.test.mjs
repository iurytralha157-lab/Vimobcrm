import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildReactBrowserHarness, transpileBrowserTestModule } from '../whatsapp-react-browser-test-harness.mjs';

const require = createRequire(import.meta.url), { chromium } = require('playwright');
const modules = {
  '@/hooks/whatsapp/use-own-whatsapp-lead-start': transpileBrowserTestModule(join(process.cwd(), 'hooks/whatsapp/use-own-whatsapp-lead-start.ts')),
  '@/lib/whatsapp-own-start': transpileBrowserTestModule(join(process.cwd(), 'lib/whatsapp-own-start.ts')),
  '@/lib/whatsapp-message-input': transpileBrowserTestModule(join(process.cwd(), 'lib/whatsapp-message-input.ts')),
  '@/lib/phone-utils': transpileBrowserTestModule(join(process.cwd(), 'lib/phone-utils.ts')),
  '@/lib/whatsapp-request-intent': transpileBrowserTestModule(join(process.cwd(), 'lib/whatsapp-request-intent.ts')),
  '@/lib/api/vimob-error': `class VimobAPIError extends Error {constructor(message, data={}){super(message); Object.assign(this,data);}} exports.VimobAPIError=VimobAPIError;`,
  '@/lib/api/leads': `exports.leadsAPI={getLead:(...args)=>window.api.getLead(...args)};`,
  '@/lib/api/whatsapp': `exports.whatsappAPI=new Proxy({}, {get:(_,key)=>(...args)=>window.api[key](...args)});`,
  '@/hooks/use-start-conversation': `exports.getWhatsAppStartErrorMessage=error=>error.message;`,
  '@/lib/whatsapp-phone-change': `exports.getWhatsAppPhoneChangeConfirmation=e=>e.code==='whatsapp_phone_change_confirmation_required'?e.responseData:null;`,
  '@/lib/whatsapp-query-cache': `exports.whatsappQueryKeys={conversationsScope:scope=>['conversations',scope.userId,scope.organizationId]};`,
  '@tanstack/react-query': `exports.useQueryClient=()=>({invalidateQueries:value=>window.events.push({kind:'invalidate',...value})});`,
};
const entry = `
  const {useOwnWhatsAppLeadStart}=require('@/hooks/whatsapp/use-own-whatsapp-lead-start');
  const {VimobAPIError}=require('@/lib/api/vimob-error');
  const root=createRoot(document.getElementById('root'));
  const own={id:'own-a',owner_user_id:'user-a',organization_id:'org-a',status:'connected',provider:'evolution_go',is_active:true,can_send:true};
  const route={id:'new-route',session_id:'own-a',lead_id:'lead-a',lead:{id:'lead-a'},contact_phone:'+5511888888888'};
  let options, config={}, gate;
  function App(){window.start=useOwnWhatsAppLeadStart(options);return null;}
  window.render=patch=>{options={...options,...patch};flushSync(()=>root.render(React.createElement(App)));};
  window.setup=(scenario={})=>{
    config=scenario;window.events=[];window.ready=[];window.gate=null;
    options={scope:{userId:'user-a',organizationId:'org-a',accessScope:'scope-a'},selectionKey:'A',
      conversation:{id:'old-route',session_id:'other',lead_id:'lead-a',contact_phone:'+5511777777777'},
      sessions:[own],canOperate:true,loadingSessions:false,onReady:row=>window.ready.push(row)};
    window.api={
      getLead:async(id,org,signal,intent)=>{window.events.push({kind:'lead',id,org,actor:intent.expectedUserId});
        if(config.deferLead) await new Promise(resolve=>{window.gate=resolve});
        return {data:{id:config.wrongLead?'lead-b':id,organization_id:config.wrongOrg?'org-b':org,name:'Lead teste',phone:config.changedPhone?'+5511666666666':'+5511888888888'}};},
      getSession:async(id,org,intent)=>{window.events.push({kind:'session',id,org,actor:intent.expectedUserId});return {...own,id,...config.session};},
      findConversation:async(query,intent)=>{window.events.push({kind:'find',query,actor:intent.expectedUserId});
        if(config.exact && query.leadId) return {...route,session_id:query.sessionId};
        if(config.unlinked && !query.leadId) return {...route,lead_id:null,lead:null};
        if(config.otherLead && !query.leadId) return {...route,lead_id:'lead-b'};
        return null;},
      startConversation:async(input,org,intent)=>{window.events.push({kind:'start-intent',input,org,actor:intent.expectedUserId});
        if(config.tokenWait) await new Promise(resolve=>{window.gate=resolve});
        if(intent.signal.aborted) throw Error('context aborted');
        intent.onRequestStart();window.events.push({kind:'start-http',input});
        if(config.httpWait) await new Promise(resolve=>{window.gate=resolve});
        if(config.serverOwnerChanged && input.ownSessionOnly) throw Error('owner revoked');
        if(config.phone && !input.confirmPhoneChange) throw new VimobAPIError('confirm phone',{code:'whatsapp_phone_change_confirmation_required',responseData:{
          conversationId:'prior-route',leadId:'lead-a',sessionId:'own-a',...(config.destinationHistory?{requiresDestinationHistoryConfirmation:true,destinationConversationId:'destination'}:{})}});
        if(config.unlinked && !window.events.some(e=>e.kind==='link-http')) throw new VimobAPIError('confirm link',{code:'whatsapp_history_link_required'});
        return {...route,session_id:input.sessionId};},
      getConversationLinkPreview:async(id,expected,lead,org,intent)=>{window.events.push({kind:'preview',id,expected,lead,org,actor:intent.expectedUserId});
        return {conversationId:id,sessionId:config.badPreview?'other':'own-a',leadId:lead,expectedPreviousLeadId:expected,bindingMode:'active',eligibleMessageCount:2};},
      linkConversationToLead:async(id,lead,expected,org,intent,ownOnly)=>{if(intent.signal.aborted)throw Error('aborted');intent.onRequestStart();
        window.events.push({kind:'link-http',id,lead,expected,org,ownOnly,actor:intent.expectedUserId});return {bindingMode:'active'};}
    };
    window.render();
  };
  window.setConfig=patch=>Object.assign(config,patch);
  window.unmount=()=>flushSync(()=>root.unmount());
`;

test('own account preparation in mounted React: identity, confirmations and cancellation', async t => {
  const browser = await chromium.launch({ headless: true });
  try {
    const run = async (scenario, action) => {
      const page = await browser.newPage(); const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => route.abort());
      await page.setContent('<div id="root"></div>');
      await page.addScriptTag({ content: buildReactBrowserHarness({ modules, entry }) });
      await page.evaluate(s => window.setup(s), scenario);
      try { await action(page); assert.deepEqual(errors, []); } finally { await page.close(); }
    };
    const begin = page => page.evaluate(() => window.start.begin());
    const settled = page => page.waitForFunction(() => !window.start.busy);
    const snapshot = page => page.evaluate(() => ({ events: window.events, ready: window.ready, error: window.start.error,
      pending: window.start.pending?.kind, notice: window.start.notice?.kind }));
    await t.test('existing own route uses fresh canonical phone and actor/organization intents', async () => run({ exact: true }, async page => {
      await begin(page); await page.waitForFunction(() => window.ready.length === 1);
      const s = await snapshot(page); assert.equal(s.events.filter(e => e.kind === 'start-http').length, 0);
      assert.equal(s.events.find(e => e.kind === 'find').query.phone, '+5511888888888');
      for (const e of s.events.filter(e => ['lead','session','find'].includes(e.kind))) assert.equal(e.actor, 'user-a');
      assert.equal(s.ready[0].session_id, 'own-a');
    }));
    await t.test('new route requires own-only and never sends or enters attendance automatically', async () => run({}, async page => {
      await begin(page); await page.waitForFunction(() => window.ready.length === 1);
      const s = await snapshot(page), request = s.events.find(e => e.kind === 'start-http').input;
      assert.equal(request.ownSessionOnly, true); assert.equal(request.expectedPreviousLeadId, 'unlinked');
      assert.equal(request.phone, '+5511888888888'); assert.equal(request.leadId, 'lead-a');
    }));
    await t.test('two own accounts exclude shared/forged selection and simultaneous double selection', async () => run({}, async page => {
      await page.evaluate(() => window.render({sessions:[...window.start.ownSessions,{...window.start.ownSessions[0],id:'own-b'},
        {...window.start.ownSessions[0],id:'shared',owner_user_id:'admin'}]}));
      await begin(page); assert.equal((await snapshot(page)).pending, 'select');
      await page.evaluate(() => window.start.chooseSession('shared'));
      assert.equal((await snapshot(page)).events.length, 0);
      await page.evaluate(() => {window.start.chooseSession('own-a');window.start.chooseSession('own-b');});
      await page.waitForFunction(() => window.ready.length === 1);
      assert.equal((await snapshot(page)).events.filter(e => e.kind === 'start-http').length, 1);
    }));
    await t.test('no own account and read-only permissions never prepare a route', async () => run({}, async page => {
      await page.evaluate(() => window.render({sessions:[]})); await begin(page);
      assert.equal((await snapshot(page)).notice, 'connect'); assert.equal((await snapshot(page)).events.length, 0);
      await page.evaluate(() => window.render({canOperate:false})); await begin(page);
      assert.equal((await snapshot(page)).notice, undefined); assert.equal((await snapshot(page)).events.length, 0);
    }));
    for (const scenario of [{ wrongLead:true },{wrongOrg:true},{session:{owner_user_id:'admin'}},{session:{status:'disconnected'}},
      {session:{is_active:false}},{session:{can_send:false}},{session:{provider:'evolution'}}]) {
      await t.test(`fresh lead/session rejects ${JSON.stringify(scenario)}`, async () => run(scenario, async page => {
        await begin(page); await settled(page); const s = await snapshot(page);
        assert.ok(s.error); assert.equal(s.ready.length, 0); assert.equal(s.events.filter(e => e.kind === 'start-http').length, 0);
      }));
    }
    await t.test('late lead GET after tenant A to B to A produces no lookup, preparation or history', async () => run({deferLead:true}, async page => {
      await begin(page); await page.waitForFunction(() => Boolean(window.gate));
      await page.evaluate(() => {window.render({scope:{userId:'user-b',organizationId:'org-b',accessScope:'scope-b'}});
        window.render({scope:{userId:'user-a',organizationId:'org-a',accessScope:'scope-a'}});window.gate();});
      await page.waitForTimeout(25); const s = await snapshot(page);
      assert.equal(s.ready.length, 0); assert.equal(s.events.filter(e => e.kind === 'find' || e.kind === 'start-http').length, 0);
    }));
    for (const mode of ['cancel','selection','unmount']) {
      await t.test(`cancel before HTTP while token waits: ${mode}`, async () => run({tokenWait:true}, async page => {
        await begin(page); await page.waitForFunction(() => Boolean(window.gate));
        await page.evaluate(mode => { if(mode==='cancel')window.start.cancel();else if(mode==='unmount')window.unmount();
          else {window.render({selectionKey:'B'});window.render({selectionKey:'A'});} window.gate(); },mode);
        await page.waitForTimeout(25); const s = await snapshot(page);
        assert.equal(s.events.filter(e => e.kind === 'start-http').length, 0); assert.equal(s.ready.length, 0);
      }));
    }
    await t.test('late response after HTTP never opens the obsolete route', async () => run({httpWait:true}, async page => {
      await begin(page); await page.waitForFunction(() => Boolean(window.gate));
      await page.evaluate(() => {window.render({selectionKey:'B'});window.gate();});
      await page.waitForTimeout(25); assert.equal((await snapshot(page)).ready.length, 0);
    }));
    await t.test('ownership transfer between session GET and start is rejected by own-only contract', async () => run({serverOwnerChanged:true}, async page => {
      await begin(page); await settled(page); const s=await snapshot(page);
      assert.equal(s.events.find(e=>e.kind==='start-http').input.ownSessionOnly,true);assert.equal(s.ready.length,0);assert.equal(s.error,'owner revoked');
    }));
    await t.test('phone correction remains pending until explicit confirmation, with fresh lead and session', async () => run({phone:true}, async page => {
      await begin(page); await page.waitForFunction(() => window.start.pending?.kind==='phone');
      assert.equal((await snapshot(page)).events.filter(e=>e.kind==='start-http').length,1);
      await page.evaluate(() => window.start.confirm());await page.waitForFunction(() => window.ready.length===1);
      const s=await snapshot(page), input=s.events.filter(e=>e.kind==='start-http').at(-1).input;
      assert.equal(input.confirmPhoneChange,true);assert.equal(input.expectedPreviousConversationId,'prior-route');
      assert.equal(s.events.filter(e=>e.kind==='lead').length,2);assert.equal(s.events.filter(e=>e.kind==='session').length,2);
    }));
    await t.test('new destination history needs matching preview and confirmed snapshot', async () => run({phone:true,destinationHistory:true}, async page => {
      await begin(page);await page.waitForFunction(() => Boolean(window.start.preview));
      assert.equal((await snapshot(page)).ready.length,0);await page.evaluate(() => window.start.confirm());
      await page.waitForFunction(() => window.ready.length===1);const input=(await snapshot(page)).events.filter(e=>e.kind==='start-http').at(-1).input;
      assert.equal(input.confirmDestinationHistory,true);assert.equal(input.expectedDestinationConversationId,'destination');
    }));
    await t.test('mismatched destination preview prevents both history link and phone correction', async () => run({phone:true,destinationHistory:true,badPreview:true}, async page => {
      await begin(page);await settled(page);await page.evaluate(() => window.start.confirm());
      const s=await snapshot(page);assert.ok(s.error);assert.equal(s.ready.length,0);
      assert.equal(s.events.filter(e=>e.kind==='start-http').length,1);assert.equal(s.events.filter(e=>e.kind==='link-http').length,0);
    }));
    await t.test('unlinked history is previewed, attached only after consent, then opened on same own route', async () => run({unlinked:true}, async page => {
      await begin(page);await page.waitForFunction(() => Boolean(window.start.preview));assert.equal((await snapshot(page)).pending,'link');
      assert.equal((await snapshot(page)).events.filter(e=>e.kind==='link-http').length,0);
      await page.evaluate(() => window.start.confirm());await page.waitForFunction(() => window.ready.length===1);
      const link=(await snapshot(page)).events.find(e=>e.kind==='link-http');assert.equal(link.id,'new-route');assert.equal(link.expected,'unlinked');assert.equal(link.ownOnly,true);
    }));
    await t.test('phone changed after preview cannot link a stale destination', async () => run({unlinked:true}, async page => {
      await begin(page);await page.waitForFunction(() => Boolean(window.start.preview));
      await page.evaluate(() => {window.setConfig({changedPhone:true});window.start.confirm();});await settled(page);
      const s=await snapshot(page);assert.ok(s.error);assert.equal(s.events.filter(e=>e.kind==='link-http').length,0);assert.equal(s.ready.length,0);
    }));
    await t.test('existing conversation for another lead is never rebound', async () => run({otherLead:true}, async page => {
      await begin(page);await settled(page);const s=await snapshot(page);assert.ok(s.error);assert.equal(s.events.filter(e=>e.kind==='start-http').length,0);
    }));
  } finally { await browser.close(); }
});
