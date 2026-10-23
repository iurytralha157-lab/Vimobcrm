import assert from 'node:assert/strict';
import {after,before,test} from 'node:test';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createDistributionEditorHarness} from '../../../scripts/tests/distribution-editor-runtime-harness.mjs';
let harness,dir;const evidence=[];
before(async()=>{dir=process.env.DISTRIBUTION_FEEDBACK_EVIDENCE_DIR||await mkdtemp(path.join(tmpdir(),'vimob-feedback-'));await mkdir(dir,{recursive:true});harness=await createDistributionEditorHarness()});
after(async()=>{await harness?.close();await writeFile(path.join(dir,'feedback-observations.json'),JSON.stringify(evidence,null,2))});
const field=page=>page.getByPlaceholder('Ex: Leads Facebook');
const save=page=>page.locator('[data-tour="distribution-queue-save"]');
const reload=page=>page.getByRole('button',{name:'Descartar rascunho e carregar versão atual',exact:true});
const settled=page=>page.waitForFunction(()=>!document.querySelector('fieldset[aria-label="Configuração da distribuição"]')?.disabled);
async function firstFailure(page){
  await field(page).fill('Rascunho sintético');await page.getByRole('tab',{name:'Revisão',exact:true}).click();
  await save(page).click();await page.getByRole('alert').waitFor();await settled(page);await page.waitForTimeout(60);
}
async function observe(page){await page.evaluate(()=>{
  const alert=document.querySelector('[role=alert]');window.feedbackProbe={alert,paragraph:alert.querySelector('p'),reload:alert.querySelector('button'),messages:0};
  new MutationObserver(records=>{window.feedbackProbe.messages+=records.filter(record=>record.type==='childList'||record.type==='characterData').length}).observe(alert,{childList:true,subtree:true,characterData:true});
})}
async function state(page){return page.evaluate(()=>{
  const alert=document.querySelector('[role=alert]'),scroll=innerWidth<768?document.querySelector('[data-form-wizard] > div'):document.querySelector('[data-form-wizard-content]');
  const a=alert?.getBoundingClientRect(),s=scroll.getBoundingClientRect(),probe=window.feedbackProbe;
  return {visible:Boolean(a&&a.top<s.bottom&&a.bottom>s.top),alert:a?.toJSON(),scroller:s.toJSON(),message:alert?.querySelector('p')?.textContent,
    sameAlert:probe?.alert===alert,sameReload:probe?.reload===alert?.querySelector('button'),sameParagraph:probe?.paragraph===alert?.querySelector('p'),messageMutations:probe?.messages,
    focusedRole:document.activeElement?.getAttribute('role'),saves:window.fixture.state.saves.length};
})}
async function away(page){await page.evaluate(()=>{const scroll=innerWidth<768?document.querySelector('[data-form-wizard] > div'):document.querySelector('[data-form-wizard-content]');scroll.scrollTop=scroll.scrollHeight})}
for(const [width,height] of [[375,320],[320,640],[1440,600]])test(`same error is revealed and creates a live-message update at ${width}x${height}`,async()=>{
  const {page,errors,network}=await harness.open({kind:'edit',width,height,saveStatus:'error'});
  try{
    await firstFailure(page);assert.equal((await state(page)).visible,true);await observe(page);await away(page);
    assert.equal((await state(page)).visible,false);await save(page).click();await settled(page);await page.waitForTimeout(60);
    const second=await state(page);await page.screenshot({path:path.join(dir,`feedback-identical-error-${width}x${height}.png`)});
    evidence.push({case:'same error',width,height,...second,errors,network});assert.deepEqual(errors,[]);assert.equal(second.saves,2);
    assert.equal(second.sameAlert,true,'stable alert container');assert.equal(second.sameReload,true,'recovery button must not remount');
    assert.equal(second.visible,true,'each current failed operation must reveal its feedback');
    assert.ok(second.messageMutations>0,'same message must still generate an aria-alert text/child update');
    assert.equal(second.sameParagraph,false,'only the message occurrence is replaced for reannouncement');
  }finally{await page.close()}
});
test('a different error already reveals feedback and preserves the recovery element',async()=>{
  const {page,errors}=await harness.open({kind:'edit',width:375,height:320,saveStatus:'error'});
  try{
    await firstFailure(page);await observe(page);await away(page);
    await page.evaluate(()=>window.fixture.setState({saveErrorMessage:'Outra falha sintética'}));
    await save(page).click();await settled(page);await page.waitForTimeout(60);
    const changed=await state(page);evidence.push({case:'different message',...changed,errors});
    assert.equal(changed.visible,true);assert.equal(changed.message,'Outra falha sintética');assert.equal(changed.sameAlert,true);assert.equal(changed.sameReload,true);assert.ok(changed.messageMutations>0);assert.deepEqual(errors,[]);
  }finally{await page.close()}
});
for(const change of [{actor:'viewer-b'},{sid:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}])test(`old ${'actor'in change?'actor':'SID'} operation cannot publish a late error`,async()=>{
  const {page,errors}=await harness.open({kind:'edit',saveStatus:'defer'});
  try{
    await field(page).fill('Pedido da visita antiga');await page.getByRole('tab',{name:'Revisão',exact:true}).click();await save(page).click();
    await page.waitForFunction(()=>typeof window.fixture.state.rejectSave==='function');
    await page.evaluate(change=>window.fixture.setState(change),change);await settled(page);
    await page.evaluate(()=>window.fixture.state.rejectSave(new Error('Erro de visita antiga')));await page.waitForTimeout(100);
    const alert=await page.getByRole('alert').count();evidence.push({case:'old visit',change,alerts:alert,errors});
    assert.equal(alert,0);assert.equal(await page.getByText('Erro de visita antiga',{exact:true}).count(),0);assert.deepEqual(errors,[]);
  }finally{await page.close()}
});
test('failed recovery keeps its DOM button and allows normal focus without any forced focus move',async()=>{
  const {page,errors}=await harness.open({kind:'edit',width:375,height:667,saveStatus:'error',reloadStatus:'defer'});
  try{
    await firstFailure(page);await observe(page);await reload(page).click();
    await page.waitForFunction(()=>typeof window.fixture.state.rejectReload==='function');
    await page.evaluate(()=>window.fixture.state.rejectReload(new Error('Falha sintética de recarga')));await settled(page);await page.waitForTimeout(60);
    const result=await state(page);assert.equal(result.sameAlert,true);assert.equal(result.sameReload,true);
    await reload(page).focus();await page.waitForTimeout(60);
    assert.equal(await reload(page).evaluate(node=>node===document.activeElement),true);
    evidence.push({case:'recovery DOM/focus',...result,focusAfterSettled:true,errors});assert.deepEqual(errors,[]);
  }finally{await page.close()}
});

