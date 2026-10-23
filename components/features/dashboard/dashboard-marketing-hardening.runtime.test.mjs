import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const root = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../../..");
const require = createRequire(import.meta.url);

function renderDashboardMarketing(kind, state, mediaState = {}) {
  const cache = new Map();
  function load(relativePath) {
    const path = resolve(root, relativePath);
    if (cache.has(path)) return cache.get(path).exports;
    const compiledModule = { exports: {} };
    cache.set(path, compiledModule);
    const source = ts.transpileModule(readFileSync(path, "utf8"), {
      fileName: path,
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const imports = (specifier) => {
      if (specifier === "@/hooks/use-dashboard-campaigns") return { useDashboardCampaigns: () => state };
      if (specifier === "@/hooks/use-dashboard-creatives") return { useDashboardCreatives: () => state };
      if (specifier === "@/hooks/use-dashboard-creative-media") return { useDashboardCreativeMedia: () => mediaState };
      if (specifier === "@/lib/api/dashboard") return { getDashboardFiltersQueryKey: (filters) => filters };
      if (specifier === "next/image") return function MockNextImage(props) {
        const imageProps = { ...props };
        delete imageProps.fill;
        delete imageProps.unoptimized;
        delete imageProps.quality;
        return React.createElement("img", imageProps);
      };
      if (specifier.startsWith("@/components/")) {
        const base = specifier.slice(2);
        const extension = /(?:model|display|url|error|optimization)$/.test(base) ? ".ts" : ".tsx";
        return load(base + extension);
      }
      if (specifier.startsWith("@/lib/")) return load(specifier.slice(2) + ".ts");
      return require(specifier);
    };
    new Function("require", "module", "exports", source)(imports, compiledModule, compiledModule.exports);
    return compiledModule.exports;
  }
  const name = kind === "campaign" ? "CampaignLeadsChart" : "TopCreativesCard";
  const component = load(`components/features/dashboard/${name}.tsx`)[name];
  return renderToStaticMarkup(React.createElement(component, { filters: {}, filtersReady: true }));
}

const campaignData = {
  campaigns: Array.from({ length: 334 }, (_, index) => ({ key: `id:${index}`, campaignId: `${index}`, name: `Campanha reservada ${index}`, leadCount: 334 - index, entryCount: 334 - index })),
  unattributed: { leadCount: 7, entryCount: 8 },
};
const creativeData = { creatives: [{ key: "creative:123", creativeId: "123", adId: "456", name: "Criativo reservado", campaignName: "Campanha reservada", campaignCount: 1, leadCount: 22, entryCount: 25, attributionLevel: "creative", thumbnailUrl: "https://scontent.fbcdn.net/image.jpg", imageUrl: null, videoUrl: null, instagramUrl: null, permalinkUrl: null, isVideo: false }] };

for (const [kind, data] of [["campaign", campaignData], ["creative", creativeData]]) {
  for (const status of [401, 403]) {
    test(`${kind} removes cached names, counters and links after HTTP ${status}`, () => {
      const html = renderDashboardMarketing(kind, { data, isPending: false, isError: true, error: { status }, refetch: () => {} });
      assert.doesNotMatch(html, /Campanha reservada|Criativo reservado|role="listitem"|Top 1|Sem campanha:/);
      assert.match(html, /sessão expirou|acesso aos indicadores/);
    });
  }
  test(`${kind} identifies retained data during a transient service failure`, () => {
    const html = renderDashboardMarketing(kind, { data, isPending: false, isError: true, error: { status: 503 }, refetch: () => {} });
    assert.match(html, /Exibindo a última consulta/);
    assert.match(html, /reservad/);
  });
}

test("334 campaign aggregates render only 25 accessible rows and preserve the full count", () => {
  const html = renderDashboardMarketing("campaign", { data: campaignData, isPending: false, isError: false, refetch: () => {} });
  assert.equal((html.match(/role="listitem"/g) ?? []).length, 25);
  assert.match(html, /334.*campanhas/);
  assert.match(html, /1–25 de 334/);
  assert.match(html, /Buscar campanha pelo nome ou ID/);
});

for (const error of [{ status: 401 }, { status: 403 }, { status: 503, code: 'session_check_unavailable' }]) {
  test(`denied media refresh ${error.code ?? error.status} hides retained names, numbers and URLs`, () => {
    const html = renderDashboardMarketing("creative", { data: creativeData, isPending: false, isError: false, refetch: () => {} }, { data: { thumbnailUrl: "https://scontent.fbcdn.net/private.jpg" }, isError: true, error });
    assert.doesNotMatch(html, /fbcdn\.net|<img|Visualizar imagem|Criativo reservado|Campanha reservada|1º lugar/);
    assert.doesNotMatch(html.replace(/<[^>]+>/g, ' '), /\b22\b|\b25\b/);
    assert.match(html, /Tentar novamente/);
  });
}

test('a transient media failure keeps ranking data with an explicit notice', () => {
  const html = renderDashboardMarketing("creative", { data: creativeData, isPending: false, isError: false, refetch: () => {} }, { data: { thumbnailUrl: "https://scontent.fbcdn.net/cached.jpg" }, isError: true, error: { status: 503 } });
  assert.match(html, /Criativo reservado|Campanha reservada/);
  assert.match(html, /Exibindo os dados do ranking/);
  assert.match(html, /22/);
});

test("lead and team cache invalidation includes creative rankings and refreshed media", () => {
  for (const relative of ["contexts/LeadRealtimeBus.tsx", "contexts/BackendRealtimeBus.tsx", "hooks/use-teams.ts"]) {
    const source = readFileSync(resolve(root, relative), "utf8");
    const array = source.match(/const (?:LEAD_LIST_QUERY_KEYS|DASHBOARD_REALTIME_QUERY_KEYS|TEAM_SCOPE_DEPENDENT_QUERY_KEYS) = (\[[\s\S]*?\]) as const/);
    assert.ok(array, relative);
    const keys = new Function(`return ${array[1]}`)();
    assert.ok(keys.includes("dashboard-creatives"), relative);
    assert.ok(keys.includes("dashboard-creative-media"), relative);
  }
});
