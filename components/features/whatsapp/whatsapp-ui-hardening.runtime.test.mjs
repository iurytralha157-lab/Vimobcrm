import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from '@playwright/test';

// Actual React components, deferred local APIs, and Chromium. No CRM server,
// database, Supabase, microphone, or provider is contacted. Run separately
// from the Node alias loader (Playwright's CommonJS loader must remain intact).
const require = createRequire(import.meta.url);
const { webpack } = require('next/dist/compiled/webpack/webpack.js');
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const baseline = process.env.WHATSAPP_UI_BASELINE;
const snapshotDirectory = process.env.WHATSAPP_UI_SNAPSHOT_DIR;
const scrollBaseline = process.env.WHATSAPP_SCROLL_BASELINE;
let directory, browser, bundle;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vimob-whatsapp-ui-'));
  const aliases = {};
  async function mock(name, source) {
    const path = join(directory, `${Object.keys(aliases).length}.js`);
    await writeFile(path, source); aliases[name] = path;
  }
  const hook = `const h=()=>window.harness;`;
  await mock('@/contexts/AuthContext', `${hook} export const useAuth=()=>h().auth;`);
  await mock('@/contexts/FilterContext', `${hook} export const useFilters=()=>h().filters;`);
  await mock('@/lib/supabase/client', `export const supabase=new Proxy({}, {get(){throw new Error('Unexpected direct Supabase call in isolated UI test');}});`);
  await mock('@/hooks/use-whatsapp-query-scope', `${hook} export const useWhatsAppQueryScope=()=>h().scope;`);
  await mock('@/hooks/whatsapp/use-whatsapp-lead-activity-realtime', `export const useWhatsAppLeadActivityRealtime=()=>{};`);
  await mock('@/hooks/use-user-permissions', `${hook} export const useUserPermissions=()=>({hasPermission:k=>h().permissions.includes(k),isLoading:false});`);
  await mock('@/hooks/use-organization-modules', `export const useOrganizationModules=()=>({hasModule:k=>k==='whatsapp',isLoading:false});`);
  await mock('@/hooks/use-mobile', `${hook} export const useIsMobile=()=>h().mobile;`);
  await mock('@/hooks/use-tags', `${hook} export const useTags=()=>h().emptyQuery;`);
  await mock('@/hooks/use-properties', `${hook} export const useProperties=()=>h().emptyQuery;export const useProperty=()=>h().emptyQuery;`);
  await mock('@/hooks/use-users', `${hook} export const useUsers=()=>h().emptyQuery;`);
  await mock('@/hooks/use-leads', `${hook} export const useLeads=()=>h().emptyQuery;
    export const useLead=id=>h().leadAccess||({data:{id,organization_id:h().auth.activeOrganization.organizationId,
      assigned_user_id:h().leadDetail?.assigned_user_id??null,updated_at:h().leadDetail?.updated_at,
      deal_status:h().leadDetail?.deal_status||'open',queue_pool:null,can_operate:h().permissions.includes('lead_operate')},
      isSuccess:true,isFetchedAfterMount:true,isFetching:false,refetch:()=>{}});
    export const useUpdateLead=()=>h().updateLead; export const useAddLeadTag=()=>h().mutation;
    export const useRemoveLeadTag=()=>h().mutation;`);
  await mock('@/hooks/use-conversation-lead-detail', `${hook} export const useConversationLeadDetail=id=>({data:{id,name:id,phone:'5511999998888',created_at:'2026-10-11T00:00:00Z',tags:[],meta:{}},isLoading:false,isError:false,refetch:()=>{}});`);
  await mock('@/hooks/use-lead-attachments', `${hook} export const useLeadAttachments=()=>h().emptyQuery; export const useUploadLeadAttachment=()=>h().mutation;`);
  await mock('@/hooks/use-lead-history', `${hook} export const useLeadHistory=()=>h().emptyQuery;`);
  await mock('@/hooks/use-lead-messages', `${hook} export const useLeadMessages=()=>({...h().messages,data:h().messages.messages,hasOlderMessages:false});`);
  await mock('@/hooks/use-schedule-events', `${hook} export const useScheduleEvents=()=>h().emptyQuery;`);
  await mock('@/hooks/use-deal-status-change', `${hook} export const useDealStatusChange=()=>({handleDealStatusChange:()=>{},isPending:false});`);
  await mock('@/contexts/LeadRealtimeBus', `export const notifyLeadRealtimeChange=()=>{};`);
  await mock('@/lib/api/leads', `${hook} export const leadsAPI={getLead:(id,org)=>h().request('lead-phone',{id,org}).then(data=>({data}))};`);
  await mock('sonner', `${hook} export const toast={success:x=>h().toasts.push(x),error:x=>h().toasts.push(x),info:x=>h().toasts.push(x)};`);
  await mock('@/hooks/use-toast', `${hook} export const toast=x=>h().toasts.push(x);`);
  await mock('@/lib/api/whatsapp', `${hook} export {getWhatsAppPhoneChangeConfirmation} from '@/lib/whatsapp-phone-change';export const whatsappAPI={findConversation:p=>h().request('find',p),getHistoryAccess:p=>h().request('history',p),getConversation:(id,lead)=>h().request('detail',{id,lead}),getConversationLinkPreview:(id,previousLead,lead,organizationId)=>h().request('preview',{id,previousLead,lead,organizationId}),getSession:async(id,organization_id)=>({...h().sessions.find(s=>s.id===id),organization_id,is_active:true}),startConversation:p=>h().request('start',p)};`);
  await mock('@/lib/api/conversation-lead-detail', `${hook} export const conversationLeadDetailAPI={get:id=>h().request('lead-phone',{id})};`);
  await mock('@/hooks/use-whatsapp-conversations', `${hook}
    export const useWhatsAppConversations=(sessionId,filters,sessionIds,limit,options)=>{
      h().listOptions=options;
      h().listFilters=filters;
      const rows=h().conversations;
      return {
        ...h().emptyQuery,
        data:options?.includeSupervisoryLeads||!rows.some(row=>row.supervisory_lead_view)
          ? rows : rows.filter(row=>!row.supervisory_lead_view),
        hasMoreConversations:!!h().more,
        isLoadingMoreConversations:!!h().loadingMore,
        loadMoreConversations:()=>{},
      };
    };
    export const useWhatsAppConversation=id=>({...h().emptyQuery,data:h().conversations.find(c=>c.id===id)||null,isFetched:true});
    export const useWhatsAppConversationSnapshot=id=>({...h().emptyQuery,data:h().snapshotFetched===false?null:h().conversations.find(c=>c.id===id)||null,isFetched:h().snapshotFetched!==false});
    export const useWhatsAppConversationForLead=()=>({...h().emptyQuery,data:null,isFetched:true});
    export const useWhatsAppConversationFilterOptions=()=>h().emptyQuery;
    export const useWhatsAppUnreadCount=()=>({data:0});
    export const useSendWhatsAppMessage=()=>h().send;
    export const useResolveWhatsAppSendIntent=()=>h().resolveSend;
    export const useDiscardFailedLocalWhatsAppMessage=()=>()=>{};
    export const useReactToWhatsAppMessage=()=>h().mutation;
    export const useMarkConversationAsRead=()=>h().mutation;
    export const useArchiveConversation=()=>({mutate:(p,callbacks)=>h().request('archive',p).then(()=>callbacks?.onSuccess())});
    export const useDeleteConversation=()=>({mutateAsync:p=>h().request('delete',p),isPending:false});
    export const useLinkConversationToLead=()=>({mutateAsync:p=>h().request('link',p),isPending:false});
    export const useWhatsAppInboxRealtime=()=>{};export const useWhatsAppLeadRealtime=()=>{};`);
  await mock('@/hooks/use-whatsapp-messages-paginated', `${hook} const empty=[]; export const useWhatsAppMessagesPaginated=(id,options)=>{
    h().messageRead={id,options};return id ? h().messages : {...h().messages,messages:empty};
  };`);
  await mock('@/hooks/use-accessible-sessions', `${hook} export const useAccessibleSessions=()=>({data:h().sessions,isLoading:false});`);
  await mock('@/hooks/use-whatsapp-attendance', `${hook} export const useWhatsAppAttendanceGate=()=>h().attendance;`);
  const ts=require('typescript');
  const startModule=ts.createSourceFile('use-start-conversation.ts',await readFile(join(repository,'hooks/use-start-conversation.ts'),'utf8'),ts.ScriptTarget.Latest,true);
  const startHelpers=startModule.statements.filter(n=>['WhatsAppStartError','getWhatsAppStartErrorMessage'].includes(n.name?.text)).map(n=>n.getText(startModule)).join('\n');
  assert.equal(startModule.statements.filter(n=>['WhatsAppStartError','getWhatsAppStartErrorMessage'].includes(n.name?.text)).length,2);
  await mock('@/hooks/use-start-conversation', `${hook} import{VimobAPIError}from'@/lib/api/vimob-error';${ts.transpileModule(startHelpers,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext}}).outputText}
    export const useStartConversation=()=>({mutateAsync:p=>h().request('start',p)});
    export const useFindConversationByPhone=()=>({mutateAsync:p=>h().request('find',p)});`);
  await mock('@/hooks/use-whatsapp-sessions', `${hook}
    export const useWhatsAppSessions=()=>({data:h().sessions,isLoading:false,isError:false,refetch:()=>{}});
    export const useCreateWhatsAppSession=()=>h().mutation;
    export const useDeleteWhatsAppSession=()=>h().mutation;
    export const useLogoutSession=()=>h().mutation;
    export const useToggleNotificationSession=()=>h().mutation;
    export const useGetQRCode=()=>h().qr;
    export const useGetConnectionStatus=()=>({...h().status});
    export const useWhatsAppLiveStatusSync=()=>{};
    export const useRecreateWhatsAppInstance=()=>({mutateAsync:p=>h().request('recreate',p)});`);
  await mock('@/hooks/use-dashboard-filters', `export const getDateRangeFromPreset=()=>null;`);
  await mock('@/hooks/use-meta-conversations', `${hook} export const useMetaConversations=()=>h().emptyQuery;export const useMetaMessages=()=>h().emptyQuery;export const useSendMetaMessage=()=>h().mutation;`);
  await mock('@/hooks/use-meta-integration', `${hook} export const useMetaIntegrations=()=>h().emptyQuery;`);
  await mock('@/hooks/use-automations', `${hook} export const useCancelLeadExecutions=()=>h().mutation;export const useLeadActiveAutomationExecutions=()=>h().emptyQuery;`);
  await mock('@/components/shared/layout/AppLayout', `import React from 'react';export const AppLayout=({children})=>React.createElement('div',null,children);`);
  await mock('@/components/features/whatsapp/ConversationLeadPanel', `import React from 'react';export const ConversationLeadPanel=p=>React.createElement('div',null,p.leadId,p.canReassignLead&&React.createElement('button',{onClick:p.onReassignLead},'Mudar vínculo'));
    export const ConversationUnregisteredPanel=p=>React.createElement('button',{onClick:()=>{window.harness.lastLink=p.onLinkLead('lead-new',{conversationId:window.harness.screenSelection,sessionId:'session-a',leadId:'lead-new',expectedPreviousLeadId:p.currentLeadId||'unlinked'});}},'Confirmar vínculo');`);
  await mock('next/navigation', `${hook} export const usePathname=()=>'/dashboard';export const useRouter=()=>({push:p=>h().navigation.push(p)});`);
  await mock('next/link', `import React from 'react';export default ({children,href,...p})=>React.createElement('a',{...p,href},children);`);
  await mock('next/image', `import React from 'react';export default p=>React.createElement('img',p);`);
  // Dialogs are DOM wrappers so API lifecycle tests do not depend on portal
  // animation timing. Input, Button, Textarea, and MessageBox are production UI.
  for (const name of ['dialog','alert-dialog','tooltip','popover','hover-card','command','select']) {
    const names = {
      dialog:['Dialog','DialogContent','DialogDescription','DialogFooter','DialogHeader','DialogTitle'],
      'alert-dialog':['AlertDialog','AlertDialogAction','AlertDialogCancel','AlertDialogContent','AlertDialogDescription','AlertDialogFooter','AlertDialogHeader','AlertDialogTitle'],
      tooltip:['Tooltip','TooltipContent','TooltipProvider','TooltipTrigger'],
      popover:['Popover','PopoverContent','PopoverTrigger'],
      'hover-card':['HoverCard','HoverCardContent','HoverCardTrigger'],
      command:['Command','CommandEmpty','CommandGroup','CommandInput','CommandItem','CommandList'],
      select:['Select','SelectContent','SelectItem','SelectTrigger','SelectValue'],
    }[name];
    await mock(`@/components/ui/${name}`, `import React from 'react';${names.map(n =>
      `export const ${n}=({children,open,onOpenChange,onClick,...p})=>open===false?null:React.createElement('${n.endsWith('Action')||n.endsWith('Cancel')?'button':'div'}',{onClick,...Object.fromEntries(Object.entries(p).filter(([k])=>k==='className'||k==='disabled'||k.startsWith('aria-')||k.startsWith('data-')))},children,${n==='Dialog'?`onOpenChange&&React.createElement('button',{'aria-label':'Fechar diálogo',onClick:()=>onOpenChange(false)},'Fechar')`:'null'});`).join('')}`);
  }
  for (const [path, names] of [
    ['leads/LostReasonDialog',['LostReasonDialog']],['properties/PropertyPickerDialog',['PropertyPickerDialog']],
    ['schedule/CompactScheduleEventsList',['CompactScheduleEventsList']],['schedule/EventSheet',['EventSheet']],
    ['leads/CopyLeadPhoneButton',['CopyLeadPhoneButton']],
    ['whatsapp/StartAutomationDialog',['StartAutomationDialog']],['whatsapp/EnterAttendanceDialog',['EnterAttendanceDialog']],
    ['integrations/whatsapp/WhatsAppSessionAccessDialog',['WhatsAppSessionAccessDialog']],
  ]) await mock(`@/components/features/${path}`, names.map(n=>`export const ${n}=()=>null;`).join(''));
  // Controlled recorder sentinel proves caller mount lifetime. The real mic/
  // permission/preview lifecycle is tested separately in recorder tests.
  await mock('@/components/features/whatsapp/AudioRecorderButton', `import React,{useEffect} from 'react';${hook}
    export function AudioRecorderButton(p){useEffect(()=>{h().recorderMounts++;return()=>h().recorderUnmounts++;},[]);
    return React.createElement('button',{'aria-label':'Gravar áudio','data-context':p.contextKey,
      onClick:()=>{p.onActiveChange?.(true);if(h().sendAudioGesture)h().lastAudio=p.onSend('c3ludGhldGlj','audio/webm;codecs=opus',{clientMessageId:'audio-gesture-original',contextKey:p.contextKey}).then(result=>h().audioResult=result);}},'Microfone');}`);
  await mock('@/components/features/leads/CreateLeadDialog', `import React from 'react';export const CreateLeadDialog=p=>p.open?React.createElement('div',{'data-create-lead':true,'data-future-only':p.futureOnly,'data-conversation-id':p.conversationId,'data-expected-lead':p.expectedPreviousLeadId,'data-confirm-history-link':p.confirmHistoryLink},p.contactName):null;`);
  await mock('@/components/features/whatsapp/MessageBubble', `import React from 'react';export const MessageBubble=p=>React.createElement('div',{'data-message-id':p.messageId},p.content,p.onReply&&React.createElement('button',{onClick:()=>p.onReply()},'Responder mensagem'),p.onCheckSend&&React.createElement('button',{onClick:()=>p.onCheckSend()},'Verificar envio'));`);
  await mock('@/components/features/whatsapp/conversations$', `
    export * from ${JSON.stringify(join(repository,'components/features/whatsapp/conversations/conversation-model.ts'))};
    export * from ${JSON.stringify(join(repository,'components/features/whatsapp/conversations/conversation-list-position.ts'))};
    export { ConversationComposer } from ${JSON.stringify(join(repository,'components/features/whatsapp/conversations/ConversationComposer.tsx'))};
    export { ConversationOverlays } from ${JSON.stringify(join(repository,'components/features/whatsapp/conversations/ConversationOverlays.tsx'))};
    export { MobileConversationHeader } from ${JSON.stringify(join(repository,'components/features/whatsapp/conversations/MobileConversationHeader.tsx'))};
    import React,{useEffect} from 'react';
    import {ConversationMessages as ActualMessages} from ${JSON.stringify(join(repository,'components/features/whatsapp/conversations/ConversationMessages.tsx'))};
    export const ConversationListItem=p=>React.createElement('button',{onClick:p.onClick},'Abrir '+p.conversation.id);
    export const ConversationFilters=()=>null;
    export const ConversationEmptyState=()=>null;
    export const ConversationMessages=p=>{useEffect(()=>{window.harness.screenSelection=p.conversation.id;});return window.harness.scrollScenario?React.createElement('div',{'data-screen-chat':p.conversation.id,'data-layout':p.layout},React.createElement(ActualMessages,p)):React.createElement('div',{'data-screen-chat':p.conversation.id},p.conversation.id);};
    export const ConversationList=p=>React.createElement('div',null,p.conversations.map(c=>React.createElement('button',{key:c.id,onClick:()=>p.onSelect(c)},'Abrir '+c.id)));`);
  const files = {
    Context:'contexts/FloatingChatContext.tsx', Floating:'components/features/chat/FloatingChat.tsx',
    Panel:'components/features/whatsapp/ConversationLeadPanel.tsx',Composer:'components/features/whatsapp/conversations/ConversationComposer.tsx',
    QR:'components/features/settings/WhatsAppTab.tsx',Overlays:'components/features/whatsapp/conversations/ConversationOverlays.tsx',
    Screen:'components/features/whatsapp/ConversationsScreen.tsx',
  };
  const sources = {};
  for (const [name,path] of Object.entries(files)) {
    const snapshot = snapshotDirectory && ['Floating', 'Screen', 'Thread'].includes(name)
      ? join(snapshotDirectory, path) : null;
    if (snapshot || baseline || (scrollBaseline && name==='Screen')) {
      const copy = join(directory, `${name}.tsx`);
      await writeFile(copy, await readFile(snapshot || join(name==='Screen'&&scrollBaseline?scrollBaseline:baseline, `${path.replaceAll('/','__')}.before`),'utf8'));
      sources[name] = copy;
      // Relative production imports in copied legacy files resolve in place.
      const original = dirname(join(repository,path));
      for (const [,relative] of (await readFile(copy,'utf8')).matchAll(/from\s+["'](\.[^"']+)["']/g)) aliases[relative]=resolve(original,relative);
    } else sources[name]=join(repository,path);
  }
  aliases['@/contexts/FloatingChatContext']=sources.Context;
  const loader=join(directory,'loader.cjs');
  await writeFile(loader,`const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;`);
  const entry=join(directory,'entry.js');
  await writeFile(entry,`
    import React,{useEffect} from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
    import{QueryClient,QueryClientProvider}from'@tanstack/react-query';
    import{VimobAPIError}from'@/lib/api/vimob-error';
    import{FloatingChatProvider,useFloatingChat}from${JSON.stringify(sources.Context)};
    import{FloatingChat}from${JSON.stringify(sources.Floating)};
    import{ConversationLeadPanel}from${JSON.stringify(sources.Panel)};
    import{ConversationComposer}from${JSON.stringify(sources.Composer)};
    import{WhatsAppTab}from${JSON.stringify(sources.QR)};
    import{ConversationOverlays}from${JSON.stringify(sources.Overlays)};
    import ConversationsScreen from${JSON.stringify(sources.Screen)};
    const root=createRoot(document.getElementById('root'));const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
    const noop=()=>{};const h=window.harness={scope:{userId:'user-a',organizationId:'org-a',accessScope:'own'},
      auth:{profile:{id:'user-a',organization_id:'org-a'},user:{id:'user-a'},organization:{},activeOrganization:{organizationId:'org-a'},userOrganizations:[],isSuperAdmin:false},
      permissions:['lead_operate','whatsapp_view','whatsapp_operate'],mobile:false,requests:[],toasts:[],navigation:[],
      recorderMounts:0,recorderUnmounts:0,mode:'context',leadId:'lead-a',text:'',sending:false,ownerScope:'',conversations:[],
      emptyQuery:{data:[],isLoading:false,isPending:false,isError:false,refetch:noop},mutation:{mutate:noop,mutateAsync:async()=>({}),isPending:false},
      filters:{isHydrated:true,filterApplicationRevision:0,searchQuery:'',source:null,pipelineId:null,teamId:null,userId:null,tagIds:[],dealStatus:null,pageId:null,campaignIds:[],setSearchQuery:noop,setSource:noop,setPipelineId:noop,setTeamId:noop,setUserId:noop,setTagIds:noop,setDealStatus:noop,setPageId:noop,setCampaignIds:noop,clearFilters:noop},
      updateLead:{mutateAsync:async p=>h.requests.push({kind:'feedback',params:p})},
      messages:{messages:[],isLoading:false,isFetching:false,isError:false,refetch:noop},
      attendance:{entries:[],ensureJoined:async()=>true,dialogProps:{open:false}},resolveSend:async()=>'pending',
      send:{mutateAsync:p=>h.request('send',p),isPending:false},qr:{mutateAsync:p=>h.request('qr',p),isPending:false},status:{mutateAsync:p=>h.request('status',p),isPending:false},
      sessions:[{id:'session-a',owner_user_id:'user-a',status:'disconnected',can_send:true,provider:'evolution_go',instance_name:'session-a',display_name:'A'},
        {id:'session-b',owner_user_id:'user-a',status:'disconnected',can_send:true,provider:'evolution_go',instance_name:'session-b',display_name:'B'}],
      request(kind,params){return new Promise((resolve,reject)=>this.requests.push({kind,params,resolve,reject}));},
      phoneError(data){return new VimobAPIError('Confirme a troca do telefone',{status:409,code:'whatsapp_phone_change_confirmation_required',responseData:data});},
      historyError(){return new VimobAPIError('Confira o histórico',{status:409,code:'whatsapp_history_link_required'});},
      deniedStart(){return new VimobAPIError('Atendimento não autorizado',{status:403,code:'forbidden'});},
      inFlight(){return new VimobAPIError('Telefone possui envio em andamento',{status:409,code:'whatsapp_conversation_send_in_flight'});},
      render(mode=this.mode){this.mode=mode;flushSync(()=>root.render(React.createElement(QueryClientProvider,{client},React.createElement(App))));},
      tenant(id){this.scope={...this.scope,organizationId:id};this.auth={...this.auth,activeOrganization:{organizationId:id}};this.render();},
      unmount(){flushSync(()=>root.render(null));},
    };
    h.ownerScope=JSON.stringify([h.scope.userId,h.scope.organizationId,h.scope.accessScope,h.auth.profile.organization_id]);
    function Probe(){const ctx=useFloatingChat();useEffect(()=>{h.ctx=ctx;});return React.createElement('output',null,JSON.stringify(ctx.state));}
    function App(){
      if(h.mode==='panel')return React.createElement(ConversationLeadPanel,{leadId:h.leadId,onClose:noop});
      if(h.mode==='qr')return React.createElement(WhatsAppTab);
      if(h.mode==='screen')return React.createElement(ConversationsScreen,{initialConversationId:h.screenInitialConversationId});
      if(h.mode==='composer')return React.createElement(ConversationComposer,{layout:h.mobile?'mobile':'desktop',fileInputRef:{current:null},onFileSelect:noop,messageText:h.text,onMessageTextChange:v=>{h.text=v;h.render();},onSendMessage:noop,onKeyDown:noop,placeholder:'Mensagem',disabled:false,isSending:h.sending,selectedLeadId:'lead-a',canStartAutomations:false,hasActiveAutomation:false,isLoadingAutomationState:false,isAutomationStateUnavailable:false,isCancellingAutomation:false,audioContextKey:JSON.stringify([h.scope,h.leadId]),audioDisabled:false,onSendAudio:async()=>true});
      if(h.mode==='overlays')return React.createElement(ConversationOverlays,{ownerScopeKey:h.ownerScope,canCreateLeads:true,createLeadOpen:true,onCreateLeadOpenChange:noop,createLeadContact:{name:'Contato A'},onLeadSaved:noop,selectedLeadId:null,selectedConversation:null,showAutomationDialog:false,onAutomationDialogOpenChange:noop,pendingDeleteConversation:{id:'chat-a',contact_name:'Contato A'},isDeletingConversation:false,onDeleteDialogOpenChange:noop,onConfirmDeleteConversation:noop});
      return React.createElement(FloatingChatProvider,null,React.createElement(Probe),h.mode==='floating'&&React.createElement(FloatingChat));
    }
  `);
  await new Promise((resolveBuild,rejectBuild)=>{
    const compiler=webpack({mode:'development',target:'web',entry,output:{path:directory,filename:'ui.js',publicPath:''},
      resolve:{symlinks:false,extensions:['.ts','.tsx','.js'],modules:[join(repository,'node_modules'),'node_modules'],alias:{...aliases,'@':repository}},
      module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:loader}]}});
    compiler.run((error,stats)=>compiler.close(()=>error?rejectBuild(error):stats.hasErrors()?rejectBuild(new Error(stats.toString({all:false,errors:true}))):resolveBuild()));
  });
  bundle=await readFile(join(directory,'ui.js'),'utf8');browser=await chromium.launch({headless:true});
},{timeout:300_000});
after(async()=>{await browser?.close();if(directory){assert.ok(resolve(directory).startsWith(resolve(tmpdir()))&&basename(directory).startsWith('vimob-whatsapp-ui-'));await rm(directory,{recursive:true,force:true});}});
async function harness(t,mode){const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.abort());t.after(async()=>{try{assert.deepEqual(errors,[]);}finally{await page.close();}});await page.setContent('<div id="root"></div>');await page.evaluate(()=>{window.process={env:{NODE_ENV:'development'}};const values=new Map();Object.defineProperty(window,'localStorage',{value:{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k),clear:()=>values.clear()},configurable:true});});await page.addScriptTag({content:bundle});assert.equal(await page.evaluate(()=>typeof window.harness),'object',errors.join('\n'));await page.evaluate(mode=>window.harness.render(mode),mode);await page.waitForTimeout(30);assert.deepEqual(errors,[]);return page;}
const conversation=(id,lead)=>({id,lead_id:lead,lead:{id:lead,name:lead},contact_phone:'+5511999998888',remote_jid:'5511999998888@s.whatsapp.net',session_id:'session-a',is_group:false,unread_count:0});

