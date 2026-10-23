import assert from "node:assert/strict";
import { after, before, beforeEach, afterEach, test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let temporaryDirectory;
let browser;
let page;
const browserErrors = [];

// The provider and all three queries are real. Authentication and API responses
// are synthetic; every browser request is blocked, and no server is started.
const synthetic = `
import React, { createContext, useContext, useState } from "react";
const Auth = createContext(null);
const initial = {
  organizationId: "10000000-0000-4000-8000-000000000001",
  userId: "20000000-0000-4000-8000-000000000001",
  memberRole: "admin", permissions: ["properties_view", "automations_view"],
  enabledModules: ["properties", "automations"], isTeamLeader: true,
  ledTeamIds: ["team-a"], ledUserIds: ["user-a"], ledPipelineIds: ["pipeline-a"],
  isSuperAdmin: false, impersonatedOrganizationId: null,
  propertyEditPolicy: "responsible_or_admin", propertyOwnerContactVisibility: "hidden",
};
export function SyntheticAuth({ children }) {
  const [access, setAccess] = useState(initial);
  window.fixtureSetAccess = patch => setAccess(current => ({ ...current, ...patch }));
  window.fixtureAccess = access;
  return <Auth.Provider value={{
    user: access.userId ? { id: access.userId } : null,
    profile: { id: initial.userId },
    organization: { property_edit_policy: access.propertyEditPolicy, property_owner_contact_visibility: access.propertyOwnerContactVisibility },
    activeOrganization: { organizationId: access.organizationId },
    tenantContext: { memberRole: access.memberRole, permissions: access.permissions, enabledModules: access.enabledModules, isTeamLeader: access.isTeamLeader, ledTeamIds: access.ledTeamIds, ledUserIds: access.ledUserIds, ledPipelineIds: access.ledPipelineIds, isSuperAdmin: access.isSuperAdmin },
    isSuperAdmin: access.isSuperAdmin,
    impersonating: access.impersonatedOrganizationId ? { orgId: access.impersonatedOrganizationId } : null,
  }}>{children}</Auth.Provider>;
}
export const useAuth = () => useContext(Auth);
export const useOptionalActiveOrganizationId = () => useAuth().activeOrganization.organizationId || undefined;
export const useOrganizationModules = () => {
  const auth = useAuth();
  return { hasModule: name => Boolean(auth.activeOrganization.organizationId && auth.tenantContext.enabledModules.includes(name)) };
};
export const useWhatsAppQueryScope = () => ({ organizationId: useOptionalActiveOrganizationId(), userId: useAuth().user?.id, accessSignature: "synthetic" });
window.fixturePending = [];
window.fixtureRequests = [];
window.fixtureDefer = false;
window.fixtureResolveAll = () => window.fixturePending.splice(0).forEach(resolve => resolve());
async function response(kind, organizationId, filters) {
  const access = { ...window.fixtureAccess };
  window.fixtureRequests.push({ kind, organizationId, filters, access });
  if (window.fixtureDefer) await new Promise(resolve => window.fixturePending.push(resolve));
  return { id: kind + ":" + organizationId, organization_id: organizationId, fixtureAccess: access, fixtureFilters: filters, status: "completed" };
}
export const propertiesAPI = {
  getProperties: async (organizationId, filters) => ({ data: [await response("property", organizationId, filters)], count: 100, error: null }),
};
export const automationsAPI = {
  listExecutions: async ({ organizationId, ...filters }) => [await response("execution", organizationId, filters)],
};
export const getNonEmptyErrorMessageOrFallback = () => "synthetic error";
export const stringifyErrorMessage = String;
export const saveAutomationFlowInputSchema = {};
export const enforceClientActionRateLimit = () => {};
export const getClientRateLimitMessage = () => "";
export const parseDomainInput = (_, value) => value;
export const parseNumericFilter = value => value ? Number(value) : undefined;
export const propertyCreateInputSchema = {};
export const propertyUpdateInputSchema = {};
`;

const fixture = `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { useQueryClient } from "@tanstack/react-query";
import { QueryProvider } from "@/components/providers/query-provider";
import { useProperties, useInfiniteProperties } from "@/hooks/use-properties";
import { useAutomationExecutions } from "@/hooks/use-automations";
import { FilterProvider, useFilters } from "@/contexts/FilterContext";
import { SyntheticAuth } from "./synthetic";
const clients = new WeakMap();
let nextClient = 0;
function result(query, rows) {
  return { placeholder: query.isPlaceholderData, pending: query.isPending, loading: query.isLoading, fetching: query.isFetching, rows };
}
function Lists() {
  const shared = useFilters();
  window.fixtureSharedFilters = shared;
  const [filters, setFilters] = useState({ search: "", scope: undefined, pageSize: 24, offset: 0, status: undefined });
  window.fixtureSetFilters = patch => setFilters(current => ({ ...current, ...patch }));
  const client = useQueryClient();
  if (!clients.has(client)) clients.set(client, ++nextClient);
  window.fixtureCacheKeys = () => client.getQueryCache().getAll().map(query => query.queryKey);
  window.fixtureInvalidate = () => Promise.all(["properties", "properties-infinite", "automation-executions"].map(key => client.invalidateQueries({ queryKey: [key] })));
  const list = useProperties(filters.search, { scope: filters.scope });
  const infinite = useInfiniteProperties(filters.search, filters.pageSize, { scope: filters.scope });
  const executions = useAutomationExecutions(undefined, 50, { offset: filters.offset, status: filters.status });
  window.fixtureFetchNextPage = () => infinite.fetchNextPage();
  window.fixtureResult = {
    access: window.fixtureAccess, client: clients.get(client), filters,
    shared: { hydrated: shared.isHydrated, search: shared.searchQuery, source: shared.source },
    list: result(list, list.data),
    infinite: { ...result(infinite, infinite.data?.pages.flatMap(page => page.properties)), pages: infinite.data?.pages.length, fetchingNext: infinite.isFetchingNextPage },
    executions: result(executions, executions.data),
  };
  return <output>{JSON.stringify(window.fixtureResult)}</output>;
}
createRoot(document.getElementById("app")).render(<SyntheticAuth><QueryProvider><FilterProvider><Lists /></FilterProvider></QueryProvider></SyntheticAuth>);
`;

before(async () => {
  temporaryDirectory = await mkdtemp(path.join(tmpdir(), "vimob-tenant-placeholder-"));
  const stub = path.join(temporaryDirectory, "synthetic.tsx");
  const entry = path.join(temporaryDirectory, "fixture.tsx");
  const loader = path.join(temporaryDirectory, "loader.cjs");
  await Promise.all([
    writeFile(stub, synthetic),
    writeFile(entry, fixture),
    writeFile(loader, `const ts = require(${JSON.stringify(path.join(root, "node_modules/typescript"))}); module.exports = source => ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;`),
  ]);
  const aliases = Object.fromEntries([
    "contexts/AuthContext", "hooks/use-active-organization", "hooks/use-organization-modules",
    "hooks/use-whatsapp-query-scope", "lib/api/properties", "lib/api/automations",
    "lib/api/vimob-error", "lib/client-action-rate-limit", "lib/validation",
  ].map(name => [`@/${name}$`, stub]));
  const { webpack } = require("next/dist/compiled/webpack/webpack");
  await new Promise((resolve, reject) => {
    const compiler = webpack({
      mode: "development", target: "web", devtool: false, entry,
      output: { path: temporaryDirectory, filename: "bundle.js" },
      resolve: { extensions: [".tsx", ".ts", ".js"], alias: { ...aliases, "./AuthContext$": stub, "@": root }, modules: [path.join(root, "node_modules"), "node_modules"] },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] },
    });
    compiler.run((error, stats) => compiler.close(() => {
      if (error || stats.hasErrors()) reject(error ?? new Error(stats.toString({ all: false, errors: true })));
      else resolve();
    }));
  });
  browser = await chromium.launch({ headless: true });
});

