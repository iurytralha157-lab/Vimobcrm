import assert from "node:assert/strict";
import { before, after, beforeEach, afterEach, test } from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const orgA = "10000000-0000-4000-8000-000000000001";
const orgB = "10000000-0000-4000-8000-000000000002";
const userId = "20000000-0000-4000-8000-000000000001";
const origin = "https://filter-state-concurrency.invalid/";
let directory, browser, context, bundle;
const pageErrors = [];

// Real providers, filter context and session storage; only identity is
// synthetic. All network is intercepted, with no server or database involved.
const identity = `
import React, { createContext, useContext, useState } from "react";
const Auth = createContext(null);
export function SyntheticAuth({ children }) {
  const [access, setAccess] = useState({ userId: "${userId}", organizationId: "${orgA}", memberRole: "admin", permissions: ["*"] });
  window.access = access; window.setAccess = patch => setAccess(old => ({ ...old, ...patch }));
  return <Auth.Provider value={{ user: { id: access.userId }, profile: { id: access.userId }, organization: {},
    activeOrganization: { organizationId: access.organizationId }, isSuperAdmin: false,
    tenantContext: { ...access, enabledModules: ["crm", "dashboard"], isSuperAdmin: false } }}>{children}</Auth.Provider>;
}
export const useAuth = () => useContext(Auth);
export function useWhatsAppQueryScope() { const auth = useAuth(); return { organizationId: auth.activeOrganization.organizationId, userId: auth.user.id, accessSignature: "fixture" }; }
`;
const fixture = `
import React from "react";
import { createRoot } from "react-dom/client";
import { useQueryClient } from "@tanstack/react-query";
import { SyntheticAuth } from "./identity";
import { QueryProvider } from "@/components/providers/query-provider";
import { FilterProvider, useFilters } from "@/contexts/FilterContext";
import { sharedFilterSnapshotSchema } from "@/lib/validation/shared-filter-presets";
const empty = sharedFilterSnapshotSchema.parse({ version: 2 });
if (window.initialHash) history.replaceState(null, "", window.initialHash);
if (window.initialSession && !sessionStorage.getItem("vimob_period_filter_${userId}_${orgA}")) sessionStorage.setItem("vimob_period_filter_${userId}_${orgA}", JSON.stringify({ ...empty, ...window.initialSession }));
const clients = new WeakMap(); let nextClient = 0;
function Screen() {
  const filters = useFilters(), client = useQueryClient();
  if (!clients.has(client)) clients.set(client, ++nextClient);
  window.filters = filters;
  window.latest = { hydrated: filters.isHydrated, revision: filters.filterApplicationRevision, snapshot: filters.getFilterSnapshot(), client: clients.get(client), access: window.access };
  return <pre>{JSON.stringify(window.latest)}</pre>;
}
function IsolatedScreen() {
  const filters = useFilters();
  window.isolatedFilters = filters;
  return <output hidden>{JSON.stringify(filters.getFilterSnapshot())}</output>;
}
createRoot(document.getElementById("app")).render(<React.StrictMode><SyntheticAuth><QueryProvider><FilterProvider><Screen /></FilterProvider></QueryProvider><FilterProvider><IsolatedScreen /></FilterProvider></SyntheticAuth></React.StrictMode>);
`;

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "vimob-filter-state-concurrency-"));
  await writeFile(path.join(directory, "identity.tsx"), identity);
  await writeFile(path.join(directory, "fixture.tsx"), fixture);
  await writeFile(path.join(directory, "loader.cjs"), `const ts = require(${JSON.stringify(require.resolve("typescript"))}); module.exports = function(source) { return ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText; };`);
  const { webpack } = require("next/dist/compiled/webpack/webpack");
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode: "development", target: "web", devtool: false,
      entry: path.join(directory, "fixture.tsx"), output: { path: directory, filename: "bundle.js" },
      resolve: { extensions: [".tsx", ".ts", ".js"], modules: [path.join(root, "node_modules"), "node_modules"],
        alias: { "@/contexts/AuthContext$": path.join(directory, "identity.tsx"), "./AuthContext$": path.join(directory, "identity.tsx"), "@/hooks/use-whatsapp-query-scope$": path.join(directory, "identity.tsx"), "@": root } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(directory, "loader.cjs") }] } });
    compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors()
      ? reject(error || new Error(stats.toString({ all: false, errors: true }))) : resolve()));
  });
  bundle = await readFile(path.join(directory, "bundle.js"), "utf8");
  browser = await chromium.launch({ headless: true });
});
beforeEach(async () => { context = await browser.newContext({ timezoneId: "America/Sao_Paulo" }); pageErrors.length = 0; });
afterEach(async () => { await context.close(); assert.deepEqual(pageErrors, []); });
after(async () => {
  await browser?.close();
  if (directory && path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(directory).startsWith("vimob-filter-state-concurrency-")) await rm(directory, { recursive: true, force: true });
});

