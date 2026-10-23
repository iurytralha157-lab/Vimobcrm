import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const exports = {};
Function('exports', ts.transpileModule(readFileSync(new URL('./whatsapp-unread.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText)(exports);
const { canMarkWhatsAppConversationRead, getWhatsAppUnreadSnapshot } = exports;
const row = (index, overrides={}) => ({ id:`70000000-0000-4000-8000-${String(index).padStart(12,'0')}`,
  conversation_id:'chat-A', session_id:'session-A', lead_id:'lead-A', from_me:false,
  message_type:'text', status:'received', content:'Sintético', sent_at:`2026-10-12T12:00:00.${String(index).padStart(6,'0')}Z`, metadata:{}, ...overrides });
const options = overrides => ({ scopeKey:'actor:org:access:A', conversationId:'chat-A', unreadCount:2,
  lastMessageAt:'2026-10-12T12:00:00.000003Z', messages:[row(1),row(2),row(3)], enabled:true, atBottom:true, ...overrides });
for(const [name,overrides,visible] of [
  ['hidden document',{},false],['scrolled away',{atBottom:false},true],['permission revoked',{enabled:false},true],
  ['no conversation',{conversationId:null},true],['zero counter',{unreadCount:0},true],
  ['invalid DTO timestamp',{lastMessageAt:'invalid'},true],['missing incoming page',{messages:[]},true],
  ['newer DTO head absent from loaded history',{lastMessageAt:'2026-10-12T12:00:00.000004Z'},true],
  ['same millisecond but a later microsecond',{messages:[row(1),row(2)]},true],
  ['another physical chat',{messages:[row(1,{conversation_id:'chat-B'}),row(2,{conversation_id:'chat-B'}),row(3,{conversation_id:'chat-B'})]},true],
  ['only optimistic UUID rows',{messages:[row(1,{metadata:{local_delivery_state:'queued'}}),row(2,{metadata:{local_delivery_state:'queued'}}),row(3,{metadata:{local_delivery_state:'queued'}})]},true],
  ['only reaction or system events',{messages:[row(1,{message_type:'reaction'}),row(2,{message_type:'system'}),row(3,{message_type:'reaction'})]},true],
]) test(`read gate refuses ${name}`,()=>assert.equal(canMarkWhatsAppConversationRead(options(overrides),visible),false));
test('read gate accepts a visible authorized loaded tail and incoming rows',()=>{
  assert.equal(canMarkWhatsAppConversationRead(options(),true),true);
});
test('a canonical outgoing tail can prove head freshness without hiding earlier unread incoming rows',()=>{
  assert.equal(canMarkWhatsAppConversationRead(options({messages:[row(1),row(2),row(3,{from_me:true,status:'sent'})]}),true),true);
});
test('the marker survives a zero server count and starts again for incoming rows while away',()=>{
  let state=getWhatsAppUnreadSnapshot(null,options());assert.equal(state.firstUnreadMessageId,row(2).id);
  state=getWhatsAppUnreadSnapshot(state,options({unreadCount:0}));assert.equal(state.firstUnreadMessageId,row(2).id);
  state=getWhatsAppUnreadSnapshot(state,options({unreadCount:1,atBottom:false,messages:[row(1),row(2),row(3),row(4)]}));
  assert.equal(state.firstUnreadMessageId,row(4).id);assert.equal(state.unreadCount,1);
});
test('scope, card and authorization transitions never revive an old unread marker after ABA',()=>{
  const a=getWhatsAppUnreadSnapshot(null,options());
  const b=getWhatsAppUnreadSnapshot(a,options({scopeKey:'actor:org:access:B',unreadCount:0,messages:[]}));
  const returned=getWhatsAppUnreadSnapshot(b,options({unreadCount:0,messages:[]}));
  assert.equal(returned.firstUnreadMessageId,null);
  const revoked=getWhatsAppUnreadSnapshot(a,options({enabled:false}));assert.equal(revoked.firstUnreadMessageId,null);
});

const hookBody=ts.transpileModule(readFileSync(new URL('../hooks/use-whatsapp-unread.ts',import.meta.url),'utf8'),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
}).outputText;
function hookFixture() {
  const slots=[],layout=[],effects=[],listeners=new Map(),reads=[];let index=0,cleanups=[];
  const react={
    useRef(initial){const slot=index++;return slots[slot]??={current:initial};},
    useState(initial){const slot=index++;if(!slots[slot])slots[slot]={value:typeof initial==='function'?initial():initial};return[slots[slot].value,value=>{slots[slot].value=typeof value==='function'?value(slots[slot].value):value;}];},
    useLayoutEffect(fn,deps){const slot=index++;const old=slots[slot];if(!old||!deps||deps.some((value,i)=>value!==old.deps?.[i]))layout.push(()=>{old?.cleanup?.();slots[slot]={deps,cleanup:fn()};});},
    useEffect(fn){effects.push(fn);},
  };
  const surface={visibilityState:'visible',addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:(type,fn)=>{if(listeners.get(type)===fn)listeners.delete(type);}};
  const hookExports={};Function('exports','require','document','window',hookBody)(hookExports,
    name=>name==='react'?react:exports,surface,surface);
  const render=overrides=>{
    index=0;layout.length=0;effects.length=0;
    const value=hookExports.useWhatsAppUnread(options({onRead:()=>reads.push(overrides?.scopeKey||'A'),...overrides}));
    for(const fn of layout)fn();for(const cleanup of cleanups)cleanup?.();cleanups=effects.map(fn=>fn());
    return value;
  };
  return{render,reads,surface,listeners};
}
test('the real hook delays read while hidden, reads on visibility and throttles repeated focus',()=>{
  const f=hookFixture();f.surface.visibilityState='hidden';f.render();assert.deepEqual(f.reads,[]);
  f.surface.visibilityState='visible';f.listeners.get('visibilitychange')();assert.deepEqual(f.reads,['A']);
  f.listeners.get('focus')();f.render();assert.deepEqual(f.reads,['A']);
});
test('the real hook ignores old visibility listeners after a new owner or close',()=>{
  const f=hookFixture();f.surface.visibilityState='hidden';f.render();const old=f.listeners.get('visibilitychange');
  f.render({scopeKey:'B',enabled:false});f.surface.visibilityState='visible';old();assert.deepEqual(f.reads,[]);
});
test('the real hook never marks while reading previous rows and resumes at the visible fresh tail',()=>{
  const f=hookFixture();f.render({atBottom:false});assert.deepEqual(f.reads,[]);
  f.render({atBottom:true});assert.deepEqual(f.reads,['A']);
});