beforeEach(async () => {
  page = await browser.newPage();
  page.on("pageerror", error => browserErrors.push(error.message));
  await page.route("**/*", route => route.abort());
  // Use an inert origin so the real FilterProvider can exercise sessionStorage.
  await page.unroute("**/*");
  await page.route("https://tenant-placeholder.invalid/", route => route.fulfill({ contentType: "text/html", body: '<div id="app"></div>' }));
  await page.route("**/*", route => route.request().url() === "https://tenant-placeholder.invalid/" ? route.fallback() : route.abort());
  await page.goto("https://tenant-placeholder.invalid/");
  await page.addScriptTag({ content: await readFile(path.join(temporaryDirectory, "bundle.js"), "utf8") });
  await page.waitForFunction(() => window.fixtureResult?.shared.hydrated && ["list", "infinite", "executions"].every(key => window.fixtureResult[key].rows?.length && !window.fixtureResult[key].fetching));
});

afterEach(async () => { await page?.close(); });
after(async () => {
  await browser?.close();
  if (temporaryDirectory) {
    const target = path.resolve(temporaryDirectory);
    assert.equal(path.dirname(target), path.resolve(tmpdir()));
    assert(path.basename(target).startsWith("vimob-tenant-placeholder-"));
    await rm(target, { recursive: true, force: true });
  }
  assert.deepEqual(browserErrors, []);
});

