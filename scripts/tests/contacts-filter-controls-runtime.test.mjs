import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expect } from '@playwright/test';
import { errors, externalRequests, open, page, search, show, sidebar, state, trigger } from './contacts-sidebar-runtime/harness.mjs';

for (const presentation of ['sidebar', 'default']) test(`removed saved filters never appear in ${presentation} at mobile or desktop`, async () => {
  for (const width of [320, 390, 768, 1440]) {
    await show({ width, presentation });
    await trigger().click();
    await expect(search()).toBeVisible();
    await expect(page.getByText('Filtros salvos neste navegador', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Nome do filtro para salvar', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Salvar filtro atual|Excluir filtro salvo|Copiar link dos filtros/ })).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: /Aplicar filtro salvo/ })).toHaveCount(0);
    if (presentation === 'sidebar') {
      await expect(sidebar().locator('[data-filter-sidebar-count]')).toHaveCount(0);
      await sidebar().getByRole('button', { name: 'Buscar', exact: true }).click();
    } else await page.keyboard.press('Escape');
  }
});

test('old saved data cannot restore criteria or trigger writes from the current filter controls', async () => {
  await show({ width: 390 });
  const original = await state();
  const oldData = JSON.stringify([{ id: '30000000-0000-4000-8000-000000000099', name: 'Obsoleto', snapshot: { ...original, source: 'site' } }]);
  await page.evaluate(value => localStorage.setItem('vimob_saved_filters_v1_10000000-0000-4000-8000-000000000001_20000000-0000-4000-8000-000000000001', value), oldData);
  await open();
  assert.equal((await state()).source, null);
  await search().fill('Busca atual');
  await sidebar().getByRole('button', { name: 'Buscar', exact: true }).click();
  assert.equal((await state()).searchQuery, 'Busca atual');
  const stored = await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith('vimob_saved_filters_v1_')));
  assert.equal(stored.length, 1);
  assert.equal(stored[0][1], oldData, 'normal filtering never reads or rewrites the retired feature storage');
});

test('filter controls runtime stays offline without uncaught browser errors', () => {
  assert.deepEqual(errors, []);
  assert.deepEqual(externalRequests, []);
});
