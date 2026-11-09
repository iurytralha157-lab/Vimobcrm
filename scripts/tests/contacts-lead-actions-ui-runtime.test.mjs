import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect } from '@playwright/test';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const screenshot = process.env.VIMOB_CONTACTS_LEAD_ACTIONS_SCREENSHOT;
const directory = await mkdtemp(path.join(tmpdir(), 'vimob-contacts-lead-actions-ui-'));
let harness = await readFile(path.join(repository, 'scripts/tests/contacts-filter-application-runtime.test.mjs'), 'utf8');
harness = harness.slice(0, harness.indexOf('async function restore('));
assert.ok(harness.includes('const synthetic ='), 'reuse the existing offline real-screen harness');
harness = harness
  .replace("import { chromium, expect } from '@playwright/test';", () => 'import playwright from ' + JSON.stringify(pathToFileURL(require.resolve('@playwright/test')).href) + ';const{chromium,expect}=playwright;')
  .replace('createRequire(import.meta.url)', () => 'createRequire(' + JSON.stringify(path.join(repository, 'package.json')) + ')')
  .replace("path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')", () => JSON.stringify(repository))
  .replaceAll('tmpdir()', JSON.stringify(directory))
  .replace('const auth={', 'window.fixturePermissions=[\'lead_operate\'];\nconst auth={')
  .replace('session:null,isSuperAdmin:true', 'session:null,isSuperAdmin:false')
  .replace('hasPermission:()=>true', 'hasPermission:(permission)=>window.fixturePermissions.includes(permission)')
  .replace('export const useIsMobile=()=>false;', "export const useIsMobile=()=>matchMedia('(max-width:767px)').matches;")
  .replace('export const useToast=()=>({toast:noop});', 'export const useToast=()=>({toast:(notice)=>window.fixtureNotices.push(notice)});')
  .replace('export const useOrganizationUsers=()=>({data:[]});', "export const useOrganizationUsers=()=>({data:[{id:'owner-1',name:'Responsável Sintético',is_active:true},{id:'owner-2',name:'Responsável Inativo',is_active:false}]});")
  .replace("name:'A1'}]:[]", "name:'A1',pipeline_id:id},{id:'loss-stage',name:'Sem interesse',pipeline_id:id,is_lost:true}]:[]")
  .replace("export const MAX_CONTACT_LEAD_ACTION_TARGETS=100;", '')
  .replace("export const useContactLeadActions=()=>({prepare:()=>{throw Error('No lead review in the filter fixture');},run:()=>{throw Error('No lead writes in the filter fixture');}});", '')
  .replace('window.fixtureQueries=[];', [
    'window.fixtureQueries=[];window.fixtureActions=[];window.fixtureReviews=[];window.fixtureNotices=[];window.fixtureExcluded=[];',
    "const contacts=['Ana Sintética','Beto Sintético','Caio Sintético'].map((name,index)=>({id:String(index+1),name,phone:'+5511999999999',email:'contact@example.invalid',created_at:'2026-10-01T10:00:00Z',stage_name:'Atendimento',pipeline_name:'Pipeline sintética',source:'manual',deal_status:index===2?'won':'open',reentry_count:0,assignee_name:'Responsável atual',tags:[]}));",
    'export const MAX_CONTACT_LEAD_ACTION_TARGETS=100;',
    'export const useContactLeadActions=()=>({',
    '  async prepare(ids,isCurrent){',
    '    if(!isCurrent())throw Error("expired review");window.fixtureReviews.push(ids);',
    '    if(window.fixtureHoldPrepare)await new Promise(resolve=>{window.fixtureReleasePrepare=resolve;});',
    '    if(!isCurrent())throw Error("expired review");',
    '    return {targets:contacts.filter(c=>ids.includes(c.id)&&!window.fixtureExcluded.includes(c.id)).map(c=>({...c,status:c.deal_status})),failures:ids.filter(id=>window.fixtureExcluded.includes(id)).map(id=>({id,message:"Sem acesso"})),unstartedIds:[]};',
    '  },',
    '  async run({review,action,isCurrent,onProgress}){',
    '    if(!isCurrent())throw Error("expired confirmation");',
    '    const ids=review.targets.map(c=>c.id);window.fixtureActions.push({ids,action});onProgress?.(1,ids.length);',
    '    if(window.fixtureHoldRun)await new Promise(resolve=>{window.fixtureReleaseRun=resolve;});',
    '    return {succeededIds:ids,unchangedIds:[],failures:[],unconfirmedIds:[],unstartedIds:[],financialReviewIds:[]};',
    '  }',
    '});',
  ].join('\n'))
  .replace('return {data:[],total:200', 'return {data:contacts,total:contacts.length')
  .replace('export const AppLayout=({children})=><>{children}</>;', "export const AppLayout=({children})=><main className='app-shell' style={{height:'100dvh',padding:12}}>{children}</main>;")
  .replace('export const ContactsList=props=><><button onClick={()=>props.footer?.props.onPageChange(4)}>Page4</button>{props.footer}</>;', "export {ContactsList} from '@/components/features/contacts/contacts-screen/ContactsList';")
  .replace('export const ContactsOverlays=props=>{window.fixtureOverlays=props;return null;};\nexport const ContactsBulkSelectionBar=()=>null;', [
    "export {ContactsOverlays,ContactsBulkSelectionBar} from '@/components/features/contacts/contacts-screen/ContactsOverlays';",
    'export const LeadDetailDialog=()=>null;export const CreateLeadDialog=()=>null;',
    'export const ImportContactsDialog=()=>null;export const ExportContactsDialog=()=>null;',
  ].join('\n'))
  .replace("'components/features/contacts/contacts-screen'];", "'components/features/contacts/contacts-screen','components/features/leads/LeadDetailDialog','components/features/leads/CreateLeadDialog','components/features/contacts/ImportContactsDialog','components/features/contacts/ExportContactsDialog'];")
  .replace('  browser = await chromium.launch', [
    "  const productCss=(await readFile(path.join(root,'app/globals.css'),'utf8')).replace('@import \"tailwindcss\";','@import \"tailwindcss\" source(none);');",
    "  const sources=['components/features/contacts','components/features/leads/LostReasonDialog.tsx','components/ui'];",
    "  css=(await require('postcss')([require('@tailwindcss/postcss')({base:root})]).process(productCss+'\\n'+sources.map(source=>'@source '+JSON.stringify(path.join(root,source).replaceAll('\\\\','/'))+';').join('\\n'),{from:path.join(root,'app/contacts-actions-offline-fixture.css')})).css;",
    '  browser = await chromium.launch',
  ].join('\n'))
  .replace('let directory, browser, page;', 'let directory, browser, page, css; const externalRequests=[];')
  .replace("body: '<div id=\"app\"></div>' }) : route.abort()", "body: '<style>'+css+'</style><div id=\"app\"></div>' }) : (externalRequests.push(route.request().url()),route.abort())")
  .replace('  assert.deepEqual(errors, []);', '  assert.deepEqual(errors, []);assert.deepEqual(externalRequests, []);')
  + '\nexport const currentPage=()=>page;\n';