const queryNames = ["list", "infinite", "executions"];

async function changeAccess(patch) {
  const before = await page.evaluate(() => window.fixtureResult);
  await page.evaluate(patch => { window.fixtureDefer = true; window.fixtureSetAccess(patch); }, patch);
  await page.waitForFunction(patch => Object.entries(patch).every(([key, value]) => JSON.stringify(window.fixtureResult.access[key]) === JSON.stringify(value)), patch);
  const during = await page.evaluate(() => window.fixtureResult);
  for (const name of queryNames) {
    if (name !== "list" || during.access.enabledModules.includes("properties")) {
      assert.equal(during[name].placeholder, false, `${name} reused a placeholder from the previous scope`);
    }
    assert.deepEqual(during[name].rows ?? [], [], `${name} exposed rows from the previous scope`);
  }
  return { before, during };
}

test("organization A -> B clears all three observers before the response", async () => {
  const { before, during } = await changeAccess({ organizationId: "10000000-0000-4000-8000-000000000002" });
  assert.notEqual(before.client, during.client);
  await page.waitForFunction(() => window.fixturePending.length === 3);
  await page.evaluate(() => { window.fixtureDefer = false; window.fixtureResolveAll(); });
  await page.waitForFunction(() => ["list", "infinite", "executions"].every(key => window.fixtureResult[key].rows?.[0]?.organization_id.endsWith("2") && !window.fixtureResult[key].placeholder));
});

for (const [label, patch] of [
  ["user", { userId: "20000000-0000-4000-8000-000000000002" }],
  ["role", { memberRole: "member" }],
  ["permissions", { permissions: ["properties_view_own"] }],
  ["modules", { enabledModules: ["automations"] }],
  ["team visibility", { ledTeamIds: ["team-b"], ledUserIds: ["user-b"], ledPipelineIds: ["pipeline-b"] }],
  ["leadership", { isTeamLeader: false }],
  ["super admin", { isSuperAdmin: true }],
  ["impersonation", { impersonatedOrganizationId: "10000000-0000-4000-8000-000000000002" }],
  ["property policy", { propertyEditPolicy: "everyone", propertyOwnerContactVisibility: "visible" }],
]) {
  test(`${label} changes within the same organization clear previous rows`, async () => {
    const { before, during } = await changeAccess(patch);
    assert.notEqual(before.client, during.client);
  });
}

