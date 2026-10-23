import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import ts from 'typescript';
import { QueryClient, QueryObserver } from '@tanstack/query-core';
import { evaluateProduction, productionDeclaration } from './lead-request-runtime-fixture.mjs';

function fixture() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const path = 'hooks/leads/use-lead-attachment-upload-draft.ts';
  const ast = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  const code = ast.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(ast)).join('\n');
  const slots=[];let cursor=0;const changed=(before,next)=>!before||next.some((value,index)=>!Object.is(value,before[index]));
  const deps={useQueryClient: () => client, createUUID: randomUUID,
    useRef:value=>{const index=cursor++;return slots[index]??={current:value};},
    useMemo:(build,dependencies)=>{const index=cursor++;if(changed(slots[index]?.dependencies,dependencies))slots[index]={dependencies,value:build()};return slots[index].value;},
    useLayoutEffect:(setup,dependencies)=>{const index=cursor++;if(changed(slots[index]?.dependencies,dependencies)){slots[index]?.cleanup?.();slots[index]={dependencies,cleanup:setup()};}},
    useQuery: options => new QueryObserver(client, options).getCurrentResult() };
  deps.useLeadDetailOperationScope=evaluateProduction(productionDeclaration('hooks/leads/use-lead-detail-operation-scope.ts',node=>ts.isFunctionDeclaration(node)&&node.name?.text==='useLeadDetailOperationScope'),deps,'useLeadDetailOperationScope');
  const actual = evaluateProduction(code, deps, 'useLeadAttachmentUploadDraft');
  const hook=(...args)=>{cursor=0;return actual(...args);};
  return { client, hook, close: () => { slots.forEach(slot=>slot?.cleanup?.());client.clear(); } };
}
const scope = ['org-a', 'lead-a', 'actor-a', 'sid-a'];

test('receipt ownership prevents an old ACK from clearing a newer retry', () => {
  const f = fixture();
  try {
    const draft = f.hook(...scope), file = new File(['synthetic'], 'document.pdf');
    const first = draft.begin(file); draft.retain(first); const second = draft.begin(file);
    draft.acknowledge(first); assert.equal(f.hook(...scope).draft.operationId, second.operationId);
    draft.retain(first); assert.equal(f.hook(...scope).draft.phase, 'pending');
    draft.acknowledge(second); assert.equal(f.hook(...scope).draft, null);
  } finally { f.close(); }
});

test('cleared/recreated Query identity rejects old callbacks and cannot resurrect files after logout', () => {
  const f = fixture();
  try {
    const old = f.hook(...scope), file = new File(['synthetic'], 'document.pdf');
    const first = old.begin(file); f.client.clear(); old.retain(first); old.acknowledge(first);
    assert.equal(f.client.getQueryCache().getAll().length, 0);
    const current = f.hook(...scope), second = current.begin(file);
    old.acknowledge(first); old.retain(first);
    assert.equal(f.hook(...scope).draft.operationId, second.operationId);
  } finally { f.close(); }
});

test('a pending attempt cannot be cleared or replaced; a different file needs explicit ending', () => {
  const f = fixture();
  try {
    const draft = f.hook(...scope), file = new File(['synthetic'], 'document.pdf');
    const receipt = draft.begin(file); draft.clear(); assert.equal(draft.begin(file), null);
    draft.retain(receipt); assert.throws(() => draft.begin(new File(['new'], 'next.pdf')));
    draft.clear(); assert.equal(f.hook(...scope).draft, null);
    assert(draft.begin(new File(['new'], 'next.pdf')));
  } finally { f.close(); }
});

test('lead, organization, actor and session each isolate the retained File', () => {
  const f = fixture();
  try {
    const file = new File(['synthetic'], 'document.pdf'); const draft = f.hook(...scope);
    const receipt = draft.begin(file); draft.retain(receipt);
    for (let index = 0; index < scope.length; index++) {
      const replacement = [...scope]; replacement[index] += '-replacement';
      assert.equal(f.hook(...replacement).draft, null);
    }
    assert.equal(f.hook(...scope).draft.file, file);
  } finally { f.close(); }
});

test('old UI callbacks cannot begin or clear a new attempt after a scope ABA', () => {
  const f=fixture();try{
    const old=f.hook(...scope),file=new File(['synthetic'],'document.pdf');const first=old.begin(file);old.retain(first);
    f.hook('org-b',...scope.slice(1));const current=f.hook(...scope);const second=current.begin(file);current.retain(second);
    assert.throws(()=>old.begin(file));old.clear();assert.equal(f.hook(...scope).draft.operationId,second.operationId);
    current.clear();assert.equal(f.hook(...scope).draft,null);
  }finally{f.close();}
});
