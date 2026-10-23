import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
let directory, browser, page;
const errors = [];

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'vimob-distribution-controls-'));
  const loader = path.join(directory, 'loader.cjs');
  const boundary = path.join(directory, 'boundaries.tsx');
  const entry = path.join(directory, 'fixture.tsx');
  await writeFile(loader, `const ts=require(${JSON.stringify(path.join(root, 'node_modules/typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;`);
  await writeFile(boundary, `export const PropertyPickerDialog=()=>null;export const useCreateTag=()=>({isPending:false});export const useUserPermissions=()=>({hasPermission:()=>false});export const toast={success:()=>{},error:()=>{}};`);
  await writeFile(entry, `import React from 'react';import {createRoot} from 'react-dom/client';
    import {Dialog,DialogContent,DialogHeader,DialogTitle} from '@/components/ui/dialog';
    import {FORM_WIZARD_DIALOG_CLASS_NAME} from '@/config/form-wizard';
    import {DistributionQueueBasicSection as Basic} from '@/components/features/round-robin/distribution-queue-editor/DistributionQueueBasicSection';
    import {DistributionQueueConditionValueEditor as Condition} from '@/components/features/round-robin/distribution-queue-editor/DistributionQueueConditionValueEditor';
    import {DistributionQueueMembersSection as Members} from '@/components/features/round-robin/distribution-queue-editor/DistributionQueueMembersSection';
    import {DistributionQueueRulesSection as Rules} from '@/components/features/round-robin/distribution-queue-editor/DistributionQueueRulesSection';
    import {DISTRIBUTION_QUEUE_CONDITION_TYPES} from '@/lib/round-robin/distribution-queue-form';
    const pipelines=Array.from({length:28},(_,i)=>({id:'pipe-'+i,name:'Pipeline '+i+' com nome extenso para testar o limite de largura do menu',is_active:i!==26,deleted_at:i===27?'2026-10-21':null}));
    const stages=Array.from({length:9},(_,i)=>({id:'stage-'+i,name:'Estágio '+i+' com nome extenso para testar o limite de largura do menu',pipeline_id:i===8?'other-pipe':'pipe-0',is_active:i!==6,deleted_at:i===7?'2026-10-21':null}));
    const users=Array.from({length:40},(_,i)=>({id:'user-'+i,name:'Pessoa Sintética '+i,email:'pessoa'+i+'@example.invalid'}));
    const teams=Array.from({length:30},(_,i)=>({id:'team-'+i,name:'Equipe Sintética '+i,members:[]}));
    const sessions=[{id:'session-a',display_name:'Conexão sintética com nome bastante longo para testar limites',status:'connected'}];
    const defaults={name:'Fila sintética',strategy:'weighted',targetPipelineId:'pipe-0',targetStageId:'stage-0',pipelines,stages};
    const initialMembers=users.slice(0,3).map((u,i)=>({id:'row-'+i,type:'user',entityId:u.id,name:u.name,weight:1,isActive:true}));
    function Fixture(){
      const [mode,setMode]=React.useState('basic');const [basic,setBasic]=React.useState(defaults);const [condition,setCondition]=React.useState({id:'condition-a',type:'source',values:[]});const [members,setMembers]=React.useState(initialMembers);const [epoch,setEpoch]=React.useState(0);const requestedEpoch=React.useRef(0);
      const records=React.useRef({changes:[],added:[]});
      window.fixture={show:(next,patch={})=>{records.current={changes:[],added:[]};setBasic({...defaults,...patch});setCondition({id:'condition-a',type:patch.conditionType||'source',values:[]});setMembers(initialMembers);setMode(next);setEpoch(++requestedEpoch.current);return requestedEpoch.current},get basic(){return basic},get records(){return records.current}};
      const change=(key,value)=>{records.current.changes.push({key,value});setBasic(current=>({...current,[key]:value}))};
      const baseProps={...basic,open:true,onToggle:()=>{},onNameChange:value=>change('name',value),onStrategyChange:value=>change('strategy',value),onPipelineChange:value=>change('targetPipelineId',value),onStageChange:value=>change('targetStageId',value)};
      const update=(_id,patch)=>setCondition(current=>({...current,...patch}));
      const conditionProps={condition,incomingWebhooks:[{id:'webhook-a',name:'Webhook sintético'}],whatsappSessions:sessions,activeWhatsAppSessions:sessions,campaignWhatsAppSessions:sessions,metaForms:[],metaFormsLoading:false,metaFormsFetching:false,metaFormsError:false,tags:[],tagsLoading:false,tagsError:false,properties:[],hasPropertiesModule:false,onUpdate:update};
      const add=(type,id)=>{records.current.added.push({type,id});setMembers(current=>[...current,{id:'added-'+id,type,entityId:id,name:type==='user'?users.find(u=>u.id===id).name:teams.find(t=>t.id===id).name,weight:1,isActive:true}])};
      return <Dialog open><DialogContent data-management-editor="distribution" className={FORM_WIZARD_DIALOG_CLASS_NAME} aria-describedby={undefined} onInteractOutside={e=>e.preventDefault()}><DialogHeader className="px-4 py-3"><DialogTitle>Controles da distribuição</DialogTitle></DialogHeader><div data-fixture-epoch={epoch} className="min-h-0 flex-1 overflow-y-auto p-4">
        {mode==='basic'&&<Basic {...baseProps}/>}{mode==='two-basic'&&<><Basic {...baseProps}/><Basic {...baseProps}/></>}
        {mode==='condition'&&<Condition {...conditionProps}/>}
        {mode==='rules'&&<Rules {...conditionProps} open conditions={[condition]} availableConditionTypes={DISTRIBUTION_QUEUE_CONDITION_TYPES} hasWhatsAppMessageCondition={false} hasValidCriteria={false} onToggle={()=>{}} onAddCondition={()=>{}} onUpdateCondition={update} onRemoveCondition={()=>{}} onIgnoreAvailabilityChange={()=>{}}/>}
        {mode==='members'&&<Members open members={members} strategy="weighted" visibleTeams={teams} selectableTeams={teams.filter(t=>!members.some(m=>m.type==='team'&&m.entityId===t.id))} selectableUsers={users.filter(u=>!members.some(m=>m.type==='user'&&m.entityId===u.id))} users={users} teamSelectMessage={null} teamsLoading={false} usersLoading={false} totalTeams={teams.length} activeTeams={teams.length} isActive onToggle={()=>{}} onDragEnd={()=>{}} onAddUser={id=>add('user',id)} onAddTeam={id=>add('team',id)} onUpdateWeight={()=>{}} onRemove={()=>{}} onReenroll={()=>{}}/>}
      </div></DialogContent></Dialog>;
    }createRoot(document.getElementById('app')).render(<Fixture/>);`);
  const aliases = Object.fromEntries(['hooks/use-tags', 'hooks/use-user-permissions', 'components/features/properties/PropertyPickerDialog'].map(name => [`@/${name}$`, boundary]));
  // Optional external byte snapshot makes the same interaction tests prove the
  // pre-fix failure without copying or rewriting application code in the repo.
  if (process.env.VIMOB_DISTRIBUTION_UI_BEFORE) {
    for (const name of ['Basic', 'ConditionValueEditor', 'Members', 'Rules']) {
      const file = name === 'ConditionValueEditor' ? 'DistributionQueueConditionValueEditor' : `DistributionQueue${name}Section`;
      aliases[`@/components/features/round-robin/distribution-queue-editor/${file}$`] = path.join(process.env.VIMOB_DISTRIBUTION_UI_BEFORE, `${file}.tsx`);
    }
  }
  const { webpack } = require('next/dist/compiled/webpack/webpack');
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode:'development', target:'web', devtool:false, entry, output:{path:directory,filename:'fixture.js'}, resolve:{extensions:['.tsx','.ts','.js'],alias:{...aliases,'sonner$':boundary,'@':root},modules:[path.join(root,'node_modules'),'node_modules']},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:loader}]},optimization:{minimize:false,usedExports:true} });
    compiler.run((error,stats)=>compiler.close(()=>error||stats?.hasErrors()?reject(error||new Error(stats.toString({all:false,errors:true}))):resolve()));
  });
  const cssSource = (await readFile(path.join(root,'app/globals.css'),'utf8')).replace('@import "tailwindcss";','@import "tailwindcss" source(none);');
  const cssPaths = ['components/ui','components/features/round-robin/distribution-queue-editor','components/shared/SearchableTagPicker.tsx','config/form-wizard.ts'];
  const css = await require('postcss')([require('@tailwindcss/postcss')({base:root})]).process(`${cssSource}\n${cssPaths.map(name=>`@source "${root.replaceAll('\\','/')}/${name}";`).join('\n')}`,{from:path.join(root,'app/distribution-controls-fixture.css')});
  browser = await chromium.launch({headless:true});page = await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(6000);
  page.on('pageerror', error=>errors.push(error.message));
  await page.route('**/*',route=>route.request().url()==='http://distribution-controls.local/'?route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="pt-BR"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css.css}</style><div id="app"></div></html>`}):route.abort());
  await page.goto('http://distribution-controls.local/');await page.addScriptTag({content:await readFile(path.join(directory,'fixture.js'),'utf8')});await page.waitForFunction(()=>Boolean(window.fixture));
});

after(async()=>{
  await browser?.close();
  if(directory){
    const resolved=path.resolve(directory);
    assert.equal(path.dirname(resolved),path.resolve(tmpdir()));
    assert.ok(path.basename(resolved).startsWith('vimob-distribution-controls-'));
    await rm(resolved,{recursive:true,force:true});
  }
});

async function show(mode, patch={}) {
  if(await page.locator('.vimob-popover-content').count()){await page.keyboard.press('Escape');await page.waitForTimeout(220);}
  const epoch=await page.evaluate(({mode,patch})=>window.fixture.show(mode,patch),{mode,patch});
  await page.locator(`[data-fixture-epoch="${epoch}"]`).waitFor();
}
async function assertFits(locator, width, height) {
  await locator.waitFor();await page.waitForTimeout(250);const rect=await locator.boundingBox();
  assert.ok(rect && rect.x>=-1 && rect.y>=-1 && rect.x+rect.width<=width+1 && rect.y+rect.height<=height+1,`menu must fit ${width}x${height}: ${JSON.stringify(rect)}`);
}

for (const [type,label] of [['source','Facebook'],['webhook','Webhook sintético'],['whatsapp_session','Conexão sintética com nome bastante longo para testar limites'],['website_category','Venda']]) {
  test(`criterion ${type} has a native, announced keyboard toggle`,async()=>{
    await show('condition',{conditionType:type});const option=page.getByRole('button',{name:label,exact:true});
    assert.equal(await option.getAttribute('aria-pressed'),'false');assert.equal(await option.evaluate(e=>e.tabIndex),0);
    await option.focus();await page.keyboard.press('Space');assert.equal(await option.getAttribute('aria-pressed'),'true');
    await page.keyboard.press('Enter');assert.equal(await option.getAttribute('aria-pressed'),'false');
  });
}

test('basic labels target the actual input and selects, uniquely per instance',async()=>{
  await show('two-basic');const ids=await page.locator('input[id],button[id][role=combobox]').evaluateAll(items=>items.map(e=>e.id));assert.equal(ids.length,8);assert.equal(new Set(ids).size,8);
  await show('basic');const name=page.getByLabel('Nome da fila *',{exact:true});assert.equal(await name.count(),1);await page.locator('label').filter({hasText:'Nome da fila *'}).click();assert.equal(await name.evaluate(e=>e===document.activeElement),true);
  for(const label of ['Estrategia','Pipeline de destino *','Estagio inicial *'])assert.equal(await page.getByRole('combobox',{name:label,exact:true}).count(),1,label);
});

test('new destinations exclude inactive, deleted and foreign stages',async()=>{
  await show('basic');await page.getByRole('combobox').nth(1).click();assert.equal(await page.getByRole('option').count(),26);assert.equal(await page.getByRole('option',{name:/Pipeline 26 |Pipeline 27 /}).count(),0);await page.keyboard.press('Escape');await page.waitForTimeout(220);
  await page.getByRole('combobox').nth(2).click();assert.equal(await page.getByRole('option').count(),6);assert.equal(await page.getByRole('option',{name:/Estágio [678] /}).count(),0);
});

test('an unavailable saved destination stays visible without any implicit change',async()=>{
  await show('basic',{targetPipelineId:'pipe-26',targetStageId:'stage-6'});
  const pipeline=page.getByRole('combobox').nth(1);assert.match(await pipeline.innerText(),/Pipeline 26.*indisponível/);assert.equal(await page.getByRole('combobox').nth(2).isDisabled(),true);
  assert.deepEqual(await page.evaluate(()=>window.fixture.records.changes),[]);assert.equal(await page.evaluate(()=>window.fixture.basic.targetPipelineId),'pipe-26');assert.equal(await page.evaluate(()=>window.fixture.basic.targetStageId),'stage-6');
  await pipeline.click();assert.equal(await page.getByRole('option',{name:/Pipeline 26 /}).getAttribute('aria-disabled'),'true');await page.keyboard.press('Escape');await page.waitForTimeout(220);
  await show('basic',{targetStageId:'stage-missing'});assert.match(await page.getByRole('combobox').nth(2).innerText(),/Estágio selecionado.*indisponível/);assert.deepEqual(await page.evaluate(()=>window.fixture.records.changes),[]);
});

test('a saved inactive stage can be retained, and changes only after an explicit active choice',async()=>{
  await show('basic',{targetStageId:'stage-6'});
  const stage=page.getByRole('combobox',{name:'Estagio inicial *',exact:true});
  assert.match(await stage.innerText(),/Estágio 6.*indisponível/);assert.equal(await stage.isDisabled(),false);
  assert.deepEqual(await page.evaluate(()=>window.fixture.records.changes),[]);
  await stage.click();assert.equal(await page.getByRole('option',{name:/Estágio 6 /}).getAttribute('aria-disabled'),'true');
  await page.getByRole('option',{name:/Estágio 1 /}).click();
  assert.deepEqual(await page.evaluate(()=>window.fixture.records.changes),[{key:'targetStageId',value:'stage-1'}]);
  assert.equal(await page.evaluate(()=>window.fixture.basic.targetPipelineId),'pipe-0');
});

for(const [width,height] of [[320,640],[375,320],[1440,900]]) {
  test(`all destination and criterion menus fit ${width}x${height}`,async()=>{
    await page.setViewportSize({width,height});await show('basic');
    for(const index of [1,2]){const trigger=page.getByRole('combobox').nth(index);await trigger.click();await assertFits(page.getByRole('listbox'),width,height);await page.keyboard.press('End');await page.keyboard.press('Escape');await page.waitForTimeout(220);assert.equal(await trigger.evaluate(e=>e===document.activeElement),true);}
    await show('rules');const criterion=page.getByRole('combobox',{name:'Tipo de critério de entrada',exact:true});await criterion.click();await assertFits(page.getByRole('listbox'),width,height);await page.keyboard.press('Escape');await page.waitForTimeout(220);
    await show('condition',{conditionType:'whatsapp_message_contains'});await page.getByRole('combobox',{name:'Conexão WhatsApp *',exact:true}).click();await assertFits(page.getByRole('listbox'),width,height);await page.keyboard.press('Escape');await page.waitForTimeout(220);
  });
  test(`participant menus have named search, fit and return focus at ${width}x${height}`,async()=>{
    await page.setViewportSize({width,height});await show('members');
    for(const [triggerName,searchName,term] of [['Buscar e adicionar usuário','Buscar usuário por nome ou e-mail','pessoa10'],['Buscar e adicionar equipe','Buscar equipe por nome','Equipe Sintética 12']]){
      const trigger=page.getByRole('combobox',{name:triggerName,exact:true});await trigger.click();await assertFits(page.locator('.vimob-popover-content').last(),width,height);const input=page.getByRole('combobox',{name:searchName,exact:true});await input.waitFor();await input.fill(term);await page.waitForTimeout(60);await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await page.waitForTimeout(250);assert.equal(await page.locator('.vimob-popover-content').count(),0);assert.equal(await trigger.evaluate(e=>e===document.activeElement),true);
    }
    assert.deepEqual(await page.evaluate(()=>window.fixture.records.added),[{type:'user',id:'user-10'},{type:'team',id:'team-12'}]);
  });
}

test('the real controls did not throw browser errors',()=>assert.deepEqual(errors,[]));
