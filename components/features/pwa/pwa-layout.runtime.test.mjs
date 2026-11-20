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
let directory, browser, page, cdp;
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
const MobileBottomNav=()=> <nav aria-label="Navegação móvel" className="fixed bottom-0 left-0 right-0 z-50 pb-[env(safe-area-inset-bottom)]"><div style={{height:64}}>Menu</div></nav>;
export ${layout.getText(ast)}
`);
  await writeFile(path.join(directory, "image.tsx"), "import React from 'react'; export default function Image({src,alt,width,height,...props}){return <img alt={alt} width={width} height={height} {...props}/>}");
  await writeFile(path.join(directory, "pwa-hooks.ts"), `
export const WEB_PUSH_PROMPT_DISMISS_KEY='fixture-web-push-dismissed';
export const useWebPush=()=>({isSupported:true,isSubscribed:false,isOptedOut:false,isLoading:false,isReady:true,configurationStatus:'available',permission:'default',subscribe:async()=>({ok:true})});
export const useInstallPrompt=()=>({showPrompt:true,isIOS:false,isStandalone:false,canInstall:true,install:async()=>true,dismiss:()=>window.fixtureInstallDismiss()});
export const useAuth=()=>({user:{id:'synthetic-pwa-user'}});
export const Capacitor={isNativePlatform:()=>false};
export const toast={success:()=>{},error:()=>{}};
export const usePathname=()=>'/agenda';
`);
  await writeFile(path.join(directory, "fixture.tsx"), `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Download} from 'lucide-react';
import {PwaActionPrompt} from '@/components/features/pwa/PwaActionPrompt';
import {InstallPrompt} from '@/components/features/pwa/InstallPrompt';
import {WebPushPrompt} from '@/components/features/pwa/WebPushPrompt';
import {AppLayoutContent} from './layout';
function Fixture() {
  const [visible, setVisible] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const [locked, setLocked] = useState(false);
  const [description, setDescription] = useState('Acesso rápido');
  const [chat, setChat] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [coordination, setCoordination] = useState(null);
  const [coordinatedInstall, setCoordinatedInstall] = useState(true);

  window.fixturePrompt = setVisible;
  window.fixtureNotifications = setNotifications;
  window.fixtureLocked = setLocked;
  window.fixtureDescription = setDescription;
  window.fixtureChat = setChat;
  window.fixtureDisabled = setDisabled;
  window.fixtureCoordinating = value => {
    setCoordinatedInstall(true);
    setCoordination(value);
  };
  window.fixtureInstallDismiss = () => setCoordinatedInstall(false);

  const list = (
    <div style={{ height: 2400, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
      <p>Atividades de teste</p>
      <button onClick={() => window.fixtureLastClicks++}>Última atividade</button>
    </div>
  );

  return <>
    <AppLayoutContent title="Agenda" disableMainScroll={locked}>
      {locked ? <div data-agenda-list style={{ height: '100%', overflowY: 'auto' }}>{list}</div> : list}
    </AppLayoutContent>
    <div data-pwa-clipping-parent style={{ position: 'fixed', top: 0, left: 0, width: 1, height: 1, transform: 'translateZ(0)', overflow: 'hidden' }}>
      {visible && <PwaActionPrompt
        title="Instalar Vimob"
        description={description}
        actionLabel="Instalar"
        actionIcon={Download}
        onAction={() => window.fixtureActions++}
        onDismiss={() => { window.fixtureDismissals++; setVisible(false); }}
        actionDisabled={disabled}
        dismissDisabled={disabled}
        ariaLabel="Aviso de instalação do Vimob"
        promptKind="install"
      />}
      {notifications && <PwaActionPrompt
        title="Ativar notificações"
        description="Receba os lembretes da agenda e acompanhe todas as próximas atividades pelo navegador."
        actionLabel="Ativar"
        actionIcon={Download}
        onAction={() => window.fixtureActions++}
        onDismiss={() => { window.fixtureDismissals++; setNotifications(false); }}
        ariaLabel="Aviso de notificações do Vimob"
        promptKind="notifications"
      />}
    </div>
    {chat && <div data-floating-chat-parking={chat === 'parked' ? '' : undefined} hidden={chat === 'parked'}>
      <div
        id="floating-whatsapp-chat"
        data-chat-surface
        hidden={chat === 'hidden'}
        style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: window.innerWidth < 768 ? '100%' : 420, zIndex: 50, background: '#123' }}
      >
        <button style={{ position: 'absolute', bottom: 20, right: 20 }}>Compositor do chat</button>
      </div>
    </div>}
    {coordination === 'install-first' ? <>
      {coordinatedInstall && <InstallPrompt />}
      <WebPushPrompt />
    </> : coordination === 'push-first' ? <>
      <WebPushPrompt />
      {coordinatedInstall && <InstallPrompt />}
    </> : null}
  </>;
}
window.fixtureLastClicks = 0;
window.fixtureActions = 0;
window.fixtureDismissals = 0;
window.fixtureVisibilityEvents = [];
addEventListener('vimob:pwa-install-prompt-visibility', event => {
  window.fixtureVisibilityEvents.push({
    visible: event.detail.visible,
    portalExists: Boolean(document.querySelector('[data-pwa-prompt="install"]')),
  });
});
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
        alias: {
          "@/hooks/use-web-push$": path.join(directory, "pwa-hooks.ts"),
          "@/hooks/use-install-prompt$": path.join(directory, "pwa-hooks.ts"),
          "@/contexts/AuthContext$": path.join(directory, "pwa-hooks.ts"),
          "@capacitor/core$": path.join(directory, "pwa-hooks.ts"),
          "sonner$": path.join(directory, "pwa-hooks.ts"),
          "next/navigation$": path.join(directory, "pwa-hooks.ts"),
          "@": root,
          "next/image$": path.join(directory, "image.tsx"),
          "lucide-react$": require.resolve("lucide-react"),
        },
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
  cdp = await page.context().newCDPSession(page);
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => route.request().url() === "https://pwa-fixture.local/"
    ? route.fulfill({ contentType: "text/html", body: `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>${css.css}</style><div id="app"></div>` }) : route.abort());
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

