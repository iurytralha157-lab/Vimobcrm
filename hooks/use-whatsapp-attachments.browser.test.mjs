import assert from 'node:assert/strict';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from '@playwright/test';
import { buildReactBrowserHarness, transpileBrowserTestModule as transpile } from './whatsapp-react-browser-test-harness.mjs';

const repository = process.cwd();
const script = buildReactBrowserHarness({ repository, modules: {
  '@/components/features/whatsapp/message-media': transpile(join(repository, 'components/features/whatsapp/message-media.ts')),
  attachments: transpile(process.env.WHATSAPP_ATTACHMENTS_BASELINE_PATH || join(repository, 'hooks/use-whatsapp-attachments.ts')),
}, entry: `
const {useWhatsAppAttachments}=require('attachments');
const root=createRoot(document.getElementById('root'));
const originalCreate=URL.createObjectURL.bind(URL),originalRevoke=URL.revokeObjectURL.bind(URL);
const h=window.harness={scopeKey:'scope-a',disabled:false,allowScopeAdoption:false,calls:[],verificationModes:[],created:[],revoked:[],pending:[],automatic:null,
 render(patch={}){Object.assign(this,patch);flushSync(()=>root.render(React.createElement(View)));},
 file(name,size=4,type='image/png'){return new File([new Uint8Array(size)],name,{type});},
 add(names){flushSync(()=>h.hook.addFiles(names.map(name=>h.file(name))));},
 start(){this.promises=this.promises||[];const result=this.hook.send();this.promises.push(result);return result;},
 resolve(outcome='queued',index=0){this.pending.splice(index,1)[0](outcome);},
 unmount(){flushSync(()=>root.unmount());}
};
URL.createObjectURL=file=>{const url=originalCreate(file);h.created.push(url);return url;};
URL.revokeObjectURL=url=>{h.revoked.push(url);originalRevoke(url);};
function View(){const hook=useWhatsAppAttachments({scopeKey:h.scopeKey,disabled:h.disabled,allowScopeAdoption:h.allowScopeAdoption,
 onSend:(file,caption,context)=>{h.calls.push({name:file.name,caption,context,scope:h.scopeKey});h.verificationModes.push(context.verificationOnly);if(h.throwNext){h.throwNext=false;throw Error('Synthetic attachment failure');}return h.automatic?Promise.resolve(h.automatic):new Promise(resolve=>h.pending.push(resolve));}});
 React.useLayoutEffect(()=>{h.hook=hook;});return React.createElement('div',null,hook.entries.map(entry=>entry.file.name).join(','));}
h.render();
` });
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });
async function open(t) {
  const page = await browser.newPage(), errors = [];
  page.setDefaultTimeout(10_000);
  await page.route('**/*', route => route.abort());
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => { try { assert.deepEqual(errors, []); } finally { await page.close(); } });
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: script });
  return page;
}
const wait = (page, count) => page.waitForFunction(count => window.harness.calls.length === count, count);
const idle = page => page.waitForFunction(() => !window.harness.hook.busy);
const snapshot = page => page.evaluate(() => { const h = window.harness; return {
  names:h.hook.entries.map(entry=>entry.file.name), captions:h.hook.entries.map(entry=>entry.caption),
  outcomes:h.hook.entries.map(entry=>entry.outcome||null), busy:h.hook.busy,error:h.hook.error,
  calls:h.calls.map(call=>({name:call.name,caption:call.caption,scope:call.scope})),created:h.created,revoked:h.revoked,
}; });

test('attachment selection prepares bytes and captions; batch sends sequentially and releases URLs', async t => {
  const page = await open(t);
  await page.evaluate(() => { const h=window.harness;h.add(['one.png','two.png']);h.hook.setCaption(h.hook.entries[0].id,'Legenda do primeiro'); });
  assert.equal((await snapshot(page)).calls.length, 0);
  await page.evaluate(() => { window.harness.start(); }); await wait(page, 1);
  assert.deepEqual((await snapshot(page)).calls[0],{name:'one.png',caption:'Legenda do primeiro',scope:'scope-a'});
  await page.evaluate(() => window.harness.resolve()); await wait(page, 2);
  assert.deepEqual((await snapshot(page)).names,['two.png']);
  await page.evaluate(() => window.harness.resolve()); await idle(page);
  const value=await snapshot(page);assert.deepEqual(value.names,[]);assert.deepEqual(value.revoked,value.created);
});

