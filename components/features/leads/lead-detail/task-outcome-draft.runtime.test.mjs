import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, notes, selected, draft, waitSettled } from './task-outcome-runtime-fixture.mjs';

async function controlledFixture(kind) {
  const page = await fixture(kind);
  await page.evaluate(() => { window.h.controlled = true; window.h.render(); });
  return page;
}

for (const kind of ['quick', 'cadence']) {
  test(`${kind}: draft controlado sobrevive ao unmount dos portais durante falha de leitura`, async () => {
    const page = await controlledFixture(kind);
    try {
      await draft(page);
      await page.evaluate(() => { window.h.visible = false; window.h.blocked = 'Não foi possível verificar o acesso.'; window.h.render(); });
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      assert.equal(await page.locator('textarea').count(), 0, 'detalhes ocultos não continuam expostos no DOM');
      await page.evaluate(() => { window.h.visible = true; window.h.render(); });
      await page.getByRole('dialog').waitFor();
      assert.equal(await notes(page).inputValue(), 'Notas sintéticas mantidas');
      assert.equal(await selected(page).count(), 1);
      assert.equal(await page.getByRole('button', { name: 'Registrar', exact: true }).isDisabled(), true);
      assert.equal(await page.evaluate(() => window.h.requests.length), 0);
      await page.evaluate(() => { window.h.blocked = undefined; window.h.render(); });
      await page.getByRole('button', { name: 'Registrar', exact: true }).click();
      await waitSettled(page);
      assert.equal(await notes(page).inputValue(), '');
      assert.equal(await selected(page).count(), 0);
      assert.deepEqual(await page.evaluate(() => window.h.currentDraft), { outcome: '', notes: '' });
    } finally { await page.close(); }
  });

  test(`${kind}: resposta da instância desmontada não apaga draft controlado recuperado na mesma identidade`, async () => {
    const page = await controlledFixture(kind);
    try {
      await draft(page, 'Rascunho antigo');
      await page.evaluate(() => { window.h.mode = 'deferred'; window.h.render(); });
      await page.getByRole('button', { name: 'Registrar', exact: true }).click();
      await page.waitForFunction(() => window.h.deferred.length === 1);
      await page.evaluate(() => { window.h.visible = false; window.h.render(); });
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await page.evaluate(() => { window.h.visible = true; window.h.mode = 'success'; window.h.render(); });
      await page.getByRole('dialog').waitFor();
      assert.equal(await notes(page).inputValue(), 'Rascunho antigo');
      await notes(page).fill('Novo texto recuperado');
      await page.evaluate(() => window.h.deferred[0].resolve(true));
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
      assert.equal(await notes(page).inputValue(), 'Novo texto recuperado');
      assert.equal(await selected(page).count(), 1);
      assert.equal(await page.evaluate(() => window.h.currentDraft.notes), 'Novo texto recuperado');
      assert.equal(await page.getByRole('button', { name: 'Registrar', exact: true }).isEnabled(), true);
    } finally { await page.close(); }
  });

  for (const mode of ['false', 'reject']) {
    test(`${kind}: ${mode} não limpa seleção/notas do hook de draft real`, async () => {
      const page = await controlledFixture(kind);
      try {
        await draft(page);
        await page.evaluate(mode => { window.h.mode = mode; window.h.render(); }, mode);
        await page.getByRole('button', { name: 'Registrar', exact: true }).click();
        await waitSettled(page);
        assert.equal(await notes(page).inputValue(), 'Notas sintéticas mantidas');
        assert.equal(await page.evaluate(() => window.h.currentDraft.notes), 'Notas sintéticas mantidas');
        assert.equal(await selected(page).count(), 1);
        assert.equal(await page.evaluate(() => window.h.requests.length), 1);
      } finally { await page.close(); }
    });
  }

  test(`${kind}: cancelar explicitamente limpa o draft controlado antes de reabrir`, async () => {
    const page = await controlledFixture(kind);
    try {
      await draft(page);
      await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      assert.deepEqual(await page.evaluate(() => window.h.currentDraft), { outcome: '', notes: '' });
      await page.evaluate(() => { window.h.open = true; window.h.render(); });
      await page.getByRole('dialog').waitFor();
      assert.equal(await notes(page).inputValue(), '');
      assert.equal(await selected(page).count(), 0);
    } finally { await page.close(); }
  });

  for (const [field, value] of [['leadId', 'lead-b'], ['org', 'org-b'], ['actor', 'actor-b'], ['session', 'session-b']]) {
    test(`${kind}: trocar ${field} inicia draft vazio e callback retido não escreve na identidade nova`, async () => {
      const page = await controlledFixture(kind);
      try {
        await draft(page, 'Draft anterior');
        await page.evaluate(({ field, value }) => { window.h.retainedUpdate = window.h.currentDraftUpdater; window.h[field] = value; window.h.render(); }, { field, value });
        await page.waitForFunction(() => document.querySelector('textarea')?.value === '');
        assert.equal(await selected(page).count(), 0);
        await draft(page, 'Draft da nova identidade');
        await page.evaluate(() => window.h.retainedUpdate({ outcome: 'busy', notes: 'Callback obsoleto' }));
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
        assert.equal(await notes(page).inputValue(), 'Draft da nova identidade');
        assert.equal(await page.evaluate(() => window.h.requests.length), 0);
      } finally { await page.close(); }
    });
  }

  for (const field of ['org', 'actor']) {
    test(`${kind}: duplo ${field} ABA não revive o draft ou callback da primeira visita`, async () => {
      const page = await controlledFixture(kind);
      try {
        await draft(page, 'Primeiro draft');
        await page.evaluate(() => { window.h.retainedUpdate = window.h.currentDraftUpdater; });
        for (let round = 0; round < 2; round++) {
          await page.evaluate(field => { window.h[field] = field + '-b'; window.h.render(); }, field);
          await page.waitForFunction(() => document.querySelector('textarea')?.value === '');
          await draft(page, 'Visita intermediária');
          await page.evaluate(field => { window.h[field] = field + '-a'; window.h.render(); }, field);
          await page.waitForFunction(() => document.querySelector('textarea')?.value === '');
          assert.equal(await selected(page).count(), 0);
        }
        await draft(page, 'Última visita');
        await page.evaluate(() => window.h.retainedUpdate({ outcome: 'busy', notes: 'Draft da primeira visita' }));
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
        assert.equal(await notes(page).inputValue(), 'Última visita');
        assert.equal(await page.evaluate(() => window.h.requests.length), 0);
      } finally { await page.close(); }
    });
  }
}