async function layoutMetrics(locked) {
  return page.evaluate(locked => {
    const main = document.querySelector('main');
    const scroller = locked ? document.querySelector('[data-agenda-list]') : main;
    const box = main.getBoundingClientRect();
    return {
      mainBox: { x: box.x, y: box.y, width: box.width, height: box.height },
      paddingBottom: getComputedStyle(main).paddingBottom,
      scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight,
      bodyHeight: document.body.scrollHeight,
    };
  }, locked);
}

for (const [width, height] of [[1762, 957], [390, 844]]) {
  for (const locked of [false, true]) for (const kind of ['install', 'notifications']) test(`PWA ${kind} overlays without moving ${locked ? 'Agenda' : 'main'} at ${width}x${height}`, async () => {
    await page.setViewportSize({ width, height });
    await page.evaluate(locked => {
      window.fixturePrompt(false);
      window.fixtureNotifications(false);
      window.fixtureChat(false);
      window.fixtureDisabled(false);
      window.fixtureLocked(locked);
      window.fixtureDismissals = 0;
      window.fixtureActions = 0;
    }, locked);
    await expect(page.locator("main")).toHaveAttribute("data-main-scroll", locked ? "locked" : "scroll");
    await expect(page.getByRole('navigation', { name: 'Navegação móvel' })).toHaveCount(width < 768 ? 1 : 0);
    await scrollToLast(locked);
    const baseline = await layoutMetrics(locked);
    await page.evaluate(kind => kind === 'install' ? window.fixturePrompt(true) : window.fixtureNotifications(true), kind);
    const outer = page.locator(`[data-pwa-prompt="${kind}"]`);
    const prompt = outer.getByRole('region');
    await expect(prompt).toBeVisible();
    assert.equal(await outer.evaluate(element => element.parentElement === document.body), true, 'portal escapes clipped/transformed layout ancestors');
    assert.deepEqual(await outer.evaluate(element => ({ position: getComputedStyle(element).position, zIndex: getComputedStyle(element).zIndex })), { position: 'fixed', zIndex: '40' });
    await expect.poll(() => layoutMetrics(locked)).toEqual(baseline);
    await expect.poll(() => outer.evaluate(element => Math.round(innerHeight - element.getBoundingClientRect().bottom))).toBe(width < 768 ? 76 : 16);
    const box = await outer.boundingBox();
    assert.ok(box.x >= 12 && box.x + box.width <= width - 12, 'horizontal viewport clearance');
    if (width < 768) {
      const nav = await page.getByRole('navigation', { name: 'Navegação móvel' }).boundingBox();
      assert.ok(box.y + box.height <= nav.y - 12, 'prompt stays above bottom navigation');
    }
    await prompt.getByRole('button', { name: kind === 'install' ? 'Instalar' : 'Ativar', exact: true }).click();
    assert.equal(await page.evaluate(() => window.fixtureActions), 1);
    assert.equal(await page.evaluate(() => localStorage.getItem('pwa-install-prompt-dismissed')), 'preferência original');
    if (process.env.VIMOB_PWA_PROOF_DIR) {
      await mkdir(process.env.VIMOB_PWA_PROOF_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.VIMOB_PWA_PROOF_DIR, `pwa-${kind}-${width}-${locked ? 'agenda' : 'main'}.png`) });
    }
    await prompt.getByRole('button', { name: /^Fechar aviso/ }).click();
    await expect(prompt).toHaveCount(0);
    assert.equal(await page.evaluate(() => window.fixtureDismissals), 1);
    await expect.poll(() => layoutMetrics(locked)).toEqual(baseline);
  });
}