test("sign out clears rows even while the old profile is still present", async () => {
  await changeAccess({ userId: null });
});

test("same-scope filters, page size and execution offset preserve previous rows", async () => {
  const before = await page.evaluate(() => window.fixtureResult);
  await page.evaluate(() => {
    window.fixtureDefer = true;
    window.fixtureSetFilters({ search: "casa", scope: "own", pageSize: 12, offset: 50, status: "completed" });
  });
  await page.waitForFunction(() => window.fixtureResult.filters.search === "casa" && window.fixturePending.length === 3);
  const during = await page.evaluate(() => window.fixtureResult);
  assert.equal(during.client, before.client);
  for (const name of queryNames) {
    assert.equal(during[name].placeholder, true);
    assert.deepEqual(during[name].rows, before[name].rows);
  }
  await page.evaluate(() => { window.fixtureDefer = false; window.fixtureResolveAll(); });
  await page.waitForFunction(() => window.fixtureResult.list.rows?.[0]?.fixtureFilters.search === "casa" && window.fixtureResult.infinite.rows?.[0]?.fixtureFilters.limit === 12 && window.fixtureResult.executions.rows?.[0]?.fixtureFilters.offset === 50);
  const after = await page.evaluate(() => window.fixtureResult);
  for (const name of queryNames) assert.equal(after[name].placeholder, false);
});

test("same-scope next page retains loaded properties while fetching", async () => {
  const before = await page.evaluate(() => window.fixtureResult);
  await page.evaluate(() => { window.fixtureDefer = true; void window.fixtureFetchNextPage(); });
  await page.waitForFunction(() => window.fixtureResult.infinite.fetchingNext && window.fixturePending.length === 1);
  const during = await page.evaluate(() => window.fixtureResult);
  assert.deepEqual(during.infinite.rows, before.infinite.rows);
  assert.equal(during.infinite.placeholder, false);
  await page.evaluate(() => { window.fixtureDefer = false; window.fixtureResolveAll(); });
  await page.waitForFunction(() => window.fixtureResult.infinite.pages === 2 && !window.fixtureResult.infinite.fetchingNext);
  assert.equal((await page.evaluate(() => window.fixtureResult.infinite.rows)).length, 2);
});

test("filters after a tenant transition still retain only that tenant's data", async () => {
  await changeAccess({ organizationId: "10000000-0000-4000-8000-000000000002" });
  await page.waitForFunction(() => window.fixturePending.length === 3);
  await page.evaluate(() => { window.fixtureDefer = false; window.fixtureResolveAll(); });
  await page.waitForFunction(names => names.every(key => window.fixtureResult[key].rows?.[0]?.organization_id.endsWith("2")), queryNames);
  await page.evaluate(() => { window.fixtureDefer = true; window.fixtureSetFilters({ search: "apartamento", offset: 100 }); });
  await page.waitForFunction(() => window.fixturePending.length === 3);
  const during = await page.evaluate(() => window.fixtureResult);
  for (const name of queryNames) {
    assert.equal(during[name].placeholder, true);
    assert.equal(during[name].rows[0].organization_id, "10000000-0000-4000-8000-000000000002");
  }
});

test("invalidation through the new provider refetches all three tenant B queries", async () => {
  await changeAccess({ organizationId: "10000000-0000-4000-8000-000000000002" });
  await page.waitForFunction(() => window.fixturePending.length === 3);
  await page.evaluate(() => { window.fixtureDefer = false; window.fixtureResolveAll(); });
  await page.waitForFunction(names => names.every(key => window.fixtureResult[key].rows?.[0]?.organization_id.endsWith("2") && !window.fixtureResult[key].fetching), queryNames);
  const cacheKeys = await page.evaluate(() => window.fixtureCacheKeys());
  assert.equal(cacheKeys.filter(key => queryNames.some(name => ({ list: "properties", infinite: "properties-infinite", executions: "automation-executions" })[name] === key[0]) && key.includes("10000000-0000-4000-8000-000000000002")).length, 3);
  const before = await page.evaluate(() => window.fixtureRequests.length);
  await page.evaluate(() => window.fixtureInvalidate());
  const after = await page.evaluate(() => window.fixtureRequests.slice(-3));
  assert.equal(await page.evaluate(() => window.fixtureRequests.length), before + 3);
  assert(after.every(request => request.organizationId.endsWith("2")));
});

