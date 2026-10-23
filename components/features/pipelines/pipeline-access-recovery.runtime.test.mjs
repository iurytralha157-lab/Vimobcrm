import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import ts from 'typescript';
import { productionDeclaration } from '../../../hooks/leads/lead-request-runtime-fixture.mjs';

// Real PipelineDialogs, Screen access expressions/effects, React and Radix.
// Child draft probes isolate instance retention; their hide guards come from the real editors.
const require = createRequire(import.meta.url);
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const screen = 'components/features/pipelines/PipelinesScreen.tsx';
let directory, browser, bundle;
const variable = name => 'const ' + productionDeclaration(screen, node => ts.isVariableDeclaration(node) && node.name.getText() === name) + ';';
const effect = text => productionDeclaration(screen, node => ts.isCallExpression(node) && node.expression.getText() === 'useEffect' && node.getText().includes(text)) + ';';
const guard = (file, text) => productionDeclaration(file, node => ts.isIfStatement(node) && node.expression.getText().includes(text));

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'vimob-pipeline-access-'));
  const loader = path.join(directory, 'loader.cjs'), detail = path.join(directory, 'detail.tsx'), editor = path.join(directory, 'editor.tsx'), settings = path.join(directory, 'settings.tsx'), entry = path.join(directory, 'entry.tsx');
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=function(source){return ts.transpileModule(source,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText}`);
  const probe = (name, blocked, actualGuard) => `import React,{useEffect,useState}from'react';export function ${name}(props){const leadProp=props.lead,localLead=props.lead,${blocked}=props.${blocked}||false;const[draft,setDraft]=useState(leadProp.name),[revision]=useState(leadProp.updated_at);window.h.edit['${name}']=setDraft;window.h.drafts['${name}']={draft,revision,blocked:${blocked}};useEffect(()=>{window.h.mounts++;return()=>{window.h.unmounts++;}},[]);${actualGuard}return <label>${name}<input aria-label="${name}" value={draft} data-revision={revision} onInput={e=>setDraft(e.currentTarget.value)}/></label>;}`;
  await writeFile(detail, probe('LeadDetailDialog', 'readAccessBlocked', guard('components/features/leads/LeadDetailDialog.tsx', '!leadProp || !localLead || readAccessBlocked')));
  await writeFile(editor, probe('CreateLeadDialog', 'accessBlocked', guard('components/features/leads/CreateLeadDialog.tsx', 'accessBlocked')));
  await writeFile(settings, 'export const StageSettingsDialog=()=>null;export const PipelineAttentionSettings=StageSettingsDialog,StagesEditorDialog=StageSettingsDialog;');
  const declarations = ['selectedLeadSessionId', 'visibilityScopeKey', 'verifiedLeadRead', 'authorizedSelectedLead', 'selectedLeadAccessStatus', 'selectedLeadAccessBlocked', 'retainedSelectedLead'];
  const bindings = await readFile(path.join(repository, screen), 'utf8');
  const parsed = ts.createSourceFile(screen, bindings, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let dialogProps;
  const visit = node => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(parsed) === 'PipelineDialogs') {
      const names = new Set(['selectedLead', 'selectedLeadLoading', 'verifiedLeadRead', 'selectedLeadAccessPending', 'selectedLeadAccessBlocked', 'editingLead']);
      dialogProps = node.attributes.properties.filter(item => ts.isJsxAttribute(item) && names.has(item.name.getText(parsed))).map(item => item.getText(parsed)).join(' ');
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed); assert.ok(dialogProps);
  await writeFile(entry, `import React,{useEffect,useMemo,useRef,useState}from'react';import{createRoot}from'react-dom/client';import{QueryClient}from'@tanstack/react-query';
    import{PipelineDialogs}from'@/components/features/pipelines/pipeline-screen/PipelineDialogs';import{matchesVerifiedLeadReadScope}from'@/lib/lead-read-snapshot';
    import{canRetainPipelineLeadDraft,isPipelineLeadAccessDenied,handlePipelineSelectedLeadAccessFailure,removeCachedPipelineLeadDetail}from'@/lib/pipeline-selected-lead-access';
    import{getGlobalSignOutSessionId}from'@/lib/auth/global-sign-out';import{VimobAPIError}from'@/lib/api/vimob-error';
    const h=window.h={mounts:0,unmounts:0,warnings:[],lastRead:null,drafts:{},edit:{}};const queryClient=new QueryClient();
    const lead={id:'lead-a',organization_id:'org-a',name:'PRIVATE SYNTHETIC',updated_at:'2026-10-16T10:00:00.000001Z'};
    const token=sid=>'header.'+btoa(JSON.stringify({sub:'actor-a',session_id:sid}))+'.synthetic';const toast={warning:value=>h.warnings.push(value)};
    function Fixture(){const[state,setState]=useState({org:'org-a',actor:'actor-a',sid:'sid-a',status:'success',code:undefined});h.change=patch=>setState(old=>({...old,...patch}));
      const[selectedLead,setSelectedLead]=useState(lead),[editingLead,setEditingLead]=useState(lead);const selectedLeadAccessVersion=1;
      const activeOrganizationId=state.org,profile={id:state.actor},user=profile,session={access_token:token(state.sid)},leadVisibility={canViewAll:true},scopedVisibleUserIds=undefined,tenantContext={ledTeamIds:[]};
      const leadVisibilityError=false,boardAccessRevoked=false;${variable('selectedLeadSessionId')}${variable('visibilityScopeKey')}
      if(state.status==='success')h.lastRead={data:lead,organizationId:state.org,selectionVersion:1,visibilityScopeKey,confirmedAt:Date.now()};
      const selectedLeadAccess={data:h.lastRead,isSuccess:state.status==='success',isError:state.status==='error',isFetching:false,error:state.status==='error'?new VimobAPIError('Synthetic',{status:state.code}):null};
      ${declarations.slice(2).map(variable).join('')}${variable('previousLeadScopeRef')}
      const setLostReasonLead=()=>{},setPendingLostMove=()=>{};${effect('previousLeadScopeRef.current')}${effect('handlePipelineSelectedLeadAccessFailure')}
      h.selected=selectedLead;return <PipelineDialogs ${dialogProps} onRetrySelectedLeadAccess={()=>h.change({status:'success',code:undefined})} onCloseSelectedLead={()=>{setSelectedLead(null);setEditingLead(null)}} stages={[]} allTags={[]} users={[]} newPipelineName="" newStageName="" currentPipelineName="" newStageColor="" normalizedNewStageColor=""/>;}
    createRoot(document.getElementById('app')).render(<Fixture/>);`);
  const { webpack } = require('next/dist/compiled/webpack/webpack');
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode: 'development', target: 'web', devtool: false, entry, output: { path: directory, filename: 'fixture.js' },
      plugins: [new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 })],
      resolve: { extensions: ['.tsx', '.ts', '.js'], modules: [path.join(repository, 'node_modules'), 'node_modules'],
        alias: { '@/components/features/leads/LeadDetailDialog$': detail, '@/components/features/leads/CreateLeadDialog$': editor,
          '@/components/features/pipelines/StageSettingsDialog$': settings, '@/components/features/pipelines/PipelineAttentionSettings$': settings,
          '@/components/features/pipelines/StagesEditorDialog$': settings, '@': repository } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] } });
    compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors() ? reject(error || Error(stats.toString({ all: false, errors: true }))) : resolve()));
  });
  bundle = await readFile(path.join(directory, 'fixture.js'), 'utf8'); browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  if (directory) { assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir())); assert.ok(path.basename(directory).startsWith('vimob-pipeline-access-')); await rm(directory, { recursive: true, force: true }); }
});

async function openFixture() {
  const page = await browser.newPage(); page.setDefaultTimeout(5_000); const errors = [];
  page.on('pageerror', error => errors.push(error.message)); await page.route('**/*', route => route.abort());
  await page.setContent('<div id="app"></div>'); await page.addScriptTag({ content: bundle });
  try { await page.getByLabel('CreateLeadDialog', { exact: true }).waitFor(); await page.getByLabel('LeadDetailDialog', { exact: true }).waitFor(); await page.waitForFunction(() => window.h.mounts === 2); }
  catch (error) { console.error('Access fixture', errors, await page.locator('body').innerText()); await page.close(); throw error; }
  return { page, errors };
}

test('503 hides every private node but retains both draft instances and original revisions after explicit retry', async () => {
  const { page, errors } = await openFixture();
  try {
    await page.evaluate(() => { window.h.edit.CreateLeadDialog('Unsaved editor'); window.h.edit.LeadDetailDialog('Unsaved inline'); });
    await page.waitForFunction(() => window.h.drafts.CreateLeadDialog.draft === 'Unsaved editor' && window.h.drafts.LeadDetailDialog.draft === 'Unsaved inline');
    await page.evaluate(() => window.h.change({ status: 'error', code: 503 })); await page.getByRole('button', { name: 'Tentar novamente' }).waitFor();
    assert.equal(await page.locator('input').count(), 0); assert.equal(await page.getByText('PRIVATE SYNTHETIC').count(), 0);
    assert.equal(await page.evaluate(() => window.h.mounts), 2); assert.equal(await page.evaluate(() => window.h.unmounts), 0);
    await page.getByRole('button', { name: 'Tentar novamente' }).click(); await page.getByLabel('CreateLeadDialog', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('CreateLeadDialog', { exact: true }).inputValue(), 'Unsaved editor');
    assert.equal(await page.getByLabel('LeadDetailDialog', { exact: true }).inputValue(), 'Unsaved inline');
    assert.equal(await page.getByLabel('CreateLeadDialog', { exact: true }).getAttribute('data-revision'), '2026-10-16T10:00:00.000001Z');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

for (const code of [401, 403, 404]) test(`${code} unmounts drafts and leaves no private nodes`, async () => {
  const { page, errors } = await openFixture();
  try {
    await page.evaluate(code => window.h.change({ status: 'error', code }), code); await page.waitForFunction(() => window.h.unmounts === 2);
    assert.equal(await page.locator('input').count(), 0); assert.equal(await page.getByText('PRIVATE SYNTHETIC').count(), 0); assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

for (const patch of [{ org: 'org-b' }, { actor: 'actor-b' }, { sid: 'sid-b' }]) test(`a transient error cannot retain drafts after scope replacement ${JSON.stringify(patch)}`, async () => {
  const { page, errors } = await openFixture();
  try {
    await page.evaluate(() => window.h.change({ status: 'error', code: 503 })); await page.getByRole('button', { name: 'Tentar novamente' }).waitFor();
    await page.evaluate(patch => window.h.change(patch), patch); await page.waitForFunction(() => window.h.unmounts === 2);
    assert.equal(await page.locator('input').count(), 0); assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
