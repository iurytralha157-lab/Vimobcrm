import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { chromium, expect } from "@playwright/test";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
let directory, browser, page;
const errors = [];

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "vimob-pwa-layout-"));
  const layoutSource = await readFile(path.join(root, "components/shared/layout/AppLayout.tsx"), "utf8");
  const ast = ts.createSourceFile("AppLayout.tsx", layoutSource, ts.ScriptTarget.Latest, true);
  const layout = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "AppLayoutContent");
  assert.ok(layout, "run the actual app content layout");
  await writeFile(path.join(directory, "layout.tsx"), `
import React from 'react';
import {cn} from '@/lib/utils';
import {useIsMobile} from '@/hooks/use-mobile';
const usePushNotifications=()=>{},usePhoneReminder=()=>{},useWhatsAppSound=()=>{},useAuditFeed=()=>{};
const MaintenanceBanner=()=>null,AppSidebar=()=>null,LeadRealtimeBus=()=>null,WhatsAppRealtimeBus=()=>null,OnlineUsersPanel=()=>null,FloatingChatButton=()=>null,FloatingChat=()=>null,WebPushPrompt=()=>null,SetupGuideDialog=()=>null,SetupGuideTour=()=>null;
const AppHeader=()=> <header style={{height:56,flexShrink:0}}>Agenda sintética</header>;
const MobileBottomNav=()=> <nav aria-label="Navegação móvel" style={{position:'fixed',bottom:0,width:'100%',height:64}}>Menu</nav>;
export ${layout.getText(ast)}
`);
  await writeFile(path.join(directory, "image.tsx"), "import React from 'react'; export default function Image({src,alt,width,height,...props}){return <img alt={alt} width={width} height={height} {...props}/>}");
  await writeFile(path.join(directory, "fixture.tsx"), `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Download} from 'lucide-react';
import {PwaActionPrompt} from '@/components/features/pwa/PwaActionPrompt';
import {AppLayoutContent} from './layout';
function Fixture(){
 const[visible,setVisible]=useState(false),[notifications,setNotifications]=useState(false),[locked,setLocked]=useState(false),[description,setDescription]=useState('Acesso rápido');
 window.fixturePrompt=setVisible;window.fixtureNotifications=setNotifications;window.fixtureLocked=setLocked;window.fixtureDescription=setDescription;
 const list=<div style={{height:2400,display:'flex',flexDirection:'column',justifyContent:'space-between'}}><p>Atividades de teste</p><button onClick={()=>window.fixtureLastClicks++}>Última atividade</button></div>;
 return <><AppLayoutContent title="Agenda" disableMainScroll={locked}>{locked?<div data-agenda-list style={{height:'100%',overflowY:'auto'}}>{list}</div>:list}</AppLayoutContent>{visible&&<PwaActionPrompt title="Instalar Vimob" description={description} actionLabel="Instalar" actionIcon={Download} onAction={()=>window.fixtureActions++} onDismiss={()=>{window.fixtureDismissals++;setVisible(false)}} ariaLabel="Aviso de instalação do Vimob" promptKind="install"/>}{notifications&&<PwaActionPrompt title="Ativar notificações" description="Receba os lembretes da agenda e acompanhe todas as próximas atividades pelo navegador." actionLabel="Ativar" actionIcon={Download} onAction={()=>window.fixtureActions++} onDismiss={()=>setNotifications(false)} ariaLabel="Aviso de notificações do Vimob" promptKind="notifications"/>}</>;
}
window.fixtureLastClicks=0;window.fixtureActions=0;window.fixtureDismissals=0;
localStorage.setItem('pwa-install-prompt-dismissed','preferência original');
createRoot(document.getElementById('app')).render(<Fixture/>);
`);
  await writeFile(path.join(directory, "loader.cjs"), `const ts=require(${JSON.stringify(path.join(root, "node_modules/typescript"))});module.exports=source=>ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;`);
  const { webpack } = require("next/dist/compiled/webpack/webpack");
  await new Promise((resolve, reject) => {
    const compiler = webpack({
      mode: "development", target: "web", devtool: false,
      entry: path.join(directory, "fixture.tsx"),
      output: { path: directory, filename: "fixture.js" },
      plugins: [new webpack.DefinePlugin({ "process.env.NODE_ENV": JSON.stringify("development") })],
      resolve: {
        extensions: [".tsx", ".ts", ".js"],
        alias: { "@": root, "next/image$": path.join(directory, "image.tsx"), "lucide-react$": require.resolve("lucide-react") },
        modules: [path.join(root, "node_modules"), "node_modules"],
      },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(directory, "loader.cjs") }] },
    });
    compiler.run((error, stats) => compiler.close(() => error || stats?.hasErrors()
      ? reject(error || Error(stats.toString({ all: false, errors: true }))) : resolve()));
  });
  const cssSource = (await readFile(path.join(root, "app/globals.css"), "utf8")).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);');
  const sources = ["components/features/pwa", "components/shared/layout/AppLayout.tsx", "components/ui/button.tsx"];
  const css = await require("postcss")([require("@tailwindcss/postcss")({ base: root })]).process(
    `${cssSource}\n${sources.map(source => `@source "${path.join(root, source).replaceAll("\\", "/")}";`).join("\n")}`,
    { from: path.join(root, "app/pwa-fixture.css") },
  );
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => route.request().url() === "https://pwa-fixture.local/"
    ? route.fulfill({ contentType: "text/html", body: `<style>${css.css}</style><div id="app"></div>` }) : route.abort());
  await page.goto("https://pwa-fixture.local/");
  await page.addScriptTag({ content: await readFile(path.join(directory, "fixture.js"), "utf8") });
  await expect(page.getByRole("button", { name: "Última atividade" })).toBeAttached();
});

