import assert from 'node:assert/strict';
import {test} from 'node:test';
import {pipelinePreviewEnvironment} from './pipeline-preview-launch.mjs';

const key=role=>`synthetic.${Buffer.from(JSON.stringify({role,exp:Date.now()/1000+3600})).toString('base64url')}.signature`;
const fixture=()=>({kind:'vimob-queue-homologation-v1',runId:'fb4b49ef-b2c8-477f-9b8b-c3da63b7eb3d',
 projectId:'queue-homolog-20261015',workdir:'C:/Users/andre/Documents/Codex/2026-10-14/c/work/queue-homologation/stack',
 supabaseURL:'http://127.0.0.1:57421',databaseURL:'postgresql://postgres:synthetic@127.0.0.1:57422/postgres',
 databaseContainer:'supabase_db_queue-homolog-20261015',networkName:'queue-homolog-20261015-isolated',
 databaseRelayContainer:'queue-homolog-20261015-db-relay',ingressNetworkName:'queue-homolog-20261015-ingress',
 anonKey:key('anon'),serviceRoleKey:'synthetic-service-role-for-server-only',jwtSecret:'synthetic-secret-only-for-this-test-123456'});

test('frontend receives only public local targets and cannot inherit external secrets or bypasses',()=>{
 const manifest=fixture();
 const env=pipelinePreviewEnvironment(manifest,'web','legacy',{PATH:'synthetic-path',
  DATABASE_URL:'external-database',SUPABASE_SERVICE_ROLE_KEY:'external-secret',
  NEXT_PUBLIC_VIMOB_API_URL:'https://api.example.invalid',NODE_OPTIONS:'--require=external',
  NEXT_PUBLIC_BILLING_ACCESS_BYPASS:'true'});
 assert.equal(env.PATH,'synthetic-path');
 assert.equal(env.NEXT_PUBLIC_SUPABASE_URL,'http://127.0.0.1:57421');
 assert.equal(env.NEXT_PUBLIC_VIMOB_API_URL,'http://127.0.0.1:58082');
 assert.equal(env.SUPABASE_SERVICE_ROLE_KEY,undefined);assert.equal(env.DATABASE_URL,undefined);
 assert.equal(env.NEXT_PUBLIC_BILLING_ACCESS_BYPASS,undefined);
 assert.equal(env.NEXT_DIST_DIR,'.next-pipeline-local-save');
 assert.ok(!Object.values(env).some(value=>String(value).includes(manifest.serviceRoleKey)));
});

test('API uses verified local persistence and all inherited worker gates remain disabled',()=>{
 const manifest=fixture(),env=pipelinePreviewEnvironment(manifest,'api');
 assert.equal(env.DATABASE_URL,manifest.databaseURL);assert.equal(env.API_PORT,'58082');
 assert.equal(env.API_HOST,'127.0.0.1');assert.equal(env.API_BACKGROUND_WORKERS_ENABLED,'false');
 for(const [name,value] of Object.entries(env))if(/WORKER.*ENABLED|DISPATCH_ENABLED|RECONCILIATION_ENABLED/.test(name))assert.equal(value,'false',name);
 assert.equal(env.SUPABASE_JWT_SECRET,manifest.jwtSecret);
 assert.equal(env.SUPABASE_JWKS_URL,'');assert.equal(env.API_CORS_ALLOWED_ORIGINS,'http://127.0.0.1:3006,http://localhost:3006');
});

test('remote database or Auth target is rejected before constructing either environment',()=>{
 for(const mode of ['api','web']){
  assert.throws(()=>pipelinePreviewEnvironment({...fixture(),databaseURL:'postgresql://postgres:synthetic@db.example.invalid:57422/postgres'},mode));
  assert.throws(()=>pipelinePreviewEnvironment({...fixture(),supabaseURL:'https://auth.example.invalid'},mode));
 }
});

test('service role is rejected in the browser anon slot',()=>{
 assert.throws(()=>pipelinePreviewEnvironment({...fixture(),anonKey:key('service_role')},'web'),/Service-role/);
});
