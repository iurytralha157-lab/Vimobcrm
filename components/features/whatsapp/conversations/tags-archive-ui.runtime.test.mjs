import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

// Shared real List/Item, catalog API + useTags, archive hook + intent mutation
// + QueryClient. Transport/association callbacks are synthetic; DTOs are exported
// by the guarded actual Go HTTP/repository test. No CRM service is opened.
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const evidence = 'D:/Vimob/tmp/whatsapp-tags-archive-local-20261013';
const require = createRequire(import.meta.url), ts = require('typescript');
let directory, browser, bundle, css, frame;
function declaration(source, name) {
  let found; function visit(node) { if (node.name?.getText(source) === name && (ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node) || ts.isMethodDeclaration(node))) found=node.getText(source); ts.forEachChild(node, visit); }
  visit(source); assert.ok(found, name); return found;
}
before(async () => {
  frame = JSON.parse(await readFile(join(evidence, 'tags-archive-frame.json'), 'utf8'));
  assert.equal(frame.environment, 'verified disposable native PostgreSQL clone'); assert.equal(frame.fifoOutboxCount, 0);
  assert.equal(frame.tagged.lead.tags[0].tag.id, frame.catalog.data[0].id);
  directory = await mkdtemp(join(tmpdir(), 'vimob-tags-archive-'));
  const aliases = {};
  const mock = async (name, source) => { const path=join(directory,`${Object.keys(aliases).length}.ts`); await writeFile(path,source); aliases[name+'$']=path; };
  await mock('@/contexts/AuthContext', 'export const useAuth=()=>window.h.auth;');
  await mock('@/hooks/use-whatsapp-query-scope', 'export const useWhatsAppQueryScope=()=>window.h.scope;');
  await mock('@/hooks/use-toast', 'export const toast=value=>window.h.notices.push(value);');
  await mock('@/hooks/use-mention-names', 'export const useMentionNames=()=>({});');
  await mock('@/lib/validation', "export * from '@/lib/validation/common';export * from '@/lib/validation/crm-support';");
  await mock('sonner', 'export const toast={success:()=>{},error:()=>{}};');
  await mock('@/lib/api/vimob-client', `export const vimobAPIRequest=(path,options)=>window.h.transport(path,options);export const getVimobAPIAccessTokenUserId=()=>window.h.scope.userId;export const getVimobAPIAccessTokenSessionId=()=>window.h.sid;`);
  aliases['./vimob-client$'] = aliases['@/lib/api/vimob-client$'];
  const hookSource=ts.createSourceFile('hook.ts',await readFile(join(repository,'hooks/use-whatsapp-conversations.ts'),'utf8'),ts.ScriptTarget.Latest,true);
  await writeFile(join(directory,'archive.ts'), `import{useQueryClient,useIsMutating}from'@tanstack/react-query';import{useWhatsAppQueryScope}from'@/hooks/use-whatsapp-query-scope';import{useWhatsAppIntentMutation}from'@/hooks/integrations/whatsapp/use-whatsapp-mutation-intent';import{whatsappAPI}from'@/lib/api/whatsapp';import{toast}from'@/hooks/use-toast';import{WHATSAPP_UNLINKED_LEAD_SNAPSHOT}from'@/lib/whatsapp-message-input';import{isWhatsAppArchiveInvocation,matchesWhatsAppArchiveQuery,runExclusiveWhatsAppArchive}from'@/lib/whatsapp-archive';const ${declaration(hookSource,'getConversationLeadId')};const ${declaration(hookSource,'requireConversationBindingSnapshot')};${declaration(hookSource,'useArchiveConversation')}`);
  const apiSource=ts.createSourceFile('api.ts',await readFile(join(repository,'lib/api/whatsapp.ts'),'utf8'),ts.ScriptTarget.Latest,true);
  await mock('@/lib/api/whatsapp', `import{vimobAPIRequest,getVimobAPIAccessTokenUserId}from'@/lib/api/vimob-client';import{VimobAPIError}from'@/lib/api/vimob-error';${declaration(apiSource,'requestWhatsAppAPI')};export const whatsappAPI={${declaration(apiSource,'archiveConversation')}};`);
  await writeFile(join(directory,'loader.cjs'), `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=source=>ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;`);
  await writeFile(join(directory,'entry.tsx'), `
    import React from'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
    import{QueryClient,QueryClientProvider,useQuery}from'@tanstack/react-query';import{useTags}from'@/hooks/use-tags';
    import{useArchiveConversation}from'./archive';import{whatsappQueryKeys as keys}from'@/lib/whatsapp-query-cache';
    import{ConversationList}from'@/components/features/whatsapp/conversations/ConversationList';import{ConversationListItem}from'@/components/features/whatsapp/conversations/ConversationListItem';
    const app=createRoot(document.getElementById('app')),client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity},mutations:{retry:false}}});
    const jwt=(uid,sid)=>'synthetic.'+btoa(JSON.stringify({sub:uid,session_id:sid}))+'.synthetic';
    const h=window.h={frame:${JSON.stringify(frame)},sid:'synthetic-sid-a',scope:{organizationId:${JSON.stringify(frame.catalog.data[0].organization_id)},userId:${JSON.stringify(frame.restored.lead.assignee.id)},accessScope:'allowed'},notices:[],requests:[],callbacks:0,tagError:false,archiveDelay:false,waiters:[],options:{},api:{},
      render(options=this.options){this.options=options;this.auth={activeOrganization:{organizationId:this.scope.organizationId},profile:{organization_id:this.scope.organizationId},user:{id:this.scope.userId},session:{access_token:jwt(this.scope.userId,this.sid)}};flushSync(()=>app.render(<QueryClientProvider client={client}><Surface name="floating"/><Surface name="page"/></QueryClientProvider>));},
      async transport(path,options){this.requests.push({path,method:options?.method||'GET',org:options?.organizationId,user:options?.expectedUserId,sid:options?.expectedSessionId});options?.onRequestStart?.();if(path==='/v1/tags'){if(this.tagError)throw Error('catalog unavailable');return this.scope.userId===this.frame.restored.lead.assignee.id?this.frame.catalog:{data:[]};}if(path.endsWith('/archive')){if(this.archiveDelay)await new Promise(resolve=>this.waiters.push(resolve));if(options.signal?.aborted)throw new DOMException('Aborted','AbortError');this.current=options.body.archive?this.frame.archived:this.frame.restored;return{ok:true};}if(path.startsWith('/v1/whatsapp/conversations/'))return{data:this.current||this.frame.restored};throw Error('Unexpected transport '+path);},
      finish(){this.waiters.splice(0).forEach(resolve=>resolve());},clear(){client.clear();},resetQueries(){client.removeQueries({queryKey:['tags']});this.render();}
    };
    function Surface({name}){const query=useTags({catalog:true}),archive=useArchiveConversation();const conversation=useQuery({queryKey:keys.conversationSnapshot(h.scope,h.frame.restored.id),queryFn:async()=> (await h.transport('/v1/whatsapp/conversations/'+h.frame.restored.id,{organizationId:h.scope.organizationId})).data,initialData:h.frame.restored}).data;
      h.api[name]={archive:()=>archive.mutateAsync({conversation,archive:!conversation.archived_at},{onSuccess:()=>h.callbacks++}).catch(()=>{}),query};
      const row={currentUserId:h.scope.userId,availableTags:query.data||[],canOperate:true,canManageTags:true,canCreateLead:false,
        onArchive:()=>h.api[name].archive(),onDelete:()=>{},onAddTag:()=>{h.current=h.frame.tagged;client.invalidateQueries({queryKey:keys.conversationSnapshot(h.scope,conversation.id)});},onRemoveTag:()=>{h.current=h.frame.restored;client.invalidateQueries({queryKey:keys.conversationSnapshot(h.scope,conversation.id)});},
        isTagsLoading:query.isLoading||query.isFetching,isTagsError:query.isError,onRetryTags:()=>query.refetch(),formatTime:()=>''};
      return <section data-surface={name} style={{width:310,height:400}}>{name==='page'?<ConversationList {...row} layout="desktop" channel="whatsapp" conversations={[conversation]} isArchiving={c=>archive.isPendingFor(c)} isLoading={false} onRetry={()=>{}} canManageWhatsApp onConnectWhatsApp={()=>{}} onSelect={()=>{}} onCreateLead={()=>{}} hasMoreConversations={false} isLoadingMoreConversations={false} onLoadMoreConversations={()=>{}}/>:<ConversationListItem {...row} conversation={conversation} isArchiving={archive.isPendingFor(conversation)} isSelected={false} onClick={()=>{}} onCreateLead={()=>{}}/>}</section>
    }h.render();
  `);
  const { webpack } = require('next/dist/compiled/webpack/webpack.js');
  await new Promise((done,reject)=>{const compiler=webpack({mode:'development',target:'web',devtool:false,entry:join(directory,'entry.tsx'),output:{path:directory,filename:'bundle.js',publicPath:''},resolve:{symlinks:false,extensions:['.tsx','.ts','.js'],modules:[join(repository,'node_modules'),'node_modules'],alias:{...aliases,'@':repository}},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:join(directory,'loader.cjs')}]}});compiler.run((error,stats)=>compiler.close(()=>error||stats?.hasErrors()?reject(error||Error(stats.toString({all:false,errors:true}))):done()));});
  bundle=await readFile(join(directory,'bundle.js'),'utf8');
  const source=(await readFile(join(repository,'app/globals.css'),'utf8')).replace('@import "tailwindcss";','@import "tailwindcss" source(none);');
  css=(await require('postcss')([require('@tailwindcss/postcss')({base:repository})]).process(source+'\n@source "'+join(repository,'components/features/whatsapp').replaceAll('\\','/')+'";\n@source "'+join(repository,'components/ui').replaceAll('\\','/')+'";',{from:join(repository,'app/tags-fixture.css')})).css;
  browser=await chromium.launch({headless:true});
},{timeout:300000});
after(async()=>{await browser?.close();if(!directory)return;const target=resolve(directory);assert.equal(dirname(target),resolve(tmpdir()));assert.match(basename(target),/^vimob-tags-archive-/);await rm(target,{recursive:true,force:true});});
async function open(t){const page=await browser.newPage({viewport:{width:1000,height:700}}),errors=[];page.on('pageerror',e=>errors.push(e.message));let network=0;await page.route('**/*',r=>{network++;return r.abort();});t.after(async()=>{await page.close();assert.deepEqual(errors,[]);assert.equal(network,0);});await page.setContent('<script>window.process={env:{NODE_ENV:"development"}};</script><style>'+css+'</style><div id="app" class="app-shell"></div>');await page.addScriptTag({content:bundle});assert.equal(await page.evaluate(()=>typeof window.h),'object',errors.join('; '));await page.waitForFunction(()=>h.api.floating?.query.isSuccess&&h.api.page?.query.isSuccess);return page;}
async function menu(page,surface){await page.locator('[data-surface="'+surface+'"]').getByRole('button',{name:/Mais ações/}).click();}
async function tags(page,surface){
  await menu(page,surface);await page.getByRole('menuitem',{name:'Tag',exact:true}).hover();
  await expect(page.getByRole('menu')).toHaveCount(2);
  const submenu=page.getByRole('menu').last(),bounds=await submenu.boundingBox();assert.ok(bounds);
  // Follow the actual leftward hover path through the submenu edge. A synthetic
  // one-event jump skips Radix's pointer grace region and closes the submenu.
  await page.mouse.move(bounds.x+bounds.width-4,bounds.y+Math.min(16,bounds.height/2),{steps:8});
}