for (const outcome of ['failed','unconfirmed','cancelled','throw']) test(`attachment ${outcome} stops a sequential batch and preserves remaining files`, async t => {
  const page=await open(t);await page.evaluate(outcome => {const h=window.harness;h.add(['one.png','two.png']);h.throwNext=outcome==='throw';h.start();},outcome);await wait(page,1);
  if(outcome!=='throw') await page.evaluate(outcome=>window.harness.resolve(outcome),outcome);
  await idle(page);const value=await snapshot(page);
  assert.equal(value.calls.length,1);assert.deepEqual(value.names,['one.png','two.png']);
  assert.equal(value.outcomes[0],outcome==='throw'?'failed':outcome);assert.notEqual(value.error,'');assert.deepEqual(value.revoked,[]);
  if(outcome==='unconfirmed'){await page.evaluate(()=>{const h=window.harness;h.hook.setCaption(h.hook.entries[0].id,'Changed');});assert.equal((await snapshot(page)).captions[0],'');}
});

test('attachment double click cannot send the same batch twice before a React commit', async t => {
  const page=await open(t);await page.evaluate(()=>{const h=window.harness;h.add(['one.png']);h.start();h.start();});await wait(page,1);
  await page.evaluate(()=>window.harness.resolve());await idle(page);assert.equal((await snapshot(page)).calls.length,1);
});

test('attachment Verify mode belongs to the same file and immutable caption until terminal resolution', async t => {
  const page = await open(t);
  await page.evaluate(() => { const h = window.harness; h.add(['one.png']); h.hook.setCaption(h.hook.entries[0].id, 'Original'); h.start(); }); await wait(page, 1);
  await page.evaluate(() => window.harness.resolve('unconfirmed')); await idle(page);
  await page.evaluate(() => { const h = window.harness; h.hook.setCaption(h.hook.entries[0].id, 'Changed'); h.start(); }); await wait(page, 2);
  await page.evaluate(() => window.harness.resolve('unconfirmed')); await idle(page);
  await page.evaluate(() => { window.harness.start(); }); await wait(page, 3);
  await page.evaluate(() => window.harness.resolve('failed')); await idle(page);
  await page.evaluate(() => { const h = window.harness; h.hook.setCaption(h.hook.entries[0].id, 'Explicit retry'); h.start(); }); await wait(page, 4);
  assert.deepEqual(await page.evaluate(() => window.harness.verificationModes), [false, true, true, false]);
  assert.deepEqual((await snapshot(page)).calls.map(call => call.caption), ['Original', 'Original', 'Original', 'Explicit retry']);
  assert.equal(await page.evaluate(() => window.harness.calls.every(call => call.name === 'one.png')), true);
  await page.evaluate(() => window.harness.resolve('queued')); await idle(page); assert.deepEqual((await snapshot(page)).names, []);
});

test('attachment size boundary is 5 MiB, refuses empty/oversized files and limits preparation to ten',async t=>{
  const page=await open(t);await page.evaluate(()=>{const h=window.harness;h.hook.addFiles([h.file('exact',5*1024*1024),h.file('too-large',5*1024*1024+1),h.file('empty',0)]);});
  await page.waitForFunction(()=>window.harness.hook.entries.length===1);assert.deepEqual((await snapshot(page)).names,['exact']);assert.notEqual((await snapshot(page)).error,'');
  await page.evaluate(()=>window.harness.add(Array.from({length:12},(_,i)=>'next-'+i)));await page.waitForFunction(()=>window.harness.hook.entries.length===10);
  assert.equal((await snapshot(page)).created.length,10);assert.equal((await snapshot(page)).calls.length,0);
});

test('attachment paste/drop prepare files without sending and text drops keep native behavior',async t=>{
  const page=await open(t);const result=await page.evaluate(()=>{const h=window.harness,counts={prevent:0,stop:0};const events=()=>({preventDefault(){counts.prevent++;},stopPropagation(){counts.stop++;}});
    h.hook.onDrop({...events(),dataTransfer:{files:[],types:['text/plain']}});const text={...counts};
    h.hook.onPaste({...events(),clipboardData:{files:[h.file('paste.png')]}});
    h.hook.onDrop({...events(),dataTransfer:{files:[h.file('drop.png')],types:['Files']}});return {text,counts};});
  await page.waitForFunction(()=>window.harness.hook.entries.length===2);assert.deepEqual(result.text,{prevent:0,stop:0});assert.deepEqual(result.counts,{prevent:2,stop:1});assert.equal((await snapshot(page)).calls.length,0);
});