test("A -> B -> A restores shared filters only from each user's organization session", async () => {
  await page.evaluate(() => { window.fixtureSharedFilters.setSearchQuery("Busca A"); window.fixtureSharedFilters.setSource("manual"); });
  await page.waitForFunction(() => window.fixtureResult.shared.search === "Busca A");
  await changeAccess({ organizationId: "10000000-0000-4000-8000-000000000002" });
  await page.waitForFunction(() => window.fixtureResult.shared.hydrated);
  assert.deepEqual((await page.evaluate(() => window.fixtureResult)).shared, { hydrated: true, search: "", source: null });
  await page.evaluate(() => { window.fixtureDefer = false; window.fixtureResolveAll(); window.fixtureSharedFilters.setSearchQuery("Busca B"); window.fixtureSharedFilters.setSource("meta"); });
  await page.waitForFunction(() => window.fixtureResult.shared.search === "Busca B" && window.fixtureResult.list.rows?.[0]?.organization_id.endsWith("2"));
  await changeAccess({ organizationId: "10000000-0000-4000-8000-000000000001" });
  await page.waitForFunction(() => window.fixtureResult.shared.hydrated);
  assert.deepEqual((await page.evaluate(() => window.fixtureResult)).shared, { hydrated: true, search: "Busca A", source: "manual" });
  await page.waitForFunction(() => window.fixturePending.length === 3);
  await page.evaluate(() => { window.fixtureDefer = false; window.fixtureResolveAll(); });
  await page.waitForFunction(names => names.every(key => window.fixtureResult[key].rows?.[0]?.organization_id.endsWith("1")), queryNames);
});

test("shared session filters survive a role change within the same organization", async () => {
  await page.evaluate(() => { window.fixtureSharedFilters.setSearchQuery("Busca preservada"); window.fixtureSharedFilters.setSource("manual"); });
  await page.waitForFunction(() => window.fixtureResult.shared.search === "Busca preservada");
  await changeAccess({ memberRole: "member" });
  await page.waitForFunction(() => window.fixtureResult.shared.hydrated);
  assert.deepEqual((await page.evaluate(() => window.fixtureResult)).shared, { hydrated: true, search: "Busca preservada", source: "manual" });
});

test("user A -> B -> A keeps shared session filters isolated within one organization", async () => {
  await page.evaluate(() => window.fixtureSharedFilters.setSearchQuery("Busca usuário A"));
  await page.waitForFunction(() => window.fixtureResult.shared.search === "Busca usuário A");
  await changeAccess({ userId: "20000000-0000-4000-8000-000000000002" });
  await page.waitForFunction(() => window.fixtureResult.shared.hydrated);
  assert.equal((await page.evaluate(() => window.fixtureResult)).shared.search, "");
  await page.evaluate(() => { window.fixtureDefer = false; window.fixtureResolveAll(); window.fixtureSharedFilters.setSearchQuery("Busca usuário B"); });
  await page.waitForFunction(() => window.fixtureResult.shared.search === "Busca usuário B" && window.fixtureResult.list.rows?.[0]?.fixtureAccess.userId.endsWith("2"));
  await changeAccess({ userId: "20000000-0000-4000-8000-000000000001" });
  await page.waitForFunction(() => window.fixtureResult.shared.hydrated);
  assert.equal((await page.evaluate(() => window.fixtureResult)).shared.search, "Busca usuário A");
});