for(const surface of ['floating','page'])test('real catalog selection and canonical lead chips work in '+surface,async t=>{const page=await open(t);await tags(page,surface);await expect(page.getByRole('menuitem',{name:'Visita local',exact:true})).toBeVisible();await page.screenshot({path:join(evidence,'tags-catalog-'+surface+'.png'),fullPage:true});await page.getByRole('menuitem',{name:'Visita local',exact:true}).click();await expect(page.locator('[data-surface="'+surface+'"]').getByText('Visita local',{exact:true})).toBeVisible();await tags(page,surface);await page.getByRole('menuitem',{name:'Visita local remover'}).click();await expect(page.locator('[data-surface="'+surface+'"]').getByText('Visita local',{exact:true})).toHaveCount(0);assert.equal(await page.evaluate(()=>h.requests.filter(r=>r.path==='/v1/tags').length),1);});
test('actual common picker displays errors and retries the catalog on both surfaces',async t=>{const page=await open(t);await page.evaluate(()=>{h.tagError=true;h.resetQueries();});await page.waitForFunction(()=>h.api.page.query.isError);for(const surface of ['floating','page']){await tags(page,surface);await expect(page.getByRole('alert')).toContainText('Não foi possível carregar as tags.');await page.keyboard.press('Escape');await page.keyboard.press('Escape');}await page.evaluate(()=>{h.tagError=false;});await tags(page,'floating');await page.getByRole('button',{name:'Tentar novamente'}).click();await expect(page.getByRole('menuitem',{name:'Visita local',exact:true})).toBeVisible();});
test('real archive hook blocks overlapping widgets and refreshes canonical snapshots before callbacks',async t=>{const page=await open(t);await page.evaluate(()=>{h.archiveDelay=true;h.api.floating.archive();});await page.waitForFunction(()=>h.waiters.length===1);await menu(page,'page');await expect(page.getByRole('menuitem',{name:'Arquivar',exact:true})).toHaveAttribute('data-disabled','');await page.evaluate(()=>h.api.page.archive());await page.waitForTimeout(30);assert.equal(await page.evaluate(()=>h.requests.filter(r=>r.path.endsWith('/archive')).length),1);await page.keyboard.press('Escape');await page.evaluate(()=>{h.archiveDelay=false;h.finish();});await page.waitForFunction(()=>h.callbacks===1);await menu(page,'floating');await expect(page.getByRole('menuitem',{name:'Desarquivar',exact:true})).toBeVisible();});
test('changing actor cancels archive callbacks and old catalog is absent in replacement actor',async t=>{const page=await open(t);await page.evaluate(()=>{h.archiveDelay=true;h.api.floating.archive();});await page.waitForFunction(()=>h.waiters.length===1);await page.evaluate(()=>{h.scope={...h.scope,userId:'50000000-0000-4000-8000-000000000002'};h.sid='synthetic-sid-b';h.render();h.finish();});await page.waitForFunction(()=>h.api.page.query.isSuccess);await tags(page,'page');await expect(page.getByText('Nenhuma tag disponível',{exact:true})).toBeVisible();assert.equal(await page.evaluate(()=>h.callbacks),0);await page.screenshot({path:join(evidence,'tags-archive-ui.png'),fullPage:true});});
