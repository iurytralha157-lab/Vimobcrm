import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true);
const compiled = ts.transpileModule(parsed.statements.filter(ts.isFunctionDeclaration).map(node => node.getText(parsed)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const org = '11111111-1111-4111-8111-111111111111';
const queue = '22222222-2222-4222-8222-222222222222';

function fixture() {
  const calls = [];
  const boundaryError = new Error('synthetic lead phone boundary reached');
  const context = vm.createContext({
    Date, console,
    unique: values => [...new Set(values)],
    supabase: { async rpc(name, args) {
      calls.push({ name, args });
      return { data: null, error: name === 'upsert_whatsapp_webhook_lead' ? boundaryError : null };
    } },
  });
  vm.runInContext(compiled, context);
  context.clickToWhatsAppAdConfirmationMethod = () => 'entry_point_ctwa_ad';
  context.isPostFormFollowUpWithoutLeadIntake = () => false;
  context.whatsappAttribution = () => null;
  context.detectPropertyCode = () => null;
  context.resolvePropertyByCode = async () => null;
  context.campaignLabelForMessage = () => '';
  context.resolveActiveSessionOwner = async () => 'synthetic-owner';
  context.findWhatsAppIdentityAlias = async () => ({ match: null });
  return { context, calls, boundaryError };
}

for (const [name, phone, expected] of [
  ['NANP', '14155552671', '+14155552671'],
  ['international ten digits', '3312345678', '+3312345678'],
  ['Portugal', '351912345678', '+351912345678'],
  ['Brazil unchanged', '5511999999999', '5511999999999'],
]) {
  test(`lead RPC lookup and creation preserve ${name}`, async () => {
    const { context, calls, boundaryError } = fixture();
    const message = { messageId: 'synthetic-intake', remoteJid: `${phone}@s.whatsapp.net`,
      senderJid: `${phone}@s.whatsapp.net`, content: 'Interesse sintético', fromMe: false, isGroup: false, raw: {} };
    await assert.rejects(context.ensureLead({ organization_id: org, id: 'synthetic-session' },
      message, { target_round_robin_id: queue }, true), error => error === boundaryError);
    assert.equal(calls[0].name, 'find_lead_by_normalized_phone');
    assert.equal(calls[0].args.p_phone, expected);
    const upsert = calls.find(call => call.name === 'upsert_whatsapp_webhook_lead');
    assert.equal(upsert.args.p_phone, expected);
    assert.equal(upsert.args.p_whatsapp, expected);
  });
}

for (const [name, remoteJid, isGroup] of [
  ['opaque LID', '123456789@lid', false],
  ['group', '120363123456789@g.us', true],
]) {
  test(`${name} cannot become a lead phone`, async () => {
    const { context, calls } = fixture();
    const result = await context.ensureLead({ organization_id: org, id: 'synthetic-session' },
      { remoteJid, senderJid: remoteJid, isGroup, raw: {} }, { target_round_robin_id: queue }, true);
    assert.equal(result, null);
    assert.equal(calls.length, 0);
  });
}