assert.ok(harness.includes('export {ContactsOverlays,ContactsBulkSelectionBar}'));
assert.ok(harness.includes("export const MAX_CONTACT_LEAD_ACTION_TARGETS=100;"));
await writeFile(path.join(directory, 'runtime.mjs'), harness);
const ui = await import(pathToFileURL(path.join(directory, 'runtime.mjs')).href);
after(async () => {
  const target = path.resolve(directory);
  assert.equal(path.dirname(target), path.resolve(tmpdir()));
  assert.match(path.basename(target), /^vimob-contacts-lead-actions-ui-/);
  await rm(target, { recursive: true, force: true });
});

const page = () => ui.currentPage();
const actions = () => page().evaluate(() => window.fixtureActions);
const dialog = () => page().getByRole('dialog');
const checkbox = (name) => page().getByRole('checkbox', { name: 'Selecionar ' + name, exact: true });
const row = (name) => page().getByRole('button', { name: 'Ações de ' + name, exact: true });
const bulk = () => page().getByRole('button', { name: 'Ações para contatos selecionados', exact: true });
const menuItem = (name) => page().getByRole('menuitem', { name, exact: true });
async function choose(label, option) {
  await dialog().getByRole('combobox', { name: label, exact: true }).click();
  await page().getByRole('option', { name: option, exact: true }).click();
}
async function openAction(trigger, label) {
  await trigger.click();
  await menuItem(label).click();
  await expect(dialog()).toBeVisible();
}
async function selectTwo() {
  await checkbox('Ana Sintética').check();
  await checkbox('Beto Sintético').check();
}
async function resize(width) {
  await page().setViewportSize({ width, height: 820 });
  await page().evaluate(() => window.fixtureRerender());
}

