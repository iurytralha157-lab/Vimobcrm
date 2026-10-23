import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from '@playwright/test';

// Real React hooks, QueryClient, TaskOutcomeDialog and Radix in an isolated
// browser. Synthetic drafts and deferred promises; every network request aborts.
const require = createRequire(import.meta.url);
const { webpack } = require('next/dist/compiled/webpack/webpack.js');
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
let directory, browser, bundle;
const pageErrors = new WeakMap();
const pageRequests = new WeakMap();

// A valid one-page PDF; offsets are exact because every object is ASCII.
const pdfFixture = (() => {
  let pdf = '%PDF-1.7\n';
  const offsets = [0];
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream',
  ];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  return pdf + `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
})();

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vimob-lead-draft-outcome-'));
  const loader = join(directory, 'ts-loader.cjs');
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=function(source){return ts.transpileModule(source,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText}`);
  const icons = join(directory, 'icons.js');
  await writeFile(icons, `import React from'react';export const Phone=p=>React.createElement('svg',p);export const MessageCircle=Phone,Mail=Phone,Loader2=Phone,X=Phone,Circle=Phone,AlertCircle=Phone,Download=Phone,FileAudio=Phone,FileText=Phone,FileVideo=Phone,ImageIcon=Phone;`);
  const syntheticAccess = join(directory, 'attachment-access.js');
  // Keep useLeadAttachmentAccess real. Only auth and the signing transport are
  // inert, so loading the viewer cannot initialize Supabase or read its env.
  await writeFile(syntheticAccess, `
    const accessToken='e30.'+btoa(JSON.stringify({sub:'synthetic-user',session_id:'synthetic-session'}))+'.synthetic';
    const auth={activeOrganization:{organizationId:'synthetic-org'},user:{id:'synthetic-user'},session:{access_token:accessToken}};
    export const useAuth=()=>auth;
    export const leadAttachmentsAPI={async access(leadId,attachmentId,organizationId,intent){
      const h=window.h,attachment=h.viewer;
      if(leadId!=='synthetic-lead'||organizationId!=='synthetic-org'||attachment?.id!==attachmentId||attachment.lead_id!==leadId
        ||intent?.expectedUserId!=='synthetic-user'||intent?.expectedSessionId!=='synthetic-session'||!intent.signal||intent.signal.aborted)
        throw Error('Unexpected attachment signing scope in isolated fixture');
      h.accesses.push({leadId,attachmentId,organizationId,userId:intent.expectedUserId,sessionId:intent.expectedSessionId});
      return{...attachment,availability:'ready'};
    }};`);
  const entry = join(directory, 'entry.js');
  await writeFile(entry, `import React from'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';
    import{useLeadFeedbackDraft}from'@/hooks/leads/use-lead-feedback-draft';import{TaskOutcomeDialog}from'@/components/features/leads/TaskOutcomeDialog';import{LeadAttachmentViewer}from'@/components/features/leads/LeadAttachmentViewer';
    const client=new QueryClient();const h=window.h={a:true,b:false,outcome:false,viewer:null,accesses:[],fetches:[],previewURLs:0,closed:0,confirmCount:0,activityDone:false};
    const createURL=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{h.previewURLs++;return createURL(blob)};window.fetch=(_url,{signal})=>new Promise((resolve,reject)=>{h.fetches.push({signal,resolve});signal.addEventListener('abort',()=>reject(new DOMException('Synthetic cancel','AbortError')),{once:true})});
    function Draft({label}){const{draft,updateDraft,acknowledgeSavedDraft}=useLeadFeedbackDraft('synthetic-org','synthetic-lead');return React.createElement('section',null,React.createElement('input',{'aria-label':label,value:draft,onChange:e=>updateDraft(e.target.value)}),React.createElement('button',{onClick:()=>{const submitted=draft;h.completeOld=()=>acknowledgeSavedDraft(submitted)}},'Capturar envio'));}
    const root=createRoot(document.getElementById('root'));h.render=()=>root.render(React.createElement(QueryClientProvider,{client},React.createElement(React.Fragment,null,h.a&&React.createElement(Draft,{key:'a',label:'Draft A'}),h.b&&React.createElement(Draft,{key:'b',label:'Draft B'}),h.outcome&&React.createElement(TaskOutcomeDialog,{open:true,taskType:'call',taskTitle:'Fixture',isLoading:false,onOpenChange:open=>{if(!open)h.closed++},onConfirm:async()=>{h.confirmCount++;h.activityDone=true;await new Promise(resolve=>{h.firstResponseDone=resolve});return true}}),h.viewer&&React.createElement(LeadAttachmentViewer,{key:h.viewer.id+':'+h.viewer.file_url,attachment:h.viewer,open:true,onOpenChange:open=>{if(!open){h.viewer=null;h.render()}}}))));h.render();`);
  await new Promise((done, reject) => {
    const compiler = webpack({ mode: 'development', target: 'web', entry, output: { path: directory, filename: 'fixture.js' },
      resolve: { extensions: ['.ts', '.tsx', '.js'], modules: [join(repository, 'node_modules'), 'node_modules'],
        alias: { '@/contexts/AuthContext$': syntheticAccess, '@/lib/api/lead-attachments$': syntheticAccess,
          '@': repository, 'lucide-react$': icons } },
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
    assert.ok(directory.startsWith(join(tmpdir(), 'vimob-lead-draft-outcome-')));
    await rm(directory, { recursive: true, force: true });
  }
});

async function pageFixture() {
  const page = await browser.newPage();
  const errors = [], requests = [];
  pageErrors.set(page, errors);
  pageRequests.set(page, requests);
  page.setDefaultTimeout(5_000);
  const failedRuntime = new Promise((_, reject) => {
    page.on('pageerror', error => { errors.push(error.message); reject(error); });
  });
  await page.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
  try {
    await Promise.race([failedRuntime, (async () => {
      await page.setContent('<main id="root"></main>');
      await page.addScriptTag({ content: bundle });
      await page.getByLabel('Draft A').waitFor();
    })()]);
    return page;
  } catch (error) {
    await page.close();
    throw error;
  }
}

async function closeFixturePage(page) {
  try {
    assert.deepEqual(pageErrors.get(page), [], 'No browser runtime errors are permitted');
    assert.deepEqual(pageRequests.get(page), [], 'No external network request is permitted');
  } finally { await page.close(); }
}

test('salvamento antigo limpa o draft da instância reaberta', async () => {
  const page = await pageFixture();
  try {
    await page.getByLabel('Draft A').fill('Feedback sintético');
    await page.getByRole('button', { name: 'Capturar envio' }).click();
    await page.evaluate(() => { window.h.a = false; window.h.b = true; window.h.render(); });
    await page.getByLabel('Draft B').waitFor();
    assert.equal(await page.getByLabel('Draft B').inputValue(), 'Feedback sintético');
    await page.evaluate(() => window.h.completeOld());
    await page.waitForFunction(() => document.querySelector('[aria-label="Draft B"]').value === '');
  } finally { await closeFixturePage(page); }
});

test('ack antigo não apaga texto adicional escrito na instância reaberta', async () => {
  const page = await pageFixture();
  try {
    await page.getByLabel('Draft A').fill('Feedback sintético');
    await page.getByRole('button', { name: 'Capturar envio' }).click();
    await page.evaluate(() => { window.h.a = false; window.h.b = true; window.h.render(); });
    await page.getByLabel('Draft B').fill('Texto adicional sintético');
    await page.evaluate(() => window.h.completeOld());
    assert.equal(await page.getByLabel('Draft B').inputValue(), 'Texto adicional sintético');
  } finally { await closeFixturePage(page); }
});

test('resultado permanece ocupado e não fecha enquanto first-response está pendente', async () => {
  const page = await pageFixture();
  try {
    await page.evaluate(() => { window.h.a = false; window.h.outcome = true; window.h.render(); });
    await page.getByRole('radio', { name: /Atendeu - Conversamos/ }).click();
    await page.getByRole('button', { name: 'Registrar', exact: true }).click({ timeout: 5_000 });
    await page.waitForFunction(() => window.h.activityDone);
    assert.equal(await page.getByRole('button', { name: 'Salvando...' }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Cancelar', exact: true }).isDisabled(), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => window.h.closed), 0);
    assert.equal(await page.evaluate(() => window.h.confirmCount), 1);
    await page.evaluate(() => window.h.firstResponseDone());
    await page.getByRole('button', { name: 'Registrar', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Cancelar', exact: true }).isDisabled(), false);
    assert.equal(await page.evaluate(() => window.h.confirmCount), 1);
  } catch (error) {
    console.error('Outcome synthetic DOM:', await page.evaluate(() => ({ text: document.body.innerText, confirms: window.h.confirmCount, closed: window.h.closed })));
    throw error;
  } finally { await closeFixturePage(page); }
});

test('PDF cancelado não cria URL tardia e reabrir inicia apenas uma prévia nova', async () => {
  const page = await pageFixture();
  try {
    await page.evaluate(() => {
      window.h.a = false;
      window.h.viewer = { id: 'a', lead_id: 'synthetic-lead', file_name: 'fixture-a.pdf', file_type: 'pdf', file_url: 'https://example.invalid/a.pdf' };
      window.h.render();
    });
    await page.waitForFunction(() => window.h.fetches.length === 1);
    assert.equal(await page.getByText('Carregando prévia...', { exact: true }).isVisible(), true);
    await page.getByRole('button', { name: 'Fechar visualização do anexo', exact: true }).click();
    assert.equal(await page.evaluate(() => window.h.fetches[0].signal.aborted), true);
    await page.evaluate((pdf) => {
      window.h.fetches[0].resolve(new Response(new Blob([pdf], { type: 'application/pdf' })));
      window.h.viewer = { id: 'b', lead_id: 'synthetic-lead', file_name: 'fixture-b.pdf', file_type: 'pdf', file_url: 'https://example.invalid/b.pdf' };
      window.h.render();
    }, pdfFixture);
    await page.waitForFunction(() => window.h.fetches.length === 2);
    assert.equal(await page.evaluate(() => window.h.previewURLs), 0);
    await page.evaluate((pdf) => window.h.fetches[1].resolve(new Response(new Blob([pdf], { type: 'application/pdf' }))), pdfFixture);
    await page.locator('iframe[title="fixture-b.pdf"]').waitFor();
    assert.equal(await page.evaluate(() => window.h.previewURLs), 1);
    assert.equal(await page.evaluate(() => window.h.fetches.length), 2);
    assert.deepEqual(await page.evaluate(() => window.h.accesses), ['a', 'b'].map(attachmentId => ({
      leadId: 'synthetic-lead', attachmentId, organizationId: 'synthetic-org',
      userId: 'synthetic-user', sessionId: 'synthetic-session',
    })));
  } finally { await closeFixturePage(page); }
});
