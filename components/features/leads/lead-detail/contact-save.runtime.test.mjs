import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// Evaluate the active property and external-edit handlers with real React and
// operation-scope/merge helpers. PATCH is deferred and every request is blocked.
const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
let directory, browser, page, bundle;
const errors = [];

function productionParts(source) {
  const parsed = ts.createSourceFile('LeadDetailDialog.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const editHandlers = [], propertyHandlers = [], draftEffects = [], draftDeclarations = [];
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'handleOpenLeadEdit') editHandlers.push(node.initializer.getText(parsed));
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === '[editForm, setEditForm]') draftDeclarations.push(node.getText(parsed));
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'handleSelectInterestProperty') propertyHandlers.push(node.initializer.getText(parsed));
    if (ts.isCallExpression(node) && node.expression.getText(parsed) === 'useEffect') {
      const text = node.getText(parsed);
      if (text.includes('setEditForm(nextForm)')) draftEffects.push(text);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  assert.equal(editHandlers.length, 1); assert.equal(propertyHandlers.length, 1); assert.equal(draftEffects.length, 1); assert.equal(draftDeclarations.length, 1);
  assert.doesNotMatch(source, /\b(?:isEditingContact|setIsEditingContact|handleSaveContact|contactSaveOperationRef)\b/);
  return { editHandler: editHandlers[0], propertyHandler: propertyHandlers[0], draftEffect: draftEffects[0], draftDeclaration: draftDeclarations[0] };
}

