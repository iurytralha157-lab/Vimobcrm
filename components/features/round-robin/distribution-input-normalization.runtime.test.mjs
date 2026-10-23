import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createDistributionEditorHarness } from '../../../scripts/tests/distribution-editor-runtime-harness.mjs';

let harness;
before(async () => { harness = await createDistributionEditorHarness(); });
after(async () => { await harness?.close(); });
const NEL = '\u0085';
const draftKey = 'vimob:distribution-draft:org-a:viewer:00000000-0000-4000-8000-000000007000';
const save = page => page.getByRole('button', { name: 'Salvar alterações', exact: true });
const name = page => page.getByPlaceholder('Ex: Leads Facebook');
const replyRule = {
  id: '00000000-0000-4000-8000-000000007100', match_type: 'whatsapp_message_contains',
  match_value: 'campanha sintética', match: { whatsapp_session_id: '00000000-0000-4000-8000-000000008100' }, is_active: true,
};
const settings = message => ({
  enable_redistribution: false, reentry_behavior: 'redistribute',
  whatsapp_distribution_auto_reply_enabled: true,
  whatsapp_distribution_auto_reply_message: message,
  whatsapp_distribution_auto_reply_delay_seconds: 30,
});

test('a name shortened below the server minimum stays editable and recoverable but cannot advance or save', async () => {
  const raw = `A${NEL}`;
  const { page, errors } = await harness.open({ kind: 'edit' });
  try {
    await name(page).fill(raw);
    assert.equal(await name(page).inputValue(), raw);
    assert.equal(await name(page).getAttribute('aria-invalid'), 'true');
    await page.getByRole('button', { name: 'Avançar', exact: true }).click();
    assert.equal(await page.getByRole('tab', { name: 'Nome e destino', exact: true }).getAttribute('aria-selected'), 'true');
    await page.getByRole('tab', { name: 'Revisão', exact: true }).click();
    assert.equal(await save(page).isDisabled(), true);
    assert.equal(await page.getByText('Tudo pronto para salvar.', { exact: true }).count(), 0);
    assert.equal(await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)).form.name, draftKey), raw);
    assert.equal(await page.evaluate(() => window.fixture.state.saves.length), 0);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('a reply made only of Go whitespace is announced invalid while preserving the raw draft', async () => {
  const { page, errors } = await harness.open({ kind: 'edit', queuePatch: { rules: [replyRule], settings: settings('Mensagem válida') } });
  try {
    await page.getByRole('tab', { name: 'Resposta no WhatsApp', exact: true }).click();
    const message = page.getByLabel('Mensagem', { exact: true });
    await message.fill(NEL);
    assert.equal(await message.inputValue(), NEL);
    assert.equal(await message.getAttribute('aria-invalid'), 'true');
    await page.getByRole('button', { name: 'Avançar', exact: true }).click();
    assert.equal(await page.getByRole('tab', { name: 'Resposta no WhatsApp', exact: true }).getAttribute('aria-selected'), 'true');
    await page.getByRole('tab', { name: 'Revisão', exact: true }).click();
    assert.equal(await save(page).isDisabled(), true);
    assert.equal(await page.getByText('Tudo pronto para salvar.', { exact: true }).count(), 0);
    assert.equal(await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)).form.settings.whatsapp_distribution_auto_reply_message, draftKey), NEL);
    assert.equal(await page.evaluate(() => window.fixture.state.saves.length), 0);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('a maximum-length reply with NEL edges saves the original message instead of falling back to a default', async () => {
  const raw = `${NEL}${'😀'.repeat(4000)}${NEL}`;
  const { page, errors, network } = await harness.open({ kind: 'edit', queuePatch: { rules: [replyRule], settings: settings(raw) } });
  try {
    await name(page).fill('Alteração com mensagem inteira');
    await page.getByRole('tab', { name: 'Resposta no WhatsApp', exact: true }).click();
    const message = page.getByLabel('Mensagem', { exact: true });
    assert.equal(await message.inputValue(), raw);
    assert.notEqual(await message.getAttribute('aria-invalid'), 'true');
    assert.equal(await page.getByText(/4000\s*\/\s*4000/).count(), 1);
    await page.getByRole('button', { name: 'Avançar', exact: true }).click();
    assert.equal(await save(page).isEnabled(), true);
    await save(page).click(); await page.waitForFunction(() => window.fixture.state.saves.length === 1);
    assert.equal(await page.evaluate(() => window.fixture.state.saves[0].settings.whatsapp_distribution_auto_reply_message), raw);
    assert.deepEqual(errors, []);
    assert.ok(network.every(url => url === 'http://distribution-fixture.local/'));
  } finally { await page.close(); }
});
