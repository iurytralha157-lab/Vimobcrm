import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const source=ts.createSourceFile('FloatingChat.tsx',readFileSync(new URL('./FloatingChat.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
const declarations=new Map();
function visit(node){if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&['audioContextKey','latestReply','replyTarget'].includes(node.name.text))declarations.set(node.name.text,node.getText(source));ts.forEachChild(node,visit);}
visit(source);assert.equal(declarations.size,3);
const body=ts.transpileModule([...declarations.values()].map(value=>`const ${value};`).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const actions={};Function('exports',ts.transpileModule(readFileSync(new URL('../whatsapp/conversations/message-actions.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(actions);
const id='70000000-0000-4000-8000-000000000001';
const row={id,conversation_id:'chat-A',session_id:'session-A',content:'Sintético',message_type:'text',status:'received',can_quote:true,metadata:{}};
function frame(overrides={}){
  const dependencies={activeTenantKey:'actor-A:org-A',whatsappQueryScope:{accessScope:'grant-A'},activeConversationId:'chat-A',
    activeConversationMessageScope:{expectedLeadId:'lead-A'},whatsappMessageInputState:{sendSessionId:'session-A'},audioDisabled:false,
    intentTenantKey:'actor-A:org-A',intentGeneration:1,chatVisible:true,replySelection:null,visibleMessages:[row],
    canQuoteWhatsAppMessage:actions.canQuoteWhatsAppMessage,...overrides};
  return Function(...Object.keys(dependencies),`${body};return{audioContextKey,replyTarget};`)(...Object.values(dependencies));
}
test('actual floating frame changes when close/reopen advances intent despite the same physical conversation',()=>{
  assert.notEqual(frame().audioContextKey,frame({intentGeneration:3}).audioContextKey);
  assert.notEqual(frame().audioContextKey,frame({chatVisible:false}).audioContextKey);
});
test('actual floating reply uses the current canonical row instead of its previously selected object',()=>{
  const selected={contextKey:frame().audioContextKey,message:{...row,content:'Anterior'}};
  const current={...row,content:'Atual'};assert.equal(frame({replySelection:selected,visibleMessages:[current]}).replyTarget,current);
});
for(const [name,overrides] of [
  ['capability revoked',{visibleMessages:[{...row,can_quote:false}]}],
  ['physical route replaced',{visibleMessages:[{...row,conversation_id:'chat-B'}]}],
  ['session replaced',{visibleMessages:[{...row,session_id:'session-B'}]}],
  ['original row removed',{visibleMessages:[]}],
  ['failed local row',{visibleMessages:[{...row,metadata:{local_delivery_state:'failed'}}]}],
]) test(`actual floating reply disappears after ${name}`,()=>{
  assert.equal(frame({...overrides,replySelection:{contextKey:frame().audioContextKey,message:row}}).replyTarget,null);
});
