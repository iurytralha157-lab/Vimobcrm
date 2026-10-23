import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { QueryClient, QueryObserver } from '@tanstack/query-core';
import { deferred, evaluateProduction, turn } from './lead-request-runtime-fixture.mjs';

function fixture() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const slots=[],observers=[],requests=[],replies=[];
  const auth={activeOrganization:{organizationId:'org-a'},user:{id:'actor-a'},session:{sid:'sid-a'}};
  let cursor=0,result;
  const changed=(previous,next)=>!previous||next.some((item,index)=>!Object.is(item,previous[index]));
  const deps={useAuth:()=>auth,useQueryClient:()=>client,getGlobalSignOutSessionId:session=>session.sid,
    useMemo:(build,dependencies)=>{const index=cursor++;if(changed(slots[index]?.dependencies,dependencies))slots[index]={dependencies,value:build()};return slots[index].value;},
    useEffect:(setup,dependencies)=>{const index=cursor++;if(changed(slots[index]?.dependencies,dependencies)){slots[index]?.cleanup?.();slots[index]={dependencies,cleanup:setup()};}},
    useQuery:options=>{const index=cursor++;let slot=slots[index];if(!slot){const observer=new QueryObserver(client,options);const unsubscribe=observer.subscribe(()=>{});slot=slots[index]={observer,unsubscribe};observers.push(slot);}else slot.observer.setOptions(options);return {...slot.observer.getCurrentResult(),refetch:()=>slot.observer.refetch()};},
    leadAttachmentsAPI:{access:async(lead,id,org,intent)=>{const reply=deferred();requests.push({lead,id,org,intent});replies.push(reply);return reply.promise;}},
  };
  const path='hooks/use-lead-attachments.ts';const ast=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true);
  const source=ast.statements.filter(node=>!ts.isImportDeclaration(node)&&!ts.isExportDeclaration(node)).map(node=>node.getText(ast)).join('\n');
  const hook=evaluateProduction(source,deps,'useLeadAttachmentAccess');
  const attachment={id:'attachment-a',lead_id:'lead-a',file_name:'file.pdf',file_url:'https://example.invalid/stale-list-url'};
  const render=(patch={})=>{if(patch.org)auth.activeOrganization.organizationId=patch.org;if(patch.actor)auth.user.id=patch.actor;if(patch.sid)auth.session.sid=patch.sid;cursor=0;return result=hook(patch.attachment===undefined?attachment:patch.attachment,patch.open??true);};
  const ready=(index=0)=>({ ...attachment,id:requests[index].id,lead_id:requests[index].lead,file_url:'https://example.invalid/authorized-'+index,availability:'ready' });
  return {client,requests,replies,render,ready,attachment,get:()=>result,
    close:()=>{slots.forEach(slot=>slot?.cleanup?.());observers.forEach(slot=>slot.unsubscribe());client.clear();}};
}

test('only the selected document is requested and a list URL is never treated as authorized',async()=>{
 const f=fixture();try{let view=f.render();assert.equal(view.authorizedAttachment,null);await turn();assert.equal(f.requests.length,1);assert.equal(f.requests[0].id,'attachment-a');assert.equal(f.requests[0].intent.expectedSessionId,'sid-a');f.replies[0].resolve(f.ready());await turn();view=f.render();assert.equal(view.authorizedAttachment.file_url,f.ready().file_url);assert.notEqual(view.authorizedAttachment.file_url,f.attachment.file_url);}finally{f.close();}
});

test('closing cancels access; reopening reauthorizes before showing a previously signed URL',async()=>{
 const f=fixture();try{f.render();await turn();f.replies[0].resolve(f.ready());await turn();assert(f.render().authorizedAttachment);f.render({open:false});assert.equal(f.render({open:true}).authorizedAttachment,null);await turn();assert.equal(f.requests.length,2);f.replies[1].resolve(f.ready(1));await turn();assert.equal(f.render().authorizedAttachment.file_url,f.ready(1).file_url);}finally{f.close();}
});

for(const patch of [{org:'org-b'},{actor:'actor-b'},{sid:'sid-b'},{attachment:{id:'attachment-b',lead_id:'lead-b',file_name:'next.pdf',file_url:null}}])test('replacement access cancels the old read and ignores its late signed URL: '+JSON.stringify(patch),async()=>{
 const f=fixture();try{f.render();await turn();const first=f.requests[0];assert.equal(f.render(patch).authorizedAttachment,null);assert.equal(first.intent.signal.aborted,true);f.replies[0].resolve(f.ready());await turn();assert.equal(f.render(patch).authorizedAttachment,null);assert.equal(f.requests.length,2);f.replies[1].resolve(f.ready(1));await turn();assert.equal(f.render(patch).authorizedAttachment.file_url,f.ready(1).file_url);}finally{f.close();}
});

test('a revoked access response hides the cached URL and retry only repeats a read',async()=>{
 const f=fixture();try{f.render();await turn();f.replies[0].resolve(f.ready());await turn();assert(f.render().authorizedAttachment);f.render({open:false});f.render({open:true});await turn();f.replies[1].reject(new Error('Synthetic forbidden'));await turn();let view=f.render();assert.equal(view.authorizedAttachment,null);assert.equal(view.isError,true);const retry=view.refetch();await turn();assert.equal(f.requests.length,3);f.replies[2].resolve(f.ready(2));await retry;assert.equal(f.render().authorizedAttachment.file_url,f.ready(2).file_url);}finally{f.close();}
});

test('a close while authorization is pending aborts without recreating cache after logout',async()=>{
 const f=fixture();try{f.render();await turn();f.render({open:false});assert.equal(f.requests[0].intent.signal.aborted,true);f.client.clear();f.replies[0].resolve(f.ready());await turn();assert.equal(f.client.getQueryCache().getAll().length,0);}finally{f.close();}
});