test('revealing a current failure does not steal focus from an available dialog control',async()=>{
  const {page,errors}=await harness.open({kind:'edit',saveStatus:'defer'});
  try{
    await field(page).fill('Rascunho sintético');await page.getByRole('tab',{name:'Revisão',exact:true}).click();await save(page).click();
    await page.waitForFunction(()=>typeof window.fixture.state.rejectSave==='function');
    const close=page.getByRole('button',{name:'Close',exact:true});await close.focus();
    await page.evaluate(()=>window.fixture.state.rejectSave(new Error('Falha da operação atual')));await settled(page);await page.waitForTimeout(60);
    assert.equal(await page.getByRole('alert').count(),1);
    assert.equal(await close.evaluate(node=>node===document.activeElement),true,'revealing feedback must not call focus');
    evidence.push({case:'reveal preserves existing focus',focusedControl:'Close',errors});assert.deepEqual(errors,[]);
  }finally{await page.close()}
});

test('a repeated failed recovery also reveals and announces its new occurrence',async()=>{
  const {page,errors}=await harness.open({kind:'edit',width:375,height:320,saveStatus:'error',reloadStatus:'defer'});
  try{
    await firstFailure(page);await reload(page).click();
    await page.waitForFunction(()=>typeof window.fixture.state.rejectReload==='function');
    await page.evaluate(()=>{window.fixture.state.firstRejectReload=window.fixture.state.rejectReload;window.fixture.state.rejectReload(new Error('Falha repetida de recarga'))});
    await settled(page);await page.waitForTimeout(60);await observe(page);
    await reload(page).click();
    await page.waitForFunction(()=>window.fixture.state.rejectReload!==window.fixture.state.firstRejectReload);
    await away(page);assert.equal((await state(page)).visible,false);
    await page.evaluate(()=>window.fixture.state.rejectReload(new Error('Falha repetida de recarga')));await settled(page);await page.waitForTimeout(60);
    const second=await state(page);assert.equal(second.visible,true);assert.equal(second.sameAlert,true);assert.equal(second.sameReload,true);assert.ok(second.messageMutations>0);
    assert.deepEqual(errors,[]);evidence.push({case:'repeated failed recovery',...second,errors});
  }finally{await page.close()}
});

test('Go-trimmed 4000-code-point reply keeps its entered NEL boundaries instead of the default message',async()=>{
  const {page,errors}=await harness.open({kind:'edit',width:375,height:667});
  try{
    await page.getByRole('tab',{name:'Critérios de entrada',exact:true}).click();
    await page.getByRole('combobox',{name:'Tipo de critério de entrada',exact:true}).click();
    await page.getByRole('option',{name:'Campanha de WhatsApp',exact:true}).click();
    await page.getByRole('combobox',{name:'Conexão WhatsApp *',exact:true}).click();
    await page.getByRole('option',{name:'Conexão de teste',exact:true}).click();
    await page.getByLabel('Mensagem contém',{exact:true}).fill('campanha sintética');
    await page.getByRole('tab',{name:'Resposta no WhatsApp',exact:true}).click();
    await page.getByRole('switch',{name:'Enviar resposta automática após distribuir',exact:true}).click();
    const entered='\u0085'+'😀'.repeat(4000)+'\u0085';
    const message=page.getByLabel('Mensagem',{exact:true});await message.fill(entered);
    assert.equal(await message.inputValue(),entered);
    await page.getByRole('button',{name:'Avançar',exact:true}).click();
    await page.getByRole('tab',{name:'Revisão',selected:true}).waitFor();
    assert.equal(await save(page).isEnabled(),true);await save(page).click();await settled(page);
    const sent=await page.evaluate(()=>window.fixture.state.saves[0]?.settings.whatsapp_distribution_auto_reply_message);
    assert.equal(sent,entered,'the internal fallback must use the same boundary count as form validation');
    evidence.push({case:'RFA04 NEL reply payload',codePoints:Array.from(sent).length,preserved:true,errors});assert.deepEqual(errors,[]);
  }finally{await page.close()}
});
