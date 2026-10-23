import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { guardStoredContactIdentity, isStoredContactPNConflict } from './stored-contact-identity.ts';

const source = readFileSync(process.env.WHATSAPP_STORED_LID_EDGE_INDEX || new URL('./index.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true);
const compiled = ts.transpileModule(parsed.statements.filter(ts.isFunctionDeclaration).map(node => node.getText(parsed)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const org = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const conversationId = '33333333-3333-4333-8333-333333333333';
const leadId = '44444444-4444-4444-8444-444444444444';
const lid = '777777777000001@lid';
const pnA = '5511988881111@s.whatsapp.net';
const pnB = '5511977772222@s.whatsapp.net';

function fixture(phone, aliases, incomingPN = pnA, fromMe = false) {
  let writes = 0;
  const aliasWrites = [];
  const conversation = { id: conversationId, organization_id: org, session_id: sessionId, remote_jid: lid, contact_phone: phone, lead_id: leadId };
  let context;
  const supabase = { from(table) {
    const filters = new Map(); let updates; let projection = '*';
    const result = () => {
      const rows = (table === 'whatsapp_conversations' ? [conversation] : aliases).filter(row => [...filters].every(([key, value]) => row[key] === value));
      if (updates && rows.length) { writes++; Object.assign(conversation, updates); }
      return { data: rows.map(row => table === 'whatsapp_conversations' && projection !== '*'
        ? Object.fromEntries(Object.entries(row).filter(([key]) => projection.split(/[, ]/).includes(key)))
        : ({ ...row })), error: null };
    };
    const query = {
      select(value = '*') { projection = value; return query; }, eq(key, value) { filters.set(key, value); return query; },
      is(key, value) { if (!key.startsWith('active_bindings.')) filters.set(key, value); return query; },
      update(patch) { updates = patch; return query; }, limit() { return query; },
      async maybeSingle() { const r = result(); return { ...r, data: r.data[0] ?? null }; },
      async single() { const r = result(); return { ...r, data: r.data[0] ?? null }; },
      async upsert(rows) {
        aliasWrites.push(...rows);
        const conflict = rows.some(row => context.contactPNsConflict([row.alias_jid, row.canonical_jid]));
        return { data: null, error: conflict ? { code: '23514', message: 'whatsapp_contact_pn_conflict' } : null };
      },
      then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
    };
    return query;
  } };
  context = vm.createContext({ supabase, Date, guardStoredContactIdentity, isStoredContactPNConflict, console: { warn() {} } });
  vm.runInContext(compiled, context);
  context.whatsappAttribution = () => null;
  const message = { messageId: 'synthetic-provider-id', remoteJid: incomingPN, senderJid: fromMe ? pnB : incomingPN, fromMe, isGroup: false,
    raw: { Info: { Chat: lid, SenderPN: fromMe ? pnB : incomingPN, RecipientPN: fromMe ? incomingPN : undefined } } };
  const session = { id: sessionId, organization_id: org };
  return { conversation, aliasWrites, writes: () => writes,
    snapshot: () => context.captureWhatsAppConversationBindingSnapshot(session, message, conversationId),
    activate: () => {
      supabase.rpc = async () => ({ data: { conversation_id: conversationId, active_lead_id: leadId,
        success: true, binding_id: '55555555-5555-4555-8555-555555555555', lead_id: leadId,
        is_current: true, stale: false }, error: null });
      return context.activateWhatsAppConversationLeadBinding(session, conversation, { id: leadId }, message,
        { conversationId, currentLeadId: leadId, activeBindingId: null });
    },
    run: () => context.ensureConversation(
    { id: sessionId, organization_id: org }, message, { id: leadId }, conversationId, null,
    { state: 'bound', conversationId, currentLeadId: leadId, eventLeadId: leadId }) };
}

test('binding snapshot reads persisted contact_phone before resolving a stored physical LID', async () => {
  const f = fixture(pnB.split('@')[0], []);
  await assert.rejects(f.snapshot(), /whatsapp_contact_pn_conflict/);
  assert.equal(f.writes(), 0);
});

test('binding activation never stores an outbound owner PN as a contact alias', async () => {
  const f = fixture(pnA.split('@')[0], [], pnA, true);
  await f.activate();
  assert.ok(f.aliasWrites.length > 0);
  assert.equal(f.aliasWrites.some(row => row.alias_jid === pnB), false);
  assert.equal(f.aliasWrites.some(row => row.alias_jid === pnA), true);
});

for (const [name, phone, incomingPN, fromMe] of [
  ['BR ninth digit', '551188881111', pnA, false],
  ['BR national digits', '11988881111', pnA, false],
  ['NANP bare digits', '14155552671', '14155552671@s.whatsapp.net', false],
  ['NANP international prefix', '+14155552671', '14155552671@s.whatsapp.net', false],
  ['outbound owner is not contact', '5511988881111', pnA, true],
]) {
  test(`legitimate physical LID promotion preserves the original lead: ${name}`, async () => {
    const f = fixture(phone, [], incomingPN, fromMe);
    const result = await f.run();
    assert.equal(result.lead_id, leadId);
    assert.equal(f.conversation.remote_jid, incomingPN);
    assert.equal(f.writes(), 1);
  });
}

test('PN alias evidence from a different tenant cannot contaminate the selected physical LID', async () => {
  const f = fixture(null, [{ organization_id: '99999999-9999-4999-8999-999999999999', session_id: sessionId,
    alias_jid: pnB, canonical_jid: lid, contact_phone: pnB.split('@')[0] }]);
  const result = await f.run();
  assert.equal(result.lead_id, leadId);
  assert.equal(f.conversation.remote_jid, pnA);
});

test('SQL identity PN rejections cannot be swallowed by the best-effort alias writer', async () => {
  const parsedContext = vm.createContext({ isStoredContactPNConflict, console: { warn() {} } });
  vm.runInContext(compiled, parsedContext);
  parsedContext.upsertWhatsAppIdentityAliases = async () => { throw { code: '23514', message: 'whatsapp_contact_pn_conflict' }; };
  await assert.rejects(parsedContext.safelyUpsertWhatsAppIdentityAliases({}, {}, {}), error => error.code === '23514');
});

for (const kind of ['stored-phone', 'stored-alias']) {
  test(`stored physical LID rejects another PN before any Edge mutation: ${kind}`, async () => {
    const f = fixture(kind === 'stored-phone' ? pnB.split('@')[0] : null,
      kind === 'stored-alias' ? [{ organization_id: org, session_id: sessionId, alias_jid: pnB, canonical_jid: lid, contact_phone: null }] : []);
    await assert.rejects(f.run(), /whatsapp_contact_pn_conflict/);
    assert.equal(f.writes(), 0);
    assert.equal(f.conversation.remote_jid, lid);
    assert.equal(f.conversation.lead_id, leadId);
  });
}
