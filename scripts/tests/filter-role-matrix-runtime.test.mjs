import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect } from '@playwright/test';

// Reuse the actual ContactsToolbar/SharedFilters/FilterContext/CSS fixture.
// Only catalogs and permission inputs are synthetic; every transport is blocked.
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const directory = await mkdtemp(path.join(tmpdir(), 'vimob-filter-role-matrix-'));
const id = n => '30000000-0000-4000-8000-' + String(n).padStart(12, '0');
const hooks = `import{useSyncExternalStore}from'react';
window.sidebarFixturePath='/crm/contacts';window.sidebarFixtureOrg='10000000-0000-4000-8000-000000000001';
const id=n=>'30000000-0000-4000-8000-'+String(n).padStart(12,'0');
const users=[{id:id(101),name:'Administrador Sintético'},{id:id(102),name:'Líder Sintético'},{id:id(103),name:'Usuária Sintética'},{id:id(104),name:'Ágata Equipe A'},{id:id(105),name:'Bruno Equipe B'}];
const teams=[{id:id(201),name:'Equipe A',is_active:true,members:[{user_id:id(102),is_leader:true},{user_id:id(103)},{user_id:id(104)}]},{id:id(202),name:'Equipe B',is_active:true,members:[{user_id:id(101),is_leader:true},{user_id:id(105)}]},{id:id(203),name:'Equipe inativa',is_active:false,members:[{user_id:id(102),is_leader:true}]}];
const subscribe=fn=>{window.addEventListener('sidebar-fixture-scope',fn);return()=>window.removeEventListener('sidebar-fixture-scope',fn);};
const useRole=()=>useSyncExternalStore(subscribe,()=>window.roleProfile||'admin');
export const usePathname=()=>useSyncExternalStore(subscribe,()=>window.sidebarFixturePath);
export const useAuth=()=>{const role=useRole(),org=useSyncExternalStore(subscribe,()=>window.sidebarFixtureOrg);const actor=id(role==='admin'?101:role==='leader'?102:103);const permissions=role==='admin'?['lead_view_all']:role==='leader'?['lead_view_team','property_view']:['lead_view_own'];return{user:{id:actor},profile:{id:actor},activeOrganization:{organizationId:org},tenantContext:{organizationId:org,memberRole:role==='admin'?'admin':'corretor',permissions,enabledModules:['crm','whatsapp']},isSuperAdmin:false};};
export const useUserPermissions=()=>{const role=useRole();return{isLoading:false,hasPermission:permission=>permission==='whatsapp_view'||(role==='admin'&&permission==='lead_view_all')||(role==='leader'&&['lead_view_team','property_view'].includes(permission))||(role==='standard'&&permission==='lead_view_own')};};
export const useTeams=({enabled=true}={})=>({data:enabled?teams:undefined,isLoading:false,isFetching:false,isSuccess:enabled});
export const useOrganizationUsers=({enabled=true}={})=>({data:enabled?users:undefined,isLoading:false,isFetching:false,isSuccess:enabled});
export const useOrganizationModules=()=>({isLoading:false,hasModule:()=>true});
export const useWhatsAppUnreadCount=()=>({data:0});
export const useCreateTag=()=>({isPending:false,mutateAsync:()=>{throw Error('No mutation in role fixture');}});
`;
let harness = await readFile(path.join(repository, 'scripts/tests/contacts-sidebar-runtime/harness.mjs'), 'utf8');
const playwright = pathToFileURL(require.resolve('@playwright/test')).href;
harness = harness.replace("import { chromium, expect } from '@playwright/test';", () => `import playwright from ${JSON.stringify(playwright)};const{chromium,expect}=playwright;`)
  .replace('createRequire(import.meta.url)', () => `createRequire(${JSON.stringify(path.join(repository, 'package.json'))})`)
  .replace("path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')", () => JSON.stringify(repository))
  .replaceAll('tmpdir()', JSON.stringify(directory));
const syntheticHookBlock = /await writeFile\(hooks,`[\s\S]*?`\);/;
assert.ok(syntheticHookBlock.test(harness), 'existing harness catalog seam is present');
harness = harness.replace(syntheticHookBlock, () => `await writeFile(hooks,${JSON.stringify(hooks)});`);
let fixture = await readFile(path.join(repository, 'scripts/tests/contacts-sidebar-runtime/fixture.mjs'), 'utf8');
fixture = fixture.replace('scopeTeams:teams,scopeUsers:users,scopeOptionsReady:true,', 'scopeOptionsReady:true,')
  .replace("const [mounted,setMounted] = useState(true), [counter,setCounter] = useState(0);", "const [mounted,setMounted] = useState(true), [counter,setCounter] = useState(0), [stage,setStage] = useState(null);window.roleStage=stage;")
  .replace('teamId:filters.teamId,onTeamChange:filters.setTeamId,', "stageId:stage,onStageChange:setStage,stages:[{id:id(41),name:'Estágio A'}],teamId:filters.teamId,onTeamChange:filters.setTeamId,")
  .replace('window.showSidebarFixture = config => {', "window.showSidebarFixture = config => {window.roleProfile=config.role||'admin';window.dispatchEvent(new Event('sidebar-fixture-scope'));");
