import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

function loadModel(path, modules = {}) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  const exports = {};
  new Function("require", "exports", outputText)((name) => modules[name] ?? {}, exports);
  return exports;
}

const safeMedia = loadModel("../../../lib/analytics/meta-creative-image.ts");
const { collectCreatives } = loadModel("../../../hooks/marketing/use-marketing-dashboard.ts", {
  "@/lib/analytics/meta-creative-image": safeMedia,
});
const { allCreatives, rankPaidCreatives } = loadModel("./marketing-model.ts");
const { MetaCreativePreview } = loadModel("../meta/MetaCreativePreview.tsx", {
  react: React,
  "react/jsx-runtime": jsxRuntime,
  "next/image": ({ fill, unoptimized, ...props }) =>
    React.createElement("img", { ...props, "data-fill": String(fill), "data-optimize": String(!unoptimized) }),
  "@/lib/analytics/meta-creative-image": safeMedia,
  "@/lib/api/meta": { getMetaCreativeDestination: () => null },
  "@/lib/utils": { cn: (...classes) => classes.filter(Boolean).join(" ") },
});

function makeAd(ad_id, { spend, leads_count, cpl, currency = "BRL", thumbnail_url = null, sales_count = null } = {}) {
  return { ad_id, ad_name: ad_id, spend, leads_count, cpl, currency, thumbnail_url, sales_count, qualified_count: 0, won_count: 0 };
}

function collect(ads, media = [], topCreatives = []) {
  const campaigns = [{ campaign_name: "Campanha", adsets: [{ adset_name: "Conjunto", ads }] }];
  return allCreatives({ campaigns, creatives: collectCreatives(campaigns, topCreatives, media, true) });
}

test("apenas criativos reais entram no ranking e o CPL do recorte vem do CRM", () => {
  const creatives = collect([
    makeAd("unattributed", { spend: 0, leads_count: 3, cpl: null, currency: null }),
    makeAd("sem-midia-na-meta", { spend: 0, leads_count: 3, cpl: null, currency: null }),
    makeAd("restrito", { spend: 40, leads_count: 4, cpl: null }),
    makeAd("segundo", { spend: 40, leads_count: 2, cpl: 20 }),
    makeAd("primeiro", { spend: 25, leads_count: 5, cpl: 5, sales_count: 1 }),
  ]);
  assert.equal(creatives.length, 3);
  assert.equal(creatives.find((creative) => creative.ad_id === "restrito").realCpl, null);
  const ranked = rankPaidCreatives(creatives);
  assert.deepEqual(ranked.map((creative) => creative.ad_id), ["primeiro", "segundo"]);
  assert.equal(ranked[0].sales_count, 1);
  assert.equal(ranked[0].won_count, 0);
});

test("a mídia atual prevalece sobre as URLs históricas e a publicação orgânica fica separada", () => {
  const current = "https://scontent.xx.fbcdn.net/current.jpg?oe=abc";
  const previous = "https://scontent.xx.fbcdn.net/previous.jpg?oe=def";
  const creatives = collect(
    [makeAd("101", { leads_count: 2, spend: 20, cpl: 10, thumbnail_url: previous })],
    [
      { id: "paid", ad_id: "101", source_kind: "paid", thumbnail_url: current, metrics: { cpl: 0 } },
      { id: "old", ad_id: "101", source_kind: "paid", thumbnail_url: previous },
      { id: "organic", ad_id: "101", source_kind: "organic" },
    ],
    [{ ad_id: "101", ad_name: "Criativo", thumbnail_url: previous }],
  );
  assert.equal(creatives.length, 2);
  const [ranked] = rankPaidCreatives(creatives);
  assert.equal(ranked.id, "paid");
  assert.equal(ranked.thumbnail_url, current);
  assert.equal(ranked.realCpl, 10);
});

test("a galeria usa a imagem maior do CDN em um quadro sem corte", () => {
  const url = "https://scontent.xx.fbcdn.net";
  const rendered = renderToStaticMarkup(React.createElement(MetaCreativePreview, {
    creative: { name: "Criativo", type: "image", thumbnailUrl: `${url}/thumb.jpg`, creativeUrl: `${url}/full.jpg` },
    optimizeImages: true,
    showAction: false,
    size: "tile",
  }));
  assert.match(rendered, /src="https:\/\/scontent\.xx\.fbcdn\.net\/full\.jpg"/);
  assert.match(rendered, /data-optimize="true"/);
  assert.match(rendered, /class="object-contain"/);
  assert.doesNotMatch(rendered, /thumb\.jpg|aspect-|object-cover/);
});