test("PWA height changes leave the page unchanged and resize keeps the prompt at the bottom", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { window.fixtureLocked(false); window.fixtureNotifications(false); window.fixtureDescription('Acesso rápido'); window.fixturePrompt(true); });
  const prompt = page.getByRole("region", { name: "Aviso de instalação do Vimob" });
  await expect(prompt).toBeVisible();
  const baseline = await layoutMetrics(false);
  await page.evaluate(() => window.fixtureDescription('Acesse a agenda, suas atividades e todas as outras funções direto na tela inicial do seu celular.'));
  await expect.poll(() => layoutMetrics(false)).toEqual(baseline);
  await page.setViewportSize({ width: 1762, height: 957 });
  await expect.poll(() => prompt.evaluate(element => Math.round(innerHeight - element.getBoundingClientRect().bottom))).toBe(16);
  assert.equal(await page.locator('main').evaluate(element => getComputedStyle(element).paddingBottom), '24px');
  await page.evaluate(() => window.fixturePrompt(false));
  assert.deepEqual(errors, []);
});

for (const removed of ["install", "notifications"]) {
  test(`PWA removing ${removed} preserves the remaining overlay and page geometry`, async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      window.fixturePrompt(false);
      window.fixtureNotifications(false);
      window.fixtureLocked(false);
      window.fixtureDescription('Acesso rápido');
    });
    await expect(page.locator('[data-pwa-prompt]')).toHaveCount(0);
    const baseline = await layoutMetrics(false);
    await page.evaluate(() => window.fixturePrompt(true));
    await expect(page.locator('[data-pwa-prompt="install"]')).toBeVisible();
    await page.evaluate(() => window.fixtureNotifications(true));
    await expect(page.locator('[data-pwa-prompt]')).toHaveCount(2);
    await expect.poll(() => layoutMetrics(false)).toEqual(baseline);
    await page.evaluate(removed => removed === 'install' ? window.fixturePrompt(false) : window.fixtureNotifications(false), removed);
    await expect(page.locator(`[data-pwa-prompt="${removed}"]`)).toHaveCount(0);
    await expect(page.locator('[data-pwa-prompt]')).toHaveCount(1);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.deepEqual(await layoutMetrics(false), baseline);
    assert.equal(await page.evaluate(() => localStorage.getItem('pwa-install-prompt-dismissed')), 'preferência original');
    await page.evaluate(() => { window.fixturePrompt(false); window.fixtureNotifications(false); });
    await expect(page.locator('[data-pwa-prompt]')).toHaveCount(0);
    assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--vimob-pwa-prompt-space')), '');
    assert.deepEqual(errors, []);
  });
}

test('PWA respects browser safe-area insets without reserving layout space', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, bottom: 34, left: 32, right: 24 } });
  try {
    await page.evaluate(() => { window.fixtureLocked(false); window.fixturePrompt(false); window.fixtureNotifications(false); });
    await expect(page.locator('[data-pwa-prompt]')).toHaveCount(0);
    const baseline = await layoutMetrics(false);
    await page.evaluate(() => window.fixturePrompt(true));
    const prompt = page.locator('[data-pwa-prompt="install"]');
    await expect(prompt).toBeVisible();
    await expect.poll(() => prompt.evaluate(element => Math.round(innerHeight - element.getBoundingClientRect().bottom))).toBe(110);
    const box = await prompt.boundingBox();
    assert.ok(box.x >= 32 && box.x + box.width <= 390 - 24);
    assert.deepEqual(await layoutMetrics(false), baseline);
    if (process.env.VIMOB_PWA_PROOF_DIR) {
      await mkdir(process.env.VIMOB_PWA_PROOF_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.VIMOB_PWA_PROOF_DIR, 'pwa-safe-area-390.png') });
    }
  } finally {
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, bottom: 0, left: 0, right: 0 } });
    await page.evaluate(() => window.fixturePrompt(false));
  }
});