test('attachment removal, scope change, disable and unmount release every object URL exactly once',async t=>{
  const page=await open(t);await page.evaluate(()=>{const h=window.harness;h.add(['remove.png','scope.png']);h.hook.remove(h.hook.entries[0].id);h.render({scopeKey:'scope-b'});h.add(['disable.png']);h.render({disabled:true});h.render({disabled:false});h.add(['unmount.png']);h.unmount();});
  const value=await snapshot(page);assert.equal(new Set(value.created).size,4);assert.equal(new Set(value.revoked).size,4);assert.deepEqual([...value.revoked].sort(),[...value.created].sort());
});

test('disabled during send frees busy and its late completion cannot affect a fresh batch',async t=>{
  const page=await open(t);await page.evaluate(()=>{const h=window.harness;h.add(['old.png']);h.start();h.render({disabled:true});h.render({disabled:false});h.add(['new.png']);h.start();});await wait(page,2);
  await page.evaluate(()=>window.harness.resolve('queued',0));await page.waitForTimeout(40);assert.equal((await snapshot(page)).busy,true);assert.deepEqual((await snapshot(page)).names,['new.png']);
  await page.evaluate(()=>window.harness.resolve());await idle(page);assert.deepEqual((await snapshot(page)).names,[]);
});

test('physical A to B cancels immediately, refuses adoption and lets B send before A resolves',async t=>{
  const page=await open(t);await page.evaluate(()=>{const h=window.harness;h.add(['old.png','never.png']);h.start();h.render({scopeKey:'scope-b'});h.oldAdoption=h.calls[0].context.adoptScope('scope-b');h.add(['new.png']);h.start();});await wait(page,2);
  assert.equal(await page.evaluate(()=>window.harness.oldAdoption),false);assert.deepEqual((await snapshot(page)).names,['new.png']);
  await page.evaluate(()=>window.harness.resolve('queued',0));await page.waitForTimeout(40);assert.equal((await snapshot(page)).busy,true);
  await page.evaluate(()=>window.harness.resolve());await idle(page);assert.deepEqual((await snapshot(page)).calls.map(call=>call.name),['old.png','new.png']);
});

for(const timing of ['before','after']) test(`own null-to-prepared adoption ${timing} commit continues the batch`,async t=>{
  const page=await open(t);await page.evaluate(()=>{const h=window.harness;h.render({scopeKey:'null-route',allowScopeAdoption:true});h.add(['one.png','two.png']);h.start();});await wait(page,1);
  const accepted=await page.evaluate(timing=>{const h=window.harness,adopt=h.calls[0].context.adoptScope;let result;if(timing==='before'){result=adopt('prepared');h.render({scopeKey:'prepared'});}else{h.render({scopeKey:'prepared'});result=adopt('prepared');}return result;},timing);
  assert.equal(accepted,true);await page.evaluate(()=>window.harness.resolve());await wait(page,2);assert.equal((await snapshot(page)).calls[1].scope,'prepared');await page.evaluate(()=>window.harness.resolve());await idle(page);assert.deepEqual((await snapshot(page)).names,[]);
});

test('unconfirmed preparation change without adoption hides bytes and cancels the remaining batch',async t=>{
  const page=await open(t);await page.evaluate(()=>{const h=window.harness;h.render({allowScopeAdoption:true});h.add(['one.png','two.png']);h.start();h.render({scopeKey:'prepared'});});
  assert.deepEqual((await snapshot(page)).names,[]);await page.evaluate(()=>window.harness.resolve());await idle(page);assert.equal((await snapshot(page)).calls.length,1);assert.deepEqual((await snapshot(page)).revoked,(await snapshot(page)).created);
});

test('two scope transitions including ABA retire the old attempt and reject its adoption',async t=>{
  const page=await open(t);await page.evaluate(()=>{const h=window.harness;h.render({allowScopeAdoption:true});h.add(['old.png']);h.start();h.render({scopeKey:'scope-b'});h.render({scopeKey:'scope-a'});h.adopted=h.calls[0].context.adoptScope('scope-a');h.add(['new.png']);});
  assert.equal(await page.evaluate(()=>window.harness.adopted),false);await page.evaluate(()=>window.harness.resolve());await idle(page);assert.deepEqual((await snapshot(page)).names,['new.png']);
});

