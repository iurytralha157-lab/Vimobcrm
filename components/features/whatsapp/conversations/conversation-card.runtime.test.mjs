import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const require = createRequire(import.meta.url);
let directory, browser, bundle, css;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "vimob-conversation-cards-"));
  await writeFile(join(directory, "mentions.js"), "export const useMentionNames=()=>window.h.mentionNames;");
  await writeFile(join(directory, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext}}).outputText;`);
  await writeFile(join(directory, "entry.tsx"), `
    import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
    import {ConversationListItem} from '@/components/features/whatsapp/conversations/ConversationListItem';
    import {ConversationList} from '@/components/features/whatsapp/conversations/ConversationList';
    import {captureWhatsAppCanonicalConversationPreview,projectWhatsAppCanonicalConversationPreview} from '@/lib/whatsapp-canonical-conversation-preview';
    const app=createRoot(document.getElementById('app'));
    const h=window.h={opened:0,nodes:new Map(),registrations:0,cleanups:0,mentionNames:{'5511999900000':'Contato sintético'},options:{},scope:{organizationId:'org-a',userId:'actor-a',accessScope:'permissions+sid-a'},
      conversation:{id:'conversation-a',session_id:'session-a',lead_id:'lead-a',remote_jid:'5511999900000@s.whatsapp.net',contact_name:'Contato sintético',contact_phone:'5511999900000',contact_picture:null,contact_presence:null,presence_updated_at:null,last_message:'Mensagem sintética',last_message_at:'2026-10-13T12:00:00Z',last_message_from_me:true,last_message_status:'sent',unread_count:3,is_group:false,archived_at:null,deleted_at:null,created_at:'2026-10-13T11:00:00Z',updated_at:'2026-10-13T12:00:00Z',lead:{id:'lead-a',name:'Lead sintético',assignee:{id:'actor-a',name:'Responsável sintético',avatar_url:null},tags:[]}},
      render(options={}){this.options=options;flushSync(()=>app.render(<Fixture options={options}/>));},patch(patch){this.render({...this.options,conversation:{...this.options.conversation,...patch}})}
    };
    const previewCardRef=node=>{if(!node)return;const id=node.dataset.conversationId;h.nodes.set(id,node);h.registrations++;return()=>{if(h.nodes.get(id)===node)h.nodes.delete(id);h.cleanups++;};};
    function Fixture({options}){let conversation={...h.conversation,...options.conversation};if(options.legacyPayload){delete conversation.last_message_from_me;delete conversation.last_message_status;}const preview=options.canonicalMessages?captureWhatsAppCanonicalConversationPreview(options.canonicalMessages,{scope:h.scope,conversationId:conversation.id,expectedLeadId:conversation.lead_id,expectedSessionId:conversation.session_id}):null;conversation=projectWhatsAppCanonicalConversationPreview([conversation],preview,options.scope||h.scope)[0];const shared={currentUserId:'actor-a',availableTags:[],canOperate:options.canOperate!==false,canManageTags:options.canOperate!==false,canCreateLead:options.canOperate!==false};const items=options.conversations||[conversation];return <section className="app-shell" data-surface={options.surface||'floating'} style={{width:options.width||280,height:400}}>{options.surface==='page'?<ConversationList {...shared} layout="desktop" channel="whatsapp" conversations={items} previewCardRef={previewCardRef} isLoading={false} onRetry={()=>{}} canManageWhatsApp onConnectWhatsApp={()=>{}} onSelect={()=>h.opened++} onArchive={()=>{}} onDelete={()=>{}} onAddTag={()=>{}} onRemoveTag={()=>{}} onCreateLead={()=>{}} formatTime={()=>'09:00'} hasMoreConversations={false} isLoadingMoreConversations={false} onLoadMoreConversations={()=>{}} getDraftText={()=>options.draft||''}/>:items.map(conversation=><ConversationListItem key={conversation.id} {...shared} conversation={conversation} previewCardRef={previewCardRef} isSelected={false} onClick={()=>h.opened++} formatTime={()=>'09:00'} onArchive={()=>{}} onDelete={()=>{}} onAddTag={()=>{}} onRemoveTag={()=>{}} onCreateLead={()=>{}} draftText={options.draft}/>)}</section>}
    h.render();
  `);
  const { webpack } = require("next/dist/compiled/webpack/webpack");
  await new Promise((resolveBuild, reject) => {
    const compiler = webpack({ mode: "development", target: "web", devtool: false, entry: join(directory, "entry.tsx"), output: { path: directory, filename: "bundle.js", publicPath: "" },
      resolve: { symlinks: false, extensions: [".tsx", ".ts", ".js"], modules: [join(repository, "node_modules"), "node_modules"], alias: { "@/hooks/use-mention-names$": join(directory, "mentions.js"), "lucide-react$": require.resolve("lucide-react"), "@": repository } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: join(directory, "loader.cjs") }] },
      plugins: [new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }), new webpack.DefinePlugin({ "process.env.NODE_ENV": JSON.stringify("development") })] });
    compiler.run((error, stats) => compiler.close(() => error || stats?.hasErrors() ? reject(error || Error(stats.toString({ all: false, errors: true }))) : resolveBuild()));
  });
  bundle = await readFile(join(directory, "bundle.js"), "utf8");
  const source = (await readFile(join(repository, "app/globals.css"), "utf8")).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);');
  css = (await require("postcss")([require("@tailwindcss/postcss")({ base: repository })]).process(`${source}\n@source "${join(repository, "components/features/whatsapp").replaceAll("\\", "/")}";\n@source "${join(repository, "components/ui").replaceAll("\\", "/")}";`, { from: join(repository, "app/card-fixture.css") })).css;
  browser = await chromium.launch({ headless: true });
}, { timeout: 300000 });
after(async () => {
  await browser?.close();
  if (!directory) return;
  const target = resolve(directory);
  assert.equal(dirname(target), resolve(tmpdir()));
  assert.match(basename(target), /^vimob-conversation-cards-/);
  await rm(target, { recursive: true, force: true });
});

async function fixture(t, options = {}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 700 } }); const errors = [], network = [];
  page.on("pageerror", error => errors.push(error.message));
  t.after(async () => { await page.close(); assert.deepEqual(errors, []); assert.deepEqual(network, [], 'no external network'); });
  await page.route("**/*", route => route.request().url() === "https://conversation-card.local/" ? route.fulfill({ contentType: "text/html", body: `<style>${css}</style><div id="app"></div>` }) : (network.push(route.request().url()), route.abort()));
  await page.goto("https://conversation-card.local/"); await page.addScriptTag({ content: bundle });
  assert.equal(await page.evaluate(() => typeof window.h), "object", errors.join("; "));
  await page.evaluate(options => h.render(options), options); return page;
}
test("metadata begins beneath the avatar and fills the card on both surfaces", async t => {
  for (const [surface, width] of [["floating", 260], ["page", 320], ["page", 390]]) {
    const page = await fixture(t, { surface, width });
    const card = page.locator('[data-tour="conversations-item"]'), band = card.locator("[data-conversation-tags]");
    const measurements = await card.evaluate(card => {
      const band = card.querySelector("[data-conversation-tags]"), avatar = card.querySelector('[data-conversation-avatar]');
      const c = card.getBoundingClientRect(), b = band.getBoundingClientRect(), a = avatar.getBoundingClientRect();
      return { bandX: b.x, avatarX: a.x, bandBottom: b.bottom, avatarBottom: a.bottom, bandTop: b.top, bandWidth: b.width, contentWidth: c.width - parseFloat(getComputedStyle(card).paddingLeft) - parseFloat(getComputedStyle(card).paddingRight), overflow: card.scrollWidth > card.clientWidth };
    });
    assert.ok(Math.abs(measurements.bandX - measurements.avatarX) < 1);
    assert.ok(measurements.bandTop >= measurements.avatarBottom);
    assert.ok(Math.abs(measurements.bandWidth - measurements.contentWidth) < 1);
    assert.equal(measurements.overflow, false);
    await expect(band.getByText("Lead", { exact: true })).toBeVisible();
    await expect(band.getByText("Responsável Sintético", { exact: true })).toBeVisible();
    await card.getByRole("button").first().click(); assert.equal(await page.evaluate(() => h.opened), 1);
  }
});
test("own and other assignee use the authorized real name; absent lead has no badge", async t => {
  const page = await fixture(t); await expect(page.getByText("Responsável Sintético", { exact: true })).toBeVisible();
  await page.evaluate(() => h.patch({ lead: { ...h.conversation.lead, assignee: { id: 'actor-b', name: 'Outro responsável' } } }));
  await expect(page.getByText("Outro Responsável", { exact: true })).toBeVisible();
  await page.evaluate(() => h.patch({ lead_id: null, lead: null })); await expect(page.getByText("Lead", { exact: true })).toHaveCount(0);
  await expect(page.locator("[data-conversation-tags]")).toHaveCount(0);
});
test("person names and owner weight stay compact while keyboard focus has no black frame", async t => {
  const page = await fixture(t);
  await page.evaluate(() => h.patch({ lead: { ...h.conversation.lead, name: '  ANA   BEATRIZ ', assignee: { id: 'actor-b', name: 'gustavo joão souza correia' } } }));
  const card = page.locator('[data-tour="conversations-item"]');
  const name = card.getByText('Ana Beatriz', { exact: true });
  const owner = card.getByLabel('Responsável: Gustavo João Souza Correia', { exact: true });
  await expect(name).toBeVisible(); await expect(owner).toBeVisible();
  const style = node => ({ size: getComputedStyle(node).fontSize, weight: getComputedStyle(node).fontWeight });
  assert.deepEqual(await name.evaluate(style), { size: '12px', weight: '300' });
  assert.deepEqual(await owner.evaluate(style), { size: '9px', weight: '300' });
  const open = card.getByRole('button').first(); await open.focus();
  const focus = await open.evaluate(node => {
    const style = getComputedStyle(node);
    return { radius: style.borderRadius, invisible: style.outlineStyle === 'none' || style.outlineWidth === '0px' || style.outlineColor === 'rgba(0, 0, 0, 0)' };
  });
  assert.deepEqual(focus, { radius: '6px', invisible: true });
  await open.press('Enter'); assert.equal(await page.evaluate(() => h.opened), 1);
  assert.equal(await page.evaluate(() => h.options.conversation.lead.name), '  ANA   BEATRIZ ', 'registered name is unchanged');
});
test("outgoing previews render the canonical queued sent delivered and read states", async t => {
  for (const surface of ["page", "floating"]) {
    const page = await fixture(t, { surface, width: 320 });
    for (const [status, label] of [["queued", "Mensagem na fila"], ["pending", "Mensagem na fila"], ["sent", "Mensagem enviada"], ["delivered", "Mensagem entregue"], ["read", "Mensagem lida"], ["played", "Mensagem lida"], ["failed", "Falha no envio"]]) {
      await page.evaluate(status => h.patch({ last_message_status: status }), status);
      const preview = page.locator("[data-conversation-preview]");
      const mark = preview.getByRole("img", { name: label });
      await expect(mark).toBeVisible();
      const icon = await mark.boundingBox(), text = await preview.locator("span.truncate").boundingBox();
      assert.ok(icon && text && icon.x + icon.width <= text.x, `${surface}: receipt precedes preview text`);
      if (status === "read") assert.match(await mark.getAttribute("class"), /text-blue-400/);
    }
  }
});
test("incoming absent and malformed direction never acquire an outgoing check", async t => {
  const page = await fixture(t);
  for (const direction of [false, null, undefined, "true"]) {
    await page.evaluate(direction => h.patch({ last_message_from_me: direction, last_message_status: 'read' }), direction);
    await expect(page.locator("[data-conversation-preview]").getByRole("img")).toHaveCount(0);
    await expect(page.locator('[data-conversation-receipt-slot]')).toHaveCount(0);
    assert.equal(await page.locator('[data-conversation-preview]').evaluate(node =>
      node.querySelector('[data-conversation-preview-text]').getBoundingClientRect().x === node.getBoundingClientRect().x), true,
    'an incoming or unattributed message starts at the beginning of the preview');
  }
});

test("known outgoing direction remains identifiable when its receipt is missing", async t => {
  for (const surface of ["page", "floating"]) {
    const page = await fixture(t, { surface, width: 320 });
    for (const status of [null, undefined, "", "   "]) {
      await page.evaluate(status => h.patch({ last_message_from_me: true, last_message_status: status }), status);
      const preview = page.locator("[data-conversation-preview]");
      await expect(preview.getByRole("img", { name: "Estado do envio indisponível" })).toBeVisible();
      await expect(preview.getByRole("img", { name: "Mensagem enviada", exact: true })).toHaveCount(0);
      await expect(preview.getByRole("img", { name: "Mensagem entregue", exact: true })).toHaveCount(0);
      await expect(preview.getByRole("img", { name: "Mensagem lida", exact: true })).toHaveCount(0);
    }
  }
});
test("draft typing recording and Meta preview keep their meaning without stale delivery status", async t => {
  const page = await fixture(t, { draft: "Rascunho preservado" });
  await expect(page.getByText("Rascunho:", { exact: true })).toBeVisible(); await expect(page.getByRole("img", { name: "Mensagem enviada" })).toHaveCount(0);
  for (const [presence, label] of [["composing", "digitando..."], ["recording", "Gravando áudio..."]]) {
    await page.evaluate(presence => h.render({ conversation: { contact_presence: presence, presence_updated_at: new Date().toISOString() } }), presence);
    await expect(page.getByText(label, { exact: true })).toBeVisible(); await expect(page.getByRole("img", { name: "Mensagem enviada" })).toHaveCount(0);
  }
  await page.evaluate(() => h.render({ conversation: { platform: 'instagram' } }));
  await expect(page.locator("[data-conversation-preview]").getByRole("img")).toHaveCount(0);
});
test("reconciliation changes the status and a later incoming message removes the mark", async t => {
  for (const surface of ["page", "floating"]) {
    const page = await fixture(t, { surface, width: 320 });
    for (const [status, label] of [["pending", "Mensagem na fila"], ["sent", "Mensagem enviada"], ["delivered", "Mensagem entregue"], ["read", "Mensagem lida"]]) {
      await page.evaluate(status => h.patch({ last_message_status: status }), status); await expect(page.getByRole("img", { name: label })).toBeVisible();
    }
    await page.evaluate(() => h.patch({ last_message: 'Resposta do cliente', last_message_from_me: false, last_message_status: 'read' }));
    await expect(page.getByText("Resposta do cliente", { exact: true })).toBeVisible(); await expect(page.getByRole("img", { name: "Mensagem lida" })).toHaveCount(0);
  }
});
test("media preview and mention names survive the shared preview extraction", async t => {
  const page = await fixture(t, { conversation: { last_message: "audio-sintetico.ogg" } });
  await expect(page.getByText("Áudio", { exact: true })).toBeVisible(); await expect(page.getByRole("img", { name: "Mensagem enviada" })).toBeVisible();
  await page.evaluate(() => h.patch({ last_message: 'Olá @5511999900000 https://example.test/@corretor' }));
  await expect(page.getByText('Olá @Contato sintético https://example.test/@corretor', { exact: true })).toBeVisible();
});

const canonicalRoute = {
  id: '00000000-0000-4000-8000-000000000031',
  session_id: '00000000-0000-4000-8000-000000000032',
  lead_id: '00000000-0000-4000-8000-000000000033',
  lead: { id: '00000000-0000-4000-8000-000000000033', name: 'Lead sintético', tags: [] },
  last_message: 'Prévia anterior da API', last_message_at: '2026-10-14T02:19:29Z',
};
const canonicalHead = {
  id: '00000000-0000-4000-8000-000000000034',
  conversation_id: canonicalRoute.id, session_id: canonicalRoute.session_id,
  from_me: true, status: 'delivered', message_type: 'text',
  content: 'Prévia completa da mensagem canônica', sent_at: canonicalRoute.last_message_at,
};

test("legacy cards display the complete authorized head from the open chat and drop it on scope or head changes", async t => {
  for (const surface of ['page', 'floating']) {
    const options = { surface, width: 320, legacyPayload: true, conversation: canonicalRoute, canonicalMessages: [canonicalHead] };
    const page = await fixture(t, options), preview = page.locator('[data-conversation-preview]');
    await expect(preview.getByText(canonicalHead.content, { exact: true })).toBeVisible();
    for (const [status, label] of [['pending', 'Mensagem na fila'], ['sent', 'Mensagem enviada'], ['delivered', 'Mensagem entregue'], ['read', 'Mensagem lida']]) {
      await page.evaluate(options => h.render(options), { ...options, canonicalMessages: [{ ...canonicalHead, status }] });
      await expect(preview.getByRole('img', { name: label, exact: true })).toBeVisible();
    }
    await page.evaluate(options => h.render(options), { ...options, canonicalMessages: [{ ...canonicalHead, from_me: false, status: 'received', content: 'Resposta canônica do lead' }] });
    await expect(preview.getByText('Resposta canônica do lead', { exact: true })).toBeVisible();
    await expect(preview.getByRole('img')).toHaveCount(0);
    await page.evaluate(options => h.render(options), { ...options, scope: { organizationId: 'org-a', userId: 'actor-a', accessScope: 'permissions+sid-b' } });
    await expect(preview.getByText(canonicalRoute.last_message, { exact: true })).toBeVisible();
    await expect(preview.getByRole('img')).toHaveCount(0);
    await page.evaluate(options => h.render(options), { ...options, conversation: { ...canonicalRoute, last_message_at: '2026-10-14T02:19:30Z' } });
    await expect(preview.getByText(canonicalRoute.last_message, { exact: true })).toBeVisible();
    await expect(preview.getByRole('img')).toHaveCount(0);
    assert.equal(await page.evaluate(() => h.options.conversation.last_message), canonicalRoute.last_message, 'source card data is unchanged');
  }
});

test("canonical list metadata wins over a previously read head, including authoritative empty metadata", async t => {
  const page = await fixture(t, { surface: 'page', conversation: { ...canonicalRoute, last_message: 'Resposta da API atualizada', last_message_from_me: false, last_message_status: 'received' }, canonicalMessages: [canonicalHead] });
  const preview = page.locator('[data-conversation-preview]');
  await expect(preview.getByText('Resposta da API atualizada', { exact: true })).toBeVisible();
  await expect(preview.getByRole('img')).toHaveCount(0);
  await page.evaluate(options => h.render(options), { surface: 'page', conversation: { ...canonicalRoute, last_message: 'API sem mensagem atual', last_message_from_me: null, last_message_status: null }, canonicalMessages: [canonicalHead] });
  await expect(preview.getByText('API sem mensagem atual', { exact: true })).toBeVisible();
  await expect(preview.getByRole('img')).toHaveCount(0);
});

test("only outgoing receipts reserve their own space while incoming draft and presence previews start at the beginning", async t => {
  for (const surface of ['page', 'floating']) for (const viewport of [320, 1440]) {
    const width = Math.min(viewport - 32, 360), page = await fixture(t, { surface, width, legacyPayload: true });
    await page.setViewportSize({ width: viewport, height: 800 });
    const states = [
      ['unknown', { legacyPayload: true }],
      ['sent', { conversation: { last_message_status: 'sent' } }],
      ['delivered', { conversation: { last_message_status: 'delivered' } }],
      ['read', { conversation: { last_message_status: 'read' } }],
      ['incoming', { conversation: { last_message_from_me: false, last_message_status: 'received' } }],
      ['draft', { draft: 'Rascunho preservado' }],
      ['typing', { conversation: { contact_presence: 'composing', presence_updated_at: new Date().toISOString() } }],
      ['recording', { conversation: { contact_presence: 'recording', presence_updated_at: new Date().toISOString() } }],
    ];
    const measured = [];
    for (const [state, options] of states) {
      await page.evaluate(options => h.render(options), { surface, width, ...options });
      measured.push({ state, ...await page.locator('[data-conversation-id]').evaluate(card => {
        const outer = card.querySelector('[data-conversation-preview]') || card.querySelector('button > .w-0 > div:last-child > span');
        const text = outer.querySelector('[data-conversation-preview-text]') || (outer.children.length > 1 ? outer.lastElementChild : outer);
        const row = card.getBoundingClientRect(), t = text.getBoundingClientRect(), p = outer.getBoundingClientRect();
        return { x: t.x - row.x, previewX: p.x - row.x, width: t.width, previewWidth: p.width, cardHeight: row.height, marks: outer.querySelectorAll('[role=img]').length };
      }) });
    }
    const outgoing = measured.filter(value => value.marks), plain = measured.filter(value => !value.marks);
    assert.equal(new Set(outgoing.map(value => value.x)).size, 1, 'receipt changes never move the outgoing text');
    assert.equal(new Set(outgoing.map(value => value.width)).size, 1, 'outgoing receipt states keep the same text width');
    assert.ok(outgoing.every(value => value.x - value.previewX === 20), 'only outgoing messages reserve the 20px receipt width');
    assert.ok(plain.every(value => value.x === value.previewX && value.width === value.previewWidth), 'incoming and non-message states have no empty receipt gutter');
    assert.equal(new Set(measured.map(value => value.cardHeight)).size, 1);
    assert.deepEqual(measured.map(value => value.marks), [0, 1, 1, 1, 0, 0, 0, 0]);
    await page.evaluate(options => h.render(options), { surface, width, conversation: { last_message_status: 'read' } });
    const slot = page.locator('[data-conversation-receipt-slot]');
    assert.deepEqual(await slot.evaluate(node => ({ width: getComputedStyle(node).width, height: getComputedStyle(node).height })), { width: '20px', height: '16px' });
    await page.evaluate(options => h.render(options), { surface, width, conversation: { platform: 'instagram' } });
    assert.equal(await page.locator('[data-conversation-receipt-slot]').count(), 0, 'Meta has no WhatsApp gutter');
    assert.equal(await page.evaluate(() => h.opened), 0);
    if (process.env.WHATSAPP_CARD_STABILITY_SCREENSHOTS) {
      await mkdir(process.env.WHATSAPP_CARD_STABILITY_SCREENSHOTS, { recursive: true });
      await page.evaluate(options => h.render(options), { surface, width, conversation: { last_message_status: 'read' } });
      await page.screenshot({ path: join(process.env.WHATSAPP_CARD_STABILITY_SCREENSHOTS, `${surface}-${viewport}-read.png`), fullPage: true });
    }
  }
});

test("canonical first-list80 cards display status synchronously and retain nodes refs through reorder and append", async t => {
  const page = await fixture(t, { surface: 'page', width: 320 });
  await page.evaluate(() => {
    h.cards = Array.from({ length: 80 }, (_, index) => ({ ...h.conversation,
      id: '00000000-0000-4000-8000-' + String(index + 1).padStart(12, '0'),
      last_message: 'Mensagem canônica ' + index, last_message_from_me: index % 2 === 0,
      last_message_status: index % 2 === 0 ? ['sent', 'delivered', 'read'][index % 3] : 'received',
    }));
    h.render({ surface: 'page', width: 320, conversations: h.cards }); h.originalNodes = new Map(h.nodes);
    h.initialRegistrations = h.registrations; h.initialCleanups = h.cleanups;
  });
  await expect(page.locator('[data-conversation-id]')).toHaveCount(80);
  assert.equal(await page.locator('[data-conversation-preview] [role=img]').count(), 40);
  assert.equal(await page.evaluate(() => h.nodes.size), 80);
  await page.evaluate(() => h.render({ surface: 'page', width: 320, conversations: [...h.cards].reverse() }));
  assert.equal(await page.evaluate(() => [...h.originalNodes].every(([id, node]) => h.nodes.get(id) === node)), true);
  assert.deepEqual(await page.evaluate(() => [h.registrations, h.cleanups]), await page.evaluate(() => [h.initialRegistrations, h.initialCleanups]));
  await page.evaluate(() => h.render({ surface: 'page', width: 320, conversations: [...h.cards].reverse().concat(h.cards.slice(0, 20).map((row, index) => ({ ...row, id: '00000000-0000-4000-8000-' + String(index + 1001).padStart(12, '0') }))) }));
  await expect(page.locator('[data-conversation-id]')).toHaveCount(100);
  assert.equal(await page.evaluate(() => [...h.originalNodes].every(([id, node]) => h.nodes.get(id) === node)), true);
  assert.equal(await page.evaluate(() => h.nodes.size), 100);
  assert.equal(await page.evaluate(() => h.registrations - h.initialRegistrations), 20);
  assert.equal(await page.evaluate(() => h.cleanups - h.initialCleanups), 0);
  assert.equal(await page.evaluate(() => h.opened), 0);
});