for (const width of [1280, 390]) {
  test('row action ignores the selected contacts and preserves the menu at ' + width, async () => {
    await resize(width);
    await selectTwo();
    const trigger = row('Caio Sintético');
    const dimensions = await trigger.boundingBox();
    assert.deepEqual([dimensions.width, dimensions.height], [32, 32], 'the existing row action trigger stays 32px square');
    await trigger.click();
    await expect(menuItem('Ver detalhes')).toBeVisible();
    await expect(menuItem('Excluir')).toHaveCount(0);
    await menuItem('Alterar responsável').click();
    await expect(dialog().getByRole('list', { name: 'Contatos para alteração' })).toHaveText('Caio Sintético');
    await choose('Responsável', 'Responsável Sintético');
    await dialog().getByRole('button', { name: 'Confirmar', exact: true }).click();
    await expect.poll(actions).toEqual([{ ids: ['3'], action: { kind: 'assign', assignedUserId: 'owner-1' } }]);
    await expect(dialog()).toHaveCount(0);
    await expect(checkbox('Ana Sintética')).toBeChecked();
    await expect(checkbox('Beto Sintético')).toBeChecked();
  });
}

test('bulk status loss requires the existing reason dialog, then writes the reviewed pair', async () => {
  if (screenshot) {
    await page().evaluate(() => {
      window.fixturePermissions = ['lead_operate', 'lead_delete'];
      window.fixtureRerender();
    });
  }
  await selectTwo();
  const dimensions = await bulk().boundingBox();
  assert.deepEqual([dimensions.width, dimensions.height], [32, 32]);
  if (screenshot) await expect(page().getByRole('button', { name: 'Excluir', exact: true })).toBeVisible();
  await bulk().click();
  await expect(menuItem('Alterar status')).toBeVisible();
  if (screenshot) {
    await mkdir(path.dirname(screenshot), { recursive: true });
    const table = await page().locator('[data-tour="contacts-list"]').boundingBox();
    const { width, height } = page().viewportSize();
    // Capture the actual list, pagination and selection bar, below the stub toolbar.
    const y = Math.floor(table.y);
    await page().screenshot({ path: screenshot, animations: 'disabled', clip: { x: 0, y, width, height: height - y } });
  }
  await menuItem('Alterar status').click();
  await choose('Status', 'Perdido');
  await dialog().getByRole('button', { name: 'Confirmar', exact: true }).click();
  await expect(dialog().getByRole('heading', { name: 'Marcar como perdido' })).toBeVisible();
  await expect(dialog().getByRole('button', { name: 'Confirmar perda' })).toBeDisabled();
  assert.deepEqual(await actions(), []);
  await dialog().getByRole('button', { name: 'Não respondeu', exact: true }).click();
  await dialog().getByRole('button', { name: 'Confirmar perda' }).click();
  await expect.poll(actions).toEqual([{ ids: ['1', '2'], action: { kind: 'deal-status', status: 'lost', lostReason: 'Não respondeu' } }]);
  await expect(dialog()).toHaveCount(0);
  await expect(checkbox('Ana Sintética')).not.toBeChecked();
});

