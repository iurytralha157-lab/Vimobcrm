import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// Actual mobile presentation closure, shared primitives and application CSS.
// Business reads/writes are synthetic counters; every browser request is blocked.
const require = createRequire(import.meta.url), ts = require('typescript');
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const artifacts = resolve(process.env.PIPELINE_VISUAL_ARTIFACT_DIR || join(tmpdir(), 'vimob-lead-mobile-header-artifacts'));
const evidencePhase = process.env.PIPELINE_HEADER_EVIDENCE_PHASE || 'after';
let directory, browser, bundle, styles;
const errors = [];

function mobilePresentation(source) {
  const ast = ts.createSourceFile('LeadDetailDialog.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = [];
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'MobileContentV2') found.push(node.initializer.getText(ast));
    ts.forEachChild(node, visit);
  };
  visit(ast); assert.equal(found.length, 1);
  return found[0];
}

before(async () => {
  const production = await readFile(process.env.PIPELINE_MOBILE_DETAIL_SOURCE || join(repository, 'components/features/leads/LeadDetailDialog.tsx'), 'utf8');
  directory = await mkdtemp(join(tmpdir(), 'vimob-lead-mobile-header-'));
  const entry = join(directory, 'fixture.tsx'), loader = join(directory, 'loader.cjs');
  let headerSource = join(repository, 'components/features/leads/lead-detail/PipelineMobileLeadHeader.tsx');
  if (process.env.PIPELINE_MOBILE_HEADER_SOURCE) {
    headerSource = join(directory, 'PipelineMobileLeadHeader.tsx');
    await writeFile(headerSource, await readFile(process.env.PIPELINE_MOBILE_HEADER_SOURCE, 'utf8'));
  }
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=source=>ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;`);
  await writeFile(entry, `import React,{useState,useEffect,useLayoutEffect,useRef}from'react';import{createRoot}from'react-dom/client';
    import{Avatar,AvatarFallback,AvatarImage}from'@/components/ui/avatar';import{Badge}from'@/components/ui/badge';import{Button}from'@/components/ui/button';import{Input}from'@/components/ui/input';import{Textarea}from'@/components/ui/textarea';
    import{Drawer,DrawerContent,DrawerTitle,DrawerDescription}from'@/components/ui/drawer';
    import{PipelineMobileLeadHeader}from${JSON.stringify(headerSource)};
    import{CopyLeadPhoneButton}from'@/components/features/leads/CopyLeadPhoneButton';
    import{Select,SelectContent,SelectItem,SelectTrigger,SelectValue}from'@/components/ui/select';import{Popover,PopoverContent,PopoverTrigger}from'@/components/ui/popover';
    import{Command,CommandEmpty,CommandGroup,CommandInput,CommandItem,CommandList}from'@/components/ui/command';
    import{Phone,Mail,MessageCircle,Loader2,X,Plus,Save,User,Calendar,FileEdit,Activity,Contact,ChevronDown,FileText,Paperclip}from'lucide-react';
    import{cn}from'@/lib/utils';import{getDisplayInitial}from'@/lib/display-name';import{formatPhoneForDisplay}from'@/lib/phone-utils';import{getTagColorStyleWithWhiteText}from'@/lib/tag-color';
    import{getDealStatusTriggerClass,getStageStepperStyle}from'@/components/features/leads/lead-detail/utils';import{getLeadSourceLabel}from'@/components/features/leads/lead-detail/tracking';
    const h=window.h={writes:[],closed:0,rendered:0,lead:{id:'lead-a',name:'Ana de Albuquerque Atendimento Sintético',phone:'11912345678',email:'synthetic@example.invalid',deal_status:'open',stage_id:'stage-2',created_at:'2026-10-17T10:00:00Z',tags:Array.from({length:8},(_,index)=>({id:'tag-'+index,name:'Tag sintética longa '+index,color:'#287a56'}))}};
    const noop=()=>{},record=kind=>(...args)=>h.writes.push({kind,args:args.filter(value=>value==null||typeof value==='string')});
    const LeadProfileHover=({lead})=><span>{lead.name}</span>,CampaignTrackingHover=()=>null,ReentryBadge=()=>null,QueuePoolClaimButton=()=>null;
    const TagSelectorPopoverContent=()=>null,LeadTagPickerContent=()=>null,LeadAttachmentsStatus=()=>null,LeadAttachmentUploadRecovery=()=>null,LeadAssigneeCatalogNotice=()=>null,LeadDetailReadNotice=()=>null,PropertyPickerDialog=()=>null,InternationalPhoneInput=()=>null,LeadCadencePanel=()=>null;
    const InfoLine=({label,value})=><div className='flex justify-between gap-2 text-xs'><span>{label}</span><span className='min-w-0 break-words'>{value}</span></div>;
    const LeadUnifiedThread=()=> <section className='flex h-full min-h-0 flex-col p-3' data-testid='history-panel'><div className='min-h-0 flex-1 overflow-y-auto'>{Array.from({length:20},(_,index)=><p key={index} className='py-3 text-xs'>Atividade sintética {index+1}</p>)}</div><div className='h-6 shrink-0'/></section>;
    const commandSearchFilter=()=>1;
    function Content({lead,variant,allowed}){
      const localLead=lead,leadName=lead.name,leadTags=lead.tags,leadTagIds=lead.tags.map(tag=>tag.id),assigneeName='Responsável sintético com nome extenso';
      const isMobile=window.innerWidth<768,activeOrganization={organizationId:'org-a'},mobileTabsId='synthetic-mobile-tabs';
      const allUsersState={isPending:false,isError:false},assigneeCatalogBlocked=false,detailReadState={status:'ready'},retryLeadRead=noop;
      const canOperateLead=allowed,canTransferLead=allowed,canOpenLeadWhatsApp=allowed,hideWhatsAppAction=false,readAccessPending=false,isUpdatingAssignee=false,isTagMutationPending=false;
      const [activeTab,setActiveTab]=useState('summary'),[tagPopoverOpen,setTagPopoverOpen]=useState(false),[assigneePopoverOpen,setAssigneePopoverOpen]=useState(false);
      const [feedback,setFeedback]=useState(''),[editForm,setEditForm]=useState({});
      const stages=Array.from({length:7},(_,index)=>({id:'stage-'+index,name:'Etapa '+index})),currentStageIndex=2,stageStepperStyle=getStageStepperStyle(stages.length);
      const leadSource='meta',firstResponseLabel='2 min',campaignTrackingDetails=null,leadMetaQuery={isPending:false,isError:false,refetch:noop};
      const fullLeadQuery={isFetching:false},dealStatusChange={isPending:false},stageMovePending=false,updateLead={isPending:false};
      const scheduleEvents=[],scheduleSummaryLabel='Nenhum compromisso',canViewLeadSchedule=false,canManageLeadSchedule=false;
      const hasPropertiesModule=false,canViewProperties=false,propertyOptions=[],attachments=[],attachmentsLoading=false,attachmentsError=null,attachmentsFetching=false,isUploading=false,fileInputRef=useRef(null);
      const attachmentUploadDraft={draft:null,clear:noop};
      const leadCadenceState=null,leadCadenceLoading=false,leadCadenceError=null,cadenceActionPending=false,completeCadenceTask={isPending:false},availableTags=[],assignableUsers=[];
      const pipelineDetailStyles={};
      const handleMoveToStage=record('move'),handleRemoveTag=record('remove-tag'),handleAddTag=record('add-tag'),handleAssignUser=record('assign'),handleDealStatusChange=record('status');
      const handleQuickPhone=record('phone'),handleQuickWhatsApp=record('chat'),handleQuickEmail=record('email'),handleOpenLeadEdit=record('edit'),handleSaveFeedback=record('feedback');
      const handleCloseLeadDetail=()=>{h.closed++;h.show(false)},handleAssigneePopoverChange=setAssigneePopoverOpen,handleSelectInterestProperty=noop,handleFileUpload=noop,handleOpenAttachment=noop,refetchAttachments=noop;
      const setEditingScheduleEvent=noop,setScheduleDefaultType=noop,setScheduleFormOpen=noop,renderScheduleEvents=()=>null,refetchLeadCadence=noop,handleCadenceTaskClick=noop,setTaskInspectOnly=noop,setSelectedTask=noop,setRoteiroDialogOpen=noop;
      const MobileContentV2=${mobilePresentation(production)};
      h.rendered++;return MobileContentV2();
    }
    function Fixture(){const[lead,setLead]=useState(h.lead),[shown,setShown]=useState(true),[variant,setVariant]=useState('pipeline'),[allowed,setAllowed]=useState(true);h.change=setLead;h.show=setShown;h.variant=setVariant;h.allowed=setAllowed;
      return <Drawer open={shown} onOpenChange={open=>!open&&(h.closed++,setShown(false))}><DrawerContent className='lead-mobile-drawer mx-auto w-full overflow-hidden rounded-t-[8px] border-0 bg-[var(--app-surface-solid)] p-0 text-[var(--app-text-primary)] shadow-none md:max-w-[760px]' showHandle={false}><DrawerTitle className='sr-only'>Detalhes sintéticos</DrawerTitle><DrawerDescription className='sr-only'>Dados, ações e histórico sintéticos.</DrawerDescription><Content lead={lead} variant={variant} allowed={allowed}/></DrawerContent></Drawer>;
    }createRoot(document.getElementById('app')).render(<Fixture/>);`);
  const { webpack } = require('next/dist/compiled/webpack/webpack');
  await new Promise((resolveBuild, reject) => {
    const compiler = webpack({ mode: 'development', target: 'web', devtool: false, entry, output: { path: directory, filename: 'fixture.js' },
      resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@': repository }, modules: [join(repository, 'node_modules'), 'node_modules'] },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] } });
    compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors() ? reject(error || Error(stats.toString({ all: false, errors: true }))) : resolveBuild()));
  });
  bundle = await readFile(join(directory, 'fixture.js'), 'utf8');
  const postcss = require('postcss'), tailwind = require('@tailwindcss/postcss');
  const globals = await readFile(join(repository, 'app/globals.css'), 'utf8');
  const sources = ['components/features/leads/LeadDetailDialog.tsx', 'components/features/leads/lead-detail', 'components/ui'].map(path => `@source "${join(repository, path).replaceAll('\\', '/')}";`).concat(`@source "${headerSource.replaceAll('\\', '/')}";`).join('\n');
  styles = (await postcss([tailwind({ base: repository })]).process(`${globals.replace('@import "tailwindcss";', '@import "tailwindcss" source(none);')}\n${sources}`, { from: join(repository, 'app/globals.css') })).css;
  browser = await chromium.launch({ headless: true });
}, { timeout: 120_000 });

after(async () => {
  await browser?.close();
  if (directory) {
    const target = resolve(directory); assert.equal(dirname(target), resolve(tmpdir())); assert.ok(target.split(/[/\\]/).at(-1).startsWith('vimob-lead-mobile-header-'));
    await rm(target, { recursive: true, force: true });
  }
  assert.deepEqual(errors, []);
});

async function open(width, height) {
  const page = await browser.newPage({ viewport: { width, height } }); page.setDefaultTimeout(5_000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.abort()); await page.setContent('<html class="light"><body><div id="app"></div></body></html>');
  await page.addStyleTag({ content: styles }); await page.addScriptTag({ content: bundle });
  try { await page.getByRole('tab', { name: 'Resumo' }).waitFor(); }
  catch (error) {
    await mkdir(artifacts,{recursive:true});
    await page.screenshot({path:join(artifacts,`header-render-failure-${width}x${height}.png`)});
    await writeFile(join(artifacts,`header-render-failure-${width}x${height}.json`),JSON.stringify({errors},null,2));
    await page.close();
    throw new Error(`${error.message}; browser errors: ${JSON.stringify(errors)}`,{cause:error});
  }
  await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => undefined))));
  return page;
}

async function geometry(page) {
  return page.locator('.lead-mobile-drawer').evaluate(drawer => {
    const header = drawer.querySelector('.lead-mobile-drawer-header'), tabs = drawer.querySelector('[role="tablist"]'), body = tabs.parentElement.nextElementSibling;
    const rect = node => { const r = node.getBoundingClientRect(); return { x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom }; };
    const font=node=>node&&({size:getComputedStyle(node).fontSize,weight:getComputedStyle(node).fontWeight});
    const name=header.querySelector('h2'),phone=header.querySelector('p'),avatar=header.querySelector('span.rounded-full');
    const tagButtons=[...header.querySelectorAll('[aria-label^="Remover tag"]')],firstTag=tagButtons[0]?.parentElement;
    let tagRegion=firstTag?.parentElement;
    for(let candidate=tagRegion;candidate&&candidate!==header;candidate=candidate.parentElement){if(['auto','scroll'].includes(getComputedStyle(candidate).overflowY)){tagRegion=candidate;break;}}
    return { viewport: { width:innerWidth,height:innerHeight },drawer:rect(drawer),header:rect(header),tabs:rect(tabs.parentElement),body:rect(body),horizontalOverflow:drawer.scrollWidth>drawer.clientWidth+1,
      identity:{name:rect(name),phone:rect(phone),avatar:rect(avatar)},
      tags:{first:firstTag&&rect(firstTag),region:tagRegion&&rect(tagRegion),overflowY:tagRegion&&getComputedStyle(tagRegion).overflowY,maxHeight:tagRegion&&getComputedStyle(tagRegion).maxHeight,scrollHeight:tagRegion?.scrollHeight,scrollTop:tagRegion?.scrollTop},
      colors:{avatar:{background:getComputedStyle(avatar.firstElementChild).backgroundColor,color:getComputedStyle(avatar.firstElementChild).color},stages:[...header.querySelectorAll('[data-lead-stage-step]')].map(step=>({current:step.getAttribute('aria-current'),background:getComputedStyle(step).backgroundColor,color:getComputedStyle(step).color}))},
      fonts:{name:font(name),phone:font(phone),tags:tagButtons.map(node=>font(node.parentElement))},
      buttons:[...header.querySelectorAll('button')].filter(node=>node.getBoundingClientRect().width>0).map(node=>({name:node.getAttribute('aria-label')||node.textContent.trim(),...rect(node)})),writes:window.h.writes };
  });
}

for (const [width, height] of [[320,568],[360,640],[390,844]]) test(`mobile lead baseline geometry at ${width}x${height}`, async () => {
  const page = await open(width,height);
  try {
    const measured = await geometry(page); await mkdir(artifacts,{recursive:true});
    await writeFile(join(artifacts,`header-${evidencePhase}-${width}x${height}.json`),JSON.stringify(measured,null,2));
    await page.screenshot({path:join(artifacts,`header-${evidencePhase}-${width}x${height}.png`)});
    assert.equal(measured.horizontalOverflow,false,JSON.stringify(measured));
    assert.deepEqual(measured.writes,[]);
  } finally { await page.close(); }
});

for (const [width,height] of [[320,568],[360,640],[390,844]]) test(`Pipeline mobile keeps tags and actions visible below the identity without shrinking primary touch targets at ${width}x${height}`,async()=>{
  const page=await open(width,height);
  try{
    const measured=await geometry(page),evidence=JSON.stringify(measured);
    assert.ok(measured.header.height+measured.tabs.height<=360,evidence);
    assert.ok(measured.body.height>=Math.max(120,height-440),evidence);
    assert.deepEqual(measured.fonts.name,{size:'14px',weight:'400'});assert.equal(measured.fonts.phone.size,'12px');
    assert.equal(measured.fonts.tags.length,8);assert.ok(measured.fonts.tags.every(font=>font.size==='10px'&&font.weight==='300'));
    assert.equal(await page.getByRole('button',{name:/ações e tags do lead/}).count(),0);
    assert.ok(measured.tags.first.y>=measured.identity.avatar.bottom,evidence);assert.ok(Math.abs(measured.tags.first.x-measured.identity.avatar.x)<=1,evidence);
    assert.ok(measured.tags.region.height<=72,evidence);assert.ok(['auto','scroll'].includes(measured.tags.overflowY),evidence);
    assert.ok(measured.identity.phone.y-measured.identity.name.bottom<=6,evidence);
    const targets=[page.getByRole('button',{name:'Fechar detalhes do lead'}),page.getByRole('button',{name:'Copiar telefone'}),page.getByRole('button',{name:'Alterar responsável pelo lead'}),page.getByRole('combobox').filter({hasText:'Aberto'})];
    for(const target of targets){const box=await target.boundingBox();assert.ok(box.height>=40&&box.width>=40,JSON.stringify(box));}
    for(const action of[page.getByRole('button',{name:/Ligar para/}),page.getByRole('button',{name:'Chat',exact:true}),page.getByRole('button',{name:/Enviar e-mail para/})])assert.equal(await action.isVisible(),true);
    assert.equal(measured.colors.avatar.color,'rgb(255, 255, 255)');assert.match(measured.colors.avatar.background,/0\.5/);
    for(const step of measured.colors.stages.slice(0,3)){assert.equal(step.color,'rgb(255, 255, 255)');assert.equal(step.background,measured.colors.avatar.background);}
    for(const step of measured.colors.stages.slice(3))assert.notEqual(step.background,measured.colors.avatar.background);
    assert.deepEqual(await page.evaluate(()=>window.h.writes),[]);
  }finally{await page.close()}
});

test('tags remain reachable by scrolling and stay visible when opening history without performing a business write',async()=>{
  const page=await open(360,640);
  try{
    const before=await geometry(page);await page.getByRole('button',{name:/Enviar e-mail para/}).waitFor();await page.getByText('Tag sintética longa 0',{exact:true}).waitFor();
    const last=page.getByRole('button',{name:'Remover tag Tag sintética longa 7',exact:true});await last.scrollIntoViewIfNeeded();
    const scrolled=await geometry(page);assert.equal(scrolled.horizontalOverflow,false);assert.ok(scrolled.tags.scrollTop>0);assert.ok(Math.abs(scrolled.body.height-before.body.height)<=1);
    await writeFile(join(artifacts,'header-visible-tags-360x640.json'),JSON.stringify(scrolled,null,2));
    await page.screenshot({path:join(artifacts,'header-visible-tags-360x640.png')});
    await page.getByRole('tab',{name:'Histórico'}).click();await page.getByTestId('history-panel').waitFor();
    assert.equal(await page.getByRole('button',{name:/ações e tags do lead/}).count(),0);
    const after=await geometry(page);assert.ok(Math.abs(after.body.height-before.body.height)<=1);assert.equal(after.fonts.tags.length,8);
    assert.deepEqual(await page.evaluate(()=>window.h.writes),[]);
  }finally{await page.close()}
});

test('lead replacement and closing the drawer retire the previous tag scroll and selected context',async()=>{
  const page=await open(360,640);
  try{
    await page.getByRole('button',{name:'Remover tag Tag sintética longa 7',exact:true}).scrollIntoViewIfNeeded();
    await page.evaluate(()=>window.h.change({...window.h.lead,id:'lead-b',name:'Outro lead sintético',phone:null,email:'other@example.invalid'}));
    await page.getByRole('heading',{name:'Outro lead sintético',exact:true}).waitFor();
    assert.equal((await geometry(page)).tags.scrollTop,0);assert.equal(await page.getByRole('button',{name:/ações e tags do lead/}).count(),0);
    assert.equal(await page.getByText('other@example.invalid',{exact:true}).first().isVisible(),true);assert.equal(await page.getByRole('button',{name:'Copiar telefone'}).count(),0);assert.equal(await page.getByRole('button',{name:/Ligar para/}).count(),0);
    await page.getByRole('button',{name:'Remover tag Tag sintética longa 7',exact:true}).scrollIntoViewIfNeeded();
    await page.getByRole('button',{name:'Fechar detalhes do lead'}).click();await page.getByRole('dialog').waitFor({state:'detached'});
    await page.evaluate(()=>window.h.show(true));await page.getByRole('button',{name:'Fechar detalhes do lead'}).waitFor();
    assert.equal((await geometry(page)).tags.scrollTop,0);assert.equal((await geometry(page)).fonts.tags.length,8);
    assert.equal(await page.evaluate(()=>window.h.closed),1);assert.deepEqual(await page.evaluate(()=>window.h.writes),[]);
  }finally{await page.close()}
});

test('read-only access keeps tags visible while existing lead operations remain disabled',async()=>{
  const page=await open(320,568);
  try{
    await page.evaluate(()=>window.h.allowed(false));await page.getByRole('button',{name:'Mover para Etapa 1'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Mover para Etapa 1'}).isDisabled(),true);
    assert.equal(await page.getByRole('button',{name:'Alterar responsável pelo lead'}).isDisabled(),true);
    assert.equal(await page.getByRole('button',{name:/ações e tags do lead/}).count(),0);assert.equal(await page.getByText('Tag sintética longa 0',{exact:true}).isVisible(),true);
    assert.equal(await page.getByRole('button',{name:/Enviar e-mail para/}).isDisabled(),true);
    assert.equal(await page.getByRole('button',{name:/Ligar para/}).isDisabled(),true);
    assert.equal(await page.getByRole('button',{name:'Chat',exact:true}).isDisabled(),true);
    assert.deepEqual(await page.evaluate(()=>window.h.writes),[]);
  }finally{await page.close()}
});

test('keyboard tab switching retains focus and direct header actions without performing writes',async()=>{
  const page=await open(390,844);
  try{
    const actions=page.getByRole('tab',{name:'Ações',exact:true});await actions.focus();await page.keyboard.press('Enter');
    assert.equal(await actions.getAttribute('aria-selected'),'true');assert.equal(await actions.evaluate(node=>node===document.activeElement),true);
    const history=page.getByRole('tab',{name:'Histórico',exact:true});await history.focus();await page.keyboard.press('Space');await page.getByTestId('history-panel').waitFor();assert.equal(await history.evaluate(node=>node===document.activeElement),true);
    const phone=page.getByRole('button',{name:/Ligar para/});await phone.focus();assert.equal(await phone.evaluate(node=>node===document.activeElement),true);await page.keyboard.press('Tab');assert.equal(await page.getByRole('button',{name:'Chat',exact:true}).evaluate(node=>node===document.activeElement),true);
    assert.equal(await page.getByRole('button',{name:/ações e tags do lead/}).count(),0);assert.equal(await page.getByText('Tag sintética longa 0',{exact:true}).isVisible(),true);
    assert.deepEqual(await page.evaluate(()=>window.h.writes),[]);
  }finally{await page.close()}
});

test('default mobile presentation retains its visible tags, actions and original header',async()=>{
  const page=await open(360,640);
  try{
    await page.evaluate(()=>window.h.variant('default'));await page.getByRole('button',{name:/Enviar e-mail para/}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Mostrar ações e tags do lead'}).count(),0);
    assert.equal(await page.locator('[data-pipeline-mobile-header]').count(),0);
    await page.getByText('Tag sintética longa 0',{exact:true}).waitFor();
    const measured=await geometry(page);assert.equal(measured.horizontalOverflow,false);assert.ok(measured.header.height+measured.tabs.height>300);
    assert.equal(measured.fonts.tags.length,4);assert.notEqual(measured.colors.avatar.color,'rgb(255, 255, 255)');assert.doesNotMatch(measured.colors.avatar.background,/0\.5/);
    assert.deepEqual(await page.evaluate(()=>window.h.writes),[]);
  }finally{await page.close()}
});

test('Pipeline tablet presentation retains its visible tags and actions outside the mobile breakpoint',async()=>{
  const page=await open(768,1024);
  try{
    assert.equal(await page.getByRole('button',{name:'Mostrar ações e tags do lead'}).count(),0);
    await page.getByRole('button',{name:/Enviar e-mail para/}).waitFor();await page.getByText('Tag sintética longa 0',{exact:true}).waitFor();
    const measured=await geometry(page);assert.equal(measured.horizontalOverflow,false);assert.deepEqual(measured.writes,[]);
    assert.equal(measured.fonts.tags.length,8);assert.ok(measured.tags.first.y>=measured.identity.avatar.bottom);assert.ok(Math.abs(measured.tags.first.x-measured.identity.avatar.x)<=1);
    assert.equal(measured.colors.avatar.color,'rgb(255, 255, 255)');assert.match(measured.colors.avatar.background,/0\.5/);
  }finally{await page.close()}
});

test('direct header actions preserve the existing callbacks and their selected values',async()=>{
  const page=await open(360,640);
  try{
    assert.equal(await page.getByRole('button',{name:/ações e tags do lead/}).count(),0);
    await page.getByRole('button',{name:/Ligar para/}).click();await page.getByRole('button',{name:'Chat',exact:true}).click();await page.getByRole('button',{name:/Enviar e-mail para/}).click();
    await page.getByRole('button',{name:'Remover tag Tag sintética longa 0',exact:true}).click();
    await page.getByRole('button',{name:'Mover para Etapa 1',exact:true}).click();
    await page.getByRole('button',{name:'Alterar responsável pelo lead'}).click();await page.getByRole('option',{name:'Sem responsável',exact:true}).click();
    await page.getByRole('combobox').filter({hasText:'Aberto'}).click();await page.getByRole('option',{name:'Perdido',exact:true}).click();
    const writes=await page.evaluate(()=>window.h.writes);
    assert.deepEqual(writes.map(write=>write.kind),['phone','chat','email','remove-tag','move','assign','status']);
    assert.deepEqual(writes.slice(3).map(write=>write.args),[['tag-0'],['stage-1'],[null],['lost']]);
  }finally{await page.close()}
});
