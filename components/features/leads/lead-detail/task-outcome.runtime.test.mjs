import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, notes, selected, draft, waitSettled } from './task-outcome-runtime-fixture.mjs';

for (const kind of ['quick', 'cadence']) {
  for (const [readState, reason] of [
    ['pending', 'Aguarde a confirmação do acesso ao lead.'],
    ['error', 'Não foi possível verificar o acesso ao lead.'],
    ['denied', 'Você não tem permissão para registrar este resultado.'],
  ]) {
    test(`${kind}: leitura ${readState} bloqueia gravação e permite cancelar sem perder o draft na recuperação`, async () => {
      const page = await fixture(kind);
      try {
        await draft(page);
        await page.evaluate(reason => { window.h.blocked = reason; window.h.render(); }, reason);
        assert.equal(await page.getByRole('button', { name: 'Registrar', exact: true }).isDisabled(), true);
        assert.equal(await page.getByRole('status').innerText(), reason);
        assert.equal(await page.getByRole('button', { name: 'Cancelar', exact: true }).isEnabled(), true);
        assert.equal(await page.evaluate(() => window.h.requests.length), 0);
        await page.evaluate(() => { window.h.blocked = undefined; window.h.render(); });
        assert.equal(await notes(page).inputValue(), 'Notas sintéticas mantidas');
        assert.equal(await selected(page).count(), 1);
        await page.getByRole('button', { name: 'Registrar', exact: true }).click();
        await waitSettled(page);
        assert.equal(await page.evaluate(() => window.h.requests.length), 1);
        assert.equal(await notes(page).inputValue(), '');
        assert.equal(await selected(page).count(), 0);
      } finally { await page.close(); }
    });
  }

  for (const mode of ['false', 'undefined', 'reject']) {
    test(`${kind}: confirmação ${mode} preserva seleção e notas para nova tentativa`, async () => {
      const page = await fixture(kind);
      try {
        await draft(page);
        await page.evaluate(mode => { window.h.mode = mode; window.h.render(); }, mode);
        await page.getByRole('button', { name: 'Registrar', exact: true }).click();
        await waitSettled(page);
        assert.equal(await notes(page).inputValue(), 'Notas sintéticas mantidas');
        assert.equal(await selected(page).count(), 1);
        assert.equal(await page.evaluate(() => window.h.requests.length), 1);
        assert.equal(await page.evaluate(() => window.h.closed), 0);
        await page.evaluate(() => { window.h.mode = 'success'; window.h.render(); });
        await page.getByRole('button', { name: 'Registrar', exact: true }).click();
        await waitSettled(page);
        assert.equal(await page.evaluate(() => window.h.requests.length), 2);
        assert.equal(await notes(page).inputValue(), '');
      } finally { await page.close(); }
    });
  }

  test(`${kind}: retry de leitura não salva nem apaga o draft e não se confunde com salvamento`, async () => {
    const page = await fixture(kind);
    try {
      await draft(page);
      await page.evaluate(() => { window.h.blocked = 'Não foi possível verificar o acesso ao lead.'; window.h.render(); });
      await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
      assert.equal(await page.getByRole('button', { name: 'Verificando...', exact: true }).isDisabled(), true);
      assert.equal(await page.getByRole('button', { name: 'Registrar', exact: true }).isDisabled(), true);
      assert.equal(await page.getByRole('button', { name: 'Cancelar', exact: true }).isEnabled(), true);
      assert.equal(await page.evaluate(() => window.h.retries), 1);
      assert.equal(await page.evaluate(() => window.h.requests.length), 0);
      await page.evaluate(() => { window.h.retrying = false; window.h.blocked = undefined; window.h.render(); });
      assert.equal(await notes(page).inputValue(), 'Notas sintéticas mantidas');
      assert.equal(await selected(page).count(), 1);
      assert.equal(await page.getByRole('button', { name: 'Registrar', exact: true }).isEnabled(), true);
    } finally { await page.close(); }
  });

  test(`${kind}: callback pendente é único e impede escape/cancelamento até resolver false`, async () => {
    const page = await fixture(kind);
    try {
      await draft(page);
      await page.evaluate(() => { window.h.mode = 'deferred'; window.h.render(); });
      await page.getByRole('button', { name: 'Registrar', exact: true }).dblclick();
      await page.waitForFunction(() => window.h.deferred.length === 1);
      assert.equal(await page.getByRole('button', { name: 'Salvando...', exact: true }).isDisabled(), true);
      assert.equal(await page.getByRole('button', { name: 'Cancelar', exact: true }).isDisabled(), true);
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => window.h.closed), 0);
      await page.evaluate(() => window.h.deferred[0].resolve(false));
      await waitSettled(page);
      assert.equal(await notes(page).inputValue(), 'Notas sintéticas mantidas');
      assert.equal(await selected(page).count(), 1);
      assert.equal(await page.evaluate(() => window.h.requests.length), 1);
    } finally { await page.close(); }
  });

  test(`${kind}: loading do dono bloqueia controles e não chama confirmação`, async () => {
    const page = await fixture(kind);
    try {
      await draft(page);
      await page.evaluate(() => { window.h.pending = true; window.h.render(); });
      assert.equal(await page.getByRole('button', { name: 'Salvando...', exact: true }).isDisabled(), true);
      assert.equal(await page.getByRole('button', { name: 'Cancelar', exact: true }).isDisabled(), true);
      assert.equal(await notes(page).isDisabled(), true);
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => window.h.closed), 0);
      assert.equal(await page.evaluate(() => window.h.requests.length), 0);
      await page.evaluate(() => { window.h.pending = false; window.h.render(); });
      await waitSettled(page);
      assert.equal(await notes(page).inputValue(), 'Notas sintéticas mantidas');
      assert.equal(await selected(page).count(), 1);
    } finally { await page.close(); }
  });

  test(`${kind}: cancelamento bloqueado apenas por leitura fecha e reabertura inicia draft novo`, async () => {
    const page = await fixture(kind);
    try {
      await draft(page);
      await page.evaluate(() => { window.h.blocked = 'Não foi possível verificar o acesso ao lead.'; window.h.render(); });
      await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => window.h.closed), 1);
      assert.equal(await page.evaluate(() => window.h.requests.length), 0);
      await page.evaluate(() => { window.h.open = true; window.h.blocked = undefined; window.h.render(); });
      await page.getByRole('dialog').waitFor();
      assert.equal(await notes(page).inputValue(), '');
      assert.equal(await selected(page).count(), 0);
    } finally { await page.close(); }
  });

  for (const change of ['reopen', 'lead', 'organization', 'session', 'task-or-type']) {
    test(`${kind}: resposta antiga não limpa o novo draft após ${change}`, async () => {
      const page = await fixture(kind);
      try {
        await draft(page, 'Rascunho antigo');
        await page.evaluate(() => { window.h.mode = 'deferred'; window.h.render(); });
        await page.getByRole('button', { name: 'Registrar', exact: true }).click();
        await page.waitForFunction(() => window.h.deferred.length === 1);
        if (change === 'reopen') {
          await page.evaluate(() => { window.h.open = false; window.h.render(); });
          await page.getByRole('dialog').waitFor({ state: 'hidden' });
          await page.evaluate(() => { window.h.open = true; window.h.mode = 'success'; window.h.render(); });
        } else {
          await page.evaluate(change => {
            if (change === 'lead') window.h.leadId = 'lead-b';
            if (change === 'organization') window.h.org = 'org-b';
            if (change === 'session') window.h.session = 'session-b';
            if (change === 'task-or-type') {
              if (window.h.kind === 'cadence') window.h.taskId = 'task-b';
              else window.h.type = 'email';
            }
            window.h.mode = 'success'; window.h.render();
          }, change);
        }
        await page.waitForFunction(() => !document.querySelector('textarea')?.disabled);
        assert.equal(await notes(page).inputValue(), '');
        await draft(page, 'Novo rascunho preservado');
        await page.evaluate(() => window.h.deferred[0].resolve(true));
        // A browser task after promise settlement ensures old continuations ran.
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
        assert.equal(await notes(page).inputValue(), 'Novo rascunho preservado');
        assert.equal(await selected(page).count(), 1);
        assert.equal(await page.getByRole('button', { name: 'Registrar', exact: true }).isEnabled(), true);
        assert.equal(await page.evaluate(() => window.h.requests.length), 1);
      } finally { await page.close(); }
    });
  }
}

