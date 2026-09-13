import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { stripStalePublicSiteIntegrations } from "../../lib/site/public-site-cache-safety.ts";
import {
  fetchPublicSiteConfiguration,
  PublicSiteUpstreamError,
  resolvePublicSiteAPIBaseURL,
} from "../../supabase/functions/_shared/public-site-api.ts";
import {
  buildPublicSiteHTTPSURL,
  normalizeGoogleSiteVerification,
  normalizePublicHTTPSAssetURL,
  normalizePublicSiteDomain,
  normalizePublicSitePath,
  PublicSiteRequestError,
  publicSiteDomainCandidates,
  readBoundedJSONObject,
} from "../../supabase/functions/_shared/public-site-edge.ts";
import { buildPublicSiteMetadataHTML } from "../../supabase/functions/public-site-ssr/render.ts";

test("public Edge domain and path parsing reject filter and redirect injection", () => {
  assert.equal(normalizePublicSiteDomain(" WWW.Example.COM. "), "www.example.com");
  assert.deepEqual(publicSiteDomainCandidates("www.example.com"), [
    "www.example.com",
    "example.com",
  ]);

  for (const value of [
    "https://example.com",
    "example.com/path",
    "example.com:443",
    "example.com,custom_domain.eq.attacker.example",
    "example.com)or(is_active.eq.true",
    "127.0.0.1",
    "example_com",
  ]) {
    assert.equal(normalizePublicSiteDomain(value), null, value);
  }

  assert.equal(normalizePublicSitePath("/imoveis?q=casa#ignored"), "/imoveis?q=casa");
  for (const value of [
    "javascript:alert(1)",
    "https://attacker.example/",
    "//attacker.example/",
    "/\\attacker.example/",
    "/ok\r\nLocation: https://attacker.example",
  ]) {
    assert.equal(normalizePublicSitePath(value), null, value);
  }

  assert.equal(
    buildPublicSiteHTTPSURL("example.com", "/imoveis?q=casa"),
    "https://example.com/imoveis?q=casa",
  );
});

test("public Edge API lookup uses a bounded, verified canonical contract", async () => {
  assert.equal(
    resolvePublicSiteAPIBaseURL(null, "http://kong:8000"),
    "http://host.docker.internal:8081",
  );
  assert.equal(
    resolvePublicSiteAPIBaseURL(null, "https://supabase.example"),
    "https://api.vimobcrm.com.br",
  );
  assert.throws(
    () => resolvePublicSiteAPIBaseURL("javascript:alert(1)", null),
    PublicSiteUpstreamError,
  );

  const validSite = {
    custom_domain: "example.com",
    domain_verified: true,
    google_search_console_verification: "safe_TOKEN-1234567890",
    is_active: true,
    site_title: "Site",
    subdomain: "agency",
    updated_at: "2026-09-07T00:00:00Z",
  };
  const requestedURLs = [];
  const lookup = await fetchPublicSiteConfiguration(
    "https://api.example.com",
    "example.com",
    async (url, init) => {
      requestedURLs.push(String(url));
      assert.equal(init?.cache, "no-store");
      assert.equal(init?.redirect, "error");
      return Response.json({ found: true, site_config: validSite });
    },
  );
  assert.deepEqual(lookup, validSite);
  assert.deepEqual(requestedURLs, [
    "https://api.example.com/v1/public/site/resolve?domain=example.com",
  ]);

  const unverified = await fetchPublicSiteConfiguration(
    "https://api.example.com",
    "example.com",
    async () =>
      Response.json({
        found: true,
        site_config: { ...validSite, domain_verified: false },
      }),
  );
  assert.equal(unverified, null);

  const mismatched = await fetchPublicSiteConfiguration(
    "https://api.example.com",
    "example.com",
    async () =>
      Response.json({
        found: true,
        site_config: { ...validSite, custom_domain: "attacker.example" },
      }),
  );
  assert.equal(mismatched, null);
});