async function confirmAttachments(page) {
  if (!baseline && !snapshotDirectory && !scrollBaseline) {
    await page.getByRole('button', {name:'Enviar arquivo', exact:true}).click();
  }
}
for (const mode of ['screen', 'floating']) {
  test(`actual ${mode} file chooser from A cannot submit its selection after switching to B`, async t => {
    const page=await harness(t,mode);
    await page.evaluate(conversations=>{const h=window.harness;h.sessions=[{...h.sessions[0],status:'connected'}];h.conversations=conversations;h.render();if(h.mode==='floating')h.ctx.openConversation(conversations[0]);},[conversation('chat-a','lead-a'),conversation('chat-b','lead-b')]);
    if(mode==='screen')await page.getByRole('button',{name:'Abrir chat-a',exact:true}).click();
    await page.evaluate(()=>window.harness.oldPicker=document.querySelector('input[type=file]'));
    if(mode==='screen')await page.getByRole('button',{name:'Abrir chat-b',exact:true}).click();
    else await page.evaluate(c=>window.harness.ctx.openConversation(c),conversation('chat-b','lead-b'));
    await page.evaluate(()=>{const h=window.harness;const transfer=new DataTransfer();transfer.items.add(new File(['synthetic file'],'ficha.pdf',{type:'application/pdf'}));h.oldPicker.files=transfer.files;h.oldPicker.dispatchEvent(new Event('change',{bubbles:true}));});
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(()=>window.harness.requests.filter(r=>r.kind==='send').length),0);
  });
  test(`actual ${mode} uncertain file send has one confirmation notice and no contradictory failure`, async t => {
    const page=await harness(t,mode);
    await page.evaluate(c=>{const h=window.harness;h.sessions=[{...h.sessions[0],status:'connected'}];h.conversations=[c];h.render();if(h.mode==='floating')h.ctx.openConversation(c);},conversation('chat-a','lead-a'));
    if(mode==='screen')await page.getByRole('button',{name:'Abrir chat-a',exact:true}).click();
    await page.locator('input[type=file]').first().setInputFiles({name:'ficha.pdf',mimeType:'application/pdf',buffer:Buffer.from('synthetic file')});
    await confirmAttachments(page);
    await page.waitForFunction(()=>window.harness.requests.some(r=>r.kind==='send'));
    assert.equal(await page.evaluate(()=>window.harness.requests.find(r=>r.kind==='send').params.fileIntentSource instanceof File),true);
    await page.evaluate(()=>{const h=window.harness;h.toasts.push({title:'Confirmando envio'});h.requests.find(r=>r.kind==='send').reject(new TypeError('response lost'));});
    await page.waitForFunction(()=>document.querySelector('input[type=file]').value==='');
    assert.deepEqual(await page.evaluate(()=>window.harness.toasts.map(t=>t.title)),['Confirmando envio']);
  });
  test(`actual ${mode} file status verification does not announce a second queued send`, async t => {
    const page=await harness(t,mode);
    await page.evaluate(c=>{const h=window.harness;h.sessions=[{...h.sessions[0],status:'connected'}];h.conversations=[c];h.render();if(h.mode==='floating')h.ctx.openConversation(c);},conversation('chat-a','lead-a'));
    if(mode==='screen')await page.getByRole('button',{name:'Abrir chat-a',exact:true}).click();
    await page.locator('input[type=file]').first().setInputFiles({name:'ficha.pdf',mimeType:'application/pdf',buffer:Buffer.from('synthetic file')});
    await confirmAttachments(page);
    await page.waitForFunction(()=>window.harness.requests.some(r=>r.kind==='send'));
    await page.evaluate(()=>{const h=window.harness;h.toasts.push({title:'Envio verificado'});h.requests.find(r=>r.kind==='send').resolve({status:'confirming',fileIntentChecked:true});});
    await page.waitForTimeout(30);
    assert.deepEqual(await page.evaluate(()=>window.harness.toasts.map(t=>t.title)),['Envio verificado']);
  });
  for (const navigation of ['A-B', 'A-B-A', 'unmount']) {
    test(`actual ${mode} audio completion after ${navigation} cannot emit stale queued notice`, async t => {
      const page=await harness(t, mode);
      await page.evaluate(conversations=>{const h=window.harness;h.sendAudioGesture=true;h.sessions=[{...h.sessions[0],status:'connected'}];h.conversations=conversations;h.render();if(h.mode==='floating')h.ctx.openConversation(conversations[0]);},[conversation('chat-a','lead-a'),conversation('chat-b','lead-b')]);
      if(mode==='screen')await page.getByRole('button',{name:'Abrir chat-a',exact:true}).click();
      await page.getByRole('button',{name:'Gravar áudio',exact:true}).click();
      await page.waitForFunction(()=>window.harness.requests.some(r=>r.kind==='send'));
      if(navigation==='unmount')await page.evaluate(()=>window.harness.unmount());
      else {
        if(mode==='screen')await page.getByRole('button',{name:'Abrir chat-b',exact:true}).click();
        else await page.evaluate(c=>window.harness.ctx.openConversation(c),conversation('chat-b','lead-b'));
        await page.waitForTimeout(25);
        if(navigation==='A-B-A') {
          if(mode==='screen')await page.getByRole('button',{name:'Abrir chat-a',exact:true}).click();
          else await page.evaluate(c=>window.harness.ctx.openConversation(c),conversation('chat-a','lead-a'));
        }
      }
      await page.evaluate(()=>window.harness.requests.find(r=>r.kind==='send').resolve({status:'queued'}));
      await page.waitForFunction(()=>window.harness.audioResult!==undefined);
      assert.equal(await page.evaluate(()=>window.harness.audioResult.state),'cancelled');
      assert.equal(await page.evaluate(()=>window.harness.toasts.filter(t=>t.title==='Áudio na fila').length),0);
      assert.equal(await page.evaluate(()=>window.harness.requests.filter(r=>r.kind==='send').length),1);
    });
  }
  test(`actual ${mode} current audio completion retains normal queued feedback`, async t => {
    const page=await harness(t,mode);
    await page.evaluate(c=>{const h=window.harness;h.sendAudioGesture=true;h.sessions=[{...h.sessions[0],status:'connected'}];h.conversations=[c];h.render();if(h.mode==='floating')h.ctx.openConversation(c);},conversation('chat-a','lead-a'));
    if(mode==='screen')await page.getByRole('button',{name:'Abrir chat-a',exact:true}).click();
    await page.getByRole('button',{name:'Gravar áudio',exact:true}).click();await page.waitForFunction(()=>window.harness.requests.some(r=>r.kind==='send'));
    await page.evaluate(()=>window.harness.requests.find(r=>r.kind==='send').resolve({status:'queued'}));await page.waitForFunction(()=>window.harness.audioResult!==undefined);
    assert.equal(await page.evaluate(()=>window.harness.audioResult.state),'queued');
    assert.equal(await page.evaluate(()=>window.harness.toasts.filter(t=>t.title==='Áudio na fila').length),1);
  });
  for (const deliveryCode of ['outcome_unknown', 'recipient_not_registered']) {
    test(`actual ${mode} audio canonical ${deliveryCode} never claims a queued success`, async t => {
      const page=await harness(t,mode);
      await page.evaluate(c=>{const h=window.harness;h.sendAudioGesture=true;h.sessions=[{...h.sessions[0],status:'connected'}];h.conversations=[c];h.render();if(h.mode==='floating')h.ctx.openConversation(c);},conversation('chat-a','lead-a'));
      if(mode==='screen')await page.getByRole('button',{name:'Abrir chat-a',exact:true}).click();
      await page.getByRole('button',{name:'Gravar áudio',exact:true}).click();await page.waitForFunction(()=>window.harness.requests.some(r=>r.kind==='send'));
      await page.evaluate(code=>window.harness.requests.find(r=>r.kind==='send').resolve({status:'failed',message:{status:'failed',delivery_error_code:code}}),deliveryCode);
      await page.waitForFunction(()=>window.harness.audioResult!==undefined);
      const result=await page.evaluate(()=>window.harness.audioResult);
      if(deliveryCode==='outcome_unknown')assert.deepEqual(result,{state:'unconfirmed',clientMessageId:'audio-gesture-original'});
      else assert.equal(result,false);
      assert.equal(await page.evaluate(()=>window.harness.toasts.filter(t=>t.title==='Áudio na fila').length),0);
      assert.equal(await page.evaluate(()=>window.harness.requests.filter(r=>r.kind==='send').length),1);
    });
  }
}
const phoneChangeRefs={conversationId:'10000000-0000-4000-8000-000000000001',leadId:'20000000-0000-4000-8000-000000000001',sessionId:'30000000-0000-4000-8000-000000000001'};
const destinationConversationId='40000000-0000-4000-8000-000000000001';
const destinationPreview={conversationId:destinationConversationId,sessionId:phoneChangeRefs.sessionId,leadId:phoneChangeRefs.leadId,expectedPreviousLeadId:'unlinked',bindingMode:'active',sessionDisplayName:'WhatsApp sintético A',contactDisplayName:'Novo telefone P2',eligibleMessageCount:2,firstEligibleAt:'2026-10-11T12:00:00Z',lastEligibleAt:'2026-10-11T13:00:00Z',expiresAt:null};
async function preparePhoneChange(t,refs=phoneChangeRefs){
  const page=await harness(t,'floating');
  await page.evaluate(refs=>{window.harness.sessions=[{...window.harness.sessions[0],id:refs.sessionId,status:'connected'}];window.harness.render();window.harness.ctx.openNewChatWithMessage('+5511999997777','Rascunho P2',refs.leadId);},phoneChangeRefs);
  await page.waitForFunction(()=>window.harness.requests.length===1);
  await page.evaluate(()=>window.harness.requests[0].resolve(null));
  await page.waitForFunction(()=>window.harness.requests.length===2);
  await page.evaluate(()=>window.harness.requests[1].resolve(null));
  await page.waitForFunction(()=>window.harness.requests.length===3);
  await page.evaluate(refs=>window.harness.requests[2].reject(window.harness.phoneError(refs)),refs);
  return page;
}
async function prepareDestinationPhoneChange(t){
  const page=await harness(t,'floating');
  await page.evaluate(refs=>{window.harness.sessions=[{...window.harness.sessions[0],id:refs.sessionId,status:'connected'}];window.harness.render();window.harness.ctx.openNewChatWithMessage('+5511999997777','Rascunho P2',refs.leadId);},phoneChangeRefs);
  await page.waitForFunction(()=>window.harness.requests.length===1);
  await page.evaluate(()=>window.harness.requests[0].resolve(null));
  await page.waitForFunction(()=>window.harness.requests.length===2);
  await page.evaluate(c=>window.harness.requests[1].resolve(c),{...conversation(destinationConversationId,null),lead:null,session_id:phoneChangeRefs.sessionId,contact_phone:'+5511999997777',remote_jid:'5511999997777@s.whatsapp.net'});
  await page.waitForFunction(()=>window.harness.requests.length===3);
  assert.equal(await page.evaluate(()=>window.harness.requests[2].kind),'start');
  assert.equal(await page.evaluate(()=>window.harness.requests[2].params.expectedPreviousLeadId),phoneChangeRefs.leadId);
  await page.evaluate(refs=>window.harness.requests[2].reject(window.harness.phoneError({...refs,destinationConversationId:'40000000-0000-4000-8000-000000000001',requiresDestinationHistoryConfirmation:true})),phoneChangeRefs);
  await page.waitForFunction(()=>window.harness.requests.some(r=>r.kind==='preview'));
  return page;
}