assert.ok(!fixture.includes('scopeTeams:teams,scopeUsers:users'), 'role catalogs are filtered by the real SharedFilters implementation');
assert.ok(fixture.includes('window.roleStage=stage'), 'stage cascade is observable');
await writeFile(path.join(directory, 'fixture.mjs'), fixture);
await writeFile(path.join(directory, 'harness.mjs'), harness);
const ui = await import(pathToFileURL(path.join(directory, 'harness.mjs')).href);

after(async () => {
  const target = path.resolve(directory);
  assert.equal(path.dirname(target), path.resolve(tmpdir()));
  assert.match(path.basename(target), /^vimob-filter-role-matrix-/);
  await rm(target, { recursive: true, force: true });
});

const roles = ['admin', 'leader', 'standard'];
const widths = [390, 1024];
const control = name => ui.page.getByRole('combobox', { name: new RegExp('^' + name + ':') });
async function choose(name, option) {
  await control(name).click();
  await ui.page.getByRole('option', { name: option, exact: name !== 'Filtrar por corretor' }).click();
  await expect(ui.sidebar()).toBeVisible();
}
async function show(role, width) {
  await ui.show({ role, width, height: 740 });
  await ui.open();
}

for (const role of roles) for (const width of widths) {
  test(`${role}/${width}: team and user options follow permissions, leadership and team membership`, async () => {
    await show(role, width);
    if (role === 'standard') {
      await expect(control('Filtrar por equipe')).toHaveCount(0);
      await expect(control('Filtrar por corretor')).toHaveCount(0);
      return;
    }
    await control('Filtrar por equipe').click();
    await expect(ui.page.getByRole('option', { name: 'Equipe A', exact: true })).toBeVisible();
    await expect(ui.page.getByRole('option', { name: 'Equipe B', exact: true })).toHaveCount(role === 'admin' ? 1 : 0);
    await expect(ui.page.getByRole('option', { name: 'Equipe inativa', exact: true })).toHaveCount(0);
    await ui.page.keyboard.press('Escape');
    await control('Filtrar por corretor').click();
    await expect(ui.page.getByRole('option', { name: 'Ágata Equipe A' })).toBeVisible();
    await expect(ui.page.getByRole('option', { name: 'Bruno Equipe B' })).toHaveCount(role === 'admin' ? 1 : 0);
    await ui.page.keyboard.press('Escape');
    await choose('Filtrar por equipe', 'Equipe A');
    await control('Filtrar por corretor').click();
    await expect(ui.page.getByRole('option', { name: 'Bruno Equipe B' })).toHaveCount(0);
    const search = ui.page.getByRole('combobox', { name: 'Buscar corretor por nome ou e-mail', exact: true });
    await search.fill('agata');
    await ui.page.getByRole('option', { name: 'Ágata Equipe A' }).click();
    assert.equal((await ui.state()).userId, id(104));
    assert.equal((await ui.state()).teamId, id(201));
    await choose('Filtrar por equipe', 'Todas equipes');
    assert.equal((await ui.state()).teamId, null);
    assert.equal((await ui.state()).userId, null, 'changing team clears the dependent user synchronously');
  });

  test(`${role}/${width}: common filters preserve callbacks, cascades and deferred search`, async () => {
    await show(role, width);
    await choose('Filtrar por pipeline', 'Pipeline A');
    await choose('Filtrar por estágio', 'Estágio A');
    assert.equal(await ui.page.evaluate(() => window.roleStage), id(41));
    await choose('Filtrar por pipeline', 'Pipeline B');
    assert.equal(await ui.page.evaluate(() => window.roleStage), null);
    await choose('Filtrar por origem', 'Manual');
    await expect.poll(() => control('Filtrar por origem').evaluate(n => ({ color: getComputedStyle(n).color, label: getComputedStyle(n.querySelector('span')).color, icon: getComputedStyle(n.querySelector('svg')).color }))).toEqual({ color: 'rgb(255, 255, 255)', label: 'rgb(255, 255, 255)', icon: 'rgb(255, 255, 255)' });
    await choose('Filtrar por página do Facebook', 'Página sintética');
    await ui.page.getByRole('button', { name: 'Todas campanhas', exact: true }).click();
    const campaigns = ui.page.getByRole('combobox', { name: 'Buscar campanha', exact: true });
    await campaigns.fill('Campanha A');await campaigns.press('ArrowDown');await ui.page.keyboard.press('Enter');
    await ui.page.keyboard.press('Escape');
    await choose('Filtrar por conjunto de anúncios', 'Conjunto A');
    await choose('Filtrar por anúncio', 'Anúncio A');
    await choose('Filtrar por página do Facebook', 'Todas páginas');
    const cascaded = await ui.state();
    assert.deepEqual([cascaded.campaignIds, cascaded.adSetId, cascaded.adId], [[], null, null]);
    await ui.page.getByRole('button', { name: 'Todas tags', exact: true }).click();
    const tags = ui.page.getByRole('combobox', { name: 'Buscar tag', exact: true });
    await tags.fill('acao');await tags.press('ArrowDown');await ui.page.keyboard.press('Enter');
    await ui.page.keyboard.press('Escape');
    assert.deepEqual((await ui.state()).tagIds, [id(31)]);
    await ui.page.getByRole('combobox', { name: 'Filtrar por status do negócio', exact: true }).click();
    await ui.page.getByRole('option', { name: 'Ganho', exact: true }).click();
    assert.equal((await ui.state()).dealStatus, 'won');
    await ui.search().fill('Busca sintética por perfil');
    assert.equal((await ui.state()).searchQuery, '');
    await ui.page.locator('[data-filter-sidebar="body"]').evaluate(n => { n.scrollTop = 0; });
    await ui.save(`role-${role}-${width}-active`);
    await ui.sidebar().getByRole('button', { name: 'Buscar', exact: true }).click();
    await expect(ui.sidebar()).toHaveCount(0);
    assert.equal((await ui.state()).searchQuery, 'Busca sintética por perfil');
    await ui.page.getByRole('button', { name: /^Período:/ }).click();
    await ui.page.getByRole('button', { name: 'Hoje', exact: true }).click();
    assert.equal((await ui.state()).datePreset, 'today');
    await ui.open();await ui.sidebar().getByRole('button', { name: 'Limpar filtros', exact: true }).click();
    const cleared = await ui.state();
    assert.deepEqual([cleared.pipelineId, cleared.source, cleared.tagIds, cleared.dealStatus, cleared.searchQuery, cleared.datePreset], [null, null, [], null, '', null]);
  });
}