for (const width of [1024, 768, 390]) test(`PWA hides inaccessible controls during chat and returns without moving the page at ${width}px`, async () => {
  await page.setViewportSize({ width, height: 844 });
  await page.evaluate(() => { window.fixtureLocked(false); window.fixturePrompt(true); window.fixtureNotifications(false); window.fixtureChat(false); window.fixtureDismissals=0; });
  const prompt = page.locator('[data-pwa-prompt="install"]');
  await expect(prompt).toBeVisible();
  const baseline = await layoutMetrics(false);
  await page.evaluate(() => window.fixtureChat('open'));
  await expect(prompt).toBeHidden();
  await expect(page.locator('[data-chat-surface]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Instalar', exact: true })).toHaveCount(0);
  assert.deepEqual(await layoutMetrics(false), baseline);
  await page.getByRole('button', { name: 'Compositor do chat' }).click();
  await page.evaluate(() => window.fixtureChat('hidden'));
  await expect(prompt).toBeVisible();
  await page.evaluate(() => window.fixtureChat('parked'));
  await expect(prompt).toBeVisible();
  assert.equal(await page.evaluate(() => window.fixtureDismissals), 0);
  assert.deepEqual(await layoutMetrics(false), baseline);
  await page.evaluate(() => { window.fixtureChat(false); window.fixturePrompt(false); });
});

for (const width of [1024, 768]) test(`PWA hides while the desktop team panel is open at ${width}px`, async () => {
  await page.setViewportSize({ width, height: 844 });
  await page.evaluate(() => { window.fixtureLocked(false); window.fixturePrompt(true); window.fixtureNotifications(false); });
  const prompt = page.locator('[data-pwa-prompt="install"]');
  await expect(prompt).toBeVisible();
  const baseline = await layoutMetrics(false);
  await page.evaluate(() => {
    const aside = document.createElement('aside');
    aside.dataset.teamPresencePanel = '';
    aside.setAttribute('aria-hidden', 'false');
    document.body.appendChild(aside);
  });
  try {
    await expect(prompt).toBeHidden();
    await expect(page.getByRole('button', { name: 'Instalar', exact: true })).toHaveCount(0);
    assert.deepEqual(await layoutMetrics(false), baseline);
    await page.locator('[data-team-presence-panel]').evaluate(element => element.setAttribute('aria-hidden', 'true'));
    await expect(prompt).toBeVisible();
    assert.deepEqual(await layoutMetrics(false), baseline);
  } finally {
    await page.locator('[data-team-presence-panel]').evaluate(element => element.remove());
    await page.evaluate(() => window.fixturePrompt(false));
  }
});

test('PWA keeps disabled action and dismiss states', async () => {
  await page.evaluate(() => { window.fixtureDisabled(true); window.fixturePrompt(true); });
  const prompt = page.locator('[data-pwa-prompt="install"]');
  await expect(prompt.getByRole('button', { name: 'Instalar', exact: true })).toBeDisabled();
  await expect(prompt.getByRole('button', { name: /^Fechar aviso/ })).toBeDisabled();
  await page.evaluate(() => { window.fixtureDisabled(false); window.fixturePrompt(false); });
  assert.deepEqual(errors, []);
});

for (const order of ['install-first', 'push-first']) test(`PWA install visibility follows the actual portal before notifications (${order})`, async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(order => {
    window.fixturePrompt(false);
    window.fixtureNotifications(false);
    localStorage.removeItem('fixture-web-push-dismissed');
    window.fixtureVisibilityEvents=[];
    window.fixtureCoordinating(order);
  }, order);
  const install = page.locator('[data-pwa-prompt="install"]');
  await expect(install).toBeVisible();
  await page.waitForTimeout(3250);
  await expect(page.locator('[data-pwa-prompt="notifications"]')).toHaveCount(0);
  assert.ok(await page.evaluate(() => window.fixtureVisibilityEvents.some(event => event.visible)), 'install publishes visibility');
  assert.equal(await page.evaluate(() => window.fixtureVisibilityEvents.some(event => event.visible && !event.portalExists)), false, 'install never publishes before its portal exists');
  await install.getByRole('button', { name: /^Fechar aviso/ }).click();
  await expect(install).toHaveCount(0);
  await expect(page.locator('[data-pwa-prompt="notifications"]')).toBeVisible();
  assert.equal(await page.evaluate(() => window.fixtureVisibilityEvents.at(-1).visible), false);
  await page.locator('[data-pwa-prompt="notifications"]').getByRole('button', { name: /^Fechar aviso/ }).click();
  await page.evaluate(() => window.fixtureCoordinating(null));
  assert.deepEqual(errors, []);
});