test('existing P2 history is previewed before one explicit combined transition; no ordinary link is called',async t=>{
  const page=await prepareDestinationPhoneChange(t);
  const confirm=page.getByRole('button',{name:'Confirmar novo telefone e anexar histórico',exact:true});
  assert.equal(await confirm.isDisabled(),true);
  assert.deepEqual(await page.evaluate(()=>window.harness.requests.find(r=>r.kind==='preview').params),{id:destinationConversationId,previousLead:'unlinked',lead:phoneChangeRefs.leadId,organizationId:'org-a'});
  await page.evaluate(p=>window.harness.requests.find(r=>r.kind==='preview').resolve(p),destinationPreview);
  await page.getByText('Mensagens preservadas: 2',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.harness.requests.filter(r=>r.kind==='start').length),1);
  await confirm.click();
  await page.waitForFunction(()=>window.harness.requests.filter(r=>r.kind==='start').length===2);
  const params=await page.evaluate(()=>window.harness.requests.filter(r=>r.kind==='start')[1].params);
  assert.deepEqual({old:params.expectedPreviousConversationId,lead:params.expectedPreviousLeadId,destination:params.expectedDestinationConversationId,phone:params.confirmPhoneChange,history:params.confirmDestinationHistory},{old:phoneChangeRefs.conversationId,lead:phoneChangeRefs.leadId,destination:destinationConversationId,phone:true,history:true});
  await page.evaluate(c=>window.harness.requests.filter(r=>r.kind==='start')[1].resolve(c),{...conversation(destinationConversationId,phoneChangeRefs.leadId),session_id:phoneChangeRefs.sessionId,contact_phone:'+5511999997777'});
  await page.waitForFunction(()=>window.harness.ctx.state.activeConversation?.id==='40000000-0000-4000-8000-000000000001');
  assert.equal(await page.evaluate(()=>window.harness.requests.filter(r=>r.kind==='link'||r.kind==='send').length),0);
});
test('combined transition rejects a preview from another conversation without retiring P1',async t=>{
  const page=await prepareDestinationPhoneChange(t);
  await page.evaluate(p=>window.harness.requests.find(r=>r.kind==='preview').resolve(p),{...destinationPreview,conversationId:'40000000-0000-4000-8000-000000000002'});
  await page.getByText('Não foi possível validar o histórico do novo número. O atendimento anterior será preservado.',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Confirmar novo telefone e anexar histórico',exact:true}).isDisabled(),true);
  assert.equal(await page.evaluate(()=>window.harness.requests.filter(r=>r.kind==='start').length),1);
  assert.equal(await page.evaluate(()=>window.harness.requests.filter(r=>r.kind==='link'||r.kind==='send').length),0);
});
test('combined transition ignores late destination preview after navigating to B',async t=>{
  const page=await prepareDestinationPhoneChange(t);
  await page.evaluate(c=>window.harness.ctx.openConversation(c),conversation('chat-b','lead-b'));
  await page.waitForFunction(()=>window.harness.ctx.state.activeConversation?.id==='chat-b');
  await page.evaluate(p=>window.harness.requests.find(r=>r.kind==='preview').resolve(p),destinationPreview);
  await page.waitForTimeout(40);
  assert.equal(await page.getByText('Mensagens preservadas: 2',{exact:true}).count(),0);
  assert.equal(await page.evaluate(()=>window.harness.ctx.state.activeConversation?.id),'chat-b');
  assert.equal(await page.evaluate(()=>window.harness.requests.filter(r=>r.kind==='start').length),1);
});
for (const futureOnly of [false, true]) test(
  futureOnly ? 'neutral legacy link confirms future-only mode without sending' : 'ordinary unlinked history still requires its own preview and explicit link when no phone transition exists', async t=>{
  const page=await prepareDestinationPhoneChange(t);
  // A separate fresh intent receives history_required instead of old-route references.
  await page.evaluate(()=>window.harness.ctx.openNewChatWithMessage('+5511999997777','Sem rota P1',window.harness.requests[2].params.leadId));
  await page.waitForFunction(()=>window.harness.requests.filter(r=>r.kind==='find').length===3);
  await page.evaluate(()=>window.harness.requests.filter(r=>r.kind==='find')[2].resolve(null));
  await page.waitForFunction(()=>window.harness.requests.filter(r=>r.kind==='find').length===4);
  await page.evaluate(c=>window.harness.requests.filter(r=>r.kind==='find')[3].resolve(c),{...conversation(destinationConversationId,null),lead:null,session_id:phoneChangeRefs.sessionId,contact_phone:'+5511999997777'});
  await page.waitForFunction(()=>window.harness.requests.filter(r=>r.kind==='start').length===2);
  await page.evaluate(()=>window.harness.requests.filter(r=>r.kind==='start')[1].reject(window.harness.historyError()));
  await page.waitForFunction(()=>window.harness.requests.filter(r=>r.kind==='preview').length===2);
  const preview = futureOnly ? {...destinationPreview,futureOnly:true,eligibleMessageCount:0,firstEligibleAt:null,lastEligibleAt:null,expiresAt:null} : destinationPreview;
  await page.evaluate(p=>window.harness.requests.filter(r=>r.kind==='preview')[1].resolve(p),preview);
  const confirm = page.getByRole('button',{name:futureOnly?'Vincular para as próximas mensagens':'Vincular e anexar histórico',exact:true});
  await confirm.waitFor();
  assert.equal(await page.evaluate(()=>window.harness.requests.filter(r=>r.kind==='link').length),0);
  await confirm.click();
  await page.waitForFunction(()=>window.harness.requests.some(r=>r.kind==='link'));
  assert.equal(await page.evaluate(()=>window.harness.requests.find(r=>r.kind==='link').params.futureOnly),futureOnly ? true : undefined);
  assert.equal(await page.evaluate(()=>window.harness.requests.filter(r=>r.kind==='send').length),0);
});

test('Central create lead carries the confirmed future-only conversation into the form', async t=>{
  const page = await harness(t, 'screen');
  await page.evaluate(c=>{
    const h = window.harness;
    h.permissions.push('lead_create');
    h.sessions = [{...h.sessions[0], status:'connected'}];
    h.conversations = [c];
    h.render();
  }, {...conversation('chat-legacy',null), lead:null, contact_name:'Contato sintético'});
  await page.getByRole('button',{name:'Abrir chat-legacy',exact:true}).click();
  await page.getByRole('button',{name:'Mais ações da conversa',exact:true}).click();
  await page.getByRole('menuitem',{name:'Criar lead',exact:true}).click();
  await page.waitForFunction(()=>window.harness.requests.some(r=>r.kind==='preview'));
  assert.equal(await page.locator('[data-create-lead]').count(),0);
  await page.evaluate(p=>window.harness.requests.find(r=>r.kind==='preview').resolve(p), {
    ...destinationPreview, conversationId:'chat-legacy',sessionId:'session-a',leadId:null,
    futureOnly:true,eligibleMessageCount:0,firstEligibleAt:null,lastEligibleAt:null,expiresAt:null,
  });
  await page.getByText('Cadastrar e vincular para as próximas mensagens?',{exact:true}).waitFor();
  await page.getByText(/o vínculo inicia o atendimento e as próximas respostas chegam ao CRM/).waitFor();
  await page.getByRole('button',{name:'Continuar para cadastro',exact:true}).click();
  const form = page.locator('[data-create-lead]');
  await form.waitFor();
  assert.equal(await form.getAttribute('data-future-only'),'true');
  assert.equal(await form.getAttribute('data-conversation-id'),'chat-legacy');
  assert.equal(await form.getAttribute('data-expected-lead'),'unlinked');
  assert.equal(await form.getAttribute('data-confirm-history-link'),'true');
  assert.equal(await page.evaluate(()=>window.harness.requests.filter(r=>r.kind==='link'||r.kind==='send').length),0);
});

for (const mode of ['screen', 'floating']) {
  test(`${mode} opens the exact owned route without starting attendance until the explicit click`, async t => {
    const page = await harness(t, mode);
    const route = conversation('chat-a', 'lead-a');
    route.lead.assignee = {id:'user-a',name:'Responsável'};
    await page.evaluate(c=>{
      const h=window.harness;
      h.sessions=[{...h.sessions[0],status:'connected'}];
      h.attendance.attendance={joined:false};
      h.conversations=[c];
      h.render();
      if(h.mode==='floating') h.ctx.openConversation(c);
    }, route);
    if (mode === 'screen') await page.getByRole('button',{name:'Abrir chat-a',exact:true}).click();
    const action = page.getByRole('button',{name:'Iniciar atendimento neste WhatsApp',exact:true});
    await action.waitFor();
    assert.equal(await page.evaluate(()=>window.harness.requests.some(r=>r.kind==='start')),false);
    await action.click();
    await page.waitForFunction(()=>window.harness.requests.some(r=>r.kind==='lead-phone'));
    await page.evaluate(()=>{
      const h=window.harness;
      h.requests.find(r=>r.kind==='lead-phone').resolve({id:'lead-a',organization_id:'org-a',assigned_user_id:'user-a',
        name:'Lead sintético',phone:'+5511999998888'});
    });
    await page.waitForFunction(()=>window.harness.requests.some(r=>r.kind==='find'));
    assert.equal(await page.evaluate(()=>window.harness.requests.some(r=>r.kind==='start')),false);
    await page.evaluate(c=>window.harness.requests.find(r=>r.kind==='find').resolve(c),route);
    await page.waitForFunction(()=>window.harness.requests.some(r=>r.kind==='start'));
    const start = await page.evaluate(()=>{
      const h=window.harness;
      const r=h.requests.find(item=>item.kind==='start');
      h.attendance.attendance={joined:true};
      h.render();
      return r.params;
    });
    assert.equal(start.startAttendance,true);
    assert.equal(start.ownSessionOnly,true);
    assert.equal(start.sessionId,'session-a');
    assert.equal(start.leadId,'lead-a');
    assert.equal(start.expectedPreviousLeadId,'lead-a');
    assert.equal(start.confirmPhoneChange,undefined);
    await page.evaluate(c=>window.harness.requests.find(r=>r.kind==='start').resolve(c),route);
    await action.waitFor({state:'hidden'});
    assert.equal(await page.evaluate(()=>window.harness.requests.filter(r=>r.kind==='start').length),1);
    assert.equal(await page.evaluate(()=>window.harness.requests.some(r=>r.kind==='send')),false);
  });
}

test('phone transition requires an explicit confirmation with exact authorized references and sends nothing',async t=>{
  const page=await preparePhoneChange(t);
  await page.getByText('Confirmar novo telefone do atendimento?',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.harness.requests.length),3);
  await page.getByRole('button',{name:'Confirmar novo telefone',exact:true}).click();
  await page.waitForFunction(()=>window.harness.requests.length===4);
  const params=await page.evaluate(()=>window.harness.requests[3].params);
  assert.deepEqual({phone:params.phone,leadId:params.leadId,sessionId:params.sessionId,previousLead:params.expectedPreviousLeadId,previousConversation:params.expectedPreviousConversationId,confirm:params.confirmPhoneChange},{phone:'+5511999997777',leadId:phoneChangeRefs.leadId,sessionId:phoneChangeRefs.sessionId,previousLead:phoneChangeRefs.leadId,previousConversation:phoneChangeRefs.conversationId,confirm:true});
  const fresh={...conversation('40000000-0000-4000-8000-000000000001',phoneChangeRefs.leadId),session_id:phoneChangeRefs.sessionId,contact_phone:'+5511999997777',remote_jid:'5511999997777@s.whatsapp.net'};
  await page.evaluate(c=>window.harness.requests[3].resolve(c),fresh);
  await page.waitForFunction(()=>window.harness.ctx.state.activeConversation?.id==='40000000-0000-4000-8000-000000000001');
  assert.equal(await page.getByRole('textbox',{name:'Digite sua mensagem'}).inputValue(),'Rascunho P2');
  assert.equal(await page.evaluate(()=>window.harness.requests.filter(r=>r.kind==='send'||r.kind==='link').length),0);
});
test('phone transition cancellation never starts or sends the new route',async t=>{
  const page=await preparePhoneChange(t);
  await page.getByText('Confirmar novo telefone do atendimento?',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();
  assert.equal(await page.getByText('Confirmar novo telefone do atendimento?',{exact:true}).count(),0);
  assert.equal(await page.evaluate(()=>window.harness.requests.length),3);
  assert.equal(await page.evaluate(()=>window.harness.ctx.state.pendingMessage),null);
});
test('phone transition send-in-flight explains waiting, preserves the prompt and never retries automatically',async t=>{
  const page=await preparePhoneChange(t);
  await page.getByRole('button',{name:'Confirmar novo telefone',exact:true}).click();
  await page.waitForFunction(()=>window.harness.requests.length===4);
  await page.evaluate(()=>window.harness.requests[3].reject(window.harness.inFlight()));
  await page.getByText('Aguarde a confirmação do envio em andamento antes de trocar o telefone desta conversa.',{exact:true}).waitFor();
  await page.waitForTimeout(50);
  assert.equal(await page.getByText('Confirmar novo telefone do atendimento?',{exact:true}).count(),1);
  assert.equal(await page.evaluate(()=>window.harness.requests.length),4);
  assert.equal(await page.evaluate(()=>window.harness.ctx.state.activeConversation),null);
  assert.equal(await page.evaluate(()=>window.harness.requests.filter(r=>r.kind==='send'||r.kind==='link').length),0);
});
test('phone transition pending response cannot displace a later conversation or revive its prefill',async t=>{
  const page=await preparePhoneChange(t);
  await page.getByRole('button',{name:'Confirmar novo telefone',exact:true}).click();
  await page.waitForFunction(()=>window.harness.requests.length===4);
  await page.evaluate(c=>window.harness.ctx.openConversation(c),{...conversation('chat-b','lead-b'),session_id:phoneChangeRefs.sessionId});
  await page.waitForFunction(()=>window.harness.ctx.state.activeConversation?.id==='chat-b');
  await page.evaluate(c=>window.harness.requests[3].resolve(c),conversation('chat-old-intent',phoneChangeRefs.leadId));
  await page.waitForTimeout(40);
  assert.equal(await page.evaluate(()=>window.harness.ctx.state.activeConversation?.id),'chat-b');
  assert.equal(await page.getByRole('textbox',{name:'Digite sua mensagem'}).inputValue(),'');
  assert.equal(await page.getByText('Confirmar novo telefone do atendimento?',{exact:true}).count(),0);
});
test('phone transition rejects valid references belonging to another lead',async t=>{
  const page=await preparePhoneChange(t,{...phoneChangeRefs,leadId:'20000000-0000-4000-8000-000000000002'});
  await page.waitForFunction(()=>window.harness.ctx.state.pendingPhone===null);
  assert.equal(await page.getByText('Confirmar novo telefone do atendimento?',{exact:true}).count(),0);
  assert.equal(await page.evaluate(()=>window.harness.requests.length),3);
});
test('phone transition prompt disappears when operation permission is revoked',async t=>{
  const page=await preparePhoneChange(t);
  await page.getByRole('button',{name:'Confirmar novo telefone',exact:true}).waitFor();
  await page.evaluate(()=>{window.harness.permissions=['whatsapp_view'];window.harness.render();});
  assert.equal(await page.getByRole('button',{name:'Confirmar novo telefone',exact:true}).count(),0);
  assert.equal(await page.evaluate(()=>window.harness.requests.length),3);
});
test('assigned lead intent can start on a shared session explicitly authorized for sending',async t=>{
  const page=await harness(t,'floating');
  await page.evaluate(()=>{window.harness.sessions=[{...window.harness.sessions[0],owner_user_id:'admin-original',status:'connected',can_send:true}];window.harness.render();window.harness.ctx.openNewChatWithMessage('+5511999997777','Lead compartilhado','lead-a');});
  await page.waitForFunction(()=>window.harness.requests.length===1);
  assert.equal(await page.evaluate(()=>window.harness.requests[0].params.sessionId),'session-a');
  await page.evaluate(()=>window.harness.requests[0].resolve(null));
  await page.waitForFunction(()=>window.harness.requests.length===2);
  await page.evaluate(()=>window.harness.requests[1].resolve(null));
  await page.waitForFunction(()=>window.harness.requests.length===3);
  assert.equal(await page.evaluate(()=>window.harness.requests[2].kind),'start');
  assert.equal(await page.evaluate(()=>window.harness.requests[2].params.sessionId),'session-a');
  await page.evaluate(c=>window.harness.requests[2].resolve(c),conversation('shared-chat','lead-a'));
  await page.waitForFunction(()=>window.harness.ctx.state.activeConversation?.id==='shared-chat');
  assert.equal(await page.evaluate(()=>window.harness.requests.filter(r=>r.kind==='send').length),0);
});
test('shared session cannot start an unknown contact without a lead',async t=>{
  const page=await harness(t,'floating');
  await page.evaluate(()=>{window.harness.sessions=[{...window.harness.sessions[0],owner_user_id:'admin-original',status:'connected',can_send:true}];window.harness.render();window.harness.ctx.openNewChatWithMessage('+5511999997777','Contato sem lead');});
  await page.waitForFunction(()=>window.harness.toasts.length>0);
  assert.equal(await page.evaluate(()=>window.harness.requests.length),0);
});
test('shared lead start denied by the server cannot open a composer or send a message',async t=>{
  const page=await harness(t,'floating');
  await page.evaluate(()=>{window.harness.sessions=[{...window.harness.sessions[0],owner_user_id:'admin-original',status:'connected',can_send:true}];window.harness.render();window.harness.ctx.openNewChatWithMessage('+5511999997777','Lead sem responsável elegível','lead-a');});
  await page.waitForFunction(()=>window.harness.requests.length===1);
  await page.evaluate(()=>window.harness.requests[0].resolve(null));
  await page.waitForFunction(()=>window.harness.requests.length===2);
  await page.evaluate(()=>window.harness.requests[1].resolve(null));
  await page.waitForFunction(()=>window.harness.requests.length===3);
  await page.evaluate(()=>window.harness.requests[2].reject(window.harness.deniedStart()));
  await page.waitForFunction(()=>window.harness.ctx.state.pendingPhone===null);
  assert.equal(await page.evaluate(()=>window.harness.ctx.state.activeConversation),null);
  assert.equal(await page.getByRole('button',{name:'Enviar mensagem'}).count(),0);
  assert.equal(await page.evaluate(()=>window.harness.requests.filter(r=>r.kind==='send'||r.kind==='link').length),0);
});
test('shared session without explicit can_send cannot be selected for a lead start',async t=>{
  const page=await harness(t,'floating');
  await page.evaluate(()=>{window.harness.sessions=[{...window.harness.sessions[0],owner_user_id:'admin-original',status:'connected',can_send:undefined}];window.harness.render();window.harness.ctx.openNewChatWithMessage('+5511999997777','Somente leitura','lead-a');});
  await page.waitForFunction(()=>window.harness.requests.length===1);
  assert.equal(await page.evaluate(()=>window.harness.requests[0].params.sessionId),undefined);
  await page.evaluate(()=>window.harness.requests[0].resolve(null));
  await page.getByText('Conecte o WhatsApp para iniciar o atendimento deste lead',{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>{const s=window.harness.ctx.state;return {phone:s.pendingPhone,leadId:s.pendingLeadId,message:s.pendingMessage};}),{phone:'+5511999997777',leadId:'lead-a',message:'Somente leitura'});
  assert.equal(await page.evaluate(()=>window.harness.ctx.state.activeConversation),null);
  assert.equal(await page.getByRole('textbox',{name:'Digite sua mensagem'}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Enviar mensagem'}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Gravar áudio'}).count(),0);
  assert.equal(await page.evaluate(()=>window.harness.requests.filter(r=>r.kind==='start'||r.kind==='send'||r.kind==='history').length),0);
});
test('session selector includes authorized shared sessions only for the lead intent',async t=>{
  const page=await harness(t,'floating');
  await page.evaluate(()=>{window.harness.sessions=window.harness.sessions.map((s,i)=>({...s,owner_user_id:'admin-original',status:'connected',can_send:true,display_name:i?'Compartilhado B':'Compartilhado A'}));window.harness.render();window.harness.ctx.openNewChatWithMessage('+5511999997777','Selecionar sessão','lead-a');});
  await page.getByRole('button',{name:'session-b',exact:true}).click();
  await page.waitForFunction(()=>window.harness.requests.length===1);
  assert.equal(await page.evaluate(()=>window.harness.requests[0].params.sessionId),'session-b');
  assert.equal(await page.evaluate(()=>window.harness.requests.filter(r=>r.kind==='send').length),0);
});

