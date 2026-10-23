import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {isolatedProcessEnvironment} from '../supabase/launch-queue-local-homologation.mjs';
import {connectVerifiedDatabase,localAuthFetch,readVerifiedManifest,validateManifest} from '../supabase/queue-local-homologation-target.mjs';

const REPO='D:/Vimob/workspaces/vimob-crm';
const API='http://127.0.0.1:58082';
const WEB='http://127.0.0.1:3006';
const FONT_SOURCE='C:/Users/andre/Documents/Codex/2026-10-14/c/work/queue-homologation/local-font-css.cjs';
const DOTENV=['.env','.env.local','.env.development','.env.development.local'];
const SYSTEM_NAMES=new Set(['path','pathext','systemroot','windir','comspec','temp','tmp','appdata','localappdata','userprofile','homedrive','homepath','programfiles','programfiles(x86)','programdata','number_of_processors','processor_architecture']);

export function pipelinePreviewEnvironment(manifest,mode,signingMode='legacy',parent=process.env) {
  validateManifest(manifest);
  assert.ok(['api','web'].includes(mode));
  if(mode==='api') return {...isolatedProcessEnvironment(manifest,signingMode),
    API_PORT:'58082',DATABASE_MAX_CONNS:'4',API_LOG_LEVEL:'warn',
    API_CORS_ALLOWED_ORIGINS:`${WEB},http://localhost:3006`,
    APP_PUBLIC_URL:WEB,VIMOB_API_URL:API};
  let claims;
  try {claims=JSON.parse(Buffer.from(manifest.anonKey.split('.')[1],'base64url').toString());}
  catch {throw new Error('An explicit local JWT anon key is required.');}
  assert.equal(claims.role,'anon','Service-role credentials must never reach Next.');
  assert.ok(Number(claims.exp)>Date.now()/1000,'The local anon key expired.');
  const clean=Object.fromEntries(Object.entries(parent).filter(([key])=>SYSTEM_NAMES.has(key.toLowerCase())));
  return {...clean,NODE_ENV:'development',NODE_OPTIONS:'--max-old-space-size=1536',
    NEXT_TELEMETRY_DISABLED:'1',NEXT_PUBLIC_SUPABASE_URL:manifest.supabaseURL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY:manifest.anonKey,NEXT_PUBLIC_VIMOB_API_URL:API,VIMOB_API_URL:API,
    NEXT_PUBLIC_SITE_URL:WEB,APP_PUBLIC_URL:WEB,NEXT_PUBLIC_LOCAL_READ_ONLY:'false',
    NEXT_PUBLIC_DISABLE_ERROR_TELEMETRY:'true',NEXT_DIST_DIR:'.next-pipeline-local-save',
    NEXT_FONT_GOOGLE_MOCKED_RESPONSES:FONT_SOURCE};
}

async function assertFreePort(port) {
  const server=net.createServer();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
}

async function assertNoDotenv(directory) {
  for(const name of DOTENV) {
    assert.equal(await fs.access(path.join(directory,name)).then(()=>true,()=>false),false,
      `Refused: ${name} could introduce external configuration.`);
  }
}

export async function launchPipelinePreview(mode,manifestFilename,runtimeDirectory) {
  assert.ok(['api','web'].includes(mode),'Choose api or web; existing processes are never stopped.');
  const runtime=await fs.realpath(runtimeDirectory);
  const relative=path.relative('D:/Vimob/outputs',runtime);
  assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&/^pipeline-local-save-/.test(relative),
    'Use an existing dedicated pipeline-local-save directory below D:/Vimob/outputs.');
  const manifest=await readVerifiedManifest(manifestFilename);
  const db=await connectVerifiedDatabase(manifest);
  await db.end();
  const response=await localAuthFetch(manifest)(manifest.supabaseURL+'/auth/v1/.well-known/jwks.json');
  assert.ok(response.ok,'Local Auth must be ready.');
  const jwks=await response.json();
  const signingMode=jwks.keys?.length?'jwks':'legacy';
  if(signingMode==='legacy')assert.ok(manifest.jwtSecret?.length>=32,'Explicit local signing material is required.');
  const cwd=mode==='api'?path.join(runtime,'process-cwd'):REPO;
  await fs.mkdir(cwd,{recursive:true});
  await assertNoDotenv(cwd);
  const port=mode==='api'?58082:3006;
  await assertFreePort(port);
  const executable=mode==='api'?path.join(runtime,'bin','vimob-api.exe'):process.execPath;
  const args=mode==='api'?[]:[path.join(REPO,'node_modules','next','dist','bin','next'),'dev',REPO,'--hostname','127.0.0.1','--port','3006','--webpack'];
  await fs.access(executable);
  if(mode==='web')await fs.access(FONT_SOURCE);
  const record=path.join(runtime,`${mode}-process.json`);
  const receipt={kind:'vimob-pipeline-local-preview-process-v1',mode,sourceRoot:REPO,
    stackRunId:manifest.runId,cwd,executable,args,api:API,frontend:WEB,auth:manifest.supabaseURL,
    workersEnabled:false,startedAt:new Date().toISOString(),status:'reserved'};
  // An old or uncertain launch must be inspected rather than silently replaced.
  await fs.writeFile(record,JSON.stringify(receipt,null,2),{flag:'wx'});
  const output=await fs.open(path.join(runtime,`${mode}.stdout.log`),'a');
  const error=await fs.open(path.join(runtime,`${mode}.stderr.log`),'a');
  try {
    const child=spawn(executable,args,{cwd,env:pipelinePreviewEnvironment(manifest,mode,signingMode),
      detached:true,windowsHide:true,stdio:['ignore',output.fd,error.fd]});
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
    child.unref();
    await fs.writeFile(record,JSON.stringify({...receipt,pid:child.pid,status:'spawned_readiness_not_verified'},null,2));
    return {mode,pid:child.pid,sourceRoot:REPO,api:API,frontend:WEB,workersEnabled:false};
  } finally {await output.close();await error.close();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  launchPipelinePreview(process.argv[2],process.argv[3],process.argv[4])
    .then(result=>console.log(JSON.stringify(result)))
    .catch(error=>{console.error(`Local Pipeline launch refused: ${error.message}`);process.exitCode=1;});
}
