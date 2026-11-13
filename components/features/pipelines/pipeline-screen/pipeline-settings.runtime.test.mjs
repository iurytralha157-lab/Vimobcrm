import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from '@playwright/test';

// Real React editors and Radix controls with synthetic in-memory queries and
// deferred mutations. No service, database, authentication or external request.
const require = createRequire(import.meta.url);
const { webpack } = require('next/dist/compiled/webpack/webpack.js');
const ts = require('typescript');
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
let directory, browser, bundle;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vimob-pipeline-settings-'));
  const aliases = {};
  async function mock(name, source) {
    const file = join(directory, `mock-${Object.keys(aliases).length}.js`);
    await writeFile(file, source);
    aliases[`${name}$`] = file;
  }
  const iconNames = new Set();
  const sourceFiles = [
    'components/features/pipelines/StageSettingsDialog.tsx', 'components/features/pipelines/StagesEditorDialog.tsx', 'components/features/pipelines/stage-settings-footer.tsx', 'components/features/pipelines/stage-inactivity-alert.tsx', 'components/features/pipelines/pipeline-screen/StageColumnMenu.tsx',
    'components/features/automations/AutomationForm.tsx', 'components/features/automations/AutomationsList.tsx',
    'components/features/cadences/StageOperationalRules.tsx',
    ...(await readdir(join(repository, 'components/features/cadences/stage-operational-rules'))).filter(file => /\.tsx?$/.test(file) && !file.includes('.test.')).map(file => `components/features/cadences/stage-operational-rules/${file}`),
    ...(await readdir(join(repository, 'components/ui'))).filter(file => file.endsWith('.tsx')).map(file => `components/ui/${file}`),
  ];
  for (const file of sourceFiles) {
    const parsed = ts.createSourceFile(file, await readFile(join(repository, file), 'utf8'), ts.ScriptTarget.Latest, true);
    for (const statement of parsed.statements) {
      if (ts.isImportDeclaration(statement) && statement.moduleSpecifier.text === 'lucide-react') {
        for (const element of statement.importClause?.namedBindings?.elements || []) iconNames.add((element.propertyName || element.name).text);
      }
    }
  }
  await mock('lucide-react', `import React from'react';${[...iconNames].map(name => `export const ${name}=props=>React.createElement('svg',{...props,'aria-hidden':true});`).join('')}`);
  await mock('@/hooks/use-user-permissions', 'export const useUserPermissions=()=>({hasPermission:()=>true});');
  await mock('@/hooks/use-organization-modules', 'export const useOrganizationModules=()=>({hasModule:module=>!(window.h.denyAutomations&&module==="automations")});');
  await mock('@/hooks/use-can-edit-cadences', 'export const useCanEditCadences=()=>true;');
  await mock('@/hooks/use-users', 'export const useOrganizationUsers=()=>({data:[{id:"22222222-2222-4222-8222-222222222222",name:"Corretor sintético"}],isPending:false,isError:false,refetch:async()=>{}});');
  await mock('@/hooks/use-round-robins', 'export const useRoundRobins=()=>({data:[{id:"88888888-8888-4888-8888-888888888888",name:"Equipe de retomada",is_active:true,target_stage:{name:"Retomar contato"}}],isSuccess:true,isPending:false,isError:false});');
  await mock('@/lib/local-read-only', 'export const isLocalReadOnlyMode=()=>false;');
  await mock('@/lib/api/vimob-client', 'export class VimobAPIError extends Error {}');
  await mock('@/components/features/pipelines/StageColorPicker', 'export const StageColorPicker=()=>null;');
  const mutation = `import React from'react';function useMutation(kind){const[pending,setPending]=React.useState(false);return{isPending:pending,capture:payload=>({...payload}),discard:()=>{},isCurrent:()=>true,isScopeCurrent:()=>true,mutateAsync:async payload=>{setPending(true);try{return await window.h.mutate(kind,payload)}finally{setPending(false)}}};}`;
  await mock('@/hooks/use-stages', `${mutation}const scopeKey={};const scoped=kind=>({...useMutation(kind),scopeKey,captureScopeGuard:()=>()=>true});export const useUpdateStage=()=>scoped('general');export const useStages=()=>({data:window.h.stages,isPending:false});export const useReorderStages=()=>scoped('reorder');export const useDeleteStage=()=>scoped('stage-delete');`);
  await mock('@/hooks/use-stage-automations', `${mutation}
    export const useStageAutomations=()=>({data:window.h.list,isLoading:false,isError:window.h.listError,isFetching:false,refetch:async()=>{window.h.retries++;return{data:window.h.list}}});
    export const useCreateStageAutomation=()=>({...useMutation('create'),scopeKey:'synthetic-settings',captureScopeGuard:()=>()=>true});export const useUpdateStageAutomation=()=>useMutation('update');export const useDeleteStageAutomation=()=>useMutation('delete');export const useToggleStageAutomation=()=>useMutation('toggle');
    export const AUTOMATION_TYPE_LABELS={alert_on_inactivity:'Alerta por inatividade',change_assignee_on_enter:'Mudar responsável',change_deal_status_on_enter:'Mudar status',move_stage_on_inactivity:'Mudar etapa por tempo parado',redistribute_on_inactivity:'Redistribuir lead por tempo parado'};
    export const isInactivityAutomationType=type=>['alert_on_inactivity','move_stage_on_inactivity','redistribute_on_inactivity'].includes(type);
    export const managedInactivityAlert=list=>list?.filter(item=>item.automation_type==='alert_on_inactivity'&&(item.inactivity_policy?.action??'notify')==='notify').sort((a,b)=>(a.created_at??'').localeCompare(b.created_at??'')||a.id.localeCompare(b.id))[0]??null;export const AUTOMATION_TYPE_DESCRIPTIONS={};export const DEAL_STATUS_LABELS={open:'Aberto',won:'Ganho',lost:'Perdido'};`);
  await mock('@/hooks/use-stage-inactivity-automation', `${mutation}export const useStageInactivityAutomation=()=>({...useMutation('inactivity'),scopeKey:'synthetic-settings',captureScopeGuard:()=>()=>true});`);
  await mock('@/hooks/cadences', `${mutation}export const useStageOperationalRules=()=>({data:window.h.rules,isPending:false,refetch:async()=>({data:window.h.rules})});export const useUpdateStageOperationalRules=()=>({...useMutation('rules'),captureScopeGuard:()=>()=>true});`);
  await mock('@/hooks/cadences/use-stage-operational-rules', 'export const stageOperationalRulesErrorMessage=(error,fallback)=>error?.message||fallback;');
  await mock('@/hooks/attention', 'export const useAttentionSettings=()=>({data:{engineMode:"enabled",notificationsEnabled:true},isPending:false,isError:false});export const useAttentionPolicies=()=>({data:[],isPending:false,isError:false});');
  await mock('@/components/features/cadences', `export {StageOperationalRules} from ${JSON.stringify(join(repository, 'components/features/cadences/StageOperationalRules.tsx'))};`);
  const loader = join(directory, 'tsx-loader.cjs');
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;`);
  const entry = join(directory, 'entry.js');
  await writeFile(entry, `import React from'react';import{createRoot}from'react-dom/client';import{StageSettingsDialog}from'@/components/features/pipelines/StageSettingsDialog';import{StagesEditorDialog}from'@/components/features/pipelines/StagesEditorDialog';import{AutomationsList}from'@/components/features/automations/AutomationsList';import{AutomationForm}from'@/components/features/automations/AutomationForm';import{StageColumnMenu}from'@/components/features/pipelines/pipeline-screen/StageColumnMenu';
    const id='11111111-1111-4111-8111-111111111111',pipeline='33333333-3333-4333-8333-333333333333';
    const h=window.h={open:true,mode:'settings',list:[],stages:[],moveTargets:[{id:'44444444-4444-4444-8444-444444444444',name:'Retomar contato'}],listError:false,retries:0,calls:[],pending:null,stage:{id,name:'Novo',color:'#123456',stage_key:'new',pipeline_id:pipeline,position:0,updated_at:'2026-10-12T12:00:00Z'}};
    h.rules={stage_id:id,pipeline_id:pipeline,revision:7,cadence:{enabled:true,tasks:[{id:'55555555-5555-4555-8555-555555555555',position:0,type:'call',title:'Ligar',due_minutes:60,warning_minutes:0,is_required:true,outcome_required:true}]},attention:{source_mode:'inherit',mode:'enabled',warning_minutes:0,business_hours_only:false},lifecycle:{on_stage_move:'skip_pending',on_won:'cancel_pending',on_lost:'cancel_pending',on_reopen:'new_cycle'}};
    h.mutate=(kind,payload)=>{h.calls.push({kind,payload});return new Promise((resolve,reject)=>{h.pending={resolve:response=>resolve(response??(kind==='rules'?{...h.rules,...payload,revision:8}:{})),reject:()=>reject(Error('Falha sintética'))}})};
    const root=createRoot(document.getElementById('root'));
    h.render=()=>root.render(h.mode==='menu'?React.createElement(React.Fragment,null,React.createElement(StageColumnMenu,{stageName:h.stage.name,isMobile:false,onSelect:(tab,returnFocusElement)=>{h.initialTab=tab;h.returnFocusElement=returnFocusElement;h.open=true;h.render()}}),h.open?React.createElement(StageSettingsDialog,{key:h.stage.id+':'+h.initialTab,initialTab:h.initialTab,returnFocusElement:h.returnFocusElement,open:true,stage:h.stage,onOpenChange:open=>{h.open=open;h.render()},onStageUpdate:()=>{h.open=false;h.render()}}):null):h.mode==='settings'?React.createElement(StageSettingsDialog,{initialTab:h.initialTab,open:h.open,stage:h.stage,onOpenChange:open=>{h.open=open;h.render()},onStageUpdate:()=>{h.open=false;h.render()}}):h.mode==='editor'?React.createElement(StagesEditorDialog,{open:h.open,pipelineId:pipeline,pipelineName:'Vendas',stages:[h.stage],archivedStages:h.archivedStages||[],onOpenChange:open=>{h.open=open;h.render()}}):h.mode==='list'?React.createElement(AutomationsList,{stageId:id,canEdit:true,stageNames:{'44444444-4444-4444-8444-444444444444':'Retomar contato'},hideManagedAlert:h.hideManagedAlert}):React.createElement(AutomationForm,{stageId:id,pipelineId:pipeline,moveTargets:h.moveTargets,onSuccess:()=>{h.success=true},onCancel:()=>{h.cancelled=true}}));`);
  await new Promise((done, reject) => {
    const compiler = webpack({ mode: 'development', target: 'web', entry, output: { path: directory, filename: 'settings.js' },
      resolve: { extensions: ['.ts', '.tsx', '.js'], modules: [join(repository, 'node_modules'), 'node_modules'], alias: { ...aliases, '@': repository } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] } });
    compiler.run((error, stats) => compiler.close(() => error ? reject(error) : stats.hasErrors() ? reject(Error(stats.toString({ all: false, errors: true }))) : done()));
  });
  bundle = await readFile(join(directory, 'settings.js'), 'utf8');
  browser = await chromium.launch({ headless: true });
}, { timeout: 180_000 });

after(async () => {
  await browser?.close();
  if (directory) {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('vimob-pipeline-settings-'));
    await rm(directory, { recursive: true, force: true });
  }
});

async function open(mode = 'settings', state = {}) {
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  await page.route('**/*', route => route.abort());
  await page.setContent('<html><body><div id="root"></div></body></html>');
  // Minimal layout for real portals; this suite tests behavior, not appearance.
  await page.addStyleTag({ content: '[role="dialog"],[role="alertdialog"]{position:fixed;inset:20px;overflow:auto;background:white;padding:20px}[role="dialog"][data-state="closed"],[role="alertdialog"][data-state="closed"]{display:none}' });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(({ mode, state }) => { Object.assign(window.h, state, { mode }); window.h.render(); }, { mode, state });
  return page;
}

test('column settings preserve draft on cancelled discard and close only after explicit discard', async () => {
  const page = await open();
  try {
    await page.getByLabel('Nome da coluna', { exact: true }).fill('Contato');
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await page.getByRole('button', { name: 'Continuar editando' }).click();
    assert.equal(await page.getByLabel('Nome da coluna', { exact: true }).inputValue(), 'Contato');
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await page.getByRole('button', { name: 'Descartar alterações', exact: true }).click();
    await page.waitForFunction(() => !window.h.open);
  } finally { await page.close(); }
});

test('column menu opens the selected real sheet tab and releases focus after closing', async () => {
  const page = await open('menu', { open: false });
  try {
    for (const [label, tabName] of [['Configurações da coluna', 'Geral'], ['Regras da etapa', 'Regras da etapa'], ['Automações', 'Automações']]) {
      await page.getByRole('button', { name: 'Configurar coluna Novo', exact: true }).click();
      const menu = page.getByRole('menu');
      await menu.waitFor();
      assert.equal(await page.getByRole('dialog').count(), 0);
      await menu.getByRole('menuitem', { name: label, exact: true }).click();
      const tab = page.getByRole('tab', { name: tabName });
      await tab.waitFor();
      assert.equal(await tab.getAttribute('aria-selected'), 'true');
      assert.equal(await page.getByRole('tabpanel').count(), 1);
      await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.contains(document.activeElement));
      assert.equal(await page.evaluate(() => window.h.calls.length), 0);
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      await page.waitForFunction(() => !window.h.open && getComputedStyle(document.body).pointerEvents !== 'none');
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Configurar coluna Novo', undefined, { timeout: 5000 });
    }
  } finally { await page.close(); }
});

test('opening automations directly retains the organization module restriction', async () => {
  const page = await open('settings', { initialTab: 'automations', denyAutomations: true });
  try {
    await page.getByText('Você não tem acesso às automações desta organização', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Adicionar', exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => window.h.calls.length), 0);
  } finally { await page.close(); }
});

test('failed automation read is not empty and retry remains available', async () => {
  const page = await open('list', { list: undefined, listError: true });
  try {
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByText('Nenhuma automação configurada', { exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Tentar novamente' }).click();
    assert.equal(await page.evaluate(() => window.h.retries), 1);
  } finally { await page.close(); }
});

test('automation switches serialize requests and failed delete keeps confirmation for retry', async () => {
  const page = await open('list', { list: [{ id: 'auto', automation_type: 'change_deal_status_on_enter', is_active: true, updated_at: '2026-10-16T12:00:00.123456Z', action_config: { deal_status: 'won' } }] });
  try {
    await page.getByRole('switch').click();
    assert.equal(await page.getByRole('switch').isDisabled(), true);
    assert.equal(await page.evaluate(() => window.h.calls.length), 1);
    assert.deepEqual(await page.evaluate(() => window.h.calls[0]), { kind: 'toggle', payload: { id: 'auto', is_active: false, expected_updated_at: '2026-10-16T12:00:00.123456Z' } });
    await page.evaluate(() => window.h.pending.reject());
    await page.getByRole('button', { name: 'Excluir automação', exact: true }).click();
    await page.getByRole('button', { name: 'Excluir', exact: true }).click();
    assert.equal(await page.getByRole('alertdialog').count(), 1);
    assert.deepEqual(await page.evaluate(() => window.h.calls[1]), { kind: 'delete', payload: { id: 'auto', expected_updated_at: '2026-10-16T12:00:00.123456Z' } });
    await page.evaluate(() => window.h.pending.reject());
    await page.getByRole('button', { name: 'Excluir', exact: true }).waitFor();
    assert.equal(await page.getByRole('alertdialog').count(), 1);
    assert.ok(await page.getByRole('alertdialog').getByText('Falha sintética').count());
  } finally { await page.close(); }
});

test('move rule is created disabled through the inactivity runtime and keeps the draft on failure', async () => {
  const page = await open('form');
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  try {
    await page.getByLabel('Tipo de Automação', { exact: true }).click();
    await page.getByRole('option', { name: 'Mudar etapa por tempo parado', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Criar Automação' }).isDisabled(), true);
    await page.getByLabel('Dias sem atividade', { exact: true }).fill('5');
    await page.getByLabel('Mover para a coluna', { exact: true }).click();
    await page.getByRole('option', { name: 'Retomar contato', exact: true }).click();
    await page.getByRole('button', { name: 'Criar Automação' }).click();
    assert.equal(await page.getByLabel('Dias sem atividade', { exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Cancelar', exact: true }).isDisabled(), true);
    assert.deepEqual(await page.evaluate(() => window.h.calls[0]), { kind: 'inactivity', payload: { input: {
      trigger_days: 5, alert_message: '', clock: 'last_interaction', start_mode: 'new_stage_entries', action: 'move_stage',
      target_stage_id: '44444444-4444-4444-8444-444444444444', stage_id: '11111111-1111-4111-8111-111111111111', is_enabled: false } } });
    await page.evaluate(() => window.h.pending.reject());
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByLabel('Dias sem atividade', { exact: true }).inputValue(), '5');
    assert.deepEqual(pageErrors, []);
  } finally { await page.close(); }
});

test('redistribution uses the selected queue and can include leads already in the column', async () => {
  const page = await open('settings', { initialTab: 'automations' });
  try {
    await page.getByRole('button', { name: 'Nova automação', exact: true }).click();
    await page.getByLabel('Tipo de Automação', { exact: true }).click();
    await page.getByRole('option', { name: 'Redistribuir lead por tempo parado', exact: true }).click();
    const create = page.getByRole('button', { name: 'Criar Automação' });
    assert.equal(await create.isDisabled(), true);
    await page.getByLabel('Dias sem atividade', { exact: true }).fill('6');
    await page.getByLabel('Distribuição', { exact: true }).click();
    await page.getByRole('option', { name: 'Equipe de retomada', exact: true }).click();
    await page.getByText('A distribuição também envia o lead para Retomar contato.').waitFor();
    await page.getByLabel('Aplicar a quais leads?', { exact: true }).click();
    await page.getByRole('option', { name: 'Incluir quem já está na coluna', exact: true }).click();
    await create.click();
    await page.waitForFunction(() => window.h.calls.length === 1);
    assert.deepEqual(await page.evaluate(() => window.h.calls[0]), { kind: 'inactivity', payload: { input: {
      trigger_days: 6, alert_message: '', clock: 'last_interaction', start_mode: 'activation', action: 'redistribute',
      target_round_robin_id: '88888888-8888-4888-8888-888888888888', stage_id: '11111111-1111-4111-8111-111111111111', is_enabled: false } } });
  } finally { await page.close(); }
});

test('settings actions sit in the fixed footer: gray Cancelar and orange Salvar', async () => {
  const page = await open();
  try {
    const footer = page.locator('[role="dialog"] > div.border-t');
    assert.equal(await footer.getByRole('button', { name: 'Cancelar', exact: true }).count(), 1);
    const save = footer.getByRole('button', { name: 'Salvar', exact: true });
    assert.equal(await save.isDisabled(), true);
    assert.match(await save.getAttribute('class'), /bg-primary/);
    assert.match(await footer.getByRole('button', { name: 'Cancelar', exact: true }).getAttribute('class'), /app-surface-soft/);
    assert.equal(await page.getByRole('tabpanel').getByRole('button', { name: 'Salvar', exact: true }).count(), 0);
    await page.getByLabel('Nome da coluna', { exact: true }).fill('Contato');
    await save.click();
    await page.waitForFunction(() => window.h.calls.length === 1);
    assert.equal(await page.evaluate(() => window.h.calls[0].payload.name), 'Contato');
    assert.equal(await save.isDisabled(), true);
    await page.getByRole('tab', { name: 'Regras da etapa' }).click();
    assert.equal(await page.getByRole('tab', { name: 'Geral' }).getAttribute('aria-selected'), 'true');
  } finally { await page.close(); }
});

test('inactivity alert is visible above other deadlines and saved by Salvar regras', async () => {
  const page = await open('settings', { initialTab: 'cadence' });
  try {
    const save = page.getByRole('button', { name: 'Salvar regras', exact: true });
    assert.equal(await save.isDisabled(), true);
    assert.equal(await page.getByText('Usar regras padrão', { exact: true }).isVisible(), false);
    await page.getByRole('switch', { name: 'Ativar aviso de lead parado' }).click();
    await page.getByLabel('Dias sem atividade', { exact: true }).fill('4');
    assert.match(await page.getByText(/Sem atividade por 4 dias, o responsável recebe um aviso/).innerText(), /4 dias/);
    await save.click();
    await page.waitForFunction(() => window.h.calls.length === 1);
    assert.deepEqual(await page.evaluate(() => window.h.calls[0]), { kind: 'inactivity', payload: { input: {
      trigger_days: 4, alert_message: '', clock: 'last_interaction', start_mode: 'new_stage_entries', stage_id: '11111111-1111-4111-8111-111111111111', is_enabled: false } } });
    // The synthetic API reports no inactivity runtime: the rule stays disabled and says so.
    await page.evaluate(() => window.h.pending.resolve());
    await page.getByText(/O aviso foi mantido desativado/).waitFor();
    assert.equal(await page.evaluate(() => window.h.calls.length), 1);
    assert.equal(await page.getByRole('switch', { name: 'Ativar aviso de lead parado' }).getAttribute('aria-checked'), 'false');
  } finally { await page.close(); }
});

test('a legacy inactivity alert is prepared disabled before activation with the new revision', async () => {
  const alert = {
    id: 'alert', automation_type: 'alert_on_inactivity', trigger_days: 3, alert_message: 'Parado',
    is_active: false, inactivity_runtime_available: true, created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-16T12:00:00Z',
  };
  const page = await open('settings', { initialTab: 'cadence', list: [alert] });
  try {
    await page.getByRole('switch', { name: 'Ativar aviso de lead parado' }).click();
    const save = page.getByRole('button', { name: 'Salvar regras', exact: true });
    await save.click();
    await page.waitForFunction(() => window.h.calls.length === 1);
    const input = { trigger_days: 3, alert_message: 'Parado', clock: 'last_interaction', start_mode: 'activation' };
    assert.deepEqual(await page.evaluate(() => window.h.calls[0].payload), {
      id: alert.id, runtimeAvailable: true,
      input: { ...input, is_enabled: false, expected_updated_at: alert.updated_at, expected_policy_revision: 0 },
    });
    const prepared = { ...alert, updated_at: '2026-10-16T12:00:00.123456Z', inactivity_policy: {
      revision: 1, clock: 'last_interaction', start_mode: 'activation', is_enabled: false, runtime_available: true,
    } };
    await page.evaluate((value) => window.h.pending.resolve(value), prepared);
    await page.waitForFunction(() => window.h.calls.length === 2);
    assert.deepEqual(await page.evaluate(() => window.h.calls[1].payload), {
      id: alert.id, runtimeAvailable: true,
      input: { ...input, is_enabled: true, expected_updated_at: prepared.updated_at, expected_policy_revision: 1 },
    });
    await page.evaluate((value) => {
      window.h.list = [value];
      window.h.pending.reject();
    }, prepared);
    await page.getByRole('alert').filter({ hasText: 'O aviso foi salvo desativado. Falha sintética' }).waitFor();
    assert.equal(await save.isEnabled(), true);
    await save.click();
    await page.waitForFunction(() => window.h.calls.length === 3);
    assert.deepEqual(await page.evaluate(() => window.h.calls[2].payload), {
      id: alert.id, runtimeAvailable: true,
      input: { ...input, is_enabled: true, expected_updated_at: prepared.updated_at, expected_policy_revision: 1 },
    });
    const enabled = { ...prepared, updated_at: '2026-10-16T12:00:01.123456Z', inactivity_policy: {
      ...prepared.inactivity_policy, revision: 2, is_enabled: true,
    } };
    await page.evaluate((value) => {
      window.h.list = [value];
      window.h.pending.resolve(value);
    }, enabled);
    await page.getByText('Tudo salvo', { exact: true }).waitFor();
    assert.equal(await page.getByRole('switch', { name: 'Desativar aviso de lead parado' }).getAttribute('aria-checked'), 'true');
  } finally { await page.close(); }
});

test('cadence edits show no warning for a saved zero and submit a short warning in days', async () => {
  const page = await open('settings', { initialTab: 'cadence' });
  try {
    await page.getByText('Sem aviso', { exact: true }).waitFor();
    await page.getByLabel('Prazo após entrar na etapa', { exact: true }).fill('0.03');
    await page.getByRole('switch', { name: 'Ativar antecedência em prioridades' }).click();
    await page.getByRole('combobox', { name: 'Unidade de antecedência em prioridades' }).click();
    await page.getByRole('option', { name: 'Dias', exact: true }).click();
    assert.equal(await page.getByLabel('Antecedência em Prioridades', { exact: true }).inputValue(), '0.0007');
    await page.getByRole('button', { name: 'Salvar regras', exact: true }).click();
    await page.waitForFunction(() => window.h.calls.length === 1);
    const task = await page.evaluate(() => window.h.calls[0].payload.cadence.tasks[0]);
    assert.equal(task.due_minutes, 2);
    assert.equal(task.warning_minutes, 1);
  } finally { await page.close(); }
});

test('automations list leaves the managed alert to the rules tab and describes move rules', async () => {
  const policy = { revision: 2, is_enabled: true, effective_enabled: true, runtime_available: true, clock: 'last_interaction', start_mode: 'activation' };
  const page = await open('list', { hideManagedAlert: true, list: [
    { id: 'alert', automation_type: 'alert_on_inactivity', trigger_days: 3, alert_message: 'Parado', is_active: true, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-16T12:00:00Z', inactivity_policy: { ...policy, action: 'notify' } },
    { id: 'move', automation_type: 'move_stage_on_inactivity', trigger_days: 5, target_stage_id: '44444444-4444-4444-8444-444444444444', is_active: true, created_at: '2026-10-02T00:00:00Z', updated_at: '2026-10-16T12:00:00.5Z', inactivity_policy: { ...policy, action: 'move_stage', target_stage_id: '44444444-4444-4444-8444-444444444444' } },
  ] });
  try {
    await page.getByText('5 dias sem atividade → Retomar contato').waitFor();
    assert.equal(await page.getByText('3 dias - Parado').count(), 0);
    await page.getByRole('switch').click();
    assert.deepEqual(await page.evaluate(() => window.h.calls[0].payload), { id: 'move', runtimeAvailable: true, input: {
      trigger_days: 5, alert_message: '', is_enabled: false, clock: 'last_interaction', start_mode: 'activation',
      expected_updated_at: '2026-10-16T12:00:00.5Z', expected_policy_revision: 2, action: 'move_stage', target_stage_id: '44444444-4444-4444-8444-444444444444' } });
  } finally { await page.close(); }
});

test('last cadence task removal is confirmed as draft and rule save prevents closing the sheet', async () => {
  const page = await open();
  try {
    await page.getByRole('tab', { name: 'Regras da etapa' }).click();
    await page.getByRole('button', { name: 'Remover tarefa', exact: true }).click();
    await page.getByRole('alertdialog').waitFor();
    assert.equal(await page.evaluate(() => window.h.calls.length), 0);
    await page.getByRole('button', { name: 'Manter tarefa' }).click();
    await page.getByRole('button', { name: 'Remover tarefa', exact: true }).click();
    await page.getByRole('button', { name: 'Remover do rascunho' }).click();
    assert.equal(await page.evaluate(() => window.h.calls.length), 0);
    await page.getByRole('button', { name: 'Salvar regras', exact: true }).click();
    await page.waitForFunction(() => window.h.calls.length === 1);
    assert.equal(await page.evaluate(() => window.h.calls[0].payload.cadence.tasks.length), 0);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => window.h.open), true);
    assert.equal(await page.getByRole('alertdialog').count(), 0);
    await page.evaluate(() => window.h.pending.reject());
    await page.getByText('Falha sintética', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('alertdialog').waitFor();
    await page.getByRole('button', { name: 'Continuar editando' }).click();
    assert.equal(await page.getByText('Nenhuma tarefa configurada', { exact: true }).count(), 1);
  } finally { await page.close(); }
});

test('actual stage editor sends revision, preserves failed edits and asks before discard', async () => {
  const page = await open('editor');
  try {
    await page.getByRole('button', { name: 'Editar coluna Novo', exact: true }).click();
    await page.getByLabel('Nome da coluna Novo', { exact: true }).fill('Contato');
    await page.getByRole('button', { name: 'Confirmar edição da coluna Novo', exact: true }).click();
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await page.waitForFunction(() => window.h.calls.length === 1);
    const payload = await page.evaluate(() => window.h.calls[0].payload);
    assert.equal(payload.stages[0].expectedUpdatedAt, '2026-10-12T12:00:00Z');
    assert.equal(payload.stages[0].name, 'Contato');
    await page.evaluate(() => window.h.pending.reject());
    await page.getByRole('alert').waitFor();
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await page.getByRole('alertdialog').waitFor();
    await page.getByRole('button', { name: 'Continuar editando' }).click();
    assert.equal(await page.getByText('Contato', { exact: true }).count(), 1);
  } finally { await page.close(); }
});

test('archive uses guarded active patch and keeps confirmation after rejection', async () => {
  const page = await open();
  try {
    await page.getByRole('button', { name: 'Arquivar coluna', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Arquivar coluna', exact: true }).click();
    await page.waitForFunction(() => window.h.calls.length === 1);
    assert.equal(await page.evaluate(() => window.h.calls[0].payload.isActive), false);
    await page.evaluate(() => window.h.pending.reject());
    await page.getByRole('alertdialog').getByRole('alert').waitFor();
    assert.equal(await page.evaluate(() => window.h.open), true);
    await page.getByRole('alertdialog').getByRole('button', { name: 'Arquivar coluna', exact: true }).click();
    await page.evaluate(() => window.h.pending.resolve());
    await page.waitForFunction(() => !window.h.open);
  } finally { await page.close(); }
});

test('Escape cancels just the inline column edit without closing the editor', async () => {
  const page = await open('editor');
  try {
    await page.getByRole('button', { name: 'Editar coluna Novo', exact: true }).click();
    await page.getByLabel('Nome da coluna Novo', { exact: true }).fill('Contato');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => window.h.open), true);
    assert.equal(await page.getByRole('alertdialog').count(), 0);
    assert.equal(await page.getByText('Novo', { exact: true }).count(), 1);
    assert.equal(await page.evaluate(() => window.h.calls.length), 0);
  } finally { await page.close(); }
});

test('archived stage restoration stays outside active reorder and preserves error for retry', async () => {
  const page = await open('editor', { archivedStages: [{ id: '22222222-2222-4222-8222-222222222222', name: 'Antiga', color: '#123456', stage_key: 'old', position: 1, updated_at: '2026-10-11T12:00:00Z' }] });
  try {
    await page.getByRole('button', { name: 'Reativar coluna Antiga', exact: true }).click();
    await page.waitForFunction(() => window.h.calls.length === 1);
    assert.deepEqual(await page.evaluate(() => window.h.calls[0].payload), { id: '22222222-2222-4222-8222-222222222222', expectedUpdatedAt: '2026-10-11T12:00:00Z', isActive: true });
    assert.equal(await page.getByRole('button', { name: 'Reativar coluna Antiga', exact: true }).isDisabled(), true);
    await page.evaluate(() => window.h.pending.reject());
    await page.getByRole('alert').waitFor();
    await page.getByRole('button', { name: 'Reativar coluna Antiga', exact: true }).click();
    await page.evaluate(() => window.h.pending.resolve());
    await page.waitForFunction(() => !document.querySelector('[aria-label="Reativar coluna Antiga"]'));
    assert.equal(await page.evaluate(() => window.h.calls.every(call => call.kind === 'general')), true);
  } finally { await page.close(); }
});

test('general editor keeps opening revision and dirty fields across a remote refetch and failure', async () => {
  const stage = { id: '11111111-1111-4111-8111-111111111111', name: 'Novo', color: '#123456', stage_key: 'new',
    pipeline_id: '33333333-3333-4333-8333-333333333333', position: 0, is_qualified: true,
    updated_at: '2026-10-16T12:00:00.123456Z' };
  const page = await open('settings', { stage });
  try {
    await page.getByLabel('Nome da coluna', { exact: true }).fill('Meu rascunho');
    await page.evaluate(() => {
      window.h.stage = { ...window.h.stage, name: 'Outro gestor', color: '#abcdef', is_qualified: false,
        updated_at: '2026-10-16T12:00:00.123457Z' };
      window.h.render();
    });
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await page.waitForFunction(() => window.h.calls.length === 1);
    assert.deepEqual(await page.evaluate(() => window.h.calls[0].payload), {
      id: stage.id, expectedUpdatedAt: stage.updated_at, name: 'Meu rascunho',
    });
    await page.evaluate(() => window.h.pending.reject());
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByLabel('Nome da coluna', { exact: true }).inputValue(), 'Meu rascunho');
    assert.equal(await page.evaluate(() => window.h.calls.length), 1);
    assert.equal(await page.getByText(/Seu rascunho foi mantido/).count(), 1);
  } finally { await page.close(); }
});

test('bulk editor pins the revision while text is still being typed before confirmation', async () => {
  const page = await open('editor');
  try {
    await page.getByRole('button', { name: 'Editar coluna Novo', exact: true }).click();
    await page.getByLabel('Nome da coluna Novo', { exact: true }).fill('Meu rascunho');
    await page.evaluate(() => {
      window.h.stage = { ...window.h.stage, name: 'Outro gestor', updated_at: '2026-10-16T12:00:00.123456Z' };
      window.h.render();
    });
    await page.getByText(/Seu rascunho foi mantido/).waitFor();
    assert.equal(await page.getByLabel('Nome da coluna Novo', { exact: true }).inputValue(), 'Meu rascunho');
    await page.getByRole('button', { name: 'Confirmar edição da coluna Novo', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Salvar', exact: true }).isDisabled(), true);
    assert.equal(await page.evaluate(() => window.h.calls.length), 0);
  } finally { await page.close(); }
});
