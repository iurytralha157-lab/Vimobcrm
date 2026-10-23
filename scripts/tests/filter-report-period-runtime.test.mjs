import assert from "node:assert/strict";
import { before, after, beforeEach, afterEach, test } from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const organizationId = "10000000-0000-4000-8000-000000000001";
const userId = "20000000-0000-4000-8000-000000000001";
const validRange = { from: "2026-10-01T03:00:00.000Z", to: "2026-10-13T02:59:59.999Z" };
const longRange = { from: "2010-01-01T03:00:00.000Z", to: "2026-10-13T02:59:59.999Z" };
let directory;
let browser;
let page;
const browserErrors = [];

// Provider, filters, report hooks and notice are real. Only identity and API
// responses are synthetic; no server or database is used and all network is blocked.
const synthetic = `
export const useAuth = () => ({ user: { id: "${userId}" }, profile: { id: "${userId}" }, activeOrganization: { organizationId: "${organizationId}" }, organization: {}, isSuperAdmin: true,
  tenantContext: { organizationId: "${organizationId}", memberRole: "admin", permissions: ["*"], enabledModules: ["crm", "dashboard"], isSuperAdmin: true } });
export const useWhatsAppQueryScope = () => ({ organizationId: "${organizationId}", userId: "${userId}", accessSignature: "synthetic" });
export const useUserPermissions = () => ({ hasPermission: () => true, isLoading: false });
export const useTeams = () => ({ data: [], isSuccess: true, isFetching: false, isError: false, dataUpdatedAt: 1, refetch: async () => ({ data: [] }) });
export const useTags = useTeams;
window.reportRequests = [];
window.reportHoldMetadata = false;
window.reportMetadataPending = [];
window.reportReleaseMetadata = () => window.reportMetadataPending.splice(0).forEach(resolve => resolve());
export const contactsAPI = { listPage: async (filters, organizationId) => {
  window.reportRequests.push({ kind: "contacts", filters, organizationId });
  return { data: [{ id: "synthetic-contact", name: "Contato sintético", organization_id: organizationId, source: filters.source, fixtureFilters: filters, total_count: 1 }], total: 1 };
} };
export const getLeadMetaFilters = async filters => {
  window.reportRequests.push({ kind: "metadata", filters: JSON.parse(JSON.stringify(filters)) });
  if (window.reportHoldMetadata) await new Promise(resolve => window.reportMetadataPending.push(resolve));
  return { sources: ["manual"], pages: [], campaigns: [], adsets: [], ads: [] };
};
`;