test('email usa o mesmo contrato estrito, sem aceitar conclusão undefined', async () => {
  const page = await fixture('quick', 'email');
  try {
    await draft(page);
    await page.evaluate(() => { window.h.mode = 'undefined'; window.h.render(); });
    await page.getByRole('button', { name: 'Registrar', exact: true }).click();
    await waitSettled(page);
    assert.equal(await selected(page).count(), 1);
    assert.equal(await notes(page).inputValue(), 'Notas sintéticas mantidas');
  } finally { await page.close(); }
});

test('cadence: anotações acima de 1000 caracteres ficam intactas e exigem correção antes de salvar', async () => {
  const page = await fixture('cadence');
  try {
    const pasted = 'a'.repeat(1001);
    await draft(page, pasted);
    assert.equal(await notes(page).inputValue(), pasted, 'a colagem nunca deve ser cortada silenciosamente');
    assert.equal(await notes(page).getAttribute('aria-invalid'), 'true');
    assert.match(await page.getByRole('alert').innerText(), /1000/);
    assert.equal(await page.getByRole('button', { name: 'Registrar', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Cancelar', exact: true }).isEnabled(), true);
    assert.equal(await page.evaluate(() => window.h.requests.length), 0);
    const corrected = 'a'.repeat(1000);
    await notes(page).fill(corrected);
    await page.getByRole('button', { name: 'Registrar', exact: true }).click();
    await waitSettled(page);
    assert.equal(await page.evaluate(() => window.h.requests.length), 1);
    assert.equal(await page.evaluate(() => window.h.requests[0].notes), corrected);
  } finally { await page.close(); }
});

test('cadence: limite usa pontos de código e texto trimado, preservando emojis e espaços enviados', async () => {
  const page = await fixture('cadence');
  try {
    const exact = '  ' + '😀'.repeat(1000) + '\n ';
    await draft(page, exact);
    assert.equal(await page.getByRole('alert').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Registrar', exact: true }).isEnabled(), true);
    await page.getByRole('button', { name: 'Registrar', exact: true }).click();
    await waitSettled(page);
    assert.equal(await page.evaluate(() => window.h.requests[0].notes), exact);
    await draft(page, '😀'.repeat(1001));
    assert.equal(await page.getByRole('button', { name: 'Registrar', exact: true }).isDisabled(), true);
    assert.equal(await notes(page).inputValue(), '😀'.repeat(1001));
  } finally { await page.close(); }
});

test('quick: notas de atividade não herdam o limite específico da conclusão de cadência', async () => {
  const page = await fixture('quick');
  try {
    const text = 'a'.repeat(1001);
    await draft(page, text);
    assert.equal(await page.getByRole('alert').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Registrar', exact: true }).isEnabled(), true);
    await page.getByRole('button', { name: 'Registrar', exact: true }).click();
    await waitSettled(page);
    assert.equal(await page.evaluate(() => window.h.requests[0].notes), text);
  } finally { await page.close(); }
});