test('late A cannot replace B or consume B prefill; direct navigation clears pending text',async t=>{
  const page=await harness(t,'context');
  await page.evaluate(()=>window.harness.ctx.openNewChatWithMessage('+5511999998888','Texto A','lead-a'));
  await page.waitForFunction(()=>window.harness.ctx.state.pendingMessage==='Texto A');
  await page.evaluate(()=>{const s=window.harness.ctx.state;window.oldIntent={tenantKey:s.intentTenantKey,generation:s.intentGeneration};window.harness.ctx.openNewChatWithMessage('+5511999997777','Texto B','lead-b');});
  await page.waitForFunction(()=>window.harness.ctx.state.pendingMessage==='Texto B');
  await page.evaluate(c=>window.harness.ctx.openConversation(c,window.oldIntent),conversation('chat-a','lead-a'));
  assert.equal(await page.evaluate(()=>window.harness.ctx.state.activeConversation?.id??null),null);
  assert.equal(await page.evaluate(()=>window.harness.ctx.state.pendingMessage),'Texto B');
  await page.evaluate(c=>{const s=window.harness.ctx.state;window.harness.ctx.openConversation(c,{tenantKey:s.intentTenantKey,generation:s.intentGeneration});},conversation('chat-b','lead-b'));
  await page.waitForFunction(()=>window.harness.ctx.state.activeConversation?.id==='chat-b');
  assert.equal(await page.evaluate(()=>window.harness.ctx.state.pendingMessageConversationId),'chat-b');
  await page.evaluate(c=>window.harness.ctx.openConversation(c),conversation('chat-c','lead-c'));
  await page.waitForFunction(()=>window.harness.ctx.state.activeConversation?.id==='chat-c');
  assert.equal(await page.evaluate(()=>window.harness.ctx.state.pendingMessage),null);
});
test('tenant A to B to A never revives an old intent or clears a new prefill',async t=>{
  const page=await harness(t,'context');
  await page.evaluate(()=>window.harness.ctx.openNewChatWithMessage('+5511999998888','A','lead-a'));
  await page.waitForFunction(()=>window.harness.ctx.state.pendingMessage==='A');
  await page.evaluate(()=>{const s=window.harness.ctx.state;window.oldIntent={tenantKey:s.intentTenantKey,generation:s.intentGeneration};window.harness.tenant('org-b');window.harness.tenant('org-a');});
  await page.evaluate(()=>window.harness.ctx.openNewChatWithMessage('+5511999997777','Nova A','lead-b'));
  await page.waitForFunction(()=>window.harness.ctx.state.pendingMessage==='Nova A');
  await page.evaluate(c=>{window.harness.ctx.openConversation(c,window.oldIntent);window.harness.ctx.clearPendingMessage(window.oldIntent);},conversation('chat-a','lead-a'));
  assert.equal(await page.evaluate(()=>window.harness.ctx.state.pendingMessage),'Nova A');
  assert.equal(await page.evaluate(()=>window.harness.ctx.state.activeConversation),null);
});
test('lead panel drops A feedback before B can submit and does not write either lead',async t=>{
  const page=await harness(t,'panel');const input=page.getByPlaceholder('Registre o feedback sobre atendimento, perfil ou próximos passos...');
  await input.fill('Feedback particular A');
  await page.evaluate(()=>{window.harness.leadId='lead-b';window.harness.render();});
  assert.equal(await input.inputValue(),'');assert.equal(await page.getByRole('button',{name:'Registrar feedback'}).isDisabled(),true);
  assert.equal(await page.evaluate(()=>window.harness.requests.length),0);
});
test('create and delete overlays from another tenant or permission scope are immediately absent',async t=>{
  const page=await harness(t,'overlays');assert.equal(await page.locator('[data-create-lead]').textContent(),'Contato A');
  await page.evaluate(()=>window.harness.tenant('org-b'));
  assert.equal(await page.locator('[data-create-lead]').count(),0);assert.equal(await page.getByText('Remover conversa?',{exact:true}).count(),0);
});
test('desktop recorder stays mounted through text, pending send, and active preview; mobile has recorder',async t=>{
  const page=await harness(t,'composer');assert.equal(await page.getByRole('button',{name:'Gravar áudio'}).count(),1);
  await page.getByRole('button',{name:'Gravar áudio'}).click();
  await page.getByRole('textbox',{name:'Digite sua mensagem'}).fill('Rascunho');
  await page.evaluate(()=>{window.harness.sending=true;window.harness.render();});
  assert.deepEqual(await page.evaluate(()=>[window.harness.recorderMounts,window.harness.recorderUnmounts]),[1,0]);
  await page.evaluate(()=>{window.harness.mobile=true;window.harness.sending=false;window.harness.text='';window.harness.render();});
  assert.equal(await page.getByRole('button',{name:'Gravar áudio'}).count(),1);
});
test('closed QR ignores late success and never issues retries or recreation',async t=>{
  const page=await harness(t,'qr');await page.getByRole('button',{name:'QR Code',exact:true}).first().click();
  await page.waitForFunction(()=>window.harness.requests.some(r=>r.kind==='qr'));
  await page.getByRole('button',{name:'Fechar diálogo'}).click();
  await page.evaluate(()=>window.harness.requests[0].resolve({}));
  await page.waitForTimeout(1600);
  assert.equal(await page.getByAltText('QR Code').count(),0);assert.equal(await page.evaluate(()=>window.harness.requests.length),1);
});
test('actual FloatingChat ignores deferred A and prefills only B without sending automatically',async t=>{
  const page=await harness(t,'floating');
  await page.evaluate(()=>{window.harness.sessions=[{...window.harness.sessions[0],status:'connected'}];window.harness.render();window.harness.ctx.openNewChatWithMessage('+5511999998888','Texto A','lead-a');});
  await page.waitForFunction(()=>window.harness.requests.filter(r=>r.kind==='find').length===1);
  await page.evaluate(()=>window.harness.ctx.openNewChatWithMessage('+5511999997777','Texto B','lead-b'));
  await page.waitForFunction(()=>window.harness.requests.filter(r=>r.kind==='find').length===2);
  await page.evaluate(c=>window.harness.requests[0].resolve(c),conversation('chat-a','lead-a'));
  await page.waitForTimeout(50);
  assert.equal(await page.evaluate(()=>window.harness.ctx.state.activeConversation?.id??null),null);
  assert.equal(await page.evaluate(()=>window.harness.ctx.state.pendingMessage),'Texto B');
  await page.evaluate(c=>window.harness.requests[1].resolve(c),conversation('chat-b','lead-b'));
  await page.waitForFunction(()=>window.harness.ctx.state.activeConversation?.id==='chat-b');
  await page.waitForFunction(()=>document.querySelector('textarea[aria-label="Digite sua mensagem"]')?.value==='Texto B');
  assert.equal(await page.evaluate(()=>window.harness.requests.filter(r=>r.kind==='send').length),0);
});
test('actual FloatingChat close prevents late navigation and late failure from clearing a new target',async t=>{
  const page=await harness(t,'floating');
  await page.evaluate(()=>{window.harness.sessions=[{...window.harness.sessions[0],status:'connected'}];window.harness.render();window.harness.ctx.openNewChatWithMessage('+5511999998888','Texto A','lead-a');});
  await page.waitForFunction(()=>window.harness.requests.length===1);
  await page.evaluate(()=>window.harness.ctx.closeChat());
  await page.evaluate(c=>window.harness.requests[0].resolve(c),conversation('chat-a','lead-a'));
  await page.waitForTimeout(50);
  assert.equal(await page.evaluate(()=>window.harness.ctx.state.isOpen),false);
  assert.equal(await page.evaluate(()=>window.harness.ctx.state.activeConversation),null);
});
test('actual FloatingChat preparation A to B to A cancels the old send before POST',async t=>{
  const page=await harness(t,'floating');
  await page.evaluate(c=>{window.harness.sessions=[{...window.harness.sessions[0],status:'connected'}];
    window.harness.attendance.ensureJoined=()=>window.harness.request('attendance',{});
    window.harness.render();window.harness.ctx.openConversation(c);},conversation('chat-a','lead-a'));
  await page.getByRole('textbox',{name:'Digite sua mensagem'}).fill('Intenção A');
  await page.getByRole('button',{name:'Enviar mensagem'}).click();
  await page.waitForFunction(()=>window.harness.requests.some(r=>r.kind==='attendance'));
  await page.evaluate(c=>window.harness.ctx.openConversation(c),conversation('chat-b','lead-b'));
  await page.waitForFunction(()=>window.harness.ctx.state.activeConversation?.id==='chat-b');
  await page.evaluate(c=>window.harness.ctx.openConversation(c),conversation('chat-a','lead-a'));
  await page.waitForFunction(()=>window.harness.ctx.state.activeConversation?.id==='chat-a');
  await page.evaluate(()=>window.harness.requests.find(r=>r.kind==='attendance').resolve(true));
  await page.waitForTimeout(50);
  assert.equal(await page.evaluate(()=>window.harness.requests.filter(r=>r.kind==='send').length),0);
  assert.equal(await page.getByRole('textbox',{name:'Digite sua mensagem'}).inputValue(),'Intenção A');
});
test('QR session B remains selected when old A settles; tenant change clears B and stops retry',async t=>{
  const page=await harness(t,'qr');const connect=page.getByRole('button',{name:'QR Code',exact:true});
  await connect.first().click();await page.waitForFunction(()=>window.harness.requests.length===1);
  await connect.nth(1).click();await page.waitForFunction(()=>window.harness.requests.length===2);
  await page.evaluate(()=>window.harness.requests[1].resolve({qrcode:'CURRENT_QR_B'}));
  await page.waitForFunction(()=>document.querySelector('img[alt="QR Code"]')?.getAttribute('src')?.includes('CURRENT_QR_B'));
  await page.evaluate(()=>window.harness.requests[0].resolve({qrcode:'STALE_QR_A'}));
  assert.match(await page.getByAltText('QR Code').getAttribute('src'),/CURRENT_QR_B/);
  await page.evaluate(()=>window.harness.tenant('org-b'));
  assert.equal(await page.getByAltText('QR Code').count(),0);
});
test('phone correction P1 to P2 starts the current route and leaves P1 history untouched',async t=>{
  const page=await harness(t,'floating');
  const old=conversation('chat-old','lead-a');
  const fresh={...conversation('chat-new','lead-a'),contact_phone:'+5511999997777',remote_jid:'5511999997777@s.whatsapp.net'};
  await page.evaluate(old=>{window.harness.oldHistory=old;window.harness.sessions=[{...window.harness.sessions[0],status:'connected'}];
    window.harness.render();window.harness.ctx.openNewChatWithMessage('+5511999997777','Telefone corrigido','lead-a');},old);
  await page.waitForFunction(()=>window.harness.requests.length===1);
  assert.equal(await page.evaluate(()=>window.harness.requests[0].params.phone),'+5511999997777');
  await page.evaluate(()=>window.harness.requests[0].resolve(null));
  await page.waitForFunction(()=>window.harness.requests.length===2);
  assert.equal(await page.evaluate(()=>window.harness.requests[1].params.phone),'+5511999997777');
  await page.evaluate(()=>window.harness.requests[1].resolve(null));
  await page.waitForFunction(()=>window.harness.requests.length===3);
  assert.equal(await page.evaluate(()=>window.harness.requests[2].kind),'start');
  await page.evaluate(c=>window.harness.requests[2].resolve(c),fresh);
  await page.waitForFunction(()=>window.harness.ctx.state.activeConversation?.id==='chat-new');
  assert.deepEqual(await page.evaluate(()=>window.harness.oldHistory),old);
  assert.equal(await page.evaluate(()=>window.harness.requests.filter(r=>r.kind==='send'||r.kind==='link').length),0);
});
test('corrected phone without an owned session never opens old P1 history as composer',async t=>{
  const page=await harness(t,'floating');
  await page.evaluate(()=>window.harness.ctx.openNewChatWithMessage('+5511999997777','P2','lead-a'));
  await page.waitForFunction(()=>window.harness.requests.length===1);
  assert.equal(await page.evaluate(()=>window.harness.requests[0].params.phone),'+5511999997777');
  await page.evaluate(()=>window.harness.requests[0].resolve(null));
  await page.getByText('Conecte o WhatsApp para iniciar o atendimento deste lead',{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>{const s=window.harness.ctx.state;return {phone:s.pendingPhone,leadId:s.pendingLeadId,message:s.pendingMessage};}),{phone:'+5511999997777',leadId:'lead-a',message:'P2'});
  assert.equal(await page.evaluate(()=>window.harness.ctx.state.activeConversation),null);
  assert.equal(await page.getByRole('textbox',{name:'Digite sua mensagem'}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Enviar mensagem'}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Gravar áudio'}).count(),0);
  assert.equal(await page.evaluate(()=>window.harness.requests.filter(r=>r.kind==='start'||r.kind==='send'||r.kind==='history').length),0);
});
test('late definitive failure cannot revive the A draft after A to B to A',async t=>{
  const page=await harness(t,'floating');
  await page.evaluate(c=>{window.harness.sessions=[{...window.harness.sessions[0],status:'connected'}];window.harness.render();window.harness.ctx.openConversation(c);},conversation('chat-a','lead-a'));
  await page.getByRole('textbox',{name:'Digite sua mensagem'}).fill('Rascunho antigo A');
  await page.getByRole('button',{name:'Enviar mensagem'}).click();
  await page.waitForFunction(()=>window.harness.requests.some(r=>r.kind==='send'));
  await page.evaluate(c=>window.harness.ctx.openConversation(c),conversation('chat-b','lead-b'));
  await page.waitForFunction(()=>window.harness.ctx.state.activeConversation?.id==='chat-b');
  await page.evaluate(c=>window.harness.ctx.openConversation(c),conversation('chat-a','lead-a'));
  await page.waitForFunction(()=>window.harness.ctx.state.activeConversation?.id==='chat-a');
  await page.evaluate(()=>window.harness.requests.find(r=>r.kind==='send').reject(new Error('Definitive synthetic failure')));
  await page.waitForTimeout(50);
  assert.equal(await page.getByRole('textbox',{name:'Digite sua mensagem'}).inputValue(),'');
});
for(const mode of ['floating','screen']) {
  async function prepareComposer(t) {
    const page=await harness(t,mode);
    await page.evaluate(({mode,c})=>{const h=window.harness;h.sessions=[{...h.sessions[0],status:'connected'}];
      h.scrollScenario=true;h.conversations=[c];h.messages={...h.messages,messages:[{id:'70000000-0000-4000-8000-000000000001',conversation_id:c.id,session_id:c.session_id,lead_id:c.lead_id,message_id:'provider-quote',content:'Mensagem citada',message_type:'text',from_me:false,status:'received',can_quote:true,can_react:true,sent_at:'2026-10-11T12:00:00Z',metadata:{}}]};h.render();
      if(mode==='floating')h.ctx.openConversation(c);}, {mode,c:conversation('chat-a','lead-a')});
    if(mode==='screen')await page.getByRole('button',{name:'Abrir chat-a',exact:true}).click();
    return page;
  }
  test(mode+' composition Enter and keyCode229 keep the draft; ordinary Enter sends once',async t=>{
    const page=await prepareComposer(t);const input=page.getByRole('textbox',{name:'Digite sua mensagem'});
    await input.fill('Rascunho em composição');
    await input.evaluate(element=>{element.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}));element.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:229,bubbles:true}));});
    await page.waitForTimeout(30);assert.equal(await page.evaluate(()=>window.harness.requests.filter(r=>r.kind==='send').length),0);
    assert.equal(await input.inputValue(),'Rascunho em composição');await input.press('Enter');
    await page.waitForFunction(()=>window.harness.requests.filter(r=>r.kind==='send').length===1);
    await page.evaluate(()=>window.harness.requests.find(r=>r.kind==='send').resolve({status:'queued'}));
  });
  test(mode+' selected quote follows current capability and reply focuses the composer',async t=>{
    const page=await prepareComposer(t);
    await page.getByRole('button',{name:'Responder mensagem',exact:true}).click();
    assert.equal(await page.getByRole('textbox',{name:'Digite sua mensagem'}).evaluate(element=>element===document.activeElement),true);
    await page.getByText('Respondendo: Mensagem citada',{exact:true}).waitFor();
    await page.evaluate(()=>{const h=window.harness;h.messages={...h.messages,messages:h.messages.messages.map(message=>({...message,can_quote:false}))};h.render();});
    assert.equal(await page.getByText('Respondendo: Mensagem citada',{exact:true}).count(),0);
    await page.getByRole('textbox',{name:'Digite sua mensagem'}).fill('Resposta atual');
    await page.getByRole('textbox',{name:'Digite sua mensagem'}).press('Enter');
    await page.waitForFunction(()=>window.harness.requests.some(r=>r.kind==='send'));
    assert.equal(await page.evaluate(()=>window.harness.requests.find(r=>r.kind==='send').params.quotedMessageId),undefined);
    await page.evaluate(()=>window.harness.requests.find(r=>r.kind==='send').resolve({status:'queued'}));
  });
  test(mode+' dropping on history reviews one attachment with caption before any send',async t=>{
    const page=await prepareComposer(t);
    const prevented=await page.locator('[data-message-id="70000000-0000-4000-8000-000000000001"]').evaluate(element=>{
      const event=new Event('drop',{bubbles:true,cancelable:true});
      Object.defineProperty(event,'dataTransfer',{value:{files:[new File(['synthetic'],'anexo-review.pdf',{type:'application/pdf'})],types:['Files']}});
      element.dispatchEvent(event); return event.defaultPrevented;
    });
    assert.equal(prevented,true);
    const review=page.getByRole('region',{name:'Revisar arquivos antes de enviar'});
    await review.waitFor(); assert.equal(await review.getByText('anexo-review.pdf',{exact:true}).count(),1);
    assert.equal(await page.evaluate(()=>window.harness.requests.filter(r=>r.kind==='send').length),0);
    await review.getByRole('textbox',{name:'Legenda de anexo-review.pdf'}).fill('Legenda revisada');
    await review.getByRole('button',{name:'Enviar arquivo',exact:true}).click();
    await page.waitForFunction(()=>window.harness.requests.some(r=>r.kind==='send'));
    assert.equal(await page.evaluate(()=>window.harness.requests.find(r=>r.kind==='send').params.text),'Legenda revisada');
    await page.evaluate(()=>window.harness.requests.find(r=>r.kind==='send').resolve({status:'queued'}));
  });
  test(mode+' file attachment includes the selected quote and clears it only on success',async t=>{
    const page=await prepareComposer(t);await page.getByRole('button',{name:'Responder mensagem',exact:true}).click();
    await page.getByText('Respondendo: Mensagem citada',{exact:true}).waitFor();
    await page.locator('input[type=file]').setInputFiles({name:'documento-sintetico.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 synthetic')});
    await confirmAttachments(page);
    await page.waitForFunction(()=>window.harness.requests.some(r=>r.kind==='send'));
    assert.equal(await page.evaluate(()=>window.harness.requests.find(r=>r.kind==='send').params.quotedMessageId),'70000000-0000-4000-8000-000000000001');
    assert.equal(await page.evaluate(()=>window.harness.requests.find(r=>r.kind==='send').params.optimisticQuotedMessage.message_id),'provider-quote');
    await page.evaluate(()=>{const r=window.harness.requests.find(r=>r.kind==='send');r.resolve({status:'queued',conversationId:r.params.conversation.id,clientMessageId:'file-original',message:{id:'file-row',message_id:'provider-file',from_me:true,status:'queued',conversation_id:r.params.conversation.id,client_message_id:'file-original'}});});
    await page.waitForFunction(()=>!document.body.textContent.includes('Respondendo: Mensagem citada'));
  });
  for(const state of ['recipient_not_registered','outcome_unknown','confirming']) {
    test(mode+' file canonical '+state+' preserves quote and never announces queued success',async t=>{
      const page=await prepareComposer(t);await page.getByRole('button',{name:'Responder mensagem',exact:true}).click();
      await page.locator('input[type=file]').setInputFiles({name:'anexo.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 synthetic')});
    await confirmAttachments(page);
      await page.waitForFunction(()=>window.harness.requests.some(r=>r.kind==='send'));
      await page.evaluate(state=>{const h=window.harness,r=h.requests.find(r=>r.kind==='send');const base={status:state==='confirming'?'confirming':'failed',conversationId:r.params.conversation.id,clientMessageId:'file-original'};r.resolve(state==='confirming'?base:{...base,message:{id:'file-row',from_me:true,status:'failed',conversation_id:base.conversationId,client_message_id:base.clientMessageId,delivery_error_code:state}});},state);
      await page.waitForFunction(()=>document.querySelector('input[type=file]').value==='');
      assert.equal(await page.getByText('Respondendo: Mensagem citada',{exact:true}).count(),1);
      const titles=await page.evaluate(()=>window.harness.toasts.map(t=>t.title??t));
      assert.equal(titles.includes('Arquivo na fila'),false);
      assert.equal(titles.includes(state==='recipient_not_registered'?'Arquivo não enviado':'Confirmando envio'),true);
      assert.equal(await page.evaluate(()=>window.harness.requests.filter(r=>r.kind==='send').length),1);
    });
  }
  test(mode+' an attachment completion preserves a newer reply selection in the same chat',async t=>{
    const page=await prepareComposer(t);
    await page.evaluate(()=>{const h=window.harness;h.messages={...h.messages,messages:[...h.messages.messages,
      {...h.messages.messages[0],id:'70000000-0000-4000-8000-000000000002',message_id:'provider-new-quote',content:'Nova resposta selecionada',sent_at:'2026-10-11T12:01:00Z'}]};h.render();});
    await page.locator('[data-message-id="70000000-0000-4000-8000-000000000001"]').getByRole('button',{name:'Responder mensagem'}).click();
    await page.locator('input[type=file]').setInputFiles({name:'anexo.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 synthetic')});
    await confirmAttachments(page);
    await page.waitForFunction(()=>window.harness.requests.some(r=>r.kind==='send'));
    await page.locator('[data-message-id="70000000-0000-4000-8000-000000000002"]').getByRole('button',{name:'Responder mensagem'}).click();
    await page.evaluate(()=>window.harness.requests.find(r=>r.kind==='send').resolve({status:'queued'}));
    await page.waitForTimeout(30);
    assert.equal(await page.getByText('Respondendo: Nova resposta selecionada',{exact:true}).count(),1);
  });
}