test('fresh selection in an unadopted preparation route retires old bytes and rejects a wrong handoff',async t=>{
  const page=await open(t);await page.evaluate(()=>{const h=window.harness;h.render({allowScopeAdoption:true});h.add(['old.png']);h.start();h.render({scopeKey:'prepared'});h.wrong=h.calls[0].context.adoptScope('other');h.add(['fresh.png']);h.retired=h.calls[0].context.adoptScope('prepared');});
  assert.equal(await page.evaluate(()=>window.harness.wrong),false);assert.equal(await page.evaluate(()=>window.harness.retired),false);assert.deepEqual((await snapshot(page)).names,['fresh.png']);await page.evaluate(()=>window.harness.resolve());await idle(page);assert.deepEqual((await snapshot(page)).names,['fresh.png']);
});

test('attachment callbacks captured before scope ABA cannot prepare or send old bytes',async t=>{
  const page=await open(t);await page.evaluate(()=>{const h=window.harness;h.add(['original.png']);h.savedAdd=h.hook.addFiles;h.savedSend=h.hook.send;h.render({scopeKey:'scope-b'});h.render({scopeKey:'scope-a'});h.savedAdd([h.file('obsolete.png')]);h.savedSend();});
  await page.waitForTimeout(80);const value=await snapshot(page);assert.deepEqual({names:value.names,calls:value.calls},{names:[],calls:[]});
});

test('file input selection resets the native value and preserves explicit send confirmation',async t=>{
  const page=await open(t);const input=await page.evaluate(()=>{const h=window.harness,target={files:[h.file('selection.png')],value:'C:\\fakepath\\selection.png'};h.hook.onFileSelect({target});return target.value;});
  await page.waitForFunction(()=>window.harness.hook.entries.length===1);assert.equal(input,'');assert.equal((await snapshot(page)).calls.length,0);
});

test('drag over accepts file drops only and shows none when permission is disabled',async t=>{
  const page=await open(t);const result=await page.evaluate(()=>{const h=window.harness;let prevented=0;const text={dataTransfer:{types:['text/plain'],dropEffect:'move'},preventDefault(){prevented++;}};h.hook.onDragOver(text);
    const files={dataTransfer:{types:['Files'],dropEffect:'move'},preventDefault(){prevented++;}};h.hook.onDragOver(files);const copy=files.dataTransfer.dropEffect;h.render({disabled:true});h.hook.onDragOver(files);return {prevented,text:text.dataTransfer.dropEffect,copy,disabled:files.dataTransfer.dropEffect};});
  assert.deepEqual(result,{prevented:2,text:'move',copy:'copy',disabled:'none'});
});

test('unmount during an in-flight attachment rejects the late outcome and adoption',async t=>{
  const page=await open(t);await page.evaluate(()=>{const h=window.harness;h.render({allowScopeAdoption:true});h.add(['one.png','two.png']);h.start();h.unmount();h.adopted=h.calls[0].context.adoptScope('prepared');h.resolve();});
  await page.waitForTimeout(80);const value=await snapshot(page);assert.equal(value.calls.length,1);assert.equal(await page.evaluate(()=>window.harness.adopted),false);assert.deepEqual(value.revoked,value.created);
});

test('send callback saved before file removal cannot send the removed invisible bytes',async t=>{
  const page=await open(t);await page.evaluate(()=>{const h=window.harness;h.add(['removed.png']);h.savedSend=h.hook.send;h.hook.remove(h.hook.entries[0].id);});
  await page.waitForFunction(()=>window.harness.hook.entries.length===0);await page.evaluate(()=>{window.harness.savedSend();});
  assert.deepEqual((await snapshot(page)).calls,[]);assert.deepEqual((await snapshot(page)).names,[]);
});

test('send callback saved before editing reads the current prepared caption',async t=>{
  const page=await open(t);await page.evaluate(()=>{const h=window.harness;h.add(['caption.png']);h.savedSend=h.hook.send;h.hook.setCaption(h.hook.entries[0].id,'Current edited caption');});
  await page.waitForFunction(()=>window.harness.hook.entries[0].caption==='Current edited caption');await page.evaluate(()=>{window.harness.savedSend();});await wait(page,1);
  assert.equal((await snapshot(page)).calls[0].caption,'Current edited caption');await page.evaluate(()=>window.harness.resolve());await idle(page);
});