const fixture = `
import React, { useLayoutEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { useQueryClient } from "@tanstack/react-query";
import { QueryProvider } from "@/components/providers/query-provider";
import { FilterProvider, useFilters } from "@/contexts/FilterContext";
import { useContactsList } from "@/hooks/use-contacts-list";
import { useSharedFilters } from "@/hooks/use-shared-filters";
import { MAX_SHARED_REPORT_RANGE_DAYS } from "@/lib/filters/date-range-limits";
import { FilterPeriodNotice } from "@/components/shared/filters/FilterPeriodNotice";
function Report() {
  const context = useFilters();
  const client = useQueryClient();
  const [limited, setLimited] = useState(true);
  const shared = useSharedFilters({ multiCampaigns: true, dateRangeMaxDays: limited ? MAX_SHARED_REPORT_RANGE_DAYS : undefined });
  const filters = useMemo(() => ({ source: context.source || undefined, search: context.searchQuery, page: 1, limit: 10,
    createdFrom: context.activeDateRange?.from.toISOString(), createdTo: context.activeDateRange?.to.toISOString() }), [context.source, context.searchQuery, context.activeDateRange]);
  const contacts = useContactsList(filters, { enabled: context.isHydrated });
  window.reportContext = context;
  window.reportShared = shared;
  window.reportContacts = contacts;
  window.reportSetLimited = setLimited;
  window.reportSeedContacts = data => client.setQueryData(["contacts-list", "${organizationId}", "${userId}", filters], { data, total: data.length });
  window.reportReadContactCache = () => client.getQueryData(["contacts-list", "${organizationId}", "${userId}", filters]);
  window.reportSeedMetadata = data => {
    const query = client.getQueryCache().getAll().find(query => query.queryKey[0] === "shared-filter-lead-meta-filters" && query.getObserversCount() > 0);
    if (!query) throw new Error("The metadata observer is missing");
    client.setQueryData(query.queryKey, data);
  };
  window.reportResult = {
    hydrated: context.isHydrated, snapshot: context.getFilterSnapshot(), limited,
    contacts: { data: contacts.data, total: contacts.total, placeholder: contacts.isPlaceholderData, periodError: contacts.periodError, fetching: contacts.isFetching, error: contacts.error?.message },
    metadata: { sources: shared.dynamicSources, pages: shared.pages, campaigns: shared.campaigns, adSets: shared.adSets, ads: shared.ads, periodError: shared.periodError, fetching: shared.isLoadingSources },
  };
  return <>{contacts.periodError && <FilterPeriodNotice message={contacts.periodError} onClear={context.clearDateFilter} />}<output>{JSON.stringify(window.reportResult)}</output></>;
}
function InitializeReport() {
  const context = useFilters();
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    if (ready) return;
    context.restoreFilterSnapshot({ ...context.getFilterSnapshot(), datePreset: "custom", customDateRange: ${JSON.stringify(validRange)}, source: "manual", searchQuery: "Busca preservada" });
    setReady(true);
  }, [context, ready]);
  return ready ? <Report /> : null;
}
createRoot(document.getElementById("app")).render(<QueryProvider><FilterProvider><InitializeReport /></FilterProvider></QueryProvider>);
`;

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "vimob-report-period-"));
  const stub = path.join(directory, "synthetic.tsx");
  const entry = path.join(directory, "fixture.tsx");
  const loader = path.join(directory, "loader.cjs");
  await Promise.all([
    writeFile(stub, synthetic), writeFile(entry, fixture),
    writeFile(loader, `const ts = require(${JSON.stringify(path.join(root, "node_modules/typescript"))}); module.exports = source => ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;`),
  ]);
  const aliases = Object.fromEntries([
    "contexts/AuthContext", "hooks/use-whatsapp-query-scope", "hooks/use-user-permissions",
    "hooks/use-tags", "hooks/use-teams", "lib/api/contacts", "lib/api/pipeline-board",
  ].map(name => [`@/${name}$`, stub]));
  const { webpack } = require("next/dist/compiled/webpack/webpack");
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode: "development", target: "web", devtool: false, entry,
      output: { path: directory, filename: "bundle.js" },
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
  page = await browser.newPage({ timezoneId: "America/Sao_Paulo" });
  page.on("pageerror", error => browserErrors.push(error.message));
  await page.route("**/*", route => route.request().url() === "https://report-period.invalid/"
    ? route.fulfill({ contentType: "text/html", body: '<div id="app"></div>' }) : route.abort());
  await page.goto("https://report-period.invalid/");
  await page.addScriptTag({ content: await readFile(path.join(directory, "bundle.js"), "utf8") });
  await page.waitForFunction(() => window.reportResult?.hydrated && window.reportResult.contacts.data?.length && window.reportResult.metadata.sources.length && !window.reportResult.contacts.fetching && !window.reportResult.metadata.fetching);
});
afterEach(async () => { await page?.close(); });
after(async () => {
  await browser?.close();
  if (directory) {
    const target = path.resolve(directory);
    assert.equal(path.dirname(target), path.resolve(tmpdir()));
    assert(path.basename(target).startsWith("vimob-report-period-"));
    await rm(target, { recursive: true, force: true });
  }
  assert.deepEqual(browserErrors, []);
});

async function applyRange(range) {
  assert.equal(await page.evaluate(range => window.reportContext.restoreFilterSnapshot({ ...window.reportContext.getFilterSnapshot(), datePreset: "custom", customDateRange: range }), range), true);
  await page.waitForFunction(() => Boolean(window.reportResult.contacts.periodError));
  // Let both observers install their latest options before invoking manual refetch.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function blockedRefetches() {
  return page.evaluate(async () => {
    const results = await Promise.allSettled([
      window.reportContacts.refetch({ throwOnError: true }),
      window.reportShared.refetchLeadMetaFilters({ throwOnError: true }),
    ]);
    return results.map(result => ({ status: result.status, message: result.status === "rejected" ? result.reason.message : null }));
  });
}