test('actual ConversationsScreen link A completion cannot reopen A or clear current B',async t=>{
  const page=await harness(t,'screen');
  await page.evaluate(cs=>{window.harness.sessions=[{...window.harness.sessions[0],status:'connected'}];window.harness.conversations=cs;window.harness.render();},[conversation('chat-a','lead-a'),conversation('chat-b','lead-b')]);
  await page.getByRole('button',{name:'Abrir chat-a'}).click();
  await page.getByRole('button',{name:'Mais ações da conversa',exact:true}).click();
  await page.getByRole('menuitem',{name:'Mudar vínculo da conversa',exact:true}).click();
  await page.getByRole('button',{name:'Confirmar vínculo',exact:true}).click();
  await page.waitForFunction(()=>window.harness.requests.some(r=>r.kind==='link'));
  await page.getByRole('button',{name:'Abrir chat-b'}).click();
  await page.waitForFunction(()=>window.harness.screenSelection==='chat-b');
  await page.evaluate(()=>window.harness.requests.find(r=>r.kind==='link').resolve({bindingMode:'active'}));
  await page.waitForTimeout(50);
  assert.equal(await page.evaluate(()=>window.harness.screenSelection),'chat-b');
  assert.equal(await page.evaluate(()=>window.harness.requests.filter(r=>r.kind==='detail').length),0);
});
test('secondary organization can read authorized lead history without operational API or composer',async t=>{
  const page=await harness(t,'floating');
  await page.evaluate(()=>{window.harness.tenant('org-b');window.harness.ctx.openNewChatWithMessage('+5511999998888','Não enviar B','lead-b');});
  await page.waitForFunction(()=>window.harness.requests.some(r=>r.kind==='find'));
  await page.evaluate(c=>window.harness.requests.find(r=>r.kind==='find').resolve(c),conversation('chat-b','lead-b'));
  await page.waitForFunction(()=>window.harness.ctx.state.activeConversation?.id==='chat-b');
  await page.evaluate(()=>{window.harness.messages={...window.harness.messages,messages:[{id:'00000000-0000-4000-8000-000000000001',client_message_id:'intent-original-A',message_id:'provider-id',content:'Histórico autorizado B',message_type:'text',from_me:true,status:'failed',delivery_error_code:'outcome_unknown',sent_at:'2026-10-11T00:00:00Z',metadata:{}}]};window.harness.render();});
  assert.equal(await page.getByRole('button',{name:'Enviar mensagem'}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Gravar áudio'}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Verificar envio',exact:true}).count(),0);
  await page.getByText('Histórico autorizado B',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.harness.ctx.state.pendingMessage),null);
  assert.equal(await page.evaluate(()=>window.harness.requests.filter(r=>!['find','history'].includes(r.kind)).length),0);
  assert.equal(await page.evaluate(()=>window.harness.ctx.state.activeConversation.historical_lead_view),true);
});
test('floating discovers active lead history and pins a read-only chat through list refresh',async t=>{
  const page=await harness(t,'floating');
  await page.evaluate(row=>{
    const h=window.harness;
    h.sessions=[];
    h.conversations=[row];
    h.messages={...h.messages,messages:[{id:'message-a',conversation_id:row.id,session_id:row.session_id,
      content:'Histórico do lead',message_type:'text',from_me:false,sent_at:'2026-10-11T00:00:00Z'}]};
    h.render();
    h.ctx.openChat();
  },{...conversation('supervised-chat','lead-a'),session_id:'session-other',historical_lead_view:true,supervisory_lead_view:true,unread_count:0});
  await page.waitForFunction(()=>window.harness.listOptions?.enabled===true);
  assert.equal(await page.evaluate(()=>window.harness.listOptions.includeSupervisoryLeads),true);
  await page.getByRole('button',{name:'Abrir supervised-chat'}).click();
  await page.getByText('Histórico do lead',{exact:true}).waitFor();
  await page.getByText('Histórico deste lead (somente leitura)',{exact:true}).waitFor();
  assert.equal(await page.getByRole('textbox',{name:'Digite sua mensagem'}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Anexar arquivo'}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Gravar áudio'}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Ver lead no funil'}).count(),1);
  assert.deepEqual(await page.evaluate(()=>{
    const read=window.harness.messageRead;
    return [read.id,read.options.expectedLeadId,read.options.historyLeadId,read.options.expectedSessionId];
  }),['supervised-chat','lead-a','lead-a','session-other']);
  await page.evaluate(row=>{
    const h=window.harness;
    h.conversations=[row];
    h.sessions=[{id:'session-a',owner_user_id:'user-a',status:'connected',can_send:true,provider:'evolution_go'}];
    h.render();
  },conversation('supervised-chat','lead-b'));
  await page.getByText('Histórico deste lead (somente leitura)',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.harness.ctx.state.activeConversation.lead_id),'lead-a');
  assert.deepEqual(await page.evaluate(()=>window.harness.requests),[]);
  await page.evaluate(()=>{
    const h=window.harness;
    h.scope={...h.scope,accessScope:'revoked'};
    h.render();
  });
  await page.getByRole('button',{name:'Abrir supervised-chat'}).waitFor();
  assert.equal(await page.getByText('Histórico do lead',{exact:true}).count(),0);
});

