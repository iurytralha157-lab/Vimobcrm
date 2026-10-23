import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';
import { QueryClient, QueryObserver } from '@tanstack/query-core';
import ts from 'typescript';
import { createUUID } from '../../lib/client-id.ts';
import { captureQueryClientAccess, activateQueryClientAccess } from '../../lib/access/query-client-access.ts';
import { leadContactOutcomeCommandSchema } from '../../lib/validation/lead-contact-outcomes.ts';

// Execute the production hook with real Query cache and deterministic lifecycle.
// No browser, network, localStorage or CRM writes.
const path = 'hooks/leads/use-lead-card-outcome-draft.ts';
const ast = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
const code = ts.transpileModule(ast.statements.filter(node => !ts.isImportDeclaration(node))
  .map(node => node.getText(ast)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const clients = new Set();
afterEach(() => { for (const client of clients) client.clear(); clients.clear(); });
function runtime(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  clients.add(client);
  const slots = [], observers = [];
  let cursor = 0;
  const changed = (a, b) => !a || b.some((v, i) => !Object.is(v, a[i]));
  const deps = {
    createUUID, captureQueryClientAccess, leadContactOutcomeCommandSchema,
    useQueryClient: () => client,
    useRef: value => slots[cursor++] ??= { current: value },
    useMemo: (build, keys) => { const index = cursor++; if (changed(slots[index]?.keys, keys)) slots[index] = { keys, value: build() }; return slots[index].value; },
    useCallback: callback => callback,
    useLayoutEffect: (setup, keys) => { const index = cursor++; if (changed(slots[index]?.keys, keys)) { slots[index]?.cleanup?.(); slots[index] = { keys, cleanup: setup() }; } },
    useQuery: options => { const observer = new QueryObserver(client, options); observers.push(observer); return observer.getCurrentResult(); },
  };
  const exports = {};
  const hook = Function(...Object.keys(deps), 'exports', code + ';return exports.useLeadCardOutcomeDraft;')(...Object.values(deps), exports);
  return {
    client,
    frame(...scope) { cursor = 0; return hook(...(scope.length ? scope : ['org-a', 'actor-a', 'sid-a', 'lead-a', 'call'])); },
    unmount() { for (const slot of slots) slot?.cleanup?.(); for (const observer of observers) observer.destroy(); },
  };
}
const draft = { outcome: 'answered', notes: 'Resultado sintético que precisa sobreviver ao quadro' };

test('quick-call draft survives a card remount caused by a filter/realtime/move', () => {
  const first = runtime(); first.frame().updateDraft(draft); first.unmount();
  const remounted = runtime(first.client);
  assert.deepEqual(remounted.frame().draft, draft);
  remounted.unmount();
});

for (const [label, scope] of [
  ['organization', ['org-b', 'actor-a', 'sid-a', 'lead-a', 'call']],
  ['actor', ['org-a', 'actor-b', 'sid-a', 'lead-a', 'call']],
  ['session', ['org-a', 'actor-a', 'sid-b', 'lead-a', 'call']],
  ['lead', ['org-a', 'actor-a', 'sid-a', 'lead-b', 'call']],
  ['email result', ['org-a', 'actor-a', 'sid-a', 'lead-a', 'email']],
]) test(`quick result does not cross ${label}`, () => {
  const r = runtime(); r.frame().updateDraft(draft);
  assert.deepEqual(r.frame(...scope).draft, { outcome: '', notes: '' }); r.unmount();
});

test('retired callbacks cannot restore text after scope ABA', () => {
  const r = runtime(), old = r.frame();
  r.frame('org-b', 'actor-a', 'sid-a', 'lead-a', 'call'); r.frame();
  old.updateDraft(draft);
  assert.deepEqual(r.frame().draft, { outcome: '', notes: '' }); r.unmount();
});

test('a confirmed save clears its exact draft even after card unmount', () => {
  const r = runtime(); r.frame().updateDraft(draft);
  const submitted = r.frame(), snapshot = submitted.captureSubmission(); r.unmount();
  submitted.acknowledgeSavedDraft(snapshot);
  const remounted = runtime(r.client);
  assert.deepEqual(remounted.frame().draft, { outcome: '', notes: '' }); remounted.unmount();
});

test('an old acknowledgement preserves edits, including identical text after ABA', () => {
  const r = runtime(); r.frame().updateDraft(draft);
  const submitted = r.frame(), snapshot = submitted.captureSubmission();
  r.frame().updateDraft({ ...draft, notes: 'Outra edição' }); r.frame().updateDraft(draft);
  submitted.acknowledgeSavedDraft(snapshot);
  assert.deepEqual(r.frame().draft, draft); r.unmount();
});

test('acknowledgement after tenant cache clear cannot recreate retired draft data', () => {
  const r = runtime(); r.frame().updateDraft(draft);
  const submitted = r.frame(), snapshot = submitted.captureSubmission(); r.client.clear();
  submitted.acknowledgeSavedDraft(snapshot);
  assert.equal(r.client.getQueryCache().getAll().length, 0); r.unmount();
});

const scope = ['org-a', 'actor-a', 'sid-a', 'lead-a', 'call'];
const cacheKey = kind => [`lead-card-outcome-${kind}`, ...scope];
const submit = store => store.getSubmission(draft.outcome, draft.notes);

test('unknown ACK keeps one frozen command through edited notes, Cancel and remount', () => {
  const r = runtime(), first = r.frame(); first.updateDraft(draft);
  const command = submit(first); assert.equal(first.beginSubmission(command), true); first.endSubmission(command);
  first.updateDraft({ outcome: 'busy', notes: 'New notes after uncertain transport' });
  first.updateDraft({ outcome: '', notes: '' }); r.unmount();
  const next = runtime(r.client), reopened = next.frame();
  assert.deepEqual(reopened.draft, { outcome: 'busy', notes: 'New notes after uncertain transport' });
  const retry = reopened.getSubmission('busy', 'New notes after uncertain transport');
  assert.deepEqual(retry, command); assert.ok(Object.isFrozen(command));
  assert.equal(reopened.beginSubmission(retry), true);
  assert.equal(reopened.acknowledgeSavedCommand(retry), false, 'ACK preserves the newer draft');
  reopened.endSubmission(retry);
  const fresh = reopened.getSubmission('busy', 'New notes after uncertain transport');
  assert.notEqual(fresh.commandId, command.commandId); assert.equal(fresh.outcome, 'busy'); next.unmount();
});

test('unchanged command ACK clears its draft after remount and structural sharing', () => {
  const r = runtime(); r.frame().updateDraft(draft); const command = submit(r.frame()); r.unmount();
  const next = runtime(r.client), reopened = next.frame(), retry = submit(reopened);
  assert.equal(retry.commandId, command.commandId); assert.equal(reopened.beginSubmission(retry), true);
  assert.equal(reopened.acknowledgeSavedCommand(retry), true);
  assert.deepEqual(next.frame().draft, { outcome: '', notes: '' }); reopened.endSubmission(retry); next.unmount();
});

test('same text after draft ABA belongs to a newer revision and is preserved', () => {
  const r = runtime(); r.frame().updateDraft(draft); const store = r.frame(), command = submit(store);
  store.updateDraft({ ...draft, notes: 'Intermediate' }); store.updateDraft(draft);
  assert.equal(store.acknowledgeSavedCommand(command), false); assert.deepEqual(r.frame().draft, draft); r.unmount();
});

test('shared card and popup mutex survives ACK until first-response work ends', () => {
  const card = runtime(); card.frame().updateDraft(draft); const popup = runtime(card.client);
  const a = card.frame(), b = popup.frame(), command = submit(a), duplicate = submit(b);
  assert.equal(a.beginSubmission(command), true); assert.equal(b.beginSubmission(duplicate), false);
  assert.equal(popup.frame().isSubmitting, true); assert.equal(a.acknowledgeSavedCommand(command), true);
  assert.equal(popup.frame().isSubmitting, true, 'ACK does not release the first-response mutex');
  assert.equal(submit(b).commandId, command.commandId, 'duplicate callbacks do not pin a new attempt while busy');
  assert.equal(card.client.getQueryData(cacheKey('command')), undefined);
  assert.equal(b.beginSubmission(command), false); a.endSubmission(command);
  assert.equal(popup.frame().isSubmitting, false);
  assert.equal(card.client.getQueryCache().find({ queryKey: cacheKey('busy'), exact: true }).gcTime, 30 * 60_000);
  card.unmount(); popup.unmount();
});

test('pending command pins both original command and latest draft beyond ordinary draft GC', () => {
  const r = runtime(); r.frame().updateDraft(draft); const store = r.frame(), command = submit(store);
  store.updateDraft({ ...draft, notes: 'Retained latest notes' });
  assert.equal(r.client.getQueryCache().find({ queryKey: cacheKey('command'), exact: true }).gcTime, Infinity);
  r.client.removeQueries({ queryKey: cacheKey('draft'), exact: true }); r.unmount();
  const next = runtime(r.client), reopened = next.frame();
  assert.equal(reopened.draft.notes, 'Retained latest notes'); assert.equal(submit(reopened).commandId, command.commandId);
  assert.equal(reopened.acknowledgeSavedCommand(command), false); assert.equal(next.frame().draft.notes, 'Retained latest notes'); next.unmount();
});

for (const [label, retiredScope] of [
  ['organization', ['org-b', ...scope.slice(1)]], ['actor', [scope[0], 'actor-b', ...scope.slice(2)]],
  ['SID', [scope[0], scope[1], 'sid-b', ...scope.slice(3)]],
  ['lead', [...scope.slice(0, 3), 'lead-b', 'call']], ['channel', [...scope.slice(0, 4), 'email']],
]) test(`pending command identity is isolated by ${label}`, () => {
  const r = runtime(); r.frame().updateDraft(draft); const command = submit(r.frame());
  const next = r.frame(...retiredScope), other = next.getSubmission(retiredScope[4] === 'email' ? 'replied' : 'answered', 'Isolated');
  assert.notEqual(other.commandId, command.commandId); r.unmount();
});

test('lease retired and reactivated with identical identity never revives old callbacks', () => {
  const r = runtime(), retire = activateQueryClientAccess(r.client), old = r.frame(); old.updateDraft(draft);
  const command = submit(old); assert.equal(old.beginSubmission(command), true);
  retire(); const retireNext = activateQueryClientAccess(r.client); r.client.clear();
  old.updateDraft({ ...draft, notes: 'Forbidden revival' });
  assert.throws(() => submit(old), /acesso/); assert.equal(old.beginSubmission(command), false);
  assert.equal(old.acknowledgeSavedCommand(command), false); old.endSubmission(command);
  assert.equal(r.client.getQueryCache().getAll().length, 0); retireNext(); r.unmount();
});

test('normal unmount retains captured access for confirmed ACK but retirement does not', () => {
  for (const retireBeforeAck of [false, true]) {
    const r = runtime(), retire = activateQueryClientAccess(r.client); r.frame().updateDraft(draft);
    const store = r.frame(), command = submit(store); store.beginSubmission(command); r.unmount();
    if (retireBeforeAck) { retire(); r.client.clear(); }
    assert.equal(store.acknowledgeSavedCommand(command), !retireBeforeAck); store.endSubmission(command);
    if (retireBeforeAck) assert.equal(r.client.getQueryCache().getAll().length, 0);
    else assert.deepEqual(r.client.getQueryData(cacheKey('draft')).draft, { outcome: '', notes: '' });
    retire();
  }
});

test('NUL and oversized notes fail before pinning an unrecoverable command', () => {
  const r = runtime(), store = r.frame();
  for (const notes of ['invalid\u0000notes', '🧡'.repeat(2001)]) assert.throws(() => store.getSubmission('answered', notes));
  assert.equal(r.client.getQueryData(cacheKey('command')), undefined);
  assert.equal(store.getSubmission('answered', '🧡'.repeat(2000)).notes.length, 4000); r.unmount();
});