test("valid periods reach both real hooks' synthetic transports", async () => {
  const requests = await page.evaluate(() => window.reportRequests);
  assert.equal(requests.filter(request => request.kind === "contacts").length, 1);
  assert.equal(requests.filter(request => request.kind === "metadata").length, 1);
  assert.equal(requests[0].kind === "contacts" ? requests[0].filters.createdFrom : requests[0].filters.dateRange.from, validRange.from);
  const result = await page.evaluate(() => window.reportResult);
  assert.equal(result.contacts.periodError, null);
  assert.equal(result.contacts.total, 1);
  assert.equal(result.metadata.periodError, null);
});

test("an inherited snapshot blocks automatic queries and manual refetch before transport", async () => {
  const count = await page.evaluate(() => window.reportRequests.length);
  await applyRange(longRange);
  const result = await page.evaluate(() => window.reportResult);
  assert.match(result.contacts.periodError, /até cinco anos/);
  assert.match(result.metadata.periodError, /até cinco anos/);
  assert.equal(result.contacts.data, undefined);
  assert.equal(result.contacts.placeholder, false);
  assert.deepEqual(result.metadata.sources, []);
  const refetches = await blockedRefetches();
  for (const refetch of refetches) {
    assert.equal(refetch.status, "rejected");
    assert.match(refetch.message, /até cinco anos/);
  }
  assert.equal(await page.evaluate(() => window.reportRequests.length), count);
});

test("contacts hide both previous records and cached records for an invalid period", async () => {
  const count = await page.evaluate(() => window.reportRequests.length);
  await applyRange(longRange);
  await page.evaluate(() => window.reportSeedContacts([{ id: "cached-invalid-period" }]));
  await page.waitForFunction(() => window.reportReadContactCache()?.data?.[0]?.id === "cached-invalid-period");
  assert.equal(await page.evaluate(() => window.reportResult.contacts.data), undefined);
  assert.equal(await page.evaluate(() => window.reportResult.contacts.total), undefined);
  assert.equal(await page.evaluate(() => window.reportResult.contacts.placeholder), false);
  await blockedRefetches();
  assert.equal(await page.evaluate(() => window.reportRequests.length), count);
});

test("the real period notice clears only dates and resumes queries with source and search", async () => {
  await applyRange(longRange);
  await expect(page.getByRole("alert")).toContainText("Ajuste o período");
  const count = await page.evaluate(() => window.reportRequests.length);
  await page.getByRole("button", { name: "Limpar período", exact: true }).click();
  await page.waitForFunction(() => !window.reportResult.contacts.periodError && !window.reportResult.metadata.periodError && window.reportResult.contacts.data?.length && !window.reportResult.contacts.fetching && !window.reportResult.metadata.fetching);
  const snapshot = await page.evaluate(() => window.reportResult.snapshot);
  assert.equal(snapshot.datePreset, null);
  assert.equal(snapshot.customDateRange, null);
  assert.equal(snapshot.source, "manual");
  assert.equal(snapshot.searchQuery, "Busca preservada");
  const requests = await page.evaluate(count => window.reportRequests.slice(count), count);
  assert.equal(requests.length, 2);
  const contact = requests.find(request => request.kind === "contacts");
  assert.equal(contact.filters.source, "manual");
  assert.equal(contact.filters.search, "Busca preservada");
  assert.equal(contact.filters.createdFrom, undefined);
  assert.equal(requests.find(request => request.kind === "metadata").filters.dateRange, null);
});

