import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtureSecrets, fixtureSession, legacyEdgeHarness, boundedResult, pendingRequest } from './helpers/whatsapp-legacy-edge-harness.mjs';

const noSensitiveLog=(h,values)=>{const text=JSON.stringify(h.logs,(_key,value)=>value&&typeof value==='object'&&typeof value.message==='string'?{...value,message:value.message,stack:value.stack}:value);for(const value of values)assert.ok(!text.includes(value),`No private field in logs: ${value.slice(0,6)}`);};
test('legacy proxy authorizes before reading any body or constructing a privileged client',async t=>{
 for(const header of [undefined,'Bearer wrong-private-key',fixtureSecrets.service,'Bearer']){
  const h=legacyEdgeHarness('evolution-proxy');t.after(h.dispose);const response=await h.handler(h.request({action:'sendMessage',text:'Private draft',token:'private-callback-token'},header?{authorization:header}:{}));
  assert.equal(response.status,403);assert.equal(h.effects.bodyReads,0);assert.equal(h.effects.clients,0);assert.equal(h.effects.requests.length,0);assert.deepEqual(h.logs,[]);
 }
});
test('legacy proxy fails closed on missing server credential before body or SDK construction',async t=>{
 const h=legacyEdgeHarness('evolution-proxy',{environment:{SUPABASE_SERVICE_ROLE_KEY:undefined}});t.after(h.dispose);
 const response=await h.handler(h.request({action:'fetchChats'},{}));assert.equal(response.status,503);assert.equal(h.effects.bodyReads,0);assert.equal(h.effects.clients,0);assert.equal(h.effects.requests.length,0);
});
test('legacy proxy rejects unauthorized malformed or hanging bodies without consuming them',async t=>{
 const h=legacyEdgeHarness('evolution-proxy');t.after(h.dispose);const request=h.request({},{});request.json=()=>{h.effects.bodyReads++;return new Promise(()=>{});};
 const response=await boundedResult(h.handler(request));assert.ok(response,'auth rejection cannot wait for an unauthorized body');assert.equal(response.status,403);assert.equal(h.effects.bodyReads,0);
});
test('legacy proxy preflight remains public and effect free',async t=>{
 const h=legacyEdgeHarness('evolution-proxy');t.after(h.dispose);const response=await h.handler(new Request('https://fixture.test',{method:'OPTIONS'}));assert.equal(response.status,200);assert.equal(h.effects.clients,0);assert.equal(h.effects.bodyReads,0);assert.deepEqual(h.logs,[]);
});
test('authorized legacy sends preserve payload and acknowledgement while logs exclude request and provider bodies',async t=>{
 const privateValues=['Mensagem pessoal sintética','5511999990000','fixture-private-jid@s.whatsapp.net','private-provider-response','private-user-token',fixtureSecrets.service,fixtureSecrets.provider];
 const h=legacyEdgeHarness('evolution-proxy',{fetch:async()=>Response.json({key:{id:'provider-id'},secret:privateValues[3]})});t.after(h.dispose);
 const response=await h.handler(h.request({action:'sendMessage',instanceName:'inst-private',number:privateValues[1],text:privateValues[0],remoteJid:privateValues[2],token:privateValues[4]}));
 const body=await response.json();assert.equal(response.status,200);assert.equal(body.success,true);assert.equal(h.effects.requests.length,1);const sent=JSON.parse(h.effects.requests[0].body);assert.equal(sent.text||sent.textMessage?.text,privateValues[0]);noSensitiveLog(h,[...privateValues,'inst-private']);
});
test('authorized legacy media does not log caption, phone, base64, filename or provider replies',async t=>{
 const values=['Legenda privada','5511999997777','U3ludGhldGljUHJpdmF0ZUJ5dGVz','documento-privado.pdf','provider-private-media'];
 const h=legacyEdgeHarness('evolution-proxy',{fetch:async()=>Response.json({key:{id:'sent'},private:values[4]})});t.after(h.dispose);
 const response=await h.handler(h.request({action:'sendFile',instanceName:'private-instance',number:values[1],mediaType:'document',caption:values[0],base64:values[2],filename:values[3]}));assert.equal((await response.json()).success,true);assert.equal(h.effects.requests.length,1);noSensitiveLog(h,values);
});
test('legacy provider exception details never enter logs',async t=>{
 const secret='provider-secret-in-error-with-private-phone';const h=legacyEdgeHarness('evolution-proxy',{fetch:async()=>{throw new Error(secret);}});t.after(h.dispose);
 const response=await h.handler(h.request({action:'fetchChats',instanceName:'private-instance'}));assert.equal((await response.json()).success,false);noSensitiveLog(h,[secret,'private-instance']);
});
for(const phase of ['headers','body'])test(`global status bounds ${phase} wait and aborts without private error logs`,async t=>{
 let signal;const h=legacyEdgeHarness('global-whatsapp-status',{fetch:request=>{signal=request.signal;return phase==='headers'?pendingRequest(request):{ok:true,status:200,json:()=>pendingRequest(request)};}});t.after(h.dispose);
 const response=await boundedResult(h.handler(h.request({instance_name:'private-instance'})));assert.ok(response,'status provider cannot hang the handler');assert.equal(response.status,500);assert.equal(signal.aborted,true);assert.ok(h.delays.includes(5000));noSensitiveLog(h,['private-instance',fixtureSecrets.provider,fixtureSecrets.service]);
});
test('global status keeps successful shape but does not log provider payload or instance names',async t=>{
 const privateValue='private-provider-status-detail';const h=legacyEdgeHarness('global-whatsapp-status',{fetch:async()=>Response.json({instance:{state:'open'},private:privateValue})});t.after(h.dispose);
 const response=await h.handler(h.request({instance_name:'private-instance'}));const body=await response.json();assert.equal(body.success,true);assert.equal(body.connected,true);assert.equal(body.data.private,privateValue);noSensitiveLog(h,[privateValue,'private-instance']);
});
test('global status rejects anonymous invalid and non-admin callers before provider or body access',async t=>{
 for(const options of [{headers:{}},{authDenied:true},{role:'broker'}]){const h=legacyEdgeHarness('global-whatsapp-status',options);t.after(h.dispose);const response=await h.handler(h.request({instance_name:'private-instance'},options.headers));assert.ok([401,403].includes(response.status));assert.equal(h.effects.bodyReads,0);assert.equal(h.effects.requests.length,0);noSensitiveLog(h,['private-instance']);}
});
for(const phase of ['headers','body'])test(`health check bounds ${phase} per provider and continues the next session without false disconnect`,async t=>{
 const sessions=[fixtureSession('blocked'),fixtureSession('healthy')];let oldSignal;const h=legacyEdgeHarness('session-health-check',{sessions,fetch:request=>{if(request.url.includes('instance-blocked')){oldSignal=request.signal;return phase==='headers'?pendingRequest(request):{ok:true,status:200,json:()=>pendingRequest(request)};}return Response.json({data:{connected:true}});}});t.after(h.dispose);
 const response=await boundedResult(h.handler(h.request({}, {'x-cron-secret':fixtureSecrets.cron})));assert.ok(response,'a stuck provider cannot starve the next session');const body=await response.json();assert.equal(body.processed,2);assert.equal(body.results[0].success,false);assert.equal(body.results[1].success,true);assert.equal(oldSignal.aborted,true);assert.equal(h.effects.requests.length,2);assert.equal(h.effects.updates.length,1);assert.deepEqual(h.effects.updates[0].filters,[['id','healthy'],['organization_id','org-a'],['owner_user_id','owner-a'],['provider','evolution_go'],['instance_name','private-healthy'],['status','connected'],['updated_at','2026-10-14T00:00:00Z'],['instance_id','instance-healthy'],['is_active',true]]);assert.equal(h.effects.inserts.length,0);noSensitiveLog(h,['private-blocked','private-healthy',fixtureSecrets.provider]);
});
for(const phase of ['headers','body'])test(`health notification ${phase} timeout keeps the same episode and allows the next session`,async t=>{
 const sessions=[fixtureSession('notify'),fixtureSession('healthy')];let signal;const h=legacyEdgeHarness('session-health-check',{sessions,fetch:request=>{if(request.url.includes('notification-dispatcher')){signal=request.signal;return phase==='headers'?pendingRequest(request):{ok:true,status:200,json:()=>pendingRequest(request)};}return Response.json({data:{connected:request.url.includes('healthy')}});}});t.after(h.dispose);
 const response=await boundedResult(h.handler(h.request({}, {'x-cron-secret':fixtureSecrets.cron})));assert.ok(response);const body=await response.json();assert.equal(body.processed,2);assert.equal(body.results[0].success,false);assert.equal(body.results[1].success,true);assert.equal(signal.aborted,true);
 const notifications=h.effects.requests.filter(r=>r.url.includes('notification-dispatcher'));assert.equal(notifications.length,1,'no timeout-induced POST replay');assert.match(JSON.parse(notifications[0].body).dedupe_key,/whatsapp_disconnected:notify:owner-a:2026-10-14/);assert.ok(!h.effects.updates.some(u=>u.filters.some(([,id])=>id==='notify')));noSensitiveLog(h,['private-notify','Nome notify',fixtureSecrets.cron]);
});
test('health check logs only controlled data on successful disconnection and preserves its receipt shape',async t=>{
 const h=legacyEdgeHarness('session-health-check',{sessions:[fixtureSession()],fetch:async request=>request.url.includes('notification-dispatcher')?Response.json({success:true,queued:true,notification_id:'notification-a'}):Response.json({data:{connected:false,private:'private-provider-body'}})});t.after(h.dispose);
 const response=await h.handler(h.request({}, {'x-cron-secret':fixtureSecrets.cron}));const body=await response.json();assert.equal(body.success,true);assert.equal(body.results[0].new_status,'disconnected');assert.equal(body.results[0].retried,true);assert.equal(h.effects.inserts.length,1);assert.equal(h.effects.updates.length,1);noSensitiveLog(h,['private-provider-body','private-session-a',fixtureSecrets.cron,fixtureSecrets.service]);assert.ok(!JSON.stringify(h.effects.inserts).includes('private-provider-body'));assert.equal(h.pendingTimers(),0);
});
for(const phase of ['headers','body'])test(`late status ${phase} completion ignoring abort cannot publish after deadline`,async t=>{
 let finish;let bodyReads=0;const h=legacyEdgeHarness('global-whatsapp-status',{fetch:async()=>phase==='headers'?new Promise(resolve=>{finish=resolve;}):{ok:true,status:200,json:()=>new Promise(resolve=>{bodyReads++;finish=resolve;})}});t.after(h.dispose);
 const response=await boundedResult(h.handler(h.request({instance_name:'private-instance'})));assert.ok(response);assert.equal(response.status,500);const before=JSON.stringify(h.logs);
 finish(phase==='headers'?{ok:true,status:200,json:async()=>{bodyReads++;return{state:'open',secret:'late-private-result'};}}:{state:'open',secret:'late-private-result'});for(let i=0;i<8;i++)await Promise.resolve();
 assert.equal(bodyReads,phase==='headers'?0:1);assert.equal(JSON.stringify(h.logs),before);assert.equal(h.pendingTimers(),0);noSensitiveLog(h,['late-private-result']);
});
test('health late provider completion ignoring abort cannot change status after the next session',async t=>{
 let finish;const h=legacyEdgeHarness('session-health-check',{sessions:[fixtureSession('blocked'),fixtureSession('healthy')],fetch:request=>request.url.includes('instance-blocked')?new Promise(resolve=>{finish=resolve;}):Response.json({data:{connected:true}})});t.after(h.dispose);
 const response=await boundedResult(h.handler(h.request({}, {'x-cron-secret':fixtureSecrets.cron})));assert.ok(response);const before=JSON.stringify(h.effects.updates);finish(Response.json({data:{connected:false}}));for(let i=0;i<8;i++)await Promise.resolve();assert.equal(JSON.stringify(h.effects.updates),before);assert.equal(h.effects.inserts.length,0);assert.equal(h.pendingTimers(),0);
});
for(const status of [201,202])test(`global status preserves authorized provider ${status} JSON and releases its timer`,async t=>{
 const payload={data:'unchanged',instance:{state:'open'}};const h=legacyEdgeHarness('global-whatsapp-status',{fetch:async()=>Response.json(payload,{status})});t.after(h.dispose);
 const response=await h.handler(h.request({instance_name:'private-instance'}));assert.equal(response.status,200);assert.deepEqual(await response.json(),{success:true,connected:true,data:payload});assert.equal(h.pendingTimers(),0);assert.equal(h.effects.requests.length,1);
});
test('health notification accepts202 with the existing durable receipt and sends once',async t=>{
 const h=legacyEdgeHarness('session-health-check',{fetch:async request=>request.url.includes('notification-dispatcher')?Response.json({success:true,queued:true,notification_id:'notification-a'},{status:202}):Response.json({data:{connected:false}})});t.after(h.dispose);
 const response=await h.handler(h.request({}, {'x-cron-secret':fixtureSecrets.cron}));assert.equal((await response.json()).results[0].success,true);assert.equal(h.effects.requests.filter(r=>r.url.includes('notification-dispatcher')).length,1);assert.equal(h.pendingTimers(),0);
});
test('global status rejects non2xx observations and malformed JSON without retaining a timer',async t=>{
 const h=legacyEdgeHarness('global-whatsapp-status',{fetch:async()=>Response.json({state:'close',code:'provider-denied'},{status:403})});t.after(h.dispose);const response=await h.handler(h.request({instance_name:'private-instance'}));assert.equal(response.status,500);assert.deepEqual(await response.json(),{success:false,error:'whatsapp_status_unavailable:403'});assert.equal(h.pendingTimers(),0);
 const invalid=legacyEdgeHarness('global-whatsapp-status',{fetch:async()=>new Response('not-json')});t.after(invalid.dispose);assert.equal((await invalid.handler(invalid.request({instance_name:'private-instance'}))).status,500);assert.equal(invalid.pendingTimers(),0);
});
test('HTTP helper rejects an already cancelled caller before dispatch or timer creation',async t=>{
 const h=legacyEdgeHarness('global-whatsapp-status');t.after(h.dispose);const controller=new AbortController();controller.abort();
 await assert.rejects(h.http().withWhatsAppLegacyHttpDeadline('https://provider.example.test', {signal:controller.signal},r=>r.json()),e=>e.name==='AbortError');assert.equal(h.effects.requests.length,0);assert.equal(h.pendingTimers(),0);
});
for(const phase of ['headers','body'])test(`HTTP helper propagates caller cancellation during ${phase} and releases its deadline`,async t=>{
 let signal,bodyStarted=false;const h=legacyEdgeHarness('global-whatsapp-status',{fetch:request=>{signal=request.signal;return phase==='headers'?new Promise(()=>{}):{ok:true,json:()=>{bodyStarted=true;return new Promise(()=>{});}};}});t.after(h.dispose);
 const controller=new AbortController();const result=h.http().withWhatsAppLegacyHttpDeadline('https://provider.example.test',{signal:controller.signal},r=>r.json());for(let i=0;i<8;i++)await Promise.resolve();assert.equal(bodyStarted,phase==='body');controller.abort();await assert.rejects(result,e=>e.name==='AbortError');assert.equal(signal.aborted,true);assert.equal(h.pendingTimers(),0);
});
test('health check rejects anonymous invalid and non-admin callers before provider access',async t=>{
 for(const options of [{headers:{}},{authDenied:true},{role:'broker'}]){const h=legacyEdgeHarness('session-health-check',options);t.after(h.dispose);const response=await h.handler(h.request({},options.headers));assert.ok([401,403].includes(response.status));assert.equal(h.effects.requests.length,0);assert.equal(h.effects.reads.filter(r=>r.table==='whatsapp_sessions').length,0);}
});
