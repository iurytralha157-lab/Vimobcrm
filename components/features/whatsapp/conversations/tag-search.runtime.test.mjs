import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

// Actual tag bar, list card and Radix layers, with synthetic props/callbacks.
// Every browser request is blocked; no service, auth session or real data.
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const evidence = "D:/Vimob/tmp/whatsapp-list-polish-20261018";
const require = createRequire(import.meta.url);
let directory, browser, bundle, css;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "vimob-conversation-tag-search-"));
  await mkdir(evidence, { recursive: true });
  await writeFile(join(directory, "mentions.js"), "export const useMentionNames=()=>({});");
  await writeFile(join(directory, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;`);
  await writeFile(join(directory, "entry.tsx"), `
    import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
    import {ConversationLeadTagBar} from '@/components/features/whatsapp/conversations/ConversationLeadTagBar';
    import {ConversationListItem} from '@/components/features/whatsapp/conversations/ConversationListItem';
    const app=createRoot(document.getElementById('app'));
    const h=window.h={adds:[],removes:[],retried:0,opened:0,options:{},assigned:['assigned'],tags:[
      {id:'assigned',name:'Já atribuída',color:'#24785a'},
      {id:'visit',name:'Visitação',color:'#f97316'},
      {id:'interest',name:'Interesse alto',color:'#208080'},
      ...Array.from({length:40},(_,i)=>({id:'tag-'+i,name:'Tag sintética '+String(i).padStart(2,'0'),color:'#466788'}))],
      render(options=this.options){this.options=options;flushSync(()=>app.render(<Fixture options={options}/>));},
      add(id){this.adds.push(id);this.assigned.push(id);this.render();},remove(id){this.removes.push(id);this.assigned=this.assigned.filter(value=>value!==id);this.render();}
    };
    function Fixture({options}){const tags=h.tags.filter(tag=>h.assigned.includes(tag.id)).map(tag=>({tag}));
      const conversation={id:'conversation-a',session_id:'session-a',lead_id:'lead-a',remote_jid:'5511999900000@s.whatsapp.net',contact_name:'Lead sintético',contact_phone:'5511999900000',contact_picture:null,contact_presence:null,presence_updated_at:null,last_message:'Mensagem sintética',last_message_at:'2026-10-18T12:00:00Z',last_message_from_me:false,last_message_status:null,unread_count:0,is_group:false,archived_at:null,deleted_at:null,created_at:'2026-10-18T12:00:00Z',updated_at:'2026-10-18T12:00:00Z',lead:{id:'lead-a',name:'Lead sintético',assignee:null,tags}};
      return <section className='app-shell' style={{width:options.width||300,padding:8}}>
        <div data-tag-surface='panel'><ConversationLeadTagBar tags={tags} availableTags={h.tags.filter(tag=>!h.assigned.includes(tag.id))} canManage={options.canManage!==false} busy={!!options.busy} loading={!!options.loading} failed={!!options.failed} onRetry={()=>h.retried++} onAdd={id=>h.add(id)} onRemove={id=>h.remove(id)}/></div>
        <div data-tag-surface='list'><ConversationListItem conversation={conversation} availableTags={h.tags} canOperate={false} canManageTags={options.canManage!==false} canCreateLead={false} isTagUpdating={!!options.busy} isSelected={false} onClick={()=>h.opened++} formatTime={()=>'09:00'} onArchive={()=>{}} onDelete={()=>{}} onAddTag={id=>h.add(id)} onRemoveTag={id=>h.remove(id)} onCreateLead={()=>{}}/></div>
      </section>;
    }h.render();
  `);
  const { webpack } = require("next/dist/compiled/webpack/webpack");
  await new Promise((done, reject) => {
    const compiler = webpack({ mode: "development", target: "web", devtool: false, entry: join(directory, "entry.tsx"), output: { path: directory, filename: "bundle.js", publicPath: "" },
      resolve: { symlinks: false, extensions: [".tsx", ".ts", ".js"], modules: [join(repository, "node_modules"), "node_modules"], alias: { "@/hooks/use-mention-names$": join(directory, "mentions.js"), "lucide-react$": require.resolve("lucide-react"), "@": repository } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: join(directory, "loader.cjs") }] },
      plugins: [new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }), new webpack.DefinePlugin({ "process.env.NODE_ENV": JSON.stringify("development") })] });
    compiler.run((error, stats) => compiler.close(() => error || stats?.hasErrors() ? reject(error || Error(stats.toString({ all: false, errors: true }))) : done()));
  });
  bundle = await readFile(join(directory, "bundle.js"), "utf8");
  const source = (await readFile(join(repository, "app/globals.css"), "utf8")).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);');
  css = (await require("postcss")([require("@tailwindcss/postcss")({ base: repository })]).process(`${source}\n@source "${join(repository, "components/features/whatsapp").replaceAll("\\", "/")}";\n@source "${join(repository, "components/ui").replaceAll("\\", "/")}";`, { from: join(repository, "app/tag-search-fixture.css") })).css;
  browser = await chromium.launch({ headless: true });
}, { timeout: 300000 });

after(async () => {
  await browser?.close();
  if (!directory) return;
  const target = resolve(directory);
  assert.equal(dirname(target), resolve(tmpdir()));
  assert.match(basename(target), /^vimob-conversation-tag-search-/);
  await rm(target, { recursive: true, force: true });
});

async function fixture(t, width = 1000) {
  const page = await browser.newPage({ viewport: { width, height: 720 }, hasTouch: width < 768 });
  page.setDefaultTimeout(5000);
  const errors = [], requests = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => { requests.push(route.request().url()); return route.abort(); });
  t.after(async () => { await page.close(); assert.deepEqual(errors, []); assert.deepEqual(requests, []); });
  await page.setContent(`<html class="light"><body><style>${css}</style><div id="app"></div></body></html>`);
  await page.addScriptTag({ content: bundle });
  await page.waitForFunction(() => typeof window.h === "object");
  return page;
}

async function open(page, surface) {
  const touch = page.viewportSize().width < 768;
  const press = target => touch ? target.tap() : target.click();
  if (surface === "panel") await press(page.getByRole("button", { name: "Adicionar tag", exact: true }));
  else {
    await press(page.getByRole("button", { name: /Mais ações/ }));
    await press(page.getByRole("menuitem", { name: "Tag", exact: true }));
    if (!touch) {
      const bounds = await page.locator("[data-conversation-tag-picker]").boundingBox();
      await page.mouse.move(bounds.x + bounds.width - 4, bounds.y + 16, { steps: 8 });
    }
  }
  const input = page.getByRole("textbox", { name: "Buscar tags" });
  await expect(input).toBeVisible();
  await press(input);
  return input;
}

for (const surface of ["panel", "list"]) {
  test(`${surface}: accent insensitive search never mutates on typing or Enter; explicit keyboard selection adds once`, async t => {
    const page = await fixture(t), input = await open(page, surface);
    await input.fill("  VISITACAO  ");
    const option = surface === "panel" ? page.getByRole("button", { name: "Visitação", exact: true }) : page.getByRole("menuitem", { name: "Visitação", exact: true });
    await expect(option).toBeVisible();
    await expect(page.getByText("Interesse alto", { exact: true })).toHaveCount(0);
    await input.press("Enter");
    assert.deepEqual(await page.evaluate(() => ({ adds: h.adds, removes: h.removes, opened: h.opened })), { adds: [], removes: [], opened: 0 });
    await input.press("ArrowDown");
    await expect(option).toBeFocused();
    await page.keyboard.press("Enter");
    assert.deepEqual(await page.evaluate(() => h.adds), ["visit"]);
    await expect(page.locator('[data-tag-surface="panel"]').getByText("Visitação", { exact: true })).toBeVisible();
  });

  test(`${surface}: empty result, reset after closing and busy/permission guards survive search`, async t => {
    const page = await fixture(t), input = await open(page, surface);
    await input.fill("Inexistente");
    await expect(page.getByText("Nenhuma tag encontrada.", { exact: true })).toBeVisible();
    await input.press("Enter");
    await input.press("Escape");
    await expect(input).toHaveCount(0);
    if (surface === "list") await page.keyboard.press("Escape");
    const reopened = await open(page, surface);
    await expect(reopened).toHaveValue("");
    await page.evaluate(() => h.render({ busy: true }));
    await reopened.fill("VISITACAO");
    await reopened.press("ArrowDown");
    await expect(reopened).toBeFocused();
    assert.deepEqual(await page.evaluate(() => h.adds), []);
    await page.evaluate(() => h.render({ canManage: false }));
    await expect(page.getByRole("textbox", { name: "Buscar tags" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Adicionar tag", exact: true })).toHaveCount(0);
  });

  test(`${surface}: mobile search stays inside viewport and list scroll leaves search visible`, async t => {
    const page = await fixture(t, 320), input = await open(page, surface);
    await expect(input).toHaveCSS("font-size", "16px");
    const root = input.locator("xpath=ancestor::*[@data-conversation-tag-picker]"), box = await root.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 320);
    const before = await input.boundingBox();
    await root.locator('[data-conversation-tag-option]').last().evaluate(element => element.scrollIntoView({ block: "nearest" }));
    await expect(input).toBeVisible();
    const after = await input.boundingBox();
    assert.equal(after.y, before.y);
    await input.fill("VISITACAO");
    await page.screenshot({ path: join(evidence, `tag-search-${surface}-mobile.png`), fullPage: true });
  });
}

test("submenu searches assigned tags and preserves explicit removal", async t => {
  const page = await fixture(t), input = await open(page, "list");
  await input.fill("ja atribuida");
  await page.getByRole("menuitem", { name: "Já atribuída remover", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => h.removes), ["assigned"]);
  assert.deepEqual(await page.evaluate(() => h.adds), []);
});

test("panel search retains catalog refresh feedback and retry action", async t => {
  const page = await fixture(t);
  await page.evaluate(() => h.render({ loading: true, failed: true }));
  const input = await open(page, "panel");
  await input.fill("VISITACAO");
  await expect(page.getByRole("status")).toContainText("Atualizando tags...");
  await expect(page.getByRole("alert")).toContainText("Não foi possível atualizar as tags.");
  await page.evaluate(() => h.render({ failed: true }));
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  assert.equal(await page.evaluate(() => h.retried), 1);
  assert.deepEqual(await page.evaluate(() => h.adds), []);
});

test("keyboard opening focuses search and typing does not trigger Radix typeahead or alter lead tags", async t => {
  const page = await fixture(t);
  await page.getByRole("button", { name: /Mais ações/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Tag", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  const input = page.getByRole("textbox", { name: "Buscar tags" });
  await expect(input).toBeFocused();
  await page.keyboard.type("VISITACAO");
  await expect(input).toHaveValue("VISITACAO");
  await expect(input).toBeFocused();
  await expect(page.getByRole("menuitem", { name: "Visitação", exact: true })).toBeVisible();
  assert.deepEqual(await page.evaluate(() => ({ adds: h.adds, removes: h.removes })), { adds: [], removes: [] });
  await input.press("Escape");
  await expect(input).toHaveCount(0);
});