test("restoring a prior snapshot reapplies the overlong period and blocks transport again", async () => {
  await applyRange(longRange);
  const snapshot = await page.evaluate(() => window.reportContext.getFilterSnapshot());
  await page.getByRole("button", { name: "Limpar período", exact: true }).click();
  await page.waitForFunction(() => !window.reportResult.contacts.periodError && !window.reportResult.metadata.fetching && !window.reportResult.contacts.fetching);
  const count = await page.evaluate(() => window.reportRequests.length);
  assert.equal(await page.evaluate(snapshot => window.reportContext.restoreFilterSnapshot(snapshot), snapshot), true);
  await page.waitForFunction(() => Boolean(window.reportResult.contacts.periodError));
  assert.deepEqual(await page.evaluate(() => window.reportResult.snapshot.customDateRange), longRange);
  await blockedRefetches();
  assert.equal(await page.evaluate(() => window.reportRequests.length), count);
});

test("unbounded shared metadata remains available for Pipeline and WhatsApp semantics", async () => {
  await applyRange(longRange);
  const count = await page.evaluate(() => window.reportRequests.length);
  await page.evaluate(() => window.reportSetLimited(false));
  await page.waitForFunction(() => !window.reportResult.metadata.periodError && window.reportResult.metadata.sources.length && !window.reportResult.metadata.fetching);
  const requests = await page.evaluate(count => window.reportRequests.slice(count), count);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].kind, "metadata");
  assert.deepEqual(requests[0].filters.dateRange, longRange);
  assert.equal(await page.evaluate(() => window.reportResult.contacts.data), undefined);
});

test("reapplying the report bound hides metadata previously cached by an unbounded observer", async () => {
  await applyRange(longRange);
  await page.evaluate(() => window.reportSetLimited(false));
  await page.waitForFunction(() => window.reportResult.metadata.sources.length && !window.reportResult.metadata.fetching);
  const count = await page.evaluate(() => window.reportRequests.length);
  await page.evaluate(() => window.reportSetLimited(true));
  await page.waitForFunction(() => Boolean(window.reportResult.metadata.periodError));
  assert.deepEqual(await page.evaluate(() => window.reportResult.metadata.sources), []);
  await blockedRefetches();
  assert.equal(await page.evaluate(() => window.reportRequests.length), count);
});

test("a bounded observer masks every metadata collection even if its current cache is prefilled", async () => {
  await applyRange(longRange);
  const count = await page.evaluate(() => window.reportRequests.length);
  await page.evaluate(() => window.reportSeedMetadata({
    sources: ["cached-source"], pages: [{ id: "cached-page", name: "Página cache" }],
    campaigns: [{ id: "cached-campaign", name: "Campanha cache" }],
    adsets: [{ id: "cached-adset", name: "Conjunto cache", campaignId: "cached-campaign" }],
    ads: [{ id: "cached-ad", name: "Anúncio cache", campaignId: "cached-campaign", adsetId: "cached-adset" }],
  }));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const metadata = await page.evaluate(() => window.reportResult.metadata);
  for (const field of ["sources", "pages", "campaigns", "adSets", "ads"]) assert.deepEqual(metadata[field], []);
  await blockedRefetches();
  assert.equal(await page.evaluate(() => window.reportRequests.length), count);
});

test("bounded refetch rejects before an unbounded in-flight response is released", async () => {
  await applyRange(longRange);
  await page.evaluate(() => { window.reportHoldMetadata = true; window.reportSetLimited(false); });
  await page.waitForFunction(() => window.reportMetadataPending.length === 1 && window.reportResult.metadata.fetching);
  const count = await page.evaluate(() => window.reportRequests.length);
  await page.evaluate(() => window.reportSetLimited(true));
  await page.waitForFunction(() => Boolean(window.reportResult.metadata.periodError));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const result = await page.evaluate(async () => {
    const refetch = window.reportShared.refetchLeadMetaFilters({ throwOnError: true })
      .then(() => ({ status: "fulfilled" }), error => ({ status: "rejected", message: error.message }));
    const beforeRelease = await Promise.race([refetch, new Promise(resolve => setTimeout(() => resolve({ status: "pending" }), 100))]);
    window.reportReleaseMetadata();
    return { beforeRelease, completed: await refetch };
  });
  assert.equal(result.beforeRelease.status, "rejected");
  assert.match(result.beforeRelease.message, /até cinco anos/);
  assert.equal(result.completed.status, "rejected");
  assert.equal(await page.evaluate(() => window.reportRequests.length), count);
});