test('floating background refresh keeps search results and empty message history visible',async t=>{
  const page=await harness(t,'floating');
  await page.evaluate(row=>{
    const h=window.harness;
    h.conversations=[row];
    h.filters={...h.filters,searchQuery:'lead-a'};
    h.render();
    h.ctx.openChat();
  },conversation('chat-a','lead-a'));
  await page.waitForFunction(()=>window.harness.listFilters?.search==='lead-a');
  await page.getByRole('button',{name:'Abrir chat-a'}).waitFor();
  await page.evaluate(()=>{
    const h=window.harness;
    h.emptyQuery={...h.emptyQuery,isFetching:true};
    h.render();
  });
  assert.equal(await page.getByRole('button',{name:'Abrir chat-a'}).count(),1);
  assert.equal(await page.getByText('Buscando conversas…',{exact:true}).count(),0);
  await page.evaluate(()=>{
    const h=window.harness;
    h.messages={...h.messages,isLoading:true,isFetching:true};
    h.render();
  });
  await page.getByRole('button',{name:'Abrir chat-a'}).click();
  await page.getByText('Carregando mensagens...',{exact:true}).waitFor();
  await page.evaluate(()=>{
    const h=window.harness;
    h.messages={...h.messages,isLoading:false,isFetching:false};
    h.render();
  });
  await page.getByText('Nenhuma mensagem',{exact:true}).waitFor();
  await page.evaluate(()=>{
    const h=window.harness;
    h.messages={...h.messages,isFetching:true};
    h.render();
  });
  assert.equal(await page.getByText('Nenhuma mensagem',{exact:true}).count(),1);
  assert.equal(await page.getByText('Carregando mensagens...',{exact:true}).count(),0);
});

