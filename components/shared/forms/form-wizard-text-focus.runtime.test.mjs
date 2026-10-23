import assert from 'node:assert/strict';
import {after,before,test} from 'node:test';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const require=createRequire(path.join(root,'package.json'));
const ts=require('typescript');
const {chromium}=require('@playwright/test');
let directory,browser,bundle;

before(async()=>{
  directory=process.env.TEXT_FOCUS_EVIDENCE_DIR || await mkdtemp(path.join(tmpdir(),'vimob-text-focus-'));
  const {mkdir}=await import('node:fs/promises');await mkdir(directory,{recursive:true});
  // Use the actual Teams consumer's dialog shell, with its unrelated layout
  // boundary inert. This does not claim TeamEditorScreen business-flow E2E.
  const teamPath=path.join(root,'components/features/teams/TeamEditorScreen.tsx');
  const teamSource=await readFile(teamPath,'utf8');
  const teamAst=ts.createSourceFile(teamPath,teamSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const teamDialog=teamAst.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='TeamEditorDialog');
  assert.ok(teamDialog,'Teams consumer shell must remain part of this integration test');
  const entry=path.join(directory,'fixture.tsx');
  await writeFile(entry,`
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {FormWizardDiscardDialog} from '@/components/shared/forms/FormWizardDiscardDialog';
import {DistributionQueueWhatsAppAutoReplySection} from '@/components/features/round-robin/distribution-queue-editor/DistributionQueueWhatsAppAutoReplySection';
import {Dialog,DialogContent,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {FORM_WIZARD_DIALOG_CLASS_NAME} from '@/config/form-wizard';
function AppLayout({children}){return <main>{children}</main>}
${teamDialog.getText(teamAst)}
function FocusEditor({kind}){
  const [discard,setDiscard]=useState(false),[editing,setEditing]=useState(true),[busy,setBusy]=useState(false),[showName,setShowName]=useState(true);
  const close=()=>{if(!busy)setDiscard(true)};
  window.focusFixture={setEditing,setBusy,setShowName};
  const discardDialog=<FormWizardDiscardDialog open={discard} onOpenChange={setDiscard} busy={busy} onConfirm={()=>setEditing(false)}/>;
  if(!editing)return <button id="after-discard">Editor desmontado</button>;
  const fields=<>{showName&&<><label htmlFor="editor-name">Nome sintético</label><input id="editor-name" defaultValue="Sintético"/></>}<button id="cancel-editor" onClick={close}>Cancelar edição</button></>;
  if(kind==='teams')return <TeamEditorDialog title="Equipe sintética" onClose={close} busy={busy} discardDialog={discardDialog}>{fields}</TeamEditorDialog>;
  return <><Dialog open onOpenChange={open=>{if(!open)close()}}><DialogContent aria-describedby={undefined}><DialogHeader><DialogTitle>Editor sintético</DialogTitle></DialogHeader>{fields}</DialogContent></Dialog>{discardDialog}</>;
}
function Fixture(){
  const [mode,setMode]=useState('unicode'),[message,setMessage]=useState('Mensagem sintética');
  window.fixture={setMode,setMessage};
  if(mode!=='unicode')return <FocusEditor key={mode} kind={mode}/>;
  return <DistributionQueueWhatsAppAutoReplySection open settings={{whatsapp_distribution_auto_reply_enabled:true,whatsapp_distribution_auto_reply_message:message}} onToggle={()=>{}} onSettingsChange={patch=>{if('whatsapp_distribution_auto_reply_message'in patch)setMessage(patch.whatsapp_distribution_auto_reply_message)}}/>;
}
createRoot(document.getElementById('app')).render(<Fixture/>);
`);
  const loader=path.join(directory,'loader.cjs');
  await writeFile(loader,`const ts=require(${JSON.stringify(path.join(root,'node_modules/typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;`);
  const {webpack}=require('next/dist/compiled/webpack/webpack');
  await new Promise((resolve,reject)=>{
    const compiler=webpack({mode:'development',target:'web',devtool:false,entry,output:{path:directory,filename:'fixture.js'},resolve:{extensions:['.tsx','.ts','.js'],alias:{'@':root},modules:[path.join(root,'node_modules'),'node_modules']},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:loader}]},optimization:{minimize:false,usedExports:true}});
    compiler.run((error,stats)=>compiler.close(()=>error||stats?.hasErrors()?reject(error||new Error(stats.toString({all:false,errors:true}))):resolve()));
  });
  bundle=await readFile(path.join(directory,'fixture.js'),'utf8');
  browser=await chromium.launch({headless:true});
});
after(async()=>{await browser?.close()});

