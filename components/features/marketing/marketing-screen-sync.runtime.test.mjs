import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const file = new URL("./MarketingScreen.tsx", import.meta.url);
const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
  fileName: "MarketingScreen.tsx",
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    esModuleInterop: true,
  },
});

function renderMarketing(connectionsQuery) {
  const calls = [];
  const syncActions = [];
  const model = {
    canManageIntegration: true,
    canSyncIntegration: true,
    integrationState: { isConnected: true, hasAdAccount: true, hasMarketingToken: true },
    integrationsQuery: { refetch: () => calls.push("legacy-query") },
    insightsQuery: {},
    syncMutation: {},
    dateRange: { from: "2026-11-01", to: "2026-11-22" },
    sync: () => calls.push("legacy-sync"),
  };
  const passthrough = ({ children }) => children;
  const imports = {
    "next/link": ({ children, href, title }) => React.createElement("a", { href, title }, children),
    "@/components/shared/layout/AppLayout": { AppLayout: passthrough },
    "@/components/shared/SharedFilters": { SharedFilters: () => null },
    "@/components/shared/filters/MarketingPeriodNotice": { MarketingPeriodNotice: () => null },
    "@/components/ui/button": {
      Button: ({ asChild, children, disabled, onClick, title }) => {
        if (!disabled && onClick && (title?.startsWith("Sincronizar") || title?.startsWith("Tentar verificar"))) {
          syncActions.push({ title, onClick });
        }
        return asChild ? children : React.createElement("button", { disabled, title }, children);
      },
    },
    "@/components/ui/skeleton": { Skeleton: () => null },
    "@/hooks/marketing": {
      useMarketingDashboard: () => model,
      useMarketingConnections: () => ({ ...connectionsQuery, refetch: () => calls.push("marketing-query") }),
      useMarketingScopeFilters: () => ({}),
      useSyncMarketingConnection: () => ({ mutate: (payload) => calls.push(payload) }),
    },
    "@/hooks/use-dashboard-filters": { getDateRangeFromPreset: () => model.dateRange },
    "@/hooks/use-shared-filters": {
      useSharedFilters: () => ({ filters: {}, campaigns: [], campaignIds: [], pages: [], adSets: [], datePreset: null }),
    },
    "@/hooks/shared/use-relative-date-clock": { useRelativeDateClock: () => null },
    "@/lib/analytics/marketing-dashboard-error": { getMarketingDashboardErrorState: () => ({}) },
    "@/lib/utils": { cn: (...classes) => classes.filter(Boolean).join(" ") },
    "./MarketingDataState": { MarketingDataState: ({ action }) => action },
    "./MarketingScopeFilters": { MarketingScopeFilters: () => null },
    "./MarketingTabViews": { MarketingTabViews: () => null },
    "./marketing-tabs": { MARKETING_TABS: [] },
  };
  const compiledModule = { exports: {} };
  new Function("require", "module", "exports", outputText)(
    (name) => imports[name] ?? require(name), compiledModule, compiledModule.exports,
  );
  const html = renderToStaticMarkup(React.createElement(compiledModule.exports.MarketingScreen, {
    activeTab: "overview", tabHrefs: {},
  }));
  return { html, calls, syncActions };
}

test("a conexão dedicada sem ativos selecionados leva à configuração de Marketing", () => {
  const screen = renderMarketing({ data: { enabled: true, connections: [] } });
  assert.match(screen.html, /href="\/settings\/integrations\/meta-marketing"/);
  assert.doesNotMatch(screen.html, /href="\/settings\/integrations\/meta"/);
  assert.doesNotMatch(screen.html, /Sincronizar período/);
  assert.equal(screen.syncActions.length, 0);
});

test("uma consulta pendente ou com erro não permite sincronizar pela conta de leads", () => {
  const pending = renderMarketing({ isPending: true });
  assert.doesNotMatch(pending.html, /href="\/settings\/integrations\/meta"/);
  assert.equal(pending.syncActions.length, 0);
  const failed = renderMarketing({ isError: true, data: { enabled: false, connections: [] } });
  assert.doesNotMatch(failed.html, /href="\/settings\/integrations\/meta"/);
  assert.equal(failed.syncActions.length, 1);
  failed.syncActions[0].onClick();
  assert.deepEqual(failed.calls, ["marketing-query"]);
});

test("com ativos selecionados, sincroniza o período pela conexão dedicada", () => {
  const screen = renderMarketing({ data: { enabled: true, connections: [
    { id: "marketing-connection", assets: [{ type: "ad_account", is_selected: true }] },
  ] } });
  assert.equal(screen.syncActions.length, 1);
  screen.syncActions[0].onClick();
  assert.deepEqual(screen.calls, [{ connectionId: "marketing-connection", dateStart: "2026-11-01", dateStop: "2026-11-22" }]);
});

test("uma conexão dedicada expirada leva à configuração sem recorrer ao login de leads", () => {
  const screen = renderMarketing({ data: { enabled: true, connections: [
    { id: "expired", status: "expired", assets: [{ type: "ad_account", is_selected: true }] },
  ] } });
  assert.match(screen.html, /href="\/settings\/integrations\/meta-marketing"/);
  assert.doesNotMatch(screen.html, /href="\/settings\/integrations\/meta"/);
  assert.equal(screen.syncActions.length, 0);
});

test("organizações com a conexão dedicada desativada mantêm a sincronização existente", () => {
  const screen = renderMarketing({ data: { enabled: false, connections: [] } });
  assert.match(screen.html, /href="\/settings\/integrations\/meta"/);
  assert.equal(screen.syncActions.length, 1);
  screen.syncActions[0].onClick();
  assert.deepEqual(screen.calls, ["legacy-sync"]);
});