test('floating keeps archived conversations on the operational query',async t=>{
  const page=await harness(t,'context');
  await page.evaluate(()=>{
    localStorage.setItem('whatsapp-show-archived-floating','true');
    const h=window.harness;
    h.render('floating');
    h.ctx.openChat();
  });
  await page.waitForFunction(()=>window.harness.listOptions?.enabled===true);
  assert.equal(await page.evaluate(()=>window.harness.listOptions.includeSupervisoryLeads),undefined);
});

test('actual ConversationsScreen detail for linked A cannot overwrite current B after GET settles',async t=>{
  const page=await harness(t,'screen');
  await page.evaluate(cs=>{window.harness.sessions=[{...window.harness.sessions[0],status:'connected'}];window.harness.conversations=cs;window.harness.render();},[conversation('chat-a','lead-a'),conversation('chat-b','lead-b')]);
  await page.getByRole('button',{name:'Abrir chat-a'}).click();
  await page.getByRole('button',{name:'Mais ações da conversa',exact:true}).click();
  await page.getByRole('menuitem',{name:'Mudar vínculo da conversa',exact:true}).click();
  await page.getByRole('button',{name:'Confirmar vínculo',exact:true}).click();
  await page.waitForFunction(()=>window.harness.requests.some(r=>r.kind==='link'));
  await page.evaluate(()=>window.harness.requests.find(r=>r.kind==='link').resolve({bindingMode:'active'}));
  await page.waitForFunction(()=>window.harness.requests.some(r=>r.kind==='detail'));
  await page.getByRole('button',{name:'Abrir chat-b'}).click();
  await page.waitForFunction(()=>window.harness.screenSelection==='chat-b');
  await page.evaluate(c=>window.harness.requests.find(r=>r.kind==='detail').resolve(c),conversation('chat-a','lead-new'));
  await page.waitForTimeout(50);
  assert.equal(await page.evaluate(()=>window.harness.screenSelection),'chat-b');
});
test('canonical send check uses the dedicated client ID instead of row UUID when metadata is redacted',async t=>{
  const page=await harness(t,'floating');
  await page.evaluate(c=>{window.harness.sessions=[{...window.harness.sessions[0],status:'connected'}];
    window.harness.resolveSend=p=>window.harness.request('verify-send',p);
    window.harness.messages={...window.harness.messages,messages:[{id:'00000000-0000-4000-8000-000000000001',client_message_id:'original-client-intent',message_id:'provider-id',content:'Canonical unknown',message_type:'text',from_me:true,status:'failed',delivery_error_code:'outcome_unknown',sent_at:'2026-10-11T00:00:00Z',metadata:{}}]};
    window.harness.render();window.harness.ctx.openConversation(c);},conversation('chat-a','lead-a'));
  await page.getByRole('button',{name:'Verificar envio',exact:true}).click();
  await page.waitForFunction(()=>window.harness.requests.some(r=>r.kind==='verify-send'));
  assert.equal(await page.evaluate(()=>window.harness.requests.find(r=>r.kind==='verify-send').params.clientMessageId),'original-client-intent');
  assert.equal(await page.evaluate(()=>window.harness.requests.filter(r=>r.kind==='send').length),0);
});
test('QR polling keeps one outstanding status read across useMutation identity churn',async t=>{
  const page=await harness(t,'qr');await page.clock.install();
  await page.getByRole('button',{name:'QR Code',exact:true}).first().click();
  await page.waitForFunction(()=>window.harness.requests.length===1);
  await page.evaluate(()=>window.harness.requests[0].resolve({qrcode:'CURRENT'}));
  await page.clock.runFor(5100);
  await page.waitForFunction(()=>window.harness.requests.some(r=>r.kind==='status'));
  await page.evaluate(()=>window.harness.render());
  await page.clock.runFor(5100);
  assert.equal(await page.evaluate(()=>window.harness.requests.filter(r=>r.kind==='status').length),1);
});
test('actual ConversationsScreen delayed deeplink A cannot displace a manual selection B',async t=>{
  const page=await harness(t,'screen');
  await page.evaluate(cs=>{window.harness.sessions=[{...window.harness.sessions[0],status:'connected'}];window.harness.conversations=cs;
    window.harness.screenInitialConversationId='chat-a';window.harness.snapshotFetched=false;window.harness.render();},[conversation('chat-a','lead-a'),conversation('chat-b','lead-b')]);
  await page.getByRole('button',{name:'Abrir chat-b'}).click();
  await page.waitForFunction(()=>window.harness.screenSelection==='chat-b');
  await page.evaluate(()=>{window.harness.snapshotFetched=true;window.harness.render();});
  await page.waitForTimeout(50);
  assert.equal(await page.evaluate(()=>window.harness.screenSelection),'chat-b');
});

