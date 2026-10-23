import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { AutomationStageCommandError, deferAutomationStageCommand, invokeAutomationStageCommand, stageCommandURL } from './automation-stage-command.ts';

const identity = { organizationId:'org-a', executionId:'execution-a', nodeKey:'move-a', leaseToken:'lease-a', effectKey:'automation:execution-a:move-a:move_lead' };
const configuration = { apiURL:'https://api.example.invalid', token:'synthetic-secret' };
const success = {ok:true,status:'succeeded',effect_id:'effect-a',response:{stage_changed:true}};

test('canonical stage command sends only identity, keeps the effect key and waits for confirmation', async () => {
  const calls=[];
  const fetcher=async(url,options)=>{
    calls.push({url,options});
    return Response.json(success);
  };
  assert.deepEqual(await invokeAutomationStageCommand(identity,configuration,fetcher),success);
  await invokeAutomationStageCommand(identity,configuration,fetcher);
  assert.equal(calls[0].url.href,'https://api.example.invalid/v1/internal/automations/stage-command');
  assert.equal(calls[0].options.headers['X-Internal-Token'],'synthetic-secret');
  assert.equal(calls[0].options.redirect,'error');
  assert.equal(calls[0].options.body,calls[1].options.body);
  assert.deepEqual(JSON.parse(calls[0].options.body),identity);
  assert.equal(calls[0].options.signal.aborted,false);
});

test('command configuration rejects credentials, URL query, redirect targets and insecure remote origins', async () => {
  for(const url of ['', 'http://remote.invalid', 'https://user:secret@api.invalid', 'https://api.invalid/?token=x', 'https://api.invalid/#secret', 'https://api.invalid/path']) {
    assert.throws(()=>stageCommandURL(url),AutomationStageCommandError,url);
  }
  assert.equal(stageCommandURL('http://127.0.0.1:8081').protocol,'http:');
  let contacted=false;
  await assert.rejects(invokeAutomationStageCommand(identity,{...configuration,token:''},async()=>{contacted=true;}),/automation_command_unavailable/);
  assert.equal(contacted,false);
});

test('ambiguous transport and unavailable replies allow bounded replay without leaking upstream bodies', async () => {
  for(const fetcher of [
    async()=>{throw new Error('secret in transport');},
    async()=>new Response('secret in body',{status:503}),
    async()=>new Response('invalid-json',{status:200}),
    async()=>Response.json({ok:true,status:'queued',effect_id:'effect-a',response:{}}),
    async()=>new Response('x'.repeat(65*1024)),
    async()=>Response.json({error:{code:'automation_command_retryable'}},{status:409}),
  ]) {
    await assert.rejects(invokeAutomationStageCommand(identity,configuration,fetcher),error=>{
      assert.ok(error instanceof AutomationStageCommandError);
      assert.equal(error.retryable,true);
      assert.doesNotMatch(error.message,/secret|invalid-json/);
      return true;
    });
  }
});

test('permission, lease, graph and property rejection never retry as an unavailable service', async () => {
  for(const code of ['automation_lease_changed','automation_execution_not_running','automation_effect_conflict','lost_reason_required','lead_property_unavailable','organization_access_denied']) {
    await assert.rejects(invokeAutomationStageCommand(identity,configuration,async()=>Response.json({error:{code,message:'private text'}},{status:409})),error=>{
      assert.equal(error.code,code);
      assert.equal(error.retryable,false);
      assert.equal(error.message,code);
      return true;
    });
  }
});

test('deferral carries the exact lease, node and attempt step; no successful move is fabricated', async () => {
  let request;
  const client={rpc:async(name,args)=>{request={name,args};return{data:{ok:true,status:'queued'},error:null};}};
  assert.equal(await deferAutomationStageCommand(client,identity,'step-a'),true);
  assert.deepEqual(request,{name:'defer_automation_stage_command',args:{p_organization_id:'org-a',p_execution_id:'execution-a',p_step_id:'step-a',p_node_key:'move-a',p_lease_token:'lease-a'}});
  assert.equal(await deferAutomationStageCommand({rpc:async()=>({data:{ok:false,status:'lease_changed'},error:null})},identity,'step-a'),false);
});