after(async () => {
  await browser?.close();
  if (directory) {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.match(path.basename(directory), /^vimob-pwa-layout-/);
    await rm(directory, { recursive: true, force: true });
  }
});

async function scrollToLast(locked) {
  await page.locator(locked ? "[data-agenda-list]" : "main").evaluate(element => { element.scrollTop = element.scrollHeight; });
}

for (const [width, height] of [[1762, 957], [390, 844]]) {
  for (const locked of [false, true]) test(`PWA preserves the last row with ${locked ? 'Agenda' : 'main'} scrolling at ${width}x${height}`, async () => {
    await page.setViewportSize({ width, height });
    await page.evaluate(locked => {
      window.fixturePrompt(false);
      window.fixtureLocked(locked);
      window.fixtureLastClicks = 0;
      window.fixtureDismissals = 0;
    }, locked);
    await expect(page.locator("main")).toHaveAttribute("data-main-scroll", locked ? "locked" : "scroll");
    const baseline = await page.locator("main").evaluate(element => getComputedStyle(element).paddingBottom);
    await page.evaluate(() => window.fixturePrompt(true));
    const prompt = page.getByRole("region", { name: "Aviso de instalação do Vimob" });
    await expect(prompt).toBeVisible();
    await expect.poll(() => page.locator("main").evaluate(element => parseFloat(getComputedStyle(element).paddingBottom))).toBeGreaterThan(parseFloat(baseline));
    await scrollToLast(locked);
    const last = page.getByRole("button", { name: "Última atividade" });
    const lastBox = await last.boundingBox(), promptBox = await prompt.boundingBox();
    assert.ok(lastBox.y + lastBox.height <= promptBox.y, "last action remains above the banner");
    await last.click();
    assert.ok(await page.evaluate(() => window.fixtureLastClicks) > 0);
    assert.equal(await page.evaluate(() => window.fixtureDismissals), 0);
    assert.equal(await page.evaluate(() => localStorage.getItem('pwa-install-prompt-dismissed')), 'preferência original');
    if (process.env.VIMOB_PWA_PROOF_DIR) {
      await mkdir(process.env.VIMOB_PWA_PROOF_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.VIMOB_PWA_PROOF_DIR, `pwa-${width}-${locked ? 'agenda' : 'main'}.png`) });
    }
    await page.getByRole("button", { name: "Fechar aviso de instalação do vimob" }).click();
    await expect(prompt).toHaveCount(0);
    await expect.poll(() => page.locator("main").evaluate(element => getComputedStyle(element).paddingBottom)).toBe(baseline);
  });
}

test("PWA reserve follows banner height and a mobile to desktop resize", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { window.fixtureDescription('Acesso rápido'); window.fixturePrompt(true); });
  const prompt = page.getByRole("region", { name: "Aviso de instalação do Vimob" });
  await expect(prompt).toBeVisible();
  const original = await page.locator("main").evaluate(element => parseFloat(getComputedStyle(element).paddingBottom));
  await page.evaluate(() => window.fixtureDescription('Acesse a agenda, suas atividades e todas as outras funções direto na tela inicial do seu celular.'));
  await expect.poll(() => page.locator("main").evaluate(element => parseFloat(getComputedStyle(element).paddingBottom))).toBeGreaterThan(original);
  await page.setViewportSize({ width: 1762, height: 957 });
  await expect.poll(() => page.locator("main").evaluate(element => parseFloat(getComputedStyle(element).paddingBottom))).toBeLessThan(original);
  await page.evaluate(() => window.fixturePrompt(false));
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--vimob-pwa-prompt-space'))).toBe('');
  assert.deepEqual(errors, []);
});

for (const removed of ["install", "notifications"]) {
  test(`PWA reserve survives removing ${removed} while the other prompt remains`, async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      window.fixturePrompt(false);
      window.fixtureNotifications(false);
      window.fixtureDescription('Acesso rápido');
    });
    await expect(page.locator('[data-pwa-prompt]')).toHaveCount(0);
    await page.evaluate(() => window.fixturePrompt(true));
    await expect(page.locator('[data-pwa-prompt="install"]')).toBeVisible();
    await page.evaluate(() => window.fixtureNotifications(true));
    await expect(page.locator('[data-pwa-prompt]')).toHaveCount(2);
    const requiredSpace = () => page.evaluate(() => Math.max(...Array.from(document.querySelectorAll('[data-pwa-prompt]'), prompt => Math.ceil(prompt.offsetHeight + (parseFloat(getComputedStyle(prompt).bottom) || 0) + 12))));
    const reservedSpace = () => page.evaluate(() => document.documentElement.style.getPropertyValue('--vimob-pwa-prompt-space'));
    await expect.poll(reservedSpace).toBe(`${await requiredSpace()}px`);
    await page.evaluate(removed => removed === 'install' ? window.fixturePrompt(false) : window.fixtureNotifications(false), removed);
    await expect(page.locator(`[data-pwa-prompt="${removed}"]`)).toHaveCount(0);
    await expect(page.locator('[data-pwa-prompt]')).toHaveCount(1);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await reservedSpace(), `${await requiredSpace()}px`, 'unmount must retain the surviving prompt reservation');
    assert.equal(await page.evaluate(() => localStorage.getItem('pwa-install-prompt-dismissed')), 'preferência original');
    await page.evaluate(() => { window.fixturePrompt(false); window.fixtureNotifications(false); });
    await expect(page.locator('[data-pwa-prompt]')).toHaveCount(0);
    await expect.poll(reservedSpace).toBe('');
    assert.deepEqual(errors, []);
  });
}
