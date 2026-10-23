import assert from 'node:assert/strict';
import { after, before } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from '@playwright/test';

// Real LeadDetailOverlays, TaskOutcomeDialog, React and Radix. Only unrelated
// overlays are stubbed. Synthetic callbacks; all browser network is blocked.
const require = createRequire(import.meta.url);
const { webpack } = require('next/dist/compiled/webpack/webpack.js');
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
let directory, browser, bundle;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vimob-task-outcome-'));
  const loader = join(directory, 'ts-loader.cjs');
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=function(source){return ts.transpileModule(source,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText}`);
  const empty = join(directory, 'unrelated-overlays.js');
  await writeFile(empty, 'export const EventSheet=()=>null,LeadAttachmentViewer=()=>null,LostReasonDialog=()=>null;');
  const entry = join(directory, 'entry.js');
  await writeFile(entry, `import React from'react';import{createRoot}from'react-dom/client';import{LeadDetailOverlays}from'@/components/features/leads/lead-detail/LeadDetailOverlays';import{useLeadOutcomeDraft}from'@/hooks/leads/use-lead-outcome-draft';
    const h=window.h={kind:'quick',open:true,leadId:'lead-a',org:'org-a',actor:'actor-a',session:'session-a',taskId:'task-a',type:'call',blocked:undefined,retrying:false,pending:false,controlled:false,visible:true,mode:'success',requests:[],retries:0,closed:0,deferred:[]};
    const root=createRoot(document.getElementById('root'));
    function Fixture(){const kind=h.kind,mode=h.mode,scope=[h.org,h.leadId,h.actor,h.session].join(':');const cadenceDraft=useLeadOutcomeDraft(scope+':cadence:'+h.taskId+':'+h.type),quickDraft=useLeadOutcomeDraft(scope+':quick:'+h.type);const currentDraft=kind==='cadence'?cadenceDraft:quickDraft;h.currentDraft=currentDraft.draft;h.currentDraftUpdater=currentDraft.updateDraft;if(!h.visible)return null;const confirm=async(outcome,notes)=>{h.requests.push({kind,scope,outcome,notes});if(mode==='reject')throw Error('Synthetic failure');if(mode==='deferred')return new Promise((resolve,reject)=>h.deferred.push({resolve,reject}));if(mode==='undefined')return undefined;return mode==='success'};const change=open=>{h.open=open;if(!open)h.closed++;h.render()};return React.createElement(LeadDetailOverlays,{
      lead:{id:h.leadId,name:'Lead sintético'},leadName:'Lead sintético',outcomeScopeKey:scope,selectedTask:null,roteiroDialogOpen:false,onRoteiroDialogOpenChange:()=>{},onRoteiroAction:()=>{},
      taskForOutcome:kind==='cadence'?{id:h.taskId,type:h.type,title:'Tarefa sintética'}:null,outcomeDialogOpen:kind==='cadence'&&h.open,onOutcomeDialogOpenChange:change,onOutcomeConfirm:confirm,
      quickActionOutcomeOpen:kind==='quick'&&h.open,quickActionOutcomeType:h.type,onQuickActionOutcomeOpenChange:change,onQuickActionOutcomeConfirm:confirm,
      outcomeBlockedReason:h.blocked,quickActionBlockedReason:h.blocked,onRetryOutcomeRead:()=>{h.retries++;h.retrying=true;h.render()},outcomeReadRetrying:h.retrying,cadenceTaskPending:h.pending,quickActionPending:h.pending,
      outcomeDraft:h.controlled?cadenceDraft.draft:undefined,onOutcomeDraftChange:h.controlled?cadenceDraft.updateDraft:undefined,quickActionDraft:h.controlled?quickDraft.draft:undefined,onQuickActionDraftChange:h.controlled?quickDraft.updateDraft:undefined,
      reopenStatusConfirmation:null,onReopenStatusConfirmationChange:()=>{},onConfirmReopen:()=>{},assigneeScheduleConfirmation:null,onAssigneeScheduleConfirmationChange:()=>{},onConfirmAssignee:()=>{},dealStatusPending:false,
      lostReasonDialogOpen:false,onLostReasonDialogOpenChange:()=>{},onConfirmLostReason:()=>{},selectedAttachment:null,onSelectedAttachmentChange:()=>{},hasAgendaModule:false,scheduleFormOpen:false,onCloseScheduleForm:()=>{},editingScheduleEvent:null,scheduleDefaultType:'call'})};h.render=()=>root.render(React.createElement(Fixture));h.render();`);
  await new Promise((done, reject) => {
    const compiler = webpack({ mode: 'development', target: 'web', entry, output: { path: directory, filename: 'fixture.js' },
      resolve: { extensions: ['.ts', '.tsx', '.js'], modules: [join(repository, 'node_modules'), 'node_modules'], alias: {
        ...(process.env.TASK_OUTCOME_SOURCE ? { '@/components/features/leads/TaskOutcomeDialog$': process.env.TASK_OUTCOME_SOURCE } : {}),
        '@/components/features/schedule/EventSheet$': empty,
        '@/components/features/leads/LeadAttachmentViewer$': empty,
        '@/components/features/leads/LostReasonDialog$': empty,
        '@': repository,
      } }, module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] } });
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
    assert.ok(directory.startsWith(join(tmpdir(), 'vimob-task-outcome-')));
    await rm(directory, { recursive: true, force: true });
  }
});

export async function fixture(kind, type = 'call') {
  const page = await browser.newPage();
  await page.route('**/*', route => route.abort());
  await page.setContent('<main id="root"></main>');
  await page.addScriptTag({ content: bundle });
  await page.getByRole('dialog').waitFor();
  await page.evaluate(({ kind, type }) => { window.h.kind = kind; window.h.type = type; window.h.render(); }, { kind, type });
  await page.getByRole('dialog').waitFor();
  return page;
}

export const notes = page => page.getByPlaceholder('Adicione detalhes sobre essa tentativa...');
export const selected = page => page.getByRole('radio', { checked: true });
export async function draft(page, text = 'Notas sintéticas mantidas') {
  await page.getByRole('radio').first().click();
  await notes(page).fill(text);
}
export async function waitSettled(page) {
  await page.getByRole('button', { name: 'Registrar', exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('textarea')?.disabled);
}

