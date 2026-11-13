import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { AutomationPhaseError } from './automation-runtime-errors.ts';

// Execute the actual Edge action function, without importing its Deno env,
// starting a server or contacting Supabase. SQL atomicity is tested separately.
const source = readFileSync(new URL('./automation-runtime.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('automation-runtime.ts', source, ts.ScriptTarget.Latest, true);
const action = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'executeAction');
assert.ok(action, 'the actual runtime action must exist');
const compiled = ts.transpileModule(action.getText(parsed), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const runtime = vm.createContext({ AutomationPhaseError });
vm.runInContext(compiled, runtime);
const execution = { id:'execution-a', organization_id:'org-a', lead_id:'lead-a', locked_by:'lease-a' };

function fixture(outcome = {ok:true,status:'succeeded'}, rows = [{id:'lead-a',organization_id:'org-a',name:'Current'}]) {
  let resolveEffect;
  const calls=[];
  const committed = new Promise(resolve=>{resolveEffect=resolve;});
  const client={
    async rpc(name,args) {
      calls.push({name,args});
      await committed;
      return {data:outcome,error:null};
    },
    from(table) {
      assert.equal(table,'leads','the Edge action does not directly insert another realtime event');
      const filters=new Map();
      const query={
        select(){return query;},
        eq(field,value){filters.set(field,value);return query;},
        async maybeSingle(){
          calls.push({table,filters:Object.fromEntries(filters)});
          return {data:rows.find(row=>[...filters].every(([field,value])=>row[field]===value))??null,error:null};
        },
      };
      return query;
    },
  };
  return {calls,confirm:()=>resolveEffect(),run:type=>runtime.executeAction(client,execution,{id:'node-tag',action_type:type,config:{tag_id:'tag-a'}},{})};
}

for(const type of ['add_tag','remove_tag']) {
  test(`${type} awaits the confirmed scoped RPC before reading current lead`,async()=>{
    const f=fixture();
    const pending=f.run(type);
    assert.equal(f.calls.length,1,'no read or publication before the effect is confirmed');
    assert.equal(f.calls[0].name,'apply_automation_internal_effect');
    assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].args)),{
      p_organization_id:'org-a',p_execution_id:'execution-a',p_node_key:'node-tag',
      p_lease_token:'lease-a',p_effect_key:`automation:execution-a:node-tag:${type}`,
      p_effect_type:type,p_payload:{tag_id:'tag-a'},
    });
    f.confirm();
    assert.equal((await pending).status,'succeeded');
    assert.deepEqual(f.calls[1],{table:'leads',filters:{id:'lead-a',organization_id:'org-a'}});
    assert.equal(f.calls.length,2,'the atomic SQL producer is the sole association event owner');
  });
}

for(const status of ['failed','execution_not_running']) {
  test(`an unconfirmed ${status} effect does not read or publish a successful association`,async()=>{
    const f=fixture({ok:false,status});
    const pending=f.run('add_tag');
    f.confirm();
    await assert.rejects(pending, {
      name: 'AutomationPhaseError',
      message: `internal_effect:${status}`,
    });
    assert.equal(f.calls.length,1);
  });
}

test('a successful idempotent replay does not create a second Edge publication',async()=>{
  const f=fixture({ok:true,status:'succeeded',response:{}});
  const pending=f.run('add_tag');
  f.confirm();
  await pending;
  await f.run('add_tag');
  assert.deepEqual(f.calls.map(call=>call.name??call.table),[
    'apply_automation_internal_effect','leads','apply_automation_internal_effect','leads',
  ]);
  assert.equal(f.calls[0].args.p_effect_key,f.calls[2].args.p_effect_key);
});

test('post-effect refresh cannot use a matching lead identifier from another organization',async()=>{
  const f=fixture({ok:true,status:'succeeded'},[{id:'lead-a',organization_id:'org-b',name:'Foreign'}]);
  const pending=f.run('remove_tag');
  f.confirm();
  await assert.rejects(pending,/lead_missing_after_internal_effect/);
  assert.deepEqual(f.calls[1].filters,{id:'lead-a',organization_id:'org-a'});
});
