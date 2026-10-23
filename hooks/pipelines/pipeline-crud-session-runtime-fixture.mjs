import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const ids = {
  pipeline: '11111111-1111-4111-8111-111111111111', stage: '22222222-2222-4222-8222-222222222222',
  org: '33333333-3333-4333-8333-333333333333', actor: '44444444-4444-4444-8444-444444444444',
  otherOrg: '55555555-5555-4555-8555-555555555555', otherActor: '66666666-6666-4666-8666-666666666666',
  otherStage: '77777777-7777-4777-8777-777777777777', otherPipeline: '88888888-8888-4888-8888-888888888888',
};
export const revision = '2026-10-20T10:00:00.123456Z';

// Actual hooks, provider, access lifetime helpers and API/Zod modules are bundled
// unchanged. Only Auth and the final HTTP boundary are synthetic. Every browser
// request is blocked; the transport deliberately ignores late aborts to model
// an accepted command whose response arrives after its initiating visit ends.
export async function createPipelineCrudBrowser() {
  const directory = await mkdtemp(path.join(tmpdir(), 'vimob-pipeline-crud-session-'));
  let browser;
  try {
    const stub = path.join(directory, 'synthetic.tsx'), validation = path.join(directory, 'validation.ts');
    const entry = path.join(directory, 'entry.tsx'), loader = path.join(directory, 'loader.cjs');
    await writeFile(stub, `import React,{createContext,useContext}from'react';
      export const Auth=createContext(null),useAuth=()=>useContext(Auth);
      export{VimobAPIError}from${JSON.stringify(path.join(root, 'lib/api/vimob-error.ts'))};
      export const vimobAPIRequest=(url,options)=>window.h.request(url,options);
      export const getVimobAPIAccessTokenUserId=()=>window.h.scope.actor;
      export const getVimobAPIAccessTokenSessionId=()=>window.h.scope.sid;
      export const toast=Object.fromEntries(['success','error','info','warning'].map(kind=>[kind,message=>window.h.toasts.push({kind,message})]));`);
    await writeFile(validation, `export * from ${JSON.stringify(path.join(root, 'lib/validation/common.ts'))};
      export * from ${JSON.stringify(path.join(root, 'lib/validation/pipelines.ts'))};`);
    await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});
      module.exports=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;`);
    await writeFile(entry, `import React,{useLayoutEffect,useState}from'react';import{createRoot}from'react-dom/client';
      import{useQueryClient}from'@tanstack/react-query';import{QueryProvider}from'@/components/providers/query-provider';
      import{useCreatePipeline,useCreateStage,useUpdateStage,useReorderStages}from'@/hooks/use-stages';
      import{useStageDeleteIntent}from'@/hooks/pipelines/use-stage-delete-intent';
      import{captureQueryClientAccess}from'@/lib/access/query-client-access';import{Auth,VimobAPIError}from'./synthetic';
      const ids=${JSON.stringify(ids)},version=${JSON.stringify(revision)};
      const h=window.h={ids,version,scope:{org:ids.org,actor:ids.actor,sid:'sid-a',nonce:1,allowed:true,resource:ids.pipeline},
        requests:[],invalidations:[],callbacks:[],toasts:[],results:{},inputs:{},clients:[],replies:[],responseAt:{},sequence:0,globalGate:false,replyGate:false};
      const token=s=>'header.'+btoa(JSON.stringify({sub:s.actor,session_id:s.sid,nonce:s.nonce}))+'.synthetic';
      const pipeline=()=>({id:ids.pipeline,organizationId:ids.org,name:'Synthetic pipeline',isDefault:false,isActive:true,position:0,
        revision:'a'.repeat(64),createdAt:version,updatedAt:version});
      const stage=(id=ids.stage)=>({id,organizationId:ids.org,pipelineId:ids.pipeline,name:'Synthetic stage',color:'#123456',stageKey:'synthetic',
        position:0,isWon:false,isLost:false,isQualified:false,isActive:true,createdAt:version,updatedAt:version});
      h.input=kind=>kind==='createPipeline'?{name:'Synthetic pipeline',isDefault:false}:kind==='createStage'?
        {pipelineId:ids.pipeline,name:'Synthetic stage',color:'#123456'}:kind==='updateStage'?
        {id:ids.stage,expectedUpdatedAt:version,name:'Synthetic revised',color:'#123456'}:
        {pipelineId:ids.pipeline,stages:[{id:ids.stage,name:'First',color:'#123456',stage_key:'first',expectedUpdatedAt:version},
          {id:ids.otherStage,name:'Second',color:'#654321',stage_key:'second',expectedUpdatedAt:version}]};
      h.request=async(url,options)=>{
        const record={url,body:JSON.parse(JSON.stringify(options.body)),organizationId:options.organizationId,
          expectedUserId:options.expectedUserId,expectedSessionId:options.expectedSessionId,retry:options.retry,
          hasSignal:options.signal instanceof AbortSignal,signal:options.signal,actorAtDispatch:h.scope.actor,sidAtDispatch:h.scope.sid};
        h.requests.push(record);h.lastSignal=options.signal;const requestIndex=h.requests.length-1;
        if(h.replyGate)await new Promise(resolve=>{h.releaseReply=resolve;h.replies[requestIndex]=resolve});
        if(h.failure)throw new VimobAPIError('Synthetic failure',{status:h.failure.status,code:h.failure.code});
        let data=url==='/v1/pipelines'?pipeline():url.endsWith('/reorder')?options.body.stages.map((item,index)=>({...stage(item.id),
          name:item.name,stageKey:item.stageKey,position:index})):stage();
        const patch=h.responseAt[requestIndex]||h.responsePatch;
        if(patch)data=Array.isArray(data)?data.map(item=>({...item,...patch})):{...data,...patch};
        if(Array.isArray(data)&&h.extraArchived)data.push({...stage(ids.otherPipeline),isActive:false,name:'Archived stage'});
        return{data};
      };
      function Controls(){
        const client=useQueryClient(),[ui,setUI]=useState('untouched');
        h.deletion=useStageDeleteIntent(h.scope.resource??undefined);
        const hooks={createPipeline:useCreatePipeline(),createStage:useCreateStage(),updateStage:useUpdateStage(),reorderStages:useReorderStages()};
        h.latest=hooks;h.currentClient=client;h.ui=ui;
        useLayoutEffect(()=>{
          if(h.clients.includes(client))return;
          h.clients.push(client);client.fixtureId=h.clients.length;
          for(const org of[ids.org,ids.otherOrg])for(const family of['pipelines','stages','stages-with-leads','filtered-stage-counts'])
            client.setQueryData([family,org,ids.pipeline],[{id:'seed-'+org}]);
          const original=client.invalidateQueries.bind(client);
          client.invalidateQueries=(filters,settings)=>{
            h.invalidations.push({clientId:client.fixtureId,keys:client.getQueryCache().findAll(filters).map(q=>q.queryKey),refetchType:filters.refetchType});
            return original(filters,settings);
          };
          client.setDefaultOptions({...client.getDefaultOptions(),mutations:{retry:2,retryDelay:1}});
          client.getMutationCache().config.onMutate=()=>h.globalGate?new Promise(resolve=>{h.globalEntered=true;h.releaseGlobal=resolve}):undefined;
        },[client]);
        h.start=(kind,mode='mutateAsync',old=false)=>{
          const index=++h.sequence,hook=(old?h.saved:h.latest)[kind],input=h.input(kind);h.inputs[index]=input;
          const callbacks=Object.fromEntries(['onSuccess','onError','onSettled'].map(event=>[event,()=>{
            h.callbacks.push({index,event});h.toasts.push({kind:event,message:'Synthetic caller'});setUI(event);
          }]));
          h.results[index]={status:'pending'};
          try{
            if(mode==='mutate'){hook.mutate(input,callbacks);h.results[index]={status:'dispatched'}}
            else Promise.resolve(hook.mutateAsync(input,callbacks)).then(value=>h.results[index]={status:'success',value},error=>h.results[index]={status:'error',code:error.code,message:error.message});
          }catch(error){h.results[index]={status:'error',code:error.code,message:error.message}}
          return index;
        };
        return <output id='ui'>{ui}</output>;
      }
      function Fixture(){
        const[scope,setScope]=useState(h.scope),[mounted,setMounted]=useState(true);
        h.change=patch=>setScope(old=>({...old,...patch}));h.setMounted=setMounted;h.scope=scope;
        const auth={activeOrganization:{organizationId:scope.org},user:scope.actor?{id:scope.actor}:null,
          profile:scope.actor?{id:scope.actor}:null,session:scope.sid?{access_token:token(scope)}:null,
          tenantContext:{organizationId:scope.org,memberRole:'user',permissions:scope.allowed?['pipeline_manage']:[],enabledModules:['crm'],isTeamLeader:false},
          organization:{},isSuperAdmin:false,impersonating:null};
        return <Auth.Provider value={auth}><QueryProvider>{mounted&&<Controls/>}</QueryProvider></Auth.Provider>;
      }
      const reactRoot=createRoot(document.getElementById('app'));h.mount=()=>reactRoot.render(<Fixture/>);
      h.captureAccess=()=>h.oldAccess=captureQueryClientAccess(h.currentClient);
      h.snapshot=()=>({requests:h.requests.map(({signal,...request})=>({...request,aborted:signal?.aborted})),
        invalidations:h.invalidations,callbacks:h.callbacks,toasts:h.toasts,ui:h.ui,results:h.results,
        clientId:h.currentClient.fixtureId,oldAccessCurrent:h.oldAccess?.(),cacheCounts:h.clients.map(c=>c.getQueryCache().getAll().length),
        mutations:Object.fromEntries(Object.entries(h.latest).map(([kind,hook])=>[kind,{status:hook.status,data:hook.data,error:hook.error?.code}]))});
    `);
    const { webpack } = require('next/dist/compiled/webpack/webpack');
    await new Promise((resolve, reject) => {
      const compiler = webpack({ mode: 'development', target: 'web', devtool: false, entry,
        output: { path: directory, filename: 'fixture.js' },
        plugins: [new webpack.NormalModuleReplacementPlugin(/(^|[/\\])vimob-client(\.ts)?$/, stub)],
        resolve: { extensions: ['.tsx', '.ts', '.js'], modules: [path.join(root, 'node_modules'), 'node_modules'],
          alias: { '@/contexts/AuthContext$': stub, '@/lib/validation$': validation, 'sonner$': stub, '@': root } },
        module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] },
      });
      compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors()
        ? reject(error || Error(stats.toString({ all: false, errors: true }))) : resolve()));
    });
    const bundle = await readFile(path.join(directory, 'fixture.js'), 'utf8');
    const sources = {};
    for (const file of ['hooks/use-stages.ts', 'hooks/pipelines/use-pipeline-mutations.ts', 'hooks/pipelines/use-stage-delete-intent.ts',
      'lib/api/pipelines.ts', 'components/providers/query-provider.tsx', 'lib/access/query-client-access.ts']) {
      sources[file] = createHash('sha256').update(await readFile(path.join(root, file))).digest('hex');
    }
    console.info('PIPELINE_CRUD_SESSION_SOURCES', JSON.stringify(sources));
    browser = await chromium.launch({ headless: true });
    return {
      sources,
      async open() {
        const page = await browser.newPage();
        page.setDefaultTimeout(5_000);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route => route.request().url() === 'https://pipeline-crud.invalid/'
          ? route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }) : route.abort());
        await page.goto('https://pipeline-crud.invalid/');
        await page.addScriptTag({ content: 'window.process={env:{NODE_ENV:"test"}};' });
        await page.addScriptTag({ content: bundle });
        await page.evaluate(() => window.h.mount());
        await page.locator('#ui').waitFor();
        return { page, errors };
      },
      async close() {
        await browser?.close();
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
        assert(path.basename(directory).startsWith('vimob-pipeline-crud-session-'));
        await rm(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await browser?.close();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert(path.basename(directory).startsWith('vimob-pipeline-crud-session-'));
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
