import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createDistributionEditorHarness } from '../../../../scripts/tests/distribution-editor-runtime-harness.mjs';

let harness;
before(async () => { harness = await createDistributionEditorHarness(); });
after(async () => { await harness?.close(); });
const draftKey = 'vimob:distribution-draft:org-a:viewer:00000000-0000-4000-8000-000000007000';
const input = page => page.getByPlaceholder('Ex: Sao Paulo, Campinas');
const rules = page => page.getByRole('tab', { name: 'Critérios de entrada', exact: true });
const review = page => page.getByRole('tab', { name: 'Revisão', exact: true });
const values = page => page.evaluate(key => JSON.parse(sessionStorage.getItem(key)).form.conditions.find(item => item.type === 'city').values, draftKey);

async function city(page) {
  await rules(page).click();
  await page.getByRole('combobox', { name: 'Tipo de critério de entrada', exact: true }).click();
  await page.getByRole('option', { name: 'Cidade', exact: true }).click();
  // Radix restores the select trigger's focus asynchronously when the menu closes.
  await page.waitForTimeout(200);
  await input(page).click();
}

async function submit(page) {
  await review(page).click();
  await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  await page.waitForFunction(() => window.fixture.state.saves.length === 1);
  return page.evaluate(() => window.fixture.state.saves[0].conditions.find(item => item.type === 'city').values);
}

for (const scenario of [
  { title: 'typing a multiword city preserves its internal space', text: 'Sao Paulo', expected: ['Sao Paulo'], type: true },
  { title: 'typing multiple cities preserves separators until submit', text: 'Campinas, Santos', expected: ['Campinas', 'Santos'], type: true },
  { title: 'pasting a complete list retains the same city semantics', text: 'Sao Paulo, Campinas', expected: ['Sao Paulo', 'Campinas'], type: false },
]) {
  test(scenario.title, async () => {
    const { page, errors, network } = await harness.open({ kind: 'edit' });
    try {
      await city(page);
      if (scenario.type) await input(page).pressSequentially(scenario.text, { delay: 25 });
      else await input(page).fill(scenario.text);
      assert.equal(await input(page).inputValue(), scenario.text);
      assert.deepEqual(await submit(page), scenario.expected);
      assert.deepEqual(errors, []);
      assert.ok(network.every(url => url === 'http://distribution-fixture.local/'));
    } finally { await page.close(); }
  });
}

test('a trailing comma and space survive step changes and explicit draft recovery', async () => {
  const { page, errors } = await harness.open({ kind: 'edit' });
  try {
    await city(page);
    await input(page).pressSequentially('Campinas, ', { delay: 25 });
    assert.equal(await input(page).inputValue(), 'Campinas, ');
    assert.deepEqual(await values(page), ['Campinas', ' ']);
    await review(page).click(); await rules(page).click();
    assert.equal(await input(page).inputValue(), 'Campinas, ');
    await page.evaluate(() => window.fixture.setState({ kind: 'create' }));
    await page.getByRole('dialog', { name: 'Nova fila de distribuição' }).waitFor();
    await page.evaluate(() => window.fixture.setState({ kind: 'edit' }));
    await page.getByRole('button', { name: 'Restaurar rascunho', exact: true }).click();
    await rules(page).click();
    assert.equal(await input(page).inputValue(), 'Campinas, ');
    await input(page).click(); await input(page).press('End');
    await input(page).pressSequentially('Santos', { delay: 25 });
    assert.deepEqual(await submit(page), ['Campinas', 'Santos']);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('editing and deleting in the middle preserves the cursor and city boundaries', async () => {
  const { page, errors } = await harness.open({ kind: 'edit' });
  try {
    await city(page); await input(page).fill('SaoPaulo, Santos');
    await input(page).press('Home');
    for (let index = 0; index < 3; index++) await input(page).press('ArrowRight');
    await input(page).press('Space');
    assert.equal(await input(page).inputValue(), 'Sao Paulo, Santos');
    assert.equal(await input(page).evaluate(element => element.selectionStart), 4);
    await input(page).press('Backspace');
    assert.equal(await input(page).inputValue(), 'SaoPaulo, Santos');
    await input(page).press('Space');
    assert.deepEqual(await submit(page), ['Sao Paulo', 'Santos']);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('deleting a transient list does not leave a stale valid city criterion', async () => {
  const { page, errors } = await harness.open({ kind: 'edit' });
  try {
    await city(page); await input(page).pressSequentially('Sao Paulo, ', { delay: 25 });
    await input(page).press('ControlOrMeta+A'); await input(page).press('Backspace');
    assert.equal(await input(page).inputValue(), '');
    assert.ok((await values(page)).every(value => value.trim() === ''));
    await review(page).click();
    assert.equal(await page.getByRole('button', { name: 'Salvar alterações', exact: true }).isDisabled(), true);
    assert.equal(await page.evaluate(() => window.fixture.state.saves.length), 0);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('renaming without touching a legacy city list preserves its exact rule snapshot', async () => {
  const rule = { id: '00000000-0000-4000-8000-000000007100', match_type: 'city', match_value: 'Sao Paulo,Campinas', is_active: true };
  const { page, errors } = await harness.open({ kind: 'edit', queuePatch: { rules: [rule] } });
  try {
    await page.getByPlaceholder('Ex: Leads Facebook').fill('Novo nome, mesmas cidades');
    await review(page).click(); await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
    await page.waitForFunction(() => window.fixture.state.saves.length === 1);
    assert.equal(await page.evaluate(() => window.fixture.state.saves[0].preserveRuleSnapshot), true);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
