import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import {
  monotonicWhatsAppMessageStatus as monotonicMessageStatus,
  monotonicWhatsAppOutboxStatus as monotonicOutboxStatus,
} from '../_shared/whatsapp-message-status.ts';
import { reconcileUnmatchedNotificationReceipts } from './notification-receipt.ts';

// Run the actual Edge handler against an in-memory REST/RPC adapter. No Deno
// server, credentials, HTTP, database writes or external provider are loaded.
const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true);
const names = new Set(['normalizeText', 'unique', 'toArray', 'isRecord', 'firstPresent', 'statusFromProvider', 'handleMessageStatus']);
const functions = parsed.statements.filter(node => ts.isFunctionDeclaration(node) && node.name && names.has(node.name.text));
assert.equal(functions.length, names.size);
const compiled = ts.transpileModule(functions.map(node => node.getText(parsed)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const scope = { organization_id: 'org-a', id: 'session-a' };

function fixture(notificationOutcome = id => id === 'REMINDER' ? 'applied' : 'not_found') {
  const message = { id: 'canonical-row', organization_id: scope.organization_id, session_id: scope.id, message_id: 'KNOWN', status: 'sent' };
  const foreign = { ...message, id: 'foreign-row', organization_id: 'org-b', message_id: 'FOREIGN' };
  const calls = [];
  const supabase = {
    rpc: async (name, args) => {
      assert.equal(name, 'evolution_go_reconcile_notification_receipt');
      assert.equal(args.p_organization_id, scope.organization_id);
      assert.equal(args.p_session_id, scope.id);
      calls.push(args.p_provider_message_id);
      return { data: { outcome: notificationOutcome(args.p_provider_message_id) }, error: null };
    },
    from(table) {
      let patch;
      const filters = new Map();
      const query = {
        select() { return query; },
        eq(key, value) { filters.set(key, value); return query; },
        update(value) { patch = value; return query; },
        async in(key, values) {
          const rows = table === 'whatsapp_messages' ? [message, foreign].filter(row =>
            values.includes(row[key]) && [...filters].every(([field, value]) => row[field] === value)) : [];
          if (patch) rows.forEach(row => Object.assign(row, patch));
          return { data: rows.map(row => ({ ...row })), error: null };
        },
      };
      return query;
    },
  };
  const context = vm.createContext({ supabase, Date, monotonicMessageStatus, monotonicOutboxStatus, reconcileUnmatchedNotificationReceipts });
  vm.runInContext(compiled, context);
  return {
    message, foreign, calls,
    run: entries => context.handleMessageStatus(scope, { data: { receipts: entries } }),
    runPayload: payload => context.handleMessageStatus(scope, payload),
  };
}

for (const ids of [['EXTERNAL', 'KNOWN'], ['KNOWN', 'EXTERNAL'], ['EXTERNAL', 'KNOWN', 'EXTERNAL']]) {
  test(`known receipts advance despite unresolved identities: ${ids.join(' -> ')}`, async () => {
    const f = fixture();
    const entries = ids.map(messageId => ({ messageId, status: 'read' }));
    await assert.rejects(f.run(entries), /MESSAGE_STATUS_TARGET_NOT_FOUND/);
    assert.equal(f.message.status, 'read');
    await assert.rejects(f.run(entries), /MESSAGE_STATUS_TARGET_NOT_FOUND/);
    assert.equal(f.message.status, 'read', 'retry must preserve committed monotonic progress');
    assert.equal(f.foreign.status, 'sent');
  });
}

test('unknown sibling inside one entry remains retryable without undoing the known target', async () => {
  const f = fixture();
  await assert.rejects(f.run([{ messageIds: ['EXTERNAL', 'KNOWN'], status: 'delivered' }]), /TARGET_NOT_FOUND/);
  assert.equal(f.message.status, 'delivered');
});

test('agenda notification reconciliation and late monotonic receipts stay compatible', async () => {
  const f = fixture();
  await f.run([{ messageId: 'REMINDER', status: 'read' }, { messageId: 'KNOWN', status: 'read' }]);
  assert.deepEqual(f.calls, ['REMINDER']);
  await f.run([{ messageId: 'KNOWN', status: 'delivered' }]);
  assert.equal(f.message.status, 'read');
});

test('a foreign target is unresolved and never crosses the resolved tenant/session', async () => {
  const f = fixture();
  await assert.rejects(f.run([{ messageId: 'FOREIGN', status: 'read' }, { messageId: 'KNOWN', status: 'read' }]), /TARGET_NOT_FOUND/);
  assert.equal(f.message.status, 'read');
  assert.equal(f.foreign.status, 'sent');
});

test('the retained batch reconciles a future canonical target without replaying known progress', async () => {
  const f = fixture();
  const entries = [{ messageId: 'FUTURE', status: 'read' }, { messageId: 'KNOWN', status: 'read' }];
  await assert.rejects(f.run(entries), /TARGET_NOT_FOUND/);
  assert.equal(f.message.status, 'read');
  Object.assign(f.foreign, { organization_id: scope.organization_id, message_id: 'FUTURE' });
  await f.run(entries);
  assert.equal(f.foreign.status, 'read');
  await f.run(entries);
  assert.equal(f.message.status, 'read');
  assert.equal(f.foreign.status, 'read');
});

test('ambiguous notification identity is not silently acknowledged', async () => {
  const f = fixture(() => 'ambiguous');
  await assert.rejects(f.run([{ messageId: 'AMBIGUOUS', status: 'read' }]), /reconciliation_rejected/);
  assert.equal(f.message.status, 'sent');
});

test('Go isolated receipt effects stay compatible with the current Edge handler', async () => {
  const f = fixture();
  // Canonical wire shape produced by splitEvolutionWebhookReceiptEffects.
  // Each inbox row carries one effect; the native ingress retains the original
  // callback key and its marker. The legacy Edge ignores the marker safely.
  const effect = (messageId, status, ordinal) => ({
    event: 'receipt',
    data: { receipts: [{ messageId, status, timestamp: 1791979100 }] },
    __vimob_ingress: {
      routing_key: `receipt-target:synthetic-${messageId}`,
      receipt_effect: {
        version: 1, parent_event_key: 'synthetic-parent', ordinal, total: 3,
        source_event: 'messages.update', target_hash: `synthetic-${messageId}`,
      },
    },
  });
  await assert.rejects(f.runPayload(effect('FUTURE', 'read', 0)), /TARGET_NOT_FOUND/);
  await f.runPayload(effect('KNOWN', 'read', 1));
  assert.equal(f.message.status, 'read');
  await assert.rejects(f.runPayload(effect('FOREIGN', 'read', 2)), /TARGET_NOT_FOUND/);
  assert.equal(f.foreign.status, 'sent');
  await f.runPayload(effect('KNOWN', 'delivered', 1));
  assert.equal(f.message.status, 'read', 'receipt replay cannot roll back delivery state');
});
