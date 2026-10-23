import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
const repo=process.cwd(), output=process.env.WHATSAPP_QUICK_REPLY_RECONCILE_PROOF_DIR;
const require=createRequire(repo+'/package.json'),{chromium,expect}=require('@playwright/test');
const {webpack}=require('next/dist/compiled/webpack/webpack.js');
let directory,browser,bundle,css;
const reply=(n=1,shortcut='visita',content='Conteúdo original')=>({id:`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,shortcut,content,created_at:'2026-10-14T10:00:00Z',updated_at:'2026-10-14T10:00:00Z'});
before(async()=>{
  if(output)await mkdir(output,{recursive:true});directory=await mkdtemp(join(tmpdir(),'vimob-closed-composer-review-'));
  const aliases={};
  const mock=async(name,code)=>{const file=join(directory,`mock-${Object.keys(aliases).length}.js`);await writeFile(file,code);aliases[name]=file;};
  await mock('@/contexts/AuthContext','export const useAuth=()=>({session:window.h.session});');
  await mock('@/hooks/use-whatsapp-query-scope','export const useWhatsAppQueryScope=()=>window.h.scope;');
  await mock('@/lib/auth/global-sign-out','export const getGlobalSignOutSessionId=s=>s?.sid??null;');
  await mock('@/lib/api/vimob-client',`export const getVimobAPIAccessTokenUserId=()=>h.token.user;
    export const getVimobAPIAccessTokenSessionId=()=>h.token.sid;export const vimobAPIRequest=(path,options)=>h.request(path,options);`);
  await mock('@/components/features/whatsapp/AudioRecorderButton',`import React from'react';export function AudioRecorderButton(p){
    const[active,setActive]=React.useState(false);React.useEffect(()=>{h.mounts++;return()=>h.unmounts++;},[]);
    return React.createElement('button',{type:'button',disabled:p.disabled,'aria-label':active?'Cancelar gravação':'Gravar áudio',onClick:()=>{setActive(!active);p.onActiveChange?.(!active);}},active?'Cancel':'Mic sentinel');}`);
  const loader=join(directory,'loader.cjs'),entry=join(directory,'entry.js');
  await writeFile(loader,`const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;`);
  await writeFile(entry,`import React from'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';
    import{ScopedMessageBox}from'@/components/features/whatsapp/ScopedMessageBox';import{useWhatsAppQuickReplies}from'@/hooks/whatsapp/use-whatsapp-quick-replies';
    const root=createRoot(document.getElementById('root')),client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity},mutations:{retry:false}}});
    const h=window.h={client,requests:[],sends:[],mounts:0,unmounts:0,draft:'Rascunho da conversa',context:'chat-A',disabled:false,ignoreAbort:true,
      scope:{organizationId:'11111111-1111-4111-8111-111111111111',userId:'22222222-2222-4222-8222-222222222222',accessScope:'own+sid-A'},session:{sid:'sid-A'},token:{user:'22222222-2222-4222-8222-222222222222',sid:'sid-A'},
      request(path,options){return new Promise((resolve,reject)=>{const r={path,...options,settled:false,aborted:false,resolve:payload=>{r.settled=true;resolve(payload);},reject:error=>{r.settled=true;reject(error);}};h.requests.push(r);
        const abort=()=>{r.aborted=true;if(!h.ignoreAbort)r.reject(new DOMException('Aborted','AbortError'));};if(options.signal?.aborted)abort();else options.signal?.addEventListener('abort',abort,{once:true});});},
      render(patch={}){Object.assign(h,patch);flushSync(()=>root.render(React.createElement(QueryClientProvider,{client},React.createElement(View))));},
      unmount(){flushSync(()=>root.render(null));},
      cache(){return client.getQueryCache().getAll().map(q=>({key:q.queryKey,data:q.state.data,invalid:q.state.isInvalidated,fetch:q.state.fetchStatus}));},
    };
    function Peer(){const query=useWhatsAppQuickReplies();React.useLayoutEffect(()=>{h.peerData=query.data;});return null;}
    function View(){return React.createElement('main',{className:'app-shell',style:{height:'100vh',padding:12,display:'flex',flexDirection:'column',justifyContent:'flex-end'}},
      h.peer?React.createElement(Peer):null,
      React.createElement('button',{type:'button','data-outside':true,style:{position:'absolute',top:0,left:0}},'Outside'),
      React.createElement(ScopedMessageBox,{value:h.draft,onChange:value=>{h.draft=value;h.render();},onSend:()=>{h.sends.push(h.draft);h.draft='';h.render();},disabled:h.disabled,isSending:!!h.sending,multiline:true,
        audio:{contextKey:h.context,onSend:async()=>{},disabled:h.disabled},placeholder:'Mensagem',inputAriaLabel:'Mensagem'}));}
    h.render();`);
  await new Promise((done,reject)=>{const compiler=webpack({mode:'development',target:'web',entry,output:{path:directory,filename:'review.js',publicPath:''},
    resolve:{extensions:['.ts','.tsx','.js'],modules:[join(repo,'node_modules'),'node_modules'],alias:{...aliases,'@':repo}},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:loader}]}});
    compiler.run((error,stats)=>compiler.close(()=>error?reject(error):stats.hasErrors()?reject(new Error(stats.toString({all:false,errors:true}))):done()));});
  bundle=await readFile(join(directory,'review.js'),'utf8');
  const globals=(await readFile(repo+'/app/globals.css','utf8')).replace('@import "tailwindcss";','@import "tailwindcss" source(none);');
  const sources=['components/features/whatsapp','components/ui','hooks/whatsapp'].map(p=>'@source "'+repo+'/'+p+'";').join('\n');
  css=(await require('postcss')([require('@tailwindcss/postcss')({base:repo})]).process(globals+'\n'+sources,{from:repo+'/app/closed-review.css'})).css;
  browser=await chromium.launch({headless:true});
},{timeout:120000});
after(async()=>{await browser?.close();if(directory){const target=resolve(directory);assert.ok(target.startsWith(resolve(tmpdir())+sep));assert.match(basename(target),/^vimob-closed-composer-review-/);await rm(target,{recursive:true,force:true});}});
async function fixture(t){const page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(4000);const errors=[],network=[];
  page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',r=>{network.push(r.request().url());return r.abort();});t.after(async()=>{await page.close();assert.deepEqual(errors,[]);assert.deepEqual(network,[]);});
  await page.setContent('<div id="root"></div>');await page.addStyleTag({content:css+'\nhtml,body,#root{height:100%;margin:0}'});await page.evaluate(()=>window.process={env:{NODE_ENV:'development'}});
  await page.addScriptTag({content:bundle});await waitRequest(page,1);await page.evaluate(item=>h.requests[0].resolve({data:[item]}),reply());await page.getByRole('textbox',{name:'Mensagem',exact:true}).waitFor();return page;}
const field=page=>page.getByRole('textbox',{name:'Mensagem',exact:true});
const editor=page=>page.getByRole('textbox',{name:'Conteúdo da mensagem salva',exact:true});
const waitRequest=(page,n)=>page.waitForFunction(n=>h.requests.length>=n,n);
const manager=page=>page.getByRole('region',{name:'Gerenciar mensagens salvas',exact:true});
const openManager=async page=>{await page.getByRole('button',{name:'Mensagens salvas',exact:true}).click();await expect(manager(page)).toBeVisible();};
async function beginSave(page){await openManager(page);await page.getByRole('button',{name:'Salvar mensagem atual',exact:true}).click();}
async function evidence(page,name,extra={}){const snapshot=await page.evaluate(()=>({requests:h.requests.map(r=>({path:r.path,method:r.method||'GET',body:r.body,actor:r.expectedUserId,sid:r.expectedSessionId,aborted:r.aborted,settled:r.settled})),cache:h.cache(),draft:h.draft,sends:h.sends,mounts:h.mounts,unmounts:h.unmounts}));
  if(output)await writeFile(join(output,name+'.json'),JSON.stringify({...snapshot,...extra},null,2));if(output)await page.screenshot({path:join(output,name+'.png'),fullPage:true});return snapshot;}
async function reconcile(page,rows){
  await page.waitForFunction(()=>h.requests.some((r,i)=>i>0&&!r.method&&!r.settled));
  await page.evaluate(rows=>h.requests.find((r,i)=>i>0&&!r.method&&!r.settled).resolve({data:rows}),rows);
  await page.waitForFunction(()=>h.cache().some(q=>q.data&&!q.invalid&&q.fetch==='idle'));
}

for(const method of ['POST','PATCH','DELETE'])test('desired invariant: close pending '+method+' then server commits and reopen reconciles personal list',async t=>{
  const page=await fixture(t);await openManager(page);
  if(method==='POST'){await page.getByRole('button',{name:'Salvar mensagem atual',exact:true}).click();await page.getByRole('textbox',{name:'Atalho da mensagem salva'}).fill('nova');await editor(page).fill('Conteúdo criado');}
  if(method==='PATCH'){await page.getByRole('button',{name:'Editar /visita',exact:true}).click();await editor(page).fill('Conteúdo atualizado');}
  if(method==='DELETE'){await page.getByRole('button',{name:'Excluir /visita',exact:true}).click();await page.getByRole('button',{name:'Confirmar exclusão',exact:true}).click();}
  else await page.getByRole('button',{name:'Salvar',exact:true}).click();
  await waitRequest(page,2);assert.equal(await page.evaluate(()=>h.requests[1].method),method);
  await page.getByRole('button',{name:'Fechar mensagens salvas',exact:true}).click();await expect(manager(page)).toHaveCount(0);
  const remote=method==='DELETE'?[]:method==='PATCH'?[reply(1,'visita','Conteúdo atualizado')]:[reply(),reply(2,'nova','Conteúdo criado')];
  await page.evaluate(({method,remote})=>{h.requests[1].resolve(method==='DELETE'?null:{data:remote.at(-1)});},{method,remote});
  await page.waitForTimeout(100);await openManager(page);await page.waitForTimeout(100);
  const state=await evidence(page,'close-pending-'+method,{simulatedCommittedServerRows:remote,desired:'reopened personal manager reconciles acknowledged server mutation'});
  assert.ok(state.requests.filter(r=>r.method==='GET').length>=2,'server mutation can commit despite client abort; reopening must reconcile cached list');
  await reconcile(page,remote);
  if(method==='DELETE')await expect(page.getByRole('button',{name:'Inserir /visita',exact:true})).toHaveCount(0);
  else await expect(page.getByRole('button',{name:'Inserir /'+(method==='POST'?'nova':'visita'),exact:true})).toContainText(method==='POST'?'Conteúdo criado':'Conteúdo atualizado');
  assert.equal(await page.evaluate(()=>h.requests.filter(r=>r.method).length),1,'never replay a write');
  assert.equal(await page.evaluate(()=>h.draft),'Rascunho da conversa');
  await evidence(page,'reconciled-'+method);
});

test('full UI+DATA safe CRUD updates personal cache, inserts draft only and keeps recorder mounted',async t=>{
  const page=await fixture(t);await field(page).focus();await field(page).press('End');await beginSave(page);await page.getByRole('textbox',{name:'Atalho da mensagem salva'}).fill('nova');await editor(page).fill('  Texto literal\n{nome}  ');
  await page.getByRole('button',{name:'Salvar',exact:true}).click();await waitRequest(page,2);await page.evaluate(item=>h.requests[1].resolve({data:item}),reply(2,'nova','  Texto literal\n{nome}  '));
  await waitRequest(page,3);await page.evaluate(items=>h.requests[2].resolve({data:items}),[reply(),reply(2,'nova','  Texto literal\n{nome}  ')]);
  await page.getByRole('button',{name:'Inserir /nova',exact:true}).click();await expect(field(page)).toHaveValue('Rascunho da conversa  Texto literal\n{nome}  ');
  await openManager(page);await page.getByRole('button',{name:'Editar /nova',exact:true}).click();await editor(page).fill('Texto editado');await page.getByRole('button',{name:'Salvar',exact:true}).click();
  await waitRequest(page,4);await page.evaluate(item=>h.requests[3].resolve({data:item}),reply(2,'nova','Texto editado'));await waitRequest(page,5);await page.evaluate(items=>h.requests[4].resolve({data:items}),[reply(),reply(2,'nova','Texto editado')]);
  await expect(page.getByRole('button',{name:'Inserir /nova',exact:true})).toContainText('Texto editado');await page.getByRole('button',{name:'Excluir /nova',exact:true}).click();await page.getByRole('button',{name:'Confirmar exclusão',exact:true}).click();
  await waitRequest(page,6);await page.evaluate(()=>h.requests[5].resolve(null));await waitRequest(page,7);await page.evaluate(item=>h.requests[6].resolve({data:[item]}),reply());await expect(page.getByRole('button',{name:'Inserir /nova',exact:true})).toHaveCount(0);
  await expect(field(page)).toHaveValue('Rascunho da conversa  Texto literal\n{nome}  ');
  const result=await evidence(page,'safe-create-insert');assert.deepEqual(result.sends,[]);assert.deepEqual([result.mounts,result.unmounts],[1,0]);
});

test('same-owner new chat late successful save reconciles list without replacing new draft',async t=>{
  const page=await fixture(t);await beginSave(page);await page.getByRole('textbox',{name:'Atalho da mensagem salva'}).fill('nova');await editor(page).fill('Guardado');
  await page.getByRole('button',{name:'Salvar',exact:true}).click();await waitRequest(page,2);await page.evaluate(()=>h.render({context:'chat-B',draft:'Novo rascunho'}));
  await page.evaluate(item=>h.requests[1].resolve({data:item}),reply(2,'nova','Guardado'));await page.waitForTimeout(100);await openManager(page);await page.waitForTimeout(100);
  const state=await evidence(page,'same-owner-chat-late-save');assert.equal(state.draft,'Novo rascunho');assert.deepEqual(state.sends,[]);
  assert.ok(state.requests.filter(r=>r.method==='GET').length>=2,'same owner, changed chat: acknowledged save must eventually reconcile personal list');
  await reconcile(page,[reply(),reply(2,'nova','Guardado')]);await expect(page.getByRole('button',{name:'Inserir /nova',exact:true})).toContainText('Guardado');
  await expect(field(page)).toHaveValue('Novo rascunho');
});

test('authority revocation while editor pending hides old private editor and rejects late completion',async t=>{
  const page=await fixture(t);await beginSave(page);await editor(page).fill('Texto privado A');await page.getByRole('button',{name:'Salvar',exact:true}).click();await waitRequest(page,2);
  await page.evaluate(()=>h.render({scope:{...h.scope,userId:'33333333-3333-4333-8333-333333333333',accessScope:'own+sid-B'},session:{sid:'sid-B'},token:{user:'33333333-3333-4333-8333-333333333333',sid:'sid-B'},context:'chat-B',draft:'Texto privado B'}));
  await expect(manager(page)).toHaveCount(0);await waitRequest(page,3);await page.evaluate(()=>h.requests[2].resolve({data:[]}));
  await page.evaluate(item=>h.requests[1].resolve({data:item}),reply(2,'secreto','Texto privado A'));await openManager(page);await page.waitForTimeout(100);
  await expect(manager(page)).not.toContainText('Texto privado A');await expect(field(page)).toHaveValue('Texto privado B');const state=await evidence(page,'private-owner-late-save');assert.deepEqual(state.sends,[]);
});

test('native selection plus IME and plain Enter insert without sending; recorder survives',async t=>{
  const page=await fixture(t);await field(page).fill('Antes /visita depois');await field(page).press('Home');for(let i=0;i<13;i++)await field(page).press('ArrowRight');
  await expect(page.getByRole('option')).toHaveCount(1);await field(page).dispatchEvent('keydown',{key:'Enter',isComposing:true,keyCode:229});await expect(field(page)).toHaveValue('Antes /visita depois');
  await field(page).press('Enter');await expect(field(page)).toHaveValue('Antes Conteúdo original depois');assert.deepEqual(await page.evaluate(()=>h.sends),[]);
  await expect(field(page)).toBeFocused();assert.deepEqual(await page.evaluate(()=>[h.mounts,h.unmounts]),[1,0]);assert.equal(await page.evaluate(()=>h.requests.length),1,'typing and insertion do not issue extra reads or writes');
});

test('closing during failed pending save cannot overwrite reopened editor or draft',async t=>{
  const page=await fixture(t);await beginSave(page);await editor(page).fill('Formulário A');await page.getByRole('button',{name:'Salvar',exact:true}).click();await waitRequest(page,2);
  await page.getByRole('button',{name:'Fechar mensagens salvas',exact:true}).click();await beginSave(page);await editor(page).fill('Formulário B');
  await page.evaluate(()=>h.requests[1].reject(Object.assign(new Error('Erro antigo'),{status:503})));await page.waitForTimeout(100);
  await expect(editor(page)).toHaveValue('Formulário B');await expect(manager(page)).not.toContainText('Erro antigo');await expect(field(page)).toHaveValue('Rascunho da conversa');
  const state=await evidence(page,'reopen-preserves-new-editor');assert.deepEqual(state.sends,[]);
});

for(const status of [401,403,409])test('late HTTP '+status+' reconciles the list without replay or old error in the reopened editor',async t=>{
  const page=await fixture(t);await beginSave(page);await editor(page).fill('Tentativa anterior');await page.getByRole('button',{name:'Salvar',exact:true}).click();await waitRequest(page,2);
  await page.getByRole('button',{name:'Fechar mensagens salvas',exact:true}).click();await beginSave(page);await editor(page).fill('Novo formulário protegido');
  await page.evaluate(status=>h.requests[1].reject(Object.assign(new Error('Erro privado aposentado'),{status})),status);await waitRequest(page,3);
  if(status===409)await reconcile(page,[reply(),reply(2,'existente','Resposta atual do servidor')]);
  else await page.evaluate(status=>h.requests[2].reject(Object.assign(new Error('Catálogo indisponível'),{status})),status);
  await page.waitForTimeout(50);await expect(editor(page)).toHaveValue('Novo formulário protegido');await expect(manager(page)).not.toContainText('Erro privado aposentado');await expect(field(page)).toHaveValue('Rascunho da conversa');
  await page.getByRole('button',{name:'Fechar mensagens salvas',exact:true}).click();await openManager(page);
  if(status===409)await expect(page.getByRole('button',{name:'Inserir /existente',exact:true})).toContainText('Resposta atual do servidor');
  else {await expect(manager(page)).toContainText('Mensagens salvas indisponíveis.');await expect(page.getByRole('button',{name:'Inserir /visita',exact:true})).toHaveCount(0);}
  const state=await evidence(page,'late-http-'+status);assert.equal(state.requests.filter(r=>r.method!=='GET').length,1);assert.deepEqual(state.sends,[]);
});

for(const boundary of ['organization','SID'])test('late completed write never refetches old '+boundary+' for the new context',async t=>{
  const page=await fixture(t);await beginSave(page);await editor(page).fill('Privado anterior');await page.getByRole('button',{name:'Salvar',exact:true}).click();await waitRequest(page,2);
  await page.evaluate(boundary=>{const scope={...h.scope};if(boundary==='organization')scope.organizationId='44444444-4444-4444-8444-444444444444';else scope.accessScope='own+sid-new';
    h.render({scope,session:{sid:boundary==='SID'?'sid-new':'sid-A'},token:{user:h.token.user,sid:boundary==='SID'?'sid-new':'sid-A'},context:'chat-new',draft:'Rascunho atual'});},boundary);
  await waitRequest(page,3);await page.evaluate(()=>h.requests[2].resolve({data:[]}));await page.evaluate(item=>h.requests[1].resolve({data:item}),reply(2,'antigo','Privado anterior'));
  await openManager(page);await page.waitForTimeout(50);await expect(manager(page)).not.toContainText('Privado anterior');await expect(field(page)).toHaveValue('Rascunho atual');
  assert.equal(await page.evaluate(()=>h.requests.length),3,'no read for a retired scope');await evidence(page,'late-'+boundary);
});

test('ABA personal owner receives only a fresh GET, never the retired mutation payload or draft',async t=>{
  const page=await fixture(t);await beginSave(page);await editor(page).fill('Payload antigo');await page.getByRole('button',{name:'Salvar',exact:true}).click();await waitRequest(page,2);
  await page.evaluate(()=>{h.original={scope:h.scope,session:h.session,token:h.token};h.render({scope:{...h.scope,userId:'33333333-3333-4333-8333-333333333333',accessScope:'own+sid-B'},session:{sid:'sid-B'},token:{user:'33333333-3333-4333-8333-333333333333',sid:'sid-B'},context:'chat-B',draft:'B'});});
  await waitRequest(page,3);await page.evaluate(()=>h.requests[2].resolve({data:[]}));await page.evaluate(()=>h.render({...h.original,context:'chat-A-new',draft:'A novo rascunho'}));
  await page.evaluate(item=>h.requests[1].resolve({data:item}),reply(2,'nova','Payload antigo'));await waitRequest(page,4);await reconcile(page,[reply(),reply(2,'nova','Atualizado pelo GET')]);
  await openManager(page);await expect(page.getByRole('button',{name:'Inserir /nova',exact:true})).toContainText('Atualizado pelo GET');await expect(manager(page)).not.toContainText('Payload antigo');await expect(field(page)).toHaveValue('A novo rascunho');
  const state=await evidence(page,'owner-ABA-fresh-read');assert.equal(state.requests.filter(r=>r.method!=='GET').length,1);assert.deepEqual(state.sends,[]);
});

test('a mounted second observer reconciles an edit after the originating manager closes',async t=>{
  const page=await fixture(t);await page.evaluate(()=>h.render({peer:true}));await openManager(page);await page.getByRole('button',{name:'Editar /visita',exact:true}).click();await editor(page).fill('Atualizado para ambos');
  await page.getByRole('button',{name:'Salvar',exact:true}).click();await waitRequest(page,2);await page.getByRole('button',{name:'Fechar mensagens salvas',exact:true}).click();
  await page.evaluate(item=>h.requests[1].resolve({data:item}),reply(1,'visita','Payload aposentado'));await waitRequest(page,3);await reconcile(page,[reply(1,'visita','Atualizado para ambos')]);
  await page.waitForFunction(()=>h.peerData?.[0].content==='Atualizado para ambos');await openManager(page);await expect(page.getByRole('button',{name:'Inserir /visita',exact:true})).toContainText('Atualizado para ambos');
  await expect(manager(page)).not.toContainText('Payload aposentado');await evidence(page,'second-observer');
});

test('closing in the same turn as the response still reconciles without resurrecting editor state',async t=>{
  const page=await fixture(t);await beginSave(page);await page.getByRole('textbox',{name:'Atalho da mensagem salva'}).fill('nova');await page.getByRole('button',{name:'Salvar',exact:true}).click();await waitRequest(page,2);
  await page.evaluate(item=>{h.requests[1].resolve({data:item});document.querySelector('button[aria-label="Fechar mensagens salvas"]').click();},reply(2,'nova','Resposta terminada'));
  await expect(manager(page)).toHaveCount(0);await waitRequest(page,3);await reconcile(page,[reply(),reply(2,'nova','Lista atualizada')]);await openManager(page);
  await expect(editor(page)).toHaveCount(0);await expect(page.getByRole('button',{name:'Inserir /nova',exact:true})).toContainText('Lista atualizada');await expect(field(page)).toHaveValue('Rascunho da conversa');
  const state=await evidence(page,'close-after-response');assert.equal(state.requests.filter(r=>r.method!=='GET').length,1);assert.deepEqual(state.sends,[]);
});

test('last surface closes while saving: terminal result marks only its inactive cache stale until a fresh mount',async t=>{
  const page=await fixture(t);await beginSave(page);await page.getByRole('textbox',{name:'Atalho da mensagem salva'}).fill('nova');await page.getByRole('button',{name:'Salvar',exact:true}).click();await waitRequest(page,2);
  await page.evaluate(()=>h.unmount());assert.equal(await page.evaluate(()=>h.requests[1].aborted),false);await page.evaluate(item=>h.requests[1].resolve({data:item}),reply(2,'nova','Payload encerrado'));
  await page.waitForFunction(()=>h.cache().some(q=>q.invalid));assert.equal(await page.evaluate(()=>h.requests.length),2,'inactive cache never starts a background read');
  await page.evaluate(()=>h.render({draft:'Rascunho após voltar',context:'chat-remount'}));await waitRequest(page,3);await reconcile(page,[reply(),reply(2,'nova','Conteúdo relido')]);await openManager(page);
  await expect(page.getByRole('button',{name:'Inserir /nova',exact:true})).toContainText('Conteúdo relido');await expect(manager(page)).not.toContainText('Payload encerrado');await expect(field(page)).toHaveValue('Rascunho após voltar');
  const state=await evidence(page,'last-surface-remount');assert.equal(state.requests.filter(r=>r.method!=='GET').length,1);assert.deepEqual(state.sends,[]);
});
