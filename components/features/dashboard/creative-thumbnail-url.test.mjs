import assert from "node:assert/strict";
import test from "node:test";

import { getDashboardCreativeSafeUrl, getDashboardCreativeThumbnailUrl } from "./creative-thumbnail-url.ts";

test("miniaturas da Dashboard aceitam apenas URLs HTTPS absolutas sem credenciais", () => {
  assert.equal(getDashboardCreativeThumbnailUrl(" https://cdn.example.com/a.jpg "), "https://cdn.example.com/a.jpg");
  assert.equal(getDashboardCreativeThumbnailUrl("http://cdn.example.com/a.jpg"), null);
  assert.equal(getDashboardCreativeThumbnailUrl("https:cdn.example.com/a.jpg"), null);
  assert.equal(getDashboardCreativeThumbnailUrl("https://user:secret@cdn.example.com/a.jpg"), null);
  assert.equal(getDashboardCreativeThumbnailUrl("javascript:alert(1)"), null);
  assert.equal(getDashboardCreativeThumbnailUrl("/local.jpg"), null);
  assert.equal(getDashboardCreativeThumbnailUrl(null), null);
});

test("links externos dos criativos usam a mesma validação HTTPS", () => {
  assert.equal(getDashboardCreativeSafeUrl("https://www.instagram.com/p/example/"), "https://www.instagram.com/p/example/");
  assert.equal(getDashboardCreativeSafeUrl("javascript:alert(1)"), null);
  assert.equal(getDashboardCreativeSafeUrl("https://name:password@cdn.example.com/video.mp4"), null);
  assert.equal(getDashboardCreativeSafeUrl(undefined), null);
});