async function openPage(seed = {}) {
  const page = await context.newPage();
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.addInitScript(seed => Object.assign(window, seed), seed);
  await page.route("**/*", route => route.request().url() === origin
    ? route.fulfill({ contentType: "text/html", body: '<div id="app"></div>' }) : route.abort());
  await page.goto(origin);
  await page.addScriptTag({ content: bundle });
  await page.waitForFunction(() => window.latest?.hydrated);
  return page;
}
async function changeAccess(page, patch) {
  const client = await page.evaluate(() => window.latest.client);
  await page.evaluate(patch => window.setAccess(patch), patch);
  await page.waitForFunction(client => window.latest.hydrated && window.latest.client !== client, client);
}

const obsoleteHash = '#filters=' + encodeURIComponent(JSON.stringify({
  organizationId: orgA, version: 2, source: 'manual', campaignIds: [], tagIds: [],
  datePreset: null, customDateRange: null, pipelineId: null, teamId: null, userId: null,
  pageId: null, adSetId: null, adId: null, dealStatus: null,
}));

test("obsolete saved filters are ignored and refresh starts empty", async () => {
  const page = await openPage({ initialSession: { source: "meta", searchQuery: "Busca privada" }, initialHash: obsoleteHash });
  assert.equal(await page.evaluate(() => window.latest.snapshot.source), null);
  assert.equal(await page.evaluate(() => window.latest.snapshot.searchQuery), "");
  await page.evaluate(() => { window.filters.setSource("website"); window.filters.setSearchQuery("Temporary"); });
  assert.equal(await page.evaluate(() => window.latest.snapshot.source), "website");
  const stored = await page.evaluate(() => JSON.stringify(Object.entries(sessionStorage)));
  await page.reload(); await page.addScriptTag({ content: bundle });
  await page.waitForFunction(() => window.latest?.hydrated);
  assert.equal(await page.evaluate(() => window.latest.snapshot.source), null);
  assert.equal(await page.evaluate(() => window.latest.snapshot.searchQuery), "");
  assert.equal(await page.evaluate(() => JSON.stringify(Object.entries(sessionStorage))), stored);
});

test("filters remain in memory across route changes in the same mounted provider", async () => {
  const page = await openPage();
  await page.evaluate(() => { window.filters.setSource("meta"); window.filters.setSearchQuery("Navegação atual"); });
  for (const route of ['/crm/pipelines', '/contacts', '/conversations', '/dashboard']) {
    await page.evaluate(route => { history.pushState(null, '', route); window.setAccess({}); }, route);
    assert.equal(await page.evaluate(() => window.latest.snapshot.source), "meta");
    assert.equal(await page.evaluate(() => window.latest.snapshot.searchQuery), "Navegação atual");
  }
  assert.equal(await page.evaluate(() => sessionStorage.length), 0);
  assert.equal(await page.evaluate(() => localStorage.length), 0);
});

test("role and permission remounts discard previous in-memory criteria", async () => {
  const page = await openPage();
  await page.evaluate(() => { window.filters.setSource("meta"); window.filters.setSearchQuery("Edição anterior"); });
  await changeAccess(page, { memberRole: "member", permissions: ["lead_view_own"] });
  assert.equal(await page.evaluate(() => window.latest.snapshot.source), null);
  assert.equal(await page.evaluate(() => window.latest.snapshot.searchQuery), "");
});

test("A to B to A always starts with empty criteria instead of restoring an organization's session", async () => {
  const page = await openPage();
  await page.evaluate(() => { window.filters.setSource("meta"); window.filters.setSearchQuery("Sessão A"); });
  await changeAccess(page, { organizationId: orgB });
  assert.equal(await page.evaluate(() => window.latest.snapshot.source), null);
  await page.evaluate(() => { window.filters.setSource("website"); window.filters.setSearchQuery("Sessão B"); });
  await changeAccess(page, { organizationId: orgA });
  assert.equal(await page.evaluate(() => window.latest.snapshot.source), null);
  assert.equal(await page.evaluate(() => window.latest.snapshot.searchQuery), "");
});

