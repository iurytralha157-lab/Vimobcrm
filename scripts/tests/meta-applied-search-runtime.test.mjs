import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expect } from '@playwright/test';
import { errors, externalRequests, inheritedSearch, page, show, sidebar, snapshot, trigger } from './meta-applied-search-runtime/harness.mjs';

if(process.env.VIMOB_META_SCREEN_BASELINE)test('captured baseline reproduces the false applied-search chip and count',async t=>{
  await show('baseline');await inheritedSearch();await expect(trigger()).toHaveAttribute('aria-label',/1 filtros aplicados/);
  await trigger().click();await expect(sidebar().getByText('Busca: Ana sintética',{exact:true})).toBeVisible();
  // Run the same expected post-fix contract against the captured old consumer.
  await assert.rejects(()=>expect(sidebar().getByText('Busca: Ana sintética',{exact:true})).toHaveCount(0,{timeout:100}),/Expected: 0/);
  t.diagnostic('Behavioral RED: captured pre-fix consumer advertises1 unsupported search; the expected count0 assertion fails.');
  await sidebar().getByRole('button',{name:'Buscar',exact:true}).click();
});

for(const width of [390,1024])test(`Meta does not advertise an inherited unsupported search at ${width}px and preserves it for other screens`,async()=>{
  await show('meta',width);await expect(page.locator('[data-report-leads]')).toHaveText('42');
  const before=await page.evaluate(()=>window.searchFixtureRequests.length);
  await inheritedSearch();await trigger().click();await expect(sidebar()).toBeVisible();
  await expect(sidebar().getByText('Busca: Ana sintética',{exact:true})).toHaveCount(0);
  await expect(sidebar().getByRole('textbox',{name:'Buscar nos registros',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:/Fechar filtros avançados/}).first()).not.toHaveAttribute('aria-label',/1 filtros aplicados/);
  await sidebar().getByRole('button',{name:'Buscar',exact:true}).click();await expect(sidebar()).toHaveCount(0);
  await expect(trigger()).not.toHaveAttribute('aria-label',/filtros aplicados/);
  await expect(page.getByRole('button',{name:'Limpar todos os filtros',exact:true})).toHaveCount(0);
  assert.equal((await snapshot()).searchQuery,'Ana sintética');
  assert.equal(await page.evaluate(()=>window.searchFixtureRequests.length),before);
  await page.evaluate(()=>window.searchFixtureSetView('general'));
  await expect(trigger()).toHaveAttribute('aria-label',/1 filtros aplicados/);await trigger().click();
  await expect(sidebar().getByText('Busca: Ana sintética',{exact:true})).toBeVisible();
  await sidebar().getByRole('button',{name:'Buscar',exact:true}).click();
});

test('Meta retains supported filter counts and sends unassigned unchanged through the real query/API/schema',async()=>{
  await show();await inheritedSearch();
  await page.evaluate(()=>window.searchFixtureFilters.setUserId('unassigned'));
  await expect(trigger()).toHaveAttribute('aria-label',/1 filtros aplicados/);await trigger().click();
  await expect(sidebar().getByText('Corretor: Sem responsável',{exact:true})).toBeVisible();
  await expect(sidebar().getByText('Busca: Ana sintética',{exact:true})).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>window.searchFixtureRequests.at(-1)?.query.userId)).toBe('unassigned');
  const request=await page.evaluate(()=>window.searchFixtureRequests.at(-1));
  assert.equal(request.path,'/v1/analytics/campaign-insights');assert.equal(request.organizationId,'10000000-0000-4000-8000-000000000001');
  assert.equal('searchQuery' in request.query,false);assert.equal('search' in request.query,false);
  await sidebar().getByRole('button',{name:'Remover filtro: Corretor: Sem responsável',exact:true}).click();
  assert.equal((await snapshot()).searchQuery,'Ana sintética');assert.equal((await snapshot()).userId,null);
  await sidebar().getByRole('combobox',{name:'Filtrar por corretor: Todos os corretores',exact:true}).click();
  await page.getByRole('option',{name:'Sem responsável',exact:true}).click();
  assert.equal((await snapshot()).userId,'unassigned');assert.equal((await snapshot()).searchQuery,'Ana sintética');
  await sidebar().getByRole('button',{name:'Buscar',exact:true}).click();
});

for(const tab of ['overview','paid','media','acquisition','social'])test(`Marketing ${tab} does not count or display the unsupported shared search`,async()=>{
  await show(tab);await expect(page.locator('[data-marketing-tab]')).toHaveText('42');await inheritedSearch();
  await expect(trigger()).not.toHaveAttribute('aria-label',/filtros aplicados/);await trigger().click();
  await expect(sidebar()).toBeVisible();await expect(sidebar().getByText('Busca: Ana sintética',{exact:true})).toHaveCount(0);
  await expect(sidebar().getByRole('textbox',{name:'Buscar nos registros',exact:true})).toHaveCount(0);
  await sidebar().getByRole('button',{name:'Buscar',exact:true}).click();
  assert.equal((await snapshot()).searchQuery,'Ana sintética');
});

test('Meta/Marketing search regression makes no network calls or browser errors',()=>{
  assert.deepEqual(errors,[]);assert.deepEqual(externalRequests,[]);
});