async function openFixture(mode='unicode'){
  const page=await browser.newPage({viewport:{width:1100,height:850}}),errors=[],network=[];
  page.setDefaultTimeout(5000);page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{
    network.push(route.request().url());
    return route.request().url()==='http://text-focus-fixture.local/'?route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><style>.vimob-dialog-content{position:fixed;top:20%;left:15%;width:70%;background:white;padding:24px}.vimob-dialog-overlay{position:fixed;inset:0;background:#ddd8}button,input,textarea{margin:8px}textarea{width:600px;height:180px}</style></head><body><div id="app"></div></body></html>'}):route.abort();
  });
  await page.goto('http://text-focus-fixture.local/');await page.addScriptTag({content:bundle});
  await page.waitForFunction(()=>Boolean(window.fixture));
  if(mode!=='unicode'){await page.evaluate(mode=>window.fixture.setMode(mode),mode);await page.getByRole('dialog').waitFor()}
  return {page,errors,network};
}

for(const amount of [2000,4000])test(`Unicode browser accepts ${amount} complete emoji code points`,async()=>{
  const {page,errors}=await openFixture();
  try{
    const field=page.locator('#distribution-whatsapp-auto-reply-message');
    await field.fill('😀'.repeat(amount));
    assert.equal(Array.from(await field.inputValue()).length,amount);
    assert.deepEqual(errors,[]);
  }finally{await page.close()}
});

test('existing 4000-emoji message remains editable without truncation or a split surrogate',async()=>{
  const {page,errors}=await openFixture();
  try{
    const field=page.locator('#distribution-whatsapp-auto-reply-message');
    await page.evaluate(()=>window.fixture.setMessage('😀'.repeat(4000)));
    await page.waitForFunction(()=>document.querySelector('textarea')?.value.length===8000);
    await field.focus();await page.keyboard.press('Control+End');await page.keyboard.press('Backspace');await page.keyboard.insertText('🚀');
    const current=await field.inputValue();
    assert.equal(Array.from(current).length,4000);assert.ok(current.endsWith('🚀'));
    await field.fill('a'.repeat(3999));await page.keyboard.press('Control+End');await page.keyboard.insertText('😀');
    assert.equal(await field.inputValue(),'a'.repeat(3999)+'😀');assert.deepEqual(errors,[]);
  }finally{await page.close()}
});

test('over-limit legacy text stays visible and reports the same code-point bound',async()=>{
  const {page,errors}=await openFixture();
  try{
    const field=page.locator('#distribution-whatsapp-auto-reply-message');
    await page.evaluate(()=>window.fixture.setMessage('😀'.repeat(4001)));
    await page.waitForFunction(()=>document.querySelector('textarea')?.value.length===8002);
    assert.equal(Array.from(await field.inputValue()).length,4001);
    assert.equal(await field.getAttribute('aria-invalid'),'true');
    assert.match(await page.getByRole('alert').innerText(),/4000|4\.000/);assert.deepEqual(errors,[]);
  }finally{await page.close()}
});