test("public metadata HTML is static, escaped and emits GSC only on home", () => {
  const site = {
    body_scripts: '<script src="https://attacker.example/body.js"></script>',
    google_search_console_verification: "safe_TOKEN-1234567890",
    gtm_id: "GTM-ATTACK",
    head_scripts: '<script src="https://attacker.example/head.js"></script>',
    meta_pixel_id: "123456789",
    seo_description: 'Casas <script>alert("x")</script>',
    seo_title: '<img src=x onerror="alert(1)">',
  };

  const home = buildPublicSiteMetadataHTML(
    site,
    "Imobiliária",
    "https://example.com/",
    true,
  );
  assert.match(home, /name="google-site-verification" content="safe_TOKEN-1234567890"/);
  assert.match(home, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.doesNotMatch(home, /<script\b/i);
  assert.doesNotMatch(home, /GTM-ATTACK|fbq\(|connect\.facebook|attacker\.example/);

  const innerPage = buildPublicSiteMetadataHTML(
    site,
    "Imobiliária",
    "https://example.com/imoveis",
    false,
  );
  assert.doesNotMatch(innerPage, /google-site-verification/);
  assert.equal(normalizeGoogleSiteVerification('<script>alert(1)</script>'), null);
  assert.equal(normalizePublicHTTPSAssetURL("javascript:alert(1)"), null);
  assert.equal(
    normalizePublicHTTPSAssetURL("https://cdn.example.com/logo.png"),
    "https://cdn.example.com/logo.png",
  );
});

test("worker config body is bounded before JSON parsing", async () => {
  const parsed = await readBoundedJSONObject(
    new Request("https://edge.example/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain: "example.com" }),
    }),
    128,
  );
  assert.deepEqual(parsed, { domain: "example.com" });

  await assert.rejects(
    () =>
      readBoundedJSONObject(
        new Request("https://edge.example/config", {
          method: "POST",
          body: JSON.stringify({ domain: "x".repeat(200) }),
        }),
        32,
      ),
    (error) =>
      error instanceof PublicSiteRequestError && error.status === 413,
  );
});

test("stale availability fallback strips every executable or verification field", () => {
  const safe = stripStalePublicSiteIntegrations({
    body_scripts: "body",
    google_ads_id: "AW-1",
    google_analytics_id: "G-EXAMPLE",
    google_search_console_verification: "verification-token",
    gtm_id: "GTM-EXAMPLE",
    head_scripts: "head",
    id: "site-id",
    meta_pixel_id: "12345",
    site_title: "Site",
  });

  assert.equal(safe.id, "site-id");
  assert.equal(safe.site_title, "Site");
  for (const field of [
    "body_scripts",
    "google_ads_id",
    "google_analytics_id",
    "google_search_console_verification",
    "gtm_id",
    "head_scripts",
    "meta_pixel_id",
  ]) {
    assert.equal(safe[field], null, field);
  }
});

test("live Edge handlers and Cloudflare template keep the hardened contracts", () => {
  const ssr = readFileSync("supabase/functions/public-site-ssr/index.ts", "utf8");
  const workerConfig = readFileSync("supabase/functions/get-worker-config/index.ts", "utf8");
  const workerTemplate = readFileSync("lib/site/cloudflare-worker.ts", "utf8");
  const deployWorker = readFileSync("deploy/cloudflare-public-site-worker.js", "utf8");
  const server = readFileSync("lib/api/public-site-server.ts", "utf8");
  const trackingScripts = readFileSync(
    "components/features/public-site/PublicTrackingScripts.tsx",
    "utf8",
  );

  assert.doesNotMatch(ssr, /\.or\s*\(/);
  assert.doesNotMatch(ssr, /searchParams\.get\(["']url["']\)/);
  assert.doesNotMatch(ssr, /head_scripts|body_scripts|gtm_id|meta_pixel_id|google_analytics_id/);
  assert.doesNotMatch(ssr, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(ssr, /createClient/);
  assert.match(ssr, /fetchPublicSiteConfiguration/);
  assert.match(ssr, /isPublicSiteCrawler/);
  assert.match(ssr, /status: 307/);
  assert.match(ssr, /"Cache-Control": "no-store"/);

  assert.doesNotMatch(workerConfig, /\.or\s*\(/);
  assert.doesNotMatch(workerConfig, /head_scripts|body_scripts|gtm_id|meta_pixel_id/);
  assert.doesNotMatch(workerConfig, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(workerConfig, /createClient/);
  assert.match(workerConfig, /readBoundedJSONObject/);
  assert.match(workerConfig, /fetchPublicSiteConfiguration/);
  assert.match(workerConfig, /"Cache-Control": "no-store"/);

  for (const worker of [workerTemplate, deployWorker]) {
    assert.match(worker, /headers\.set\("Cache-Control", "no-store"\)/);
    assert.doesNotMatch(worker, /caches\.default|stale-while-revalidate|stale-if-error/);
  }
  assert.match(server, /stripStalePublicSiteIntegrations\(site\)/);
  assert.match(trackingScripts, /if \(!consentAccepted\) return/);
  assert.doesNotMatch(trackingScripts, /<noscript/i);
});

test("operator UI documents consent-aware GTM testing and one GA installation path", () => {
  const analytics = readFileSync(
    "components/features/integrations/google-analytics/GoogleAnalyticsIntegrationSettings.tsx",
    "utf8",
  );
  const tagManager = readFileSync(
    "components/features/integrations/google-tag-manager/GoogleTagManagerIntegrationSettings.tsx",
    "utf8",
  );

  assert.match(analytics, /um único caminho[\s\S]*não use os dois/i);
  assert.match(tagManager, /Tag Assistant[\s\S]*aceite os cookies/i);
  assert.match(tagManager, /remova o ID direto[\s\S]*não medir[\s\S]*duas vezes/i);
});