test("changing actor and returning never restores either actor's criteria", async () => {
  const page = await openPage();
  await page.evaluate(() => { window.filters.setSource("meta"); window.filters.setSearchQuery("Somente ator A"); });
  await changeAccess(page, { userId: "20000000-0000-4000-8000-000000000002" });
  assert.equal(await page.evaluate(() => window.latest.snapshot.source), null);
  await page.evaluate(() => window.filters.setSource("website"));
  await changeAccess(page, { userId });
  assert.equal(await page.evaluate(() => window.latest.snapshot.source), null);
  assert.equal(await page.evaluate(() => window.latest.snapshot.searchQuery), "");
});

test("native hash changes and browser history cannot apply obsolete shared filters", async () => {
  const page = await openPage();
  await page.evaluate(() => window.filters.setSource("meta"));
  const revision = await page.evaluate(() => window.latest.revision);
  await page.evaluate(hash => { window.location.hash = hash; }, obsoleteHash);
  await page.waitForURL(url => url.hash === obsoleteHash);
  await page.evaluate(() => { window.location.hash = '#filters=obsolete-second'; });
  await page.goBack();
  assert.equal(await page.evaluate(() => window.latest.snapshot.source), "meta");
  assert.equal(await page.evaluate(() => window.latest.revision), revision);
  await page.evaluate(() => window.filters.clearFilters());
  await changeAccess(page, { permissions: ["lead_view_own"] });
  assert.equal(await page.evaluate(() => window.latest.snapshot.source), null);
  await page.goForward();
  assert.equal(await page.evaluate(() => window.latest.snapshot.source), null);
});

test("blocked session storage leaves filters usable in memory without throwing", async () => {
  const page = await openPage();
  await page.evaluate(() => {
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
    Storage.prototype.getItem = function(key) { if (this === sessionStorage) throw new DOMException("Synthetic denial", "SecurityError"); return get.call(this, key); };
    Storage.prototype.setItem = function(key, value) { if (this === sessionStorage) throw new DOMException("Synthetic quota", "QuotaExceededError"); return set.call(this, key, value); };
    window.filters.setSource("meta"); window.filters.setSearchQuery("Memória atual");
  });
  assert.equal(await page.evaluate(() => window.latest.snapshot.source), "meta");
  assert.equal(await page.evaluate(() => window.latest.snapshot.searchQuery), "Memória atual");
  await page.evaluate(() => window.filters.clearFilters());
  assert.equal(await page.evaluate(() => window.latest.snapshot.source), null);
});

test("full snapshot applications remain atomic and reject invalid criteria", async () => {
  const page = await openPage();
  const snapshot = await page.evaluate(() => ({ ...window.latest.snapshot, source: "manual", searchQuery: "Critério válido", campaignId: "campaign-a", campaignIds: ["campaign-a"], adSetId: "set-a", adId: "ad-a" }));
  const revision = await page.evaluate(() => window.latest.revision);
  assert.equal(await page.evaluate(snapshot => window.filters.restoreFilterSnapshot(snapshot), snapshot), true);
  await page.waitForFunction(revision => window.latest.revision > revision, revision);
  assert.deepEqual(await page.evaluate(() => window.latest.snapshot), snapshot);
  assert.equal(await page.evaluate(snapshot => window.filters.restoreFilterSnapshot({ ...snapshot, searchQuery: 'x'.repeat(181) }), snapshot), false);
  assert.deepEqual(await page.evaluate(() => window.latest.snapshot), snapshot);
});

test("the provider itself isolates user and organization even without a QueryProvider remount", async () => {
  const page = await openPage();
  await page.evaluate(() => window.isolatedFilters.setSource('private-a'));
  assert.equal(await page.evaluate(() => window.isolatedFilters.source), 'private-a');
  await changeAccess(page, { organizationId: orgB });
  assert.equal(await page.evaluate(() => window.isolatedFilters.source), null);
  await page.evaluate(() => window.isolatedFilters.setSource('private-b'));
  await changeAccess(page, { organizationId: orgA });
  assert.equal(await page.evaluate(() => window.isolatedFilters.source), null);
  await page.evaluate(() => window.isolatedFilters.setSource('private-actor'));
  await changeAccess(page, { userId: '20000000-0000-4000-8000-000000000002' });
  assert.equal(await page.evaluate(() => window.isolatedFilters.source), null);
});