const source=readFileSync(new URL('./automation-runtime.ts',import.meta.url),'utf8');
const parsed=ts.createSourceFile('automation-runtime.ts',source,ts.ScriptTarget.Latest,true);
const action=parsed.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='executeAction');
const compiled=ts.transpileModule(action.getText(parsed),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;

test('actual move_lead runtime bypasses legacy SQL and refreshes tenant-scoped lead only after commit', async () => {
  const calls=[];
  const context={};
  let confirm;
  const committed=new Promise(resolve=>{confirm=resolve;});
  const runtime=vm.createContext({Deno:{env:{get:key=>key==='AUTOMATION_COMMAND_API_URL'?configuration.apiURL:configuration.token}},invokeAutomationStageCommand:async(input)=>{calls.push(input);await committed;return success;}});
  vm.runInContext(compiled,runtime);
  const client={rpc(){throw new Error('legacy SQL must not move leads');},from(table){
    assert.equal(table,'leads');const filters={};const query={select(){return query;},eq(k,v){filters[k]=v;return query;},async maybeSingle(){calls.push(filters);return{data:{id:'lead-a',organization_id:'org-a',deal_status:'won'},error:null};}};return query;
  }};
  const pending=runtime.executeAction(client,{id:'execution-a',organization_id:'org-a',lead_id:'lead-a',locked_by:'lease-a'},{id:'move-a',action_type:'move_lead',config:{stage_id:'UNTRUSTED',lost_reason:'UNTRUSTED'}},context);
  assert.equal(calls.length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])),identity);
  confirm();await pending;
  assert.deepEqual(calls[1],{id:'lead-a',organization_id:'org-a'});
  assert.equal(context.lead.deal_status,'won');
});

test('actual move runtime does not refresh or advance after a rejected command',async()=>{
  const runtime=vm.createContext({Deno:{env:{get:()=>''}},invokeAutomationStageCommand:async()=>{throw new AutomationStageCommandError('lost_reason_required',false);}});
  vm.runInContext(compiled,runtime);
  let read=false;
  await assert.rejects(runtime.executeAction({from(){read=true;}},{id:'execution-a',organization_id:'org-a',locked_by:'lease-a'},{id:'move-a',action_type:'move_lead'},{}),/lost_reason_required/);
  assert.equal(read,false);
});

for (const due of [false, true]) {
  test(`direct starter uses database claim despite an Edge clock years ahead (due=${due})`, async () => {
    const declaration=parsed.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='processSpecificExecution');
    const body=ts.transpileModule(declaration.getText(parsed).replace(/^export\s+/,''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
    const executionId='10000000-0000-4000-8000-000000000001';
    const current={id:executionId,organization_id:'org-a',status:'queued',next_execution_at:'2030-01-01T00:00:00Z'};
    let claimed=0,ran=0;
    const client={from(table){
      assert.equal(table,'automation_executions');
      const query={select(){return query;},eq(){return query;},async maybeSingle(){return{data:current,error:null};},update(){throw new Error('Edge clock must never decide claim eligibility');}};
      return query;
    },async rpc(name,args){
      assert.equal(name,'claim_specific_automation_execution');
      assert.deepEqual(JSON.parse(JSON.stringify(args)),{p_organization_id:'org-a',p_execution_id:executionId,p_worker_id:'direct-worker'});
      claimed++;return{data:due?[{...current,status:'running'}]:[],error:null};
    }};
    class AheadDate extends Date { static now(){return Date.parse('2099-01-01T00:00:00Z');} }
    const context=vm.createContext({adminClient:()=>client,workerID:()=> 'direct-worker',UUID_RE:/^[0-9a-f-]{36}$/,Date:AheadDate,moduleEnabled:async()=>true,runExecution:async()=>{ran++;}});
    vm.runInContext(body,context);
    const result=await context.processSpecificExecution(executionId);
    assert.equal(claimed,1);
    assert.equal(ran,due?1:0);
    assert.equal(result.accepted,due);
  });
}