for (const role of ['leader', 'standard']) test(`${role}: unavailable restored selections remain removable without revealing catalog labels`, async () => {
  await show(role, 390);
  await ui.page.evaluate(({ teamId, userId }) => {
    const snapshot = window.sidebarFilters.getFilterSnapshot();
    window.sidebarFilters.restoreFilterSnapshot({ ...snapshot, teamId, userId });
  }, { teamId: id(202), userId: id(105) });
  await expect(ui.sidebar().getByText('Equipe: indisponível', { exact: true })).toBeVisible();
  await expect(ui.sidebar().getByText('Corretor: indisponível', { exact: true })).toBeVisible();
  assert.equal((await ui.state()).teamId, id(202));
  await control('Filtrar por equipe').click();
  await expect(ui.page.getByRole('option', { name: 'Equipe B', exact: true })).toHaveCount(0);
  await ui.page.keyboard.press('Escape');
  await ui.sidebar().getByRole('button', { name: 'Remover filtro: Equipe: indisponível', exact: true }).click();
  assert.deepEqual([(await ui.state()).teamId, (await ui.state()).userId], [null, null]);
});

test('profile and organization transitions clear prior actor scope and never perform network requests', async () => {
  await show('admin', 1024);await choose('Filtrar por equipe', 'Equipe B');
  await choose('Filtrar por corretor', 'Bruno Equipe B');
  await ui.page.evaluate(() => { window.roleProfile = 'standard';window.dispatchEvent(new Event('sidebar-fixture-scope')); });
  await expect.poll(async () => (await ui.state()).teamId).toBe(null);
  await expect.poll(async () => (await ui.state()).userId).toBe(null);
  await expect(control('Filtrar por corretor')).toHaveCount(0);
  await ui.page.evaluate(() => { window.sidebarFixtureOrg = '10000000-0000-4000-8000-000000000002';window.dispatchEvent(new Event('sidebar-fixture-scope')); });
  await expect.poll(async () => (await ui.state()).source).toBe(null);
  assert.deepEqual(ui.errors, []);
  assert.deepEqual(ui.externalRequests, []);
});
