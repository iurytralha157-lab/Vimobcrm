import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createDistributionEditorHarness } from '../../../scripts/tests/distribution-editor-runtime-harness.mjs';

let harness;
before(async () => { harness = await createDistributionEditorHarness(); });
after(async () => { await harness?.close(); });
const draftKey = 'vimob:distribution-draft:org-a:viewer:00000000-0000-4000-8000-000000007000';
const field = page => page.getByPlaceholder('Ex: Leads Facebook');
const review = page => page.getByRole('tab', { name: 'Revisão', exact: true });
const save = page => page.locator('[data-tour="distribution-queue-save"]');
const readDraft = page => page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), draftKey);
const settle = page => page.waitForFunction(() => {
  const fields = document.querySelector('fieldset[aria-label="Configuração da distribuição"]');
  return fields && !fields.disabled;
});

for (const failReload of [false, true]) {
  test(`slow reload blocks later edits and releases controls on ${failReload ? 'failure' : 'success'}`, async () => {
    const { page, errors } = await harness.open({ kind: 'edit', saveStatus: 'error', reloadStatus: 'defer' });
    try {
      await field(page).fill('Rascunho antes da recarga');
      await review(page).click(); await save(page).click();
      const reload = page.getByRole('button', { name: 'Descartar rascunho e carregar versão atual', exact: true });
      await reload.waitFor();
      await page.getByRole('tab', { name: 'Nome e destino', exact: true }).click(); await reload.click();
      await page.waitForFunction(() => typeof window.fixture.state.resolveReload === 'function');
      assert.equal(await field(page).isEditable(), false);
      assert.equal(await reload.isDisabled(), true);
      assert.equal((await readDraft(page)).form.name, 'Rascunho antes da recarga');
      await page.evaluate(failed => {
        if (failed) window.fixture.setState({ reloadStatus: 'error-with-cache' });
        window.fixture.state.resolveReload();
      }, failReload);
      await settle(page);
      assert.equal(await field(page).isEditable(), true);
      assert.equal(await field(page).inputValue(), failReload ? 'Rascunho antes da recarga' : 'Fila Sintética de Teste');
      assert.equal((await readDraft(page))?.form.name ?? null, failReload ? 'Rascunho antes da recarga' : null);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
}

test('a save in progress blocks recovery actions and duplicate gestures', async () => {
  const { page, errors } = await harness.open({ kind: 'edit', saveStatus: 'defer' });
  try {
    await field(page).fill('Rascunho B recuperável');
    await page.waitForFunction(key => JSON.parse(sessionStorage.getItem(key))?.form.name === 'Rascunho B recuperável', draftKey);
    await page.evaluate(() => window.fixture.setState({ kind: 'create' }));
    await page.getByRole('dialog', { name: 'Nova fila de distribuição' }).waitFor();
    await page.evaluate(() => window.fixture.setState({ kind: 'edit' }));
    const restore = page.getByRole('button', { name: 'Restaurar rascunho', exact: true });
    await restore.waitFor();
    await field(page).fill('Pedido A enviado'); await review(page).click();
    await save(page).evaluate(button => { button.click(); button.click(); button.click(); });
    await page.waitForFunction(() => typeof window.fixture.state.resolveSave === 'function');
    assert.equal(await restore.isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Descartar', exact: true }).isDisabled(), true);
    assert.equal(await page.evaluate(() => window.fixture.state.saves.length), 1);
    assert.equal((await readDraft(page)).form.name, 'Pedido A enviado');
    await page.evaluate(() => window.fixture.state.resolveSave()); await settle(page);
    await page.getByRole('tab', { name: 'Nome e destino', exact: true }).click();
    assert.equal(await field(page).inputValue(), 'Pedido A enviado');
    assert.equal(await readDraft(page), null);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

for (const [width, height] of [[375, 320], [320, 640], [1440, 900]]) {
  test(`save failure preserves usable scroll space and editable fields at ${width}×${height}`, async () => {
    const { page, errors } = await harness.open({ kind: 'edit', width, height, saveStatus: 'error' });
    try {
      await field(page).fill('Rascunho com falha'); await review(page).click(); await save(page).click();
      await page.getByRole('alert').waitFor();
      const geometry = await page.evaluate(() => {
        const body = document.querySelector('[data-form-wizard] > div');
        const alert = document.querySelector('[role=alert]');
        const clip = body.contains(alert) ? body : document.querySelector('[role=dialog]');
        const area = clip.getBoundingClientRect(), error = alert.getBoundingClientRect();
        return { height: body.clientHeight, visibleError: error.top >= area.top - 1 && error.bottom <= area.bottom + 1 };
      });
      assert.ok(geometry.height >= 40, `usable form area is ${geometry.height}px`);
      assert.equal(geometry.visibleError, true, 'the failed operation must reveal its message inside the usable scroll area');
      await page.getByRole('tab', { name: 'Nome e destino', exact: true }).click();
      await field(page).fill('Correção após erro');
      assert.equal((await readDraft(page)).form.name, 'Correção após erro');
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
}

test('invalid automatic replies block advance and readiness, while a corrected 4000-code-point reply can save', async () => {
  const { page, errors } = await harness.open({ kind: 'edit', width: 375, height: 667 });
  try {
    await page.getByRole('tab', { name: 'Critérios de entrada', exact: true }).click();
    await page.getByRole('combobox', { name: 'Tipo de critério de entrada', exact: true }).click();
    await page.getByRole('option', { name: 'Campanha de WhatsApp', exact: true }).click();
    await page.getByRole('combobox', { name: 'Conexão WhatsApp *', exact: true }).click();
    await page.getByRole('option', { name: 'Conexão de teste', exact: true }).click();
    await page.getByLabel('Mensagem contém', { exact: true }).fill('campanha sintética');
    const replyTab = page.getByRole('tab', { name: 'Resposta no WhatsApp', exact: true });
    await replyTab.click();
    await page.getByRole('switch', { name: 'Enviar resposta automática após distribuir', exact: true }).click();
    const message = page.getByLabel('Mensagem', { exact: true });
    await message.fill('😀'.repeat(4001));
    await page.getByRole('button', { name: 'Avançar', exact: true }).click();
    assert.equal(await replyTab.getAttribute('aria-selected'), 'true');
    await review(page).click();
    assert.equal(await page.getByText('Tudo pronto para salvar.', { exact: true }).count(), 0);
    assert.equal(await save(page).isDisabled(), true);
    assert.equal(await page.evaluate(() => window.fixture.state.saves.length), 0);
    await replyTab.click(); await message.fill('😀'.repeat(4000));
    await page.getByRole('button', { name: 'Avançar', exact: true }).click();
    assert.equal(await review(page).getAttribute('aria-selected'), 'true');
    assert.equal(await save(page).isEnabled(), true);
    await save(page).click(); await settle(page);
    assert.equal(await page.evaluate(() => window.fixture.state.saves.length), 1);
    assert.equal(await page.evaluate(() => Array.from(window.fixture.state.saves[0].settings.whatsapp_distribution_auto_reply_message).length), 4000);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('a persisted name of 64 supplementary code points permits another edit and local recovery', async () => {
  const name = '🚀'.repeat(64);
  const { page, errors } = await harness.open({ kind: 'edit', queuePatch: { name } });
  try {
    assert.equal(await field(page).inputValue(), name);
    await page.getByLabel('Estrategia', { exact: true }).click();
    await page.getByRole('option', { name: 'Sequencial', exact: true }).click();
    assert.equal((await readDraft(page)).form.name, name);
    await review(page).click(); assert.equal(await save(page).isEnabled(), true);
    await save(page).click(); await settle(page);
    assert.equal(await page.evaluate(() => window.fixture.state.saves[0].name), name);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