test('bulk assignment only dispatches reviewed eligible targets and keeps exclusions selected', async () => {
  await page().evaluate(() => { window.fixtureExcluded=['2']; window.fixtureHoldRun=true; });
  await selectTwo();
  await openAction(bulk(), 'Alterar responsável');
  await expect(dialog().getByText('Beto Sintético — Sem acesso')).toBeVisible();
  await choose('Responsável', 'Responsável Sintético');
  await dialog().getByRole('button', { name: 'Confirmar', exact: true }).click();
  await expect(dialog().getByText('1 de 1 contatos processados')).toBeVisible();
  await page().evaluate(() => window.fixtureReleaseRun());
  await expect.poll(actions).toEqual([{ ids: ['1'], action: { kind: 'assign', assignedUserId: 'owner-1' } }]);
  await expect(dialog()).toHaveCount(0);
  await expect(checkbox('Beto Sintético')).toBeChecked();
  await expect(checkbox('Ana Sintética')).not.toBeChecked();
  assert.equal(await page().evaluate(() => window.fixtureNotices.at(-1)?.title), 'Confira o resultado da ação');
});

test('bulk move dispatches the chosen pipeline and stage only after confirmation', async () => {
  await selectTwo();
  await openAction(bulk(), 'Mover para funil/etapa');
  await expect(dialog().getByRole('combobox', { name: 'Etapa' })).toBeDisabled();
  await choose('Funil', 'A');
  await choose('Etapa', 'A1');
  assert.deepEqual(await actions(), []);
  await dialog().getByRole('button', { name: 'Confirmar', exact: true }).click();
  const [result] = await actions();
  assert.deepEqual(result, {
    ids: ['1', '2'],
    action: { kind: 'move-stage', pipelineId: '30000000-0000-4000-8000-000000000001', stageId: '40000000-0000-4000-8000-000000000001' },
  });
});

test('reopening a won contact keeps commissions warning and requires a deliberate action', async () => {
  await openAction(row('Caio Sintético'), 'Alterar status');
  await choose('Status', 'Aberto');
  await expect(dialog().getByText(/Lançamentos e comissões existentes serão mantidos/)).toBeVisible();
  assert.deepEqual(await actions(), []);
  await dialog().getByRole('button', { name: 'Reabrir', exact: true }).click();
  await expect.poll(actions).toEqual([{ ids: ['3'], action: { kind: 'deal-status', status: 'open' } }]);
});

test('filter change invalidates an in-flight review without dispatch', async () => {
  await page().evaluate(() => { window.fixtureHoldPrepare=true; });
  await selectTwo();
  await openAction(bulk(), 'Alterar status');
  await expect(dialog().getByText('Revisando contatos...')).toBeVisible();
  await page().evaluate(() => window.fixtureContext.setSource('manual'));
  await expect(dialog()).toHaveCount(0);
  await page().evaluate(() => window.fixtureReleasePrepare());
  assert.deepEqual(await actions(), []);
});

test('delete-only permission retains selection, delete and cancel without lead operations', async () => {
  await page().evaluate(() => { window.fixturePermissions=['lead_delete']; window.fixtureRerender(); });
  await selectTwo();
  await expect(page().getByRole('button', { name: 'Excluir', exact: true })).toBeVisible();
  await expect(bulk()).toHaveCount(0);
  await row('Caio Sintético').click();
  await expect(menuItem('Excluir')).toBeVisible();
  await expect(menuItem('Alterar responsável')).toHaveCount(0);
  await page().keyboard.press('Escape');
  await page().getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(checkbox('Ana Sintética')).not.toBeChecked();
  assert.deepEqual(await actions(), []);
});