// Actual Screen + ConversationMessages + Radix viewport, with only geometry CSS
// supplied by the harness; there is no manual scroll to satisfy the tail checks.
const scrollMessages=Array.from({length:24},(_,i)=>({id:`60000000-0000-4000-8000-${String(i).padStart(12,'0')}`,conversation_id:'chat-scroll',lead_id:'lead-scroll',session_id:'session-a',message_id:`scroll-${i}`,content:`Mensagem de rolagem ${i}`,message_type:'text',sent_at:new Date(Date.UTC(2026,9,11,12,0,i)).toISOString(),from_me:false,status:'received',metadata:{}}));
async function scrollHarness(t){
  const page=await harness(t,'screen');
  await page.addStyleTag({content:`[data-screen-chat]{position:fixed;left:20px;top:100px;width:340px;height:260px;display:flex;flex-direction:column;}[data-screen-chat]>div{height:100%;min-height:0;}[data-screen-chat] [data-radix-scroll-area-viewport]{height:100%!important;}[data-screen-chat] [data-message-id]{height:64px;box-sizing:border-box;border-bottom:1px solid #ccc;}[data-screen-chat][data-layout=mobile]{width:280px;height:220px;}[data-screen-chat][data-layout=mobile] [data-message-id]{height:96px;}`});
  await page.evaluate(c=>{const h=window.harness;h.scrollScenario=true;h.sessions=[{...h.sessions[0],status:'connected'}];h.conversations=[c];h.render();},conversation('chat-scroll','lead-scroll'));
  await page.getByRole('button',{name:'Abrir chat-scroll',exact:true}).click();
  await page.locator('[data-screen-chat] [data-radix-scroll-area-viewport]').waitFor();
  // The selected-conversation timer has finished before the first data response.
  await page.waitForTimeout(100);
  return page;
}
async function assertScrollTail(page){
  await page.waitForFunction(()=>{const v=document.querySelector('[data-screen-chat] [data-radix-scroll-area-viewport]');return v&&v.scrollHeight-v.scrollTop-v.clientHeight<=1;},{},{timeout:1500});
}
async function readEarlier(page){
  await page.evaluate(()=>{const v=document.querySelector('[data-screen-chat] [data-radix-scroll-area-viewport]');const item=v.querySelectorAll('[data-message-id]')[6];v.scrollTop=item.getBoundingClientRect().top-v.getBoundingClientRect().top+v.scrollTop+12;v.dispatchEvent(new Event('scroll',{bubbles:false}));});
  await page.waitForTimeout(30);
  return page.evaluate(()=>{const v=document.querySelector('[data-screen-chat] [data-radix-scroll-area-viewport]');const top=v.getBoundingClientRect().top;const item=[...v.querySelectorAll('[data-message-id]')].find(e=>e.getBoundingClientRect().bottom>top);return{id:item.dataset.messageId,offset:item.getBoundingClientRect().top-top};});
}

test('scroll initial data reaches the tail even when equal arrays replace it before the old timer',async t=>{
  const page=await scrollHarness(t);
  await page.evaluate(messages=>{const h=window.harness;h.messages={...h.messages,messages};h.render();},scrollMessages);
  for(let i=0;i<6;i++){await page.waitForTimeout(10);await page.evaluate(()=>{const h=window.harness;h.messages={...h.messages,messages:h.messages.messages.map(m=>({...m}))};h.render();});}
  await assertScrollTail(page);
});

test('scroll desktop to mobile follows the latest message when already at the bottom',async t=>{
  const page=await scrollHarness(t);
  await page.evaluate(messages=>{const h=window.harness;h.messages={...h.messages,messages};h.render();},scrollMessages);
  await assertScrollTail(page);
  await page.setViewportSize({width:390,height:800});
  await page.evaluate(()=>{window.harness.mobile=true;window.harness.render();});
  await assertScrollTail(page);
});

test('scroll desktop to mobile preserves the same earlier message and its viewport offset',async t=>{
  const page=await scrollHarness(t);
  await page.evaluate(messages=>{const h=window.harness;h.messages={...h.messages,messages};h.render();},scrollMessages);
  await assertScrollTail(page);
  const before=await readEarlier(page);
  await page.setViewportSize({width:390,height:800});
  await page.evaluate(()=>{window.harness.mobile=true;window.harness.render();});
  await page.waitForTimeout(100);
  const after=await page.evaluate(id=>{const v=document.querySelector('[data-screen-chat] [data-radix-scroll-area-viewport]');const item=v.querySelector('[data-message-id="'+id+'"]');return{offset:item.getBoundingClientRect().top-v.getBoundingClientRect().top,distance:v.scrollHeight-v.scrollTop-v.clientHeight};},before.id);
  assert.ok(Math.abs(after.offset-before.offset)<=1,JSON.stringify({before,after}));
  assert.ok(after.distance>50,'reading older messages must not jump to the latest');
});

test('scroll prepending older messages and receiving a new row preserve the reading anchor',async t=>{
  const page=await scrollHarness(t);
  await page.evaluate(messages=>{const h=window.harness;h.messages={...h.messages,messages};h.render();},scrollMessages);
  await assertScrollTail(page);
  const before=await readEarlier(page);
  await page.evaluate(messages=>{const h=window.harness;const older=messages.slice(0,4).map((m,i)=>({...m,id:'older-'+i,message_id:'older-'+i,sent_at:new Date(Date.UTC(2026,9,11,11,59,i)).toISOString()}));h.messages={...h.messages,messages:[...older,...messages,{...messages.at(-1),id:'new-tail',message_id:'new-tail',sent_at:'2026-10-11T12:01:00Z'}]};h.render();},scrollMessages);
  await page.waitForTimeout(100);
  const after=await page.evaluate(id=>{const v=document.querySelector('[data-screen-chat] [data-radix-scroll-area-viewport]');const item=v.querySelector('[data-message-id="'+id+'"]');return{offset:item.getBoundingClientRect().top-v.getBoundingClientRect().top,distance:v.scrollHeight-v.scrollTop-v.clientHeight};},before.id);
  assert.ok(Math.abs(after.offset-before.offset)<=1,JSON.stringify({before,after}));
  assert.ok(after.distance>50);
});


test('scroll same-desktop resize follows bottom after viewport height and width decrease',async t=>{
  const page=await scrollHarness(t);
  await page.addStyleTag({content:'@media(max-width:950px){[data-screen-chat][data-layout=desktop]{width:280px;height:220px;}[data-screen-chat][data-layout=desktop] [data-message-id]{height:96px;}}'});
  await page.evaluate(messages=>{const h=window.harness;h.messages={...h.messages,messages};h.render();},scrollMessages);
  await assertScrollTail(page);
  const before=await page.locator('[data-screen-chat] [data-radix-scroll-area-viewport]').evaluate(v=>({width:v.clientWidth,height:v.clientHeight}));
  await page.setViewportSize({width:900,height:720});
  const after=await page.locator('[data-screen-chat] [data-radix-scroll-area-viewport]').evaluate(v=>({width:v.clientWidth,height:v.clientHeight}));
  assert.deepEqual([before.height,after.height],[260,220]);
  assert.ok(after.width<before.width);
  assert.equal(await page.evaluate(()=>window.harness.mobile),false);
  await assertScrollTail(page);
});

test('scroll same-desktop resize preserves the earlier reading anchor through real reflow',async t=>{
  const page=await scrollHarness(t);
  await page.addStyleTag({content:'@media(max-width:950px){[data-screen-chat][data-layout=desktop]{width:280px;height:220px;}[data-screen-chat][data-layout=desktop] [data-message-id]{height:96px;}}'});
  await page.evaluate(messages=>{const h=window.harness;h.messages={...h.messages,messages};h.render();},scrollMessages);
  await assertScrollTail(page);
  const before=await readEarlier(page);
  await page.setViewportSize({width:900,height:720});
  await page.waitForTimeout(100);
  const after=await page.evaluate(id=>{const v=document.querySelector('[data-screen-chat] [data-radix-scroll-area-viewport]');const item=v.querySelector('[data-message-id="'+id+'"]');return{offset:item.getBoundingClientRect().top-v.getBoundingClientRect().top,distance:v.scrollHeight-v.scrollTop-v.clientHeight,height:v.clientHeight};},before.id);
  assert.equal(after.height,220);
  assert.equal(await page.evaluate(()=>window.harness.mobile),false);
  assert.ok(Math.abs(after.offset-before.offset)<=1,JSON.stringify({before,after}));
  assert.ok(after.distance>50);
});