for(const kind of ['distribution','teams']){
  for(const cancelMode of ['mouse','keyboard'])test(`${kind} discard cancellation via ${cancelMode} restores the original input`,async()=>{
    const {page,errors}=await openFixture(kind);
    try{
      const input=page.locator('#editor-name');await input.fill('Alteração não salva');await input.focus();
      await page.keyboard.press('Escape');await page.getByRole('alertdialog').waitFor();
      if(cancelMode==='mouse')await page.getByRole('button',{name:'Continuar editando',exact:true}).click();
      else await page.keyboard.press('Enter');
      await page.getByRole('alertdialog').waitFor({state:'detached'});
      await page.waitForTimeout(80);
      assert.equal(await input.evaluate(node=>node===document.activeElement),true);
      assert.deepEqual(errors,[]);
    }finally{await page.close()}
  });

  test(`${kind} mouse opener restores its button, while confirmed discard never refocuses a removed editor`,async()=>{
    const {page,errors}=await openFixture(kind);
    try{
      const opener=page.locator('#cancel-editor');await opener.click();
      await page.getByRole('button',{name:'Continuar editando',exact:true}).click();await page.waitForTimeout(80);
      assert.equal(await opener.evaluate(node=>node===document.activeElement),true);
      await page.locator('#editor-name').focus();await page.keyboard.press('Escape');
      await page.getByRole('button',{name:'Descartar alterações',exact:true}).click();
      await page.locator('#after-discard').waitFor();await page.waitForTimeout(80);
      assert.equal(await page.locator('#editor-name').count(),0);
      assert.notEqual(await page.evaluate(()=>document.activeElement?.id),'editor-name');
      assert.deepEqual(errors,[]);
    }finally{await page.close()}
  });

  test(`${kind} recaptures the origin on each opening and skips a disconnected input`,async()=>{
    const {page,errors}=await openFixture(kind);
    try{
      const input=page.locator('#editor-name'),opener=page.locator('#cancel-editor');
      await input.focus();await page.keyboard.press('Escape');
      await page.getByRole('button',{name:'Continuar editando',exact:true}).click();await page.waitForTimeout(80);
      assert.equal(await input.evaluate(node=>node===document.activeElement),true);
      await opener.click();await page.getByRole('button',{name:'Continuar editando',exact:true}).click();await page.waitForTimeout(80);
      assert.equal(await opener.evaluate(node=>node===document.activeElement),true);
      await input.focus();await page.keyboard.press('Escape');await page.getByRole('alertdialog').waitFor();
      await page.evaluate(()=>window.focusFixture.setShowName(false));
      await page.waitForFunction(()=>!document.getElementById('editor-name'));
      await page.getByRole('button',{name:'Continuar editando',exact:true}).click();await page.waitForTimeout(80);
      assert.equal(await page.getByRole('alertdialog').count(),0);
      assert.equal(await page.getByRole('dialog').count(),1);
      assert.notEqual(await page.evaluate(()=>document.activeElement?.id),'editor-name');
      assert.deepEqual(errors,[]);
    }finally{await page.close()}
  });

  test(`${kind} busy confirmation preserves the open dialog until editing resumes`,async()=>{
    const {page,errors}=await openFixture(kind);
    try{
      const input=page.locator('#editor-name');await input.focus();await page.keyboard.press('Escape');await page.getByRole('alertdialog').waitFor();
      await page.evaluate(()=>window.focusFixture.setBusy(true));
      assert.equal(await page.getByRole('button',{name:'Continuar editando',exact:true}).isDisabled(),true);
      assert.equal(await page.getByRole('button',{name:'Descartar alterações',exact:true}).isDisabled(),true);
      await page.keyboard.press('Escape');assert.equal(await page.getByRole('alertdialog').count(),1);
      await page.evaluate(()=>window.focusFixture.setBusy(false));
      await page.getByRole('button',{name:'Continuar editando',exact:true}).click();await page.waitForTimeout(80);
      assert.equal(await input.evaluate(node=>node===document.activeElement),true);assert.deepEqual(errors,[]);
    }finally{await page.close()}
  });
}