before(async () => {
  const parts = productionParts(await readFile(path.join(root, 'components/features/leads/LeadDetailDialog.tsx'), 'utf8'));
  directory = await mkdtemp(path.join(tmpdir(), 'vimob-contact-save-'));
  const entry = path.join(directory, 'fixture.tsx'), loader = path.join(directory, 'loader.cjs');
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=source=>ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;`);
  await writeFile(entry, `import React,{useEffect,useRef,useState}from'react';import{createRoot}from'react-dom/client';import{QueryClient}from'@tanstack/react-query';
    import{useLeadDetailOperationScope}from'@/hooks/leads/use-lead-detail-operation-scope';import{mergeLeadDetailMutation}from'@/components/features/leads/lead-detail/hydrate-lead-detail';import{requiresWonLeadFinancialReview,WON_LEAD_FINANCIAL_REVIEW_MESSAGE}from'@/components/features/leads/lead-detail/financial-review';
    import{replaceOwnedPropertyDraft,rollbackLeadPropertySelection}from'@/components/features/leads/lead-detail/property-selection-rollback';
    import{assertLeadFinancialFields}from'@/lib/validation/lead-financial-values';
    const h=window.h={requests:[],pending:[],toasts:[],commissions:[],localUpdates:0,done:0,history:[],removed:[],restores:0,edits:[]};
    const queryClient=new QueryClient();h.client=queryClient;
    const syntheticLead=(id='A',org='org-A')=>({id,organization_id:org,name:id,phone:'',email:'',deal_status:'won',valor_interesse:100,commission_percentage:5,updated_at:'2026-10-12T10:00:00.000001Z',stage_id:'stage-A',property_id:null,interest_property_id:null});h.lead=syntheticLead;
    const toast={success:message=>h.toasts.push(message),warning:message=>h.toasts.push(message),error:message=>h.toasts.push(message)};
    const appendOptimisticLeadHistoryEvent=(_client,_lead,event)=>{h.history.push(event);return event.id;};
    const removeOptimisticLeadHistoryEvent=(_client,_lead,id)=>{h.removed.push(id);h.history=h.history.filter(event=>event.id!==id);};
    function Capture({scope}){
      const leadProp=scope.lead,lead=leadProp,user={id:scope.actor},profile={id:scope.actor,name:'Synthetic'},activeOrganization={organizationId:scope.org};
      const [localLead,setLead]=useState(lead);
      const ${parts.draftDeclaration};
      const propertySaveOperationRef=useRef(null);
      const poolReadOnly=scope.poolReadOnly,hasLeadOperatePermission=scope.permission,canOperateLead=hasLeadOperatePermission&&!poolReadOnly;
      const captureDetailOperation=useLeadDetailOperationScope(lead.id,scope.org,scope.actor,queryClient,hasLeadOperatePermission);
      const setLocalLead=update=>{h.localUpdates++;setLead(update);};
      useEffect(()=>{setLead(lead);},[lead]);
      ${parts.draftEffect};
      const updateLead={mutateAsync:params=>new Promise((resolve,reject)=>{const index=h.requests.push({params,lead:{...localLead}})-1;h.pending[index]={resolve,reject};})};
      const updatePipelineLeadCache=()=>[],restorePipelineCache=()=>{h.restores++;};
      const handleSelectInterestProperty=${parts.propertyHandler};
      const onEdit=selected=>h.edits.push(selected);
      const handleOpenLeadEdit=${parts.editHandler};
      h.select=property=>handleSelectInterestProperty(property).then(()=>{h.done++;});
      h.openEdit=handleOpenLeadEdit;h.edit=patch=>setEditForm(current=>({...current,...patch}));h.patchLocal=patch=>setLead(current=>({...current,...patch}));
      h.state={lead:localLead,draft:editForm,canOperate:canOperateLead};
      return <>{canOperateLead&&<button onClick={handleOpenLeadEdit}>Editar lead</button>}<output aria-label="Property draft">Property: {editForm.property_id}</output></>;
    }
    function Fixture(){const[scope,setScope]=useState({lead:syntheticLead(),org:'org-A',actor:'actor-A',permission:true,poolReadOnly:false});const[shown,setShown]=useState(true);h.scope=scope;h.change=patch=>setScope(current=>({...current,...patch}));h.close=()=>setShown(false);h.shown=shown;return shown?<Capture scope={scope}/>:null;}
    h.complete=(index,patch={})=>h.pending[index].resolve({...h.requests[index].lead,...h.requests[index].params,updated_at:'2026-10-12T10:01:00.000001Z',...patch});
    h.fail=index=>h.pending[index].reject(new Error('Synthetic failure'));createRoot(document.getElementById('app')).render(<Fixture/>);`);
  const { webpack } = require('next/dist/compiled/webpack/webpack');
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode: 'development', target: 'web', devtool: false, entry, output: { path: directory, filename: 'fixture.js' },
      resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@': root }, modules: [path.join(root, 'node_modules'), 'node_modules'] },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] } });
    compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors()
      ? reject(error || new Error(stats.toString({ all: false, errors: true }))) : resolve()));
  });
  bundle = await readFile(path.join(directory, 'fixture.js'), 'utf8');
  browser = await chromium.launch({ headless: true });
});
beforeEach(async () => {
  page = await browser.newPage(); page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(5_000);
  await page.route('**/*', route => route.abort());
  await page.setContent('<div id="app"></div>'); await page.addScriptTag({ content: bundle });
  await page.getByLabel('Property draft').waitFor();
  await page.waitForFunction(() => window.h.state.draft.valor_interesse === '100');
  await page.evaluate(() => window.h.edit({ valor_interesse: '200', commission_percentage: '6' }));
  await page.waitForFunction(() => window.h.state.draft.commission_percentage === '6');
});
afterEach(async context => {
  if (context.error && page) console.error('Property selection fixture:', await page.evaluate(() => ({ ...window.h.state, requests: window.h.requests, done: window.h.done, toasts: window.h.toasts })));
  await page?.close();
});
after(async () => {
  await browser?.close();
  if (directory) {
    const target = path.resolve(directory); assert.equal(path.dirname(target), path.resolve(tmpdir()));
    assert.ok(path.basename(target).startsWith('vimob-contact-save-')); await rm(target, { recursive: true, force: true });
  }
  assert.deepEqual(errors, []);
});
async function complete(index = 0, patch = {}) { await page.evaluate(({ index, patch }) => window.h.complete(index, patch), { index, patch }); await page.waitForFunction(() => window.h.done > 0); }
async function state() { return page.evaluate(() => ({ ...window.h.state, toasts: window.h.toasts, commissions: window.h.commissions, requests: window.h.requests, localUpdates: window.h.localUpdates, history: window.h.history, removed: window.h.removed, restores: window.h.restores, edits: window.h.edits })); }
const property = { id: 'property-new', title: 'Synthetic property', code: 'P-new', preco: 300, commission_percentage: 7 };
async function selectProperty() { await page.evaluate(property => { void window.h.select(property); }, property); await page.waitForFunction(() => window.h.requests.length === 1); }
test('two property selections dispatch one scoped CAS PATCH', async () => {
  await page.evaluate(property => { void window.h.select(property); void window.h.select(property); }, property);
  const result = await state(); assert.equal(result.requests.length, 1);
  assert.equal(result.requests[0].params.expectedUpdatedAt, '2026-10-12T10:00:00.000001Z'); assert.equal(result.history.length, 1);
  await complete(); await page.waitForFunction(() => window.h.state.lead.property_id === 'property-new');
  assert.match((await state()).toasts[0], /não foram recalculados/); assert.deepEqual((await state()).commissions, []);
});
test('property failure restores only owned draft and lead fields', async () => {
  await selectProperty(); await page.evaluate(() => { window.h.edit({ valor_interesse: '777', commission_percentage: '9' }); window.h.patchLocal({ name: 'Additional local', commission_percentage: 9 }); });
  await page.waitForFunction(() => window.h.state.draft.valor_interesse === '777');
  await page.evaluate(() => window.h.fail(0)); await page.waitForFunction(() => window.h.done === 1);
  const result = await state(); assert.equal(result.draft.valor_interesse, '777'); assert.equal(result.draft.property_id, ''); assert.equal(result.draft.commission_percentage, '9');
  assert.equal(result.lead.name, 'Additional local'); assert.equal(result.lead.property_id, null); assert.equal(result.lead.commission_percentage, 9);
  assert.equal(result.restores, 1); assert.equal(result.removed.length, 1); assert.deepEqual(result.history, []);
});
test('property failure does not roll back newer realtime data or another lead', async () => {
  await selectProperty(); await page.evaluate(() => window.h.patchLocal({ property_id: 'realtime-property', updated_at: '2026-10-12T10:00:00.000002Z' }));
  await page.waitForFunction(() => window.h.state.lead.property_id === 'realtime-property');
  await page.evaluate(() => window.h.fail(0)); await page.waitForFunction(() => window.h.done === 1);
  assert.equal((await state()).lead.property_id, 'realtime-property');
});
test('property success after scope switch reconciles history without changing the new card', async () => {
  await selectProperty(); await page.evaluate(() => window.h.change({ lead: window.h.lead('B'), org: 'org-B' }));
  await page.waitForFunction(() => window.h.state.lead.id === 'B'); await complete();
  const result = await state(); assert.equal(result.lead.id, 'B'); assert.deepEqual(result.toasts, []); assert.equal(result.removed.length, 1);
});
test('property completion uses canonical values without overwriting newer draft input', async () => {
  await selectProperty(); await page.evaluate(() => window.h.edit({ commission_percentage: '9' }));
  await page.waitForFunction(() => window.h.state.draft.commission_percentage === '9');
  await complete(0, { valor_interesse: 350, commission_percentage: 8 });
  const result = await state(); assert.equal(result.lead.valor_interesse, 350); assert.equal(result.draft.valor_interesse, '350'); assert.equal(result.draft.commission_percentage, '9');
});
test('a property without commission preserves the existing unsaved commission draft', async () => {
  await page.evaluate(property => { void window.h.select({ ...property, commission_percentage: null }); }, property);
  await page.waitForFunction(() => window.h.requests.length === 1); await complete();
  assert.equal((await state()).draft.commission_percentage, '6');
  assert.equal((await state()).requests[0].params.commission_percentage, undefined);
});
test('a lead becoming pool read-only prevents new property writes and external editing', async () => {
  await page.evaluate(() => window.h.change({ poolReadOnly: true }));
  await page.waitForFunction(() => !window.h.state.canOperate);
  const before = await state();
  await page.evaluate(async property => { window.h.openEdit(); await window.h.select(property); }, property);
  const result = await state();
  assert.equal(result.requests.length, 0); assert.deepEqual(result.edits, []);
  assert.equal(result.localUpdates, before.localUpdates); assert.equal(result.restores, 0);
  assert.deepEqual(result.history, []); assert.deepEqual(result.removed, []);
  assert.deepEqual(result.toasts, []); assert.deepEqual(result.commissions, []);
  assert.deepEqual(result.draft, before.draft);
});
test('Editar forwards the freshest local lead to the external editor without an inline PATCH', async () => {
  await page.evaluate(() => window.h.patchLocal({ name: 'Fresh canonical name', email: 'synthetic@example.invalid' }));
  await page.waitForFunction(() => window.h.state.lead.name === 'Fresh canonical name');
  await page.getByRole('button', { name: 'Editar lead' }).click();
  const result = await state();
  assert.equal(result.edits.length, 1); assert.equal(result.edits[0].id, 'A');
  assert.equal(result.edits[0].name, 'Fresh canonical name'); assert.equal(result.edits[0].email, 'synthetic@example.invalid');
  assert.deepEqual(result.requests, []); assert.deepEqual(result.history, []);
  assert.deepEqual(Object.keys(result.draft).sort(), ['commission_percentage', 'property_id', 'valor_interesse']);
});
test('permission loss blocks the external editor and property selection', async () => {
  await page.evaluate(() => window.h.change({ permission: false }));
  await page.waitForFunction(() => !window.h.state.canOperate);
  await page.evaluate(property => { window.h.openEdit(); void window.h.select(property); }, property);
  const result = await state();
  assert.deepEqual(result.edits, []); assert.deepEqual(result.requests, []); assert.deepEqual(result.history, []);
});
test('a microsecond-newer local response survives an older property completion', async () => {
  await selectProperty(); await page.evaluate(() => window.h.patchLocal({ name: 'Newer', stage_id: 'new-stage', updated_at: '2026-10-12T10:01:00.000002Z' }));
  await page.waitForFunction(() => window.h.state.lead.name === 'Newer'); await complete();
  const result = await state(); assert.equal(result.lead.name, 'Newer'); assert.equal(result.lead.stage_id, 'new-stage');
});
test('property completion retains newer canonical cache microseconds and omitted relations', async () => {
  await selectProperty(); await page.evaluate(() => window.h.client.setQueryData(['lead', 'org-A', 'A'], { ...window.h.state.lead, name: 'Cache newer', assignee: { name: 'Synthetic owner' }, assigned_user_id: 'owner', updated_at: '2026-10-12T10:01:00.000002Z' }));
  await complete(); const result = await state(); assert.equal(result.lead.name, 'Cache newer'); assert.equal(result.lead.assignee.name, 'Synthetic owner');
});
