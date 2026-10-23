import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from '@playwright/test';
import ts from 'typescript';

// Real outcome dialog, QueryClient/draft hook and production confirmation
// handlers. Only the transport and first-response service are synthetic.
// No CRM credentials, network, database or running preview are used.
const require = createRequire(import.meta.url);
const { webpack } = require('next/dist/compiled/webpack/webpack.js');
const repository = process.cwd();
let directory, browser, bundle;

async function handlerSource(path, name) {
  const source = await readFile(process.env.CONTACT_OUTCOME_SOURCE_ROOT
    ? join(process.env.CONTACT_OUTCOME_SOURCE_ROOT, path) : path, 'utf8');
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) declaration = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(declaration, `${name} must be the production handler`);
  return ts.transpileModule(`const ${declaration};`, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
  } }).outputText;
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vimob-contact-outcome-'));
  const loader = join(directory, 'ts-loader.cjs');
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=function(source){return ts.transpileModule(source,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText}`);
  const icons = join(directory, 'icons.js');
  await writeFile(icons, `import React from'react';export const Phone=p=>React.createElement('svg',p);export const MessageCircle=Phone,Mail=Phone,Loader2=Phone,X=Phone,Circle=Phone;`);
  const cardHandler = await handlerSource('components/features/leads/LeadCard.tsx', 'handleOutcomeConfirm');
  const popupHandler = await handlerSource('components/features/leads/LeadDetailDialog.tsx', 'handleQuickActionOutcomeConfirm');
  const entry = join(directory, 'entry.js');
  await writeFile(entry, `import React,{useRef,useState}from'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';
    import{useLeadCardOutcomeDraft}from'@/hooks/leads/use-lead-card-outcome-draft';import{TaskOutcomeDialog}from'@/components/features/leads/TaskOutcomeDialog';
    const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
    const h=window.h={variant:'card',channel:'call',instance:0,scope:true,requests:[],notices:[],firstResponses:0,opens:0,closes:0,ledger:new Map(),errors:[]};
    h.inspect=()=>client.getQueryCache().getAll().map(q=>({key:q.queryKey,data:q.state.data}));
    const lead={id:'10000000-0000-4000-8000-000000000001',organization_id:'20000000-0000-4000-8000-000000000001',first_response_at:null,first_response_is_automation:false};
    const toast=Object.fromEntries(['error','warning','info','success'].map(kind=>[kind,message=>h.notices.push({kind,message})]));
    const getErrorObjectMessage=error=>error.message,getErrorMessage=getErrorObjectMessage;
    function Fixture(){const[open,setOpen]=useState(true),[quickActionSubmitting,setQuickActionSubmitting]=useState(false);const quickActionSubmittingRef=useRef(false);
      const cardOutcomeDraft=useLeadCardOutcomeDraft(lead.organization_id,'actor-a','sid-a',lead.id,h.channel),quickActionDraft=cardOutcomeDraft;
      const outcomeType=h.channel,quickActionOutcomeType=h.channel,localLead=lead,activeOrganization={organizationId:lead.organization_id},profile={id:'actor-a'};
      const canRecordContact=true,canOperateLead=true;
      const captureCardOperation=()=>({isCurrent:()=>h.scope}),captureDetailOperation=captureCardOperation;
      const recordContactOutcome={isPending:false,mutateAsync:body=>new Promise((resolve,reject)=>h.requests.push({body:JSON.parse(JSON.stringify(body)),resolve,reject}))};
      const createActivity={isPending:false,mutateAsync:activity=>recordContactOutcome.mutateAsync({leadId:activity.lead_id,commandId:crypto.randomUUID(),...activity.metadata})},createActivityMutation=createActivity;
      const recordFirstResponse=async()=>{h.firstResponses++};
      const setOutcomeDialogOpen=value=>{setOpen(value);if(!value)h.closes++},setQuickActionOutcomeOpen=setOutcomeDialogOpen;
      ${cardHandler}
      ${popupHandler}
      h.currentDraft=cardOutcomeDraft.draft;h.busy=cardOutcomeDraft.isSubmitting;h.open=()=>{setOpen(true);h.opens++};
      return React.createElement(TaskOutcomeDialog,{open,onOpenChange:setOpen,taskType:h.channel,taskTitle:'Synthetic contact',draft:cardOutcomeDraft.draft,onDraftChange:cardOutcomeDraft.updateDraft,notesLimit:2000,isLoading:cardOutcomeDraft.isSubmitting||quickActionSubmitting,onConfirm:h.variant==='card'?handleOutcomeConfirm:handleQuickActionOutcomeConfirm});}
    const root=createRoot(document.getElementById('root'));h.render=()=>root.render(React.createElement(QueryClientProvider,{client},React.createElement(Fixture,{key:h.instance})));
    h.commitAndLoseACK=index=>{const r=h.requests[index];const key=r.body.commandId;h.ledger.set(key,h.ledger.get(key)||{...r.body,activityId:'30000000-0000-4000-8000-000000000001'});r.reject(new Error('Synthetic lost ACK after durable commit'))};
    h.ack=index=>{const r=h.requests[index],old=h.ledger.get(r.body.commandId);if(old){const{activityId,...body}=old;if(JSON.stringify(body)!==JSON.stringify(r.body))throw Error('Payload changed for existing command')}else h.ledger.set(r.body.commandId,{...r.body,activityId:'30000000-0000-4000-8000-000000000002'});r.resolve({commandId:r.body.commandId,leadId:lead.id,channel:r.body.channel,activityId:h.ledger.get(r.body.commandId).activityId,recordedAt:'2026-10-19T21:00:00Z'})};h.render();`);
  await new Promise((done, reject) => {
    const compiler = webpack({ mode: 'development', target: 'web', entry,
      output: { path: directory, filename: 'fixture.js' },
      resolve: { extensions: ['.ts', '.tsx', '.js'], modules: [join(repository, 'node_modules'), 'node_modules'], alias: { '@': repository, 'lucide-react$': icons } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] } });
    compiler.run((error, stats) => compiler.close(() => error ? reject(error)
      : stats.hasErrors() ? reject(Error(stats.toString({ all: false, errors: true }))) : done()));
  });
  bundle = await readFile(join(directory, 'fixture.js'), 'utf8');
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  if (directory) {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(directory.startsWith(join(tmpdir(), 'vimob-contact-outcome-')));
    await rm(directory, { recursive: true, force: true });
  }
});

async function pageFixture(variant, channel, width) {
  const page = await browser.newPage({ viewport: { width, height: 860 } });
  page.setDefaultTimeout(5000);
  page.on('pageerror', error => { page.fixtureErrors.push(error.message); });
  page.fixtureErrors = [];
  await page.route('**/*', route => route.request().url() === 'https://contact-outcome.invalid/'
    ? route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }) : route.abort());
  await page.goto('https://contact-outcome.invalid/');
  await page.addScriptTag({ content: bundle });
  await page.evaluate(({ variant, channel }) => { Object.assign(window.h, { variant, channel }); window.h.instance++; window.h.render(); }, { variant, channel });
  await page.getByRole('dialog').waitFor();
  return page;
}

for (const width of [390, 1366]) for (const variant of ['card', 'popup']) for (const channel of ['call', 'email']) {
  if (width === 390 && channel === 'call') test(`${variant}: uncertain COMMIT followed by retry has exactly one durable result`, async () => {
    const page = await pageFixture(variant, channel, width);
    try {
      await page.getByRole('radio', { name: /Atendeu - Conversamos/ }).click();
      await page.locator('textarea').fill('Same synthetic contact attempt');
      await page.getByRole('button', { name: 'Registrar', exact: true }).click();
      await page.waitForFunction(() => window.h.requests.length === 1);
      await page.evaluate(() => window.h.commitAndLoseACK(0));
      await page.getByRole('button', { name: 'Registrar', exact: true }).click();
      await page.waitForFunction(() => window.h.requests.length === 2);
      await page.evaluate(() => window.h.ack(1));
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => window.h.ledger.size), 1, 'lost ACK must not turn retry into a second committed activity');
      assert.deepEqual(page.fixtureErrors, []);
    } finally { await page.close(); }
  });
  test(`${variant}/${channel}/${width}px: lost ACK, remount and replay keep one result; next deliberate record has a new command`, async () => {
    const page = await pageFixture(variant, channel, width);
    try {
      await page.getByRole('radio', { name: channel === 'call' ? /Atendeu - Conversamos/ : /^Respondeu/ }).click();
      await page.locator('textarea').fill('Synthetic contact result');
      await page.getByRole('button', { name: 'Registrar', exact: true }).click();
      await page.waitForFunction(() => window.h.requests.length === 1);
      assert.equal(await page.getByRole('button', { name: 'Cancelar', exact: true }).isDisabled(), true);
      await page.evaluate(() => window.h.commitAndLoseACK(0));
      await page.getByRole('button', { name: 'Registrar', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await page.evaluate(() => window.h.open());
      await page.getByRole('dialog').waitFor();
      assert.equal(await page.locator('textarea').inputValue(), 'Synthetic contact result');
      await page.evaluate(() => { window.h.instance++; window.h.render(); });
      await page.getByRole('dialog').waitFor();
      assert.equal(await page.locator('textarea').inputValue(), 'Synthetic contact result');
      await page.getByRole('button', { name: 'Registrar', exact: true }).click();
      await page.waitForFunction(() => window.h.requests.length === 2);
      assert.equal(await page.evaluate(() => JSON.stringify(window.h.requests[0].body) === JSON.stringify(window.h.requests[1].body)), true);
      await page.evaluate(() => window.h.ack(1));
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      assert.deepEqual(await page.evaluate(() => ({ effects: window.h.ledger.size, first: window.h.firstResponses })), { effects: 1, first: 1 });
      await page.evaluate(() => window.h.open());
      await page.getByRole('radio', { name: channel === 'call' ? /Atendeu - Conversamos/ : /^Respondeu/ }).click();
      await page.locator('textarea').fill('Synthetic contact result');
      await page.getByRole('button', { name: 'Registrar', exact: true }).click();
      await page.waitForFunction(() => window.h.requests.length === 3);
      assert.equal(await page.evaluate(() => window.h.requests[0].body.commandId !== window.h.requests[2].body.commandId), true);
      await page.evaluate(() => window.h.ack(2));
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => window.h.ledger.size), 2);
      assert.deepEqual(page.fixtureErrors, []);
    } catch (error) {
      console.error('Contact outcome synthetic DOM:', await page.evaluate(() => JSON.stringify({ text: document.body.innerText, notices: window.h.notices, requests: window.h.requests.map(r => r.body), cache: window.h.inspect() })));
      throw error;
    } finally { await page.close(); }
  });

  test(`${variant}/${channel}/${width}px: replay of old result preserves newer notes without posting them automatically`, async () => {
    const page = await pageFixture(variant, channel, width);
    try {
      await page.getByRole('radio', { name: channel === 'call' ? /Atendeu - Conversamos/ : /^Respondeu/ }).click();
      await page.locator('textarea').fill('Original synthetic notes');
      await page.getByRole('button', { name: 'Registrar', exact: true }).click();
      await page.waitForFunction(() => window.h.requests.length === 1);
      await page.evaluate(() => window.h.commitAndLoseACK(0));
      await page.getByRole('button', { name: 'Registrar', exact: true }).waitFor();
      await page.locator('textarea').fill('Newer synthetic notes');
      await page.getByRole('button', { name: 'Registrar', exact: true }).click();
      await page.waitForFunction(() => window.h.requests.length === 2);
      assert.equal(await page.evaluate(() => window.h.requests[1].body.notes), 'Original synthetic notes');
      await page.evaluate(() => window.h.ack(1));
      await page.getByRole('button', { name: 'Registrar', exact: true }).waitFor();
      assert.equal(await page.locator('textarea').inputValue(), 'Newer synthetic notes');
      assert.equal(await page.getByRole('dialog').isVisible(), true);
      assert.deepEqual(await page.evaluate(() => ({ effects: window.h.ledger.size, requests: window.h.requests.length, closes: window.h.closes })), { effects: 1, requests: 2, closes: 0 });
      assert.deepEqual(page.fixtureErrors, []);
    } finally { await page.close(); }
  });
}
