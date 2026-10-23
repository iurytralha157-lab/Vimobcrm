import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect } from '@playwright/test';

// Real entry handlers and their production buttons feed the real floating
// context, composer and messages. The surrounding Pipeline/detail layout and
// auth/data/provider are closed fixtures. Receiving below starts at the query
// result boundary; native ingestion/persistence is exercised separately in Go.
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const require = createRequire(import.meta.url), ts = require('typescript');
const directory = await mkdtemp(join(tmpdir(), 'vimob-entry-send-receive-'));
const proof = process.env.WHATSAPP_ENTRY_PROOF_DIR;
const baseline = await readFile(join(repository, 'components/features/whatsapp/whatsapp-ui-hardening.runtime.test.mjs'), 'utf8');
let bootstrap = baseline.slice(0, baseline.indexOf('async function confirmAttachments(page)'));

function productionEntry(source, handlerNames, buttonHandler) {
  const parsed = ts.createSourceFile('entry.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const handlers = new Map(), buttons = [];
  function visit(node) {
    if (ts.isVariableDeclaration(node) && handlerNames.includes(node.name.getText(parsed))) {
      handlers.set(node.name.getText(parsed), node.initializer.getText(parsed));
    }
    if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(attr =>
      ts.isJsxAttribute(attr) && attr.name.getText(parsed) === 'onClick' &&
      ts.isJsxExpression(attr.initializer) && attr.initializer.expression?.getText(parsed) === buttonHandler)) buttons.push(node.getText(parsed));
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.deepEqual([...handlers.keys()].sort(), [...handlerNames].sort());
  assert.ok(buttons.length > 0, 'production button is present');
  return { declarations: handlerNames.map(name => `const ${name}=${handlers.get(name)};`).join('\n'), buttons };
}
const pipeline = productionEntry(await readFile(join(repository, 'components/features/leads/LeadCard.tsx'), 'utf8'), ['handleWhatsAppClick'], 'handleWhatsAppClick');
const detail = productionEntry(await readFile(join(repository, 'components/features/leads/LeadDetailDialog.tsx'), 'utf8'), ['openLeadWhatsApp', 'handleQuickWhatsApp'], 'handleQuickWhatsApp');
const templateContent = value => value.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${');

bootstrap = bootstrap
  .replace("import { chromium } from '@playwright/test';", `import playwright from ${JSON.stringify(pathToFileURL(require.resolve('@playwright/test')).href)};const {chromium}=playwright;`)
  .replace('const require = createRequire(import.meta.url);', `const require=createRequire(${JSON.stringify(join(repository, 'package.json'))});`)
  .replace("const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');", `const repository=${JSON.stringify(repository)};`)
  .replace("export const useWhatsAppMessagesPaginated=()=>h().messages;", "export const useWhatsAppMessagesPaginated=id=>id?h().messages:{...h().messages,messages:[]};")
  .replace("    import{FloatingChatProvider", "    import{Button}from'@/components/ui/button';import{MessageCircle}from'lucide-react';import{cn}from'@/lib/utils';\n    import{FloatingChatProvider")
  .replace("return window.harness.scrollScenario?React.createElement", "return true?React.createElement")
  .replace('    function App(){', templateContent(ts.transpileModule(`
    function EntryPoint(){
      const {openNewChat,openNewChatWithMessage}=useFloatingChat();
      const lead=h.entryLead,localLead=lead,leadName=lead.name;
      const canUseWhatsApp=h.permissions.includes('whatsapp_view'),whatsappActionLabel='Abrir WhatsApp';
      const canViewLeadWhatsApp=canUseWhatsApp,canOperateLeadWhatsApp=h.permissions.includes('whatsapp_operate');
      const poolReadOnly=false,canOpenLeadWhatsApp=canViewLeadWhatsApp;
      const iconColors={whatsapp:''},toast={error:x=>h.toasts.push(x),info:x=>h.toasts.push(x)};
      const handleCloseLeadDetail=()=>{h.detailClosed=true;h.entrypoint=null;h.render();};
      ${pipeline.declarations}
      ${detail.declarations}
      return h.entrypoint==='pipeline'?(${pipeline.buttons[0]}):h.entrypoint==='detail'?(
        h.mobile?(${detail.buttons[0]}):(${detail.buttons.at(-1)})):
        React.createElement('button',{onClick:()=>openLeadWhatsApp(h.preparedText)},'Papo inicial');
    }
    `, {fileName:'entry.tsx',compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText) + '\nfunction App(){')
  .replace("React.createElement(Probe),h.mode==='floating'&&React.createElement(FloatingChat)", "React.createElement(Probe),h.entrypoint&&React.createElement(EntryPoint),h.mode==='floating'&&React.createElement(FloatingChat)")
  .replace("await page.route('**/*',r=>r.abort());", "const network=[];await page.route('**/*',r=>{network.push(r.request().url());return r.abort();});t.after(()=>assert.deepEqual(network,[],'no external requests'));");
assert.ok(bootstrap.includes('function EntryPoint()'));
assert.ok(bootstrap.includes("import{Button}from'@/components/ui/button'"));
await writeFile(join(directory, 'bootstrap.mjs'), `${bootstrap}\nexport {harness,conversation};`);
const { harness, conversation } = await import(pathToFileURL(join(directory, 'bootstrap.mjs')).href);
after(async () => {
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  assert.match(basename(directory), /^vimob-entry-send-receive-/);
  await rm(directory, { recursive: true, force: true });
});

const fixtureLead = { id: 'lead-a', name: 'Marina Sintética', phone: '+5511999998888' };
async function open(t, entry, width) {
  const page = await harness(t, entry === 'screen' ? 'screen' : 'floating');
  page.setDefaultTimeout(5000);
  await page.setViewportSize({ width, height: 820 });
  const target = { ...conversation('chat-a', 'lead-a'), contact_name: fixtureLead.name };
  await page.evaluate(({ entry, width, target, lead }) => {
    const h = window.harness; h.mobile = width < 768;
    h.sessions = [{ ...h.sessions[0], status: 'connected', can_send: true }];
    h.entryLead = lead; h.entrypoint = ['pipeline', 'detail', 'prepared'].includes(entry) ? entry : null;
    h.preparedText = 'Olá Marina, este é o papo inicial.';
    h.conversations = [target]; h.render();
    if (entry === 'floating') h.ctx.openConversation(target);
  }, { entry, width, target, lead: fixtureLead });
  if (entry === 'screen') await page.getByRole('button', { name: 'Abrir chat-a', exact: true }).click();
  if (['pipeline', 'detail', 'prepared'].includes(entry)) {
    await page.getByRole('button', { name: entry === 'pipeline' ? 'Abrir WhatsApp: Marina Sintética' : entry === 'detail' ? 'Chat' : 'Papo inicial', exact: true }).click();
    // Resolve only read operations. Any unexpected start/link/send is a failure.
    await expect.poll(() => page.evaluate(() => window.harness.requests.length)).toBeGreaterThan(0);
    const first = await page.evaluate(() => window.harness.requests[0].kind);
    assert.ok(['find', 'history', 'detail'].includes(first));
    await page.evaluate(target => window.harness.requests[0].resolve(target), target);
    await page.waitForFunction(() => window.harness.ctx.state.activeConversation?.id === 'chat-a');
    assert.equal(await page.evaluate(() => window.harness.requests.filter(r => ['start', 'link', 'send'].includes(r.kind)).length), 0);
    if (entry !== 'pipeline') assert.equal(await page.evaluate(() => window.harness.detailClosed), true);
  }
  return page;
}

async function roundTrip(page, text) {
  const input = page.getByPlaceholder('Digite sua mensagem...');
  await expect(input).toBeEnabled();
  await input.fill(text); await page.getByRole('button', { name: 'Enviar mensagem', exact: true }).click();
  await page.waitForFunction(() => window.harness.requests.some(r => r.kind === 'send'));
  const request = await page.evaluate(() => window.harness.requests.find(r => r.kind === 'send').params);
  assert.equal(request.conversation.id, 'chat-a'); assert.equal(request.conversation.lead_id, 'lead-a');
  assert.equal(request.sendSessionId, 'session-a'); assert.equal(request.text, text);
  await page.evaluate(text => {
    const h = window.harness, sent = { id: 'sent-synthetic', conversation_id: 'chat-a', session_id: 'session-a', lead_id: 'lead-a', content: text,
      from_me: true, status: 'sent', message_type: 'text', sent_at: '2026-10-15T10:00:00Z' };
    h.requests.find(r => r.kind === 'send').resolve({ status: 'queued', message: sent });
    h.messages = { ...h.messages, messages: [sent] }; h.render();
  }, text);
  await expect(input).toHaveValue('');
  await expect(page.locator('[data-message-id="sent-synthetic"]')).toContainText(text);
  await page.evaluate(() => {
    const h = window.harness;
    h.messages = { ...h.messages, messages: [...h.messages.messages, { id: 'incoming-synthetic', conversation_id: 'chat-a', session_id: 'session-a', lead_id: 'lead-a',
      content: 'Resposta recebida da Marina.', from_me: false, status: 'received', message_type: 'text', sent_at: '2026-10-15T10:00:01Z' }] }; h.render();
  });
  await expect(page.locator('[data-message-id="incoming-synthetic"]')).toContainText('Resposta recebida da Marina.');
  assert.equal(await page.evaluate(() => window.harness.requests.filter(r => r.kind === 'send').length), 1);
}

for (const entry of ['pipeline', 'detail', 'floating', 'screen']) for (const width of [390, 1440]) {
  test(`${entry} ${width}: original entry sends one scoped message and renders the reply`, async t => {
    const page = await open(t, entry, width);
    await roundTrip(page, `Mensagem sintética via ${entry}.`);
    if (proof) await page.screenshot({ path: join(proof, `${entry}-${width}-send-receive.png`), fullPage: true });
  });
}

for (const width of [390, 1440]) test(`lead detail ${width}: initial text remains a draft until explicit send`, async t => {
  const page = await open(t, 'prepared', width);
  await expect(page.getByPlaceholder('Digite sua mensagem...')).toHaveValue('Olá Marina, este é o papo inicial.');
  assert.equal(await page.evaluate(() => window.harness.requests.filter(r => r.kind === 'send').length), 0);
  await roundTrip(page, 'Texto inicial revisado antes do envio.');
});
